'use strict';
/**
 * 舞台工具面板 + 摄影表侧栏布局冒烟:
 * 1) 舞台工具面板默认水平居中(未被拖动时;底部吸附)
 * 2) 动画/曲线侧栏左边框拖拽调宽 + 持久化;双击恢复跟随层级树面板宽度
 * 3) 侧栏默认宽度与层级树面板(.be-rightcol)对齐,且随其拖拽实时跟随(未手动调宽时)
 * 4) 侧栏收起 / 工具面板最小化状态跨重载持久化
 * 5) 首页「最近打开/导入」显示带扩展名文件名 + 上次打开日期时间(兼容旧记录);文件菜单同步
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');
const skani = require('../electron/skaniFile.js');

app.setName('bone-panel-smoke');

// .skani 工程文件 IPC(与 electron/main.js 同款;本脚本即主进程)
ipcMain.handle('skani:write', (_e, args) => skani.skaniWrite(args));
ipcMain.handle('skani:read', (_e, args) => skani.skaniRead(args));
ipcMain.handle('skani:draftWrite', (_e, { docJson, assets }) => skani.skaniWrite({ path: skani.draftPath(app.getPath('userData')), docJson, assets }));
ipcMain.handle('skani:draftRead', () => {
  const f = skani.draftPath(app.getPath('userData'));
  return fs.existsSync(f) ? skani.skaniRead({ path: f }) : { ok: false, noDraft: true };
});
ipcMain.handle('skani:draftClear', () => {
  const f = skani.draftPath(app.getPath('userData'));
  for (const x of [f, f + '.bak']) { try { fs.unlinkSync(x); } catch (e) { /* ignore */ } }
  return { ok: true };
});

// ---- IPC 桩(db 只读,写空操作,不污染真实库) ----
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', async () => ({ ok: true }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true, filePaths: [] }));
ipcMain.handle('dir:pick', async () => ({ canceled: true }));
ipcMain.handle('dir:scan', async () => []);
ipcMain.handle('fs:stat', (_e, p) => {
  try { const s = fs.statSync(p); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch (e) { return null; }
});
ipcMain.handle('fs:readBase64', async () => ({ ok: false, error: 'smoke stub' }));
// 真实写文件:保存直写(writeProjectFile)与保存流程验证
ipcMain.handle('fs:writeFileBase64', async (_e, p, dataUrl) => {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const m = /^data:[^,]+,base64,(.+)$/.exec(String(dataUrl || ''));
    const b64 = m ? m[1] : String(dataUrl || '').replace(/^data:[^,]+,/, '');
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    return { ok: true, path: p };
  } catch (err) { return { ok: false, error: err.message }; }
});
// 真实读文本:phase 3「打开最近 .lbone.json」走真实文件
ipcMain.handle('fs:readText', (_e, p) => {
  try { return { ok: true, text: fs.readFileSync(p, 'utf8') }; } catch (err) { return { ok: false, error: err.message }; }
});
// 真实保存:phase 4 保存按钮链路(saveText 弹窗在冒烟中直写临时目录)
ipcMain.handle('fs:saveText', async (_e, o) => {
  try {
    const p = path.join(TMP_DIR, (o && o.defaultName) || 'smoke-save.lbone.json');
    fs.writeFileSync(p, (o && o.content) || '', 'utf8');
    return { ok: true, path: p };
  } catch (err) { return { ok: false, error: err.message }; }
});
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

/** 进入骨骼编辑器:新建空白项目 + 切动画模式(摄影表可见) */
const NAV = `
  document.dispatchEvent(new CustomEvent('toolbox:navigate', { detail: { id: 'boneeditor' } }));
  true`;
const ENTER = `
  (function () {
    const btn = document.querySelector('.be-home-action[data-act="new"]');
    if (btn) btn.click();
    return !!window.__beEditor;
  })()`;

// 临时 .lbone.json(结构同 createProject):phase 3 走真实「打开最近」链路
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bone-recent-smoke-'));
const PROJ_PATH = path.join(TMP_DIR, 'recent-冒烟项目A.lbone.json');
const PROJ_NAME = 'recent-冒烟项目A.lbone.json';
fs.writeFileSync(PROJ_PATH, JSON.stringify({
  format: 'boneeditor', version: 1, name: 'recent-冒烟项目A', frameRate: 30, images: [],
  armature: {
    name: 'armature',
    bones: [{ name: 'root', parent: '', x: 0, y: 0, rotation: 0, length: 60, scaleX: 1, scaleY: 1, skew: 0, shearX: 0, shearY: 0, inheritTranslation: true, inheritRotation: true, inheritScale: true }],
    slots: [],
    animations: [{ name: 'new_animation', duration: 30, loop: true, bones: {}, slots: {} }],
  },
}), 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920, height: 1000, show: true,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  let phase = 1;
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1300));
    try {
      if (phase === 1) {
        const out = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          // 清场:所有相关键恢复默认(工具面板未拖/未最小化、侧栏未收起未调宽、右列默认宽)
          for (const k of ['beSpineTBX', 'beTlSideW', 'beRightColW']) localStorage.removeItem(k);
          localStorage.setItem('beSpineTBMin', '0');
          localStorage.setItem('beTlSideMin', '0');
          // 进入骨骼编辑器 → 新建空白项目 → 切动画模式
          document.dispatchEvent(new CustomEvent('toolbox:navigate', { detail: { id: 'boneeditor' } }));
          await sleep(600);
          document.querySelector('.be-home-action[data-act="new"]')?.click();
          await sleep(600);
          window.__beEditor?.btnModeAnim?.click();
          await sleep(500);

          // ---------- 1) 工具面板默认水平居中 + 底部吸附 ----------
          // 顶栏模式按钮:Spine 图标 + 「骨架」「动画」短名
          const bSetup = window.__beEditor && window.__beEditor.btnModeSetup;
          const bAnim = window.__beEditor && window.__beEditor.btnModeAnim;
          res.btnSetup = bSetup ? { hasImg: !!bSetup.querySelector('img.be-btn-ico'), text: bSetup.textContent.trim() } : null;
          res.btnAnim = bAnim ? { hasImg: !!bAnim.querySelector('img.be-btn-ico'), text: bAnim.textContent.trim() } : null;
          // 顶栏「移动」按钮:位于旋转之后;点击切 move 工具,且与 Transform 面板「移动」高亮联动
          const bMove = window.__beEditor && window.__beEditor.btnToolMove;
          if (bMove) {
            const order = [...bMove.parentElement.children].filter((b) => b.classList && String(b.className).includes('btn'));
            const iRot = order.findIndex((b) => b.textContent.includes('旋转'));
            const iMove = order.indexOf(bMove);
            bMove.click();
            await sleep(80);
            const activeTop = bMove.classList.contains('active');
            const pnl = window.__beEditor.spineToolbar && window.__beEditor.spineToolbar.btnMove;
            const panelActive = !!(pnl && pnl.classList.contains('on'));
            const toolNow = window.__beEditor.tool;
            window.__beEditor.setTool('select');
            res.btnMoveInfo = { afterRot: iMove === iRot + 1, activeTop, panelActive, toolNow };
            res.btnMoveLink = res.btnMoveInfo.afterRot && activeTop && panelActive && toolNow === 'move';
          }
          // 应用级 CSS zoom(外观字号缩放):合成事件的 clientX 为视觉像素,宽度变化量须除回 zoom
          res.zf = parseFloat(getComputedStyle(document.getElementById('app')).zoom) || 1;
          const tb = document.querySelector('.spine-tb');
          const center = document.querySelector('.be-center');
          res.tbExists = !!tb && !tb.classList.contains('hidden');
          res.tbFits = tb && center ? tb.offsetWidth <= center.clientWidth : false;
          if (tb && center) {
            await sleep(150); // 等 settle(双 rAF)
            const tr = tb.getBoundingClientRect(), cr = center.getBoundingClientRect();
            res.tbCenterOff = Math.abs((tr.left + tr.width / 2) - (cr.left + cr.width / 2));
            res.tbBottomGap = cr.bottom - tr.bottom;
          }

          // ---------- 2) 侧栏默认宽度与层级树面板对齐 ----------
          const side = document.querySelector('.be-tl-side');
          const rz = document.querySelector('.be-tl-side-resize');
          const rc = document.querySelector('.be-rightcol');
          res.rzVisible = !!rz && rz.offsetWidth > 0 && rz.getBoundingClientRect().height > 0;
          if (side && rc) {
            res.sideW0 = side.offsetWidth;
            res.rightcolW0 = rc.offsetWidth;
            res.wAlignOff = Math.abs(side.offsetWidth - rc.offsetWidth);
            const sr = side.getBoundingClientRect(), rr = rc.getBoundingClientRect();
            res.leftAlignOff = Math.abs(sr.left - rr.left);
          }

          // ---------- 3) 左边框拖拽调宽(向左拖 80 → 变宽 80)+ 持久化 ----------
          if (rz && side) {
            const r0 = rz.getBoundingClientRect();
            const down = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
            const move = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
            const up = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
            const drag = (dx) => {
              const r = rz.getBoundingClientRect();
              down(rz, r.left + r.width / 2, r.top + r.height / 2);
              move(r.left + r.width / 2 + dx, r.top + r.height / 2);
              up(r.left + r.width / 2 + dx, r.top + r.height / 2);
            };
            res.dragHelper = down && move && up && drag ? true : false;
            drag(-80);
            await sleep(120);
            res.sideW1 = side.offsetWidth;
            res.wSaved = localStorage.getItem('beTlSideW');
            // 双击 → 恢复跟随层级树
            rz.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            await sleep(150);
            res.sideW2 = side.offsetWidth;
            res.wCleared = localStorage.getItem('beTlSideW') === null;
            // 再拖出用户宽度(供重载后恢复验证)
            drag(-60);
            await sleep(120);
            res.sideW3 = side.offsetWidth;
            res.wSaved2 = localStorage.getItem('beTlSideW');
          }

          // ---------- 4) 侧栏收起(收起状态持久化) ----------
          const tg = document.querySelector('.be-tl-side-toggle');
          res.tgExists = !!tg;
          if (tg) {
            tg.click();
            await sleep(150);
            res.sideHidden = getComputedStyle(document.querySelector('.be-tl-side')).display === 'none';
            res.rzHidden = getComputedStyle(document.querySelector('.be-tl-side-resize')).display === 'none';
            res.minSaved = localStorage.getItem('beTlSideMin');
          }

          // ---------- 5) 工具面板最小化(持久化) ----------
          const lab = document.querySelector('.spine-tb .stb-glabel');
          res.labExists = !!lab;
          if (lab) {
            lab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            await sleep(150);
            res.tbHidden = document.querySelector('.spine-tb').classList.contains('hidden');
            res.tbMinSaved = localStorage.getItem('beSpineTBMin');
            res.minBtn = !!document.querySelector('.be-spine-min-btn');
          }
          return res;
        })()`, true);

        check('工具面板:存在且未最小化', out.tbExists);
        check('顶栏:骨架按钮=图标+「骨架」', !!(out.btnSetup && out.btnSetup.hasImg && out.btnSetup.text === '骨架'), JSON.stringify(out.btnSetup));
        check('顶栏:动画按钮=图标+「动画」', !!(out.btnAnim && out.btnAnim.hasImg && out.btnAnim.text === '动画'), JSON.stringify(out.btnAnim));
        check('顶栏:移动按钮存在(旋转之后),点击与 Transform 面板联动', out.btnMoveLink === true, JSON.stringify(out.btnMoveInfo));
        check('工具面板:宽度能容纳进舞台(测试窗口足够宽)', out.tbFits === true, 'zf=' + out.zf);
        check('工具面板:默认水平居中(±3px)', out.tbCenterOff != null && out.tbCenterOff <= 3, 'off=' + out.tbCenterOff);
        check('工具面板:吸附舞台底边(±2px)', out.tbBottomGap != null && Math.abs(out.tbBottomGap) <= 2, 'gap=' + out.tbBottomGap);
        check('侧栏:拖拽手柄存在且可见', out.rzVisible);
        check('侧栏:默认宽度=层级树面板宽度(±1px)', out.wAlignOff != null && out.wAlignOff <= 1, 'side=' + out.sideW0 + ' rightcol=' + out.rightcolW0);
        check('侧栏:左边框与层级树面板垂直对齐(±1.5px)', out.leftAlignOff != null && out.leftAlignOff <= 1.5, 'off=' + out.leftAlignOff);
        check('侧栏:向左拖 80 → 宽度+80/zoom(±3px)', out.sideW1 != null && Math.abs((out.sideW1 - out.sideW0) * out.zf - 80) <= 3, out.sideW0 + '->' + out.sideW1 + ' zf=' + out.zf);
        check('侧栏:拖拽宽度已持久化', !!out.wSaved && Math.abs(parseFloat(out.wSaved) - out.sideW1) <= 2, 'saved=' + out.wSaved);
        check('侧栏:双击恢复跟随(宽度=层级树±1px)', out.sideW2 != null && Math.abs(out.sideW2 - out.rightcolW0) <= 1, 'now=' + out.sideW2);
        check('侧栏:双击后清除用户宽度', out.wCleared === true);
        check('侧栏:再次拖出用户宽度(供重载验证)', out.sideW3 != null && Math.abs((out.sideW3 - out.sideW2) * out.zf - 60) <= 3, 'now=' + out.sideW3 + ' saved=' + out.wSaved2);
        check('侧栏:收起开关存在', out.tgExists);
        check('侧栏:收起后隐藏', out.sideHidden === true);
        check('侧栏:收起后手柄同步隐藏', out.rzHidden === true);
        check('侧栏:收起状态已持久化', out.minSaved === '1', 'val=' + out.minSaved);
        check('工具面板:组标题存在(最小化入口)', out.labExists);
        check('工具面板:右键最小化生效', out.tbHidden === true);
        check('工具面板:最小化状态已持久化', out.tbMinSaved === '1', 'val=' + out.tbMinSaved);
        check('工具面板:最小化恢复图标存在', out.minBtn === true);

        phase = 2;
        win.webContents.reload();
        return;
      }

      if (phase === 2) {
        const out = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          // 重载后重新进入编辑器(动画模式;侧栏应保持收起、工具面板应保持最小化)
          document.dispatchEvent(new CustomEvent('toolbox:navigate', { detail: { id: 'boneeditor' } }));
          await sleep(600);
          document.querySelector('.be-home-action[data-act="new"]')?.click();
          await sleep(200);
          // 首页「新建」可能弹自动草稿覆盖确认(上一阶段退出时保存了草稿):点「确定」继续
          const okBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => (b.textContent || '').trim() === '确定');
          if (okBtn) { okBtn.click(); await sleep(400); }
          await sleep(400);
          window.__beEditor?.btnModeAnim?.click();
          await sleep(500);
          res.tbStillHidden = document.querySelector('.spine-tb')?.classList.contains('hidden');
          res.tbMinBtn = !!document.querySelector('.be-spine-min-btn');
          const side = document.querySelector('.be-tl-side');
          const rz = document.querySelector('.be-tl-side-resize');
          res.sideStillHidden = getComputedStyle(side).display === 'none';
          res.wSavedReload = localStorage.getItem('beTlSideW');

          // 展开侧栏:恢复用户拖拽的宽度
          const tg = document.querySelector('.be-tl-side-toggle');
          if (tg) { tg.click(); await sleep(200); }
          res.sideW = side.offsetWidth;

          // 恢复工具面板
          const mb = document.querySelector('.be-spine-min-btn');
          if (mb) { mb.click(); await sleep(300); }
          res.tbRestored = !document.querySelector('.spine-tb').classList.contains('hidden');

          // 双击侧栏手柄 → 恢复跟随;再拖层级树分界线 → 侧栏应实时跟随(RO)
          if (rz) {
            rz.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            await sleep(200);
            res.followW0 = side.offsetWidth;
            const crz = document.querySelector('.be-col-resize');
            const down = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, isPrimary: true }));
            const move = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, isPrimary: true }));
            const up = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, isPrimary: true }));
            const r = crz.getBoundingClientRect();
            down(crz, r.left + 3, r.top + 40);
            move(r.left + 3 - 60, r.top + 40);
            up(r.left + 3 - 60, r.top + 40);
            await sleep(300);
            res.rightcolW1 = document.querySelector('.be-rightcol').offsetWidth;
            res.followW1 = side.offsetWidth;
          }

          // 截图前终态复测:层级树拖宽(舞台变窄)后,工具面板仍应保持居中
          const tbF = document.querySelector('.spine-tb');
          const centerF = document.querySelector('.be-center');
          if (tbF && centerF) {
            const tr2 = tbF.getBoundingClientRect(), cr2 = centerF.getBoundingClientRect();
            res.finalCenterOff = Math.abs((tr2.left + tr2.width / 2) - (cr2.left + cr2.width / 2));
          }

          // 清场(不影响真实使用)
          for (const k of ['beSpineTBX', 'beTlSideW', 'beRightColW']) localStorage.removeItem(k);
          localStorage.setItem('beSpineTBMin', '0');
          localStorage.setItem('beTlSideMin', '0');
          return res;
        })()`, true);

        check('重载:工具面板保持最小化', out.tbStillHidden === true);
        check('重载:工具面板恢复图标存在', out.tbMinBtn === true);
        check('重载:侧栏保持收起', out.sideStillHidden === true);
        check('重载:用户侧栏宽度存档仍在', !!out.wSavedReload, 'val=' + out.wSavedReload);
        check('重载:展开后恢复用户宽度(±2px)', out.sideW != null && Math.abs(out.sideW - parseFloat(out.wSavedReload)) <= 2, 'w=' + out.sideW);
        check('重载:点图标恢复工具面板', out.tbRestored === true);
        check('跟随:双击后宽度=层级树(±1px)', out.followW0 != null && out.followW1 != null, 'w0=' + out.followW0);
        check('跟随:层级树拖宽 60 后侧栏实时跟随(±1px)', out.followW1 != null && out.rightcolW1 != null && Math.abs(out.followW1 - out.rightcolW1) <= 1, 'side=' + out.followW1 + ' rightcol=' + out.rightcolW1);
        check('终态:舞台变窄后工具面板仍居中(±3px)', out.finalCenterOff != null && out.finalCenterOff <= 3, 'off=' + out.finalCenterOff);

        // ---------- 6) 首页最近记录:文件名(带扩展名)+ 打开日期时间 ----------
        const rec = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          const ed = window.__beEditor;
          // 回首页;注入旧格式记录(name=项目名 / 无 name),验证显示层取路径文件名
          ed._goHome();
          await sleep(200);
          localStorage.setItem('boneEditorRecent', JSON.stringify([
            { path: 'C:/legacy/旧工程.lbone.json', name: 'spine_project', kind: 'project', openedAt: Date.now() - 86400000 },
            { path: 'D:/spine/hero-pro.spine', kind: 'spineproj', openedAt: Date.now() - 3600000 },
          ]));
          ed._renderRecent();
          await sleep(120);
          const box = document.querySelector('.be-recent');
          res.legacyVisible = !!box && !box.hidden;
          res.legacyNames = [...box.querySelectorAll('.be-recent-name')].map((e) => e.textContent);
          res.legacyNoProjName = res.legacyNames.every((n) => !n.includes('spine_project'));
          res.legacyHasExt = res.legacyNames.every((n) => /\\.(lbone\\.json|spine)$/i.test(n));
          res.legacyTimes = [...box.querySelectorAll('.be-recent-time')].map((e) => e.textContent);
          const tip1 = (box.querySelector('.be-recent-item') || {}).title || '';
          res.tipHasFileAndPath = tip1.includes('旧工程.lbone.json') && tip1.includes('C:/legacy/');

          // 真实链路:点击指向临时 .lbone.json 的最近记录 → 重新记录(文件名 + 当前时间)
          const P = ${JSON.stringify(PROJ_PATH)};
          localStorage.setItem('boneEditorRecent', JSON.stringify([{ path: P, kind: 'project', openedAt: Date.now() - 7 * 86400000 }]));
          ed._renderRecent();
          await sleep(120);
          await ed._openRecent(P);
          await sleep(400);
          ed._goHome();
          await sleep(200);
          const box2 = document.querySelector('.be-recent');
          const first = box2.querySelector('.be-recent-item');
          res.openFirstName = first ? first.querySelector('.be-recent-name').textContent : '';
          res.openFirstTime = first ? (first.querySelector('.be-recent-time') || {}).textContent : '';
          res.openFirstKind = first ? (first.querySelector('.be-recent-kind') || {}).textContent : '';
          res.openView = ed.view;

          // 文件菜单「打开最近」子菜单:显示文件名 + 时间
          ed.btnFile.click();
          await sleep(150);
          const menu = document.querySelector('.ctx-menu');
          const parent = menu ? [...menu.querySelectorAll('.ctx-item')].find((el) => el.textContent.includes('打开最近 ▸')) : null;
          res.menuParent = !!parent;
          if (parent) {
            parent.dispatchEvent(new MouseEvent('mouseenter'));
            await sleep(150);
            const sub = document.querySelector('.ctx-submenu');
            res.subLabels = sub ? [...sub.querySelectorAll('.ctx-item')].map((e) => e.textContent) : [];
          }
          document.querySelector('.ctx-menu')?.remove();
          document.querySelector('.ctx-submenu')?.remove();
          localStorage.setItem('boneEditorRecent', '[]');
          return res;
        })()`, true);

        check('最近:首页列表可见(注入旧格式记录)', rec.legacyVisible === true);
        check('最近:显示带扩展名文件名(旧记录也取路径文件名)', rec.legacyHasExt === true && JSON.stringify(rec.legacyNames).includes('hero-pro.spine') && JSON.stringify(rec.legacyNames).includes('旧工程.lbone.json'), JSON.stringify(rec.legacyNames));
        check('最近:不再显示 spine_project 项目名', rec.legacyNoProjName === true);
        const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
        check('最近:显示打开日期时间(YYYY-MM-DD HH:mm)', (rec.legacyTimes || []).length === 2 && rec.legacyTimes.every((t) => TIME_RE.test(String(t).replace(/^🕒\s*/, ''))), JSON.stringify(rec.legacyTimes));
        check('最近:悬浮提示含文件名与完整路径', rec.tipHasFileAndPath === true);
        check('最近:点击打开后记录为文件名+时间+类型', rec.openFirstName === PROJ_NAME && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(rec.openFirstTime || '').replace(/^🕒\s*/, '')) && rec.openFirstKind === '项目', rec.openFirstName + ' | ' + rec.openFirstTime + ' | ' + rec.openFirstKind);
        check('最近:文件菜单子菜单显示文件名+时间', rec.menuParent === true && (rec.subLabels || []).some((t) => t.includes(PROJ_NAME) && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)), JSON.stringify((rec.subLabels || [])[0] || ''));

        // ---------- 7) 保存按钮未保存高亮 + 层级树皮肤节点位置 ----------
        const sv1 = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          const ed = window.__beEditor;
          const P = ${JSON.stringify(PROJ_PATH)};
          // 重新播种最近记录并打开临时项目
          localStorage.setItem('boneEditorRecent', JSON.stringify([{ path: P, kind: 'project', openedAt: Date.now() }]));
          await ed._openRecent(P);
          await sleep(300);
          const btn = document.querySelector('.be-toolbar .be-save-btn');
          res.btnExists = !!btn;
          res.cleanAfterOpen = !!btn && !btn.classList.contains('dirty');
          // 注入皮肤(≥2 套可选)+ 插槽(出绘制顺序分区),验证层级树分区顺序:骨骼 → 皮肤 → 绘制顺序
          ed.project.spine = Object.assign({}, ed.project.spine, {
            skin: 'default',
            raw: { skins: [{ name: 'default' }, { name: '皮肤A' }, { name: '皮肤B' }] },
          });
          if (!ed.project.armature.slots.some((s) => s.name === 'smoke_slot')) {
            ed.project.armature.slots.push({ name: 'smoke_slot', parent: 'root', z: 0, displayIndex: 0, color: { r: 255, g: 255, b: 255, a: 1 }, displays: [], locked: false });
          }
          ed.refresh();
          await sleep(200);
          // 打开 .lbone.json 后:已关联保存路径(Ctrl+S 直写覆盖,不再弹框)
          res.savePathAfterOpen = ed._savePath;
          const secs = [...document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-sec-row .be-tree-sec-label')].map((e) => e.textContent.trim());
          res.sections = secs;
          // 顶级「骨骼」分组已改为骨架名(项目名/工程基名)+ Setup 图标;原独立骨架根行(.arm)已移除
          res.skeletonIcon = !!document.querySelector('.be-tab-body[data-body="outline"] .be-tree-sec-row .be-tree-ico-img');
          res.noArmRow = !document.querySelector('.be-tab-body[data-body="outline"] .be-tree-row.arm');
          res.rootNameIsProject = secs[0] === 'recent-冒烟项目A';
          const iSkin = secs.findIndex((s) => s.includes('皮肤'));
          const iZorder = secs.findIndex((s) => s.includes('绘制顺序'));
          res.skinBetween = iSkin === 1 && iZorder === 2;
          // 皮肤/绘制顺序/动画等分区 = 骨架子节点(depth 1,与 root 骨骼同级);折叠骨架收起整棵子树
          res.sectionsDepth = [...document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-sec-row')].map((el) => el.dataset.depth);
          const headRow = document.querySelector('.be-tab-body[data-body="outline"] .be-tree-sec-row');
          if (headRow) {
            headRow.click(); await sleep(150);
            res.rowsAfterCollapse = document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-row').length; // 仅骨架行 = 1
            headRow.click(); await sleep(150);
            res.rowsAfterExpand = document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-row').length;
          }
          // 「全部折叠」:保留骨架名/root/各分组头,仅收起深层内容
          const btnCollapseAll = [...document.querySelectorAll('.be-tree-toolbar .be-tree-flag')]
            .find((b) => (b.textContent || '').trim() === '⊖');
          if (btnCollapseAll) {
            btnCollapseAll.click(); await sleep(150);
            const secs2 = [...document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-sec-row .be-tree-sec-label')].map((e) => e.textContent.trim());
            res.collapseAllSections = secs2;
            res.collapseAllRootVisible = !!document.querySelector('.be-tab-body[data-body="outline"] .be-tree-name');
            // 还原
            window.__beEditor.panels.treeCollapsed.clear();
            window.__beEditor.panels.refreshOutline();
            await sleep(100);
          }
          res.skinKids = document.querySelectorAll('.be-tab-body[data-body="outline"] .be-tree-skin').length;
          ed._markSaved(); // 注入态作为基线
          // 编辑 → 按钮高亮
          ed.beginEdit('冒烟改工程名');
          ed.project.name = 'smoke-renamed';
          ed.refresh();
          await sleep(150);
          res.dirtyAfterEdit = btn.classList.contains('dirty');
          return res;
        })()`, true);

        check('保存:顶栏保存按钮存在', sv1.btnExists === true);
        check('保存:打开/载入工程后普通状态', sv1.cleanAfterOpen === true);
        check('层级树:皮肤分区在骨架名与绘制顺序之间', sv1.skinBetween === true, JSON.stringify(sv1.sections));
        check('层级树:骨架名分组带 Setup 图标', sv1.skeletonIcon === true);
        check('层级树:独立骨架根行已移除', sv1.noArmRow === true);
        check('层级树:顶级分组显示工程/项目名', sv1.rootNameIsProject === true, JSON.stringify(sv1.sections));
        check('层级树:皮肤/绘制顺序/动画为骨架子节点(depth=1)', (sv1.sectionsDepth || []).length >= 4 && sv1.sectionsDepth[0] === '0' && sv1.sectionsDepth.slice(1).every((d) => d === '1'), JSON.stringify(sv1.sectionsDepth));
        check('层级树:折叠骨架收起整棵子树', sv1.rowsAfterCollapse === 1 && sv1.rowsAfterExpand > 1, 'collapsed=' + sv1.rowsAfterCollapse + ' expanded=' + sv1.rowsAfterExpand);
        check('层级树:全部折叠保留骨架/root/分组节点', Array.isArray(sv1.collapseAllSections) && sv1.collapseAllSections.length >= 4 && sv1.collapseAllSections[0] === 'recent-冒烟项目A' && sv1.collapseAllRootVisible === true, JSON.stringify(sv1.collapseAllSections));
        check('层级树:多套皮肤列出子节点', (sv1.skinKids || 0) === 2, 'kids=' + sv1.skinKids);
        check('保存:修改工程后按钮高亮', sv1.dirtyAfterEdit === true);

        try {
          const imgDirty = await win.capturePage();
          fs.writeFileSync(path.join(__dirname, 'bone-panel-smoke.png'), imgDirty.toPNG());
        } catch (e) { /* 截图失败不阻断 */ }

        const sv2 = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          const ed = window.__beEditor;
          const btn = document.querySelector('.be-toolbar .be-save-btn');
          // 撤销回到基线 → 熄灭
          ed.undo();
          await sleep(150);
          res.cleanAfterUndo = !btn.classList.contains('dirty');
          // 再改 → 点保存按钮 → 保存成功后熄灭
          ed.beginEdit('冒烟改工程名2');
          ed.project.name = 'smoke-renamed-2';
          ed.refresh();
          await sleep(100);
          res.dirtyBeforeSave = btn.classList.contains('dirty');
          btn.click();
          await sleep(400);
          res.cleanAfterSave = !btn.classList.contains('dirty');
          res.savedName = ed.project.name;
          return res;
        })()`, true);

        check('保存:撤销回基线后熄灭', sv2.cleanAfterUndo === true);
        check('保存:再次修改后高亮', sv2.dirtyBeforeSave === true);
        check('保存:点击保存后熄灭', sv2.cleanAfterSave === true, 'name=' + sv2.savedName);
        // 打开 .lbone.json 的直存语义:保存后关联路径仍是原文件(弹框会另选路径),且内容已更新
        {
          const fp = await win.webContents.executeJavaScript(`(async () => {
            const P = ${JSON.stringify(PROJ_PATH)};
            const rf = await window.api.readText(P);
            return { hasEdit: !!(rf && rf.ok && rf.text.includes('smoke-renamed-2')), path: window.__beEditor._savePath };
          })()`, true);
          check('保存:打开的工程直写覆盖(不弹框)', fp.path === PROJ_PATH && fp.hasEdit === true, JSON.stringify(fp.path));
        }
        await win.webContents.executeJavaScript(`localStorage.setItem('boneEditorRecent', '[]')`, true);

        // ---------- 8) 手柄拖拽中数值实时回显(不等松手) ----------
        const tv = await win.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const res = {};
          const ed = window.__beEditor;
          // 新项目:干净的非 Spine 工程(图片绑定被 spine 工程保护拦截)
          ed.newProject();
          await sleep(250);
          const okBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => (b.textContent || '').trim() === '确定');
          if (okBtn) { okBtn.click(); await sleep(400); }
          // 骨骼 + 64x64 图片(程序生成),图片绑在骨线上方 (0,60),避免与关节/骨线命中冲突
          ed.createBone('', 0, 0, 0, 120);
          const c2 = document.createElement('canvas'); c2.width = c2.height = 64;
          const g2 = c2.getContext('2d'); g2.fillStyle = '#4db6ac'; g2.fillRect(0, 0, 64, 64);
          ed.project.images.push({ id: 'img_smoke', name: 'smoke.png', w: 64, h: 64, dataUrl: c2.toDataURL('image/png') });
          ed.bindImageAt('img_smoke', 0, 60);
          ed.refresh();
          await sleep(600);
          ed.refresh();
          await sleep(200);
          const st = ed.stage;
          const cv = st.app.canvas;
          const zf = st._zoomFactor();
          const rcv = cv.getBoundingClientRect();
          const sx = (wx) => (wx * st.camera.zoom + st.camera.x) * zf + rcv.left;
          const sy = (wy) => (wy * st.camera.zoom + st.camera.y) * zf + rcv.top;
          const pd = (x, y) => cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, isPrimary: true }));
          const pm = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, isPrimary: true }));
          const pu = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, isPrimary: true }));
          const tb = ed.spineToolbar;
          const bone = ed.project.armature.bones[0];
          const slot = ed.project.armature.slots[0];
          res.boneName = bone && bone.name;
          res.slotName = slot && slot.name;
          res.mode = ed.mode;

          // --- 图片附件·移动:移动工具点图片直接拖(拖拽中 X 实时变化) ---
          ed.setTool('move');
          ed.select('slot', slot.name);
          await sleep(120);
          res.attMoveBefore = tb.inMx.value;
          pd(sx(20), sy(60));
          pm(sx(60), sy(60));
          await sleep(60);
          res.attMoveDragKind = st._drag && st._drag.kind;
          res.attMoveDuring = tb.inMx.value;
          pu(sx(60), sy(60));
          await sleep(80);

          // --- 图片附件·垂直方向:上拖 30 → Y 实时 -30(方向与鼠标一致) ---
          ed.setTool('move');
          ed.select('slot', slot.name);
          await sleep(120);
          res.attUpBefore = tb.inMy.value;
          pd(sx(40), sy(60));
          pm(sx(40), sy(30));
          await sleep(60);
          res.attUpDuring = tb.inMy.value;
          pu(sx(40), sy(30));
          await sleep(80);

          // --- 图片附件·旋转:旋转工具点图片(轴心=图片几何中心,随附件移动后的实际位置) ---
          ed.setTool('rotate');
          ed.select('slot', slot.name);
          await sleep(120);
          const disp = slot.displays[slot.displayIndex >= 0 ? slot.displayIndex : 0];
          const piv2 = st._imgCenterWorld(slot, disp);
          res.attRotPiv = piv2 && [Math.round(piv2.x), Math.round(piv2.y)];
          res.attRotBefore = tb.inRot.value;
          pd(sx(piv2.x + 30), sy(piv2.y));
          pm(sx(piv2.x + 30 * Math.SQRT1_2), sy(piv2.y + 30 * Math.SQRT1_2));
          await sleep(60);
          res.attRotDragKind = st._drag && st._drag.kind;
          res.attRotDuring = tb.inRot.value;
          pu(sx(piv2.x + 30 * Math.SQRT1_2), sy(piv2.y + 30 * Math.SQRT1_2));
          await sleep(80);

          // --- 骨骼·旋转(装配模式) ---
          ed.setTool('rotate');
          ed.select('bone', bone.name);
          await sleep(120);
          res.rotBefore = tb.inRot.value;
          pd(sx(30), sy(0));
          pm(sx(30 * Math.SQRT1_2), sy(30 * Math.SQRT1_2));
          await sleep(60);
          res.rotDuring = tb.inRot.value;
          res.rotDuringMatchesBone = Math.abs(parseFloat(res.rotDuring) - bone.rotation) < 0.01;
          pu(sx(30 * Math.SQRT1_2), sy(30 * Math.SQRT1_2));
          await sleep(80);

          // --- 骨骼·移动:移动工具点空白区(选中骨骼即为目标;抓取点远离骨骼原点,验证不瞬移) ---
          ed.setTool('move');
          ed.select('bone', bone.name);
          await sleep(120);
          res.moveBefore = tb.inMx.value;
          res.boneBeforeMove = [bone.x, bone.y];
          pd(sx(0), sy(-60));
          res.moveDragKind = st._drag && st._drag.kind;
          pm(sx(0), sy(-59)); // 仅 1px:parent 轴向旧实现为绝对定位,抓取点偏离原点时骨骼会瞬移到指针
          await sleep(60);
          res.boneAfter1px = [bone.x, bone.y];
          pm(sx(50), sy(-60));
          await sleep(60);
          res.moveDuring = tb.inMx.value;
          pu(sx(50), sy(-60));
          await sleep(80);

          // --- 骨骼·垂直方向:上拖 30 → Y 实时 -30(方向与鼠标一致) ---
          ed.setTool('move');
          ed.select('bone', bone.name);
          await sleep(120);
          res.boneUpBefore = tb.inMy.value;
          pd(sx(0), sy(-60));
          pm(sx(0), sy(-90));
          await sleep(60);
          res.boneUpDuring = tb.inMy.value;
          pu(sx(0), sy(-90));
          await sleep(80);

          // --- 骨骼·缩放:沿骨线方向取点(距关节 20→40,比例 ×2;坐标随骨骼当前世界位姿) ---
          ed.setTool('scale');
          ed.select('bone', bone.name);
          await sleep(120);
          const wSc = st.worlds.get(bone.name);
          const dirSc = Math.atan2(wSc.b, wSc.a);
          res.scaleBefore = tb.inSx.value;
          pd(sx(wSc.tx + 20 * Math.cos(dirSc)), sy(wSc.ty + 20 * Math.sin(dirSc)));
          pm(sx(wSc.tx + 40 * Math.cos(dirSc)), sy(wSc.ty + 40 * Math.sin(dirSc)));
          await sleep(60);
          res.scaleDuring = tb.inSx.value;
          pu(sx(wSc.tx + 40 * Math.cos(dirSc)), sy(wSc.ty + 40 * Math.sin(dirSc)));
          await sleep(80);

          // --- 骨骼·倾斜:骨线方向 → +45°(shearX=45;坐标随骨骼当前世界位姿) ---
          ed.setTool('shear');
          ed.select('bone', bone.name);
          await sleep(120);
          const wSh = st.worlds.get(bone.name);
          const dirSh = Math.atan2(wSh.b, wSh.a);
          res.shearBefore = tb.inHx.value;
          pd(sx(wSh.tx + 25 * Math.cos(dirSh)), sy(wSh.ty + 25 * Math.sin(dirSh)));
          pm(sx(wSh.tx + 25 * Math.cos(dirSh + Math.PI / 4)), sy(wSh.ty + 25 * Math.sin(dirSh + Math.PI / 4)));
          await sleep(60);
          res.shearDuring = tb.inHx.value;
          pu(sx(wSh.tx + 25 * Math.cos(dirSh + Math.PI / 4)), sy(wSh.ty + 25 * Math.sin(dirSh + Math.PI / 4)));
          await sleep(80);

          // —— 保存语义:新建工程首次保存(默认 .skani)→ 关联路径;二次保存直写;重开往返 ——
          ed.beginEdit('冒烟改工程名3');
          ed.project.name = 'smoke-save-flow';
          ed.refresh();
          await sleep(100);
          res.savePathBefore = ed._savePath;
          ed.btnSave.click();
          await sleep(400);
          const p1 = ed._savePath;
          res.saveFlow1 = { pathSet: !!p1, isSkani: !!p1 && /\.skani$/i.test(p1), dirty: ed._dirty };
          ed.beginEdit('冒烟改工程名4');
          ed.project.name = 'smoke-save-flow-2';
          ed.refresh();
          await sleep(100);
          ed.btnSave.click();
          await sleep(400);
          res.saveFlow2 = { samePath: ed._savePath === p1, dirty: ed._dirty };
          // .skani 重开往返:内容/溯源/编辑状态恢复
          const rr = p1 ? await window.api.skaniRead({ path: p1 }) : null;
          if (rr && rr.ok) {
            const doc = JSON.parse(rr.docJson);
            res.skaniRoundtrip = {
              name: doc.project.name,
              nameOk: doc.project.name === 'smoke-save-flow-2',
              bones: doc.project.armature.bones.length,
              imgRef: doc.project.images[0] && doc.project.images[0].assetRef,
              imgHydrated: !!(rr.assets && rr.assets[0] && rr.assets[0].dataUrl),
              noDataUrlInDoc: !rr.docJson.includes('data:image'),
              source: doc.source && doc.source.kind,
            };
            // openSkani 打开并校验
            await ed.openSkani(p1);
            await sleep(300);
            res.skaniReopen = {
              name: ed.project.name,
              boneCount: ed.project.armature.bones.length,
              imgDataUrl: (ed.project.images[0] || {}).dataUrl || '',
              savePath: ed._savePath === p1,
            };
          } else {
            res.skaniRoundtrip = { err: rr && rr.error };
          }
          return res;
        })()`, true);

        const near = (v, t, tol) => Math.abs(parseFloat(v) - t) <= tol;
        check('实时:测试骨架就绪(骨骼+插槽,装配模式)', !!tv.boneName && !!tv.slotName && tv.mode === 'setup', tv.boneName + '/' + tv.slotName);
        check('实时:附件·移动走 moveSlot 拖拽', tv.attMoveDragKind === 'moveSlot', 'kind=' + tv.attMoveDragKind);
        check('实时:附件·移动拖拽中 X=40(不等松手)', near(tv.attMoveDuring, 40, 1.5), 'before=' + tv.attMoveBefore + ' during=' + tv.attMoveDuring);
        check('方向:附件·上拖 Y=基线-30(与鼠标一致)', near(tv.attUpDuring, parseFloat(tv.attUpBefore) - 30, 1.5), 'before=' + tv.attUpBefore + ' during=' + tv.attUpDuring);
        check('实时:附件·旋转走 rotateSlot 拖拽', tv.attRotDragKind === 'rotateSlot', 'kind=' + tv.attRotDragKind);
        check('实时:附件·旋转拖拽中角度≈45°(不等松手)', near(tv.attRotDuring, 45, 2), 'before=' + tv.attRotBefore + ' during=' + tv.attRotDuring);
        check('实时:骨骼·旋转拖拽中角度≈45°(不等松手)', near(tv.rotDuring, 45, 2) && tv.rotDuringMatchesBone === true, 'before=' + tv.rotBefore + ' during=' + tv.rotDuring);
        check('实时:骨骼·移动走 move 拖拽(空白区起拖)', tv.moveDragKind === 'move', 'kind=' + tv.moveDragKind);
        check('移动:按下+1px 不瞬移(位移=鼠标增量而非瞬移到指针)', Array.isArray(tv.boneAfter1px) && Math.abs(tv.boneAfter1px[1] - tv.boneBeforeMove[1]) <= 1.5 && Math.abs(tv.boneAfter1px[0] - tv.boneBeforeMove[0]) <= 1.5, JSON.stringify(tv.boneBeforeMove) + ' -> ' + JSON.stringify(tv.boneAfter1px) + '(旧实现会瞬移到 [0,-59])');
        check('实时:骨骼·移动拖拽中 X≈50(不等松手)', near(tv.moveDuring, 50, 1.5), 'before=' + tv.moveBefore + ' during=' + tv.moveDuring);
        check('方向:骨骼·上拖 Y=-30(与鼠标一致)', near(tv.boneUpDuring, -30, 1.5), 'before=' + tv.boneUpBefore + ' during=' + tv.boneUpDuring);
        check('实时:骨骼·缩放拖拽中 scaleX≈2(不等松手)', near(tv.scaleDuring, 2, 0.05), 'before=' + tv.scaleBefore + ' during=' + tv.scaleDuring);
        check('实时:骨骼·倾斜拖拽中 shearX≈45(不等松手)', near(tv.shearDuring, 45, 2), 'before=' + tv.shearBefore + ' during=' + tv.shearDuring);
        check('保存:新建工程无关联路径', tv.savePathBefore == null, JSON.stringify(tv.savePathBefore));
        check('保存:首次保存默认 .skani 并关联路径', tv.saveFlow1 && tv.saveFlow1.pathSet === true && tv.saveFlow1.isSkani === true && tv.saveFlow1.dirty === false, JSON.stringify(tv.saveFlow1));
        check('保存:二次保存直写同一路径(不弹框)', tv.saveFlow2 && tv.saveFlow2.samePath === true && tv.saveFlow2.dirty === false, JSON.stringify(tv.saveFlow2));
        check('skani:容器往返(资产外置/明文内核/溯源)', !!(tv.skaniRoundtrip && tv.skaniRoundtrip.nameOk && tv.skaniRoundtrip.noDataUrlInDoc === true && tv.skaniRoundtrip.imgHydrated === true && tv.skaniRoundtrip.source === 'fresh'), JSON.stringify(tv.skaniRoundtrip));
        check('skani:openSkani 重开(模型/图片回填/路径关联)', !!(tv.skaniReopen && tv.skaniReopen.name === 'smoke-save-flow-2' && tv.skaniReopen.boneCount >= 1 && String(tv.skaniReopen.imgDataUrl).startsWith('data:image') && tv.skaniReopen.savePath === true), JSON.stringify(tv.skaniReopen));

        console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
      }
    } catch (err) {
      console.error('SMOKE-ERR', err && err.stack ? err.stack : err);
      failures++;
    }
    // 兜底强退:本环境下 app.exit 后事件循环冻结(疑似退出期与挂起 IPC 交互的 Electron 缺陷),
    // 进程内定时器无法触发 —— 派生分离的看门狗(electron 以 node 模式运行)3 秒后强杀本进程
    const code = failures === 0 ? 0 : 1;
    try { win.destroy(); } catch (e) { /* ignore */ }
    try {
      const { spawn } = require('child_process');
      const killer = spawn(process.execPath, ['-e', `setTimeout(()=>{try{process.kill(${process.pid})}catch(e){}}, 3000)`], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      killer.unref();
    } catch (e) { /* ignore */ }
    app.exit(code);
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
