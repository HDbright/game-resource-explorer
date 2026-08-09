'use strict';
/** FGUI 批量添加冒烟: 目录递归扫描批量登记(含大小) / 目录页 size 显示 / 行点击打开预览 / 解压仅当前包 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-batch-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-batch-smoke');
const BATCH_DIR = path.join(TMP, 'pkgdir');        // 用户选择的目录
const BATCH_SUB = path.join(BATCH_DIR, 'sub');     // 子目录(递归用)
const CAT_NAME = '批量目录';
let uxCatId = null;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(BATCH_SUB, { recursive: true });
  const srcBin = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
  // 2 个包:ActEmperorArrival 在子目录, B 包在顶层 —— 递归扫描应两个都登记
  fs.copyFileSync(srcBin, path.join(BATCH_SUB, 'ActEmperorArrival.bin'));
  fs.copyFileSync(srcBin, path.join(BATCH_DIR, 'B.bin'));
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  d.scenes = (d.scenes || []).filter((s) => !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-batch-smoke'));
  uxCatId = 'cat_batch_' + Date.now();
  d.sceneCategories.push({
    id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 998,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  d.scenes = (d.scenes || []).filter((s) => s.categoryId !== uxCatId && !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-batch-smoke'));
  dbm.writeDb(d);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const fgui = require('../electron/tools/fgui');
const { scanDir } = require('../electron/scanner');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('dir:scan', (_e, dir, recursive) => scanDir(dir, !!recursive));
ipcMain.handle('fs:pickFiles', async (_e, opts) => {
  if (opts && opts.filesAndDirs) return { canceled: false, filePaths: [BATCH_DIR] }; // 添加FGUI包:给目录
  if (opts && opts.directory) {
    const dir = path.join(TMP, 'out');
    fs.mkdirSync(dir, { recursive: true });
    return { canceled: false, filePaths: [dir] };
  }
  return { canceled: false, filePaths: [] };
});
ipcMain.handle('fs:stat', (_e, p) => {
  try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; }
  catch (err) { return null; }
});
ipcMain.handle('fs:readBase64', (_e, p) => {
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ({ png: 'image/png', json: 'application/json' })[ext] || 'application/octet-stream';
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fs:writeFileBase64', (_e, filePath, dataUrl) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const m = /^data:[^,]+,base64,(.+)$/.exec(String(dataUrl || ''));
    const b64 = m ? m[1] : String(dataUrl || '').replace(/^data:[^,]+,/, '');
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return { ok: true, path: filePath };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:probe', async (_e, { inputPath }) => {
  try { return { ok: true, isFgui: fgui.probeFgui(fs.readFileSync(inputPath)) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:previewLoad', async (_e, { inputPath, textureDir }) => {
  try { return buildPreviewData(inputPath, { textureDir }); }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:exportSingle', async (_e, { inputPath, outputDir }) => {
  try { return fgui.exportFile(inputPath, outputDir); }
  catch (err) { return { ok: false, error: err.message }; }
});

app.whenReady().then(async () => {
  setup();
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // ---- 1) 场景主页:确认「添加FGUI包」按钮存在;进入「批量目录」目录页 ----
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot) { const a = sceneRoot.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } sceneRoot.click(); }
        await sleep(400);
        out.homeAddFguiBtn = !!document.getElementById('sc-add-fgui');
        // 点侧栏「批量目录」进目录页
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('批量目录'));
        out.catNodeFound = !!catNode;
        if (catNode) { catNode.click(); await sleep(500); }
        out.folderTitle = (document.querySelector('.folder-title') || {}).textContent || '';
        out.folderAddFguiBtn = !!document.getElementById('sf-add-fgui');
        // ---- 2) 目录页内点「🧩 添加FGUI包」→ pickFiles 返回目录 → 递归扫描登记到当前目录 ----
        const folderAddBtn = document.getElementById('sf-add-fgui');
        if (folderAddBtn) { folderAddBtn.click(); await sleep(400); } // → 弹「扫描范围」对话框
        out.scanDialog = !!((document.querySelector('.modal-title') || {}).textContent || '').includes('扫描目录中的 FGUI 包');
        const sels = document.querySelectorAll('.modal select');
        if (sels.length) { sels[0].selectedIndex = 1; }
        const okBtn = document.querySelector('.modal-foot button.primary');
        if (okBtn) { okBtn.click(); await sleep(1200); } // 扫描 + 登记 2 个包到当前目录
        // 调试:登记结果
        try {
          const dd = await window.api.dbRead();
          out.dbScenes = dd.scenes ? dd.scenes.length : -1;
          out.dbBatchScenes = dd.scenes ? dd.scenes.filter((s) => (s.categoryId || '') === ${JSON.stringify(uxCatId)}).length : -1;
          out.dbBatchNames = dd.scenes ? dd.scenes.filter((s) => (s.categoryId || '') === ${JSON.stringify(uxCatId)}).map((s) => s.name + ':' + (s.size || 'null')).join(',') : '';
        } catch (e) { out.dbErr = e.message; }
        // ---- 3) 目录页表格:应显示 2 个 FGUI 包 + 大小 ----
        await sleep(400); // 重新渲染
        const rows = [...document.querySelectorAll('.scene-tr')].filter((r) => !r.classList.contains('scene-th'));
        out.rowCount = rows.length;
        out.rowNames = rows.map((r) => (r.querySelector('.scene-name-col') || {}).textContent || '').join(',');
        out.rowIcons = rows.map((r) => (r.querySelector('.scene-ico') || {}).textContent || '').join(',');
        out.rowSizes = rows.map((r) => (r.querySelector('.scene-size-col') || {}).textContent || '').join(',');
        out.hasSize = rows.every((r) => ((r.querySelector('.scene-size-col') || {}).textContent || '').trim() !== '—' && ((r.querySelector('.scene-size-col') || {}).textContent || '').trim() !== '');
        // ---- 3) 行点击(点名称列,非按钮)→ 打开预览 ----
        const targetRow = rows.find((r) => ((r.querySelector('.scene-name-col') || {}).textContent || '').includes('ActEmperorArrival'));
        out.targetRowFound = !!targetRow;
        if (targetRow) { targetRow.querySelector('.scene-name-col').click(); await sleep(1200); }
        const canvas = document.getElementById('fgpv-canvas');
        out.previewOpened = !!canvas;
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        out.regText = (document.getElementById('fgpv-reg') || {}).textContent || '';
        // ---- 4) 解压:只解当前预览的包(ActEmperorArrival),不产生 B/ ----
        const unpackBtn = document.getElementById('fgpv-unpack');
        if (unpackBtn && !unpackBtn.disabled) { unpackBtn.click(); await sleep(900); }
        out.statusAfterUnpack = (document.getElementById('fgpv-status') || {}).textContent || '';
        return out;
      })()`, true);
      // 主进程侧:检查解压产物只含当前包
      const pkgOut = path.join(BATCH_SUB, 'ActEmperorArrival');
      res.unpackDirExists = fs.existsSync(pkgOut);
      res.unpackFiles = fs.existsSync(pkgOut) ? fs.readdirSync(pkgOut).filter((f) => /\.(json|xml)$/.test(f)).join(',') : '';
      res.bDirExists = fs.existsSync(path.join(BATCH_DIR, 'B')); // 不应存在(未解压 B)
      console.log('FGUI-BATCH-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.homeAddFguiBtn && res.scanDialog && res.catNodeFound &&
                 res.rowCount === 2 && res.rowNames.includes('ActEmperorArrival') && res.rowNames.includes('B') &&
                 res.rowIcons.split(',').every((i) => i.includes('🧩')) && res.hasSize &&
                 res.targetRowFound && res.previewOpened && res.pkgText.includes('ActEmperorArrival') &&
                 /已登记:批量目录/.test(res.regText || '') &&
                 /已解压/.test(res.statusAfterUnpack || '') &&
                 res.unpackDirExists && res.unpackFiles.includes('ActEmperorArrival.json') && res.unpackFiles.includes('.xml') &&
                 !res.bDirExists;
      console.log('FGUI-BATCH-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
      cleanup();
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SMOKE-ERR', e);
      cleanup();
      process.exit(1);
    }
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
