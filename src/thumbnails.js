import { createPlayer } from './preview/playerFactory.js';
import { typeGroup } from './state.js';
import { getPixi } from './pixiLazy.js';

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

/**
 * 缩略图服务:动画(Spine/DB)离屏渲染首帧 → dataURL;图片直连静态服务 URL;音频返回 null。
 * 三级缓存:内存 Map → 磁盘(userData/thumbnails/<itemId>.png)→ 生成后写盘。
 * 并发防抖 + 全局限流(同时最多 3 个生成任务)。
 */
export class ThumbnailService {
  constructor() {
    this.cache = new Map(); // itemId -> { key, url, pending }
    this.pending = new Map(); // itemId -> Promise
    this.active = 0;
    this.maxConcurrent = 3;
    this._app = null;
    this._viewC = null;
    this._initPromise = null;
  }

  /** 懒初始化隐藏 PIXI app(canvas 不入 DOM) */
  async _ensureApp() {
    if (this._app) return this._app;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const PIXI = await getPixi(); // 首次生成缩略图时才加载 pixi.js(启动优化)
      const app = new PIXI.Application();
      await app.init({
        width: 96,
        height: 96,
        backgroundAlpha: 0,
        antialias: true,
        resolution: 1,
        preserveDrawingBuffer: true,
        preference: 'webgl',
        autoStart: false,
      });
      this._app = app;
      this._viewC = new PIXI.Container();
      app.stage.addChild(this._viewC);
      return app;
    })();
    return this._initPromise;
  }

  /** 资源类型对应的缩略图 URL:动画 → dataURL;图片(含自定义 image 分组类型)→ 静态服务 URL;音频 → null */
  thumbnailUrl(item) {
    if (!item) return null;
    if (item.type === 'audio') return null;
    const g = typeGroup(item.type);
    if (g === 'anim') return this.getAnimThumb(item);
    if (g === 'image') {
      return `${location.origin}/a/${item.id}/${encodeURIComponent(basename(item.filePath))}`;
    }
    return null;
  }

  /**
   * 获取动画缩略图(异步;dataURL)
   * 命中顺序:内存缓存 → 磁盘缓存(读 base64 拼 dataURL)→ 离屏生成并写盘。
   * @returns {Promise<string|null>}
   */
  async getAnimThumb(item) {
    const key = `${item.id}_${item.updatedAt || 0}`;
    const hit = this.cache.get(item.id);
    if (hit && hit.key === key) return hit.url;

    // 并发防抖:同 id 只发起一次
    if (this.pending.has(item.id)) return this.pending.get(item.id);

    // 磁盘缓存(仅当条目未修改过)
    const diskUrl = await this._readDisk(item);
    if (diskUrl) {
      this.cache.set(item.id, { key, url: diskUrl });
      return diskUrl;
    }

    const promise = this._generate(item).then((url) => {
      this.cache.set(item.id, { key, url });
      this.pending.delete(item.id);
      this.active--;
      if (url) this._writeDisk(item, url);
      return url;
    }).catch((err) => {
      console.warn('[thumb] 生成失败:', item.displayName, err && err.message || err);
      this.pending.delete(item.id);
      this.active--;
      this.cache.set(item.id, { key, url: null });
      return null;
    });
    this.pending.set(item.id, promise);
    return promise;
  }

  /** 读磁盘缓存(文件名含 updatedAt,条目编辑后自动失效) */
  async _readDisk(item) {
    try {
      const api = window.api;
      if (!api || !api.thumbGet) return null;
      const b64 = await api.thumbGet(`${item.id}_${item.updatedAt || 0}`);
      if (!b64) return null;
      return `data:image/png;base64,${b64}`;
    } catch (err) {
      return null;
    }
  }

  /** 写磁盘缓存 */
  _writeDisk(item, dataUrl) {
    try {
      const api = window.api;
      if (api && api.thumbSave) api.thumbSave(`${item.id}_${item.updatedAt || 0}`, dataUrl);
    } catch (err) { /* ignore */ }
  }

  /** 限流执行:等待并发槽位 */
  async _generate(item) {
    // 等待全局并发槽
    while (this.active >= this.maxConcurrent) {
      await new Promise((r) => setTimeout(r, 80));
    }
    this.active++;
    const app = await this._ensureApp();

    // 清空上一次的显示对象
    this._viewC.removeChildren();

    const { player } = await createPlayer(app, item);
    this._viewC.addChild(player.getDisplay());

    // 选一个"最佳"动作并跳到 0.2s(比 setup pose 更有代表性)
    const actions = player.actions || [];
    const name = actions.length ? actions[0].name : null;
    if (name && typeof player.setAction === 'function') {
      player.setAction(name, 'loop');
    }
    if (typeof player.stepTo === 'function') {
      try {
        player.stepTo(0.2);
      } catch (err) { /* ignore */ }
    }
    // 渲染一帧
    app.render();

    let bounds = null;
    if (typeof player.getSkeletonBounds === 'function') {
      try {
        bounds = player.getSkeletonBounds();
      } catch (err) { bounds = null; }
    }
    if (!(bounds && bounds.width > 0 && bounds.height > 0 && isFinite(bounds.width))) {
      try {
        const lb = this._viewC.getLocalBounds();
        if (lb && lb.width > 0 && lb.height > 0 && isFinite(lb.width)) {
          bounds = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
        }
      } catch (err) { bounds = null; }
    }

    if (bounds && bounds.width > 0 && bounds.height > 0) {
      this._viewC.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      this._viewC.position.set(app.renderer.width / 2, app.renderer.height / 2);
      // 适配 96x96 缩略图
      const s = Math.min(88 / bounds.width, 88 / bounds.height, 4);
      this._viewC.scale.set(s, s);
    }
    app.render();

    const url = app.renderer.extract.canvas(this._viewC).toDataURL('image/png');

    // 清理
    this._viewC.removeChildren();
    try { player.dispose(); } catch (err) { /* ignore */ }

    return url;
  }

  /** 失效某个条目的缓存(编辑/删除后调用;同时删磁盘缓存) */
  invalidate(itemId) {
    this.cache.delete(itemId);
    this.pending.delete(itemId);
    try {
      const api = window.api;
      if (api && api.thumbDelete) api.thumbDelete(itemId);
    } catch (err) { /* ignore */ }
  }}

export const thumbnailService = new ThumbnailService();
