'use strict';
/** FGUI 组件列表面板冒烟: 右侧列表(主包组件+跨包子组件@外部包名) / 点击高亮定位 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-complist-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-cl-smoke');
const SAMPLE = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const CAT_NAME = 'CL测试目录';
let uxCatId = null;

function setup() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  d.scenes = (d.scenes || []).filter((s) => !String(s.filePath || '').replace(/\\/g, '/').includes('fgui-cl-smoke'));
  uxCatId = 'cat_cl_' + Date.now();
  d.sceneCategories.push({ id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 996, createdAt: Date.now(), updatedAt: Date.now() });
  d.scenes.push({
    id: 'sn_cl_fgui', categoryId: uxCatId, name: 'CL包', filePath: SAMPLE,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  d.scenes = (d.scenes || []).filter((s) => s.id !== 'sn_cl_fgui');
  // 还原背景色设置(测试中改为白色/红色)与自定义色
  d.settings = d.settings || {};
  if (d.settings.fguiBgColor && d.settings.fguiBgColor !== '#1b1d23') d.settings.fguiBgColor = '#1b1d23';
  if (d.settings.customBgColor) d.settings.customBgColor = '#3a4150';
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
        // 干净状态:清除上次保存的布局尺寸,验证默认 50/50 与拖拽
        localStorage.removeItem('fgpv-compH');
        localStorage.removeItem('fgpv-sideW');
        // 1) 侧栏:展开场景根 → 展开分类 → 单击条目进预览
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot) { const a = sceneRoot.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('CL测试目录'));
        if (catNode) { const a2 = catNode.querySelector('.cat-arrow'); if (a2) { a2.click(); await sleep(250); } }
        const itemNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('CL包'));
        out.sideItemFound = !!itemNode;
        if (itemNode) { itemNode.click(); await sleep(1200); }
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        // 2) 组件列表面板
        const bar = document.getElementById('fgpv-compbar');
        out.compBarVisible = bar ? bar.style.display !== 'none' : false;
        const list = document.getElementById('fgpv-complist');
        out.itemCount = list ? list.children.length : 0;
        // 3) 列表完整性:应有「本包子节点」(└ 开头且无 @ 标注)与跨包项(@Common)
        out.hasMainItem = !!(list && [...list.children].some((el) => el.textContent.startsWith('📦')));
        out.hasExtItem = !!(list && [...list.children].some((el) => el.textContent.includes('@Common')));
        out.hasLocalSubItem = !!(list && [...list.children].some((el) => el.textContent.startsWith('└') && !el.textContent.includes('@')));
        // 点击本包子节点 → 高亮 + 属性面板联动
        const localSub = list ? [...list.children].find((el) => el.textContent.startsWith('└') && !el.textContent.includes('@')) : null;
        out.localSubFound = !!localSub;
        if (localSub) { localSub.click(); await sleep(300); }
        out.statusAfterLocal = (document.getElementById('fgpv-status') || {}).textContent || '';
        out.propsAfterLocal = document.querySelectorAll('#fgpv-props .fg-prop').length;
        // 点击跨包子组件项 → 高亮 + 属性联动
        const extEl = list ? [...list.children].find((el) => el.textContent.includes('@Common')) : null;
        out.extElFound = !!extEl;
        if (extEl) { extEl.click(); await sleep(300); }
        out.statusAfterExt = (document.getElementById('fgpv-status') || {}).textContent || '';
        out.extActive = extEl ? extEl.classList.contains('active') : false;
        out.propsAfterExt = document.querySelectorAll('#fgpv-props .fg-prop').length;
        // 4) 点击其它主组件项(非当前显示) → 自动切换组件 + 属性面板
        const compSel = document.getElementById('fgpv-comp');
        const curCompText0 = compSel ? compSel.options[compSel.selectedIndex].text : '';
        const otherMain = list ? [...list.children].find((el) => el.textContent.startsWith('📦') && !el.textContent.includes(curCompText0)) : null;
        out.otherMainFound = !!otherMain;
        if (otherMain) { otherMain.click(); await sleep(500); }
        out.curCompText1 = compSel ? compSel.options[compSel.selectedIndex].text : '';
        out.propsAfterSwitch = document.querySelectorAll('#fgpv-props .fg-prop').length;
        out.statusAfterSwitch = (document.getElementById('fgpv-status') || {}).textContent || '';
        // 点击主组件项(当前显示) → 高亮根
        const mainEl = list ? [...list.children].find((el) => el.textContent.startsWith('📦')) : null;
        if (mainEl) { mainEl.click(); await sleep(300); }
        out.statusAfterMain = (document.getElementById('fgpv-status') || {}).textContent || '';
        out.mainActive = mainEl ? mainEl.classList.contains('active') : false;
        // 5) 分割线拖拽: 垂直(组件列表/属性面板占比) + 左侧边框(面板宽度)
        const vSplit = document.getElementById('fgpv-vsplit');
        const hSplit = document.getElementById('fgpv-hsplit');
        out.vSplitVisible = vSplit ? vSplit.style.display !== 'none' : false;
        out.hSplitFound = !!hSplit;
        const compBar = document.getElementById('fgpv-compbar');
        const side = document.getElementById('fgpv-side');
        out.compH0 = compBar ? compBar.getBoundingClientRect().height : 0;
        out.sideW0 = side ? side.getBoundingClientRect().width : 0;
        const fire = (el, type, x, y) => {
          el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, button: 0 }));
        };
        if (vSplit && compBar) {
          const r = vSplit.getBoundingClientRect();
          fire(vSplit, 'pointerdown', r.left + 10, r.top + 2);
          fire(vSplit, 'pointermove', r.left + 10, r.top + 82);
          fire(vSplit, 'pointerup', r.left + 10, r.top + 82);
          await sleep(150);
          out.compH1 = compBar.getBoundingClientRect().height;
          out.compFlexAfterV = compBar.style.flex;
        }
        if (hSplit && side) {
          const r = hSplit.getBoundingClientRect();
          fire(hSplit, 'pointerdown', r.left + 1, r.top + 60);
          fire(hSplit, 'pointermove', r.left - 90, r.top + 60);
          fire(hSplit, 'pointerup', r.left - 90, r.top + 60);
          await sleep(150);
          out.sideW1 = side.getBoundingClientRect().width;
          out.sideFlexAfterW = side.style.flexBasis;
        }
        out.savedSideW = localStorage.getItem('fgpv-sideW') || '';
        out.savedCompH = localStorage.getItem('fgpv-compH') || '';
        // 6) 画布背景色(调色盘): 深浅按钮反色样式 + 调色盘立即生效 + 保存自定义
        const bgBarEl = document.getElementById('fgpv-bgbar');
        const bgInput = document.getElementById('fgpv-bg-color');
        const bgDark = document.getElementById('fgpv-bg-dark');
        const bgSave = document.getElementById('fgpv-bg-save');
        const bgCustomBtn = document.getElementById('fgpv-bg-custom');
        out.bgBarVisible = bgBarEl ? bgBarEl.style.display !== 'none' : false;
        out.bgDarkBg = bgDark ? bgDark.style.background : '';
        out.bgDarkColor = bgDark ? bgDark.style.color : '';
        if (bgInput) { bgInput.value = '#ffffff'; bgInput.dispatchEvent(new Event('input', { bubbles: true })); }
        await sleep(250);
        const wrap2 = document.getElementById('fgpv-canvas-wrap');
        out.bgAfter = wrap2 ? getComputedStyle(wrap2).backgroundColor : '';
        out.bgDataset = wrap2 ? wrap2.dataset.bg || '' : ''; // 渲染器 setBackground 测试钩子
        out.bgStatus = (document.getElementById('fgpv-status') || {}).textContent || '';
        // 存按钮:文字「存」+ 紧贴调色盘(顺序断言)
        out.saveText = bgSave ? bgSave.textContent : '';
        out.saveRightAfterInput = !!(bgInput && bgSave && bgInput.nextElementSibling === bgSave);
        if (bgInput) { bgInput.value = '#ff0000'; bgInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (bgSave) { bgSave.click(); await sleep(250); }
        out.bgDatasetRed = wrap2 ? wrap2.dataset.bg || '' : '';
        out.customBtnBg = bgCustomBtn ? bgCustomBtn.style.background : '';
        try {
          const dd = await window.api.dbRead();
          out.savedCustom = (dd.settings && dd.settings.customBgColor) || '';
          out.savedFguiBg = (dd.settings && dd.settings.fguiBgColor) || '';
        } catch (e) { out.dbErr = e.message; }
        return out;
      })()`, true);
      console.log('FGUI-CL-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.sideItemFound && res.pkgText.includes('ActEmperorArrival') &&
                 res.compBarVisible && res.itemCount >= 5 && res.hasMainItem && res.hasExtItem && res.hasLocalSubItem &&
                 res.localSubFound && /已定位/.test(res.statusAfterLocal || '') && res.propsAfterLocal > 0 &&
                 res.extElFound && /已定位/.test(res.statusAfterExt || '') && res.extActive && res.propsAfterExt > 0 &&
                 res.otherMainFound && res.curCompText1 !== res.curCompText0 && res.propsAfterSwitch > 0 && /已定位/.test(res.statusAfterSwitch || '') &&
                 /已定位/.test(res.statusAfterMain || '') && res.mainActive &&
                 res.vSplitVisible && res.hSplitFound &&
                 res.compH1 > res.compH0 + 40 && res.sideW1 > res.sideW0 + 60 &&
                 !!res.savedSideW && !!res.savedCompH &&
                 res.bgBarVisible && res.bgDarkBg === 'rgb(27, 29, 35)' && res.bgDarkColor === 'rgb(255, 255, 255)' &&
                 res.bgAfter === 'rgb(255, 255, 255)' && res.bgDataset === '#ffffff' && /背景色已设为/.test(res.bgStatus || '') &&
                 res.saveText === '存' && res.saveRightAfterInput &&
                 res.customBtnBg === 'rgb(255, 0, 0)' && res.bgDatasetRed === '#ff0000' && res.savedCustom === '#ff0000' && res.savedFguiBg === '#ff0000';
      console.log('FGUI-CL-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
