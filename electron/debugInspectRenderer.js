// 调试模式独立检视窗口的渲染脚本(运行在独立 BrowserWindow 中)。
// 通过 window.api 与 主进程/IPC 通信：接收 debug:update 渲染,发送 debug:action 控制窗口。
'use strict';

// ⚠ 注意:不能写顶层 `const api = window.api;` —— contextBridge.exposeInMainWorld('api',…)
// 会把 window.api 定义为不可配置的全局属性,顶层 const/let 同名声明会抛
// 「Identifier 'api' has already been declared」导致整个脚本解析失败。
// 因此这里改用别名 bridge,并尽量直接引用 window.api。
const bridge = window.api;

let current = null;
const body = document.getElementById('dbg-body');
const sub = document.getElementById('dbg-sub');
const copyBtn = document.getElementById('dbg-copy');

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function basename(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

function render(info) {
  current = info;
  if (!info) {
    body.innerHTML = '<div class="dbg-placeholder">将鼠标移到主程序任意组件上，这里会显示它的调试信息。</div>';
    sub.textContent = '';
    return;
  }
  sub.textContent = info.sel || '';
  const kids = (info.children || []).map((c) =>
    `<li><code>${esc(c.sel)}</code>${c.cn ? ` <span class="dbg-cn">${esc(c.cn)}</span>` : ''}</li>`).join('');
  // 源码位置:文件名可悬浮看完整路径、右键 打开目录/编辑文件
  const srcFile = info.file
    ? `<span class="dbg-srcfile" data-file="${esc(info.file)}" data-line="${info.line || 0}"
         title="${esc(info.abs || info.file)}">${esc(basename(info.file))}${info.line ? ':' + info.line : ''}</span>`
    : '';
  body.innerHTML = `
    <div class="dbg-row"><span class="dbg-k">名称</span><code class="dbg-sel">${esc(info.sel)}</code></div>
    <div class="dbg-row"><span class="dbg-k">中文名称</span><span class="dbg-v">${esc(info.cn || '—')}</span></div>
    <div class="dbg-row"><span class="dbg-k">父组件</span>${info.parentSel
      ? `<code>${esc(info.parentSel)}</code>${info.parentCn ? ` <span class="dbg-cn">${esc(info.parentCn)}</span>` : ''}`
      : '<span class="dbg-v">—(顶层)</span>'}</div>
    <div class="dbg-row"><span class="dbg-k">尺寸</span><span class="dbg-v">${info.width} × ${info.height} px</span></div>
    <div class="dbg-row"><span class="dbg-k">子组件</span><span class="dbg-v">${info.childCount} 个</span></div>
    <div class="dbg-children"><ul>${kids || '<li class="dbg-empty">无直接子元素</li>'}</ul></div>
    <div class="dbg-row"><span class="dbg-k">源码位置</span>${srcFile}<span class="dbg-v">${esc(info.src || '—')}</span></div>
    <div class="dbg-row dbg-desc"><span class="dbg-k">介绍</span><span class="dbg-v">${esc(info.desc || '—')}</span></div>
    <div class="dbg-row dbg-path"><span class="dbg-k">DOM 路径</span><code>${esc(info.domPath)}</code></div>
  `;
}

function buildText(info) {
  if (!info) return '';
  const lines = [
    '名称: ' + info.sel,
    '中文名称: ' + (info.cn || '—'),
    '父组件: ' + (info.parentSel ? info.parentSel + (info.parentCn ? ' (' + info.parentCn + ')' : '') : '—(顶层)'),
    '尺寸: ' + info.width + ' × ' + info.height + ' px',
    '子组件: ' + info.childCount + ' 个',
  ];
  (info.children || []).forEach((c) => lines.push('  - ' + c.sel + (c.cn ? ' (' + c.cn + ')' : '')));
  lines.push('源码位置: ' + (info.src || '—'));
  lines.push('介绍: ' + (info.desc || '—'));
  lines.push('DOM 路径: ' + info.domPath);
  return lines.join('\n');
}

function fallbackCopy(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

function copyInfo() {
  if (!current) return;
  const txt = buildText(current);
  const done = () => { copyBtn.textContent = '已复制 ✓'; setTimeout(() => { copyBtn.textContent = '复制信息'; }, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(() => { fallbackCopy(txt); done(); });
  } else {
    fallbackCopy(txt); done();
  }
}

// 主进程转发来的悬停组件信息
if (bridge && bridge.onDebugUpdate) bridge.onDebugUpdate(render);

// 标题栏手动拖拽(JS 方案):不用 -webkit-app-region:drag(部分环境会吞事件却不拖动),
// 改为页面 pointer 事件 + IPC,由主进程按光标屏幕坐标 setPosition,任何环境都可靠。
const titlebar = document.querySelector('.dbg-titlebar');
let dragPointerId = null;

titlebar.addEventListener('pointerdown', (e) => {
  // 仅按钮区不触发拖拽(.dbg-sub 占据标题栏中部,必须可拖)
  if (e.target.closest('.dbg-winbtns')) return;
  if (e.button !== 0) return;
  dragPointerId = e.pointerId;
  try { titlebar.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (bridge && bridge.debugDragStart) bridge.debugDragStart();
  e.preventDefault(); // 防止文本选择等
});

titlebar.addEventListener('pointermove', (e) => {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  if (bridge && bridge.debugDragMove) bridge.debugDragMove();
});

function endDrag(e) {
  if (dragPointerId === null) return;
  if (e && e.pointerId !== dragPointerId) return;
  dragPointerId = null;
  if (bridge && bridge.debugDragEnd) bridge.debugDragEnd();
}
titlebar.addEventListener('pointerup', endDrag);
titlebar.addEventListener('pointercancel', endDrag);

// 标题栏按钮:用 mousedown 触发(避免 click 被拖拽/选择等默认行为干扰)
document.querySelector('.dbg-winbtns').addEventListener('mousedown', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !bridge || !bridge.debugAction) return;
  e.preventDefault();
  bridge.debugAction(b.dataset.act);
});

// 焦点在本窗口时,按一下 Ctrl 键也能暂停/恢复调试信息获取(与主窗口行为一致)。
// 经 IPC 通知主进程转发到主窗口,由主窗口 src/debugInspect.js 执行暂停/恢复。
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Control' || e.repeat || e.shiftKey || e.altKey || e.metaKey) return;
  if (bridge && bridge.debugTogglePause) bridge.debugTogglePause();
});

copyBtn.addEventListener('click', copyInfo);

// ---- 「源码位置」右键菜单:打开目录 / 编辑文件 ----
const ctxMenu = document.getElementById('dbg-ctxmenu');
let ctxFile = null; // 当前右键的文件 { rel, line }

function showCtxMenu(x, y, rel, line) {
  ctxFile = { rel, line };
  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth || 140;
  const mh = ctxMenu.offsetHeight || 70;
  ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 4)) + 'px';
  ctxMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 4)) + 'px';
}

function hideCtxMenu() { ctxMenu.hidden = true; ctxFile = null; }

body.addEventListener('contextmenu', (e) => {
  const sf = e.target.closest('.dbg-srcfile');
  if (sf) {
    e.preventDefault();
    e.stopPropagation();
    showCtxMenu(e.clientX, e.clientY, sf.dataset.file, parseInt(sf.dataset.line || '0', 10) || 0);
    return;
  }
  hideCtxMenu();
});

ctxMenu.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  const item = e.target.closest('[data-act]');
  if (!item || !ctxFile || !bridge || !bridge.debugSourceAction) return;
  bridge.debugSourceAction({ action: item.dataset.act, rel: ctxFile.rel, line: ctxFile.line });
  hideCtxMenu();
});

window.addEventListener('mousedown', (e) => {
  if (!ctxMenu.hidden && !e.target.closest('#dbg-ctxmenu')) hideCtxMenu();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ctxMenu.hidden) hideCtxMenu(); });

// 主进程执行 打开目录/编辑文件 后的结果提示(短暂显示在底部提示栏)
const hintEl = document.getElementById('dbg-hint');
if (bridge && bridge.onDebugSourceResult) {
  bridge.onDebugSourceResult((msg) => {
    if (!msg) return;
    const old = hintEl.textContent;
    hintEl.textContent = '✔ ' + msg;
    setTimeout(() => { if (hintEl.textContent === '✔ ' + msg) hintEl.textContent = old; }, 4000);
  });
}
