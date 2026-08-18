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
const SMOKE_BDAY_LUNAR_CONV = '测试农历生日转换';
const SMOKE_DAYEV_TITLE = '测试当日事件';
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
  d.todoEvents = (d.todoEvents || []).filter((e) => e.title !== SMOKE_EVENT_TITLE && e.title !== SMOKE_BDAY_SOLAR && e.title !== SMOKE_BDAY_LUNAR && e.title !== SMOKE_BDAY_LUNAR_CONV && e.title !== SMOKE_DAYEV_TITLE);
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
  // 补丁·45 树测试:子项目(挂在"游戏开发"下)
  d.todoProjects.push({
    id: 'p_smoke_child', name: '子项目', color: '#f59e0b', sort: 1, parentId: PROJ_ID, createdAt: nowTs(), updatedAt: nowTs(),
  });
  const t0 = new Date(); const today = Math.floor(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime() / 1000);
  d.todoTasks.push({
    id: TASK_A, title: '完成 Spine 转换工具', notes: '支持 skel↔json 双向', notesHtml: '',
    priority: 'high', status: 'todo', deadline: today, startAt: nowTs() - 86400000, reminderAt: null, sort: 0,
    tags: ['工具'], projectId: 'p_smoke_child', recurRule: '', archived: false,
    subtasks: [
      { id: 's_smoke_1', taskId: TASK_A, title: '写文档', done: true, sort: 0, createdAt: nowTs() },
      { id: 's_smoke_2', taskId: TASK_A, title: '跑测试', done: false, sort: 1, createdAt: nowTs() },
    ],
    createdAt: nowTs(), updatedAt: nowTs(),
  });
  d.todoTasks.push({
    id: TASK_B, title: '整理文档', notes: '', notesHtml: '',
    priority: 'low', status: 'done', deadline: null, reminderAt: null, sort: 1,
    tags: ['杂项'], projectId: 'p_smoke_child', parentTaskId: TASK_A, recurRule: '', archived: false,
    subtasks: [], createdAt: nowTs(), updatedAt: nowTs(),
  });
  d.settings = d.settings || {};
  dbm.writeDb(d);
}
function cleanup() {
  const d = dbm.readDb();
  d.todoProjects = (d.todoProjects || []).filter((p) => !String(p.id || '').startsWith('p_smoke_') && p.name !== '导入项目');
  d.todoTasks = (d.todoTasks || []).filter((t) => !String(t.id || '').startsWith('t_smoke_') && t.title !== SMOKE_TITLE && !String(t.title || '').startsWith('导入任务'));
  d.todoEvents = (d.todoEvents || []).filter((e) => e.title !== SMOKE_EVENT_TITLE && e.title !== SMOKE_BDAY_SOLAR && e.title !== SMOKE_BDAY_LUNAR && e.title !== SMOKE_BDAY_LUNAR_CONV && e.title !== SMOKE_DAYEV_TITLE);
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
        // 补丁·45:TASK_A 挂在子项目\"子项目\"下,卡片徽章应显示\"子项目\"
        const projChip = !![...document.querySelectorAll('.todo-card-proj span')].find((s) => (s.textContent || '').includes('子项目'));
        const subChips = document.querySelectorAll('.todo-card .todo-sub-chip').length;
        // 父项目\"游戏开发\"与子项目\"子项目\"都应出现在筛选下拉
        const projFilter = !![...document.querySelectorAll('.todo-select')].find((s) => [...s.options].some((x) => x.textContent === '游戏开发' || x.textContent === '子项目'));
        const cardA = document.querySelector('.todo-card[data-task-id="t_smoke_a"]');
        const subIconDone = (document.querySelector('.todo-sub-chip.done span:first-child') || {}).textContent || '';
        const subIconTodo = (document.querySelector('.todo-sub-chip:not(.done) span:first-child') || {}).textContent || '';
        return { projChip, subChips, projFilter, subIconDone, subIconTodo, cardAhtml: cardA ? cardA.innerHTML.slice(0, 700) : 'NO CARD' };
      })()`);
      check('项目徽章', o.projChip === true);
      check('子任务 chips', o.subChips >= 2, 'chips=' + o.subChips);
      check('子任务图标:完成✅/未完成⬜', o.subIconDone === '✅' && o.subIconTodo === '⬜', o.subIconDone + ' / ' + o.subIconTodo);
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
      check('状态循环 todo→in_progress', o.i0 === '⬜' && o.i1 === '◑', o.i0 + '→' + o.i1);
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

      // 4.1) 编辑模态框含开始/完成时间 + 事件 tab(打开任一任务)
      o = await js('edittimefields', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const card = document.querySelector('.todo-card[data-task-id="${TASK_A}"]');
        if (!card) return { err: 'card missing' };
        const editBtn = card.querySelector('[data-t="edit"]');
        if (editBtn) { editBtn.click(); await sleep(300); }
        const hasStart = !!document.querySelector('.todo-modal [data-d="startAt"]');
        const hasComplete = !!document.querySelector('.todo-modal [data-d="completeAt"]');
        const hasEventsTab = !!document.querySelector('.todo-modal [data-tab="events"]');
        const closeBtn = document.querySelector('.todo-modal [data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(200); }
        return { hasStart, hasComplete, hasEventsTab };
      })()`);
      check('编辑框含开始时间', o.hasStart === true, o.err || '');
      check('编辑框含完成时间', o.hasComplete === true, o.err || '');
      check('编辑框含事件tab', o.hasEventsTab === true, o.err || '');

      // 5) 看板视图
      o = await js('kanban', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="kanban"]').click(); await sleep(300);
        const out = { cols: document.querySelectorAll('.todo-kanban-col').length,
          counts: [...document.querySelectorAll('.todo-kanban-count')].map((c) => c.textContent) };
        // 子任务折叠:点折叠头 → collapsed 隐藏 chips;再点展开
        const subToggle = document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-sub-toggle');
        out.subToggleFound = !!subToggle;
        if (subToggle) { subToggle.click(); await sleep(150); }
        out.subCollapsed = !!document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-card-subs.collapsed');
        if (subToggle) { subToggle.click(); await sleep(150); }
        out.subExpanded = !document.querySelector('.todo-card[data-task-id="${TASK_A}"] .todo-card-subs.collapsed');
        return out;
      })()`);
      check('看板 3 列', o.cols === 3, 'cols=' + o.cols);
      check('看板计数', Array.isArray(o.counts) && o.counts.length === 3, JSON.stringify(o.counts));
      check('看板子任务可折叠', o.subToggleFound === true && o.subCollapsed === true && o.subExpanded === true, 'toggle=' + o.subToggleFound + ' collapsed=' + o.subCollapsed + ' expanded=' + o.subExpanded);
      // 状态色日期:in_progress 卡片应显示橙色开始日期(.todo-card-date.is-progress)
      o = await js('statusDate', `(async () => {
        const card = document.querySelector('.todo-card[data-task-id="${TASK_A}"]');
        const el = card ? card.querySelector('.todo-card-date.is-progress') : null;
        const anyDate = card ? card.querySelector('.todo-card-date') : null;
        const stBtn = card ? card.querySelector('[data-t="status"]') : null;
        const colHead = card ? (card.closest('.todo-kanban-col') || {}).querySelector : null;
        const colTitle = card && card.closest('.todo-kanban-col')
          ? (card.closest('.todo-kanban-col').querySelector('.todo-kanban-title') || {}).textContent : '';
        return { found: !!el, text: el ? el.textContent : '',
          cardFound: !!card, anyDateCls: anyDate ? anyDate.className : '', anyDateText: anyDate ? anyDate.textContent : '',
          stTitle: stBtn ? stBtn.title : '', isDone: card ? card.classList.contains('done') : null, colTitle };
      })()`);
      check('进行中卡片显示橙色开始日期', o.found === true,
        'text=' + o.text + ' card=' + o.cardFound + ' col=' + o.colTitle + ' st=' + o.stTitle
        + ' done=' + o.isDone + ' anyDate=[' + o.anyDateCls + '|' + o.anyDateText + ']');

      // 5.2) 看板列内拖拽排序:同列相邻两卡片 dragstart→dragover(下半区)→drop 后应互换位置
      o = await js('kanbanDragSort', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        const bodies = [...document.querySelectorAll('.todo-kanban-body')];
        out.allDraggable = bodies.length > 0 && bodies.every((b) => [...b.querySelectorAll('.todo-card')].every((c) => c.draggable === true));
        let best = null;
        for (const b of bodies) {
          const cs = [...b.querySelectorAll('.todo-card')];
          if (!best || cs.length > best.cards.length) best = { body: b, cards: cs };
        }
        out.maxCards = best ? best.cards.length : 0;
        if (!best || best.cards.length < 2) { out.skipped = true; return out; }
        const colIdx = bodies.indexOf(best.body);
        const c1 = best.cards[0], c2 = best.cards[1];
        out.before = [c1.dataset.taskId, c2.dataset.taskId];
        const dt = new DataTransfer();
        c1.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        await sleep(60);
        const r = c2.getBoundingClientRect();
        const pt = { clientX: r.left + 10, clientY: r.top + r.height - 3 };
        c2.dispatchEvent(new DragEvent('dragover', Object.assign({ bubbles: true, dataTransfer: dt }, pt)));
        out.markAfter = c2.classList.contains('todo-card-drop-after');
        c2.dispatchEvent(new DragEvent('drop', Object.assign({ bubbles: true, dataTransfer: dt }, pt)));
        await sleep(350);
        const nb = [...document.querySelectorAll('.todo-kanban-body')][colIdx];
        out.after = nb ? [...nb.querySelectorAll('.todo-card')].slice(0, 2).map((c) => c.dataset.taskId) : [];
        out.swapped = out.after[0] === out.before[1] && out.after[1] === out.before[0];
        return out;
      })()`);
      check('看板卡片均可拖拽', o.allDraggable === true, 'maxCards=' + o.maxCards);
      check('看板拖拽显示插入指示线', o.skipped === true || o.markAfter === true, 'skipped=' + o.skipped + ' mark=' + o.markAfter);
      check('看板列内拖拽排序生效', o.skipped === true || o.swapped === true,
        'before=' + JSON.stringify(o.before) + ' after=' + JSON.stringify(o.after));

      // 5.4) 事件时间格式(now()现在返回秒,不再出现 year=58598)
      o = await js('eventTimeFormat', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // 用 ESM 模块名 -> 拿不到;改用 UI 端到端:打开 taskA 编辑,加一条事件,确认 datetime-local 显示本年
        const editBtn = document.querySelector('.todo-card[data-task-id="${TASK_A}"] [data-t="edit"]');
        if (!editBtn) return { __err: 'edit btn not found' };
        editBtn.click();
        await sleep(400);
        const eventsTab = document.querySelector('[data-tab="events"]');
        if (!eventsTab) return { __err: 'events tab not found' };
        eventsTab.click();
        await sleep(250);
        // 记下加事件前 datetime-local 数量
        const beforeInputs = document.querySelectorAll('[data-ev-at]').length;
        const addBtn = document.querySelector('[data-add-event]');
        if (addBtn) addBtn.click();
        await sleep(300);
        const inputs = [...document.querySelectorAll('[data-ev-at]')];
        const newInput = inputs[inputs.length - 1];
        const thisYear = String(new Date().getFullYear());
        // 检查新增的 input value 是否以本年开始
        const isCurrentYear = newInput && newInput.value && newInput.value.startsWith(thisYear);
        // 检查没有 58xxx 的末日年份
        const allInputsValid = inputs.every((i) => /^(19|20)\\d{2}-/.test(i.value));
        // 详情面板里"过去事件"显示的年份不是 58598
        const details = [...document.querySelectorAll('.todo-detail-event-time')].map((e) => e.textContent || '');
        const badYear = details.some((t) => /5859\\d|58\\d\\d\\d/.test(t));
        // 关闭 modal
        const closeBtn = document.querySelector('[data-act="close"]');
        if (closeBtn) closeBtn.click();
        await sleep(200);
        return { beforeInputs, added: inputs.length - beforeInputs, newValue: newInput ? newInput.value : '',
          isCurrentYear, allInputsValid, badYear, detailYears: details.map((t) => t.slice(0, 4)) };
      })()`);
      check('事件时间格式正确(显示当前年份)',
        o.added === 1 && o.isCurrentYear === true && o.allInputsValid === true && o.badYear === false,
        'added=' + o.added + ' newValue=' + o.newValue + ' isCurYr=' + o.isCurrentYear
        + ' allValid=' + o.allInputsValid + ' badYear=' + o.badYear + ' detailYears=' + JSON.stringify(o.detailYears) + ' err=' + o.__err);

      // 5.4.1) 任务 createdAt/updatedAt 格式(补丁·42 补:迁移遗漏了 createdAt/updatedAt,显示成 58595 年)
      o = await js('createdAtFormat', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // 5.4 关闭后可能因多 modal 串联没干净,先点 overlay 兜底关闭所有模态
        const overlay = document.querySelector('.todo-overlay');
        if (overlay) { overlay.click(); await sleep(300); }
        // 端到端:打开 taskA 详情面板(只读),看底部"创建于/更新于"年份
        const card = document.querySelector('.todo-card[data-task-id="${TASK_A}"]');
        if (!card) return { __err: 'card not found' };
        const titleEl = card.querySelector('.todo-card-title');
        titleEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(500);
        const body = document.querySelector('.todo-modal-body');
        const bodyClasses = body ? Array.from(body.classList) : [];
        // 必须命中 todo-detail-body 才是详情面板
        if (!bodyClasses.includes('todo-detail-body')) return { __err: 'wrong modal opened', bodyClasses };
        const foot = document.querySelector('.todo-detail-foot');
        if (!foot) return { __err: 'detail foot not found', bodyClasses };
        const footText = foot.textContent || '';
        const thisYear = String(new Date().getFullYear());
        const isCurrentYear = footText.includes(thisYear);
        const badYear = /5859\\d|58\\d\\d\\d/.test(footText);
        const closeBtn = document.querySelector('[data-act="close"]');
        if (closeBtn) closeBtn.click();
        await sleep(200);
        return { isCurrentYear, badYear, footText: footText.slice(0, 80), bodyClasses };
      })()`);
      check('创建于/更新于年份正确(补丁·42 补迁移)',
        o.isCurrentYear === true && o.badYear === false,
        'isCurYr=' + o.isCurrentYear + ' badYear=' + o.badYear + ' foot="' + o.footText + '"'
        + ' err=' + o.__err + ' bodyClasses=' + JSON.stringify(o.bodyClasses));

      // 5.4.2) 子任务创建时间显示(补丁·44:子任务也要显示创建于)
      o = await js('subCreatedAt', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const card = document.querySelector('.todo-card[data-task-id="${TASK_A}"]');
        if (!card) return { __err: 'card not found' };
        const editBtn = card.querySelector('[data-t="edit"]');
        if (editBtn) editBtn.click();
        await sleep(400);
        const subTab = document.querySelector('.todo-tab-btn[data-tab="subtasks"]');
        if (!subTab) return { __err: 'subtab not found', modalExists: !!document.querySelector('.todo-modal') };
        subTab.click();
        await sleep(300);
        const createdEl = document.querySelector('.todo-sub-created');
        if (!createdEl) return { __err: 'no .todo-sub-created', modalExists: !!document.querySelector('.todo-modal') };
        // title 用 fmtFullDate(含年份),可同时验证正确年份 + 抓住末日年份 bug;
        // 内联文本用 fmtShortDate(省略当年年份),不能直接查年份
        const title = createdEl.getAttribute('title') || '';
        const txt = createdEl.textContent || '';
        const thisYear = String(new Date().getFullYear());
        const isCurrentYear = title.includes(thisYear);
        const badYear = /5859\\d|58\\d\\d\\d/.test(title);
        const closeBtn = document.querySelector('[data-act="close"]');
        if (closeBtn) closeBtn.click();
        await sleep(200);
        return { isCurrentYear, badYear, title: title.slice(0, 40), txt: txt.slice(0, 40) };
      })()`);
      check('子任务显示创建于年份正确(补丁·44)',
        o.isCurrentYear === true && o.badYear === false,
        'isCurYr=' + o.isCurrentYear + ' badYear=' + o.badYear + ' title="' + o.title + '" txt="' + o.txt + '"' + ' err=' + o.__err);

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

      // 5.5b) 年视图:点击顶栏标题(年份数字)→ 12 个月格子(3列);点击当前月格子 → 返回月视图
      o = await js('yearview', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        const out = {};
        out.titleBefore = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        const yrBtn = document.querySelector('[data-cal="year"]');
        out.yearBtnFound = !!yrBtn;
        if (yrBtn) { yrBtn.click(); await sleep(300); }
        out.yearGrid = !!document.querySelector('.todo-cal-year-grid');
        out.yearCells = document.querySelectorAll('.todo-cal-year-cell').length;
        out.yearTitle = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        const curCell = document.querySelector('.todo-cal-year-cell.current');
        out.currentCellFound = !!curCell;
        out.currentBdayText = (curCell && curCell.querySelector('.todo-cal-year-bday') || {}).textContent || '';
        out.currentBdayNames = curCell ? [...curCell.querySelectorAll('.todo-cal-year-name')].map((n) => n.textContent) : [];
        if (curCell) { curCell.click(); await sleep(300); }
        out.backMonth = !!document.querySelector('.todo-cal-grid');
        out.backTitle = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        // 再次进入年视图,点击年份标题 → 快捷返回当月月视图
        document.querySelector('[data-cal="year"]').click(); await sleep(300);
        const todayBtn = document.querySelector('[data-cal="today"]');
        out.todayBtnFound = !!todayBtn;
        if (todayBtn) { todayBtn.click(); await sleep(300); }
        out.backTodayGrid = !!document.querySelector('.todo-cal-grid');
        const t2 = new Date();
        out.expToday = t2.getFullYear() + '年' + (t2.getMonth() + 1) + '月';
        out.backTodayTitle = (document.querySelector('.todo-cal-title') || {}).textContent || '';
        document.querySelector('[data-view="list"]').click(); await sleep(250);
        return out;
      })()`);
      check('年视图:顶栏标题可点击', o.yearBtnFound === true && o.yearGrid === true, o.titleBefore + ' btn=' + o.yearBtnFound);
      check('年视图:12 个月格子(3列)', o.yearCells === 12, 'cells=' + o.yearCells);
      check('年视图:年份标题', /2026/.test(o.yearTitle || ''), o.yearTitle);
      check('年视图:当前月格子高亮', o.currentCellFound === true);
      check('年视图:当月格子显示生日人数及人名', /生日/.test(o.currentBdayText || '') && o.currentBdayNames.length >= 3, o.currentBdayText + ' / ' + JSON.stringify(o.currentBdayNames));
      check('年视图:点击月份返回月视图', o.backMonth === true && /2026年\d{1,2}月/.test(o.backTitle || ''), o.backTitle);
      check('年视图:点击年份标题返回当月', o.todayBtnFound === true && o.backTodayGrid === true && o.backTodayTitle === o.expToday, o.backTodayTitle + ' vs ' + o.expToday);

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
          // 类型高亮检查:默认待办事件高亮;生日改为「公历/农历生日」下拉(默认公历生日);历法行已移除
          out.todoOn0 = document.querySelector('[data-ev-type="todo"]').classList.contains('on');
          out.bdaySel0 = document.querySelector('[data-ev-bday]').value;
          out.calRowGone = !document.querySelector('[data-ev-cal-row]');
          out.preDate = document.querySelector('[data-ev-date]').value;
          out.hintSolar = (document.querySelector('[data-ev-lunar]') || {}).textContent || '';
          out.titleLabel0 = (document.querySelector('[data-ev-title-label]') || {}).textContent || '';
          out.titlePh0 = (document.querySelector('[data-ev-title]') || {}).placeholder || '';
          // 点击「公历生日」下拉(选中值不变)→ 立即切生日模式 + 标题 label 变「名字 *」
          const sel = document.querySelector('[data-ev-bday]');
          sel.click(); await sleep(120);
          out.bdayOnByFocus = sel.classList.contains('on');
          out.todoOnFocus = document.querySelector('[data-ev-type="todo"]').classList.contains('on');
          out.titleLabelBday = (document.querySelector('[data-ev-title-label]') || {}).textContent || '';
          // 点「纪念日」按钮 → 标题 label 变「名称 *」
          document.querySelector('[data-ev-type="anniversary"]').click(); await sleep(120);
          out.anniOn = document.querySelector('[data-ev-type="anniversary"]').classList.contains('on');
          out.titleLabelAnni = (document.querySelector('[data-ev-title-label]') || {}).textContent || '';
          // 回到生日(点击下拉)→ 切到「农历生日」:下拉高亮、待办不高亮、日期框保持公历不变(农历显示在右侧提示)
          sel.click(); await sleep(120);
          sel.value = 'lunar'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(120);
          out.bdayOn = sel.classList.contains('on');
          out.todoOn1 = document.querySelector('[data-ev-type="todo"]').classList.contains('on');
          out.lunarDate = document.querySelector('[data-ev-date]').value;
          out.hintLunar = (document.querySelector('[data-ev-lunar]') || {}).textContent || '';
          // 切回「公历生日」:输入框仍公历、下拉保持生日高亮(随后保存,chip 落在当前 9 月视图)
          sel.value = 'solar'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(120);
          out.solarOn2 = sel.classList.contains('on');
          out.solarDate = document.querySelector('[data-ev-date]').value;
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
        out.editBdayVal = (document.querySelector('[data-ev-bday]') || {}).value || '';
        out.editTitleLabel = (document.querySelector('[data-ev-title-label]') || {}).textContent || '';
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
      check('生日下拉默认公历生日', o.bdaySel0 === 'solar', 'sel=' + o.bdaySel0);
      check('历法行已移除', o.calRowGone === true);
      check('公历模式日期框有农历提示', /^农历/.test(o.hintSolar || ''), o.hintSolar);
      check('标题随类型:默认待办=标题 *', o.titleLabel0 === '标题 *' && (o.titlePh0 || '').includes('事件标题'), o.titleLabel0 + ' / ' + o.titlePh0);
      check('点击生日下拉即切生日模式(值不变)', o.bdayOnByFocus === true && o.todoOnFocus === false, 'bday=' + o.bdayOnByFocus + ' todo=' + o.todoOnFocus);
      check('标题随类型:生日=名字 *', o.titleLabelBday === '名字 *' && (o.titleLabelBday || '').includes('名字'), o.titleLabelBday);
      check('标题随类型:纪念日=名称 *', o.anniOn === true && o.titleLabelAnni === '名称 *', o.titleLabelAnni);
      check('选农历:下拉高亮且待办不高亮', o.bdayOn === true && o.todoOn1 === false, 'bday=' + o.bdayOn + ' todo=' + o.todoOn1);
      check('选农历:输入框保持公历(农历显示在右侧提示)', o.lunarDate === o.preDate && o.solarDate === o.preDate && /^农历/.test(o.hintLunar || ''), o.preDate + ' → ' + o.lunarDate + '(' + o.hintLunar + ')');
      check('切回公历:输入框仍公历且下拉保持生日高亮', o.solarOn2 === true && o.solarDate === o.preDate, o.solarDate + ' vs ' + o.preDate + ' on=' + o.solarOn2);
      check('事件 chip 出现', o.chipFound === true, JSON.stringify(o.eventChips));
      check('点击事件打开编辑', o.editOpen === true && o.editTitle === '测试生日', o.editTitle);
      check('编辑时生日下拉=公历生日', o.editBdayVal === 'solar', 'val=' + o.editBdayVal);
      check('编辑时标题 label=名字 *', o.editTitleLabel === '名字 *', o.editTitleLabel);
      check('事件弹窗关闭', o.closed === true);

      // 5.7) 农历生日:右键今天格子新建生日+农历 → 存库日期应为「今天公历对应的农历月日」,chip 落在今天格子(今年提醒日期=今天)
      o = await js('eventLunar', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        // 导航回当月(5.5 曾翻到下月),直到今天格子可见
        for (let i = 0; i < 3 && !document.querySelector('.todo-cal-cell.today'); i++) {
          const p = document.querySelector('[data-cal="prev"]');
          if (p) { p.click(); await sleep(200); }
        }
        const todayCell = document.querySelector('.todo-cal-cell.today');
        if (!todayCell) return { err: 'no today cell' };
        out.todayLunarText = (todayCell.querySelector('.todo-cal-lunar') || {}).textContent || '';
        const t = new Date();
        out.todaySolar = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        todayCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 320 }));
        await sleep(200);
        const addItem = [...document.querySelectorAll('.ctx-item')].find((b) => (b.textContent || '').includes('新建事件'));
        if (!addItem) return { err: 'no add menu' };
        addItem.click(); await sleep(300);
        const dateInp = document.querySelector('[data-ev-date]');
        out.preDate = dateInp ? dateInp.value : '';
        out.hintSolar = (document.querySelector('[data-ev-lunar]') || {}).textContent || '';
        // 下拉选「农历生日」:日期框即时换算为农历月日,提示显示该农历
        const sel = document.querySelector('[data-ev-bday]');
        sel.value = 'lunar'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(120);
        out.lunarDateShown = document.querySelector('[data-ev-date]').value;
        out.hintLunar = (document.querySelector('[data-ev-lunar]') || {}).textContent || '';
        const titleInp = document.querySelector('[data-ev-title]');
        titleInp.value = '${SMOKE_BDAY_LUNAR_CONV}';
        titleInp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-ev-save]').click(); await sleep(400);
        // 保存后弹窗关闭并重渲染:农历生日今年提醒日期=今天,chip 应落在今天格子
        out.chipToday = !![...document.querySelectorAll('.todo-cal-cell.today .todo-cal-event')].find((c) => (c.textContent || '').includes('${SMOKE_BDAY_LUNAR_CONV}'));
        out.modalClosed = !document.querySelector('[data-ev-title]');
        return out;
      })()`);
      const dL = dbm.readDb();
      const evL = dL.todoEvents.find((e) => e.title === SMOKE_BDAY_LUNAR_CONV);
      check('农历生日:今天格子可见且有农历文本', !o.err && (o.todayLunarText || '').length > 0, o.err || o.todayLunarText);
      check('农历生日:弹窗初始日期=今天公历', o.preDate === o.todaySolar, o.preDate + ' vs ' + o.todaySolar);
      check('农历生日:公历模式农历提示=今天农历', o.hintSolar === '农历' + o.todayLunarText, o.hintSolar + ' vs ' + o.todayLunarText);
      check('农历生日:切农历后输入框保持公历(农历显示在右侧提示)', o.lunarDateShown === o.todaySolar && o.hintLunar === '农历' + o.todayLunarText, o.preDate + ' → ' + o.lunarDateShown + '(' + o.hintLunar + ')');
      check('农历生日:存库日期=公历输入框换算的农历月日', !!evL && evL.calendar === 'lunar' && /^\d{4}-\d{2}-\d{2}$/.test(evL.date || '') && evL.date !== o.lunarDateShown && evL.date.slice(5) !== o.todaySolar.slice(5), JSON.stringify(evL));
      check('农历生日:chip 落在今天格子(今年提醒=今天)', o.chipToday === true);
      check('农历生日:弹窗保存后关闭', o.modalClosed === true);

      // 5.8) 当日事件弹窗:点击日期格第一行 → 事件列表标签 + 新建事件标签
      o = await js('dayev', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        const todayTop = document.querySelector('.todo-cal-cell.today .todo-cal-top');
        if (!todayTop) return { err: 'no today top row' };
        todayTop.click(); await sleep(300);
        out.modalOpen = !!document.querySelector('.todo-modal-title');
        out.modalTitle = (document.querySelector('.todo-modal-title') || {}).textContent || '';
        out.hList = (document.querySelector('.todo-modal') || {}).offsetHeight || 0;
        out.tabs = [...document.querySelectorAll('.todo-tab-btn')].map((b) => b.textContent);
        out.listRows = [...document.querySelectorAll('.todo-day-ev-title')].map((r) => r.textContent);
        out.listHasLunarBday = (out.listRows || []).some((t) => t.includes('${SMOKE_BDAY_LUNAR_CONV}'));
        const t = new Date();
        out.expDate = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        // 切「新建事件」标签
        const newTab = [...document.querySelectorAll('[data-evtab]')].find((b) => (b.textContent || '').includes('新建事件'));
        out.newTabFound = !!newTab;
        if (newTab) { newTab.click(); await sleep(250); }
        out.newForm = !!document.querySelector('[data-ev-title]');
        out.newDate = (document.querySelector('[data-ev-date]') || {}).value || '';
        out.hNew = (document.querySelector('.todo-modal') || {}).offsetHeight || 0;
        const titleInp = document.querySelector('[data-ev-title]');
        titleInp.value = '${SMOKE_DAYEV_TITLE}';
        titleInp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-ev-save]').click(); await sleep(400);
        // 保存后自动切回「事件列表」标签并含新事件
        out.backListRows = [...document.querySelectorAll('.todo-day-ev-title')].map((r) => r.textContent);
        out.hasNewEv = (out.backListRows || []).some((t) => t.includes('${SMOKE_DAYEV_TITLE}'));
        out.listTabOn = [...document.querySelectorAll('.todo-tab-btn')].some((b) => b.classList.contains('on') && (b.textContent || '').includes('事件列表'));
        out.hList2 = (document.querySelector('.todo-modal') || {}).offsetHeight || 0;
        // 点事件行 → 打开编辑弹窗,尺寸应与当日弹窗一致(向大看齐)
        const firstRow = [...document.querySelectorAll('.todo-day-ev')][0];
        out.rowFound = !!firstRow;
        if (firstRow) { firstRow.click(); await sleep(300); }
        out.editOpen = !!document.querySelector('.todo-modal-title');
        out.hEdit = (document.querySelector('.todo-modal') || {}).offsetHeight || 0;
        // 点「取消」→ 应返回当日事件弹窗(事件列表标签),而非日历页
        const cancelBtn = [...document.querySelectorAll('.todo-modal-foot .btn')].find((b) => (b.textContent || '').includes('取消'));
        out.cancelFound = !!cancelBtn;
        if (cancelBtn) { cancelBtn.click(); await sleep(300); }
        out.backToDay = !!document.querySelector('.todo-day-ev');
        out.backToListTab = !![...document.querySelectorAll('.todo-tab-btn')].find((b) => b.classList.contains('on') && (b.textContent || '').includes('事件列表'));
        const closeBtn = document.querySelector('.todo-modal-head [data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(250); }
        out.closed = !document.querySelector('.todo-modal-title');
        document.querySelector('[data-view="list"]').click(); await sleep(250);
        return out;
      })()`);
      const dE = dbm.readDb();
      const evDay = dE.todoEvents.find((e) => e.title === SMOKE_DAYEV_TITLE);
      check('当日弹窗:点击日期文字打开', o.modalOpen === true, o.err || o.modalTitle);
      check('当日弹窗:标题含公历+农历', /2026年\d{1,2}月\d{1,2}日/.test(o.modalTitle || '') && /初五/.test(o.modalTitle || ''), o.modalTitle);
      check('当日弹窗:两个标签页', Array.isArray(o.tabs) && o.tabs.length === 2 && o.tabs.some((x) => x.includes('事件列表')) && o.tabs.some((x) => x.includes('新建事件')), JSON.stringify(o.tabs));
      check('当日弹窗:列表含当天农历生日', o.listHasLunarBday === true, JSON.stringify(o.listRows));
      check('当日弹窗:新建标签表单且日期=今天公历', o.newTabFound === true && o.newForm === true && o.newDate === o.expDate, o.newDate + ' vs ' + o.expDate);
      check('当日弹窗:保存后回列表且含新事件', o.hasNewEv === true && o.listTabOn === true, JSON.stringify(o.backListRows));
      check('当日弹窗:列表/新建/编辑三态高度一致', o.rowFound === true && o.editOpen === true && Math.abs(o.hList - o.hNew) <= 2 && Math.abs(o.hList - o.hList2) <= 2 && Math.abs(o.hList - o.hEdit) <= 2, 'list=' + o.hList + ' new=' + o.hNew + ' list2=' + o.hList2 + ' edit=' + o.hEdit);
      check('当日弹窗:编辑取消返回当日弹窗', o.cancelFound === true && o.backToDay === true && o.backToListTab === true, 'cancel=' + o.cancelFound + ' backDay=' + o.backToDay + ' listTab=' + o.backToListTab);
      check('当日弹窗:关闭', o.closed === true);
      check('当日弹窗:新事件落库', !!evDay && evDay.type === 'todo' && evDay.date === o.expDate, JSON.stringify(evDay));

      // 5.8b) 空事件格子:点击整格 → 打开当日事件弹窗并默认切到「新建事件」标签
      o = await js('emptycell', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="calendar"]').click(); await sleep(300);
        const out = {};
        const emptyCell = [...document.querySelectorAll('.todo-cal-cell')].find((c) => !c.classList.contains('out') && !c.querySelector('.todo-cal-event'));
        out.emptyFound = !!emptyCell;
        out.clickableCls = !!emptyCell && emptyCell.classList.contains('clickable');
        if (!emptyCell) return out;
        emptyCell.click(); await sleep(300);
        out.modalOpen = !!document.querySelector('.todo-modal-title');
        out.modalTitle = (document.querySelector('.todo-modal-title') || {}).textContent || '';
        out.newTabOn = !![...document.querySelectorAll('[data-evtab]')].find((b) => b.classList.contains('on') && (b.textContent || '').includes('新建事件'));
        out.newForm = !!document.querySelector('[data-ev-title]');
        const closeBtn = document.querySelector('.todo-modal-head [data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(250); }
        out.closed = !document.querySelector('.todo-modal-title');
        document.querySelector('[data-view="list"]').click(); await sleep(250);
        return out;
      })()`);
      check('空事件格子:可点击整格打开弹窗', o.emptyFound === true && o.clickableCls === true && o.modalOpen === true, o.err || o.modalTitle);
      check('空事件格子:默认切到新建事件标签', o.newTabOn === true && o.newForm === true, 'newTab=' + o.newTabOn + ' form=' + o.newForm);
      check('空事件格子:关闭', o.closed === true);

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

      // 7.0) 合并树(补丁·46):项目层级为主干 + 任务同树嵌套 + 三色状态统计 + 折叠持久化
      o = await js('tree', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-view="list"]').click(); await sleep(300);
        const out = {};
        // (a) 项目树:根"游戏开发"节点包含子项目"子项目"节点(同树嵌套)
        const gameNode = document.querySelector('.todo-tree-proj[data-proj="${PROJ_ID}"]');
        out.gameNodeFound = !!gameNode;
        const childNode = gameNode ? gameNode.querySelector('.todo-tree-proj[data-proj="p_smoke_child"]') : null;
        out.childProjFound = !!childNode;
        out.childProjName = childNode ? (childNode.querySelector('.todo-proj-name') || {}).textContent : '';
        // (b) 任务树:TASK_B 节点位于 TASK_A 节点的 .todo-tree-children 内(层级嵌套)
        const aNode = document.querySelector('.todo-tree-task[data-task-id="${TASK_A}"]');
        const bNode = document.querySelector('.todo-tree-task[data-task-id="${TASK_B}"]');
        out.aNodeFound = !!aNode;
        out.bNodeFound = !!bNode;
        const aChildren = aNode ? aNode.querySelector('.todo-tree-children') : null;
        out.bInsideA = !!(aChildren && bNode && aChildren.contains(bNode));
        // (c) 三色状态统计:项目节点含 待办/进行中/已完成 三色计数
        const todoEl = gameNode ? gameNode.querySelector('.todo-stat-todo b') : null;
        const progEl = gameNode ? gameNode.querySelector('.todo-stat-prog b') : null;
        const doneEl = gameNode ? gameNode.querySelector('.todo-stat-done b') : null;
        out.statTodo = todoEl ? Number(todoEl.textContent) : -1;
        out.statProg = progEl ? Number(progEl.textContent) : -1;
        out.statDone = doneEl ? Number(doneEl.textContent) : -1;
        out.statOk = !!(todoEl && progEl && doneEl);
        // (d) 折叠持久化:点击"游戏开发"项目行 → localStorage 写入 id + 子项目节点从 DOM 移除;再展开还原
        out.beforeLS = localStorage.getItem('todo_tree_collapsed');
        const gRow = gameNode ? gameNode.querySelector('.todo-tree-row') : null;
        if (gRow) { gRow.click(); await sleep(200); }
        const gameNode2 = document.querySelector('.todo-tree-proj[data-proj="${PROJ_ID}"]');
        out.afterLS = localStorage.getItem('todo_tree_collapsed');
        out.lsHasId = !!(out.afterLS && out.afterLS.includes('${PROJ_ID}'));
        // 折叠后子项目节点不再出现在 DOM(统一树不渲染 children 包裹层)
        out.childHidden = !!(gameNode2 && !gameNode2.querySelector('.todo-tree-proj[data-proj="p_smoke_child"]'));
        out.arrowGlyph = gameNode2 ? (gameNode2.querySelector('.todo-tree-row .todo-tree-arrow') || {}).textContent : '';
        out.arrowCollapsed = out.arrowGlyph.includes('▸');
        // 展开还原,避免影响后续归档
        const gRow2 = gameNode2 ? gameNode2.querySelector('.todo-tree-row') : null;
        if (gRow2) { gRow2.click(); await sleep(200); }
        const gameNode3 = document.querySelector('.todo-tree-proj[data-proj="${PROJ_ID}"]');
        out.expandedAfter = !!(gameNode3 && gameNode3.querySelector('.todo-tree-proj[data-proj="p_smoke_child"]'));
        // (e) 从属连接线(补丁·53):根级无 guides,子级有 guides + 竖线/分支线
        out.guidesTotal = document.querySelectorAll('.todo-tree-guides').length;
        out.vlines = document.querySelectorAll('.todo-tree-line.tl-v').length;
        out.hlines = document.querySelectorAll('.todo-tree-line.tl-h').length;
        const childNode2 = document.querySelector('.todo-tree-proj[data-proj="p_smoke_child"]');
        const childRow = childNode2 ? childNode2.querySelector('.todo-tree-row') : null;
        out.childHasGuides = !!(childRow && childRow.querySelector('.todo-tree-guides'));
        const rootRow = gameNode3 ? gameNode3.querySelector('.todo-tree-row') : null;
        out.rootHasNoGuides = !!(rootRow && !rootRow.querySelector('.todo-tree-guides'));
        return out;
      })()`);
      check('树:项目树含子项目(游戏开发→子项目)', o.gameNodeFound === true && o.childProjFound === true && /子项目/.test(o.childProjName || ''), 'gameNode=' + o.gameNodeFound + ' child=' + o.childProjFound + ' name=' + o.childProjName);
      check('树:项目内任务树嵌套(TASK_B 在 TASK_A 下)', o.aNodeFound === true && o.bNodeFound === true && o.bInsideA === true, 'a=' + o.aNodeFound + ' b=' + o.bNodeFound + ' inside=' + o.bInsideA);
      check('树:三色状态统计(待办/进行中/已完成)', o.statOk === true && (o.statTodo + o.statProg + o.statDone) >= 2, 'todo=' + o.statTodo + ' prog=' + o.statProg + ' done=' + o.statDone);
      check('树:折叠写入 localStorage(todo_tree_collapsed)', o.lsHasId === true, 'before=' + o.beforeLS + ' after=' + o.afterLS);
      check('树:折叠后子项目从 DOM 移除 + ▸箭头', o.childHidden === true && o.arrowCollapsed === true, 'childHidden=' + o.childHidden + ' arrowGlyph=' + o.arrowGlyph);
      check('树:再次点击可展开还原', o.expandedAfter === true);
      check('树(补丁·53):从属连接线存在(竖线+分支线)', o.guidesTotal > 0 && o.vlines > 0 && o.hlines > 0, 'guides=' + o.guidesTotal + ' v=' + o.vlines + ' h=' + o.hlines);
      check('树(补丁·53):子级节点有连接线 / 根级无连接线', o.childHasGuides === true && o.rootHasNoGuides === true, 'child=' + o.childHasGuides + ' root=' + o.rootHasNoGuides);

      // 7.a2) 列表树节点 hover「+」新建(补丁·52):每级标题栏有 +,点项目下 + → 新任务预设该项目;点任务下 + → 预设该父任务
      o = await js('treeAddBtn', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelectorAll('.todo-overlay').forEach((el) => el.remove());
        const out = {};
        // 每个树节点行都有 .todo-tree-add
        const rows = [...document.querySelectorAll('.todo-tree-row')];
        out.rowCount = rows.length;
        out.addBtns = [...document.querySelectorAll('.todo-tree-add')].length;
        // 项目节点 + :游戏开发
        const gameNode = document.querySelector('.todo-tree-proj[data-proj="${PROJ_ID}"]');
        const projAdd = gameNode ? gameNode.querySelector('.todo-tree-row .todo-tree-add') : null;
        out.projAddFound = !!projAdd;
        if (projAdd) { projAdd.click(); await sleep(250); }
        const projModal = document.querySelector('.todo-modal-wide');
        out.projModalOpened = !!projModal;
        const projSel = projModal ? projModal.querySelector('[data-d="projectId"]') : null;
        out.projSelVal = projSel ? projSel.value : '';
        // 关闭项目模态(取消)
        const projClose = projModal ? projModal.querySelector('[data-close]') : null;
        if (projClose) { projClose.click(); await sleep(200); }
        // 任务节点 + :TASK_A
        const aNode = document.querySelector('.todo-tree-task[data-task-id="${TASK_A}"]');
        const taskAdd = aNode ? aNode.querySelector('.todo-tree-row .todo-tree-add') : null;
        out.taskAddFound = !!taskAdd;
        if (taskAdd) { taskAdd.click(); await sleep(250); }
        const taskModal = document.querySelector('.todo-modal-wide');
        out.taskModalOpened = !!taskModal;
        const taskSel = taskModal ? taskModal.querySelector('[data-d="parentTaskId"]') : null;
        out.taskSelVal = taskSel ? taskSel.value : '';
        const taskClose = taskModal ? taskModal.querySelector('[data-close]') : null;
        if (taskClose) { taskClose.click(); await sleep(200); }
        return out;
      })()`);
      check('树(补丁·52):每个节点标题栏都有 hover「+」按钮', o.addBtns === o.rowCount && o.rowCount > 0, 'rows=' + o.rowCount + ' adds=' + o.addBtns);
      check('树(补丁·52):项目下 + 打开新任务并预设该项目', o.projAddFound === true && o.projModalOpened === true && o.projSelVal === PROJ_ID, 'found=' + o.projAddFound + ' modal=' + o.projModalOpened + ' selVal=' + o.projSelVal + ' PROJ_ID=' + PROJ_ID);
      check('树(补丁·52):任务下 + 打开新任务并预设该父任务', o.taskAddFound === true && o.taskModalOpened === true && o.taskSelVal === TASK_A, 'found=' + o.taskAddFound + ' modal=' + o.taskModalOpened + ' selVal=' + o.taskSelVal + ' TASK_A=' + TASK_A);

      // 7.b) 项目管理(补丁·47):行内删除确认 + 重名拒绝
      o = await js('manageProjects', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // 关掉树里可能展开的多余 modal
        document.querySelectorAll('.todo-overlay').forEach((el) => el.remove());
        document.querySelector('[data-action="projects"]').click(); await sleep(250);
        const out = {};
        const overlay = document.querySelector('.todo-overlay');
        const modal = overlay ? overlay.querySelector('.todo-modal') : null;
        out.modalOpened = !!modal && /项目管理/.test(modal.textContent || '');
        // 初次叠加的 overlay 数(后续点击删除不应再叠)
        out.overlaysBefore = document.querySelectorAll('.todo-overlay').length;
        out.rowsBefore = document.querySelectorAll('.todo-proj-row').length;
        // (1) 点 子项目 行(非 PROJ_ID,避免影响持久化「项目保留」断言)的 × → 行内二级确认
        const childRow = [...document.querySelectorAll('.todo-proj-row')].find((r) => {
          const n = r.querySelector('.todo-proj-name');
          return n && /子项目/.test(n.textContent || '');
        });
        const firstDel = childRow ? childRow.querySelector('[data-del]') : null;
        const firstName = childRow ? (childRow.querySelector('.todo-proj-name') || {}).textContent : '';
        out.firstName = firstName;
        if (firstDel) firstDel.click(); await sleep(150);
        out.overlaysAfterClick = document.querySelectorAll('.todo-overlay').length;
        out.modalMasksAfterClick = document.querySelectorAll('.modal-mask').length;
        const confirmRow = document.querySelector('[data-proj-del-ok]');
        out.inlineConfirmShown = !!confirmRow && !!document.querySelector('[data-proj-del-cancel]');
        // 确认删除 → 行数 -1
        if (confirmRow) { confirmRow.click(); await sleep(200); }
        out.rowsAfter = document.querySelectorAll('.todo-proj-row').length;
        out.modalStillOpen = !!document.querySelector('.todo-overlay');
        // (2) 重名拒绝:在 modal 中输入现有项目名(游戏开发,删除子项目后仍存在)→ 点 + 添加项目 → 应被拒
        const newNameInput = document.querySelector('[data-new-name]');
        if (newNameInput) {
          newNameInput.value = '游戏开发'; newNameInput.dispatchEvent(new Event('input', { bubbles: true }));
          const createBtn = document.querySelector('[data-new-create]');
          if (createBtn) { createBtn.click(); await sleep(200); }
        }
        out.rowsAfterDup = document.querySelectorAll('.todo-proj-row').length;
        // 关闭 modal
        const closeBtn = document.querySelector('[data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(150); }
        return out;
      })()`);
      check('管理项目:点 ◆ 项目 打开 modal', o.modalOpened === true);
      check('管理项目:行内删除不再叠 confirmDialog(overlay 数不变)', o.overlaysAfterClick === o.overlaysBefore && o.modalMasksAfterClick === 0, 'before=' + o.overlaysBefore + ' after=' + o.overlaysAfterClick + ' mask=' + o.modalMasksAfterClick);
      check('管理项目:点 × 后行内出现 ✓删除 / 取消 按钮', o.inlineConfirmShown === true);
      check('管理项目:确认后行数 -1', o.rowsAfter === o.rowsBefore - 1, 'before=' + o.rowsBefore + ' after=' + o.rowsAfter + ' name=' + o.firstName);
      check('管理项目:重名拒绝(行数不变)', o.rowsAfterDup === o.rowsAfter, 'after=' + o.rowsAfter + ' dup=' + o.rowsAfterDup);

      // 7.c) 项目管理(补丁·50):点名称 → 编辑面板(名称/备注/创建/截止/完成) → 保存落库
      o = await js('projectEdit', `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelectorAll('.todo-overlay').forEach((el) => el.remove());
        document.querySelector('[data-action="projects"]').click(); await sleep(250);
        const out = {};
        const pRow = [...document.querySelectorAll('.todo-proj-row')].find((r) => {
          const n = r.querySelector('.todo-proj-name');
          return n && /游戏开发/.test(n.textContent || '');
        });
        out.rowFound = !!pRow;
        const nameSpan = pRow ? pRow.querySelector('[data-edit]') : null;
        if (nameSpan) { nameSpan.click(); await sleep(200); }
        out.panelOpened = !!document.querySelector('.todo-proj-edit');
        out.hasNotes = !!document.querySelector('.todo-proj-edit-notes');
        out.hasCreated = !!document.querySelector('.todo-proj-edit-created');
        out.hasDeadline = !!document.querySelector('.todo-proj-edit-deadline');
        out.hasComplete = !!document.querySelector('.todo-proj-edit-complete');
        // 补丁·51:创建时间 input 的 value 必须落在 2020~2099 区间(修复旧库毫秒→秒迁移前显示成 58595)
        const createdInput = document.querySelector('.todo-proj-edit-created');
        out.createdValue = createdInput ? createdInput.value : '';
        out._vlen = (out.createdValue || '').length;
        out._vchars = JSON.stringify(out.createdValue); // chars printed as escape sequences
        out.createdYearOk = (() => {
          const v = out.createdValue || '';
          // 用字符串切片判定年份(避免 IPC 传输中正则 \d 被吃)
          const yRaw = v.length >= 4 ? v.slice(0, 4) : '';
          const y = parseInt(yRaw, 10);
          if (!y || !isFinite(y)) return null;
          return y;
        })();
        out.createdYearOkBool = typeof out.createdYearOk === 'number' && out.createdYearOk >= 2020 && out.createdYearOk <= 2099;
        // 补丁·51:面板父 modal-box 宽度应 ≤ 700(确保不撑破 90% 视口),且面板宽 ≤ modal 宽
        const modalEl = document.querySelector('.todo-overlay .todo-modal');
        const panelEl = document.querySelector('.todo-proj-edit');
        out.modalWidth = modalEl ? modalEl.getBoundingClientRect().width : 0;
        out.panelWidth = panelEl ? panelEl.getBoundingClientRect().width : 0;
        out.modalWithinViewport = out.modalWidth > 0 && out.modalWidth <= 700;
        out.panelFitsModal = out.modalWidth > 0 && out.panelWidth > 0 && out.panelWidth <= out.modalWidth + 1;
        // 面板内 4 个 datetime/name/notes/parent 全部可见且无溢出
        const fields = ['todo-proj-edit-name','todo-proj-edit-parent','todo-proj-edit-notes','todo-proj-edit-created','todo-proj-edit-deadline','todo-proj-edit-complete'];
        out.fieldsAll = fields.every((s) => !!document.querySelector('.' + s));
        out.saveBtnVisible = !!document.querySelector('[data-proj-save]');
        const nm = document.querySelector('.todo-proj-edit-name');
        const nt = document.querySelector('.todo-proj-edit-notes');
        const dl = document.querySelector('.todo-proj-edit-deadline');
        const cp = document.querySelector('.todo-proj-edit-complete');
        if (nm) { nm.value = '游戏开发(改)'; nm.dispatchEvent(new Event('input', { bubbles: true })); }
        if (nt) { nt.value = '测试备注内容'; nt.dispatchEvent(new Event('input', { bubbles: true })); }
        if (dl) { dl.value = '2030-01-01T09:00'; dl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (cp) { cp.value = '2030-02-02T10:00'; cp.dispatchEvent(new Event('input', { bubbles: true })); }
        const saveBtn = document.querySelector('[data-proj-save]');
        if (saveBtn) { saveBtn.click(); await sleep(250); }
        const renamedRow = [...document.querySelectorAll('.todo-proj-row')].find((r) => {
          const n = r.querySelector('.todo-proj-name');
          return n && (n.textContent || '').includes('游戏开发(改)');
        });
        out.renamedShown = !!renamedRow;
        const closeBtn = document.querySelector('[data-close]');
        if (closeBtn) { closeBtn.click(); await sleep(150); }
        return out;
      })()`);
      check('项目管理(补丁·50):点名称打开编辑面板', o.panelOpened === true);
      check('项目管理(补丁·50):编辑面板含 备注/创建/截止/完成 字段', o.hasNotes && o.hasCreated && o.hasDeadline && o.hasComplete, 'notes=' + o.hasNotes + ' created=' + o.hasCreated + ' deadline=' + o.hasDeadline + ' complete=' + o.hasComplete);
      check('项目管理(补丁·51):创建时间年份不再 58595(迁移 fixMs 生效)', o.createdYearOkBool === true, 'vchars=' + o._vchars + ' vlen=' + o._vlen + ' year=' + o.createdYearOk + ' yearOk=' + o.createdYearOkBool);
      check('项目管理(补丁·51):6 字段全部渲染', o.fieldsAll === true, 'fieldsAll=' + o.fieldsAll);
      check('项目管理(补丁·51):modal 宽度不超 700px(避免撑破视口)', o.modalWithinViewport === true, 'modalWidth=' + o.modalWidth);
      check('项目管理(补丁·51):面板宽度 ≤ modal 宽度(无横向溢出)', o.panelFitsModal === true, 'modalW=' + o.modalWidth + ' panelW=' + o.panelWidth);
      check('项目管理(补丁·51):保存按钮可见', o.saveBtnVisible === true);
      check('项目管理(补丁·50):保存后显示改名结果', o.renamedShown === true);

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
      // 补丁·40:startAt/completeAt/events + 子任务 notes/doneAt 之前根本没有数据库列,重启即丢
      check('持久化:startAt 落库', a && typeof a.startAt === 'number' && a.startAt > 0, 'startAt=' + (a && a.startAt));
      check('持久化:events 列存在(数组)', a && Array.isArray(a.events), 'events=' + JSON.stringify(a && a.events));
      const subCols = a && a.subtasks && a.subtasks[0] ? Object.keys(a.subtasks[0]) : [];
      check('持久化:子任务含 notes/doneAt/createdAt 字段', subCols.includes('notes') && subCols.includes('doneAt') && subCols.includes('createdAt'), 'cols=' + JSON.stringify(subCols));
      const sub0 = a && a.subtasks && a.subtasks[0];
      check('持久化:子任务 createdAt 为有效时间戳(补丁·44 显示创建时间)', !!sub0 && typeof sub0.createdAt === 'number' && sub0.createdAt > 0, 'createdAt=' + (sub0 && sub0.createdAt));
      const doneSub = a && (a.subtasks || []).find((s) => s.done);
      check('持久化:已完成子任务保留 doneAt 列', !!doneSub && 'doneAt' in doneSub, 'sub=' + JSON.stringify(doneSub));
      // 补丁·40:看板拖拽用分数序号(小数 sort),必须能存进 SQLite 且列内相对顺序被保留
      const bT = d.todoTasks.find((t) => t.id === TASK_B);
      const doneCol = d.todoTasks.filter((t) => !t.archived && t.status === (bT ? bT.status : 'done'))
        .sort((x, y) => ((x.sort ?? 0) - (y.sort ?? 0)) || ((x.createdAt || 0) - (y.createdAt || 0)));
      check('持久化:sort 为有限数值', !!bT && typeof bT.sort === 'number' && isFinite(bT.sort), 'sort=' + (bT && bT.sort));
      check('持久化:看板拖拽后不再位列本列首位', doneCol.length < 2 || doneCol[0].id !== TASK_B,
        'col=' + JSON.stringify(doneCol.slice(0, 2).map((t) => t.id + '@' + t.sort)));
      check('持久化:项目保留', d.todoProjects.some((p) => p.id === PROJ_ID) === true);
      // 补丁·50:项目 备注 / 截止 / 完成 时间 字段必须落库(旧库无列会静默丢)
      const proj50 = d.todoProjects.find((p) => p.id === PROJ_ID);
      check('持久化:项目 备注 落库', !!proj50 && proj50.notes === '测试备注内容', 'notes=' + (proj50 && proj50.notes));
      check('持久化:项目 截止时间 落库(秒)', !!proj50 && typeof proj50.deadline === 'number' && proj50.deadline > 1e9, 'deadline=' + (proj50 && proj50.deadline));
      check('持久化:项目 完成时间 落库(秒)', !!proj50 && typeof proj50.completeAt === 'number' && proj50.completeAt > 1e9, 'completeAt=' + (proj50 && proj50.completeAt));
      check('持久化:项目 改名 落库', !!proj50 && proj50.name === '游戏开发(改)', 'name=' + (proj50 && proj50.name));
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
