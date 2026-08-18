'use strict';
/**
 * HTML 查看 / 编辑器(参考 Markdown 编辑器的分栏编辑体验)。
 * - 工具栏:打开 / 保存 / 分栏 / 仅预览 / 仅编辑 切换、复制源码、加入库
 * - 编辑区 textarea + 预览区 iframe 渲染(直接渲染 HTML,支持脚本/样式)
 * - 预览时自动注入 <base> 指向源文件目录,使相对路径的图片/CSS 等资源可正确加载
 * - load(filePath) 读取文件 → 编辑 / 保存回写原文件
 */
import { state, addItem, categoryPath } from '../state.js';
import { openModal, footButtons, toast } from '../dialogs.js';
import { b64ToText } from './markdownEditor.js';

const HTML_EXTS = ['.html', '.htm', '.xhtml'];

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&"']/g, (c) => ({ '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
/** 由文件路径得到目录的 file:// URL(用于 iframe <base> 解析相对资源) */
function dirFileUrl(filePath) {
  const dir = String(filePath || '').replace(/[\\/][^\\/]*$/, '');
  if (!dir) return '';
  return 'file:///' + dir.replace(/\\/g, '/');
}

export class HtmlEditorController {
  constructor() {
    this.wrap = null;
    this.filePath = null;
    this.statusEl = null;
    this.ta = null;
    this.preview = null;
    this.mode = 'split'; // split | preview | edit
    this.previewToken = null; // html:previewRegister 返回的目录 token(同源 http 加载相对资源)
    this.previewBase = ''; // <base href>(同源 http://host/html-pv/<token>/),优先于 file://
  }

  init(wrap) {
    this.wrap = wrap;
    this.statusEl = wrap.querySelector('#html-status');
    this.ta = wrap.querySelector('#html-edit');
    this.preview = wrap.querySelector('#html-preview');

    wrap.querySelector('#html-open').addEventListener('click', () => this.pickAndLoad());
    wrap.querySelector('#html-save').addEventListener('click', () => this.save());
    wrap.querySelector('#html-add-lib').addEventListener('click', () => this.addToLibrary());
    wrap.querySelector('#html-mode-split').addEventListener('click', () => this.setMode('split'));
    wrap.querySelector('#html-mode-preview').addEventListener('click', () => this.setMode('preview'));
    wrap.querySelector('#html-mode-edit').addEventListener('click', () => this.setMode('edit'));
    wrap.querySelector('#html-copy').addEventListener('click', () => this.copySource());

    // 编辑输入 → 防抖刷新预览(预览/分栏模式)
    let to = null;
    this.ta.addEventListener('input', () => {
      clearTimeout(to);
      to = setTimeout(() => this.renderPreview(), 250);
    });
    // Ctrl+S 保存
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save();
      }
    });
  }

  /** 打开文件对话框选择 html → 加载 */
  async pickAndLoad() {
    try {
      const r = await window.api.pickFiles({
        title: '打开 HTML 文档',
        directory: false,
        filters: [{ name: 'HTML', extensions: ['html', 'htm', 'xhtml', 'txt'] }],
      });
      if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return;
      await this.load(r.filePaths[0]);
    } catch (e) {
      this.setStatus('打开失败: ' + e.message, true);
    }
  }

  /** 加载指定文件(读文本) */
  async load(filePath) {
    const r = await window.api.readBase64(filePath);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取失败');
    const text = b64ToText(String(r.dataUrl || ''));
    this.filePath = filePath;
    // 注册文件所在目录到内部 http 服务,预览时 <base> 指向同源 http://host/html-pv/<token>/
    // 使相对 CSS/JS/图片 经 http 加载(规避 file:// 被 webSecurity 拦截导致的空白/破版)
    await this.registerPreviewRoot(filePath);
    this.ta.value = text;
    this.renderPreview();
    const nm = String(filePath).split(/[\\/]/).pop();
    const nameEl = this.wrap.querySelector('#html-name');
    if (nameEl) nameEl.textContent = nm;
    this.setStatus('已打开 ' + nm);
    return text;
  }

  /** 注册目录到内部服务(返回 token),失败则回退到 file:// base(仅内联内容可渲染) */
  async registerPreviewRoot(filePath) {
    // 切换文件时先注销旧 token,避免 htmlRoots 无限增长
    if (this.previewToken) {
      try { await window.api.htmlPreviewUnregister({ token: this.previewToken }); } catch (e) { /* ignore */ }
      this.previewToken = null;
      this.previewBase = '';
    }
    const dir = String(filePath || '').replace(/[\\/][^\\/]*$/, '');
    if (!dir) return;
    try {
      const res = await window.api.htmlPreviewRegister({ dir });
      if (res && res.ok && res.token) {
        this.previewToken = res.token;
        // 渲染端 origin 即内部服务地址(http://host:port),同源 → webSecurity 放行
        const origin = (location && location.origin) || '';
        this.previewBase = origin ? origin + '/html-pv/' + res.token + '/' : '';
      }
    } catch (e) {
      this.previewToken = null;
      this.previewBase = '';
    }
  }

  /** 保存回写原文件(UTF-8) */
  async save() {
    if (!this.filePath) {
      this.setStatus('尚未打开文件', true);
      return;
    }
    try {
      const text = this.ta.value;
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const r = await window.api.writeFileBase64(this.filePath, 'data:text/plain;base64,' + b64);
      if (!r || !r.ok) throw new Error((r && r.error) || '写入失败');
      this.setStatus('已保存 ' + new Date().toLocaleTimeString());
    } catch (e) {
      this.setStatus('保存失败: ' + e.message, true);
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.wrap.querySelectorAll('.html-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const editCol = this.wrap.querySelector('#html-edit-col');
    const pvCol = this.wrap.querySelector('#html-preview-col');
    if (mode === 'edit') {
      editCol.style.display = '';
      pvCol.style.display = 'none';
    } else if (mode === 'preview') {
      editCol.style.display = 'none';
      pvCol.style.display = '';
    } else {
      editCol.style.display = '';
      pvCol.style.display = '';
    }
    this.renderPreview();
  }

  /** 构建注入 <base> 后的预览 HTML(相对资源经同源 http 解析;回退 file://) */
  buildPreviewHtml() {
    const html = this.ta.value || '';
    // 优先用同源 http base(注册目录);未注册时回退 file:// 目录
    const base = this.previewBase || dirFileUrl(this.filePath);
    if (!base || /<base[\s>]/i.test(html)) return html; // 已有 base 或不需解析则不注入
    if (/<head>/i.test(html)) {
      return html.replace(/<head>/i, '<head>\n<base href="' + escAttr(base) + '">');
    }
    // 无 <head>:在 <html> 后或文档开头注入一个 <base>
    if (/<html[\s>]/i.test(html)) {
      return html.replace(/<html([\s>])/i, '<html$1<base href="' + escAttr(base) + '">');
    }
    return '<base href="' + escAttr(base) + '">' + html;
  }

  renderPreview() {
    if (!this.preview) return;
    if (this.mode === 'edit') return;
    try {
      this.preview.srcdoc = this.buildPreviewHtml();
    } catch (e) {
      this.preview.srcdoc = '<div style="color:#e0573c;padding:12px">渲染失败: ' + esc(e.message || e) + '</div>';
    }
  }

  /** 复制源码 */
  async copySource() {
    try {
      await navigator.clipboard.writeText(this.ta.value);
      this.setStatus('已复制源码');
    } catch (e) {
      this.setStatus('复制失败', true);
    }
  }

  /**
   * 把当前打开的文档加入资源库分类(优先显示「文档资源/网页」分组下的分类)。
   * 弹分类选择对话框 → addItem(type='web') → 侧栏即时刷新。
   */
  addToLibrary() {
    if (!this.filePath) {
      this.setStatus('尚未打开文件,先打开或新建一个 .html 文档', true);
      return;
    }
    // 文档/网页相关分组(名称含「文档/网页/html」或扩展名含 .html 的自定义分组)
    const docGroupIds = new Set(
      (state.settings && Array.isArray(state.settings.customTypeGroups) ? state.settings.customTypeGroups : [])
        .filter((g) => /文档|网页|html/i.test(g.name || '') || (Array.isArray(g.exts) && g.exts.some((x) => HTML_EXTS.includes(String(x).toLowerCase()))))
        .map((g) => g.id)
    );
    const all = state.categories || [];
    const withTag = all.filter((c) => (c.typeTags || []).some((t) => docGroupIds.has(t)));
    const others = all.filter((c) => !(c.typeTags || []).some((t) => docGroupIds.has(t)));
    const candidates = [...withTag, ...others];

    const body = document.createElement('div');
    body.className = 'modal-body';
    const hint = document.createElement('div');
    hint.className = 'form-hint';
    hint.textContent = '将当前 HTML 文档加入资源库指定分类。优先选择「文档资源」下的目录;加入后可在该分类直接打开并继续编辑。';
    const row = document.createElement('div');
    row.className = 'form-row';
    row.innerHTML = '<label class="f-label">目标分类</label>';
    const sel = document.createElement('select');
    sel.appendChild(new Option('(未分类)', ''));
    for (const c of candidates) {
      sel.appendChild(new Option(categoryPath(c.id), c.id));
    }
    row.appendChild(sel);
    body.appendChild(hint);
    body.appendChild(row);

    const { close } = openModal({
      title: '加入资源库',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '加入', cls: 'primary', onClick: () => {
            const catId = sel.value;
            const nm = String(this.filePath).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
            addItem({
              categoryId: catId,
              type: 'web',
              filePath: this.filePath,
              displayName: nm,
              remark: '',
              size: null,
              mtime: null,
            });
            close();
            this.setStatus('已加入资源库' + (catId ? '「' + categoryPath(catId) + '」' : '(未分类)'));
            toast('已加入资源库' + (catId ? '「' + categoryPath(catId) + '」' : '(未分类)'), 'ok', 2600);
            try { document.dispatchEvent(new CustomEvent('library:changed')); } catch (e) { /* ignore */ }
          },
        },
      ]),
    });
  }

  setStatus(msg, isErr = false) {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
      this.statusEl.style.color = isErr ? '#e0573c' : '';
    }
  }
}
