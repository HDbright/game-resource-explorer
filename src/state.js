// ============ 数据状态层(分类 / 动画条目 / 场景 CRUD) ============

/** 设置默认值(合并到已保存设置,保证旧库缺字段时也能补齐) */
export const DEFAULT_SETTINGS = {
  playMode: 'loop',
  timeScale: 1,
  bgColor: '#22242b',
  showBones: false,
  lastCategoryId: 'all',
  lastItemId: null,
  zoomMode: '100', // 'fit' 适配窗口 | '100' 固定100% | 'fixed' 跟随缩放滑块数值
  resourceTab: 'home', // 'anim' | 'image' | 'audio' | '3d' | 'home'
  listViewMode: 'list', // 'detail' | 'list' | 'icon'
  listSortBy: 'name', // 'name' | 'type' | 'size' | 'date'
  listSortDir: 'asc', // 'asc' | 'desc'
  // 截图设置
  screenshotPath: '', // 默认保存目录(空 = 用图片库目录/Spine截图)
  screenshotFormat: 'png', // 'png' | 'webp'
  screenshotQuality: 0.92, // webp 质量 0~1
  screenshotAddToLibrary: true, // 截图后是否加入「图片资源」指定分类
  screenshotCategory: 'spine截图', // 目标图片分类名(不存在则自动创建)
  // 音频播放器
  audioMode: 'single', // 'single'单次 | 'loop'单曲循环 | 'dirOrder'目录顺序 | 'dirLoop'目录循环 | 'listOrder'列表顺序 | 'listLoop'列表循环
  audioRate: 1, // 变速 0.5~2
  audioPlaylists: [], // 播放列表 [{id, name, paths: [filePath...]}]
  audioCurrentListId: null, // 当前播放列表 id
  // 最近打开(首页展示): [{name, path, type, tab, itemId, openedAt}] 最新在前,上限 20
  recentOpens: [],
  // FGUI 预览画布背景色
  fguiBgColor: '#1b1d23',
  // 自定义背景色(动画/图片/FGUI 背景色条共用,「保存」按钮写入)
  customBgColor: '#3a4150',
  audioListFields: { // 播放列表条目显示字段(在设置页配置)
    fileName: true, // 文件名
    title: true, // 标题(ID3)
    artist: true, // 艺术家(ID3)
    album: false, // 专辑(ID3)
    duration: true, // 时长
  },
  // 网络资源抓取
  webGameLastUrl: '', // 上次打开的游戏 URL(自动回填)
  webGameSaveDir: '', // 抓取资源输出目录
  webGameProxy: '', // 可选代理(如 http://127.0.0.1:7890)
  webGameHistory: [], // 最近打开的游戏 [{url, title, openedAt}] 最新在前,上限 20
};

export const state = {
  version: 2,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  items: [],
  favCategories: [],
  favItems: [],
  // 场景管理(独立分类树 + 场景条目,字段结构与资源目录对齐)
  sceneCategories: [],
  scenes: [],
  // 网址收藏夹(网络资源抓取:分类树可嵌套 + 网址条目)
  webBookmarkCategories: [],
  webBookmarks: [],
};

// ---------------- 资源类型分组 ----------------

/** 四类资源的类型分组 */
export const TYPE_GROUPS = {
  anim: ['spine', 'dragonbones'],
  image: ['image'],
  audio: ['audio'],
  '3d': ['model'],
  fgui: ['fgui'],
};

/** 类型显示名 */
export const TYPE_LABEL = {
  spine: 'Spine',
  dragonbones: 'DB',
  image: '图片',
  audio: '音频',
  model: '3D',
  fgui: 'FGUI',
};

/** 资源类型 → 分组('anim' | 'image' | 'audio' | '3d' | 'fgui') */
export function typeGroup(type) {
  if (type === 'image') return 'image';
  if (type === 'audio') return 'audio';
  if (type === 'model') return '3d';
  if (type === 'fgui') return 'fgui';
  return 'anim';
}

// ---------------- 分类的资源类型标签 ----------------

/** 目录可标记的资源类型标签(勾选后目录只在对应类型的资源树中显示;不勾选 = 所有类型显示) */
export const CAT_TYPE_TAG_LABELS = {
  anim: '动画',
  image: '图片',
  audio: '音频',
  '3d': '3D',
  video: '视频',
  article: '文章',
  fgui: 'UI',
};

/** 全部标签 key(供勾选组按固定顺序渲染) */
export const CAT_TYPE_TAGS = Object.keys(CAT_TYPE_TAG_LABELS);

/** 分类的资源类型标签数组(过滤非法值,兼容旧数据 undefined/字符串) */
export function categoryTypeTags(cat) {
  if (!cat) return [];
  const raw = Array.isArray(cat.typeTags) ? cat.typeTags : [];
  return raw.filter((t) => CAT_TYPE_TAG_LABELS[t]);
}

/** 分类资源类型标签的中文名数组(如 ['音频']) */
export function categoryTypeTagNames(cat) {
  return categoryTypeTags(cat).map((t) => CAT_TYPE_TAG_LABELS[t]);
}

/**
 * 分类是否在指定资源分组下可见:
 * - 无标签 → 所有类型都显示
 * - 有标签 → 仅标签命中该分组的目录显示(可同时勾选多个标签)
 * - group 为空('home'/'all'/null 全部视图) → 始终显示
 * @param {object} cat 分类对象
 * @param {string|null} group 'anim'|'image'|'audio'|'3d'|'all'|null
 */
export function catVisibleInGroup(cat, group) {
  const tags = categoryTypeTags(cat);
  if (!tags.length) return true;
  if (!group || group === 'all') return true;
  return tags.includes(group);
}

let saveTimer = null;

export async function loadState() {
  const data = await window.api.dbRead();
  if (!data) return;
  Object.assign(state, data);
  // 合并默认设置,保证旧库缺失的新字段被补齐(已有字段以库为准)
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  state.categories = Array.isArray(data.categories) ? data.categories : [];
  state.items = Array.isArray(data.items) ? data.items : [];
  state.favCategories = Array.isArray(data.favCategories) ? data.favCategories : [];
  state.favItems = Array.isArray(data.favItems) ? data.favItems : [];
  state.sceneCategories = Array.isArray(data.sceneCategories) ? data.sceneCategories : [];
  state.scenes = Array.isArray(data.scenes) ? data.scenes : [];
  // 兼容字段:旧库无 tags 时补 []
  for (const it of state.items) {
    if (!Array.isArray(it.tags)) it.tags = [];
  }
  // 兼容字段:旧库分类无 typeTags 时补 [](无标签 = 所有资源类型显示)
  for (const c of state.categories) {
    if (!Array.isArray(c.typeTags)) c.typeTags = [];
  }
}

/** 防抖保存到磁盘 */
export function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await window.api.dbWrite(state);
    } catch (err) {
      console.error('保存失败', err);
    }
  }, 150);
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return Date.now();
}

// ---------------- 分类 ----------------

/** 新增分类;parentId 为 '' 表示顶级分类,否则为父分类 id(子分类);typeTags 为资源类型标签数组(如 ['audio'],空 = 所有类型显示) */
export function addCategory({ name, remark = '', parentId = '', typeTags = [] }) {
  const cat = {
    id: uid('c'),
    name,
    remark,
    parentId: parentId || '',
    typeTags: Array.isArray(typeTags) ? typeTags.filter((t) => CAT_TYPE_TAG_LABELS[t]) : [],
    sort: state.categories.length,
    createdAt: now(),
  };
  state.categories.push(cat);
  saveState();
  return cat;
}

export function updateCategory(id, patch) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

/** 删除分类:其子分类提升为顶级,其下动画移到「未分类」(categoryId = '') */
export function removeCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  for (const c of state.categories) {
    if (c.parentId === id) c.parentId = '';
  }
  for (const it of state.items) {
    if (it.categoryId === id) it.categoryId = '';
  }
  saveState();
}

/**
 * 删除分类(增强版,由删除确认对话框调用)
 * @param {string} id 分类 id
 * @param {object} opts
 *   - deleteItems {boolean} true → 删除该分类(含全部子孙分类)下所有动画条目(非物理文件);
 *                             false → 动画移到「未分类」(categoryId='')
 *   - subAction {'parent'|'top'|'category'} 子分类去向:
 *       'parent'   → 提升为被删分类的父分类的子类别(顶级分类则为顶级)
 *       'top'      → 提升为顶级分类
 *       'category' → 移动到 subTargetId 分类下
 *   - subTargetId {string} subAction==='category' 时的目标分类 id
 *   deleteItems=true 时子分类一并删除(其下动画也删除)。
 */
export function removeCategoryAdvanced(id, opts = {}) {
  const cat = categoryById(id);
  if (!cat) return;
  const { deleteItems = false, subAction = 'parent', subTargetId = '' } = opts;
  const subs = getCategoryChildren(id);
  const catIds = new Set([id, ...getCategoryDescendants(id)]);
  const parentPid = cat.parentId || '';

  // 1) 动画:删除或移到未分类
  if (deleteItems) {
    const delIds = state.items.filter((i) => catIds.has(i.categoryId)).map((i) => i.id);
    state.items = state.items.filter((i) => !catIds.has(i.categoryId));
    for (const did of delIds) cleanupFavItems(did);
  } else {
    for (const it of state.items) {
      if (catIds.has(it.categoryId)) it.categoryId = '';
    }
  }

  // 2) 子分类:删除或调整父级
  for (const sub of subs) {
    if (deleteItems) {
      removeCategoryAdvanced(sub.id, { deleteItems: true });
    } else if (subAction === 'parent') {
      sub.parentId = parentPid;
    } else if (subAction === 'top') {
      sub.parentId = '';
    } else if (subAction === 'category') {
      sub.parentId = subTargetId || '';
    }
  }

  // 3) 移除自身
  state.categories = state.categories.filter((c) => c.id !== id);
  saveState();
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) || null;
}

/** 按名称查找分类(同父级下不区分大小写),不存在则用该名称自动创建并返回 */
export function findOrCreateCategoryByName(name, parentId = '') {
  const key = String(name || '').trim();
  if (!key) return null;
  let cat = state.categories.find(
    (c) => (c.parentId || '') === parentId && c.name.toLowerCase() === key.toLowerCase()
  );
  if (!cat) cat = addCategory({ name: key, parentId });
  return cat;
}

// ---------------- 分类树辅助 ----------------

/** 某分类的直接子分类(按数组顺序,即渲染顺序) */
export function getCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.categories.filter((c) => (c.parentId || '') === pid);
}

/** catId 是否为 ancestorId 的后代 */
export function isCategoryDescendant(catId, ancestorId) {
  let cur = categoryById(catId);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = categoryById(cur.parentId);
  }
  return false;
}

/** 某分类的所有后代 id(不含自身) */
export function getCategoryDescendants(catId) {
  const out = [];
  const collect = (pid) => {
    for (const c of state.categories) {
      if ((c.parentId || '') === pid) {
        out.push(c.id);
        collect(c.id);
      }
    }
  };
  collect(catId);
  return out;
}

/** 分类路径名,如「场景 / 主城 / 特效」(用于移动对话框候选显示) */
export function categoryPath(catId) {
  const parts = [];
  let cur = categoryById(catId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? categoryById(cur.parentId) : null;
  }
  return parts.join(' / ');
}

/**
 * 拖动排序分类:把 fromId 的分类移到 toId 分类的上方(before)或下方(after)。
 * 数组顺序即渲染顺序,同时同步每个分类的 sort 字段保持一致。
 */
export function reorderCategory(fromId, toId, place = 'before') {
  const fromIdx = state.categories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.categories.splice(fromIdx, 1);
  let toIdx = state.categories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.categories.length;
  if (place === 'after') toIdx += 1;
  state.categories.splice(toIdx, 0, moved);
  state.categories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 批量删除「未分类」下的全部动画条目(仅移出列表,不删磁盘文件),同步清理收藏引用。返回删除数量 */
export function removeUncategorizedItems() {
  const ids = state.items.filter((i) => !i.categoryId).map((i) => i.id);
  state.items = state.items.filter((i) => i.categoryId);
  for (const id of ids) cleanupFavItems(id);
  saveState();
  return ids.length;
}

// ---------------- 动画条目 ----------------

export function addItem({ categoryId, type, filePath, atlasPath = null, displayName, remark = '', size = null, mtime = null, tags = [] }) {
  const item = {
    id: uid('i'),
    categoryId: categoryId || '',
    type, // 'spine' | 'dragonbones' | 'image' | 'audio'
    filePath,
    atlasPath,
    displayName: displayName || filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
    remark,
    tags: cleanTags(tags),
    size,
    mtime,
    createdAt: now(),
    updatedAt: now(),
  };
  state.items.push(item);
  saveState();
  return item;
}

export function updateItem(id, patch) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: now() });
  saveState();
  return item;
}

export function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  cleanupFavItems(id);
  saveState();
}

export function itemById(id) {
  return state.items.find((i) => i.id === id) || null;
}

// ---------------- 标签 ----------------

/**
 * 规范化标签:输入可以是数组或字符串(按空格/逗号分隔)。
 * 去空白、去重、忽略空项,保持原顺序。单个标签内不允许空格。
 * @param {string|string[]} input
 * @returns {string[]}
 */
export function cleanTags(input) {
  if (input == null) return [];
  const raw = Array.isArray(input) ? input : String(input);
  const out = [];
  const seen = new Set();
  for (const part of raw) {
    for (const t of String(part).split(/[\s,，、]+/)) {
      const tag = t.trim();
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
}

/** 条目的标签数组(兼容旧数据:undefined / 字符串) */
export function itemTags(item) {
  if (!item) return [];
  return cleanTags(item.tags);
}

/** 全库标签库(去重排序),供标签建议下拉 / 标签过滤使用 */
export function allTags() {
  const set = new Set();
  for (const it of state.items) {
    for (const t of itemTags(it)) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 设置条目标签(去重后保存) */
export function setItemTags(id, tags) {
  const item = itemById(id);
  if (!item) return null;
  item.tags = cleanTags(tags);
  item.updatedAt = now();
  saveState();
  return item;
}

// ---------------- 设置 ----------------

export function setSetting(key, value) {
  state.settings[key] = value;
  saveState();
}

/** 最近打开(首页展示与再次打开): 去重按 path, 最新在前, 上限 20, 持久化 */
export function recordRecentOpen({ name = '', path = '', type = '', tab = '', itemId = null }) {
  if (!path) return;
  const norm = String(path).replace(/\\/g, '/');
  const list = Array.isArray(state.settings.recentOpens) ? [...state.settings.recentOpens] : [];
  const idx = list.findIndex((r) => r.path && String(r.path).replace(/\\/g, '/') === norm);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift({ name, path, type, tab, itemId, openedAt: now() });
  state.settings.recentOpens = list.slice(0, 20);
  saveState();
}

// ---------------- 收藏夹 ----------------

/** 新建收藏夹分类目录 */
export function addFavCategory({ name }) {
  const fc = { id: uid('f'), name, sort: state.favCategories.length, createdAt: now(), updatedAt: now() };
  state.favCategories.push(fc);
  saveState();
  return fc;
}

export function updateFavCategory(id, patch) {
  const fc = state.favCategories.find((c) => c.id === id);
  if (!fc) return null;
  Object.assign(fc, patch, { updatedAt: now() });
  saveState();
  return fc;
}

/** 删除收藏夹分类,其下收藏项移到「未分类收藏」(favCategoryId='') */
export function removeFavCategory(id) {
  state.favCategories = state.favCategories.filter((c) => c.id !== id);
  for (const f of state.favItems) {
    if (f.favCategoryId === id) f.favCategoryId = '';
  }
  saveState();
}

export function favCategoryById(id) {
  return state.favCategories.find((c) => c.id === id) || null;
}

/**
 * 拖动排序收藏分类:把 fromId 移到 toId 的上方(before)或下方(after)。
 * 数组顺序即渲染顺序,同时同步每个收藏分类的 sort 字段保持一致。
 */
export function reorderFavCategory(fromId, toId, place = 'before') {
  const fromIdx = state.favCategories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.favCategories.splice(fromIdx, 1);
  let toIdx = state.favCategories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.favCategories.length;
  if (place === 'after') toIdx += 1;
  state.favCategories.splice(toIdx, 0, moved);
  state.favCategories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 收藏一个动画到指定收藏分类(可重复收藏到多个位置;favCategoryId='' 表示未分类收藏) */
export function addFavItem(itemId, favCategoryId = '') {
  const item = itemById(itemId);
  if (!item) return null;
  // 同一动画同一收藏分类不重复
  if (state.favItems.some((f) => f.itemId === itemId && f.favCategoryId === favCategoryId)) return null;
  const f = { id: uid('f'), itemId, favCategoryId: favCategoryId || '', createdAt: now() };
  state.favItems.push(f);
  saveState();
  return f;
}

/** 取消收藏(按 itemId + favCategoryId) */
export function removeFavItem(itemId, favCategoryId) {
  state.favItems = state.favItems.filter((f) => !(f.itemId === itemId && (favCategoryId === undefined || f.favCategoryId === favCategoryId)));
  saveState();
}

/** 移动收藏项到另一个收藏分类 */
export function moveFavItem(favId, newFavCategoryId) {
  const f = state.favItems.find((x) => x.id === favId);
  if (!f) return null;
  // 目标已存在同动画同分类 → 删除当前(避免重复)
  if (state.favItems.some((x) => x.id !== favId && x.itemId === f.itemId && x.favCategoryId === newFavCategoryId)) {
    state.favItems = state.favItems.filter((x) => x.id !== favId);
  } else {
    f.favCategoryId = newFavCategoryId || '';
  }
  saveState();
  return f;
}

/** 删除动画时同步移除相关收藏 */
export function cleanupFavItems(itemId) {
  const n = state.favItems.length;
  state.favItems = state.favItems.filter((f) => f.itemId !== itemId);
  if (n !== state.favItems.length) saveState();
}

/** 某动画被收藏的位置列表(收藏分类名) */
export function favLocations(itemId) {
  return state.favItems
    .filter((f) => f.itemId === itemId)
    .map((f) => (f.favCategoryId ? favCategoryById(f.favCategoryId)?.name : '') || '未分类收藏');
}

/** 是否已收藏(任一位置) */
export function isFavored(itemId) {
  return state.favItems.some((f) => f.itemId === itemId);
}

/**
 * 收藏夹主页数据:收藏总数(含重复收藏位置) / 涉及资源数 / 类型分布 / 收藏分类列表 / 最近收藏。
 * @returns {{ total, itemCount, byType, favCategories: [{fc,count}], recent: [{fav,item}] }}
 */
export function getFavHomeData() {
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0 };
  const seenItems = new Set();
  let itemCount = 0;
  for (const f of state.favItems) {
    const it = itemById(f.itemId);
    if (!it) continue;
    byType[typeGroup(it.type)]++;
    if (!seenItems.has(it.id)) {
      seenItems.add(it.id);
      itemCount++;
    }
  }
  const favCategories = state.favCategories.map((fc) => ({
    fc,
    count: state.favItems.filter((f) => f.favCategoryId === fc.id).length,
  }));
  const recent = [...state.favItems]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 10)
    .map((f) => ({ fav: f, item: itemById(f.itemId) }))
    .filter((x) => x.item);
  return {
    total: state.favItems.length,
    itemCount,
    byType,
    favCategories,
    recent,
  };
}

// ---------------- 辅助查询 ----------------

/** 当前分类视图下的条目(含全部/未分类) */
export function itemsInCategory(catId) {
  if (catId === 'all') return [...state.items];
  if (catId === '') return state.items.filter((i) => !i.categoryId);
  return state.items.filter((i) => i.categoryId === catId);
}

export function categoryLabel(item) {
  if (!item.categoryId) return '未分类';
  const c = categoryById(item.categoryId);
  return c ? c.name : '未分类';
}

// ---------------- 游戏资源管理器:派生查询 ----------------

/** 按分组过滤条目('anim' 含 spine+dragonbones) */
export function itemsByGroup(group) {
  const types = TYPE_GROUPS[group] || [];
  return state.items.filter((i) => types.includes(i.type));
}

/** 某分类视图下指定分组的条目('all' 或 null = 全类型;含 '' 未分类 语义) */
export function itemsInCategoryAndGroup(catId, group) {
  const inCat = itemsInCategory(catId);
  if (!group || group === 'all') return inCat;
  const types = TYPE_GROUPS[group] || [];
  return inCat.filter((i) => types.includes(i.type));
}

/** 格式化文件大小 */
export function formatSize(bytes) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/** 格式化修改日期 */
export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 目录列表页数据:某分类下直接资源 + 直接子分类 + 统计
 * @returns {{ direct: items[], subcats: categories[], stats: { total, byType, totalSize } }}
 */
export function getFolderData(catId, group) {
  const direct = itemsInCategoryAndGroup(catId, group);
  const subcats = catId === 'all' ? [] : getCategoryChildren(catId);
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0 };
  let totalSize = 0;
  for (const it of direct) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) totalSize += it.size;
  }
  return {
    direct,
    subcats,
    stats: { total: direct.length, byType, totalSize },
  };
}

/**
 * 主页数据:全类型统计 + 目录统计 + 最近添加
 * @returns {{ total, byType, categories: [{cat,count,totalSize}], recent: items[] }}
 */
export function getHomeData() {
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0, totalSize: 0 };
  for (const it of state.items) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) byType.totalSize += it.size;
  }
  const categories = state.categories.map((cat) => {
    let count = 0;
    let totalSize = 0;
    for (const it of state.items) {
      if (it.categoryId === cat.id) {
        count++;
        if (it.size != null) totalSize += it.size;
      }
    }
    return { cat, count, totalSize };
  });
  const recent = [...state.items]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10);
  return {
    total: state.items.length,
    byType,
    categories,
    recent,
  };
}

/**
 * 类型主页数据:某类型(anim/image/audio/3d)的资源统计 + 分类层级树(含各分类该类型资源数)。
 * @param {string} group 'anim' | 'image' | 'audio' | '3d'
 * @returns {{ total, totalSize, byType, categories: [{cat,count,totalSize,subs}], recent }}
 */
export function getTypeHomeData(group) {
  const types = TYPE_GROUPS[group] || [];
  const items = state.items.filter((i) => types.includes(i.type));
  const byType = { anim: 0, image: 0, audio: 0, '3d': 0, totalSize: 0 };
  let totalSize = 0;
  for (const it of items) {
    byType[typeGroup(it.type)]++;
    if (it.size != null) totalSize += it.size;
  }
  // 分类层级树:每个分类节点含「该分类(含子孙)该类型资源数」
  // 按资源类型标签过滤:目录无标签或标签命中当前分组才显示
  const buildCatNode = (cat) => {
    const subs = getCategoryChildren(cat.id)
      .filter((c) => catVisibleInGroup(c, group))
      .map(buildCatNode);
    let count = 0;
    let sz = 0;
    const catIds = new Set([cat.id, ...getCategoryDescendants(cat.id)]);
    for (const it of items) {
      if (catIds.has(it.categoryId)) {
        count++;
        if (it.size != null) sz += it.size;
      }
    }
    return { cat, count, totalSize: sz, subs };
  };
  const categories = getCategoryChildren('')
    .filter((c) => catVisibleInGroup(c, group))
    .map(buildCatNode);
  const recent = [...items]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10);
  return { total: items.length, totalSize, byType, categories, recent, items };
}

/** 排序条目:name→localeCompare;type→分组顺序+名称;size→大小;date→mtime||updatedAt */
export function sortItems(items, by = 'name', dir = 'asc') {
  const mult = dir === 'desc' ? -1 : 1;
  const arr = [...items];
  arr.sort((a, b) => {
    let r = 0;
    if (by === 'name') {
      r = (a.displayName || '').localeCompare(b.displayName || '', 'zh-Hans-CN', { numeric: true });
    } else if (by === 'type') {
      r = typeGroup(a.type).localeCompare(typeGroup(b.type)) || (a.displayName || '').localeCompare(b.displayName || '', 'zh-Hans-CN', { numeric: true });
    } else if (by === 'size') {
      const sa = a.size == null ? -1 : a.size;
      const sb = b.size == null ? -1 : b.size;
      r = sa - sb;
    } else if (by === 'date') {
      const da = a.mtime || a.updatedAt || 0;
      const db = b.mtime || b.updatedAt || 0;
      r = da - db;
    }
    return r * mult;
  });
  return arr;
}

/** 分类路径列表(含自身),供面包屑:如 [{id,name}...] */
export function getCategoryPathList(catId) {
  const parts = [];
  let cur = categoryById(catId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? categoryById(cur.parentId) : null;
  }
  return parts;
}

/** 某分类(含子孙)下指定分组的全部条目,用于树内统计 */
export function itemsInCategoryTreeAndGroup(catId, group) {
  const types = TYPE_GROUPS[group] || [];
  if (catId === 'all') return state.items.filter((i) => types.includes(i.type));
  const ids = new Set([catId, ...getCategoryDescendants(catId)]);
  return state.items.filter((i) => ids.has(i.categoryId) && types.includes(i.type));
}

// ---------------- 设置快捷方法 ----------------

export function setResourceTab(tab) {
  state.settings.resourceTab = tab;
  saveState();
}

export function setListViewMode(mode) {
  state.settings.listViewMode = mode;
  saveState();
}

export function setListSort(by, dir) {
  state.settings.listSortBy = by;
  state.settings.listSortDir = dir;
  saveState();
}

// ---------------- 场景管理(分类 + 场景条目) ----------------

/** 新增场景分类(支持子分类) */
export function addSceneCategory({ name, remark = '', parentId = '' }) {
  const cat = {
    id: uid('sc'),
    name,
    remark,
    parentId: parentId || '',
    sort: state.sceneCategories.length,
    createdAt: now(),
  };
  state.sceneCategories.push(cat);
  saveState();
  return cat;
}

export function updateSceneCategory(id, patch) {
  const cat = state.sceneCategories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

/** 删除场景分类:子分类提升到被删分类的父级,场景条目移到「未分类」(categoryId='') */
export function removeSceneCategory(id) {
  const cat = state.sceneCategories.find((c) => c.id === id);
  if (!cat) return;
  const parentPid = cat.parentId || '';
  state.sceneCategories = state.sceneCategories.filter((c) => c.id !== id);
  for (const c of state.sceneCategories) {
    if (c.parentId === id) c.parentId = parentPid;
  }
  for (const s of state.scenes) {
    if (s.categoryId === id) s.categoryId = '';
  }
  saveState();
}

export function sceneCategoryById(id) {
  return state.sceneCategories.find((c) => c.id === id) || null;
}

/** 场景分类的直接子分类(按数组顺序,即渲染顺序) */
export function getSceneCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.sceneCategories.filter((c) => (c.parentId || '') === pid);
}

export function getSceneCategoryDescendants(catId) {
  const out = [];
  const collect = (pid) => {
    for (const c of state.sceneCategories) {
      if ((c.parentId || '') === pid) {
        out.push(c.id);
        collect(c.id);
      }
    }
  };
  collect(catId);
  return out;
}

/** 拖动排序场景分类 */
export function reorderSceneCategory(fromId, toId, place = 'before') {
  const fromIdx = state.sceneCategories.findIndex((c) => c.id === fromId);
  if (fromIdx < 0) return null;
  const [moved] = state.sceneCategories.splice(fromIdx, 1);
  let toIdx = state.sceneCategories.findIndex((c) => c.id === toId);
  if (toIdx < 0) toIdx = state.sceneCategories.length;
  if (place === 'after') toIdx += 1;
  state.sceneCategories.splice(toIdx, 0, moved);
  state.sceneCategories.forEach((c, i) => { c.sort = i; });
  saveState();
  return moved;
}

/** 新增场景条目;type: 'folder' | 'file';subtype: '' | 'fgui'(FGUI 界面包登记) */
export function addScene({ categoryId = '', name, filePath, type = 'folder', subtype = '', remark = '', tags = [], size = null, mtime = null, fguiSnapshots = [] }) {
  const scene = {
    id: uid('sn'),
    categoryId: categoryId || '',
    name,
    filePath: filePath || '',
    type,
    subtype: subtype || '',
    remark: remark || '',
    tags: cleanTags(tags),
    size,
    mtime,
    fguiSnapshots: Array.isArray(fguiSnapshots) ? fguiSnapshots : [],
    createdAt: now(),
  };
  state.scenes.push(scene);
  saveState();
  return scene;
}

export function updateScene(id, patch) {
  const s = state.scenes.find((x) => x.id === id);
  if (!s) return null;
  if (patch.tags) patch.tags = cleanTags(patch.tags);
  Object.assign(s, patch, { updatedAt: now() });
  saveState();
  return s;
}

export function removeScene(id) {
  state.scenes = state.scenes.filter((s) => s.id !== id);
  saveState();
}

export function sceneById(id) {
  return state.scenes.find((s) => s.id === id) || null;
}

/** 按文件路径精确匹配场景条目(FGUI 包登记查重用),返回第一个或 null */
export function findSceneByFilePath(fp) {
  if (!fp) return null;
  const norm = String(fp).replace(/\\/g, '/');
  return state.scenes.find((s) => String(s.filePath || '').replace(/\\/g, '/') === norm) || null;
}

/** 某分类(含未分类 '')下的直属场景条目 */
export function scenesInCategory(catId) {
  const target = catId === 'all' ? null : (catId || '');
  return state.scenes.filter((s) => (catId === 'all') || (s.categoryId || '') === target);
}

// ---------------- 网址收藏夹(网络资源抓取) ----------------

/** 新增网址收藏夹分类(可嵌套: parentId 指向父分类, '' = 顶级) */
export function addWebBookmarkCategory({ name, remark = '', parentId = '' }) {
  const cat = {
    id: uid('wbc'),
    name,
    remark,
    parentId: parentId || '',
    sort: state.webBookmarkCategories.length,
    createdAt: now(),
  };
  state.webBookmarkCategories.push(cat);
  saveState();
  return cat;
}

export function updateWebBookmarkCategory(id, patch) {
  const cat = state.webBookmarkCategories.find((c) => c.id === id);
  if (!cat) return null;
  Object.assign(cat, patch, { updatedAt: now() });
  saveState();
  return cat;
}

export function webBookmarkCategoryById(id) {
  return state.webBookmarkCategories.find((c) => c.id === id) || null;
}

/** 某分类的直接子分类(按数组顺序,即渲染顺序) */
export function getWebBookmarkCategoryChildren(parentId) {
  const pid = parentId || '';
  return state.webBookmarkCategories.filter((c) => (c.parentId || '') === pid);
}

/** 删除分类:子分类提升到被删分类的父级,网址条目移到「未分类」(categoryId='') */
export function removeWebBookmarkCategory(id) {
  const cat = state.webBookmarkCategories.find((c) => c.id === id);
  if (!cat) return;
  const parentPid = cat.parentId || '';
  state.webBookmarkCategories = state.webBookmarkCategories.filter((c) => c.id !== id);
  for (const c of state.webBookmarkCategories) {
    if (c.parentId === id) c.parentId = parentPid;
  }
  for (const b of state.webBookmarks) {
    if (b.categoryId === id) b.categoryId = '';
  }
  saveState();
}

/** 新增网址收藏条目 */
export function addWebBookmark({ categoryId = '', name, url, remark = '' }) {
  const bm = {
    id: uid('wbm'),
    categoryId: categoryId || '',
    name: name || url,
    url: url || '',
    remark,
    createdAt: now(),
  };
  state.webBookmarks.push(bm);
  saveState();
  return bm;
}

export function updateWebBookmark(id, patch) {
  const bm = state.webBookmarks.find((b) => b.id === id);
  if (!bm) return null;
  Object.assign(bm, patch, { updatedAt: now() });
  saveState();
  return bm;
}

export function removeWebBookmark(id) {
  state.webBookmarks = state.webBookmarks.filter((b) => b.id !== id);
  saveState();
}

export function webBookmarkById(id) {
  return state.webBookmarks.find((b) => b.id === id) || null;
}

/** 某分类(含未分类 '')下的网址收藏条目 */
export function webBookmarksInCategory(catId) {
  const target = catId === 'all' ? null : (catId || '');
  return state.webBookmarks.filter((b) => (catId === 'all') || (b.categoryId || '') === target);
}
