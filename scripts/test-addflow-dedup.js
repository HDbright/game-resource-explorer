// 验证 addFlow 去重判定逻辑(与浏览器端一致)
function normPath(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }
function isDuplicateInCategory(filePath, categoryId, items) {
  const fp = normPath(filePath);
  const catId = categoryId || '';
  return items.some((it) => (it.categoryId || '') === catId && normPath(it.filePath) === fp);
}

const items = [
  { categoryId: 'c1', filePath: 'E:/Download/页游资源/spine/zy.json' },
  { categoryId: '', filePath: 'E:/Download/页游资源/spine/guochang.json' },
  { categoryId: 'c1', filePath: 'E:/Download/页游资源/spine/300708.skel' },
];

const cases = [
  ['同分类同文件(应重复)', isDuplicateInCategory('E:/Download/页游资源/spine/zy.json', 'c1', items), true],
  ['同文件不同分类(不应重复)', isDuplicateInCategory('E:/Download/页游资源/spine/zy.json', 'c2', items), false],
  ['路径大小写不同(应重复)', isDuplicateInCategory('e:/download/页游资源/SPINE/ZY.JSON', 'c1', items), true],
  ['反斜杠分隔符(应重复)', isDuplicateInCategory('E:\\Download\\页游资源\\spine\\zy.json', 'c1', items), true],
  ['未分类同文件(应重复)', isDuplicateInCategory('E:/Download/页游资源/spine/guochang.json', '', items), true],
  ['未分类->分类(不应重复)', isDuplicateInCategory('E:/Download/页游资源/spine/guochang.json', 'c3', items), false],
  ['新文件(不应重复)', isDuplicateInCategory('E:/Download/页游资源/spine/300701.skel', 'c1', items), false],
];
let pass = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  if (ok) pass++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | got=' + got + ' want=' + want);
}
console.log(pass + '/' + cases.length + ' passed');
process.exit(pass === cases.length ? 0 : 1);
