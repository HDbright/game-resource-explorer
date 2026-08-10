'use strict';
/**
 * FGUI 布局预览数据层: 把 .bin 包解析结果扁平化为可渲染的 RenderNode 树,
 * 支持跨包递归解析 + 图集纹理自动探测。
 * 纯逻辑模块(不依赖 electron), 可 Node 单测。
 */
const fs = require('fs');
const path = require('path');
const fgui = require('./index');

const MAX_DEPTH = 8;
const MAX_NODES = 2000;

// 包解析缓存: absBinPath -> pkg
const pkgCache = new Map();

function loadPkg(binPath) {
  if (pkgCache.has(binPath)) return pkgCache.get(binPath);
  const pkg = fgui.parseFile(binPath).pkg;
  pkgCache.set(binPath, pkg);
  return pkg;
}

/** 从包目录向上回溯, 找到包含 ui/fgui 的"游戏根" (用于定位 fgui_texture) */
function findGameRoot(srcDir) {
  let d = path.resolve(srcDir);
  for (let i = 0; i < 6; i++) {
    if (path.basename(d).toLowerCase() === 'fgui' &&
        path.basename(path.dirname(d)).toLowerCase() === 'ui') {
      return path.dirname(path.dirname(d));
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

/**
 * 解析依赖包 .bin 的磁盘路径: 先 bin 同目录, 再向上 2 层 + ui/fgui 子路径
 */
function findDepBin(srcDir, depName) {
  const candidates = [];
  const base = srcDir;
  candidates.push(path.join(base, depName + '.bin'));
  let up = base;
  for (let i = 0; i < 2; i++) {
    const parent = path.dirname(up);
    if (parent === up) break;
    up = parent;
    candidates.push(path.join(up, depName + '.bin'));
    candidates.push(path.join(up, 'ui', 'fgui', depName + '.bin'));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * 探测图集纹理 PNG 路径:
 * 0) opts.textureDir 手动指定(优先)
 * 1) {gameRoot}/ui/fgui_texture/fgui/{pkgName}_{atlasId}.png
 * 2) {srcDir}/{pkgName}_{atlasId}.png
 * 3) {srcDir}/{atlasId}.png
 */
function probeTexture(srcDir, pkgName, atlasId, textureDir) {
  const candidates = [];
  if (textureDir) {
    candidates.push(path.join(textureDir, pkgName + '_' + atlasId + '.png'));
    candidates.push(path.join(textureDir, atlasId + '.png'));
  }
  const gameRoot = findGameRoot(srcDir);
  if (gameRoot) {
    candidates.push(path.join(gameRoot, 'ui', 'fgui_texture', 'fgui', pkgName + '_' + atlasId + '.png'));
  }
  candidates.push(path.join(srcDir, pkgName + '_' + atlasId + '.png'));
  candidates.push(path.join(srcDir, atlasId + '.png'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/** 从 props.gears 提取 gearDisplay(类型 Display/Display2) */
function gearDisplayOf(props) {
  if (!Array.isArray(props.gears)) return null;
  for (const g of props.gears) {
    const t = g && g.type;
    if (t === 'Display' || t === 'Display2') {
      return { controllerIndex: g.controllerIndex != null ? g.controllerIndex : -1,
               pages: Array.isArray(g.pages) ? g.pages : [] };
    }
  }
  return null;
}

/** 解析 FGUI 字体引用: ui://pkgId/fontId(带斜杠) 或 ui://pkgId+itemId(无斜杠拼接, FGUI 字体常用) */
function resolveFontItem(ctx, font) {
  if (!font || typeof font !== 'string') return null;
  const m = /^ui:\/\/(.+)$/.exec(font);
  if (!m) return null;
  const rest = m[1];
  // 形式1: 带斜杠 ui://pkgId/fontId
  const slash = /^(.+)\/(.+)$/.exec(rest);
  if (slash) {
    const pkg = ctx.pkgById.get(slash[1]);
    if (pkg) {
      const item = (pkg.items || []).find((i) => i.id === slash[2] || i.name === slash[2]);
      if (item) return { pkg, item };
    }
  }
  // 形式2: 无斜杠拼接 ui://<pkgId><itemId>(FGUI 字体引用惯例)
  for (const pkg of ctx.pkgById.values()) {
    const item = (pkg.items || []).find((i) => (pkg.id + i.id) === rest || i.id === rest);
    if (item) return { pkg, item };
  }
  return null;
}

/** 字形图在导出源工程中的独立 PNG(图集缺失时兜底): <pkg>_src/<pkg>/<path>/<name>.png */
function sourcePngForItem(pkg, item, ctx) {
  const rel = String(item.path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const baseName = String(item.name || item.id).replace(/\.png$/i, '');
  const c = path.join(ctx.srcDir, pkg.name + '_src', pkg.name, rel, baseName + '.png');
  try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { /* ignore */ }
  return null;
}

/** 由 sprite 构造字形(解析图集 item → 纹理 key → 探测 PNG), 内嵌字形表与 .fnt 文本兜底共用 */
function glyphFromSprite(sp, pkg, ctx) {
  const atlasItem = (pkg.items || []).find((i) => i.type === 'Atlas' && i.id === sp.atlasItemId);
  const atlasFile = atlasItem ? atlasItem.file : null;
  if (!atlasFile) return null;
  const atlasBase = String(atlasFile).replace(/\.png$/i, '');
  const atlasKey = `${pkg.name}_${atlasBase}`;
  if (!(atlasKey in ctx.textures)) {
    ctx.textures[atlasKey] = probeTexture(ctx.srcDir, pkg.name, atlasBase, ctx.textureDir);
    if (!ctx.textures[atlasKey]) ctx.missingTextures.push(atlasKey);
  }
  const item = (pkg.items || []).find((i) => i.id === sp.spriteId);
  return {
    atlasKey,
    rect: { x: sp.x, y: sp.y, w: sp.w, h: sp.h, rotated: !!sp.rotated },
    xoffset: 0,
    yoffset: 0,
    advance: sp.w != null ? sp.w : 10,
    channel: 0,
    srcFile: item ? sourcePngForItem(pkg, item, ctx) : null, // 独立字形 PNG(图集缺失时兜底)
  };
}

/**
 * 解码位图字体(FGUI Font 资源)为可直接渲染的字形表。
 * 字形贴图是本包图集里的一个 sprite(img 即 spriteId), 与图片走同一套图集解析/纹理探测。
 * 读取顺序照搬 restoreSource.decodeFontData(保证与导源工程一致)。
 * @returns {{ttf:boolean,size:number,lineHeight:number,glyphs:object}|null}
 *   glyphs[char] = { atlasKey, rect:{x,y,w,h,rotated}, xoffset, yoffset, advance, channel }
 */
function decodeBitmapFontGlyphs(raw, pkg, ctx) {
  try {
    raw.Seek(0, 0);
    raw.ReadBool(); raw.ReadBool(); raw.ReadBool(); raw.ReadBool(); // ttf, tint, resizable, hasChannel
    const size = raw.ReadInt();
    const xadvance = raw.ReadInt();
    const lineHeight = raw.ReadInt();
    raw.Seek(0, 1);
    const charCnt = raw.ReadInt();
    const glyphs = {};
    for (let j = 0; j < charCnt; j++) {
      const nextPos = raw.ReadShort() + raw.pointer;
      const ch = String.fromCharCode(raw.ReadUshort());
      const img = raw.ReadS();           // spriteId(图集里的字形 sprite)
      raw.ReadInt();                     // bx (源内 x, 渲染以 sprite.rect 为准)
      raw.ReadInt();                     // by
      const xoffset = raw.ReadInt();     // 字形相对笔点的水平偏移
      const yoffset = raw.ReadInt();     // 字形相对笔点的垂直偏移
      raw.ReadInt();                     // gw
      raw.ReadInt();                     // gh
      const adv = raw.ReadInt();
      const channel = raw.ReadByte();
      const sp = (pkg.sprites || []).find((s) => s.spriteId === img);
      if (sp) {
        const g = glyphFromSprite(sp, pkg, ctx);
        if (g) {
          g.xoffset = xoffset || 0;
          g.yoffset = yoffset || 0;
          g.advance = adv || (sp.w != null ? sp.w : (size ? size * 0.6 : 10));
          g.channel = channel;
          glyphs[ch] = g;
        }
      }
      raw.pointer = nextPos;
    }
    return { ttf: false, size: size || 0, lineHeight: lineHeight || size || 0, glyphs };
  } catch (e) {
    return null;
  }
}

/**
 * 查找 <字体名>.fnt 文本文件(位图字体的源工程描述文件):
 * 包目录 / 子目录 font、fonts、com/font、组件/font / 导出源工程 <pkg>_src/<pkg>/...。
 * 发布后的 bin 内嵌字形表通常已足够, 该文件仅作内嵌缺失时的兜底。
 */
function findFntFile(srcDir, pkgName, fontName) {
  const name = String(fontName || '');
  const names = /\.fnt$/i.test(name) ? [name] : [name + '.fnt', name];
  const roots = [srcDir];
  if (pkgName) roots.push(path.join(srcDir, pkgName + '_src', pkgName));
  const subs = ['', 'font', 'fonts', 'com/font', '组件/font'];
  for (const root of roots) {
    for (const sub of subs) {
      for (const n of names) {
        const c = sub ? path.join(root, sub, n) : path.join(root, n);
        try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { /* ignore */ }
      }
    }
  }
  return null;
}

/** 取形如 key=value 的字段值, 无匹配返回 null */
function fntIntOf(re, line) {
  const m = re.exec(line);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 解析 .fnt 文本文件为字形表(兜底路径, 兼容两种格式):
 * - UIBuilder 位图格式(本工程导源工程输出): char id=N img=<spriteId> xoffset=.. yoffset=.. xadvance=..
 * - BMFont 标准格式: common lineHeight=.. / page id=P file=".." / char id=N x=.. y=.. width=.. height=..
 *   其中 page 文件名对应包内 Image item(按 name 匹配), 取其图集 sprite 作为字形贴图。
 */
function parseFntTextFile(fntPath, pkg, ctx) {
  try {
    const txt = fs.readFileSync(fntPath, 'utf8');
    let lineHeight = 0;
    let size = 0;
    const pages = {}; // pageId -> 图片文件名
    const glyphs = {};
    for (const rawLine of txt.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('info ')) {
        const s = fntIntOf(/\bsize=(\d+)/, line);
        if (s != null) size = s;
        continue;
      }
      if (line.startsWith('common ')) {
        const lh = fntIntOf(/lineHeight=(\d+)/, line);
        if (lh != null) lineHeight = lh;
        continue;
      }
      if (line.startsWith('page ')) {
        const m = /^page\s+id=(\d+)\s+file="([^"]+)"/.exec(line);
        if (m) pages[parseInt(m[1], 10)] = m[2];
        continue;
      }
      if (!line.startsWith('char ')) continue;
      const idM = /^char\s+id=(\d+)/.exec(line);
      if (!idM) continue;
      const ch = String.fromCharCode(parseInt(idM[1], 10));
      // 格式1: UIBuilder, img 即图集 spriteId
      const imgM = /\bimg=(\S+)/.exec(line);
      let g = null;
      if (imgM) {
        const sp = (pkg.sprites || []).find((s) => s.spriteId === imgM[1]);
        if (sp) g = glyphFromSprite(sp, pkg, ctx);
      } else {
        // 格式2: BMFont 标准, page 文件名 → 包内 Image item → 图集 sprite
        const x = fntIntOf(/\bx=(-?\d+)/, line);
        const w = fntIntOf(/\bwidth=(\d+)/, line);
        if (x != null && w != null) {
          const pageId = fntIntOf(/\bpage=(\d+)/, line) || 0;
          const pageFile = pages[pageId];
          if (pageFile) {
            const base = pageFile.replace(/\.[a-zA-Z0-9]+$/, '');
            const item = (pkg.items || []).find((i) => i.type === 'Image' && (i.name === base || i.name === pageFile));
            const sp = item ? (pkg.sprites || []).find((s) => s.spriteId === item.id) : null;
            if (sp) g = glyphFromSprite(sp, pkg, ctx);
          }
        }
      }
      if (!g) continue;
      const xo = fntIntOf(/\bxoffset=(-?\d+)/, line);
      const yo = fntIntOf(/\byoffset=(-?\d+)/, line);
      const adv = fntIntOf(/\bxadvance=(-?\d+)/, line);
      g.xoffset = xo != null ? xo : 0;
      g.yoffset = yo != null ? yo : 0;
      g.advance = adv != null ? adv : (g.rect ? g.rect.w : 0);
      const chnl = fntIntOf(/\bchnl=(-?\d+)/, line);
      if (chnl != null) g.channel = chnl;
      glyphs[ch] = g;
    }
    if (!Object.keys(glyphs).length) return null;
    return { ttf: false, size: size || 0, lineHeight: lineHeight || size || 0, glyphs };
  } catch (e) {
    return null;
  }
}

function textFormatOf(props) {
  const tf = props.textFormat;
  if (!tf) return null;
  return {
    font: tf.font != null ? tf.font : null,
    size: tf.size != null ? tf.size : null,
    color: tf.color != null ? tf.color : null,
    align: tf.align != null ? tf.align : null,
    valign: tf.valign != null ? tf.valign : null,
    autoSize: tf.autoSize != null ? tf.autoSize : null,
    lineSpacing: tf.lineSpacing != null ? tf.lineSpacing : null,
    letterSpacing: tf.letterSpacing != null ? tf.letterSpacing : null,
    bold: tf.bold != null ? tf.bold : null,
    italic: tf.italic != null ? tf.italic : null,
    underline: tf.underline != null ? tf.underline : null,
    outline: tf.outline != null ? tf.outline : null,
    outlineColor: tf.outlineColor != null ? tf.outlineColor : null,
    shadow: tf.shadowOffset != null ? true : null,
    shadowColor: tf.shadowColor != null ? tf.shadowColor : null,
    shadowOffset: tf.shadowOffset != null ? tf.shadowOffset : null,
  };
}

/** 取子对象所属包: 优先 child.pkgId, 其次继承的 srcPkgId, 最后当前主包 */
function ownerPkgOf(ctx, child, srcPkgId) {
  const pid = child.pkgId || srcPkgId;
  if (pid) {
    const p = ctx.pkgById.get(pid);
    if (p) return p;
  }
  return ctx.curPkg;
}

/** 在指定包内查找 item(id 或 name 匹配) */
function findItemInPkg(pkg, ref) {
  if (!pkg || ref == null) return null;
  return (pkg.items || []).find((i) => i.id === ref || i.name === ref) || null;
}

/**
 * 递归展开子对象为 RenderNode 树。
 * @param {object} ctx 上下文
 * @param {object} child 解析器产出的子对象 { type, src, pkgId, props, titleText, iconUrl }
 * @param {number} depth
 * @param {string|null} srcPkgId 继承的包 id(递归时子节点沿用父节点的包)
 */
function flattenChild(ctx, child, depth, srcPkgId) {
  if (ctx.nodeCount >= MAX_NODES) return null;
  const props = child.props || {};
  const type = child.type || 'unknown';
  const ownerPkg = ownerPkgOf(ctx, child, srcPkgId);
  const effPkgId = (child.pkgId || srcPkgId) || null;

  const base = {
    id: props.id != null ? props.id : null,
    name: props.name != null ? props.name : null,
    type,
    x: props.x != null ? props.x : 0,
    y: props.y != null ? props.y : 0,
    initWidth: props.initWidth != null ? props.initWidth : null,
    initHeight: props.initHeight != null ? props.initHeight : null,
    scaleX: props.scaleX != null ? props.scaleX : null,
    scaleY: props.scaleY != null ? props.scaleY : null,
    pivotX: props.pivotX != null ? props.pivotX : null,
    pivotY: props.pivotY != null ? props.pivotY : null,
    pivotAsAnchor: props.pivotAsAnchor != null ? props.pivotAsAnchor : null,
    alpha: props.alpha != null ? props.alpha : null,
    rotation: props.rotation != null ? props.rotation : null,
    visible: props.visible !== false,
    srcPkgId: effPkgId,
    gearDisplay: gearDisplayOf(props),
  };

  // ---- 文本类 ----
  if (type === 'Text' || type === 'RichText' || type === 'InputText') {
    const text = props.text != null ? props.text : null;
    const tf = textFormatOf(props);
    // 位图字体(ui://... 指向 FGUI Font 资源): 解出字形表, 让渲染层用图集 sprite 逐字绘制。
    // 主路径: bin 内嵌字形表(发布时 .fnt 文本 + 数字图片已打进字形表与图集);
    // 兜底路径: 内嵌缺失/为空时, 读 <字体名>.fnt 文本文件(UIBuilder / BMFont 格式)。
    let fontGlyphs = null;
    if (tf.font) {
      const fr = resolveFontItem(ctx, tf.font);
      if (fr && fr.item.type === 'Font') {
        const cacheKey = fr.pkg.id + ':' + fr.item.id;
        if (!ctx.fontCache) ctx.fontCache = new Map();
        if (!ctx.fontCache.has(cacheKey)) {
          let fg = null;
          const raw = fr.pkg.rawById ? fr.pkg.rawById[fr.item.id] : null;
          if (raw) fg = decodeBitmapFontGlyphs(raw, fr.pkg, ctx);
          if (!(fg && fg.glyphs && Object.keys(fg.glyphs).length)) {
            const fntPath = findFntFile(ctx.srcDir, fr.pkg.name, fr.item.name);
            if (fntPath) fg = parseFntTextFile(fntPath, fr.pkg, ctx);
          }
          ctx.fontCache.set(cacheKey, fg);
        }
        const fg = ctx.fontCache.get(cacheKey);
        if (fg && fg.glyphs && Object.keys(fg.glyphs).length) {
          fontGlyphs = { type: 'bitmap', fontId: fr.item.id, pkgId: fr.pkg.id,
                         size: fg.size, lineHeight: fg.lineHeight, glyphs: fg.glyphs };
        }
      }
    }
    return {
      ...base, kind: 'text',
      text: text != null ? text : '',
      textFormat: tf,
      font: fontGlyphs,
    };
  }

  // ---- 图片类(Image / MovieClip / Loader) ----
  if (type === 'Image' || type === 'MovieClip' || type === 'Loader') {
    const item = findItemInPkg(ownerPkg, child.src);
    let sprite = null;
    let atlasKey = null;
    let atlasFile = null;
    let atlasOwner = ownerPkg;
    if (item) {
      const sp = (ownerPkg.sprites || []).find((s) => s.spriteId === item.id);
      if (sp) {
        sprite = { atlasItemId: sp.atlasItemId, x: sp.x, y: sp.y, w: sp.w, h: sp.h,
                   rotated: !!sp.rotated, ow: sp.ow, oh: sp.oh };
        const atlasItem = (ownerPkg.items || []).find((i) => i.type === 'Atlas' && i.id === sp.atlasItemId);
        atlasFile = atlasItem ? atlasItem.file : null;
      }
    }
    // Loader 的 url 可能是 ui://pkgId/itemId 形式(跨包)
    if (!sprite && type === 'Loader' && props.url) {
      const m = /^ui:\/\/([^/]+)\/(.+)$/.exec(props.url);
      if (m) {
        const lpkg = ctx.pkgById.get(m[1]);
        const litem = lpkg ? findItemInPkg(lpkg, m[2]) : null;
        const lsp = litem && lpkg ? (lpkg.sprites || []).find((s) => s.spriteId === litem.id) : null;
        if (lsp) {
          sprite = { atlasItemId: lsp.atlasItemId, x: lsp.x, y: lsp.y, w: lsp.w, h: lsp.h,
                     rotated: !!lsp.rotated, ow: lsp.ow, oh: lsp.oh };
          const latlas = lpkg.items.find((i) => i.type === 'Atlas' && i.id === lsp.atlasItemId);
          atlasFile = latlas ? latlas.file : null;
          atlasOwner = lpkg;
        }
      }
    }
    if (sprite) {
      // 纹理 key 按所属包名 + 实际纹理文件名区分(跨包同名 atlas 不冲突;
      // file 才是磁盘 PNG 真实名, 特殊包如 WenDingSanJie 的 file=atlas0_1 而 id=atlas100)
      const atlasBase = atlasFile ? atlasFile.replace(/\.png$/i, '') : sprite.atlasItemId;
      atlasKey = `${atlasOwner.name}_${atlasBase}`;
      if (!(atlasKey in ctx.textures)) {
        const p = probeTexture(ctx.srcDir, atlasOwner.name, atlasBase, ctx.textureDir);
        ctx.textures[atlasKey] = p;
        if (!p) ctx.missingTextures.push(atlasKey);
      }
    }
    return {
      ...base, kind: 'image',
      sprite, atlasFile, atlasKey,
      url: props.url != null ? props.url : null,
      scaleOption: item ? item.scaleOption : null,
      scale9Grid: item ? item.scale9Grid : null,
    };
  }

  // ---- 组件容器类 ----
  const compItem = child.src ? findItemInPkg(ownerPkg, child.src) : null;
  const comp = compItem && compItem.component ? compItem.component : null;
  const node = { ...base, kind: comp ? 'container' : (type === 'Graph' ? 'graph' : 'unknown'), children: [] };

  const title = props.title != null ? props.title : null;
  const ownText = props.text != null ? props.text : null;

  if (comp) {
    const key = (effPkgId || '') + ':' + child.src;
    if (ctx.visited.has(key)) {
      ctx.warnings.push(`循环引用已跳过: ${key}`);
    } else if (depth >= MAX_DEPTH) {
      ctx.warnings.push(`嵌套过深(>${MAX_DEPTH})已截断: ${key}`);
    } else {
      ctx.visited.add(key);
      // 尺寸: 组件 item 的 width/height 作为默认尺寸
      if (node.initWidth == null && compItem.width != null) {
        node.initWidth = compItem.width;
        node.initHeight = compItem.height != null ? compItem.height : node.initHeight;
      }
      const children = comp.children || [];
      for (const ch of children) {
        const rn = flattenChild(ctx, ch, depth + 1, effPkgId);
        if (rn) node.children.push(rn);
      }
      ctx.visited.delete(key);
    }
    // 组件自身 title/text 合并:优先更新 displayList 中真实存在的 'title' 文本对象,
    // 这样标题会沿用真实对象的位置(x/y)、对齐(align/valign)、字号(size)、颜色(color),
    // 而不是错误地放到 (0,0) 且丢失所有格式。仅在找不到真实 title 对象时回退为合成节点。
    const t = title != null ? title : (ownText != null ? ownText : null);
    if (t != null) {
      const titleChild = node.children.find((c) => c.kind === 'text' && c.name === 'title');
      if (titleChild) {
        titleChild.text = String(t);
        if (titleChild.initWidth == null && node.initWidth != null) titleChild.initWidth = node.initWidth;
        if (titleChild.initHeight == null && node.initHeight != null) titleChild.initHeight = node.initHeight;
      } else {
        node.children.unshift({
          kind: 'text', id: node.id ? node.id + '.title' : null,
          name: node.name ? node.name + '.title' : null,
          type: 'Text', x: 0, y: 0,
          initWidth: node.initWidth != null ? node.initWidth : null,
          initHeight: node.initHeight != null ? node.initHeight : null,
          scaleX: null, scaleY: null, pivotX: null, pivotY: null, pivotAsAnchor: null,
          alpha: null, rotation: null, visible: true, srcPkgId: null, gearDisplay: null,
          text: String(t),
          textFormat: null,
        });
      }
    }
  } else if (type === 'Graph') {
    // 第一版: 占位(shapeType 记录)
    node.shapeType = props.shapeType != null ? props.shapeType : null;
  }

  ctx.nodeCount++;
  return node;
}

function buildComponentNode(ctx, compItem) {
  const comp = compItem.component;
  const node = {
    kind: 'container',
    id: compItem.id, name: compItem.name,
    type: compItem.objectType || 'Component',
    x: 0, y: 0,
    initWidth: compItem.width != null ? compItem.width : (comp && comp.sourceWidth),
    initHeight: compItem.height != null ? compItem.height : (comp && comp.sourceHeight),
    scaleX: null, scaleY: null, pivotX: null, pivotY: null, pivotAsAnchor: null,
    alpha: null, rotation: null, visible: true, srcPkgId: null, gearDisplay: null,
    children: [],
  };
  if (comp) {
    for (const ch of comp.children || []) {
      const rn = flattenChild(ctx, ch, 0, null);
      if (rn) node.children.push(rn);
    }
  }
  return node;
}

/**
 * 主入口: 解析 .bin → 渲染数据
 * @param {string} inputPath .bin 绝对路径
 * @param {object} [opts] { textureDir?: string } 手动纹理目录(优先于自动探测)
 */
function buildPreviewData(inputPath, opts = {}) {
  const warnings = [];
  const textureDir = opts.textureDir || null;
  const ctx = {
    srcDir: path.dirname(inputPath),
    pkgName: null,
    curPkg: null,
    pkgById: new Map(),
    visited: new Set(),
    textures: {},            // `${pkgName}_${atlasItemId}` -> absPath|null
    fontCache: new Map(),    // `${pkgId}:${fontId}` -> 已解码字形表(避免重复解码)
    missingTextures: [],
    nodeCount: 0,
    warnings,
    textureDir,
  };

  const pkg = loadPkg(inputPath);
  ctx.pkgName = pkg.name;
  ctx.curPkg = pkg;
  ctx.pkgById.set(pkg.id, pkg);

  // 懒加载依赖包
  for (const dep of pkg.deps || []) {
    if (ctx.pkgById.has(dep.id)) continue;
    const depBin = findDepBin(ctx.srcDir, dep.name);
    if (depBin) {
      try {
        const dpkg = loadPkg(depBin);
        ctx.pkgById.set(dpkg.id, dpkg);
      } catch (e) {
        warnings.push(`依赖包 ${dep.name} 解析失败: ${e.message}`);
      }
    } else {
      warnings.push(`依赖包 ${dep.name} 未找到(.bin)`);
    }
  }

  // 组件列表
  const components = [];
  for (const it of pkg.items) {
    if (it.type === 'Component' && it.component) {
      const root = buildComponentNode(ctx, it);
      components.push({
        id: it.id, name: it.name,
        objectType: it.objectType || 'Component',
        width: it.width != null ? it.width : null,
        height: it.height != null ? it.height : null,
        controllers: (it.component.controllers || []).map((c) => ({
          name: c.name, homePageIndex: c.homePageIndex != null ? c.homePageIndex : 0,
          pages: (c.pages || []).map((pg) => ({ id: pg.id, name: pg.name })),
        })),
        root,
      });
    }
  }

  const atlasKeys = Object.keys(ctx.textures);
  const hasMissing = ctx.missingTextures.length > 0;
  const hasAuto = atlasKeys.some((k) => ctx.textures[k] != null);
  const textureSource = hasMissing ? (hasAuto ? 'mixed' : 'manual') : 'auto';

  return {
    ok: true,
    srcDir: ctx.srcDir,
    pkg: {
      id: pkg.id, name: pkg.name, version: pkg.version,
      deps: (pkg.deps || []).map((d) => ({ id: d.id, name: d.name })),
      itemCount: pkg.items.length,
      atlasKeys,
    },
    components,
    textures: ctx.textures,
    textureSource,
    missingTextures: ctx.missingTextures,
    warnings,
  };
}

module.exports = { buildPreviewData, findGameRoot, probeTexture, findDepBin, findFntFile, parseFntTextFile };
