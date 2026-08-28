/**
 * 骨骼动画编辑器 - 数据模型(DragonBones/LoongBones 风格)。
 *
 * 项目结构(纯 JSON,可直接序列化):
 * project = {
 *   format: 'boneeditor', version: 1,
 *   name, frameRate,
 *   images: [{ id, name, w, h, dataUrl }],
 *   armature: {
 *     name,
 *     bones: [{ name, parent, x, y, rotation, length, scaleX, scaleY, skew,
 *               inheritTranslation, inheritRotation, inheritScale }],
 *     slots: [{ name, parent, z, displayIndex, color: {r,g,b,a},
 *               displays: [{ name, imageId, transform: {x,y,rotation,scaleX,scaleY}, pivot: {x,y} }] }],
 *     animations: [{ name, duration, loop,
 *       bones: { [boneName]: { translate: Key[], rotate: Key[], scale: Key[] } },
 *       slots: { [slotName]: { color: Key[], display: Key[] } } }]
 *   }
 * }
 * Key = { frame, v: {…通道值}, ease: { type, pts? } }   // ease 描述「本帧→下一帧」的补间曲线
 */

let _uid = 1;
export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + '_' + (_uid++).toString(36);
}

/** 缓动预设(命名曲线 + 三次贝塞尔由 pts 控制点表达) */
export const EASE_PRESETS = [
  { type: 'linear', label: '线性' },
  { type: 'sineIn', label: '正弦淡入' },
  { type: 'sineOut', label: '正弦淡出' },
  { type: 'sineInOut', label: '正弦淡入出' },
  { type: 'quadIn', label: '二次淡入' },
  { type: 'quadOut', label: '二次淡出' },
  { type: 'quadInOut', label: '二次淡入出' },
  { type: 'cubicIn', label: '三次淡入' },
  { type: 'cubicOut', label: '三次淡出' },
  { type: 'cubicInOut', label: '三次淡入出' },
  { type: 'backIn', label: '回弹淡入' },
  { type: 'backOut', label: '回弹淡出' },
  { type: 'step', label: '阶梯(无补间)' },
  { type: 'bezier', label: '贝塞尔(自定义)' },
];

export function defaultEase() {
  return { type: 'sineInOut' };
}

/** 新建空项目(含一条根骨骼与一个默认动画,开箱即可编辑) */
export function createProject(name = '新建项目') {
  return {
    format: 'boneeditor',
    version: 1,
    name,
    frameRate: 30,
    images: [],
    armature: {
      name: 'armature',
      bones: [
        { name: 'root', parent: '', x: 0, y: 0, rotation: 0, length: 60, scaleX: 1, scaleY: 1, skew: 0, shearX: 0, shearY: 0, inheritTranslation: true, inheritRotation: true, inheritScale: true },
      ],
      slots: [],
      animations: [createAnimation('new_animation', 30)],
    },
  };
}

/** 空白等待态项目(无骨骼无贴图;编辑器初始/关闭后状态,等待 打开/新建/导入) */
export function createBlankProject() {
  const p = createProject('未命名项目');
  p.armature.bones = [];
  p.armature.animations = [createAnimation('new_animation', 30)];
  return p;
}

export function createAnimation(name, duration = 30) {
  return { name, duration, loop: true, bones: {}, slots: {} };
}

export function createBone(name, parent, x, y, rotation, length) {
  return { name, parent, x, y, rotation, length: length || 50, scaleX: 1, scaleY: 1, skew: 0, shearX: 0, shearY: 0, inheritTranslation: true, inheritRotation: true, inheritScale: true, visible: true, locked: false };
}

export function createSlot(name, parent) {
  return { name, parent, z: 0, displayIndex: 0, color: { r: 255, g: 255, b: 255, a: 1 }, displays: [], locked: false };
}

export function createDisplay(name, imageId) {
  return { name, imageId, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, pivot: { x: 0.5, y: 0.5 } };
}

// ---------------- 查询辅助 ----------------

export function boneList(p) { return p.armature.bones; }
export function boneMap(p) {
  const m = new Map();
  for (const b of p.armature.bones) m.set(b.name, b);
  return m;
}
export function slotList(p) { return p.armature.slots; }
export function animList(p) { return p.armature.animations; }

export function boneChildren(p, name) {
  return p.armature.bones.filter((b) => b.parent === name);
}

/** 按树形顺序重排骨骼(父在前),返回新数组 */
export function bonesInTreeOrder(p) {
  const out = [];
  const walk = (parent, depth) => {
    for (const b of p.armature.bones) {
      if (b.parent === parent) { b._depth = depth; out.push(b); walk(b.name, depth + 1); }
    }
  };
  walk('', 0);
  // 孤儿(父不存在)按原顺序补到末尾,避免数据异常时丢骨骼
  for (const b of p.armature.bones) if (!out.includes(b)) { b._depth = 0; out.push(b); }
  return out;
}

export function findAnim(p, name) {
  return p.armature.animations.find((a) => a.name === name) || null;
}

/** 按 z 排序的插槽列表(z 小的先绘制 = 在底层;与 DragonBones zOrder 一致) */
export function slotsInZOrder(p) {
  return [...p.armature.slots].sort((a, b) => (a.z - b.z) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 通道取值:骨架模式下取绑定姿势;动画模式优先取采样结果 */
export function bonePose(bone, animPose) {
  if (animPose && animPose.bones && animPose.bones[bone.name]) {
    const o = animPose.bones[bone.name];
    return {
      x: o.x !== undefined ? o.x : bone.x,
      y: o.y !== undefined ? o.y : bone.y,
      rotation: o.rotation !== undefined ? o.rotation : bone.rotation,
      scaleX: o.scaleX !== undefined ? o.scaleX : bone.scaleX,
      scaleY: o.scaleY !== undefined ? o.scaleY : bone.scaleY,
    };
  }
  return { x: bone.x, y: bone.y, rotation: bone.rotation, scaleX: bone.scaleX, scaleY: bone.scaleY };
}

/** 唯一命名:name / name1 / name2 …(同类型内查重) */
export function uniqueName(existing, base) {
  const names = new Set(existing.map((s) => String(s)));
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) {
    const n = base + i;
    if (!names.has(n)) return n;
  }
}

/** 序列化 / 反序列化(深拷贝) */
export function serialize(p) { return JSON.stringify(p); }
export function deserialize(json) {
  const p = JSON.parse(json);
  if (p && p.format === 'boneeditor' && p.armature) return p;
  if (p && p.skeleton && Array.isArray(p.bones)) {
    throw new Error('这是 Spine 骨架 JSON,请使用工具栏「🦂 导入 Spine JSON」打开');
  }
  throw new Error('不是有效的骨骼动画编辑器项目文件(.lbone.json)');
}

/** 裁剪模型中的临时字段(_depth 等) */
export function cleanProject(p) {
  for (const b of p.armature.bones) delete b._depth;
  return p;
}
