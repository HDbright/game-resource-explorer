'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');

/**
 * 数据目录与应用同目录的 data 子目录(便携式):
 * - 打包版: <exe所在目录>/data/skeleton.db
 * - 开发版: 项目根目录/data/skeleton.db
 */
function dataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'data');
  }
  return path.join(__dirname, '..', 'data');
}

function dbFile() {
  return path.join(dataDir(), 'skeleton.db');
}

function defaultDb() {
  return {
    version: 2,
    settings: {
      playMode: 'loop',
      timeScale: 1,
      bgColor: '#22242b',
      showBones: false,
      lastCategoryId: 'all',
      lastItemId: null,
      zoomMode: '100', // 'fit' 适配窗口 | '100' 固定100% | 'fixed' 跟随缩放滑块数值
      resourceTab: 'home', // 'anim' | 'image' | 'audio' | 'home'
      listViewMode: 'list', // 'detail' | 'list' | 'icon'
      listSortBy: 'name', // 'name' | 'type' | 'size' | 'date'
      listSortDir: 'asc', // 'asc' | 'desc'
    },
    categories: [],
    items: [],
    favCategories: [],
    favItems: [],
    sceneCategories: [],
    scenes: [],
    webBookmarkCategories: [],
    webBookmarks: [],
    // 开发工具箱:API 管理(分类树可嵌套 + 项目 + API 数据字典)
    apiCategories: [],
    apiProjects: [],
    apiEndpoints: [],
    // 资源工具箱:可嵌套目录树(用户目录 + 内置工具链接)
    toolboxFolders: [],
    // 侧栏菜单管理:整棵侧栏菜单树的节点(目录 + 终端,可改名/排序/移动/改图标)
    menuNodes: [],
    // 项目管理中心:项目主配置(生命周期管理:启动/停止前后端服务 + 文档资源目录)
    projects: [],
    projectEntries: [],
    // Todo-List 任务管理(移植自 taskwingo):项目 + 任务(含子任务) + 日历事件
    todoProjects: [],
    todoTasks: [],
    todoEvents: [],
  };
}

let db = null;

function open() {
  if (db) return db;
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      type_tags TEXT DEFAULT '[]',
      locked INTEGER DEFAULT 0,
      show_items_in_tree INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS items(
      id TEXT PRIMARY KEY,
      category_id TEXT DEFAULT '',
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      atlas_path TEXT,
      display_name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      meta TEXT DEFAULT NULL, -- JSON: 视频/一般元信息(海报图路径、评分、简介、导演、演员、年份等)
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fav_categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fav_items(
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      fav_category_id TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS scene_categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS scenes(
      id TEXT PRIMARY KEY,
      category_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      type TEXT DEFAULT 'folder',
      remark TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      size INTEGER,
      mtime INTEGER,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 网址收藏夹(网络资源抓取):分类树(可嵌套) + 网址条目
    CREATE TABLE IF NOT EXISTS web_bookmark_categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS web_bookmarks(
      id TEXT PRIMARY KEY,
      category_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      remark TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 开发工具箱:API 管理(分类树可嵌套 + 项目 + API 数据字典)
    CREATE TABLE IF NOT EXISTS api_categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      remark TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS api_projects(
      id TEXT PRIMARY KEY,
      category_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      base_url TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS api_endpoints(
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      method TEXT DEFAULT 'GET',
      path TEXT DEFAULT '',
      desc TEXT DEFAULT '',
      params TEXT DEFAULT '[]',
      headers TEXT DEFAULT '[]',
      body TEXT DEFAULT '',
      response TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 资源工具箱:可嵌套的目录树(用户自定义目录 + 内置工具链接)
    -- tool_id 为空 → 目录(可含子目录/工具链接);非空 → 内置工具链接(astc2png 等 / __fgui_editor__)
    CREATE TABLE IF NOT EXISTS toolbox_folders(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      tool_id TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 侧栏菜单管理:整棵侧栏菜单树
    -- node_type: 'dir' 目录节点 | 'term' 终端节点(点击后在主区打开页面/调用外部程序)
    -- action_type: ''(目录) | 'builtin' 内置页面/工具 | 'exe' 外部程序
    -- action: builtin 时存内置动作 id(如 page:settings / tool:astc2png / res:anim);exe 时存程序路径
    -- icon: 目录/终端节点图标(emoji);tooltip: 悬停提示;note: 备注
    CREATE TABLE IF NOT EXISTS menu_nodes(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '',
      parent_id TEXT DEFAULT '',
      node_type TEXT DEFAULT 'dir',
      action_type TEXT DEFAULT '',
      action TEXT DEFAULT '',
      tooltip TEXT DEFAULT '',
      note TEXT DEFAULT '',
      type_tags TEXT DEFAULT '[]',
      is_resource INTEGER DEFAULT 0,
      locked INTEGER DEFAULT 0,
      show_items_in_tree INTEGER DEFAULT 1,
      hidden INTEGER DEFAULT 0,
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- Todo-List 任务管理(移植自 taskwingo):项目 / 任务 / 子任务
    CREATE TABLE IF NOT EXISTS todo_projects(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      sort INTEGER DEFAULT 0,
      parent_id TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      deadline INTEGER DEFAULT 0,
      complete_at INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS todo_tasks(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '',
      notes_html TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'todo',
      deadline INTEGER,
      reminder_at INTEGER,
      start_at INTEGER,
      complete_at INTEGER,
      events TEXT DEFAULT '[]',
      sort REAL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      project_id TEXT DEFAULT '',
      parent_task_id TEXT DEFAULT '',
      recur_rule TEXT DEFAULT '',
      archived INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0,
      subs_collapsed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS todo_subtasks(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      parent_sub_id TEXT,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '',
      done INTEGER DEFAULT 0,
      done_at INTEGER,
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      -- 补丁·60:子任务独立字段(优先级/项目/父级/截止日期/开始时间/完成时间/标签/更新时间)
      priority TEXT DEFAULT 'medium',
      project_id TEXT DEFAULT '',
      parent_task_id TEXT DEFAULT '',
      deadline INTEGER DEFAULT 0,
      start_at INTEGER,
      complete_at INTEGER,
      tags TEXT DEFAULT '[]',
      updated_at INTEGER DEFAULT 0,
      collapsed INTEGER DEFAULT 0
    );
    -- Todo-List 日历事件(生日/纪念日/待办事件/重要事件记录)
    CREATE TABLE IF NOT EXISTS todo_events(
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'todo',
      calendar TEXT DEFAULT 'solar',
      title TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_todo_events_date ON todo_events(date);
    CREATE INDEX IF NOT EXISTS idx_todo_tasks_sort ON todo_tasks(sort);
    CREATE INDEX IF NOT EXISTS idx_todo_tasks_archived ON todo_tasks(archived);
    CREATE INDEX IF NOT EXISTS idx_todo_subtasks_task ON todo_subtasks(task_id);
    -- 计时(补丁·96):自定义计时类型 + 秒表/倒计时保存的记录
    CREATE TABLE IF NOT EXISTS time_types(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#5c9cff',
      icon TEXT DEFAULT '⏱',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS time_records(
      id TEXT PRIMARY KEY,
      type_ids TEXT DEFAULT '[]',
      start_ts INTEGER DEFAULT 0,
      end_ts INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'stopwatch',
      show_calendar INTEGER DEFAULT 1,
      note TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_time_records_start ON time_records(start_ts);
    -- 闹钟(补丁·98):到点提醒, 支持重复与自定义声音
    CREATE TABLE IF NOT EXISTS alarms(
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      repeat TEXT DEFAULT 'once',
      days TEXT DEFAULT '[]',
      label TEXT DEFAULT '',
      sound TEXT DEFAULT 'beep',
      sound_path TEXT DEFAULT '',
      sound_name TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      last_ring TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 项目管理中心(补丁·113):项目主配置 + 项目资源/文档条目
    -- status: 'running' 运行中 | 'stopped' 已停止 | 'error' 异常(实时探测优先,落库为最近已知状态)
    CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'stopped',
      description TEXT DEFAULT '',
      root_path TEXT DEFAULT '',
      access_url TEXT DEFAULT '',
      website TEXT DEFAULT '',
      launch_path TEXT DEFAULT '',
      deploy_method TEXT DEFAULT '',
      launch_method TEXT DEFAULT '',
      frontend_cmd TEXT DEFAULT '',
      frontend_url TEXT DEFAULT '',
      backend_cmd TEXT DEFAULT '',
      backend_url TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      menu_node_id TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    -- 项目资源/文档条目:folder_id 关联项目子目录菜单节点 id('' = 项目根目录)
    -- type: 'doc' 文档 | 'link' 链接 | 'file' 本地文件
    CREATE TABLE IF NOT EXISTS project_entries(
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      type TEXT DEFAULT 'doc',
      content TEXT DEFAULT '',
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_project_entries_project ON project_entries(project_id);
  `);
  // 旧库迁移:categories 缺 parent_id 列时补上(子分类支持)
  try {
    const cols = db.prepare('PRAGMA table_info(categories)').all().map((r) => r.name);
    if (!cols.includes('parent_id')) {
      db.exec('ALTER TABLE categories ADD COLUMN parent_id TEXT DEFAULT \'\'');
    }
    // 旧库迁移:categories 缺 type_tags 列时补上(目录资源类型标签,JSON 数组字符串)
    if (!cols.includes('type_tags')) {
      db.exec("ALTER TABLE categories ADD COLUMN type_tags TEXT DEFAULT '[]'");
    }
    // 旧库迁移:categories 缺 locked 列时补上(锁定分类,禁止删除)
    if (!cols.includes('locked')) {
      db.exec('ALTER TABLE categories ADD COLUMN locked INTEGER DEFAULT 0');
    }
    // 旧库迁移:categories 缺 show_items_in_tree 列时补上(菜单树中是否列出该目录资源文件)
    if (!cols.includes('show_items_in_tree')) {
      db.exec('ALTER TABLE categories ADD COLUMN show_items_in_tree INTEGER DEFAULT 1');
    }
  } catch (err) {
    console.error('[db] migrate categories parent_id/type_tags/locked error:', err);
  }
  // 旧库迁移:toolbox_folders 缺 icon 列时补上(目录/工具自定义图标)
  try {
    const tfCols = db.prepare('PRAGMA table_info(toolbox_folders)').all().map((r) => r.name);
    if (!tfCols.includes('icon')) {
      db.exec("ALTER TABLE toolbox_folders ADD COLUMN icon TEXT DEFAULT ''");
    }
  } catch (err) {
    console.error('[db] migrate toolbox_folders icon error:', err);
  }
  // 旧库迁移:menu_nodes 缺 type_tags / is_resource 列时补上
  try {
    const mnCols = db.prepare('PRAGMA table_info(menu_nodes)').all().map((r) => r.name);
    if (!mnCols.includes('type_tags')) {
      db.exec("ALTER TABLE menu_nodes ADD COLUMN type_tags TEXT DEFAULT '[]'");
    }
    if (!mnCols.includes('is_resource')) {
      db.exec('ALTER TABLE menu_nodes ADD COLUMN is_resource INTEGER DEFAULT 0');
    }
    if (!mnCols.includes('locked')) {
      db.exec('ALTER TABLE menu_nodes ADD COLUMN locked INTEGER DEFAULT 0');
    }
    // 旧库迁移:menu_nodes 缺 show_items_in_tree 列时补上(资源根目录是否在菜单树列出资源文件)
    if (!mnCols.includes('show_items_in_tree')) {
      db.exec('ALTER TABLE menu_nodes ADD COLUMN show_items_in_tree INTEGER DEFAULT 1');
    }
    // 旧库迁移:menu_nodes 缺 hidden 列时补上(侧栏隐藏节点)
    if (!mnCols.includes('hidden')) {
      db.exec('ALTER TABLE menu_nodes ADD COLUMN hidden INTEGER DEFAULT 0');
    }
  } catch (err) {
    console.error('[db] migrate menu_nodes type_tags/is_resource/locked/hidden error:', err);
  }
  // 旧库迁移:todo_events 缺 calendar 列时补上(生日公历/农历)
  try {
    const evCols = db.prepare('PRAGMA table_info(todo_events)').all().map((r) => r.name);
    if (!evCols.includes('calendar')) {
      db.exec("ALTER TABLE todo_events ADD COLUMN calendar TEXT DEFAULT 'solar'");
    }
  } catch (err) {
    console.error('[db] migrate todo_events calendar error:', err);
  }
  // 旧库迁移:todo_tasks 缺 start_at / complete_at / events 列时补上(开始时间/完成时间/任务事件日志)
  // 旧库迁移:todo_subtasks 缺 notes / done_at 列时补上(子任务备注/完成时间)
  try {
    const ttCols = db.prepare('PRAGMA table_info(todo_tasks)').all().map((r) => r.name);
    if (!ttCols.includes('start_at')) db.exec('ALTER TABLE todo_tasks ADD COLUMN start_at INTEGER');
    if (!ttCols.includes('complete_at')) db.exec('ALTER TABLE todo_tasks ADD COLUMN complete_at INTEGER');
    if (!ttCols.includes('events')) db.exec("ALTER TABLE todo_tasks ADD COLUMN events TEXT DEFAULT '[]'");
    // 补丁·79:todo_tasks 缺 subs_collapsed 列时补上(父卡子任务区折叠状态持久化)
    if (!ttCols.includes('subs_collapsed')) db.exec('ALTER TABLE todo_tasks ADD COLUMN subs_collapsed INTEGER DEFAULT 0');
    const stCols = db.prepare('PRAGMA table_info(todo_subtasks)').all().map((r) => r.name);
    if (!stCols.includes('notes')) db.exec("ALTER TABLE todo_subtasks ADD COLUMN notes TEXT DEFAULT ''");
    if (!stCols.includes('done_at')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN done_at INTEGER');
    // 补丁·57:todo_subtasks 缺 parent_sub_id 列时补上(子任务下再建子任务的嵌套层级)
    if (!stCols.includes('parent_sub_id')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN parent_sub_id TEXT');
    // 补丁·60:todo_subtasks 扩展为含完整字段(优先级/项目/父级/截止日期/开始时间/完成时间/标签/更新时间)
    if (!stCols.includes('priority')) db.exec("ALTER TABLE todo_subtasks ADD COLUMN priority TEXT DEFAULT 'medium'");
    if (!stCols.includes('project_id')) db.exec("ALTER TABLE todo_subtasks ADD COLUMN project_id TEXT DEFAULT ''");
    if (!stCols.includes('parent_task_id')) db.exec("ALTER TABLE todo_subtasks ADD COLUMN parent_task_id TEXT DEFAULT ''");
    if (!stCols.includes('deadline')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN deadline INTEGER DEFAULT 0');
    if (!stCols.includes('start_at')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN start_at INTEGER');
    if (!stCols.includes('complete_at')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN complete_at INTEGER');
    if (!stCols.includes('tags')) db.exec("ALTER TABLE todo_subtasks ADD COLUMN tags TEXT DEFAULT '[]'");
    if (!stCols.includes('updated_at')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN updated_at INTEGER DEFAULT 0');
    // 补丁·79:todo_subtasks 缺 collapsed 列时补上(嵌套子任务块折叠状态持久化)
    if (!stCols.includes('collapsed')) db.exec('ALTER TABLE todo_subtasks ADD COLUMN collapsed INTEGER DEFAULT 0');
    // 旧库迁移:todo_projects 缺 parent_id 列时补上(项目树父子层级)
    const tpCols = db.prepare('PRAGMA table_info(todo_projects)').all().map((r) => r.name);
    if (!tpCols.includes('parent_id')) db.exec("ALTER TABLE todo_projects ADD COLUMN parent_id TEXT DEFAULT ''");
    if (!tpCols.includes('notes')) db.exec("ALTER TABLE todo_projects ADD COLUMN notes TEXT DEFAULT ''");
    if (!tpCols.includes('deadline')) db.exec('ALTER TABLE todo_projects ADD COLUMN deadline INTEGER DEFAULT 0');
    if (!tpCols.includes('complete_at')) db.exec('ALTER TABLE todo_projects ADD COLUMN complete_at INTEGER DEFAULT 0');
    // 旧库迁移:todo_tasks 缺 parent_task_id 列时补上(任务树父子层级)
    if (!ttCols.includes('parent_task_id')) db.exec("ALTER TABLE todo_tasks ADD COLUMN parent_task_id TEXT DEFAULT ''");
  } catch (err) {
    console.error('[db] migrate todo_tasks start_at/complete_at/events + todo_subtasks notes/done_at + 项目/任务父子层级 error:', err);
  }
  // 旧库迁移:items 缺 size / mtime 列时补上(游戏资源管理器排序/统计用)
  try {
    const cols = db.prepare('PRAGMA table_info(items)').all().map((r) => r.name);
    if (!cols.includes('size')) db.exec('ALTER TABLE items ADD COLUMN size INTEGER');
    if (!cols.includes('mtime')) db.exec('ALTER TABLE items ADD COLUMN mtime INTEGER');
    // 旧库迁移:items 缺 tags 列时补上(资源标签,JSON 数组字符串)
    if (!cols.includes('tags')) db.exec("ALTER TABLE items ADD COLUMN tags TEXT DEFAULT '[]'");
    // 旧库迁移:items 缺 meta 列时补上(视频/一般元信息:海报图路径、评分、简介等 JSON)
    if (!cols.includes('meta')) db.exec('ALTER TABLE items ADD COLUMN meta TEXT DEFAULT NULL');
  } catch (err) {
    console.error('[db] migrate items size/mtime/tags error:', err);
  }
  // 旧库迁移:scenes 缺 subtype / fgui_snapshots 列时补上(FGUI 界面包登记 + 关联快照)
  try {
    const cols = db.prepare('PRAGMA table_info(scenes)').all().map((r) => r.name);
    if (!cols.includes('subtype')) db.exec("ALTER TABLE scenes ADD COLUMN subtype TEXT DEFAULT ''");
    if (!cols.includes('fgui_snapshots')) db.exec("ALTER TABLE scenes ADD COLUMN fgui_snapshots TEXT DEFAULT '[]'");
  } catch (err) {
    console.error('[db] migrate scenes subtype/fgui_snapshots error:', err);
  }
  return db;
}

function close() {
  if (db) {
    try { db.close(); } catch (err) { /* ignore */ }
    db = null;
  }
}

/** 从 SQLite 读取完整状态对象(与渲染端约定一致) */
function readDb() {
  const d = defaultDb();
  try {
    const conn = open();
    for (const row of conn.prepare('SELECT key, value FROM settings').all()) {
      d.settings[row.key] = JSON.parse(row.value);
    }
    d.categories = conn.prepare(
      'SELECT id, name, remark, parent_id AS parentId, type_tags AS typeTags, locked, show_items_in_tree AS showItemsInTree, sort, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY sort'
    ).all();
    // type_tags 列是 JSON 数组字符串 → 解析为数组;locked / showItemsInTree 整数 → 布尔
    for (const c of d.categories) {
      if (typeof c.typeTags === 'string') {
        try { c.typeTags = JSON.parse(c.typeTags || '[]'); } catch (err) { c.typeTags = []; }
      }
      if (!Array.isArray(c.typeTags)) c.typeTags = [];
      c.locked = !!c.locked;
      c.showItemsInTree = c.showItemsInTree == null ? true : !!c.showItemsInTree;
    }
    d.items = conn.prepare(
      'SELECT id, category_id AS categoryId, type, file_path AS filePath, atlas_path AS atlasPath, ' +
      'display_name AS displayName, remark, size, mtime, tags, meta, created_at AS createdAt, updated_at AS updatedAt FROM items'
    ).all();
    // tags 列是 JSON 数组字符串 → 解析为数组;meta 列是 JSON 字符串 → 解析(海报图/评分/简介等)
    for (const it of d.items) {
      if (typeof it.tags === 'string') {
        try { it.tags = JSON.parse(it.tags || '[]'); } catch (err) { it.tags = []; }
      }
      if (!Array.isArray(it.tags)) it.tags = [];
      if (it.meta != null) {
        if (typeof it.meta === 'string') {
          try { it.meta = JSON.parse(it.meta); } catch (err) { it.meta = null; }
        }
      } else {
        it.meta = null;
      }
    }
    d.favCategories = conn.prepare(
      'SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM fav_categories ORDER BY sort'
    ).all();
    d.favItems = conn.prepare(
      'SELECT id, item_id AS itemId, fav_category_id AS favCategoryId, created_at AS createdAt FROM fav_items'
    ).all();
    d.sceneCategories = conn.prepare(
      'SELECT id, name, remark, parent_id AS parentId, sort, created_at AS createdAt, updated_at AS updatedAt FROM scene_categories ORDER BY sort'
    ).all();
    d.scenes = conn.prepare(
      'SELECT id, category_id AS categoryId, name, file_path AS filePath, type, subtype, remark, tags, size, mtime, ' +
      'fgui_snapshots AS fguiSnapshots, created_at AS createdAt, updated_at AS updatedAt FROM scenes'
    ).all();
    for (const s of (d.scenes || [])) {
      if (typeof s.tags === 'string') {
        try { s.tags = JSON.parse(s.tags || '[]'); } catch (err) { s.tags = []; }
      }
      if (!Array.isArray(s.tags)) s.tags = [];
      if (typeof s.fguiSnapshots === 'string') {
        try { s.fguiSnapshots = JSON.parse(s.fguiSnapshots || '[]'); } catch (err) { s.fguiSnapshots = []; }
      }
      if (!Array.isArray(s.fguiSnapshots)) s.fguiSnapshots = [];
      if (!s.subtype) s.subtype = '';
    }
    d.webBookmarkCategories = conn.prepare(
      'SELECT id, name, remark, parent_id AS parentId, sort, created_at AS createdAt, updated_at AS updatedAt FROM web_bookmark_categories ORDER BY sort'
    ).all();
    d.webBookmarks = conn.prepare(
      'SELECT id, category_id AS categoryId, name, url, remark, created_at AS createdAt, updated_at AS updatedAt FROM web_bookmarks'
    ).all();
    d.apiCategories = conn.prepare(
      'SELECT id, name, remark, parent_id AS parentId, sort, created_at AS createdAt, updated_at AS updatedAt FROM api_categories ORDER BY sort'
    ).all();
    d.apiProjects = conn.prepare(
      'SELECT id, category_id AS categoryId, name, base_url AS baseUrl, remark, sort, created_at AS createdAt, updated_at AS updatedAt FROM api_projects ORDER BY sort'
    ).all();
    d.apiEndpoints = conn.prepare(
      'SELECT id, project_id AS projectId, name, method, path, desc, params, headers, body, response, sort, created_at AS createdAt, updated_at AS updatedAt FROM api_endpoints ORDER BY sort'
    ).all();
    d.toolboxFolders = conn.prepare(
      'SELECT id, name, icon, parent_id AS parentId, tool_id AS toolId, sort, created_at AS createdAt, updated_at AS updatedAt FROM toolbox_folders ORDER BY sort'
    ).all();
    d.menuNodes = conn.prepare(
      'SELECT id, name, icon, parent_id AS parentId, node_type AS nodeType, action_type AS actionType, action, tooltip, note, type_tags AS typeTags, is_resource AS isResource, locked, show_items_in_tree AS showItemsInTree, hidden, sort, created_at AS createdAt, updated_at AS updatedAt FROM menu_nodes ORDER BY sort'
    ).all();
    // type_tags 列是 JSON 数组字符串 → 解析为数组;is_resource / locked 整数 → 布尔
    for (const mn of (d.menuNodes || [])) {
      if (typeof mn.typeTags === 'string') {
        try { mn.typeTags = JSON.parse(mn.typeTags || '[]'); } catch (err) { mn.typeTags = []; }
      }
      if (!Array.isArray(mn.typeTags)) mn.typeTags = [];
      mn.isResource = !!mn.isResource;
      mn.locked = !!mn.locked;
      mn.showItemsInTree = mn.showItemsInTree == null ? true : !!mn.showItemsInTree;
      mn.hidden = !!mn.hidden;
    }
    d.todoProjects = conn.prepare(
      'SELECT id, name, color, sort, parent_id AS parentId, notes, deadline, complete_at AS completeAt, created_at AS createdAt, updated_at AS updatedAt FROM todo_projects ORDER BY sort'
    ).all();
    d.projects = conn.prepare(
      'SELECT id, name, status, description, root_path AS rootPath, access_url AS accessUrl, website, launch_path AS launchPath, deploy_method AS deployMethod, launch_method AS launchMethod, frontend_cmd AS frontendCmd, frontend_url AS frontendUrl, backend_cmd AS backendCmd, backend_url AS backendUrl, remark, menu_node_id AS menuNodeId, sort, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY sort, created_at'
    ).all();
    for (const p of (d.projects || [])) {
      if (!p.description) p.description = '';
      if (!p.rootPath) p.rootPath = '';
      if (!p.accessUrl) p.accessUrl = '';
      if (!p.website) p.website = '';
      if (!p.launchPath) p.launchPath = '';
      if (!p.deployMethod) p.deployMethod = '';
      if (!p.launchMethod) p.launchMethod = '';
      if (!p.frontendCmd) p.frontendCmd = '';
      if (!p.frontendUrl) p.frontendUrl = '';
      if (!p.backendCmd) p.backendCmd = '';
      if (!p.backendUrl) p.backendUrl = '';
      if (!p.remark) p.remark = '';
      if (!p.menuNodeId) p.menuNodeId = '';
    }
    d.projectEntries = conn.prepare(
      'SELECT id, project_id AS projectId, folder_id AS folderId, name, type, content, sort, created_at AS createdAt, updated_at AS updatedAt FROM project_entries ORDER BY project_id, folder_id, sort, created_at'
    ).all();
    for (const e of (d.projectEntries || [])) {
      if (!e.folderId) e.folderId = '';
      if (!e.type) e.type = 'doc';
      if (!e.content) e.content = '';
    }
    d.todoTasks = conn.prepare(
      'SELECT id, title, notes, notes_html AS notesHtml, priority, status, deadline, reminder_at AS reminderAt, ' +
      'start_at AS startAt, complete_at AS completeAt, events, sort, ' +
      'tags, project_id AS projectId, parent_task_id AS parentTaskId, recur_rule AS recurRule, archived, created_at AS createdAt, updated_at AS updatedAt, subs_collapsed AS subsCollapsed FROM todo_tasks ORDER BY sort'
    ).all();
    // tags / events 列是 JSON 数组字符串 → 解析为数组;附挂子任务
    const subStmt = conn.prepare('SELECT id, task_id AS taskId, parent_sub_id AS parentSubId, title, notes, done, done_at AS doneAt, sort, created_at AS createdAt, priority, project_id AS projectId, parent_task_id AS parentTaskId, deadline, start_at AS startAt, complete_at AS completeAt, tags, updated_at AS updatedAt, collapsed FROM todo_subtasks WHERE task_id = ? ORDER BY parent_sub_id, sort');
    for (const t of (d.todoTasks || [])) {
      if (typeof t.tags === 'string') {
        try { t.tags = JSON.parse(t.tags || '[]'); } catch (err) { t.tags = []; }
      }
      if (!Array.isArray(t.tags)) t.tags = [];
      if (typeof t.events === 'string') {
        try { t.events = JSON.parse(t.events || '[]'); } catch (err) { t.events = []; }
      }
      if (!Array.isArray(t.events)) t.events = [];
      if (!t.notes) t.notes = '';
      if (!t.notesHtml) t.notesHtml = '';
      if (!t.recurRule) t.recurRule = '';
      t.archived = !!t.archived;
      t.subsCollapsed = !!t.subsCollapsed; // 补丁·79:父卡子任务区折叠状态
      // 由扁平行按 parent_sub_id 重建嵌套树(补丁·57:支持子任务下再建子任务)
      const flat = subStmt.all(t.id);
      for (const s of flat) {
        s.done = !!s.done;
        s.collapsed = !!s.collapsed; // 补丁·79:嵌套子任务块折叠状态
        if (!s.notes) s.notes = '';
        // 补丁·60:子任务独立字段缺省值 + tags JSON 解析
        if (!s.priority) s.priority = 'medium';
        if (!s.projectId) s.projectId = '';
        if (!s.parentTaskId) s.parentTaskId = '';
        if (!s.deadline) s.deadline = 0;
        if (typeof s.tags === 'string') { try { s.tags = JSON.parse(s.tags || '[]'); } catch (err) { s.tags = []; } }
        if (!Array.isArray(s.tags)) s.tags = [];
        if (!s.updatedAt) s.updatedAt = 0;
        s.subtasks = [];
      }
      const byId = new Map(flat.map((s) => [s.id, s]));
      const roots = [];
      for (const s of flat) {
        if (s.parentSubId && byId.has(s.parentSubId)) byId.get(s.parentSubId).subtasks.push(s);
        else roots.push(s);
      }
      t.subtasks = roots;
    }
    d.todoEvents = conn.prepare(
      'SELECT id, date, type, calendar, title, note, created_at AS createdAt, updated_at AS updatedAt FROM todo_events ORDER BY date, created_at'
    ).all();
    for (const ev of (d.todoEvents || [])) {
      if (!ev.note) ev.note = '';
    }
    for (const ep of (d.apiEndpoints || [])) {
      if (typeof ep.params === 'string') {
        try { ep.params = JSON.parse(ep.params || '[]'); } catch (err) { ep.params = []; }
      }
      if (!Array.isArray(ep.params)) ep.params = [];
      if (typeof ep.headers === 'string') {
        try { ep.headers = JSON.parse(ep.headers || '[]'); } catch (err) { ep.headers = []; }
      }
      if (!Array.isArray(ep.headers)) ep.headers = [];
      if (!ep.desc) ep.desc = '';
      if (!ep.body) ep.body = '';
      if (!ep.response) ep.response = '';
    }
  } catch (err) {
    console.error('[db] read error:', err);
  }
  return d;
}

/** 全量保存(事务):渲染端已维护完整状态对象 */
function writeDb(state) {
  const conn = open();
  conn.exec('BEGIN');
  try {
    conn.exec('DELETE FROM settings; DELETE FROM categories; DELETE FROM items; DELETE FROM fav_categories; DELETE FROM fav_items; DELETE FROM scene_categories; DELETE FROM scenes; DELETE FROM web_bookmark_categories; DELETE FROM web_bookmarks; DELETE FROM api_categories; DELETE FROM api_projects; DELETE FROM api_endpoints; DELETE FROM toolbox_folders; DELETE FROM menu_nodes; DELETE FROM todo_projects; DELETE FROM todo_tasks; DELETE FROM todo_subtasks; DELETE FROM todo_events; DELETE FROM projects; DELETE FROM project_entries;');
    const setSetting = conn.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(state.settings || {})) {
      setSetting.run(k, JSON.stringify(v));
    }
    const insCat = conn.prepare(
      'INSERT INTO categories(id, name, remark, parent_id, type_tags, locked, show_items_in_tree, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of state.categories || []) {
      insCat.run(
        c.id, c.name || '', c.remark || '', c.parentId || '',
        JSON.stringify(Array.isArray(c.typeTags) ? c.typeTags : []),
        c.locked ? 1 : 0,
        c.showItemsInTree ? 1 : 0,
        c.sort || 0, c.createdAt || 0, c.updatedAt || 0
      );
    }
    const insItem = conn.prepare(
      'INSERT INTO items(id, category_id, type, file_path, atlas_path, display_name, remark, size, mtime, tags, meta, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const it of state.items || []) {
      insItem.run(
        it.id, it.categoryId || '', it.type || '', it.filePath || '',
        it.atlasPath ?? null, it.displayName || '', it.remark || '',
        it.size ?? null, it.mtime ?? null,
        JSON.stringify(Array.isArray(it.tags) ? it.tags : []),
        it.meta ? JSON.stringify(it.meta) : null,
        it.createdAt || 0, it.updatedAt || 0
      );
    }
    const insFavCat = conn.prepare(
      'INSERT INTO fav_categories(id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const fc of state.favCategories || []) {
      insFavCat.run(fc.id, fc.name || '', fc.sort || 0, fc.createdAt || 0, fc.updatedAt || 0);
    }
    const insFavItem = conn.prepare(
      'INSERT INTO fav_items(id, item_id, fav_category_id, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const f of state.favItems || []) {
      insFavItem.run(f.id, f.itemId || '', f.favCategoryId || '', f.createdAt || 0);
    }
    const insSceneCat = conn.prepare(
      'INSERT INTO scene_categories(id, name, remark, parent_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const sc of state.sceneCategories || []) {
      insSceneCat.run(sc.id, sc.name || '', sc.remark || '', sc.parentId || '', sc.sort || 0, sc.createdAt || 0, sc.updatedAt || 0);
    }
    const insScene = conn.prepare(
      'INSERT INTO scenes(id, category_id, name, file_path, type, subtype, remark, tags, size, mtime, fgui_snapshots, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const s of state.scenes || []) {
      insScene.run(
        s.id, s.categoryId || '', s.name || '', s.filePath || '',
        s.type || 'folder', s.subtype || '', s.remark || '',
        JSON.stringify(Array.isArray(s.tags) ? s.tags : []),
        s.size ?? null, s.mtime ?? null,
        JSON.stringify(Array.isArray(s.fguiSnapshots) ? s.fguiSnapshots : []),
        s.createdAt || 0, s.updatedAt || 0
      );
    }
    const insBmCat = conn.prepare(
      'INSERT INTO web_bookmark_categories(id, name, remark, parent_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const bc of state.webBookmarkCategories || []) {
      insBmCat.run(bc.id, bc.name || '', bc.remark || '', bc.parentId || '', bc.sort || 0, bc.createdAt || 0, bc.updatedAt || 0);
    }
    const insBm = conn.prepare(
      'INSERT INTO web_bookmarks(id, category_id, name, url, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const b of state.webBookmarks || []) {
      insBm.run(b.id, b.categoryId || '', b.name || '', b.url || '', b.remark || '', b.createdAt || 0, b.updatedAt || 0);
    }
    const insApiCat = conn.prepare(
      'INSERT INTO api_categories(id, name, remark, parent_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const ac of state.apiCategories || []) {
      insApiCat.run(ac.id, ac.name || '', ac.remark || '', ac.parentId || '', ac.sort || 0, ac.createdAt || 0, ac.updatedAt || 0);
    }
    const insApiProj = conn.prepare(
      'INSERT INTO api_projects(id, category_id, name, base_url, remark, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of state.apiProjects || []) {
      insApiProj.run(p.id, p.categoryId || '', p.name || '', p.baseUrl || '', p.remark || '', p.sort || 0, p.createdAt || 0, p.updatedAt || 0);
    }
    const insApiEp = conn.prepare(
      'INSERT INTO api_endpoints(id, project_id, name, method, path, desc, params, headers, body, response, sort, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const e of state.apiEndpoints || []) {
      insApiEp.run(
        e.id, e.projectId || '', e.name || '', e.method || 'GET', e.path || '', e.desc || '',
        JSON.stringify(Array.isArray(e.params) ? e.params : []),
        JSON.stringify(Array.isArray(e.headers) ? e.headers : []),
        e.body || '', e.response || '',
        e.sort || 0, e.createdAt || 0, e.updatedAt || 0
      );
    }
    const insTf = conn.prepare(
      'INSERT INTO toolbox_folders(id, name, icon, parent_id, tool_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const tf of state.toolboxFolders || []) {
      insTf.run(tf.id, tf.name || '', tf.icon || '', tf.parentId || '', tf.toolId || '', tf.sort || 0, tf.createdAt || 0, tf.updatedAt || 0);
    }
    const insMenu = conn.prepare(
      'INSERT INTO menu_nodes(id, name, icon, parent_id, node_type, action_type, action, tooltip, note, type_tags, is_resource, locked, show_items_in_tree, hidden, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const mn of state.menuNodes || []) {
      insMenu.run(
        mn.id, mn.name || '', mn.icon || '', mn.parentId || '', mn.nodeType || 'dir',
        mn.actionType || '', mn.action || '', mn.tooltip || '', mn.note || '',
        JSON.stringify(Array.isArray(mn.typeTags) ? mn.typeTags : []),
        mn.isResource ? 1 : 0,
        mn.locked ? 1 : 0,
        mn.showItemsInTree ? 1 : 0,
        mn.hidden ? 1 : 0,
        mn.sort || 0, mn.createdAt || 0, mn.updatedAt || 0
      );
    }
    // ---- Todo-List 任务管理:项目 / 任务 / 子任务 ----
    const insTodoProj = conn.prepare(
      'INSERT INTO todo_projects(id, name, color, sort, parent_id, notes, deadline, complete_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of state.todoProjects || []) {
      insTodoProj.run(p.id, p.name || '', p.color || '#6366f1', p.sort || 0, p.parentId || '', p.notes || '', p.deadline || 0, p.completeAt || 0, p.createdAt || 0, p.updatedAt || 0);
    }
    const insTodoTask = conn.prepare(
      'INSERT INTO todo_tasks(id, title, notes, notes_html, priority, status, deadline, reminder_at, start_at, complete_at, events, sort, tags, project_id, parent_task_id, recur_rule, archived, created_at, updated_at, subs_collapsed) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insTodoSub = conn.prepare(
      'INSERT INTO todo_subtasks(id, task_id, parent_sub_id, title, notes, done, done_at, sort, created_at, priority, project_id, parent_task_id, deadline, start_at, complete_at, tags, updated_at, collapsed) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // 递归写入子任务(补丁·57:支持子任务下再建子任务;补丁·60:每个子任务独立归属任务 — 由 saveTask 在前端完成跨任务迁移,这里仍用 taskId 即可)
    const writeSubs = (subs, taskId, parentSubId) => {
      for (const s of (subs || [])) {
        // 补丁·60:parentTaskId 优先于 taskId(顶层子任务 parentTaskId 必须等于 taskId 才能正确归属)
        const realTaskId = s.parentTaskId || taskId;
        insTodoSub.run(
          s.id, realTaskId, parentSubId || null, s.title || '', s.notes || '',
          s.done ? 1 : 0, s.doneAt ?? null,
          typeof s.sort === 'number' && isFinite(s.sort) ? s.sort : 0,
          s.createdAt || 0,
          s.priority || 'medium', s.projectId || '', s.parentTaskId || taskId,
          s.deadline || 0, s.startAt ?? null, s.completeAt ?? null,
          JSON.stringify(Array.isArray(s.tags) ? s.tags : []),
          s.updatedAt || 0,
          s.collapsed ? 1 : 0
        );
        if (s.subtasks && s.subtasks.length) writeSubs(s.subtasks, realTaskId, s.id);
      }
    };
    for (const t of state.todoTasks || []) {
      insTodoTask.run(
        t.id, t.title || '', t.notes || '', t.notesHtml || '',
        t.priority || 'medium', t.status || 'todo',
        t.deadline ?? null, t.reminderAt ?? null,
        t.startAt ?? null, t.completeAt ?? null,
        JSON.stringify(Array.isArray(t.events) ? t.events : []),
        // sort 支持小数(看板拖拽用分数序号插队),不能用 `|| 0` 之外的取整
        typeof t.sort === 'number' && isFinite(t.sort) ? t.sort : 0,
        JSON.stringify(Array.isArray(t.tags) ? t.tags : []),
        t.projectId || '', t.parentTaskId || '', t.recurRule || '',
        t.archived ? 1 : 0, t.createdAt || 0, t.updatedAt || 0,
        t.subsCollapsed ? 1 : 0
      );
      writeSubs(t.subtasks, t.id, null);
    }
    const insTodoEvent = conn.prepare(
      'INSERT INTO todo_events(id, date, type, calendar, title, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const ev of state.todoEvents || []) {
      insTodoEvent.run(ev.id, ev.date || '', ev.type || 'todo', ev.calendar || 'solar', ev.title || '', ev.note || '', ev.createdAt || 0, ev.updatedAt || 0);
    }
    // ---- 项目管理中心:项目主配置 + 项目资源/文档条目 ----
    const insProject = conn.prepare(
      'INSERT INTO projects(id, name, status, description, root_path, access_url, website, launch_path, deploy_method, launch_method, frontend_cmd, frontend_url, backend_cmd, backend_url, remark, menu_node_id, sort, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const p of state.projects || []) {
      insProject.run(
        p.id, p.name || '', p.status || 'stopped', p.description || '', p.rootPath || '',
        p.accessUrl || '', p.website || '', p.launchPath || '', p.deployMethod || '',
        p.launchMethod || '', p.frontendCmd || '', p.frontendUrl || '',
        p.backendCmd || '', p.backendUrl || '', p.remark || '', p.menuNodeId || '',
        typeof p.sort === 'number' && isFinite(p.sort) ? p.sort : 0,
        p.createdAt || 0, p.updatedAt || 0
      );
    }
    const insProjEntry = conn.prepare(
      'INSERT INTO project_entries(id, project_id, folder_id, name, type, content, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const e of state.projectEntries || []) {
      insProjEntry.run(
        e.id, e.projectId || '', e.folderId || '', e.name || '', e.type || 'doc',
        e.content || '', typeof e.sort === 'number' && isFinite(e.sort) ? e.sort : 0,
        e.createdAt || 0, e.updatedAt || 0
      );
    }
    conn.exec('COMMIT');
    return true;
  } catch (err) {
    conn.exec('ROLLBACK');
    console.error('[db] write error:', err);
    return false;
  }
}

/** 迁移:旧版 data.json → SQLite(检查新旧两个 userData 路径) */
function migrateFromJson() {
  try {
    const conn = open();
    const catCount = conn.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    const itemCount = conn.prepare('SELECT COUNT(*) AS n FROM items').get().n;
    if (catCount > 0 || itemCount > 0) return; // 已有数据,不迁移
    const candidates = [
      path.join(app.getPath('userData'), 'data.json'),                 // 新路径 game-resource-explorer
      path.join(app.getPath('appData'), 'skeleton-previewer', 'data.json'), // 旧路径 skeleton-previewer
    ];
    let jsonPath = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) { jsonPath = p; break; }
    }
    if (!jsonPath) return;
    const old = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!old || (!Array.isArray(old.categories) && !Array.isArray(old.items))) return;
    writeDb({
      version: old.version || 1,
      settings: { ...defaultDb().settings, ...(old.settings || {}) },
      categories: old.categories || [],
      items: old.items || [],
    });
    console.log('[db] 已从旧 data.json 迁移到 SQLite: ' + jsonPath);
  } catch (err) {
    console.error('[db] migrate error:', err);
  }
}

/** 统计信息(供冒烟验证/调试) */
function dbStats() {
  try {
    const conn = open();
    return {
      file: dbFile(),
      exists: fs.existsSync(dbFile()),
      size: fs.existsSync(dbFile()) ? fs.statSync(dbFile()).size : 0,
      categories: conn.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
      items: conn.prepare('SELECT COUNT(*) AS n FROM items').get().n,
      todoProjects: conn.prepare('SELECT COUNT(*) AS n FROM todo_projects').get().n,
      todoTasks: conn.prepare('SELECT COUNT(*) AS n FROM todo_tasks').get().n,
      projects: conn.prepare('SELECT COUNT(*) AS n FROM projects').get().n,
      projectEntries: conn.prepare('SELECT COUNT(*) AS n FROM project_entries').get().n,
      settings: conn.prepare('SELECT COUNT(*) AS n FROM settings').get().n,
      timeTypes: conn.prepare('SELECT COUNT(*) AS n FROM time_types').get().n,
      timeRecords: conn.prepare('SELECT COUNT(*) AS n FROM time_records').get().n,
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ---------------- 计时记录 / 计时类型(补丁·96) ----------------
// 计时数据由主进程直接持有(node:sqlite), 不走渲染端全量 writeDb,
// 避免计时窗口新增记录被主窗口 saveState 的全量 DELETE+INSERT 覆盖。

const TIME_TYPE_COLS = ['id', 'name', 'color', 'icon', 'sort', 'created_at'];
const TIME_REC_COLS = ['id', 'type_ids', 'start_ts', 'end_ts', 'duration_sec', 'mode', 'show_calendar', 'note', 'created_at', 'updated_at'];

/** 全部计时类型(按 sort 升序) */
function dbTimeTypes() {
  return open().prepare('SELECT * FROM time_types ORDER BY sort ASC, created_at ASC').all();
}

/** 新增计时类型(返回 { ok, id }) */
function dbTimeTypeAdd({ id, name, color, icon, sort } = {}) {
  const conn = open();
  const rec = {
    id: id || `tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || '').trim() || '未命名',
    color: color || '#5c9cff',
    icon: icon || '⏱',
    sort: Number.isFinite(Number(sort)) ? Number(sort) : 0,
    created_at: Math.floor(Date.now() / 1000),
  };
  conn.prepare('INSERT INTO time_types (id,name,color,icon,sort,created_at) VALUES (?,?,?,?,?,?)')
    .run(rec.id, rec.name, rec.color, rec.icon, rec.sort, rec.created_at);
  return { ok: true, id: rec.id };
}

/** 更新计时类型(白名单列) */
function dbTimeTypeUpdate(id, patch = {}) {
  const allowed = ['name', 'color', 'icon', 'sort'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) { sets.push(k + '=?'); vals.push(patch[k]); }
  }
  if (!sets.length) return { ok: true };
  vals.push(id);
  open().prepare(`UPDATE time_types SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true };
}

/** 删除计时类型(同时从所有记录的 type_ids 中移除) */
function dbTimeTypeDelete(id) {
  const conn = open();
  conn.prepare('DELETE FROM time_types WHERE id=?').run(id);
  // 清理引用:逐条检查 type_ids JSON, 移除该 id
  for (const r of conn.prepare("SELECT id, type_ids FROM time_records WHERE type_ids LIKE '%" + id + "%'").all()) {
    let arr = [];
    try { arr = JSON.parse(r.type_ids || '[]'); } catch (e) { arr = []; }
    const next = arr.filter((x) => x !== id);
    if (next.length !== arr.length) {
      conn.prepare('UPDATE time_records SET type_ids=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(next), Math.floor(Date.now() / 1000), r.id);
    }
  }
  return { ok: true };
}

/** 全部计时记录(按开始时间倒序)。type_ids 解析为数组(渲染端 Array.isArray 判断用, 修复「未分类」显示) */
function dbTimeRecords() {
  const rows = open().prepare('SELECT * FROM time_records ORDER BY start_ts DESC, created_at DESC').all();
  return rows.map((r) => {
    let typeIds = [];
    try { typeIds = JSON.parse(r.type_ids || '[]'); } catch (e) { typeIds = []; }
    if (!Array.isArray(typeIds)) typeIds = [];
    return { ...r, type_ids: typeIds };
  });
}

/** 新增计时记录 */
function dbTimeRecordAdd({ id, type_ids, start_ts, end_ts, duration_sec, mode, show_calendar, note } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const rec = {
    id: id || `tr_${nowSec}_${Math.random().toString(36).slice(2, 8)}`,
    type_ids: Array.isArray(type_ids) ? JSON.stringify(type_ids) : '[]',
    start_ts: Math.max(0, Math.floor(Number(start_ts) || 0)),
    end_ts: Math.max(0, Math.floor(Number(end_ts) || 0)),
    duration_sec: Math.max(0, Math.floor(Number(duration_sec) || 0)),
    mode: mode === 'countdown' ? 'countdown' : 'stopwatch',
    show_calendar: show_calendar ? 1 : 0,
    note: String(note || ''),
    created_at: nowSec,
    updated_at: nowSec,
  };
  open().prepare('INSERT INTO time_records (id,type_ids,start_ts,end_ts,duration_sec,mode,show_calendar,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(rec.id, rec.type_ids, rec.start_ts, rec.end_ts, rec.duration_sec, rec.mode, rec.show_calendar, rec.note, rec.created_at, rec.updated_at);
  return { ok: true, id: rec.id };
}

/** 更新计时记录(白名单列) */
function dbTimeRecordUpdate(id, patch = {}) {
  const allowed = ['type_ids', 'start_ts', 'end_ts', 'duration_sec', 'mode', 'show_calendar', 'note'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      if (k === 'type_ids' && Array.isArray(patch[k])) patch[k] = JSON.stringify(patch[k]);
      if (k === 'show_calendar') patch[k] = patch[k] ? 1 : 0;
      if (k === 'start_ts' || k === 'end_ts' || k === 'duration_sec') patch[k] = Math.max(0, Math.floor(Number(patch[k]) || 0));
      sets.push(k + '=?'); vals.push(patch[k]);
    }
  }
  if (!sets.length) return { ok: true };
  sets.push('updated_at=?'); vals.push(Math.floor(Date.now() / 1000));
  vals.push(id);
  open().prepare(`UPDATE time_records SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true };
}

/** 删除计时记录 */
function dbTimeRecordDelete(id) {
  open().prepare('DELETE FROM time_records WHERE id=?').run(id);
  return { ok: true };
}

// ---------------- 闹钟(补丁·98) ----------------
/** 全部闹钟(按时间排序) */
function dbAlarms() {
  const rows = open().prepare('SELECT * FROM alarms ORDER BY time ASC, created_at ASC').all();
  return rows.map((r) => {
    let days = [];
    try { days = JSON.parse(r.days || '[]'); } catch (e) { days = []; }
    if (!Array.isArray(days)) days = [];
    return { ...r, days };
  });
}

/** 新增闹钟 */
function dbAlarmAdd({ id, time, repeat, days, label, sound, sound_path, sound_name, enabled } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  // 补丁·100: 接受 'beep' | 'none' | 'file' | 'wav:Alarm0X'(Windows 内置)
  let s = 'beep';
  if (sound === 'beep' || sound === 'none' || sound === 'file') s = sound;
  else if (typeof sound === 'string' && /^wav:Alarm0[1-9]$|^wav:Alarm10$/.test(sound)) s = sound;
  const rec = {
    id: id || `al_${nowSec}_${Math.random().toString(36).slice(2, 8)}`,
    time: String(time || '08:00'),
    repeat: ['once', 'daily', 'weekdays', 'weekly'].includes(repeat) ? repeat : 'once',
    days: Array.isArray(days) ? JSON.stringify(days) : '[]',
    label: String(label || ''),
    sound: s,
    sound_path: String(sound_path || ''),
    sound_name: String(sound_name || ''),
    enabled: enabled ? 1 : 0,
    last_ring: '',
    created_at: nowSec,
    updated_at: nowSec,
  };
  open().prepare('INSERT INTO alarms (id,time,repeat,days,label,sound,sound_path,sound_name,enabled,last_ring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rec.id, rec.time, rec.repeat, rec.days, rec.label, rec.sound, rec.sound_path, rec.sound_name, rec.enabled, rec.last_ring, rec.created_at, rec.updated_at);
  return { ok: true, id: rec.id };
}

/** 更新闹钟(白名单列) */
function dbAlarmUpdate(id, patch = {}) {
  const allowed = ['time', 'repeat', 'days', 'label', 'sound', 'sound_path', 'sound_name', 'enabled', 'last_ring'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      if (k === 'days' && Array.isArray(patch[k])) patch[k] = JSON.stringify(patch[k]);
      if (k === 'enabled') patch[k] = patch[k] ? 1 : 0;
      sets.push(k + '=?'); vals.push(patch[k]);
    }
  }
  if (!sets.length) return { ok: true };
  sets.push('updated_at=?'); vals.push(Math.floor(Date.now() / 1000));
  vals.push(id);
  open().prepare(`UPDATE alarms SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true };
}

/** 删除闹钟 */
function dbAlarmDelete(id) {
  open().prepare('DELETE FROM alarms WHERE id=?').run(id);
  return { ok: true };
}

module.exports = {
  readDb, writeDb, migrateFromJson, dbStats, dbFile, close,
  dbTimeTypes, dbTimeTypeAdd, dbTimeTypeUpdate, dbTimeTypeDelete,
  dbTimeRecords, dbTimeRecordAdd, dbTimeRecordUpdate, dbTimeRecordDelete,
  dbAlarms, dbAlarmAdd, dbAlarmUpdate, dbAlarmDelete,
};
