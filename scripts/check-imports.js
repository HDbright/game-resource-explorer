// 静态自检:找出 src/*.js 中"调用了 state.js 的导出但没写进 import"的漏网符号。
// Vite/Rollup 不会对未定义的全局标识符报错(运行时才抛 ReferenceError),
// 这类漏导入曾导致侧栏拖拽排序静默失效,故加此脚本在构建前自查。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stateSrc = fs.readFileSync(path.join(root, 'src', 'state.js'), 'utf8');
const exported = [...stateSrc.matchAll(/export\s+(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);

const files = fs.readdirSync(path.join(root, 'src'))
  .filter((f) => f.endsWith('.js') && f !== 'state.js')
  .map((f) => path.join(root, 'src', f));
const pagesDir = path.join(root, 'src', 'pages');
if (fs.existsSync(pagesDir)) {
  for (const f of fs.readdirSync(pagesDir)) {
    if (f.endsWith('.js')) files.push(path.join(pagesDir, f));
  }
}

let bad = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('import {');
  const end = src.indexOf("from './state.js'");
  const endUp = src.indexOf("from '../state.js'");
  const stop = end >= 0 ? end : endUp;
  if (start < 0 || stop < 0) continue;
  const imported = new Set([...src.slice(start, stop).matchAll(/[A-Za-z0-9_$]+/g)].map((m) => m[0]));
  const missing = [];
  for (const name of exported) {
    if (imported.has(name)) continue;
    // 只看"被当函数调用"的形态,且排除 obj.name(...) 这类成员调用
    const re = new RegExp('(^|[^A-Za-z0-9_$.])' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'm');
    if (re.test(src)) missing.push(name);
  }
  if (missing.length) {
    bad += missing.length;
    console.error('[漏导入] ' + path.relative(root, file) + ' → ' + missing.join(', '));
  }
}

if (bad) {
  console.error('\n共 ' + bad + " 处调用了 state.js 的导出但未 import,运行时会抛 ReferenceError。");
  process.exit(1);
}
console.log('导入自检通过:未发现漏导入的 state.js 导出。');
