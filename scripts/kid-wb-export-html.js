'use strict';
/**
 * 从 src/pages/kidWorkspacePage.js 生成独立单文件预览 HTML(浏览器可直接打开):
 * - 提取内联 CSS 常量 → <style>
 * - 移除 import/export → 内联到 <script>(toast/confirmDialog 用最小实现替换)
 * - 纯浏览器兼容:导出走 Blob 下载,导入走 <input type=file>
 * 产物: docs/kid-workspace-preview.html
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'pages', 'kidWorkspacePage.js');
const OUT = path.join(__dirname, '..', 'docs', 'kid-workspace-preview.html');
const src = fs.readFileSync(SRC, 'utf8');

// 1) 提取 CSS 常量
const cssMatch = src.match(/const CSS = `([\s\S]*?)`;/);
if (!cssMatch) { console.error('CSS 提取失败'); process.exit(1); }
const css = cssMatch[1];

// 2) 移除 import 行
let js = src.replace(/^import[^\n]*\n/gm, '');

// 3) 移除 export 关键字(仅模块导出的函数定义处)
js = js.replace(/export function /g, 'function ');

// 4) 最小 toast / confirmDialog 实现(浏览器版,样式复用 kid-*)
const miniDialog = `
// ---- 最小化浏览器版 toast / confirmDialog(替代 dialogs.js) ----
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'kid-toast-ok';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function confirmDialog(o) {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  box.style.maxWidth = '340px';
  box.innerHTML = '<div class="kid-modal-title" style="margin-bottom:10px">' + (o.title || '') + '</div>' +
    '<div style="font-size:14px;color:#5b6172;line-height:1.6">' + (o.message || '') + '</div>' +
    '<div class="kid-modal-actions"><button class="kid-btn" data-cd="no">取消</button><button class="kid-btn ' + (o.danger ? 'red' : 'primary') + '" data-cd="yes">' + (o.okText || '确定') + '</button></div>';
  box.querySelector('[data-cd="no"]').addEventListener('click', () => ov.remove());
  box.querySelector('[data-cd="yes"]').addEventListener('click', () => { ov.remove(); if (o.onOk) o.onOk(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}
`;

// 5) 启动调用
const boot = `
// ---- 启动 ----
(function () {
  const host = document.getElementById('kid-app');
  renderKidWorkspaceTool(host);
})();
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>得乐学苑 · 预览</title>
<style>
html,body{margin:0;padding:0;background:#eef2ff}
#kid-app{min-height:100vh}
${css}
</style>
</head>
<body>
<div id="kid-app"></div>
<script>
${miniDialog}
${js}
${boot}
<\/script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('预览已生成: ' + OUT + ' (' + Math.round(html.length / 1024) + ' KB)');
