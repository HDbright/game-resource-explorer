'use strict';
/**
 * 网页游戏逆向分析与资源抓取 —— 主进程模块。
 * - WebGameView: 用 WebContentsView(替代已废弃 BrowserView) 内嵌网页游戏到主窗口,
 *   独立分区 session(persist:webgame) 持登录态, 不污染应用默认 session。
 * - hookWebRequest: 拦截 session 内所有帧(含 iframe)的网络请求,
 *   onBeforeRequest(存 url/referrer/resourceType) + onHeadersReceived(补 statusCode/length/type)
 *   共享 details.id, 分类后经 win.webContents.send('web:captured') 推送到渲染端。
 * - downloadResource: 主进程 https 下载(rejectUnauthorized:false + Referer/UA + 可选代理 + 进度节流),
 *   渲染端受 CSP(connect-src 'self') 限制不能直接 fetch 外网, 一切下载走这里。
 * - probeFile: 下载后本地探测(.bin 魔数 FGUII / spine json 特征) 用于精确分类。
 */
const { WebContentsView, session } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ==================== 资源分类 ====================
// 扩展名优先(避免 URL 目录名如 /spine/ 干扰); spine-json 用内容特征由 probeFile 兜底
const EXT_TYPE = [
  [/\.skel(\?|$)/i, 'spine-skel'],
  [/\.atlas(\.txt)?(\?|$)/i, 'spine-atlas'],
  [/\.bin(\?|$)/i, 'bin'],
  [/\.(png|jpe?g|webp|gif|bmp|astc|tga|ktx2?)(\?|$)/i, 'image'],
  [/\.(mp3|ogg|wav|m4a|flac|aac|opus)(\?|$)/i, 'audio'],
  [/\.(mp4|webm|mov|m4v)(\?|$)/i, 'video'],
  [/\.(ttf|woff2?|otf|eot)(\?|$)/i, 'font'],
  [/\.(js|mjs|html?|css)(\?|$)/i, 'script'],
  [/\.(json|txt|xml|plist|csv|yaml|yml)(\?|$)/i, 'config'],
];

/**
 * 按 URL 扩展名 + content-type 分类资源。
 * @returns {string} fgui|spine|spine-atlas|image|audio|video|font|script|config|other
 */
function classify(url, mime) {
  for (const [re, type] of EXT_TYPE) {
    if (re.test(url)) return type;
  }
  if (mime) {
    if (/application\/octet-stream/i.test(mime)) return 'bin';
    if (/^image\//i.test(mime)) return 'image';
    if (/^audio\//i.test(mime)) return 'audio';
    if (/^video\//i.test(mime)) return 'video';
    if (/^font\//i.test(mime)) return 'font';
    if (/json/i.test(mime)) return 'config';
    if (/javascript|ecmascript/i.test(mime)) return 'script';
    if (/text\/html/i.test(mime)) return 'script';
  }
  return 'other';
}

/** 扩展名 → 对应下载目录子名 */
function typeDir(type) {
  if (type === 'spine-skel' || type === 'spine-json') return 'spine';
  if (type === 'spine-atlas') return 'spine';
  if (type === 'bin') return 'fgui';
  return type;
}

/** 从 URL 提取文件名(去 query/hash), 空则回退主机名 */
function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = path.basename(decodeURIComponent(u.pathname));
    return base || (u.hostname || 'index');
  } catch (e) {
    const m = url.split(/[?#]/)[0].split('/').pop();
    return m || 'index';
  }
}

/** 安全文件名(非法字符 → _) */
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'file';
}

// ==================== 本地探测 ====================
/**
 * 探测本地文件真实类型(.bin 魔数 FGUII / spine json 特征)。
 * @returns {Promise<string>} 'fgui' | 'spine' | null
 */
function probeFile(p) {
  return new Promise((resolve) => {
    try {
      const ext = path.extname(p).toLowerCase();
      if (ext === '.bin') {
        const fd = fs.openSync(p, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        resolve(buf.readUInt32BE(0) === 0x46475549 ? 'fgui' : 'bin');
        return;
      }
      if (ext === '.json') {
        const head = fs.readFileSync(p, 'utf8').slice(0, 4000);
        if (/\b(skeleton|skins|bones|animations)\b/.test(head)) resolve('spine');
        else resolve('config');
        return;
      }
      resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// ==================== 下载 ====================
/**
 * 下载单个资源(主进程, 绕过渲染端 CSP)。
 * @param {{url:string, referrer?:string, ua?:string, proxy?:string}} opts
 * @param {string} savePath 保存绝对路径
 * @param {(p:{url:string,got:number,total:number,percent:number})=>void} [onProgress] 进度回调(节流由调用方控制)
 */
function downloadResource(opts, savePath, onProgress) {
  const { url, referrer = '', ua = DEFAULT_UA, proxy } = opts;
  const mod = url.startsWith('https:') ? https : http;
  let agent = null;
  if (proxy) {
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      const { HttpProxyAgent } = require('http-proxy-agent');
      agent = url.startsWith('https:') ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
    } catch (e) { agent = null; }
  }
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(path.dirname(savePath), { recursive: true }).then(() => {
      const req = mod.request(url, {
        method: 'GET',
        rejectUnauthorized: false,
        agent,
        headers: {
          Referer: referrer || url,
          'User-Agent': ua,
          Accept: '*/*',
        },
      }, (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        const ws = fs.createWriteStream(savePath);
        let got = 0;
        res.on('data', (c) => {
          got += c.length;
          if (onProgress) onProgress({ url, got, total, percent: total ? Math.min(100, Math.round((got / total) * 100)) : 0 });
        });
        res.pipe(ws);
        ws.on('finish', () => resolve({ ok: true, path: savePath, size: got, mime: res.headers['content-type'] || '' }));
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}

// ==================== WebGameView ====================
class WebGameView {
  constructor() {
    this.view = null;
    this.win = null;
    this.records = new Map(); // url -> record
    this._pend = new Map();   // requestId -> {url, referrer, resourceType}
    this._hooked = false;
    this._seq = 0;
    this.ua = DEFAULT_UA;
    this.proxy = '';
  }

  /** 惰性获取分区 session(必须在 app ready 之后, 单例创建于模块加载时) */
  get ses() {
    if (!this._ses) this._ses = session.fromPartition('persist:webgame');
    return this._ses;
  }

  hookWebRequest() {
    if (this._hooked) return;
    this._hooked = true;
    // 请求发出前记录 url/referrer(与 onHeadersReceived 共享 details.id)
    this.ses.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/i.test(details.url)) {
        this._pend.set(details.id, {
          url: details.url,
          referrer: details.referrer || '',
          resourceType: details.resourceType || '',
        });
      }
      callback({});
    });
    // 收到响应头: 拿到 statusCode/content-length/content-type → 分类 → 推送
    this.ses.webRequest.onHeadersReceived((details, callback) => {
      const p = this._pend.get(details.id);
      if (p) {
        this._pend.delete(details.id);
        if (details.statusCode >= 200 && details.statusCode < 400) {
          this.record({
            url: p.url,
            referrer: p.referrer,
            resourceType: p.resourceType,
            statusCode: details.statusCode,
            length: details.responseHeaders ? Number((details.responseHeaders['content-length'] || [''])[0] || 0) : 0,
            mime: details.responseHeaders ? ((details.responseHeaders['content-type'] || [''])[0] || '').split(';')[0] : '',
          });
        }
      }
      callback({});
    });
  }

  /** 记录一条捕获(按 url 去重, 重复加载递增 count) */
  record({ url, referrer, resourceType, statusCode, length, mime }) {
    const type = classify(url, mime);
    const existing = this.records.get(url);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.size = length || existing.size;
      this.push(existing);
      return;
    }
    const rec = {
      id: ++this._seq,
      url,
      host: (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })(),
      type,
      mime: mime || '',
      size: length || 0,
      statusCode: statusCode || 0,
      referrer: referrer || '',
      resourceType: resourceType || '',
      ts: Date.now(),
      count: 1,
      downloaded: false,
      path: null,
    };
    this.records.set(url, rec);
    this.push(rec);
  }

  push(rec) {
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('web:captured', rec); } catch (e) { /* ignore */ }
    }
  }

  open(win, url, opts = {}) {
    this.win = win;
    this.ua = opts.ua || this.ua;
    this.proxy = opts.proxy || this.proxy;
    this.hookWebRequest();
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: {
          partition: 'persist:webgame',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      // 继承静音状态(打开前若已点静音, 新页面保持静音)
      try { this.view.webContents.setAudioMuted(!!this._muted); } catch (e) { /* ignore */ }
      // 弹窗(登录跳转等)一律拒绝并改在当前视图内导航
      this.view.webContents.setWindowOpenHandler(({ url: u }) => {
        if (/^https?:/i.test(u)) this.view.webContents.loadURL(u);
        return { action: 'deny' };
      });
      // 页面状态(标题/加载状态)推送
      this.view.webContents.on('page-title-updated', (e, title) => {
        this.emitStatus({ state: 'title', title });
      });
      this.view.webContents.on('did-start-loading', () => this.emitStatus({ state: 'loading' }));
      this.view.webContents.on('did-stop-loading', () => this.emitStatus({ state: 'idle' }));
      this.view.webContents.on('did-navigate', (e, u) => this.emitStatus({ state: 'navigated', url: u }));
      win.contentView.addChildView(this.view);
    }
    if (url) this.view.webContents.loadURL(url);
    this.emitStatus({ state: 'opened', url });
    return { ok: true, url };
  }

  emitStatus(payload) {
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('web:status', payload); } catch (e) { /* ignore */ }
    }
  }

  setBounds(rect) {
    if (!this.view) return { ok: false, error: 'not opened' };
    const r = rect || {};
    this.view.setBounds({
      x: Math.round(r.x || 0),
      y: Math.round(r.y || 0),
      width: Math.max(80, Math.round(r.width || 0)),
      height: Math.max(80, Math.round(r.height || 0)),
    });
    return { ok: true };
  }

  navigate(url) {
    if (!this.view) return { ok: false, error: 'not opened' };
    this.view.webContents.loadURL(url);
    return { ok: true };
  }

  goBack() { return this.view ? (this.view.webContents.navigationHistory.goBack(), { ok: true }) : { ok: false, error: 'not opened' }; }
  goForward() { return this.view ? (this.view.webContents.navigationHistory.goForward(), { ok: true }) : { ok: false, error: 'not opened' }; }
  reload() { return this.view ? (this.view.webContents.reload(), { ok: true }) : { ok: false, error: 'not opened' }; }

  /**
   * 一键静音 / 取消禁音网页音频。
   * 记录 _muted 状态, 新打开的网页也会继承该状态。
   */
  setAudioMuted(muted) {
    this._muted = !!muted;
    if (!this.view) return { ok: false, error: 'not opened', muted: this._muted };
    try {
      this.view.webContents.setAudioMuted(this._muted);
      return { ok: true, muted: this._muted };
    } catch (err) {
      return { ok: false, error: err.message, muted: this._muted };
    }
  }

  /**
   * 打开 DevTools(mode:'detach' 独立窗口, 便于观察网页网络/控制台)。
   * 重复调用: 已打开则聚焦(activate), 未打开则新建。
   */
  openDevTools() {
    if (!this.view) return { ok: false, error: 'not opened' };
    try {
      this.view.webContents.openDevTools({ mode: 'detach', activate: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** 关闭 DevTools */
  closeDevTools() {
    if (!this.view) return { ok: false, error: 'not opened' };
    try {
      this.view.webContents.closeDevTools();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** 从主窗口移除视图(保留 session 与捕获记录); 窗口销毁时彻底清理 */
  close() {
    if (this.view && this.win && !this.win.isDestroyed()) {
      try { this.win.contentView.removeChildView(this.view); } catch (e) { /* ignore */ }
    }
  }

  getCaptured() {
    return Array.from(this.records.values()).sort((a, b) => a.ts - b.ts);
  }

  clearCaptured() {
    this.records.clear();
    this._seq = 0;
    return { ok: true };
  }

  destroy() {
    try {
      this.close();
      if (this.view) {
        this.view.webContents.close();
        this.view = null;
      }
    } catch (e) { /* ignore */ }
    this.win = null;
  }
}

// 单例
const webGame = new WebGameView();

module.exports = { webGame, WebGameView, classify, downloadResource, probeFile, typeDir, fileNameFromUrl, safeName };
