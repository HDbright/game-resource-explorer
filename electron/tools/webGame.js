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
const { WebContentsView, BrowserWindow, screen, session, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---- 网页悬浮窗位置/大小持久化(userData/webgame-float-state.json), 重启后恢复 ----
let floatStateTimer = null;
function loadFloatState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'webgame-float-state.json'), 'utf8')) || {};
  } catch (e) { return {}; }
}
function saveFloatState(state) {
  clearTimeout(floatStateTimer);
  floatStateTimer = setTimeout(() => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'webgame-float-state.json'), JSON.stringify(state)); } catch (e) { /* ignore */ }
  }, 300);
}

/** URL 规范化比较(忽略尾部斜杠与 hash; 用于"已打开相同网址则切换标签"判断) */
function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '');
  } catch (e) {
    return String(u || '').replace(/\/$/, '').trim();
  }
}

// 图片扩展名 → MIME(缩略图 data URL 用; content-type 常缺失或被 CDN 返回 text/plain)
const THUMB_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', tga: 'image/x-tga', astc: 'image/astc',
};

// ==================== 资源分类 ====================
// 扩展名优先(避免 URL 目录名如 /spine/ 干扰); spine-json 用内容特征由 probeFile 兜底
const EXT_TYPE = [
  [/\.skel(\?|$)/i, 'spine-skel'],
  [/\.sk(\?|$)/i, 'spine'], // 部分游戏用 .sk 表示 spine 骨骼数据(直接归 spine, 筛选/入库按 spine 处理)
  [/\.atlas(\.txt)?(\?|$)/i, 'spine-atlas'],
  [/\.fui(\?|$)/i, 'fgui'], // FGUI 包(.bin 保留 'bin', 由渲染端按同名 skel/atlas 分组判定 spine 或 fgui)
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
    this.view = null;      // 兼容字段(单 tab 时代的遗留, 现用 tabs)
    this.win = null;
    this.tabs = new Map(); // tabId -> { id, view, url, title, win }
    this.activeId = null;  // 当前活动 tabId
    this._tabSeq = 0;
    this._lastRect = null; // 浏览器视图矩形(给新 tab 用)
    this.floatWin = null;  // 网页悬浮窗(切到其它模块时承载浏览器视图)
    this._floated = false; // 是否处于悬浮状态
    this._floatMini = false;       // 悬浮窗是否处于迷你按钮模式
    this._floatRestoreBounds = null; // 迷你化前的悬浮窗矩形(还原用)
    this._floatTitleBarH = 32; // 悬浮窗标题栏高度(与 float-window.html 一致)
    this.records = new Map(); // url -> record
    this._pend = new Map();   // requestId -> {url, referrer, resourceType}
    this._hooked = false;
    this._seq = 0;
    this.ua = DEFAULT_UA;
    this.proxy = '';
  }

  /** 当前活动 tab */
  get active() {
    return this.activeId ? this.tabs.get(this.activeId) || null : null;
  }

  /** 创建新 tab(WebContentsView)并加入主窗口; 事件绑定与静音继承 */
  _createTab(win, url = '') {
    const id = 't' + (++this._tabSeq);
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:webgame',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    try { view.webContents.setAudioMuted(!!this._muted); } catch (e) { /* ignore */ }
    // 弹窗(登录跳转等)一律拒绝并改在当前视图内导航
    view.webContents.setWindowOpenHandler(({ url: u }) => {
      if (/^https?:/i.test(u)) view.webContents.loadURL(u);
      return { action: 'deny' };
    });
    // 页面状态 / 标题 / 导航 → 更新 tab 信息并推送
    view.webContents.on('render-process-gone', (_e, d) => {
      console.log('[webGame] render-process-gone', JSON.stringify(d));
    });
    view.webContents.on('did-start-loading', () => {
      console.log('[webGame] did-start-loading', view.webContents.getURL());
    });
    view.webContents.on('did-fail-load', (_e, code, desc, vUrl, isMain) => {
      console.log('[webGame] did-fail-load', { code, desc, url: vUrl, isMain });
    });
    view.webContents.on('did-finish-load', () => {
      console.log('[webGame] did-finish-load', view.webContents.getURL());
    });
    view.webContents.on('page-title-updated', (_e, title) => {
      const t = this.tabs.get(id);
      if (t) { t.title = title || ''; }
      this.emitTabs();
      this.emitStatus({ state: 'title', title });
    });
    view.webContents.on('did-start-loading', () => this.emitStatus({ state: 'loading' }));
    view.webContents.on('did-stop-loading', () => this.emitStatus({ state: 'idle' }));
    view.webContents.on('did-navigate', (_e, u) => {
      const t = this.tabs.get(id);
      if (t) t.url = u || t.url;
      this.emitTabs();
      this.emitStatus({ state: 'navigated', url: u || '' });
    });
    const tab = { id, view, url, title: '新标签', win: win || null };
    this.tabs.set(id, tab);
    if (win && !win.isDestroyed()) {
      try { win.contentView.addChildView(view); } catch (e) { /* ignore */ }
    }
    return tab;
  }

  /** 推送标签列表到渲染端 */
  emitTabs() {
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('web:tabs', { tabs: this.getTabs(), activeId: this.activeId }); } catch (e) { /* ignore */ }
    }
  }

  /** 仅活动 tab 显示在浏览器矩形, 其余 0×0 隐藏(WebContentsView 叠放约束); 悬浮时忽略(视图在悬浮窗内) */
  syncBounds(rect) {
    if (this._floated) return;
    if (rect) this._lastRect = rect;
    const r = this._lastRect || {};
    // ⚠ width/height 允许 0: 收藏夹面板等隐藏浏览器视图时传 0×0, 若 clamp 成 80 会出现左上角小窗
    const b = {
      x: Math.max(0, Math.round(r.x || 0)),
      y: Math.max(0, Math.round(r.y || 0)),
      width: Math.max(0, Math.round(r.width || 0)),
      height: Math.max(0, Math.round(r.height || 0)),
    };
    for (const t of this.tabs.values()) {
      try {
        t.view.setBounds(t.id === this.activeId ? b : { x: 0, y: 0, width: 0, height: 0 });
      } catch (e) { /* ignore */ }
    }
  }

  /** 打开/导航: 无活动 tab 则创建并加载; 已有则当前 tab 导航(地址栏语义) */
  open(win, url, opts = {}) {
    this.win = win;
    this.ua = opts.ua || this.ua;
    this.proxy = opts.proxy || this.proxy;
    this.hookWebRequest();
    let tab = this.active;
    if (!tab) {
      tab = this._createTab(win, url || '');
      this.activeId = tab.id;
      this.syncBounds();
      if (url) {
        console.log('[webGame] loadURL', url, 'destroyed=', tab.view.webContents.isDestroyed());
        tab.view.webContents.loadURL(url);
      }
    } else if (url) {
      console.log('[webGame] nav loadURL', url);
      tab.view.webContents.loadURL(url);
      tab.url = url;
    }
    this.emitTabs();
    this.emitStatus({ state: 'opened', url });
    return { ok: true, url, tabId: tab.id };
  }

  /** 新开标签页(收藏夹/侧栏打开网址用), 复用最近一次浏览器矩形 */
  newTab(url) {
    if (!this.win) return { ok: false, error: 'not opened' };
    const tab = this._createTab(this.win, url || '');
    this.activeId = tab.id;
    this.syncBounds();
    if (url) tab.view.webContents.loadURL(url);
    this.emitTabs();
    this.emitStatus({ state: 'opened', url });
    return { ok: true, tabId: tab.id, url };
  }

  /** 切换到指定标签 */
  switchTab(id) {
    if (!this.tabs.has(id)) return { ok: false, error: 'no tab' };
    this.activeId = id;
    this.syncBounds();
    const t = this.tabs.get(id);
    this.emitTabs();
    let u = '';
    try { u = t.view.webContents.getURL() || t.url; } catch (e) { u = t.url || ''; }
    this.emitStatus({ state: 'navigated', url: u });
    return { ok: true };
  }

  /** 关闭指定标签(活动标签被关则切到相邻标签) */
  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return { ok: false, error: 'no tab' };
    try {
      // 从 tab 当前所在窗口移除(可能在主窗口或悬浮窗)
      if (tab.win && !tab.win.isDestroyed()) tab.win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch (e) { /* ignore */ }
    this.tabs.delete(id);
    if (this.activeId === id) {
      const ids = Array.from(this.tabs.keys());
      this.activeId = ids.length ? ids[Math.max(0, ids.length - 1)] : null;
      if (this.activeId && !this._floated) this.syncBounds();
    }
    this.emitTabs();
    if (!this.tabs.size) this.emitStatus({ state: 'closed' });
    return { ok: true };
  }

  /** 当前活动标签的网址(收藏夹预填用) */
  getCurrentUrl() {
    const t = this.active;
    if (!t) return '';
    try { return t.view.webContents.getURL() || t.url; } catch (e) { return t.url || ''; }
  }

  getTabs() {
    return Array.from(this.tabs.values()).map((t) => ({ id: t.id, url: t.url || '', title: t.title || '' }));
  }

  // ==================== 网页悬浮窗(切到其它模块时承载浏览器视图) ====================
  // WebContentsView 是 native 视图, DOM 浮层盖不住; 用独立 BrowserWindow(frameless,
  // 标题栏 -webkit-app-region: drag) 承载视图 → 原生支持拖拽移动 / 最小化 / 关闭。
  // 位置/大小持久化到 userData/webgame-float-state.json, 重启后恢复。
  _ensureFloatWin() {
    if (this.floatWin && !this.floatWin.isDestroyed()) return this.floatWin;
    const st = loadFloatState();
    let fx = st.x, fy = st.y;
    // 恢复的位置若不在任何显示器可见区内(显示器变更), 回退默认左上角
    if (fx != null && fy != null) {
      const fw = st.width || 420, fh = st.height || 320;
      const visible = screen.getAllDisplays().some((d) => {
        const wa = d.workArea;
        return fx < wa.x + wa.width && fx + fw > wa.x && fy < wa.y + wa.height && fy + fh > wa.y;
      });
      if (!visible) { fx = undefined; fy = undefined; }
    }
    try {
      this.floatWin = new BrowserWindow({
        width: st.width || 420, height: st.height || 320,
        x: fx != null ? fx : 0, y: fy != null ? fy : 0,
        minWidth: 260, minHeight: 200,
        title: '网页悬浮窗', frame: false, resizable: true, alwaysOnTop: true,
        backgroundColor: '#17181d', show: false, autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, '../floatPreload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
    } catch (e) {
      this.floatWin = null;
      return null;
    }
    this.floatWin.loadFile(path.join(__dirname, '../../dist/float-window.html'));
    // 保存位置/大小(resize/move/关闭时; 节流写文件)
    const persist = () => {
      if (!this.floatWin || this.floatWin.isDestroyed()) return;
      const b = this.floatWin.getBounds();
      saveFloatState({ x: b.x, y: b.y, width: b.width, height: b.height });
    };
    this.floatWin.on('resize', () => {
      const t = this.active;
      if (this._floated && t) {
        try { t.view.setBounds(this._floatViewBounds()); } catch (e) { /* ignore */ }
      }
      persist();
    });
    this.floatWin.on('move', persist);
    this.floatWin.on('close', persist);
    this.floatWin.on('closed', () => {
      this.floatWin = null;
      this._floated = false;
    });
    return this.floatWin;
  }

  /** 悬浮窗内容区矩形(标题栏下方) */
  _floatViewBounds() {
    const w = this.floatWin;
    const [cw, ch] = w.getContentSize();
    return {
      x: 0, y: this._floatTitleBarH,
      width: Math.max(80, cw),
      height: Math.max(80, ch - this._floatTitleBarH),
    };
  }

  /** 把 tab 视图迁移到目标窗口(主窗口 ↔ 悬浮窗) */
  _moveView(tab, targetWin) {
    if (!tab || !tab.view || !targetWin || targetWin.isDestroyed()) return;
    try {
      if (tab.win && !tab.win.isDestroyed()) tab.win.contentView.removeChildView(tab.view);
    } catch (e) { /* ignore */ }
    try { targetWin.contentView.addChildView(tab.view); } catch (e) { /* ignore */ }
    tab.win = targetWin;
  }

  /** 切到其它模块: 活动标签视图迁移到悬浮窗并显示(可拖拽/最小化为迷你按钮/关闭为迷你按钮) */
  floatOut() {
    const t = this.active;
    if (!t || !this.win || this.win.isDestroyed()) return { ok: false, error: 'not opened' };
    // 若当前为迷你按钮模式, 先还原为正常悬浮窗
    if (this._floatMini) { try { this.floatRestore(); } catch (e) { /* ignore */ } }
    // 切离抓取页 → 暂停网页内媒体(参考 Chrome 后台标签页处理)
    this.pauseMedia();
    const fw = this._ensureFloatWin();
    if (!fw) return { ok: false, error: 'float window create failed' };
    if (!this._floated) {
      this._moveView(t, fw);
      try { t.view.setBounds(this._floatViewBounds()); } catch (e) { /* ignore */ }
      fw.show();
    }
    this._floated = true;
    // 推送标题到悬浮窗标题栏
    let title = t.title || '';
    try { title = t.view.webContents.getTitle() || title; } catch (e) { /* ignore */ }
    try { fw.webContents.send('float:info', { title: title || t.url || '网页悬浮窗' }); } catch (e) { /* ignore */ }
    this.emitStatus({ state: 'floated' });
    return { ok: true };
  }

  /** 回到网页抓取页: 活动标签视图迁回主窗口并隐藏悬浮窗 */
  floatBack() {
    if (!this._floated) return { ok: true };
    const t = this.active;
    if (t && this.win && !this.win.isDestroyed()) {
      this._moveView(t, this.win);
    }
    if (this.floatWin && !this.floatWin.isDestroyed()) this.floatWin.hide();
    this._floated = false;
    this._floatMini = false; // 迷你模式随悬浮模式一起复位
    if (t) this.syncBounds();
    this.emitTabs();
    this.emitStatus({ state: 'back' });
    return { ok: true };
  }

  /** 悬浮窗最小化 → 在原位置缩小为迷你按钮(仅「还原/关闭」两个按钮, 标题栏可拖拽) */
  floatMinimize() {
    return this._floatToMini();
  }

  /** 暂停活动标签页内的媒体播放(参考 Chrome 切走标签页时后台页媒体处理; 切离抓取页/关闭悬浮窗时调用) */
  pauseMedia() {
    const t = this.active;
    if (!t) return;
    try {
      t.view.webContents.executeJavaScript(
        '(()=>{try{document.querySelectorAll("video,audio").forEach((m)=>{if(!m.paused)m.pause()})}catch(e){}})()'
      ).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  /** 悬浮窗关闭 → 真正关闭悬浮窗: 网页视图迁回主窗口(隐藏, 避免残留左上角小窗)并销毁悬浮窗 */
  floatClose() {
    const t = this.active;
    if (t && this.win && !this.win.isDestroyed()) {
      this._moveView(t, this.win);
      // 主窗口当前不在网页抓取页 → 视图隐藏(0×0); 切回抓取页时 syncBounds 恢复显示
      try { t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (e) { /* ignore */ }
    }
    if (this.floatWin && !this.floatWin.isDestroyed()) this.floatWin.close(); // closed 事件置 null
    this._floated = false;
    this._floatMini = false;
    this.pauseMedia();
    this.emitTabs();
    this.emitStatus({ state: 'back' });
    return { ok: true };
  }

  /** 收起为迷你按钮: 保持悬浮窗当前位置(居中缩小为 64×32), 只保留「还原/关闭」按钮 */
  _floatToMini() {
    const fw = this.floatWin;
    if (!fw || fw.isDestroyed()) return { ok: false, error: 'no float window' };
    if (this._floatMini) return { ok: true };
    const b = fw.getBounds();
    this._floatRestoreBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    const mx = b.x + Math.round((b.width - 64) / 2);
    const my = b.y + Math.round((b.height - 32) / 2);
    fw.setBounds({ x: mx, y: my, width: 64, height: 32 });
    this._floatMini = true;
    try { fw.webContents.send('float:mode', { mini: true }); } catch (e) { /* ignore */ }
    this.emitStatus({ state: 'floated-mini' });
    return { ok: true };
  }

  /** 迷你按钮 → 还原为上次悬浮窗大小/位置 */
  floatRestore() {
    const fw = this.floatWin;
    if (!fw || fw.isDestroyed()) return { ok: false, error: 'no float window' };
    if (!this._floatMini) return { ok: true };
    const rb = this._floatRestoreBounds;
    if (rb) fw.setBounds(rb);
    this._floatMini = false;
    try { fw.webContents.send('float:mode', { mini: false }); } catch (e) { /* ignore */ }
    // 还原后同步网页视图到内容区
    const t = this.active;
    if (t) { try { t.view.setBounds(this._floatViewBounds()); } catch (e) { /* ignore */ } }
    this.emitStatus({ state: 'floated' });
    return { ok: true };
  }

  /** 迷你按钮拖拽移动(dx/dy 为相对增量) */
  floatMiniMoveBy(dx, dy) {
    const fw = this.floatWin;
    if (!fw || fw.isDestroyed() || !this._floatMini) return { ok: false };
    const b = fw.getBounds();
    fw.setPosition(b.x + Math.round(dx), b.y + Math.round(dy));
    return { ok: true };
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

  emitStatus(payload) {
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('web:status', payload); } catch (e) { /* ignore */ }
    }
  }

  setBounds(rect) {
    if (!this.active) return { ok: false, error: 'not opened' };
    if (this._floated) this.floatBack(); // 回到网页抓取页布局(悬浮窗让位)
    this.syncBounds(rect);
    return { ok: true };
  }

  navigate(url) {
    const t = this.active;
    if (!t) return { ok: false, error: 'not opened' };
    t.view.webContents.loadURL(url);
    t.url = url;
    this.emitTabs();
    return { ok: true };
  }

  /** 打开网址: 已打开相同 URL 的标签页 → 切换过去(不新开); 否则新开标签页(收藏夹/侧栏点击) */
  openOrSwitch(url) {
    if (!url) return { ok: false, error: 'no url' };
    for (const t of this.tabs.values()) {
      let cur = t.url;
      try { cur = t.view.webContents.getURL() || t.url; } catch (e) { /* ignore */ }
      if (cur && normUrl(cur) === normUrl(url)) {
        this.activeId = t.id;
        this.syncBounds();
        this.emitTabs();
        this.emitStatus({ state: 'navigated', url: cur });
        return { ok: true, switched: true, tabId: t.id, url: cur };
      }
    }
    return this.newTab(url); // 未打开 → 新开
  }

  goBack() { const t = this.active; return t ? (t.view.webContents.navigationHistory.goBack(), { ok: true }) : { ok: false, error: 'not opened' }; }
  goForward() { const t = this.active; return t ? (t.view.webContents.navigationHistory.goForward(), { ok: true }) : { ok: false, error: 'not opened' }; }
  reload() { const t = this.active; return t ? (t.view.webContents.reload(), { ok: true }) : { ok: false, error: 'not opened' }; }

  /**
   * 一键静音 / 取消禁音网页音频。
   * 记录 _muted 状态, 新打开的网页也会继承该状态。
   */
  setAudioMuted(muted) {
    this._muted = !!muted;
    const t = this.active;
    if (!t) return { ok: false, error: 'not opened', muted: this._muted };
    try {
      t.view.webContents.setAudioMuted(this._muted);
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
    const t = this.active;
    if (!t) return { ok: false, error: 'not opened' };
    try {
      t.view.webContents.openDevTools({ mode: 'detach', activate: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** 关闭 DevTools */
  closeDevTools() {
    const t = this.active;
    if (!t) return { ok: false, error: 'not opened' };
    try {
      t.view.webContents.closeDevTools();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** 关闭全部标签(保留 session 与捕获记录); 窗口销毁时彻底清理 */
  close() {
    const ids = Array.from(this.tabs.keys());
    for (const id of ids) this.closeTab(id);
    this.activeId = null;
    return { ok: true };
  }

  getCaptured() {
    return Array.from(this.records.values()).sort((a, b) => a.ts - b.ts);
  }

  clearCaptured() {
    this.records.clear();
    this._seq = 0;
    return { ok: true };
  }

  /**
   * 用网页会话(persist:webgame)下载资源并转 data URL —— 与网页共享 cookie/登录态/Referer,
   * 供渲染端图片缩略图兜底(直连 <img> 因跨 session 无登录态/防盗链 403 时使用)。
   * @param {{url:string, referrer?:string, maxBytes?:number}} args
   * @returns {Promise<{ok:true, dataUrl:string, size:number, mime:string}|{ok:false, error:string}>}
   */
  async fetchToDataUrl({ url, referrer = '', maxBytes } = {}) {
    if (!url) return { ok: false, error: '缺少 url' };
    const limit = Math.min(Number(maxBytes) || 4 * 1024 * 1024, 8 * 1024 * 1024);
    try {
      const res = await this.ses.fetch(url, {
        credentials: 'include',
        headers: { referer: referrer || url, 'User-Agent': this.ua, accept: 'image/*,*/*' },
      });
      if (!res.ok) {
        try { await (res.body && res.body.cancel && res.body.cancel()); } catch (e) { /* ignore */ }
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const contentType = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > limit) return { ok: false, error: '资源过大' };
      const extMime = THUMB_MIME[(url.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()];
      const mime = extMime || contentType.split(';')[0].trim() || 'application/octet-stream';
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length, mime };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  destroy() {
    try {
      this.close();
      for (const t of this.tabs.values()) {
        try { t.view.webContents.close(); } catch (e) { /* ignore */ }
      }
      this.tabs.clear();
      if (this.floatWin && !this.floatWin.isDestroyed()) {
        try { this.floatWin.destroy(); } catch (e) { /* ignore */ }
      }
      this.floatWin = null;
    } catch (e) { /* ignore */ }
    this.win = null;
    this.activeId = null;
    this._floated = false;
  }
}

// 单例
const webGame = new WebGameView();

module.exports = { webGame, WebGameView, classify, downloadResource, probeFile, typeDir, fileNameFromUrl, safeName };
