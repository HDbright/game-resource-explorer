import { createPlayer } from './preview/playerFactory.js';
import { typeGroup, isImageType, isVideoItem } from './state.js';
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
    this._mtimeCache = new Map(); // filePath -> { mtime, at } 短 TTL,减少重渲染时的 stat IPC
    this._posterCache = new Map(); // posterPath -> dataUrl(海报原图,长驻;视频卡片高清显示)
    this._posterPending = new Map(); // posterPath -> Promise
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

  /** 资源类型对应的缩略图 URL:图片(含自定义图片类类型/分组,如 图标 .png/.ico)→ 静态服务 URL;动画 → dataURL;FGUI → 徽标 dataURL;视频 → 首帧 dataURL;音频 → null */
  thumbnailUrl(item) {
    if (!item) return null;
    if (item.type === 'audio') return null;
    if (isImageType(item.type)) {
      return `${location.origin}/a/${item.id}/${encodeURIComponent(basename(item.filePath))}`;
    }
    const g = typeGroup(item.type);
    if (g === 'anim') return this.getAnimThumb(item);
    if (item.type === 'fgui') return this.getFguiThumb(item);
    if (isVideoItem(item)) return this.getVideoThumb(item);
    return null;
  }

  /**
   * 获取动画缩略图(异步;dataURL)
   * 命中顺序:内存缓存 → 磁盘缓存(读 base64 拼 dataURL)→ 离屏生成并写盘。
   * 缓存 key 含 条目 updatedAt + 磁盘文件 mtime:
   * - 条目元数据编辑(updatedAt 变)→ 失效;
   * - 磁盘文件被外部修改(mtime 变)→ 失效;
   * 因此「⟳ 重载」只对磁盘文件被修改过的条目重新生成,未修改的命中旧缓存。
   * @returns {Promise<string|null>}
   */
  async getAnimThumb(item) {
    const mt = await this._fileMtime(item.filePath);
    const key = `${item.id}_${item.updatedAt || 0}_${mt}`;
    const hit = this.cache.get(item.id);
    if (hit && hit.key === key) return hit.url;

    // 并发防抖:同 id 只发起一次
    if (this.pending.has(item.id)) return this.pending.get(item.id);

    // 磁盘缓存(文件名含 key → 文件 mtime 变化自动失效)
    const diskUrl = await this._readDisk(key);
    if (diskUrl) {
      this.cache.set(item.id, { key, url: diskUrl });
      return diskUrl;
    }

    const promise = this._generate(item).then((url) => {
      this.cache.set(item.id, { key, url });
      this.pending.delete(item.id);
      this.active--;
      if (url) this._writeDisk(key, url);
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

  /**
   * FGUI 包缩略图(与动画缩略图同缓存结构:内存 → 磁盘 → 生成写盘)。
   * FGUI .bin 无现成可渲染帧,用 canvas 绘制徽标(底色 + 🧩 + 包名),不依赖 PIXI。
   */
  async getFguiThumb(item) {
    const mt = await this._fileMtime(item.filePath);
    const key = `${item.id}_${item.updatedAt || 0}_${mt}`;
    const hit = this.cache.get(item.id);
    if (hit && hit.key === key) return hit.url;
    if (this.pending.has(item.id)) return this.pending.get(item.id);
    const diskUrl = await this._readDisk(key);
    if (diskUrl) {
      this.cache.set(item.id, { key, url: diskUrl });
      return diskUrl;
    }
    const promise = this._genFguiThumb(item).then((url) => {
      this.cache.set(item.id, { key, url });
      this.pending.delete(item.id);
      if (url) this._writeDisk(key, url);
      return url;
    }).catch((err) => {
      console.warn('[thumb] FGUI 生成失败:', item.displayName, err && err.message || err);
      this.pending.delete(item.id);
      this.cache.set(item.id, { key, url: null });
      return null;
    });
    this.pending.set(item.id, promise);
    return promise;
  }

  /** canvas 绘制 FGUI 包徽标(96×96 圆角底 + 🧩 + 包名) */
  _genFguiThumb(item) {
    return new Promise((resolve) => {
      try {
        const c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        const ctx = c.getContext('2d');
        const R = 14;
        ctx.beginPath();
        ctx.moveTo(R, 0); ctx.arcTo(96, 0, 96, 96, R); ctx.arcTo(96, 96, 0, 96, R);
        ctx.arcTo(0, 96, 0, 0, R); ctx.arcTo(0, 0, 96, 0, R); ctx.closePath();
        ctx.fillStyle = '#2f3b66';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '34px sans-serif';
        ctx.fillText('🧩', 48, 40);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fillText(String(item.displayName || '').slice(0, 8), 48, 80);
        resolve(c.toDataURL('image/png'));
      } catch (err) {
        resolve(null);
      }
    });
  }

  /**
   * 海报原图 dataURL(本地图片绝对路径 → 原图,不做缩放;内存缓存 posterPath → dataUrl)。
   * 供视频卡片高清显示海报;失败返回 null(调用方降级到首帧缩略图)。
   */
  getPosterUrl(poster) {
    if (!poster) return Promise.resolve(null);
    if (this._posterCache.has(poster)) return Promise.resolve(this._posterCache.get(poster));
    if (this._posterPending.has(poster)) return this._posterPending.get(poster);
    const p = window.api.readBase64(poster).then((r) => {
      const url = (r && r.ok && r.dataUrl) ? r.dataUrl : null;
      this._posterCache.set(poster, url);
      this._posterPending.delete(poster);
      return url;
    }).catch(() => {
      this._posterCache.set(poster, null);
      this._posterPending.delete(poster);
      return null;
    });
    this._posterPending.set(poster, p);
    return p;
  }

  /**
   * 视频缩略图(与动画缩略图同缓存结构:内存 → 磁盘 → 生成写盘)。
   * 用隐藏 video 元素加载首帧(静音,seek 到 0.5s)绘制到 canvas(contain 适配,黑底)。
   */
  async getVideoThumb(item) {
    const mt = await this._fileMtime(item.filePath);
    const key = `${item.id}_${item.updatedAt || 0}_${mt}`;
    const hit = this.cache.get(item.id);
    if (hit && hit.key === key) return hit.url;
    if (this.pending.has(item.id)) return this.pending.get(item.id);
    const diskUrl = await this._readDisk(key);
    if (diskUrl) {
      this.cache.set(item.id, { key, url: diskUrl });
      return diskUrl;
    }
    const promise = this._genVideoThumb(item).then((url) => {
      this.cache.set(item.id, { key, url });
      this.pending.delete(item.id);
      if (url) this._writeDisk(key, url);
      return url;
    }).catch((err) => {
      console.warn('[thumb] 视频生成失败:', item.displayName, err && err.message || err);
      this.pending.delete(item.id);
      this.cache.set(item.id, { key, url: null });
      return null;
    });
    this.pending.set(item.id, promise);
    return promise;
  }

  /** 视频缩略图:优先 item.meta.poster 自定义海报图(本地图片绝对路径);失败/无则降级到视频首帧(静音 seek 0.5s) */
  _genVideoThumb(item) {
    const poster = item && item.meta && item.meta.poster;
    if (poster) {
      return this._genPosterThumb(poster).then((url) => url || this._genVideoFirstFrame(item));
    }
    return this._genVideoFirstFrame(item);
  }

  /** 海报图缩略图(本地图片绝对路径 → 96×96 **cover 铺满** dataURL;通过 readBase64 读取;电影海报填满缩略图区域) */
  _genPosterThumb(poster) {
    return new Promise((resolve) => {
      const img = new Image();
      const fail = () => { img.removeAttribute('src'); resolve(null); };
      const to = setTimeout(fail, 8000);
      img.onload = () => {
        clearTimeout(to);
        try {
          const c = document.createElement('canvas');
          c.width = 96; c.height = 96;
          const ctx = c.getContext('2d');
          const iw = img.naturalWidth, ih = img.naturalHeight;
          if (!iw || !ih) return fail();
          // cover:按大边铺满 96×96,海报裁切填满(不留黑边)
          const s = Math.max(96 / iw, 96 / ih);
          const w = iw * s, h = ih * s;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 96, 96);
          ctx.drawImage(img, (96 - w) / 2, (96 - h) / 2, w, h);
          resolve(c.toDataURL('image/png'));
        } catch (err) { fail(); }
      };
      img.onerror = fail;
      window.api.readBase64(poster).then((r) => {
        if (r && r.ok && r.dataUrl) img.src = r.dataUrl;
        else fail();
      }).catch(fail);
    });
  }

  /** 视频首帧(96×96 contain 黑底) */
  _genVideoFirstFrame(item) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = `${location.origin}/a/${item.id}/${encodeURIComponent(basename(item.filePath))}`;
      const cleanup = () => { try { video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ } };
      const fail = () => { cleanup(); clearTimeout(to); resolve(null); };
      const to = setTimeout(fail, 10000);
      video.addEventListener('loadeddata', () => {
        try { video.currentTime = Math.min(0.5, (video.duration || 1) / 2); } catch (e) { /* ignore */ }
      });
      video.addEventListener('seeked', () => {
        clearTimeout(to);
        try {
          const vw = video.videoWidth, vh = video.videoHeight;
          if (!vw || !vh) return fail();
          const c = document.createElement('canvas');
          c.width = 96; c.height = 96;
          const ctx = c.getContext('2d');
          const s = Math.min(88 / vw, 88 / vh, 4);
          const w = vw * s, h = vh * s;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 96, 96);
          ctx.drawImage(video, (96 - w) / 2, (96 - h) / 2, w, h);
          cleanup();
          resolve(c.toDataURL('image/png'));
        } catch (err) { fail(); }
      });
      video.addEventListener('error', fail);
    });
  }

  /** 磁盘文件 mtime(ms);失败返回 0(无 mtime 时回退到仅 updatedAt 判定)。
   *  短 TTL 缓存:列表重渲染时对同一文件不重复发起 stat IPC。 */
  async _fileMtime(filePath) {
    if (!filePath) return 0;
    const hit = this._mtimeCache.get(filePath);
    if (hit && Date.now() - hit.at < 3000) return hit.mtime;
    try {
      const api = window.api;
      if (!api || !api.statFile) return 0;
      const r = await api.statFile(filePath);
      const mtime = (r && r.mtime) || 0;
      this._mtimeCache.set(filePath, { mtime, at: Date.now() });
      return mtime;
    } catch (err) {
      return 0;
    }
  }

  /** 读磁盘缓存(key = itemId_updatedAt_mtime) */
  async _readDisk(key) {
    try {
      const api = window.api;
      if (!api || !api.thumbGet) return null;
      const b64 = await api.thumbGet(key);
      if (!b64) return null;
      return `data:image/png;base64,${b64}`;
    } catch (err) {
      return null;
    }
  }

  /** 写磁盘缓存(key = itemId_updatedAt_mtime) */
  _writeDisk(key, dataUrl) {
    try {
      const api = window.api;
      if (api && api.thumbSave) api.thumbSave(key, dataUrl);
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
  }

  /**
   * 批量重新生成(「⟳ 重载」):只清内存缓存 + 强制刷新文件 mtime 缓存,【不删磁盘缓存】。
   * 磁盘缓存 key 含文件 mtime:未修改的文件 mtime 不变 → 重渲染时命中旧磁盘缓存(读 base64,秒回),
   * 只有磁盘文件被修改过的条目(mtime 变化 → key 变读不到)才会真正重新离屏生成。
   */
  reloadAll(itemIds) {
    this._mtimeCache.clear(); // 强制重新 stat,拿到用户改文件后的最新 mtime
    for (const id of itemIds || []) {
      this.cache.delete(id);
      this.pending.delete(id);
    }
  }
}

export const thumbnailService = new ThumbnailService();
