import { getFolderData, sortItems, formatSize, formatDate, TYPE_LABEL, typeGroup, categoryById, getCategoryPathList } from '../state.js';
import { thumbnailService } from '../thumbnails.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const data = getFolderData(catId, group);
  const sorted = sortItems(data.direct, sortBy, sortDir);
  const pathList = getCategoryPathList(catId);
  const cat = catId ? categoryById(catId) : null;

  const byTypeText = [];
  if (group === 'all' || group === 'anim') byTypeText.push(`动画 ${data.stats.byType.anim}`);
  if (group === 'all' || group === 'image') byTypeText.push(`图片 ${data.stats.byType.image}`);
  if (group === 'all' || group === 'audio') byTypeText.push(`音频 ${data.stats.byType.audio}`);
  if (group === 'all' || group === '3d') byTypeText.push(`3D ${data.stats.byType['3d'] || 0}`);

  container.innerHTML = `
    <div class="folder-head">
      <div class="folder-title">
        <span class="ft-icon">${catId ? '📂' : '🗂'}</span>
        <span>${escapeHtml(cat ? cat.name : catId === '' ? '未分类' : '全部资源')}</span>
      </div>
      <div class="folder-stats" id="folder-stats">
        共 ${data.stats.total} 项 · ${byTypeText.join(' · ')} · 占用 ${formatSize(data.stats.totalSize)}
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
      <button class="btn sm ${editMode ? 'active' : ''}" id="edit-mode-btn" title="进入/退出编辑模式">✎ 编辑</button>
      ${editMode ? `
        <button class="btn sm" data-edit-act="select-all" title="全选">☑ 全选</button>
        <button class="btn sm" data-edit-act="select-none" title="取消全选">☐ 取消</button>
        <button class="btn sm" data-edit-act="invert" title="反选">⇄ 反选</button>
        <button class="btn sm danger" data-edit-act="batch-delete" title="删除选中的资源">🗑 删除</button>
        <button class="btn sm" data-edit-act="batch-move" title="移动选中的资源到其它分类">📂 移动</button>
      ` : ''}
      <div class="spacer"></div>
      <span class="res-count" id="res-count">${editMode ? `已选 ${selectedIds.size} 项 / ` : ''}${data.direct.length} 项资源</span>
    </div>

    <div class="folder-body" id="folder-body">
      ${data.subcats.length ? `
        <div class="subcat-row" id="subcat-row">
          ${data.subcats.map((sc) => {
            const cnt = sc.items ? 0 : countItemsInCat(sc.id, group);
            return `
              <div class="subcat-folder" data-cat="${sc.id}" title="${escapeHtml(sc.remark || '')}">
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
          <div>该目录下暂无${group === 'all' ? '' : VIEW_LABEL_TXT[group] || ''}资源</div>
          <button class="btn primary" id="empty-add">+ 添加资源</button>
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
    // 资源条目
    const res = e.target.closest('[data-item]');
    if (res) {
      // 编辑模式下:点击条目 = 选中/取消(不进入预览)
      if (editMode) {
        actions.onEditToggleItem && actions.onEditToggleItem(res.dataset.item);
        return;
      }
      actions.onOpenItem && actions.onOpenItem(res.dataset.item);
      return;
    }
    // 操作按钮
    const op = e.target.closest('[data-op]');
    if (op) {
      actions.onItemOp && actions.onItemOp(op.dataset.op, op.dataset.item, op);
    }
  };

  // 排序方式:必须用 change 事件(click 会在展开下拉前触发,导致重渲染销毁下拉)
  const sortSel = container.querySelector('#sort-by');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      actions.onSort && actions.onSort(sortSel.value, sortDir);
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

  function findItemById(id) {
    return data.direct.find((i) => i.id === id) || null;
  }

  function countItemsInCat(catId, group) {
    // 通过 getFolderData 的 subcats 统计:需要子分类直接资源数
    return getFolderData(catId, group).stats.total;
  }
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
          <th>备注</th>
          <th>操作</th>
        </tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr data-item="${it.id}" class="${isSel(it.id).trim()}" title="${escapeHtml(it.remark || '')}">
              ${editMode ? `<td><span class="edit-check">${selectedIds.has(it.id) ? '☑' : '☐'}</span></td>` : ''}
              <td><div class="cell-name"><span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span><span class="cn-main">${escapeHtml(it.displayName || '')}</span></div></td>
              <td>${escapeHtml(it.type === 'spine' ? 'Spine' : it.type === 'dragonbones' ? 'DragonBones' : TYPE_LABEL[it.type])}</td>
              <td class="cell-size">${formatSize(it.size)}</td>
              <td class="cell-date">${formatDate(it.mtime || it.updatedAt)}</td>
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
          <div class="res-row${isSel(it.id)}" data-item="${it.id}" title="${escapeHtml(it.remark || '')}">
            ${editMode ? `<span class="edit-check">${selectedIds.has(it.id) ? '☑' : '☐'}</span>` : `<span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>`}
            <span class="r-name">${escapeHtml(it.displayName || '')}</span>
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
      ${items.map((it) => `
        <div class="res-card${isSel(it.id)}" data-item="${it.id}" title="${escapeHtml(it.displayName || '')}">
          <div class="res-thumb-box">
            ${it.type === 'audio'
              ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:40px;color:#b28df0">♪</div>`
              : it.type === 'model'
                ? `<div class="res-thumb audio-fallback" data-item="${it.id}" style="font-size:36px;color:#4cc9f0">🧊</div>`
                : `<img class="res-thumb" data-item="${it.id}" alt="" />`}
          </div>
          <div class="rc-name" title="${escapeHtml(it.displayName || '')}">${escapeHtml(it.displayName || '')}</div>
          <div class="rc-meta">
            ${editMode ? `<span class="edit-check">${selectedIds.has(it.id) ? '☑ 已选' : '☐ 选中'}</span>`
              : `<span class="type-badge ${it.type}">${TYPE_LABEL[it.type] || it.type}</span>
                 <span class="rc-size">${formatSize(it.size)}</span>`}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
