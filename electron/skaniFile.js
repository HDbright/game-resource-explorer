'use strict';
/**
 * skaniFile.js — .skani 工程文件(ZIP 容器 + 明文内核)读写 · 主进程实现。
 *
 * 布局:meta.json(格式头) / doc.json(模型+编辑信息) / images/<sha1>.<ext>(位图资产) / thumb.png
 * 设计文档:docs/skani-format.md
 * - zip 读写为自研极简实现(local file header + central directory + EOCD,deflateRaw),无第三方依赖;
 * - 一律原子写(tmp + rename);正式保存先把旧文件备份为 .bak;
 * - sha1 命名图片资产,天然去重。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const FORMAT = 'skani';
const VERSION = 2;

// ---------------- CRC32(查表) ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- ZIP 打包 ----------------
/** entries: [{ name, data(Buffer) }] → zip Buffer(全部 deflateRaw) */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const comp = zlib.deflateRawSync(e.data, { level: 6 });
    const useDeflate = comp.length < e.data.length;
    const payload = useDeflate ? comp : e.data;
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);
    central.push({ nameBuf, crc, method, compSize: payload.length, size: e.data.length, offset, dosTime, dosDate });
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(c.method, 10);
    h.writeUInt16LE(c.dosTime, 12);
    h.writeUInt16LE(c.dosDate, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.compSize, 20);
    h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nameBuf.length, 28);
    // 其余字段(extra/comment/disk/attr)保持 0
    h.writeUInt32LE(c.offset, 42);
    chunks.push(h, c.nameBuf);
    cdSize += h.length + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

// ---------------- ZIP 解包 ----------------
/** zip Buffer → Map<name, Buffer>;损坏抛错 */
function readZip(buf) {
  // 倒扫 EOCD
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 .skani 文件(缺少 ZIP 结束目录)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // local header:跳到数据区
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`ZIP 条目损坏:${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    } catch (err) {
      throw new Error(`条目解压失败:${name}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------- 资产工具 ----------------
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const EXT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** dataUrl → { ext, buf };非 dataUrl/未知类型返回 null */
function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = EXT_OF[m[1]];
  if (!ext) return null;
  return { ext, buf: Buffer.from(m[2], 'base64') };
}

// ---------------- 原子写 ----------------
function atomicWrite(file, data) {
  const tmp = file + '.tmp' + process.pid;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (err) {
    // Windows 上目标被占用等:清理后原样抛出
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    throw err;
  }
}

// ---------------- 对外 API ----------------
/**
 * 写 .skani。
 * @param path 输出路径 | null(返回 base64,不落盘 —— 草稿前的预检等场景)
 * @param docJson doc.json 文本
 * @param assets [{ dataUrl }] 资产以 dataUrl 传入;返回时附 hash 映射
 * @param thumbDataUrl 可选缩略图
 * @returns { ok, path?, entries: [{hash, ext}], docSha1 }
 */
function skaniWrite({ path: file, docJson, assets = [], thumbDataUrl = null }) {
  try {
    const docBuf = Buffer.from(docJson, 'utf8');
    const docSha1 = sha1(docBuf);
    const now = Date.now();
    const meta = JSON.stringify({ format: FORMAT, version: VERSION, app: 'spine_viewer', createdAt: now, modifiedAt: now, imageCount: assets.length, docSha1 });
    const entries = [
      { name: 'meta.json', data: Buffer.from(meta, 'utf8') },
      { name: 'doc.json', data: docBuf },
    ];
    // 资产按传入顺序建清单(doc 中以 assetRef 序号引用);同名(同哈希)条目 zip 层去重
    const map = [];
    const seen = new Map(); // hash → 条目名
    for (const a of assets) {
      const bytes = dataUrlToBytes(a.dataUrl);
      if (!bytes) { map.push(null); continue; }
      const h = sha1(bytes.buf);
      const name = `images/${h}.${bytes.ext}`;
      if (!seen.has(h)) {
        seen.set(h, name);
        entries.push({ name, data: bytes.buf });
      }
      map.push({ hash: h, ext: bytes.ext });
    }
    entries.push({ name: 'assets.json', data: Buffer.from(JSON.stringify(map), 'utf8') });
    const thumb = dataUrlToBytes(thumbDataUrl);
    if (thumb) entries.push({ name: 'thumb.png', data: thumb.buf });
    const zip = buildZip(entries);
    if (file) {
      const bak = file + '.bak';
      try { if (fs.existsSync(file)) fs.renameSync(file, bak); } catch (e) { /* 备份失败不阻断 */ }
      atomicWrite(file, zip);
    }
    return { ok: true, path: file || undefined, entries: map.filter(Boolean).length, docSha1 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 读 .skani。
 * @returns { ok, meta, docJson, assets: [{hash, ext, base64, dataUrl}], missing: [hash] }
 *          资产按 hash 命名回读;引用缺失不影响打开(missing 列出)
 */
function skaniRead({ path: file, base64 }) {
  try {
    let buf;
    if (file) buf = fs.readFileSync(file);
    else buf = Buffer.from(base64, 'base64');
    const zip = readZip(buf);
    const metaBuf = zip.get('meta.json');
    const docBuf = zip.get('doc.json');
    if (!docBuf) return { ok: false, error: '缺少 doc.json(文件不完整)' };
    let meta = {};
    try { meta = metaBuf ? JSON.parse(metaBuf.toString('utf8')) : {}; } catch (e) { /* meta 损坏仍可打开 doc */ }
    if (meta.format && meta.format !== FORMAT) return { ok: false, error: `不是 .skani 工程(format=${meta.format})` };
    // 资产条目(hash 命名)与顺序清单(assets.json)——按清单序号返回,doc.assetRef 对位回填
    const byHash = new Map();
    for (const [name, data] of zip) {
      const m = /^images\/([0-9a-f]{40})\.(\w+)$/.exec(name);
      if (m) byHash.set(m[1], { ext: m[2], dataUrl: `data:${MIME_OF[m[2]] || 'image/png'};base64,${data.toString('base64')}` });
    }
    let order = [];
    const manifest = zip.get('assets.json');
    if (manifest) { try { order = JSON.parse(manifest.toString('utf8')); } catch (e) { /* 清单损坏按空处理 */ } }
    const assets = [];
    const missing = [];
    for (const rec of order) {
      if (!rec) { assets.push(null); continue; }
      const hit = byHash.get(rec.hash);
      if (hit) assets.push({ hash: rec.hash, ext: hit.ext, dataUrl: hit.dataUrl });
      else { assets.push(null); missing.push(rec.hash); }
    }
    const thumb = zip.get('thumb.png');
    return {
      ok: true,
      meta,
      docJson: docBuf.toString('utf8'),
      assets, // 按保存时顺序;缺失项为 null(missing 列出)
      thumbBase64: thumb ? thumb.toString('base64') : null,
      missing,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT_NAME = MIME_OF;

// ---------------- 草稿(userData/draft.skani) ----------------
function draftPath(userData) { return path.join(userData, 'draft.skani'); }

module.exports = { skaniWrite, skaniRead, draftPath, sha1, buildZip, readZip };
