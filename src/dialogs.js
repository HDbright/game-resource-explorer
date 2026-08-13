// ============ 通用弹窗 ============

import {
  getIconGroups, getIconItems, addIconGroup, renameIconGroup, removeIconGroup,
  addIconItem, removeIconItem, moveIconItem, reorderIconItem, isImageIcon, DEFAULT_ICON_LIBRARY, EMOJI_NAMES,
} from './state.js';

const modalRoot = () => document.getElementById('modal-root');

export function openModal({ title, body, foot, wide = false }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' wide' : '');

  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<span class="modal-title"></span>`;
  head.querySelector('.modal-title').textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = '关闭';
  head.appendChild(closeBtn);

  modal.appendChild(head);
  if (body) modal.appendChild(body);
  if (foot) modal.appendChild(foot);
  mask.appendChild(modal);
  modalRoot().appendChild(mask);

  const close = () => mask.remove();
  closeBtn.addEventListener('click', close);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  return { modal, mask, close };
}

export function footButtons(buttons) {
  // buttons: [{text, cls, onClick}]
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.cls ? ' ' + b.cls : '');
    btn.textContent = b.text;
    btn.addEventListener('click', () => b.onClick(btn));
    foot.appendChild(btn);
  }
  return foot;
}

export function confirmDialog({ title, message, okText = '确定', danger = false, onOk, onCancel }) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const p = document.createElement('p');
  p.className = 'hint';
  p.innerHTML = message;
  body.appendChild(p);

  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => { close(); onCancel && onCancel(); } },
      { text: okText, cls: danger ? 'danger' : 'primary', onClick: () => { close(); onOk && onOk(); } },
    ]),
  });
}

/**
 * 右键上下文菜单(浮层,点击外部/失焦关闭)
 * items: [{label, danger?, onClick}]
 */
export function showContextMenu(x, y, items) {
  const old = document.querySelector('.ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = `left:${x}px;top:${y}px;`;
  for (const it of items) {
    const item = document.createElement('div');
    item.className = 'ctx-item' + (it.danger ? ' danger' : '');
    item.textContent = it.label;
    item.addEventListener('click', () => {
      menu.remove();
      it.onClick && it.onClick();
    });
    menu.appendChild(item);
  }
  // 阻止 mousedown 冒泡,避免外部关闭监听先移除菜单导致 click 丢失
  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(menu);

  // 边界钳制(不超出视口)
  const r = menu.getBoundingClientRect();
  const mw = Math.min(r.width, window.innerWidth - 8);
  const mh = Math.min(r.height, window.innerHeight - 8);
  menu.style.left = Math.min(x, window.innerWidth - mw) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh) + 'px';

  const close = () => menu.remove();
  setTimeout(() => {
    window.addEventListener('mousedown', close, { once: true });
    window.addEventListener('blur', close, { once: true });
  }, 0);
  return { menu, close };
}

/** 轻量提示条 */
export function toast(message, type = 'ok') {  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:200;' +
    'background:var(--bg4);color:var(--text);border:1px solid var(--border);' +
    'border-radius:8px;padding:8px 18px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
    'transition:opacity .3s;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  if (type === 'error') el.style.borderColor = 'var(--danger)';
  if (type === 'ok') el.style.borderColor = 'var(--ok)';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

export function promptDialog({ title, fields, onOk, onCancel }) {
  // fields: [{key, label, type: 'text'|'textarea'|'select'|'checkboxes', options?:[{value,label}], value}]
  const body = document.createElement('div');
  body.className = 'modal-body';
  const inputs = {};
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.className = 'f-label';
    label.textContent = f.label;
    row.appendChild(label);
    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      for (const o of f.options) {
        const op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        input.appendChild(op);
      }
      input.value = f.value;
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.value = f.value;
    } else if (f.type === 'checkboxes') {
      // 勾选组:options [{value,label}],value 为已勾选数组;结果通过 getValue() 收集
      input = document.createElement('div');
      input.className = 'check-group';
      for (const o of f.options || []) {
        const lb = document.createElement('label');
        lb.className = 'check-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.value;
        cb.checked = Array.isArray(f.value) && f.value.includes(o.value);
        cb.addEventListener('change', () => lb.classList.toggle('checked', cb.checked));
        lb.appendChild(cb);
        lb.appendChild(document.createTextNode(o.label));
        input.appendChild(lb);
      }
      if (f.hint) {
        const tip = document.createElement('div');
        tip.className = 'form-hint';
        tip.textContent = f.hint;
        input.appendChild(tip);
      }
      input.getValue = () =>
        [...input.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = f.value;
    }
    inputs[f.key] = input;
    row.appendChild(input);
    body.appendChild(row);
  }

  let okClicked = false;
  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => { close(); onCancel && onCancel(); } },
      {
        text: '确定',
        cls: 'primary',
        onClick: (btn) => {
          if (okClicked) return;
          okClicked = true;
          const values = {};
          for (const f of fields) {
            const el = inputs[f.key];
            values[f.key] = el && typeof el.getValue === 'function' ? el.getValue() : el.value.trim();
          }
          close();
          onOk && onOk(values);
        },
      },
    ]),
  });
  // 回车提交
  const first = Object.values(inputs)[0];
  if (first && first.tagName === 'INPUT') {
    first.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); } });
  }
}

// ============ 图标(emoji)选择面板 ============
// 供对话框「图标(emoji)」输入框旁的 😀 按钮调用;点击项回填输入框。
let _emojiPop = null, _emojiAnchor = null;
function closeEmojiPicker() {
  if (_emojiPop) { _emojiPop.remove(); _emojiPop = null; }
  _emojiAnchor = null;
  hideIconTip();
  window.removeEventListener('mousedown', _emojiDocDown, true);
  window.removeEventListener('blur', _emojiDocDown);
}
function _emojiDocDown(e) {
  if (!_emojiPop) return;
  if (_emojiPop.contains(e.target)) return;
  if (e.target && e.target.closest && e.target.closest('.emoji-pick-btn')) return;
  closeEmojiPicker();
}

/** 渲染节点图标:图片(dataURL)用 <img>,否则文本 emoji;返回 span 元素 */
export function iconNode(icon, cls = '') {
  const ic = document.createElement('span');
  if (cls) ic.className = cls;
  if (isImageIcon(icon)) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    ic.appendChild(img);
  } else {
    ic.textContent = icon || '';
  }
  return ic;
}

/** 打开图标选择面板:anchor 为触发按钮,input 为回填的输入框;点同一按钮可切换开/关 */
export function openEmojiPicker(anchor, input) {
  if (_emojiPop && _emojiAnchor === anchor) { closeEmojiPicker(); return; }
  closeEmojiPicker();
  _emojiAnchor = anchor;
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';

  // 顶部:管理入口
  const head = document.createElement('div');
  head.className = 'emoji-pop-head';
  const title = document.createElement('span');
  title.className = 'emoji-pop-title';
  title.textContent = '图标库';
  head.appendChild(title);
  const mgr = document.createElement('button');
  mgr.type = 'button';
  mgr.className = 'btn sm';
  mgr.textContent = '🗂 管理';
  mgr.title = '管理图标库:添加/删除/排序/自定义分组/导入 PNG·ICO';
  mgr.addEventListener('click', (e) => { e.stopPropagation(); closeEmojiPicker(); openIconLibraryDialog(); });
  head.appendChild(mgr);
  pop.appendChild(head);

  // 按分组渲染(state 图标库,支持图片图标)
  const groups = getIconGroups().slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const items = getIconItems();
  for (const g of groups) {
    const gItems = items.filter((it) => it.groupId === g.id);
    if (!gItems.length) continue;
    const h = document.createElement('div');
    h.className = 'emoji-pop-group';
    h.textContent = g.name;
    pop.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    for (const it of gItems) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-item';
      bindIconTip(b, () => it.name || it.icon);
      if (isImageIcon(it.icon)) {
        const img = document.createElement('img');
        img.src = it.icon;
        img.alt = '';
        b.appendChild(img);
      } else {
        b.textContent = it.icon;
      }
      b.addEventListener('click', () => {
        input.value = it.icon;
        closeEmojiPicker();
      });
      grid.appendChild(b);
    }
    pop.appendChild(grid);
  }
  document.body.appendChild(pop);
  _emojiPop = pop;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth || 320;
  const ph = pop.offsetHeight;
  let left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
  else if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  window.addEventListener('mousedown', _emojiDocDown, true);
  window.addEventListener('blur', _emojiDocDown);
}

// ---------- 图标库管理对话框(分组/图标增删改序 + 导入 PNG·ICO) ----------

const baseName = (p) => String(p || '').split(/[\\/]/).pop() || '';
function promptText(title, value, onOk) {
  promptDialog({
    title,
    fields: [{ key: 'v', label: '名称', type: 'text', value }],
    onOk: ({ v }) => { const s = (v || '').trim(); if (s) onOk(s); },
  });
}

// ---------- 图标即时名称提示(悬停立刻显示,不等浏览器 title 延迟) ----------
let _iconTipEl = null;
function showIconTip(ev, text) {
  if (!text) return;
  if (!_iconTipEl) {
    _iconTipEl = document.createElement('div');
    _iconTipEl.className = 'icon-tip';
    document.body.appendChild(_iconTipEl);
  }
  _iconTipEl.textContent = text;
  _iconTipEl.style.display = 'block';
  positionIconTip(ev);
}
function positionIconTip(ev) {
  if (!_iconTipEl || _iconTipEl.style.display === 'none') return;
  const w = _iconTipEl.offsetWidth;
  const h = _iconTipEl.offsetHeight;
  let x = ev.clientX + 14;
  let y = ev.clientY + 16;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 10;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - 10;
  _iconTipEl.style.left = Math.max(4, x) + 'px';
  _iconTipEl.style.top = Math.max(4, y) + 'px';
}
function hideIconTip() {
  if (_iconTipEl) _iconTipEl.style.display = 'none';
}
/** 绑定悬停即时名称提示(el 为图标元素,getText 返回名称文本) */
function bindIconTip(el, getText) {
  el.addEventListener('mouseenter', (ev) => showIconTip(ev, getText()));
  el.addEventListener('mousemove', (ev) => positionIconTip(ev));
  el.addEventListener('mouseleave', hideIconTip);
}
/** emoji 名称(去 U+FE0F 归一化匹配);未收录返回空 */
const iconNameOf = (e) => EMOJI_NAMES[String(e || '').replace(/\uFE0F/g, '')] || '';

/** 弹出 emoji 添加面板:可直接输入/粘贴库里没有的任意 emoji(支持多个),也可在候选网格多选,批量回调数组 */
function pickEmojiModal(onPick) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const tip = document.createElement('div');
  tip.className = 'hint';
  tip.textContent = '可直接输入/粘贴任意 emoji(如 😺🦄,可一次多个),或在下方候选里点选;点「添加」批量加入当前分组';
  body.appendChild(tip);

  // 自定义输入框(支持库中没有的 emoji)
  const row = document.createElement('div');
  row.className = 'form-row';
  const lb = document.createElement('label');
  lb.className = 'f-label';
  lb.textContent = '自定义';
  row.appendChild(lb);
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = '输入/粘贴库中没有的 emoji,支持多个';
  row.appendChild(inp);
  body.appendChild(row);

  // 候选网格(默认库,可多选)
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  const selected = new Set();
  const seen = new Set();
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const extractInput = () => {
    const out = [];
    for (const { segment } of seg.segment((inp.value || '').trim())) {
      if (/[\p{Extended_Pictographic}]/u.test(segment)) out.push(segment);
    }
    return out;
  };
  for (const g of DEFAULT_ICON_LIBRARY) {
    for (const e of g.items) {
      if (seen.has(e)) continue;
      seen.add(e);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-item';
      b.textContent = e;
      bindIconTip(b, () => iconNameOf(e) || e);
      b.addEventListener('click', () => {
        if (selected.has(e)) { selected.delete(e); b.classList.remove('selected'); }
        else { selected.add(e); b.classList.add('selected'); }
        refreshAdd();
      });
      grid.appendChild(b);
    }
  }
  body.appendChild(grid);

  const refreshAdd = () => {
    const n = selected.size + extractInput().length;
    addBtn.textContent = n ? `添加(${n})` : '添加';
  };
  inp.addEventListener('input', refreshAdd);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); } });

  function confirmAdd() {
    const arr = [...new Set([...selected, ...extractInput()])];
    if (!arr.length) { toast('请先输入或选择 emoji', 'info', 2000); return; }
    mclose();
    onPick(arr);
  }
  const foot = footButtons([
    { text: '取消', cls: '', onClick: () => mclose() },
    { text: '添加', cls: 'primary', onClick: () => confirmAdd() },
  ]);
  const addBtn = foot.querySelectorAll('.btn')[1];
  const { close: mclose } = openModal({
    title: '添加 emoji(可多选/自定义)',
    body,
    foot,
  });
}

/** 图标库管理:自定义分组、增删图标、排序、导入 PNG/ICO */
export function openIconLibraryDialog() {
  const body = document.createElement('div');
  body.className = 'modal-body icon-lib-body';
  const { close } = openModal({
    title: '图标库管理',
    wide: true,
    body,
    foot: footButtons([{ text: '完成', cls: 'primary', onClick: () => close() }]),
  });
  let currentGroupId = null;
  let dragIconId = null; // 正在拖拽排序的图标 id
  const clearIconDrop = () => {
    body.querySelectorAll('.icon-lib-item.dragging, .icon-lib-item.drop-before, .icon-lib-item.drop-after')
      .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  };

  const render = () => { body.innerHTML = ''; build(); };
  const build = () => {
    const groups = getIconGroups().slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const items = getIconItems();
    if (!groups.some((g) => g.id === currentGroupId)) currentGroupId = groups.length ? groups[0].id : null;

    // ---- 左:分组列表 ----
    const left = document.createElement('div');
    left.className = 'icon-lib-groups';
    const lh = document.createElement('div');
    lh.className = 'icon-lib-side-head';
    lh.textContent = '分组';
    left.appendChild(lh);
    for (const g of groups) {
      const row = document.createElement('div');
      row.className = 'icon-lib-group' + (g.id === currentGroupId ? ' active' : '');
      const nm = document.createElement('span');
      nm.className = 'icon-lib-group-name';
      nm.textContent = g.name;
      row.appendChild(nm);
      const ops = document.createElement('span');
      ops.className = 'icon-lib-group-ops';
      const rn = document.createElement('button');
      rn.type = 'button'; rn.className = 'btn sm ghost'; rn.textContent = '✎'; rn.title = '重命名分组';
      rn.addEventListener('click', (e) => { e.stopPropagation(); promptText('重命名分组', g.name, (v) => { renameIconGroup(g.id, v); render(); }); });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn sm ghost danger'; del.textContent = '×'; del.title = '删除分组(组内图标移到第一组)';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog({ title: `删除分组「${g.name}」?`, message: '组内图标将移到第一组。', danger: true, onOk: () => { removeIconGroup(g.id); render(); } });
      });
      ops.appendChild(rn); ops.appendChild(del);
      row.appendChild(ops);
      row.addEventListener('click', () => { currentGroupId = g.id; render(); });
      left.appendChild(row);
    }
    const addG = document.createElement('button');
    addG.type = 'button'; addG.className = 'btn sm'; addG.textContent = '＋ 新增分组';
    addG.addEventListener('click', () => { promptText('新增分组', '', (v) => { const g = addIconGroup(v); if (g) currentGroupId = g.id; render(); }); });
    left.appendChild(addG);
    body.appendChild(left);

    // ---- 右:图标网格 ----
    const right = document.createElement('div');
    right.className = 'icon-lib-items';
    const cur = groups.find((g) => g.id === currentGroupId) || null;
    const rh = document.createElement('div');
    rh.className = 'icon-lib-side-head';
    rh.textContent = cur ? `${cur.name}(图标)` : '图标';
    right.appendChild(rh);
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    const gItems = items.filter((it) => it.groupId === currentGroupId);
    for (const it of gItems) {
      const cell = document.createElement('div');
      cell.className = 'icon-lib-item';
      bindIconTip(cell, () => it.name || it.icon || ''); // 悬停即时显示图标名称(中英文)
      // 拖拽排序:拖到其它图标左/右半区插入前后(跨组自动换组)
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => {
        dragIconId = it.id;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', it.id); } catch (_) {}
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', () => { dragIconId = null; clearIconDrop(); });
      cell.addEventListener('dragover', (e) => {
        if (!dragIconId || dragIconId === it.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = cell.getBoundingClientRect();
        cell.classList.remove('drop-before', 'drop-after');
        cell.classList.toggle('drop-before', e.clientX - r.left < r.width / 2);
        cell.classList.toggle('drop-after', e.clientX - r.left >= r.width / 2);
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-before', 'drop-after'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        cell.classList.remove('drop-before', 'drop-after');
        if (!dragIconId || dragIconId === it.id) { dragIconId = null; return; }
        const r = cell.getBoundingClientRect();
        const place = e.clientX - r.left < r.width / 2 ? 'before' : 'after';
        reorderIconItem(dragIconId, it.id, place);
        dragIconId = null;
        render();
      });
      const show = document.createElement('div');
      show.className = 'icon-lib-item-show';
      if (isImageIcon(it.icon)) {
        const img = document.createElement('img');
        img.src = it.icon; img.alt = '';
        show.appendChild(img);
      } else {
        show.textContent = it.icon;
      }
      cell.appendChild(show);
      const ops = document.createElement('div');
      ops.className = 'icon-lib-item-ops';
      const mk = (t, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn sm ghost' + (cls ? ' ' + cls : '');
        b.textContent = t;
        b.addEventListener('click', fn);
        return b;
      };
      ops.appendChild(mk('◀', '', () => { moveIconItem(it.id, -1); render(); }));
      ops.appendChild(mk('▶', '', () => { moveIconItem(it.id, 1); render(); }));
      ops.appendChild(mk('×', 'danger', () => { removeIconItem(it.id); render(); }));
      cell.appendChild(ops);
      grid.appendChild(cell);
    }
    right.appendChild(grid);
    const addBtns = document.createElement('div');
    addBtns.className = 'icon-lib-add';
    const addEmoji = document.createElement('button');
    addEmoji.type = 'button'; addEmoji.className = 'btn sm'; addEmoji.textContent = '＋ 从 emoji 添加';
    addEmoji.addEventListener('click', () => {
      if (!cur) return;
      pickEmojiModal((arr) => {
        for (const e of arr) addIconItem({ groupId: cur.id, icon: e, name: iconNameOf(e) });
        toast(`已添加 ${arr.length} 个图标`);
        render();
      });
    });
    const addFile = document.createElement('button');
    addFile.type = 'button'; addFile.className = 'btn sm'; addFile.textContent = '＋ 导入 PNG/ICO';
    addFile.addEventListener('click', async () => {
      if (!cur) return;
      const r = await window.api.importIcon();
      if (r && r.ok) { addIconItem({ groupId: cur.id, icon: r.dataUrl, name: baseName(r.path) }); render(); }
      else if (r && !r.canceled) { toast(r.error || '导入失败', 'error'); }
    });
    addBtns.appendChild(addEmoji); addBtns.appendChild(addFile);
    right.appendChild(addBtns);
    body.appendChild(right);
  };
  render();
}

