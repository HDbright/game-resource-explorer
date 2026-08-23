/**
 * 骨骼动画编辑器 - 导出器。
 * 1) 工程存取:自有格式 .lbone.json(内嵌图片 dataUrl,单文件自包含)。
 * 2) 导出 DragonBones 5.x:骨架 <名>_ske.json + 纹理图集 <名>_tex.json + 合并 PNG
 *    (复用 atlasPacker 打包;格式与本应用 DragonBones 预览(DbPlayer)直接兼容)。
 */

import { packImages } from '../atlasPacker.js';
import { easeToBezier } from './animator.js';
import { slotsInZOrder } from './model.js';

// ---------------- 工程存取 ----------------

export function projectToJson(p) { return JSON.stringify(p, null, 1); }

export async function saveProjectFile(p) {
  const r = await window.api.saveText({
    title: '保存骨骼动画工程',
    defaultName: (p.name || 'project') + '.lbone.json',
    filters: [{ name: '骨骼动画工程', extensions: ['lbone.json', 'json'] }],
    content: projectToJson(p),
  });
  return r && r.ok ? r.path : null;
}

export async function openProjectFile() {
  const pr = await window.api.pickFiles({
    title: '打开骨骼动画工程',
    multi: false,
    filters: [{ name: '骨骼动画工程', extensions: ['lbone.json', 'json'] }],
  });
  const paths = (!pr || pr.canceled) ? [] : (pr.filePaths || []);
  if (!paths.length) return null;
  const r = await window.api.readText(paths[0]);
  if (!r || !r.ok) throw new Error('读取工程文件失败:' + (r && r.error));
  return JSON.parse(r.text);
}

// ---------------- 图集打包 ----------------

function loadImageEl(dataUrl) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });
}

/**
 * 打包项目图片为单页图集(无旋转/无裁剪,保证 SubTexture 坐标简单可靠)。
 * 返回 { canvas, width, height, rects: Map<imageId, {name,x,y,w,h}> }
 */
export async function packProjectAtlas(project, { maxSize = 2048 } = {}) {
  const usedIds = new Set();
  for (const s of project.armature.slots) for (const d of s.displays) usedIds.add(d.imageId);
  const imgs = (project.images || []).filter((i) => usedIds.has(i.id));
  if (!imgs.length) throw new Error('项目中没有已使用的图片,请先绑定图片到插槽');

  const items = [];
  for (const im of imgs) {
    const el = await loadImageEl(im.dataUrl);
    items.push({ name: im.id, srcW: im.w || el.naturalWidth, srcH: im.h || el.naturalHeight, trimX: 0, trimY: 0, trimW: im.w || el.naturalWidth, trimH: im.h || el.naturalHeight, img: el });
  }
  const pages = packImages(items, { maxSize, padding: 2, allowRotation: false, pot: false });
  if (pages.length > 1) throw new Error(`图片总面积超过 ${maxSize}px 单页上限,已生成 ${pages.length} 页;请减少图片或缩小尺寸`);
  const page = pages[0];
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const g = canvas.getContext('2d');
  const rects = new Map();
  for (const pl of page.placements) {
    g.drawImage(pl.img, pl.ax, pl.ay);
    rects.set(pl.name, { name: pl.name, x: pl.ax, y: pl.ay, w: pl.trimW, h: pl.trimH });
  }
  return { canvas, width: page.width, height: page.height, rects };
}

// ---------------- DragonBones 5.x 导出 ----------------

function curveOf(key) {
  // DragonBones curve:数字 0=线性补间;数组=贝塞尔 [x1,y1,x2,y2];step → 无补间(不写)
  if (!key.ease || key.ease.type === 'linear') return 0;
  if (key.ease.type === 'step') return undefined; // 无补间:省略字段(解析器默认不补间?)
  const pts = easeToBezier(key.ease);
  return pts ? pts.map((v) => Math.round(v * 100) / 100) : 0;
}

/** 关键帧数组 → DragonBones 帧序列(duration = 到下一帧的帧距;首帧前不动、末帧后保持) */
function keysToFrames(keys, total, toFrame) {
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  return sorted.map((k, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1].frame : total;
    const f = toFrame(k);
    const curve = curveOf(k);
    if (curve !== undefined && curve !== 0) f.curve = curve;
    else if (curve === 0) f.curve = 0;
    f.duration = Math.max(0, next - k.frame);
    return f;
  });
}

/**
 * 生成 DragonBones 5.x 骨架数据 + 纹理图集数据。
 * atlas:packProjectAtlas 的返回
 */
export function buildDragonBonesExport(project, atlas) {
  const arm = project.armature;
  const nameMap = new Map(); // imageId → 导出显示名(与 SubTexture name 一致,去扩展名)
  for (const im of project.images) {
    const disp = arm.slots.some((s) => s.displays.some((d) => d.imageId === im.id));
    if (disp) nameMap.set(im.id, sanitizeName(im.name.replace(/\.[^.]+$/, '') || 'img'));
  }
  // 同名冲突处理(显示名需唯一)
  const seen = new Set();
  for (const [id, n0] of nameMap) {
    let n = n0, i = 1;
    while (seen.has(n)) n = n0 + '_' + (i++);
    seen.add(n);
    nameMap.set(id, n);
  }

  const ske = {
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: project.frameRate || 30,
    name: sanitizeName(project.name || 'project'),
    armature: [{
      type: 'Armature',
      name: sanitizeName(arm.name || 'armature'),
      frameRate: project.frameRate || 30,
      bone: arm.bones.map((b) => ({
        name: b.name,
        parent: b.parent || undefined,
        inheritTranslation: b.inheritTranslation === false ? false : undefined,
        inheritRotation: b.inheritRotation === false ? false : undefined,
        inheritScale: b.inheritScale === false ? false : undefined,
        length: b.length || 0,
        transform: { x: r1(b.x), y: r1(b.y), skX: r1(b.rotation), skY: r1(b.rotation), scX: r3(b.scaleX), scY: r3(b.scaleY) },
      })),
      slot: slotsInZOrder(project).map((s, i) => ({
        name: s.name,
        parent: s.parent,
        z: i,
        displayIndex: s.displays.length ? (s.displayIndex || 0) : -1,
        color: { r: Math.round(s.color.r), g: Math.round(s.color.g), b: Math.round(s.color.b), a: Math.round((s.color.a ?? 1) * 255) },
      })),
      skin: [{
        name: '',
        slot: slotsInZOrder(project).map((s) => ({
          name: s.name,
          display: s.displays.map((d) => {
            const im = project.images.find((x) => x.id === d.imageId);
            return {
              name: nameMap.get(d.imageId) || sanitizeName(im?.name || 'img'),
              path: nameMap.get(d.imageId) || sanitizeName(im?.name || 'img'),
              type: 'image',
              transform: { x: r1(d.transform.x), y: r1(d.transform.y), skX: r1(d.transform.rotation), skY: r1(d.transform.rotation), scX: r3(d.transform.scaleX), scY: r3(d.transform.scaleY) },
              pivot: { x: r3(d.pivot.x), y: r3(d.pivot.y) },
            };
          }),
        })),
      }],
      animation: arm.animations.map((a) => {
        const total = a.duration;
        const boneArr = [];
        for (const [bn, ch] of Object.entries(a.bones || {})) {
          const entry = { name: bn };
          if ((ch.translate || []).length) {
            entry.translateFrame = keysToFrames(ch.translate, total, (k) => ({ x: r1(k.v.x), y: r1(k.v.y) }));
          }
          if ((ch.rotate || []).length) {
            entry.rotateFrame = keysToFrames(ch.rotate, total, (k) => ({ rotate: r1(k.v.rotation) }));
          }
          if ((ch.scale || []).length) {
            entry.scaleFrame = keysToFrames(ch.scale, total, (k) => ({ x: r3(k.v.scaleX), y: r3(k.v.scaleY) }));
          }
          if (entry.translateFrame || entry.rotateFrame || entry.scaleFrame) boneArr.push(entry);
        }
        const slotArr = [];
        for (const [sn, ch] of Object.entries(a.slots || {})) {
          const entry = { name: sn };
          if ((ch.color || []).length) {
            entry.colorFrame = keysToFrames(ch.color, total, (k) => ({
              value: {
                rM: Math.round((k.v.r / 255) * 100), gM: Math.round((k.v.g / 255) * 100),
                bM: Math.round((k.v.b / 255) * 100), aM: Math.round((k.v.a ?? 1) * 100),
                rO: 0, gO: 0, bO: 0, aO: 0,
              },
            }));
          }
          if ((ch.display || []).length) {
            entry.displayFrame = keysToFrames(ch.display, total, (k) => ({ value: k.v.displayIndex }));
          }
          if (entry.colorFrame || entry.displayFrame) slotArr.push(entry);
        }
        return {
          name: a.name,
          duration: total,
          playTimes: a.loop === false ? 1 : -1,
          ...(boneArr.length ? { bone: boneArr } : {}),
          ...(slotArr.length ? { slot: slotArr } : {}),
        };
      }),
    }],
  };

  const tex = {
    imagePath: sanitizeName(project.name || 'project') + '.png',
    width: atlas.width,
    height: atlas.height,
    SubTexture: [...atlas.rects.values()].map((r) => {
      const n = nameMap.get(r.name) || r.name;
      return { name: n, x: r.x, y: r.y, width: r.w, height: r.h };
    }),
  };
  return { ske, tex };
}

function r1(v) { return Math.round((v || 0) * 10) / 10; }
function r3(v) { return Math.round((v === undefined ? 1 : v) * 1000) / 1000; }
function sanitizeName(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '_'); }

/**
 * 导出全部文件:让用户选目录,直接写出 <名>_ske.json / <名>_tex.json / <名>.png
 */
export async function exportDragonBonesFiles(project) {
  const atlas = await packProjectAtlas(project);
  const { ske, tex } = buildDragonBonesExport(project, atlas);
  const dirR = await window.api.pickDirs({ title: '选择导出目录' });
  const dir = (!dirR || dirR.canceled) ? null : (dirR.filePaths || [])[0];
  if (!dir) return null;
  const base = sanitizeName(project.name || 'project');
  const writeText = (p, text) =>
    window.api.writeFileBase64(p, 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(text))));
  await window.api.writeFileBase64(dir + '\\' + base + '.png', atlas.canvas.toDataURL('image/png'));
  await writeText(dir + '\\' + base + '_ske.json', JSON.stringify(ske));
  await writeText(dir + '\\' + base + '_tex.json', JSON.stringify(tex));
  return { dir, files: [base + '.png', base + '_ske.json', base + '_tex.json'] };
}
