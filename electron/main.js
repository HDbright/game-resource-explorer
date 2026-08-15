'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createServer } = require('./server');
const { readDb, writeDb, migrateFromJson, dbStats, dbFile } = require('./db');
const { scanDir, scanPath } = require('./scanner');
const { encodePng } = require('./png');
const { astcToPng } = require('./tools/astc');
const { skelToJson, probeSkeleton } = require('./tools/skel');
const { spineFix } = require('./tools/spineFix');
const { skToSpine, skToSpineText, probeLayaSk } = require('./tools/layaSk2Spine');
const fgui = require('./tools/fgui');
const { buildPreviewData, findGameRoot } = require('./tools/fgui/previewData');
const { webGame, downloadResource, probeFile, classify, typeDir, fileNameFromUrl, safeName } = require('./tools/webGame');
const webPreviewWindow = require('./tools/webPreviewWindow');
const bookmarkDialog = require('./tools/bookmarkDialog');
const { apiTest } = require('./tools/apiTest');
const devCdp = require('./tools/devCdp');
const crypto = require('crypto');

// ---- Spine 骨骼格式/版本转换(C++ SpineSkeletonDataConverter,来自 SpineSkeletonDataConverter 项目) ----
// 该 EXE 为独立原生程序:dev 模式位于 electron/tools/spine-converter/;打包版置于 resources/spine-converter/(asar 外)。
function spineConverterExePath() {
  const packed = path.join(process.resourcesPath || '', 'spine-converter', 'SpineSkeletonDataConverter.exe');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'tools', 'spine-converter', 'SpineSkeletonDataConverter.exe');
}
// 主版本.次版本 → 完整 x.y.z(转换器的 -v 必须完整三段式;patch 仅写入输出骨架的 version 字段,逻辑只查主.次)
const SPINE_FULL_VERSION = {
  '3.5': '3.5.51', '3.6': '3.6.53', '3.7': '3.7.94', '3.8': '3.8.99',
  '4.0': '4.0.64', '4.1': '4.1.43', '4.2': '4.2.11', '4.3': '4.3.0',
};
function spineMajorMinorToFull(v) { return SPINE_FULL_VERSION[v] || (v + '.0'); }
// 探测文件头 256 字节中的 x.y.z,返回 { ok, format, version, versionLabel }
function probeSpineFile(filePath) {
  const ext = (path.extname(filePath) || '').toLowerCase();
  const format = ext === '.json' ? 'json' : (ext === '.skel' || ext === '.bin') ? 'skel' : 'unknown';
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (e) { return { ok: false, reason: e.message }; }
  const head = buf.subarray(0, Math.min(256, buf.length)).toString('latin1');
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(head);
  if (!m) return { ok: false, format, reason: '未检测到 Spine 版本号(x.y.z)' };
  const mm = `${m[1]}.${m[2]}`;
  const known = ['3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2', '4.3'];
  if (!known.includes(mm)) return { ok: false, format, version: mm, reason: `不支持的 Spine 版本: ${mm}` };
  return { ok: true, format, version: mm, versionLabel: `${mm}.${m[3]}` };
}

// ---- 通用:扩展名 → MIME / 下载到临时目录 → data URL / 抓取文本(主窗口与悬浮预览窗共用) ----
const MIME_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', astc: 'image/astc', tga: 'image/x-tga',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', eot: 'application/vnd.ms-fontobject',
};
function mimeOfExt(ext) { return MIME_EXT[ext] || 'application/octet-stream'; }
async function downloadToDataUrl({ url, referrer, proxy, name }) {
  const dir = path.join(app.getPath('userData'), 'webgame_preview_cache');
  const sp = path.join(dir, safeName(name || fileNameFromUrl(url) || 'res'));
  const r = await downloadResource({ url, referrer, proxy }, sp);
  if (!(r && r.ok)) return { ok: false, error: (r && r.error) || '下载失败' };
  const buf = await fs.promises.readFile(sp);
  const mime = mimeOfExt(path.extname(sp).slice(1).toLowerCase());
  try { await fs.promises.unlink(sp); } catch (e) { /* ignore */ }
  return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
}
async function fetchTextOf({ url, referrer, proxy, maxBytes }) {
  const limit = Math.min(Number(maxBytes) || 1024 * 1024, 4 * 1024 * 1024);
  const tmp = path.join(app.getPath('userData'), 'webgame_preview_cache', 'txt_' + Date.now() + '_' + safeName(String(fileNameFromUrl(url) || 'text')));
  try {
    const r = await downloadResource({ url, referrer, proxy }, tmp);
    if (!r || !r.ok) return { ok: false, error: '下载失败' };
    const buf = await fs.promises.readFile(tmp);
    return { ok: true, text: buf.subarray(0, limit).toString('utf8'), truncated: buf.length > limit, size: buf.length, mime: r.mime || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { await fs.promises.unlink(tmp); } catch (e) { /* ignore */ }
  }
}

// 冒烟模式:命令行参数(dev)或环境变量(打包版 exe 不经过 electron CLI,未知 -- 参数会被拒绝)
const isSmoke = process.argv.includes('--smoke') || process.env.SKELETON_VIEWER_SMOKE === '1';

// 应用版本(dev 为项目根 package.json;打包版为 asar 内 package.json)
const appVersion = require('../package.json').version || '';

// 无 GPU 环境(虚拟机/远程桌面)使用软件渲染;正常环境保持硬件加速
if (isSmoke || process.env.SKELETON_VIEWER_SOFTWARE === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

// 固定 userData 目录(开发/打包一致);游戏资源管理器新路径
app.setName('游戏资源管理器');
app.setPath('userData', path.join(app.getPath('appData'), 'game-resource-explorer'));

// 开发者调试服务(CDP): 启动早期读开关标志, 已启用则挂 --remote-debugging-port
// (必须 ready 前执行; 设置页开关通过 relaunch 重启生效, 详见 tools/devCdp.js)
const cdpStartup = devCdp.applyOnStartup();
if (cdpStartup.applied) {
  console.log(`[devCdp] enabled, remote-debugging-port=${cdpStartup.port}`);
}

const DIST_DIR = path.join(__dirname, '..', 'dist');
const SAMPLES_DIR = fs.existsSync(path.join(__dirname, '..', 'samples'))
  ? path.join(__dirname, '..', 'samples')
  : path.join(process.resourcesPath, 'samples');

let db = readDb();
let roots = new Map();
// 预览专用目录注册表(spine 格式转换工具预览用,与条目 roots 隔离,避免被 DB 重载覆盖)
const previewRoots = new Map();

/** 文件名安全化(itemId 用于缩略图缓存文件名) */
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function refreshRoots() {
  roots = new Map(db.items.map((i) => [i.id, path.dirname(i.filePath)]));
}

/** 首次启动注入内置示例(便于体验与冒烟测试) */
function seedSamples() {
  const catId = 'cat-sample';
  let changed = false;

  if (!fs.existsSync(SAMPLES_DIR)) return;

  if (!db.categories.some((c) => c.id === catId)) {
    db.categories.push({ id: catId, name: '内置示例', remark: '随程序附带的可播放示例', sort: 0, createdAt: Date.now() });
    changed = true;
  }

  const spineFile = path.join(SAMPLES_DIR, 'spine_hero', 'hero.json');
  const dbFile = path.join(SAMPLES_DIR, 'dragon_mecha', 'mecha_1004d_ske.json');
  const dbAtlas = path.join(SAMPLES_DIR, 'dragon_mecha', 'mecha_1004d_tex.json');

  if (!db.items.some((i) => i.id === 'sample-spine') && fs.existsSync(spineFile)) {
    db.items.push({
      id: 'sample-spine',
      categoryId: catId,
      type: 'spine',
      filePath: spineFile,
      atlasPath: null,
      displayName: 'Spine 示例(小英雄)',
      remark: '内置 Spine 3.8 示例,含 idle / wave 两个动作',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    changed = true;
  }
  if (!db.items.some((i) => i.id === 'sample-db') && fs.existsSync(dbFile) && fs.existsSync(dbAtlas)) {
    db.items.push({
      id: 'sample-db',
      categoryId: catId,
      type: 'dragonbones',
      filePath: dbFile,
      atlasPath: dbAtlas,
      displayName: 'DragonBones 示例(机甲)',
      remark: 'DragonBones 5.5 官方示例,含 idle / walk / attack 等 10 个动作',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    changed = true;
  }

  // 图片示例(运行时生成小型 PNG,避免提交二进制)
  const sampleImageFile = path.join(SAMPLES_DIR, 'sample_image', 'logo.png');
  const sampleAudioFile = path.join(SAMPLES_DIR, 'sample_audio', 'tone.wav');
  if (!db.items.some((i) => i.id === 'sample-image') && fs.existsSync(SAMPLES_DIR)) {
    try {
      fs.mkdirSync(path.dirname(sampleImageFile), { recursive: true });
      fs.writeFileSync(sampleImageFile, makeSamplePng(64));
    } catch (err) { /* ignore */ }
    if (fs.existsSync(sampleImageFile)) {
      db.items.push({
        id: 'sample-image',
        categoryId: catId,
        type: 'image',
        filePath: sampleImageFile,
        atlasPath: null,
        displayName: '图片示例(游戏 LOGO)',
        remark: '运行时生成的示例图片',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      changed = true;
    }
  }
  if (!db.items.some((i) => i.id === 'sample-audio') && fs.existsSync(SAMPLES_DIR)) {
    try {
      fs.mkdirSync(path.dirname(sampleAudioFile), { recursive: true });
      fs.writeFileSync(sampleAudioFile, makeSampleWav(1.0));
    } catch (err) { /* ignore */ }
    if (fs.existsSync(sampleAudioFile)) {
      db.items.push({
        id: 'sample-audio',
        categoryId: catId,
        type: 'audio',
        filePath: sampleAudioFile,
        atlasPath: null,
        displayName: '音频示例(提示音)',
        remark: '运行时生成的示例音频',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      changed = true;
    }
  }

  if (changed) writeDb(db);
}

// 生成 size×size 渐变 RGBA PNG(运行时生成示例资源,避免提交二进制)
// 复用 electron/png.js 中的 encodePng
function makeSamplePng(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(255 * x / size);
      rgba[i + 1] = Math.round(120 + 100 * y / size);
      rgba[i + 2] = Math.round(255 * (1 - x / size));
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

// 生成 sec 秒 440Hz 正弦波 WAV(16-bit PCM mono 22050Hz)
function makeSampleWav(sec) {
  const sr = 22050;
  const n = Math.floor(sr * sec);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);  // byte rate
  buf.writeUInt16LE(2, 32);       // block align
  buf.writeUInt16LE(16, 34);      // bits
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}


/**
 * 补齐旧条目的 size / mtime(启动时调用)
 */
function enrichItemsMeta() {
  let changed = false;
  for (const it of db.items) {
    if (it.size != null && it.mtime != null) continue;
    try {
      const s = fs.statSync(it.filePath);
      if (it.size == null) { it.size = s.size; changed = true; }
      if (it.mtime == null) { it.mtime = Math.round(s.mtimeMs); changed = true; }
    } catch (err) { /* 文件不存在则跳过 */ }
  }
  if (changed) writeDb(db);
}

let win = null;
let server = null;
let cdpDocWin = null; // 「Chrome DevTools 连接说明」独立文档窗口
let debugWin = null;  // 调试模式独立检视窗口(可拖到主窗口外面)

async function createWindow() {
  win = new BrowserWindow({
    width: 1460,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    backgroundColor: '#1b1d23',
    title: `游戏资源管理器 v${appVersion}`,
    autoHideMenuBar: true,
    show: false, // 首帧可绘制(骨架屏就绪)后再显示, 消除启动黑屏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  // 内容就绪(至少骨架屏可绘制)再显示窗口; 兜底 5 秒强制显示, 防止异常时窗口永不出现
  let shown = false;
  const showWin = () => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', showWin);
  setTimeout(showWin, 5000);

  // 主窗口关闭 → 清理附属窗口(悬浮预览窗 / 网页悬浮窗 / 内嵌浏览器)并彻底退出。
  // ⚠ 不能只依赖 window-all-closed: 悬浮窗等仍开着时该事件不触发, 会导致进程残留。
  win.on('closed', () => {
    try { webPreviewWindow.close(); } catch (e) { /* ignore */ }
    try { webGame.destroy(); } catch (e) { /* ignore */ } // 内部会销毁 floatWin
    try { if (debugWin && !debugWin.isDestroyed()) debugWin.close(); } catch (e) { /* ignore */ }
    try { app.quit(); } catch (e) { /* ignore */ }
  });

  const url = await server.url;
  // 页面 <title> 会覆盖 BrowserWindow title,这里拦截并统一为带版本号的标题
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle(`游戏资源管理器 v${appVersion}`);
  });
  await win.loadURL(url + '/index.html' + (isSmoke ? '?smoke=1' : ''));

  if (isSmoke) runSmoke();
}

// 调试模式独立检视窗口：独立原生 BrowserWindow(无 parent)，因此可拖到主窗口外面，
// 自带标题栏拖拽(-webkit-app-region)、可调整窗口大小、最小化/最大化/关闭。
// 位置/大小在关闭时持久化到 userData/debug-win-bounds.json，下次弹出恢复上次位置。
let debugWinBounds = null; // { x, y, width, height, maximized }
const DEBUG_BOUNDS_FILE = () => path.join(app.getPath('userData'), 'debug-win-bounds.json');

function loadDebugWinBounds() {
  try {
    const o = JSON.parse(fs.readFileSync(DEBUG_BOUNDS_FILE(), 'utf8'));
    if (o && typeof o.x === 'number' && typeof o.y === 'number' && typeof o.width === 'number' && o.width >= 280) {
      debugWinBounds = o;
    }
  } catch (e) { /* 首次运行无存档文件 */ }
}

function saveDebugWinBounds() {
  if (!debugWin || debugWin.isDestroyed()) return;
  try {
    // 最大化时记录还原后的正常边界,便于下次弹出仍是原位置
    const b = debugWin.isMaximized()
      ? (debugWin.getNormalBounds ? debugWin.getNormalBounds() : debugWin.getBounds())
      : debugWin.getBounds();
    fs.writeFileSync(DEBUG_BOUNDS_FILE(), JSON.stringify({
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.round(b.width), height: Math.round(b.height),
      maximized: debugWin.isMaximized(),
    }));
  } catch (e) { /* ignore */ }
}

let debugUserClosed = false; // 用户点了调试窗口的「×」按钮主动关闭(需通知主窗口退出调试模式)
let debugDragOffset = null;  // JS 拖拽:光标相对窗口左上角的偏移 {dx, dy}

function openDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    // 已打开:移到最前但不抢占焦点(避免主窗口被盖住)
    try { debugWin.showInactive(); debugWin.moveTop(); } catch (e) { /* ignore */ }
    return;
  }
  // 恢复上次位置/大小;若存档位置超出当前屏幕(如拔掉外接显示器),夹回所在显示器工作区内
  let w = 380, h = 440, x, y;
  if (debugWinBounds && typeof debugWinBounds.x === 'number') {
    w = Math.min(Math.max(debugWinBounds.width || 380, 280), 1400);
    h = Math.min(Math.max(debugWinBounds.height || 440, 160), 1000);
    const wa = screen.getDisplayMatching({ x: debugWinBounds.x, y: debugWinBounds.y, width: w, height: h }).workArea;
    x = Math.max(wa.x, Math.min(debugWinBounds.x, wa.x + wa.width - 120));
    y = Math.max(wa.y, Math.min(debugWinBounds.y, wa.y + wa.height - 40));
  } else {
    const b = win && !win.isDestroyed() ? win.getBounds() : { x: 80, y: 80, width: 1460 };
    x = Math.max(0, b.x + Math.max(0, b.width - w - 40));
    y = Math.max(0, b.y + 70);
  }
  debugWin = new BrowserWindow({
    width: w, height: h, x, y, minWidth: 280, minHeight: 120,
    frame: false, resizable: true, backgroundColor: '#12141a', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  debugWin.setSkipTaskbar(true); // 作为调试面板,不占任务栏
  // 调试窗口的渲染端 console 转发到主进程终端,便于排查
  debugWin.webContents.on('console-message', (ev) => {
    try { console.log('[debugWin]', (ev && ev.message) || ''); } catch (e) { /* ignore */ }
  });
  debugWin.loadFile(path.join(__dirname, 'debugInspect.html'));
  debugWin.once('ready-to-show', () => {
    if (debugWin && !debugWin.isDestroyed()) {
      // 显示但不抢占焦点:主窗口保持焦点,保证 Ctrl 暂停/恢复快捷键、复制等可直接使用
      try { debugWin.showInactive(); } catch (e) { try { debugWin.show(); } catch (e2) { /* ignore */ } }
    }
  });
  debugWin.on('close', () => saveDebugWinBounds()); // 关闭前记录位置/大小
  debugWin.on('closed', () => {
    // 用户主动点「×」关闭 → 通知主窗口退出调试模式(悬停高亮/监听一并清理)
    if (debugUserClosed) {
      try { if (win && !win.isDestroyed()) win.webContents.send('debug:userClosed'); } catch (e) { /* ignore */ }
    }
    debugUserClosed = false;
    debugWin = null;
  });
}

function closeDebugWindow() {
  debugUserClosed = false; // 主窗口主动关闭(如 Esc/按钮退出),无需再通知
  if (debugWin && !debugWin.isDestroyed()) { try { debugWin.close(); } catch (e) {} }
  debugWin = null;
}


async function runSmoke() {
  const out = path.join(app.getPath('temp'), 'skeleton-previewer-smoke');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const logFile = path.join(out, 'smoke.log');
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    try { fs.appendFileSync(logFile, line + '\n'); } catch (err) { /* ignore */ }
    console.log(line);
  };

  // 捕获渲染端控制台
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  log('smoke start, output: ' + out);
  log('window title: ' + win.getTitle());

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 等待渲染端完成初始化
  await sleep(2500);

  const steps = [
    ['cat', 300],
    ['ui', 900],
    ['spine1', 1600],
    ['spine-wave', 900],
    ['db1', 1600],
    ['db2', 1700],
    ['spine38', 1800],
    ['spine38-708', 1800],
    ['zy', 1800],
    ['zy-zoom', 1400],
    ['guochang', 1800],
    ['spine38-708-qun', 1400],
    ['spine38-708-pose', 1200],
    ['spine38-708-anim2', 1500],
    ['spine38-708-anim3', 1500],
    ['features', 1500],
    ['mirror', 900],
    ['zoom-mode', 900],
    ['fav', 800],
    ['dnd-fav', 500],
    ['dnd-cat', 500],
    ['uncat-del', 600],
    ['subcat', 700],
    ['delcat', 800],
    ['itemmenu', 800],
    ['fix-center', 1200],
    ['home', 900],
    ['folder', 900],
    ['viewmode', 900],
    ['editmode', 1200],
    ['thumb', 1200],
    ['image-load', 1000],
    ['audio-load', 1000],
    ['audioplayer', 1200],
    ['audiohome', 1200],
    ['audioplaylist', 1200],
    ['img-bg', 900],
    ['img-mode', 900],
    ['back', 800],
    ['tab3d', 600],
    ['tags', 800],
    ['batchmenu', 900],
    ['ctrlshift', 900],
    ['tipicon', 800],
    ['favhome', 900],
    ['navfix', 900],
    ['scenetree', 900],
    ['toolhome', 900],
    ['batchui', 900],
    ['toolhistory', 900],
    ['ieoverwrite', 900],
    ['webgame', 900],
    ['crud', 400],
  ];

  for (const [step, wait] of steps) {
    let result = '';
    try {
      result = await win.webContents.executeJavaScript(`window.__smokeStep && window.__smokeStep('${step}')`, true);
      log(`step ${step} -> ${JSON.stringify(result)}`);
    } catch (err) {
      log(`step ${step} ERROR: ${err && err.message || err}`);
    }
    if (step !== 'crud') {
      await sleep(wait);
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(out, step + '.png'), img.toPNG());
        const sz = img.getSize();
        const bmp = img.toBitmap(); // 直接是 BGRA Buffer
        const data = bmp;
        const bg = [34, 36, 43]; // #22242b
        let nonBg = 0;
        const colors = {};
        for (let i = 0; i < data.length; i += 4) {
          const b = data[i], g = data[i + 1], r = data[i + 2], a = data[i + 3];
          if (a < 10) continue;
          if (Math.abs(r - bg[0]) > 12 || Math.abs(g - bg[1]) > 12 || Math.abs(b - bg[2]) > 12) {
            nonBg++;
            const key = `${r >> 4},${g >> 4},${b >> 4}`;
            colors[key] = (colors[key] || 0) + 1;
          }
        }
        const top = Object.entries(colors).sort((x, y) => y[1] - x[1]).slice(0, 8);
        log(`captured ${step}.png size=${sz.width}x${sz.height} nonBg=${nonBg} ratio=${(nonBg / (sz.width * sz.height)).toFixed(4)} top=${JSON.stringify(top)}`);
      } catch (err) {
        log(`capture ${step} ERROR: ${err && err.message || err}`);
      }
    } else {
      await sleep(wait);
    }
  }

  log('smoke done');
  log('[smoke] db stats: ' + JSON.stringify(dbStats()));
  app.exit(0);
}

// 单实例锁:避免重复启动多个实例抢同一个 DB / 本地端口(13456)导致报错。
// 重复启动时只聚焦已有窗口, 而不是再起一个实例。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    } catch (e) { /* ignore */ }
  });

app.whenReady().then(async () => {
  const _t0 = Date.now();
  const _T = (l) => console.log('[main-init]', Date.now() - _t0, 'ms', l);
  migrateFromJson(); // 旧版 data.json → SQLite
  _T('migrateFromJson');
  db = readDb();
  _T('readDb');
  seedSamples();
  _T('seedSamples');
  enrichItemsMeta();
  _T('enrichItemsMeta');
  refreshRoots();
  _T('refreshRoots');

  server = createServer({ dist: DIST_DIR, roots: () => roots, previewRoots: () => previewRoots });
  await server.ready;
  _T('server ready');

  // 先注册全部 IPC handler(渲染端启动 loadState 立即调 db:read, 必须在 createWindow 前就绪)
  ipcMain.handle('db:read', () => db);
  ipcMain.handle('db:write', (_e, data) => {
    db = data;
    writeDb(db);
    refreshRoots();
    return true;
  });
  ipcMain.handle('db:stats', () => dbStats());
  ipcMain.handle('dir:pick', async (_e, opts) => {
    if (!win) return { canceled: true, filePaths: [] };
    // opts: { title?, multi?, defaultPath? } —— 「另存..」等场景可传自定义标题/单选/默认目录
    const r = await dialog.showOpenDialog(win, {
      title: (opts && opts.title) || '选择包含游戏资源的目录(可多选)',
      defaultPath: (opts && opts.defaultPath) || undefined,
      properties: ['openDirectory'].concat((opts && opts.multi) ? ['multiSelections'] : []),
    });
    return { canceled: r.canceled, filePaths: r.filePaths };
  });
  ipcMain.handle('dir:scan', (_e, dir, recursive) => {
    try {
      const s = (db && db.settings) || {};
      const customTypes = Array.isArray(s.customTypes) ? s.customTypes : [];
      const customGroups = Array.isArray(s.customTypeGroups) ? s.customTypeGroups : [];
      return scanDir(dir, !!recursive, customTypes, customGroups);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- 调试模式独立检视窗口 ----
  ipcMain.handle('debug:open', () => { try { openDebugWindow(); } catch (e) { console.error('debug:open', e); } });
  ipcMain.handle('debug:close', () => { try { closeDebugWindow(); } catch (e) {} });
  // 主渲染进程把悬停组件信息发来 → 转发给调试窗口
  ipcMain.on('debug:update', (_e, info) => {
    if (debugWin && !debugWin.isDestroyed()) {
      try { debugWin.webContents.send('debug:update', info); } catch (e) {}
    }
  });
  // 调试窗口按钮:min / toggleMax / close
  ipcMain.on('debug:action', (_e, act) => {
    if (!debugWin || debugWin.isDestroyed()) return;
    try {
      if (act === 'min') debugWin.minimize();
      else if (act === 'toggleMax') { if (debugWin.isMaximized()) debugWin.restore(); else debugWin.maximize(); }
      else if (act === 'close') {
        debugUserClosed = true; // 标记用户主动关闭 → closed 时通知主窗口退出调试模式
        debugWin.close();
      }
    } catch (e) {}
  });
  // 调试窗口标题栏手动拖拽(JS 方案):按光标屏幕坐标移动窗口
  ipcMain.on('debug:dragStart', () => {
    if (!debugWin || debugWin.isDestroyed()) return;
    try {
      const cp = screen.getCursorScreenPoint();
      const b = debugWin.getBounds();
      debugDragOffset = { dx: cp.x - b.x, dy: cp.y - b.y };
    } catch (e) { debugDragOffset = null; }
  });
  ipcMain.on('debug:dragMove', () => {
    if (!debugWin || debugWin.isDestroyed() || !debugDragOffset) return;
    try {
      const cp = screen.getCursorScreenPoint();
      debugWin.setPosition(Math.round(cp.x - debugDragOffset.dx), Math.round(cp.y - debugDragOffset.dy));
    } catch (e) { /* ignore */ }
  });
  ipcMain.on('debug:dragEnd', () => { debugDragOffset = null; });
  // 焦点在调试窗口时按 Ctrl → 转发主窗口执行暂停/恢复调试信息获取
  ipcMain.on('debug:togglePause', () => {
    try { if (win && !win.isDestroyed()) win.webContents.send('debug:togglePause'); } catch (e) { /* ignore */ }
  });
  // 项目源码根目录:settings.sourceRoot 优先,默认应用目录
  ipcMain.handle('debug:getEnv', () => {
    try {
      let root = app.getAppPath();
      try {
        const db = readDb();
        if (db && db.settings && db.settings.sourceRoot) root = db.settings.sourceRoot;
      } catch (e) { /* ignore */ }
      return { root };
    } catch (e) { return { root: app.getAppPath() }; }
  });
  // 调试窗口「源码位置」右键:打开目录 / 编辑文件(默认 Notepad++ 定位行号,可配置编辑器)
  ipcMain.on('debug:sourceAction', async (_e, payload) => {
    const { action, rel, line } = payload || {};
    if (!rel) return;
    const respond = (msg) => {
      try { if (debugWin && !debugWin.isDestroyed()) debugWin.webContents.send('debug:sourceResult', String(msg)); } catch (e) { /* ignore */ }
    };
    let root = app.getAppPath();
    let editor = '';
    try {
      const db = readDb();
      if (db && db.settings) {
        if (db.settings.sourceRoot) root = db.settings.sourceRoot;
        editor = db.settings.editorPath || '';
      }
    } catch (e) { /* ignore */ }
    const file = path.resolve(root, String(rel));
    try {
      if (action === 'openDir') {
        if (fs.existsSync(file)) { shell.showItemInFolder(file); respond('已打开所在目录并选中文件'); }
        else {
          const dir = path.dirname(file);
          if (fs.existsSync(dir)) { shell.openPath(dir); respond('文件不存在,已打开上级目录'); }
          else respond('文件与目录均不存在: ' + file);
        }
      } else if (action === 'edit') {
        if (!fs.existsSync(file)) { respond('源码文件不存在: ' + file); return; }
        if (!editor || !fs.existsSync(editor)) {
          const def = 'C:\\Program Files\\Notepad++\\notepad++.exe';
          if (fs.existsSync(def)) editor = def;
        }
        if (!editor || !fs.existsSync(editor)) {
          const r = await dialog.showOpenDialog(win, {
            title: '选择代码编辑器',
            properties: ['openFile'],
            filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd'] }],
          });
          if (r.canceled || !r.filePaths.length) return;
          editor = r.filePaths[0];
          try { const d = readDb(); d.settings = d.settings || {}; d.settings.editorPath = editor; writeDb(d); } catch (e) { /* ignore */ }
        }
        const bn = path.basename(editor).toLowerCase();
        let args;
        if (Number.isInteger(line) && line > 0) {
          if (bn.startsWith('code')) args = ['--goto', `${file}:${line}`]; // VS Code
          else if (bn.includes('notepad++')) args = ['-n' + line, file];   // Notepad++
          else args = [file];
        } else args = [file];
        try {
          spawn(editor, args, { detached: true, stdio: 'ignore' }).unref();
          respond(`已打开 ${path.basename(file)}${Number.isInteger(line) && line > 0 ? '，定位到第 ' + line + ' 行' : ''}`);
        } catch (err) { respond('启动编辑器失败: ' + err.message); }
      }
    } catch (err) { respond('操作失败: ' + err.message); }
  });
  ipcMain.handle('fs:stat', (_e, p) => {
    try {
      const s = fs.statSync(p);
      return { size: s.size, mtime: Math.round(s.mtimeMs), created: Math.round(s.birthtimeMs || s.ctimeMs || 0) };
    } catch (err) {
      return null;
    }
  });
  // 列目录: 返回 { ok, files: [{name, isDir, size}] } (目录不存在/失败时 ok=false)
  ipcMain.handle('fs:listDir', (_e, p) => {
    try {
      const files = fs.readdirSync(p, { withFileTypes: true })
        .map((d) => ({
          name: d.name,
          isDir: d.isDirectory(),
          size: d.isFile() ? fs.statSync(path.join(p, d.name)).size : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 拖拽添加:混合路径列表(文件/目录) → 扫描识别条目(目录递归);roots=拖入的目录路径(供按目录建子分类)
  ipcMain.handle('fs:scanPaths', (_e, { paths } = {}) => {
    try {
      const list = Array.isArray(paths) ? paths : [];
      const out = [];
      const roots = [];
      for (const p of list) {
        if (typeof p !== 'string' || !p) continue;
        try {
          if (fs.statSync(p).isDirectory()) roots.push(p);
        } catch (err) { /* 非目录/不存在按文件处理 */ }
        const entries = scanPath(p, true);
        for (const e of entries) {
          // 去重(同文件可能因目录嵌套重复出现)
          if (!out.some((x) => x.file === e.file)) out.push(e);
        }
      }
      return { ok: true, entries: out, roots };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // ---- 缩略图持久化缓存(userData/thumbnails/<itemId>.png) ----
  ipcMain.handle('thumb:get', (_e, itemId) => {
    try {
      const p = path.join(app.getPath('userData'), 'thumbnails', safeId(itemId) + '.png');
      if (!fs.existsSync(p)) return null;
      return fs.readFileSync(p).toString('base64');
    } catch (err) {
      return null;
    }
  });
  ipcMain.handle('thumb:save', (_e, itemId, dataUrl) => {
    try {
      const dir = path.join(app.getPath('userData'), 'thumbnails');
      fs.mkdirSync(dir, { recursive: true });
      const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, safeId(itemId) + '.png'), Buffer.from(base64, 'base64'));
      return true;
    } catch (err) {
      return false;
    }
  });
  ipcMain.handle('thumb:delete', (_e, itemId) => {
    try {
      // 按 itemId 前缀删除所有版本(文件名 <safeId(itemId)>_<updatedAt>.png)
      const dir = path.join(app.getPath('userData'), 'thumbnails');
      if (!fs.existsSync(dir)) return true;
      const prefix = safeId(itemId) + '_';
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(prefix)) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (err) { /* ignore */ }
        }
      }
      return true;
    } catch (err) {
      return false;
    }
  });
  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  // 启动外部程序/打开网页(侧栏菜单终端节点 action=exe 时调用)。
  // - URL(如 https://...) → 系统默认浏览器打开
  // - 本地程序 → 支持「"路径含空格" 参数」或「直接粘贴含空格/中文的路径」,spawn 不经过 shell,路径安全
  ipcMain.handle('app:openExternal', (_e, cmd) => {
    if (!cmd || typeof cmd !== 'string') return { error: '未提供程序路径' };
    const raw = cmd.trim();
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
      shell.openExternal(raw);
      return { ok: true, kind: 'url' };
    }
    const m = /^"([^"]+)"(?:\s+(.*))?$/.exec(raw);
    let exe, args = [];
    if (m) {
      exe = m[1];
      if (m[2]) args = m[2].trim().split(/\s+/);
    } else {
      exe = raw; // 整体作为可执行文件路径(含空格/中文)
    }
    return new Promise((resolve) => {
      try {
        const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', (err) => resolve({ error: err.message }));
        child.once('spawn', () => resolve({ ok: true, kind: 'exe' }));
        child.unref();
      } catch (err) {
        resolve({ error: err.message });
      }
    });
  });
  // 提取文件/程序图标(app.getFileIcon,Windows 支持 exe/ico 等资源图标)
  ipcMain.handle('icon:fromFile', async (_e, p) => {
    // 解析:引号包裹 → 取引号内;整串不存在(可能带参数/空格)→ 回退取第一个空格前的路径
    let target = String(p || '').trim();
    const q = /^"([^"]+)"/.exec(target);
    if (q) target = q[1];
    if (target && !fs.existsSync(target)) {
      const sp = target.indexOf(' ');
      if (sp > 0) {
        const head = target.slice(0, sp);
        if (fs.existsSync(head)) target = head;
        else return { ok: false };
      } else {
        return { ok: false };
      }
    }
    if (!target || !fs.existsSync(target)) return { ok: false };
    try {
      const img = await app.getFileIcon(target, { size: 'large' });
      if (!img || img.isEmpty()) return { ok: false };
      const buf = img.toPNG();
      return { ok: true, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    pictures: app.getPath('pictures'),
    downloads: app.getPath('downloads'),
    samplesDir: SAMPLES_DIR,
    dbFile: dbFile(),
  }));

  // ============ 开发者调试服务(CDP)开关 ============
  // 查询: 开关状态 + 端口 + 当前是否真的在监听
  ipcMain.handle('cdp:getState', async () => {
    const st = devCdp.readState();
    const listening = st.enabled ? await devCdp.probePort(st.port) : false;
    return { enabled: st.enabled, port: st.port, listening };
  });
  // 切换: 写标志后自动重启生效(CDP 端口只能在进程启动时开启)
  ipcMain.handle('cdp:setState', (_e, { enabled, port } = {}) => {
    devCdp.saveState({ enabled: !!enabled, port });
    setTimeout(() => {
      try {
        app.relaunch({ args: devCdp.relaunchArgs() });
        app.quit();
      } catch (err) {
        console.log('[devCdp] relaunch failed', err.message);
      }
    }, 300);
    return { ok: true };
  });
  // 打开「Chrome DevTools 连接说明」独立文档窗口(已打开则聚焦)
  ipcMain.handle('cdp:doc', () => {
    try {
      if (cdpDocWin && !cdpDocWin.isDestroyed()) {
        cdpDocWin.focus();
        return { ok: true };
      }
      cdpDocWin = new BrowserWindow({
        width: 920, height: 780,
        title: 'Chrome DevTools 连接说明',
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      cdpDocWin.loadFile(path.join(__dirname, '..', 'dist', 'cdp-doc.html'));
      cdpDocWin.on('closed', () => { cdpDocWin = null; });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 打开「CDP 工具面板」独立窗口(交互式调试操作台,已打开则聚焦)
  let cdpDashWin = null;
  ipcMain.handle('cdp:dashboard', () => {
    try {
      if (cdpDashWin && !cdpDashWin.isDestroyed()) {
        cdpDashWin.focus();
        return { ok: true };
      }
      cdpDashWin = new BrowserWindow({
        width: 1100, height: 720,
        title: 'CDP 工具面板',
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      cdpDashWin.loadFile(path.join(__dirname, '..', 'dist', 'cdp-dashboard.html'));
      cdpDashWin.on('closed', () => { cdpDashWin = null; });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ============ 资源工具箱:文件选取 / 通用读写 ============
  ipcMain.handle('fs:pickFiles', async (_e, opts = {}) => {
    if (!win) return { canceled: true, filePaths: [] };
    const filters = Array.isArray(opts.filters) && opts.filters.length
      ? opts.filters
      : [{ name: '所有文件', extensions: ['*'] }];
    let properties = ['openFile', 'multiSelections'];
    if (opts.filesAndDirs) properties = ['openFile', 'openDirectory', 'multiSelections'];
    else if (opts.directory) properties = ['openDirectory'];
    const r = await dialog.showOpenDialog(win, {
      title: opts.title || '选择文件',
      properties,
      filters,
      // 历史目录定位:defaultPath 为最近使用的输入目录
      defaultPath: (typeof opts.defaultPath === 'string' && opts.defaultPath) ? opts.defaultPath : undefined,
    });
    return { canceled: r.canceled, filePaths: r.filePaths };
  });
  // 图标库:导入 PNG/ICO → PNG dataURL(供节点图标使用;nativeImage 支持 ICO,统一转 PNG)
  ipcMain.handle('icon:import', async (_e) => {
    if (!win) return { ok: false, error: 'no window' };
    const r = await dialog.showOpenDialog(win, {
      title: '选择图标文件(PNG / ICO)',
      properties: ['openFile'],
      filters: [{ name: '图标文件', extensions: ['png', 'ico'] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const p = r.filePaths[0];
    try {
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) return { ok: false, error: '无法读取图片文件' };
      const buf = img.resize({ width: 96, height: 96, quality: 'good' }).toPNG();
      return { ok: true, path: p, dataUrl: `data:image/png;base64,${buf.toString('base64')}`, size: buf.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fs:readBase64', (_e, p) => {
    try {
      const buf = fs.readFileSync(p);
      const mime = mimeOfExt(path.extname(p).slice(1).toLowerCase());
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fs:writeFileBase64', (_e, filePath, dataUrl) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const s = String(dataUrl || '');
      const m = /^data:(?:image\/[a-zA-Z0-9+.\-]+|application\/octet-stream);base64,(.+)$/.exec(s);
      const b64 = m ? m[1] : s.replace(/^data:[^,]+,/, '');
      fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 重命名文件(仅改文件名,不跨目录移动):返回新路径或错误
  ipcMain.handle('fs:rename', (_e, oldPath, newPath) => {
    try {
      if (!fs.existsSync(oldPath)) return { ok: false, error: '原文件不存在' };
      if (path.dirname(oldPath) !== path.dirname(newPath)) {
        return { ok: false, error: '只能修改文件名,不能移动目录' };
      }
      if (fs.existsSync(newPath)) return { ok: false, error: '目标文件名已存在' };
      fs.renameSync(oldPath, newPath);
      return { ok: true, path: newPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ============ 资源工具箱:转换工具 ============
  ipcMain.handle('tool:astc2png', async (_e, { inputPath, outputPath }) => {
    try {
      const r = astcToPng(inputPath, outputPath);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('tool:skel2json', async (_e, { inputPath, outputPath }) => {
    try {
      const r = await skelToJson(inputPath, outputPath);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 校验文件是否为有效的 Spine 二进制骨架(skel)。.bin 后缀文件实为 skel 但扩展名不同,
  // 选择时据此探测是否真为 skel 格式,避免把无关二进制当骨架转换。
  ipcMain.handle('tool:probeSkel', async (_e, { inputPath }) => {
    try {
      const bytes = fs.readFileSync(inputPath);
      const probe = probeSkeleton(bytes);
      if (!probe || probe.kind !== 'binary') {
        return { ok: false, reason: '不是有效的 Spine 二进制骨架(skel)格式' };
      }
      return { ok: true, version: probe.version };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
  ipcMain.handle('tool:spinefix', async (_e, { inputPath, outputPath }) => {
    try {
      const r = await spineFix(inputPath, outputPath);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // LayaAir 骨骼动画(.sk)→ Spine 可读文件(.json 骨架 + .atlas 纹理图集)逆向转换
  ipcMain.handle('tool:sk2spine', async (_e, { inputPath, outputPath }) => {
    try {
      const r = skToSpine(inputPath, outputPath);
      return r; // 已含 { ok, jsonPath, atlasPath, version, warn, stats }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 探测文件是否为 LayaAir 骨骼动画二进制(.sk)
  ipcMain.handle('tool:probeSk2spine', async (_e, { inputPath }) => {
    try {
      const bytes = fs.readFileSync(inputPath);
      const probe = probeLayaSk(bytes);
      if (!probe.ok) return { ok: false, reason: probe.reason };
      return { ok: true, version: probe.version };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
  // .sk 内存转换(Spine json+atlas 文本) + 配套图集 PNG(base64),供动画预览直接播放(不写文件)
  ipcMain.handle('tool:sk2spinePreview', async (_e, { inputPath }) => {
    try {
      const r = skToSpineText(inputPath);
      if (!r.ok) return r;
      // 配套图集图片:优先 atlas 页名(同目录),其次同名 .png/.jpg
      let pngBase64 = null;
      const dir = path.dirname(inputPath);
      const base = path.basename(inputPath).replace(/\.[^.]+$/, '');
      const candidates = [
        r.pageSrc ? path.join(dir, r.pageSrc) : null,
        path.join(dir, base + '.png'),
        path.join(dir, base + '.jpg'),
      ];
      for (const c of candidates) {
        if (c && fs.existsSync(c)) {
          const ext = path.extname(c).toLowerCase();
          const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
          pngBase64 = `data:${mime};base64,${fs.readFileSync(c).toString('base64')}`;
          break;
        }
      }
      return { ok: true, json: r.json, atlas: r.atlas, pngBase64, version: r.version, warn: r.warn };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ============ 资源工具箱:Spine 骨骼格式/版本转换 ============
  // 复用 SpineSkeletonDataConverter(C++ 原生):skel ↔ json,跨版本 3.5-3.8 / 4.0-4.3 升降级,自动识别输入版本。
  ipcMain.handle('tool:spineConvert', async (_e, { inputPath, outputPath, targetVersion, removeCurve }) => {
    const exe = spineConverterExePath();
    if (!fs.existsSync(exe)) {
      return { ok: false, error: '未找到 SpineSkeletonDataConverter.exe,请先构建转换工具(npm run build:spine-converter)。' };
    }
    if (!inputPath || !outputPath) return { ok: false, error: '缺少输入或输出路径' };
    const args = [inputPath, outputPath];
    if (targetVersion && targetVersion !== 'auto') {
      args.push('-v', spineMajorMinorToFull(targetVersion));
    }
    if (removeCurve) args.push('--remove-curve');
    return new Promise((resolve) => {
      let out = '', err = '';
      try {
        const cp = spawn(exe, args, { windowsHide: true });
        cp.stdout.on('data', (d) => { out += d.toString('utf8'); });
        cp.stderr.on('data', (d) => { err += d.toString('utf8'); });
        cp.on('error', (e) => resolve({ ok: false, error: '启动转换程序失败:' + e.message }));
        cp.on('close', (code) => {
          if (code === 0) resolve({ ok: true, stdout: out.trim() });
          else resolve({ ok: false, error: (err || out || '转换失败(exit ' + code + ')').trim() });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  });
  // 探测文件:版本 + 格式(供 UI 自动识别显示)
  ipcMain.handle('tool:spineProbe', async (_e, { inputPath }) => {
    try {
      return probeSpineFile(inputPath);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
  // 注册一个临时目录到静态服务 previewRoots,返回 token,供预览用 /spine-pv/<token>/ 加载骨架+图集
  ipcMain.handle('tool:spinePreviewRegister', async (_e, { dir }) => {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return { ok: false, error: '目录不存在或无效:' + dir };
      }
      const token = 'spc_' + crypto.randomBytes(8).toString('hex');
      previewRoots.set(token, dir);
      return { ok: true, token };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ============ FGUI 逆向:探测 / 单包解析 / 目录批量导出 ============
  // 探测文件是否为 FGUI 包(.bin 魔数 FGUII)
  ipcMain.handle('fgui:probe', async (_e, { inputPath }) => {
    try {
      const data = fs.readFileSync(inputPath);
      return { ok: true, isFgui: fgui.probeFgui(data) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 解析单个 FGUI 包 → 结构树 + 包级 XML + 组件 XML 列表
  ipcMain.handle('fgui:parse', async (_e, { inputPath }) => {
    try {
      const r = fgui.parseFile(inputPath);
      // 只回传渲染端需要的部分(避免大 Buffer / 非序列化字段)
      const info = JSON.parse(JSON.stringify(r.pkg));
      delete info.rawById;
      return { ok: true, pkg: info, packageXml: r.packageXml, componentXmls: r.componentXmls,
               srcDir: path.dirname(inputPath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 批量导出: 目录下全部 .bin → 输出目录(JSON + 包级 XML + 组件 XML)
  ipcMain.handle('fgui:batchExport', async (_e, { inputDir, outputDir }) => {
    try {
      return fgui.batchExport(inputDir, outputDir);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 单文件导出: 一个 .bin → 输出目录(预览页「解压 FGUI 包」用)
  ipcMain.handle('fgui:exportSingle', async (_e, { inputPath, outputDir }) => {
    try {
      const r = fgui.exportFile(inputPath, outputDir);
      // 共享单图素材库根目录: {gameRoot}/ui/fgui_texture/fgui (未识别到游戏根时为 null, 渲染端回退旧复制行为)
      let spriteLibDir = null;
      const gameRoot = findGameRoot(path.dirname(inputPath));
      if (gameRoot) spriteLibDir = path.join(gameRoot, 'ui', 'fgui_texture', 'fgui');
      return { ...r, spriteLibDir };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 源工程还原: 一个 .bin → outDir/<包名>/ (完整可被 FairyGUI 编辑器打开的包目录)
  ipcMain.handle('fgui:exportSource', async (_e, { inputPath, outputDir, textureDir }) => {
    try {
      return fgui.restoreSourcePkg(inputPath, outputDir, { textureDir: textureDir || null });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 保存源工程编辑: 将编辑器中的节点属性修改写回 FGUI_src/<包名>/<组件名>.xml 的 displayList
  // nodes: [{id, x, y, width, height, rotation, alpha, visible, scaleX, scaleY}]
  ipcMain.handle('fgui:saveSourceEdits', async (_e, { inputPath, compName, nodes }) => {
    try {
      return fgui.saveSourceEdits(inputPath, compName, nodes || []);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // FGUI 布局预览: 解析 .bin → 可渲染 RenderNode 树 + 控制器 + 纹理探测结果
  ipcMain.handle('fgui:previewLoad', async (_e, { inputPath, textureDir }) => {
    try {
      return buildPreviewData(inputPath, { textureDir });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 递归收集文件(支持多选文件 / 文件夹混合):给定若干路径,返回所有匹配扩展名的文件绝对路径,
  // 并记录每个文件所属"根目录"(直接选中的文件 → 其所在目录;选中的文件夹 → 文件夹本身),
  // 供批量转换时计算"保持相对目录结构"的输出位置。
  ipcMain.handle('tool:collectFiles', async (_e, { paths = [], extensions = [] }) => {
    try {
      const exts = extensions.map((e) => String(e).toLowerCase().replace(/^\./, ''));
      const files = [];
      const visited = new Set();
      const addFile = (p, baseDir) => {
        const key = path.resolve(p).toLowerCase();
        if (visited.has(key)) return;
        visited.add(key);
        files.push({ path: path.resolve(p), baseDir: path.resolve(baseDir) });
      };
      const walk = (p, baseDir) => {
        let st;
        try { st = fs.statSync(p); } catch (e) { return; }
        if (st.isDirectory()) {
          let ents;
          try { ents = fs.readdirSync(p); } catch (e) { return; }
          for (const name of ents) {
            if (name === 'node_modules' || name === '.git' || name === '.svn') continue;
            walk(path.join(p, name), baseDir);
          }
        } else if (st.isFile()) {
          const ext = path.extname(p).slice(1).toLowerCase();
          if (exts.length && !exts.includes(ext)) return;
          addFile(p, baseDir);
        }
      };
      // 文件优先处理(保证直接选中的文件 baseDir=自身所在目录),之后遍历文件夹
      const dirs = [], fileList = [];
      for (const p of paths) {
        let st; try { st = fs.statSync(p); } catch (e) { continue; }
        if (st.isDirectory()) dirs.push(p); else fileList.push(p);
      }
      for (const p of fileList) {
        let st; try { st = fs.statSync(p); } catch (e) { continue; }
        addFile(p, path.dirname(p));
      }
      for (const d of dirs) walk(d, d);
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ============ 音频播放器:目录列表 / ID3 元信息 ============
  const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.wma', '.m4a', '.aac', '.opus'];
  // 列出指定目录(不递归)下所有音频文件
  ipcMain.handle('audio:listDir', (_e, dir) => {
    try {
      const out = [];
      for (const name of fs.readdirSync(dir)) {
        if (!fs.statSync(path.join(dir, name)).isFile()) continue;
        if (!AUDIO_EXTS.includes(path.extname(name).toLowerCase())) continue;
        out.push(path.join(dir, name));
      }
      return { ok: true, files: out.sort() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 读取音频文件 ID3 元信息(标题/艺术家/专辑/年份/音轨/注释)
  ipcMain.handle('audio:readMeta', (_e, filePath) => {
    try {
      const NodeID3 = require('node-id3');
      const t = NodeID3.read(filePath) || {};
      const pick = (v) => (v == null ? '' : String(v));
      return {
        ok: true,
        tags: {
          title: pick(t.title), artist: pick(t.artist), album: pick(t.album),
          year: pick(t.year), track: pick(t.trackNumber || ''), comment: pick(t.comment && t.comment.text),
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 批量读取音频 ID3 元信息(播放列表条目显示用)
  ipcMain.handle('audio:readMetas', (_e, paths = []) => {
    try {
      const NodeID3 = require('node-id3');
      const pick = (v) => (v == null ? '' : String(v));
      const out = [];
      for (const p of paths) {
        let tags = {};
        try {
          const t = NodeID3.read(p) || {};
          tags = {
            title: pick(t.title), artist: pick(t.artist), album: pick(t.album),
            year: pick(t.year), track: pick(t.trackNumber || ''), comment: pick(t.comment && t.comment.text),
          };
        } catch (e) { /* 单文件失败跳过 */ }
        out.push({ path: p, tags });
      }
      return { ok: true, items: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // 写入音频文件 ID3 元信息(仅写入提供的字段)
  ipcMain.handle('audio:writeMeta', (_e, filePath, tags = {}) => {
    try {
      const NodeID3 = require('node-id3');
      const patch = {};
      if (tags.title != null) patch.title = String(tags.title);
      if (tags.artist != null) patch.artist = String(tags.artist);
      if (tags.album != null) patch.album = String(tags.album);
      if (tags.year != null) patch.year = String(tags.year);
      if (tags.track != null) patch.trackNumber = String(tags.track);
      if (tags.comment != null) patch.comment = { language: 'eng', text: String(tags.comment) };
      const ok = NodeID3.update(patch, filePath);
      if (!ok) return { ok: false, error: '写入失败(文件可能不支持 ID3 或只读)' };
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- 网页游戏逆向分析:内嵌浏览器 / 请求拦截 / 资源下载 ----
  ipcMain.handle('web:open', (_e, { url, ua, proxy } = {}) => {
    try {
      if (!url) return { ok: false, error: '缺少 URL' };
      return webGame.open(win, url, { ua, proxy });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('web:navigate', (_e, url) => {
    try { return webGame.navigate(url); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:goBack', () => {
    try { return webGame.goBack(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:goForward', () => {
    try { return webGame.goForward(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:reload', () => {
    try { return webGame.reload(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:devtools', (_e, action) => {
    // action: 'open' | 'close' — 独立窗口模式(detach)打开网页 DevTools
    try {
      if (action === 'close') return webGame.closeDevTools();
      return webGame.openDevTools();
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:close', () => {
    try { webGame.close(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  // 多标签: 新开 / 切换 / 关闭标签页 + 获取当前网址(收藏夹预填用)
  ipcMain.handle('web:newTab', (_e, url) => {
    try { return webGame.newTab(url); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:openOrSwitch', (_e, url) => {
    try { return webGame.openOrSwitch(url); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:switchTab', (_e, id) => {
    try { return webGame.switchTab(id); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:closeTab', (_e, id) => {
    try { return webGame.closeTab(id); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:getUrl', () => {
    try { return { ok: true, url: webGame.getCurrentUrl() }; } catch (err) { return { ok: false, error: err.message }; }
  });
  // 网页悬浮窗(切到其它模块时浏览器视图迁入独立窗口): 浮出 / 收回 / 最小化 / 关闭
  ipcMain.handle('web:floatOut', () => {
    try { return webGame.floatOut(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:floatBack', () => {
    try { return webGame.floatBack(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('float:minimize', () => {
    try { return webGame.floatMinimize(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('float:close', () => {
    try { return webGame.floatClose(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('float:restore', () => {
    try { return webGame.floatRestore(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('float:miniMoveBy', (_e, p) => {
    try { return webGame.floatMiniMoveBy(p && p.dx, p && p.dy); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 悬浮窗最大化 / 还原切换(系统样式)
  ipcMain.handle('float:toggleMax', () => {
    try {
      const w = webGame.floatWin;
      if (!w || w.isDestroyed()) return { ok: false, error: 'no float window' };
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:setBounds', (_e, rect) => {
    try { return webGame.setBounds(rect); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 打开网址收藏对话框(独立原生窗口, 盖在 WebContentsView 之上, 弹窗时网页保持可见)
  ipcMain.handle('web:openBookmarkDialog', (_e, opts) => {
    try { return bookmarkDialog.open(opts, webGame.win); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:setAudioMuted', (_e, muted) => {
    // 一键静音 / 取消禁音网页音频(muted: boolean) —— 按当前活动标签所属网站(host)静音
    try { return webGame.setAudioMuted(muted); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 按网站(host)静音 / 取消静音 / 切换(右键菜单"将这个网站静音"用)
  ipcMain.handle('web:muteSite', (_e, host) => {
    try { return webGame.muteSite(host); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:unmuteSite', (_e, host) => {
    try { return webGame.unmuteSite(host); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:toggleSiteMute', (_e, host) => {
    try { return webGame.toggleSiteMute(host); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 将指定标签页移至独立悬浮窗口(右键菜单"将标签页移至新窗口"用)
  ipcMain.handle('web:moveTabToWindow', (_e, tabId) => {
    try { return webGame.moveTabToNewWindow(tabId); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 网页标签右键菜单: 用原生 OS 菜单弹出 —— 始终盖在 WebContentsView 之上, 不会被网页内容遮挡
  // (WebContentsView 是 native 视图, DOM 浮层盖不住它, 只有原生菜单能压在它上面)
  ipcMain.handle('web:tabMenu', (_e, p) => {
    try {
      const win = webGame.win;
      if (!win || win.isDestroyed()) return { ok: false, error: 'no window' };
      const items = [
        { label: '🪟 将标签页移至新窗口', click: () => { try { webGame.moveTabToNewWindow(p && p.tid); } catch (e) {} } },
      ];
      if (p && p.host) {
        items.push({
          label: ((p.muted ? '🔊 取消静音此网站' : '🔇 将这个网站静音') + ' (' + p.host + ')'),
          click: () => { try { webGame.toggleSiteMute(p.host); } catch (e) {} },
        });
      }
      const menu = Menu.buildFromTemplate(items);
      // 传入 window 时, x/y 为「窗口内容区(WebContents)」坐标, 与渲染端 e.clientX/clientY 一致;
      // 切勿再叠加 win.getPosition()(屏幕坐标), 否则菜单会被推到窗口之外很远的位置。
      const px = (p && Number.isFinite(p.x)) ? p.x : 0;
      const py = (p && Number.isFinite(p.y)) ? p.y : 0;
      menu.popup({ window: win, x: px, y: py });
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:getCaptured', () => {
    try { return { ok: true, records: webGame.getCaptured() }; } catch (err) { return { ok: false, error: err.message }; }
  });
  // 查询网页视图是否处于悬浮状态(渲染端重入网络资源抓取页时判断是否需折叠浏览器区)
  ipcMain.handle('web:isFloated', () => {
    try { return { ok: true, floated: webGame.isFloated() }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:clearCaptured', () => {
    try { return webGame.clearCaptured(); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:probe', (_e, p) => {
    try { return probeFile(p).then((type) => ({ ok: true, type })); } catch (err) { return { ok: false, error: err.message }; }
  });
  // 下载: 返回 { ok, path, size, type, url }; 进度经 web:progress 推送
  ipcMain.handle('web:download', (_e, args) => {
    const { url, savePath, referrer, ua, proxy, type } = args || {};
    if (!url || !savePath) return Promise.resolve({ ok: false, error: '缺少 url/savePath' });
    const lastPush = { t: 0 };
    return downloadResource({ url, referrer, ua, proxy }, savePath, (p) => {
      const now = Date.now();
      if (now - lastPush.t >= 100 || p.percent >= 100) {
        lastPush.t = now;
        try { win.webContents.send('web:progress', { ...p, type }); } catch (e) { /* ignore */ }
      }
    }).then((r) => {
      // 下载后探测真实类型(bin 魔数 / spine 特征), 供入库精确分类
      return probeFile(savePath).then((real) => ({ ok: true, path: r.path, size: r.size, mime: r.mime, url, type: real || type || classify(url, r.mime) }));
    }).catch((err) => ({ ok: false, error: err.message, url }));
  });
  // 抓取文本: 主进程下载 URL 正文到临时文件, 读取为 UTF-8 文本(截断 ~1MB),
  // 供渲染端与悬浮预览窗展示文本/脚本/配置而无需受 CSP 限制直接 fetch 外网。
  ipcMain.handle('web:fetchText', async (_e, args) => {
    if (!args || !args.url) return { ok: false, error: '缺少 url' };
    return fetchTextOf(args);
  });
  // 缩略图兜底: 用网页分区 session(persist:webgame)下载图片转 data URL,
  // 与网页共享登录态/Referer —— 解决渲染端 <img> 直连跨 session 无 cookie / 防盗链 403。
  ipcMain.handle('web:thumbFetch', async (_e, args) => {
    if (!args || !args.url) return { ok: false, error: '缺少 url' };
    try { return await webGame.fetchToDataUrl(args); } catch (err) { return { ok: false, error: err.message }; }
  });

  // ---- 开发工具箱:API 管理 接口测试(主进程代发 HTTP 请求, 渲染端 CSP 无法直连外部) ----
  ipcMain.handle('api:test', async (_e, args) => {
    try {
      return await apiTest(args || {});
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- 网址收藏对话框(独立原生窗口)结果回传主窗口渲染端, 并关闭对话框 ----
  bookmarkDialog.setNotifyResult((payload) => {
    try {
      if (webGame.win && !webGame.win.isDestroyed()) webGame.win.webContents.send('bookmark:dialogResult', payload);
    } catch (e) { /* ignore */ }
    try { bookmarkDialog.close(); } catch (e) { /* ignore */ }
  });

  // ---- 资源悬浮预览: 独立窗口(像 DevTools detach 一样脱离主窗口, 可自由悬浮到浏览器区上方) ----
  webPreviewWindow.setNotifyApp((evt, val) => {
    try {
      if (evt === 'closed') {
        win.webContents.send('web:previewClosed');
      } else if (evt === 'pin') {
        win.webContents.send('web:previewPinState', { pinned: !!val });
        const pw = webPreviewWindow.getWin();
        if (pw && !pw.isDestroyed()) pw.webContents.send('preview:pinState', !!val);
      }
    } catch (e) { /* ignore */ }
  });
  ipcMain.handle('web:previewShow', (_e, payload) => {
    try { webPreviewWindow.show(payload); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:previewHide', () => {
    try { webPreviewWindow.hide(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('web:previewClose', () => {
    try { webPreviewWindow.close(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  // 预览窗内部 IPC(由 previewPreload.js 调用)
  ipcMain.handle('preview:togglePin', () => {
    try { const p = webPreviewWindow.togglePin(); return { ok: true, pinned: p }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('preview:setPin', (_e, p) => {
    try { const v = webPreviewWindow.setPin(p); return { ok: true, pinned: v }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('preview:downloadDataUrl', async (_e, args) => {
    try { return await downloadToDataUrl(args || {}); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('preview:fetchText', async (_e, args) => {
    try { return await fetchTextOf(args || {}); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.on('preview:action', (_e, payload) => {
    try { win.webContents.send('web:previewAction', payload); } catch (err) { /* ignore */ }
  });

  loadDebugWinBounds(); // 读取调试窗口上次位置/大小存档
  await createWindow();
});
}

app.on('window-all-closed', () => {
  try { webPreviewWindow.close(); } catch (e) { /* ignore */ }
  try { webGame.destroy(); } catch (e) { /* ignore */ }
  app.quit();
});
