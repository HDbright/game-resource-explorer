'use strict';
/**
 * 资源悬浮预览 —— 独立窗口(像 DevTools detach 一样脱离主窗口)。
 * - 解决「DOM 浮层无法覆盖原生 WebContentsView」的根本问题:预览是独立 BrowserWindow,
 *   天然悬浮在所有窗口之上, 可自由拖到浏览器区上方, 无遮挡/无黑屏/无冻结。
 * - 交互:主窗口悬停资源行 → show 显示并推送内容(首次右上角, 之后恢复上次位置, 不随鼠标移动);
 *   移出(未置顶)自动隐藏;点击进入窗口自动置顶常驻;窗口内 📌 按钮切换 alwaysOnTop。
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let win = null;
let ready = false;
let notifyApp = null; // (event: 'closed'|'pin', value?) => void  主窗口回调
let lastPos = null;   // 记住上次位置(拖动后/隐藏时), 再显示时恢复, 不随鼠标移动

function ensure() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 420,
    height: 360,
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
    },
  });
  ready = false;
  win.loadFile(path.join(__dirname, '../../dist/preview-window.html'));
  win.webContents.on('did-finish-load', () => { ready = true; });
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
 * 位置策略: 窗口已可见 → 原地不动(只更新内容, 不随鼠标移动);
 * 首次显示 → 屏幕右上角; 之后隐藏/拖动过 → 恢复到上次位置。
 */
async function show(payload) {
  const w = await whenReady();
  if (!w.isVisible()) {
    const [cw, ch] = w.getSize();
    let x, y;
    if (lastPos) {
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
