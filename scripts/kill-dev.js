'use strict';
/**
 * 清理本项目的开发残留进程(electron.exe / vite / launch-electron 的 node)。
 * 用途: npm run dev 启动前、或调试后发现后台有 electron.exe 残留时, 先跑一遍本脚本。
 *
 * 原理: 用 wmic 读取进程命令行, 仅杀掉命令行包含本项目目录的 electron.exe / node.exe,
 * 不会误杀其它项目或 VS Code 等无关 electron 应用。对 electron 主进程用 taskkill /T
 * 连带杀掉其渲染进程 / GPU 等子进程, 保证彻底干净。
 */
const { execSync } = require('child_process');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const MARKER = PROJECT_DIR.toLowerCase().replace(/\//g, '\\');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return (e.stdout || '').toString();
  }
}

/** 返回命令行包含本项目目录的指定镜像进程列表 [{pid, cmd}] */
function procsOf(image) {
  const out = run(`wmic path win32_process where "name='${image}'" get commandline,processid /format:csv`);
  const res = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /commandline/i.test(line)) continue; // 跳过表头
    const idx = line.lastIndexOf(',');
    if (idx < 0) continue;
    const pid = line.slice(idx + 1).trim();
    const cmd = line.slice(0, idx).trim().toLowerCase().replace(/\//g, '\\');
    if (/^\d+$/.test(pid) && cmd.includes(MARKER)) res.push({ pid: parseInt(pid, 10), cmd });
  }
  return res;
}

const targets = [
  ...procsOf('electron.exe'),
  ...procsOf('node.exe').filter((p) => /launch-electron|vite|esbuild/i.test(p.cmd)),
];

if (!targets.length) {
  console.log('[kill-dev] 没有发现本项目的残留进程, 无需清理。');
  process.exit(0);
}

const seen = new Set();
for (const p of targets) {
  if (seen.has(p.pid)) continue;
  seen.add(p.pid);
  console.log(`[kill-dev] 终止 PID ${p.pid}: ${p.cmd.slice(0, 110)}`);
  run(`taskkill /PID ${p.pid} /T /F`);
}
console.log(`[kill-dev] 已清理 ${seen.size} 个进程。`);
