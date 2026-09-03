'use strict';
/**
 * 临时校验(补丁·187):托盘左键单击 → 优先还原"正在计时的最小化计时窗"。
 * mock 掉 electron / db,直接驱动 timerWindows 的真实判定逻辑,不启动 GUI。
 */
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-test-'));

// ---------- mock: electron ----------
class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts || {};
    this._destroyed = false; this._minimized = false; this._visible = false;
    this._listeners = {};
    this.webContents = { send: () => {}, isLoading: () => false, once: () => {}, on: () => {} };
    FakeBrowserWindow._all.push(this);
  }
  on(ev, cb) { (this._listeners[ev] = this._listeners[ev] || []).push(cb); return this; }
  once(ev, cb) { return this.on(ev, cb); }
  emit(ev, ...a) { (this._listeners[ev] || []).slice().forEach((cb) => cb(...a)); }
  isDestroyed() { return this._destroyed; }
  show() { this._visible = true; }
  minimize() { this._minimized = true; this._visible = false; }
  restore() { this._minimized = false; this._visible = true; }
  isMinimized() { return this._minimized; }
  isVisible() { return this._visible; }
  isMaximized() { return false; }
  focus() { this._focusCount = (this._focusCount || 0) + 1; }
  moveTop() {}
  setMenuBarVisibility() {}
  setAlwaysOnTop() {}
  getBounds() { return { x: 0, y: 0, width: this.opts.width || 100, height: this.opts.height || 100 }; }
  setBounds() {}
  loadFile() { setImmediate(() => this.emit('ready-to-show')); }
  close() { this._destroyed = true; this.emit('closed'); }
}
FakeBrowserWindow._all = [];
FakeBrowserWindow.fromWebContents = (wc) => FakeBrowserWindow._all.find((w) => w.webContents === wc) || null;

const ipcHandlers = {};
const electronMock = {
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { on: (ch, cb) => { ipcHandlers[ch] = cb; }, handle: () => {} },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  app: { getPath: () => tmp },
  dialog: {},
  Notification: class { constructor() {} show() {} },
};

// ---------- mock: ../db ----------
let enabledAlarms = [];
const dbNoop = () => ({ ok: true });
const dbMock = {
  dbTimeTypes: () => [], dbTimeTypeAdd: dbNoop, dbTimeTypeUpdate: dbNoop, dbTimeTypeDelete: dbNoop,
  dbTimeRecords: () => [], dbTimeRecordAdd: dbNoop, dbTimeRecordUpdate: dbNoop, dbTimeRecordDelete: dbNoop,
  dbAlarms: () => enabledAlarms,
  dbAlarmAdd: dbNoop, dbAlarmUpdate: dbNoop, dbAlarmDelete: dbNoop,
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  if (request === '../db') return dbMock;
  return origLoad.apply(this, arguments);
};

const tw = require(path.join(__dirname, '..', 'electron', 'tools', 'timerWindows.js'));
Module._load = origLoad;

// ---------- 断言框架 ----------
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } }
const tick = () => new Promise((r) => setImmediate(r));

/** 模拟渲染端上报运行态:走真实的 ipcMain 处理器 */
function report(win, running) {
  ipcHandlers['timer:runningState']({ sender: win.webContents }, running);
}

(async () => {
  tw.initIpc();
  ok(typeof ipcHandlers['timer:runningState'] === 'function', 'IPC timer:runningState 已注册');
  ok(typeof tw.restoreMinimizedTimers === 'function', '导出 restoreMinimizedTimers');

  // --- 1. 没有任何计时窗 → 0(应走"唤回主窗口") ---
  ok(tw.restoreMinimizedTimers() === 0, '无计时窗 → 返回 0(唤回主窗)');

  // --- 2. 秒表正在计时 + 已最小化 → 还原 ---
  const sw = tw.openStopwatch();
  await tick();                       // ready-to-show → show()
  ok(sw.isVisible() && !sw.isMinimized(), '秒表开窗后可见');
  report(sw, true);                   // 点开始
  sw.minimize();
  ok(tw.restoreMinimizedTimers() === 1, '秒表计时中+最小化 → 返回 1');
  ok(!sw.isMinimized() && sw.isVisible(), '秒表已还原且可见');

  // --- 3. 秒表已暂停(未计时) + 最小化 → 不还原 ---
  report(sw, false);                  // 点暂停
  sw.minimize();
  ok(tw.restoreMinimizedTimers() === 0, '秒表暂停中+最小化 → 返回 0(唤回主窗)');
  ok(sw.isMinimized(), '暂停的秒表保持最小化,未被误还原');

  // --- 4. 倒计时计时中 + 最小化 → 还原 ---
  const cd = tw.openCountdown({ seconds: 600 });
  await tick();
  report(cd, true);
  sw.restore();                       // 清掉上一个,避免干扰
  report(sw, false);
  sw.minimize();
  cd.minimize();
  ok(tw.restoreMinimizedTimers() === 1, '倒计时计时中+最小化 → 返回 1');
  ok(!cd.isMinimized() && cd.isVisible(), '倒计时已还原且可见');
  ok(sw.isMinimized(), '暂停中的秒表未被牵连还原');

  // --- 5. 倒计时走完(结束) → 不再算计时中 ---
  report(cd, false);
  cd.minimize();
  ok(tw.restoreMinimizedTimers() === 0, '倒计时已结束+最小化 → 返回 0');

  // --- 6. 闹钟窗:有启用闹钟 = 在值守 → 还原;无启用闹钟 → 不还原 ---
  enabledAlarms = [];
  const al = tw.openAlarm();
  await tick();
  al.minimize();
  ok(tw.restoreMinimizedTimers() === 0, '闹钟窗无启用闹钟+最小化 → 返回 0');
  enabledAlarms = [{ id: 'a1', enabled: 1 }];
  ok(tw.restoreMinimizedTimers() === 1, '闹钟窗有启用闹钟+最小化 → 返回 1');
  ok(!al.isMinimized() && al.isVisible(), '闹钟窗已还原且可见');
  enabledAlarms = [];

  // --- 7. 多窗口:两个都在计时且最小化 → 一次全还原 ---
  al.minimize();
  const sw2 = tw.openStopwatch({ force: true });
  await tick();
  report(sw2, true);
  sw2.minimize();
  report(cd, true);
  cd.minimize();
  const n = tw.restoreMinimizedTimers();
  ok(n === 2, '多窗口(倒计时+秒表)计时中 → 一次还原 2 个(实际 ' + n + ')');
  ok(!sw2.isMinimized() && !cd.isMinimized(), '多窗口均已还原');

  // --- 8. 窗口未最小化(正常显示) → 不算"需要还原" ---
  ok(tw.restoreMinimizedTimers() === 0, '窗口都正常显示 → 返回 0(不抢焦点)');

  // --- 9. 窗口关闭后不残留 ---
  tw.closeAll();
  ok(tw.restoreMinimizedTimers() === 0, 'closeAll 后 → 返回 0,无已销毁窗口残留');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
