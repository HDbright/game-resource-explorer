// ============ UI 渲染与交互 ============

import {
  state, setSetting, itemById, categoryById,
  addCategory, updateCategory, removeCategory, removeCategoryAdvanced,
  getCategoryChildren, isCategoryDescendant, getCategoryDescendants, categoryPath,
  updateItem, removeItem,
  reorderCategory,
  addFavCategory, updateFavCategory, removeFavCategory,
  addFavItem, removeFavItem, moveFavItem,
  reorderFavCategory,
  favLocations, isFavored,
  TYPE_LABEL, typeGroup, formatSize,
  getCategoryPathList, getFolderData,
  setResourceTab, setListViewMode, setListSort,
} from './state.js';
import { openModal, footButtons, confirmDialog, promptDialog, toast, showContextMenu } from './dialogs.js';
import { runAddFlow } from './addFlow.js';
import { renderHomePage } from './pages/homePage.js';
import { renderFolderPage } from './pages/folderPage.js';
import { ImageViewerController } from './viewers/imageViewer.js';
import { AudioViewerController } from './viewers/audioViewer.js';
import { thumbnailService } from './thumbnails.js';

let currentCategoryId = 'all';
let searchText = '';
let preview = null;
let imageViewer = null;
let audioViewer = null;
let lastFolderTab = 'anim'; // 进入预览前所在 tab,返回时恢复
let editModeActive = false; // 目录列表页编辑模式开关
const editSelected = new Set(); // 编辑模式下选中的资源 id

export function initUI(pv) {
  preview = pv;
  // 需求:默认不展开任何分类/子目录(仅展开收藏夹根,以显示收藏分类)
  expandedCats.add('__fav__');
  state.favCategories.forEach((c) => expandedCats.add('fav:' + c.id));
  // 侧栏隐藏状态记忆(同步顶栏「资源树」按钮图标)
  if (localStorage.getItem('sidebarHidden') === '1') {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('hidden');
  }
  syncTreeToggleIcon();
  // 图片 / 音频查看器
  imageViewer = new ImageViewerController();
  const imgWrap = document.getElementById('pv-image-view');
  if (imgWrap) imageViewer.init(imgWrap);
  audioViewer = new AudioViewerController();
  const audioWrap = document.getElementById('pv-audio-view');
  if (audioWrap) audioViewer.init({
    audio: document.getElementById('audio-el'),
    playBtn: document.getElementById('audio-play'),
    progress: document.getElementById('audio-progress'),
    volume: document.getElementById('audio-volume'),
    timeEl: document.getElementById('audio-time'),
    nameEl: document.getElementById('audio-name'),
    pathEl: document.getElementById('audio-path'),
  });
  bindToolbar();
  bindList();
  bindPreviewControls();
  bindTabs();
  bindBrandHome();
  bindBreadcrumb();
  bindFolderToolbar();
  bindPreviewPageNav();
  renderCategories();
  renderMainArea();
}

// ---------------- 资源树(分类 + 条目合并) ----------------

const expandedCats = new Set(); // 展开的分类 id('all' / '' / 分类id)

let dragCatId = null;    // 当前拖拽中的分类 id
let dragItemId = null;   // 当前拖拽中的条目 id
let dragKind = null;     // 拖拽源类型:'cat'(分类) | 'favcat'(收藏分类) | 'item'(动画条目)
let lastDragAt = 0;      // 上次拖拽结束时间(避免拖拽后误触发 click)

/** 清理所有拖拽视觉标记 */
function clearDropMarkers() {
  document.querySelectorAll('.cat-node.dragging, .cat-node.drop-before, .cat-node.drop-after')
    .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
}

/** 当前 tab 对应的资源分组(null = home/all 全类型) */
function currentGroup() {
  const tab = (state.settings && state.settings.resourceTab) || 'home';
  if (tab === 'home' || tab === 'all') return null;
  return tab; // 'anim' | 'image' | 'audio' | '3d'
}

/** 树内条目过滤(搜索 + 分组);按显示名称排序(添加新动画后列表按名称归位) */
function filteredItems() {
  let items = [...state.items];
  const group = currentGroup();
  if (group) items = items.filter((i) => typeGroup(i.type) === group);
  if (searchText) {
    const q = searchText.toLowerCase();
    items = items.filter(
      (i) => i.displayName.toLowerCase().includes(q) || (i.remark || '').toLowerCase().includes(q)
    );
  }
  return items.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
}

function itemsForCat(catId) {
  const all = filteredItems();
  if (catId === 'all') return all;
  if (catId === '') return all.filter((i) => !i.categoryId);
  return all.filter((i) => i.categoryId === catId);
}

export function renderCategories(selectId = currentCategoryId) {
  currentCategoryId = selectId;
  renderTree();
}

/** 兼容旧调用(条目变化时刷新树) */
export function renderItems() {
  renderTree();
}

function renderTree() {
  const tree = document.getElementById('cat-tree');
  if (!tree) return;
  tree.innerHTML = '';

  // 搜索时自动展开所有分类
  if (searchText) {
    expandedCats.add('all');
    state.categories.forEach((c) => expandedCats.add(c.id));
  }

  // 收藏夹区块(置顶)
  renderFavSection(tree);

  // 「全部 XX」伪节点(含未分类等历史条目;名称随 tab 变化,是当前类型主页链接)
  const allName = { anim: '全部动画', image: '全部图片', audio: '全部音频', '3d': '全部3D', home: '全部资源' }[currentGroup() || 'home'];
  renderPseudoNode(tree, { id: 'all', icon: '▦', name: allName });

  // 「未分类」节点按需显示:存在未分类动画时才展示
  const uncatCount = filteredItems().filter((i) => !i.categoryId).length;
  if (uncatCount > 0) {
    renderPseudoNode(tree, { id: '', icon: '○', name: '未分类' });
  }

  // 分类树(递归,顶级分类按数组顺序)
  for (const c of getCategoryChildren('')) {
    renderCatNode(tree, c, 0);
  }
}

/** 伪节点(全部XX = 当前类型主页链接;未分类 = 可展开) */
function renderPseudoNode(tree, n) {
  const items = itemsForCat(n.id);
  const isOpen = expandedCats.has(n.id);
  const hasItems = items.length > 0;
  const isAll = n.id === 'all';

  const node = document.createElement('div');
  node.className = 'cat-node' + (n.id === currentCategoryId ? ' active' : '');
  node.dataset.id = n.id;

  const arrow = document.createElement('span');
  arrow.className = 'cat-arrow';
  // 「全部XX」作为类型主页链接,不展示展开箭头
  arrow.textContent = isAll ? '→' : (hasItems ? (isOpen ? '▼' : '▶') : '·');
  node.appendChild(arrow);

  const icon = document.createElement('span');
  icon.className = 'cat-icon';
  icon.textContent = n.icon;
  node.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'cat-name';
  name.textContent = n.name;
  node.appendChild(name);

  const count = document.createElement('span');
  count.className = 'cat-count';
  count.textContent = items.length;
  node.appendChild(count);

  // 箭头:点击切换展开/折叠(不触发选中);「全部XX」无展开箭头
  if (!isAll) {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastDragAt < 300) return;
      if (hasItems) {
        if (expandedCats.has(n.id)) expandedCats.delete(n.id);
        else expandedCats.add(n.id);
        renderTree();
      }
    });
  }

  node.addEventListener('click', () => {
    if (Date.now() - lastDragAt < 300) return;
    currentCategoryId = n.id;
    setSetting('lastCategoryId', n.id);
    if (isAll) {
      // 类型主页链接:不展开树内条目,右侧切到当前类型主页(全部资源列表页)
      const tab = (state.settings && state.settings.resourceTab) || 'home';
      if (tab === 'home') setResourceTab(lastFolderTab || 'anim');
      else setResourceTab(tab);
      lastFolderTab = state.settings.resourceTab;
      renderTree();
      renderMainArea();
      syncTabs();
      return;
    }
    // 未分类伪节点:点名称只选中,右侧切换为目录列表页(不展开)
    if ((state.settings.resourceTab || 'home') === 'home') {
      setResourceTab(lastFolderTab || 'anim');
    }
    renderTree();
    renderMainArea();
    syncTabs();
  });

  tree.appendChild(node);

  if (!isAll && isOpen && hasItems) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-items';
    for (const it of items) wrap.appendChild(renderItemNode(it));
    tree.appendChild(wrap);
  }
}

/** 递归渲染分类节点(子分类 + 直属条目) */
function renderCatNode(parent, cat, depth) {
  const items = itemsForCat(cat.id);
  const children = getCategoryChildren(cat.id);
  const hasChildren = children.length > 0;
  const isOpen = expandedCats.has(cat.id);

  const node = document.createElement('div');
  node.className = 'cat-node' + (cat.id === currentCategoryId ? ' active' : '');
  node.dataset.id = cat.id;
  node.style.paddingLeft = 8 + depth * 14 + 'px';

  const arrow = document.createElement('span');
  arrow.className = 'cat-arrow';
  arrow.textContent = (hasChildren || items.length > 0) ? (isOpen ? '▼' : '▶') : '·';
  node.appendChild(arrow);

  const icon = document.createElement('span');
  icon.className = 'cat-icon';
  icon.textContent = '▣';
  node.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'cat-name';
  name.textContent = cat.name;
  name.title = cat.remark || cat.name;
  node.appendChild(name);

  const count = document.createElement('span');
  count.className = 'cat-count';
  count.textContent = items.length;
  node.appendChild(count);

  const ops = document.createElement('span');
  ops.className = 'cat-ops';
  const favBtn = document.createElement('button');
  favBtn.className = 'icon-btn fav-btn';
  const allFav = items.length > 0 && items.every((i) => isFavored(i.id));
  favBtn.textContent = allFav ? '★' : '☆';
  favBtn.title = allFav ? '整个分类已收藏(点击可收藏到其他位置)' : '收藏整个分类到收藏夹';
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (items.length === 0) return toast('该分类下没有动画', 'error');
    collectTargetDialog(items.map((i) => i.id));
  });
  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✎';
  editBtn.title = '编辑分类';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCategoryDialog(cat.id); });
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = '删除分类';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCategoryDialog(cat.id); });
  ops.appendChild(favBtn);
  ops.appendChild(editBtn);
  ops.appendChild(delBtn);
  node.appendChild(ops);

  // ---- 右键菜单:新建子类别 / 编辑 / 移动... / 删除 ----
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCategoryMenu(e.clientX, e.clientY, cat);
  });

  // ---- 分类拖拽排序(仅同父分类之间) ----
  node.draggable = true;
  node.dataset.dragId = cat.id;
  node.addEventListener('dragstart', (e) => {
    dragCatId = cat.id;
    dragKind = 'cat';
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', cat.id); } catch (err) { /* ignore */ }
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragCatId = null;
    dragKind = null;
    lastDragAt = Date.now();
    clearDropMarkers();
  });
  node.addEventListener('dragover', (e) => {
    if (!dragCatId && !dragItemId) return;
    if (dragKind === 'favcat') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = node.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (dragKind === 'item') {
      // 动画条目 → 整个分类节点作为放入目标
      node.classList.toggle('drop-in', true);
      return;
    }
    if (dragKind === 'cat') {
      if (dragCatId === cat.id) return;
      const src = categoryById(dragCatId);
      if (!src || isCategoryDescendant(dragCatId, cat.id)) return; // 不能拖到自己的子孙下
      const before = y < h / 3;
      const after = y > (h * 2) / 3;
      node.classList.toggle('drop-before', before && (src.parentId || '') === (cat.parentId || ''));
      node.classList.toggle('drop-after', after && (src.parentId || '') === (cat.parentId || ''));
      node.classList.toggle('drop-in', !before && !after && (src.parentId || '') !== cat.id);
    }
  });
  node.addEventListener('dragleave', () => {
    node.classList.remove('drop-before', 'drop-after', 'drop-in');
  });
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drop-before', 'drop-after', 'drop-in');
    const rect = node.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    // 动画条目 → 移动到该分类
    if (dragKind === 'item' && dragItemId) {
      const moved = (itemById(dragItemId)?.categoryId || '') !== cat.id;
      updateItem(dragItemId, { categoryId: cat.id });
      dragItemId = null;
      dragKind = null;
      lastDragAt = Date.now();
      renderTree();
      toast(moved ? '动画已移动到「' + cat.name + '」' : '动画已在「' + cat.name + '」中');
      return;
    }

    // 分类 → 中部:放入该分类下作子分类;边缘:同级排序
    if (dragKind === 'cat' && dragCatId && dragCatId !== cat.id) {
      const src = categoryById(dragCatId);
      if (src && !isCategoryDescendant(dragCatId, cat.id)) {
        const before = y < h / 3;
        const after = y > (h * 2) / 3;
        if (!before && !after) {
          // 中部:作为子分类
          if ((src.parentId || '') !== cat.id) {
            updateCategory(dragCatId, { parentId: cat.id });
            expandedCats.add(cat.id);
            toast('已移动到「' + cat.name + '」下');
          }
        } else if ((src.parentId || '') === (cat.parentId || '')) {
          reorderCategory(dragCatId, cat.id, before ? 'before' : 'after');
          toast('分类顺序已更新');
        }
      }
      dragCatId = null;
      dragKind = null;
      lastDragAt = Date.now();
      renderTree();
      return;
    }
    dragCatId = null;
    dragItemId = null;
    dragKind = null;
  });

  // 箭头:单独点击只切换展开/折叠(不触发选中)
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() - lastDragAt < 300) return;
    if (hasChildren || items.length > 0) {
      if (expandedCats.has(cat.id)) expandedCats.delete(cat.id);
      else expandedCats.add(cat.id);
      renderTree();
    }
  });

  node.addEventListener('click', () => {
    if (Date.now() - lastDragAt < 300) return; // 拖拽刚结束时忽略误触点击
    // 需求:点目录名只选中,右侧切换为目录列表页(不展开/折叠)
    currentCategoryId = cat.id;
    setSetting('lastCategoryId', cat.id);
    if ((state.settings.resourceTab || 'home') === 'home') {
      setResourceTab(lastFolderTab || 'anim');
    }
    renderTree();
    renderMainArea();
  });

  parent.appendChild(node);

  // 展开区:子分类在前,直属条目在后
  if (isOpen && (hasChildren || items.length > 0)) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-items';
    for (const ch of children) renderCatNode(wrap, ch, depth + 1);
    for (const it of items) wrap.appendChild(renderItemNode(it));
    parent.appendChild(wrap);
  }
}

/** 分类右键菜单 */
function openCategoryMenu(x, y, cat) {
  showContextMenu(x, y, [
    { label: '添加资源', onClick: () => runAddFlow(false, cat.id) },
    { label: '批量添加', onClick: () => runAddFlow(true, cat.id) },
    { label: '新建子类别', onClick: () => newSubCategoryDialog(cat) },
    { label: '编辑分类', onClick: () => editCategoryDialog(cat.id) },
    { label: '移动...', onClick: () => moveCategoryDialog(cat) },
    { label: '删除', danger: true, onClick: () => deleteCategoryDialog(cat.id) },
  ]);
}

/** 新建子类别 */
function newSubCategoryDialog(parent) {
  promptDialog({
    title: '新建子类别',
    fields: [{ key: 'name', label: '子类别名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!name) return toast('子类别名称不能为空', 'error');
      addCategory({ name, remark: '', parentId: parent.id });
      expandedCats.add(parent.id);
      renderCategories();
      renderMainArea();
      toast(`已创建子类别「${name}」`);
    },
  });
}

/** 移动分类到其它分类下(或顶级) */
function moveCategoryDialog(cat) {
  // 候选:顶级 + 其它非自身/非子孙分类
  const exclude = new Set([cat.id, ...getCategoryDescendants(cat.id)]);
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = `<span class="ro">将分类「<b>${esc(cat.name)}</b>」移动到:</span>`;
  body.appendChild(tip);

  const list = document.createElement('div');
  list.className = 'fav-pick-list';
  let checked = false;
  const pick = (value, label) => {
    const lb = document.createElement('label');
    lb.className = 'fav-pick-item';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'movecat';
    rb.value = value;
    if (!checked) { rb.checked = true; checked = true; }
    const sp = document.createElement('span');
    sp.textContent = label;
    lb.appendChild(rb);
    lb.appendChild(sp);
    list.appendChild(lb);
  };
  pick('', '移至顶级(不作为子分类)');
  for (const c of state.categories) {
    if (exclude.has(c.id)) continue;
    pick(c.id, categoryPath(c.id));
  }
  body.appendChild(list);

  const { close } = openModal({
    title: '移动分类',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '确定',
        cls: 'primary',
        onClick: () => {
          const selected = list.querySelector('input:checked');
          if (!selected) return;
          const target = selected.value;
          updateCategory(cat.id, { parentId: target });
          close();
          if (target) expandedCats.add(target);
          renderCategories();
          renderMainArea();
          toast('分类已移动');
        },
      },
    ]),
  });
}

// ================= 收藏夹 =================

function renderFavSection(tree) {
  const isOpen = expandedCats.has('__fav__');
  const favItems = state.favItems;
  const total = favItems.length;

  const node = document.createElement('div');
  node.className = 'cat-node fav-root';
  node.dataset.id = '__fav__';
  const arrow = document.createElement('span');
  arrow.className = 'cat-arrow';
  arrow.textContent = total > 0 ? (isOpen ? '▼' : '▶') : '·';
  node.appendChild(arrow);
  const icon = document.createElement('span');
  icon.className = 'cat-icon fav-icon';
  icon.textContent = '🔖';
  node.appendChild(icon);
  const name = document.createElement('span');
  name.className = 'cat-name';
  name.textContent = '收藏夹';
  node.appendChild(name);
  const count = document.createElement('span');
  count.className = 'cat-count';
  count.textContent = total;
  node.appendChild(count);
  const ops = document.createElement('span');
  ops.className = 'cat-ops';
  const addBtn = document.createElement('button');
  addBtn.className = 'icon-btn';
  addBtn.textContent = '＋';
  addBtn.title = '新建收藏分类';
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); newFavCategoryDialog(); });
  ops.appendChild(addBtn);
  node.appendChild(ops);
  node.addEventListener('click', () => {
    if (expandedCats.has('__fav__')) expandedCats.delete('__fav__');
    else expandedCats.add('__fav__');
    renderTree();
  });
  tree.appendChild(node);

  if (!isOpen) return;

  // 收藏分类目录
  for (const fc of state.favCategories) {
    const fcOpen = expandedCats.has('fav:' + fc.id);
    const fItems = favItems.filter((f) => f.favCategoryId === fc.id);
    const fcNode = document.createElement('div');
    fcNode.className = 'cat-node fav-cat';
    fcNode.dataset.id = 'fav:' + fc.id;
    const fcArrow = document.createElement('span');
    fcArrow.className = 'cat-arrow';
    fcArrow.textContent = fItems.length ? (fcOpen ? '▼' : '▶') : '·';
    fcNode.appendChild(fcArrow);
    const fcIcon = document.createElement('span');
    fcIcon.className = 'cat-icon';
    fcIcon.textContent = '📁';
    fcNode.appendChild(fcIcon);
    const fcName = document.createElement('span');
    fcName.className = 'cat-name';
    fcName.textContent = fc.name;
    fcNode.appendChild(fcName);
    const fcCount = document.createElement('span');
    fcCount.className = 'cat-count';
    fcCount.textContent = fItems.length;
    fcNode.appendChild(fcCount);
    const fcOps = document.createElement('span');
    fcOps.className = 'cat-ops';
    const fcEdit = document.createElement('button');
    fcEdit.className = 'icon-btn';
    fcEdit.textContent = '✎';
    fcEdit.title = '编辑收藏分类';
    fcEdit.addEventListener('click', (e) => { e.stopPropagation(); editFavCategoryDialog(fc.id); });
    const fcDel = document.createElement('button');
    fcDel.className = 'icon-btn danger';
    fcDel.textContent = '✕';
    fcDel.title = '删除收藏分类';
    fcDel.addEventListener('click', (e) => { e.stopPropagation(); deleteFavCategoryDialog(fc.id); });
    fcOps.appendChild(fcEdit);
    fcOps.appendChild(fcDel);
    fcNode.appendChild(fcOps);

    // ---- 收藏分类拖拽排序(仅在收藏分类之间) ----
    fcNode.draggable = true;
    fcNode.dataset.dragId = 'fav:' + fc.id;
    fcNode.addEventListener('dragstart', (e) => {
      dragCatId = fc.id;
      dragKind = 'favcat';
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', fc.id); } catch (err) { /* ignore */ }
      fcNode.classList.add('dragging');
    });
    fcNode.addEventListener('dragend', () => {
      dragCatId = null;
      dragKind = null;
      lastDragAt = Date.now();
      clearDropMarkers();
    });
    fcNode.addEventListener('dragover', (e) => {
      if (dragKind !== 'favcat' || dragCatId === fc.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = fcNode.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      fcNode.classList.toggle('drop-before', before);
      fcNode.classList.toggle('drop-after', !before);
    });
    fcNode.addEventListener('dragleave', () => {
      fcNode.classList.remove('drop-before', 'drop-after');
    });
    fcNode.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragKind !== 'favcat' || dragCatId === fc.id) return;
      const rect = fcNode.getBoundingClientRect();
      const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      fcNode.classList.remove('drop-before', 'drop-after');
      reorderFavCategory(dragCatId, fc.id, place);
      dragCatId = null;
      dragKind = null;
      lastDragAt = Date.now();
      renderTree();
      toast('收藏分类顺序已更新');
    });

    fcNode.addEventListener('click', () => {
      if (Date.now() - lastDragAt < 300) return; // 拖拽刚结束时忽略误触点击
      if (expandedCats.has('fav:' + fc.id)) expandedCats.delete('fav:' + fc.id);
      else expandedCats.add('fav:' + fc.id);
      renderTree();
    });
    tree.appendChild(fcNode);
    if (fcOpen) {
      const wrap = document.createElement('div');
      wrap.className = 'tree-items';
      for (const f of fItems) tree.appendChild(renderFavItemNode(f));
      tree.appendChild(wrap);
    }
  }
  // 注:「未分类收藏」节点已隐藏(收藏目标选择也移除了该选项)
}

/** 渲染普通条目节点(含收藏标记) */
function renderItemNode(it) {
  const row = document.createElement('div');
  row.className = 'item-node' + (preview.currentItemId === it.id ? ' active' : '');
  row.dataset.id = it.id;

  const badge = document.createElement('span');
  badge.className = 'type-badge ' + it.type;
  badge.textContent = TYPE_LABEL[it.type] || it.type;
  row.appendChild(badge);

  const nm = document.createElement('span');
  nm.className = 'ic-name';
  nm.textContent = it.displayName;
  nm.title = it.displayName;
  row.appendChild(nm);

  // 已收藏:常显 ★ 标记 + hover 提示位置
  if (isFavored(it.id)) {
    const star = document.createElement('span');
    star.className = 'fav-mark';
    star.textContent = '★';
    star.title = '已收藏到: ' + favLocations(it.id).join('、');
    row.appendChild(star);
  }

  const ops = document.createElement('span');
  ops.className = 'ic-ops';
  const favBtn = document.createElement('button');
  favBtn.className = 'icon-btn' + (isFavored(it.id) ? ' fav-on' : '');
  favBtn.textContent = isFavored(it.id) ? '★' : '☆';
  favBtn.title = isFavored(it.id)
    ? '收藏于: ' + favLocations(it.id).join('、') + ' (点击收藏到其他位置)'
    : '收藏到收藏夹';
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    collectTargetDialog([it.id]);
  });
  const playBtn = document.createElement('button');
  playBtn.className = 'icon-btn';
  playBtn.textContent = '▶';
  playBtn.title = '预览';
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); selectItem(it.id); });
  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✎';
  editBtn.title = '编辑名称/备注';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); editItemDialog(it.id); });
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = '删除';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteItemDialog(it.id); });
  ops.appendChild(favBtn);
  ops.appendChild(playBtn);
  ops.appendChild(editBtn);
  ops.appendChild(delBtn);
  row.appendChild(ops);

  // ---- 条目右键菜单:播放 / 打开目录 / 编辑 / 移动到... / 删除 / 属性 ----
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openItemMenu(e.clientX, e.clientY, it);
  });

  // ---- 条目拖拽:拖到分类节点上 = 移动到该分类 ----
  row.draggable = true;
  row.dataset.dragItemId = it.id;
  row.addEventListener('dragstart', (e) => {
    dragItemId = it.id;
    dragKind = 'item';
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', it.id); } catch (err) { /* ignore */ }
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    dragItemId = null;
    dragKind = null;
    lastDragAt = Date.now();
    clearDropMarkers();
  });

  row.addEventListener('click', () => {
    if (Date.now() - lastDragAt < 300) return;
    selectItem(it.id);
  });
  return row;
}

/** 条目右键菜单(按资源类型分支) */
function openItemMenu(x, y, it) {
  const firstLabel = it.type === 'image' ? '预览' : '播放';
  showContextMenu(x, y, [
    { label: firstLabel, onClick: () => selectItem(it.id) },
    { label: '打开目录', onClick: () => window.api.showItem(it.filePath) },
    { label: '编辑', onClick: () => editItemDialog(it.id) },
    { label: '移动到...', onClick: () => moveItemDialog(it) },
    { label: '删除', danger: true, onClick: () => deleteItemDialog(it.id) },
    { label: '属性', onClick: () => itemPropertiesDialog(it) },
  ]);
}

/** 移动动画到其它分类(或未分类) */
function moveItemDialog(it) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = `<span class="ro">将「<b>${esc(it.displayName)}</b>」移动到:</span>`;
  body.appendChild(tip);

  const list = document.createElement('div');
  list.className = 'fav-pick-list';
  let checked = false;
  const pick = (value, label) => {
    const lb = document.createElement('label');
    lb.className = 'fav-pick-item';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'moveitem';
    rb.value = value;
    if (!checked) { rb.checked = true; checked = true; }
    const sp = document.createElement('span');
    sp.textContent = label;
    lb.appendChild(rb);
    lb.appendChild(sp);
    list.appendChild(lb);
  };
  pick('', '未分类');
  for (const c of state.categories) {
    if (c.id === it.categoryId) continue;
    pick(c.id, categoryPath(c.id));
  }
  body.appendChild(list);

  const { close } = openModal({
    title: '移动动画',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '确定',
        cls: 'primary',
        onClick: () => {
          const selected = list.querySelector('input:checked');
          if (!selected) return;
          const target = selected.value;
          const moved = target !== (it.categoryId || '');
          updateItem(it.id, { categoryId: target });
          thumbnailService.invalidate(it.id);
          close();
          renderCategories();
          renderItems();
          renderMainArea();
          if (moved && preview.currentItemId === it.id) {
            preview.disposePlayer();
            hidePreviewBody();
          }
          toast('动画已移动');
        },
      },
    ]),
  });
}

/** 资源属性(只读) */
function itemPropertiesDialog(it) {
  const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');
  const catName = it.categoryId ? (categoryById(it.categoryId)?.name || '未分类') : '未分类';
  const body = document.createElement('div');
  body.className = 'modal-body';
  const rows = [
    ['名称', it.displayName],
    ['类型', TYPE_LABEL[it.type] || it.type],
    ['所属分类', catName],
    ['文件', it.filePath],
    ['大小', it.size != null ? formatSize(it.size) : '—'],
    ['修改时间', it.mtime ? fmt(it.mtime) : '—'],
    ['贴图集', it.atlasPath || '—'],
    ['备注', it.remark || '—'],
    ['创建时间', fmt(it.createdAt)],
    ['更新时间', fmt(it.updatedAt)],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'form-row';
    row.innerHTML = `<label class="f-label">${k}</label><span class="ro" style="flex:1;white-space:normal;word-break:break-all">${esc(v)}</span>`;
    body.appendChild(row);
  }
  const title = it.type === 'image' ? '图片属性' : it.type === 'audio' ? '音频属性' : '动画属性';
  openModal({ title, body, foot: footButtons([{ text: '关闭', cls: 'primary', onClick: (btn) => btn.closest('.modal-mask').remove() }]) });
}

/** 渲染收藏夹内的条目节点 */
function renderFavItemNode(f) {
  const it = itemById(f.itemId);
  const row = document.createElement('div');
  row.className = 'item-node' + (it && preview.currentItemId === it.id ? ' active' : '');
  row.dataset.id = f.id;

  const badge = document.createElement('span');
  badge.className = 'type-badge ' + (it ? it.type : 'spine');
  badge.textContent = it ? (TYPE_LABEL[it.type] || it.type) : 'DB';
  row.appendChild(badge);

  const nm = document.createElement('span');
  nm.className = 'ic-name';
  nm.textContent = it ? it.displayName : '(条目已删除)';
  nm.title = it ? it.displayName : '';
  row.appendChild(nm);

  const ops = document.createElement('span');
  ops.className = 'ic-ops';
  const moveBtn = document.createElement('button');
  moveBtn.className = 'icon-btn';
  moveBtn.textContent = '⇄';
  moveBtn.title = '移动到其他收藏分类';
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    collectTargetDialog([it ? it.id : null], { move: f });
  });
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = '取消收藏';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFavItem(f.itemId, f.favCategoryId);
    renderTree();
    toast('已取消收藏');
  });
  ops.appendChild(moveBtn);
  ops.appendChild(delBtn);
  row.appendChild(ops);

  if (it) row.addEventListener('click', () => selectItem(it.id));
  return row;
}

// ---------------- 收藏夹 对话框 ----------------

function newFavCategoryDialog() {
  promptDialog({
    title: '新建收藏分类',
    fields: [{ key: 'name', label: '分类名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!name) return toast('分类名称不能为空', 'error');
      addFavCategory({ name });
      expandedCats.add('__fav__');
      renderTree();
      toast('收藏分类已创建');
    },
  });
}

function editFavCategoryDialog(id) {
  const fc = state.favCategories.find((c) => c.id === id);
  if (!fc) return;
  promptDialog({
    title: '编辑收藏分类',
    fields: [{ key: 'name', label: '分类名称', type: 'text', value: fc.name }],
    onOk: ({ name }) => {
      if (!name) return toast('分类名称不能为空', 'error');
      updateFavCategory(id, { name });
      renderTree();
      toast('已更新');
    },
  });
}

function deleteFavCategoryDialog(id) {
  const fc = state.favCategories.find((c) => c.id === id);
  if (!fc) return;
  const n = state.favItems.filter((f) => f.favCategoryId === id).length;
  confirmDialog({
    title: '删除收藏分类',
    message: `确定删除收藏分类「<b>${esc(fc.name)}</b>」吗?<br/><br/>${n > 0 ? `其下 <b class="danger-text">${n}</b> 个收藏项将移到「未分类收藏」。` : '该分类下没有收藏。'}`,
    okText: '删除',
    danger: true,
    onOk: () => {
      removeFavCategory(id);
      renderTree();
      toast('收藏分类已删除');
    },
  });
}

/** 收藏/移动目标选择弹窗 */
function collectTargetDialog(itemIds, opts = {}) {
  const move = opts.move; // favItem 记录
  const ids = (itemIds || []).filter(Boolean);
  if (!ids.length && !move) return;

  let closeRef = null;
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = move
    ? `<span class="ro">将「${esc(itemById(move.itemId)?.displayName || '')}」移动到收藏分类</span>`
    : `<span class="ro">${ids.length > 1 ? `收藏 ${ids.length} 个动画到` : `将「${esc(itemById(ids[0])?.displayName || '')}」收藏到`}</span>`;
  body.appendChild(tip);

  const list = document.createElement('div');
  list.className = 'fav-pick-list';
  const pick = (id, label) => {
    const lb = document.createElement('label');
    lb.className = 'fav-pick-item';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'favpick';
    rb.value = id;
    if (!list.firstChild) rb.checked = true;
    const sp = document.createElement('span');
    sp.textContent = label;
    lb.appendChild(rb);
    lb.appendChild(sp);
    list.appendChild(lb);
  };
  // 「未分类收藏」选项已移除(收藏夹不再展示未分类收藏)
  for (const fc of state.favCategories) pick(fc.id, fc.name);
  if (state.favCategories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '还没有收藏分类,请在上方输入新收藏分类名创建。';
    list.appendChild(empty);
  }
  body.appendChild(list);

  const newRow = document.createElement('div');
  newRow.className = 'form-row';
  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.placeholder = '或直接输入新收藏分类名…';
  newRow.appendChild(newInput);
  body.appendChild(newRow);

  const { close } = openModal({
    title: move ? '移动收藏' : '收藏到收藏夹',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => closeRef && closeRef() },
      {
        text: '确定',
        cls: 'primary',
        onClick: () => {
          const selected = list.querySelector('input:checked');
          const custom = newInput.value.trim();
          // 必须选择收藏分类或输入新分类名(未分类收藏已不再展示)
          if (!selected && !custom) {
            toast('请选择收藏分类或输入新分类名', 'error');
            return;
          }
          const target = custom || selected.value;
          if (move) {
            if (custom) {
              const fc = addFavCategory({ name: custom });
              moveFavItem(move.id, fc.id);
            } else {
              moveFavItem(move.id, target);
            }
            toast('已移动收藏分类');
          } else {
            if (custom) {
              const fc = addFavCategory({ name: custom });
              for (const id of ids) addFavItem(id, fc.id);
            } else {
              for (const id of ids) addFavItem(id, target);
            }
            toast('已收藏');
          }
          closeRef && closeRef();
          expandedCats.add('__fav__');
          renderTree();
        },
      },
    ]),
  });
  closeRef = close;
}

export function newCategoryDialog() {
  promptDialog({
    title: '新建分类',
    fields: [
      { key: 'name', label: '分类名称', type: 'text', value: '' },
      { key: 'remark', label: '备注', type: 'text', value: '' },
    ],
    onOk: ({ name, remark }) => {
      if (!name) return toast('分类名称不能为空', 'error');
      addCategory({ name, remark });
      renderCategories();
      renderMainArea();
      toast('分类已创建');
    },
  });
}

function editCategoryDialog(id) {
  const cat = categoryById(id);
  if (!cat) return;
  promptDialog({
    title: '编辑分类',
    fields: [
      { key: 'name', label: '分类名称', type: 'text', value: cat.name },
      { key: 'remark', label: '备注', type: 'text', value: cat.remark || '' },
    ],
    onOk: ({ name, remark }) => {
      if (!name) return toast('分类名称不能为空', 'error');
      updateCategory(id, { name, remark });
      renderCategories();
      renderItems();
      renderMainArea();
      toast('分类已更新');
    },
  });
}

function deleteCategoryDialog(id) {
  const cat = categoryById(id);
  if (!cat) return;
  const subs = getCategoryChildren(id);
  const subDesc = getCategoryDescendants(id);
  const nItems = state.items.filter((i) => i.categoryId === id || subDesc.includes(i.categoryId)).length;
  const hasSubs = subs.length > 0;

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">将删除分类「<b>${esc(cat.name)}</b>」(${nItems} 个动画${hasSubs ? `,${subs.length} 个子类别` : ''}),请选择处理方式:</div>`;

  // 动画处理方式
  const animRow = document.createElement('div');
  animRow.className = 'form-row';
  const optDel = document.createElement('label');
  optDel.className = 'fav-pick-item';
  const rbDel = document.createElement('input');
  rbDel.type = 'radio';
  rbDel.name = 'delcat-anim';
  rbDel.value = 'delete';
  optDel.appendChild(rbDel);
  optDel.appendChild(document.createTextNode('删除分类下的所有动画(仅从列表移除,不删磁盘文件)和子类别'));
  const optMove = document.createElement('label');
  optMove.className = 'fav-pick-item';
  const rbMove = document.createElement('input');
  rbMove.type = 'radio';
  rbMove.name = 'delcat-anim';
  rbMove.value = 'move';
  rbMove.checked = true;
  optMove.appendChild(rbMove);
  optMove.appendChild(document.createTextNode('将分类下的动画移动到「未分类」'));
  body.appendChild(optDel);
  body.appendChild(optMove);

  // 子分类处理(仅"移动动画"模式;删除模式下子分类一并删除)
  const subBox = document.createElement('div');
  if (hasSubs) {
    const subTip = document.createElement('div');
    subTip.className = 'hint';
    subTip.style.margin = '8px 0 4px';
    subTip.textContent = '子类别处理:';
    subBox.appendChild(subTip);
    const optUp = document.createElement('label');
    optUp.className = 'fav-pick-item';
    const rbUp = document.createElement('input');
    rbUp.type = 'radio';
    rbUp.name = 'delcat-sub';
    rbUp.value = 'parent';
    rbUp.checked = true;
    optUp.appendChild(rbUp);
    optUp.appendChild(document.createTextNode(cat.parentId ? '提升为上一级分类的子类别' : '提升为顶级分类'));
    const optTo = document.createElement('label');
    optTo.className = 'fav-pick-item';
    const rbTo = document.createElement('input');
    rbTo.type = 'radio';
    rbTo.name = 'delcat-sub';
    rbTo.value = 'category';
    optTo.appendChild(rbTo);
    optTo.appendChild(document.createTextNode('移动到指定分类下:'));
    const subSel = document.createElement('select');
    const exclude = new Set([cat.id, ...subDesc]);
    for (const c of state.categories) {
      if (exclude.has(c.id)) continue;
      const op = document.createElement('option');
      op.value = c.id;
      op.textContent = categoryPath(c.id);
      subSel.appendChild(op);
    }
    subBox.appendChild(optUp);
    subBox.appendChild(optTo);
    const toRow = document.createElement('div');
    toRow.className = 'form-row';
    toRow.style.marginLeft = '28px';
    toRow.appendChild(subSel);
    subBox.appendChild(toRow);
  }
  body.appendChild(subBox);

  // 切换动画处理方式时,子分类区块联动显示/隐藏
  const toggleSub = () => {
    if (hasSubs) subBox.style.display = rbDel.checked ? 'none' : '';
  };
  rbDel.addEventListener('change', toggleSub);
  rbMove.addEventListener('change', toggleSub);
  toggleSub();

  const { close } = openModal({
    title: '删除分类',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '删除',
        cls: 'danger',
        onClick: () => {
          const animChoice = document.querySelector('input[name="delcat-anim"]:checked');
          const delItems = animChoice && animChoice.value === 'delete';
          let subAction = 'parent';
          let subTargetId = '';
          if (!delItems && hasSubs) {
            const subChoice = document.querySelector('input[name="delcat-sub"]:checked');
            subAction = subChoice ? subChoice.value : 'parent';
            if (subAction === 'category') subTargetId = subSel.value;
          }
          removeCategoryAdvanced(id, { deleteItems: delItems, subAction, subTargetId });
          close();
          if (currentCategoryId === id) currentCategoryId = 'all';
          renderCategories();
          renderItems();
          renderMainArea();
          toast('分类已删除');
        },
      },
    ]),
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------- 列表(已合并进资源树) ----------------

// ---------------- 主区域页面切换 ----------------

/** 切换主显示区域页面(home / folder / preview) */
function showPage(pageId) {
  const pages = {
    home: document.getElementById('page-home'),
    folder: document.getElementById('page-folder'),
    preview: document.getElementById('page-preview'),
  };
  for (const [k, el] of Object.entries(pages)) {
    if (el) el.hidden = k !== pageId;
  }
  if (pageId === 'preview') {
    // 页面 display:none 期间 wrap 尺寸为 0,ResizeObserver 不触发;进入后强制恢复
    requestAnimationFrame(() => {
      if (preview && preview._resize) preview._resize();
    });
  }
}

/** 渲染主区域(按 tab + 当前分类分发) */
export function renderMainArea() {
  const tab = (state.settings && state.settings.resourceTab) || 'home';
  if (tab === 'home' || tab === 'all') {
    // 全局主页(统计全部类型)
    showPage('home');
    renderHomePage(document.getElementById('page-home'), {
      resourceTab: 'home',
      homeItems: state.items,
      onTab: (group) => {
        if (group === 'all') return;
        setResourceTab(group);
        currentCategoryId = 'all';
        setSetting('lastCategoryId', 'all');
        renderMainArea(); renderCategories(); syncTabs();
      },
      onQuickCat: (catId) => {
        currentCategoryId = catId;
        setSetting('lastCategoryId', catId);
        expandedCats.add(catId);
        renderMainArea(); renderCategories();
      },
      onOpenItem: (itemId) => selectItem(itemId),
      onItemMenu: (it, e) => openItemMenu(e.clientX, e.clientY, it),
      onCatMenu: (cat, e) => openCategoryMenu(e.clientX, e.clientY, cat),
      onRefresh: () => renderMainArea(),
    });
  } else if (currentCategoryId === 'all' || currentCategoryId === '') {
    // 类型主页:当前类型的统计 + 分类目录树(需求:点类型标签 → 类型主页)
    showPage('home');
    renderHomePage(document.getElementById('page-home'), {
      resourceTab: tab,
      homeItems: state.items,
      onTab: (group) => {
        if (group === tab) return;
        setResourceTab(group);
        currentCategoryId = 'all';
        setSetting('lastCategoryId', 'all');
        renderMainArea(); renderCategories(); syncTabs();
      },
      onOpenCat: (catId) => {
        currentCategoryId = catId;
        setSetting('lastCategoryId', catId);
        expandedCats.add(catId);
        renderMainArea(); renderCategories();
      },
      onOpenItem: (itemId) => selectItem(itemId),
      onItemMenu: (it, e) => openItemMenu(e.clientX, e.clientY, it),
      onCatMenu: (cat, e) => openCategoryMenu(e.clientX, e.clientY, cat),
      onRefresh: () => renderMainArea(),
    });
  } else {
    // 具体分类 → 目录列表页(编辑管理 + 统计)
    showPage('folder');
    const group = tab;
    renderFolderPage(document.getElementById('page-folder'), {
      catId: currentCategoryId,
      group,
      viewMode: (state.settings && state.settings.listViewMode) || 'list',
      sortBy: (state.settings && state.settings.listSortBy) || 'name',
      sortDir: (state.settings && state.settings.listSortDir) || 'asc',
      editMode: editModeActive,
      selectedIds: [...editSelected],
      actions: {
        onOpenCat: (catId) => {
          currentCategoryId = catId;
          setSetting('lastCategoryId', catId);
          expandedCats.add(catId);
          renderMainArea(); renderCategories();
        },
        onOpenItem: (itemId) => selectItem(itemId),
        onItemOp: (op, itemId) => {
          const it = itemById(itemId);
          if (!it) return;
          if (op === 'preview') selectItem(itemId);
          else if (op === 'fav') collectTargetDialog([itemId]);
          else if (op === 'edit') editItemDialog(itemId);
        },
        onItemMenu: (it, e) => openItemMenu(e.clientX, e.clientY, it),
        onCatMenu: (cat, e) => openCategoryMenu(e.clientX, e.clientY, cat),
        onViewMode: (mode) => { setListViewMode(mode); renderMainArea(); },
        onSort: (by, dir) => { setListSort(by, dir); renderMainArea(); },
        onAdd: () => runAddFlow(false, currentCategoryId === 'all' || currentCategoryId === '' ? '' : currentCategoryId),
        // ---- 编辑模式 ----
        onToggleEditMode: () => {
          editModeActive = !editModeActive;
          editSelected.clear();
          renderMainArea();
        },
        onEditToggleItem: (itemId) => {
          if (editSelected.has(itemId)) editSelected.delete(itemId);
          else editSelected.add(itemId);
          renderMainArea();
        },
        onEditModeAction: (act) => {
          if (act === 'select-all') {
            const data = getFolderData(currentCategoryId, group);
            for (const it of data.direct) editSelected.add(it.id);
            renderMainArea();
          } else if (act === 'select-none') {
            editSelected.clear();
            renderMainArea();
          } else if (act === 'invert') {
            // 反选:对当前目录中所有条目逐条翻转选中状态
            const data = getFolderData(currentCategoryId, group);
            for (const it of data.direct) {
              if (editSelected.has(it.id)) editSelected.delete(it.id);
              else editSelected.add(it.id);
            }
            renderMainArea();
          } else if (act === 'batch-delete') {
            batchDeleteItems([...editSelected]);
          } else if (act === 'batch-move') {
            batchMoveItems([...editSelected]);
          }
        },
      },
    });
  }
  renderBreadcrumb();
}

/** 侧栏标签绑定 */
function bindTabs() {
  const tabs = document.getElementById('resource-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const tab = btn.dataset.tab;
    setResourceTab(tab);
    lastFolderTab = tab;
    // 切类型标签:右侧打开该类型的资源主页(全部资源列表页)
    currentCategoryId = 'all';
    setSetting('lastCategoryId', 'all');
    renderMainArea();
    renderCategories();
    syncTabs();
  });
  syncTabs();
}

function syncTabs() {
  const tab = (state.settings && state.settings.resourceTab) || 'home';
  document.querySelectorAll('#resource-tabs .tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

/** 品牌名 → 回到统计主页(需求5:主页标签已移除,保留入口) */
function bindBrandHome() {
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.title = '回到主页';
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => {
      setResourceTab('home');
      renderMainArea();
      renderCategories();
      syncTabs();
    });
  }
}

/** 面包屑绑定(事件委托) */
function bindBreadcrumb() {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const crumb = e.target.closest('.crumb');
    if (!crumb || crumb.classList.contains('current')) return;
    if (crumb.dataset.crumb === 'home') {
      setResourceTab('home');
      renderMainArea(); renderCategories(); syncTabs();
    } else if (crumb.dataset.crumb === 'typehome') {
      // 回到当前类型的类型主页
      currentCategoryId = 'all';
      setSetting('lastCategoryId', 'all');
      renderMainArea(); renderCategories();
    } else {
      currentCategoryId = crumb.dataset.crumb;
      setSetting('lastCategoryId', currentCategoryId);
      expandedCats.add(currentCategoryId);
      renderMainArea(); renderCategories();
    }
  });
}

/** 面包屑渲染 */
function renderBreadcrumb() {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;
  const tab = (state.settings && state.settings.resourceTab) || 'home';
  if (tab === 'home' || tab === 'all') {
    nav.innerHTML = '<span class="crumb current" data-crumb="home">主页</span>';
    return;
  }
  // 类型主页:主页 / 动画主页;具体分类:主页 / 动画主页 / 分类路径
  const typeName = { anim: '动画主页', image: '图片主页', audio: '音频主页', '3d': '3D 资源主页' }[tab] || tab;
  let html = '<span class="crumb" data-crumb="home">主页</span>';
  html += '<span class="crumb-sep">/</span>';
  if (currentCategoryId === 'all' || currentCategoryId === '') {
    html += `<span class="crumb current" data-crumb="typehome">${typeName}</span>`;
    nav.innerHTML = html;
    return;
  }
  const path = getCategoryPathList(currentCategoryId);
  html += `<span class="crumb" data-crumb="typehome">${typeName}</span>`;
  for (const p of path) {
    html += '<span class="crumb-sep">/</span>';
    const isLast = p.id === currentCategoryId;
    html += `<span class="crumb${isLast ? ' current' : ''}" data-crumb="${p.id}">${esc(p.name)}</span>`;
  }
  nav.innerHTML = html;
}

/** 目录列表页工具栏(视图/排序控件)由 folderPage 内部渲染,这里只同步标签状态 */
function bindFolderToolbar() {
  // 无额外绑定(事件全部由 folderPage 委托处理)
}

/** 预览页导航:返回按钮 */
function bindPreviewPageNav() {
  const back = document.getElementById('pv-back');
  if (back) {
    back.addEventListener('click', () => {
      audioViewer && audioViewer.dispose();
      setResourceTab(lastFolderTab || 'anim');
      renderMainArea();
      renderCategories();
    });
  }
}

// ---------------- 预览分发(按资源类型) ----------------

function showPreviewPage(item) {
  showPage('preview');
  // 切换对应子视图(model 复用动画视图容器显示占位信息,pv-error 在其中)
  const isAnim = typeGroup(item.type) === 'anim';
  const isModel = item.type === 'model';
  document.getElementById('pv-anim-view').hidden = !isAnim && !isModel;
  const imgView = document.getElementById('pv-image-view');
  const audioView = document.getElementById('pv-audio-view');
  if (imgView) imgView.hidden = !(item.type === 'image');
  if (audioView) audioView.hidden = !(item.type === 'audio');
  // 顶部信息
  document.getElementById('pv-name').textContent = item.displayName;
  document.getElementById('pv-type').textContent = TYPE_LABEL[item.type] || item.type;
  document.getElementById('pv-type').className = 'type-badge ' + item.type;
  const pathEl = document.getElementById('pv-path');
  pathEl.textContent = item.filePath;
  pathEl.title = item.filePath;
  document.getElementById('pv-version').textContent = '';
}

export async function selectItem(id) {
  const item = itemById(id);
  if (!item) return;
  setSetting('lastItemId', id);
  preview.currentItemId = id;
  renderItems();
  lastFolderTab = (state.settings && state.settings.resourceTab) || 'anim';
  if (lastFolderTab === 'home') lastFolderTab = 'anim';

  try {
    if (typeGroup(item.type) === 'anim') {
      await showAnimationPreview(item);
    } else if (item.type === 'image') {
      await showImageViewer(item);
    } else if (item.type === 'audio') {
      await showAudioPlayer(item);
    } else if (item.type === 'model') {
      await showModelPlaceholder(item);
    }
  } catch (err) {
    console.error('[load]', item.id, err);
    showPreviewError(item, err.message || String(err));
  }
}

/** 3D 模型预览占位(暂未内置 3D 渲染器,显示文件信息) */
async function showModelPlaceholder(item) {
  showPreviewPage(item);
  // 隐藏动画/图片/音频视图,使用错误提示区展示 3D 信息
  const err = document.getElementById('pv-error');
  if (err) {
    err.hidden = false;
    err.style.justifyContent = 'center';
    const size = item.size != null ? formatSize(item.size) : '—';
    err.innerHTML = `<div style="text-align:left;line-height:2">
      <div style="font-size:40px;text-align:center;margin-bottom:10px">🧊</div>
      <b>3D 模型文件</b>(${TYPE_LABEL[item.type] || item.type})<br/>
      名称:${esc(item.displayName)}<br/>
      大小:${size}<br/>
      路径:${esc(item.filePath)}<br/>
      <span style="color:var(--text2)">当前版本暂未内置 3D 模型查看器,可通过「打开目录」在资源管理器中查看文件。</span>
    </div>`;
  }
}

/** 动画预览(原有逻辑) */
async function showAnimationPreview(item) {
  showPreviewPage(item);
  document.getElementById('pv-error').hidden = true;
  try {
    await preview.loadItem(item);
    applyZoomMode(); // 按选中的默认缩放方式(fit/100/fixed)应用
    fillActionSelect();
    updatePlaybackUI();
    showPreviewBody(item);
    renderSlots();
    renderVersion();
  } catch (err) {
    console.error('[load]', item.id, err);
    showPreviewError(item, err.message || String(err));
    document.getElementById('slot-row').hidden = true;
    document.getElementById('pv-version').textContent = '';
    throw err;
  }
}

/** 图片预览 */
async function showImageViewer(item) {
  showPreviewPage(item);
  const errEl = document.getElementById('img-error');
  if (errEl) errEl.hidden = true;
  const url = `${location.origin}/a/${item.id}/${encodeURIComponent(basename(item.filePath))}`;
  try {
    await imageViewer.load(url);
  } catch (err) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = '图片加载失败:' + (err.message || err);
    }
    throw err;
  }
}

/** 音频预览 */
async function showAudioPlayer(item) {
  showPreviewPage(item);
  const url = `${location.origin}/a/${item.id}/${encodeURIComponent(basename(item.filePath))}`;
  audioViewer.load(url, item.displayName, item.filePath);
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

// ---------------- 插槽面板 ----------------

export function renderSlots() {
  const row = document.getElementById('slot-row');
  const list = document.getElementById('slot-list');
  if (!row || !list) return;
  const slots = preview.getSlots();
  if (!slots.length) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  list.innerHTML = '';
  for (const s of slots) {
    const chip = document.createElement('label');
    chip.className = 'slot-chip' + (s.visible ? '' : ' off');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.visible;
    cb.addEventListener('change', () => {
      preview.setSlotVisible(s.name, cb.checked);
      chip.classList.toggle('off', !cb.checked);
    });
    chip.appendChild(cb);
    const txt = document.createElement('span');
    txt.textContent = s.name;
    chip.appendChild(txt);
    list.appendChild(chip);
  }
}

function renderVersion() {
  const el = document.getElementById('pv-version');
  if (!el) return;
  const v = preview.getVersionInfo();
  const type = preview.player && preview.player.constructor
    ? preview.player.constructor.name : '';
  if (v) {
    const label = type && type.indexOf('Db') >= 0 ? 'DragonBones' : 'Spine';
    el.textContent = `${label} ${v}`;
  } else {
    el.textContent = '';
  }
}

// ---------------- 编辑/删除 条目 ----------------

function editItemDialog(id) {
  const it = itemById(id);
  if (!it) return;
  const body = document.createElement('div');
  body.className = 'modal-body';

  const nameRow = document.createElement('div');
  nameRow.className = 'form-row';
  nameRow.innerHTML = '<label class="f-label">显示名称</label>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = it.displayName;
  nameRow.appendChild(nameInput);
  body.appendChild(nameRow);

  const catRow = document.createElement('div');
  catRow.className = 'form-row';
  catRow.innerHTML = '<label class="f-label">所属分类</label>';
  const catSelect = document.createElement('select');
  const opts = [{ value: '', label: '未分类' }].concat(state.categories.map((c) => ({ value: c.id, label: c.name })));
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = o.value;
    op.textContent = o.label;
    catSelect.appendChild(op);
  }
  catSelect.value = it.categoryId || '';
  catRow.appendChild(catSelect);
  body.appendChild(catRow);

  const remarkRow = document.createElement('div');
  remarkRow.className = 'form-row';
  remarkRow.innerHTML = '<label class="f-label">备注</label>';
  const remarkInput = document.createElement('textarea');
  remarkInput.value = it.remark || '';
  remarkInput.placeholder = '例如:技能特效、主角待机…';
  remarkRow.appendChild(remarkInput);
  body.appendChild(remarkRow);

  const pathRow = document.createElement('div');
  pathRow.className = 'form-row';
  pathRow.innerHTML = '<label class="f-label">文件</label>';
  const ro = document.createElement('span');
  ro.className = 'ro';
  ro.textContent = `${TYPE_LABEL[it.type] || it.type} · ${it.filePath}`;
  pathRow.appendChild(ro);
  body.appendChild(pathRow);

  const title = it.type === 'image' ? '编辑图片' : it.type === 'audio' ? '编辑音频' : '编辑动画';
  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '删除', cls: 'danger', onClick: () => deleteItemDialog(id) },
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '保存',
        cls: 'primary',
        onClick: () => {
          if (!nameInput.value.trim()) return toast('显示名称不能为空', 'error');
          const moved = catSelect.value !== it.categoryId;
          updateItem(id, {
            displayName: nameInput.value.trim(),
            remark: remarkInput.value.trim(),
            categoryId: catSelect.value,
          });
          thumbnailService.invalidate(id); // 编辑后失效缩略图缓存(重新生成)
          close();
          renderCategories();
          renderItems();
          renderMainArea();
          const ph = document.getElementById('pv-name');
          if (ph) ph.textContent = nameInput.value.trim();
          if (moved) {
            preview.disposePlayer();
            hidePreviewBody();
          }
          toast('已保存');
        },
      },
    ]),
  });
}

function deleteItemDialog(id) {
  const it = itemById(id);
  if (!it) return;
  const title = it.type === 'image' ? '删除图片' : it.type === 'audio' ? '删除音频' : '删除动画';
  confirmDialog({
    title,
    message: `确定从列表中删除「<b>${esc(it.displayName)}</b>」吗?<br/><br/>仅从列表移除,<b>不会删除</b>磁盘上的文件。`,
    okText: '删除',
    danger: true,
    onOk: () => {
      removeItem(id);
      thumbnailService.invalidate(id); // 删除后清缩略图缓存
      if (preview.currentItemId === id) {
        preview.disposePlayer();
        preview.currentItemId = null;
        hidePreviewBody();
      }
      renderCategories();
      renderItems();
      renderMainArea();
      toast('已删除');
    },
  });
}

/** 批量删除(编辑模式):确认后从列表移除多个资源 */
function batchDeleteItems(ids) {
  const valid = ids.map((id) => itemById(id)).filter(Boolean);
  if (!valid.length) {
    toast('请先选择要删除的资源', 'error');
    return;
  }
  confirmDialog({
    title: `批量删除 ${valid.length} 个资源`,
    message: `确定从列表中删除选中的 <b class="danger-text">${valid.length}</b> 个资源吗?<br/><br/>仅从列表移除,<b>不会删除</b>磁盘上的文件。`,
    okText: '删除',
    danger: true,
    onOk: () => {
      for (const it of valid) {
        removeItem(it.id);
        thumbnailService.invalidate(it.id);
        if (preview.currentItemId === it.id) {
          preview.disposePlayer();
          preview.currentItemId = null;
        }
      }
      editSelected.clear();
      renderCategories();
      renderItems();
      renderMainArea();
      toast(`已删除 ${valid.length} 个资源`);
    },
  });
}

/** 批量移动(编辑模式):把选中的资源移到其它分类(或未分类) */
function batchMoveItems(ids) {
  const valid = ids.map((id) => itemById(id)).filter(Boolean);
  if (!valid.length) {
    toast('请先选择要移动的资源', 'error');
    return;
  }
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = `<span class="ro">将选中的 <b>${valid.length}</b> 个资源移动到:</span>`;
  body.appendChild(tip);

  const list = document.createElement('div');
  list.className = 'fav-pick-list';
  let checked = false;
  const pick = (value, label) => {
    const lb = document.createElement('label');
    lb.className = 'fav-pick-item';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'batchmove';
    rb.value = value;
    if (!checked) { rb.checked = true; checked = true; }
    const sp = document.createElement('span');
    sp.textContent = label;
    lb.appendChild(rb);
    lb.appendChild(sp);
    list.appendChild(lb);
  };
  pick('', '未分类');
  for (const c of state.categories) {
    if (c.id === currentCategoryId) continue; // 已在当前目录的不需要移动
    pick(c.id, categoryPath(c.id));
  }
  body.appendChild(list);

  const { close } = openModal({
    title: '批量移动资源',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '移动',
        cls: 'primary',
        onClick: () => {
          const selected = list.querySelector('input:checked');
          if (!selected) return;
          const target = selected.value;
          for (const it of valid) {
            updateItem(it.id, { categoryId: target });
            thumbnailService.invalidate(it.id);
          }
          close();
          editSelected.clear();
          renderCategories();
          renderItems();
          renderMainArea();
          toast(`已将 ${valid.length} 个资源移动至「${target ? categoryPath(target) : '未分类'}」`);
        },
      },
    ]),
  });
}

// ---------------- 预览面板 ----------------

function showPreviewLoading(item) {
  // 兼容旧调用:预览头部信息由 showPreviewPage 设置,此处仅清空错误
  const err = document.getElementById('pv-error');
  if (err) err.hidden = true;
}

function showPreviewBody(item) {
  const err = document.getElementById('pv-error');
  if (err) err.hidden = true;
  document.getElementById('pv-name').textContent = item.displayName;
}

function showPreviewError(item, message) {
  const err = document.getElementById('pv-error');
  if (!err) return;
  err.hidden = false;
  let hint = '请检查文件是否完整(例如缺少 .atlas / 贴图文件),或文件格式版本是否受支持。';
  if (/String in string table|parse|SkeletonBinary/i.test(message)) {
    hint = '该 .skel 文件可能经过加密/混淆(页游资源常见),或版本不受支持。\n请确认文件为标准 Spine 二进制(3.8~4.2)。';
  } else if (/atlas|贴图|texture/i.test(message)) {
    hint = '缺少或无法读取贴图集文件,请确认同名 .atlas 与图片文件齐全。';
  }
  err.textContent = `加载失败:${message}\n\n${hint}`;
  document.getElementById('pv-name').textContent = item.displayName;
}

function hidePreviewBody() {
  // 兼容旧调用:回到目录列表页
  setResourceTab(lastFolderTab || 'anim');
  renderMainArea();
  renderCategories();
}

function fillActionSelect() {
  const sel = document.getElementById('anim-select');
  sel.innerHTML = '';
  for (const a of preview.actions) {
    const op = document.createElement('option');
    op.value = a.name;
    op.textContent = a.name;
    sel.appendChild(op);
  }
  if (preview.currentAction) sel.value = preview.currentAction.name;
  updateActionDur();
}

function updateActionDur() {
  const a = preview.currentAction;
  document.getElementById('anim-dur').textContent = a ? `${a.duration.toFixed(2)}s` : '';
}

export function updatePlaybackUI() {
  const mode = state.settings.playMode || 'loop';
  document.querySelectorAll('#mode-seg .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.getElementById('single-row').hidden = mode !== 'single';
  document.getElementById('speed-range').value = state.settings.timeScale || 1;
  document.getElementById('speed-val').textContent = (state.settings.timeScale || 1).toFixed(1) + 'x';
  document.getElementById('bg-color').value = state.settings.bgColor || '#22242b';
  document.getElementById('show-bones').checked = !!state.settings.showBones;
  const zMode = document.getElementById('zoom-mode');
  if (zMode) zMode.value = state.settings.zoomMode || '100';
  preview.mode = mode;
  preview.speed = state.settings.timeScale || 1;
  preview.paused = false;
  document.getElementById('btn-play').textContent = '⏸';
  document.getElementById('frame-slider').value = '0';
  document.getElementById('frame-val').textContent = '0.00s / 0.00s';
}

// ---------------- 工具栏/控件绑定 ----------------

function bindToolbar() {
  const btnAdd = document.getElementById('btn-add');
  btnAdd.addEventListener('click', () => runAddFlow(false, currentCategoryId === 'all' || currentCategoryId === '' ? '' : currentCategoryId));

  const btnBatch = document.getElementById('btn-add-batch');
  btnBatch.addEventListener('click', () => runAddFlow(true, currentCategoryId === 'all' || currentCategoryId === '' ? '' : currentCategoryId));

  document.getElementById('btn-new-cat').addEventListener('click', newCategoryDialog);

  // 顶栏左侧「资源树」按钮:切换侧栏显示/隐藏(active 状态反映当前可见性)
  const toggleSide = document.getElementById('btn-toggle-side');
  if (toggleSide) {
    toggleSide.addEventListener('click', () => {
      const sb = document.getElementById('sidebar');
      setSidebarVisible(sb.classList.contains('hidden'));
    });
  }

  // 打开目录 / 重新加载(顶栏,位于「添加动画」之前)
  document.getElementById('pv-open-dir').addEventListener('click', () => {
    const it = itemById(preview.currentItemId);
    if (it) window.api.showItem(it.filePath);
  });
  document.getElementById('pv-reload').addEventListener('click', () => {
    const it = itemById(preview.currentItemId);
    if (it) selectItem(it.id);
  });

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    searchText = search.value.trim();
    renderItems();
  });
}

function bindList() {
  window.addEventListener('items-changed', () => {
    renderCategories();
    renderItems();
    renderMainArea();
  });
}

function bindPreviewControls() {
  // 动作选择
  const sel = document.getElementById('anim-select');
  sel.addEventListener('change', () => {
    preview.setActionByName(sel.value);
    updateActionDur();
    document.getElementById('frame-slider').value = '0';
  });
  document.getElementById('anim-prev').addEventListener('click', () => {
    preview.prevAction();
    sel.value = preview.currentAction.name;
    updateActionDur();
  });
  document.getElementById('anim-next').addEventListener('click', () => {
    preview.nextAction();
    sel.value = preview.currentAction.name;
    updateActionDur();
  });

  // 播放模式
  document.querySelectorAll('#mode-seg .seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      setSetting('playMode', mode);
      preview.setMode(mode);
      updatePlaybackUI();
      if (mode === 'single') syncFrameSlider();
    });
  });

  // 播放/暂停/重播
  document.getElementById('btn-play').addEventListener('click', () => {
    const paused = preview.togglePlay();
    document.getElementById('btn-play').textContent = paused ? '▶' : '⏸';
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    preview.restart();
    document.getElementById('btn-play').textContent = '⏸';
  });

  // 倍速
  const speedRange = document.getElementById('speed-range');
  speedRange.addEventListener('input', () => {
    const s = parseFloat(speedRange.value);
    document.getElementById('speed-val').textContent = s.toFixed(1) + 'x';
    setSetting('timeScale', s);
    preview.setSpeed(s);
  });

  // 单帧控制
  document.getElementById('frame-home').addEventListener('click', () => { preview.stepToRatio(0); syncFrameSlider(); });
  document.getElementById('frame-end').addEventListener('click', () => { preview.stepToRatio(1); syncFrameSlider(); });
  document.getElementById('frame-prev').addEventListener('click', () => { preview.stepFrame(-1); syncFrameSlider(); });
  document.getElementById('frame-next').addEventListener('click', () => { preview.stepFrame(1); syncFrameSlider(); });
  const frameSlider = document.getElementById('frame-slider');
  frameSlider.addEventListener('input', () => {
    preview.stepToRatio(parseFloat(frameSlider.value) / 100);
    syncFrameSlider();
  });

  // 背景
  const bgInput = document.getElementById('bg-color');
  bgInput.addEventListener('input', () => {
    const c = bgInput.value;
    setSetting('bgColor', c);
    preview.setBgColor(c);
  });
  document.getElementById('bg-dark').addEventListener('click', () => {
    bgInput.value = '#22242b';
    setSetting('bgColor', '#22242b');
    preview.setBgColor('#22242b');
  });
  document.getElementById('bg-light').addEventListener('click', () => {
    bgInput.value = '#eef0f5';
    setSetting('bgColor', '#eef0f5');
    preview.setBgColor('#eef0f5');
  });

  // 骨骼显示
  document.getElementById('show-bones').addEventListener('change', (e) => {
    setSetting('showBones', e.target.checked);
    if (preview.player) preview.player.setShowBones(e.target.checked);
  });

  // 水平翻转(镜像)
  document.getElementById('flip-x').addEventListener('change', (e) => {
    preview.setFlip(e.target.checked);
  });

  // 旋转 90°
  document.getElementById('btn-rotate').addEventListener('click', () => {
    preview.rotateClockwise();
  });

  // 缩放条
  const zoomRange = document.getElementById('zoom-range');
  zoomRange.addEventListener('input', () => {
    const pct = parseFloat(zoomRange.value);
    document.getElementById('zoom-val').textContent = pct.toFixed(0) + '%';
    preview.setZoomRatio(pct / 100);
  });
  // 默认缩放方式(fit / 100 / fixed)
  const zoomMode = document.getElementById('zoom-mode');
  zoomMode.addEventListener('change', () => {
    setSetting('zoomMode', zoomMode.value);
    applyZoomMode();
  });

  // 插槽全显/全隐
  document.getElementById('slot-all').addEventListener('click', () => {
    for (const s of preview.getSlots()) preview.setSlotVisible(s.name, true);
    renderSlots();
  });
  document.getElementById('slot-none').addEventListener('click', () => {
    for (const s of preview.getSlots()) preview.setSlotVisible(s.name, false);
    renderSlots();
  });
  // 注:侧栏切换(pv-open-dir / pv-reload)已移至顶栏 bindToolbar
}

// 侧栏整体隐藏/显示
function setSidebarVisible(v) {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.toggle('hidden', !v);
  localStorage.setItem('sidebarHidden', v ? '0' : '1');
  // 顶栏「资源树」按钮图标同步:☰ 显示(当前隐藏,点击显示) / ▤ 隐藏(当前显示,点击隐藏)
  syncTreeToggleIcon();
  // 触发一次 resize,让预览区铺满
  if (preview && preview._resize) preview._resize();
}

/** 同步「资源树」按钮图标:侧栏可见 → 「▤ 资源树」;侧栏隐藏 → 「☰ 资源树」 */
function syncTreeToggleIcon() {
  const t = document.getElementById('btn-toggle-side');
  if (!t) return;
  const hidden = document.getElementById('sidebar')?.classList.contains('hidden');
  if (hidden) {
    t.textContent = '☰ 资源树';
    t.title = '显示资源树';
  } else {
    t.textContent = '▤ 资源树';
    t.title = '隐藏资源树';
  }
}

/**
 * 应用当前选中的默认缩放方式:
 * - 'fit'     → 适配窗口(重新计算 fit)
 * - '100'     → 固定 100%
 * - 'fixed'   → 固定缩放比例,数值跟随缩放滑块当前值
 * - 'dynamic' → 动态缩放:100% 放得下用 100%,放不下适配窗口
 */
function applyZoomMode() {
  if (!preview || !preview.viewC) return;
  const mode = (state.settings && state.settings.zoomMode) || '100';
  preview.fitPolicy = mode; // 同步缩放策略(窗口 resize 时按此处理)
  const zr = document.getElementById('zoom-range');
  if (mode === 'fit') {
    preview.fit();
  } else if (mode === 'fixed') {
    const pct = zr ? parseFloat(zr.value) : 100;
    if (isFinite(pct) && pct > 0) preview.setZoomRatio(pct / 100);
    else preview.setZoomRatio(1);
  } else if (mode === 'dynamic') {
    if (typeof preview.fitDynamic === 'function') preview.fitDynamic();
    else preview.fit();
  } else {
    preview.setZoomRatio(1);
  }
  syncZoomUI();
}

// 同步缩放条(滚轮缩放/fit 后调用)
function syncZoomUI() {
  const zr = document.getElementById('zoom-range');
  const zv = document.getElementById('zoom-val');
  if (!zr || !zv) return;
  const r = preview.getZoomRatio();
  const pct = clamp(Math.round(r * 100), 5, 400);
  zr.value = String(pct);
  zv.textContent = pct + '%';
}

// 单帧模式下同步滑块与时间显示
function syncFrameSlider() {
  const dur = preview.player ? preview.player.duration : 0;
  const cur = preview.player ? preview.player.currentTime : 0;
  const slider = document.getElementById('frame-slider');
  if (dur > 0) slider.value = String(clamp((cur / dur) * 100, 0, 100));
  document.getElementById('frame-val').textContent = `${cur.toFixed(2)}s / ${dur.toFixed(2)}s`;
}

function clamp(v, a, b) {
  return Math.min(Math.max(v, a), b);
}

// 状态栏(帧循环中调用)
export function updateStatusBar() {
  const status = document.getElementById('pv-status');
  const s = preview.getStatus();
  if (status.textContent !== s) status.textContent = s;
  // 单帧模式同步时间显示
  if (preview.mode === 'single' && preview.player) {
    syncFrameSlider();
  }
  // 同步缩放条(滚轮缩放后)
  syncZoomUI();
}
