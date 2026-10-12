// settlement.test.mjs —— 应用层编排的纯函数断言（FR-07/08/09/10/14、AC-16~AC-20）
// 运行：node tests/settlement.test.mjs
import {
  nextLevelId, totalStars, settleLevel, applyReset, sanitizeSettings,
  objectiveState, upsertTotalBoard, upsertLevelBoard,
} from '../src/main.js';
import { LEVELS, levelById } from '../src/levels.js';
import { defaultSave } from '../src/storage.js';
import { WIN_COINS, FIRST_THREE_STAR_COINS, ITEM_PRICES } from '../src/config.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
function fresh(patch = {}) {
  return { ...defaultSave(), nickname: '测试员', ...patch };
}

console.log('=== 线性解锁（FR-08、AC-16/AC-17） ===');
check('章内推进：1-1 → 1-2', nextLevelId('1-1') === '1-2');
check('章末跨章：1-10 → 2-1', nextLevelId('1-10') === '2-1');
check('章末跨章：2-10 → 3-1', nextLevelId('2-10') === '3-1');
check('最后一关无下一关', nextLevelId('3-10') === null);
check('非法关卡 id 返回 null', nextLevelId('9-9') === null);

console.log('\n=== 结算：金币与星级（FR-07-4/5、AC-14/AC-18） ===');
const lv11 = levelById('1-1');
{
  const save = fresh();
  const r = settleLevel(save, lv11, { won: true, inLevelScore: lv11.scoreTarget, movesLeft: 0 }, 1000);
  check('过关金币 +30', r.coinsGained === WIN_COINS && r.save.coins === WIN_COINS, `coins=${r.save.coins}`);
  check('恰好达标 → 1 星（过关下限）', r.stars === 1, `stars=${r.stars}`);
  check('解锁下一关 1-2', r.save.unlockedLevelId === '1-2');
  check('写入最好成绩', r.save.bestScores['1-1'] === r.total);
}
{
  const save = fresh({ stars: { '1-1': 0 } });
  const r = settleLevel(save, lv11, { won: true, inLevelScore: Math.round(lv11.scoreTarget * 1.7), movesLeft: 3 }, 1000);
  check('R≥1.6 → 3 星', r.stars === 3, `R=${(r.total / lv11.scoreTarget).toFixed(2)}`);
  check('首次三星额外 +20', r.coinsGained === WIN_COINS + FIRST_THREE_STAR_COINS, `coinsGained=${r.coinsGained}`);
  check('firstThreeStar 标记', r.firstThreeStar === true);
}
{
  const save = fresh({ stars: { '1-1': 3 }, bestScores: { '1-1': lv11.scoreTarget * 3 }, unlockedLevelId: '1-2' });
  const r = settleLevel(save, lv11, { won: true, inLevelScore: lv11.scoreTarget, movesLeft: 0 }, 1000);
  check('已三星再过关不再给三星奖励', r.coinsGained === WIN_COINS, `coinsGained=${r.coinsGained}`);
  check('星级不被更低成绩覆盖', r.save.stars['1-1'] === 3);
  check('最好成绩保留历史更高值', r.save.bestScores['1-1'] === lv11.scoreTarget * 3);
}
{
  const save = fresh({ unlockedLevelId: '1-3', stars: { '1-1': 2, '1-2': 1 }, bestScores: { '1-1': 12000, '1-2': 9000 } });
  const r = settleLevel(save, lv11, { won: false, inLevelScore: 500, movesLeft: 0 }, 1000);
  check('失败：金币不变', r.save.coins === 0 && r.coinsGained === 0);
  check('失败：0 星且不写星数', r.stars === 0 && r.save.stars['1-1'] === 2);
  check('失败：不写最好成绩', r.save.bestScores['1-1'] === 12000);
  check('失败：不解锁/不回退解锁', r.save.unlockedLevelId === '1-3');
}
{
  const save = fresh();
  const r = settleLevel(save, lv11, { won: true, inLevelScore: 0, movesLeft: 0 }, 1000);
  check('未得分也可过关（clear 型情形）→ 仍 1 星', r.stars === 1, `stars=${r.stars}`);
}

console.log('\n=== 排行榜（FR-10、DATA-04、AC-20） ===');
{
  let save = fresh();
  save = upsertLevelBoard(save, '1-1', 10000, 1000);
  save = upsertLevelBoard(save, '1-1', 8000, 2000);
  check('单关榜同昵称取最高分（不被更低分覆盖）', save.leaderboard.levels['1-1'].length === 1 && save.leaderboard.levels['1-1'][0].score === 10000);
  save = upsertLevelBoard(save, '1-1', 12000, 3000);
  check('单关榜刷新更高分', save.leaderboard.levels['1-1'][0].score === 12000);
  check('单关榜时间戳更新', save.leaderboard.levels['1-1'][0].ts === 3000);
}
{
  let save = fresh({ stars: { '1-1': 3, '1-2': 2 }, bestScores: { '1-1': 15000, '1-2': 10000 } });
  save = upsertTotalBoard(save, 500);
  const e = save.leaderboard.total[0];
  check('总星榜：星数 = 总星数', e.stars === 5, `stars=${e.stars}`);
  check('总星榜：分数 = 各关最好分之和', e.score === 25000, `score=${e.score}`);
  check('总星榜：昵称一致', e.nickname === '测试员');
}
{
  let save = fresh();
  for (let i = 0; i < 12; i++) {
    save.leaderboard.total.push({ nickname: '玩家' + i, stars: i, score: i * 100, ts: i });
  }
  save = upsertTotalBoard(save, 999);
  check('总星榜保留前 10 条', save.leaderboard.total.length === 10, `len=${save.leaderboard.total.length}`);
  check('总星榜按星数降序', save.leaderboard.total.every((e, i, a) => i === 0 || a[i - 1].stars >= e.stars));
}
{
  let save = fresh({ nickname: '老王' });
  save = upsertLevelBoard(save, '1-1', 9000, 1);
  save = sanitizeSettings(save, { nickname: '新名字新名字新名字' });
  check('昵称截断至 8 字', save.nickname.length === 8, save.nickname);
  check('昵称变更同步单关榜显示名', save.leaderboard.levels['1-1'][0].nickname === save.nickname);
}

console.log('\n=== 设置与重置（FR-14-1/3、AC-27） ===');
{
  const save = fresh({ nickname: '小明', coins: 500, items: { shuffle: 3, hammer: 2, steps: 1 }, stars: { '1-1': 3 }, bestScores: { '1-1': 20000 }, unlockedLevelId: '1-5', guided: true, settings: { musicOn: false, musicVol: 30, sfxOn: true, sfxVol: 55 } });
  const reset = applyReset(save);
  check('重置：解锁回到 1-1', reset.unlockedLevelId === '1-1');
  check('重置：金币归零', reset.coins === 0);
  check('重置：道具各 1', reset.items.shuffle === 1 && reset.items.hammer === 1 && reset.items.steps === 1);
  check('重置：星数与最好分清空', Object.keys(reset.stars).length === 0 && Object.keys(reset.bestScores).length === 0);
  check('重置：两个榜单清空', reset.leaderboard.total.length === 0 && Object.keys(reset.leaderboard.levels).length === 0);
  check('重置：保留昵称', reset.nickname === '小明');
  check('重置：保留音量与开关', reset.settings.musicOn === false && reset.settings.musicVol === 30 && reset.settings.sfxVol === 55);
  check('重置：引导标记复位（可重新观看）', reset.guided === false);
}
{
  const save = fresh({ settings: { musicOn: true, musicVol: 80, sfxOn: true, sfxVol: 80 } });
  const s1 = sanitizeSettings(save, { musicVol: 999, sfxVol: -20 });
  check('音量钳制到 0~100', s1.settings.musicVol === 100 && s1.settings.sfxVol === 0);
  const s2 = sanitizeSettings(save, { nickname: '   ' });
  check('空白昵称保留原名', s2.nickname === save.nickname);
}

console.log('\n=== 目标判定（FR-05-3/4） ===');
{
  const clearLv = LEVELS.find((l) => l.objectiveType === 'clear');
  const cleared = new Array(clearLv.colors).fill(0);
  cleared[clearLv.targetColor] = clearLv.objectiveTarget - 1;
  check('消除型：未达标', objectiveState(clearLv, cleared, 0).met === false, objectiveState(clearLv, cleared, 0).label);
  cleared[clearLv.targetColor] = clearLv.objectiveTarget;
  check('消除型：达标', objectiveState(clearLv, cleared, 0).met === true, objectiveState(clearLv, cleared, 0).label);
  const scoreLv = LEVELS.find((l) => l.objectiveType === 'score');
  check('计分型：未达标', objectiveState(scoreLv, [], scoreLv.scoreTarget - 1).met === false);
  check('计分型：达标', objectiveState(scoreLv, [], scoreLv.scoreTarget).met === true);
}
{
  check('道具价格常量与文档一致（洗牌/锤子/步数）',
    ITEM_PRICES.shuffle === 100 && ITEM_PRICES.hammer === 150 && ITEM_PRICES.steps === 200);
  check('总星数统计正确', totalStars({ stars: { '1-1': 3, '1-2': 1, '1-3': 2 } }) === 6);
}

console.log(`\n结算与应用层断言：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
