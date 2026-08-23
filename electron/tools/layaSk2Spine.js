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
function readSegmentA(buf, startPos, publicData, strList, aniCount, unlimit) {
  const r = new ByteReader(buf, startPos);
  const animations = [];
  for (let ai = 0; ai < aniCount; ai++) {
    const nameIdx = r.u16();
    const name = strList[nameIdx];
    const playTime = r.f32();              // 毫秒
    // 官方 AnimationParser01:节点计数宽度由资源路径决定(含 "unlimit" 为 u16,否则 u8)
    const boneCount = unlimit ? r.u16() : r.u8();
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
function parseSk(buffer, readAudio, pathHint) {
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
  // 官方规则:动画节点计数宽度由资源路径决定 —— 含 "unlimit" 为 u16,否则 u8
  // (此前误把 u16 高字节当作“变体额外字节”跳过,系同一现象的两种解读)
  const animations = readSegmentA(buffer, r.pos, publicData, strList, aniCount, /unlimit/i.test(pathHint || '')).animations;

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

  // 13) 皮肤(官方 Templet._parsePublicExtData 规则)
  // 名称流:skinName + 每槽 slotName + 每 display 两个名(displayName/attachmentName)。
  // 计数宽度:skinCount 恒 u8;slotCount = 路径含 "newspine" ? u16 : u8;displayCount 恒 u8。
  // display 二进制无前缀字节(此前“逐 display 前缀”实为 slotCount u16 高字节误读的连带误判)。
  const nameStr = pe.utf();
  const nameArray = nameStr.split('\n');
  const skinStartAbs = publicExtDataPos + pe.pos; // 皮肤段计数(名称串之后)的绝对起始
  const publicExtEnd = publicExtDataPos + publicExtData.length;
  const slotCountW = /newspine/i.test(pathHint || '') ? 2 : 1;
  let skinResult = null;
  // 按官方宽度解析;若未能正好对齐段尾(极少数无路径信息的调用),回退尝试另一种宽度
  for (const w of [slotCountW, (slotCountW === 2 ? 1 : 2)]) {
    const sub = new ByteReader(buffer, skinStartAbs);
    const nir = { v: 0 };
    try {
      const r = readSkinSection(sub, nameArray, nir, w, 1, 0);
      const cand = { r, exact: r.endPos === publicExtEnd };
      if (!skinResult || (cand.exact && !skinResult.exact)) skinResult = cand;
      if (skinResult.exact) break;
    } catch (e) { /* 尝试另一宽度 */ }
  }
  if (!skinResult) {
    // 兜底:强制标准宽度(让上层拿到尽量完整的数据并携带告警)
    const sub = new ByteReader(buffer, skinStartAbs);
    skinResult = { r: readSkinSection(sub, nameArray, { v: 0 }, slotCountW, 1, 0), exact: false };
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
// 先按“无 audioValue”解析;未对齐或中途越界(大文件事件段多,读错布局会直接抛 RangeError)
// 都回退按“有 audioValue”重试一次。
function parseSkRobust(buffer, pathHint) {
  let m1 = null;
  try {
    m1 = parseSk(buffer, false, pathHint);
    if (m1._parseEnd === m1._parseLen) return { model: m1, audio: false };
  } catch (e) { /* 布局不对,继续按带 audio 尝试 */ }
  const m2 = parseSk(buffer, true, pathHint);
  if (m2._parseEnd === m2._parseLen) return { model: m2, audio: true };
  const mm = m1 || m2;
  mm._warn = `段C解析未完全对齐(已读 ${mm._parseEnd} / 共 ${mm._parseLen} 字节),输出可能不完整`;
  return { model: mm, audio: m1 == null };
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
  // Laya 全程 y 向下(矩阵形式与 Spine 相同),渲染端 spine38Player 对世界坐标统一取 -y。
  // 因此这里对 Laya 矩阵做整体共轭 F·M·F(F=diag(1,-1)):旋转取负、平移 y 取负、缩放不变,
  // 最终渲染出的画面才与 Laya 舞台坐标一致。旧实现只翻转了旋转、没翻转平移,坐标系混杂导致部件错位。
  const ang = (skX * Math.PI) / 180;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const a = scX * cosA, b = scX * sinA, c = -scY * sinA, d = scY * cosA;
  // 共轭矩阵:b、c 取负,ty 取负
  const b2 = -b, c2 = -c;
  const scaleX = Math.sqrt(a * a + c2 * c2);
  const scaleY = Math.sqrt(b2 * b2 + d * d);
  let rotation = Math.atan2(b2, a) * 180 / Math.PI;
  let sx = scaleX, sy = scaleY;
  if (a * d - b2 * c2 < 0) {
    sx = -sx;
    // 负缩放(镜像骨骼,如 chibang 左翼 bone15 scX=-1.1):atan2(b2,a) 得到的是
    // 被镜像翻转后的 x 轴角(含 180°),须 +180° 还原 —— 否则「翻转角 + 负缩放」
    // 双重应用互相抵消,镜像在 Spine 端丢失(左翼渲染到右翼位置)。
    rotation += 180;
    if (rotation > 180) rotation -= 360;
    else if (rotation <= -180) rotation += 360;
  }
  return { x, y: -y, rotation, scaleX: sx, scaleY: sy, shearX: 0, shearY: 0 };
}

// Laya 显示矩阵(Transform.getMatrix:scale → rotate(skX) → translate,y 向下)
function layaDisplayMatrix(t) {
  const ang = ((t.skX || 0) * Math.PI) / 180;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  return {
    a: (t.scX || 1) * cosA, b: (t.scX || 1) * sinA,
    c: -(t.scY || 1) * sinA, d: (t.scY || 1) * cosA,
    tx: t.x || 0, ty: t.y || 0,
  };
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

/** 按官方 showSkinByIndex 语义解析 setup 显示索引:
 *  仅字面量 "undefined" 走 displayIndex;其余(含 "null"/空串/真实 undefined)一律
 *  showDisplayByName 按名字查找,未命中 → -1(隐藏)。 */
function resolveDisplayIndex(bs, displays) {
  if (bs.attachmentName === 'undefined') return bs.displayIndex == null ? -1 : bs.displayIndex;
  if (typeof bs.attachmentName === 'string') {
    const i = displays.findIndex((d) => d.attachmentName === bs.attachmentName);
    return i; // 未命中 → -1
  }
  return -1;
}

// ---------------- 生成 Spine 骨架 JSON ----------------

/** 计算某骨骼的 Spine setup 姿态(与 modelToSpineJson 输出的 bones[i] 字段一致,含根骨 y 翻转)。
 *  buildAnimations 的时间线必须以该 setup 为基准换算(见下),两处共用防止漂移。 */
function boneSetupPose(model, bi) {
  const b = model.bones[bi] || {};
  const tr = model.bindTransforms[bi] || { scX: 1, skX: 0, skY: 0, scY: 1, x: 0, y: 0 };
  const sp = layaMatrixToSpine(tr.scX, tr.skX, tr.skY, tr.scY, tr.x, tr.y);
  if (model.tailFlag === 1 && !b.parent) sp.scaleY = -sp.scaleY;
  return {
    x: sp.x || 0, y: sp.y || 0,
    rotation: sp.rotation || 0,
    scaleX: sp.scaleX == null ? 1 : sp.scaleX,
    scaleY: sp.scaleY == null ? 1 : sp.scaleY,
  };
}

function modelToSpineJson(model, opts) {
  opts = opts || {};
  const skeleton = {
    // hash 内不能出现 x.y.z 形态的数字串:probeSpineFile(文件头正则)与
    // SpineSkeletonDataConverter 都按“首个 x.y.z”识别版本,含点号的 Laya 版本串
    // (如 laya_1.6.0)会被误判为 Spine 1.6 → 探测失败、无法链式转换。去掉点号(laya_160)。
    hash: (opts.hash || 'laya_' + (model.version || '').replace(/[^0-9]/g, '')).slice(0, 32),
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
    // yReverse(tailFlag==1):官方引擎给根骨骼前置 F=diag(1,-1),等价于根骨骼 scaleY 取负;
    // 共轭输出在根骨骼 scaleY 上补此翻转(动画里的根 scale 时间线同步处理,见 buildAnimations)
    if (model.tailFlag === 1 && !b.parent) sp.scaleY = -sp.scaleY;
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

  // 皮肤槽位条目(官方解析后同名条目合并)
  const skinSlotByName = new Map();
  for (const slot of (model.skins[0] || {}).slots || []) {
    if (!skinSlotByName.has(slot.name)) skinSlotByName.set(slot.name, { name: slot.name, displays: [] });
    skinSlotByName.get(slot.name).displays.push(...slot.displays);
  }

  // 插槽(由 BoneSlot 提供 bone 绑定;setup 附件按官方 showSkinByIndex 语义解析)
  const slots = [];
  if (model.boneSlots && model.boneSlots.length) {
    for (const bs of model.boneSlots) {
      const slot = { name: bs.name, bone: bs.parent || model.bones[0].name };
      const entry = skinSlotByName.get(bs.name);
      const displays = entry ? entry.displays : [];
      // 官方 showSkinByIndex 语义:仅字面量 "undefined" 走 displayIndex;其余(含 "null"、
      // 空串)一律 showDisplayByName 按名字查找 —— ZhuangXu 的 attachmentNames 里就有
      // 真实命名为 "null" 的显示,按名字能命中并显示;未命中 → 隐藏(-1)。
      // 此前把 "null" 也当垃圾名过滤,导致 ZhuanXu_13/16 等部件在 setup 丢失。
      const idx = resolveDisplayIndex(bs, displays);
      const disp = displays[idx];
      if (disp) slot.attachment = disp.attachmentName || disp.name;
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

  // 皮肤(默认皮肤命名为 "default")。
  // 官方解析规则下皮肤段槽位名与 BoneSlot 一致,直接按槽位归组、以 attachmentName 为附件键;
  // 仅对极少数仍对不上的槽位名按附件持有者兜底(避免 3.8 运行时 "Slot not found")。
  const slotNames = new Set(slots.map((s) => s.name));
  const boneSlotByAtt = new Map();
  for (const bs of model.boneSlots || []) {
    if (bs.attachmentName && !boneSlotByAtt.has(bs.attachmentName)) boneSlotByAtt.set(bs.attachmentName, bs.name);
  }
  const skins = {};
  (model.skins || []).forEach((skin, si) => {
    const key = (si === 0 && skin.name !== 'default') ? 'default' : skin.name;
    const skinObj = {};
    for (const slot of skin.slots) {
      let slotName = slot.name;
      if (!slotNames.has(slotName)) {
        // 兜底:按附件持有者反查(取第一个能对上的)
        const cands = new Set();
        for (const disp of slot.displays || []) {
          const n = boneSlotByAtt.get(disp.attachmentName) || boneSlotByAtt.get(disp.name);
          if (n && slotNames.has(n)) cands.add(n);
        }
        if (cands.size === 1) slotName = cands.values().next().value;
        else continue; // 无法确定,跳过该槽位
      }
      if (!skinObj[slotName]) skinObj[slotName] = {};
      for (const disp of slot.displays) {
        const attKey = disp.attachmentName || disp.name;
        skinObj[slotName][attKey] = displayToAttachment(disp, model);
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
        // Spine 3.8 JSON 的加权网格类型就是 'mesh'(顶点内联 [骨骼数,骨骼idx,x,y,w,...] 元组);
        // 'skinnedmesh' 是 4.x 类型名,3.8 读到未知类型返回 null → 附件丢失(ZhuangXu_13/16)。
        type: 'mesh',
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
    // Laya 绘制 type1 网格时顶点经「显示矩阵 ∘ 骨骼矩阵」变换;Spine mesh 顶点只受骨骼影响,
    // 故把显示矩阵烘焙进顶点,并按共轭规则对结果 y 取负(Laya y-down → Spine y-up)。
    const raw = disp.vertices.length ? disp.vertices : disp.weights;
    const D = layaDisplayMatrix(t);
    const baked = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const px = D.a * raw[i] + D.c * raw[i + 1] + D.tx;
      const py = D.b * raw[i] + D.d * raw[i + 1] + D.ty;
      baked.push(round3(px), round3(-py));
    }
    return {
      type: 'mesh',
      uvs: remapUvs(disp),
      triangles: disp.triangles,
      vertices: baked,
      hull: Math.min(8, (raw.length / 2) | 0),
      width: round3(disp.width), height: round3(disp.height),
      // ⚠️ Spine 3.8 JSON 加载器按「path」查 atlas region(region 字段被忽略),必须写 path = 去重后的 region 名
      path: regName2,
      region: regName2,
    };
  }
  // 旋转打包的 region(源图集 rotate:90):官方 createTexture 按 uvs[0]>uvs[4] && uvs[1]>uvs[5]
  // 判定为旋转区域(createTexture 宽高互换分支),四边形按「转置」uv 配对绘制 —— 即显示的
  // width/height 与纹理区域像素宽高正好互换。Spine region 附件的 uv 由运行时按 region 矩形
  // 固定生成,无法表达这种配对 → 改输出 4 顶点 mesh:顶点 = 显示矩阵烘焙的 quad、uv = 区域内
  // 重映射,与上方 type1 无骨骼网格路径同构(ZhuangXu_0/1/5/11/12/14/15 均属此类)。
  const quadUvs = disp.uvs || [];
  if (quadUvs.length >= 8 && quadUvs[0] > quadUvs[4] && quadUvs[1] > quadUvs[5]) {
    const w2 = (disp.width || 0) / 2, h2 = (disp.height || 0) / 2;
    const quad = [-w2, -h2, w2, -h2, w2, h2, -w2, h2];
    const D = layaDisplayMatrix(t);
    const baked = [];
    for (let i = 0; i + 1 < quad.length; i += 2) {
      const px = D.a * quad[i] + D.c * quad[i + 1] + D.tx;
      const py = D.b * quad[i] + D.d * quad[i + 1] + D.ty;
      baked.push(round3(px), round3(-py));
    }
    const regName = disp._regionName || disp.attachmentName;
    return {
      type: 'mesh',
      uvs: remapUvs(disp),
      triangles: [0, 1, 2, 2, 3, 0],
      vertices: baked,
      hull: 4,
      width: round3(disp.width), height: round3(disp.height),
      path: regName,
      region: regName,
    };
  }
  // region(图片)
  const att = { x: round3(sp.x), y: round3(sp.y) };
  if (sp.rotation) att.rotation = round3(sp.rotation);
  if (sp.scaleX !== 1) att.scaleX = round3(sp.scaleX);
  // 官方引擎的 region 显示为「顶点-uv 垂直翻转」配对(quad 左上角采样区域底部,
  // 实测 hedao Hd_3:官方 TL→(u,v2),Spine 标准 TL→(u,v))。Spine region 的 uv 由
  // 运行时按 region 矩形 + 固定顺序生成,JSON 无法直接覆写 —— 对 scaleY 取负等价于
  // 在附件本地做垂直镜像(M = T·R·diag(sx,-sy),与旋转复合正确),使最终画面与官方一致,
  // 否则水面/河岸等大图块上下颠倒(「图像交叉」)。
  att.scaleY = round3(-(sp.scaleY == null ? 1 : sp.scaleY));
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
// 与 disp.weights([x, y, w] 每(顶点,骨骼),x/y 为该骨骼本地坐标 —— Laya 运行时
// 顶点 = Σ w·骨骼矩阵·(x,y),无逆绑定姿态运算)。
// 输出 Spine 格式:每个顶点都以前导“骨骼数”开头 —— 单骨骼顶点 [1, boneIndex, x, y, weight];
// 多骨骼顶点 [boneCount, (boneIndex, x, y, weight)...]。Spine 运行时按 vertices[i++] 先读骨骼数,
// 故单骨骼也必须带前导 1(否则绑定到 bone 0 时会写成 [0,...] 被误判为 0 骨骼)。
// 坐标系:按共轭规则对每对顶点 y 取负。
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
      out.push(1, bIdx, round3(data[wi++]), round3(-data[wi++]), round3(data[wi++]));
    } else {
      out.push(boneCount);
      for (let k = 0; k < boneCount; k++) {
        const bIdx = bonePose[bi++];
        out.push(bIdx, round3(data[wi++]), round3(-data[wi++]), round3(data[wi++]));
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
  // 官方 _parsePublicExtData 的名称流下,首个骨骼为根;yReverse 时根 scaleY 需取负(与 setup 一致)
  const rootBone = model.bones[0] && model.bones[0].name;
  const flipRootScale = model.tailFlag === 1;
  // 槽位 display 查表:slotName → displays[](官方解析后同名条目合并)
  const slotDisplays = new Map();
  for (const slot of (model.skins[0] || {}).slots || []) {
    if (!slotDisplays.has(slot.name)) slotDisplays.set(slot.name, []);
    slotDisplays.get(slot.name).push(...slot.displays);
  }
  const boneSlotNames = (model.boneSlots || []).map((bs) => bs.name);
  // setup 附件(与 modelToSpineJson 的槽位 setup 解析同语义):作为 attachment
  // 时间线的初值 —— 首个切换结果与 setup 相同则不必发帧,不同(如 move 把
  // leg_L2_Line 切到无效名 → 隐藏)则必须发出隐藏帧,否则 setup 附件会一直显示
  const setupAtt = new Map();
  for (const bs of model.boneSlots || []) {
    const displays = slotDisplays.get(bs.name) || [];
    const idx = resolveDisplayIndex(bs, displays);
    const disp = displays[idx];
    setupAtt.set(bs.name, disp ? (disp.attachmentName || disp.name) : null);
  }

  for (let ai = 0; ai < model.animations.length; ai++) {
    const ani = model.animations[ai];
    const aniObj = { bones: {} };
    const slotTimelines = {}; // slotName → {attachment:[], color:[]}
    // 官方 _createGraphics 用 aniSectionDic 分区界区分节点类型:
    // 前 sec[0] 个 = 骨骼节点,其后 = 插槽节点(再后是 path 节点)。
    // 骨骼与插槽可能同名(如 juxianggui 的骨骼 tui 与槽位 tui),
    // 不能按"名字是否是骨骼"判断,否则插槽时间线节点会被骨骼分支吞掉。
    const sec = (model.aniSections || [])[ai] || [ani.nodes.length, 0];
    const boneNodeCount = sec[0];

    for (let ni = 0; ni < ani.nodes.length; ni++) {
      const node = ani.nodes[ni];
      const name = node.name;
      const w = node.keyframeWidth;
      const frames = node.keyframes.map((kf) => kf.data);
      const isSlotNode = ni >= boneNodeCount;
      if (!isSlotNode && w >= 6 && model.bones.some((b) => b.name === name)) {
        const boneTrack = aniObj.bones[name] || (aniObj.bones[name] = {});
        // 官方引擎把关键帧作为「相对绑定姿态(srcBoneMatrix)的增量」应用:
        // scX = bind.scX * M、skX = bind.skX + M、x = bind.x + M(缩放乘、其余加)。
        // Spine 时间线是绝对值,故把绑定姿态烘焙进每个关键帧。
        const bi = model.bones.findIndex((b) => b.name === name);
        const bind = model.bindTransforms[bi] || { scX: 1, skX: 0, skY: 0, scY: 1, x: 0, y: 0 };
        const rootFlip = (flipRootScale && name === rootBone) ? -1 : 1;
        // ⚠️ 时间线语义:3.8 运行时按「相对 setup 姿态」应用骨骼时间线 ——
        // translate/rotate = setup + 值,scale = 值 × setup(Spine 3.8 二进制同此约定)。
        // 故此处输出增量/倍率,不能烘焙绝对值(否则播放时 setup 被二次叠加,bind 位置
        // 较大的资源(如 hedao,bind ±900)部件会整体飞散)。
        const setup = boneSetupPose(model, bi);
        const translate = [], rotate = [], scale = [];
        let time = 0;
        for (let fi = 0; fi < frames.length; fi++) {
          const d = frames[fi];
          // 各轨道曲线按其涉及的分量取:translate=d[4]/d[5]、rotate=d[1]、scale=d[0]/d[3]
          const curveT = curveForComponents(node, fi, [4, 5]);
          const curveR = curveForComponents(node, fi, [1]);
          const curveS = curveForComponents(node, fi, [0, 3]);
          const tEntryT = {}, tEntryR = {}, tEntryS = {};
          if (fi > 0) { tEntryT.time = tEntryR.time = tEntryS.time = round3(time); }
          if (curveT) Object.assign(tEntryT, curveT);
          if (curveR) Object.assign(tEntryR, curveR);
          if (curveS) Object.assign(tEntryS, curveS);
          // Laya 骨骼关键帧字段序与 bindTransforms 一致:[scX, skX, skY, scY, x, y](宽度 8 时末尾 2 个为补位)。
          // 坐标系共轭(Laya y-down → Spine y-up):translate y 取负、rotate 取负;Laya getMatrix 只用 skX 旋转,无 shear。
          // 绝对值 = setup + delta:tx = bind.x + d[4] → delta = d[4];ty = -(bind.y + d[5]) → delta = -d[5]。
          translate.push({ ...tEntryT, x: round3(d[4]), y: round3(-d[5]) });
          rotate.push({ ...tEntryR, angle: round3(-d[1]) });
          // 绝对 = bind.scX * d[0](根骨再乘 rootFlip);runtime 应用 = 值 × setup.scale。
          // setup.scale 已含共轭与根骨翻转符号,直接用绝对值 ÷ setup 换算倍率最稳。
          const absSX = bind.scX * d[0];
          const absSY = bind.scY * d[3] * rootFlip;
          const rx = setup.scaleX !== 0 ? absSX / setup.scaleX : absSX;
          const ry = setup.scaleY !== 0 ? absSY / setup.scaleY : absSY;
          scale.push({ ...tEntryS, x: round3(rx), y: round3(ry) });
          if (fi < node.keyframes.length - 1) time += node.keyframes[fi].duration / 1000;
        }
        if (translate.length) boneTrack.translate = translate;
        if (rotate.length) boneTrack.rotate = rotate;
        if (scale.length) boneTrack.scale = scale;
      } else if (slotDisplays.has(name) || boneSlotNames.includes(name)) {
        // 槽位时间线(宽 6):[displayIndex, alpha, 0, 0, 0, 0]
        // displayIndex:-2 = 保持不变,-1 = 隐藏,>=0 = 切换显示;alpha 线性插值。
        // 官方切换语义:存在 attachmentNames 列表时,k 是该列表的下标 → 按名字
        // showDisplayByName(attachmentNames[k])(命中 display 的 attachmentName;
        // 名字无效或未命中 → 隐藏),否则 k 直接是本槽位 displays 下标。
        const displays = slotDisplays.get(name) || [];
        const attList = model.attachmentNames || [];
        const hasAttList = attList.length > 0;
        const tl = slotTimelines[name] || (slotTimelines[name] = {});
        let time = 0;
        let lastDisp = setupAtt.get(name) || null, lastAlpha = null;
        for (let fi = 0; fi < frames.length; fi++) {
          const d = frames[fi];
          const t = fi === 0 ? 0 : round3(time);
          const dispIdx = Math.round(d[0]);
          if (dispIdx !== -2) {
            // 官方 showDisplayByName 语义:按名字查找,不做任何名字过滤 ——
            // "null"/空串都可能是真实显示名(如 ZhuangXu 的 ZhuanXu_13/16);未命中 → 隐藏
            let disp = null;
            if (hasAttList) {
              const nm = attList[dispIdx];
              disp = (nm != null) ? (displays.find((x) => x.attachmentName === nm) || null) : null;
            } else {
              disp = displays[dispIdx] || null;
            }
            const attName = disp ? (disp.attachmentName || disp.name) : null;
            if (attName !== lastDisp) {
              (tl.attachment || (tl.attachment = [])).push(
                attName ? { time: t, name: attName } : { time: t, name: null });
              lastDisp = attName;
            }
          }
          const alpha = Math.max(0, Math.min(1, d[1]));
          if (lastAlpha === null || Math.abs(alpha - lastAlpha) > 1e-3) {
            (tl.color || (tl.color = [])).push({
              time: t,
              color: 'ffffff' + Math.round(alpha * 255).toString(16).padStart(2, '0'),
            });
            lastAlpha = alpha;
          }
          if (fi < node.keyframes.length - 1) time += node.keyframes[fi].duration / 1000;
        }
      }
    }

    // drawOrder 时间线 → spine draworder offsets。
    // Spine 运行时按 setup 槽位顺序重建:偏移 = 目标位置 - setup 位置,条目需按 setup 顺序枚举;
    // (此前用“顺序移动”算法生成的偏移会让运行时写出负索引 → "Invalid array length")
    const doEntries = (model.drawOrderAniData || [])[ai] || [];
    if (doEntries.length) {
      const setup = boneSlotNames.slice();
      const keys = [];
      for (const e of doEntries) {
        const target = e.orderArr.map((i) => boneSlotNames[i]).filter(Boolean);
        if (!target.length) continue;
        const posInTarget = new Map(target.map((n, i) => [n, i]));
        const offsets = [];
        setup.forEach((n, si) => {
          const tp = posInTarget.get(n);
          if (tp === undefined || tp === si) return;
          offsets.push({ slot: n, offset: tp - si });
        });
        if (offsets.length) keys.push({ time: round3(e.time / 1000), offsets });
      }
      if (keys.length) aniObj.drawOrder = keys;
    }

    // deform 时间线(无骨骼网格:帧顶点为 display 本地坐标,spine deform 为相对 setup 的偏移)
    const defSkins = (model.deformAniData || [])[ai] || [];
    const defSkin = defSkins.find((s) => s.skinName === 'default') || defSkins[0];
    if (defSkin) {
      for (const slotRecords of defSkin.slots || []) {
        for (const rec of slotRecords || []) {
          const slotName = boneSlotNames[rec.slotIndex];
          const disp = (slotDisplays.get(slotName) || [])
            .find((d) => (d.attachmentName || d.name) === rec.attachment);
          // 仅支持无骨骼网格的 deform:蒙皮网格 weights 为 [x,y,w] 三元组(骨骼本地坐标),
          // 与 spine deform 的“逐输出顶点偏移”不在同一空间,跳过避免帧数组错长
          if (!slotName || !disp || (disp.bones && disp.bones.length)) continue;
          if (!disp.weights || disp.weights.length < 4) continue;
          if (rec.slotIndex < 0 || !(rec.times || []).length) continue;
          // setup 顶点 = 显示矩阵烘焙 + y 取负(与 displayToAttachment 一致)
          const D = layaDisplayMatrix(disp.transform);
          const setupVerts = [];
          for (let i = 0; i + 1 < disp.weights.length; i += 2) {
            setupVerts.push(
              D.a * disp.weights[i] + D.c * disp.weights[i + 1] + D.tx,
              -(D.b * disp.weights[i] + D.d * disp.weights[i + 1] + D.ty));
          }
          const framesOut = [];
          for (const t of rec.times) {
            if (!t.verts || t.verts.length !== setupVerts.length) continue;
            // Spine 3.8 deform 帧语义:字段名必须是 "vertices"(值 = 相对 setup 的增量,
            // 运行时读取时自动 `deform[i] += setup顶点`;"offset" 是可选整数稀疏起始索引,
            // 与帧值无关)—— 此前误把增量写在 "offset" 字段,运行时读不到帧数据,
            // 回退成 setup 顶点常量,水面流动形变全部失效(只剩 alpha 交叉淡化的明暗闪烁)。
            const delta = [];
            for (let i = 0; i + 1 < t.verts.length; i += 2) {
              const px = D.a * t.verts[i] + D.c * t.verts[i + 1] + D.tx;
              const py = -(D.b * t.verts[i] + D.d * t.verts[i + 1] + D.ty);
              delta.push(round3(px - setupVerts[i]), round3(py - setupVerts[i + 1]));
            }
            framesOut.push({ time: round3(t.time / 1000), vertices: delta, curve: t.tween ? undefined : 'stepped' });
          }
          if (framesOut.length) {
            // Spine 3.8 deform 结构:deform.<skinName>.<slotName>.<attachment>(必须带皮肤层)
            (aniObj.deform || (aniObj.deform = { default: {} }));
            (aniObj.deform.default[slotName] || (aniObj.deform.default[slotName] = {}));
            aniObj.deform.default[slotName][rec.attachment] = framesOut;
          }
        }
      }
    }

    // 汇总槽位时间线
    if (Object.keys(slotTimelines).length) {
      aniObj.slots = {};
      for (const [nm, tl] of Object.entries(slotTimelines)) {
        const o = {};
        if (tl.attachment && tl.attachment.length) o.attachment = tl.attachment;
        if (tl.color && tl.color.length) o.color = tl.color;
        if (Object.keys(o).length) aniObj.slots[nm] = o;
      }
    }
    animations[ani.name] = aniObj;
  }
  return animations;
}

// 从 lerpType=2 关键帧的 interp 流中取第 comp 分量的插值配置。
// 流布局(与官方 _onAnimationFrame 求值一致):每个 keyframeWidth 分量一个方法索引 ——
// 0=线性 1=四元数 2=角度 3=弧度 4=矩阵 5=保持(stepped) 6/7=贝塞尔(后跟 4 个控制点,共占 5 槽);
// 整帧特殊标记:首值 254=全分量线性、255=全分量保持。
function interpEntryAt(kf, comp) {
  const inter = kf && kf.interp;
  if (!inter || !inter.length) return null;
  if (inter[0] === 254) return { m: 0 };
  if (inter[0] === 255) return { m: 5 };
  let h = 0, f = 0;
  while (h < inter.length) {
    const m = inter[h];
    if (m === 6 || m === 7) {
      if (f === comp) return { m, ctrl: inter.slice(h + 1, h + 5) };
      h += 5;
    } else {
      if (f === comp) return { m };
      h += 1;
    }
    f++;
  }
  return null;
}

// 骨骼时间线帧曲线:comps = 该轨道涉及的 keyframeWidth 分量下标
// (translate→[4,5] rotate→[1] scale→[0,3])。返回 Spine curve 描述对象:
// null=线性 / {curve:'stepped'} / {curve,c2,c3,c4}=贝塞尔。分量间不一致时取第一个非线性者。
// ⚠️ 贝塞尔必须写成 curve=cx1 + c2/c3/c4 独立字段(spine38 vendor 的 readCurve
// 只认该形式;官方 3.8 两种都兼容),不能写裸数字 —— 会被当成 cx1 而缺 c2..c4,
// 形成退化贝塞尔,插值冻结到下一关键帧才跳变(ZhuangXu 部件「瞬移」的根因)。
function curveForComponents(node, fi, comps) {
  if (node.lerpType === 1) return { curve: 'stepped' };
  if (node.lerpType === 0) {
    for (const c of comps) {
      if ((node.interpMethods || [])[c] === 5) return { curve: 'stepped' };
    }
    return null;
  }
  if (node.lerpType === 2) {
    const kf = node.keyframes[fi];
    for (const c of comps) {
      const e = interpEntryAt(kf, c);
      if (!e) continue;
      if (e.m === 5) return { curve: 'stepped' };
      if ((e.m === 6 || e.m === 7) && e.ctrl && e.ctrl.length === 4) {
        return { curve: round3(e.ctrl[0]), c2: round3(e.ctrl[1]), c3: round3(e.ctrl[2]), c4: round3(e.ctrl[3]) };
      }
    }
  }
  return null;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ---------------- 顶层:单文件转换 ----------------
function skToSpine(inputPath, outputPath) {
  const buffer = fs.readFileSync(inputPath);
  const probe = probeLayaSk(buffer);
  if (!probe.ok) return { ok: false, error: probe.reason };
  const { model, audio } = parseSkRobust(buffer, inputPath);

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
  const { model, audio } = parseSkRobust(buffer, inputPath);

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
