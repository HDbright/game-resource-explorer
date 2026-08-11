import { probeSkeleton } from './skelProbe.js';
import { pixiRef } from '../pixiLazy.js';

/** 运行时获取 PIXI(由 createPlayer 先 await getPixi 确保 window.PIXI 就绪) */
const P = () => pixiRef();

/**
 * 规范化动画约束时间线(ik / transform / path)的非标准结构。
 * 部分「二进制 .bin → JSON」转换工具会把约束块写成数组形式
 * [ { 约束名: 帧对象|帧数组 }, ... ] 或对象值非数组(单帧对象)。
 * Spine 运行时期望 { 约束名: [帧, ...] },否则空时间线 → duration NaN。
 * @param {object} obj 解析后的骨架 JSON
 */
function normalizeAnimConstraints(obj) {
  const anims = obj && obj.animations;
  if (!anims) return;
  const list = Array.isArray(anims) ? anims : Object.values(anims);
  const normalize = (block) => {
    if (!block) return;
    if (Array.isArray(block)) {
      const merged = {};
      for (const item of block) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        for (const name of Object.keys(item)) {
          let frames = item[name];
          if (frames === null || frames === undefined) continue;
          if (!Array.isArray(frames)) frames = [frames];
          merged[name] = (merged[name] || []).concat(frames);
        }
      }
      return merged;
    }
    if (typeof block === 'object') {
      for (const name of Object.keys(block)) {
        const v = block[name];
        if (v && typeof v === 'object' && !Array.isArray(v)) block[name] = [v];
      }
      return block;
    }
    return block;
  };
  for (const anim of list) {
    if (!anim || typeof anim !== 'object') continue;
    for (const cat of ['ik', 'transform', 'path']) {
      if (anim[cat]) anim[cat] = normalize(anim[cat]);
    }
  }
}

/**
 * 归一化 draworder(绘制顺序)时间线里的 offset 为有符号 32 位整数。
 *
 * 部分「二进制 .skel → JSON」转换工具(以及个别游戏原始 JSON)会把
 * draworder 的 offset 以「无符号 32 位」形式写出:例如真正的 -22 被写成
 * 4294967274(0xFFFFFFEA)。Spine 运行时按 originalIndex + offset 计算目标槽位,
 * 4294967274 远超槽位数 → 该条目被丢弃 → skeleton.drawOrder 混入 undefined →
 * 播放器遍历 drawOrder 时 slot.bone 抛 "Cannot read properties of undefined (reading 'bone')"。
 * 这里在解析前统一 |0 转回有符号 int32(合法的小偏移不受影响),从根上修复。
 * @param {object} obj 解析后的骨架 JSON
 */
function normalizeDrawOrderOffsets(obj) {
  const anims = obj && obj.animations;
  if (!anims) return;
  const list = Array.isArray(anims) ? anims : Object.values(anims);
  for (const anim of list) {
    if (!anim || typeof anim !== 'object') continue;
    const don = anim.drawOrder || anim.draworder;
    if (!Array.isArray(don)) continue;
    for (const frame of don) {
      if (!frame || !Array.isArray(frame.offsets)) continue;
      for (const o of frame.offsets) {
        if (o && typeof o.offset === 'number') o.offset = o.offset | 0; // 转有符号 int32
      }
    }
  }
}

let spine38BundlePromise = null;

/**
 * 加载 Spine 3.8 官方 JS 运行时(spine-ts 3.8 分支构建,IIFE 挂到 window.spine)。
 * 与 4.x 的 @esotericsoftware/spine-core(ESM 私有)不冲突。
 */
export function loadSpine38Bundle() {
  if (window.__spine38) return Promise.resolve(window.__spine38);
  if (spine38BundlePromise) return spine38BundlePromise;
  spine38BundlePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/spine38/spine-core.js';
    s.onload = () => {
      if (window.spine) {
        window.__spine38 = window.spine;
        resolve(window.spine);
      } else {
        reject(new Error('Spine 3.8 运行时未正常挂载'));
      }
    };
    s.onerror = () => reject(new Error('Spine 3.8 运行时加载失败'));
    document.head.appendChild(s);
  });
  return spine38BundlePromise;
}

/**
 * 解析 atlas 文本,提取页面(图片)文件名。
 * 3.x atlas 结构:页名行(图片文件)→ 无缩进的 size/format/filter/repeat 属性 → 空行 →
 * 区域名行(无缩进) + 缩进属性。因此页名以图片扩展名结尾来识别。
 */
function extractAtlasPageNames(atlasText) {
  const names = [];
  for (const line of atlasText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^[ \t]/.test(line)) continue; // 区域属性(缩进)
    if (/^(size|format|filter|repeat|wrap)\s*:/i.test(t)) continue; // 页面属性
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(t)) names.push(t); // 页面名(图片文件)
  }
  return names;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('贴图加载失败: ' + url));
    img.src = url;
  });
}

// pixi v8 的混合模式为字符串字面量;3.8 的 BlendMode: 0 normal / 1 additive / 2 multiply / 3 screen
const BLEND_MAP = ['normal', 'add', 'multiply', 'screen'];

/**
 * Spine 3.x(3.4~3.8)二进制 skel 播放器。
 *
 * 思路与 spineviewer-love 一致:用对应版本的运行时解析数据,
 * 自行提取每帧的世界坐标顶点,交给 pixi v8 的 Mesh 渲染。
 * 接口与 SpinePlayer(4.x)对齐,可被 PreviewController 无缝使用。
 */
export class Spine38Player {
  constructor(app) {
    this.app = app;
    this.root = new (P().Container)();
    this.spine = null;
    this.skeleton = null;
    this.state = null;
    this.data = null;
    this.actions = [];
    this._actionName = null;
    this._slotRecords = new Map(); // slot → record
    this._textureByImage = new Map(); // HTMLImageElement → PIXI.Texture
    this._loadedImages = [];
    this._boneGraphics = null;
    this._showBones = false;
    this._hiddenSlots = new Set();
    this._disposed = false;
  }

  async load({ skeletonUrl, atlasUrl }) {
    this.dispose();

    const spine = await loadSpine38Bundle();
    this.spine = spine;

    // 1. 读取骨架并探测版本(确认是 3.x)
    const skelRes = await fetch(skeletonUrl);
    if (!skelRes.ok) throw new Error(`骨架文件加载失败 (${skelRes.status})`);
    const skelBuf = new Uint8Array(await skelRes.arrayBuffer());
    const probe = probeSkeleton(skelBuf);
    if (!probe || !/^3\./.test(probe.version)) {
      throw new Error('该文件不是 Spine 3.x 资源(探测结果: ' + (probe ? probe.kind + '@' + probe.version : '未知') + ')');
    }

    // 2. 加载 atlas 文本
    const atlasRes = await fetch(atlasUrl);
    if (!atlasRes.ok) throw new Error(`贴图集文件加载失败 (${atlasRes.status})`);
    const atlasText = await atlasRes.text();

    // 3. 先加载所有图集图片(3.8 的 MeshAttachment.updateUVs 需要真实图片宽高)
    const pageNames = extractAtlasPageNames(atlasText);
    if (pageNames.length === 0) throw new Error('atlas 中未找到贴图页面');
    const images = new Map();
    await Promise.all(
      pageNames.map(async (name) => {
        const img = await loadImage(new URL(name, atlasUrl).href);
        images.set(name, img);
        this._loadedImages.push(img);
      })
    );

    // 4. 构造 TextureAtlas(3.8 的 textureLoader 契约:getImage/setFilters/setWraps)
    const atlas = new spine.TextureAtlas(atlasText, (path) => {
      const img = images.get(path) || null;
      return {
        getImage: () => img,
        setFilters: () => {},
        setWraps: () => {},
      };
    });

    // 5. 解析骨架数据(3.x JSON 用 SkeletonJson;3.x 二进制用 SkeletonBinary)
    const loader = new spine.AtlasAttachmentLoader(atlas);
    let data;
    try {
      if (probe.kind === 'json') {
        const jsonParser = new spine.SkeletonJson(loader);
        let jsonObj = JSON.parse(new TextDecoder('utf-8').decode(skelBuf));
        // 3.x 风格兼容:skins 与 animations 都是对象 {key: data},但 spine-core SkeletonJson
        // 期望 skins 是数组 [{name, attachments}]、animations 是数组 [{name, ...}]。
        // 4.x SpinePlayer 已有此兼容分支;3.8 runtime 这里补齐(否则整个 skin 读不到,所有 attachment 为 null)。
        if (jsonObj && jsonObj.skins && !Array.isArray(jsonObj.skins)) {
          const skins = [];
          for (const skinName of Object.keys(jsonObj.skins)) {
            skins.push({ name: skinName, attachments: jsonObj.skins[skinName] });
          }
          jsonObj.skins = skins;
        }
        // 约束时间线容错:部分「二进制 .bin → JSON」转换工具会把 ik/transform/path 写成
        // 数组形式 [ {约束名: 帧对象|帧数组} ] 或「单帧对象」;运行时按对象 {约束名: [帧...]}
        // 遍历会得到 length=undefined → 空时间线 → duration=NaN 抛
        // "Error while parsing animation, duration is NaN"。这里解析前规范化。
        normalizeAnimConstraints(jsonObj);
        // draworder 偏移归为有符号 int32(修复无符号写法导致的 undefined 槽位)
        normalizeDrawOrderOffsets(jsonObj);
        data = jsonParser.readSkeletonData(jsonObj);
      } else {
        const binary = new spine.SkeletonBinary(loader);
        binary.scale = 1;
        data = binary.readSkeletonData(skelBuf);
      }
    } catch (err) {
      throw new Error('Spine 3.8 运行时解析失败: ' + err.message);
    }
    this.data = data;
    // 3.x 旧风格 JSON 可能没有 skeleton.spine 版本字段,补一个 fallback 显示
    if (this.data && (!this.data.version || this.data.version === '')) {
      this.data.version = probe.version || '';
    }

    // 6. 创建骨架 + 动画状态(手动驱动,不用内部时钟)
    const skeleton = new spine.Skeleton(data);
    const state = new spine.AnimationState(new spine.AnimationStateData(data));
    skeleton.setToSetupPose();
    this.skeleton = skeleton;
    this.state = state;

    // 7. 动作列表
    this.actions = (data.animations || []).map((a) => ({ name: a.name, duration: a.duration || 0 }));

    // 8. 默认动作:选择"内容最丰富"的动画作为默认。
    //    启发式:遍历每个动画,采样多个时刻评估(可见 attachment slot 数 × 可见顶点面积),
    //    取全局峰值最大的动画。对 300708 这种 setup pose 缺少主体、动画 3 才有完整人物的资源有效。
    if (this.actions.length) {
      const best = this._pickBestActionName();
      this.setAction(best, 'loop');
    } else {
      this._refreshMeshes();
    }
    return this;
  }

  /**
   * 评估每个动画在多个时刻下的"可见 attachment slot 数 × 总可见顶点面积",取峰值最大的。
   * 综合反映了"画面中可见内容的丰富度",比单纯 bounds 面积更稳定(避免单个远离主体的大顶点拉偏)。
   */
  _pickBestActionName() {
    const sk = this.skeleton;
    const st = this.state;
    const spine = this.spine;
    if (!sk || !st || this.actions.length <= 1) return this.actions[0] && this.actions[0].name;

    const sampleTs = (dur) => [0, dur * 0.25, dur * 0.5, dur * 0.75, dur - 0.001].map((t) => Math.max(0, t));

    const evalAt = (t) => {
      let slots = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const slot of sk.drawOrder) {
        if (!slot || (slot.bone && !slot.bone.active)) continue;
        const att = slot.getAttachment();
        if (!att) continue;
        const sc = slot.bone.skeleton.color, slc = slot.color, ac = att.color;
        if (sc.a * slc.a * ac.a < 0.05) continue;
        slots++;
        const accum = (verts, n) => {
          for (let i = 0; i < n; i += 2) {
            const x = verts[i], y = -verts[i + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        };
        if (att instanceof spine.RegionAttachment) {
          const v = new Float32Array(8);
          att.computeWorldVertices(slot.bone, v, 0, 2);
          accum(v, 8);
        } else if (att instanceof spine.MeshAttachment) {
          const v = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
          accum(v, v.length);
        }
      }
      const w = isFinite(minX) ? (maxX - minX) : 0;
      const h = isFinite(minY) ? (maxY - minY) : 0;
      return { slots, area: w * h };
    };

    let bestName = this.actions[0].name;
    let bestScore = -1;
    for (const a of this.actions) {
      st.setAnimation(0, a.name, true);
      let peak = 0;
      const ts = sampleTs(a.duration || 1);
      let last = 0;
      for (const t of ts) {
        st.update(Math.max(0, t - last)); // update 是增量时间
        last = t;
        st.apply(sk);
        sk.updateWorldTransform();
        const r = evalAt(t);
        const score = r.slots * 10 + r.area / 1000;
        if (score > peak) peak = score;
      }
      if (peak > bestScore) { bestScore = peak; bestName = a.name; }
    }
    return bestName;
  }

  /**
   * 评估每个动画在第 0 帧时的世界坐标包围盒面积,选最大作为"主展示动作"。
   * 多个动画时(如 idle/attack/dead),避免默认播放内容残缺的动作。
   */
  _pickBestActionName() {
    const sk = this.skeleton;
    const st = this.state;
    const spine = this.spine;
    if (!sk || !st || this.actions.length <= 1) return this.actions[0] && this.actions[0].name;

    let bestName = this.actions[0].name;
    let bestArea = 0;
    for (const a of this.actions) {
      st.setAnimation(0, a.name, false);
      st.apply(sk);
      sk.updateWorldTransform();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let valid = false;
      for (const slot of sk.drawOrder) {
        if (!slot || (slot.bone && !slot.bone.active)) continue;
        const att = slot.getAttachment();
        if (att instanceof spine.RegionAttachment) {
          const v = new Float32Array(8);
          att.computeWorldVertices(slot.bone, v, 0, 2);
          for (let i = 0; i < 8; i += 2) {
            const x = v[i], y = -v[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            valid = true;
          }
        } else if (att instanceof spine.MeshAttachment) {
          const v = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
          for (let i = 0; i < v.length; i += 2) {
            const x = v[i], y = -v[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            valid = true;
          }
        }
      }
      if (valid) {
        const area = (maxX - minX) * (maxY - minY);
        if (area > bestArea) { bestArea = area; bestName = a.name; }
      }
    }
    return bestName;
  }

  getDisplay() {
    return this.root;
  }

  get fps() {
    return this.data ? this.data.fps || 30 : 30;
  }

  // ---------------- 播放控制 ----------------

  setAction(name, mode) {
    if (!this.skeleton) return;
    this._actionName = name;
    const loop = mode === 'loop';
    this.skeleton.setToSetupPose();
    this.state.setAnimation(0, name, loop);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this._refreshMeshes();
  }

  /** 播放推进(倍速由 state.timeScale 控制) */
  update(dt) {
    if (!this.skeleton) return;
    this.state.update(dt);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this._refreshMeshes();
    if (this._showBones) this._refreshBones();
  }

  /** 单帧模式:定位到指定时间并应用姿态 */
  stepTo(t) {
    if (!this.skeleton) return;
    const track = this.state.tracks[0];
    if (!track || !track.animation) return;
    const dur = Math.max(0, track.animation.duration - 0.001);
    track.trackTime = Math.min(Math.max(t, 0), dur);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this._refreshMeshes();
  }

  get currentTime() {
    const track = this.state ? this.state.tracks[0] : null;
    return track ? track.trackTime : 0;
  }

  get duration() {
    const track = this.state ? this.state.tracks[0] : null;
    return track && track.animation ? track.animation.duration : 0;
  }

  setTimeScale(s) {
    if (this.state) this.state.timeScale = s;
  }

  setShowBones(show) {
    this._showBones = show;
    if (this._boneGraphics) this._boneGraphics.visible = show;
    if (show && this.skeleton) this._refreshBones();
  }

  // ---------------- 渲染 ----------------

  _getPixiTexture(image) {
    let tex = this._textureByImage.get(image);
    if (!tex) {
      tex = P().Texture.from(image);
      tex.source.alphaMode = 'no-premultiply-alpha';
      this._textureByImage.set(image, tex);
    }
    return tex;
  }

  _createMeshRecord(slot, att) {
    const spine = this.spine;
    let isRegion = false;
    let numVertices;
    let uvs;
    let indices;

    if (att instanceof spine.RegionAttachment) {
      isRegion = true;
      numVertices = 4;
      uvs = att.uvs;
      indices = [0, 1, 2, 2, 3, 0];
    } else if (att instanceof spine.MeshAttachment) {
      numVertices = att.worldVerticesLength / 2;
      uvs = att.uvs;
      // 统一转为 Uint16Array(3.8 的 triangles 是普通 Array,pixi 的 indexBuffer 需要 TypedArray 才能可靠上传 GPU)
      const tris = att.triangles;
      indices = (tris instanceof Uint16Array || tris instanceof Uint32Array)
        ? tris
        : Uint16Array.from(tris);
    } else {
      return null;
    }

    // 找到纹理图片(linked mesh 时 region.renderObject 指向真实 region)
    let texRegion = att.region;
    if (texRegion && texRegion.renderObject && texRegion.renderObject.texture) {
      texRegion = texRegion.renderObject;
    }
    if (!texRegion || !texRegion.texture) return null;
    const image = texRegion.texture.getImage ? texRegion.texture.getImage() : null;
    if (!image) return null;
    const texture = this._getPixiTexture(image);

    const positions = new Float32Array(numVertices * 2);
    const geometry = new (P().MeshGeometry)({ positions, uvs, indices });
    const mesh = new (P().Mesh)({ geometry, texture });
    mesh.blendMode = BLEND_MAP[slot.data.blendMode] || 'normal';

    return { slot, att, isRegion, numVertices, geometry, mesh };
  }

  _updateRecord(rec) {
    const { slot, att, isRegion, geometry, mesh } = rec;
    if (slot.bone && !slot.bone.active) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const positions = geometry.positions;
    if (isRegion) {
      att.computeWorldVertices(slot.bone, positions, 0, 2);
    } else {
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, positions, 0, 2);
    }
    // Spine y-up → pixi y-down
    for (let i = 1; i < positions.length; i += 2) positions[i] = -positions[i];
    geometry.attributes.aPosition.buffer.update();

    // 颜色 = skeleton.color * slot.color * attachment.color
    const sk = slot.bone.skeleton.color;
    const sl = slot.color;
    const ac = att.color;
    const r = Math.min(1, sk.r * sl.r * ac.r);
    const g = Math.min(1, sk.g * sl.g * ac.g);
    const b = Math.min(1, sk.b * sl.b * ac.b);
    const a = Math.min(1, sk.a * sl.a * ac.a);
    mesh.tint = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    mesh.alpha = a;
  }

  _refreshMeshes() {
    if (!this.skeleton) return;
    const alive = new Set();

    for (const slot of this.skeleton.drawOrder) {
      if (!slot || (slot.bone && !slot.bone.active)) continue;

      // 插槽隐藏:跳过渲染并销毁已有 mesh
      if (this._hiddenSlots.has(slot.data.name)) {
        const hidRec = this._slotRecords.get(slot);
        if (hidRec) {
          try {
            hidRec.mesh.destroy({ children: true });
          } catch (err) {
            /* ignore */
          }
          this._slotRecords.delete(slot);
        }
        continue;
      }

      const att = slot.getAttachment();
      let rec = this._slotRecords.get(slot);

      // attachment 发生变化时重建 mesh
      if (rec && rec.att !== att) {
        try {
          rec.mesh.destroy({ children: true });
        } catch (err) {
          /* ignore */
        }
        this._slotRecords.delete(slot);
        rec = null;
      }

      if (!att) continue;
      const renderable = att instanceof this.spine.RegionAttachment || att instanceof this.spine.MeshAttachment;
      if (renderable) {
        if (!rec) {
          rec = this._createMeshRecord(slot, att);
          if (rec) {
            this.root.addChild(rec.mesh);
            this._slotRecords.set(slot, rec);
          }
        }
        if (rec) {
          alive.add(slot);
          this._updateRecord(rec);
        }
      } else if (rec) {
        rec.mesh.visible = false;
        alive.add(slot);
      }
    }

    // 清理已失效的 slot
    for (const [slot, rec] of [...this._slotRecords]) {
      if (!alive.has(slot)) {
        try {
          rec.mesh.destroy({ children: true });
        } catch (err) {
          /* ignore */
        }
        this._slotRecords.delete(slot);
      }
    }
  }

  _refreshBones() {
    const g = this._boneGraphics;
    if (!g) return;
    g.clear();
    const sk = this.skeleton;
    g.lineStyle(1, 0x00ff00, 0.9);
    for (const bone of sk.bones) {
      if (!bone.parent || !bone.parent.active) continue;
      g.moveTo(bone.parent.worldX, -bone.parent.worldY);
      g.lineTo(bone.worldX, -bone.worldY);
    }
    g.lineStyle(0);
    g.beginFill(0xff4040, 0.9);
    for (const bone of sk.bones) {
      if (!bone.active) continue;
      g.drawCircle(bone.worldX, -bone.worldY, 2);
    }
    g.endFill();
  }

  // ---------------- 视图 ----------------

  /**
   * 骨架包围盒(居中 / fit 用)。
   * 先算当前帧;若当前帧无可见 attachment(动画后期才出现内容的资源,如 1000101),
   * 或为了覆盖动画全程摆动范围,统一改为:采样当前动画整个时长,返回联合包围盒,
   * 保证 100% 居中 / fit 时内容(含后续帧)不会落在视口外。最后恢复当前姿态。
   */
  getSkeletonBounds() {
    if (!this.skeleton) return null;
    const spine = this.spine;

    const accumBounds = (sk) => {
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
      for (const slot of sk.drawOrder) {
        if (!slot || (slot.bone && !slot.bone.active)) continue;
        const att = slot.getAttachment();
        if (att instanceof spine.RegionAttachment) {
          const v = new Float32Array(8);
          att.computeWorldVertices(slot.bone, v, 0, 2);
          accum(v, 8);
        } else if (att instanceof spine.MeshAttachment) {
          const v = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
          accum(v, v.length);
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

    // 采样当前动画(含当前帧 + 全程均匀采样),取联合包围盒
    const track = this.state && this.state.tracks[0];
    if (track && track.animation) {
      const anim = track.animation;
      const dur = Math.max(0, anim.duration - 0.001);
      const origT = track.trackTime;
      let union = accumBounds(this.skeleton);
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        track.trackTime = (dur * i) / steps;
        this.state.apply(this.skeleton);
        this.skeleton.updateWorldTransform();
        union = unionWith(union, accumBounds(this.skeleton));
      }
      // 恢复当前姿态
      track.trackTime = origT;
      this.state.apply(this.skeleton);
      this.skeleton.updateWorldTransform();
      return union;
    }

    // 无动画状态 → 仅当前帧
    return accumBounds(this.skeleton);
  }

  // ---------------- 插槽 / 版本 ----------------

  getSlots() {
    if (!this.skeleton) return [];
    return this.skeleton.slots.map((s) => ({
      name: s.data.name,
      visible: !this._hiddenSlots.has(s.data.name),
    }));
  }

  setSlotVisible(name, visible) {
    if (!this.skeleton) return;
    if (visible) this._hiddenSlots.delete(name);
    else this._hiddenSlots.add(name);
    this._refreshMeshes();
  }

  getVersion() {
    return this.data ? this.data.version || '' : '';
  }

  // ---------------- 生命周期 ----------------

  dispose() {
    if (this._disposed) {
      // 仍然重置 root,保证重复 load 可用
      this.root.removeChildren();
      return;
    }
    for (const rec of this._slotRecords.values()) {
      try {
        rec.mesh.destroy({ children: true });
      } catch (err) {
        /* ignore */
      }
    }
    this._slotRecords.clear();
    if (this._boneGraphics) {
      try {
        this._boneGraphics.destroy({ children: true });
      } catch (err) {
        /* ignore */
      }
      this._boneGraphics = null;
    }
    try {
      this.root.destroy({ children: true });
    } catch (err) {
      /* ignore */
    }
    for (const tex of this._textureByImage.values()) {
      try {
        tex.destroy(true);
      } catch (err) {
        /* ignore */
      }
    }
    this._textureByImage.clear();
    this._loadedImages = [];
    this.root = new (P().Container)();
    this.spine = null;
    this.skeleton = null;
    this.state = null;
    this.data = null;
    this.actions = [];
    this._actionName = null;
    this._disposed = true;
  }
}
