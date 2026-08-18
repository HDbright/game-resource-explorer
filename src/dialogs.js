// ============ 通用弹窗 ============

import {
  getIconGroups, getIconItems, addIconGroup, renameIconGroup, removeIconGroup,
  addIconItem, removeIconItem, moveIconItem, reorderIconItem, isImageIcon, DEFAULT_ICON_LIBRARY, EMOJI_NAMES,
  addCustomPage, PAGE_TEMPLATES,
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
    // onClick 支持 async;异常统一捕获并 toast,避免"点保存无反应"
    btn.addEventListener('click', () => {
      try {
        const r = b.onClick(btn);
        if (r && typeof r.catch === 'function') {
          r.catch((err) => {
            console.error('[modal action]', err);
            toast('操作失败:' + ((err && err.message) || err), 'error');
          });
        }
      } catch (err) {
        console.error('[modal action]', err);
        toast('操作失败:' + ((err && err.message) || err), 'error');
      }
    });
    foot.appendChild(btn);
  }
  return foot;
}

export function confirmDialog({ title, message, okText = '确定', cancelText = '取消', danger = false, onOk, onCancel }) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const p = document.createElement('p');
  p.className = 'hint';
  p.innerHTML = message;
  body.appendChild(p);

  // 返回 Promise<boolean>:resolve(true)=用户点确定,resolve(false)=取消/关闭。
  // 旧调用方式(传 onOk/onCancel 回调)继续兼容(若不再 await,返回 Promise 无影响)。
  let resolveOuter;
  const resultPromise = new Promise((r) => { resolveOuter = r; });

  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: cancelText, cls: '', onClick: () => { close(); resolveOuter(false); onCancel && onCancel(); } },
      { text: okText, cls: danger ? 'danger' : 'primary', onClick: () => { close(); resolveOuter(true); try { onOk && onOk(); } catch (_) {} } },
    ]),
  });
  return resultPromise;
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
  let submenu = null;
  let hideTimer = 0;

  const closeSub = () => {
    clearTimeout(hideTimer);
    if (submenu) { submenu.remove(); submenu = null; }
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (submenu && !submenu._hover) closeSub();
    }, 260);
  };
  const cancelHide = () => clearTimeout(hideTimer);

  /** 渲染二级菜单:父项右侧弹出(视口越界自动左移/上移) */
  const showSub = (itemEl, it) => {
    closeSub();
    const sm = document.createElement('div');
    sm.className = 'ctx-submenu';
    for (const si of it.sub) {
      const sItem = document.createElement('div');
      sItem.className = 'ctx-item' + (si.danger ? ' danger' : '') + (si.disabled ? ' disabled' : '');
      sItem.textContent = si.label;
      if (!si.disabled) {
        sItem.addEventListener('click', () => {
          sm.remove(); menu.remove();
          si.onClick && si.onClick();
        });
      }
      sm.appendChild(sItem);
    }
    sm.addEventListener('mousedown', (e) => e.stopPropagation());
    sm.addEventListener('mouseenter', () => { sm._hover = true; cancelHide(); });
    sm.addEventListener('mouseleave', () => { sm._hover = false; scheduleHide(); });
    document.body.appendChild(sm);
    submenu = sm;
    // 定位:父项右侧,视口越界则左移;垂直方向钳制
    const ir = itemEl.getBoundingClientRect();
    const sr = sm.getBoundingClientRect();
    let lx = ir.right + 4;
    if (lx + sr.width > window.innerWidth - 8) lx = ir.left - sr.width - 4;
    let ty = ir.top;
    if (ty + sr.height > window.innerHeight - 8) ty = Math.max(8, window.innerHeight - sr.height - 8);
    sm.style.left = lx + 'px';
    sm.style.top = ty + 'px';
  };

  for (const it of items) {
    const item = document.createElement('div');
    item.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
    item.textContent = it.label;
    if (it.sub && it.sub.length) {
      item.classList.add('has-sub');
      item.addEventListener('mouseenter', () => { cancelHide(); showSub(item, it); });
      item.addEventListener('mouseleave', scheduleHide);
      item.addEventListener('click', (e) => { e.stopPropagation(); }); // 仅展开,不执行动作
    } else if (!it.disabled) {
      item.addEventListener('click', () => {
        menu.remove();
        closeSub();
        it.onClick && it.onClick();
      });
    }
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

  const close = () => { closeSub(); menu.remove(); };
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
    'background:var(--bg4);color:var(--text);' +
    'border-radius:8px;padding:8px 18px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.4);' +
    'transition:opacity .3s;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

export function promptDialog({ title, fields, onOk, onCancel, message }) {
  // fields: [{key, label, type: 'text'|'textarea'|'select'|'checkboxes', options?:[{value,label}], value}]
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (message) {
    const msg = document.createElement('div');
    msg.className = 'form-hint';
    msg.style.marginBottom = '10px';
    msg.textContent = message;
    body.appendChild(msg);
  }
  const inputs = {};
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.className = 'f-label';
    label.textContent = f.label;
    row.appendChild(label);
    let input;
    if (f.type === 'static') {
      const info = document.createElement('div');
      info.className = 'form-info';
      info.textContent = f.value || '';
      row.appendChild(info);
      body.appendChild(row);
      continue;
    }
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
      // 勾选组:options [{value,label,disabled?}],value 为已勾选数组;disabled 项呈灰色不可修改(仍计入结果);结果通过 getValue() 收集
      input = document.createElement('div');
      input.className = 'check-group';
      for (const o of f.options || []) {
        const lb = document.createElement('label');
        lb.className = 'check-item' + (o.disabled ? ' disabled' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.value;
        cb.checked = Array.isArray(f.value) && f.value.includes(o.value);
        if (o.disabled) {
          cb.disabled = true; // 灰色不可修改(继承自父目录)
          if (cb.checked) lb.classList.add('checked');
        } else {
          cb.addEventListener('change', () => lb.classList.toggle('checked', cb.checked));
        }
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
    } else if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!f.value;
      input.getValue = () => input.checked;
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
            if (!el) { values[f.key] = undefined; continue; }
            values[f.key] = typeof el.getValue === 'function' ? el.getValue() : (el.value != null ? el.value.trim() : '');
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
// 供对话框「图标(emoji)」输入框旁的 😀 按钮调用。
// 支持多选(最多 MAX_ICONS 个):emoji 点选切换、底部「已选 n/N + 清空/确定」;图片(dataURL)图标单击立即替换并关闭。
let _emojiPop = null, _emojiAnchor = null, _emojiInput = null, _emojiSelected = new Set();
export const MAX_ICONS = 4; // 单个节点/字段最多允许的图标数
const _graphemeSeg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 把图标字符串拆成单个图标(按字素簇,忽略空白);图片(dataURL)图标不拆分 */
export function iconGraphemes(str) {
  const s = String(str || '');
  if (isImageIcon(s)) return [s];
  const out = [];
  for (const { segment } of _graphemeSeg.segment(s)) {
    if (/\s/u.test(segment)) continue;
    out.push(segment);
  }
  return out;
}

/** 图标最多保留前 n 个(文本图标按字素截断;图片图标原样返回) */
export function capIcons(str, n = MAX_ICONS) {
  return iconGraphemes(str).slice(0, n).join('');
}

/** 保存前的图标收口:图片图标原样;文本图标超过 n 个时截断并提示 */
export function finalizeIcon(value, n = MAX_ICONS) {
  const v = String(value || '').trim();
  if (isImageIcon(v)) return v;
  const gs = iconGraphemes(v);
  if (gs.length > n) {
    toast(`图标最多 ${n} 个,已保留前 ${n} 个`, 'info');
    return gs.slice(0, n).join('');
  }
  return v;
}

/** 侧栏树节点图标:2~4 个图标渲染为 2 列网格(第 1、2 个竖排,第 3、4 个放第 2 列);单图标/图片图标与 iconNode 相同 */
export function treeIconNode(icon, cls = '') {
  const parts = iconGraphemes(icon);
  if (parts.length < 2) return iconNode(icon, cls);
  const wrap = document.createElement('span');
  wrap.className = (cls ? cls + ' ' : '') + 'cat-icon-multi';
  for (const p of parts) {
    const cell = document.createElement('span');
    cell.className = 'cii';
    cell.textContent = p;
    wrap.appendChild(cell);
  }
  return wrap;
}

/** 提交当前多选结果到输入框(合并去重、最多 MAX_ICONS;图片图标与 emoji 不能混存,图片会被新选 emoji 替换) */
function commitEmojiSelection() {
  const input = _emojiInput;
  const sel = _emojiSelected;
  _emojiSelected = new Set();
  if (!input) return;
  const base = input.value || '';
  if (isImageIcon(base) && sel.size === 0) return; // 原图片图标未改动,原样保留
  const v = [...sel].join('');
  if (v !== base) {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function closeEmojiPicker(commit = true) {
  if (commit) commitEmojiSelection();
  if (_emojiPop) { _emojiPop.remove(); _emojiPop = null; }
  _emojiAnchor = null;
  _emojiInput = null;
  _emojiSelected = new Set();
  hideIconTip();
  window.removeEventListener('mousedown', _emojiDocDown, true);
  window.removeEventListener('blur', _emojiDocDown);
}
function _emojiDocDown(e) {
  if (!_emojiPop) return;
  if (_emojiPop.contains(e.target)) return;
  if (e.target && e.target.closest && e.target.closest('.emoji-pick-btn')) return;
  closeEmojiPicker(); // 点外部:提交当前选择并关闭
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

/** 在图标输入框后挂一个实时图形预览(避免 dataURL 长文本显示在文本框里) */
export function attachIconPreview(input, row) {
  const prev = document.createElement('span');
  prev.className = 'icon-input-preview';
  row.appendChild(prev);
  const update = () => {
    prev.innerHTML = '';
    const v = (input.value || '').trim();
    if (!v) return;
    prev.appendChild(treeIconNode(v)); // 多图标显示 2 列网格,与侧栏树一致
  };
  input.addEventListener('input', update);
  update();
}

/** 打开图标选择面板:anchor 为触发按钮,input 为回填的输入框;点同一按钮可切换开/关。
 *  emoji 支持多选(最多 MAX_ICONS 个,底部计数/清空/确定);图片(dataURL)图标单击立即替换并关闭。 */
export function openEmojiPicker(anchor, input) {
  if (_emojiPop && _emojiAnchor === anchor) { closeEmojiPicker(); return; }
  closeEmojiPicker(); // 关闭旧面板(提交其选择)
  _emojiAnchor = anchor;
  _emojiInput = input;
  // 以当前输入为初始集合:已输入的图标在面板中高亮,点选可增/删
  _emojiSelected = new Set(isImageIcon(input.value || '') ? [] : iconGraphemes(input.value || ''));
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
        // 图片图标与 emoji 不能混存:单击立即替换并关闭
        b.addEventListener('click', () => {
          input.value = it.icon;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          closeEmojiPicker(false);
        });
      } else {
        b.textContent = it.icon;
        if (_emojiSelected.has(it.icon)) b.classList.add('selected');
        b.addEventListener('click', () => {
          if (_emojiSelected.has(it.icon)) {
            _emojiSelected.delete(it.icon);
            b.classList.remove('selected');
          } else {
            if (_emojiSelected.size >= MAX_ICONS) { toast(`最多 ${MAX_ICONS} 个图标`, 'info'); return; }
            _emojiSelected.add(it.icon);
            b.classList.add('selected');
          }
          updateCount();
        });
      }
      grid.appendChild(b);
    }
    pop.appendChild(grid);
  }

  // 底部:已选计数 + 清空 / 确定
  const foot = document.createElement('div');
  foot.className = 'emoji-pop-foot';
  const cnt = document.createElement('span');
  cnt.className = 'emoji-pop-count';
  foot.appendChild(cnt);
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn sm';
  clearBtn.textContent = '清空';
  clearBtn.title = '清空当前已选(含输入框中原有图标)';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _emojiSelected.clear();
    pop.querySelectorAll('.emoji-item.selected').forEach((el) => el.classList.remove('selected'));
    updateCount();
  });
  foot.appendChild(clearBtn);
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'btn sm primary';
  okBtn.textContent = '确定';
  okBtn.title = '应用所选图标';
  okBtn.addEventListener('click', (e) => { e.stopPropagation(); closeEmojiPicker(); });
  foot.appendChild(okBtn);
  pop.appendChild(foot);
  const updateCount = () => { cnt.innerHTML = `已选 <b>${_emojiSelected.size}</b>/${MAX_ICONS}`; };
  updateCount();

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
export function pickEmojiModal(onPick) {
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


// ============ 新建自定义页面对话框(终端节点「目标页面」基于模板建立) ============
/** 新建页面:模板(内嵌网页/文本笔记)+ 标题 + 图标(默认取节点名称/图标);创建后 onDone(page) 回调 */
export function newPageDialog({ defaultTitle = '', defaultIcon = '' } = {}, onDone) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const makeRow = (label) => {
    const row = document.createElement('div');
    row.className = 'form-row';
    const lb = document.createElement('label');
    lb.className = 'f-label';
    lb.textContent = label;
    row.appendChild(lb);
    return row;
  };
  const tmplRow = makeRow('模板');
  const tmplSel = document.createElement('select');
  for (const t of PAGE_TEMPLATES) {
    const op = document.createElement('option');
    op.value = t.id;
    op.textContent = `${t.name} - ${t.desc}`;
    tmplSel.appendChild(op);
  }
  tmplSel.value = 'web';
  tmplRow.appendChild(tmplSel);
  body.appendChild(tmplRow);

  const titleRow = makeRow('页面标题');
  const titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.value = defaultTitle;
  titleInp.placeholder = '默认取节点名称';
  titleRow.appendChild(titleInp);
  body.appendChild(titleRow);

  const iconRow = makeRow('图标(emoji)');
  const iconInp = document.createElement('input');
  iconInp.type = 'text';
  iconInp.value = defaultIcon;
  iconRow.appendChild(iconInp);
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn sm emoji-pick-btn';
  pickBtn.textContent = '😀';
  pickBtn.title = '从图标库选择';
  pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
  iconRow.appendChild(pickBtn);
  attachIconPreview(iconInp, iconRow);
  body.appendChild(iconRow);

  const urlRow = makeRow('网址');
  const urlInp = document.createElement('input');
  urlInp.type = 'text';
  urlInp.placeholder = '网页地址或本地 HTML 文件路径(可空)';
  urlRow.appendChild(urlInp);
  body.appendChild(urlRow);

  const contentRow = makeRow('内容');
  const contentInp = document.createElement('textarea');
  contentInp.placeholder = '笔记内容(可空,建立后可在页面里编辑)';
  contentRow.appendChild(contentInp);
  body.appendChild(contentRow);

  const sync = () => {
    const isWeb = tmplSel.value === 'web';
    urlRow.style.display = isWeb ? '' : 'none';
    contentRow.style.display = isWeb ? 'none' : '';
  };
  tmplSel.addEventListener('change', sync);
  sync();

  const { close } = openModal({
    title: '新建自定义页面',
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '创建', cls: 'primary', onClick: () => {
          const pg = addCustomPage({
            templateId: tmplSel.value,
            title: titleInp.value.trim() || '未命名页面',
            icon: iconInp.value.trim(),
            url: urlInp.value.trim(),
            content: contentInp.value,
          });
          close();
          toast('页面已创建');
          if (onDone) onDone(pg);
        },
      },
    ]),
  });
}
