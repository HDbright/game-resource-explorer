'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据读写(整体保存)
  dbRead: () => ipcRenderer.invoke('db:read'),
  dbWrite: (data) => ipcRenderer.invoke('db:write', data),

  // 目录选择 / 扫描(opts: { title?, multi? })
  pickDirs: (opts) => ipcRenderer.invoke('dir:pick', opts),
  scanDir: (dir, recursive) => ipcRenderer.invoke('dir:scan', dir, recursive),

  // 系统交互
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (cmd) => ipcRenderer.invoke('app:openExternal', cmd),
  openWith: (p) => ipcRenderer.invoke('shell:openWith', p),
  statFile: (p) => ipcRenderer.invoke('fs:stat', p),

  // 缩略图持久化缓存(userData/thumbnails)
  thumbGet: (itemId) => ipcRenderer.invoke('thumb:get', itemId),
  thumbSave: (itemId, dataUrl) => ipcRenderer.invoke('thumb:save', itemId, dataUrl),
  thumbDelete: (itemId) => ipcRenderer.invoke('thumb:delete', itemId),

  // 应用信息
  appInfo: () => ipcRenderer.invoke('app:info'),
  docsDir: () => ipcRenderer.invoke('app:docsDir'),

  // ---- 开发者调试服务(CDP)开关 ----
  cdpGetState: () => ipcRenderer.invoke('cdp:getState'),
  cdpSetState: (payload) => ipcRenderer.invoke('cdp:setState', payload),
  cdpOpenDoc: () => ipcRenderer.invoke('cdp:doc'),
  cdpOpenDashboard: () => ipcRenderer.invoke('cdp:dashboard'),

  // ---- 窗口控制(全屏预览) ----
  setFullScreen: (flag) => ipcRenderer.invoke('win:setFullScreen', flag),

  // ---- 资源工具箱:通用文件 I/O ----
  pickFiles: (opts) => ipcRenderer.invoke('fs:pickFiles', opts),
  importIcon: () => ipcRenderer.invoke('icon:import'),
  fileIcon: (p) => ipcRenderer.invoke('icon:fromFile', p),
  collectFiles: (args) => ipcRenderer.invoke('tool:collectFiles', args),
  readBase64: (p) => ipcRenderer.invoke('fs:readBase64', p),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  writeFileBase64: (p, dataUrl) => ipcRenderer.invoke('fs:writeFileBase64', p, dataUrl),
  saveText: (opts) => ipcRenderer.invoke('fs:saveText', opts),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  listDir: (p) => ipcRenderer.invoke('fs:listDir', p),
  scanPaths: (args) => ipcRenderer.invoke('fs:scanPaths', args),

  // ---- 资源工具箱:转换工具 ----
  astc2png: (args) => ipcRenderer.invoke('tool:astc2png', args),
  skel2json: (args) => ipcRenderer.invoke('tool:skel2json', args),
  probeSkel: (args) => ipcRenderer.invoke('tool:probeSkel', args),
  spineFix: (args) => ipcRenderer.invoke('tool:spinefix', args),
  sk2spine: (args) => ipcRenderer.invoke('tool:sk2spine', args),
  probeSk2spine: (args) => ipcRenderer.invoke('tool:probeSk2spine', args),
  sk2spinePreview: (args) => ipcRenderer.invoke('tool:sk2spinePreview', args),

  // ---- 资源工具箱:Spine 骨骼格式/版本转换(C++ SpineSkeletonDataConverter) ----
  spineConvert: (args) => ipcRenderer.invoke('tool:spineConvert', args),
  spineProbe: (args) => ipcRenderer.invoke('tool:spineProbe', args),
  spinePreviewRegister: (args) => ipcRenderer.invoke('tool:spinePreviewRegister', args),
  htmlPreviewRegister: (args) => ipcRenderer.invoke('html:previewRegister', args),
  htmlPreviewUnregister: (args) => ipcRenderer.invoke('html:previewUnregister', args),

  // ---- FGUI 逆向:探测 / 单包解析 / 目录批量导出 / 源工程还原 ----
  fguiProbe: (args) => ipcRenderer.invoke('fgui:probe', args),
  fguiParse: (args) => ipcRenderer.invoke('fgui:parse', args),
  fguiBatchExport: (args) => ipcRenderer.invoke('fgui:batchExport', args),
  fguiExportSingle: (args) => ipcRenderer.invoke('fgui:exportSingle', args),
  fguiExportSource: (args) => ipcRenderer.invoke('fgui:exportSource', args),
  fguiSaveSourceEdits: (args) => ipcRenderer.invoke('fgui:saveSourceEdits', args),
  fguiPreviewLoad: (args) => ipcRenderer.invoke('fgui:previewLoad', args),

  // ---- 音频播放器:目录列表 / ID3 元信息 ----
  listDirAudios: (dir) => ipcRenderer.invoke('audio:listDir', dir),
  readAudioMeta: (p) => ipcRenderer.invoke("audio:readMeta", p),
  readAudioMetas: (paths) => ipcRenderer.invoke("audio:readMetas", paths),
  writeAudioMeta: (p, tags) => ipcRenderer.invoke('audio:writeMeta', p, tags),

  // ---- 网页游戏逆向分析:内嵌浏览器 / 请求拦截 / 资源下载 ----
  webOpen: (url, opts) => ipcRenderer.invoke('web:open', { url, ...opts }),
  webNavigate: (url) => ipcRenderer.invoke('web:navigate', url),
  webGoBack: () => ipcRenderer.invoke('web:goBack'),
  webGoForward: () => ipcRenderer.invoke('web:goForward'),
  webReload: () => ipcRenderer.invoke('web:reload'),
  webOpenDevTools: (action) => ipcRenderer.invoke('web:devtools', action || 'open'),
  webCloseDevTools: () => ipcRenderer.invoke('web:devtools', 'close'),
  webClose: () => ipcRenderer.invoke('web:close'),
  // 多标签页
  webNewTab: (url) => ipcRenderer.invoke('web:newTab', url),
  webOpenOrSwitch: (url) => ipcRenderer.invoke('web:openOrSwitch', url), // 已打开相同 URL → 切换; 否则新开
  webSwitchTab: (id) => ipcRenderer.invoke('web:switchTab', id),
  webCloseTab: (id) => ipcRenderer.invoke('web:closeTab', id),
  webGetUrl: () => ipcRenderer.invoke('web:getUrl'),
  onWebTabs: (cb) => ipcRenderer.on('web:tabs', (_e, d) => cb(d)),
  // 网页悬浮窗(切到其它模块时浏览器视图迁入独立窗口, 可拖拽/最小化/关闭)
  webFloatOut: () => ipcRenderer.invoke('web:floatOut'),
  webFloatBack: () => ipcRenderer.invoke('web:floatBack'),
  webSetBounds: (rect) => ipcRenderer.invoke('web:setBounds', rect),
  webSetAudioMuted: (muted) => ipcRenderer.invoke('web:setAudioMuted', muted),
  webMuteSite: (host) => ipcRenderer.invoke('web:muteSite', host),
  webUnmuteSite: (host) => ipcRenderer.invoke('web:unmuteSite', host),
  webToggleSiteMute: (host) => ipcRenderer.invoke('web:toggleSiteMute', host),
  webMoveTabToWindow: (tabId) => ipcRenderer.invoke('web:moveTabToWindow', tabId),
  webTabMenu: (p) => ipcRenderer.invoke('web:tabMenu', p),
  webGetCaptured: () => ipcRenderer.invoke('web:getCaptured'),
  webClearCaptured: () => ipcRenderer.invoke('web:clearCaptured'),
  webIsFloated: () => ipcRenderer.invoke('web:isFloated'),
  webProbe: (p) => ipcRenderer.invoke('web:probe', p),
  webDownload: (args) => ipcRenderer.invoke('web:download', args),
  webFetchText: (args) => ipcRenderer.invoke('web:fetchText', args),
  // 缩略图兜底: 用网页分区 session 下载图片转 data URL(共享登录态/Referer)
  webThumbFetch: (args) => ipcRenderer.invoke('web:thumbFetch', args),
  // 资源悬浮预览: 独立窗口(像 DevTools detach)
  webPreviewShow: (payload) => ipcRenderer.invoke('web:previewShow', payload),
  webPreviewHide: () => ipcRenderer.invoke('web:previewHide'),
  webPreviewClose: () => ipcRenderer.invoke('web:previewClose'),
  onWebPreviewAction: (cb) => ipcRenderer.on('web:previewAction', (_e, d) => cb(d)),
  // 网址收藏对话框(独立原生窗口, 弹窗时网页保持可见)
  webOpenBookmarkDialog: (opts) => ipcRenderer.invoke('web:openBookmarkDialog', opts),
  onBookmarkDialogResult: (cb) => ipcRenderer.on('bookmark:dialogResult', (_e, d) => cb(d)),
  onWebPreviewPinState: (cb) => ipcRenderer.on('web:previewPinState', (_e, d) => cb(d)),
  onWebPreviewClosed: (cb) => ipcRenderer.on('web:previewClosed', () => cb()),
  onWebStatus: (cb) => ipcRenderer.on('web:status', (_e, d) => cb(d)),
  onWebCaptured: (cb) => ipcRenderer.on('web:captured', (_e, d) => cb(d)),
  onWebProgress: (cb) => ipcRenderer.on('web:progress', (_e, d) => cb(d)),
  onWebDownloadDone: (cb) => ipcRenderer.on('web:downloadDone', (_e, d) => cb(d)),

  // ---- 开发工具箱:API 管理 接口测试 ----
  apiTest: (args) => ipcRenderer.invoke('api:test', args),

  // ---- 调试模式:独立窗口检视(可拖到主窗口外面) ----
  debugOpen: () => ipcRenderer.invoke('debug:open'),
  debugClose: () => ipcRenderer.invoke('debug:close'),
  debugUpdate: (info) => ipcRenderer.send('debug:update', info),
  onDebugUpdate: (cb) => ipcRenderer.on('debug:update', (_e, d) => cb(d)),
  debugAction: (act) => ipcRenderer.send('debug:action', act),
  // 调试窗口标题栏手动拖拽(JS 方案):光标屏幕坐标 → 主进程 setPosition
  debugDragStart: () => ipcRenderer.send('debug:dragStart'),
  debugDragMove: () => ipcRenderer.send('debug:dragMove'),
  debugDragEnd: () => ipcRenderer.send('debug:dragEnd'),
  // 焦点在调试窗口时按 Ctrl → 通知主窗口暂停/恢复调试信息获取
  debugTogglePause: () => ipcRenderer.send('debug:togglePause'),
  onDebugTogglePause: (cb) => ipcRenderer.on('debug:togglePause', () => cb()),
  // 调试窗口「源码位置」:获取项目源码根目录 / 执行 打开目录·编辑文件 / 接收操作结果提示
  debugGetEnv: () => ipcRenderer.invoke('debug:getEnv'),
  debugSourceAction: (payload) => ipcRenderer.send('debug:sourceAction', payload),
  onDebugSourceResult: (cb) => ipcRenderer.on('debug:sourceResult', (_e, msg) => cb(msg)),
  // 用户在调试窗口点「×」关闭 → 主进程通知主窗口退出调试模式
  onDebugUserClosed: (cb) => ipcRenderer.on('debug:userClosed', () => cb()),
});

// 冒烟测试标志(仅开发时传入 --smoke,通过 URL 参数传递,见 main.js)
contextBridge.exposeInMainWorld('__SMOKE_FLAG__', new URLSearchParams(window.location.search).get('smoke') === '1');

// 拖拽文件路径(Electron 43+ 无 File.path,须经 webUtils.getPathForFile)
contextBridge.exposeInMainWorld('dragUtils', {
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (err) { return null; }
  },
});
