'use strict';
/** 项目管理中心冒烟运行器:env 清理后拉起 projects-smoke-main.js */
const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [path.join(__dirname, 'projects-smoke-main.js')], { env, stdio: 'inherit' });
child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => { console.error('启动失败:', err.message); process.exit(1); });
