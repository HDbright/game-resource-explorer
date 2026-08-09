'use strict';
/** 顶栏搜索上下文联动冒烟: 首页全类型 / 类型范围 / 场景范围 + FGUI 组件列表搜索 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-search-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-search-smoke');
const SAMPLE = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const CAT_NAME = 'SRCH测试目录';
let uxCatId = null;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const d = dbm.readDb();
  // 清理历史
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  d.scenes = (d.scenes || []).filter((s) => !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-search-smoke'));
  d.items = (d.items || []).filter((i) => !String(i.filePath || '').replace(/\\/g, '/').includes('fgui-search-smoke'));
  uxCatId = 'cat_sr_' + Date.now();
  d.sceneCategories.push({ id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 993, createdAt: Date.now(), updatedAt: Date.now() });
  // 2 条资源(动画 + 图片, 同名含 zombie) 验证类型范围搜索
  const now = Date.now();
  d.items.push(
    { id: 'it_sr_anim', categoryId: '', type: 'spine', filePath: 'E:/fgui-search-smoke/zombie-run.skel', atlasPath: null, displayName: 'zombie-run', remark: '', size: 100, mtime: now, tags: [], createdAt: now, updatedAt: now },
    { id: 'it_sr_img', categoryId: '', type: 'image', filePath: 'E:/fgui-search-smoke/zombie-icon.png', atlasPath: null, displayName: 'zombie-icon', remark: '', size: 200, mtime: now, tags: [], createdAt: now, updatedAt: now },
  );
  // 1 条 FGUI 场景
  d.scenes.push({
    id: 'sn_sr_fgui', categoryId: uxCatId, name: 'SRCH-FGUI包', filePath: SAMPLE,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: now, updatedAt: now,
  });
  d.settings = d.settings || {};
  d.settings.resourceTab = 'home';
  d.settings.recentOpens = [];
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  d.scenes = (d.scenes || []).filter((s) => s.id !== 'sn_sr_fgui');
  d.items = (d.items || []).filter((i) => !['it_sr_anim', 'it_sr_img'].includes(i.id));
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
        const search = document.getElementById('search');
        const setSearch = (v) => { search.value = v; search.dispatchEvent(new Event('input', { bubbles: true })); };
        const clearSearch = () => { document.getElementById('search-clear').click(); };
        const folderText = () => (document.getElementById('page-folder').textContent || '');
        // 1) 全部资源首页搜索 'zombie' → 全类型结果(动画+图片 2 条)
        setSearch('zombie'); await sleep(500);
        out.homeTitle = (document.querySelector('.folder-title') || {}).textContent || '';
        out.homeHasAnim = folderText().includes('zombie-run');
        out.homeHasImg = folderText().includes('zombie-icon');
        out.homeHasResultTitle = folderText().includes('搜索结果');
        // 2) 清空 → 切动画 tab → 搜索 'zombie' → 只动画范围
        clearSearch(); await sleep(400);
        const animTab = document.querySelector('[data-tab="anim"]');
        if (animTab) { animTab.click(); await sleep(500); }
        out.activeTabAfterAnim = (document.querySelector('#resource-tabs .tab.active') || {}).dataset ? document.querySelector('#resource-tabs .tab.active').dataset.tab : 'none';
        setSearch('zombie'); await sleep(500);
        out.animHasRun = folderText().includes('zombie-run');
        out.animHasIcon = folderText().includes('zombie-icon');
        out.animResultTitle = folderText().includes('搜索结果');
        // 3) 清空 → 进场景主页 → 搜索 'SRCH' → 场景结果
        clearSearch(); await sleep(400);
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot) { sceneRoot.click(); await sleep(500); }
        setSearch('SRCH'); await sleep(500);
        out.sceneResult = (document.getElementById('page-scene').textContent || '').includes('SRCH-FGUI包');
        out.sceneResultTitle = (document.getElementById('page-scene').textContent || '').includes('场景搜索结果');
        // 4) 清空 → 打开 FGUI 预览 → 组件列表搜索 'btnGet' → 可见行减少
        clearSearch(); await sleep(400);
        const sceneRoot2 = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot2) { const a = sceneRoot2.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('SRCH测试目录'));
        if (catNode) { const a = catNode.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        const fguiItem = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('SRCH-FGUI包'));
        out.fguiItemFound = !!fguiItem;
        if (fguiItem) { fguiItem.click(); await sleep(1200); }
        const compList = document.getElementById('fgpv-complist');
        const compSearch = document.getElementById('fgpv-comp-search');
        out.compSearchFound = !!compSearch;
        out.compListFound = !!compList;
        const visibleCount = () => compList ? [...compList.children].filter((el) => el.style.display !== 'none').length : 0;
        out.compTotal = visibleCount();
        if (compSearch) { compSearch.value = 'btnGet'; compSearch.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200); }
        out.compFiltered = visibleCount();
        return out;
      })()`, true);
      console.log('FGUI-SEARCH-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.homeHasResultTitle && res.homeHasAnim && res.homeHasImg &&
                 res.animResultTitle && res.animHasRun && !res.animHasIcon &&
                 res.sceneResult && res.sceneResultTitle &&
                 res.fguiItemFound && res.compSearchFound && res.compTotal > 0 && res.compFiltered > 0 && res.compFiltered < res.compTotal;
      console.log('FGUI-SEARCH-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
