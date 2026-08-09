'use strict';
/**
 * FGUI 源工程还原 —— 从 .bin 发布包还原为 FairyGUI 编辑器可打开的源工程包目录。
 * 还原方法参考 fgui-restore (https://github.com/krapnikkk/fgui-restore):
 *   - package.xml 标准源工程格式(含 publish 节点, 资源清单 component/image/movieclip/font/sound)
 *   - 组件 XML 按 <id>.xml 命名, 放入包内 path 子目录
 *   - 从图集裁剪碎图 <name>.png(rotated 旋转还原)
 *   - 位图字体还原 <name>.fnt (UIBuilder 格式)
 *   - MovieClip 还原 <name>.jta (yytou 二进制, 24fps 基准)
 *   - 声音复制 <name>.<ext>
 * 数据源复用本项目 parser.js 的解析结果(pkg.items / pkg.sprites / pkg.rawById / pkg.deps),
 * 组件 XML 复用 xml.js emitComponentXml。图集裁剪用 pngjs(纯 JS, 无原生依赖)。
 */
const fs = require('fs');
const path = require('path');
const { parsePackage } = require('./parser');
const { emitComponentXml, emitSourcePackageXml, xe } = require('./xml');
const { PNG } = require('pngjs');
// previewData 通过 index.js require, 与本站构成循环依赖 → 延迟 require
let _pv = null;
function pv() {
  if (!_pv) _pv = require('./previewData');
  return _pv;
}

/** 默认动画帧频(与 fgui-restore 一致, jta 以 24fps 基准还原) */
const JTA_FPS = 24;
/** 输出包目录名(源工程包 = 目录 + package.xml) */

// ==================== 位图字体 .fnt 还原 ====================
function parseFont(font) {
  let str = '';
  const { lineHeight, glyphs } = font;
  if (font.ttf) {
    str += `info creator=UIBuilder\ncommon lineHeight=${lineHeight}\n`;
    for (const key in glyphs) {
      const g = glyphs[key];
      str += `char id=${key.charCodeAt()} x=${g.bx} y=${g.by} width=${g.width} height=${g.height} ` +
        `xoffset=${g.x} yoffset=${g.y} xadvance=${g.advance} page=${g.page || 0} chnl=${g.channel}\n`;
    }
  } else {
    str += `info creator=UIBuilder\ncommon lineHeight=${lineHeight}\n`;
    for (const key in glyphs) {
      const g = glyphs[key];
      str += `char id=${key.charCodeAt()} img=${g.texture} xoffset=${g.x} yoffset=${g.y} xadvance=${g.advance}\n`;
    }
  }
  return str;
}

/** 从 font 资源二进制还原 .fnt 文本(照搬 fgui-restore decodeFontData 读取顺序) */
function decodeFontData(raw, spritesById, filesById) {
  raw.Seek(0, 0);
  const font = { glyphs: {} };
  font.ttf = raw.ReadBool();
  font.tint = raw.ReadBool();
  font.resizable = raw.ReadBool();
  font.hasChannel = raw.ReadBool();
  font.size = raw.ReadInt();
  font.xadvance = raw.ReadInt();
  font.lineHeight = raw.ReadInt();

  raw.Seek(0, 1);
  const charCnt = raw.ReadInt();
  for (let j = 0; j < charCnt; j++) {
    const nextPosition = raw.ReadShort() + raw.pointer; // nextPos 相对字符数据区起点的偏移
    const ch = String.fromCharCode(raw.ReadUshort());
    const bg = {};
    const img = raw.ReadS();
    bg.bx = raw.ReadInt();
    bg.by = raw.ReadInt();
    bg.x = raw.ReadInt();
    bg.y = raw.ReadInt();
    bg.width = raw.ReadInt();
    bg.height = raw.ReadInt();
    bg.advance = raw.ReadInt();
    bg.channel = raw.ReadByte();
    if (bg.channel === 1) bg.channel = 3;
    else if (bg.channel === 2) bg.channel = 2;
    else if (bg.channel === 3) bg.channel = 1;

    if (font.ttf) {
      bg.texture = spritesById.get(img) ? spritesById.get(img) : null;
      bg.lineHeight = font.lineHeight;
    } else {
      const charImg = filesById.get(img);
      if (charImg) {
        bg.width = charImg.width;
        bg.height = charImg.height;
        bg.texture = charImg.id;
        const sp = spritesById.get(charImg.id);
        if (sp) {
          bg.xoffset = sp.ox != null ? sp.ox : 0;
          bg.yoffset = sp.oy != null ? sp.oy : 0;
        }
      }
      if (bg.advance === 0) {
        if (font.xadvance === 0) bg.advance = bg.x + bg.width;
        else bg.advance = font.xadvance;
      }
      bg.lineHeight = bg.y < 0 ? bg.height : (bg.y + bg.height);
      if (bg.lineHeight < font.size) bg.lineHeight = font.size;
    }
    font.glyphs[ch] = bg;
    raw.pointer = nextPosition;
  }
  return parseFont(font);
}

// ==================== MovieClip .jta 还原 ====================
/** 解析 movieclip 资源二进制 → { interval, swing, repeatDelay, frames: [{rect, addDelay}] } */
function decodeMovieclipData(raw) {
  raw.Seek(0, 0);
  const interval = raw.ReadInt();
  const swing = raw.ReadBool();
  const repeatDelay = raw.ReadInt();
  raw.Seek(0, 1);
  const frameCount = raw.ReadShort();
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const nextPos = raw.ReadShort() + raw.pointer; // nextPos 相对本帧数据区起点的偏移(fgui-restore 同款: += pos)
    const x = raw.ReadInt();
    const y = raw.ReadInt();
    const width = raw.ReadInt();
    const height = raw.ReadInt();
    const addDelay = raw.ReadInt();
    const frame = { rect: `${x},${y},${width},${height}` };
    if (addDelay) frame.addDelay = addDelay;
    frames.push(frame);
    raw.pointer = nextPos;
  }
  return { interval, swing, repeatDelay, frames };
}

/**
 * 生成 .jta 二进制(FairyGUI MovieClip 打包格式, 头 "yytou", version=102)。
 * @param {{interval,swing,repeatDelay,frames}} mc 帧数据
 * @param {Buffer[]} frameImages 每帧 PNG buffer(与 frames 一一对应)
 * @param {number} width jta boundRect 宽
 * @param {number} height jta boundRect 高
 */
function buildJta(mc, frameImages, width, height) {
  const header = 'yytou';
  const fps = JTA_FPS;
  const speed = mc.interval ? Math.floor(mc.interval / 1000 * fps) : 1;
  const repeatDelay = mc.repeatDelay ? Math.floor(mc.repeatDelay / (mc.interval || 1)) : 0;
  const len = mc.frames.length;

  // 预计算大小: 头 + 每帧 14B + 纹理表 + 帧图字节
  let imgBytes = 0;
  for (const im of frameImages) imgBytes += 4 + im.length;
  const buf = Buffer.alloc(4 + 2 + header.length + 4 + 4 + 2 + 2 + 4 + 1 + 1 + 1 + 2 + 14 * len + 2 + imgBytes);
  let o = 0;
  buf.writeUInt16BE(header.length, o); o += 2;
  buf.write(header, o, 'utf8'); o += header.length;
  buf.writeInt32BE(102, o); o += 4;            // version
  buf.writeUInt8(fps, o); o += 1;              // fps
  buf.writeUInt8(0, o); o += 1;
  buf.writeUInt8(0, o); o += 1;
  buf.writeUInt8(0, o); o += 1;
  buf.writeUInt16BE(0, o); o += 2;             // boundRect.x
  buf.writeUInt16BE(0, o); o += 2;             // boundRect.y
  buf.writeUInt16BE(width & 0xffff, o); o += 2;
  buf.writeUInt16BE(height & 0xffff, o); o += 2;
  buf.writeUInt8(speed & 0xff, o); o += 1;
  buf.writeUInt8(repeatDelay & 0xff, o); o += 1;
  buf.writeUInt8(mc.swing ? 1 : 0, o); o += 1;
  buf.writeUInt16BE(len, o); o += 2;           // frameList.length
  mc.frames.forEach((frame, index) => {
    const rect = frame.rect.split(',');
    const addDelay = Math.round((frame.addDelay || 0) / 1000 * fps) || 0;
    buf.writeUInt16BE(addDelay, o); o += 2;
    buf.writeUInt16BE(+rect[0] & 0xffff, o); o += 2;
    buf.writeUInt16BE(+rect[1] & 0xffff, o); o += 2;
    buf.writeUInt16BE(+rect[2] & 0xffff, o); o += 2;
    buf.writeUInt16BE(+rect[3] & 0xffff, o); o += 2;
    buf.writeUInt16BE(index, o); o += 2;
  });
  buf.writeUInt16BE(len, o); o += 2;           // textureList.length
  for (const im of frameImages) {
    buf.writeUInt32BE(im.length, o); o += 4;
    im.copy(buf, o); o += im.length;
  }
  return buf;
}

// ==================== 碎图裁剪(pngjs) ====================
/** 从图集 PNG 裁剪一块(rotated 时逆时针旋转还原) */
function cropSprite(atlasPng, sp) {
  const { x, y, w, h, rotated } = sp;
  const out = new PNG({ width: w, height: h });
  const src = atlasPng.data;
  const dst = out.data;
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * atlasPng.width + x) * 4;
    const d = row * w * 4;
    for (let i = 0; i < w * 4; i++) dst[d + i] = src[s + i];
  }
  if (rotated) return rotateCCW(out);
  return out;
}

/** 逆时针旋转 90°(Jimp rotate(-90) 语义) */
function rotateCCW(png) {
  const { width, height, data } = png;
  const out = new PNG({ width: height, height: width });
  const dst = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((width - 1 - x) * height + y) * 4;
      dst[d] = data[s];
      dst[d + 1] = data[s + 1];
      dst[d + 2] = data[s + 2];
      dst[d + 3] = data[s + 3];
    }
  }
  return out;
}

/** 安全文件名(资源名可能含 / 等字符 → 展开为子路径) */
function safeRel(p) {
  return String(p || '').replace(/\\/g, '/');
}

// ==================== 主入口 ====================
/**
 * 还原单个 FGUI 发布包为源工程包目录。
 * @param {string} inputFile .bin 绝对路径
 * @param {string} outDir 输出根目录(包目录 = outDir/<pkgName>/)
 * @param {{textureDir?: string}} opts textureDir 手动纹理目录(优先于自动探测)
 * @returns {Promise<object>} 统计结果
 */
function restoreSource(inputFile, outDir, opts = {}) {
  const warnings = [];
  const skipped = [];
  const files = [];
  const pkg = parsePackage(inputFile, fs.readFileSync(inputFile));
  const srcDir = path.dirname(inputFile);
  const pkgName = pkg.name;
  const pkgDir = path.join(outDir, pkgName);
  fs.mkdirSync(pkgDir, { recursive: true });

  // ---- 依赖包加载(用于跨包 src 转 "包名.资源名"; 找不到时保留 pkgId) ----
  const depPkgs = new Map(); // dep.id -> pkg
  for (const dep of pkg.deps || []) {
    const depBin = pv().findDepBin(srcDir, dep.name);
    if (depBin) {
      try {
        depPkgs.set(dep.id, parsePackage(depBin, fs.readFileSync(depBin)));
      } catch (e) {
        warnings.push(`依赖包 ${dep.name} 解析失败: ${e.message}`);
      }
    } else {
      warnings.push(`依赖包 ${dep.name} 未找到(.bin), 跨包引用将保留原始 id, 需一并导出该包`);
    }
  }
  // srcResolver: 跨包引用 → "包名.资源名"; 本包保持 id/名称
  const srcResolver = (ch) => {
    if (ch.pkgId) {
      const dp = depPkgs.get(ch.pkgId);
      if (dp) {
        const it = (dp.items || []).find((i) => i.id === ch.src || i.name === ch.src);
        if (it && it.name) return { src: `${dp.name}.${it.name}`, pkg: null };
      }
      return null; // 保留原 src + pkgId
    }
    return { src: ch.src, pkg: null };
  };

  // ---- 图集纹理探测 + 解码缓存 ----
  const atlasCache = new Map(); // atlasId -> { path, png } (png 为解码结果或 null)
  const atlasBaseById = new Map();
  for (const it of pkg.items) {
    if (it.type === 'Atlas') {
      const base = (it.file || it.id).replace(/\.png$/i, '');
      atlasBaseById.set(it.id, base);
      const p = pv().probeTexture(srcDir, pkgName, base, opts.textureDir || null);
      atlasCache.set(it.id, { path: p, png: null });
    }
  }
  function getAtlasPng(atlasId) {
    const ent = atlasCache.get(atlasId);
    if (!ent) return null;
    if (ent.png !== null) return ent.png;
    if (!ent.path) {
      ent.png = undefined;
      return null;
    }
    try {
      ent.png = PNG.sync.read(fs.readFileSync(ent.path));
      return ent.png;
    } catch (e) {
      warnings.push(`图集解码失败 ${ent.path}: ${e.message}`);
      ent.png = undefined;
      return null;
    }
  }
  // sprite 索引: spriteId -> sprite
  const spriteById = new Map();
  for (const s of pkg.sprites || []) spriteById.set(s.spriteId, s);
  const itemById = new Map();
  for (const it of pkg.items) itemById.set(it.id, it);

  const filePath = (it, name) => {
    let p = it.path;
    if (p == null || p === '') p = '/';
    if (!p.endsWith('/')) p += '/';
    return path.join(pkgDir, safeRel(p).replace(/^\/+/, ''), name);
  };

  // ---- 1. package.xml ----
  fs.writeFileSync(path.join(pkgDir, 'package.xml'), emitSourcePackageXml(pkg), 'utf8');
  files.push({ type: 'package', name: 'package.xml' });

  // ---- 2. 组件 XML ----
  const components = [];
  for (const it of pkg.items) {
    if (it.type === 'Component' && it.component) {
      const xml = emitComponentXml(it, it.component, srcResolver);
      const out = filePath(it, it.id + '.xml');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, xml, 'utf8');
      components.push(it.name || it.id);
      files.push({ type: 'component', name: path.relative(pkgDir, out).replace(/\\/g, '/') });
    }
  }

  // ---- 3. 碎图裁剪 ----
  let images = 0;
  for (const it of pkg.items) {
    if (it.type !== 'Image') continue;
    const sp = spriteById.get(it.id);
    const atlasPng = sp ? getAtlasPng(sp.atlasItemId) : null;
    if (!sp || !atlasPng) {
      skipped.push(`image ${it.name || it.id}: 无图集数据`);
      continue;
    }
    try {
      const cropped = cropSprite(atlasPng, sp);
      const nm = (it.name || it.id).replace(/\.png$/i, '').replace(/\.svg$/i, '');
      const out = filePath(it, nm + '.png');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, PNG.sync.write(cropped));
      images++;
      files.push({ type: 'image', name: path.relative(pkgDir, out).replace(/\\/g, '/') });
    } catch (e) {
      skipped.push(`image ${it.name || it.id}: ${e.message}`);
    }
  }

  // ---- 4. 位图字体 .fnt ----
  let fonts = 0;
  for (const it of pkg.items) {
    if (it.type !== 'Font') continue;
    const raw = pkg.rawById[it.id];
    if (!raw) { skipped.push(`font ${it.name || it.id}: 无数据`); continue; }
    try {
      const fnt = decodeFontData(raw, spriteById, itemById);
      const out = filePath(it, (it.name || it.id) + '.fnt');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, fnt, 'utf8');
      fonts++;
      files.push({ type: 'font', name: path.relative(pkgDir, out).replace(/\\/g, '/') });
    } catch (e) {
      skipped.push(`font ${it.name || it.id}: ${e.message}`);
    }
  }

  // ---- 5. MovieClip .jta ----
  let movieclips = 0;
  for (const it of pkg.items) {
    if (it.type !== 'MovieClip') continue;
    const raw = pkg.rawById[it.id];
    if (!raw) { skipped.push(`movieclip ${it.name || it.id}: 无数据`); continue; }
    try {
      const mc = decodeMovieclipData(raw);
      // 帧图: sprites 中以 <mcId>_<i> 命名的碎图
      const frameImages = [];
      let missing = 0;
      for (let i = 0; i < mc.frames.length; i++) {
        const sp = spriteById.get(`${it.id}_${i}`);
        const atlasPng = sp ? getAtlasPng(sp.atlasItemId) : null;
        if (!sp || !atlasPng) {
          missing++;
          frameImages.push(null);
          continue;
        }
        frameImages.push(PNG.sync.write(cropSprite(atlasPng, sp)));
      }
      if (missing > 0) {
        skipped.push(`movieclip ${it.name || it.id}: 缺 ${missing}/${mc.frames.length} 帧图(未找到 ${it.id}_<i> 碎图)`);
        continue;
      }
      const w = it.width != null ? it.width : (mc.frames[0] ? +(mc.frames[0].rect.split(',')[2]) : 0);
      const h = it.height != null ? it.height : (mc.frames[0] ? +(mc.frames[0].rect.split(',')[3]) : 0);
      const jta = buildJta(mc, frameImages, w, h);
      const out = filePath(it, (it.name || it.id) + '.jta');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, jta);
      movieclips++;
      files.push({ type: 'movieclip', name: path.relative(pkgDir, out).replace(/\\/g, '/') });
    } catch (e) {
      skipped.push(`movieclip ${it.name || it.id}: ${e.message}`);
    }
  }

  // ---- 6. 声音 / 杂项资源复制 ----
  let sounds = 0;
  const gameRoot = pv().findGameRoot(srcDir);
  const spriteLibDir = gameRoot ? path.join(gameRoot, 'ui', 'fgui_texture', 'fgui') : null;
  for (const it of pkg.items) {
    if (it.type !== 'Sound') continue;
    const file = it.file;
    if (!file) { skipped.push(`sound ${it.name || it.id}: 无 file`); continue; }
    const candidates = [];
    candidates.push(path.join(srcDir, file));
    candidates.push(path.join(srcDir, pkgName + '_' + file));
    if (spriteLibDir) candidates.push(path.join(spriteLibDir, file));
    let found = null;
    for (const c of candidates) {
      try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { found = c; break; } } catch (e) { /* ignore */ }
    }
    if (!found) {
      skipped.push(`sound ${it.name || it.id}: 磁盘未找到 ${file}(bin 同目录或共享素材库)`);
      continue;
    }
    const ext = file.indexOf('.') > -1 ? '.' + file.split('.').pop() : '';
    const out = filePath(it, (it.name || it.id) + ext);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(found, out);
    sounds++;
    files.push({ type: 'sound', name: path.relative(pkgDir, out).replace(/\\/g, '/') });
  }

  return {
    ok: true,
    pkgName,
    pkgDir,
    atlas: {
      found: Array.from(atlasCache.values()).filter((e) => e.path).length,
      missing: Array.from(atlasCache.values()).filter((e) => !e.path).length,
    },
    components: components.length,
    images,
    fonts,
    movieclips,
    sounds,
    files,
    skipped,
    warnings,
  };
}

module.exports = { restoreSource, decodeFontData, decodeMovieclipData, buildJta, cropSprite, rotateCCW };
