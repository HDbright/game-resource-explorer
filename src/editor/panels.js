/**
 * 骨骼动画编辑器 - 左侧面板(资源库 / 大纲 / 层级)与右侧属性检查器。
 * 全部通过 ctx.refresh() 驱动重绘;输入框聚焦后首次修改才压撤销快照。
 */

import { toast, confirmDialog } from '../dialogs.js';
import {
  EASE_PRESETS, bonesInTreeOrder, slotsInZOrder, boneChildren, uniqueName, defaultEase,
} from './model.js';
import { applyEase } from './animator.js';
import { resolveRegionDataUrl } from './spineIO.js';

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export class EditorPanels {
  constructor(ctx) {
    this.ctx = ctx;
    this.treeCollapsed = new Set(); // 层级树折叠:骨骼名 或 '#分区id'
    this._treeFilter = '';          // 层级树搜索关键字
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

  refreshOutline() {
    const el = this.outEl;
    if (!el) return;
    const ctx = this.ctx;
    const p = ctx.project;
    const filter = (this._treeFilter || '').trim().toLowerCase();
    // 视图过滤标志(默认全部显示)
    if (!this._treeFlags) this._treeFlags = { bones: true, slots: true, atts: false };
    const flags = this._treeFlags;
    // 附件展开状态(哪些插槽展开显示附件子项)
    if (!this._treeAttExp) this._treeAttExp = new Set();
    el.innerHTML = '';

    // ---- 顶部:搜索框 + 视图过滤按钮组 ----
    const toolbar = document.createElement('div');
    toolbar.className = 'be-tree-toolbar';
    const search = document.createElement('input');
    search.className = 'be-tree-search';
    search.placeholder = '搜索骨骼 / 插槽…';
    search.value = this._treeFilter || '';
    search.addEventListener('input', () => {
      this._treeFilter = search.value;
      this.refreshOutline();
      const s2 = el.querySelector('.be-tree-search');
      if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
    });
    toolbar.appendChild(search);
    // 视图过滤按钮(Spine 风格:骨骼/插槽/附件 显隐切换)
    const mkFlag = (key, icon, tip) => {
      const b = document.createElement('button');
      b.className = 'be-tree-flag' + (flags[key] ? ' active' : '');
      b.textContent = icon;
      b.title = tip;
      b.addEventListener('click', () => { flags[key] = !flags[key]; this.refreshOutline(); });
      toolbar.appendChild(b);
    };
    mkFlag('bones', '🦴', '显示/隐藏骨骼');
    mkFlag('slots', '📦', '显示/隐藏插槽');
    mkFlag('atts', '🖼', '展开/折叠附件子项');
    // 全部展开/折叠按钮
    const mkExpandBtn = (expand) => {
      const b = document.createElement('button');
      b.className = 'be-tree-flag';
      b.textContent = expand ? '⊕' : '⊖';
      b.title = expand ? '全部展开' : '全部折叠';
      b.addEventListener('click', () => {
        if (expand) { this.treeCollapsed.clear(); this._treeAttExp = new Set(p.armature.slots.map(s => s.name)); flags.atts = true; }
        else { for (const bone of p.armature.bones) this.treeCollapsed.add(bone.name); this._treeAttExp.clear(); }
        this.refreshOutline();
      });
      toolbar.appendChild(b);
    };
    mkExpandBtn(true);
    mkExpandBtn(false);
    el.appendChild(toolbar);

    const match = (name) => !filter || name.toLowerCase().includes(filter);
    const boneHue = (name) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
    const bones = bonesInTreeOrder(p);

    // 过滤时:命中骨骼 + 其全部祖先 + 命中插槽的宿主骨骼
    const showBone = new Set();
    if (filter) {
      const byName = new Map(bones.map((b) => [b.name, b]));
      const addChain = (b) => { let cur = b; while (cur && !showBone.has(cur.name)) { showBone.add(cur.name); cur = byName.get(cur.parent); } };
      for (const b of bones) if (match(b.name)) addChain(b);
      for (const s of p.armature.slots) if (match(s.name)) { const b = byName.get(s.parent); if (b) addChain(b); }
    }

    // 骨架根行
    const armRow = document.createElement('div');
    armRow.className = 'be-tree-row arm' + (ctx.selection && !ctx.selection.type ? ' sel' : '');
    armRow.innerHTML = `<span class="be-tree-ico">🎭</span><span class="be-tree-name">${esc(p.armature.name)}</span>`;
    armRow.addEventListener('click', () => ctx.select(null, null));
    el.appendChild(armRow);

    // ---- 「骨骼」section header ----
    if (flags.bones) {
      const boneSecH = document.createElement('div');
      boneSecH.className = 'be-tree-sec';
      boneSecH.innerHTML = `<span class="be-tree-sec-label">骨骼</span><span class="be-tree-badge">${p.armature.bones.length}</span>`;
      el.appendChild(boneSecH);
    }

    const slotByBone = new Map();
    for (const s of p.armature.slots) {
      if (!slotByBone.has(s.parent)) slotByBone.set(s.parent, []);
      slotByBone.get(s.parent).push(s);
    }

    let skipDepth = -1;
    const mkBoneRow = (bone, depth, parentLast) => {
      if (skipDepth >= 0) {
        if (depth > skipDepth) return;
        skipDepth = -1;
      }
      if (filter && !showBone.has(bone.name)) return;
      const kids = boneChildren(p, bone.name).length;
      const slotList = slotByBone.get(bone.name) || [];
      const hasSlots = slotList.length > 0;
      const hasChildren = kids > 0 || hasSlots;
      const sel = ctx.selection?.type === 'bone' && ctx.selection.name === bone.name;
      const collapsed = !filter && this.treeCollapsed.has(bone.name);
      const isLocked = bone.locked === true;
      const isHidden = bone.visible === false;
      const row = document.createElement('div');
      row.className = 'be-tree-row be-tree-bone' + (sel ? ' sel' : '') + (isLocked ? ' locked' : '');
      row.setAttribute('data-depth', depth);
      row.setAttribute('data-last', parentLast ? '1' : '0');
      // 骨骼行:caret + 骨骼图标 + 名称 + 锁定 + 可见性
      row.innerHTML = `<span class="be-caret ${collapsed ? '' : 'open'}">${hasChildren ? (collapsed ? '▸' : '▾') : ''}</span>`
        + `<span class="be-ico-bone" style="--h:${boneHue(bone.name)}${isHidden ? ';opacity:.35' : ''}"></span>`
        + `<span class="be-tree-name${isHidden ? ' dim' : ''}">${esc(bone.name)}</span>`
        + `<span class="be-tree-lock" data-lock title="${isLocked ? '解锁骨骼' : '锁定骨骼'}">${isLocked ? '🔒' : '🔓'}</span>`;
      row.querySelector('.be-caret').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!hasChildren) return;
        if (this.treeCollapsed.has(bone.name)) this.treeCollapsed.delete(bone.name); else this.treeCollapsed.add(bone.name);
        this.refreshOutline();
      });
      row.querySelector('[data-lock]').addEventListener('click', (e) => {
        e.stopPropagation();
        bone.locked = !bone.locked;
        this.refreshOutline();
      });
      row.addEventListener('click', () => ctx.select('bone', bone.name));
      el.appendChild(row);
      if (collapsed) { skipDepth = depth; return; }
      // 插槽子项
      if (flags.slots) {
        for (const s of slotList) {
          if (filter && !match(s.name) && !match(bone.name)) continue;
          const disp = s.displays[s.displayIndex];
          const attName = disp ? disp.name : '';
          const sLocked = s.locked === true;
          const srow = document.createElement('div');
          srow.className = 'be-tree-row be-tree-slot' + (ctx.selection?.type === 'slot' && ctx.selection.name === s.name ? ' sel' : '') + (sLocked ? ' locked' : '');
          srow.setAttribute('data-depth', depth + 1);
          srow.title = s.visible === false ? '插槽已隐藏,点击眼睛恢复' : '点击眼睛隐藏插槽';
          const attExpanded = flags.atts || this._treeAttExp.has(s.name);
          const attCount = s.displays.length;
          srow.innerHTML = `<span class="be-tree-eye" data-eye>${s.visible === false ? '🚫' : '👁'}</span>`
            + `<span class="be-ico-slot"></span>`
            + `<span class="be-tree-name">${esc(s.name)}</span>`
            + (attName ? `<span class="be-tree-att">${esc(attName)}</span>` : '')
            + (attCount > 1 ? `<span class="be-tree-att-toggle" data-toggle title="${attExpanded ? '折叠附件' : '展开附件'}">${attExpanded ? '▾' : '▸'}${attCount}</span>` : '')
            + `<span class="be-tree-lock" data-slock title="${sLocked ? '解锁插槽' : '锁定插槽'}">${sLocked ? '🔒' : '🔓'}</span>`;
          srow.querySelector('[data-eye]').addEventListener('click', (e) => {
            e.stopPropagation();
            ctx.beginEdit(s.visible === false ? '显示插槽' : '隐藏插槽');
            s.visible = s.visible === false;
            ctx.refresh();
          });
          srow.querySelector('[data-slock]').addEventListener('click', (e) => {
            e.stopPropagation();
            s.locked = !s.locked;
            this.refreshOutline();
          });
          if (attCount > 1) {
            srow.querySelector('[data-toggle]').addEventListener('click', (e) => {
              e.stopPropagation();
              if (this._treeAttExp.has(s.name)) this._treeAttExp.delete(s.name); else this._treeAttExp.add(s.name);
              this.refreshOutline();
            });
          }
          srow.addEventListener('click', () => ctx.select('slot', s.name));
          el.appendChild(srow);
          // 附件子项(Spine 风格:展开时显示所有 display)
          if (attExpanded && attCount > 1) {
            for (let di = 0; di < s.displays.length; di++) {
              const d = s.displays[di];
              const isCurrent = di === s.displayIndex;
              const arow = document.createElement('div');
              arow.className = 'be-tree-row be-tree-att-row' + (isCurrent ? ' current' : '');
              arow.setAttribute('data-depth', depth + 2);
              arow.innerHTML = `<span class="be-ico-att">${isCurrent ? '◆' : '◇'}</span><span class="be-tree-name${isCurrent ? '' : ' dim'}">${esc(d.name)}</span>`;
              arow.title = `附件:${d.name}${isCurrent ? ' (当前显示)' : ''}\n点击切换为此附件`;
              arow.addEventListener('click', (e) => {
                e.stopPropagation();
                ctx.beginEdit('切换附件');
                s.displayIndex = di;
                ctx.refresh();
              });
              el.appendChild(arow);
            }
          }
        }
      }
    };
    if (flags.bones) {
      for (let i = 0; i < bones.length; i++) mkBoneRow(bones[i], bones[i]._depth || 0, i === bones.length - 1);
    }

    // ---- 「插槽」section header(扁平列表) ----
    if (flags.slots && p.armature.slots.length) {
      const slotSecH = document.createElement('div');
      slotSecH.className = 'be-tree-sec';
      const slotCollapsed = !filter && this.treeCollapsed.has('#slots');
      slotSecH.innerHTML = `<span class="be-caret ${slotCollapsed ? '' : 'open'}">${slotCollapsed ? '▸' : '▾'}</span><span class="be-tree-sec-label">插槽</span><span class="be-tree-badge">${p.armature.slots.length}</span>`;
      slotSecH.addEventListener('click', () => {
        if (this.treeCollapsed.has('#slots')) this.treeCollapsed.delete('#slots'); else this.treeCollapsed.add('#slots');
        this.refreshOutline();
      });
      el.appendChild(slotSecH);
      if (!slotCollapsed || filter) {
        for (const s of p.armature.slots) {
          if (filter && !match(s.name)) continue;
          const disp = s.displays[s.displayIndex];
          const attName = disp ? disp.name : '';
          const row = document.createElement('div');
          row.className = 'be-tree-row be-tree-slot-flat' + (ctx.selection?.type === 'slot' && ctx.selection.name === s.name ? ' sel' : '');
          row.innerHTML = `<span class="be-ico-slot"></span><span class="be-tree-name">${esc(s.name)}</span>${attName ? `<span class="be-tree-att">${esc(attName)}</span>` : ''}<span class="be-tree-badge">${esc(s.parent)}</span>`;
          row.addEventListener('click', () => ctx.select('slot', s.name));
          el.appendChild(row);
        }
      }
    }

    // ---- 其余 section:绘制顺序 / 事件 / 动画 ----
    const mkSection = (id, icon, label, count) => {
      const h = document.createElement('div');
      h.className = 'be-tree-sec';
      const collapsed = !filter && this.treeCollapsed.has('#' + id);
      h.innerHTML = `<span class="be-caret ${collapsed ? '' : 'open'}">${collapsed ? '▸' : '▾'}</span><span class="be-tree-sec-label">${icon} ${label}</span><span class="be-tree-badge">${count}</span>`;
      h.addEventListener('click', () => {
        const k = '#' + id;
        if (this.treeCollapsed.has(k)) this.treeCollapsed.delete(k); else this.treeCollapsed.add(k);
        this.refreshOutline();
      });
      el.appendChild(h);
      return !collapsed || !!filter;
    };

    // 绘制顺序
    if (p.armature.slots.length && mkSection('zorder', '❖', '绘制顺序', p.armature.slots.length)) {
      for (const s of slotsInZOrder(p)) {
        if (filter && !match(s.name)) continue;
        const row = document.createElement('div');
        row.className = 'be-tree-row be-tree-zorder' + (ctx.selection?.type === 'slot' && ctx.selection.name === s.name ? ' sel' : '');
        row.innerHTML = `<span class="be-ico-slot"></span><span class="be-tree-name">${esc(s.name)}</span><span class="be-tree-badge">${esc(s.parent)}</span>`;
        row.addEventListener('click', () => ctx.select('slot', s.name));
        el.appendChild(row);
      }
    }

    // 事件
    const evNames = (p.spine && p.spine.raw && p.spine.raw.events) ? Object.keys(p.spine.raw.events) : [];
    if (evNames.length && mkSection('events', '⚡', '事件', evNames.length)) {
      for (const n of evNames) {
        if (filter && !match(n)) continue;
        const row = document.createElement('div');
        row.className = 'be-tree-row be-tree-zorder';
        row.innerHTML = `<span class="be-tree-ico">⚡</span><span class="be-tree-name">${esc(n)}</span>`;
        el.appendChild(row);
      }
    }

    // 动画
    if (p.armature.animations.length && mkSection('anims', '🎬', '动画', p.armature.animations.length)) {
      for (const a of p.armature.animations) {
        if (filter && !match(a.name)) continue;
        const cur = ctx.anim && ctx.anim.name === a.name;
        const row = document.createElement('div');
        row.className = 'be-tree-row be-tree-zorder' + (cur ? ' sel' : '');
        row.innerHTML = `<span class="be-tree-ico">▶</span><span class="be-tree-name">${esc(a.name)}</span><span class="be-tree-badge">${a.duration}帧</span>`;
        row.addEventListener('click', () => ctx.setAnimation(a.name));
        el.appendChild(row);
      }
    }
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
    el.innerHTML = '';
    // 关键帧缓动(优先展示,和时间轴联动)
    if (ctx.keySel) { this._renderKeyProps(el); return; }
    if (!ctx.selection || !ctx.selection.type) { this._renderArmatureProps(el); return; }
    if (ctx.selection.type === 'bone') this._renderBoneProps(el);
    else if (ctx.selection.type === 'slot') this._renderSlotProps(el);
  }

  _section(el, title) {
    const s = document.createElement('div');
    s.className = 'be-prop-sec';
    s.innerHTML = `<div class="be-prop-title">${esc(title)}</div>`;
    const body = document.createElement('div');
    body.className = 'be-prop-body';
    s.appendChild(body);
    el.appendChild(s);
    return body;
  }

  /** 数字/文本输入行。live:输入即生效;首次修改压撤销快照;标签可按住左右拖动调值 */
  _num(parent, label, get, set, { step = 1, min, max, ro } = {}) {
    const row = document.createElement('label');
    row.className = 'be-prop-row';
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
    row.appendChild(lab);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
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
    row.appendChild(input);
    parent.appendChild(row);
    return input;
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

  _renderArmatureProps(el) {
    const ctx = this.ctx;
    const p = ctx.project;
    const b = this._section(el, '骨架属性');
    this._text(b, '骨架名', () => p.armature.name, (v) => { p.armature.name = v; });
    this._num(b, '帧率 fps', () => p.frameRate, (v) => { p.frameRate = Math.max(1, Math.round(v)); }, { min: 1, max: 120 });
    const b2 = this._section(el, '项目');
    this._text(b2, '项目名', () => p.name, (v) => { p.name = v; });
    this._num(b2, '骨骼数', () => p.armature.bones.length, () => {}, { ro: true });
    this._num(b2, '插槽数', () => p.armature.slots.length, () => {}, { ro: true });
    this._num(b2, '动画数', () => p.armature.animations.length, () => {}, { ro: true });
    if (p.spine) {
      const b3 = this._section(el, p.spine.project ? 'Spine 工程(.spine)' : 'Spine 项目');
      const row = document.createElement('div');
      row.className = 'be-prop-row';
      row.innerHTML = `<span class="be-prop-l">版本</span><span style="font-family:var(--mono)">${esc(p.spine.version || '')}</span>`;
      b3.appendChild(row);
      if (p.spine.project) {
        const rowS = document.createElement('div');
        rowS.className = 'be-prop-row';
        rowS.innerHTML = `<span class="be-prop-l">来源</span><span title="${esc(p.spine.srcPath || '')}">${esc((p.spine.srcPath || '').replace(/^.*[\\/]/, ''))}</span>`;
        b3.appendChild(rowS);
      } else {
        const row2 = document.createElement('div');
        row2.className = 'be-prop-row';
        row2.innerHTML = `<span class="be-prop-l">皮肤</span><span>${esc(p.spine.skin || '')}</span>`;
        b3.appendChild(row2);
        const row3 = document.createElement('div');
        row3.className = 'be-prop-row';
        row3.innerHTML = `<span class="be-prop-l">atlas 页</span><span>${(p.spine.pages || []).length} 页 / ${(p.spine.regionNames || []).length} 区块</span>`;
        b3.appendChild(row3);
      }
      const hint = document.createElement('div');
      hint.className = 'be-z-hint';
      hint.textContent = p.spine.project
        ? 'Spine 工程文件(.spine)逆向解码打开:骨骼/插槽/region 附件与 rotate/translate 时间线可编辑;附件切换与事件时间线引用未解析,已跳过;结构增删已锁定;「保存项目」存为 .lbone.json。'
        : 'Spine 导入项目:网格/IK/变换约束/变形时间线等 Pro 数据无损保留并在导出时回写;结构增删已锁定,可自由编辑变换与关键帧动画。';
      b3.appendChild(hint);
    }
  }

  _renderBoneProps(el) {
    const ctx = this.ctx;
    const bone = ctx.project.armature.bones.find((x) => x.name === ctx.selection.name);
    if (!bone) { ctx.select(null, null); return; }
    const b = this._section(el, `骨骼:${bone.name}`);
    const parentOpts = [{ value: '', label: '(根)' }, ...ctx.project.armature.bones.filter((x) => x.name !== bone.name).map((x) => ({ value: x.name, label: x.name }))];
    this._select(b, '父骨骼', parentOpts, bone.parent, (v) => ctx.reparentBone(bone.name, v));
    this._num(b, 'X', () => bone.x, (v) => ctx.editBone(bone.name, { x: v }));
    this._num(b, 'Y', () => bone.y, (v) => ctx.editBone(bone.name, { y: v }));
    this._num(b, '旋转°', () => bone.rotation, (v) => ctx.editBone(bone.name, { rotation: v }), { step: 0.5 });
    this._num(b, '长度', () => bone.length, (v) => { bone.length = Math.max(1, v); }, { min: 1 });
    this._num(b, '缩放 X', () => bone.scaleX, (v) => ctx.editBone(bone.name, { scaleX: v }), { step: 0.05 });
    this._num(b, '缩放 Y', () => bone.scaleY, (v) => ctx.editBone(bone.name, { scaleY: v }), { step: 0.05 });
    const b2 = this._section(el, '继承');
    this._check(b2, '继承平移', () => bone.inheritTranslation !== false, (v) => { bone.inheritTranslation = v; });
    this._check(b2, '继承旋转', () => bone.inheritRotation !== false, (v) => { bone.inheritRotation = v; });
    this._check(b2, '继承缩放', () => bone.inheritScale !== false, (v) => { bone.inheritScale = v; });
    const b3 = this._section(el, '操作');
    const bar = document.createElement('div');
    bar.className = 'be-prop-btns';
    this._btn(bar, '添加子骨骼', '', () => ctx.addBoneChild(bone.name));
    this._btn(bar, '添加插槽', '', () => ctx.addSlotTo(bone.name));
    this._btn(bar, '删除骨骼', 'danger', () => ctx.deleteBone(bone.name));
    b3.appendChild(bar);
  }

  _renderSlotProps(el) {
    const ctx = this.ctx;
    const slot = ctx.project.armature.slots.find((s) => s.name === ctx.selection.name);
    if (!slot) { ctx.select(null, null); return; }
    const boneOpts = ctx.project.armature.bones.map((b) => ({ value: b.name, label: b.name }));
    const b = this._section(el, `插槽:${slot.name}`);
    this._text(b, '名称', () => slot.name, (v) => ctx.renameSlot(slot.name, v));
    this._select(b, '所属骨骼', boneOpts, slot.parent, (v) => { slot.parent = v; });
    this._num(b, '显示索引', () => slot.displayIndex, (v) => { slot.displayIndex = Math.max(0, Math.min(slot.displays.length - 1, Math.round(v))); }, { min: 0 });
    this._check(b, '可见', () => slot.visible !== false, (v) => { slot.visible = v; });
    const c = slot.color;
    const b2 = this._section(el, '颜色');
    this._num(b2, 'R', () => c.r, (v) => { c.r = v; }, { min: 0, max: 255 });
    this._num(b2, 'G', () => c.g, (v) => { c.g = v; }, { min: 0, max: 255 });
    this._num(b2, 'B', () => c.b, (v) => { c.b = v; }, { min: 0, max: 255 });
    this._num(b2, '透明度', () => c.a, (v) => { c.a = Math.max(0, Math.min(1, v)); }, { step: 0.05, min: 0, max: 1 });
    // 原生取色器
    const pick = document.createElement('input');
    pick.type = 'color';
    pick.value = '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    pick.addEventListener('input', () => {
      const hex = pick.value.slice(1);
      this.ctx.beginEdit('设置颜色');
      c.r = parseInt(hex.slice(0, 2), 16); c.g = parseInt(hex.slice(2, 4), 16); c.b = parseInt(hex.slice(4, 6), 16);
      this.ctx.refresh({ skipProps: false });
    });
    b2.appendChild(pick);

    // 显示对象列表
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
      const t = disp.transform;
      this._num(box, 'X', () => t.x, (v) => { t.x = v; }, { step: 0.5 });
      this._num(box, 'Y', () => t.y, (v) => { t.y = v; }, { step: 0.5 });
      this._num(box, '旋转°', () => t.rotation, (v) => { t.rotation = v; }, { step: 0.5 });
      this._num(box, '缩放 X', () => t.scaleX, (v) => { t.scaleX = v; }, { step: 0.05 });
      this._num(box, '缩放 Y', () => t.scaleY, (v) => { t.scaleY = v; }, { step: 0.05 });
      this._num(box, '轴心 X', () => disp.pivot.x, (v) => { disp.pivot.x = Math.max(0, Math.min(1, v)); }, { step: 0.05, min: 0, max: 1 });
      this._num(box, '轴心 Y', () => disp.pivot.y, (v) => { disp.pivot.y = Math.max(0, Math.min(1, v)); }, { step: 0.05, min: 0, max: 1 });
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
  return { translate: '位移', rotate: '旋转', scale: '缩放', color: '颜色', display: '显示' }[ch] || ch;
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
