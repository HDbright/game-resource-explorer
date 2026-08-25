// 颜色选择库:全屏取色窗口专用 preload(只暴露取色所需的最小 IPC 面)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickApi', {
  // 主进程截好图后推送:{ minX, minY, displays: [{x,y,w,h,pxW,pxH,dataUrl}] }
  onCaptures: (cb) => ipcRenderer.once('colorPicker:captures', (_e, data) => { try { cb(data); } catch (e) { /* ignore */ } }),
  // 用户点击选色
  select: (hex) => ipcRenderer.send('colorPicker:selected', hex),
  // 取消(Esc / 右键 / 关闭)
  cancel: () => ipcRenderer.send('colorPicker:canceled'),
});
