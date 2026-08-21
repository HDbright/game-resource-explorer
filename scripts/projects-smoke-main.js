'use strict';
/** 项目管理中心冒烟(补丁·113): 种子项目 hedaoedu → 主页汇总 → 详情页 → 资源文档 → 新增/目录/条目 → 删除 → db 断言 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('projects-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const TEST_PROJ_NAME = '__proj_smoke__';

function cleanup() {
  try {
    const d = dbm.readDb();
    // 前缀匹配删除测试项目(含历史遗留的改名项目 __proj_smoke__r)及其节点/条目
    const projs = (d.projects || []).filter((p) => (p.name || '').startsWith(TEST_PROJ_NAME));
    const projIds = new Set(projs.map((p) => p.id));
    const nodeIds = new Set();
    for (const p of projs) {
      if (p.menuNodeId) {
        nodeIds.add(p.menuNodeId);
        const collect = (pid) => {
          for (const m of d.menuNodes || []) {
            if ((m.parentId || '') === pid) { nodeIds.add(m.id); collect(m.id); }
          }
        };
        collect(p.menuNodeId);
      }
    }
    if (projIds.size) d.projects = (d.projects || []).filter((p) => !projIds.has(p.id));
    // 孤儿项目节点(指向不存在项目的 project:* 节点)一并清理
    for (const m of d.menuNodes || []) {
      const a = m.action || '';
      if (a.startsWith('project:') || a.startsWith('projectfolder:')) {
        const pid = a.slice(a.indexOf(':') + 1);
        if (pid && !(d.projects || []).some((p) => p.id === pid)) nodeIds.add(m.id);
      }
    }
    if (nodeIds.size) d.menuNodes = (d.menuNodes || []).filter((m) => !nodeIds.has(m.id));
    d.projectEntries = (d.projectEntries || []).filter((e) => !projIds.has(e.projectId));
    // 清理测试期间在 hedaoedu 项目下产生的 __smoke_ 目录/条目
    const hedao = (d.projects || []).find((p) => p.name.includes('hedaoedu'));
    if (hedao) {
      d.projectEntries = (d.projectEntries || []).filter((e) => !(e.projectId === hedao.id && (e.name || '').includes('__smoke_')));
      const dirIds = new Set((d.menuNodes || []).filter((m) => (m.parentId || '') === hedao.menuNodeId && (m.name || '').includes('__smoke_')).map((m) => m.id));
      if (dirIds.size) d.menuNodes = (d.menuNodes || []).filter((m) => !dirIds.has(m.id));
    }
    dbm.writeDb(d);
  } catch (e) { console.error('CLEANUP-ERR', e); }
}

// ---- IPC 桩 ----
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return true; });
ipcMain.handle('db:stats', () => dbm.dbStats());
ipcMain.handle('app:info', () => ({ pictures: '', userData: app.getPath('userData') }));
ipcMain.handle('app:openExternal', async () => ({ ok: true }));
ipcMain.handle('shell:openPath', async () => '');
ipcMain.handle('shell:showItem', async () => {});
ipcMain.handle('fs:stat', () => null);
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('fs:pickDirs', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('fs:listDir', async () => ({ ok: true, files: [] }));
ipcMain.handle('icon:fromFile', async () => ({ ok: false }));
ipcMain.handle('projects:start', async () => ({ ok: true, pid: 1 }));
ipcMain.handle('projects:stop', async () => ({ ok: true, stopped: true }));
ipcMain.handle('projects:probeUrl', async () => ({ ok: true, reachable: false }));
ipcMain.handle('projects:stopAll', async () => ({ ok: true }));
ipcMain.handle('projects:status', async (_e, specs = []) => {
  const out = {};
  for (const s of specs) out[s.projectId] = { all: false, frontend: false, backend: false, procs: {} };
  return out;
});

app.whenReady().then(async () => {
  cleanup(); // 清残留,保证幂等
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('DID-FAIL-LOAD', code, desc);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('RENDER-GONE', JSON.stringify(details));
  });
  // 看门狗:45 秒未完成强制退出,避免挂起
  const watchdog = setTimeout(() => {
    console.error('SMOKE-TIMEOUT');
    cleanup();
    process.exit(2);
  }, 45000);
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const shot = async (name) => {
        try {
          const img = await win.capturePage();
          fs.writeFileSync(path.join(__dirname, name), img.toPNG());
        } catch (e) { console.error('SHOT-ERR', name, e.message); }
      };
      const js = (code) => win.webContents.executeJavaScript(code, true);

      // 1) 侧栏点击「项目管理中心」→ 主页汇总
      const r1 = await js(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const root = [...document.querySelectorAll('#cat-tree .cat-node')].find((n) => (n.querySelector('.cat-name') || {}).textContent === '项目管理中心');
        out.rootNodeFound = !!root;
        if (root) { root.click(); await sleep(800); }
        const page = document.getElementById('page-projects');
        out.pageVisible = !!(page && !page.hidden);
        out.pageText = page ? page.textContent : '';
        out.hasHedaoCard = !!(page && (page.textContent || '').includes('hedaoedu 禾道学堂'));
        out.hasAddBtn = !!(page && (page.textContent || '').includes('新增项目'));
        out.cardCount = page ? page.querySelectorAll('.proj-card').length : 0;
        out.hasStatusBadge = !!(page && page.querySelector('.proj-status'));
        out.hasUpdatedTime = !!(page && /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(page.textContent));
        // 修复项①:项目节点在侧栏只渲染一次(此前 renderMenuChildren 与 menuKids 双重渲染)
        const hedaoNodes = [...document.querySelectorAll('#cat-tree .cat-name')].filter((n) => (n.textContent || '').includes('hedaoedu'));
        out.hedaoNodeCount = hedaoNodes.length;
        // 修复项②:详情页容器可纵向滚动
        out.pageOverflowY = page ? getComputedStyle(page).overflowY : '';
        return out;
      })()`);
      await shot('proj-home.png');

      // 2) 进入详情页
      const r2 = await js(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const page = document.getElementById('page-projects');
        const openBtn = page ? page.querySelector('.proj-card [data-act="open"]') : null;
        out.openBtnFound = !!openBtn;
        if (openBtn) { openBtn.click(); await sleep(700); }
        out.detailVisible = !!(page && !page.hidden && page.querySelector('.proj-detail'));
        out.detailText = page ? page.textContent : '';
        out.hasOverviewTab = !!(page && (page.textContent || '').includes('综述详情'));
        out.hasDocsTab = !!(page && (page.textContent || '').includes('资源文档'));
        out.hasStartBtns = !!(page && page.querySelector('.proj-run-btns'));
        out.hasLaunchBtn = !!(page && (page.textContent || '').includes('一键启动'));
        out.hasBackendUrl = !!(page && (page.textContent || '').includes(':8080'));
        out.hasLaunchPath = !!(page && (page.textContent || '').includes('start-dev.sh'));
        // 修复项③:运行状况每行状态后面内联 启动/停止/重启 按钮(共 3 行 × 3 按钮)
        const runRows = page ? page.querySelectorAll('.proj-run-row') : [];
        out.runRowCount = runRows.length;
        out.restartBtnCount = page ? page.querySelectorAll('.proj-run-btns .btn').length : 0;
        const firstBtns = runRows[0] ? [...runRows[0].querySelectorAll('.proj-run-btns .btn')].map((b) => b.textContent) : [];
        out.firstRowBtns = firstBtns.join('|');
        out.hasRestartBtn = firstBtns.some((t) => t.includes('↻ 重启'));
        out.btnsInRow = !!(runRows[0] && runRows[0].querySelector('.proj-run-btns'));
        // 补丁·115:详情页文字可选中复制 + 服务配置访问地址可点击外部打开
        out.pageUserSelect = page ? getComputedStyle(page).userSelect : '';
        const svcLinks = page ? page.querySelectorAll('.proj-svc-link') : [];
        out.svcLinkCount = svcLinks.length;
        out.svcLinkText = svcLinks.length ? svcLinks[0].textContent : '';
        out.svcLinkClickable = !!svcLinks[0];
        if (svcLinks[0]) { svcLinks[0].click(); await sleep(300); }
        out.svcLinkClickOk = !!(svcLinks[0] && !svcLinks[0].disabled);
        // 点「启动前端」→ 应有状态反馈(toast)
        const startFe = page ? [...page.querySelectorAll('.proj-run-btns .btn')].find((b) => b.textContent.includes('▶ 启动')) : null;
        out.startFeBtn = !!startFe;
        if (startFe) { startFe.click(); await sleep(600); }
        out.toastShown = !!(document.querySelector('.toast'));
        out.toastText = (document.querySelector('.toast') || {}).textContent || '';
        return out;
      })()`);
      await shot('proj-detail.png');

      // 3) 资源文档页签: 新建目录 + 新增条目
      const r3 = await js(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const page = document.getElementById('page-projects');
        const docsTab = page ? [...page.querySelectorAll('.proj-tab')].find((b) => b.textContent.includes('资源文档')) : null;
        out.docsTabFound = !!docsTab;
        if (docsTab) { docsTab.click(); await sleep(500); }
        out.docsVisible = !!(page && page.querySelector('.proj-docs'));
        out.hasRootFolder = !!(page && (page.textContent || '').includes('项目根目录'));
        // 新建目录
        const newDirBtn = page ? [...page.querySelectorAll('.proj-docs-tree-col .btn')].find((b) => b.textContent.includes('新建目录')) : null;
        out.newDirBtn = !!newDirBtn;
        if (newDirBtn) {
          newDirBtn.click(); await sleep(300);
          const mask = document.querySelector('#modal-root .modal-mask:last-child');
          const input = mask ? mask.querySelector('input[type="text"]') : null;
          out.dirDialog = !!input;
          if (input) {
            input.value = '__smoke_dir__';
            input.dispatchEvent(new Event('input'));
            const okBtn = mask.querySelector('.modal-foot .btn.primary');
            okBtn.click(); await sleep(600);
          }
        }
        out.dirCreated = !!(page && (page.textContent || '').includes('__smoke_dir__'));
        // 新增条目(文档)
        const newEntryBtn = page ? [...page.querySelectorAll('.proj-docs-list-col .btn')].find((b) => b.textContent.includes('新增条目')) : null;
        out.newEntryBtn = !!newEntryBtn;
        if (newEntryBtn) {
          newEntryBtn.click(); await sleep(300);
          const mask = document.querySelector('#modal-root .modal-mask:last-child');
          const inputs = mask ? mask.querySelectorAll('.form-row input[type="text"]') : [];
          const ta = mask ? mask.querySelector('textarea') : null;
          const sel = mask ? mask.querySelector('select') : null;
          out.entryDialog = inputs.length >= 1 && !!ta && !!sel;
          if (inputs[0] && ta && sel) {
            inputs[0].value = '__smoke_doc__';
            inputs[0].dispatchEvent(new Event('input'));
            ta.value = 'hello projects smoke';
            ta.dispatchEvent(new Event('input'));
            const okBtn = mask.querySelector('.modal-foot .btn.primary');
            okBtn.click(); await sleep(600);
          }
        }
        out.entryCreated = !!(page && (page.textContent || '').includes('__smoke_doc__'));
        return out;
      })()`);
      await shot('proj-docs.png');

      // 4) 新增项目(侧栏右键 → 新建项目 → 表单) → 自动建节点
      const r4 = await js(`(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // 回到主页(通过详情页返回按钮)
        const page = document.getElementById('page-projects');
        const backBtn = page ? page.querySelector('.proj-detail-head .btn') : null;
        if (backBtn && backBtn.textContent.includes('返回')) { backBtn.click(); await sleep(500); }
        // 右键项目管理中心根 → 新建项目…
        const root = [...document.querySelectorAll('#cat-tree .cat-node')].find((n) => (n.querySelector('.cat-name') || {}).textContent === '项目管理中心');
        if (root) {
          root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 }));
          await sleep(300);
          const menu = document.querySelector('.ctx-menu');
          const item = menu ? [...menu.querySelectorAll('.ctx-item')].find((el) => (el.textContent || '').includes('新建项目')) : null;
          out.ctxNewProj = !!item;
          if (item) { item.click(); await sleep(400); }
        }
        const mask = document.querySelector('#modal-root .modal-mask:last-child');
        const texts = mask ? [...mask.querySelectorAll('.proj-form input[type="text"]')] : [];
        const areas = mask ? [...mask.querySelectorAll('.proj-form textarea')] : [];
        out.projForm = texts.length >= 9 && areas.length >= 4;
        if (out.projForm) {
          texts[0].value = '${TEST_PROJ_NAME}'; texts[0].dispatchEvent(new Event('input'));
          texts[1].value = 'E:/tmp/smoke-proj'; texts[1].dispatchEvent(new Event('input'));
          texts[2].value = 'http://localhost:9999/'; texts[2].dispatchEvent(new Event('input'));
          texts[5].value = 'npm run dev'; texts[5].dispatchEvent(new Event('input'));
          texts[7].value = 'node server.js'; texts[7].dispatchEvent(new Event('input'));
          areas[0].value = 'smoke desc'; areas[0].dispatchEvent(new Event('input'));
          const okBtn = mask.querySelector('.modal-foot .btn.primary');
          okBtn.click(); await sleep(800);
        }
        out.toastAfterCreate = (document.querySelector('.toast') || {}).textContent || '';
        out.detailForNew = !!(page && (page.textContent || '').includes('${TEST_PROJ_NAME}'));
        out.nodeInTree = !![...document.querySelectorAll('#cat-tree .cat-name')].some((n) => n.textContent === '${TEST_PROJ_NAME}');
        // 编辑项目 → 改名 → 节点同步
        const editBtn = page ? [...page.querySelectorAll('.proj-detail-head .btn')].find((b) => b.textContent.includes('编辑项目')) : null;
        out.editBtn = !!editBtn;
        if (editBtn) {
          editBtn.click(); await sleep(400);
          const m2 = document.querySelector('#modal-root .modal-mask:last-child');
          const nameInput = m2 ? m2.querySelector('.proj-form input[type="text"]') : null;
          if (nameInput) {
            nameInput.value = '${TEST_PROJ_NAME}_r'; nameInput.dispatchEvent(new Event('input'));
            const ok2 = m2.querySelector('.modal-foot .btn.primary');
            ok2.click(); await sleep(700);
          }
        }
        out.renamedInTree = !![...document.querySelectorAll('#cat-tree .cat-name')].some((n) => n.textContent === '${TEST_PROJ_NAME}_r');
        out.renamedInDetail = !!(page && (page.textContent || '').includes('${TEST_PROJ_NAME}_r'));
        // 删除项目
        const delBtn = page ? [...page.querySelectorAll('.proj-detail-head .btn')].find((b) => b.textContent.includes('删除')) : null;
        out.delBtn = !!delBtn;
        if (delBtn) {
          delBtn.click(); await sleep(400);
          const m3 = document.querySelector('#modal-root .modal-mask:last-child');
          const ok3 = m3 ? m3.querySelector('.modal-foot .btn.danger') : null;
          out.delConfirm = !!ok3;
          if (ok3) { ok3.click(); await sleep(800); }
        }
        out.backHome = !!(page && page.querySelector('.proj-home'));
        out.deletedFromTree = !![...document.querySelectorAll('#cat-tree .cat-name')].some((n) => (n.textContent || '').includes('${TEST_PROJ_NAME}'));
        return out;
      })()`);
      await shot('proj-crud.png');

      // 5) db 断言(查库,非 DOM)
      const db = dbm.readDb();
      const hedao = (db.projects || []).find((p) => p.name.includes('hedaoedu'));
      const rootNode = (db.menuNodes || []).find((m) => m.action === 'projects');
      const hedaoNode = hedao ? (db.menuNodes || []).find((m) => m.id === hedao.menuNodeId) : null;
      const projTableCount = dbm.dbStats().projects;
      const entryTableCount = dbm.dbStats().projectEntries;
      const dbCheck = {
        hedaoSeeded: !!hedao,
        hedaoRootPath: !!(hedao && hedao.rootPath.includes('hedaoedu')),
        hedaoAccessUrl: !!(hedao && hedao.accessUrl === 'http://localhost:5173/'),
        hedaoLaunchPath: !!(hedao && hedao.launchPath.includes('start-dev.sh')),
        hedaoFrontendCmd: !!(hedao && hedao.frontendCmd === 'npm run dev'),
        hedaoBackendCmd: !!(hedao && hedao.backendCmd.includes('admin-server')),
        hedaoDeploy: !!(hedao && hedao.deployMethod.includes('MySQL')),
        projectsRootInDb: !!rootNode,
        hedaoNodeLinked: !!(hedao && hedaoNode && hedaoNode.action === 'project:' + hedao.id),
        smokeDeleted: !(db.projects || []).some((p) => (p.name || '').includes('__proj_smoke__')),
        smokeEntriesDeleted: !(db.projectEntries || []).some((e) => {
          const p = (db.projects || []).find((x) => x.id === e.projectId);
          return p && (p.name || '').includes('__proj_smoke__');
        }),
        projTableCount,
        entryTableCount,
      };

      const res = { r1, r2, r3, r4, dbCheck };
      console.log('PROJECTS-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = r1.rootNodeFound && r1.pageVisible && r1.hasHedaoCard && r1.cardCount >= 1 && r1.hasAddBtn &&
                 r1.hedaoNodeCount === 1 && r1.pageOverflowY === 'auto' &&
                 r2.openBtnFound && r2.detailVisible && r2.hasOverviewTab && r2.hasDocsTab && r2.hasStartBtns && r2.hasLaunchBtn &&
                 r2.runRowCount === 3 && r2.restartBtnCount === 9 && r2.hasRestartBtn && r2.btnsInRow &&
                 r2.pageUserSelect === 'text' && r2.svcLinkCount >= 2 && r2.svcLinkClickable && r2.svcLinkClickOk &&
                 r3.docsTabFound && r3.docsVisible && r3.newDirBtn && r3.dirCreated && r3.newEntryBtn && r3.entryCreated &&
                 r4.ctxNewProj && r4.projForm && r4.detailForNew && r4.nodeInTree && r4.editBtn && r4.renamedInTree && r4.renamedInDetail && r4.delBtn && r4.delConfirm && r4.backHome && !r4.deletedFromTree &&
                 dbCheck.hedaoSeeded && dbCheck.hedaoRootPath && dbCheck.hedaoAccessUrl && dbCheck.hedaoLaunchPath &&
                 dbCheck.hedaoFrontendCmd && dbCheck.hedaoBackendCmd && dbCheck.hedaoDeploy && dbCheck.projectsRootInDb &&
                 dbCheck.hedaoNodeLinked && dbCheck.smokeDeleted && dbCheck.smokeEntriesDeleted;
      console.log('PROJECTS-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
      clearTimeout(watchdog);
      cleanup();
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SMOKE-ERR', e);
      clearTimeout(watchdog);
      cleanup();
      process.exit(1);
    }
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
