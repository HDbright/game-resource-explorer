'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 资源悬浮预览窗专用 preload(独立 BrowserWindow, 只暴露预览所需的最小接口)
contextBridge.exposeInMainWorld('previewApi', {
  onContent: (cb) => ipcRenderer.on('preview:content', (_e, d) => cb(d)),
  onPinState: (cb) => ipcRenderer.on('preview:pinState', (_e, p) => cb(p)),
  downloadDataUrl: (args) => ipcRenderer.invoke('preview:downloadDataUrl', args),
  fetchText: (args) => ipcRenderer.invoke('preview:fetchText', args),
  togglePin: () => ipcRenderer.invoke('preview:togglePin'),
  setPin: (pinned) => ipcRenderer.invoke('preview:setPin', pinned),
  action: (payload) => ipcRenderer.send('preview:action', payload),
});
