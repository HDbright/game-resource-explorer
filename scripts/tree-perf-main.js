'use strict';
/**
 * 左侧菜单树(renderTree)性能基准(无头 Electron):
 * - 备份并使用 data/skeleton.db 的副本,注入可控规模测试数据(结束后还原原库)
 * - 实测:整体 renderTree 耗时 / countItemsInGroupRoot 聚合耗时 / 条目行渲染耗时 /
 *         搜索逐键路径耗时 / DOM 节点数量
 * 用法: node scripts/tree-perf-main.js [items数量] [categories数量]
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('tree-perf-' + Date.now()); // 每次全新 userData:展开状态等 localStorage 不跨运行残留,结果可复现(退出时自清理)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const DB_FILE = path.join(__dirname, '..', 'data', 'skeleton.db');
const N_ITEMS = parseInt(process.argv[2] || '856', 10);
const N_CATS = parseInt(process.argv[3] || '41', 10);

let orig = null;
function setup() {
  orig = dbm.readDb();
  const d = JSON.parse(JSON.stringify(orig));
  const now = Date.now();
  // 注入测试分类(顶级)+ 测试条目(spine),保持与真实数据同构
  d.categories = (d.categories || []).filter((c) => !String(c.id).startsWith('perf_cat_'));
  d.items = (d.items || []).filter((i) => !String(i.id).startsWith('perf_it_'));
  const per = Math.ceil(N_ITEMS / N_CATS);
  let n = 0;
  for (let c = 0; c < N_CATS && n < N_ITEMS; c++) {
    const cid = 'perf_cat_' + c;
    d.categories.push({ id: cid, name: '性能分类' + c, remark: '', parentId: '', sort: 900 + c, createdAt: now, updatedAt: now, typeTags: ['anim'], locked: 0, showItemsInTree: 1 });
    for (let k = 0; k < per && n < N_ITEMS; k++, n++) {
      d.items.push({ id: 'perf_it_' + n, categoryId: cid, type: 'spine', filePath: 'E:/perf/x' + n + '.json', atlasPath: null, displayName: '性能条目' + n, remark: '', size: 1000 + n, mtime: now, tags: [], createdAt: now, updatedAt: now });
    }
  }
  d.settings = d.settings || {};
  d.settings.resourceTab = 'home';
  dbm.writeDb(d);
}
function cleanup() {
  // 必须经由同一 SQLite 连接写回原始数据:文件级复制会被退出时的 WAL checkpoint 覆盖
  try { if (orig) dbm.writeDb(orig); } catch (e) { console.error('RESTORE-ERR', e.message); }
}

ipcMain.handle('db:read', () => dbm.readDb());
// 渲染端写库全部忽略(防抖 saveState 落盘会把测试数据写回),仅基准脚本自身经 dbm 直写
ipcMain.handle('db:write', () => ({ ok: true }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('fs:stat', (_e, p) => { try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch (e) { return null; } });
ipcMain.handle('fs:readBase64', async () => ({ ok: false, error: 'stub' }));
ipcMain.handle('fs:writeFileBase64', async () => ({ ok: false, error: 'stub' }));

app.whenReady().then(async () => {
  setup();
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, '../electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    const m = String(message);
    if (/PERF-ERR/.test(m)) console.log('PAGE[' + level + '] ' + m);
  });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    let code = '';
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { items: ${N_ITEMS}, cats: ${N_CATS} };
        const $ = (s) => document.querySelector(s);
        const allNodes = (sel) => document.querySelectorAll(sel).length;
        // 0) 初始状态转储(任何交互之前)
        out.initState = {
          expandedRaw: (localStorage.getItem('sidebarExpandedCats') || '').slice(0, 300),
          prunedFlag: localStorage.getItem('sidebarExpandedPruned1'),
          catNodes: allNodes('#cat-tree .cat-node'),
          itemRows: allNodes('#cat-tree .item-node'),
        };
        const clickArrow = (name) => {
          const nodes = [...document.querySelectorAll('.cat-node')];
          const nd = nodes.find((n) => { const nm = n.querySelector('.cat-name'); return nm && nm.textContent.trim() === name; });
          if (!nd) return false;
          const a = nd.querySelector('.cat-arrow');
          if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        };
        // 1) 初始(全折叠)renderTree 已由启动完成;测一次点击动画根展开
        let t0 = performance.now();
        clickArrow('动画资源');
        out.expandAnimRootMs = Math.round(performance.now() - t0);
        await sleep(60);
        // 2) 展开一个分类(渲染其下条目行)
        t0 = performance.now();
        clickArrow('性能分类0');
        out.expandOneCatMs = Math.round(performance.now() - t0);
        await sleep(60);
        out.domAfterOneCat = allNodes('#cat-tree .cat-node') + allNodes('#cat-tree .item-node');
        out.itemRowsOneCat = allNodes('#cat-tree .item-node');
        // 2.5) 展开动画根后条目行的来源诊断(在搜索污染展开状态之前)
        {
          const buckets = [...document.querySelectorAll('#cat-tree .tree-items')].map((w) => {
            const rows = w.querySelectorAll(':scope > .item-node').length;
            let prevName = '';
            let p = w.previousElementSibling;
            while (p && !prevName) { const nm = p.querySelector && p.querySelector('.cat-name'); if (nm) prevName = nm.textContent.trim(); else break; p = p.previousElementSibling; }
            return { name: prevName, rows };
          }).filter((b) => b.rows > 0);
          out.preSearchBuckets = buckets.slice(0, 10);
          out.preSearchTotalRows = buckets.reduce((s, b) => s + b.rows, 0);
          out.preSearchExpanded = JSON.parse(localStorage.getItem('sidebarExpandedCats') || '[]');
        }
        // 3) 搜索路径:逐键输入(150ms 防抖);轮询 __treePerf.tree 计数(renderTree 完成即自增),
        //    测「按键 -> 防抖 -> 树渲染完成」总时长;树纯渲染耗时由 __treePerf.treeMs 累计给出
        const search = $('#search');
        const treeCount = () => (globalThis.__treeRenderCount || 0);
        const waitNextRender = () => new Promise((resolve) => {
          const before = treeCount();
          const iv = setInterval(() => {
            if (treeCount() > before) { clearInterval(iv); resolve(true); }
          }, 3);
          setTimeout(() => { clearInterval(iv); resolve(false); }, 3000);
        });
        const typeAndMeasure = async (ch) => {
          search.value = (search.value || '') + ch;
          const t = performance.now();
          search.dispatchEvent(new Event('input', { bubbles: true }));
          await waitNextRender();
          return Math.round(performance.now() - t);
        };
        const P0 = treeCount();
        const keystrokeMs = [];
        for (const ch of ['性', '能', '条', '目']) keystrokeMs.push(await typeAndMeasure(ch));
        out.searchKeystrokeMs = keystrokeMs; // 含 150ms 防抖;树渲染净耗时见 out.treePhase
        out.domDuringSearch = allNodes('#cat-tree .cat-node') + allNodes('#cat-tree .item-node');
        out.itemRowsDuringSearch = allNodes('#cat-tree .item-node');
        // 4) 清空搜索(立即渲染路径,同步执行 -> 直接测同步耗时)
        const t2 = performance.now();
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        out.searchClearMs = Math.round(performance.now() - t2);
        await sleep(60);
        // 4.5) 展开动画根后 789 个条目行的来源诊断:统计各 tree-items 容器的行数与前置分类名
        {
          const seps = [...document.querySelectorAll('#cat-tree .tree-items')].map((w) => {
            const rows = w.querySelectorAll(':scope > .item-node').length;
            let prevName = '';
            let p = w.previousElementSibling;
            while (p && !prevName) { const nm = p.querySelector && p.querySelector('.cat-name'); if (nm) prevName = nm.textContent.trim(); else break; p = p.previousElementSibling; }
            return prevName + ':' + rows;
          }).filter((s) => !s.endsWith(':0'));
          out.treeItemsBuckets = seps.slice(0, 12);
          out.expandedSaved = (localStorage.getItem('sidebarExpandedCats') || '').slice(0, 200);
        }
        // 5) 本轮搜索阶段 renderTree 渲染次数
        out.treePhase = { calls: treeCount() - P0 };
        return out;
      })()`, true);
      console.log('TREE-PERF-RESULT ' + JSON.stringify(res));
    } catch (e) {
      console.error('PERF-ERR', e);
    }
    cleanup();
    try {
      win.destroy();
      const dir = app.getPath('userData');
      for (let i = 0; i < 5; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
      }
    } catch (e) { /* ignore */ }
    process.exit(0);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
