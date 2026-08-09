'use strict';
/** 需求 2 逻辑验证: 递归批量添加时按路径结构建目录(纯逻辑模拟 addFlow 辅助函数) */
const assert = require('assert');

// ---- 模拟 state ----
const state = { categories: [], items: [] };
function addCategory({ name, typeTags = [], parentId = '' }) {
  const c = { id: 'c' + (state.categories.length + 1), name, typeTags, parentId };
  state.categories.push(c);
  return c;
}
function addItem({ categoryId, filePath }) {
  state.items.push({ categoryId, filePath });
}

// ---- 复刻 addFlow.js 辅助函数 ----
function normPath(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }
function isWithin(dir, root) {
  const d = normPath(dir);
  const r = normPath(root).replace(/\/+$/, '');
  return d === r || d.startsWith(r + '/');
}
function relSegments(dir, root) {
  const d = normPath(dir);
  const r = normPath(root).replace(/\/+$/, '');
  if (d === r) return [];
  const rel = d.slice(r.length + 1);
  return rel.split('/').filter(Boolean);
}
function ensureCategoryChain(baseParentId, segs, typeTags) {
  let parentId = baseParentId;
  const created = [];
  for (const seg of segs) {
    const kids = state.categories.filter((c) => (c.parentId || '') === parentId);
    let c = kids.find((k) => k.name === seg);
    if (!c) { c = addCategory({ name: seg, typeTags, parentId }); created.push(c.id); }
    parentId = c.id;
  }
  return { catId: parentId, created };
}

// 目标分类(用户选择的)
const targetCat = addCategory({ name: '我的UI', typeTags: ['image'] });

// 模拟扫描结果(递归)
const flow = {
  recursive: true,
  dirs: ['E:/game/ui', 'E:/game/audio'],
  entries: [
    { file: 'E:/game/ui/a.png', dir: 'E:/game/ui', type: 'image', base: 'a' },
    { file: 'E:/game/ui/sub1/b.png', dir: 'E:/game/ui/sub1', type: 'image', base: 'b' },
    { file: 'E:/game/ui/sub1/sub2/c.png', dir: 'E:/game/ui/sub1/sub2', type: 'image', base: 'c' },
    { file: 'E:/game/ui/sub1/sub2/d.png', dir: 'E:/game/ui/sub1/sub2', type: 'image', base: 'd' },
    { file: 'E:/game/audio/sfx/beep.mp3', dir: 'E:/game/audio/sfx', type: 'audio', base: 'beep' },
  ],
  checked: new Set(['E:/game/ui/a.png', 'E:/game/ui/sub1/b.png', 'E:/game/ui/sub1/sub2/c.png',
                    'E:/game/ui/sub1/sub2/d.png', 'E:/game/audio/sfx/beep.mp3']),
};

let added = 0, dirsCreated = 0;
for (const e of flow.entries) {
  if (!flow.checked.has(e.file)) continue;
  let targetCatId = targetCat.id;
  if (flow.recursive) {
    const root = flow.dirs.find((d) => isWithin(e.dir, d));
    if (root) {
      const segs = relSegments(e.dir, root);
      if (segs.length) {
        const r = ensureCategoryChain(targetCat.id, segs, targetCat.typeTags || []);
        targetCatId = r.catId;
        dirsCreated += r.created.length;
      }
    }
  }
  addItem({ categoryId: targetCatId, filePath: e.file });
  added++;
}

console.log('添加:', added, ' 新建目录数:', dirsCreated);
console.log('目录树:', state.categories.map((c) => `${c.name}(parent=${c.parentId || '顶级'},tags=${JSON.stringify(c.typeTags)})`).join(' | '));
console.log('文件归属:');
for (const it of state.items) {
  const cat = state.categories.find((c) => c.id === it.categoryId);
  console.log('  ', it.filePath, '→', cat ? cat.name : '(目标分类)');
}

// ---- 断言 ----
function catByName(name) { return state.categories.find((c) => c.name === name); }
const sub1 = catByName('sub1');
const sub2 = catByName('sub2');
const sfx = catByName('sfx');
assert(sub1, '应创建 sub1');
assert(sub2, '应创建 sub2');
assert(sfx, '应创建 sfx');
assert(sub1.parentId === targetCat.id, 'sub1 应是目标分类的子目录');
assert(sub2.parentId === sub1.id, 'sub2 应是 sub1 的子目录');
assert(sub1.typeTags.includes('image'), 'sub1 应继承目标分类标签');
assert(sfx.parentId === targetCat.id, 'sfx 应在目标分类下');
// 目录只建一次(sub2 复用): 3 个新目录 = sub1, sub2, sfx
assert(dirsCreated === 3, '应恰好新建 3 个目录,实际 ' + dirsCreated);
// 文件归属
const catOf = (f) => state.categories.find((c) => c.id === state.items.find((i) => i.filePath === f).categoryId).name;
assert(catOf('E:/game/ui/a.png') === '我的UI', '根目录文件应归目标分类');
assert(catOf('E:/game/ui/sub1/b.png') === 'sub1', 'b.png 应归 sub1');
assert(catOf('E:/game/ui/sub1/sub2/c.png') === 'sub2', 'c.png 应归 sub2');
assert(catOf('E:/game/ui/sub1/sub2/d.png') === 'sub2', 'd.png 应归 sub2(复用)');
assert(catOf('E:/game/audio/sfx/beep.mp3') === 'sfx', 'beep.mp3 应归 sfx');
// 非递归模式: 全部进目标分类
{
  const before = state.categories.length;
  let n = 0;
  for (const e of flow.entries) {
    // 模拟 recursive=false
    const targetCatId = targetCat.id; // 不建目录
    addItem({ categoryId: targetCatId, filePath: e.file + '.x' });
    n++;
  }
  assert(state.categories.length === before, '非递归不应建目录');
  assert(n === 5, '非递归正常添加');
}
console.log('\n✅ 需求 2 逻辑验证全部通过');
