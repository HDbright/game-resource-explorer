'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tga': 'image/x-tga',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.skel': 'application/octet-stream',
  '.dbbin': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  // 音频(音频播放器拖动进度需要 Range 支持)
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.m4a': 'audio/mp4',
  // 视频(视频播放器拖动进度需要 Range 支持;可播放性取决于 Chromium 内置编解码)
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
};

const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.wma', '.m4a', '.aac', '.opus'];

/**
 * 内部 HTTP 服务:
 * - `/`、`/index.html`、`/assets/*` → 渲染端构建产物(dist)
 * - `/a/<itemId>/<相对路径>` → 某个动画条目根目录下的资源(用于加载骨骼/贴图)
 * - `/spine-pv/<token>/<相对路径>` → Spine 转换工具预览目录(spine-converter 注册)
 * - `/afile?p=<绝对路径>` → 任意音频文件(播放列表/后台播放,仅音频扩展名)
 */
function createServer({ dist, roots, previewRoots }) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(u.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      if (pathname === '/') pathname = '/index.html';

      if (pathname.startsWith('/a/')) {
        const rest = pathname.slice(3); // "<itemId>/<rel>"
        const slash = rest.indexOf('/');
        if (slash < 0) return send(res, 404, 'Not Found');
        const id = rest.slice(0, slash);
        const rel = rest.slice(slash + 1);
        if (!id || !rel) return send(res, 404, 'Not Found');
        const root = roots().get(id);
        if (!root) return send(res, 404, 'Item Not Found');
        const rootNorm = path.resolve(root);
        const full = path.resolve(rootNorm, rel);
        // 防目录穿越:必须位于该条目根目录之内
        if (full !== rootNorm && !full.startsWith(rootNorm + path.sep)) {
          return send(res, 403, 'Forbidden');
        }
        return serveFile(req, res, full);
      }

      // Spine 转换工具预览目录:token 由 tool:spinePreviewRegister 注册
      if (pathname.startsWith('/spine-pv/')) {
        const rest = pathname.slice(10); // "<token>/<rel>"
        const slash = rest.indexOf('/');
        if (slash < 0) return send(res, 404, 'Not Found');
        const token = rest.slice(0, slash);
        const rel = rest.slice(slash + 1);
        if (!token || !rel) return send(res, 404, 'Not Found');
        const root = previewRoots && previewRoots().get(token);
        if (!root) return send(res, 404, 'Preview Not Found');
        const rootNorm = path.resolve(root);
        const full = path.resolve(rootNorm, rel);
        if (full !== rootNorm && !full.startsWith(rootNorm + path.sep)) {
          return send(res, 403, 'Forbidden');
        }
        return serveFile(req, res, full);
      }

      // 通用音频文件服务(播放列表 / 后台播放):?p=绝对路径,仅允许音频扩展名
      if (pathname === '/afile') {
        const p = u.searchParams.get('p');
        if (!p) return send(res, 400, 'Bad Request');
        const ext = path.extname(p).toLowerCase();
        if (!AUDIO_EXTS.includes(ext)) return send(res, 403, 'Forbidden');
        return serveFile(req, res, p);
      }

      // 静态资源(dist)
      const file = path.join(dist, pathname);
      return serveFile(req, res, file);
    } catch (err) {
      console.error('[server]', err);
      send(res, 500, 'Internal Error');
    }
  });

  // 固定端口: 保证渲染端 origin(含端口)稳定 → localStorage 按 origin 隔离的持久化状态
  // (悬浮预览开关/仅下载不入库/类型筛选/搜索词/侧栏隐藏/音频模式等)重启后能恢复。
  // 端口被占用时递增重试(最多 30 次), 冲突时该次会话 localStorage 不跨启动保留, 罕见可接受。
  const BASE_PORT = 13456;
  const ready = new Promise((resolve, reject) => {
    const tryListen = (port, attempt) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && attempt < 30) {
          tryListen(port + 1, attempt + 1);
        } else {
          reject(e);
        }
      });
      server.listen(port, '127.0.0.1', () => resolve(server.address().port));
    };
    tryListen(BASE_PORT, 0);
  });

  return {
    url: ready.then((port) => `http://127.0.0.1:${port}`),
    ready,
    close: () => new Promise((r) => server.close(r)),
  };
}

function serveFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not Found');
  const ext = path.extname(file).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  // .ico 浏览器无法直接渲染 → 用 nativeImage 转 PNG 返回(资源浏览/预览图标格式支持)
  if (ext === '.ico') {
    try {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) {
        const buf = img.toPNG();
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-cache' });
        return res.end(buf);
      }
    } catch (e) { /* 降级:按原文件返回 */ }
  }
  const stat = fs.statSync(file);
  const total = stat.size;

  // Range 支持(音频拖动进度 / 大文件分段)
  const range = req.headers && req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? total - parseInt(m[2], 10) : parseInt(m[1], 10);
      let end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
      if (isNaN(start) || isNaN(end) || start < 0 || end >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Length': total });
  fs.createReadStream(file).pipe(res);
}

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

module.exports = { createServer };
