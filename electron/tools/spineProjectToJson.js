/**
 * spineProjectToJson.js — 将 Spine 编辑器二进制工程文件(.spine)转换为明文 JSON。
 *
 * 用法:  node spineProjectToJson.js <file.spine> [输出.json]
 *
 * ── 格式说明(逆向工程所得, 针对项目版本 3.8.x, 由 4.x 编辑器保存的文件布局) ──
 *
 * 1. 文件整体: raw DEFLATE 压缩(无 zlib 头), 解压后为[tag][value]流。
 * 2. 数值:
 *    - 浮点: 4 字节大端 float32(全精度, 导出 JSON 的两位小数即由此四舍五入)
 *    - varint: 标准 protobuf 变长整数(高位为延续位)
 *    - 颜色: tag 后跟 "1e 01" + RGBA 四字节
 * 3. 字符串: 内联 = [01] + 逐字符(最后一个字符 |0x80 作终止标记);
 *    引用 = 裸 varint, 指向字符串驻留表(intern table)中的编号。
 *    整个文件共享一张驻留表, 相同字符串只写一次全文。
 * 4. 对象值: [2b] 标记后跟 [01 + 内联子对象] 或 [varint 引用]。
 *    例如插槽的 setup attachment 字段、动画关键帧的 attachment 引用。
 * 5. 对象图: 全文件对象按写入顺序分配递增 id, 骨骼=每根 4 个 id
 *    (骨骼本身 + 名称字符串 + 2 个子对象), 根/hip 因内联 "bone" 字符串各多 1 个。
 *    由此得出骨骼 id 表: root=8, hip=14, torso=19, front-upper-arm=23, ...
 *    rear-foot=79(本表由父引用与插槽骨骼引用双重校验)。
 * 6. 区块: [0f 01 <类型>] 标记(0x12=骨骼, 0x1b=插槽/附件, 0x07=动画...)。
 * 7. 记录: 骨骼 = "0c 01 1a 00 04 01" + 名称 + 字段; 插槽 = "01 0d 00 04 01" + 名称
 *    + 字段(02=骨骼引用); 附件 = [2b 01 10 几何字段...00] + 名称 + 标志;
 *    结束符 7e 00。边界框几何以 34 01 13 开头, 顶点在 "12 11 01 <n>" 后。
 * 8. 动画: 时间轴组 "13 01" 头部带目标引用, 时间轴 "14 01", 关键帧 "52 01 11 00
 *    <ref> 01 <ref>" 开头; 关键帧字段: 02=时间(帧, 30fps, 秒=帧/30),
 *    03=曲线(内联 01 <类型> 或引用), 04~07=贝塞尔控制点(默认线性 0.25/0/0.75/1),
 *    08=值(rotate 角度 / translate.x), 09=translate.y, 0d=attachment/事件引用等。
 *
 * 注意: 插槽/附件/时间轴的引用编号尚未完全映射到名称(需要完整的对象 id 分配
 * 模拟), 这些引用以原始数字输出在 *_ref 字段中; 骨骼引用已完全解析。
 * 未识别的编辑器簿记区段以 raw 十六进制保留, 不影响已验证数据的可读性。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function convert(file) {
  const raw = zlib.inflateRawSync(fs.readFileSync(file));
  const buf = raw;
  const sectionCounts = {}; // 各区块头 0f 01 <count> 中的计数(已验证:骨骼数/附件数/动画数)
  let p = 0;
  const u8 = () => buf[p++];
  const peek = (n = 0) => buf[p + n];
  const f32 = () => { const v = buf.readFloatBE(p); p += 4; return v; };
  const i32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const varint = () => { let v = 0, s = 0, b; do { b = u8(); v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
  const intern = new Map();
  const strv = () => {
    if (peek() === 0x01) { p++; let s = ''; for (;;) { const c = u8(); if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; }
    const id = varint(); return { __ref: id };
  };
  const namev = () => { expect(0x04, 0x01); return strv(); };
  const color = () => { const a = u8(); if (a !== 0x1e) err('color marker'); u8(); const c = buf.subarray(p, p + 4).toString('hex'); p += 4; return c; };
  function err(msg) { throw new Error(`@0x${p.toString(16)}: ${msg} | ctx: ${buf.subarray(Math.max(0, p - 24), p + 24).toString('hex')}`); }
  function expect(...bytes) { for (const b of bytes) if (u8() !== b) err(`expected ${bytes.map(x => x.toString(16)).join(' ')}`); }
  const r2 = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);

  // ── 头部: 扫描到骨骼区锚点 ──
  const version = (() => { let i = 5, s = ''; for (;;) { const c = buf[i++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; })();
  // 骨骼区头: 0f 01 <骨骼数>(ess=0x12=18 / pro=0x40=64),后跟首个骨骼记录 0c 01 1a 00。
  // 通用锚点:定位首个骨骼记录,再回扫 3 字节取区块头中的骨骼数。
  const firstBone = buf.indexOf(Buffer.from('0c011a00', 'hex'));
  if (firstBone < 4) throw new Error('未找到骨骼区(0c 01 1a 00)');
  let boneCount = null;
  if (buf[firstBone - 3] === 0x0f && buf[firstBone - 2] === 0x01) boneCount = buf[firstBone - 1];
  const boneMark = firstBone - 3;
  const projName = scanString(boneMark);
  function scanString(from) { // 在头部区域宽松提取字符串(项目名)
    let i = Math.max(0, from - 60);
    while (i < boneMark) {
      let s = '', j = i, ok = false;
      while (j < boneMark) { const c = buf[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); ok = true; break; } if (c < 0x20) break; s += String.fromCharCode(c); if (s.length > 60) break; }
      if (ok && s.length > 3) return s;
      i = j;
    }
    return null;
  }
  const imagesName = (() => { const i = buf.indexOf(Buffer.from('2e2f', 'hex'), 0x10); if (i < 0) return ''; let s = ''; let j = i; for (;;) { const c = buf[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; })();
  p = firstBone;

  // ── 骨骼 ──
  const bones = [];
  function parseBone() {
    expect(0x0c, 0x01, 0x1a, 0x00);
    const b = { name: namev() };
    if (typeof b.name !== 'string') b.name = '#ref' + b.name.__ref;
    for (;;) {
      const t = u8();
      if (t === 0x02) u8();
      else if (t === 0x03) b.parentRef = varint();
      else if (t === 0x04) b.x = f32();
      else if (t === 0x05) b.y = f32();
      else if (t === 0x06) b.rotation = f32();
      else if (t === 0x07) b.scaleX = f32();
      else if (t === 0x08) b.scaleY = f32();
      else if (t === 0x09) b.length = f32();
      else if (t === 0x0a) b.x2 = f32();
      else if (t === 0x0b) b.y2 = f32();
      else if (t === 0x0c) b.rotation2 = f32();
      else if (t === 0x0d) b.scaleX2 = f32();
      else if (t === 0x0e) b.scaleY2 = f32();
      else if (t === 0x11) b.color = color();
      else if (t >= 0x17 && t <= 0x1a) f32();
      else if (t === 0x1b) { // 标志字段:普通骨骼单值 0b;root/带变换模式骨骼为 [01, <mode>] 双值
        const v = varint();
        if (v === 1) b.transformMode_raw = u8();
        b.inheritFlags = v;
      }
      else if (t === 0x1c) { const v = strv(); if (typeof v === 'string') { b.nodeType = v; b._typeInline = true; } else { b.nodeTypeRef = v.__ref; } }
      else if (t === 0x1d) varint();
      else if (t === 0x1e) varint();
      else if (t === 0x1f) break;
      else err('bone tag ' + t.toString(16));
    }
    expect(0x0f); u8(); u8(); expect(0x7e, 0x00);
    bones.push(b);
  }
  while (peek() === 0x0c && peek(1) === 0x01) parseBone();

  // 骨骼 id 表:对象图按写入顺序分配 id(每骨骼 4 个:骨骼+名称字符串+2 子对象);
  // root 记录的 1b 额外字节 +1;类型串(1c)内联首现 +1(ess: root/hip 内联 "bone";pro: crosshair 等内联 "circle")。
  // 按实际解析到的内联情况自模拟,不再硬编码 ess 的布局。
  const boneId = new Map();
  const nameStrId = new Map();
  {
    let id = 8;
    bones.forEach((b) => {
      boneId.set(id, b.name);
      intern.set(id + 1, b.name);
      nameStrId.set(id + 1, b.name);
      id += 4;
      if (b.transformMode_raw !== undefined) id += 1; // 1b 双值形态多占一个 id
      if (b._typeInline) id += 1;
    });
  }
  const resolveRef = (id) => intern.get(id) ?? nameStrId.get(id);
  bones.forEach(b => { b.parent = boneId.get(b.parentRef) ?? null; delete b.parentRef; delete b._typeInline; });

  // ── 插槽与附件区 ──
  // 区块头: 0f 01 <count>(count=附件总数,ess=27/pro=80;已验证);pro 其后另有若干头部杂项字节
  // (0f 01 50 54 01 14),容忍跳过 —— 扫描到第一个锚点(插槽 0d 00 04 01 / 附件几何 / 裸多边形)。
  {
    u8(); // 06 = 骨骼区结束标记
    if (peek() === 0x0f && peek(1) === 0x01) { p += 3; sectionCounts.slotsAttachments = buf[p - 1]; }
    let guard = 0;
    while (guard++ < 32 && !(
      (peek() === 0x01 && peek(1) === 0x0d && peek(2) === 0x00) ||
      ((peek() === 0x2b || peek() === 0x34 || peek() === 0x2e) && peek(1) === 0x01) ||
      (peek() === 0x07 && peek(2) === 0x08) || // 裸多边形开头 07 XX 08 10
      (peek() === 0x0c && peek(1) === 0x01 && peek(2) === 0x0d && peek(3) === 0x00) // pro 首插槽前缀 0c 01 0d 00
    )) p++;
  }
  const slots = [], attachments = [];
  const DBG = !!process.env.SPJ_DEBUG;
  const dbg = (kind, extra) => { if (DBG) console.error(`[spj] 0x${p.toString(16)} ${kind} ${extra || ''}`); };
  /** 浮点列表: 11 01 <n> <n × f32>(uvs/顶点/变形等) */
  function parseFloatList() { expect(0x11, 0x01); const n = varint(); const a = []; for (let i = 0; i < n; i++) a.push(f32()); return a; }
  /** 未知编辑器簿记 → 跳到对象尾部 "1e 01 <RGBA> 00" 并读取颜色 */
  function skipToColorEnd(d) { while (p < buf.length - 6 && !(buf[p] === 0x1e && buf[p + 1] === 0x01 && buf[p + 6] === 0x00)) p++; d.color = color(); u8(); }
  /** 多边形体(边界框/裁剪/网格共用): 07<顶点数×4> 08<hull×4> 01<n><边×2字节> 09 0a 0b 12<顶点> 13 14 15 [簿记] 颜色 00 */
  function parsePolygon(d) {
    for (;;) {
      const t = u8();
      if (t === 0x07) d.vertexCount = Math.round(varint() / 4);
      else if (t === 0x08) d.hull = Math.round(varint() / 4);
      else if (t === 0x01) { const n = varint(); const e = []; for (let i = 0; i < n; i++) e.push(u8()); d.edges = e; }
      else if (t === 0x09) d.f09 = f32();
      else if (t === 0x0a) d.f0a = f32();
      else if (t === 0x0b) d.f0b = f32();
      else if (t === 0x12) d.vertices = parseFloatList();
      else if (t === 0x13) d.f13 = f32();
      else if (t === 0x14) d.f14 = f32();
      else if (t === 0x15) d.f15 = f32();
      else if (t === 0x1e) d.color = color();
      else if (t === 0x00) break;
      else { skipToColorEnd(d); break; }
    }
  }
  function parseGeomBody(type) {
    const d = { type: type === 0x10 ? 'region' : type === 0x13 ? 'boundingbox' : type === 0x1b ? 'mesh' : 'type' + type.toString(16) };
    if (type === 0x10) { // region
      for (;;) {
        const t = u8();
        if (t === 0x06) d.x = f32();
        else if (t === 0x07) d.y = f32();
        else if (t === 0x08) d.scaleX = f32();
        else if (t === 0x09) d.scaleY = f32();
        else if (t === 0x0a) d.rotation = f32();
        else if (t === 0x0b) d.width = f32();
        else if (t === 0x0c) d.height = f32();
        else if (t === 0x0d) { // varint 引用(0d ce 02 等;ess 中另有 01 81 形态 —— 首字节低位的后跟高位置字节一并消费)
          const raw = [u8()];
          if (raw[0] & 0x80) { while (raw[raw.length - 1] & 0x80) raw.push(u8()); }
          else if (peek() >= 0x80) raw.push(u8());
          d.f0d_raw = raw.map(x => x.toString(16)).join(' ');
        }
        else if (t === 0x0e) d.color = color();
        else if (t === 0x00) break;
        else d['t' + t.toString(16)] = f32();
      }
    } else if (type === 0x1b) { // mesh: 0c<uvs> 0d<ref> 01<n><n×uint16BE 三角形> 0e<ref> 10<宽> 11<高> 1a 1b 22 <多边形> [簿记]
      for (;;) {
        const t = u8();
        if (t === 0x0c) d.uvs = parseFloatList();
        else if (t === 0x0d) d.f0d_ref = varint();
        else if (t === 0x01) { const n = varint(); const tri = []; for (let i = 0; i < n; i++) tri.push((u8() << 8) | u8()); d.triangles = tri; }
        else if (t === 0x0e) d.f0e_ref = varint();
        else if (t === 0x10) d.width = f32();
        else if (t === 0x11) d.height = f32();
        else if (t === 0x1a) d.f1a = varint();
        else if (t === 0x1b) d.f1b = varint();
        else if (t === 0x22) d.f22 = varint();
        else if (t === 0x07) { p--; parsePolygon(d); break; } // 进入多边形体
        else if (t === 0x1e) d.color = color();
        else if (t === 0x00) break;
        else { skipToColorEnd(d); break; }
      }
    } else { // boundingbox / clipping(裸多边形) / 其它
      p--; parsePolygon(d);
    }
    return d;
  }
  const flagTags = new Set([0x04, 0x05, 0x20, 0x21, 0x23]);
  let curAtt = null;
  let curSlotName = null; // 当前插槽名:未解析名称引用的附件(名=插槽名的驻留前向引用)以此补全
  // 区块结束: 07 0f 01 <动画数> 12 01(后必跟动画记录,ess=07/pro=0b;强锚点避免数据中误触发)
  const sectionEnd = () => (peek() === 0x07 && peek(1) === 0x0f && peek(2) === 0x01 && peek(4) === 0x12 && peek(5) === 0x01) || (peek() === 0x0f && peek(1) === 0x01 && peek(3) === 0x12 && peek(4) === 0x01);
  // 几何标记后跟合法字段标签(region:06-0e / mesh:0c / bbox:07),降低浮点数据中杂散 2b 01 10 的误报
  const isGeomStart = () => (peek() === 0x2b || peek() === 0x34 || peek() === 0x2e) && peek(1) === 0x01
    && ((peek(2) === 0x10 && peek(3) >= 0x06 && peek(3) <= 0x0e) || (peek(2) === 0x1b && peek(3) === 0x0c) || (peek(2) === 0x13 && peek(3) === 0x07));
  const isBarePolygon = () => peek() === 0x07 && peek(2) === 0x08 && peek(3) === 0x10 && peek(4) === 0x01;
  const isSlotStart = () => (peek() === 0x01 && peek(1) === 0x0d && peek(2) === 0x00) || (peek() === 0x0c && peek(1) === 0x01 && peek(2) === 0x0d && peek(3) === 0x00);
  /**
   * 严格锚点的附件名节点: [lead varint]? 01 (01+内联字符 | varint引用) 04 00 [05 01 20 00] 21 01 23 00
   * 名称后必须紧跟 04 00 标志对 —— 逐字节向前探测,任何一环不符返回 null(调用方跳 1 字节重同步)。
   */
  function tryNameNode() {
    let q = p, lead = null;
    if (buf[q] !== 0x01) {
      // lead varint(1-2 字节)
      if (buf[q] === undefined) return null;
      const s0 = q;
      let v = 0, sh = 0, b;
      do { b = buf[q]; if (b === undefined) return null; v |= (b & 0x7f) << sh; sh += 7; q++; } while ((b & 0x80) && q - s0 < 2);
      if (v > 0xfff) return null;
      lead = v;
    }
    if (buf[q] !== 0x01) return null;
    q++;
    let name = null;
    if (buf[q] === 0x01) { // 内联字符串:ASCII 字符,末字符高位置位
      q++;
      let s = '';
      for (let g = 0; g < 64; g++) {
        const c = buf[q];
        if (c === undefined) return null;
        if (c & 0x80) { if ((c & 0x7f) < 0x20 || (c & 0x7f) > 0x7e) return null; s += String.fromCharCode(c & 0x7f); q++; break; }
        if (c < 0x20 || c > 0x7e) return null;
        s += String.fromCharCode(c); q++;
      }
      if (!s) return null;
      name = s;
    } else { // varint 引用
      const s0 = q;
      let v = 0, sh = 0, b;
      do { b = buf[q]; if (b === undefined) return null; v |= (b & 0x7f) << sh; sh += 7; q++; } while ((b & 0x80) && q - s0 < 3);
      if (v > 0xffff) return null;
      name = { __ref: v };
    }
    // 名称后必须紧跟 04 00(标志对,强校验)
    if (buf[q] !== 0x04 || buf[q + 1] !== 0x00) return null;
    q += 2;
    // 消费名称节点主体并应用到当前附件
    p = q;
    if (typeof name === 'string') { if (curAtt) curAtt.name = name; }
    else if (curAtt) { const rs = resolveRef(name.__ref); if (rs) curAtt.name = rs; else curAtt.name_ref = name.__ref; }
    if (lead !== null && curAtt && curAtt.lead_ref === undefined) curAtt.lead_ref = lead;
    // 标志尾: 04 00 已消费;吃掉 05 01 20 00 / 20 00 / 21 01 / 23 00 等标志对
    for (let g = 0; g < 6 && p < buf.length; g++) {
      const t = peek();
      if (t === 0x05 && peek(1) === 0x01 && peek(2) === 0x20 && peek(3) === 0x00) { p += 4; }
      else if (t === 0x20 || t === 0x21 || t === 0x23) { p += 2; }
      else if (t === 0x04 || t === 0x05) { p += 2; }
      else break;
    }
    return true;
  }
  while (!sectionEnd() && p < buf.length - 4) {
    if (isGeomStart()) {
      const st = p;
      u8(); u8();
      const ty = u8();
      curAtt = parseGeomBody(ty);
      curAtt._slotHint = curSlotName;
      attachments.push(curAtt);
      if (DBG) console.error(`[spj] 0x${st.toString(16)} GEOM ${curAtt.type}`);
      continue;
    }
    if (isBarePolygon()) { // 裁剪附件等:插槽记录后直接跟多边形体(无 2b/2e/34 标记)
      curAtt = { type: 'clipping?' };
      curAtt._slotHint = curSlotName;
      parsePolygon(curAtt);
      attachments.push(curAtt);
      continue;
    }
    if (peek() === 0x2b && !isGeomStart()) { u8(); const ref = varint(); if (curAtt) curAtt.link_ref = ref; continue; }
    if (isSlotStart()) {
      const slotAt = p;
      if (peek() === 0x0c) u8();
      p += 3;
      const nm = namev();
      const slot = { name: typeof nm === 'string' ? nm : (resolveRef(nm.__ref) ?? '#ref' + nm.__ref) };
      const slotTags = new Set([0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x7e]);
      for (;;) {
        if (!slotTags.has(peek())) {
          if (isGeomStart()) { u8(); u8(); curAtt = parseGeomBody(u8()); attachments.push(curAtt); continue; }
          if (isBarePolygon()) { curAtt = { type: 'clipping?' }; parsePolygon(curAtt); attachments.push(curAtt); continue; }
          if (tryNameNode()) continue;
          p++; // 未知字节:跳 1 字节重同步
          continue;
        }
        const t = u8();
        if (t === 0x02) { const r = varint(); if (slot.bone === undefined) slot.bone = boneId.get(r) ?? ('#ref' + r); }
        else if (t === 0x03) slot.f03 = varint();
        else if (t === 0x04) { slot.color = peek() === 0x1e ? color() : undefined; if (slot.color === undefined) varint(); }
        else if (t === 0x05) { if (peek() === 0x1e) slot.color2 = color(); else if (peek() === 0x01 && peek(1) === 0x20 && peek(2) === 0x00) p += 3; else varint(); }
        else if (t === 0x07) { const v = varint(); slot.f07 = v === 1 ? [v, u8()] : v; }
        else if (t === 0x08 || t === 0x09) {
          const k = t === 0x08 ? 'attachment_ref' : 'f09_ref';
          if (isGeomStart()) { u8(); u8(); if (peek() === 0x01) { u8(); const d = parseGeomBody(u8()); d._slotHint = curSlotName; attachments.push(d); curAtt = d; } else slot[k] = varint(); }
          else if (isBarePolygon()) { curAtt = { type: 'clipping?' }; curAtt._slotHint = curSlotName; parsePolygon(curAtt); attachments.push(curAtt); }
          else if (peek() === 0x2b || peek() === 0x2e || peek() === 0x34) { const mk = u8(); if (peek() === 0x01) { u8(); const d = parseGeomBody(u8()); d._slotHint = curSlotName; attachments.push(d); curAtt = d; } else slot[k] = varint(); } // 对象标记(2b/2e/34):01=内联几何,否则 varint 引用
          else if (peek() === 0x00) u8();
          else slot[k + '_raw'] = varint();
        }
        else if (t === 0x0a) { if (peek() === 0x1e) slot.darkColor = color(); else varint(); }
        else if (t === 0x0b) { if (peek() === 0x1e) slot.darkColor2 = color(); else varint(); }
        else if (t === 0x0c) slot.f0c = varint();
        else if (t === 0x7e) { u8(); break; }
      }
      curSlotName = slot.name;
      slots.push(slot);
      if (DBG) console.error(`[spj] 0x${slotAt.toString(16)} SLOT ${slot.name}`);
      continue;
    }
    // 顶层附件名(严格模式):不匹配任何锚点 → 跳 1 字节重同步
    if (!tryNameNode()) p++;
  }

  // ── 动画区 ──
  const animations = {};
  let anim = null, group = null, tl = null;
  function isGroupTrailer() {
    if (peek() !== 0x03) return false;
    let q = p + 1, b; do { b = buf[q]; q++; } while (b & 0x80 && q < buf.length);
    return buf[q] === 0x04 && buf[q + 1] === 0x00 && buf[q + 2] === 0x05 && buf[q + 3] === 0x00 && buf[q + 4] === 0x06;
  }
  function isRecordStart() {
    const b = peek();
    if (b === 0x52) return peek(1) === 0x01 && peek(2) === 0x11 && peek(3) === 0x00; // 键=52 01 11 00 四字节锚点(防浮点数据中的杂散 52)
    return b === 0x12 || b === 0x13 || b === 0x14 || (b === 0x0f && peek(1) === 0x01) || isGroupTrailer();
  }
  function parseKey() {
    expect(0x52, 0x01, 0x11, 0x00);
    const refA = varint();
    const refB = peek() === 0x01 ? (p++, varint()) : null;
    const k = { refA, refB };
    for (;;) {
      if (isRecordStart()) break;
      const t = u8();
      if (t === 0x02) k.time = f32();
      else if (t === 0x03) { if (peek() === 0x01) { p++; k.curveType = u8(); } else k.curveRef = varint(); }
      else if (t === 0x04) k.c1 = f32();
      else if (t === 0x05) k.c2 = f32();
      else if (t === 0x06) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } k.eventName = s2; } else k.c3 = f32(); }
      else if (t === 0x07) k.c4 = f32();
      else if (t === 0x08) k.v1 = f32();
      else if (t === 0x09) k.v2 = f32();
      else if (t === 0x0a) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } if (k.eventName === undefined) k.eventName = s2; } else k.v3 = f32(); }
      else if (t === 0x0b) k.v4 = f32();
      else if (t === 0x0c) { if (peek() === 0x11 && peek(1) === 0x01) k.values = parseFloatList(); else k.f0c = varint(); }
      else if (t === 0x12) { if (peek() === 0x11 && peek(1) === 0x01) k.values = k.values || parseFloatList(); else k.f12 = varint(); }
      else if (t === 0x0d) { if (peek() === 0x2b) { p++; k.attachment_ref = varint(); } else k.f0d = varint(); }
      else if (t === 0x0e) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } k.eventName = s2; } else k.f0e = varint(); }
      else if (t === 0x0f) k.f0f = varint();
      else if (t === 0x10) k.f10 = varint();
      else if (t === 0x11) k.f11 = i32();
      else k['t' + t.toString(16)] = varint();
    }
    return k;
  }
  let guard = 0;
  const animStart = p;
  while (p < buf.length && guard++ < 500000) {
    if (peek() === 0x07 && peek(1) === 0x0f && peek(2) === 0x01) { p += 4; continue; }
    if (peek() === 0x12 && peek(1) === 0x01) {
      p += 2; u8(); u8();
      expect(0x04, 0x01);
      const nm = strv();
      anim = { timelines: [] };
      animations[typeof nm === 'string' ? nm : (resolveRef(nm.__ref) ?? '#ref' + nm.__ref)] = anim;
      group = tl = null; u8();
      continue;
    }
    if (peek() === 0x0f && peek(1) === 0x01) { p += 3; continue; }
    if (peek() === 0x13 && peek(1) === 0x01) {
      p += 2;
      group = { target: null, refA: null, refB: null };
      if (peek() === 0x04 && peek(1) === 0x00) { p += 2; group.refA = varint(); }
      if (peek() === 0x01) { p++; group.refB = varint(); group.target = boneId.get(group.refB) ?? null; }
      continue;
    }
    if (peek() === 0x14 && peek(1) === 0x01) {
      p += 2;
      tl = { group_refA: group?.refA ?? null, group_refB: group?.refB ?? null, target: group?.target ?? null, keys: [] };
      if (peek() === 0x09 && peek(1) === 0x00) { p += 2; tl.refA = varint(); }
      if (peek() === 0x01) { p++; tl.refB = varint(); }
      const trail = [];
      while (peek() !== 0x0f && peek() !== 0x52 && trail.length < 8) trail.push(u8().toString(16));
      tl.trail_raw = trail.join(' ');
      if (anim) anim.timelines.push(tl);
      continue;
    }
    if (peek() === 0x03 && isGroupTrailer()) { p++; varint(); p += 10; continue; }
    if (peek() === 0x52 && peek(1) === 0x01 && peek(2) === 0x11 && peek(3) === 0x00) { const k = parseKey(); if (tl) tl.keys.push(k); continue; }
    u8(); // 未识别字节, 跳过续扫
  }
  const animEnd = p;

  // ── 尾部原始区(事件定义/皮肤/导出设置等) ──
  const tail = buf.subarray(animEnd);
  const tailStrings = [];
  { let i = 0; while (i < tail.length) { let s = '', j = i, ok = false; while (j < tail.length) { const c = tail[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); ok = true; break; } if (c === 0) break; s += String.fromCharCode(c); if (s.length > 100) break; } if (ok && s.length >= 2 && /^[\x20-\x7e]+$/.test(s)) tailStrings.push(s); i = j; } }

  // ── 输出 ──
  const roundKey = (k) => {
    const o = {
      time: r2((k.time ?? 0) / 30),
    };
    if (k.eventName !== undefined) o.event = k.eventName;
    if (k.v1 !== undefined) o.value = r2(k.v1);
    if (k.v2 !== undefined) o.value2 = r2(k.v2);
    if (k.attachment_ref !== undefined) o.attachment_ref = k.attachment_ref;
    const linear = Math.abs((k.c1 ?? 0) - 0.25) < 1e-6 && (k.c2 ?? 0) === 0 && Math.abs((k.c3 ?? 0) - 0.75) < 1e-6 && (k.c4 ?? 0) === 1;
    if (k.c1 !== undefined && !linear) o.curve = [r2(k.c1), r2(k.c2), r2(k.c3), r2(k.c4)];
    o.ref = k.refA + '/' + k.refB;
    return o;
  };
  const out = {
    _format: {
      source: path.basename(file),
      spineProjectVersion: version,
      generator: 'spineProjectToJson.js (reverse-engineered .spine reader)',
      notes: '时间已换算为秒(帧/30); *_ref 为编辑器内部对象引用编号; raw 字段为未完全逆向的编辑器数据。',
    },
    skeleton: { name: projName, images: imagesName, spine: version },
    bones: bones.map(b => {
      const o = { name: b.name };
      if (b.parent) o.parent = b.parent;
      // 0a-0e 组 = setup 姿势(与导出 JSON 精确一致);04-09 组另存 _pose(编辑器当前姿态,ess 中两组相同)
      const sx = b.x2 !== undefined ? b.x2 : b.x, sy = b.y2 !== undefined ? b.y2 : b.y;
      const srot = b.rotation2 !== undefined ? b.rotation2 : b.rotation;
      const ssx = b.scaleX2 !== undefined ? b.scaleX2 : b.scaleX, ssy = b.scaleY2 !== undefined ? b.scaleY2 : b.scaleY;
      if (sx) o.x = r2(sx);
      if (sy) o.y = r2(sy);
      if (srot) o.rotation = r2(srot);
      if (b.length) o.length = r2(b.length);
      if (ssx !== undefined && ssx !== 1) o.scaleX = r2(ssx);
      if (ssy !== undefined && ssy !== 1) o.scaleY = r2(ssy);
      if (b.color) o.color = b.color;
      if (b.inheritFlags !== undefined) o.inheritFlags_raw = b.inheritFlags;
      return o;
    }),
    slots: slots.map(s => {
      const o = { name: s.name, bone: s.bone };
      if (s.color) o.color = s.color;
      if (s.darkColor) o.darkColor = s.darkColor;
      if (s.attachment_ref !== undefined) o.attachment_ref = s.attachment_ref;
      if (s.f07 !== undefined) o.f07_raw = s.f07;
      return o;
    }),
    attachments: attachments.map(a => {
      // 未解析名称引用(#ref)保留原始编号;slot_hint = 所属插槽名(多插槽共享附件时仅供参考)
      const o = { name: a.name ?? ('#ref' + (a.name_ref ?? '?')) };
      if (!a.name && a._slotHint) o.slot_hint = a._slotHint;
      if (a.type) o.type = a.type;
      if (a.x !== undefined) o.x = r2(a.x);
      if (a.y !== undefined) o.y = r2(a.y);
      if (a.rotation !== undefined) o.rotation = r2(a.rotation);
      if (a.width !== undefined) o.width = r2(a.width);
      if (a.height !== undefined) o.height = r2(a.height);
      if (a.scaleX !== undefined && a.scaleX !== 1) o.scaleX = r2(a.scaleX);
      if (a.scaleY !== undefined && a.scaleY !== 1) o.scaleY = r2(a.scaleY);
      if (a.vertices) o.vertices = a.vertices.map(r2);
      if (a.vertexCount) o.vertexCount = a.vertexCount;
      if (a.edges_raw) o.edges_raw = a.edges_raw;
      if (a.color && a.color !== 'ffffffff') o.color = a.color;
      if (a.lead_ref !== undefined) o.lead_ref = a.lead_ref;
      if (a.link_ref !== undefined) o.link_ref = a.link_ref;
      return o;
    }),
    animations: Object.fromEntries(Object.entries(animations).map(([name, a]) => [name, {
      timelines: a.timelines.map(t => ({
        kind: t.keys.some(k => k.attachment_ref !== undefined) ? 'attachment' : t.keys.some(k => k.eventName !== undefined) ? 'event' : t.keys.some(k => (k.v2 ?? 0) !== 0) ? 'translate' : t.keys.some(k => k.v1 !== undefined) ? 'rotate' : t.keys.length ? 'other' : 'empty',
        target: t.target ?? undefined,
        group_refs: [t.group_refA, t.group_refB],
        refs: [t.refA ?? null, t.refB ?? null],
        trail_raw: t.trail_raw,
        keys: t.keys.map(roundKey),
      })),
    }])),
    _tail: {
      offset: '0x' + animEnd.toString(16),
      length: tail.length,
      note: '动画区之后的编辑器数据(事件定义/皮肤/导出设置等), 尚未完全解析',
      strings: tailStrings,
      hex_preview: '0x' + Math.min(tail.length, 256).toString(16) + ' bytes: ' + tail.subarray(0, 256).toString('hex'),
    },
  };
  return out;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法: node spineProjectToJson.js <file.spine> [输出.json]'); process.exit(1); }
  const out = convert(file);
  const outFile = process.argv[3] || file.replace(/\.spine$/i, '') + '.decoded.json';
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`已转换: ${file}\n输出: ${outFile}`);
  console.log(`骨骼 ${out.bones.length}, 插槽 ${out.slots.length}, 附件 ${out.attachments.length}, 动画 ${Object.keys(out.animations).length}`);
}

/**
 * 轻量探测:文件是否为可识别的 Spine 编辑器二进制工程(.spine)。
 * 校验:① 能以 raw DEFLATE 解压;② 头部前 32 字节内存在 x.y.z 版本串;
 * ③ 解压数据含骨骼区标记 0f 01 12。失败时抛错(错误信息即原因)。
 */
function probe(filePath) {
  let raw;
  try {
    raw = zlib.inflateRawSync(fs.readFileSync(filePath));
  } catch (e) {
    throw new Error('不是 Spine 工程文件(raw DEFLATE 解压失败)');
  }
  if (!raw || raw.length < 16) throw new Error('不是 Spine 工程文件(解压后数据过短)');
  // 头部版本串:逐字符、末字符高位置 1 终止;在偏移 0..32 内扫描以提高容错
  let version = null;
  for (let off = 0; off + 4 <= Math.min(32, raw.length) && !version; off++) {
    if (!/\d/.test(String.fromCharCode(raw[off]))) continue;
    let s = '';
    for (let i = off; i < raw.length; i++) {
      const c = raw[i];
      if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; }
      if (c < 0x20) break;
      s += String.fromCharCode(c);
      if (s.length > 24) break;
    }
    if (/^(\d+)\.(\d+)\.(\d+)$/.test(s)) version = s;
  }
  if (!version) throw new Error('未检测到工程版本号(x.y.z)');
  if (raw.indexOf(Buffer.from([0x0f, 0x01, 0x12])) < 0) {
    throw new Error('未检测到骨骼区标记,不是 Spine 工程文件');
  }
  return { ok: true, version };
}

/** 转换并写盘(主进程 IPC 用):{ inputPath, outputPath } → { ok, outputPath, version, stats } */
function convertFile({ inputPath, outputPath }) {
  if (!inputPath || !outputPath) throw new Error('缺少输入或输出路径');
  const out = convert(inputPath);
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  let keyCount = 0;
  for (const a of Object.values(out.animations || {})) {
    for (const t of a.timelines || []) keyCount += (t.keys || []).length;
  }
  return {
    ok: true,
    outputPath,
    version: out.skeleton && out.skeleton.spine,
    stats: {
      bones: out.bones.length,
      slots: out.slots.length,
      attachments: out.attachments.length,
      animations: Object.keys(out.animations || {}).length,
      timelineKeys: keyCount,
    },
  };
}

module.exports = { convert, probe, convertFile };
