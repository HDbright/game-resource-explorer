/**
 * 皮肤区段解码验证:将解码器的 skins 输出与官方导出 JSON(ground truth)逐项比对。
 * 用法: node scripts/verify-spine-skins.js <file.spine> <export.json>
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const spineFile = process.argv[2];
const truthFile = process.argv[3];
if (!spineFile || !truthFile) { console.error('用法: node verify-spine-skins.js <file.spine> <export.json>'); process.exit(1); }

const tmp = path.join(require('os').tmpdir(), 'skin-verify-' + Date.now() + '.json');
execFileSync(process.execPath, [path.join(__dirname, '..', 'electron', 'tools', 'spineProjectToJson.js'), spineFile, tmp], { stdio: 'pipe' });
const dec = JSON.parse(fs.readFileSync(tmp, 'utf8'));
const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));

// ground truth 归一(3.8 对象 / 4.x 数组)
const truthSkins = Array.isArray(truth.skins)
  ? truth.skins.map((s) => ({ name: s.name, attachments: s.attachments || {} }))
  : Object.entries(truth.skins || {}).map(([name, att]) => ({ name, attachments: att || {} }));

let issues = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); issues++; };

// 官方皮肤名可能带目录前缀(clothes/hoodie-orange);二进制块头只存裸名 → 按基名比对
const base = (s) => String(s).replace(/^.*\//, '');
const decSkins = dec.skins || [];
console.log(`解码皮肤: [${decSkins.map((s) => s.name).join(', ')}]`);
console.log(`官方皮肤: [${truthSkins.map((s) => s.name).join(', ')}]`);

// ① 皮肤名集合一致(default 顺序容忍差异)
const decNames = decSkins.map((s) => base(s.name)).sort();
const truthNames = truthSkins.map((s) => base(s.name)).sort();
const onlyDec = decNames.filter((x) => !truthNames.includes(x));
const onlyTruth = truthNames.filter((x) => !decNames.includes(x));
if (onlyDec.length || onlyTruth.length) fail(`皮肤名差异: 多[${onlyDec.join(',')}] 少[${onlyTruth.join(',')}]`);

// ② 逐皮肤比对插槽集合 + 条目
for (const ts of truthSkins) {
  const ds = decSkins.find((s) => base(s.name) === base(ts.name));
  if (!ds) { fail(`缺少皮肤 ${ts.name}`); continue; }
  const tsSlots = Object.keys(ts.attachments);
  const dsSlots = Object.keys(ds.attachments);
  const missingSlots = tsSlots.filter((x) => !dsSlots.includes(x));
  const extraSlots = dsSlots.filter((x) => !tsSlots.includes(x));
  if (missingSlots.length) fail(`[${ts.name}] 缺插槽: ${missingSlots.join(',')}`);
  if (extraSlots.length) fail(`[${ts.name}] 多余插槽: ${extraSlots.join(',')}`);
  let entries = 0, keysOk = 0, keyBad = [], typeBad = [];
  for (const slot of tsSlots) {
    const tEnts = Object.entries(ts.attachments[slot]);
    const dEnts = ds.attachments[slot] ? Object.entries(ds.attachments[slot]) : [];
    entries += tEnts.length;
    if (dEnts.length !== tEnts.length) fail(`[${ts.name}/${slot}] 条目数 ${dEnts.length} ≠ 官方 ${tEnts.length}`);
    for (const [tk, ta] of tEnts) {
      const hit = dEnts.find(([dk]) => dk === tk) || dEnts.find(([, da]) => da && (da.name === ta.name || (da.name || '').endsWith('/' + tk)));
      if (!hit) { keyBad.push(`${slot}/${tk}`); continue; }
      keysOk++;
      const [dk, da] = hit;
      const tt = ta.type || 'region';
      const dtt = da.type === 'linkedmesh' ? 'linkedmesh' : (da.type || 'region');
      if (dtt !== tt) typeBad.push(`${slot}/${tk}: ${dtt} ≠ ${tt}`);
      if (dk !== tk && !(da.name === ta.name)) keyBad.push(`${slot}/${tk}→${dk}`);
    }
  }
  const stat = `[${ts.name}] 插槽 ${dsSlots.length}/${tsSlots.length}, 条目 ${keysOk}/${entries} 键名吻合`;
  console.log(issues ? '  ? ' + stat : '  ✓ ' + stat);
  if (keyBad.length) fail(`[${ts.name}] 键名不符: ${keyBad.slice(0, 8).join(', ')}${keyBad.length > 8 ? ' …' : ''}`);
  if (typeBad.length) fail(`[${ts.name}] 类型不符: ${typeBad.slice(0, 8).join(', ')}`);
}

if (issues) { console.error(`FAILED(${issues})`); process.exit(1); }
console.log('PASSED');
