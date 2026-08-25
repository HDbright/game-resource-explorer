'use strict';
/**
 * makeTestSpine.js — 合成最小可解码的 Spine 编辑器工程文件(.spine)。
 *
 * 按逆向工程所得的工程二进制格式(spineProjectToJson.js 文档)构造字节流:
 *   raw DEFLATE 压缩 + [tag][value] 流;字符串内联 = 01 + 逐字符(末字符 |0x80);
 *   f32 大端;varint 标准 protobuf;骨骼对象 id 从 8 起、每骨骼 +4。
 * 产物供骨骼动画编辑器「打开 Spine 工程文件」端到端冒烟(渲染端 smoke 步骤
 * boneeditor-spineproj)与解码器回归使用;也可单独运行:
 *   node scripts/makeTestSpine.js [输出路径]  (默认 %TEMP%/spine-smoke-test.spine)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- 基础写入原语(与解码器读取端一一对应) ----
const f32be = (v) => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(v, 0);
  return b;
};
const varint = (v) => {
  const out = [];
  let x = v >>> 0;
  do { let byte = x & 0x7f; x >>>= 7; if (x) byte |= 0x80; out.push(byte); } while (x);
  return Buffer.from(out);
};
/** 内联字符串:01 + 逐字符 ASCII,末字符 |0x80 作终止标记 */
const strInline = (s) => {
  const cs = [...s].map((ch) => ch.charCodeAt(0) & 0x7f);
  cs[cs.length - 1] |= 0x80;
  return Buffer.from([0x01, ...cs]);
};

/**
 * 合成 .spine 文件字节(raw DEFLATE 前的明文字节流)。
 * 内容:2 骨骼(root / hip)、2 插槽(body→hip 带色 / head→root)、
 * 2 个 region 附件(body-img / head-img,随所属插槽记录后出现)、
 * 1 个动画 walk(hip 的 translate 时间线 2 个关键帧,帧 0 与帧 15)。
 */
function buildSpineProjectBytes() {
  const parts = [];
  const B = (...bufs) => parts.push(...bufs);

  // ---- 头部:5 字节前导 + 版本串(偏移 5 起裸字符,末字符 |0x80 终止;convert 的版本读取器无 01 前缀) ----
  const verChars = [...'4.1.24'].map((ch) => ch.charCodeAt(0) & 0x7f);
  verChars[verChars.length - 1] |= 0x80;
  B(Buffer.alloc(5), Buffer.from(verChars));

  // ---- 骨骼区:0f 01 <骨骼数> + 骨骼记录(0c 01 1a 00 04 01 <名> <字段> 1f 0f 00 00 7e 00) ----
  // 骨骼对象 id:root=8、hip=12(每骨骼 4 个 id;父引用写父骨骼 id)
  // 字段 tag:03=父引用 04=x 05=y 06=rotation 07=scaleX 08=scaleY 09=length(f32 大端)
  B(Buffer.from([0x0f, 0x01, 0x02]));
  const bone = (name, fields) => {
    B(Buffer.from([0x0c, 0x01, 0x1a, 0x00, 0x04, 0x01]), strInline(name), fields, Buffer.from([0x1f, 0x0f, 0x00, 0x00, 0x7e, 0x00]));
  };
  bone('root', Buffer.concat([Buffer.from([0x04]), f32be(0), Buffer.from([0x05]), f32be(0), Buffer.from([0x09]), f32be(60)]));
  bone('hip', Buffer.concat([Buffer.from([0x03]), varint(8), Buffer.from([0x04]), f32be(10.5), Buffer.from([0x05]), f32be(-2.25), Buffer.from([0x06]), f32be(90), Buffer.from([0x07]), f32be(1.2), Buffer.from([0x08]), f32be(1), Buffer.from([0x09]), f32be(40)]));

  // ---- 插槽/附件区:06 结束标记 + 0f 01 <附件总数> + [插槽记录 + 附件几何 + 附件名节点] ----
  // region 附件:2b 01 10 <几何 tag 值…> 00 + 名节点 01 (01+内联名) 04 00
  const slot = (name, boneId, colorHex) => {
    B(Buffer.from([0x01, 0x0d, 0x00, 0x04, 0x01]), strInline(name), Buffer.from([0x02]), varint(boneId));
    if (colorHex) {
      B(Buffer.from([0x04, 0x1e, 0x01]), Buffer.from(colorHex, 'hex'));
    }
    B(Buffer.from([0x7e, 0x00]));
  };
  const region = (name, x, width, height, rotation) => {
    B(Buffer.from([0x2b, 0x01, 0x10]));
    B(Buffer.from([0x06]), f32be(x));
    if (rotation !== undefined) B(Buffer.from([0x0a]), f32be(rotation));
    B(Buffer.from([0x0b]), f32be(width), Buffer.from([0x0c]), f32be(height), Buffer.from([0x00]));
    // 附件名节点:01 对象标记 + 01 内联字符串 + 04 00 标志对(与 tryNameNode 严格锚点一致)
    B(Buffer.from([0x01]), strInline(name), Buffer.from([0x04, 0x00]));
  };
  const attCount = 2;
  B(Buffer.from([0x06, 0x0f, 0x01, attCount]));
  slot('body', 12, 'ffaa00ff');
  region('body-img', 3.5, 100, 200, 15);
  slot('head', 8, null);
  region('head-img', 0, 64, 64, undefined);

  // ---- 动画区:07 0f 01 <动画数> + 动画记录 + 时间线组/时间线/关键帧 ----
  B(Buffer.from([0x07, 0x0f, 0x01, 0x01])); // 区块结束标记 + 动画数 1
  B(Buffer.from([0x12, 0x01, 0x00, 0x00, 0x04, 0x01]), strInline('walk'), Buffer.from([0x00]));
  // 时间线组:13 01 01 <骨骼id>(refB → hip=12)
  B(Buffer.from([0x13, 0x01, 0x01]), varint(12));
  // 时间线:14 01(无 ref 字段)
  B(Buffer.from([0x14, 0x01]));
  // 关键帧:52 01 11 00 <refA> 02 <时间·帧> 08 <v1> [09 <v2>]
  const key = (frame, v1, v2) => {
    B(Buffer.from([0x52, 0x01, 0x11, 0x00, 0x01]));
    B(Buffer.from([0x02]), f32be(frame), Buffer.from([0x08]), f32be(v1));
    if (v2 !== undefined) B(Buffer.from([0x09]), f32be(v2));
  };
  key(0, 0, 0);
  key(15, 12.5, -3.3);
  // 尾部 0f 01 12:动画区 3 字节跳过记录;同时让 probe 的「0f 01 12 骨骼区标记」检查通过
  B(Buffer.from([0x0f, 0x01, 0x12]));

  return zlib.deflateRawSync(Buffer.concat(parts));
}

/** 写出合成 .spine;返回绝对路径 */
function writeTestSpine(outPath) {
  const p = outPath || path.join(require('os').tmpdir(), 'spine-smoke-test.spine');
  fs.writeFileSync(p, buildSpineProjectBytes());
  return p;
}

module.exports = { buildSpineProjectBytes, writeTestSpine };

if (require.main === module) {
  const p = writeTestSpine(process.argv[2]);
  const { probe, convert } = require('../electron/tools/spineProjectToJson');
  const pv = probe(p);
  const out = convert(p);
  console.log(`已生成: ${p}`);
  console.log(`probe: ${JSON.stringify(pv)}`);
  console.log(`解码: 骨骼 ${out.bones.length}(${out.bones.map((b) => b.name + (b.parent ? '<-' + b.parent : '')).join(', ')})` +
    ` · 插槽 ${out.slots.length}(${out.slots.map((s) => s.name + '@' + s.bone).join(', ')})` +
    ` · 附件 ${out.attachments.length}(${out.attachments.map((a) => a.name).join(', ')})` +
    ` · 动画 ${Object.keys(out.animations).length}`);
  console.log(JSON.stringify(out.animations, null, 1).slice(0, 600));
}
