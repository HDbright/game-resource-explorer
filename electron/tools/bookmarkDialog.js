'use strict';
/**
 * 网址收藏对话框(收藏 / 编辑 / 删除 / 移动) —— 独立原生 BrowserWindow。
 * - 解决「DOM 浮层无法覆盖原生 WebContentsView」: 对话框是独立窗口, 天然盖在网页原生视图之上,
 *   弹窗时网页内容保持可见(不再把浏览器视图收起成 0×0 导致黑屏)。
 * - 结果经 IPC 回传主窗口渲染端(webGamePage)执行实际的增删改, 保持状态逻辑仍在前端。
 */
const { BrowserWindow } = require('electron');
const path = require('path');

let win = null;
let notifyResult = null;     // (payload) => void  结果回传主窗口
let submitHandler = null;
let cancelHandler = null;
let resultSent = false;

function setNotifyResult(cb) { notifyResult = cb; }

function cleanupListeners(ipc) {
  if (submitHandler) { try { ipc.removeListener('bm:submit', submitHandler); } catch (e) {} submitHandler = null; }
  if (cancelHandler) { try { ipc.removeListener('bm:cancel', cancelHandler); } catch (e) {} cancelHandler = null; }
}

function open(opts, parent) {
  const ipc = require('electron').ipcMain;
  // 关闭可能残留的旧窗口(连同其监听)
  if (win && !win.isDestroyed()) { try { win.close(); } catch (e) {} }
  cleanupListeners(ipc);
  resultSent = false;

  win = new BrowserWindow({
    width: 440, height: 330, minWidth: 360, minHeight: 260,
    title: '收藏网址', backgroundColor: '#23262e', autoHideMenuBar: true, show: false,
    parent: (parent && !parent.isDestroyed()) ? parent : undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, '../bookmarkDialogPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  submitHandler = (_e, payload) => { resultSent = true; if (notifyResult) notifyResult(payload); };
  cancelHandler = () => { resultSent = true; if (notifyResult) notifyResult({ canceled: true }); };
  ipc.on('bm:submit', submitHandler);
  ipc.on('bm:cancel', cancelHandler);

  win.on('closed', () => {
    // 用户直接点窗口关闭(X)也算取消, 但已通过 submit/cancel 报送过结果的不再重复
    if (!resultSent && notifyResult) notifyResult({ canceled: true });
    resultSent = false;
    cleanupListeners(ipc);
    win = null;
  });

  win.loadFile(path.join(__dirname, '../../dist/bookmark-dialog.html'));
  win.webContents.once('did-finish-load', () => {
    if (win && !win.isDestroyed()) win.webContents.send('bm:init', opts || {});
  });
  win.once('ready-to-show', () => {
    const [w, h] = win.getSize();
    let x, y;
    if (parent && !parent.isDestroyed()) {
      const pb = parent.getBounds();
      x = Math.round(pb.x + (pb.width - w) / 2);
      y = Math.round(pb.y + (pb.height - h) / 2);
    } else {
      const { screen } = require('electron');
      const wa = screen.getPrimaryDisplay().workArea;
      x = Math.round(wa.x + (wa.width - w) / 2);
      y = Math.round(wa.y + (wa.height - h) / 2);
    }
    win.setPosition(x, y);
    win.show();
  });
  return { ok: true };
}

function close() { if (win && !win.isDestroyed()) { try { win.close(); } catch (e) {} } }

module.exports = { open, close, setNotifyResult };
