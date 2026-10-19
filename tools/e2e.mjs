#!/usr/bin/env node
// e2e.mjs —— 端到端冒烟测试（Edge/Chrome DevTools Protocol）
// 能力：启动无头浏览器 → 打开游戏 → 读取/驱动 window.__game → 抓控制台与页面日志 → 按时间点截图。
// 用法：node tools/e2e.mjs [--base=http://127.0.0.1:8123] [--out=..\_e2e] [--keep]
// 依赖：仅 Node 内置（fetch / WebSocket / child_process），不装任何包。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const BASE = args.base || 'http://127.0.0.1:8123';
const OUT = path.resolve(args.out || path.join(process.cwd(), '_e2e'));
const PORT = Number(args.port || 9333);
const KEEP = !!args.keep;
const VIEW = { width: Number(args.width || 420), height: Number(args.height || 900) };

fs.mkdirSync(OUT, { recursive: true });
const shots = path.join(OUT, 'shots');
fs.mkdirSync(shots, { recursive: true });

const log = (...a) => console.log(...a);
const fail = [];
function check(name, cond, detail = '') {
  if (cond) log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`);
  else { fail.push(name); log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 找浏览器 ---------------- */
function findBrowser() {
  const cands = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/* ---------------- 极简 CDP 客户端 ---------------- */
class CDP {
  constructor(wsUrl, timeoutMs = 20000) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket 连接超时')), timeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error('WebSocket 错误')); });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); } }, 30000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

/* ---------------- 主流程 ---------------- */
const browserPath = findBrowser();
if (!browserPath) {
  console.error('未找到 Edge/Chrome，可用 --browser 或设置 EDGE_PATH');
  process.exit(2);
}
log(`浏览器: ${browserPath}`);
log(`目标: ${BASE}/?demo=1&debug=1    输出: ${OUT}\n`);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-e2e-'));
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank',
], { stdio: 'ignore' });

async function waitEndpoint(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('调试端口未就绪');
}

let cdp = null;
const consoleLines = [];
const pageErrors = [];

try {
  await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch (e) {}
      await sleep(200);
    }
    throw new Error('调试端口未就绪');
  })();

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    page = created;
  }

  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: 2, mobile: true,
  });

  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
    consoleLines.push(`[${p.type}] ${text}`);
    if (p.type === 'error') pageErrors.push(text);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const msg = (d.exception && d.exception.description) || d.text || '未知异常';
    pageErrors.push(msg);
    consoleLines.push('[exception] ' + msg);
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    consoleLines.push(`[log:${e.level}] ${e.text}`);
    if (e.level === 'error') pageErrors.push(e.text);
  });

  async function evaluate(expression, awaitPromise = true) {
    const r = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'evaluate 异常');
    }
    return r.result ? r.result.value : undefined;
  }
  async function waitFor(expression, timeoutMs = 8000, label = expression) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (await evaluate(`!!(${expression})`)) return true; } catch (e) {}
      await sleep(120);
    }
    throw new Error('等待超时: ' + label);
  }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(shots, name.endsWith('.png') ? name : name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    log(`  📷 ${path.basename(file)}`);
    return file;
  }

  /* ---------- 1. 打开游戏 ---------- */
  log('=== 1) 启动与首屏 ===');
  await cdp.send('Page.navigate', { url: `${BASE}/?demo=1&debug=1` });
  await waitFor('window.__game && window.__game.state && window.__game.state.page', 12000, 'game boot');
  const boot = await evaluate(`(() => {
    const g = window.__game;
    return {
      page: g.state.page,
      unlock: g.state.save.unlockedLevelId,
      coins: g.state.save.coins,
      stars: g.api.totalStars(g.state.save),
      demo: /demo=1/.test(location.search),
      hasPanel: !!document.getElementById('debug-panel'),
      logs: g.log.get().length,
    };
  })()`);
  check('启动完成且进入首页', boot.page === 'home', JSON.stringify(boot));
  check('演示存档已载入（解锁 2-6 / 860 金币）', boot.unlock === '2-6' && boot.coins === 860);
  check('调试面板已注入', boot.hasPanel === true);
  check('启动日志已采集', boot.logs > 0, `${boot.logs} 条`);
  await shot('01_home');

  /* ---------- 2. 选关页：章节过滤 ---------- */
  log('\n=== 2) 选关页章节过滤 ===');
  await evaluate(`document.getElementById('home-continue').click()`);
  await waitFor(`window.__game.state.page === 'levels'`);
  const ch2 = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#levels-grid .level-cell')].map(b => b.querySelector('.lv-id').textContent);
    const active = document.querySelector('#levels-tabs .tab.is-active')?.textContent || '';
    return { cells, active, count: cells.length };
  })()`);
  check('选关页只渲染当前章节（10 关）', ch2.count === 10, `实际 ${ch2.count} 关: ${ch2.cells.join(',')}`);
  check('默认定位到进度所在章节（第 2 章）', /第\s*2\s*章/.test(ch2.active) && ch2.cells[0] === '2-1');
  await shot('02_levels_ch2');

  await evaluate(`[...document.querySelectorAll('#levels-tabs .tab')][0].click()`);
  await sleep(250);
  const ch1 = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#levels-grid .level-cell')].map(b => b.querySelector('.lv-id').textContent);
    return { cells, count: cells.length };
  })()`);
  check('切到第 1 章后只显示 1-1~1-10', ch1.count === 10 && ch1.cells[0] === '1-1' && ch1.cells[9] === '1-10', ch1.cells.join(','));
  const starText = await evaluate(`(() => {
    const first = document.querySelector('#levels-grid .level-cell .lv-stars');
    return first ? first.textContent : '';
  })()`);
  check('星级为 3 槽位填空式（1-1 应为 ★★★ 或 ★★☆ 等 3 字符）', [...starText].length === 3, `"${starText}"`);
  await shot('03_levels_ch1');

  /* ---------- 3. 局内：交换与动画 ---------- */
  log('\n=== 3) 局内交换与动画 ===');
  await evaluate(`window.__game.api.startLevel('2-3')`);
  await waitFor(`window.__game.state.page === 'play'`);
  const hud0 = await evaluate(`(() => ({
    moves: document.getElementById('play-moves').textContent,
    score: document.getElementById('play-score').textContent,
    target: document.getElementById('play-target').textContent,
  }))()`);
  check('HUD 步数/得分/目标均有数值（无 undefined/空白）',
    !/undefined|NaN/.test(JSON.stringify(hud0)) && hud0.score.trim() !== '' && hud0.target.trim() !== '',
    JSON.stringify(hud0));
  await shot('04_play');

  // 取一个合法交换
  const pair = await evaluate(`(() => {
    const g = window.__game;
    const moves = g.api.findLegalMoves(g.state.play.board);
    return moves && moves.length ? moves[0] : null;
  })()`);
  check('能取到合法交换', Array.isArray(pair) || (pair && pair.length === 2), JSON.stringify(pair));

  if (pair && pair.length === 2) {
    const startMoves = await evaluate('window.__game.state.play.movesLeft');
    // 同步触发（不 await Promise），按时间点抓动画关键帧
    await evaluate(`window.__game.api.onSwap(${pair[0]}, ${pair[1]})`, false);
    await sleep(260);
    await shot('05_anim_fade');       // 应看到被消除方块缩小淡出、留出空位
    await sleep(140);
    await shot('06_anim_fall');       // 应看到同列方块下落、顶部新方块进入
    await sleep(900);
    await shot('07_after_swap');
    const after = await evaluate(`(() => {
      const g = window.__game;
      return { movesLeft: g.state.play.movesLeft, score: g.state.play.inLevelScore, hudScore: document.getElementById('play-score').textContent };
    })()`);
    check('交换后步数减少且得分增加', after.movesLeft === startMoves - 1 && after.score > 0, JSON.stringify({ startMoves, ...after }));
    check('HUD 得分与状态一致', Number(String(after.hudScore).replace(/[^\d]/g, '')) === after.score, `HUD=${after.hudScore} state=${after.score}`);
  }

  /* ---------- 4. 日志与错误 ---------- */
  log('\n=== 4) 运行日志 ===');
  const logs = await evaluate(`window.__game.log.get()`);
  const events = logs.map((l) => l.event);
  const errs = logs.filter((l) => l.lv === 'error');
  check('采集到 level.start 事件', events.includes('level.start'));
  check('采集到 swap.ok 事件', events.includes('swap.ok'));
  check('采集到动画解锁事件', events.includes('anim.lock'));
  check('页面日志无 error 级条目', errs.length === 0, errs.slice(0, 3).map((e) => e.event + ':' + JSON.stringify(e.data)).join(' | '));
  check('控制台无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  const timing = logs.filter((l) => /perf\./.test(l.event)).map((l) => `${l.event}=${l.data && l.data.ms}ms`);
  log('  耗时打点: ' + (timing.join(', ') || '（无）'));

  fs.writeFileSync(path.join(OUT, 'page-logs.json'), JSON.stringify(logs, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'console.txt'), consoleLines.join('\n'), 'utf8');
  log(`\n  日志已导出: ${path.join(OUT, 'page-logs.json')}（${logs.length} 条）`);
  log(`  控制台输出: ${path.join(OUT, 'console.txt')}（${consoleLines.length} 行）`);
} catch (e) {
  console.error('\n运行失败:', e && e.message ? e.message : e);
  fail.push('harness: ' + (e && e.message));
} finally {
  try { cdp && cdp.ws.close(); } catch (e) {}
  if (!KEEP) {
    try { child.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}

log('\n' + '='.repeat(56));
log(fail.length ? `端到端测试：失败 ${fail.length} 项 -> ${fail.join(' / ')}` : '端到端测试：全部通过');
log(`截图目录: ${shots}`);
log('='.repeat(56));
process.exit(fail.length ? 1 : 0);
