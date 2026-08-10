'use strict';
/**
 * FGUI 编辑器页: 独立的 FairyGUI 包可视化编辑器。
 * 布局参考 FairyGUI-Editor-Online 的 IDE 结构:
 *   顶栏(打开包/组件/撤销/编辑模式/保存源工程/导出/背景) + 左资源面板(组件树/层级树/资源清单+预览) + 中画布 + 右属性面板。
 * 复用 FguiLayoutPreview 画布引擎(PIXI)与 buildPreviewData 数据层。
 * 支持: 组件列表/层级树分割线拖动、层级树折叠展开、资源预览与主区 9 点高亮、源工程编辑保存。
 */
import { FguiLayoutPreview } from '../viewers/fguiLayoutPreview.js';
import { recordRecentOpen } from '../state.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const joinPath = (dir, name) => dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + name;
const binDirOf = (p) => (p || '').replace(/[\\/][^\\/]+$/, '');
const pkgNameOf = (p) => (p.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '') || '未命名';

export function renderFguiEditorPage(container, opts = {}) {
  // 状态保持:页面已初始化过则保留实例与编辑状态(切页/切标签回来不重建)
  if (container._fguiEditorInited) {
    if (opts.initialBinPath && container._fguiEditorLoad) {
      container._fguiEditorLoad(opts.initialBinPath);
    }
    return container;
  }
  container._fguiEditorInited = true;
  container.innerHTML = `
    <div class="fge-wrap">
      <div class="fge-toolbar">
        <button class="btn" id="fge-pick">📦 选择 FGUI 包(.bin)</button>
        <span class="fge-pkg" id="fge-pkg"></span>
        <select id="fge-comp" title="选择要编辑的组件"><option value="">(未加载包)</option></select>
        <span class="fge-spacer"></span>
        <button class="btn sm" id="fge-edit" disabled title="切换可视化编辑模式(拖拽移动/调整大小/编辑属性)">✎ 编辑模式</button>
        <button class="btn sm" id="fge-undo" disabled title="撤销上一步编辑(Ctrl+Z)">↩ 撤销</button>
        <button class="btn sm" id="fge-save-src" disabled title="把当前组件编辑结果写回源工程 FGUI_src/<包名>/<组件>.xml(源工程不存在时自动先导出)">💾 保存源工程</button>
        <button class="btn sm" id="fge-export" disabled title="导出完整 FairyGUI 源工程包到 bin 同目录 FGUI_src/<包名>">📤 导出源工程</button>
        <button class="btn sm" id="fge-opendir" disabled title="用资源管理器打开当前包所在目录">📂 打开目录</button>
        <label class="ctrl-label" style="margin-left:6px">背景</label>
        <input type="color" id="fge-bg" value="#1b1d23" title="画布背景色(立即生效)" />
        <span class="status" id="fge-status"></span>
      </div>
      <div class="fge-body">
        <div class="fge-left">
          <div class="fge-left-tabs">
            <button class="fge-tab active" data-tab="tree">🧩 组件树</button>
            <button class="fge-tab" data-tab="res">🗂 资源</button>
          </div>
          <div class="fge-left-pane" id="fge-tree">
            <div class="fge-pane-title">组件列表</div>
            <div class="fge-comp-list" id="fge-complist"></div>
            <div class="fge-hsplit" id="fge-hsplit" title="拖动调整组件列表 / 层级树高度比例"></div>
            <div class="fge-pane-title">层级树<span class="fge-hint" id="fge-treehint"></span></div>
            <div class="fge-hier" id="fge-hier"></div>
          </div>
          <div class="fge-left-pane" id="fge-res" style="display:none">
            <div class="fge-res-tabs">
              <button class="fge-rtab active" data-rtab="images">🖼 图片</button>
              <button class="fge-rtab" data-rtab="fonts">🔤 字体</button>
              <button class="fge-rtab" data-rtab="mcs">🎞 动画</button>
              <button class="fge-rtab" data-rtab="sounds">🔊 声音</button>
            </div>
            <div class="fge-res-list" id="fge-reslist"></div>
            <div class="fge-res-preview" id="fge-res-preview">
              <div class="fge-pane-title">资源预览</div>
              <div class="fge-res-pv-body" id="fge-res-pv-body"><div class="fge-hint2">点击左侧资源列表中的资源文件在此预览</div></div>
            </div>
          </div>
        </div>
        <div class="fge-canvas-wrap" id="fge-canvas-wrap">
          <canvas id="fge-canvas"></canvas>
          <div class="fg-text-layer" id="fge-text"></div>
        </div>
        <div class="fge-right">
          <div class="fge-pane-title">控制器</div>
          <div class="fge-ctrls" id="fge-ctrls"></div>
          <div class="fge-pane-title">属性</div>
          <div class="fge-props" id="fge-props"><div class="hint">点击画布或层级树中的对象查看属性</div></div>
        </div>
      </div>
    </div>
  `;

  const refs = {
    root: container.querySelector('#fge-canvas-wrap'),
    canvas: container.querySelector('#fge-canvas'),
    textLayer: container.querySelector('#fge-text'),
    propPanel: container.querySelector('#fge-props'),
    ctrlBar: container.querySelector('#fge-ctrls'),
  };
  const pkgEl = container.querySelector('#fge-pkg');
  const compSel = container.querySelector('#fge-comp');
  const statusEl = container.querySelector('#fge-status');
  const editBtn = container.querySelector('#fge-edit');
  const undoBtn = container.querySelector('#fge-undo');
  const saveSrcBtn = container.querySelector('#fge-save-src');
  const exportBtn = container.querySelector('#fge-export');
  const openDirBtn = container.querySelector('#fge-opendir');
  const bgInput = container.querySelector('#fge-bg');
  const compListEl = container.querySelector('#fge-complist');
  const hierEl = container.querySelector('#fge-hier');
  const resListEl = container.querySelector('#fge-reslist');
  const resPvBody = container.querySelector('#fge-res-pv-body');
  const propPanel = container.querySelector('#fge-props');

  let fguiPreview = null;
  let payload = null;
  let curBinPath = null;
  const hierCollapsed = new Set(); // 层级树折叠的节点(node 引用)
  const nodeOrig = new Map(); // node -> {id, name} 原始值(保存时对比生成编辑项)

  // ---------- 组件列表 / 层级树 分割线拖动 ----------
  const hsplit = container.querySelector('#fge-hsplit');
  let splitDrag = null;
  hsplit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitDrag = { y: e.clientY, h: compListEl.getBoundingClientRect().height, startY: e.clientY };
    hsplit.setPointerCapture(e.pointerId);
  });
  hsplit.addEventListener('pointermove', (e) => {
    if (!splitDrag) return;
    const dy = e.clientY - splitDrag.startY;
    const h = Math.max(60, Math.min(hierEl.parentElement.getBoundingClientRect().height - 80, splitDrag.h + dy));
    compListEl.style.height = h + 'px';
    compListEl.style.flex = '0 0 auto';
  });
  hsplit.addEventListener('pointerup', () => { splitDrag = null; });
  hsplit.addEventListener('pointercancel', () => { splitDrag = null; });

  // ---------- 层级树渲染(支持折叠展开) ----------
  function renderHierTree(root) {
    hierEl.innerHTML = '';
    if (!root) { hierEl.innerHTML = '<div class="fge-hint2">(无组件)</div>'; return; }
    const frag = document.createDocumentFragment();
    const pushNode = (node, depth) => {
      const kids = node.children || [];
      const collapsed = hierCollapsed.has(node);
      const el = document.createElement('div');
      el.className = 'fge-hier-item' + (collapsed ? ' collapsed' : '');
      el.style.paddingLeft = (depth * 14 + 6) + 'px';
      const icon = node.kind === 'image' ? '🖼' : node.kind === 'text' ? '🔤' : node.kind === 'container' ? '📦' : '▪';
      const arrow = kids.length ? `<span class="fge-hier-ar">${collapsed ? '▶' : '▼'}</span>` : '<span class="fge-hier-ar fge-hier-ar-empty"></span>';
      el.innerHTML = `${arrow}<span class="fge-hier-ic">${icon}</span><span class="fge-hier-nm">${esc(node.name || node.id || node.type || '?')}</span><span class="fge-hier-t">${esc(node.type || '')}</span>`;
      // 折叠箭头: 切换展开/收起
      if (kids.length) {
        el.querySelector('.fge-hier-ar').addEventListener('click', (e) => {
          e.stopPropagation();
          if (collapsed) hierCollapsed.delete(node); else hierCollapsed.add(node);
          renderHierTree(root);
        });
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!fguiPreview) return;
        fguiPreview.selectNode(node, node._textDiv);
        try { fguiPreview.highlightNode(node); } catch (e2) { /* ignore */ }
        document.querySelectorAll('.fge-hier-item').forEach((x) => x.classList.remove('sel'));
        el.classList.add('sel');
      });
      frag.appendChild(el);
      if (!collapsed) for (const c of kids) pushNode(c, depth + 1);
    };
    pushNode(root, 0);
    hierEl.appendChild(frag);
    const hint = container.querySelector('#fge-treehint');
    if (hint) hint.textContent = hierCollapsed.size ? ` ${hierCollapsed.size} 处折叠` : '';
  }

  /** 渲染左侧组件列表 */
  function renderCompList() {
    if (!payload) { compListEl.innerHTML = '<div class="fge-hint2">(未加载包)</div>'; return; }
    compListEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const c of payload.components) {
      const el = document.createElement('div');
      el.className = 'fge-comp-item';
      el.dataset.cid = c.id;
      el.textContent = `${c.name || c.id} (${c.width || 0}×${c.height || 0})`;
      el.addEventListener('click', () => loadComp(c.id));
      frag.appendChild(el);
    }
    compListEl.appendChild(frag);
  }

  // ---------- 资源面板 ----------
  /** 渲染资源清单(左栏「资源」tab) */
  function renderResList(type) {
    if (!payload || !payload.resources) { resListEl.innerHTML = '<div class="fge-hint2">(未加载包)</div>'; return; }
    const list = payload.resources[type] || [];
    resListEl.innerHTML = `<div class="fge-pane-title" style="font-size:12px">共 ${list.length} 项</div>`;
    if (!list.length) { resListEl.innerHTML += '<div class="fge-hint2">(无)</div>'; return; }
    const frag = document.createDocumentFragment();
    for (const it of list) {
      const el = document.createElement('div');
      el.className = 'fge-res-item';
      const dim = it.w != null ? ` ${it.w}×${it.h}` : '';
      el.innerHTML = `<span class="fge-res-nm">${esc(it.name || it.id)}</span><span class="fge-res-p">${esc((it.path || '').replace(/^\/+/, ''))}</span><span class="fge-res-d">${dim}</span>`;
      el.title = `id: ${it.id}\n路径: ${it.path || '/'}\n尺寸: ${dim || '-'}`;
      el.addEventListener('click', () => selectResource(type, it, el));
      frag.appendChild(el);
    }
    resListEl.appendChild(frag);
  }

  /** 点选资源: 预览区预览 + 主区 9 点高亮 + 右侧属性关联 */
  function selectResource(type, it, el) {
    document.querySelectorAll('.fge-res-item').forEach((x) => x.classList.remove('sel'));
    if (el) el.classList.add('sel');
    // 主区: 找到使用该资源的节点并 9 点高亮
    const usedNodes = type === 'images' && it.sprite ? (fguiPreview ? fguiPreview.nodeMap.filter((e) =>
      e.node && e.node.sprite && e.node.sprite.atlasItemId === it.sprite.atlasItemId
      && e.node.sprite.x === it.sprite.x && e.node.sprite.y === it.sprite.y
    ).map((e) => e.node) : []) : [];
    if (fguiPreview) {
      try { fguiPreview.clearNodeHighlight(); } catch (e) { /* ignore */ }
      if (usedNodes.length) {
        try { fguiPreview.highlightResource(usedNodes[0]); } catch (e) { /* ignore */ }
      }
    }
    // 右侧属性面板: 资源属性
    renderResProps(type, it, usedNodes.length);
    // 预览区
    renderResPreview(type, it);
  }

  /** 右侧属性面板显示资源属性 */
  function renderResProps(type, it, usedCount) {
    const typeName = { images: '图片', fonts: '位图字体', mcs: '动画', sounds: '声音' }[type] || type;
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '') rows.push(`<div class="fg-prop"><span class="fg-prop-k">${esc(k)}</span><span class="fg-prop-v">${esc(v)}</span></div>`); };
    add('类型', typeName);
    add('id', it.id);
    add('名称', it.name);
    add('路径', it.path || '/');
    if (it.w != null) add('尺寸', `${it.w}×${it.h}`);
    if (type === 'images') {
      add('图集', it.atlasKey || '-');
      if (it.sprite) add('图集位置', `${it.sprite.x},${it.sprite.y} ${it.sprite.w}×${it.sprite.h}${it.sprite.rotated ? ' (旋转)' : ''}`);
      add('使用节点', usedCount);
    }
    if (type === 'fonts' && it.fontCount != null) add('字形数', it.fontCount);
    if (type === 'sounds' && it.file) add('文件', it.file);
    propPanel.innerHTML = rows.length ? rows.join('') : '<div class="hint">(无属性)</div>';
  }

  /** 预览区渲染(图片裁图 / 字体信息 / 动画信息 / 声音播放) */
  function renderResPreview(type, it) {
    resPvBody.innerHTML = '';
    if (!it) { resPvBody.innerHTML = '<div class="fge-hint2">(无)</div>'; return; }
    const info = document.createElement('div');
    info.className = 'fge-hint2';
    if (type === 'images') {
      const tex = it.atlasKey && fguiPreview ? fguiPreview.textures[it.atlasKey] : null;
      const sp = it.sprite;
      if (tex && sp) {
        try {
          const srcImg = tex.source && tex.source.resource; // HTMLImageElement
          if (srcImg) {
            const w = sp.ow || sp.w, h = sp.oh || sp.h;
            const c = document.createElement('canvas');
            c.width = Math.max(1, w); c.height = Math.max(1, h);
            c.style.maxWidth = '100%'; c.style.imageRendering = 'pixelated';
            const ctx = c.getContext('2d');
            if (sp.rotated) {
              ctx.save();
              ctx.translate(w, 0);
              ctx.rotate(Math.PI / 2);
              ctx.drawImage(srcImg, sp.x, sp.y, sp.h, sp.w, 0, 0, sp.h, sp.w);
              ctx.restore();
            } else {
              ctx.drawImage(srcImg, sp.x, sp.y, sp.w, sp.h, 0, 0, w, h);
            }
            resPvBody.appendChild(c);
            info.textContent = `${it.name} · ${w}×${h}`;
            resPvBody.appendChild(info);
            return;
          }
        } catch (e) { console.warn('[fge] 图片预览失败', e); }
      }
      info.textContent = '(无图集纹理或无法裁剪预览)';
    } else if (type === 'fonts') {
      info.innerHTML = `🔤 位图字体 <b>${esc(it.name)}</b>${it.fontCount != null ? ` · ${it.fontCount} 字形` : ''}`;
    } else if (type === 'mcs') {
      info.innerHTML = `🎞 动画 <b>${esc(it.name)}</b>${it.w != null ? ` · ${it.w}×${it.h}` : ''}(帧动画,预览区暂以信息展示)`;
    } else if (type === 'sounds') {
      info.innerHTML = `🔊 声音 <b>${esc(it.name)}</b>${it.file ? ` · ${esc(it.file)}` : ''}`;
      if (it.file && payload && payload.srcDir) {
        const abs = joinPath(payload.srcDir, String(it.file).replace(/^\/+/, ''));
        const btn = document.createElement('button');
        btn.className = 'btn sm';
        btn.textContent = '▶ 播放';
        btn.style.marginTop = '6px';
        btn.addEventListener('click', async () => {
          try {
            const r = await window.api.readBase64(abs);
            if (r && r.ok) {
              const au = new Audio(r.dataUrl);
              au.play().catch(() => {});
            } else info.textContent = '(无法读取音频文件)';
          } catch (e) { info.textContent = '(无法读取音频文件)'; }
        });
        resPvBody.appendChild(info);
        resPvBody.appendChild(btn);
        return;
      }
    }
    resPvBody.appendChild(info);
  }

  // ---------- 加载 ----------
  const loadComp = async (compId) => {
    if (!payload || !fguiPreview) return;
    statusEl.textContent = '渲染中...';
    try {
      await fguiPreview.load(payload, compId);
      if (compSel.value !== compId) compSel.value = compId;
      const comp = payload.components.find((c) => c.id === compId);
      hierCollapsed.clear();
      // 重建节点原始 id/name 快照(保存时对比)
      nodeOrig.clear();
      if (comp && comp.root) {
        const walk = (n) => {
          if (!n) return;
          nodeOrig.set(n, { id: n.id != null ? String(n.id) : null, name: n.name != null ? String(n.name) : null });
          for (const c of n.children || []) walk(c);
        };
        walk(comp.root);
      }
      renderHierTree(comp ? comp.root : null);
      container.querySelectorAll('.fge-comp-item').forEach((x) => x.classList.toggle('sel', x.dataset.cid === compId));
      statusEl.textContent = payload.missingTextures.length ? `⚠ 缺少纹理: ${payload.missingTextures.join(', ')}` : '';
      updateToolbarState();
    } catch (e) {
      statusEl.textContent = '渲染失败: ' + (e.message || e);
      console.error('[fgui-editor]', e);
    }
  };

  const loadPkg = async (binPath) => {
    statusEl.textContent = '解析中...';
    try {
      const res = await window.api.fguiPreviewLoad({ inputPath: binPath });
      if (!res || !res.ok) throw new Error((res && res.error) || '解析失败');
      payload = res;
      curBinPath = binPath;
      pkgEl.textContent = `${res.pkg.name} (v${res.pkg.version})`;
      compSel.innerHTML = '';
      for (const c of res.components) {
        const op = document.createElement('option');
        op.value = c.id;
        op.textContent = c.name || c.id;
        compSel.appendChild(op);
      }
      compSel.disabled = res.components.length === 0;
      renderCompList();
      renderResList('images');
      statusEl.textContent = res.missingTextures.length ? `⚠ 缺少纹理: ${res.missingTextures.join(', ')}` : `已加载 ${res.components.length} 个组件`;
      updateToolbarState();
      if (res.components.length) await loadComp(res.components[0].id);
      try { recordRecentOpen({ name: res.pkg.name, path: binPath, type: 'fgui' }); } catch (e) { /* ignore */ }
    } catch (e) {
      statusEl.textContent = '解析失败: ' + (e.message || e);
      console.error('[fgui-editor]', e);
    }
  };

  function updateToolbarState() {
    const loaded = !!payload;
    editBtn.disabled = !loaded || !fguiPreview;
    undoBtn.disabled = !loaded || !fguiPreview || !fguiPreview.editMode;
    saveSrcBtn.disabled = !loaded || !fguiPreview || !fguiPreview.comp;
    exportBtn.disabled = !loaded || !curBinPath;
    openDirBtn.disabled = !curBinPath;
    editBtn.classList.toggle('active', loaded && fguiPreview && fguiPreview.editMode);
  }

  // ---------- 保存源工程(编辑结果写回 FGUI_src/<包名>/<组件>.xml) ----------
  const saveSourcePkg = async () => {
    if (!payload || !fguiPreview || !fguiPreview.comp) return;
    const comp = fguiPreview.comp;
    const nodes = [];
    const walk = (n) => {
      if (!n) return;
      nodes.push({ node: n });
      for (const c of n.children || []) walk(c);
    };
    walk(comp.root);
    // 收集编辑项: 几何属性全量 + 名称/id 增量(对比原始快照)
    const finalEdits = [];
    for (const { node: n } of nodes) {
      if (!n.id || String(n.id).includes('.')) continue; // 过滤合成节点(如 xxx.title)
      const e = {
        id: String(n.id),
        x: n.x != null ? n.x : null,
        y: n.y != null ? n.y : null,
        width: n.initWidth != null ? n.initWidth : null,
        height: n.initHeight != null ? n.initHeight : null,
        rotation: n.rotation != null ? n.rotation : null,
        alpha: n.alpha != null ? n.alpha : null,
        visible: n.visible != null ? n.visible : null,
        scaleX: n.scaleX != null ? n.scaleX : null,
        scaleY: n.scaleY != null ? n.scaleY : null,
      };
      // 名称/id 变化(编辑模式属性面板可改): 仅在有变化时提交
      const orig = nodeOrig.get(n);
      if (orig) {
        if (String(n.name != null ? n.name : '') !== String(orig.name != null ? orig.name : '')) e.name = String(n.name != null ? n.name : '');
        if (String(n.id) !== String(orig.id)) e.newId = String(n.id);
      }
      finalEdits.push({ node: n, e });
    }
    if (!finalEdits.length) { statusEl.textContent = '没有可保存的节点'; return; }
    statusEl.textContent = '正在保存到源工程...';
    try {
      const res = await window.api.fguiSaveSourceEdits({
        inputPath: curBinPath,
        compName: comp.name || comp.id,
        nodes: finalEdits.map((x) => x.e),
      });
      if (res && res.ok) {
        statusEl.textContent = `✅ 已保存 ${res.updated || 0} 个节点到源工程${res.warning ? ' (' + res.warning + ')' : ''}`;
        // 刷新原始快照(id/name 已写回,避免重复提交)
        for (const { node: n, e } of finalEdits) {
          nodeOrig.set(n, { id: e.newId || e.id, name: e.name != null ? e.name : (nodeOrig.get(n) || {}).name });
        }
      } else {
        statusEl.textContent = '✗ ' + ((res && res.error) || '保存失败');
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e.message || String(e));
    }
  };

  // ---------- 导出源工程(FGUI_src/<包名>) ----------
  const exportSourcePkg = async () => {
    if (!curBinPath) return;
    const pkgName = pkgNameOf(curBinPath);
    const outRoot = joinPath(binDirOf(curBinPath), 'FGUI_src');
    const pkgOutDir = joinPath(outRoot, pkgName);
    try {
      const st = await window.api.statFile(joinPath(pkgOutDir, 'package.xml'));
      if (st && st.size != null) {
        const go = window.confirm(`「FGUI_src/${pkgName}」目录已存在该包的源工程,是否覆盖?\n${pkgOutDir}`);
        if (!go) { statusEl.textContent = '已取消,未覆盖'; return; }
      }
    } catch (e) { /* ignore */ }
    statusEl.textContent = '正在还原 FairyGUI 源工程...';
    try {
      const res = await window.api.fguiExportSource({ inputPath: curBinPath, outputDir: outRoot });
      if (res && res.ok) {
        let msg = `✅ 已导出 FairyGUI 源工程: ${res.pkgDir}`;
        const parts = [];
        if (res.components) parts.push(`组件 ${res.components}`);
        if (res.images) parts.push(`碎图 ${res.images}`);
        if (res.fonts) parts.push(`字体 ${res.fonts}`);
        if (res.movieclips) parts.push(`动画 ${res.movieclips}`);
        if (res.sounds) parts.push(`声音 ${res.sounds}`);
        if (parts.length) msg += ` (${parts.join(', ')})`;
        statusEl.textContent = msg;
      } else {
        statusEl.textContent = '✗ ' + ((res && res.error) || '导出失败');
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e.message || String(e));
    }
  };

  // ---------- 事件 ----------
  container.querySelector('#fge-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({ filters: [{ name: 'FGUI 包', extensions: ['bin'] }] });
    if (r && r.filePaths && r.filePaths.length) loadPkg(r.filePaths[0]);
  });
  compSel.addEventListener('change', () => { if (compSel.value) loadComp(compSel.value); });
  editBtn.addEventListener('click', () => {
    if (!fguiPreview) return;
    fguiPreview.setEditMode(!fguiPreview.editMode);
    updateToolbarState();
  });
  undoBtn.addEventListener('click', () => {
    if (!fguiPreview) return;
    const ok = fguiPreview.undo();
    statusEl.textContent = ok ? '↩ 已撤销上一步编辑' : '没有可撤销的操作';
    updateToolbarState();
  });
  saveSrcBtn.addEventListener('click', saveSourcePkg);
  exportBtn.addEventListener('click', exportSourcePkg);
  openDirBtn.addEventListener('click', () => {
    if (!curBinPath) return;
    window.api.openPath(binDirOf(curBinPath));
  });
  bgInput.addEventListener('input', () => { if (fguiPreview) fguiPreview.setBackground(bgInput.value); });
  container.querySelectorAll('.fge-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.fge-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      container.querySelector('#fge-tree').style.display = tab === 'tree' ? '' : 'none';
      container.querySelector('#fge-res').style.display = tab === 'res' ? '' : 'none';
    });
  });
  container.querySelectorAll('.fge-rtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.fge-rtab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderResList(btn.dataset.rtab);
    });
  });

  // ---------- 初始化画布 ----------
  (async () => {
    fguiPreview = new FguiLayoutPreview();
    try {
      await fguiPreview.init(refs);
    } catch (e) {
      statusEl.textContent = '画布初始化失败: ' + (e.message || e);
    }
    // 选中回调 → 层级树同步高亮
    fguiPreview._onSelect = (node) => {
      document.querySelectorAll('.fge-hier-item').forEach((x) => x.classList.remove('sel'));
      if (node) {
        const entries = document.querySelectorAll('.fge-hier-item');
        for (let i = 0; i < entries.length; i++) {
          // 通过名称匹配(仅视觉同步)
        }
      }
    };
    window.__fguiPreview = fguiPreview;
    window.__fguiEditorLoad = (binPath) => loadPkg(binPath); // 测试钩子(冒烟用)
    container._fguiEditorLoad = loadPkg; // 状态保持: 外部(ui.js)可再次加载 bin
    updateToolbarState();
    if (opts.initialBinPath) await loadPkg(opts.initialBinPath);
    else statusEl.textContent = '请选择一个 FGUI 包(.bin)开始编辑';
  })();

  return container;
}
