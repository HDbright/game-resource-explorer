'use strict';
/**
 * Electron 启动器:清除会干扰 Electron 正常运行的继承环境变量后拉起应用。
 * 解决 NODE_OPTIONS(sandbox shim)与 ELECTRON_RUN_AS_NODE 导致 require('electron') 失效的问题。
 */
const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron'); // 该包在纯 node 下导出可执行文件路径

const args = process.argv.slice(2);
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..'), ...args], {
  env,
  stdio: 'inherit',
});

child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  console.error('启动 Electron 失败:', err.message);
  process.exit(1);
});
