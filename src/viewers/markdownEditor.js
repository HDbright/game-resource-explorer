'use strict';
/**
 * Markdown 查看 / 编辑器(参考 MarkText 的分栏编辑体验,轻量实现)。
 * - 工具栏:新建 / 打开 / 保存 / 另存为 / 分栏 / 仅预览 切换、导出源码
 * - 编辑区 textarea + 预览区 markdown-it 渲染(GitHub 风格 CSS)
 * - load(filePath) 读取文件 → 编辑 / 保存回写原文件
 * - 自动存档:编辑空闲 2.5s 自动写回(已有落盘路径时);切换离开编辑页时强制自动存档;
 *   同路径重复打开跳过重载,保持切换前的编辑状态。
 * - 未保存改动:文件名后出现小白点提示(dirty)。
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
/** 文件路径 basename(最后一段) */
function basename(p) { return String(p || '').split(/[\\/]/).pop(); }
/** 文件路径目录(去掉最后一段) */
function dirOf(p) { return String(p || '').replace(/[\\/][^\\/]*$/, ''); }
/** 写 UTF-8 文本到文件(经主进程 IPC) */
async function writeTextFile(filePath, text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const r = await window.api.writeFileBase64(filePath, 'data:text/plain;base64,' + b64);
  if (!r || !r.ok) throw new Error((r && r.error) || '写入失败');
}

export class MarkdownEditorController {
  constructor() {
    this.wrap = null;
    this.filePath = null;
    this.statusEl = null;
    this.ta = null;
    this.preview = null;
    this.mode = 'split'; // split | preview | edit
    this.dotSel = '#md-dirty'; // 未保存小白点元素
    this.defaultExt = 'md'; // 本编辑器新建/另存为的扩展名
    // ---- 自动存档 / 脏标记状态 ----
    this.dirty = false; // 相对上次保存是否有未保存改动
    this.savedText = ''; // 上次保存时的内容(用于比较 dirty)
    this.currentPath = null; // 当前已加载文件(同路径重复打开跳过重载)
    this.loaded = false;
    this.defaultDir = ''; // 另存为默认目录(随打开文件更新)
    this.autoSaveTimer = null; // 编辑空闲自动存档定时器
  }

  init(wrap) {
    this.wrap = wrap;
    this.statusEl = wrap.querySelector('#md-status');
    this.ta = wrap.querySelector('#md-edit');
    this.preview = wrap.querySelector('#md-preview');

    wrap.querySelector('#md-open').addEventListener('click', () => this.pickAndLoad());
    wrap.querySelector('#md-save').addEventListener('click', () => this.save());
    wrap.querySelector('#md-save-as').addEventListener('click', () => this.saveAs());
    wrap.querySelector('#md-add-lib').addEventListener('click', () => this.addToLibrary());
    wrap.querySelector('#md-mode-split').addEventListener('click', () => this.setMode('split'));
    wrap.querySelector('#md-mode-preview').addEventListener('click', () => this.setMode('preview'));
    wrap.querySelector('#md-mode-edit').addEventListener('click', () => this.setMode('edit'));
    wrap.querySelector('#md-copy').addEventListener('click', () => this.copySource());
    // 新建(空白 Markdown 文档)由 ui.js 的 newDocument('md') 处理(需创建文件 + 入库 + 打开)

    // 编辑输入 → 标记脏 + 防抖刷新预览 + 防抖自动存档(仅已有落盘路径)
    this._bindInput();

    // Ctrl+S 保存
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save();
      }
    });
  }

  _bindInput() {
    this.ta.addEventListener('input', () => {
      // 标记脏(与上次保存内容比较)
      this.dirty = this.savedText !== this.ta.value;
      this.updateDirtyDot();
      // 防抖刷新预览(预览/分栏模式)
      clearTimeout(this._renderTimer);
      this._renderTimer = setTimeout(() => this.renderPreview(), 250);
      // 防抖自动存档(编辑时自动存档:仅已有落盘路径的文档)
      this.scheduleAutoSave();
    });
  }

  /** 编辑空闲自动存档(2.5s 无输入且脏 → 写回原文件) */
  scheduleAutoSave() {
    if (!this.filePath) return; // 无落盘路径不静默自动存档
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      if (this.dirty && this.filePath) {
        writeTextFile(this.filePath, this.ta.value)
          .then(() => this.markSaved(this.ta.value))
          .catch(() => { /* 失败静默,小白点保留 */ });
      }
    }, 2500);
  }

  /** 切换离开编辑页时自动存档(由 ui.js 钩子调用);无落盘路径(纯内存新文档)则跳过 */
  async autoSaveOnLeave() {
    if (!this.dirty || !this.filePath) return;
    try {
      await writeTextFile(this.filePath, this.ta.value);
      this.markSaved(this.ta.value);
    } catch (e) {
      // 失败静默,小白点保留提示未保存
    }
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
    // 同一文件重复打开:保留内存中的编辑内容(保持切换前的状态,不被磁盘内容覆盖)
    if (this.loaded && this.currentPath === filePath) {
      return this.ta.value;
    }
    const r = await window.api.readBase64(filePath);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取失败');
    const text = b64ToText(String(r.dataUrl || ''));
    this.filePath = filePath;
    this.currentPath = filePath;
    this.loaded = true;
    this.defaultDir = dirOf(filePath);
    this.ta.value = text;
    this.savedText = text;
    this.dirty = false;
    this.updateDirtyDot();
    this.renderPreview();
    const nm = basename(filePath);
    const nameEl = this.wrap.querySelector('#md-name');
    if (nameEl) nameEl.textContent = nm;
    this.setStatus('已打开 ' + nm);
    return text;
  }

  /** 保存回写原文件(UTF-8);无文件路径则走另存为 */
  async save() {
    if (!this.filePath) {
      this.saveAs();
      return;
    }
    try {
      await writeTextFile(this.filePath, this.ta.value);
      this.markSaved(this.ta.value);
      this.setStatus('已保存 ' + new Date().toLocaleTimeString());
    } catch (e) {
      this.setStatus('保存失败: ' + e.message, true);
    }
  }

  /** 另存为到指定路径(弹出保存对话框,默认当前文件目录 / 默认目录) */
  async saveAs() {
    const base = this.filePath ? basename(this.filePath) : '未命名.md';
    const defaultName = this.defaultDir ? (this.defaultDir.replace(/[\\/]$/, '') + '\\' + base) : base;
    try {
      const r = await window.api.saveText({
        defaultName,
        content: this.ta.value,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (!r || r.canceled) return;
      this.filePath = r.path;
      this.currentPath = r.path;
      this.loaded = true;
      this.defaultDir = dirOf(r.path);
      this.markSaved(this.ta.value);
      const nameEl = this.wrap.querySelector('#md-name');
      if (nameEl) nameEl.textContent = basename(r.path);
      this.setStatus('已另存为 ' + basename(r.path));
    } catch (e) {
      this.setStatus('另存为失败: ' + e.message, true);
    }
  }

  /** 标记已保存(清 dirty + 更新小白点) */
  markSaved(text) {
    this.savedText = (text == null ? this.ta.value : text);
    this.dirty = false;
    this.updateDirtyDot();
  }

  /** 更新文件名后的小白点显隐 */
  updateDirtyDot() {
    if (!this.wrap) return;
    const el = this.wrap.querySelector(this.dotSel);
    if (el) el.hidden = !this.dirty;
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
