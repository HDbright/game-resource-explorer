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
  `);
  // 旧库迁移:categories 缺 parent_id 列时补上(子分类支持)
  try {
    const cols = db.prepare('PRAGMA table_info(categories)').all().map((r) => r.name);
    if (!cols.includes('parent_id')) {
      db.exec('ALTER TABLE categories ADD COLUMN parent_id TEXT DEFAULT \'\'');
    }
  } catch (err) {
    console.error('[db] migrate parent_id error:', err);
  }
  // 旧库迁移:items 缺 size / mtime 列时补上(游戏资源管理器排序/统计用)
  try {
    const cols = db.prepare('PRAGMA table_info(items)').all().map((r) => r.name);
    if (!cols.includes('size')) db.exec('ALTER TABLE items ADD COLUMN size INTEGER');
    if (!cols.includes('mtime')) db.exec('ALTER TABLE items ADD COLUMN mtime INTEGER');
  } catch (err) {
    console.error('[db] migrate items size/mtime error:', err);
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
      'SELECT id, name, remark, parent_id AS parentId, sort, created_at AS createdAt, updated_at AS updatedAt FROM categories ORDER BY sort'
    ).all();
    d.items = conn.prepare(
      'SELECT id, category_id AS categoryId, type, file_path AS filePath, atlas_path AS atlasPath, ' +
      'display_name AS displayName, remark, size, mtime, created_at AS createdAt, updated_at AS updatedAt FROM items'
    ).all();
    d.favCategories = conn.prepare(
      'SELECT id, name, sort, created_at AS createdAt, updated_at AS updatedAt FROM fav_categories ORDER BY sort'
    ).all();
    d.favItems = conn.prepare(
      'SELECT id, item_id AS itemId, fav_category_id AS favCategoryId, created_at AS createdAt FROM fav_items'
    ).all();
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
    conn.exec('DELETE FROM settings; DELETE FROM categories; DELETE FROM items; DELETE FROM fav_categories; DELETE FROM fav_items;');
    const setSetting = conn.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(state.settings || {})) {
      setSetting.run(k, JSON.stringify(v));
    }
    const insCat = conn.prepare(
      'INSERT INTO categories(id, name, remark, parent_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of state.categories || []) {
      insCat.run(c.id, c.name || '', c.remark || '', c.parentId || '', c.sort || 0, c.createdAt || 0, c.updatedAt || 0);
    }
    const insItem = conn.prepare(
      'INSERT INTO items(id, category_id, type, file_path, atlas_path, display_name, remark, size, mtime, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const it of state.items || []) {
      insItem.run(
        it.id, it.categoryId || '', it.type || '', it.filePath || '',
        it.atlasPath ?? null, it.displayName || '', it.remark || '',
        it.size ?? null, it.mtime ?? null,
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
      settings: conn.prepare('SELECT COUNT(*) AS n FROM settings').get().n,
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { readDb, writeDb, migrateFromJson, dbStats, dbFile, close };
