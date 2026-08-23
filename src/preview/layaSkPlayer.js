import { getPixi } from '../pixiLazy.js';

/**
 * LayaAir .sk 官方引擎渲染方案:
 * 加载项目内置的官方 Laya 引擎模块(public/vendor/laya/),用官方 Templet 解析 .sk、
 * 官方 Skeleton/AnimationPlayer 驱动动画,再把引擎每帧计算出的骨骼世界矩阵与
 * 槽位 display 数据提取成 pixi 网格渲染 —— 解析与动画语义 100% 与线上一致,
 * 渲染层仍走本应用的 pixi 画布(缩放/平移/截图/插槽等功能不受影响)。
 *
 * 引擎细节:
 * - Templet 按 _skBufferUrl 是否含 "newspine"/"unlimit" 决定槽位/动画节点计数宽度,故传入真实资源路径;
 * - Laya.init 在 document.body 挂一个隐藏画布供引擎跑自己的 rAF 时钟(不参与显示);
 * - 顶点提取(见 _refreshMeshes)与官方 BoneSlot.draw / skinMesh 算法一一对应,
 *   坐标为 y 向下,输出到 pixi 时统一取 -y 与其它播放器对齐。
 */

let layaRuntimePromise = null;

/** 加载官方引擎脚本并初始化(幂等) */
function loadLayaRuntime() {
  if (window.Laya && window.Laya.Templet) return Promise.resolve(window.Laya);
  if (layaRuntimePromise) return layaRuntimePromise;
  layaRuntimePromise = new Promise((resolve, reject) => {
    const load = (src) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error('引擎脚本加载失败: ' + src));
      document.head.appendChild(s);
    });
    (async () => {
      await load('/vendor/laya/laya.core.js');
      await load('/vendor/laya/laya.ani.js');
      const Laya = window.Laya;
      if (!Laya || !Laya.Templet) throw new Error('Laya 引擎未正确挂载');
      if (!Laya.stage) {
        Laya.init(4, 4);
        // 隐藏引擎自建画布:只借用其时钟与解析,不参与显示
        const c = Laya.stage.canvas && Laya.stage.canvas.source || Laya.stage.canvas;
        if (c && c.style) {
          c.style.position = 'fixed';
          c.style.left = '-9999px';
          c.style.top = '-9999px';
          c.style.width = '1px';
          c.style.height = '1px';
          c.style.opacity = '0';
        }
      }
      resolve(Laya);
    })().catch(reject);
  });
  return layaRuntimePromise;
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图集图片加载失败: ' + url));
    img.src = url;
  });
}

export class LayaSkPlayer {
  constructor(app) {
    this.app = app;
    this.root = new (getPixiSync()).Container();
    this.Laya = null;
    this.templet = null;
    this.skeleton = null;
    this.actions = [];
    this._actionName = null;
    this._meshes = new Map(); // slot对象 → {mesh, geometry, numVertices}
    this._texture = null; // pixi 整页贴图
    this._pageImage = null;
    this._disposed = false;
    this._hiddenSlots = new Set();
    this._lastDisplayKey = '';
  }

  async load({ skUrl, pngUrl, urlKey }) {
    this.dispose();
    const PIXI = await getPixi();
    this._PIXI = PIXI;
    const Laya = await loadLayaRuntime();
    this.Laya = Laya;

    // 1. 读取 .sk 二进制
    const buf = new Uint8Array(await (await fetch(skUrl)).arrayBuffer());

    // 2. 贴图:先经 Laya Loader(得到带引用计数的 Texture,官方 Templet 依赖),
    //    同时用同一图片建 pixi 贴图(uv 直接采用 display 的页归一化坐标)
    await new Promise((resolve, reject) => {
      Laya.loader.load(pngUrl, Laya.Handler.create(null, resolve), null, Laya.Loader.IMAGE);
      setTimeout(() => reject(new Error('Laya 贴图加载超时')), 15000);
    }).catch(() => { /* 超时兜底:下方 getRes 校验 */ });
    const layaTex = Laya.loader.getRes(pngUrl);
    if (!layaTex) throw new Error('Laya 引擎贴图加载失败: ' + pngUrl);
    this._pageImage = await loadImageEl(pngUrl);

    // 3. 官方 Templet 解析(_skBufferUrl 传真实路径:官方按是否含 newspine/unlimit 决定计数宽度)
    const templet = new Laya.Templet();
    templet._skBufferUrl = urlKey || skUrl;
    await new Promise((resolve, reject) => {
      templet.on(Laya.Event.COMPLETE, null, resolve);
      templet.on(Laya.Event.ERROR, null, (e) => reject(new Error('官方引擎解析失败: ' + e)));
      try {
        templet.parseData(layaTex, buf);
      } catch (err) {
        reject(err);
      }
      setTimeout(() => reject(new Error('官方引擎解析超时')), 10000);
    });
    this.templet = templet;

    // 4. 官方 Skeleton 驱动。
    //    aniMode=2(实时模式):aniMode=1 会按(动画,帧号)缓存图形,首轮播完后帧号重复、
    //    缓存命中导致 _createGraphics(骨骼更新)被跳过 → 画面冻在末帧而时间继续循环;
    //    aniMode=2 每帧实时重建,循环播放才能持续刷新姿态。
    //    另外:不挂 Laya.stage —— 引擎舞台时钟会自行驱动动画,导致应用的暂停/倍速控制失效,
    //    改由本播放器 update() 手动驱动。
    const skeleton = templet.buildArmature(2);
    this.skeleton = skeleton;
    this._hookSlotDrawAlpha(skeleton);

    // pixi 整页贴图(保持 pixi 默认的“上传时预乘 alpha”:
    // pixi v8 的 normal 混合按预乘管线设计,禁用预乘会让半透明交叉淡化出现明暗偏差/闪烁)
    const tex = PIXI.Texture.from(this._pageImage);
    this._texture = tex;

    // 5. 动作列表(默认动作放最前:优先时长最长的非空动画 —— gezi 等资源的前几个动作时长为 0,
    //    直接取 actions[0] 会呈现静止画面)
    const acts = [];
    for (let i = 0; i < templet.getAnimationCount(); i++) {
      const a = templet.getAnimation(i);
      acts.push({ name: a.name, duration: (templet.getAniDuration(i) || 0) / 1000 });
    }
    if (!acts.length) throw new Error('该骨骼没有可播放的动作');
    const best = acts.reduce((m, a) => (a.duration > m.duration ? a : m), acts[0]);
    if (best !== acts[0] && best.duration > 0) {
      acts.splice(acts.indexOf(best), 1);
      acts.unshift(best);
    }
    this.actions = acts;

    this.setAction(this.actions[0].name, 'loop');
    return this;
  }

  getDisplay() {
    return this.root;
  }

  get fps() {
    return this.templet ? this.templet.rate || 30 : 30;
  }

  // ---------------- 播放控制 ----------------

  setAction(name, mode) {
    if (!this.skeleton) return;
    this._actionName = name;
    const idx = this.actions.findIndex((a) => a.name === name);
    if (idx < 0) return;
    // 必须按「名字」播放:官方 play(string) 自己查 templet 索引;
    // this.actions 可能被重排过(默认动作前置),按下标播会播错动画
    this.skeleton.play(name, mode === 'loop');
    // 官方 play() 会注册 timer.frameLoop 由引擎时钟驱动动画,
    // 注销之,改由本播放器 update() 手动驱动 —— 应用的暂停/倍速/单帧控制才能生效
    this._detachEngineTimer();
    // 同步内部时间基准(否则首次 _update 会把累积的引擎时钟当帧间隔,动画直接跳到末尾)
    this.skeleton._update(false);
    if (mode !== 'loop') this.stepTo(0);
    this._refreshMeshes();
  }

  _detachEngineTimer() {
    try {
      this.Laya.timer.clear(this.skeleton, this.skeleton._update);
    } catch (err) { /* ignore */ }
  }

  update(dt) {
    if (!this.skeleton) return;
    // 用控制器给定的 dt 确定性推进(引擎默认按真实时钟差推进,暂停恢复时会跳帧):
    // player._update(ms) 前进动画时间;skeleton._update(false) 只按当前时间重建骨骼/槽位
    try {
      this.skeleton.player._update(Math.max(0, (dt || 0)) * 1000);
      this.skeleton._update(false);
    } catch (err) { /* 引擎偶发事件回调异常不中断渲染 */ }
    this._applySmoothDeform();
    this._refreshMeshes();
  }

  stepTo(t) {
    if (!this.skeleton) return;
    const p = this.skeleton.player;
    // 单次模式播完后引擎进入 stopped(clipIndex=-1),currentTime 设置会被忽略;
    // 先以循环方式重新 play,再定位时间
    if (p._currentAnimationClipIndex < 0 && this._actionName) {
      // 按名字重播(actions 可能重排过,不能按下标)
      this.skeleton.play(this._actionName, true);
      this._detachEngineTimer();
    }
    p.currentTime = Math.max(0, Math.min(this.duration, t)) * 1000;
    // _update(false):只按 player 当前时间重建图形,不推进时间
    try {
      this.skeleton._update(false);
    } catch (err) { /* ignore */ }
    this._applySmoothDeform();
    this._refreshMeshes();
  }

  /**
   * 挂钩官方 BoneSlot.draw 记录槽位 alpha。
   * 官方按槽位时间线(alpha 通道)调用 draw(t,i,a,r),r=alpha;alpha=0 的槽位在引擎中
   * 完全透明(常见于成对的“过渡副本”槽位,如 hedao 的 Hd_13/Hd_12 显示同图但 alpha 为 0)。
   * 我们的提取渲染必须遵守该 alpha,否则会把引擎隐藏的副本全量叠画,画面交错错乱。
   */
  _hookSlotDrawAlpha(skeleton) {
    for (const slot of skeleton._boneSlotArray || []) {
      const orig = slot.draw.bind(slot);
      slot.draw = (...args) => {
        const a = args.length >= 4 ? args[3] : undefined;
        slot.__drawAlpha = (typeof a === 'number' && isFinite(a)) ? a : 1;
        return orig(...args);
      };
    }
  }

  /**
   * 用真实播放时间(currentPlayTime)重新应用 deform 时间线。
   * 引擎内部把 deform 求值时间量化到缓存帧格(clipIndex×33.3ms),陡峭的关键帧段
   * (如 hedao 在 966.7→1000ms 间的形变)会被压成单帧大跳变;apply(t) 本身支持
   * 关键帧间连续插值,按真实时间求值后该段成为连续扫动,消除 0.99~1.03s 的跳跃感。
   */
  _applySmoothDeform() {
    const sk = this.skeleton, templet = this.templet;
    if (!sk || !templet) return;
    const R = templet.deformAniArr && templet.deformAniArr[sk._aniClipIndex];
    if (!R) return;
    const d = R.default || R[Object.keys(R)[0]];
    if (!d) return;
    const time = sk._player.currentPlayTime;
    for (const sd of d.deformSlotDataList || []) {
      for (const s of sd.deformSlotDisplayList || []) {
        const slot = sk._boneSlotArray[s.slotIndex];
        if (!slot || !slot.currDisplayData || slot.currDisplayData.attachmentName !== s.attachment) continue;
        try {
          s.apply(time);
          slot.deformData = s.deformData;
        } catch (err) { /* 单个槽位异常不影响整体 */ }
      }
    }
  }

  get currentTime() {
    const p = this.skeleton && this.skeleton.player;
    return p ? (p.currentPlayTime || 0) / 1000 : 0;
  }

  get duration() {
    // 优先按当前动作名取时长:单次模式播完后引擎 stopped(clipIndex=-1),按 clipIndex 取会得到 0
    if (this._actionName) {
      const a = this.actions.find((x) => x.name === this._actionName);
      if (a) return a.duration;
    }
    const idx = this.skeleton ? this.skeleton.player.currentAnimationClipIndex : -1;
    if (idx >= 0 && this.templet) return (this.templet.getAniDuration(idx) || 0) / 1000;
    return 0;
  }

  setTimeScale(s) {
    if (this.skeleton) this.skeleton.playbackRate = s;
  }

  setShowBones(_show) { /* 官方方案暂不绘制骨骼辅助线 */ }

  getSlots() {
    if (!this.skeleton) return [];
    return (this.skeleton._boneSlotArray || []).map((s) => ({
      name: s.name,
      visible: !this._hiddenSlots.has(s.name),
    }));
  }

  setSlotVisible(name, visible) {
    if (!this.skeleton) return;
    const slot = (this.skeleton._boneSlotArray || []).find((s) => s.name === name);
    if (!slot) return;
    if (visible) {
      this._hiddenSlots.delete(name);
      // 恢复显示必须走 showDisplayByName/Index 重新加载 currDisplayData/currTexture;
      // 官方 showSlotData() 只复位数据不加载显示(照抄官方 showSkinByIndex 的恢复序列)
      if (slot.currSlotData) slot.showSlotData(slot.currSlotData);
      if (slot.attachmentName && slot.attachmentName !== 'undefined' && slot.attachmentName !== 'null') {
        slot.showDisplayByName(slot.attachmentName);
      } else {
        slot.showDisplayByIndex(slot.displayIndex);
      }
    } else {
      this._hiddenSlots.add(name);
      slot.showDisplayByIndex(-1);
    }
    this._refreshMeshes();
  }

  getVersion() {
    return this.templet ? ('LayaAir ' + (this.templet._aniVersion || '')) : '';
  }

  // ---------------- 渲染:提取引擎每帧状态 → pixi 网格 ----------------

  _refreshMeshes() {
    const sk = this.skeleton;
    const Laya = this.Laya;
    if (!sk || !Laya) return;
    const alive = new Set();
    const boneMats = sk._boneMatrixArray || [];

    // drawOrder 时间线(如 kuangche:矿车走到终点时排到矿山之后绘制实现遮挡)。
    // 注意不能直接用 sk._drawOrder:引擎只前进不回退,循环播放回到首条目之前时会
    // 滞留上一圈的顺序(官方 aniMode=0 靠图形缓存规避)。这里按当前时间重算生效条目:
    // t 早于首条目 → null(默认槽位顺序),与图形缓存语义一致。
    let drawOrder = sk._drawOrder;
    const doArr = this.templet && this.templet.drawOrderAniArr ? this.templet.drawOrderAniArr[sk._aniClipIndex] : null;
    if (doArr && doArr.length) {
      const tMs = sk._player.currentPlayTime || 0;
      let eff = null;
      for (const e of doArr) {
        if (tMs >= e.time) eff = e.drawOrder;
        else break;
      }
      drawOrder = eff;
    }
    const slotZ = new Map();
    const slotIdx = new Map();
    (sk._boneSlotArray || []).forEach((s, i) => {
      slotIdx.set(s, i);
      // 默认层级 = 槽位序号(显式分配,不依赖 children 插入顺序:
      // 播放中 display 切换会销毁重建网格并追加到末尾,插入顺序会偏离槽位顺序)
      slotZ.set(i, i);
    });
    if (drawOrder && drawOrder.length) {
      drawOrder.forEach((si, z) => slotZ.set(si, z));
    }
    // drawOrder 生效时的序列成员(用于“不在序列不绘制”判定)
    const orderSet = (drawOrder && drawOrder.length) ? new Set(drawOrder) : null;
    this.root.sortableChildren = true;

    for (const slot of sk._boneSlotArray || []) {
      const dd = slot.currDisplayData;
      if (!dd || !slot._parentMatrix) continue;
      alive.add(slot);

      // 该槽位被隐藏(displayIndex=-1)时移除已有网格;drawOrder 生效时不在序列内的槽位不绘制(官方语义)
      const rec = this._meshes.get(slot);
      if (slot.displayIndex < 0 || this._hiddenSlots.has(slot.name)
        || (drawOrder && drawOrder.length && !orderSet.has(slotIdx.get(slot)))) {
        if (rec) rec.mesh.visible = false;
        continue;
      }

      // 顶点(y 向下,官方语义)与 uv/索引
      let verts = null, uvs = null, indices = null, isRegion = false;
      if (dd.type === 0) {
        isRegion = true;
        const w = dd.width / 2, h = dd.height / 2;
        // 官方 draw:matrix = display.transform.getMatrix() ∘ parentMatrix,绘制居中四边形
        const dm = dd.transform.getMatrix();
        const pm = slot._parentMatrix;
        const m = Laya.Matrix.mul(dm, pm, new Laya.Matrix());
        verts = [
          m.a * -w + m.c * -h + m.tx, m.b * -w + m.d * -h + m.ty,
          m.a * w + m.c * -h + m.tx, m.b * w + m.d * -h + m.ty,
          m.a * w + m.c * h + m.tx, m.b * w + m.d * h + m.ty,
          m.a * -w + m.c * h + m.tx, m.b * -w + m.d * h + m.ty,
        ];
        // 官方 createTexture 按 uv 矩形映射(顶部为 uv[1])——四边形顶点按同样顺序对应。
        // 个别资源(dinosaur 196715f4e26 的 eye 槽位)type 0 display 不内嵌 uvs,
        // 官方直接按命名子纹理整图绘制,uv 取自 slot.currTexture
        const uv = (dd.uvs && dd.uvs.length) ? dd.uvs : (slot.currTexture && slot.currTexture.uv);
        if (!uv || uv.length < 8) { if (rec) rec.mesh.visible = false; continue; }
        uvs = [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]];
        indices = [0, 1, 2, 2, 3, 0];
      } else if (dd.bones && dd.bones.length) {
        // 蒙皮网格(官方判定是「有 bones」而非 type==2:type1 带 bones 同样走 skinMesh,如飞艇艇身)。
        // 官方 skinMesh:每组([骨骼数, 骨骼idx...])内累加 Σ w·骨骼矩阵ᵢ·(x,y),整组输出一个顶点;
        // deformData 官方语义是「逐对加到权重坐标上」而非替换。
        const wRaw = dd.weights;
        const def = (slot.deformData && slot.deformData.length) ? slot.deformData : null;
        const bones = dd.bones;
        verts = [];
        let wi = 0, di = 0, bi = 0;
        while (bi < bones.length) {
          const cnt = bones[bi++];
          let px = 0, py = 0;
          for (let k = 0; k < cnt; k++) {
            const bm = boneMats[bones[bi++]];
            let x = wRaw[wi++], y = wRaw[wi++];
            if (def) { x += def[di++]; y += def[di++]; }
            const w = wRaw[wi++];
            px += w * (bm.a * x + bm.c * y + bm.tx);
            py += w * (bm.b * x + bm.d * y + bm.ty);
          }
          verts.push(px, py);
        }
        uvs = dd.uvs;
        indices = dd.triangles;
      } else if (dd.type === 1) {
        // 无骨骼网格:顶点 = weights(官方语义:有 deformData 时整组替换),经 display 矩阵 ∘ 骨骼矩阵
        const dm = dd.transform.getMatrix();
        const pm = slot._parentMatrix;
        const m = Laya.Matrix.mul(dm, pm, new Laya.Matrix());
        const raw = (slot.deformData && slot.deformData.length) ? slot.deformData : dd.weights;
        verts = [];
        for (let i = 0; i + 1 < raw.length; i += 2) {
          verts.push(m.a * raw[i] + m.c * raw[i + 1] + m.tx, m.b * raw[i] + m.d * raw[i + 1] + m.ty);
        }
        uvs = dd.uvs;
        indices = dd.triangles;
      } else {
        if (rec) rec.mesh.visible = false;
        continue;
      }
      if (!verts || !verts.length || !uvs || !indices || !indices.length) continue;

      const nV = verts.length / 2;
      // 显示键变化(切换 display)时重建几何
      const key = slot.name + '#' + (dd.name || '') + '#' + (dd.attachmentName || '') + '#' + nV;
      let entry = this._meshes.get(slot);
      if (entry && entry.key !== key) {
        this._destroyMesh(slot);
        entry = null;
      }
      if (!entry) {
        const positions = new Float32Array(nV * 2);
        const uvArr = new Float32Array(nV * 2);
        const idxArr = indices instanceof Uint16Array ? indices : Uint16Array.from(indices);
        const geometry = new this._PIXI.MeshGeometry({ positions, uvs: uvArr, indices: idxArr });
        const mesh = new this._PIXI.Mesh({ geometry, texture: this._texture });
        // drawOrder 层级(无时间线时全部 0,pixi 稳定排序保持插入顺序)
        mesh.zIndex = slotZ.size ? (slotZ.get(slotIdx.get(slot)) ?? 0) : 0;
        this.root.addChild(mesh);
        entry = { mesh, geometry, key, nV };
        this._meshes.set(slot, entry);
      } else {
        // 每帧同步 zIndex:drawOrder 失效(回退到默认顺序)时也要清回 0
        entry.mesh.zIndex = slotZ.size ? (slotZ.get(slotIdx.get(slot)) ?? 0) : 0;
      }
      // 写入顶点:Laya 世界坐标即 y 向下,与 pixi 屏幕坐标一致,直接使用
      // (此前误按 Spine y-up 约定取了 -y,导致画面整体垂直镜像/倒置)
      const pos = entry.geometry.positions;
      const uvA = entry.geometry.uvs;
      for (let i = 0; i < nV; i++) {
        pos[i * 2] = verts[i * 2];
        pos[i * 2 + 1] = verts[i * 2 + 1];
        uvA[i * 2] = uvs[i * 2];
        uvA[i * 2 + 1] = uvs[i * 2 + 1];
      }
      entry.mesh.visible = true;
      // 槽位透明度(官方时间线 alpha;引擎中 alpha=0 的过渡副本槽位不可见)
      entry.mesh.alpha = slot.__drawAlpha != null ? Math.max(0, Math.min(1, slot.__drawAlpha)) : 1;
      entry.geometry.attributes.aPosition.buffer.update();
      entry.geometry.attributes.aUV.buffer.update();
    }

    // 清理失效槽位
    for (const slot of [...this._meshes.keys()]) {
      if (!alive.has(slot)) this._destroyMesh(slot);
    }

    // 槽位层级校正:mesh 在显示切换(key 变化)时销毁重建,addChild 会追加到子节点末尾,
    // 循环播放后发生过切换的槽位从此浮到最上层,遮挡关系错乱。每帧按引擎槽位顺序
    // (_boneSlotArray,后者绘制在上)检测并重排,保持与官方绘制层级一致。
    if (this.skeleton && this.skeleton._boneSlotArray) {
      const order = new Map();
      const slotsArr = this.skeleton._boneSlotArray;
      for (let i = 0; i < slotsArr.length; i++) order.set(slotsArr[i], i);
      const meshRank = new Map();
      for (const [slot, entry] of this._meshes) meshRank.set(entry.mesh, order.has(slot) ? order.get(slot) : 1e9);
      const rank = (node) => (meshRank.has(node) ? meshRank.get(node) : 1e9);
      const ch = this.root.children;
      let inOrder = true;
      for (let i = 1; i < ch.length; i++) {
        if (rank(ch[i - 1]) > rank(ch[i])) { inOrder = false; break; }
      }
      if (!inOrder) {
        const sorted = ch.slice().sort((a, b) => rank(a) - rank(b));
        for (const c of sorted) this.root.addChild(c);
      }
    }
    this._lastBounds = this._calcBounds();
  }

  _destroyMesh(slot) {
    const entry = this._meshes.get(slot);
    if (entry) {
      try { entry.mesh.destroy({ children: true }); } catch (err) { /* ignore */ }
      this._meshes.delete(slot);
    }
  }

  _calcBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entry of this._meshes.values()) {
      if (!entry.mesh.visible || (entry.mesh.alpha || 1) < 0.01) continue;
      const pos = entry.geometry.positions;
      for (let i = 0; i < pos.length; i += 2) {
        if (pos[i] < minX) minX = pos[i];
        if (pos[i] > maxX) maxX = pos[i];
        if (pos[i + 1] < minY) minY = pos[i + 1];
        if (pos[i + 1] > maxY) maxY = pos[i + 1];
      }
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getSkeletonBounds() {
    // 与 Spine38Player 一致:采样当前动画整个时长的联合包围盒。
    // 叙事类动画(如 Diyimu,57s)各时刻场景范围差异巨大,若只按当前帧 fit,
    // seek/播放到其它时刻后视图会明显过小或过大(加载时 t=0 帧范围巨大 → 全程被缩成一小块)。
    const sk = this.skeleton;
    if (!sk || !sk._player) return this._calcBounds();
    const pp = sk._player;
    const dur = this.duration || 0;
    if (dur <= 0 || !this.actions.length) return this._calcBounds();
    const origT = pp.currentPlayTime;
    const steps = 12;
    let union = null;
    for (let i = 0; i <= steps; i++) {
      pp.currentTime = (dur * i) / steps * 1000;
      try { sk._update(false); } catch (err) { /* ignore */ }
      this._applySmoothDeform();
      this._refreshMeshes();
      const b = this._calcBounds();
      if (b) {
        if (!union) union = { ...b };
        else {
          const nx = Math.min(union.x, b.x), ny = Math.min(union.y, b.y);
          const mx = Math.max(union.x + union.width, b.x + b.width);
          const my = Math.max(union.y + union.height, b.y + b.height);
          union = { x: nx, y: ny, width: mx - nx, height: my - ny };
        }
      }
    }
    // 恢复当前时刻姿态
    pp.currentTime = origT;
    try { sk._update(false); } catch (err) { /* ignore */ }
    this._applySmoothDeform();
    this._refreshMeshes();
    this._lastBounds = union || this._calcBounds();
    return this._lastBounds;
  }

  dispose() {
    const Laya = this.Laya;
    if (this.skeleton) {
      try { this.skeleton.destroy && this.skeleton.destroy(); } catch (err) { /* ignore */ }
    }
    if (this.templet) {
      try { this.templet.destroy(); } catch (err) { /* ignore */ }
    }
    for (const slot of [...this._meshes.keys()]) this._destroyMesh(slot);
    if (this._texture) {
      try { this._texture.destroy(true); } catch (err) { /* ignore */ }
    }
    this._meshes.clear();
    this.root && this.root.removeChildren();
    this.skeleton = null;
    this.templet = null;
    this.actions = [];
    this._texture = null;
    this._pageImage = null;
    this._lastBounds = null;
    this._disposed = true;
  }
}

// 构造时同步取 PIXI(PreviewController 创建播放器前必已 getPixi(),window.PIXI 已就绪)
function getPixiSync() {
  if (!window.PIXI) throw new Error('pixi.js 尚未初始化');
  return window.PIXI;
}
