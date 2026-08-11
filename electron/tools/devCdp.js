// ============ Chrome DevTools Protocol (CDP) 调试服务开关 ============
// 原理: Chromium 的 --remote-debugging-port 只能在进程启动时生效(运行时无法动态开启),
//       因此用「持久化标志 + 自动重启」实现应用内开关:
//   - 状态存 userData/dev-cdp.json { enabled, port }
//   - 主进程启动早期(ready 前)同步读标志, 已启用则 appendSwitch 调试端口
//   - 渲染端切换开关 → IPC → 写标志 → app.relaunch() 自动重启生效
// 安全提示: 调试端口开启后本机任意进程均可连接(无认证), 仅限本机开发调试使用。
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { app } = require('electron');

const DEFAULT_PORT = 9222;

function stateFile() {
  return path.join(app.getPath('userData'), 'dev-cdp.json');
}

/** 同步读取开关状态(启动早期用, 文件极小) */
function readState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return { enabled: !!j.enabled, port: Number(j.port) || DEFAULT_PORT };
  } catch (e) {
    return { enabled: false, port: DEFAULT_PORT };
  }
}

/** 启动早期调用(app ready 前): 已启用则挂上调试端口 */
function applyOnStartup() {
  const st = readState();
  if (!st.enabled) return { enabled: false, port: st.port, applied: false };
  const port = clampPort(st.port);
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.commandLine.appendSwitch('remote-allow-origins', '*');
  return { enabled: true, port, applied: true };
}

/** 写状态(渲染端切换开关时调用) */
function saveState({ enabled, port }) {
  const dir = path.dirname(stateFile());
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  fs.writeFileSync(stateFile(), JSON.stringify({ enabled: !!enabled, port: clampPort(port) }));
}

function clampPort(port) {
  const n = Number(port);
  if (!Number.isFinite(n)) return DEFAULT_PORT;
  return Math.max(1024, Math.min(65535, Math.round(n)));
}

/** 探测本地端口是否已监听(CDP 是否真正生效) */
function probePort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => { try { sock.destroy(); } catch (e) { /* ignore */ } resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** 计算重启参数: 过滤掉旧的调试开关, 统一由标志文件控制 */
function relaunchArgs() {
  return process.argv.slice(1).filter((a) => !/^--remote-(debugging-port|allow-origins)=/.test(a));
}

module.exports = { readState, applyOnStartup, saveState, probePort, relaunchArgs, DEFAULT_PORT };
