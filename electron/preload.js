'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据读写(整体保存)
  dbRead: () => ipcRenderer.invoke('db:read'),
  dbWrite: (data) => ipcRenderer.invoke('db:write', data),

  // 目录选择 / 扫描
  pickDirs: () => ipcRenderer.invoke('dir:pick'),
  scanDir: (dir, recursive) => ipcRenderer.invoke('dir:scan', dir, recursive),

  // 系统交互
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  statFile: (p) => ipcRenderer.invoke('fs:stat', p),

  // 缩略图持久化缓存(userData/thumbnails)
  thumbGet: (itemId) => ipcRenderer.invoke('thumb:get', itemId),
  thumbSave: (itemId, dataUrl) => ipcRenderer.invoke('thumb:save', itemId, dataUrl),
  thumbDelete: (itemId) => ipcRenderer.invoke('thumb:delete', itemId),

  // 应用信息
  appInfo: () => ipcRenderer.invoke('app:info'),
});

// 冒烟测试标志(仅开发时传入 --smoke,通过 URL 参数传递,见 main.js)
contextBridge.exposeInMainWorld('__SMOKE_FLAG__', new URLSearchParams(window.location.search).get('smoke') === '1');
