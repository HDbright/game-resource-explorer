'use strict';
/** 临时验证:scenes 表迁移(subtype/fgui_snapshots 列) + FGUI 场景条目读写往返 */
const { app } = require('electron');
app.setName('test-db-fgui');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const dbm = require('../electron/db.js');
const { DatabaseSync } = require('node:sqlite');

// 0. 先触发 open()(执行迁移),再检查列
dbm.readDb();
const file = dbm.dbFile();
console.log('DB FILE:', file);
const conn = new DatabaseSync(file);
const cols = conn.prepare('PRAGMA table_info(scenes)').all().map((r) => r.name);
console.log('scenes cols:', JSON.stringify(cols));
if (!cols.includes('subtype') || !cols.includes('fgui_snapshots')) {
  console.error('✗ scenes 表缺少 subtype/fgui_snapshots 列');
  process.exit(1);
}
console.log('✓ scenes 表迁移列存在');
conn.close();

// 2. 读写往返:插入一条 fgui 场景(带快照)→ 读回 → 清理
let d = dbm.readDb();
d.scenes = (d.scenes || []).filter((s) => s.id !== 'sn_test1');
d.scenes.push({
  id: 'sn_test1', categoryId: '', name: '__test_fgui__', filePath: 'E:/x/Bag.bin',
  type: 'file', subtype: 'fgui', remark: '', tags: ['ui'], size: 1234, mtime: 5678,
  fguiSnapshots: [{ id: 'snp1', name: 'BagView_layout_1', path: 'E:/x/fgui_edit/BagView_layout_1.json', timestamp: 1786126640858 }],
  createdAt: 1, updatedAt: 2,
});
const w1 = dbm.writeDb(d);
console.log('write:', w1);

const d2 = dbm.readDb();
const t = d2.scenes.find((s) => s.id === 'sn_test1');
const ok = t && t.subtype === 'fgui' && Array.isArray(t.fguiSnapshots) && t.fguiSnapshots.length === 1
  && t.fguiSnapshots[0].path.includes('fgui_edit') && t.tags.length === 1;
console.log('roundtrip subtype:', t && t.subtype, '| snapshots:', t && t.fguiSnapshots.length, '| tags:', t && t.tags.join(','));
if (!ok) { console.error('✗ 往返读取不一致'); process.exit(1); }
console.log('✓ fgui 场景条目(subtype+快照+tags)持久化往返通过');

// 清理
const d3 = dbm.readDb();
d3.scenes = d3.scenes.filter((s) => s.id !== 'sn_test1');
dbm.writeDb(d3);
console.log('✓ 已清理测试条目');
process.exit(0);
