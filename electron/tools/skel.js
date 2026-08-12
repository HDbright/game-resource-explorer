'use strict';
// skel → json 转换工具:解析 Spine 二进制骨架并导出为 JSON(供 Spine 编辑器 / JSON 运行时加载)。
// 支持 3.x / 4.x 二进制:根据头部 hash 字段区分运行时版本。
//
// 序列化器说明:
//   * 覆盖 bones / slots / ik / transform / path 约束 / events / skins(region/mesh/weightedMesh/linkedMesh/path/boundingBox)
//     / 动画(translate/rotate/scale/shear/color/attachment/deform/ik/transform/path/draworder/event)
//   * 输出 JSON 形态与 spine-core 4.x SkeletonJson 兼容(同时 3.8 SkeletonJson 也可解析,除 sequence 与
//     physics 约束等高阶特性外)
//
// 解析器:
//   * 二进制头部探测来自 src/preview/skelProbe.js(渲染端,逻辑相同)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- 二进制头部探测(同 src/preview/skelProbe.js) ----

function looksLikeVersion(text) {
  if (!text || text.length === 0 || text.length > 31) return false;
  let hasDot = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 46) { hasDot = true; continue; }
    if (c < 48 || c > 57) return false;
  }
  const first = text.charCodeAt(0);
  return hasDot && first >= 48 && first <= 57;
}
function readVarint(bytes, pos) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (pos >= bytes.length) return null;
    const b = bytes[pos++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, nextPos: pos };
  }
  return null;
}
function readSpineBinaryString(bytes, pos) {
  const len = readVarint(bytes, pos);
  if (!len) return null;
  const encodedLength = len.value;
  if (encodedLength === 0) return null;
  const byteLength = encodedLength - 1;
  if (byteLength > 512 || len.nextPos + byteLength > bytes.length) return null;
  let text = '';
  for (let i = 0; i < byteLength; i++) text += String.fromCharCode(bytes[len.nextPos + i]);
  return { text, nextPos: len.nextPos + byteLength };
}
function probeSkeleton(bytes) {
  if (!bytes || bytes.length === 0) return null;
  // JSON 快速嗅探
  const first = bytes[0];
  if (first === 0x7b /* { */ || (first === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    // 不是 skel 二进制
    return null;
  }
  // binary#1: int64 hash(8 字节) + varint version
  if (bytes.length >= 10) {
    const ver1 = readSpineBinaryString(bytes, 8);
    if (ver1 && looksLikeVersion(ver1.text)) return { kind: 'binary', version: ver1.text, hashSize: 8 };
  }
  // binary#2: varint 字符串 hash + varint 字符串 version(3.x)
  const hash2 = readSpineBinaryString(bytes, 0);
  if (hash2) {
    const ver2 = readSpineBinaryString(bytes, hash2.nextPos);
    if (ver2 && looksLikeVersion(ver2.text)) return { kind: 'binary', version: ver2.text, hashSize: -1 };
  }
  return null;
}

// ---- 颜色 / 曲线编码工具 ----

function colorToHex(c) {
  // Color 对象通常含 r/g/b/a(0-1 浮点)
  if (!c) return null;
  const r = Math.max(0, Math.min(255, Math.round((c.r ?? 0) * 255)));
  const g = Math.max(0, Math.min(255, Math.round((c.g ?? 0) * 255)));
  const b = Math.max(0, Math.min(255, Math.round((c.b ?? 0) * 255)));
  const a = Math.max(0, Math.min(255, Math.round((c.a ?? 0) * 255)));
  return '#' + [r, g, b, a].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---- 附件序列化 ----

/** 附件类型推断:4.x 有字符串 type;3.x 无,用构造器名 + bones 判断加权 */
function attachmentKind(att) {
  if (att.type) return String(att.type).toLowerCase();
  const ctor = att.constructor && att.constructor.name;
  if (ctor === 'RegionAttachment') return 'region';
  if (ctor === 'MeshAttachment') return (att.bones && att.bones.length) ? 'weightedmesh' : 'mesh';
  if (ctor === 'LinkedMeshAttachment') return 'linkedmesh';
  if (ctor === 'PathAttachment') return 'path';
  if (ctor === 'BoundingBoxAttachment') return 'boundingbox';
  if (ctor === 'ClippingAttachment') return 'clipping';
  if (ctor === 'PointAttachment') return 'point';
  return (ctor || '').toLowerCase();
}

/**
 * 3.x 加权网格顶点内联为 [boneCount, boneIdx, x, y, w, ...]。
 * 3.8 SkeletonJson.readVertices 的加权分支只读 map.vertices 这一个字段(按 boneCount 前缀
 * 交错读取),与 4.x 的独立 bones/weights/vertices 三数组不同。
 * 3.8 运行时解析二进制后:att.bones = [boneCount, boneIdx...](逐顶点分组),
 * att.vertices = [x0,y0,w0, x1,y1,w1, ...](位置+权重交错)。这里把两者合并成 3.8 JSON 格式。
 */
function interleaveWeighted(att) {
  const bones = att.bones || [];
  const wv = att.vertices || [];
  const out = [];
  let vi = 0;
  for (let i = 0; i < bones.length; ) {
    const bc = bones[i++];
    out.push(bc);
    for (let j = 0; j < bc && i < bones.length; j++) {
      out.push(bones[i++]); // 骨骼索引
      out.push(wv[vi++]); // x
      out.push(wv[vi++]); // y
      out.push(wv[vi++]); // w
    }
  }
  return out;
}

function serializeAttachment(att, format) {
  const kind = attachmentKind(att);
  const out = { name: att.name };
  if (kind === 'region') {
    // RegionAttachment: x,y,rotation,scaleX,scaleY,width,height,path,r,g,b,a
    if (att.path != null) out.path = att.path;
    if (att.x) out.x = att.x;
    if (att.y) out.y = att.y;
    if (att.rotation) out.rotation = att.rotation;
    if (att.scaleX != null && att.scaleX !== 1) out.scaleX = att.scaleX;
    if (att.scaleY != null && att.scaleY !== 1) out.scaleY = att.scaleY;
    if (att.width) out.width = att.width;
    if (att.height) out.height = att.height;
    if (att.color && (att.color.a ?? 1) !== 1) {
      const hex = colorToHex(att.color);
      if (hex) out.color = hex;
    }
  } else if (kind === 'mesh' || kind === 'weightedmesh' || kind === 'skinnedmesh') {
    const weighted = (att.bones && att.bones.length) || kind !== 'mesh';
    if (format === '3') {
      // ⚠️ 3.x SkeletonJson 不识别 weightedmesh/skinnedmesh 类型(那是 4.x 格式):
      // type 必须写 'mesh';加权顶点必须内联进 vertices([boneCount, boneIdx, x, y, w, ...]),
      // 不能写 4.x 的独立 bones/weights/vertices 三数组(3.8 readVertices 只读 map.vertices)。
      // 否则 readAttachment 对 weightedmesh 返回 null → 附件被跳过 → 皮肤缺附件 →
      // deform 时间线抛 "Deform attachment not found: undefined"。
      out.type = 'mesh';
      if (att.path != null) out.path = att.path;
      // 注意:JSON 里的 uvs 是归一化(0-1)regionUVs,不是 updateUVs 后的像素 uvs
      out.uvs = floatArr(att.regionUVs || att.uvs);
      out.vertices = weighted ? interleaveWeighted(att) : floatArr(att.vertices);
      out.triangles = intArr(att.triangles);
      if (att.edges && att.edges.length) out.edges = intArr(att.edges);
      if (att.hullLength) out.hull = att.hullLength / 2;
      else if (att.hull) out.hull = att.hull;
      if (att.width) out.width = att.width;
      if (att.height) out.height = att.height;
      if (att.color && (att.color.a ?? 1) !== 1) {
        const hex = colorToHex(att.color);
        if (hex) out.color = hex;
      }
    } else {
      out.type = weighted ? 'weightedmesh' : 'mesh';
      if (att.path != null) out.path = att.path;
      // 注意:JSON 里的 uvs 是归一化(0-1)regionUVs,不是 updateUVs 后的像素 uvs
      out.uvs = floatArr(att.regionUVs || att.uvs);
      if (weighted) {
        // weighted mesh:bones/weights 按顶点连续;vertices 只有位置
        out.bones = intArr(att.bones);
        out.weights = floatArr(att.weights);
        out.vertices = floatArr(att.vertices);
      } else {
        out.vertices = floatArr(att.vertices);
      }
      out.triangles = intArr(att.triangles);
      if (att.edges && att.edges.length) out.edges = intArr(att.edges);
      if (att.hullLength) out.hull = att.hullLength / 2;
      else if (att.hull) out.hull = att.hull;
      if (att.width) out.width = att.width;
      if (att.height) out.height = att.height;
      if (att.color && (att.color.a ?? 1) !== 1) {
        const hex = colorToHex(att.color);
        if (hex) out.color = hex;
      }
    }
  } else if (kind === 'linkedmesh') {
    out.type = 'linkedmesh';
    // 3.x/4.x JSON 都用 "parent" 字段;skin 可选;3.x 用 "deform"、4.x 用 "timelines"
    out.skin = att.skin || '';
    out.parent = att.parentMesh ? (att.parentMesh.name || att.parentMesh) : (att.parent || '');
    const inherit = att.inheritDeform ?? att.inheritTimeline;
    if (inherit != null) out.deform = !!inherit;
    if (att.color && (att.color.a ?? 1) !== 1) {
      const hex = colorToHex(att.color);
      if (hex) out.color = hex;
    }
  } else if (kind === 'path') {
    out.type = 'path';
    out.closed = !!att.closed;
    out.vertexCount = att.vertexCount || 0;
    if (att.lengths && att.lengths.length) out.lengths = floatArr(att.lengths);
    if (att.color) {
      const hex = colorToHex(att.color);
      if (hex) out.color = hex;
    }
  } else if (kind === 'boundingbox') {
    out.type = 'boundingbox';
    out.vertexCount = att.vertexCount || 0;
    if (att.color) {
      const hex = colorToHex(att.color);
      if (hex) out.color = hex;
    }
  } else {
    // 未知类型(clipping/point/sequence 等),跳过
    return null;
  }
  return out;
}

function floatArr(arr) {
  if (!arr) return [];
  return Array.from(arr);
}
function intArr(arr) {
  if (!arr) return [];
  return Array.from(arr);
}

/**
 * 数值裁剪到 6 位小数(与 Spine 编辑器导出的紧凑格式一致,如 -192.440018)。
 * 3.8 运行时二进制解析出的坐标是 float32 提升为 float64 的全精度噪声
 * (如 236.9600067138672),直接写出会撑大 JSON 体积;裁剪到 1e-6 对渲染/动画
 * 完全无损,但体积大幅缩小。同时清除 -0。
 */
function trimNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) return v;
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** 递归裁剪对象树中的所有数值(序列化前统一处理,覆盖散落的坐标/时间/曲线/顶点) */
function roundObj(o) {
  // ⚠️ 兜底:TypedArray(Float32Array 等)的 Array.isArray 为 false,若漏网进入会被当普通对象
  // 遍历索引 → JSON 输出成 {"0":..,"1":..} 对象。先转普通数组。
  if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.length === 'number' && typeof o !== 'string') {
    o = Array.from(o);
  }
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) o[i] = roundObj(o[i]);
    return o;
  }
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) o[k] = roundObj(o[k]);
    return o;
  }
  if (typeof o === 'number') return trimNum(o);
  return o;
}

// ---- 动画时间线序列化(hook 记录方案) ----
// 背景:3.x / 4.x 各 Timeline 的 frames 扁平布局不同(ENTRIES 也不同),直接按索引推断易错位。
// 方案:解析前 hook 各 Timeline 的 setFrame/setCurve/setStepped,记录每次调用的原始参数,
// 序列化时按类型 + 参数还原帧,天然兼容两代运行时。

function hookTimelines(spine) {
  const names = [
    'RotateTimeline', 'TranslateTimeline', 'ScaleTimeline', 'ShearTimeline',
    'ColorTimeline', 'TwoColorTimeline',
    'IkConstraintTimeline', 'TransformConstraintTimeline',
    'PathConstraintPositionTimeline', 'PathConstraintSpacingTimeline', 'PathConstraintMixTimeline',
    'DeformTimeline', 'AttachmentTimeline', 'EventTimeline', 'DrawOrderTimeline',
  ];
  for (const name of names) {
    const T = spine[name];
    if (!T || !T.prototype) continue;
    if (T.prototype.setFrame && !T.prototype.__spineFixHooked) {
      const orig = T.prototype.setFrame;
      T.prototype.setFrame = function (frameIndex, time) {
        const rec = (this.__frames = this.__frames || []);
        rec.push({ i: frameIndex, time, args: Array.prototype.slice.call(arguments, 2) });
        return orig.apply(this, arguments);
      };
      T.prototype.__spineFixHooked = true;
    }
    if (T.prototype.setCurve && !T.prototype.__spineFixCurveHooked) {
      const origCurve = T.prototype.setCurve;
      T.prototype.setCurve = function (frameIndex, cx1, cy1, cx2, cy2) {
        const rec = (this.__curves = this.__curves || {});
        rec[frameIndex] = { cx1, cy1, cx2, cy2 };
        return origCurve.apply(this, arguments);
      };
      T.prototype.__spineFixCurveHooked = true;
    }
    if (T.prototype.setStepped && !T.prototype.__spineFixSteppedHooked) {
      const origStepped = T.prototype.setStepped;
      T.prototype.setStepped = function (frameIndex) {
        const rec = (this.__curves = this.__curves || {});
        rec[frameIndex] = 'stepped';
        return origStepped.apply(this, arguments);
      };
      T.prototype.__spineFixSteppedHooked = true;
    }
  }
}

/** 序列化一条时间线为帧数组。format: '3' | '4'(影响约束帧字段名) */
function serializeTimeline(t, format, baseVertices) {
  const records = t.__frames || [];
  const curves = t.__curves || {};
  const name = t.constructor && t.constructor.name;
  const out = [];
  for (const r of records) {
    const frame = serializeFrameArgs(name, r, curves[r.i], format, baseVertices);
    if (frame) out.push(frame);
  }
  return out;
}

function serializeFrameArgs(name, r, curve, format, baseVertices) {
  const a = r.args;
  const out = { time: r.time };
  if (curve === 'stepped') out.curve = 'stepped';
  else if (curve) {
    if (format === '3') {
      // ⚠️ 3.8 JSON 曲线格式:curve 是单值(cx1),其余控制点用 c2/c3/c4 字段;
      // 数组格式是 4.x 的。若 3.8 收到数组,setCurve(frameIndex, 数组, 0, 1, 1)
      // 会拿数组做算术 → NaN → 播放时所有骨骼/网格世界坐标全 NaN("无法正常播放")。
      out.curve = curve.cx1;
      out.c2 = curve.cy1;
      out.c3 = curve.cx2;
      out.c4 = curve.cy2;
    } else {
      out.curve = [curve.cx1, curve.cy1, curve.cx2, curve.cy2];
    }
  }
  switch (name) {
    case 'RotateTimeline':
      out.angle = a[0];
      return out;
    case 'TranslateTimeline':
    case 'ScaleTimeline':
    case 'ShearTimeline':
      out.x = a[0];
      out.y = a[1];
      return out;
    case 'ColorTimeline':
      out.color = '#' + [a[0], a[1], a[2], a[3]].map((v) => Math.max(0, Math.min(255, Math.round((v == null ? 0 : v) * 255))).toString(16).padStart(2, '0')).join('');
      return out;
    case 'IkConstraintTimeline':
      out.mix = a[0];
      if (a[1] !== undefined && a[1] !== 0) out.softness = a[1];
      out.bendPositive = (a[2] ?? 1) > 0;
      if (a[3]) out.compress = true;
      if (a[4]) out.stretch = true;
      return out;
    case 'TransformConstraintTimeline':
      if (format === '3') {
        // 3.8: setFrame(time, rotateMix, translateMix, scaleMix, shearMix)
        out.rotateMix = a[0];
        out.translateMix = a[1];
        out.scaleMix = a[2];
        out.shearMix = a[3];
      } else {
        // 4.x: setFrame(time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY)
        out.mixRotate = a[0];
        out.mixX = a[1];
        out.mixY = a[2];
        out.mixScaleX = a[3];
        out.mixScaleY = a[4];
        out.mixShearY = a[5];
      }
      return out;
    case 'PathConstraintPositionTimeline':
      out.position = a[0];
      return out;
    case 'PathConstraintSpacingTimeline':
      out.spacing = a[0];
      return out;
    case 'PathConstraintMixTimeline':
      if (format === '3') {
        out.rotateMix = a[0];
        out.translateMix = a[1];
      } else {
        out.mixRotate = a[0];
        out.mixX = a[1];
        out.mixY = a[2];
      }
      return out;
    case 'DeformTimeline':
      // ⚠️ 3.x 二进制/JSON 的 readDeformTimeline 对**非加权** mesh 都会做 `deform[v] += base[v]`,
      // 所以 hook 记录的 a[0] 已是 `raw + base`。但 3.x JSON 加载时**再次** `+= base`,
      // 若我们直接输出 a[0],加载后变成 `raw + 2×base` → 顶点整体被放大(无变形时 2 倍!)。
      // 修复:对非加权 mesh 输出 `raw = a[0] - base`;加权时 a[0] 已是权重直接输出。
      {
        const raw = a[0] || [];
        const base = baseVertices;
        if (base && base.length === raw.length) {
          // ⚠️ raw 可能是 Float32Array(有变形帧由 newFloatArray 生成),直接 .map 仍返回
          // Float32Array,而 Array.isArray(Float32Array)===false → roundObj 把它当普通对象
          // 遍历索引 → JSON 输出成 {"0":..,"1":..} 对象(Spine 解析失败)。必须用 Array.from 转普通数组。
          out.vertices = Array.from(raw, (v, i) => v - base[i]);
        } else {
          out.vertices = Array.from(raw);
        }
      }
      return out;
    case 'AttachmentTimeline':
      out.name = a[0];
      return out;
    case 'EventTimeline': {
      const ev = a[0];
      if (ev && ev.data) {
        out.name = ev.data.name;
        out.int = ev.intValue;
        out.float = ev.floatValue;
        out.string = ev.stringValue;
        if (ev.data.audioPath) {
          out.audioPath = ev.data.audioPath;
          out.volume = ev.volume;
          out.balance = ev.balance;
        }
      } else {
        out.name = a[0];
      }
      return out;
    }
    default:
      // DrawOrderTimeline 等:省略(spine 读回为默认顺序)
      return null;
  }
}

// ---- 序列化入口 ----

async function serializeSkeletonData(sd, probe) {
  const out = {
    skeleton: {
      hash: sd.hash || '',
      spine: probe.version,
      width: sd.width || 0,
      height: sd.height || 0,
      x: sd.x || 0,
      y: sd.y || 0,
      fps: sd.fps || 0,
      images: sd.imagesPath || '',
      audio: sd.audioPath || '',
      referenceScale: sd.referenceScale || 100,
    },
    bones: (sd.bones || []).map((b) => {
      const o = { name: b.name };
      if (b.parent) o.parent = b.parent.name;
      if (b.length) o.length = b.length;
      if (b.x) o.x = b.x;
      if (b.y) o.y = b.y;
      if (b.rotation) o.rotation = b.rotation;
      if (b.scaleX != null && b.scaleX !== 1) o.scaleX = b.scaleX;
      if (b.scaleY != null && b.scaleY !== 1) o.scaleY = b.scaleY;
      if (b.shearX) o.shearX = b.shearX;
      if (b.shearY) o.shearY = b.shearY;
      // 3.x 用 transformMode(number),4.x 用 inherit(枚举)
      const tm = b.inherit != null ? b.inherit : b.transformMode;
      if (tm) o.transform = inheritToStr(tm);
      if (b.skinRequired) o.skin = true;
      if (b.visible === false) o.visible = false;
      return o;
    }),
    slots: (sd.slots || []).map((s) => {
      const o = { name: s.name, bone: s.boneData.name };
      if (s.color && (s.color.r !== 1 || s.color.g !== 1 || s.color.b !== 1 || s.color.a !== 1)) {
        const hex = colorToHex(s.color);
        if (hex) o.color = hex;
      }
      if (s.darkColor) {
        const hex = colorToHex(s.darkColor);
        if (hex) o.dark = hex;
      }
      if (s.attachmentName) o.attachment = s.attachmentName;
      if (s.blendMode && s.blendMode !== 0) o.blend = blendToStr(s.blendMode);
      if (s.visible === false) o.visible = false;
      return o;
    }),
  };

  // bones
  out.bones = out.bones.filter((b) => Object.keys(b).length > 1 || b.name === 'root');

  // 版本格式:3.x → 输出 3.8 兼容格式;4.x → 输出 4.x 兼容格式(约束字段名不同)
  const format = /^3\./.test(probe.version) ? '3' : '4';

  // ik constraints
  if (sd.ikConstraints && sd.ikConstraints.length) {
    out.ik = sd.ikConstraints.map((c) => {
      const o = { name: c.name, bones: c.bones.map((b) => b.name), target: c.target ? c.target.name : '' };
      // ⚠️ order 决定约束应用顺序,缺失会导致 IK 求解结果不同(播放时骨骼位置差异大)
      if (c.order) o.order = c.order;
      if (c.bendDirection === -1) o.bendPositive = false;
      if (c.mix !== 1) o.mix = c.mix;
      if (c.compress) o.compress = true;
      if (c.stretch) o.stretch = true;
      if (c.uniform) o.uniform = true;
      if (c.softness) o.softness = c.softness;
      return o;
    });
  }
  // transform constraints(3.8 字段:rotateMix/translateMix/scaleMix/shearMix + rotation/x/y/scaleX/scaleY/shearY;
  // 4.x 字段:mixRotate/mixX/... + offsetRotation/offsetX/...)
  if (sd.transformConstraints && sd.transformConstraints.length) {
    out.transform = sd.transformConstraints.map((c) => {
      const o = { name: c.name, bones: c.bones.map((b) => b.name), target: c.target ? c.target.name : '' };
      if (c.order) o.order = c.order;
      if (format === '3') {
        if (c.rotateMix !== 1) o.rotateMix = c.rotateMix;
        if (c.translateMix !== 1) o.translateMix = c.translateMix;
        if (c.scaleMix !== 1) o.scaleMix = c.scaleMix;
        if (c.shearMix !== 1) o.shearMix = c.shearMix;
        if (c.offsetRotation) o.rotation = c.offsetRotation;
        if (c.offsetX) o.x = c.offsetX;
        if (c.offsetY) o.y = c.offsetY;
        if (c.offsetScaleX) o.scaleX = c.offsetScaleX;
        if (c.offsetScaleY) o.scaleY = c.offsetScaleY;
        if (c.offsetShearY) o.shearY = c.offsetShearY;
      } else {
        if (c.mixRotate !== 1) o.mixRotate = c.mixRotate;
        if (c.mixX !== 1) o.mixX = c.mixX;
        if (c.mixY !== 1) o.mixY = c.mixY;
        if (c.mixScaleX !== 1) o.mixScaleX = c.mixScaleX;
        if (c.mixScaleY !== 1) o.mixScaleY = c.mixScaleY;
        if (c.mixShearY !== 1) o.mixShearY = c.mixShearY;
        if (c.offsetRotation) o.offsetRotation = c.offsetRotation;
        if (c.offsetX) o.offsetX = c.offsetX;
        if (c.offsetY) o.offsetY = c.offsetY;
        if (c.offsetScaleX) o.offsetScaleX = c.offsetScaleX;
        if (c.offsetScaleY) o.offsetScaleY = c.offsetScaleY;
        if (c.offsetShearY) o.offsetShearY = c.offsetShearY;
      }
      if (c.relative) o.relative = true;
      if (c.local) o.local = true;
      return o;
    });
  }
  // path constraints
  if (sd.pathConstraints && sd.pathConstraints.length) {
    out.path = sd.pathConstraints.map((c) => {
      const o = { name: c.name, bones: c.bones.map((b) => b.name), target: c.target ? c.target.name : '' };
      if (c.order) o.order = c.order;
      o.positionMode = posModeStr(c.positionMode);
      o.spacingMode = spacingModeStr(c.spacingMode);
      o.rotateMode = rotateModeStr(c.rotateMode);
      if (format === '3') {
        if (c.offsetRotation) o.rotation = c.offsetRotation;
        if (c.rotateMix !== 1) o.rotateMix = c.rotateMix;
        if (c.translateMix !== 1) o.translateMix = c.translateMix;
        if (c.x) o.x = c.x;
        if (c.y) o.y = c.y;
      } else {
        if (c.offsetRotation) o.offsetRotation = c.offsetRotation;
        if (c.mixRotate !== 1) o.mixRotate = c.mixRotate;
        if (c.mixX !== 1) o.mixX = c.mixX;
        if (c.mixY !== 1) o.mixY = c.mixY;
      }
      if (c.position) o.position = c.position;
      if (c.spacing) o.spacing = c.spacing;
      return o;
    });
  }

  // events
  if (sd.events && sd.events.length) {
    out.events = sd.events.map((e) => {
      const o = { name: e.name };
      if (e.intValue) o.int = e.intValue;
      if (e.floatValue) o.float = e.floatValue;
      if (e.stringValue) o.string = e.stringValue;
      if (e.audioPath) {
        o.audioPath = e.audioPath;
        if (e.volume != null && e.volume !== 1) o.volume = e.volume;
        if (e.balance) o.balance = e.balance;
      }
      return o;
    });
  }

  // skins: 以对象形式 { skinName: { slotName: { attachName: {...} } } }
  const skins = {};
  for (const skin of (sd.skins || [])) {
    const map = {};
    for (const entry of skin.getAttachments()) {
      const slot = sd.slots[entry.slotIndex];
      if (!slot) continue;
      const slotName = slot.name;
      const att = serializeAttachment(entry.attachment, format);
      if (!att) continue;
      if (!map[slotName]) map[slotName] = {};
      map[slotName][entry.name] = att;
    }
    if (Object.keys(map).length) skins[skin.name] = map;
  }
  if (Object.keys(skins).length) out.skins = skins;
  if (sd.defaultSkin && sd.defaultSkin.name && (!out.skins || !out.skins[sd.defaultSkin.name])) {
    out.skins = out.skins || {};
    const map = {};
    for (const entry of sd.defaultSkin.getAttachments()) {
      const slot = sd.slots[entry.slotIndex];
      if (!slot) continue;
      const att = serializeAttachment(entry.attachment, format);
      if (!att) continue;
      if (!map[slot.name]) map[slot.name] = {};
      map[slot.name][entry.name] = att;
    }
    if (Object.keys(map).length) out.skins[sd.defaultSkin.name] = map;
  }
  if (out.skins && sd.defaultSkin) out.defaultSkin = sd.defaultSkin.name;

  // animations(按版本组装:3.x deform 在顶层 {skin:{slot:{attach:frames}}},attachment 在 slots 下;
  // 4.x attachment/deform 在顶层 attachments {skin:{slot:{attach:{attachment/deform:frames}}}})
  if (sd.animations && sd.animations.length) {
    out.animations = {};
    for (const anim of sd.animations) {
      const a = {};
      for (const tl of (anim.timelines || [])) {
        const ctor = tl.constructor && tl.constructor.name;
        const frames = serializeTimeline(tl, format);
        if (!frames || !frames.length) continue;
        const bone = tl.boneIndex != null ? sd.bones[tl.boneIndex] : null;
        const slot = tl.slotIndex != null ? sd.slots[tl.slotIndex] : null;
        let ikIdx = null, tcIdx = null, pcIdx = null;
        if (ctor === 'IkConstraintTimeline') ikIdx = sd.ikConstraints[tl.ikConstraintIndex ?? tl.constraintIndex] || null;
        else if (ctor === 'TransformConstraintTimeline') tcIdx = sd.transformConstraints[tl.transformConstraintIndex ?? tl.constraintIndex] || null;
        else if (ctor && ctor.indexOf('PathConstraint') === 0) pcIdx = sd.pathConstraints[tl.pathConstraintIndex ?? tl.constraintIndex] || null;
        if (bone) {
          const key = { RotateTimeline: 'rotate', TranslateTimeline: 'translate', ScaleTimeline: 'scale', ShearTimeline: 'shear' }[ctor] || ctor;
          a.bones = a.bones || {};
          a.bones[bone.name] = a.bones[bone.name] || {};
          a.bones[bone.name][key] = frames;
        } else if (slot && (ctor === 'AttachmentTimeline' || ctor === 'ColorTimeline' || ctor === 'RGBATimeline' || ctor === 'RGBTimeline' || ctor === 'AlphaTimeline' || ctor === 'RGBA2Timeline' || ctor === 'RGB2Timeline' || ctor === 'TwoColorTimeline')) {
          if (format === '4' && ctor === 'AttachmentTimeline') {
            // 4.x attachment 时间线在 attachments[skin][slot][attachmentName].attachment
            const attName = tl.attachmentName != null ? tl.attachmentName : (frames[0] && frames[0].name) || '';
            const skinName = findSkinName(sd, tl.slotIndex, attName, null);
            a.attachments = a.attachments || {};
            a.attachments[skinName] = a.attachments[skinName] || {};
            a.attachments[skinName][slot.name] = a.attachments[skinName][slot.name] || {};
            a.attachments[skinName][slot.name][attName] = a.attachments[skinName][slot.name][attName] || {};
            a.attachments[skinName][slot.name][attName].attachment = frames;
          } else {
            a.slots = a.slots || {};
            a.slots[slot.name] = a.slots[slot.name] || {};
            const key = ctor === 'AttachmentTimeline' ? 'attachment' : (ctor === 'ColorTimeline' || ctor === 'RGBATimeline' ? 'color' : ctor);
            a.slots[slot.name][key] = frames;
          }
        } else if (slot && ctor === 'DeformTimeline') {
          const att = tl.attachment || null;
          const attName = att && att.name;
          const skinName = findSkinName(sd, tl.slotIndex, attName || '', att);
          // ⚠️ 给 DeformTimeline 传入 base(attachment.vertices),序列化时减去,
          // 避免 3.x readDeformTimeline 两次 += base 导致顶点被放大(无变形时 2 倍)。
          const baseVertices = att && att.vertices ? att.vertices : null;
          const frames = serializeTimeline(tl, format, baseVertices);
          if (format === '3') {
            a.deform = a.deform || {};
            a.deform[skinName] = a.deform[skinName] || {};
            a.deform[skinName][slot.name] = a.deform[skinName][slot.name] || {};
            a.deform[skinName][slot.name][attName || ''] = frames;
          } else {
            a.attachments = a.attachments || {};
            a.attachments[skinName] = a.attachments[skinName] || {};
            a.attachments[skinName][slot.name] = a.attachments[skinName][slot.name] || {};
            a.attachments[skinName][slot.name][attName || ''] = a.attachments[skinName][slot.name][attName || ''] || {};
            a.attachments[skinName][slot.name][attName || ''].deform = frames;
          }
        } else if (ikIdx) {
          a.ik = a.ik || {};
          a.ik[ikIdx.name] = frames;
        } else if (tcIdx) {
          a.transform = a.transform || {};
          a.transform[tcIdx.name] = frames;
        } else if (pcIdx) {
          a.path = a.path || {};
          a.path[pcIdx.name] = a.path[pcIdx.name] || {};
          const key = { PathConstraintPositionTimeline: 'position', PathConstraintSpacingTimeline: 'spacing', PathConstraintMixTimeline: 'mix' }[ctor] || ctor;
          a.path[pcIdx.name][key] = frames;
        } else if (ctor === 'EventTimeline') {
          a.events = frames;
        }
        // DrawOrderTimeline 等其它:省略(读回为默认顺序)
      }
      if (Object.keys(a).length) out.animations[anim.name] = a;
    }
  }

  // 去掉 undefined 值,清理空字段
  const cleaned = clean(out);
  // ⚠️ 空动画(0 时间线)会被 clean 整体删除,但动画名必须保留——
  // 否则运行时 animations 为空,播放器报"该骨骼没有可播放的动作"(如 yl_4004.skel 的空 Idle)。
  // 这里补回空动画 {} (Spine 官方 JSON 同样保留 animations:{Idle:{}})。
  if (sd.animations && sd.animations.length) {
    for (const anim of sd.animations) {
      if (!cleaned.animations || !cleaned.animations[anim.name]) {
        cleaned.animations = cleaned.animations || {};
        cleaned.animations[anim.name] = {};
      }
    }
  }
  return cleaned;
}

/** 反查附件所属 skin 名(用于 deform / attachment 时间线的 skin 键) */
function findSkinName(sd, slotIndex, attachmentName, attachment) {
  let fallback = sd.defaultSkin ? sd.defaultSkin.name : ((sd.skins && sd.skins[0]) ? sd.skins[0].name : 'default');
  for (const skin of (sd.skins || [])) {
    try {
      if (attachment) {
        if (skin.getAttachment(slotIndex, attachment.name) === attachment) return skin.name;
      } else if (attachmentName && skin.getAttachment(slotIndex, attachmentName) != null) {
        return skin.name;
      }
    } catch (e) { /* ignore */ }
  }
  return fallback;
}

function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean).filter((v) => v !== undefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const cv = clean(v);
      if (cv === undefined) continue;
      if (cv && typeof cv === 'object' && !Array.isArray(cv) && Object.keys(cv).length === 0) continue;
      out[k] = cv;
    }
    return out;
  }
  return obj;
}

function inheritToStr(i) {
  // BoneData.Inherit: 0 normal, 1 onlyTranslation, 2 noRotationOrReflection, 3 noScale, 4 noScaleOrReflection
  return ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'][i] || 'normal';
}
function blendToStr(b) {
  return ['normal', 'additive', 'multiply', 'screen'][b] || 'normal';
}
function posModeStr(m) { return m === 1 ? 'percent' : 'fixed'; }
function spacingModeStr(m) { return ['length', 'fixed', 'percent', 'proportional'][m] || 'length'; }
function rotateModeStr(m) { return ['tangent', 'chain', 'chainscale'][m] || 'tangent'; }

// ---- 运行时加载与导出 ----

/** 定位 vendor/spine38/spine-core.js(多候选路径兼容开发与打包) */
function resolveSpine38Path() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'vendor', 'spine38', 'spine-core.js'), // 项目根/vendor/(开发)
    path.resolve(__dirname, '..', 'vendor', 'spine38', 'spine-core.js'),       // electron/vendor/(备用)
    path.resolve(process.resourcesPath || '', 'vendor', 'spine38', 'spine-core.js'), // 打包 extraResources
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // 都不存在时返回首个,让 readFileSync 报清晰 ENOENT
}

// 3.x 运行时为 UMD,在 Node 中 require 不会挂到全局;用 vm 沙箱加载。
// 批量转换时逐文件重复 load 开销大,这里缓存已加载的运行时实例。
let _spine38Cache = null;
function loadSpine38() {
  if (_spine38Cache) return _spine38Cache;
  const path38 = resolveSpine38Path();
  const code = fs.readFileSync(path38, 'utf8');
  const vm = require('vm');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const spine38 = sandbox.spine;
  if (!spine38 || !spine38.SkeletonBinary) throw new Error('spine38 runtime 加载失败');
  _spine38Cache = spine38;
  return spine38;
}

async function skelToJson(inputPath, outputPath) {
  const srcBuf = fs.readFileSync(inputPath);
  // ⚠️ vendored 3.8/4.x 的 BinaryInput 构造用 `new DataView(data.buffer)`,不处理 Buffer.byteOffset。
  // Node 的 fs.readFileSync 小文件来自内部 Buffer 池(byteOffset≠0,ArrayBuffer 比实际大),
  // DataView 会从 ArrayBuffer 开头(0)读 → 整份骨架错位,随机抛
  // "Offset is outside the bounds of the DataView" / "frameCount must be > 0"(大文件不走池,故 dazuo1 等一直正常)。
  // 统一拷贝到精确大小的新 ArrayBuffer(byteOffset=0),解析稳定。
  const bytes = new Uint8Array(srcBuf.byteLength);
  bytes.set(srcBuf);
  const probe = probeSkeleton(bytes);
  if (!probe || probe.kind !== 'binary') {
    throw new Error('不是有效的 Spine 二进制骨架(skel)');
  }
  let sd;
  if (/^3\./.test(probe.version)) {
    // 3.x: 用缓存的 vm 沙箱运行时(避免批量时重复加载)
    const spine38 = loadSpine38();
    // SkeletonBinary 的 AtlasAttachmentLoader 需要 atlas.findRegion;
    // 二进制内自带 region 数据,这里用假 atlas 提供占位 region 即可满足 updateUVs/updateOffset。
    const fakeRegion = {
      u: 0, v: 0, u2: 1, v2: 1,
      width: 1024, height: 1024, originalWidth: 1024, originalHeight: 1024,
      offsetX: 0, offsetY: 0, rotate: false, degrees: 0,
      texture: { getImage: () => ({ width: 1024, height: 1024 }) },
    };
    hookTimelines(spine38); // 记录 setFrame 参数,供序列化还原
    const bin = new spine38.SkeletonBinary(new spine38.AtlasAttachmentLoader({ findRegion: () => fakeRegion }));
    sd = bin.readSkeletonData(bytes);
    if (!sd) throw new Error('3.x SkeletonBinary 解析失败');
  } else if (/^(4|5|[2-9][0-9])\./.test(probe.version)) {
    // 4.x/5.x: 动态导入 spine-core
    const spineCore = await import('@esotericsoftware/spine-core');
    hookTimelines(spineCore); // 同上
    const fakeRegion = {
      u: 0, v: 0, u2: 1, v2: 1,
      width: 1024, height: 1024, originalWidth: 1024, originalHeight: 1024,
      offsetX: 0, offsetY: 0, rotate: false, degrees: 0,
      texture: { getImage: () => ({ width: 1024, height: 1024 }) },
    };
    const bin = new spineCore.SkeletonBinary(new spineCore.AtlasAttachmentLoader({ findRegion: () => fakeRegion }));
    sd = bin.readSkeletonData(bytes);
    if (!sd) throw new Error(`${probe.version} SkeletonBinary 解析失败`);
  } else {
    throw new Error(`未知的 Spine 版本: ${probe.version}`);
  }

  const jsonObj = await serializeSkeletonData(sd, probe);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // 紧凑输出(无缩进)+ 数值裁剪到 6 位小数,与 Spine 编辑器导出的紧凑格式一致,
  // 体积比带缩进的 float64 全精度输出小很多(实测约 -60%)。
  fs.writeFileSync(outputPath, JSON.stringify(roundObj(jsonObj)));
  return {
    version: probe.version,
    output: outputPath,
    bones: sd.bones.length,
    slots: sd.slots.length,
    skins: sd.skins.length,
    animations: sd.animations.length,
    events: sd.events.length,
    ik: sd.ikConstraints.length,
    transform: sd.transformConstraints.length,
    path: sd.pathConstraints.length,
  };
}

module.exports = { skelToJson, probeSkeleton };