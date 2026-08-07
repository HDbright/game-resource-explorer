'use strict';
// ASTC → PNG 转换工具
// 纯软件解码,不依赖 GPU/WebGL;支持 2D LDR/HDR(深度=1)。
//
// .astc 文件头布局(共 16 字节):
//   [0..3]   magic       0x13 0xAB 0xA1 0x5C
//   [4..6]   blockX/Y/Z  块尺寸
//   [7..9]   width       3 字节小端 = 实际像素宽度
//   [10..12] height      3 字节小端 = 实际像素高度
//   [13..15] depth       3 字节小端(2D 图为 1)
//   [16..]   压缩数据(每个 ASTC 块固定 16 字节,共 ceil(w/bx)*ceil(h/by) 块)

const fs = require('fs');
const path = require('path');
const { astcDecode } = require('@arkntools/astc-decode');
const { encodePng } = require('../png');

function parseAstcHeader(buf) {
  if (buf.length < 16) throw new Error('文件过短(< 16 字节),不是有效的 .astc');
  // magic: 4 字节小端 0x5CA1AB13 → 字节序列 13 AB A1 5C
  const m0 = buf[0], m1 = buf[1], m2 = buf[2], m3 = buf[3];
  if (m0 !== 0x13 || m1 !== 0xAB || m2 !== 0xA1 || m3 !== 0x5C) {
    throw new Error('不是 ASTC 文件(magic 校验失败,期望 0x5CA1AB13)');
  }
  const blockX = buf[4];
  const blockY = buf[5];
  const blockZ = buf[6];
  // 注:.astc 头部 16 字节中没有保留字节,紧接着就是宽高深
  const width = buf[7] | (buf[8] << 8) | (buf[9] << 16);
  const height = buf[10] | (buf[11] << 8) | (buf[12] << 16);
  const depth = buf[13] | (buf[14] << 8) | (buf[15] << 16);
  return { blockX, blockY, blockZ, width, height, depth };
}

/**
 * 将一个 .astc 文件转换为 PNG。
 * @param {string} inputPath  .astc 源文件
 * @param {string} outputPath 输出 .png 路径
 * @returns {{ width:number, height:number, blockX:number, blockY:number, depth:number, output:string }}
 */
function astcToPng(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const meta = parseAstcHeader(buf);
  if (meta.depth !== 1) {
    throw new Error(`暂不支持 3D ASTC(depth=${meta.depth}),仅支持 2D(depth=1)`);
  }
  if (meta.blockX < 3 || meta.blockX > 12 || meta.blockY < 3 || meta.blockY > 12) {
    throw new Error(`块尺寸越界(block ${meta.blockX}×${meta.blockY}),仅支持 ASTC 标准块尺寸 3-12`);
  }
  const expected = Math.ceil(meta.width / meta.blockX) * Math.ceil(meta.height / meta.blockY) * 16;
  const compressed = buf.subarray(16);
  if (compressed.length < expected) {
    throw new Error(`文件截断:压缩数据 ${compressed.length} 字节,期望 ${expected} 字节`);
  }
  const rgba = astcDecode(new Uint8Array(compressed), meta.width, meta.height, meta.blockX, meta.blockY);
  if (rgba.length !== meta.width * meta.height * 4) {
    throw new Error(`解码尺寸异常:RGBA ${rgba.length} 字节,期望 ${meta.width * meta.height * 4}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, encodePng(meta.width, meta.height, rgba));
  return { width: meta.width, height: meta.height, blockX: meta.blockX, blockY: meta.blockY, depth: meta.depth, output: outputPath };
}

module.exports = { astcToPng, parseAstcHeader };