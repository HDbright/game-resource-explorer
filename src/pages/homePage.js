import {
  getHomeData, getTypeHomeData, getCategoryChildren, categoryById,
  TYPE_LABEL, formatSize, TYPE_GROUPS, itemTags, getFavHomeData, favCategoryById,
  categoryTypeTagNames, state,
} from '../state.js';

/** 类型主页中分类目录树的折叠状态(按 catId 记忆,跨类型共享无碍) */
const typeCatExpanded = new Set();

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
 *   - onQuickCat(catId) / onOpenCat(catId):进入目录列表页
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
    { group: '3d', label: '3D 资源', num: data.byType['3d'] || 0, cls: 'd3', size: null },
    { group: 'total', label: '资源总数', num: data.total, cls: 'total', size: data.byType.totalSize },
  ];

  container.innerHTML = `
    <div class="home-title">游戏资源管理</div>
    <div class="home-subtitle">管理您的动画 / 图片 / 音频 / 3D 游戏资源 · 共 ${data.total} 项资源</div>

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
      <div class="home-section-title">📁 目录快捷入口</div>
      <div class="quick-cats" id="home-quick-cats">
        ${data.categories.length ? data.categories.map(({ cat, count, totalSize }) => `
          <div class="quick-cat" data-act="cat" data-cat="${cat.id}">
            <span class="qc-icon">📂</span>
            <span>${escapeHtml(cat.name)}</span>
            <span class="qc-count">${count} 项${totalSize ? ' · ' + formatSize(totalSize) : ''}</span>
          </div>
        `).join('') : '<div class="home-empty">暂无目录,在左侧「XX资源」根节点上右键选择「新建目录」创建</div>'}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近打开</div>
      <div class="recent-list" id="home-recent-opens">
        ${renderRecentOpens(recentOpens)}
      </div>
    </div>

    <div class="home-section">
      <div class="home-section-title">🕘 最近添加</div>
      <div class="recent-list" id="home-recent-list">
        ${renderRecentList(data.recent)}
      </div>
    </div>
  `;
}

/** 首页「最近打开」列表(含打开时间;点击再次打开) */
function renderRecentOpens(list) {
  if (!list || !list.length) return '<div class="home-empty">暂无打开记录,打开过的资源会显示在这里</div>';
  const TYPE_BADGE = { anim: '动画', image: '图片', audio: '音频', '3d': '3D', fgui: 'FGUI', scene: '场景', folder: '目录' };
  return list.map((r) => `
    <div class="recent-item" data-act="recent" data-path="${escapeHtml(r.path || '')}" title="${escapeHtml(r.name || '')} · ${escapeHtml(r.path || '')}">
      <span class="type-badge">${TYPE_BADGE[r.type] || r.type || '文件'}</span>
      <span class="ri-name">${escapeHtml(r.name || '')}</span>
      <span class="ri-meta">${formatOpenTime(r.openedAt)}</span>
    </div>
  `).join('');
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
  const title = GROUP_TITLE[group] || '资源主页';
  const typeDetail = TYPE_GROUPS[group] || [];
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
      <div class="home-section-title">🕘 最近添加</div>
      <div class="recent-list" id="home-recent-list">
        ${renderRecentList(data.recent)}
      </div>
    </div>
  `;
}

function countByType(items, type) {
  return items.filter((i) => i.type === type).length;
}

/** 递归渲染类型主页的分类目录树节点(拓扑结构,缩进表示层级) */
function renderTypeCatNode(node, group, depth, allItems) {
  const { cat, count, totalSize, subs } = node;
  const isOpen = typeCatExpanded.has(cat.id);
  const hasChildren = subs.length > 0;
  const types = TYPE_GROUPS[group] || [];
  const directItems = allItems
    .filter((it) => it.categoryId === cat.id && types.includes(it.type))
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
    for (const s of subs) html += renderTypeCatNode(s, group, depth + 1, allItems);
    for (const it of directItems) {
      html += `
        <div class="type-cat-item" data-item="${it.id}" data-cat="${cat.id}" style="--cat-depth:${depth + 1}" title="${escapeHtml(itemTooltip(it))}">
          <span class="type-cat-item-spacer"></span>
          <span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
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
    <div class="recent-item" data-act="item" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
      <span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
      <span class="ri-name">${escapeHtml(it.displayName || '')}</span>
      <span class="ri-meta">${it.categoryId ? escapeHtml((categoryById(it.categoryId) || {}).name || '') : '未分类'}</span>
    </div>
  `).join('');
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
