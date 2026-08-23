'use strict';
/**
 * HTML 查看 / 编辑器(参考 Markdown 编辑器的分栏编辑体验)。
 * - 工具栏:新建 / 打开 / 保存 / 另存为 / 分栏 / 仅预览 / 仅编辑 切换、复制源码、加入库
 * - 查找 / 替换(Ctrl+F):编辑区选中匹配并滚动聚焦;预览 iframe 高亮全部匹配、当前匹配滚动聚焦
 * - 编辑区 textarea + 预览区 iframe 渲染(直接渲染 HTML,支持脚本/样式)
 * - 预览时自动注入 <base> 指向源文件目录(经内部 http 服务同源加载,规避 file:// 被 webSecurity 拦截),使相对路径的图片/CSS 等资源可正确加载
 * - load(filePath) 读取文件 → 编辑 / 保存回写原文件
 * - 自动存档:编辑空闲 2.5s 自动写回(已有落盘路径时);切换离开编辑页时强制自动存档;
 *   同路径重复打开跳过重载,保持切换前的编辑状态。
 * - 未保存改动:文件名后出现小白点提示(dirty)。
 */
import { state, addItem, categoryPath, setSetting, updateItem } from '../state.js';
import { openModal, footButtons, toast, showContextMenu, promptDialog } from '../dialogs.js';
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
    // ---- 查找 / 替换 ----
    this._findMatches = []; // 当前匹配列表 [{start, end}]
    this._findCur = -1; // 当前匹配下标
    this._findTimer = null; // 查找输入防抖
    this._pvFindMarks = []; // 预览 iframe 内查找高亮的 mark 元素(文档顺序;关闭查找/iframe 重载时清除)
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
    // 初始同步保存按钮高亮状态(新建/打开文件后应不高亮)
    this.updateDirtyDot();
    // Ctrl+S 保存(Ctrl+F 查找 / Esc 关闭查找条由下方 wrap 级监听统一处理)
    this.ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save();
      }
    });
    // Ctrl+F 打开查找 / Esc 关闭查找条(wrap 级:仅预览模式 textarea 隐藏时也能触发)
    wrap.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'f') {
        e.preventDefault();
        this.openFind();
      } else if (e.key === 'Escape' && !this._isFindBarHidden()) {
        this.closeFind();
      }
    });
    // 查找 / 替换按钮与工具条(模板缺失时判空绑定,防启动崩溃)
    const bind = (id, fn) => {
      const el = wrap.querySelector(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('#html-find', () => this.openFind());
    const fq = wrap.querySelector('#html-find-q');
    if (fq) {
      fq.addEventListener('input', () => {
        clearTimeout(this._findTimer);
        this._findTimer = setTimeout(() => {
          this._findMatches = this._computeFindMatches();
          this._findCur = -1;
          this._jumpToFind(1, true);
        }, 200);
      });
      fq.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._jumpToFind(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          this.closeFind();
        }
      });
    }
    const rq = wrap.querySelector('#html-replace-q');
    if (rq) {
      rq.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) this.replaceAll();
          else this.replaceCurrent();
        } else if (e.key === 'Escape') {
          this.closeFind();
        }
      });
    }
    bind('#html-find-prev', () => this._jumpToFind(-1));
    bind('#html-find-next', () => this._jumpToFind(1));
    bind('#html-find-close', () => this.closeFind());
    bind('#html-replace-one', () => this.replaceCurrent());
    bind('#html-replace-all', () => this.replaceAll());
    bind('#html-find-case', () => { this._findMatches = this._computeFindMatches(); this._findCur = -1; this._jumpToFind(1, true); });
    bind('#html-find-word', () => { this._findMatches = this._computeFindMatches(); this._findCur = -1; this._jumpToFind(1, true); });

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
        // srcdoc 重载后旧的查找高亮已随文档销毁;查找条打开时重新叠加全部匹配
        this._pvFindMarks = [];
        if (!this._isFindBarHidden()) this._applyPvFindMarks();
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

  /** 保存回写原文件(UTF-8);无文件路径或为新建的「未命名」文档 → 提示输入文件名(重命名原文件) */
  async save() {
    if (!this.filePath || this.untitled) {
      await this.renameUntitled();
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

  /**
   * 新建「未命名」文档的保存:把默认文件改名为用户输入的文件名,
   * 并同步更新资源库中该条目的名称与文件路径(不残留旧名文件)。
   */
  async renameUntitled() {
    const oldPath = this.filePath;
    if (!oldPath) { this.saveAs(); return; } // 兜底:无路径仍走另存为
    const oldName = basename(oldPath); // 如 未命名.html
    const oldStem = oldName.replace(/\.[^.]+$/, '') || '未命名';
    const dir = dirOf(oldPath);
    // 弹输入框让用户输入新文件名(默认显示当前名,可带或不带扩展名)
    const newName = await this._promptFileName(oldStem, this.defaultExt);
    if (!newName) return; // 取消
    const target = dir.replace(/[\\/]$/, '') + '\\' + newName;
    if (target === oldPath) {
      // 用户未改名(保持原名)→ 仅写回内容即可
      try {
        await writeTextFile(oldPath, this.ta.value);
        this.markSaved(this.ta.value);
        this.setStatus('已保存 ' + oldName);
      } catch (e) {
        this.setStatus('保存失败: ' + e.message, true);
      }
      return;
    }
    try {
      // 1) 先写回内容(改名后原文件即消失,须先落盘)
      await writeTextFile(oldPath, this.ta.value);
      // 2) 重命名原文件为目标名(主进程仅允许同目录改名,且目标已存在会拒绝)
      const r = await window.api.renameFile(oldPath, target);
      if (!r || !r.ok) {
        this.setStatus('保存失败: ' + ((r && r.error) || '重命名失败'), true);
        return;
      }
      // 3) 更新编辑器内部状态
      this.filePath = target;
      this.currentPath = target;
      this.loaded = true;
      this.untitled = false;
      this.defaultDir = dirOf(target);
      await this.registerPreviewRoot(target); // 重新注册新路径目录,使相对资源可加载
      this.markSaved(this.ta.value);
      const nameEl = this.wrap.querySelector('#html-name');
      if (nameEl) nameEl.textContent = basename(target);
      this.renderPreview();
      // 4) 更新资源库条目(名称 + 文件路径;按旧路径匹配)
      const item = state.items.find((i) => i.filePath === oldPath);
      if (item) {
        updateItem(item.id, {
          displayName: newName.replace(/\.[^.]+$/, ''),
          filePath: target,
        });
        try { document.dispatchEvent(new CustomEvent('library:changed')); } catch (e) { /* ignore */ }
      }
      this.setStatus('已保存为 ' + basename(target));
    } catch (e) {
      this.setStatus('保存失败: ' + e.message, true);
    }
  }

  /** 弹输入框获取新文件名(校验非法字符/自动补扩展名;取消返回 null) */
  _promptFileName(stem, ext) {
    return new Promise((resolve) => {
      promptDialog({
        title: '保存为',
        message: '输入文件名保存。当前默认文件将改名为你输入的名字(同一目录),资源库同步更新。',
        fields: [{ key: 'name', label: '文件名', type: 'text', value: stem + '.' + ext }],
        onOk: (values) => {
          let name = String(values.name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
          if (!name) { this.setStatus('文件名不能为空', true); resolve(null); return; }
          // 自动补扩展名(用户未输入扩展名时,按当前编辑器类型处理)
          const hasExt = /\.[^.\\/]+$/.test(name);
          if (!hasExt) name += '.' + ext;
          resolve(name);
        },
        onCancel: () => resolve(null),
      });
    });
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
      // 另存为的新文件加入当前资源库分类目录(ui.js 监听处理;新增或更新条目)
      try {
        document.dispatchEvent(new CustomEvent('doc:save-as', {
          detail: { path: r.path, type: 'web' },
        }));
      } catch (e) { /* ignore */ }
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

  /** 更新「未保存」状态视觉:文件名后小白点 + 保存按钮高亮(默认普通样式,仅内容改动未保存时显示 primary 蓝色) */
  updateDirtyDot() {
    if (!this.wrap) return;
    const el = this.wrap.querySelector(this.dotSel);
    if (el) el.hidden = !this.dirty;
    const saveBtn = this.wrap.querySelector('#html-save');
    if (saveBtn) saveBtn.classList.toggle('primary', this.dirty);
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

  // ============================ 查找 / 替换 ============================

  /** 编辑区行高(px):textarea line-height 1.6 × 13px = 20.8px */
  _taLineHeight() {
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight);
    return (lh && lh > 0) ? lh : 20.8;
  }

  /** 查找条是否隐藏(取 #html-find-bar 的 hidden 状态;元素不存在视为隐藏) */
  _isFindBarHidden() {
    const bar = this.wrap.querySelector('#html-find-bar');
    return !bar || bar.hidden;
  }

  /** 打开查找条(Ctrl+F / 🔍 查找):聚焦查找框,预填当前选中文本,立即查找 */
  openFind() {
    const bar = this.wrap.querySelector('#html-find-bar');
    const fq = this.wrap.querySelector('#html-find-q');
    if (!bar || !fq) return;
    bar.hidden = false;
    // 预填当前选中文本(有选区时),否则保留上次关键词
    const selText = this.ta.value.substring(this.ta.selectionStart, this.ta.selectionEnd);
    if (selText && !this._findMatches.length) {
      fq.value = selText.slice(0, 200);
    }
    fq.focus();
    fq.select();
    this._findMatches = this._computeFindMatches();
    this._findCur = -1;
    this._jumpToFind(1, true);
  }

  /** 关闭查找条:隐藏 + 清除编辑区选区与预览 iframe 查找高亮 */
  closeFind() {
    const bar = this.wrap.querySelector('#html-find-bar');
    if (bar) bar.hidden = true;
    this._findMatches = [];
    this._findCur = -1;
    this._clearPvFindMarks();
    this.ta.focus();
  }

  /** 计算当前查找关键词的所有匹配位置(区分大小写 / 全词选项;正则转义特殊字符) */
  _computeFindMatches() {
    const fq = this.wrap.querySelector('#html-find-q');
    if (!fq || !fq.value) return [];
    const q = fq.value;
    const caseSensitive = !!(this.wrap.querySelector('#html-find-case') || {}).checked;
    const wholeWord = !!(this.wrap.querySelector('#html-find-word') || {}).checked;
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re;
    try {
      re = new RegExp(wholeWord ? '(?<![\\w])' + esc + '(?![\\w])' : esc, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return [];
    }
    const src = this.ta.value;
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++; // 防空匹配死循环
    }
    return out;
  }

  /**
   * 跳转到当前匹配(direction=1 下一个 / -1 上一个;wrap 循环)。
   * 编辑区选中匹配并滚动聚焦;预览 iframe(分栏/仅预览)高亮全部匹配并滚动聚焦到当前匹配文字。
   * @param {number} direction 跳转方向
   * @param {boolean} fromStart true=从文档开头找第一个(打开/输入时用)
   */
  _jumpToFind(direction, fromStart) {
    const fq = this.wrap.querySelector('#html-find-q');
    if (!fq || !fq.value) { this._updateFindCount(); return; }
    const matches = this._findMatches;
    if (!matches.length) { this._updateFindCount(); this._clearPvFindMarks(); return; }
    const n = matches.length;
    let cur = this._findCur;
    if (fromStart || cur < 0) {
      cur = direction > 0 ? 0 : n - 1;
    } else {
      cur = (cur + direction + n) % n;
    }
    this._findCur = cur;
    const hit = matches[cur];
    // 编辑区:选中匹配并滚动聚焦(仅预览模式 textarea 隐藏,不抢查找框焦点)
    if (this.mode !== 'preview') this.ta.focus();
    this.ta.setSelectionRange(hit.start, hit.end);
    const line = this.ta.value.slice(0, hit.start).split('\n').length;
    const lh = this._taLineHeight();
    const targetTop = Math.max(0, (line - 1) * lh - this.ta.clientHeight / 2 + lh);
    if (Math.abs(this.ta.scrollTop - targetTop) > 2) {
      this.ta.scrollTop = targetTop;
    }
    this._updateFindCount();
    // 预览 iframe:高亮全部匹配文字并滚动聚焦当前匹配
    if (this.mode !== 'edit') this._focusPvFindCur(hit, matches, cur);
  }

  /**
   * 预览 iframe 内定位当前查找匹配:叠加全部匹配高亮,当前匹配加醒目标记并滚动聚焦。
   * 当前匹配对位方式:源码当前匹配文本的第 j 次出现 ↔ 预览中同文本的第 j 个高亮
   * (渲染文本与源码纯文本匹配通常一一对应);预览无文字命中(关键词只在标签/属性里)不动预览。
   */
  _focusPvFindCur(hit, matches, cur) {
    const marks = this._applyPvFindMarks();
    if (!marks || !marks.length) return;
    const src = this.ta.value;
    const curText = src.slice(hit.start, hit.end);
    let j = 0;
    for (let i = 0; i <= cur; i++) {
      if (src.slice(matches[i].start, matches[i].end) === curText) j++;
    }
    const same = marks.filter((m) => m.textContent === curText);
    const pick = same[Math.min(j - 1, same.length - 1)] || marks[Math.min(cur, marks.length - 1)];
    for (const m of marks) this._stylePvMark(m, m === pick);
    try { pick.scrollIntoView({ block: 'center' }); } catch (e) { /* 忽略滚动异常 */ }
  }

  /**
   * 预览 iframe 内叠加查找高亮:按与编辑区相同的关键词/大小写/全词选项,把渲染文本中
   * 所有匹配包成 <mark>(data-find-hl 标识 + 内联样式,不依赖文档自身 CSS)。
   * 跳过 script/style;最多叠加 500 处(超长文档保护)。返回 mark 列表(文档顺序)。
   */
  _applyPvFindMarks() {
    this._clearPvFindMarks();
    if (!this.preview || this.mode === 'edit') return this._pvFindMarks;
    const fq = this.wrap.querySelector('#html-find-q');
    if (!fq || !fq.value) return this._pvFindMarks;
    let doc = null;
    try { doc = this.preview.contentDocument; } catch (e) { return this._pvFindMarks; }
    if (!doc || !doc.body) return this._pvFindMarks;
    const caseSensitive = !!(this.wrap.querySelector('#html-find-case') || {}).checked;
    const wholeWord = !!(this.wrap.querySelector('#html-find-word') || {}).checked;
    const q = fq.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re;
    try {
      re = new RegExp(wholeWord ? '(?<![\\w])' + q + '(?![\\w])' : q, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return this._pvFindMarks;
    }
    // 先按文档顺序收集全部匹配区间,再倒序包裹(先包后面的,前面区间偏移不被拆分影响)
    const hits = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (nd) => {
        const p = nd.parentElement;
        if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode()) && hits.length < 500) {
      const s = node.textContent;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null && hits.length < 500) {
        hits.push({ node, start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex++; // 防空匹配死循环
      }
    }
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      try {
        const range = doc.createRange();
        range.setStart(h.node, h.start);
        range.setEnd(h.node, h.end);
        const mark = doc.createElement('mark');
        mark.dataset.findHl = '1';
        this._stylePvMark(mark, false);
        range.surroundContents(mark);
        this._pvFindMarks.unshift(mark); // 倒序包裹 → 头插保持文档顺序
      } catch (e) { /* 区间异常(跨节点等):跳过该处 */ }
    }
    return this._pvFindMarks;
  }

  /** iframe 内查找高亮 mark 的内联样式(cur=true 当前匹配:橙色醒目) */
  _stylePvMark(mark, cur) {
    mark.style.cssText = cur
      ? 'background:rgba(255,145,0,.80);color:#1b1b1b;border-radius:2px;padding:0 1px;outline:2px solid rgba(255,145,0,.9);'
      : 'background:rgba(255,213,79,.35);color:inherit;border-radius:2px;padding:0 1px;';
  }

  /** 清除预览 iframe 内查找高亮(mark 还原为纯文本;按 data 标记查询,iframe 重载后旧引用失效也能覆盖) */
  _clearPvFindMarks() {
    let doc = null;
    try { doc = this.preview && this.preview.contentDocument; } catch (e) { /* ignore */ }
    if (doc) {
      doc.querySelectorAll('mark[data-find-hl]').forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      });
    }
    this._pvFindMarks = [];
  }

  /** 更新查找计数显示("n/m" 或 "0") */
  _updateFindCount() {
    const c = this.wrap.querySelector('#html-find-count');
    if (!c) return;
    const total = this._findMatches.length;
    c.textContent = total ? ((this._findCur + 1) + '/' + total) : String(total);
  }

  /** 替换当前匹配(按查找关键词原样替换为替换框内容;替换后重查并跳到下一处) */
  replaceCurrent() {
    const fq = this.wrap.querySelector('#html-find-q');
    const rq = this.wrap.querySelector('#html-replace-q');
    if (!fq || !fq.value) return;
    const matches = this._findMatches;
    if (!matches.length) return;
    const cur = Math.max(0, this._findCur);
    const hit = matches[cur];
    const rep = rq ? rq.value : '';
    const v = this.ta.value;
    this.ta.value = v.slice(0, hit.start) + rep + v.slice(hit.end);
    this.ta.selectionStart = this.ta.selectionEnd = hit.start + rep.length;
    this.ta.dispatchEvent(new Event('input', { bubbles: true })); // 脏标记 + 预览刷新 + 自动存档
    // 重新计算匹配,跳转到下一处(同一位置继续找,避免漏掉重叠替换)
    this._findMatches = this._computeFindMatches();
    this._findCur = cur - 1;
    this._jumpToFind(1);
  }

  /** 全部替换:从后往前替换避免索引错位;替换后重查并清空匹配 */
  replaceAll() {
    const fq = this.wrap.querySelector('#html-find-q');
    const rq = this.wrap.querySelector('#html-replace-q');
    if (!fq || !fq.value) return;
    const matches = this._computeFindMatches();
    if (!matches.length) return;
    const rep = rq ? rq.value : '';
    let v = this.ta.value;
    for (let i = matches.length - 1; i >= 0; i--) {
      const h = matches[i];
      v = v.slice(0, h.start) + rep + v.slice(h.end);
    }
    const count = matches.length;
    this.ta.value = v;
    this.ta.selectionStart = this.ta.selectionEnd = 0;
    this.ta.dispatchEvent(new Event('input', { bubbles: true }));
    this._findMatches = [];
    this._findCur = -1;
    this._updateFindCount();
    this._clearPvFindMarks();
    this.setStatus('已替换 ' + count + ' 处');
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
