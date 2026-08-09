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

  // ---- 资源工具箱:通用文件 I/O ----
  pickFiles: (opts) => ipcRenderer.invoke('fs:pickFiles', opts),
  collectFiles: (args) => ipcRenderer.invoke('tool:collectFiles', args),
  readBase64: (p) => ipcRenderer.invoke('fs:readBase64', p),
  writeFileBase64: (p, dataUrl) => ipcRenderer.invoke('fs:writeFileBase64', p, dataUrl),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  listDir: (p) => ipcRenderer.invoke('fs:listDir', p),

  // ---- 资源工具箱:转换工具 ----
  astc2png: (args) => ipcRenderer.invoke('tool:astc2png', args),
  skel2json: (args) => ipcRenderer.invoke('tool:skel2json', args),
  probeSkel: (args) => ipcRenderer.invoke('tool:probeSkel', args),
  spineFix: (args) => ipcRenderer.invoke('tool:spinefix', args),

  // ---- FGUI 逆向:探测 / 单包解析 / 目录批量导出 / 源工程还原 ----
  fguiProbe: (args) => ipcRenderer.invoke('fgui:probe', args),
  fguiParse: (args) => ipcRenderer.invoke('fgui:parse', args),
  fguiBatchExport: (args) => ipcRenderer.invoke('fgui:batchExport', args),
  fguiExportSingle: (args) => ipcRenderer.invoke('fgui:exportSingle', args),
  fguiExportSource: (args) => ipcRenderer.invoke('fgui:exportSource', args),
  fguiPreviewLoad: (args) => ipcRenderer.invoke('fgui:previewLoad', args),

  // ---- 音频播放器:目录列表 / ID3 元信息 ----
  listDirAudios: (dir) => ipcRenderer.invoke('audio:listDir', dir),
  readAudioMeta: (p) => ipcRenderer.invoke("audio:readMeta", p),
  readAudioMetas: (paths) => ipcRenderer.invoke("audio:readMetas", paths),
  writeAudioMeta: (p, tags) => ipcRenderer.invoke('audio:writeMeta', p, tags),
});

// 冒烟测试标志(仅开发时传入 --smoke,通过 URL 参数传递,见 main.js)
contextBridge.exposeInMainWorld('__SMOKE_FLAG__', new URLSearchParams(window.location.search).get('smoke') === '1');
