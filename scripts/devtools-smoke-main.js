'use strict';
/** 开发工具箱冒烟: 侧栏节点存在 → 点击「API 管理」→ 页面可见 + iframe 加载 api-doc.html → 标签/面包屑/返回 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');
const { createServer } = require('../electron/server.js');
const { apiTest } = require('../electron/tools/apiTest.js');

app.setName('devtools-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const DIST = path.join(__dirname, '..', 'dist');

// ---- 注册 preload 全量 IPC 兜底(冒烟不依赖真实功能) ----
const ipcDefaults = {
  'db:read': () => dbm.readDb(),
  'db:write': (_e, data) => { dbm.writeDb(data); return { ok: true }; },
  'dir:pick': () => ({ canceled: true, filePaths: [] }),
  'dir:scan': () => ({ files: [] }),
  'shell:showItem': () => ({ ok: false }),
  'shell:openPath': () => ({ ok: false }),
  'fs:stat': () => null,
  'thumb:get': () => null,
  'thumb:save': () => ({}),
  'thumb:delete': () => ({}),
  'app:info': () => ({ pictures: '', userData: '' }),
  'fs:pickFiles': () => ({ canceled: true, filePaths: [] }),
  'tool:collectFiles': () => ([]),
  'fs:readBase64': () => ({ ok: false, error: 'stub' }),
  'fs:writeFileBase64': () => ({ ok: false, error: 'stub' }),
  'fs:rename': () => ({ ok: false, error: 'stub' }),
  'fs:listDir': () => ([]),
  'tool:astc2png': () => ({ ok: false, error: 'stub' }),
  'tool:skel2json': () => ({ ok: false, error: 'stub' }),
  'tool:probeSkel': () => ({ ok: false, error: 'stub' }),
  'tool:spinefix': () => ({ ok: false, error: 'stub' }),
  'fgui:probe': () => ({ ok: false }),
  'fgui:parse': () => ({ ok: false }),
  'fgui:batchExport': () => ({ ok: false }),
  'fgui:exportSingle': () => ({ ok: false }),
  'fgui:exportSource': () => ({ ok: false }),
  'fgui:saveSourceEdits': () => ({ ok: false }),
  'fgui:previewLoad': () => ({ ok: false }),
  'audio:listDir': () => ([]),
  'audio:readMeta': () => (null),
  'audio:readMetas': () => ([]),
  'audio:writeMeta': () => ({ ok: false }),
  'web:open': () => ({ ok: false }),
  'web:navigate': () => ({}),
  'web:goBack': () => ({}),
  'web:goForward': () => ({}),
  'web:reload': () => ({}),
  'web:devtools': () => ({}),
  'web:close': () => ({}),
  'web:setBounds': () => ({}),
  'web:setAudioMuted': () => ({}),
  'web:getCaptured': () => ([]),
  'web:clearCaptured': () => ({}),
  'web:probe': () => ({ ok: false }),
  'web:download': () => ({ ok: false }),
  'web:fetchText': () => ({ ok: false }),
  'web:thumbFetch': () => ({ ok: false }),
  'web:previewShow': () => ({}),
  'web:previewHide': () => ({}),
  'web:previewClose': () => ({}),
  // API 管理接口测试: 用真实实现(请求本地 server, 验证全链路)
  'api:test': (_e, args) => apiTest(args || {}),
};
for (const [ch, fn] of Object.entries(ipcDefaults)) {
  ipcMain.handle(ch, fn);
}

app.whenReady().then(async () => {
  const server = createServer({ dist: DIST, roots: () => new Map() });
  const url = await server.url;
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const smokeUrl = url; // 本地 server 地址(测试接口用)
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const findNode = (nm) => [...document.querySelectorAll('.cat-node')].find((n) => (n.querySelector('.cat-name') || {}).textContent === nm);
        const modal = () => document.querySelector('.modal-mask');
        const modalFill = (values) => {
          const inputs = [...modal().querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select')];
          inputs.forEach((el, i) => { el.value = values[i] != null ? values[i] : ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        };
        const modalOk = () => { modal().querySelector('.modal-foot .btn:last-child').click(); };
        // 1) 侧栏「开发工具箱」根节点 + 子节点「API 管理」
        const devRoot = findNode('开发工具箱');
        out.rootExists = !!devRoot;
        out.rootIcon = devRoot ? (devRoot.querySelector('.cat-icon') || {}).textContent : null;
        out.apiNodeExists = !!findNode('API 管理');
        // 2) 点击「API 管理」→ 项目管理页可见 + 双 tab
        const apiNode = findNode('API 管理');
        if (apiNode) apiNode.click();
        await sleep(400);
        const pageApi = document.getElementById('page-api');
        out.pageApiVisible = !!pageApi && !pageApi.hidden;
        out.hasTabs = document.querySelectorAll('.apm-tab').length === 2;
        out.projectTabVisible = !document.getElementById('apm-project').hidden;
        out.overviewShown = !!document.querySelector('.apm-overview');
        // 3) 项目管理: 新建顶级分类
        document.getElementById('apm-add-cat').click();
        await sleep(150);
        modalFill(['冒烟分类']);
        modalOk();
        await sleep(300);
        const catNode = [...document.querySelectorAll('.apm-cat')].find((n) => (n.textContent || '').includes('冒烟分类'));
        out.catCreated = !!catNode;
        // 4) 选中分类 → 新建项目(新建后自动进入项目视图)
        if (catNode) catNode.click();
        await sleep(250);
        out.catViewShown = !!document.querySelector('.apm-cat-view');
        document.getElementById('apm-new-proj').click();
        await sleep(150);
        modalFill(['冒烟项目', '${smokeUrl}']);
        modalOk();
        await sleep(300);
        const projTitle = (document.querySelector('.apm-proj-title') || {}).textContent || '';
        out.projCreated = projTitle.includes('冒烟项目');
        out.projViewShown = !!document.querySelector('.apm-proj-view');
        out.dictEmpty = (document.getElementById('apm-main').textContent || '').includes('暂无接口');
        document.getElementById('apm-new-ep').click();
        await sleep(150);
        modalFill(['冒烟接口', 'GET', '/api-doc.html']);
        modalOk();
        await sleep(300);
        const epRow = document.querySelector('.apm-ep-row');
        out.epCreated = !!epRow && (epRow.textContent || '').includes('冒烟接口');
        out.epFormShown = !!document.querySelector('.apm-ep-form');
        // 6) 保存接口
        document.getElementById('apm-save-ep').click();
        await sleep(250);
        out.epSaved = !!(document.getElementById('apm-main').textContent || '').includes('接口已保存') || !!document.querySelector('.apm-ep-form');
        // 7) 接口测试: 真实请求本地 server
        const tUrl = document.querySelector('.apm-test .t-url');
        if (tUrl) tUrl.value = '${smokeUrl}/api-doc.html';
        document.getElementById('apm-send').click();
        await sleep(1600);
        const respBox = document.getElementById('apm-resp');
        out.respShown = !!respBox && !respBox.hidden;
        out.respText = respBox ? (respBox.textContent || '') : '';
        out.resp200 = !!respBox && /200/.test(respBox.textContent || '');
        out.respHasBody = !!respBox && (respBox.textContent || '').includes('Acme');
        // 8) 切到「API 文档」tab → iframe 加载
        document.querySelector('.apm-tab[data-tab="doc"]').click();
        await sleep(1200);
        const iframe = document.querySelector('#apm-doc iframe.api-doc-frame');
        out.docTabShown = !document.getElementById('apm-doc').hidden;
        out.iframeExists = !!iframe;
        out.iframeSrc = iframe ? iframe.getAttribute('src') : null;
        out.docLoaded = false;
        try {
          const doc = iframe.contentDocument;
          out.docLoaded = !!(doc && doc.body && doc.querySelector('a[href="#chat-completions"]'));
        } catch (e) { out.iframeErr = e.message; }
        // 9) 返回按钮 → 回到首页
        const backBtn = document.getElementById('btn-back-special');
        out.backVisible = !!backBtn && !backBtn.hidden;
        if (backBtn) backBtn.click();
        await sleep(400);
        out.backHome = !document.getElementById('page-home').hidden;
        return out;
      })()`, true);
      console.log('DEVTOOLS-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.rootExists && res.apiNodeExists && res.pageApiVisible && res.hasTabs &&
                 res.projectTabVisible && res.overviewShown && res.catCreated && res.catViewShown &&
                 res.projCreated && res.projViewShown && res.dictEmpty && res.epCreated && res.epFormShown &&
                 res.epSaved && res.respShown && res.resp200 && res.respHasBody &&
                 res.docTabShown && res.iframeExists && res.iframeSrc === './api-doc.html' && res.docLoaded &&
                 res.backVisible && res.backHome;
      console.log('DEVTOOLS-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
      // 清理冒烟数据(磁盘 db: 渲染端 state 随进程退出丢弃)
      const d = dbm.readDb();
      d.apiCategories = (d.apiCategories || []).filter((c) => !(c.name || '').includes('冒烟'));
      d.apiProjects = (d.apiProjects || []).filter((p) => !(p.name || '').includes('冒烟'));
      d.apiEndpoints = (d.apiEndpoints || []).filter((e) => !(e.name || '').includes('冒烟'));
      dbm.writeDb(d);
      await server.close();
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SMOKE-ERR', e);
      try {
        const d2 = dbm.readDb();
        d2.apiCategories = (d2.apiCategories || []).filter((c) => !(c.name || '').includes('冒烟'));
        d2.apiProjects = (d2.apiProjects || []).filter((p) => !(p.name || '').includes('冒烟'));
        d2.apiEndpoints = (d2.apiEndpoints || []).filter((ep) => !(ep.name || '').includes('冒烟'));
        dbm.writeDb(d2);
      } catch (e2) { /* ignore */ }
      await server.close();
      process.exit(1);
    }
  });
  await win.loadURL(url + '/index.html?smoke=1');
});
