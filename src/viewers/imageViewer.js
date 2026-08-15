/**
 * 图片查看器:缩放(滚轮/滑块)+ 拖拽平移(CSS transform)+ 旋转/镜像 + EXIF 自动方向适配 + 修改保存。
 */
import { setSetting } from '../state.js';

/** 解析 JPEG EXIF Orientation(1-8),非 JPEG / 无 EXIF 返回 1 */
async function readJpegExifOrientation(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return 1;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1; // 非 JPEG(SOI)
    let off = 2;
    while (off < buf.length - 8) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker === 0xe1) { // APP1: EXIF
        const len = (buf[off + 2] << 8) | buf[off + 3];
        const seg = buf.subarray(off + 4, off + 2 + len);
        if (seg.length > 6 && seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66 && seg[4] === 0 && seg[5] === 0) {
          return parseExifOrientation(seg.subarray(6));
        }
        off += 2 + len;
        continue;
      }
      // 无长度标记(SOF0/standalone/RST)
      if (marker >= 0xd0 && marker <= 0xd9) { off += 2; continue; }
      if (off + 2 >= buf.length) break;
      const len = (buf[off + 2] << 8) | buf[off + 3];
      off += 2 + len;
    }
    return 1;
  } catch (_) { return 1; }
}

/** 解析 EXIF TIFF 段的 Orientation 字段 */
function parseExifOrientation(t) {
  if (t.length < 8) return 1;
  let le = false;
  if (t[0] === 0x49 && t[1] === 0x49) le = true;   // II 小端
  else if (t[0] === 0x4d && t[1] === 0x4d) le = false; // MM 大端
  else return 1;
  const u16 = (o) => (le ? (t[o] | (t[o + 1] << 8)) : ((t[o] << 8) | t[o + 1]));
  const u32 = (o) => (le
    ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24))
    : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) return u16(e + 8); // Orientation
  }
  return 1;
}

export class ImageViewerController {
  constructor() {
    this.wrap = null;
    this.img = null;
    this.zoomRange = null;
    this.zoomVal = null;
    this.statusEl = null;
    this.zoom = 1;
    this.fitMode = true;
    this.rotation = 0;   // 旋转角度 0/90/180/270(顺时针)
    this.flipX = false;  // 水平镜像
    this.flipY = false;  // 垂直镜像
    this._drag = null;
    // EXIF 自动旋转后的"视觉正确"尺寸(createImageBitmap + imageOrientation:'from-image')
    this._bmpWidth = 0;
    this._bmpHeight = 0;
    // 当前图片的磁盘路径(用于"保存修改到原文件")
    this.itemPath = '';
    // 当前预览图片的修改标记:旋转或镜像发生过则 true;保存后或加载新图后清零
    this._dirty = false;
    // 上下工具栏是否隐藏(沉浸查看):隐藏后鼠标靠近画面边缘临时显示
    this.chromeHidden = false;
    this.fullscreen = false;   // 全屏预览(应用内)
    this._prevChromeHidden = undefined;
    this._chromeShow = false;  // 沉浸模式当前是否显示工具栏
    this._chromeRaf = 0;
    this._lastY = 0;
    this.canvasWrap = null;
    this._ro = null;
  }

  init(wrap) {
    this.wrap = wrap;
    this.img = wrap.querySelector('#img-display');
    this.zoomRange = wrap.querySelector('#img-zoom-range');
    this.zoomVal = wrap.querySelector('#img-zoom-val');
    this.statusEl = wrap.querySelector('#img-status');
    this.saveBtn = wrap.querySelector('#img-save-edit');
    this.canvasWrap = wrap.querySelector('.img-canvas-wrap');

    // 上下工具栏隐藏状态(持久化)
    try {
      this.chromeHidden = !!JSON.parse(localStorage.getItem('imageChromeHidden') || 'false');
    } catch (_) { this.chromeHidden = false; }
    this.panel = document.getElementById('page-preview');
    this.headEl = this.panel ? this.panel.querySelector('.preview-head') : null;
    this.ctrlEl = this.panel ? this.panel.querySelector('#pv-image-view .preview-controls') : null;
    this._setupChrome();
    this.applyChrome();

    // 隐藏/显示工具栏会改变画布可用区域 → 在"适配窗口"模式下重新计算缩放
    if (this.canvasWrap && typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => {
        if (this.fitMode && this.img && this.img.complete) this.fit();
      });
      this._ro.observe(this.canvasWrap);
    }

    // ESC 退出全屏预览
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.fullscreen) this.toggleFullscreen();
    });

    // 滚轮缩放
    this.img.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.pow(1.12, -e.deltaY / 100);
      this.setZoom(this.zoom * f);
    }, { passive: false });

    // 拖拽平移
    this.img.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, y: e.clientY, tx: this._tx || 0, ty: this._ty || 0 };
      this.img.setPointerCapture(e.pointerId);
      this.img.style.cursor = 'grabbing';
    });
    this.img.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      this._tx = this._drag.tx + (e.clientX - this._drag.x);
      this._ty = this._drag.ty + (e.clientY - this._drag.y);
      this._apply();
    });
    const endDrag = () => {
      this._drag = null;
      this.img.style.cursor = 'grab';
    };
    this.img.addEventListener('pointerup', endDrag);
    this.img.addEventListener('pointerleave', endDrag);

    // 缩放滑块
    if (this.zoomRange) {
      this.zoomRange.addEventListener('input', () => {
        this.fitMode = false;
        this.setZoom(Number(this.zoomRange.value) / 100);
      });
    }

    // 显示模式按钮:适配窗口 / 100%
    const fitBtn = wrap.querySelector('#img-fit');
    if (fitBtn) fitBtn.addEventListener('click', () => this.fit());
    const actualBtn = wrap.querySelector('#img-actual');
    if (actualBtn) actualBtn.addEventListener('click', () => this.setZoomUI(1));

    // ---- 变换工具:左旋 / 右旋 / 水平镜像 / 垂直镜像 / 重置 / 保存 ----
    const rotLeftBtn = wrap.querySelector('#img-rotate-left');
    if (rotLeftBtn) rotLeftBtn.addEventListener('click', () => this.rotateLeft());
    const rotRightBtn = wrap.querySelector('#img-rotate');
    if (rotRightBtn) rotRightBtn.addEventListener('click', () => this.rotateRight());
    const flipHBtn = wrap.querySelector('#img-flip-h');
    if (flipHBtn) flipHBtn.addEventListener('click', () => this.flipH());
    const flipVBtn = wrap.querySelector('#img-flip-v');
    if (flipVBtn) flipVBtn.addEventListener('click', () => this.flipV());
    const resetBtn = wrap.querySelector('#img-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
    // 隐藏/显示上下工具栏(按钮在顶部工具栏)
    const chromeBtn = document.getElementById('img-chrome');
    if (chromeBtn) chromeBtn.addEventListener('click', () => this.toggleChrome());
    // 全屏预览(按钮在顶部工具栏)
    const fsBtn = document.getElementById('img-fullscreen');
    if (fsBtn) fsBtn.addEventListener('click', () => this.toggleFullscreen());
    // 背景色弹出面板(深/浅/自定义/调色板)
    this._setupBgPopover(wrap);
    // 保存按钮(覆盖原图,需二次确认)由 ui.js 在 showImageViewer 中单独绑定,
    // 以便弹 confirmDialog 确认对话框,避免 viewers 子模块依赖 dialogs
  }

  /** 背景色弹出面板:点击 ▾ 按钮切换显示,点击外部或 ESC 关闭;popover 内点击不关闭 */
  _setupBgPopover(wrap) {
    const trigger = wrap.querySelector('#img-bg-trigger');
    const popover = wrap.querySelector('#img-bg-popover');
    if (!trigger || !popover) return;
    const open = popover.hidden;
    const close = () => {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    const toggle = (e) => {
      e.stopPropagation();
      if (popover.hidden) {
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        close();
      }
    };
    trigger.addEventListener('click', toggle);
    popover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (!popover.hidden) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !popover.hidden) close(); });
  }

  /** 同步背景色色块到触发按钮(背景色应用时调用) */
  setBgSwatch(c) {
    const btn = this.wrap && this.wrap.querySelector('#img-bg-trigger');
    if (btn) btn.style.setProperty('--bg-swatch', c);
  }

  /**
   * 沉浸模式感应(上下工具栏同时显示/隐藏):
   * - 鼠标距顶部或底部工具栏 ≤ 1.5×工具栏高度 → 显示(原 3×,减半,无需贴边);
   * - 已显示时,鼠标离开 > 3.5×(=1.5×+2× 滞回) 才隐藏;
   * - 显示立即、隐藏带 1s 防抖(期间鼠标回来则取消),避免快速反复切换导致画面抖动;
   * - rAF 节流 + 状态守卫。
   */
  _setupChrome() {
    if (!this.panel) return;
    this._chromeShow = false;
    this._chromeRaf = 0;
    this._chromeTimer = null;
    this._lastY = 0;
    const onMove = (e) => {
      if (!this.chromeHidden || !this.panel) return;
      this._lastY = e.clientY;
      if (this._chromeRaf) return;
      this._chromeRaf = requestAnimationFrame(() => {
        this._chromeRaf = 0;
        const rect = this.panel.getBoundingClientRect();
        const y = this._lastY - rect.top;
        const H = rect.height;
        const hTop = (this.headEl && this.headEl.offsetHeight) || 44;
        const hBottom = (this.ctrlEl && this.ctrlEl.offsetHeight) || 96;
        let show;
        if (y <= hTop * 1.5 || y >= H - hBottom * 1.5) {
          show = true; // 靠近顶部/底部 1.5× 工具栏高 → 显示
        } else if (this._chromeShow) {
          show = y <= hTop * 3.5 || y >= H - hBottom * 3.5; // 已显示:滞回,离开 2× 后才隐藏
        } else {
          show = false;
        }
        this.setChromeOn(show);
      });
    };
    this.panel.addEventListener('mousemove', onMove);
    this.panel.addEventListener('mouseleave', () => this.setChromeOn(false));
  }

  /** 切换工具栏显示状态:显示立即;隐藏带 1s 防抖(期间鼠标回来取消隐藏,防反复抖动) */
  setChromeOn(v) {
    if (!this.panel) return;
    if (this._chromeShow === v) return;
    if (v) {
      clearTimeout(this._chromeTimer);
      this._chromeTimer = null;
      this._chromeShow = true;
      this.panel.classList.add('chrome-on');
    } else {
      if (this._chromeTimer) return; // 已有挂起的隐藏(防抖中),保持显示
      this._chromeTimer = setTimeout(() => {
        this._chromeTimer = null;
        this._chromeShow = false;
        this.panel.classList.remove('chrome-on');
      }, 200);
    }
  }

  /** 切换上下工具栏隐藏(沉浸查看);隐藏后画布区域变大,适配窗口模式会自动重新 fit */
  toggleChrome() {
    this.chromeHidden = !this.chromeHidden;
    try { localStorage.setItem('imageChromeHidden', JSON.stringify(this.chromeHidden)); } catch (_) {}
    this.applyChrome();
    const btn = document.getElementById('img-chrome');
    if (btn) btn.title = this.chromeHidden ? '显示上下工具栏(当前已隐藏,鼠标靠近对应工具栏位置显示)' : '隐藏上下工具栏(沉浸查看)';
  }

  /** 应用 chromeHidden:给预览面板加 chrome-hidden(顶部/底部工具栏同时收缩,画布变大) */
  applyChrome() {
    if (!this.panel) return;
    this.panel.classList.toggle('chrome-hidden', !!this.chromeHidden);
    if (!this.chromeHidden) {
      clearTimeout(this._chromeTimer);
      this._chromeTimer = null;
      this._chromeShow = false;
      this.panel.classList.remove('chrome-on');
    }
  }

  /** 全屏预览:系统窗口全屏(隐藏标题栏) + 应用内隐藏顶栏/侧栏/标签条;进入自动沉浸,ESC 或按钮退出 */
  toggleFullscreen() {
    this.fullscreen = !this.fullscreen;
    document.body.classList.toggle('app-preview-fullscreen', !!this.fullscreen);
    try { if (window.api && window.api.setFullScreen) window.api.setFullScreen(this.fullscreen); } catch (_) { /* ignore */ }
    if (this.fullscreen) {
      this._prevChromeHidden = this.chromeHidden;
      if (!this.chromeHidden) {
        this.chromeHidden = true; // 全屏自动沉浸
        try { localStorage.setItem('imageChromeHidden', 'true'); } catch (_) {}
      }
    } else if (this._prevChromeHidden !== undefined) {
      this.chromeHidden = this._prevChromeHidden; // 退出恢复用户原设置
      try { localStorage.setItem('imageChromeHidden', JSON.stringify(this.chromeHidden)); } catch (_) {}
    }
    this.applyChrome();
    const btn = document.getElementById('img-fullscreen');
    if (btn) {
      btn.textContent = this.fullscreen ? '✕ 退出全屏' : '⛶ 全屏';
      btn.title = this.fullscreen ? '退出全屏预览(ESC)' : '全屏预览(隐藏标题栏/顶栏/侧栏/标签条)';
    }
    // 布局尺寸变化后重算缩放(ResizeObserver 兜底)
    setTimeout(() => { if (this.fitMode && this.img && this.img.complete) this.fit(); }, 120);
  }

  async load(url, itemPath = '') {
    // 每张图独立的变换状态:加载新图清零 rotation/flip/dirty,避免与上一张相互影响
    this.rotation = 0;
    this.flipX = false;
    this.flipY = false;
    this._dirty = false;
    this._bmpWidth = 0;
    this._bmpHeight = 0;
    this.itemPath = itemPath;
    this.toggleSaveButton();

    this.img.style.display = '';
    this.img.style.opacity = '0';
    await new Promise((resolve, reject) => {
      this.img.onload = resolve;
      this.img.onerror = () => reject(new Error('图片加载失败'));
      this.img.src = url;
    });
    // 解析 EXIF 自动旋转方向,获取"视觉正确"的像素尺寸
    // (浏览器虽自动按 EXIF 旋转渲染,但 img.naturalWidth/Height 仍是旋转前像素,
    // 直接拿来算 fit 会得到错误的"被缩小"效果——手机竖拍照片典型问题)
    let w = this.img.naturalWidth || 0;
    let h = this.img.naturalHeight || 0;
    let fromBmp = false;
    if (typeof window.createImageBitmap === 'function') {
      try {
        const bmp = await window.createImageBitmap(this.img, { imageOrientation: 'from-image' });
        w = bmp.width;
        h = bmp.height;
        fromBmp = true;
        bmp.close && bmp.close();
      } catch (_) { /* createImageBitmap 失败 → 走 EXIF 显式解析 */ }
    }
    if (!fromBmp) {
      // 兜底:显式解析 JPEG EXIF Orientation(5-8 为旋转 90/270,宽高互换)
      const ori = await readJpegExifOrientation(url);
      if (ori >= 5 && ori <= 8 && this.img.naturalWidth && this.img.naturalHeight) {
        w = this.img.naturalHeight;
        h = this.img.naturalWidth;
      }
    }
    this._bmpWidth = w;
    this._bmpHeight = h;
    this.img.style.opacity = '1';
    this._tx = 0;
    this._ty = 0;
    // 工具栏状态栏显示图片尺寸(视觉尺寸,EXIF 旋转后)
    if (this.statusEl) this.statusEl.textContent = `${w} × ${h} px`;
    this.applyChrome();
    this.fit();
  }

  setZoom(r) {
    this.zoom = Math.min(Math.max(r, 0.05), 40);
    if (this.zoomRange) this.zoomRange.value = Math.round(this.zoom * 100);
    if (this.zoomVal) this.zoomVal.textContent = Math.round(this.zoom * 100) + '%';
    // layout 尺寸由 zoom × 自然尺寸决定(旋转 90/270 时交换宽高),CSS 不再受 max-width/max-height 限制
    this._layoutSize();
    this._apply();
  }

  /**
   * 根据当前视觉尺寸(EXIF 旋转后)、旋转与 zoom,计算并设置 img 的 layout 宽高。
   * 旋转 90/270 时图片"占容器的视觉宽高"与"自然像素宽高"相反,因此 layout 宽高需交换;
   * 翻转不改变 layout 尺寸,只改变 transform 缩放符号。
   */
  _layoutSize() {
    if (!this.img) return;
    const [nw, nh] = this.visualSize();
    if (!nw || !nh) return;
    const rotated = this.rotation % 180 !== 0;
    const w = (rotated ? nh : nw) * this.zoom;
    const h = (rotated ? nw : nh) * this.zoom;
    this.img.style.width = w + 'px';
    this.img.style.height = h + 'px';
  }

  /** 当前图片的"视觉真实"宽高(EXIF 旋转后;无 EXIF 时为 naturalWidth/Height) */
  visualSize() {
    if (this._bmpWidth && this._bmpHeight) return [this._bmpWidth, this._bmpHeight];
    return [this.img && this.img.naturalWidth || 0, this.img && this.img.naturalHeight || 0];
  }

  /** 适配窗口:按图片"视觉真实"尺寸(考虑旋转后宽高互换)与容器比例缩放,设 layout size */
  fit() {
    if (!this.img || !this.img.naturalWidth) return;
    this.fitMode = true;
    const cw = this.wrap.clientWidth;
    const ch = this.wrap.clientHeight;
    const [nw, nh] = this.visualSize();
    const rotated = this.rotation % 180 !== 0;
    const iw = rotated ? nh : nw;
    const ih = rotated ? nw : nh;
    const s = Math.min(cw / iw, ch / ih, 1);
    this._tx = 0;
    this._ty = 0;
    this.setZoom(s);
  }

  setZoomUI(r) {
    this.fitMode = false;
    this.setZoom(r);
  }

  /** 逆时针旋转 90°(0/90/180/270);重置平移并重新适配窗口 */
  rotateLeft() {
    this.rotation = (this.rotation + 270) % 360;
    this._tx = 0;
    this._ty = 0;
    this._markDirty();
    if (this.fitMode) this.fit();
    else { this._layoutSize(); this._apply(); }
  }

  /** 顺时针旋转 90°(0/90/180/270);重置平移并重新适配窗口 */
  rotateRight() {
    this.rotation = (this.rotation + 90) % 360;
    this._tx = 0;
    this._ty = 0;
    this._markDirty();
    if (this.fitMode) this.fit();
    else { this._layoutSize(); this._apply(); }
  }

  /** 水平镜像(左右翻转) */
  flipH() {
    this.flipX = !this.flipX;
    this._apply();
    this._markDirty();
  }

  /** 垂直镜像(上下翻转) */
  flipV() {
    this.flipY = !this.flipY;
    this._apply();
    this._markDirty();
  }

  /** 重置视图:清除旋转/镜像,恢复适配窗口(不修改文件) */
  reset() {
    this.rotation = 0;
    this.flipX = false;
    this.flipY = false;
    this._dirty = false;
    this.toggleSaveButton();
    this.fit();
  }

  /** 标记有未保存修改(旋转/镜像),显示保存按钮 */
  _markDirty() {
    if (this.rotation === 0 && !this.flipX && !this.flipY) {
      // 三个变换都还原(例如连按两次镜像),撤销 dirty
      this._dirty = false;
    } else {
      this._dirty = true;
    }
    this.toggleSaveButton();
  }

  /** 根据 _dirty 切换保存按钮显隐 */
  toggleSaveButton() {
    if (this.saveBtn) this.saveBtn.hidden = !this._dirty;
  }

  /**
   * 把当前 img 按 rotation/flip 变换画到 canvas 后,导出对应编码的 blob,写回原文件(覆盖)。
   * 注意:canvas 导出会丢失原图的 EXIF 信息(写入为新 JPEG/PNG,无方向/无元数据),
   * 原方向已通过视觉旋转纳入画布像素,无需再保留 EXIF orientation。
   */
  async save() {
    if (!this.img || !this.img.complete || !this.itemPath) return;
    if (!this._dirty) return;
    const [nw, nh] = this.visualSize();
    if (!nw || !nh) throw new Error('图片尺寸异常,无法保存');
    const rotated = this.rotation % 180 !== 0;
    const w = rotated ? nh : nw;
    const h = rotated ? nw : nh;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // 旋转变换(围绕画布中心),再水平/垂直翻转
    ctx.translate(w / 2, h / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
    // drawImage 使用"视觉真实"尺寸(浏览器已自动旋转渲染,EXIF orientation 已应用)
    ctx.drawImage(this.img, -nw / 2, -nh / 2, nw, nh);
    // 按原文件扩展名决定编码
    const m = /\.([^.\\/]+)$/.exec(this.itemPath);
    const ext = m ? m[1].toLowerCase() : '';
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
    const quality = mime === 'image/jpeg' ? 0.92 : undefined;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!blob) throw new Error('导出图片失败');
    // dataURL → 纯 base64
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
    const b64 = String(dataUrl).split(',')[1] || '';
    const r = await window.api.writeFileBase64(this.itemPath, b64);
    if (!r || !r.ok) throw new Error((r && r.error) || '写文件失败');
    this._dirty = false;
    this.toggleSaveButton();
  }

  /** 设置查看区背景色(与动画预览的背景色设置一致) */
  setBgColor(color) {
    const bgEl = this.wrap ? this.wrap.querySelector('.img-canvas-wrap') : null;
    if (bgEl) bgEl.style.background = color;
  }

  _apply() {
    if (!this.img) return;
    // zoom 已通过 img.style.width/height(layout size)体现;transform 只做平移/旋转/翻转,
    // 翻转用 scale(±1)实现(负号翻转)。这样 fit 后图片视觉尺寸 == layout size == 自然 × zoom,
    // 不再被 CSS max-width/max-height 二次压缩。
    const sx = this.flipX ? -1 : 1;
    const sy = this.flipY ? -1 : 1;
    this.img.style.transform =
      `translate(${this._tx || 0}px, ${this._ty || 0}px) ` +
      `rotate(${this.rotation}deg) scale(${sx}, ${sy})`;
  }

  dispose() {
    if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
    clearTimeout(this._chromeTimer);
    this._chromeTimer = null;
    this.wrap = null;
    this.img = null;
    this.zoomRange = null;
    this.zoomVal = null;
    this.statusEl = null;
    this.saveBtn = null;
    this.canvasWrap = null;
    this._drag = null;
  }
}
