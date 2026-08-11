'use strict';
/**
 * 开发工具箱 - API 管理: 接口测试(主进程发送 HTTP 请求)。
 * 渲染端 CSP(connect-src 'self')无法直连外部, 由主进程代发。
 * 支持: 任意方法 / 自定义请求头 / 请求体 / 超时 / 可选代理 / 自签证书(rejectUnauthorized:false) / 跟随重定向(≤5 次)。
 */
const http = require('http');
const https = require('https');

const MAX_BODY = 2 * 1024 * 1024; // 响应体截断上限 2MB

/** 请求头数组 [{name,value}] → 对象(跳过空名) */
function normalizeHeaders(arr) {
  const out = {};
  for (const h of arr || []) {
    const name = String((h && h.name) || '').trim();
    if (!name) continue;
    out[name] = String(h.value == null ? '' : h.value);
  }
  return out;
}

function requestOnce({ method, url, headers, body, timeout, proxy, redirects }) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    let agent = null;
    if (proxy) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        const { HttpProxyAgent } = require('http-proxy-agent');
        agent = url.startsWith('https:') ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
      } catch (e) { agent = null; }
    }
    const started = Date.now();
    const req = mod.request(url, {
      method: method || 'GET',
      rejectUnauthorized: false,
      agent,
      headers,
    }, (res) => {
      // 重定向(301/302/303/307/308): 跟随新地址继续
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        try {
          resolve({ redirect: new URL(res.headers.location, url).toString() });
        } catch (e) {
          resolve({ redirect: res.headers.location });
        }
        return;
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          truncated = true;
          res.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        statusText: res.statusMessage || '',
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf8'),
        truncated,
        size,
        timeMs: Date.now() - started,
      }));
      res.on('error', reject);
    });
    req.setTimeout(timeout || 15000, () => {
      req.destroy(new Error(`请求超时(>${timeout || 15000}ms)`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** API 接口测试入口: 发送请求返回响应(自动跟随重定向 ≤5 次) */
async function apiTest({ method, url, headers, body, timeout, proxy }) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'URL 无效(须以 http:// 或 https:// 开头)' };
  let cur = url;
  let redirects = 0;
  const hdrs = normalizeHeaders(headers);
  if (body && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
  const sendBody = (method && method !== 'GET' && method !== 'HEAD') ? (body || '') : undefined;
  if (sendBody) hdrs['Content-Length'] = Buffer.byteLength(sendBody);
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const r = await requestOnce({ method, url: cur, headers: hdrs, body: sendBody, timeout, proxy, redirects });
    if (r.redirect) {
      redirects += 1;
      cur = r.redirect;
      continue;
    }
    return { ok: true, ...r, redirected: redirects };
  }
}

module.exports = { apiTest };
