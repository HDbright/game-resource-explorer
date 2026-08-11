'use strict';
/** FGUI 集成冒烟主进程入口: 直接加载 dist, 走真实 preload/IPC 验证 FGUI 链路 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fgui = require('../electron/tools/fgui');

const SAMPLE = 'E:/backup/游戏场景/异兽灵境/res/game_100073549/ui/fgui/ActEmperorArrival.bin';
const SAMPLE_DIR = path.dirname(SAMPLE);
// 自包含样例(不依赖外盘)
const SAMPLE_LOCAL = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const SAMPLE_LOCAL_DIR = path.dirname(SAMPLE_LOCAL);

app.setName('fgui-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// 注册与真实 main.js 一致的 FGUI IPC handler(验证解析链路)
ipcMain.handle('fgui:probe', async (_e, { inputPath }) => {
  try {
    const data = fs.readFileSync(inputPath);
    return { ok: true, isFgui: fgui.probeFgui(data) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:parse', async (_e, { inputPath }) => {
  try {
    const r = fgui.parseFile(inputPath);
    const info = JSON.parse(JSON.stringify(r.pkg));
    delete info.rawById;
    return { ok: true, pkg: info, packageXml: r.packageXml, componentXmls: r.componentXmls,
             srcDir: path.dirname(inputPath) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fgui:batchExport', async (_e, { inputDir, outputDir }) => {
  try { return fgui.batchExport(inputDir, outputDir); }
  catch (err) { return { ok: false, error: err.message }; }
});
// FGUI 布局预览数据
const { buildPreviewData } = require('../electron/tools/fgui/previewData');
ipcMain.handle('fgui:previewLoad', async (_e, { inputPath, textureDir }) => {
  try { return buildPreviewData(inputPath, { textureDir }); }
  catch (err) { return { ok: false, error: err.message }; }
});
// preload 里其它 api 在真实运行时由 main.js 提供,冒烟中补最小桩
ipcMain.handle('db:read', () => ({ categories: [], items: [] }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));

app.whenReady().then(async () => {
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
        // 1) DOM 元素存在(集成点核对)
        out.dom = {
          view: !!document.getElementById('pv-fgui-view'),
          compSelect: !!document.getElementById('fgui-comp-select'),
          tree: !!document.getElementById('fgui-tree'),
          props: !!document.getElementById('fgui-props'),
          src: !!document.getElementById('fgui-src'),
          tabs: document.querySelectorAll('.fg-src-tab').length,
        };
        // 2) IPC: 探测
        try {
          const pr = await window.api.fguiProbe({ inputPath: ${JSON.stringify(SAMPLE)} });
          out.probe = pr.ok && pr.isFgui === true;
        } catch (e) { out.probe = 'ERR:' + e.message; }
        // 3) IPC: 解析真实包
        try {
          const r = await window.api.fguiParse({ inputPath: ${JSON.stringify(SAMPLE)} });
          out.parse = r && r.ok;
          out.pkgId = r && r.pkg && r.pkg.id;
          out.version = r && r.pkg && r.pkg.version;
          out.items = r && r.pkg && r.pkg.items ? r.pkg.items.length : -1;
          out.compXmls = r && r.componentXmls ? r.componentXmls.length : -1;
          out.srcDirOk = r && r.srcDir === ${JSON.stringify(SAMPLE_DIR)};
          if (r && r.componentXmls && r.componentXmls.length) {
            const first = r.componentXmls[0];
            out.firstComp = first.name;
            out.firstHasDisplayList = /<displayList>/.test(first.xml);
            out.firstHasChineseText = /[\\u4e00-\\u9fa5]/.test(first.xml);
            out.packageXmlOk = /^<\\?xml/.test(r.packageXml);
          }
        } catch (e) { out.parse = 'ERR:' + e.message; }
        // 4) 批量导出链路
        try {
          const outDir = ${JSON.stringify(path.join(require('os').tmpdir(), 'fgui-smoke-out'))};
          const be = await window.api.fguiBatchExport({ inputDir: ${JSON.stringify(SAMPLE_DIR)}, outputDir: outDir });
          out.batch = be && be.ok ? { total: be.total, failed: be.failed } : be;
        } catch (e) { out.batch = 'ERR:' + e.message; }
        // 5) FGUI 布局预览数据(自包含样例)
        try {
          const pv = await window.api.fguiPreviewLoad({ inputPath: ${JSON.stringify(SAMPLE_LOCAL)} });
          out.preview = pv && pv.ok;
          out.pvComps = pv && pv.components ? pv.components.length : -1;
          out.pvFirstComp = pv && pv.components && pv.components[0] ? pv.components[0].name : '';
          out.pvRootChildren = pv && pv.components && pv.components[0] && pv.components[0].root ? pv.components[0].root.children.length : -1;
          out.pvTextures = pv && pv.textures ? Object.keys(pv.textures).map((k) => k + (pv.textures[k] ? ':hit' : ':missing')).join(',') : '';
          out.pvHasImage = pv ? (function walk(n){ if(!n) return false; if(n.kind==='image'&&n.sprite) return true; return (n.children||[]).some(walk); })(pv.components[0].root) : false;
          out.pvHasText = pv ? (function walk(n){ if(!n) return false; if(n.kind==='text'&&n.text) return true; return (n.children||[]).some(walk); })(pv.components[0].root) : false;
          out.pvCtrl = pv && pv.components[0] && pv.components[0].controllers ? pv.components[0].controllers.map((c)=>c.name+':'+c.pages.length).join(',') : '';
        } catch (e) { out.preview = 'ERR:' + e.message; }
        // 6) UI 链路: 侧栏「游戏场景管理」→ 主页 FGUI 卡片 → 预览子页渲染器初始化
        try {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const sceneNode = document.querySelector('.cat-node[data-id="__scene__"]');
          out.sceneNodeFound = !!sceneNode;
          if (sceneNode) sceneNode.click();
          await sleep(350);
          const entry = document.getElementById('sc-fgui-entry');
          out.fguiCardOnHome = !!entry;
          if (entry) {
            entry.click();
            await sleep(1200); // 等 FguiLayoutPreview.init(Pixi 应用异步初始化)
            // 场景主页「FGUI 编辑器」卡片 → fgui-editor 独立页(fge-canvas 画布)
            const canvas = document.getElementById('fge-canvas');
            out.pvPage = !!canvas;
            out.pvCanvasSize = canvas ? canvas.width + 'x' + canvas.height : '';
            out.pvTextLayer = !!document.getElementById('fge-text');
            out.pvPropPanel = !!document.getElementById('fge-props');
            out.pvCtrlBar = !!document.getElementById('fge-ctrls');
            out.pvCompSelect = !!document.getElementById('fge-comp');
            try {
              out.pvCanvasGL = !!canvas && !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
            } catch (e2) { out.pvCanvasGL = false; }
            // 工具栏按钮(替代旧 fgpv-back)
            out.pvBackBtn = !!document.getElementById('fge-pick');
            out.backToHome = !!document.getElementById('sc-fgui-entry');
          }
        } catch (e) { out.uiChain = 'ERR:' + e.message; }
        return out;
      })()`, true);
      console.log('FGUI-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.dom.view && res.dom.compSelect && res.dom.tree && res.dom.src &&
                 res.dom.tabs === 3 && res.probe === true && res.parse === true &&
                 res.compXmls > 0 && res.srcDirOk === true && res.firstHasDisplayList &&
                 res.firstHasChineseText && res.packageXmlOk === true &&
                 res.batch && res.batch.total === 155 && res.batch.failed === 0 &&
                 res.preview === true && res.pvComps === 3 && res.pvRootChildren === 6 &&
                 res.pvHasImage === true && res.pvHasText === true &&
                 /stateCtrl:3/.test(res.pvCtrl) &&
                 /atlas0:hit/.test(res.pvTextures) &&
                 res.sceneNodeFound === true && res.fguiCardOnHome === true &&
                 res.pvPage === true && res.pvCanvasGL === true &&
                 res.pvTextLayer === true && res.pvPropPanel === true &&
                 res.pvCtrlBar === true && res.pvBackBtn === true &&
                 res.backToHome === true;
      app.exit(ok ? 0 : 2);
    } catch (e) {
      console.log('FGUI-SMOKE ERROR ' + (e && e.message || e));
      app.exit(3);
    }
  });
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log('[renderer:' + level + ']', msg);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
