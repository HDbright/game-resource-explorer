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
      sort INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      project_id TEXT DEFAULT '',
      recur_rule TEXT DEFAULT '',
      archived INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS todo_subtasks(
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      sort INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0
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
  } catch (err) {
    console.error('[db] migrate menu_nodes type_tags/is_resource/locked error:', err);
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
      'SELECT id, name, remark, parent_id AS parentId, type_tags AS typeTags, locked, sort, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY sort'
    ).all();
    // type_tags 列是 JSON 数组字符串 → 解析为数组;locked 整数 → 布尔
    for (const c of d.categories) {
      if (typeof c.typeTags === 'string') {
        try { c.typeTags = JSON.parse(c.typeTags || '[]'); } catch (err) { c.typeTags = []; }
      }
      if (!Array.isArray(c.typeTags)) c.typeTags = [];
      c.locked = !!c.locked;
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
      'SELECT id, name, icon, parent_id AS parentId, node_type AS nodeType, action_type AS actionType, action, tooltip, note, type_tags AS typeTags, is_resource AS isResource, locked, sort, created_at AS createdAt, updated_at AS updatedAt FROM menu_nodes ORDER BY sort'
    ).all();
    // type_tags 列是 JSON 数组字符串 → 解析为数组;is_resource / locked 整数 → 布尔
    for (const mn of (d.menuNodes || [])) {
      if (typeof mn.typeTags === 'string') {
        try { mn.typeTags = JSON.parse(mn.typeTags || '[]'); } catch (err) { mn.typeTags = []; }
      }
      if (!Array.isArray(mn.typeTags)) mn.typeTags = [];
      mn.isResource = !!mn.isResource;
      mn.locked = !!mn.locked;
    }
    d.todoProjects = conn.prepare(
      'SELECT id, name, color, sort, created_at AS createdAt, updated_at AS updatedAt FROM todo_projects ORDER BY sort'
    ).all();
    d.todoTasks = conn.prepare(
      'SELECT id, title, notes, notes_html AS notesHtml, priority, status, deadline, reminder_at AS reminderAt, sort, ' +
      'tags, project_id AS projectId, recur_rule AS recurRule, archived, created_at AS createdAt, updated_at AS updatedAt FROM todo_tasks ORDER BY sort'
    ).all();
    // tags 列是 JSON 数组字符串 → 解析为数组;附挂子任务
    const subStmt = conn.prepare('SELECT id, task_id AS taskId, title, done, sort, created_at AS createdAt FROM todo_subtasks WHERE task_id = ? ORDER BY sort');
    for (const t of (d.todoTasks || [])) {
      if (typeof t.tags === 'string') {
        try { t.tags = JSON.parse(t.tags || '[]'); } catch (err) { t.tags = []; }
      }
      if (!Array.isArray(t.tags)) t.tags = [];
      if (!t.notes) t.notes = '';
      if (!t.notesHtml) t.notesHtml = '';
      if (!t.recurRule) t.recurRule = '';
      t.archived = !!t.archived;
      const subs = subStmt.all(t.id);
      for (const s of subs) s.done = !!s.done;
      t.subtasks = subs;
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
    conn.exec('DELETE FROM settings; DELETE FROM categories; DELETE FROM items; DELETE FROM fav_categories; DELETE FROM fav_items; DELETE FROM scene_categories; DELETE FROM scenes; DELETE FROM web_bookmark_categories; DELETE FROM web_bookmarks; DELETE FROM api_categories; DELETE FROM api_projects; DELETE FROM api_endpoints; DELETE FROM toolbox_folders; DELETE FROM menu_nodes; DELETE FROM todo_projects; DELETE FROM todo_tasks; DELETE FROM todo_subtasks; DELETE FROM todo_events;');
    const setSetting = conn.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(state.settings || {})) {
      setSetting.run(k, JSON.stringify(v));
    }
    const insCat = conn.prepare(
      'INSERT INTO categories(id, name, remark, parent_id, type_tags, locked, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of state.categories || []) {
      insCat.run(
        c.id, c.name || '', c.remark || '', c.parentId || '',
        JSON.stringify(Array.isArray(c.typeTags) ? c.typeTags : []),
        c.locked ? 1 : 0,
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
      'INSERT INTO menu_nodes(id, name, icon, parent_id, node_type, action_type, action, tooltip, note, type_tags, is_resource, locked, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const mn of state.menuNodes || []) {
      insMenu.run(
        mn.id, mn.name || '', mn.icon || '', mn.parentId || '', mn.nodeType || 'dir',
        mn.actionType || '', mn.action || '', mn.tooltip || '', mn.note || '',
        JSON.stringify(Array.isArray(mn.typeTags) ? mn.typeTags : []),
        mn.isResource ? 1 : 0,
        mn.locked ? 1 : 0,
        mn.sort || 0, mn.createdAt || 0, mn.updatedAt || 0
      );
    }
    // ---- Todo-List 任务管理:项目 / 任务 / 子任务 ----
    const insTodoProj = conn.prepare(
      'INSERT INTO todo_projects(id, name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const p of state.todoProjects || []) {
      insTodoProj.run(p.id, p.name || '', p.color || '#6366f1', p.sort || 0, p.createdAt || 0, p.updatedAt || 0);
    }
    const insTodoTask = conn.prepare(
      'INSERT INTO todo_tasks(id, title, notes, notes_html, priority, status, deadline, reminder_at, sort, tags, project_id, recur_rule, archived, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insTodoSub = conn.prepare(
      'INSERT INTO todo_subtasks(id, task_id, title, done, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const t of state.todoTasks || []) {
      insTodoTask.run(
        t.id, t.title || '', t.notes || '', t.notesHtml || '',
        t.priority || 'medium', t.status || 'todo',
        t.deadline ?? null, t.reminderAt ?? null,
        t.sort || 0,
        JSON.stringify(Array.isArray(t.tags) ? t.tags : []),
        t.projectId || '', t.recurRule || '',
        t.archived ? 1 : 0, t.createdAt || 0, t.updatedAt || 0
      );
      for (const s of (t.subtasks || [])) {
        insTodoSub.run(s.id, t.id, s.title || '', s.done ? 1 : 0, s.sort || 0, s.createdAt || 0);
      }
    }
    const insTodoEvent = conn.prepare(
      'INSERT INTO todo_events(id, date, type, calendar, title, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const ev of state.todoEvents || []) {
      insTodoEvent.run(ev.id, ev.date || '', ev.type || 'todo', ev.calendar || 'solar', ev.title || '', ev.note || '', ev.createdAt || 0, ev.updatedAt || 0);
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
      settings: conn.prepare('SELECT COUNT(*) AS n FROM settings').get().n,
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { readDb, writeDb, migrateFromJson, dbStats, dbFile, close };
