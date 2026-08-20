'use strict';
/**
 * 定向运行应用冒烟(默认只跑「移动到...」目录树弹窗步骤,可传步骤名或 all)。
 * 安全策略: 先备份 data/skeleton.db(+ -wal/-shm)到临时目录 → 清空 → 运行 → 还原。
 * 用法:
 *   node scripts/run_mtree_smoke.js            # 只跑 mtree(移动到...目录树弹窗)
 *   node scripts/run_mtree_smoke.js all        # 跑全套冒烟
 *   node scripts/run_mtree_smoke.js <step名>   # 只跑指定步骤
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const STEP = process.argv[2] || 'mtree';
const KEEP_DB = process.argv[3] === 'keep'; // keep=不清空真实库(套件在真实库上自清理,跑完仍还原)

const DB_DIR = path.join(__dirname, '..', 'data');
const dbFile = path.join(DB_DIR, 'skeleton.db');
const wal = dbFile + '-wal';
const shm = dbFile + '-shm';

// 1) 备份
const bak = path.join(os.tmpdir(), 'app-smoke-db-bak-' + Date.now());
fs.mkdirSync(bak, { recursive: true });
const backup = (f) => {
  try { if (fs.existsSync(f)) fs.copyFileSync(f, path.join(bak, path.basename(f))); } catch (e) { console.warn('备份失败(忽略):', f, e.code || e.message); }
};
backup(dbFile); backup(wal); backup(shm);
console.log('DB 已备份 →', bak);

// 2) 清空(空库启动会重新 seed 默认分类/样例;keep 模式跳过)
if (!KEEP_DB) {
  const clear = (f) => { try { fs.rmSync(f, { force: true }); } catch (e) { /* ignore */ } };
  clear(dbFile); clear(wal); clear(shm);
}

// 3) 运行冒烟(默认定向 mtree;all=全套)
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
env.SKELETON_VIEWER_SMOKE = '1';
if (STEP !== 'all') env.SKELETON_VIEWER_SMOKE_ONLY = STEP;
env.SKELETON_VIEWER_SOFTWARE = '1';
const electron = require('electron');
console.log(`运行冒烟(空库): ${STEP}`);
const r = spawnSync(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit', timeout: 300000 });
console.log(`冒烟退出码(${STEP}):`, r.status);

// 4) 还原(无论成败)
const restore = (f) => {
  const src = path.join(bak, path.basename(f));
  try { if (fs.existsSync(src)) fs.copyFileSync(src, f); } catch (e) { console.warn('还原失败(忽略):', f, e.code || e.message); }
};
restore(dbFile); restore(wal); restore(shm);
console.log('DB 已还原');
try { fs.rmSync(bak, { recursive: true, force: true }); } catch (e) { /* ignore */ }

process.exit(r.status == null ? 1 : r.status);
