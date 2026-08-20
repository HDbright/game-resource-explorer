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
import { state, addItem, categoryPath, setSetting } from '../state.js';
import { openModal, footButtons, toast, showContextMenu, pickEmojiModal } from '../dialogs.js';

/** 预览各级标题(H1–H6)默认颜色(用户可在「标题色」对话框覆盖;留空=使用默认文字色) */
const DEFAULT_HEADING_COLORS = {
  h1: '#ff7043', h2: '#ffa726', h3: '#ffd54f', h4: '#66bb6a', h5: '#42a5f5', h6: '#ab47bc',
};
/** 文字颜色对话框预设色板 */
const TEXT_COLOR_PRESETS = ['#e0573c', '#ffb300', '#ffd54f', '#66bb6a', '#42a5f5', '#ab47bc', '#ffffff', '#000000'];

/**
 * 剥离 Markdown 语法标记,得到近似渲染纯文本(用于编辑区选区 ↔ 预览文本联动匹配)。
 * 尽力覆盖常用标记,匹配失败会降级为块级定位,不影响正常使用。
 */
function plainMd(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    this.untitled = false; // 新建的默认「未命名」文档:保存时须提示输入文件名(走另存为)
    // ---- 自动存档 / 脏标记状态 ----
    this.dirty = false; // 相对上次保存是否有未保存改动
    this.savedText = ''; // 上次保存时的内容(用于比较 dirty)
    this.currentPath = null; // 当前已加载文件(同路径重复打开跳过重载)
    this.loaded = false;
    this.defaultDir = ''; // 另存为默认目录(随打开文件更新)
    this.autoSaveTimer = null; // 编辑空闲自动存档定时器
    // ---- 分栏同步关联(滚动 / 选中联动) ----
    this.syncOn = false; // 同步关联开关(仅 split 分栏模式生效)
    this._syncScrollLock = false; // 滚动同步互斥锁(防双向滚动死循环)
    this._syncSelLock = false; // 选中同步互斥锁
    this._pvBlocks = []; // 预览块锚点:[{el, line}](line=源码行号,1 基)
    this._expectTaTop = null; // 程序化设置的编辑区 scrollTop(防回弹)
    this._expectPvTop = null; // 程序化设置的预览 scrollTop(防回弹)
    this._pvHlEl = null; // 当前高亮描边的预览块(降级定位用)
    this._selPvTimer = null; // 编辑区→预览 选中防抖
    this._selEdTimer = null; // 预览→编辑区 选中防抖
    // ---- 查找 / 替换 ----
    this._findMatches = []; // 当前匹配列表 [{start, end}]
    this._findCur = -1; // 当前匹配下标
    this._findTimer = null; // 查找输入防抖
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
    // 富文本插入类工具栏:emoji / 表格 / 文字色 / 标题色
    // ⚠️ 工具箱页与预览页(pv-markdown-view)各有一份工具栏模板,须保持按钮齐全;
    //    绑定前判空,避免某一模板缺按钮时 querySelector 返回 null 抛错中断启动(initUI)。
    const bind = (id, fn) => {
      const el = wrap.querySelector(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('#md-emoji', () => this.openEmojiInsert());
    bind('#md-table', () => this.openTableDialog());
    bind('#md-text-color', () => this.openTextColorDialog());
    bind('#md-heading-color', () => this.openHeadingColorDialog());
    // 分栏同步关联:开关按钮(仅 split 分栏模式生效)+ 滚动/选区双向联动
    const syncBtn = wrap.querySelector('#md-sync');
    if (syncBtn) {
      this.syncOn = !!(state.settings && state.settings.mdSync);
      syncBtn.classList.toggle('active', this.syncOn);
      syncBtn.addEventListener('click', () => this.toggleSync());
    }
    this.ta.addEventListener('scroll', () => this._syncScrollToPreview());
    this.preview.addEventListener('scroll', () => this._syncScrollToEditor());
    // 编辑区选区变化 → 预览(select/keyup/mouseup/click 覆盖键盘鼠标操作)
    const selPv = () => this._scheduleSyncSelToPreview();
    this.ta.addEventListener('select', selPv);
    this.ta.addEventListener('keyup', selPv);
    this.ta.addEventListener('mouseup', selPv);
    this.ta.addEventListener('click', selPv);
    // 预览区选区变化 → 编辑区
    const selEd = () => this._scheduleSyncSelToEditor();
    this.preview.addEventListener('mouseup', selEd);
    this.preview.addEventListener('keyup', selEd);
    this.preview.addEventListener('click', selEd);
    // 新建(空白 Markdown 文档)由 ui.js 的 newDocument('md') 处理(需创建文件 + 入库 + 打开)

    // 编辑输入 → 标记脏 + 防抖刷新预览 + 防抖自动存档(仅已有落盘路径)
    this._bindInput();

    // Ctrl+S 保存 / Ctrl+F 查找 / Esc 关闭查找条
    this.ta.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        this.save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'f') {
        e.preventDefault();
        this.openFind();
        return;
      }
      if (e.key === 'Escape' && !this._isFindBarHidden()) {
        this.closeFind();
      }
    });
    // 查找 / 替换按钮与工具条(两处模板均有;判空绑定防启动崩溃)
    bind('#md-find', () => this.openFind());
    const fq = wrap.querySelector('#md-find-q');
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
    const rq = wrap.querySelector('#md-replace-q');
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
    bind('#md-find-prev', () => this._jumpToFind(-1));
    bind('#md-find-next', () => this._jumpToFind(1));
    bind('#md-find-close', () => this.closeFind());
    bind('#md-replace-one', () => this.replaceCurrent());
    bind('#md-replace-all', () => this.replaceAll());
    bind('#md-find-case', () => { this._findMatches = this._computeFindMatches(); this._findCur = -1; this._jumpToFind(1, true); });
    bind('#md-find-word', () => { this._findMatches = this._computeFindMatches(); this._findCur = -1; this._jumpToFind(1, true); });

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

    // 预览区右键:选中文本时提供「复制选中文本 / 全选」(未选中则放行,不干预)
    this.preview.addEventListener('contextmenu', (e) => {
      const sel = (window.getSelection() || {}).toString ? window.getSelection().toString() : '';
      if (!sel.trim()) return; // 无选中文本 → 不拦截
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: '复制选中文本',
          onClick: () => {
            navigator.clipboard.writeText(sel).then(() => toast('已复制')).catch(() => toast('复制失败', 'error'));
          },
        },
        {
          label: '全选',
          onClick: () => {
            const r = document.createRange();
            r.selectNodeContents(this.preview);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
          },
        },
      ]);
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
    this.untitled = false; // 打开真实文件 → 已命名,后续保存直接写回
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
      this.untitled = false; // 已另存为命名文件
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
    // 同步关联仅在分栏模式生效:切回分栏且开启时,立即对齐滚动与选中
    if (mode === 'split' && this.syncOn) {
      this._syncScrollToPreview();
      this._syncSelToPreview();
    }
  }

  renderPreview() {
    if (!this.preview) return;
    if (this.mode === 'edit') return;
    try {
      const src = this.ta.value || '';
      const md = mdIt();
      const tokens = md.parse(src, {});
      // 收集顶层块 token 的起始行号(0 基 → 1 基),供分栏同步关联做「行号 ↔ 预览块」映射
      const blockLines = [];
      for (const t of tokens) {
        if (t.level !== 0 || !t.map) continue;
        if (t.type === 'inline') continue;
        if (t.type.endsWith('_open') || ['fence', 'code_block', 'hr', 'html_block'].includes(t.type)) {
          blockLines.push(t.map[0] + 1);
        }
      }
      let html = md.renderer.render(tokens, md.options, {});
      // 预览各级标题颜色:从 settings.mdHeadingColors 注入作用域样式(#md-preview 限定,避免污染其它视图)
      const hc = (state.settings && state.settings.mdHeadingColors) || {};
      let style = '';
      for (let i = 1; i <= 6; i++) {
        const c = hc['h' + i];
        if (c) style += '#md-preview h' + i + '{color:' + c + '!important}';
      }
      if (style) html = '<style>' + style + '</style>' + html;
      this.preview.innerHTML = html;
      // 建立块锚点:预览顶层子元素 ↔ 源码起始行号(跳过注入的 <style>)
      this._pvBlocks = [];
      const kids = [...this.preview.children].filter((el) => el.tagName !== 'STYLE');
      for (let i = 0; i < kids.length && i < blockLines.length; i++) {
        kids[i].dataset.srcLine = String(blockLines[i]);
        this._pvBlocks.push({ el: kids[i], line: blockLines[i] });
      }
      // 同步开启时,渲染后重新对齐滚动位置(编辑区当前行 → 预览)
      if (this.syncOn && this.mode === 'split') this._syncScrollToPreview();
    } catch (e) {
      this.preview.innerHTML = '<div class="md-error">渲染失败: ' + esc(e.message || e) + '</div>';
    }
  }

  // ============================ 分栏同步关联(滚动 / 选中联动) ============================

  /** 编辑区行高(px):textarea line-height 1.6 × 13px = 20.8px */
  _taLineHeight() {
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight);
    return (lh && lh > 0) ? lh : 20.8;
  }

  /** 编辑区当前顶部行号(1 基) */
  _taTopLine() {
    return Math.floor(this.ta.scrollTop / this._taLineHeight()) + 1;
  }

  /** 预览块相对内容区的顶部坐标 */
  _pvBlockTop(el) {
    const pv = this.preview.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return (er.top - pv.top) + this.preview.scrollTop;
  }

  /** 找行号对应的预览块(最后一个起始行 ≤ 目标行的块) */
  _pvBlockByLine(line) {
    let best = null;
    for (const b of this._pvBlocks) {
      if (b.line <= line) best = b; else break;
    }
    return best;
  }

  /** 找预览视口顶部的块(第一个内容顶部 ≥ 视口顶部的块; 找不到取最后一个) */
  _pvBlockAtTop() {
    const pvTop = this.preview.scrollTop;
    let best = null;
    for (const b of this._pvBlocks) {
      const top = this._pvBlockTop(b.el);
      if (top <= pvTop + 4) { best = b; continue; }
      break;
    }
    return best || (this._pvBlocks.length ? this._pvBlocks[0] : null);
  }

  /** 切换同步关联开关(持久化到 settings.mdSync) */
  toggleSync() {
    this.syncOn = !this.syncOn;
    const btn = this.wrap.querySelector('#md-sync');
    if (btn) btn.classList.toggle('active', this.syncOn);
    setSetting('mdSync', this.syncOn);
    this.setStatus(this.syncOn ? '已开启同步关联(滚动 / 选中双向联动)' : '已关闭同步关联');
    if (this.syncOn && this.mode === 'split') {
      this._syncScrollToPreview();
      this._syncSelToPreview();
    }
  }

  /** 编辑区滚动 → 预览滚动(按行号映射到最近块) */
  _syncScrollToPreview() {
    if (!this.syncOn || this.mode !== 'split' || this._syncScrollLock) return;
    this._syncScrollLock = true;
    try {
      // 本次滚动若是我们程序化设置的编辑区 scrollTop 触发,直接吞掉(防双向回弹)
      if (this._expectTaTop != null && Math.abs(this.ta.scrollTop - this._expectTaTop) < 2) {
        this._expectTaTop = null;
        return;
      }
      const line = this._taTopLine();
      const block = this._pvBlockByLine(line);
      if (block) {
        const target = this._pvBlockTop(block.el) - 8;
        if (Math.abs(this.preview.scrollTop - target) > 2) {
          this._expectPvTop = target;
          this.preview.scrollTop = target;
        }
      }
    } finally { this._syncScrollLock = false; }
  }

  /** 预览滚动 → 编辑区滚动(视口顶部块 → 行号) */
  _syncScrollToEditor() {
    if (!this.syncOn || this.mode !== 'split' || this._syncScrollLock) return;
    this._syncScrollLock = true;
    try {
      // 本次滚动若是我们程序化设置的预览 scrollTop 触发,直接吞掉(防双向回弹)
      if (this._expectPvTop != null && Math.abs(this.preview.scrollTop - this._expectPvTop) < 2) {
        this._expectPvTop = null;
        return;
      }
      const block = this._pvBlockAtTop();
      if (block) {
        const target = Math.max(0, (block.line - 1) * this._taLineHeight() - 12);
        if (Math.abs(this.ta.scrollTop - target) > 2) {
          this._expectTaTop = target;
          this.ta.scrollTop = target;
        }
      }
    } finally { this._syncScrollLock = false; }
  }

  /** 防抖调度:编辑区选中 → 预览 */
  _scheduleSyncSelToPreview() {
    if (!this.syncOn || this.mode !== 'split') return;
    clearTimeout(this._selPvTimer);
    this._selPvTimer = setTimeout(() => this._syncSelToPreview(), 60);
  }

  /** 防抖调度:预览选中 → 编辑区 */
  _scheduleSyncSelToEditor() {
    if (!this.syncOn || this.mode !== 'split') return;
    clearTimeout(this._selEdTimer);
    this._selEdTimer = setTimeout(() => this._syncSelToEditor(), 60);
  }

  /** 编辑区选中文本 → 预览中选中对应文字(剥离 md 标记后精确匹配,失败降级块定位) */
  _syncSelToPreview() {
    if (!this.syncOn || this.mode !== 'split' || this._syncSelLock) return;
    this._syncSelLock = true;
    try {
      const s = this.ta.selectionStart, e = this.ta.selectionEnd;
      if (s === e) { this._clearPvHighlight(); return; }
      const raw = this.ta.value.slice(s, e);
      const plain = plainMd(raw);
      if (!plain) { this._clearPvHighlight(); return; }
      // 精确匹配:在预览中查找该纯文本 → 选中(Range)
      const range = this._findTextInPreview(plain);
      if (range) {
        this._clearPvHighlight();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const node = range.startContainer;
        if (node && node.parentElement) node.parentElement.scrollIntoView({ block: 'nearest' });
        return;
      }
      // 降级:定位到选中起始行对应的预览块,加高亮描边
      const line = this.ta.value.slice(0, s).split('\n').length;
      const block = this._pvBlockByLine(line);
      if (block) {
        this._clearPvHighlight();
        block.el.classList.add('md-sync-hl');
        this._pvHlEl = block.el;
        this.preview.scrollTop = this._pvBlockTop(block.el) - 8;
      }
    } finally { this._syncSelLock = false; }
  }

  /** 预览选中文本 → 编辑区选中对应源码(先精确查原文,失败按块定位行) */
  _syncSelToEditor() {
    if (!this.syncOn || this.mode !== 'split' || this._syncSelLock) return;
    this._syncSelLock = true;
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { return; }
      const text = sel.toString();
      if (!text) return;
      // 只在选区位于预览内时处理(编辑区 textarea 选区不在 document selection 里,天然隔离)
      const anchor = sel.anchorNode;
      if (!anchor || !this.preview.contains(anchor)) return;
      const src = this.ta.value;
      // 匹配变体:原文 → trim → 折叠连续空白(渲染文本可能合并/裁剪空白)
      const variants = [];
      if (text) variants.push(text);
      const trimmed = text.trim();
      if (trimmed && trimmed !== text) variants.push(trimmed);
      const collapsed = trimmed.replace(/\s+/g, ' ');
      if (collapsed !== trimmed) variants.push(collapsed);
      const findIdx = (from, to) => {
        for (const v of variants) {
          const i = src.indexOf(v, from);
          if (i >= 0 && (to == null || i + v.length <= to)) return { i, len: v.length };
        }
        return null;
      };
      // 1) 优先在选区起始行对应的源码行范围内查找(渲染文本基本在该行内,命中率高)
      const blockEl = this._closestPvBlock(anchor);
      let hit = null;
      if (blockEl) {
        const line = Number(blockEl.dataset.srcLine || 0);
        if (line > 0) {
          const ls = this._lineStartOffset(src, line);
          const le = this._lineEndOffset(src, line);
          hit = findIdx(ls, le + 1); // 行范围闭区间(含行尾)
        }
      }
      // 2) 行内未命中 → 全文查找
      if (!hit) hit = findIdx(0);
      if (hit) {
        this.ta.focus();
        this.ta.setSelectionRange(hit.i, hit.i + hit.len);
        const line = src.slice(0, hit.i).split('\n').length;
        this.ta.scrollTop = Math.max(0, (line - 1) * this._taLineHeight() - 12);
        return;
      }
      // 3) 精确匹配失败:定位选区所在块 → 编辑区滚动到对应行并选中该行
      if (blockEl) {
        const line = Number(blockEl.dataset.srcLine || 0);
        if (line > 0) {
          const ls = this._lineStartOffset(src, line);
          const le = this._lineEndOffset(src, line);
          this.ta.focus();
          this.ta.setSelectionRange(ls, le);
          this.ta.scrollTop = Math.max(0, (line - 1) * this._taLineHeight() - 12);
        }
      }
    } finally { this._syncSelLock = false; }
  }

  /** 源码第 line 行(1 基)的起始字符偏移 */
  _lineStartOffset(src, line) {
    if (line <= 1) return 0;
    let i = 0, cur = 1;
    while (cur < line && i < src.length) { if (src[i] === '\n') cur++; i++; }
    return i;
  }

  /** 源码第 line 行(1 基)的结束字符偏移(行尾,不含换行符) */
  _lineEndOffset(src, line) {
    let i = this._lineStartOffset(src, line);
    while (i < src.length && src[i] !== '\n') i++;
    return i;
  }

  /** 预览中查找包含指定纯文本的文本节点 → Range(无则 null) */
  _findTextInPreview(text) {
    if (!text) return null;
    const walker = document.createTreeWalker(this.preview, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(text);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + text.length);
        return range;
      }
    }
    return null;
  }

  /** 从选区锚点向上找最近的带 srcLine 的预览块 */
  _closestPvBlock(node) {
    let n = node;
    while (n && n !== this.preview) {
      if (n.nodeType === 1 && n.dataset && n.dataset.srcLine) return n;
      n = n.parentElement;
    }
    return null;
  }

  /** 清除预览中的同步高亮描边 */
  _clearPvHighlight() {
    if (this._pvHlEl) {
      this._pvHlEl.classList.remove('md-sync-hl');
      this._pvHlEl = null;
    }
  }

  // ============================ 查找 / 替换 ============================

  /** 查找条是否隐藏(取 #md-find-bar 的 hidden 状态;元素不存在视为隐藏) */
  _isFindBarHidden() {
    const bar = this.wrap.querySelector('#md-find-bar');
    return !bar || bar.hidden;
  }

  /** 打开查找条(Ctrl+F / 🔍 查找):聚焦查找框,预填当前选中文本,立即查找 */
  openFind() {
    const bar = this.wrap.querySelector('#md-find-bar');
    const fq = this.wrap.querySelector('#md-find-q');
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

  /** 关闭查找条:隐藏 + 清除编辑区选区高亮与预览描边 */
  closeFind() {
    const bar = this.wrap.querySelector('#md-find-bar');
    if (bar) bar.hidden = true;
    this._findMatches = [];
    this._findCur = -1;
    this._clearPvHighlight();
    this.ta.focus();
  }

  /** 计算当前查找关键词的所有匹配位置(区分大小写 / 全词选项;正则转义特殊字符) */
  _computeFindMatches() {
    const fq = this.wrap.querySelector('#md-find-q');
    if (!fq || !fq.value) return [];
    const q = fq.value;
    const caseSensitive = !!(this.wrap.querySelector('#md-find-case') || {}).checked;
    const wholeWord = !!(this.wrap.querySelector('#md-find-word') || {}).checked;
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
   * @param {number} direction 跳转方向
   * @param {boolean} fromStart true=从文档开头找第一个(打开/输入时用)
   */
  _jumpToFind(direction, fromStart) {
    const fq = this.wrap.querySelector('#md-find-q');
    if (!fq || !fq.value) { this._updateFindCount(); return; }
    const matches = this._findMatches;
    if (!matches.length) { this._updateFindCount(); this._clearPvHighlight(); return; }
    const n = matches.length;
    let cur = this._findCur;
    if (fromStart || cur < 0) {
      cur = direction > 0 ? 0 : n - 1;
    } else {
      cur = (cur + direction + n) % n;
    }
    this._findCur = cur;
    const hit = matches[cur];
    this.ta.focus();
    this.ta.setSelectionRange(hit.start, hit.end);
    // 滚动编辑区使当前匹配可见(居中偏上)
    const line = this.ta.value.slice(0, hit.start).split('\n').length;
    const lh = this._taLineHeight();
    const targetTop = Math.max(0, (line - 1) * lh - this.ta.clientHeight / 2 + lh);
    if (Math.abs(this.ta.scrollTop - targetTop) > 2) {
      this._expectTaTop = targetTop;
      this.ta.scrollTop = targetTop;
    }
    this._updateFindCount();
    // 同步关联开启时,预览滚动到对应块并高亮(查找定位联动)
    if (this.syncOn && this.mode === 'split') {
      const block = this._pvBlockByLine(line);
      if (block) {
        this._clearPvHighlight();
        block.el.classList.add('md-sync-hl');
        this._pvHlEl = block.el;
        this.preview.scrollTop = this._pvBlockTop(block.el) - 8;
      }
    }
  }

  /** 更新查找计数显示("n/m" 或 "0") */
  _updateFindCount() {
    const c = this.wrap.querySelector('#md-find-count');
    if (!c) return;
    const total = this._findMatches.length;
    c.textContent = total ? ((this._findCur + 1) + '/' + total) : String(total);
  }

  /** 替换当前匹配(按查找关键词原样替换为替换框内容;替换后重查并跳到下一处) */
  replaceCurrent() {
    const fq = this.wrap.querySelector('#md-find-q');
    const rq = this.wrap.querySelector('#md-replace-q');
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
    const fq = this.wrap.querySelector('#md-find-q');
    const rq = this.wrap.querySelector('#md-replace-q');
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
    this._clearPvHighlight();
    this.setStatus('已替换 ' + count + ' 处');
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

  // ============================ 富文本插入/着色 ============================

  /**
   * 在光标处插入文本(替换当前选区);插入后触发 input 事件(脏标记 + 防抖预览 + 自动存档)并聚焦。
   * @param {string} text 要插入的文本
   */
  insertAtCursor(text) {
    const ta = this.ta;
    if (!ta || text == null) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const v = ta.value;
    ta.value = v.slice(0, start) + text + v.slice(end);
    const pos = start + text.length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.focus();
    // 手动派发 input:复用 _bindInput 的脏标记/预览/自动存档逻辑(直接赋值不触发 input)
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 插入 emoji:复用全局 emoji 选择面板(pickEmojiModal),多选后拼接插入光标处 */
  openEmojiInsert() {
    pickEmojiModal((arr) => {
      if (!arr || !arr.length) return;
      this.insertAtCursor(arr.join(' '));
      this.setStatus('已插入 ' + arr.length + ' 个 emoji');
    });
  }

  /**
   * 插入指定行/列的 Markdown 表格(含表头行 + 分隔行 + N 个数据行)。
   * 行数=数据行数,列数=列数;对话框内实时预览渲染结果。
   */
  openTableDialog() {
    const body = document.createElement('div');
    body.className = 'modal-body';
    const tip = document.createElement('div');
    tip.className = 'form-hint';
    tip.textContent = '设置表格的行数(数据行)与列数,下方实时预览,确认后插入到光标位置。';
    body.appendChild(tip);

    const buildTable = (rows, cols) => {
      const cells = (fn) => Array.from({ length: cols }, (_, i) => fn(i)).join(' | ');
      const header = '| ' + cells((i) => '标题' + (i + 1)) + ' |';
      const sep = '| ' + cells(() => '---') + ' |';
      const emptyRow = '| ' + cells(() => '   ') + ' |';
      return header + '\n' + sep + '\n' + Array.from({ length: rows }, () => emptyRow).join('\n');
    };
    const clamp = (raw, min, max, dft) => {
      let n = parseInt(raw, 10);
      if (!Number.isFinite(n)) n = dft;
      return Math.max(min, Math.min(max, n));
    };

    const mkNumRow = (labelText, def, min, max) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.className = 'f-label';
      label.textContent = labelText;
      row.appendChild(label);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = String(min); inp.max = String(max); inp.value = String(def);
      inp.className = 'num-input';
      row.appendChild(inp);
      return { row, inp };
    };

    const r = mkNumRow('行数(数据行)', 3, 1, 50);
    const c = mkNumRow('列数', 3, 1, 20);
    body.appendChild(r.row);
    body.appendChild(c.row);

    const pv = document.createElement('div');
    pv.className = 'md-table-preview';
    body.appendChild(pv);

    const refresh = () => {
      const rows = clamp(r.inp.value, 1, 50, 3);
      const cols = clamp(c.inp.value, 1, 20, 3);
      pv.innerHTML = mdIt().render(buildTable(rows, cols));
    };
    r.inp.addEventListener('input', refresh);
    c.inp.addEventListener('input', refresh);
    refresh();

    const { close } = openModal({
      title: '插入表格',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '插入', cls: 'primary', onClick: () => {
            const rows = clamp(r.inp.value, 1, 50, 3);
            const cols = clamp(c.inp.value, 1, 20, 3);
            const table = buildTable(rows, cols);
            this.insertAtCursor('\n' + table + '\n');
            close();
            this.setStatus('已插入 ' + rows + ' 行 × ' + cols + ' 列表格');
          },
        },
      ]),
    });
  }

  /**
   * 为选中文字设置指定颜色(在 Markdown 中包成 <span style="color:...">);
   * 无选区时插入空彩色标记并把光标置于标签之间。
   * @param {string} hex 形如 #rrggbb
   */
  applyTextColor(hex) {
    const ta = this.ta;
    if (!ta || !hex) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const v = ta.value;
    const sel = v.slice(start, end);
    let insert, cursor;
    if (sel) {
      // 转义选中文本中的 < > &,避免破坏 <span> 结构(渲染后仍显示原字符)
      insert = '<span style="color:' + hex + '">' + esc(sel) + '</span>';
      cursor = start + insert.length;
    } else {
      const open = '<span style="color:' + hex + '">';
      const close = '</span>';
      insert = open + close;
      cursor = start + open.length; // 光标置于开闭标签之间
    }
    ta.value = v.slice(0, start) + insert + v.slice(end);
    ta.selectionStart = ta.selectionEnd = cursor;
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 文字颜色对话框:原生取色器 + 十六进制输入 + 预设色板;确认后包色选中文字 */
  openTextColorDialog() {
    const body = document.createElement('div');
    body.className = 'modal-body';
    const tip = document.createElement('div');
    tip.className = 'form-hint';
    tip.textContent = '为编辑区选中的文字设置颜色(选中文字会被包成带 color 的 <span>)。未选中时,插入一个空彩色文字标记并将光标置于其中。';
    body.appendChild(tip);

    const row = document.createElement('div');
    row.className = 'form-row';
    row.innerHTML = '<label class="f-label">颜色</label>';
    const colorInp = document.createElement('input');
    colorInp.type = 'color'; colorInp.value = '#42a5f5';
    const hexInp = document.createElement('input');
    hexInp.type = 'text'; hexInp.value = '#42a5f5'; hexInp.className = 'hex-input';
    hexInp.placeholder = '#rrggbb';
    colorInp.addEventListener('input', () => { hexInp.value = colorInp.value; });
    hexInp.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hexInp.value.trim())) colorInp.value = hexInp.value.trim(); });
    row.appendChild(colorInp);
    row.appendChild(hexInp);
    body.appendChild(row);

    const swWrap = document.createElement('div');
    swWrap.className = 'color-swatches';
    for (const col of TEXT_COLOR_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.background = col; b.title = col;
      b.addEventListener('click', () => { colorInp.value = col; hexInp.value = col; });
      swWrap.appendChild(b);
    }
    body.appendChild(swWrap);

    const { close } = openModal({
      title: '文字颜色',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '应用', cls: 'primary', onClick: () => {
            const hex = /^#[0-9a-fA-F]{6}$/.test(hexInp.value.trim()) ? hexInp.value.trim().toLowerCase() : colorInp.value;
            this.applyTextColor(hex);
            close();
            this.setStatus('已应用文字颜色 ' + hex);
          },
        },
      ]),
    });
  }

  /** 预览各级标题(H1–H6)颜色对话框:每级一个取色器 + 十六进制 + 「默认」按钮;保存至 settings.mdHeadingColors */
  openHeadingColorDialog() {
    const cur = (state.settings && state.settings.mdHeadingColors) || {};
    const body = document.createElement('div');
    body.className = 'modal-body';
    const tip = document.createElement('div');
    tip.className = 'form-hint';
    tip.textContent = '设置 Markdown 预览中各级标题(H1–H6)的颜色。十六进制留空或点「默认」则恢复默认文字色。修改即时保存到设置,重启后仍然生效。';
    body.appendChild(tip);

    const grid = document.createElement('div');
    grid.className = 'heading-color-grid';
    const inputs = {};
    for (let i = 1; i <= 6; i++) {
      const key = 'h' + i;
      const r = document.createElement('div');
      r.className = 'hc-row';
      const label = document.createElement('span');
      label.className = 'hc-label';
      label.textContent = 'H' + i;
      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.value = cur[key] || DEFAULT_HEADING_COLORS[key];
      const hexInp = document.createElement('input');
      hexInp.type = 'text'; hexInp.value = cur[key] || ''; hexInp.placeholder = '默认'; hexInp.className = 'hex-input';
      const defBtn = document.createElement('button');
      defBtn.type = 'button'; defBtn.className = 'btn xs'; defBtn.textContent = '默认';
      colorInp.addEventListener('input', () => { hexInp.value = colorInp.value; });
      hexInp.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hexInp.value.trim())) colorInp.value = hexInp.value.trim(); });
      defBtn.addEventListener('click', () => { colorInp.value = DEFAULT_HEADING_COLORS[key]; hexInp.value = ''; });
      // 预设色板:右键(或左键)点击色块 → 把该色块颜色填入本行的取色器与十六进制输入框
      const swWrap = document.createElement('div');
      swWrap.className = 'hc-swatches';
      for (const col of TEXT_COLOR_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch'; b.style.background = col;
        b.title = '右键点击填入颜色 ' + col;
        const fill = () => { colorInp.value = col; hexInp.value = col; };
        b.addEventListener('click', fill);
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); fill(); });
        swWrap.appendChild(b);
      }
      r.appendChild(label);
      r.appendChild(colorInp);
      r.appendChild(hexInp);
      r.appendChild(defBtn);
      r.appendChild(swWrap);
      grid.appendChild(r);
      inputs[key] = { colorInp, hexInp };
    }
    body.appendChild(grid);

    const { close } = openModal({
      title: '预览标题颜色',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '应用', cls: 'primary', onClick: () => {
            const next = {};
            for (let i = 1; i <= 6; i++) {
              const key = 'h' + i;
              const hex = inputs[key].hexInp.value.trim();
              if (/^#[0-9a-fA-F]{6}$/.test(hex)) next[key] = hex.toLowerCase();
            }
            setSetting('mdHeadingColors', next); // 持久化(自动落盘)
            this.renderPreview(); // 立即应用
            close();
            this.setStatus('已保存标题颜色设置');
          },
        },
      ]),
    });
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
