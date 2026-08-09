'use strict';
/** 主区多标签页冒烟: 打开 FGUI 预览建标签 → 点「资源首页」切换 → 点标签切回 → hover 关闭标签 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-tabs-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-tabs-smoke');
const SAMPLE = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const CAT_NAME = 'TABS测试目录';
let uxCatId = null;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  d.scenes = (d.scenes || []).filter((s) => !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-tabs-smoke'));
  uxCatId = 'cat_tb_' + Date.now();
  d.sceneCategories.push({ id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 994, createdAt: Date.now(), updatedAt: Date.now() });
  d.scenes.push({
    id: 'sn_tb_fgui', categoryId: uxCatId, name: 'TABS包', filePath: SAMPLE,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  d.settings = d.settings || {};
  d.settings.resourceTab = 'home';
  d.settings.recentOpens = [];
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  d.scenes = (d.scenes || []).filter((s) => s.id !== 'sn_tb_fgui');
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
        const tabsText = () => [...document.querySelectorAll('#tab-strip .main-tab')].map((t) => (t.querySelector('.mt-label') || {}).textContent || '').join(',');
        const homeVisible = () => {
          const ph = document.getElementById('page-home');
          return ph && !ph.hidden;
        };
        // 1) 打开 FGUI 预览(侧栏场景根 → 分类 → 条目单击) → 应建 FGUI 标签
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot) { const a = sceneRoot.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('TABS测试目录'));
        if (catNode) { const a2 = catNode.querySelector('.cat-arrow'); if (a2) { a2.click(); await sleep(250); } }
        const itemNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('TABS包'));
        out.itemFound = !!itemNode;
        if (itemNode) { itemNode.click(); await sleep(1200); }
        out.tabsAfterOpen = tabsText();
        out.fguiActive = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        // 2) 点品牌(全部资源首页) → 主区切到首页, FGUI 标签保留
        const brand = document.querySelector('.brand');
        out.brandFound = !!brand;
        if (brand) { brand.click(); await sleep(600); }
        out.homeVisibleAfterBrand = homeVisible();
        out.tabsAfterBrand = tabsText();
        out.homeTabActive = [...document.querySelectorAll('#tab-strip .main-tab')].some((t) => t.classList.contains('active') && ((t.querySelector('.mt-label') || {}).textContent || '').includes('资源首页'));
        // 3) 点击 FGUI 标签 → 切回 FGUI 预览
        const fguiTab = [...document.querySelectorAll('#tab-strip .main-tab')].find((t) => ((t.querySelector('.mt-label') || {}).textContent || '').includes('ActEmperorArrival'));
        out.fguiTabFound = !!fguiTab;
        if (fguiTab) { fguiTab.click(); await sleep(900); }
        out.fguiBack = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        // 4) hover 显示关闭符号 → 点击关闭 FGUI 标签 → 标签移除 + 切到相邻(首页)
        const fguiTab2 = [...document.querySelectorAll('#tab-strip .main-tab')].find((t) => ((t.querySelector('.mt-label') || {}).textContent || '').includes('ActEmperorArrival'));
        out.fguiTab2Found = !!fguiTab2;
        if (fguiTab2) {
          out.closeBtnVisibleBeforeHover = getComputedStyle(fguiTab2.querySelector('.mt-close')).visibility;
          // synthetic 事件不触发 CSS :hover,改为校验 hover 显示关闭按钮的样式规则存在
          try {
            out.cssHoverRule = [...document.styleSheets].some((s) => {
              try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.includes('.main-tab:hover .mt-close')); }
              catch (e) { return false; }
            });
          } catch (e) { out.cssHoverRule = false; }
          fguiTab2.querySelector('.mt-close').click();
          await sleep(600);
        }
        out.tabsAfterClose = tabsText();
        out.homeVisibleAfterClose = homeVisible();
        return out;
      })()`, true);
      console.log('FGUI-TABS-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.itemFound && res.fguiActive.includes('ActEmperorArrival') &&
                 res.tabsAfterOpen.includes('ActEmperorArrival') &&
                 res.brandFound && res.homeVisibleAfterBrand && res.homeTabActive && res.tabsAfterBrand.includes('ActEmperorArrival') &&
                 res.fguiTabFound && res.fguiBack.includes('ActEmperorArrival') &&
                 res.closeBtnVisibleBeforeHover === 'hidden' && res.cssHoverRule && res.fguiTab2Found &&
                 !res.tabsAfterClose.includes('ActEmperorArrival') && res.homeVisibleAfterClose;
      console.log('FGUI-TABS-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
