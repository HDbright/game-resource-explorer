'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createServer } = require('./server');
const { readDb, writeDb, migrateFromJson, dbStats, dbFile } = require('./db');
const { scanDir } = require('./scanner');

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

const DIST_DIR = path.join(__dirname, '..', 'dist');
const SAMPLES_DIR = fs.existsSync(path.join(__dirname, '..', 'samples'))
  ? path.join(__dirname, '..', 'samples')
  : path.join(process.resourcesPath, 'samples');

let db = readDb();
let roots = new Map();

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
// 注意:不能依赖 zlib.crc32(Electron 主进程环境可能未暴露),自实现 CRC32 表
function makeSamplePng(size) {
  const w = size, h = size;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      raw[i] = Math.round(255 * x / w);
      raw[i + 1] = Math.round(120 + 100 * y / h);
      raw[i + 2] = Math.round(255 * (1 - x / w));
      raw[i + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(pngCrc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** 标准 CRC32(IEEE 802.3,PNG 用),自实现避免依赖 Electron 环境 API 差异 */
let _crcTable = null;
function pngCrc32(buf) {
  if (!_crcTable) {
    _crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      _crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1460,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    backgroundColor: '#1b1d23',
    title: `游戏资源管理器 v${appVersion}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
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
    ['back', 800],
    ['tab3d', 600],
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

app.whenReady().then(async () => {
  migrateFromJson(); // 旧版 data.json → SQLite
  db = readDb();
  seedSamples();
  enrichItemsMeta();
  refreshRoots();

  server = createServer({ dist: DIST_DIR, roots: () => roots });
  await server.ready;

  ipcMain.handle('db:read', () => db);
  ipcMain.handle('db:write', (_e, data) => {
    db = data;
    writeDb(db);
    refreshRoots();
    return true;
  });
  ipcMain.handle('db:stats', () => dbStats());
  ipcMain.handle('dir:pick', async () => {
    if (!win) return { canceled: true, filePaths: [] };
    const r = await dialog.showOpenDialog(win, {
      title: '选择包含游戏资源的目录(可多选)',
      properties: ['openDirectory', 'multiSelections'],
    });
    return { canceled: r.canceled, filePaths: r.filePaths };
  });
  ipcMain.handle('dir:scan', (_e, dir, recursive) => {
    try {
      return scanDir(dir, !!recursive);
    } catch (err) {
      return [];
    }
  });
  ipcMain.handle('fs:stat', (_e, p) => {
    try {
      const s = fs.statSync(p);
      return { size: s.size, mtime: Math.round(s.mtimeMs) };
    } catch (err) {
      return null;
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
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    samplesDir: SAMPLES_DIR,
    dbFile: dbFile(),
  }));

  await createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
