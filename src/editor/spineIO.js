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

/** 生成 atlas 文本(导出:页名替换为 _edit 版本) */
export function serializeAtlas(atlasText, nameMap) {
  return atlasText.split(/\r?\n/).map((ln) => {
    const t = ln.trim();
    if (t && !ln.startsWith(' ') && !ln.startsWith('\t') && !t.includes(':')) {
      // 页名行:替换为导出名
      const ext = t.match(/\.[^.]+$/)?.[0] || '.png';
      const base = t.slice(0, -ext.length);
      return (nameMap.get(t) !== undefined ? nameMap.get(t) : base + '_edit' + ext);
    }
    return ln;
  }).join('\n');
}

// ---------------- 渲染端 region 裁剪 ----------------

const _pageImgCache = new Map(); // pageName+hash → HTMLImageElement
const _cropCache = new Map();    // imageId → dataUrl

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
  const hit = _cropCache.get(image.id);
  if (hit) return hit;
  const page = (project.spine?.pages || []).find((p) => p.name === image.spineRegion.page);
  if (!page) return null;
  const img = getPageImg(page.dataUrl);
  if (!img) return null;
  const r = image.spineRegion;
  const W = r.ow || r.w, H = r.oh || r.h;   // 原始尺寸
  const ox = r.ox || 0, oy = r.oy || 0;     // trim 偏移(atlas 语义,spine y 上)
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, W); cv.height = Math.max(1, H);
  const g = cv.getContext('2d');
  g.save();
  // 目标:把图集块按原样转正放回原始图的 (ox, oy) 位置
  if (r.rotate === 90) {
    // 块宽=H 高=W;由 spine-ts UV 映射推导:block(u,v) → orig(v, H-u) 相对块原点
    g.translate(ox, oy + H);
    g.rotate(-Math.PI / 2);
    g.drawImage(img, r.x, r.y, r.h, r.w, 0, 0, r.h, r.w);
  } else if (r.rotate === 270) {
    g.translate(ox + W, oy);
    g.rotate(Math.PI / 2);
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
  const url = cv.toDataURL('image/png');
  _cropCache.set(image.id, url);
  return url;
}

// ---------------- 导入 ----------------

function curveToEase(curve) {
  if (!curve) return { type: 'linear' };
  if (curve === 'stepped') return { type: 'step' };
  if (Array.isArray(curve) && curve.length === 4) return { type: 'bezier', pts: curve.slice() };
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
const easeOf = (k) => k.ease && k.ease.type ? k.ease : curveToEase(k.curve);

/**
 * Spine JSON → 编辑器工程。
 * @param {object} json Spine 骨架 JSON(3.8 或 4.x)
 * @param {object} spine { atlasText, pages: [{name, dataUrl}] }
 */
export function importSpineProject(json, { atlasText, pages }) {
  if (!json || !json.skeleton || !Array.isArray(json.bones)) throw new Error('不是有效的 Spine 骨架 JSON');
  const version = String(json.skeleton.spine || '');
  const family = version.startsWith('4') ? '4' : '3';
  const atlas = atlasText ? parseAtlasText(atlasText) : { pages: [], regions: new Map() };

  // skins 归一:3.8 对象 / 4.x 数组 → [{name, attachments}]
  const skinsRaw = Array.isArray(json.skins)
    ? json.skins.map((s) => ({ name: s.name, attachments: s.attachments }))
    : Object.entries(json.skins || {}).map(([name, att]) => ({ name, attachments: att }));
  if (!skinsRaw.length) throw new Error('JSON 中没有皮肤数据');
  const skin = skinsRaw.find((s) => s.name === 'default') || skinsRaw[0];

  const p = createProject(json.skeleton.hash ? String(json.skeleton.hash).slice(0, 12) : 'spine工程');
  p.name = 'spine_' + (skin.name === 'default' ? 'project' : skin.name);
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
    raw: b,
  }));

  // ---- 附件 → region 图片 + 显示对象 ----
  const images = [];
  const dispBySlot = new Map(); // slotName → displays[]
  const ensureImage = (attName, att) => {
    const pathName = att.path || attName;
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
  p.images = images;

  // ---- 插槽(z = json 顺序)----
  p.armature.slots = json.slots.map((s, idx) => {
    const dispList = dispBySlot.get(s.name) || [];
    let di = 0;
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

// ---------------- 导出 ----------------

/** 编辑器工程 → Spine JSON 文本(结构按导入版本家族回写) */
export function exportSpineProject(p) {
  const sp = p.spine;
  if (!sp) throw new Error('当前工程不是 Spine 导入工程');
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

function curveOf(key) {
  const c = easeToCurve(key.ease);
  return c !== undefined ? { curve: c } : {};
}
const r4 = (v) => Math.round(v * 10000) / 10000;

/** 导出文件集:<base>.json + <base>.atlas + 页 PNG(均加 _edit 防覆盖原件) */
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
    // 页名重写为 _edit 并导出页图
    const nameMap = new Map();
    for (const pg of sp.pages || []) {
      const ext = pg.name.match(/\.[^.]+$/)?.[0] || '.png';
      const newN = pg.name.slice(0, -ext.length) + '_edit' + ext;
      nameMap.set(pg.name, newN);
      await window.api.writeFileBase64(dir + '\\' + newN, pg.dataUrl);
      files.push(newN);
    }
    await writeText(dir + '\\' + base + '.atlas', serializeAtlas(sp.atlasText, nameMap));
    files.push(base + '.atlas');
  }
  return { dir, files };
}
