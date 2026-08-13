// 资源工具箱 → Spine 格式转换
// 复用 SpineSkeletonDataConverter(C++ 原生 EXE,来自 SpineSkeletonDataConverter 项目)做:
//   - skel ↔ json 双向转换
//   - 跨 Spine 版本升级/降级(3.5-3.8 / 4.0-4.3),自动识别输入版本
// 页面功能:选择文件/目录、拖拽文件自动进入「文件列表区」、逐文件版本/格式自动识别、
// 批量/单个转换、目标格式默认 skel→json / json→skel、移除曲线插值、输出目录选项。
// 文件列表区:勾选(单选/多选/全选)、预览缩略图、已在资源库时显示库中名称与分类位置、
// 点击行打开预览播放页(可返回)、右键 加入资源库分类 / 从列表删除、悬停 × 删除。

import { Spine38Player } from '../preview/spine38Player.js';
import { SpinePlayer } from '../preview/spinePlayer.js';
import { getPixi } from '../pixiLazy.js';
import { state, categoryById, categoryPath, addItem } from '../state.js';
import { thumbnailService } from '../thumbnails.js';
import { toast, confirmDialog } from '../dialogs.js';

// ============ 公共小工具 ============
function basename(p) {
  return String(p).split(/[\\/]/).pop() || p;
}
function dirOf(p) {
  return p.replace(/[\\/][^\\/]*$/, '');
}
function extname(p) {
  const m = String(p).match(/\.[^.\\/]+$/);
  return m ? m[0] : '';
}
function joinPath(dir, name) {
  return dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + name;
}
function relFrom(baseDir, full) {
  const b = baseDir.replace(/[\\/]+$/, '');
  const f = full.replace(/[\\/]+$/, '');
  if (f === b) return basename(full);
  if (f.indexOf(b) === 0) {
    const rest = f.slice(b.length).replace(/^[\\/]+/, '');
    if (rest) return rest;
  }
  return basename(full);
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function fmtSize(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 在资源库中查找同名资源文件(任意类型,按路径匹配) */
function matchLibItem(filePath) {
  const fp = normPath(filePath);
  return state.items.find((it) => normPath(it.filePath) === fp) || null;
}

const SPINE_EXTS = ['skel', 'json', 'bin'];
const VERSION_CHOICES = ['3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2', '4.3'];

// ============ 预览控制器(自包含,复用 spine 播放器) ============
// 与 PreviewController 对齐:PIXI app + ticker + 缩放/平移 + fit,但用 /spine-pv/<token>/ 路由加载。
class SpineConvertPreview {
  constructor() {
    this.app = null;
    this.player = null;
    this.viewC = null;
    this.canvas = null;
    this.wrap = null;
    this.paused = false;
    this.speed = 1;
    this.mode = 'loop';
    this.lastT = 0;
    this.fitPending = false;
    this._ro = null;
    this._drag = null;
    this._loop = this._loop.bind(this);
  }

  async init(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    if (this.app) return;
    const PIXI = await getPixi();
    const app = new PIXI.Application();
    await app.init({
      view: canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      background: 0x15171d,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preserveDrawingBuffer: true,
      preference: 'webgl',
    });
    this.app = app;
    this.viewC = new PIXI.Container();
    app.stage.addChild(this.viewC);
    this._bindEvents();
    this.lastT = performance.now();
    requestAnimationFrame(this._loop);
  }

  _bindEvents() {
    const canvas = this.canvas;
    const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.pow(1.12, -e.deltaY / 100);
      const cur = Math.abs(this.viewC.scale.x || 1);
      const next = clamp(cur * f, 0.02, 40) * (this.flip ? -1 : 1);
      const rect = canvas.getBoundingClientRect();
      const sx = this.app.renderer.width / rect.width;
      const sy = this.app.renderer.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      const k = next / (this.viewC.scale.x || 1);
      this.viewC.position.set(mx - (mx - this.viewC.position.x) * k, my - (my - this.viewC.position.y) * k);
      this.viewC.scale.set(next);
      this.fitPending = false;
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, px: this.viewC.position.x, py: this.viewC.position.y };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const rect = canvas.getBoundingClientRect();
      const sx = this.app.renderer.width / rect.width;
      const sy = this.app.renderer.height / rect.height;
      this.viewC.position.set(this._drag.px + (e.clientX - this._drag.x) * sx, this._drag.py + (e.clientY - this._drag.y) * sy);
      this.fitPending = false;
    });
    canvas.addEventListener('pointerup', () => { this._drag = null; });
    canvas.addEventListener('pointerleave', () => { this._drag = null; });
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.wrap);
  }

  _resize() {
    if (!this.app) return;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this.fitPending = true;
  }

  _loop(t) {
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.app) {
      if (!this.paused && this.mode !== 'single' && this.player) this.player.update(dt);
      this.app.render();
      if (this.fitPending && this.player) {
        this.fitPending = false;
        this.fit();
      }
    }
    requestAnimationFrame(this._loop);
  }

  disposePlayer() {
    if (this.player) {
      try { this.player.dispose(); } catch (_) {}
      this.player = null;
    }
    if (this.viewC) this.viewC.removeChildren();
  }

  async load(file, dirToken, atlasName) {
    await this.init(this.canvas, this.wrap);
    const base = `${location.origin}/spine-pv/${dirToken}/`;
    const skeletonUrl = base + encodeURIComponent(file.name);
    const atlasUrl = base + encodeURIComponent(atlasName);
    const isV3 = (file.version || '').startsWith('3');
    const tryOrder = isV3 ? [Spine38Player, SpinePlayer] : [SpinePlayer, Spine38Player];
    let player = null, lastErr = null;
    for (const P of tryOrder) {
      try {
        const pl = new P(this.app);
        await pl.load({ skeletonUrl, atlasUrl, pageBase: base });
        player = pl;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!player) throw lastErr || new Error('预览加载失败');
    this.disposePlayer();
    this.player = player;
    this.viewC.removeChildren();
    this.viewC.addChild(player.getDisplay());
    this.viewC.scale.set(1, 1);
    this.viewC.position.set(0, 0);
    this.viewC.pivot.set(0, 0);
    this.fit();
    return player;
  }

  fit() {
    if (!this.app || !this.player) return;
    let bounds = null;
    try { bounds = this.player.getSkeletonBounds(); } catch (_) {}
    if (!(bounds && bounds.width > 0 && bounds.height > 0 && isFinite(bounds.width))) {
      try {
        const lb = this.viewC.getLocalBounds();
        if (lb && lb.width > 0 && lb.height > 0 && isFinite(lb.width)) bounds = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
      } catch (_) {}
    }
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      this.viewC.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      this.viewC.position.set(this.app.renderer.width / 2, this.app.renderer.height / 2);
    }
    this.viewC.scale.set(1, 1);
  }

  setPaused(p) { this.paused = p; }
  setAction(name, mode) { this.mode = mode || 'loop'; if (this.player) this.player.setAction(name, this.mode); }
  setSpeed(s) { this.speed = s; if (this.player) this.player.setTimeScale(s); }
  setShowBones(b) { if (this.player) this.player.setShowBones && this.player.setShowBones(b); }

  dispose() {
    this.disposePlayer();
    if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
    if (this.app) {
      try { this.app.destroy(true, { children: true }); } catch (_) {}
      this.app = null;
    }
  }
}

// ============ 工具箱页面渲染 ============
let _currentPreview = null;       // 当前预览控制器(离开页面时销毁,避免 WebGL 上下文泄漏)
let _dirTokenCache = new Map();   // dir → token
let _toolFiles = [];              // 文件列表状态:模块级保存,切标签重建页面后恢复(返回转换页列表不丢)
let _toolThumbs = new Map();      // path -> 缩略图 dataURL(模块级缓存,重建后免重新生成)
let _toolOutFiles = [];           // 转换产物文件列表(模块级,跨页面重建保留)

/** 切换到其它工具箱页时调用,销毁预览 WebGL 上下文(否则渲染端 innerHTML 清空但 rAF 循环仍在跑) */
export function disposeSpineConvertPreview() {
  if (_currentPreview) { try { _currentPreview.dispose(); } catch (_) {} _currentPreview = null; }
  _dirTokenCache = new Map();
  // 缩略图隐藏 PIXI app 也在工具内创建,一并销毁避免上下文泄漏
  if (window.__spcThumbApp) {
    try { window.__spcThumbApp.destroy(true, { children: true }); } catch (_) { /* ignore */ }
    window.__spcThumbApp = null;
  }
}

export function renderSpineConvertTool(body) {
  // 离开本工具前销毁上一个预览上下文
  if (_currentPreview) { try { _currentPreview.dispose(); } catch (_) {} _currentPreview = null; }

  // 标题/说明由 toolboxPage.js 的公共 tool-head 渲染(避免与页面自身重复)
  body.innerHTML = `
    <div class="spc-layout">
      <div class="spc-left">
        <div class="tool-card">
          <div class="field-row">
            <label class="field-label">输入(Spine 骨架)</label>
            <div class="field-ctrl">
              <button class="btn" id="spc-pick">选择文件...</button>
              <button class="btn" id="spc-pick-dir">选择目录...</button>
              <span class="spc-count" id="spc-count"></span>
            </div>
          </div>
          <div class="spc-drop" id="spc-drop">把 .skel / .json 文件拖到这里,自动加入右侧列表(支持多选 / 整个文件夹)</div>

          <div class="field-row">
            <label class="field-label">目标格式</label>
            <div class="field-ctrl">
              <select id="spc-fmt">
                <option value="auto">自动(默认:相反格式 skel→json / json→skel)</option>
                <option value="skel">.skel(二进制)</option>
                <option value="json">.json(文本)</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <label class="field-label">目标版本</label>
            <div class="field-ctrl">
              <select id="spc-ver">
                <option value="auto">自动(保持原版本)</option>
                ${VERSION_CHOICES.map((v) => `<option value="${v}">Spine ${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-row">
            <label class="field-label">选项</label>
            <div class="field-ctrl col">
              <label class="chk"><input type="checkbox" id="spc-remove-curve" /> 移除曲线插值(stepped,减小体积)</label>
              <label class="chk"><input type="checkbox" id="spc-outdir-toggle" /> 输出到指定目录(否则保存到源文件同目录)</label>
              <div class="field-ctrl outdir-row" id="spc-outdir-row" style="display:none">
                <input type="text" id="spc-outdir" placeholder="选择输出目录..." readonly />
                <button class="btn" id="spc-outdir-pick">选择目录...</button>
              </div>
              <label class="chk" id="spc-preserve-wrap" style="display:none"><input type="checkbox" id="spc-preserve" checked /> 保持相对目录结构</label>
            </div>
          </div>
          <div class="field-row">
            <div class="field-ctrl">
              <button class="btn primary" id="spc-run" disabled>开始转换(所选)</button>
              <span class="spc-count" id="spc-selcount"></span>
            </div>
          </div>
          <div class="tool-result" id="spc-result"></div>
        </div>
      </div>

      <div class="spc-right">
        <!-- 文件列表视图 -->
        <div class="spc-filelist" id="spc-filelist">
          <div class="spc-fl-top">
            <span class="spc-count" id="spc-count2"></span>
            <span class="spc-fl-hint">点击行打开预览 · 右键更多操作 · 悬停行尾 × 删除</span>
            <button class="btn sm" id="spc-clear">清空列表</button>
          </div>
          <div class="spc-table">
            <div class="spc-tr spc-th">
              <input type="checkbox" id="spc-checkall" title="全选 / 取消全选" />
              <span class="col-thumb">预览</span>
              <span class="col-type">类型</span>
              <span class="col-lib">资源库(在库名称 · 分类位置)</span>
              <span class="col-file">文件名 / 版本</span>
              <span class="col-size">大小</span>
              <span class="col-date">创建时间</span>
              <span class="col-pv">预览</span>
              <span class="col-del"></span>
            </div>
            <div class="spc-rows" id="spc-rows"></div>
          </div>
          <div class="spc-drop" id="spc-drop2">把 .skel / .json 文件拖到这里,自动加入列表(支持多选 / 整个文件夹)</div>
        </div>

        <!-- 预览播放视图 -->
        <div class="spc-preview" id="spc-preview" hidden>
          <div class="spc-preview-head">
            <button class="btn sm" id="spc-back">← 返回列表</button>
            <div class="spc-info" id="spc-info">加载中...</div>
          </div>
          <div class="spc-canvas-wrap"><canvas id="spc-canvas"></canvas></div>
          <div class="spc-controls">
            <button class="btn sm" id="spc-play" disabled>⏸ 暂停</button>
            <select id="spc-anim" style="flex:1;min-width:120px" disabled></select>
            <label class="chk">速度 <input type="range" id="spc-speed" min="0.25" max="2" step="0.25" value="1" style="width:90px" /></label>
            <span id="spc-speed-val" style="font-size:12px;color:var(--text2)">1.0x</span>
            <label class="chk"><input type="checkbox" id="spc-bones" /> 骨骼</label>
            <button class="btn sm" id="spc-fit" disabled>⤢ 适配</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 转换产物文件列表(转换完成后自动加入) -->
    <div class="spc-outwrap">
      <div class="spc-outhead">
        <span class="spc-count" id="spc-outcount">转换产物列表</span>
        <span class="spc-fl-hint">点击行预览 · 右键加入资源库/删除 · 悬停行尾 × 删除</span>
        <button class="btn sm" id="spc-outclear">清空输出列表</button>
      </div>
      <div class="spc-table">
        <div class="spc-tr spc-th">
          <input type="checkbox" id="spc-outcheckall" title="全选 / 取消全选" />
          <span class="col-thumb">预览</span>
          <span class="col-type">类型</span>
          <span class="col-lib">资源库(在库名称 · 分类位置)</span>
          <span class="col-file">文件名 / 版本</span>
          <span class="col-size">大小</span>
          <span class="col-date">创建时间</span>
          <span class="col-pv">预览</span>
          <span class="col-del"></span>
        </div>
        <div class="spc-rows" id="spc-outrows"></div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div class="spc-ctx" id="spc-ctx" hidden>
      <div class="spc-ctx-item" data-act="addlib">➕ 加入资源库分类…</div>
      <div class="spc-ctx-item danger" data-act="remove">🗑 从列表删除</div>
    </div>

    <!-- 加入资源库分类弹层 -->
    <div class="spc-modal" id="spc-cat-modal" hidden>
      <div class="spc-modal-box">
        <div class="spc-modal-title">加入资源库分类</div>
        <div class="spc-modal-list" id="spc-cat-list"></div>
        <div class="spc-modal-actions">
          <button class="btn" id="spc-cat-cancel">取消</button>
        </div>
      </div>
    </div>
  `;

  const listViewEl = body.querySelector('#spc-filelist');
  const rowsEl = body.querySelector('#spc-rows');
  const countEl = body.querySelector('#spc-count');
  const count2El = body.querySelector('#spc-count2');
  const selCountEl = body.querySelector('#spc-selcount');
  const checkAllEl = body.querySelector('#spc-checkall');
  const runBtn = body.querySelector('#spc-run');
  const clearBtn = body.querySelector('#spc-clear');
  const fmtSel = body.querySelector('#spc-fmt');
  const verSel = body.querySelector('#spc-ver');
  const removeCurveEl = body.querySelector('#spc-remove-curve');
  const outToggle = body.querySelector('#spc-outdir-toggle');
  const outRow = body.querySelector('#spc-outdir-row');
  const outDirEl = body.querySelector('#spc-outdir');
  const preserveWrap = body.querySelector('#spc-preserve-wrap');
  const preserveEl = body.querySelector('#spc-preserve');
  const dropEl = body.querySelector('#spc-drop');
  const previewEl = body.querySelector('#spc-preview');
  const infoEl = body.querySelector('#spc-info');
  const canvasEl = body.querySelector('#spc-canvas');
  const playBtn = body.querySelector('#spc-play');
  const animSel = body.querySelector('#spc-anim');
  const speedEl = body.querySelector('#spc-speed');
  const speedVal = body.querySelector('#spc-speed-val');
  const bonesEl = body.querySelector('#spc-bones');
  const fitBtn = body.querySelector('#spc-fit');
  const ctxEl = body.querySelector('#spc-ctx');
  const catModal = body.querySelector('#spc-cat-modal');
  const catListEl = body.querySelector('#spc-cat-list');
  // 转换产物列表
  const outRowsEl = body.querySelector('#spc-outrows');
  const outCountEl = body.querySelector('#spc-outcount');
  const outCheckAllEl = body.querySelector('#spc-outcheckall');
  const outClearBtn = body.querySelector('#spc-outclear');
  const outWrapEl = body.querySelector('#spc-outwrap'); // 转换产物列表容器(不接受拖入)

  // 列表状态引用模块级数组:页面被切走重建后列表仍保留(返回转换页时恢复显示)
  const files = _toolFiles;       // [{ path, name, dir, format, version, versionLabel, valid, reason, selected, size, created, libItem }]
  const outFiles = _toolOutFiles; // 转换产物列表(模块级)
  const _thumbs = _toolThumbs;    // path -> dataURL(模块级缓存)
  let ctxIndex = -1;        // 右键行索引
  let ctxList = 'in';       // 右键所在列表: 'in' 待转换 / 'out' 转换产物
  let catTargetFiles = [];  // 待加入资源库的文件

  const preview = new SpineConvertPreview();
  preview.canvas = canvasEl;
  preview.wrap = canvasEl.parentElement; // .spc-canvas-wrap
  _currentPreview = preview;

  // ---------- 列表渲染(待转换 / 转换产物共用) ----------
  function removeFrom(list, items) {
    const set = new Set(items.map((f) => f.path));
    const keep = list.filter((f) => !set.has(f.path));
    list.length = 0;
    list.push(...keep);
  }

  function renderSpcList(rowsEl, checkAllEl, list, afterChange) {
    rowsEl.innerHTML = list.map((f, i) => rowHtml(f, i)).join('');
    const sel = list.filter((f) => f.selected).length;
    checkAllEl.checked = list.length > 0 && sel === list.length;
    checkAllEl.indeterminate = sel > 0 && sel < list.length;
    rowsEl.querySelectorAll('.spc-row').forEach((row) => {
      const i = +row.getAttribute('data-i');
      const f = list[i];
      bindRow(row, i, f, list, afterChange);
      fillThumb(row.querySelector('.spc-thumb'), f);
    });
  }

  function renderList() {
    countEl.textContent = files.length ? `共 ${files.length} 个` : '';
    count2El.textContent = files.length ? `共 ${files.length} 个 · 已勾选 ${files.filter((f) => f.selected).length} 个` : '列表为空,拖入文件自动加入';
    renderSpcList(rowsEl, checkAllEl, files, () => { renderList(); updateSelCount(); });
    updateSelCount();
  }

  function renderOutList() {
    outCountEl.textContent = outFiles.length ? `转换产物 ${outFiles.length} 个 · 已勾选 ${outFiles.filter((f) => f.selected).length} 个` : '转换产物列表(转换成功后自动加入)';
    renderSpcList(outRowsEl, outCheckAllEl, outFiles, () => renderOutList());
  }

  function rowHtml(f, i) {
    const lib = f.libItem;
    const libCell = lib
      ? `<span class="spc-libname" title="${escHtml(lib.displayName)}">${escHtml(lib.displayName)}</span>
         <span class="spc-libcat">@ ${escHtml(categoryPath(lib.categoryId) || '未分类')}</span>`
      : '<span class="spc-libnone">不在资源库</span>';
    return `
      <div class="spc-tr spc-row ${f.valid ? '' : 'spc-row-bad'}" data-i="${i}" title="点击打开预览播放">
        <input type="checkbox" class="spc-check" ${f.selected ? 'checked' : ''} />
        <span class="col-thumb"><img class="spc-thumb" alt="" /></span>
        <span class="col-type">Spine · ${f.format === 'json' ? 'json' : 'skel'}</span>
        <span class="col-lib">${libCell}</span>
        <span class="col-file">
          <span class="spc-name" title="${escHtml(f.path)}">${escHtml(f.name)}</span>
          <span class="spc-badges">
            <span class="spc-badge ${f.format === 'json' ? 'json' : 'skel'}">${f.format === 'json' ? 'JSON' : 'SKEL'}</span>
            <span class="spc-badge ${f.valid ? 'ok' : 'bad'}">${escHtml(f.versionLabel || (f.valid ? '?' : '无效'))}</span>
          </span>
        </span>
        <span class="col-size">${fmtSize(f.size)}</span>
        <span class="col-date">${fmtDate(f.created)}</span>
        <span class="col-pv"><span class="spc-pv" title="${lib ? '用资源预览页打开' : '不在资源库,无法用资源预览页打开;请先右键加入资源库分类'}">▶ 预览</span></span>
        <span class="col-del"><span class="spc-del" title="从列表删除">×</span></span>
      </div>`;
  }

  function bindRow(row, i, f, list, afterChange) {
    const chk = row.querySelector('.spc-check');
    chk.addEventListener('change', () => { f.selected = chk.checked; afterChange && afterChange(); });
    chk.addEventListener('click', (e) => e.stopPropagation());
    row.addEventListener('click', (e) => {
      if (e.target.closest('.spc-del') || e.target.closest('.spc-check') || e.target.closest('.spc-pv')) return;
      openPreview(f);
    });
    // 「▶ 预览」:库中文件 → 用主程序资源预览页(selectItem)打开;库外 → 提示先加入资源库
    const pv = row.querySelector('.spc-pv');
    pv.addEventListener('click', (e) => {
      e.stopPropagation();
      if (f.libItem) {
        document.dispatchEvent(new CustomEvent('app:previewFromTool', { detail: { itemId: f.libItem.id } }));
      } else {
        toast('该文件不在资源库,无法用资源预览页打开;请右键「加入资源库分类」后再预览', 'warn');
      }
    });
    const del = row.querySelector('.spc-del');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFrom(list, [f]);
      afterChange && afterChange();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctxIndex = i;
      ctxList = list === files ? 'in' : 'out';
      showCtx(e.clientX, e.clientY);
    });
  }

  async function fillThumb(imgEl, f) {
    try {
      let url = _thumbs.get(f.path);
      if (url === undefined) {
        url = null;
        if (f.libItem) {
          url = await thumbnailService.getAnimThumb(f.libItem);
        } else {
          url = await queueExtThumb(f);
        }
        _thumbs.set(f.path, url);
      }
      if (imgEl && url) imgEl.src = url;
    } catch (_) { /* 缩略图失败则保留占位图标 */ }
  }

  // ---- 外部(不在资源库)文件缩略图:用 /spine-pv/<token>/ 路由 + 隐藏 PIXI app 串行渲染首帧 ----
  let _thumbApp = null, _thumbView = null, _thumbChain = Promise.resolve();
  async function ensureThumbApp() {
    if (_thumbApp) return _thumbApp;
    const PIXI = await getPixi();
    const app = new PIXI.Application();
    await app.init({
      width: 96, height: 96, backgroundAlpha: 0, antialias: true,
      resolution: 1, preserveDrawingBuffer: true, preference: 'webgl', autoStart: false,
    });
    _thumbApp = app;
    window.__spcThumbApp = app; // 供 disposeSpineConvertPreview 清理
    _thumbView = new PIXI.Container();
    app.stage.addChild(_thumbView);
    return app;
  }
  function queueExtThumb(f) {
    const run = _thumbChain.then(() => makeExtThumb(f).catch(() => null));
    _thumbChain = run.then(() => {}, () => {});
    return run;
  }
  async function makeExtThumb(f) {
    await ensureThumbApp();
    const token = await getDirToken(f.dir);
    const base = `${location.origin}/spine-pv/${token}/`;
    const skeletonUrl = base + encodeURIComponent(f.name);
    const atlasName = await findAtlasName(f);
    const atlasUrl = atlasName ? base + encodeURIComponent(atlasName) : null;
    const isV3 = (f.version || '').startsWith('3');
    const P = isV3 ? Spine38Player : SpinePlayer;
    const player = new P(_thumbApp);
    await player.load({ skeletonUrl, atlasUrl: atlasUrl || undefined, pageBase: base });
    _thumbView.removeChildren();
    _thumbView.addChild(player.getDisplay());
    const actions = player.actions || [];
    if (actions.length && typeof player.setAction === 'function') player.setAction(actions[0].name, 'loop');
    if (typeof player.stepTo === 'function') { try { player.stepTo(0.2); } catch (_) { /* ignore */ } }
    _thumbApp.render();
    let bounds = null;
    try { bounds = player.getSkeletonBounds(); } catch (_) { bounds = null; }
    if (!(bounds && bounds.width > 0 && isFinite(bounds.width))) {
      try {
        const lb = _thumbView.getLocalBounds();
        if (lb && lb.width > 0 && isFinite(lb.width)) bounds = lb;
      } catch (_) { bounds = null; }
    }
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      _thumbView.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      _thumbView.position.set(48, 48);
      const s = Math.min(88 / bounds.width, 88 / bounds.height, 4);
      _thumbView.scale.set(s, s);
    }
    _thumbApp.render();
    const url = _thumbApp.renderer.extract.canvas(_thumbView).toDataURL('image/png');
    _thumbView.removeChildren();
    try { player.dispose(); } catch (_) { /* ignore */ }
    return url;
  }

  function updateSelCount() {
    const sel = files.filter((f) => f.selected && f.valid);
    selCountEl.textContent = sel.length ? `已选 ${sel.length} 个待转换` : (files.length ? '未勾选 → 将转换全部有效文件' : '');
    runBtn.disabled = !files.some((f) => f.valid);
  }

  // ---------- 视图切换(列表 ↔ 预览) ----------
  let _curPreviewPath = null;
  function showListView() {
    previewEl.hidden = true;
    listViewEl.hidden = false;
    _curPreviewPath = null;
    if (preview.player) { try { preview.setPaused(true); } catch (_) {} }
  }
  function showPreviewView() {
    listViewEl.hidden = true;
    previewEl.hidden = false;
  }
  body.querySelector('#spc-back').addEventListener('click', () => {
    showListView();
  });

  // ---------- 预览 ----------
  async function getDirToken(dir) {
    if (_dirTokenCache.has(dir)) return _dirTokenCache.get(dir);
    const r = await window.api.spinePreviewRegister({ dir });
    if (!r.ok) throw new Error('注册预览目录失败:' + r.error);
    _dirTokenCache.set(dir, r.token);
    return r.token;
  }

  async function findAtlasName(file) {
    try {
      const c = await window.api.collectFiles({ paths: [file.dir], extensions: ['atlas'] });
      const atlasFiles = (c.ok ? (c.files || []) : []).map((f) => basename(f.path));
      const base = file.name.replace(/\.[^.]+$/, '');
      return atlasFiles.find((n) => n.replace(/\.[^.]+$/, '') === base) || atlasFiles[0] || null;
    } catch (_) { return null; }
  }

  async function openPreview(file) {
    if (!file || !file.valid) { setResult('该文件无法识别,不能预览', 'warn'); return; }
    _curPreviewPath = file.path;
    showPreviewView();
    infoEl.innerHTML = `加载中:${escHtml(file.name)} ...`;
    let token;
    try { token = await getDirToken(file.dir); } catch (e) { infoEl.innerHTML = '⚠ ' + escHtml(e.message); return; }
    const atlasName = await findAtlasName(file);
    if (!atlasName) {
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · 格式 ${file.format === 'json' ? 'JSON' : 'SKEL'} · 版本 ${escHtml(file.versionLabel || file.version || '未知')}<br>⚠ 未找到同名 .atlas 图集,无法渲染贴图(仅能解析骨骼结构)。`;
      resetPreviewUI();
      return;
    }
    try {
      const player = await preview.load(file, token, atlasName);
      playBtn.disabled = false; fitBtn.disabled = false; bonesEl.disabled = false;
      preview.setPaused(false); playBtn.textContent = '⏸ 暂停';
      animSel.disabled = false;
      animSel.innerHTML = player.actions.map((a, i) => `<option value="${i}">${escHtml(a.name)} (${a.duration ? a.duration.toFixed(2) + 's' : '?'})</option>`).join('');
      if (player.actions.length) { preview.setAction(player.actions[0].name, 'loop'); }
      speedVal.textContent = '1.0x';
      speedEl.value = 1;
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · ${file.format === 'json' ? 'JSON' : 'SKEL'} · Spine ${escHtml(file.versionLabel || file.version || '?')} · ${player.actions.length} 个动画 · 运行时 ${file.version.startsWith('3') ? '3.x' : '4.x'}`;
    } catch (e) {
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · Spine ${escHtml(file.versionLabel || file.version || '?')}<br>⚠ 预览失败:${escHtml(e.message)}`;
      resetPreviewUI();
    }
  }

  function resetPreviewUI() {
    playBtn.disabled = true; fitBtn.disabled = true; bonesEl.disabled = true; animSel.disabled = true;
    animSel.innerHTML = '';
  }

  playBtn.addEventListener('click', () => {
    const p = !preview.paused;
    preview.setPaused(p);
    playBtn.textContent = p ? '▶ 播放' : '⏸ 暂停';
  });
  animSel.addEventListener('change', () => {
    const a = preview.player && preview.player.actions[+animSel.value];
    if (a) preview.setAction(a.name, 'loop');
  });
  speedEl.addEventListener('input', () => {
    const s = +speedEl.value;
    preview.setSpeed(s);
    speedVal.textContent = s.toFixed(2) + 'x';
  });
  bonesEl.addEventListener('change', () => preview.setShowBones(bonesEl.checked));
  fitBtn.addEventListener('click', () => preview.fit());

  // ---------- 拖拽加入列表 ----------
  if (!window.__spcDragGuard) {
    window.__spcDragGuard = true;
    const pd = (e) => { e.preventDefault(); };
    window.addEventListener('dragover', pd);
    window.addEventListener('drop', pd);
  }
  /** 收集拖拽事件中的文件/目录绝对路径(Electron 43 无 File.path,须经 dragUtils.getPathForFile) */
  function collectDroppedPaths(e) {
    return new Promise((resolve) => {
      const paths = [];
      const push = (f) => {
        if (!f) return;
        let p = null;
        try { p = window.dragUtils ? window.dragUtils.getPathForFile(f) : (f.path || null); } catch (err) { p = null; }
        if (p && !paths.includes(p)) paths.push(p);
      };
      const items = e.dataTransfer ? e.dataTransfer.items : null;
      let pending = 0;
      const done = () => { if (--pending <= 0) resolve(paths); };
      if (items) {
        for (const it of items) {
          if (it.kind !== 'file') continue;
          let entry = null;
          try { entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch (err) { entry = null; }
          if (entry && (entry.isFile || entry.isDirectory)) {
            pending++;
            try { entry.file((f) => { push(f); done(); }, () => done()); } catch (err) { done(); }
          }
        }
      }
      if (pending === 0) {
        if (e.dataTransfer && e.dataTransfer.files) {
          for (const f of e.dataTransfer.files) push(f);
        }
        resolve(paths);
      }
    });
  }
  function attachDrop(zone) {
    // 工具接管拖拽:清除主界面 contentPanel 的"松开鼠标添加资源"提示
    // (contentPanel 的 drop/dragleave 被 stopPropagation 拦截,不会自己清)
    const clearPanelHint = () => {
      try {
        const cp = document.getElementById('content-panel');
        if (cp) cp.classList.remove('drop-target');
      } catch (_) { /* ignore */ }
    };
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 工具接管拖拽:不再触发主界面 contentPanel 的资源库添加流程
      clearPanelHint();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // ⚠ 必须:否则冒泡到 contentPanel 会把文件加入资源库并 renderMainArea 重建页面,列表被清空
      clearPanelHint();
      zone.classList.remove('over');
      const ps = await collectDroppedPaths(e);
      if (ps.length) await addPaths(ps);
    });
  }
  attachDrop(dropEl);
  attachDrop(listViewEl);

  // 转换产物列表(输出):仅拦截拖放,不接收文件 —— 避免拖到该区域时误触发主界面资源库添加流程
  function blockDrop(zone) {
    const clearPanelHint = () => {
      try {
        const cp = document.getElementById('content-panel');
        if (cp) cp.classList.remove('drop-target');
      } catch (_) { /* ignore */ }
    };
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); clearPanelHint(); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); clearPanelHint(); });
  }
  if (outWrapEl) blockDrop(outWrapEl);

  async function addPaths(rawPaths) {
    // 拆分:直接是 Spine 骨架文件的 → 直接收集;否则(无扩展名/非目标扩展)按目录递归扫描
    const targets = [];
    const dirs = [];
    for (const p of rawPaths) {
      const ex = extname(p).toLowerCase().replace('.', '');
      if (SPINE_EXTS.includes(ex)) targets.push(p);
      else dirs.push(p);
    }
    if (dirs.length) {
      setResult('正在扫描目录...', 'busy');
      for (const d of dirs) {
        try {
          const c = await window.api.collectFiles({ paths: [d], extensions: SPINE_EXTS });
          if (c.ok) targets.push(...(c.files || []).map((f) => f.path));
        } catch (_) { /* 非目录则忽略 */ }
      }
    }
    const uniq = [];
    for (const p of targets) if (!uniq.includes(p)) uniq.push(p);
    if (!uniq.length) { setResult('⚠ 未找到 Spine 骨架文件(.skel / .json / .bin)', 'warn'); return; }

    // 重复检测:已在待转换列表 / 已在资源库 → 弹窗让用户选择是否仍加入
    const inList = uniq.filter((p) => files.some((f) => f.path === p));
    const inLib = uniq.filter((p) => !files.some((f) => f.path === p) && matchLibItem(p));
    if (inList.length || inLib.length) {
      const all = [...inList, ...inLib];
      const shown = all.slice(0, 6).map((p) => basename(p)).join('、');
      const more = all.length > 6 ? ` 等 ${all.length} 个` : '';
      const reason = [
        inList.length ? `${inList.length} 个已在待转换列表` : '',
        inLib.length ? `${inLib.length} 个已在资源库中` : '',
      ].filter(Boolean).join(';');
      confirmDialog({
        title: '重复文件',
        message: `检测到重复:<b>${escHtml(shown)}</b>${more}<br><span style="color:var(--text2)">${escHtml(reason)}</span><br>是否仍将这些文件加入待转换列表?`,
        okText: '仍加入列表',
        onOk: () => addPathsInner(uniq, true),
      });
      return;
    }
    addPathsInner(uniq, false);
  }

  async function addPathsInner(targets, force) {
    setResult('正在识别文件版本...', 'busy');
    for (const p of targets) {
      if (!force && files.some((f) => f.path === p)) continue; // 非强制时仍跳过列表内重复
      let probe = null;
      try { probe = await window.api.spineProbe({ inputPath: p }); } catch (e) { probe = { ok: false, reason: e.message }; }
      let stat = null;
      try { stat = await window.api.statFile(p); } catch (_) { /* ignore */ }
      files.push({
        path: p, name: basename(p), dir: dirOf(p),
        format: probe.format || (extname(p).toLowerCase() === '.json' ? 'json' : 'skel'),
        version: probe.version || '', versionLabel: probe.versionLabel || '',
        valid: !!probe.ok, reason: probe.reason || '', selected: true,
        size: (stat && stat.size) || null,
        mtime: (stat && stat.mtime) || null,
        created: (stat && stat.created) || null,
        libItem: matchLibItem(p),
      });
    }
    renderList();
    if (files.some((f) => f.valid)) setResult('', 'idle');
    else setResult('⚠ 所选文件均无法识别为 Spine 骨骼(未检测到 x.y.z 版本号)', 'warn');
  }

  // ---------- 选择文件 / 目录 ----------
  body.querySelector('#spc-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({
      title: '选择 Spine 骨架文件(可多选)',
      filters: [{ name: 'Spine 骨架', extensions: SPINE_EXTS }],
    });
    if (r.canceled || !r.filePaths.length) return;
    await addPaths(r.filePaths);
  });
  body.querySelector('#spc-pick-dir').addEventListener('click', async () => {
    const r = await window.api.pickFiles({ directory: true, title: '选择目录(递归收集其中所有 Spine 骨架)' });
    if (r.canceled || !r.filePaths.length) return;
    const dir = r.filePaths[0];
    setResult('正在扫描目录...', 'busy');
    const c = await window.api.collectFiles({ paths: [dir], extensions: SPINE_EXTS });
    const ps = (c.ok ? (c.files || []).map((f) => f.path) : []);
    if (!ps.length) { setResult('⚠ 该目录未找到 Spine 骨架文件', 'warn'); return; }
    await addPaths(ps);
  });

  outToggle.addEventListener('change', updateOutdirUI);
  body.querySelector('#spc-outdir-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({ directory: true, title: '选择输出目录' });
    if (!r.canceled && r.filePaths.length) outDirEl.value = r.filePaths[0];
  });
  clearBtn.addEventListener('click', () => {
    files.length = 0;      // 原地清空(引用模块级数组)
    _thumbs.clear();
    outDirEl.value = '';
    _curPreviewPath = null;
    showListView();
    preview.disposePlayer();
    renderList();
    setResult('', 'idle');
  });

  // ---------- 全选 / 取消全选(待转换 + 转换产物) ----------
  checkAllEl.addEventListener('change', () => {
    const on = checkAllEl.checked;
    files.forEach((f) => { f.selected = on; });
    renderList();
  });
  outCheckAllEl.addEventListener('change', () => {
    const on = outCheckAllEl.checked;
    outFiles.forEach((f) => { f.selected = on; });
    renderOutList();
  });
  outClearBtn.addEventListener('click', () => {
    outFiles.length = 0;
    renderOutList();
  });

  // ---------- 右键菜单 ----------
  function showCtx(x, y) {
    ctxEl.hidden = false;
    const mw = ctxEl.offsetWidth || 150;
    const mh = ctxEl.offsetHeight || 64;
    ctxEl.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 4)) + 'px';
    ctxEl.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 4)) + 'px';
  }
  function hideCtx() { ctxEl.hidden = true; ctxIndex = -1; }
  window.addEventListener('mousedown', (e) => {
    if (!ctxEl.hidden && !e.target.closest('#spc-ctx')) hideCtx();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ctxEl.hidden) hideCtx(); });
  // 右键目标文件集:右键行已勾选 → 全部勾选;否则仅该文件(ctxList 区分待转换/产物列表)
  function ctxTargetFiles() {
    const arr = ctxList === 'out' ? outFiles : files;
    const f = arr[ctxIndex];
    if (!f) return [];
    if (f.selected) return arr.filter((x) => x.selected && x.valid);
    return f.valid ? [f] : [];
  }
  ctxEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    const targets = ctxTargetFiles();
    hideCtx();
    if (item.dataset.act === 'addlib') {
      if (!targets.length) { toast('没有可加入资源库的有效文件', 'warn'); return; }
      catTargetFiles = targets;
      openCatModal();
    } else if (item.dataset.act === 'remove') {
      const arr = ctxList === 'out' ? outFiles : files;
      const row = arr[ctxIndex];
      if (row) {
        removeFrom(arr, [row]);
        if (ctxList === 'out') renderOutList();
        else { renderList(); setResult('', 'idle'); }
      }
    }
  });

  // ---------- 加入资源库分类弹层 ----------
  function buildCatTree(parentId, depth, out) {
    state.categories.filter((c) => (c.parentId || '') === parentId).forEach((c) => {
      out.push({ id: c.id, name: c.name, depth });
      buildCatTree(c.id, depth + 1, out);
    });
  }
  function openCatModal() {
    const tree = [];
    buildCatTree('', 0, tree);
    if (!tree.length) { toast('资源库还没有分类目录,请先在主页创建分类', 'warn'); return; }
    catListEl.innerHTML = tree.map((c) => `
      <div class="spc-cat-item" data-cat="${escHtml(c.id)}" style="padding-left:${10 + c.depth * 16}px" title="${escHtml(categoryPath(c.id))}">
        ${c.depth ? '└ ' : ''}${escHtml(c.name)}
      </div>`).join('');
    catModal.hidden = false;
    catListEl.querySelectorAll('.spc-cat-item').forEach((el) => {
      el.addEventListener('click', () => {
        addToLibrary(catTargetFiles, el.getAttribute('data-cat'));
        catModal.hidden = true;
      });
    });
  }
  body.querySelector('#spc-cat-cancel').addEventListener('click', () => { catModal.hidden = true; });
  catModal.addEventListener('click', (e) => { if (e.target === catModal) catModal.hidden = true; });

  async function addToLibrary(list, categoryId) {
    let added = 0, dup = 0;
    for (const f of list) {
      const fp = normPath(f.path);
      const exists = state.items.some((it) => (it.categoryId || '') === categoryId && normPath(it.filePath) === fp);
      if (exists) { dup++; continue; }
      const base = f.name.replace(/\.[^.]+$/, '');
      let atlasPath = null;
      try {
        const an = await findAtlasName(f);
        if (an) atlasPath = joinPath(f.dir, an);
      } catch (_) { /* ignore */ }
      addItem({
        categoryId, type: 'spine', filePath: f.path, atlasPath,
        displayName: base, size: f.size, mtime: f.mtime || f.created || null,
      });
      f.libItem = matchLibItem(f.path); // 重新匹配,列表立即显示库中位置
      added++;
    }
    renderList();
    renderOutList(); // 产物列表的库中位置也可能变化,一并刷新
    document.dispatchEvent(new CustomEvent('library:changed')); // 侧栏资源树刷新
    const catName = categoryById(categoryId) ? categoryPath(categoryId) : '未分类';
    toast(added ? `已加入资源库:${added} 个 → ${catName}` : '文件已在目标分类中', added ? 'ok' : 'warn');
  }

  /** 转换成功后把产物文件加入「转换产物列表」(列表内去重,并探测版本/取大小/创建时间) */
  async function addOutFile(p, outFormat) {
    if (outFiles.some((f) => f.path === p)) return;
    let probe = null;
    try { probe = await window.api.spineProbe({ inputPath: p }); } catch (e) { probe = { ok: false, reason: e.message }; }
    let stat = null;
    try { stat = await window.api.statFile(p); } catch (_) { /* ignore */ }
    outFiles.push({
      path: p, name: basename(p), dir: dirOf(p),
      format: outFormat || (extname(p).toLowerCase() === '.json' ? 'json' : 'skel'),
      version: probe.version || '', versionLabel: probe.versionLabel || '',
      valid: !!probe.ok, reason: probe.reason || '', selected: true,
      size: (stat && stat.size) || null,
      mtime: (stat && stat.mtime) || null,
      created: (stat && stat.created) || null,
      libItem: matchLibItem(p),
    });
    renderOutList();
  }

  // ---------- 转换 ----------
  function updateOutdirUI() {
    const on = outToggle.checked;
    outRow.style.display = on ? '' : 'none';
    preserveWrap.style.display = on ? '' : 'none';
  }

  function decideOutput(inputPath, fmtChoice, verChoice, useOutDir, outDir, preserve, baseDir) {
    const inExt = extname(inputPath).toLowerCase();
    const inFormat = inExt === '.json' ? 'json' : 'skel';
    // 默认(auto):skel → json、json → skel(相反格式)
    const outFormat = fmtChoice === 'auto' ? (inFormat === 'json' ? 'skel' : 'json') : fmtChoice;
    const outExt = outFormat === 'json' ? '.json' : '.skel';
    const base = inputPath.replace(/\.[^.\\/]+$/, '');
    if (!useOutDir) {
      if (outExt !== inExt || verChoice !== 'auto') return base + outExt;
      return base + '_converted' + outExt; // 同格式同版本:避免覆盖原文件
    }
    const rel = preserve ? relFrom(baseDir, inputPath).replace(/\.[^.]+$/, '') + outExt : basename(inputPath).replace(/\.[^.]+$/, '') + outExt;
    return joinPath(outDir, rel);
  }

  async function doConvert(list) {
    const valid = list.filter((f) => f.valid);
    if (!valid.length) { setResult('没有可转换的有效文件', 'warn'); return; }
    const fmt = fmtSel.value;
    const ver = verSel.value;
    const useOutDir = outToggle.checked;
    const outDir = outDirEl.value.trim();
    const preserve = preserveEl.checked;
    if (useOutDir && !outDir) { setResult('请先选择输出目录', 'warn'); return; }
    runBtn.disabled = true;
    let okCount = 0, fail = [];
    const total = valid.length;
    for (let i = 0; i < total; i++) {
      const f = valid[i];
      setResult(`处理 ${i + 1}/${total}: ${f.name}`, 'busy');
      const outputPath = decideOutput(f.path, fmt, ver, useOutDir, outDir, preserve, f.dir);
      try {
        const r = await window.api.spineConvert({
          inputPath: f.path, outputPath,
          targetVersion: ver === 'auto' ? undefined : ver,
          removeCurve: removeCurveEl.checked,
        });
        if (r.ok) {
          okCount++;
          await addOutFile(outputPath, fmt === 'auto' ? (f.format === 'json' ? 'skel' : 'json') : fmt); // 产物加入底部列表
        } else {
          fail.push(`${f.name}: ${r.error}`);
        }
      } catch (e) {
        fail.push(`${f.name}: ${e.message}`);
      }
      if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
    }
    const failHtml = fail.length ? `<details class="batch-fail"><summary>失败 ${fail.length} 个(点击展开)</summary><ul>${fail.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul></details>` : '';
    const outDirSet = [];
    for (const f of valid) {
      const d = decideOutput(f.path, fmt, ver, useOutDir, outDir, preserve, f.dir).replace(/[\\/][^\\/]*$/, '');
      if (d && !outDirSet.includes(d)) outDirSet.push(d);
    }
    const openBtns = okCount ? outDirSet.map((d, i) => `<button class="btn" data-open-dir="${escHtml(d)}" title="${escHtml(d)}">${outDirSet.length > 1 ? '打开所在目录 ' + (i + 1) : '打开输出目录'}</button>`).join('') : '';
    body.querySelector('#spc-result').innerHTML = `
      <div class="result-ok">✓ 转换完成:成功 ${okCount} / 失败 ${fail.length}</div>
      <div class="batch-summary">
        ${useOutDir ? `<div class="result-path">输出目录:<code>${escHtml(outDir)}</code></div>` : (outDirSet.length > 1 ? '<div class="result-path">输出位置:各源文件所在目录</div>' : '<div class="result-path">输出位置:源文件同目录</div>')}
        ${failHtml}
        <div class="batch-actions">${openBtns}</div>
      </div>`;
    body.querySelector('#spc-result').querySelectorAll('[data-open-dir]').forEach((btn) => {
      btn.addEventListener('click', () => window.api.openPath(btn.getAttribute('data-open-dir')));
    });
    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', () => {
    const sel = files.filter((f) => f.selected && f.valid);
    doConvert(sel.length ? sel : files.filter((f) => f.valid));
  });

  function setResult(msg, type) {
    const el = body.querySelector('#spc-result');
    if (!el) return;
    if (type === 'idle' || !msg) { el.innerHTML = ''; return; }
    const cls = type === 'err' ? 'result-err' : (type === 'warn' ? 'result-warn' : (type === 'busy' ? 'result-busy' : 'result-ok'));
    el.innerHTML = `<div class="${cls}">${escHtml(msg)}</div>`;
  }

  updateOutdirUI();
  renderList();
  renderOutList();
}
