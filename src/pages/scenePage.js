// 游戏场景管理页面
// 包含两个视图:场景主页(汇总 + 分类入口) 与 场景目录列表页(某分类下的场景条目 + 操作)。

import {
  state,
  addScene, addSceneCategory, updateScene, removeScene,
  getSceneCategoryChildren, scenesInCategory,
} from '../state.js';
import { toast, showContextMenu, confirmDialog, promptDialog } from '../dialogs.js';

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** 场景主页:统计 + 分类入口 + 场景总数 */
export function renderSceneHome(container, { onOpenCat, onAddScene, onAddCategory, onRefresh }) {
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
        <div class="stat-card scene-card-cat"><span class="stat-num">${cats.length}</span><span class="stat-label">分类数</span></div>
      </div>
      <div class="scene-actions">
        <button class="btn primary" id="sc-add-scene">+ 添加场景</button>
        <button class="btn" id="sc-add-cat">+ 新建分类</button>
        <button class="btn sm" id="sc-refresh">刷新</button>
      </div>
      <div class="scene-cats">
        <div class="section-title">📁 场景分类</div>
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
    treeEl.innerHTML = '<div class="empty-tip">还没有分类,点击上方「+ 新建分类」开始。</div>';
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
        <span class="rec-ico">${s.type === 'folder' ? '📁' : '📄'}</span>
        <span class="rec-name" title="${escHtml(s.filePath)}">${escHtml(s.name)}</span>
        <span class="rec-path" title="${escHtml(s.filePath)}">${escHtml(s.filePath)}</span>
      `;
      row.addEventListener('click', () => {
        showContextMenu(window.innerWidth - 240, 120, [
          { label: '在文件管理器中显示', onClick: () => window.api.showItem(s.filePath) },
          { label: '打开', onClick: () => window.api.openPath(s.filePath) },
          { label: '编辑场景信息', onClick: () => promptDialog({ title: '编辑场景名称', defaultValue: s.name, onOk: (n) => { if (n) updateScene(s.id, { name: n }); onRefresh(); } }) },
          { label: '删除', danger: true, onClick: () => confirmDialog({ title: `删除「${s.name}」?`, message: '仅从列表移除,不会删除磁盘内容。', onOk: () => { removeScene(s.id); onRefresh(); } }) },
        ]);
      });
      recentEl.appendChild(row);
    }
  }

  container.querySelector('#sc-add-scene').addEventListener('click', () => onAddScene(''));
  container.querySelector('#sc-add-cat').addEventListener('click', () => onAddCategory(''));
  container.querySelector('#sc-refresh').addEventListener('click', onRefresh);
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
      <button class="btn sm" id="sf-add-subcat">+ 新建子分类</button>
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
        <div class="scene-td scene-ico">${s.type === 'folder' ? '📁' : '📄'}</div>
        <div class="scene-td scene-name-col" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
        <div class="scene-td scene-path-col" title="${escHtml(s.filePath)}">${escHtml(s.filePath)}</div>
        <div class="scene-td scene-size-col">${s.size ? fmtSize(s.size) : '—'}</div>
        <div class="scene-td scene-op-col">
          <button class="icon-btn" data-act="show" title="在文件管理器中显示">📂</button>
          <button class="icon-btn" data-act="open" title="打开">▶</button>
          <button class="icon-btn" data-act="edit" title="编辑">✎</button>
          <button class="icon-btn" data-act="move" title="移动到其他分类">↗</button>
          <button class="icon-btn danger" data-act="del" title="删除">✕</button>
        </div>
      `;
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'show') actions.onShowInFolder(s.filePath);
        else if (act === 'open') actions.onOpenPath(s.filePath);
        else if (act === 'edit') actions.onEditScene(s.id);
        else if (act === 'move') actions.onMoveScene(s.id);
        else if (act === 'del') actions.onRemoveScene(s.id);
      });
      table.appendChild(row);
    }
    listEl.appendChild(table);
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
  container.querySelector('#sf-add-subcat')?.addEventListener('click', () => actions.onAddCategory(catId));
}

function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}