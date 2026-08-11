import { getPixi } from '../pixiLazy.js';

// @pixi/spine-pixi 与 pixi.js 一样体积较大, 首次创建播放器时才动态导入
let _spinePixi = null;
async function spinePixi() {
  if (!_spinePixi) _spinePixi = await import('@pixi/spine-pixi');
  return _spinePixi;
}

// ⚠️ 历史教训: 不要从这里解构 SkeletonJson / SkeletonBinary / AtlasAttachmentLoader。
// @pixi/spine-pixi 只是用 `export *` 星级透传 @esotericsoftware/spine-core 的类;
// 生产构建(Vite/Rollup)时该透传常被 tree-shaking 丢弃 → 解构得到 undefined →
// new 时抛 "Xxx is not a constructor"(压缩后形如 "Ot is not a constructor")。
// 正确做法: 用 Spine.from() 解析并创建实例 —— 它内部使用与 Spine 类同一 spine-core
// 实例解析(AtlasAttachmentLoader/SkeletonJson/SkeletonBinary), 既保证解析类可用,
// 又保证 skeletonData 能通过 Spine 构造函数的 `instanceof SkeletonData` 校验。

/**
 * Spine 动画播放器(基于 @pixi/spine-pixi 2.x,pixi v8)
 * 手动驱动:autoUpdate=false,由外部循环调用 update(dt)
 */
export class SpinePlayer {
  constructor(app) {
    this.app = app;
    this.spine = null;
    this.debugRenderer = null;
    this.spineData = null;
    this.actions = [];
    this._hiddenSlots = new Set();
  }

  async load({ skeletonUrl, atlasUrl }) {
    this.dispose();

    const PIXI = await getPixi();

    // 先加载 json/skel 与 atlas(注册的 spine loader 会把 atlas 解析为 TextureAtlas)
    await PIXI.Assets.load({ src: skeletonUrl });
    await PIXI.Assets.load({ src: atlasUrl });

    // 兼容 Spine 3.8 格式:skins 为对象 {skinName: {slot: {...}}},新版 spine-core 需要数组格式
    const skeletonAsset = PIXI.Assets.get(skeletonUrl);
    if (skeletonAsset && skeletonAsset.skins && !Array.isArray(skeletonAsset.skins)) {
      const skins = [];
      for (const skinName of Object.keys(skeletonAsset.skins)) {
        skins.push({ name: skinName, attachments: skeletonAsset.skins[skinName] });
      }
      skeletonAsset.skins = skins;
    }

    // 用 Spine.from 解析并创建实例(内部用同一 spine-core 实例解析, 见文件头注释)
    const { Spine } = await spinePixi();
    this.spine = Spine.from({ skeleton: skeletonUrl, atlas: atlasUrl });
    this.spine.autoUpdate = false;
    this.spineData = this.spine.skeleton.data;

    this.actions = (this.spineData.animations || []).map((a) => ({
      name: a.name,
      duration: a.duration || 0,
    }));

    // 默认第一帧
    if (this.actions.length) {
      this.setAction(this.actions[0].name, 'loop');
    }
    return this;
  }

  get fps() {
    return this.spineData ? this.spineData.fps || 30 : 30;
  }

  getDisplay() {
    return this.spine;
  }

  setAction(name, mode) {
    if (!this.spine) return;
    const loop = mode === 'loop';
    this.spine.skeleton.setToSetupPose();
    this.spine.state.setAnimation(0, name, loop);
    this.spine.state.timeScale = 1;
    this.spine.update(0);
  }

  /** 播放推进(倍速由 state.timeScale 控制) */
  update(dt) {
    if (this.spine) {
      this.spine.update(dt);
      this._applyHiddenSlots();
    }
  }

  /** 对隐藏插槽强制 world alpha = 0(动画 apply 每帧重置颜色,需在渲染前覆盖) */
  _applyHiddenSlots() {
    if (!this._hiddenSlots.size || !this.spine) return;
    for (const slot of this.spine.skeleton.slots) {
      if (this._hiddenSlots.has(slot.data.name)) slot.a = 0;
    }
  }

  /** 单帧模式:定位到指定时间并应用姿态 */
  stepTo(t) {
    if (!this.spine) return;
    const track = this.spine.state.tracks[0];
    if (!track || !track.animation) return;
    const dur = Math.max(0, track.animation.duration - 0.001);
    track.trackTime = Math.min(Math.max(t, 0), dur);
    this.spine.update(0);
  }

  get currentTime() {
    if (!this.spine) return 0;
    const track = this.spine.state.tracks[0];
    return track ? track.trackTime : 0;
  }

  get duration() {
    if (!this.spine) return 0;
    const track = this.spine.state.tracks[0];
    return track && track.animation ? track.animation.duration : 0;
  }

  setTimeScale(s) {
    if (this.spine) this.spine.state.timeScale = s;
  }

  async setShowBones(show) {
    if (!this.spine) return;
    if (show && !this.debugRenderer) {
      const { SpineDebugRenderer } = await spinePixi();
      this.debugRenderer = new SpineDebugRenderer();
      this.debugRenderer.drawBones = true;
      this.debugRenderer.drawMeshHull = false;
      this.debugRenderer.drawMeshTriangles = false;
      this.debugRenderer.drawPaths = false;
      this.debugRenderer.drawBoundingBoxes = false;
      this.debugRenderer.drawClipping = false;
      this.debugRenderer.drawRegionAttachments = false;
      this.debugRenderer.drawEvents = false;
      this.spine.debug = this.debugRenderer;
    } else if (!show && this.debugRenderer) {
      this.spine.debug = null;
      this.debugRenderer = null;
    }
  }

  // ---------------- 插槽 / 版本 / 包围盒 ----------------

  /**
   * 骨架包围盒(居中 / fit 用,不依赖 pixi bounds 时机)。
   * 采样当前动画整个时长返回联合包围盒(覆盖动画后期才出现的 attachment,
   * 与全程摆动范围),避免 100% 居中 / fit 时内容落在视口外。最后恢复当前姿态。
   */
  getSkeletonBounds() {
    if (!this.spine) return null;
    const sk = this.spine.skeleton;

    const accumBounds = () => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const accum = (verts, n) => {
        for (let i = 0; i < n; i += 2) {
          const x = verts[i];
          const y = -verts[i + 1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      };
      for (const slot of sk.slots) {
        if (slot.bone && !slot.bone.active) continue;
        const att = slot.getAttachment();
        if (!att) continue;
        try {
          if (att.constructor && att.constructor.name === 'RegionAttachment') {
            const v = new Float32Array(8);
            att.computeWorldVertices(slot.bone, v, 0, 2);
            accum(v, 8);
          } else if (att.worldVerticesLength) {
            const v = new Float32Array(att.worldVerticesLength);
            att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
            accum(v, v.length);
          }
        } catch (err) {
          /* ignore */
        }
      }
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    };

    const unionWith = (union, b) => {
      if (!b) return union;
      if (!union) return b;
      const nx = Math.min(union.x, b.x);
      const ny = Math.min(union.y, b.y);
      const mx = Math.max(union.x + union.width, b.x + b.width);
      const my = Math.max(union.y + union.height, b.y + b.height);
      return { x: nx, y: ny, width: mx - nx, height: my - ny };
    };

    const track = this.spine.state && this.spine.state.tracks[0];
    if (track && track.animation) {
      const dur = Math.max(0, track.animation.duration - 0.001);
      const origT = track.trackTime;
      let union = accumBounds();
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        track.trackTime = (dur * i) / steps;
        this.spine.update(0);
        union = unionWith(union, accumBounds());
      }
      // 恢复当前姿态
      track.trackTime = origT;
      this.spine.update(0);
      return union;
    }

    return accumBounds();
  }

  getSlots() {
    if (!this.spine) return [];
    return this.spine.skeleton.slots.map((s) => ({
      name: s.data.name,
      visible: !this._hiddenSlots.has(s.data.name),
    }));
  }

  setSlotVisible(name, visible) {
    if (!this.spine) return;
    if (visible) this._hiddenSlots.delete(name);
    else this._hiddenSlots.add(name);
    this._applyHiddenSlots();
  }

  getVersion() {
    return this.spineData ? this.spineData.version || '' : '';
  }

  dispose() {
    if (this.spine) {
      try {
        this.spine.destroy();
      } catch (err) {
        /* ignore */
      }
      this.spine = null;
      this.debugRenderer = null;
    }
    this.spineData = null;
    this.actions = [];
  }
}
