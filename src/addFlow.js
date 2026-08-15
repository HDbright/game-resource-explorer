// ============ 添加资源流程(单个 / 批量) ============

import { openModal, footButtons, toast, promptDialog } from './dialogs.js';
import { state, addItem, addCategory, typeLabel, ensureCategoryTypeTag } from './state.js';

/** 路径规范化(Windows 大小写不敏感 + 统一分隔符) */
function normPath(p) {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

/** 判断 dir 是否位于 root 之下(含相等) */
function isWithin(dir, root) {
  const d = normPath(dir);
  const r = normPath(root).replace(/\/+$/, '');
  return d === r || d.startsWith(r + '/');
}

/** dir 相对 root 的路径段(不含文件);dir == root 时返回 [] */
function relSegments(dir, root) {
  const d = normPath(dir);
  const r = normPath(root).replace(/\/+$/, '');
  if (d === r) return [];
  const rel = d.slice(r.length + 1);
  return rel.split('/').filter(Boolean);
}

/** 递归扫描添加时: 按文件相对根目录的路径结构, 在目标分类下逐级建立目录(同名复用) */
function ensureCategoryChain(baseParentId, segs, typeTags) {
  let parentId = baseParentId;
  const created = [];
  for (const seg of segs) {
    const kids = state.categories.filter((c) => (c.parentId || '') === parentId);
    let c = kids.find((k) => k.name === seg);
    if (!c) {
      c = addCategory({ name: seg, typeTags, parentId });
      created.push(c.id);
    }
    parentId = c.id;
  }
  return { catId: parentId, created };
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
  newCatOpt.textContent = '➕ 新建目录…';
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
    const dupCount = flow.entries.filter((e) => isDuplicateInCategory(e.file, catSelect.value)).length;
    const addable = [...flow.checked].filter((f) => !isDuplicateInCategory(f, catSelect.value)).length;
    summary.textContent = `共 ${flow.entries.length} 个资源(已勾选 ${flow.checked.size} 个,可添加 ${addable} 个,已存在 ${dupCount} 个)`;
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
          // 需求:必须已选择分类目录(或新建目录)才能添加
          const catId = catSelect.value;
          if (!catId || catId === '__new__') {
            toast('请先选择分类目录,或点击「➕ 新建目录…」新建目录', 'error');
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
          let dirsCreated = 0;
          const createdCatIds = [];
          // 递归扫描时:按被添加文件相对选中根目录的路径结构,自动在目标分类下建立对应目录
          const usePathDirs = flow.recursive;
          const parentCat = state.categories.find((c) => c.id === catId);
          const inheritTags = parentCat ? (parentCat.typeTags || []) : [];
          for (const e of items) {
            // 计算该文件应归入的分类:递归扫描时按路径结构建目录链
            let targetCatId = catId;
            if (usePathDirs) {
              const root = flow.dirs.find((d) => isWithin(e.dir, d));
              if (root) {
                const segs = relSegments(e.dir, root);
                if (segs.length) {
                  const { catId: cid, created } = ensureCategoryChain(catId, segs, inheritTags);
                  targetCatId = cid;
                  dirsCreated += created.length;
                  createdCatIds.push(...created);
                }
              }
            }
            // 同步修正目标分类标签:即使已存在也要确保标签包含该资源分组,否则重复项可能不可见
            ensureCategoryTypeTag(targetCatId, e.type);
            // 再次校验:目标分类下已存在 → 跳过,不重复添加
            if (isDuplicateInCategory(e.file, targetCatId)) {
              skipped++;
              continue;
            }
            addItem({
              categoryId: targetCatId,
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
          if (dirsCreated > 0) msg += `,自动创建 ${dirsCreated} 个目录`;
          if (skipped > 0) msg += `,${skipped} 个重复已跳过`;
          if (added === 0 && skipped > 0) msg = `本次未添加新资源,${skipped} 个已在对应目录中,已跳过`;
          toast(msg);
          window.dispatchEvent(new CustomEvent('items-changed', {
            detail: createdCatIds.length ? { expand: createdCatIds } : undefined,
          }));
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
      // 选择「➕ 新建目录…」:弹出创建对话框,创建后自动选中新目录
      const prev = lastCatId;
      promptDialog({
        title: '新建目录',
        fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
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

/**
 * 拖入目录时的加入方式选择对话框。
 * @returns {Promise<'flat'|'subdirs'|'recursive-dirs'|null>} null=取消
 */
function askDirModeDialog(dirCount) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'modal-body';
    const tip = document.createElement('div');
    tip.className = 'form-row';
    tip.innerHTML = `检测到拖入 <b>${dirCount}</b> 个目录,请选择加入方式:`;
    body.appendChild(tip);
    const opts = [
      { id: 'flat', label: '全部放入当前目录', desc: '递归扫描目录下所有可识别资源,平铺加入当前目录(不建子分类)' },
      { id: 'subdirs', label: '按直接子目录名建子分类', desc: '仅按拖入目录的直接子目录建立对应分类,子目录内资源归入对应分类(不继续嵌套)' },
      { id: 'recursive-dirs', label: '递归按目录结构建子分类', desc: '子目录的子目录也逐级建立对应分类,完整还原目录层级' },
    ];
    const list = document.createElement('div');
    list.className = 'fav-pick-list';
    let checked = false;
    for (const o of opts) {
      const lb = document.createElement('label');
      lb.className = 'fav-pick-item';
      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'dirmode';
      rb.value = o.id;
      if (!checked) { rb.checked = true; checked = true; }
      const sp = document.createElement('span');
      sp.textContent = o.label;
      lb.title = o.desc;
      lb.appendChild(rb);
      lb.appendChild(sp);
      list.appendChild(lb);
    }
    body.appendChild(list);
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = '提示:建子分类时按相对拖入目录的路径结构创建,重复目录名自动复用现有分类;直接拖入的文件不受影响,始终加入当前目录。';
    body.appendChild(hint);
    const { close } = openModal({
      title: '拖入目录的加入方式',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => { close(); resolve(null); } },
        {
          text: '确定',
          cls: 'primary',
          onClick: () => {
            const sel = list.querySelector('input:checked');
            close();
            resolve(sel ? sel.value : 'flat');
          },
        },
      ]),
    });
  });
}

/**
 * 拖拽添加:把外部拖入的文件/目录路径扫描识别后,添加到指定分类。
 * 拖入目录时弹窗选择加入方式:平铺 / 仅一层子分类 / 递归按目录结构建子分类。
 * @param {string[]} paths 拖入的绝对路径列表(文件或目录)
 * @param {string} categoryId 目标分类 id(必须已存在)
 * @returns {Promise<number>} 实际新增数量
 */
export async function addPathsToCategory(paths, categoryId) {
  if (!Array.isArray(paths) || !paths.length) return 0;
  const r = await window.api.scanPaths({ paths });
  const entries = (r && r.ok ? r.entries : []) || [];
  if (!entries.length) {
    toast('拖入的资源中没有可识别的文件(spine/龙骨/图片/音频/3D/.sk)', 'error');
    return 0;
  }
  const roots = (r && r.roots) || [];
  // 拖入目录 → 询问加入方式(仅文件则直接平铺)
  let mode = 'flat';
  if (roots.length) {
    mode = await askDirModeDialog(roots.length);
    if (mode === null) return 0; // 用户取消
  }

  const parentCat = state.categories.find((c) => c.id === categoryId);
  const catName = parentCat ? parentCat.name : '未分类';
  const inheritTags = parentCat ? (parentCat.typeTags || []) : [];
  const createdCatIds = [];
  let added = 0, skipped = 0, dirsCreated = 0;

  for (const e of entries) {
    // 按加入方式计算目标分类(仅目录拖入且非平铺时,按相对拖入根的目录层级建子分类)
    let targetCatId = categoryId;
    if (mode !== 'flat' && roots.length) {
      const root = roots.find((d) => isWithin(e.dir, d));
      if (root) {
        let segs = relSegments(e.dir, root);
        if (mode === 'subdirs') segs = segs.slice(0, 1); // 仅一层子分类
        if (segs.length) {
          const { catId: cid, created } = ensureCategoryChain(categoryId, segs, inheritTags);
          targetCatId = cid;
          dirsCreated += created.length;
          createdCatIds.push(...created);
        }
      }
    }
    ensureCategoryTypeTag(targetCatId, e.type);
    if (isDuplicateInCategory(e.file, targetCatId)) { skipped++; continue; }
    addItem({
      categoryId: targetCatId,
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
  let msg = added > 0 ? `已拖拽添加 ${added} 个资源到「${catName}」` : `未添加新资源到「${catName}」`;
  if (mode === 'subdirs') msg = added > 0 ? `已拖拽添加 ${added} 个资源(按直接子目录建子分类)到「${catName}」` : msg;
  if (mode === 'recursive-dirs') msg = added > 0 ? `已拖拽添加 ${added} 个资源(递归按目录结构建子分类)到「${catName}」` : msg;
  if (dirsCreated > 0) msg += `,自动创建 ${dirsCreated} 个目录`;
  if (skipped > 0) msg += `,${skipped} 个重复已跳过`;
  toast(msg);
  window.dispatchEvent(new CustomEvent('items-changed', {
    detail: createdCatIds.length ? { expand: createdCatIds } : undefined,
  }));
  return added;
}
