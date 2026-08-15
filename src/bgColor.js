import { state, setSetting } from './state.js';

/** 深色判断:亮度阈值下用白字,否则黑字 */
export function isDarkColor(hex) {
  const c = parseInt(String(hex || '').replace('#', ''), 16);
  if (isNaN(c)) return true;
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) < 160;
}

export const BG_DARK = '#22242b';
export const BG_LIGHT = '#c9ccd3'; // 浅灰(动画/图片/FGUI 预览页「浅」按钮的颜色)
export const CUSTOM_BG_KEY = 'customBgColor';

/** 当前自定义背景色 */
export function customBgColor() {
  return (state.settings && state.settings[CUSTOM_BG_KEY]) || '#3a4150';
}

/**
 * 背景色控制条统一逻辑(动画 / 图片 / FGUI 三处共用):
 * - 调色盘(input type=color)选色立即生效
 * - 「深」「浅」按钮:背景 = 对应颜色,文字与背景反色
 * - 「自定义」按钮:背景 = 已保存的自定义颜色,文字反色;点击应用自定义色
 * - 「保存」按钮:把调色盘当前颜色保存为自定义颜色(settings.customBgColor)
 * @param {object} opts
 *   - input / darkBtn / lightBtn / customBtn / saveBtn: 对应 DOM
 *   - onApply(hex): 应用背景色(调用方负责设置渲染器 + 持久化模块自己的设置键)
 */
export function initBgColorBar({ input, darkBtn, lightBtn, customBtn, saveBtn, onApply, dark = BG_DARK, light = BG_LIGHT }) {
  const paint = (btn, hex, border = 'transparent') => {
    if (!btn) return;
    btn.style.background = hex;
    btn.style.color = isDarkColor(hex) ? '#fff' : '#111';
    btn.style.borderColor = border;
  };
  const syncButtons = () => {
    // 「深」按钮保留与「存」按钮一致的浅色边框线(同 .btn 默认 var(--border)),
    // 在深色背景上能看清按钮轮廓,「浅」「自定义」按钮透明边框即可
    paint(darkBtn, dark, 'var(--border)');
    paint(lightBtn, light);
    paint(customBtn, customBgColor());
  };
  if (input) {
    input.addEventListener('input', () => {
      if (onApply) onApply(input.value);
      syncButtons();
    });
  }
  if (darkBtn) darkBtn.addEventListener('click', () => {
    if (input) input.value = dark;
    if (onApply) onApply(dark);
    syncButtons();
  });
  if (lightBtn) lightBtn.addEventListener('click', () => {
    if (input) input.value = light;
    if (onApply) onApply(light);
    syncButtons();
  });
  if (customBtn) customBtn.addEventListener('click', () => {
    const c = customBgColor();
    if (input) input.value = c;
    if (onApply) onApply(c);
    syncButtons();
  });
  if (saveBtn) saveBtn.addEventListener('click', () => {
    if (!input) return;
    const c = input.value || '#3a4150';
    setSetting(CUSTOM_BG_KEY, c);
    syncButtons();
    // 保存即生效
    if (onApply) onApply(c);
  });
  syncButtons();
}
