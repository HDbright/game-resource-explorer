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
    this._spineMeshes = new Map(); // slotName|attName → { mesh, positions, uvs }
    this._pendingLoads = 0;
    this._regionRetry = 0;
    this._drag = null;
    this._hover = null;
    this._ro = null;
    this._disposed = false;
  }

  async mount(container) {
    this.container = container;
    const PIXI = await getPixi();
    this.PIXI = PIXI;
    container.classList.add('be-stage-host');
    container.innerHTML = '';

    const app = new PIXI.Application();
    await app.init({
      background: 0x232630,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: container,
    });
    if (this._disposed) { app.destroy(true); return; }
    app.canvas.className = 'be-stage-canvas';
    container.appendChild(app.canvas);
    this.app = app;

    this.worldC = new PIXI.Container();
    app.stage.addChild(this.worldC);
    this.gridG = new PIXI.Graphics();
    this.onionG = new PIXI.Container();
    this.imageG = new PIXI.Container();
    this.boneG = new PIXI.Graphics();
    this.boneG.eventMode = 'none';
    this.worldC.addChild(this.gridG, this.onionG, this.imageG, this.boneG);

    // 指针交互(canvas DOM 层,自行换算坐标)
    const cv = app.canvas;
    cv.addEventListener('pointerdown', (e) => this._onDown(e));
    // 注意:包装函数须独立命名,不可自引用赋值(否则 (e)=>this._onMove(e) 调用自身 → 栈溢出)
    this._onMoveH = (e) => this._onMove(e);
    this._onUpH = (e) => this._onUp(e);
    window.addEventListener('pointermove', this._onMoveH);
    window.addEventListener('pointerup', this._onUpH);
    cv.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // 资源库拖图入舞台
    container.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-bone-img')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    container.addEventListener('drop', (e) => this._onDrop(e));

    this._ro = new ResizeObserver(() => this.render());
    this._ro.observe(container);
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
    clearTimeout(this._regionTimer);
    for (const v of this.imgCache.values()) { try { v.tex.destroy(true); } catch (err) { /* ignore */ } }
    this.imgCache.clear();
    if (this.app) { try { this.app.destroy(true, { children: true }); } catch (err) { /* ignore */ } this.app = null; }
    if (this.container) this.container.innerHTML = '';
  }

  // ---------------- 坐标换算 ----------------

  toWorld(clientX, clientY) {
    const r = this.app.canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    return { x: (sx - this.camera.x) / this.camera.zoom, y: (sy - this.camera.y) / this.camera.zoom };
  }

  applyCamera() {
    this.worldC.position.set(this.camera.x, this.camera.y);
    this.worldC.scale.set(this.camera.zoom);
  }

  zoomAt(clientX, clientY, factor) {
    const r = this.app.canvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
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
    return dirty;
  }

  // ---------------- 渲染 ----------------

  render() {
    if (!this.app || this._disposed) return;
    const ctx = this.ctx;
    const p = ctx.project;
    this._syncTextures();
    this.applyCamera();

    // ---- Spine 导入工程:官方 3.8 运行时渲染(IK/变换约束/网格蒙皮完整求解) ----
    if (p.spine && p.spine.family === '3') {
      // 工程对象被替换(撤销/重做/导入)→ 重建运行时
      if (this._spineProjRef !== p) {
        this._spineRT = null;
        this._spineProjRef = null;
        this._spineMeshes.clear();
        this._spineFailed = false;
      }
      // 失败后永久降级(自绘近似),避免「失败→重试→再失败」微任务风暴饿死主线程
      if (!this._spineRT && !this._spineIniting && !this._spineFailed) this._initSpineRT(p);
      if (this._spineRT && this._spineProjRef === p) {
        this.gridG.clear();
        if (ctx.showGrid) this._drawGrid();
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
        if (ctx.showBones) this._drawBones();
        return;
      }
    }
    if (p.spine) { this._spineRT = null; this._spineProjRef = null; this._spineMeshes.clear(); }

    const pose = (ctx.mode === 'anim' && ctx.anim) ? sampleAnimation(ctx.anim, ctx.frame) : null;
    this._pose = pose;
    this.worlds = computeWorldTransforms(p, pose);

    this._boneHits = [];
    this.hitImages = [];

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

    this._renderSlots(pose, this.imageG, 0xffffff, 1, false);
    if (ctx.showBones) this._drawBones();
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
      const data = new spine.SkeletonJson(loader).readSkeletonData(p.spine.raw);
      const skeleton = new spine.Skeleton(data);
      const skin = data.findSkin(p.spine.skin) || data.defaultSkin;
      this._spineRT = { spine, data, skeleton, skin };
      this._spineProjRef = p;
      this._spineIniting = false;
      this._spineMeshes.clear();
      // 首帧渲染试跑:解析成功但渲染期出错(如附件结构异常)也走降级,不抛回 init 循环
      try {
        this.render();
      } catch (renderErr) {
        this._spineRT = null;
        this._spineProjRef = null;
        this._spineMeshes.clear();
        this._spineFailed = true;
        console.warn('[boneEditor] Spine 运行时渲染失败,降级为近似渲染:', renderErr);
        this.render();
      }
    })().catch((err) => {
      this._spineIniting = false;
      // 运行时解析失败 → 一次性降级(自绘近似),绝不自动重试
      this._spineFailed = true;
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

    // 0) 插槽附件与颜色先行设置(deform 时间线按 slot 当前附件匹配;attachment 切换由编辑器采样决定)
    const drawList = skeleton.drawOrder;
    for (const rtSlot of skeleton.slots) {
      const es = p.armature.slots.find((s) => s.name === rtSlot.data.name);
      if (!es) { rtSlot.setAttachment(null); continue; }
      const ov = pose && pose.slots[es.name];
      let di = es.displayIndex;
      if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = es.displays[di];
      const att = disp ? skin.getAttachment(rtSlot.data.index, disp.name) : null;
      rtSlot.setAttachment(att);
      const col = ov && ov.r !== undefined ? ov : es.color;
      if (rtSlot.r !== col.r / 255 || rtSlot.g !== col.g / 255 || rtSlot.b !== col.b / 255 || rtSlot.a !== (ov && ov.a !== undefined ? ov.a : es.color.a ?? 1)) {
        rtSlot.r = col.r / 255; rtSlot.g = col.g / 255; rtSlot.b = col.b / 255;
        rtSlot.a = Math.max(0, Math.min(1, ov && ov.a !== undefined ? ov.a : es.color.a ?? 1));
      }
    }

    // 1) 编辑器姿态 → 运行时骨骼
    for (const rb of skeleton.bones) {
      const mb = p.armature.bones.find((b) => b.name === rb.name);
      if (!mb) continue;
      const ov = pose && pose.bones[rb.name];
      rb.x = ov && ov.x !== undefined ? ov.x : mb.x;
      rb.y = ov && ov.y !== undefined ? ov.y : mb.y;
      rb.rotation = ov && ov.rotation !== undefined ? ov.rotation : mb.rotation;
      rb.scaleX = ov && ov.scaleX !== undefined ? ov.scaleX : mb.scaleX;
      rb.scaleY = ov && ov.scaleY !== undefined ? ov.scaleY : mb.scaleY;
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
    this.worlds = new Map();
    this._boneHits = [];
    for (const rb of skeleton.bones) {
      this.worlds.set(rb.name, {
        tx: rb.worldX, ty: -rb.worldY,
        a: rb.worldA, b: -rb.worldB, c: -rb.worldC, d: rb.worldD,
        bone: p.armature.bones.find((b) => b.name === rb.name),
      });
    }
    if (!ghost) this.hitImages = [];

    // 3) 插槽附件渲染(按 skeleton.drawOrder —— 受 drawOrder 时间线重排)
    const drawn = [];
    for (const rtSlot of skeleton.drawOrder) {
      const es = p.armature.slots.find((s) => s.name === rtSlot.data.name);
      if (!es || (es.visible === false && !ghost)) continue;
      const ov = pose && pose.slots[es.name];
      let di = es.displayIndex;
      if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = es.displays[di];
      const att = rtSlot.getAttachment();
      if (!disp || !att) continue;
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
    const slots = slotsInZOrder(p);
    for (const slot of slots) {
      if (slot.visible === false && !ghost) continue;
      const ov = pose && pose.slots[slot.name];
      let di = slot.displayIndex;
      if (ov && ov.displayIndex !== undefined) di = ov.displayIndex;
      const disp = slot.displays[di];
      if (!disp) continue;
      const cache = this.imgCache.get(disp.imageId);
      if (!cache) continue;
      const world = this.worlds.get(slot.parent);
      if (!world) continue;

      // 显示矩阵 = boneWorld × T(dx,dy)·R(drot)·S
      const t = disp.transform;
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
      g.moveTo(gx0, 0).lineTo(gx1, 0);
      g.moveTo(0, gy0).lineTo(0, gy1);
      g.stroke({ width: lw, color: 0x5a5f6e, alpha: 0.9 }); // 坐标轴
      for (let x = gx0; x <= gx1; x += step) g.moveTo(x, gy0).lineTo(x, gy1);
      for (let y = gy0; y <= gy1; y += step) g.moveTo(gx0, y).lineTo(gx1, y);
      g.stroke({ width: lw, color: 0x363a46, alpha: 0.55 });
    }
  }

  _drawBones() {
    const ctx = this.ctx;
    const g = this.boneG;
    const z = this.camera.zoom;
    const px = (n) => n / z; // 屏幕像素 → 世界单位
    const bones = ctx.project.armature.bones;
    for (const bone of bones) {
      const w = this.worlds.get(bone.name);
      if (!w) continue;
      const tip = boneTipWorld(w, bone);
      this._boneHits.push({ name: bone.name, origin: { x: w.tx, y: w.ty }, tip });
      const sel = ctx.selection && ctx.selection.type === 'bone' && ctx.selection.name === bone.name;
      const hov = this._hover === bone.name;
      const color = sel ? COLOR_SEL : hov ? 0x7fb0ff : COLOR_BONE;
      g.moveTo(w.tx, w.ty).lineTo(tip.x, tip.y);
      g.stroke({ width: Math.max(px(2), 2 / z), color, alpha: sel ? 1 : 0.9 });
      // 关节圆
      g.circle(w.tx, w.ty, Math.max(px(5), 4 / z)).fill({ color: sel ? COLOR_SEL : 0x232630 }).stroke({ width: Math.max(px(1.5), 1.5 / z), color });
    }
    // 选中骨骼:尖端旋转手柄 + 延长虚线
    if (ctx.selection && ctx.selection.type === 'bone') {
      const bone = bones.find((b) => b.name === ctx.selection.name);
      const w = bone && this.worlds.get(bone.name);
      if (bone && w) {
        const tip = boneTipWorld(w, bone);
        g.moveTo(w.tx, w.ty).lineTo(w.tx + w.a * (bone.length + px(26)), w.ty + w.b * (bone.length + px(26)));
        g.stroke({ width: 1.5 / z, color: COLOR_SEL, alpha: 0.45 });
        g.circle(tip.x, tip.y, Math.max(px(7), 6 / z)).fill({ color: COLOR_HANDLE, alpha: 0.95 }).stroke({ width: 1.5 / z, color: 0xffffff, alpha: 0.9 });
      }
    }
  }

  // ---------------- 命中检测 ----------------

  _hitHandle(wx, wy) {
    // 选中骨骼的旋转手柄
    const ctx = this.ctx;
    if (!ctx.selection || ctx.selection.type !== 'bone') return null;
    const bone = ctx.project.armature.bones.find((b) => b.name === ctx.selection.name);
    const w = bone && this.worlds.get(bone.name);
    if (bone && w) {
      const tip = boneTipWorld(w, bone);
      const r = 10 / this.camera.zoom;
      if (Math.hypot(wx - tip.x, wy - tip.y) <= r) return { kind: 'rotate', bone };
    }
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

  // ---------------- 指针事件 ----------------

  _onDown(e) {
    if (!this.app) return;
    this.app.canvas.setPointerCapture?.(e.pointerId);
    const ctx = this.ctx;
    const wp = this.toWorld(e.clientX, e.clientY);
    // 中键 / 右键 / 空格:平移
    if (e.button === 1 || e.button === 2 || ctx.spaceHeld) {
      this._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y };
      return;
    }
    if (e.button !== 0) return;

    if (ctx.tool === 'bone') {
      // 父级 = 选中骨骼;未选中则挂到根级(parent='')
      this._drag = { kind: 'boneCreate', p0: wp, p1: wp, parentName: (ctx.selection && ctx.selection.type === 'bone' ? ctx.selection.name : '') };
      return;
    }

    // 选择工具:手柄 → 关节 → 骨线 → 图片
    const handle = this._hitHandle(wp.x, wp.y);
    if (handle) { this._beginEdit('旋转骨骼'); this._drag = { kind: 'rotate', bone: handle.bone }; return; }
    const joint = this._hitJoint(wp.x, wp.y);
    if (joint) {
      ctx.select('bone', joint);
      this._beginEdit('移动骨骼');
      this._drag = { kind: 'move', bone: ctx.project.armature.bones.find((b) => b.name === joint) };
      return;
    }
    const line = this._hitBoneLine(wp.x, wp.y);
    if (line) { ctx.select('bone', line); return; }
    const img = this._hitImage(wp.x, wp.y);
    if (img) { ctx.select('slot', img); return; }
    ctx.select(null, null);
  }

  _beginEdit(label) { this._editLabel = label; this.ctx.beginEdit(label); }

  _onMove(e) {
    if (!this.app) return;
    const ctx = this.ctx;
    const wp = this.toWorld(e.clientX, e.clientY);
    // 状态栏坐标回显
    const info = this.container.querySelector?.('.be-stage-info');
    if (info) {
      const t = this._hoverBoneAt(wp);
      info.textContent = `x ${wp.x.toFixed(0)}  y ${wp.y.toFixed(0)}  ${Math.round(this.camera.zoom * 100)}%` + (t ? `  · 骨骼 ${t}` : '');
    }
    const d = this._drag;
    if (!d) {
      if (ctx.tool === 'select' && ctx.showBones) {
        const hov = this._hitJoint(wp.x, wp.y) || this._hitBoneLine(wp.x, wp.y);
        if (hov !== this._hover) { this._hover = hov; this.render(); }
        this.app.canvas.style.cursor = hov ? 'pointer' : this._hitHandle(wp.x, wp.y) ? 'grab' : 'default';
      }
      return;
    }
    if (d.kind === 'pan') {
      this.camera.x = d.cx + (e.clientX - d.sx);
      this.camera.y = d.cy + (e.clientY - d.sy);
      this.render();
      return;
    }
    if (d.kind === 'move' && d.bone) {
      const parentW = d.bone.parent ? this.worlds.get(d.bone.parent) : null;
      let local = worldToParentLocal(parentW, wp.x, wp.y);
      // spine 模式:世界矩阵按 pixi y 翻转存储,真实局部 y 需取反
      if (this.ctx.project.spine) local = { x: local.x, y: -local.y };
      ctx.editBone(d.bone.name, { x: Math.round(local.x * 10) / 10, y: Math.round(local.y * 10) / 10 });
      return;
    }
    if (d.kind === 'rotate' && d.bone) {
      const bone = d.bone;
      const w = this.worlds.get(bone.name);
      if (!w) return;
      const phiC = (Math.atan2(wp.y - w.ty, wp.x - w.tx) * 180) / Math.PI; // 光标角(pixi 顺时针)
      const parentW = bone.parent ? this.worlds.get(bone.parent) : null;
      const phiP = parentW ? (Math.atan2(parentW.b, parentW.a) * 180) / Math.PI : 0;
      let local;
      if (this.ctx.project.spine) {
        // spine 逆时针为正且 y 上翻:局部 = φ父 - φ光标(不继承旋转时 = -φ光标)
        local = bone.inheritRotation === false ? -phiC : phiP - phiC;
      } else {
        local = bone.inheritRotation === false ? phiC : phiC - phiP;
      }
      ctx.editBone(bone.name, { rotation: Math.round(local * 10) / 10 });
      return;
    }
    if (d.kind === 'boneCreate') {
      d.p1 = wp;
      this._drawCreatePreview(d);
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

  _onUp(e) {
    const d = this._drag;
    this._drag = null;
    if (!d || !this.app) return;
    if (d.kind === 'boneCreate') {
      const wp = this.toWorld(e.clientX, e.clientY);
      const dist = Math.hypot(wp.x - d.p0.x, wp.y - d.p0.y);
      if (dist < 4 / this.camera.zoom) return; // 误触
      const pw = d.parentName ? this.worlds.get(d.parentName) : null;
      const local = worldToParentLocal(pw, d.p0.x, d.p0.y);
      const worldAng = (Math.atan2(wp.y - d.p0.y, wp.x - d.p0.x) * 180) / Math.PI;
      const parentAng = pw ? (Math.atan2(pw.b, pw.a) * 180) / Math.PI : 0;
      const rot = worldAng - parentAng;
      this.ctx.createBone(d.parentName || '', Math.round(local.x), Math.round(local.y), Math.round(rot * 10) / 10, Math.round(dist));
      return;
    }
    if ((d.kind === 'move' || d.kind === 'rotate') && this._editLabel) {
      this._editLabel = null;
      this.ctx.refresh(); // 提交后全量刷新(时间轴上出现关键帧)
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomAt(e.clientX, e.clientY, f);
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
