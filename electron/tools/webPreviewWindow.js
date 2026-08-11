'use strict';
/**
 * 资源悬浮预览 —— 独立窗口(像 DevTools detach 一样脱离主窗口)。
 * - 解决「DOM 浮层无法覆盖原生 WebContentsView」的根本问题:预览是独立 BrowserWindow,
 *   天然悬浮在所有窗口之上, 可自由拖到浏览器区上方, 无遮挡/无黑屏/无冻结。
 * - 交互:主窗口悬停资源行 → show 显示并推送内容(首次右上角, 之后恢复上次位置, 不随鼠标移动);
 *   移出(未置顶)自动隐藏;点击进入窗口自动置顶常驻;窗口内 📌 按钮切换 alwaysOnTop。
 */
const { BrowserWindow, screen, app } = require('electron');
const path = require('path');
const fs = require('fs');

// 预览窗位置/大小持久化(userData/web-preview-state.json), 重启后恢复
let stateTimer = null;
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'web-preview-state.json'), 'utf8')) || {};
  } catch (e) { return {}; }
}
function saveState(s) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'web-preview-state.json'), JSON.stringify(s)); } catch (e) { /* ignore */ }
  }, 300);
}

let win = null;
let ready = false;
let notifyApp = null; // (event: 'closed'|'pin', value?) => void  主窗口回调
let lastPos = null;   // 记住上次位置(拖动后/隐藏时), 再显示时恢复, 不随鼠标移动

function ensure() {
  if (win && !win.isDestroyed()) return win;
  const st = loadState();
  if (st.x != null && st.y != null) lastPos = [st.x, st.y]; // 恢复上次位置(手动预览/无鼠标时使用)
  win = new BrowserWindow({
    width: st.width || 420,   // 恢复上次大小(用户调整过)
    height: st.height || 360,
    minWidth: 260,
    minHeight: 180,
    title: '资源预览',
    backgroundColor: '#23262e',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../previewPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 共享网页抓取分区 session(persist:webgame): 预览窗内 <audio>/<video>/<img> 直连外链
      // 时携带抓取页的 cookie/登录态, 避免无登录态/防盗链资源 403
      partition: 'persist:webgame',
    },
  });
  ready = false;
  win.loadFile(path.join(__dirname, '../../dist/preview-window.html'));
  win.webContents.on('did-finish-load', () => { ready = true; });
  // 位置/大小变化即持久化(resize/move/close 节流写文件)
  const persist = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    saveState({ x: b.x, y: b.y, width: b.width, height: b.height });
  };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', persist);
  win.on('closed', () => {
    win = null;
    ready = false;
    if (notifyApp) notifyApp('closed');
  });
  return win;
}

/** 等待预览窗 HTML 加载完成(首次打开时) */
async function whenReady() {
  const w = ensure();
  if (ready) return w;
  return await new Promise((res) => {
    if (ready) return res(w);
    w.webContents.once('did-finish-load', () => res(w));
  });
}

/**
 * 显示并推送内容(不抢焦点, 避免打断主窗口输入)。
 * 位置策略:
 * - 窗口已可见 → 原地不动(只更新内容, 不跳动, 便于用户拖动后保持);
 * - 不可见 + 提供了鼠标位置(悬停资源行) → 定位到**鼠标右下方**, 不遮挡光标所在行的
 *   缩略图/文件名; 右侧/下方放不下则翻转到光标左侧/上方, 并限制在鼠标所在显示器内;
 * - 无鼠标位置(手动预览等) → 恢复到上次位置(lastPos), 首次则屏幕右上角。
 */
async function show(payload) {
  const w = await whenReady();
  if (!w.isVisible()) {
    const [cw, ch] = w.getSize();
    let x, y;
    const m = payload && payload.mouse;
    if (m && m.x != null && m.y != null) {
      const mx = Math.round(m.x), my = Math.round(m.y);
      const wa = screen.getDisplayNearestPoint({ x: mx, y: my }).workArea;
      x = mx + 18;              // 光标右侧(不遮挡光标所在行的缩略图/文件名)
      y = my + 14;              // 光标下方
      if (x + cw > wa.x + wa.width) x = mx - cw - 12; // 右侧放不下 → 光标左侧
      if (y + ch > wa.y + wa.height) y = Math.max(wa.y, my - ch - 10); // 下方放不下 → 光标上方
      x = Math.min(Math.max(x, wa.x), wa.x + wa.width - cw);
      y = Math.min(Math.max(y, wa.y), wa.y + wa.height - ch);
    } else if (lastPos) {
      [x, y] = lastPos;
    } else {
      const wa = screen.getPrimaryDisplay().workArea;
      x = Math.max(wa.x, wa.x + wa.width - cw - 16);
      y = wa.y + 16;
    }
    w.setPosition(Math.round(x), Math.round(y));
  }
  w.show();
  if (payload) w.webContents.send('preview:content', payload);
}

/** 隐藏(鼠标仍在预览窗内时不隐藏, 防止移入窗口瞬间被关掉); 隐藏前记住当前位置 */
function hide() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) return;
  lastPos = win.getPosition();
  win.hide();
}

function close() {
  if (win && !win.isDestroyed()) win.close();
}

function togglePin() {
  const w = ensure();
  const next = !w.isAlwaysOnTop();
  w.setAlwaysOnTop(next);
  if (notifyApp) notifyApp('pin', next);
  return next;
}

function setPin(pinned) {
  const w = ensure();
  const v = !!pinned;
  w.setAlwaysOnTop(v);
  if (notifyApp) notifyApp('pin', v);
  return v;
}

function getWin() {
  return win;
}

function setNotifyApp(cb) {
  notifyApp = cb;
}

module.exports = { show, hide, close, togglePin, setPin, getWin, setNotifyApp };
