// ============ 添加资源流程(单个 / 批量) ============

import { openModal, footButtons, toast, promptDialog } from './dialogs.js';
import { state, addItem, addCategory, TYPE_LABEL } from './state.js';

function typeLabel(type) {
  return TYPE_LABEL[type] || type;
}

/** 路径规范化(Windows 大小写不敏感 + 统一分隔符) */
function normPath(p) {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * 判断某个扫描到的资源是否已经在"目标分类"下存在(去重判定)。
 * 同一文件重复添加到同一分类 → 视为重复,跳过。
 */
function isDuplicateInCategory(filePath, categoryId) {
  const fp = normPath(filePath);
  const catId = categoryId || '';
  return state.items.some(
    (it) => (it.categoryId || '') === catId && normPath(it.filePath) === fp
  );
}

/**
 * 选择目录 → 扫描 → 勾选 → 添加
 * @param {boolean} batch 是否批量(多选目录)
 * @param {string} defaultCategoryId 默认加入的分类
 */
export async function runAddFlow(batch, defaultCategoryId) {
  const { canceled, filePaths } = await window.api.pickDirs();
  if (canceled || !filePaths.length) return;

  let dirs = filePaths;
  if (!batch && dirs.length > 1) dirs = [dirs[0]];

  const flow = { recursive: false, entries: [], dirs, checked: new Set() };
  const all = [];
  for (const d of dirs) {
    const r = await window.api.scanDir(d, false);
    all.push(...r);
  }
  flow.entries = all;

  // ---------- 构建弹窗 ----------
  const body = document.createElement('div');
  body.className = 'modal-body';

  const optRow = document.createElement('div');
  optRow.className = 'form-row';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.id = 'scan-recursive';
  const chkLabel = document.createElement('label');
  chkLabel.className = 'chk';
  chkLabel.style.marginLeft = '0';
  chkLabel.appendChild(chk);
  chkLabel.appendChild(document.createTextNode('递归扫描子目录(批量添加常用)'));
  optRow.appendChild(chkLabel);
  body.appendChild(optRow);

  const catRow = document.createElement('div');
  catRow.className = 'form-row';
  const catLabel = document.createElement('label');
  catLabel.className = 'f-label';
  catLabel.textContent = '加入分类';
  const catSelect = document.createElement('select');
  // 需求:添加动画必须先选择分类目录(或新建)。默认选中当前浏览的分类;否则占位提示。
  const hasDefaultCat = !!defaultCategoryId && state.categories.some((c) => c.id === defaultCategoryId);
  if (!hasDefaultCat) {
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '—— 请选择分类目录 ——';
    catSelect.appendChild(ph);
  }
  for (const c of state.categories) {
    const op = document.createElement('option');
    op.value = c.id;
    op.textContent = c.name;
    catSelect.appendChild(op);
  }
  const newCatOpt = document.createElement('option');
  newCatOpt.value = '__new__';
  newCatOpt.textContent = '➕ 新建分类…';
  catSelect.appendChild(newCatOpt);
  catSelect.value = hasDefaultCat ? defaultCategoryId : '';
  catRow.appendChild(catLabel);
  catRow.appendChild(catSelect);
  body.appendChild(catRow);

  // 程序内部设置分类时抑制 change 重复刷新
  let applyingCat = false;
  let lastCatId = catSelect.value;
  const setCatValue = (v) => {
    applyingCat = true;
    catSelect.value = v;
    applyingCat = false;
    lastCatId = v;
    refreshChecks();
  };

  /** 把新建的分类插入下拉框(排在「新建分类…」之前)并选中 */
  const insertCatOption = (cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    catSelect.insertBefore(opt, newCatOpt);
  };

  const resultWrap = document.createElement('div');
  body.appendChild(resultWrap);

  const summary = document.createElement('div');
  summary.className = 'scan-summary';
  body.appendChild(summary);

  function renderList() {
    resultWrap.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'scan-result';
    for (const d of dirs) {
      const group = document.createElement('div');
      group.className = 'scan-group';
      const dirEl = document.createElement('div');
      dirEl.className = 'sg-dir';
      dirEl.textContent = d;
      group.appendChild(dirEl);
      const entries = flow.entries.filter((e) => e.dir === d);
      if (!entries.length) {
        const none = document.createElement('div');
        none.className = 'hint';
        none.textContent = '(未发现 Spine / DragonBones / 图片 / 音频资源)';
        group.appendChild(none);
      }
      for (const e of entries) {
        const dup = isDuplicateInCategory(e.file, catSelect.value);
        const row = document.createElement('div');
        row.className = 'scan-item' + (dup ? ' dup' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const key = e.file;
        // 重复项默认不勾选,且勾选也会在添加时被跳过
        cb.checked = !dup && flow.checked.has(key);
        cb.addEventListener('change', () => {
          if (cb.checked) flow.checked.add(key);
          else flow.checked.delete(key);
          updateSummary();
        });
        row.appendChild(cb);
        const badge = document.createElement('span');
        badge.className = 'type-badge ' + e.type;
        badge.textContent = typeLabel(e.type);
        row.appendChild(badge);
        const name = document.createElement('span');
        name.className = 'si-name';
        name.textContent = e.base;
        name.title = e.file;
        row.appendChild(name);
        if (dup) {
          const db = document.createElement('span');
          db.className = 'si-dup';
          db.textContent = '已存在,跳过';
          db.title = '该文件已在此分类中';
          row.appendChild(db);
        }
        if (e.problems && e.problems.length) {
          const pb = document.createElement('span');
          pb.className = 'si-problem';
          pb.textContent = e.problems.join('; ');
          row.appendChild(pb);
        }
        group.appendChild(row);
      }
      list.appendChild(group);
    }
    resultWrap.appendChild(list);
    updateSummary();
  }

  function updateSummary() {
    const dupCount = flow.entries.filter(
      (e) => flow.checked.has(e.file) && isDuplicateInCategory(e.file, catSelect.value)
    ).length;
    const addable = flow.checked.size - dupCount;
    summary.textContent = `已勾选 ${flow.checked.size} 个资源(可添加 ${addable} 个,重复跳过 ${dupCount} 个)`;
  }

  /** 按当前选中分类重新计算勾选并重渲染(未选分类时不预勾选) */
  function refreshChecks() {
    flow.checked.clear();
    const catId = catSelect.value;
    if (catId && catId !== '__new__') {
      for (const e of flow.entries) {
        if (e.problems && e.problems.length) continue;
        if (isDuplicateInCategory(e.file, catId)) continue;
        flow.checked.add(e.file);
      }
    }
    renderList();
  }

  // 勾选默认:无问题项;已存在于目标分类的项不勾选(避免重复添加)
  // 未选择分类时(占位)不预勾选,等待用户先选分类
  if (catSelect.value && catSelect.value !== '__new__') {
    for (const e of flow.entries) {
      if (e.problems && e.problems.length) continue;
      if (isDuplicateInCategory(e.file, catSelect.value)) continue;
      flow.checked.add(e.file);
    }
  }

  const { close } = openModal({
    title: batch ? '批量添加资源' : '添加资源',
    body,
    wide: true,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '添加所选',
        cls: 'primary',
        onClick: (btn) => {
          // 需求:必须已选择分类目录(或新建分类)才能添加
          const catId = catSelect.value;
          if (!catId || catId === '__new__') {
            toast('请先选择分类目录,或点击「➕ 新建分类…」新建分类', 'error');
            return;
          }
          const items = flow.entries.filter((e) => flow.checked.has(e.file));
          if (!items.length) {
            toast('请勾选要添加的资源', 'error');
            return;
          }
          btn.disabled = true;
          let added = 0;
          let skipped = 0;
          for (const e of items) {
            // 再次校验:目标分类下已存在 → 跳过,不重复添加
            if (isDuplicateInCategory(e.file, catId)) {
              skipped++;
              continue;
            }
            addItem({
              categoryId: catId,
              type: e.type,
              filePath: e.file,
              atlasPath: e.atlasPath || null,
              displayName: e.base,
              remark: '',
              size: e.size ?? null,
              mtime: e.mtime ?? null,
            });
            added++;
          }
          close();
          const catName = catSelect.selectedOptions[0]?.textContent || '未分类';
          let msg = `已添加 ${added} 个资源到「${catName}」`;
          if (skipped > 0) msg += `,${skipped} 个重复已跳过`;
          if (added === 0 && skipped > 0) msg = `本次未添加新资源,${skipped} 个已在「${catName}」中,已跳过`;
          toast(msg);
          window.dispatchEvent(new CustomEvent('items-changed'));
        },
      },
    ]),
  });

  chk.addEventListener('change', async () => {
    flow.recursive = chk.checked;
    const all = [];
    for (const d of dirs) {
      const r = await window.api.scanDir(d, flow.recursive);
      all.push(...r);
    }
    flow.entries = all;
    refreshChecks();
  });

  // 切换目标分类:重复判定随分类变化,重新计算勾选并重渲染
  catSelect.addEventListener('change', () => {
    if (applyingCat) return;
    if (catSelect.value === '__new__') {
      // 选择「➕ 新建分类…」:弹出创建对话框,创建后自动选中新分类
      const prev = lastCatId;
      promptDialog({
        title: '新建分类',
        fields: [{ key: 'name', label: '分类名称', type: 'text', value: '' }],
        onOk: ({ name }) => {
          if (!name) { setCatValue(prev || ''); return; }
          const cat = addCategory({ name, remark: '' });
          insertCatOption(cat);
          setCatValue(cat.id);
          // 同步左侧资源树
          window.dispatchEvent(new CustomEvent('items-changed'));
        },
        onCancel: () => { setCatValue(prev || ''); },
      });
      return;
    }
    lastCatId = catSelect.value;
    refreshChecks();
  });

  renderList();
}
