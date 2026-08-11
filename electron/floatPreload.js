'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 网页悬浮窗专用 preload(独立 BrowserWindow, 只暴露标题栏按钮所需的最小接口)
contextBridge.exposeInMainWorld('floatApi', {
  minimize: () => ipcRenderer.invoke('float:minimize'),
  close: () => ipcRenderer.invoke('float:close'),
  restore: () => ipcRenderer.invoke('float:restore'),
  miniMoveBy: (dx, dy) => ipcRenderer.invoke('float:miniMoveBy', { dx, dy }),
  onInfo: (cb) => ipcRenderer.on('float:info', (_e, d) => cb(d)),
  onMode: (cb) => ipcRenderer.on('float:mode', (_e, d) => cb(d)),
});
