// 调试模式：顶栏「🐞 调试」按钮开启后，鼠标悬停任意组件即在独立弹窗中
// 展示：名称、中文名称、父组件、尺寸、子组件列表、源码位置、组件相关介绍、DOM 路径。
// 弹窗为独立窗口：可拖拽移动、可调整大小、可最小化/还原/关闭，信息可复制。
// 调试模式下按一下 Ctrl 键可暂停/恢复信息获取；暂停时按钮出现 ⏸ 提示，且已获取的
// 调试信息保持不动，方便鼠标移入调试窗口进行操作与复制。
import { toast } from './dialogs.js';

let debugOn = false;
let paused = false;   // 暂停信息获取（按 Ctrl 切换），暂停时弹窗内容冻结
let rafPending = false;
let lastEvt = null;
let hovered = null;
let srcRoot = '';     // 项目源码根目录(settings.sourceRoot 或应用目录),用于拼接源码绝对路径

function joinPath(root, rel) {
  if (!root) return rel;
  const r = String(root).replace(/[\\/]+$/, '');
  return r + '/' + String(rel).replace(/^[\\/]+/, '');
}

// 获取项目源码根目录(主进程按 settings.sourceRoot 或 app.getAppPath() 计算)
function fetchSrcRoot() {
  try {
    if (window.api && window.api.debugGetEnv) {
      window.api.debugGetEnv().then((env) => { if (env && env.root) srcRoot = env.root; }).catch(() => { /* ignore */ });
    }
  } catch (e) { /* ignore */ }
}

// 组件元数据表：按 id 兜底提供 中文名/介绍/源码位置。
// 优先级：元素自身 data-cn/data-desc/data-src > 祖先链路上的 data-* > 本表按 id 兜底。
// file 为相对「项目源码根目录」的路径(settings.sourceRoot,默认应用目录),line 为源码行号,
// 供调试窗口「源码位置」右键 打开目录 / 编辑文件(Notepad++ 定位行号) 使用。
const COMP_META = {
  'main':             { cn: '主区域',               desc: '侧边栏 + 内容面板整体容器',                       src: 'index.html:29',               file: 'index.html', line: 29 },
  'sidebar':          { cn: '侧边栏',               desc: '左侧资源分类树容器，展示各资源类型下的分类目录',     src: 'ui.js → renderTree',         file: 'src/ui.js', line: 562 },
  'resource-tabs':    { cn: '资源类型标签栏',         desc: '动画/图片/音频/3D 切换，决定主区展示的资源分组',   src: 'index.html:67',               file: 'index.html', line: 67 },
  'cat-tree':         { cn: '分类树',               desc: '当前资源类型下的分类目录列表',                     src: 'ui.js → renderTree',         file: 'src/ui.js', line: 562 },
  'content-panel':    { cn: '主内容面板',            desc: '承载标签页条与各个页面容器',                       src: 'index.html:76',               file: 'index.html', line: 76 },
  'tab-strip':        { cn: '主区标签条',            desc: '多标签：资源/功能页标签，可切换或关闭',            src: 'index.html:78',               file: 'index.html', line: 78 },
  'page-home':        { cn: '资源统计主页',          desc: '各类资源统计与目录快捷入口',                       src: 'homePage.js → renderHomePage', file: 'src/pages/homePage.js', line: 40 },
  'page-audio-home':  { cn: '音频播放器主页',        desc: '分类目录作为播放列表 + 自建播放列表 + 播放器',      src: 'ui.js → showPage(audio-home)', file: 'src/ui.js', line: 3317 },
  'page-folder':      { cn: '目录列表页',            desc: '某目录下的资源总列表 + 统计 + 视图切换 + 排序',     src: 'folderPage.js → renderFolderPage', file: 'src/pages/folderPage.js', line: 96 },
  'page-preview':     { cn: '资源预览页',            desc: '动画播放器 / 图片查看器 / 音频播放器',              src: 'ui.js → showPreviewPage',    file: 'src/ui.js', line: 3760 },
  'preview-body':     { cn: '预览画布区',            desc: '动画/图片预览画布容器',                           src: 'index.html:109',              file: 'index.html', line: 109 },
  'pv-canvas-wrap':   { cn: '预览画布包装',          desc: '承载 WebGL canvas 的容器(flex:1)',                src: 'index.html:110',              file: 'index.html', line: 110 },
  'page-toolbox':     { cn: '资源工具箱页',          desc: '格式转换 / 图片编辑 / FGUI 导出等工具入口',        src: 'toolboxPage.js → renderToolboxPage', file: 'src/pages/toolboxPage.js', line: 12 },
  'page-scene':       { cn: '游戏场景管理页',        desc: '场景目录管理、FGUI 包预览与导入',                  src: 'scenePage.js → renderSceneHome', file: 'src/pages/scenePage.js', line: 65 },
  'page-fgui-editor': { cn: 'FGUI 编辑器页',         desc: 'FGUI 包可视化编辑(组件树/画布/属性)',              src: 'fguiEditorPage.js → renderFguiEditorPage', file: 'src/pages/fguiEditorPage.js', line: 17 },
  'page-settings':    { cn: '系统设置页',            desc: '应用设置(分组/同步/开发者调试等)',                  src: 'settingsPage.js → renderSettingsPage', file: 'src/pages/settingsPage.js', line: 23 },
  'page-webgame':     { cn: '网络资源抓取页',        desc: '内嵌浏览器抓取网络资源(多标签)',                    src: 'webGamePage.js → renderWebGamePage', file: 'src/pages/webGamePage.js', line: 57 },
  'page-api':         { cn: 'API 管理页',           desc: '开发工具箱 API 管理',                             src: 'apiPage.js → renderApiPage',  file: 'src/pages/apiPage.js', line: 33 },
  'toolbar-actions':  { cn: '顶栏操作区',            desc: '搜索框、添加资源、调试、设置等顶栏按钮',             src: 'index.html:47',               file: 'index.html', line: 47 },
  'search-box':       { cn: '搜索框',               desc: '按名称/备注搜索资源',                             src: 'index.html:52',               file: 'index.html', line: 52 },
  'cdp-ind':          { cn: 'DevTools 调试状态指示器', desc: '显示 Chrome DevTools 远程调试服务状态',          src: 'index.html:48',               file: 'index.html', line: 48 },
  'audio-mini':       { cn: '音频迷你播放条',        desc: '后台播放时悬停在顶部的迷你控制条',                  src: 'index.html:39',               file: 'index.html', line: 39 },
};

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function selOf(el) {
  if (!el) return '';
  let s = el.tagName ? el.tagName.toLowerCase() : '';
  if (el.id) s += '#' + el.id;
  if (el.classList && el.classList.length) {
    s += '.' + Array.from(el.classList).slice(0, 3).join('.');
  }
  return s;
}

function domPath(el) {
  const parts = [];
  let n = el;
  let guard = 0;
  while (n && n.nodeType === 1 && n !== document.body && guard++ < 8) {
    parts.unshift(selOf(n));
    n = n.parentElement;
  }
  return parts.join(' > ');
}

// 沿祖先链路(含自身)收集 中文名/介绍/源码位置/源码文件/行号
function lookupMeta(el) {
  let cn = null, desc = null, src = null, file = null, line = null;
  let node = el;
  while (node && node !== document.body) {
    if (node.dataset) {
      if (cn == null && node.dataset.cn) cn = node.dataset.cn;
      if (desc == null && node.dataset.desc) desc = node.dataset.desc;
      if (src == null && node.dataset.src) src = node.dataset.src;
      if (file == null && node.dataset.file) file = node.dataset.file;
      if (line == null && node.dataset.line) line = parseInt(node.dataset.line, 10) || null;
    }
    if (node.id && COMP_META[node.id]) {
      const m = COMP_META[node.id];
      if (cn == null && m.cn) cn = m.cn;
      if (desc == null && m.desc) desc = m.desc;
      if (src == null && m.src) src = m.src;
      if (file == null && m.file) file = m.file;
      if (line == null && m.line) line = m.line;
    }
    node = node.parentElement;
  }
  return { cn, desc, src, file, line };
}

function parentInfo(el) {
  let p = el.parentElement;
  while (p && p !== document.body) {
    if (p.id || (p.dataset && p.dataset.cn)) {
      return { sel: selOf(p), cn: (p.dataset && p.dataset.cn) || (COMP_META[p.id] && COMP_META[p.id].cn) || null };
    }
    p = p.parentElement;
  }
  return null;
}

function childrenInfo(el) {
  const kids = Array.from(el.children || []);
  const list = kids.slice(0, 15).map((c) => ({
    sel: selOf(c),
    cn: (c.dataset && c.dataset.cn) || (c.id && COMP_META[c.id] && COMP_META[c.id].cn) || null,
  }));
  return { count: kids.length, list };
}

// 把悬停元素计算为可序列化信息对象，经 IPC 发给主进程 → 转发到独立调试窗口渲染
function computeInfo(el) {
  const rect = el.getBoundingClientRect();
  const meta = lookupMeta(el);
  const par = parentInfo(el);
  const kids = childrenInfo(el);
  const line = meta.line || (COMP_META[el.id] && COMP_META[el.id].line) || null;
  const file = meta.file || (COMP_META[el.id] && COMP_META[el.id].file) || null;
  return {
    sel: selOf(el),
    cn: meta.cn || (COMP_META[el.id] && COMP_META[el.id].cn) || '—',
    parentSel: par ? par.sel : null,
    parentCn: par ? par.cn : null,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    childCount: kids.count,
    children: kids.list,
    src: meta.src || (COMP_META[el.id] && COMP_META[el.id].src) || '—',
    desc: meta.desc || (COMP_META[el.id] && COMP_META[el.id].desc) || '—',
    domPath: domPath(el),
    file, line,
    abs: (file && srcRoot) ? joinPath(srcRoot, file) : null,
  };
}

function onMove(e) {
  lastEvt = e;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (paused) return; // 暂停时冻结：不更新信息、不改变高亮，弹窗内容保持不变
    const ev = lastEvt;
    if (!ev) return;
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!t || !t.tagName) return;
    if (t === hovered) return;
    if (hovered) hovered.classList.remove('dbg-hover');
    hovered = t;
    t.classList.add('dbg-hover');
    // 调试窗口是独立 OS 窗口,不会触发主窗口 mousemove,故无需过滤自身
    if (window.api && window.api.debugUpdate) window.api.debugUpdate(computeInfo(t));
  });
}

function clearHover() {
  if (hovered) {
    hovered.classList.remove('dbg-hover');
    hovered = null;
  }
}

function enable() {
  annotateComponents();
  document.addEventListener('mousemove', onMove, true);
  document.body.classList.add('debug-mode');
  if (window.api && window.api.debugOpen) window.api.debugOpen();
  debugOn = true;
}

function disable() {
  document.removeEventListener('mousemove', onMove, true);
  document.body.classList.remove('debug-mode');
  clearHover();
  if (window.api && window.api.debugClose) window.api.debugClose();
  debugOn = false;
  setPaused(false); // 退出调试模式时一并清除暂停状态与按钮图标
}

// 暂停/恢复调试信息获取：暂停时弹窗内容冻结，按钮显示 ⏸
function setPaused(p) {
  if (!debugOn && p) return; // 非调试模式下不允许进入暂停
  paused = p;
  const btn = document.getElementById('btn-debug');
  if (btn) btn.classList.toggle('paused', p);
  try {
    toast(p ? '调试信息获取已暂停：可移动鼠标到调试窗口操作/复制' : '调试信息获取已恢复', p ? 'warn' : 'ok', 1800);
  } catch (e) { /* ignore */ }
}

export function isPaused() {
  return paused;
}

// 把元数据表一次性打进主要容器，使内部动态元素也能继承祖先的中文名/源码信息
function annotateComponents() {
  Object.entries(COMP_META).forEach(([id, m]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (m.cn && !el.dataset.cn) el.dataset.cn = m.cn;
    if (m.desc && !el.dataset.desc) el.dataset.desc = m.desc;
    if (m.src && !el.dataset.src) el.dataset.src = m.src;
    if (m.file && !el.dataset.file) el.dataset.file = m.file;
    if (m.line && !el.dataset.line) el.dataset.line = String(m.line);
  });
}

export function isDebugOn() {
  return debugOn;
}

export function toggleDebugMode() {
  if (debugOn) disable();
  else enable();
  return debugOn;
}

export function initDebugInspect() {
  // 快捷键 Ctrl+Shift+D 切换调试模式；Esc 关闭
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      const on = toggleDebugMode();
      const btn = document.getElementById('btn-debug');
      if (btn) btn.classList.toggle('active', on);
    } else if (e.key === 'Escape' && debugOn) {
      disable();
      const btn = document.getElementById('btn-debug');
      if (btn) btn.classList.remove('active');
    }
  });
  // 调试模式下按一下 Ctrl 键：暂停/恢复调试信息获取（e.repeat 忽略长按自动重复；
  // 仅在无其它修饰键时触发，避免与 Ctrl+Shift+D 切换调试模式冲突）
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !e.repeat && !e.shiftKey && !e.altKey && !e.metaKey && debugOn) {
      setPaused(!paused);
    }
  });
  // 用户在调试窗口点「×」关闭 → 同步退出调试模式(清理监听/高亮/按钮 active 状态)
  if (window.api && window.api.onDebugUserClosed) {
    window.api.onDebugUserClosed(() => {
      if (!debugOn) return;
      disable();
      const btn = document.getElementById('btn-debug');
      if (btn) btn.classList.remove('active');
    });
  }
  // 焦点在调试窗口时按 Ctrl → 同样暂停/恢复信息获取(与主窗口内 Ctrl 行为一致)
  if (window.api && window.api.onDebugTogglePause) {
    window.api.onDebugTogglePause(() => {
      if (!debugOn) return;
      setPaused(!paused);
    });
  }
  // 页面切换后重新标注(部分页面容器为静态,这里兜底再标注一次)
  annotateComponents();
  fetchSrcRoot(); // 获取项目源码根目录(供「源码位置」拼接绝对路径)
}
