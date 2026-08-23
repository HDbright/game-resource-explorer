/**
 * 骨骼动画编辑器 - DragonBones / LoongBones 导入。
 *
 * LoongBones 私有文档(runtime.dragonbones 图结构)先转成 DragonBones 5.5 结构
 * (scripts/loong2db.mjs 的进程内移植),再与标准 DB 骨架 JSON 走同一套
 * 「DB → 编辑器模型」映射:编辑器模型即 DragonBones 坐标约定(y 向下、旋转顺时针),
 * 导入后骨骼/插槽/动画完全可编辑,且可经「导出 DragonBones」往返。
 */

import { createProject, createAnimation } from './model.js';

// ---------------- LoongBones 文档 → DragonBones 5.5 ----------------

const R2 = (v) => Math.round((v || 0) * 100) / 100;
const RAD2DEG = 180 / Math.PI;

/** LoongBones 工程文档 → DB 骨架对象(与 scripts/loong2db.mjs 同构) */
export function loongDocToDbSke(doc) {
  const db = doc.runtime && doc.runtime.dragonbones;
  if (!db || !db.armatureMap) throw new Error('不是有效的 LoongBones 工程文档');
  const armatures = Object.values(db.armatureMap);
  const arm = armatures.reduce((a, b) => (Object.keys(b.bones.map).length > Object.keys(a.bones.map).length ? b : a));
  const boneById = arm.bones.map;
  const slotList = arm.slots.ids.map((id) => arm.slots.map[id]);
  const tf = (t) => ({
    x: R2(t.x), y: R2(t.y),
    skX: R2((t.skewX || 0) * RAD2DEG), skY: R2((t.skewY || 0) * RAD2DEG),
    scX: t.scaleX === undefined ? 1 : R2(t.scaleX), scY: t.scaleY === undefined ? 1 : R2(t.scaleY),
  });
  const bones = arm.bones.ids.map((id) => {
    const b = boneById[id];
    const parent = b.parentId ? (boneById[b.parentId] || {}).name : '';
    return { name: b.name, parent: parent || undefined, length: R2(b.length || 0), transform: tf(b.transform) };
  });
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
        name: d.name, path: d.name, type: 'image',
        transform: tf(d.transform),
        pivot: { x: d.pivot ? d.pivot[0] : 0.5, y: d.pivot ? d.pivot[1] : 0.5 },
      })),
    });
  }
  const framesToDb = (frames, frameMap, total, toVal) => {
    const out = [];
    frames.forEach((fid, i) => {
      const f = frameMap[fid];
      const next = i + 1 < frames.length ? frameMap[frames[i + 1]].frame : total;
      const o = { duration: Math.max(0, next - f.frame), ...toVal(f) };
      if (f.curve && f.curve[0] === 1) o.curve = 0;
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
        if (tl.type === 'translate') e.translateFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ x: R2(f.value.x), y: R2(f.value.y) }));
        else if (tl.type === 'rotate') e.rotateFrame = framesToDb(tl.frames, tl.frameMap, total, (f) => ({ rotate: R2(f.value.rotate) }));
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
      }
      if (Object.keys(e).length) slotArr.push({ name, ...e });
    }
    const defA = db.animationMap[arm.defaultAnimation];
    return {
      name: a.name, duration: total,
      playTimes: a.name === (defA && defA.name) ? -1 : 0,
      ...(boneArr.length ? { bone: boneArr } : {}),
      ...(slotArr.length ? { slot: slotArr } : {}),
    };
  }).filter(Boolean);
  return {
    version: '5.5', compatibleVersion: '5.5', frameRate: 30,
    name: arm.name || 'loong_project',
    armature: [{
      type: 'Armature', frameRate: 30, name: arm.name,
      bone: bones,
      slot: slots.map((s, i) => ({ name: s.name, parent: s.parent, z: i, attachment: s.attachment })),
      skin: [{ name: 'default', slot: skinSlots }],
      animation: animations,
      defaultActions: [{ gotoAndPlay: (db.animationMap[arm.defaultAnimation] || animations[0] || {}).name }],
    }],
  };
}

// ---------------- DragonBones 5.5 → 编辑器模型 ----------------

function hexToRgb(hex) {
  const s = String(hex || 'ffffffff').replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16) || 0,
    g: parseInt(s.slice(2, 4), 16) || 0,
    b: parseInt(s.slice(4, 6), 16) || 0,
    a: s.length >= 8 ? (parseInt(s.slice(6, 8), 16) || 0) / 255 : 1,
  };
}

/** DB 帧序列(duration 累计)→ 编辑器关键帧;curve 0/缺省=线性,数组=贝塞尔 */
function dbFramesToKeys(frames, total, toVal) {
  if (!frames || !frames.length) return null;
  const keys = [];
  let t = 0;
  for (const f of frames) {
    const ease = Array.isArray(f.curve)
      ? { type: 'bezier', pts: f.curve.map((v) => Math.round(v * 1000) / 1000) }
      : { type: 'linear' };
    keys.push({ frame: t, v: toVal(f), ease });
    t += f.duration || 0;
  }
  // 末帧补齐到总时长(保持终值)
  if (keys.length && keys[keys.length - 1].frame < total) {
    keys.push({ frame: total, v: { ...keys[keys.length - 1].v }, ease: { type: 'linear' } });
  }
  return keys;
}

/**
 * DragonBones 5.5 骨架 JSON → 编辑器工程(异步:需加载页图裁剪纹理区块)。
 * @param {object} ske DB 骨架 JSON(armature 数组)
 * @param {object} texJson DB 纹理图集 JSON(SubTexture)
 * @param {Array<{name,dataUrl}>} pages 页图(名称需与 texJson.imagePath 对应)
 */
export async function importDragonBonesProject(ske, texJson, pages) {
  const arm0 = ske.armature && ske.armature[0];
  if (!arm0 || !Array.isArray(arm0.bone)) throw new Error('不是有效的 DragonBones 骨架 JSON');
  const fps = ske.frameRate || arm0.frameRate || 30;

  // 纹理区块 → 裁剪图片(canvas 裁剪,frame 偏移还原 trim)
  const page = pages && pages[0];
  if (!page || !page.dataUrl) throw new Error('缺少纹理页图');
  const subByName = new Map((texJson.SubTexture || []).map((s) => [s.name, s]));
  const pageEl = await loadPageImage(page.dataUrl);
  const crop = (sub) => {
    const cv = document.createElement('canvas');
    const w = sub.frameWidth || sub.width, h = sub.frameHeight || sub.height;
    cv.width = Math.max(1, w); cv.height = Math.max(1, h);
    const g = cv.getContext('2d');
    g.drawImage(pageEl, sub.x, sub.y, sub.width, sub.height, -(sub.frameX || 0), -(sub.frameY || 0), sub.width, sub.height);
    return { url: cv.toDataURL('image/png'), w, h };
  };

  const p = createProject(ske.name || arm0.name || 'dragonbones工程');
  p.frameRate = fps;
  p.images = [];
  const imageBySub = new Map();

  // 骨骼
  p.armature.bones = arm0.bone.map((b) => {
    const t = b.transform || {};
    return {
      name: b.name, parent: b.parent || '',
      x: R2(t.x), y: R2(t.y), rotation: R2(t.skX || 0), length: R2(b.length || 40),
      scaleX: t.scX === undefined ? 1 : t.scX, scaleY: t.scY === undefined ? 1 : t.scY, skew: 0,
      inheritTranslation: true, inheritRotation: true, inheritScale: true,
    };
  });
  const boneNames = new Set(p.armature.bones.map((b) => b.name));

  // 皮肤显示(default 优先;DB 的 skin 位于 armature 内)
  const skins = Array.isArray(arm0.skin) ? arm0.skin : (arm0.skin ? [arm0.skin] : []);
  const skin = skins.find((s) => s.name === 'default') || skins[0] || { slot: [] };
  const dispBySlot = new Map();
  for (const s of skin.slot || []) dispBySlot.set(s.name, s.display || []);

  // 插槽(z 序 = json 顺序)
  p.armature.slots = (arm0.slot || []).map((s, idx) => {
    const color = s.color ? hexToRgb(s.color) : { r: 255, g: 255, b: 255, a: 1 };
    const displays = [];
    for (const d of dispBySlot.get(s.name) || []) {
      const sub = subByName.get(d.path || d.name);
      let imageId = '';
      if (sub && !imageBySub.has(sub.name)) {
        const c = crop(sub);
        const im = { id: 'img_' + String(sub.name).replace(/[^\w]/g, '_'), name: sub.name, w: c.w, h: c.h, dataUrl: c.url };
        p.images.push(im);
        imageBySub.set(sub.name, im.id);
      }
      if (sub) imageId = imageBySub.get(sub.name);
      const t = d.transform || {};
      displays.push({
        name: d.name,
        imageId,
        transform: { x: R2(t.x), y: R2(t.y), rotation: R2(t.skX || 0), scaleX: t.scX === undefined ? 1 : t.scX, scaleY: t.scY === undefined ? 1 : t.scY },
        pivot: { x: d.pivot ? d.pivot.x : 0.5, y: d.pivot ? d.pivot.y : 0.5 },
      });
    }
    const attachName = s.attachment;
    let di = 0;
    if (attachName) { const f = displays.findIndex((d) => d.name === attachName); if (f >= 0) di = f; }
    return { name: s.name, parent: boneNames.has(s.parent) ? s.parent : (p.armature.bones[0] ? p.armature.bones[0].name : ''), z: idx, displayIndex: di, color, displays };
  });

  // 动画
  p.armature.animations = (arm0.animation || []).map((a, i) => {
    const anim = createAnimation(a.name || ('animation' + (i + 1)), a.duration || 30);
    anim.bones = {};
    for (const bt of a.bone || []) {
      const e = {};
      const tr = dbFramesToKeys(bt.translateFrame, a.duration, (f) => ({ x: R2(f.x), y: R2(f.y) }));
      if (tr) e.translate = tr;
      const ro = dbFramesToKeys(bt.rotateFrame, a.duration, (f) => ({ rotation: R2(f.rotate) }));
      if (ro) e.rotate = ro;
      const sc = dbFramesToKeys(bt.scaleFrame, a.duration, (f) => ({ scaleX: f.x, scaleY: f.y }));
      if (sc) e.scale = sc;
      if (Object.keys(e).length) anim.bones[bt.name] = e;
    }
    anim.slots = {};
    for (const st of a.slot || []) {
      const e = {};
      if (st.displayFrame) {
        e.display = st.displayFrame.map((f, i2) => ({
          frame: st.displayFrame.slice(0, i2).reduce((s, x) => s + (x.duration || 0), 0),
          v: { displayIndex: typeof f.value === 'number' ? f.value : 0 },
          ease: { type: 'step' },
        }));
      }
      if (Object.keys(e).length) anim.slots[st.name] = e;
    }
    return anim;
  });

  return p;
}

/** 预加载页图元素(importDragonBonesProject 前调用) */
export function loadPageImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('页图解码失败'));
    el.src = dataUrl;
  });
}
