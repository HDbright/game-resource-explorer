'use strict';
/** FGUI 风格 XML 生成 —— 与 fgui_bin2xml.py 的 emit_* 保持一致 */
const E = require('./enums');

const XESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function xe(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  let out = '';
  for (const c of s) {
    if (XESC[c]) out += XESC[c];
    else if (c.charCodeAt(0) < 0x20 && c !== '\t') out += '&#' + c.charCodeAt(0) + ';';
    else out += c;
  }
  return out;
}

function _num(v) {
  if (typeof v === 'number' && !Number.isInteger(v)) {
    if (v === Math.round(v)) return String(Math.round(v));
    const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  return String(v);
}

/** 属性收集器, 保持写入顺序 */
class A {
  constructor() { this.items = []; }

  set(k, v, skip) {
    if (v === null || v === undefined || v === skip) return this;
    let val = v;
    if (typeof v === 'boolean') val = v ? 'true' : 'false';
    else if (typeof v === 'number') val = _num(v);
    this.items.push([k, val]);
    return this;
  }

  raw(k, v) {
    if (v !== null && v !== undefined) this.items.push([k, v]);
    return this;
  }

  get empty() { return this.items.length === 0; }

  toString() {
    return this.items.map(([k, v]) => ` ${k}="${xe(v)}"`).join('');
  }
}

// relation 的 sidePair 名称
const REL_XML = {
  Left_Left: 'left-left', Left_Center: 'left-center', Left_Right: 'left-right',
  Center_Left: 'center-left', Center_Center: 'center-center',
  Center_Right: 'center-right', Right_Left: 'right-left',
  Right_Center: 'right-center', Right_Right: 'right-right',
  Top_Top: 'top-top', Top_Middle: 'top-middle', Top_Bottom: 'top-bottom',
  Middle_Top: 'middle-top', Middle_Middle: 'middle-middle',
  Middle_Bottom: 'middle-bottom', Bottom_Top: 'bottom-top',
  Bottom_Middle: 'bottom-middle', Bottom_Bottom: 'bottom-bottom',
  Width: 'width', Height: 'height',
  LeftExt_Left: 'leftext-left', LeftExt_Right: 'leftext-right',
  RightExt_Left: 'rightext-left', RightExt_Right: 'rightext-right',
  TopExt_Top: 'topext-top', TopExt_Bottom: 'topext-bottom',
  BottomExt_Top: 'bottomext-top', BottomExt_Bottom: 'bottomext-bottom',
};

// ObjectType -> XML 标签名
const TAG = { Image: 'image', MovieClip: 'movieclip', Swf: 'swf', Graph: 'graph',
              Loader: 'loader', Group: 'group', Text: 'text', RichText: 'richtext',
              InputText: 'text', Component: 'component', List: 'list',
              Label: 'component', Button: 'component', ComboBox: 'component',
              ProgressBar: 'component', Slider: 'component', ScrollBar: 'component',
              Tree: 'list', Loader3D: 'loader3D' };

const GEAR_TAG = { Display: 'gearDisplay', XY: 'gearXY', Size: 'gearSize',
                   Look: 'gearLook', Color: 'gearColor', Animation: 'gearAni',
                   Text: 'gearText', Icon: 'gearIcon', Display2: 'gearDisplay2',
                   FontSize: 'gearFontSize' };

function gearValueStr(g, v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const t = g.type;
    if (t === 'XY') return `${_num(v.x)},${_num(v.y)}`;
    if (t === 'Size') return `${_num(v.width)},${_num(v.height)},${_num(v.scaleX)},${_num(v.scaleY)}`;
    if (t === 'Look') return `${_num(v.alpha)},${_num(v.rotation)},${v.grayed ? 1 : 0},${v.touchable ? 1 : 0}`;
    if (t === 'Color') return `${v.color},${v.strokeColor}`;
    if (t === 'Animation') return `${v.playing ? 1 : 0},${_num(v.frame)}`;
    if (t === 'FontSize') return _num(v.size);
  }
  return String(v);
}

function emitGears(L, indent, gears, ctrlNames) {
  for (const g of gears) {
    const tag = GEAR_TAG[g.type] || 'gear';
    const a = new A();
    const ci = g.controllerIndex != null ? g.controllerIndex : -1;
    a.set('controller', (ci >= 0 && ci < ctrlNames.length) ? ctrlNames[ci] : ci);
    if (Array.isArray(g.pages)) {
      a.set('pages', g.pages.filter((x) => x !== null).join(','));
    }
    const vals = g.values || {};
    const pages = Object.keys(vals).filter((k) => k !== 'null');
    if (pages.length) {
      a.set('pages', pages.join(','));
      const vs = pages.map((k) => gearValueStr(g, vals[k]));
      if (vs.some((x) => x !== null)) {
        a.set('values', vs.map((x) => (x !== null ? x : '')).join('|'));
      }
    }
    if (vals['null'] !== undefined) a.set('default', gearValueStr(g, vals['null']));
    if (g.percentValues) a.set('positionsInPercent', true);
    if (g.condition !== undefined) a.set('condition', g.condition);
    if (g.tween) {
      a.set('tween', true).set('ease', g.tween.easeType)
       .set('duration', g.tween.duration).set('delay', g.tween.delay, 0);
    }
    L.push(`${indent}<${tag}${a}/>`);
  }
}

function emitRelations(L, indent, rels, childIds) {
  for (const r of rels) {
    let tgt = '';
    const t = r.target;
    if (t === 'parent' || t === -1) tgt = '';
    else if (typeof t === 'number' && t >= 0 && t < childIds.length) tgt = childIds[t] || String(t);
    else tgt = String(t);
    const sp = r.relations.map((x) =>
      (REL_XML[x.type] != null ? REL_XML[x.type] : String(x.type)) +
      (x.usePercent ? '%' : '')).join(',');
    L.push(`${indent}<relation target="${xe(tgt)}" sidePair="${xe(sp)}"/>`);
  }
}

function emitChild(L, indent, ch, ctrlNames, childIds, srcResolver) {
  const p = ch.props || {};
  const ctype = ch.type || '?';
  const tag = TAG[ctype] || ctype.toLowerCase();
  const a = new A();
  a.set('id', p.id).set('name', p.name);
  // src: 源工程格式——本包引用保持原样; 跨包引用经 srcResolver 转为 "包名.资源名"(依赖包缺失时保留 pkgId)
  let src = ch.src;
  let pkg = ch.pkgId;
  if (srcResolver) {
    const r = srcResolver(ch);
    if (r && r.src != null) { src = r.src; pkg = r.pkg; }
  }
  a.set('src', src).set('pkg', pkg);
  a.set('xy', `${_num(p.x || 0)},${_num(p.y || 0)}`);
  if (p.initWidth !== undefined) a.set('size', `${_num(p.initWidth)},${_num(p.initHeight)}`);
  if (p.minWidth !== undefined) {
    a.set('restrictSize', `${_num(p.minWidth)},${_num(p.maxWidth)},${_num(p.minHeight)},${_num(p.maxHeight)}`);
  }
  if (p.scaleX !== undefined) a.set('scale', `${_num(p.scaleX)},${_num(p.scaleY)}`);
  if (p.skewX !== undefined) a.set('skew', `${_num(p.skewX)},${_num(p.skewY)}`);
  if (p.pivotX !== undefined) {
    a.set('pivot', `${_num(p.pivotX)},${_num(p.pivotY)}`);
    a.set('anchor', p.pivotAsAnchor, false);
  }
  a.set('alpha', p.alpha).set('rotation', p.rotation);
  a.set('visible', p.visible).set('touchable', p.touchable);
  a.set('grayed', p.grayed).set('blend', p.blendMode, 0);
  if (p.filter) {
    const f = p.filter;
    a.set('filter', 'color').set('filterData',
      `${_num(f.brightness)},${_num(f.contrast)},${_num(f.saturation)},${_num(f.hue)}`);
  }
  a.set('group', p.groupId).set('tooltips', p.tooltips);
  a.set('customData', p.data);
  a.set('pageController', p.pageController);

  // ---- 子节点(扩展节点/relations/gears 等) ----
  const inner = [];
  const ind2 = indent + '  ';

  // ---- 类型专属属性 ----
  if (ctype === 'Text' || ctype === 'RichText' || ctype === 'InputText') {
    const tf = p.textFormat || {};
    a.set('font', tf.font).set('fontSize', tf.size);
    a.set('color', tf.color).set('align', tf.align, 'left');
    a.set('vAlign', tf.valign, 'top');
    a.set('leading', tf.lineSpacing, 0);
    a.set('letterSpacing', tf.letterSpacing, 0);
    a.set('ubb', tf.ubb, false).set('autoSize', tf.autoSize, 'none');
    a.set('underline', tf.underline, false);
    a.set('italic', tf.italic, false).set('bold', tf.bold, false);
    a.set('singleLine', tf.singleLine, false);
    a.set('strokeColor', tf.outlineColor).set('strokeSize', tf.outline);
    a.set('shadowColor', tf.shadowColor);
    if (tf.shadowOffset) {
      a.set('shadowOffset', `${_num(tf.shadowOffset[0])},${_num(tf.shadowOffset[1])}`);
    }
    a.set('strikethrough', tf.strikethrough, false);
    a.set('text', p.text);
    if (p.input) {
      const i = p.input;
      a.set('input', true).set('prompt', i.promptText);
      a.set('restrict', i.restrict).set('maxLength', i.maxLength);
      a.set('keyboardType', i.keyboardType).set('password', i.password);
    }
  } else if (ctype === 'Image') {
    a.set('color', p.color).set('flip', p.flip, 'none');
    a.set('fillMethod', p.fillMethod, 'none');
    a.set('fillOrigin', p.fillOrigin).set('fillClockwise', p.fillClockwise);
    a.set('fillAmount', p.fillAmount);
  } else if (ctype === 'MovieClip') {
    a.set('color', p.color).set('flip', p.flip, 'none');
    a.set('frame', p.frame, 0).set('playing', p.playing, true);
  } else if (ctype === 'Loader') {
    a.set('url', p.url).set('align', p.align, 'left');
    a.set('vAlign', p.valign, 'top').set('fill', p.fill, 'none');
    a.set('shrinkOnly', p.shrinkOnly, false);
    a.set('autoSize', p.autoSize, false);
    a.set('errorSign', p.showErrorSign, true);
    a.set('playing', p.playing, true).set('frame', p.frame, 0);
    a.set('color', p.color).set('fillMethod', p.fillMethod, 'none');
    a.set('fillOrigin', p.fillOrigin).set('fillClockwise', p.fillClockwise);
    a.set('fillAmount', p.fillAmount);
    a.set('useResize', p.useResize);
  } else if (ctype === 'Graph') {
    a.set('type', p.shapeType).set('lineSize', p.lineSize);
    a.set('lineColor', p.lineColor).set('fillColor', p.fillColor);
    if (p.cornerRadius) a.set('corner', p.cornerRadius.map(_num).join(','));
    if (p.points) {
      a.set('points', p.points.map(([x, y]) => `${_num(x)},${_num(y)}`).join(' '));
    }
    a.set('sides', p.sides).set('startAngle', p.startAngle);
  } else if (ctype === 'Group') {
    a.set('layout', p.layout, 'none').set('lineGap', p.lineGap, 0);
    a.set('colGap', p.columnGap, 0);
    a.set('excludeInvisibles', p.excludeInvisibles, false);
    a.set('autoSizeDisabled', p.autoSizeDisabled, false);
    a.set('mainGridIndex', p.mainGridIndex, -1);
  } else if (ctype === 'List' || ctype === 'Tree') {
    a.set('layout', p.layout, 'single_column');
    a.set('selectionMode', p.selectionMode, 'single');
    a.set('align', p.align, 'left').set('vAlign', p.valign, 'top');
    a.set('lineGap', p.lineGap, 0).set('colGap', p.columnGap, 0);
    a.set('lineItemCount', p.columnCount, 0);
    a.set('lineCount', p.lineCount, 0);
    a.set('autoItemSize', p.autoResizeItem, true);
    a.set('renderOrder', p.childrenRenderOrder, 'ascent');
    a.set('apexIndex', p.apexIndex, 0);
    if (p.margin) {
      const m = p.margin;
      a.set('margin', `${m.top},${m.bottom},${m.left},${m.right}`);
    }
    a.set('overflow', p.overflow, 'visible');
    if (p.clipSoftness) a.set('clipSoftness', `${p.clipSoftness[0]},${p.clipSoftness[1]}`);
    a.set('scrollItemToViewOnClick', p.scrollItemToViewOnClick, true);
    a.set('foldInvisibleItems', p.foldInvisibleItems, false);
    a.set('defaultItem', p.defaultItem);
    a.set('selectionController', p.selectionController);
    const sc = p.scroll || {};
    a.set('scroll', sc.scrollType).set('scrollBar', sc.scrollBarDisplay);
    if (sc.flags) a.set('scrollFlags', sc.flags.join(','));
    a.set('vtScrollBarRes', sc.vtScrollBarRes);
    a.set('hzScrollBarRes', sc.hzScrollBarRes);
  } else if (ctype === 'Label' || ctype === 'Button' || ctype === 'ComboBox' ||
             ctype === 'ProgressBar' || ctype === 'Slider' || ctype === 'ScrollBar') {
    // 扩展组件: 扩展属性输出为内嵌 <Button/> 等节点(FairyGUI 源工程格式, 见官方 Demo 组件 XML)
    const extA = new A();
    if (ctype === 'Button') {
      extA.set('title', p.title).set('selectedTitle', p.selectedTitle);
      extA.set('icon', p.icon).set('selectedIcon', p.selectedIcon);
      extA.set('titleColor', p.titleColor).set('titleFontSize', p.titleFontSize);
      extA.set('controller', p.relatedController).set('page', p.relatedPageId);
      extA.set('sound', p.sound).set('volume', p.soundVolumeScale);
      extA.set('checked', p.selected);
      extA.set('downEffect', p.downEffect).set('downEffectValue', p.downEffectValue);
      if (p.input) {
        const i = p.input;
        extA.set('input', true).set('prompt', i.promptText).set('restrict', i.restrict);
        extA.set('maxLength', i.maxLength).set('password', i.password);
      }
    } else if (ctype === 'Label') {
      extA.set('title', p.title).set('icon', p.icon).set('titleColor', p.titleColor).set('titleFontSize', p.titleFontSize);
    } else if (ctype === 'ProgressBar') {
      extA.set('title', p.title).set('titleColor', p.titleColor).set('max', p.max).set('value', p.value).set('reverse', p.reverse);
    } else if (ctype === 'Slider') {
      extA.set('title', p.title).set('titleColor', p.titleColor).set('max', p.max).set('min', p.min)
             .set('value', p.value).set('reverse', p.reverse).set('wholeNumbers', p.wholeNumbers);
    } else if (ctype === 'ScrollBar') {
      extA.set('fixedGripSize', p.fixedGripSize);
    } else if (ctype === 'ComboBox') {
      extA.set('title', p.title).set('titleColor', p.titleColor);
      extA.set('visibleItemCount', p.visibleItemCount).set('direction', p.popupDirection);
      extA.set('selectionController', p.selectionController).set('sound', p.sound).set('volume', p.soundVolumeScale);
    }
    if (ctype === 'ComboBox') {
      const extInner = [];
      for (const e of p.comboItems || []) {
        const ia = new A();
        ia.set('title', e.item).set('value', e.value).set('icon', e.icon);
        extInner.push(`${ind2}  <item${ia}/>`);
      }
      if (!extA.empty || extInner.length) {
        inner.push(`${ind2}<ComboBox${extA}>`);
        inner.push(...extInner);
        inner.push(`${ind2}</ComboBox>`);
      }
    } else if (!extA.empty) {
      inner.push(`${ind2}<${ctype}${extA}/>`);
    }
  }
  if (!p.title && ch.titleText) a.set('titleFromTemplate', ch.titleText);

  if (p.relations) emitRelations(inner, ind2, p.relations, childIds);
  if (p.gears) emitGears(inner, ind2, p.gears, ctrlNames);
  for (const b of p.controllerBindings || []) {
    inner.push(`${ind2}<binding controller="${xe(b.controller)}" page="${xe(b.pageId)}"/>`);
  }
  for (const b of p.propertyBindings || []) {
    inner.push(`${ind2}<property target="${xe(b.target)}" propertyId="${b.propertyId}" value="${xe(b.value)}"/>`);
  }
  for (const it of p.items || []) {
    const ia = new A();
    ia.set('url', it.url).set('title', it.title);
    ia.set('selectedTitle', it.selectedTitle).set('icon', it.icon);
    ia.set('selectedIcon', it.selectedIcon).set('name', it.name);
    inner.push(`${ind2}<item${ia}/>`);
  }
  for (const [k, v] of Object.entries(ch.nestedText || {})) {
    if (k !== 'title' && k !== 'icon') {
      inner.push(`${ind2}<nestedText key="${xe(k)}" value="${xe(v)}"/>`);
    }
  }

  if (inner.length) {
    L.push(`${indent}<${tag}${a}>`);
    L.push(...inner);
    L.push(`${indent}</${tag}>`);
  } else {
    L.push(`${indent}<${tag}${a}/>`);
  }
}

function _tv(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (!Object.keys(v).length) return null;
    const parts = [];
    for (const k of ['f1', 'f2', 'f3', 'f4']) {
      if (v[k] !== undefined) parts.push(_num(v[k]));
    }
    if (parts.length) {
      const extra = ['b1', 'b2', 'b3'].filter((k) => k in v);
      let s = parts.join(',');
      if (extra.length) s += '|' + extra.map((k) => (v[k] ? '1' : '0')).join(',');
      return s;
    }
    return Object.entries(v).map(([k, x]) =>
      `${k}=${typeof x === 'number' ? _num(x) : x}`).filter((s) => !s.endsWith('=')).join(',');
  }
  return String(v);
}

function emitComponentXml(item, comp, srcResolver) {
  const L = ['<?xml version="1.0" encoding="utf-8"?>'];
  const ca = new A();
  ca.set('size', `${comp.sourceWidth},${comp.sourceHeight}`);
  if (comp.minWidth !== undefined) {
    ca.set('restrictSize', `${comp.minWidth},${comp.maxWidth},${comp.minHeight},${comp.maxHeight}`);
  }
  if (comp.pivotX !== undefined) {
    ca.set('pivot', `${_num(comp.pivotX)},${_num(comp.pivotY)}`);
    ca.set('anchor', comp.pivotAsAnchor, false);
  }
  if (comp.margin) {
    const m = comp.margin;
    ca.set('margin', `${m.top},${m.bottom},${m.left},${m.right}`);
  }
  ca.set('overflow', comp.overflow, 'visible');
  if (comp.clipSoftness) ca.set('clipSoftness', `${comp.clipSoftness[0]},${comp.clipSoftness[1]}`);
  const sc = comp.scroll || {};
  ca.set('scroll', sc.scrollType).set('scrollBar', sc.scrollBarDisplay);
  if (sc.flags) ca.set('scrollFlags', sc.flags.join(','));
  ca.set('vtScrollBarRes', sc.vtScrollBarRes);
  ca.set('hzScrollBarRes', sc.hzScrollBarRes);
  ca.set('headerRes', sc.headerRes).set('footerRes', sc.footerRes);
  const b4 = comp.block4 || {};
  ca.set('opaque', b4.opaque).set('mask', b4.maskChildIndex);
  ca.set('reversedMask', b4.reversedMask);
  ca.set('hitTest', b4.hitTestId);
  if (b4.hitTestOffset) ca.set('hitTestOffset', `${b4.hitTestOffset[0]},${b4.hitTestOffset[1]}`);
  ca.set('shapeHitTest', b4.shapeHitTestChildIndex);
  ca.set('soundOnShow', b4.soundOnShow).set('soundOnHide', b4.soundOnHide);
  const ext = comp.extension || {};
  ca.set('extention', ext.objectType);
  L.push(`<component${ca}>`);

  const ctrlNames = (comp.controllers || []).map((c, i) => c.name || String(i));
  const childIds = (comp.children || []).map((c) => c.props && c.props.id);

  for (const c of comp.controllers || []) {
    const a = new A();
    a.set('name', c.name);
    a.set('pages', (c.pages || []).map((pg) => `${pg.id || ''},${pg.name || ''}`).join(','));
    a.set('selected', c.homePageIndex, 0);
    const acts = c.actions || [];
    if (!acts.length) {
      L.push(`  <controller${a}/>`);
      continue;
    }
    L.push(`  <controller${a}>`);
    for (const ac of acts) {
      const aa = new A();
      aa.set('type', ac.type);
      if (ac.type === 'PlayTransition') {
        aa.set('transition', ac.transitionName);
        aa.set('playTimes', ac.playTimes);
        aa.set('delay', ac.delay, 0);
        aa.set('stopOnExit', ac.stopOnExit, false);
      } else if (ac.type === 'ChangePage') {
        aa.set('objectId', ac.objectId);
        aa.set('controller', ac.controllerName);
        aa.set('targetPage', ac.targetPage);
      }
      L.push(`    <action${aa}/>`);
    }
    L.push('  </controller>');
  }

  L.push('  <displayList>');
  for (const ch of comp.children || []) emitChild(L, '    ', ch, ctrlNames, childIds, srcResolver);
  L.push('  </displayList>');

  if (comp.relations && comp.relations.length) {
    L.push('  <relations>');
    emitRelations(L, '    ', comp.relations, childIds);
    L.push('  </relations>');
  }

  for (const tr of comp.transitions || []) {
    const ta = new A();
    ta.set('name', tr.name).set('options', tr.options, 0);
    ta.set('autoPlay', tr.autoPlay, false);
    ta.set('autoPlayRepeat', tr.autoPlayTimes, 1);
    ta.set('autoPlayDelay', tr.autoPlayDelay, 0);
    L.push(`  <transition${ta}>`);
    for (const it of tr.items || []) {
      const ia = new A();
      ia.set('time', it.time).set('type', it.type);
      const tid = it.targetId;
      ia.set('target', tid !== undefined ? tid : (it.targetIndex === '' ? '' : it.targetIndex));
      ia.set('label', it.label);
      const tw = it.tween;
      if (tw) {
        ia.set('tween', true).set('duration', tw.duration);
        ia.set('ease', tw.easeType, 0);
        ia.set('repeat', tw.repeat, 0).set('yoyo', tw.yoyo, false);
        ia.set('endLabel', tw.endLabel);
        ia.set('startValue', _tv(tw.startValue));
        ia.set('endValue', _tv(tw.endValue));
      } else {
        ia.set('value', _tv(it.value));
      }
      L.push(`    <item${ia}/>`);
    }
    L.push('  </transition>');
  }

  if (ext && Object.keys(ext).length > 1) {
    const ea = new A();
    for (const [k, v] of Object.entries(ext)) {
      if (k !== 'objectType') ea.set(k, v);
    }
    L.push(`  <${ext.objectType || 'extension'}${ea}/>`);
  }
  L.push('</component>');
  return L.join('\n');
}

function emitPackageXml(pkg) {
  const L = ['<?xml version="1.0" encoding="utf-8"?>', '<packageDescription>', '  <resource>'];
  for (const it of pkg.items) {
    let attrs = `id="${xe(it.id)}" name="${xe(it.name || '')}" type="${xe(it.type)}"`;
    if (it.width !== undefined) attrs += ` width="${it.width}" height="${it.height}"`;
    if (it.file) attrs += ` file="${xe(it.file)}"`;
    if (it.exported !== undefined) attrs += ` exported="${it.exported ? 'true' : 'false'}"`;
    if (it.objectType) attrs += ` objectType="${xe(it.objectType)}"`;
    L.push(`    <item ${attrs}/>`);
  }
  L.push('  </resource>');
  if (pkg.sprites && pkg.sprites.length) {
    L.push('  <sprites>');
    for (const s of pkg.sprites) {
      L.push(`    <sprite id="${xe(s.spriteId)}" atlas="${xe(s.atlasItemId)}" rect="${s.x},${s.y},${s.w},${s.h}" rotated="${s.rotated ? 'true' : 'false'}"/>`);
    }
    L.push('  </sprites>');
  }
  if (pkg.deps && pkg.deps.length) {
    L.push('  <dependencies>');
    for (const d of pkg.deps) {
      L.push(`    <dependency id="${xe(d.id)}" name="${xe(d.name)}"/>`);
    }
    L.push('  </dependencies>');
  }
  L.push('</packageDescription>');
  return L.join('\n');
}

/** 与 Python 版 save_outputs 一致的输出: { packageXml, componentXmls: [{name, xml}] } */
function buildOutputs(pkg) {
  const out = { packageXml: emitPackageXml(pkg), componentXmls: [] };
  for (const it of pkg.items) {
    if (it.type === 'Component' && it.component) {
      const safe = (it.name || it.id).replace(/[\\/]/g, '_');
      out.componentXmls.push({ name: safe, xml: emitComponentXml(it, it.component) });
    }
  }
  return out;
}

/**
 * 生成 FairyGUI 源工程包标准 package.xml(FairyGUI 编辑器可直接打开包的数据库文件)。
 * 格式参考 FairyGUI-unity 仓库 UIProject 下的 assets 包 package.xml 与 fgui-restore handlePackageDataBin:
 *   <packageDescription id><resources><component/image/movieclip/font/sound .../></resources>
 *   <publish name="包名"><atlas name="Default" index="0"/></publish>
 * Atlas 资源不列条目(源工程惯例), 图集由 publish.atlas 声明。
 */
function emitSourcePackageXml(pkg) {
  const L = [`<?xml version="1.0" encoding="utf-8"?>`, `<packageDescription id="${xe(pkg.id)}">`, '  <resources>'];
  const resPath = (it) => {
    let p = it.path;
    if (p == null || p === '') p = '/';
    if (!p.endsWith('/')) p += '/';
    return p;
  };
  for (const it of pkg.items) {
    const id = xe(it.id);
    const nm = it.name || it.id;
    const path = resPath(it);
    let tag;
    let attrs;
    if (it.type === 'Image') {
      const ext = it.file && it.file.indexOf('.') > -1 ? '.' + it.file.split('.').pop() : '.png';
      const name = nm.indexOf('.') > -1 ? nm : nm + ext;
      tag = 'image';
      attrs = `id="${id}" name="${xe(name)}" path="${path}"`;
      if (it.scaleOption === 1 && it.scale9Grid) {
        const g = it.scale9Grid;
        attrs += ` scale="9grid" scale9grid="${g.x},${g.y},${g.width},${g.height}"`;
      } else if (it.scaleOption === 2) {
        attrs += ` scale="tile"`;
      }
    } else if (it.type === 'Component') {
      tag = 'component';
      attrs = `id="${id}" name="${xe(nm)}.xml" path="${path}"`;
    } else if (it.type === 'MovieClip') {
      tag = 'movieclip';
      attrs = `id="${id}" name="${xe(nm)}.jta" path="${path}"`;
    } else if (it.type === 'Font') {
      tag = 'font';
      attrs = `id="${id}" name="${xe(nm)}.fnt" path="${path}"`;
    } else if (it.type === 'Sound') {
      const ext = it.file && it.file.indexOf('.') > -1 ? '.' + it.file.split('.').pop() : '';
      tag = 'sound';
      attrs = `id="${id}" name="${xe(nm)}${ext}" path="${path}"`;
    } else {
      continue; // Atlas / Misc 等: 源工程不列
    }
    if (it.exported) attrs += ' exported="true"';
    L.push(`    <${tag} ${attrs}/>`);
  }
  L.push('  </resources>');
  L.push(`  <publish name="${xe(pkg.name)}">`);
  L.push('    <atlas name="Default" index="0"/>');
  L.push('  </publish>');
  L.push('</packageDescription>');
  return L.join('\n');
}

module.exports = { emitPackageXml, emitComponentXml, emitSourcePackageXml, buildOutputs, xe, _num };
