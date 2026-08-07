// ============ 可复制路径辅助 ============
// 统一的「文本可选中 + 点击直接复制」组件,供属性窗口 / 预览页文件地址等复用。
import { toast } from './dialogs.js';

/**
 * 复制文本到剪贴板。
 * 优先用 navigator.clipboard(安全上下文,如 http://localhost);
 * 不可用时回退到临时 textarea + execCommand('copy')(Electron 渲染进程兼容)。
 * @param {string} text
 */
export function copyText(text) {
  const t = String(text == null ? '' : text);
  const ok = () => toast('已复制路径', 'ok');
  const fail = () => toast('复制失败', 'error');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(t).then(ok, () => (fallbackCopy(t) ? ok() : fail()));
  } else if (!fallbackCopy(t)) {
    fail();
  } else {
    ok();
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const r = document.execCommand('copy');
    document.body.removeChild(ta);
    return r;
  } catch (err) {
    return false;
  }
}

/**
 * 生成一个「可复制路径」元素:文本可手动选中(Ctrl+C),右侧 ⧉ 按钮点击直接复制。
 * @param {string} value 要复制的完整文本
 * @param {{mono?:boolean, wrap?:boolean}} [opts] mono=等宽字体; wrap=长路径换行(便于选中)
 * @returns {HTMLSpanElement}
 */
export function makeCopyablePath(value, { mono = true, wrap = false } = {}) {
  const wrapEl = document.createElement('span');
  wrapEl.className = 'copyable-path' + (mono ? ' copy-mono' : '') + (wrap ? ' copy-wrap' : '');

  const txt = document.createElement('span');
  txt.className = 'cp-text';
  txt.textContent = value;
  txt.title = '点击右侧按钮复制:' + value;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cp-copy';
  btn.textContent = '⧉';
  btn.title = '复制路径';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    copyText(value);
  });

  wrapEl.appendChild(txt);
  wrapEl.appendChild(btn);
  return wrapEl;
}

/**
 * 把已有元素(如 #pv-path / #audio-path)内容替换为可复制路径。
 * @param {HTMLElement|null} el
 * @param {string} value
 */
export function setCopyablePath(el, value) {
  if (!el) return;
  el.textContent = '';
  el.appendChild(makeCopyablePath(value));
}
