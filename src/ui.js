// ============ UI 渲染与交互 ============

import {
  state, setSetting, itemById, categoryById,
  addCategory, updateCategory, removeCategory, removeCategoryAdvanced,
  getCategoryChildren, isCategoryDescendant, getCategoryDescendants, categoryPath,
  updateItem, removeItem, addItem, findOrCreateCategoryByName,
  reorderCategory,
  addFavCategory, updateFavCategory, removeFavCategory,
  addFavItem, removeFavItem, moveFavItem, favCategoryById,
  reorderFavCategory,
  favLocations, isFavored,
  TYPE_LABEL, typeGroup, formatSize,
  CAT_TYPE_TAG_LABELS, CAT_TYPE_TAGS, categoryTypeTags, categoryTypeTagNames, catVisibleInGroup,
  getCategoryPathList, getFolderData, sortItems,
  setResourceTab, setListViewMode, setListSort,
  itemTags, allTags, cleanTags,
  addSceneCategory, updateSceneCategory, removeSceneCategory, sceneCategoryById,
  getSceneCategoryChildren, getSceneCategoryDescendants, reorderSceneCategory,
  addScene, updateScene, removeScene, scenesInCategory, findSceneByFilePath,
  addWebBookmarkCategory, updateWebBookmarkCategory, removeWebBookmarkCategory,
  webBookmarkCategoryById, getWebBookmarkCategoryChildren,
  addWebBookmark, updateWebBookmark, removeWebBookmark,
  webBookmarkById, webBookmarksInCategory,
  recordRecentOpen,
} from './state.js';
import { openModal, footButtons, confirmDialog, promptDialog, toast, showContextMenu } from './dialogs.js';
import { initBgColorBar, customBgColor, BG_DARK, BG_LIGHT } from './bgColor.js';
import { runAddFlow } from './addFlow.js';
import { renderHomePage, renderFavHome } from './pages/homePage.js';
import { renderFolderPage, renderFavFolderPage } from './pages/folderPage.js';
import { renderToolboxPage } from './pages/toolboxPage.js';
import { renderSceneHome, renderSceneFolderPage, renderFguiPreviewPage, promptRegisterFgui, renderSceneSearchResults } from './pages/scenePage.js';
import { renderFguiEditorPage } from './pages/fguiEditorPage.js';
import { renderSettingsPage } from './pages/settingsPage.js';
import { renderWebGamePage } from './pages/webGamePage.js';
import { renderApiPage } from './pages/apiPage.js';
import { ImageViewerController } from './viewers/imageViewer.js';
import { AudioPlayerController } from './viewers/audioViewer.js';
import { FguiViewerController } from './viewers/fguiViewer.js';
import { thumbnailService } from './thumbnails.js';
import { makeCopyablePath, setCopyablePath } from './clipboard.js';

let currentCategoryId = 'all';
let searchText = '';
let preview = null;
let imageViewer = null;
let audioPlayer = null;
let fguiViewer = null;
let lastFolderTab = 'anim'; // 进入预览前所在 tab,返回时恢复
let editModeActive = false; // 目录列表页编辑模式开关
const editSelected = new Set(); // 编辑模式下选中的资源 id
let editAnchorId = null; // Shift 范围选择的锚点(最后一个 Ctrl/普通点击的条目 id)
let folderTagFilter = ''; // 目录列表页标签过滤(空 = 全部)
let folderSearchText = ''; // 目录列表页搜索(名称/属性/标签)
let favHomeShown = false; // 右侧是否显示收藏夹主页
let currentFavCategoryId = null; // 当前收藏夹目录列表页的收藏分类 id(null = 不在收藏夹目录页)
let previewReturnFav = null; // 从收藏夹页面进入预览时记录返回目标 {home, catId}
// ---- 工具箱 / 场景管理 导航状态 ----
let currentTool = null; // null | 'astc2png' | 'skel2json' | 'spinefix' | 'imageedit' | 'fgui'
let toolboxHomeShown = false; // 右侧是否显示资源工具箱主页(汇总视图,含所有子菜单入口)
let sceneHomeShown = false; // 右侧是否显示场景主页
let currentSceneCatId = null; // 当前场景目录列表页的场景分类 id(null = 不在场景目录页;'' = 未分类)
let fguiPreviewShown = false; // 场景管理内 FGUI 界面预览子页是否显示
let pendingFguiBin = null; // 从场景管理进入 FGUI 预览时待加载的 .bin 路径(用后清空)
let fguiEditorShown = false; // FGUI 编辑器独立页是否显示
let pendingFguiEditorBin = null; // 进入 FGUI 编辑器时待加载的 .bin 路径(用后清空)
let settingsShown = false; // 右侧是否显示系统设置页
let settingsReturn = null; // 打开设置前的主区状态快照,关闭后恢复
let webGameShown = false; // 网络资源抓取页是否显示
let apiDocShown = false; // 开发工具箱 API 管理页是否显示

// ---- 主区多标签页(资源/功能页标签,可切换/关闭) ----
const mainTabs = []; // [{key, id, kind, params, label, icon}]
let activeTabId = null;

/** 查找或创建标签(key 唯一);创建后默认激活 */
function ensureTab(key, def) {
  let t = mainTabs.find((x) => x.key === key);
  if (!t) {
    t = { key, id: 'tab' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: '', params: {}, label: '', icon: '', ...def };
    mainTabs.push(t);
  }
  activeTabId = t.id;
  renderTabStrip();
  return t;
}

function renderTabStrip() {
  const strip = document.getElementById('tab-strip');
  if (!strip) return;
  strip.innerHTML = '';
  for (const t of mainTabs) {
    const el = document.createElement('div');
    el.className = 'main-tab' + (t.id === activeTabId ? ' active' : '');
    el.innerHTML = `<span class="mt-icon">${t.icon || ''}</span><span class="mt-label" title="${esc(t.label || '')}">${esc(t.label || '')}</span><span class="mt-close" title="关闭标签">×</span>`;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('mt-close')) { closeTab(t.id); return; }
      if (t.id !== activeTabId) switchTab(t.id);
    });
    strip.appendChild(el);
  }
}

/** bin 文件名(去扩展名) */
function pkgNameOf(p) {
  return (String(p).split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '') || '未命名';
}

/** 切换标签:按标签参数重建主区内容 */
function switchTab(id) {
  const t = mainTabs.find((x) => x.id === id);
  if (!t) return;
  activeTabId = t.id;
  renderTabStrip();
  applyTabState(t);
}

/** 按标签参数设置模块状态并渲染对应内容 */
function applyTabState(t) {
  clearOverlays();
  if (t.kind === 'preview') {
    // 资源预览:经 selectItem 重建(内部会再 ensureTab 幂等)
    if (t.params && t.params.itemId) selectItem(t.params.itemId);
    return;
  }
  if (t.kind === 'folder') {
    setResourceTab(t.params.tab || 'anim');
    currentCategoryId = t.params.catId == null ? 'all' : t.params.catId;
    setSetting('lastCategoryId', currentCategoryId);
    if (currentCategoryId !== 'all' && currentCategoryId !== '') expandedCats.add(currentCategoryId);
    renderMainArea();
    renderCategories();
    syncTabs();
    return;
  }
  if (t.kind === 'home') {
    setResourceTab('home');
    renderMainArea();
    renderCategories();
    syncTabs();
    return;
  }
  if (t.kind === 'toolbox') {
    currentTool = t.params.tool || null;
    toolboxHomeShown = !currentTool;
    renderMainArea();
    return;
  }
  if (t.kind === 'settings') {
    settingsShown = true;
    renderMainArea();
    return;
  }
  if (t.kind === 'scene') {
    const mode = t.params.mode || 'home';
    sceneHomeShown = mode === 'home';
    currentSceneCatId = mode === 'folder' ? (t.params.catId || '') : null;
    fguiPreviewShown = mode === 'fgui';
    pendingFguiBin = mode === 'fgui' ? (t.params.binPath || null) : null;
    if (mode === 'fgui' && !expandedCats.has('__scene__')) expandedCats.add('__scene__');
    renderMainArea();
    return;
  }
  if (t.kind === 'fgui-editor') {
    fguiEditorShown = true;
    renderMainArea();
    return;
  }
  if (t.kind === 'webgame') {
    webGameShown = true;
    renderMainArea();
    return;
  }
  if (t.kind === 'api-doc') {
    apiDocShown = true;
    renderMainArea();
    return;
  }
  renderMainArea();
}

/** 关闭标签;若关闭的是当前标签,切到相邻标签重建内容 */
function closeTab(id) {
  const i = mainTabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  mainTabs.splice(i, 1);
  if (id === activeTabId) {
    const next = mainTabs[Math.max(0, i - 1)] || mainTabs[0];
    if (next) { activeTabId = next.id; renderTabStrip(); applyTabState(next); }
    else { activeTabId = null; renderTabStrip(); ensureHomeTab(); }
  } else {
    renderTabStrip();
  }
}

/** 兜底:确保至少有一个首页标签 */
function ensureHomeTab() {
  if (mainTabs.length) return;
  ensureTab('home', { kind: 'home', label: '资源首页', icon: '🏠' });
  applyTabState(mainTabs[mainTabs.length - 1]);
}

/** 渲染主区前同步标签(任何导航渲染后,标签条与内容保持一致) */
function syncTabFromState() {
  let tab = null;
  if (fguiPreviewShown) {
    tab = ensureTab(`scene-fgui-${pendingFguiBin || ''}`, { kind: 'scene', params: { mode: 'fgui', binPath: pendingFguiBin || '' }, label: pendingFguiBin ? pkgNameOf(pendingFguiBin) : 'FGUI 预览', icon: '🧩' });
  } else if (fguiEditorShown) {
    tab = ensureTab('fgui-editor', { kind: 'fgui-editor', params: {}, label: 'FGUI编辑器', icon: '🧩' });
  } else if (webGameShown) {
    tab = ensureTab('webgame', { kind: 'webgame', params: {}, label: '网络资源抓取', icon: '🌐' });
  } else if (apiDocShown) {
    tab = ensureTab('api-doc', { kind: 'api-doc', params: {}, label: 'API 管理', icon: '📖' });
  } else if (currentTool || toolboxHomeShown) {
    tab = ensureTab(`toolbox-${currentTool || '__home__'}`, { kind: 'toolbox', params: { tool: currentTool }, label: currentTool ? toolLabel(currentTool) : '资源工具箱', icon: '🧰' });
  } else if (settingsShown) {
    tab = ensureTab('settings', { kind: 'settings', label: '系统设置', icon: '⚙' });
  } else if (sceneHomeShown || currentSceneCatId != null) {
    tab = ensureTab(currentSceneCatId != null ? `scene-folder-${currentSceneCatId}` : 'scene-home', { kind: 'scene', params: { mode: currentSceneCatId != null ? 'folder' : 'home', catId: currentSceneCatId }, label: currentSceneCatId != null ? ((sceneCategoryById(currentSceneCatId) || {}).name || '未分类') : '游戏场景管理', icon: '🗺' });
  } else if (favHomeShown || currentFavCategoryId != null) {
    tab = ensureTab('fav', { kind: 'folder', params: { tab: (state.settings && state.settings.resourceTab) || 'anim', catId: 'all' }, label: '收藏夹', icon: '⭐' });
  } else if (preview && preview.currentItemId) {
    const it = itemById(preview.currentItemId);
    if (it) {
      tab = ensureTab(`preview-${it.id}`, { kind: 'preview', params: { itemId: it.id }, label: it.displayName || '', icon: previewTypeIcon(it.type) });
    }
  }
  if (tab) { activeTabId = tab.id; renderTabStrip(); return; }
  // 目录 / 类型主页 / 全局主页
  const tabName = (state.settings && state.settings.resourceTab) || 'home';
  const catId = currentCategoryId == null ? 'all' : currentCategoryId;
  if (tabName === 'home') {
    tab = ensureTab('home', { kind: 'home', label: '资源首页', icon: '🏠' });
  } else if (catId === 'all' || catId === '') {
    tab = ensureTab(`folder-${tabName}-all`, { kind: 'folder', params: { tab: tabName, catId: 'all' }, label: GROUP_LABEL[tabName] || '资源主页', icon: '📁' });
  } else {
    const cat = categoryById(catId);
    tab = ensureTab(`folder-${tabName}-${catId}`, { kind: 'folder', params: { tab: tabName, catId }, label: cat ? cat.name : '未分类', icon: '📁' });
  }
  activeTabId = tab.id;
  renderTabStrip();
}

const GROUP_LABEL = { anim: '动画主页', image: '图片主页', audio: '音频主页', '3d': '3D 资源主页' };

function previewTypeIcon(type) {
  const g = typeGroup(type);
  if (g === 'anim') return '🎬';
  if (type === 'image') return '🖼';
  if (type === 'audio') return '♪';
  if (type === 'model') return '🧊';
  return '📄';
}

function toolLabel(tool) {
  return ({ astc2png: 'ASTC→PNG', skel2json: 'SKEL→JSON', spinefix: 'Spine 修复', imageedit: '图片编辑', sk2spine: 'Laya .sk → Spine' })[tool] || tool;
}

export function initUI(pv) {
  preview = pv;
  // 需求:默认不展开任何分类/子目录(收藏夹根与收藏分类均默认折叠,点击箭头才展开)
  // ⚠ 启动性能:Electron 渲染进程 localStorage 首次访问需初始化 LevelDB, 实测可达数秒,
  //   阻塞首屏 → 侧栏隐藏状态改为空闲时再读取应用(首屏先按展开显示)
  const applySidebarState = () => {
    try {
      if (localStorage.getItem('sidebarHidden') === '1') {
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.add('hidden');
      }
    } catch (e) { /* ignore */ }
    syncTreeToggleIcon();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => applySidebarState());
  else setTimeout(applySidebarState, 60);
  // 图片 / 音频查看器
  imageViewer = new ImageViewerController();
  const imgWrap = document.getElementById('pv-image-view');
  if (imgWrap) imageViewer.init(imgWrap);
  audioPlayer = new AudioPlayerController();
  const audioWrap = document.getElementById('pv-audio-view');
  if (audioWrap) audioPlayer.init({
    audio: document.getElementById('audio-el'),
    playBtn: document.getElementById('audio-play'),
    prevBtn: document.getElementById('audio-prev'),
    nextBtn: document.getElementById('audio-next'),
    progress: document.getElementById('audio-progress'),
    volume: document.getElementById('audio-volume'),
    rate: document.getElementById('audio-rate'),
    mode: document.getElementById('audio-mode'),
    timeEl: document.getElementById('audio-time'),
    nameEl: document.getElementById('audio-name'),
    pathEl: document.getElementById('audio-path'),
    statusEl: document.getElementById('audio-status'),
    queueEl: document.getElementById('audio-queue'),
    miniBar: document.getElementById('audio-mini'),
    miniName: document.getElementById('audio-mini-name'),
    miniPlay: document.getElementById('audio-mini-play'),
  });
  // FGUI 包逆向查看器
  fguiViewer = new FguiViewerController();
  const fguiWrap = document.getElementById('pv-fgui-view');
  if (fguiWrap) fguiViewer.init(fguiWrap);
  bindAudioPlayerExtras();
  // 设置页修改播放列表显示字段后,立即刷新队列显示
  document.addEventListener('audio:fieldsChanged', () => {
    if (audioPlayer) audioPlayer.refreshUI();
  });
  bindToolbar();
  bindList();
  bindPreviewControls();
  bindTabs();
  // 工具箱主页卡片 → 导航到对应子工具(用事件解耦,避免跨模块传递函数)
  document.addEventListener('toolbox:navigate', (e) => {
    const id = e.detail && e.detail.id;
    if (id) openTool(id);
  });
  // 场景管理主页「FGUI 编辑器」入口卡片 / 场景条目 → 进入 FGUI 编辑器(binPath 可选,进入后自动加载)
  document.addEventListener('scene:navigate', (e) => {
    const to = e.detail && e.detail.to;
    if (to === 'fgui-preview' || to === 'fgui-editor') {
      enterFguiEditor((e.detail && e.detail.binPath) || null);
    }
  });
  bindBrandHome();
  bindBreadcrumb();
  bindBackSpecial();
  bindFolderToolbar();
  bindPreviewPageNav();

  // 顶栏 Chrome DevTools 调试状态指示灯(轮询;设置页保存重启后自动刷新)
  const refreshCdpInd = async () => {
    const dot = document.getElementById('cdp-dot');
    const tip = document.getElementById('cdp-tip');
    if (!dot || !tip) return;
    try {
      const st = await window.api.cdpGetState();
      if (st.enabled && st.listening) {
        dot.className = 'cdp-dot ok';
        tip.textContent = `● Chrome DevTools 调试服务已生效\n端口 ${st.port} · 本机可连接\n在「设置 → 开发者调试」查看/关闭,点此打开连接说明`;
      } else if (st.enabled) {
        dot.className = 'cdp-dot warn';
        tip.textContent = `○ 调试服务已启用,待重启生效\n端口 ${st.port} · 保存并重启后开放`;
      } else {
        dot.className = 'cdp-dot off';
        tip.textContent = `○ Chrome DevTools 调试服务未开启\n在「设置 → 开发者调试」中启用后重启`;
      }
    } catch (e) { /* ignore */ }
  };
  refreshCdpInd();
  setInterval(refreshCdpInd, 8000);
  // 点击指示灯 → 打开连接说明文档
  const cdpInd = document.getElementById('cdp-ind');
  if (cdpInd) {
    cdpInd.addEventListener('click', async (e) => {
      if (e.target.closest('.cdp-tooltip')) return; // 悬停提示不触发
      try { await window.api.cdpOpenDoc(); } catch (err) { /* ignore */ }
    });
  }

  // 注:首次渲染(renderCategories/renderMainArea)由 main() 统一调用一次, 避免重复
}

// ---------------- 资源树(分类 + 条目合并) ----------------

const expandedCats = new Set(['__webgame__', '__webgame_fav__', '__devtools__']); // 展开的分类 id('all' / '' / 分类id);「XX资源」根默认折叠, 网络资源抓取/网址收藏夹/开发工具箱默认展开(可折叠)

let dragCatId = null;    // 当前拖拽中的分类 id
let dragItemId = null;   // 当前拖拽中的条目 id
let dragKind = null;     // 拖拽源类型:'cat'(分类) | 'favcat'(收藏分类) | 'item'(动画条目)
let dragSceneCatId = null; // 当前拖拽中的场景分类 id
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
      (i) => i.displayName.toLowerCase().includes(q) || (i.remark || '').toLowerCase().includes(q) || itemTags(i).some((t) => t.toLowerCase().includes(q))
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
  if (searchText) {
    renderTree(); // 搜索时侧栏展开全部分类
    renderSearchResults();
    return;
  }
  renderTree();
}

/** 顶栏全局搜索:范围跟随当前上下文(类型/目录/场景/全部) */
function renderSearchResults() {
  const q = searchText;
  if (!q) return;
  const lq = q.toLowerCase();
  // 场景上下文:搜索游戏场景(全部或当前目录)
  if (sceneHomeShown || currentSceneCatId != null || fguiPreviewShown) {
    showPage('scene');
    renderSceneSearchResults(lq, currentSceneCatId, {
      onOpenFgui: openFguiEditorFromScene,
      onOpenPath: (s) => { if (s.filePath) window.api.openPath(s.filePath); },
    });
    renderBreadcrumb();
    return;
  }
  // 资源上下文:目录页搜索结果(全部类型 home / 当前类型 / 当前目录含子分类)
  showPage('folder');
  const tab = (state.settings && state.settings.resourceTab) || 'home';
  const catId = currentCategoryId == null ? 'all' : currentCategoryId;
  renderFolderPage(document.getElementById('page-folder'), {
    catId,
    group: tab,
    viewMode: (state.settings && state.settings.listViewMode) || 'list',
    sortBy: (state.settings && state.settings.listSortBy) || 'name',
    sortDir: (state.settings && state.settings.listSortDir) || 'asc',
    tagFilter: '',
    searchText: q,
    searchMode: true,
    actions: {
      onOpenItem: (itemId) => selectItem(itemId),
      onOpenCat: (cid) => {
        currentCategoryId = cid;
        setSetting('lastCategoryId', cid);
        expandedCats.add(cid);
        // 进入分类时清空顶栏搜索,展示该分类全部内容
        searchText = '';
        const s = document.getElementById('search');
        if (s) s.value = '';
        renderMainArea(); renderCategories();
      },
      onItemMenu: (it, e) => openItemMenu(e.clientX, e.clientY, it),
      onRefresh: () => renderItems(),
    },
  });
  renderBreadcrumb();
}

function renderTree() {
  const tree = document.getElementById('cat-tree');
  if (!tree) return;
  tree.innerHTML = '';

  // 搜索时自动展开所有分类(含类型根节点)
  if (searchText) {
    expandedCats.add('all');
    state.categories.forEach((c) => expandedCats.add(c.id));
  }

  // 收藏夹区块(置顶)
  renderFavSection(tree);

  // 收藏夹区域与资源分类目录区域之间的分格线
  const sep = document.createElement('div');
  sep.className = 'tree-section-sep';
  tree.appendChild(sep);

  // 「XX资源」类型根节点(名称随 tab 变化):既是类型主页链接,又可展开/折叠该类型的分类目录
  const allName = { anim: '动画资源', image: '图片资源', audio: '音频资源', '3d': '3D资源', home: '资源' }[currentGroup() || 'home'];
  renderPseudoNode(tree, { id: 'all', icon: '▦', name: allName });

  // 分格线:资源目录与场景管理之间
  const sep2 = document.createElement('div');
  sep2.className = 'tree-section-sep';
  tree.appendChild(sep2);

  // 「游戏场景管理」根菜单(展开后显示场景分类树 + 未分类场景)
  renderSceneSection(tree);

  // 分格线:场景管理与网络资源抓取之间
  const sepWg = document.createElement('div');
  sepWg.className = 'tree-section-sep';
  tree.appendChild(sepWg);

  // 「网络资源抓取」根菜单(内嵌浏览器逆向分析网络资源)
  renderWebGameSection(tree);

  // 分格线:场景管理与工具箱之间
  const sep3 = document.createElement('div');
  sep3.className = 'tree-section-sep';
  tree.appendChild(sep3);

  // 「资源工具箱」根菜单(展开后显示文件格式转换 / 图片编辑 / FGUI 编辑器 等子菜单)
  renderToolboxSection(tree);

  // 分格线:工具箱与开发工具箱之间
  const sepDev = document.createElement('div');
  sepDev.className = 'tree-section-sep';
  tree.appendChild(sepDev);

  // 「开发工具箱」根菜单(展开后显示 API 管理等开发辅助工具)
  renderDevToolsSection(tree);

  // 分格线:开发工具箱与系统设置之间
  const sepSet = document.createElement('div');
  sepSet.className = 'tree-section-sep';
  tree.appendChild(sepSet);

  // 「系统设置」叶子节点(独立入口)
  const settingsNode = makeTreeNode({
    icon: '⚙️',
    name: '系统设置',
    nodeId: '__settings__',
    active: settingsShown,
    paddingLeft: 8,
    hasChildren: false,
    isOpen: false,
  });
  tree.appendChild(settingsNode);
  settingsNode.addEventListener('click', () => openSettings());
}

/** FGUI 编辑器入口(资源工具箱子节点): 进入独立 FGUI 编辑器页 */
function enterFguiEditor(binPath) {
  clearOverlays();
  fguiEditorShown = true;
  sceneHomeShown = false;
  currentSceneCatId = null;
  pendingFguiEditorBin = binPath || null;
  renderTree();
  renderMainArea();
}

/** 资源工具箱侧栏根节点 + 子菜单 */
function renderToolboxSection(parent) {
  const rootOpen = expandedCats.has('__tools__');
  const root = makeTreeNode({
    icon: '🧰',
    name: '资源工具箱',
    nodeId: '__tools__',
    active: !!currentTool || toolboxHomeShown,
    paddingLeft: 8,
    hasChildren: true,
    isOpen: rootOpen,
  });
  parent.appendChild(root);

  // 箭头点击:展开/折叠工具箱
  root.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand('__tools__');
    renderTree();
  });
  // 名称点击:进入工具箱主页(汇总视图,列出所有子菜单入口)
  root.addEventListener('click', () => {
    clearOverlays();
    toolboxHomeShown = true; // 工具箱主页(汇总视图)
    currentTool = null;
    renderTree();
    renderMainArea();
  });

  if (!rootOpen) return;

  const wrap = document.createElement('div');
  wrap.className = 'tree-items';
  parent.appendChild(wrap);

  // 「文件格式转换」父菜单
  const convOpen = expandedCats.has('__tools_conv__');
  const convHas = true;
  const convNode = makeTreeNode({
    icon: '🔁',
    name: '文件格式转换',
    nodeId: '__tools_conv__',
    active: ['astc2png', 'skel2json', 'spinefix', 'sk2spine'].includes(currentTool || ''),
    paddingLeft: 22,
    hasChildren: convHas,
    isOpen: convOpen,
  });
  wrap.appendChild(convNode);
  convNode.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand('__tools_conv__');
    renderTree();
  });
  convNode.addEventListener('click', () => {
    // 父菜单点名称:进入首个工具(astc2png),也作为默认入口
    openTool('astc2png');
  });

  if (convOpen) {
    const subWrap = document.createElement('div');
    subWrap.className = 'tree-items';
    wrap.appendChild(subWrap);
    const leaves = [
      { id: 'astc2png', icon: '🖼', name: 'astc 转 png' },
      { id: 'skel2json', icon: '📦', name: 'skel 转 json' },
      { id: 'spinefix', icon: '🛠', name: 'spine 文件修复' },
      { id: 'sk2spine', icon: '🦴', name: 'Laya .sk 转 Spine' },
    ];
    for (const l of leaves) {
      const n = makeTreeNode({
        icon: l.icon,
        name: l.name,
        nodeId: '__tool:' + l.id,
        active: currentTool === l.id,
        paddingLeft: 36,
        hasChildren: false,
        isOpen: false,
      });
      n.addEventListener('click', () => openTool(l.id));
      subWrap.appendChild(n);
    }
  }

  // 「图片编辑」叶子节点
  const imgNode = makeTreeNode({
    icon: '🎨',
    name: '图片编辑',
    nodeId: '__tool:imageedit',
    active: currentTool === 'imageedit',
    paddingLeft: 22,
    hasChildren: false,
    isOpen: false,
  });
  wrap.appendChild(imgNode);
  imgNode.addEventListener('click', () => openTool('imageedit'));

  // 「FGUI 导出源」叶子节点(导出标准 FairyGUI 源工程: package.xml + 组件 XML + 碎图 + 字体)
  const fguiNode = makeTreeNode({
    icon: '🧩',
    name: 'FGUI导出源',
    nodeId: '__tool:fgui',
    active: currentTool === 'fgui',
    paddingLeft: 22,
    hasChildren: false,
    isOpen: false,
  });
  wrap.appendChild(fguiNode);
  fguiNode.addEventListener('click', () => openTool('fgui'));

  // 「FGUI 编辑器」叶子节点(独立 FGUI 包可视化编辑器)
  const editorNode = makeTreeNode({
    icon: '✏️',
    name: 'FGUI编辑器',
    nodeId: '__fgui_editor__',
    active: fguiEditorShown,
    paddingLeft: 22,
    hasChildren: false,
    isOpen: false,
  });
  wrap.appendChild(editorNode);
  editorNode.addEventListener('click', () => enterFguiEditor());
}

/** 开发工具箱 API 管理入口(侧栏子节点): 进入内嵌 API 文档页 */
function enterApiDoc() {
  clearOverlays();
  apiDocShown = true;
  renderTree();
  renderMainArea();
}

/** 开发工具箱侧栏根节点 + 子菜单(API 管理) */
function renderDevToolsSection(parent) {
  // ⚠️ 不能在渲染函数里强制 add __devtools__(折叠箭头会失效): 默认展开由 expandedCats 初始值提供, 用户可自由折叠/展开
  const rootOpen = expandedCats.has('__devtools__');
  const root = makeTreeNode({
    icon: '🛠️',
    name: '开发工具箱',
    nodeId: '__devtools__',
    active: apiDocShown,
    paddingLeft: 8,
    hasChildren: true,
    isOpen: rootOpen,
  });
  parent.appendChild(root);
  // 箭头点击:展开/折叠开发工具箱
  root.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand('__devtools__');
    renderTree();
  });
  // 名称点击:进入默认子模块(API 管理)
  root.addEventListener('click', () => enterApiDoc());

  if (!rootOpen) return;

  const wrap = document.createElement('div');
  wrap.className = 'tree-items';
  parent.appendChild(wrap);

  // 「API 管理」叶子节点(内嵌 API 参考文档)
  const apiNode = makeTreeNode({
    icon: '📖',
    name: 'API 管理',
    nodeId: '__devtool:api',
    active: apiDocShown,
    paddingLeft: 22,
    hasChildren: false,
    isOpen: false,
  });
  wrap.appendChild(apiNode);
  apiNode.addEventListener('click', () => enterApiDoc());
}

/** 网络资源抓取页入口: 进入独立网络资源抓取页 */
function enterWebGame() {
  // ⚠️ v1.9.27 修复: 已在抓取页时不得重复 clearOverlays()。
  // clearOverlays 会触发 _webGameDetach→webFloatOut, 把已打开的网页视图迁出主窗口,
  // 导致浏览器显示区黑屏 + 弹出悬浮窗(点击收藏夹目录/历史/网址节点都会复现)。
  if (!webGameShown) {
    clearOverlays();
    webGameShown = true;
  }
  renderTree();
  renderMainArea();
}

/** 网络资源抓取侧栏根节点 + 最近网址 + 网址收藏夹分类树 */
function renderWebGameSection(parent) {
  // ⚠️ 不能在这里强制 add __webgame__/__webgame_fav__(否则折叠箭头点了无效): 默认展开由 expandedCats 初始值提供, 用户折叠/展开状态要能持久
  const rootOpen = expandedCats.has('__webgame__');
  const root = makeTreeNode({
    icon: '🌐',
    name: '网络资源抓取',
    nodeId: '__webgame__',
    active: webGameShown,
    paddingLeft: 8,
    hasChildren: true,
    isOpen: rootOpen,
  });
  parent.appendChild(root);
  root.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand('__webgame__');
    renderTree();
  });
  root.addEventListener('click', () => enterWebGame());
  // 根节点右键:打开抓取页 / 清空捕获 / 新建收藏夹目录
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '打开抓取页', onClick: enterWebGame },
      { label: '新建收藏夹目录', onClick: () => addWebBookmarkCategoryDialog('') },
      { label: '清空捕获记录', onClick: async () => { await window.api.webClearCaptured(); toast('已清空捕获记录'); } },
    ]);
  });
  if (!rootOpen) return;
  const wrap = document.createElement('div');
  wrap.className = 'tree-items';
  parent.appendChild(wrap);

  // 最近打开的游戏(settings.webGameHistory, 点击进入并回填 URL)
  const history = ((state.settings && state.settings.webGameHistory) || []).slice(0, 8);
  if (history.length) {
    const hLabel = makeTreeNode({
      icon: '🕹', name: '最近打开', nodeId: '__webgame_hist__', active: false,
      paddingLeft: 22, hasChildren: true, isOpen: expandedCats.has('__webgame_hist__'),
    });
    wrap.appendChild(hLabel);
    hLabel.querySelector('.cat-arrow').addEventListener('click', (e) => {
      e.stopPropagation(); toggleExpand('__webgame_hist__'); renderTree();
    });
    if (expandedCats.has('__webgame_hist__')) {
      const subWrap = document.createElement('div');
      subWrap.className = 'tree-items';
      wrap.appendChild(subWrap);
      for (const h of history) {
        const n = makeTreeNode({
          icon: '🕹', name: h.title || h.url, nodeId: '__webgame_hist:' + (h.url || ''),
          active: false, paddingLeft: 36, hasChildren: false, isOpen: false,
        });
        n.addEventListener('click', () => {
          enterWebGame();
          const pageEl = document.getElementById('page-webgame');
          if (pageEl && pageEl._webGameSetUrl) pageEl._webGameSetUrl(h.url);
        });
        subWrap.appendChild(n);
      }
    }
  }

  // 网址收藏夹分类树(可嵌套): 默认展开, 方便看到管理入口
  const favLabel = makeTreeNode({
    icon: '🔖', name: '网址收藏夹', nodeId: '__webgame_fav__', active: false,
    paddingLeft: 22, hasChildren: true, isOpen: expandedCats.has('__webgame_fav__'),
  });
  if (rootOpen) wrap.appendChild(favLabel);
  favLabel.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation(); toggleExpand('__webgame_fav__'); renderTree();
  });
  favLabel.addEventListener('click', () => {
    // 点名称:进入抓取页并显示收藏夹面板(全部); keepBrowser 保留浏览器视图(网页已打开时不黑屏)
    enterWebGame();
    const pageEl = document.getElementById('page-webgame');
    if (pageEl && pageEl._webGameShowBookmarks) pageEl._webGameShowBookmarks('all', { keepBrowser: true });
  });
  favLabel.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '新建收藏夹目录', onClick: () => addWebBookmarkCategoryDialog('') },
    ]);
  });
  if (expandedCats.has('__webgame_fav__')) {
    const favWrap = document.createElement('div');
    favWrap.className = 'tree-items';
    wrap.appendChild(favWrap);
    // 分类树(递归); 无「未分类」节点(收藏必须选分类)
    for (const c of getWebBookmarkCategoryChildren('')) {
      renderWebBookmarkCatNode(favWrap, c, 1);
    }
  }
}

/** 网址收藏夹分类树递归节点 */
function renderWebBookmarkCatNode(parent, cat, depth) {
  const bms = webBookmarksInCategory(cat.id);
  const children = getWebBookmarkCategoryChildren(cat.id);
  const hasChildren = children.length > 0 || bms.length > 0;
  const isOpen = expandedCats.has('wbfav:' + cat.id);
  const node = makeTreeNode({
    icon: '▣',
    name: cat.name,
    nodeId: 'wbfav:' + cat.id,
    active: false,
    paddingLeft: 22 + 14 + depth * 14,
    hasChildren,
    isOpen,
    count: bms.length,
  });
  parent.appendChild(node);
  node.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasChildren) return;
    toggleExpand('wbfav:' + cat.id);
    renderTree();
  });
  node.addEventListener('click', () => {
    enterWebGame();
    const pageEl = document.getElementById('page-webgame');
    // keepBrowser: 点击分类目录仅切换侧栏收藏夹视图, 已打开的网页保持显示(不黑屏)
    if (pageEl && pageEl._webGameShowBookmarks) pageEl._webGameShowBookmarks(cat.id, { keepBrowser: true });
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '打开收藏夹', onClick: () => {
          enterWebGame();
          const pageEl = document.getElementById('page-webgame');
          if (pageEl && pageEl._webGameShowBookmarks) pageEl._webGameShowBookmarks(cat.id, { keepBrowser: true });
        } },
      { label: '新建子目录', onClick: () => addWebBookmarkCategoryDialog(cat.id) },
      { label: '编辑目录', onClick: () => editWebBookmarkCategoryDialog(cat.id) },
      { label: '删除目录', danger: true, onClick: () => removeWebBookmarkCategoryDialog(cat.id) },
    ]);
  });
  if (isOpen) {
    const subWrap = document.createElement('div');
    subWrap.className = 'tree-items';
    parent.appendChild(subWrap);
    for (const c of children) renderWebBookmarkCatNode(subWrap, c, depth + 1);
    for (const b of bms) {
      const bn = makeTreeNode({
        icon: '🔗', name: b.name || b.url, nodeId: 'wbfavurl:' + b.id,
        active: false, paddingLeft: 22 + 14 + (depth + 1) * 14, hasChildren: false, isOpen: false,
      });
      bn.addEventListener('click', () => {
        enterWebGame();
        const pageEl = document.getElementById('page-webgame');
        if (pageEl && pageEl._webGameOpenUrl) pageEl._webGameOpenUrl(b.url);
      });
      subWrap.appendChild(bn);
    }
  }
}

/** 游戏场景管理侧栏根节点 + 场景分类树 */
function renderSceneSection(parent) {
  const rootOpen = expandedCats.has('__scene__');
  const root = makeTreeNode({
    icon: '🎬',
    name: '游戏场景管理',
    nodeId: '__scene__',
    active: sceneHomeShown || currentSceneCatId !== null,
    paddingLeft: 8,
    hasChildren: true,
    isOpen: rootOpen,
  });
  parent.appendChild(root);

  root.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand('__scene__');
    renderTree();
  });
  root.addEventListener('click', () => {
    // 根名称点击:进入场景主页
    clearOverlays();
    sceneHomeShown = true;
    currentSceneCatId = null;
    renderTree();
    renderMainArea();
  });
  // 根节点右键:新建顶级场景目录 / 批量添加 FGUI 包
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '新建目录', onClick: () => addSceneCategoryDialog('') },
      { label: '添加 FGUI 包', onClick: () => addFguiPackagesDialog('') },
    ]);
  });

  if (!rootOpen) return;
  const wrap = document.createElement('div');
  wrap.className = 'tree-items';
  parent.appendChild(wrap);

  // 场景分类树(递归)
  for (const c of getSceneCategoryChildren('')) {
    renderSceneCatNode(wrap, c, 1);
  }
}

/** 场景分类树递归节点 */
function renderSceneCatNode(parent, cat, depth) {
  const scenes = scenesInCategory(cat.id);
  const children = getSceneCategoryChildren(cat.id);
  const hasChildren = children.length > 0 || scenes.length > 0;
  const isOpen = expandedCats.has('scene:' + cat.id);
  const node = makeTreeNode({
    icon: '▣',
    name: cat.name,
    nodeId: 'scene:' + cat.id,
    active: currentSceneCatId === cat.id,
    paddingLeft: 8 + 14 + depth * 14,
    hasChildren,
    isOpen,
    count: scenes.length,
  });
  parent.appendChild(node);

  node.querySelector('.cat-arrow').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasChildren) return;
    toggleExpand('scene:' + cat.id);
    renderTree();
  });
  node.addEventListener('click', () => {
    clearOverlays();
    sceneHomeShown = false;
    currentSceneCatId = cat.id;
    renderTree();
    renderMainArea();
  });

  // 右键菜单(与资源目录节点对齐):添加场景 / 新建目录 / 编辑 / 移动到顶级 / 删除
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '添加场景', onClick: () => addSceneDialog(cat.id) },
      { label: '添加 FGUI 包', onClick: () => addFguiPackagesDialog(cat.id) },
      { label: '新建目录', onClick: () => addSceneCategoryDialog(cat.id) },
      { label: '编辑目录', onClick: () => editSceneCategoryDialog(cat.id) },
      { label: '移动到顶级', onClick: () => { updateSceneCategory(cat.id, { parentId: '' }); renderTree(); renderMainArea(); } },
      { label: '删除目录', danger: true, onClick: () => deleteSceneCategoryDialog(cat.id) },
    ]);
  });

  // ---- 场景分类拖拽排序(仅同父分类之间) + 拖入子分类(与资源分类节点一致) ----
  node.draggable = true;
  node.dataset.dragId = cat.id;
  node.addEventListener('dragstart', (e) => {
    dragSceneCatId = cat.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', cat.id); } catch (err) { /* ignore */ }
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragSceneCatId = null;
    lastDragAt = Date.now();
    clearDropMarkers();
  });
  node.addEventListener('dragover', (e) => {
    if (!dragSceneCatId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = node.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (dragSceneCatId === cat.id) return;
    const src = sceneCategoryById(dragSceneCatId);
    if (!src || getSceneCategoryDescendants(cat.id).includes(dragSceneCatId)) return; // 不能拖到自己的子孙下
    const before = y < h / 3;
    const after = y > (h * 2) / 3;
    node.classList.toggle('drop-before', before && (src.parentId || '') === (cat.parentId || ''));
    node.classList.toggle('drop-after', after && (src.parentId || '') === (cat.parentId || ''));
    node.classList.toggle('drop-in', !before && !after && (src.parentId || '') !== cat.id);
  });
  node.addEventListener('dragleave', () => {
    node.classList.remove('drop-before', 'drop-after', 'drop-in');
  });
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drop-before', 'drop-after', 'drop-in');
    if (!dragSceneCatId || dragSceneCatId === cat.id) { dragSceneCatId = null; lastDragAt = Date.now(); return; }
    const src = sceneCategoryById(dragSceneCatId);
    if (!src || getSceneCategoryDescendants(cat.id).includes(dragSceneCatId)) { dragSceneCatId = null; lastDragAt = Date.now(); return; }
    const rect = node.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const before = y < h / 3;
    const after = y > (h * 2) / 3;
    if (!before && !after) {
      // 中部:作为子分类
      if ((src.parentId || '') !== cat.id) {
        updateSceneCategory(dragSceneCatId, { parentId: cat.id });
        expandedCats.add('scene:' + cat.id);
        toast('已移动到「' + cat.name + '」下');
      }
    } else if ((src.parentId || '') === (cat.parentId || '')) {
      reorderSceneCategory(dragSceneCatId, cat.id, before ? 'before' : 'after');
      toast('目录顺序已更新');
    }
    dragSceneCatId = null;
    lastDragAt = Date.now();
    renderTree();
  });

  if (!isOpen || !hasChildren) return;
  const sub = document.createElement('div');
  sub.className = 'tree-items';
  parent.appendChild(sub);
  // 子分类在前
  for (const ch of children) renderSceneCatNode(sub, ch, depth + 1);
  // 直属场景条目(只显示数量,详情在右侧)
  for (const s of scenes) sub.appendChild(makeSceneItemNode(s));
}

/** 侧栏场景条目(只读,显示名称 + 类型图标);点击或右键弹出该场景的操作菜单 */
function makeSceneItemNode(s) {
  const el = document.createElement('div');
  el.className = 'cat-node';
  el.style.paddingLeft = '8px';
  el.innerHTML = `
    <span class="cat-arrow">·</span>
    <span class="cat-icon">${s.type === 'folder' ? '📁' : (s.subtype === 'fgui' ? '🧩' : '📄')}</span>
    <span class="cat-name" title="${esc(s.filePath || s.name)}">${esc(s.name)}</span>
  `;
  const openSceneMenu = (x, y) => {
    const items = [
      ...(s.subtype === 'fgui' ? [{ label: '✏️ 用FGUI编辑器打开', onClick: () => openFguiEditorFromScene(s.id) }] : []),
      { label: '查看路径', onClick: () => toast(s.filePath || '(无路径)', 'info', 4000) },
      { label: '在文件管理器中显示', onClick: () => window.api.showItem(s.filePath) },
      { label: '编辑场景信息', onClick: () => editSceneDialog(s.id) },
      { label: '删除', danger: true, onClick: () => confirmAndRemoveScene(s.id) },
    ];
    showContextMenu(x, y, items);
  };
  // FGUI 界面包条目:单击直接在主内容区用 FGUI 编辑器打开;其它类型弹右键菜单
  el.addEventListener('click', () => {
    if (s.subtype === 'fgui') {
      openFguiEditorFromScene(s.id);
    } else {
      openSceneMenu(window.innerWidth - 240, 120);
    }
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSceneMenu(e.clientX, e.clientY);
  });
  return el;
}

/** 通用树节点构造器(避免在 renderToolboxSection/renderSceneSection 中重复 DOM 代码) */
function makeTreeNode({ icon, name, nodeId, active, paddingLeft, hasChildren, isOpen, count }) {
  const node = document.createElement('div');
  node.className = 'cat-node' + (active ? ' active' : '');
  node.dataset.id = nodeId;
  node.style.paddingLeft = paddingLeft + 'px';
  const arrow = document.createElement('span');
  arrow.className = 'cat-arrow';
  arrow.textContent = hasChildren ? (isOpen ? '▼' : '▶') : '·';
  node.appendChild(arrow);
  const ic = document.createElement('span');
  ic.className = 'cat-icon';
  ic.textContent = icon;
  node.appendChild(ic);
  const nm = document.createElement('span');
  nm.className = 'cat-name';
  nm.textContent = name;
  node.appendChild(nm);
  if (typeof count === 'number') {
    const ct = document.createElement('span');
    ct.className = 'cat-count';
    ct.textContent = count;
    node.appendChild(ct);
  }
  return node;
}

function toggleExpand(key) {
  if (expandedCats.has(key)) expandedCats.delete(key);
  else expandedCats.add(key);
}

function openTool(id) {
  clearOverlays();
  currentTool = id;
  toolboxHomeShown = false;
  // 进入工具箱时默认展开工具箱节点,折叠其它分支
  if (!expandedCats.has('__tools__')) expandedCats.add('__tools__');
  renderTree();
  renderMainArea();
}

/**
 * 进入主区任意(资源 / 收藏夹)页面前,清掉所有"覆盖式"页面状态。
 * renderMainArea 按优先级分发:currentTool → 场景 → 设置 → 收藏夹 → 资源。
 * 若这些状态残留,从工具箱 / 场景管理 / 设置页点击左侧资源分类节点时,
 * 会被旧状态拦截而"看起来无法切换页面"。统一在此清掉,导航才会真正生效。
 */
function clearOverlays() {
  // 离开网络资源抓取页时隐藏浏览器视图(WebContentsView 为 native 叠加, 防止遮挡其它页面)
  if (webGameShown) {
    const pageEl = document.getElementById('page-webgame');
    if (pageEl && pageEl._webGameDetach) pageEl._webGameDetach();
  }
  currentTool = null;
  toolboxHomeShown = false;
  sceneHomeShown = false;
  currentSceneCatId = null;
  fguiPreviewShown = false;
  fguiEditorShown = false;
  settingsShown = false;
  favHomeShown = false;
  currentFavCategoryId = null;
  webGameShown = false;
  apiDocShown = false;
}

// ---- 场景分类/场景条目 操作对话框 ----

function addSceneCategoryDialog(parentId = '') {
  promptDialog({
    title: '新建目录',
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      addSceneCategory({ name, parentId });
      if (parentId) expandedCats.add('scene:' + parentId);
      renderTree();
      renderMainArea();
      toast('已创建目录');
    },
  });
}
function editSceneCategoryDialog(id) {
  const cat = sceneCategoryById(id);
  if (!cat) return;
  promptDialog({
    title: '编辑目录',
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: cat.name }],
    onOk: ({ name }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      updateSceneCategory(id, { name });
      renderTree();
      renderMainArea();
      toast('目录已更新');
    },
  });
}
function deleteSceneCategoryDialog(id) {
  const cat = sceneCategoryById(id);
  if (!cat) return;
  const subs = getSceneCategoryChildren(id);
  const scenes = scenesInCategory(id);
  confirmDialog({
    title: `删除目录「${cat.name}」?`,
    message: `子目录 ${subs.length} 个、场景 ${scenes.length} 个将被一并处理(子目录提升到被删目录的父级;场景条目移到「未分类」)。`,
    onOk: () => {
      removeSceneCategory(id);
      if (currentSceneCatId === id) currentSceneCatId = null;
      renderTree(); renderMainArea();
      toast('已删除目录');
    },
  });
}

// ---- 网址收藏夹(网络资源抓取)对话框 ----

function addWebBookmarkCategoryDialog(parentId = '') {
  promptDialog({
    title: '新建收藏夹目录',
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      addWebBookmarkCategory({ name, parentId });
      if (parentId) expandedCats.add('wbfav:' + parentId);
      expandedCats.add('__webgame_fav__');
      renderTree();
      renderMainArea();
      toast('已创建收藏夹目录');
    },
  });
}
function editWebBookmarkCategoryDialog(id) {
  const cat = webBookmarkCategoryById(id);
  if (!cat) return;
  promptDialog({
    title: '编辑收藏夹目录',
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: cat.name }],
    onOk: ({ name }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      updateWebBookmarkCategory(id, { name });
      renderTree();
      renderMainArea();
      toast('目录已更新');
    },
  });
}
function removeWebBookmarkCategoryDialog(id) {
  const cat = webBookmarkCategoryById(id);
  if (!cat) return;
  const subs = getWebBookmarkCategoryChildren(id);
  const bms = webBookmarksInCategory(id);
  confirmDialog({
    title: `删除收藏夹目录「${cat.name}」?`,
    message: `子目录 ${subs.length} 个、网址 ${bms.length} 个将被一并处理(子目录提升到被删目录的父级;网址移到父分类)。`,
    onOk: () => {
      removeWebBookmarkCategory(id);
      renderTree(); renderMainArea();
      toast('已删除收藏夹目录');
    },
  });
}

/** 新增网址收藏条目(默认收藏当前浏览 URL) */
function addWebBookmarkDialog(categoryId = '', currentUrl = '') {
  promptDialog({
    title: '收藏网址',
    fields: [
      { key: 'url', label: '网址', type: 'text', value: currentUrl },
      { key: 'name', label: '名称(可空,默认取网址)', type: 'text', value: '' },
    ],
    onOk: ({ url, name }) => {
      const u = (url || '').trim();
      if (!u) return toast('网址不能为空', 'error');
      addWebBookmark({ categoryId, url: u, name: (name || '').trim() });
      renderTree(); renderMainArea();
      toast('已收藏网址');
    },
  });
}
function editWebBookmarkDialog(id) {
  const bm = webBookmarkById(id);
  if (!bm) return;
  promptDialog({
    title: '编辑收藏网址',
    fields: [
      { key: 'name', label: '名称', type: 'text', value: bm.name || '' },
      { key: 'url', label: '网址', type: 'text', value: bm.url || '' },
    ],
    onOk: ({ name, url }) => {
      if (!(url || '').trim()) return toast('网址不能为空', 'error');
      updateWebBookmark(id, { name: (name || '').trim() || url, url: (url || '').trim() });
      renderTree(); renderMainArea();
      toast('收藏网址已更新');
    },
  });
}
function removeWebBookmarkDialog(id) {
  const bm = webBookmarkById(id);
  if (!bm) return;
  confirmDialog({
    title: `删除收藏网址「${bm.name || bm.url}」?`,
    message: '',
    onOk: () => {
      removeWebBookmark(id);
      renderTree(); renderMainArea();
      toast('已删除收藏网址');
    },
  });
}
function editSceneDialog(id) {
  const s = state.scenes.find((x) => x.id === id);
  if (!s) return;
  promptDialog({
    title: '编辑场景',
    fields: [{ key: 'name', label: '场景名称', type: 'text', value: s.name }],
    onOk: ({ name }) => {
      if (!name) return toast('场景名称不能为空', 'error');
      updateScene(id, { name });
      renderMainArea();
      renderTree();
      toast('场景已更新');
    },
  });
}
function confirmAndRemoveScene(id) {
  const s = state.scenes.find((x) => x.id === id);
  if (!s) return;
  confirmDialog({
    title: `删除场景「${s.name}」?`,
    message: `将仅从列表中移除,不会删除磁盘上的文件夹或文件。\n路径:${s.filePath}`,
    onOk: () => { removeScene(id); renderMainArea(); renderTree(); toast('已删除'); },
  });
}

/** 添加场景条目:先选文件或目录(支持两种类型),再录入名称/备注;.bin 为 FGUI 界面包时弹登记对话框(所属目录默认=当前目录) */
async function addSceneDialog(catId) {
  const r = await window.api.pickFiles({ directory: false, title: '选择场景文件或目录(可多选)' });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return;
  for (const p of r.filePaths) {
    let stat;
    try { stat = await window.api.statFile(p); } catch (e) { stat = null; }
    // FGUI 界面包(.bin 且 magic 匹配)→ 走登记对话框(默认所属目录 = 当前点击的目录)
    if (isBinExt(p)) {
      let isFgui = false;
      try {
        const pr = await window.api.fguiProbe({ inputPath: p });
        isFgui = !!(pr && pr.ok && pr.isFgui);
      } catch (e) { /* ignore */ }
      if (isFgui) {
        await promptRegisterFgui(p, { defaultCategoryId: catId || '', defaultName: deriveName(p) });
        continue;
      }
    }
    const isProbablyDir = !pathLooksLikeFile(p);
    const type = isProbablyDir ? 'folder' : 'file';
    addScene({
      categoryId: catId || '',
      name: deriveName(p),
      filePath: p,
      type,
      size: stat ? stat.size : null,
      mtime: stat ? stat.mtime : null,
    });
  }
  renderMainArea();
  renderTree();
  toast('已完成场景添加');
}

function isBinExt(p) {
  return /\.bin$/i.test(String(p || ''));
}

/**
 * 批量添加 FGUI 包:支持单选/多选 .bin 文件,以及选择一个或多个目录(目录内扫描 FGUI 包,可选递归子目录)。
 * 所有包一次性登记到指定场景目录(按名称字母排序),自动探测去重并记录大小。
 */
async function addFguiPackagesDialog(catId) {
  const r = await window.api.pickFiles({
    title: '添加 FGUI 包:选择 .bin 文件或目录(可多选;目录将扫描其中的 FGUI 包)',
    filesAndDirs: true,
    filters: [{ name: 'FGUI 包', extensions: ['bin'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return;
  const pickedBins = [];
  const dirs = [];
  for (const p of r.filePaths) {
    if (isBinExt(p)) pickedBins.push(p);
    else dirs.push(p);
  }
  // 选了目录 → 确认是否递归子目录
  let recursive = false;
  if (dirs.length) {
    const rec = await new Promise((resolve) => {
      promptDialog({
        title: '扫描目录中的 FGUI 包',
        fields: [
          {
            key: 'rec', label: '扫描范围', type: 'select',
            options: [
              { value: '0', label: '仅当前目录(不进入子目录)' },
              { value: '1', label: '递归子目录(最多 4 层)' },
            ],
            value: '0',
          },
        ],
        onOk: (v) => resolve(v.rec === '1'),
        onCancel: () => resolve(null),
      });
    });
    if (rec === null) return; // 用户取消
    recursive = rec;
  }
  // 收集全部候选 .bin
  const candidates = [...pickedBins];
  for (const d of dirs) {
    let list = [];
    try { list = await window.api.scanDir(d, recursive); } catch (e) { list = []; }
    for (const it of list || []) {
      if (it.type === 'fgui' && it.file && !candidates.includes(it.file)) candidates.push(it.file);
    }
  }
  if (!candidates.length) { toast('没有找到 FGUI 包', 'error'); return; }
  // 按名称字母排序(中文按拼音),再探测去重登记
  const sorted = candidates.sort((a, b) => {
    const na = (a.split(/[\\/]/).pop() || '').toLowerCase();
    const nb = (b.split(/[\\/]/).pop() || '').toLowerCase();
    return na.localeCompare(nb, 'zh-Hans-CN');
  });
  let added = 0, skipped = 0;
  for (const p of sorted) {
    let isFgui = true;
    try {
      const pr = await window.api.fguiProbe({ inputPath: p });
      isFgui = !!(pr && pr.ok && pr.isFgui);
    } catch (e) { isFgui = false; }
    if (!isFgui) { skipped++; continue; }
    if (findSceneByFilePath(p)) { skipped++; continue; } // 已登记过
    let stat = null;
    try { stat = await window.api.statFile(p); } catch (e) { stat = null; }
    addScene({
      categoryId: catId || '',
      name: deriveName(p),
      filePath: p,
      type: 'file',
      subtype: 'fgui',
      size: stat ? stat.size : null,
      mtime: stat ? stat.mtime : null,
    });
    added++;
  }
  renderMainArea();
  renderTree();
  if (added) toast(`已登记 ${added} 个 FGUI 包${skipped ? `,跳过 ${skipped} 个(重复/非 FGUI)` : ''}`, 'success');
  else toast(skipped ? `没有新增 FGUI 包(跳过 ${skipped} 个重复或非 FGUI 文件)` : '没有新增 FGUI 包', 'error');
}

/** 首页「最近打开」:按路径重新打开资源或 FGUI 包 */
function openRecentPath(path) {
  if (!path) return;
  const norm = String(path).replace(/\\/g, '/');
  // 1) FGUI 包:直接进入 FGUI 编辑器(loadPkg 会按路径关联/登记)
  if (/\.bin$/i.test(path)) {
    enterFguiEditor(path);
    return;
  }
  // 2) 普通资源条目:按路径匹配(任何分类)
  const it = state.items.find((x) => x.filePath && String(x.filePath).replace(/\\/g, '/') === norm);
  if (it) { selectItem(it.id); return; }
  // 3) 场景条目:打开路径
  const sc = state.scenes.find((x) => x.filePath && String(x.filePath).replace(/\\/g, '/') === norm);
  if (sc) { window.api.openPath(sc.filePath); return; }
  toast('该资源已不存在或已被移除', 'error');
}

/** 从场景条目直接进入 FGUI 编辑器(自动加载该条目的 .bin) */
function openFguiEditorFromScene(sceneId) {
  const s = state.scenes.find((x) => x.id === sceneId);
  if (!s || !s.filePath) return;
  clearOverlays();
  fguiEditorShown = true;
  sceneHomeShown = false;
  currentSceneCatId = null;
  pendingFguiEditorBin = s.filePath;
  if (!expandedCats.has('__scene__')) expandedCats.add('__scene__');
  if (!expandedCats.has('__tools__')) expandedCats.add('__tools__');
  renderTree();
  renderMainArea();
}

/** 简易文件/目录判断(无扩展名 + 非已知资源扩展名 → 当作目录) */
function pathLooksLikeFile(p) {
  const base = p.split(/[\\/]/).pop() || '';
  const ext = base.toLowerCase().match(/\.[^.]+$/);
  if (!ext) return false; // 无扩展名视作目录(常见:文件夹)
  const known = ['png','jpg','jpeg','gif','webp','bmp','svg','json','skel','atlas','mp3','wav','ogg','flac','m4a','wma','mp4','webm','glb','gltf','bin'];
  return known.includes(ext[0].slice(1));
}
function deriveName(p) {
  return (p.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '') || '未命名';
}

/** 移动场景到其它分类 */
function moveSceneDialog(id) {
  const s = state.scenes.find((x) => x.id === id);
  if (!s) return;
  const options = [{ label: '未分类', onClick: () => { updateScene(id, { categoryId: '' }); renderMainArea(); renderTree(); } }];
  for (const c of state.sceneCategories) {
    const label = categoryScenePath(c.id) + ' / ' + c.name;
    options.push({ label, onClick: () => { updateScene(id, { categoryId: c.id }); renderMainArea(); renderTree(); } });
  }
  showContextMenu(window.innerWidth - 240, 120, [
    { label: '移动到 →', disabled: true, onClick: () => {} },
    ...options,
  ]);
}
function categoryScenePath(id) {
  const parts = [];
  let cur = sceneCategoryById(id);
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? sceneCategoryById(cur.parentId) : null; }
  return parts.join(' / ');
}

/** 伪节点(类型根节点「XX资源」/ 未分类):均可展开/折叠;类型根节点展开后显示该类型的分类目录 */
function renderPseudoNode(parent, n) {
  const items = itemsForCat(n.id);
  const isOpen = expandedCats.has(n.id);
  const hasItems = items.length > 0;
  const isAll = n.id === 'all';

  const node = document.createElement('div');
  node.className = 'cat-node' + (n.id === currentCategoryId ? ' active' : '');
  node.dataset.id = n.id;

  const arrow = document.createElement('span');
  arrow.className = 'cat-arrow';
  // 有子内容时显示展开/折叠箭头(▶/▼);类型根节点与未分类同样支持展开折叠
  arrow.textContent = hasItems ? (isOpen ? '▼' : '▶') : '·';
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

  // 箭头:点击切换展开/折叠(不触发选中)
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() - lastDragAt < 300) return;
    if (hasItems) {
      if (expandedCats.has(n.id)) expandedCats.delete(n.id);
      else expandedCats.add(n.id);
      renderTree();
    }
  });

  node.addEventListener('click', () => {
    if (Date.now() - lastDragAt < 300) return;
    clearOverlays();
    currentCategoryId = n.id;
    setSetting('lastCategoryId', n.id);
    if (isAll) {
      // 类型主页链接:右侧切到当前类型主页(全部资源列表页)
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

  // 类型根节点(「XX资源」):右键菜单 → 新建顶级目录
  if (isAll) {
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: '新建目录', onClick: () => newCategoryDialog() },
      ]);
    });
  }

  parent.appendChild(node);

  if (isOpen && hasItems) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-items';
    if (isAll) {
      // 该类型的分类目录:未分类在前(若有),顶级分类在后
      // 目录按资源类型标签过滤:无标签 → 所有类型显示;有标签 → 仅标签命中当前类型的目录显示
      const uncatItems = items.filter((i) => !i.categoryId);
      if (uncatItems.length > 0) {
        renderPseudoNode(wrap, { id: '', icon: '○', name: '未分类' });
      }
      for (const c of getCategoryChildren('')) {
        if (catVisibleInGroup(c, currentGroup())) renderCatNode(wrap, c, 0);
      }
    } else {
      // 未分类:展开后显示其直属条目
      for (const it of items) wrap.appendChild(renderItemNode(it));
    }
    parent.appendChild(wrap);
  }
}

/** 递归渲染分类节点(子分类 + 直属条目) */
function renderCatNode(parent, cat, depth) {
  const items = itemsForCat(cat.id);
  // 子分类按资源类型标签过滤(无标签 → 所有类型显示;有标签 → 仅标签命中当前类型的显示)
  const children = getCategoryChildren(cat.id).filter((c) => catVisibleInGroup(c, currentGroup()));
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
  // 悬停提示:资源类型标签(备注字段已改为标签勾选)
  const tagNames = categoryTypeTagNames(cat);
  name.title = tagNames.length ? `资源类型: ${tagNames.join(' / ')}` : '所有资源类型';
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
  favBtn.title = allFav ? '整个目录已收藏(点击可收藏到其他位置)' : '收藏整个目录到收藏夹';
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

  // ---- 右键菜单:新建目录 / 编辑 / 移动... / 删除 ----
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
    clearOverlays();
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
    { label: '新建目录', onClick: () => newSubCategoryDialog(cat) },
    { label: '编辑目录', onClick: () => editCategoryDialog(cat.id) },
    { label: '移动...', onClick: () => moveCategoryDialog(cat) },
    { label: '删除', danger: true, onClick: () => deleteCategoryDialog(cat.id) },
  ]);
}

/** 目录的资源类型标签勾选字段(新建/编辑目录对话框复用;不勾选 = 在所有资源类型中显示) */
function typeTagField(value) {
  return {
    key: 'typeTags',
    label: '资源类型标签',
    type: 'checkboxes',
    options: CAT_TYPE_TAGS.map((t) => ({ value: t, label: CAT_TYPE_TAG_LABELS[t] })),
    value: Array.isArray(value) ? value : [],
    hint: '不勾选 = 在所有资源类型中显示;勾选后仅在该类型(可多选)的资源树中显示',
  };
}

/** 新建子目录 */
function newSubCategoryDialog(parent) {
  promptDialog({
    title: '新建目录',
    fields: [
      { key: 'name', label: '子目录名称', type: 'text', value: '' },
      typeTagField([]),
    ],
    onOk: ({ name, typeTags }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      addCategory({ name, typeTags, parentId: parent.id });
      expandedCats.add(parent.id);
      renderCategories();
      renderMainArea();
      toast(`已创建子目录「${name}」`);
    },
  });
}

/** 移动目录到其它目录下(或顶级) */
function moveCategoryDialog(cat) {
  // 候选:顶级 + 其它非自身/非子孙目录
  const exclude = new Set([cat.id, ...getCategoryDescendants(cat.id)]);
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = `<span class="ro">将目录「<b>${esc(cat.name)}</b>」移动到:</span>`;
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
  pick('', '移至顶级(不作为子目录)');
  for (const c of state.categories) {
    if (exclude.has(c.id)) continue;
    pick(c.id, categoryPath(c.id));
  }
  body.appendChild(list);

  const { close } = openModal({
    title: '移动目录',
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
          toast('目录已移动');
        },
      },
    ]),
  });
}

/** 批量删除目录(主页管理模式): 按默认语义删除目录下所有动画和子目录(仅从列表移除,不删磁盘文件) */
function batchDeleteCategories(ids) {
  const cats = ids.map((id) => categoryById(id)).filter(Boolean);
  if (!cats.length) return;
  let nItems = 0, nSubs = 0;
  for (const c of cats) {
    const desc = getCategoryDescendants(c.id);
    nItems += state.items.filter((i) => i.categoryId === c.id || desc.includes(i.categoryId)).length;
    nSubs += getCategoryChildren(c.id).length;
  }
  confirmDialog({
    title: `删除选中的 ${cats.length} 个目录?`,
    message: `将删除 ${cats.length} 个目录${nSubs ? '、' + nSubs + ' 个子目录' : ''}和 ${nItems} 个动画资源,<br/>仅从列表移除,<b>不会删除</b>磁盘上的文件。`,
    onOk: () => {
      for (const c of cats) {
        removeCategoryAdvanced(c.id, { deleteItems: true, subAction: 'parent', subTargetId: '' });
      }
      renderMainArea();
      renderCategories();
      toast('目录已删除');
    },
  });
}

/** 批量移动目录(主页管理模式): 选择目标目录后统一移动 */
function batchMoveCategoriesDialog(ids) {
  const cats = ids.map((id) => categoryById(id)).filter(Boolean);
  if (!cats.length) return;
  // 目标排除: 选中的目录本身及其子孙
  const exclude = new Set();
  for (const c of cats) {
    exclude.add(c.id);
    for (const d of getCategoryDescendants(c.id)) exclude.add(d);
  }
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'form-row';
  tip.innerHTML = `<span class="ro">将选中的 <b>${cats.length}</b> 个目录移动到:</span>`;
  body.appendChild(tip);

  const list = document.createElement('div');
  list.className = 'fav-pick-list';
  let checked = false;
  const pick = (value, label) => {
    const lb = document.createElement('label');
    lb.className = 'fav-pick-item';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'batch-movecat';
    rb.value = value;
    if (!checked) { rb.checked = true; checked = true; }
    const sp = document.createElement('span');
    sp.textContent = label;
    lb.appendChild(rb);
    lb.appendChild(sp);
    list.appendChild(lb);
  };
  pick('', '移至顶级(不作为子目录)');
  for (const c of state.categories) {
    if (exclude.has(c.id)) continue;
    pick(c.id, categoryPath(c.id));
  }
  body.appendChild(list);

  const { close } = openModal({
    title: '移动目录',
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
          for (const c of cats) updateCategory(c.id, { parentId: target });
          close();
          if (target) expandedCats.add(target);
          renderCategories();
          renderMainArea();
          toast(`已移动 ${cats.length} 个目录`);
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
  node.className = 'cat-node fav-root' + (favHomeShown ? ' active' : '');
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
  // 箭头:点击切换展开/折叠(不触发选中)
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    if (total === 0) return;
    if (expandedCats.has('__fav__')) expandedCats.delete('__fav__');
    else expandedCats.add('__fav__');
    renderTree();
  });
  // 节点点击:右侧切换到收藏夹主页
  node.addEventListener('click', () => {
    clearOverlays();
    favHomeShown = true;
    currentFavCategoryId = null;
    renderTree();
    renderMainArea();
  });
  // 右键:收藏夹主页 / 新建收藏分类
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: '收藏夹主页', onClick: () => { favHomeShown = true; currentFavCategoryId = null; renderTree(); renderMainArea(); } },
      { label: '新建收藏分类', onClick: () => newFavCategoryDialog() },
    ]);
  });
  tree.appendChild(node);

  if (!isOpen) return;

  // 收藏分类目录
  for (const fc of state.favCategories) {
    const fcOpen = expandedCats.has('fav:' + fc.id);
    const fItems = favItems.filter((f) => f.favCategoryId === fc.id);
    const fcNode = document.createElement('div');
    fcNode.className = 'cat-node fav-cat' + (currentFavCategoryId === fc.id ? ' active' : '');
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

    // 箭头:点击切换展开/折叠(不触发选中)
    fcArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastDragAt < 300) return;
      if (fItems.length) {
        if (expandedCats.has('fav:' + fc.id)) expandedCats.delete('fav:' + fc.id);
        else expandedCats.add('fav:' + fc.id);
        renderTree();
      }
    });
    // 节点点击:右侧切换到收藏夹目录列表页(不展开树内条目)
    fcNode.addEventListener('click', () => {
      if (Date.now() - lastDragAt < 300) return;
      clearOverlays();
      currentFavCategoryId = fc.id;
      favHomeShown = false;
      renderTree();
      renderMainArea();
    });
    // 右键:编辑收藏分类 / 删除收藏分类
    fcNode.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFavCategoryMenu(e.clientX, e.clientY, fc);
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

/** 资源悬停提示(多行):名称/类型/分类/标签/备注/文件(树内条目/收藏夹条目共用) */
function itemTooltipText(it) {
  if (!it) return '';
  const tags = itemTags(it);
  const typeName = it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type] || it.type;
  const catName = it.categoryId ? (categoryById(it.categoryId)?.name || '未分类') : '未分类';
  const lines = [`名称: ${it.displayName || ''}`, `类型: ${typeName}`, `分类: ${catName}`];
  if (tags.length) lines.push(`标签: ${tags.join('、')}`);
  if (it.remark) lines.push(`备注: ${it.remark}`);
  lines.push(`文件: ${it.filePath || ''}`);
  return lines.join('\n');
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
  // 优化(v1.7.1):原生 title 改为简短信息,避免完整文件路径(~100+ 字符)
  // 触发的超长 tooltip 在 Windows 上频繁弹出导致的合成开销与潜在系统交互。
  // 完整信息保留在右键"属性"对话框(folderPage/主页条目侧完整可见)。
  nm.title = `${it.displayName || ''} · ${it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type] || it.type}`;
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

  // ---- 条目拖拽:优化(v1.7.1)----
  // 原 row.draggable=true 在大量条目侧栏(本机实测 495+ 条 spine)密集 hover/划过时,
  // 用户无意识按住鼠标会触发 HTML5 拖拽 → Windows 启动 OLE 拖拽会话,
  // 鼠标被系统捕获用于 OLE 拖拽,且 Chromium 在大量 draggable 元素间频繁重建 OLE 会话,
  // 导致"鼠标移动变慢,好一会才恢复"(Chromium / Windows 已知问题)。
  // 去掉 draggable,改用右键菜单"移动到..."(moveItemDialog 已存在)承担分类移动功能。
  // 分类节点的 draggable 保留(数量少,~20 个,误触概率低)。
  // 分类节点 dragover/drop 的 dragKind==='item' 分支变成死代码,保留无害(防御未来回滚)。
  // row.dataset.dragItemId 也不再需要,但保留以防外部脚本依赖。
  row.dataset.dragItemId = it.id;

  row.addEventListener('click', () => {
    if (Date.now() - lastDragAt < 300) return;
    selectItem(it.id);
  });
  return row;
}

/** 条目右键菜单;编辑模式多选时 → 批量操作菜单(标签/移动/收藏/删除) */
function openItemMenu(x, y, it) {
  // 编辑模式:右键作用于选中集(右键未选中项 → 先单选它)
  if (editModeActive) {
    if (!editSelected.has(it.id)) {
      editSelected.clear();
      editSelected.add(it.id);
      renderMainArea(); // 刷新选中态(菜单浮层尚未创建,不受影响)
    }
    const ids = [...editSelected];
    showContextMenu(x, y, [
      { label: `编辑标签 (${ids.length} 项)`, onClick: () => batchEditTagsDialog(ids) },
      { label: '移动到...', onClick: () => batchMoveItems(ids) },
      { label: '收藏', onClick: () => collectTargetDialog(ids) },
      { label: '删除', danger: true, onClick: () => batchDeleteItems(ids) },
      { label: '取消选择', onClick: () => { editSelected.clear(); renderMainArea(); } },
    ]);
    return;
  }
  // 单条目菜单
  const firstLabel = it.type === 'image' ? '预览' : '播放';
  const items = [
    { label: firstLabel, onClick: () => selectItem(it.id) },
    { label: '打开目录', onClick: () => window.api.showItem(it.filePath) },
    { label: '编辑', onClick: () => editItemDialog(it.id) },
    { label: '重命名', onClick: () => renameItemDialog(it) },
    { label: '移动到...', onClick: () => moveItemDialog(it) },
  ];
  // 音频资源:可添加到指定播放列表
  if (it.type === 'audio') {
    items.push({ label: '添加到播放列表...', onClick: () => addToPlaylistDialog([it.filePath]) });
  }
  items.push(
    { label: '收藏', onClick: () => collectTargetDialog([it.id]) },
    { label: '删除', danger: true, onClick: () => deleteItemDialog(it.id) },
    { label: '属性', onClick: () => itemPropertiesDialog(it) },
  );
  showContextMenu(x, y, items);
}

/** 收藏夹上下文条目右键菜单(预览/打开目录/编辑/移动收藏分类/取消收藏/属性) */
function openFavItemMenu(x, y, it) {
  const favId = it && it._favId;
  const firstLabel = it.type === 'image' ? '预览' : '播放';
  const items = [
    { label: firstLabel, onClick: () => selectItem(it.id) },
    { label: '打开目录', onClick: () => window.api.showItem(it.filePath) },
    { label: '编辑', onClick: () => editItemDialog(it.id) },
  ];
  if (favId) {
    items.push({
      label: '移动到其他收藏分类',
      onClick: () => {
        const fav = state.favItems.find((f) => f.id === favId);
        collectTargetDialog([it.id], { move: fav });
      },
    });
    items.push({
      label: '取消收藏',
      onClick: () => {
        const fav = state.favItems.find((f) => f.id === favId);
        removeFavItem(it.id, fav ? fav.favCategoryId : undefined);
        renderMainArea(); renderCategories();
        toast('已取消收藏');
      },
    });
  }
  items.push({ label: '属性', onClick: () => itemPropertiesDialog(it) });
  showContextMenu(x, y, items);
}

/** 收藏分类右键菜单(编辑/删除) */
function openFavCategoryMenu(x, y, fc) {
  showContextMenu(x, y, [
    { label: '编辑分类', onClick: () => editFavCategoryDialog(fc.id) },
    { label: '删除分类', danger: true, onClick: () => deleteFavCategoryDialog(fc.id) },
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
  const tagHtml = itemTags(it).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join(' ');
  const rows = [
    ['名称', it.displayName],
    ['类型', TYPE_LABEL[it.type] || it.type],
    ['所属分类', catName],
    ['文件', it.filePath],
    ['大小', it.size != null ? formatSize(it.size) : '—'],
    ['修改时间', it.mtime ? fmt(it.mtime) : '—'],
    ['贴图集', it.atlasPath || '—'],
    ['备注', it.remark || '—'],
    ['标签', tagHtml || '—', true],
    ['创建时间', fmt(it.createdAt)],
    ['更新时间', fmt(it.updatedAt)],
  ];
  for (const [k, v, isHtml] of rows) {
    const row = document.createElement('div');
    row.className = 'form-row';
    if (k === '文件') {
      const label = document.createElement('label');
      label.className = 'f-label';
      label.textContent = k;
      row.appendChild(label);
      row.appendChild(makeCopyablePath(v, { mono: true, wrap: true }));
      body.appendChild(row);
      continue;
    }
    if (isHtml) {
      row.innerHTML = `<label class="f-label">${k}</label><span class="ro-tags" style="flex:1;white-space:normal;word-break:break-all">${v}</span>`;
    } else {
      row.innerHTML = `<label class="f-label">${k}</label><span class="ro" style="flex:1;white-space:normal;word-break:break-all">${esc(v)}</span>`;
    }
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
  nm.title = it ? itemTooltipText(it) : '';
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

  if (it) {
    row.addEventListener('click', () => selectItem(it.id));
    // 右键:预览/打开目录/编辑/移动到其他收藏分类/取消收藏/属性(与收藏夹目录页一致)
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFavItemMenu(e.clientX, e.clientY, { ...it, _favId: f.id });
    });
  }
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
      // 删除的是当前展示的收藏分类/主页 → 回到收藏夹主页
      if (currentFavCategoryId === id || favHomeShown) {
        currentFavCategoryId = null;
        favHomeShown = true;
      }
      renderTree();
      renderMainArea();
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
    title: '新建目录',
    fields: [
      { key: 'name', label: '目录名称', type: 'text', value: '' },
      typeTagField([]),
    ],
    onOk: ({ name, typeTags }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      addCategory({ name, typeTags });
      expandedCats.add('all'); // 展开「XX资源」根, 让新建的顶级目录可见
      renderCategories();
      renderMainArea();
      toast('目录已创建');
    },
  });
}

function editCategoryDialog(id) {
  const cat = categoryById(id);
  if (!cat) return;
  promptDialog({
    title: '编辑目录',
    fields: [
      { key: 'name', label: '目录名称', type: 'text', value: cat.name },
      typeTagField(cat.typeTags),
    ],
    onOk: ({ name, typeTags }) => {
      if (!name) return toast('目录名称不能为空', 'error');
      updateCategory(id, { name, typeTags });
      renderCategories();
      renderItems();
      renderMainArea();
      toast('目录已更新');
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
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">将删除目录「<b>${esc(cat.name)}</b>」(${nItems} 个动画${hasSubs ? `,${subs.length} 个子目录` : ''}),请选择处理方式:</div>`;

  // 动画处理方式
  const animRow = document.createElement('div');
  animRow.className = 'form-row';
  const optDel = document.createElement('label');
  optDel.className = 'fav-pick-item';
  const rbDel = document.createElement('input');
  rbDel.type = 'radio';
  rbDel.name = 'delcat-anim';
  rbDel.value = 'delete';
  rbDel.checked = true; // 默认: 删除目录下的所有动画和子目录(仅从列表移除,不删磁盘文件)
  optDel.appendChild(rbDel);
  optDel.appendChild(document.createTextNode('删除目录下的所有动画(仅从列表移除,不删磁盘文件)和子目录'));
  const optMove = document.createElement('label');
  optMove.className = 'fav-pick-item';
  const rbMove = document.createElement('input');
  rbMove.type = 'radio';
  rbMove.name = 'delcat-anim';
  rbMove.value = 'move';
  optMove.appendChild(rbMove);
  optMove.appendChild(document.createTextNode('将目录下的动画移动到「未分类」'));
  body.appendChild(optDel);
  body.appendChild(optMove);

  // 子分类处理(仅"移动动画"模式;删除模式下子分类一并删除)
  const subBox = document.createElement('div');
  if (hasSubs) {
    const subTip = document.createElement('div');
    subTip.className = 'hint';
    subTip.style.margin = '8px 0 4px';
    subTip.textContent = '子目录处理:';
    subBox.appendChild(subTip);
    const optUp = document.createElement('label');
    optUp.className = 'fav-pick-item';
    const rbUp = document.createElement('input');
    rbUp.type = 'radio';
    rbUp.name = 'delcat-sub';
    rbUp.value = 'parent';
    rbUp.checked = true;
    optUp.appendChild(rbUp);
    optUp.appendChild(document.createTextNode(cat.parentId ? '提升为上一级目录的子目录' : '提升为顶级目录'));
    const optTo = document.createElement('label');
    optTo.className = 'fav-pick-item';
    const rbTo = document.createElement('input');
    rbTo.type = 'radio';
    rbTo.name = 'delcat-sub';
    rbTo.value = 'category';
    optTo.appendChild(rbTo);
    optTo.appendChild(document.createTextNode('移动到指定目录下:'));
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
    title: '删除目录',
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
          toast('目录已删除');
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

/** 切换主显示区域页面(home / folder / preview / toolbox / scene / audio-home) */
function showPage(pageId) {
  const pages = {
    home: document.getElementById('page-home'),
    folder: document.getElementById('page-folder'),
    preview: document.getElementById('page-preview'),
    toolbox: document.getElementById('page-toolbox'),
    scene: document.getElementById('page-scene'),
    'fgui-editor': document.getElementById('page-fgui-editor'),
    settings: document.getElementById('page-settings'),
    'audio-home': document.getElementById('page-audio-home'),
    webgame: document.getElementById('page-webgame'),
    api: document.getElementById('page-api'),
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

/** 打开系统设置页(保存当前主区状态,关闭后恢复) */
export function openSettings() {
  // 先隐藏网页抓取原生视图(WebContentsView 是原生叠加层, 不隐藏会被它盖住设置页)
  if (webGameShown) {
    const pageEl = document.getElementById('page-webgame');
    if (pageEl && pageEl._webGameDetach) pageEl._webGameDetach();
  }
  settingsReturn = {
    currentTool,
    toolboxHomeShown,
    fguiPreviewShown,
    fguiEditorShown,
    sceneHomeShown,
    currentSceneCatId,
    webGameShown,
    apiDocShown,
    favHomeShown,
    currentFavCategoryId,
    lastFolderTab,
  };
  // 清空所有覆盖式页面状态, 让 renderMainArea 能分发到 settings 分支
  currentTool = null;
  toolboxHomeShown = false;
  fguiPreviewShown = false;
  fguiEditorShown = false;
  sceneHomeShown = false;
  currentSceneCatId = null;
  webGameShown = false;
  apiDocShown = false;
  favHomeShown = false;
  currentFavCategoryId = null;
  settingsShown = true;
  renderMainArea();
  renderCategories();
}

/** 关闭系统设置页,恢复到打开前的状态 */
export function closeSettings() {
  settingsShown = false;
  if (settingsReturn) {
    currentTool = settingsReturn.currentTool;
    toolboxHomeShown = settingsReturn.toolboxHomeShown;
    fguiPreviewShown = settingsReturn.fguiPreviewShown;
    fguiEditorShown = settingsReturn.fguiEditorShown;
    sceneHomeShown = settingsReturn.sceneHomeShown;
    currentSceneCatId = settingsReturn.currentSceneCatId;
    webGameShown = settingsReturn.webGameShown;
    apiDocShown = settingsReturn.apiDocShown;
    favHomeShown = settingsReturn.favHomeShown;
    currentFavCategoryId = settingsReturn.currentFavCategoryId;
    lastFolderTab = settingsReturn.lastFolderTab;
    settingsReturn = null;
  }
  // 若之前在网页抓取页, 还原被浮出的原生视图(回到主窗口内嵌)
  if (webGameShown) {
    try { window.api.webFloatBack(); } catch (e) { /* ignore */ }
  }
  renderMainArea();
  renderCategories();
}

/** 渲染主区域(工具箱 / 场景管理 / 收藏夹页面 / 按 tab + 当前分类分发) */
export function renderMainArea() {
  syncTabFromState(); // 多标签:渲染前同步标签条(内容与标签一致)
  updateBackSpecial(); // 同步顶栏"返回"按钮的显隐
  // ---- 资源工具箱主页(汇总视图:列出所有子菜单入口) ----
  if (toolboxHomeShown) {
    showPage('toolbox');
    renderToolboxPage(document.getElementById('page-toolbox'), '__home__');
    renderBreadcrumb();
    return;
  }
  // ---- 资源工具箱子页面 ----
  if (currentTool) {
    showPage('toolbox');
    renderToolboxPage(document.getElementById('page-toolbox'), currentTool);
    renderBreadcrumb();
    return;
  }

  // ---- FGUI 界面预览子页(场景管理内) ----
  if (fguiPreviewShown) {
    showPage('scene');
    const initialBinPath = pendingFguiBin;
    pendingFguiBin = null;
    renderFguiPreviewPage(document.getElementById('page-scene'), {
      initialBinPath,
      onBack: () => {
        fguiPreviewShown = false;
        sceneHomeShown = true;
        currentSceneCatId = null;
        renderTree();
        renderMainArea();
      },
    });
    renderBreadcrumb();
    return;
  }

  // ---- FGUI 编辑器(独立页) ----
  if (fguiEditorShown) {
    showPage('fgui-editor');
    const initialBinPath = pendingFguiEditorBin;
    pendingFguiEditorBin = null;
    const pageEl = document.getElementById('page-fgui-editor');
    // 已初始化则保留实例与编辑状态;仅在有待加载 bin 时加载
    renderFguiEditorPage(pageEl, { initialBinPath });
    renderBreadcrumb();
    return;
  }
  // ---- 场景管理 ----
  if (sceneHomeShown || currentSceneCatId !== null) {
    showPage('scene');
    if (sceneHomeShown) {
      renderSceneHome(document.getElementById('page-scene'), {
        onOpenCat: (catId) => {
          sceneHomeShown = false;
          currentSceneCatId = catId;
          expandedCats.add('scene:' + (catId || '__scene_uncat__'));
          renderMainArea(); renderCategories();
        },
        onAddScene: (catId) => addSceneDialog(catId || ''),
        onAddCategory: (parentId) => addSceneCategoryDialog(parentId || ''),
        onAddFguiPackages: (catId) => addFguiPackagesDialog(catId || ''),
        onFguiPreview: (sceneId) => openFguiEditorFromScene(sceneId),
        onRefresh: () => renderMainArea(),
      });
    } else {
      renderSceneFolderPage(document.getElementById('page-scene'), {
        catId: currentSceneCatId,
        actions: {
          onAddScene: (catId) => addSceneDialog(catId),
          onAddCategory: (parentId) => addSceneCategoryDialog(parentId),
          onAddFguiPackages: (catId) => addFguiPackagesDialog(catId),
          onFguiPreview: (sceneId) => openFguiEditorFromScene(sceneId),
          onEditScene: (id) => editSceneDialog(id),
          onRemoveScene: (id) => confirmAndRemoveScene(id),
          onMoveScene: (id) => moveSceneDialog(id),
          onShowInFolder: (filePath) => window.api.showItem(filePath),
          onOpenPath: (filePath) => window.api.openPath(filePath),
          onBackHome: () => {
            sceneHomeShown = true;
            currentSceneCatId = null;
            renderMainArea(); renderCategories();
          },
          onCatMenu: (cat, e) => showContextMenu(e.clientX, e.clientY, [
            { label: '新建目录', onClick: () => addSceneCategoryDialog(cat.id) },
            { label: '编辑分类', onClick: () => editSceneCategoryDialog(cat.id) },
            { label: '提升到顶级', onClick: () => { updateSceneCategory(cat.id, { parentId: '' }); renderTree(); renderMainArea(); } },
            { label: '删除分类', danger: true, onClick: () => deleteSceneCategoryDialog(cat.id) },
          ]),
          onRefresh: () => renderMainArea(),
        },
      });
    }
    renderBreadcrumb();
    return;
  }

  // ---- 网络资源抓取(独立页) ----
  if (webGameShown) {
    showPage('webgame');
    const pageEl = document.getElementById('page-webgame');
    renderWebGamePage(pageEl, {});
    // 供 webGamePage 收藏夹增删改/移动后刷新侧栏树(网址/计数/分类结构)
    if (!pageEl._webGameTreeRefresher) pageEl._webGameTreeRefresher = () => renderTree();
    renderBreadcrumb();
    // 上报浏览器视图矩形(WebContentsView 为 native 叠加, 需同步位置与大小)
    if (pageEl._webGameSyncBounds) pageEl._webGameSyncBounds();
    return;
  }

  // ---- 开发工具箱:API 管理(独立页, 内嵌 api-doc.html) ----
  if (apiDocShown) {
    showPage('api');
    renderApiPage(document.getElementById('page-api'), {});
    renderBreadcrumb();
    return;
  }

  // ---- 系统设置 ----
  if (settingsShown) {
    showPage('settings');
    renderSettingsPage(document.getElementById('page-settings'), {
      onClose: () => closeSettings(),
    });
    renderBreadcrumb();
    return;
  }

  // 收藏夹主页
  if (favHomeShown) {
    showPage('home');
    renderFavHome(document.getElementById('page-home'), {
      onOpenFavCat: (fcId) => {
        currentFavCategoryId = fcId;
        favHomeShown = false;
        expandedCats.add('fav:' + fcId);
        renderMainArea(); renderCategories();
      },
      onOpenItem: (itemId) => selectItem(itemId),
      onItemMenu: (it, e) => openFavItemMenu(e.clientX, e.clientY, it),
      onFavCatMenu: (fc, e) => openFavCategoryMenu(e.clientX, e.clientY, fc),
      onEditFavCat: (fcId) => editFavCategoryDialog(fcId),
      onDeleteFavCat: (fcId) => deleteFavCategoryDialog(fcId),
      onRefresh: () => renderMainArea(),
    });
    renderBreadcrumb();
    return;
  }
  // 收藏夹目录列表页
  if (currentFavCategoryId) {
    showPage('folder');
    renderFavFolderPage(document.getElementById('page-folder'), {
      favCategoryId: currentFavCategoryId,
      viewMode: (state.settings && state.settings.listViewMode) || 'list',
      sortBy: (state.settings && state.settings.listSortBy) || 'name',
      sortDir: (state.settings && state.settings.listSortDir) || 'asc',
      actions: {
        onOpenItem: (itemId) => selectItem(itemId),
        onItemMenu: (it, e) => openFavItemMenu(e.clientX, e.clientY, it),
        onViewMode: (mode) => { setListViewMode(mode); renderMainArea(); },
        onSort: (by, dir) => { setListSort(by, dir); renderMainArea(); },
        onUnfav: (favId, itemId) => {
          const fav = state.favItems.find((f) => f.id === favId);
          removeFavItem(itemId, fav ? fav.favCategoryId : undefined);
          renderMainArea(); renderCategories();
          toast('已取消收藏');
        },
        onMoveFav: (favId, itemId) => {
          const fav = state.favItems.find((f) => f.id === favId);
          collectTargetDialog([itemId], { move: fav });
        },
        onEditFavCat: (fcId) => editFavCategoryDialog(fcId),
        onDeleteFavCat: (fcId) => deleteFavCategoryDialog(fcId),
      },
    });
    renderBreadcrumb();
    return;
  }

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
      // 首页「最近打开」:按路径重新打开资源 / FGUI 包
      onOpenRecent: (path) => openRecentPath(path),
      onItemMenu: (it, e) => openItemMenu(e.clientX, e.clientY, it),
      onCatMenu: (cat, e) => openCategoryMenu(e.clientX, e.clientY, cat),
      onRefresh: () => renderMainArea(),
      // 主页目录管理模式: 批量删除 / 移动
      onManageDelete: (ids) => batchDeleteCategories(ids),
      onManageMove: (ids) => batchMoveCategoriesDialog(ids),
    });
  } else if (currentCategoryId === 'all' || currentCategoryId === '') {
    if (tab === 'audio') {
      // 音频类型主页 = 音频播放器主页(分类目录作为播放列表 + 自建播放列表标签页切换)
      showPage('audio-home');
      renderAudioHomePage(document.getElementById('page-audio-home'));
      renderBreadcrumb();
      return;
    }
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
      tagFilter: folderTagFilter,
      searchText: folderSearchText,
      actions: {
        onOpenCat: (catId) => {
          currentCategoryId = catId;
          setSetting('lastCategoryId', catId);
          expandedCats.add(catId);
          folderTagFilter = '';
          folderSearchText = '';
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
        onTagFilter: (tag) => { folderTagFilter = tag; renderMainArea(); },
        onSearch: (q) => {
          folderSearchText = q;
          renderMainArea();
          // 重渲染后恢复焦点与光标(输入过程不中断)
          const inp = document.getElementById('folder-search');
          if (inp) {
            inp.focus();
            const len = inp.value.length;
            inp.setSelectionRange(len, len);
          }
        },
        onClearFilter: () => { folderTagFilter = ''; folderSearchText = ''; renderMainArea(); },
        onAdd: () => runAddFlow(false, currentCategoryId === 'all' || currentCategoryId === '' ? '' : currentCategoryId),
        // ---- 编辑模式 ----
        onToggleEditMode: () => {
          editModeActive = !editModeActive;
          editSelected.clear();
          editAnchorId = null;
          renderMainArea();
        },
        onEditToggleItem: (itemId) => {
          if (editSelected.has(itemId)) editSelected.delete(itemId);
          else editSelected.add(itemId);
          editAnchorId = itemId; // 普通点击更新 Shift 范围锚点
          renderMainArea();
        },
        onEditCtrlSelect: (itemId) => {
          // Ctrl+点击:进入编辑选择模式并切换该条目选中
          if (!editModeActive) { editModeActive = true; editSelected.clear(); }
          if (editSelected.has(itemId)) editSelected.delete(itemId);
          else editSelected.add(itemId);
          editAnchorId = itemId;
          renderMainArea();
        },
        onEditShiftSelect: (itemId) => {
          // Shift+点击:进入编辑选择模式;已有锚点则按目录渲染顺序范围选中 anchor..itemId
          if (!editModeActive) { editModeActive = true; editSelected.clear(); }
          if (!editAnchorId || !state.items.some((i) => i.id === editAnchorId)) {
            editAnchorId = itemId; // 首次 Shift:锚点 = 点击项
            editSelected.clear();
            editSelected.add(itemId);
          } else {
            const grp = currentGroup();
            const data = getFolderData(currentCategoryId, grp);
            const sorted = sortItems(
              data.direct,
              (state.settings && state.settings.listSortBy) || 'name',
              (state.settings && state.settings.listSortDir) || 'asc'
            );
            const ids = sorted.map((i) => i.id);
            const a = ids.indexOf(editAnchorId);
            const b = ids.indexOf(itemId);
            if (a >= 0 && b >= 0) {
              const [lo, hi] = a <= b ? [a, b] : [b, a];
              editSelected.clear();
              for (let i = lo; i <= hi; i++) editSelected.add(ids[i]);
            } else {
              editAnchorId = itemId;
              editSelected.clear();
              editSelected.add(itemId);
            }
          }
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
    favHomeShown = false;
    currentFavCategoryId = null;
    currentTool = null;
    toolboxHomeShown = false;
    sceneHomeShown = false;
    currentSceneCatId = null;
    fguiPreviewShown = false;
    pendingFguiBin = null;
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
    brand.title = '回到全部资源首页';
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => {
      setResourceTab('home');
      favHomeShown = false;
      currentFavCategoryId = null;
      currentTool = null;
      toolboxHomeShown = false;
      sceneHomeShown = false;
      currentSceneCatId = null;
      fguiPreviewShown = false;
      pendingFguiBin = null;
      apiDocShown = false;
      renderMainArea();
      renderCategories();
      syncTabs();
    });
  }
}

/** 覆盖式页面的"返回"按钮(资源工具箱 / 游戏场景管理):点击回到资源浏览区 */
function bindBackSpecial() {
  const btn = document.getElementById('btn-back-special');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (settingsShown) { closeSettings(); return; }
    clearOverlays(); // 清掉工具箱/场景等覆盖状态,回到进入前的资源区(resourceTab/currentCategoryId 不变)
    renderMainArea();
    renderCategories();
    syncTabs();
  });
}

/** 根据当前页面状态显示/隐藏"返回"按钮(仅在资源工具箱 / 场景管理页显示) */
function updateBackSpecial() {
  const btn = document.getElementById('btn-back-special');
  if (!btn) return;
  const show = !!currentTool || toolboxHomeShown || sceneHomeShown || currentSceneCatId !== null || fguiEditorShown || webGameShown || apiDocShown;
  btn.hidden = !show;
}

/** 面包屑绑定(事件委托) */
function bindBreadcrumb() {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const crumb = e.target.closest('.crumb');
    if (!crumb || crumb.classList.contains('current')) return;
    clearOverlays(); // 先清掉覆盖式页面状态(工具箱/场景/设置),导航才会真正切换
    if (crumb.dataset.crumb === 'home') {
      setResourceTab('home');
      renderMainArea(); renderCategories(); syncTabs();
    } else if (crumb.dataset.crumb === 'favhome') {
      // 回到收藏夹主页
      favHomeShown = true;
      currentFavCategoryId = null;
      currentTool = null;
      sceneHomeShown = false;
      currentSceneCatId = null;
      renderMainArea(); renderCategories();
    } else if (crumb.dataset.crumb === 'typehome') {
      // 回到当前类型的类型主页
      currentCategoryId = 'all';
      setSetting('lastCategoryId', 'all');
      renderMainArea(); renderCategories();
    } else if (crumb.dataset.toolRoot !== undefined) {
      // 回到工具箱主页(汇总视图,列出所有子菜单入口)
      clearOverlays();
      toolboxHomeShown = true;
      currentTool = null;
      renderMainArea(); renderCategories();
    } else if (crumb.dataset.devtoolRoot !== undefined) {
      // 回到开发工具箱(当前唯一子模块:API 管理)
      clearOverlays();
      apiDocShown = true;
      renderMainArea(); renderCategories();
    } else if (crumb.dataset.sceneRoot !== undefined) {
      // 回到场景管理主页
      sceneHomeShown = true;
      currentSceneCatId = null;
      renderMainArea(); renderCategories();
    } else if (crumb.dataset.scene !== undefined) {
      // 进入该场景分类
      sceneHomeShown = false;
      currentSceneCatId = crumb.dataset.scene;
      expandedCats.add('scene:' + crumb.dataset.scene);
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
  // 工具箱
  if (currentTool) {
    const labels = {
      astc2png: 'ASTC → PNG',
      skel2json: 'SKEL → JSON',
      spinefix: 'Spine 文件修复',
      imageedit: '图片编辑',
      sk2spine: 'Laya .sk → Spine',
    };
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb" data-tool-root>资源工具箱</span>'
      + '<span class="crumb-sep">/</span>'
      + `<span class="crumb current">${labels[currentTool] || currentTool}</span>`;
    return;
  }
  // 工具箱主页(汇总视图)
  if (toolboxHomeShown) {
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb current">资源工具箱</span>';
    return;
  }
  // FGUI 编辑器
  if (fguiEditorShown) {
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb current">FGUI编辑器</span>';
    return;
  }
  // 网络资源抓取
  if (webGameShown) {
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb current">网络资源抓取</span>';
    return;
  }
  // 开发工具箱
  if (apiDocShown) {
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb" data-devtool-root>开发工具箱</span>'
      + '<span class="crumb-sep">/</span>'
      + '<span class="crumb current">API 管理</span>';
    return;
  }
  // 场景管理
  if (sceneHomeShown || currentSceneCatId !== null) {
    if (sceneHomeShown) {
      nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span>'
        + '<span class="crumb-sep">/</span>'
        + '<span class="crumb current">游戏场景管理</span>';
      return;
    }
    const cat = currentSceneCatId ? sceneCategoryById(currentSceneCatId) : null;
    const path = currentSceneCatId ? getSceneCatPathList(currentSceneCatId) : [];
    let html = '<span class="crumb" data-crumb="home">主页</span>';
    html += '<span class="crumb-sep">/</span>';
    html += '<span class="crumb" data-scene-root>游戏场景管理</span>';
    if (currentSceneCatId === '') {
      html += '<span class="crumb-sep">/</span><span class="crumb current">未分类</span>';
    } else {
      for (const p of path) {
        html += '<span class="crumb-sep">/</span>';
        const isLast = p.id === currentSceneCatId;
        html += `<span class="crumb${isLast ? ' current' : ''}" data-scene="${p.id}">${esc(p.name)}</span>`;
      }
    }
    nav.innerHTML = html;
    return;
  }
  // 收藏夹页面:主页 / 收藏夹主页 [/ 分类名]
  if (favHomeShown) {
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span><span class="crumb-sep">/</span><span class="crumb current" data-crumb="favhome">收藏夹主页</span>';
    return;
  }
  if (currentFavCategoryId) {
    const fc = favCategoryById(currentFavCategoryId);
    nav.innerHTML = '<span class="crumb" data-crumb="home">主页</span><span class="crumb-sep">/</span>'
      + '<span class="crumb" data-crumb="favhome">收藏夹主页</span><span class="crumb-sep">/</span>'
      + `<span class="crumb current">${esc(fc ? fc.name : '收藏夹')}</span>`;
    return;
  }
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

function getSceneCatPathList(catId) {
  const out = [];
  let cur = sceneCategoryById(catId);
  while (cur) { out.unshift({ id: cur.id, name: cur.name }); cur = cur.parentId ? sceneCategoryById(cur.parentId) : null; }
  return out;
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
      // 后台播放:返回时不停音频播放器,音频在后台继续(迷你条可见)
      // 从收藏夹页面进入预览 → 返回收藏夹页面
      if (previewReturnFav) {
        favHomeShown = previewReturnFav.home;
        currentFavCategoryId = previewReturnFav.catId || null;
        previewReturnFav = null;
        renderMainArea();
        renderCategories();
        return;
      }
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
  const fguiView = document.getElementById('pv-fgui-view');
  if (imgView) imgView.hidden = !(item.type === 'image');
  if (audioView) audioView.hidden = !(item.type === 'audio');
  if (fguiView) fguiView.hidden = !(item.type === 'fgui');
  // 顶部信息
  document.getElementById('pv-name').textContent = item.displayName;
  document.getElementById('pv-type').textContent = TYPE_LABEL[item.type] || item.type;
  document.getElementById('pv-type').className = 'type-badge ' + item.type;
  const pathEl = document.getElementById('pv-path');
  setCopyablePath(pathEl, item.filePath);
  document.getElementById('pv-version').textContent = '';
}

export async function selectItem(id) {
  const item = itemById(id);
  if (!item) return;
  // 打开资源 = 新建/激活预览标签
  // 设置「打开同类型资源时新开标签页」: 开 → 每个资源独立标签(默认); 关 → 同类型复用当前预览标签(替换内容,不再堆叠)
  const newTab = !!(state.settings && state.settings.openSameTypeNewTab);
  const tabKey = newTab ? `preview-${item.id}` : `preview-type-${typeGroup(item.type)}`;
  const tab = ensureTab(tabKey, {
    kind: 'preview', params: { itemId: item.id },
    label: item.displayName || '', icon: previewTypeIcon(item.type),
  });
  // 同类型复用标签时,更新名称/参数(ensureTab 仅创建时写入 def)
  if (!newTab && tab) {
    tab.label = item.displayName || '';
    tab.icon = previewTypeIcon(item.type);
    tab.params = { itemId: item.id };
    renderTabStrip();
  }
  // 记录最近打开(首页展示与再次打开)
  recordRecentOpen({ name: item.displayName || '', path: item.filePath, type: item.type, tab: typeGroup(item.type), itemId: item.id });
  setSetting('lastItemId', id);
  preview.currentItemId = id;
  renderItems();
  // 记录预览返回目标:从收藏夹页面进入 → 返回收藏夹;否则普通类型页面
  if (favHomeShown) previewReturnFav = { home: true, catId: null };
  else if (currentFavCategoryId) previewReturnFav = { home: false, catId: currentFavCategoryId };
  else previewReturnFav = null;
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
    } else if (item.type === 'fgui') {
      await showFguiViewer(item);
    }
  } catch (err) {
    console.error('[load]', item.id, err);
    showPreviewError(item, err.message || String(err));
  }
}

/** FGUI 包逆向查看 */
async function showFguiViewer(item) {
  showPreviewPage(item);
  const errEl = document.getElementById('pv-error');
  if (errEl) errEl.hidden = true;
  if (fguiViewer) {
    await fguiViewer.load(item);
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
  // 同步图片预览背景(与动画预览共用 bgColor 设置)
  const bgInput = document.getElementById('img-bg-color');
  if (bgInput) bgInput.value = state.settings.bgColor || '#22242b';
  if (imageViewer) imageViewer.setBgColor(state.settings.bgColor || '#22242b');
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

/** 音频预览:按播放模式进入队列播放 */
async function showAudioPlayer(item) {
  showPreviewPage(item);
  const mode = state.settings.audioMode || 'single';
  try {
    if (mode === 'dirOrder' || mode === 'dirLoop') {
      // 当前目录顺序/循环:收集同目录音频,从当前文件开始
      const dir = item.filePath.replace(/[\\/][^\\/]*$/, '');
      const ok = await audioPlayer.openDir(dir, item.filePath);
      if (!ok) audioPlayer.openSingle(item);
    } else if (mode === 'listOrder' || mode === 'listLoop') {
      // 播放列表顺序/循环:从当前播放列表播放;列表为空则回退单曲
      const list = getCurrentAudioList();
      if (list && list.paths.length) audioPlayer.openList(list.paths);
      else audioPlayer.openSingle(item);
    } else {
      audioPlayer.openSingle(item);
    }
  } catch (err) {
    console.warn('[audio] 进入播放失败,回退单曲播放', err);
    audioPlayer.openSingle(item);
  }
  syncAudioListUI();
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

// ---------------- 音频播放器:播放列表 / 后台播放 / 元信息 ----------------

function getAudioPlaylists() {
  return Array.isArray(state.settings.audioPlaylists) ? state.settings.audioPlaylists : [];
}
function getCurrentAudioList() {
  const id = state.settings.audioCurrentListId;
  return getAudioPlaylists().find((l) => l.id === id) || null;
}
function saveAudioPlaylists(list) {
  setSetting('audioPlaylists', list);
}

/** 同步播放列表下拉 / 模式 / 倍速控件与设置 */
function syncAudioListUI() {
  const sel = document.getElementById('audio-list-select');
  if (sel) {
    const lists = getAudioPlaylists();
    const curId = state.settings.audioCurrentListId;
    sel.innerHTML = '<option value="">(无)</option>' + lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    sel.value = curId || '';
  }
  const modeSel = document.getElementById('audio-mode');
  if (modeSel) modeSel.value = state.settings.audioMode || 'single';
  const rateSel = document.getElementById('audio-rate');
  if (rateSel) rateSel.value = String(state.settings.audioRate == null ? 1 : state.settings.audioRate);
  if (audioPlayer) {
    audioPlayer.setMode(state.settings.audioMode || 'single');
    audioPlayer.setRate(state.settings.audioRate == null ? 1 : state.settings.audioRate);
  }
}

/** 打开音频预览面板(后台播放时点击迷你条曲名返回) */
function openAudioPreviewPanel() {
  showPage('preview');
  document.getElementById('pv-anim-view').hidden = true;
  document.getElementById('pv-image-view').hidden = true;
  const audioView = document.getElementById('pv-audio-view');
  if (audioView) audioView.hidden = false;
  if (audioPlayer) audioPlayer.refreshUI();
  syncAudioListUI();
}

/** 绑定音频播放器扩展控件(迷你条 / 播放列表 / 元信息) */
function bindAudioPlayerExtras() {
  if (!audioPlayer) return;
  const miniPlay = document.getElementById('audio-mini-play');
  if (miniPlay) miniPlay.addEventListener('click', () => audioPlayer.toggle());
  const miniPrev = document.getElementById('audio-mini-prev');
  if (miniPrev) miniPrev.addEventListener('click', () => audioPlayer.prev());
  const miniNext = document.getElementById('audio-mini-next');
  if (miniNext) miniNext.addEventListener('click', () => audioPlayer.next());
  const miniClose = document.getElementById('audio-mini-close');
  if (miniClose) miniClose.addEventListener('click', () => { audioPlayer.stop(); syncAudioListUI(); });
  const miniName = document.getElementById('audio-mini-name');
  if (miniName) miniName.addEventListener('click', openAudioPreviewPanel);

  // 播放模式 / 倍速:播放器已处理,这里持久化设置
  const modeSel = document.getElementById('audio-mode');
  if (modeSel) modeSel.addEventListener('change', (e) => setSetting('audioMode', e.target.value));
  const rateSel = document.getElementById('audio-rate');
  if (rateSel) rateSel.addEventListener('change', (e) => setSetting('audioRate', Number(e.target.value)));

  // 播放列表下拉:切换当前列表
  const listSel = document.getElementById('audio-list-select');
  if (listSel) listSel.addEventListener('change', () => setSetting('audioCurrentListId', listSel.value || null));
  const btnNew = document.getElementById('audio-list-new');
  if (btnNew) btnNew.addEventListener('click', createAudioListDialog);
  const btnMgr = document.getElementById('audio-list-manage');
  if (btnMgr) btnMgr.addEventListener('click', () => renderAudioPlaylistManager());
  // 添加音频到当前播放列表(单个|多个)
  const listAdd = document.getElementById('audio-list-add');
  if (listAdd) listAdd.addEventListener('click', addAudioToListDialog);
}

/** 新建播放列表 */
function createAudioListDialog() {
  promptDialog({
    title: '新建播放列表',
    fields: [{ key: 'name', label: '列表名称', type: 'text', value: '' }],
    onOk: (v) => {
      const name = (v.name || '').trim();
      if (!name) { toast('请输入列表名称', 'error'); return; }
      const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const list = getAudioPlaylists();
      list.push({ id, name, paths: [] });
      saveAudioPlaylists(list);
      setSetting('audioCurrentListId', id);
      syncAudioListUI();
      toast(`已创建播放列表「${name}」`);
    },
  });
}

/** 把若干音频文件路径追加到指定播放列表(选择目标列表;无列表时提示先新建) */
function addToPlaylistDialog(paths) {
  const lists = getAudioPlaylists();
  if (!lists.length) {
    confirmDialog({
      title: '添加到播放列表',
      message: '还没有播放列表,先新建一个?',
      okText: '新建',
      onOk: () => {
        promptDialog({
          title: '新建播放列表',
          fields: [{ key: 'name', label: '列表名称', type: 'text', value: '' }],
          onOk: (v) => {
            const name = (v.name || '').trim();
            if (!name) { toast('请输入列表名称', 'error'); return; }
            const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            const list = getAudioPlaylists();
            list.push({ id, name, paths: [] });
            saveAudioPlaylists(list);
            setSetting('audioCurrentListId', id);
            syncAudioListUI();
            renderAhTabs();
            addToPlaylistDialog(paths); // 已有列表,继续弹目标选择
          },
        });
      },
    });
    return;
  }
  promptDialog({
    title: `添加到播放列表(${paths.length} 个音频)`,
    fields: [{
      key: 'listId',
      label: '目标播放列表',
      type: 'select',
      options: lists.map((l) => ({ value: l.id, label: l.name })),
      value: state.settings.audioCurrentListId && lists.some((l) => l.id === state.settings.audioCurrentListId)
        ? state.settings.audioCurrentListId
        : lists[0].id,
    }],
    onOk: (v) => {
      const list = getAudioPlaylists().find((l) => l.id === v.listId);
      if (!list) return;
      const existing = new Set(list.paths.map((p) => p.toLowerCase()));
      let added = 0;
      for (const p of paths) {
        const k = p.toLowerCase();
        if (existing.has(k)) continue;
        existing.add(k);
        list.paths.push(p);
        added++;
      }
      saveAudioPlaylists(getAudioPlaylists());
      syncAudioListUI();
      renderAhTabs();
      toast(added ? `已添加 ${added} 个音频到「${list.name}」` : '这些音频已在目标列表中');
    },
  });
}

/** 音频播放器主页:自建播放列表标签页 + 分类目录(可播放列表) + 播放器 */
function renderAudioHomePage(container) {
  container.innerHTML = `
    <div class="audio-home">
      <div class="ah-playlist-bar">
        <span class="ah-label">自建播放列表</span>
        <div class="ah-tabs" id="ah-tabs"></div>
        <button class="btn sm" id="ah-list-new">+ 新建</button>
        <button class="btn sm" id="ah-list-mgr">管理</button>
      </div>
      <div class="ah-cats">
        <span class="ah-label">分类目录(点击播放该分类下所有音频)</span>
        <div class="ah-cat-chips" id="ah-cat-chips"></div>
      </div>
      <div class="ah-player">
        <div class="ah-info">
          <div class="pv-name" id="ah-name">—</div>
          <div class="pv-path" id="ah-path"></div>
        </div>
        <div class="audio-controls">
          <button class="icon-btn" id="ah-prev" title="上一首">⏮</button>
          <button class="icon-btn" id="ah-play" title="播放/暂停">▶</button>
          <button class="icon-btn" id="ah-next" title="下一首">⏭</button>
          <span class="frame-val" id="ah-time">0:00 / 0:00</span>
          <input type="range" id="ah-progress" min="0" max="1000" step="1" value="0" title="进度" />
          <label class="ctrl-label">音量</label>
          <input type="range" id="ah-volume" min="0" max="100" step="1" value="100" title="音量" />
          <label class="ctrl-label">倍速</label>
          <select id="ah-rate" title="变速播放">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1" selected>1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <label class="ctrl-label">模式</label>
          <select id="ah-mode" title="播放模式">
            <option value="single">单次播放</option>
            <option value="loop">单曲循环</option>
            <option value="dirOrder">当前目录顺序</option>
            <option value="dirLoop">当前目录循环</option>
            <option value="listOrder">列表顺序</option>
            <option value="listLoop">列表循环</option>
          </select>
          <button class="btn sm" id="ah-add" title="把音频文件添加到当前播放列表(可多选)">+ 添加音频</button>
        </div>
        <div class="audio-queue" id="ah-queue"></div>
      </div>
    </div>
  `;
  const g = (id) => document.getElementById(id);
  // 主页播放器与预览页播放器共用同一实例(audio 元素不变)
  audioPlayer.attachEls({
    playBtn: g('ah-play'),
    prevBtn: g('ah-prev'),
    nextBtn: g('ah-next'),
    progress: g('ah-progress'),
    volume: g('ah-volume'),
    rate: g('ah-rate'),
    mode: g('ah-mode'),
    timeEl: g('ah-time'),
    nameEl: g('ah-name'),
    pathEl: g('ah-path'),
    queueEl: g('ah-queue'),
  }, 'home');

  g('ah-list-new').addEventListener('click', () => {
    createAudioListDialog();
    renderAhTabs();
  });
  g('ah-list-mgr').addEventListener('click', () => {
    renderAudioPlaylistManager();
    renderAhTabs();
  });
  g('ah-add').addEventListener('click', addAudioToListDialog);

  renderAhTabs();
  renderAhCats();
}

/** 自建播放列表标签页:点击标签 = 切换并播放该列表 */
function renderAhTabs() {
  const tabsEl = document.getElementById('ah-tabs');
  if (!tabsEl) return;
  const lists = getAudioPlaylists();
  const curId = state.settings.audioCurrentListId;
  if (!lists.length) {
    tabsEl.innerHTML = '<span class="ah-empty">暂无播放列表,点击「+ 新建」创建</span>';
    return;
  }
  tabsEl.innerHTML = lists.map((l) =>
    `<button class="ah-tab${l.id === curId ? ' active' : ''}" data-id="${esc(l.id)}" title="${esc(l.name)}">${esc(l.name)}</button>`
  ).join('');
  tabsEl.querySelectorAll('.ah-tab').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      setSetting('audioCurrentListId', id);
      const list = getAudioPlaylists().find((x) => x.id === id);
      if (list) audioPlayer.openList(list.paths);
      renderAhTabs();
    });
  });
}

/** 分类目录 chips:点击 = 把该分类(含子分类)下所有音频作为播放列表播放 */
function renderAhCats() {
  const chipsEl = document.getElementById('ah-cat-chips');
  if (!chipsEl) return;
  const audioItems = state.items.filter((it) => it.type === 'audio');
  const hasAudio = (catId) => {
    const ids = [catId, ...getCategoryDescendants(catId)];
    return audioItems.some((it) => ids.includes(it.categoryId || ''));
  };
  const entries = [];
  if (audioItems.some((it) => !it.categoryId)) entries.push({ id: '', name: '未分类' });
  // 音频视图下仅显示无标签或含「音频」标签的顶级分类
  for (const c of state.categories) {
    if (!c.parentId && hasAudio(c.id) && catVisibleInGroup(c, 'audio')) entries.push({ id: c.id, name: c.name });
  }
  if (!entries.length) {
    chipsEl.innerHTML = '<span class="ah-empty">暂无音频分类目录</span>';
    return;
  }
  chipsEl.innerHTML = entries.map((e) => `<span class="ah-cat-chip" data-id="${esc(e.id)}">${esc(e.name)}</span>`).join('');
  chipsEl.querySelectorAll('.ah-cat-chip').forEach((el) => {
    el.addEventListener('click', () => {
      const catId = el.dataset.id;
      const ids = [catId, ...getCategoryDescendants(catId)];
      const paths = state.items
        .filter((it) => it.type === 'audio' && ids.includes(it.categoryId || ''))
        .map((it) => it.filePath);
      if (!paths.length) { toast('该分类下没有音频', 'warn'); return; }
      audioPlayer.openList(paths);
      toast(`正在播放目录「${el.textContent}」的 ${paths.length} 个音频`);
    });
  });
}

/** 播放列表管理对话框:列表增删改 + 条目增删改查(单个/批量) */
function renderAudioPlaylistManager() {
  const { mask, close } = openModal({
    title: '播放列表管理',
    wide: true,
    body: (() => {
      const b = document.createElement('div');
      b.className = 'modal-body plm-body';
      b.innerHTML = `
        <div class="plm">
          <div class="plm-left">
            <div class="plm-title">播放列表</div>
            <select id="plm-list" class="plm-select"></select>
            <div class="plm-btns">
              <button class="btn sm" id="plm-new">新建</button>
              <button class="btn sm" id="plm-rename">重命名</button>
              <button class="btn sm danger" id="plm-del">删除</button>
            </div>
            <div class="plm-hint">切换列表后,右侧显示该列表的音频条目。</div>
          </div>
          <div class="plm-right">
            <div class="plm-tools">
              <span class="plm-count" id="plm-count"></span>
              <button class="btn sm" id="plm-add">+ 添加音频</button>
              <button class="btn sm" id="plm-remove-batch">移除选中</button>
              <button class="btn sm" id="plm-move">移动到...</button>
              <button class="btn sm" id="plm-up">上移</button>
              <button class="btn sm" id="plm-down">下移</button>
              <button class="btn sm" id="plm-clear">清空</button>
            </div>
            <div class="plm-list" id="plm-items"></div>
          </div>
        </div>
      `;
      return b;
    })(),
    foot: footButtons([{ text: '关闭', cls: '', onClick: () => { close(); renderAhTabs(); } }]),
  });

  const listSel = bEl(mask, '#plm-list');
  const listEl = bEl(mask, '#plm-items');
  const countEl = bEl(mask, '#plm-count');
  let editingListId = state.settings.audioCurrentListId;

  function currentList() {
    return getAudioPlaylists().find((l) => l.id === editingListId) || null;
  }
  function fillListSel() {
    const lists = getAudioPlaylists();
    listSel.innerHTML = '<option value="">(无)</option>' + lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    listSel.value = editingListId || '';
  }
  function save() {
    saveAudioPlaylists(getAudioPlaylists());
    syncAudioListUI();
    renderAhTabs();
    renderItemsList();
  }
  function renderItemsList() {
    const list = currentList();
    const items = list ? list.paths : [];
    countEl.textContent = list ? `共 ${items.length} 个音频` : '请选择列表';
    if (!list) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = items.map((p, i) => `
      <div class="plm-item" data-i="${i}" data-path="${esc(p)}" draggable="true" title="左键拖拽排序 · 右键更多操作">
        <label class="chk"><input type="checkbox" class="plm-chk" data-i="${i}" /></label>
        <span class="plm-idx">${i + 1}</span>
        <span class="plm-name" title="${esc(p)}">${esc(basename(p))}</span>
        <span class="plm-path" title="${esc(p)}">${esc(p)}</span>
        <button class="btn sm plm-del-one" data-i="${i}" title="移除该条">✕</button>
      </div>`).join('');
    listEl.querySelectorAll('.plm-del-one').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        const l = currentList();
        if (!l) return;
        l.paths.splice(i, 1);
        save();
      });
    });
  }

  // ---- 条目右键菜单(修改元信息 / 编辑文件信息 / 从列表删除 / 移动到其它列表) ----
  listEl.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.plm-item');
    if (!item) return;
    e.preventDefault();
    const i = Number(item.dataset.i);
    const l = currentList();
    if (!l) return;
    const p = l.paths[i];
    if (!p) return;
    const others = getAudioPlaylists().filter((x) => x.id !== l.id);
    const menu = [
      { label: '修改元信息', onClick: () => editAudioMetaDialog(p) },
      { label: '编辑文件信息', onClick: () => renameAudioFileDialog(p) },
      { label: '从列表删除', danger: true, onClick: () => { l.paths.splice(i, 1); save(); } },
    ];
    if (others.length) {
      menu.push({ label: '移动到其它列表...', onClick: () => moveSingleToOtherList(l, i) });
    }
    showContextMenu(e.clientX, e.clientY, menu);
  });

  // ---- 条目拖拽排序(改变播放顺序) ----
  let dragFrom = -1;
  const reindexItems = () => {
    [...listEl.querySelectorAll('.plm-item')].forEach((el, idx) => {
      el.dataset.i = String(idx);
      el.querySelector('.plm-idx').textContent = String(idx + 1);
      el.querySelectorAll('[data-i]').forEach((c) => { c.dataset.i = String(idx); });
    });
  };
  listEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.plm-item');
    if (!item) return;
    dragFrom = Number(item.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.plm-item');
    if (!target || dragFrom < 0) return;
    const over = Number(target.dataset.i);
    if (over === dragFrom) return;
    const l = currentList();
    if (!l) return;
    const [moved] = l.paths.splice(dragFrom, 1);
    l.paths.splice(over, 0, moved);
    dragFrom = over;
    const el = listEl.querySelector(`.plm-item[data-i="${over}"]`);
    const ref = listEl.querySelector(`.plm-item[data-i="${over + 1}"]`);
    listEl.insertBefore(el, ref);
    reindexItems();
  });
  const endDrag = () => {
    if (dragFrom < 0) return;
    dragFrom = -1;
    listEl.querySelectorAll('.plm-item').forEach((el) => el.classList.remove('dragging'));
    save(); // 拖拽结束保存新顺序
  };
  listEl.addEventListener('dragend', endDrag);
  listEl.addEventListener('drop', (e) => { e.preventDefault(); endDrag(); });

  /** 把当前列表第 i 个条目移动到其它播放列表 */
  function moveSingleToOtherList(l, i) {
    const others = getAudioPlaylists().filter((x) => x.id !== l.id);
    if (!others.length) { toast('没有其它播放列表可供移动', 'warn'); return; }
    const p = l.paths[i];
    promptDialog({
      title: `移动「${basename(p)}」到`,
      fields: [{
        key: 'toId', label: '目标播放列表', type: 'select',
        options: others.map((x) => ({ value: x.id, label: x.name })),
        value: others[0].id,
      }],
      onOk: (v) => {
        const target = getAudioPlaylists().find((x) => x.id === v.toId);
        if (!target) return;
        const existing = new Set(target.paths.map((x) => x.toLowerCase()));
        if (!existing.has(p.toLowerCase())) target.paths.push(p);
        l.paths.splice(i, 1);
        saveAudioPlaylists(getAudioPlaylists());
        syncAudioListUI();
        renderAhTabs();
        renderItemsList();
        toast(`已移动到「${target.name}」`);
      },
    });
  }

  listSel.addEventListener('change', () => {
    editingListId = listSel.value || null;
    setSetting('audioCurrentListId', editingListId);
    renderItemsList();
  });
  bEl(mask, '#plm-new').addEventListener('click', () => {
    promptDialog({
      title: '新建播放列表',
      fields: [{ key: 'name', label: '列表名称', type: 'text', value: '' }],
      onOk: (v) => {
        const name = (v.name || '').trim();
        if (!name) return;
        const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const list = getAudioPlaylists();
        list.push({ id, name, paths: [] });
        saveAudioPlaylists(list);
        editingListId = id;
        setSetting('audioCurrentListId', id);
        fillListSel();
        syncAudioListUI();
        renderItemsList();
      },
    });
  });
  bEl(mask, '#plm-rename').addEventListener('click', () => {
    const l = currentList();
    if (!l) { toast('请先选择播放列表', 'error'); return; }
    promptDialog({
      title: '重命名播放列表',
      fields: [{ key: 'name', label: '列表名称', type: 'text', value: l.name }],
      onOk: (v) => {
        const name = (v.name || '').trim();
        if (!name) return;
        l.name = name;
        saveAudioPlaylists(getAudioPlaylists());
        fillListSel();
        syncAudioListUI();
        renderItemsList();
      },
    });
  });
  bEl(mask, '#plm-del').addEventListener('click', () => {
    const l = currentList();
    if (!l) { toast('请先选择播放列表', 'error'); return; }
    confirmDialog({
      title: '删除播放列表',
      message: `确定删除播放列表「<strong>${esc(l.name)}</strong>」吗?仅移除列表,不删除音频文件。`,
      okText: '删除',
      danger: true,
      onOk: () => {
        const list = getAudioPlaylists().filter((x) => x.id !== l.id);
        saveAudioPlaylists(list);
        editingListId = null;
        setSetting('audioCurrentListId', null);
        fillListSel();
        syncAudioListUI();
        renderItemsList();
      },
    });
  });
  bEl(mask, '#plm-add').addEventListener('click', async () => {
    const l = currentList();
    if (!l) { toast('请先选择播放列表', 'error'); return; }
    const r = await window.api.pickFiles({
      title: '选择音频文件(可多选)',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'wma', 'm4a', 'aac', 'opus'] }],
      multiSelections: true,
    });
    if (r.canceled || !r.filePaths.length) return;
    const existing = new Set(l.paths.map((p) => p.toLowerCase()));
    let added = 0;
    for (const p of r.filePaths) {
      const k = p.toLowerCase();
      if (existing.has(k)) continue;
      existing.add(k);
      l.paths.push(p);
      added++;
    }
    if (added) { save(); toast(`已添加 ${added} 个音频(重复项已忽略)`); }
    else toast('所选音频均已存在', 'warn');
  });
  bEl(mask, '#plm-remove-batch').addEventListener('click', () => {
    const l = currentList();
    if (!l) return;
    const checked = [...listEl.querySelectorAll('.plm-chk:checked')].map((c) => Number(c.dataset.i)).sort((a, b) => b - a);
    if (!checked.length) { toast('请先勾选要移除的条目', 'warn'); return; }
    for (const i of checked) l.paths.splice(i, 1);
    save();
    toast(`已移除 ${checked.length} 个音频`);
  });
  // 移动勾选条目到其它播放列表
  bEl(mask, '#plm-move').addEventListener('click', () => {
    const l = currentList();
    if (!l) return;
    const checked = [...listEl.querySelectorAll('.plm-chk:checked')].map((c) => Number(c.dataset.i)).sort((a, b) => b - a);
    if (!checked.length) { toast('请先勾选要移动的条目', 'warn'); return; }
    const others = getAudioPlaylists().filter((x) => x.id !== l.id);
    if (!others.length) { toast('没有其它播放列表可供移动', 'error'); return; }
    promptDialog({
      title: `移动 ${checked.length} 个音频到`,
      fields: [{
        key: 'toId', label: '目标播放列表', type: 'select',
        options: others.map((x) => ({ value: x.id, label: x.name })),
        value: others[0].id,
      }],
      onOk: (v) => {
        const target = getAudioPlaylists().find((x) => x.id === v.toId);
        if (!target) return;
        const moved = checked.map((i) => l.paths[i]);
        // 追加到目标列表(去重)
        const existing = new Set(target.paths.map((p) => p.toLowerCase()));
        const added = moved.filter((p) => {
          const k = p.toLowerCase();
          if (existing.has(k)) return false;
          existing.add(k);
          return true;
        });
        target.paths.push(...added);
        // 从当前列表移除(按下标降序)
        for (const i of checked) l.paths.splice(i, 1);
        saveAudioPlaylists(getAudioPlaylists());
        syncAudioListUI();
        renderAhTabs();
        renderItemsList();
        toast(`已移动 ${moved.length} 个音频到「${target.name}」${added.length !== moved.length ? '(目标列表已有部分条目被跳过)' : ''}`);
      },
    });
  });
  bEl(mask, '#plm-up').addEventListener('click', () => {
    const l = currentList();
    if (!l) return;
    const checked = [...listEl.querySelectorAll('.plm-chk:checked')].map((c) => Number(c.dataset.i)).sort((a, b) => a - b);
    if (!checked.length) return;
    for (const i of checked) {
      if (i > 0) { const t = l.paths[i - 1]; l.paths[i - 1] = l.paths[i]; l.paths[i] = t; }
    }
    save();
  });
  bEl(mask, '#plm-down').addEventListener('click', () => {
    const l = currentList();
    if (!l) return;
    const checked = [...listEl.querySelectorAll('.plm-chk:checked')].map((c) => Number(c.dataset.i)).sort((a, b) => b - a);
    if (!checked.length) return;
    for (const i of checked) {
      if (i < l.paths.length - 1) { const t = l.paths[i + 1]; l.paths[i + 1] = l.paths[i]; l.paths[i] = t; }
    }
    save();
  });
  bEl(mask, '#plm-clear').addEventListener('click', () => {
    const l = currentList();
    if (!l) return;
    confirmDialog({
      title: '清空播放列表',
      message: `确定清空播放列表「<strong>${esc(l.name)}</strong>」的全部 ${l.paths.length} 个音频吗?`,
      okText: '清空',
      danger: true,
      onOk: () => { l.paths = []; save(); },
    });
  });

  fillListSel();
  renderItemsList();
}

/** 编辑当前播放音频的 ID3 内置信息 */
/** 编辑音频文件内置信息(ID3);targetPath 缺省时用当前播放曲目 */
async function editAudioMetaDialog(targetPath) {
  let path = targetPath;
  if (!path) {
    if (!audioPlayer || audioPlayer.index < 0 || !audioPlayer.queue[audioPlayer.index]) {
      toast('请先选择要编辑的音频', 'error');
      return;
    }
    path = audioPlayer.queue[audioPlayer.index].path;
  }
  const r = await window.api.readAudioMeta(path);
  const tags = (r && r.ok && r.tags) ? r.tags : { title: '', artist: '', album: '', year: '', track: '', comment: '' };
  promptDialog({
    title: `编辑音频信息 · ${basename(path)}`,
    fields: [
      { key: 'title', label: '标题', type: 'text', value: tags.title || '' },
      { key: 'artist', label: '艺术家', type: 'text', value: tags.artist || '' },
      { key: 'album', label: '专辑', type: 'text', value: tags.album || '' },
      { key: 'year', label: '年份', type: 'text', value: tags.year || '' },
      { key: 'track', label: '音轨', type: 'text', value: tags.track || '' },
      { key: 'comment', label: '注释', type: 'textarea', value: tags.comment || '' },
    ],
    onOk: async (v) => {
      const w = await window.api.writeAudioMeta(path, {
        title: v.title, artist: v.artist, album: v.album, year: v.year, track: v.track, comment: v.comment,
      });
      if (w && w.ok) {
        toast('音频信息已保存');
        // 刷新会话内缓存与队列显示
        if (audioPlayer) audioPlayer.invalidateMeta(path);
      } else {
        toast('保存失败:' + ((w && w.error) || '未知错误'), 'error');
      }
    },
  });
}

/** 重命名音频文件(仅改文件名,不跨目录) */
function renameAudioFileDialog(path) {
  const old = basename(path);
  const dir = path.replace(/[\\/][^\\/]*$/, '');
  promptDialog({
    title: '重命名音频文件',
    fields: [{ key: 'name', label: '新文件名(保留扩展名)', type: 'text', value: old }],
    onOk: async (v) => {
      let name = (v.name || '').trim();
      if (!name) return;
      // 若未保留扩展名则自动补回
      const extMatch = old.match(/\.[^.]+$/);
      if (extMatch && !name.toLowerCase().endsWith(extMatch[0].toLowerCase())) name += extMatch[0];
      const newPath = dir + (dir.endsWith('\\') || dir.endsWith('/') ? '' : (dir.includes('\\') ? '\\' : '/')) + name;
      const r = await window.api.renameFile(path, newPath);
      if (r && r.ok) {
        toast('已重命名为 ' + name);
        if (audioPlayer) audioPlayer.renamePath(path, newPath);
      } else {
        toast('重命名失败:' + ((r && r.error) || '未知错误'), 'error');
      }
    },
  });
}

/** 选择音频文件(单个|多个)追加到当前播放列表;若列表正在播放则同步追加到队列尾部 */
async function addAudioToListDialog() {
  const lists = getAudioPlaylists();
  if (!lists.length) {
    toast('请先新建播放列表', 'warn');
    return;
  }
  const cur = getCurrentAudioList() || lists[0];
  const r = await window.api.pickFiles({
    title: '选择音频文件(可多选)',
    filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'wma', 'm4a', 'aac', 'opus'] }],
  });
  if (r.canceled || !r.filePaths.length) return;
  const existing = new Set(cur.paths.map((p) => p.toLowerCase()));
  let added = 0;
  for (const p of r.filePaths) {
    const k = p.toLowerCase();
    if (existing.has(k)) continue;
    existing.add(k);
    cur.paths.push(p);
    added++;
  }
  saveAudioPlaylists(getAudioPlaylists());
  syncAudioListUI();
  renderAhTabs();
  // 列表模式且正在播放该列表 → 追加到队列尾部(不打断播放)
  const mode = state.settings.audioMode || 'single';
  if (audioPlayer && (mode === 'listOrder' || mode === 'listLoop')
    && state.settings.audioCurrentListId === cur.id) {
    audioPlayer.appendPaths(r.filePaths);
  }
  toast(added ? `已添加 ${added} 个音频到「${cur.name}」` : '所选音频均已在该列表中', added ? '' : 'warn');
}

function bEl(root, sel) {
  return root.querySelector(sel);
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

/**
 * 标签编辑器:已有标签 chip(✕ 删除) + 输入框(空格/回车/逗号添加,退格删除最后一个)
 * + 标签库建议下拉(可点击直接添加)。
 * @param {string[]} initialTags 初始标签
 * @param {(tags: string[]) => void} [onChange] 每次标签变化回调
 * @returns {{ el: HTMLElement, getTags: () => string[] }}
 */
function createTagEditor(initialTags = [], onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'tag-editor';

  const chips = document.createElement('div');
  chips.className = 'tag-chips';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.placeholder = '输入后回车 / 空格添加,或从下面标签库选择…';

  const suggest = document.createElement('div');
  suggest.className = 'tag-suggest';

  const tags = cleanTags(initialTags);

  function emit() {
    onChange && onChange([...tags]);
  }

  function addTag(text) {
    const t = String(text || '').trim();
    if (!t || tags.includes(t)) return false;
    tags.push(t);
    renderChips();
    emit();
    return true;
  }

  function removeTag(t) {
    const idx = tags.indexOf(t);
    if (idx < 0) return;
    tags.splice(idx, 1);
    renderChips();
    emit();
  }

  function renderChips() {
    chips.innerHTML = '';
    for (const t of tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const label = document.createElement('span');
      label.textContent = t;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tag-chip-x';
      del.textContent = '×';
      del.title = '删除标签';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTag(t);
        input.focus();
        showSuggest(input.value);
      });
      chip.appendChild(label);
      chip.appendChild(del);
      chips.appendChild(chip);
    }
  }

  function showSuggest(query) {
    const q = String(query || '').trim().toLowerCase();
    let lib = allTags().filter((t) => !tags.includes(t));
    if (q) lib = lib.filter((t) => t.toLowerCase().includes(q));
    if (!lib.length) {
      suggest.innerHTML = '';
      suggest.classList.remove('open');
      return;
    }
    suggest.innerHTML = '';
    for (const t of lib) {
      const item = document.createElement('div');
      item.className = 'tag-suggest-item';
      item.textContent = t;
      item.addEventListener('mousedown', (e) => e.preventDefault()); // 保持输入框焦点
      item.addEventListener('click', () => {
        addTag(t);
        input.value = '';
        input.focus();
        showSuggest('');
      });
      suggest.appendChild(item);
    }
    suggest.classList.add('open');
  }

  input.addEventListener('focus', () => showSuggest(input.value));
  input.addEventListener('input', () => showSuggest(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
      e.preventDefault();
      addTag(input.value);
      input.value = '';
      showSuggest('');
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      suggest.classList.remove('open');
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      addTag(input.value);
      input.value = '';
    }
    setTimeout(() => suggest.classList.remove('open'), 120);
  });

  // 点击编辑器外部立即关闭建议下拉(避免遮挡下方「保存」等按钮导致点不到/误点)
  // 编辑器随对话框销毁后,首次 mousedown 自动移除自身监听(自清理,避免累积)
  const onDocDown = (e) => {
    if (!wrap.isConnected) {
      document.removeEventListener('mousedown', onDocDown);
      return;
    }
    if (!wrap.contains(e.target)) suggest.classList.remove('open');
  };
  document.addEventListener('mousedown', onDocDown);

  renderChips();
  wrap.appendChild(chips);
  wrap.appendChild(input);
  wrap.appendChild(suggest);
  return {
    el: wrap,
    getTags: () => [...tags],
    /** 提交输入框中未确认的文本并关闭下拉,返回最终标签(保存前调用,不依赖 blur 时序) */
    commit: () => {
      if (input.value.trim()) {
        addTag(input.value);
        input.value = '';
      }
      suggest.classList.remove('open');
      return [...tags];
    },
    destroy: () => document.removeEventListener('mousedown', onDocDown),
  };
}

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

  // 文件名(仅图片类型:修改磁盘文件名,扩展名保持不变)
  let fileBase = null, fileExt = '', fileDir = '';
  if (it.type === 'image' && it.filePath) {
    const nm = it.filePath.split(/[\\/]/).pop();
    const dot = nm.lastIndexOf('.');
    fileExt = dot > 0 ? nm.slice(dot) : '';
    fileBase = dot > 0 ? nm.slice(0, dot) : nm;
    fileDir = it.filePath.slice(0, it.filePath.length - nm.length);
    const fileRow = document.createElement('div');
    fileRow.className = 'form-row';
    fileRow.innerHTML = '<label class="f-label">文件名</label>';
    const fileWrap = document.createElement('div');
    fileWrap.className = 'file-name-wrap';
    const fileInput = document.createElement('input');
    fileInput.type = 'text';
    fileInput.value = fileBase;
    fileInput.className = 'file-name-input';
    fileInput.setAttribute('data-ext', fileExt);
    const extSpan = document.createElement('span');
    extSpan.className = 'file-ext';
    extSpan.textContent = fileExt;
    fileWrap.appendChild(fileInput);
    fileWrap.appendChild(extSpan);
    fileRow.appendChild(fileWrap);
    body.appendChild(fileRow);
  }

  const catRow = document.createElement('div');
  catRow.className = 'form-row';
  catRow.innerHTML = '<label class="f-label">所属分类</label>';
  const catSelect = document.createElement('select');
  const opts = [{ value: '', label: '未分类' }].concat(state.categories.map((c) => ({ value: c.id, label: categoryPath(c.id) })));
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

  // 标签:chip ✕ 删除 / 空格回车新增 / 标签库建议选择
  const tagRow = document.createElement('div');
  tagRow.className = 'form-row';
  tagRow.innerHTML = '<label class="f-label">标签</label>';
  const tagEditor = createTagEditor(itemTags(it));
  tagRow.appendChild(tagEditor.el);
  body.appendChild(tagRow);

  const pathRow = document.createElement('div');
  pathRow.className = 'form-row';
  pathRow.innerHTML = '<label class="f-label">文件</label>';
  pathRow.appendChild(makeCopyablePath(`${TYPE_LABEL[it.type] || it.type} · ${it.filePath}`, { mono: true, wrap: true }));
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
        onClick: async () => {
          if (!nameInput.value.trim()) return toast('显示名称不能为空', 'error');
          // 图片类型:若文件名被改动,先重命名磁盘文件
          let newFilePath = it.filePath;
          if (it.type === 'image' && fileBase !== null) {
            const want = fileInput.value.trim();
            if (!want) return toast('文件名不能为空', 'error');
            if (/[\\/]/.test(want)) return toast('文件名不能包含路径分隔符', 'error');
            const target = fileDir + want + fileExt;
            if (target !== it.filePath) {
              try {
                const r = await window.api.renameFile(it.filePath, target);
                if (!r || !r.ok) {
                  toast('重命名失败: ' + ((r && r.error) || '未知错误'), 'error', 4000);
                  return; // 不关闭,让用户修正文件名
                }
                newFilePath = r.path;
              } catch (err) {
                toast('重命名异常: ' + err.message, 'error', 4000);
                return;
              }
            }
          }
          const moved = catSelect.value !== it.categoryId;
          updateItem(id, {
            displayName: nameInput.value.trim(),
            remark: remarkInput.value.trim(),
            tags: tagEditor.commit(), // 提交未确认输入(不依赖 blur 时序)
            categoryId: catSelect.value,
            filePath: newFilePath,
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

/**
 * 右键菜单「重命名」:
 * - 图片:重命名磁盘文件(扩展名不变),成功后更新 item.filePath
 * - 其它类型:重命名显示名称(纯元数据,避免破坏多文件资源的配套文件)
 */
function renameItemDialog(it) {
  const isImage = it.type === 'image' && it.filePath;
  const body = document.createElement('div');
  body.className = 'modal-body';

  let fileBase = null, fileExt = '', fileDir = '';
  if (isImage) {
    const nm = it.filePath.split(/[\\/]/).pop();
    const dot = nm.lastIndexOf('.');
    fileExt = dot > 0 ? nm.slice(dot) : '';
    fileBase = dot > 0 ? nm.slice(0, dot) : nm;
    fileDir = it.filePath.slice(0, it.filePath.length - nm.length);
  }

  const row = document.createElement('div');
  row.className = 'form-row';
  row.innerHTML = `<label class="f-label">${isImage ? '文件名' : '显示名称'}</label>`;
  let input;
  if (isImage) {
    const wrap = document.createElement('div');
    wrap.className = 'file-name-wrap';
    input = document.createElement('input');
    input.type = 'text';
    input.value = fileBase;
    input.className = 'file-name-input';
    const extSpan = document.createElement('span');
    extSpan.className = 'file-ext';
    extSpan.textContent = fileExt;
    wrap.appendChild(input);
    wrap.appendChild(extSpan);
    row.appendChild(wrap);
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = it.displayName;
    row.appendChild(input);
  }
  body.appendChild(row);

  const title = isImage ? '重命名图片文件' : `重命名${it.type === 'audio' ? '音频' : it.type === 'model' ? '3D 资源' : '动画'}`;
  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '确定',
        cls: 'primary',
        onClick: async () => {
          const want = input.value.trim();
          if (!want) return toast(isImage ? '文件名不能为空' : '显示名称不能为空', 'error');
          if (isImage) {
            if (/[\\/]/.test(want)) return toast('文件名不能包含路径分隔符', 'error');
            const target = fileDir + want + fileExt;
            if (target !== it.filePath) {
              try {
                const r = await window.api.renameFile(it.filePath, target);
                if (!r || !r.ok) {
                  toast('重命名失败: ' + ((r && r.error) || '未知错误'), 'error', 4000);
                  return; // 不关闭,让用户修正
                }
                updateItem(it.id, { filePath: r.path });
                thumbnailService.invalidate(it.id);
              } catch (err) {
                toast('重命名异常: ' + err.message, 'error', 4000);
                return;
              }
            }
          } else {
            if (want === it.displayName) { close(); return; }
            updateItem(it.id, { displayName: want });
          }
          close();
          renderItems();
          renderMainArea();
          const ph = document.getElementById('pv-name');
          if (ph && preview.currentItemId === it.id) ph.textContent = isImage ? it.displayName : want;
          toast('已重命名');
        },
      },
    ]),
  });
  setTimeout(() => { input.focus(); input.select && input.select(); }, 0);
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

/**
 * 批量编辑标签(编辑模式多选右键「编辑」):
 * - 「添加标签」:输入/标签库选择新标签,追加到全部选中资源
 * - 「共有标签」:所有选中资源共同含有的标签,点 ✕ 从全部移除
 * - 「部分标签」:仅部分资源含有的标签,只读提示,保存时保留不变
 */
function batchEditTagsDialog(ids) {
  const valid = ids.map((id) => itemById(id)).filter(Boolean);
  if (!valid.length) {
    toast('请先选择要编辑的资源', 'error');
    return;
  }

  // 共有标签(交集) / 部分标签(并集-交集)
  const tagSets = valid.map((it) => new Set(itemTags(it)));
  const common = new Set(tagSets[0]);
  for (const s of tagSets.slice(1)) {
    for (const t of [...common]) if (!s.has(t)) common.delete(t);
  }
  const union = new Set();
  for (const s of tagSets) for (const t of s) union.add(t);
  const partial = new Set([...union].filter((t) => !common.has(t)));
  const removed = new Set(); // 待从全部移除的共有标签

  const body = document.createElement('div');
  body.className = 'modal-body';

  // 提示
  const tip = document.createElement('div');
  tip.className = 'hint';
  tip.style.marginBottom = '12px';
  tip.textContent = `已选择 ${valid.length} 项资源:新标签会添加到全部选中资源,点击共有标签的 × 可将其从全部移除。`;
  body.appendChild(tip);

  // 区域1:添加标签
  const addRow = document.createElement('div');
  addRow.style.cssText = 'margin-bottom:12px';
  const addLabel = document.createElement('div');
  addLabel.className = 'f-label';
  addLabel.style.cssText = 'width:auto;text-align:left;margin-bottom:6px';
  addLabel.textContent = '添加标签到全部选中资源';
  const addEditor = createTagEditor([]);
  addRow.appendChild(addLabel);
  addRow.appendChild(addEditor.el);
  body.appendChild(addRow);

  // 区域2:共有标签(✕ 删除)
  const commonRow = document.createElement('div');
  commonRow.style.cssText = 'margin-bottom:12px';
  const commonLabel = document.createElement('div');
  commonLabel.className = 'f-label';
  commonLabel.style.cssText = 'width:auto;text-align:left;margin-bottom:6px';
  commonLabel.textContent = '共有标签(全部选中资源都有)';
  const commonWrap = document.createElement('div');
  commonWrap.className = 'ro-tags';
  const renderCommon = () => {
    commonWrap.innerHTML = '';
    const remaining = [...common].filter((t) => !removed.has(t));
    if (!remaining.length) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = removed.size ? '已全部移除' : '无(这些资源没有共同的标签)';
      commonWrap.appendChild(hint);
      return;
    }
    for (const t of remaining) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const label = document.createElement('span');
      label.textContent = t;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tag-chip-x';
      del.textContent = '×';
      del.title = '从全部选中资源移除';
      del.addEventListener('click', () => {
        removed.add(t);
        renderCommon();
      });
      chip.appendChild(label);
      chip.appendChild(del);
      commonWrap.appendChild(chip);
    }
  };
  renderCommon();
  commonRow.appendChild(commonLabel);
  commonRow.appendChild(commonWrap);
  body.appendChild(commonRow);

  // 区域3:部分标签(只读提示)
  if (partial.size) {
    const partRow = document.createElement('div');
    const partLabel = document.createElement('div');
    partLabel.className = 'f-label';
    partLabel.style.cssText = 'width:auto;text-align:left;margin-bottom:6px';
    partLabel.textContent = '部分标签(仅部分资源含有,保存时保留)';
    const partWrap = document.createElement('div');
    partWrap.className = 'ro-tags';
    partWrap.innerHTML = [...partial].map((t) => `<span class="tag-chip tag-chip-more">${esc(t)}</span>`).join(' ');
    partRow.appendChild(partLabel);
    partRow.appendChild(partWrap);
    body.appendChild(partRow);
  }

  const { close } = openModal({
    title: `批量编辑标签 (${valid.length} 项)`,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '保存',
        cls: 'primary',
        onClick: () => {
          const addTags = addEditor.commit(); // 提交未确认输入(不依赖 blur 时序)
          for (const it of valid) {
            let tags = itemTags(it);
            for (const t of addTags) if (!tags.includes(t)) tags.push(t);
            tags = tags.filter((t) => !removed.has(t));
            updateItem(it.id, { tags });
            thumbnailService.invalidate(it.id);
          }
          close();
          renderCategories();
          renderItems();
          renderMainArea();
          toast(`已为 ${valid.length} 项资源更新标签`);
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

  // 系统设置
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.addEventListener('click', () => openSettings());

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
  const searchClear = document.getElementById('search-clear');
  const updateSearchClear = () => { if (searchClear) searchClear.hidden = !search.value; };
  search.addEventListener('input', () => {
    searchText = search.value.trim();
    updateSearchClear();
    renderItems();
  });
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      search.value = '';
      searchText = '';
      updateSearchClear();
      renderMainArea(); // 清空搜索 → 恢复当前上下文视图
      search.focus();
    });
  }
  updateSearchClear();
}

function bindList() {
  window.addEventListener('items-changed', (e) => {
    // 递归批量添加自动建的目录:展开其所在链路,让用户立即看到
    const expand = e && e.detail && e.detail.expand;
    if (Array.isArray(expand)) {
      for (const id of expand) {
        if (categoryById(id)) expandedCats.add(id);
      }
    }
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

  // 背景(统一调色盘:深/浅/自定义按钮反色 + 保存自定义)
  initBgColorBar({
    input: document.getElementById('bg-color'),
    darkBtn: document.getElementById('bg-dark'),
    lightBtn: document.getElementById('bg-light'),
    customBtn: document.getElementById('bg-custom'),
    saveBtn: document.getElementById('bg-save'),
    onApply: (c) => {
      setSetting('bgColor', c);
      preview.setBgColor(c);
      const imgInput = document.getElementById('img-bg-color');
      if (imgInput) imgInput.value = c;
    },
  });

  // 图片预览背景(与动画预览共用 bgColor 设置,同样支持自定义/保存)
  initBgColorBar({
    input: document.getElementById('img-bg-color'),
    darkBtn: document.getElementById('img-bg-dark'),
    lightBtn: document.getElementById('img-bg-light'),
    customBtn: document.getElementById('img-bg-custom'),
    saveBtn: document.getElementById('img-bg-save'),
    onApply: (c) => {
      setSetting('bgColor', c);
      if (imageViewer) imageViewer.setBgColor(c);
      const animInput = document.getElementById('bg-color');
      if (animInput) animInput.value = c;
    },
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

  // 截图当前帧(透明背景 PNG/WebP)
  const btnCapture = document.getElementById('pv-capture');
  if (btnCapture) btnCapture.addEventListener('click', () => doCaptureScreenshot());

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

/** 截图当前动画帧为透明背景 PNG/WebP 并保存到默认路径 */
function doCaptureScreenshot() {
  if (!preview || !preview.currentItemId) return toast('当前没有可截图的动画', 'error');
  const item = itemById(preview.currentItemId);
  if (!item) return toast('未找到当前资源', 'error');

  const format = state.settings.screenshotFormat === 'webp' ? 'webp' : 'png';
  const quality = format === 'webp' ? (Number(state.settings.screenshotQuality) || 0.92) : undefined;
  const dataUrl = preview.captureFrame({ type: format, quality });
  if (!dataUrl) return toast('截图失败(无法提取画面)', 'error');

  const dir = (state.settings.screenshotPath || '').trim();
  const base = String(item.filePath || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'capture';
  const action = (preview.currentAction && preview.currentAction.name) || 'frame';
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const fileName = `${base}_${action}_${ts}.${format}`;
  const full = dir ? (dir.replace(/[\\/]$/, '') + '/' + fileName) : fileName;

  window.api.writeFileBase64(full, dataUrl).then((r) => {
    if (r && r.ok) {
      toast(`已保存截图: ${r.path}`, 'ok', 4000);
      // 截图后自动加入「图片资源」指定分类(默认:spine截图)
      if (state.settings.screenshotAddToLibrary) {
        const catName = state.settings.screenshotCategory || 'spine截图';
        const cat = findOrCreateCategoryByName(catName, '');
        if (cat) {
          const dup = state.items.some((it) => it.filePath === r.path);
          if (!dup) {
            addItem({ categoryId: cat.id, type: 'image', filePath: r.path, displayName: base, mtime: Date.now(), tags: [] });
            renderTree();
            toast(`已加入图片资源「${cat.name}」`, 'ok', 3000);
          }
        }
      }
    } else {
      toast('截图保存失败: ' + ((r && r.error) || '未知错误'), 'error', 4000);
    }
  }).catch((err) => {
    toast('截图保存异常: ' + err.message, 'error', 4000);
  });
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

/** 同步「资源树」按钮图标:侧栏可见 → 布局图标(可隐藏);侧栏隐藏 → 布局图标+左面板窄(可显示) */
function syncTreeToggleIcon() {
  const t = document.getElementById('btn-toggle-side');
  if (!t) return;
  const hidden = document.getElementById('sidebar')?.classList.contains('hidden');
  if (hidden) {
    // 侧栏隐藏: 左窄条 + 右区 + ▶ (表示"展开/显示")
    t.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1.5" width="3" height="13" rx="1"/><rect x="5.5" y="1.5" width="9.5" height="13" rx="1"/><polyline points="10,6 12,8 10,10"/></svg>';
    t.title = '显示资源树';
  } else {
    // 侧栏可见: 左面板 + 右区 + ▶ (表示"折叠/隐藏")
    t.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1.5" width="4.5" height="13" rx="1"/><rect x="6.5" y="1.5" width="8.5" height="13" rx="1"/><polyline points="10.5,6 12.5,8 10.5,10"/></svg>';
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
