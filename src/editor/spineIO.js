/**
 * 骨骼动画编辑器 - Spine JSON 导入/导出(3.8 / 4.x,含 Pro 特性)。
 *
 * 原则:结构无损往返 —— 附件(网格/链接网格/裁剪)、约束(IK/变换/路径)、
 * 不编辑的时间线(deform/ik/transform/path/drawOrder/events)、骨骼/插槽未编辑字段
 * 全部以 raw 原文保留,导出时原样回写;编辑器只重建自己管理的部分
 * (骨骼变换/插槽颜色与默认附件/动画 bones+slots 关键帧)。
 *
 * 图片:atlas 页 PNG 整页内嵌(project.spine.pages),region 按需在渲染端
 * 用 canvas 裁剪(resolveRegionDataUrl),导出时整页原样写回。
 */

import { createProject, uniqueName, defaultEase } from './model.js';

// ---------------- atlas 解析 ----------------

/** 解析 libgdx/spine atlas 文本 → { pages:[{name,size,format,filter,repeat,pma}], regions: Map<name, region> }
 *  行法:页名(无缩进)→ 页属性(无缩进 k:v)→ 区块名(无缩进,后随缩进行)→ 缩进属性 */
export function parseAtlasText(text) {
  const pages = [];
  const regions = new Map();
  const lines = text.split(/\r?\n/);
  const n = lines.length;
  const ind = (ln) => /^[ \t]/.test(ln);
  const readKv = (ln) => { const idx = ln.indexOf(':'); return [ln.slice(0, idx).trim(), ln.slice(idx + 1).trim()]; };
  const nextNonEmpty = (from) => { let j = from; while (j < n && !lines[j].trim()) j++; return j; };
  let i = 0;
  while (true) {
    i = nextNonEmpty(i);
    if (i >= n) break;
    const pageName = lines[i++].trim();
    const page = { name: pageName, size: null, format: '', filter: '', repeat: '', pma: false };
    while (i < n) {
      const ln = lines[i];
      if (!ln.trim()) { i++; continue; }
      if (ind(ln) || !ln.includes(':')) break; // 缩进行或区块名 → 页属性结束
      const [k, v] = readKv(ln);
      if (k === 'size') page.size = v;
      else if (k === 'format') page.format = v;
      else if (k === 'filter') page.filter = v;
      else if (k === 'repeat') page.repeat = v;
      else if (k === 'pma') page.pma = v === '1' || v === 'true';
      i++;
    }
    pages.push(page);
    // 区块循环:无缩进行 + 下一非空行为缩进行 → 区块名;否则回到页循环(新页)
    while (i < n) {
      i = nextNonEmpty(i);
      if (i >= n) break;
      if (ind(lines[i])) { i++; continue; } // 容错:跳过孤立缩进行
      const after = nextNonEmpty(i + 1);
      if (after >= n || !ind(lines[after])) break; // 下一非空行不缩进 → 新页名
      const region = { name: lines[i].trim(), page: pageName, rotate: 0, index: -1 };
      i++;
      while (i < n && lines[i].trim() && ind(lines[i])) {
        const [k, v] = readKv(lines[i].trim());
        if (k === 'rotate') region.rotate = v === 'true' ? 90 : v === 'false' ? 0 : (parseInt(v, 10) || 0);
        else if (k === 'xy') { const p = v.split(','); region.x = +p[0]; region.y = +p[1]; }
        else if (k === 'size') { const p = v.split(','); region.w = +p[0]; region.h = +p[1]; }
        else if (k === 'orig') { const p = v.split(','); region.ow = +p[0]; region.oh = +p[1]; }
        else if (k === 'offset') { const p = v.split(','); region.ox = +p[0]; region.oy = +p[1]; }
        else if (k === 'index') region.index = parseInt(v, 10);
        i++;
      }
      regions.set(region.index >= 0 ? region.name + '_' + region.index : region.name, region);
    }
  }
  return { pages, regions };
}

/** 生成 atlas 文本(导出:仅替换 nameMap 中的页名行,跳过 region 名) */
export function serializeAtlas(atlasText, nameMap) {
  return atlasText.split(/\r?\n/).map((ln) => {
    const t = ln.trim();
    // 仅当行内容恰好是 nameMap 的 key(=导入时 parseAtlasText 识别的页名)时替换;
    // region 名(如 crosshair、eye-indifferent)不含冒号且不缩进,但不在 nameMap 中,
    // 盲目追加 _edit 会破坏 region 名导致运行时查不到贴图区块
    if (t && !ln.startsWith(' ') && !ln.startsWith('\t') && !t.includes(':') && nameMap.has(t)) {
      return nameMap.get(t);
    }
    return ln;
  }).join('\n');
}

// ---------------- 渲染端 region 裁剪 ----------------

const _pageImgCache = new Map(); // pageName+hash → HTMLImageElement
// 裁剪缓存必须按项目隔离:imageId = 'img_'+附件名,跨项目同名附件(head/front-foot…,
// spineboy 与 alien 大量重名)会串号 —— 先开 spineboy 再开 alien,后者资源库与舞台
// 全部命中前者的裁剪图。WeakMap 随项目对象回收,皮肤切换(同对象重建 images)仍可复用。
const _cropCache = new WeakMap(); // project → Map<imageId, dataUrl>

function getPageImg(dataUrl) {
  let el = _pageImgCache.get(dataUrl);
  if (el) return el.complete && el.naturalWidth ? el : null;
  el = new Image();
  _pageImgCache.set(dataUrl, el);
  el.src = dataUrl;
  return null;
}

/** region → 裁剪后的 dataUrl(处理 rotate 90 + trim offset);页图未就绪时返回 null */
export function resolveRegionDataUrl(project, image) {
  if (image.dataUrl) return image.dataUrl;
  let perProject = _cropCache.get(project);
  if (!perProject) { perProject = new Map(); _cropCache.set(project, perProject); }
  const hit = perProject.get(image.id);
  if (hit) return hit;
  const page = (project.spine?.pages || []).find((p) => p.name === image.spineRegion.page);
  if (!page) return null;
  const img = getPageImg(page.dataUrl);
  if (!img) return null;
  const url = cropRegionToDataUrl(img, image.spineRegion);
  perProject.set(image.id, url);
  return url;
}

/** 把图集区域(含 90/180/270 旋转与 trim 偏移)裁剪还原为独立 PNG 的 dataUrl(纹理解包器同源复用) */
export function cropRegionToDataUrl(img, r) {
  const W = r.ow || r.w, H = r.oh || r.h;   // 原始尺寸
  const ox = r.ox || 0, oy = r.oy || 0;     // trim 偏移(atlas 语义,spine y 上)
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, W); cv.height = Math.max(1, H);
  const g = cv.getContext('2d');
  g.save();
  // 目标:把图集块按原样转正放回原始图的 (ox, oy) 位置
  if (r.rotate === 90) {
    // 官方运行时实测(spine-core 3.8 RegionAttachment.setRegion):块(bx,by) → 原图(W-by, bx)
    // ⇒ rotate(+90°) 且 translate(W,0);此前误用 -90° 变换,旋转块整体上下颠倒
    g.translate(ox + W, oy);
    g.rotate(Math.PI / 2);
    g.drawImage(img, r.x, r.y, r.h, r.w, 0, 0, r.h, r.w);
  } else if (r.rotate === 270) {
    g.translate(ox, oy + H);
    g.rotate(-Math.PI / 2);
    g.drawImage(img, r.x, r.y, r.h, r.w, 0, 0, r.h, r.w);
  } else if (r.rotate === 180) {
    g.translate(ox + W, oy + H);
    g.rotate(Math.PI);
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  } else {
    // spine 的 offsetY 为 y 上语义:内容底边距原图底边 oy → 图像空间(y 下)顶部 = H - oy - h
    g.drawImage(img, r.x, r.y, r.w, r.h, ox, H - (r.oy || 0) - r.h, r.w, r.h);
  }
  g.restore();
  return cv.toDataURL('image/png');
}

// ---------------- 导入 ----------------

function curveToEase(curve, key) {
  if (!curve) return { type: 'linear' };
  if (curve === 'stepped') return { type: 'step' };
  if (Array.isArray(curve) && curve.length === 4) return { type: 'bezier', pts: curve.slice() };
  // 3.8.99+/4.x 分量式贝塞尔:curve=cx1, c2=cy1(默认0), c3=cx2(默认1), c4=cy2(默认1)
  // (与 spine-ts SkeletonJson 官方解析一致)
  if (typeof curve === 'number' && isFinite(curve)) {
    return { type: 'bezier', pts: [curve, key?.c2 ?? 0, key?.c3 ?? 1, key?.c4 ?? 1] };
  }
  return { type: 'linear' };
}
function easeToCurve(ease) {
  if (!ease || ease.type === 'linear') return undefined;
  if (ease.type === 'step') return 'stepped';
  if (ease.type === 'bezier' && ease.pts) return ease.pts.map((v) => Math.round(v * 1000) / 1000);
  const map = {
    sineIn: [0.12, 0, 0.39, 0], sineOut: [0.61, 1, 0.88, 1], sineInOut: [0.37, 0, 0.63, 1],
    quadIn: [0.11, 0, 0.5, 0], quadOut: [0.5, 1, 0.89, 1], quadInOut: [0.45, 0, 0.55, 1],
    cubicIn: [0.32, 0, 0.67, 0], cubicOut: [0.33, 1, 0.68, 1], cubicInOut: [0.65, 0, 0.35, 1],
    backIn: [0.36, 0, 0.66, -0.56], backOut: [0.34, 1.56, 0.64, 1],
  };
  return map[ease.type];
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
const easeOf = (k) => k.ease && k.ease.type ? k.ease : curveToEase(k.curve, k);

/**
 * Spine JSON → 编辑器工程。
 * @param {object} json Spine 骨架 JSON(3.8 或 4.x)
 * @param {object} spine { atlasText, pages: [{name, dataUrl}] }
 */
export function importSpineProject(json, { atlasText, pages, base }) {
  if (!json || !json.skeleton || !Array.isArray(json.bones)) throw new Error('不是有效的 Spine 骨架 JSON');
  const version = String(json.skeleton.spine || '');
  const family = version.startsWith('4') ? '4' : '3';
  const atlas = atlasText ? parseAtlasText(atlasText) : { pages: [], regions: new Map() };

  // skins 归一:3.8 对象 / 4.x 数组 → [{name, attachments}]
  const skinsRaw = Array.isArray(json.skins)
    ? json.skins.map((s) => ({ name: s.name, attachments: s.attachments }))
    : Object.entries(json.skins || {}).map(([name, att]) => ({ name, attachments: att }));
  if (!skinsRaw.length) throw new Error('JSON 中没有皮肤数据');
  // 默认皮肤:优先第一套非 default 皮肤(default 为共享附件的基础皮肤,单独显示只有零散
  // 附件;goblins 应直接显示 goblin 全身)——与层级树皮肤节点的切换范围一致
  const skin = skinsRaw.find((s) => s.name !== 'default') || skinsRaw.find((s) => s.name === 'default') || skinsRaw[0];

  const p = createProject(json.skeleton.hash ? String(json.skeleton.hash).slice(0, 12) : 'spine项目');
  p.name = 'spine_' + (skin.name === 'default' ? 'project' : skin.name);
  // 骨架名:层级树根节点显示用。运行时 JSON 不含 skeleton.name,取文件基名(与 Spine
  // 编辑器树根显示工程文件名一致),其次 hash,最后落回项目名
  p.armature.name = String(base || json.skeleton.name || json.skeleton.hash || p.name).slice(0, 48);
  // default 皮肤(共享附件:武器等两套皮肤公用的部件)—— 激活皮肤未覆盖的插槽回退用它
  const fallbackSkin = skin.name === 'default' ? null : (skinsRaw.find((s) => s.name === 'default') || null);
  p.frameRate = 30;
  p.spine = {
    version,
    family,
    raw: json,                 // 原始 JSON(导出回写的依据)
    atlasText: atlasText || '',
    pages: pages || [],
    skin: skin.name,           // 导入的皮肤
    regionNames: [...atlas.regions.keys()],
  };

  // ---- 骨骼 ----
  p.armature.bones = json.bones.map((b) => ({
    name: b.name, parent: b.parent || '',
    x: b.x || 0, y: b.y || 0, rotation: b.rotation || 0, length: b.length || 0,
    scaleX: b.scaleX === undefined ? 1 : b.scaleX, scaleY: b.scaleY === undefined ? 1 : b.scaleY, skew: 0,
    inheritTranslation: true, inheritRotation: b.inheritRotation === undefined ? true : !!b.inheritRotation,
    inheritScale: b.inheritScale === undefined ? true : !!b.inheritScale,
    // 工程数据骨骼色(Spine color 属性,RRGGBB(AA) hex):入模型字段持久化,层级树/舞台/图标共用;
    // 无 color 的骨骼按 Spine 编辑器默认色 #9b9b9b 显示(如 exhaust1/portal 系列)
    color: typeof b.color === 'string' && /^[0-9a-fA-F]{6,8}$/.test(b.color) ? '#' + b.color.slice(0, 6) : '#9b9b9b',
    raw: b,
  }));

  // ---- 附件 → region 图片 + 显示对象 ----
  const images = [];
  const dispBySlot = new Map(); // slotName → displays[]
  const ensureImage = (attName, att) => {
    // 区块路径解析与官方运行时一致:att.path → att.name(goblin 等皮肤附件的 name 即
    // 图片路径 "goblin/head",key 只是插槽内条目名)→ 附件条目名。漏了 name 兜底时
    // 非 default 皮肤的网格区块全部查不到 → 舞台图片全不渲染
    const pathName = att.path || att.name || attName;
    const region = atlas.regions.get(pathName);
    const imgId = 'img_' + pathName.replace(/[^\w]/g, '_');
    let im = images.find((x) => x.name === pathName);
    if (!im && region) {
      im = { id: imgId, name: pathName, w: region.ow || region.w, h: region.oh || region.h, dataUrl: '', spineRegion: region };
      images.push(im);
    }
    return im || null;
  };
  for (const [slotName, atts] of Object.entries(skin.attachments || {})) {
    const list = [];
    for (const [attName, att] of Object.entries(atts || {})) {
      const disp = { name: attName, imageId: '', transform: { x: att.x || 0, y: att.y || 0, rotation: att.rotation || 0, scaleX: att.scaleX === undefined ? 1 : att.scaleX, scaleY: att.scaleY === undefined ? 1 : att.scaleY }, pivot: { x: 0.5, y: 0.5 }, raw: att };
      if (att.linkedMesh) {
        // 链接网格:几何来自源附件,图片用源的 path
        const src = findLinkedSource(skin.attachments, slotName, attName, att);
        disp.linkedTo = src ? src.name : null;
        if (src) { const im = ensureImage(src.attName, src.att); if (im) disp.imageId = im.id; }
      } else {
        const im = ensureImage(attName, att);
        if (im) disp.imageId = im.id;
      }
      list.push(disp);
    }
    dispBySlot.set(slotName, list);
  }
  // Spine 皮肤语义:default 皮肤为共享回退 —— 激活皮肤未覆盖的插槽使用 default 的附件
  // (goblins:goblin 皮肤不含武器槽,dagger/spear/shield 来自 default,Spine 中武器常驻显示)
  if (fallbackSkin) {
    for (const [slotName, atts] of Object.entries(fallbackSkin.attachments || {})) {
      if (dispBySlot.has(slotName)) continue;
      const list = [];
      for (const [attName, att] of Object.entries(atts || {})) {
        const disp = { name: attName, imageId: '', transform: { x: att.x || 0, y: att.y || 0, rotation: att.rotation || 0, scaleX: att.scaleX === undefined ? 1 : att.scaleX, scaleY: att.scaleY === undefined ? 1 : att.scaleY }, pivot: { x: 0.5, y: 0.5 }, raw: att, shared: true };
        if (att.linkedMesh) {
          const src = findLinkedSource(fallbackSkin.attachments, slotName, attName, att);
          disp.linkedTo = src ? src.name : null;
          if (src) { const im = ensureImage(src.attName, src.att); if (im) disp.imageId = im.id; }
        } else {
          const im = ensureImage(attName, att);
          if (im) disp.imageId = im.id;
        }
        list.push(disp);
      }
      dispBySlot.set(slotName, list);
    }
  }
  p.images = images;

  // ---- 插槽(z = json 顺序)----
  p.armature.slots = json.slots.map((s, idx) => {
    const dispList = dispBySlot.get(s.name) || [];
    // setup 无附件(spine 槽定义缺 attachment 字段)-> 隐藏(displayIndex=-1),
    // 此前默认 0 会让 muzzle 这类"仅动画中显示"的槽在所有无键动画里常驻显示
    let di = -1;
    if (s.attachment) { const f = dispList.findIndex((d) => d.name === s.attachment); if (f >= 0) di = f; }
    const c = s.color ? parseSpineColor(s.color) : { r: 255, g: 255, b: 255, a: 1 };
    return { name: s.name, parent: s.bone, z: idx, displayIndex: di, color: c, displays: dispList, raw: s };
  });

  // ---- 动画 ----
  const fps = p.frameRate;
  p.armature.animations = Object.entries(json.animations || {}).map(([name, a]) => {
    const bones = {};
    for (const [bn, ch] of Object.entries(a.bones || {})) {
      const e = {};
      if (ch.rotate?.length) e.rotate = ch.rotate.map((k) => ({ frame: Math.round((k.time || 0) * fps), v: { rotation: k.angle ?? k.rotate ?? 0 }, ease: easeOf(k) }));
      if (ch.translate?.length) e.translate = ch.translate.map((k) => ({ frame: Math.round((k.time || 0) * fps), v: { x: k.x || 0, y: k.y || 0 }, ease: easeOf(k) }));
      if (ch.scale?.length) e.scale = ch.scale.map((k) => ({ frame: Math.round((k.time || 0) * fps), v: { scaleX: k.x ?? 1, scaleY: k.y ?? 1 }, ease: easeOf(k) }));
      if (Object.keys(e).length) bones[bn] = e;
    }
    const slots = {};
    for (const [sn, ch] of Object.entries(a.slots || {})) {
      const e = {};
      if (ch.color?.length) e.color = ch.color.map((k) => ({ frame: Math.round((k.time || 0) * fps), v: parseSpineColor(k.color), ease: easeOf(k) }));
      if (ch.attachment?.length) e.display = ch.attachment.map((k) => {
        const slot = p.armature.slots.find((s) => s.name === sn);
        const dispList = slot ? slot.displays : [];
        const f = dispList.findIndex((d) => d.name === k.name);
        return { frame: Math.round((k.time || 0) * fps), v: { displayIndex: k.name ? (f >= 0 ? f : 0) : -1 }, ease: { type: 'step' } };
      });
      if (Object.keys(e).length) slots[sn] = e;
    }
    // 保留不编辑的时间线
    const rawKeep = {};
    for (const key of ['deform', 'ik', 'transform', 'path', 'drawOrder', 'events', 'sequence']) if (a[key]) rawKeep[key] = a[key];
    // 时长:所有时间线(含 rawKeep)最大时间 —— aim 等动画的运动主体在 ik/deform 时间线里,漏扫会得到 1 帧
    let maxT = 0;
    const scan = (v) => {
      if (Array.isArray(v)) {
        for (const k of v) if (k && typeof k === 'object') { if (typeof k.time === 'number') maxT = Math.max(maxT, k.time); scan(Object.values(k)); }
        return;
      }
      if (v && typeof v === 'object') for (const x of Object.values(v)) scan(x);
    };
    scan(a.bones); scan(a.slots); scan(rawKeep);
    return { name, duration: Math.max(1, Math.round(maxT * fps)), loop: true, bones, slots, rawKeep };
  });
  return p;
}

function findLinkedSource(attachments, fromSlot, name, att) {
  // linkedMesh.parent = 源附件名;源可能在同一皮肤其它插槽下
  const parentName = att.linkedMesh.parent;
  for (const [sn, atts] of Object.entries(attachments || {})) {
    for (const [an, a] of Object.entries(atts || {})) {
      if (an === parentName && !(sn === fromSlot && an === name)) return { attName: an, att: a, name: an };
    }
  }
  return null;
}

function parseSpineColor(hex) {
  const s = String(hex || 'FFFFFFFF');
  return {
    r: parseInt(s.slice(0, 2), 16) || 0,
    g: parseInt(s.slice(2, 4), 16) || 0,
    b: parseInt(s.slice(4, 6), 16) || 0,
    a: s.length >= 8 ? (parseInt(s.slice(6, 8), 16) || 0) / 255 : 1,
  };
}

/** Spine 导入项目的皮肤列表归一:raw.skins(3.8 对象 / 4.x 数组)→ [{name, attachments}] */
export function spineSkinsOf(p) {
  const raw = p && p.spine && p.spine.raw;
  if (!raw || !raw.skins) return [];
  return Array.isArray(raw.skins)
    ? raw.skins.map((s) => ({ name: s.name, attachments: s.attachments || {} }))
    : Object.entries(raw.skins).map(([name, att]) => ({ name, attachments: att || {} }));
}

/**
 * 切换 Spine 导入项目的当前皮肤:按新皮肤重建图片表与各插槽的显示列表
 * (附件名与官方运行时皮肤对齐,舞台 RT 侧由调用方同步 skin 引用)。
 * @returns {boolean} 皮肤存在并切换成功
 */
export function switchSpineSkin(p, skinName) {
  const skins = spineSkinsOf(p);
  const skin = skins.find((s) => s.name === skinName);
  if (!p || !p.spine || !p.spine.raw || !skin) return false;
  const atlas = p.spine.atlasText ? parseAtlasText(p.spine.atlasText) : { pages: [], regions: new Map() };
  // .spine 工程导入(无 atlas):图片来自导入时的源图(p.images),种子保留避免切换后图片全丢
  const images = (p.spine.project || !p.spine.atlasText) ? [...(p.images || [])] : [];
  const dispBySlot = new Map(); // slotName → displays[]
  const ensureImage = (attName, att) => {
    // 区块路径解析与官方运行时一致:att.path → att.name(goblin 等皮肤附件的 name 即
    // 图片路径 "goblin/head",key 只是插槽内条目名)→ 附件条目名。此前漏了 name 兜底,
    // 非 default 皮肤的网格区块全部查不到 → 舞台图片全不渲染
    const pathName = att.path || att.name || attName;
    const region = atlas.regions.get(pathName);
    let im = images.find((x) => x.name === pathName);
    if (!im && region) {
      im = { id: 'img_' + pathName.replace(/[^\w]/g, '_'), name: pathName, w: region.ow || region.w, h: region.oh || region.h, dataUrl: '', spineRegion: region };
      images.push(im);
    }
    if (!im && !region) {
      // 源图工程兜底:按基名对齐,唯一命中才采用(多皮肤同名基名并存时精确名为准,
      // 如 goblingirl/left-upper-leg 与 goblin/left-upper-leg 不可互相顶替)
      const base = String(pathName).replace(/^.*\//, '');
      const cands = images.filter((x) => String(x.name).replace(/^.*\//, '') === base);
      if (cands.length === 1) im = cands[0];
    }
    return im || null;
  };
  for (const [slotName, atts] of Object.entries(skin.attachments || {})) {
    const list = [];
    for (const [attName, att] of Object.entries(atts || {})) {
      const disp = { name: attName, imageId: '', transform: { x: att.x || 0, y: att.y || 0, rotation: att.rotation || 0, scaleX: att.scaleX === undefined ? 1 : att.scaleX, scaleY: att.scaleY === undefined ? 1 : att.scaleY }, pivot: { x: 0.5, y: 0.5 }, raw: att };
      if (att.linkedMesh) {
        const src = findLinkedSource(skin.attachments, slotName, attName, att);
        disp.linkedTo = src ? src.name : null;
        if (src) { const im = ensureImage(src.attName, src.att); if (im) disp.imageId = im.id; }
      } else {
        const im = ensureImage(attName, att);
        if (im) disp.imageId = im.id;
      }
      list.push(disp);
    }
    dispBySlot.set(slotName, list);
  }
  // default 皮肤回退:激活皮肤未覆盖的插槽沿用 default 附件(Spine 皮肤语义,武器常驻)
  {
    const fb = skins.find((s) => s.name === 'default');
    if (fb && fb !== skin) {
      for (const [slotName, atts] of Object.entries(fb.attachments || {})) {
        if (dispBySlot.has(slotName)) continue;
        const list = [];
        for (const [attName, att] of Object.entries(atts || {})) {
          const disp = { name: attName, imageId: '', transform: { x: att.x || 0, y: att.y || 0, rotation: att.rotation || 0, scaleX: att.scaleX === undefined ? 1 : att.scaleX, scaleY: att.scaleY === undefined ? 1 : att.scaleY }, pivot: { x: 0.5, y: 0.5 }, raw: att, shared: true };
          if (att.linkedMesh) {
            const src = findLinkedSource(fb.attachments, slotName, attName, att);
            disp.linkedTo = src ? src.name : null;
            if (src) { const im = ensureImage(src.attName, src.att); if (im) disp.imageId = im.id; }
          } else {
            const im = ensureImage(attName, att);
            if (im) disp.imageId = im.id;
          }
          list.push(disp);
        }
        dispBySlot.set(slotName, list);
      }
    }
  }
  p.images = images;
  for (const s of p.armature.slots) {
    const list = dispBySlot.get(s.name) || [];
    s.displays = list;
    // 显示索引重算:setup attachment(raw.attachment)在新列表中的位置,找不到 → 隐藏;
    // .spine 工程导入的 setup 附件引用未解析 → 有附件的槽默认显示首个(与导入时一致)
    let di = -1;
    if (s.raw && s.raw.attachment) { const f = list.findIndex((d) => d.name === s.raw.attachment); if (f >= 0) di = f; }
    if (di < 0 && p.spine.project && list.length) di = 0;
    s.displayIndex = di;
  }
  p.spine.skin = skin.name;
  p.spine.regionNames = atlas.regions.size ? [...atlas.regions.keys()] : (p.spine.regionNames || []);
  return true;
}

// ---------------- Spine 编辑器工程(.spine 解码数据)导入 ----------------

/**
 * Spine 工程解码 JSON(spineProjectToJson 逆向产物,与运行时 JSON 结构不同)-> 编辑器项目。
 *
 * 解码数据可靠性(逆向所得,与运行时 JSON 的差异):
 * - 骨骼:名称/父引用已完整解析,变换为 setup 姿势 -> 全量导入可编辑;
 * - 插槽:名称/所属骨骼/颜色已解析;setup 附件为未解析引用 -> displayIndex 取首个附件;
 * - 附件:region 类型(位名 x/y/rotation/scale/width/height)完整;名称部分为 #ref 未解析;
 *   归属插槽靠 slot_hint;mesh/边界框仅作显示对象占位(无贴图);
 * - 皮肤:decoded.skins(运行时 JSON 数组形态,goblins 官方导出逐值核对)→ raw.skins +
 *   按激活皮肤(首套非 default)+ default 回退构建显示列表,switchSpineSkin 可用;
 *   图片按附件 path(皮肤目录前缀)对齐源图目录,导入时预注册全部皮肤的图片;
 * - 动画:仅骨骼 rotate/translate 时间线已可靠识别(分类为启发式,scale 会并入 translate);
 *   attachment/event 时间线的引用未解析 -> 跳过;
 * - 图片:工程引用源图目录(skeleton.images),按 region 附件名同名查找(找不到则无贴图)。
 * @param {object} decoded spineProjectToJson 解码 JSON
 * @param {object} opts { srcPath: .spine 路径, imageFiles: [{name, dataUrl, w, h}] 源图 }
 */
export function importSpineEditorProject(decoded, opts = {}) {
  if (!decoded || !Array.isArray(decoded.bones) || !decoded.bones.length) throw new Error('不是有效的 Spine 工程解码数据(无骨骼区)');
  const version = String((decoded.skeleton && decoded.skeleton.spine) || '');
  const base = (opts.srcPath || '').replace(/^.*[\\/]/, '').replace(/\.spine$/i, '') || 'spine_project';
  const p = createProject(base);
  p.armature.name = base; // 层级树根节点显示工程文件名(与 Spine 编辑器一致)
  p.frameRate = 30;
  p.spine = {
    version,
    family: version.startsWith('4') ? '4' : '3',
    project: true,                 // 来源 = Spine 编辑器工程文件(非运行时 JSON;导出走 .lbone.json 保存)
    srcPath: opts.srcPath || '',
    imagesDir: (decoded.skeleton && decoded.skeleton.images) || '',
    raw: decoded,                  // 解码数据原样保留(未识别区段的参考与二次编辑依据)
    atlasText: '',
    pages: [],
    skin: 'default',
    regionNames: [],
  };

  // ---- 骨骼(解码已完整解析父引用;04-09 组为编辑器姿态,0a-0e 组已归一为 setup) ----
  p.armature.bones = decoded.bones.map((b) => ({
    name: b.name, parent: b.parent || '',
    x: b.x || 0, y: b.y || 0, rotation: b.rotation || 0, length: b.length || 0,
    scaleX: b.scaleX === undefined ? 1 : b.scaleX, scaleY: b.scaleY === undefined ? 1 : b.scaleY, skew: 0,
    inheritTranslation: true, inheritRotation: true, inheritScale: true,
    raw: b,
  }));

  // ---- 附件 -> 源图图片 + 各插槽显示对象(slot_hint 归属) ----
  const imageFiles = opts.imageFiles || [];
  const images = [];
  const dispBySlot = new Map();
  const ensureImage = (name) => {
    if (!name || String(name).startsWith('#ref')) return null;
    let im = images.find((x) => x.name === name);
    if (!im) {
      // 精确匹配(Spine 附件路径 "goblin/head" ↔ 源图相对路径 goblin/head)优先;
      // 基名兜底:源图目录结构不同(顶层 head.png)或附件名无路径前缀时仍可对上
      const base = String(name).replace(/^.*\//, '');
      const f = imageFiles.find((x) => x.name === name) || imageFiles.find((x) => x.name.replace(/^.*\//, '') === base);
      im = { id: 'img_' + String(name).replace(/[^\w]/g, '_'), name, w: (f && f.w) || 0, h: (f && f.h) || 0, dataUrl: (f && f.dataUrl) || '' };
      images.push(im);
    }
    return im;
  };
  const mkDisp = (a) => {
    const disp = {
      name: a.name || ('#ref' + (a.name_ref ?? '?')),
      imageId: '',
      transform: { x: a.x || 0, y: a.y || 0, rotation: a.rotation || 0, scaleX: a.scaleX === undefined ? 1 : a.scaleX, scaleY: a.scaleY === undefined ? 1 : a.scaleY },
      pivot: { x: 0.5, y: 0.5 },
      raw: a,
    };
    // region / mesh(+linkedmesh)附件挂源图:Spine 工程源图按皮肤分目录(images/goblin/
    // 等),附件路径 "goblin/head" 即源图相对路径;mesh 在编辑器中以源图矩形近似显示(无网格变形)。
    // 图片键 = path(皮肤目录前缀)优先,无 path 时 name 本身即路径(goblingirl 条目)
    if (a.type === 'region' || a.type === 'mesh' || a.type === 'linkedmesh') {
      const im = ensureImage(a.path || a.name);
      if (im) disp.imageId = im.id;
    }
    return disp;
  };
  // 皮肤区段(spineProjectToJson 解码):有 skins 时按运行时语义构建 —— 激活皮肤 = 首套
  // 非 default 皮肤,未覆盖插槽回退 default(goblins:goblingirl 全身 + default 武器);
  // 无 skins(老版解码/单皮肤)沿用扁平 attachments + slot_hint 归属
  const skinsDec = Array.isArray(decoded.skins) && decoded.skins.length ? decoded.skins : null;
  if (skinsDec) {
    p.spine.raw.skins = skinsDec; // spineSkinsOf/switchSpineSkin 兼容(运行时 JSON 数组形态)
    const act = skinsDec.find((s) => s.name !== 'default') || skinsDec[0];
    const fb = act.name !== 'default' ? (skinsDec.find((s) => s.name === 'default') || null) : null;
    p.spine.skin = act.name;
    // 预注册全部皮肤的图片名:切换皮肤时 switchSpineSkin 直接按名复用,不会因未注册而丢图
    for (const sk of skinsDec) for (const entries of Object.values(sk.attachments || {})) {
      for (const a of Object.values(entries || {})) {
        if (a.type === 'region' || a.type === 'mesh' || a.type === 'linkedmesh') ensureImage(a.path || a.name);
      }
    }
    for (const [slotName, entries] of Object.entries(act.attachments || {})) {
      dispBySlot.set(slotName, Object.values(entries || {}).map(mkDisp));
    }
    if (fb) {
      for (const [slotName, entries] of Object.entries(fb.attachments || {})) {
        if (dispBySlot.has(slotName)) continue;
        dispBySlot.set(slotName, Object.values(entries || {}).map(mkDisp));
      }
    }
  } else {
    for (const a of decoded.attachments || []) {
      const slotName = a.slot_hint || '';
      const list = dispBySlot.get(slotName) || [];
      list.push(mkDisp(a));
      dispBySlot.set(slotName, list);
    }
  }
  p.images = images;
  p.spine.regionNames = images.map((i) => i.name);

  // ---- 插槽(setup 附件引用未解析:有附件的槽默认显示首个,无附件隐藏) ----
  p.armature.slots = (decoded.slots || []).map((s, idx) => {
    const dispList = dispBySlot.get(s.name) || [];
    const c = s.color ? parseSpineColor(s.color) : { r: 255, g: 255, b: 255, a: 1 };
    return { name: s.name, parent: s.bone, z: idx, displayIndex: dispList.length ? 0 : -1, color: c, displays: dispList, raw: s };
  });

  // ---- 动画:rotate / translate / scale 时间线;attachment/event 引用未解析跳过 ----
  // 时间上限(秒):超过视为解码重同步噪声丢弃 —— 逆向解码是启发式的,偶发把浮点数据误读为
  // 关键帧(spineboy-pro 实测:合法键 ≤5s,杂散键可达 1e21),不滤会得到天文数字的动画时长
  const MAX_KEY_TIME = 600;
  const fps = p.frameRate;
  p.armature.animations = Object.entries(decoded.animations || {}).map(([name, a]) => {
    const bones = {};
    let maxT = 0;
    for (const tl of (a && a.timelines) || []) {
      if (!tl || !tl.target || !Array.isArray(tl.keys) || !tl.keys.length) continue;
      const isTrans = tl.kind === 'translate';
      const isRot = tl.kind === 'rotate';
      const isScale = tl.kind === 'scale';
      if (!isTrans && !isRot && !isScale) continue;
      const store = bones[tl.target] || (bones[tl.target] = {});
      const ch = isTrans ? 'translate' : isRot ? 'rotate' : 'scale';
      const arr = store[ch] || (store[ch] = []);
      for (const k of tl.keys) {
        const t = k.time;
        if (!(t >= 0 && t <= MAX_KEY_TIME)) continue; // NaN/负值/超长 -> 杂散记录,丢键
        maxT = Math.max(maxT, t);
        const ease = Array.isArray(k.curve) && k.curve.length === 4 ? { type: 'bezier', pts: k.curve.slice() } : { type: 'linear' };
        arr.push(isTrans
          ? { frame: Math.round(t * fps), v: { x: k.value || 0, y: k.value2 || 0 }, ease }
          : isScale
          ? { frame: Math.round(t * fps), v: { scaleX: k.value ?? 1, scaleY: k.value2 ?? 1 }, ease }
          : { frame: Math.round(t * fps), v: { rotation: k.value || 0 }, ease });
      }
      // 全部键被过滤 -> 收回空通道/空骨骼轨,不留 0 键时间线
      if (!arr.length) {
        delete store[ch];
        if (!Object.keys(store).length) delete bones[tl.target];
        continue;
      }
      arr.sort((x, y) => x.frame - y.frame);
    }
    return { name, duration: Math.max(1, Math.round(maxT * fps)), loop: true, bones, slots: {} };
  });
  if (!p.armature.animations.length) p.armature.animations.push({ name: 'new_animation', duration: 30, loop: true, bones: {}, slots: {} });
  return p;
}

// ---------------- 导出 ----------------

/** 编辑器工程 → Spine JSON 文本(结构按导入版本家族回写) */
export function exportSpineProject(p) {
  const sp = p.spine;
  if (!sp) throw new Error('当前项目不是 Spine 导入项目');
  const raw = sp.raw;
  const fps = p.frameRate || 30;
  const out = {};

  // 元信息与不编辑的区块原样保留
  out.skeleton = { ...raw.skeleton };
  for (const key of ['ik', 'transform', 'path', 'events', 'strings']) if (raw[key] !== undefined) out[key] = raw[key];

  // 骨骼:raw ∪ 编辑值
  out.bones = p.armature.bones.map((b) => ({
    ...(b.raw || {}),
    name: b.name, parent: b.parent || undefined,
    x: b.x, y: b.y, rotation: b.rotation,
    scaleX: b.scaleX, scaleY: b.scaleY,
  }));

  // 插槽:raw ∪ 颜色/默认附件;z 序 = 编辑器层级
  const ordered = [...p.armature.slots].sort((a, b) => a.z - b.z);
  out.slots = ordered.map((s) => {
    const o = { ...(s.raw || {}), name: s.name, bone: s.parent };
    o.color = hex2(s.color.r) + hex2(s.color.g) + hex2(s.color.b) + hex2((s.color.a ?? 1) * 255);
    const disp = s.displays[s.displayIndex];
    o.attachment = disp ? disp.name : undefined;
    return o;
  });

  // 皮肤:未编辑 → 原样
  out.skins = raw.skins;

  // 动画:重建 bones/slots 时间线,其余原样
  out.animations = {};
  for (const anim of p.armature.animations) {
    const a = {};
    const boneTl = {};
    for (const [bn, ch] of Object.entries(anim.bones || {})) {
      const o = {};
      if (ch.translate?.length) o.translate = ch.translate.map((k) => ({ time: r4(k.frame / fps), x: k.v.x, y: k.v.y, ...curveOf(k) }));
      if (ch.rotate?.length) o.rotate = ch.rotate.map((k) => ({ time: r4(k.frame / fps), angle: k.v.rotation, ...curveOf(k) }));
      if (ch.scale?.length) o.scale = ch.scale.map((k) => ({ time: r4(k.frame / fps), x: k.v.scaleX, y: k.v.scaleY, ...curveOf(k) }));
      if (Object.keys(o).length) boneTl[bn] = o;
    }
    if (Object.keys(boneTl).length) a.bones = boneTl;
    const slotTl = {};
    for (const [sn, ch] of Object.entries(anim.slots || {})) {
      const o = {};
      if (ch.color?.length) o.color = ch.color.map((k) => ({ time: r4(k.frame / fps), color: hex2(k.v.r) + hex2(k.v.g) + hex2(k.v.b) + hex2((k.v.a ?? 1) * 255), ...curveOf(k) }));
      if (ch.display?.length) {
        const slot = p.armature.slots.find((s) => s.name === sn);
        o.attachment = ch.display.map((k) => {
          const disp = slot && k.v.displayIndex >= 0 ? slot.displays[k.v.displayIndex] : null;
          return { time: r4(k.frame / fps), name: disp ? disp.name : null };
        });
      }
      if (Object.keys(o).length) slotTl[sn] = o;
    }
    if (Object.keys(slotTl).length) a.slots = slotTl;
    for (const [key, v] of Object.entries(anim.rawKeep || {})) a[key] = v;
    // 合并动画级 raw 中没有对应编辑时间线的遗留(导入时全部放进 rawKeep,此处已覆盖)
    out.animations[anim.name] = a;
  }
  return { json: JSON.stringify(out, null, 1), version: sp.version };
}

/** key ease -> Spine JSON curve 字段(3.x 组件格式:curve=cx1 单数字,c2/c3/c4 非默认时单独输出) */
function curveOf(key) {
  const ease = key.ease;
  if (!ease || ease.type === 'linear') return {};
  if (ease.type === 'step') return { curve: 'stepped' };
  const pts = ease.type === 'bezier' && ease.pts ? ease.pts : easeToCurve(ease);
  if (!pts || !Array.isArray(pts)) return {};
  const [c1, c2, c3, c4] = pts;
  const o = { curve: r4(c1) };
  if (c2 !== undefined && Math.abs(c2) > 1e-6) o.c2 = r4(c2);
  if (c3 !== undefined && Math.abs(c3 - 1) > 1e-6) o.c3 = r4(c3);
  if (c4 !== undefined && Math.abs(c4 - 1) > 1e-6) o.c4 = r4(c4);
  return o;
}
const r4 = (v) => Math.round(v * 10000) / 10000;

/** 导出文件集:<base>.json + <base>.atlas + 页 PNG(使用 base 命名保持一致) */
export async function exportSpineFiles(p) {
  const sp = p.spine;
  const { json } = exportSpineProject(p);
  const dirR = await window.api.pickDirs({ title: '选择 Spine 导出目录' });
  const dir = (!dirR || dirR.canceled) ? null : (dirR.filePaths || [])[0];
  if (!dir) return null;
  const base = (p.name || 'spine_project').replace(/[\\/:*?"<>|]/g, '_');
  const writeText = (fp, text) => window.api.writeFileBase64(fp, 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(text))));
  await writeText(dir + '\\' + base + '.json', json);
  const files = [base + '.json'];
  if (sp.atlasText) {
    // 页图使用 base 命名,与 .json/.atlas 保持一致
    const nameMap = new Map();
    const pages = sp.pages || [];
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      const ext = pg.name.match(/\.[^.]+$/)?.[0] || '.png';
      const newN = i === 0 ? base + ext : base + '_' + i + ext;
      nameMap.set(pg.name, newN);
      await window.api.writeFileBase64(dir + '\\' + newN, pg.dataUrl);
      files.push(newN);
    }
    await writeText(dir + '\\' + base + '.atlas', serializeAtlas(sp.atlasText, nameMap));
    files.push(base + '.atlas');
  }
  return { dir, files };
}

// ---------------- 通用 Spine JSON 导出(任意项目类型) ----------------

// ---- 解码数据清理:去除非 Spine 标准字段(f07_raw/inheritFlags_raw/slot_hint 等) ----
const _BONE_KEEP = new Set(['name', 'parent', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'length', 'transform', 'color', 'skin', 'visible']);
const _SLOT_KEEP = new Set(['name', 'bone', 'color', 'dark', 'darkColor', 'attachment', 'blend', 'visible']);
const _ATT_REGION_KEEP = new Set(['type', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'width', 'height', 'path']);
const _ATT_MESH_KEEP = new Set(['type', 'uvs', 'triangles', 'vertices', 'hull', 'edges', 'width', 'height', 'path', 'color']);
const _ATT_OTHER_KEEP = new Set(['type', 'vertexCount', 'vertices', 'color', 'end', 'lengths', 'closed']);
function _cleanObj(obj, keep) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of keep) { if (obj[k] !== undefined) out[k] = obj[k]; }
  return out;
}
function _cleanBone(raw) { return _cleanObj(raw, _BONE_KEEP); }
function _cleanSlot(raw) { return _cleanObj(raw, _SLOT_KEEP); }
function _cleanAtt(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  // 规范化解码器启发式类型标签
  let type = raw.type || 'region';
  if (type === 'clipping?') type = 'clipping';
  if (type.startsWith('type')) type = 'region'; // 未知类型降级为 region
  const base = { ...raw, type };
  if (type === 'mesh' || type === 'weightedmesh' || type === 'linkedmesh') return _cleanObj(base, _ATT_MESH_KEEP);
  if (type === 'region') return _cleanObj(base, _ATT_REGION_KEEP);
  return _cleanObj(base, _ATT_OTHER_KEEP);
}

/**
 * 从编辑器项目构建完整的 Spine 运行时 JSON(任意项目类型可用)。
 *
 * 策略:
 * - 运行时导入(p.spine.raw 有完整 skins/bones/slots):走现有 round-trip 路径(exportSpineProject)
 * - 解码 .spine(p.spine.project=true,srcPath 存在):重新解码原文件获取完整数据,用编辑器修改覆盖
 * - 自建项目(无 p.spine):完全从编辑器模型构建
 * @returns {{ json: string, version: string }}
 */
export async function buildSpineJsonFromModel(p) {
  const sp = p.spine;
  const fps = p.frameRate || 30;

  // ---- Case 1: 运行时导入,raw 有完整 skins(走现有 round-trip) ----
  if (sp && sp.raw && sp.raw.skins && sp.raw.skeleton && !sp.project) {
    return exportSpineProject(p);
  }

  // ---- Case 2/3: 解码 .spine 或自建项目 ----
  let decoded = null;
  if (sp && sp.project && sp.srcPath && window.api?.decodeSpineProject) {
    try {
      const r = await window.api.decodeSpineProject({ inputPath: sp.srcPath });
      if (r && r.ok) decoded = JSON.parse(r.json);
    } catch (e) { /* 解码失败 -> 降级为纯模型构建 */ }
  }

  const out = {};

  // ---- skeleton 元数据 ----
  out.skeleton = {
    hash: 'editor_export',
    spine: sp?.version || '3.8.99',
    x: 0, y: 0, width: 0, height: 0,
    fps,
    images: decoded?.skeleton?.images || '',
    audio: '',
  };

  // ---- 约束/事件:从解码数据或 raw 中保留 ----
  const constraintSrc = decoded || sp?.raw;
  if (constraintSrc) {
    for (const key of ['ik', 'transform', 'path', 'events', 'strings']) {
      if (constraintSrc[key] !== undefined) out[key] = constraintSrc[key];
    }
  }

  // ---- 骨骼 ----
  const decodedBonesByName = new Map((decoded?.bones || []).map((b) => [b.name, b]));
  out.bones = p.armature.bones.map((b) => {
    const raw = _cleanBone(decodedBonesByName.get(b.name) || b.raw || {});
    const o = { ...raw, name: b.name };
    if (b.parent) o.parent = b.parent; else delete o.parent;
    o.x = r4(b.x); o.y = r4(b.y); o.rotation = r4(b.rotation);
    if (b.length) o.length = r4(b.length);
    if (b.scaleX !== undefined && b.scaleX !== 1) o.scaleX = r4(b.scaleX);
    if (b.scaleY !== undefined && b.scaleY !== 1) o.scaleY = r4(b.scaleY);
    return o;
  });

  // ---- 插槽 ----
  const decodedSlotsByName = new Map((decoded?.slots || []).map((s) => [s.name, s]));
  const ordered = [...p.armature.slots].sort((a, b) => a.z - b.z);
  out.slots = ordered.map((s) => {
    const raw = _cleanSlot(decodedSlotsByName.get(s.name) || s.raw || {});
    const o = { ...raw, name: s.name, bone: s.parent };
    o.color = hex2(s.color.r) + hex2(s.color.g) + hex2(s.color.b) + hex2((s.color.a ?? 1) * 255);
    delete o.darkColor; // 颜色由编辑器管理
    const disp = s.displays[s.displayIndex];
    o.attachment = disp ? disp.name : undefined;
    return o;
  });

  // ---- skins:从编辑器插槽显示对象重建 ----
  out.skins = _buildSkinsFromModel(p, decoded);

  // ---- 动画 ----
  out.animations = _buildAnimationsFromModel(p, decoded, fps);

  return { json: JSON.stringify(out, null, 1), version: out.skeleton.spine };
}

/** 从编辑器插槽显示对象重建 Spine skins 块 */
function _buildSkinsFromModel(p, decoded) {
  const skinName = p.spine?.skin || 'default';
  const attachments = {};
  // 解码数据的附件(含 mesh/linkedMesh 等完整几何)
  const decodedAttByName = new Map();
  for (const a of (decoded?.attachments || [])) {
    if (a.name && !String(a.name).startsWith('#ref')) decodedAttByName.set(a.name, a);
  }

  for (const slot of p.armature.slots) {
    const slotAtts = {};
    for (const disp of slot.displays) {
      // 优先用解码数据中的完整附件(含 mesh/linkedMesh 等)
      const decodedAtt = decodedAttByName.get(disp.name);
      if (decodedAtt) {
        const att = { ..._cleanAtt(decodedAtt) };
        delete att.slot_hint;
        // 应用编辑器的变换修改
        const t = disp.transform || {};
        if (t.x !== undefined) att.x = r4(t.x);
        if (t.y !== undefined) att.y = r4(t.y);
        if (t.rotation !== undefined) att.rotation = r4(t.rotation);
        if (t.scaleX !== undefined && t.scaleX !== 1) att.scaleX = r4(t.scaleX);
        if (t.scaleY !== undefined && t.scaleY !== 1) att.scaleY = r4(t.scaleY);
        slotAtts[disp.name] = att;
      } else {
        // 无解码数据:从编辑器模型构建 region 附件
        const att = {};
        const t = disp.transform || {};
        if (t.x) att.x = r4(t.x);
        if (t.y) att.y = r4(t.y);
        if (t.rotation) att.rotation = r4(t.rotation);
        if (t.scaleX !== undefined && t.scaleX !== 1) att.scaleX = r4(t.scaleX);
        if (t.scaleY !== undefined && t.scaleY !== 1) att.scaleY = r4(t.scaleY);
        const img = (p.images || []).find((i) => i.id === disp.imageId);
        if (img) { att.width = img.w || 0; att.height = img.h || 0; }
        if (disp.raw && disp.raw.type && disp.raw.type !== 'region') {
          Object.assign(att, disp.raw);
        }
        slotAtts[disp.name] = att;
      }
    }
    if (Object.keys(slotAtts).length) attachments[slot.name] = slotAtts;
  }

  if ((p.spine?.family || '3') === '4') return [{ name: skinName, attachments }];
  return { [skinName]: attachments };
}

/** 从编辑器动画构建 Spine animations 块(含 rawKeep + 解码数据中的 un-edited 时间线) */
function _buildAnimationsFromModel(p, decoded, fps) {
  const out = {};
  const decodedAnims = decoded?.animations || {};

  for (const anim of p.armature.animations) {
    const a = {};
    const boneTl = {};
    for (const [bn, ch] of Object.entries(anim.bones || {})) {
      const o = {};
      if (ch.translate?.length) o.translate = ch.translate.map((k) => ({ time: r4(k.frame / fps), x: k.v.x, y: k.v.y, ...curveOf(k) }));
      if (ch.rotate?.length) o.rotate = ch.rotate.map((k) => ({ time: r4(k.frame / fps), angle: k.v.rotation, ...curveOf(k) }));
      if (ch.scale?.length) o.scale = ch.scale.map((k) => ({ time: r4(k.frame / fps), x: k.v.scaleX, y: k.v.scaleY, ...curveOf(k) }));
      if (Object.keys(o).length) boneTl[bn] = o;
    }
    if (Object.keys(boneTl).length) a.bones = boneTl;

    const slotTl = {};
    for (const [sn, ch] of Object.entries(anim.slots || {})) {
      const o = {};
      if (ch.color?.length) o.color = ch.color.map((k) => ({ time: r4(k.frame / fps), color: hex2(k.v.r) + hex2(k.v.g) + hex2(k.v.b) + hex2((k.v.a ?? 1) * 255), ...curveOf(k) }));
      if (ch.display?.length) {
        const slot = p.armature.slots.find((s) => s.name === sn);
        o.attachment = ch.display.map((k) => {
          const disp = slot && k.v.displayIndex >= 0 ? slot.displays[k.v.displayIndex] : null;
          return { time: r4(k.frame / fps), name: disp ? disp.name : null };
        });
      }
      if (Object.keys(o).length) slotTl[sn] = o;
    }
    if (Object.keys(slotTl).length) a.slots = slotTl;

    // 保留编辑器 rawKeep(deform/ik/transform/path/drawOrder/events/sequence)
    for (const [key, v] of Object.entries(anim.rawKeep || {})) a[key] = v;

    // 从解码数据中补充编辑器未处理的时间线(attachment/event 等)
    // 注意:这些数据仅保留在 rawKeep 中供 round-trip,不直接写入导出(引用未解析)
    const decodedAnim = decodedAnims[anim.name];
    if (decodedAnim?.timelines) {
      for (const tl of decodedAnim.timelines) {
        if (tl.kind === 'attachment' && tl.target && tl.keys?.length) {
          // 保留为 rawKeep 但不写入导出(attachment_ref 未解析)
          if (!anim.rawKeep) anim.rawKeep = {};
          // 不写入 —— 附件时间线引用未解析,导出时跳过
        }
      }
    }

    out[anim.name] = a;
  }
  return out;
}
