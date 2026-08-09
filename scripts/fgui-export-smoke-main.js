'use strict';
/** FGUI 导出资源冒烟: 点「导出资源」不再弹目录选择,直接导出到 bin 同目录/<包名>/,已存在文件时弹覆盖确认(取消/覆盖) */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-export-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-export-smoke');
const BIN_DIR = path.join(TMP, 'bin'); // bin 所在目录
const BIN_COPY = path.join(BIN_DIR, 'ActEmperorArrival.bin');
const PKG_OUT = path.join(BIN_DIR, 'ActEmperorArrival'); // 期望的包名子目录
const TEST_SCENE_ID = 'sn_exp_fgui';
const CAT_NAME = '导出分类';
let expCatId = null;
let pickDirCalls = 0;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin'), BIN_COPY);
  for (const f of ['ActEmperorArrival_atlas0.png', 'Common_atlas0.png', 'Common_atlas1.png']) {
    const s = path.join(__dirname, '..', 'samples', 'fgui', f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(BIN_DIR, f));
  }
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  expCatId = 'cat_exp_' + Date.now();
  d.sceneCategories.push({
    id: expCatId, name: CAT_NAME, remark: '', parentId: '', sort: 997,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID && !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-export-smoke'));
  d.scenes.push({
    id: TEST_SCENE_ID, categoryId: expCatId, name: '导出测试', filePath: BIN_COPY,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== expCatId);
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID && !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-export-smoke'));
  dbm.writeDb(d);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const fgui = require('../electron/tools/fgui');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async (_e, opts) => {
  if (opts && opts.directory) {
    pickDirCalls++; // 导出资源不应再触发目录选择
    return { canceled: true, filePaths: [] };
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
        const statusText = () => (document.getElementById('fgpv-status') || {}).textContent || '';
        // 1) 侧栏:展开场景根 → 展开「导出分类」→ 单击注入条目进预览
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot) { const a = sceneRoot.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('导出分类'));
        if (catNode) { const a2 = catNode.querySelector('.cat-arrow'); if (a2) { a2.click(); await sleep(250); } }
        const itemNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('导出测试'));
        out.sideItemFound = !!itemNode;
        if (itemNode) { itemNode.click(); await sleep(1200); }
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        const exportBtn = document.getElementById('fgpv-export');
        out.exportBtnEnabled = exportBtn ? !exportBtn.disabled : false;
        // 2) 第一次点「导出资源」→ 不弹目录选择,直接导出到包名子目录
        if (exportBtn) { exportBtn.click(); await sleep(900); }
        out.statusFirst = statusText();
        out.modalFirst = (document.querySelector('.modal-title') || {}).textContent || ''; // 首次无文件不应弹覆盖确认
        // 3) 第二次点 → 已存在导出文件 → 弹覆盖确认 → 点取消
        if (exportBtn) { exportBtn.click(); await sleep(400); }
        out.confirmTitle = (document.querySelector('.modal-title') || {}).textContent || '';
        out.confirmShown = (document.querySelector('.modal-title') || {}).textContent || ''.includes('目录已存在导出文件');
        // 点取消(modal-foot 里第一个按钮)
        const cancelBtn = document.querySelectorAll('.modal-foot button')[0];
        if (cancelBtn) { cancelBtn.click(); await sleep(400); }
        out.statusAfterCancel = statusText();
        // 4) 第三次点 → 确认框 → 点覆盖 → 导出成功
        if (exportBtn) { exportBtn.click(); await sleep(400); }
        const okBtn = document.querySelectorAll('.modal-foot button')[1];
        if (okBtn) { okBtn.click(); await sleep(900); }
        out.statusAfterOverwrite = statusText();
        return out;
      })()`, true);
      res.pickDirCalls = pickDirCalls;
      // 主进程侧:检查导出目录文件
      res.pkgOutExists = fs.existsSync(PKG_OUT);
      res.pkgOutFiles = res.pkgOutExists ? fs.readdirSync(PKG_OUT).filter((f) => /\.(json|xml|png)$/.test(f)).sort().join(',') : '';
      console.log('FGUI-EXPORT-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.sideItemFound && res.pkgText.includes('ActEmperorArrival') && res.exportBtnEnabled &&
                 /已导出到/.test(res.statusFirst || '') && (res.statusFirst || '').includes('ActEmperorArrival') &&
                 !res.modalFirst && res.confirmShown &&
                 /已取消,未覆盖原文件/.test(res.statusAfterCancel || '') &&
                 /已导出到/.test(res.statusAfterOverwrite || '') &&
                 res.pickDirCalls === 0 && // 导出资源从未弹目录选择
                 res.pkgOutExists && res.pkgOutFiles.includes('ActEmperorArrival.json') && res.pkgOutFiles.includes('.xml');
      console.log('FGUI-EXPORT-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
