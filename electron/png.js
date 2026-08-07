'use strict';
// 自实现 PNG 编码器(仅 RGBA 8bit),不依赖第三方包。
// 复用自 electron/main.js 中的 makeSamplePng/pngCrc32,提供给 ASTC→PNG 转换工具复用。

const zlib = require('zlib');

let _crcTable = null;
function pngCrc32(buf) {
  if (!_crcTable) {
    _crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 把 RGBA8 像素缓冲区编码为 PNG 文件字节流。
 * @param {number} width  图像宽度(像素)
 * @param {number} height 图像高度(像素)
 * @param {Uint8Array|Buffer} rgba 长度必须为 width*height*4 的 RGBA 序列(R,G,B,A)
 * @returns {Buffer} PNG 文件字节
 */
function encodePng(width, height, rgba) {
  const w = width, h = height;
  if (!rgba || rgba.length < w * h * 4) {
    throw new Error(`encodePng: RGBA 缓冲区长度不足,需要 ${w * h * 4},得到 ${rgba ? rgba.length : 0}`);
  }
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      const j = (y * w + x) * 4;
      raw[i] = rgba[j];
      raw[i + 1] = rgba[j + 1];
      raw[i + 2] = rgba[j + 2];
      raw[i + 3] = rgba[j + 3];
    }
  }
  const idat = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { encodePng, pngCrc32 };