// logger.js —— 运行期监控日志（排障用；不参与玩法判定）
// 能力：① 采集 error/warn/自定义事件；② 环形缓冲（内存 300 条，localStorage 保留 200 条）；
//       ③ 性能打点（耗时可查）；④ 页面内调试面板（?debug=1 或按 D 键切换）；⑤ 一键导出 JSON。
// 约束：不依赖 DOM 也能 import（Node 环境自动降级为内存日志）。

const MEM_LIMIT = 300;
const PERSIST_LIMIT = 200;
const STORE_KEY = 'stardust_logs';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let buffer = [];
let startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
let minLevel = LEVELS.info;
let panel = null;
let installed = false;
let persistTimer = null;

function nowMs() {
  const t = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return Math.round(t - startedAt);
}

function safeData(data) {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return data.length > 300 ? data.slice(0, 300) + '…' : data;
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  try {
    const s = JSON.stringify(data);
    if (s && s.length > 600) return { _truncated: s.slice(0, 600) + '…' };
    return JSON.parse(s);
  } catch (e) {
    return String(data);
  }
}

export function init(opts = {}) {
  if (opts.minLevel && LEVELS[opts.minLevel] !== undefined) minLevel = LEVELS[opts.minLevel];
  startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  if (opts.persist !== false) restore();
  installed = true;
  return { ok: true };
}

function restore() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) buffer = arr.slice(-PERSIST_LIMIT);
  } catch (e) { /* 忽略：日志不可用不影响游戏 */ }
}

function persist() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify(buffer.slice(-PERSIST_LIMIT)));
  } catch (e) { /* 配额满时丢弃即可 */ }
}

function push(level, event, data) {
  const entry = { t: nowMs(), lv: level, event, data: safeData(data) };
  buffer.push(entry);
  if (buffer.length > MEM_LIMIT) buffer = buffer.slice(-MEM_LIMIT);
  if (panel) renderPanel();
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 1500);
  return entry;
}

export const LEVEL = LEVELS;

export function debug(event, data) { if (minLevel <= LEVELS.debug) return push('debug', event, data); }
export function info(event, data) { if (minLevel <= LEVELS.info) return push('info', event, data); }
export function warn(event, data) { return push('warn', event, data); }
export function error(event, data) { return push('error', event, data); }

/** 计时：返回一个 end() 函数，调用后记录耗时 */
export function time(event, data) {
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return (extra) => {
    const t = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
    return debug(event, { ...(data || {}), ms: Math.round(t), ...(extra || {}) });
  };
}

export function getLogs() { return buffer.slice(); }
export function clear() { buffer = []; persist(); if (panel) renderPanel(); }

export function exportText() {
  return buffer.map((e) => `[${String(e.t).padStart(6)}ms] ${e.lv.toUpperCase().padEnd(5)} ${e.event}` +
    (e.data !== undefined ? ' ' + JSON.stringify(e.data) : '')).join('\n');
}

/** 安装全局错误采集（console.error/warn、window.onerror、unhandledrejection） */
export function install(target = typeof window !== 'undefined' ? window : null) {
  if (!target || installed) return { ok: false };
  init({ persist: true });

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => { push('error', 'console.error', args.map(String)); origError(...args); };
  console.warn = (...args) => { push('warn', 'console.warn', args.map(String)); origWarn(...args); };

  target.addEventListener('error', (ev) => {
    push('error', 'window.onerror', {
      message: ev.message, source: ev.filename, line: ev.lineno, col: ev.colno,
      stack: ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 400) : undefined,
    });
  });
  target.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    push('error', 'unhandledrejection', {
      message: r && r.message ? r.message : String(r),
      stack: r && r.stack ? String(r.stack).slice(0, 400) : undefined,
    });
  });

  installed = true;
  info('logger.install', { href: typeof location !== 'undefined' ? location.href : '' });
  return { ok: true };
}

/** 页面内调试面板（默认隐藏；?debug=1 或按 D 键切换） */
export function attachPanel(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return { ok: false };
  if (panel) return { ok: true };

  const wrap = doc.createElement('div');
  wrap.id = 'debug-panel';
  wrap.style.cssText = [
    'position:fixed', 'left:8px', 'right:8px', 'bottom:8px', 'max-height:38vh', 'overflow:auto',
    'background:rgba(8,6,20,0.94)', 'color:#cfc9ff', 'border:1px solid #4a3fa8', 'border-radius:10px',
    'font:11px/1.45 Consolas,monospace', 'padding:8px', 'z-index:9999', 'display:none',
    'white-space:pre-wrap', 'word-break:break-all',
  ].join(';');

  const bar = doc.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;font:12px system-ui';
  const title = doc.createElement('strong');
  title.textContent = '运行日志';
  const btnCopy = doc.createElement('button');
  btnCopy.textContent = '复制日志';
  btnCopy.style.cssText = 'font:11px system-ui;padding:2px 8px;border-radius:6px;border:1px solid #4a3fa8;background:#1e1a44;color:#cfc9ff';
  const btnClear = doc.createElement('button');
  btnClear.textContent = '清空';
  btnClear.style.cssText = btnCopy.style.cssText;
  const btnClose = doc.createElement('button');
  btnClose.textContent = '关闭';
  btnClose.style.cssText = btnCopy.style.cssText;

  const list = doc.createElement('div');
  bar.appendChild(title); bar.appendChild(btnCopy); bar.appendChild(btnClear); bar.appendChild(btnClose);
  wrap.appendChild(bar); wrap.appendChild(list);
  doc.body.appendChild(wrap);
  panel = { wrap, list };

  btnCopy.onclick = () => {
    const text = exportText();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    else { const ta = doc.createElement('textarea'); ta.value = text; doc.body.appendChild(ta); ta.select(); doc.execCommand('copy'); ta.remove(); }
    info('panel.copy', { lines: buffer.length });
  };
  btnClear.onclick = () => clear();
  btnClose.onclick = () => togglePanel(false);

  const showDebug = typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search);
  if (showDebug) togglePanel(true);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      togglePanel();
    }
  });

  renderPanel();
  return { ok: true };
}

export function togglePanel(force) {
  if (!panel) return { ok: false };
  const show = force === undefined ? panel.wrap.style.display === 'none' : !!force;
  panel.wrap.style.display = show ? 'block' : 'none';
  if (show) renderPanel();
  return { ok: true, visible: show };
}

function renderPanel() {
  if (!panel) return;
  const rows = buffer.slice(-60).map((e) => {
    const color = e.lv === 'error' ? '#ff6b81' : e.lv === 'warn' ? '#ffd166' : e.lv === 'debug' ? '#8b86b8' : '#cfc9ff';
    const data = e.data === undefined ? '' : ' ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    return `<span style="color:#6d66a8">${String(e.t).padStart(6)}ms</span> <span style="color:${color}">${e.event}</span>${escapeText(data)}`;
  });
  panel.list.innerHTML = rows.join('<br>') || '<span style="color:#6d66a8">（暂无日志）</span>';
  panel.wrap.scrollTop = panel.wrap.scrollHeight;
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
