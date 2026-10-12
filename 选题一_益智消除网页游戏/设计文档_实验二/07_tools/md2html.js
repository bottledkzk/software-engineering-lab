// md2html.js —— 将本项目的 Markdown 文档转换为适合 Word 导入的 HTML
// 用法: node md2html.js <input.md> <output.html>
const fs = require('fs');

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error('usage: node md2html.js <input.md> <output.html>');
  process.exit(1);
}

const md = fs.readFileSync(input, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableSep(line) {
  return typeof line === 'string' && /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');
}

const out = [];
let i = 0;
let inCode = false;
let codeBuf = [];
let listType = null;
let paraBuf = [];
let title = '';

function closeList() {
  if (listType) {
    out.push(listType === 'ul' ? '</ul>' : '</ol>');
    listType = null;
  }
}
function flushPara() {
  if (paraBuf.length) {
    out.push('<p>' + inline(paraBuf.join(' ')) + '</p>');
    paraBuf = [];
  }
}

while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();

  // 代码块
  if (/^```/.test(trimmed)) {
    if (!inCode) {
      inCode = true;
      codeBuf = [];
    } else {
      inCode = false;
      out.push('<pre>' + esc(codeBuf.join('\n')) + '</pre>');
    }
    i++;
    continue;
  }
  if (inCode) {
    codeBuf.push(line);
    i++;
    continue;
  }

  // 表格
  if (/^\s*\|/.test(line) && isTableSep(lines[i + 1])) {
    flushPara();
    closeList();
    const header = splitRow(line);
    i += 2;
    const rows = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      rows.push(splitRow(lines[i]));
      i++;
    }
    out.push(
      '<table><thead><tr>' +
        header.map((c) => '<th>' + inline(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows
          .map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
          .join('') +
        '</tbody></table>'
    );
    continue;
  }

  // 标题
  const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (h) {
    flushPara();
    closeList();
    const lvl = h[1].length;
    const text = h[2];
    if (lvl === 1 && !title) title = text;
    out.push(`<h${lvl}>${inline(text)}</h${lvl}>`);
    i++;
    continue;
  }

  // 分隔线
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
    flushPara();
    closeList();
    out.push('<hr/>');
    i++;
    continue;
  }

  // 引用块
  if (/^>\s?/.test(line)) {
    flushPara();
    closeList();
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      buf.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }
    out.push(
      '<blockquote>' +
        buf.map((b) => (b.trim() === '' ? '<p>&nbsp;</p>' : '<p>' + inline(b) + '</p>')).join('') +
        '</blockquote>'
    );
    continue;
  }

  // 无序列表
  if (/^\s*[-*]\s+/.test(line)) {
    flushPara();
    if (listType !== 'ul') {
      closeList();
      out.push('<ul>');
      listType = 'ul';
    }
    out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
    i++;
    continue;
  }

  // 有序列表
  if (/^\s*\d+[.)]\s+/.test(line)) {
    flushPara();
    if (listType !== 'ol') {
      closeList();
      out.push('<ol>');
      listType = 'ol';
    }
    out.push('<li>' + inline(line.replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
    i++;
    continue;
  }

  if (trimmed === '') {
    flushPara();
    closeList();
    i++;
    continue;
  }

  paraBuf.push(trimmed);
  i++;
}
flushPara();
closeList();

const css = `
body { font-family: "微软雅黑","Microsoft YaHei",SimSun,serif; font-size: 10.5pt; line-height: 1.6; color: #1a1a1a; }
h1 { font-size: 18pt; text-align: center; margin: 0 0 14pt 0; }
h2 { font-size: 14pt; margin: 16pt 0 8pt 0; border-bottom: 1px solid #bfbfbf; padding-bottom: 3pt; }
h3 { font-size: 12pt; margin: 12pt 0 6pt 0; }
h4 { font-size: 11pt; margin: 10pt 0 4pt 0; }
p { margin: 0 0 6pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt 0; }
th, td { border: 1px solid #808080; padding: 4pt 5pt; font-size: 9.5pt; vertical-align: top; }
th { background-color: #eaeaea; font-weight: bold; }
blockquote { margin: 6pt 0 8pt 0; padding: 0 0 0 10pt; border-left: 3px solid #b0b0b0; color: #404040; }
blockquote p { margin: 0 0 4pt 0; font-size: 10pt; }
code { font-family: Consolas,"Courier New",SimSun,monospace; font-size: 9.5pt; background-color: #f2f2f2; }
pre { font-family: Consolas,"Courier New",SimSun,monospace; font-size: 9pt; background-color: #f5f5f5;
      border: 1px solid #d0d0d0; padding: 6pt; white-space: pre-wrap; }
hr { border: none; border-top: 1px solid #b0b0b0; margin: 10pt 0; }
ul, ol { margin: 0 0 8pt 0; padding-left: 20pt; }
li { margin: 0 0 3pt 0; }
a { color: #0645ad; }
`;

const html =
  '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8"/>\n<title>' +
  esc(title || '文档') +
  '</title>\n<style>' +
  css +
  '</style>\n</head>\n<body>\n' +
  out.join('\n') +
  '\n</body>\n</html>\n';

fs.writeFileSync(output, html, 'utf8');
console.log('OK ' + output + ' -> ' + out.length + ' blocks, title=' + (title || '(none)'));
