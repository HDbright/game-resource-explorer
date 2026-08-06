import * as PIXI from 'pixi.js';

let dbBundlePromise = null;

/**
 * 加载 DragonBones pixi8 运行时(UMD)。
 * 必须先设置 window.PIXI,再注入经典脚本,脚本加载完成后 window.dragonBones 可用。
 */
export function loadDbBundle() {
  if (window.__dragonBones) return Promise.resolve(window.__dragonBones);
  if (dbBundlePromise) return dbBundlePromise;
  dbBundlePromise = new Promise((resolve, reject) => {
    window.PIXI = PIXI;
    const s = document.createElement('script');
    s.src = '/vendor/dragonbones/dragonBones.js';
    s.onload = () => {
      if (window.dragonBones) {
        window.__dragonBones = window.dragonBones;
        resolve(window.dragonBones);
      } else {
        reject(new Error('DragonBones 运行时未正常挂载'));
      }
    };
    s.onerror = () => reject(new Error('DragonBones 运行时加载失败'));
    document.head.appendChild(s);
  });
  return dbBundlePromise;
}

/**
 * DragonBones 动画播放器(官方 pixi8 适配器,手动时钟驱动)
 */
export class DbPlayer {
  constructor(app) {
    this.app = app;
    this.dragonBones = null;
    this.factory = null;
    this.armatureDisplay = null;
    this.armature = null;
    this.actions = [];
    this.loadedUrls = [];
    this._actionName = null;
  }

  async load({ skeletonUrl, atlasUrl }) {
    this.dispose();

    this.dragonBones = await loadDbBundle();
    const db = this.dragonBones;

    // 手动时钟:不使用共享 Ticker,由外部循环调用 PixiFactory.advanceTime(dt)
    const factory = new db.PixiFactory(null, false);
    this.factory = factory;

    const skelRes = await fetch(skeletonUrl);
    if (!skelRes.ok) throw new Error(`骨架文件加载失败 (${skelRes.status})`);
    const skeletonData = await skelRes.json();
    if (!factory.parseDragonBonesData(skeletonData)) {
      throw new Error('无法解析 DragonBones 数据(可能版本过旧,仅支持 5.x)');
    }

    const atlasRes = await fetch(atlasUrl);
    if (!atlasRes.ok) throw new Error(`贴图集文件加载失败 (${atlasRes.status})`);
    const atlasData = await atlasRes.json();
    const imagePath = atlasData.imagePath || atlasUrl.replace(/\.[^.]+$/, '') + '.png';
    const texImageUrl = new URL(imagePath, atlasUrl).href;
    const texture = await PIXI.Assets.load({ src: texImageUrl });
    factory.parseTextureAtlasData(atlasData, texture);
    this.loadedUrls.push(texImageUrl);

    const armatureName = skeletonData.armature?.[0]?.name || 'Armature';
    const dragonBonesName = skeletonData.name || '';
    const armatureDisplay = factory.buildArmatureDisplay(armatureName, dragonBonesName);
    if (!armatureDisplay) {
      throw new Error(`未找到骨架资源: ${armatureName}`);
    }

    this.armatureDisplay = armatureDisplay;
    this.armature = armatureDisplay.armature;

    // 动作列表(5.7 运行时中 animations 为普通对象 {name: AnimationData})
    this.actions = [];
    const anim = armatureDisplay.animation;
    const anims = (anim && anim.animations) || {};
    for (const name of Object.keys(anims)) {
      const data = anims[name];
      this.actions.push({ name, duration: (data && data.duration) || 0 });
    }

    if (this.actions.length) {
      this.setAction(this.actions[0].name, 'loop');
    }
    return this;
  }

  getDisplay() {
    return this.armatureDisplay;
  }

  /** 手动计算包围盒(fit/居中用) */
  getSkeletonBounds() {
    if (!this.armatureDisplay) return null;
    try {
      const b = this.armatureDisplay.getBounds();
      if (!b || b.width <= 0 || b.height <= 0 || !isFinite(b.width)) return null;
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } catch (err) {
      return null;
    }
  }

  get fps() {
    const st = this.armatureDisplay?.animation?.lastAnimationState;
    const ad = st?.animationData;
    if (ad && ad.duration > 0 && ad.frameCount > 0) return ad.frameCount / ad.duration;
    return 30;
  }

  setAction(name, mode) {
    if (!this.armatureDisplay) return;
    this._actionName = name;
    const anim = this.armatureDisplay.animation;
    anim.timeScale = 1;
    if (mode === 'single') {
      anim.gotoAndStopByTime(name, 0);
    } else {
      anim.play(name, mode === 'once' ? 1 : 0);
    }
  }

  /** 播放推进(倍速由 animation.timeScale 控制) */
  update(dt) {
    if (this.dragonBones) this.dragonBones.PixiFactory.advanceTime(dt);
  }

  /** 单帧模式:定位到指定时间 */
  stepTo(t) {
    if (!this.armatureDisplay) return;
    const name = this._actionName || this.actions[0]?.name;
    if (!name) return;
    this.armatureDisplay.animation.gotoAndStopByTime(name, t);
  }

  get currentTime() {
    const st = this.armatureDisplay?.animation?.lastAnimationState;
    return st ? st.currentTime || 0 : 0;
  }

  get duration() {
    const st = this.armatureDisplay?.animation?.lastAnimationState;
    return st ? st.totalTime || 0 : 0;
  }

  setTimeScale(s) {
    if (this.armatureDisplay) this.armatureDisplay.animation.timeScale = s;
  }

  setShowBones(show) {
    if (this.armatureDisplay) this.armatureDisplay.debugDraw = show;
  }

  // ---------------- 插槽 / 版本 ----------------

  getSlots() {
    if (!this.armature) return [];
    return this.armature.getSlots().map((s) => ({
      name: s.name,
      visible: s.visible !== false,
    }));
  }

  setSlotVisible(name, visible) {
    if (!this.armature) return;
    const slot = this.armature.getSlot(name);
    if (slot) slot.visible = visible;
  }

  getVersion() {
    return this.dragonBones && this.dragonBones.VERSION ? this.dragonBones.VERSION : '';
  }

  dispose() {
    if (this.armature) {
      try {
        this.armature.dispose();
      } catch (err) {
        /* ignore */
      }
      this.armature = null;
      this.armatureDisplay = null;
    }
    if (this.factory) {
      try {
        this.factory.clear();
      } catch (err) {
        /* ignore */
      }
      this.factory = null;
    }
    for (const url of this.loadedUrls) {
      try {
        PIXI.Assets.unload(url);
      } catch (err) {
        /* ignore */
      }
    }
    this.loadedUrls = [];
    this.actions = [];
    this._actionName = null;
  }
}
