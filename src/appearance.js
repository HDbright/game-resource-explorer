// ============ 外观设置(主题 / 字体字号 / 背景) 应用逻辑 ============
// 该模块只依赖 state.js,供 ui.js(启动应用)与 settingsPage.js(设置页实时预览)共用,
// 不反向依赖 ui / settingsPage,避免循环引用。

import { state } from './state.js';

let themeMediaHandler = null;

// 颜色选择库已应用的覆盖键(键为 CSS 变量名,不含 -- 前缀)。
// 记录上一轮应用过的键,某键被重置(删除)时才能 removeProperty 恢复主题默认。
let appliedColorOverrides = new Set();

// 各主题的默认强调色 / 背景色 / 前景色(控件「恢复默认」与空值兜底用)
const THEME_DEFAULTS = {
  dark:   { accent: '#4f8cff', bgColor: '#1b1d23', fgColor: '#e6e8ee', panelBg: '#22242b', menuBg: '#2a2d36', btnBg: '#2a2d36', hoverBg: '#333642', borderColor: '#343845', inputBg: '#2a2d36', menuActiveText: '#ffffff', text2: '#9aa1b2', text3: '#6f7686' },
  light:  { accent: '#2f6fe0', bgColor: '#f3f4f7', fgColor: '#1f2329', panelBg: '#ffffff', menuBg: '#e8eaef', btnBg: '#e8eaef', hoverBg: '#e8e8e8', borderColor: '#d2d6df', inputBg: '#f0f1f4', menuActiveText: '#1a1a2e', text2: '#6b7280', text3: '#9aa1ad' },
  custom: { accent: '#4f8cff', bgColor: '#1b1d23', fgColor: '#e6e8ee', panelBg: '#22242b', menuBg: '#2a2d36', btnBg: '#2a2d36', hoverBg: '#333642', borderColor: '#343845', inputBg: '#2a2d36', menuActiveText: '#ffffff', text2: '#9aa1b2', text3: '#6f7686' },
};

// 解析当前选中的主题名(dark/light/custom;system 按系统配色映射为 dark/light)
function resolveThemeName(s) {
  let t = s.theme || 'dark';
  if (t === 'system') {
    t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  if (t === 'light') return 'light';
  if (t === 'custom') return 'custom';
  return 'dark';
}

// 读取某主题的完整配置(空字段回退到对应主题默认)
function themeConfig(s, name) {
  const themes = (s && s.themes) || {};
  const cfg = themes[name] || {};
  const def = THEME_DEFAULTS[name] || THEME_DEFAULTS.dark;
  return {
    accent: cfg.accent || def.accent,
    bgColor: cfg.bgColor || def.bgColor,
    fgColor: cfg.fgColor || def.fgColor,
    bgImage: cfg.bgImage || '',
    bgImageOn: !!cfg.bgImageOn,
    panelBg: cfg.panelBg || def.panelBg,
    menuBg: cfg.menuBg || def.menuBg,
    btnBg: cfg.btnBg || def.btnBg,
    hoverBg: cfg.hoverBg || def.hoverBg,
    borderColor: cfg.borderColor || def.borderColor,
    inputBg: cfg.inputBg || def.inputBg,
    menuActiveText: cfg.menuActiveText || def.menuActiveText,
    text2: cfg.text2 || def.text2,
    text3: cfg.text3 || def.text3,
  };
}

// 粗略判断颜色是否偏亮(用于自定义主题决定浅/深基底)
function isLightColor(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/**
 * 将当前 state.settings 中的外观设置应用到整个渲染进程界面。
 * 深色 / 浅色 / 自定义 三种主题各自独立保存强调色 / 背景色 / 前景色 / 背景图。
 * - 主题基底:custom 按其背景色亮度自动选 light/dark 基底变量
 * - 字体字号: #app 的 zoom(整体缩放,含字号与布局)
 */
export function applyAppearance() {
  const s = state.settings || {};
  const name = resolveThemeName(s);
  const t = themeConfig(s, name);
  const root = document.documentElement;

  // 颜色选择库覆盖清理(必须在主题变量 setProperty 之前):
  // 上一轮应用过、本轮已重置(删除)的覆盖键先移除内联属性,
  // 随后主题变量与新一轮覆盖会重新写入,避免 removeProperty 连带清掉主题内联值。
  const overridesEarly = (s && s.colorOverrides) || {};
  for (const key of appliedColorOverrides) {
    if (!(key in overridesEarly)) root.style.removeProperty('--' + key);
  }

  // 基底调色板:custom 用背景色亮度决定浅/深基底,使自定义主题整体协调
  let base = name;
  if (name === 'custom') base = isLightColor(t.bgColor) ? 'light' : 'dark';
  root.dataset.theme = base;

  // 字体字号缩放
  const scale = parseFloat(s.fontScale);
  const app = document.getElementById('app');
  if (app) app.style.zoom = (Number.isFinite(scale) && scale > 0) ? String(scale) : '1';

  // 字重 / 字体族
  const fw = parseInt(s.fontWeight, 10);
  root.style.setProperty('--fw', (Number.isFinite(fw) && fw >= 400 && fw <= 700) ? fw : 400);
  const ff = String(s.fontFamily || '').trim();
  if (ff) root.style.setProperty('--font', ff);
  else root.style.removeProperty('--font');

  // 强调色 / 背景色 / 前景色(始终按该主题配置生效;空则回退主题默认)
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent2', t.accent);
  root.style.setProperty('--bg', t.bgColor);
  root.style.setProperty('--text', t.fgColor);
  // 模块/面板背景(--bg2)、菜单/卡片背景(--bg3)、悬停高亮(--bg4)、边框(--border)、按钮背景(--btn-bg)
  root.style.setProperty('--bg1', t.bgColor);
  root.style.setProperty('--bg2', t.panelBg);
  root.style.setProperty('--bg3', t.menuBg);
  root.style.setProperty('--bg4', t.hoverBg);
  root.style.setProperty('--border', t.borderColor);
  root.style.setProperty('--btn-bg', t.btnBg);
  root.style.setProperty('--input-bg', t.inputBg);
  root.style.setProperty('--menu-active-text', t.menuActiveText);
  root.style.setProperty('--text2', t.text2);
  root.style.setProperty('--text3', t.text3);

  // 颜色选择库覆盖(资源工具箱「颜色选择库」):在主题变量之后应用,优先级最高。
  // 键 = CSS 变量名(不含 -- 前缀,如 'accent' / 'bg2' / 'danger'),值 = #rrggbb;
  // 重置(删除键)时在本函数开头 removeProperty,再由上面的主题变量写回默认。非颜色变量(radius/font 等)数据层已过滤,这里再校验一次。
  const overrides = overridesEarly;
  const hexRe = /^#[0-9a-fA-F]{3,8}$/;
  appliedColorOverrides = new Set();
  for (const [key, val] of Object.entries(overrides)) {
    const v = typeof val === 'string' ? val.trim() : '';
    if (!v || !hexRe.test(v)) continue;
    root.style.setProperty('--' + String(key).replace(/^-+/, ''), v);
    appliedColorOverrides.add(key);
  }

  // 背景图(设置到 body,cover 铺满)
  const body = document.body;
  if (t.bgImageOn && t.bgImage) {
    const fileUrl = 'url("file:///' + String(t.bgImage).replace(/\\/g, '/').replace(/"/g, '\\"') + '")';
    body.style.backgroundImage = fileUrl;
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundRepeat = 'no-repeat';
    body.style.backgroundAttachment = 'fixed';
  } else {
    body.style.backgroundImage = '';
    body.style.backgroundSize = '';
    body.style.backgroundPosition = '';
    body.style.backgroundRepeat = '';
    body.style.backgroundAttachment = '';
  }
}

/** 注册「跟随系统」主题监听(只注册一次),系统主题切换且当前为 system 时实时应用 */
export function setupSystemThemeListener() {
  if (themeMediaHandler) return;
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  themeMediaHandler = () => {
    const s = state.settings || {};
    if ((s.theme || 'dark') === 'system') applyAppearance();
  };
  if (mq.addEventListener) mq.addEventListener('change', themeMediaHandler);
  else if (mq.addListener) mq.addListener(themeMediaHandler);
}
