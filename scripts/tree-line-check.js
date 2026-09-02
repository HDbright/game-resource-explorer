/**
 * 层级树连线连续性 + 皮肤附件行结构验证
 * (独立模拟,公式与 src/editor/panels.js 的 gridRow/boneGuides/皮肤附件视图完全一致)
 *
 * 断言1(连续性):无过滤、无折叠时,每个同级分组的竖线从父行下方连续延伸到末位子节点 └ 处,
 *   中间不因展开的子树或皮肤附件行而中断。
 * 断言2(皮肤行结构):多皮肤时,插槽子行 = 当前显示列表(非 default 激活皮肤带前缀)
 *   + 其他皮肤附件(default 原名,其余 皮肤名/附件名;回退并入的 default 条目去重)。
 */
'use strict';

// ---- 模拟数据 ----
const bonesDef = [
  { name: 'hip', parent: null },
  { name: 'boneA', parent: 'hip' },
  { name: 'A1', parent: 'boneA' },
  { name: 'A1a', parent: 'A1' },
  { name: 'A1b', parent: 'A1' },
  { name: 'A2', parent: 'boneA' },
  { name: 'boneB', parent: 'hip' },
  { name: 'B1', parent: 'boneB' },
];
// 皮肤模型(与运行时 JSON raw.skins 同构):default + goblingirl 两套
const skinsDef = [
  { name: 'default', attachments: { slotH1: { 'head-img': {} }, slotX: { 'legacy-x': {} } } },
  { name: 'goblingirl', attachments: { slotX: { 'alt-x': {} }, slotB2: { 'girl-b2': {} } } },
];
// 每皮肤激活时的插槽显示列表(复刻 switchSpineSkin/importSpineProject 的构建:
// 激活皮肤条目 + 未覆盖插槽回退 default,回退条目带 shared 标记)
function displaysFor(activeSkin, slotName) {
  const act = skinsDef.find((s) => s.name === activeSkin);
  const def = skinsDef.find((s) => s.name === 'default');
  if (act && act.attachments[slotName]) {
    return Object.keys(act.attachments[slotName]).map((n) => ({ name: n }));
  }
  if (def && def.attachments[slotName]) {
    return Object.keys(def.attachments[slotName]).map((n) => ({ name: n, shared: true }));
  }
  return [];
}
const slotHosts = [
  { name: 'slotH1', bone: 'hip' },
  { name: 'slotX', bone: 'A1' },
  { name: 'slotB1', bone: 'boneB' },
  { name: 'slotB2', bone: 'boneB' },
];

// ---- 与 panels.js 相同的基础函数 ----
const boneChildren = (p, name) => p.armature.bones.filter((b) => b.parent === name);
const bonesInTreeOrder = (p) => {
  const out = [];
  const walk = (parent, depth) => {
    for (const b of p.armature.bones.filter((x) => x.parent === parent)) {
      b._depth = depth; out.push(b); walk(b.name, depth + 1);
    }
  };
  walk(null, 0);
  return out;
};

// ---- 复刻 refreshOutline 的行生成(连线字段 + 标签);phCol = 占位符已折叠的插槽名集合 ----
function renderRows(p, activeSkin, phCol) {
  const bones = bonesInTreeOrder(p);
  const lastBoneNames = new Set();
  for (const b of bones) {
    const sibs = b.parent ? boneChildren(p, b.parent) : bones.filter((x) => !x.parent);
    if (sibs.length && sibs[sibs.length - 1].name === b.name) lastBoneNames.add(b.name);
  }
  const boneByName = new Map(bones.map((b) => [b.name, b]));
  const boneGuides = (bone) => {
    let g = '';
    let anc = bone.parent ? boneByName.get(bone.parent) : null;
    while (anc) {
      g = (lastBoneNames.has(anc.name) ? '0' : '1') + g;
      anc = anc.parent ? boneByName.get(anc.parent) : null;
    }
    return g;
  };
  const activeSkinName = activeSkin || 'default';
  const skinAttsBySlot = new Map();
  for (const sk of skinsDef) {
    if (sk.name === activeSkinName) continue;
    for (const [slotName, atts] of Object.entries(sk.attachments || {})) {
      if (!skinAttsBySlot.has(slotName)) skinAttsBySlot.set(slotName, []);
      for (const attName of Object.keys(atts || {})) skinAttsBySlot.get(slotName).push({ skin: sk.name, attName });
    }
  }
  const slotByBone = new Map();
  for (const s of slotHosts) {
    if (!slotByBone.has(s.bone)) slotByBone.set(s.bone, []);
    slotByBone.get(s.bone).push({ name: s.name, displays: displaysFor(activeSkinName, s.name) });
  }
  const rows = [{ depth: 0, isLast: false, guides: '', label: '(sec)' }];
  for (const bone of bones) {
    const depth = (bone._depth || 0) + 1;
    const kids = boneChildren(p, bone.name).length;
    const slotList = slotByBone.get(bone.name) || [];
    rows.push({ depth, isLast: lastBoneNames.has(bone.name), guides: boneGuides(bone), label: bone.name });
    const slotGuideBase = boneGuides(bone) + (lastBoneNames.has(bone.name) ? '0' : '1');
    for (let si = 0; si < slotList.length; si++) {
      const s = slotList[si];
      const isSlotLast = si === slotList.length - 1 && kids === 0;
      rows.push({ depth: depth + 1, isLast: isSlotLast, guides: slotGuideBase, label: s.name });
      const attCount = s.displays.length;
      const skinKids = (skinAttsBySlot.get(s.name) || [])
        .filter((e) => !(e.skin === 'default' && s.displays.some((d) => d.name === e.attName)));
      // 多皮肤:插槽 > 皮肤占位符(深度+2,插槽唯一子节点,末位 └) > 附件(深度+3);
      // 占位符折叠(phCol):仅收起占位符的子附件,占位符行保留
      const usePh = skinsDef.length > 1;
      const phExpanded = !usePh || !phCol || !phCol.has(s.name);
      const attDepth = depth + (usePh ? 3 : 2);
      const attGuides = usePh
        ? slotGuideBase + (isSlotLast ? '0' : '1') + '0'
        : slotGuideBase + (isSlotLast ? '0' : '1');
      if (usePh) rows.push({ depth: depth + 2, isLast: true, guides: slotGuideBase + (isSlotLast ? '0' : '1'), label: s.name + '(皮肤占位符)' });
      if (phExpanded) {
      for (let di = 0; di < attCount; di++) {
        const d = s.displays[di];
        const dispLabel = (activeSkinName !== 'default' && skinsDef.length > 1 && !d.shared) ? `${activeSkinName}/${d.name}` : d.name;
        rows.push({ depth: attDepth, isLast: skinKids.length === 0 && di === attCount - 1, guides: attGuides, label: dispLabel });
      }
      for (let ki = 0; ki < skinKids.length; ki++) {
        const e = skinKids[ki];
        const label = e.skin === 'default' ? e.attName : `${e.skin}/${e.attName}`;
        rows.push({ depth: attDepth, isLast: ki === skinKids.length - 1, guides: attGuides, label: label, skinAlt: e.skin });
      }
      }
    }
  }
  return rows;
}

// ---- 连续性断言(同层多分组共用同一 x 列,分组间允许断开,只查组内) ----
function checkContiguity(rows, label) {
  const drawsFull = (r, k) => (r.depth === k && !r.isLast) || (r.guides || '')[k - 1] === '1';
  const drawsAny = (r, k) => r.depth === k || (r.guides || '')[k - 1] === '1';
  let fails = 0;
  const maxLevel = Math.max(...rows.map((r) => Math.max(r.depth, (r.guides || '').length)));
  for (let i = 0; i < rows.length; i++) {
    for (let k = 1; k <= maxLevel; k++) {
      if (drawsFull(rows[i], k) && i + 1 < rows.length && !drawsAny(rows[i + 1], k)) {
        console.error(`✗ [${label}] 第${i}行(${rows[i].label})全高画 L${k},第${i + 1}行(${rows[i + 1].label})未延续 → 连线中断`);
        fails++;
      }
      if (i > 0 && drawsAny(rows[i], k) && !drawsFull(rows[i - 1], k) && rows[i - 1].depth !== k - 1) {
        console.error(`✗ [${label}] 第${i}行(${rows[i].label})画 L${k} 但上一行(${rows[i - 1].label},深度${rows[i - 1].depth})非父行 → 悬空/断点`);
        fails++;
      }
    }
  }
  console.log(`${fails ? '✗' : '✓'} [${label}] 连续性${fails ? `失败(${fails}处)` : '通过'}(${rows.length}行)`);
  return fails;
}

// ---- 皮肤行结构断言 ----
function expectedChildren(activeSkin, slotName) {
  const disp = displaysFor(activeSkin, slotName).map((d) =>
    (activeSkin !== 'default' && !d.shared) ? `goblingirl/${d.name}` : d.name);
  const alt = [];
  for (const sk of skinsDef) {
    if (sk.name === activeSkin) continue;
    for (const attName of Object.keys(sk.attachments[slotName] || {})) {
      if (sk.name === 'default' && displaysFor(activeSkin, slotName).some((d) => d.name === attName)) continue;
      alt.push(sk.name === 'default' ? attName : `${sk.name}/${attName}`);
    }
  }
  return [...disp, ...alt];
}
function checkSkins(activeSkin) {
  const rows = renderRows({ armature: { bones: bonesDef.map((b) => ({ ...b })) } }, activeSkin);
  let fails = 0;
  for (const slot of slotHosts) {
    const idx = rows.findIndex((r) => r.label === slot.name);
    // 插槽的直接子行(多皮肤 = 皮肤占位符;其后占位符的子行 = 显示列表 + 其他皮肤条目)
    const kids = [];
    for (let i = idx + 1; i < rows.length && rows[i].depth === rows[idx].depth + 1; i++) kids.push(rows[i].label);
    const grand = [];
    if (skinsDef.length > 1 && kids.length === 1) {
      const phIdx = idx + 1;
      for (let i = phIdx + 1; i < rows.length && rows[i].depth === rows[phIdx].depth + 1; i++) grand.push(rows[i].label);
    }
    const exp = expectedChildren(activeSkin, slot.name);
    const gotPh = kids.length === 1 && kids[0] === slot.name + '(皮肤占位符)' ? grand : kids;
    const ok = JSON.stringify(gotPh) === JSON.stringify(exp);
    if (!ok) { console.error(`✗ [皮肤=${activeSkin}] 插槽 ${slot.name} 子行 ${JSON.stringify(gotPh)} ≠ 期望 ${JSON.stringify(exp)}`); fails++; }
  }
  console.log(`${fails ? '✗' : '✓'} [皮肤=${activeSkin}] 皮肤附件行结构通过`);
  return { fails, rows };
}

let fails = 0;
for (const active of ['default', 'goblingirl']) {
  const st = checkSkins(active);
  fails += st.fails;
  fails += checkContiguity(st.rows, `皮肤=${active}`);
  // 占位符折叠状态:占位符行保留、子附件收起,连线仍连续
  const phRows = renderRows({ armature: { bones: bonesDef.map((b) => ({ ...b })) } }, active, new Set(['slotX']));
  const hasPh = phRows.some((r) => r.label === 'slotX(皮肤占位符)');
  const noKids = !phRows.some((r) => r.depth >= 4 && ['legacy-x', 'alt-x', 'goblingirl/alt-x'].includes(r.label));
  if (!hasPh || !noKids) { console.error(`✗ [皮肤=${active}] 占位符折叠态异常: 占位符行${hasPh ? '在' : '缺失'}, 子附件${noKids ? '已收起' : '仍显示'}`); fails++; }
  else console.log(`✓ [皮肤=${active}] 占位符折叠仅收起子附件`);
  fails += checkContiguity(phRows, `皮肤=${active} 占位符折叠`);
}
if (fails) { console.error('FAILED'); process.exit(1); }
console.log('PASSED');
