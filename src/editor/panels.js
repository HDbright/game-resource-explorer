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

  /** 层级树定位:展开目标节点的祖先链并滚动到该节点(舞台双击图片/骨骼联动) */
  revealInTree(type, name) {
    const p = this.ctx.project;
    let boneName = null;
    if (type === 'bone') boneName = name;
    else {
      const slot = p.armature.slots.find((s) => s.name === name);
      boneName = slot ? slot.parent : null;
      if (slot) this._treeAttCol.delete(name); // 插槽的附件子项一并展开
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
    const toolBtn = (icon, tip, fn) => {
      const b = document.createElement('button');
      b.className = 'be-tree-flag';
      b.textContent = icon;
      b.title = tip;
      b.addEventListener('click', fn);
      toolbar.appendChild(b);
    };
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
        if (slotName) this._treeAttCol.delete(slotName);
      } else {
        this.treeCollapsed.clear();
        this._treeAttCol.clear();
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
      for (const s of p.armature.slots) if (s.displays.length > 0) this._treeAttCol.add(s.name);
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

    // ---- 列头行:[👁 可见性][🔗 锁定][Hierarchy] ----
    const headRow = document.createElement('div');
    headRow.className = 'be-tree-colshead';
    headRow.innerHTML = `<span class="be-tc-eye" title="点击:全部显示/全部隐藏">👁</span><span class="be-tc-lock" title="点击:全部解锁/全部锁定">🔗</span><span class="be-cols-title">Hierarchy</span>`;
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
     */
    const gridRow = ({ cls, sel, locked, depth, isLast, eye, lock, eyeTitle, lockTitle, onEye, onLock, content, onClick }) => {
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
      const boneRow = gridRow({
        cls: 'be-tree-bone', sel, locked: isLocked, depth, isLast: lastBoneNames.has(bone.name),
        eye: isHidden ? '🚫' : '👁',
        eyeTitle: isHidden ? '显示骨骼' : '隐藏骨骼',
        onEye: () => { ctx.beginEdit(isHidden ? '显示骨骼' : '隐藏骨骼'); bone.visible = isHidden; ctx.refresh(); },
        lock: isLocked ? '🔒' : '<span class="be-dot-unlock"></span>',
        lockTitle: isLocked ? '解锁骨骼' : '锁定骨骼',
        onLock: () => { bone.locked = !isLocked; this.refreshOutline(); },
        content: `${caret}<span class="be-ico-bone" style="--h:${boneHue(bone.name)}${isHidden ? ';opacity:.35' : ''}"></span><span class="be-tree-name${isHidden ? ' dim' : ''}">${esc(bone.name)}</span>`,
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
      // 插槽子项
      for (let si = 0; si < slotList.length; si++) {
        const s = slotList[si];
        if (filter && !match(s.name) && !match(bone.name)) continue;
        const isSlotLast = si === slotList.length - 1;
        const sLocked = s.locked === true;
        const sHidden = s.visible === false;
        // 附件是插槽的子节点:默认折叠(不显示),点击展开显示全部 display;附件可单独显隐
        const attCount = s.displays.length;
        const attExpanded = !this._treeAttCol.has(s.name);
        const slotSel = ctx.selection?.type === 'slot' && ctx.selection.name === s.name;
        const srow = gridRow({
          cls: 'be-tree-slot',
          sel: slotSel,
          // 插槽的连线属于父骨骼列:只要插槽是父级最后一个子节点即为 └ 型,与附件是否展开无关
          locked: sLocked, depth: depth + 1, isLast: isSlotLast,
          eye: sHidden ? '🚫' : '👁',
          eyeTitle: sHidden ? '显示插槽' : '隐藏插槽',
          onEye: () => { ctx.beginEdit(sHidden ? '显示插槽' : '隐藏插槽'); s.visible = sHidden; ctx.refresh(); },
          lock: sLocked ? '🔒' : '<span class="be-dot-unlock"></span>',
          lockTitle: sLocked ? '解锁插槽' : '锁定插槽',
          onLock: () => { s.locked = !sLocked; this.refreshOutline(); },
          content: `<span class="be-caret ${attExpanded ? 'open' : ''}" data-caret>${attCount > 0 ? (attExpanded ? '▾' : '▸') : ''}</span>`
            + `<span class="be-ico-slot"></span><span class="be-tree-name">${esc(s.name)}</span>`
            + (attCount > 1 ? `<span class="be-tree-att-toggle" title="${attExpanded ? '折叠附件' : '展开全部附件'}">${attCount}</span>` : ''),
          onClick: () => ctx.select('slot', s.name),
        });
        // 悬停联动:舞台预览当前图片 + 白线包裹
        srow.addEventListener('mouseenter', () => ctx.setTreeHover?.(s.name, null));
        srow.addEventListener('mouseleave', () => ctx.setTreeHover?.(null, null));
        srow.title = sHidden ? '插槽已隐藏' : '';
        const toggleAtt = () => {
          if (!attCount) return;
          if (attExpanded) this._treeAttCol.add(s.name); else this._treeAttCol.delete(s.name);
          this.refreshOutline();
        };
        srow.querySelector('[data-caret]').addEventListener('click', (e) => { e.stopPropagation(); toggleAtt(); });
        if (attCount > 1) {
          srow.querySelector('.be-tree-att-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggleAtt(); });
        }
        // 附件子节点(仅展开时渲染),每项带独立眼睛开关
        if (attExpanded) {
          for (let di = 0; di < attCount; di++) {
            const d = s.displays[di];
            const isCurrent = di === s.displayIndex;
            const dHidden = d.visible === false;
            const attSel = ctx.selection?.type === 'att' && ctx.selection.slot === s.name && ctx.selection.index === di;
            gridRow({
              cls: 'be-tree-att-row' + (isCurrent ? ' current' : ''),
              sel: attSel, // 附件独立选择态:不连带插槽行高亮
              depth: depth + 2, isLast: di === attCount - 1,
              eye: dHidden ? '🚫' : '👁',
              eyeTitle: dHidden ? '显示附件' : '隐藏附件',
              onEye: () => { ctx.beginEdit(dHidden ? '显示附件' : '隐藏附件'); d.visible = dHidden; ctx.refresh(); },
              content: `<svg class="be-ico-att" viewBox="0 0 16 16" width="13" height="12"><rect x="1" y="2" width="14" height="12" rx="1.5" fill="#546e7a" stroke="#cfd8dc" stroke-width="1.2"/><rect x="2.6" y="3.6" width="10.8" height="8.8" fill="#4db6ac"/><circle cx="5.4" cy="6.2" r="1.3" fill="#fffde7"/><path d="M2.6 12.4l3.4-3.8 2.2 2.4 2.5-2.9 2.7 4.3z" fill="#81c784"/></svg><span class="be-tree-name${isCurrent || dHidden ? (isCurrent ? '' : ' dim') : ''}">${esc(d.name)}</span>`,
              // 点击 = 单独选中该图片附件(同时切换为插槽当前显示,便于舞台可见/可操作)
              onClick: () => { ctx.beginEdit('切换附件'); s.displayIndex = di; ctx.select({ type: 'att', slot: s.name, index: di }); },
            });
            const arow = list.lastElementChild;
            // 悬停联动:舞台预览该附件图片(可为非当前项) + 白线包裹
            arow.addEventListener('mouseenter', () => ctx.setTreeHover?.(s.name, di));
            arow.addEventListener('mouseleave', () => ctx.setTreeHover?.(null, null));
            arow.title = `附件:${d.name}${isCurrent ? ' (当前显示)' : ''}${dHidden ? ' (已隐藏)' : ''}\n点击单独选中该图片`;
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
    const skinsAll = spineSkinsOf(p);
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
    el.innerHTML = '';
    // 关键帧缓动(优先展示,和时间轴联动)
    if (ctx.keySel) { this._renderKeyProps(el); return; }
    if (!ctx.selection || !ctx.selection.type) { this._renderArmatureProps(el); return; }
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
        const skinsSwitch = spineSkinsOf(p).filter((s) => s.name !== 'default');
        if (skinsSwitch.length >= 2) {
          // 多套可选皮肤:下拉切换(与层级树「皮肤」分组子节点一致;default 为基础皮肤不计入)
          this._select(b3, '皮肤', skinsSwitch.map((s) => ({ value: s.name, label: s.name })), p.spine.skin || skinsSwitch[0].name, (v) => ctx.switchSpineSkin?.(v));
        } else {
          const row2 = document.createElement('div');
          row2.className = 'be-prop-row';
          row2.innerHTML = `<span class="be-prop-l">皮肤</span><span>${esc(p.spine.skin || '')}</span>`;
          b3.appendChild(row2);
        }
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

  _renderMultiBoneProps(el, names) {
    const ctx = this.ctx;
    const bones = ctx.project.armature.bones.filter((b) => names.has(b.name));
    if (!bones.length) { ctx.select(null, null); return; }
    const b = this._section(el, `已选 ${bones.length} 根骨骼`);
    // 批量编辑:所有选中骨骼应用相同值
    this._num(b, '旋转°', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { rotation: v }); }, { step: 0.5, placeholder: '(批量)' });
    this._num(b, '缩放 X', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { scaleX: v }); }, { step: 0.05, placeholder: '(批量)' });
    this._num(b, '缩放 Y', () => '', (v) => { for (const bone of bones) ctx.editBone(bone.name, { scaleY: v }); }, { step: 0.05, placeholder: '(批量)' });
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

  /** 图片附件属性面板(Spine「图片属性」风格):层级树/显示列表点击具体附件节点时显示,
   *  展示附件自身的 名称/路径/变换/尺寸,而非所属插槽属性 */
  _renderAttachmentProps(el) {
    const ctx = this.ctx;
    const p = ctx.project;
    const slot = p.armature.slots.find((s) => s.name === ctx.selection.slot);
    if (!slot) { ctx.select(null, null); return; }
    const idx = ctx.selection.index;
    const disp = slot.displays[idx];
    if (!disp) { ctx.select('slot', slot.name); return; }
    const im = p.images.find((x) => x.id === disp.imageId);
    const b = this._section(el, `图片:${disp.name}`);
    // 头部:缩略图 + 名称(Spine 导入项目条目名用于附件查找,只读;自建项目可改名)
    const head = document.createElement('div');
    head.className = 'be-disp-title';
    head.innerHTML = `${im && im.dataUrl ? `<img class="be-disp-thumb" src="${im.dataUrl}" alt="">` : ''}<span>${esc(disp.name)}</span><span class="be-disp-tag">${idx === slot.displayIndex ? '当前显示' : ''}</span>`;
    b.appendChild(head);
    if (!p.spine) this._text(b, '名称', () => disp.name, (v) => { disp.name = v; });
    else {
      const rn = document.createElement('div');
      rn.className = 'be-prop-row';
      rn.innerHTML = `<span class="be-prop-l">名称</span><span>${esc(disp.name)}</span>`;
      b.appendChild(rn);
    }
    // Spine 附件 Path 字段:源图/区块相对路径(如 goblin/head,对应工程 images/goblin/head.png)
    if (p.spine && disp.raw && (disp.raw.path || disp.raw.name)) {
      const pv = String(disp.raw.path || disp.raw.name);
      const pr = document.createElement('div');
      pr.className = 'be-prop-row';
      pr.innerHTML = `<span class="be-prop-l">路径</span><span title="Spine 附件 Path(源图相对路径)">${esc(pv)}</span>`;
      b.appendChild(pr);
    }
    const b2 = this._section(el, '变换');
    const t = disp.transform;
    this._num(b2, 'X', () => t.x, (v) => { t.x = v; }, { step: 0.5 });
    this._num(b2, 'Y', () => t.y, (v) => { t.y = v; }, { step: 0.5 });
    this._num(b2, '旋转°', () => t.rotation, (v) => { t.rotation = v; }, { step: 0.5 });
    this._num(b2, '缩放 X', () => t.scaleX, (v) => { t.scaleX = v; }, { step: 0.05 });
    this._num(b2, '缩放 Y', () => t.scaleY, (v) => { t.scaleY = v; }, { step: 0.05 });
    if (p.spine) {
      const hint = document.createElement('div');
      hint.className = 'be-z-hint';
      hint.textContent = 'Spine 运行时渲染时附件位置由原始数据驱动,此处变换用于近似渲染与自建项目。';
      b2.appendChild(hint);
    }
    const b3 = this._section(el, '图片');
    const imgOpts = p.images.map((m) => ({ value: m.id, label: m.name }));
    this._select(b3, '源图', imgOpts, disp.imageId, (v) => { disp.imageId = v; });
    const b4 = this._section(el, '归属');
    const slotRow = document.createElement('div');
    slotRow.className = 'be-prop-row';
    slotRow.innerHTML = `<span class="be-prop-l">所属插槽</span><span>${esc(slot.name)}@${esc(slot.parent)}</span>`;
    b4.appendChild(slotRow);
    this._check(b4, '当前显示', () => idx === slot.displayIndex, (v) => { if (v) { slot.displayIndex = idx; } });
    this._check(b4, '可见', () => disp.visible !== false, (v) => { disp.visible = v; });
    const btns = document.createElement('div');
    btns.className = 'be-prop-btns';
    this._btn(btns, '选中插槽', '', () => ctx.select('slot', slot.name));
    b4.appendChild(btns);
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
