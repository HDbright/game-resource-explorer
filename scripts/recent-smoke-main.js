'use strict';
/** 首页「最近打开」冒烟: 注入记录 → 首页展示(名称+时间) → 点击再次打开 FGUI 预览 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-recent-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-recent-smoke');
const SAMPLE = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const CAT_NAME = 'RECENT测试目录';
let uxCatId = null;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  d.scenes = (d.scenes || []).filter((s) => !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-recent-smoke'));
  uxCatId = 'cat_rc_' + Date.now();
  d.sceneCategories.push({ id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 995, createdAt: Date.now(), updatedAt: Date.now() });
  d.scenes.push({
    id: 'sn_rc_fgui', categoryId: uxCatId, name: 'RECENT包', filePath: SAMPLE,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  // 注入最近打开记录(3 条:FGUI + 普通文件 + spine 动画)
  d.settings = d.settings || {};
  d.settings.recentOpens = [
    { name: 'RECENT包(FGUI)', path: SAMPLE, type: 'fgui', tab: 'fgui', itemId: null, openedAt: Date.now() - 3600e3 },
    { name: 'sample.txt', path: 'E:/backup/sample.txt', type: 'file', tab: '', itemId: null, openedAt: Date.now() - 7200e3 },
    { name: 'demo-anim', path: 'E:/demo/demo.skel', type: 'spine', tab: 'anim', itemId: null, openedAt: Date.now() - 1800e3 },
  ];
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  d.scenes = (d.scenes || []).filter((s) => s.id !== 'sn_rc_fgui');
  d.settings = d.settings || {};
  d.settings.recentOpens = (d.settings.recentOpens || []).filter((r) => !String(r.path || '').replace(/\\/g, '/').includes('fgui-recent-smoke') && !String(r.path || '').includes('sample.txt'));
  dbm.writeDb(d);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const fgui = require('../electron/tools/fgui');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('fs:stat', (_e, p) => {
  try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch (e) { return null; }
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
ipcMain.handle('fgui:exportSingle', async () => ({ ok: false, error: 'smoke stub' }));

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
        // 1) 首页「最近打开」模块(默认 global home)
        const section = document.getElementById('home-recent-opens');
        out.recentSection = !!section;
        out.recentItems = section ? section.querySelectorAll('.recent-item').length : 0;
        out.recentText = section ? section.textContent : '';
        out.hasFguiItem = !!(section && [...section.querySelectorAll('.recent-item')].some((el) => (el.textContent || '').includes('RECENT包')));
        out.hasTime = !!(section && /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(section.textContent));
        // 2) 点击 FGUI 最近打开项 → 再次打开预览
        const fguiItem = section ? [...section.querySelectorAll('.recent-item')].find((el) => (el.textContent || '').includes('RECENT包')) : null;
        out.fguiItemFound = !!fguiItem;
        if (fguiItem) { fguiItem.click(); await sleep(1200); }
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        out.previewOpened = !!document.getElementById('fgpv-canvas');
        // 3) 类型主页最近打开: 切到「动画」tab → 只显示 spine 记录(无 FGUI/文件)
        const animTab = document.querySelector('[data-tab="anim"]');
        out.animTabFound = !!animTab;
        if (animTab) { animTab.click(); await sleep(600); }
        const typeRecent = document.getElementById('home-recent-opens');
        out.typeRecentText = typeRecent ? typeRecent.textContent : '';
        out.typeRecentOnlyAnim = !!(typeRecent && (typeRecent.textContent || '').includes('demo-anim') && !(typeRecent.textContent || '').includes('RECENT包') && !(typeRecent.textContent || '').includes('sample.txt'));
        return out;
      })()`, true);
      console.log('FGUI-RECENT-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.recentSection && res.recentItems >= 2 && res.hasFguiItem && res.hasTime &&
                 res.fguiItemFound && res.previewOpened && res.pkgText.includes('ActEmperorArrival') &&
                 res.animTabFound && res.typeRecentOnlyAnim;
      console.log('FGUI-RECENT-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
