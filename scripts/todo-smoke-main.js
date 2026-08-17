'use strict';
/** Todo-List 模块冒烟: 注入项目/任务 → 工具箱进入 → 卡片/筛选/状态循环/新建/看板/详情/归档 → 持久化验证 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('../electron/db.js');

app.setName('todo-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const PROJ_ID = 'p_smoke_' + Date.now();
const TASK_A = 't_smoke_a';
const TASK_B = 't_smoke_b';
const SMOKE_TITLE = '冒烟测试任务';
const SMOKE_EVENT_TITLE = '测试生日';
const SMOKE_BDAY_SOLAR = '测试公历生日';
const SMOKE_BDAY_LUNAR = '测试农历生日';
const IMPORT_JSON = path.join(os.tmpdir(), 'todo-import-test.json');
const nowTs = () => Date.now();

function setup() {
  // 生成导入测试文件(taskwingo 导出格式:projects + tasks + 子任务 + ISO 截止日期)
  const importData = {
    exported_at: new Date().toISOString(),
    projects: [{ id: 10, name: '导入项目', color: '#ec4899' }],
    tasks: [
      { id: 100, title: '导入任务A', notes: '导入备注', priority: 'urgent', status: 'todo', deadline: '2026-09-01T00:00:00.000Z', tags: ['导入标签'], project_id: 10, subtasks: [{ id: 1000, title: '导入子步骤', done: false }] },
      { id: 101, title: '导入任务B', notes: '', priority: 'low', status: 'done', deadline: null, tags: [], project_id: null, subtasks: [] },
    ],
  };
  try { fs.writeFileSync(IMPORT_JSON, JSON.stringify(importData), 'utf-8'); } catch (e) { /* ignore */ }
  const d = dbm.readDb();
  d.todoProjects = (d.todoProjects || []).filter((p) => !String(p.id || '').startsWith('p_smoke_') && p.name !== '导入项目');
  d.todoTasks = (d.todoTasks || []).filter((t) => !String(t.id || '').startsWith('t_smoke_') && t.title !== SMOKE_TITLE && !String(t.title || '').startsWith('导入任务'));
  d.todoEvents = (d.todoEvents || []).filter((e) => e.title !== SMOKE_EVENT_TITLE && e.title !== SMOKE_BDAY_SOLAR && e.title !== SMOKE_BDAY_LUNAR);
  // 注入生日事件:公历生日=今天(今日提醒);农历生日=七月初七(2026 七夕 8/19 → 3 日内提醒)
  const td = new Date();
  const todayStr = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`;
  d.todoEvents.push(
    { id: 'e_smoke_solar', date: todayStr, type: 'birthday', calendar: 'solar', title: SMOKE_BDAY_SOLAR, note: '', createdAt: nowTs(), updatedAt: nowTs() },
    { id: 'e_smoke_lunar', date: '2000-07-07', type: 'birthday', calendar: 'lunar', title: SMOKE_BDAY_LUNAR, note: '', createdAt: nowTs(), updatedAt: nowTs() },
  );
  d.todoProjects.push({
    id: PROJ_ID, name: '游戏开发', color: '#8b5cf6', sort: 0, createdAt: nowTs(), updatedAt: nowTs(),
  });
  const t0 = new Date(); const today = Math.floor(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime() / 1000);
  d.todoTasks.push({
    id: TASK_A, title: '完成 Spine 转换工具', notes: '支持 skel↔json 双向', notesHtml: '',
    priority: 'high', status: 'todo', deadline: today, reminderAt: null, sort: 0,
    tags: ['工具'], projectId: PROJ_ID, recurRule: '', archived: false,
    subtasks: [
      { id: 's_smoke_1', taskId: TASK_A, title: '写文档', done: true, sort: 0, createdAt: nowTs() },
      { id: 's_smoke_2', taskId: TASK_A, title: '跑测试', done: false, sort: 1, createdAt: nowTs() },
    ],
    createdAt: nowTs(), updatedAt: nowTs(),
  });
  d.todoTasks.push({
    id: TASK_B, title: '整理文档', notes: '', notesHtml: '',
    priority: 'low', status: 'done', deadline: null, reminderAt: null, sort: 1,
    tags: ['杂项'], projectId: '', recurRule: '', archived: false,
    subtasks: [], createdAt: nowTs(), updatedAt: nowTs(),
  });
  d.settings = d.settings || {};
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.todoProjects = (d.todoProjects || []).filter((p) => !String(p.id || '').startsWith('p_smoke_') && p.name !== '导入项目');
  d.todoTasks = (d.todoTasks || []).filter((t) => !String(t.id || '').startsWith('t_smoke_') && t.title !== SMOKE_TITLE && !String(t.title || '').startsWith('导入任务'));
  d.todoEvents = (d.todoEvents || []).filter((e) => e.title !== SMOKE_EVENT_TITLE && e.title !== SMOKE_BDAY_SOLAR && e.title !== SMOKE_BDAY_LUNAR);
  dbm.writeDb(d);
  try { fs.rmSync(IMPORT_JSON, { force: true }); } catch (e) { /* ignore */ }
}

ipcMain.handle('db:read', () => dbm.readDb());
ipcMain.handle('db:write', (_e, data) => { dbm.writeDb(data); return { ok: true }; });
ipcMain.handle('db:stats', () => ({}));
ipcMain.handle('app:info', () => ({}));
ipcMain.handle('fs:pickFiles', async () => ({ canceled: false, filePaths: [IMPORT_JSON] }));
ipcMain.handle('fs:readText', (_e, p) => {
  try { return { ok: true, text: fs.readFileSync(p, 'utf-8') }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fs:saveText', async () => ({ canceled: true }));
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

let results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra: extra || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' | ' + extra : ''}`);
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
    const js = (name, code) => win.webContents.executeJavaScript(
      `(async () => { try { return await (${code}); } catch (e) { return { __err: String(e && e.message || e) }; } })()`
    );
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      // 1) 进入 Todo 工具
      let o = await js('enter', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const toolRoot = document.querySelector('.cat-node[data-id="__tools__"]');
        if (toolRoot) { const a = toolRoot.querySelector('.cat-arrow'); if (a) a.click(); await sleep(300); }
        const todoNode = [...document.querySelectorAll('.cat-node')].find((n) => (n.textContent || '').includes('Todo-List'));
        const found = !!todoNode;
        if (todoNode) { todoNode.click(); await sleep(700); }
        return { found, pageShown: !!document.querySelector('.todo-root'), cardCount: document.querySelectorAll('.todo-card').length,
          cardIds: [...document.querySelectorAll('.todo-card')].map((c) => c.dataset.taskId),
          subText: (document.querySelector('.todo-sub') || {}).textContent || '' };
      })()`);
      if (o && o.__err) { check('进入工具', false, o.__err); throw new Error('abort'); }
      check('侧栏 Todo-List 节点', o.found === true);
      check('页面渲染 .todo-root', o.pageShown === true);
      check('任务卡片数量=2', o.cardCount === 2, 'count=' + o.cardCount + ' ids=' + JSON.stringify(o.cardIds));
      check('完成统计 1/2', /已完成 1\/2/.test(o.subText || ''), o.subText);

      // 1.5) 中英文切换
      o = await js('lang', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const subZh = (document.querySelector('.todo-sub') || {}).textContent || '';
        const langBtn = document.querySelector('[data-action="lang"]');
        const btnText0 = langBtn ? langBtn.textContent : '';
        if (langBtn) { langBtn.click(); await sleep(300); }
        const subEn = (document.querySelector('.todo-sub') || {}).textContent || '';
        const newBtnEn = !![...document.querySelectorAll('.todo-header-right .btn')].find((b) => (b.textContent || '').includes('New Task'));
        const langBtn2 = document.querySelector('[data-action="lang"]');
        const btnText1 = langBtn2 ? langBtn2.textContent : '';
        if (langBtn2) { langBtn2.click(); await sleep(300); }
        const subBack = (document.querySelector('.todo-sub') || {}).textContent || '';
        return { subZh, subEn, subBack, btnText0, btnText1, newBtnEn };
      })()`);
      check('语言切换:默认中文', /已完成 1\/2/.test(o.subZh || ''), o.subZh);
      check('语言切换:切英文', /Completed 1\/2/.test(o.subEn || ''), o.subEn + ' btn=' + o.btnText1);
      check('语言切换:英文按钮文案', o.newBtnEn === true && o.btnText0 === 'EN', o.btnText0 + '→' + o.btnText1);
      check('语言切换:切回中文', /已完成 1\/2/.test(o.subBack || ''), o.subBack);

      // 1.6) 头部事件提醒(今日待办 / 今日生日 / 3 日内生日)
      o = await js('remind', `(() => {
        const el = document.querySelector('.todo-reminder');
        return { found: !!el, text: el ? el.textContent : '', title: el ? el.title : '' };
      })()`);
      check('提醒文字(今日待办+生日)', o.found === true && (o.text || '').includes('今日待办 1 项') && (o.text || '').includes('今日 1 人生日') && (o.text || '').includes('3 日内 1 人生日'), o.text);
      check('提醒悬停详情(公历+农历)', (o.title || '').includes('测试公历生日') && (o.title || '').includes('测试农历生日') && (o.title || '').includes('农历'), (o.title || '').split('\n').join(' | '));

      // 2) 卡片内容
      o = await js('card', `(() => {
        const projChip = !![...document.querySelectorAll('.todo-card-proj span')].find((s) => (s.textContent || '').includes('游戏开发'));
        const subChips = document.querySelectorAll('.todo-card .todo-sub-chip').length;
        const projFilter = !![...document.querySelectorAll('.todo-select')].find((s) => [...s.options].some((x) => x.textContent === '游戏开发'));
        const cardA = document.querySelector('.todo-card[data-task-id="t_smoke_a"]');
        return { projChip, subChips, projFilter, cardAhtml: cardA ? cardA.innerHTML.slice(0, 700) : 'NO CARD' };
      })()`);
      check('项目徽章', o.projChip === true);
      check('子任务 chips', o.subChips >= 2, 'chips=' + o.subChips);
      check('项目筛选下拉', o.projFilter === true);
      if (!o.projChip) console.log('  [debug] cardA html:', o.cardAhtml);

      // 3) 状态循环 + 优先级循环
      o = await js('cycle', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const st0 = document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-status-btn');
        const i0 = st0 ? st0.textContent : '';
        if (st0) { st0.click(); await sleep(250); }
        const st1 = document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-status-btn');
        const i1 = st1 ? st1.textContent : '';
        const p0 = (document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-pri-btn') || {}).textContent || '';
        const priBtn = document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-pri-btn');
        if (priBtn) { priBtn.click(); await sleep(250); }
        const p1 = (document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-pri-btn') || {}).textContent || '';
        return { i0, i1, p0: p0.trim(), p1: p1.trim() };
      })()`);
      check('状态循环 todo→in_progress', o.i0 === '○' && o.i1 === '◑', o.i0 + '→' + o.i1);
      check('优先级循环 high→medium', o.p0 === '高' && o.p1 === '中', o.p0 + '→' + o.p1);

      // 4) 新建任务
      o = await js('newtask', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const btn = document.querySelector('[data-action="new"]');
        if (!btn) return { err: 'new btn missing' };
        btn.click(); await sleep(250);
        const input = document.querySelector('.todo-modal [data-d="title"]');
        const modalOpen = !!input;
        if (input) {
          input.value = '冒烟测试任务';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.todo-modal [data-save]').click(); await sleep(400);
        }
        return { modalOpen, cardCount: document.querySelectorAll('.todo-card').length,
          newVisible: !![...document.querySelectorAll('.todo-card-title')].find((t) => (t.textContent || '').includes('冒烟测试任务')) };
      })()`);
      check('新建任务模态框', o.modalOpen === true, o.err || '');
      check('新建后卡片=3', o.cardCount === 3, 'count=' + o.cardCount);
      check('新任务可见', o.newVisible === true);

      // 5) 看板视图
      o = await js('kanban', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="kanban"]').click(); await sleep(300);
        return { cols: document.querySelectorAll('.todo-kanban-col').length,
          counts: [...document.querySelectorAll('.todo-kanban-count')].map((c) => c.textContent) };
      })()`);
      check('看板 3 列', o.cols === 3, 'cols=' + o.cols);
      check('看板计数', Array.isArray(o.counts) && o.counts.length === 3, JSON.stringify(o.counts));

      // 5.5) 日历视图
      o = await js('calendar', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        const grid = !!document.querySelector('.todo-cal-grid');
        const cells = document.querySelectorAll('.todo-cal-cell').length;
        const tasks = [...document.querySelectorAll('.todo-cal-task')].map((c) => c.textContent);
        const monthTitle = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        // 农历/节日断言:今天格子有农历文本;当月有节气或节日文本
        const todayLunar = (document.querySelector('.todo-cal-cell.today .todo-cal-lunar') || {}).textContent || '';
        const festTexts = [...document.querySelectorAll('.todo-cal-fest')].map((e) => e.textContent);
        // 点击今天格子里的任务A chip → 打开详情
        const chipA = [...document.querySelectorAll('.todo-cal-task')].find((c) => (c.textContent || '').includes('完成 Spine 转换工具'));
        if (chipA) { chipA.click(); await sleep(300); }
        const detailTitle = (document.querySelector('.todo-detail-title') || {}).textContent || '';
        const closeBtn = document.querySelector('[data-act="close"]');
        if (closeBtn) { closeBtn.click(); await sleep(250); }
        const closed = !document.querySelector('.todo-detail-title');
        // 下个月导航
        const nextBtn = document.querySelector('[data-cal="next"]');
        if (nextBtn) { nextBtn.click(); await sleep(250); }
        const monthAfter = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        // 切回列表
        document.querySelector('[data-view="list"]').click(); await sleep(300);
        return { grid, cells, tasks, monthTitle, todayLunar, festTexts, detailTitle, closed, monthAfter, backList: !!document.querySelector('.todo-list-wrap') };
      })()`);
      check('日历网格渲染', o.grid === true);
      check('日历单元格数量', o.cells >= 35, 'cells=' + o.cells);
      check('日历任务 chip(今天)', (o.tasks || []).includes('完成 Spine 转换工具'), JSON.stringify(o.tasks));
      check('日历月份标题', /2026/.test(o.monthTitle || '') && /8/.test(o.monthTitle || ''), o.monthTitle);
      check('今天格子有农历', (o.todayLunar || '').length > 0 && /[月初十廿卅]|三十/.test(o.todayLunar || ''), o.todayLunar);
      check('日历 chip 打开详情', (o.detailTitle || '').includes('完成 Spine 转换工具'), o.detailTitle);
      check('详情可关闭', o.closed === true);
      check('日历下月导航', o.monthAfter !== o.monthTitle, o.monthTitle + '→' + o.monthAfter);
      check('切回列表视图', o.backList === true);

      // 5.6) 日历事件:右键单元格新建 → 事件 chip → 点击编辑 → 关闭
      o = await js('event', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        // 取当前月第一个非 out 格子(5.5 已导航到下月,今天不在网格内)
        const targetCell = [...document.querySelectorAll('.todo-cal-cell')].find((c) => !c.classList.contains('out'));
        if (!targetCell) return { err: 'no in-month cell' };
        targetCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 }));
        await sleep(200);
        const menuTexts = [...document.querySelectorAll('.ctx-item')].map((b) => b.textContent);
        out.menuCount = document.querySelectorAll('.ctx-menu').length;
        out.ctxItems = [...document.querySelectorAll('.ctx-item')].map((b) => b.textContent);
        out.menuTexts = menuTexts;
        const addItem = [...document.querySelectorAll('.ctx-item')].find((b) => (b.textContent || '').includes('新建事件'));
        out.menuFound = !!addItem;
        if (!addItem) return out;
        addItem.click(); await sleep(300);
        out.modalOpen = !!document.querySelector('[data-ev-title]');
        if (out.modalOpen) {
          // 类型高亮检查:默认待办事件高亮
          out.todoOn0 = document.querySelector('[data-ev-type="todo"]').classList.contains('on');
          // 切到生日:待办按钮高亮必须消失(class + 内联边框都清除)
          document.querySelector('[data-ev-type="birthday"]').click(); await sleep(120);
          out.birthdayOn = document.querySelector('[data-ev-type="birthday"]').classList.contains('on');
          out.todoOn1 = document.querySelector('[data-ev-type="todo"]').classList.contains('on');
          out.todoBorder = document.querySelector('[data-ev-type="todo"]').style.borderColor || '';
          // 历法行出现,切到农历:农历按钮高亮、公历取消(验证可切换后切回公历保存,chip 落在当前 9 月视图)
          out.calRowVisible = !document.querySelector('[data-ev-cal-row]').hidden;
          document.querySelector('[data-ev-cal="lunar"]').click(); await sleep(120);
          out.lunarOn = document.querySelector('[data-ev-cal="lunar"]').classList.contains('on');
          out.solarOn = document.querySelector('[data-ev-cal="solar"]').classList.contains('on');
          document.querySelector('[data-ev-cal="solar"]').click(); await sleep(120);
          const titleInp = document.querySelector('[data-ev-title]');
          titleInp.value = '测试生日';
          titleInp.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('[data-ev-save]').click(); await sleep(400);
        }
        out.eventChips = [...document.querySelectorAll('.todo-cal-event')].map((c) => c.textContent);
        out.chipFound = (out.eventChips || []).some((t) => t.includes('测试生日'));
        const chip = [...document.querySelectorAll('.todo-cal-event')].find((c) => (c.textContent || '').includes('测试生日'));
        if (chip) { chip.click(); await sleep(300); }
        out.editOpen = !!document.querySelector('[data-ev-title]');
        out.editTitle = (document.querySelector('[data-ev-title]') || {}).value || '';
        const closeBtn2 = document.querySelector('[data-close]');
        if (closeBtn2) { closeBtn2.click(); await sleep(250); }
        out.closed = !document.querySelector('[data-ev-title]');
        // 切回列表
        document.querySelector('[data-view="list"]').click(); await sleep(250);
        return out;
      })()`);
      check('单元格右键菜单', o.menuFound === true, JSON.stringify(o));
      check('新建事件弹窗', o.modalOpen === true);
      check('默认待办事件高亮', o.todoOn0 === true);
      check('切生日后待办不再高亮', o.birthdayOn === true && o.todoOn1 === false && !o.todoBorder, 'birthday=' + o.birthdayOn + ' todoOn=' + o.todoOn1 + ' border=' + o.todoBorder);
      check('历法行出现且可切农历', o.calRowVisible === true && o.lunarOn === true && o.solarOn === false, 'lunar=' + o.lunarOn + ' solar=' + o.solarOn);
      check('事件 chip 出现', o.chipFound === true, JSON.stringify(o.eventChips));
      check('点击事件打开编辑', o.editOpen === true && o.editTitle === '测试生日', o.editTitle);
      check('事件弹窗关闭', o.closed === true);

      // 6) 详情面板
      o = await js('detail', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="kanban"]').click(); await sleep(300);
        const card = [...document.querySelectorAll('.todo-kanban-body .todo-card')].find((c) => (c.textContent || '').includes('完成 Spine 转换工具'));
        if (card) { card.click(); await sleep(300); }
        const title = (document.querySelector('.todo-detail-title') || {}).textContent || '';
        const shown = !!document.querySelector('.todo-detail-title');
        const closeBtn = document.querySelector('[data-act="close"]');
        if (closeBtn) { closeBtn.click(); await sleep(250); }
        return { shown, title, closed: !document.querySelector('.todo-detail-title') };
      })()`);
      check('详情面板打开', o.shown === true);
      check('详情标题', (o.title || '').includes('完成 Spine 转换工具'), o.title);
      check('详情面板关闭', o.closed === true);

      // 7) 列表视图 + 归档
      o = await js('archive', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="list"]').click(); await sleep(300);
        const aCard = [...document.querySelectorAll('.todo-card')].find((c) => c.dataset.taskId === '${TASK_A}');
        let menuFound = false;
        if (aCard) {
          const menuBtn = aCard.querySelector('[data-t="menu"]');
          if (menuBtn) { menuBtn.click(); await sleep(150); }
          const archBtn = document.querySelector('.todo-card-menu [data-m="archive"]');
          menuFound = !!archBtn;
          if (archBtn) { archBtn.click(); await sleep(300); }
        }
        const countAfter = document.querySelectorAll('.todo-card').length;
        document.querySelector('[data-action="archive"]').click(); await sleep(300);
        const rows = document.querySelectorAll('.todo-archive-row').length;
        const restoreBtn = document.querySelector('[data-restore]');
        const restoreFound = !!restoreBtn;
        if (restoreBtn) { restoreBtn.click(); await sleep(300); }
        const rowsAfter = document.querySelectorAll('.todo-archive-row').length;
        const headBtns = [...document.querySelectorAll('.todo-modal-head .todo-icon-btn')];
        if (headBtns.length) headBtns[headBtns.length - 1].click();
        await sleep(250);
        return { menuFound, countAfter, rows, restoreFound, rowsAfter, closed: !document.querySelector('.todo-archive-row') };
      })()`);
      check('卡片菜单归档项', o.menuFound === true);
      check('归档后卡片=2', o.countAfter === 2, 'count=' + o.countAfter);
      check('归档弹窗 1 条', o.rows === 1, 'rows=' + o.rows);
      check('恢复按钮', o.restoreFound === true);
      check('恢复后归档=0', o.rowsAfter === 0, 'rows=' + o.rowsAfter);
      check('归档弹窗可关闭', o.closed === true);

      // 7.5) 导入 JSON(taskwingo 导出格式)
      o = await js('import', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const before = document.querySelectorAll('.todo-card').length;
        const btn = document.querySelector('[data-action="import"]');
        if (!btn) return { err: 'import btn missing', before };
        btn.click(); await sleep(600);
        const after = document.querySelectorAll('.todo-card').length;
        const projSel = !![...document.querySelectorAll('.todo-select')].find((s) => [...s.options].some((x) => x.textContent === '导入项目'));
        const titles = [...document.querySelectorAll('.todo-card-title')].map((t) => t.textContent);
        return { before, after, projSel, titles };
      })()`);
      check('导入按钮存在', !o.err, o.err || '');
      check('导入后卡片+2', o.after === o.before + 2, o.before + '→' + o.after);
      check('导入任务可见', (o.titles || []).includes('导入任务A') && (o.titles || []).includes('导入任务B'), JSON.stringify((o.titles || []).filter((t) => String(t).startsWith('导入'))));
      check('导入项目下拉', o.projSel === true);

      // 8) 持久化验证
      await sleep(500);
      const d = dbm.readDb();
      const a = d.todoTasks.find((t) => t.id === TASK_A);
      check('持久化:状态 in_progress', a && a.status === 'in_progress', a ? a.status : 'null');
      check('持久化:优先级 medium', a && a.priority === 'medium', a ? a.priority : 'null');
      check('持久化:归档恢复', a && a.archived === false, String(a && a.archived));
      check('持久化:子任务保留', a && a.subtasks && a.subtasks.length === 2, String(a && a.subtasks && a.subtasks.length));
      check('持久化:项目保留', d.todoProjects.some((p) => p.id === PROJ_ID) === true);
      check('持久化:新任务落库', d.todoTasks.some((t) => t.title === '冒烟测试任务') === true);
      check('持久化:导入任务落库', d.todoTasks.some((t) => t.title === '导入任务A') === true && d.todoTasks.some((t) => t.title === '导入任务B') === true);
      const impProj = d.todoProjects.find((p) => p.name === '导入项目');
      const impTask = d.todoTasks.find((t) => t.title === '导入任务A');
      check('持久化:导入项目+子任务+截止日期', !!impProj && impTask && impTask.projectId === impProj.id && impTask.subtasks.length === 1 && impTask.deadline != null, JSON.stringify({ proj: !!impProj, projId: impProj && impProj.id, taskProjId: impTask && impTask.projectId, subs: impTask && impTask.subtasks.length, deadline: impTask && impTask.deadline }));
      const ev = d.todoEvents.find((e) => e.title === '测试生日');
      check('持久化:日历事件落库(公历)', !!ev && ev.type === 'birthday' && ev.calendar === 'solar' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || ''), JSON.stringify(ev));
    } catch (err) {
      check('执行异常', false, err && err.message ? err.message : String(err));
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n==== Todo 冒烟结束: ${results.length - failed}/${results.length} 通过 ====`);
    cleanup();
    win.destroy();
    app.exit(failed ? 1 : 0);
  });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
});
