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
 * 3.x 兼容:把 4.x 风格的加权网格附件归一化为 3.8 可读格式。
 *
 * 旧版「skel→json」转换器(≤v1.9.64)对 3.x 加权网格会写出 4.x 形态:
 *   type:"weightedmesh" + 独立 bones/weights/vertices 三数组(vertices 为纯位置)。
 * 而 3.8 的 SkeletonJson.readAttachment 不识别 weightedmesh/skinnedmesh 类型 → 返回 null →
 * 附件被跳过 → 皮肤缺附件 → deform 时间线抛 "Deform attachment not found: undefined"。
 * 这里统一改为:type='mesh',vertices 内联 [boneCount, boneIdx, x, y, w, ...](3.8 readVertices 格式)。
 * 同时兼容旧转换器的混合形态(vertices 已是 [x,y,w,...]、weights 为空)。
 * @param {object} obj 解析后的骨架 JSON
 */
function normalizeWeightedMeshTypes(obj) {
  const skins = obj && obj.skins;
  if (!skins) return;
  const list = Array.isArray(skins) ? skins : Object.values(skins);
  for (const skin of list) {
    if (!skin || typeof skin !== 'object') continue;
    const atts = (skin.attachments && typeof skin.attachments === 'object') ? skin.attachments : skin;
    for (const slotName of Object.keys(atts)) {
      const slotAtts = atts[slotName];
      if (!slotAtts || typeof slotAtts !== 'object') continue;
      for (const attName of Object.keys(slotAtts)) {
        const m = slotAtts[attName];
        if (!m || typeof m !== 'object' || typeof m.type !== 'string') continue;
        if (m.type !== 'weightedmesh' && m.type !== 'skinnedmesh') continue;
        const bones = Array.isArray(m.bones) ? m.bones : [];
        if (!bones.length) {
          // 新版 .sk 转换器的 skinnedmesh:顶点已是 3.8 内联元组 [骨骼数,骨骼idx,x,y,w,...],
          // 无独立 bones/weights —— 仅改类型即可(此前按旧格式合并会把顶点清空 → 部件丢失)。
          m.type = 'mesh';
          delete m.weights;
          continue;
        }
        m.type = 'mesh';
        const pos = Array.isArray(m.vertices) ? m.vertices : [];
        const ws = Array.isArray(m.weights) && m.weights.length ? m.weights : null;
        const merged = [];
        let pi = 0;
        let wi = 0;
        for (let i = 0; i < bones.length; ) {
          const bc = bones[i++];
          merged.push(bc);
          for (let j = 0; j < bc && i < bones.length; j++) {
            merged.push(bones[i++]); // 骨骼索引
            merged.push(pos[pi++]); // x
            merged.push(pos[pi++]); // y
            merged.push(ws != null ? ws[wi++] : pos[pi++]); // w
          }
        }
        m.vertices = merged;
        delete m.bones;
        delete m.weights;
      }
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

/**
 * 官方 3.8 运行时对版本串 "3.8.75"(编辑器 3.8.7 beta 导出)直接抛
 * "Unsupported skeleton data, please export with a newer version of Spine."。
 * 该版本的数据格式与 3.8 final 兼容(仅版本串触发守卫,实测 goblins-pro 3.8.75 全量解析正常),
 * 这里把二进制内的版本串原地改写为等长的 "3.8.99" 绕过守卫。
 * @param {Uint8Array} skelBuf 二进制骨架(原地修改)
 * @returns {string|null} 命中并改写时返回原始版本串 "3.8.75",未命中返回 null
 */
function patchRejectedVersionBinary(skelBuf) {
  const readVarint = (pos) => {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (pos >= skelBuf.length) return null;
      const b = skelBuf[pos++];
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return { value, nextPos: pos };
    }
    return null;
  };
  // 3.x 二进制布局:varint串(hash) + varint串(version)
  const hash = readVarint(0);
  if (!hash || hash.value <= 0) return null;
  const ver = readVarint(hash.nextPos + hash.value - 1);
  if (!ver || ver.value !== 7) return null; // "3.8.75" 6 字节 -> varint 编码长度 7
  const start = ver.nextPos;
  let s = '';
  for (let i = 0; i < 6; i++) s += String.fromCharCode(skelBuf[start + i]);
  if (s !== '3.8.75') return null;
  const repl = '3.8.99';
  for (let i = 0; i < 6; i++) skelBuf[start + i] = repl.charCodeAt(i);
  return s;
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

  async load({ skeletonUrl, atlasUrl, imageDir, pageBase }) {
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

    // 2. 加载 atlas 文本(若无 atlas 文件则从 images/ 目录合成)
    let atlasText;
    let atlasImages; // Map<pageName, HTMLImageElement>
    if (atlasUrl) {
      const atlasRes = await fetch(atlasUrl);
      if (!atlasRes.ok) throw new Error(`贴图集文件加载失败 (${atlasRes.status})`);
      atlasText = await atlasRes.text();

      // 3. 先加载所有图集图片(3.8 的 MeshAttachment.updateUVs 需要真实图片宽高)
      //    pageBase:图集页面图片的解析基址(atlasUrl 为 blob/data URL 时无法直接 new URL(name, atlasUrl),
      //    需传入真实图片目录,如 /a/<itemId>/;缺省回退 atlasUrl)
      const pageNames = extractAtlasPageNames(atlasText);
      if (pageNames.length === 0) throw new Error('atlas 中未找到贴图页面');
      const pageResolveBase = pageBase || atlasUrl;
      atlasImages = new Map();
      await Promise.all(
        pageNames.map(async (name) => {
          const img = await loadImage(new URL(name, pageResolveBase).href);
          atlasImages.set(name, img);
          this._loadedImages.push(img);
        })
      );
    } else if (imageDir) {
      // 无 atlas 文件:从 images/ 目录加载解包图片,合成 atlas
      const result = await this._loadFromImageDir(imageDir, skelBuf, probe, skeletonUrl);
      atlasText = result.atlasText;
      atlasImages = result.images;
    } else {
      throw new Error('缺少 .atlas 图集文件');
    }

    // 4. 构造 TextureAtlas(3.8 的 textureLoader 契约:getImage/setFilters/setWraps)
    const atlas = new spine.TextureAtlas(atlasText, (path) => {
      const img = atlasImages.get(path) || null;
      return {
        getImage: () => img,
        setFilters: () => {},
        setWraps: () => {},
      };
    });

    // 5. 解析骨架数据(3.x JSON 用 SkeletonJson;3.x 二进制用 SkeletonBinary)
    const loader = new spine.AtlasAttachmentLoader(atlas);
    let data;
    let patchedOrigVersion = null; // 版本守卫被改写时的原始版本串(解析后恢复显示)
    try {
      if (probe.kind === 'json') {
        const jsonParser = new spine.SkeletonJson(loader);
        let jsonObj = JSON.parse(new TextDecoder('utf-8').decode(skelBuf));
        // 官方 3.8 运行时对 "3.8.75"(3.8.7 beta 编辑器导出)直接抛
        // "Unsupported skeleton data..."。该版本数据格式与 3.8 final 兼容,
        // 改写版本串绕过守卫,解析成功后恢复真实版本用于显示。
        if (jsonObj && jsonObj.skeleton && jsonObj.skeleton.spine === '3.8.75') {
          patchedOrigVersion = jsonObj.skeleton.spine;
          jsonObj.skeleton.spine = '3.8.99';
        }
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
        // 3.x 兼容:4.x 风格的 weightedmesh/skinnedmesh → 3.8 的 mesh + 内联顶点
        // (旧版转换器输出的加权网格若不归一化,3.8 readAttachment 不识别该类型 →
        // 附件丢失 → deform 报 "Deform attachment not found")。
        normalizeWeightedMeshTypes(jsonObj);
        // 约束时间线容错:部分「二进制 .bin → JSON」转换工具会把 ik/transform/path 写成
        // 数组形式 [ {约束名: 帧对象|帧数组} ] 或「单帧对象」;运行时按对象 {约束名: [帧...]}
        // 遍历会得到 length=undefined → 空时间线 → duration=NaN 抛
        // "Error while parsing animation, duration is NaN"。这里解析前规范化。
        normalizeAnimConstraints(jsonObj);
        // draworder 偏移归为有符号 int32(修复无符号写法导致的 undefined 槽位)
        normalizeDrawOrderOffsets(jsonObj);
        data = jsonParser.readSkeletonData(jsonObj);
      } else {
        patchedOrigVersion = patchRejectedVersionBinary(skelBuf);
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
    // 恢复被改写前的真实版本串(守卫仅影响解析,data.version 只用于显示)
    if (this.data && patchedOrigVersion) this.data.version = patchedOrigVersion;

    // 6. 创建骨架 + 动画状态(手动驱动,不用内部时钟)
    const skeleton = new spine.Skeleton(data);
    const state = new spine.AnimationState(new spine.AnimationStateData(data));

    // 6.1 自动选择命名皮肤:当 default 皮肤附件数远少于命名皮肤时(如 goblins 的 default 仅有
    //     武器道具,而 goblin/goblingirl 有完整身体部件),自动启用第一个命名皮肤。
    //     getAttachment 会回退到 data.defaultSkin,因此武器道具仍可正常显示。
    //     必须在 setToSetupPose 之前设置皮肤,否则插槽的 setup attachment 会按 default 皮肤解析 → null。
    const countAttachments = (skin) => {
      const atts = skin.attachments;
      if (!atts) return 0;
      let c = 0;
      if (Array.isArray(atts)) {
        // 3.8 runtime: 按槽位索引的稀疏数组,元素是 {attName: attachment};
        // length 只是槽位跨度(不是附件数),必须逐槽累加
        for (const slotAtts of atts) {
          if (slotAtts && typeof slotAtts === 'object') c += Object.keys(slotAtts).length;
        }
      } else if (typeof atts === 'object') {
        // JSON 原始数据: {slotName: {attName: data}}
        for (const slotAtts of Object.values(atts)) {
          if (slotAtts && typeof slotAtts === 'object') c += Object.keys(slotAtts).length;
        }
      }
      return c;
    };
    const allSkins = data.skins || [];
    const defSkin = data.defaultSkin;
    const namedSkins = allSkins.filter((s) => s !== defSkin && s.name !== 'default');
    if (defSkin && namedSkins.length > 0) {
      const defCount = countAttachments(defSkin);
      const bestNamed = namedSkins.reduce((best, s) => countAttachments(s) > countAttachments(best) ? s : best, namedSkins[0]);
      if (defCount < countAttachments(bestNamed) * 0.5) {
        skeleton.skin = bestNamed;
      }
    }

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
    if (!track || !track.animation) return 0;
    // 单次播放结束后 trackTime 仍会推进(动画保持末帧),显示层钳到时长避免时间无限累计
    return Math.min(track.trackTime, track.animation.duration || track.trackTime);
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
      // 保持 pixi 默认的「上传时预乘 alpha」:pixi v8 的 normal 混合按预乘管线设计,
      // 禁用预乘会让半透明(alpha 交叉淡化)合成的 RGB 偏亮/偏暗并随淡入淡出周期
      // 波动 —— 表现为水面等交叉淡化部件「明暗闪烁」(与 layaSkPlayer 的结论一致)。
      this._textureByImage.set(image, tex);
    }
    return tex;
  }

  /**
   * 无 atlas 时从 images/ 目录加载解包图片,合成 atlas 文本。
   * 根据骨架 JSON 中的附件名逐一尝试加载对应图片(支持 png/jpg/webp),
   * 每张图片作为独立 page + region 写入合成 atlas。
   * @returns {{ atlasText: string, images: Map<string, HTMLImageElement> }}
   */
  async _loadFromImageDir(imageDir, skelBuf, probe, skeletonUrl) {
    // 收集骨架中所有附件名(用于匹配图片文件名)
    const attNames = new Set();
    if (probe.kind === 'json') {
      try {
        const jsonObj = JSON.parse(new TextDecoder('utf-8').decode(skelBuf));
        const skins = jsonObj.skins;
        const skinList = Array.isArray(skins) ? skins : (skins ? Object.values(skins) : []);
        for (const skin of skinList) {
          const atts = (skin.attachments && typeof skin.attachments === 'object') ? skin.attachments : skin;
          for (const slotAtts of Object.values(atts)) {
            if (slotAtts && typeof slotAtts === 'object') {
              for (const [name, data] of Object.entries(slotAtts)) {
                // region: 无 type 或 type=region; mesh: type=mesh
                const n = (data && typeof data === 'object' && data.name) ? data.name : name;
                attNames.add(n);
              }
            }
          }
        }
      } catch (_) { /* 解析失败则仅尝试通用名 */ }
    }

    // 也把骨架基名作为可能的图片名(部分资源只有一张大图)
    const skelBase = decodeURIComponent(new URL(skeletonUrl, location.origin).pathname.split('/').pop() || '')
      .replace(/\.[^.]+$/, '');
    attNames.add(skelBase);

    const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
    const images = new Map();
    const loaded = []; // { name, img }

    // 并行尝试加载所有候选图片
    const candidates = [...attNames];
    await Promise.all(candidates.map(async (name) => {
      for (const ext of IMG_EXTS) {
        if (images.has(name)) return; // 已命中
        const url = `${imageDir}/${encodeURIComponent(name + ext)}`;
        try {
          const img = await loadImage(url);
          images.set(name, img);
          this._loadedImages.push(img);
          loaded.push({ name, img, fileName: name + ext });
          return; // 命中,不再尝试其他扩展名
        } catch (_) { /* 404, 继续 */ }
      }
    }));

    if (loaded.length === 0) {
      throw new Error('atlas 文件不存在,且 images/ 目录中未找到匹配的解包图片');
    }

    // 合成 atlas 文本:每个图片同时作为 page 和 region
    const lines = [];
    for (const { name, img, fileName } of loaded) {
      lines.push(fileName);
      lines.push(`size: ${img.naturalWidth},${img.naturalHeight}`);
      lines.push('format: RGBA8888');
      lines.push('filter: Linear,Linear');
      lines.push('repeat: none');
      lines.push(name);
      lines.push(`  rotate: false`);
      lines.push(`  xy: 0, 0`);
      lines.push(`  size: ${img.naturalWidth},${img.naturalHeight}`);
      lines.push(`  orig: ${img.naturalWidth},${img.naturalHeight}`);
      lines.push(`  offset: 0, 0`);
      lines.push(`  index: -1`);
      lines.push('');
    }

    return { atlasText: lines.join('\n'), images };
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

    // drawOrder 层级校正:mesh 仅在首次出现时 addChild,附件切换销毁重建后会被追加到
    // 子节点末尾 —— 循环播放后发生过切换的槽位(如 ZhuangXu_3 在 1.167s 隐藏、回卷恢复)
    // 从此渲染在所有部件之上,遮挡关系错乱;drawOrder 时间线换序同理。每帧检测子节点
    // 顺序,失序时按 drawOrder 重排(稳定排序,未知节点排末尾,骨骼调试线不受影响)。
    const order = new Map();
    const dl = this.skeleton.drawOrder;
    for (let i = 0; i < dl.length; i++) order.set(dl[i], i);
    const meshRank = new Map();
    for (const [slot, rec] of this._slotRecords) meshRank.set(rec.mesh, order.has(slot) ? order.get(slot) : 1e9);
    const rank = (node) => (meshRank.has(node) ? meshRank.get(node) : 1e9);
    const ch = this.root.children;
    let inOrder = true;
    for (let i = 1; i < ch.length; i++) {
      if (rank(ch[i - 1]) > rank(ch[i])) { inOrder = false; break; }
    }
    if (!inOrder) {
      const sorted = ch.slice().sort((a, b) => rank(a) - rank(b));
      for (const c of sorted) this.root.addChild(c); // addChild 既有子节点 = 移到末尾,按序重加完成重排
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

  /**
   * 插槽详情(预览插槽面板用):附带当前附件名与可否预览图片。
   * 比 getSlots 多出 attachment / hasImage 字段。
   */
  getSlotDetails() {
    if (!this.skeleton) return [];
    return this.skeleton.slots.map((s) => {
      const att = s.getAttachment();
      const renderable = !!(att && (att instanceof this.spine.RegionAttachment || att instanceof this.spine.MeshAttachment));
      return {
        name: s.data.name,
        visible: !this._hiddenSlots.has(s.data.name),
        attachment: renderable ? (att.name || s.data.name) : null,
        hasImage: renderable && !!(att.region && att.region.texture),
      };
    });
  }

  /**
   * 取插槽当前附件的独立 PNG dataUrl(悬浮预览 / 右键另存)。
   * 从图集页面按 region 裁剪,处理 90° 旋转与 trim 偏移还原
   * (裁剪算法与编辑器 spineIO.cropRegionToDataUrl 同源)。
   * @returns {{ dataUrl: string, name: string, width: number, height: number } | null}
   */
  getAttachmentImage(slotName) {
    if (!this.skeleton) return null;
    const slot = this.skeleton.findSlot(slotName);
    if (!slot) return null;
    const att = slot.getAttachment();
    if (!att) return null;
    let texRegion = att.region;
    if (texRegion && texRegion.renderObject && texRegion.renderObject.texture) texRegion = texRegion.renderObject;
    if (!texRegion || !texRegion.texture) return null;
    const image = texRegion.texture.getImage ? texRegion.texture.getImage() : null;
    if (!image) return null;

    const w = texRegion.width, h = texRegion.height;
    const W = texRegion.originalWidth || w, H = texRegion.originalHeight || h;
    const ox = texRegion.offsetX || 0, oy = texRegion.offsetY || 0;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, W); cv.height = Math.max(1, H);
    const g = cv.getContext('2d');
    g.save();
    if (texRegion.rotate) {
      // 3.8 运行时实测:旋转块 (bx,by) → 原图 (W-by, bx) ⇒ translate(W,0) + rotate(+90°)
      g.translate(ox + W, oy);
      g.rotate(Math.PI / 2);
      g.drawImage(image, texRegion.x, texRegion.y, h, w, 0, 0, h, w);
    } else {
      // offsetY 为 y 上语义:内容底边距原图底边 oy → 画布顶部 = H - oy - h
      g.drawImage(image, texRegion.x, texRegion.y, w, h, ox, H - oy - h, w, h);
    }
    g.restore();
    return { dataUrl: cv.toDataURL('image/png'), name: att.name || slotName, width: W, height: H };
  }

  // ---------------- 皮肤 ----------------

  getSkins() {
    if (!this.data) return [];
    const cur = this.skeleton && this.skeleton.skin ? this.skeleton.skin.name : null;
    return (this.data.skins || []).map((s) => ({ name: s.name, active: s.name === cur }));
  }

  /**
   * 切换皮肤(如 goblins 的 goblin / goblingirl)。
   * 官方推荐流程:setSkinByName + setSlotsToSetupPose;
   * getAttachment 回退 data.defaultSkin,因此 default 皮肤里的道具(武器等)不受影响。
   */
  setSkin(name) {
    if (!this.skeleton || !this.data) return;
    try {
      this.skeleton.setSkinByName(name);
      this.skeleton.setSlotsToSetupPose();
      // 重新应用当前动画姿态(换肤立即生效,不闪回 setup 姿势)
      this.state.apply(this.skeleton);
      this.skeleton.updateWorldTransform();
      this._refreshMeshes();
    } catch (err) {
      /* 皮肤名不存在等:忽略,保持原皮肤 */
    }
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
