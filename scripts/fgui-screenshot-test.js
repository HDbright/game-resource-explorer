'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fgui = require('../electron/tools/fgui');

const SAMPLE_LOCAL = path.join(__dirname, '..', 'samples', 'fgui', 'ActEmperorArrival.bin');
const OUT_IMG = path.join(__dirname, '..', '_tmp_fgui_preview.png');

app.setName('fgui-screenshot-test');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

ipcMain.handle('fgui:previewLoad', async (_e, { inputPath, textureDir }) => {
  try {
    const { buildPreviewData } = require('../electron/tools/fgui/previewData');
    return buildPreviewData(inputPath, { textureDir });
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fs:readBase64', (_e, p) => {
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' })[ext] || 'application/octet-stream';
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('db:read', () => ({ categories: [], items: [] }));
ipcMain.handle('app:info', () => ({}));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: true,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 800));
    try {
      await win.webContents.executeJavaScript(`(async () => {
        const sceneNode = document.querySelector('.cat-node[data-id="__scene__"]');
        if (sceneNode) sceneNode.click();
        await new Promise((r) => setTimeout(r, 300));
        const entry = document.getElementById('sc-fgui-entry');
        if (entry) entry.click();
        await new Promise((r) => setTimeout(r, 1200));
        // 加载样例包
        if (window.__fguiPreviewTestLoad) {
          await window.__fguiPreviewTestLoad(${JSON.stringify(SAMPLE_LOCAL)});
        }
        await new Promise((r) => setTimeout(r, 1200));
        // 打开编辑模式并点击一个节点,验证属性面板
        const editBtn = document.getElementById('fgpv-edit');
        if (editBtn) editBtn.click();
        await new Promise((r) => setTimeout(r, 200));
        const canvas = document.getElementById('fgpv-canvas');
        const rect = canvas.getBoundingClientRect();
        // 点击画面中央附近(大概率命中主面板)
        const evt = new MouseEvent('click', { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true });
        canvas.dispatchEvent(evt);
        await new Promise((r) => setTimeout(r, 300));
        return { loaded: true, editMode: !!editBtn };
      })()`, true);
      const img = await win.capturePage();
      fs.writeFileSync(OUT_IMG, img.toPNG());
      console.log('Screenshot saved to', OUT_IMG);
    } catch (e) {
      console.error('Screenshot test error:', e.message);
    }
    app.exit(0);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
