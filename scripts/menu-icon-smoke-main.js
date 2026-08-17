'use strict';
/** 菜单节点多图标冒烟: 树中 2/4 图标 2 列网格渲染 + 图标选择面板多选(最多4) + 保存截断 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('menu-icon-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const N4 = 'mn_4_' + Date.now();
const N2 = 'mn_2_' + Date.now();
const ICON4 = '\u{1F600}\u{1F603}\u{1F604}\u{1F601}'; // 😀😃😄😁 4 个字素
const ICON2 = '\u{1F600}\u{1F603}';                 // 😀😃 2 个字素

function setup() {
  const d = dbm.readDb();
  d.menuNodes = (d.menuNodes || []).filter((n) => !String(n.id || '').startsWith('mn_4_') && !String(n.id || '').startsWith('mn_2_'));
  const now = Date.now();
  const mk = (id, name, icon, sort) => ({
    id, name, icon, parentId: '', nodeType: 'dir', actionType: 'builtin', action: '',
    tooltip: '', note: '', typeTags: [], isResource: false, locked: false,
    sort, createdAt: now, updatedAt: now,
  });
  d.menuNodes.push(mk(N4, '四图标节点', ICON4, 990));
  d.menuNodes.push(mk(N2, '两图标节点', ICON2, 991));
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.menuNodes = (d.menuNodes || []).filter((n) => !String(n.id || '').startsWith('mn_4_') && !String(n.id || '').startsWith('mn_2_'));
  dbm.writeDb(d);
}

// ---- IPC 桩 ----
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('dir:pick', async () => ({ canceled: true }));
ipcMain.handle('dir:scan', async () => []);
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
ipcMain.handle('fs:saveText', async () => ({ canceled: true }));
ipcMain.handle('fs:rename', async () => ({ ok: false }));
ipcMain.handle('fs:listDir', async () => []);
ipcMain.handle('fs:scanPaths', async () => []);
ipcMain.handle('shell:showItem', async () => ({}));
ipcMain.handle('shell:openPath', async () => ({}));
ipcMain.handle('app:openExternal', async () => ({}));
ipcMain.handle('shell:openWith', async () => ({}));
ipcMain.handle('thumb:get', async () => null);
ipcMain.handle('thumb:save', async () => ({}));
ipcMain.handle('thumb:delete', async () => ({}));
ipcMain.handle('icon:import', async () => null);
ipcMain.handle('icon:fromFile', async () => null);
ipcMain.handle('win:setFullScreen', async () => ({}));
ipcMain.handle('cdp:getState', async () => ({}));
ipcMain.handle('cdp:setState', async () => ({}));
ipcMain.handle('tool:collectFiles', async () => []);
ipcMain.handle('fgui:probe', async () => ({ ok: false }));
ipcMain.handle('fgui:previewLoad', async () => ({ ok: false, error: 'smoke stub' }));
ipcMain.handle('fgui:exportSingle', async () => ({ ok: false, error: 'smoke stub' }));

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!cond) failures++;
}

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
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const out = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const res = {};
        const N4 = ${JSON.stringify(N4)};
        const N2 = ${JSON.stringify(N2)};
        const gcount = (s) => { const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); return [...seg.segment(s)].filter((x) => !/\\s/u.test(x.segment)).length; };
        const lastMask = () => { const ms = document.querySelectorAll('.modal-mask'); return ms.length ? ms[ms.length - 1] : null; };

        // ---------- 1) 树渲染:2/4 图标节点均为 2 列网格 ----------
        const n4 = document.querySelector('#cat-tree .cat-node[data-id="' + N4 + '"]');
        const n2 = document.querySelector('#cat-tree .cat-node[data-id="' + N2 + '"]');
        res.n4Found = !!n4; res.n2Found = !!n2;
        res.n4Multi = n4 ? !!n4.querySelector('.cat-icon.cat-icon-multi') : false;
        res.n2Multi = n2 ? !!n2.querySelector('.cat-icon.cat-icon-multi') : false;
        res.n4Cells = n4 ? n4.querySelectorAll('.cat-icon.cat-icon-multi .cii').length : 0;
        res.n2Cells = n2 ? n2.querySelectorAll('.cat-icon.cat-icon-multi .cii').length : 0;
        const cs = n4 ? getComputedStyle(n4.querySelector('.cat-icon.cat-icon-multi')) : {};
        res.gridFlow = cs.gridAutoFlow || '';
        res.gridRows = (cs.gridTemplateRows || '').split(' ').length;
        res.hasSingle = !!document.querySelector('#cat-tree .cat-node .cat-icon:not(.cat-icon-multi)');
        const shot1 = async () => { try { const img = await window.__shot(); } catch (e) {} };

        // ---------- 2) 编辑 N2:图标选择面板多选(2 → 3) ----------
        n2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
        await sleep(60);
        const menu = document.querySelector('.ctx-menu');
        const editItem = menu ? [...menu.querySelectorAll('.ctx-item')].find((el) => el.textContent === '编辑目录节点') : null;
        res.editItem = !!editItem;
        if (editItem) editItem.click();
        await sleep(120);
        const mask = lastMask();
        const iconRow = mask ? [...mask.querySelectorAll('.form-row')].find((r) => r.querySelector('.f-label') && r.querySelector('.f-label').textContent === '图标(emoji)') : null;
        const iconInp = iconRow ? iconRow.querySelector('input') : null;
        res.iconRow = !!iconRow; res.iconInpInit = iconInp ? iconInp.value : '';
        const pickBtn = iconRow ? iconRow.querySelector('.emoji-pick-btn') : null;
        if (pickBtn) pickBtn.click();
        await sleep(100);
        const pop = document.querySelector('.emoji-pop');
        res.pop = !!pop;
        res.popCount0 = pop ? (pop.querySelector('.emoji-pop-count') || {}).textContent : '';
        const addBtn = pop ? [...pop.querySelectorAll('.emoji-item')].find((b) => b.textContent === '\u{1F604}') : null;
        res.addBtn = !!addBtn;
        if (addBtn) addBtn.click();
        await sleep(50);
        res.popCount1 = pop ? (pop.querySelector('.emoji-pop-count') || {}).textContent : '';
        const okPop = pop ? pop.querySelector('.emoji-pop-foot .btn.primary') : null;
        if (okPop) okPop.click();
        await sleep(80);
        res.popClosed = !document.querySelector('.emoji-pop');
        res.iconInpAfter = iconInp ? iconInp.value : '';
        res.iconInpAfterCount = iconInp ? gcount(iconInp.value) : 0;
        // 保存
        const okModal = mask ? [...mask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '确定') : null;
        if (okModal) okModal.click();
        await sleep(150);
        const d1 = await window.api.dbRead();
        const n2saved = d1.menuNodes.find((n) => n.id === N2);
        res.savedIconCount = n2saved ? gcount(n2saved.icon || '') : -1;

        // ---------- 3) 再次编辑 N2:粘贴 6 个图标 → 保存截断为 4 ----------
        n2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 200 }));
        await sleep(60);
        const menu2 = document.querySelector('.ctx-menu');
        const editItem2 = menu2 ? [...menu2.querySelectorAll('.ctx-item')].find((el) => el.textContent === '编辑目录节点') : null;
        if (editItem2) editItem2.click();
        await sleep(120);
        const mask2 = lastMask();
        const iconRow2 = mask2 ? [...mask2.querySelectorAll('.form-row')].find((r) => r.querySelector('.f-label') && r.querySelector('.f-label').textContent === '图标(emoji)') : null;
        const iconInp2 = iconRow2 ? iconRow2.querySelector('input') : null;
        if (iconInp2) {
          iconInp2.value = '\u{1F600}\u{1F603}\u{1F604}\u{1F601}\u{1F606}\u{1F605}';
          iconInp2.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(50);
        const okModal2 = mask2 ? [...mask2.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '确定') : null;
        if (okModal2) okModal2.click();
        await sleep(150);
        const d2 = await window.api.dbRead();
        const n2final = d2.menuNodes.find((n) => n.id === N2);
        res.finalIconCount = n2final ? gcount(n2final.icon || '') : -1;
        res.capToast = !!([...document.querySelectorAll('div')].find((d) => d.textContent === '图标最多 4 个,已保留前 4 个'));
        // 树重新渲染后 N2 图标格数 = 4
        const n2r = document.querySelector('#cat-tree .cat-node[data-id="' + N2 + '"]');
        res.treeFinalCells = n2r ? n2r.querySelectorAll('.cat-icon.cat-icon-multi .cii').length : 0;
        return res;
      })()`, true);

      check('树渲染:四图标节点存在', out.n4Found);
      check('树渲染:四图标节点为多图标网格', out.n4Multi);
      check('树渲染:四图标节点 4 格', out.n4Cells === 4, 'cells=' + out.n4Cells);
      check('树渲染:两图标节点存在', out.n2Found);
      check('树渲染:两图标节点为多图标网格', out.n2Multi);
      check('树渲染:两图标节点 2 格(竖排)', out.n2Cells === 2, 'cells=' + out.n2Cells);
      check('网格布局:column 方向填充', out.gridFlow === 'column', out.gridFlow);
      check('网格布局:2 行(第 3/4 个进第 2 列)', out.gridRows === 2, out.gridRows);
      check('树渲染:单图标节点不带 multi 类', out.hasSingle);

      check('编辑对话框:图标行存在', out.iconRow);
      check('编辑对话框:输入框初始值 = 2 图标', out.iconInpInit === ICON2, out.iconInpInit);
      check('选择面板:打开成功', out.pop);
      check('选择面板:初始计数 已选 2/4', (out.popCount0 || '').replace(/\s/g, '') === '已选2/4', out.popCount0);
      check('选择面板:点选追加 → 已选 3/4', (out.popCount1 || '').replace(/\s/g, '') === '已选3/4', out.popCount1);
      check('选择面板:确定后关闭', out.popClosed);
      check('选择面板:输入框追加为 3 图标', out.iconInpAfterCount === 3, out.iconInpAfter);
      check('保存:库中图标 = 3 个', out.savedIconCount === 3, 'count=' + out.savedIconCount);

      check('截断:粘贴 6 个保存后 = 4 个', out.finalIconCount === 4, 'count=' + out.finalIconCount);
      check('截断:出现提示 toast', out.capToast);
      check('树刷新:两图标节点 4 格', out.treeFinalCells === 4, 'cells=' + out.treeFinalCells);

      try {
        const img = await win.capturePage();
        fs.writeFileSync(path.join(__dirname, 'menu-icon-smoke.png'), img.toPNG());
      } catch (e) { console.error('SHOT-ERR', e.message); }

      console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
    } catch (err) {
      console.error('SMOKE-ERR', err && err.stack ? err.stack : err);
      failures++;
    }
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
