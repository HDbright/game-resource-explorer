'use strict';
/**
 * Markdown 查看 / 编辑器(参考 MarkText 的分栏编辑体验,轻量实现)。
 * - 工具栏:打开 / 保存 / 分栏 / 仅预览 切换、导出源码
 * - 编辑区 textarea + 预览区 markdown-it 渲染(GitHub 风格 CSS)
 * - load(filePath) 读取文件 → 编辑 / 保存回写原文件
 */
import MarkdownIt from 'markdown-it';
import { state, addItem, categoryPath } from '../state.js';
import { openModal, footButtons, toast } from '../dialogs.js';

let _md = null;
function mdIt() {
  if (!_md) {
    _md = new MarkdownIt({
      html: true,
      linkify: true,
      breaks: true,
      typographer: false,
    });
  }
  return _md;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export class MarkdownEditorController {
  constructor() {
    this.wrap = null;
    this.filePath = null;
    this.statusEl = null;
    this.ta = null;
    this.preview = null;
    this.mode = 'split'; // split | preview | edit
  }

  init(wrap) {
    this.wrap = wrap;
    this.statusEl = wrap.querySelector('#md-status');
    this.ta = wrap.querySelector('#md-edit');
    this.preview = wrap.querySelector('#md-preview');

    wrap.querySelector('#md-open').addEventListener('click', () => this.pickAndLoad());
    wrap.querySelector('#md-save').addEventListener('click', () => this.save());
    wrap.querySelector('#md-add-lib').addEventListener('click', () => this.addToLibrary());
    wrap.querySelector('#md-mode-split').addEventListener('click', () => this.setMode('split'));
    wrap.querySelector('#md-mode-preview').addEventListener('click', () => this.setMode('preview'));
    wrap.querySelector('#md-mode-edit').addEventListener('click', () => this.setMode('edit'));
    wrap.querySelector('#md-copy').addEventListener('click', () => this.copySource());

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

  /** 打开文件对话框选择 .md → 加载 */
  async pickAndLoad() {
    try {
      const r = await window.api.pickFiles({
        title: '打开 Markdown 文档',
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
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
    this.ta.value = text;
    this.renderPreview();
    const nm = String(filePath).split(/[\\/]/).pop();
    const nameEl = this.wrap.querySelector('#md-name');
    if (nameEl) nameEl.textContent = nm;
    this.setStatus('已打开 ' + nm);
    return text;
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
    this.wrap.querySelectorAll('.md-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const editCol = this.wrap.querySelector('#md-edit-col');
    const pvCol = this.wrap.querySelector('#md-preview-col');
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

  renderPreview() {
    if (!this.preview) return;
    if (this.mode === 'edit') return;
    try {
      this.preview.innerHTML = mdIt().render(this.ta.value || '');
    } catch (e) {
      this.preview.innerHTML = '<div class="md-error">渲染失败: ' + esc(e.message || e) + '</div>';
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
   * 把当前打开的文档加入资源库分类(优先显示「文档资源」分组下的分类)。
   * 弹分类选择对话框 → addItem(type='markdown') → 侧栏即时刷新。
   */
  addToLibrary() {
    if (!this.filePath) {
      this.setStatus('尚未打开文件,先打开或新建一个 .md 文档', true);
      return;
    }
    // 文档资源分组 id(名称含「文档/Markdown」或扩展名含 .md 的自定义分组)
    const docGroupIds = new Set(
      (state.settings && Array.isArray(state.settings.customTypeGroups) ? state.settings.customTypeGroups : [])
        .filter((g) => /文档|markdown/i.test(g.name || '') || (Array.isArray(g.exts) && g.exts.includes('.md')))
        .map((g) => g.id)
    );
    const all = state.categories || [];
    // 候选:文档资源分组勾选的分类优先,其余资源分类随后(未分类兜底)
    const withTag = all.filter((c) => (c.typeTags || []).some((t) => docGroupIds.has(t)));
    const others = all.filter((c) => !(c.typeTags || []).some((t) => docGroupIds.has(t)));
    const candidates = [...withTag, ...others];

    const body = document.createElement('div');
    body.className = 'modal-body';
    const hint = document.createElement('div');
    hint.className = 'form-hint';
    hint.textContent = '将当前文档加入资源库指定分类。优先选择「文档资源」下的目录;加入后可在该分类直接打开并继续编辑。';
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
              type: 'markdown',
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

/** base64 dataURL → UTF-8 文本 */
export function b64ToText(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(buf);
}
