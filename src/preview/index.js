import * as PIXI from 'pixi.js';
import { createPlayer } from './playerFactory.js';

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/**
 * 预览控制器:管理 Pixi 应用、播放器生命周期、帧循环、视图缩放/平移、播放控制
 */
export class PreviewController {
  constructor() {
    this.app = null;
    this.player = null;
    this.viewC = null; // 包裹容器,负责缩放/平移
    this.canvas = null;
    this.wrap = null;
    this.mode = 'loop';
    this.paused = false;
    this.speed = 1;
    this.flip = false;
    this.currentItemId = null;
    this.actions = [];
    this.actionIndex = 0;
    this.loadToken = 0;
    this.fitPending = false;
    this.lastT = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.fpsVal = 0;
    this._ro = null;
    this._drag = null;
    this.fitPolicy = '100'; // 'fit' | '100' | 'fixed' | 'dynamic',由 UI 的 zoom-mode 同步
  }

  async init(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    const app = new PIXI.Application();
    await app.init({
      view: canvas,
      width: canvas.clientWidth || 800,
      height: canvas.clientHeight || 600,
      background: 0x22242b,
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
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const rect = canvas.getBoundingClientRect();
      const sx = this.app.renderer.width / rect.width;
      const sy = this.app.renderer.height / rect.height;
      this.viewC.position.set(
        this._drag.px + (e.clientX - this._drag.x) * sx,
        this._drag.py + (e.clientY - this._drag.y) * sy
      );
      this.fitPending = false;
    });
    canvas.addEventListener('pointerup', () => { this._drag = null; });
    canvas.addEventListener('pointerleave', () => { this._drag = null; });

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.wrap);
  }

  _resize() {
    if (!this.app) return;
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (w > 0 && h > 0) this.app.renderer.resize(w, h);
    this.fitPending = true;
  }

  _loop = (t) => {
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.app) {
      if (!this.paused && this.mode !== 'single' && this.player) {
        this.player.update(dt);
      }
      this.app.render();
      // FPS 统计
      this.frameCount++;
      this.fpsTimer += dt;
      if (this.fpsTimer >= 0.5) {
        this.fpsVal = Math.round(this.frameCount / this.fpsTimer);
        this.frameCount = 0;
        this.fpsTimer = 0;
      }
      if (this.fitPending && this.player) {
        this.fitPending = false;
        // 窗口 resize 后的行为跟随当前缩放策略:
        // - fit:重新适配窗口
        // - dynamic:动态判断(100% 放得下用 100%,否则适配)
        // - 100 / fixed:保持当前缩放比例不变(内容居中已在 loadItem 设置)
        if (this.fitPolicy === 'fit') {
          this.fit();
        } else if (this.fitPolicy === 'dynamic' && typeof this.fitDynamic === 'function') {
          this.fitDynamic();
        }
        // 100 / fixed:无需处理,保持现有 scale
      }
    }
    requestAnimationFrame(this._loop);
  };

  // ---------------- 加载 ----------------

  async loadItem(item) {
    const token = ++this.loadToken;
    this.disposePlayer();
    this.currentItemId = item.id;

    try {
      const { player } = await createPlayer(this.app, item);

      if (token !== this.loadToken) { player.dispose(); return; }

      this.player = player;
      this.viewC.removeChildren();
      this.viewC.addChild(player.getDisplay());
      // 重置视图变换,确保 fit 从干净状态开始
      this.viewC.scale.set(1, 1);
      this.viewC.position.set(0, 0);
      this.viewC.pivot.set(0, 0);

      this.actions = player.actions;
      this.actionIndex = Math.max(0, this.actions.findIndex((a) => a.name === this.lastActionName) > -1
        ? this.actions.findIndex((a) => a.name === this.lastActionName)
        : 0);
      if (!this.actions.length) {
        throw new Error('该骨骼没有可播放的动作');
      }
      this.applyPlayback();
      this.player.setTimeScale(this.speed);
      this.player.setShowBones(document.getElementById('show-bones').checked);
      // 默认缩放 100%(原始尺寸),内容中心对齐视口中心;用户可点 ⤢ 手动适配窗口
      this.fitPending = false;
      let bounds = null;
      if (this.player && typeof this.player.getSkeletonBounds === 'function') {
        try {
          bounds = this.player.getSkeletonBounds();
        } catch (err) {
          bounds = null;
        }
      }
      // 兜底:播放器包围盒不可用(如动画全程无可见内容)时退回 pixi 局部包围盒
      if (!(bounds && bounds.width > 0 && bounds.height > 0 && isFinite(bounds.width))) {
        try {
          const lb = this.viewC.getLocalBounds();
          if (lb && lb.width > 0 && lb.height > 0 && isFinite(lb.width)) {
            bounds = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
          }
        } catch (err) {
          bounds = null;
        }
      }
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        this.viewC.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        this.viewC.position.set(this.app.renderer.width / 2, this.app.renderer.height / 2);
      }
      this.setZoomRatio(1);
      return true;
    } catch (err) {
      if (token === this.loadToken) {
        this.disposePlayer();
        window.__lastLoadStack = (err && err.stack) || String(err);
        throw err;
      }
    }
  }

  // ---------------- 播放控制 ----------------

  get currentAction() {
    return this.actions[this.actionIndex] || null;
  }

  applyPlayback() {
    if (!this.player || !this.currentAction) return;
    this.player.setAction(this.currentAction.name, this.mode);
    if (this.mode === 'single') this.player.stepTo(0);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.player && this.currentAction) {
      this.applyPlayback();
    }
  }

  setActionByName(name) {
    const idx = this.actions.findIndex((a) => a.name === name);
    if (idx < 0) return;
    this.actionIndex = idx;
    this.lastActionName = name;
    this.applyPlayback();
  }

  nextAction() {
    if (!this.actions.length) return;
    this.actionIndex = (this.actionIndex + 1) % this.actions.length;
    this.lastActionName = this.actions[this.actionIndex].name;
    this.applyPlayback();
  }

  prevAction() {
    if (!this.actions.length) return;
    this.actionIndex = (this.actionIndex - 1 + this.actions.length) % this.actions.length;
    this.lastActionName = this.actions[this.actionIndex].name;
    this.applyPlayback();
  }

  togglePlay() {
    this.paused = !this.paused;
    return this.paused;
  }

  restart() {
    if (this.player && this.currentAction) this.applyPlayback();
  }

  setSpeed(s) {
    this.speed = s;
    if (this.player) this.player.setTimeScale(s);
  }

  setBgColor(color) {
    if (this.app) this.app.renderer.background.color = parseInt(color.replace('#', ''), 16);
  }

  setFlip(v) {
    this.flip = v;
    // 以内容中心为 pivot 翻转,保证位置不变(仅水平镜像)
    const s = Math.abs(this.viewC.scale.x || 1);
    this.viewC.scale.set((v ? -1 : 1) * s, s);
  }

  /** 旋转 90°(顺时针) */
  rotateClockwise() {
    if (!this.viewC) return;
    this.viewC.rotation += Math.PI / 2;
  }

  /** 设置缩放比例(0.02~40,保持镜像符号) */
  setZoomRatio(r) {
    if (!this.viewC) return;
    const flip = this.viewC.scale.x < 0 ? -1 : 1;
    this.viewC.scale.set(flip * Math.max(0.02, Math.min(40, r)));
    this.fitPending = false;
  }

  getZoomRatio() {
    return this.viewC ? Math.abs(this.viewC.scale.x || 1) : 1;
  }

  // ---------------- 插槽 / 版本(代理到播放器) ----------------

  getSlots() {
    return this.player && typeof this.player.getSlots === 'function' ? this.player.getSlots() : [];
  }

  setSlotVisible(name, visible) {
    if (this.player && typeof this.player.setSlotVisible === 'function') {
      this.player.setSlotVisible(name, visible);
    }
  }

  getVersionInfo() {
    return this.player && typeof this.player.getVersion === 'function' ? this.player.getVersion() : '';
  }

  stepFrame(dir) {
    if (!this.player) return;
    const step = 1 / Math.max(1, this.player.fps || 30);
    this.player.stepTo(clamp(this.player.currentTime + dir * step, 0, this.player.duration || step));
  }

  stepToRatio(r) {
    if (!this.player) return;
    const dur = this.player.duration || 0;
    this.player.stepTo(r * dur);
  }

  // ---------------- 视图 ----------------

  fit() {
    if (!this.viewC || !this.player || !this.app) return;
    const flip = this.flip ? -1 : 1;

    // 优先使用播放器提供的骨架包围盒(顶点数据计算,不受 pixi bounds 时机影响)
    let bounds = null;
    if (this.player && typeof this.player.getSkeletonBounds === 'function') {
      try {
        bounds = this.player.getSkeletonBounds();
      } catch (err) {
        bounds = null;
      }
    }
    if (!bounds) {
      const s0 = this.viewC.scale.x || 1;
      this.viewC.scale.set(flip * Math.abs(s0), Math.abs(s0)); // 保持翻转状态
      try {
        bounds = this.viewC.getLocalBounds();
      } catch (err) {
        return;
      }
      bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !isFinite(bounds.width)) return;
    const s = Math.min(w / bounds.width, h / bounds.height, 20) * 0.85;
    // pivot 设为内容中心:缩放/镜像/旋转都围绕中心,位置不跳变
    this.viewC.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    this.viewC.scale.set(flip * s, s);
    this.viewC.position.set(w / 2, h / 2);
    this.fitPending = false;
  }

  /**
   * 动态缩放:动画以 100% 原始尺寸能完整放进窗口 → 100%;
   * 放不下(100% 会超出可显示区域)→ 适配窗口。
   */
  fitDynamic() {
    if (!this.viewC || !this.player || !this.app) return;
    const flip = this.flip ? -1 : 1;
    let bounds = null;
    if (this.player && typeof this.player.getSkeletonBounds === 'function') {
      try {
        bounds = this.player.getSkeletonBounds();
      } catch (err) {
        bounds = null;
      }
    }
    if (!bounds) {
      const s0 = this.viewC.scale.x || 1;
      this.viewC.scale.set(flip * Math.abs(s0), Math.abs(s0));
      try {
        bounds = this.viewC.getLocalBounds();
      } catch (err) {
        return;
      }
      bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !isFinite(bounds.width)) return;
    // 100% 原始尺寸能否完整放入视口(不乘 0.85 边距,按"可显示区域"判断)
    const fitScale = Math.min(w / bounds.width, h / bounds.height, 20);
    if (fitScale >= 1) {
      // 能放下 → 100%,内容居中
      this.viewC.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      this.viewC.position.set(w / 2, h / 2);
      this.setZoomRatio(1);
    } else {
      // 放不下 → 适配窗口
      this.fit();
    }
    this.fitPending = false;
  }

  // ---------------- 状态 ----------------

  getStatus() {
    if (!this.player || !this.currentAction) return '';
    const cur = this.player.currentTime || 0;
    const dur = this.player.duration || 0;
    const a = this.currentAction.name;
    return `${a} · ${cur.toFixed(2)}s / ${dur.toFixed(2)}s · ${this.fpsVal} FPS`;
  }

  disposePlayer() {
    if (this.player) {
      try {
        this.player.dispose();
      } catch (err) {
        /* ignore */
      }
      this.player = null;
    }
    if (this.viewC) this.viewC.removeChildren();
  }
}
