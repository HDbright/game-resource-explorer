'use strict';
/**
 * 秒表/倒计时悬浮窗 preload —— 暴露极简的 window.timerApi 给渲染端。
 * - 窗口控制(minimize/close/toggleMax/setTop)通过 ipcMain 转发,主进程用
 *   e.sender 反查到对应 BrowserWindow 精准操作(独立悬浮窗无 parent,必须按
 *   webContents 定位),不会误关其它计时窗口。
 * - onInit: 主进程在 did-finish-load 后下发窗口配置({ mode:'stopwatch' |
 *   'countdown', duration?:秒, title }),渲染端据此初始化 UI。
 * - onMaxState: 主进程在 maximize/unmaximize 时回推当前最大状态,用于切换
 *   标题栏"最大化/还原"图标(与 float-window.html 风格一致)。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerApi', {
  minimize: () => ipcRenderer.send('timer:minimize'),
  close: () => ipcRenderer.send('timer:close'),
  toggleMax: () => ipcRenderer.send('timer:toggleMax'),
  setTop: (on) => ipcRenderer.send('timer:setTop', !!on),
  onInit: (cb) => ipcRenderer.on('timer:init', (_e, d) => { try { cb(d || {}); } catch (err) { /* ignore */ } }),
  onMaxState: (cb) => ipcRenderer.on('timer:maxState', (_e, d) => { try { cb(d || {}); } catch (err) { /* ignore */ } }),

  // ---- 计时类型 CRUD(补丁·96) ----
  typeList: () => ipcRenderer.invoke('timer:typeList'),
  typeAdd: (t) => ipcRenderer.invoke('timer:typeAdd', t),
  typeUpdate: (id, patch) => ipcRenderer.invoke('timer:typeUpdate', id, patch),
  typeDelete: (id) => ipcRenderer.invoke('timer:typeDelete', id),

  // ---- 计时记录 CRUD(补丁·96) ----
  recList: () => ipcRenderer.invoke('timer:recList'),
  recAdd: (rec) => ipcRenderer.invoke('timer:recAdd', rec),
  recUpdate: (id, patch) => ipcRenderer.invoke('timer:recUpdate', id, patch),
  recDelete: (id) => ipcRenderer.invoke('timer:recDelete', id),

  // ---- 窗口管理 ----
  openManager: () => ipcRenderer.send('timer:openManager'),
  newStopwatch: () => ipcRenderer.send('timer:newStopwatch'),
  newCountdown: () => ipcRenderer.send('timer:newCountdown'),

  // ---- 提醒声音设置(补丁·98) ----
  soundGet: () => ipcRenderer.invoke('timer:soundGet'),
  soundSet: (payload) => ipcRenderer.invoke('timer:soundSet', payload),
  soundPick: () => ipcRenderer.invoke('timer:soundPick'),
  // ---- 补丁·100: Windows 内置闹钟声清单/预览 ----
  builtinList: () => ipcRenderer.invoke('timer:builtinList'),
  builtinGet: (key) => ipcRenderer.invoke('timer:builtinGet', key),
  builtinPreview: async (key) => {
    // 单条内置声音试听(倒计时/闹钟设置面板共用)
    try {
      const r = await ipcRenderer.invoke('timer:builtinGet', key);
      if (!r || !r.available || !r.dataUrl) return false;
      const a = new Audio(r.dataUrl);
      a.play().catch(() => {});
      return true;
    } catch (e) { return false; }
  },

  // ---- 闹钟(补丁·98) ----
  alarmList: () => ipcRenderer.invoke('timer:alarmList'),
  alarmAdd: (a) => ipcRenderer.invoke('timer:alarmAdd', a),
  alarmUpdate: (id, patch) => ipcRenderer.invoke('timer:alarmUpdate', id, patch),
  alarmDelete: (id) => ipcRenderer.invoke('timer:alarmDelete', id),
  openAlarm: () => ipcRenderer.send('timer:openAlarm'),
  // ---- 补丁·102 + 补丁·106: 右下角循环响铃弹窗(下拉选择延迟 / 关闭按钮) ----
  onAlarmPopupInit: (cb) => ipcRenderer.on('alarm-popup:init', (_e, d) => { try { cb(d || {}); } catch (err) { /* ignore */ } }),
  alarmSnooze: (arg) => ipcRenderer.send('timer:alarmSnooze', arg),
  alarmStop: (arg) => ipcRenderer.send('timer:alarmStop', arg),
});
