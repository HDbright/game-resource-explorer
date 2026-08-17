'use strict';
/** 得乐学苑模块冒烟: 进入工具 → 今日任务/逾期顺延/开始闯关/星级奖励/成长奖励/学习计划/兑换道具/家长模式/导出 → 持久化验证 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbm = require('../electron/db.js');

app.setName('kid-wb-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// 隔离 localStorage:用独立 userData 目录,避免污染真实数据
app.setPath('userData', path.join(require('os').tmpdir(), 'kid-wb-smoke-' + Date.now()));

// db:read 返回真实库完整结构供应用初始化;db:write 丢弃,避免测试改动污染真实库
ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', () => ({ ok: true }));
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('debug:getEnv', () => ({}));
ipcMain.handle('cdp:getState', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: true }));
ipcMain.handle('fs:readText', async () => ({ ok: false, error: 'mock' }));
ipcMain.handle('fs:saveText', async () => ({ canceled: true }));
ipcMain.handle('fs:stat', () => null);
ipcMain.handle('fs:readBase64', async () => ({ ok: false }));
ipcMain.handle('fs:writeFileBase64', async () => ({ ok: false }));

let results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra: extra || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  win.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) console.log('  [renderer] ' + msg);
  });
  win.webContents.on('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1800));
    const js = (code) => win.webContents.executeJavaScript(`(async () => { try { return await (${code}); } catch (e) { return { __err: String(e && e.message || e) }; } })()`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      // 1) 进入得乐学苑工具
      let o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const toolRoot = document.querySelector('.cat-node[data-id="__tools__"]');
        if (toolRoot) { const a = toolRoot.querySelector('.cat-arrow'); if (a) a.click(); await sleep(300); }
        const node = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('得乐学苑'));
        const found = !!node;
        if (node) { node.click(); await sleep(900); }
        return { found, wb: !!document.querySelector('.kid-wb'),
          taskCards: document.querySelectorAll('.kid-task').length,
          todayItems: document.querySelectorAll('.kid-today-item').length,
          overdue: document.querySelectorAll('.kid-today-item.overdue').length,
          title: (document.querySelector('.kid-title') || {}).textContent || '',
          coins0: (document.querySelector('.kid-wallet-card .k-w-num') || { textContent: 'n/a' }).textContent };
      })()`);
      if (o && o.__err) { check('进入工具', false, o.__err); throw new Error('abort'); }
      check('侧栏找到闯关台节点', o.found === true);
      check('页面渲染 .kid-wb', o.wb === true);
      check('今日任务卡片(示例逾期+计划)≥4', o.taskCards >= 4, 'cards=' + o.taskCards);
      check('今天要处理列表', o.todayItems >= 4, 'items=' + o.todayItems);
      check('逾期任务标红(≥1)', o.overdue >= 1, 'overdue=' + o.overdue);
      check('标题含得乐学苑', (o.title || '').includes('得乐学苑'), o.title);

      // 2) 开始闯关 + 星级奖励
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const startBtn = document.querySelector('.kid-task:not(.done) [data-act="start"]');
        if (!startBtn) return { err: 'start btn missing' };
        startBtn.click(); await sleep(300);
        const started = !!document.querySelector('.kid-task.started');
        const finishBtn = document.querySelector('.kid-task.started [data-act="finish"]');
        if (!finishBtn) return { started, err2: 'finish btn missing' };
        finishBtn.click(); await sleep(300);
        const starModal = !!document.querySelector('.kid-star-btn');
        const confirmBtn = document.querySelector('[data-confirm]');
        if (confirmBtn) { confirmBtn.click(); await sleep(500); }
        const doneCards = document.querySelectorAll('.kid-task.done').length;
        const doneText = (document.querySelector('.kid-task.done') || {}).textContent || '';
        return { started, starModal, doneCards, hasCoin: doneText.includes('金币'), hasExp: doneText.includes('经验') };
      })()`);
      check('开始闯关 → started', o.started === true, o.err || '');
      check('星级验收弹窗', o.starModal === true, o.err2 || '');
      check('确认后任务完成', o.doneCards >= 1, 'done=' + o.doneCards);
      check('完成卡片显示金币+经验奖励', o.hasCoin === true && o.hasExp === true);

      // 3) 成长奖励 Tab
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        [...document.querySelectorAll('.kid-tab')].find((t) => (t.textContent || '').includes('成长奖励')).click(); await sleep(400);
        return { wallet: document.querySelectorAll('.kid-wallet-card').length,
          hero: !!document.querySelector('.kid-hero-box svg'),
          avatars: document.querySelectorAll('.kid-avatar-item').length,
          shop: document.querySelectorAll('.kid-shop-item').length,
          medals: document.querySelectorAll('.kid-medal').length,
          lvTitle: (document.querySelector('.kid-lv-title') || {}).textContent || '' };
      })()`);
      check('钱包 4 项', o.wallet === 4, 'wallet=' + o.wallet);
      check('数字人 SVG 渲染', o.hero === true);
      check('头像 8 个', o.avatars === 8, 'avatars=' + o.avatars);
      check('商城道具(默认4)', o.shop >= 4, 'shop=' + o.shop);
      check('奖章墙 11 枚', o.medals === 11, 'medals=' + o.medals);
      check('等级称号显示', /Lv\.\d/.test(o.lvTitle || ''), o.lvTitle);

      // 4) 兑换道具(金币 90,兑换 80 的道具)
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const claimBtn = document.querySelector('[data-claim]');
        const coinsBefore = (document.querySelector('.kid-wallet-card .k-w-num') || {}).textContent || '0';
        if (!claimBtn) return { err: 'claim btn missing', coinsBefore };
        claimBtn.click(); await sleep(300);
        const okBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '确认兑换');
        if (!okBtn) return { err2: 'confirm btn missing', coinsBefore };
        okBtn.click(); await sleep(400);
        const coinsAfter = (document.querySelector('.kid-wallet-card .k-w-num') || {}).textContent || '0';
        return { coinsBefore, coinsAfter };
      })()`);
      check('兑换确认弹窗', !o.err && !o.err2, o.err || o.err2 || '');
      check('兑换后金币减少', Number(o.coinsAfter) < Number(o.coinsBefore), o.coinsBefore + '→' + o.coinsAfter);

      // 5) 学习计划 Tab
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        [...document.querySelectorAll('.kid-tab')].find((t) => (t.textContent || '').includes('学习计划')).click(); await sleep(400);
        return { days: document.querySelectorAll('.kid-plan-day').length,
          items: document.querySelectorAll('.kid-plan-item').length,
          toggle: !!document.querySelector('[data-plan="toggle"]'),
          todayMarked: !!document.querySelector('.kid-plan-day.today') };
      })()`);
      check('计划 7 天', o.days === 7, 'days=' + o.days);
      check('计划任务条目>0', o.items >= 20, 'items=' + o.items);
      check('计划开关存在', o.toggle === true);
      check('今天高亮标记', o.todayMarked === true);

      // 6) 家长模式:设置 4 位密码 → 开启
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const pBtn = document.querySelector('[data-act="parent"]');
        if (!pBtn) return { err: 'parent btn missing' };
        pBtn.click(); await sleep(300);
        const pwdModal = !!document.querySelector('.kid-pwd-key');
        if (pwdModal) {
          for (const k of ['1', '2', '3', '4']) {
            const key = [...document.querySelectorAll('.kid-pwd-key')].find((b) => (b.textContent || '').trim() === k);
            if (key) { key.click(); await sleep(80); }
          }
          await sleep(400);
        }
        const on = (document.querySelector('[data-act="parent"]') || {}).textContent || '';
        return { pwdModal, on };
      })()`);
      check('家长密码弹窗', o.pwdModal === true, o.err || '');
      check('设置后家长模式开启', (o.on || '').includes('家长'), o.on);

      // 7) 撤销任务(家长模式)
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        [...document.querySelectorAll('.kid-tab')].find((t) => (t.textContent || '').includes('今日闯关')).click(); await sleep(400);
        const undoBtn = document.querySelector('[data-act="undo"]');
        const hasUndo = !!undoBtn;
        if (undoBtn) { undoBtn.click(); await sleep(300); }
        const okBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '确认撤销');
        if (okBtn) { okBtn.click(); await sleep(400); }
        return { hasUndo, undone: document.querySelectorAll('.kid-task.done').length === 0 };
      })()`);
      check('家长模式显示撤销按钮', o.hasUndo === true);
      check('撤销后回到未完成', o.undone === true);

      // 7.5) 主题模式切换(深色 / 糖果乐园 / 星际探险 / 跟随项目)
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-act="settings"]').click(); await sleep(300);
        const themeSel = document.querySelector('[data-set="theme"]');
        if (!themeSel) return { err: 'theme select missing' };
        const setTheme = async (v) => { themeSel.value = v; themeSel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(350); };
        await setTheme('dark');
        const darkOn = !!document.querySelector('.kid-wb.theme-dark');
        await setTheme('candy');
        const candyOn = !!document.querySelector('.kid-wb.theme-candy');
        await setTheme('space');
        const spaceOn = !!document.querySelector('.kid-wb.theme-space');
        const spaceBg = (getComputedStyle(document.querySelector('.kid-wb')).backgroundImage || '').indexOf('radial-gradient') >= 0;
        await setTheme('project');
        const projOn = !!document.querySelector('.kid-wb.theme-project');
        const lvPill = !!document.querySelector('.kid-lv-pill');
        const progressRing = !!document.querySelector('.kid-progress svg');
        const closeBtn = document.querySelector('.kid-drawer [data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(200); }
        const drawerClosed = !document.querySelector('.kid-drawer');
        return { darkOn, candyOn, spaceOn, spaceBg, projOn, lvPill, progressRing, drawerClosed };
      })()`);
      check('主题切换:深色模式 class', o.darkOn === true, o.err || '');
      check('主题切换:糖果乐园 class', o.candyOn === true);
      check('主题切换:星际探险 class', o.spaceOn === true);
      check('星际探险:星空背景', o.spaceBg === true);
      check('主题切换:跟随项目 class', o.projOn === true);
      check('顶栏等级徽章胶囊', o.lvPill === true);
      check('今日完成率进度环', o.progressRing === true);
      check('主题切换:抽屉可关闭', o.drawerClosed === true);

      // 8) 导出按钮存在 + localStorage 持久化
      o = await js(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const exportBtn = [...document.querySelectorAll('[data-act]')].find((b) => (b.textContent || '').includes('导出'));
        const ls = localStorage.getItem('wb_kid_state_v1');
        const hasExport = !!exportBtn;
        return { hasExport, ls: !!ls, parsed: (() => { try { const d = JSON.parse(ls); return { v: d.v, tasks: (d.tasks || []).length, coins: d.coins, parentMode: d.parentMode }; } catch (e) { return { err: e.message }; } })() };
      })()`);
      check('导出按钮存在', o.hasExport === true);
      check('localStorage 已持久化', o.ls === true);
      check('持久化数据完整', o.parsed && o.parsed.v === 1 && o.parsed.tasks >= 4 && o.parsed.parentMode === true, JSON.stringify(o.parsed));
    } catch (err) {
      check('执行异常', false, err && err.message ? err.message : String(err));
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n==== 得乐学苑冒烟结束: ${results.length - failed}/${results.length} 通过 ====`);
    win.destroy();
    app.exit(failed ? 1 : 0);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
