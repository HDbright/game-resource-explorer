// ============ 通用弹窗 ============

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
const EMOJI_GROUPS = [
  { label: '常用', items: '😀 😁 😂 🤣 😊 😍 🥰 😎 🤔 😴 🥳 😅 😇 🙃 😉 😋 🤭 🥲 😢 😭 😤 😡 🤯 🥵 🤠 🤡 👻 💀 🤖 🎃 👋 ✋ 👌 ✌ 🤞 👍 👎 👏 🙏 💪 🤝 ✊ 👊 🔥 ⭐ ⚡ 💯 ✅ ❌ ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 ✨ 🎉 🎊 🎁 🎈'.split(' ') },
  { label: '目录与文件', items: '📁 📂 🗂 📚 📖 📕 📗 📘 📙 📔 📒 📃 📄 📑 📋 📝 ✏️ 📌 📍 🗒 🗓 📅 📇 🗃 🗄 📦 📤 📥 📨 📩 📪 📫 📬 📭 📮 📎 🖇 🔖 🏷'.split(' ') },
  { label: '应用与工具', items: '🧰 🛠 🔧 ⚙ 🔩 ⚒ 🪛 🔨 🪚 🧲 ⚓ 🛡 🔦 💡 🔋 🔌 🔥 💎 🔍 🔎 👁 🖥 💻 ⌨ 🖱 🖨 📷 📸 📹 🎥 🖼 🎨 🖌 🖍 🎛 🎚 🎙 📻 📡 ☎ 📟 🔭 🧪 🧬 🧫 💊 💉 🩺 🦠 🧱 🪨 🪵 🧊 ⚗ 🔬 🗺 🧭 🚀 🛸 ✈ 🚁 🚂 🚗 🚌 ⛵ 🚢 🪂 🏗 🛰 🌐 🕸 🧩'.split(' ') },
  { label: '媒体与音乐', items: '🎬 🎞 🎦 📺 📽 🎥 🎙 🎚 🎛 🎧 🎵 🎶 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎤 🎭 🎪 🎫 🎟 📼'.split(' ') },
  { label: '游戏与生活', items: '🎮 🕹 🎯 🎲 🧩 ♟ 🎳 🎰 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🏸 🥊 🥋 ⛳ 🎣 🎿 ⛸ 🥇 🥈 🥉 🏆 🏅 🎗 🎖 💰 💳 💵 🧧 🛍 🛒 🎀 🪄 🎆 🎇 🧸 🪀 🪁 🎃 🎄 🎋 🎐 🏮 🕯'.split(' ') },
];

let _emojiPop = null, _emojiAnchor = null;
function closeEmojiPicker() {
  if (_emojiPop) { _emojiPop.remove(); _emojiPop = null; }
  _emojiAnchor = null;
  window.removeEventListener('mousedown', _emojiDocDown, true);
  window.removeEventListener('blur', _emojiDocDown);
}
function _emojiDocDown(e) {
  if (!_emojiPop) return;
  if (_emojiPop.contains(e.target)) return;
  if (e.target && e.target.closest && e.target.closest('.emoji-pick-btn')) return;
  closeEmojiPicker();
}
/** 打开图标选择面板:anchor 为触发按钮,input 为回填的输入框;点同一按钮可切换开/关 */
export function openEmojiPicker(anchor, input) {
  if (_emojiPop && _emojiAnchor === anchor) { closeEmojiPicker(); return; }
  closeEmojiPicker();
  _emojiAnchor = anchor;
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  for (const g of EMOJI_GROUPS) {
    const h = document.createElement('div');
    h.className = 'emoji-pop-group';
    h.textContent = g.label;
    pop.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    for (const e of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-item';
      b.textContent = e;
      b.title = e;
      b.addEventListener('click', () => {
        input.value = e;
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
