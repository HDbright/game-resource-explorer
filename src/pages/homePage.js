import {
  getHomeData, getTypeHomeData, getCategoryChildren, categoryById,
  TYPE_LABEL, formatSize, TYPE_GROUPS, itemTags, getFavHomeData, favCategoryById,
  categoryTypeTagNames, state, customTypeGroupById, typeGroup, typeLabel, catVisibleInAnyGroup,
  isImageType, isVideoItem, resourceTypeIcon,
} from '../state.js';
import { toast } from '../dialogs.js';
import { thumbnailService } from '../thumbnails.js';

/** 类型主页中分类目录树的折叠状态(按 catId 记忆,跨类型共享无碍) */
const typeCatExpanded = new Set();

/** 全局主页「目录管理」模式状态: 勾选目录 → 批量删除/移动 */
const homeManage = { active: false, sel: new Set() };

/** 资源悬停提示(多行):名称/类型/分类/标签/备注/文件 */
function itemTooltip(it) {
  const tags = itemTags(it);
  const typeName = it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type] || it.type;
  const catName = it.categoryId ? (categoryById(it.categoryId)?.name || '未分类') : '未分类';
  const lines = [`名称: ${it.displayName || ''}`, `类型: ${typeName}`, `目录: ${catName}`];
  if (tags.length) lines.push(`标签: ${tags.join('、')}`);
  if (it.remark) lines.push(`备注: ${it.remark}`);
  lines.push(`文件: ${it.filePath || ''}`);
  return lines.join('\n');
}

/**
 * 主页渲染入口:
 * - resourceTab='home'/'all' → 全局主页(各类统计 + 目录快捷 + 最近添加)
 * - resourceTab='anim'|'image'|'audio'|'3d' → 类型主页(当前类型统计 + 层级分类目录树 + 最近添加)
 *
 * @param {HTMLElement} container #page-home
 * @param {object} actions
 *   - resourceTab
 *   - onTab(group):统计卡片点击切换类型
 *   - onOpenCat(catId):进入目录列表页(目录快捷入口 data-act='cat' 唯一入口,无 onQuickCat)
 *   - onRecentItem(itemId) / onOpenItem(itemId):预览资源
 *   - onCatMenu(cat, e) / onItemMenu(item, e):右键菜单
 *   - onRefresh():折叠/展开后重新渲染
 */
export function renderHomePage(container, actions = {}) {
  const tab = actions.resourceTab || 'home';
  container.__homeItems = actions.homeItems || [];
  if (tab === 'home' || tab === 'all') renderGlobalHome(container, actions);
  else renderTypeHome(container, actions, tab);
  bindHomeEvents(container, actions);
}

// ================= 全局主页 =================

function renderGlobalHome(container, actions) {
  const data = getHomeData();
  const recentOpens = (state.settings && state.settings.recentOpens) || [];
  const cards = [
    { group: 'anim', label: '动画资源', num: data.byType.anim, cls: 'anim', size: data.byType.totalSize },
    { group: 'image', label: '图片资源', num: data.byType.image, cls: 'image', size: null },
    { group: 'audio', label: '音频资源', num: data.byType.audio, cls: 'audio', size: null },
    { group: '3d', label: '3D资源', num: data.byType['3d'] || 0, cls: 'd3', size: null },
    { group: 'icon', label: '图标资源', num: data.byType.icon || 0, cls: 'icon', size: null },
    { group: 'video', label: '视频资源', num: data.byType.video || 0, cls: 'video', size: null },
    { group: 'ui', label: 'UI资源', num: data.byType.fgui || 0, cls: 'ui', size: null },
    { group: 'article', label: '文档资源', num: data.byType.article || 0, cls: 'article', size: null },
    { group: 'database', label: '数据资源', num: data.byType.database || 0, cls: 'database', size: null },
    { group: 'total', label: '资源总数', num: data.total, cls: 'total', size: data.byType.totalSize },
  ];
  const mgmt = homeManage.active;
  const cats = data.categories || [];

  container.innerHTML = `
    <div class="home-title-row">
      <div class="home-title">游戏资源管理</div>
      ${cats.length ? `<button class="btn sm ${mgmt ? 'active' : ''}" id="home-mgmt-btn" title="管理模式: 勾选目录后批量删除 / 移动">${mgmt ? '✓ 完成管理' : '🛠 管理'}</button>` : ''}
    </div>
    <div class="home-subtitle">管理您的动画 / 图片 / 音频 / 3D / 图标 / 视频 / UI / 文档 / 数据游戏资源 · 共 ${data.total} 项资源</div>

    <div class="home-cards">
      ${cards.map((c) => `
        <div class="stat-card ${c.cls}" data-act="card" data-group="${c.group}">
          <div class="sc-num">${c.num}</div>
          <div class="sc-label">${c.label}</div>
          <div class="sc-sub">${c.size != null ? '占用 ' + formatSize(c.size) : '&nbsp;'}</div>
        </div>
      `).join('')}
    </div>

    <div class="home-section">
      <div class="home-section-title">📁 目录快捷入口
        ${mgmt ? `<label class="home-mgmt-selectall"><input type="checkbox" id="home-mgmt-all" /> 全选</label>` : ''}
      </div>
      ${mgmt ? `
        <div class="home-mgmt-bar">
          <span class="hm-count" id="home-mgmt-count">已选 0 个目录</span>
          <span class="wg-tbsep"></span>
          <button class="btn sm" id="home-mgmt-move" disabled title="把选中的目录移动到其它目录下">📂 移动</button>
          <button class="btn sm danger" id="home-mgmt-del" disabled title="删除选中的目录及其下动画和子目录(仅从列表移除,不删磁盘文件)">🗑 删除</button>
        </div>` : ''}
      <div class="quick-cats" id="home-quick-cats">
        ${cats.length ? cats.map(({ cat, count, totalSize }) => `
          <div class="quick-cat ${mgmt ? 'mgmt' : ''}" data-act="cat" data-cat="${cat.id}">
            ${mgmt ? `<input type="checkbox" class="qc-check" data-check="${cat.id}" ${homeManage.sel.has(cat.id) ? 'checked' : ''} />` : ''}
            <span class="qc-icon">📂</span>
            <span>${escapeHtml(cat.name)}</span>
            <span class="qc-count">${count} 项${totalSize ? ' · ' + formatSize(totalSize) : ''}</span>
          </div>
        `).join('') : '<div class="home-empty">暂无目录,在左侧「XX资源」根节点上右键选择「新建目录」创建</div>'}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近打开</div>
      <div class="recent-grid" id="home-recent-opens">
        ${renderRecentOpens(recentOpens)}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近添加</div>
      <div class="recent-grid" id="home-recent-list">
        ${renderRecentList(data.recent)}
      </div>
    </div>
  `;

  // 最近打开/最近添加缩略图异步加载(打开记录里可解析到条目的一并加载)
  loadRecentThumbs(container, data.recent.concat(recentOpens.map((r) => (r.itemId ? state.items.find((i) => i.id === r.itemId) : null)).filter(Boolean)));

  // ---- 目录管理模式交互 ----
  const mgmtBtn = container.querySelector('#home-mgmt-btn');
  if (mgmtBtn) {
    mgmtBtn.addEventListener('click', () => {
      homeManage.active = !homeManage.active;
      homeManage.sel.clear();
      actions.onRefresh && actions.onRefresh();
    });
  }
  if (mgmt) {
    const syncSelUI = () => {
      const cnt = container.querySelector('#home-mgmt-count');
      if (cnt) cnt.textContent = `已选 ${homeManage.sel.size} 个目录`;
      const all = container.querySelector('#home-mgmt-all');
      if (all) { all.checked = cats.length > 0 && homeManage.sel.size === cats.length; }
      const del = container.querySelector('#home-mgmt-del');
      const mv = container.querySelector('#home-mgmt-move');
      const has = homeManage.sel.size > 0;
      if (del) del.disabled = !has;
      if (mv) mv.disabled = !has;
    };
    const allEl = container.querySelector('#home-mgmt-all');
    if (allEl) {
      allEl.addEventListener('change', (e) => {
        if (e.target.checked) cats.forEach(({ cat }) => homeManage.sel.add(cat.id));
        else homeManage.sel.clear();
        container.querySelectorAll('.qc-check').forEach((cb) => { cb.checked = homeManage.sel.has(cb.dataset.check); });
        syncSelUI();
      });
    }
    container.querySelectorAll('.qc-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.check;
        if (cb.checked) homeManage.sel.add(id);
        else homeManage.sel.delete(id);
        syncSelUI();
      });
    });
    container.querySelector('#home-mgmt-del').addEventListener('click', () => {
      if (!homeManage.sel.size) { toast('请先勾选目录', 'warn'); return; }
      actions.onManageDelete && actions.onManageDelete([...homeManage.sel]);
    });
    container.querySelector('#home-mgmt-move').addEventListener('click', () => {
      if (!homeManage.sel.size) { toast('请先勾选目录', 'warn'); return; }
      actions.onManageMove && actions.onManageMove([...homeManage.sel]);
    });
    syncSelUI();
  }
}

/** 首页「最近打开」平铺卡片(含打开时间;点击再次打开;可解析到条目的显示缩略图) */
function renderRecentOpens(list) {
  if (!list || !list.length) return '<div class="home-empty">暂无打开记录,打开过的资源会显示在这里</div>';
  return list.map((r) => {
    const it = r.itemId ? state.items.find((i) => i.id === r.itemId) : null;
    const icon = resourceTypeIcon(it ? it.type : r.type) || '📄';
    return `
    <div class="recent-card" data-act="recent" data-path="${escapeHtml(r.path || '')}" title="${escapeHtml(r.name || '')} · ${escapeHtml(r.path || '')}">
      <span class="rc-thumb" ${it ? `data-thumb="${it.id}"` : ''}>
        <span class="rc-fallback">${icon}</span>
      </span>
      <span class="rc-name">${escapeHtml(r.name || '')}</span>
      <span class="rc-meta">${formatOpenTime(r.openedAt)}</span>
    </div>
  `;
  }).join('');
}

function formatOpenTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ================= 类型主页 =================

const GROUP_TITLE = { anim: '动画主页', image: '图片主页', audio: '音频主页', '3d': '3D 资源主页' };

function renderTypeHome(container, actions, group) {
  const data = getTypeHomeData(group);
  const roList = typeRecentOpens(group);
  const cg = customTypeGroupById(group); // 自定义分组
  const title = (GROUP_TITLE[group] || (cg ? cg.name + '主页' : '资源主页'));
  const typeDetail = cg ? [group] : (TYPE_GROUPS[group] || []);
  const subParts = [`共 ${data.total} 项`];
  if (typeDetail.length > 1) {
    subParts.push(typeDetail.map((t) => `${TYPE_LABEL[t]} ${countByType(data.items, t)}`).join(' / '));
  }
  subParts.push(`占用 ${formatSize(data.totalSize)}`);

  // 统计卡片:资源总数 / 占用空间 / 目录数
  const cards = [
    { label: '资源总数', num: data.total, cls: 'total', size: data.totalSize },
    { label: '占用空间', num: formatSize(data.totalSize), cls: 'total', size: null },
    { label: '目录数', num: countCatNodes(data.categories), cls: group === '3d' ? 'd3' : group, size: null },
  ];

  container.innerHTML = `
    <div class="home-title">${title}</div>
    <div class="home-subtitle">${subParts.join(' · ')}</div>

    <div class="home-cards">
      ${cards.map((c) => `
        <div class="stat-card ${c.cls}" data-act="card" data-group="${group}">
          <div class="sc-num">${c.num}</div>
          <div class="sc-label">${c.label}</div>
          <div class="sc-sub">${c.size != null ? '占用 ' + formatSize(c.size) : '&nbsp;'}</div>
        </div>
      `).join('')}
    </div>

    <div class="home-section">
      <div class="home-section-title">📁 目录</div>
      <div class="type-cat-tree" id="type-cat-tree">
        ${data.categories.length
          ? data.categories.map((n) => renderTypeCatNode(n, group, 0, data.items)).join('')
          : '<div class="home-empty">暂无目录,在左侧「XX资源」根节点上右键选择「新建目录」创建</div>'}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近打开</div>
      <div class="recent-grid" id="home-recent-opens">
        ${renderRecentOpens(roList)}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近添加</div>
      <div class="recent-grid" id="home-recent-list">
        ${renderRecentList(data.recent)}
      </div>
    </div>
  `;

  // 最近打开/最近添加缩略图异步加载
  loadRecentThumbs(container, data.recent.concat(roList.map((r) => (r.itemId ? state.items.find((i) => i.id === r.itemId) : null)).filter(Boolean)));
}

/**
 * 目录「允许显示的类型组」视图:分类树只显示 分类标签命中勾选类型组 或 分类未勾选任何标签(全部) 的分类;条目按勾选类型组过滤。
 * @param {HTMLElement} container
 * @param {object} actions 同 renderHomePage 契约(onOpenCat/onOpenItem/onItemMenu/onCatMenu/onRefresh/onOpenRecent)
 * @param {string[]} tags 勾选的类型组(分组标签数组)
 * @param {string} title 视图标题(目录名)
 */
export function renderFilterHome(container, actions = {}, tags = [], title = '资源') {
  const tagSet = new Set(tags);
  const items = state.items.filter((it) => tagSet.has(typeGroup(it.type)));
  let totalSize = 0;
  for (const it of items) totalSize += it.size || 0;
  const buildCatNode = (cat) => {
    const subs = getCategoryChildren(cat.id)
      .filter((c) => catVisibleInAnyGroup(c, tagSet))
      .map(buildCatNode);
    const direct = items.filter((it) => it.categoryId === cat.id);
    let count = direct.length;
    let sz = 0;
    for (const it of direct) sz += it.size || 0;
    for (const s of subs) { count += s.count; sz += s.totalSize; }
    return { cat, count, totalSize: sz, subs, direct };
  };
  const categories = getCategoryChildren('')
    .filter((c) => catVisibleInAnyGroup(c, tagSet))
    .map(buildCatNode);

  container.__homeItems = items;
  container.innerHTML = `
    <div class="home-title">${escapeHtml(title)}</div>
    <div class="home-subtitle">${items.length} 项资源 · 占用 ${formatSize(totalSize)}</div>
    <div class="home-cards">
      <div class="stat-card total" data-act="card">
        <div class="sc-num">${items.length}</div>
        <div class="sc-label">资源总数</div>
        <div class="sc-sub">${formatSize(totalSize)}</div>
      </div>
      <div class="stat-card total" data-act="card">
        <div class="sc-num">${countCatNodes(categories)}</div>
        <div class="sc-label">目录数</div>
        <div class="sc-sub">&nbsp;</div>
      </div>
    </div>
    <div class="home-section">
      <div class="home-section-title">📁 目录</div>
      <div class="type-cat-tree" id="type-cat-tree">
        ${categories.length
          ? categories.map((n) => renderTypeCatNode(n, null, 0, items, tagSet)).join('')
          : '<div class="home-empty">暂无符合条件的目录(仅显示勾选类型组或未勾选任何标签的目录)</div>'}
      </div>
    </div>
    <div class="home-section">
      <div class="home-section-title">🕘 最近添加</div>
      <div class="recent-grid" id="home-recent-list">
        ${renderRecentList([...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 10))}
      </div>
    </div>
  `;
  // 最近添加缩略图异步加载
  loadRecentThumbs(container, items);
  bindHomeEvents(container, actions);
}

/** 该类型组的最近打开记录(只显示对应类型的资源) */
function typeRecentOpens(group) {
  const all = (state.settings && state.settings.recentOpens) || [];
  const typeSet = new Set(TYPE_GROUPS[group] || []);
  if (customTypeGroupById(group)) typeSet.add(group); // 自定义分组:匹配分组 id
  return all.filter((r) => typeSet.has(r.type) || r.tab === group).slice(0, 10);
}

function countByType(items, type) {
  return items.filter((i) => i.type === type).length;
}

/** 递归渲染类型主页的分类目录树节点(拓扑结构,缩进表示层级);typeSet 提供时按类型组集合过滤(目录「允许显示的类型组」视图) */
function renderTypeCatNode(node, group, depth, allItems, typeSet) {
  const { cat, count, totalSize, subs } = node;
  // 默认展开顶层分类(用户尚未手动展开/折叠过),让动画主页直接显示资源文件,
  // 避免「目录树折叠看不到文件」的体验问题;用户可点 ▶ 自行折叠
  const userTouched = typeCatExpanded.size > 0;
  const isOpen = typeCatExpanded.has(cat.id) || (depth === 0 && !userTouched);
  const hasChildren = subs.length > 0;
  const directItems = allItems
    .filter((it) => it.categoryId === cat.id && (typeSet ? typeSet.has(typeGroup(it.type)) : typeGroup(it.type) === group))
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'zh-Hans-CN'));

  const arrow = (hasChildren || directItems.length > 0) ? (isOpen ? '▼' : '▶') : '·';
  const countTxt = count > 0 ? `<span class="type-cat-count">${count} 项${totalSize ? ' · ' + formatSize(totalSize) : ''}</span>` : '';
  // 悬停提示:资源类型标签(备注字段已改为标签勾选;类型主页树已按标签过滤)
  const tagNames = categoryTypeTagNames(cat);
  const catTip = tagNames.length ? `资源类型: ${tagNames.join(' / ')}` : '所有资源类型';

  let html = `
    <div class="type-cat-node" data-cat="${cat.id}" style="--cat-depth:${depth}">
      <span class="type-cat-arrow" data-act="toggle" data-cat="${cat.id}">${arrow}</span>
      <span class="type-cat-icon">📂</span>
      <span class="type-cat-name" data-act="cat" data-cat="${cat.id}" title="${escapeHtml(catTip)}">${escapeHtml(cat.name)}</span>
      ${countTxt}
    </div>
  `;

  if (isOpen && (hasChildren || directItems.length > 0)) {
    html += `<div class="type-cat-children">`;
    for (const s of subs) html += renderTypeCatNode(s, group, depth + 1, allItems, typeSet);
    for (const it of directItems) {
      html += `
        <div class="type-cat-item" data-act="item" data-item="${it.id}" data-cat="${cat.id}" style="--cat-depth:${depth + 1}" title="${escapeHtml(itemTooltip(it))}">
          <span class="type-cat-item-spacer"></span>
          <span class="type-badge ${it.type}">${typeLabel(it.type)}</span>
          <span class="type-cat-item-name">${escapeHtml(it.displayName || '')}</span>
          <span class="type-cat-item-size">${formatSize(it.size)}</span>
        </div>
      `;
    }
    html += `</div>`;
  }
  return html;
}

/** 统计分类树节点总数(含子节点) */
function countCatNodes(nodes) {
  return nodes.reduce((acc, n) => acc + 1 + countCatNodes(n.subs), 0);
}

// ================= 公共渲染 =================

function renderRecentList(recent) {
  if (!recent.length) return '<div class="home-empty">暂无资源,点击顶栏「+ 添加资源」开始</div>';
  return recent.map((it) => `
    <div class="recent-card" data-act="item" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
      <span class="rc-thumb" data-thumb="${it.id}">
        <span class="rc-fallback">${resourceTypeIcon(it.type) || '📄'}</span>
      </span>
      <span class="rc-name">${escapeHtml(it.displayName || '')}</span>
      <span class="rc-meta">${it.categoryId ? escapeHtml((categoryById(it.categoryId) || {}).name || '') : '未分类'}</span>
    </div>
  `).join('');
}

/** 该条目是否可生成缩略图(图片/图标/动画/UI/视频);音频、3D 等仅显示类型图标 */
function recentCanThumb(it) {
  if (!it) return false;
  if (it.type === 'audio' || it.type === 'model') return false;
  return isImageType(it.type) || it.type === 'fgui' || isVideoItem(it.type) || typeGroup(it.type) === 'anim';
}

/**
 * 异步为「最近打开/最近添加」平铺卡片中的 .rc-thumb 占位加载条目缩略图(与列表页同一套 thumbnailService)。
 * - 同一 itemId 可能同时出现在「最近打开」与「最近添加」,一次加载填充全部匹配占位(去重防重复生成);
 * - 无缩略图能力的类型(音频/3D 等)或加载失败时保留类型图标 .rc-fallback。
 */
function loadRecentThumbs(container, items) {
  const seen = new Set();
  for (const it of items || []) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    if (!recentCanThumb(it)) continue;
    const boxes = [...container.querySelectorAll(`.rc-thumb[data-thumb="${it.id}"]`)];
    if (!boxes.length) continue;
    const apply = (u) => {
      if (!u) return; // 加载失败/无缩略图 → 保留类型图标
      for (const box of boxes) {
        const fb = box.querySelector('.rc-fallback');
        if (fb) fb.style.display = 'none';
        const img = document.createElement('img');
        img.className = 'rc-thumb-img';
        img.alt = '';
        img.onerror = () => { try { img.remove(); if (fb) fb.style.display = ''; } catch (e) { /* ignore */ } };
        box.appendChild(img);
        img.src = u;
      }
    };
    if (isImageType(it.type)) {
      apply(thumbnailService.thumbnailUrl(it));
    } else if (it.type === 'fgui') {
      thumbnailService.getFguiThumb(it).then(apply);
    } else if (isVideoItem(it)) {
      thumbnailService.getVideoThumb(it).then(apply);
    } else {
      thumbnailService.getAnimThumb(it).then(apply);
    }
  }
}

/** 主页事件委托(点击 + 右键) */
function bindHomeEvents(container, actions) {
  container.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    if (act === 'toggle') {
      // 折叠/展开分类目录
      const catId = el.dataset.cat;
      if (typeCatExpanded.has(catId)) typeCatExpanded.delete(catId);
      else typeCatExpanded.add(catId);
      actions.onRefresh && actions.onRefresh();
      return;
    }
    if (act === 'card') {
      actions.onTab && actions.onTab(el.dataset.group);
      return;
    }
    if (act === 'cat') {
      if (homeManage.active) return; // 管理模式: 勾选优先, 点击不跳转
      actions.onOpenCat && actions.onOpenCat(el.dataset.cat);
      return;
    }
    if (act === 'item') {
      actions.onOpenItem && actions.onOpenItem(el.dataset.item);
      return;
    }
    if (act === 'recent') {
      actions.onOpenRecent && actions.onOpenRecent(el.dataset.path);
      return;
    }
  };

  container.oncontextmenu = (e) => {
    const itemEl = e.target.closest('[data-item]');
    const catEl = e.target.closest('[data-cat]');
    if (itemEl) {
      e.preventDefault();
      const it = (container.__homeItems || []).find((i) => i.id === itemEl.dataset.item);
      if (it) actions.onItemMenu && actions.onItemMenu(it, e);
      return;
    }
    if (catEl) {
      e.preventDefault();
      const cat = categoryById(catEl.dataset.cat);
      if (cat) actions.onCatMenu && actions.onCatMenu(cat, e);
    }
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 收藏夹主页:收藏统计 + 收藏分类入口 + 最近收藏(类似类型主页)。
 * @param {HTMLElement} container #page-home
 * @param {object} actions
 *   - onOpenFavCat(fcId) 进入收藏夹目录列表页
 *   - onOpenItem(itemId) 预览
 *   - onItemMenu(it, e) / onFavCatMenu(fc, e) 右键
 *   - onEditFavCat(fcId) / onDeleteFavCat(fcId)
 */
export function renderFavHome(container, actions = {}) {
  const data = getFavHomeData();
  const cards = [
    { label: '收藏总数', num: data.total, cls: 'anim' },
    { label: '涉及资源', num: data.itemCount, cls: 'total' },
    { label: '收藏分类', num: data.favCategories.length, cls: 'audio' },
  ];
  const typeTxt = [];
  if (data.byType.anim) typeTxt.push(`动画 ${data.byType.anim}`);
  if (data.byType.image) typeTxt.push(`图片 ${data.byType.image}`);
  if (data.byType.audio) typeTxt.push(`音频 ${data.byType.audio}`);
  if (data.byType['3d']) typeTxt.push(`3D ${data.byType['3d']}`);

  container.innerHTML = `
    <div class="home-title">收藏夹主页</div>
    <div class="home-subtitle">共 ${data.total} 个收藏${typeTxt.length ? ' · ' + typeTxt.join(' / ') : ''}</div>

    <div class="home-cards">
      ${cards.map((c) => `
        <div class="stat-card ${c.cls}">
          <div class="sc-num">${c.num}</div>
          <div class="sc-label">${c.label}</div>
          <div class="sc-sub">&nbsp;</div>
        </div>
      `).join('')}
    </div>

    <div class="home-section">
      <div class="home-section-title">📁 收藏分类</div>
      <div class="quick-cats">
        ${data.favCategories.length ? data.favCategories.map(({ fc, count }) => `
          <div class="quick-cat" data-favcat="${fc.id}" title="${escapeHtml(fc.name)}">
            <span class="qc-icon">📁</span>
            <span>${escapeHtml(fc.name)}</span>
            <span class="qc-count">${count} 个收藏</span>
            <span class="qc-ops">
              <button class="icon-btn" data-favop="edit" data-favcat="${fc.id}" title="编辑收藏分类">✎</button>
              <button class="icon-btn danger" data-favop="del" data-favcat="${fc.id}" title="删除收藏分类">✕</button>
            </span>
          </div>
        `).join('') : '<div class="home-empty">还没有收藏分类,点击侧栏收藏夹旁的 ＋ 或收藏资源时创建</div>'}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近收藏</div>
      <div class="recent-list">
        ${data.recent.length ? data.recent.map(({ fav, item }) => `
          <div class="recent-item" data-item="${item.id}" title="${escapeHtml(itemTooltip(item))}">
            <span class="type-badge ${item.type}">${TYPE_LABEL[item.type] || item.type}</span>
            <span class="ri-name">${escapeHtml(item.displayName || '')}</span>
            <span class="ri-meta">${fav.favCategoryId ? escapeHtml(favCategoryById(fav.favCategoryId)?.name || '') : '未分类'}</span>
          </div>
        `).join('') : '<div class="home-empty">暂无收藏,点击资源行 ★ 或右键「收藏」开始</div>'}
      </div>
    </div>
  `;

  container.onclick = (e) => {
    const op = e.target.closest('[data-favop]');
    if (op) {
      const fcId = op.dataset.favcat;
      if (op.dataset.favop === 'edit') actions.onEditFavCat && actions.onEditFavCat(fcId);
      else if (op.dataset.favop === 'del') actions.onDeleteFavCat && actions.onDeleteFavCat(fcId);
      return;
    }
    const cat = e.target.closest('[data-favcat]');
    if (cat) {
      actions.onOpenFavCat && actions.onOpenFavCat(cat.dataset.favcat);
      return;
    }
    const item = e.target.closest('[data-item]');
    if (item) actions.onOpenItem && actions.onOpenItem(item.dataset.item);
  };

  container.oncontextmenu = (e) => {
    const itemEl = e.target.closest('[data-item]');
    const catEl = e.target.closest('[data-favcat]');
    if (itemEl) {
      e.preventDefault();
      const it = data.recent.map((x) => x.item).find((i) => i && i.id === itemEl.dataset.item);
      if (it) actions.onItemMenu && actions.onItemMenu(it, e);
      return;
    }
    if (catEl) {
      e.preventDefault();
      const fc = favCategoryById(catEl.dataset.favcat);
      if (fc) actions.onFavCatMenu && actions.onFavCatMenu(fc, e);
    }
  };
}
