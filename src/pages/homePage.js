import {
  getHomeData, getTypeHomeData, getCategoryChildren, categoryById,
  TYPE_LABEL, formatSize, TYPE_GROUPS,
} from '../state.js';

/** 类型主页中分类目录树的折叠状态(按 catId 记忆,跨类型共享无碍) */
const typeCatExpanded = new Set();

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
        `).join('') : '<div class="home-empty">暂无分类目录,点击顶栏「新建分类」创建</div>'}
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

  // 统计卡片:资源总数 / 占用空间 / 分类目录数
  const cards = [
    { label: '资源总数', num: data.total, cls: 'total', size: data.totalSize },
    { label: '占用空间', num: formatSize(data.totalSize), cls: 'total', size: null },
    { label: '分类目录', num: countCatNodes(data.categories), cls: group === '3d' ? 'd3' : group, size: null },
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
      <div class="home-section-title">📁 分类目录</div>
      <div class="type-cat-tree" id="type-cat-tree">
        ${data.categories.length
          ? data.categories.map((n) => renderTypeCatNode(n, group, 0, data.items)).join('')
          : '<div class="home-empty">暂无分类目录,点击顶栏「新建分类」创建</div>'}
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

  let html = `
    <div class="type-cat-node" data-cat="${cat.id}" style="--cat-depth:${depth}">
      <span class="type-cat-arrow" data-act="toggle" data-cat="${cat.id}">${arrow}</span>
      <span class="type-cat-icon">📂</span>
      <span class="type-cat-name" data-act="cat" data-cat="${cat.id}" title="${escapeHtml(cat.remark || '')}">${escapeHtml(cat.name)}</span>
      ${countTxt}
    </div>
  `;

  if (isOpen && (hasChildren || directItems.length > 0)) {
    html += `<div class="type-cat-children">`;
    for (const s of subs) html += renderTypeCatNode(s, group, depth + 1, allItems);
    for (const it of directItems) {
      html += `
        <div class="type-cat-item" data-item="${it.id}" data-cat="${cat.id}" style="--cat-depth:${depth + 1}">
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
    <div class="recent-item" data-act="item" data-item="${it.id}">
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
