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

  /** 适配窗口:按图片自然尺寸与容器比例缩放 */
  fit() {
    if (!this.img || !this.img.naturalWidth) return;
    this.fitMode = true;
    const cw = this.wrap.clientWidth;
    const ch = this.wrap.clientHeight;
    const s = Math.min(cw / this.img.naturalWidth, ch / this.img.naturalHeight, 1);
    this._tx = 0;
    this._ty = 0;
    this.setZoom(s);
  }

  setZoomUI(r) {
    this.fitMode = false;
    this.setZoom(r);
  }

  _apply() {
    if (!this.img) return;
    this.img.style.transform = `translate(${this._tx || 0}px, ${this._ty || 0}px) scale(${this.zoom})`;
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
