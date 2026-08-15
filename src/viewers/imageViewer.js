/**
 * 图片查看器:缩放(滚轮/滑块)+ 拖拽平移(CSS transform)。
 */
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
  }

  init(wrap) {
    this.wrap = wrap;
    this.img = wrap.querySelector('#img-display');
    this.zoomRange = wrap.querySelector('#img-zoom-range');
    this.zoomVal = wrap.querySelector('#img-zoom-val');
    this.statusEl = wrap.querySelector('#img-status');

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

    // ---- 变换工具:旋转 / 水平镜像 / 垂直镜像 / 重置 ----
    const rotBtn = wrap.querySelector('#img-rotate');
    if (rotBtn) rotBtn.addEventListener('click', () => this.rotate());
    const flipHBtn = wrap.querySelector('#img-flip-h');
    if (flipHBtn) flipHBtn.addEventListener('click', () => this.flipH());
    const flipVBtn = wrap.querySelector('#img-flip-v');
    if (flipVBtn) flipVBtn.addEventListener('click', () => this.flipV());
    const resetBtn = wrap.querySelector('#img-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
  }

  async load(url) {
    this.img.style.display = '';
    this.img.style.opacity = '0';
    await new Promise((resolve, reject) => {
      this.img.onload = resolve;
      this.img.onerror = () => reject(new Error('图片加载失败'));
      this.img.src = url;
    });
    this.img.style.opacity = '1';
    this._tx = 0;
    this._ty = 0;
    this.fit();
  }

  setZoom(r) {
    this.zoom = Math.min(Math.max(r, 0.05), 40);
    if (this.zoomRange) this.zoomRange.value = Math.round(this.zoom * 100);
    if (this.zoomVal) this.zoomVal.textContent = Math.round(this.zoom * 100) + '%';
    this._apply();
  }

  /** 适配窗口:按图片自然尺寸(考虑旋转后宽高互换)与容器比例缩放 */
  fit() {
    if (!this.img || !this.img.naturalWidth) return;
    this.fitMode = true;
    const cw = this.wrap.clientWidth;
    const ch = this.wrap.clientHeight;
    // 旋转 90/270 时图片的有效宽高互换
    const rotated = this.rotation % 180 !== 0;
    const iw = rotated ? this.img.naturalHeight : this.img.naturalWidth;
    const ih = rotated ? this.img.naturalWidth : this.img.naturalHeight;
    const s = Math.min(cw / iw, ch / ih, 1);
    this._tx = 0;
    this._ty = 0;
    this.setZoom(s);
  }

  setZoomUI(r) {
    this.fitMode = false;
    this.setZoom(r);
  }

  /** 顺时针旋转 90°(0/90/180/270);重置平移并重新适配窗口 */
  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    this._tx = 0;
    this._ty = 0;
    if (this.fitMode) this.fit();
    else this._apply();
  }

  /** 水平镜像(左右翻转) */
  flipH() {
    this.flipX = !this.flipX;
    this._apply();
  }

  /** 垂直镜像(上下翻转) */
  flipV() {
    this.flipY = !this.flipY;
    this._apply();
  }

  /** 重置视图:清除旋转/镜像,恢复适配窗口 */
  reset() {
    this.rotation = 0;
    this.flipX = false;
    this.flipY = false;
    this.fit();
  }

  /** 设置查看区背景色(与动画预览的背景色设置一致) */
  setBgColor(color) {
    const bgEl = this.wrap ? this.wrap.querySelector('.img-canvas-wrap') : null;
    if (bgEl) bgEl.style.background = color;
  }

  _apply() {
    if (!this.img) return;
    const sx = this.zoom * (this.flipX ? -1 : 1);
    const sy = this.zoom * (this.flipY ? -1 : 1);
    this.img.style.transform =
      `translate(${this._tx || 0}px, ${this._ty || 0}px) ` +
      `rotate(${this.rotation}deg) scale(${sx}, ${sy})`;
  }

  dispose() {
    this.wrap = null;
    this.img = null;
    this.zoomRange = null;
    this.zoomVal = null;
    this.statusEl = null;
    this._drag = null;
  }
}
