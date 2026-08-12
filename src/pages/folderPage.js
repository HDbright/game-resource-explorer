import { state, getFolderData, sortItems, formatSize, formatDate, TYPE_LABEL, typeGroup, categoryById, getCategoryPathList, itemTags, categoryLabel, favCategoryById, itemById, catVisibleInGroup, categoryTypeTagNames, getCategoryChildren, TYPE_GROUPS } from '../state.js';
import { thumbnailService } from '../thumbnails.js';
import { loadSearchHistory, saveSearchHistory, addSearchHistory, removeSearchHistory } from '../searchHistory.js';
import { findAtlasCompanion } from '../atlasView.js';

/** 搜索模式资源池:catId=null 全库;否则含子分类递归;types=null 全部类型 */
function collectSearchPool(catId, types) {
  const catIds = new Set();
  const walk = (id) => {
    if (!id) return;
    catIds.add(id);
    for (const c of getCategoryChildren(id)) walk(c.id);
  };
  if (catId != null) walk(catId);
  return state.items.filter((it) => {
    if (types && !types.includes(it.type)) return false;
    return catId == null ? true : catIds.has(it.categoryId);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 文件路径 basename(最后一段) */
function basename(p) { return String(p || '').split(/[\\/]/).pop(); }
/** 列表/详情/缩略图显示的文件名:优先取真实文件名(带后缀),缺文件路径时回退 displayName */
function itemFileName(it) { return basename(it.filePath) || it.displayName || ''; }

/** 常见扩展名颜色表(缩略图文件名后缀配色) */
const EXT_COLORS = {
  png: '#6fd8a0', jpg: '#ffb36b', jpeg: '#ffb36b', gif: '#ff8fd8', webp: '#7fc8ff', bmp: '#b0a8ff', svg: '#ffd76b', tga: '#ff9e9e', astc: '#ff9e9e',
  json: '#9ad1ff', skel: '#ff9e9e', atlas: '#c9a2ff', plist: '#c9a2ff', bin: '#c9a2ff', fnt: '#9ad1ff', jta: '#9ad1ff',
  mp3: '#ff9e9e', wav: '#ff9e9e', ogg: '#ff9e9e', flac: '#ff9e9e', m4a: '#ff9e9e', wma: '#ff9e9e',
  mp4: '#7fc8ff', webm: '#7fc8ff',
  glb: '#9ad1ff', gltf: '#9ad1ff',
  sk: '#ffb36b', lsk: '#ffb36b',
};
/** 扩展名 → 颜色(常见扩展名固定色,未知扩展名按哈希取色,便于区分) */
function extColor(ext) {
  const e = String(ext || '').toLowerCase();
  if (EXT_COLORS[e]) return EXT_COLORS[e];
  let h = 0;
  for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 62%)`;
}
/** 缩略图卡片名称 HTML:文件名主体 + 彩色扩展名 */
function nameExtHtml(it) {
  const fn = itemFileName(it);
  if (!fn) return '';
  const dot = fn.lastIndexOf('.');
  if (dot > 0) {
    const ext = fn.slice(dot + 1);
    return `<span class="rc-base">${escapeHtml(fn.slice(0, dot))}</span><span class="rc-ext" style="color:${extColor(ext)}">.${escapeHtml(ext)}</span>`;
  }
  return `<span class="rc-base">${escapeHtml(fn)}</span>`;
}

/** 异步把「图片」类型徽章细化为「图集」(同名 .atlas/.plist 配套) */
function bindAtlasBadges(container, items) {
  for (const it of items) {
    if (it.type !== 'image') continue;
    findAtlasCompanion(it).then((kind) => {
      if (!kind) return;
      container.querySelectorAll(`[data-item="${it.id}"] .type-badge.image`).forEach((el) => {
        el.textContent = '图集';
        el.className = 'type-badge atlas';
        el.title = kind === 'plist' ? '该图片带同名 .plist 图集配套' : '该图片带同名 .atlas 图集配套';
      });
    }).catch(() => { /* 检测失败保持「图片」 */ });
  }
}

const VIEW_LABEL = { detail: '详情', list: '列表', icon: '图标' };
const VIEW_LABEL_TXT = { anim: '动画', image: '图片', audio: '音频' };

/**
 * 目录列表页:统计区 + 视图切换 + 排序 + 编辑模式 + 子目录 + 资源列表(详情/列表/图标)。
 *
 * @param {HTMLElement} container #page-folder
 * @param {object} opts
 *   - catId 当前分类 id('' = 未分类,'all' = 全部)
 *   - group 当前资源分组('anim'|'image'|'audio'|'3d'|'all')
 *   - viewMode / sortBy / sortDir 从 settings 传入
 *   - editMode 是否处于编辑模式
 *   - selectedIds 已选资源 id 数组(编辑模式)
 *   - actions: { onOpenCat(catId), onOpenItem(itemId), onRenameCat(catId), onDeleteCat(catId),
 *                onNewSubCat(catId), onItemMenu(item, e), onCatMenu(cat, e), onViewMode(mode), onSort(by, dir),
 *                onToggleEditMode(), onEditToggleItem(id), onEditSelectAll(), onEditSelectNone(), onEditInvert(),
 *                onEditBatchDelete(ids), onEditBatchMove(ids) }
 */
export function renderFolderPage(container, opts) {
  const { catId, group, viewMode = 'list', sortBy = 'name', sortDir = 'asc', actions = {} } = opts;
  const editMode = !!opts.editMode;
  const selectedIds = new Set(opts.selectedIds || []);
  const tagFilter = opts.tagFilter || '';
  const searchText = opts.searchText || '';
  const searchMode = !!opts.searchMode; // 顶栏全局搜索:全类型/递归子目录范围

  const data = getFolderData(catId, group);

  // 搜索模式数据源:home → 全部类型;类型 → 该类型;目录 → 该目录含子分类递归
  let pool = data.direct;
  if (searchMode) {
    const types = group === 'home' ? null : (TYPE_GROUPS[group] || null);
    pool = collectSearchPool(catId === 'all' ? null : catId, types);
  }

  // 标签过滤 + 文本搜索(名称 / 属性 / 标签)
  let sorted = sortItems(pool, sortBy, sortDir);
  const filterActive = !!(tagFilter || searchText);
  if (tagFilter) sorted = sorted.filter((i) => itemTags(i).includes(tagFilter));
  if (searchText) {
    const q = searchText.toLowerCase();
    sorted = sorted.filter((i) =>
      String(i.displayName || '').toLowerCase().includes(q) ||
      String(i.remark || '').toLowerCase().includes(q) ||
      String(i.filePath || '').toLowerCase().includes(q) ||
      String(TYPE_LABEL[i.type] || '').toLowerCase().includes(q) ||
      String(categoryLabel(i)).toLowerCase().includes(q) ||
      itemTags(i).some((t) => t.toLowerCase().includes(q))
    );
  }

  // 标签过滤下拉候选:当前目录条目中出现过的标签
  const folderTags = [...new Set(data.direct.flatMap((i) => itemTags(i)))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const pathList = getCategoryPathList(catId);
  const cat = catId ? categoryById(catId) : null;

  const byTypeText = [];
  if (group === 'all' || group === 'anim') byTypeText.push(`动画 ${data.stats.byType.anim}`);
  if (group === 'all' || group === 'image') byTypeText.push(`图片 ${data.stats.byType.image}`);
  if (group === 'all' || group === 'audio') byTypeText.push(`音频 ${data.stats.byType.audio}`);
  if (group === 'all' || group === '3d') byTypeText.push(`3D ${data.stats.byType['3d'] || 0}`);

  // 记录滚动位置,渲染后恢复(编辑模式下点击条目重渲染时滚动条保持原位)
  const prevBody = container.querySelector('.folder-body');
  const savedScroll = prevBody ? prevBody.scrollTop : 0;

  container.innerHTML = `
    <div class="folder-head">
      <div class="folder-title">
        <span class="ft-icon">${searchMode ? '🔍' : catId ? '📂' : '🗂'}</span>
        <span>${searchMode ? '搜索结果' : escapeHtml(cat ? cat.name : catId === '' ? '未分类' : '全部资源')}</span>
      </div>
      <div class="folder-stats" id="folder-stats">
        ${searchMode ? `匹配「${escapeHtml(searchText)}」· ` : ''}共 ${sorted.length} 项 · ${byTypeText.join(' · ')} · 占用 ${formatSize(data.stats.totalSize)}
      </div>
    </div>

    <div class="folder-toolbar">
      <div class="view-mode-seg" id="view-mode-seg">
        <button class="view-btn ${viewMode === 'detail' ? 'active' : ''}" data-view="detail" title="详情">📋 详情</button>
        <button class="view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="列表">☰ 列表</button>
        <button class="view-btn ${viewMode === 'icon' ? 'active' : ''}" data-view="icon" title="图标(缩略图)">🖼 图标</button>
      </div>
      <div class="sort-box">
        <label class="ctrl-label">排序</label>
        <select id="sort-by">
          <option value="name" ${sortBy === 'name' ? 'selected' : ''}>名称</option>
          <option value="type" ${sortBy === 'type' ? 'selected' : ''}>类型</option>
          <option value="size" ${sortBy === 'size' ? 'selected' : ''}>大小</option>
          <option value="date" ${sortBy === 'date' ? 'selected' : ''}>修改日期</option>
        </select>
        <button class="btn sm" id="sort-dir" title="切换升/降序">${sortDir === 'asc' ? '↑ 升序' : '↓ 降序'}</button>
      </div>
      ${folderTags.length ? `
      <div class="tag-filter-box" title="按标签过滤当前目录资源">
        <label class="ctrl-label">标签</label>
        <select id="tag-filter">
          <option value="">全部</option>
          ${folderTags.map((t) => `<option value="${escapeHtml(t)}" ${tagFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
      </div>
      ` : ''}
      <div class="folder-search-box">
        <input class="folder-search" id="folder-search" type="text" placeholder="搜索名称 / 属性 / 标签…" value="${escapeHtml(searchText)}" autocomplete="off" />
        <button class="folder-search-clear" id="folder-search-clear" type="button" title="清空搜索" ${searchText ? '' : 'hidden'}>×</button>
        <div class="search-history" id="folder-search-history" hidden></div>
      </div>
      <button class="btn sm ${editMode ? 'active' : ''}" id="edit-mode-btn" title="进入/退出编辑模式">✎ 编辑</button>
      ${editMode ? `
        <button class="btn sm" data-edit-act="select-all" title="全选">☑ 全选</button>
        <button class="btn sm" data-edit-act="select-none" title="取消全选">☐ 取消</button>
        <button class="btn sm" data-edit-act="invert" title="反选">⇄ 反选</button>
        <button class="btn sm danger" data-edit-act="batch-delete" title="删除选中的资源">🗑 删除</button>
        <button class="btn sm" data-edit-act="batch-move" title="移动选中的资源到其它目录">📂 移动</button>
      ` : ''}
      <div class="spacer"></div>
      <span class="res-count" id="res-count">${editMode ? `已选 ${selectedIds.size} 项 / ` : ''}${filterActive ? `${sorted.length} / ` : ''}${data.direct.length} 项资源</span>
    </div>

    <div class="folder-body" id="folder-body">
      ${data.subcats.length ? `
        <div class="subcat-row" id="subcat-row">
          ${data.subcats
            .filter((sc) => catVisibleInGroup(sc, group))
            .map((sc) => {
              const cnt = sc.items ? 0 : countItemsInCat(sc.id, group);
              const tagNames = categoryTypeTagNames(sc);
              const tip = tagNames.length ? `资源类型: ${tagNames.join(' / ')}` : '';
              return `
              <div class="subcat-folder" data-cat="${sc.id}" title="${escapeHtml(tip)}">
                <span class="sf-icon">📂</span>
                <span>${escapeHtml(sc.name)}</span>
                <span class="sf-count">${cnt} 项</span>
              </div>
            `;
            }).join('')}
        </div>
      ` : ''}

      ${sorted.length === 0 ? `
        <div class="folder-empty">
          <div>${filterActive ? '没有匹配的资源(试试调整标签过滤或搜索词)' : `该目录下暂无${group === 'all' ? '' : VIEW_LABEL_TXT[group] || ''}资源`}</div>
          ${filterActive ? '<button class="btn sm" id="clear-filter">清除过滤</button>' : '<button class="btn primary" id="empty-add">+ 添加资源</button>'}
        </div>
      ` : renderResources(sorted, viewMode, editMode, selectedIds)}
    </div>
  `;

  // 事件绑定
  container.onclick = (e) => {
    // 视图切换
    const vb = e.target.closest('[data-view]');
    if (vb) {
      actions.onViewMode && actions.onViewMode(vb.dataset.view);
      return;
    }
    // 子目录
    const sub = e.target.closest('[data-cat]');
    if (sub) {
      actions.onOpenCat && actions.onOpenCat(sub.dataset.cat);
      return;
    }
    // 排序方向切换按钮
    if (e.target.id === 'sort-dir') {
      actions.onSort && actions.onSort(sortBy, sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    // 空态添加
    if (e.target.id === 'empty-add') {
      actions.onAdd && actions.onAdd();
      return;
    }
    // 编辑模式:全选/反选/删除/移动等(由 onEditModeAction 处理)
    if (e.target.closest('[data-edit-act]')) {
      actions.onEditModeAction && actions.onEditModeAction(e.target.closest('[data-edit-act]').dataset.editAct);
      return;
    }
    // 操作按钮(先于条目判断:按钮同时带 data-op + data-item,须优先匹配)
    const op = e.target.closest('[data-op]');
    if (op) {
      actions.onItemOp && actions.onItemOp(op.dataset.op, op.dataset.item, op);
      return;
    }
    // 资源条目
    const res = e.target.closest('[data-item]');
    if (res) {
      // Shift+点击:优先于编辑模式判断(编辑/非编辑模式均走范围选择)
      if (e.shiftKey) {
        actions.onEditShiftSelect && actions.onEditShiftSelect(res.dataset.item);
        return;
      }
      // 编辑模式下:点击条目 = 选中/取消(不进入预览)
      if (editMode) {
        actions.onEditToggleItem && actions.onEditToggleItem(res.dataset.item);
        return;
      }
      // 非编辑模式:Ctrl + 点击 → 进入编辑选择模式
      if (e.ctrlKey || e.metaKey) {
        actions.onEditCtrlSelect && actions.onEditCtrlSelect(res.dataset.item);
        return;
      }
      actions.onOpenItem && actions.onOpenItem(res.dataset.item);
      return;
    }
  };

  // 排序方式:必须用 change 事件(click 会在展开下拉前触发,导致重渲染销毁下拉)
  const sortSel = container.querySelector('#sort-by');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      actions.onSort && actions.onSort(sortSel.value, sortDir);
    });
  }

  // 标签过滤:change 事件(与排序同理)
  const tagSel = container.querySelector('#tag-filter');
  if (tagSel) {
    tagSel.addEventListener('change', () => {
      actions.onTagFilter && actions.onTagFilter(tagSel.value);
    });
  }

  // 目录内搜索(名称 / 属性 / 标签):input 实时过滤,由外层恢复焦点
  const fSearch = container.querySelector('#folder-search');
  if (fSearch) {
    fSearch.addEventListener('input', () => {
      actions.onSearch && actions.onSearch(fSearch.value);
    });
    fSearch.addEventListener('keydown', (e) => e.stopPropagation());
  }
  // 搜索框一键清空
  const fClear = container.querySelector('#folder-search-clear');
  if (fClear) {
    fClear.addEventListener('click', () => {
      fSearch.value = '';
      actions.onSearch && actions.onSearch('');
      if (fSearch) fSearch.focus();
    });
  }

  // ---- 目录内搜索历史下拉(与顶栏搜索框一致的体验) ----
  const fHistoryEl = container.querySelector('#folder-search-history');
  const hideFolderHistory = () => { if (fHistoryEl) fHistoryEl.hidden = true; };
  const renderFolderHistory = () => {
    if (!fHistoryEl) return;
    const hist = loadSearchHistory('folder');
    fHistoryEl.innerHTML = '';
    if (!hist.length) { hideFolderHistory(); return; }
    const head = document.createElement('div');
    head.className = 'sh-head';
    const title = document.createElement('span');
    title.textContent = '最近搜索';
    head.appendChild(title);
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'sh-clear-all';
    clearAll.title = '清空全部搜索记录';
    clearAll.textContent = '🗑 清空';
    clearAll.addEventListener('mousedown', (e) => {
      e.preventDefault(); // 抢先于 input blur, 保持下拉可见
      saveSearchHistory([], 'folder');
      renderFolderHistory();
    });
    head.appendChild(clearAll);
    fHistoryEl.appendChild(head);
    hist.forEach((w) => {
      const item = document.createElement('div');
      item.className = 'sh-item';
      const txt = document.createElement('span');
      txt.className = 'sh-text';
      txt.textContent = w;
      item.appendChild(txt);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sh-del';
      del.title = '删除该记录';
      del.textContent = '×';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 抢先于 input blur, 确保删除命中
        removeSearchHistory(w, 'folder');
        renderFolderHistory();
      });
      item.appendChild(del);
      item.addEventListener('mousedown', (e) => {
        if (e.target === del) return;
        e.preventDefault(); // 防止 input 先 blur 隐藏下拉
        actions.onSearch && actions.onSearch(w);
        hideFolderHistory();
      });
      fHistoryEl.appendChild(item);
    });
  };
  const showFolderHistory = () => {
    const hist = loadSearchHistory('folder');
    if (!hist.length) return;
    renderFolderHistory();
    fHistoryEl.hidden = false;
  };
  if (fSearch && fHistoryEl) {
    let folderHistTimer = null;
    // 空框聚焦 / 点击 → 弹出历史; 有内容时不因重渲染后的焦点恢复而反复弹出(避免打字时闪烁)
    fSearch.addEventListener('focus', () => { if (!fSearch.value) showFolderHistory(); });
    fSearch.addEventListener('click', showFolderHistory);
    fSearch.addEventListener('blur', () => { setTimeout(hideFolderHistory, 150); });
    fSearch.addEventListener('input', () => {
      hideFolderHistory();
      const q = fSearch.value.trim();
      clearTimeout(folderHistTimer);
      if (q) folderHistTimer = setTimeout(() => addSearchHistory(q, 'folder'), 600);
    });
    fSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(folderHistTimer); const q = fSearch.value.trim(); if (q) addSearchHistory(q, 'folder'); }
    });
  }

  // 空态「清除过滤」
  const clearBtn = container.querySelector('#clear-filter');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      actions.onClearFilter && actions.onClearFilter();
    });
  }

  // 编辑模式开关(按钮在 folder-toolbar 中)
  const editBtn = container.querySelector('#edit-mode-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      actions.onToggleEditMode && actions.onToggleEditMode();
    });
  }

  container.oncontextmenu = (e) => {
    const res = e.target.closest('[data-item]');
    if (res) {
      e.preventDefault();
      const it = findItemById(res.dataset.item);
      actions.onItemMenu && actions.onItemMenu(it, e);
      return;
    }
    const sub = e.target.closest('[data-cat]');
    if (sub) {
      e.preventDefault();
      const sc = categoryById(sub.dataset.cat);
      actions.onCatMenu && actions.onCatMenu(sc, e);
    }
  };

  // 图标视图缩略图(动画异步生成 dataURL;图片直连 URL)
  if (viewMode === 'icon') {
    for (const it of sorted) {
      const imgEl = container.querySelector(`.res-thumb[data-item="${it.id}"]`);
      if (!imgEl) continue;
      if (it.type === 'audio' || it.type === 'model') continue; // 音频/3D 用默认图标
      if (it.type === 'image') {
        const url = thumbnailService.thumbnailUrl(it);
        if (url) { imgEl.src = url; imgEl.onerror = () => { imgEl.style.display = 'none'; }; }
      } else {
        thumbnailService.getAnimThumb(it).then((url) => {
          if (url) { imgEl.src = url; imgEl.onerror = () => { imgEl.style.display = 'none'; }; }
          else imgEl.style.display = 'none';
        });
      }
    }
  }
  // 图集标识:图片带同名 .atlas/.plist → 「图片」徽章细化为「图集」
  bindAtlasBadges(container, sorted);

  // 恢复滚动位置(编辑模式下点击条目重渲染时滚动条保持原位;新内容高度不足时浏览器自动钳制)
  const newBody = container.querySelector('.folder-body');
  if (newBody && savedScroll) newBody.scrollTop = savedScroll;

  function findItemById(id) {
    return data.direct.find((i) => i.id === id) || null;
  }

  function countItemsInCat(catId, group) {
    // 通过 getFolderData 的 subcats 统计:需要子分类直接资源数
    return getFolderData(catId, group).stats.total;
  }
}

/** 渲染标签 chip(最多 max 个,超出显示 +N);空数组返回空串 */
function tagChipsHtml(arr, max = 3) {
  const list = (arr || []).slice(0, max);
  const more = (arr || []).length - list.length;
  let html = list.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
  if (more > 0) html += `<span class="tag-chip tag-chip-more">+${more}</span>`;
  return html;
}

/** 资源悬停提示(多行):名称/类型/目录/标签/备注/文件 */
function itemTooltip(it) {
  const tags = itemTags(it);
  const typeName = it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type] || it.type;
  const lines = [
    `名称: ${it.displayName || ''}`,
    `类型: ${typeName}`,
    `目录: ${categoryLabel(it)}`,
  ];
  if (tags.length) lines.push(`标签: ${tags.join('、')}`);
  if (it.remark) lines.push(`备注: ${it.remark}`);
  lines.push(`文件: ${it.filePath || ''}`);
  return lines.join('\n');
}

/** 渲染资源列表主体(详情/列表/图标);编辑模式下显示选中态 */
function renderResources(items, viewMode, editMode = false, selectedIds = new Set()) {
  const isSel = (id) => (editMode && selectedIds.has(id) ? ' selected' : '');

  if (viewMode === 'detail') {
    return `
      <table class="res-table">
        <thead><tr>
          ${editMode ? '<th></th>' : ''}
          <th data-sort="name">名称 <span class="sort-arrow"></span></th>
          <th data-sort="type">类型</th>
          <th data-sort="size">大小</th>
          <th data-sort="date">修改日期</th>
          <th>标签</th>
          <th>备注</th>
          <th>操作</th>
        </tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr data-item="${it.id}" class="${isSel(it.id).trim()}" title="${escapeHtml(itemTooltip(it))}">
              ${editMode ? `<td><span class="edit-check">${selectedIds.has(it.id) ? '☑' : '☐'}</span></td>` : ''}
              <td><div class="cell-name"><span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span><span class="cn-main">${escapeHtml(itemFileName(it))}</span></div></td>
              <td>${escapeHtml(it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type])}</td>
              <td class="cell-size">${formatSize(it.size)}</td>
              <td class="cell-date">${formatDate(it.mtime || it.updatedAt)}</td>
              <td class="cell-tags">${tagChipsHtml(itemTags(it))}</td>
              <td class="cell-remark">${escapeHtml(it.remark || '')}</td>
              <td class="cell-ops">
                ${editMode ? '' : `
                <button class="icon-btn" data-op="preview" data-item="${it.id}" title="预览/播放">▶</button>
                <button class="icon-btn" data-op="fav" data-item="${it.id}" title="收藏">★</button>
                <button class="icon-btn" data-op="edit" data-item="${it.id}" title="编辑">✎</button>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  if (viewMode === 'list') {
    return `
      <div class="res-view-list">
        ${items.map((it) => `
          <div class="res-row${isSel(it.id)}" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
            ${editMode ? `<span class="edit-check">${selectedIds.has(it.id) ? '☑' : '☐'}</span>` : `<span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>`}
            <span class="r-name">${escapeHtml(itemFileName(it))}</span>
            <span class="r-tags">${tagChipsHtml(itemTags(it), 2)}</span>
            <span class="r-size">${formatSize(it.size)}</span>
            <span class="r-date">${formatDate(it.mtime || it.updatedAt)}</span>
            <span class="r-ops">
              ${editMode ? '' : `
              <button class="icon-btn" data-op="preview" data-item="${it.id}" title="预览/播放">▶</button>
              <button class="icon-btn" data-op="fav" data-item="${it.id}" title="收藏">★</button>
              <button class="icon-btn" data-op="edit" data-item="${it.id}" title="编辑">✎</button>`}
            </span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 图标视图
  return `
    <div class="res-grid">
      ${items.map((it) => {
        const tags = itemTags(it);
        return `
        <div class="res-card${isSel(it.id)}" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
          <div class="res-thumb-box">
            ${it.type === 'audio'
              ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:40px;color:#b28df0">♪</div>`
              : it.type === 'model'
                ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:36px;color:#4cc9f0">🧊</div>`
                : `<img class="res-thumb" data-item="${it.id}" alt="" />`}
          </div>
          <div class="rc-name" title="${escapeHtml(itemFileName(it))}">${nameExtHtml(it)}</div>
          ${tags.length ? `
          <div class="rc-tags" title="标签:${escapeHtml(tags.join('、'))}">
            <span class="tag-chip">${escapeHtml(tags[0])}</span>
            ${tags.length > 1 ? `<span class="tag-chip tag-chip-more">+${tags.length - 1}</span>` : ''}
          </div>` : ''}
          <div class="rc-meta">
            ${editMode ? `<span class="edit-check">${selectedIds.has(it.id) ? '☑ 已选' : '☐ 选中'}</span>`
              : `<span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
                 <span class="rc-size">${formatSize(it.size)}</span>`}
          </div>
        </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * 收藏夹目录列表页:某收藏分类下的收藏条目(统计 + 视图切换 + 排序 + 三视图)。
 * @param {HTMLElement} container #page-folder
 * @param {object} opts
 *   - favCategoryId 收藏分类 id
 *   - viewMode / sortBy / sortDir
 *   - actions: { onOpenItem(itemId), onItemMenu(item, e), onViewMode(mode), onSort(by, dir),
 *                onUnfav(favId, itemId), onMoveFav(favId, itemId), onEditFavCat(fcId), onDeleteFavCat(fcId) }
 */
export function renderFavFolderPage(container, opts) {
  const { favCategoryId, viewMode = 'list', sortBy = 'name', sortDir = 'asc', actions = {} } = opts;
  const fc = favCategoryById(favCategoryId);
  if (!fc) {
    container.innerHTML = '<div class="folder-empty"><div>收藏分类不存在或已删除</div></div>';
    return;
  }
  // 收藏项 → 资源条目(丢失资源的收藏项忽略)
  const favs = state.favItems.filter((f) => f.favCategoryId === favCategoryId);
  const items = favs
    .map((f) => ({ ...itemById(f.itemId), _favId: f.id }))
    .filter((it) => it && it._favId);
  const sorted = sortItems(items, sortBy, sortDir);

  const prevBody = container.querySelector('.folder-body');
  const savedScroll = prevBody ? prevBody.scrollTop : 0;

  container.innerHTML = `
    <div class="folder-head">
      <div class="folder-title">
        <span class="ft-icon">📁</span>
        <span>${escapeHtml(fc.name)}</span>
      </div>
      <div class="folder-stats" id="folder-stats">
        共 ${items.length} 个收藏
      </div>
    </div>

    <div class="folder-toolbar">
      <div class="view-mode-seg" id="view-mode-seg">
        <button class="view-btn ${viewMode === 'detail' ? 'active' : ''}" data-view="detail" title="详情">📋 详情</button>
        <button class="view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="列表">☰ 列表</button>
        <button class="view-btn ${viewMode === 'icon' ? 'active' : ''}" data-view="icon" title="图标(缩略图)">🖼 图标</button>
      </div>
      <div class="sort-box">
        <label class="ctrl-label">排序</label>
        <select id="sort-by">
          <option value="name" ${sortBy === 'name' ? 'selected' : ''}>名称</option>
          <option value="type" ${sortBy === 'type' ? 'selected' : ''}>类型</option>
          <option value="size" ${sortBy === 'size' ? 'selected' : ''}>大小</option>
          <option value="date" ${sortBy === 'date' ? 'selected' : ''}>修改日期</option>
        </select>
        <button class="btn sm" id="sort-dir" title="切换升/降序">${sortDir === 'asc' ? '↑ 升序' : '↓ 降序'}</button>
      </div>
      <div class="spacer"></div>
      <span class="res-count" id="res-count">${items.length} 个收藏</span>
    </div>

    <div class="folder-body" id="folder-body">
      ${sorted.length === 0 ? `
        <div class="folder-empty">
          <div>该收藏分类下暂无收藏</div>
        </div>
      ` : renderFavResources(sorted, viewMode)}
    </div>
  `;

  container.onclick = (e) => {
    const vb = e.target.closest('[data-view]');
    if (vb) { actions.onViewMode && actions.onViewMode(vb.dataset.view); return; }
    if (e.target.id === 'sort-dir') { actions.onSort && actions.onSort(sortBy, sortDir === 'asc' ? 'desc' : 'asc'); return; }
    const op = e.target.closest('[data-op]');
    if (op) {
      if (op.dataset.op === 'unfav') actions.onUnfav && actions.onUnfav(op.dataset.fav, op.dataset.item);
      else if (op.dataset.op === 'move') actions.onMoveFav && actions.onMoveFav(op.dataset.fav, op.dataset.item);
      return;
    }
    const res = e.target.closest('[data-item]');
    if (res) { actions.onOpenItem && actions.onOpenItem(res.dataset.item); return; }
  };
  container.oncontextmenu = (e) => {
    const res = e.target.closest('[data-item]');
    if (res) {
      e.preventDefault();
      const it = items.find((i) => i.id === res.dataset.item);
      if (it) actions.onItemMenu && actions.onItemMenu(it, e);
    }
  };

  const sortSel = container.querySelector('#sort-by');
  if (sortSel) sortSel.addEventListener('change', () => actions.onSort && actions.onSort(sortSel.value, sortDir));

  // 图标视图缩略图
  if (viewMode === 'icon') {
    for (const it of sorted) {
      const imgEl = container.querySelector(`.res-thumb[data-item="${it.id}"]`);
      if (!imgEl) continue;
      if (it.type === 'audio' || it.type === 'model') continue;
      if (it.type === 'image') {
        const url = thumbnailService.thumbnailUrl(it);
        if (url) { imgEl.src = url; imgEl.onerror = () => { imgEl.style.display = 'none'; }; }
      } else {
        thumbnailService.getAnimThumb(it).then((url) => {
          if (url) { imgEl.src = url; imgEl.onerror = () => { imgEl.style.display = 'none'; }; }
          else imgEl.style.display = 'none';
        });
      }
    }
  }

  // 图集标识:收藏夹列表同样细化「图片」→「图集」
  bindAtlasBadges(container, items);

  const newBody = container.querySelector('.folder-body');
  if (newBody && savedScroll) newBody.scrollTop = savedScroll;
}

/** 收藏夹目录列表资源主体(详情/列表/图标);操作 = 移动收藏分类 / 取消收藏 */
function renderFavResources(items, viewMode) {
  const rowOps = (it) => `
    <button class="icon-btn" data-op="move" data-fav="${it._favId}" data-item="${it.id}" title="移动到其他收藏分类">⇄</button>
    <button class="icon-btn danger" data-op="unfav" data-fav="${it._favId}" data-item="${it.id}" title="取消收藏">★</button>`;

  if (viewMode === 'detail') {
    return `
      <table class="res-table">
        <thead><tr>
          <th data-sort="name">名称</th>
          <th data-sort="type">类型</th>
          <th data-sort="size">大小</th>
          <th data-sort="date">修改日期</th>
          <th>标签</th>
          <th>备注</th>
          <th>操作</th>
        </tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
              <td><div class="cell-name"><span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span><span class="cn-main">${escapeHtml(itemFileName(it))}</span></div></td>
              <td>${escapeHtml(it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type])}</td>
              <td class="cell-size">${formatSize(it.size)}</td>
              <td class="cell-date">${formatDate(it.mtime || it.updatedAt)}</td>
              <td class="cell-tags">${tagChipsHtml(itemTags(it))}</td>
              <td class="cell-remark">${escapeHtml(it.remark || '')}</td>
              <td class="cell-ops">${rowOps(it)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  if (viewMode === 'list') {
    return `
      <div class="res-view-list">
        ${items.map((it) => `
          <div class="res-row" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
            <span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
            <span class="r-name">${escapeHtml(itemFileName(it))}</span>
            <span class="r-tags">${tagChipsHtml(itemTags(it), 2)}</span>
            <span class="r-size">${formatSize(it.size)}</span>
            <span class="r-date">${formatDate(it.mtime || it.updatedAt)}</span>
            <span class="r-ops">${rowOps(it)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  return `
    <div class="res-grid">
      ${items.map((it) => {
        const tags = itemTags(it);
        return `
        <div class="res-card" data-item="${it.id}" title="${escapeHtml(itemTooltip(it))}">
          <div class="res-thumb-box">
            ${it.type === 'audio'
              ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:40px;color:#b28df0">♪</div>`
              : it.type === 'model'
                ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:36px;color:#4cc9f0">🧊</div>`
                : `<img class="res-thumb" data-item="${it.id}" alt="" />`}
          </div>
          <div class="rc-name" title="${escapeHtml(itemFileName(it))}">${nameExtHtml(it)}</div>
          ${tags.length ? `
          <div class="rc-tags" title="标签:${escapeHtml(tags.join('、'))}">
            <span class="tag-chip">${escapeHtml(tags[0])}</span>
            ${tags.length > 1 ? `<span class="tag-chip tag-chip-more">+${tags.length - 1}</span>` : ''}
          </div>` : ''}
          <div class="rc-meta">
            <span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
            <span class="rc-size">${formatSize(it.size)}</span>
          </div>
        </div>
        `;
      }).join('')}
    </div>
  `;
}
