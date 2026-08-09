'use strict';
/**
 * FGUI .bin 包解析器 —— 从 fgui_bin2xml.py 1:1 移植(大端 ByteBuffer + 分段 Seek)。
 * 输出结构与 Python 版完全一致, 便于回归 diff。
 */
const { ByteBuffer, segBounds } = require('./byteBuffer');
const E = require('./enums');

// ---------- 解析自检: 各段"声明长度 - 实际消费"(leftover) 分布 ----------
let STATS = null;

function rec(key, leftover, tag) {
  if (!STATS) return;
  const d = STATS[key] || (STATS[key] = {});
  d[leftover] = (d[leftover] || 0) + 1;
  if (leftover !== 0 && tag !== undefined && tag !== null) {
    (STATS._samples || (STATS._samples = {}))[key] = (STATS._samples[key] || []);
    const s = STATS._samples[key];
    if (s.length < 8) s.push([leftover, tag]);
  }
}

function recBlock(cbuf, bi, otype, tag) {
  if (!STATS) return;
  const sb = segBounds(cbuf, 0, bi);
  if (sb) {
    const name = E.OBJ_TYPE[otype] != null ? E.OBJ_TYPE[otype] : String(otype);
    rec(`child.${name}.block${bi}`, sb[1] - cbuf.pointer, tag);
  }
}

// =====================================================================
// 控制器
// =====================================================================
function parseController(buf, beginPos) {
  buf.Seek(beginPos, 0);
  const name = buf.ReadS();
  buf.ReadBool(); // autoRadioGroupDepth
  buf.Seek(beginPos, 1);
  const cnt = buf.ReadShort();
  const pages = [];
  for (let i = 0; i < cnt; i++) {
    const pid = buf.ReadS();
    const pname = buf.ReadS();
    const display = (pname !== null && pname !== '') ? pname : pid;
    pages.push({ id: pid, name: pname, display });
  }
  let homePageIndex = 0;
  if (buf.version >= 2) {
    const hpt = buf.ReadByte();
    if (hpt === 1) homePageIndex = buf.ReadShortS();
    else if (hpt === 3) buf.ReadS(); // var name for home page
    // hpt==2 不读
  }
  // block2: 动作
  const actions = [];
  if (buf.Seek(beginPos, 2)) {
    const ac = buf.ReadShort();
    for (let i = 0; i < ac; i++) {
      let nextPos = buf.ReadUshort();
      nextPos += buf.pointer;
      const atype = buf.ReadByte();
      const aname = E.ACTION_TYPE[atype] != null ? E.ACTION_TYPE[atype] : 'Action' + atype;
      const act = { type: aname };
      if (atype === 0) { // PlayTransition
        act.transitionName = buf.ReadS();
        act.playTimes = buf.ReadInt();
        act.delay = buf.ReadFloat();
        act.stopOnExit = buf.ReadBool();
      } else if (atype === 1) { // ChangePage
        act.objectId = buf.ReadS();
        act.controllerName = buf.ReadS();
        act.targetPage = buf.ReadS();
      } else {
        const raw = Array.from(buf.data.subarray(buf.offset + buf.pointer, buf.offset + nextPos));
        act.raw = raw;
        buf.pointer = nextPos;
        actions.push(act);
        continue;
      }
      actions.push(act);
      rec('controller.action.' + aname, nextPos - buf.pointer, name);
      buf.pointer = nextPos;
    }
  }
  return { name, homePageIndex, pages, actions };
}

// =====================================================================
// 组件
// =====================================================================
function parseScroll(buf) {
  const sc = {};
  sc.scrollType = _enum(E.SCROLL_TYPE, buf.ReadByte(), '?');
  sc.scrollBarDisplay = _enum(E.SCROLLBAR_DISPLAY, buf.ReadByte(), '?');
  const flags = buf.ReadInt();
  const fl = [];
  for (const [bit, name] of E.SCROLL_FLAGS) if (flags & bit) fl.push(name);
  if (fl.length) sc.flags = fl;
  if (buf.ReadBool()) {
    sc.scrollBarMargin = { top: buf.ReadInt(), bottom: buf.ReadInt(), left: buf.ReadInt(), right: buf.ReadInt() };
  }
  for (const k of ['vtScrollBarRes', 'hzScrollBarRes', 'headerRes', 'footerRes']) {
    const v = buf.ReadS();
    if (v !== null) sc[k] = v;
  }
  return sc;
}

function _enum(map, v, fallback) {
  return map[v] != null ? map[v] : fallback;
}

function parseConstructExtension(buf, objectTypeId) {
  const ext = { objectType: E.OBJ_TYPE[objectTypeId] != null ? E.OBJ_TYPE[objectTypeId] : objectTypeId };
  if (objectTypeId === 12) { // Button
    ext.mode = _enum(E.BUTTON_MODE, buf.ReadByte(), '?');
    const s = buf.ReadS();
    if (s !== null) ext.sound = s;
    ext.soundVolumeScale = r4(buf.ReadFloat());
    ext.downEffect = buf.ReadByte();
    ext.downEffectValue = r4(buf.ReadFloat());
  } else if (objectTypeId === 13) { // ComboBox
    const s = buf.ReadS();
    if (s !== null) ext.dropdown = s;
  } else if (objectTypeId === 14) { // ProgressBar
    ext.titleType = _enum(E.PROGRESS_TITLE, buf.ReadByte(), '?');
    ext.reverse = buf.ReadBool();
  } else if (objectTypeId === 15) { // Slider
    ext.titleType = _enum(E.PROGRESS_TITLE, buf.ReadByte(), '?');
    ext.reverse = buf.ReadBool();
    if (buf.version >= 2) {
      ext.wholeNumbers = buf.ReadBool();
      ext.changeOnClick = buf.ReadBool();
    }
  } else if (objectTypeId === 16) { // ScrollBar
    ext.fixedGripSize = buf.ReadBool();
  }
  // 11 Label / 17 Tree 不读字节
  return ext;
}

function r4(v) { return Math.round(v * 10000) / 10000; }

function parseComponent(raw, rawById, version, objectTypeId = 9, objtypeById = null) {
  const buf = raw;
  const comp = { sourceWidth: null, sourceHeight: null, controllers: [], children: [], transitions: [], relations: [], masks: [] };
  const ctx = { rawById, version, depth: 0, seen: new Set(), objtypeById: objtypeById || {} };

  // 主属性 (block 0)
  if (buf.Seek(0, 0)) {
    comp.sourceWidth = buf.ReadInt();
    comp.sourceHeight = buf.ReadInt();
    if (buf.ReadBool()) {
      comp.minWidth = buf.ReadInt(); comp.maxWidth = buf.ReadInt();
      comp.minHeight = buf.ReadInt(); comp.maxHeight = buf.ReadInt();
    }
    if (buf.ReadBool()) {
      comp.pivotX = r6(buf.ReadFloat());
      comp.pivotY = r6(buf.ReadFloat());
      comp.pivotAsAnchor = buf.ReadBool();
    }
    if (buf.ReadBool()) {
      comp.margin = { top: buf.ReadInt(), bottom: buf.ReadInt(), left: buf.ReadInt(), right: buf.ReadInt() };
    }
    const ov = buf.ReadByte();
    comp.overflow = E.OVERFLOW_TYPE[ov] != null ? E.OVERFLOW_TYPE[ov] : ov;
    if (ov === 2) {
      const saved = buf.pointer;
      if (buf.Seek(0, 7)) {
        try {
          comp.scroll = parseScroll(buf);
          const sb = segBounds(buf, 0, 7);
          rec('component.block7', (sb ? sb[1] : buf.pointer) - buf.pointer);
        } catch (e) {
          comp.scroll = { error: String(e && e.message || e) };
        }
      }
      buf.pointer = saved;
    }
    if (buf.ReadBool()) {
      comp.clipSoftness = [buf.ReadInt(), buf.ReadInt()];
    }
    const sb0 = segBounds(buf, 0, 0);
    rec('component.block0', (sb0 ? sb0[1] : buf.pointer) - buf.pointer);
  }

  // 控制器 (block 1)
  if (buf.Seek(0, 1)) {
    const cc = buf.ReadShort();
    for (let i = 0; i < cc; i++) {
      let nextPos = buf.ReadUshort();
      nextPos += buf.pointer;
      const beginPos = buf.pointer;
      comp.controllers.push(parseController(buf, beginPos));
      buf.pointer = nextPos;
    }
  }

  // 子元素 (block 2)
  if (buf.Seek(0, 2)) {
    const chc = buf.ReadShort();
    for (let i = 0; i < chc; i++) {
      const dataLen = buf.ReadShort();
      const curPos = buf.pointer;
      const cbuf = new ByteBuffer(buf.data, buf.offset + curPos, dataLen, buf.stringTable, buf.version);
      let child;
      try {
        child = parseChild(cbuf, ctx);
      } catch (e) {
        child = { type: '?', error: String(e && e.message || e),
                  raw: Array.from(buf.data.subarray(buf.offset + curPos, buf.offset + curPos + dataLen)) };
      }
      buf.pointer = curPos + dataLen;
      comp.children.push(child);
    }
  }

  // 组件级关系 (block 3, parentToChild=true)
  if (buf.Seek(0, 3)) {
    comp.relations = parseRelations(buf, true);
  }

  // block4 (mask / hitTest / sound)
  try {
    const blk4 = parseComponentBlock4(buf);
    if (blk4 && Object.keys(blk4).length) comp.block4 = blk4;
  } catch (e) { /* ignore */ }

  // 过渡动画 (block 5)
  if (buf.Seek(0, 5)) {
    comp.transitions = parseTransitions(buf);
  }

  // 组件自身扩展 (block 6)
  if (objectTypeId !== 9 && buf.Seek(0, 6)) {
    try {
      comp.extension = parseConstructExtension(buf, objectTypeId);
      const sb = segBounds(buf, 0, 6);
      const nm = E.OBJ_TYPE[objectTypeId] != null ? E.OBJ_TYPE[objectTypeId] : objectTypeId;
      rec('component.block6.' + nm, (sb ? sb[1] : buf.pointer) - buf.pointer);
    } catch (e) {
      comp.extension = { error: String(e && e.message || e) };
    }
  }

  // 把 transition 的 targetIndex 解析成子元素 id
  const childIds = comp.children.map((c) => c.props && c.props.id);
  for (const tr of comp.transitions) {
    for (const it of tr.items || []) {
      const ti = it.targetIndex;
      if (typeof ti === 'number' && ti >= 0 && ti < childIds.length) {
        it.targetId = childIds[ti];
      }
    }
  }
  return comp;
}

function r6(v) { return Math.round(v * 1e6) / 1e6; }

function block4Range(buf) {
  const data = buf.data;
  const off = buf.offset;
  const segCount = data[off];
  const useShort = data[off + 1] === 1;
  const base = off + 2;
  const offs = [];
  for (let i = 0; i < segCount; i++) {
    if (useShort) {
      const s = base + 2 * i;
      offs.push((data[s] << 8) | data[s + 1]);
    } else {
      const s = base + 4 * i;
      offs.push(((data[s] << 24) | (data[s + 1] << 16) | (data[s + 2] << 8) | data[s + 3]) >>> 0);
    }
  }
  if (offs.length <= 4 || offs[4] <= 0) return null;
  const b5 = offs.length > 5 ? offs[5] : (data.length - off);
  return [offs[4], b5];
}

function parseComponentBlock4(buf) {
  const rng = block4Range(buf);
  if (!rng) return {};
  const [b4, b5] = rng;
  const sub = new ByteBuffer(buf.data, buf.offset + b4, b5 - b4, buf.stringTable, buf.version);
  const res = {};
  sub.Skip(2); // customData
  if (sub.ReadBool()) res.opaque = true;
  const maskId = sub.ReadShortS();
  if (maskId !== -1) {
    res.maskChildIndex = maskId;
    if (sub.ReadBool()) res.reversedMask = true;
  }
  const ht = sub.ReadS();
  const i1 = sub.ReadIntS();
  const i2 = sub.ReadIntS();
  if (ht !== null) {
    res.hitTestId = ht;
    res.hitTestOffset = [i1, i2];
  } else if (i1 !== 0 && i2 !== -1) {
    res.shapeHitTestChildIndex = i2;
  }
  if (sub.version >= 5) {
    const a = sub.ReadS();
    if (a !== null) res.soundOnShow = a;
    const b = sub.ReadS();
    if (b !== null) res.soundOnHide = b;
  }
  rec('component.block4', sub.length - sub.pointer);
  return res;
}

function peekBlock6Type(cbuf) {
  const sb = segBounds(cbuf, 0, 6);
  if (!sb) return null;
  const idx = cbuf.offset + sb[0];
  if (idx >= cbuf.data.length) return null;
  return cbuf.data[idx];
}

function parseChild(cbuf, ctx) {
  cbuf.Seek(0, 0);
  const otype = cbuf.ReadByte();
  const src = cbuf.ReadS();
  const pkgId = cbuf.ReadS();
  let realType = otype;
  if (otype === 9) {
    const tb = peekBlock6Type(cbuf);
    if (E.COMPONENT_EXT_TYPES.has(tb)) realType = tb;
    else {
      const rt = ctx.objtypeById[src];
      if (E.COMPONENT_EXT_TYPES.has(rt)) realType = rt;
    }
  }
  const child = {
    type: E.OBJ_TYPE[realType] != null ? E.OBJ_TYPE[realType] : 'ObjectType' + realType,
    src, pkgId, props: {},
  };
  if (realType !== otype) child.recordType = E.OBJ_TYPE[otype] != null ? E.OBJ_TYPE[otype] : String(otype);
  const p = child.props;

  // ---- Setup_BeforeAdd (block0 公共) ----
  const eid = cbuf.ReadS();
  p.id = eid;
  const ename = cbuf.ReadS();
  p.name = ename;
  p.x = cbuf.ReadIntS();
  p.y = cbuf.ReadIntS();
  if (cbuf.ReadBool()) {
    p.initWidth = cbuf.ReadInt();
    p.initHeight = cbuf.ReadInt();
  }
  if (cbuf.ReadBool()) {
    p.minWidth = cbuf.ReadInt(); p.maxWidth = cbuf.ReadInt();
    p.minHeight = cbuf.ReadInt(); p.maxHeight = cbuf.ReadInt();
  }
  if (cbuf.ReadBool()) {
    p.scaleX = cbuf.ReadFloat();
    p.scaleY = cbuf.ReadFloat();
  }
  if (cbuf.ReadBool()) {
    p.skewX = cbuf.ReadFloat();
    p.skewY = cbuf.ReadFloat();
  }
  if (cbuf.ReadBool()) {
    p.pivotX = cbuf.ReadFloat();
    p.pivotY = cbuf.ReadFloat();
    p.pivotAsAnchor = cbuf.ReadBool();
  }
  const alpha = cbuf.ReadFloat();
  if (alpha !== 1) p.alpha = alpha;
  const rotation = cbuf.ReadFloat();
  if (rotation !== 0) p.rotation = rotation;
  if (!cbuf.ReadBool()) p.visible = false;
  if (!cbuf.ReadBool()) p.touchable = false;
  if (cbuf.ReadBool()) p.grayed = true;
  p.blendMode = cbuf.ReadByte();
  const filt = cbuf.ReadByte();
  if (filt === 1) {
    p.filter = { brightness: cbuf.ReadFloat(), contrast: cbuf.ReadFloat(),
                 saturation: cbuf.ReadFloat(), hue: cbuf.ReadFloat() };
  }
  const d = cbuf.ReadS();
  if (d !== null) p.data = d;

  // ---- Setup_AfterAdd: tooltips(block1) + groupId(block1) + gears(block2) ----
  if (cbuf.Seek(0, 1)) {
    const tt = cbuf.ReadS();
    if (tt !== null) p.tooltips = tt;
    const gid = cbuf.ReadShortS();
    if (gid >= 0) p.groupId = gid;
  }
  if (cbuf.Seek(0, 2)) {
    const gc = cbuf.ReadShort();
    const gears = [];
    for (let i = 0; i < gc; i++) {
      let gnext = cbuf.ReadUshort();
      gnext += cbuf.pointer;
      const gtype = cbuf.ReadByte();
      gears.push(parseGear(cbuf, gtype));
      const gn = E.GEAR_TYPE[gtype] != null ? E.GEAR_TYPE[gtype] : '?';
      rec('gear.' + gtype + '.' + gn, gnext - cbuf.pointer, ename);
      cbuf.pointer = gnext;
    }
    if (gears.length) p.gears = gears;
  }

  // ---- 子元素自身关系 (block3) ----
  if (cbuf.Seek(0, 3)) {
    p.relations = parseRelations(cbuf, false);
  }

  // ---- 组件族子记录 block4 = GComponent.Setup_AfterAdd ----
  if (realType >= 9 && cbuf.Seek(0, 4)) {
    try {
      const pc = cbuf.ReadShortS();
      if (pc !== -1) p.pageController = pc;
      const bc = cbuf.ReadShort();
      const binds = [];
      for (let i = 0; i < bc; i++) binds.push({ controller: cbuf.ReadS(), pageId: cbuf.ReadS() });
      if (binds.length) p.controllerBindings = binds;
      if (cbuf.version >= 2) {
        const pcnt = cbuf.ReadShort();
        const pbinds = [];
        for (let i = 0; i < pcnt; i++) {
          pbinds.push({ target: cbuf.ReadS(), propertyId: cbuf.ReadShort(), value: cbuf.ReadS() });
        }
        if (pbinds.length) p.propertyBindings = pbinds;
      }
      recBlock(cbuf, 4, realType, ename || eid);
    } catch (e) {
      p._block4_error = String(e && e.message || e);
    }
  }

  // ---- 类型专属 (block5/6/7/8/9) ----
  try {
    parseChildSpecific(cbuf, realType, p, ename || eid);
  } catch (e) {
    p._specific_error = String(e && e.message || e);
  }

  // ---- 组件族: 递归取嵌套 title/icon 文本 ----
  if (realType >= 9 && src && ctx.rawById[src] != null &&
      ctx.depth < 3 && !ctx.seen.has(src)) {
    try {
      ctx.seen.add(src);
      const ref = ctx.rawById[src];
      const texts = scanTitles(ref, cbuf.stringTable, cbuf.version);
      if (texts && Object.keys(texts).length) {
        child.nestedText = texts;
        if ('title' in texts) child.titleText = texts.title;
        if ('icon' in texts) child.iconUrl = texts.icon;
      }
    } catch (e) { /* ignore */ }
  }
  return child;
}

// =====================================================================
// 类型专属 (Setup_BeforeAdd block5 / Setup_AfterAdd block6 等)
// =====================================================================
function parseTextFormat(cbuf) {
  const tf = {};
  tf.font = cbuf.ReadS();
  tf.size = cbuf.ReadShort();
  tf.color = cbuf.ReadColor();
  tf.align = _enum(E.ALIGN_TYPE, cbuf.ReadByte(), '?');
  tf.valign = _enum(E.VALIGN_TYPE, cbuf.ReadByte(), '?');
  tf.lineSpacing = cbuf.ReadShortS();
  tf.letterSpacing = cbuf.ReadShortS();
  tf.ubb = cbuf.ReadBool();
  tf.autoSize = _enum(E.AUTOSIZE_TYPE, cbuf.ReadByte(), '?');
  tf.underline = cbuf.ReadBool();
  tf.italic = cbuf.ReadBool();
  tf.bold = cbuf.ReadBool();
  tf.singleLine = cbuf.ReadBool();
  if (cbuf.ReadBool()) {
    tf.outlineColor = cbuf.ReadColor();
    tf.outline = r4(cbuf.ReadFloat());
  }
  if (cbuf.ReadBool()) {
    tf.shadowColor = cbuf.ReadColor();
    tf.shadowOffset = [r4(cbuf.ReadFloat()), r4(cbuf.ReadFloat())];
  }
  if (cbuf.ReadBool()) tf.templateVars = true;
  if (cbuf.version >= 3) {
    tf.strikethrough = cbuf.ReadBool();
    tf.faceDilate = r4(cbuf.ReadFloat());
    tf.outlineSoftness = r4(cbuf.ReadFloat());
    tf.underlaySoftness = r4(cbuf.ReadFloat());
  }
  return tf;
}

function parseListCommon(cbuf, p, tag) {
  if (cbuf.Seek(0, 5)) {
    p.layout = _enum(E.LIST_LAYOUT, cbuf.ReadByte(), '?');
    p.selectionMode = _enum(E.SELECTION_MODE, cbuf.ReadByte(), '?');
    p.align = _enum(E.ALIGN_TYPE, cbuf.ReadByte(), '?');
    p.valign = _enum(E.VALIGN_TYPE, cbuf.ReadByte(), '?');
    p.lineGap = cbuf.ReadShortS();
    p.columnGap = cbuf.ReadShortS();
    p.lineCount = cbuf.ReadShortS();
    p.columnCount = cbuf.ReadShortS();
    p.autoResizeItem = cbuf.ReadBool();
    p.childrenRenderOrder = _enum(E.RENDER_ORDER, cbuf.ReadByte(), '?');
    p.apexIndex = cbuf.ReadShortS();
    if (cbuf.ReadBool()) {
      p.margin = { top: cbuf.ReadInt(), bottom: cbuf.ReadInt(), left: cbuf.ReadInt(), right: cbuf.ReadInt() };
    }
    const ov = cbuf.ReadByte();
    p.overflow = E.OVERFLOW_TYPE[ov] != null ? E.OVERFLOW_TYPE[ov] : ov;
    if (ov === 2) {
      const saved = cbuf.pointer;
      if (cbuf.Seek(0, 7)) {
        try {
          p.scroll = parseScroll(cbuf);
          recBlock(cbuf, 7, 10, tag);
        } catch (e) {
          p.scroll = { error: String(e && e.message || e) };
        }
      }
      cbuf.pointer = saved;
    }
    if (cbuf.ReadBool()) {
      p.clipSoftness = [cbuf.ReadInt(), cbuf.ReadInt()];
    }
    if (cbuf.version >= 2) {
      p.scrollItemToViewOnClick = cbuf.ReadBool();
      p.foldInvisibleItems = cbuf.ReadBool();
    }
    recBlock(cbuf, 5, 10, tag);
  }
  if (cbuf.Seek(0, 8)) {
    const di = cbuf.ReadS();
    if (di !== null) p.defaultItem = di;
    const items = [];
    const icnt = cbuf.ReadShort();
    for (let i = 0; i < icnt; i++) {
      const nextPos = cbuf.ReadUshort() + cbuf.pointer;
      const url = cbuf.ReadS();
      const it = { url: url !== null ? url : di };
      if (url === null && !di) {
        cbuf.pointer = nextPos;
        items.push(it);
        continue;
      }
      for (const k of ['title', 'selectedTitle', 'icon', 'selectedIcon', 'name']) {
        const v = cbuf.ReadS();
        if (v !== null) it[k] = v;
      }
      if (nextPos - cbuf.pointer >= 2) {
        const cnt = cbuf.ReadShort();
        const binds = [];
        for (let j = 0; j < cnt; j++) binds.push({ controller: cbuf.ReadS(), pageId: cbuf.ReadS() });
        if (binds.length) it.controllerBindings = binds;
        if (cbuf.version >= 2 && nextPos - cbuf.pointer >= 2) {
          const cnt2 = cbuf.ReadShort();
          const pb = [];
          for (let j = 0; j < cnt2; j++) {
            pb.push({ target: cbuf.ReadS(), propertyId: cbuf.ReadShort(), value: cbuf.ReadS() });
          }
          if (pb.length) it.propertyBindings = pb;
        }
      }
      rec('list.item', nextPos - cbuf.pointer, tag);
      cbuf.pointer = nextPos;
      items.push(it);
    }
    if (items.length) p.items = items;
    recBlock(cbuf, 8, 10, tag);
  }
  if (cbuf.Seek(0, 6)) {
    const sc = cbuf.ReadShortS();
    if (sc !== -1) p.selectionController = sc;
    recBlock(cbuf, 6, 10, tag);
  }
}

function parseChildSpecific(cbuf, otype, p, tag) {
  if (otype === 0) { // Image
    if (cbuf.Seek(0, 5)) {
      if (cbuf.ReadBool()) p.color = cbuf.ReadColor();
      p.flip = _enum(E.FLIP_TYPE, cbuf.ReadByte(), '?');
      const fm = cbuf.ReadByte();
      p.fillMethod = _enum(E.FILL_METHOD, fm, fm);
      if (fm !== 0) {
        p.fillOrigin = cbuf.ReadByte();
        p.fillClockwise = cbuf.ReadBool();
        p.fillAmount = r4(cbuf.ReadFloat());
      }
      recBlock(cbuf, 5, otype, tag);
    }
  } else if (otype === 1) { // MovieClip
    if (cbuf.Seek(0, 5)) {
      if (cbuf.ReadBool()) p.color = cbuf.ReadColor();
      p.flip = _enum(E.FLIP_TYPE, cbuf.ReadByte(), '?');
      p.frame = cbuf.ReadInt();
      p.playing = cbuf.ReadBool();
      recBlock(cbuf, 5, otype, tag);
    }
  } else if (otype === 3) { // Graph
    if (cbuf.Seek(0, 5)) {
      const t = cbuf.ReadByte();
      p.shapeType = _enum(E.SHAPE_TYPE, t, t);
      if (t !== 0) {
        p.lineSize = cbuf.ReadInt();
        p.lineColor = cbuf.ReadColor();
        p.fillColor = cbuf.ReadColor();
        if (cbuf.ReadBool()) {
          p.cornerRadius = [];
          for (let i = 0; i < 4; i++) p.cornerRadius.push(r4(cbuf.ReadFloat()));
        }
        if (t === 3) { // polygon
          const cnt = cbuf.ReadShort() / 2;
          p.points = [];
          for (let i = 0; i < cnt; i++) p.points.push([r4(cbuf.ReadFloat()), r4(cbuf.ReadFloat())]);
        } else if (t === 4) { // regular polygon
          p.sides = cbuf.ReadShort();
          p.startAngle = r4(cbuf.ReadFloat());
          const cnt = cbuf.ReadShort();
          if (cnt > 0) {
            p.distances = [];
            for (let i = 0; i < cnt; i++) p.distances.push(r4(cbuf.ReadFloat()));
          }
        }
      }
      recBlock(cbuf, 5, otype, tag);
    }
  } else if (otype === 4) { // Loader
    if (cbuf.Seek(0, 5)) {
      p.url = cbuf.ReadS();
      p.align = _enum(E.ALIGN_TYPE, cbuf.ReadByte(), '?');
      p.valign = _enum(E.VALIGN_TYPE, cbuf.ReadByte(), '?');
      const fl = cbuf.ReadByte();
      p.fill = _enum(E.LOADER_FILL, fl, fl);
      p.shrinkOnly = cbuf.ReadBool();
      p.autoSize = cbuf.ReadBool();
      p.showErrorSign = cbuf.ReadBool();
      p.playing = cbuf.ReadBool();
      p.frame = cbuf.ReadInt();
      if (cbuf.ReadBool()) p.color = cbuf.ReadColor();
      const fm = cbuf.ReadByte();
      p.fillMethod = _enum(E.FILL_METHOD, fm, fm);
      if (fm !== 0) {
        p.fillOrigin = cbuf.ReadByte();
        p.fillClockwise = cbuf.ReadBool();
        p.fillAmount = r4(cbuf.ReadFloat());
      }
      if (cbuf.version >= 7) p.useResize = cbuf.ReadBool();
      recBlock(cbuf, 5, otype, tag);
    }
  } else if (otype === 5) { // Group
    if (cbuf.Seek(0, 5)) {
      const gl = cbuf.ReadByte();
      p.layout = _enum(E.GROUP_LAYOUT, gl, gl);
      p.lineGap = cbuf.ReadIntS();
      p.columnGap = cbuf.ReadIntS();
      if (cbuf.version >= 2) {
        p.excludeInvisibles = cbuf.ReadBool();
        p.autoSizeDisabled = cbuf.ReadBool();
        p.mainGridIndex = cbuf.ReadShortS();
      }
      recBlock(cbuf, 5, otype, tag);
    }
  } else if (otype === 6 || otype === 7 || otype === 8) { // Text / RichText / InputText
    if (cbuf.Seek(0, 5)) {
      p.textFormat = parseTextFormat(cbuf);
      recBlock(cbuf, 5, otype, tag);
    }
    if (otype === 8 && cbuf.Seek(0, 4)) { // GTextInput.Setup_BeforeAdd
      const inp = {};
      const s = cbuf.ReadS();
      if (s !== null) inp.promptText = s;
      const s2 = cbuf.ReadS();
      if (s2 !== null) inp.restrict = s2;
      const iv = cbuf.ReadInt();
      if (iv) inp.maxLength = iv;
      const iv2 = cbuf.ReadInt();
      if (iv2) inp.keyboardType = iv2;
      if (cbuf.ReadBool()) inp.password = true;
      if (Object.keys(inp).length) p.input = inp;
      recBlock(cbuf, 4, otype, tag);
    }
    if (cbuf.Seek(0, 6)) {
      const t = cbuf.ReadS();
      if (t !== null) p.text = t;
      recBlock(cbuf, 6, otype, tag);
    }
  } else if (otype === 10) { // List
    parseListCommon(cbuf, p, tag);
  } else if (otype === 17) { // Tree
    parseListCommon(cbuf, p, tag);
    if (cbuf.Seek(0, 9)) {
      try {
        p.treeIndent = cbuf.ReadInt();
        p.clickToExpand = cbuf.ReadByte();
      } catch (e) { /* ignore */ }
    }
  } else if (otype === 11) { // Label
    if (cbuf.Seek(0, 6) && cbuf.ReadByte() === otype) {
      const s = cbuf.ReadS();
      if (s !== null) p.title = s;
      const s2 = cbuf.ReadS();
      if (s2 !== null) p.icon = s2;
      if (cbuf.ReadBool()) p.titleColor = cbuf.ReadColor();
      const iv = cbuf.ReadIntS();
      if (iv !== 0) p.titleFontSize = iv;
      if (cbuf.ReadBool()) {
        const inp = {};
        const a = cbuf.ReadS();
        if (a !== null) inp.promptText = a;
        const b = cbuf.ReadS();
        if (b !== null) inp.restrict = b;
        const c = cbuf.ReadInt();
        if (c) inp.maxLength = c;
        const d = cbuf.ReadInt();
        if (d) inp.keyboardType = d;
        if (cbuf.ReadBool()) inp.password = true;
        p.input = inp;
      }
      if (cbuf.version >= 5) {
        const snd = cbuf.ReadS();
        if (snd) { p.sound = snd; p.soundVolumeScale = r4(cbuf.ReadFloat()); }
        else cbuf.Skip(4);
      }
      recBlock(cbuf, 6, otype, tag);
    }
  } else if (otype === 12) { // Button
    if (cbuf.Seek(0, 6) && cbuf.ReadByte() === otype) {
      for (const k of ['title', 'selectedTitle', 'icon', 'selectedIcon']) {
        const s = cbuf.ReadS();
        if (s !== null) p[k] = s;
      }
      if (cbuf.ReadBool()) p.titleColor = cbuf.ReadColor();
      const iv = cbuf.ReadIntS();
      if (iv !== 0) p.titleFontSize = iv;
      const iv2 = cbuf.ReadShortS();
      if (iv2 >= 0) p.relatedController = iv2;
      const s = cbuf.ReadS();
      if (s !== null) p.relatedPageId = s;
      const snd = cbuf.ReadS();
      if (snd !== null) p.sound = snd;
      if (cbuf.ReadBool()) p.soundVolumeScale = r4(cbuf.ReadFloat());
      if (cbuf.ReadBool()) p.selected = true;
      recBlock(cbuf, 6, otype, tag);
    }
  } else if (otype === 13) { // ComboBox
    if (cbuf.Seek(0, 6) && cbuf.ReadByte() === otype) {
      const items = [];
      const icnt = cbuf.ReadShort();
      for (let i = 0; i < icnt; i++) {
        const nextPos = cbuf.ReadUshort() + cbuf.pointer;
        const e = { item: cbuf.ReadS(), value: cbuf.ReadS() };
        const ic = cbuf.ReadS();
        if (ic !== null) e.icon = ic;
        items.push(e);
        cbuf.pointer = nextPos;
      }
      if (items.length) p.comboItems = items;
      const s = cbuf.ReadS();
      if (s !== null) p.title = s;
      const s2 = cbuf.ReadS();
      if (s2 !== null) p.icon = s2;
      if (cbuf.ReadBool()) p.titleColor = cbuf.ReadColor();
      const iv = cbuf.ReadIntS();
      if (iv > 0) p.visibleItemCount = iv;
      const pd = cbuf.ReadByte();
      p.popupDirection = _enum(E.POPUP_DIRECTION, pd, pd);
      const iv2 = cbuf.ReadShortS();
      if (iv2 >= 0) p.selectionController = iv2;
      if (cbuf.version >= 5) {
        const snd = cbuf.ReadS();
        if (snd !== null) p.sound = snd;
        p.soundVolumeScale = r4(cbuf.ReadFloat());
      }
      recBlock(cbuf, 6, otype, tag);
    }
  } else if (otype === 14) { // ProgressBar
    if (cbuf.Seek(0, 6) && cbuf.ReadByte() === otype) {
      p.value = cbuf.ReadIntS();
      p.max = cbuf.ReadIntS();
      if (cbuf.version >= 2) p.min = cbuf.ReadIntS();
      if (cbuf.version >= 5) {
        const snd = cbuf.ReadS();
        if (snd) { p.sound = snd; p.soundVolumeScale = r4(cbuf.ReadFloat()); }
        else cbuf.Skip(4);
      }
      recBlock(cbuf, 6, otype, tag);
    }
  } else if (otype === 15) { // Slider
    if (cbuf.Seek(0, 6) && cbuf.ReadByte() === otype) {
      p.value = cbuf.ReadIntS();
      p.max = cbuf.ReadIntS();
      if (cbuf.version >= 2) p.min = cbuf.ReadIntS();
      recBlock(cbuf, 6, otype, tag);
    }
  }
  // 16 ScrollBar: 无 Setup_AfterAdd
  return p;
}

function scanTitles(raw, st, version) {
  const buf = new ByteBuffer(raw.data, raw.offset, raw.length, st, version);
  const out = {};
  if (!buf.Seek(0, 2)) return out;
  const n = buf.ReadShort();
  for (let i = 0; i < n; i++) {
    const dl = buf.ReadShort();
    const cp = buf.pointer;
    const cb = new ByteBuffer(buf.data, buf.offset + cp, dl, st, version);
    try {
      cb.Seek(0, 0);
      const otype = cb.ReadByte();
      cb.ReadS(); // src
      cb.ReadS(); // pkgId
      const cid = cb.ReadS();
      const cname = cb.ReadS();
      const key = cname || cid;
      if ((otype === 6 || otype === 7) && cb.Seek(0, 6)) {
        const t = cb.ReadS();
        if (t !== null) out[key] = t;
      }
    } catch (e) { /* ignore */ }
    buf.pointer = cp + dl;
  }
  return out;
}

// =====================================================================
// Gear
// =====================================================================
function parseGear(buf, gtype) {
  const res = { type: E.GEAR_TYPE[gtype] != null ? E.GEAR_TYPE[gtype] : 'Gear' + gtype };
  res.controllerIndex = buf.ReadShortS();
  const cnt = buf.ReadShort();
  if (gtype === 0 || gtype === 8) { // Display / Display2
    res.pages = buf.ReadSArray(cnt);
  } else {
    const values = {};
    for (let i = 0; i < cnt; i++) {
      const page = buf.ReadS();
      if (page === null) continue;
      values[page] = gearAddStatus(buf, gtype);
    }
    if (buf.ReadBool()) { // null page
      values[null] = gearAddStatus(buf, gtype);
    }
    if (Object.keys(values).length) res.values = values;
  }
  // tween
  if (buf.ReadBool()) {
    res.tween = { easeType: buf.ReadByte(), duration: buf.ReadFloat(), delay: buf.ReadFloat() };
  }
  // version>=2 ext (GearXY 百分比)
  if (buf.version >= 2 && gtype === 1) {
    if (buf.ReadBool()) {
      res.positionsInPercent = true;
      const pv = {};
      for (let i = 0; i < cnt; i++) {
        const page = buf.ReadS();
        if (page === null) continue;
        pv[page] = [buf.ReadFloat(), buf.ReadFloat()];
      }
      if (buf.ReadBool()) pv[null] = [buf.ReadFloat(), buf.ReadFloat()];
      res.percentValues = pv;
    }
  }
  // version>=2 ext (GearDisplay2 condition)
  if (buf.version >= 2 && gtype === 8) {
    res.condition = buf.ReadByte();
  }
  // version>=4 customEase
  if (buf.version >= 4 && res.tween && res.tween.easeType === E.EASE_CUSTOM) {
    try { res.tween.customEase = buf.ReadPath(); } catch (e) { /* ignore */ }
  }
  // version>=6 GearAnimation ext
  if (buf.version >= 6 && gtype === 5) {
    const av = {};
    for (let i = 0; i < cnt; i++) {
      const page = buf.ReadS();
      if (page === null) continue;
      av[page] = [buf.ReadS(), buf.ReadS()];
    }
    if (buf.ReadBool()) av[null] = [buf.ReadS(), buf.ReadS()];
    res.animExt = av;
  }
  return res;
}

function gearAddStatus(buf, gtype) {
  if (gtype === 1) return { x: buf.ReadInt(), y: buf.ReadInt() };
  if (gtype === 2) {
    return { width: buf.ReadInt(), height: buf.ReadInt(),
             scaleX: buf.ReadFloat(), scaleY: buf.ReadFloat() };
  }
  if (gtype === 3) {
    return { alpha: buf.ReadFloat(), rotation: buf.ReadFloat(),
             grayed: buf.ReadBool(), touchable: buf.ReadBool() };
  }
  if (gtype === 4) return { color: buf.ReadColor(), strokeColor: buf.ReadColor() };
  if (gtype === 5) return { playing: buf.ReadBool(), frame: buf.ReadInt() };
  if (gtype === 6 || gtype === 7) return buf.ReadS();
  if (gtype === 9) return { size: buf.ReadIntS() }; // FontSize 是 int
  return null;
}

// =====================================================================
// Relations
// =====================================================================
function parseRelations(buf, parentToChild) {
  const rels = [];
  const cnt = buf.ReadByte();
  for (let i = 0; i < cnt; i++) {
    const targetIndex = buf.ReadShortS();
    const item = { target: targetIndex === -1 ? 'parent' : targetIndex };
    const cnt2 = buf.ReadByte();
    const rts = [];
    for (let j = 0; j < cnt2; j++) {
      const rt = buf.ReadByte();
      const usePercent = buf.ReadBool();
      rts.push({ type: rt < E.RELATION_TYPE.length ? E.RELATION_TYPE[rt] : rt, usePercent });
    }
    item.relations = rts;
    rels.push(item);
  }
  return rels;
}

// =====================================================================
// Transitions
// =====================================================================
function parseTransitions(buf) {
  const cnt = buf.ReadShort();
  const out = [];
  for (let i = 0; i < cnt; i++) {
    const nextPos = buf.ReadUshort();
    const frameEnd = buf.pointer + nextPos;
    const name = buf.ReadS();
    const options = buf.ReadInt();
    const autoPlay = buf.ReadBool();
    const autoPlayTimes = buf.ReadIntS();
    const autoPlayDelay = buf.ReadFloat();
    const icnt = buf.ReadShort();
    const items = [];
    for (let j = 0; j < icnt; j++) {
      const dataLen = buf.ReadShort();
      const curPos = buf.pointer;
      const ibuf = new ByteBuffer(buf.data, buf.offset + curPos, dataLen, buf.stringTable, buf.version);
      try {
        items.push(parseTransitionItem(ibuf));
      } catch (e) {
        items.push({ error: String(e && e.message || e),
                     raw: Array.from(buf.data.subarray(buf.offset + curPos, buf.offset + curPos + dataLen)) });
      }
      buf.pointer = curPos + dataLen;
    }
    out.push({ name, options, autoPlay, autoPlayTimes, autoPlayDelay, items });
    rec('transition.frame', frameEnd - buf.pointer, name);
    buf.pointer = frameEnd;
  }
  return out;
}

function parseTransitionItem(ibuf) {
  ibuf.Seek(0, 0);
  const ttype = ibuf.ReadByte();
  const time = ibuf.ReadFloat();
  const targetId = ibuf.ReadShortS(); // -1 = 宿主
  const target = targetId < 0 ? '' : targetId;
  const label = ibuf.ReadS();
  const hasTween = ibuf.ReadBool();
  const item = { type: E.TAT[ttype] != null ? E.TAT[ttype] : 'TAT' + ttype,
                 time: r4(time), targetIndex: target, label };
  if (hasTween) {
    ibuf.Seek(0, 1);
    const tw = { duration: ibuf.ReadFloat(), easeType: ibuf.ReadByte(),
                 repeat: ibuf.ReadIntS(), yoyo: ibuf.ReadBool(), endLabel: ibuf.ReadS() };
    ibuf.Seek(0, 2);
    tw.startValue = decodeTransitionValue(ttype, ibuf);
    ibuf.Seek(0, 3);
    tw.endValue = decodeTransitionValue(ttype, ibuf);
    if (ibuf.version >= 2) {
      try { tw.path = ibuf.ReadPath(); } catch (e) { /* ignore */ }
    }
    if (ibuf.version >= 4 && tw.easeType === E.EASE_CUSTOM) {
      try { tw.customEase = ibuf.ReadPath(); } catch (e) { /* ignore */ }
    }
    item.tween = tw;
    rec('transitem.tween.' + item.type, ibuf.length - ibuf.pointer, item.type);
  } else {
    ibuf.Seek(0, 2);
    item.value = decodeTransitionValue(ttype, ibuf);
    rec('transitem.plain.' + item.type, ibuf.length - ibuf.pointer, item.type);
  }
  return item;
}

function decodeTransitionValue(ttype, b) {
  if (ttype === 0 || ttype === 1 || ttype === 3 || ttype === 13) { // XY/Size/Pivot/Skew
    const v = { b1: b.ReadBool(), b2: b.ReadBool(), f1: b.ReadFloat(), f2: b.ReadFloat() };
    if (b.version >= 2 && ttype === 0) v.b3 = b.ReadBool(); // percent
    return v;
  }
  if (ttype === 4 || ttype === 5) return { f1: b.ReadFloat() }; // Alpha/Rotation
  if (ttype === 2) return { f1: b.ReadFloat(), f2: b.ReadFloat() }; // Scale
  if (ttype === 6) return { color: b.ReadColor() };
  if (ttype === 7) { // Animation
    const v = { playing: b.ReadBool(), frame: b.ReadInt() };
    if (b.version >= 6) {
      v.animationName = b.ReadS();
      v.skinName = b.ReadS();
    }
    return v;
  }
  if (ttype === 8) return { visible: b.ReadBool() };
  if (ttype === 9) return { sound: b.ReadS(), volume: b.ReadFloat() };
  if (ttype === 10) return { transName: b.ReadS(), playTimes: b.ReadInt() };
  if (ttype === 11) return { amplitude: b.ReadFloat(), duration: b.ReadFloat() };
  if (ttype === 12) return { f1: b.ReadFloat(), f2: b.ReadFloat(), f3: b.ReadFloat(), f4: b.ReadFloat() };
  if (ttype === 14 || ttype === 15) return { text: b.ReadS() };
  return {};
}

// =====================================================================
// 包
// =====================================================================
function parsePackage(path, dataOrBuf) {
  const buf = dataOrBuf instanceof ByteBuffer
    ? dataOrBuf
    : new ByteBuffer(Buffer.isBuffer(dataOrBuf) ? dataOrBuf : require('fs').readFileSync(path));
  if (buf.ReadUint() !== 0x46475549) {
    throw new Error('不是 FGUI 包 (magic 不匹配): ' + path);
  }
  const version = buf.ReadInt();
  const ver2 = version >= 2;
  const compressed = buf.ReadBool();
  buf.version = version;
  const pkgId = buf.ReadString();
  const pkgName = buf.ReadString();
  buf.Skip(20);
  const indexTablePos = buf.pointer;

  // 段偏移表
  buf.pointer = indexTablePos;
  const segCount = buf.data[buf.offset + buf.pointer];
  buf.pointer += 1;
  const useShort = buf.data[buf.offset + buf.pointer] === 1;
  buf.pointer += 1;
  const segOffsets = [];
  for (let i = 0; i < segCount; i++) {
    segOffsets.push(useShort ? buf.ReadShort() : buf.ReadInt());
  }

  // 字符串表 (block 4)
  buf.Seek(indexTablePos, 4);
  let cnt = buf.ReadInt();
  const stringTable = new Array(cnt);
  for (let i = 0; i < cnt; i++) stringTable[i] = buf.ReadString();
  buf.stringTable = stringTable;

  // 扩展字符串表 (block 5)
  if (buf.Seek(indexTablePos, 5)) {
    cnt = buf.ReadShort();
    for (let i = 0; i < cnt; i++) {
      const idx = buf.ReadUshort();
      const ln = buf.ReadInt();
      stringTable[idx] = buf.ReadStringN(ln);
    }
  }

  // 依赖 (block 0)
  const deps = [];
  if (buf.Seek(indexTablePos, 0)) {
    cnt = buf.ReadShort();
    for (let i = 0; i < cnt; i++) {
      const did = buf.ReadS();
      const dname = buf.ReadS();
      deps.push({ id: did, name: dname });
    }
    if (ver2) {
      const bcnt = buf.ReadShort();
      if (bcnt > 0) buf.ReadSArray(bcnt);
    }
  }

  // items (block 1)
  const { items, rawById } = parseItems(buf, indexTablePos, ver2);

  // 图集 sprite (block 2)
  const sprites = [];
  if (buf.Seek(indexTablePos, 2)) {
    cnt = buf.ReadShort();
    for (let i = 0; i < cnt; i++) {
      let nextPos = buf.ReadUshort();
      nextPos += buf.pointer;
      const itemId = buf.ReadS();
      const piId = buf.ReadS();
      const sp = { spriteId: itemId, atlasItemId: piId };
      sp.x = buf.ReadInt();
      sp.y = buf.ReadInt();
      sp.w = buf.ReadInt();
      sp.h = buf.ReadInt();
      sp.rotated = buf.ReadBool();
      if (ver2 && buf.ReadBool()) {
        sp.ox = buf.ReadInt();
        sp.oy = buf.ReadInt();
        sp.ow = buf.ReadInt();
        sp.oh = buf.ReadInt();
      } else if (sp.rotated) {
        sp.ow = sp.h;
        sp.oh = sp.w;
      } else {
        sp.ow = sp.w;
        sp.oh = sp.h;
      }
      sprites.push(sp);
      buf.pointer = nextPos;
    }
  }

  // 组件内部树
  const objtypeById = {};
  for (const it of items) {
    if (it.type === 'Component') objtypeById[it.id] = it.objectTypeId != null ? it.objectTypeId : 9;
  }
  for (const it of items) {
    if (it.type === 'Component' && rawById[it.id] != null) {
      it.component = parseComponent(rawById[it.id], rawById, version,
                                    it.objectTypeId != null ? it.objectTypeId : 9, objtypeById);
    }
  }

  const pkg = {
    id: pkgId, name: pkgName, version, compressed,
    deps, items, sprites,
  };
  // rawById 不进序列化
  Object.defineProperty(pkg, 'rawById', { value: rawById, enumerable: false, writable: true });
  Object.defineProperty(pkg, 'indexTablePos', { value: indexTablePos, enumerable: false, writable: true });
  Object.defineProperty(pkg, 'buf', { value: buf, enumerable: false, writable: true });
  return pkg;
}

function parseItems(buf, indexTablePos, ver2) {
  buf.Seek(indexTablePos, 1);
  const cnt = buf.ReadShort();
  const items = [];
  const rawById = {};
  for (let i = 0; i < cnt; i++) {
    let nextPos = buf.ReadInt();
    nextPos += buf.pointer;
    const it = {};
    it.type = _enum(E.ITEM_TYPE, buf.ReadByte(), '?');
    it.id = buf.ReadS();
    it.name = buf.ReadS();
    buf.ReadS(); // path
    it.file = buf.ReadS();
    it.exported = buf.ReadBool();
    it.width = buf.ReadInt();
    it.height = buf.ReadInt();
    const t = it.type;
    if (t === 'Image') {
      const so = buf.ReadByte();
      if (so === 1) {
        for (let j = 0; j < 4; j++) buf.ReadInt(); // scale9 rect
        buf.ReadInt(); // tileGridIndice
      } else if (so === 2) { /* 无数据 */ }
      buf.ReadBool(); // smoothing
    } else if (t === 'MovieClip') {
      buf.ReadBool(); // smoothing
      const raw = buf.ReadBuffer();
      rawById[it.id] = raw;
    } else if (t === 'Font') {
      const raw = buf.ReadBuffer();
      rawById[it.id] = raw;
    } else if (t === 'Component') {
      const ext = buf.ReadByte(); // extension objectType
      it.objectTypeId = ext > 0 ? ext : 9;
      it.objectType = E.OBJ_TYPE[it.objectTypeId] != null ? E.OBJ_TYPE[it.objectTypeId] : 'ObjectType' + it.objectTypeId;
      const raw = buf.ReadBuffer();
      rawById[it.id] = raw;
    } else if (t === 'Spine' || t === 'DragonBones') {
      buf.ReadFloat();
      buf.ReadFloat(); // skeleton anchor
    }
    if (ver2) {
      const br = buf.ReadS();
      if (br !== null) it.name = br + '/' + it.name;
      const bcnt = buf.ReadByte();
      if (bcnt > 0) buf.ReadS(); // branchIncluded 未知, 保守跳过 1 个
      const hcnt = buf.ReadByte();
      if (hcnt > 0) buf.ReadSArray(hcnt);
    }
    buf.pointer = nextPos;
    items.push(it);
  }
  return { items, rawById };
}

module.exports = {
  parsePackage, parseComponent, parseChild, parseGear, gearAddStatus,
  parseRelations, parseTransitions, parseTransitionItem, decodeTransitionValue,
  parseController, parseScroll, parseConstructExtension, parseItems, scanTitles,
  parseTextFormat, parseListCommon, parseChildSpecific, ByteBuffer,
  setStats: (s) => { STATS = s; },
  getStats: () => STATS,
  rec,
};
