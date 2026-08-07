'use strict';
/**
 * 手工打包「游戏资源管理器」便携版(替代 electron-builder,规避 Defender 锁文件 EBUSY)。
 *
 * 关键策略:【不做任何删除】—— safe-delete shim 会拦截 rmSync/rm,导致打包中断。
 * 全部使用 fs.copyFileSync 覆盖写入(记忆经验:覆盖写成功)。
 *
 * 步骤:
 *  1. 复制 node_modules/electron/dist → release/app(逐文件覆盖)
 *  2. asar pack 把 dist + electron + package.json 打成 staging 临时 asar(唯一名,避免删除)
 *  3. copyFileSync 覆盖 resources/app.asar
 *  4. 复制 samples → resources/samples(覆盖)
 *  5. rcedit 注入图标(ASCII 临时名)+ 重命名为「游戏资源管理器.exe」
 *  6. python zipfile 打便携版 zip(排除 data 用户数据)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version;
const APP_NAME = '游戏资源管理器';

function run(cmd, opts = {}) {
  console.log('> ' + cmd);
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

/** 复制文件并重试:杀软/Defender 会瞬时锁定新生成的大文件(EBUSY),稍候重试 */
function copyFileRetry(src, dst, tries = 6, delay = 1200) {
  for (let i = 1; ; i++) {
    try {
      fs.copyFileSync(src, dst);
      return;
    } catch (err) {
      if (i >= tries) throw err;
      console.warn(`[pack] 复制被锁,重试 ${i}/${tries}: ${dst} (${err.code})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, delay);
    }
  }
}

/** 递归复制:目标已存在则覆盖;若目标与源大小+mtime 相同则跳过(避免写入被瞬时锁定文件,如杀软扫描中) */
function copyDir(src, dst, skipNames = []) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.includes(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d, skipNames);
    else {
      try {
        const ss = fs.statSync(s);
        const ds = fs.statSync(d);
        if (ss.size === ds.size && ss.mtimeMs === ds.mtimeMs) continue; // 内容一致,跳过
      } catch (err) { /* 目标不存在 → 正常复制 */ }
      copyFileRetry(s, d);
    }
  }
}

/**
 * 主进程运行时第三方依赖(渲染端依赖已由 vite 打包进 dist,无需复制)。
 * 新增主进程 npm 依赖时,在此追加包名(含 @scope/name);其 dependencies 会自动递归复制。
 */
const MAIN_DEPS = ['@arkntools/astc-decode', '@esotericsoftware/spine-core', 'node-id3'];

/** 递归收集某包及其 dependencies 的 node_modules 路径 */
function collectDeps(pkgName, visited, out) {
  if (visited.has(pkgName)) return;
  visited.add(pkgName);
  const pkgPath = path.join(ROOT, 'node_modules', ...pkgName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    console.warn('[pack] 缺少依赖包(跳过):', pkgName);
    return;
  }
  out.push(pkgPath);
  let pkgJson = {};
  try { pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf8')); } catch (err) { /* ignore */ }
  for (const d of Object.keys(pkgJson.dependencies || {})) collectDeps(d, visited, out);
}

/** 复制主进程生产依赖 → staging/node_modules(保持相对结构) */
function copyNodeModules(staging) {
  const visited = new Set();
  const pkgPaths = [];
  for (const d of MAIN_DEPS) collectDeps(d, visited, pkgPaths);
  for (const src of pkgPaths) {
    const rel = path.relative(path.join(ROOT, 'node_modules'), src);
    copyDir(src, path.join(staging, 'node_modules', rel));
  }
  console.log('主进程依赖已复制:', pkgPaths.length, '个包 ->', path.join(staging, 'node_modules'));
}

async function main() {
  const releaseDir = path.join(ROOT, 'release');
  const appDir = path.join(releaseDir, 'app');
  const resourcesDir = path.join(appDir, 'resources');

  // 1. 复制 electron dist → release/app(覆盖)
  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) {
    console.error('未找到 electron dist:', electronDist);
    process.exit(1);
  }
  console.log('复制 electron dist → release/app ...');
  copyDir(electronDist, appDir, ['data']); // 保留用户 data 目录

  // 2. asar pack(临时 asar 唯一名,避免删除旧文件)
  fs.mkdirSync(resourcesDir, { recursive: true });
  const stamp = Date.now().toString(36);
  const staging = path.join(releaseDir, `_staging_${stamp}`);
  fs.mkdirSync(staging, { recursive: true });
  console.log('组装 asar staging ...');
  copyDir(path.join(ROOT, 'dist'), path.join(staging, 'dist'));
  copyDir(path.join(ROOT, 'electron'), path.join(staging, 'electron'));
  copyNodeModules(staging);
  copyFileRetry(path.join(ROOT, "package.json"), path.join(staging, "package.json"));
  const asarCli = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const tmpAsar = path.join(releaseDir, `_app_${stamp}.asar`);
  run(`node "${asarCli}" pack "${staging}" "${tmpAsar}"`);

  // 3. 覆盖 resources/app.asar
  copyFileRetry(tmpAsar, path.join(resourcesDir, "app.asar"));
  console.log('app.asar 大小:', fs.statSync(tmpAsar).size, 'bytes');

  // 4. 复制 samples → resources/samples(覆盖)
  const samplesTarget = path.join(resourcesDir, 'samples');
  copyDir(path.join(ROOT, 'samples'), samplesTarget);

  // 5. rcedit 注入图标/版本(中文名 exe 需先复制成 ASCII 名再 rcedit,最后覆盖回来)
  //    临时 exe 用唯一名(含 stamp),避免反复覆盖旧文件被杀软扫描锁定(EBUSY);旧 tmp 文件保留但 zip 已排除。
  const exeName = `${APP_NAME}.exe`;
  const exePath = path.join(appDir, exeName);
  const asciiTmp = path.join(appDir, `app_${VERSION.replace(/\./g, '')}_${stamp}_tmp.exe`);
  copyFileRetry(path.join(appDir, "electron.exe"), asciiTmp);
  const rcedit = path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const iconPath = path.join(ROOT, 'build', 'icon.ico');
  if (fs.existsSync(rcedit) && fs.existsSync(iconPath)) {
    try {
      run(`"${rcedit}" "${asciiTmp}" --set-icon "${iconPath}" --set-version-string "ProductName" "${APP_NAME}" --set-version-string "FileDescription" "${APP_NAME} v${VERSION}" --set-version-string "ProductVersion" "${VERSION}" --set-version-string "FileVersion" "${VERSION}" --set-version-string "CompanyName" "game-resource-explorer"`);
    } catch (err) {
      console.error('rcedit 失败(可忽略,继续):', err.message);
    }
  } else {
    console.warn('rcedit 或 icon 不存在,跳过图标注入');
  }
  copyFileRetry(asciiTmp, exePath); // 覆盖
  console.log('exe 就绪:', exePath);

  // 6. 冒烟验证打包版(可选,SKELETON_VIEWER_PACK_SMOKE=1 时执行)
  if (process.env.SKELETON_VIEWER_PACK_SMOKE === '1') {
    const dataDir = path.join(appDir, 'data');
    const backupDir = path.join(releaseDir, `_data_backup_${stamp}`);
    if (fs.existsSync(dataDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      copyDir(dataDir, backupDir);
    }
    run(`env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE SKELETON_VIEWER_SMOKE=1 SKELETON_VIEWER_SOFTWARE=1 "${exePath}"`, { timeout: 240000 });
    if (fs.existsSync(backupDir)) {
      // 恢复用户数据:覆盖写回
      copyDir(backupDir, dataDir);
    }
  }

  // 7. 打便携版 zip(排除 data 用户数据 + 历史遗留的 rcedit ASCII 临时 exe `app_*_tmp.exe`)
  const py = process.env.PYTHON || 'python';
  const zipPath = path.join(releaseDir, `游戏资源管理器-v${VERSION}-便携版.zip`);
  run(`"${py}" -c "import zipfile,os; root=r'${appDir}'.replace('\\\\','/'); out=r'${zipPath}'.replace('\\\\','/'); zf=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED); [zf.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), os.path.dirname(root))) for r,dirs,files in os.walk(root) if not (os.path.basename(r)=='data') for f in files if not f.endswith('_tmp.exe')]; zf.close(); print('zip done')"`);

  console.log('打包完成:', zipPath);
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});
