// main.js —— 应用层（FR-05/07/08/09/11/12、API-21~API-26、API-42~API-44）
// 设计约束（《01_设计文档》ARCH-02、§4.9）：
//   · 持有全局状态与流程编排；表现层只读、领域层纯函数
//   · 存档时机：结算 / 解锁 / 金币与道具变化 / 设置与昵称变化 / visibilitychange（FR-11-1）
//   · 结算等"编排逻辑"以纯函数导出（同文件 import 即可在 Node 中单测，无需 DOM）

import { WIN_COINS, FIRST_THREE_STAR_COINS, ITEM_PRICES, ITEM_CAP, NICKNAME_MAX } from './config.js';
import { LEVELS, levelById, validateLevel } from './levels.js';
import { createBoard, resolveSwap, applyHammer, applyShuffleItem, cloneBoard } from './board.js';
import { finalScore, starsFor } from './score.js';
import { browserStorage, defaultSave } from './storage.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import * as log from './logger.js';

const TOP_N = 10;

/* =====================================================================
 *  纯函数区：结算与排行榜（可在 Node 中直接单测，见 tests/settlement.test.mjs）
 * ===================================================================== */

/** 线性解锁：章内下一关；章末解锁下一章第 1 关；已是最后一关返回 null */
export function nextLevelId(levelId) {
  const i = LEVELS.findIndex((l) => l.id === levelId);
  if (i < 0 || i >= LEVELS.length - 1) return null;
  return LEVELS[i + 1].id;
}

/** 总星数 */
export function totalStars(save) {
  return Object.values(save.stars || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** 总星榜条目（本机唯一玩家条目 upsert） */
export function buildTotalEntry(save, now = 0) {
  const stars = totalStars(save);
  const score = Object.values(save.bestScores || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return { nickname: save.nickname, stars, score, ts: now };
}

function sortTotal(a, b) {
  if (b.stars !== a.stars) return b.stars - a.stars;
  if (b.score !== a.score) return b.score - a.score;
  return (a.ts || 0) - (b.ts || 0);
}

/** 写入总星榜（按昵称 upsert，取更优，保留前 10） */
export function upsertTotalBoard(save, now = 0) {
  const entry = buildTotalEntry(save, now);
  const list = (save.leaderboard.total || []).filter((e) => e.nickname !== save.nickname);
  const prev = (save.leaderboard.total || []).find((e) => e.nickname === save.nickname);
  const best = prev && (prev.stars > entry.stars || (prev.stars === entry.stars && prev.score >= entry.score))
    ? { ...entry, stars: prev.stars, score: prev.score, ts: prev.ts }
    : entry;
  const next = [...list, best].sort(sortTotal).slice(0, TOP_N);
  return { ...save, leaderboard: { ...save.leaderboard, total: next } };
}

/** 写入单关榜（按昵称 upsert 取最高分，保留前 10） */
export function upsertLevelBoard(save, levelId, score, now = 0) {
  const levels = { ...(save.leaderboard.levels || {}) };
  const list = (levels[levelId] || []).filter((e) => e.nickname !== save.nickname);
  const prev = (levels[levelId] || []).find((e) => e.nickname === save.nickname);
  const best = prev && prev.score >= score ? prev : { nickname: save.nickname, score, ts: now };
  levels[levelId] = [...list, best].sort((a, b) => b.score - a.score || (a.ts || 0) - (b.ts || 0)).slice(0, TOP_N);
  return { ...save, leaderboard: { ...save.leaderboard, levels } };
}

/**
 * 结算一局（纯函数）：返回新存档与本次结算明细
 * 规则来源：FR-07（星级与奖励）、FR-08（解锁）、FR-09（金币）、FR-10（排行榜）、7.2（存档）
 */
export function settleLevel(save, level, outcome, now = 0) {
  const won = !!outcome.won;
  const total = finalScore(outcome.inLevelScore, outcome.movesLeft, won, level.bonusPerStep);
  const stars = starsFor(total, level.scoreTarget, won);
  const prevStars = (save.stars || {})[level.id] || 0;
  const prevBest = (save.bestScores || {})[level.id] || 0;
  const isNewBest = won && total > prevBest;

  let coinsGained = 0;
  let firstThreeStar = false;
  if (won) {
    if (prevStars < 3 && stars >= 3) { coinsGained += FIRST_THREE_STAR_COINS; firstThreeStar = true; }
    coinsGained += WIN_COINS;
  }

  let next = {
    ...save,
    coins: (save.coins || 0) + coinsGained,
    stars: { ...(save.stars || {}) },
    bestScores: { ...(save.bestScores || {}) },
  };
  if (won) {
    next.stars[level.id] = Math.max(prevStars, stars);
    next.bestScores[level.id] = Math.max(prevBest, total);
    const nx = nextLevelId(level.id);
    if (nx && LEVELS.findIndex((l) => l.id === nx) > LEVELS.findIndex((l) => l.id === save.unlockedLevelId)) {
      next.unlockedLevelId = nx;
    }
  }
  next = upsertLevelBoard(next, level.id, total, now);
  next = upsertTotalBoard(next, now);

  return {
    save: next, won, total, stars, coinsGained, isNewBest, firstThreeStar,
    unlockedLevelId: next.unlockedLevelId,
    canNext: won && !!nextLevelId(level.id),
  };
}

/** 重置进度（FR-14-3）：清空进度与两个榜单，保留昵称与音量设置 */
export function applyReset(save) {
  return {
    ...save,
    unlockedLevelId: '1-1',
    coins: 0,
    items: { shuffle: 1, hammer: 1, steps: 1 },
    stars: {},
    bestScores: {},
    leaderboard: { total: [], levels: {} },
    guided: false,
    tipsSeen: { stripeH: false, stripeV: false, bomb: false, rainbow: false },
  };
}

/** 非负钳制 + 截断昵称（UI 输入兜底） */
export function sanitizeSettings(save, patch) {
  const out = { ...save, settings: { ...save.settings } };
  if (patch.nickname !== undefined) {
    const name = String(patch.nickname || '').trim().slice(0, NICKNAME_MAX);
    out.nickname = name || save.nickname;
    out.leaderboard = {
      total: (save.leaderboard.total || []).map((e) => (e.nickname === save.nickname ? { ...e, nickname: out.nickname } : e)),
      levels: Object.fromEntries(Object.entries(save.leaderboard.levels || {}).map(([k, list]) => [
        k, list.map((e) => (e.nickname === save.nickname ? { ...e, nickname: out.nickname } : e)),
      ])),
    };
  }
  if (patch.musicOn !== undefined) out.settings.musicOn = !!patch.musicOn;
  if (patch.sfxOn !== undefined) out.settings.sfxOn = !!patch.sfxOn;
  if (patch.musicVol !== undefined) out.settings.musicVol = clampVol(patch.musicVol);
  if (patch.sfxVol !== undefined) out.settings.sfxVol = clampVol(patch.sfxVol);
  return out;
}

function clampVol(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 80;
  return Math.max(0, Math.min(100, n));
}

/** 目标进度文案与达成判定 */
export function objectiveState(level, clearedByColor, inLevelScore) {
  if (level.objectiveType === 'clear') {
    const done = (clearedByColor && clearedByColor[level.targetColor]) || 0;
    return { met: done >= level.objectiveTarget, label: `${Math.min(done, level.objectiveTarget)} / ${level.objectiveTarget}` };
  }
  return { met: inLevelScore >= level.scoreTarget, label: `${inLevelScore} / ${level.scoreTarget}` };
}

/* =====================================================================
 *  演示辅助：预置存档（仅 URL 带 ?demo=1 时启用，不影响正常游玩与评分材料）
 * ===================================================================== */

/** 演示用存档：解锁到 2-6（含消除型关卡）、有金币与道具、带若干历史成绩与两条外部榜条目 */
export function demoSave(now = 0) {
  const base = defaultSave();
  const stars = { '1-1': 3, '1-2': 3, '1-3': 2, '1-4': 2, '1-5': 1, '2-1': 2, '2-2': 1, '2-3': 2, '2-4': 1, '2-5': 2 };
  const bestScores = {
    '1-1': 16400, '1-2': 15200, '1-3': 13800, '1-4': 13100, '1-5': 11800,
    '2-1': 9200, '2-2': 7400, '2-3': 6900, '2-4': 6100, '2-5': 6800,
  };
  const seeded = {
    ...base,
    nickname: '演示员',
    unlockedLevelId: '2-6',
    coins: 860,
    items: { shuffle: 3, hammer: 2, steps: 2 },
    stars,
    bestScores,
    guided: true,
    tipsSeen: { stripeH: true, stripeV: true, bomb: true, rainbow: false },
    leaderboard: {
      total: [
        { nickname: '室友A', stars: 24, score: 128000, ts: now - 86400000 },
        { nickname: '室友B', stars: 17, score: 96000, ts: now - 172800000 },
      ],
      levels: { '1-1': [{ nickname: '室友A', score: 17800, ts: now - 86400000 }] },
    },
  };
  return upsertTotalBoard(seeded, now);
}

/* =====================================================================
 *  应用层状态与编排（仅在浏览器中运行；Node 导入时不会触碰 DOM）
 * ===================================================================== */

export const state = {
  page: 'home',
  save: null,
  storage: null,
  levels: { list: LEVELS, chapter: 1, broken: [] },
  play: null,
  result: null,
  rank: { tab: 'total', levelId: '1-1' },
  settings: null,
  offline: { sw: 'unknown' },
  audioAvailable: false,
  guide: { active: false, step: 0 },
  itemMode: null,
};

function toast(text, sticky = false) { ui.showBanner(text, { sticky }); }

function persist(statusHint) {
  if (!state.storage) return { ok: false };
  const res = state.storage.save(state.save);
  if (!res.ok) {
    log.error('save.failed', { error: res.error, coins: state.save.coins });
    toast('进度无法保存（浏览器存储已满或被禁用），本局结果可能丢失', true);
  } else if (res.memoryOnly) {
    toast('进度仅本次有效（浏览器存储不可用）', true);
  } else if (statusHint) {
    ui.hideBanner();
  }
  return res;
}

function syncAudio() {
  audio.setVolumes(state.save.settings);
  if (state.save.settings.musicOn && state.audioAvailable) audio.playBgm();
  else audio.stopBgm();
}

/** API-25 navigate */
export function navigate(page) {
  state.page = page;
  if (page === 'rank') state.rank = { ...state.rank };
  if (page === 'settings') state.settings = { ...state.save.settings, nickname: state.save.nickname };
  // 进入选关页时默认定位到当前进度所在章节（FR-12）
  if (page === 'levels') {
    const cur = levelById(state.save.unlockedLevelId);
    state.levels = { ...state.levels, chapter: (cur && cur.chapter) || 1 };
  }
  renderAll();
  return { ok: true };
}

function renderAll() {
  ui.render({
    page: state.page,
    save: state.save,
    levels: state.levels,
    play: state.play,
    result: state.result,
    rank: state.rank,
    settings: state.settings,
    offline: state.offline,
    audioAvailable: state.audioAvailable,
  });
}

/** API-22 startLevel */
export function startLevel(levelId) {
  const level = levelById(levelId);
  if (!level) { toast('关卡不存在'); return { ok: false, error: 'NotFound' }; }
  const errors = validateLevel(level);
  if (errors.length) { toast(`关卡配置错误：${errors[0]}`); return { ok: false, error: 'InvalidLevel' }; }
  state.play = {
    level,
    board: createBoard({ rows: level.boardRows, cols: level.boardCols, colors: level.colors }),
    movesLeft: level.moves,
    inLevelScore: 0,
    clearedByColor: new Array(level.colors).fill(0),
    itemMode: null,
    swaps: 0,
  };
  state.itemMode = null;
  state.result = null;
  state.play.targetLabel = objectiveState(level, state.play.clearedByColor, 0).label;
  ui.clearSelection();
  log.info('level.start', {
    id: level.id, rows: level.boardRows, cols: level.boardCols, colors: level.colors,
    moves: level.moves, type: level.objectiveType, target: level.objectiveTarget, color: level.targetColor,
  });
  navigate('play');
  maybeStartGuide(levelId);
  return { ok: true };
}

/** API-26 onSwap —— 一次交换的完整编排（FLOW-02） */
export async function onSwap(a, b) {
  const p = state.play;
  if (!p || state.page !== 'play') return { ok: false };
  if (p.itemMode === 'hammer') return { ok: false, error: 'ItemMode' };

  const before = cloneBoard(p.board);
  const endResolve = log.time('perf.resolveSwap', { level: p.level.id, from: a, to: b });
  const result = resolveSwap(p.board, a, b);
  endResolve({ valid: result.valid, score: result.score, cleared: result.clearedTotal, combos: result.combos.length });

  if (!result.valid) {
    log.info('swap.invalid', { a, b, movesLeft: p.movesLeft });
    audio.play('bounce');
    await ui.playSequence([{ type: 'bounce', a, b }]);
    return { ok: true, valid: false };
  }

  // 有效交换：步数 −1（FR-02-4/5、AC-10/AC-35），并构造"交换后、消除前"的快照用于动画
  p.movesLeft -= 1;
  p.swaps += 1;
  p.inLevelScore += result.score;
  Object.entries(result.clearedByColor || {}).forEach(([color, n]) => {
    const ci = Number(color);
    p.clearedByColor[ci] = (p.clearedByColor[ci] || 0) + n;
  });

  const mid = cloneBoard(before);
  const t = mid.cells[a]; mid.cells[a] = mid.cells[b]; mid.cells[b] = t;

  log.info('swap.ok', {
    a, b, score: result.score, combos: result.combos.length, cleared: result.clearedTotal,
    clearedByColor: result.clearedByColor, specials: result.specialsCreated.length,
    crossBlast: result.crossBlast, shuffled: result.shuffled,
    movesLeft: p.movesLeft, inLevelScore: p.inLevelScore,
  });

  audio.play('swap');
  if (result.combos.length >= 2) audio.play('combo', { combo: result.combos.length });
  if (result.specialsCreated && result.specialsCreated.length) audio.play('special');
  else if (result.clearedTotal >= 5) audio.play('clear');

  renderAll();
  await ui.playSequence([
    { type: 'swap', a, b },
    { type: 'combo', combo: result.combos.length },
    { type: 'cascade', before: mid, after: p.board },
  ]);

  if (result.shuffled) {
    await ui.playSequence([{ type: 'shuffle' }]);
    toast('无可用步数，已重新洗牌（不扣步数）');
  }
  if (state.guide.active && state.guide.step === 1) advanceGuide(2);

  return afterMove();
}

/** 交换/道具之后的目标与失败判定（FLOW-05） */
function afterMove() {
  const p = state.play;
  const obj = objectiveState(p.level, p.clearedByColor, p.inLevelScore);
  p.targetLabel = obj.label;
  log.debug('objective', { label: obj.label, met: obj.met, movesLeft: p.movesLeft, score: p.inLevelScore });
  renderAll();
  if (obj.met) return onSettle(true);
  if (p.movesLeft <= 0) return onSettle(false);
  return { ok: true };
}

/** API-24 onSettle */
export function onSettle(won) {
  const p = state.play;
  if (!p) return { ok: false };
  log.info('settle.begin', { won, level: p.level.id, score: p.inLevelScore, movesLeft: p.movesLeft });
  const settled = settleLevel(state.save, p.level, {
    won, inLevelScore: p.inLevelScore, movesLeft: p.movesLeft,
  }, Date.now());
  state.save = settled.save;
  state.result = {
    won, stars: settled.stars, total: settled.total, coinsGained: settled.coinsGained,
    isNewBest: settled.isNewBest, firstThreeStar: settled.firstThreeStar,
    canNext: settled.canNext, level: p.level,
  };
  log.info('settle.done', {
    won, total: settled.total, stars: settled.stars, coins: settled.coinsGained,
    newBest: settled.isNewBest, unlocked: settled.save.unlockedLevelId,
  });
  persist();
  syncAudio();
  audio.play(won ? 'win' : 'lose');
  navigate('result');
  if (state.guide.active && state.guide.step === 2) advanceGuide(3);
  return { ok: true, ...settled };
}

/** API-23 useItem */
export async function useItem(type, extra) {
  const p = state.play;
  const price = ITEM_PRICES[type];
  if (price === undefined) return { ok: false, error: 'UnknownItem' };
  if ((state.save.coins || 0) < price) { toast('金币不足'); audio.play('bounce'); return { ok: false, error: 'NoCoins' }; }

  if (type === 'hammer') {
    if (!p || state.page !== 'play') { toast('锤子只能在关卡内使用'); return { ok: false }; }
    const ok = await ui.confirm({
      title: '使用锤子',
      text: `消耗 ${price} 金币并消耗 1 个锤子，点击任意方块将其消除（不计分，但计入消除目标）。`,
      okText: '开始选格',
    });
    if (!ok) return { ok: false, error: 'Cancelled' };
    onItemModeChange('enter');
    return { ok: true };
  }

  const ok = await ui.confirm({
    title: type === 'shuffle' ? '使用洗牌' : '购买 +5 步',
    text: type === 'shuffle'
      ? `消耗 ${price} 金币打乱棋盘（不消耗步数）。使用后立即消耗，退出本局不返还。`
      : `消耗 ${price} 金币立即获得 5 步。使用后立即消耗，退出本局不返还。`,
    okText: '确定使用',
  });
  if (!ok) return { ok: false, error: 'Cancelled' };

  state.save = { ...state.save, coins: state.save.coins - price };
  state.save.items = { ...state.save.items, [type]: Math.max(0, Math.min(ITEM_CAP, (state.save.items[type] || 0) - 1)) };

  if (type === 'steps') {
    if (p && state.page === 'play') {
      p.movesLeft += 5;
      renderAll();
      toast('步数 +5');
    } else if (state.result && !state.result.won && p) {
      // 失败结算界面续玩：保留棋盘与得分，补 5 步（FR-09-5、AC-19）
      p.movesLeft = 5;
      state.result = null;
      navigate('play');
      toast('续玩：+5 步');
    }
  } else if (type === 'shuffle' && p) {
    applyShuffleItem(p.board, Math.random);
    await ui.playSequence([{ type: 'shuffle' }]);
    renderAll();
    await afterMove();
  }
  persist();
  syncAudio();
  return { ok: true };
}

/** API-43 onItemModeChange：锤子选格模式 */
export function onItemModeChange(mode) {
  if (mode === 'cancel') {
    state.itemMode = null;
    if (state.play) state.play.itemMode = null;
    ui.clearSelection();
    renderAll();
    return { ok: true };
  }
  if (mode === 'enter') {
    if (!state.play || state.page !== 'play') return { ok: false };
    state.itemMode = 'hammer';
    state.play.itemMode = 'hammer';
    renderAll();
    toast('锤子模式：点击要消除的方块');
    return { ok: true };
  }
  return { ok: false };
}

/** 锤子选定格子：此时才真正扣费与消耗（取消不消耗） */
export async function onHammerPick(index) {
  const p = state.play;
  if (!p || state.itemMode !== 'hammer') return { ok: false };
  const res = applyHammer(p.board, index, Math.random);
  if (!res.ok) { toast('该位置没有方块'); return { ok: false }; }

  state.save = { ...state.save, coins: state.save.coins - ITEM_PRICES.hammer };
  state.save.items = { ...state.save.items, hammer: Math.max(0, Math.min(ITEM_CAP, (state.save.items.hammer || 0) - 1)) };
  p.clearedByColor[res.color] = (p.clearedByColor[res.color] || 0) + 1;
  onItemModeChange('cancel');
  audio.play('special');
  await ui.playSequence([{ type: 'cascade', before: null, after: p.board }]);
  persist();
  return afterMove();
}

/** API-44 onVisibilityChange：切后台/关闭前保存 */
export function onVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') persist();
  return { ok: true };
}

/* ==================== 新手引导（FLOW-09） ==================== */
function maybeStartGuide(levelId) {
  const first = levelId === '1-1';
  if (!first) return;
  if (state.save.guided) return;
  state.guide = { active: true, step: 1 };
  ui.showGuide(1);
}

function advanceGuide(step) {
  state.guide.step = step;
  if (step > 3) { closeGuide(); return; }
  ui.showGuide(step);
}

function closeGuide() {
  state.guide = { active: false, step: 0 };
  ui.hideGuide();
  if (!state.save.guided) {
    state.save = { ...state.save, guided: true };
    persist();
  }
}

/* ==================== 设置与重置 ==================== */
/** API-26 setSettings */
export function setSettings(patch) {
  state.save = sanitizeSettings(state.save, patch);
  state.settings = { ...state.save.settings, nickname: state.save.nickname };
  audio.setVolumes(state.save.settings);
  syncAudio();
  persist();
  renderAll();
  return { ok: true };
}

async function onReset() {
  const ok = await ui.confirm({
    title: '重置进度',
    text: '将清空关卡进度与两个榜单，恢复初始状态（金币 0、道具各 1、仅解锁 1-1），保留昵称与音量设置。此操作不可撤销。',
    okText: '确认重置',
  });
  if (!ok) return { ok: false };
  state.save = applyReset(state.save);
  state.play = null;
  state.result = null;
  state.guide = { active: false, step: 0 };
  state.storage.reset();
  persist();
  syncAudio();
  navigate('home');
  toast('进度已重置');
  return { ok: true };
}

/* ==================== 启动（API-42 boot） ==================== */
export function boot(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return { ok: false, error: 'NoDocument' };
  const isDebug = typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search);
  log.init({ minLevel: isDebug ? 'debug' : 'info' });
  log.install();
  log.attachPanel(doc);
  const endBoot = log.time('perf.boot');

  state.storage = browserStorage();
  const { data, status } = state.storage.load();
  state.save = data;
  state.settings = { ...data.settings, nickname: data.nickname };

  // 演示模式（?demo=1）：载入预置进度，便于现场演示不等进度
  let bootStatus = status;
  const isDemo = typeof location !== 'undefined' && /[?&]demo=1\b/.test(location.search);
  if (isDemo) {
    state.save = demoSave(Date.now());
    state.settings = { ...state.save.settings, nickname: state.save.nickname };
    state.storage.save(state.save);
    bootStatus = 'demo';
  }

  state.levels = { list: LEVELS, chapter: 1, broken: LEVELS.filter((l) => validateLevel(l).length).map((l) => l.id) };

  ui.mount(doc.getElementById('app'), {
    onContinue: () => navigate('levels'),
    onStartLevel: (id) => startLevel(id),
    onChapter: (c) => { state.levels = { ...state.levels, chapter: c }; renderAll(); },
    onSwap: (a, b) => { onSwap(a, b); },
    onItem: (type) => { useItem(type); },
    onHammerPick: (i) => { onHammerPick(i); },
    onBlockedInput: () => { /* 动画期间的输入按 UI-03 丢弃 */ },
    onNavigate: (page) => navigate(page),
    onRetry: () => { if (state.play) startLevel(state.play.level.id); },
    onNext: () => { const nx = state.play && nextLevelId(state.play.level.id); if (nx) startLevel(nx); },
    onRankTab: (tab) => { state.rank = { ...state.rank, tab }; renderAll(); },
    onRankLevel: (id) => { state.rank = { ...state.rank, levelId: id }; renderAll(); },
    onSettings: (patch) => setSettings(patch),
    onReset: () => onReset(),
    onGuideNext: () => {
      if (state.guide.step === 1) advanceGuide(2);
      else if (state.guide.step === 2) advanceGuide(3);
      else closeGuide();
    },
    onGuideSkip: () => closeGuide(),
  });

  audio.setVolumes(data.settings);
  renderAll();

  // 调试/自动化钩子：仅暴露只读状态与公开 API，便于排障与端到端测试
  if (typeof window !== 'undefined') {
    window.__game = {
      state,
      api: {
        boot, startLevel, onSwap, useItem, onItemModeChange, onHammerPick, navigate, onSettle,
        setSettings, onReset, applyReset, demoSave, objectiveState, settleLevel, nextLevelId, totalStars,
      },
      log: { get: log.getLogs, clear: log.clear, exportText: log.exportText, panel: log.togglePanel },
    };
  }
  log.info('boot.done', {
    status: bootStatus, unlock: state.save.unlockedLevelId, coins: state.save.coins,
    stars: totalStars(state.save), audio: state.audioAvailable,
  });
  endBoot({ status: bootStatus });

  // 首次用户交互后初始化音频（浏览器自动播放策略 + NFR-01f）
  const unlock = () => {
    const res = audio.init();
    state.audioAvailable = !!res.available;
    if (state.audioAvailable) { audio.setVolumes(state.save.settings); syncAudio(); }
    renderAll();
    doc.removeEventListener('pointerdown', unlock);
    doc.removeEventListener('keydown', unlock);
  };
  doc.addEventListener('pointerdown', unlock);
  doc.addEventListener('keydown', unlock);

  // 存档状态提示（FLOW-07 的四种 status + 演示模式）
  if (bootStatus === 'demo') toast('演示模式：已载入预置进度（正常游玩请去掉URL中的 ?demo=1）');
  else if (bootStatus === 'corrupt') toast('存档损坏，已重置（旧档已备份）');
  else if (bootStatus === 'unavailable') toast('进度仅本次有效（浏览器存储不可用）', true);
  else if (bootStatus === 'migrated') toast('存档已升级到新版本');

  // Service Worker 注册：异步、不阻塞（FLOW-01 / FLOW-09 时序约定）
  registerServiceWorker();

  doc.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => persist());

  navigate('home');
  return { ok: true, status: bootStatus };
}

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    state.offline = { sw: 'unavailable' };
    return;
  }
  try {
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    // 新版本 SW 接管后自动刷新一次，避免 cache-first 让玩家停留在旧代码
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(() => { state.offline = { sw: 'ok' }; renderAll(); })
      .catch(() => { state.offline = { sw: 'unavailable' }; renderAll(); });
  } catch (e) {
    state.offline = { sw: 'unavailable' };
  }
}

// 浏览器环境自动启动（Node 中导入本模块不会触发）
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
