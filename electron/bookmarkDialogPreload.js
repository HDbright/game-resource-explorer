'use strict';

// 网址收藏对话框(独立原生窗口)专用 preload —— 仅暴露最小接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bmApi', {
  onInit: (cb) => ipcRenderer.on('bm:init', (_e, d) => cb(d)),
  submit: (payload) => ipcRenderer.send('bm:submit', payload),
  cancel: () => ipcRenderer.send('bm:cancel'),
});
