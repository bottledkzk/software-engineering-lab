#!/usr/bin/env node
// make-dev-page.mjs —— 由正式版 index.html 生成测试版 dev.html
// 差异只有两处：入口脚本换成 src/dev-main.js（注入日志/调试面板/__game）、标题加"测试版"并加角标。
// 用法：node tools/make-dev-page.mjs [game目录]
// 同时导出 renderDevHtml，供 tests/wiring.test.mjs 校验 dev.html 与 index.html 保持同步。

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';

const BADGE = `<div id="dev-badge" aria-hidden="true" style="position:fixed;top:6px;left:6px;z-index:9998;padding:2px 8px;border-radius:8px;background:rgba(124,108,255,0.9);color:#fff;font:11px/1.6 system-ui;pointer-events:none;letter-spacing:0.06em">测试版</div>`;

/** 纯函数：正式版 HTML → 测试版 HTML */
export function renderDevHtml(indexHtml) {
  let out = String(indexHtml);
  const before = out;
  out = out.replace('<script type="module" src="src/main.js"></script>', '<script type="module" src="src/dev-main.js"></script>');
  if (out === before) throw new Error('未找到正式版入口 <script type="module" src="src/main.js">，无法生成测试版');
  out = out.replace('<title>星尘消除</title>', '<title>星尘消除（测试版）</title>');
  out = out.replace('</body>', `${BADGE}\n</body>`);
  return out;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const gameDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'game'));
  const index = fs.readFileSync(path.join(gameDir, 'index.html'), 'utf8');
  const dev = renderDevHtml(index);
  fs.writeFileSync(path.join(gameDir, 'dev.html'), dev, 'utf8');
  console.log('已生成', path.join(gameDir, 'dev.html'), `(${dev.length} 字符)`);
}
