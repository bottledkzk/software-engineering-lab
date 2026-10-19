// log.js —— 日志门面（正式版零副作用）
// 正式版：所有调用为空实现，不写 localStorage、不挂面板、不暴露全局对象。
// 测试版：由 src/dev-main.js 通过 attach() 注入 src/logger.js 的真实实现。

const noop = () => undefined;
let impl = null;

export const LEVEL = { debug: 0, info: 1, warn: 2, error: 3 };

/** 注入/替换真实日志实现（仅测试版调用） */
export function attach(next) {
  impl = next || null;
  return { ok: !!impl };
}

export function isEnabled() {
  return !!impl;
}

export function debug(event, data) { return impl && impl.debug ? impl.debug(event, data) : noop(); }
export function info(event, data) { return impl && impl.info ? impl.info(event, data) : noop(); }
export function warn(event, data) { return impl && impl.warn ? impl.warn(event, data) : noop(); }
export function error(event, data) { return impl && impl.error ? impl.error(event, data) : noop(); }

/** 计时：正式版返回一个空函数，避免任何额外开销 */
export function time(event, data) {
  if (!impl || typeof impl.time !== 'function') return noop;
  return impl.time(event, data);
}

export function getLogs() {
  return impl && typeof impl.getLogs === 'function' ? impl.getLogs() : [];
}

export function exportText() {
  return impl && typeof impl.exportText === 'function' ? impl.exportText() : '';
}
