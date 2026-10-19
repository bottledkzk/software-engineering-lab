// dev-main.js —— 测试版入口（dev.html 使用）
// 与正式版共用全部玩法/界面模块，差别仅在于：注入运行日志、调试面板与 window.__game。
globalThis.__SKIP_AUTO_BOOT = true;   // 阻止 main.js 自动启动，由本文件统一编排

const main = await import('./main.js');
const dev = await import('./devtools.js');

dev.install({ main });
main.boot();
