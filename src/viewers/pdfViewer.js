// ============ PDF 文档预览控制器 ============
// Chromium 内置 PDF 渲染器经 iframe 嵌入,原生翻页/缩放/打印/下载/搜索全功能。
// 复用内部 HTTP 服务器 /pdf-pv/<token>/ 路由同源加载,避免 file:// 被 webSecurity 拦截。

function dirOf(p) { return String(p || '').replace(/[\\/][^\\/]*$/, ''); }
function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }

export class PdfViewerController {
  constructor() {
    this.wrap = null;
    this.frame = null;
    this.previewToken = null;
    this.currentFilePath = null;
  }

  /** 初始化:仅绑定 iframe 引用(路径/打开目录由预览页顶栏统一处理,避免功能重复) */
  init(wrap) {
    this.wrap = wrap;
    this.frame = wrap.querySelector('#pdf-frame');
  }

  /** 加载并预览 PDF 文件 */
  async load(filePath) {
    if (!this.wrap || !this.frame) return;
    this.currentFilePath = filePath;
    // 注销旧的预览目录
    await this._unregister();
    const dir = dirOf(filePath);
    if (!dir) { this._setError('无法获取文件目录'); return; }
    // 注册新目录,获取 token
    try {
      const res = await window.api.pdfPreviewRegister({ dir });
      if (res && res.ok && res.token) {
        this.previewToken = res.token;
        const origin = (location && location.origin) || '';
        const base = origin ? origin + '/pdf-pv/' + this.previewToken + '/' : '';
        const url = base + encodeURIComponent(baseName(filePath));
        this.frame.src = url;
      } else {
        this._setError('PDF 预览注册失败: ' + ((res && res.error) || '未知错误'));
      }
    } catch (err) {
      this._setError('PDF 预览注册异常: ' + err.message);
    }
  }

  /** 清理:注销预览资源(切换文件/关闭预览时调用) */
  async dispose() {
    this.currentFilePath = null;
    if (this.frame) this.frame.src = 'about:blank';
    await this._unregister();
  }

  async _unregister() {
    if (this.previewToken) {
      try { await window.api.pdfPreviewUnregister({ token: this.previewToken }); } catch (e) { /* ignore */ }
      this.previewToken = null;
    }
  }

  _setError(msg) {
    if (this.frame) {
      this.frame.srcdoc = '<html><body style="font-family:sans-serif;padding:40px;color:#888"><h3>PDF 预览不可用</h3><p>' + msg + '</p></body></html>';
    }
  }
}
