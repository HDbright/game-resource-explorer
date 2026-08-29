/**
 * 骨骼动画编辑器 - 舞台(视口)。
 * PIXI v8 渲染 + 原生指针事件交互(DOM 层做命中检测,坐标系换算自管理)。
 *
 * ctx 契约(由 boneEditorPage 提供):
 *   project / mode('setup'|'anim') / anim(动画对象|null) / frame / tool('select'|'bone')
 *   selection { type, name } / showBones / showGrid / onion / onionRange
 *   select(type, name)                    — 修改选中并刷新
 *   beginEdit(label)                      — 变更前压入撤销快照
 *   refresh()                             — 全量重绘(舞台/面板/时间轴)
 *   editBone(name, props)                 — 写入骨骼变换(绑定姿势或自动关键帧,由页面决定)
 *   createBone(parentName, localX, localY, rotationDeg, length) — 创建骨骼工具落点
 *   bindImageAt(imageId, worldX, worldY)  — 拖图片入舞台:绑到选中骨骼并定位
 */

import { getPixi } from '../pixiLazy.js';
import { toast } from '../dialogs.js';
import { sampleAnimation, computeWorldTransforms, boneTipWorld, worldToParentLocal, angleDelta } from './animator.js';
import { slotsInZOrder } from './model.js';
import { resolveRegionDataUrl } from './spineIO.js';

const COLOR_BONE = 0x4f8cff;
const COLOR_BONE_DIM = 0x3a5a9a;
const COLOR_SEL = 0xff9f43;
const COLOR_HANDLE = 0x46a758;
const COLOR_GHOST_PAST = 0x4f8cff;
const COLOR_GHOST_FUTURE = 0xe5484d;
// pixi v8 混合模式字符串;spine 3.8 BlendMode: 0 normal / 1 additive / 2 multiply / 3 screen
const BLEND_MAP = ['normal', 'add', 'multiply', 'screen'];

/** 骨骼名 -> 色相(与层级树图标同色系,Spine 按骨骼分组着色) */
function boneHue(name) { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
/** hsl -> 0xRRGGBB */
function hslHex(h, s = 65, l = 60) {
  const a = s * Math.min(l, 100 - l) / 100;
  const f = (n) => { const k = (n + h / 30) % 12; const c = l / 100 - a / 100 * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); return Math.round(255 * c); };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
/** 标签文字提亮:向白色混合 t 比例(保留色相分支差异,小字号在暗背景上更清晰) */
function labelBright(hex, t = 0.4) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return (Math.round(r + (255 - r) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(b + (255 - b) * t);
}
/** 刀片原点半宽(渲染与关节环共用):≈长度的6%,保底 1.5 屏幕像素 */
function bladeHalfWidth(len, z) { return Math.max((len || 0) * 0.06, 1.5 / z); }

/** Spine 分支继承着色:单子链继承父色,分支的每个子节点依次取调色板新色,后代继承。
 *  调色板以红/绿/黄三色为主(高亮度,与暗色棋盘背景强反差),后接亮橙/青/品红扩充分支区分度 */
const SPINE_PALETTE = [0xff3b30, 0x35d461, 0xffd21e, 0xff8a1e, 0x35c8ff, 0xff5cc8, 0xc8f53a];
function assignSpineBoneColors(bones) {
  const byParent = new Map();
  for (const b of bones) { const k = b.parent || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(b); }
  const map = new Map(); let ci = 0;
  const walk = (bone, color) => {
    map.set(bone.name, color);
    const kids = byParent.get(bone.name) || [];
    if (kids.length === 1) walk(kids[0], color);
    else for (const k of kids) walk(k, SPINE_PALETTE[ci++ % SPINE_PALETTE.length]);
  };
  const roots = byParent.get('') || [];
  if (roots.length === 1) walk(roots[0], 0xf0f0f0);
  else roots.forEach((r) => walk(r, SPINE_PALETTE[ci++ % SPINE_PALETTE.length]));
  for (const b of bones) if (!map.has(b.name)) map.set(b.name, SPINE_PALETTE[ci++ % SPINE_PALETTE.length]);
  return map;
}

export class EditorStage {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.app = null;
    this.worldC = null;   // 世界容器(相机变换)
    this.gridG = null;
    this.onionG = null;
    this.imageG = null;
    this.boneG = null;
    this.imgCache = new Map(); // imageId → { img, tex, dataUrl }
    this.hitImages = [];      // [{ slotName, quad:[{x,y}×4 }] 按绘制顺序
    this._boneHits = [];      // [{ name, origin:{x,y}, tip:{x,y} }]
    this._spineRT = null;     // Spine 运行时句柄 { spine, data, skeleton, skin }
    this._spineProjRef = null;
    this._spineFailedRef = null; // 运行时初始化失败的工程对象(同一工程失败一次即永久降级,直到工程被替换)
    this._spineMeshes = new Map(); // slotName|attName → { mesh, positions, uvs }
    this._pendingLoads = 0;
    this._regionRetry = 0;
    this._drag = null;
    this._hover = null;
    this._mouseScreen = null; // 鼠标在画布上的屏幕坐标(标尺红色指示线用)
    this._compBone = new Map(); // 骨骼补偿覆盖层:name → {x,y,rotation}(编辑器预览,不入存档/撤销)
    this._compImg = new Map();  // 图片补偿覆盖层:slotName → {x,y,rotation, _att}
    this._ro = null;
    this._disposed = false;
    this._labelPool = [];   // PIXI.Text 复用池
    this._labelUsed = 0;
  }

  async mount(container) {
    this.container = container;
    try { window.__beStage = this; } catch (err) { /* 调试探针 */ }
    const PIXI = await getPixi();
    this.PIXI = PIXI;
    container.classList.add('be-stage-host');
    container.innerHTML = '';

    const app = new PIXI.Application();
    await app.init({
      background: 0x535253,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      // 不用 resizeTo:PIXI 内部 ResizeObserver 会把 resize 推迟到 ticker 下一拍清屏,
      // 与下方自管 RO 双重缩放错拍 -> 拖拽分界线时画布黑屏闪烁;尺寸统一由 syncViewport 管理
    });
    if (this._disposed) { app.destroy(true); return; }
    app.canvas.className = 'be-stage-canvas';
    container.appendChild(app.canvas);
    this.app = app;

    // 透明背景棋盘格(#5A595D / #535253 交错,参考 Spine):屏幕空间平铺,不随相机移动
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 96; bgCanvas.height = 96;
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.fillStyle = '#5A595D'; bgCtx.fillRect(0, 0, 96, 96);
    bgCtx.fillStyle = '#535253'; bgCtx.fillRect(0, 0, 48, 48); bgCtx.fillRect(48, 48, 48, 48);
    this.bgSprite = new PIXI.TilingSprite({ texture: PIXI.Texture.from(bgCanvas), width: 8, height: 8 });
    app.stage.addChildAt(this.bgSprite, 0);
    this._sizeBg();

    this.worldC = new PIXI.Container();
    this.worldC.sortableChildren = true;
    app.stage.addChild(this.worldC);
    this.gridG = new PIXI.Graphics();
    this.onionG = new PIXI.Container();
    this.imageG = new PIXI.Container();
    this.boneG = new PIXI.Graphics();
    this.boneG.eventMode = 'none';
    this.worldC.addChild(this.gridG, this.onionG, this.imageG, this.boneG);
    // 标签层:屏幕空间(不挂 worldC、不随相机缩放)——文字按设备像素 1:1 栅格化,任何缩放级别都清晰
    this.labelC = new PIXI.Container();
    this.labelC.eventMode = 'none';
    app.stage.addChild(this.labelC);
    this._labelRes = Math.min(window.devicePixelRatio || 1, 2);
    // 旋转工具手柄(程序化绘制):青色圆弧留缺口,缺口处白色箭头指向圆心外;缺口方向实时对齐骨骼世界方向
    this._rotateHandleG = new PIXI.Graphics();
    this._rotateHandleG.visible = false;
    this._rotateHandleG.eventMode = 'none';
    this.labelC.addChild(this._rotateHandleG);

    // 指针交互(canvas DOM 层,自行换算坐标)
    const cv = app.canvas;
    cv.addEventListener('pointerdown', (e) => this._onDown(e));
    // 注意:包装函数须独立命名,不可自引用赋值(否则 (e)=>this._onMove(e) 调用自身 → 栈溢出)
    this._onMoveH = (e) => this._onMove(e);
    this._onUpH = (e) => this._onUp(e);
    window.addEventListener('pointermove', this._onMoveH);
    window.addEventListener('pointerup', this._onUpH);
    window.addEventListener('pointerup', (e) => { if (e.button === 2) this._onUpPan(e); });
    cv.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // 双击图片/骨骼:层级树滚动定位到对应节点并展开未展开的祖先
    cv.addEventListener('dblclick', (e) => {
      const wp = this.toWorld(e.clientX, e.clientY);
      const img = this._hitImage(wp.x, wp.y);
      if (img) { this.ctx.revealInTree?.('slot', img); return; }
      const bone = this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y);
      if (bone) this.ctx.revealInTree?.('bone', bone);
    });
    // 鼠标离开舞台:清掉标尺红色指示线
    cv.addEventListener('pointerleave', () => {
      if (this._mouseScreen) { this._mouseScreen = null; this.renderRulers(); }
    });
    // 资源库拖图入舞台
    container.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-bone-img')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    container.addEventListener('drop', (e) => this._onDrop(e));

    // 容器尺寸变化(窗口布局/兜底)时:尺寸未变直接跳过,避免重复 resize 清屏闪烁;
    // 拖拽分界线的高频路径由页面在 pointermove 同任务内调 syncViewport,不依赖这里
    this._ro = new ResizeObserver(() => {
      if (this._disposed || !this.app?.renderer) return;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (this.app.renderer.width === w && this.app.renderer.height === h) return;
      this.syncViewport();
    });
    this._ro.observe(container);

    // 标尺 canvas(Spine 风格,与舞台同级的兄弟元素)
    const center = container.parentElement;
    this._rulerH = center?.querySelector('.be-ruler-h') || null;
    this._rulerV = center?.querySelector('.be-ruler-v') || null;
    this.syncViewport();
  }

  /**
   * 同步视口尺寸并重绘:读容器当前尺寸 -> resize 渲染缓冲 -> 全量重绘。
   * 拖拽分界线的 pointermove 里与样式变更同任务调用,保证浏览器绘制该帧前
   * 画布缓冲已与新布局一致,消除「布局先行、缓冲滞后」的黑屏闪烁。
   */
  syncViewport() {
    if (this._disposed || !this.app?.renderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this._sizeBg();
    this.render();
  }

  dispose() {
    this._disposed = true;
    if (this._onMoveH) window.removeEventListener('pointermove', this._onMoveH);
    if (this._onUpH) window.removeEventListener('pointerup', this._onUpH);
    if (this._ro) this._ro.disconnect();
    this._spineMeshes.clear();
    this._spineRT = null;
    this._spineProjRef = null;
    this._spineFailedRef = null;
    clearTimeout(this._regionTimer);
    for (const v of this.imgCache.values()) { try { v.tex.destroy(true); } catch (err) { /* ignore */ } }
    for (const t of this._labelPool) { try { t.destroy({ children: true }); } catch (err) { /* ignore */ } }
    this._labelPool = [];
    this.imgCache.clear();
    if (this.app) { try { this.app.destroy(true, { children: true }); } catch (err) { /* ignore */ } this.app = null; }
    if (this.container) this.container.innerHTML = '';
  }

  // ---------------- 坐标换算 ----------------

  /** 应用级 CSS zoom 系数(外观设置「字体字号缩放」写 #app.style.zoom):
   *  zoom≠1 时 clientX 是根视口像素、getBoundingClientRect 是视觉像素,二者相减须除回该系数。
   *  getComputedStyle 会触发样式重算,标尺/鼠标移动高频调用 -> 200ms 缓存(设置变更瞬间滞后可忽略) */
  _zoomFactor() {
    const now = performance.now();
    if (this._zfCache && now - this._zfCache.t < 200) return this._zfCache.v;
    let v = 1;
    try {
      const z = parseFloat(getComputedStyle(document.getElementById('app')).zoom);
      if (Number.isFinite(z) && z > 0) v = z;
    } catch (err) { /* ignore */ }
    this._zfCache = { v, t: now };
    return v;
  }

  toWorld(clientX, clientY) {
    const r = this.app.canvas.getBoundingClientRect();
    const zf = this._zoomFactor();
    const sx = (clientX - r.left) / zf, sy = (clientY - r.top) / zf;
    return { x: (sx - this.camera.x) / this.camera.zoom, y: (sy - this.camera.y) / this.camera.zoom };
  }

  applyCamera() {
    this.worldC.position.set(this.camera.x, this.camera.y);
    this.worldC.scale.set(this.camera.zoom);
  }

  zoomAt(clientX, clientY, factor) {
    const r = this.app.canvas.getBoundingClientRect();
    const zf = this._zoomFactor();
    const sx = (clientX - r.left) / zf, sy = (clientY - r.top) / zf;
    const before = { x: (sx - this.camera.x) / this.camera.zoom, y: (sy - this.camera.y) / this.camera.zoom };
    this.camera.zoom = Math.min(8, Math.max(0.08, this.camera.zoom * factor));
    this.camera.x = sx - before.x * this.camera.zoom;
    this.camera.y = sy - before.y * this.camera.zoom;
    this.render();
  }

  /** 视图控制:以画布中心缩放(舞台浮层按钮用) */
  zoomBy(factor) {
    if (!this.app) return;
    const r = this.app.canvas.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  /** 缩放适配所有内容(骨骼 + 贴图) */
  fitAll() {
    const b = this.contentBounds();
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 500;
    if (!b) { this.camera = { x: w / 2, y: h / 2, zoom: 1 }; this.render(); return; }
    const pad = 80;
    const z = Math.min(3, Math.max(0.08, Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h))));
    this.camera.zoom = z;
    this.camera.x = w / 2 - (b.x + b.w / 2) * z;
    this.camera.y = h / 2 - (b.y + b.h / 2) * z;
    this.render();
  }

  contentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const push = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
    for (const h of this._boneHits) { push(h.origin.x, h.origin.y); push(h.tip.x, h.tip.y); }
    for (const im of this.hitImages) for (const p of im.quad) push(p.x, p.y);
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** 棋盘格背景铺满画布(容器尺寸变化时调用) */
  _sizeBg() {
    if (!this.bgSprite || !this.app) return;
    this.bgSprite.width = this.app.screen.width;
    this.bgSprite.height = this.app.screen.height;
  }

  /** 渲染 Spine 风格标尺(水平 + 垂直),带自适应小刻度 */
  renderRulers() {
    if (!this.ctx.showRulers) return;
    const z = this.camera.zoom;
    // 像素密度一次算好共用:含 #app CSS zoom(外观字号缩放拉伸画布的补偿),避免每个标尺重复强制样式重算
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this._zoomFactor();
    // 对齐设备像素网格:文字/刻度线不再半像素模糊
    const snap = (v) => Math.round(v * dpr) / dpr;
    // 用父容器尺寸(canvas 绝对定位后 clientWidth 可能不准)
    const center = this.container.parentElement;
    const centerW = center ? center.clientWidth : this.container.clientWidth;
    const centerH = center ? center.clientHeight : this.container.clientHeight;
    // 根据缩放自动选择主刻度步长
    let step;
    if (z < 0.15) step = 1000;
    else if (z < 0.3) step = 500;
    else if (z < 0.7) step = 200;
    else if (z < 2) step = 100;
    else if (z < 5) step = 50;
    else step = 20;

    // 自适应小刻度:目标屏幕间距 ~10px,取 1/2/5 × 10^n 的整齐值
    const targetPx = 10;
    const rawMinor = targetPx / z;
    const mag = Math.pow(10, Math.floor(Math.log10(rawMinor)));
    const norm = rawMinor / mag;
    let minorStep;
    if (norm < 1.5) minorStep = mag;
    else if (norm < 3.5) minorStep = 2 * mag;
    else if (norm < 7.5) minorStep = 5 * mag;
    else minorStep = 10 * mag;
    // 小刻度不粗于主刻度
    if (minorStep >= step) minorStep = step / 2;
    if (minorStep < 1) minorStep = 1;

    // ---- 水平标尺 ----
    const rh = this._rulerH;
    if (rh) {
      const rw = centerW; // 全幅(与画布同原点,交汇区由 corner 块覆盖)
      const rhH = 22;
      const bw = Math.round(rw * dpr), bh = Math.round(rhH * dpr);
      if (rh.width !== bw || rh.height !== bh) { rh.width = bw; rh.height = bh; }
      const rc = rh.getContext('2d');
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.clearRect(0, 0, rw, rhH);
      rc.fillStyle = '#2a2d36';
      rc.fillRect(0, 0, rw, rhH);
      const x0w = -this.camera.x / z;
      // 小刻度(先画,被主刻度覆盖)
      const msStart = Math.floor(x0w / minorStep) * minorStep;
      const msEnd = Math.ceil((x0w + rw / z) / minorStep) * minorStep;
      rc.strokeStyle = '#a5adb8';
      rc.lineWidth = 0.5;
      for (let gx = msStart; gx <= msEnd; gx += minorStep) {
        const sx = snap((gx - x0w) * z);
        if (sx < -2 || sx > rw + 2) continue;
        if (gx % step === 0) continue; // 跳过主刻度位置
        rc.beginPath();
        rc.moveTo(sx, 16);
        rc.lineTo(sx, rhH);
        rc.stroke();
      }
      // 主刻度 + 数字(每个主刻度都带数字)
      const gxStart = Math.floor(x0w / step) * step;
      const gxEnd = Math.ceil((x0w + rw / z) / step) * step;
      rc.strokeStyle = '#b5bcc8';
      rc.fillStyle = '#e0e4ea';
      rc.font = '10px Consolas, monospace';
      rc.textAlign = 'center';
      rc.textBaseline = 'top';
      for (let gx = gxStart; gx <= gxEnd; gx += step) {
        const sx = snap((gx - x0w) * z);
        if (sx < -20 || sx > rw + 20) continue;
        const isSuper = gx % (step * 2) === 0;
        rc.lineWidth = isSuper ? 1 : 0.7;
        rc.beginPath();
        rc.moveTo(sx, isSuper ? 4 : 8);
        rc.lineTo(sx, rhH);
        rc.stroke();
        rc.fillText(String(gx), sx, 1);
      }
      // 底边线
      rc.strokeStyle = '#666b78';
      rc.lineWidth = 1;
      rc.beginPath(); rc.moveTo(0, rhH - 0.5); rc.lineTo(rw, rhH - 0.5); rc.stroke();
      // 鼠标位置指示线(红色,贯穿标尺高度;坐标即画布屏幕坐标)
      if (this._mouseScreen) {
        rc.strokeStyle = '#ff4d4f';
        rc.lineWidth = 1;
        rc.beginPath();
        rc.moveTo(this._mouseScreen.sx + 0.5, 0);
        rc.lineTo(this._mouseScreen.sx + 0.5, rhH);
        rc.stroke();
      }
    }

    // ---- 垂直标尺 ----
    const rv = this._rulerV;
    if (rv) {
      const rvW = 22;
      const rvH = centerH; // 全幅(与画布同原点,交汇区由 corner 块覆盖)
      const bw = Math.round(rvW * dpr), bh = Math.round(rvH * dpr);
      if (rv.width !== bw || rv.height !== bh) { rv.width = bw; rv.height = bh; }
      const rc = rv.getContext('2d');
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.clearRect(0, 0, rvW, rvH);
      rc.fillStyle = '#2a2d36';
      rc.fillRect(0, 0, rvW, rvH);
      const y0w = -this.camera.y / z;
      // 小刻度
      const msStart = Math.floor(y0w / minorStep) * minorStep;
      const msEnd = Math.ceil((y0w + rvH / z) / minorStep) * minorStep;
      rc.strokeStyle = '#a5adb8';
      rc.lineWidth = 0.5;
      for (let gy = msStart; gy <= msEnd; gy += minorStep) {
        const sy = snap((gy - y0w) * z);
        if (sy < -2 || sy > rvH + 2) continue;
        if (gy % step === 0) continue;
        rc.beginPath();
        rc.moveTo(16, sy);
        rc.lineTo(rvW, sy);
        rc.stroke();
      }
      // 主刻度 + 数字(每个主刻度都带数字)
      const gyStart = Math.floor(y0w / step) * step;
      const gyEnd = Math.ceil((y0w + rvH / z) / step) * step;
      rc.strokeStyle = '#b5bcc8';
      rc.fillStyle = '#e0e4ea';
      rc.font = '10px Consolas, monospace';
      rc.textAlign = 'right';
      rc.textBaseline = 'middle';
      for (let gy = gyStart; gy <= gyEnd; gy += step) {
        const sy = snap((gy - y0w) * z);
        if (sy < -20 || sy > rvH + 20) continue;
        const isSuper = gy % (step * 2) === 0;
        rc.lineWidth = isSuper ? 1 : 0.7;
        rc.beginPath();
        rc.moveTo(isSuper ? 4 : 8, sy);
        rc.lineTo(rvW, sy);
        rc.stroke();
        {
          rc.save();
          rc.translate(8, sy);
          rc.rotate(-Math.PI / 2);
          rc.fillText(String(gy), 0, 0);
          rc.restore();
        }
      }
      // 右边线
      rc.strokeStyle = '#666b78';
      rc.lineWidth = 1;
      rc.beginPath(); rc.moveTo(rvW - 0.5, 0); rc.lineTo(rvW - 0.5, rvH); rc.stroke();
      // 鼠标位置指示线(红色,贯穿标尺宽度)
      if (this._mouseScreen) {
        rc.strokeStyle = '#ff4d4f';
        rc.lineWidth = 1;
        rc.beginPath();
        rc.moveTo(0, this._mouseScreen.sy + 0.5);
        rc.lineTo(rvW, this._mouseScreen.sy + 0.5);
        rc.stroke();
      }
    }
  }

  // ---------------- 纹理 ----------------

  _syncTextures() {
    const p = this.ctx.project;
    let dirty = false;
    let pendingRegion = false;
    const alive = new Set();
    for (const img of p.images || []) {
      alive.add(img.id);
      // Spine region:页图异步加载,裁剪成功后才有 dataUrl
      const url = img.dataUrl || (img.spineRegion ? resolveRegionDataUrl(p, img) : '');
      if (!url) { pendingRegion = true; continue; }
      const c = this.imgCache.get(img.id);
      if (c && c.dataUrl === url) continue;
      if (c) { try { c.tex.destroy(true); } catch (err) { /* ignore */ } }
      this.imgCache.delete(img.id);
      this._pendingLoads++;
      dirty = true;
      const el = new Image();
      el.onload = () => {
        this._pendingLoads--;
        const tex = this.PIXI.Texture.from(el);
        this.imgCache.set(img.id, { img: el, tex, dataUrl: url });
        if (this._pendingLoads <= 0) this.render();
      };
      el.onerror = () => { this._pendingLoads--; };
      el.src = url;
    }
    for (const id of [...this.imgCache.keys()]) {
      if (!alive.has(id)) { const c = this.imgCache.get(id); try { c.tex.destroy(true); } catch (err) { /* ignore */ } this.imgCache.delete(id); }
    }
    // region 页图尚未就绪:稍后重试渲染(裁剪缓存就绪后自然收敛)
    if (pendingRegion && this._regionRetry < 200) {
      this._regionRetry++;
      dirty = true;
      clearTimeout(this._regionTimer);
      this._regionTimer = setTimeout(() => this.render(), 90);
    } else if (!pendingRegion) {
      this._regionRetry = 0;
    }
    this._texPending = pendingRegion; // 纹理是否全部就绪(自动适配用)
    return dirty;
  }

  // ---------------- 渲染 ----------------

  render() {
    if (!this.app || this._disposed) return;
    const ctx = this.ctx;
    const p = ctx.project;
    this._syncTextures();
    this.applyCamera();

    // ---- Spine 导入项目:官方 3.8 运行时渲染(IK/变换约束/网格蒙皮完整求解) ----
    // .spine 工程文件解码打开的项目(raw 为工程解码数据,非运行时 JSON)不走运行时,走下方近似渲染
    if (p.spine && p.spine.family === '3' && !p.spine.project) {
      // 工程对象被替换(撤销/重做/导入)→ 重建运行时。
      // 不能仅凭 _spineProjRef !== p 判断:初始化失败的分支会把 _spineProjRef 置空,
      // 降级 render 走到这里就会误判「工程被替换」清掉失败标志 → 失败→重试→再失败
      // 的微任务风暴,刷屏式 console.warn 饿死渲染线程(打开 3.8.75 等工程即整个编辑器卡死)。
      // 失败以 _spineFailedRef === p 为准:同一工程只降级一次,换工程对象才允许重新初始化。
      if (this._spineProjRef !== p && this._spineFailedRef !== p) {
        this._spineRT = null;
        this._spineProjRef = null;
        this._spineMeshes.clear();
        this._spineFailed = false;
        this._spineFitDone = false; // 新工程 -> 重新自动适配
      }
      // 失败后永久降级(自绘近似),避免「失败→重试→再失败」微任务风暴饿死主线程
      if (!this._spineRT && !this._spineIniting && this._spineFailedRef !== p) this._initSpineRT(p);
      if (this._spineRT && this._spineProjRef === p) {
        this.gridG.clear();
        if (ctx.showGrid) this._drawGrid();
        this._drawAxes();
        this.onionG.removeChildren();
        this.imageG.removeChildren();
        this.boneG.clear();
        const pose = (ctx.mode === 'anim' && ctx.anim) ? sampleAnimation(ctx.anim, ctx.frame) : null;
        this._pose = pose;
        if (ctx.onion && ctx.mode === 'anim' && ctx.anim) {
          for (const off of [-ctx.onionRange, ctx.onionRange]) {
            const f = ctx.frame + off;
            if (f < 0 || f > ctx.anim.duration) continue;
            const host = new this.PIXI.Container();
            this._renderSpineSlots(sampleAnimation(ctx.anim, f), host, off < 0 ? COLOR_GHOST_PAST : COLOR_GHOST_FUTURE, 0.25, true);
            this.onionG.addChild(host);
          }
        }
        this._renderSpineSlots(pose, this.imageG, 0xffffff, 1, false);
        this._drawBones(); // 内部决定:开关开=全量;开关关=仅选中+树悬停的焦点骨骼
        this._drawBoneLabels();
        this._drawTreeHover();
        this._drawTransformHandle();
        this._drawImgBoxes();
        // 载入自动适配:内容(骨骼/图片)有尺寸即先适配;纹理全部就绪后做最终适配并收手
        // (此前仅 _loadProject 时同步 fitAll 一次,Spine RT 异步初始化后无人再适配 -> 内容不居中)
        // 注意:①fitAll 末尾会调 render -> 须防重入,否则无限递归卡死渲染线程;
        //       ②首帧图片纹理尚未异步加载完(hitImages 为空,内容框只含骨骼),不能提前收手
        if (!this._spineFitDone && !this._spineFitting) {
          const b = this.contentBounds();
          if (b && b.w > 4 && b.h > 4) {
            this._spineFitting = true;
            try { this.fitAll(); } finally { this._spineFitting = false; }
            const texReady = !this._texPending && (this._pendingLoads || 0) <= 0 && (this.hitImages || []).length > 0;
            if (texReady) { this._spineFitDone = true; this.ctx.onAutoFit?.(); }
          }
        }
        this.renderRulers();
        return;
      }
    }
    if (p.spine) { this._spineRT = null; this._spineProjRef = null; this._spineMeshes.clear(); }

    const pose = (ctx.mode === 'anim' && ctx.anim) ? sampleAnimation(ctx.anim, ctx.frame) : null;
    this._pose = pose;
    this.worlds = computeWorldTransforms(p, pose, this._compObj());

    this._boneHits = [];
    this.hitImages = [];

    // 图层清理(与 RT 路径一致):洋葱皮/图片/骨骼层逐帧重建,防累积残影(此前非 RT 路径缺失)
    this.onionG.removeChildren();
    this.imageG.removeChildren();
    this.boneG.clear();

    // 洋葱皮(过去=蓝 / 未来=红)
    if (ctx.onion && ctx.mode === 'anim' && ctx.anim) {
      for (const off of [-ctx.onionRange, ctx.onionRange]) {
        const f = ctx.frame + off;
        if (f < 0 || f > ctx.anim.duration) continue;
        const host = new this.PIXI.Container();
        const gpose = sampleAnimation(ctx.anim, f);
        this._renderSlots(gpose, host, off < 0 ? COLOR_GHOST_PAST : COLOR_GHOST_FUTURE, 0.25, true);
        this.onionG.addChild(host);
      }
    }

    this.gridG.clear();
    if (ctx.showGrid) this._drawGrid();
    this._drawAxes(); // 坐标轴常驻显示(含打开编辑器默认态)
    this._renderSlots(pose, this.imageG, 0xffffff, 1, false);
    this._drawBones(); // 内部决定:开关开=全量;开关关=仅选中+树悬停的焦点骨骼
    this._drawBoneLabels();
    this._drawTreeHover();
    this._drawTransformHandle();
    this._drawImgBoxes();
    this.renderRulers();
  }

  /** 初始化 Spine 3.8 运行时(region 元数据来自 atlas;纹理用编辑器裁剪 region 图) */
  _initSpineRT(p) {
    this._spineIniting = true;
    (async () => {
      const { loadSpine38Bundle } = await import('../preview/spine38Player.js');
      const { parseAtlasText } = await import('./spineIO.js');
      const spine = await loadSpine38Bundle();
      // atlas 区块信息 → region 桩(u/v 置 0..1 对应裁剪后的整图;width/orig/offset 与 spine-ts TextureAtlas 一致)
      const atlas = p.spine.atlasText ? parseAtlasText(p.spine.atlasText) : { regions: new Map() };
      const stub = (path) => {
        const r = atlas.regions.get(path) || null;
        return {
          rotate: false, u: 0, v: 0, u2: 1, v2: 1,
          width: r ? r.w : 1, height: r ? r.h : 1,
          originalWidth: r ? (r.ow || r.w) : 1, originalHeight: r ? (r.oh || r.h) : 1,
          offsetX: r ? (r.ox || 0) : 0, offsetY: r ? (r.oy || 0) : 0,
        };
      };
      const loader = {
        newRegionAttachment: (skin, name, path) => {
          const att = new spine.RegionAttachment(name);
          att.setRegion(stub(path));
          return att;
        },
        newMeshAttachment: (skin, name, path) => {
          const att = new spine.MeshAttachment(name);
          att.region = stub(path);
          return att;
        },
        newWeightedMeshAttachment: (skin, name, path) => {
          const att = new spine.MeshAttachment(name);
          att.region = stub(path);
          return att;
        },
        newRegionSequenceAttachment: (skin, name, path) => {
          const att = new spine.RegionAttachment(name);
          att.setRegion(stub(path));
          return att;
        },
        newPathAttachment: (skin, name, path) => new spine.PathAttachment(name),
        newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
        newPointAttachment: (skin, name) => new spine.PointAttachment(name),
        newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
      };
      // 官方 3.8 运行时对版本串 "3.8.75"(编辑器 3.8.7 beta 导出,数据格式与 3.8 final 兼容)
      // 直接抛 "Unsupported skeleton data..."。二进制路径已有 patchRejectedVersionBinary 改写,
      // JSON 路径同样处理:浅拷贝骨架头改写版本串绕过守卫,不动原始 raw(导出回写保持真实版本),
      // 解析成功后恢复真实版本串(仅用于显示)。
      let rawJson = p.spine.raw;
      let patchedOrigVersion = null;
      if (rawJson && rawJson.skeleton && rawJson.skeleton.spine === '3.8.75') {
        patchedOrigVersion = rawJson.skeleton.spine;
        rawJson = { ...rawJson, skeleton: { ...rawJson.skeleton, spine: '3.8.99' } };
      }
      const data = new spine.SkeletonJson(loader).readSkeletonData(rawJson);
      if (patchedOrigVersion) data.version = patchedOrigVersion;
      const skeleton = new spine.Skeleton(data);
      const skin = data.findSkin(p.spine.skin) || data.defaultSkin;
      this._spineRT = { spine, data, skeleton, skin };
      this._spineProjRef = p;
      this._spineFailedRef = null;
      this._spineIniting = false;
      this._spineMeshes.clear();
      // 首帧渲染试跑:解析成功但渲染期出错(如附件结构异常)也走降级,不抛回 init 循环
      try {
        this.render();
      } catch (renderErr) {
        this._spineRT = null;
        this._spineProjRef = null;
        this._spineFailed = true;
        this._spineFailedRef = p;
        this._spineMeshes.clear();
        console.warn('[boneEditor] Spine 运行时渲染失败,降级为近似渲染:', renderErr);
        this.render();
      }
    })().catch((err) => {
      this._spineIniting = false;
      // 运行时解析失败 → 一次性降级(自绘近似),绝不自动重试
      this._spineFailed = true;
      this._spineFailedRef = p;
      this._spineRT = null;
      this._spineProjRef = null;
      this._spineMeshes.clear();
      console.warn('[boneEditor] Spine 运行时初始化失败,使用近似渲染:', err);
      try { this.render(); } catch (e) { /* ignore */ }
    });
  }

  /**
   * Spine 模式渲染:编辑器姿态写入运行时骨骼 → updateWorldTransform(应用 IK/变换约束)
   * → 按插槽顺序取附件世界顶点(网格含权重蒙皮)绘制 PIXI Mesh。
   * 坐标:spine y 向上;写入 pixi 前对 y 取负。
   */
  _renderSpineSlots(pose, host, tint, alphaMul, ghost) {
    const ctx = this.ctx;
    const p = ctx.project;
    const { spine, data, skeleton, skin } = this._spineRT;
    // Options·图片关闭时的焦点附件:选中的附件(自身可见)仍单独显示 —— 与骨骼
    // 「显示关闭时仅绘制焦点骨骼」的行为一致;两处循环共用同一焦点索引保证几何/纹理一致
    const selAtt = !ctx.showImages && !ghost && ctx.selection && ctx.selection.type === 'att' ? ctx.selection : null;

    // 0) 插槽附件与颜色先行设置(deform 时间线按 slot 当前附件匹配;attachment 切换由编辑器采样决定)
    const drawList = skeleton.drawOrder;
    for (const rtSlot of skeleton.slots) {
      const es = p.armature.slots.find((s) => s.name === rtSlot.data.name);
      if (!es) { rtSlot.setAttachment(null); continue; }
      const ov = pose && pose.slots[es.name];
      let di = es.displayIndex;
      if (selAtt && es.name === selAtt.slot) di = selAtt.index; // 焦点附件:渲染被选中的那一个显示对象
      else if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = es.displays[di];
      // Spine 皮肤语义:激活皮肤未覆盖的插槽回退 default 皮肤(共享附件,如武器)
      let att = (disp && disp.visible !== false) ? skin.getAttachment(rtSlot.data.index, disp.name) : null;
      if (!att && disp && disp.visible !== false && skin !== data.defaultSkin && data.defaultSkin) {
        att = data.defaultSkin.getAttachment(rtSlot.data.index, disp.name);
      }
      rtSlot.setAttachment(att);
      // 附件编辑值(disp.transform)→ 运行时附件偏移:RT 渲染几何取自运行时附件,
      // 不同步则舞台图像不随「移动/旋转/缩放图片」变化(数值变了图不动)
      if (att && att.x !== undefined && disp && disp.transform) {
        const et = disp.transform;
        att.x = et.x || 0;
        att.y = et.y || 0;
        att.rotation = et.rotation || 0;
        if (att.scaleX !== undefined) { att.scaleX = et.scaleX ?? 1; att.scaleY = et.scaleY ?? 1; }
      }
      // 图片补偿覆盖层 → 附件本地偏移(编辑器预览;捕获 _compOrig 供关闭还原)
      const cov2 = this._compImg && this._compImg.get(es.name);
      if (cov2 && att && att.x !== undefined) {
        if (!att._compOrig) att._compOrig = { x: att.x, y: att.y, rotation: att.rotation };
        att.x = cov2.x !== undefined ? cov2.x : att._compOrig.x;
        att.y = cov2.y !== undefined ? cov2.y : att._compOrig.y;
        att.rotation = cov2.rotation !== undefined ? cov2.rotation : att._compOrig.rotation;
      } else if (!cov2 && att && att._compOrig) {
        att.x = att._compOrig.x; att.y = att._compOrig.y; att.rotation = att._compOrig.rotation;
      }
      // RegionAttachment 几何用预计算 offset(改 x/y/rotation/scale 后必须重算,否则图不动)
      if (att && typeof att.updateOffset === 'function') {
        try { att.updateOffset(); } catch (err) { /* 运行时版本差异,忽略 */ }
      }
      const col = ov && ov.r !== undefined ? ov : es.color;
      if (rtSlot.r !== col.r / 255 || rtSlot.g !== col.g / 255 || rtSlot.b !== col.b / 255 || rtSlot.a !== (ov && ov.a !== undefined ? ov.a : es.color.a ?? 1)) {
        rtSlot.r = col.r / 255; rtSlot.g = col.g / 255; rtSlot.b = col.b / 255;
        rtSlot.a = Math.max(0, Math.min(1, ov && ov.a !== undefined ? ov.a : es.color.a ?? 1));
      }
    }

    // 1) 编辑器姿态 → 运行时骨骼(注意:spine-core 3.8 的 Bone 没有 .name 属性,名字在 data.name)
    for (const rb of skeleton.bones) {
      const bn = (rb.data && rb.data.name) || rb.name;
      const mb = p.armature.bones.find((b) => b.name === bn);
      if (!mb) continue;
      const ov = pose && pose.bones[bn];
      // 值语义(spine-core 3.8 官方 apply 公式):translate/rotate 关键帧为相对 setup 的增量,
      // scale 关键帧为相对 setup 的倍率(1=不变) -> 须与 setup 合成,不能直接覆盖
      const co = this._compBone && this._compBone.get(bn); // 补偿覆盖层(编辑器预览)
      rb.x = co && co.x !== undefined ? co.x : mb.x + (ov && ov.x !== undefined ? ov.x : 0);
      rb.y = co && co.y !== undefined ? co.y : mb.y + (ov && ov.y !== undefined ? ov.y : 0);
      rb.rotation = co && co.rotation !== undefined ? co.rotation : mb.rotation + (ov && ov.rotation !== undefined ? ov.rotation : 0);
      rb.scaleX = mb.scaleX * (ov && ov.scaleX !== undefined ? ov.scaleX : 1);
      rb.scaleY = mb.scaleY * (ov && ov.scaleY !== undefined ? ov.scaleY : 1);
    }

    // 2) 应用保留的原始时间线(官方 timeline.apply):
    //    白名单 = 变形/IK/变换/路径/绘制顺序/剪切 —— 编辑器不采样这些;
    //    位移/旋转/缩放与插槽颜色/附件由编辑器键驱动,跳过避免覆盖。
    //    setup 模式下 time 传 0 之前的时间由各 timeline 的 setup 分支恢复初始值。
    const rtAnim = ctx.anim && data.animations[ctx.anim.name];
    if (rtAnim && rtAnim.timelines && rtAnim.timelines.length) {
      const t = ctx.mode === 'anim' ? (ctx.frame / (p.frameRate || 30)) : -1;
      const APPLY = [
        spine.DeformTimeline, spine.DrawOrderTimeline, spine.IkConstraintTimeline, spine.TransformConstraintTimeline,
        spine.PathConstraintMixTimeline, spine.PathConstraintPositionTimeline, spine.PathConstraintSpacingTimeline, spine.ShearTimeline,
      ];
      for (const tl of rtAnim.timelines) {
        if (!APPLY.some((T) => tl instanceof T)) continue;
        try {
          tl.apply(skeleton, t, t, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
        } catch (err) { /* 单条时间线失败不影响其余 */ }
      }
    }

    skeleton.updateWorldTransform();

    // 2) 覆盖层用的世界矩阵(翻转到 pixi y 向下)
    // spine-ts 矩阵惯例:x' = x*a + y*b, y' = x*c + y*d —— 局部 X 轴的世界方向是 (a, c) 而非 (a, b)!
    // 刀片方向基准用 localToWorld 真值(tipX/tipY),矩阵仅作旋转手柄等兜底
    this.worlds = new Map();
    this._boneHits = [];
    for (const rb of skeleton.bones) {
      const bn = (rb.data && rb.data.name) || rb.name;
      const mb = p.armature.bones.find((b) => b.name === bn);
      const tp = { x: (mb && mb.length) || 0, y: 0 };
      try { rb.localToWorld(tp); } catch (err) { /* 兜底矩阵 */ }
      this.worlds.set(bn, {
        tx: rb.worldX, ty: -rb.worldY,
        a: rb.a ?? 1, b: -rb.c, c: rb.b, d: -rb.d,   // pixi 系:X轴方向=(a,-c)
        tipX: tp.x, tipY: -tp.y,                       // 骨骼尖端真值(含翻转/缩放/斜切)
        bone: mb,
      });
    }
    if (!ghost) this.hitImages = [];

    // 3) 插槽附件渲染(按 skeleton.drawOrder —— 受 drawOrder 时间线重排);图片隐藏时不渲染(残留网格会被下方清理)。
    //    焦点附件(selAtt)例外:即使 Options·图片关闭 / 插槽隐藏也单独显示
    const drawn = [];
    const showImgs = this.ctx.showImages;
    for (const rtSlot of skeleton.drawOrder) {
      const es = p.armature.slots.find((s) => s.name === rtSlot.data.name);
      const isFocus = !!(selAtt && es && es.name === selAtt.slot);
      if ((!showImgs && !isFocus) || !es) continue;
      if (es.visible === false && !ghost && !isFocus) continue;
      const ov = pose && pose.slots[es.name];
      let di = es.displayIndex;
      if (isFocus) di = selAtt.index; // 焦点附件:渲染被选中的那一个显示对象
      else if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = es.displays[di];
      const att = rtSlot.getAttachment();
      if (!disp || !att || disp.visible === false) continue;
      const cache = this.imgCache.get(disp.imageId);
      if (!cache) continue;
      drawn.push(es.name + '|' + disp.name);

      let positions, uvs, indices;
      if (att instanceof spine.MeshAttachment) {
        const n = att.worldVerticesLength / 2;
        positions = new Float32Array(n * 2);
        att.computeWorldVertices(rtSlot, 0, att.worldVerticesLength, positions, 0, 2);
        uvs = att.uvs;
        const tris = att.triangles;
        indices = (tris instanceof Uint16Array || tris instanceof Uint32Array) ? tris : Uint16Array.from(tris);
      } else if (att instanceof spine.RegionAttachment) {
        positions = new Float32Array(8);
        att.computeWorldVertices(rtSlot.bone, positions, 0, 2);
        uvs = att.uvs;
        indices = [0, 1, 2, 2, 3, 0];
      } else {
        continue; // 路径/包围盒/裁剪附件:不渲染
      }
      for (let i = 1; i < positions.length; i += 2) positions[i] = -positions[i];

      const key = es.name + '|' + disp.name;
      let rec = ghost ? null : this._spineMeshes.get(key);
      if (!ghost) {
        if (!rec) {
          const geometry = new this.PIXI.MeshGeometry({ positions, uvs: new Float32Array(uvs), indices });
          const mesh = new this.PIXI.Mesh({ geometry, texture: cache.tex });
          mesh.blendMode = BLEND_MAP[rtSlot.data.blendMode] || 'normal';
          rec = { mesh, positions, geometry };
          this._spineMeshes.set(key, rec);
          host.addChild(mesh);
        } else {
          rec.positions.set(positions);
          rec.geometry.attributes.aPosition.buffer.update();
          host.addChild(rec.mesh);
        }
        const col = ov && ov.r !== undefined ? ov : es.color;
        rec.mesh.tint = (col.r & 255) << 16 | (col.g & 255) << 8 | (col.b & 255);
        rec.mesh.alpha = Math.max(0, Math.min(1, ov && ov.a !== undefined ? ov.a : es.color.a ?? 1));
        // 命中包围盒
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < positions.length; i += 2) {
          if (positions[i] < minX) minX = positions[i];
          if (positions[i] > maxX) maxX = positions[i];
          if (positions[i + 1] < minY) minY = positions[i + 1];
          if (positions[i + 1] > maxY) maxY = positions[i + 1];
        }
        if (isFinite(minX)) {
          this.hitImages.push({
            slotName: es.name,
            quad: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
          });
        }
      } else {
        const geometry = new this.PIXI.MeshGeometry({ positions, uvs: new Float32Array(uvs), indices });
        const mesh = new this.PIXI.Mesh({ geometry, texture: cache.tex });
        mesh.tint = tint;
        mesh.alpha = alphaMul;
        host.addChild(mesh);
      }
    }
    // 清理本次未出现的 mesh(附件切换)
    if (!ghost) {
      const alive = new Set(drawn);
      for (const [key, rec] of [...this._spineMeshes]) {
        if (!alive.has(key)) { try { rec.mesh.destroy({ children: true }); } catch (err) { /* ignore */ } this._spineMeshes.delete(key); }
      }
    }
  }

  /** 渲染插槽显示列表(z 序)。ghost 模式:单色 tint、不计命中 */
  _renderSlots(pose, host, tint, alphaMul, ghost) {
    const ctx = this.ctx;
    const p = ctx.project;
    // Spine Options:图片隐藏时连同洋葱皮附件一起不渲染(命中列表自然为空)。
    // 例外:选中的附件(附件自身可见)仍单独显示 —— 与骨骼「显示关闭时仅绘制焦点骨骼」一致
    const selAtt = !ctx.showImages && !ghost && ctx.selection && ctx.selection.type === 'att' ? ctx.selection : null;
    if (!ctx.showImages && !selAtt) return;
    const slots = slotsInZOrder(p);
    const selBones = ctx.imagesMode === 'selected' ? ctx.allSelectedBones : null;
    for (const slot of slots) {
      const isFocus = !!(selAtt && slot.name === selAtt.slot);
      if (selAtt && !isFocus) continue; // 图片隐藏态:只渲染焦点附件
      if (slot.visible === false && !ghost && !isFocus) continue;
      // Options·图片:仅显示选中骨骼下的图片
      if (selBones && !ghost && !isFocus && !selBones.has(slot.parent)) continue;
      const ov = pose && pose.slots[slot.name];
      let di = slot.displayIndex;
      if (isFocus) di = selAtt.index; // 焦点附件:渲染被选中的那一个显示对象
      else if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = slot.displays[di];
      if (!disp || disp.visible === false) continue;
      const cache = this.imgCache.get(disp.imageId);
      if (!cache) continue;
      const world = this.worlds.get(slot.parent);
      if (!world) continue;

      // 显示矩阵 = boneWorld × T(dx,dy)·R(drot)·S;补偿覆盖层优先(编辑器预览)
      const cov = this._compImg && this._compImg.get(slot.name);
      const t = cov ? { ...disp.transform, ...cov } : disp.transform;
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const la = cos * t.scaleX, lb = sin * t.scaleX, lc = -sin * t.scaleY, ld = cos * t.scaleY;
      const a = world.a * la + world.c * lb, b = world.b * la + world.d * lb;
      const c = world.a * lc + world.c * ld, d = world.b * lc + world.d * ld;
      const tx = world.a * t.x + world.c * t.y + world.tx;
      const ty = world.b * t.x + world.d * t.y + world.ty;

      const spr = new this.PIXI.Sprite(cache.tex);
      spr.anchor.set(disp.pivot.x, disp.pivot.y);
      spr.position.set(tx, ty);
      spr.rotation = Math.atan2(b, a);
      spr.scale.set(Math.hypot(a, b) || 0.001, Math.hypot(c, d) || 0.001);
      const col = ov && ov.r !== undefined ? ov : slot.color;
      const alpha = Math.max(0, Math.min(1, (ov && ov.a !== undefined ? ov.a : slot.color.a ?? 1))) * alphaMul;
      spr.tint = ghost ? tint : ((col.r & 255) << 16 | (col.g & 255) << 8 | (col.b & 255));
      spr.alpha = ghost ? alphaMul : alpha;
      host.addChild(spr);

      if (!ghost) {
        const w = cache.img.naturalWidth, h = cache.img.naturalHeight;
        const ax = disp.pivot.x * w, ay = disp.pivot.y * h;
        const pt = (lx, ly) => ({ x: a * lx + c * ly + tx, y: b * lx + d * ly + ty });
        this.hitImages.push({
          slotName: slot.name,
          quad: [pt(-ax, -ay), pt(w - ax, -ay), pt(w - ax, h - ay), pt(-ax, h - ay)],
        });
      }
    }
  }

  _drawGrid() {
    const g = this.gridG;
    const z = this.camera.zoom;
    const lw = Math.max(0.5 / z, 0.5);
    const step = 100;
    // 视口世界范围
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const x0 = -this.camera.x / z, y0 = -this.camera.y / z;
    const x1 = x0 + w / z, y1 = y0 + h / z;
    const gx0 = Math.floor(x0 / step) * step, gx1 = Math.ceil(x1 / step) * step;
    const gy0 = Math.floor(y0 / step) * step, gy1 = Math.ceil(y1 / step) * step;
    if ((gx1 - gx0) / step < 400 && (gy1 - gy0) / step < 400) {
      // 网格线(浅色)
      for (let x = gx0; x <= gx1; x += step) { if (x === 0) continue; g.moveTo(x, gy0).lineTo(x, gy1); }
      for (let y = gy0; y <= gy1; y += step) { if (y === 0) continue; g.moveTo(gx0, y).lineTo(gx1, y); }
      g.stroke({ width: lw, color: 0x363a46, alpha: 0.55 });
    }
  }

  /** 坐标轴:X 轴(红) + Y 轴(绿),Spine 风格;常驻显示,不随「网格」开关与缩放级别隐藏 */
  _drawAxes() {
    const g = this.gridG;
    const z = this.camera.zoom;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const x0 = -this.camera.x / z, y0 = -this.camera.y / z;
    const x1 = x0 + w / z, y1 = y0 + h / z;
    const axW = Math.max(1.2 / z, 1.2);
    g.moveTo(x0, 0).lineTo(x1, 0);
    g.stroke({ width: axW, color: 0xe5484d, alpha: 1.0 });
    g.moveTo(0, y0).lineTo(0, y1);
    g.stroke({ width: axW, color: 0x46a758, alpha: 1.0 });
  }

  /** 骨骼辅助线是否绘制:跟随「显示·骨骼」开关(变换工具切入时由 setTool 自动开启一次,用户可随时手动关闭) */
  _guidesVisible() {
    return !!this.ctx.showBones;
  }

  _drawBones() {
    const ctx = this.ctx;
    const g = this.boneG;
    const z = this.camera.zoom;
    const px = (n) => n / z; // 屏幕像素 → 世界单位
    const bones = ctx.project.armature.bones;
    this._boneColorMap = assignSpineBoneColors(bones);
    // 「显示·骨骼」关闭时:仅单独绘制 选中 + 层级树悬停 的骨骼(树中选哪根/悬停哪根显示哪根);命中列表同步只含焦点骨骼。
    // 移动/缩放等变换模式下操作图片附件时,选中/悬停的是插槽或附件 —— 其宿主骨骼一并纳入
    // 焦点(配合图片隐藏时的焦点附件例外,构成可完整编辑的最小可视集合)
    let focus = null;
    if (!ctx.showBones) {
      focus = new Set(ctx.allSelectedBones || []);
      if (ctx.treeHoverBone) focus.add(ctx.treeHoverBone);
      const focusSlot = ctx.selection?.type === 'slot' ? ctx.selection.name
        : ctx.selection?.type === 'att' ? ctx.selection.slot
          : ctx.treeHoverSlot;
      if (focusSlot) {
        const sb = ctx.project.armature.slots.find((s) => s.name === focusSlot);
        if (sb && sb.parent) focus.add(sb.parent);
      }
      if (!focus.size) return;
    }
    for (const bone of bones) {
      if (bone.visible === false) continue; // 骨骼已隐藏
      if (focus && !focus.has(bone.name)) continue;
      const w = this.worlds.get(bone.name);
      if (!w) continue;
      const tip = boneTipWorld(w, bone);
      const selOnly = ctx.bonesMode === 'selected';
      const sel = ctx.allSelectedBones && ctx.allSelectedBones.has(bone.name);
      // Options·骨骼:仅显示选中骨骼(命中列表同步跳过);焦点模式(显示关闭时)只画焦点骨骼,该过滤豁免
      if (selOnly && !sel && !focus) continue;
      // Options·其他:零长骨骼(目标点/辅助物件)显隐;隐藏的辅助点同时不可点选
      if (ctx.showOthers === false && !(bone.length > 0)) continue;
      this._boneHits.push({ name: bone.name, origin: { x: w.tx, y: w.ty }, tip, locked: bone.locked === true });
      const hov = this._hover === bone.name || ctx.treeHoverBone === bone.name;
      // Spine 风格:骨骼按分支继承着色(躯干链一色/前腿一色/后腿一色),选中橙/悬停白覆盖
      const color = sel ? COLOR_SEL : hov ? 0xffffff : this._boneColorMap.get(bone.name);
      const alpha = bone.locked ? 0.4 : sel ? 1 : 0.85;
      // Spine 骨骼形态:细长锥形刀片 + 关节圆环;刀片根部两角落在圆环边上,尾部内凹成锥角
      const segLen = Math.hypot(tip.x - w.tx, tip.y - w.ty);
      const bw = bladeHalfWidth(bone.length, z);          // 刀片根部半宽
      const jr = segLen * z < 3.5                          // 圆环半径:有刀片时=根部半宽(直径=最宽处),零长骨骼固定小环
        ? Math.max(px(2.2), 2.2 / z)
        : Math.min(bw, px(4));
      if (segLen * z >= 3.5) {
        const ux2 = (tip.x - w.tx) / segLen, uy2 = (tip.y - w.ty) / segLen;
        const pxp = -uy2, pyp = ux2; // 垂直方向
        // 根部两角:圆环边上(垂直方向 ±jr);尾部凹点:圆心后侧(锥角顶点贴圆边)
        g.moveTo(w.tx + pxp * jr, w.ty + pyp * jr)
          .lineTo(tip.x, tip.y)
          .lineTo(w.tx - pxp * jr, w.ty - pyp * jr)
          .lineTo(w.tx - ux2 * jr, w.ty - uy2 * jr)
          .closePath();
        g.fill({ color, alpha: alpha * 0.9 });
        g.stroke({ width: Math.max(px(0.8), 0.8 / z), color, alpha });
      }
      // 关节环:深底 + 骨骼色描边
      g.circle(w.tx, w.ty, jr)
        .fill({ color: 0x232630, alpha: bone.locked ? 0.4 * 0.9 : 0.9 })
        .stroke({ width: Math.max(px(1.2), 1.2 / z), color, alpha });
    }
    // 选中骨骼:尖端旋转手柄 + 延长虚线 + 名称标签
    if (ctx.selection && ctx.selection.type === 'bone') {
      const bone = bones.find((b) => b.name === ctx.selection.name);
      const w = bone && this.worlds.get(bone.name);
      if (bone && w) {
        const tip = boneTipWorld(w, bone);
        g.moveTo(w.tx, w.ty).lineTo(w.tx + w.a * (bone.length + px(26)), w.ty + w.b * (bone.length + px(26)));
        g.stroke({ width: 1.5 / z, color: COLOR_SEL, alpha: 0.45 });
        // 旋转手柄:尖端绿色圆
        g.circle(tip.x, tip.y, Math.max(px(7), 6 / z)).fill({ color: COLOR_HANDLE, alpha: 0.95 }).stroke({ width: 1.5 / z, color: 0xffffff, alpha: 0.9 });
        // 工具特定手柄(移动/缩放的聚焦手柄在屏幕空间覆盖层 _drawTransformHandle,随骨骼/插槽/附件选择联动)
        const tool = ctx.tool;
        if (tool === 'scale') {
          // 缩放手柄:尖端两侧小方块(X/Y 轴方向)
          const sz = Math.max(px(5), 4 / z);
          const ox = tip.x + w.a * sz * 1.6, oy = tip.y + w.b * sz * 1.6;
          g.rect(ox - sz / 2, oy - sz / 2, sz, sz).fill({ color: 0xf5a623, alpha: 0.9 }).stroke({ width: 1 / z, color: 0xffffff, alpha: 0.8 });
        } else if (tool === 'shear') {
          // 倾斜手柄:尖端两侧斜线标记
          const sl = Math.max(px(10), 8 / z);
          g.moveTo(tip.x - w.b * sl, tip.y + w.a * sl).lineTo(tip.x + w.b * sl, tip.y - w.a * sl);
          g.stroke({ width: 2 / z, color: 0xf5a623, alpha: 0.9 });
        } else if (tool === 'length') {
          // 拉伸手柄:关节处白色方块
          const sz = Math.max(px(5), 4 / z);
          g.rect(w.tx - sz / 2, w.ty - sz / 2, sz, sz).fill({ color: 0xffffff, alpha: 0.85 }).stroke({ width: 1 / z, color: COLOR_SEL, alpha: 0.9 });
        }
      }
    }
  }

  /** 变换模式下图片的白色虚线包围框:悬停图片弱化显示,选中图片(插槽/附件)高亮保持 */
  _drawImgBoxes() {
    const ctx = this.ctx;
    const t = ctx.tool;
    if (t !== 'rotate' && t !== 'move' && t !== 'scale' && t !== 'shear') return;
    const g = this.boneG;
    const z = this.camera.zoom;
    const lw = Math.max(1.2 / z, 1.2);
    const quadOf = (slotName) => {
      const rec = (this.hitImages || []).find((h) => h.slotName === slotName);
      return rec ? rec.quad : null;
    };
    const drawDashed = (quad, alpha) => {
      const dash = 6 / z, gap = 4 / z;
      for (let i = 0; i < 4; i++) {
        const p0 = quad[i], p1 = quad[(i + 1) % 4];
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const n = Math.max(1, Math.round(len / (dash + gap)));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = Math.min((k + 0.55) / n, 1);
          g.moveTo(p0.x + (p1.x - p0.x) * t0, p0.y + (p1.y - p0.y) * t0)
            .lineTo(p0.x + (p1.x - p0.x) * t1, p0.y + (p1.y - p0.y) * t1);
        }
      }
      g.stroke({ width: lw, color: 0xffffff, alpha });
    };
    // 悬停图片:弱化虚线框(选中项由高亮框覆盖,跳过)
    if (this._hoverImg) {
      const selSlot = ctx.selection && (ctx.selection.type === 'slot' ? ctx.selection.name : ctx.selection.type === 'att' ? ctx.selection.slot : null);
      if (this._hoverImg !== selSlot) {
        const q = quadOf(this._hoverImg);
        if (q) drawDashed(q, 0.5);
      }
    }
    // 选中图片(插槽/附件):高亮虚线框保持显示
    const sel = ctx.selection;
    if (sel && (sel.type === 'slot' || sel.type === 'att')) {
      const q = quadOf(sel.type === 'slot' ? sel.name : sel.slot);
      if (q) drawDashed(q, 0.95);
    }
  }

  /** 旋转手柄目标:选中附件→该附件;选中插槽→其当前生效图片附件;选中骨骼→该骨骼;无选中→根骨骼。
   *  返回 { kind:'slot', slot, disp } 或 { kind:'bone', bone };null=无目标 */
  _rotateTarget() {
    const ctx = this.ctx;
    const sel = ctx.selection;
    if (sel && (sel.type === 'slot' || sel.type === 'att')) {
      const slot = ctx.project.armature.slots.find((s) => s.name === (sel.type === 'att' ? sel.slot : sel.name));
      if (slot) {
        const di = sel.type === 'att'
          ? (sel.index >= 0 && sel.index < (slot.displays || []).length ? sel.index : 0)
          : (slot.displayIndex >= 0 && slot.displayIndex < (slot.displays || []).length ? slot.displayIndex : 0);
        const disp = slot.displays && slot.displays[di];
        if (disp) return { kind: 'slot', slot, disp };
      }
    }
    const bones = ctx.project.armature.bones;
    if (sel && sel.type === 'bone') {
      const b = bones.find((x) => x.name === sel.name);
      if (b) return { kind: 'bone', bone: b };
    }
    const rb = bones.find((b) => !b.parent) || bones[0] || null;
    return rb ? { kind: 'bone', bone: rb } : null;
  }

  /** 图片附件矩形几何中心(世界坐标)+ 世界 X 轴方向(矩阵与 _renderSlots 同源) */
  _imgCenterWorld(slot, disp) {
    const world = this.worlds ? this.worlds.get(slot.parent) : null;
    const cache = this.imgCache.get(disp.imageId);
    if (!world || !cache) return null;
    const t = disp.transform || {};
    const rad = ((t.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const la = cos * (t.scaleX ?? 1), lb = sin * (t.scaleX ?? 1), lc = -sin * (t.scaleY ?? 1), ld = cos * (t.scaleY ?? 1);
    const a = world.a * la + world.c * lb, b = world.b * la + world.d * lb;
    const c = world.a * lc + world.c * ld, d = world.b * lc + world.d * ld;
    const tx = world.a * (t.x || 0) + world.c * (t.y || 0) + world.tx;
    const ty = world.b * (t.x || 0) + world.d * (t.y || 0) + world.ty;
    const w = cache.img.naturalWidth, h = cache.img.naturalHeight;
    // 附件空间中,图片矩形中心相对锚点(pivot)的偏移
    const px = (0.5 - (disp.pivot?.x ?? 0.5)) * w, py = (0.5 - (disp.pivot?.y ?? 0.5)) * h;
    return { x: a * px + c * py + tx, y: b * px + d * py + ty, a, b };
  }

  /** 旋转手柄轴心:骨骼=骨骼原点;插槽图片=图片矩形几何中心。附带世界 X 方向(缺口朝向基准) */
  _rotatePivot() {
    const t = this._rotateTarget();
    if (!t || !this.worlds) return null;
    if (t.kind === 'slot') {
      const c = this._imgCenterWorld(t.slot, t.disp);
      return c ? { ...t, x: c.x, y: c.y, ang: Math.atan2(c.b, c.a) } : null;
    }
    const w = this.worlds.get(t.bone.name);
    return w ? { ...t, x: w.tx, y: w.ty, ang: Math.atan2(w.b, w.a) } : null;
  }

  /** 开始移动图片附件拖拽:世界位移 → 父骨骼局部增量,写入附件偏移(transform.x/y) */
  _beginMoveSlotDrag(target, wp) {
    const bone = this.ctx.project.armature.bones.find((b) => b.name === target.slot.parent);
    const pw = bone && this.worlds.get(bone.name);
    if (!bone || !pw) return;
    if (target.slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
    this._beginEdit('移动图片');
    const t = target.disp.transform || (target.disp.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    this._drag = {
      kind: 'moveSlot', slot: target.slot, disp: target.disp, boneName: bone.name,
      baseX: t.x || 0, baseY: t.y || 0,
      startLocal: worldToParentLocal(pw, wp.x, wp.y),
    };
  }

  /** 开始缩放图片附件拖拽:以拖拽起始距图片几何中心的距离为基准,等比缩放 transform.scaleX/Y */
  _beginScaleSlotDrag(target, wp) {
    const piv = this._imgCenterWorld(target.slot, target.disp);
    if (!piv) return;
    if (target.slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
    this._beginEdit('缩放图片');
    const t = target.disp.transform || (target.disp.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    this._drag = {
      kind: 'scaleSlot', slot: target.slot, disp: target.disp,
      piv: { x: piv.x, y: piv.y },
      startDist: Math.max(Math.hypot(wp.x - piv.x, wp.y - piv.y), 5 / this.camera.zoom),
      baseSx: t.scaleX ?? 1, baseSy: t.scaleY ?? 1,
    };
  }

  /** 指针相对指定轴心点的角度(pixi 顺时针,度);p = {x, y} */
  _phiC(p, wp) { return (Math.atan2(wp.y - p.y, wp.x - p.x) * 180) / Math.PI; }

  /** 当前姿态下的本地旋转:动画模式叠加关键帧偏移(spine=增量,其余=绝对),补偿覆盖层优先 */
  _posedRotation(bone) {
    const ctx = this.ctx;
    let r = bone.rotation || 0;
    if (ctx.mode === 'anim' && ctx.anim) {
      const o = sampleAnimation(ctx.anim, ctx.frame).bones[bone.name] || {};
      if (o.rotation !== undefined) r = ctx.project.spine ? (bone.rotation + o.rotation) : o.rotation;
    }
    const co = ctx.getCompBone && ctx.getCompBone(bone.name);
    if (co && co.rotation !== undefined) r = co.rotation;
    return r;
  }

  /** 开始旋转拖拽:记录起始姿态角与指针角,逐帧累计增量(动画·本地/父级轴可拖出多圈)。
   *  骨骼:轴心=骨骼原点,写 Bone.Rotation;插槽图片:轴心=图片几何中心,写 Attachment.Rotation(骨骼不动) */
  _beginRotateDrag(target, wp) {
    const piv = this._rotatePivot();
    if (!piv) return;
    if (target.kind === 'slot') {
      this._beginEdit('旋转图片');
      const t0 = target.disp.transform || (target.disp.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      this._drag = {
        kind: 'rotateSlot', slot: target.slot, disp: target.disp,
        piv: { x: piv.x, y: piv.y },
        startRot: t0.rotation || 0, lastPhiC: this._phiC(piv, wp), acc: 0,
      };
      return;
    }
    const bone = target.bone;
    this._beginEdit('旋转骨骼');
    this._drag = {
      kind: 'rotate', bone, ox: wp.x, oy: wp.y, w: this.worlds.get(bone.name),
      piv: { x: piv.x, y: piv.y },
      startLocal: this._posedRotation(bone), lastPhiC: this._phiC(piv, wp), acc: 0,
      comp: this._captureComp(bone),
    };
  }

  /** 指针是否悬在旋转手柄上(命中半径=圆环外沿+余量,屏幕像素) */
  _overRotateHandle(wp) {
    if (this.ctx.tool !== 'rotate') return false;
    const p = this._rotatePivot();
    return !!p && Math.hypot(wp.x - p.x, wp.y - p.y) <= 39 / this.camera.zoom;
  }

  /** 变换工具聚焦手柄(屏幕空间恒定尺寸):随层级树选择联动——骨骼=原点 / 插槽·附件=图片几何中心。
   *  旋转=青色圆弧+缺口白色外指箭头;移动=四向箭头;缩放=方框+对角箭头 */
  _drawTransformHandle() {
    const g = this._rotateHandleG;
    if (!g) return;
    const tool = this.ctx.tool;
    if (tool !== 'rotate' && tool !== 'move' && tool !== 'scale') { g.visible = false; return; }
    const piv = this._rotatePivot();
    if (!piv) { g.visible = false; return; }
    g.visible = true;
    const z = this.camera.zoom;
    const cx = piv.x * z + this.camera.x, cy = piv.y * z + this.camera.y;
    const ang = piv.ang; // 目标世界方向(骨骼指向/图片自身 X 轴)
    const CYAN = 0x35c8ff;
    g.clear();
    if (tool === 'rotate') {
      // 圆弧:从缺口一侧画到另一侧(避开骨骼方向,缺口朝向 = 骨骼指向)
      const R = 27, LW = 5, GAP = (26 * Math.PI) / 180; // 圆弧半径/线宽/半缺口角
      g.arc(cx, cy, R, ang + GAP, ang + Math.PI * 2 - GAP);
      g.stroke({ width: LW, color: CYAN, alpha: 0.95 });
      // 缺口处白色箭头:沿骨骼方向由圆心向外穿出缺口
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const ax = (r) => cx + r * ux, ay = (r) => cy + r * uy;
      g.moveTo(ax(12), ay(12)).lineTo(ax(30), ay(30));
      g.stroke({ width: 4, color: 0xffffff, alpha: 0.95 });
      g.moveTo(ax(38), ay(38))
        .lineTo(ax(29) + 6 * nx, ay(29) + 6 * ny)
        .lineTo(ax(29) - 6 * nx, ay(29) - 6 * ny)
        .closePath();
      g.fill({ color: 0xffffff, alpha: 0.95 });
    } else if (tool === 'move') {
      // 四向箭头(屏幕水平/垂直方向):指示可拖拽移动
      const al = 30, aw = 8, lw2 = 4;
      g.moveTo(cx - al, cy).lineTo(cx + al, cy)
        .moveTo(cx, cy - al).lineTo(cx, cy + al)
        .stroke({ width: lw2, color: CYAN, alpha: 0.95 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const hx = cx + dx * al, hy = cy + dy * al;
        g.moveTo(hx - dx * aw + dy * aw, hy - dy * aw - dx * aw)
          .lineTo(hx, hy)
          .lineTo(hx - dx * aw - dy * aw, hy - dy * aw + dx * aw)
          .closePath();
      }
      g.fill({ color: CYAN, alpha: 0.95 });
    } else {
      // 缩放:中心方框 + 对角箭头(↗),指示可缩放
      const sz = 22, lw2 = 3.5;
      g.rect(cx - sz / 2, cy - sz / 2, sz, sz);
      g.stroke({ width: lw2, color: CYAN, alpha: 0.95 });
      const d = sz / 2 + 10;
      g.moveTo(cx - d, cy + d).lineTo(cx + d - 8, cy - d + 2);
      g.stroke({ width: lw2, color: 0xffffff, alpha: 0.95 });
      g.moveTo(cx + d, cy - d)
        .lineTo(cx + d - 11, cy - d + 1)
        .lineTo(cx + d - 1, cy - d + 11)
        .closePath();
      g.fill({ color: 0xffffff, alpha: 0.95 });
    }
  }

  /**
   * 对象名称标签(Spine Options·标签):
   * 骨骼/图片(插槽附件枢轴点)/其他(零长辅助点)按 Options·标签 列分别显隐;
   * 选中骨骼名始终显示,不受开关限制。
   */
  _drawBoneLabels() {
    const ctx = this.ctx;
    if (!this.worlds) return;
    const lab = ctx.optLabels || {};
    const selSet = ctx.allSelectedBones;
    // 骨骼着色与骨骼辅助线同源:_drawBones 仅在辅助线开启时刷新,关闭时标签自行计算,保证按骨骼分支色显示
    if ((lab.bones || lab.others) && (!ctx.showBones || !this._boneColorMap)) {
      this._boneColorMap = assignSpineBoneColors(ctx.project.armature.bones);
    }
    // 骨骼 + 其他(零长辅助点)名称标签
    for (const bone of ctx.project.armature.bones) {
      if (bone.visible === false) continue;
      const w = this.worlds.get(bone.name);
      if (!w) continue;
      const isSelected = selSet && selSet.has(bone.name);
      if (!(bone.length > 0 ? lab.bones : lab.others) && !isSelected) continue;
      const color = isSelected ? 0xffffff : labelBright((this._boneColorMap && this._boneColorMap.get(bone.name)) || 0xffffff);
      this._drawBoneLabel(bone.name, w.tx, w.ty, color);
    }
    // 图片(插槽)名称标签:标注在当前附件枢轴点(图片隐藏时不画,避免悬空名称)
    if (lab.images && ctx.showImages !== false) {
      for (const slot of ctx.project.armature.slots) {
        if (slot.visible === false) continue;
        const di = slot.displayIndex >= 0 ? slot.displayIndex : 0;
        const disp = slot.displays && slot.displays[di];
        if (!disp || disp.visible === false) continue;
        const sw = this.worlds.get(slot.parent);
        if (!sw) continue;
        const t = disp.transform || {};
        const wx = sw.a * (t.x || 0) + sw.c * (t.y || 0) + sw.tx;
        const wy = sw.b * (t.x || 0) + sw.d * (t.y || 0) + sw.ty;
        this._drawBoneLabel(slot.name, wx, wy, 0xffffff);
      }
    }
    // 回收未使用的标签(标签层在屏幕空间,位于 worldC 之上,无需 zIndex 排序)
    for (let i = this._labelUsed; i < this._labelPool.length; i++) {
      if (this._labelPool[i].parent) this._labelPool[i].parent.removeChild(this._labelPool[i]);
    }
    this._labelUsed = 0;
  }

  /** 在世界坐标(wx,wy)处绘制名称标签(白字+黑色描边;屏幕空间恒定尺寸,叠加在图片上仍清晰) */
  _drawBoneLabel(name, wx, wy, color = 0xffffff) {
    const PIXI = this.PIXI;
    let label = this._labelPool[this._labelUsed];
    if (!label) {
      label = new PIXI.Text({ text: '', style: { fontFamily: 'Consolas, monospace', fontSize: 11, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 3, join: 'round' } }, resolution: this._labelRes });
      this.labelC.addChild(label);
      this._labelPool.push(label);
    }
    // 回收时已移出显示列表,复用必须重新挂回(否则标签开关切换一次后永不再显示)
    if (!label.parent) this.labelC.addChild(label);
    this._labelUsed++;
    // 旧版标签带背景框子节点,复用时移除
    if (label._bg) { label.removeChild(label._bg); try { label._bg.destroy(); } catch (err) { /* ignore */ } label._bg = null; }
    // 文本/颜色变更才写回:text 赋值与 width 测量都可能触发文本重栅格化,逐帧调用严重卡顿
    if (label.text !== name) {
      label.text = name;
      const res = this._labelRes;
      // 轴心同样对齐设备像素网格:pos 对齐而 pivot 带小数,四边形仍会落在半像素上
      label.pivot.set(Math.round((label.width / 2) * res) / res, Math.round((label.height / 2) * res) / res);
    }
    if (label.style.fill !== color) label.style.fill = color;
    // 世界坐标 → 画布 CSS 像素(applyCamera:screen = world×zoom + camera);文字不随相机缩放
    const z = this.camera.zoom;
    const res = this._labelRes;
    // 坐标对齐设备像素网格:标签纹理按 res 栅格化,半像素偏移会让 GPU 线性采样把整块文字重采样糊掉
    label.position.set(
      Math.round((wx * z + this.camera.x) * res) / res,
      Math.round((wy * z + this.camera.y - 12) * res) / res
    );
  }

  /** 取插槽当前附件的 RT 引用(图片补偿还原用;非 RT 项目返回 null) */
  _rtAttachmentOf(slot, disp) {
    if (!this._spineRT || !this._spineProjRef) return null;
    try {
      const { skeleton, skin } = this._spineRT;
      const rtSlot = skeleton.slots.find((x) => x.data.name === slot.name);
      return rtSlot ? skin.getAttachment(rtSlot.data.index, disp.name) : null;
    } catch (err) { return null; }
  }

  /** 覆盖层 → 纯对象(FK setupOverrides 入参) */
  _compObj() {
    if (!this._compBone || !this._compBone.size) return null;
    const o = {};
    for (const [k, v] of this._compBone) o[k] = v;
    return o;
  }

  /** 关闭补偿:清空覆盖层并还原 RT 附件原始偏移(数值恢复原样,规格:仅预览) */
  clearComp(kind) {
    if (kind !== 'images' && this._compBone) this._compBone.clear();
    if (kind !== 'bones' && this._compImg) {
      for (const rec of this._compImg.values()) {
        const att = rec && rec._att;
        if (att && att._compOrig) { att.x = att._compOrig.x; att.y = att._compOrig.y; att.rotation = att._compOrig.rotation; }
      }
      this._compImg.clear();
    }
    this.render();
  }

  /** Spine Compensate:拖拽开始时捕获直接子骨骼/图片的世界快照 + 本骨骼旧世界矩阵 */
  _captureComp(bone) {
    const p = this.ctx.project;
    const P0 = this.worlds.get(bone.name);
    if (!P0) return null;
    const ang = (m) => Math.atan2(m.b, m.a);
    return {
      p0: { a: P0.a, b: P0.b, c: P0.c, d: P0.d, tx: P0.tx, ty: P0.ty, ang: ang(P0) },
      bones: p.armature.bones.filter((b) => b.parent === bone.name).map((b) => {
        const w = this.worlds.get(b.name);
        return w ? { name: b.name, tx: w.tx, ty: w.ty, rot: b.rotation || 0 } : null;
      }).filter(Boolean),
      slots: p.armature.slots.filter((s) => s.parent === bone.name).map((s) => {
        const disp = s.displays[s.displayIndex];
        if (!disp) return null;
        const t = disp.transform;
        return { name: s.name, wx: P0.a * (t.x || 0) + P0.c * (t.y || 0) + P0.tx, wy: P0.b * (t.x || 0) + P0.d * (t.y || 0) + P0.ty, rot: t.rotation || 0 };
      }).filter(Boolean),
    };
  }

  /**
   * Spine Compensate(精确矩阵法):移动/旋转骨骼时,直接子骨骼与插槽图片保持世界姿态。
   * 快照在 _onDown 捕获;每帧用新世界矩阵反解子级局部值 —— 含缩放/翻转/多级嵌套同样精确。
   */
  _applyCompensate(bone, d) {
    if (!d.comp) return;
    const p = this.ctx.project;
    const P = this.worlds.get(bone.name);
    if (!P) return;
    const { p0 } = d.comp;
    const dAng = p0.ang - Math.atan2(P.b, P.a); // 需要补偿的世界角度差
    const invP = inv2(P);
    const r10 = (v) => Math.round(v * 10) / 10;
    const DEG = 180 / Math.PI;
    // 子骨骼:局部平移 = inv(新矩阵) × (旧世界位置 - 新世界平移);局部旋转 += 世界角差
    // 写入补偿覆盖层(编辑器预览,不入模型/撤销/导出;关闭补偿即还原)
    if (this.ctx.compBones) {
      for (const c of d.comp.bones) {
        const cb = p.armature.bones.find((b) => b.name === c.name);
        if (!cb) continue;
        const rel = apply2(invP, c.tx - P.tx, c.ty - P.ty);
        this._compBone.set(c.name, {
          x: r10(rel.x), y: r10(rel.y),
          rotation: cb.inheritRotation === false ? undefined : r10(c.rot + dAng * DEG),
        });
      }
    }
    // 图片:偏移点世界坐标保持 + 附件角补偿(记录 RT 附件引用供关闭还原)
    if (this.ctx.compImages) {
      for (const s of d.comp.slots) {
        const slot = p.armature.slots.find((x) => x.name === s.name);
        const disp = slot && slot.displays[slot.displayIndex];
        if (!disp) continue;
        const rel = apply2(invP, s.wx - P.tx, s.wy - P.ty);
        const prev = this._compImg.get(s.name) || {};
        this._compImg.set(s.name, {
          x: r10(rel.x), y: r10(rel.y), rotation: r10(s.rot + dAng * DEG),
          _att: prev._att || this._rtAttachmentOf(slot, disp),
        });
      }
    }
    this.render(); // 覆盖层改写后立即重绘(模型未动)
  }

  /**
   * 层级树悬停联动:插槽/附件节点悬停时,舞台顶层绘制该图片 + 白色虚线边框。
   * 悬停附件可为非当前 display(临时预览);图片开关关闭时也能预览。
   */
  _drawTreeHover() {
    const ctx = this.ctx;
    const sn = ctx.treeHoverSlot;
    if (!sn) { if (this._hoverMesh) { try { this._hoverMesh.destroy({ children: true }); } catch (err) { /* ignore */ } this._hoverMesh = null; } return; }
    const p = ctx.project;
    const slot = p.armature.slots.find((s) => s.name === sn);
    if (!slot) return;
    const di = ctx.treeHoverAtt != null ? ctx.treeHoverAtt : (slot.displayIndex >= 0 ? slot.displayIndex : 0);
    const disp = slot.displays[di];
    if (!disp) return;

    // ---- 1) 计算图片四角(pixi 世界坐标) ----
    let pts = null; // [x0,y0, x1,y1, x2,y2, x3,y3]
    let hoverUvs = null; // RT 路径用运行时 att.uvs(含 V 翻转约定),自建路径用标准四角 UV
    if (this._spineRT && this._spineProjRef === p) {
      const { spine, data, skeleton, skin } = this._spineRT;
      const rtSlot = skeleton.slots.find((s) => s.data.name === sn);
      if (rtSlot) {
        const att = skin.getAttachment(rtSlot.data.index, disp.name);
        if (att instanceof spine.RegionAttachment) {
          const arr = new Float32Array(8);
          att.computeWorldVertices(rtSlot.bone, arr, 0, 2);
          for (let i = 1; i < 8; i += 2) arr[i] = -arr[i];
          pts = arr;
          hoverUvs = new Float32Array(att.uvs); // 与常规网格渲染同一套 UV,方向/角度一致
        } else if (att instanceof spine.MeshAttachment) {
          const n = att.worldVerticesLength / 2;
          const arr = new Float32Array(n * 2);
          att.computeWorldVertices(rtSlot, 0, att.worldVerticesLength, arr, 0, 2);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < arr.length; i += 2) {
            const vx = arr[i], vy = -arr[i + 1];
            if (vx < x0) x0 = vx; if (vx > x1) x1 = vx;
            if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
          }
          if (isFinite(x0)) pts = new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]);
        }
      }
    } else if (this.worlds) {
      const world = this.worlds.get(slot.parent);
      if (world) {
        const cache = this.imgCache.get(disp.imageId);
        if (cache) {
          const w = cache.img.naturalWidth, h = cache.img.naturalHeight;
          const t = disp.transform;
          const rad = (t.rotation * Math.PI) / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          const la = cos * t.scaleX, lb = sin * t.scaleX, lc = -sin * t.scaleY, ld = cos * t.scaleY;
          const a = world.a * la + world.c * lb, b = world.b * la + world.d * lb;
          const c = world.a * lc + world.c * ld, d = world.b * lc + world.d * ld;
          const tx = world.a * t.x + world.c * t.y + world.tx;
          const ty = world.b * t.x + world.d * t.y + world.ty;
          const ax = disp.pivot.x * w, ay = disp.pivot.y * h;
          const pt = (lx, ly) => ({ x: a * lx + c * ly + tx, y: b * lx + d * ly + ty });
          const q = [pt(-ax, -ay), pt(w - ax, -ay), pt(w - ax, h - ay), pt(-ax, h - ay)];
          pts = new Float32Array([q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y]);
        }
      }
    }
    if (!pts) return;

    // ---- 2) 顶层绘制图片(临时 mesh,即使「图片」开关关闭也预览) ----
    if (this._hoverMesh) { try { this._hoverMesh.destroy({ children: true }); } catch (err) { /* ignore */ } this._hoverMesh = null; }
    const cache = this.imgCache.get(disp.imageId);
    if (cache) {
      try {
        const geometry = new this.PIXI.MeshGeometry({
          positions: Float32Array.from(pts),
          uvs: hoverUvs || new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          indices: [0, 1, 2, 2, 3, 0],
        });
        this._hoverMesh = new this.PIXI.Mesh({ geometry, texture: cache.tex });
        this.imageG.addChild(this._hoverMesh);
      } catch (err) { /* 纹理未就绪则只画边框 */ }
    }

    // ---- 3) 白色虚线包裹图片边沿(按屏幕像素等距分节) ----
    const g = this.boneG;
    const z = this.camera.zoom;
    const dash = 6 / z, gap = 4 / z;      // 屏幕像素级虚线节距(不随缩放变稀)
    const lw = 2 / z;
    const corners = [[pts[0], pts[1]], [pts[2], pts[3]], [pts[4], pts[5]], [pts[6], pts[7]]];
    let phase = 0; // 跨边连续的虚线相位
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      let d = phase;
      while (d < len) {
        const end = Math.min(d + dash, len);
        const t0 = d / len, t1 = end / len;
        g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0).lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
        d += dash + gap;
      }
      phase = d - len; // 余量带入下一条边,转角处节距连续
    }
    g.stroke({ width: lw, color: 0xffffff, alpha: 0.95 });
  }

  // ---------------- 命中检测 ----------------

  _hitHandle(wx, wy) {
    const ctx = this.ctx;
    if (!ctx.selection || ctx.selection.type !== 'bone') return null;
    const bone = ctx.project.armature.bones.find((b) => b.name === ctx.selection.name);
    const w = bone && this.worlds.get(bone.name);
    if (!bone || !w) return null;
    const tip = boneTipWorld(w, bone);
    const r = 10 / this.camera.zoom;
    // 旋转手柄:尖端圆圈
    if (Math.hypot(wx - tip.x, wy - tip.y) <= r) return { kind: 'rotate', bone, label: '旋转骨骼' };
    // 拉伸手柄:关节位置(拖拽调整 bone.length)
    if (Math.hypot(wx - w.tx, wy - w.ty) <= r * 0.8) return { kind: 'length', bone, label: '拉伸骨骼' };
    // 平移手柄:关节位置移动(按住关节拖拽移动位置,在 select 模式下生效)
    if (Math.hypot(wx - w.tx, wy - w.ty) <= r) return { kind: 'move', bone, label: '移动骨骼' };
    return null;
  }

  _hitJoint(wx, wy) {
    const r = 8 / this.camera.zoom;
    let best = null, bestD = r;
    for (const h of this._boneHits) {
      const d = Math.hypot(wx - h.origin.x, wy - h.origin.y);
      if (d <= bestD) { bestD = d; best = h.name; }
    }
    return best;
  }

  _hitBoneLine(wx, wy) {
    const th = 5 / this.camera.zoom;
    let best = null, bestD = th;
    for (const h of this._boneHits) {
      const d = distToSeg(wx, wy, h.origin, h.tip);
      if (d <= bestD) { bestD = d; best = h.name; }
    }
    return best;
  }

  _hitImage(wx, wy) {
    for (let i = this.hitImages.length - 1; i >= 0; i--) {
      if (pointInQuad(wx, wy, this.hitImages[i].quad)) return this.hitImages[i].slotName;
    }
    return null;
  }

  /** 无父骨骼的父空间 = 世界空间。RT 路径的 worlds 为翻转(pixi y-down)系:
   *  根级骨骼的父空间必须同样带 Y 翻转,否则根骨骼拖拽位移按 pixi 系计算、
   *  按 spine 系(y-up)渲染,上下方向恰好相反(附件/子骨骼用真实翻转矩阵故不受影响)。 */
  _rootSpace() {
    return (this._spineRT && this._spineProjRef === this.ctx.project)
      ? { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }
      : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  }

  /** 旋转拖拽的屏幕→存储符号:RT 路径世界系翻转(spine 逆时针为正,屏幕 = -存储值)
   *  → 鼠标顺时针时存储值须减少;自绘路径(pixi 顺时针为正,屏幕 = +存储值)→ 增加。
   *  骨骼与图片附件旋转共用,保证两路径下方向均与鼠标一致。 */
  _rotSign() {
    return (this._spineRT && this._spineProjRef === this.ctx.project) ? -1 : 1;
  }

  // ---------------- 指针事件 ----------------

  _onDown(e) {
    if (!this.app) return;
    try { this.app.canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* 合成事件无活动指针,忽略 */ }
    const ctx = this.ctx;
    const wp = this.toWorld(e.clientX, e.clientY);
    // 右键:拖动平移;原地点击(未拖动)切换上一工具(Spine 习惯)
    if (e.button === 2) {
      this._rbtn = { x: e.clientX, y: e.clientY };
      this._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y };
      return;
    }
    // 中键 / 空格:平移
    if (e.button === 1 || ctx.spaceHeld) {
      this._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y };
      return;
    }
    if (e.button !== 0) return;

    if (ctx.tool === 'bone') {
      // 父级 = 选中骨骼;未选中则挂到根级(parent='')
      this._drag = { kind: 'boneCreate', p0: wp, p1: wp, parentName: (ctx.selection && ctx.selection.type === 'bone' ? ctx.selection.name : '') };
      return;
    }

    // 旋转/缩放/倾斜工具:点击关节或骨线即开始对应操作
    if (ctx.tool === 'rotate' || ctx.tool === 'scale' || ctx.tool === 'shear') {
      // 旋转工具:轴心手柄优先(选中插槽=图片几何中心;选中骨骼=原点;无选中=根节点)
      if (ctx.tool === 'rotate' && this._overRotateHandle(wp)) {
        const tgt = this._rotateTarget();
        if (tgt) {
          if (tgt.kind === 'slot') {
            if (tgt.slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
            // 已是该插槽/该插槽内附件的选择态则不覆盖(保留附件级选择的树高亮)
            const cur = ctx.selection;
            const keep = cur && ((cur.type === 'slot' && cur.name === tgt.slot.name)
              || (cur.type === 'att' && cur.slot === tgt.slot.name));
            if (!keep) ctx.select('slot', tgt.slot.name);
            this._beginRotateDrag(tgt, wp);
            return;
          }
          if (tgt.bone.locked) { toast('骨骼已锁定,解锁后可编辑', 'info'); return; }
          ctx.select('bone', tgt.bone.name);
          this._beginRotateDrag(tgt, wp);
          return;
        }
      }
      const hit = this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y);
      if (hit) {
        const bone = ctx.project.armature.bones.find((b) => b.name === hit);
        if (bone && bone.locked) { toast('骨骼已锁定', 'info'); return; }
        ctx.select('bone', hit);
        if (ctx.tool === 'rotate') { this._beginRotateDrag({ kind: 'bone', bone }, wp); return; }
        this._beginEdit(ctx.tool === 'scale' ? '缩放骨骼' : '倾斜骨骼');
        const w = this.worlds.get(bone.name);
        this._drag = { kind: ctx.tool, bone, ox: wp.x, oy: wp.y, w, comp: this._captureComp(bone) };
        return;
      }
      // 点击图片:点击即选中该插槽;旋转/缩放同时开始对应附件操作(轴心=图片几何中心)
      if (ctx.tool === 'rotate' || ctx.tool === 'scale' || ctx.tool === 'shear') {
        const img = this._hitImage(wp.x, wp.y);
        if (img) {
          const slot = ctx.project.armature.slots.find((s) => s.name === img);
          if (slot && slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
          const di = slot && slot.displayIndex >= 0 && slot.displayIndex < ((slot && slot.displays) || []).length ? slot.displayIndex : 0;
          const disp = slot && slot.displays[di];
          if (disp) {
            const cur = ctx.selection;
            const keep = cur && ((cur.type === 'slot' && cur.name === img) || (cur.type === 'att' && cur.slot === img));
            if (!keep) ctx.select('slot', img);
            if (ctx.tool === 'rotate') this._beginRotateDrag({ kind: 'slot', slot, disp }, wp);
            else if (ctx.tool === 'scale') this._beginScaleSlotDrag({ kind: 'slot', slot, disp }, wp);
            return;
          }
        }
      }
      // 空白区域:不改变选择,直接以当前选择为目标继续本模式操作(拖拽旋转/缩放/倾斜)
      {
        const tgt = this._rotateTarget();
        if (tgt && ctx.tool === 'rotate') {
          if (tgt.kind === 'slot' && tgt.slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
          if (tgt.kind === 'bone' && tgt.bone.locked) { toast('骨骼已锁定,解锁后可编辑', 'info'); return; }
          this._beginRotateDrag(tgt, wp);
          return;
        }
        if (tgt && tgt.kind === 'bone') {
          if (tgt.bone.locked) { toast('骨骼已锁定,解锁后可编辑', 'info'); return; }
          this._beginEdit(ctx.tool === 'scale' ? '缩放骨骼' : '倾斜骨骼');
          const w = this.worlds.get(tgt.bone.name);
          this._drag = { kind: ctx.tool, bone: tgt.bone, ox: wp.x, oy: wp.y, w, comp: this._captureComp(tgt.bone) };
          return;
        }
        if (tgt && tgt.kind === 'slot' && ctx.tool === 'scale') { this._beginScaleSlotDrag(tgt, wp); return; }
      }
      return;
    }

    // 选择工具:手柄 → 关节 → 骨线 → 图片(跳过锁定节点;Options·选择列过滤可点对象)
    const os = ctx.optSelect || {};
    const handle = this._hitHandle(wp.x, wp.y);
    if (handle) { this._beginEdit(handle.label); this._drag = { kind: handle.kind, bone: handle.bone, comp: this._captureComp(handle.bone) }; return; }
    const joint = os.bones === false ? null : this._hitJoint(wp.x, wp.y);
    if (joint) {
      const bone = ctx.project.armature.bones.find((b) => b.name === joint);
      if (bone && bone.locked) { toast('骨骼已锁定,解锁后可编辑', 'info'); return; }
      const multi = e.ctrlKey || e.metaKey ? 'ctrl' : e.shiftKey ? 'shift' : null;
      ctx.select('bone', joint, multi);
      if (!multi) {
        this._beginEdit('移动骨骼');
        const pw = bone.parent ? this.worlds.get(bone.parent) : null;
        const pwM = pw ? { a: pw.a, b: pw.b, c: pw.c, d: pw.d, tx: pw.tx || 0, ty: pw.ty || 0 } : this._rootSpace();
        const bw2 = this.worlds.get(bone.name);
        // 记录拖拽起点与起始线性矩阵(Axes 轴向移动的基准,拖拽中矩阵随骨骼移动变化不可复用)
        this._drag = { kind: 'move', bone, sw: wp, sl: { x: bone.x, y: bone.y },
          pw: pwM,
          slGrab: worldToParentLocal(pwM, wp.x, wp.y), // 抓取点父局部(相对位移基准,防按下瞬移)
          bw: bw2 ? { a: bw2.a, b: bw2.b, c: bw2.c, d: bw2.d } : { a: 1, b: 0, c: 0, d: 1 },
          comp: this._captureComp(bone) };
      }
      return;
    }
    const line = os.bones === false ? null : this._hitBoneLine(wp.x, wp.y);
    if (line) {
      const bone = ctx.project.armature.bones.find((b) => b.name === line);
      if (bone && bone.locked) { toast('骨骼已锁定,解锁后可编辑', 'info'); return; }
      const multi = e.ctrlKey || e.metaKey ? 'ctrl' : e.shiftKey ? 'shift' : null;
      ctx.select('bone', line, multi); return;
    }
    const img = os.images === false ? null : this._hitImage(wp.x, wp.y);
    if (img) {
      const slot = ctx.project.armature.slots.find((s) => s.name === img);
      if (slot && slot.locked) { toast('插槽已锁定,解锁后可编辑', 'info'); return; }
      const cur = ctx.selection;
      const keep = cur && ((cur.type === 'slot' && cur.name === img) || (cur.type === 'att' && cur.slot === img));
      if (!keep) ctx.select('slot', img);
      // 移动工具:点图片即可直接拖拽移动该附件
      if (ctx.tool === 'move' && slot) {
        const di = slot.displayIndex >= 0 && slot.displayIndex < (slot.displays || []).length ? slot.displayIndex : 0;
        const disp = slot.displays[di];
        if (disp) this._beginMoveSlotDrag({ kind: 'slot', slot, disp }, wp);
      }
      return;
    }
    // 移动工具:空白区不改变选择,直接以当前选择为目标开始移动(Shift 仍保留框选)
    if (ctx.tool === 'move' && !e.shiftKey) {
      const tgt = this._rotateTarget();
      if (tgt && tgt.kind === 'bone' && !tgt.bone.locked) {
        const bone = tgt.bone;
        this._beginEdit('移动骨骼');
        const pw = bone.parent ? this.worlds.get(bone.parent) : null;
        const pwM = pw ? { a: pw.a, b: pw.b, c: pw.c, d: pw.d, tx: pw.tx || 0, ty: pw.ty || 0 } : this._rootSpace();
        const bw2 = this.worlds.get(bone.name);
        this._drag = {
          kind: 'move', bone, sw: wp, sl: { x: bone.x, y: bone.y },
          pw: pwM,
          slGrab: worldToParentLocal(pwM, wp.x, wp.y), // 抓取点父局部(相对位移基准,防按下瞬移)
          bw: bw2 ? { a: bw2.a, b: bw2.b, c: bw2.c, d: bw2.d } : { a: 1, b: 0, c: 0, d: 1 },
          comp: this._captureComp(bone),
        };
        return;
      }
      if (tgt && tgt.kind === 'slot') { this._beginMoveSlotDrag(tgt, wp); return; }
      return; // 无可选目标:保持选择不变
    }
    // Shift+拖拽空白区域:框选骨骼
    if (e.shiftKey) {
      this._drag = { kind: 'boxSelect', p0: wp, p1: wp };
      return;
    }
    ctx.select(null, null);
  }

  _beginEdit(label) { this._editLabel = label; this.ctx.beginEdit(label); }

  _onMove(e) {
    if (!this.app) return;
    const ctx = this.ctx;
    const wp = this.toWorld(e.clientX, e.clientY);
    // 鼠标屏幕坐标(画布相对):标尺红色指示线跟随;移出画布范围即清除
    {
      const r = this.app.canvas.getBoundingClientRect();
      const zf = this._zoomFactor();
      const sx = (e.clientX - r.left) / zf, sy = (e.clientY - r.top) / zf;
      const inside = sx >= 0 && sy >= 0 && sx <= r.width / zf && sy <= r.height / zf;
      const next = inside ? { sx, sy } : null;
      const prev = this._mouseScreen;
      if ((next !== null) !== (prev !== null) || (next && prev && (next.sx !== prev.sx || next.sy !== prev.sy))) {
        this._mouseScreen = next;
        this.renderRulers(); // 只重绘标尺(小画布),不触碰主渲染
      }
    }
    // 状态栏坐标回显(元素缓存,避免逐次 querySelector)
    const info = (this._stageInfoEl && this._stageInfoEl.isConnected) ? this._stageInfoEl
      : (this._stageInfoEl = this.container.querySelector?.('.be-stage-info') || null);
    if (info) {
      const t = this._hoverBoneAt(wp);
      info.textContent = `x ${wp.x.toFixed(0)}  y ${wp.y.toFixed(0)}  ${Math.round(this.camera.zoom * 100)}%` + (t ? `  · 骨骼 ${t}` : '');
    }
    const d = this._drag;
    if (!d) {
      // 图片悬停追踪(变换模式):白色虚线包围框跟随
      {
        const t = ctx.tool;
        const hovImg = (t === 'rotate' || t === 'move' || t === 'scale' || t === 'shear') ? this._hitImage(wp.x, wp.y) : null;
        if (hovImg !== this._hoverImg) { this._hoverImg = hovImg; this.render(); }
      }
      if ((ctx.tool === 'select' || ctx.tool === 'move') && this._guidesVisible()) {
        const hov = this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y);
        if (hov !== this._hover) { this._hover = hov; this.render(); }
        this.app.canvas.style.cursor = hov ? 'pointer' : this._hitHandle(wp.x, wp.y) ? 'grab' : 'default';
      } else if (ctx.tool === 'rotate' || ctx.tool === 'scale' || ctx.tool === 'shear') {
        const hov = this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y);
        if (hov !== this._hover) { this._hover = hov; this.render(); }
        this.app.canvas.style.cursor = this._overRotateHandle(wp) ? 'grab'
          : (hov || (ctx.tool === 'rotate' && this._hitImage(wp.x, wp.y))) ? (ctx.tool === 'rotate' ? 'crosshair' : ctx.tool === 'scale' ? 'nwse-resize' : 'col-resize') : 'default';
      }
      return;
    }
    if (d.kind === 'pan') {
      const zf = this._zoomFactor();
      this.camera.x = d.cx + (e.clientX - d.sx) / zf;
      this.camera.y = d.cy + (e.clientY - d.sy) / zf;
      if (this._rbtn && Math.hypot(e.clientX - this._rbtn.x, e.clientY - this._rbtn.y) > 4) this._rbtn.moved = true;
      this.render();
      return;
    }
    if (d.kind === 'move' && d.bone) {
      const bone = d.bone;
      const axes = ctx.axes || 'world';
      let x, y;
      if (axes === 'parent') {
        // 父级轴向:以抓取点为基准的相对位移(此前直接取指针父局部绝对坐标,抓取点不在骨骼
        // 原点时按下即把骨骼瞬移到指针 —— 表现为「点击组件就跳跃、上下拖动似反向」)
        const local = worldToParentLocal(d.pw, wp.x, wp.y);
        x = d.sl.x + (local.x - d.slGrab.x);
        y = d.sl.y + (local.y - d.slGrab.y);
      } else {
        // 世界/本地轴向:起始位置 + 沿指定坐标系的拖拽位移
        const v = apply2(inv2(d.pw), wp.x - d.sw.x, wp.y - d.sw.y); // 世界位移 → 父局部
        // 本地轴:自由拖拽下与世界轴等价(位移经骨骼基只是恒等往返,仅箭头单轴约束时有差异)
        x = d.sl.x + v.x;
        y = d.sl.y + v.y;
      }
      ctx.editBone(bone.name, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      // 补偿(Spine Compensate):移动骨骼时子骨骼/图片保持世界姿态(骨架编辑模式,精确矩阵法)
      if ((ctx.compBones || ctx.compImages) && ctx.mode === 'setup') this._applyCompensate(bone, d);
      return;
    }
    if (d.kind === 'rotate' && d.bone) {
      const bone = d.bone;
      const w = this.worlds.get(bone.name);
      if (!w) return;
      // 增量累计:跨 ±180° 不跳变 -> 动画模式·本地/父级轴可连续拖出多圈(720°/-540° 等)
      const phiC = this._phiC(d.piv || { x: w.tx, y: w.ty }, wp);
      d.acc += this._rotSign() * angleDelta(phiC, d.lastPhiC); // 按 RT/自绘渲染路径取符号(此前 spine 恒 -1,自绘 spine 工程反向)
      d.lastPhiC = phiC;
      let local = d.startLocal + d.acc;
      if (e.shiftKey) local = Math.round(local / 15) * 15; // Shift:15° 增量吸附
      const parentW = bone.parent ? this.worlds.get(bone.parent) : null;
      const phiP = parentW ? (Math.atan2(parentW.b, parentW.a) * 180) / Math.PI : 0;
      if (this.ctx.mode !== 'anim') {
        // 装配模式:本地旋转锁 0-360°(指示骨骼指向,定义 T-Pose 基础姿态)
        local = ((local % 360) + 360) % 360;
      } else if ((this.ctx.axes || 'world') === 'world') {
        // 动画模式+世界轴:世界指向锁 0-360°,不能记录多圈旋转
        const sp2 = !!this.ctx.project.spine;
        const world = ((((sp2 ? phiP - local : local + phiP) % 360) + 360) % 360);
        local = sp2 ? phiP - world : world - phiP;
      }
      ctx.editBone(bone.name, { rotation: Math.round(local * 10) / 10 });
      // 补偿(Spine Compensate):旋转骨骼时子骨骼/图片保持世界姿态(骨架编辑模式,精确矩阵法)
      if ((ctx.compBones || ctx.compImages) && ctx.mode === 'setup') this._applyCompensate(bone, d);
      return;
    }
    if (d.kind === 'rotateSlot' && d.disp) {
      // 旋转图片附件:轴心=图片矩形几何中心(固定),值=Attachment.Rotation(骨骼数值不变)
      const phiC = this._phiC(d.piv, wp);
      d.acc += this._rotSign() * angleDelta(phiC, d.lastPhiC); // RT 翻转系下符号与骨骼旋转一致,方向才与鼠标同向
      d.lastPhiC = phiC;
      let r = d.startRot + d.acc;
      if (e.shiftKey) r = Math.round(r / 15) * 15; // Shift:15° 增量吸附
      r = Math.round(r * 10) / 10;
      const t = d.disp.transform || (d.disp.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      const old = t.rotation || 0;
      if (r !== old) {
        // 附件旋转的固有轴心是 pivot 锚点;锚点≠几何中心时平移补偿,保持几何中心不动
        const cache = this.imgCache.get(d.disp.imageId);
        const w = cache ? cache.img.naturalWidth : 0, h = cache ? cache.img.naturalHeight : 0;
        const csx = (0.5 - (d.disp.pivot?.x ?? 0.5)) * w * (t.scaleX ?? 1);
        const csy = (0.5 - (d.disp.pivot?.y ?? 0.5)) * h * (t.scaleY ?? 1);
        if (csx || csy) {
          const r1 = (old * Math.PI) / 180, r2 = (r * Math.PI) / 180;
          const c1 = Math.cos(r1), s1 = Math.sin(r1), c2 = Math.cos(r2), s2 = Math.sin(r2);
          t.x += (c1 * csx - s1 * csy) - (c2 * csx - s2 * csy);
          t.y += (s1 * csx + c1 * csy) - (s2 * csx + c2 * csy);
        }
        t.rotation = r;
        this.render();
        this.ctx.syncTransformUI?.(); // 数值实时回显(不等松手)
      }
      return;
    }
    if (d.kind === 'moveSlot' && d.disp) {
      // 移动图片附件:指针父骨骼局部位移累加到附件偏移(骨骼数值不变)
      const pw = this.worlds.get(d.boneName);
      if (!pw) return;
      const local = worldToParentLocal(pw, wp.x, wp.y);
      const t = d.disp.transform || (d.disp.transform = {});
      t.x = Math.round((d.baseX + local.x - d.startLocal.x) * 10) / 10;
      t.y = Math.round((d.baseY + local.y - d.startLocal.y) * 10) / 10;
      this.render();
      this.ctx.syncTransformUI?.(); // 数值实时回显(不等松手)
      return;
    }
    if (d.kind === 'scaleSlot' && d.disp) {
      // 缩放图片附件:距几何中心距离比例等比缩放(轴心保持不动)
      const dist = Math.hypot(wp.x - d.piv.x, wp.y - d.piv.y);
      const r2 = Math.max(dist / Math.max(d.startDist, 1e-6), 0.01);
      const t = d.disp.transform || (d.disp.transform = {});
      t.scaleX = Math.round(d.baseSx * r2 * 100) / 100;
      t.scaleY = Math.round(d.baseSy * r2 * 100) / 100;
      this.render();
      this.ctx.syncTransformUI?.(); // 数值实时回显(不等松手)
      return;
    }
    if (d.kind === 'length' && d.bone) {
      // 拖拽调整骨骼长度:鼠标到关节距离 = 新长度
      const w = this.worlds.get(d.bone.name);
      if (!w) return;
      const len = Math.hypot(wp.x - w.tx, wp.y - w.ty);
      ctx.editBone(d.bone.name, { length: Math.max(1, Math.round(len)) });
      return;
    }
    if (d.kind === 'scale' && d.bone) {
      const w = d.w || this.worlds.get(d.bone.name);
      if (!w) return;
      const curDist = Math.hypot(wp.x - w.tx, wp.y - w.ty);
      const origDist = Math.hypot(d.ox - w.tx, d.oy - w.ty) || 1;
      const ratio = curDist / origDist;
      const baseS = d.baseScale || (d.baseScale = { x: d.bone.scaleX, y: d.bone.scaleY });
      ctx.editBone(d.bone.name, {
        scaleX: Math.round(baseS.x * ratio * 100) / 100,
        scaleY: Math.round(baseS.y * ratio * 100) / 100,
      });
      return;
    }
    if (d.kind === 'shear' && d.bone) {
      const w = d.w || this.worlds.get(d.bone.name);
      if (!w) return;
      const curAng = Math.atan2(wp.y - w.ty, wp.x - w.tx) * 180 / Math.PI;
      const origAng = Math.atan2(d.oy - w.ty, d.ox - w.tx) * 180 / Math.PI;
      const delta = curAng - origAng;
      const baseShear = d.baseShear || (d.baseShear = { x: d.bone.shearX || 0, y: d.bone.shearY || 0 });
      ctx.editBone(d.bone.name, {
        shearX: Math.round((baseShear.x + delta) * 10) / 10,
        shearY: baseShear.y,
      });
      return;
    }
    if (d.kind === 'boneCreate') {
      d.p1 = wp;
      this._drawCreatePreview(d);
      return;
    }
    if (d.kind === 'boxSelect') {
      d.p1 = wp;
      this._drawBoxSelect(d);
      return;
    }
  }

  _hoverBoneAt(wp) {
    return this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y) || null;
  }

  _drawCreatePreview(d) {
    // 预览线(直接重画骨骼层 + 追加预览)
    this.render();
    const g = this.boneG;
    const z = this.camera.zoom;
    const pw = d.parentName ? this.worlds.get(d.parentName) : null;
    const o = worldToParentLocal(pw, d.p0.x, d.p0.y);
    const origin = d.p0;
    g.moveTo(origin.x, origin.y).lineTo(d.p1.x, d.p1.y);
    g.stroke({ width: 2 / z, color: COLOR_SEL, alpha: 0.95 });
    g.circle(origin.x, origin.y, 5 / z).stroke({ width: 1.5 / z, color: COLOR_SEL });
    void o;
  }

  _drawBoxSelect(d) {
    this.render();
    const g = this.boneG;
    const z = this.camera.zoom;
    const x0 = Math.min(d.p0.x, d.p1.x), y0 = Math.min(d.p0.y, d.p1.y);
    const x1 = Math.max(d.p0.x, d.p1.x), y1 = Math.max(d.p0.y, d.p1.y);
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.stroke({ width: 1.5 / z, color: COLOR_SEL, alpha: 0.8 });
    g.fill({ color: COLOR_SEL, alpha: 0.08 });
  }

  _onUp(e) {
    const d = this._drag;
    this._drag = null;
    if (!d || !this.app) return;
    if (d.kind === 'boneCreate') {
      const wp = this.toWorld(e.clientX, e.clientY);
      const dist = Math.hypot(wp.x - d.p0.x, wp.y - d.p0.y);
      if (dist < 4 / this.camera.zoom) return; // 误触
      const pw = d.parentName ? this.worlds.get(d.parentName) : this._rootSpace();
      const local = worldToParentLocal(pw, d.p0.x, d.p0.y);
      const worldAng = (Math.atan2(wp.y - d.p0.y, wp.x - d.p0.x) * 180) / Math.PI;
      const parentAng = d.parentName ? (Math.atan2(pw.b, pw.a) * 180) / Math.PI : 0;
      const rot = worldAng - parentAng;
      this.ctx.createBone(d.parentName || '', Math.round(local.x), Math.round(local.y), Math.round(rot * 10) / 10, Math.round(dist));
      return;
    }
    if (d.kind === 'boxSelect') {
      // 框选完成:将矩形内所有骨骼加入多选
      const x0 = Math.min(d.p0.x, d.p1.x), y0 = Math.min(d.p0.y, d.p1.y);
      const x1 = Math.max(d.p0.x, d.p1.x), y1 = Math.max(d.p0.y, d.p1.y);
      const minArea = 10 / this.camera.zoom;
      if (x1 - x0 > minArea && y1 - y0 > minArea) {
        for (const h of this._boneHits) {
          if (h.origin.x >= x0 && h.origin.x <= x1 && h.origin.y >= y0 && h.origin.y <= y1) {
            this.ctx.multiSel.add(h.name);
          }
        }
        const first = this.ctx.multiSel.values().next().value;
        if (first) this.ctx.select('bone', first);
      }
      this.render();
      return;
    }
    if ((d.kind === 'move' || d.kind === 'rotate' || d.kind === 'rotateSlot' || d.kind === 'moveSlot' || d.kind === 'scaleSlot' || d.kind === 'length' || d.kind === 'scale' || d.kind === 'shear') && this._editLabel) {
      this._editLabel = null;
      this.ctx.refresh(); // 提交后全量刷新(时间轴上出现关键帧)
    }
  }

  _onUpPan(e) {
    // 右键原地点击(位移 <4px)= 切换上一工具;拖动过则只是平移结束
    if (this._rbtn && !this._rbtn.moved) this.ctx.swapLastTool?.();
    this._rbtn = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomAt(e.clientX, e.clientY, f);
    this.ctx.onZoomChange?.();
  }

  _onDrop(e) {
    const id = e.dataTransfer.getData('application/x-bone-img');
    if (!id) return;
    e.preventDefault();
    const wp = this.toWorld(e.clientX, e.clientY);
    this.ctx.bindImageAt(id, wp.x, wp.y);
  }
}

// ---------------- 几何工具 ----------------

/** 2x2 矩阵求逆(线性部分) */
function inv2(m) { const det = (m.a * m.d - m.b * m.c) || 1e-9; return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det }; }
/** 2x2 矩阵作用于向量 */
function apply2(m, x, y) { return { x: m.a * x + m.c * y, y: m.b * x + m.d * y }; }

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

function pointInQuad(px, py, quad) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (i === 0) s = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== s) return false;
  }
  return true;
}
