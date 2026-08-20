'use strict';
/**
 * 秒表 / 倒计时 独立悬浮窗管理 —— 独立 BrowserWindow(无 parent, 可自由拖到任意位置,
 * 天然浮在所有窗口之上)。模式与 webPreviewWindow.js 一致, 但:
 *   - stopwatch 支持多实例(openStopwatch({force:true}) 强制新开; 默认聚焦已有首个)
 *   - countdown 每次 openCountdown 都新建一个独立窗口, 允许多个倒计时并行
 *   - 通过 ipcRenderer + e.sender 反查 BrowserWindow 精准操作
 *     (独立窗口无 parent, 必须按 webContents 定位, 否则会误关其它计时窗口)
 */
const { BrowserWindow, ipcMain, screen, app, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { dbTimeTypes, dbTimeTypeAdd, dbTimeTypeUpdate, dbTimeTypeDelete, dbTimeRecords, dbTimeRecordAdd, dbTimeRecordUpdate, dbTimeRecordDelete, dbAlarms, dbAlarmAdd, dbAlarmUpdate, dbAlarmDelete } = require('../db');

let stopwatchWins = []; // 秒表窗口数组(支持多个并行, 补丁·97)
let countdownWins = []; // 倒计时窗口数组(支持多个并行)
let managerWin = null;  // 计时管理窗口(单例)
let alarmWin = null;    // 闹钟窗口(单例, 补丁·98)
let ipcInited = false;
let alarmTimer = null;  // 闹钟调度器
let alarmChangeCb = null; // 闹钟状态变化回调(托盘图标叠加小时钟指示用, 补丁·99)
let alarmPopupWin = null; // 右下角循环响铃弹窗(补丁·102)
let snoozeJobs = [];      // 延迟提醒队列 { id, fireAtSec, payload }(补丁·102)

/** 注册闹钟状态变化监听(有启用闹钟时托盘图标叠加小时钟) */
function setAlarmChangeListener(cb) { alarmChangeCb = cb; }
function notifyAlarmChanged() {
  if (alarmChangeCb) { try { alarmChangeCb(); } catch (e) { /* ignore */ } }
}

/** 预设计时类型(首次使用时自动注入) */
const DEFAULT_TIME_TYPES = [
  { name: '站桩', color: '#f59e0b', icon: '🧘' },
  { name: '打坐', color: '#8b5cf6', icon: '🙏' },
  { name: '休息', color: '#22c55e', icon: '☕' },
  { name: '工作', color: '#3b82f6', icon: '💼' },
  { name: '学习', color: '#ec4899', icon: '📚' },
  { name: '烹饪', color: '#ef4444', icon: '🍳' },
];
function ensureDefaultTypes() {
  try {
    if (dbTimeTypes().length === 0) {
      DEFAULT_TIME_TYPES.forEach((t, i) => dbTimeTypeAdd({ ...t, sort: i }));
    }
  } catch (e) { console.error('[timer] ensureDefaultTypes:', e); }
}

// ---- 提醒声音设置(补丁·98 + 补丁·100):倒计时/闹钟共用 ----
// 内置 Windows 闹钟/秒表应用的声音文件(Win8+ Media/Alarm0X.wav),正好覆盖
// 经典闹钟应用内置的"编织/木琴/和弦/.../上升"10 个选项。无需随应用打包,
// 直接引用系统目录;若文件缺失,该项标记 available=false 并降级到 beep。
const BUILTIN_SOUNDS = [
  { key: 'Alarm01', label: '编织' },
  { key: 'Alarm02', label: '木琴' },
  { key: 'Alarm03', label: '和弦' },
  { key: 'Alarm04', label: '滴答' },
  { key: 'Alarm05', label: '叮当' },
  { key: 'Alarm06', label: '过渡' },
  { key: 'Alarm07', label: '下降' },
  { key: 'Alarm08', label: '弹跳' },
  { key: 'Alarm09', label: '回声' },
  { key: 'Alarm10', label: '上升' },
];
function windowsMediaDir() {
  // process.env.SystemRoot 在 Windows 上 = C:\Windows;非 Windows 调试环境兜底
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(root, 'Media');
}
function builtinSoundPath(key) {
  if (!/^Alarm0[1-9]$|^Alarm10$/.test(String(key || ''))) return '';
  return path.join(windowsMediaDir(), key + '.wav');
}
function tryBuiltinSound(key) {
  // 返回 { available, path, dataUrl } —— 文件缺失时 available=false
  const p = builtinSoundPath(key);
  if (!p) return { available: false, path: '', dataUrl: '' };
  try {
    if (!fs.existsSync(p)) return { available: false, path: p, dataUrl: '' };
    return { available: true, path: p, dataUrl: fileToDataUrl(p) };
  } catch (e) {
    return { available: false, path: p, dataUrl: '', error: String(e.message || e) };
  }
}
function soundKey(s) {
  // 解析 'wav:Alarm01' -> 'Alarm01'; 其他类型返回 null
  const t = String(s || '');
  return t.startsWith('wav:') ? t.slice(4) : null;
}
const SOUND_STATE = () => path.join(app.getPath('userData'), 'timer-sound.json');
function loadSoundState() {
  try { return JSON.parse(fs.readFileSync(SOUND_STATE(), 'utf8')) || {}; } catch (e) { return {}; }
}
function saveSoundState(s) {
  try { fs.writeFileSync(SOUND_STATE(), JSON.stringify(s)); } catch (e) { /* ignore */ }
}
function audioMime(p) {
  const ext = path.extname(p).toLowerCase();
  return ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : ext === '.flac' ? 'audio/flac' : 'audio/mpeg';
}
function fileToDataUrl(p) {
  const buf = fs.readFileSync(p);
  return `data:${audioMime(p)};base64,${buf.toString('base64')}`;
}

// ---- 持久化:秒表窗口位置/大小(重启后恢复, 存最近一个) ----
const STOPWATCH_STATE = () => path.join(app.getPath('userData'), 'timer-stopwatch-state.json');
function loadStopwatchState() {
  try { return JSON.parse(fs.readFileSync(STOPWATCH_STATE(), 'utf8')) || {}; } catch (e) { return {}; }
}
function saveStopwatchState() {
  const win = stopwatchWins[stopwatchWins.length - 1];
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(STOPWATCH_STATE(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
  } catch (e) { /* ignore */ }
}

function bindMaxState(win) {
  const send = (maximized) => {
    try { win.webContents.send('timer:maxState', { maximized }); } catch (e) { /* ignore */ }
  };
  win.on('maximize', () => send(true));
  win.on('unmaximize', () => send(false));
}

function createWindowBase({ width, height, minWidth, minHeight, title, x, y }) {
  return new BrowserWindow({
    width, height, minWidth, minHeight, x, y,
    title,
    backgroundColor: '#17181d',
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    show: false,
    skipTaskbar: true, // 工具小窗, 不占任务栏(避免与主窗/悬浮预览窗混淆)
    webPreferences: {
      preload: path.join(__dirname, '..', 'timerPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required', // 补丁·103: 闹钟/倒计时响铃必须能自动播放
    },
  });
}

function clampToDisplay(win, x, y, w, h) {
  // 夹回所在显示器工作区, 防止外接屏拔掉/分辨率变化后窗口飞出可见区
  try {
    const wa = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - 80));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - 40));
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
  } catch (e) { /* ignore */ }
}

/**
 * 创建秒表窗口(多实例, 补丁·97)。默认聚焦已存在的首个; force=true 强制新开(窗口内「＋」)。
 */
function openStopwatch({ force } = {}) {
  if (!force && stopwatchWins.length) {
    const w0 = stopwatchWins.find((w) => w && !w.isDestroyed());
    if (w0) {
      try { w0.show(); w0.moveTop(); w0.focus(); } catch (e) { /* ignore */ }
      return w0;
    }
  }
  ensureDefaultTypes();
  const st = loadStopwatchState();
  const w = 240, h = 208; // 紧凑窄窗(补丁·98)
  // 级联: 新开窗口时按已有窗口数偏移, 避免重叠
  const wa = screen.getPrimaryDisplay().workArea;
  const cascade = stopwatchWins.length % 8;
  let x, y;
  if (st && Number.isFinite(st.x) && Number.isFinite(st.y)) {
    x = st.x + cascade * 24; y = st.y + cascade * 24;
  } else {
    x = wa.x + wa.width - w - 24 - cascade * 24;
    y = wa.y + wa.height - h - 24 - cascade * 24;
  }
  const win = createWindowBase({ width: w, height: h, minWidth: 216, minHeight: 190, title: '秒表', x, y });
  clampToDisplay(win, win.getBounds().x, win.getBounds().y, w, h);
  bindMaxState(win);
  win.setMenuBarVisibility(false);
  stopwatchWins.push(win);

  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'stopwatch.html'));
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    try { win.show(); } catch (e) { /* ignore */ }
    try { win.webContents.send('timer:init', { mode: 'stopwatch' }); } catch (e) { /* ignore */ }
  });
  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(saveStopwatchState, 300); };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', saveStopwatchState);
  win.on('closed', () => {
    stopwatchWins = stopwatchWins.filter((w) => w !== win);
  });
  return win;
}

/**
 * 创建倒计时窗口(每次新建一个独立窗口)。
 * @param {object} opt
 * @param {number} opt.seconds     倒计时秒数
 * @param {string} [opt.title]     窗口标题(同时显示在标题栏)
 * @param {boolean} [opt.focusInput] true 时页面加载后自动聚焦并选中"分钟"输入框,
 *   方便托盘"自定义..."菜单:开窗即可直接键入分钟数,配合窗口内 +/- 微调。
 */
function openCountdown({ seconds, title, focusInput } = {}) {
  const sec = Math.max(1, Math.min(599 * 60, Math.round(Number(seconds) || 25 * 60)));
  const w = 280, h = 236; // 紧凑窄窗(补丁·98)
  // 级联: 已有倒计时窗口数 × 24 像素偏移(避免完全重叠)
  const wa = screen.getPrimaryDisplay().workArea;
  const offset = (countdownWins.length % 8) * 24;
  const x = wa.x + wa.width - w - 24 - offset;
  const y = wa.y + wa.height - h - 24 - offset;
  const win = createWindowBase({ width: w, height: h, minWidth: 248, minHeight: 210, title: title || '倒计时', x, y });
  bindMaxState(win);
  win.setMenuBarVisibility(false);
  countdownWins.push(win);
  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'countdown.html'));
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    try { win.show(); } catch (e) { /* ignore */ }
    try { win.webContents.send('timer:init', { mode: 'countdown', duration: sec, title: title || undefined, focusInput: !!focusInput }); } catch (e) { /* ignore */ }
  });
  win.on('closed', () => {
    countdownWins = countdownWins.filter((w) => w !== win);
  });
  return win;
}

/** 关闭全部计时窗口(主程序退出前自动) */
function closeAll() {
  for (const w of stopwatchWins) {
    try { if (w && !w.isDestroyed()) w.close(); } catch (e) { /* ignore */ }
  }
  stopwatchWins = [];
  for (const w of countdownWins) {
    try { if (w && !w.isDestroyed()) w.close(); } catch (e) { /* ignore */ }
  }
  countdownWins = [];
  try { if (managerWin && !managerWin.isDestroyed()) managerWin.close(); } catch (e) { /* ignore */ }
  managerWin = null;
  try { if (alarmWin && !alarmWin.isDestroyed()) alarmWin.close(); } catch (e) { /* ignore */ }
  alarmWin = null;
  try { if (alarmPopupWin && !alarmPopupWin.isDestroyed()) alarmPopupWin.close(); } catch (e) { /* ignore */ }
  alarmPopupWin = null;
  snoozeJobs = [];
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
}

/** 创建计时管理窗口(单例: 记录列表 CRUD + 类型管理 + 统计) */
function openManager() {
  if (managerWin && !managerWin.isDestroyed()) {
    try { managerWin.show(); managerWin.moveTop(); managerWin.focus(); } catch (e) { /* ignore */ }
    return managerWin;
  }
  ensureDefaultTypes();
  const w = 760, h = 560;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + wa.width - w - 24;
  const y = wa.y + wa.height - h - 24;
  managerWin = createWindowBase({ width: w, height: h, minWidth: 620, minHeight: 420, title: '计时管理', x, y });
  bindMaxState(managerWin);
  managerWin.setMenuBarVisibility(false);
  managerWin.loadFile(path.join(__dirname, '..', '..', 'dist', 'time-manager.html'));
  managerWin.once('ready-to-show', () => {
    if (!managerWin || managerWin.isDestroyed()) return;
    try { managerWin.show(); } catch (e) { /* ignore */ }
  });
  managerWin.on('closed', () => { managerWin = null; });
  return managerWin;
}

/** 创建闹钟窗口(单例, 补丁·98) */
function openAlarm() {
  if (alarmWin && !alarmWin.isDestroyed()) {
    try { alarmWin.show(); alarmWin.moveTop(); alarmWin.focus(); } catch (e) { /* ignore */ }
    return alarmWin;
  }
  const w = 340, h = 420;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + wa.width - w - 24;
  const y = wa.y + wa.height - h - 24;
  alarmWin = createWindowBase({ width: w, height: h, minWidth: 300, minHeight: 320, title: '闹钟', x, y });
  bindMaxState(alarmWin);
  alarmWin.setMenuBarVisibility(false);
  alarmWin.loadFile(path.join(__dirname, '..', '..', 'dist', 'alarm.html'));
  alarmWin.once('ready-to-show', () => {
    if (!alarmWin || alarmWin.isDestroyed()) return;
    try { alarmWin.show(); } catch (e) { /* ignore */ }
  });
  alarmWin.on('closed', () => { alarmWin = null; });
  return alarmWin;
}

/** 右下角循环响铃弹窗(补丁·102 + 补丁·103 加固):无边框 alwaysOnTop 小窗, 右下角定位, 不占任务栏 */
function openAlarmPopup(payload) {
  try {
    // 已存在则先关掉, 避免多闹钟叠加多个弹窗
    if (alarmPopupWin && !alarmPopupWin.isDestroyed()) {
      try { alarmPopupWin.close(); } catch (e) { /* ignore */ }
    }
    const w = 340, h = 200;
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - w - 16;
    const y = wa.y + wa.height - h - 16;
    const win = new BrowserWindow({
      width: w, height: h, x, y,
      frame: false, resizable: false, movable: false,
      show: false, skipTaskbar: true, alwaysOnTop: true,
      backgroundColor: '#17181d',
      webPreferences: {
        preload: path.join(__dirname, '..', 'timerPreload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        autoplayPolicy: 'no-user-gesture-required', // 补丁·103: 循环响铃必须能自动播放
      },
    });
    alarmPopupWin = win;
    let sent = false, shown = false;
    const sendInit = () => {
      if (sent || win.isDestroyed()) return;
      sent = true;
      try { win.webContents.send('alarm-popup:init', payload); } catch (e) { /* ignore */ }
    };
    const doShow = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      try { win.show(); win.moveTop(); } catch (e) { /* ignore */ }
    };
    win.once('ready-to-show', () => { doShow(); sendInit(); });
    win.webContents.once('did-finish-load', () => sendInit());
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[alarm] popup load fail:', code, desc, url);
      alarmLog('[alarm] popup load fail ' + code + ' ' + desc + ' ' + url);
    });
    win.on('closed', () => { if (alarmPopupWin === win) alarmPopupWin = null; });
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'alarm-popup.html'));
    // 兜底: ready-to-show 若一直不触发(无 GPU / 渲染卡住), 3 秒后强制显示并下发
    setTimeout(() => { if (!shown && !win.isDestroyed()) { doShow(); sendInit(); } }, 3000);
    return true;
  } catch (e) {
    console.error('[alarm] popup:', e);
    alarmLog('[alarm] popup error: ' + String((e && e.message) || e));
    return false;
  }
}

// ---- 闹钟调度(补丁·98): 每 5 秒检查一次, 到点提醒 ----
function pad2(n) { return String(n).padStart(2, '0'); }
function nowSec() { return Math.floor(Date.now() / 1000); }
// 补丁·103: 闹钟故障诊断日志(打包版主进程 console 不可见, 出问题直接看 userData/alarm.log)
function alarmLog(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'alarm.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) { /* ignore */ }
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function alarmDueOn(a, now) {
  // 重复规则匹配
  const repeat = a.repeat || 'once';
  if (repeat === 'once') return true;
  if (repeat === 'daily') return true;
  const dow = now.getDay(); // 0=周日
  if (repeat === 'weekdays') return dow >= 1 && dow <= 5;
  if (repeat === 'weekly') {
    const days = Array.isArray(a.days) ? a.days : [];
    return days.includes(dow);
  }
  return true;
}
function startAlarmScheduler() {
  if (alarmTimer) return;
  alarmLog('[scheduler] started');
  // 补丁·105: 归一化旧格式 last_ring(纯日期 "2026-08-20" → 空)。
  // 旧版本响铃失败也写当天日期, 导致新版本当天永远跳过; 这里启动即清空解锁。
  try {
    for (const a of dbAlarms()) {
      if (a.last_ring && !String(a.last_ring).includes(' ')) {
        dbAlarmUpdate(a.id, { last_ring: '' });
        alarmLog('[scheduler] reset stale last_ring of ' + a.id + ' (old date-only format)');
      }
    }
  } catch (e) { console.error('[alarm] last_ring normalize:', e); }
  alarmTimer = setInterval(() => {
    try {
      const now = new Date();
      const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      const t = todayStr();
      // 补丁·105: 去重键改为「按次触发」(当天+分钟), 而非「当天一次」——
      // 旧版本响铃失败时已把 last_ring 写成当天, 导致新版本当天永远跳过(用户反馈:到点不响但试响正常)。
      // 新格式 "2026-08-20 22:45" 与旧格式 "2026-08-20" 不相等 → 老数据当天自动解锁重响。
      const ringKey = `${t} ${hhmm}`;
      for (const a of dbAlarms()) {
        if (!a.enabled) continue;
        if (a.time !== hhmm) continue;
        if (a.last_ring === ringKey) continue; // 本次(分钟)已响过
        if (!alarmDueOn(a, now)) continue;
        const ok = ringAlarm(a);
        if (!ok) {
          // 响铃失败不写 last_ring, 同一分钟内下一 tick 会重试
          alarmLog('[tick] ring failed, will retry in minute ' + hhmm + ' id=' + a.id);
          continue;
        }
        // 更新 last_ring; once 响后自动禁用
        const patch = { last_ring: ringKey };
        if (a.repeat === 'once') patch.enabled = 0;
        dbAlarmUpdate(a.id, patch);
        if (patch.enabled === 0) notifyAlarmChanged();
      }
      // 补丁·102: 延迟提醒队列到点则重新弹出循环响铃弹窗
      const ns = nowSec();
      for (let i = snoozeJobs.length - 1; i >= 0; i--) {
        if (snoozeJobs[i].fireAtSec <= ns) {
          const job = snoozeJobs.splice(i, 1)[0];
          openAlarmPopup(job.payload);
        }
      }
    } catch (e) { console.error('[alarm] tick:', e); }
  }, 5000);
}
/** 构造响铃 payload(含声音 dataUrl, 缺失降级到 beep) */
function buildAlarmPayload(a) {
  const payload = {
    id: a.id, time: a.time, label: a.label || '',
    sound: a.sound || 'beep', sound_name: a.sound_name || '', dataUrl: '',
  };
  if (a.sound === 'file' && a.sound_path) {
    try { payload.dataUrl = fileToDataUrl(a.sound_path); }
    catch (e) { payload.sound = 'beep'; }
  } else {
    const k = soundKey(a.sound);
    if (k) {
      // 补丁·100: Windows 内置 wav 闹钟声,系统文件读取失败时降级到 beep
      const r = tryBuiltinSound(k);
      if (r.available && r.dataUrl) payload.dataUrl = r.dataUrl;
      else payload.sound = 'beep';
    }
  }
  return payload;
}
function ringAlarm(a) {
  const payload = buildAlarmPayload(a);
  if (!payload) return false;
  alarmLog('[ring] id=' + a.id + ' time=' + a.time + ' sound=' + (a.sound || '') + ' label=' + (a.label || ''));
  // 系统通知(静音,避免与循环响铃重复出声);点击会打开闹钟管理窗方便用户整体操作
  try {
    const n = new Notification({
      title: '⏰ 闹钟',
      body: `${a.time}${a.label ? ' · ' + a.label : ''}`,
      silent: true,
    });
    n.on('click', () => openAlarm());
    n.show();
  } catch (e) { /* ignore */ }
  // 补丁·106: 右下角弹窗为唯一到点提示; 弹窗失败不再回落到闹钟管理窗
  // (用户反馈:同时弹两个窗体验差, 一个有按钮 + 一个没按钮, 现已统一只剩有按钮的右下角弹窗)
  const ok = openAlarmPopup(payload);
  if (!ok) {
    alarmLog('[ring] popup failed id=' + a.id + ' — 见 openAlarmPopup 日志');
  }
  return ok;
}

/** 注册 IPC 处理器(模块级, 整个 app 生命周期只需注册一次) */
function initIpc() {
  if (ipcInited) return;
  ipcInited = true;
  ipcMain.on('timer:minimize', (e) => {
    try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); } catch (err) { /* ignore */ }
  });
  ipcMain.on('timer:close', (e) => {
    try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); } catch (err) { /* ignore */ }
  });
  ipcMain.on('timer:toggleMax', (e) => {
    try {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w) return;
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
    } catch (err) { /* ignore */ }
  });
  ipcMain.on('timer:setTop', (e, on) => {
    try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setAlwaysOnTop(!!on); } catch (err) { /* ignore */ }
  });
  ipcMain.on('timer:openManager', () => {
    try { openManager(); } catch (e) { console.error('openManager', e); }
  });
  // 窗口内「＋」按钮: 新开一个秒表 / 倒计时窗口(补丁·97)
  ipcMain.on('timer:newStopwatch', () => {
    try { openStopwatch({ force: true }); } catch (e) { console.error('newStopwatch', e); }
  });
  ipcMain.on('timer:newCountdown', () => {
    try { openCountdown({ seconds: 25 * 60, title: '倒计时 · 25 分' }); } catch (e) { console.error('newCountdown', e); }
  });

  // ---- 提醒声音设置(补丁·98 + 补丁·100:增加 Windows 内置闹钟声) ----
  ipcMain.handle('timer:soundGet', () => {
    const s = { type: 'beep', path: '', name: '三声短鸣', ...loadSoundState() };
    // 补丁·100: wav:key 解析后直接给 dataUrl(若文件缺失给空,前端降级到 beep)
    const k = soundKey(s.type);
    if (k) {
      const r = tryBuiltinSound(k);
      return { ...s, path: r.path, dataUrl: r.dataUrl, available: r.available };
    }
    if (s.type === 'file' && s.path) {
      try { return { ...s, dataUrl: fileToDataUrl(s.path), available: true }; }
      catch (e) { return { type: 'beep', path: '', name: '三声短鸣', dataUrl: '', available: false, error: String(e.message || e) }; }
    }
    return { ...s, dataUrl: '', available: true };
  });
  ipcMain.handle('timer:soundSet', (_e, payload) => {
    const s = { type: 'beep', path: '', name: '三声短鸣', ...loadSoundState(), ...(payload || {}) };
    saveSoundState(s);
    return { ok: true, ...s };
  });
  ipcMain.handle('timer:soundPick', async () => {
    try {
      const r = await dialog.showOpenDialog({ title: '选择提醒音乐', filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }] });
      if (r.canceled || !r.filePaths.length) return { canceled: true };
      const p = r.filePaths[0];
      try { return { canceled: false, path: p, name: path.basename(p), dataUrl: fileToDataUrl(p) }; }
      catch (e) { return { canceled: false, path: p, name: path.basename(p), error: String(e.message || e) }; }
    } catch (e) { return { canceled: true, error: String(e.message || e) }; }
  });

  // ---- 补丁·100: Windows 内置声音清单 + 单项 dataUrl 取用(渲染层预览用) ----
  ipcMain.handle('timer:builtinList', () => {
    return BUILTIN_SOUNDS.map((s) => {
      const r = tryBuiltinSound(s.key);
      return { key: s.key, label: s.label, fileName: s.key + '.wav', path: r.path, available: r.available };
    });
  });
  ipcMain.handle('timer:builtinGet', (_e, key) => {
    const r = tryBuiltinSound(key);
    return { key, available: r.available, path: r.path, dataUrl: r.dataUrl };
  });

  // ---- 计时类型 CRUD ----
  ipcMain.handle('timer:typeList', () => { try { ensureDefaultTypes(); return dbTimeTypes(); } catch (e) { return []; } });
  ipcMain.handle('timer:typeAdd', (_e, t) => { try { return dbTimeTypeAdd(t || {}); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('timer:typeUpdate', (_e, id, patch) => { try { return dbTimeTypeUpdate(id, patch || {}); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('timer:typeDelete', (_e, id) => { try { return dbTimeTypeDelete(id); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });

  // ---- 计时记录 CRUD ----
  ipcMain.handle('timer:recList', () => { try { return dbTimeRecords(); } catch (e) { return []; } });
  ipcMain.handle('timer:recAdd', (_e, rec) => { try { return dbTimeRecordAdd(rec || {}); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('timer:recUpdate', (_e, id, patch) => { try { return dbTimeRecordUpdate(id, patch || {}); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('timer:recDelete', (_e, id) => { try { return dbTimeRecordDelete(id); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });

  // ---- 闹钟(补丁·98) ----
  ipcMain.handle('timer:alarmList', () => { try { return dbAlarms(); } catch (e) { return []; } });
  ipcMain.handle('timer:alarmAdd', (_e, a) => { try { const r = dbAlarmAdd(a || {}); if (r && r.ok) notifyAlarmChanged(); return r; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('timer:alarmUpdate', (_e, id, patch) => {
    try {
      const p = { ...(patch || {}) };
      // 补丁·105: 重新开启 / 修改时间 → 重置 last_ring(当天已响标记), 否则编辑后当天不再响
      if (p.enabled === 1 || p.enabled === true || p.time !== undefined) p.last_ring = '';
      const r = dbAlarmUpdate(id, p);
      if (r && r.ok) notifyAlarmChanged();
      return r;
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('timer:alarmDelete', (_e, id) => { try { const r = dbAlarmDelete(id); if (r && r.ok) notifyAlarmChanged(); return r; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.on('timer:openAlarm', () => { try { openAlarm(); } catch (e) { console.error('openAlarm', e); } });
  // ---- 补丁·102: 延迟提醒 / 关闭弹窗(来自右下角 alarm-popup.html) ----
  ipcMain.on('timer:alarmSnooze', (_e, arg) => {
    try {
      const a = arg || {};
      const payload = a.payload;
      if (!payload || !payload.id) return;
      const m = Math.max(1, Math.min(120, Math.round(Number(a.minutes) || 5)));
      snoozeJobs.push({ id: String(payload.id), fireAtSec: nowSec() + m * 60, payload });
      // 关闭当前弹窗(渲染端也会 self-close, 这里兜底)
      if (alarmPopupWin && !alarmPopupWin.isDestroyed()) { try { alarmPopupWin.close(); } catch (e) { /* ignore */ } }
    } catch (e) { console.error('[alarm] snooze:', e); }
  });
  ipcMain.on('timer:alarmStop', (_e, arg) => {
    try {
      const id = arg && arg.id;
      if (id) snoozeJobs = snoozeJobs.filter((j) => j.id !== String(id));
      if (alarmPopupWin && !alarmPopupWin.isDestroyed()) { try { alarmPopupWin.close(); } catch (e) { /* ignore */ } }
    } catch (e) { console.error('[alarm] stop:', e); }
  });
  startAlarmScheduler();
}

module.exports = { openStopwatch, openCountdown, openManager, openAlarm, closeAll, initIpc, setAlarmChangeListener };
