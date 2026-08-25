// ============ 颜色选择库(资源工具箱) ============
// 三个标签页:
//   1. 项目配色 —— 本应用实际使用的全部颜色(主题 CSS 变量 + 模块固定色),
//      含色卡 / HEX / RGB / HSL / 中文名 / 英文名 / 使用位置备注;变量色可修改并实时应用到界面。
//   2. 推荐配色 —— 各类型 UI 推荐配色方案(深色/浅色/游戏/国风等),可一键应用为当前主题。
//   3. 我的收藏 —— 自定义分组收藏颜色,分组与颜色均可增删改。
// 附 PowerToys 式取色:颜色编辑器(SV 面板 + 色相条 + HEX/RGB/HSL 互转 + 最近使用)
// + 全屏放大镜取色(electron/main.js 的 color:screenPick,冻结截图方案)。

import { state, saveState, uid, now } from '../state.js';
import { applyAppearance } from '../appearance.js';
import { toast, confirmDialog, promptDialog, openModal, footButtons, showContextMenu } from '../dialogs.js';
import { copyText } from '../clipboard.js';
import { PROJECT_COLOR_CATALOG, RECOMMENDED_PALETTES } from './colorLibraryData.js';

// ---------------- 颜色数学 ----------------

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() → {r,g,b};失败返回 null */
function parseColor(str) {
  const s = String(str || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s) || /^#([0-9a-f]{4})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

function hexToRgb(hex) { return parseColor(hex); }

/** rgb → hsl(h:0-360, s:0-100, l:0-100) */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue2rgb(h + 1 / 3); g = hue2rgb(h); b = hue2rgb(h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/** rgb → hsv(h:0-360, s:0-100, v:0-100) */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round((max === 0 ? 0 : d / max) * 100), v: Math.round(max * 100) };
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; v = clamp(v, 0, 100) / 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/** 颜色亮度(0-255),用于决定色块上文字用深还是浅 */
function luminance(hex) {
  const c = parseColor(hex);
  if (!c) return 128;
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}
function contrastText(hex) { return luminance(hex) > 150 ? '#1b1d23' : '#ffffff'; }

function fmtRgb(hex) { const c = parseColor(hex); return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : '-'; }
function fmtHsl(hex) { const c = parseColor(hex); if (!c) return '-'; const h = rgbToHsl(c.r, c.g, c.b); return `hsl(${h.h}, ${h.s}%, ${h.l}%)`; }
function hexOf(hex) { const c = parseColor(hex); return c ? rgbToHex(c.r, c.g, c.b) : String(hex || '').toUpperCase(); }

// ---------------- 主题 / 变量读取 ----------------

/** 当前界面基底主题:'light' | 'dark'(appearance.js 写在 <html data-theme>) */
function themeBase() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }

/** settings.theme 解析到实际主题名 dark/light/custom(system 按当前系统配色映射) */
function resolvedThemeName() {
  let t = (state.settings && state.settings.theme) || 'dark';
  if (t === 'system') t = themeBase() === 'light' ? 'light' : 'dark';
  return (t === 'light' || t === 'custom') ? t : 'dark';
}

const THEME_LABEL = { dark: '深色', light: '浅色', custom: '自定义', system: '跟随系统' };
function themeSettingLabel() {
  const t = (state.settings && state.settings.theme) || 'dark';
  return THEME_LABEL[t] || t;
}

/** 读取某 CSS 变量当前生效颜色(经 var() 链解析,含主题设置与颜色覆盖),返回 #RRGGBB */
let _probeEl = null;
function effectiveVarHex(varName) {
  if (!varName) return null;
  try {
    if (!_probeEl) { _probeEl = document.createElement('span'); _probeEl.style.display = 'none'; }
    document.body.appendChild(_probeEl);
    _probeEl.style.color = '';
    _probeEl.style.color = `var(${varName})`;
    const c = getComputedStyle(_probeEl).color;
    _probeEl.remove();
    return c ? hexOf(c) : null;
  } catch (e) { return null; }
}

// ---------------- 最近使用颜色 ----------------

const RECENT_KEY = 'clibRecentColors';
function getRecentColors() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && parseColor(x)).slice(0, 16);
  } catch (e) { return []; }
}
function pushRecentColor(hex) {
  const h = hexOf(hex);
  const list = [h, ...getRecentColors().filter((x) => x !== h)].slice(0, 16);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

// ---------------- 全屏取色(PowerToys 式) ----------------

/** 唤起全屏取色窗口;返回 '#RRGGBB' 或 null(取消/失败) */
async function pickScreenColor() {
  if (!(window.api && typeof window.api.pickScreenColor === 'function')) {
    toast('当前环境不支持屏幕取色(需在应用窗口内使用)', 'error');
    return null;
  }
  try {
    toast('📸 正在截取光标所在屏幕…'); // 截屏+建窗有 100~300ms 延迟,先给即时反馈
    const r = await window.api.pickScreenColor();
    if (r && r.ok && parseColor(r.hex)) return hexOf(r.hex);
    if (r && r.error) toast('取色失败:' + r.error, 'error');
    return null;
  } catch (e) {
    toast('取色失败:' + ((e && e.message) || e), 'error');
    return null;
  }
}

// ---------------- 颜色编辑器对话框(SV 面板 + 色相条 + HEX/RGB/HSL + 取色) ----------------

/**
 * 打开颜色编辑器。
 * @param {{ title?: string, value?: string, hint?: string, onOk?: (hex: string) => void }} opts
 */
export function openColorEditor(opts = {}) {
  const title = opts.title || '选择颜色';
  const startHex = hexOf(opts.value || '#4f8cff');
  let hsv = rgbToHsv(parseColor(startHex).r, parseColor(startHex).g, parseColor(startHex).b);
  let syncing = false;

  const body = document.createElement('div');
  body.className = 'modal-body cpe';
  body.innerHTML = `
    <div class="cpe-pick">
      <div class="cpe-sv" id="cpe-sv"><div class="cpe-sv-knob" id="cpe-sv-knob"></div></div>
      <div class="cpe-hue" id="cpe-hue"><div class="cpe-hue-knob" id="cpe-hue-knob"></div></div>
    </div>
    <div class="cpe-side">
      <div class="cpe-preview">
        <span class="cpe-cur" id="cpe-cur" title="当前颜色"></span>
        <span class="cpe-orig" id="cpe-orig" title="进入时颜色(点击恢复)">Aa</span>
        <span class="cpe-hex-label" id="cpe-hex-label">#FFFFFF</span>
      </div>
      <div class="cpe-fields">
        <label class="cpe-row"><span>HEX</span><input type="text" id="cpe-hex" spellcheck="false" maxlength="9" /></label>
        <label class="cpe-row cpe-rgb"><span>RGB</span>
          <input type="number" min="0" max="255" data-k="r" /><input type="number" min="0" max="255" data-k="g" /><input type="number" min="0" max="255" data-k="b" />
        </label>
        <label class="cpe-row cpe-hsl"><span>HSL</span>
          <input type="number" min="0" max="360" data-k="h" /><input type="number" min="0" max="100" data-k="s" /><input type="number" min="0" max="100" data-k="l" />
        </label>
      </div>
      <div class="cpe-quick">
        <input type="color" id="cpe-native" title="系统取色板" />
        <button type="button" class="btn sm" id="cpe-eyedrop" title="全屏取色:冻结屏幕截图,放大镜点击取色(PowerToys 式)">📷 屏幕取色</button>
      </div>
      <div class="cpe-recent" id="cpe-recent">
        <span class="cpe-recent-label">最近使用</span>
        <div class="cpe-recent-chips" id="cpe-recent-chips"></div>
      </div>
      ${opts.hint ? `<div class="cpe-hint">${esc(opts.hint)}</div>` : ''}
    </div>
  `;

  const el = (id) => body.querySelector('#' + id);
  const svEl = el('cpe-sv'), svKnob = el('cpe-sv-knob');
  const hueEl = el('cpe-hue'), hueKnob = el('cpe-hue-knob');
  const curEl = el('cpe-cur'), origEl = el('cpe-orig'), hexLabel = el('cpe-hex-label');
  const hexInput = el('cpe-hex');
  const rgbInputs = {}, hslInputs = {};
  body.querySelectorAll('.cpe-rgb input').forEach((i) => { rgbInputs[i.dataset.k] = i; });
  body.querySelectorAll('.cpe-hsl input').forEach((i) => { hslInputs[i.dataset.k] = i; });

  function currentHex() {
    const c = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(c.r, c.g, c.b);
  }

  function syncUI() {
    if (syncing) return;
    syncing = true;
    const hex = currentHex();
    const c = parseColor(hex);
    const hsl = rgbToHsl(c.r, c.g, c.b);
    // SV 面板底色 = 当前色相的纯色
    const pure = hsvToRgb(hsv.h, 100, 100);
    svEl.style.background = rgbToHex(pure.r, pure.g, pure.b);
    svKnob.style.left = hsv.s + '%';
    svKnob.style.top = (100 - hsv.v) + '%';
    hueKnob.style.left = (hsv.h / 360) * 100 + '%';
    curEl.style.background = hex;
    hexLabel.textContent = hex;
    hexInput.value = hex;
    rgbInputs.r.value = c.r; rgbInputs.g.value = c.g; rgbInputs.b.value = c.b;
    hslInputs.h.value = hsl.h; hslInputs.s.value = hsl.s; hslInputs.l.value = hsl.l;
    syncing = false;
  }

  function setHex(hex, keepFocus) {
    const c = parseColor(hex);
    if (!c) return false;
    hsv = rgbToHsv(c.r, c.g, c.b);
    syncUI();
    return true;
  }

  // SV 面板 / 色相条拖动(pointer capture,支持鼠标与触控)
  function dragTrack(target, onNorm) {
    const handle = (e) => {
      const r = target.getBoundingClientRect();
      onNorm(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      handle(e);
      const move = (ev) => handle(ev);
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    });
  }
  dragTrack(svEl, (nx, ny) => { hsv.s = Math.round(nx * 100); hsv.v = Math.round((1 - ny) * 100); syncUI(); });
  dragTrack(hueEl, (nx) => { hsv.h = Math.round(nx * 360); syncUI(); });

  // 数值输入互转
  hexInput.addEventListener('input', () => {
    if (syncing) return;
    const v = hexInput.value.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) setHex(v);
  });
  const onRGBInput = () => {
    if (syncing) return;
    const r = +rgbInputs.r.value, g = +rgbInputs.g.value, b = +rgbInputs.b.value;
    if ([r, g, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
      hsv = rgbToHsv(r, g, b); syncUI();
    }
  };
  Object.values(rgbInputs).forEach((i) => i.addEventListener('input', onRGBInput));
  const onHSLInput = () => {
    if (syncing) return;
    const h = +hslInputs.h.value, s = +hslInputs.s.value, l = +hslInputs.l.value;
    if ([h, s, l].every((n) => Number.isFinite(n))) {
      const c = hslToRgb(clamp(h, 0, 360), clamp(s, 0, 100), clamp(l, 0, 100));
      hsv = rgbToHsv(c.r, c.g, c.b); syncUI();
    }
  };
  Object.values(hslInputs).forEach((i) => i.addEventListener('input', onHSLInput));

  el('cpe-native').addEventListener('input', (e) => setHex(e.target.value));
  origEl.style.background = startHex;
  origEl.addEventListener('click', () => setHex(startHex));
  el('cpe-eyedrop').addEventListener('click', async () => {
    const hex = await pickScreenColor();
    if (hex) setHex(hex);
  });

  // 最近使用
  function renderRecent() {
    const box = el('cpe-recent-chips');
    const list = getRecentColors();
    el('cpe-recent').style.display = list.length ? '' : 'none';
    box.innerHTML = '';
    for (const h of list) {
      const chip = document.createElement('span');
      chip.className = 'cpe-chip';
      chip.style.background = h;
      chip.title = h;
      chip.addEventListener('click', () => setHex(h));
      box.appendChild(chip);
    }
  }
  renderRecent();

  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '确定',
        cls: 'primary',
        onClick: () => {
          const hex = currentHex();
          pushRecentColor(hex);
          close();
          opts.onOk && opts.onOk(hex);
        },
      },
    ]),
  });
  syncUI();
}

// ---------------- 收藏表单(名称/英文名/备注 + 选色) ----------------

/**
 * 新增/编辑一条收藏颜色。value: {hex, name, nameEn, note}
 */
function openColorFormDialog({ title, value = {}, onOk }) {
  const cur = { hex: hexOf(value.hex || '#4f8cff'), name: value.name || '', nameEn: value.nameEn || '', note: value.note || '' };
  const body = document.createElement('div');
  body.className = 'modal-body cpe-form';
  body.innerHTML = `
    <div class="cf-color-row">
      <span class="cf-swatch" id="cf-swatch"></span>
      <input type="text" id="cf-hex" class="cf-hex-input" spellcheck="false" title="HEX 颜色值" />
      <input type="color" id="cf-native" title="系统取色板" />
      <button type="button" class="btn sm" id="cf-edit" title="打开颜色编辑器(SV 面板 / HEX / RGB / HSL / 屏幕取色)">🎨 编辑颜色…</button>
      <button type="button" class="btn sm" id="cf-eyedrop" title="全屏取色:冻结屏幕截图,放大镜点击取色">📷 屏幕取色</button>
    </div>
    <div class="form-row"><label class="f-label">中文名</label><input type="text" id="cf-name" placeholder="如:晴空蓝" /></div>
    <div class="form-row"><label class="f-label">英文名</label><input type="text" id="cf-nameEn" placeholder="如:Azure" /></div>
    <div class="form-row"><label class="f-label">备注</label><textarea id="cf-note" rows="2" placeholder="用在哪里 / 备注(如:首页主按钮)"></textarea></div>
  `;
  const swatch = body.querySelector('#cf-swatch');
  const hexInput = body.querySelector('#cf-hex');
  const nameInput = body.querySelector('#cf-name');
  const nameEnInput = body.querySelector('#cf-nameEn');
  const noteInput = body.querySelector('#cf-note');
  const nativeInput = body.querySelector('#cf-native');

  function showHex() {
    const h = hexOf(cur.hex);
    swatch.style.background = h;
    hexInput.value = h;
    nativeInput.value = h.toLowerCase();
  }
  function setHex(hex) {
    if (!parseColor(hex)) return false;
    cur.hex = hexOf(hex);
    showHex();
    return true;
  }
  hexInput.addEventListener('input', () => { if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexInput.value.trim())) setHex(hexInput.value.trim()); });
  nativeInput.addEventListener('input', (e) => setHex(e.target.value));
  body.querySelector('#cf-edit').addEventListener('click', () => {
    openColorEditor({ title: '编辑收藏颜色', value: cur.hex, hint: cur.name ? `${cur.name} · ${cur.nameEn || ''}` : '', onOk: (hex) => setHex(hex) });
  });
  body.querySelector('#cf-eyedrop').addEventListener('click', async () => {
    const hex = await pickScreenColor();
    if (hex) setHex(hex);
  });
  nameInput.value = cur.name;
  nameEnInput.value = cur.nameEn;
  noteInput.value = cur.note;
  showHex();

  const { close } = openModal({
    title,
    body,
    foot: footButtons([
      { text: '取消', cls: '', onClick: () => close() },
      {
        text: '确定',
        cls: 'primary',
        onClick: () => {
          const out = {
            hex: hexOf(cur.hex),
            name: nameInput.value.trim(),
            nameEn: nameEnInput.value.trim(),
            note: noteInput.value.trim(),
          };
          close();
          onOk && onOk(out);
        },
      },
    ]),
  });
}

// ---------------- 页面渲染 ----------------

const TABS = [
  { id: 'project', label: '项目配色', icon: '🎛' },
  { id: 'recommend', label: '推荐配色', icon: '🌈' },
  { id: 'favorites', label: '我的收藏', icon: '⭐' },
];

let curTab = 'project';
let searchProject = '';   // 项目配色搜索词
let searchPalette = '';   // 推荐配色搜索词
let paletteTypeFilter = 'all';
let curGroupId = null;    // 收藏:当前选中分组

export function renderColorLibraryTool(body) {
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'clib';
  const tabsEl = document.createElement('div');
  tabsEl.className = 'clib-tabs';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.className = 'btn sm clib-tab' + (t.id === curTab ? ' active' : '');
    b.innerHTML = `${t.icon} ${t.label}`;
    b.addEventListener('click', () => { curTab = t.id; renderColorLibraryTool(body); });
    tabsEl.appendChild(b);
  }
  wrap.appendChild(tabsEl);
  const panel = document.createElement('div');
  panel.className = 'clib-panel';
  wrap.appendChild(panel);
  body.appendChild(wrap);

  if (curTab === 'project') renderProjectTab(panel, () => renderColorLibraryTool(body));
  else if (curTab === 'recommend') renderRecommendTab(panel, () => renderColorLibraryTool(body));
  else renderFavoritesTab(panel, () => renderColorLibraryTool(body));
}

/** 生成一个「点击复制」的数值小标签 */
function valChip(text, title) {
  const chip = document.createElement('span');
  chip.className = 'clib-val';
  chip.textContent = text;
  chip.title = (title || text) + '(点击复制)';
  chip.addEventListener('click', (e) => { e.stopPropagation(); copyText(text, '颜色值'); });
  return chip;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- 标签页 1:项目配色 ----------

function renderProjectTab(panel, rerender) {
  panel.innerHTML = ''; // 局部重渲染(搜索)前清空,避免内容叠加
  const ov = state.settings.colorOverrides || (state.settings.colorOverrides = {});
  const base = themeBase();
  const overriddenCount = Object.keys(ov).length;

  const toolbar = document.createElement('div');
  toolbar.className = 'clib-toolbar';
  toolbar.innerHTML = `
    <input type="text" class="clib-search" placeholder="搜索颜色:名称 / 变量 / HEX / 用途…" value="${esc(searchProject)}" />
    <span class="clib-theme-badge">当前主题:${esc(themeSettingLabel())}(${base === 'light' ? '浅色基底' : '深色基底'})</span>
    <span class="spacer"></span>
    ${overriddenCount ? `<button class="btn sm danger" id="clib-reset-all">重置全部覆盖(${overriddenCount})</button>` : ''}
  `;
  panel.appendChild(toolbar);
  const searchEl = toolbar.querySelector('.clib-search');
  searchEl.addEventListener('input', () => {
    searchProject = searchEl.value;
    renderProjectTab(panel, rerender);
    const again = panel.querySelector('.clib-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  const resetAllBtn = toolbar.querySelector('#clib-reset-all');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      confirmDialog({
        title: '重置全部颜色覆盖',
        message: `将清除 <strong>${overriddenCount}</strong> 项颜色覆盖,全部恢复为当前主题默认配色。确定继续吗?`,
        danger: true,
        okText: '全部重置',
        onOk: () => {
          state.settings.colorOverrides = {};
          saveState();
          applyAppearance();
          toast('已恢复主题默认配色');
          rerender();
        },
      });
    });
  }

  const kw = searchProject.trim().toLowerCase();
  let shown = 0;
  for (const group of PROJECT_COLOR_CATALOG) {
    const colors = group.colors.filter((c) => {
      if (!kw) return true;
      const nameSet = base === 'light' && c.light ? c.light : c.dark;
      const hay = [c.label, c.varName, c.hex, nameSet && nameSet.cnName, nameSet && nameSet.enName, c.usage].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(kw);
    });
    if (!colors.length) continue;
    shown += colors.length;
    const sec = document.createElement('div');
    sec.className = 'clib-group';
    sec.innerHTML = `<div class="clib-group-title">${esc(group.name)}<span class="clib-group-count">${colors.length}</span></div>
      <div class="clib-group-desc">${esc(group.desc || '')}</div>`;
    const grid = document.createElement('div');
    grid.className = 'clib-grid';
    for (const c of colors) grid.appendChild(projectColorCard(c, group, base, ov, rerender));
    sec.appendChild(grid);
    panel.appendChild(sec);
  }
  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'clib-empty';
    empty.textContent = '没有匹配的颜色';
    panel.appendChild(empty);
  }
}

function projectColorCard(c, group, base, ov, rerender) {
  const isVar = !!c.key;
  const nameSet = (base === 'light' && c.light) ? c.light : c.dark;
  const hex = isVar ? (effectiveVarHex(c.varName) || (nameSet && nameSet.hex) || c.hex) : c.hex;
  const overridden = isVar && Object.prototype.hasOwnProperty.call(ov, c.key);

  const card = document.createElement('div');
  card.className = 'clib-card' + (overridden ? ' is-overridden' : '');
  const swatch = document.createElement('div');
  swatch.className = 'clib-swatch';
  swatch.style.background = hex;
  swatch.title = '点击复制 ' + hex;
  swatch.addEventListener('click', () => copyText(hex, '颜色值 ' + hex));
  card.appendChild(swatch);

  const main = document.createElement('div');
  main.className = 'clib-card-main';
  const titleRow = document.createElement('div');
  titleRow.className = 'clib-card-title';
  titleRow.innerHTML = `<span class="clib-card-label">${esc(c.label)}</span>
    ${c.varName ? `<code class="clib-card-var">${esc(c.varName)}</code>` : ''}
    ${overridden ? '<span class="clib-badge-ov" title="已被颜色库覆盖,非主题默认值">已覆盖</span>' : ''}`;
  main.appendChild(titleRow);

  const nameRow = document.createElement('div');
  nameRow.className = 'clib-card-names';
  nameRow.textContent = nameSet ? `${nameSet.cnName} / ${nameSet.enName}` : `${c.cnName} / ${c.enName}`;
  main.appendChild(nameRow);

  const vals = document.createElement('div');
  vals.className = 'clib-card-vals';
  vals.appendChild(valChip(hex, 'HEX'));
  vals.appendChild(valChip(fmtRgb(hex), 'RGB'));
  vals.appendChild(valChip(fmtHsl(hex), 'HSL'));
  main.appendChild(vals);

  if (c.usage) {
    const usage = document.createElement('div');
    usage.className = 'clib-card-usage';
    usage.textContent = '用途:' + c.usage;
    main.appendChild(usage);
  }

  const actions = document.createElement('div');
  actions.className = 'clib-card-actions';
  if (isVar) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn sm';
    editBtn.textContent = '✎ 编辑';
    editBtn.title = '修改该颜色并立即应用到整个应用界面';
    editBtn.addEventListener('click', () => {
      openColorEditor({
        title: `编辑 · ${c.label} ${c.varName}`,
        value: hex,
        hint: '确定后立即应用到界面(写入颜色覆盖,可在本页重置恢复)',
        onOk: (newHex) => {
          state.settings.colorOverrides = state.settings.colorOverrides || {};
          state.settings.colorOverrides[c.key] = newHex;
          saveState();
          applyAppearance();
          toast(`已应用:${c.label} = ${newHex}`);
          rerender();
        },
      });
    });
    actions.appendChild(editBtn);
  }
  if (overridden) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn sm ghost';
    resetBtn.textContent = '⤺ 重置';
    resetBtn.title = '清除覆盖,恢复主题默认';
    resetBtn.addEventListener('click', () => {
      delete state.settings.colorOverrides[c.key];
      saveState();
      applyAppearance();
      toast(`已重置:${c.label}`);
      rerender();
    });
    actions.appendChild(resetBtn);
  }
  const favBtn = document.createElement('button');
  favBtn.className = 'btn sm ghost';
  favBtn.textContent = '☆ 收藏';
  favBtn.title = '收藏到「我的收藏」分组';
  favBtn.addEventListener('click', () => quickFavorite(hex, nameSet ? nameSet.cnName : c.cnName, nameSet ? nameSet.enName : c.enName, c.usage, rerender));
  actions.appendChild(favBtn);
  main.appendChild(actions);

  card.appendChild(main);
  return card;
}

/** 快速收藏一个颜色(无分组时自动创建「默认收藏」);返回所属分组(已在分组中时返回 null) */
function quickFavorite(hex, cnName, enName, note, rerender) {
  const groups = state.settings.colorLibGroups || (state.settings.colorLibGroups = []);
  let g = groups.find((x) => x.id === curGroupId) || groups[0];
  if (!g) {
    g = { id: uid('clg'), name: '默认收藏', note: '', items: [] };
    groups.push(g);
    curGroupId = g.id;
  }
  if (g.items.some((it) => it.hex.toUpperCase() === hex.toUpperCase())) {
    toast('该颜色已在分组「' + g.name + '」中');
    return null;
  }
  g.items.push({ id: uid('clc'), name: cnName || '', nameEn: enName || '', hex: hexOf(hex), note: note || '', createdAt: now() });
  saveState();
  toast(`已收藏到「${g.name}」`);
  if (curTab === 'favorites') rerender();
  return g;
}

/**
 * 后台屏幕取色收藏(全局快捷键/托盘「屏幕取色收藏」→ 主进程 main:msg → ui.js 调到这里):
 * 加入当前选中分组(无分组时自动建「默认收藏」),并经主进程弹系统通知
 * (主窗口可能最小化/隐藏到托盘,页面内 toast 看不到)。
 */
export function backgroundPickToFavorites(hex) {
  const c = parseColor(hex);
  if (!c) return;
  const h = rgbToHex(c.r, c.g, c.b);
  const g = quickFavorite(h, '', '', '全局快捷键/托盘屏幕取色');
  if (window.api && typeof window.api.appNotify === 'function') {
    window.api.appNotify('屏幕取色收藏', g ? `已收藏 ${h} 到「${g.name}」` : `颜色 ${h} 已在分组中(未重复添加)`);
  }
}

/** 快捷键文本展示(空 → 「未设置」) */
function hotkeyLabel(acc) { return (acc && acc.trim()) ? acc.trim() : '未设置'; }

/** 打开「屏幕取色快捷键」设置对话框:校验 → 主进程注册(失败自动回滚)→ 保存设置 */
function openHotkeyDialog(rerender) {
  promptDialog({
    title: '屏幕取色快捷键(全局)',
    message: '主窗口最小化 / 隐藏到托盘时也可触发。格式:修饰键 + 主键,如 Ctrl+Alt+C、Ctrl+Alt+Shift+C、F9;留空 = 禁用。注意避开系统与其它软件占用的组合。',
    fields: [
      { key: 'copy', label: '取色并复制', type: 'text', value: state.settings.colorHotkey || '' },
      { key: 'fav', label: '取色并收藏', type: 'text', value: state.settings.colorHotkeyFav || '' },
    ],
    onOk: async (v) => {
      const clean = (s) => String(s || '').replace(/\s+/g, '');
      const copy = clean(v.copy);
      const fav = clean(v.fav);
      if (copy && copy === fav) { toast('两个快捷键不能相同', 'error'); return; }
      if (!(window.api && typeof window.api.setColorHotkeys === 'function')) {
        toast('当前环境不支持设置快捷键', 'error');
        return;
      }
      const r = await window.api.setColorHotkeys({ copy, fav });
      if (!r || !r.ok) {
        toast('快捷键注册失败:' + ((r && r.error) || '未知原因') + '(已保持原设置)', 'error');
        return;
      }
      state.settings.colorHotkey = copy;
      state.settings.colorHotkeyFav = fav;
      saveState();
      toast(`快捷键已生效:取色复制 ${hotkeyLabel(copy)} · 取色收藏 ${hotkeyLabel(fav)}`);
      if (rerender) rerender();
    },
  });
}

// ---------- 标签页 2:推荐配色 ----------

function renderRecommendTab(panel, rerender) {
  panel.innerHTML = ''; // 局部重渲染(搜索/类型筛选)前清空,避免内容叠加
  const types = ['all', ...new Set(RECOMMENDED_PALETTES.map((p) => p.typeName))];
  const toolbar = document.createElement('div');
  toolbar.className = 'clib-toolbar';
  toolbar.innerHTML = `
    <input type="text" class="clib-search" placeholder="搜索配色:名称 / 类型 / 颜色名…" value="${esc(searchPalette)}" />
    <select class="clib-select" id="clib-pal-type">
      ${types.map((t) => `<option value="${esc(t)}" ${t === paletteTypeFilter ? 'selected' : ''}>${t === 'all' ? '全部类型' : esc(t)}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <span class="clib-toolbar-hint">点击色块复制 HEX;「应用为主题」写入当前主题(${esc(themeSettingLabel())})</span>
  `;
  panel.appendChild(toolbar);
  const searchEl = toolbar.querySelector('.clib-search');
  searchEl.addEventListener('input', () => {
    searchPalette = searchEl.value;
    renderRecommendTab(panel, rerender);
    const again = panel.querySelector('.clib-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  toolbar.querySelector('#clib-pal-type').addEventListener('change', (e) => {
    paletteTypeFilter = e.target.value;
    renderRecommendTab(panel, rerender);
  });

  const kw = searchPalette.trim().toLowerCase();
  const list = RECOMMENDED_PALETTES.filter((p) => {
    if (paletteTypeFilter !== 'all' && p.typeName !== paletteTypeFilter) return false;
    if (!kw) return true;
    const hay = [p.name, p.nameEn, p.typeName, p.desc, ...p.colors.map((c) => c.cnName + ' ' + c.enName + ' ' + c.hex)].join(' ').toLowerCase();
    return hay.includes(kw);
  });

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'clib-empty';
    empty.textContent = '没有匹配的配色方案';
    panel.appendChild(empty);
    return;
  }

  for (const pal of list) panel.appendChild(paletteCard(pal, rerender));
}

function paletteCard(pal, rerender) {
  const card = document.createElement('div');
  card.className = 'clib-pal';
  const head = document.createElement('div');
  head.className = 'clib-pal-head';
  head.innerHTML = `
    <div class="clib-pal-name">${esc(pal.name)}<span class="clib-pal-en">${esc(pal.nameEn)}</span><span class="clib-pal-type">${esc(pal.typeName)}</span></div>
    <div class="clib-pal-desc">${esc(pal.desc)}</div>
  `;
  const headBtns = document.createElement('div');
  headBtns.className = 'clib-pal-btns';
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn sm primary';
  applyBtn.textContent = '✓ 应用为主题';
  applyBtn.title = `把整套配色写入当前主题(${themeSettingLabel()})并立即生效`;
  applyBtn.addEventListener('click', () => applyPaletteToTheme(pal, rerender));
  const favAllBtn = document.createElement('button');
  favAllBtn.className = 'btn sm ghost';
  favAllBtn.textContent = '☆ 收藏整组';
  favAllBtn.title = '整套配色收藏到「我的收藏」';
  favAllBtn.addEventListener('click', () => {
    const groups = state.settings.colorLibGroups || (state.settings.colorLibGroups = []);
    let g = groups.find((x) => x.id === curGroupId) || groups[0];
    if (!g) { g = { id: uid('clg'), name: '默认收藏', note: '', items: [] }; groups.push(g); curGroupId = g.id; }
    for (const c of pal.colors) {
      if (!g.items.some((it) => it.hex.toUpperCase() === c.hex.toUpperCase())) {
        g.items.push({ id: uid('clc'), name: c.cnName || '', nameEn: c.enName || '', hex: c.hex, note: `${pal.name} · ${c.usage || ''}`, createdAt: now() });
      }
    }
    saveState();
    toast(`已把「${pal.name}」整组收藏到「${g.name}」(${pal.colors.length} 色)`);
    if (curTab === 'favorites') rerender();
  });
  headBtns.appendChild(applyBtn);
  headBtns.appendChild(favAllBtn);
  head.appendChild(headBtns);
  card.appendChild(head);

  // 色带(点击复制)
  const strip = document.createElement('div');
  strip.className = 'clib-pal-strip';
  for (const c of pal.colors) {
    const blk = document.createElement('span');
    blk.className = 'clib-pal-blk';
    blk.style.background = c.hex;
    blk.style.color = contrastText(c.hex);
    blk.innerHTML = `<i class="blk-name" title="${esc(c.cnName + ' / ' + c.enName)}">${esc(c.cnName)}</i>`;
    blk.title = `${c.cnName} / ${c.enName}\n${c.hex} · ${fmtRgb(c.hex)} · ${fmtHsl(c.hex)}\n${c.usage || ''}\n点击复制 HEX`;
    blk.addEventListener('click', () => copyText(c.hex, '颜色值 ' + c.hex));
    strip.appendChild(blk);
  }
  card.appendChild(strip);

  // 明细(折叠)
  const details = document.createElement('details');
  details.className = 'clib-pal-detail';
  details.innerHTML = `<summary>展开 ${pal.colors.length} 色明细(数值 / 名称 / 用途)</summary>`;
  const grid = document.createElement('div');
  grid.className = 'clib-grid';
  for (const c of pal.colors) {
    const item = document.createElement('div');
    item.className = 'clib-card';
    const swatch = document.createElement('div');
    swatch.className = 'clib-swatch';
    swatch.style.background = c.hex;
    swatch.title = '点击复制 ' + c.hex;
    swatch.addEventListener('click', () => copyText(c.hex, '颜色值 ' + c.hex));
    item.appendChild(swatch);
    const mainEl = document.createElement('div');
    mainEl.className = 'clib-card-main';
    mainEl.innerHTML = `
      <div class="clib-card-title"><span class="clib-card-label">${esc(c.cnName)}</span><code class="clib-card-var">${esc(String(c.role || ''))}</code></div>
      <div class="clib-card-names">${esc(c.enName)} · 角色:${esc(c.role || '-')}</div>`;
    const vals = document.createElement('div');
    vals.className = 'clib-card-vals';
    vals.appendChild(valChip(c.hex, 'HEX'));
    vals.appendChild(valChip(fmtRgb(c.hex), 'RGB'));
    vals.appendChild(valChip(fmtHsl(c.hex), 'HSL'));
    mainEl.appendChild(vals);
    if (c.usage) {
      const usage = document.createElement('div');
      usage.className = 'clib-card-usage';
      usage.textContent = '用途:' + c.usage;
      mainEl.appendChild(usage);
    }
    const acts = document.createElement('div');
    acts.className = 'clib-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn sm ghost';
    editBtn.textContent = '🎨 编辑此色';
    editBtn.title = '在颜色编辑器中打开(SV 面板 / HEX / RGB / HSL / 屏幕取色)';
    editBtn.addEventListener('click', () => openColorEditor({ title: `编辑 · ${c.cnName}`, value: c.hex, hint: c.usage, onOk: () => {} }));
    const favBtn = document.createElement('button');
    favBtn.className = 'btn sm ghost';
    favBtn.textContent = '☆ 收藏';
    favBtn.addEventListener('click', () => quickFavorite(c.hex, c.cnName, c.enName, `${pal.name} · ${c.usage || ''}`, rerender));
    acts.appendChild(editBtn);
    acts.appendChild(favBtn);
    mainEl.appendChild(acts);
    item.appendChild(mainEl);
    grid.appendChild(item);
  }
  details.appendChild(grid);
  card.appendChild(details);
  return card;
}

/** 推荐配色 → 写入当前主题设置 + 颜色覆盖,立即生效 */
function applyPaletteToTheme(pal, rerender) {
  const themeKey = resolvedThemeName();
  const defaults = { accent: '', bgColor: '', fgColor: '', bgImage: '', bgImageOn: false, panelBg: '', menuBg: '', btnBg: '', hoverBg: '', borderColor: '' };
  const t = Object.assign(defaults, state.settings.themes[themeKey] || {});
  state.settings.themes[themeKey] = t;
  const ov = state.settings.colorOverrides || (state.settings.colorOverrides = {});
  // 主题设置可承载的角色(系统设置「外观」同一套字段)
  const themeMap = { accent: 'accent', bg: 'bgColor', text: 'fgColor', bg2: 'panelBg', bg3: 'menuBg', bg4: 'hoverBg', border: 'borderColor' };
  let cleared = 0;
  // 先清掉与这套配色相关的旧覆盖,避免旧值残留
  for (const c of pal.colors) {
    if (c.role && Object.prototype.hasOwnProperty.call(ov, c.role)) { delete ov[c.role]; cleared++; }
  }
  for (const c of pal.colors) {
    if (!c.role) continue;
    if (themeMap[c.role]) t[themeMap[c.role]] = c.hex;
    else ov[c.role] = c.hex; // tree-line / text2 / text3 / accent2 / danger / ok
  }
  t.btnBg = t.menuBg; // 按钮默认底跟随菜单/卡片底
  saveState();
  applyAppearance();
  toast(`已应用「${pal.name}」为当前主题配色(${pal.colors.length} 色${cleared ? ',清除 ' + cleared + ' 项旧覆盖' : ''})`);
  if (curTab === 'project') rerender();
}

// ---------- 标签页 3:我的收藏 ----------

function favGroups() {
  if (!Array.isArray(state.settings.colorLibGroups)) state.settings.colorLibGroups = [];
  return state.settings.colorLibGroups;
}

/** 编辑分组(改名/备注)——工具栏按钮与分组右键菜单共用 */
function renameGroupFlow(g, rerender) {
  promptDialog({
    title: '修改分组',
    fields: [
      { key: 'name', label: '分组名称', type: 'text', value: g.name },
      { key: 'note', label: '备注', type: 'text', value: g.note || '' },
    ],
    onOk: (v) => {
      const name = (v.name || '').trim();
      if (!name) { toast('分组名称不能为空', 'error'); return; }
      g.name = name;
      g.note = (v.note || '').trim();
      saveState();
      rerender();
    },
  });
}

/** 删除分组(带确认)——工具栏按钮与分组右键菜单共用 */
function deleteGroupFlow(g, rerender) {
  confirmDialog({
    title: '删除收藏分组',
    message: `确定删除分组 <strong>${esc(g.name)}</strong> 及其中 <strong>${g.items.length}</strong> 个颜色吗?此操作不可恢复。`,
    danger: true,
    okText: '删除',
    onOk: () => {
      state.settings.colorLibGroups = favGroups().filter((x) => x.id !== g.id);
      curGroupId = state.settings.colorLibGroups.length ? state.settings.colorLibGroups[0].id : null;
      saveState();
      toast(`已删除分组「${g.name}」`);
      rerender();
    },
  });
}

function renderFavoritesTab(panel, rerender) {
  panel.innerHTML = ''; // 局部重渲染(切换分组)前清空,避免新旧分组内容叠加
  const groups = favGroups();
  if (!groups.find((g) => g.id === curGroupId)) curGroupId = groups.length ? groups[0].id : null;

  const wrap = document.createElement('div');
  wrap.className = 'clib-fav';

  // 左侧分组列表
  const side = document.createElement('div');
  side.className = 'clib-fav-side';
  const sideTitle = document.createElement('div');
  sideTitle.className = 'clib-fav-side-title';
  sideTitle.textContent = '收藏分组';
  side.appendChild(sideTitle);
  const listEl = document.createElement('div');
  listEl.className = 'clib-fav-list';
  if (!groups.length) {
    const hint = document.createElement('div');
    hint.className = 'clib-fav-hint';
    hint.textContent = '还没有分组。点击下方「＋ 新建分组」创建一个,再往里添加颜色。';
    listEl.appendChild(hint);
  }
  for (const g of groups) {
    const item = document.createElement('button');
    item.className = 'clib-fav-item' + (g.id === curGroupId ? ' active' : '');
    const strip = document.createElement('span');
    strip.className = 'clib-fav-item-strip';
    // 分组条:最多取前 7 个颜色做小色带
    for (const it of g.items.slice(0, 7)) {
      const s = document.createElement('i');
      s.style.background = it.hex;
      strip.appendChild(s);
    }
    if (!g.items.length) strip.classList.add('empty');
    item.appendChild(strip);
    const nm = document.createElement('span');
    nm.className = 'clib-fav-item-name';
    nm.textContent = g.name;
    item.appendChild(nm);
    const ct = document.createElement('span');
    ct.className = 'clib-fav-item-count';
    ct.textContent = g.items.length;
    item.appendChild(ct);
    item.title = (g.note ? `${g.name} · ${g.note}` : g.name) + '\n左键切换 · 右键 编辑/删除';
    item.addEventListener('click', () => { curGroupId = g.id; renderFavoritesTab(panel, rerender); });
    // 右键:编辑(改名/备注)/ 删除分组
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: '✎ 编辑分组(改名 / 备注)', onClick: () => { curGroupId = g.id; renameGroupFlow(g, rerender); } },
        { label: '🗑 删除分组' + (g.items.length ? `(${g.items.length} 色)` : ''), danger: true, onClick: () => { curGroupId = g.id; deleteGroupFlow(g, rerender); } },
      ]);
    });
    listEl.appendChild(item);
  }
  side.appendChild(listEl);
  const addGroupBtn = document.createElement('button');
  addGroupBtn.className = 'btn sm clib-fav-add';
  addGroupBtn.textContent = '＋ 新建分组';
  addGroupBtn.addEventListener('click', () => {
    promptDialog({
      title: '新建收藏分组',
      fields: [
        { key: 'name', label: '分组名称', type: 'text', value: '' },
        { key: 'note', label: '备注', type: 'text', value: '' },
      ],
      onOk: (v) => {
        const name = (v.name || '').trim();
        if (!name) { toast('分组名称不能为空', 'error'); return; }
        const g = { id: uid('clg'), name, note: (v.note || '').trim(), items: [] };
        favGroups().push(g);
        curGroupId = g.id;
        saveState();
        toast(`已创建分组「${name}」`);
        rerender();
      },
    });
  });
  side.appendChild(addGroupBtn);
  wrap.appendChild(side);

  // 右侧当前分组
  const mainEl = document.createElement('div');
  mainEl.className = 'clib-fav-main';
  const g = groups.find((x) => x.id === curGroupId);
  if (!g) {
    const empty = document.createElement('div');
    empty.className = 'clib-empty';
    empty.innerHTML = `还没有可显示的分组。<button class="btn sm" id="clib-fav-create2">＋ 新建分组</button>`;
    mainEl.appendChild(empty);
    wrap.appendChild(mainEl);
    panel.appendChild(wrap);
    const b2 = empty.querySelector('#clib-fav-create2');
    if (b2) b2.addEventListener('click', () => addGroupBtn.click());
    return;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'clib-toolbar';
  toolbar.innerHTML = `
    <span class="clib-fav-gname">${esc(g.name)}</span>
    ${g.note ? `<span class="clib-fav-gnote" title="${esc(g.note)}">${esc(g.note)}</span>` : ''}
    <span class="spacer"></span>
    <button class="btn sm" id="cf-add">＋ 添加颜色</button>
    <button class="btn sm" id="cf-pick" title="全屏取色后直接加入本分组">📷 屏幕取色收藏</button>
    <button class="btn sm ghost" id="cf-hotkey" title="设置屏幕取色全局快捷键(主窗口最小化/隐藏到托盘也可触发)">⚡ 快捷键:<span class="clib-hk">${esc(hotkeyLabel(state.settings.colorHotkey))}</span>/<span class="clib-hk">${esc(hotkeyLabel(state.settings.colorHotkeyFav))}</span></button>
    <button class="btn sm ghost" id="cf-rename">✎ 改名/备注</button>
    <button class="btn sm ghost" id="cf-export" title="复制全部颜色 HEX(逗号分隔)">⧉ 复制全部</button>
    <button class="btn sm danger" id="cf-del-group">🗑 删除分组</button>
  `;
  mainEl.appendChild(toolbar);
  toolbar.querySelector('#cf-hotkey').addEventListener('click', () => openHotkeyDialog(rerender));

  toolbar.querySelector('#cf-add').addEventListener('click', () => {
    openColorFormDialog({
      title: `添加颜色到「${g.name}」`,
      onOk: (v) => {
        if (g.items.some((it) => it.hex.toUpperCase() === v.hex.toUpperCase())) {
          toast('该颜色已在分组中');
          return;
        }
        g.items.push({ id: uid('clc'), name: v.name, nameEn: v.nameEn, hex: v.hex, note: v.note, createdAt: now() });
        saveState();
        toast(`已添加 ${v.hex} 到「${g.name}」`);
        rerender();
      },
    });
  });
  toolbar.querySelector('#cf-pick').addEventListener('click', async () => {
    const hex = await pickScreenColor();
    if (!hex) return;
    openColorFormDialog({
      title: `取色 ${hex} → 收藏到「${g.name}」`,
      value: { hex },
      onOk: (v) => {
        if (g.items.some((it) => it.hex.toUpperCase() === v.hex.toUpperCase())) {
          toast('该颜色已在分组中');
          return;
        }
        g.items.push({ id: uid('clc'), name: v.name, nameEn: v.nameEn, hex: v.hex, note: v.note, createdAt: now() });
        saveState();
        toast(`已收藏 ${v.hex}`);
        rerender();
      },
    });
  });
  toolbar.querySelector('#cf-rename').addEventListener('click', () => renameGroupFlow(g, rerender));
  toolbar.querySelector('#cf-export').addEventListener('click', () => {
    if (!g.items.length) { toast('分组内还没有颜色', 'error'); return; }
    copyText(g.items.map((it) => it.hex).join(', '), '全部颜色 HEX');
  });
  toolbar.querySelector('#cf-del-group').addEventListener('click', () => deleteGroupFlow(g, rerender));

  if (!g.items.length) {
    const empty = document.createElement('div');
    empty.className = 'clib-empty';
    empty.textContent = '分组内还没有颜色:点击「＋ 添加颜色」或「📷 屏幕取色收藏」,也可在 项目配色 / 推荐配色 页点「☆ 收藏」。';
    mainEl.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'clib-grid';
    for (const it of g.items) grid.appendChild(favColorCard(it, g, rerender));
    mainEl.appendChild(grid);
  }
  wrap.appendChild(mainEl);
  panel.appendChild(wrap);
}

function favColorCard(it, g, rerender) {
  const card = document.createElement('div');
  card.className = 'clib-card';
  const swatch = document.createElement('div');
  swatch.className = 'clib-swatch';
  swatch.style.background = it.hex;
  swatch.title = '点击复制 ' + it.hex;
  swatch.addEventListener('click', () => copyText(it.hex, '颜色值 ' + it.hex));
  card.appendChild(swatch);

  const main = document.createElement('div');
  main.className = 'clib-card-main';
  main.innerHTML = `
    <div class="clib-card-title"><span class="clib-card-label">${esc(it.name || '未命名颜色')}</span></div>
    <div class="clib-card-names">${esc(it.nameEn || '')}</div>`;
  const vals = document.createElement('div');
  vals.className = 'clib-card-vals';
  vals.appendChild(valChip(it.hex, 'HEX'));
  vals.appendChild(valChip(fmtRgb(it.hex), 'RGB'));
  vals.appendChild(valChip(fmtHsl(it.hex), 'HSL'));
  main.appendChild(vals);
  if (it.note) {
    const usage = document.createElement('div');
    usage.className = 'clib-card-usage';
    usage.textContent = '备注:' + it.note;
    main.appendChild(usage);
  }
  const acts = document.createElement('div');
  acts.className = 'clib-card-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn sm';
  editBtn.textContent = '✎ 编辑';
  editBtn.addEventListener('click', () => {
    openColorFormDialog({
      title: '编辑收藏颜色',
      value: { hex: it.hex, name: it.name, nameEn: it.nameEn, note: it.note },
      onOk: (v) => {
        it.hex = v.hex; it.name = v.name; it.nameEn = v.nameEn; it.note = v.note;
        saveState();
        rerender();
      },
    });
  });
  const delBtn = document.createElement('button');
  delBtn.className = 'btn sm danger';
  delBtn.textContent = '🗑 删除';
  delBtn.addEventListener('click', () => {
    confirmDialog({
      title: '删除收藏颜色',
      message: `确定从「${esc(g.name)}」删除 <strong>${esc(it.name || it.hex)}</strong>(${esc(it.hex)})吗?`,
      danger: true,
      okText: '删除',
      onOk: () => {
        g.items = g.items.filter((x) => x.id !== it.id);
        saveState();
        rerender();
      },
    });
  });
  acts.appendChild(editBtn);
  acts.appendChild(delBtn);
  main.appendChild(acts);
  card.appendChild(main);
  return card;
}
