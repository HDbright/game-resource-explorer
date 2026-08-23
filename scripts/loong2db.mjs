/**
 * LoongBones 工程数据 → DragonBones 5.5 标准格式转换器。
 * 用法:node scripts/loong2db.mjs <目录>
 * 输入:<目录>/Dragon_工程数据.json + texture.json + texture.png
 * 输出:<目录>/Dragon_ske.json + Dragon_tex.json(可直接入库用 DbPlayer 预览)
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'Dragon_工程数据.json'))) {
  console.error('用法: node scripts/loong2db.mjs <含 Dragon_工程数据.json 的目录>');
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(path.join(dir, 'Dragon_工程数据.json'), 'utf8'));
const texAtlas = JSON.parse(fs.readFileSync(path.join(dir, 'texture.json'), 'utf8'));
const db = doc.runtime.dragonbones;
const RAD2DEG = 180 / Math.PI;

// 选骨骼数最多的骨架(跳过空壳 armature1)
const armatures = Object.values(db.armatureMap);
const arm = armatures.reduce((a, b) => (Object.keys(b.bones.map).length > Object.keys(a.bones.map).length ? b : a));
const boneById = arm.bones.map;
const slotList = arm.slots.ids.map((id) => arm.slots.map[id]);
const FPS = 30;

const r2 = (v) => Math.round((v || 0) * 100) / 100;
const tf = (t) => ({
  x: r2(t.x), y: r2(t.y),
  skX: r2((t.skewX || 0) * RAD2DEG), skY: r2((t.skewY || 0) * RAD2DEG),
  scX: t.scaleX === undefined ? 1 : r2(t.scaleX), scY: t.scaleY === undefined ? 1 : r2(t.scaleY),
});

// 骨骼(父级在前:parentId=0 为根)
const bones = arm.bones.ids.map((id) => {
  const b = boneById[id];
  const parent = b.parentId ? (boneById[b.parentId] || {}).name : '';
  return { name: b.name, parent: parent || undefined, length: r2(b.length || 0), transform: tf(b.transform) };
});

// 插槽(按 ids 顺序 = z 序)与默认皮肤显示
const slots = [];
const skinSlots = [];
for (const s of slotList) {
  const parent = (boneById[s.parentId] || {}).name || (bones[0] && bones[0].name);
  slots.push({ name: s.name, parent });
  const displays = s.displays.ids.map((did) => s.displays.map[did]).filter((d) => d.type === 0);
  if (!displays.length) continue;
  const idx = Math.max(0, Math.min(displays.length - 1, s.displayIndex || 0));
  slots[slots.length - 1].attachment = displays[idx].name;
  skinSlots.push({
    name: s.name,
    display: displays.map((d) => ({
      name: d.name,
      path: d.name,
      type: 'image',
      transform: tf(d.transform),
      pivot: { x: d.pivot ? d.pivot[0] : 0.5, y: d.pivot ? d.pivot[1] : 0.5 },
    })),
  });
}

// 动画:LoongBones 帧号(30fps)→ DB duration 帧;curve [1]=线性
const framesToDb = (frames, frameMap, total, toVal) => {
  const out = [];
  frames.forEach((fid, i) => {
    const f = frameMap[fid];
    const next = i + 1 < frames.length ? frameMap[frames[i + 1]].frame : total;
    const o = { duration: Math.max(0, next - f.frame), ...toVal(f) };
    if (f.curve && f.curve[0] === 1) o.curve = 0; // 线性补间
    out.push(o);
  });
  return out;
};

const animIds = Array.isArray(arm.animations) ? arm.animations : (arm.animations.ids || []);
const animations = animIds.map((aid) => {
  const a = db.animationMap[aid];
  if (!a || !a.duration) return null;
  const total = a.duration;
  const boneArr = [];
  for (const [bid, ch] of Object.entries(a.bones || {})) {
    const name = (boneById[bid] || {}).name || ch.name;
    if (!name) continue;
    const e = {};
    for (const tl of Object.values(ch.timelineMap || {})) {
      if (tl.type === 'translate') e.translateFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ x: r2(f.value.x), y: r2(f.value.y) }));
      else if (tl.type === 'rotate') e.rotateFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ rotate: r2(f.value.rotate) }));
      else if (tl.type === 'scale') e.scaleFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ x: f.value.x, y: f.value.y }));
    }
    if (Object.keys(e).length) boneArr.push({ name, ...e });
  }
  const slotArr = [];
  for (const [sid, ch] of Object.entries(a.slots || {})) {
    const name = (slotList.find((s) => s.id === +sid) || {}).name || ch.name;
    if (!name) continue;
    const e = {};
    for (const tl of Object.values(ch.timelineMap || {})) {
      if (tl.type === 'displayIndex') e.displayFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ value: f.value }));
      // color 值为 -1 表示未启用,跳过
    }
    if (Object.keys(e).length) slotArr.push({ name, ...e });
  }
  const defA = db.animationMap[arm.defaultAnimation];
  return {
    name: a.name,
    duration: total,
    playTimes: a.name === (defA && defA.name) ? -1 : 0,
    ...(boneArr.length ? { bone: boneArr } : {}),
    ...(slotArr.length ? { slot: slotArr } : {}),
  };
}).filter(Boolean);

const ske = {
  version: '5.5',
  compatibleVersion: '5.5',
  frameRate: FPS,
  name: 'Dragon',
  armature: [{
    type: 'Armature',
    frameRate: FPS,
    name: 'Dragon',
    aabb: { x: -300, y: -400, width: 600, height: 800 },
    bone: bones,
    slot: slots.map((s, i) => ({ name: s.name, parent: s.parent, z: i })),
    skin: [{ name: 'default', slot: skinSlots }],
    animation: animations,
    defaultActions: [{ gotoAndPlay: (db.animationMap[arm.defaultAnimation] || {}).name || (animations[0] && animations[0].name) }],
  }],
};

// 贴图集:texture.json 已是 DB atlas 格式,规范 imagePath
const tex = { ...texAtlas, imagePath: texAtlas.imagePath || 'texture.png', width: texAtlas.width || 1024, height: texAtlas.height || 1024 };

fs.writeFileSync(path.join(dir, 'Dragon_ske.json'), JSON.stringify(ske, null, 1));
fs.writeFileSync(path.join(dir, 'Dragon_tex.json'), JSON.stringify(tex, null, 1));
console.log(`转换完成:${arm.name} → ${bones.length} 骨骼 / ${slots.length} 插槽 / ${animations.length} 动画(${animations.map((a) => a.name).join(', ')})`);
console.log(`输出:${path.join(dir, 'Dragon_ske.json')} + Dragon_tex.json`);
