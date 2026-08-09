'use strict';
/** FGUI 登记-预览链路冒烟:注入 fgui 场景条目 → 场景目录页 🧩 按钮 → 预览子页自动加载 + 已登记状态 + 快照条 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('fgui-register-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const SAMPLE_LOCAL = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const TEST_SCENE_ID = 'sn_smoke_fgui_register';
const TEST_SCENE_NAME = '__smoke_fgui__';

// 注入一条 fgui 场景条目(未分类)到开发库
function injectScene() {
  const d = dbm.readDb();
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID);
  d.scenes.push({
    id: TEST_SCENE_ID, categoryId: '', name: TEST_SCENE_NAME, filePath: SAMPLE_LOCAL,
    type: 'file', subtype: 'fgui', remark: '', tags: [], size: null, mtime: null,
    fguiSnapshots: [{ id: 'snp_smoke', name: 'SmokeView_layout', path: path.join(require('os').tmpdir(), 'fgui-smoke-snap.json'), timestamp: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  dbm.writeDb(d);
  // 同时写一个样例快照文件供回放验证
  try {
    fs.writeFileSync(path.join(require('os').tmpdir(), 'fgui-smoke-snap.json'),
      JSON.stringify({ pkg: { name: 'x' }, component: { id: 'c1', name: 'SmokeView' }, timestamp: Date.now(), nodes: [] }), 'utf8');
  } catch (e) { /* ignore */ }
}
function cleanupScene() {
  const d = dbm.readDb();
  d.scenes = (d.scenes || []).filter((s) => s.id !== TEST_SCENE_ID);
  dbm.writeDb(d);
}

// 渲染端所需 IPC(与真实 main.js 一致的最小集)
const fgui = require('../electron/tools/fgui');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', () => ({ ok: true }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async (_e, opts) => {
  if (opts && opts.directory) {
    // 保存快照/导出目录:固定到临时目录,让保存流程真实落盘
    const dir = path.join(require('os').tmpdir(), 'fgui-reg-smoke-out');
    fs.mkdirSync(dir, { recursive: true });
    return { canceled: false, filePaths: [dir] };
  }
  return { canceled: true, filePaths: [] };
});
ipcMain.handle('fs:readBase64', (_e, p) => {
  try {
    const buf = fs.readFileSync(p);
    return { ok: true, dataUrl: 'data:application/json;base64,' + buf.toString('base64') };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fs:writeFileBase64', (_e, filePath, dataUrl) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const s = String(dataUrl || '');
    const m = /^data:[^,]+,base64,(.+)$/.exec(s);
    const b64 = m ? m[1] : s.replace(/^data:[^,]+,/, '');
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return { ok: true, path: filePath };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:previewLoad', async (_e, { inputPath, textureDir }) => {
  try { return buildPreviewData(inputPath, { textureDir }); }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:batchExport', async () => ({ ok: false, error: 'smoke stub' }));

app.whenReady().then(async () => {
  console.log('SMOKE-DBG whenReady fired');
  injectScene();
  console.log('SMOKE-DBG scene injected');
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  // 先注册监听,再加载页面(避免错过 did-finish-load)
  win.webContents.on('did-finish-load', async () => {
    console.log('SMOKE-DBG did-finish-load fired');
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // 0) 调试:dbRead 返回的 scenes 数量
        try {
          const d = await window.api.dbRead();
          out.dbScenes = d && d.scenes ? d.scenes.length : -1;
          out.dbScene0 = d && d.scenes && d.scenes[0] ? (d.scenes[0].subtype + '|' + d.scenes[0].filePath) : '';
        } catch (e) { out.dbReadErr = e.message; }
        // 1) 侧栏场景根:先点箭头展开(未分类/分类节点在展开后才渲染),再点名称进主页
        const sceneRoot = document.querySelector('.cat-node[data-id="__scene__"]');
        out.sceneRootFound = !!sceneRoot;
        if (sceneRoot) {
          const arrow = sceneRoot.querySelector('.cat-arrow');
          if (arrow) { arrow.click(); await sleep(250); }
          sceneRoot.click();
        }
        await sleep(400);
        out.sceneHome = !!document.getElementById('sc-fgui-entry');
        // 调试:侧栏场景区所有节点 id + 场景主页最近添加
        out.sceneNodes = [...document.querySelectorAll('.cat-node')].filter((n) => (n.dataset.id || '').startsWith('__scene')).map((n) => n.dataset.id).join(',');
        out.recentRows = document.querySelectorAll('#sc-recent .recent-row').length;
        out.recentText = (document.querySelector('#sc-recent') || {}).textContent || '';
        // 2) 点「未分类」进目录页
        const uncat = document.querySelector('.cat-node[data-id="__scene_uncat__"]');
        out.uncatFound = !!uncat;
        if (uncat) uncat.click();
        await sleep(400);
        // 3) 场景表格中应有 🧩 FGUI 预览按钮(按注入条目名定位,避免受库中真实数据影响)
        const fguiBtn = [...document.querySelectorAll('button[data-act="fgui"]')].find((b) =>
          (b.closest('.scene-tr').querySelector('.scene-name-col').textContent || '').includes('__smoke_fgui__'));
        out.fguiBtnFound = !!fguiBtn;
        out.fguiRowName = fguiBtn ? (fguiBtn.closest('.scene-tr').querySelector('.scene-name-col').textContent || '') : '';
        // 4) 点击 🧩 → 进入预览子页并自动加载该 .bin
        if (fguiBtn) { fguiBtn.click(); await sleep(1200); }
        const canvas = document.getElementById('fgpv-canvas');
        out.pvPage = !!canvas;
        out.pvCanvasSize = canvas ? canvas.width + 'x' + canvas.height : '';
        out.pkgText = (document.getElementById('fgpv-pkg') || {}).textContent || '';
        const regEl = document.getElementById('fgpv-reg');
        out.regText = regEl ? regEl.textContent : '';
        out.regHasRegistered = !!(regEl && regEl.textContent && regEl.textContent.includes('已登记'));
        const regBtn = document.getElementById('fgpv-register');
        out.regBtnHidden = regBtn ? (regBtn.style.display === 'none') : true;
        const snapbar = document.getElementById('fgpv-snapbar');
        out.snapbarVisible = snapbar ? snapbar.style.display !== 'none' : false;
        const snaps = document.getElementById('fgpv-snaps');
        out.snapOptions = snaps ? snaps.options.length : 0;
        out.snapHasItem = !!(snaps && snaps.options.length && snaps.options[0].textContent.includes('SmokeView_layout'));
        // 5) 快照条:下拉选择后点「加载」应触发回放(组件不匹配 → 拒绝;此处注入假快照应被拒)
        if (snaps && snaps.options.length) {
          snaps.selectedIndex = 0;
          const loadBtn = document.getElementById('fgpv-snap-load');
          if (loadBtn) { loadBtn.click(); await sleep(500); }
        }
        out.statusText = (document.getElementById('fgpv-status') || {}).textContent || '';
        // 6) 保存快照闭环:点击「💾 保存快照」→ 真实落盘 + 关联到场景条目 + 快照条刷新
        const snapBtn = document.getElementById('fgpv-snapshot');
        out.snapBtnEnabled = snapBtn ? !snapBtn.disabled : false;
        if (snapBtn && !snapBtn.disabled) {
          snapBtn.click();
          await sleep(800);
          const snaps2 = document.getElementById('fgpv-snaps');
          out.snapOptionsAfterSave = snaps2 ? snaps2.options.length : 0;
          out.statusAfterSave = (document.getElementById('fgpv-status') || {}).textContent || '';
          out.snapNamesAfterSave = snaps2 ? [...snaps2.options].map((o) => o.textContent).join(' | ') : '';
          // 选中新保存的快照并加载回放(同一包的组件,应成功)
          if (snaps2 && snaps2.options.length) {
            snaps2.selectedIndex = 0; // 新快照按时间倒序排在最前
            const loadBtn2 = document.getElementById('fgpv-snap-load');
            if (loadBtn2) { loadBtn2.click(); await sleep(500); }
            out.statusAfterReload = (document.getElementById('fgpv-status') || {}).textContent || '';
          }
          // 删除记录:点 🗑 → 确认弹窗点确定 → 快照条回到 1
          const delBtn = document.getElementById('fgpv-snap-del');
          if (delBtn) { delBtn.click(); await sleep(300); }
          const okBtn = document.querySelector('.modal-foot button.primary');
          out.confirmShown = !!okBtn;
          if (okBtn) { okBtn.click(); await sleep(400); }
          const snaps3 = document.getElementById('fgpv-snaps');
          out.snapOptionsAfterDel = snaps3 ? snaps3.options.length : 0;
        }
        // 7) 返回
        const backBtn = document.getElementById('fgpv-back');
        if (backBtn) { backBtn.click(); await sleep(350); }
        out.backToSceneHome = !!document.getElementById('sc-fgui-entry');
        return out;
      })()`, true);
      console.log('FGUI-REG-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.sceneRootFound && res.sceneHome && res.uncatFound && res.fguiBtnFound &&
                 res.fguiRowName.includes('__smoke_fgui__') && res.pvPage && res.pvCanvasSize &&
                 res.pkgText.includes('ActEmperorArrival') && res.regHasRegistered && res.regBtnHidden &&
                 res.snapbarVisible && res.snapHasItem && res.backToSceneHome &&
                 res.snapBtnEnabled && res.snapOptionsAfterSave === 2 &&
                 /已保存快照并关联/.test(res.statusAfterSave || '') &&
                 /已回放快照/.test(res.statusAfterReload || '') &&
                 res.confirmShown && res.snapOptionsAfterDel === 1;
      console.log('FGUI-REG-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
      cleanupScene();
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SMOKE-ERR', e);
      cleanupScene();
      process.exit(1);
    }
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
  console.log('SMOKE-DBG loaded');
});
