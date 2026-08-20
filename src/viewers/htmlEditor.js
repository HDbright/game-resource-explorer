'use strict';
/**
 * HTML 查看 / 编辑器(参考 Markdown 编辑器的分栏编辑体验)。
 * - 工具栏:新建 / 打开 / 保存 / 另存为 / 分栏 / 仅预览 / 仅编辑 切换、复制源码、加入库
 * - 编辑区 textarea + 预览区 iframe 渲染(直接渲染 HTML,支持脚本/样式)
 * - 预览时自动注入 <base> 指向源文件目录(经内部 http 服务同源加载,规避 file:// 被 webSecurity 拦截),使相对路径的图片/CSS 等资源可正确加载
 * - load(filePath) 读取文件 → 编辑 / 保存回写原文件
 * - 自动存档:编辑空闲 2.5s 自动写回(已有落盘路径时);切换离开编辑页时强制自动存档;
 *   同路径重复打开跳过重载,保持切换前的编辑状态。
 * - 未保存改动:文件名后出现小白点提示(dirty)。
 */
import { state, addItem, categoryPath } from '../state.js';
import { openModal, footButtons, toast, showContextMenu } from '../dialogs.js';
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
/** 文件路径 basename(最后一段) */
function basename(p) { return String(p || '').split(/[\\/]/).pop(); }
/** 文件路径目录(去掉最后一段) */
function dirOf(p) { return String(p || '').replace(/[\\/][^\\/]*$/, ''); }
/** 由文件路径得到目录的 file:// URL(用于 iframe <base> 解析相对资源,回退用) */
function dirFileUrl(filePath) {
  const dir = dirOf(filePath);
  if (!dir) return '';
  return 'file:///' + dir.replace(/\\/g, '/');
}
/** 写 UTF-8 文本到文件(经主进程 IPC) */
async function writeTextFile(filePath, text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const r = await window.api.writeFileBase64(filePath, 'data:text/plain;base64,' + b64);
  if (!r || !r.ok) throw new Error((r && r.error) || '写入失败');
}

export class HtmlEditorController {
  constructor() {
    this.wrap = null;
    this.filePath = null;
    this.statusEl = null;
    this.ta = null;
    this.preview = null;
    this.mode = 'split'; // split | preview | edit
    this.dotSel = '#html-dirty'; // 未保存小白点元素
    this.defaultExt = 'html'; // 本编辑器新建/另存为的扩展名
    this.untitled = false; // 新建的默认「未命名」文档:保存时须提示输入文件名(走另存为)
    this.previewToken = null; // html:previewRegister 返回的目录 token(同源 http 加载相对资源)
    this.previewBase = ''; // <base href>(同源 http://host/html-pv/<token>/),优先于 file://
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
    this.statusEl = wrap.querySelector('#html-status');
    this.ta = wrap.querySelector('#html-edit');
    this.preview = wrap.querySelector('#html-preview');

    wrap.querySelector('#html-open').addEventListener('click', () => this.pickAndLoad());
    wrap.querySelector('#html-save').addEventListener('click', () => this.save());
    wrap.querySelector('#html-save-as').addEventListener('click', () => this.saveAs());
    wrap.querySelector('#html-add-lib').addEventListener('click', () => this.addToLibrary());
    wrap.querySelector('#html-mode-split').addEventListener('click', () => this.setMode('split'));
    wrap.querySelector('#html-mode-preview').addEventListener('click', () => this.setMode('preview'));
    wrap.querySelector('#html-mode-edit').addEventListener('click', () => this.setMode('edit'));
    wrap.querySelector('#html-copy').addEventListener('click', () => this.copySource());
    // 新建(空白 HTML 文档)由 ui.js 的 newDocument('html') 处理(需创建文件 + 入库 + 打开)

    // 编辑输入 → 标记脏 + 防抖刷新预览 + 防抖自动存档(仅已有落盘路径)
    this.ta.addEventListener('input', () => {
      this.dirty = this.savedText !== this.ta.value;
      this.updateDirtyDot();
      clearTimeout(this._renderTimer);
      this._renderTimer = setTimeout(() => this.renderPreview(), 250);
      this.scheduleAutoSave();
    });
    // Ctrl+S 保存
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save();
      }
    });

    // 编辑区右键:复制选中文本 / 全选(与预览区一致的交互;无选中时复制项禁用,仍提供全选)
    this.ta.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = this.ta.value.substring(this.ta.selectionStart, this.ta.selectionEnd);
      showContextMenu(e.clientX, e.clientY, [
        {
          label: '复制选中文本',
          disabled: !sel,
          onClick: () => {
            navigator.clipboard.writeText(sel).then(() => toast('已复制')).catch(() => toast('复制失败', 'error'));
          },
        },
        { label: '全选', onClick: () => { this.ta.select(); this.ta.focus(); } },
      ]);
    });

    // 预览 iframe 内右键:选中文本时提供「复制选中文本 / 全选」(未选中则放行文档自身行为)
    // srcdoc 每次变化 iframe 都会重新加载 → load 事件重新绑定;文档是 srcdoc(与父同源),可直接访问 contentDocument
    this.preview.addEventListener('load', () => {
      try {
        const doc = this.preview.contentDocument;
        if (!doc) return;
        doc.addEventListener('contextmenu', (e) => {
          const sel = (doc.getSelection ? doc.getSelection().toString() : '');
          if (!sel.trim()) return; // 无选中文本 → 放行
          e.preventDefault();
          e.stopPropagation();
          // iframe 内事件坐标相对 iframe 视口 → 转换为主文档坐标(菜单 append 到主文档 body, fixed 定位)
          const r = this.preview.getBoundingClientRect();
          const x = r.left + e.clientX;
          const y = r.top + e.clientY;
          showContextMenu(x, y, [
            {
              label: '复制选中文本',
              onClick: () => {
                navigator.clipboard.writeText(sel).then(() => toast('已复制')).catch(() => toast('复制失败', 'error'));
              },
            },
            {
              label: '全选',
              onClick: () => {
                const range = doc.createRange();
                range.selectNodeContents(doc.body || doc.documentElement);
                const s = doc.getSelection();
                s.removeAllRanges();
                s.addRange(range);
              },
            },
          ]);
        }, true); // 捕获阶段:先于文档自身处理,保证能拿到右键事件
      } catch (err) { /* 跨源/异常:忽略,保留 Ctrl+C 复制 */ }
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
    this.untitled = false; // 打开真实文件 → 已命名,后续保存直接写回
    this.defaultDir = dirOf(filePath);
    // 注册文件所在目录到内部 http 服务,预览时 <base> 指向同源 http://host/html-pv/<token>/
    // 使相对 CSS/JS/图片 经 http 加载(规避 file:// 被 webSecurity 拦截导致的空白/破版)
    await this.registerPreviewRoot(filePath);
    this.ta.value = text;
    this.savedText = text;
    this.dirty = false;
    this.updateDirtyDot();
    this.renderPreview();
    const nm = basename(filePath);
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
    const dir = dirOf(filePath);
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

  /** 保存回写原文件(UTF-8);无文件路径或为新建的「未命名」文档 → 走另存为(提示输入文件名) */
  async save() {
    if (!this.filePath || this.untitled) {
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
    const base = this.filePath ? basename(this.filePath) : '未命名.html';
    const defaultName = this.defaultDir ? (this.defaultDir.replace(/[\\/]$/, '') + '\\' + base) : base;
    try {
      const r = await window.api.saveText({
        defaultName,
        content: this.ta.value,
        filters: [{ name: 'HTML', extensions: ['html', 'htm', 'xhtml'] }],
      });
      if (!r || r.canceled) return;
      this.filePath = r.path;
      this.currentPath = r.path;
      this.loaded = true;
      this.untitled = false; // 已另存为命名文件
      this.defaultDir = dirOf(r.path);
      await this.registerPreviewRoot(r.path); // 重新注册新路径目录,使相对资源可加载
      this.markSaved(this.ta.value);
      const nameEl = this.wrap.querySelector('#html-name');
      if (nameEl) nameEl.textContent = basename(r.path);
      this.renderPreview();
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
    // 预览页需支持选择复制文本:注入兜底 user-select:text(强制可选中,光标等交互样式仍由文档决定)
    const SEL_STYLE = '<style>html,body{-webkit-user-select:text!important;user-select:text!important}</style>';
    // 优先用同源 http base(注册目录);未注册时回退 file:// 目录
    const base = this.previewBase || dirFileUrl(this.filePath);
    if (!base || /<base[\s>]/i.test(html)) {
      // 已有 base 或不需解析则不注入 base,仅兜底可选中(优先插到 </html> 前,否则追加)
      return /<\/html>/i.test(html) ? html.replace(/<\/html>/i, SEL_STYLE + '</html>') : html + SEL_STYLE;
    }
    if (/<head>/i.test(html)) {
      return html.replace(/<head>/i, '<head>\n<base href="' + escAttr(base) + '">\n' + SEL_STYLE);
    }
    // 无 <head>:在 <html> 后或文档开头注入一个 <base>
    if (/<html[\s>]/i.test(html)) {
      return html.replace(/<html([\s>])/i, '<html$1<base href="' + escAttr(base) + '">' + SEL_STYLE);
    }
    return '<base href="' + escAttr(base) + '">' + SEL_STYLE + html;
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
