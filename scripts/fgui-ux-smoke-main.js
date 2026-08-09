'use strict';
/** FGUI UX 冒烟: 侧栏单击直达预览 / 添加场景识别 FGUI 弹登记(默认目录) / 解压FGUI包 / 快照默认目录=包名子目录 / 撤销 / 编辑历史文件 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('fgui-ux-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TMP = path.join(os.tmpdir(), 'fgui-ux-smoke');
const BIN_COPY = path.join(TMP, 'ActEmperorArrival.bin');
const CAT_NAME = 'UX测试目录';
const TEST_SCENE_ID = 'sn_ux_fgui';
let uxCatId = null;
let lastDirDefaultPath = null;

function setup() {
  fs.mkdirSync(TMP, { recursive: true });
  const srcBin = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
  fs.copyFileSync(srcBin, BIN_COPY);
  // 纹理副本(供 previewData 探测)
  for (const f of ['ActEmperorArrival_atlas0.png', 'Common_atlas0.png', 'Common_atlas1.png']) {
    const s = path.join(__dirname, '..', 'samples', 'fgui', f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(TMP, f));
  }
  const d = dbm.readDb();
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID);
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.name !== CAT_NAME);
  const cat = d.sceneCategories.find((c) => c.name === CAT_NAME) || null;
  uxCatId = cat ? cat.id : ('cat_ux_' + Date.now());
  if (!cat) {
    d.sceneCategories.push({
      id: uxCatId, name: CAT_NAME, remark: '', parentId: '', sort: 999,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
  d.scenes.push({
    id: TEST_SCENE_ID, categoryId: uxCatId, name: 'UX包', filePath: BIN_COPY,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID);
  d.sceneCategories = (d.sceneCategories || []).filter((c) => c.id !== uxCatId);
  dbm.writeDb(d);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const fgui = require('../electron/tools/fgui');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', () => ({ ok: true }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async (_e, opts) => {
  if (opts && opts.directory) {
    lastDirDefaultPath = opts.defaultPath || null;
    const dir = path.join(TMP, 'out');
    fs.mkdirSync(dir, { recursive: true });
    return { canceled: false, filePaths: [dir] };
  }
  // 添加场景:返回 bin 副本
  return { canceled: false, filePaths: [BIN_COPY] };
});
ipcMain.handle('fs:readBase64', (_e, p) => {
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', json: 'application/json' })[ext] || 'application/octet-stream';
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
        const clickNode = (sel, idx = 0) => {
          const els = document.querySelectorAll(sel);
          if (!els.length || !els[idx]) return false;
          els[idx].click(); return true;
        };
        // ---- 1) 侧栏:展开场景根 → 展开「UX测试目录」→ 单击 FGUI 条目直达预览 ----
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        const rootArrow = sceneRoot && sceneRoot.querySelector('.cat-arrow');
        if (rootArrow) { rootArrow.click(); await sleep(250); }
        // 找到分类节点(名称匹配 UX测试目录)
        const catNodes = [...document.querySelectorAll('.cat-node')];
        const catNode = catNodes.find((n) => (n.textContent || '').includes('UX测试目录'));
        out.catNodeFound = !!catNode;
        if (catNode) { const a = catNode.querySelector('.cat-arrow'); if (a) { a.click(); await sleep(250); } }
        // 侧栏 FGUI 条目(名称 UX包)
        const itemNodes = [...document.querySelectorAll('.cat-node')];
        const itemNode = itemNodes.find((n) => (n.textContent || '').includes('UX包'));
        out.sideItemFound = !!itemNode;
        if (itemNode) { itemNode.click(); await sleep(1200); } // 单击(非右键)应直接打开预览
        const canvas = document.getElementById('fgpv-canvas');
        out.directPreview = !!canvas;
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        out.regText = (document.getElementById('fgpv-reg') || {}).textContent || '';
        out.regHasCategory = !!(document.getElementById('fgpv-reg') || {}).textContent || ''.includes('UX测试目录');
        // ---- 2) 解压 FGUI 包按钮 ----
        const unpackBtn = document.getElementById('fgpv-unpack');
        out.unpackBtnEnabled = unpackBtn ? !unpackBtn.disabled : false;
        if (unpackBtn && !unpackBtn.disabled) { unpackBtn.click(); await sleep(900); }
        out.statusAfterUnpack = (document.getElementById('fgpv-status') || {}).textContent || '';
        // ---- 3) 保存快照:记录 pickFiles 收到的 defaultPath(应含包名子目录) ----
        const snapBtn = document.getElementById('fgpv-snapshot');
        if (snapBtn && !snapBtn.disabled) { snapBtn.click(); await sleep(800); }
        out.statusAfterSnap = (document.getElementById('fgpv-status') || {}).textContent || '';
        out.snapOptions = document.getElementById('fgpv-snaps') ? document.getElementById('fgpv-snaps').options.length : 0;
        // ---- 4) 编辑 + 撤销:开启编辑模式,点击画布选中节点,改 x 属性,再撤销 ----
        const editBtn = document.getElementById('fgpv-edit');
        if (editBtn && !editBtn.disabled) { editBtn.click(); await sleep(300); }
        out.editActive = (editBtn || {}).classList ? editBtn.classList.contains('active') : false;
        const undoBtn = document.getElementById('fgpv-undo');
        out.undoEnabled = undoBtn ? !undoBtn.disabled : false;
        // 点画布中心尝试选中节点(多试几个位置)
        const c = document.getElementById('fgpv-canvas');
        if (c) {
          const r = c.getBoundingClientRect();
          const pts = [[0.5, 0.5], [0.3, 0.35], [0.7, 0.6], [0.45, 0.55]];
          for (const [fx, fy] of pts) {
            const x = r.left + r.width * fx, y = r.top + r.height * fy;
            c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
            c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
            c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
            await sleep(120);
            if (document.getElementById('fg-pp-x')) break;
          }
        }
        const xInput = document.getElementById('fg-pp-x');
        out.nodeSelected = !!xInput;
        if (xInput) {
          const beforeVal = xInput.value;
          out.beforeX = beforeVal;
          xInput.value = String((parseFloat(beforeVal) || 0) + 88);
          xInput.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(300);
          const afterVal = document.getElementById('fg-pp-x').value;
          out.afterX = afterVal;
          // 撤销
          undoBtn.click();
          await sleep(300);
          out.undoX = document.getElementById('fg-pp-x') ? document.getElementById('fg-pp-x').value : '';
          out.undoStatus = (document.getElementById('fgpv-status') || {}).textContent || '';
        }
        // ---- 5) 返回场景主页,验证「添加场景」识别 FGUI 包弹登记(默认目录=点击时的目录) ----
        const backBtn = document.getElementById('fgpv-back');
        if (backBtn) { backBtn.click(); await sleep(400); }
        // 展开场景根(若已展开则跳过,避免二次点击反而折叠)
        const sceneRoot2 = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneRoot2) {
          const hasChild = !!document.querySelector('.cat-node[data-id="__scene_uncat__"]') ||
            [...document.querySelectorAll('.cat-node')].some((n) => (n.textContent || '').includes('UX测试目录'));
          if (!hasChild) { const a2 = sceneRoot2.querySelector('.cat-arrow'); if (a2) { a2.click(); await sleep(250); } }
        }
        const catNode2 = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('UX测试目录'));
        if (catNode2) { catNode2.click(); await sleep(400); }
        out.folderPage = !!document.getElementById('sf-add-scene');
        const addBtn = document.getElementById('sf-add-scene');
        if (addBtn) { addBtn.click(); await sleep(500); } // pickFiles 桩返回 bin → 弹登记窗
        const modalTitle = document.querySelector('.modal-title');
        out.regDialogShown = !!(modalTitle && modalTitle.textContent.includes('登记 FGUI 包'));
        // 所属目录默认选中:第二个 select(第一个是「登记方式」)
        const sels = document.querySelectorAll('.modal select');
        if (sels.length >= 2) {
          const sel2 = sels[1];
          out.defaultCatLabel = sel2.options[sel2.selectedIndex] ? sel2.options[sel2.selectedIndex].textContent : '';
          out.defaultCatIsCurrent = (sel2.options[sel2.selectedIndex] || {}).textContent || ''.includes('UX测试目录');
          out.defaultCatValue = sel2.value;
        }
        // 点确定完成登记
        const okBtn = document.querySelector('.modal-foot button.primary');
        if (okBtn) { okBtn.click(); await sleep(500); }
        out.rowsAfterAdd = document.querySelectorAll('.scene-tr').length;
        return out;
      })()`, true);
      // 主进程侧校验:解压产物 / 历史文件 / 快照 defaultPath
      res.lastDirDefaultPath = lastDirDefaultPath;
      const pkgOut = path.join(TMP, 'ActEmperorArrival');
      res.unpackFiles = fs.existsSync(pkgOut) ? fs.readdirSync(pkgOut).filter((f) => /\.(json|xml|png)$/.test(f)).join(',') : '';
      const histFile = path.join(pkgOut, 'edit_history.json');
      res.historyExists = fs.existsSync(histFile);
      res.historyLen = res.historyExists ? JSON.parse(fs.readFileSync(histFile, 'utf8')).length : 0;
      res.uxCatId = uxCatId;

      console.log('FGUI-UX-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.directPreview && res.pkgText.includes('ActEmperorArrival') && res.regHasCategory &&
                 res.unpackBtnEnabled && /已解压/.test(res.statusAfterUnpack || '') &&
                 res.unpackFiles.includes('ActEmperorArrival.json') && res.unpackFiles.includes('.xml') &&
                 (/已保存快照并关联/.test(res.statusAfterSnap || '')) && res.snapOptions >= 1 &&
                 (res.lastDirDefaultPath ? path.basename(res.lastDirDefaultPath) : '') === 'ActEmperorArrival' &&
                 res.editActive && res.undoEnabled && res.nodeSelected &&
                 res.afterX !== res.beforeX && res.undoX === res.beforeX &&
                 res.historyExists && res.historyLen >= 1 &&
                 res.regDialogShown && res.defaultCatValue === uxCatId && res.defaultCatIsCurrent && res.rowsAfterAdd >= 1;
      console.log('FGUI-UX-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
