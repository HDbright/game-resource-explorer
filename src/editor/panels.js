/**
 * 骨骼动画编辑器 - 左侧面板(资源库 / 大纲 / 层级)与右侧属性检查器。
 * 全部通过 ctx.refresh() 驱动重绘;输入框聚焦后首次修改才压撤销快照。
 */

import { toast, confirmDialog, showContextMenu } from '../dialogs.js';
import {
  EASE_PRESETS, bonesInTreeOrder, slotsInZOrder, boneChildren, uniqueName, defaultEase,
} from './model.js';
import { applyEase } from './animator.js';
import { resolveRegionDataUrl, spineSkinsOf } from './spineIO.js';
import icoSkeleton from '../assets/spine-icons/skin_button-setup.png';
import icoSkinPh from '../assets/spine-icons/skin_icon-skinPlaceholder.png';
import icoBoneNull from '../assets/spine-icons/skin_icon-null.png';
import icoBone from '../assets/spine-icons/skin_icon-bone.png';
import icoBoneCst from '../assets/spine-icons/skin_icon-boneConstrained.png';
import icoCstIK from '../assets/spine-icons/skin_icon-constraintIK.png';
import icoCstIKTarget from '../assets/spine-icons/skin_icon-constraintIKTarget.png';
import icoCstPath from '../assets/spine-icons/skin_icon-constraintPath.png';
import icoSlotColored from '../assets/spine-icons/skin_icon-slot-colored.png';
import icoMesh from '../assets/spine-icons/skin_icon-mesh.png';
import icoEye from '../assets/spine-icons/skin_bone-eye.png';

/** 可见性图标:可见 = eye 位图;隐藏 = #616161 小圆点(骨骼/插槽/附件统一) */
const EYE_VISIBLE = `<img class="be-tree-eye-img" src="${icoEye}" draggable="false" alt="">`;
const EYE_HIDDEN = '<span class="be-tree-eye-dot"></span>';

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 骨骼名 → 色相(与层级树骨骼图标同色系:同名同色,跨面板一致) */
const boneHue = (name) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

/** css 颜色字符串(rgb()/hsl()/#hex)→ #hex(取色器 input 需要 hex 值) */
function cssColorToHex(css) {
  const s = String(css || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  let m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0');
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  m = /hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/.exec(s);
  if (m) {
    const h = +m[1] / 360, sa = +m[2] / 100, l = +m[3] / 100;
    const f = (n) => { const k = (n + h * 12) % 12; const a = sa * Math.min(l, 1 - l); const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * v).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  return '#5b5b5b';
}

// ---------------- 骨骼自定义图标(官方 Spine 图标集 + 着色规则) ----------------

/**
 * 图标库(官方 Spine 图标集,mask 剪影 + 着色显示)。
 * 排列顺序按参考图逐格形状匹配(IoU)得出:基本形 → 罗马数字 → 箭头 → 身体部件 → 符号。
 * foot 与 footLeft 形状重复,保留 footLeft(参考图 #10 低置信格即该重复形,已剔除)。
 */
const BONE_ICON_KEYS = ['bone', 'null', 'circle', 'square', 'triangle', 'translate', 'romanI', 'romanVI', 'ik', 'straightLine', 'chevron', 'romanII', 'romanVII', 'gear', 'arrowLeftRight', 'arrowLeft', 'arrowRight', 'romanIII', 'romanVIII', 'arrows', 'arrowUpDown', 'arrowUp', 'arrowDown', 'romanIV', 'footLeft', 'sword', 'handLeft', 'gun', 'muzzleFlash', 'romanV', 'romanX', 'romanIX', 'handRight', 'eye', 'fire', 'particles', 'speechBubble', 'shield', 'footRight', 'mouth', 'warning', 'arrowsB', 'rotate', 'diamondB', 'spiral', 'star', 'asterisk'];
const boneIconUrl = (k) => `/assets/bone-icons/${k}.png`;
/** 图标值是否为图片键(命名图标;非空的其它字符串按 emoji 文本兼容) */
const isImgIconKey = (k) => /^[a-zA-Z][\w-]*$/.test(String(k || '')) && BONE_ICON_KEYS.includes(String(k));

/**
 * 默认形状规则(Spine 树标准):显式 bone.icon → 骨骼名匹配图标名 → 约束目标骨骼 = circle
 * (IK/变换/路径约束的 target,如 crosshair)→ 零长度骨骼 = null(如 exhaust1)。
 * @param raw Spine 原始骨架 JSON(raw.ik/transform/path 的 target 引用)
 */
function defaultIconOf(name, bone, raw) {
  const len = bone && (bone.length || 0);
  if (name) {
    const n = String(name).toLowerCase();
    let hit = BONE_ICON_KEYS.find((k) => k.toLowerCase() === n);
    if (!hit) hit = BONE_ICON_KEYS.find((k) => k.toLowerCase().startsWith(n) && k !== 'bone');
    if (hit) return hit;
  }
  if (raw) {
    for (const key of ['ik', 'transform', 'path']) {
      for (const c of raw[key] || []) if (c.target === name) return 'circle';
    }
  }
  return len === 0 ? 'null' : null;
}

/** Spine 骨骼颜色(hex RRGGBBAA / RRGGBB)→ css rgb;无效返回 null */
function boneRawColor(bone) {
  const s = bone && bone.raw && bone.raw.color;
  if (typeof s !== 'string' || !/^[0-9a-fA-F]{6,8}$/.test(s)) return null;
  return `rgb(${parseInt(s.slice(0, 2), 16)}, ${parseInt(s.slice(2, 4), 16)}, ${parseInt(s.slice(4, 6), 16)})`;
}

/**
 * 图标着色规则:显式设置(bone.iconColor)→ 工程骨骼数据色(bone.color,导入时从 Spine
 * color 属性读入,如 muzzle #ffb900 橙)→ 骨骼名色相(自建项目兜底)。
 */
function iconColorOf(bone) {
  if (bone && bone.iconColor) return bone.iconColor;
  if (bone && bone.color) return bone.color;
  const raw = boneRawColor(bone);
  if (raw) return raw;
  return `hsl(${boneHue(bone.name)}, 70%, 60%)`;
}

/**
 * 着色图标(canvas 逐像素乘色):RGB × 骨骼色、alpha 保持 —— 透明背景不着色(纯 CSS
 * blend 会把整格染色)、深色中心保持深色(null 图标空心感)。结果缓存,未就绪时回退原图,
 * 就绪后广播 bone-icons-tinted 事件触发重绘。
 */
const _tintCache = new Map(); // url|hex → dataUrl
const _tintPending = new Set();
let _tintRedrawTimer = 0;

function tintedIconDataUrl(url, colorCss) {
  let hex = cssColorToHex(colorCss);
  // 无彩灰色(Spine 默认骨骼色 #9b9b9b 等):笔画渲染白色而非灰 —— 白笔画 × 灰 = 灰会发暗,
  // 与 Spine 树的白色效果不一致;饱和度 <10% 视为灰,乘色层用纯白(仅彩色骨骼着色)
  {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 0.1) hex = '#ffffff';
  }
  const ck = url + '|' + hex;
  const hit = _tintCache.get(ck);
  if (hit) return hit;
  if (!_tintPending.has(ck)) {
    _tintPending.add(ck);
    const im = new Image();
    im.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const g = cv.getContext('2d');
        g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height);
        const r = parseInt(hex.slice(1, 3), 16), gr = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        for (let i = 0; i < d.data.length; i += 4) {
          // 仅亮部笔画乘色着色;暗部像素(null 图标深灰中心等)保留原色 ——
          // 全像素乘法会把色相带进暗部,中心变成"深蓝/深红"而非中性深灰
          const lum = 0.3 * d.data[i] + 0.6 * d.data[i + 1] + 0.1 * d.data[i + 2];
          if (d.data[i + 3] > 0 && lum >= 100) {
            d.data[i] = (d.data[i] * r) / 255;
            d.data[i + 1] = (d.data[i + 1] * gr) / 255;
            d.data[i + 2] = (d.data[i + 2] * b) / 255;
          }
        }
        g.putImageData(d, 0, 0);
        _tintCache.set(ck, cv.toDataURL('image/png'));
        clearTimeout(_tintRedrawTimer);
        _tintRedrawTimer = setTimeout(() => document.dispatchEvent(new CustomEvent('bone-icons-tinted')), 30);
      } catch (err) { /* ignore */ }
      _tintPending.delete(ck);
    };
    im.onerror = () => _tintPending.delete(ck);
    im.src = url;
  }
  return null; // 未就绪,调用方回退原图
}

/**
 * 图标 HTML(着色渲染):k 为图标名(图片)或文本(emoji 兼容)。
 * 图片图标用 canvas 乘色结果(透明背景/深色层次保留)。
 */
function boneIconHtml(k, cls, bone) {
  if (isImgIconKey(k)) {
    const url = tintedIconDataUrl(boneIconUrl(k), iconColorOf(bone)) || boneIconUrl(k);
    return `<span class="${cls}" style="background-image:url('${url}')"></span>`;
  }
  return `<span class="${cls}">${esc(k)}</span>`;
}

let _iconPickerEl = null;

/** 关闭已打开的图标选择面板 */
export function closeIconPicker() {
  if (_iconPickerEl) { _iconPickerEl.remove(); _iconPickerEl = null; }
}

/**
 * 打开骨骼图标选择面板(锚点下方弹出,点击外部关闭)。
 * @param {HTMLElement} anchor 定位锚点(图标按钮)
 * @param {Function} onPick (icon) => void — icon 为 '' 表示移除
 */
function openIconPicker(anchor, onPick) {
  closeIconPicker();
  const panel = document.createElement('div');
  panel.className = 'be-icon-picker';
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  const apply = (icon) => { closeIconPicker(); onPick(icon); };
  const title = document.createElement('div');
  title.className = 'be-icon-group-label';
  title.textContent = '骨骼图标';
  panel.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'be-icon-grid';
  for (const k of BONE_ICON_KEYS) {
    const b = document.createElement('button');
    b.className = 'be-icon-cell';
    b.innerHTML = `<img src="${boneIconUrl(k)}" draggable="false" alt="">`;
    b.title = '图标 ' + k;
    b.addEventListener('click', () => apply(k));
    grid.appendChild(b);
  }
  panel.appendChild(grid);
  const foot = document.createElement('div');
  foot.className = 'be-icon-picker-foot';
  const rm = document.createElement('button');
  rm.className = 'btn sm';
  rm.textContent = '✕ 移除图标';
  rm.title = '恢复默认骨骼图标';
  rm.addEventListener('click', () => apply(''));
  foot.appendChild(rm);
  panel.appendChild(foot);
  document.body.appendChild(panel);
  _iconPickerEl = panel;
  // 定位:锚点下方水平居中,越界翻转/钳制
  const ar = anchor.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  let x = ar.left + ar.width / 2 - pr.width / 2;
  x = Math.max(8, Math.min(x, window.innerWidth - pr.width - 8));
  let y = ar.bottom + 6;
  if (y + pr.height > window.innerHeight - 8) y = Math.max(8, ar.top - pr.height - 6);
  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
  // 点击外部关闭:须用冒泡阶段(window)——面板内的 mousedown 已被 stopPropagation 拦截,
  // 不会到达 window;若用捕获阶段,点选图标单元格的 mousedown 会先关掉面板,click 落空
  const onDocDown = () => { closeIconPicker(); window.removeEventListener('mousedown', onDocDown); };
  setTimeout(() => window.addEventListener('mousedown', onDocDown), 0);
}

/** 附件类型中文名(层级树 title 用);undefined = region(spine JSON 省略型) */
function attTypeName(t) {
  return ({ mesh: '网格', linkedmesh: '链接网格', weightedmesh: '加权网格', boundingbox: '边界框', path: '路径', clipping: '裁剪' })[t] || '';
}

/** 层级树附件节点图标:按附件类型区分(Spine 树惯例 —— 网格/链接网格/边界框/路径/裁剪各有图标)
 *  region=图片卡片;mesh=官方 mesh 图标;linkedmesh=网格+链接环;boundingbox=虚线框;path=曲线;clipping=红虚线框 */
function attIconSvg(t) {
  const base = 'class="be-ico-att" viewBox="0 0 16 16" width="13" height="12"';
  switch (t) {
    case 'mesh': case 'weightedmesh':
      return `<img class="be-ico-att be-ico-att-img" src="${icoMesh}" draggable="false">`;
    case 'linkedmesh':
      return `<svg ${base}><rect x="1" y="2" width="14" height="12" rx="1.5" fill="#4527a0" stroke="#b39ddb" stroke-width="1"/>`
        + `<path d="M3.5 4.5l9 1.6M3.5 4.5l3.4 6.6M12.5 6.1l-5.6 5M3.5 4.5L8 11.1" stroke="#e1bee7" stroke-width="0.9" fill="none"/>`
        + `<circle cx="3.5" cy="4.5" r="1.15" fill="#fff"/><circle cx="12.5" cy="6.1" r="1.15" fill="#fff"/><circle cx="8" cy="11.1" r="1.15" fill="#fff"/>`
        + `<path d="M9.2 12.2l2.3-2.3m-2.3 3.4a1.7 1.7 0 0 1 0-2.4l.8-.8m3.2-.2a1.7 1.7 0 0 1 0 2.4l-.8.8" stroke="#ffd54f" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`;
    case 'boundingbox':
      return `<svg ${base}><rect x="2" y="3.5" width="12" height="9" rx="1" fill="none" stroke="#66bb6a" stroke-width="1.2" stroke-dasharray="2.4 1.6"/><circle cx="2" cy="3.5" r="1.2" fill="#66bb6a"/><circle cx="14" cy="3.5" r="1.2" fill="#66bb6a"/><circle cx="2" cy="12.5" r="1.2" fill="#66bb6a"/><circle cx="14" cy="12.5" r="1.2" fill="#66bb6a"/></svg>`;
    case 'path':
      return `<svg ${base}><path d="M3 12.5C5 5.5 11 11 13 4" stroke="#ffb74d" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="3" cy="12.5" r="1.3" fill="#ffb74d"/><circle cx="13" cy="4" r="1.3" fill="#ffb74d"/><path d="M3 12.5l2.2-1.2M13 4l-2.2 1.2" stroke="#ffe0b2" stroke-width="0.9"/></svg>`;
    case 'clipping':
      return `<svg ${base}><rect x="2.5" y="4" width="11" height="8.5" rx="1" fill="rgba(229,72,77,0.12)" stroke="#e5484d" stroke-width="1.1" stroke-dasharray="2.2 1.6"/><path d="M2.5 4L13.5 12.5" stroke="#e5484d" stroke-width="0.9"/></svg>`;
    default: // region:图片卡片
      return `<svg ${base}><rect x="1" y="2" width="14" height="12" rx="1.5" fill="#546e7a" stroke="#cfd8dc" stroke-width="1.2"/><rect x="2.6" y="3.6" width="10.8" height="8.8" fill="#4db6ac"/><circle cx="5.4" cy="6.2" r="1.3" fill="#fffde7"/><path d="M2.6 12.4l3.4-3.8 2.2 2.4 2.5-2.9 2.7 4.3z" fill="#81c784"/></svg>`;
  }
}

export class EditorPanels {
  constructor(ctx) {
    this.ctx = ctx;
    this.treeCollapsed = new Set(); // 层级树折叠:骨骼名 或 '#分区id'
    this._treeFilter = '';          // 层级树搜索关键字
    // 着色图标(canvas 乘色)就绪后重绘树与属性(首次渲染回退原图,就绪即换着色版)
    this._tintedH = () => { this.refreshOutline?.(); this.refreshProps?.(); };
    document.addEventListener('bone-icons-tinted', this._tintedH);
  }

  // ============ 左侧:资源库 ============

  async mountLibrary(el) {
    this.libEl = el;
    el.innerHTML = `
      <div class="be-lib-bar">
        <button class="btn sm" data-act="import">导入图片…</button>
        <span class="be-lib-hint">拖到舞台绑定骨骼</span>
      </div>
      <div class="be-lib-grid"></div>`;
    el.querySelector('[data-act=import]').addEventListener('click', () => this.importImages());
    this.refreshLibrary();
  }

  refreshLibrary() {
    const el = this.libEl?.querySelector('.be-lib-grid');
    if (!el) return;
    const imgs = this.ctx.project.images || [];
    el.innerHTML = '';
    if (!imgs.length) {
      el.innerHTML = '<div class="be-empty">暂无图片<br>点击「导入图片…」添加 PNG/JPG</div>';
      return;
    }
    let pendingRegion = false;
    for (const im of imgs) {
      // Spine region 缩略图:页图异步就绪后才有裁剪结果(未就绪 → 稍后重刷)
      let thumb = im.dataUrl;
      if (!thumb && im.spineRegion) {
        thumb = resolveRegionDataUrl(this.ctx.project, im) || '';
        if (!thumb) pendingRegion = true;
      }
      const card = document.createElement('div');
      card.className = 'be-lib-item';
      card.draggable = true;
      card.title = `${im.name} (${im.w}×${im.h})`;
      card.innerHTML = `<img src="${thumb}" alt=""><div class="be-lib-name">${esc(im.name)}</div><button class="be-lib-del" title="移除图片">✕</button>`;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-bone-img', im.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      card.querySelector('.be-lib-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeImage(im.id);
      });
      el.appendChild(card);
    }
    if (pendingRegion && (this._libRetry || 0) < 80) {
      this._libRetry = (this._libRetry || 0) + 1;
      clearTimeout(this._libTimer);
      this._libTimer = setTimeout(() => this.refreshLibrary(), 120);
    } else if (!pendingRegion) this._libRetry = 0;
  }

  async importImages() {
    const ctx = this.ctx;
    const r = await window.api.pickFiles({
      title: '导入图片',
      multi: true,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    const paths = (!r || r.canceled) ? [] : (r.filePaths || []);
    if (!paths.length) return;
    let added = 0;
    for (const p of paths) {
      const rb = await window.api.readBase64(p);
      if (!rb || !rb.ok) continue;
      const dataUrl = rb.dataUrl;
      const name = p.split(/[\\/]/).pop();
      const dim = await imageSize(dataUrl);
      ctx.beginEdit('导入图片');
      ctx.project.images.push({ id: 'img_' + Math.random().toString(36).slice(2, 9), name, w: dim.w, h: dim.h, dataUrl });
      added++;
    }
    if (added) { ctx.refresh(); toast(`已导入 ${added} 张图片`); }
  }

  removeImage(id) {
    const ctx = this.ctx;
    const used = [];
    for (const s of ctx.project.armature.slots) for (const d of s.displays) if (d.imageId === id) used.push(s.name);
    const doRemove = () => {
      ctx.beginEdit('移除图片');
      ctx.project.images = ctx.project.images.filter((i) => i.id !== id);
      for (const s of ctx.project.armature.slots) {
        s.displays = s.displays.filter((d) => d.imageId !== id);
        if (s.displayIndex >= s.displays.length) s.displayIndex = Math.max(0, s.displays.length - 1);
      }
      ctx.refresh();
    };
    if (used.length) {
      confirmDialog({ title: '移除图片', message: `图片正被插槽 ${used.join('、')} 使用,移除将同时删除对应显示对象。确定移除?`, danger: true, onOk: doRemove });
    } else doRemove();
  }

  // ============ 左侧:大纲 ============

  mountOutline(el) {
    this.outEl = el;
    this.refreshOutline();
  }

  /** 层级树定位:展开目标节点的祖先链并滚动到该节点(舞台双击图片/骨骼联动) */
  revealInTree(type, name) {
    const p = this.ctx.project;
    let boneName = null;
    if (type === 'bone') boneName = name;
    else {
      const slot = p.armature.slots.find((s) => s.name === name);
      boneName = slot ? slot.parent : null;
      if (slot) { this._treeAttCol.delete(name); this._treePhCol?.delete(name); } // 插槽的附件/占位符子项一并展开
    }
    // 展开祖先链(节点自身也要可见);骨骼分区标题也要展开,否则骨骼树整段隐藏
    this.treeCollapsed.delete('#bones');
    let anc = boneName;
    while (anc) { this.treeCollapsed.delete(anc); anc = p.armature.bones.find((b) => b.name === anc)?.parent ?? null; }
    this.refreshOutline();
    // 树重建后滚动到目标行(名称精确匹配)
    requestAnimationFrame(() => {
      const el = this.outEl;
      if (!el) return;
      const rows = [...el.querySelectorAll('.be-tree-row')];
      const row = rows.find((r) => {
        const n = r.querySelector('.be-tree-name');
        return n && n.textContent === name;
      });
      if (row) {
        const sc = el.querySelector('.be-tree-scroll');
        if (sc) {
          const top = row.offsetTop - sc.clientHeight / 2 + row.offsetHeight / 2;
          sc.scrollTop = Math.max(0, top);
        } else row.scrollIntoView({ block: 'center' });
      }
    });
  }

  refreshOutline() {
    const el = this.outEl;
    if (!el) return;
    const ctx = this.ctx;
    const p = ctx.project;
    const filter = (this._treeFilter || '').trim().toLowerCase();
    // 附件折叠状态(哪些插槽折叠了附件子项;默认展开——图片是插槽的下级节点,直接可见)
    if (!this._treeAttCol) this._treeAttCol = new Set();
    // 皮肤占位符折叠状态(多皮肤项目:仅收起占位符的子附件,占位符行保留;独立于插槽附件折叠)
    if (!this._treePhCol) this._treePhCol = new Set();
    // 重建前记住滚动位置:点击节点触发全量重建,不保留会把视图弹回顶部(视觉抖动)
    const prevScrollTop = el.querySelector('.be-tree-scroll')?.scrollTop ?? 0;
    // 结构:固定头(工具栏+列头行) + 滚动树区 —— 搜索/批量操作不随滚动移出视野
    el.innerHTML = '<div class="be-tree-fixed"></div><div class="be-tree-scroll"></div>';
    const fixed = el.querySelector('.be-tree-fixed');
    const list = el.querySelector('.be-tree-scroll');

    // ---- 顶部工具栏:搜索 + 展开/折叠全部 + 全部显示(Spine 风格图标条) ----
    const toolbar = document.createElement('div');
    toolbar.className = 'be-tree-toolbar';
    const search = document.createElement('input');
    search.className = 'be-tree-search';
    search.placeholder = '🔍 搜索骨骼 / 插槽…';
    search.value = this._treeFilter || '';
    search.addEventListener('input', () => {
      this._treeFilter = search.value;
      this.refreshOutline();
      const s2 = el.querySelector('.be-tree-search');
      if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
    });
    toolbar.appendChild(search);
    const toolBtn = (icon, tip, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'be-tree-flag' + (cls ? ' ' + cls : '');
      b.textContent = icon;
      b.title = tip;
      b.addEventListener('click', () => fn(b));
      toolbar.appendChild(b);
    };
    // 新建(Spine 树 New 菜单):骨骼 / 插槽 / 动画
    toolBtn('＋ 新建', '新建:骨骼 / 插槽 / 动画(选中骨骼时创建为其子级)', (btn) => {
      const r = btn.getBoundingClientRect();
      const selBone = ctx.selection?.type === 'bone' ? ctx.selection.name : null;
      const slotHost = selBone || (p.armature.bones[0] && p.armature.bones[0].name) || null;
      showContextMenu(r.left, r.bottom + 4, [
        {
          label: `🦴 新建骨骼${selBone ? `(子级:${selBone})` : '(根级)'}`,
          onClick: () => { if (selBone) ctx.addBoneChild(selBone); else ctx.createBone('', 0, 0, 0, 60); },
        },
        {
          label: `🖼 新建插槽${slotHost ? `(挂到:${slotHost})` : '(需先有骨骼)'}`,
          disabled: !slotHost,
          onClick: () => ctx.addSlotTo(slotHost),
        },
        { label: '▶ 新建动画', onClick: () => ctx.newAnimation() },
      ]);
    }, 'wide');
    // 全部展开:有选中节点→展开其全部子孙;无选中→展开整棵树
    toolBtn('⊕', '全部展开(选中节点时仅展开其子树)', () => {
      const sel = ctx.selection;
      const p2 = p;
      if (sel && (sel.type === 'bone' || sel.type === 'slot' || sel.type === 'att')) {
        const slotName = sel.type === 'slot' ? sel.name : sel.type === 'att' ? sel.slot : null;
        let rootName = sel.type === 'bone' ? sel.name : (p2.armature.slots.find((s) => s.name === slotName)?.parent ?? null);
        if (rootName) {
          // 展开祖先链 + 该节点全部子孙(含插槽附件)
          const expandBone = (bn) => {
            this.treeCollapsed.delete(bn);
            for (const c of p2.armature.bones.filter((b) => b.parent === bn)) expandBone(c.name);
          };
          let anc = rootName;
          while (anc) { this.treeCollapsed.delete(anc); anc = p2.armature.bones.find((b) => b.name === anc)?.parent ?? null; }
          expandBone(rootName);
        }
        if (slotName) { this._treeAttCol.delete(slotName); this._treePhCol?.delete(slotName); }
      } else {
        this.treeCollapsed.clear();
        this._treeAttCol.clear();
        this._treePhCol.clear();
      }
      this.refreshOutline();
    });
    // 全部折叠:保留骨架名/root/各分组头(皮肤/约束/绘制顺序/事件/动画),仅收起深层内容
    // —— 不折叠 #bones(它会隐藏整棵骨架子树),骨骼按深度折叠、分组各自收起子节点
    toolBtn('⊖', '全部折叠(保留骨架与分组节点)', () => {
      for (const b of bonesInTreeOrder(p)) if ((b._depth || 0) > 0) this.treeCollapsed.add(b.name);
      this.treeCollapsed.add('#skins');
      this.treeCollapsed.add('#constraints');
      this.treeCollapsed.add('#zorder');
      this.treeCollapsed.add('#events');
      this.treeCollapsed.add('#anims');
      for (const s of p.armature.slots) if (s.displays.length > 0) { this._treeAttCol.add(s.name); this._treePhCol.add(s.name); }
      this.refreshOutline();
    });
    // 全部显示:恢复所有骨骼与插槽可见性
    toolBtn('👁', '全部显示', () => {
      ctx.beginEdit('全部显示');
      for (const bb of p.armature.bones) bb.visible = true;
      for (const ss of p.armature.slots) ss.visible = true;
      ctx.refresh();
    });
    fixed.appendChild(toolbar);

    const match = (name) => !filter || name.toLowerCase().includes(filter);
    const bones = bonesInTreeOrder(p);

    // 过滤时:命中骨骼 + 其全部祖先 + 命中插槽的宿主骨骼
    const showBone = new Set();
    if (filter) {
      const byName = new Map(bones.map((b) => [b.name, b]));
      const addChain = (b) => { let cur = b; while (cur && !showBone.has(cur.name)) { showBone.add(cur.name); cur = byName.get(cur.parent); } };
      for (const b of bones) if (match(b.name)) addChain(b);
      for (const s of p.armature.slots) if (match(s.name)) { const b = byName.get(s.parent); if (b) addChain(b); }
    }

    // ---- 列头行:[👁 可见性][🔗 锁定][Hierarchy] ----
    const headRow = document.createElement('div');
    headRow.className = 'be-tree-colshead';
    headRow.innerHTML = `<span class="be-tc-eye" title="点击:全部显示/全部隐藏">${EYE_VISIBLE}</span><span class="be-tc-lock" title="点击:全部解锁/全部锁定">🔗</span><span class="be-cols-title">Hierarchy</span>`;
    headRow.querySelector('.be-tc-eye').addEventListener('click', () => {
      ctx.beginEdit('切换全部可见性');
      const anyVisible = p.armature.bones.some((b) => b.visible !== false) || p.armature.slots.some((s) => s.visible !== false);
      for (const bb of p.armature.bones) bb.visible = !anyVisible;
      for (const ss of p.armature.slots) ss.visible = !anyVisible;
      ctx.refresh();
    });
    headRow.querySelector('.be-tc-lock').addEventListener('click', () => {
      ctx.beginEdit('切换全部锁定');
      const anyUnlocked = p.armature.bones.some((b) => b.locked !== true);
      for (const bb of p.armature.bones) bb.locked = anyUnlocked;
      for (const ss of p.armature.slots) ss.locked = anyUnlocked;
      this.refreshOutline();
    });
    fixed.appendChild(headRow);

    /**
     * Spine 风格三列网格行:[👁 眼睛列][🔗 锁定列][缩进树内容]
     * eye/lock 为空串时占位保持纵向对齐
     * guides:祖先延续线位图(下标 k-1 对应层级 k 的 x 位),字符 '1' 表示该层竖线贯穿本行
     * ——展开的中间节点下方,其非末位祖先层级的竖线必须由后代行补画,同级连线才不中断
     */
    const gridRow = ({ cls, sel, locked, depth, isLast, guides, eye, lock, eyeTitle, lockTitle, onEye, onLock, content, onClick }) => {
      const row = document.createElement('div');
      row.className = 'be-tree-row ' + cls
        + (sel ? ' sel' : '') + (locked ? ' locked' : '');
      row.setAttribute('data-depth', depth);
      if (isLast) row.setAttribute('data-last', '1');
      row.style.setProperty('--d', depth);
      row.innerHTML = `<span class="be-cell-eye${eye ? '' : ' empty'}" ${eyeTitle ? `title="${eyeTitle}"` : ''}>${eye || ''}</span>`
        + `<span class="be-cell-lock${lock ? '' : ' empty'}" ${lockTitle ? `title="${lockTitle}"` : ''}>${lock || ''}</span>`
        + `<div class="be-tree-main">${content}</div>`;
      if (onEye) row.querySelector('.be-cell-eye').addEventListener('click', (e) => { e.stopPropagation(); onEye(); });
      if (onLock) row.querySelector('.be-cell-lock').addEventListener('click', (e) => { e.stopPropagation(); onLock(); });
      row.addEventListener('click', onClick);
      if (guides) {
        const main = row.querySelector('.be-tree-main');
        for (let k = 1; k <= guides.length; k++) {
          if (guides[k - 1] !== '1') continue;
          const g = document.createElement('i');
          g.className = 'be-tree-guide';
          g.style.left = (k * 14 - 3) + 'px'; // 与各层级自身 ::before 同一 x 位
          main.appendChild(g);
        }
      }
      list.appendChild(row);
      return row;
    };

    // (骨架根行已并入下方「骨骼」分组标题:分组直接显示骨架名,避免重复一行)
    const slotByBone = new Map();
    for (const s of p.armature.slots) {
      if (!slotByBone.has(s.parent)) slotByBone.set(s.parent, []);
      slotByBone.get(s.parent).push(s);
    }

    let skipDepth = -1;
    // 各骨骼是否为同级最后一个子节点(尾部节点画 L 型连线)
    const lastBoneNames = new Set();
    for (const b of bones) {
      const sibs = b.parent ? boneChildren(p, b.parent) : bones.filter((x) => !x.parent);
      if (sibs.length && sibs[sibs.length - 1].name === b.name) lastBoneNames.add(b.name);
    }
    // 祖先延续线位图:某行处于展开节点的子树内时,其每个「非末位」祖先层级的竖线
    // (即该祖先所在同级组的公共连线)需贯穿本行,否则同级连线会在子孙行处中断
    const boneByName = new Map(bones.map((b) => [b.name, b]));
    const boneGuides = (bone) => {
      let g = '';
      let anc = bone.parent ? boneByName.get(bone.parent) : null;
      while (anc) {
        g = (lastBoneNames.has(anc.name) ? '0' : '1') + g;
        anc = anc.parent ? boneByName.get(anc.parent) : null;
      }
      return g;
    };
    // 约束映射:骨骼名 → [{type: ik|transform|path, name}](运行时 JSON raw.ik/transform/path;
    // .spine 解码的约束区段尚未逆向,无数据时不显示徽标)
    const cstByBone = new Map();
    {
      const raw = p.spine && p.spine.raw;
      if (raw) {
        const addCst = (bn, type, name) => {
          if (!bn) return;
          if (!cstByBone.has(bn)) cstByBone.set(bn, []);
          cstByBone.get(bn).push({ type, name });
        };
        for (const c of raw.ik || []) for (const bn of c.bones || []) addCst(bn, 'ik', c.name);
        for (const c of raw.transform || []) for (const bn of c.bones || []) addCst(bn, 'transform', c.name);
        for (const c of raw.path || []) for (const bn of c.bones || []) addCst(bn, 'path', c.name);
      }
    }
    // 皮肤附件视图(Spine 官方树语义):多皮肤时,插槽下除当前显示列表外,
    // 还列出「其他皮肤」在该插槽的附件,default 皮肤条目用原名,其余用 皮肤名/附件名 前缀
    const skinsAll = spineSkinsOf(p);
    const activeSkinName = (p.spine && p.spine.skin) || 'default';
    const skinAttsBySlot = new Map(); // slotName → [{skin, attName, att}]
    for (const sk of skinsAll) {
      if (sk.name === activeSkinName) continue;
      for (const [slotName, atts] of Object.entries(sk.attachments || {})) {
        if (!skinAttsBySlot.has(slotName)) skinAttsBySlot.set(slotName, []);
        for (const [attName, att] of Object.entries(atts || {})) {
          skinAttsBySlot.get(slotName).push({ skin: sk.name, attName, att });
        }
      }
    }
    const mkBoneRow = (bone, depth) => {
      if (skipDepth >= 0) {
        if (depth > skipDepth) return;
        skipDepth = -1;
      }
      if (filter && !showBone.has(bone.name)) return;
      const kids = boneChildren(p, bone.name).length;
      const slotList = slotByBone.get(bone.name) || [];
      const hasChildren = kids > 0 || slotList.length > 0;
      const sel = ctx.selection?.type === 'bone' && ctx.selection.name === bone.name;
      const collapsed = !filter && this.treeCollapsed.has(bone.name);
      const isLocked = bone.locked === true;
      const isHidden = bone.visible === false;
      const caret = hasChildren ? `<span class="be-caret ${collapsed ? '' : 'open'}">${collapsed ? '▸' : '▾'}</span>` : '<span class="be-caret"></span>';
      // 骨骼图标(官方素材,按骨骼名色相着色区分):零长度骨骼恒用 null(点形态,约束以行末
      // 徽标表达);长度>0 时有约束 → boneConstrained,无约束 → bone。
      // 自定义图标(bone.icon,Spine 4.2 树节点图标)优先,替换默认位图图标
      const csts = cstByBone.get(bone.name) || [];
      const boneIcoUrl = (bone.length || 0) > 0 ? (csts.length ? icoBoneCst : icoBone) : icoBoneNull;
      // 骨骼图标:显式 bone.icon → 默认形状规则(骨骼名匹配图标名,如 muzzle→muzzleFlash)
      // → 官方位图;着色按 iconColorOf(显式 → 工程数据色 → 骨骼名色相)
      const effIcon = bone.icon || defaultIconOf(bone.name, bone, p.spine && p.spine.raw) || '';
      const boneIcoHtml = effIcon
        ? boneIconHtml(effIcon, (isImgIconKey(effIcon) ? 'be-ico-custom imask' : 'be-ico-custom') + (isHidden ? ' dim' : ''), bone)
        : `<span class="be-ico-bone2" style="${bone.color ? `background-color:${bone.color};` : `--h:${boneHue(bone.name)};`}--ico:url('${boneIcoUrl}')${isHidden ? ';opacity:.35' : ''}"></span>`;
      const cstBadges = csts.map((c) => `<img class="be-tree-cst" src="${c.type === 'ik' ? icoCstIK : c.type === 'transform' ? icoCstIKTarget : icoCstPath}" draggable="false" title="${c.type === 'ik' ? 'IK' : c.type === 'transform' ? '变换' : '路径'}约束:${esc(c.name)}">`).join('');
      const boneRow = gridRow({
        cls: 'be-tree-bone', sel, locked: isLocked, depth, isLast: lastBoneNames.has(bone.name),
        guides: boneGuides(bone),
        eye: isHidden ? EYE_HIDDEN : EYE_VISIBLE,
        eyeTitle: isHidden ? '显示骨骼' : '隐藏骨骼',
        onEye: () => { ctx.beginEdit(isHidden ? '显示骨骼' : '隐藏骨骼'); bone.visible = isHidden; ctx.refresh(); },
        lock: isLocked ? '🔒' : '<span class="be-dot-unlock"></span>',
        lockTitle: isLocked ? '解锁骨骼' : '锁定骨骼',
        onLock: () => { bone.locked = !isLocked; this.refreshOutline(); },
        content: `${caret}${boneIcoHtml}<span class="be-tree-name${isHidden ? ' dim' : ''}">${esc(bone.name)}</span>`
          + (cstBadges ? `<span class="be-tree-csts">${cstBadges}</span>` : ''),
        onClick: () => ctx.select('bone', bone.name),
      });
      // 悬停联动:舞台中该骨骼白色高亮
      boneRow.addEventListener('mouseenter', () => ctx.setTreeHoverBone?.(bone.name));
      boneRow.addEventListener('mouseleave', () => ctx.setTreeHoverBone?.(null));
      const firstCaret = list.lastElementChild.querySelector('.be-caret');
      if (firstCaret && hasChildren) firstCaret.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.treeCollapsed.has(bone.name)) this.treeCollapsed.delete(bone.name); else this.treeCollapsed.add(bone.name);
        this.refreshOutline();
      });
      if (collapsed) { skipDepth = depth; return; }
      // 插槽的祖先延续线 = 骨骼自身位图 + 骨骼所在层级(骨骼非末位则该层竖线贯穿其插槽行)
      const slotGuideBase = boneGuides(bone) + (lastBoneNames.has(bone.name) ? '0' : '1');
      // 插槽子项(先于子骨骼渲染:插槽为末位子节点当且仅当它是最后一个插槽且骨骼无子骨骼)
      for (let si = 0; si < slotList.length; si++) {
        const s = slotList[si];
        if (filter && !match(s.name) && !match(bone.name)) continue;
        const isSlotLast = si === slotList.length - 1 && kids === 0;
        const sLocked = s.locked === true;
        // 插槽可见性 = visible 标志(Spine 标准:无 setup 附件的插槽仍显示 eye;
        // 「未显示」状态由其附件行的圆点表达)
        const sHidden = s.visible === false;
        // 附件是插槽的子节点:默认折叠(不显示),点击展开显示全部 display;附件可单独显隐
        const attCount = s.displays.length;
        // 其他皮肤在该插槽的附件(default 条目若已作为回退并入当前显示列表则去重)
        const skinKids = (skinAttsBySlot.get(s.name) || [])
          .filter((e) => !(e.skin === 'default' && s.displays.some((d) => d.name === e.attName)));
        const childCount = attCount + skinKids.length;
        const attExpanded = !this._treeAttCol.has(s.name);
        const slotSel = ctx.selection?.type === 'slot' && ctx.selection.name === s.name;
        const srow = gridRow({
          cls: 'be-tree-slot',
          sel: slotSel,
          // 插槽的连线属于父骨骼列:只要插槽是父级最后一个子节点即为 └ 型,与附件是否展开无关
          locked: sLocked, depth: depth + 1, isLast: isSlotLast,
          guides: slotGuideBase,
          eye: sHidden ? EYE_HIDDEN : EYE_VISIBLE,
          eyeTitle: sHidden ? '显示插槽' : '隐藏插槽',
          onEye: () => { ctx.beginEdit(sHidden ? '显示插槽' : '隐藏插槽'); s.visible = sHidden; ctx.refresh(); },
          lock: sLocked ? '🔒' : '<span class="be-dot-unlock"></span>',
          lockTitle: sLocked ? '解锁插槽' : '锁定插槽',
          onLock: () => { s.locked = !sLocked; this.refreshOutline(); },
          content: `<span class="be-caret ${attExpanded ? 'open' : ''}" data-caret>${childCount > 0 ? (attExpanded ? '▾' : '▸') : ''}</span>`
            + `<img class="be-tree-ico-img be-ico-slot2" src="${icoSlotColored}" draggable="false"><span class="be-tree-name${sHidden ? ' dim' : ''}">${esc(s.name)}</span>`
            + (childCount > 1 ? `<span class="be-tree-att-toggle" title="${attExpanded ? '折叠附件' : '展开全部附件'}">${childCount}</span>` : ''),
          onClick: () => ctx.select('slot', s.name),
        });
        // 悬停联动:舞台预览当前图片 + 白线包裹
        srow.addEventListener('mouseenter', () => ctx.setTreeHover?.(s.name, null));
        srow.addEventListener('mouseleave', () => ctx.setTreeHover?.(null, null));
        srow.title = sHidden ? '插槽已隐藏' : '';
        const toggleAtt = () => {
          if (!childCount) return;
          if (attExpanded) this._treeAttCol.add(s.name); else this._treeAttCol.delete(s.name);
          this.refreshOutline();
        };
        srow.querySelector('[data-caret]').addEventListener('click', (e) => { e.stopPropagation(); toggleAtt(); });
        if (childCount > 1) {
          srow.querySelector('.be-tree-att-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggleAtt(); });
        }
        // 附件子节点(仅展开时渲染),每项带独立眼睛开关。
        // 多皮肤项目按官方树加「皮肤占位符」中间层:插槽 > 皮肤占位符(当前激活皮肤,
        // 官方 skinPlaceholder 图标) > 该皮肤的图片附件(附件名自带 皮肤名/ 前缀)
        if (attExpanded) {
          const usePh = skinsAll.length > 1;
          // 占位符折叠(独立状态):仅收起占位符的子附件,占位符行保留 —— 不影响插槽折叠
          const phExpanded = !usePh || !this._treePhCol.has(s.name);
          const attDepth = depth + (usePh ? 3 : 2);
          const attGuides = usePh
            ? slotGuideBase + (isSlotLast ? '0' : '1') + '0' // 占位符 = 插槽唯一子节点(末位 └),其层级线不贯穿附件行
            : slotGuideBase + (isSlotLast ? '0' : '1');
          if (usePh && childCount > 0) {
            gridRow({
              cls: 'be-tree-skinph',
              depth: depth + 2, isLast: true, // 插槽的唯一子节点:└ 型,子附件挂在其折叠符下
              guides: slotGuideBase + (isSlotLast ? '0' : '1'),
              content: `<span class="be-caret ${phExpanded ? 'open' : ''}" data-phcaret>${phExpanded ? '▾' : '▸'}</span><img class="be-tree-ico-img" src="${icoSkinPh}" draggable="false">`
                + `<span class="be-tree-name">${esc(s.name)}</span>`
                + `<span class="be-tree-badge">${esc(activeSkinName)}</span>`,
              onClick: () => {},
            });
            const phrow = list.lastElementChild;
            phrow.title = `皮肤占位符:${s.name}\n当前皮肤「${activeSkinName}」,子节点 = 该皮肤在此插槽的图片附件\n点击折叠符号仅收起子附件`;
            phrow.querySelector('[data-phcaret]').addEventListener('click', (e) => {
              e.stopPropagation();
              if (phExpanded) this._treePhCol.add(s.name); else this._treePhCol.delete(s.name);
              this.refreshOutline();
            });
          }
          if (phExpanded) {
          for (let di = 0; di < attCount; di++) {
            const d = s.displays[di];
            const isCurrent = di === s.displayIndex;
            // 有效隐藏:显式 visible=false,或非插槽当前显示(舞台不渲染,如 setup 无附件槽下的附件)
            const dHidden = d.visible === false || !isCurrent;
            // 多皮肤时对齐官方命名:非 default 激活皮肤的条目带 皮肤名/ 前缀
            // (default 回退并入的共享条目 shared 标记,保持原名)
            const dispLabel = (activeSkinName !== 'default' && skinsAll.length > 1 && !d.shared) ? `${activeSkinName}/${d.name}` : d.name;
            const attSel = ctx.selection?.type === 'att' && ctx.selection.slot === s.name && ctx.selection.index === di;
            gridRow({
              cls: 'be-tree-att-row' + (isCurrent ? ' current' : ''),
              sel: attSel, // 附件独立选择态:不连带插槽行高亮
              // 末位 └ 判定计入皮肤附件行:其后还有皮肤行时本行不收尾
              depth: attDepth, isLast: skinKids.length === 0 && di === attCount - 1,
              guides: attGuides,
              eye: dHidden ? EYE_HIDDEN : EYE_VISIBLE,
              eyeTitle: dHidden ? '显示附件' : '隐藏附件',
              onEye: () => {
                ctx.beginEdit(dHidden ? '显示附件' : '隐藏附件');
                if (dHidden) { d.visible = true; s.displayIndex = di; } // 显示 = 设为可见并切换为当前显示
                else d.visible = false;
                ctx.refresh();
              },
              content: attIconSvg(d && d.raw && d.raw.type) + `<span class="be-tree-name${isCurrent || dHidden ? (isCurrent ? '' : ' dim') : ''}">${esc(dispLabel)}</span>`,
              // 点击 = 单独选中该图片附件(同时切换为插槽当前显示,便于舞台可见/可操作)
              onClick: () => { ctx.beginEdit('切换附件'); s.displayIndex = di; ctx.select({ type: 'att', slot: s.name, index: di }); },
            });
            const arow = list.lastElementChild;
            // 悬停联动:舞台预览该附件图片(可为非当前项) + 白线包裹
            arow.addEventListener('mouseenter', () => ctx.setTreeHover?.(s.name, di));
            arow.addEventListener('mouseleave', () => ctx.setTreeHover?.(null, null));
            const tName = attTypeName(d && d.raw && d.raw.type);
            arow.title = `附件:${dispLabel}${tName ? '(' + tName + ')' : ''}${isCurrent ? ' (当前显示)' : ''}${dHidden ? ' (已隐藏)' : ''}\n点击单独选中该图片`;
          }
          // 其他皮肤的附件行(Spine 官方树:default 条目原名,其余 皮肤名/附件名;点击切换皮肤)
          for (let ki = 0; ki < skinKids.length; ki++) {
            const e = skinKids[ki];
            const label = e.skin === 'default' ? e.attName : `${e.skin}/${e.attName}`;
            gridRow({
              cls: 'be-tree-att-row skin-alt',
              depth: attDepth, isLast: ki === skinKids.length - 1,
              guides: attGuides,
              content: attIconSvg(e.att && e.att.type) + `<span class="be-tree-name">${esc(label)}</span>`,
              onClick: () => ctx.switchSpineSkin?.(e.skin),
            });
            const krow = list.lastElementChild;
            const kTypeName = attTypeName(e.att && e.att.type);
            krow.title = `皮肤「${e.skin}」的附件:${e.attName}${kTypeName ? '(' + kTypeName + ')' : ''}\n点击切换到该皮肤后可查看/编辑`;
          }
          }
        }
      }
    };
    // ---- 骨骼区(Spine 树):分组标题 = 骨架名(Spine 导入 = 工程文件基名,自建 = 项目名)
    // + Setup 图标 + 骨骼数;插槽挂在宿主骨骼下。折叠骨架 = 收起整个子树
    // (骨骼 + 皮肤/约束/绘制顺序/事件/动画,均为骨架的子节点 —— 与 Spine 官方树一致) ----
    const bonesCollapsed = !filter && this.treeCollapsed.has('#bones');
    const kidsOn = !bonesCollapsed || filter;
    if (bones.length) {
      const armName = p.armature.name && p.armature.name !== 'armature' ? p.armature.name : '';
      const rootName = armName || p.name || '骨骼';
      gridRow({
        cls: 'be-tree-sec-row', depth: 0,
        content: `<span class="be-caret ${bonesCollapsed ? '' : 'open'}">${bonesCollapsed ? '▸' : '▾'}</span>`
          + `<img class="be-tree-ico-img" src="${icoSkeleton}" draggable="false">`
          + `<span class="be-tree-sec-label">${esc(rootName)}</span><span class="be-tree-badge">${bones.length}</span>`,
        onClick: () => {
          const k = '#bones';
          if (this.treeCollapsed.has(k)) this.treeCollapsed.delete(k); else this.treeCollapsed.add(k);
          this.refreshOutline();
        },
      });
    }
    if (kidsOn) {
      for (let i = 0; i < bones.length; i++) mkBoneRow(bones[i], (bones[i]._depth || 0) + 1);
    }

    // ---- 「皮肤」分组(骨架子节点,与 root 骨骼同级):子节点只列皮肤名称(不展开具体
    // 内容);点击切换舞台显示的皮肤;当前皮肤橙色高亮。default 为共享附件的基础皮肤,不计入
    // 切换列表;没有多套(非 default)皮肤时不显示子节点 ----
    const skins = skinsAll.filter((s) => s.name !== 'default');
    if (kidsOn && skinsAll.length) {
      const showKids = skins.length >= 2; // 单套/零套可选皮肤:分组节点保留但不列子节点
      const collapsed = !filter && this.treeCollapsed.has('#skins');
      gridRow({
        cls: 'be-tree-sec-row', depth: 1, isLast: false,
        content: `<span class="be-caret ${!collapsed && showKids ? 'open' : ''}">${showKids ? (collapsed ? '▸' : '▾') : ''}</span>`
          + `<span class="be-tree-sec-label">👕 皮肤</span>`
          + `<span class="be-tree-badge">${showKids ? `${skins.length} 套 · 当前 ${esc(p.spine.skin || '')}` : esc(p.spine.skin || skinsAll[0].name)}</span>`,
        onClick: () => {
          if (!showKids) return;
          const k = '#skins';
          if (this.treeCollapsed.has(k)) this.treeCollapsed.delete(k); else this.treeCollapsed.add(k);
          this.refreshOutline();
        },
      });
      if (showKids && (!collapsed || filter)) {
        for (let i = 0; i < skins.length; i++) {
          const sk = skins[i];
          if (filter && !match(sk.name)) continue;
          const cur = p.spine.skin === sk.name;
          const srow = gridRow({
            cls: 'be-tree-skin' + (cur ? ' cur' : ''), depth: 2, isLast: i === skins.length - 1,
            content: `<span class="be-caret"></span>`
              + `<svg class="be-ico-skin" viewBox="0 0 16 16" width="13" height="13"><path d="M8 1.5 C6.2 1.5 5 2.3 4.3 3.2 L2 5.4 l1.8 1.8 .7-.6 V14 h7 V6.6 l.7.6 L14 5.4 l-2.3-2.2 C11 2.3 9.8 1.5 8 1.5 Z" fill="none" stroke="${cur ? '#ffb74d' : '#90a4ae'}" stroke-width="1.3"/></svg>`
              + `<span class="be-tree-name">${esc(sk.name)}</span>`
              + (cur ? '<span class="be-tree-badge">✓ 当前</span>' : ''),
            onClick: () => ctx.switchSpineSkin?.(sk.name),
          });
          srow.title = `皮肤:${sk.name}${cur ? '(当前)' : ''}\n点击在舞台切换为该皮肤`;
        }
      }
    }

    // ---- 其余 section(骨架子节点):约束 / 绘制顺序 / 事件 / 动画(Spine 同树分组) ----
    const mkSection = (id, icon, label, count) => {
      if (!kidsOn) return false; // 骨架折叠时整棵子树隐藏
      const collapsed = !filter && this.treeCollapsed.has('#' + id);
      gridRow({
        cls: 'be-tree-sec-row', depth: 1,
        content: `<span class="be-caret ${collapsed ? '' : 'open'}">${collapsed ? '▸' : '▾'}</span><span class="be-tree-sec-label">${icon} ${label}</span><span class="be-tree-badge">${count}</span>`,
        onClick: () => {
          const k = '#' + id;
          if (this.treeCollapsed.has(k)) this.treeCollapsed.delete(k); else this.treeCollapsed.add(k);
          this.refreshOutline();
        },
      });
      return !collapsed || !!filter;
    };

    // 约束(Spine 工程 raw:IK / 变换 / 路径约束列表,只读展示)
    const raw = p.spine && p.spine.raw;
    const cons = [];
    if (raw) {
      for (const c of raw.ik || []) cons.push({ name: c.name, type: 'IK' });
      for (const c of raw.transform || []) cons.push({ name: c.name, type: '变换' });
      for (const c of raw.path || []) cons.push({ name: c.name, type: '路径' });
    }
    if (cons.length && mkSection('constraints', '🔗', '约束', cons.length)) {
      for (const c of cons) {
        if (filter && !match(c.name)) continue;
        const row = gridRow({ cls: 'be-tree-zorder', depth: 2, content: `<span class="be-tree-ico">🔗</span><span class="be-tree-name">${esc(c.name)}</span><span class="be-tree-badge">${c.type}</span>`, onClick: () => {} });
        row.title = `${c.type}约束:${c.name}(运行时求解,编辑器只读展示)`;
      }
    }

    // 绘制顺序
    if (p.armature.slots.length && mkSection('zorder', '❖', '绘制顺序', p.armature.slots.length)) {
      for (const s of slotsInZOrder(p)) {
        if (filter && !match(s.name)) continue;
        gridRow({
          cls: 'be-tree-zorder',
          sel: ctx.selection?.type === 'slot' && ctx.selection.name === s.name,
          depth: 2,
          content: `<span class="be-ico-slot"></span><span class="be-tree-name">${esc(s.name)}</span><span class="be-tree-badge">${esc(s.parent)}</span>`,
          onClick: () => ctx.select('slot', s.name),
        });
      }
    }

    // 事件
    const evNames = (raw && raw.events) ? Object.keys(raw.events) : [];
    if (evNames.length && mkSection('events', '⚡', '事件', evNames.length)) {
      for (const n of evNames) {
        if (filter && !match(n)) continue;
        gridRow({ cls: 'be-tree-zorder', depth: 2, content: `<span class="be-tree-ico">⚡</span><span class="be-tree-name">${esc(n)}</span>`, onClick: () => {} });
      }
    }

    // 动画
    if (p.armature.animations.length && mkSection('anims', '🎬', '动画', p.armature.animations.length)) {
      for (const a of p.armature.animations) {
        if (filter && !match(a.name)) continue;
        const cur = ctx.anim && ctx.anim.name === a.name;
        gridRow({
          cls: 'be-tree-zorder', sel: cur, depth: 2,
          content: `<span class="be-tree-ico">▶</span><span class="be-tree-name">${esc(a.name)}</span><span class="be-tree-badge">${a.duration}帧</span>`,
          onClick: () => ctx.setAnimation(a.name),
        });
      }
    }
    // 还原滚动位置:树行重建后浏览器会把 scrollTop 归零,弹回顶部造成视觉抖动
    requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = prevScrollTop; });
  }

  // ============ 左侧:层级(Z 序) ============

  mountZOrder(el) {
    this.zEl = el;
    this.refreshZOrder();
  }

  refreshZOrder() {
    const el = this.zEl;
    if (!el) return;
    const ctx = this.ctx;
    el.innerHTML = '<div class="be-z-hint">列表自上而下 = 渲染自下而上(顶部最靠前显示)</div>';
    const slots = slotsInZOrder(ctx.project);
    for (const s of slots) {
      const row = document.createElement('div');
      row.className = 'be-tree-row' + (ctx.selection?.type === 'slot' && ctx.selection.name === s.name ? ' sel' : '');
      row.innerHTML = `
        <button class="be-z-btn" data-act="up" title="上移(渲染更靠前)">▲</button>
        <button class="be-z-btn" data-act="down" title="下移">▼</button>
        <span class="be-tree-name">${esc(s.name)}</span>
        <span class="be-tree-badge">${s.parent}</span>`;
      row.addEventListener('click', () => ctx.select('slot', s.name));
      row.querySelector('[data-act=up]').addEventListener('click', (e) => { e.stopPropagation(); ctx.moveSlotZ(s.name, -1); });
      row.querySelector('[data-act=down]').addEventListener('click', (e) => { e.stopPropagation(); ctx.moveSlotZ(s.name, 1); });
      el.appendChild(row);
    }
    if (!slots.length) el.innerHTML += '<div class="be-empty">暂无插槽</div>';
  }

  // ============ 右侧:属性检查器 ============

  mountProps(el) {
    this.propsEl = el;
    this.refreshProps();
  }

  refreshProps() {
    const el = this.propsEl;
    if (!el) return;
    const ctx = this.ctx;
    // 属性面板默认隐藏:仅在选中层级树节点(骨骼/插槽/附件)或关键帧时显示;
    // 无选中时整块收起(含上分界线),层级树占满右列 —— 项目/骨架参数改在「设置」窗口查看
    const show = !!(ctx.keySel || (ctx.selection && ctx.selection.type));
    const panel = el.closest('.be-right');
    if (panel) {
      const divider = panel.previousElementSibling;
      panel.hidden = !show;
      if (divider && divider.classList.contains('be-props-resize')) divider.hidden = !show;
    }
    el.innerHTML = '';
    // 关键帧缓动(优先展示,和时间轴联动)
    if (ctx.keySel) { this._renderKeyProps(el); return; }
    if (!ctx.selection || !ctx.selection.type) return;
    if (ctx.selection.type === 'bone') {
      const all = ctx.allSelectedBones;
      if (all && all.size > 1) this._renderMultiBoneProps(el, all);
      else this._renderBoneProps(el);
    }
    else if (ctx.selection.type === 'slot') this._renderSlotProps(el);
    else if (ctx.selection.type === 'att') this._renderAttachmentProps(el);
  }

  _section(el, title) {
    // 最小化的面板:整体跳过渲染(顶栏图标可恢复)
    if (this.ctx.propMinimized?.has(title)) {
      const stub = document.createElement('div'); // 不可见占位,保证调用方追加行不报错
      return stub;
    }
    const s = document.createElement('div');
    s.className = 'be-prop-sec';
    if (this.ctx.propCollapsed?.has(title)) s.classList.add('collapsed');
    const collapsed = () => this.ctx.propCollapsed?.has(title);
    s.innerHTML = `<div class="be-prop-title"><span class="be-prop-caret">${collapsed() ? '▸' : '▾'}</span>${esc(title)}</div>`;
    const body = document.createElement('div');
    body.className = 'be-prop-body';
    s.appendChild(body);
    el.appendChild(s);
    const titleEl = s.querySelector('.be-prop-title');
    // 点击标题:折叠/展开(本地 DOM 切换,不触发全量刷新)
    titleEl.addEventListener('click', (e) => {
      if (e.target.closest('input,button,select')) return;
      const set = this.ctx.propCollapsed;
      if (!set) return;
      if (set.has(title)) set.delete(title); else set.add(title);
      this._persistPropState();
      s.classList.toggle('collapsed');
      titleEl.querySelector('.be-prop-caret').textContent = s.classList.contains('collapsed') ? '▸' : '▾';
    });
    // 右键:最小化到顶栏
    titleEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: collapsed() ? '展开面板' : '折叠面板', onClick: () => { titleEl.click(); } },
        { label: '最小化到顶栏图标', onClick: () => {
          this.ctx.propMinimized?.add(title);
          this._persistPropState();
          this.ctx.refresh();
        } },
      ]);
    });
    return body;
  }

  /** 折叠/最小化状态持久化 */
  _persistPropState() {
    try {
      localStorage.setItem('bePropCollapsed', JSON.stringify([...(this.ctx.propCollapsed || [])]));
      localStorage.setItem('bePropMinimized', JSON.stringify([...(this.ctx.propMinimized || [])]));
    } catch (err) { /* ignore */ }
  }

  /** 数字/文本输入行。live:输入即生效;首次修改压撤销快照;标签可按住左右拖动调值 */
  _num(parent, label, get, set, opts = {}) {
    const row = document.createElement('label');
    row.className = 'be-prop-row';
    const ctl = this._numCtl(label, get, set, opts);
    row.appendChild(ctl.wrap);
    parent.appendChild(row);
    return ctl.input;
  }

  /** 双数值同行(紧凑排列):X/Y、缩放 X/Y 等成对通道共用一行 */
  _num2(parent, l1, g1, s1, l2, g2, s2, opts = {}) {
    const row = document.createElement('label');
    row.className = 'be-prop-row pair';
    row.appendChild(this._numCtl(l1, g1, s1, opts).wrap);
    row.appendChild(this._numCtl(l2, g2, s2, opts).wrap);
    parent.appendChild(row);
  }

  /** 单个 label+input 控件组(_num 单列行 / _num2 双列行共用) */
  _numCtl(label, get, set, { step = 1, min, max, ro, placeholder } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'be-prop-ctl';
    const lab = document.createElement('span');
    lab.className = 'be-prop-l';
    lab.textContent = label;
    if (!ro) {
      lab.title = '拖动调整';
      lab.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startV = parseFloat(input.value) || 0;
        const base = get();
        let pushed = false;
        const mv = (ev) => {
          const dv = (ev.clientX - startX) * step * (ev.shiftKey ? 0.2 : 1);
          let v = base + dv;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          v = Math.round(v * 100) / 100;
          if (!pushed) { this.ctx.beginEdit('拖动调整 ' + label); pushed = true; }
          input.value = v;
          set(v);
          this.ctx.refresh({ skipProps: true });
        };
        const up = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          this.ctx.refresh();
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
    }
    wrap.appendChild(lab);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (placeholder) input.placeholder = placeholder;
    input.value = get();
    if (ro) input.disabled = true;
    let pushed = false;
    input.addEventListener('focus', () => { pushed = false; });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!isFinite(v)) return;
      if (!pushed) { this.ctx.beginEdit('编辑属性'); pushed = true; }
      set(v);
      this.ctx.refresh({ skipProps: true });
    });
    input.addEventListener('change', () => this.ctx.refresh());
    wrap.appendChild(input);
    return { wrap, input };
  }

  _text(parent, label, get, set) {
    const row = document.createElement('label');
    row.className = 'be-prop-row';
    row.innerHTML = `<span class="be-prop-l">${esc(label)}</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = get();
    let pushed = false;
    input.addEventListener('focus', () => { pushed = false; });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!v || v === get()) return;
      if (!pushed) { this.ctx.beginEdit('重命名'); pushed = true; }
      set(v);
      this.ctx.refresh();
    });
    row.appendChild(input);
    parent.appendChild(row);
  }

  _check(parent, label, get, set) {
    const row = document.createElement('label');
    row.className = 'be-prop-row chk';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!get();
    input.addEventListener('change', () => { this.ctx.beginEdit(label); set(input.checked); this.ctx.refresh(); });
    row.appendChild(input);
    row.appendChild(Object.assign(document.createElement('span'), { textContent: label }));
    parent.appendChild(row);
  }

  /** 多个勾选项同行横排(紧凑,如「继承」区) */
  _checkRow(parent, items) {
    // items: [{label, get, set}]
    const row = document.createElement('div');
    row.className = 'be-prop-row chk-inline';
    for (const it of items) {
      const lb = document.createElement('label');
      lb.className = 'be-chk-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!it.get();
      input.addEventListener('change', () => { this.ctx.beginEdit(it.label); it.set(input.checked); this.ctx.refresh(); });
      lb.appendChild(input);
      lb.appendChild(Object.assign(document.createElement('span'), { textContent: it.label }));
      row.appendChild(lb);
    }
    parent.appendChild(row);
  }

  _select(parent, label, options, value, onChange) {
    const row = document.createElement('label');
    row.className = 'be-prop-row';
    row.innerHTML = `<span class="be-prop-l">${esc(label)}</span>`;
    const sel = document.createElement('select');
    for (const o of options) {
      const op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      sel.appendChild(op);
    }
    sel.value = value;
    sel.addEventListener('change', () => { this.ctx.beginEdit(label); onChange(sel.value); this.ctx.refresh(); });
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  _btn(parent, text, cls, fn) {
    const b = document.createElement('button');
    b.className = 'btn sm ' + (cls || '');
    b.textContent = text;
    b.addEventListener('click', fn);
    parent.appendChild(b);
    return b;
  }

  // 项目/骨架/Spine 工程参数已移至「文件 ▾ → 设置」窗口(boneEditorPage.openSettings),
  // 属性面板仅在选中节点时显示对应检查器,不再渲染工程级属性
  _renderArmatureProps(el) { void el; }

  _renderBoneProps(el) {
    const ctx = this.ctx;
    const bone = ctx.project.armature.bones.find((x) => x.name === ctx.selection.name);
    if (!bone) { ctx.select(null, null); return; }
    // ---- 头部:图标 + 着色 + 骨骼名(Spine 4.2 属性面板样式) ----
    // 图标:显式 bone.icon → 默认形状规则(名称匹配)→ 官方默认位图;着色:iconColorOf 规则
    const head = document.createElement('div');
    head.className = 'be-bone-head';
    const icoBtn = document.createElement('button');
    const effIcon = bone.icon || defaultIconOf(bone.name, bone, ctx.project.spine && ctx.project.spine.raw) || '';
    icoBtn.className = 'be-icon-btn' + (bone.icon ? ' has' : '');
    const defBoneIco = (bone.length || 0) > 0 ? icoBone : icoBoneNull; // 与层级树同款位图选择
    {
      icoBtn.innerHTML = effIcon
        ? boneIconHtml(effIcon, isImgIconKey(effIcon) ? 'be-icon-btn-bone' : 'be-icon-btn-emoji', bone)
        : `<span class="be-icon-btn-bone" style="background-image:url('${tintedIconDataUrl(defBoneIco, iconColorOf(bone)) || defBoneIco}')"></span>`;
    }
    icoBtn.title = '设置骨骼图标(层级树节点显示)';
    icoBtn.addEventListener('click', () => {
      openIconPicker(icoBtn, (icon) => {
        ctx.beginEdit('设置骨骼图标');
        bone.icon = icon;
        ctx.refresh(); // 全量刷新:属性面板图标按钮 + 层级树节点图标立即同步
      });
    });
    head.appendChild(icoBtn);
    // 图标着色:取色器 + 恢复规则色(空 iconColor = 显式色 → Spine 数据色 → 骨骼名色相)
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.className = 'be-icon-color';
    colorInp.value = cssColorToHex(iconColorOf(bone));
    colorInp.title = '图标着色(空 = 按规则:Spine 数据色 / 骨骼名色相)';
    colorInp.addEventListener('input', () => {
      ctx.beginEdit('设置图标着色');
      bone.iconColor = colorInp.value;
      ctx.refresh();
    });
    head.appendChild(colorInp);
    const colorReset = document.createElement('button');
    colorReset.className = 'be-icon-color-reset';
    colorReset.textContent = '✕';
    colorReset.title = '恢复规则着色(Spine 数据色 / 骨骼名色相)';
    colorReset.addEventListener('click', () => {
      ctx.beginEdit('重置图标着色');
      bone.iconColor = '';
      ctx.refresh();
    });
    head.appendChild(colorReset);
    const nameEl = document.createElement('span');
    nameEl.className = 'be-bone-head-name';
    nameEl.textContent = bone.name;
    nameEl.title = bone.name;
    head.appendChild(nameEl);
    el.appendChild(head);

    // ---- 变换参数(扁平紧凑表,标签左 / 值右) ----
    const b = document.createElement('div');
    b.className = 'be-prop-flat';
    el.appendChild(b);
    const parentOpts = [{ value: '', label: '(根)' }, ...ctx.project.armature.bones.filter((x) => x.name !== bone.name).map((x) => ({ value: x.name, label: x.name }))];
    this._select(b, '父骨骼', parentOpts, bone.parent, (v) => ctx.reparentBone(bone.name, v));
    this._num2(b, '长度', () => bone.length, (v) => { bone.length = Math.max(1, v); }, '旋转°', () => bone.rotation, (v) => ctx.editBone(bone.name, { rotation: v }), { step: 0.5 });
    this._num2(b, 'X', () => bone.x, (v) => ctx.editBone(bone.name, { x: v }), 'Y', () => bone.y, (v) => ctx.editBone(bone.name, { y: v }));
    this._num2(b, '缩放 X', () => bone.scaleX, (v) => ctx.editBone(bone.name, { scaleX: v }), '缩放 Y', () => bone.scaleY, (v) => ctx.editBone(bone.name, { scaleY: v }), { step: 0.05 });
    this._num2(b, '倾斜 X', () => bone.shearX || 0, (v) => ctx.editBone(bone.name, { shearX: v }), '倾斜 Y', () => bone.shearY || 0, (v) => ctx.editBone(bone.name, { shearY: v }), { step: 0.5 });
    // 继承行(合并进扁平表):勾选项横排
    const ihRow = document.createElement('div');
    ihRow.className = 'be-prop-row';
    const ihLbl = document.createElement('span');
    ihLbl.className = 'be-prop-l';
    ihLbl.textContent = '继承';
    ihRow.appendChild(ihLbl);
    const ihBox = document.createElement('div');
    ihBox.className = 'be-chk-inline-wrap';
    for (const [lbl, key] of [['平移', 'inheritTranslation'], ['旋转', 'inheritRotation'], ['缩放', 'inheritScale']]) {
      const lb = document.createElement('label');
      lb.className = 'be-chk-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = bone[key] !== false;
      input.addEventListener('change', () => { ctx.beginEdit('继承' + lbl); bone[key] = input.checked; ctx.refresh(); });
      lb.appendChild(input);
      lb.appendChild(Object.assign(document.createElement('span'), { textContent: lbl }));
      ihBox.appendChild(lb);
    }
    ihRow.appendChild(ihBox);
    b.appendChild(ihRow);
    // 操作行(合并进扁平表):新建菜单 + 删除
    const opRow = document.createElement('div');
    opRow.className = 'be-prop-row';
    const opLbl = document.createElement('span');
    opLbl.className = 'be-prop-l';
    opLbl.textContent = '操作';
    opRow.appendChild(opLbl);
    const opBar = document.createElement('div');
    opBar.className = 'be-prop-btns be-prop-opbar';
    const newBtn = document.createElement('button');
    newBtn.className = 'btn sm';
    newBtn.textContent = '新建… ▾';
    newBtn.title = '新建骨骼 / 插槽 / 附件 / 约束(Spine New 菜单)';
    newBtn.addEventListener('click', () => {
      const r = newBtn.getBoundingClientRect();
      // 未支持项置灰:编辑器模型暂不能创建这些对象(可从 Spine 导入并显示/保留)
      const soon = '当前版本暂不支持创建(可从 Spine 工程导入)';
      showContextMenu(r.left, r.bottom + 4, [
        { label: `🦴 骨骼(子级:${bone.name})`, onClick: () => ctx.addBoneChild(bone.name) },
        { label: `🖼 插槽(挂到:${bone.name})`, onClick: () => ctx.addSlotTo(bone.name) },
        { label: '⬡ 皮肤占位符', disabled: true, title: soon },
        { label: '▭ 边界框', disabled: true, title: soon },
        { label: '✂ 剪裁', disabled: true, title: soon },
        { label: '〜 路径', disabled: true, title: soon },
        { label: '● 端点', disabled: true, title: soon },
        { label: '🔗 IK 约束', disabled: true, title: soon },
        { label: '〜 路径约束', disabled: true, title: soon },
        { label: '⇄ 变换约束', disabled: true, title: soon },
      ]);
    });
    opBar.appendChild(newBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'btn sm danger';
    delBtn.textContent = '删除骨骼';
    delBtn.addEventListener('click', () => ctx.deleteBone(bone.name));
    opBar.appendChild(delBtn);
    opRow.appendChild(opBar);
    b.appendChild(opRow);
  }

  _renderMultiBoneProps(el, names) {
    const ctx = this.ctx;
    const bones = ctx.project.armature.bones.filter((b) => names.has(b.name));
    if (!bones.length) { ctx.select(null, null); return; }
    const b = this._section(el, `已选 ${bones.length} 根骨骼`);
    // 批量编辑:所有选中骨骼应用相同值
    this._num(b, '旋转°', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { rotation: v }); }, { step: 0.5, placeholder: '(批量)' });
    this._num2(b, '缩放 X', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { scaleX: v }); }, '缩放 Y', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { scaleY: v }); }, { step: 0.05, placeholder: '(批量)' });
    // 列出选中骨骼名
    const list = this._section(el, '选中列表');
    const ul = document.createElement('div');
    ul.style.cssText = 'font-size:11px;color:var(--text2);line-height:1.8;max-height:120px;overflow:auto;padding:2px 0';
    for (const bone of bones) {
      const row = document.createElement('div');
      row.textContent = `• ${bone.name}`;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => ctx.select('bone', bone.name));
      ul.appendChild(row);
    }
    list.appendChild(ul);
  }

  /** 裁剪附件属性面板(Spine Clipping attachment 属性):名称 / 结束插槽 / 顶点数 / 状态 */
  _renderClippingProps(el, disp, slot, idx) {
    const ctx = this.ctx;
    const p = ctx.project;
    // 头部:裁剪图标 + 名称 + 当前显示标记
    const head = document.createElement('div');
    head.className = 'be-disp-title be-attach-head';
    head.innerHTML = `<span class="be-clip-ico" title="裁剪附件">✂</span><span>${esc(disp.name)}</span><span class="be-disp-tag">${idx === slot.displayIndex ? '当前显示' : ''}</span>`;
    el.appendChild(head);
    const flat = document.createElement('div');
    flat.className = 'be-prop-flat';
    el.appendChild(flat);
    // 名称(Spine 导入只读)
    if (!p.spine) this._text(flat, '名称', () => disp.name, (v) => { disp.name = v; });
    else {
      const rn = document.createElement('div');
      rn.className = 'be-prop-row';
      rn.innerHTML = `<span class="be-prop-l">名称</span><span>${esc(disp.name)}</span>`;
      flat.appendChild(rn);
    }
    // 结束插槽:裁剪作用范围到此插槽为止(raw.end,导出时原样回写)
    const endOpts = p.armature.slots.map((s) => ({ value: s.name, label: s.name }));
    this._select(flat, '结束插槽', endOpts, (disp.raw && disp.raw.end) || '', (v) => {
      ctx.beginEdit('设置结束插槽');
      if (disp.raw) disp.raw.end = v;
      ctx.refresh();
    });
    // 顶点数(只读;多边形顶点在舞台以线框显示)
    const vc = disp.raw && disp.raw.vertexCount;
    if (vc) {
      const vr = document.createElement('div');
      vr.className = 'be-prop-row';
      vr.innerHTML = `<span class="be-prop-l">顶点数</span><span>${vc}</span>`;
      flat.appendChild(vr);
    }
    // 状态行:当前显示 / 可见
    const stRow = document.createElement('div');
    stRow.className = 'be-prop-row';
    const stLbl = document.createElement('span');
    stLbl.className = 'be-prop-l';
    stLbl.textContent = '状态';
    stRow.appendChild(stLbl);
    const stBox = document.createElement('div');
    stBox.className = 'be-chk-inline-wrap';
    for (const [lbl, get, set] of [
      ['当前显示', () => idx === slot.displayIndex, (v) => { if (v) { slot.displayIndex = idx; } }],
      ['可见', () => disp.visible !== false, (v) => { disp.visible = v; }],
    ]) {
      const lb = document.createElement('label');
      lb.className = 'be-chk-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!get();
      input.addEventListener('change', () => { ctx.beginEdit(lbl); set(input.checked); ctx.refresh(); });
      lb.appendChild(input);
      lb.appendChild(Object.assign(document.createElement('span'), { textContent: lbl }));
      stBox.appendChild(lb);
    }
    stRow.appendChild(stBox);
    flat.appendChild(stRow);
    // 所属插槽 + 操作
    const slotRow = document.createElement('div');
    slotRow.className = 'be-prop-row';
    slotRow.innerHTML = `<span class="be-prop-l">所属插槽</span><span>${esc(slot.name)}@${esc(slot.parent)}</span>`;
    flat.appendChild(slotRow);
    const btns = document.createElement('div');
    btns.className = 'be-prop-btns be-prop-opbar';
    this._btn(btns, '选中插槽', '', () => ctx.select('slot', slot.name));
    flat.appendChild(btns);
    const hint = document.createElement('div');
    hint.className = 'be-z-hint';
    hint.textContent = '裁剪附件:多边形区域内的插槽内容被裁剪,作用范围到「结束插槽」为止(含)。';
    flat.appendChild(hint);
  }

  /** 图片附件属性面板(Spine「图片属性」风格):层级树/显示列表点击具体附件节点时显示,
   *  展示附件自身的 名称/路径/变换/尺寸,而非所属插槽属性;裁剪附件走专属面板 */
  _renderAttachmentProps(el) {
    const ctx = this.ctx;
    const p = ctx.project;
    const slot = p.armature.slots.find((s) => s.name === ctx.selection.slot);
    if (!slot) { ctx.select(null, null); return; }
    const idx = ctx.selection.index;
    const disp = slot.displays[idx];
    if (!disp) { ctx.select('slot', slot.name); return; }
    if (disp.raw && disp.raw.type === 'clipping') { this._renderClippingProps(el, disp, slot, idx); return; }
    const im = p.images.find((x) => x.id === disp.imageId);
    // 头部:缩略图 + 名称(Spine 导入项目条目名用于附件查找,只读;自建项目可改名)
    const head = document.createElement('div');
    head.className = 'be-disp-title be-attach-head';
    head.innerHTML = `${im && im.dataUrl ? `<img class="be-disp-thumb" src="${im.dataUrl}" alt="">` : ''}<span>${esc(disp.name)}</span><span class="be-disp-tag">${idx === slot.displayIndex ? '当前显示' : ''}</span>`;
    el.appendChild(head);
    // ---- 扁平紧凑表(骨骼属性同款排版) ----
    const flat = document.createElement('div');
    flat.className = 'be-prop-flat';
    el.appendChild(flat);
    if (!p.spine) this._text(flat, '名称', () => disp.name, (v) => { disp.name = v; });
    else {
      const rn = document.createElement('div');
      rn.className = 'be-prop-row';
      rn.innerHTML = `<span class="be-prop-l">名称</span><span>${esc(disp.name)}</span>`;
      flat.appendChild(rn);
    }
    // Spine 附件 Path 字段:源图/区块相对路径(如 goblin/head,对应工程 images/goblin/head.png)
    if (p.spine && disp.raw && (disp.raw.path || disp.raw.name)) {
      const pv = String(disp.raw.path || disp.raw.name);
      const pr = document.createElement('div');
      pr.className = 'be-prop-row';
      pr.innerHTML = `<span class="be-prop-l">路径</span><span title="Spine 附件 Path(源图相对路径)">${esc(pv)}</span>`;
      flat.appendChild(pr);
    }
    const imgOpts = p.images.map((m) => ({ value: m.id, label: m.name }));
    this._select(flat, '源图', imgOpts, disp.imageId, (v) => { disp.imageId = v; });
    const t = disp.transform;
    this._num2(flat, 'X', () => t.x, (v) => { t.x = v; }, 'Y', () => t.y, (v) => { t.y = v; }, { step: 0.5 });
    this._num(flat, '旋转°', () => t.rotation, (v) => { t.rotation = v; }, { step: 0.5 });
    this._num2(flat, '缩放 X', () => t.scaleX, (v) => { t.scaleX = v; }, '缩放 Y', () => t.scaleY, (v) => { t.scaleY = v; }, { step: 0.05 });
    const slotRow = document.createElement('div');
    slotRow.className = 'be-prop-row';
    slotRow.innerHTML = `<span class="be-prop-l">所属插槽</span><span>${esc(slot.name)}@${esc(slot.parent)}</span>`;
    flat.appendChild(slotRow);
    // 状态行:当前显示 / 可见(勾选横排)
    const stRow = document.createElement('div');
    stRow.className = 'be-prop-row';
    const stLbl = document.createElement('span');
    stLbl.className = 'be-prop-l';
    stLbl.textContent = '状态';
    stRow.appendChild(stLbl);
    const stBox = document.createElement('div');
    stBox.className = 'be-chk-inline-wrap';
    for (const [lbl, get, set] of [
      ['当前显示', () => idx === slot.displayIndex, (v) => { if (v) { slot.displayIndex = idx; } }],
      ['可见', () => disp.visible !== false, (v) => { disp.visible = v; }],
    ]) {
      const lb = document.createElement('label');
      lb.className = 'be-chk-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!get();
      input.addEventListener('change', () => { ctx.beginEdit(lbl); set(input.checked); ctx.refresh(); });
      lb.appendChild(input);
      lb.appendChild(Object.assign(document.createElement('span'), { textContent: lbl }));
      stBox.appendChild(lb);
    }
    stRow.appendChild(stBox);
    flat.appendChild(stRow);
    if (p.spine) {
      const hint = document.createElement('div');
      hint.className = 'be-z-hint';
      hint.textContent = 'Spine 运行时渲染时附件位置由原始数据驱动,此处变换用于近似渲染与自建项目。';
      flat.appendChild(hint);
    }
    const btns = document.createElement('div');
    btns.className = 'be-prop-btns be-prop-opbar';
    this._btn(btns, '选中插槽', '', () => ctx.select('slot', slot.name));
    flat.appendChild(btns);
  }

  _renderSlotProps(el) {
    const ctx = this.ctx;
    const slot = ctx.project.armature.slots.find((s) => s.name === ctx.selection.name);
    if (!slot) { ctx.select(null, null); return; }
    const boneOpts = ctx.project.armature.bones.map((b) => ({ value: b.name, label: b.name }));
    // ---- 扁平紧凑表(骨骼属性同款排版) ----
    const flat = document.createElement('div');
    flat.className = 'be-prop-flat';
    el.appendChild(flat);
    this._text(flat, '名称', () => slot.name, (v) => ctx.renameSlot(slot.name, v));
    this._select(flat, '所属骨骼', boneOpts, slot.parent, (v) => { slot.parent = v; });
    // 显示索引 + 可见 同行
    const ixRow = document.createElement('div');
    ixRow.className = 'be-prop-row pair';
    ixRow.appendChild(this._numCtl('显示索引', () => slot.displayIndex, (v) => { slot.displayIndex = Math.max(0, Math.min(slot.displays.length - 1, Math.round(v))); }, { min: 0 }).wrap);
    const visWrap = document.createElement('label');
    visWrap.className = 'be-chk-item';
    const visInp = document.createElement('input');
    visInp.type = 'checkbox';
    visInp.checked = slot.visible !== false;
    visInp.addEventListener('change', () => { ctx.beginEdit('可见'); slot.visible = visInp.checked; ctx.refresh(); });
    visWrap.appendChild(visInp);
    visWrap.appendChild(Object.assign(document.createElement('span'), { textContent: '可见' }));
    ixRow.appendChild(visWrap);
    flat.appendChild(ixRow);
    // 颜色:R|G、B|透明度 + 原生取色器
    const c = slot.color;
    this._num2(flat, 'R', () => c.r, (v) => { c.r = v; }, 'G', () => c.g, (v) => { c.g = v; }, { min: 0, max: 255 });
    this._num2(flat, 'B', () => c.b, (v) => { c.b = v; }, '透明度', () => c.a, (v) => { c.a = Math.max(0, Math.min(1, v)); }, { step: 0.05, min: 0, max: 1 });
    const pkRow = document.createElement('div');
    pkRow.className = 'be-prop-row';
    const pkLbl = document.createElement('span');
    pkLbl.className = 'be-prop-l';
    pkLbl.textContent = '取色';
    pkRow.appendChild(pkLbl);
    const pick = document.createElement('input');
    pick.type = 'color';
    pick.className = 'be-prop-color';
    pick.value = '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    pick.addEventListener('input', () => {
      const hex = pick.value.slice(1);
      this.ctx.beginEdit('设置颜色');
      c.r = parseInt(hex.slice(0, 2), 16); c.g = parseInt(hex.slice(2, 4), 16); c.b = parseInt(hex.slice(4, 6), 16);
      this.ctx.refresh({ skipProps: false });
    });
    pkRow.appendChild(pick);
    flat.appendChild(pkRow);

    // 显示对象列表(卡片列表,保留分组)
    const b3 = this._section(el, `显示对象(${slot.displays.length})`);
    slot.displays.forEach((disp, idx) => {
      const box = document.createElement('div');
      box.className = 'be-disp' + (idx === slot.displayIndex ? ' cur' : '');
      const im = ctx.project.images.find((x) => x.id === disp.imageId);
      const title = document.createElement('div');
      title.className = 'be-disp-title';
      const thumb = im && im.dataUrl ? `<img class="be-disp-thumb" src="${im.dataUrl}" alt="">` : '';
      title.innerHTML = `${thumb}<span>${esc(disp.name)}</span><span class="be-disp-tag">${idx === slot.displayIndex ? '当前' : ''}</span>`;
      title.addEventListener('click', () => { ctx.beginEdit('切换显示'); slot.displayIndex = idx; ctx.refresh(); });
      box.appendChild(title);
      const imgOpts = ctx.project.images.map((im) => ({ value: im.id, label: im.name }));
      this._select(box, '图片', imgOpts, disp.imageId, (v) => { disp.imageId = v; });
      // Spine 附件 Path 字段(图片属性):goblin 等皮肤的源图相对路径(如 goblin/head,
      // 对应工程 images/goblin/head.png)
      if (ctx.project.spine && disp.raw && (disp.raw.path || disp.raw.name)) {
        const pv = String(disp.raw.path || disp.raw.name);
        const pr = document.createElement('div');
        pr.className = 'be-prop-row';
        pr.innerHTML = `<span class="be-prop-l">路径</span><span title="Spine 附件 Path(源图相对路径,工程 images 目录下)">${esc(pv)}</span>`;
        box.appendChild(pr);
      }
      const t = disp.transform;
      this._num2(box, 'X', () => t.x, (v) => { t.x = v; }, 'Y', () => t.y, (v) => { t.y = v; }, { step: 0.5 });
      this._num(box, '旋转°', () => t.rotation, (v) => { t.rotation = v; }, { step: 0.5 });
      this._num2(box, '缩放 X', () => t.scaleX, (v) => { t.scaleX = v; }, '缩放 Y', () => t.scaleY, (v) => { t.scaleY = v; }, { step: 0.05 });
      this._num2(box, '轴心 X', () => disp.pivot.x, (v) => { disp.pivot.x = Math.max(0, Math.min(1, v)); }, '轴心 Y', () => disp.pivot.y, (v) => { disp.pivot.y = Math.max(0, Math.min(1, v)); }, { step: 0.05, min: 0, max: 1 });
      const del = document.createElement('button');
      del.className = 'btn sm danger';
      del.textContent = '删除显示对象';
      del.addEventListener('click', () => { ctx.beginEdit('删除显示'); slot.displays.splice(idx, 1); slot.displayIndex = Math.min(slot.displayIndex, slot.displays.length - 1); ctx.refresh(); });
      box.appendChild(del);
      b3.appendChild(box);
    });
    const addBar = document.createElement('div');
    addBar.className = 'be-prop-btns';
    this._btn(addBar, '+ 从资源库添加', '', () => {
      const im = ctx.project.images[0];
      if (!im) { toast('请先在资源库导入图片', 'warn'); return; }
      ctx.beginEdit('添加显示对象');
      slot.displays.push({ name: uniqueName(slot.displays.map((d) => d.name), im.name.replace(/\.[^.]+$/, '')), imageId: im.id, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, pivot: { x: 0.5, y: 0.5 } });
      ctx.refresh();
    });
    this._btn(addBar, '删除插槽', 'danger', () => ctx.deleteSlot(slot.name));
    b3.appendChild(addBar);
  }

  _renderKeyProps(el) {
    const ctx = this.ctx;
    const ks = ctx.keySel;
    const key = ctx.findKey(ks);
    if (!key) { ctx.keySel = null; this.refreshProps(); return; }
    const b = this._section(el, `关键帧:${ks.target} / ${channelLabel(ks.channel)}`);
    this._num(b, '帧号', () => key.frame, (v) => ctx.moveKey(ks, Math.round(v)), { min: 0 });
    if (!key.ease) key.ease = defaultEase();
    const ease = key.ease;
    const easeOpts = EASE_PRESETS.map((e) => ({ value: e.type, label: e.label }));
    this._select(b, '缓动(到下一帧)', easeOpts, ease.type, (v) => {
      ctx.beginEdit('设置缓动');
      ease.type = v;
      if (v === 'bezier' && !ease.pts) ease.pts = [0.42, 0, 0.58, 1];
      ctx.refresh();
    });
    if (ease.type === 'bezier') {
      const labels = ['控制点1 X', '控制点1 Y', '控制点2 X', '控制点2 Y'];
      ease.pts.forEach((v, i) => {
        this._num(b, labels[i], () => v, (nv) => { ease.pts[i] = nv; }, { step: 0.05, min: -0.5, max: 1.5 });
      });
      const cv = document.createElement('canvas');
      cv.width = 220; cv.height = 150;
      cv.className = 'be-ease-curve';
      drawEaseCurve(cv, ease);
      b.appendChild(cv);
    }
  }
}

export function channelLabel(ch) {
  return { translate: '位移', rotate: '旋转', scale: '缩放', shear: '倾斜', color: '颜色', display: '显示' }[ch] || ch;
}

export function drawEaseCurve(cv, ease) {
  const ctx2 = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 12;
  ctx2.clearRect(0, 0, W, H);
  ctx2.fillStyle = '#1e2028';
  ctx2.fillRect(0, 0, W, H);
  ctx2.strokeStyle = '#3a3e4a';
  ctx2.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
  ctx2.beginPath();
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const v = applyEase(ease, t);
    const x = pad + t * (W - pad * 2);
    const y = H - pad - v * (H - pad * 2);
    if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
  }
  ctx2.strokeStyle = '#4f8cff';
  ctx2.lineWidth = 2;
  ctx2.stroke();
}

function imageSize(dataUrl) {
  return new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve({ w: el.naturalWidth, h: el.naturalHeight });
    el.onerror = () => resolve({ w: 0, h: 0 });
    el.src = dataUrl;
  });
}
