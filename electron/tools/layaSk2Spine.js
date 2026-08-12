'use strict';
// LayaAir 骨骼动画(.sk,LayaAir 1.7.x / DragonBones 导出)→ Spine 可读文件(.json 骨架 + .atlas 纹理图集)逆向转换器。
//
// 原理:本模块是 LayaSpineLoader 中 `getObjectBuffer(obj)`(Spine→.sk 的正向序列化)的逆向实现。
// 我们按 .sk 二进制的“写入顺序”逐字段回读,还原出骨架结构(纹理图集、骨骼、插槽、皮肤、约束、动画关键帧),
// 再以 Spine 运行时兼容的 JSON / atlas 文本形式写出。
//
// .sk 文件三段式:
//   头部(AnimationParser01.parse): version / aniClassName / 名称表 / 动画计数 / publicDataPos / publicExtDataPos / useParent
//   主体段 A [publicDataPos → publicExtDataPos]:各骨骼动画节点的关键帧浮点数据(含关键帧宽度与插值方式表)
//   主体段 C [publicExtDataPos → end]:骨骼/插槽/蒙皮/约束/动画元数据(即 extenData)
//
// 段 C 的读取顺序与 `getObjectBuffer` 的写入顺序严格对应(见各小节注释)。

const fs = require('fs');

// ---------------- 二进制读取器(小端) ----------------
class ByteReader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos; }
  u8() { return this.buf[this.pos++]; }
  i8() { const v = this.buf[this.pos++]; return v >= 128 ? v - 256 : v; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  i16() { const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i32() { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  f32() { const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  // Laya writeUTFString = u16(字节数) + UTF-8 字节;readUTFString 对应回读
  utf() {
    const n = this.u16();
    const s = this.buf.toString('utf8', this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  skip(n) { this.pos += n; }
  remaining() { return this.buf.length - this.pos; }
}

  // 读取一个 SkinSlotDisplay(严格对应 getObjectBuffer 的写入顺序:8 个 f32 变换 / width / height /
  // type(u8) / vertexLen(u16) / bonePoseLength(u16)+bonePose(u16) / uvs / weights / triangles / vertices / lengths)
  //
  // 实测关键事实(hedao.sk 非蒙皮 / chibang.sk 蒙皮 两份真实导出):
  //   - 字段物理顺序固定为  uvs(f32) → weights(f32) → triangles(u16) → vertices(f32) → lengths(f32)
  //   - 真实 Laya 导出里 `vertices` 段恒为 0(空),真正的数据都在 `weights` 段:
  //       · 非蒙皮(type=1 且 bonePose 为空):weights = [x,y] 每顶点 = 顶点本地坐标
  //       · 蒙皮(type=1 且 bonePose 非空):weights = [x',y',w] 每(顶点,骨骼) = 相对各骨骼逆绑定姿态的偏移 + 权重
  //   - 因此输出时:非蒙皮网格取 disp.vertices||disp.weights 作为顶点坐标;蒙皮网格只用 disp.weights(boneIdx 作骨骼索引)。
  // 读取一个 SkinSlotDisplay(严格对应 getObjectBuffer 的写入顺序:8 个 f32 变换 / width / height /
  // type(u8) / vertexLen(u16) / bonePoseLength(u16)+bonePose(u16) / uvs / weights / triangles / vertices / lengths)
  //
  // 实测关键事实(hedao.sk 非蒙皮 / chibang.sk 蒙皮 两份真实导出):
  //   - 字段物理顺序固定为  uvs(f32) → weights(f32) → triangles(u16) → vertices(f32) → lengths(f32)
  //   - 真实 Laya 导出里 `vertices` 段恒为 0(空),真正的数据都在 `weights` 段:
  //       · 非蒙皮(type=1 且 bonePose 为空):weights = [x,y] 每顶点 = 顶点本地坐标
  //       · 蒙皮(type=1 且 bonePose 非空):weights = [x',y',w] 每(顶点,骨骼) = 相对各骨骼逆绑定姿态的偏移 + 权重
  //   - 因此输出时:非蒙皮网格取 disp.vertices||disp.weights 作为顶点坐标;蒙皮网格只用 disp.weights(boneIdx 作骨骼索引)。
  //
  // 变体(_newspine_unlimit_,nanhai01/02、nvhai01)的 display 二进制并非"统一带/不带"前缀:
  // 实测皮肤段首个 display(插槽#0)前多 1 字节(=1),其余 display 不带。无法用单一标志推断,
  // 故逐 display 试 prefix∈{0,1},保留"变换与字段计数 sane(真实精灵尺寸、缩放≈1、type 合法)"的版本,
  // 再按"缩放/偏置更规整、尺寸非极小"打分取最优,从而兼容两类布局且输出正确。
  function readSkinDisplay(pe, nameArray, nameIdxRef, dispPrefixHint) {
    const displayName = nameArray[nameIdxRef.v++] || 'display';
    const attachmentName = nameArray[nameIdxRef.v++] || displayName;
    const candidates = (dispPrefixHint === 1) ? [1, 0] : [0, 1];
    let best = null; // { p, r, score }
    for (const p of candidates) {
      const sub = new ByteReader(pe.buf, pe.pos);
      const r = tryDecodeDisplay(sub, p);
      if (!r) continue;
      const d = r.disp;
      // 两前缀都 sane 时取更优:缩放≈1、无偏置、尺寸非极小(极小尺寸多为错位)
      let score = Math.abs(d.transform.scX - 1) + Math.abs(d.transform.scY - 1)
        + Math.abs(d.transform.skX) + Math.abs(d.transform.skY);
      if (d.width < 2 || d.height < 2) score += 1000;
      if (!best || score < best.score) best = { p, r, score };
    }
    if (!best) {
      // 两种 prefix 都无法得到 sane 解码(异常/截断文件):按 hint 或 0 强制解码(越界时返回部分数据)
      const sub = new ByteReader(pe.buf, pe.pos);
      const fr = forceDecodeDisplay(sub, dispPrefixHint || 0);
      best = { p: dispPrefixHint || 0, r: fr, score: 0 };
    }
    pe.pos = best.r.endPos;
    // 兜底:强制解码仍越界(数据截断)时,返回一个最小占位 display,避免上层解引用崩溃
    if (!best.r.disp) {
      const placeholder = { transform: { scX: 1, skX: 0, skY: 0, scY: 1, x: 0, y: 0 }, width: 0, height: 0, type: 0, boneIdx: [], uvs: [], weights: [], triangles: [], vertices: [], lengths: [] };
      placeholder.name = displayName; placeholder.attachmentName = attachmentName;
      return placeholder;
    }
    best.r.disp.name = displayName;
    best.r.disp.attachmentName = attachmentName;
    return best.r.disp;
  }

  // 试以 prefix 字节数(p=0 或 1)解码一个 display;解码越界或字段计数/变换明显不合理时返回 null。
  function tryDecodeDisplay(pe, prefix) {
    const start = pe.pos;
    // 先行边界检查:剩余字节不足以容纳最小头部(8*f32 + u8 + 2*u16)则直接放弃
    if (pe.remaining() < 32 + 1 + 2 + 2) return null;
    if (prefix) { if (pe.remaining() < prefix) return null; pe.skip(prefix); }
    try {
      const scX = pe.f32(), skX = pe.f32(), skY = pe.f32(), scY = pe.f32();
      const x = pe.f32(), y = pe.f32();
      const width = pe.f32(), height = pe.f32();
      const type = pe.u8();
      const verLen = pe.u16();
      const boneLen2 = pe.u16();
      if (pe.remaining() < boneLen2 * 2) return null;
      const boneIdx = [];
      for (let l = 0; l < boneLen2; l++) boneIdx.push(pe.u16());
      const uvLen = pe.u16();
      if (pe.remaining() < uvLen * 4) return null;
      const uvs = [];
      for (let l = 0; l < uvLen; l++) uvs.push(pe.f32());
      const weightLen = pe.u16();
      if (pe.remaining() < weightLen * 4) return null;
      const weights = [];
      for (let l = 0; l < weightLen; l++) weights.push(pe.f32());
      const triangleLen = pe.u16();
      if (pe.remaining() < triangleLen * 2) return null;
      const triangles = [];
      for (let l = 0; l < triangleLen; l++) triangles.push(pe.u16());
      const verticeLen = pe.u16();
      if (pe.remaining() < verticeLen * 4) return null;
      const vertices = [];
      for (let l = 0; l < verticeLen; l++) vertices.push(pe.f32());
      const lengthLen = pe.u16();
      if (pe.remaining() < lengthLen * 4) return null;
      const lengths = [];
      for (let l = 0; l < lengthLen; l++) lengths.push(pe.f32());
      const ok = (type === 0 || type === 1)
        && boneLen2 <= 2048 && uvLen <= 65536 && weightLen <= 65536
        && triangleLen <= 65536 && verticeLen <= 65536 && lengthLen <= 65536
        && saneScale(scX) && saneScale(scY)
        && width >= 0 && width <= 8192 && height >= 0 && height <= 8192
        && Math.abs(x) < 1e6 && Math.abs(y) < 1e6;
      if (!ok) return null;
      return {
        disp: { transform: { scX, skX, skY, scY, x, y }, width, height, type, boneIdx, uvs, weights, triangles, vertices, lengths },
        endPos: pe.pos, ok: true,
      };
    } catch (e) { return null; }
  }

  // 异常兜底:不校验合理性,直接按 prefix 解码到底;越界时返回已解码部分(不抛错)
  function forceDecodeDisplay(pe, prefix) {
    if (prefix) { if (pe.remaining() < prefix) return { disp: null, endPos: pe.pos, ok: false }; pe.skip(prefix); }
    const need = (n) => pe.remaining() >= n;
    const scX = need(4) ? pe.f32() : 0, skX = need(4) ? pe.f32() : 0, skY = need(4) ? pe.f32() : 0, scY = need(4) ? pe.f32() : 0;
    const x = need(4) ? pe.f32() : 0, y = need(4) ? pe.f32() : 0;
    const width = need(4) ? pe.f32() : 0, height = need(4) ? pe.f32() : 0;
    const type = need(1) ? pe.u8() : 0;
    const verLen = need(2) ? pe.u16() : 0;
    const boneLen2 = need(2) ? pe.u16() : 0;
    const boneIdx = [];
    for (let l = 0; l < boneLen2 && need(2); l++) boneIdx.push(pe.u16());
    const uvLen = need(2) ? pe.u16() : 0;
    const uvs = [];
    for (let l = 0; l < uvLen && need(4); l++) uvs.push(pe.f32());
    const weightLen = need(2) ? pe.u16() : 0;
    const weights = [];
    for (let l = 0; l < weightLen && need(4); l++) weights.push(pe.f32());
    const triangleLen = need(2) ? pe.u16() : 0;
    const triangles = [];
    for (let l = 0; l < triangleLen && need(2); l++) triangles.push(pe.u16());
    const verticeLen = need(2) ? pe.u16() : 0;
    const vertices = [];
    for (let l = 0; l < verticeLen && need(4); l++) vertices.push(pe.f32());
    const lengthLen = need(2) ? pe.u16() : 0;
    const lengths = [];
    for (let l = 0; l < lengthLen && need(4); l++) lengths.push(pe.f32());
    return {
      disp: { transform: { scX, skX, skY, scY, x, y }, width, height, type, boneIdx, uvs, weights, triangles, vertices, lengths },
      endPos: pe.pos, ok: true,
    };
  }

  function saneScale(v) { return v === 0 || (v >= 0.0001 && v <= 1000); }

// ---------------- 段 A 读取(兼容两种布局) ----------------
// 标准布局(多数 .sk,如 chibang/hedao): 每个动画 = nameIdx(u16) | playTime(f32) | boneCount(u8) | [节点头...]
//   节点头 = nodeNameIdx(i16) | parentIndex(i16) | lerpType(u8) | kfParamsOffset(u32) |
//     privateDataLen(u16) | keyframeCount(u16)   —— 共 13 字节
// 变体布局(部分导出器,如 _newspine_unlimit_ 的 nanhai01/02、nvhai01): 在“每个动画的 boneCount 之后、
//   节点列表之前”多写入 1 个字节(动画级标志),节点头本身与标准布局完全一致。
// 关键帧浮点数据顺序(对应 getObjectBuffer 写入): 每个节点 header 之后紧跟
//   [keyframeCount 个关键帧],每个关键帧 = dur(f32) | (lerp==2 ? interLen(u8)+interp f32* : ) | data f32*keyframeWidth。
// 段 A 整体终止于 publicDataPos(段 C 起点),故可用“解析后 r.pos 是否正好落在 publicDataPos”
// 来自动判定采用哪种布局,从而兼容两类文件、避免 offset out of range。
function readSegmentA(buf, startPos, publicData, strList, aniCount, extraByte) {
  const r = new ByteReader(buf, startPos);
  const animations = [];
  for (let ai = 0; ai < aniCount; ai++) {
    const nameIdx = r.u16();
    const name = strList[nameIdx];
    const playTime = r.f32();              // 毫秒
    const boneCount = r.u8();              // 动画节点数(骨骼变换 + 插槽/图片节点)
    if (extraByte) r.skip(1);             // 变体布局:跳过每个动画节点列表前的额外字节
    const nodes = [];
    for (let bi = 0; bi < boneCount; bi++) {
      const nodeNameIdx = r.i16();
      const nodeName = nodeNameIdx >= 0 ? strList[nodeNameIdx] : null;
      const parentIndex = r.i16();
      const lerpType = r.u8();             // 0=线性 1=阶梯 2=私有(逐帧)
      const kfParamsOffset = r.u32();      // 相对 publicData 起点
      const pr = new ByteReader(publicData, kfParamsOffset);
      const keyframeWidth = pr.u16();      // 每个关键帧的浮点分量数
      const interp = [];
      if (lerpType === 0 || lerpType === 1) {
        for (let k = 0; k < keyframeWidth; k++) interp.push(pr.u8());
      }
      const privateDataLen = r.u16();
      if (privateDataLen > 0) r.pos += privateDataLen;
      const keyframeCount = r.u16();
      const keyframes = [];
      for (let ki = 0; ki < keyframeCount; ki++) {
        const dur = r.f32();
        let inter = null;
        if (lerpType === 2) {
          const interLen = r.u8();
          const marker = r.f32();          // 254=线性 255=阶梯 其它=曲线控制点
          inter = [marker];
          if (marker !== 254 && marker !== 255) {
            for (let m = 1; m < interLen; m++) inter.push(r.f32());
          }
        }
        const data = [];
        for (let d = 0; d < keyframeWidth; d++) data.push(r.f32());
        keyframes.push({ duration: dur, interp: inter, data });
      }
      nodes.push({
        name: nodeName, parentIndex, lerpType, keyframeWidth,
        interpMethods: interp, keyframeCount, keyframes,
      });
    }
    animations.push({ nameIdx, name, playTimeMs: playTime, boneCount, nodes });
  }
  return { animations, endPos: r.pos };
}

// ---------------- 皮肤段读取(兼容 slotDataLen / displayDataLen 两种计数宽度各自 u8 / u16) ----------------
// 名称在 nameStr 中以 \n 串接;控制计数顺序 skinDataLen(u8), [slotDataLen, [displayDataLen, ...displayData]]。
// 实测两类文件计数宽度不对称:
//   · 标准(多数 .sk,如 chibang/hedao):slotDataLen=displayDataLen=u8;
//   · _newspine_unlimit_ 变体(nanhai/nvhai):slotDataLen=u8,但 displayDataLen=u16
//     (首个 display 前的 `01` 字节实为 displayDataLen 的高字节,故 u16 变体的逐 display 前缀为 0)。
// 故同时自动探测两种宽度,选能正好解析到段 C 末尾的组合。
// slotCountWidth/dispCountWidth:1=u8,2=u16。dispPrefixHint:逐 display 前缀探测提示(见 readSkinDisplay)。
function readSkinSection(pe, nameArray, nameIdxRef, slotCountWidth, dispCountWidth, dispPrefixHint) {
  const readSlotCount = slotCountWidth === 2 ? () => pe.u16() : () => pe.u8();
  const readDispCount = dispCountWidth === 2 ? () => pe.u16() : () => pe.u8();
  const skins = [];
  const deferredSlots = [];
  const skinDataLen = pe.u8();
  for (let i = 0; i < skinDataLen; i++) {
    const skinName = nameArray[nameIdxRef.v++];
    const slotDataLen = readSlotCount();
    const slots = [];
    for (let j = 0; j < slotDataLen; j++) {
      const slotName = nameArray[nameIdxRef.v++];
      const displayDataLen = readDispCount();
      const displays = [];
      for (let k = 0; k < displayDataLen; k++) displays.push(readSkinDisplay(pe, nameArray, nameIdxRef, dispPrefixHint));
      const slotObj = { name: slotName, displays };
      // displayDataLen===0 的插槽,其 display 二进制可能在皮肤段尾部单独补写(容错,见段尾延迟循环)
      if (displayDataLen === 0) deferredSlots.push(slotObj);
      slots.push(slotObj);
    }
    skins.push({ name: skinName, slots });
  }
  // 延迟写入的 display:displayDataLen===0 的插槽,其 display 二进制补写在段尾;
  // 前缀约定与常规 display 一致(dispPrefixHint),一旦越界立即回退,避免误读崩溃。
  let deferredPos = 0;
  while (pe.remaining() > 2 && deferredPos < deferredSlots.length) {
    const before = pe.pos;
    try {
      const disp = readSkinDisplay(pe, nameArray, nameIdxRef, dispPrefixHint);
      deferredSlots[deferredPos].displays.push(disp);
      deferredPos++;
    } catch (e) { pe.pos = before; break; }
  }
  let tailFlag = null;
  if (pe.remaining() >= 1) tailFlag = pe.u8();
  return { skins, tailFlag, endPos: pe.pos };
}

// Laya 写父级名时,根骨骼/无父级会写成字面串 "null"(个别导出器写 "undefined" 或空串)。
// 统一归一化为 null,避免生成 "parent":"null" 这种指向不存在骨骼的非法 Spine JSON。
function normalizeParent(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === '' || t === 'null' || t === 'undefined' || t === 'NULL') return null;
  return t;
}

// ---------------- 解析 .sk ----------------
function parseSk(buffer, readAudio) {
  const r = new ByteReader(buffer);

  // ---- 头部(AnimationParser01.parse) ----
  const version = r.utf();                 // 例如 "LAYAANIMATION:1.7.0"
  const aniClassName = r.utf();            // "DragonBone" / "Dragon"
  const strList = r.utf().split('\n').filter((s) => s.length > 0);
  const aniCount = r.u8();
  const publicDataPos = r.u32();
  const publicExtDataPos = r.u32();
  const useParent = r.u8();

  const publicData = buffer.slice(publicDataPos, publicExtDataPos);
  const publicExtData = buffer.slice(publicExtDataPos);

  // ---- 段 A:动画关键帧(AnimationParser01) ----
  // 不同 LayaAir 导出器在“节点头”里可能多写 1 个字节(实测 _newspine_unlimit_ 的
  // nanhai01/02、nvhai01 带此字节,chibang/hedao 不带;该字节位于 nodeNameIdx(i16) 与
  // parentIndex(i16) 之间)。以“段 A 解析后是否正好停在 publicDataPos”自动判定布局,
  // 兼容两类文件,避免 offset out of range。
  const segAStart = r.pos;
  const candidates = [];
  for (const extraByte of [false, true]) {
    try {
      candidates.push({ extraByte, res: readSegmentA(buffer, segAStart, publicData, strList, aniCount, extraByte) });
    } catch (e) { /* 越界 => 此布局不对,尝试另一种 */ }
  }
  let segAChosen, segAExtraByte = false;
  const exact = candidates.filter((c) => c.res.endPos === publicDataPos);
  if (exact.length) {
    const pick = (exact.find((c) => c.extraByte === false) || exact[0]);
    segAChosen = pick.res; segAExtraByte = pick.extraByte;
  } else if (candidates.length) {
    candidates.sort((a, b) => Math.abs(a.res.endPos - publicDataPos) - Math.abs(b.res.endPos - publicDataPos));
    segAChosen = candidates[0].res; segAExtraByte = candidates[0].extraByte;
  } else {
    // 极小概率:两种布局都越界,强制按标准布局重试(抛错由上层捕获)
    segAChosen = readSegmentA(buffer, segAStart, publicData, strList, aniCount, false);
    segAExtraByte = false;
  }
  // 段 A 的变体标志(每动画多 1 字节)与段 C 的"每个常规 display 前多 1 字节前缀"同属 _newspine_unlimit_ 变体,
  // 二者绑定:isVariant=true 时常规 display 需跳过 1 字节前缀。
  const isVariant = segAExtraByte;
  const animations = segAChosen.animations;

  // ---- 段 C:骨架定义(_parsePublicExtData,严格对应 getObjectBuffer 写入顺序) ----
  const pe = new ByteReader(publicExtData);
  pe._readAudio = !!readAudio;

  // 1) 纹理图集信息
  const texLen = pe.i32();
  const texNameStr = pe.utf();
  const texNames = texNameStr.split('\n');
  const textures = [];
  for (let i = 0; i < texLen; i++) {
    const textureSrc = texNames[i * 2] || '';
    const regionName = texNames[i * 2 + 1] || '';
    const x = pe.f32(), y = pe.f32(), w = pe.f32(), h = pe.f32();
    const frameX = pe.f32(), frameY = pe.f32(), frameW = pe.f32(), frameH = pe.f32();
    textures.push({
      textureSrc, regionName, x, y, w, h,
      frameX: isNaN(frameX) ? 0 : frameX, frameY: isNaN(frameY) ? 0 : frameY,
      frameW: isNaN(frameW) ? w : frameW, frameH: isNaN(frameH) ? h : frameH,
    });
  }

  // 2) 动画分区(legacy,通常为每动画 [boneLen, slotLen, ikLen, pathLen])
  const aniSectionCount = pe.u16();
  const aniSections = [];
  for (let i = 0; i < aniSectionCount; i++) {
    aniSections.push([pe.u16(), pe.u16(), pe.u16(), pe.u16()]);
  }
  // 3) 骨骼
  const boneLen = pe.i16();
  const bones = [];
  for (let i = 0; i < boneLen; i++) {
    const name = pe.utf();
    const parent = pe.utf();
    const length = pe.f32();
    const inhRot = pe.i8();
    const inhScale = pe.i8();
    bones.push({
      // Laya 对根骨骼把父级名写成字面串 "null"(而非空串),需归一化为 null,
      // 否则 Spine JSON 会出现 "parent":"null" 指向不存在的骨骼,导入即报错。
      name, parent: normalizeParent(parent), length,
      inheritRotation: inhRot !== 1, inheritScale: inhScale !== 1,
    });
  }
  // 4) 骨骼绑定姿态矩阵(每骨骼 scX,skX,skY,scY,x,y[,skewX,skewY])
  const matrixDataLen = pe.u16();
  const tLen = pe.u16();
  const perBone = boneLen ? tLen / boneLen : 6;
  const bindTransforms = [];
  for (let i = 0; i < boneLen; i++) {
    const scX = pe.f32(), skX = pe.f32(), skY = pe.f32(), scY = pe.f32();
    const x = pe.f32(), y = pe.f32();
    let skewX = 0, skewY = 0;
    if (matrixDataLen === 8 || perBone >= 8) { skewX = pe.f32(); skewY = pe.f32(); }
    bindTransforms.push({ scX, skX, skY, scY, x, y, skewX, skewY });
  }
  // 5) IK 约束
  const ikLen = pe.u16();
  const ikConstraints = [];
  for (let i = 0; i < ikLen; i++) {
    const boneCount = pe.u16();
    const boneNames = [], boneIndexs = [];
    for (let j = 0; j < boneCount; j++) { boneNames.push(pe.utf()); boneIndexs.push(pe.i16()); }
    const name = pe.utf(), targetBoneName = pe.utf(), targetBoneIndex = pe.i16();
    const bendDirection = pe.f32(), mix = pe.f32();
    ikConstraints.push({ name, boneNames, targetBoneName, bendDirection, mix });
  }
  // 6) 变换约束
  const tfLen = pe.u16();
  const transformConstraints = [];
  for (let i = 0; i < tfLen; i++) {
    const boneCount = pe.u16();
    const boneIndexs = [];
    for (let j = 0; j < boneCount; j++) boneIndexs.push(pe.i16());
    const name = pe.utf(), target = pe.i16();
    const rotateMix = pe.f32(), translateMix = pe.f32(), scaleMix = pe.f32(), shearMix = pe.f32();
    const offsetRotation = pe.f32(), offsetX = pe.f32(), offsetY = pe.f32();
    const offsetScaleX = pe.f32(), offsetScaleY = pe.f32(), offsetShearY = pe.f32();
    transformConstraints.push({
      name, boneIndexs, target, rotateMix, translateMix, scaleMix, shearMix,
      offsetRotation, offsetX, offsetY,       offsetScaleX, offsetScaleY, offsetShearY,
    });
  }
  // 7) 路径约束
  const pathLen = pe.u16();
  const pathConstraints = [];
  for (let i = 0; i < pathLen; i++) {
    const name = pe.utf();
    const boneCount = pe.u16();
    const bonesIdx = [];
    for (let j = 0; j < boneCount; j++) bonesIdx.push(pe.i16());
    const target = pe.utf();
    const positionMode = pe.utf(), spacingMode = pe.utf(), rotateMode = pe.utf();
    const offsetRotation = pe.f32(), position = pe.f32(), spacing = pe.f32();
    const rotateMix = pe.f32(), translateMix = pe.f32();
    pathConstraints.push({
      name, bonesIdx, target, positionMode, spacingMode, rotateMode,
      offsetRotation, position, spacing, rotateMix, translateMix,
    });
  }
  // 8) 形变动画(蒙皮)
  const deformAniLen = pe.i16();
  const deformAniData = [];
  for (let i = 0; i < deformAniLen; i++) {
    const skinLen = pe.u8();
    const skins = [];
    for (let f = 0; f < skinLen; f++) {
      const skinName = pe.utf();
      const slotLen = pe.i16();
      const slots = [];
      for (let j = 0; j < slotLen; j++) {
        const displayLen = pe.i16();
        const displays = [];
        for (let k = 0; k < displayLen; k++) {
          const slotIndex = pe.i16();
          const attachment = pe.utf();
          const timeLen = pe.i16();
          const times = [];
          for (let l = 0; l < timeLen; l++) {
            const tween = pe.u8();
            const time = pe.f32();
            const vLen = pe.i16();
            const verts = [];
            for (let n = 0; n < vLen; n++) verts.push(pe.f32());
            times.push({ tween: tween === 1, time, verts });
          }
          displays.push({ slotIndex, attachment, times });
        }
        slots.push(displays);
      }
      skins.push({ skinName, slots });
    }
    deformAniData.push(skins);
  }

  // 9) 绘制顺序动画
  const drawOrderAniLen = pe.i16();
  const drawOrderAniData = [];
  for (let i = 0; i < drawOrderAniLen; i++) {
    const orderLen = pe.i16();
    const orders = [];
    for (let j = 0; j < orderLen; j++) {
      const time = pe.f32();
      const arrLen = pe.i16();
      const orderArr = [];
      for (let k = 0; k < arrLen; k++) orderArr.push(pe.i16());
      orders.push({ time, orderArr });
    }
    drawOrderAniData.push(orders);
  }

  // 10) 事件动画(_isParseAudio 为真时会多读一个 audioValue 字符串)
  const eventAniLen = pe.i16();
  const eventAniData = [];
  for (let i = 0; i < eventAniLen; i++) {
    const eventLen = pe.i16();
    const events = [];
    for (let j = 0; j < eventLen; j++) {
      const name = pe.utf();
      if (pe._readAudio) pe.utf();
      const intValue = pe.i32();
      const floatValue = pe.f32();
      const stringValue = pe.utf();
      const time = pe.f32();
      events.push({ name, intValue, floatValue, stringValue, time });
    }
    eventAniData.push(events);
  }

  // 11) 附件名列表
  const attachmentLen = pe.i16();
  const attachmentNames = [];
  for (let i = 0; i < attachmentLen; i++) attachmentNames.push(pe.utf());

  // 12) 骨骼插槽(BoneSlot)→ 决定 slot 与 bone 的绑定
  const boneSlotLen = pe.i16();
  const boneSlots = [];
  for (let i = 0; i < boneSlotLen; i++) {
    const name = pe.utf();
    const parent = pe.utf();
    const attachmentName = pe.utf();
    const displayIndex = pe.i16();
    boneSlots.push({ name, parent: normalizeParent(parent), attachmentName, displayIndex });
  }

  // 13) 皮肤(名称在 nameStr 中以 \n 串接;随后是每个皮肤的 slot/display)
  // 名称写入顺序与 getObjectBuffer 一致:skinName + 每个 slot 的 slotName + 每个 display 的 displayName/attachmentName。
  // 控制计数顺序:skinDataLen(u8), [slotDataLen, [displayDataLen, ...displayData]]。
  // skinDataLen 恒为 u8(两类文件均为 1);slotDataLen/displayDataLen 的宽度随导出器不同(u8 标准 / u16 变体),
  // 故自动探测:哪个宽度能让皮肤段正好解析到段 C 末尾,就用哪个。
  const nameStr = pe.utf();
  const nameArray = nameStr.split('\n');
  const skinStartAbs = publicExtDataPos + pe.pos; // 皮肤段计数(名称串之后)的绝对起始
  const publicExtEnd = publicExtDataPos + publicExtData.length;
  // 自动探测 slotDataLen / displayDataLen 的计数宽度组合:
  //   (1,1) 标准 u8/u8(chibang/hedao)
  //   (1,2) slot=u8, display=u16(_newspine_unlimit_ 的 nanhai/nvhai)
  //   (2,1)/(2,2) 其它变体兜底
  // 逐 display 前缀:display 为 u8 时沿用 isVariant 探测;display 为 u16 时强制无前缀(高字节已并入计数)。
  const combos = [
    { s: 1, d: 1, pref: isVariant },
    { s: 1, d: 2, pref: 0 },
    { s: 2, d: 1, pref: isVariant },
    { s: 2, d: 2, pref: 0 },
  ];
  let skinResult = null;
  for (const c of combos) {
    const sub = new ByteReader(buffer, skinStartAbs);
    const nir = { v: 0 };
    let r;
    try {
      r = readSkinSection(sub, nameArray, nir, c.s, c.d, c.pref);
    } catch (e) {
      continue;
    }
    if (r.endPos === publicExtEnd) { skinResult = { r, c }; break; }
    if (!skinResult || Math.abs(r.endPos - publicExtEnd) < Math.abs(skinResult.r.endPos - publicExtEnd)) skinResult = { r, c };
  }
  const skins = skinResult.r.skins;
  const tailFlag = skinResult.r.tailFlag;
  return {
    version, aniClassName, useParent, strList,
    publicDataPos, publicExtDataPos,
    textures, aniSections, bones, bindTransforms,
    ikConstraints, transformConstraints, pathConstraints,
    deformAniData, drawOrderAniData, eventAniData,
    attachmentNames, boneSlots, skins, tailFlag,
    animations,
    // 皮肤段已在独立的 sub 读取器中解析,pe.pos 仅停留在 nameStr 之后;
    // 用皮肤段结束的绝对位置换算回 publicExtData 内的相对偏移,供对齐校验。
    _parseEnd: (skinResult.r.endPos - publicExtDataPos), _parseLen: publicExtData.length,
  };
}

// 由于事件段是否含 audioValue 取决于生成版本,做二次尝试:
// 先按“无 audioValue”解析;若未对齐段 C 末尾,再按“有 audioValue”重试一次。
function parseSkRobust(buffer) {
  const m1 = parseSk(buffer, false);
  if (m1._parseEnd === m1._parseLen) return { model: m1, audio: false };
  const m2 = parseSk(buffer, true);
  if (m2._parseEnd === m2._parseLen) return { model: m2, audio: true };
  m1._warn = `段C解析未完全对齐(已读 ${m1._parseEnd} / 共 ${m1._parseLen} 字节),输出可能不完整`;
  return { model: m1, audio: false };
}

// ---------------- 探测 ----------------
function probeLayaSk(buffer) {
  if (!buffer || buffer.length < 16) return { ok: false, reason: '文件过小,非 .sk 格式' };
  const len = buffer.readUInt16LE(0);
  if (len <= 0 || len > 64 || len + 2 > buffer.length) return { ok: false, reason: '头部长度字段异常,非 .sk 格式' };
  let ver = '';
  try { ver = buffer.toString('utf8', 2, 2 + len); } catch (e) { return { ok: false, reason: '编码异常' }; }
  if (!/^LAYAANIMATION/i.test(ver)) return { ok: false, reason: `非 LayaAir .sk(头部为 "${ver}")` };
  return { ok: true, version: ver };
}

// ---------------- 工具:把 Laya 变换分解为 Spine 骨骼/附件变换 ----------------
// Laya getMatrix:若 skX!=0||skY!=0: a=scX*cos, b=scX*sin, c=-scY*sin, d=scY*cos; 否则 a=scX,b=skX,c=skY,d=scY
function layaMatrixToSpine(scX, skX, skY, scY, x, y) {
  let a, b, c, d;
  if (skX !== 0 || skY !== 0) {
    const ang = (skX * Math.PI) / 180;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    a = scX * cosA; b = scX * sinA; c = -scY * sinA; d = scY * cosA;
  } else {
    a = scX; b = skX; c = skY; d = scY;
  }
  const scaleX = Math.sqrt(a * a + c * c);
  const scaleY = Math.sqrt(b * b + d * d);
  const rotation = Math.atan2(c, a) * 180 / Math.PI;
  let sx = scaleX, sy = scaleY;
  if (a * d - b * c < 0) sx = -sx;
  return { x, y, rotation, scaleX: sx, scaleY: sy, shearX: 0, shearY: 0 };
}

// ---------------- 生成 .atlas 文本 ----------------
// 关键修复:Laya 的 mesh/region 附件 uv 已归一化到整张贴图页(0..1),
// 但 Spine 要求每个附件在 atlas 里有"同名 region"作为采样框与归一化基准。
// 旧实现只按嵌入纹理(model.textures, 仅 12 个)生成 region, 而骨架 display 有 19 个,
// 导致 Hd_12..Hd_19 这类附件查不到 region → "Region not found in atlas"。
// 新实现:为每个 skin display 按自身 uv 包围盒(×页尺寸)生成同名 region,
// 兜底保留嵌入纹理里未被 display 引用的区域, 保证全部附件都能解析。
function modelToAtlas(model) {
  // 页尺寸:沿用嵌入纹理的最大边界(与贴图页一致),Atlas 的 size: 必须匹配 png 实际尺寸
  const pageSrc = (model.textures.find((t) => t.textureSrc) || {}).textureSrc || 'texture.png';
  let pageW = 0, pageH = 0;
  for (const t of model.textures) { pageW = Math.max(pageW, t.x + t.w); pageH = Math.max(pageH, t.y + t.h); }
  pageW = nextPow2(pageW); pageH = nextPow2(pageH);

  const regions = new Map();
  const addRegion = (name, r) => { if (name && !regions.has(name)) regions.set(name, r); };

  // 1) 每个 display 按 uv 包围盒生成 region(assignRegionNames 已按矩形去重:
  //    多个插槽引用同一区域时共用同名 region,图集不再出现相同矩形重复项)
  for (const skin of model.skins || []) {
    for (const slot of skin.slots || []) {
      for (const disp of slot.displays || []) {
        const name = disp._regionName || disp.attachmentName;
        if (!name || regions.has(name)) continue;
        const bb = disp._bbox;
        if (bb) {
          const x = Math.max(0, Math.round(bb.minU * pageW));
          const y = Math.max(0, Math.round(bb.minV * pageH));
          const w = Math.max(1, Math.round((bb.maxU - bb.minU) * pageW));
          const h = Math.max(1, Math.round((bb.maxV - bb.minV) * pageH));
          addRegion(name, { x, y, w, h, fw: w, fh: h, fx: 0, fy: 0 });
        } else {
          // 退化:uv 不足(非常规网格)→ 退化为同名嵌入纹理;仍缺失则给 1x1 占位避免硬崩
          const et = model.textures.find((t) => t.regionName === name);
          if (et) addRegion(name, { x: et.x, y: et.y, w: et.w, h: et.h, fw: et.frameW, fh: et.frameH, fx: et.frameX, fy: et.frameY });
          else addRegion(name, { x: 0, y: 0, w: 1, h: 1, fw: 1, fh: 1, fx: 0, fy: 0 });
        }
      }
    }
  }
  // 2) 兜底:保留嵌入纹理里没有被任何 display 引用的区域(如独立的图集碎图);
  //    仅当「名称未被任何附件引用」且「矩形尚未被其他 region 覆盖」时才补,避免相同矩形重复
  const referencedNames = new Set();
  for (const skin of model.skins || []) for (const slot of skin.slots || []) for (const disp of slot.displays || []) {
    if (disp._regionName) referencedNames.add(disp._regionName);
  }
  const rectSet = new Set();
  for (const r of regions.values()) rectSet.add(`${r.x},${r.y},${r.w}x${r.h}`);
  for (const t of model.textures) {
    const key = `${t.x},${t.y},${t.w}x${t.h}`;
    if (rectSet.has(key) && !referencedNames.has(t.regionName)) continue; // 矩形已有同名不同区域覆盖,且无附件引用该名
    addRegion(t.regionName, { x: t.x, y: t.y, w: t.w, h: t.h, fw: t.frameW, fh: t.frameH, fx: t.frameX, fy: t.frameY });
    rectSet.add(key);
  }

  const out = [pageSrc, `size: ${pageW},${pageH}`, 'format: RGBA8888', 'filter: Linear,Linear', 'pma: false'];
  const names = [...regions.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const name of names) {
    const r = regions.get(name);
    out.push(name);
    out.push('  rotate: false');
    out.push(`  xy: ${r1(r.x)},${r1(r.y)}`);
    out.push(`  size: ${r1(r.w)},${r1(r.h)}`);
    out.push(`  orig: ${r1(r.fw)},${r1(r.fh)}`);
    out.push(`  offset: ${r1(r.fx)},${r1(r.fy)}`);
    out.push('  index: -1');
  }
  return out.join('\n') + '\n';
}

function nextPow2(n) {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
function r1(v) { return Math.round(v * 10) / 10; }

// ---------------- 图集区域分配(按矩形去重) ----------------
// 给每个 display 分配 atlas region 名与 UV 包围盒:
//  - 有 UV 的 mesh:按 UV 包围盒(×页尺寸取整)去重 —— 多个插槽引用同一纹理区域时(如 hedao.sk 的
//    Hd_2/Hd_5/Hd_19 共用同一区域)共用同一个 region 名,图集不再出现相同矩形的重复区域。
//  - 同名但矩形不同(源数据同名冲突,如 Hd_9 出现两次且 UV 不同)时给后出现者加后缀,保证每矩形独立区域。
//  - 无 UV(图片型):region 名 = 附件名(引用嵌入纹理)。
function assignRegionNames(model) {
  let pageW = 0, pageH = 0;
  for (const t of model.textures || []) { pageW = Math.max(pageW, t.x + t.w); pageH = Math.max(pageH, t.y + t.h); }
  pageW = nextPow2(pageW); pageH = nextPow2(pageH);
  const rectName = new Map(); // rectKey -> regionName
  const nameRect = new Map(); // regionName -> rectKey(同名冲突检测)
  let seq = 0;
  for (const skin of model.skins || []) {
    for (const slot of skin.slots || []) {
      for (const disp of slot.displays || []) {
        disp._regionName = disp.attachmentName || null;
        disp._bbox = null;
        const uvs = disp.uvs || [];
        if (uvs.length < 8) continue; // 图片型:引用嵌入纹理
        let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
        for (let i = 0; i < uvs.length; i += 2) {
          minU = Math.min(minU, uvs[i]); maxU = Math.max(maxU, uvs[i]);
          minV = Math.min(minV, uvs[i + 1]); maxV = Math.max(maxV, uvs[i + 1]);
        }
        const x = Math.max(0, Math.round(minU * pageW));
        const y = Math.max(0, Math.round(minV * pageH));
        const w = Math.max(1, Math.round((maxU - minU) * pageW));
        const h = Math.max(1, Math.round((maxV - minV) * pageH));
        const key = x + ',' + y + ',' + w + 'x' + h;
        disp._bbox = { minU, maxU, minV, maxV };
        if (rectName.has(key)) { disp._regionName = rectName.get(key); continue; }
        let name = disp.attachmentName;
        if (nameRect.has(name) && nameRect.get(name) !== key) name = (name || 'region') + '_' + (++seq);
        rectName.set(key, name);
        nameRect.set(name, key);
        disp._regionName = name;
      }
    }
  }
}

// mesh UV:从整页归一化(0..1 覆盖整张贴图页)重映射到 region 内归一化(0..1 覆盖该 region 矩形)。
// Spine 3.8 的 mesh uvs 语义是 region 内坐标(渲染时 u + regionUVs * (u2-u)),
// 若不重映射,mesh 只会采样到 region 的局部子区域,贴图错位。
function remapUvs(disp) {
  const uvs = disp.uvs || [];
  const bb = disp._bbox;
  const uw = bb ? bb.maxU - bb.minU : 0;
  const vh = bb ? bb.maxV - bb.minV : 0;
  if (!bb || uw < 1e-6 || vh < 1e-6) return uvs.map((v) => round3(v));
  const out = new Array(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    out[i] = round3((uvs[i] - bb.minU) / uw);
    out[i + 1] = round3((uvs[i + 1] - bb.minV) / vh);
  }
  return out;
}

// ---------------- 生成 Spine 骨架 JSON ----------------
function modelToSpineJson(model, opts) {
  opts = opts || {};
  const skeleton = {
    hash: (opts.hash || 'laya_' + (model.version || '').replace(/[^0-9.]/g, '')).slice(0, 32),
    spine: opts.spine || '3.8.99',
    x: 0, y: 0,
    width: opts.width || 0, height: opts.height || 0,
  };

  // 骨骼
  const bones = [];
  for (let i = 0; i < model.bones.length; i++) {
    const b = model.bones[i];
    const tr = model.bindTransforms[i] || { scX: 1, skX: 0, skY: 0, scY: 1, x: 0, y: 0 };
    const sp = layaMatrixToSpine(tr.scX, tr.skX, tr.skY, tr.scY, tr.x, tr.y);
    const bone = {};
    bone.name = b.name;
    if (b.parent) bone.parent = b.parent;
    if (b.length && b.length !== 0) bone.length = round3(b.length);
    if (sp.x) bone.x = round3(sp.x);
    if (sp.y) bone.y = round3(sp.y);
    if (sp.rotation) bone.rotation = round3(sp.rotation);
    if (sp.scaleX !== 1) bone.scaleX = round3(sp.scaleX);
    if (sp.scaleY !== 1) bone.scaleY = round3(sp.scaleY);
    if (!b.inheritRotation) bone.inheritRotation = false;
    if (!b.inheritScale) bone.inheritScale = false;
    bones.push(bone);
  }

  // 插槽(由 BoneSlot 提供 bone 绑定)
  const slots = [];
  if (model.boneSlots && model.boneSlots.length) {
    for (const bs of model.boneSlots) {
      const slot = { name: bs.name, bone: bs.parent || model.bones[0].name };
      if (bs.attachmentName && bs.attachmentName !== 'null' && bs.attachmentName !== 'undefined') {
        slot.attachment = bs.attachmentName;
      }
      slots.push(slot);
    }
  } else {
    for (const b of model.bones) slots.push({ name: b.name + '_slot', bone: b.name });
  }

  // 约束
  const ik = (model.ikConstraints || []).map((c) => {
    const o = { name: c.name, bones: c.boneNames, target: c.targetBoneName };
    o.bendPositive = (c.bendDirection === -1) ? false : true;
    if (c.mix !== 1) o.mix = round3(c.mix);
    return o;
  });
  const transform = (model.transformConstraints || []).map((c) => {
    const o = {
      name: c.name,
      bone: c.boneIndexs.map((i) => model.bones[i] ? model.bones[i].name : String(i)),
      target: model.bones[c.target] ? model.bones[c.target].name : String(c.target),
    };
    if (c.rotateMix !== 1) o.rotateMix = round3(c.rotateMix);
    if (c.translateMix !== 1) o.translateMix = round3(c.translateMix);
    if (c.scaleMix !== 1) o.scaleMix = round3(c.scaleMix);
    if (c.shearMix !== 1) o.shearMix = round3(c.shearMix);
    if (c.offsetRotation) o.offsetRotation = round3(c.offsetRotation);
    if (c.offsetX) o.offsetX = round3(c.offsetX);
    if (c.offsetY) o.offsetY = round3(c.offsetY);
    if (c.offsetScaleX !== 1) o.offsetScaleX = round3(c.offsetScaleX);
    if (c.offsetScaleY !== 1) o.offsetScaleY = round3(c.offsetScaleY);
    if (c.offsetShearY) o.offsetShearY = round3(c.offsetShearY);
    return o;
  });
  const path = (model.pathConstraints || []).map((c) => {
    const o = {
      name: c.name,
      bones: c.bonesIdx.map((i) => model.bones[i] ? model.bones[i].name : String(i)),
      target: c.target,
    };
    if (c.positionMode) o.positionMode = c.positionMode;
    if (c.spacingMode) o.spacingMode = c.spacingMode;
    if (c.rotateMode) o.rotateMode = c.rotateMode;
    if (c.offsetRotation) o.offsetRotation = round3(c.offsetRotation);
    if (c.position) o.position = round3(c.position);
    if (c.spacing) o.spacing = round3(c.spacing);
    if (c.rotateMix !== 1) o.rotateMix = round3(c.rotateMix);
    if (c.translateMix !== 1) o.translateMix = round3(c.translateMix);
    return o;
  });

  // 皮肤(默认皮肤命名为 "default")
  const skins = {};
  (model.skins || []).forEach((skin, si) => {
    const key = (si === 0 && skin.name !== 'default') ? 'default' : skin.name;
    const skinObj = {};
    for (const slot of skin.slots) {
      // 同一 slot 在源数据中可能以多条记录出现(附件名重复),按 attachmentName 合并避免覆盖丢失
      if (!skinObj[slot.name]) skinObj[slot.name] = {};
      for (const disp of slot.displays) {
        skinObj[slot.name][disp.attachmentName] = displayToAttachment(disp, model);
      }
    }
    skins[key] = skinObj;
  });

  // 动画
  const animations = buildAnimations(model);

  const json = { skeleton, bones, slots };
  if (ik.length) json.ik = ik;
  if (transform.length) json.transform = transform;
  if (path.length) json.path = path;
  json.skins = skins;
  if (animations && Object.keys(animations).length) json.animations = animations;
  return json;
}

// 把 SkinSlotDisplay 转换为 Spine 附件(region / mesh / skinnedmesh)
function displayToAttachment(disp, model) {
  const t = disp.transform;
  const sp = layaMatrixToSpine(t.scX, t.skX, t.skY, t.scY, t.x, t.y);
  if (disp.type === 1) {
    const isSkinned = disp.boneIdx && disp.boneIdx.length > 0;
    if (isSkinned) {
      // 蒙皮网格:Spine 顶点 = bonePose([numBones_v, boneIdx...]) + weights([x',y',w] 每(顶点,骨骼))
      // 拼装的骨骼权重元组。x',y' 已是相对各骨骼逆绑定姿态的偏移, boneIdx 为全局骨骼索引,
      // 直接对应输出骨架 bones 数组下标。
      const vCount = (disp.uvs.length / 2) | 0;
      const regName = disp._regionName || disp.attachmentName;
      return {
        type: 'skinnedmesh',
        uvs: remapUvs(disp),
        triangles: disp.triangles,
        vertices: buildSkinnedVertices(disp),
        hull: vCount,
        width: round3(disp.width), height: round3(disp.height),
        // ⚠️ Spine 3.8 JSON 加载器按「path」查 atlas region(region 字段被忽略):
        // 必须写 path = 去重后的 region 名,否则回退用附件名查 → 被并入其他 region 的附件会 Region not found
        path: regName,
        region: regName,
      };
    }
    const regName2 = disp._regionName || disp.attachmentName;
    return {
      type: 'mesh',
      uvs: remapUvs(disp),
      triangles: disp.triangles,
      // 真实 Laya 导出中 vertices 段恒为空,顶点坐标实际存在 weights 段;优先用非空者,兼顾 LayaSpineLoader 正向写入(二者皆坐标)。
      vertices: ((disp.vertices.length ? disp.vertices : disp.weights)).map((v) => round3(v)),
      hull: Math.min(8, ((disp.vertices.length ? disp.vertices : disp.weights).length / 2) | 0),
      width: round3(disp.width), height: round3(disp.height),
      // ⚠️ Spine 3.8 JSON 加载器按「path」查 atlas region(region 字段被忽略),必须写 path = 去重后的 region 名
      path: regName2,
      region: regName2,
    };
  }
  // region(图片)
  const att = { x: round3(sp.x), y: round3(sp.y) };
  if (sp.rotation) att.rotation = round3(sp.rotation);
  if (sp.scaleX !== 1) att.scaleX = round3(sp.scaleX);
  if (sp.scaleY !== 1) att.scaleY = round3(sp.scaleY);
  att.width = round3(disp.width);
  att.height = round3(disp.height);
  // ⚠️ Spine 3.8 JSON 加载器按「path」查 atlas region(region 字段被忽略),
  // region 附件同样要写 path = 去重后的 region 名(如 Hd_16 与 Hd_15 共用区域时 path 应为 Hd_15)
  att.path = disp._regionName || disp.attachmentName;
  att.region = disp._regionName || disp.attachmentName;
  att.color = 'ffffffff';
  return att;
}

// 重建 Spine 蒙皮网格顶点:输入 disp.boneIdx(bonePose:[numBones_v, boneIdx...] 每顶点)
// 与 disp.weights([x', y', w] 每(顶点,骨骼),x'/y' 已相对该骨骼逆绑定姿态)。
// 输出 Spine 格式:每个顶点都以前导“骨骼数”开头 —— 单骨骼顶点 [1, boneIndex, x, y, weight];
// 多骨骼顶点 [boneCount, (boneIndex, x, y, weight)...]。Spine 运行时按 vertices[i++] 先读骨骼数,
// 故单骨骼也必须带前导 1(否则绑定到 bone 0 时会写成 [0,...] 被误判为 0 骨骼)。
function buildSkinnedVertices(disp) {
  const bonePose = disp.boneIdx;
  const data = disp.weights;
  const out = [];
  let wi = 0, bi = 0;
  while (bi < bonePose.length) {
    const boneCount = bonePose[bi++];
    if (boneCount <= 0) continue; // 防御:理论上蒙皮顶点 boneCount>=1
    if (boneCount === 1) {
      const bIdx = bonePose[bi++];
      out.push(1, bIdx, round3(data[wi++]), round3(data[wi++]), round3(data[wi++]));
    } else {
      out.push(boneCount);
      for (let k = 0; k < boneCount; k++) {
        const bIdx = bonePose[bi++];
        out.push(bIdx, round3(data[wi++]), round3(data[wi++]), round3(data[wi++]));
      }
    }
  }
  return out;
}

// 动画解码:把 .sk 段 A 的节点关键帧映射为 Spine 动画轨道
// 约定(与 LayaSpineLoader 的骨骼时间线一致):
//   keyframeWidth=6 的骨骼节点 → [x, y, rotation, scaleX, scaleY, shear] 离散量
//   时间轴:首帧 t=0,后续帧 t=累计 duration(秒,毫秒/1000)
function buildAnimations(model) {
  const animations = {};
  for (const ani of model.animations) {
    const tracks = {};
    for (const node of ani.nodes) {
      const name = node.name;
      const w = node.keyframeWidth;
      const frames = node.keyframes.map((kf) => kf.data);
      if (w >= 6 && model.bones.some((b) => b.name === name)) {
        const boneTrack = tracks[name] || (tracks[name] = { translate: [], rotate: [], scale: [], shear: [] });
        let time = 0;
        for (let fi = 0; fi < frames.length; fi++) {
          const d = frames[fi];
          const curve = curveFromNode(node, fi);
          const tEntry = {};
          if (fi > 0) tEntry.time = round3(time);
          if (curve !== null) tEntry.curve = curve;
          boneTrack.translate.push({ ...tEntry, x: round3(d[0]), y: round3(d[1]) });
          boneTrack.rotate.push({ ...tEntry, angle: round3(d[2]) });
          boneTrack.scale.push({ ...tEntry, x: round3(d[3]), y: round3(d[4]) });
          boneTrack.shear.push({ ...tEntry, x: round3(d[5]), y: round3(d[5]) });
          if (fi < node.keyframes.length - 1) time += node.keyframes[fi].duration / 1000;
        }
      } else {
        const slotTrack = tracks[name] || (tracks[name] = { _raw: [] });
        let time = 0;
        for (let fi = 0; fi < frames.length; fi++) {
          const d = frames[fi];
          slotTrack._raw.push({ time: round3(time), width: w, data: d.map((v) => round3(v)) });
          if (fi < node.keyframes.length - 1) time += node.keyframes[fi].duration / 1000;
        }
      }
    }
    const aniObj = {};
    for (const [nm, tr] of Object.entries(tracks)) {
      if (tr._raw) {
        aniObj[nm] = { _layaRawTimeline: tr._raw };
      } else {
        aniObj[nm] = {};
        if (tr.translate && tr.translate.length) aniObj[nm].translate = tr.translate;
        if (tr.rotate && tr.rotate.length) aniObj[nm].rotate = tr.rotate;
        if (tr.scale && tr.scale.length) aniObj[nm].scale = tr.scale;
        if (tr.shear && tr.shear.length) aniObj[nm].shear = tr.shear;
      }
    }
    animations[ani.name] = aniObj;
  }
  return animations;
}

// 从 lerpType / interp 推断 Spine 曲线
function curveFromNode(node, fi) {
  if (node.lerpType === 1) return 'stepped';
  if (node.lerpType === 0) return null;
  if (node.lerpType === 2) {
    const inter = node.keyframes[fi] && node.keyframes[fi].interp;
    if (inter && inter.length) {
      const m = inter[0];
      if (m === 255) return 'stepped';
      if (m === 254) return null;
      if (inter.length >= 3) return round3(inter[1]);
    }
    return null;
  }
  return null;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ---------------- 顶层:单文件转换 ----------------
function skToSpine(inputPath, outputPath) {
  const buffer = fs.readFileSync(inputPath);
  const probe = probeLayaSk(buffer);
  if (!probe.ok) return { ok: false, error: probe.reason };
  const { model, audio } = parseSkRobust(buffer);

  // 图集区域分配(按矩形去重 + 记录 UV 包围盒),供 modelToAtlas 与 displayToAttachment 使用
  assignRegionNames(model);

  let maxR = 0, maxB = 0;
  for (const t of model.textures) { maxR = Math.max(maxR, t.x + t.w); maxB = Math.max(maxB, t.y + t.h); }
  const width = nextPow2(maxR), height = nextPow2(maxB);

  const json = modelToSpineJson(model, { width, height });
  const atlas = modelToAtlas(model);

  let jsonPath = outputPath;
  if (!/\.json$/i.test(jsonPath)) jsonPath = outputPath.replace(/\.[^.]+$/, '') + '.json';
  const atlasPath = jsonPath.replace(/\.json$/i, '.atlas');

  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  fs.writeFileSync(atlasPath, atlas, 'utf8');

  return {
    ok: true,
    jsonPath,
    atlasPath,
    version: model.version,
    audioFlag: audio,
    warn: model._warn || null,
    stats: {
      bones: model.bones.length,
      slots: model.boneSlots.length,
      skins: model.skins.length,
      textures: model.textures.length,
      ik: model.ikConstraints.length,
      transform: model.transformConstraints.length,
      path: model.pathConstraints.length,
      animations: model.animations.length,
    },
  };
}

module.exports = { parseSk, parseSkRobust, probeLayaSk, skToSpine, skToSpineText, modelToAtlas, modelToSpineJson };

// ---------------- 内存版转换(不写文件,供 .sk 直接预览) ----------------
function skToSpineText(inputPath) {
  const buffer = fs.readFileSync(inputPath);
  const probe = probeLayaSk(buffer);
  if (!probe.ok) return { ok: false, error: probe.reason };
  const { model, audio } = parseSkRobust(buffer);

  // 图集区域分配(按矩形去重 + 记录 UV 包围盒),供 modelToAtlas 与 displayToAttachment 使用
  assignRegionNames(model);

  let maxR = 0, maxB = 0;
  for (const t of model.textures) { maxR = Math.max(maxR, t.x + t.w); maxB = Math.max(maxB, t.y + t.h); }
  const width = nextPow2(maxR), height = nextPow2(maxB);

  const json = modelToSpineJson(model, { width, height });
  const atlas = modelToAtlas(model);
  const pageSrc = (model.textures.find((t) => t.textureSrc) || {}).textureSrc || '';

  return {
    ok: true,
    json: JSON.stringify(json, null, 2),
    atlas,
    pageSrc,
    version: model.version,
    audioFlag: audio,
    warn: model._warn || null,
  };
}
