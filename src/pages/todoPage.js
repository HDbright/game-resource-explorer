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
    bdayCount: '{0} 人生日', morePeople: '等 {0} 人',
    dayEvList: '事件列表 ({0})', dayEvEmpty: '当天没有事件',
    // 日历事件
    evBirthday: '生日', evAnniversary: '纪念日', evTodo: '待办事件', evImportant: '重要事件',
    newEvent: '新建事件', editEvent: '编辑事件', deleteEvent: '删除事件', addEventMenu: '新建事件…',
    evTypeLabel: '类型', evTitleLabel: '标题 *', evNoteLabel: '备注', evDateLabel: '日期',
    evTitlePh: '事件标题', evNotePh: '补充说明…', evTitleRequired: '标题不能为空', evSaved: '已保存',
    evTitleLabelBday: '名字 *', evTitlePhBday: '输入生日对象的名字…',
    evTitleLabelAnni: '名称 *', evTitlePhAnni: '输入纪念日名称…',
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
    toggleSubtasks: '折叠/展开子任务',
    // 开始/完成时间 + 子任务备注 + 事件日志
    startAtLabel: '开始时间', completeAtLabel: '完成时间',
    subNotesLabel: '子任务备注', subNotesPh: '子任务补充说明…',
    eventsTab: '任务事件', addEvent: '添加事件', eventTextPh: '事件内容…', noEvents: '暂无任务事件',
    subDoneAt: '完成于', eventsSection: '任务事件',
    editSubtask: '编辑子任务', subDoneAtLabel: '完成日期', subDoneAtDisabledTip: '子任务未完成,勾选后才能填完成日期', subCreatedOn: '创建于 {0}',
    parentTaskLabel: '父任务', noParent: '无父任务', publishAtLabel: '发布时间', parentProjectLabel: '父项目', noParentProject: '无（顶级项目）', noParentTask: '无（顶级任务）',
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
    delSubTitle: '删除子任务', delSubMsg: '确定删除子任务「{0}」吗?此操作不可恢复。',
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
    csvDeadline: '截止日期', csvStartAt: '开始时间', csvCompleteAt: '完成时间', csvTags: '标签', csvProject: '项目', csvSubtasks: '子任务', csvCreated: '创建日期',
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
    bdayCount: '{0} birthdays', morePeople: 'and {0} more',
    dayEvList: 'Events ({0})', dayEvEmpty: 'No events on this day',
    evBirthday: 'Birthday', evAnniversary: 'Anniversary', evTodo: 'Todo Event', evImportant: 'Important Event',
    newEvent: 'New Event', editEvent: 'Edit Event', deleteEvent: 'Delete Event', addEventMenu: 'New event…',
    evTypeLabel: 'Type', evTitleLabel: 'Title *', evNoteLabel: 'Note', evDateLabel: 'Date',
    evTitlePh: 'Event title', evNotePh: 'Additional details…', evTitleRequired: 'Title is required', evSaved: 'Saved',
    evTitleLabelBday: 'Name *', evTitlePhBday: 'Who is the birthday about?',
    evTitleLabelAnni: 'Name *', evTitlePhAnni: 'What anniversary is this?',
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
    toggleSubtasks: 'Toggle subtasks',
    startAtLabel: 'Start time', completeAtLabel: 'Complete time',
    subNotesLabel: 'Subtask notes', subNotesPh: 'Subtask details…',
    eventsTab: 'Task Events', addEvent: 'Add Event', eventTextPh: 'Event content…', noEvents: 'No task events yet',
    subDoneAt: 'Done on', eventsSection: 'Task Events',
    editSubtask: 'Edit subtask', subDoneAtLabel: 'Done at', subDoneAtDisabledTip: 'Subtask not done yet — check it first to set a completion date', subCreatedOn: 'Created {0}',
    parentTaskLabel: 'Parent task', noParent: 'No parent', publishAtLabel: 'Publish time', parentProjectLabel: 'Parent project', noParentProject: 'None (top-level)', noParentTask: 'None (top-level)',
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
    delSubTitle: 'Delete Subtask', delSubMsg: 'Delete subtask "{0}"? This cannot be undone.',
    exportCsvName: 'CSV File', exportJsonName: 'JSON File',
    exportedTo: 'Exported to {0}', exportFailed: 'Export failed: {0}',
    importJsonTitle: 'Select a JSON file to import',
    readFailed: 'Failed to read file: {0}', jsonParseFailed: 'JSON parse failed: {0}',
    noTasksField: 'No tasks data (missing "tasks" field)',
    importDone: 'Imported {0} tasks', importDoneSub: '({0} subtasks)', importDoneProj: ', {0} projects',
    noImportable: 'No importable tasks', untitledTask: 'Untitled Task', untitledStep: 'Untitled step',
    unknownError: 'Unknown error',
    csvId: 'ID', csvTitle: 'Title', csvNotes: 'Notes', csvPriority: 'Priority', csvStatus: 'Status',
    csvDeadline: 'Deadline', csvStartAt: 'Start Time', csvCompleteAt: 'Complete Time', csvTags: 'Tags', csvProject: 'Project', csvSubtasks: 'Subtasks', csvCreated: 'Created',
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
  todo: { icon: '⬜' },
  in_progress: { icon: '◑' },
  done: { icon: '✅' },
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
let modalInitialTab = 'details'; // 打开任务模态框时定位到的 tab(子任务右键编辑→'subtasks')
let modalHighlightSub = ''; // 打开子任务 tab 时要高亮并滚动定位的子任务 id(悬停 ✎ / 右键编辑)
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
/** 秒时间戳 → datetime-local 输入值(YYYY-MM-DDTHH:MM,本地时区) */
function tsToDateTimeLocal(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** datetime-local 值 → 秒时间戳(本地时区) */
function dateTimeLocalToTs(s) {
  if (!s) return null;
  const t = new Date(s).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
}
/** 秒时间戳 → 完整日期时间(YYYY-MM-DD HH:MM) */
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  if (lang === 'zh') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
// 判断 nodeId 是否为 ancestorId 的后代(防任务树成环)
function isTaskDescendant(nodeId, ancestorId) {
  if (!ancestorId) return false;
  let cur = taskById(nodeId);
  let guard = 0;
  while (cur && guard++ < 100) {
    if ((cur.parentTaskId || '') === ancestorId) return true;
    cur = taskById(cur.parentTaskId || '');
  }
  return false;
}
// 判断项目节点是否为某祖先的后代(防项目树成环)
function isProjectDescendant(nodeId, ancestorId) {
  if (!ancestorId) return false;
  let cur = projectById(nodeId);
  let guard = 0;
  while (cur && guard++ < 100) {
    if ((cur.parentId || '') === ancestorId) return true;
    cur = projectById(cur.parentId || '');
  }
  return false;
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
  // 菜单挂在 body 上(position:fixed),重绘前必须清掉,否则会浮空残留
  document.querySelectorAll('.todo-card-menu').forEach((el) => el.remove());
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
// ---------------- 树状层级(补丁·45:项目树 + 项目内任务树) ----------------
const TREE_COLLAPSED_KEY = 'todo_tree_collapsed';
let collapsedNodes = (() => { try { return new Set(JSON.parse(localStorage.getItem(TREE_COLLAPSED_KEY) || '[]')); } catch { return new Set(); } })();
function persistCollapsed() { try { localStorage.setItem(TREE_COLLAPSED_KEY, JSON.stringify([...collapsedNodes])); } catch {} }
function toggleNode(id) {
  if (collapsedNodes.has(id)) collapsedNodes.delete(id); else collapsedNodes.add(id);
  persistCollapsed();
  render();
}
// 项目森林:按 parentId 构建,返回根项目数组(每项含 children 递归);防环
function buildProjectForest() {
  const nodes = state.todoProjects.map((p) => ({ ...p, children: [] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = [];
  const placed = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (placed.has(n.id)) continue;
      const pid = n.parentId || '';
      if (!pid || pid === n.id) { roots.push(n); placed.add(n.id); changed = true; }
      else if (byId.has(pid) && placed.has(pid)) { byId.get(pid).children.push(n); placed.add(n.id); changed = true; }
    }
  }
  for (const n of nodes) if (!placed.has(n.id)) { roots.push(n); placed.add(n.id); }
  const sortP = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || ((a.createdAt || 0) - (b.createdAt || 0));
  const sortRec = (arr) => { arr.sort(sortP); arr.forEach((c) => sortRec(c.children)); };
  sortRec(roots);
  return roots;
}
// 某项目内任务树:matched 为该项目的匹配任务(已过滤),自动补全匹配任务的祖先以维持树形
function buildTaskTreeFrom(matched, projId) {
  const projTasks = matched.filter((t) => (t.projectId || '') === projId);
  const set = new Map();
  projTasks.forEach((t) => set.set(t.id, { ...t, children: [] }));
  for (const t of projTasks) {
    let pid = t.parentTaskId || '';
    let guard = 0;
    while (pid && guard++ < 100) {
      if (set.has(pid)) break;
      const parent = taskById(pid);
      if (!parent || parent.archived) break;
      set.set(pid, { ...parent, children: [] });
      pid = parent.parentTaskId || '';
    }
  }
  const nodes = [...set.values()];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = [];
  const placed = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (placed.has(n.id)) continue;
      const pid = n.parentTaskId || '';
      if (!pid || pid === n.id) { roots.push(n); placed.add(n.id); changed = true; }
      else if (byId.has(pid) && placed.has(pid)) { byId.get(pid).children.push(n); placed.add(n.id); changed = true; }
    }
  }
  for (const n of nodes) if (!placed.has(n.id)) { roots.push(n); placed.add(n.id); }
  const sortT = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || ((a.createdAt || 0) - (b.createdAt || 0));
  const sortRec = (arr) => { arr.sort(sortT); arr.forEach((c) => sortRec(c.children)); };
  sortRec(roots);
  return roots;
}
function countProjectTasks(projNode, matched) {
  let n = matched.filter((t) => t.projectId === projNode.id).length;
  for (const c of (projNode.children || [])) n += countProjectTasks(c, matched);
  return n;
}
function forestFind(forest, id) {
  for (const n of forest) {
    if (n.id === id) return n;
    const f = forestFind(n.children || [], id);
    if (f) return f;
  }
  return null;
}
/** 树内拖拽:把 dragId 变成 targetId 的同级(同 parentTaskId / projectId),并插到 target 之前 */
function reparentTaskAsSibling(dragId, targetId) {
  const drag = taskById(dragId);
  const target = taskById(targetId);
  if (!drag || !target || drag.id === target.id) return;
  drag.parentTaskId = target.parentTaskId || '';
  drag.projectId = target.projectId || '';
  const others = state.todoTasks
    .filter((t) => !t.archived && (t.projectId || '') === (target.projectId || '') && (t.parentTaskId || '') === (target.parentTaskId || '') && t.id !== drag.id)
    .sort((a, b) => a.sort - b.sort);
  const ti = others.findIndex((t) => t.id === target.id);
  let newSort;
  if (ti <= 0) newSort = (others[0] ? others[0].sort : 0) - 1;
  else newSort = (others[ti - 1].sort + others[ti].sort) / 2;
  drag.sort = newSort;
  drag.updatedAt = now();
  saveState();
  render();
}
/** 树内拖拽:把 dragId 移到某项目的顶级(parentTaskId='') */
function reparentTaskToProjectTop(dragId, projId) {
  const drag = taskById(dragId);
  if (!drag) return;
  drag.parentTaskId = '';
  drag.projectId = projId || '';
  const tops = state.todoTasks.filter((t) => !t.archived && (t.projectId || '') === (projId || '') && !(t.parentTaskId || ''));
  const maxSort = tops.length ? Math.max(...tops.map((t) => t.sort)) : 0;
  drag.sort = maxSort + 1;
  drag.updatedAt = now();
  saveState();
  render();
}
function attachTaskDrag(card, task) {
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
    reparentTaskAsSibling(dragId, task.id);
  });
}
function renderTaskNode(tn, depth) {
  const el = document.createElement('div');
  el.className = 'todo-task-node';
  el.setAttribute('data-task-id', tn.id);
  const collapsed = collapsedNodes.has(tn.id);
  const hasChildren = (tn.children || []).length > 0;
  const row = document.createElement('div');
  row.className = 'todo-task-node-row';
  row.style.marginLeft = (depth * 18) + 'px';
  const arrow = document.createElement('button');
  arrow.className = 'todo-tree-arrow todo-task-arrow';
  arrow.setAttribute('data-task-toggle', tn.id);
  arrow.textContent = hasChildren ? (collapsed ? '▸' : '▾') : '';
  arrow.style.visibility = hasChildren ? 'visible' : 'hidden';
  arrow.addEventListener('click', (e) => { e.stopPropagation(); if (hasChildren) toggleNode(tn.id); });
  row.appendChild(arrow);
  const card = renderTaskCard(tn);
  attachTaskDrag(card, tn);
  row.appendChild(card);
  el.appendChild(row);
  if (hasChildren && !collapsed) {
    const childWrap = document.createElement('div');
    childWrap.className = 'todo-task-children';
    tn.children.forEach((c) => childWrap.appendChild(renderTaskNode(c, depth + 1)));
    el.appendChild(childWrap);
  }
  return el;
}
function renderProjectNode(projNode, matched, depth, recurseSubs = true) {
  const el = document.createElement('div');
  el.className = 'todo-proj-node';
  el.setAttribute('data-proj', projNode.id);
  const collapsed = collapsedNodes.has(projNode.id);
  const count = countProjectTasks(projNode, matched);
  const head = document.createElement('div');
  head.className = 'todo-proj-head';
  head.setAttribute('data-proj-toggle', projNode.id);
  head.innerHTML = `
    <span class="todo-tree-arrow">${collapsed ? '▸' : '▾'}</span>
    <span class="todo-proj-dot" style="background:${projNode.color}"></span>
    <span class="todo-proj-name">${escHtml(projNode.name)}</span>
    ${count ? `<span class="todo-proj-count">${count}</span>` : ''}`;
  head.addEventListener('click', () => toggleNode(projNode.id));
  // 拖到项目头 → 成为该项目顶级任务
  head.addEventListener('dragover', (e) => e.preventDefault());
  head.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
    if (!dragId) return;
    reparentTaskToProjectTop(dragId, projNode.id);
  });
  el.appendChild(head);
  const body = document.createElement('div');
  body.className = 'todo-proj-body' + (collapsed ? ' collapsed' : '');
  body.style.marginLeft = (depth > 0 ? 14 : 0) + 'px';
  if (recurseSubs) (projNode.children || []).forEach((cp) => body.appendChild(renderProjectNode(cp, matched, depth + 1, true)));
  buildTaskTreeFrom(matched, projNode.id).forEach((tn) => body.appendChild(renderTaskNode(tn, 0)));
  el.appendChild(body);
  return el;
}
function renderNoneNode(noneTasks) {
  const el = document.createElement('div');
  el.className = 'todo-proj-node todo-proj-none';
  el.setAttribute('data-proj', '__none__');
  const collapsed = collapsedNodes.has('__none__');
  const head = document.createElement('div');
  head.className = 'todo-proj-head';
  head.setAttribute('data-proj-toggle', '__none__');
  head.innerHTML = `
    <span class="todo-tree-arrow">${collapsed ? '▸' : '▾'}</span>
    <span class="todo-proj-dot"></span>
    <span class="todo-proj-name">${T('noProject')}</span>
    <span class="todo-proj-count">${noneTasks.length}</span>`;
  head.addEventListener('click', () => toggleNode('__none__'));
  head.addEventListener('dragover', (e) => e.preventDefault());
  head.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
    if (dragId) reparentTaskToProjectTop(dragId, '');
  });
  el.appendChild(head);
  const body = document.createElement('div');
  body.className = 'todo-proj-body' + (collapsed ? ' collapsed' : '');
  buildTaskTreeFrom(noneTasks, '').forEach((tn) => body.appendChild(renderTaskNode(tn, 0)));
  el.appendChild(body);
  return el;
}
function renderList() {
  const wrap = document.createElement('div');
  wrap.className = 'todo-list-tree';
  const matched = filteredTasks();
  const forest = buildProjectForest();
  const noneTasks = matched.filter((t) => !t.projectId);
  if (!matched.length && !forest.length) {
    wrap.innerHTML = `
      <div class="todo-empty">
        <div class="todo-empty-ico">📋</div>
        <div class="todo-empty-title">${liveTasks().length ? T('noMatching') : T('noTasks')}</div>
        <div class="todo-empty-desc">${liveTasks().length ? T('adjustFilter') : T('clickNewTask')}</div>
      </div>`;
    return wrap;
  }
  let projNodes = forest;
  const isSpecific = filters.projectId && filters.projectId !== 'all' && filters.projectId !== 'none';
  if (isSpecific) {
    const found = forestFind(forest, filters.projectId);
    projNodes = found ? [found] : [];
  }
  projNodes.forEach((pn) => wrap.appendChild(renderProjectNode(pn, matched, 0, !isSpecific)));
  if (!isSpecific && (filters.projectId === 'none' || noneTasks.length)) wrap.appendChild(renderNoneNode(noneTasks));
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
/** 看板某列的任务(按 sort 升序,同值退回创建时间) */
function kanbanColTasks(status) {
  return liveTasks()
    .filter((t) => t.status === status)
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || ((a.createdAt || 0) - (b.createdAt || 0)));
}

/** 清掉看板里所有插入指示线 */
function clearKanbanDropMarks(scope) {
  (scope || document).querySelectorAll('.todo-card-drop-before, .todo-card-drop-after')
    .forEach((el) => el.classList.remove('todo-card-drop-before', 'todo-card-drop-after'));
  (scope || document).querySelectorAll('.todo-kanban-body.drop-tail')
    .forEach((el) => el.classList.remove('drop-tail'));
}

/**
 * 把 dragId 移到 colStatus 列中 targetId 的前/后(targetId 为空 → 落到列尾)。
 * 使用「分数序号」(fractional sort)只改被拖任务的 sort,不动同列其他任务,
 * 避免影响列表视图的全局顺序;间隙不足时才对该列做一次整数重编号。
 */
function moveTaskInKanban(dragId, colStatus, targetId, insertBefore) {
  const t = taskById(dragId);
  if (!t) return;
  if (targetId === dragId) return;
  if (t.status !== colStatus) {
    t.status = colStatus;
    if (colStatus === 'done' && !t.completeAt) t.completeAt = now();
    if (colStatus === 'in_progress' && !t.startAt) t.startAt = now();
  }
  const members = kanbanColTasks(colStatus).filter((x) => x.id !== dragId);
  let idx = members.length;
  if (targetId) {
    const ti = members.findIndex((x) => x.id === targetId);
    if (ti >= 0) idx = insertBefore ? ti : ti + 1;
  }
  const prev = members[idx - 1] || null;
  const next = members[idx] || null;
  if (!prev && !next) t.sort = 0;
  else if (!prev) t.sort = (next.sort ?? 0) - 1;
  else if (!next) t.sort = (prev.sort ?? 0) + 1;
  else {
    const a = prev.sort ?? 0, b = next.sort ?? 0;
    const mid = (a + b) / 2;
    if (mid > a && mid < b) t.sort = mid;
    else {
      // sort 相等或浮点间隙耗尽 → 该列整数重编号(保留该列原占用的最小值作基准)
      const seq = [...members];
      seq.splice(idx, 0, t);
      const base = Math.min(...seq.map((x) => x.sort ?? 0));
      seq.forEach((x, i) => { x.sort = base + i; x.updatedAt = now(); });
    }
  }
  t.updatedAt = now();
  dragTaskId = null;
  saveState();
  render();
}

function renderKanban() {
  const board = document.createElement('div');
  board.className = 'todo-kanban';
  for (const col of KANBAN_COLS) {
    const colEl = document.createElement('div');
    colEl.className = 'todo-kanban-col';
    const tasks = kanbanColTasks(col.status);
    colEl.innerHTML = `
      <div class="todo-kanban-head">
        <span class="todo-kanban-dot" style="background:${col.color}"></span>
        <span class="todo-kanban-title">${stLabel(col.status)}</span>
        <span class="todo-kanban-count">${tasks.length}</span>
      </div>`;
    const body = document.createElement('div');
    body.className = 'todo-kanban-body';
    // 落在列空白处 → 追加到列尾
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (e.target === body || e.target.classList.contains('todo-kanban-placeholder')) {
        clearKanbanDropMarks(board);
        body.classList.add('drop-tail');
      }
    });
    body.addEventListener('dragleave', (e) => {
      if (e.target === body) body.classList.remove('drop-tail');
    });
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      clearKanbanDropMarks(board);
      const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
      if (!dragId) return;
      // 若 drop 落在卡片上,由卡片自身的 drop 处理(已 stopPropagation),这里只兜底空白区
      moveTaskInKanban(dragId, col.status, null, false);
    });
    for (const task of tasks) {
      const card = renderTaskCard(task, true, col.status);
      card.classList.add('todo-card-kanban-col', 'todo-card-col-' + col.status);
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        dragTaskId = task.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(task.id));
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => {
        dragTaskId = null;
        card.classList.remove('dragging');
        clearKanbanDropMarks(board);
      });
      // 卡片上悬停 → 按鼠标处于上/下半区决定插到前面还是后面,并画插入线
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (dragTaskId === task.id) return;
        const r = card.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        clearKanbanDropMarks(board);
        card.classList.add(before ? 'todo-card-drop-before' : 'todo-card-drop-after');
      });
      card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget)) {
          card.classList.remove('todo-card-drop-before', 'todo-card-drop-after');
        }
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const before = card.classList.contains('todo-card-drop-before');
        clearKanbanDropMarks(board);
        const dragId = dragTaskId || Number(e.dataTransfer.getData('text/plain')) || null;
        if (!dragId || dragId === task.id) return;
        moveTaskInKanban(dragId, col.status, task.id, before);
      });
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
    // 点击第一行日期文字 → 打开当日事件弹窗(有事件默认「事件列表」,无事件默认「新建事件」)
    topRow.addEventListener('click', (e) => {
      e.stopPropagation();
      dayEventsModal = { date: dayKey };
      dayEvTab = dayEvents.length ? 'list' : 'new';
      render();
    });
    // 事件为空:点击整格(空白区域)也打开当日事件弹窗,并切到「新建事件」标签
    if (!dayEvents.length) {
      cell.classList.add('clickable');
      cell.addEventListener('click', () => {
        dayEventsModal = { date: dayKey };
        dayEvTab = 'new';
        render();
      });
    }
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
  // 当月过生日的人数 + 姓名列表(前 5 名展示)
  const bdayByMonth = new Array(12).fill(null).map(() => []);
  for (const ev of state.todoEvents || []) {
    const k = ev.type === 'birthday' ? eventRemindDate(ev) : (ev.date || null);
    if (!k) continue;
    const yy = parseInt(k.slice(0, 4), 10), mm = parseInt(k.slice(5, 7), 10);
    if (yy === y && mm >= 1 && mm <= 12) {
      evCount[mm - 1]++;
      if (ev.type === 'birthday') bdayByMonth[mm - 1].push(ev.title);
    }
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
    // 当月生日:人数 + 前 5 名人名
    const bdays = bdayByMonth[m];
    if (bdays.length) {
      const bdayRow = document.createElement('div');
      bdayRow.className = 'todo-cal-year-bday';
      bdayRow.textContent = `🎂 ${T('bdayCount', bdays.length)}`;
      cell.appendChild(bdayRow);
      bdays.slice(0, 5).forEach((nm) => {
        const nEl = document.createElement('div');
        nEl.className = 'todo-cal-year-name';
        nEl.textContent = nm;
        nEl.title = nm;
        cell.appendChild(nEl);
      });
      if (bdays.length > 5) {
        const moreEl = document.createElement('div');
        moreEl.className = 'todo-cal-year-more';
        moreEl.textContent = T('morePeople', bdays.length - 5);
        cell.appendChild(moreEl);
      }
    }
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
// 日期输入框始终显示/编辑「公历日期」,农历日期显示在输入框右侧提示;
// 农历生日保存时把公历日期换算为农历月日存储(eventRemindDate 每年按该农历月日换算提醒)。
// 供事件编辑弹窗(保存按钮在弹窗底行 foot)与「当日事件弹窗·新建事件标签」(saveInForm=true 表单内保存)复用。
function buildEventForm(host, existing, presetDate, onSaved, saveInForm = true) {
  const isNew = !existing;
  const draft = { type: existing ? existing.type : 'todo', title: existing ? existing.title : '', note: existing ? existing.note : '', calendar: existing ? (existing.calendar || 'solar') : 'solar', _solarDate: '' };
  // 输入框始终显示公历日期:新建=预填公历;编辑公历生日/非生日=原公历;编辑农历生日=存储农历月日反算回公历
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
  // 标题 label/placeholder 随事件类型变化(生日→名字/纪念日→名称/其它→标题),直观区分类型切换
  const titleLabelFor = (tp) => (tp === 'birthday' ? T('evTitleLabelBday') : (tp === 'anniversary' ? T('evTitleLabelAnni') : T('evTitleLabel')));
  const titlePhFor = (tp) => (tp === 'birthday' ? T('evTitlePhBday') : (tp === 'anniversary' ? T('evTitlePhAnni') : T('evTitlePh')));
  host.innerHTML = `
    <div class="todo-field"><label class="todo-label">${T('evDateLabel')}</label>
      <div class="todo-date-wrap">
        <input class="todo-input" type="date" data-ev-date value="${escHtml(initSolar)}">
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
    <div class="todo-field"><label class="todo-label" data-ev-title-label>${titleLabelFor(draft.type)}</label>
      <input class="todo-input" data-ev-title value="${escHtml(draft.title)}" placeholder="${titlePhFor(draft.type)}" autofocus></div>
    <div class="todo-field"><label class="todo-label">${T('evNoteLabel')}</label>
      <textarea class="todo-input todo-textarea" data-ev-note rows="5" placeholder="${T('evNotePh')}">${escHtml(draft.note)}</textarea></div>
    ${saveInForm ? `<div class="todo-form-actions"><button class="btn primary" data-ev-save>${isNew ? T('newEvent') : T('saveChanges')}</button></div>` : ''}`;
  const bdaySel = host.querySelector('[data-ev-bday]');
  bdaySel.value = draft.type === 'birthday' ? draft.calendar : 'solar';
  const dateInput = host.querySelector('[data-ev-date]');
  const lunarEl = host.querySelector('[data-ev-lunar]');
  // 农历提示:输入框为公历日期,右侧提示该公历日对应的农历月+日(如「农历七月初五」),title 附节气/节日
  const paintLunar = () => {
    const v = dateInput.value;
    if (!v) { lunarEl.textContent = ''; lunarEl.title = ''; return; }
    const p = v.split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) { lunarEl.textContent = ''; lunarEl.title = ''; return; }
    try {
      const li = getLunarInfo(p[0], p[1], p[2]);
      lunarEl.textContent = '农历' + formatLunarMonth(li.lunarMonth, li.isLeapMonth) + formatLunarDay(li.lunarDay);
      lunarEl.title = '农历' + formatLunarMonth(li.lunarMonth, li.isLeapMonth) + formatLunarDay(li.lunarDay)
        + (li.term ? ' · ' + li.term : '') + (li.holiday ? ' · ' + li.holiday : '');
    } catch (e) { lunarEl.textContent = ''; lunarEl.title = ''; }
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
  // 标题 label/placeholder 随类型变化
  const paintTitle = () => {
    const lbl = host.querySelector('[data-ev-title-label]');
    const inp = host.querySelector('[data-ev-title]');
    lbl.textContent = titleLabelFor(draft.type);
    inp.placeholder = titlePhFor(draft.type);
  };
  // 点击/聚焦「公历生日」下拉(即使选中值不变)也要切到生日模式
  const onBdaySelActivate = () => {
    if (draft.type !== 'birthday') {
      draft.type = 'birthday';
      paintTypeBtns();
      paintBdaySel();
      paintTitle();
    }
  };
  host.querySelectorAll('[data-ev-type]').forEach((b) => b.addEventListener('click', () => {
    draft.type = b.dataset.evType;
    // 非生日强制公历;下拉回到默认「公历生日」
    if (draft.type !== 'birthday') draft.calendar = 'solar';
    bdaySel.value = draft.calendar;
    paintTypeBtns();
    paintBdaySel();
    paintTitle();
  }));
  bdaySel.addEventListener('focus', onBdaySelActivate);
  bdaySel.addEventListener('click', onBdaySelActivate);
  bdaySel.addEventListener('change', () => {
    draft.calendar = bdaySel.value;
    draft.type = 'birthday';
    paintTypeBtns();
    paintBdaySel();
    paintTitle();
  });
  const onDateInput = () => {
    draft._solarDate = dateInput.value;
    paintLunar();
  };
  dateInput.addEventListener('input', onDateInput);
  dateInput.addEventListener('change', onDateInput);
  paintTypeBtns();
  paintBdaySel();
  paintLunar();
  paintTitle();
  host.querySelector('[data-ev-title]').addEventListener('input', (e) => { draft.title = e.target.value; });
  host.querySelector('[data-ev-note]').addEventListener('input', (e) => { draft.note = e.target.value; });
  const doSave = () => {
    // 输入框为公历日期:公历生日/非生日直接存公历;农历生日换算为该公历日对应的农历月日存储
    let date = dateInput.value;
    const title = draft.title.trim();
    if (!title) { toast(T('evTitleRequired'), 'warn'); return; }
    if (!date) { toast(T('evTitleRequired'), 'warn'); return; }
    if (draft.type === 'birthday' && draft.calendar === 'lunar') {
      const p = date.split('-').map(Number);
      if (p.length === 3 && p[0] && p[1] && p[2]) {
        const li = getLunarInfo(p[0], p[1], p[2]);
        date = `${p[0]}-${String(li.lunarMonth).padStart(2, '0')}-${String(li.lunarDay).padStart(2, '0')}`;
      }
    }
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
  };
  const saveBtn = host.querySelector('[data-ev-save]');
  if (saveBtn) saveBtn.addEventListener('click', doSave);
  return { doSave, host };
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
      <button class="btn primary" data-ev-save>${isNew ? T('newEvent') : T('saveChanges')}</button>
    </div>`;
  const form = buildEventForm(box.querySelector('[data-ev-form]'), existing, dateStr, close, false);
  box.querySelector('[data-ev-save]').addEventListener('click', () => form.doSave());
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
/** 卡片状态色日期:进行中=橙色开始日期;待办=灰色(截止/开始)日期;已完成=绿色完成日期;无数据留空 */
function cardStatusDate(task) {
  if (task.status === 'done') {
    if (task.completeAt) return { text: fmtShortDate(task.completeAt), cls: 'is-done' };
  } else if (task.status === 'in_progress') {
    if (task.startAt) return { text: fmtShortDate(task.startAt), cls: 'is-progress' };
  } else {
    const t = task.deadline || task.startAt;
    if (t) return { text: fmtShortDate(t), cls: 'is-todo' };
  }
  return null;
}
function renderTaskCard(task, compact = false, colStatus = null) {
  const inKanbanCol = colStatus !== null;
  const card = document.createElement('div');
  card.className = `todo-card${task.status === 'done' ? ' done' : ''}`;
  card.setAttribute('data-task-id', task.id);
  const pri = PRIORITY_CONFIG[task.priority];
  const st = STATUS_CONFIG[task.status];
  const proj = task.projectId ? projectById(task.projectId) : null;
  const subs = task.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  // 未完成在前、已完成置灰排在后面
  const orderedSubs = [...subs].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  const dl = deadlineInfo(task);
  const dateSuffix = cardStatusDate(task);

  const statusBtn = (inKanbanCol && colStatus === 'in_progress')
    ? `<button class="todo-status-btn" data-t="status" title="${stLabel(task.status)} · ${T('clickToggle')}"><img src="tasking64.png" class="todo-status-img" style="width:18px;height:18px;max-width:18px;max-height:18px" alt="◑"></button>`
    : `<button class="todo-status-btn" data-t="status" title="${stLabel(task.status)} · ${T('clickToggle')}" style="border-color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--border)'};color:${task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? 'var(--accent)' : 'var(--text2)'}">${st.icon}</button>`;
  let html = `
    <div class="todo-card-row">
      ${statusBtn}
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
        <button class="todo-sub-toggle" data-t="subtoggle" title="${T('toggleSubtasks')}">
          <span class="todo-sub-toggle-arrow">▾</span>
          <span class="todo-sub-toggle-text">${T('subtasksPrefix', doneSubs, subs.length)}</span>
          <span class="todo-sub-toggle-pct">${Math.round(doneSubs / subs.length * 100)}%</span>
        </button>
        <div class="todo-card-sub-body">
          <div class="todo-card-sub-chips">
            ${orderedSubs.map((s) => `
              <span class="todo-sub-chip${s.done ? ' done' : ''}" data-t="sub" data-sub="${s.id}" title="${escHtml(s.title)}${s.notes ? '\n' + escHtml(s.notes) : ''}${s.doneAt ? '\n' + T('subDoneAt') + ' ' + fmtDateTime(s.doneAt) : ''}${s.createdAt ? '\n' + T('subCreatedOn', fmtFullDate(s.createdAt)) : ''}">
                <span class="todo-sub-chip-icon">${s.done ? '✅' : '⬜'}</span><span class="todo-sub-chip-text">${escHtml(s.title)}</span>${s.done && s.doneAt ? `<span class="todo-sub-chip-date">${fmtShortDate(s.doneAt)}</span>` : ''}
                <button class="todo-sub-chip-edit" data-t="subedit" data-sub="${s.id}" title="${T('editSubtask')}">✎</button>
              </span>`).join('')}
          </div>
          <div class="todo-card-sub-bar">
            <div class="todo-card-sub-track"><div class="todo-card-sub-fill" style="width:${subs.length ? (doneSubs / subs.length) * 100 : 0}%"></div></div>
            <span>${doneSubs}/${subs.length}</span>
          </div>
        </div>
      </div>`;
  }

  html += `
        <div class="todo-card-meta">
          ${task.tags.slice(0, 3).map((tag) => `<span class="todo-tag-chip">${escHtml(tag)}</span>`).join('')}
          ${dl ? `<span class="todo-deadline${dl.overdue ? ' overdue' : ''}${dl.warn ? ' warn' : ''}">${dl.overdue ? '⚠ ' : '📅 '}${dl.text}</span>` : ''}
          ${dateSuffix ? `<span class="todo-card-date ${dateSuffix.cls}">${dateSuffix.text}</span>` : ''}
        </div>
      </div>
      <div class="todo-card-actions">
        <button class="todo-icon-btn" data-t="edit" title="${T('edit')}">✎</button>
        <button class="todo-icon-btn" data-t="menu" title="${T('more')}">⋮</button>
      </div>
    </div>`;
  card.innerHTML = html;

  // 子任务右键菜单(编辑/删除)——阻止冒泡,避免触发卡片菜单
  card.querySelectorAll('.todo-sub-chip').forEach((chip) => {
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const real = taskById(task.id) || task;
      openSubMenu(real, chip.dataset.sub, e.clientX, e.clientY);
    });
  });
  let subMenuEl = null;
  function openSubMenu(tk, subId, atX, atY) {
    closeSubMenu();
    // 清理任何遗留的子任务菜单(render 重绘后可能残留在 body 上)
    document.querySelectorAll('.todo-sub-menu').forEach((el) => el.remove());
    const sub = (tk.subtasks || []).find((x) => x.id === subId);
    if (!sub) return;
    subMenuEl = document.createElement('div');
    subMenuEl.className = 'todo-card-menu todo-sub-menu';
    subMenuEl.innerHTML = `
      <button data-sm="edit">${T('edit')}</button>
      <button data-sm="delete" class="danger">${T('delete')}</button>`;
    // .todo-card-menu 是 position:fixed,坐标必须相对视口 → 挂到 body 并用 clientX/Y
    document.body.appendChild(subMenuEl);
    const mr = subMenuEl.getBoundingClientRect();
    let lx = atX, ty = atY;
    if (lx + mr.width > window.innerWidth - 8) lx = Math.max(8, window.innerWidth - mr.width - 8);
    if (ty + mr.height > window.innerHeight - 8) ty = Math.max(8, atY - mr.height);
    subMenuEl.style.left = lx + 'px';
    subMenuEl.style.top = ty + 'px';
    subMenuEl.addEventListener('click', (ev) => {
      const mb = ev.target.closest('[data-sm]');
      if (!mb) return;
      ev.stopPropagation();
      const m = mb.dataset.sm;
      closeSubMenu();
      if (m === 'edit') { modalInitialTab = 'subtasks'; modalHighlightSub = subId; taskModalOpen = true; modalTaskId = tk.id; render(); }
      else if (m === 'delete') {
        confirmDialog({ title: T('delSubTitle'), message: T('delSubMsg', sub.title), okText: T('delete'), danger: true, onOk: () => {
          tk.subtasks = (tk.subtasks || []).filter((x) => x.id !== subId);
          saveState(); render();
        } });
      }
    });
    setTimeout(() => document.addEventListener('click', closeSubMenu, true), 0);
  }
  // 外部点击关闭:必须先判断 contains,否则 capture 阶段会先移除菜单,
  // 导致菜单内 [data-sm] 的 click 永远收不到(与补丁·37 卡片菜单同类 bug)。
  function closeSubMenu(e) {
    if (e && subMenuEl && subMenuEl.contains(e.target)) return;
    if (subMenuEl) { subMenuEl.remove(); subMenuEl = null; }
    document.removeEventListener('click', closeSubMenu, true);
  }

  // 右键/⋮ 菜单(编辑/归档/删除) — 跟随触发位置弹出
  let menuEl = null;
  function openCardMenu(tk, atX, atY) {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    menuEl = document.createElement('div');
    menuEl.className = 'todo-card-menu';
    menuEl.innerHTML = `
      <button data-m="edit">${T('edit')}</button>
      <button data-m="archive">${T('archive')}</button>
      <button data-m="delete" class="danger">${T('delete')}</button>`;
    document.body.appendChild(menuEl);
    // 定位:紧挨触发点,默认向下向右;视口越界自动反向/钳制
    const m = menuEl.getBoundingClientRect();
    let lx = atX, ty = atY;
    if (lx + m.width > window.innerWidth - 8) lx = Math.max(8, window.innerWidth - m.width - 8);
    if (ty + m.height > window.innerHeight - 8) ty = Math.max(8, atY - m.height);
    menuEl.style.left = lx + 'px';
    menuEl.style.top = ty + 'px';
    menuEl.addEventListener('click', (ev) => {
      const mb = ev.target.closest('[data-m]');
      if (!mb) return;
      menuEl.remove(); menuEl = null;
      document.removeEventListener('click', closeMenuOutside, true);
      const m = mb.dataset.m;
      if (m === 'edit') { taskModalOpen = true; modalTaskId = tk.id; render(); }
      else if (m === 'archive') { tk.archived = true; tk.updatedAt = now(); saveState(); render(); }
      else if (m === 'delete') {
        confirmDialog({ title: T('deleteTaskTitle'), message: T('deleteTaskMsg', tk.title), okText: T('del'), danger: true, onOk: () => { removeTask(tk.id); render(); } });
      }
    });
    setTimeout(() => document.addEventListener('click', closeMenuOutside, true), 0);
  }
  function closeMenuOutside(e) {
    // 仅在点击发生在 menuEl 外部时才关闭;否则会被 capture 阶段先移除 menuEl,
    // 导致 menuEl 自身的 click 监听无法触发(右键菜单 delete 不响应的根因)。
    if (menuEl && (!e || !menuEl.contains(e.target))) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('click', closeMenuOutside, true);
  }
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const real = taskById(task.id) || task;
    openCardMenu(real, e.clientX, e.clientY);
  });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) { openDetail(task.id); return; }
    e.stopPropagation();
    const t = b.dataset.t;
    const real = taskById(task.id) || task;
    if (t === 'status') { cycleStatus(real); }
    else if (t === 'priority') { cyclePriority(real); }
    else if (t === 'subedit') {
      // 子任务悬停 ✎:打开编辑弹窗并定位到子任务 tab,高亮该行
      modalInitialTab = 'subtasks';
      modalHighlightSub = b.dataset.sub;
      taskModalOpen = true; modalTaskId = real.id; render();
    }
    else if (t === 'sub') { toggleSubtask(real, b.dataset.sub); }
    else if (t === 'subtoggle') { toggleSubtasksCollapse(real, b); }
    else if (t === 'edit') { taskModalOpen = true; modalTaskId = real.id; render(); }
    else if (t === 'menu') {
      // ⋮ 按钮:菜单出现在按钮左下方(贴近按钮)
      const r = b.getBoundingClientRect();
      openCardMenu(real, r.left, r.bottom + 2);
    }
  });
  return card;
}

function openDetail(id) { detailTaskId = id; render(); }

function cycleStatus(task) {
  const next = STATUS_CYCLE[task.status];
  task.status = next;
  if (next === 'done' && !task.completeAt) task.completeAt = now();
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
  if (s.done && !s.doneAt) s.doneAt = now();
  if (!s.done) s.doneAt = null;
  saveState();
  render();
}
// 折叠/展开卡片子任务区(chips + 进度条)
function toggleSubtasksCollapse(task, btn) {
  const wrap = btn.closest('.todo-card-subs');
  if (!wrap) return;
  wrap.classList.toggle('collapsed');
  const arrow = btn.querySelector('.todo-sub-toggle-arrow');
  if (arrow) arrow.textContent = wrap.classList.contains('collapsed') ? '▸' : '▾';
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
        <button class="todo-tab-btn" data-tab="events">${T('eventsTab')}${task && (task.events || []).length ? ` (${task.events.length})` : ''}</button>
      </div>
      <button class="todo-icon-btn" data-close title="${T('close')}">✕</button>
    </div>
    <div class="todo-modal-body" data-body></div>
    <div class="todo-modal-foot">
      <button class="btn" data-close>${T('cancel')}</button>
      <button class="btn primary" data-save>${isNew ? T('createTask') : T('saveChanges')}</button>
    </div>`;

  let tab = modalInitialTab || 'details';
  modalInitialTab = 'details';
  box.querySelectorAll('.todo-tab-btn').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  // 输入暂存(每次渲染细节 tab 后同步回来)
  const draft = {
    title: task ? task.title : '',
    notes: task ? task.notes : '',
    priority: task ? task.priority : 'medium',
    status: task ? task.status : 'todo',
    deadline: task && task.deadline ? tsToDateInput(task.deadline) : '',
    startAt: task && task.startAt ? tsToDateTimeLocal(task.startAt) : '',
    completeAt: task && task.completeAt ? tsToDateTimeLocal(task.completeAt) : '',
    projectId: task ? task.projectId : '',
    parentTaskId: task ? (task.parentTaskId || '') : '',
    tags: task ? [...task.tags] : [],
    tagInput: '',
    subtaskInput: '',
    subtasks: task ? task.subtasks.map((s) => ({ ...s })) : [],
    events: task ? (task.events || []).map((e) => ({ ...e })) : [],
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
          <div class="todo-field" style="flex:1"><label class="todo-label">${T('parentTaskLabel')}</label>
            <select class="todo-input" data-d="parentTaskId">
              <option value="">${T('noParentTask')}</option>
              ${state.todoTasks
                .filter((t) => (t.projectId || '') === (draft.projectId || '') && t.id !== (task ? task.id : '') && !isTaskDescendant(t.id, task ? task.id : ''))
                .map((t) => `<option value="${t.id}"${draft.parentTaskId === t.id ? ' selected' : ''}>${escHtml(t.title)}</option>`).join('')}
            </select></div>
        </div>
        <div class="todo-field"><label class="todo-label">${T('deadlineLabel')}</label>
          <input class="todo-input" type="date" data-d="deadline" value="${draft.deadline}"></div>
        <div class="todo-field-row">
          <div class="todo-field" style="flex:1"><label class="todo-label">${T('startAtLabel')}</label>
            <input class="todo-input" type="datetime-local" data-d="startAt" value="${draft.startAt}"></div>
          <div class="todo-field" style="flex:1"><label class="todo-label">${T('completeAtLabel')}</label>
            <input class="todo-input" type="datetime-local" data-d="completeAt" value="${draft.completeAt}"></div>
        </div>
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
      bodyEl.querySelector('[data-d="projectId"]').addEventListener('change', (e) => { draft.projectId = e.target.value; draft.parentTaskId = ''; renderBody(); });
      bodyEl.querySelector('[data-d="parentTaskId"]').addEventListener('change', (e) => { draft.parentTaskId = e.target.value; });
      bodyEl.querySelector('[data-d="deadline"]').addEventListener('change', (e) => { draft.deadline = e.target.value; });
      bodyEl.querySelector('[data-d="startAt"]').addEventListener('change', (e) => { draft.startAt = e.target.value; });
      bodyEl.querySelector('[data-d="completeAt"]').addEventListener('change', (e) => { draft.completeAt = e.target.value; });
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
    } else if (tab === 'subtasks') {
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
            <input class="todo-input" data-sub-input placeholder="${T('addStepPh')}" style="flex:1">
            <button class="btn" data-add-sub>${T('add')}</button>
          </div>
          <input class="todo-input todo-sub-add-notes" data-sub-add-notes placeholder="${T('subNotesPh')}" style="margin-top:6px;width:100%">
        </div>`;
      const listEl = bodyEl.querySelector('.todo-sub-list');
      if (listEl) {
        subs.forEach((s, idx) => {
          const row = document.createElement('div');
          row.className = 'todo-sub-row';
          row.draggable = true;
          // 两行布局:上行 拖拽/上下移/状态/标题/删除;下行 备注 + 完成日期(仅已完成可编辑)
          row.innerHTML = `
            <div class="todo-sub-row-top">
              <span class="todo-sub-grip" title="${T('dragToReorder')}">⠿</span>
              <div class="todo-sub-arrows">
                <button data-sub-up="${idx}" title="${T('moveUp')}" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button data-sub-down="${idx}" title="${T('moveDown')}" ${idx === subs.length - 1 ? 'disabled' : ''}>▼</button>
              </div>
              <button class="todo-status-btn" data-sub-toggle="${s.id}" style="border-color:${s.done ? '#22c55e' : 'var(--border)'};color:${s.done ? '#22c55e' : 'var(--text2)'}">${s.done ? '✅' : '⬜'}</button>
              <span class="todo-sub-title${s.done ? ' done' : ''}" data-sub-rename="${s.id}" title="${T('doubleClickRename')}">${escHtml(s.title)}</span>
              <button class="todo-icon-btn" data-sub-del="${s.id}" title="${T('del')}">✕</button>
            </div>
            <div class="todo-sub-row-bottom">
              <input class="todo-input todo-sub-notes" data-sub-notes="${s.id}" placeholder="${T('subNotesPh')}" value="${escHtml(s.notes || '')}">
              <label class="todo-sub-doneat-label" title="${s.done ? T('subDoneAtLabel') : T('subDoneAtDisabledTip')}">
                <span>${T('subDoneAtLabel')}</span>
                <input type="datetime-local" class="todo-input todo-sub-doneat" data-sub-doneat="${s.id}"
                  value="${s.doneAt ? tsToDateTimeLocal(s.doneAt) : ''}" ${s.done ? '' : 'disabled'}>
              </label>
              <span class="todo-sub-created" title="${T('subCreatedOn', fmtFullDate(s.createdAt))}">🕓 ${T('subCreatedOn', fmtShortDate(s.createdAt))}</span>
            </div>`;
          if (modalHighlightSub && s.id === modalHighlightSub) row.classList.add('highlight');
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
          else if (tog) { const s = subs.find((x) => x.id === tog.dataset.subToggle); if (s) { s.done = !s.done; if (s.done && !s.doneAt) s.doneAt = now(); if (!s.done) s.doneAt = null; renderBody(); } }
          else if (del) { const id = del.dataset.subDel; draft.subtasks = subs.filter((x) => x.id !== id); renderBody(); }
        });
        listEl.addEventListener('input', (e) => {
          const ne = e.target.closest('[data-sub-notes]');
          if (!ne) return;
          const s = subs.find((x) => x.id === ne.dataset.subNotes);
          if (s) s.notes = ne.value;
        });
        // 完成日期修改:datetime-local → 秒时间戳(与 now() 单位一致,见补丁·41)
        listEl.addEventListener('change', (e) => {
          const de = e.target.closest('[data-sub-doneat]');
          if (!de) return;
          const s = subs.find((x) => x.id === de.dataset.subDoneat);
          if (!s) return;
          s.doneAt = de.value ? dateTimeLocalToTs(de.value) : null;
        });
        // 高亮定位:悬停 ✎ / 右键编辑进来时滚动到该子任务并短暂高亮
        if (modalHighlightSub) {
          const hit = listEl.querySelector('.todo-sub-row.highlight');
          if (hit) {
            hit.scrollIntoView({ block: 'nearest' });
            setTimeout(() => hit.classList.remove('highlight'), 2000);
          }
          modalHighlightSub = '';
        }
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
        const nInp = bodyEl.querySelector('[data-sub-add-notes]');
        const notes = nInp ? nInp.value.trim() : '';
        draft.subtasks.push({ id: uid('s'), title: v, done: false, sort: draft.subtasks.length, notes, doneAt: null, createdAt: now() });
        inp.value = '';
        if (nInp) nInp.value = '';
        renderBody();
      }
    } else if (tab === 'events') {
      // 任务事件(时间戳日志)
      const evs = draft.events;
      const sorted = [...evs].sort((a, b) => (b.at || 0) - (a.at || 0));
      bodyEl.innerHTML = `
        <div class="todo-events">
          ${sorted.length ? `
            <div class="todo-events-list">
              ${sorted.map((ev) => `
                <div class="todo-event-row" data-ev="${ev.id}">
                  <input type="datetime-local" class="todo-input todo-event-at" data-ev-at="${ev.id}" value="${tsToDateTimeLocal(ev.at)}" title="${T('startAtLabel')}">
                  <input class="todo-input todo-event-text" data-ev-text="${ev.id}" placeholder="${T('eventTextPh')}" value="${escHtml(ev.text || '')}">
                  <button class="todo-icon-btn" data-ev-del="${ev.id}" title="${T('del')}">✕</button>
                </div>`).join('')}
            </div>` : `<div class="todo-empty-desc">${T('noEvents')}</div>`}
          <button class="btn" data-add-event>+ ${T('addEvent')}</button>
        </div>`;
      bodyEl.querySelectorAll('[data-ev-at]').forEach((el) => el.addEventListener('change', (e) => {
        const ev = draft.events.find((x) => x.id === e.target.dataset.evAt);
        if (ev) ev.at = dateTimeLocalToTs(e.target.value) || now();
      }));
      bodyEl.querySelectorAll('[data-ev-text]').forEach((el) => el.addEventListener('input', (e) => {
        const ev = draft.events.find((x) => x.id === e.target.dataset.evText);
        if (ev) ev.text = e.target.value;
      }));
      bodyEl.querySelectorAll('[data-ev-del]').forEach((el) => el.addEventListener('click', (e) => {
        const id = e.target.dataset.evDel;
        draft.events = draft.events.filter((x) => x.id !== id);
        renderBody();
      }));
      const addBtn = bodyEl.querySelector('[data-add-event]');
      if (addBtn) addBtn.addEventListener('click', () => {
        const ev = { id: uid('e'), at: now(), text: '', createdAt: now() };
        draft.events.push(ev);
        renderBody();
        const inp = bodyEl.querySelector(`[data-ev-text="${ev.id}"]`);
        if (inp) { inp.focus(); }
      });
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
    const startAt = dateTimeLocalToTs(draft.startAt);
    let completeAt = dateTimeLocalToTs(draft.completeAt);
    if (draft.status === 'done' && !completeAt) completeAt = now();
    if (isNew) {
      const t = {
        id: uid('t'), title,
        notes: draft.notes, notesHtml: draft.notes,
        priority: draft.priority, status: draft.status,
        deadline: dateInputToTs(draft.deadline), startAt, completeAt, events: draft.events, reminderAt: null,
        sort: liveTasks().length, tags: draft.tags,
        projectId: draft.projectId, parentTaskId: draft.parentTaskId || '', recurRule: '',
        archived: false, subtasks: draft.subtasks, createdAt: now(), updatedAt: now(),
      };
      upsertTask(t);
    } else {
      Object.assign(task, {
        title, notes: draft.notes, notesHtml: draft.notes,
        priority: draft.priority, status: draft.status,
        deadline: dateInputToTs(draft.deadline), startAt, completeAt, events: draft.events,
        tags: draft.tags, projectId: draft.projectId, parentTaskId: draft.parentTaskId || '',
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
      ${task.startAt ? `
        <div class="todo-detail-deadline">
          <span>🚀</span>
          <div><div class="todo-detail-label">${T('startAtLabel')}</div>
          <div class="todo-detail-value">${fmtDateTime(task.startAt)}</div></div>
        </div>` : ''}
      ${task.completeAt ? `
        <div class="todo-detail-deadline">
          <span>🏁</span>
          <div><div class="todo-detail-label">${T('completeAtLabel')}</div>
          <div class="todo-detail-value">${fmtDateTime(task.completeAt)}</div></div>
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
              <button class="todo-status-btn" data-act="sub" data-sub="${s.id}" style="border-color:${s.done ? '#22c55e' : 'var(--border)'};color:${s.done ? '#22c55e' : 'var(--text2)'}">${s.done ? '✅' : '⬜'}</button>
              <span class="${s.done ? 'done' : ''}">${escHtml(s.title)}</span>
              ${s.notes ? `<span class="todo-detail-sub-notes">📝 ${escHtml(s.notes)}</span>` : ''}
              ${s.doneAt ? `<span class="todo-detail-sub-date">${T('subDoneAt')} ${fmtDateTime(s.doneAt)}</span>` : ''}
            </div>`).join('')}
        </div>` : ''}
      ${(task.events || []).length ? `
        <div class="todo-detail-section">
          <div class="todo-detail-label">${T('eventsSection')}</div>
          <div class="todo-detail-events">
            ${[...task.events].sort((a, b) => (b.at || 0) - (a.at || 0)).map((ev) => `
              <div class="todo-detail-event">
                <span class="todo-detail-event-time">${fmtDateTime(ev.at)}</span>
                <span class="todo-detail-event-text">${escHtml(ev.text || '')}</span>
              </div>`).join('')}
          </div>
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
        task.startAt ? `🚀 ${T('startAtLabel')}: ${fmtDateTime(task.startAt)}` : null,
        task.completeAt ? `🏁 ${T('completeAtLabel')}: ${fmtDateTime(task.completeAt)}` : null,
        task.tags.length ? T('tagsPrefix', task.tags.join(', ')) : null,
        task.notes ? `\n${task.notes}` : null,
        subs.length ? `\n${T('subtasksPrefix', doneSubs, subs.length)}\n${subs.map((s) => `  ${s.done ? '✓' : '○'} ${s.title}${s.doneAt ? ` (${fmtDateTime(s.doneAt)})` : ''}`).join('\n')}` : null,
        (task.events || []).length ? `\n${T('eventsSection')}:\n${[...task.events].sort((a, b) => (a.at || 0) - (b.at || 0)).map((ev) => `  ${fmtDateTime(ev.at)} ${ev.text || ''}`).join('\n')}` : null,
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
        <input class="todo-input" data-new-name placeholder="${T('projectNamePh')}" style="width:100%;margin:6px 0 8px">
        <div style="display:flex;align-items:flex-end;gap:8px">
          <div class="todo-color-row">${PROJECT_COLORS.map((c) => `<button class="todo-color-btn" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
          <select class="todo-input" data-new-parent style="flex:1;min-width:90px">
            <option value="">${T('noParentProject')}</option>
            ${state.todoProjects.map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}
          </select>
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
    const parentId = box.querySelector('[data-new-parent]').value || '';
    upsertProject({ id: uid('p'), name, color: newColor, sort: state.todoProjects.length, parentId, createdAt: now(), updatedAt: now() });
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
      const wrap = document.createElement('div');
      wrap.className = 'todo-proj-edit';
      wrap.innerHTML = `
        <input class="todo-input todo-proj-edit-name" value="${escHtml(p.name)}" style="flex:1">
        <select class="todo-input todo-proj-edit-parent" style="flex:1;min-width:80px">
          <option value="">${T('noParentProject')}</option>
          ${state.todoProjects.filter((x) => x.id !== p.id && !isProjectDescendant(x.id, p.id)).map((x) => `<option value="${x.id}"${x.id === p.parentId ? ' selected' : ''}>${escHtml(x.name)}</option>`).join('')}
        </select>`;
      edit.replaceWith(wrap);
      const nameInput = wrap.querySelector('.todo-proj-edit-name');
      nameInput.focus(); nameInput.select();
      const commit = () => {
        const v = nameInput.value.trim();
        const np = wrap.querySelector('.todo-proj-edit-parent').value || '';
        if (v) p.name = v;
        p.parentId = np;
        p.updatedAt = now();
        saveState();
        render();
      };
      nameInput.addEventListener('blur', commit);
      nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') render(); });
      wrap.querySelector('.todo-proj-edit-parent').addEventListener('change', commit);
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
      // 内联二级确认:点 × 按钮后,行内显示"✓ 删除 / 取消"两按钮,
      // 不弹全局 confirmDialog,避免在 .todo-overlay 之上再叠 .modal-mask 造成双层黑罩"调暗"。
      // 6 秒无操作自动撤销,避免误操作永久卡住。
      const row = del.closest('.todo-archive-row');
      if (!row) return;
      if (row._confirming) return; // 已经在二次确认态,避免重复触发
      row._confirming = true;
      const origHTML = row.innerHTML;
      const taskTitle = (() => { const t = taskById(del.dataset.del); return t ? t.title : ''; })();
      row.innerHTML = `
        <div class="todo-archive-main">
          <div class="todo-archive-title" style="color:#ef4444">${T('deleteForeverTitle')}「${escHtml(taskTitle)}」?</div>
          <div class="todo-archive-meta" style="color:#ef4444">${T('deleteForeverMsg', taskTitle)}</div>
        </div>
        <button class="btn danger" data-del-confirm="${del.dataset.del}">✓ ${T('del')}</button>
        <button class="btn" data-del-cancel>${T('cancel')}</button>`;
      const clear = () => { row._confirming = false; clearTimeout(row._delTimer); };
      row._delTimer = setTimeout(() => { if (row._confirming) { row.innerHTML = origHTML; clear(); } }, 6000);
      row.querySelector('[data-del-cancel]').addEventListener('click', () => { row.innerHTML = origHTML; clear(); });
      row.querySelector('[data-del-confirm]').addEventListener('click', () => { removeTask(del.dataset.del); archiveOpen = false; render(); });
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
    const headers = [T('csvId'), T('csvTitle'), T('csvNotes'), T('csvPriority'), T('csvStatus'), T('csvDeadline'), T('csvStartAt'), T('csvCompleteAt'), T('csvTags'), T('csvProject'), T('csvSubtasks'), T('csvCreated')];
    const rows = tasks.map((t) => {
      const proj = t.projectId ? (projectById(t.projectId)?.name || '') : '';
      const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        t.id, csv(t.title), csv(t.notes), t.priority, t.status,
        t.deadline ? tsToDateInput(t.deadline) : '',
        t.startAt ? tsToDateTimeLocal(t.startAt) : '',
        t.completeAt ? tsToDateTimeLocal(t.completeAt) : '',
        csv(t.tags.join(', ')), csv(proj),
        csv((t.subtasks || []).map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}${s.doneAt ? ` @${fmtDateTime(s.doneAt)}` : ''}`).join('; ')),
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
    const startAt = typeof t.startAt === 'number' ? t.startAt : (t.start_at != null ? parseDeadline(t.start_at) : null);
    const completeAt = typeof t.completeAt === 'number' ? t.completeAt : (t.complete_at != null ? parseDeadline(t.complete_at) : null);
    const events = Array.isArray(t.events) ? t.events.filter((e) => e && typeof e === 'object').map((e) => ({
      id: uid('e'), at: typeof e.at === 'number' ? e.at : (e.at != null ? parseDeadline(e.at) : now()),
      text: typeof e.text === 'string' ? e.text : '', createdAt: now(),
    })) : [];
    const taskId = uid('t');
    state.todoTasks.push({
      id: taskId, title,
      notes: typeof t.notes === 'string' ? t.notes : '',
      notesHtml: typeof t.notesHtml === 'string' ? t.notesHtml : (typeof t.notes_html === 'string' ? t.notes_html : (typeof t.notes === 'string' ? t.notes : '')),
      priority, status, deadline, startAt, completeAt, events, reminderAt: null,
      sort: baseSort + i, tags, projectId, recurRule: '', archived: false,
      subtasks: rawSubs.map((s, j) => ({
        id: uid('s'), taskId, title: (typeof s.title === 'string' && s.title.trim()) ? s.title.trim() : T('untitledStep'),
        done: !!s.done, sort: j, createdAt: now(),
        notes: typeof s.notes === 'string' ? s.notes : '',
        doneAt: typeof s.doneAt === 'number' ? s.doneAt : (s.done ? now() : null),
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
