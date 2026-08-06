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

/** 递归复制:目标已存在则覆盖(skipNames 跳过某些名字) */
function copyDir(src, dst, skipNames = []) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.includes(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d, skipNames);
    else fs.copyFileSync(s, d); // 覆盖
  }
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
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(staging, 'package.json'));
  const asarCli = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const tmpAsar = path.join(releaseDir, `_app_${stamp}.asar`);
  run(`node "${asarCli}" pack "${staging}" "${tmpAsar}"`);

  // 3. 覆盖 resources/app.asar
  fs.copyFileSync(tmpAsar, path.join(resourcesDir, 'app.asar'));
  console.log('app.asar 大小:', fs.statSync(tmpAsar).size, 'bytes');

  // 4. 复制 samples → resources/samples(覆盖)
  const samplesTarget = path.join(resourcesDir, 'samples');
  copyDir(path.join(ROOT, 'samples'), samplesTarget);

  // 5. rcedit 注入图标/版本(中文名 exe 需先复制成 ASCII 名再 rcedit,最后覆盖回来)
  const exeName = `${APP_NAME}.exe`;
  const exePath = path.join(appDir, exeName);
  const asciiTmp = path.join(appDir, `app_${VERSION.replace(/\./g, '')}_tmp.exe`);
  fs.copyFileSync(path.join(appDir, 'electron.exe'), asciiTmp);
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
  fs.copyFileSync(asciiTmp, exePath); // 覆盖
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

  // 7. 打便携版 zip(排除 data)
  const py = process.env.PYTHON || 'python';
  const zipPath = path.join(releaseDir, `游戏资源管理器-v${VERSION}-便携版.zip`);
  run(`"${py}" -c "import zipfile,os; root=r'${appDir}'.replace('\\\\','/'); out=r'${zipPath}'.replace('\\\\','/'); zf=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED); [zf.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), os.path.dirname(root))) for r,dirs,files in os.walk(root) if not (os.path.basename(r)=='data') for f in files]; zf.close(); print('zip done')"`);

  console.log('打包完成:', zipPath);
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});
