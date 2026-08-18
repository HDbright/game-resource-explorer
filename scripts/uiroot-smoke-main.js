'use strict';
/** 复现:内置「UI资源」(group=ui)根目录下的分类目录,勾选后能否在菜单树列出资源文件 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('uiroot-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const GID = 'ui'; // 内置 UI资源 分组
const ROOT_NAME = 'UI资源'; // 必须匹配内置根名称(用于定位)
const CAT_ID = 'cat_ui';
const CAT_NAME = 'UI_分类';
const ITEM_ID = 'it_ui';
const ITEM_NAME = 'UI_图标';

function setup() {
  const d = dbm.readDb();
  d.settings = d.settings || {};
  // 清理上次冒烟遗留的自定义分组,避免 'UISMOKE资源' 与内置 'UI资源' 名称混淆
  d.settings.customTypeGroups = Array.isArray(d.settings.customTypeGroups)
    ? d.settings.customTypeGroups.filter((g) => g.id !== 'uismoke')
    : [];
  d.categories = d.categories || [];
  d.categories = d.categories.filter((c) => c.id !== CAT_ID);
  // 关键复现场景:分类归属 UI资源(typeTags ['ui']),但条目类型被识别为内置 'image'
  d.categories.push({ id: CAT_ID, name: CAT_NAME, remark: '', parentId: '', sort: 900, createdAt: Date.now(), updatedAt: Date.now(), typeTags: [GID], locked: 0, showItemsInTree: 1 });
  d.items = d.items || [];
  d.items = d.items.filter((i) => i.id !== ITEM_ID);
  const now = Date.now();
  d.items.push({ id: ITEM_ID, categoryId: CAT_ID, type: 'image', filePath: 'E:/ui/x.png', atlasPath: null, displayName: ITEM_NAME, remark: '', size: 100, mtime: now, tags: [], createdAt: now, updatedAt: now });
  d.settings.resourceTab = 'home';
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.categories = (d.categories || []).filter((c) => c.id !== CAT_ID);
  d.items = (d.items || []).filter((i) => i.id !== ITEM_ID);
  dbm.writeDb(d);
}

ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('fs:stat', (_e, p) => { try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch (e) { return null; } });
ipcMain.handle('fs:readBase64', async () => ({ ok: false, error: 'stub' }));
ipcMain.handle('fs:writeFileBase64', async () => ({ ok: false, error: 'stub' }));

app.whenReady().then(async () => {
  setup();
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, '../electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  win.webContents.on('console-message', (e, level, message) => {
    const m = String(message);
    if (/Error|error|异常|失败/.test(m)) console.log('PAGE-LOG[' + level + '] ' + m);
  });
  win.webContents.on('render-process-gone', (_e, details) => console.log('RENDER-PROCESS-GONE ' + JSON.stringify(details)));
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    try {
        const res = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        // 定位内置「UI资源」根(名称精确匹配,避免 'UISMOKE资源' 干扰)
        const roots = [...document.querySelectorAll('.cat-node')];
        const root = roots.find((n) => (n.querySelector('.cat-name') || n).textContent.trim() === 'UI资源');
        out.rootFound = !!root;
        if (root) {
          const a = root.querySelector('.cat-arrow');
          if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await sleep(500);
        }
        const roots2 = [...document.querySelectorAll('.cat-node')];
        const root2 = roots2.find((n) => (n.querySelector('.cat-name') || n).textContent.trim() === 'UI资源');
        out.rootArrowAfter = root2 ? (root2.querySelector('.cat-arrow') || {}).textContent : null;
        out.catFound = roots2.some((n) => (n.textContent || '').includes('UI_分类'));
        const cat = roots2.find((n) => (n.textContent || '').includes('UI_分类'));
        if (cat) {
          const a = cat.querySelector('.cat-arrow');
          if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await sleep(500);
        }
        out.itemNodes = [...document.querySelectorAll('.item-node')].map((n) => (n.textContent || '').trim());
        out.itemShown = out.itemNodes.some((t) => t.includes('UI_图标'));
        return out;
      })()`, true);
      console.log('UIROOT-SMOKE-RESULT ' + JSON.stringify(res, null, 2));
      const ok = res.rootFound && res.catFound && res.itemShown;
      console.log('UIROOT-SMOKE ' + (ok ? 'PASS' : 'FAIL'));
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
