'use strict';
// ================= 项目管理中心:服务进程启停 + 运行状态探测(补丁·113) =================
// 由主进程持有各项目的服务子进程(前端/后端/一键启动),渲染端通过 IPC 触发启停与状态查询。
// - 进程表:key = `${projectId}:${kind}`(kind: 'all' | 'frontend' | 'backend')
// - 停止:Windows 用 taskkill /T /F 杀整棵进程树;非 Windows SIGTERM → SIGKILL 兜底
// - 状态:进程存活优先;进程表无记录时回退 HTTP(S) 健康探测(端口可达即视为运行中,
//   支持应用重启后自动识别仍在运行的旧服务)
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

const running = new Map(); // key -> { pid, kind, startedAt, cmd, cwd, child }

const key = (projectId, kind) => `${projectId}:${kind}`;

function isProcAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

/** HTTP(S) 健康探测:短超时,任何响应(含 4xx/5xx)都视为端口有服务 */
function probeUrl(url, timeoutMs = 1800) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(String(url || '').trim()); } catch (e) { return resolve(false); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve(false);
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = lib.get(u, { timeout: timeoutMs, headers: { 'User-Agent': 'game-resource-explorer' } }, (res) => {
        try { res.resume(); } catch (_) { /* ignore */ }
        finish(true);
      });
      req.on('timeout', () => { try { req.destroy(); } catch (_) { /* ignore */ } finish(false); });
      req.on('error', () => finish(false));
    } catch (e) {
      finish(false);
    }
  });
}

function killProc(rec) {
  if (!rec || !rec.pid) return;
  const pid = rec.pid;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref();
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch (_) { /* ignore */ }
      setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* ignore */ } }, 3000);
    }
  } catch (e) { /* ignore */ }
}

/**
 * 启动一个服务进程。
 * @param {string} projectId 项目 id
 * @param {'all'|'frontend'|'backend'} kind 服务类型
 * @param {string} cmd 启动命令(经 shell 执行:npm/java/bash 均可)
 * @param {string} cwd 工作目录(项目根路径)
 */
function startProc(projectId, kind, cmd, cwd) {
  const k = key(projectId, kind);
  const old = running.get(k);
  if (old) { killProc(old); running.delete(k); }
  return new Promise((resolve) => {
    try {
      const opts = {
        cwd: cwd || undefined,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      const child = process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', String(cmd)], opts)
        : spawn('sh', ['-c', String(cmd)], opts);
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d.toString('utf8'); if (out.length > 4000) out = out.slice(-4000); });
      child.stderr.on('data', (d) => { err += d.toString('utf8'); if (err.length > 4000) err = err.slice(-4000); });
      child.on('error', (e) => resolve({ ok: false, error: '启动失败: ' + e.message }));
      child.once('spawn', () => {
        const rec = { pid: child.pid, kind, startedAt: Date.now(), cmd, cwd, child };
        running.set(k, rec);
        resolve({ ok: true, pid: child.pid });
      });
      child.on('close', (code) => {
        // 进程退出(被停止或异常退出)→ 从登记表移除
        const rec = running.get(k);
        if (rec && rec.child === child) running.delete(k);
        resolve({ ok: false, error: `进程已退出(code=${code})${(err || out).trim() ? '\n' + (err || out).trim().slice(0, 400) : ''}` });
      });
    } catch (e) {
      resolve({ ok: false, error: '启动失败: ' + e.message });
    }
  });
}

/** 停止服务进程(不存在则返回 stopped:false) */
function stopProc(projectId, kind) {
  const k = key(projectId, kind);
  const rec = running.get(k);
  if (rec) {
    killProc(rec);
    running.delete(k);
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
}

/** 停止某项目全部服务(all + frontend + backend) */
function stopAllProcs(projectId) {
  const res = [];
  for (const kind of ['all', 'frontend', 'backend']) res.push(stopProc(projectId, kind));
  return { ok: true, stopped: res.some((r) => r.stopped) };
}

/** 停止全部项目服务(应用退出时调用) */
function stopEveryProc() {
  for (const k of [...running.keys()]) {
    const rec = running.get(k);
    if (rec) killProc(rec);
  }
  running.clear();
}

/**
 * 查询一组项目的运行状态(并发探测,缩短总耗时)。
 * specs: [{ projectId, accessUrl, frontendUrl, backendUrl }]
 * 返回: { [projectId]: { all, frontend, backend, procs: {all,frontend,backend} } }
 */
async function queryStatus(specs) {
  const out = {};
  const tasks = (specs || []).map(async (s) => {
    if (!s || !s.projectId) return;
    const p = s.projectId;
    const alive = (kind) => {
      const rec = running.get(key(p, kind));
      return rec && isProcAlive(rec.pid) ? rec.pid : null;
    };
    const allPid = alive('all');
    const fePid = alive('frontend');
    const bePid = alive('backend');
    // 进程表没有时用 URL 兜底探测
    const [allUrl, feUrl, beUrl] = await Promise.all([
      allPid ? null : (s.accessUrl ? probeUrl(s.accessUrl) : false),
      fePid ? null : (s.frontendUrl ? probeUrl(s.frontendUrl) : false),
      bePid ? null : (s.backendUrl ? probeUrl(s.backendUrl) : false),
    ]);
    out[p] = {
      all: !!allPid || !!allUrl,
      frontend: !!fePid || !!feUrl,
      backend: !!bePid || !!beUrl,
      procs: { all: allPid, frontend: fePid, backend: bePid },
    };
  });
  await Promise.all(tasks);
  return out;
}

/** 注册 IPC(由 main.js 在 app ready 后调用) */
function registerProjectIpc(ipcMain) {
  ipcMain.handle('projects:start', async (_e, args = {}) => {
    try {
      const { projectId, kind = 'all', cmd = '', cwd = '' } = args;
      if (!projectId) return { ok: false, error: '缺少项目 id' };
      if (!String(cmd || '').trim()) return { ok: false, error: '未配置启动命令' };
      return await startProc(projectId, kind, cmd, cwd);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('projects:stop', (_e, args = {}) => {
    try {
      const { projectId, kind = 'all' } = args;
      if (!projectId) return { ok: false, error: '缺少项目 id' };
      if (kind === 'all') return stopAllProcs(projectId);
      return stopProc(projectId, kind);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('projects:status', async (_e, specs = []) => {
    try {
      return await queryStatus(specs);
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('projects:probeUrl', async (_e, url) => {
    try { return { ok: true, reachable: await probeUrl(url) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('projects:stopAll', () => {
    try { stopEveryProc(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { registerProjectIpc, stopEveryProc };
