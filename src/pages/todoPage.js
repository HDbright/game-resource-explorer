// Todo-List 任务管理(移植自 Taskwingo)
// 功能:任务增删改/拖拽排序、优先级(紧急/高/中/低)、状态(待办/进行中/已完成)、截止日期、
// 标签、子任务(进度/勾选/重命名/拖拽)、项目分组、列表 + 看板双视图、筛选、归档、CSV/JSON 导出、
// 导入(兼容 Taskwingo 导出)、中英文界面切换。
// 数据直接挂在全局 state.todoProjects / state.todoTasks(与库中 todo_* 表同步,saveState 落盘)。

import { state, saveState, uid, now } from '../state.js';
import { toast, confirmDialog, showContextMenu } from '../dialogs.js';
import { getLunarInfo, lunarMonthDayToSolar, formatLunarMonth, formatLunarDay } from '../calendarLunar.js';

// ---------------- 国际化 ----------------
let lang = 'zh'; // 'zh' | 'en'
const LANGS = {
  zh: {
    // 头部
    title: 'Todo-List 任务管理', completed: '已完成 {0}/{1}',
    viewList: '列表', viewKanban: '看板', viewCalendar: '日历', listView: '列表视图', kanbanView: '看板视图', calendarView: '日历视图',
    projects: '项目', manageProjectsTitle: '管理项目', archive: '归档', archiveTitle: '查看归档任务',
    exportBtn: '导出', exportTitle: '导出', importBtn: '导入', importTitle: '从 JSON 文件导入任务',
    newTask: '新建任务', newTaskTitle: '新建任务', csvFile: 'CSV 文件', jsonFile: 'JSON 文件',
    langBtn: 'EN', langTitle: '切换界面语言(中/EN)',
    // 筛选
    searchPh: '搜索任务…', allPriority: '全部优先级', allStatus: '全部状态', allProjects: '全部项目', noProject: '无项目',
    sortManual: '手工顺序', sortPriorityDesc: '优先级 ↓', sortDeadlineAsc: '截止日期 ↑',
    sortNewest: '最新优先', sortOldest: '最早优先', clear: '清除',
    hint: '拖拽卡片可排序 · 点击卡片查看详情',
    // 优先级 / 状态
    pri_urgent: '紧急', pri_high: '高', pri_medium: '中', pri_low: '低',
    st_todo: '待办', st_in_progress: '进行中', st_done: '已完成',
    clickToggle: '点击切换', clickToggleStatus: '点击切换状态', clickTogglePriority: '点击切换优先级',
    // 空状态
    noMatching: '没有匹配的任务', noTasks: '还没有任务',
    adjustFilter: '试试调整筛选条件', clickNewTask: '点击「+ 新建任务」开始吧',
    // 看板
    dropHere: '把任务拖到这里',
    // 日历
    week0: '周一', week1: '周二', week2: '周三', week3: '周四', week4: '周五', week5: '周六', week6: '周日',
    more: '+{0} 更多', prevMonth: '上个月', nextMonth: '下个月',
    viewYear: '点击查看全年', clickToMonth: '点击返回当月', viewMonth: '查看 {0} 日程', yearStat: '事件 {0} · 任务 {1}',
    dayEvList: '事件列表 ({0})', dayEvEmpty: '当天没有事件',
    // 日历事件
    evBirthday: '生日', evAnniversary: '纪念日', evTodo: '待办事件', evImportant: '重要事件',
    newEvent: '新建事件', editEvent: '编辑事件', deleteEvent: '删除事件', addEventMenu: '新建事件…',
    evTypeLabel: '类型', evTitleLabel: '标题 *', evNoteLabel: '备注', evDateLabel: '日期',
    evTitlePh: '事件标题', evNotePh: '补充说明…', evTitleRequired: '标题不能为空', evSaved: '已保存',
    evConfirmDel: '确定删除事件「{0}」吗?', evLunarTip: '农历',
    solar: '公历', lunar: '农历', evCalendarLabel: '历法',
    bdaySolar: '公历生日', bdayLunar: '农历生日',
    remindTodoToday: '今日待办 {0} 项', remindBdayToday: '今日 {0} 人生日', remindBday3d: '3 日内 {0} 人生日',
    remindTodoTodayTitle: '今日待办', remindBdayTodayTitle: '今日生日', remindBday3dTitle: '3 日内生日',
    // 模态框
    tabDetails: '详情', tabSubtasks: '子任务',
    titleLabel: '标题 *', titlePh: '要做什么?', notesLabel: '备注', notesPh: '补充说明…',
    priorityLabel: '优先级', statusLabel: '状态', projectLabel: '项目',
    deadlineLabel: '截止日期', tagsLabel: '标签', tagPh: '输入标签,回车添加', add: '添加',
    cancel: '取消', createTask: '创建任务', saveChanges: '保存修改',
    titleRequired: '标题不能为空', saved: '已保存', close: '关闭',
    progress: '进度', addStepPh: '添加一个步骤…', dragToReorder: '拖拽排序',
    moveUp: '上移', moveDown: '下移', doubleClickRename: '双击重命名', del: '删除',
    // 详情
    copy: '复制', copyTitle: '复制任务摘要', copied: '已复制到剪贴板', copyFailed: '复制失败',
    overduePrefix: '已逾期 · ', descLabel: '描述', createdOn: '创建于 {0}', updatedOn: '更新于 {0}',
    taskNotFound: '任务不存在', priPrefix: '优先级:{0} | 状态:{1}', projectPrefix: '项目:{0}',
    deadlinePrefix: '截止:{0}', tagsPrefix: '标签:{0}', subtasksPrefix: '子任务({0}/{1}):',
    today: '今天', tomorrow: '明天',
    // 项目
    manageProjects: '管理项目', noProjectsYet: '还没有项目,在下面创建一个吧',
    newProject: '新建项目', projectNamePh: '项目名称', addProject: '+ 添加项目',
    projectNameRequired: '请输入项目名称', taskCount: '{0} 个任务',
    deleteProjectTitle: '删除项目', deleteProjectMsg: '确定删除项目「{0}」吗?项目下任务会保留并变为「无项目」。',
    delProjectTitleTip: '删除项目(任务保留,变为无项目)',
    // 归档
    archivedTasks: '📦 归档任务', noArchived: '没有归档任务',
    noArchivedDesc: '归档的任务会出现在这里,可随时恢复或永久删除',
    restore: '恢复', restoreTitle: '恢复任务', deleteForever: '永久删除',
    archivedOn: '归档于 {0} · {1}优先级',
    deleteForeverTitle: '永久删除', deleteForeverMsg: '确定永久删除「{0}」吗?此操作不可恢复。',
    deleteTaskTitle: '删除任务', deleteTaskMsg: '确定删除「{0}」吗?此操作不可恢复。',
    // 导出 / 导入
    exportCsvName: 'CSV 文件', exportJsonName: 'JSON 文件',
    exportedTo: '已导出到 {0}', exportFailed: '导出失败: {0}',
    importJsonTitle: '选择要导入的 JSON 文件',
    readFailed: '读取文件失败: {0}', jsonParseFailed: 'JSON 解析失败: {0}',
    noTasksField: '文件中没有任务数据(缺少 tasks 字段)',
    importDone: '已导入 {0} 个任务', importDoneSub: '({0} 个子任务)', importDoneProj: ',{0} 个项目',
    noImportable: '没有可导入的任务', untitledTask: '未命名任务', untitledStep: '未命名步骤',
    unknownError: '未知错误',
    // CSV 表头
    csvId: 'ID', csvTitle: '标题', csvNotes: '备注', csvPriority: '优先级', csvStatus: '状态',
    csvDeadline: '截止日期', csvTags: '标签', csvProject: '项目', csvSubtasks: '子任务', csvCreated: '创建日期',
  },
  en: {
    title: 'Todo-List Task Manager', completed: 'Completed {0}/{1}',
    viewList: 'List', viewKanban: 'Board', listView: 'List view', kanbanView: 'Board view',
    projects: 'Projects', manageProjectsTitle: 'Manage Projects', archive: 'Archive', archiveTitle: 'View archived tasks',
    exportBtn: 'Export', exportTitle: 'Export', importBtn: 'Import', importTitle: 'Import tasks from JSON',
    newTask: 'New Task', newTaskTitle: 'New Task', csvFile: 'CSV File', jsonFile: 'JSON File',
    langBtn: '中', langTitle: 'Switch UI language (中/EN)',
    searchPh: 'Search tasks…', allPriority: 'All Priorities', allStatus: 'All Statuses',
    allProjects: 'All Projects', noProject: 'No Project',
    sortManual: 'Manual Order', sortPriorityDesc: 'Priority ↓', sortDeadlineAsc: 'Deadline ↑',
    sortNewest: 'Newest First', sortOldest: 'Oldest First', clear: 'Clear',
    hint: 'Drag cards to reorder · Click a card for details',
    pri_urgent: 'Urgent', pri_high: 'High', pri_medium: 'Medium', pri_low: 'Low',
    st_todo: 'To Do', st_in_progress: 'In Progress', st_done: 'Done',
    clickToggle: 'Click to toggle', clickToggleStatus: 'Click to toggle status', clickTogglePriority: 'Click to change priority',
    noMatching: 'No matching tasks', noTasks: 'No tasks yet',
    adjustFilter: 'Try adjusting your filters', clickNewTask: 'Click "New Task" to get started',
    dropHere: 'Drop tasks here',
    week0: 'Mon', week1: 'Tue', week2: 'Wed', week3: 'Thu', week4: 'Fri', week5: 'Sat', week6: 'Sun',
    more: '+{0} more', prevMonth: 'Previous month', nextMonth: 'Next month',
    viewYear: 'View whole year', clickToMonth: 'Back to current month', viewMonth: 'View {0}', yearStat: '{0} events · {1} tasks',
    dayEvList: 'Events ({0})', dayEvEmpty: 'No events on this day',
    evBirthday: 'Birthday', evAnniversary: 'Anniversary', evTodo: 'Todo Event', evImportant: 'Important Event',
    newEvent: 'New Event', editEvent: 'Edit Event', deleteEvent: 'Delete Event', addEventMenu: 'New event…',
    evTypeLabel: 'Type', evTitleLabel: 'Title *', evNoteLabel: 'Note', evDateLabel: 'Date',
    evTitlePh: 'Event title', evNotePh: 'Additional details…', evTitleRequired: 'Title is required', evSaved: 'Saved',
    evConfirmDel: 'Delete event "{0}"?', evLunarTip: 'Lunar',
    solar: 'Solar', lunar: 'Lunar', evCalendarLabel: 'Calendar',
    bdaySolar: 'Solar Birthday', bdayLunar: 'Lunar Birthday',
    remindTodoToday: 'Today: {0} to-dos', remindBdayToday: 'Today: {0} birthday', remindBday3d: 'In 3 days: {0} birthday',
    remindTodoTodayTitle: 'Today to-dos', remindBdayTodayTitle: 'Today birthdays', remindBday3dTitle: 'Birthdays in 3 days',
    tabDetails: 'Details', tabSubtasks: 'Subtasks',
    titleLabel: 'Title *', titlePh: 'What needs to be done?', notesLabel: 'Notes', notesPh: 'Additional details…',
    priorityLabel: 'Priority', statusLabel: 'Status', projectLabel: 'Project',
    deadlineLabel: 'Deadline', tagsLabel: 'Tags', tagPh: 'Add tag, press Enter', add: 'Add',
    cancel: 'Cancel', createTask: 'Create Task', saveChanges: 'Save Changes',
    titleRequired: 'Title is required', saved: 'Saved', close: 'Close',
    progress: 'Progress', addStepPh: 'Add a step…', dragToReorder: 'Drag to reorder',
    moveUp: 'Move up', moveDown: 'Move down', doubleClickRename: 'Double-click to edit', del: 'Delete',
    copy: 'Copy', copyTitle: 'Copy task summary', copied: 'Copied to clipboard', copyFailed: 'Copy failed',
    overduePrefix: 'Overdue · ', descLabel: 'Description', createdOn: 'Created {0}', updatedOn: 'Updated {0}',
    taskNotFound: 'Task not found', priPrefix: 'Priority:{0} | Status:{1}', projectPrefix: 'Project:{0}',
    deadlinePrefix: 'Deadline:{0}', tagsPrefix: 'Tags:{0}', subtasksPrefix: 'Subtasks ({0}/{1}):',
    today: 'Today', tomorrow: 'Tomorrow',
    manageProjects: 'Manage Projects', noProjectsYet: 'No projects yet — create one below',
    newProject: 'New Project', projectNamePh: 'Project name', addProject: '+ Add Project',
    projectNameRequired: 'Please enter a project name', taskCount: '{0} tasks',
    deleteProjectTitle: 'Delete Project', deleteProjectMsg: 'Delete project "{0}"? Its tasks will be kept and become "No Project".',
    delProjectTitleTip: 'Delete project (tasks kept, become No Project)',
    archivedTasks: '📦 Archived Tasks', noArchived: 'No archived tasks',
    noArchivedDesc: 'Archived tasks appear here. You can restore or delete them anytime.',
    restore: 'Restore', restoreTitle: 'Restore task', deleteForever: 'Delete permanently',
    archivedOn: 'Archived {0} · {1} priority',
    deleteForeverTitle: 'Delete Permanently', deleteForeverMsg: 'Permanently delete "{0}"? This cannot be undone.',
    deleteTaskTitle: 'Delete Task', deleteTaskMsg: 'Delete "{0}"? This cannot be undone.',
    exportCsvName: 'CSV File', exportJsonName: 'JSON File',
    exportedTo: 'Exported to {0}', exportFailed: 'Export failed: {0}',
    importJsonTitle: 'Select a JSON file to import',
    readFailed: 'Failed to read file: {0}', jsonParseFailed: 'JSON parse failed: {0}',
    noTasksField: 'No tasks data (missing "tasks" field)',
    importDone: 'Imported {0} tasks', importDoneSub: '({0} subtasks)', importDoneProj: ', {0} projects',
    noImportable: 'No importable tasks', untitledTask: 'Untitled Task', untitledStep: 'Untitled step',
    unknownError: 'Unknown error',
    csvId: 'ID', csvTitle: 'Title', csvNotes: 'Notes', csvPriority: 'Priority', csvStatus: 'Status',
    csvDeadline: 'Deadline', csvTags: 'Tags', csvProject: 'Project', csvSubtasks: 'Subtasks', csvCreated: 'Created',
  },
};
function T(key, ...args) {
  const table = LANGS[lang] || LANGS.zh;
  const s = table[key] != null ? table[key] : (LANGS.zh[key] != null ? LANGS.zh[key] : key);
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m)) : s;
}

// ---------------- 常量 ----------------
const PRIORITY_CONFIG = {
  urgent: { color: '#ef4444', order: 4 },
  high: { color: '#f97316', order: 3 },
  medium: { color: '#3b82f6', order: 2 },
  low: { color: '#22c55e', order: 1 },
};
function priLabel(p) { return T('pri_' + p); }
const PRIORITY_CYCLE = { urgent: 'high', high: 'medium', medium: 'low', low: 'urgent' };
const STATUS_CONFIG = {
  todo: { icon: '○' },
  in_progress: { icon: '◑' },
  done: { icon: '●' },
};
function stLabel(s) { return T('st_' + s); }
const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6'];
const KANBAN_COLS = [
  { status: 'todo', color: '#6366f1' },
  { status: 'in_progress', color: '#f59e0b' },
  { status: 'done', color: '#22c55e' },
];
/** 日历事件类型:生日 / 纪念日 / 待办事件 / 重要事件 */
const EVENT_TYPES = {
  birthday: { icon: '🎂', color: '#ec4899' },
  anniversary: { icon: '💍', color: '#8b5cf6' },
  todo: { icon: '📝', color: '#3b82f6' },
  important: { icon: '⭐', color: '#f59e0b' },
};
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------- 模块状态 ----------------
let rootEl = null;        // .todo-root 容器
let view = 'list';        // 'list' | 'kanban' | 'calendar'
let calCursor = null;     // 日历视图当前月份(Date,月初)
let calView = 'month';    // 日历视图层级:'month'(月历日格子) | 'year'(12 个月格子年面板)
let filters = { search: '', priority: 'all', status: 'all', projectId: 'all', sortBy: 'sort_order', sortDir: 'asc' };
let taskModalOpen = false; // 任务模态框开关(null 任务=新建;modalTaskId 非 null=编辑)
let modalTaskId = null;   // 任务模态框正在编辑的任务 id
let detailTaskId = null;  // 详情面板任务 id
let projectsOpen = false;
let archiveOpen = false;
let exportOpen = false;
let dragTaskId = null;
let eventModal = null;    // 日历事件弹窗:{id} 编辑 / {date:'YYYY-MM-DD'} 新建
let dayEventsModal = null; // 当日事件列表弹窗:{date:'YYYY-MM-DD'}
let dayEvTab = 'list';    // 当日事件弹窗标签:'list'(事件列表) | 'new'(新建事件)
let pendingDayReturn = null; // 从当日事件弹窗进入编辑弹窗的返回状态:{date:'YYYY-MM-DD'},编辑关闭时还原当日弹窗
let calDateCache = new Map(); // 农历计算缓存 y-m-d -> info

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- 时间工具(秒时间戳,本地时区) ----------------
function tsToDateInput(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateInputToTs(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}
function fmtShortDate(ts) {
  const d = new Date(ts * 1000);
  if (lang === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
}
function fmtFullDate(ts) {
  const d = new Date(ts * 1000);
  if (lang === 'zh') return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function todayStartTs() {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}
/** 截止日期展示:今天(橙)/ 明天 / 逾期(红,仅未完成)/ 普通日期 */
function deadlineInfo(task) {
  if (!task.deadline) return null;
  const t0 = todayStartTs();
  const d = task.deadline;
  if (d >= t0 && d < t0 + 86400) return { text: T('today'), warn: true, overdue: false };
  if (d >= t0 + 86400 && d < t0 + 2 * 86400) return { text: T('tomorrow'), warn: false, overdue: false };
  if (d < t0) return { text: fmtShortDate(d), warn: false, overdue: task.status !== 'done' };
  return { text: fmtShortDate(d), warn: false, overdue: false };
}

// ---------------- 数据访问 ----------------
function liveTasks() { return state.todoTasks.filter((t) => !t.archived); }
function archivedTasks() { return state.todoTasks.filter((t) => t.archived); }
function taskById(id) { return state.todoTasks.find((t) => t.id === id) || null; }
function projectById(id) { return state.todoProjects.find((p) => p.id === id) || null; }

function upsertTask(task) {
  const i = state.todoTasks.findIndex((t) => t.id === task.id);
  if (i >= 0) state.todoTasks[i] = task; else state.todoTasks.push(task);
  saveState();
}
function removeTask(id) {
  state.todoTasks = state.todoTasks.filter((t) => t.id !== id);
  saveState();
}
function upsertProject(proj) {
  const i = state.todoProjects.findIndex((p) => p.id === proj.id);
  if (i >= 0) state.todoProjects[i] = proj; else state.todoProjects.push(proj);
  saveState();
}
function removeProject(id) {
  state.todoProjects = state.todoProjects.filter((p) => p.id !== id);
  for (const t of state.todoTasks) if (t.projectId === id) t.projectId = '';
  saveState();
}

// ---------------- 筛选 + 排序 ----------------
function filteredTasks() {
  let list = [...liveTasks()];
  const q = filters.search.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }
  if (filters.priority !== 'all') list = list.filter((t) => t.priority === filters.priority);
  if (filters.status !== 'all') list = list.filter((t) => t.status === filters.status);
  if (filters.projectId === 'none') list = list.filter((t) => !t.projectId);
  else if (filters.projectId !== 'all') list = list.filter((t) => t.projectId === filters.projectId);
  list.sort((a, b) => {
    let cmp = 0;
    if (filters.sortBy === 'sort_order') cmp = a.sort - b.sort;
    else if (filters.sortBy === 'deadline') cmp = (a.deadline ?? Infinity) - (b.deadline ?? Infinity);
    else if (filters.sortBy === 'priority') cmp = PRIORITY_CONFIG[b.priority].order - PRIORITY_CONFIG[a.priority].order;
    else if (filters.sortBy === 'created_at') cmp = a.createdAt - b.createdAt;
    return filters.sortDir === 'desc' ? -cmp : cmp;
  });
  return list;
}

// ---------------- 渲染入口 ----------------
export function renderTodoTool(container) {
  if (!container) return;
  // 恢复偏好(视图模式 / 语言)
  try { view = localStorage.getItem('todoViewMode') || 'list'; } catch (e) { view = 'list'; }
  if (view !== 'list' && view !== 'kanban' && view !== 'calendar') view = 'list';
  calCursor = new Date(); // 每次进入重置日历到当月
  calView = 'month';      // 每次进入回到月视图
  pendingDayReturn = null; // 清掉可能残留的「当日弹窗→编辑」返回状态
  try { lang = localStorage.getItem('todoLang') || 'zh'; } catch (e) { lang = 'zh'; }
  if (lang !== 'zh' && lang !== 'en') lang = 'zh';
  container.innerHTML = '';
  rootEl = document.createElement('div');
  rootEl.className = 'todo-root';
  container.appendChild(rootEl);
  render();
}

function render() {
  if (!rootEl) return;
  rootEl.innerHTML = '';
  rootEl.appendChild(renderHeader());
  if (view === 'list') rootEl.appendChild(renderFiltersBar());
  const content = document.createElement('div');
  content.className = 'todo-content';
  content.appendChild(view === 'kanban' ? renderKanban() : (view === 'calendar' ? renderCalendar() : renderList()));
  rootEl.appendChild(content);
  if (view === 'list') rootEl.appendChild(renderProgressBar());

  // 浮层(模态框)
  if (taskModalOpen) rootEl.appendChild(renderTaskModal());
  else if (detailTaskId !== null) rootEl.appendChild(renderDetailPanel());
  if (projectsOpen) rootEl.appendChild(renderProjectsModal());
  if (archiveOpen) rootEl.appendChild(renderArchiveModal());
  if (eventModal) rootEl.appendChild(renderEventModal());
  if (dayEventsModal) rootEl.appendChild(renderDayEventsModal());
}

// ---------------- 年度事件提醒(生日每年提醒;公历/农历) ----------------
/**
 * 事件今年提醒日期(YYYY-MM-DD):生日 → 每年该月日;其余事件返回 null(按录入日期)
 * @returns {string|null}
 */
function eventRemindDate(ev) {
  if (!ev || !ev.date) return null;
  const nowY = new Date().getFullYear();
  if (ev.type === 'birthday') {
    if (ev.calendar === 'lunar') {
      const mm = parseInt(ev.date.slice(5, 7), 10);
      const dd = parseInt(ev.date.slice(8, 10), 10);
      if (!mm || !dd) return null;
      const r = lunarMonthDayToSolar(nowY, mm, dd, false);
      if (!r) return null;
      return `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`;
    }
    return `${nowY}-${ev.date.slice(5, 7)}-${ev.date.slice(8, 10)}`;
  }
  return null;
}

/** 构建 header 提醒:今日待办 / 今日生日 / 3 日内生日(含悬停详情行) */
function buildReminders() {
  const parts = [];
  const detail = [];
  const t0 = todayStartTs();
  // 今日待办:今天截止且未完成
  const todayTasks = liveTasks().filter((t) => t.deadline && t.status !== 'done' && t.deadline >= t0 && t.deadline < t0 + 86400);
  if (todayTasks.length) {
    parts.push(T('remindTodoToday', todayTasks.length));
    detail.push(T('remindTodoTodayTitle') + ':');
    for (const t of todayTasks) detail.push('  ☐ ' + t.title);
  }
  // 生日事件
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const bToday = [];
  const b3d = [];
  for (const ev of state.todoEvents || []) {
    if (ev.type !== 'birthday') continue;
    const d = eventRemindDate(ev);
    if (!d) continue;
    if (d === todayStr) { bToday.push(ev); continue; }
    // 未来 3 天(明天起)
    for (let i = 1; i <= 3; i++) {
      const dd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
      if (d === key) { b3d.push({ ev, date: d }); break; }
    }
  }
  const bdTag = (ev) => (ev.calendar === 'lunar' ? ` (${T('lunar')})` : '');
  if (bToday.length) {
    parts.push(T('remindBdayToday', bToday.length));
    detail.push('🎂 ' + T('remindBdayTodayTitle') + ':');
    for (const ev of bToday) detail.push('  🎂 ' + ev.title + bdTag(ev));
  }
  if (b3d.length) {
    parts.push(T('remindBday3d', b3d.length));
    detail.push('🎂 ' + T('remindBday3dTitle') + ':');
    for (const { ev, date } of b3d) {
      const ts = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000);
      detail.push(`  🎂 ${ev.title} (${fmtShortDate(ts)})${bdTag(ev)}`);
    }
  }
  if (!parts.length) return null;
  return { text: parts.join('，'), detail: detail.join('\n') };
}

// ---------------- 头部 ----------------
function renderHeader() {
  const head = document.createElement('div');
  head.className = 'todo-header';
  const all = liveTasks();
  const done = all.filter((t) => t.status === 'done').length;
  const reminders = buildReminders();
  head.innerHTML = `
    <div class="todo-header-left">
      <div class="todo-title">${T('title')}</div>
      <div class="todo-sub">${T('completed', done, all.length)}${reminders ? `<span class="todo-reminder" title="${escHtml(reminders.detail)}">${escHtml(reminders.text)}</span>` : ''}</div>
    </div>
    <div class="todo-header-right">
      <button class="btn" data-action="lang" title="${T('langTitle')}">${T('langBtn')}</button>
      <div class="todo-seg" id="todo-view-seg">
        <button class="todo-seg-btn${view === 'list' ? ' on' : ''}" data-view="list" title="${T('listView')}">☰ ${T('viewList')}</button>
        <button class="todo-seg-btn${view === 'kanban' ? ' on' : ''}" data-view="kanban" title="${T('kanbanView')}">⊞ ${T('viewKanban')}</button>
        <button class="todo-seg-btn${view === 'calendar' ? ' on' : ''}" data-view="calendar" title="${T('calendarView')}">📅 ${T('viewCalendar')}</button>
      </div>
      <button class="btn" data-action="projects" title="${T('manageProjectsTitle')}">◆ ${T('projects')}</button>
      <button class="btn" data-action="archive" title="${T('archiveTitle')}">📦 ${T('archive')}</button>
      <div style="position:relative">
        <button class="btn" data-action="export" title="${T('exportTitle')}">↑ ${T('exportBtn')}</button>
        ${exportOpen ? `
        <div class="todo-dropdown">
          <button class="todo-drop-item" data-export="csv">${T('csvFile')}</button>
          <button class="todo-drop-item" data-export="json">${T('jsonFile')}</button>
        </div>` : ''}
      </div>
      <button class="btn" data-action="import" title="${T('importTitle')}">↓ ${T('importBtn')}</button>
      <button class="btn primary" data-action="new" title="${T('newTaskTitle')}">+ ${T('newTask')}</button>
    </div>`;
  head.querySelector('#todo-view-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    try { localStorage.setItem('todoViewMode', view); } catch (err) { /* ignore */ }
    render();
  });
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const act = b.dataset.action;
    if (act === 'new') { taskModalOpen = true; modalTaskId = null; detailTaskId = null; render(); }
    else if (act === 'projects') { projectsOpen = true; exportOpen = false; render(); }
    else if (act === 'archive') { archiveOpen = true; exportOpen = false; render(); }
    else if (act === 'export') exportOpen = !exportOpen, render();
    else if (act === 'import') { exportOpen = false; importTasks(); }
    else if (act === 'lang') {
      lang = lang === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('todoLang', lang); } catch (err) { /* ignore */ }
      render();
    }
  });
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    exportOpen = false;
    exportTasks(b.dataset.export);
    render();
  });
  return head;
}

// ---------------- 筛选栏 ----------------
function renderFiltersBar() {
  const bar = document.createElement('div');
  bar.className = 'todo-filters';
  const hasProjects = state.todoProjects.length > 0;
  bar.innerHTML = `
    <input class="todo-search" type="text" placeholder="${T('searchPh')}" value="${escHtml(filters.search)}">
    <select class="todo-select" data-f="priority">
      <option value="all">${T('allPriority')}</option>
      ${Object.keys(PRIORITY_CONFIG).map((p) => `<option value="${p}"${filters.priority === p ? ' selected' : ''}>${priLabel(p)}</option>`).join('')}
    </select>
    <select class="todo-select" data-f="status">
      <option value="all">${T('allStatus')}</option>
      ${Object.keys(STATUS_CONFIG).map((s) => `<option value="${s}"${filters.status === s ? ' selected' : ''}>${stLabel(s)}</option>`).join('')}
    </select>
    ${hasProjects ? `
    <select class="todo-select" data-f="projectId">
      <option value="all">${T('allProjects')}</option>
      <option value="none"${filters.projectId === 'none' ? ' selected' : ''}>${T('noProject')}</option>
      ${state.todoProjects.map((p) => `<option value="${p.id}"${filters.projectId === p.id ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}
    </select>` : ''}
    <select class="todo-select" data-f="sort">
      <option value="sort_order:asc"${filters.sortBy === 'sort_order' && filters.sortDir === 'asc' ? ' selected' : ''}>${T('sortManual')}</option>
      <option value="priority:desc"${filters.sortBy === 'priority' && filters.sortDir === 'desc' ? ' selected' : ''}>${T('sortPriorityDesc')}</option>
      <option value="deadline:asc"${filters.sortBy === 'deadline' && filters.sortDir === 'asc' ? ' selected' : ''}>${T('sortDeadlineAsc')}</option>
      <option value="created_at:desc"${filters.sortBy === 'created_at' && filters.sortDir === 'desc' ? ' selected' : ''}>${T('sortNewest')}</option>
      <option value="created_at:asc"${filters.sortBy === 'created_at' && filters.sortDir === 'asc' ? ' selected' : ''}>${T('sortOldest')}</option>
    </select>
    ${isFilterActive() ? `<button class="btn" data-f-clear>${T('clear')}</button>` : ''}
    <div class="todo-filters-spacer"></div>
    <div class="todo-hint">${T('hint')}</div>`;
  bar.querySelector('input.todo-search').addEventListener('input', (e) => {
    filters.search = e.target.value;
    // 仅重绘内容区,保持搜索框焦点
    const content = rootEl.querySelector('.todo-content');
    if (content) {
      content.innerHTML = '';
      content.appendChild(view === 'kanban' ? renderKanban() : (view === 'calendar' ? renderCalendar() : renderList()));
    }
  });
  bar.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-f]');
    if (!sel) return;
    const f = sel.dataset.f;
    if (f === 'sort') {
      const [sortBy, sortDir] = sel.value.split(':');
      filters.sortBy = sortBy; filters.sortDir = sortDir;
    } else {
      filters[f] = sel.value === 'all' ? 'all' : (f === 'projectId' && sel.value === 'none' ? 'none' : sel.value);
    }
    render();
  });
  bar.addEventListener('click', (e) => {
    if (!e.target.closest('[data-f-clear]')) return;
    filters = { search: '', priority: 'all', status: 'all', projectId: 'all', sortBy: 'sort_order', sortDir: 'asc' };
    render();
  });
  return bar;
}
function isFilterActive() {
  return !!(filters.search || filters.priority !== 'all' || filters.status !== 'all' || filters.projectId !== 'all');
}

// ---------------- 列表视图 ----------------
function renderList() {
  const wrap = document.createElement('div');
  wrap.className = 'todo-list-wrap';
  const list = filteredTasks();
  if (!list.length) {
    wrap.innerHTML = `
      <div class="todo-empty">
        <div class="todo-empty-ico">📋</div>
        <div class="todo-empty-title">${liveTasks().length ? T('noMatching') : T('noTasks')}</div>
        <div class="todo-empty-desc">${liveTasks().length ? T('adjustFilter') : T('clickNewTask')}</div>
      </div>`;
    return wrap;
  }
  list.forEach((task, idx) => {
    const card = renderTaskCard(task);
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      dragTaskId = task.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(task.id));
    });
    card.addEventListener('dragend', () => { dragTaskId = null; });
    card.addEventListener('dragover', (e) => { e.preventDefault(); });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
      if (!dragId || dragId === task.id) return;
      reorderInList(dragId, task.id);
    });
    wrap.appendChild(card);
  });
  return wrap;
}

/** 把 dragId 移到 targetId 前(仅对当前筛选列表生效,回写原任务 sort) */
function reorderInList(dragId, targetId) {
  const list = filteredTasks();
  const fromIdx = list.findIndex((t) => t.id === dragId);
  const toIdx = list.findIndex((t) => t.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const reordered = [...list];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  reordered.forEach((t, i) => {
    const orig = taskById(t.id);
    if (orig && orig.sort !== i) { orig.sort = i; orig.updatedAt = now(); }
  });
  saveState();
  render();
}

// ---------------- 看板视图 ----------------
function renderKanban() {
  const board = document.createElement('div');
  board.className = 'todo-kanban';
  for (const col of KANBAN_COLS) {
    const colEl = document.createElement('div');
    colEl.className = 'todo-kanban-col';
    const tasks = liveTasks().filter((t) => t.status === col.status);
    colEl.innerHTML = `
      <div class="todo-kanban-head">
        <span class="todo-kanban-dot" style="background:${col.color}"></span>
        <span class="todo-kanban-title">${stLabel(col.status)}</span>
        <span class="todo-kanban-count">${tasks.length}</span>
      </div>`;
    const body = document.createElement('div');
    body.className = 'todo-kanban-body';
    body.addEventListener('dragover', (e) => e.preventDefault());
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
      if (!dragId) return;
      const t = taskById(dragId);
      if (t && t.status !== col.status) {
        t.status = col.status;
        t.updatedAt = now();
        saveState();
      }
      dragTaskId = null;
      render();
    });
    for (const task of tasks) {
      const card = renderTaskCard(task, true);
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        dragTaskId = task.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(task.id));
      });
      card.addEventListener('dragend', () => { dragTaskId = null; });
      body.appendChild(card);
    }
    if (!tasks.length) {
      const ph = document.createElement('div');
      ph.className = 'todo-kanban-placeholder';
      ph.textContent = T('dropHere');
      body.appendChild(ph);
    }
    colEl.appendChild(body);
    board.appendChild(colEl);
  }
  return board;
}

// ---------------- 日历视图(月历,周一开头) ----------------
function monthLabel(y, m) {
  if (lang === 'zh') return `${y}年${m + 1}月`;
  return `${MONTHS_EN[m]} ${y}`;
}
function renderCalendar() {
  if (!calCursor) calCursor = new Date();
  if (calView === 'year') return renderYearCalendar();
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  // 网格范围:当月首日所在周的周一 → 当月末日所在周的周日
  const calStart = new Date(y, m, 1);
  calStart.setDate(calStart.getDate() - ((calStart.getDay() + 6) % 7));
  const calEnd = new Date(y, m + 1, 0);
  calEnd.setDate(calEnd.getDate() + (6 - ((calEnd.getDay() + 6) % 7)));

  // 有截止日期的任务按日归组(内部 key 用 y-m-d)
  const dayMap = new Map();
  for (const t of liveTasks()) {
    if (!t.deadline) continue;
    const d = new Date(t.deadline * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(t);
  }
  // 日历事件按「今年提醒日期」归组(生日每年提醒;农历生日换算到今年;其余按录入日期)
  const eventMap = new Map();
  for (const ev of state.todoEvents || []) {
    const k = ev.type === 'birthday' ? eventRemindDate(ev) : (ev.date || null);
    if (!k) continue;
    if (!eventMap.has(k)) eventMap.set(k, []);
    eventMap.get(k).push(ev);
  }
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const wrap = document.createElement('div');
  wrap.className = 'todo-calendar';
  // 导航头
  const head = document.createElement('div');
  head.className = 'todo-cal-head';
  head.innerHTML = `
    <button class="btn" data-cal="prev" title="${T('prevMonth')}">←</button>
    <button class="todo-cal-title" data-cal="year" title="${T('viewYear')}">${escHtml(monthLabel(y, m))}</button>
    <button class="btn" data-cal="next" title="${T('nextMonth')}">→</button>`;
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]');
    if (!b) return;
    if (b.dataset.cal === 'year') { calView = 'year'; }
    else { calCursor = new Date(y, m + (b.dataset.cal === 'prev' ? -1 : 1), 1); }
    const content = rootEl.querySelector('.todo-content');
    if (content) { content.innerHTML = ''; content.appendChild(renderCalendar()); }
  });
  wrap.appendChild(head);
  // 星期表头
  const wd = document.createElement('div');
  wd.className = 'todo-cal-week';
  for (let i = 0; i < 7; i++) {
    const c = document.createElement('div');
    c.className = 'todo-cal-wd';
    c.textContent = T('week' + ((i + 1) % 7));
    wd.appendChild(c);
  }
  wrap.appendChild(wd);
  // 网格
  const grid = document.createElement('div');
  grid.className = 'todo-cal-grid';
  for (let d = new Date(calStart); d <= calEnd; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'todo-cal-cell' + (d.getMonth() === m ? '' : ' out') + (key === todayKey ? ' today' : '');
    // 第一行:公历日期(左上)+ 农历 2 字(紧跟)+ 节日/节气(行尾右对齐,格子右上角)
    const topRow = document.createElement('div');
    topRow.className = 'todo-cal-top';
    const dayNum = document.createElement('span');
    dayNum.className = 'todo-cal-day';
    dayNum.textContent = `${d.getMonth() + 1}.${d.getDate()}`;
    topRow.appendChild(dayNum);
    // 农历(带缓存):只显示「日」(2 字,初一/廿五/三十)
    const cacheKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let info = calDateCache.get(cacheKey);
    if (!info) { info = getLunarInfo(d.getFullYear(), d.getMonth() + 1, d.getDate()); calDateCache.set(cacheKey, info); }
    const lunarDay = formatLunarDay(info.lunarDay);
    const fullLunarTitle = '农历' + formatLunarMonth(info.lunarMonth, info.isLeapMonth) + lunarDay + (info.term ? ' · ' + info.term : '') + (info.holiday ? ' · ' + info.holiday : '');
    const lunarEl = document.createElement('span');
    lunarEl.className = 'todo-cal-lunar';
    lunarEl.textContent = formatLunarMonth(info.lunarMonth, info.isLeapMonth) + lunarDay;
    lunarEl.title = fullLunarTitle;
    topRow.appendChild(lunarEl);
    // 节日/24节气:第一行尾部(右对齐到格子右上角)
    if (info.holiday || info.term) {
      const festEl = document.createElement('span');
      festEl.className = 'todo-cal-fest';
      festEl.textContent = info.holiday || info.term;
      festEl.title = fullLunarTitle;
      topRow.appendChild(festEl);
    }
    cell.appendChild(topRow);
    // 点击第一行日期文字 → 打开当日事件列表弹窗
    topRow.addEventListener('click', (e) => {
      e.stopPropagation();
      dayEventsModal = { date: dayKey };
      dayEvTab = 'list';
      render();
    });
    // 日历事件 chips(类型图标+标题;点击查看/编辑,右键菜单)—— 自第 2 行起
    const dayEvents = eventMap.get(dayKey) || [];
    dayEvents.slice(0, 3).forEach((ev) => {
      const et = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
      const chip = document.createElement('div');
      chip.className = 'todo-cal-event';
      chip.style.color = et.color;
      chip.style.borderColor = et.color + '44';
      chip.style.background = et.color + '1f';
      chip.innerHTML = `<span>${et.icon}</span><span class="todo-cal-event-text">${escHtml(ev.title)}</span>`;
      const calTag = ev.type === 'birthday' ? (ev.calendar === 'lunar' ? ` (${T('lunar')})` : ` (${T('solar')})`) : '';
      chip.title = `${T('ev' + ev.type.charAt(0).toUpperCase() + ev.type.slice(1))}: ${ev.title}${calTag}${ev.note ? '\n' + ev.note : ''}`;
      chip.addEventListener('click', (e) => { e.stopPropagation(); eventModal = { id: ev.id }; render(); });
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: T('editEvent'), onClick: () => { eventModal = { id: ev.id }; render(); } },
          { label: T('deleteEvent'), danger: true, onClick: () => {
            confirmDialog({ title: T('deleteEvent'), message: T('evConfirmDel', ev.title), okText: T('delete'), danger: true, onOk: () => { removeEvent(ev.id); render(); } });
          } },
        ]);
      });
      cell.appendChild(chip);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'todo-cal-more';
      more.textContent = T('more', dayEvents.length - 3);
      cell.appendChild(more);
    }
    // 任务 chips(有截止日期)
    const dayTasks = dayMap.get(key) || [];
    dayTasks.slice(0, 3).forEach((t) => {
      const pc = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
      const chip = document.createElement('div');
      chip.className = 'todo-cal-task';
      chip.style.color = pc.color;
      chip.style.borderColor = pc.color + '44';
      chip.style.background = pc.color + '22';
      chip.textContent = t.title;
      chip.title = t.title;
      chip.addEventListener('click', (e) => { e.stopPropagation(); openDetail(t.id); });
      cell.appendChild(chip);
    });
    if (dayTasks.length > 3) {
      const more = document.createElement('div');
      more.className = 'todo-cal-more';
      more.textContent = T('more', dayTasks.length - 3);
      cell.appendChild(more);
    }
    // 右键单元格 → 新建事件
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: T('addEventMenu'), onClick: () => { eventModal = { date: dayKey }; render(); } },
      ]);
    });
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  return wrap;
}

// ---------------- 年视图(12 个月格子,3 列 × 4 行;点击月份返回月视图) ----------------
function renderYearCalendar() {
  const y = calCursor ? calCursor.getFullYear() : new Date().getFullYear();
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  // 按月统计:事件按今年提醒日期归月(生日换算今年);任务按截止日期归月
  const evCount = new Array(12).fill(0), taskCount = new Array(12).fill(0);
  for (const ev of state.todoEvents || []) {
    const k = ev.type === 'birthday' ? eventRemindDate(ev) : (ev.date || null);
    if (!k) continue;
    const yy = parseInt(k.slice(0, 4), 10), mm = parseInt(k.slice(5, 7), 10);
    if (yy === y && mm >= 1 && mm <= 12) evCount[mm - 1]++;
  }
  for (const t of liveTasks()) {
    if (!t.deadline) continue;
    const d = new Date(t.deadline * 1000);
    if (d.getFullYear() === y) taskCount[d.getMonth()]++;
  }
  const wrap = document.createElement('div');
  wrap.className = 'todo-calendar';
  const head = document.createElement('div');
  head.className = 'todo-cal-head';
  head.innerHTML = `
    <button class="btn" data-cal="prev" title="${T('prevMonth')}">←</button>
    <button class="todo-cal-title" data-cal="today" title="${T('clickToMonth')}">${lang === 'zh' ? `${y}年` : String(y)}<small class="todo-cal-yr-hint">${T('clickToMonth')}</small></button>
    <button class="btn" data-cal="next" title="${T('nextMonth')}">→</button>`;
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]');
    if (!b) return;
    if (b.dataset.cal === 'today') { calCursor = new Date(); calView = 'month'; }
    else { calCursor = new Date(y + (b.dataset.cal === 'prev' ? -1 : 1), 0, 1); }
    const content = rootEl.querySelector('.todo-content');
    if (content) { content.innerHTML = ''; content.appendChild(renderCalendar()); }
  });
  wrap.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'todo-cal-year-grid';
  for (let m = 0; m < 12; m++) {
    const cell = document.createElement('div');
    cell.className = 'todo-cal-year-cell' + (y === curY && m === curM ? ' current' : '');
    cell.title = T('viewMonth', lang === 'zh' ? `${m + 1}月` : MONTHS_EN[m]);
    const name = document.createElement('div');
    name.className = 'todo-cal-year-month';
    name.textContent = lang === 'zh' ? `${m + 1}月` : MONTHS_EN[m];
    cell.appendChild(name);
    const stat = document.createElement('div');
    stat.className = 'todo-cal-year-stat';
    stat.textContent = T('yearStat', evCount[m], taskCount[m]);
    cell.appendChild(stat);
    cell.addEventListener('click', () => {
      calCursor = new Date(y, m, 1);
      calView = 'month';
      const content = rootEl.querySelector('.todo-content');
      if (content) { content.innerHTML = ''; content.appendChild(renderCalendar()); }
    });
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  return wrap;
}
function upsertEvent(ev) {
  const i = state.todoEvents.findIndex((x) => x.id === ev.id);
  if (i >= 0) state.todoEvents[i] = ev; else state.todoEvents.push(ev);
  saveState();
}
function removeEvent(id) {
  state.todoEvents = state.todoEvents.filter((x) => x.id !== id);
  saveState();
}

// 事件表单(body 内容):新建(existing=null,presetDate 预填公历日期)或编辑;保存成功后回调 onSaved。
// 供事件编辑弹窗与「当日事件弹窗·新建事件标签」复用。
function buildEventForm(host, existing, presetDate, onSaved) {
  const isNew = !existing;
  const draft = { type: existing ? existing.type : 'todo', title: existing ? existing.title : '', note: existing ? existing.note : '', calendar: existing ? (existing.calendar || 'solar') : 'solar', _solarDate: '' };
  // 日期框「所见即所存」:
  // - 公历生日 / 非生日:输入框显示并保存公历日期;旁侧农历提示显示该公历日对应的农历。
  // - 农历生日:输入框显示并保存「农历月日」(YYYY 仅占位),eventRemindDate 每年按该农历月日换算公历提醒;
  //   新建时日历方格传入公历日期(如点击 8-17,当天农历七月初五),切到农历时即时换算为农历月日(07-05)显示,
  //   每年农历七月初五就是这条生日的准确日期。
  // draft._solarDate 始终记录当前输入框对应的公历基准,用于切回公历时还原。
  const rawDate = existing ? existing.date : (presetDate || '');
  let initSolar = rawDate;
  if (existing && existing.type === 'birthday' && existing.calendar === 'lunar') {
    const yy = parseInt(rawDate.slice(0, 4), 10), mm = parseInt(rawDate.slice(5, 7), 10), dd = parseInt(rawDate.slice(8, 10), 10);
    if (yy && mm && dd) {
      const r = lunarMonthDayToSolar(yy, mm, dd, false);
      if (r) initSolar = `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`;
    }
  }
  draft._solarDate = initSolar;
  const initShown = (draft.type === 'birthday' && draft.calendar === 'lunar') ? rawDate : initSolar;
  host.innerHTML = `
    <div class="todo-field"><label class="todo-label">${T('evDateLabel')}</label>
      <div class="todo-date-wrap">
        <input class="todo-input" type="date" data-ev-date value="${escHtml(initShown)}">
        <span class="todo-date-lunar" data-ev-lunar></span>
      </div></div>
    <div class="todo-field"><label class="todo-label">${T('evTypeLabel')}</label>
      <div class="todo-pri-row">
        <select class="todo-input todo-ev-bday" data-ev-bday>
          <option value="solar">${EVENT_TYPES.birthday.icon} ${T('bdaySolar')}</option>
          <option value="lunar">${EVENT_TYPES.birthday.icon} ${T('bdayLunar')}</option>
        </select>
        ${Object.keys(EVENT_TYPES).filter((tp) => tp !== 'birthday').map((tp) => `
        <button class="todo-pri-opt${draft.type === tp ? ' on' : ''}" data-ev-type="${tp}" style="${draft.type === tp ? `border-color:${EVENT_TYPES[tp].color};color:${EVENT_TYPES[tp].color};background:${EVENT_TYPES[tp].color}22` : ''}">${EVENT_TYPES[tp].icon} ${T('ev' + tp.charAt(0).toUpperCase() + tp.slice(1))}</button>`).join('')}
      </div></div>
    <div class="todo-field"><label class="todo-label">${T('evTitleLabel')}</label>
      <input class="todo-input" data-ev-title value="${escHtml(draft.title)}" placeholder="${T('evTitlePh')}" autofocus></div>
    <div class="todo-field"><label class="todo-label">${T('evNoteLabel')}</label>
      <textarea class="todo-input todo-textarea" data-ev-note rows="3" placeholder="${T('evNotePh')}">${escHtml(draft.note)}</textarea></div>
    <div class="todo-form-actions"><button class="btn primary" data-ev-save>${isNew ? T('newEvent') : T('saveChanges')}</button></div>`;
  const bdaySel = host.querySelector('[data-ev-bday]');
  bdaySel.value = draft.type === 'birthday' ? draft.calendar : 'solar';
  const dateInput = host.querySelector('[data-ev-date]');
  const lunarEl = host.querySelector('[data-ev-lunar]');
  const isLunarMode = () => draft.type === 'birthday' && draft.calendar === 'lunar';
  // 农历提示:与日历格子风格一致显示「农历月+日」(如「农历七月初五」),title 附节气/节日
  const paintLunar = () => {
    const v = dateInput.value;
    if (!v) { lunarEl.textContent = ''; lunarEl.title = ''; return; }
    const p = v.split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) { lunarEl.textContent = ''; lunarEl.title = ''; return; }
    try {
      if (isLunarMode()) {
        lunarEl.textContent = '农历' + formatLunarMonth(p[1], false) + formatLunarDay(p[2]);
        lunarEl.title = '农历' + formatLunarMonth(p[1], false) + formatLunarDay(p[2]);
      } else {
        const li = getLunarInfo(p[0], p[1], p[2]);
        lunarEl.textContent = '农历' + formatLunarMonth(li.lunarMonth, li.isLeapMonth) + formatLunarDay(li.lunarDay);
        lunarEl.title = '农历' + formatLunarMonth(li.lunarMonth, li.isLeapMonth) + formatLunarDay(li.lunarDay)
          + (li.term ? ' · ' + li.term : '') + (li.holiday ? ' · ' + li.holiday : '');
      }
    } catch (e) { lunarEl.textContent = ''; lunarEl.title = ''; }
  };
  // 按历法换算输入框值(公历↔农历),保证「所见即所存」:农历生日输入框显示的就是将保存的农历月日
  const applyCalendar = (cal) => {
    if (cal === 'lunar') {
      const p = draft._solarDate.split('-').map(Number);
      if (p.length === 3 && p[0] && p[1] && p[2]) {
        const li = getLunarInfo(p[0], p[1], p[2]);
        dateInput.value = `${p[0]}-${String(li.lunarMonth).padStart(2, '0')}-${String(li.lunarDay).padStart(2, '0')}`;
      }
    } else {
      dateInput.value = draft._solarDate;
    }
    paintLunar();
  };
  // 高亮统一由 paint 函数管理(class + 内联样式),避免 class 切换后旧内联边框残留
  const paintTypeBtns = () => {
    host.querySelectorAll('[data-ev-type]').forEach((b) => {
      const on = draft.type === b.dataset.evType;
      const c = EVENT_TYPES[b.dataset.evType].color;
      b.classList.toggle('on', on);
      b.style.borderColor = on ? c : '';
      b.style.color = on ? c : '';
      b.style.background = on ? c + '22' : '';
    });
  };
  const paintBdaySel = () => {
    const on = draft.type === 'birthday';
    bdaySel.classList.toggle('on', on);
    bdaySel.style.borderColor = on ? 'var(--accent)' : '';
    bdaySel.style.color = on ? 'var(--accent)' : '';
  };
  host.querySelectorAll('[data-ev-type]').forEach((b) => b.addEventListener('click', () => {
    draft.type = b.dataset.evType;
    // 非生日强制公历;下拉回到默认「公历生日」
    if (draft.type !== 'birthday') draft.calendar = 'solar';
    bdaySel.value = draft.calendar;
    applyCalendar(draft.calendar);
    paintTypeBtns();
    paintBdaySel();
  }));
  bdaySel.addEventListener('change', () => {
    draft.calendar = bdaySel.value;
    draft.type = 'birthday';
    applyCalendar(draft.calendar);
    paintTypeBtns();
    paintBdaySel();
  });
  const onDateInput = () => {
    if (isLunarMode()) {
      // 农历模式:输入框即农历月日,换算回公历基准(闰月等换算失败则保持旧基准)
      const p = dateInput.value.split('-').map(Number);
      if (p.length === 3 && p[0] && p[1] && p[2]) {
        const r = lunarMonthDayToSolar(p[0], p[1], p[2], false);
        if (r) draft._solarDate = `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`;
      }
    } else {
      draft._solarDate = dateInput.value;
    }
    paintLunar();
  };
  dateInput.addEventListener('input', onDateInput);
  dateInput.addEventListener('change', onDateInput);
  paintTypeBtns();
  paintBdaySel();
  paintLunar();
  host.querySelector('[data-ev-title]').addEventListener('input', (e) => { draft.title = e.target.value; });
  host.querySelector('[data-ev-note]').addEventListener('input', (e) => { draft.note = e.target.value; });
  host.querySelector('[data-ev-save]').addEventListener('click', () => {
    // 输入框即存储值:公历生日/非生日 = 公历日期;农历生日 = 农历月日(切下拉时已即时换算,所见即所存)
    const date = host.querySelector('[data-ev-date]').value;
    const title = draft.title.trim();
    if (!title) { toast(T('evTitleRequired'), 'warn'); return; }
    if (!date) { toast(T('evTitleRequired'), 'warn'); return; }
    if (isNew) {
      upsertEvent({ id: uid('e'), date, type: draft.type, title, note: draft.note.trim(), calendar: draft.type === 'birthday' ? draft.calendar : 'solar', createdAt: now(), updatedAt: now() });
    } else {
      existing.date = date; existing.type = draft.type; existing.title = title;
      existing.note = draft.note.trim();
      if (existing.type === 'birthday') existing.calendar = draft.calendar; else existing.calendar = 'solar';
      existing.updatedAt = now();
      saveState();
    }
    toast(T('evSaved'), 'ok');
    if (onSaved) onSaved();
  });
  return host;
}

function renderEventModal() {
  const existing = eventModal && eventModal.id ? state.todoEvents.find((x) => x.id === eventModal.id) : null;
  const isNew = !existing;
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  const box = document.createElement('div');
  box.className = 'todo-modal todo-modal-ev';
  const dateStr = existing ? existing.date : (eventModal && eventModal.date ? eventModal.date : '');
  const close = () => {
    eventModal = null;
    // 从当日事件弹窗进入的编辑:关闭时还原当日事件弹窗(事件列表),否则返回日历页
    if (pendingDayReturn) { dayEventsModal = pendingDayReturn; dayEvTab = 'list'; pendingDayReturn = null; }
    render();
  };
  box.innerHTML = `
    <div class="todo-modal-head">
      <h2 class="todo-modal-title">${isNew ? T('newEvent') : T('editEvent')}</h2>
      <button class="todo-icon-btn" data-close>✕</button>
    </div>
    <div class="todo-modal-body" data-ev-form></div>
    <div class="todo-modal-foot">
      ${!isNew ? `<button class="btn danger" data-ev-del>${T('deleteEvent')}</button>` : ''}
      <button class="btn" data-close>${T('cancel')}</button>
    </div>`;
  buildEventForm(box.querySelector('[data-ev-form]'), existing, dateStr, close);
  box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const delBtn = box.querySelector('[data-ev-del]');
  if (delBtn) delBtn.addEventListener('click', () => {
    confirmDialog({ title: T('deleteEvent'), message: T('evConfirmDel', existing.title), okText: T('delete'), danger: true, onOk: () => { removeEvent(existing.id); close(); } });
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  return ov;
}

// ---------------- 当日事件弹窗(点击日期格第一行;标签页:事件列表 / 新建事件) ----------------
function renderDayEventsModal() {
  const dateKey = dayEventsModal.date;
  const p = dateKey.split('-').map(Number);
  const info = getLunarInfo(p[0], p[1], p[2]);
  const dateLabel = lang === 'zh'
    ? `${p[0]}年${p[1]}月${p[2]}日 · ${formatLunarMonth(info.lunarMonth, info.isLeapMonth)}${formatLunarDay(info.lunarDay)}${info.term ? ' ' + info.term : ''}${info.holiday ? ' ' + info.holiday : ''}`
    : `${MONTHS_EN[p[1] - 1]} ${p[2]}, ${p[0]}`;
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  const box = document.createElement('div');
  box.className = 'todo-modal todo-modal-ev';
  const close = () => { dayEventsModal = null; dayEvTab = 'list'; render(); };
  const head = document.createElement('div');
  head.className = 'todo-modal-head';
  head.innerHTML = `<h2 class="todo-modal-title">${escHtml(dateLabel)}</h2><button class="todo-icon-btn" data-close>✕</button>`;
  box.appendChild(head);
  const tabs = document.createElement('div');
  tabs.className = 'todo-modal-tabs';
  box.appendChild(tabs);
  const body = document.createElement('div');
  body.className = 'todo-modal-body';
  box.appendChild(body);
  const evsOf = () => (state.todoEvents || []).filter((ev) => (ev.type === 'birthday' ? eventRemindDate(ev) : (ev.date || null)) === dateKey);
  const renderList = () => {
    body.innerHTML = '';
    const evs = evsOf();
    if (!evs.length) {
      const empty = document.createElement('div');
      empty.className = 'todo-day-empty';
      empty.textContent = T('dayEvEmpty');
      body.appendChild(empty);
      return;
    }
    evs.forEach((ev) => {
      const et = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
      const row = document.createElement('div');
      row.className = 'todo-day-ev';
      row.style.borderColor = et.color + '44';
      row.style.background = et.color + '1a';
      row.innerHTML = `
        <span class="todo-day-ev-icon">${et.icon}</span>
        <span class="todo-day-ev-main">
          <span class="todo-day-ev-title">${escHtml(ev.title)}${ev.type === 'birthday' ? (ev.calendar === 'lunar' ? ` <span class="todo-day-ev-cal">(${T('lunar')})</span>` : ` <span class="todo-day-ev-cal">(${T('solar')})</span>`) : ''}</span>
          ${ev.note ? `<span class="todo-day-ev-note">${escHtml(ev.note)}</span>` : ''}
        </span>
        <button class="todo-icon-btn" data-ev-del title="${T('deleteEvent')}">🗑</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-ev-del]')) return;
        // 进入编辑弹窗:记录返回状态,关闭当日弹窗后打开编辑
        pendingDayReturn = { date: dateKey };
        dayEventsModal = null;
        eventModal = { id: ev.id };
        render();
      });
      row.querySelector('[data-ev-del]').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog({ title: T('deleteEvent'), message: T('evConfirmDel', ev.title), okText: T('delete'), danger: true, onOk: () => { removeEvent(ev.id); renderList(); } });
      });
      body.appendChild(row);
    });
  };
  const paintTabs = () => {
    const evs = evsOf();
    tabs.innerHTML = `
      <button class="todo-tab-btn${dayEvTab === 'list' ? ' on' : ''}" data-evtab="list">${T('dayEvList', evs.length)}</button>
      <button class="todo-tab-btn${dayEvTab === 'new' ? ' on' : ''}" data-evtab="new">${T('newEvent')}</button>`;
    tabs.querySelectorAll('[data-evtab]').forEach((b) => b.addEventListener('click', () => {
      dayEvTab = b.dataset.evtab;
      renderBody();
    }));
  };
  const renderBody = () => {
    paintTabs();
    if (dayEvTab === 'new') {
      buildEventForm(body, null, dateKey, () => { dayEvTab = 'list'; render(); });
    } else {
      renderList();
    }
  };
  renderBody();
  box.querySelector('[data-close]').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  return ov;
}

// ---------------- 任务卡片 ----------------
function renderTaskCard(task, compact = false) {
  const card = document.createElement('div');
  card.className = `todo-card${task.status === 'done' ? ' done' : ''}`;
  card.setAttribute('data-task-id', task.id);
  const pri = PRIORITY_CONFIG[task.priority];
  const st = STATUS_CONFIG[task.status];
  const proj = task.projectId ? projectById(task.projectId) : null;
  const subs = task.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const dl = deadlineInfo(task);

  let html = `
    <div class="todo-card-row">
      <button class="todo-status-btn" data-t="status" title="${stLabel(task.status)} · ${T('clickToggle')}" style="border-color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--border)'};color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--text2)'}">${st.icon}</button>
      <div class="todo-card-main">
        <div class="todo-card-title-row">
          <span class="todo-card-title">${escHtml(task.title)}</span>
          <button class="todo-pri-btn" data-t="priority" title="${T('clickTogglePriority')}" style="color:${pri.color}">
            <span class="todo-pri-dot" style="background:${pri.color}"></span>${priLabel(task.priority)}
          </button>
        </div>
        ${proj ? `<div class="todo-card-proj"><span style="color:${proj.color};border-color:${proj.color}44;background:${proj.color}22">◆ ${escHtml(proj.name)}</span></div>` : ''}
        ${task.notes ? `<div class="todo-card-notes">${escHtml(task.notes)}</div>` : ''}`;

  if (subs.length) {
    html += `
      <div class="todo-card-subs">
        <div class="todo-card-sub-chips">
          ${subs.slice(0, 8).map((s) => `
            <button class="todo-sub-chip${s.done ? ' done' : ''}" data-t="sub" data-sub="${s.id}" title="${escHtml(s.title)}">
              <span>${s.done ? '●' : '○'}</span><span class="todo-sub-chip-text">${escHtml(s.title)}</span>
            </button>`).join('')}
        </div>
        <div class="todo-card-sub-bar">
          <div class="todo-card-sub-track"><div class="todo-card-sub-fill" style="width:${subs.length ? (doneSubs / subs.length) * 100 : 0}%"></div></div>
          <span>${doneSubs}/${subs.length}</span>
        </div>
      </div>`;
  }

  html += `
        <div class="todo-card-meta">
          ${task.tags.slice(0, 3).map((tag) => `<span class="todo-tag-chip">${escHtml(tag)}</span>`).join('')}
          ${dl ? `<span class="todo-deadline${dl.overdue ? ' overdue' : ''}${dl.warn ? ' warn' : ''}">${dl.overdue ? '⚠ ' : '📅 '}${dl.text}</span>` : ''}
        </div>
      </div>
      <div class="todo-card-actions">
        <button class="todo-icon-btn" data-t="edit" title="${T('edit')}">✎</button>
        <button class="todo-icon-btn" data-t="menu" title="${T('more')}">⋮</button>
      </div>
    </div>`;
  card.innerHTML = html;

  // 右键菜单(编辑/归档/删除)由点击 ⋮ 展开
  let menuEl = null;
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) { openDetail(task.id); return; }
    e.stopPropagation();
    const t = b.dataset.t;
    if (t === 'status') { cycleStatus(task); }
    else if (t === 'priority') { cyclePriority(task); }
    else if (t === 'sub') { toggleSubtask(task, b.dataset.sub); }
    else if (t === 'edit') { taskModalOpen = true; modalTaskId = task.id; render(); }
    else if (t === 'menu') {
      if (menuEl) { menuEl.remove(); menuEl = null; return; }
      menuEl = document.createElement('div');
      menuEl.className = 'todo-card-menu';
      menuEl.innerHTML = `
        <button data-m="edit">${T('edit')}</button>
        <button data-m="archive">${T('archive')}</button>
        <button data-m="delete" class="danger">${T('delete')}</button>`;
      menuEl.addEventListener('click', (ev) => {
        const mb = ev.target.closest('[data-m]');
        if (!mb) return;
        menuEl.remove(); menuEl = null;
        const m = mb.dataset.m;
        if (m === 'edit') { taskModalOpen = true; modalTaskId = task.id; render(); }
        else if (m === 'archive') { task.archived = true; task.updatedAt = now(); saveState(); render(); }
        else if (m === 'delete') {
          confirmDialog({ title: T('deleteTaskTitle'), message: T('deleteTaskMsg', task.title), okText: T('delete'), danger: true, onOk: () => { removeTask(task.id); render(); } });
        }
      });
      card.appendChild(menuEl);
    }
  });
  return card;
}

function openDetail(id) { detailTaskId = id; render(); }

function cycleStatus(task) {
  const next = STATUS_CYCLE[task.status];
  task.status = next;
  task.updatedAt = now();
  saveState();
  render();
}
function cyclePriority(task) {
  const next = PRIORITY_CYCLE[task.priority];
  task.priority = next;
  task.updatedAt = now();
  saveState();
  render();
}
async function toggleSubtask(task, subId) {
  const s = (task.subtasks || []).find((x) => x.id === subId);
  if (!s) return;
  s.done = !s.done;
  saveState();
  render();
}

// ---------------- 进度条 ----------------
function renderProgressBar() {
  const all = liveTasks();
  const done = all.filter((t) => t.status === 'done').length;
  if (!all.length) return document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'todo-progress';
  const fill = document.createElement('div');
  fill.className = 'todo-progress-fill';
  fill.style.width = `${(done / all.length) * 100}%`;
  bar.appendChild(fill);
  return bar;
}

// ---------------- 任务模态框(新建/编辑) ----------------
function renderTaskModal() {
  const task = modalTaskId ? taskById(modalTaskId) : null;
  const isNew = !task;
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  const box = document.createElement('div');
  box.className = 'todo-modal todo-modal-wide';
  box.innerHTML = `
    <div class="todo-modal-head">
      <div class="todo-modal-tabs">
        <button class="todo-tab-btn on" data-tab="details">${T('tabDetails')}</button>
        <button class="todo-tab-btn" data-tab="subtasks">${T('tabSubtasks')}${task && task.subtasks.length ? ` (${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length})` : ''}</button>
      </div>
      <button class="todo-icon-btn" data-close title="${T('close')}">✕</button>
    </div>
    <div class="todo-modal-body" data-body></div>
    <div class="todo-modal-foot">
      <button class="btn" data-close>${T('cancel')}</button>
      <button class="btn primary" data-save>${isNew ? T('createTask') : T('saveChanges')}</button>
    </div>`;

  let tab = 'details';
  // 输入暂存(每次渲染细节 tab 后同步回来)
  const draft = {
    title: task ? task.title : '',
    notes: task ? task.notes : '',
    priority: task ? task.priority : 'medium',
    status: task ? task.status : 'todo',
    deadline: task && task.deadline ? tsToDateInput(task.deadline) : '',
    projectId: task ? task.projectId : '',
    tags: task ? [...task.tags] : [],
    tagInput: '',
    subtaskInput: '',
    subtasks: task ? task.subtasks.map((s) => ({ ...s })) : [],
  };

  const bodyEl = box.querySelector('[data-body]');
  function renderBody() {
    bodyEl.innerHTML = '';
    if (tab === 'details') {
      const projects = state.todoProjects;
      bodyEl.innerHTML = `
        <div class="todo-field"><label class="todo-label">${T('titleLabel')}</label>
          <input class="todo-input" data-d="title" value="${escHtml(draft.title)}" placeholder="${T('titlePh')}" autofocus></div>
        <div class="todo-field"><label class="todo-label">${T('notesLabel')}</label>
          <textarea class="todo-input todo-textarea" data-d="notes" rows="3" placeholder="${T('notesPh')}">${escHtml(draft.notes)}</textarea></div>
        <div class="todo-field"><label class="todo-label">${T('priorityLabel')}</label>
          <div class="todo-pri-row">
            ${Object.keys(PRIORITY_CONFIG).map((p) => `
              <button class="todo-pri-opt${draft.priority === p ? ' on' : ''}" data-pri="${p}" style="${draft.priority === p ? `border-color:${PRIORITY_CONFIG[p].color};color:${PRIORITY_CONFIG[p].color};background:${PRIORITY_CONFIG[p].color}22` : ''}">${priLabel(p)}</button>`).join('')}
          </div></div>
        <div class="todo-field-row">
          <div class="todo-field" style="flex:1"><label class="todo-label">${T('statusLabel')}</label>
            <select class="todo-input" data-d="status">
              ${Object.keys(STATUS_CONFIG).map((s) => `<option value="${s}"${draft.status === s ? ' selected' : ''}>${stLabel(s)}</option>`).join('')}
            </select></div>
          <div class="todo-field" style="flex:1"><label class="todo-label">${T('projectLabel')}</label>
            <select class="todo-input" data-d="projectId">
              <option value="">${T('noProject')}</option>
              ${projects.map((p) => `<option value="${p.id}"${draft.projectId === p.id ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}
            </select></div>
        </div>
        <div class="todo-field"><label class="todo-label">${T('deadlineLabel')}</label>
          <input class="todo-input" type="date" data-d="deadline" value="${draft.deadline}"></div>
        <div class="todo-field"><label class="todo-label">${T('tagsLabel')}</label>
          <div class="todo-tags-edit">${draft.tags.map((tag) => `
            <span class="todo-tag-chip removable">${escHtml(tag)}<button class="todo-tag-x" data-del-tag="${escHtml(tag)}">✕</button></span>`).join('')}</div>
          <div class="todo-tag-add">
            <input class="todo-input" data-d="tagInput" placeholder="${T('tagPh')}" style="flex:1">
            <button class="btn" data-add-tag>${T('add')}</button>
          </div></div>`;
      // 详情 tab 事件
      bodyEl.querySelector('[data-d="title"]').addEventListener('input', (e) => { draft.title = e.target.value; });
      bodyEl.querySelector('[data-d="notes"]').addEventListener('input', (e) => { draft.notes = e.target.value; });
      bodyEl.querySelector('[data-d="status"]').addEventListener('change', (e) => { draft.status = e.target.value; });
      bodyEl.querySelector('[data-d="projectId"]').addEventListener('change', (e) => { draft.projectId = e.target.value; });
      bodyEl.querySelector('[data-d="deadline"]').addEventListener('change', (e) => { draft.deadline = e.target.value; });
      bodyEl.querySelector('[data-d="tagInput"]').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDraftTag(); }
      });
      bodyEl.querySelector('[data-add-tag]').addEventListener('click', addDraftTag);
      bodyEl.querySelectorAll('[data-pri]').forEach((b) => b.addEventListener('click', () => {
        draft.priority = b.dataset.pri;
        renderBody();
      }));
      bodyEl.querySelectorAll('[data-del-tag]').forEach((b) => b.addEventListener('click', () => {
        draft.tags = draft.tags.filter((t) => t !== b.dataset.delTag);
        renderBody();
      }));
      function addDraftTag() {
        const inp = bodyEl.querySelector('[data-d="tagInput"]');
        const v = inp.value.trim().toLowerCase();
        if (v && !draft.tags.includes(v)) draft.tags.push(v);
        inp.value = '';
      }
    } else {
      // 子任务 tab
      const subs = draft.subtasks;
      bodyEl.innerHTML = `
        ${subs.length ? `
          <div class="todo-sub-progress">
            <span>${T('progress')}</span><span>${subs.filter((s) => s.done).length}/${subs.length}</span>
            <div class="todo-card-sub-track" style="flex:1;margin:0 8px"><div class="todo-card-sub-fill" style="width:${(subs.filter((s) => s.done).length / subs.length) * 100}%"></div></div>
          </div>
          <div class="todo-sub-list"></div>` : ''}
        <div class="todo-field" style="margin-top:8px">
          <div class="todo-tag-add">
            <input class="todo-input" data-sub-input placeholder="${T('addStepPh')}" style="flex:1" autofocus>
            <button class="btn" data-add-sub>${T('add')}</button>
          </div>
        </div>`;
      const listEl = bodyEl.querySelector('.todo-sub-list');
      if (listEl) {
        subs.forEach((s, idx) => {
          const row = document.createElement('div');
          row.className = 'todo-sub-row';
          row.draggable = true;
          row.innerHTML = `
            <span class="todo-sub-grip" title="${T('dragToReorder')}">⠿</span>
            <div class="todo-sub-arrows">
              <button data-sub-up="${idx}" title="${T('moveUp')}" ${idx === 0 ? 'disabled' : ''}>▲</button>
              <button data-sub-down="${idx}" title="${T('moveDown')}" ${idx === subs.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
            <button class="todo-status-btn" data-sub-toggle="${s.id}" style="border-color:${s.done ? '#22c55e' : 'var(--border)'};color:${s.done ? '#22c55e' : 'var(--text2)'}">${s.done ? '●' : '○'}</button>
            <span class="todo-sub-title${s.done ? ' done' : ''}" data-sub-rename="${s.id}" title="${T('doubleClickRename')}">${escHtml(s.title)}</span>
            <button class="todo-icon-btn" data-sub-del="${s.id}" title="${T('del')}">✕</button>`;
          row.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(s.id));
          });
          row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
          row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
          row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            const dragId = e.dataTransfer.getData('text/plain');
            reorderSubtasks(dragId, s.id);
          });
          row.addEventListener('dragend', () => row.classList.remove('drag-over'));
          listEl.appendChild(row);
        });
        listEl.addEventListener('click', (e) => {
          const up = e.target.closest('[data-sub-up]');
          const down = e.target.closest('[data-sub-down]');
          const tog = e.target.closest('[data-sub-toggle]');
          const del = e.target.closest('[data-sub-del]');
          if (up) moveSubtask(Number(up.dataset.subUp), -1);
          else if (down) moveSubtask(Number(down.dataset.subDown), 1);
          else if (tog) { const s = subs.find((x) => x.id === tog.dataset.subToggle); if (s) { s.done = !s.done; renderBody(); } }
          else if (del) { const id = del.dataset.subDel; draft.subtasks = subs.filter((x) => x.id !== id); renderBody(); }
        });
        listEl.addEventListener('dblclick', (e) => {
          const sp = e.target.closest('[data-sub-rename]');
          if (!sp) return;
          const id = sp.dataset.subRename;
          const s = subs.find((x) => x.id === id);
          if (!s) return;
          const input = document.createElement('input');
          input.className = 'todo-input';
          input.value = s.title;
          sp.replaceWith(input);
          input.focus();
          input.select();
          const commit = () => {
            const v = input.value.trim();
            if (v && v !== s.title) { s.title = v; }
            renderBody();
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') renderBody();
          });
        });
      }
      bodyEl.querySelector('[data-add-sub]').addEventListener('click', addSubFromInput);
      bodyEl.querySelector('[data-sub-input]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSubFromInput(); });
      function addSubFromInput() {
        const inp = bodyEl.querySelector('[data-sub-input]');
        const v = inp.value.trim();
        if (!v) return;
        draft.subtasks.push({ id: uid('s'), title: v, done: false, sort: draft.subtasks.length, createdAt: now() });
        inp.value = '';
        renderBody();
      }
    }
  }
  function reorderSubtasks(dragId, targetId) {
    const subs = draft.subtasks;
    const fromIdx = subs.findIndex((x) => x.id === dragId);
    const toIdx = subs.findIndex((x) => x.id === targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const reordered = [...subs];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reordered.forEach((x, i) => { x.sort = i; });
    renderBody();
  }
  function moveSubtask(idx, delta) {
    const subs = draft.subtasks;
    const to = idx + delta;
    if (to < 0 || to >= subs.length) return;
    [subs[idx], subs[to]] = [subs[to], subs[idx]];
    subs.forEach((x, i) => { x.sort = i; });
    renderBody();
  }

  // 关闭(取消)
  function close() { taskModalOpen = false; modalTaskId = null; render(); }
  // 保存
  function save() {
    const title = draft.title.trim();
    if (!title) { toast(T('titleRequired'), 'warn'); return; }
    if (isNew) {
      const t = {
        id: uid('t'), title,
        notes: draft.notes, notesHtml: draft.notes,
        priority: draft.priority, status: draft.status,
        deadline: dateInputToTs(draft.deadline), reminderAt: null,
        sort: liveTasks().length, tags: draft.tags,
        projectId: draft.projectId, recurRule: '',
        archived: false, subtasks: draft.subtasks, createdAt: now(), updatedAt: now(),
      };
      upsertTask(t);
    } else {
      Object.assign(task, {
        title, notes: draft.notes, notesHtml: draft.notes,
        priority: draft.priority, status: draft.status,
        deadline: dateInputToTs(draft.deadline),
        tags: draft.tags, projectId: draft.projectId,
        subtasks: draft.subtasks, updatedAt: now(),
      });
      saveState();
    }
    toast(T('saved'), 'ok');
    close();
  }

  box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  box.querySelector('[data-save]').addEventListener('click', save);
  box.querySelectorAll('.todo-tab-btn').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    box.querySelectorAll('.todo-tab-btn').forEach((x) => x.classList.toggle('on', x === b));
    renderBody();
  }));
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  renderBody();
  ov.appendChild(box);
  return ov;
}

// ---------------- 详情面板 ----------------
function renderDetailPanel() {
  const task = taskById(detailTaskId);
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  if (!task) { ov.addEventListener('click', () => { detailTaskId = null; render(); }); ov.innerHTML = `<div class="todo-modal">${T('taskNotFound')}</div>`; return ov; }
  const box = document.createElement('div');
  box.className = 'todo-modal';
  const pri = PRIORITY_CONFIG[task.priority];
  const st = STATUS_CONFIG[task.status];
  const proj = task.projectId ? projectById(task.projectId) : null;
  const subs = task.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const dl = deadlineInfo(task);

  box.innerHTML = `
    <div class="todo-modal-head">
      <div class="todo-detail-title-wrap">
        <button class="todo-status-btn" data-act="status" title="${T('clickToggleStatus')}" style="border-color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--border)'};color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--text2)'}">${st.icon}</button>
        <h2 class="todo-detail-title${task.status === 'done' ? ' done' : ''}">${escHtml(task.title)}</h2>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn" data-act="copy" title="${T('copyTitle')}">⎘ ${T('copy')}</button>
        <button class="btn" data-act="edit">${T('edit')}</button>
        <button class="btn" data-act="archive">📦 ${T('archive')}</button>
        <button class="todo-icon-btn" data-act="close" title="${T('close')}">✕</button>
      </div>
    </div>
    <div class="todo-modal-body todo-detail-body">
      <div class="todo-detail-badges">
        <button class="todo-badge" data-act="priority" style="color:${pri.color};background:${pri.color}18;border-color:${pri.color}44" title="${T('clickTogglePriority')}">
          <span class="todo-pri-dot" style="background:${pri.color}"></span>${priLabel(task.priority)}
        </button>
        <span class="todo-badge">${st.icon} ${stLabel(task.status)}</span>
        ${proj ? `<span class="todo-badge" style="color:${proj.color};background:${proj.color}18;border-color:${proj.color}44">◆ ${escHtml(proj.name)}</span>` : ''}
      </div>
      ${dl ? `
        <div class="todo-detail-deadline">
          <span>📅</span>
          <div><div class="todo-detail-label">${T('deadlineLabel')}</div>
          <div class="todo-detail-value" style="color:${dl.overdue ? '#ef4444' : dl.warn ? '#f59e0b' : 'var(--text2)'}">${dl.overdue ? T('overduePrefix') : ''}${fmtFullDate(task.deadline)}</div></div>
        </div>` : ''}
      ${task.tags.length ? `
        <div class="todo-detail-section">
          <div class="todo-detail-label">${T('tagsLabel')}</div>
          <div>${task.tags.map((tag) => `<span class="todo-tag-chip">${escHtml(tag)}</span>`).join('')}</div>
        </div>` : ''}
      ${task.notes ? `
        <div class="todo-detail-section">
          <div class="todo-detail-label">${T('descLabel')}</div>
          <div class="todo-detail-notes">${escHtml(task.notes)}</div>
        </div>` : ''}
      ${subs.length ? `
        <div class="todo-detail-section">
          <div class="todo-detail-label" style="display:flex;justify-content:space-between">${T('tabSubtasks')} <span>${doneSubs}/${subs.length}</span></div>
          <div class="todo-card-sub-track" style="margin:6px 0 8px"><div class="todo-card-sub-fill" style="width:${(doneSubs / subs.length) * 100}%"></div></div>
          ${subs.map((s) => `
            <div class="todo-detail-sub">
              <button class="todo-status-btn" data-act="sub" data-sub="${s.id}" style="border-color:${s.done ? '#22c55e' : 'var(--border)'};color:${s.done ? '#22c55e' : 'var(--text2)'}">${s.done ? '●' : '○'}</button>
              <span class="${s.done ? 'done' : ''}">${escHtml(s.title)}</span>
            </div>`).join('')}
        </div>` : ''}
      <div class="todo-detail-foot">${T('createdOn', fmtFullDate(task.createdAt))}${task.updatedAt !== task.createdAt ? ` · ${T('updatedOn', fmtFullDate(task.updatedAt))}` : ''}</div>
    </div>`;

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') { detailTaskId = null; render(); }
    else if (act === 'edit') { taskModalOpen = true; modalTaskId = task.id; detailTaskId = null; render(); }
    else if (act === 'status') { cycleStatus(task); }
    else if (act === 'priority') { cyclePriority(task); }
    else if (act === 'sub') { toggleSubtask(task, b.dataset.sub); }
    else if (act === 'copy') {
      const lines = [`📋 ${task.title}`, T('priPrefix', priLabel(task.priority), stLabel(task.status)),
        proj ? T('projectPrefix', proj.name) : null,
        dl ? T('deadlinePrefix', fmtFullDate(task.deadline)) : null,
        task.tags.length ? T('tagsPrefix', task.tags.join(', ')) : null,
        task.notes ? `\n${task.notes}` : null,
        subs.length ? `\n${T('subtasksPrefix', doneSubs, subs.length)}\n${subs.map((s) => `  ${s.done ? '✓' : '○'} ${s.title}`).join('\n')}` : null,
      ].filter(Boolean).join('\n');
      navigator.clipboard.writeText(lines).then(() => toast(T('copied'), 'ok')).catch(() => toast(T('copyFailed'), 'warn'));
    }
    else if (act === 'archive') {
      task.archived = true; task.updatedAt = now(); saveState();
      detailTaskId = null;
      render();
    }
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) { detailTaskId = null; render(); } });
  ov.appendChild(box);
  return ov;
}

// ---------------- 项目面板 ----------------
function renderProjectsModal() {
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  const box = document.createElement('div');
  box.className = 'todo-modal';
  box.innerHTML = `
    <div class="todo-modal-head">
      <h2 class="todo-modal-title">${T('manageProjects')}</h2>
      <button class="todo-icon-btn" data-close>✕</button>
    </div>
    <div class="todo-modal-body">
      <div class="todo-proj-list">
        ${state.todoProjects.length ? state.todoProjects.map((p) => `
          <div class="todo-proj-row">
            <span class="todo-pri-dot" style="background:${p.color}"></span>
            <span class="todo-proj-name" data-edit="${p.id}">${escHtml(p.name)}</span>
            <span class="todo-proj-count">${T('taskCount', liveTasks().filter((t) => t.projectId === p.id).length)}</span>
            <button class="todo-icon-btn" data-del="${p.id}" title="${T('delProjectTitleTip')}">✕</button>
          </div>`).join('') : `<div class="todo-empty-desc" style="text-align:center;padding:14px 0">${T('noProjectsYet')}</div>`}
      </div>
      <div class="todo-proj-new">
        <div class="todo-label">${T('newProject')}</div>
        <input class="todo-input" data-new-name placeholder="${T('projectNamePh')}" style="width:100%;margin:6px 0 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="todo-color-row">${PROJECT_COLORS.map((c) => `<button class="todo-color-btn" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
          <button class="btn primary" data-new-create style="margin-left:auto">${T('addProject')}</button>
        </div>
      </div>
    </div>`;
  let newColor = PROJECT_COLORS[0];
  box.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    newColor = b.dataset.color;
    box.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  box.querySelector('[data-new-create]').addEventListener('click', () => {
    const inp = box.querySelector('[data-new-name]');
    const name = inp.value.trim();
    if (!name) { toast(T('projectNameRequired'), 'warn'); return; }
    upsertProject({ id: uid('p'), name, color: newColor, sort: state.todoProjects.length, createdAt: now(), updatedAt: now() });
    inp.value = '';
    render();
  });
  box.querySelector('[data-new-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('[data-new-create]').click(); });
  box.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    const del = e.target.closest('[data-del]');
    const edit = e.target.closest('[data-edit]');
    if (close) { projectsOpen = false; render(); }
    else if (del) {
      const p = projectById(del.dataset.del);
      confirmDialog({
        title: T('deleteProjectTitle'), message: T('deleteProjectMsg', p ? p.name : ''),
        okText: T('delete'), danger: true, onOk: () => { removeProject(del.dataset.del); render(); },
      });
    }
    else if (edit) {
      const p = projectById(edit.dataset.edit);
      if (!p) return;
      const input = document.createElement('input');
      input.className = 'todo-input';
      input.value = p.name;
      edit.replaceWith(input);
      input.focus(); input.select();
      const commit = () => {
        const v = input.value.trim();
        if (v && v !== p.name) { p.name = v; p.updatedAt = now(); saveState(); }
        render();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') render(); });
    }
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) { projectsOpen = false; render(); } });
  ov.appendChild(box);
  return ov;
}

// ---------------- 归档视图 ----------------
function renderArchiveModal() {
  const ov = document.createElement('div');
  ov.className = 'todo-overlay';
  const box = document.createElement('div');
  box.className = 'todo-modal todo-modal-wide';
  const list = archivedTasks();
  box.innerHTML = `
    <div class="todo-modal-head">
      <h2 class="todo-modal-title">${T('archivedTasks')}</h2>
      <button class="todo-icon-btn" data-close>✕</button>
    </div>
    <div class="todo-modal-body">
      ${list.length ? list.map((t) => `
        <div class="todo-archive-row">
          <div class="todo-archive-main">
            <div class="todo-archive-title">${escHtml(t.title)}</div>
            <div class="todo-archive-meta">${T('archivedOn', fmtFullDate(t.updatedAt), PRIORITY_CONFIG[t.priority] ? priLabel(t.priority) : '')}</div>
          </div>
          <button class="btn" data-restore="${t.id}" title="${T('restoreTitle')}">${T('restore')}</button>
          <button class="todo-icon-btn danger" data-del="${t.id}" title="${T('deleteForever')}">✕</button>
        </div>`).join('') : `
        <div class="todo-empty">
          <div class="todo-empty-ico">📦</div>
          <div class="todo-empty-title">${T('noArchived')}</div>
          <div class="todo-empty-desc">${T('noArchivedDesc')}</div>
        </div>`}
    </div>`;
  box.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    const restore = e.target.closest('[data-restore]');
    const del = e.target.closest('[data-del]');
    if (close) { archiveOpen = false; render(); }
    else if (restore) {
      const t = taskById(restore.dataset.restore);
      if (t) { t.archived = false; t.updatedAt = now(); saveState(); render(); }
    }
    else if (del) {
      const t = taskById(del.dataset.del);
      confirmDialog({
        title: T('deleteForeverTitle'), message: T('deleteForeverMsg', t ? t.title : ''),
        okText: T('delete'), danger: true, onOk: () => { removeTask(del.dataset.del); render(); },
      });
    }
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) { archiveOpen = false; render(); } });
  ov.appendChild(box);
  return ov;
}

// ---------------- 导出 CSV / JSON ----------------
async function exportTasks(type) {
  const tasks = [...liveTasks()].sort((a, b) => a.sort - b.sort);
  let content = '';
  let defaultName = '';
  let filtersArr = [];
  if (type === 'csv') {
    const headers = [T('csvId'), T('csvTitle'), T('csvNotes'), T('csvPriority'), T('csvStatus'), T('csvDeadline'), T('csvTags'), T('csvProject'), T('csvSubtasks'), T('csvCreated')];
    const rows = tasks.map((t) => {
      const proj = t.projectId ? (projectById(t.projectId)?.name || '') : '';
      const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        t.id, csv(t.title), csv(t.notes), t.priority, t.status,
        t.deadline ? tsToDateInput(t.deadline) : '',
        csv(t.tags.join(', ')), csv(proj),
        csv((t.subtasks || []).map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('; ')),
        t.createdAt ? tsToDateInput(t.createdAt) : '',
      ].join(',');
    });
    content = [headers.join(','), ...rows].join('\n');
    defaultName = 'tasks-export.csv';
    filtersArr = [{ name: T('exportCsvName'), extensions: ['csv'] }];
  } else {
    const data = {
      exportedAt: new Date().toISOString(),
      projects: state.todoProjects,
      tasks: tasks.map((t) => ({
        ...t,
        deadline: t.deadline ? new Date(t.deadline * 1000).toISOString() : null,
      })),
    };
    content = JSON.stringify(data, null, 2);
    defaultName = 'tasks-export.json';
    filtersArr = [{ name: T('exportJsonName'), extensions: ['json'] }];
  }
  const r = await window.api.saveText({ defaultName, content, filters: filtersArr });
  if (r && r.ok) toast(T('exportedTo', r.path), 'ok');
  else if (r && r.error) toast(T('exportFailed', r.error), 'warn');
}

// ---------------- 导入(兼容 Taskwingo 导出与本模块导出格式) ----------------
function parseDeadline(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number') {
    // 秒时间戳(1.7e9 级);>1e11 视为毫秒
    return d > 1e11 ? Math.floor(d / 1000) : Math.floor(d);
  }
  if (typeof d === 'string') {
    const ts = Date.parse(d);
    if (!isNaN(ts)) return Math.floor(ts / 1000);
  }
  return null;
}

/** 选择 JSON 文件并导入任务/项目/子任务(旧 id → 新 id 重映射,避免冲突) */
async function importTasks() {
  const pick = await window.api.pickFiles({
    title: T('importJsonTitle'),
    filters: [{ name: T('jsonFile'), extensions: ['json'] }],
    multi: false,
  });
  if (!pick || pick.canceled || !pick.filePaths || !pick.filePaths.length) return;
  const file = pick.filePaths[0];
  const rd = await window.api.readText(file);
  if (!rd || !rd.ok) { toast(T('readFailed', (rd && rd.error) || T('unknownError')), 'warn'); return; }
  let data;
  try { data = JSON.parse(rd.text); } catch (e) { toast(T('jsonParseFailed', e.message), 'warn'); return; }
  const rawTasks = Array.isArray(data && data.tasks) ? data.tasks : (Array.isArray(data) ? data : null);
  if (!rawTasks) { toast(T('noTasksField'), 'warn'); return; }

  // 项目:旧 id → 新 id 映射
  const projMap = new Map();
  const rawProjects = Array.isArray(data.projects) ? data.projects : [];
  for (const p of rawProjects) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
    const np = {
      id: uid('p'), name: p.name.trim(),
      color: (typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color)) ? p.color : PROJECT_COLORS[0],
      sort: state.todoProjects.length + projMap.size, createdAt: now(), updatedAt: now(),
    };
    state.todoProjects.push(np);
    if (p.id != null) projMap.set(String(p.id), np.id);
  }

  let imported = 0, subCount = 0;
  const baseSort = liveTasks().length;
  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    if (!t || typeof t !== 'object') continue;
    const title = (typeof t.title === 'string' && t.title.trim()) ? t.title.trim() : T('untitledTask');
    const priority = PRIORITY_CONFIG[t.priority] ? t.priority : 'medium';
    const status = STATUS_CONFIG[t.status] ? t.status : 'todo';
    const deadline = parseDeadline(t.deadline);
    let tags = Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string') : [];
    if (!tags.length && typeof t.tags === 'string') {
      try { tags = JSON.parse(t.tags || '[]').filter((x) => typeof x === 'string'); } catch (e) { tags = []; }
    }
    tags = tags.map((x) => x.trim().toLowerCase()).filter(Boolean);
    let projectId = '';
    // 兼容两种键名:本项目导出 projectId(taskwingo 导出为数据库列名 project_id)
    const rawPid = t.projectId != null ? t.projectId : t.project_id;
    if (rawPid != null && projMap.has(String(rawPid))) projectId = projMap.get(String(rawPid));
    const rawSubs = Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && typeof s === 'object') : [];
    const taskId = uid('t');
    state.todoTasks.push({
      id: taskId, title,
      notes: typeof t.notes === 'string' ? t.notes : '',
      notesHtml: typeof t.notesHtml === 'string' ? t.notesHtml : (typeof t.notes_html === 'string' ? t.notes_html : (typeof t.notes === 'string' ? t.notes : '')),
      priority, status, deadline, reminderAt: null,
      sort: baseSort + i, tags, projectId, recurRule: '', archived: false,
      subtasks: rawSubs.map((s, j) => ({
        id: uid('s'), taskId, title: (typeof s.title === 'string' && s.title.trim()) ? s.title.trim() : T('untitledStep'),
        done: !!s.done, sort: j, createdAt: now(),
      })),
      createdAt: now(), updatedAt: now(),
    });
    subCount += rawSubs.length;
    imported++;
  }
  if (!imported) { toast(T('noImportable'), 'warn'); return; }
  saveState();
  let msg = T('importDone', imported);
  if (subCount) msg += T('importDoneSub', subCount);
  if (projMap.size) msg += T('importDoneProj', projMap.size);
  toast(msg, 'ok');
  render();
}
