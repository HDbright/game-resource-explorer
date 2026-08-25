'use strict';
/**
 * 侧栏隐藏性能基准(无头 Electron):
 * - 注入 856 条资源 + 搜索展开巨树(树内 ~2400 条目行)
 * - 对比三种状态下「外部布局变更 → 强制重排」的单次耗时:
 *   visible(侧栏可见) / width0(旧实现:仅 width:0,仍在布局流) / gone(新实现:display:none)
 * - 同时验证隐藏/显示切换功能本身正常
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('side-hide-perf-' + Date.now());
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const N_ITEMS = parseInt(process.argv[2] || '856', 10);
let orig = null;
function setup() {
  orig = dbm.readDb();
  const d = JSON.parse(JSON.stringify(orig));
  const now = Date.now();
  d.categories = (d.categories || []).filter((c) => !String(c.id).startsWith('perf_cat_'));
  d.items = (d.items || []).filter((i) => !String(i.id).startsWith('perf_it_'));
  const per = Math.ceil(N_ITEMS / 41);
  let n = 0;
  for (let c = 0; c < 41 && n < N_ITEMS; c++) {
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
  try { if (orig) dbm.writeDb(orig); } catch (e) { console.error('RESTORE-ERR', e.message); }
}

ipcMain.handle('db:read', () => dbm.readDb());
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
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { items: ${N_ITEMS} };
        // 搜索展开巨树(保持搜索态,树持续 ~2400 行)
        const search = document.getElementById('search');
        search.value = '性能条目';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);
        out.treeRows = document.querySelectorAll('#cat-tree .item-node').length;
        // 强制重排测量:改 header padding(布局失效) + 读 body.offsetHeight,取均值
        const header = document.querySelector('#app-header') || document.body;
        const basePad = header.style.paddingLeft || '';
        const measure = (n) => {
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            header.style.paddingLeft = (i % 2) + 'px';
            void document.body.offsetHeight;
          }
          header.style.paddingLeft = basePad;
          return Math.round(((performance.now() - t0) / n) * 100) / 100;
        };
        const sb = document.getElementById('sidebar');
        const btn = document.getElementById('btn-toggle-side');
        const tree = document.getElementById('cat-tree');
        // 轮换测量消除顺序/缓存偏差:visible / width0(旧实现) / width0+cvh / gone(新实现)
        const states = {
          visible: () => { sb.classList.remove('hidden', 'gone'); tree.style.contentVisibility = ''; },
          width0: () => { sb.classList.add('hidden'); sb.classList.remove('gone'); tree.style.contentVisibility = ''; },
          width0cvh: () => { sb.classList.add('hidden'); sb.classList.remove('gone'); tree.style.contentVisibility = 'hidden'; },
          gone: () => { sb.classList.add('hidden', 'gone'); tree.style.contentVisibility = ''; },
        };
        const keys = Object.keys(states);
        out.rounds = [];
        for (let round = 0; round < 3; round++) {
          const r = {};
          for (const k of keys) { states[k](); void sb.offsetWidth; r[k] = measure(15); }
          out.rounds.push(r);
        }
        out.reflow = out.rounds[2]; // 取末轮(缓存已热)
        // 点击隐藏瞬间的长任务(longtask>50ms = 可感知卡顿):
        // oldSim = 仅 width:0(禁用 cvh、不加 gone,模拟旧实现) / newImpl = 现实现(cvh 过渡 + 完成后 gone)
        const watchLongTasks = async (fn) => {
          const tasks = [];
          let po = null;
          try {
            po = new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)); });
            po.observe({ entryTypes: ['longtask'] });
          } catch (e) { /* ignore */ }
          await fn();
          await sleep(700);
          if (po) po.disconnect();
          return tasks;
        };
        // 旧实现模拟:临时样式覆盖 cvh;手动加 hidden(绕过 JS 的 gone 逻辑),再手动清场
        const noCvh = document.createElement('style');
        noCvh.textContent = '.sidebar.hidden .cat-tree { content-visibility: visible !important; }';
        document.head.appendChild(noCvh);
        out.hideOldLongTasks = await watchLongTasks(() => {
          sb.classList.add('hidden');
          void sb.offsetWidth;
        });
        sb.classList.remove('hidden');
        noCvh.remove();
        await sleep(300);
        // 现实现:真实点击路径(隐藏 + 显示双向各测一次)
        out.hideNewLongTasks = await watchLongTasks(() => {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        out.hideByClick_hidden = sb.classList.contains('hidden');
        out.hideByClick_gone = sb.classList.contains('gone');
        out.showNewLongTasks = await watchLongTasks(() => {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        // 显示过程逐拍采样(诊断)
        out.showTrace = [];
        for (let i = 0; i < 8; i++) {
          out.showTrace.push({
            t: i * 100,
            cls: sb.className,
            w: Math.round(sb.getBoundingClientRect().width * 10) / 10,
            cssW: getComputedStyle(sb).width,
            display: getComputedStyle(sb).display,
          });
          await sleep(100);
        }
        out.showByClick_ok = !sb.classList.contains('hidden') && !sb.classList.contains('gone')
          && !sb.classList.contains('anim')
          && sb.getBoundingClientRect().width > 200;
        out.finalVisibleWidth = Math.round(sb.getBoundingClientRect().width);
        return out;
      })()`, true);
      console.log('SIDE-HIDE-PERF-RESULT ' + JSON.stringify(res));
    } catch (e) {
      console.error('PERF-ERR', e);
    }
    cleanup();
    try {
      win.destroy();
      // Windows 下立即删 userData 可能因 Chromium 句柄未释放而失败,小间隔重试
      const dir = app.getPath('userData');
      for (let i = 0; i < 5; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
      }
    } catch (e) { /* ignore */ }
    process.exit(0);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
