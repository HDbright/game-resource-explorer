/**
 * FGUI 布局交互预览控制器
 * - 独立 PixiJS 8 应用(不复用全局动画预览)
 * - 按 FGUI RenderNode 树渲染: Image/Loader 贴图集裁切, Text/RichText 用 DOM overlay
 * - 交互: 滚轮缩放 / 拖拽平移 / 点选高亮+属性面板 / 控制器(controller)页切换
 */
import * as PIXI from 'pixi.js';

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/** '#rrggbbaa' → CSS 颜色 */
function cssColor(c) {
  if (!c || typeof c !== 'string') return null;
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})?$/.exec(c);
  if (!m) return c;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  if (m[4]) {
    const a = (parseInt(m[4], 16) / 255).toFixed(3);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgb(${r},${g},${b})`;
}

const FONT_FAMILY = `system-ui, "Microsoft YaHei", "PingFang SC", sans-serif`;

/** 用 data URL 加载完整解码后的 PIXI.Texture(PixiJS v8 中 Texture.from(url) 异步加载,此处显式等待) */
async function loadTextureFromDataUrl(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) return resolve();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片解码失败'));
  });
  const tex = PIXI.Texture.from(img);
  if (tex && tex.source && tex.source.alphaMode !== undefined) {
    tex.source.alphaMode = 'premultiplied-alpha';
  }
  return tex;
}

export class FguiLayoutPreview {
  constructor() {
    this.app = null;
    this.viewC = null;        // 缩放/平移容器
    this.highlight = null;    // 选中高亮 Graphics
    this.rootEl = null;       // 画布容器
    this.canvas = null;
    this.textLayer = null;
    this.propPanel = null;
    this.ctrlBar = null;      // 控制器按钮区
    this.payload = null;      // buildPreviewData 结果
    this.comp = null;         // 当前组件
    this.nodeMap = [];        // [{node, obj, outer}] 命中测试表
    this.selected = null;
    this.activePages = {};    // controllerName -> pageId
    this.textures = {};       // atlasKey -> PIXI.Texture
    this._drag = null;
    this._ro = null;
    this._loadToken = 0;
    this._onSelect = null;    // 选中回调(页面可用来显示)
    this.editMode = false;    // 可视化编辑模式开关
    this._editDrag = null;    // 节点拖拽状态
    this._resizeDrag = null;  // 尺寸调整状态
    this._editHandles = null; // 选中框+缩放手柄 Graphics
    this._origValues = new Map(); // node -> 原始值备份(用于取消/导出差异)
  }

  /**
   * @param {object} refs { root, canvas, textLayer, propPanel, ctrlBar }
   */
  async init(refs) {
    this.rootEl = refs.root;
    this.canvas = refs.canvas;
    this.textLayer = refs.textLayer;
    this.propPanel = refs.propPanel;
    this.ctrlBar = refs.ctrlBar;

    const w = this.rootEl.clientWidth || 800;
    const h = this.rootEl.clientHeight || 600;
    const app = new PIXI.Application();
    await app.init({
      view: this.canvas,
      width: w,
      height: h,
      background: 0x1b1d23,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preserveDrawingBuffer: true,
      preference: 'webgl',
    });
    this.app = app;
    this.viewC = new PIXI.Container();
    app.stage.addChild(this.viewC);
    this.highlight = new PIXI.Graphics();
    this.viewC.addChild(this.highlight);
    this.highlight.visible = false;
    this._editHandles = new PIXI.Graphics();
    this.viewC.addChild(this._editHandles);
    this._editHandles.visible = false;
    this._editHandles.eventMode = 'static';
    // 组件列表定位高亮框(常驻,点击右侧组件列表时画边框,不参与选中)
    this._compHL = new PIXI.Graphics();
    this.viewC.addChild(this._compHL);
    this._compHL.visible = false;
    this._compHL.eventMode = 'none';
    // 撤销栈:{node, before(操作前属性快照), committed(是否已回调历史)}
    this._editStack = [];
    // 编辑提交回调(由页面层设置,用于写磁盘编辑历史)
    this._onEditCommitted = null;
    // 静态 UI: 不常驻帧循环
    app.ticker.stop();

    this._bindEvents();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        const cw = this.rootEl.clientWidth || 800;
        const ch = this.rootEl.clientHeight || 600;
        if (cw > 20 && ch > 20) app.renderer.resize(cw, ch);
        this._syncOverlay();
        this._render();
      });
      this._ro.observe(this.rootEl);
    }
  }

  _bindEvents() {
    const canvas = this.canvas;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.pow(1.12, -e.deltaY / 100);
      const k = clamp(Math.abs(this.viewC.scale.x || 1) * f, 0.05, 8);
      // 以鼠标位置为缩放锚点
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldK = Math.abs(this.viewC.scale.x || 1);
      const wx = (mx - this.viewC.position.x) / oldK;
      const wy = (my - this.viewC.position.y) / oldK;
      this.viewC.scale.set(k);
      this.viewC.position.set(mx - wx * k, my - wy * k);
      this._syncOverlay();
      this._render();
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // 编辑模式优先:缩放手柄 > 节点移动 > 画布平移
      if (this.editMode) {
        const handle = this._hitResizeHandle(mx, my);
        if (handle) {
          this._beginEdit(this.selected);
          this._resizeDrag = {
            handle,
            startX: e.clientX, startY: e.clientY,
            startNode: { ...this._getEditableRect(this.selected) },
          };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        const node = this._pickNode(mx, my);
        if (node && node !== this.comp.root) {
          const entry = this.nodeMap.find((x) => x.node === node);
          this._beginEdit(node);
          this._editDrag = {
            node,
            entry,
            startX: e.clientX, startY: e.clientY,
            origX: node.x, origY: node.y,
          };
          this.selectNode(node, node._textDiv);
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      this._drag = { x: e.clientX, y: e.clientY, tx: this.viewC.position.x, ty: this.viewC.position.y };
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this._resizeDrag) {
        this._updateResize(e.clientX, e.clientY);
        return;
      }
      if (this._editDrag) {
        const dx = (e.clientX - this._editDrag.startX) / (this.viewC.scale.x || 1);
        const dy = (e.clientY - this._editDrag.startY) / (this.viewC.scale.y || 1);
        this._applyNodeXY(this._editDrag.node, this._editDrag.entry,
                          Math.round(this._editDrag.origX + dx),
                          Math.round(this._editDrag.origY + dy));
        this._drawSelection();
        this._syncOverlay();
        this._render();
        this._renderProps(this._editDrag.node);
        return;
      }
      if (!this._drag) return;
      this.viewC.position.set(
        this._drag.tx + (e.clientX - this._drag.x),
        this._drag.ty + (e.clientY - this._drag.y)
      );
      this._syncOverlay();
      this._render();
    });

    const endDrag = () => {
      if (this._editDrag) {
        const node = this._editDrag.node;
        // 拖拽结束:确保有原始值备份
        if (!this._origValues.has(node)) {
          this._origValues.set(node, { x: this._editDrag.origX, y: this._editDrag.origY });
        }
        this._commitEdit(node);
        this._editDrag = null;
      }
      if (this._resizeDrag) {
        this._commitEdit(this.selected);
        this._resizeDrag = null;
      }
      this._drag = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this._pick(mx, my);
    });

    canvas.addEventListener('dblclick', (e) => {
      if (!this.editMode) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = this._pickNode(mx, my);
      if (node && node.kind === 'text') this._startTextEdit(node);
    });
  }

  // ---------- 加载 ----------
  async load(payload, componentId) {
    const token = ++this._loadToken;
    this.payload = payload;
    this.comp = (payload.components || []).find((c) => c.id === componentId)
      || (payload.components || [])[0] || null;
    if (!this.comp) return;

    // 预加载纹理:先读 base64,再等 Image 解码完成,避免 PixiJS v8 子纹理 frame 失效
    const texMap = payload.textures || {};
    this.textures = {};
    this._editStack = []; // 换包/换组件清空撤销栈
    this._origValues = new Map();
    if (this._compHL) { this._compHL.clear(); this._compHL.visible = false; }
    await Promise.all(Object.keys(texMap).map(async (key) => {
      const p = texMap[key];
      if (!p) return;
      try {
        const r = await window.api.readBase64(p);
        if (r && r.ok) {
          const tex = await loadTextureFromDataUrl(r.dataUrl);
          if (tex) this.textures[key] = tex;
        }
      } catch (err) {
        console.warn('[fgui-preview] 纹理加载失败:', key, p, err && err.message);
      }
    }));
    if (token !== this._loadToken) return;

    // 清空旧树
    this._clearTree();

    // 控制器按钮
    this._renderCtrlBar();

    // 递归建树
    this.nodeMap = [];
    const root = this.comp.root;
    const cw = this.rootEl.clientWidth || 800;
    const ch = this.rootEl.clientHeight || 600;
    this._buildNode(root, this.viewC, null, 0, 0);
    // 初始适配
    const bw = root.initWidth || cw;
    const bh = root.initHeight || ch;
    const k = clamp(Math.min(cw / bw, ch / bh, 1.5), 0.05, 2);
    this.viewC.scale.set(k);
    this.viewC.position.set((cw - bw * k) / 2, (ch - bh * k) / 2);
    this._syncOverlay();
    this._applyVisibility();
    this._render();
  }

  _clearTree() {
    while (this.viewC.children.length > 3) { // 保留 highlight + _editHandles + _compHL
      this.viewC.removeChildAt(3);
    }
    this.highlight.visible = false;
    this._editHandles.clear();
    this._editHandles.visible = false;
    if (this._compHL) { this._compHL.clear(); this._compHL.visible = false; }
    if (this.textLayer) this.textLayer.innerHTML = '';
    this.selected = null;
  }

  /** 计算节点尺寸(px): initSize 优先, Image 用 sprite 原始尺寸, 否则 0 */
  _nodeSize(node) {
    let w = node.initWidth != null ? node.initWidth : 0;
    let h = node.initHeight != null ? node.initHeight : 0;
    if ((!w || !h) && node.sprite) {
      if (!w) w = node.sprite.ow != null ? node.sprite.ow : node.sprite.w;
      if (!h) h = node.sprite.oh != null ? node.sprite.oh : node.sprite.h;
    }
    return [w, h];
  }

  // ---------- 组件列表定位高亮 ----------

  /** 高亮指定节点(右侧组件列表点击用): 画黄色外框, 偏移过大时平移画布使其可见。返回世界矩形或 null */
  highlightNode(node) {
    if (!node || !this.nodeMap.some((x) => x.node === node)) return null;
    const entry = this.nodeMap.find((x) => x.node === node);
    const [w, h] = this._nodeSize(node);
    const x = entry.outer.x;
    const y = entry.outer.y;
    this._compHL.clear();
    this._compHL.lineStyle(2, 0xffd60a, 1);
    this._compHL.beginFill(0xffd60a, 0.08);
    this._compHL.drawRect(x - 4, y - 4, w + 8, h + 8);
    this._compHL.endFill();
    this._compHL.visible = true;
    this._ensureVisible(x + w / 2, y + h / 2);
    this._render();
    return { x, y, w, h };
  }

  clearNodeHighlight() {
    if (this._compHL) { this._compHL.clear(); this._compHL.visible = false; }
  }

  /** 更改画布背景色(hex,如 '#1b1d23')并重渲染 */
  setBackground(hex) {
    const color = parseInt(String(hex || '').replace('#', ''), 16);
    if (isNaN(color)) return;
    if (this.app && this.app.renderer) {
      const r = this.app.renderer;
      // Pixi v8: renderer.background 是 BackgroundSystem 实例,须改 .color(直接赋值对象不生效 → 画布仍黑)
      if (r.background && typeof r.background === 'object' && 'color' in r.background) r.background.color = color;
      else r.background = color;
    }
    if (this.rootEl) {
      const css = String(hex).startsWith('#') ? hex : '#' + hex;
      this.rootEl.style.background = css;
      this.rootEl.dataset.bg = css; // 测试钩子
    }
    this._render();
  }

  /** 若目标世界点明显偏离视口, 平移 viewC 使其进入视口 */
  _ensureVisible(cx, cy) {
    const scale = Math.abs(this.viewC.scale.x || 1);
    const appW = this.app.renderer.width || 800;
    const appH = this.app.renderer.height || 600;
    const screenX = this.viewC.position.x + cx * scale;
    const screenY = this.viewC.position.y + cy * scale;
    const offX = appW / 2 - screenX;
    const offY = appH / 2 - screenY;
    if (Math.abs(offX) > appW * 0.3 || Math.abs(offY) > appH * 0.3) {
      this.viewC.position.set(this.viewC.position.x + offX, this.viewC.position.y + offY);
    }
  }

  /**
   * 递归构建显示对象。
   * 坐标: 外层容器定位, 内层偏移 -pivot*size 保证围绕 pivot 缩放旋转。
   * @param {number} wX 世界 x(父链 xy 累加, 供文本 overlay 用)
   */
  _buildNode(node, parentContainer, parentNode, wX, wY) {
    if (!node) return null;
    const [w, h] = this._nodeSize(node);
    const px = node.pivotX != null ? node.pivotX * w : 0;
    const py = node.pivotY != null ? node.pivotY * h : 0;

    // 外层: 定位
    const outer = new PIXI.Container();
    if (node.pivotAsAnchor && (node.pivotX != null)) {
      outer.position.set(node.x, node.y); // xy = 锚点
    } else {
      outer.position.set(node.x + px, node.y + py); // xy = 左上角, 内层偏移到 pivot 中心
    }
    parentContainer.addChild(outer);

    // 内层: 偏移 + 变换
    const inner = new PIXI.Container();
    inner.position.set(-px, -py);
    if (node.scaleX != null) inner.scale.set(node.scaleX, node.scaleY != null ? node.scaleY : node.scaleX);
    if (node.rotation) inner.rotation = node.rotation * Math.PI / 180;
    if (node.alpha != null) inner.alpha = node.alpha;
    outer.addChild(inner);

    // 节点自身的可见性(基础 + gearDisplay 由 _applyVisibility 统一处理)
    outer.visible = node.visible !== false;

    // 子节点世界坐标(忽略 pivot/rotation, 文本第一版用近似)
    const cWX = wX + node.x;
    const cWY = wY + node.y;

    let displayObj = null;
    if (node.kind === 'image' && node.sprite) {
      const tex = node.atlasKey ? this.textures[node.atlasKey] : null;
      if (tex) {
        let spriteTex;
        try {
          if (node.sprite.rotated) {
            spriteTex = new PIXI.Texture({
              source: tex.source,
              frame: new PIXI.Rectangle(node.sprite.x, node.sprite.y, node.sprite.h, node.sprite.w),
            });
          } else {
            spriteTex = new PIXI.Texture({
              source: tex.source,
              frame: new PIXI.Rectangle(node.sprite.x, node.sprite.y, node.sprite.w, node.sprite.h),
            });
          }
          const spr = new PIXI.Sprite(spriteTex);
          if (node.sprite.rotated) {
            spr.rotation = -Math.PI / 2;
            spr.position.set(0, node.sprite.h);
          }
          const sw = node.initWidth != null ? node.initWidth : node.sprite.ow;
          const sh = node.initHeight != null ? node.initHeight : node.sprite.oh;
          spr.width = sw;
          spr.height = sh;
          inner.addChild(spr);
          displayObj = spr;
        } catch (e) { /* 裁切失败降级 */ }
      }
      if (!displayObj) {
        // 缺纹理: 灰色占位框
        const g = new PIXI.Graphics();
        g.rect(0, 0, w || 32, h || 32).fill({ color: 0x333a44, alpha: 0.6 });
        g.rect(0, 0, w || 32, h || 32).stroke({ width: 1, color: 0x556070 });
        inner.addChild(g);
        displayObj = g;
      }
    } else if (node.kind === 'text') {
      // 文本走 DOM overlay
      const div = this._makeTextDiv(node, cWX, cWY, w, h);
      if (div) displayObj = div; // 仅用于命中(div 无 pixi 对象, 命中由 overlay 处理)
      displayObj = null;
    } else if (node.kind === 'container' || node.kind === 'graph' || node.kind === 'unknown') {
      // 容器: 递归
      for (const ch of node.children || []) {
        this._buildNode(ch, inner, node, cWX, cWY);
      }
      // 空容器/占位给个淡边框(便于看清范围)
      if ((!node.children || !node.children.length) && w > 0 && h > 0 && node.kind === 'unknown') {
        const g = new PIXI.Graphics();
        g.rect(0, 0, w, h).stroke({ width: 1, color: 0x445566 });
        inner.addChild(g);
      }
    }

    if (displayObj) {
      this.nodeMap.push({ node, obj: displayObj, outer });
    } else {
      this.nodeMap.push({ node, obj: null, outer });
    }
    return outer;
  }

  _makeTextDiv(node, wX, wY, w, h) {
    if (!this.textLayer) return null;
    const div = document.createElement('div');
    div.className = 'fg-text-node';
    const tf = node.textFormat || {};
    div.style.left = wX + 'px';
    div.style.top = wY + 'px';
    div.style.width = (w || 0) + 'px';
    div.style.height = (h || 0) + 'px';
    if (tf.size != null) div.style.fontSize = tf.size + 'px';
    if (tf.bold) div.style.fontWeight = 'bold';
    if (tf.italic) div.style.fontStyle = 'italic';
    if (tf.underline) div.style.textDecoration = 'underline';
    const col = cssColor(tf.color);
    if (col) div.style.color = col;
    if (tf.align === 'center') div.style.justifyContent = 'center';
    else if (tf.align === 'right') div.style.justifyContent = 'flex-end';
    if (tf.valign === 'middle') div.style.alignItems = 'center';
    else if (tf.valign === 'bottom') div.style.alignItems = 'flex-end';
    if (tf.lineSpacing) div.style.lineHeight = tf.lineSpacing + 'px';
    div.textContent = node.text || '';
    div.style.display = 'flex';
    div.style.fontFamily = FONT_FAMILY;
    div.dataset.nodeKey = this.nodeMap.length; // 占位, 选中时按索引
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node, div);
    });
    this.textLayer.appendChild(div);
    node._textDiv = div;
    return div;
  }

  // ---------- 选中 ----------
  _pick(mx, my) {
    // 逻辑坐标 = CSS 坐标(stage 与 CSS 像素一致)
    let hit = null;
    for (let i = this.nodeMap.length - 1; i >= 0; i--) {
      const { node, obj, outer } = this.nodeMap[i];
      if (!outer.visible) continue;
      let bounds = null;
      if (obj && obj.getBounds) {
        bounds = obj.getBounds();
      } else if (outer) {
        bounds = outer.getBounds();
      }
      if (!bounds) continue;
      if (mx >= bounds.x && mx <= bounds.x + bounds.width &&
          my >= bounds.y && my <= bounds.y + bounds.height) {
        hit = node;
        break;
      }
    }
    this.selectNode(hit, hit && hit._textDiv);
  }

  selectNode(node, div) {
    this.selected = node;
    this._drawSelection();
    // 高亮 overlay 文本
    if (this.textLayer) {
      this.textLayer.querySelectorAll('.fg-text-node.sel').forEach((d) => d.classList.remove('sel'));
      if (div) div.classList.add('sel');
    }
    this._renderProps(node);
    this._render();
    if (this._onSelect) this._onSelect(node);
  }

  _renderProps(node) {
    if (!this.propPanel) return;
    if (!node) {
      this.propPanel.innerHTML = '<div class="hint">点击画布中的对象查看属性</div>';
      return;
    }
    const [w, h] = this._nodeSize(node);
    if (!this.editMode) {
      const rows = [];
      const add = (k, v) => {
        if (v === null || v === undefined || v === '') return;
        let s = v;
        if (typeof v === 'object') s = JSON.stringify(v);
        rows.push(`<div class="fg-prop"><span class="fg-prop-k">${esc(k)}</span><span class="fg-prop-v">${esc(s)}</span></div>`);
      };
      add('类型', node.type);
      add('名称', node.name);
      add('id', node.id);
      add('x', Math.round(node.x));
      add('y', Math.round(node.y));
      if (w || h) add('尺寸', `${w}×${h}`);
      add('scale', node.scaleX != null ? `${node.scaleX},${node.scaleY != null ? node.scaleY : node.scaleX}` : null);
      add('pivot', node.pivotX != null ? `${node.pivotX},${node.pivotY}` : null);
      add('alpha', node.alpha);
      add('rotation', node.rotation != null ? node.rotation + '°' : null);
      add('visible', node.visible);
      add('text', node.text || null);
      if (node.textFormat && node.textFormat.size) add('fontSize', node.textFormat.size);
      if (node.textFormat && node.textFormat.color) add('color', node.textFormat.color);
      add('srcPkg', node.srcPkgId);
      add('sprite', node.sprite ? `${node.sprite.atlasItemId} ${node.sprite.x},${node.sprite.y} ${node.sprite.w}×${node.sprite.h}` : null);
      add('atlas', node.atlasKey);
      add('gearDisplay', node.gearDisplay ? JSON.stringify(node.gearDisplay) : null);
      this.propPanel.innerHTML = rows.length ? rows.join('') : '<div class="hint">(无属性)</div>';
      return;
    }

    // 编辑模式:属性面板可输入
    const num = (k, v, min, max, step) => {
      const id = `fg-pp-${k}`;
      return `<div class="fg-prop">
        <label class="fg-prop-k" for="${id}">${esc(k)}</label>
        <input type="number" id="${id}" class="fg-prop-input" value="${v != null ? esc(String(v)) : ''}" data-key="${k}" ${step != null ? `step="${step}"` : ''} ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} />
      </div>`;
    };
    const txt = (k, v, rows = 1) => {
      const id = `fg-pp-${k}`;
      return `<div class="fg-prop">
        <label class="fg-prop-k" for="${id}">${esc(k)}</label>
        <textarea id="${id}" class="fg-prop-input" data-key="${k}" rows="${rows}">${v != null ? esc(String(v)) : ''}</textarea>
      </div>`;
    };
    const ro = (k, v) => `<div class="fg-prop"><span class="fg-prop-k">${esc(k)}</span><span class="fg-prop-v">${esc(v != null ? String(v) : '')}</span></div>`;
    const rows = [];
    rows.push(ro('类型', node.type));
    rows.push(ro('名称', node.name));
    rows.push(ro('id', node.id));
    rows.push(num('x', Math.round(node.x)));
    rows.push(num('y', Math.round(node.y)));
    if (w || h) rows.push(num('width', w || 0, 0));
    if (w || h) rows.push(num('height', h || 0, 0));
    rows.push(num('scaleX', node.scaleX != null ? node.scaleX : 1, null, null, 0.01));
    rows.push(num('scaleY', node.scaleY != null ? node.scaleY : 1, null, null, 0.01));
    rows.push(num('alpha', node.alpha != null ? node.alpha : 1, 0, 1, 0.01));
    rows.push(num('rotation', node.rotation != null ? node.rotation : 0));
    rows.push(`<div class="fg-prop"><span class="fg-prop-k">visible</span><label class="fg-prop-v chk"><input type="checkbox" id="fg-pp-visible" data-key="visible" ${node.visible !== false ? 'checked' : ''} /> 显示</label></div>`);
    if (node.kind === 'text') rows.push(txt('text', node.text || '', 3));
    rows.push(ro('srcPkg', node.srcPkgId));
    rows.push(ro('sprite', node.sprite ? `${node.sprite.atlasItemId} ${node.sprite.x},${node.sprite.y} ${node.sprite.w}×${node.sprite.h}` : null));
    rows.push(ro('atlas', node.atlasKey));
    this.propPanel.innerHTML = rows.length ? rows.join('') : '<div class="hint">(无属性)</div>';

    // 绑定输入事件
    this.propPanel.querySelectorAll('.fg-prop-input').forEach((inp) => {
      inp.addEventListener('change', () => this._applyPropFromInput(node, inp.dataset.key, inp.value));
      inp.addEventListener('input', () => {
        if (inp.dataset.key === 'text') this._applyPropFromInput(node, inp.dataset.key, inp.value, true);
      });
    });
    const visCb = this.propPanel.querySelector('#fg-pp-visible');
    if (visCb) visCb.addEventListener('change', () => this._applyPropFromInput(node, 'visible', visCb.checked));
  }

  // ---------- 编辑模式公共方法 ----------
  setEditMode(mode) {
    this.editMode = !!mode;
    this._editHandles.clear();
    this._editHandles.visible = false;
    if (!this.editMode) {
      this.selected = null;
      this.highlight.clear();
      this.highlight.visible = false;
    }
    this._renderProps(this.selected);
    this._render();
  }

  _pickNode(mx, my) {
    for (let i = this.nodeMap.length - 1; i >= 0; i--) {
      const { node, obj, outer } = this.nodeMap[i];
      if (!outer || !outer.visible) continue;
      let bounds = null;
      if (obj && obj.getBounds) bounds = obj.getBounds();
      else if (outer && outer.getBounds) bounds = outer.getBounds();
      if (!bounds) continue;
      if (mx >= bounds.x && mx <= bounds.x + bounds.width &&
          my >= bounds.y && my <= bounds.y + bounds.height) {
        return node;
      }
    }
    return null;
  }

  _getEditableRect(node) {
    const entry = this.nodeMap.find((x) => x.node === node);
    const o = entry && entry.obj ? entry.obj : (entry && entry.outer);
    if (!o || !o.getBounds) return { x: node.x, y: node.y, w: 0, h: 0 };
    const b = o.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  _applyNodeXY(node, entry, x, y) {
    if (!node) return;
    if (!this._origValues.has(node)) this._origValues.set(node, { x: node.x, y: node.y });
    else {
      const orig = this._origValues.get(node);
      if (orig.x === undefined) orig.x = node.x;
      if (orig.y === undefined) orig.y = node.y;
    }
    const dx = x - node.x;
    const dy = y - node.y;
    node.x = x;
    node.y = y;
    if (!entry) entry = this.nodeMap.find((x) => x.node === node);
    if (!entry || !entry.outer) return;
    const [w, h] = this._nodeSize(node);
    const px = node.pivotX != null ? node.pivotX * w : 0;
    const py = node.pivotY != null ? node.pivotY * h : 0;
    if (node.pivotAsAnchor && node.pivotX != null) {
      entry.outer.position.set(x, y);
    } else {
      entry.outer.position.set(x + px, y + py);
    }
    // 同步文本 overlay 位置(overlay 坐标是 root-local,平移增量与 local 增量相同)
    if (node._textDiv) {
      const curLeft = parseFloat(node._textDiv.style.left) || 0;
      const curTop = parseFloat(node._textDiv.style.top) || 0;
      node._textDiv.style.left = (curLeft + dx) + 'px';
      node._textDiv.style.top = (curTop + dy) + 'px';
    }
  }

  _applyNodeSize(node, entry, w, h) {
    if (!node) return;
    if (!this._origValues.has(node)) this._origValues.set(node, {});
    const orig = this._origValues.get(node);
    if (orig.initWidth === undefined) orig.initWidth = node.initWidth;
    if (orig.initHeight === undefined) orig.initHeight = node.initHeight;
    node.initWidth = w;
    node.initHeight = h;
    if (!entry) entry = this.nodeMap.find((x) => x.node === node);
    if (!entry) return;
    if (entry.obj && entry.obj instanceof PIXI.Sprite) {
      entry.obj.width = w;
      entry.obj.height = h;
    }
    if (node._textDiv) {
      node._textDiv.style.width = w + 'px';
      node._textDiv.style.height = h + 'px';
    }
    // 同步 pivot 偏移
    this._applyNodeXY(node, entry, node.x, node.y);
  }

  _applyPropFromInput(node, key, value, deferRender) {
    if (!node) return;
    this._beginEdit(node);
    if (!this._origValues.has(node)) this._origValues.set(node, {});
    const orig = this._origValues.get(node);
    const entry = this.nodeMap.find((x) => x.node === node);
    const num = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    if (key === 'x') {
      if (orig.x === undefined) orig.x = node.x;
      this._applyNodeXY(node, entry, num(value), node.y);
    } else if (key === 'y') {
      if (orig.y === undefined) orig.y = node.y;
      this._applyNodeXY(node, entry, node.x, num(value));
    } else if (key === 'width') {
      if (orig.initWidth === undefined) orig.initWidth = node.initWidth;
      this._applyNodeSize(node, entry, num(value), node.initHeight != null ? node.initHeight : this._nodeSize(node)[1]);
    } else if (key === 'height') {
      if (orig.initHeight === undefined) orig.initHeight = node.initHeight;
      this._applyNodeSize(node, entry, node.initWidth != null ? node.initWidth : this._nodeSize(node)[0], num(value));
    } else if (key === 'scaleX') {
      if (orig.scaleX === undefined) orig.scaleX = node.scaleX;
      node.scaleX = num(value);
      if (entry && entry.outer) {
        const inner = entry.outer.children[0];
        if (inner) inner.scale.set(node.scaleX, node.scaleY != null ? node.scaleY : node.scaleX);
      }
    } else if (key === 'scaleY') {
      if (orig.scaleY === undefined) orig.scaleY = node.scaleY;
      node.scaleY = num(value);
      if (entry && entry.outer) {
        const inner = entry.outer.children[0];
        if (inner) inner.scale.set(node.scaleX != null ? node.scaleX : 1, node.scaleY);
      }
    } else if (key === 'alpha') {
      if (orig.alpha === undefined) orig.alpha = node.alpha;
      node.alpha = clamp(num(value), 0, 1);
      if (entry && entry.outer) {
        const inner = entry.outer.children[0];
        if (inner) inner.alpha = node.alpha;
      }
    } else if (key === 'rotation') {
      if (orig.rotation === undefined) orig.rotation = node.rotation;
      node.rotation = num(value);
      if (entry && entry.outer) {
        const inner = entry.outer.children[0];
        if (inner) inner.rotation = node.rotation * Math.PI / 180;
      }
    } else if (key === 'visible') {
      if (orig.visible === undefined) orig.visible = node.visible;
      node.visible = !!value;
      this._applyVisibility();
    } else if (key === 'text') {
      if (orig.text === undefined) orig.text = node.text;
      node.text = String(value || '');
      if (node._textDiv) node._textDiv.textContent = node.text;
    }
    this._drawSelection();
    if (!deferRender) { this._commitEdit(node); this._render(); }
  }

  _drawSelection() {
    this.highlight.clear();
    this._editHandles.clear();
    this._editHandles.visible = false;
    if (!this.selected) return;
    const b = this._getEditableRect(this.selected);
    this.highlight.rect(b.x, b.y, b.w, b.h).stroke({ width: 2, color: 0x6fb3ff });
    if (!this.editMode || b.w <= 0 || b.h <= 0) return;
    // 8 个缩放手柄
    const s = 8;
    const handles = [
      { x: b.x - s, y: b.y - s, c: 'nw' }, { x: b.x + b.w / 2 - s / 2, y: b.y - s, c: 'n' }, { x: b.x + b.w, y: b.y - s, c: 'ne' },
      { x: b.x - s, y: b.y + b.h / 2 - s / 2, c: 'w' }, { x: b.x + b.w, y: b.y + b.h / 2 - s / 2, c: 'e' },
      { x: b.x - s, y: b.y + b.h, c: 'sw' }, { x: b.x + b.w / 2 - s / 2, y: b.y + b.h, c: 's' }, { x: b.x + b.w, y: b.y + b.h, c: 'se' },
    ];
    for (const h of handles) {
      this._editHandles.rect(h.x, h.y, s, s).fill({ color: 0x6fb3ff }).stroke({ width: 1, color: 0xffffff });
    }
    this._editHandles.visible = true;
  }

  _hitResizeHandle(mx, my) {
    if (!this.editMode || !this.selected || !this._editHandles.visible) return null;
    const b = this._getEditableRect(this.selected);
    const s = 8;
    const handles = [
      { x: b.x - s, y: b.y - s, c: 'nw' }, { x: b.x + b.w / 2 - s / 2, y: b.y - s, c: 'n' }, { x: b.x + b.w, y: b.y - s, c: 'ne' },
      { x: b.x - s, y: b.y + b.h / 2 - s / 2, c: 'w' }, { x: b.x + b.w, y: b.y + b.h / 2 - s / 2, c: 'e' },
      { x: b.x - s, y: b.y + b.h, c: 'sw' }, { x: b.x + b.w / 2 - s / 2, y: b.y + b.h, c: 's' }, { x: b.x + b.w, y: b.y + b.h, c: 'se' },
    ];
    for (const h of handles) {
      if (mx >= h.x && mx <= h.x + s && my >= h.y && my <= h.y + s) return h.c;
    }
    return null;
  }

  _updateResize(clientX, clientY) {
    if (!this._resizeDrag) return;
    const { handle, startX, startY, startNode } = this._resizeDrag;
    const dx = (clientX - startX) / (this.viewC.scale.x || 1);
    const dy = (clientY - startY) / (this.viewC.scale.y || 1);
    let x = startNode.x, y = startNode.y, w = startNode.w, h = startNode.h;
    if (handle.includes('e')) w = Math.max(1, startNode.w + dx);
    if (handle.includes('s')) h = Math.max(1, startNode.h + dy);
    if (handle.includes('w')) { w = Math.max(1, startNode.w - dx); x = startNode.x + (startNode.w - w); }
    if (handle.includes('n')) { h = Math.max(1, startNode.h - dy); y = startNode.y + (startNode.h - h); }
    this._applyNodeXY(this.selected, null, Math.round(x), Math.round(y));
    this._applyNodeSize(this.selected, null, Math.round(w), Math.round(h));
    this._drawSelection();
    this._syncOverlay();
    this._render();
    this._renderProps(this.selected);
  }

  _startTextEdit(node) {
    if (!node || node.kind !== 'text' || !node._textDiv) return;
    this._beginEdit(node);
    const div = node._textDiv;
    const input = document.createElement('textarea');
    input.className = 'fg-text-edit';
    input.value = node.text || '';
    input.style.cssText = div.style.cssText;
    input.style.zIndex = '100';
    input.style.background = 'rgba(27,29,35,0.9)';
    input.style.border = '1px solid #6fb3ff';
    input.style.color = div.style.color || '#eee';
    input.style.resize = 'none';
    input.style.outline = 'none';
    const commit = () => {
      this._applyPropFromInput(node, 'text', input.value);
      input.remove();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = node.text || ''; input.blur(); }
    });
    div.parentElement.appendChild(input);
    input.focus();
  }

  // ---------- 撤销 / 编辑历史 ----------

  /** 记录节点当前属性快照(仅关键可编辑字段) */
  _snapProps(node) {
    const s = {};
    for (const k of ['x', 'y', 'initWidth', 'initHeight', 'scaleX', 'scaleY', 'alpha', 'rotation', 'visible', 'text']) {
      if (node[k] !== undefined) s[k] = node[k];
    }
    return s;
  }

  /**
   * 编辑操作开始:记录操作前状态到撤销栈。
   * 同一节点未提交(committed=false)时重复调用不重复记录,保证一次拖拽/一次输入只留一条历史。
   */
  _beginEdit(node) {
    if (!node) return;
    const top = this._editStack.length ? this._editStack[this._editStack.length - 1] : null;
    if (top && top.node === node && !top.committed) return;
    this._editStack.push({ node, before: this._snapProps(node), committed: false });
  }

  /**
   * 编辑操作提交:对比 before 与当前值,生成 changes 并回调 _onEditCommitted(供页面层写磁盘编辑历史)。
   * 之后同节点的下一次编辑会重新入栈,实现逐步撤销。
   */
  _commitEdit(node) {
    if (!node) return;
    for (let i = this._editStack.length - 1; i >= 0; i--) {
      const rec = this._editStack[i];
      if (rec.node !== node || rec.committed) continue;
      rec.committed = true;
      const changes = {};
      for (const k of Object.keys(rec.before)) {
        const a = node[k];
        if (rec.before[k] !== a) changes[k] = { before: rec.before[k], after: a };
      }
      if (Object.keys(changes).length && typeof this._onEditCommitted === 'function') {
        this._onEditCommitted({
          component: this.comp ? this.comp.name : '',
          nodeId: node.id,
          name: node.name,
          changes,
        });
      }
      return;
    }
  }

  /** 撤销上一步编辑(恢复到操作前状态);无可撤销时返回 false */
  undo() {
    if (!this._editStack.length) return false;
    const rec = this._editStack.pop();
    const node = rec.node;
    if (!node || !this.nodeMap.some((x) => x.node === node)) {
      // 节点已不在树中(包已换),丢弃该记录
      return this.undo();
    }
    this._applySnapRec(node, rec.before);
    this._drawSelection();
    this._syncOverlay();
    this._applyVisibility();
    this._render();
    this._renderProps(this.selected);
    return true;
  }

  exportEdits() {
    const out = [];
    const walk = (node) => {
      const orig = this._origValues.get(node);
      if (orig) {
        const rec = { id: node.id, name: node.name, type: node.type };
        for (const k of ['x', 'y', 'initWidth', 'initHeight', 'scaleX', 'scaleY', 'alpha', 'rotation', 'visible', 'text']) {
          if (node[k] !== undefined) rec[k] = node[k];
        }
        rec.orig = {};
        for (const k of Object.keys(orig)) rec.orig[k] = orig[k];
        out.push(rec);
      }
      for (const ch of node.children || []) walk(ch);
    };
    if (this.comp && this.comp.root) walk(this.comp.root);
    return out;
  }

  /**
   * 回放布局快照(由 exportEdits 或保存的快照 JSON 生成)。
   * @param {object} snap { component:{id,name}, nodes:[{id,x,y,initWidth,initHeight,scaleX,scaleY,alpha,rotation,visible,text}] }
   * @returns {{ok:boolean, applied:number, error?:string}}
   */
  applySnapshot(snap) {
    if (!snap || !this.comp) return { ok: false, error: '未加载 FGUI 包' };
    const compRef = snap.component || {};
    // 组件匹配校验:id 或 name 任一匹配即视为同一组件(宽松处理,避免解析差异)
    const idMatch = compRef.id && this.comp.id !== undefined && String(this.comp.id) === String(compRef.id);
    const nameMatch = compRef.name && String(this.comp.name) === String(compRef.name);
    if (compRef.id && compRef.name && !idMatch && !nameMatch) {
      return { ok: false, error: `快照属于组件「${compRef.name}」,请先在组件下拉中选择该组件再加载` };
    }
    const byId = new Map();
    const walk = (n) => {
      if (!n) return;
      if (n.id !== undefined && n.id !== null) byId.set(String(n.id), n);
      for (const ch of n.children || []) walk(ch);
    };
    walk(this.comp.root);
    const entries = Array.isArray(snap.nodes) ? snap.nodes : [];
    let applied = 0;
    for (const rec of entries) {
      if (!rec || rec.id === undefined || rec.id === null) continue;
      const node = byId.get(String(rec.id));
      if (!node) continue;
      this._applySnapRec(node, rec);
      applied++;
    }
    this._drawSelection();
    this._syncOverlay();
    this._applyVisibility();
    this._render();
    this._renderProps(this.selected);
    return { ok: true, applied };
  }

  /** 应用单条快照记录到节点(含原始值备份,便于再次导出) */
  _applySnapRec(node, rec) {
    if (!this._origValues.has(node)) this._origValues.set(node, {});
    const orig = this._origValues.get(node);
    const entry = this.nodeMap.find((x) => x.node === node);
    const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
    // 尺寸(先于坐标, pivot 偏移依赖尺寸)
    if (rec.initWidth !== undefined || rec.initHeight !== undefined) {
      const [cw, ch] = this._nodeSize(node);
      const nw = rec.initWidth !== undefined ? num(rec.initWidth, cw) : cw;
      const nh = rec.initHeight !== undefined ? num(rec.initHeight, ch) : ch;
      if (orig.initWidth === undefined) orig.initWidth = node.initWidth;
      if (orig.initHeight === undefined) orig.initHeight = node.initHeight;
      node.initWidth = nw;
      node.initHeight = nh;
      if (entry && entry.obj && entry.obj instanceof PIXI.Sprite) {
        entry.obj.width = nw;
        entry.obj.height = nh;
      }
      if (node._textDiv) {
        node._textDiv.style.width = nw + 'px';
        node._textDiv.style.height = nh + 'px';
      }
    }
    // 坐标
    if (rec.x !== undefined || rec.y !== undefined) {
      const [w, h] = this._nodeSize(node);
      const px = node.pivotX != null ? node.pivotX * w : 0;
      const py = node.pivotY != null ? node.pivotY * h : 0;
      if (orig.x === undefined) orig.x = node.x;
      if (orig.y === undefined) orig.y = node.y;
      const nx = rec.x !== undefined ? Math.round(num(rec.x, node.x)) : node.x;
      const ny = rec.y !== undefined ? Math.round(num(rec.y, node.y)) : node.y;
      node.x = nx;
      node.y = ny;
      if (entry && entry.outer) {
        if (node.pivotAsAnchor && node.pivotX != null) entry.outer.position.set(nx, ny);
        else entry.outer.position.set(nx + px, ny + py);
      }
      if (node._textDiv) {
        node._textDiv.style.left = nx + 'px';
        node._textDiv.style.top = ny + 'px';
      }
    }
    // 缩放 / 透明度 / 旋转(作用于内层容器)
    if (entry && entry.outer && entry.outer.children.length) {
      const inner = entry.outer.children[0];
      if (rec.scaleX !== undefined || rec.scaleY !== undefined) {
        if (orig.scaleX === undefined) orig.scaleX = node.scaleX;
        if (orig.scaleY === undefined) orig.scaleY = node.scaleY;
        node.scaleX = rec.scaleX !== undefined ? num(rec.scaleX, 1) : node.scaleX;
        node.scaleY = rec.scaleY !== undefined ? num(rec.scaleY, node.scaleY) : node.scaleY;
        inner.scale.set(node.scaleX, node.scaleY != null ? node.scaleY : node.scaleX);
      }
      if (rec.alpha !== undefined) {
        if (orig.alpha === undefined) orig.alpha = node.alpha;
        node.alpha = clamp(num(rec.alpha, 1), 0, 1);
        inner.alpha = node.alpha;
      }
      if (rec.rotation !== undefined) {
        if (orig.rotation === undefined) orig.rotation = node.rotation;
        node.rotation = num(rec.rotation, 0);
        inner.rotation = node.rotation * Math.PI / 180;
      }
    }
    if (rec.visible !== undefined) {
      if (orig.visible === undefined) orig.visible = node.visible;
      node.visible = !!rec.visible;
    }
    if (rec.text !== undefined) {
      if (orig.text === undefined) orig.text = node.text;
      node.text = String(rec.text == null ? '' : rec.text);
      if (node._textDiv) node._textDiv.textContent = node.text;
    }
  }

  // ---------- 控制器页切换 ----------
  _renderCtrlBar() {
    if (!this.ctrlBar) return;
    this.ctrlBar.innerHTML = '';
    const controllers = this.comp.controllers || [];
    if (!controllers.length) {
      this.ctrlBar.style.display = 'none';
      return;
    }
    this.ctrlBar.style.display = '';
    for (const c of controllers) {
      const wrap = document.createElement('div');
      wrap.className = 'fg-ctrl-group';
      const label = document.createElement('span');
      label.className = 'fg-ctrl-name';
      label.textContent = c.name;
      wrap.appendChild(label);
      const pages = c.pages && c.pages.length ? c.pages : [{ id: '', name: '默认' }];
      // 默认页
      const homeIdx = (c.homePageIndex != null && c.homePageIndex < pages.length) ? c.homePageIndex : 0;
      const homePage = pages[homeIdx] || pages[0];
      if (!(c.name in this.activePages)) this.activePages[c.name] = homePage.id;
      pages.forEach((pg, idx) => {
        const b = document.createElement('button');
        b.className = 'btn sm fg-ctrl-btn' + (pg.id === this.activePages[c.name] ? ' active' : '');
        b.textContent = pg.name || pg.id || `页${idx + 1}`;
        b.title = `页面: ${pg.id || '(空)'}`;
        b.addEventListener('click', () => {
          this.activePages[c.name] = pg.id;
          this._renderCtrlBar();
          this._applyVisibility();
          this._render();
        });
        wrap.appendChild(b);
      });
      this.ctrlBar.appendChild(wrap);
    }
  }

  /** 按 gearDisplay 重算可见性 */
  _applyVisibility() {
    const controllers = this.comp.controllers || [];
    const walk = (node, pixiOuter) => {
      if (!node) return;
      let show = node.visible !== false;
      if (show && node.gearDisplay) {
        const gd = node.gearDisplay;
        if (gd.controllerIndex !== -1 && controllers[gd.controllerIndex]) {
          const cName = controllers[gd.controllerIndex].name;
          const pageId = this.activePages[cName];
          show = (gd.pages || []).includes(pageId);
        }
      }
      if (pixiOuter) pixiOuter.visible = show;
      if (node._textDiv) node._textDiv.style.display = show ? '' : 'none';
      for (const ch of node.children || []) {
        const entry = this.nodeMap.find((x) => x.node === ch);
        walk(ch, entry ? entry.outer : null);
      }
    };
    walk(this.comp.root, this.viewC);
  }

  // ---------- overlay / 渲染 ----------
  _syncOverlay() {
    if (!this.textLayer || !this.viewC) return;
    const k = this.viewC.scale.x || 1;
    this.textLayer.style.transform =
      `translate(${this.viewC.position.x}px, ${this.viewC.position.y}px) scale(${k})`;
  }

  _render() {
    if (this.app) this.app.render();
  }

  dispose() {
    this._loadToken++;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this.app) {
      try { this.app.destroy(true, { children: true }); } catch (e) { /* ignore */ }
      this.app = null;
    }
    if (this.textLayer) this.textLayer.innerHTML = '';
    this.viewC = null;
    this.canvas = null;
    this.payload = null;
    this.comp = null;
    this.nodeMap = [];
    this.textures = {};
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
