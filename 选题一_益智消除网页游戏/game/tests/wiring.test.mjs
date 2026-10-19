// wiring.test.mjs —— 页面接线静态校验（不依赖浏览器）
// 校验内容：① index.html 的 id 集合 ⊇ ui.js/main.js 引用的 id；
//          ② 页面引用的 css/js 与模块 import 路径均存在；
//          ③ sw.js 预缓存清单中的文件均存在。
// 运行：node tests/wiring.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, '..');

function read(rel) { return fs.readFileSync(path.join(gameDir, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(gameDir, rel)); }

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}

console.log('=== 页面与模块接线 ===');
const html = read('index.html');
const uiSrc = read('src/ui.js');
const mainSrc = read('src/main.js');
const swSrc = read('sw.js');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// ① ui.js 的 q('id') 与 getElementById('id')；main.js 的 getElementById('id')
const refs = new Set();
for (const m of uiSrc.matchAll(/\bq\('([^']+)'\)/g)) refs.add(m[1]);
for (const m of [...uiSrc.matchAll(/getElementById\('([^']+)'\)/g), ...mainSrc.matchAll(/getElementById\('([^']+)'\)/g)]) refs.add(m[1]);

const missingIds = [...refs].filter((id) => !htmlIds.has(id));
check('引用的元素 id 全部存在于 index.html', missingIds.length === 0, missingIds.length ? '缺失: ' + missingIds.join(', ') : `共核对 ${refs.size} 个 id`);
check('页面包含 6 个页面容器', ['page-home', 'page-levels', 'page-play', 'page-result', 'page-rank', 'page-settings'].every((id) => htmlIds.has(id)));
check('关键交互元素齐备（棋盘/道具/引导/横幅/弹窗）',
  ['play-board', 'item-shuffle', 'item-hammer', 'item-steps', 'guide', 'guide-next', 'banner', 'modal', 'modal-ok'].every((id) => htmlIds.has(id)));
check('入口以 module script 加载 src/main.js', /<script[^>]+type="module"[^>]+src="src\/main\.js"/.test(html));

// ② 页面引用与 import 路径（动态扫描 src/ 下全部模块，避免新增文件被漏检）
const srcFiles = fs.readdirSync(path.join(gameDir, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f);
const importFiles = [];
for (const file of srcFiles) {
  const src = read(file);
  for (const m of src.matchAll(/from\s+'\.\/([^']+)'/g)) importFiles.push({ from: file, to: 'src/' + m[1] });
}
const badImports = importFiles.filter((i) => !exists(i.to));
check('所有模块 import 路径存在', badImports.length === 0, badImports.length ? JSON.stringify(badImports) : `共 ${srcFiles.length} 个模块 / ${importFiles.length} 条 import`);

// ③ Service Worker 预缓存清单
const pre = swSrc.match(/const PRECACHE = \[([\s\S]*?)\];/);
const precache = pre ? [...pre[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const badPre = precache.filter((p) => p !== './' && !exists(p.replace(/^\.\//, '')));
check('sw.js 预缓存清单文件均存在', badPre.length === 0, badPre.length ? '缺失: ' + badPre.join(', ') : `共 ${precache.length} 项`);

// 传递依赖闭包：从入口出发能到达的模块必须全部预缓存（离线可用）
const entry = 'src/main.js';
const closure = new Set([entry]);
const queue = [entry];
while (queue.length) {
  const file = queue.shift();
  for (const m of read(file).matchAll(/from\s+'\.\/([^']+)'/g)) {
    const target = 'src/' + m[1];
    if (!closure.has(target) && exists(target)) { closure.add(target); queue.push(target); }
  }
}
const notCached = [...closure].filter((f) => !precache.includes('./' + f));
check('预缓存覆盖全部运行期模块（传递依赖闭包）', notCached.length === 0,
  notCached.length ? '缺失: ' + notCached.join(', ') : `${closure.size} 个模块全部命中`);
check('入口与样式已在预缓存', ['index.html', 'styles.css'].every((f) => precache.includes('./' + f)));

// ④ 浏览器入口守卫：以"能否在 Node 中导入"作为真实判据（比正则更可靠）
let importOk = true, importErr = '';
try {
  await import('../src/ui.js');
  await import('../src/audio.js');
  await import('../src/main.js');
} catch (e) {
  importOk = false;
  importErr = e && e.message ? e.message : String(e);
}
check('浏览器模块可在 Node 中安全导入（无顶层 DOM 依赖）', importOk, importErr);

console.log(`\n接线校验：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
