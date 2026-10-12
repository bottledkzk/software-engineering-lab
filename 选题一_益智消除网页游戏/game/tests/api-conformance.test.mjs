// api-conformance.test.mjs —— 《01_设计文档》§6.1 接口清单 ↔ 代码导出符号 自动比对
// 目的：落实平台建议"保留接口清单与代码导出符号的自动比对（纳入 TEST-09 门禁）"，
//      防止"文档声明了接口、代码里不存在"或改名后文档滞后。
// 说明：设计文档不在包内时自动跳过（如单独分发 05_game_源码）。
// 运行：node tests/api-conformance.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, '..');
const docPath = path.resolve(gameDir, '..', '设计文档_实验二', '01_设计文档.md');

if (!fs.existsSync(docPath)) {
  console.log('⚠️  未找到设计文档（' + docPath + '），跳过接口一致性比对。');
  process.exit(0);
}

const doc = fs.readFileSync(docPath, 'utf8');
const lines = doc.split(/\r?\n/);

const moduleFiles = ['src/config.js', 'src/score.js', 'src/levels.js', 'src/board.js', 'src/storage.js', 'src/audio.js', 'src/ui.js', 'src/main.js', 'sw.js'];
const sources = {};
for (const f of moduleFiles) {
  const p = path.join(gameDir, f);
  sources[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/** 从「模块 → API 编号对照表」解析 接口编号 → 模块文件 的权威映射 */
const idToModule = {};
{
  let inMap = false;
  for (const line of lines) {
    if (line.includes('模块 → API 编号对照表')) { inMap = true; continue; }
    if (inMap && /^##\s/.test(line)) break;
    if (!inMap) continue;
    const m = line.match(/^\|\s*MOD-(\d+)\s*`([^`]+\.js)`\s*\|[^|]*\|([^|]*)\|/);
    if (!m) continue;
    const file = m[2].startsWith('src/') ? m[2] : 'src/' + m[2];
    const ids = new Set();
    for (const rm of m[3].matchAll(/API-(\d+)\s*~\s*API-(\d+)/g)) {
      for (let i = Number(rm[1]); i <= Number(rm[2]); i++) ids.add('API-' + i);   // 展开区间写法
    }
    for (const sm of m[3].matchAll(/API-(\d+)/g)) ids.add('API-' + sm[1]);
    for (const id of ids) idToModule[id] = file;
  }
}

/** 由签名推断目标模块与符号名（依据《01_设计文档》§6.1 的命名约定） */
function target(sig) {
  const s = sig.trim();
  const head = s.split('(')[0].trim();
  if (head.startsWith('game.')) return { file: 'src/main.js', name: head.slice(5), kind: 'export' };
  if (head.startsWith('audio.')) return { file: 'src/audio.js', name: head.slice(6), kind: 'export' };
  if (head.startsWith('ui.')) return { file: 'src/ui.js', name: head.slice(3), kind: 'export' };
  if (head.startsWith('storage.')) return { file: 'src/storage.js', name: head.slice(8), kind: 'method' };
  if (head.startsWith('sw:')) return { file: 'sw.js', name: head.slice(3), kind: 'event' };
  return { file: null, name: head, kind: 'export' };   // 由对照表/表头推断模块
}

/** 从行文本中解析当前模块文件（**MOD-04 `src/board.js` ...**） */
function moduleFromHeading(line) {
  const m = line.match(/MOD-\d+[^`]*`([^`]+\.js)`/);
  if (!m) return null;
  const name = m[1];
  return name.startsWith('src/') || name === 'sw.js' ? name : 'src/' + name;
}

const entries = [];
let currentModule = null;
for (const line of lines) {
  const heading = moduleFromHeading(line);
  if (heading) currentModule = heading;
  const row = line.match(/^\|\s*(API-\d+)\s*\|\s*`([^`]+)`/);
  if (row) entries.push({ id: row[1], sig: row[2], module: currentModule });
}

let pass = 0;
const missing = [];
const byModule = {};

for (const e of entries) {
  const t = target(e.sig);
  const file = t.file || idToModule[e.id] || e.module;
  if (!file || !sources[file]) { missing.push(`${e.id} ${e.sig} → 无法确定目标模块`); continue; }
  const src = sources[file];
  let ok = false;
  if (t.kind === 'export') {
    ok = new RegExp(`export\\s+(async\\s+)?(function|const|let)\\s+${t.name}\\b`).test(src);
  } else if (t.kind === 'method') {
    ok = new RegExp(`\\b${t.name}\\s*\\(`).test(src);
  } else if (t.kind === 'event') {
    ok = new RegExp(`addEventListener\\(['"]${t.name}['"]`).test(src);
  }
  if (ok) { pass++; byModule[file] = (byModule[file] || 0) + 1; }
  else missing.push(`${e.id} \`${e.sig}\` → ${file} 未找到 ${t.kind === 'export' ? '导出符号 ' : ''}${t.name}`);
}

console.log('=== 接口清单 ↔ 代码导出符号 一致性 ===');
console.log(`  文档 §6.1 解析到接口条目：${entries.length} 条`);
for (const [file, n] of Object.entries(byModule)) console.log(`    ${file}: ${n} 条已匹配`);
console.log(`  匹配成功：${pass} 条`);
if (missing.length) {
  console.log(`  未匹配：${missing.length} 条`);
  for (const m of missing) console.log('    ❌ ' + m);
} else {
  console.log('  ✅ 全部匹配（无声明了但代码中不存在的接口）');
}

// 反向检查：模块导出但文档未编号的"对外接口"提醒（仅提示，不判失败）
const warn = [];
for (const f of ['src/audio.js', 'src/ui.js']) {
  const names = [...sources[f].matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/g)].map((m) => m[1]);
  for (const n of names) {
    if (!entries.some((e) => target(e.sig).name === n && (target(e.sig).file === f))) warn.push(`${f}: ${n}`);
  }
}
if (warn.length) {
  console.log('\n  ℹ️  以下导出未在 §6.1 编号（内部工具函数，若对外使用需补编号）：');
  for (const w of warn) console.log('    · ' + w);
}

console.log(`\n接口一致性断言：通过 ${pass} 条，未匹配 ${missing.length} 条`);
process.exit(missing.length === 0 ? 0 : 1);
