// 游戏场景管理页面
// 包含两个视图:场景主页(汇总 + 分类入口) 与 场景目录列表页(某分类下的场景条目 + 操作)。
// 另含 FGUI 界面交互预览子页(选 .bin → 组件 → PixiJS 布局预览)。

import {
  state,
  addScene, addSceneCategory, updateScene, removeScene,
  getSceneCategoryChildren, scenesInCategory, findSceneByFilePath, recordRecentOpen, setSetting,
} from '../state.js';
import { toast, showContextMenu, confirmDialog, promptDialog, footButtons, openModal } from '../dialogs.js';
import { initBgColorBar } from '../bgColor.js';
import { FguiLayoutPreview } from '../viewers/fguiLayoutPreview.js';

let fguiPreview = null; // FGUI 预览控制器(单例, 切换时 dispose 重建)
let fguiKeyHandler = null; // FGUI 预览页 Ctrl+Z 撤销监听(重建页面时先移除,避免重复注册)

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** 场景搜索结果页(顶栏全局搜索;catId=null 全部场景,否则当前目录含子分类) */
export function renderSceneSearchResults(q, catId, actions = {}) {
  const container = document.getElementById('page-scene');
  if (!container || !q) return;
  // 收集场景池:全部 或 当前目录递归子分类
  const catIds = new Set();
  const walkCat = (id) => {
    if (id == null) return;
    catIds.add(id);
    for (const c of getSceneCategoryChildren(id)) walkCat(c.id);
  };
  if (catId != null) walkCat(catId);
  const pool = state.scenes.filter((s) => catId == null || catIds.has(s.categoryId));
  const hits = pool.filter((s) =>
    String(s.name || '').toLowerCase().includes(q) ||
    String(s.filePath || '').toLowerCase().includes(q));
  const range = catId != null ? '当前目录范围' : '全部场景';
  container.innerHTML = `
    <div class="scene-home">
      <div class="home-title">🔍 场景搜索结果</div>
      <div class="home-subtitle">匹配「${escHtml(q)}」· ${hits.length} 条 · ${range}</div>
      <div class="scene-recent">
        <div class="recent-list">
          ${hits.length ? hits.map((s) => `
            <div class="recent-item" data-sr-scene="${s.id}" title="${escHtml(s.filePath || '')}">
              <span class="type-badge">${s.subtype === 'fgui' ? '🧩' : s.type === 'folder' ? '📁' : '📄'}</span>
              <span class="ri-name">${escHtml(s.name || '')}</span>
              <span class="ri-meta">${escHtml(s.filePath || '')}</span>
            </div>`).join('') : '<div class="home-empty">没有匹配的场景</div>'}
        </div>
      </div>
    </div>
  `;
  container.querySelectorAll('[data-sr-scene]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = state.scenes.find((x) => x.id === el.dataset.srScene);
      if (!s) return;
      if (s.subtype === 'fgui' && actions.onOpenFgui) actions.onOpenFgui(s.id);
      else if (actions.onOpenPath && s.filePath) actions.onOpenPath(s);
    });
  });
}

/** 场景主页:统计 + 分类入口 + 场景总数 */
export function renderSceneHome(container, { onOpenCat, onAddScene, onAddCategory, onAddFguiPackages, onFguiPreview, onRefresh }) {
  if (!container) return;
  const cats = state.sceneCategories;
  const scenes = state.scenes;
  const folders = scenes.filter((s) => s.type === 'folder').length;
  const files = scenes.filter((s) => s.type === 'file').length;
  const totalSize = scenes.reduce((a, s) => a + (s.size || 0), 0);
  container.innerHTML = `
    <div class="scene-home">
      <div class="home-title">
        <h2>游戏场景管理</h2>
        <p>按目录分类管理游戏场景;支持文件夹与文件两种类型,提供常用快捷入口。</p>
      </div>
      <div class="stat-cards">
        <div class="stat-card scene-card-total"><span class="stat-num">${scenes.length}</span><span class="stat-label">场景总数</span></div>
        <div class="stat-card scene-card-folder"><span class="stat-num">${folders}</span><span class="stat-label">文件夹场景</span></div>
        <div class="stat-card scene-card-file"><span class="stat-num">${files}</span><span class="stat-label">文件场景</span></div>
        <div class="stat-card scene-card-cat"><span class="stat-num">${cats.length}</span><span class="stat-label">目录数</span></div>
      </div>
      <div class="scene-actions">
        <button class="btn primary" id="sc-add-scene">+ 添加场景</button>
        <button class="btn" id="sc-add-fgui" title="批量添加 FGUI 包:单选/多选 .bin 文件或目录(目录内扫描,可选递归)">🧩 添加FGUI包</button>
        <button class="btn" id="sc-add-cat">+ 新建目录</button>
        <button class="btn sm" id="sc-refresh">刷新</button>
      </div>
      <div class="fg-entry-card" id="sc-fgui-entry" title="用 PixiJS 把 FairyGUI 的 .bin 界面包按布局还原为可交互预览">
        <div class="fg-entry-ico">🧩</div>
        <div class="fg-entry-main">
          <div class="fg-entry-title">FGUI 界面预览</div>
          <div class="fg-entry-desc">选择 FairyGUI 的 .bin 界面包,按 xy/size 渲染 Image/Loader/Text 布局;支持缩放平移、点选属性、控制器页切换。</div>
        </div>
        <div class="fg-entry-go">进入 →</div>
      </div>
      <div class="scene-cats">
        <div class="section-title">📁 场景目录</div>
        <div class="cat-tree-list" id="sc-cat-tree"></div>
      </div>
      <div class="scene-recent">
        <div class="section-title">🕘 最近添加</div>
        <div class="recent-list" id="sc-recent"></div>
      </div>
    </div>
  `;
  // 渲染分类树(主页版,缩进展示)
  const treeEl = container.querySelector('#sc-cat-tree');
  if (!cats.length) {
    treeEl.innerHTML = '<div class="empty-tip">还没有目录,点击上方「+ 新建目录」开始。</div>';
  } else {
    treeEl._onOpenCat = onOpenCat;
    for (const c of cats.filter((x) => !x.parentId)) renderSceneCatInList(treeEl, c, 0);
    // 未分类
    const unc = scenesInCategory('');
    if (unc.length) {
      const un = document.createElement('div');
      un.className = 'cat-row root';
      un.innerHTML = `<span class="cat-row-arrow">○</span><span class="cat-row-name">未分类</span><span class="cat-row-count">${unc.length}</span>`;
      un.addEventListener('click', () => onOpenCat(''));
      treeEl.appendChild(un);
    }
  }
  // 最近添加(按 createdAt 倒序取前 10)
  const recent = [...scenes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10);
  const recentEl = container.querySelector('#sc-recent');
  if (!recent.length) {
    recentEl.innerHTML = '<div class="empty-tip">还没有场景。</div>';
  } else {
    for (const s of recent) {
      const row = document.createElement('div');
      row.className = 'recent-row';
      row.innerHTML = `
        <span class="rec-ico">${s.type === 'folder' ? '📁' : (s.subtype === 'fgui' ? '🧩' : '📄')}</span>
        <span class="rec-name" title="${escHtml(s.filePath)}">${escHtml(s.name)}</span>
        <span class="rec-path" title="${escHtml(s.filePath)}">${escHtml(s.filePath)}</span>
      `;
      row.addEventListener('click', () => {
        const items = [
          ...(s.subtype === 'fgui' ? [{ label: '🧩 FGUI 界面预览', onClick: () => onFguiPreview && onFguiPreview(s.id) }] : []),
          { label: '在文件管理器中显示', onClick: () => window.api.showItem(s.filePath) },
          { label: '打开', onClick: () => window.api.openPath(s.filePath) },
          { label: '编辑场景信息', onClick: () => promptDialog({ title: '编辑场景名称', defaultValue: s.name, onOk: (n) => { if (n) updateScene(s.id, { name: n }); onRefresh(); } }) },
          { label: '删除', danger: true, onClick: () => confirmDialog({ title: `删除「${s.name}」?`, message: '仅从列表移除,不会删除磁盘内容。', onOk: () => { removeScene(s.id); onRefresh(); } }) },
        ];
        showContextMenu(window.innerWidth - 240, 120, items);
      });
      recentEl.appendChild(row);
    }
  }

  container.querySelector('#sc-add-scene').addEventListener('click', () => onAddScene(''));
  container.querySelector('#sc-add-fgui').addEventListener('click', () => onAddFguiPackages && onAddFguiPackages(''));
  container.querySelector('#sc-add-cat').addEventListener('click', () => onAddCategory(''));
  container.querySelector('#sc-refresh').addEventListener('click', onRefresh);
  // FGUI 界面预览入口 → 独立子页(事件解耦, ui.js 接住; 需 bubbles 冒泡到 document)
  container.querySelector('#sc-fgui-entry').addEventListener('click', () => {
    container.dispatchEvent(new CustomEvent('scene:navigate', { detail: { to: 'fgui-preview' }, bubbles: true }));
  });
}

// ================= FGUI 界面交互预览子页 =================

/**
 * 渲染 FGUI 界面预览子页。
 * @param {HTMLElement} container #page-scene
 * @param {{onBack: Function, initialBinPath?: string}} opts initialBinPath 从场景管理进入时自动加载的 .bin 路径
 */
export function renderFguiPreviewPage(container, { onBack, initialBinPath } = {}) {
  if (!container) return;
  // 重建(切页时销毁旧控制器);同时移除上一页注册的撤销快捷键监听
  if (fguiPreview) { try { fguiPreview.dispose(); } catch (e) { /* ignore */ } fguiPreview = null; }
  if (fguiKeyHandler) { window.removeEventListener('keydown', fguiKeyHandler); fguiKeyHandler = null; }

  container.innerHTML = `
    <div class="fg-preview-page">
      <div class="fg-pv-toolbar">
        <button class="btn sm" id="fgpv-back">← 返回</button>
        <button class="btn" id="fgpv-pick">📦 选择 FGUI 包(.bin)</button>
        <button class="btn sm" id="fgpv-register" style="display:none" title="把当前 FGUI 包登记到游戏场景管理的指定目录,下次可直接从场景管理打开预览">📌 登记到场景管理</button>
        <span class="fgpv-pkg" id="fgpv-pkg"></span>
        <span class="fgpv-reg" id="fgpv-reg"></span>
        <select id="fgpv-comp" title="选择要预览的组件"><option value="">(未加载包)</option></select>
        <div class="fg-ctrl-btns" id="fgpv-ctrls"></div>
        <div class="fgpv-spacer"></div>
        <button class="btn sm" id="fgpv-edit" disabled title="切换可视化编辑模式(拖拽移动/调整大小/编辑属性)">✎ 编辑模式</button>
        <button class="btn sm" id="fgpv-undo" disabled title="撤销上一步编辑(Ctrl+Z)">↩ 撤销</button>
        <button class="btn sm" id="fgpv-unpack" disabled title="用内置 FGUI 逆向导出功能,把当前包解压到其所在目录下同包子目录">📦 解压FGUI包</button>
        <button class="btn sm" id="fgpv-export" disabled title="导出当前包到其所在目录下的同名子目录(已存在文件时提示是否覆盖)">📤 导出资源</button>
        <button class="btn sm" id="fgpv-snapshot" disabled title="保存当前组件编辑后的布局快照(JSON),自动关联到该 FGUI 包">💾 保存快照</button>
        <button class="btn sm" id="fgpv-texdir" style="display:none" title="自动探测纹理失败时手动指定纹理目录">🔧 选择纹理目录</button>
        <span class="fg-bgbar" id="fgpv-bgbar" style="display:none">
          <label class="ctrl-label" style="margin-left:2px">背景</label>
          <input type="color" id="fgpv-bg-color" value="#1b1d23" title="调色盘选背景色(立即生效)" />
          <button class="btn sm bg-save-btn" id="fgpv-bg-save" title="把调色盘当前颜色保存为自定义颜色">存</button>
          <button class="btn sm" id="fgpv-bg-dark" title="深色背景 #1b1d23">深</button>
          <button class="btn sm" id="fgpv-bg-light" title="浅色背景 #eef0f5">浅</button>
          <button class="btn sm" id="fgpv-bg-custom" title="使用自定义颜色">自定</button>
        </span>
        <span class="status" id="fgpv-status"></span>
      </div>
      <div class="fg-preview-layout">
        <div class="fg-canvas-wrap" id="fgpv-canvas-wrap">
          <canvas id="fgpv-canvas"></canvas>
          <div class="fg-text-layer" id="fgpv-text"></div>
        </div>
        <div class="fg-side" id="fgpv-side">
          <div class="fg-hsplit" id="fgpv-hsplit" title="拖动调整右侧面板宽度"></div>
          <div class="fg-comp-bar" id="fgpv-compbar" style="display:none">
            <div class="fg-comp-title">📋 组件列表 <span class="fg-comp-cnt" id="fgpv-compcnt"></span></div>
            <input class="fg-comp-search" id="fgpv-comp-search" type="text" placeholder="🔍 搜索组件(名称/类型/@包名)…" />
            <div class="fg-comp-list" id="fgpv-complist"></div>
          </div>
          <div class="fg-vsplit" id="fgpv-vsplit" style="display:none" title="拖动调整组件列表/属性面板占比"></div>
          <div class="fg-snap-bar" id="fgpv-snapbar" style="display:none">
            <span class="fg-snap-title">📋 快照</span>
            <select id="fgpv-snaps" title="该 FGUI 包已保存的布局快照"></select>
            <button class="btn sm" id="fgpv-snap-load" title="回放选中快照到画布">↺ 加载</button>
            <button class="btn sm" id="fgpv-snap-del" title="从关联记录中移除(磁盘文件保留)">🗑</button>
            <button class="btn sm" id="fgpv-snap-folder" title="打开快照所在目录">📂</button>
          </div>
          <div class="fg-prop-panel" id="fgpv-props"><div class="hint">点击画布中的对象查看属性</div></div>
        </div>
      </div>
    </div>
  `;

  const refs = {
    root: container.querySelector('#fgpv-canvas-wrap'),
    canvas: container.querySelector('#fgpv-canvas'),
    textLayer: container.querySelector('#fgpv-text'),
    propPanel: container.querySelector('#fgpv-props'),
    ctrlBar: container.querySelector('#fgpv-ctrls'),
  };
  const pkgEl = container.querySelector('#fgpv-pkg');
  const regEl = container.querySelector('#fgpv-reg');
  const regBtn = container.querySelector('#fgpv-register');
  const compSel = container.querySelector('#fgpv-comp');
  const statusEl = container.querySelector('#fgpv-status');
  const texBtn = container.querySelector('#fgpv-texdir');
  const bgBarEl = container.querySelector('#fgpv-bgbar');
  const editBtn = container.querySelector('#fgpv-edit');
  const undoBtn = container.querySelector('#fgpv-undo');
  const unpackBtn = container.querySelector('#fgpv-unpack');
  const exportBtn = container.querySelector('#fgpv-export');
  const snapshotBtn = container.querySelector('#fgpv-snapshot');

  let payload = null;
  let textureDir = null; // 手动指定纹理目录
  let curBinPath = null;
  let curSceneId = null; // 登记到游戏场景管理的场景条目 id(null = 未登记)
  let compListEntries = []; // 组件列表条目 [{node, isMain}]

  const loadComp = async (compId) => {
    if (!payload) return;
    statusEl.textContent = '渲染中...';
    try {
      await fguiPreview.load(payload, compId);
      if (compSel.value !== compId) compSel.value = compId; // 顶部下拉与组件列表同步
      statusEl.textContent = payload.missingTextures.length
        ? `⚠ 缺少纹理: ${payload.missingTextures.join(', ')}`
        : '';
      texBtn.style.display = payload.missingTextures.length ? '' : 'none';
      syncCompListActive(compId);
    } catch (e) {
      statusEl.textContent = '渲染失败: ' + (e.message || e);
      console.error('[fgui-preview]', e);
    }
  };

  function updateToolbarState() {
    const loaded = !!payload;
    editBtn.disabled = !loaded;
    undoBtn.disabled = !loaded || !fguiPreview || !fguiPreview.editMode;
    unpackBtn.disabled = !loaded || !curBinPath;
    exportBtn.disabled = !loaded || !curBinPath;
    snapshotBtn.disabled = !loaded || !fguiPreview;
    bgBarEl.style.display = loaded && fguiPreview ? '' : 'none';
    editBtn.classList.toggle('active', loaded && fguiPreview && fguiPreview.editMode);
  }

  /** .bin 所在目录 */
  const binDirOf = (p) => (p || '').replace(/[\\/][^\\/]+$/, '');
  /** 包名(去扩展名),如 Bag.bin → Bag */
  const pkgNameOf = (p) => (p.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '') || '未命名';
  /** 包名子目录 = bin 同目录/<包名>(快照/解压/编辑历史统一存放处) */
  const pkgDir = () => (curBinPath ? joinPath(binDirOf(curBinPath), pkgNameOf(curBinPath)) : '');
  const historyFile = () => (curBinPath ? joinPath(pkgDir(), 'edit_history.json') : '');

  /** 读取 <包名>/edit_history.json,不存在返回 [] */
  async function loadEditHistory() {
    const f = historyFile();
    if (!f) return [];
    try {
      const r = await window.api.readBase64(f);
      if (!r || !r.ok) return [];
      return JSON.parse(atob(r.dataUrl.split(',')[1] || '[]'));
    } catch (e) { return []; }
  }

  /** 追加一条编辑历史(编辑模式提交的修改会实时写入,便于记录/回撤) */
  async function appendEditHistory(entry) {
    const f = historyFile();
    if (!f) return;
    const hist = Array.isArray(await loadEditHistory()) ? await loadEditHistory() : [];
    hist.push(entry);
    try {
      const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(hist, null, 2))));
      await window.api.writeFileBase64(f, dataUrl);
    } catch (e) { /* 历史记录失败不阻塞编辑 */ }
  }

  // ---------- 右侧组件列表面板 ----------

  /** 渲染组件列表:主包组件 + 组件树全部节点(本包/跨包,层级缩进;跨包标 @外部包名) */
  function renderCompList() {
    const bar = container.querySelector('#fgpv-compbar');
    const list = container.querySelector('#fgpv-complist');
    const cnt = container.querySelector('#fgpv-compcnt');
    const vs = container.querySelector('#fgpv-vsplit');
    if (!payload || !list) { if (bar) bar.style.display = 'none'; if (vs) vs.style.display = 'none'; return; }
    bar.style.display = '';
    if (vs) vs.style.display = '';
    // 包 id → 包名(标注外部组件用)
    const pkgNames = { [payload.pkg.id]: payload.pkg.name };
    for (const d of payload.pkg.deps || []) pkgNames[d.id] = d.name;
    compListEntries = [];
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    const push = (label, isSub, depth, node, compId) => {
      const el = document.createElement('div');
      el.className = 'fg-comp-item' + (isSub ? ' sub' : '');
      el.style.paddingLeft = (isSub ? depth * 12 + 10 : 6) + 'px';
      el.innerHTML = label;
      const idx = compListEntries.length;
      compListEntries.push({ node, isMain: !isSub, compId });
      el.addEventListener('click', async () => {
        if (!fguiPreview || !node) return;
        // 节点所属组件未在显示中 → 先切换到该组件
        const curId = fguiPreview.comp ? fguiPreview.comp.id : null;
        if (compId && compId !== curId) {
          await loadComp(compId);
          if (!fguiPreview || fguiPreview.comp.id !== compId) return;
        }
        const r = fguiPreview.highlightNode(node);
        // 联动属性面板:选中该节点(触发 _onSelect → 列表 active 同步)
        fguiPreview.selectNode(node, node._textDiv);
        if (r) statusEl.textContent = `已定位:${el.childNodes[0] && el.childNodes[0].textContent ? el.childNodes[0].textContent.trim() : ''} (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)})`;
      });
      frag.appendChild(el);
    };
    let total = 0;
    for (const c of payload.components || []) {
      push(`📦 ${c.name || '(未命名)'} <span class="fg-comp-type">${escHtml(c.objectType || 'Component')}</span>`, false, 0, c.root, c.id);
      total++;
      // 递归列出组件树全部节点(本包 + 跨包),按深度缩进
      const walk = (n, depth) => {
        if (!n) return;
        const isExt = n.srcPkgId && n.srcPkgId !== payload.pkg.id;
        const extMark = isExt ? ` <span class="fg-ext">@${escHtml(pkgNames[n.srcPkgId] || n.srcPkgId)}</span>` : '';
        const type = escHtml(n.type || n.kind || 'unknown');
        push(`└ ${escHtml(n.name || '(未命名)')}${extMark} <span class="fg-comp-type">${type}</span>`, true, depth, n, c.id);
        total++;
        for (const ch of n.children || []) walk(ch, depth + 1);
      };
      for (const ch of (c.root ? c.root.children || [] : [])) walk(ch, 1);
    }
    list.appendChild(frag);
    cnt.textContent = `(${total})`;
    // 组件搜索:按文本过滤列表行(名称/类型/@外部包名)
    const compSearch = container.querySelector('#fgpv-comp-search');
    if (compSearch) {
      compSearch.oninput = () => {
        const q = compSearch.value.trim().toLowerCase();
        list.querySelectorAll('.fg-comp-item').forEach((el) => {
          el.style.display = !q || el.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      };
    }
  }

  /** 组件下拉切换后,同步列表 active(主包组件项) */
  function syncCompListActive(compId) {
    const list = container.querySelector('#fgpv-complist');
    if (!list) return;
    [...list.children].forEach((el, i) => {
      const entry = compListEntries[i];
      el.classList.toggle('active', !!entry && entry.isMain && entry.node && entry.node.id === compId);
    });
  }

  /** 画布选中节点 → 列表同步高亮 */
  function bindCompListSelect() {
    if (fguiPreview) {
      fguiPreview._onSelect = (node) => {
        const list = container.querySelector('#fgpv-complist');
        if (!list) return;
        [...list.children].forEach((el, i) => {
          const entry = compListEntries[i];
          el.classList.toggle('active', !!entry && entry.node === node);
        });
      };
    }
  }

  // ---------- 右侧面板可拖拽布局:垂直分割线 + 左侧边框 ----------
  const sideEl = container.querySelector('#fgpv-side');
  const vSplit = container.querySelector('#fgpv-vsplit');
  const hSplit = container.querySelector('#fgpv-hsplit');
  const compBar = container.querySelector('#fgpv-compbar');
  const SIDE_W_KEY = 'fgpv-sideW';
  const COMP_H_KEY = 'fgpv-compH';
  // 恢复上次尺寸
  const savedW = parseInt(localStorage.getItem(SIDE_W_KEY), 10);
  if (savedW >= 180 && savedW <= 480) sideEl.style.flexBasis = savedW + 'px';
  const savedH = parseInt(localStorage.getItem(COMP_H_KEY), 10);
  if (savedH >= 60) compBar.style.flex = `0 0 ${savedH}px`;

  // 垂直分割线:调整 组件列表 与 (快照条+属性面板) 的占比
  vSplit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { vSplit.setPointerCapture(e.pointerId); } catch (err) { /* 兼容 synthetic 事件 */ }
    const startY = e.clientY;
    const startH = compBar.getBoundingClientRect().height;
    const onMove = (ev) => {
      let h = startH + (ev.clientY - startY);
      const maxH = sideEl.getBoundingClientRect().height - 140;
      h = Math.max(60, Math.min(h, maxH));
      compBar.style.flex = `0 0 ${h}px`;
      localStorage.setItem(COMP_H_KEY, String(Math.round(h)));
    };
    const onUp = () => {
      vSplit.removeEventListener('pointermove', onMove);
      vSplit.removeEventListener('pointerup', onUp);
    };
    vSplit.addEventListener('pointermove', onMove);
    vSplit.addEventListener('pointerup', onUp);
  });

  // 左侧边框:调整右侧面板宽度(向左拖变宽)
  hSplit.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { hSplit.setPointerCapture(e.pointerId); } catch (err) { /* 兼容 synthetic 事件 */ }
    const startX = e.clientX;
    const startW = sideEl.getBoundingClientRect().width;
    const onMove = (ev) => {
      let w = startW + (startX - ev.clientX);
      w = Math.max(180, Math.min(480, w));
      sideEl.style.flexBasis = w + 'px';
      localStorage.setItem(SIDE_W_KEY, String(Math.round(w)));
    };
    const onUp = () => {
      hSplit.removeEventListener('pointermove', onMove);
      hSplit.removeEventListener('pointerup', onUp);
    };
    hSplit.addEventListener('pointermove', onMove);
    hSplit.addEventListener('pointerup', onUp);
  });

  /** 登记信息显示 */
  function renderRegInfo() {
    const s = curSceneId ? state.scenes.find((x) => x.id === curSceneId) : null;
    if (s) {
      const catName = sceneCategoryName(s.categoryId);
      regEl.textContent = `📌 已登记:${catName} / ${s.name}`;
      regEl.title = `可在「游戏场景管理 → ${catName}」中直接打开预览`;
      regBtn.style.display = 'none';
    } else {
      regEl.textContent = '';
      regBtn.style.display = curBinPath ? '' : 'none';
    }
  }

  /** 快照条渲染(从关联场景条目的 fguiSnapshots 读取) */
  function renderSnapBar() {    const bar = container.querySelector('#fgpv-snapbar');
    const sel = container.querySelector('#fgpv-snaps');
    const s = curSceneId ? state.scenes.find((x) => x.id === curSceneId) : null;
    const snaps = (s && Array.isArray(s.fguiSnapshots)) ? s.fguiSnapshots : [];
    bar.style.display = curBinPath ? '' : 'none';
    sel.innerHTML = '';
    if (!snaps.length) {
      const op = document.createElement('option');
      op.value = '';
      op.textContent = '(暂无快照)';
      sel.appendChild(op);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    [...snaps].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach((sn) => {
      const op = document.createElement('option');
      op.value = sn.id;
      op.textContent = `${sn.name || '快照'} · ${fmtTime(sn.timestamp)}`;
      sel.appendChild(op);
    });
  }

  const loadPkg = async (binPath, texDir, { register = false } = {}) => {
    statusEl.textContent = '解析中...';
    try {
      const res = await window.api.fguiPreviewLoad({ inputPath: binPath, textureDir: texDir || undefined });
      if (!res || !res.ok) throw new Error((res && res.error) || '解析失败');
      payload = res;
      textureDir = texDir || null;
      curBinPath = binPath;
      // 关联登记:按路径查已登记条目(任何 subtype),复用或升级标记
      const exist = findSceneByFilePath(binPath);
      curSceneId = null;
      if (exist) {
        if (exist.subtype !== 'fgui') updateScene(exist.id, { subtype: 'fgui' });
        curSceneId = exist.id;
      } else if (register) {
        curSceneId = await promptRegisterFgui(binPath); // 未登记 → 弹窗指定所属目录
      }
      pkgEl.textContent = `${res.pkg.name} (v${res.pkg.version})`;
      // 记录最近打开(首页展示与再次打开)
      recordRecentOpen({ name: res.pkg.name, path: binPath, type: 'fgui' });
      // 组件下拉
      compSel.innerHTML = '';
      for (const c of res.components) {
        const op = document.createElement('option');
        op.value = c.id;
        op.textContent = c.name || c.id;
        compSel.appendChild(op);
      }
      compSel.disabled = res.components.length === 0;
      statusEl.textContent = res.missingTextures.length
        ? `⚠ 缺少纹理: ${res.missingTextures.join(', ')}`
        : `已加载 ${res.components.length} 个组件`;
      texBtn.style.display = res.missingTextures.length ? '' : 'none';
      updateToolbarState();
      renderRegInfo();
      renderSnapBar();
      renderCompList();
      // 读取编辑历史条数(仅展示;历史文件在 <包名>/edit_history.json)
      loadEditHistory().then((h) => {
        if (curBinPath === binPath && Array.isArray(h) && h.length) {
          statusEl.textContent += ` · 编辑历史 ${h.length} 条`;
        }
      });
      if (res.components.length) await loadComp(res.components[0].id);
    } catch (e) {
      statusEl.textContent = '解析失败: ' + (e.message || e);
      console.error('[fgui-preview]', e);
    }
  };

  // 初始化控制器
  (async () => {
    fguiPreview = new FguiLayoutPreview();
    try { await fguiPreview.init(refs); } catch (e) {
      statusEl.textContent = '画布初始化失败: ' + (e.message || e);
    }
    // 暴露测试钩子(仅开发/冒烟用)
    window.__fguiPreviewTestLoad = (binPath, texDir) => loadPkg(binPath, texDir);
    // 编辑提交 → 写入 <包名>/edit_history.json(编辑历史记录,配合撤销/回撤)
    fguiPreview._onEditCommitted = (info) => {
      if (!curBinPath || !info) return;
      appendEditHistory({
        timestamp: Date.now(),
        binPath: curBinPath,
        component: info.component || '',
        nodeId: info.nodeId,
        name: info.name || '',
        changes: info.changes || {},
      });
    };
    // 画布选中 → 组件列表同步高亮
    bindCompListSelect();
    // 应用已保存的背景色
    if (fguiPreview) {
      const bg = (state.settings && state.settings.fguiBgColor) || '#1b1d23';
      const bgInput = container.querySelector('#fgpv-bg-color');
      if (bgInput) bgInput.value = bg;
      fguiPreview.setBackground(bg);
    }
    // 从场景管理进入:自动加载指定包(手动加载时同样弹登记窗)
    if (initialBinPath) await loadPkg(initialBinPath, null, { register: true });
  })();

  container.querySelector('#fgpv-back').addEventListener('click', () => {
    if (fguiPreview) { try { fguiPreview.dispose(); } catch (e) { /* ignore */ } fguiPreview = null; }
    if (onBack) onBack();
  });

  container.querySelector('#fgpv-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({
      title: '选择 FairyGUI 包(.bin)',
      filters: [{ name: 'FGUI 包', extensions: ['bin'] }],
    });
    if (r.canceled || !r.filePaths.length) return;
    await loadPkg(r.filePaths[0], textureDir, { register: true });
  });

  regBtn.addEventListener('click', async () => {
    if (!curBinPath) return;
    curSceneId = await promptRegisterFgui(curBinPath);
    renderRegInfo();
    renderSnapBar();
  });

  compSel.addEventListener('change', () => loadComp(compSel.value));

  texBtn.addEventListener('click', async () => {
    const r = await window.api.pickFiles({ title: '选择包含图集纹理的目录(如 ui/fgui_texture/fgui)', directory: true });
    if (r.canceled || !r.filePaths.length) return;
    if (curBinPath) await loadPkg(curBinPath, r.filePaths[0]);
  });

  // 画布背景色:调色盘立即生效 + 深/浅/自定义反色按钮 + 保存自定义
  initBgColorBar({
    input: container.querySelector('#fgpv-bg-color'),
    darkBtn: container.querySelector('#fgpv-bg-dark'),
    lightBtn: container.querySelector('#fgpv-bg-light'),
    customBtn: container.querySelector('#fgpv-bg-custom'),
    saveBtn: container.querySelector('#fgpv-bg-save'),
    dark: '#1b1d23',
    onApply: (hex) => {
      if (fguiPreview) fguiPreview.setBackground(hex);
      setSetting('fguiBgColor', hex);
      statusEl.textContent = '背景色已设为 ' + hex;
    },
  });

  editBtn.addEventListener('click', () => {
    if (!fguiPreview) return;
    fguiPreview.setEditMode(!fguiPreview.editMode);
    updateToolbarState();
    statusEl.textContent = fguiPreview.editMode ? '编辑模式:可拖拽移动/调整大小/属性修改,撤销(Ctrl+Z)可回退' : '';
  });

  undoBtn.addEventListener('click', () => {
    if (!fguiPreview || !fguiPreview.editMode) return;
    const ok = fguiPreview.undo();
    statusEl.textContent = ok ? '↩ 已撤销上一步编辑' : '没有可撤销的操作';
    updateToolbarState();
  });

  /**
   * 导出/解压当前预览的 FGUI 包到 bin 同目录/<包名>/ 子目录(不弹目录选择;自动建目录)。
   * @param {{confirm?: boolean, actionLabel?: string}} opts confirm=true 时若目录已存在导出文件则弹窗确认是否覆盖;actionLabel 状态文案用词(解压/导出)
   */
  const exportCurrentPkg = async ({ confirm = true, actionLabel = '导出' } = {}) => {
    if (!curBinPath) return;
    const outDir = pkgDir();
    const pkgName = pkgNameOf(curBinPath);
    // 检查目标目录是否已存在该包的导出文件
    let existing = false;
    for (const f of [pkgName + '.json', pkgName + '.xml']) {
      try {
        const st = await window.api.statFile(joinPath(outDir, f));
        if (st && st.size != null) { existing = true; break; }
      } catch (e) { /* ignore */ }
    }
    if (existing && confirm) {
      const go = await new Promise((resolve) => {
        confirmDialog({
          title: '目录已存在导出文件',
          message: `目标目录「${escHtml(pkgName)}」已存在该包的导出文件,是否覆盖原文件?<br><code>${escHtml(outDir)}</code>`,
          okText: '覆盖',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!go) { statusEl.textContent = '已取消,未覆盖原文件'; return; }
    }
    statusEl.textContent = `正在${actionLabel} FGUI 包...`;
    try {
      const res = await window.api.fguiExportSingle({ inputPath: curBinPath, outputDir: outDir });
      if (res && res.ok) {
        // 只复制本包图集的单图(来自共享素材库,不复制整张图集,避免跨包重复);素材库未生成时回退复制整图集
        const copied = await copySpritesToDir(payload, outDir, res);
        let msg = `✅ 已${actionLabel}到 ${outDir}`;
        if (copied.count > 0) msg += `,素材 ${copied.count} 张`;
        if (res.deps && res.deps.length) msg += ` [引用公共素材: ${res.deps.join(', ')},请一并解压该包]`;
        statusEl.textContent = msg;
        toast(msg, 'success');
      } else {
        statusEl.textContent = '✗ ' + ((res && res.error) || `${actionLabel}失败`);
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e.message || String(e));
    }
  };

  unpackBtn.addEventListener('click', () => exportCurrentPkg({ confirm: true, actionLabel: '解压' }));
  exportBtn.addEventListener('click', () => exportCurrentPkg({ confirm: true, actionLabel: '导出' }));

  snapshotBtn.addEventListener('click', async () => {
    if (!fguiPreview || !payload) return;
    // 快照必须与登记的 FGUI 包关联:未登记先引导登记
    if (!curSceneId) {
      toast('请先登记到游戏场景管理,快照才能与该包关联', 'error');
      curSceneId = await promptRegisterFgui(curBinPath);
      renderRegInfo();
      if (!curSceneId) return;
    }
    const comp = fguiPreview.comp;
    if (!comp) { toast('请先选择一个组件', 'error'); return; }
    const snap = {
      pkg: payload.pkg,
      component: { id: comp.id, name: comp.name },
      timestamp: Date.now(),
      nodes: fguiPreview.exportEdits(),
    };
    // 默认保存到 .bin 同目录的 <包名> 子目录(与解压输出/编辑历史同目录,目录不存在时自动创建)
    const defaultDir = pkgDir();
    const r = await window.api.pickFiles({ title: '保存布局快照(JSON)', directory: true, defaultPath: defaultDir });
    if (r.canceled || !r.filePaths.length) return;
    const outDir = r.filePaths[0];
    const snapName = `${comp.name || comp.id}_layout_${Date.now()}`;
    const outPath = joinPath(outDir, snapName + '.json');
    try {
      const dataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(snap, null, 2))));
      const wr = await window.api.writeFileBase64(outPath, dataUrl);
      if (wr.ok) {
        // 追加快照记录到关联场景条目
        const s = state.scenes.find((x) => x.id === curSceneId);
        const list = (s && Array.isArray(s.fguiSnapshots)) ? [...s.fguiSnapshots] : [];
        list.push({ id: 'snp' + Date.now(), name: snapName, path: outPath, timestamp: snap.timestamp });
        updateScene(curSceneId, { fguiSnapshots: list });
        renderSnapBar();
        statusEl.textContent = '✅ 已保存快照并关联:' + outPath;
        toast('快照已保存并关联到该 FGUI 包', 'success');
      } else {
        statusEl.textContent = '✗ 保存失败:' + (wr.error || '');
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e.message || String(e));
    }
  });

  // ---- 快照条:加载 / 删除记录 / 打开目录 ----
  container.querySelector('#fgpv-snap-load').addEventListener('click', async () => {
    const sel = container.querySelector('#fgpv-snaps');
    const s = curSceneId ? state.scenes.find((x) => x.id === curSceneId) : null;
    const snap = (s && (s.fguiSnapshots || []).find((x) => x.id === sel.value));
    if (!snap) return;
    statusEl.textContent = '加载快照...';
    try {
      const r = await window.api.readBase64(snap.path);
      if (!r || !r.ok) throw new Error((r && r.error) || '读取失败');
      const data = JSON.parse(atob(r.dataUrl.split(',')[1] || ''));
      let res = fguiPreview.applySnapshot(data);
      if (!res.ok && payload) {
        // 组件不匹配:自动切换到快照所属组件再回放
        const compRef = (data && data.component) || {};
        const t = (payload.components || []).find((c) =>
          String(c.id) === String(compRef.id) || (compRef.name && String(c.name) === String(compRef.name)));
        if (t) { await loadComp(t.id); res = fguiPreview.applySnapshot(data); }
      }
      if (res.ok) {
        statusEl.textContent = `✅ 已回放快照「${snap.name}」(${res.applied} 个节点)`;
        toast(`已回放快照「${snap.name}」`, 'success');
      } else {
        statusEl.textContent = '✗ ' + (res.error || '回放失败');
      }
    } catch (e) {
      statusEl.textContent = '✗ 快照加载失败:' + (e.message || e);
    }
  });

  container.querySelector('#fgpv-snap-del').addEventListener('click', () => {
    if (!curSceneId) return;
    const sel = container.querySelector('#fgpv-snaps');
    const s = state.scenes.find((x) => x.id === curSceneId);
    if (!s || !sel.value) return;
    const snap = (s.fguiSnapshots || []).find((x) => x.id === sel.value);
    if (!snap) return;
    confirmDialog({
      title: `移除快照记录「${snap.name}」?`,
      message: `仅从关联记录中移除,磁盘文件仍保留:<br><code>${escHtml(snap.path)}</code>`,
      onOk: () => {
        updateScene(curSceneId, { fguiSnapshots: (s.fguiSnapshots || []).filter((x) => x.id !== snap.id) });
        renderSnapBar();
        toast('已移除快照记录');
      },
    });
  });

  container.querySelector('#fgpv-snap-folder').addEventListener('click', async () => {
    const s = curSceneId ? state.scenes.find((x) => x.id === curSceneId) : null;
    const snaps = (s && s.fguiSnapshots) || [];
    if (!snaps.length) { toast('暂无快照', 'info'); return; }
    const dir = snaps[snaps.length - 1].path.replace(/[\\/][^\\/]+$/, '');
    window.api.openPath(dir);
  });

  // 编辑模式撤销快捷键 Ctrl+Z(全局,仅编辑模式下响应;页面重建时统一移除)
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && fguiPreview && fguiPreview.editMode) {
      e.preventDefault();
      undoBtn.click();
    }
  };
  fguiKeyHandler = onKey;
  window.addEventListener('keydown', onKey);
}

/**
 * 解压时复制图片素材(只复制"本包"图集的单图, 不复制整张图集, 避免大量重复文件):
 *  1) 共享素材库优先: <spriteLibDir>/<图集名>/ 目录中的单图 → <outDir>/<图集名>/
 *  2) 素材库未生成时回退: 复制整张图集 → <outDir>/<图集名>.png
 * 跨包引用的图集(不属于本包 ownAtlasKeys)一律不复制, 保持依赖关系由依赖包提供。
 * @param {object} payload buildPreviewData 结果(textures: atlasKey -> 整图集路径)
 * @param {string} outDir 解压输出目录
 * @param {{spriteLibDir?: string, ownAtlasKeys?: string[]}} res fguiExportSingle 返回
 * @returns {{count:number, fromLib:number, fromAtlas:number}}
 */
async function copySpritesToDir(payload, outDir, res = {}) {
  if (!payload || !payload.textures) return { count: 0, fromLib: 0, fromAtlas: 0 };
  const own = new Set(res.ownAtlasKeys || []);
  const restrict = own.size > 0; // 有本包图集清单时只复制本包图集
  let count = 0, fromLib = 0, fromAtlas = 0;
  for (const key of Object.keys(payload.textures)) {
    if (restrict && !own.has(key)) continue; // 跨包图集: 不复制(依赖包提供)
    const src = payload.textures[key];
    if (!src) continue;
    // ① 共享素材库优先
    if (res.spriteLibDir) {
      const libDir = joinPath(res.spriteLibDir, key);
      const dir = await window.api.listDir(libDir);
      if (dir && dir.ok && Array.isArray(dir.files) && dir.files.length) {
        const pngs = dir.files.filter((f) => !f.isDir && /\.png$/i.test(f.name));
        for (const f of pngs) {
          try {
            const r = await window.api.readBase64(joinPath(libDir, f.name));
            if (!r || !r.ok) continue;
            const dst = joinPath(joinPath(outDir, key), f.name);
            const wr = await window.api.writeFileBase64(dst, r.dataUrl);
            if (wr.ok) { count++; fromLib++; }
          } catch (e) { /* ignore */ }
        }
        continue;
      }
    }
    // ② 回退: 复制整张图集
    try {
      const r = await window.api.readBase64(src);
      if (!r || !r.ok) continue;
      const wr = await window.api.writeFileBase64(joinPath(outDir, key + '.png'), r.dataUrl);
      if (wr.ok) { count++; fromAtlas++; }
    } catch (e) { /* ignore */ }
  }
  return { count, fromLib, fromAtlas };
}

function joinPath(dir, name) {
  return dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + name;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 弹窗登记 FGUI 包到游戏场景管理的某目录;返回 scene.id 或 null(不登记)。
 * 供预览页加载 .bin 与「添加场景」识别到 FGUI 包时共用。
 * @param {string} binPath .bin 绝对路径
 * @param {{defaultCategoryId?: string, defaultName?: string}} opts 所属目录默认选中项 / 默认场景名称
 */
export function promptRegisterFgui(binPath, { defaultCategoryId = '', defaultName = '' } = {}) {
  return new Promise((resolve) => {
    const fallbackName = (binPath.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '') || '未命名';
    const name = defaultName || fallbackName;
    const catOptions = [{ value: '', label: '(未分类)' }];
    const pushCats = (list, depth) => {
      for (const c of list) {
        catOptions.push({ value: c.id, label: '　'.repeat(depth) + (depth ? '└ ' : '') + c.name });
        pushCats(getSceneCategoryChildren(c.id), depth + 1);
      }
    };
    pushCats(state.sceneCategories.filter((x) => !x.parentId), 0);
    promptDialog({
      title: '登记 FGUI 包到游戏场景管理',
      fields: [
        {
          key: 'mode', label: '登记方式', type: 'select',
          options: [
            { value: 'fgui', label: '登记为 FGUI 界面包(下次可从场景管理直接预览)' },
            { value: 'skip', label: '暂不登记(仅本次预览)' },
          ],
          value: 'fgui',
        },
        { key: 'categoryId', label: '所属目录', type: 'select', options: catOptions, value: defaultCategoryId || '' },
        { key: 'name', label: '场景名称', type: 'text', value: name },
      ],
      onOk: (v) => {
        if (v.mode !== 'fgui') return resolve(null);
        const finalName = (v.name || '').trim() || name;
        const sc = addScene({
          categoryId: v.categoryId || '',
          name: finalName,
          filePath: binPath,
          type: 'file',
          subtype: 'fgui',
        });
        // 异步补文件大小(供场景目录页显示,不阻塞登记)
        (async () => {
          try {
            const st = await window.api.statFile(binPath);
            if (st && st.size) updateScene(sc.id, { size: st.size, mtime: st.mtime });
          } catch (e) { /* ignore */ }
        })();
        resolve(sc.id);
      },
      onCancel: () => resolve(null),
    });
  });
}

/** 场景分类的完整路径名(含父级),如「背包 / 商店」;空或找不到 → 未分类 */
function sceneCategoryName(id) {
  if (!id) return '未分类';
  const parts = [];
  let cat = state.sceneCategories.find((c) => c.id === id);
  while (cat) {
    parts.unshift(cat.name);
    cat = cat.parentId ? state.sceneCategories.find((c) => c.id === cat.parentId) : null;
  }
  return parts.length ? parts.join(' / ') : '未分类';
}

function renderSceneCatInList(parent, cat, depth) {
  const scenes = scenesInCategory(cat.id);
  const children = getSceneCategoryChildren(cat.id);
  const row = document.createElement('div');
  row.className = 'cat-row' + (depth ? ' sub' : '');
  row.style.paddingLeft = (depth * 14 + 8) + 'px';
  row.innerHTML = `<span class="cat-row-arrow">▣</span><span class="cat-row-name">${escHtml(cat.name)}</span><span class="cat-row-count">${scenes.length}</span>`;
  // 行级 onClick 通过 _onOpenCat / _onOpenUncat 暴露(由 renderSceneHome 在外层设)
  row.addEventListener('click', () => {
    if (parent._onOpenCat) parent._onOpenCat(cat.id);
  });
  parent.appendChild(row);
  for (const ch of children) renderSceneCatInList(parent, ch, depth + 1);
}

/** 场景目录列表页:展示该分类(含子分类递归)下所有场景 */
export function renderSceneFolderPage(container, { catId, actions }) {
  if (!container) return;
  const cat = catId ? state.sceneCategories.find((c) => c.id === catId) : null;
  const catName = cat ? cat.name : (catId === '' ? '未分类' : '场景');
  const scenes = catId ? scenesInCategory(catId) : state.scenes;
  const children = catId ? getSceneCategoryChildren(catId) : [];

  container.innerHTML = `
    <div class="folder-toolbar">
      <button class="btn sm" id="sf-back" title="返回场景主页">← 场景主页</button>
      <span class="folder-title">${escHtml(catName)}</span>
      <span class="res-count">${scenes.length} 个场景</span>
      <div class="folder-toolbar-spacer"></div>
      <button class="btn" id="sf-add-scene">+ 添加场景</button>
      <button class="btn" id="sf-add-fgui" title="批量添加 FGUI 包:单选/多选 .bin 文件或目录(目录内扫描,可选递归)">🧩 添加FGUI包</button>
      <button class="btn sm" id="sf-add-subcat">+ 新建子目录</button>
    </div>
    <div class="scene-folder-body">
      ${children.length ? `<div class="sf-subcats" id="sf-subcats"></div>` : ''}
      <div class="sf-list" id="sf-list"></div>
    </div>
  `;
  if (children.length) {
    const subEl = container.querySelector('#sf-subcats');
    for (const ch of children) {
      const card = document.createElement('div');
      card.className = 'sf-subcat-card';
      card.innerHTML = `<span class="subcat-folder">📁</span><span class="subcat-name">${escHtml(ch.name)}</span><span class="subcat-count">${scenesInCategory(ch.id).length}</span>`;
      card.addEventListener('click', (e) => actions.onCatMenu ? actions.onCatMenu(ch, e) : null);
      card.addEventListener('dblclick', () => {
        // 双击进入子分类
        const evt = new CustomEvent('open-subcat', { detail: ch.id });
        container.dispatchEvent(evt);
      });
      subEl.appendChild(card);
    }
    // 双击进入子分类 → 由 ui.js 处理(此处改为派发事件,ui.js 可在 renderSceneFolderPage 之后接住)
    container.addEventListener('open-subcat', (e) => {
      // 重新渲染到子分类页
      renderSceneFolderPage(container, { catId: e.detail, actions });
    }, { once: true });
  }
  // 场景列表
  const listEl = container.querySelector('#sf-list');
  if (!scenes.length) {
    listEl.innerHTML = '<div class="empty-tip" style="padding:40px;text-align:center;color:var(--text2)">还没有场景。点击「+ 添加场景」开始。</div>';
  } else {
    const table = document.createElement('div');
    table.className = 'scene-table';
    table.innerHTML = `
      <div class="scene-tr scene-th">
        <div class="scene-td scene-ico"></div>
        <div class="scene-td scene-name-col">名称</div>
        <div class="scene-td scene-path-col">路径</div>
        <div class="scene-td scene-size-col">大小</div>
        <div class="scene-td scene-op-col">操作</div>
      </div>
    `;
    for (const s of scenes) {
      const row = document.createElement('div');
      row.className = 'scene-tr';
      row.innerHTML = `
        <div class="scene-td scene-ico">${s.type === 'folder' ? '📁' : (s.subtype === 'fgui' ? '🧩' : '📄')}</div>
        <div class="scene-td scene-name-col" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
        <div class="scene-td scene-path-col" title="${escHtml(s.filePath)}">${escHtml(s.filePath)}</div>
        <div class="scene-td scene-size-col">${s.size ? fmtSize(s.size) : '—'}</div>
        <div class="scene-td scene-op-col">
          ${s.subtype === 'fgui' ? `<button class="icon-btn" data-act="fgui" title="打开 FGUI 界面预览">🧩</button>` : ''}
          <button class="icon-btn" data-act="show" title="在文件管理器中显示">📂</button>
          <button class="icon-btn" data-act="open" title="打开">▶</button>
          <button class="icon-btn" data-act="edit" title="编辑">✎</button>
          <button class="icon-btn" data-act="move" title="移动到其他分类">↗</button>
          <button class="icon-btn danger" data-act="del" title="删除">✕</button>
        </div>
      `;
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (btn) {
          const act = btn.dataset.act;
          if (act === 'fgui') actions.onFguiPreview && actions.onFguiPreview(s.id);
          else if (act === 'show') actions.onShowInFolder(s.filePath);
          else if (act === 'open') actions.onOpenPath(s.filePath);
          else if (act === 'edit') actions.onEditScene(s.id);
          else if (act === 'move') actions.onMoveScene(s.id);
          else if (act === 'del') actions.onRemoveScene(s.id);
          return;
        }
        // 行内点击(非按钮):FGUI 包直接打开预览
        if (s.subtype === 'fgui' && actions.onFguiPreview) actions.onFguiPreview(s.id);
      });
      table.appendChild(row);
    }
    listEl.appendChild(table);
  }
  // FGUI 条目大小补全:早期登记未记录 size 的,惰性 stat 后重渲染显示
  const sizeMiss = scenes.filter((s) => s.subtype === 'fgui' && !s.size);
  if (sizeMiss.length) {
    (async () => {
      let changed = false;
      for (const s of sizeMiss) {
        try {
          const st = await window.api.statFile(s.filePath);
          if (st && st.size && st.size > 0) { updateScene(s.id, { size: st.size, mtime: st.mtime }); changed = true; }
        } catch (e) { /* ignore */ }
      }
      if (changed) renderSceneFolderPage(container, { catId, actions });
    })();
  }
  // 顶部按钮
  container.querySelector('#sf-back').addEventListener('click', () => {
    // 派发事件:返回场景主页(由 ui.js 处理)
    container.dispatchEvent(new CustomEvent('back-home'));
  });
  // 派发 back-home 给 ui.js 处理
  container.addEventListener('back-home', () => {
    // 通过 actions 触发 ui.js 侧栏根节点点击效果:由 ui.js 在 renderSceneFolderPage 后注册 back-home 监听
    if (actions.onBackHome) actions.onBackHome();
  }, { once: true });

  container.querySelector('#sf-add-scene').addEventListener('click', () => actions.onAddScene(catId));
  container.querySelector('#sf-add-fgui')?.addEventListener('click', () => actions.onAddFguiPackages && actions.onAddFguiPackages(catId));
  container.querySelector('#sf-add-subcat')?.addEventListener('click', () => actions.onAddCategory(catId));
}

function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}