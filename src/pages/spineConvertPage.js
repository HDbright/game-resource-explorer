// 资源工具箱 → Spine 格式转换
// 复用 SpineSkeletonDataConverter(C++ 原生 EXE,来自 SpineSkeletonDataConverter 项目)做:
//   - skel ↔ json 双向转换
//   - 跨 Spine 版本升级/降级(3.5-3.8 / 4.0-4.3),自动识别输入版本
// 另支持 LayaAir .sk 输入(调用内置 layaSk2Spine 逆向转换器):
//   - .sk → Spine 3.8 骨架 .json + 纹理图集 .atlas(同目录输出,复用 sk2spine 工具)
//   - 目标格式选 .skel 或目标版本选 3.x(≠3.8)时,对产物链式调用 spineConvert
//   - .sk 输入行预览/缩略图用官方 Laya 引擎播放器(LayaSkPlayer)直接渲染
// 另支持 Spine 编辑器工程文件 .spine 输入(内置逆向解码器 spineProjectToJson):
//   - .spine → 明文可读 .decoded.json(骨骼/插槽/附件/动画关键帧全量数据)
//   - 工程格式为编辑器专有二进制(raw DEFLATE + 自定义序列化),无法直接预览播放;
//     目标格式/目标版本选项对其不适用(产物固定为解码 JSON,命名 <名>.decoded.json)
// 页面功能:选择文件/目录、拖拽文件自动进入「文件列表区」、逐文件版本/格式自动识别、
// 批量/单个转换、目标格式默认 skel→json / json→skel / sk→json、移除曲线插值、输出目录选项。
// 文件列表区:勾选(单选/多选/全选)、预览缩略图、已在资源库时显示库中名称与分类位置、
// 点击行打开预览播放页(可返回)、右键 加入资源库分类 / 从列表删除、悬停 × 删除。

import { Spine38Player } from '../preview/spine38Player.js';
import { SpinePlayer } from '../preview/spinePlayer.js';
import { probeSkeleton } from '../preview/skelProbe.js';
import { getPixi } from '../pixiLazy.js';
import { state, categoryById, categoryPath, addItem } from '../state.js';
import { thumbnailService } from '../thumbnails.js';
import { toast, confirmDialog, openModal, footButtons, showContextMenu } from '../dialogs.js';

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

/** 列表行格式标签:'sk' = Laya .sk 逆向输入 / 'json' / 'skel' / 'spine' = 编辑器工程文件 */
function fmtBadge(f) {
  if (f.format === 'sk') return { cls: 'sk', text: 'SK', type: 'Laya · .sk' };
  if (f.format === 'spine') return { cls: 'spine', text: '工程', type: 'Spine · .spine 工程' };
  if (f.format === 'json') return { cls: 'json', text: 'JSON', type: 'Spine · json' };
  return { cls: 'skel', text: 'SKEL', type: 'Spine · skel' };
}

// sk:LayaAir 骨骼动画(layaSk2Spine 逆向转换);spine:Spine 编辑器工程文件(spineProjectToJson 逆向解码);
// skel/bin:Spine 二进制;json:Spine 文本
const SPINE_EXTS = ['skel', 'json', 'bin', 'sk', 'spine'];
const VERSION_CHOICES = ['3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2', '4.3'];

/**
 * 探测骨架文件是否为 Spine 3.x(需要 3.8 运行时)。
 * 不能依赖转换结果的 version 字段:.sk 转换出的 version 是 Laya 版本串
 * (如 "LAYAANIMATION:1.7.0"),据此判断会把 3.8 格式的产物误交给 4.x 运行时 ——
 * 4.x 不读 3.8 风格 mesh 的 uvs,渲染成碎片错位。这里直接探测产物内容。
 */
async function probeIsV3(skeletonUrl) {
  try {
    const res = await fetch(skeletonUrl);
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    const probe = probeSkeleton(buf);
    return !!(probe && /^3\./.test(probe.version));
  } catch (err) {
    return false;
  }
}

// ============ 预览控制器(自包含,复用 spine 播放器) ============
/**
 * Spine 转换工具预览:与 PreviewController 对齐的 PIXI app + ticker + 缩放/平移 + fit,
 * 用 /spine-pv/<token>/ 路由加载资源。
 */
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
    // Laya .sk 输入:官方 Laya 引擎直接解析播放(此分支 atlasName 参数传入同名 .png 贴图;
    // urlKey 传真实文件路径 —— 官方 Templet 依路径中的 newspine/unlimit 标记决定计数宽度)
    if (file.format === 'sk') {
      const { LayaSkPlayer } = await import('../preview/layaSkPlayer.js');
      const player = new LayaSkPlayer(this.app);
      await player.load({
        skUrl: base + encodeURIComponent(file.name),
        pngUrl: base + encodeURIComponent(atlasName),
        urlKey: file.path,
      });
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
    const skeletonUrl = base + encodeURIComponent(file.name);
    const atlasUrl = base + encodeURIComponent(atlasName);
    // 版本判断必须探测产物内容(.sk 转换出的 version 是 Laya 版本串,不能用于判断 Spine 版本)
    const isV3 = await probeIsV3(skeletonUrl);
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
const _collapsedCats = new Set(); // 分类树折叠状态(分类 id;模块级,跨弹窗/页面重建保留,默认全展开)

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
            <label class="field-label">输入(Spine 骨架 / Laya .sk / .spine 工程)</label>
            <div class="field-ctrl">
              <button class="btn" id="spc-pick">选择文件...</button>
              <button class="btn" id="spc-pick-dir">选择目录...</button>
              <span class="spc-count" id="spc-count"></span>
            </div>
          </div>
          <div class="spc-drop" id="spc-drop">把 .skel / .json / .sk / .spine 文件拖到这里,自动加入右侧列表(支持多选 / 整个文件夹)</div>

          <div class="field-row">
            <label class="field-label">目标格式</label>
            <div class="field-ctrl">
              <select id="spc-fmt">
                <option value="auto">自动(默认:相反格式 skel→json / json→skel / sk→json / spine工程→明文json)</option>
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
            <span class="spc-fl-hint">点击行打开预览 · 右键 打开文件位置 / 加库 / 删除 · 悬停行尾 × 删除</span>
            <button class="btn sm" id="spc-clear">清空列表</button>
          </div>
          <div class="spc-table">
            <div class="spc-tr spc-th">
              <input type="checkbox" id="spc-checkall" title="全选 / 取消全选" />
              <span class="col-thumb">预览</span>
              <span class="col-type">类型</span>
              <span class="col-lib" title="在资源库中名称·分类位置">资源库</span>
              <span class="col-file">文件名 / 版本</span>
              <span class="col-size">大小</span>
              <span class="col-date">创建时间</span>
              <span class="col-pv">预览</span>
              <span class="col-del"></span>
            </div>
            <div class="spc-rows" id="spc-rows"></div>
          </div>
          <div class="spc-drop" id="spc-drop2">把 .skel / .json / .sk / .spine 文件拖到这里,自动加入列表(支持多选 / 整个文件夹)</div>
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
          <span class="col-lib" title="在资源库中名称·分类位置">资源库</span>
          <span class="col-file">文件名 / 版本</span>
          <span class="col-size">大小</span>
          <span class="col-date">创建时间</span>
          <span class="col-pv">预览</span>
          <span class="col-del"></span>
        </div>
        <div class="spc-rows" id="spc-outrows"></div>
      </div>
    </div>

    <!-- 右键菜单改用全局 showContextMenu(挂 document.body,紧贴鼠标位置;见 openRowMenu) -->

    <!-- 加入资源库分类弹层 -->
    <div class="spc-modal" id="spc-cat-modal" hidden>
      <div class="spc-modal-box">
        <div class="spc-modal-title">加入资源库分类</div>
        <div class="spc-cat-hint" id="spc-cat-hint" hidden></div>
        <div class="spc-modal-list" id="spc-cat-list"></div>
        <div class="spc-modal-actions">
          <button class="btn" id="spc-cat-cancel">取消</button>
          <button class="btn primary" id="spc-cat-ok" disabled>确认加入</button>
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
  const catModal = body.querySelector('#spc-cat-modal');
  const catListEl = body.querySelector('#spc-cat-list');
  const catOkBtn = body.querySelector('#spc-cat-ok');
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
    const fb = fmtBadge(f);
    return `
      <div class="spc-tr spc-row ${f.valid ? '' : 'spc-row-bad'}" data-i="${i}" title="点击打开预览播放">
        <input type="checkbox" class="spc-check" ${f.selected ? 'checked' : ''} />
        <span class="col-thumb"><img class="spc-thumb" alt="" /></span>
        <span class="col-type">${fb.type}</span>
        <span class="col-lib">${libCell}</span>
        <span class="col-file">
          <span class="spc-name" title="${escHtml(f.path)}">${escHtml(f.name)}</span>
          <span class="spc-badges">
            <span class="spc-badge ${fb.cls}">${fb.text}</span>
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
      openRowMenu(e.clientX, e.clientY, list, i);
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
    // Spine 工程文件无运行时可渲染形态,不生成缩略图
    if (f.format === 'spine') return null;
    await ensureThumbApp();
    const token = await getDirToken(f.dir);
    const base = `${location.origin}/spine-pv/${token}/`;
    let player;
    if (f.format === 'sk') {
      // Laya .sk:官方引擎直接渲染首帧(需同目录同名 .png 贴图页)
      const { LayaSkPlayer } = await import('../preview/layaSkPlayer.js');
      const pngName = f.name.replace(/\.[^.]+$/, '') + '.png';
      player = new LayaSkPlayer(_thumbApp);
      await player.load({ skUrl: base + encodeURIComponent(f.name), pngUrl: base + encodeURIComponent(pngName), urlKey: f.path });
    } else {
      const skeletonUrl = base + encodeURIComponent(f.name);
      const atlasName = await findAtlasName(f);
      const atlasUrl = atlasName ? base + encodeURIComponent(atlasName) : null;
      // 探测产物内容判断 3.x(f.version 对 .sk 转换产物是 Laya 版本串,不可靠)
      const isV3 = await probeIsV3(skeletonUrl);
      const P = isV3 ? Spine38Player : SpinePlayer;
      player = new P(_thumbApp);
      await player.load({ skeletonUrl, atlasUrl: atlasUrl || undefined, pageBase: base });
    }
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

  /** 预览播放器加载成功后统一启用控制条并填充动画下拉 */
  function activatePlayerUi(player) {
    playBtn.disabled = false; fitBtn.disabled = false; bonesEl.disabled = false;
    preview.setPaused(false); playBtn.textContent = '⏸ 暂停';
    animSel.disabled = false;
    animSel.innerHTML = player.actions.map((a, i) => `<option value="${i}">${escHtml(a.name)} (${a.duration ? a.duration.toFixed(2) + 's' : '?'})</option>`).join('');
    if (player.actions.length) { preview.setAction(player.actions[0].name, 'loop'); }
    speedVal.textContent = '1.0x';
    speedEl.value = 1;
  }

  async function openPreview(file) {
    if (!file || !file.valid) { setResult('该文件无法识别,不能预览', 'warn'); return; }
    _curPreviewPath = file.path;
    showPreviewView();
    // Spine 工程文件(.spine):编辑器专有二进制,无运行时播放器可渲染 —— 提示转换后再预览
    if (file.format === 'spine') {
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · Spine 工程(.spine)· ${escHtml(file.versionLabel || file.version || '?')}<br>` +
        `⚠ 工程文件是 Spine 编辑器专有二进制格式,无法直接预览播放。<br>` +
        `<span style="color:var(--text2)">点击左侧「开始转换」可将其解码为明文 JSON(骨骼/插槽/附件/动画数据),再查看产物;<br>` +
        `或到「骨骼动画编辑器 -> 文件 -> 打开 Spine 工程文件」直接解码打开并编辑(骨骼/插槽/region 附件与 rotate/translate 时间线)。</span>`;
      resetPreviewUI();
      return;
    }
    // 工程解码产物(.decoded.json):是工程数据转储而非运行时骨架,不能用于播放
    if (file.projectDump) {
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · 工程解码 JSON<br>` +
        `⚠ 该文件是 .spine 工程的明文数据转储(含编辑器内部字段),不是运行时骨架格式,无法预览播放。<br>` +
        `<span style="color:var(--text2)">可用文本编辑器打开查看,或右键「打开文件位置」定位。</span>`;
      resetPreviewUI();
      return;
    }
    infoEl.innerHTML = `加载中:${escHtml(file.name)} ...`;
    let token;
    try { token = await getDirToken(file.dir); } catch (e) { infoEl.innerHTML = '⚠ ' + escHtml(e.message); return; }
    // Laya .sk:需同目录同名 .png 贴图页,官方 Laya 引擎直接解析播放原文件
    if (file.format === 'sk') {
      const pngName = file.name.replace(/\.[^.]+$/, '') + '.png';
      let hasPng = false;
      try { const st = await window.api.statFile(joinPath(file.dir, pngName)); hasPng = !!(st && st.size != null); } catch (_) { /* ignore */ }
      if (!hasPng) {
        infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · Laya .sk · ${escHtml(file.versionLabel || file.version || '?')}<br>⚠ 未找到同名 .png 贴图页,无法预览(Laya .sk 需与同名 png 放在同一目录)。`;
        resetPreviewUI();
        return;
      }
      try {
        const player = await preview.load(file, token, pngName);
        activatePlayerUi(player);
        infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · Laya .sk · ${escHtml(file.versionLabel || file.version || '?')} · ${player.actions.length} 个动画 · 运行时 Laya 官方引擎(转换为 Spine 3.8)`;
      } catch (e) {
        infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · Laya .sk<br>⚠ 预览失败:${escHtml(e.message)}`;
        resetPreviewUI();
      }
      return;
    }
    const atlasName = await findAtlasName(file);
    if (!atlasName) {
      infoEl.innerHTML = `<b>${escHtml(file.name)}</b> · 格式 ${file.format === 'json' ? 'JSON' : 'SKEL'} · 版本 ${escHtml(file.versionLabel || file.version || '未知')}<br>⚠ 未找到同名 .atlas 图集,无法渲染贴图(仅能解析骨骼结构)。`;
      resetPreviewUI();
      return;
    }
    try {
      const player = await preview.load(file, token, atlasName);
      activatePlayerUi(player);
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
    if (!uniq.length) { setResult('⚠ 未找到可识别的骨架文件(.skel / .json / .bin / .sk / .spine)', 'warn'); return; }

    // 重复检测:已在待转换列表 / 已在资源库(同路径)/ 库中有同名同内容的另一存储位置副本
    const inList = uniq.filter((p) => files.some((f) => f.path === p));
    const inLib = uniq.filter((p) => !files.some((f) => f.path === p) && matchLibItem(p));
    // 同名同内容(路径不同):与库中同名条目逐个比对(先同名粗筛,再后端 大小+MD5 比对)
    const rest = uniq.filter((p) => !files.some((f) => f.path === p) && !matchLibItem(p));
    const sameContent = [];
    if (rest.length && state.items.length) {
      setResult('正在比对资源库同名文件...', 'busy');
      for (const p of rest) {
        const name = basename(p).toLowerCase();
        const cands = state.items.filter((it) => it.filePath
          && basename(it.filePath).toLowerCase() === name
          && normPath(it.filePath) !== normPath(p));
        for (const it of cands) {
          let cmp = null;
          try { cmp = await window.api.filesIdentical({ a: p, b: it.filePath }); } catch (e) { cmp = { ok: false }; }
          if (cmp && cmp.ok && cmp.same) { sameContent.push({ dropped: p, libItem: it }); break; }
        }
      }
      setResult('', 'idle');
    }
    if (inLib.length || sameContent.length) {
      showLibDupDialog({ inLib, sameContent, inList, uniq });
      return;
    }
    if (inList.length) {
      const shown = inList.slice(0, 6).map((p) => basename(p)).join('、');
      const more = inList.length > 6 ? ` 等 ${inList.length} 个` : '';
      confirmDialog({
        title: '重复文件',
        message: `检测到重复:<b>${escHtml(shown)}</b>${more}<br><span style="color:var(--text2)">${inList.length} 个已在待转换列表</span><br>是否仍将这些文件加入待转换列表?`,
        okText: '仍加入列表',
        onOk: () => addPathsInner(uniq, true),
      });
      return;
    }
    addPathsInner(uniq, false);
  }

  /**
   * 「检测到库中已有文件」弹窗(两类检测命中任一即弹出):
   * - 同路径在库:文件本身就是库中条目 → 主操作照常加入该文件;
   * - 同名同内容、不同存储位置:库中已存在该文件的另一副本 → 主操作改用**库中的**
   *   那份(存储位置)加入待转换区,列表「资源库」列显示在库名称与分类;
   * 已在待转换列表中的重复项主操作自动跳过;「仍加入拖入的文件」保留旧行为(原样路径、
   * 含列表重复);仅在待转换列表中重复(不在库)时仍走 confirmDialog(见 addPaths)。
   */
  function showLibDupDialog({ inLib, sameContent, inList, uniq }) {
    const MAX_SHOW = 8;
    const libRows = inLib.slice(0, MAX_SHOW).map((p) => {
      const it = matchLibItem(p);
      const libName = it ? (it.displayName || basename(p)) : basename(p);
      const cat = it ? (categoryPath(it.categoryId) || '未分类') : '';
      return `<div class="spc-dup-row" title="${escHtml(p)}"><span class="spc-dup-file">${escHtml(basename(p))}</span><span class="spc-dup-lib">库:${escHtml(libName)} @ ${escHtml(cat)}</span></div>`;
    }).join('');
    const libMore = inLib.length > MAX_SHOW ? `<div class="spc-dup-more">… 共 ${inLib.length} 个</div>` : '';
    const dupRows = sameContent.slice(0, MAX_SHOW).map((x) => {
      const it = x.libItem;
      const libName = it.displayName || basename(it.filePath);
      const cat = categoryPath(it.categoryId) || '未分类';
      return `<div class="spc-dup-row" title="库中副本:${escHtml(it.filePath)}"><span class="spc-dup-file">${escHtml(basename(x.dropped))}</span><span class="spc-dup-lib">库中副本:${escHtml(libName)} @ ${escHtml(cat)}</span></div>`;
    }).join('');
    const dupMore = sameContent.length > MAX_SHOW ? `<div class="spc-dup-more">… 共 ${sameContent.length} 个</div>` : '';
    const listHtml = inList.length
      ? `<div class="spc-dup-sec">另有 ${inList.length} 个已在待转换列表(${escHtml(inList.slice(0, 3).map((p) => basename(p)).join('、'))}${inList.length > 3 ? ' 等' : ''})— 主操作将跳过这些重复项</div>`
      : '';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = `
      ${inLib.length ? `<div class="spc-dup-sec">以下 <b>${inLib.length}</b> 个文件已存在库中(加入该文件本身):</div><div class="spc-dup-list">${libRows}${libMore}</div>` : ''}
      ${sameContent.length ? `<div class="spc-dup-sec">以下 <b>${sameContent.length}</b> 个文件在库中存在<b>相同内容、不同存储位置</b>的副本(将加入库中的副本):</div><div class="spc-dup-list">${dupRows}${dupMore}</div>` : ''}
      ${listHtml}
      <p class="hint">「继续,加入待转换区」:已存在库中的文件照常加入;同名同内容文件改用库中存储位置的副本;同批其它文件一并加入。</p>
    `;
    // 主操作路径表:同名同内容 → 替换为库中副本路径;已在待转换列表的重复项跳过;去重
    const libPathByDropped = new Map(sameContent.map((x) => [x.dropped, x.libItem.filePath]));
    const primaryPaths = [];
    for (const p of uniq) {
      if (inList.includes(p)) continue;
      const sub = libPathByDropped.get(p) || p;
      if (!primaryPaths.includes(sub)) primaryPaths.push(sub);
    }
    const skipCount = inList.length;
    const { close } = openModal({
      title: '检测到库中已有该文件',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '仍加入拖入的文件', cls: '', onClick: () => { close(); addPathsInner(uniq, true); } },
        {
          text: '继续,加入待转换区', cls: 'primary',
          onClick: () => {
            close();
            addPathsInner(primaryPaths, false);
            const parts = [];
            if (inLib.length) parts.push(`已在库 ${inLib.length} 个`);
            if (sameContent.length) parts.push(`库中副本 ${sameContent.length} 个`);
            if (skipCount) parts.push(`跳过列表重复 ${skipCount} 个`);
            toast(`已加入待转换列表:${primaryPaths.length} 个${parts.length ? `(${parts.join('、')})` : ''}`, 'ok');
          },
        },
      ]),
    });
  }

  async function addPathsInner(targets, force) {
    setResult('正在识别文件版本...', 'busy');
    for (const p of targets) {
      if (!force && files.some((f) => f.path === p)) continue; // 非强制时仍跳过列表内重复
      // .sk:LayaAir 骨骼动画,走 probeSk2spine(头部 LAYAANIMATION 标记);
      // .spine:Spine 编辑器二进制工程,走 probeSpineProject(raw DEFLATE + 版本串 + 骨骼区标记);
      // 其余走 Spine 版本探测
      let probe = null;
      if (extname(p).toLowerCase() === '.sk') {
        try { probe = await window.api.probeSk2spine({ inputPath: p }); } catch (e) { probe = { ok: false, reason: e.message }; }
        probe = probe.ok
          ? { ok: true, format: 'sk', version: probe.version,
              versionLabel: 'Laya ' + String(probe.version || '').replace(/^LAYAANIMATION:?/i, '') }
          : { ok: false, format: 'sk', reason: probe.reason || '不是 LayaAir .sk 格式' };
      } else if (extname(p).toLowerCase() === '.spine') {
        try { probe = await window.api.probeSpineProject({ inputPath: p }); } catch (e) { probe = { ok: false, reason: e.message }; }
        probe = probe.ok
          ? { ok: true, format: 'spine', version: probe.version,
              versionLabel: '工程 ' + (probe.version || '?') }
          : { ok: false, format: 'spine', reason: probe.reason || '不是 Spine 工程格式' };
      } else {
        try { probe = await window.api.spineProbe({ inputPath: p }); } catch (e) { probe = { ok: false, reason: e.message }; }
      }
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
    else setResult('⚠ 所选文件均无法识别为 Spine / Laya 骨骼(未检测到版本标记)', 'warn');
  }

  // ---------- 选择文件 / 目录 ----------
  body.querySelector('#spc-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({
      title: '选择骨架文件(可多选,支持 Spine .skel/.json、Laya .sk、Spine 工程 .spine)',
      filters: [{ name: '骨架文件(Spine / Laya / Spine 工程)', extensions: SPINE_EXTS }],
    });
    if (r.canceled || !r.filePaths.length) return;
    await addPaths(r.filePaths);
  });
  body.querySelector('#spc-pick-dir').addEventListener('click', async () => {
    const r = await window.api.pickFiles({ directory: true, title: '选择目录(递归收集其中所有骨架文件)' });
    if (r.canceled || !r.filePaths.length) return;
    const dir = r.filePaths[0];
    setResult('正在扫描目录...', 'busy');
    const c = await window.api.collectFiles({ paths: [dir], extensions: SPINE_EXTS });
    const ps = (c.ok ? (c.files || []).map((f) => f.path) : []);
    if (!ps.length) { setResult('⚠ 该目录未找到可识别的骨架文件(.skel / .json / .bin / .sk / .spine)', 'warn'); return; }
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
  // 用全局 showContextMenu(菜单挂 document.body、position:fixed):此前自建的 #spc-ctx
  // 嵌在工具面板内,#app 的 zoom(appearance 界面缩放)会让 fixed 以缩放后的祖先为基准,
  // 菜单按缩放比例偏离鼠标位置;全局菜单在 #app 之外,始终紧贴鼠标弹出。
  // 目标文件集:右键行已勾选 → 全部勾选的;否则仅该行文件。
  function openRowMenu(x, y, list, i) {
    const f = list[i];
    if (!f) return;
    const targets = f.selected ? list.filter((it) => it.selected && it.valid) : (f.valid ? [f] : []);
    showContextMenu(x, y, [
      {
        label: '📂 打开文件位置',
        onClick: () => window.api.showItem(f.path), // 系统文件管理器定位(仅右键所在行)
      },
      {
        label: '➕ 加入资源库分类…',
        onClick: () => {
          if (!targets.length) { toast('没有可加入资源库的有效文件', 'warn'); return; }
          catTargetFiles = targets;
          openCatModal(list === outFiles); // 产物列表 → 按转换前源文件定位
        },
      },
      {
        label: '🗑 从列表删除',
        danger: true,
        onClick: () => {
          removeFrom(list, [f]);
          if (list === outFiles) renderOutList();
          else { renderList(); setResult('', 'idle'); }
        },
      },
    ]);
  }

  // ---------- 加入资源库分类弹层(可折叠树 + 层级连接线 + 默认定位当前所在) ----------
  const CAT_INDENT = 18; // 每层缩进(连接线轨道列宽)
  let catCurId = '';      // 本次打开时定位的分类(产物→转换前源文件在库分类;待转换→文件自身在库分类)
  let catSelId = '';      // 用户点击选中的分类(点「确认加入」才正式加入)
  function catChildrenOf(parentId) {
    return state.categories.filter((c) => (c.parentId || '') === parentId);
  }
  /** 递归渲染分类树节点。连接线与 Todo 树同款机制:
   *  深度≥1 画「本级 L 形分支线」,并恢复祖辈轨道贯穿竖线(非末子祖辈竖线整列下延,
   *  末子分支 └ 形封口),子级容器内为需下延的轨道补贯穿竖线,多层嵌套线条连续。 */
  function buildCatNodeEl(cat, depth, isLast, anc) {
    const kids = catChildrenOf(cat.id);
    const hasChildren = kids.length > 0;
    const collapsed = _collapsedCats.has(cat.id);
    const el = document.createElement('div');
    el.className = 'spc-cat-node';
    el.setAttribute('data-cat', cat.id);

    const row = document.createElement('div');
    row.className = 'spc-cat-row';
    row.style.marginLeft = (depth * CAT_INDENT) + 'px';
    row.title = categoryPath(cat.id) || cat.name;

    const arrow = document.createElement('button');
    arrow.className = 'spc-cat-arrow';
    arrow.textContent = hasChildren ? (collapsed ? '▶\uFE0E' : '▼\uFE0E') : '';
    arrow.style.visibility = hasChildren ? 'visible' : 'hidden';
    arrow.title = hasChildren ? (collapsed ? '展开' : '折叠') : '';
    if (hasChildren) arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_collapsedCats.has(cat.id)) _collapsedCats.delete(cat.id); else _collapsedCats.add(cat.id);
      renderCatTree(false); // 重渲染(高亮保留,不重复滚动)
    });
    row.appendChild(arrow);

    const ico = document.createElement('span');
    ico.className = 'spc-cat-ico';
    ico.textContent = hasChildren ? (collapsed ? '📁' : '📂') : '📁';
    row.appendChild(ico);

    const name = document.createElement('span');
    name.className = 'spc-cat-name';
    name.textContent = cat.name;
    row.appendChild(name);

    // 点击仅选中该分类(高亮);「确认加入」才正式加入;双击 = 选中并立即确认
    row.addEventListener('click', () => selectCat(cat.id));
    row.addEventListener('dblclick', () => { selectCat(cat.id); confirmCatAdd(); });

    const lastArr = [...anc, isLast]; // lastArr[i] = 第 i 层祖先是否末子;lastArr[depth] = 自身
    if (depth >= 1) {
      const segs = [];
      // 祖辈轨道贯穿竖线:挂接层祖先为末子的轨道已封口,不再下延
      for (let lo = 0; lo < depth - 1; lo++) {
        if (lastArr[lo + 1]) continue;
        segs.push(`<i class="spc-tree-line tl-v" style="left:${lo * CAT_INDENT + 9}px;top:-2px;height:calc(100% + 4px)"></i>`);
      }
      // 本级竖线:向上连父恒画;末子封口(半高),非末子整行下延
      const lineX = (depth - 1) * CAT_INDENT + 9;
      segs.push(`<i class="spc-tree-line tl-v" style="left:${lineX}px;top:-2px;height:calc(${isLast ? '50' : '100'}% + 4px)"></i>`);
      segs.push(`<i class="spc-tree-line tl-h" style="left:${lineX}px;top:50%;width:${CAT_INDENT}px"></i>`);
      row.insertAdjacentHTML('afterbegin', `<span class="spc-tree-guides" style="left:${-(depth * CAT_INDENT)}px;width:${depth * CAT_INDENT}px">${segs.join('')}</span>`);
    }
    el.appendChild(row);

    if (hasChildren && !collapsed) {
      const childWrap = document.createElement('div');
      childWrap.className = 'spc-cat-children';
      kids.forEach((k, i) => childWrap.appendChild(buildCatNodeEl(k, depth + 1, i === kids.length - 1, [...anc, isLast])));
      el.appendChild(childWrap);
      // 子级容器补贯穿竖线:非末子祖辈轨道 + 本节点非末子时的自身轨道
      const spanXs = [];
      for (let lo = 0; lo < depth - 1; lo++) {
        if (!lastArr[lo + 1]) spanXs.push(lo * CAT_INDENT + 9);
      }
      if (!isLast) spanXs.push((depth - 1) * CAT_INDENT + 9);
      if (spanXs.length) {
        childWrap.style.position = 'relative';
        childWrap.insertAdjacentHTML('afterbegin',
          spanXs.map((x) => `<i class="spc-tree-line tl-v" style="left:${x}px;top:0;bottom:0;pointer-events:none;z-index:0"></i>`).join(''));
      }
    }
    return el;
  }

  /** 渲染分类树;scroll=true 时滚动到定位分类行(打开弹窗时) */
  function renderCatTree(scroll) {
    const roots = catChildrenOf('');
    const frag = document.createDocumentFragment();
    roots.forEach((c, i) => frag.appendChild(buildCatNodeEl(c, 0, i === roots.length - 1, [])));
    catListEl.innerHTML = '';
    catListEl.appendChild(frag);
    if (catCurId) {
      let curRow = null;
      catListEl.querySelectorAll('.spc-cat-node').forEach((n) => {
        if (!curRow && n.getAttribute('data-cat') === catCurId) curRow = n.querySelector(':scope > .spc-cat-row');
      });
      if (curRow) {
        curRow.classList.add('cur');
        curRow.insertAdjacentHTML('beforeend', '<span class="spc-cat-cur">当前所在</span>');
        if (scroll) requestAnimationFrame(() => { try { curRow.scrollIntoView({ block: 'center' }); } catch (_) {} });
      }
    }
    // 折叠/展开重渲染后恢复已选中分类的高亮
    if (catSelId) {
      catListEl.querySelectorAll('.spc-cat-node').forEach((n) => {
        if (n.getAttribute('data-cat') === catSelId) {
          const r = n.querySelector(':scope > .spc-cat-row');
          if (r) r.classList.add('sel');
        }
      });
    }
  }

  /** 点击分类行:仅选中(高亮 ✓),不立即加入 */
  function selectCat(id) {
    catSelId = id;
    catOkBtn.disabled = !id;
    catListEl.querySelectorAll('.spc-cat-node').forEach((n) => {
      const r = n.querySelector(':scope > .spc-cat-row');
      if (r) r.classList.toggle('sel', n.getAttribute('data-cat') === id);
    });
  }

  /** 「确认加入」:把目标文件正式加入当前选中的分类 */
  function confirmCatAdd() {
    if (!catSelId) return;
    addToLibrary(catTargetFiles, catSelId);
    catModal.hidden = true;
  }

  function openCatModal(fromOut) {
    if (!state.categories.length) { toast('资源库还没有分类目录,请先在主页创建分类', 'warn'); return; }
    // 默认定位:产物列表 → 被转换源文件(待转换区)在库中的分类(srcPath 见 addOutFile)并默认选中;
    //          待转换列表 → 文件自身在库中的分类(仅定位高亮);均不在库则不定位
    catCurId = '';
    let locateLabel = '';
    if (fromOut) {
      const srcLib = catTargetFiles.map((f) => f.srcPath && matchLibItem(f.srcPath)).find(Boolean);
      if (srcLib) { catCurId = srcLib.categoryId || ''; locateLabel = '转换前文件所在'; }
    }
    if (!catCurId) {
      const curFile = catTargetFiles.find((f) => f.libItem);
      if (curFile) { catCurId = curFile.libItem.categoryId || ''; locateLabel = '文件当前所在'; }
    }
    const hintEl = body.querySelector('#spc-cat-hint');
    hintEl.hidden = false;
    if (catCurId && state.categories.some((c) => c.id === catCurId)) {
      // 展开定位分类的祖先链,确保定位行可见
      const byId = new Map(state.categories.map((c) => [c.id, c]));
      let p = byId.get(catCurId);
      while (p) { _collapsedCats.delete(p.id); p = p.parentId ? byId.get(p.parentId) : null; }
      hintEl.innerHTML = `📍 已定位到${locateLabel}分类:<b>${escHtml(categoryPath(catCurId) || '未分类')}</b>`;
    } else {
      catCurId = '';
      hintEl.innerHTML = '';
    }
    // 产物列表且定位到「转换前源文件」所在分类 → 默认选中该分类(✓ 高亮),
    // 「确认加入」立即可用;用户仍可点击其它分类改选
    const preSel = !!(fromOut && catCurId && locateLabel === '转换前文件所在');
    catSelId = preSel ? catCurId : '';
    catOkBtn.disabled = !catSelId;
    if (preSel) hintEl.insertAdjacentHTML('beforeend', '<span class="spc-cat-hint-op">已默认选中,可直接「确认加入」或点击其它分类改选</span>');
    hintEl.insertAdjacentHTML('beforeend', '<span class="spc-cat-hint-op">点击分类选中 →「确认加入」生效(双击可直接加入)</span>');
    renderCatTree(true);
    catModal.hidden = false;
  }
  body.querySelector('#spc-cat-cancel').addEventListener('click', () => { catModal.hidden = true; });
  catOkBtn.addEventListener('click', confirmCatAdd);
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

  /** 转换成功后把产物文件加入「转换产物列表」(列表内去重,并探测版本/取大小/创建时间;
   *  srcPath 记录被转换源文件路径 —— 加库弹窗据此默认定位到源文件在库中的分类;
   *  opts.projectDump = true 标记 .spine 工程解码产物(非运行时骨架,预览时给出说明) */
  async function addOutFile(p, outFormat, srcPath, opts) {
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
      srcPath: srcPath || null,
      projectDump: !!(opts && opts.projectDump),
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
    const inFormat = inExt === '.json' ? 'json' : (inExt === '.sk' ? 'sk' : (inExt === '.spine' ? 'spine' : 'skel'));
    // .spine 工程:固定输出明文解码 JSON,命名 <名>.decoded.json(目标格式/版本选项不适用;
    // 后缀带 .decoded 以免覆盖同目录的运行时骨架 <名>.json)
    if (inFormat === 'spine') {
      const base = inputPath.replace(/\.[^.\\/]+$/, '');
      if (!useOutDir) return base + '.decoded.json';
      const rel = preserve ? relFrom(baseDir, inputPath).replace(/\.[^.]+$/, '') + '.decoded.json' : basename(inputPath).replace(/\.[^.]+$/, '') + '.decoded.json';
      return joinPath(outDir, rel);
    }
    // 默认(auto):skel → json、json → skel、sk → json(Laya .sk 逆向产物固定为 Spine 3.8 JSON)
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
    let okCount = 0, fail = [], notes = [];
    const total = valid.length;
    for (let i = 0; i < total; i++) {
      const f = valid[i];
      setResult(`处理 ${i + 1}/${total}: ${f.name}`, 'busy');
      const outputPath = decideOutput(f.path, fmt, ver, useOutDir, outDir, preserve, f.dir);
      try {
        if (f.format === 'spine') {
          // Spine 工程(.spine)→ 明文解码 JSON:调用内置逆向解码器;
          // 目标格式/版本选项对工程格式不适用(产物固定为 <名>.decoded.json),非默认时提示
          if (fmt !== 'auto' || ver !== 'auto') {
            notes.push(`${f.name}: 工程文件仅支持解码为明文 JSON,已忽略目标格式/目标版本设置`);
          }
          const r = await window.api.spineProject2json({ inputPath: f.path, outputPath });
          if (r.ok) {
            okCount++;
            const s = r.stats || {};
            notes.push(`${f.name}: 解码完成 —— 骨骼 ${s.bones ?? '?'} · 插槽 ${s.slots ?? '?'} · 附件 ${s.attachments ?? '?'} · 动画 ${s.animations ?? '?'}(${s.timelineKeys ?? '?'} 个关键帧)`);
            await addOutFile(outputPath, 'json', f.path, { projectDump: true });
          } else {
            fail.push(`${f.name}: ${r.error}`);
          }
        } else if (f.format === 'sk') {
          // Laya .sk → Spine:先调用内置逆向转换器产出 Spine 3.8 .json + 同名 .atlas;
          // 目标格式为 .skel、或目标版本选了 3.x(≠3.8)时,再对产物链式调用 spineConvert
          const jsonOut = /\.skel$/i.test(outputPath) ? outputPath.replace(/\.skel$/i, '.json') : outputPath;
          const r1 = await window.api.sk2spine({ inputPath: f.path, outputPath: jsonOut });
          if (!r1.ok) {
            fail.push(`${f.name}: ${r1.error}`);
          } else {
            await addOutFile(r1.jsonPath || jsonOut, 'json', f.path);
            if (r1.warn) notes.push(`${f.name}: ${r1.warn}`);
            if (ver !== 'auto' && !ver.startsWith('3')) {
              notes.push(`${f.name}: .sk 逆向产物为 Spine 3.8,不支持跨大版本到 ${ver},已忽略目标版本`);
            }
            const ver3 = (ver !== 'auto' && ver.startsWith('3') && ver !== '3.8') ? ver : null;
            if (/\.skel$/i.test(outputPath) || ver3) {
              const r2 = await window.api.spineConvert({
                inputPath: r1.jsonPath || jsonOut, outputPath,
                targetVersion: ver3 || undefined,
                removeCurve: removeCurveEl.checked,
              });
              if (r2.ok) { await addOutFile(outputPath, 'skel', f.path); okCount++; }
              else fail.push(`${f.name}: ${r2.error}`);
            } else {
              okCount++;
            }
          }
        } else {
          const r = await window.api.spineConvert({
            inputPath: f.path, outputPath,
            targetVersion: ver === 'auto' ? undefined : ver,
            removeCurve: removeCurveEl.checked,
          });
          if (r.ok) {
            okCount++;
            await addOutFile(outputPath, fmt === 'auto' ? (f.format === 'json' ? 'skel' : 'json') : fmt, f.path); // 产物加入底部列表
          } else {
            fail.push(`${f.name}: ${r.error}`);
          }
        }
      } catch (e) {
        fail.push(`${f.name}: ${e.message}`);
      }
      if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
    }
    const failHtml = fail.length ? `<details class="batch-fail"><summary>失败 ${fail.length} 个(点击展开)</summary><ul>${fail.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul></details>` : '';
    const noteHtml = notes.length ? `<details class="batch-fail"><summary>提示 ${notes.length} 条(点击展开)</summary><ul>${notes.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul></details>` : '';
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
        ${noteHtml}
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
