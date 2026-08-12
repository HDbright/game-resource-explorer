'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  statFile: (p) => ipcRenderer.invoke('fs:stat', p),

  // 缩略图持久化缓存(userData/thumbnails)
  thumbGet: (itemId) => ipcRenderer.invoke('thumb:get', itemId),
  thumbSave: (itemId, dataUrl) => ipcRenderer.invoke('thumb:save', itemId, dataUrl),
  thumbDelete: (itemId) => ipcRenderer.invoke('thumb:delete', itemId),

  // 应用信息
  appInfo: () => ipcRenderer.invoke('app:info'),

  // ---- 开发者调试服务(CDP)开关 ----
  cdpGetState: () => ipcRenderer.invoke('cdp:getState'),
  cdpSetState: (payload) => ipcRenderer.invoke('cdp:setState', payload),
  cdpOpenDoc: () => ipcRenderer.invoke('cdp:doc'),

  // ---- 资源工具箱:通用文件 I/O ----
  pickFiles: (opts) => ipcRenderer.invoke('fs:pickFiles', opts),
  collectFiles: (args) => ipcRenderer.invoke('tool:collectFiles', args),
  readBase64: (p) => ipcRenderer.invoke('fs:readBase64', p),
  writeFileBase64: (p, dataUrl) => ipcRenderer.invoke('fs:writeFileBase64', p, dataUrl),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  listDir: (p) => ipcRenderer.invoke('fs:listDir', p),

  // ---- 资源工具箱:转换工具 ----
  astc2png: (args) => ipcRenderer.invoke('tool:astc2png', args),
  skel2json: (args) => ipcRenderer.invoke('tool:skel2json', args),
  probeSkel: (args) => ipcRenderer.invoke('tool:probeSkel', args),
  spineFix: (args) => ipcRenderer.invoke('tool:spinefix', args),
  sk2spine: (args) => ipcRenderer.invoke('tool:sk2spine', args),
  probeSk2spine: (args) => ipcRenderer.invoke('tool:probeSk2spine', args),

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
  webGetCaptured: () => ipcRenderer.invoke('web:getCaptured'),
  webClearCaptured: () => ipcRenderer.invoke('web:clearCaptured'),
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
  onWebPreviewPinState: (cb) => ipcRenderer.on('web:previewPinState', (_e, d) => cb(d)),
  onWebPreviewClosed: (cb) => ipcRenderer.on('web:previewClosed', () => cb()),
  onWebStatus: (cb) => ipcRenderer.on('web:status', (_e, d) => cb(d)),
  onWebCaptured: (cb) => ipcRenderer.on('web:captured', (_e, d) => cb(d)),
  onWebProgress: (cb) => ipcRenderer.on('web:progress', (_e, d) => cb(d)),
  onWebDownloadDone: (cb) => ipcRenderer.on('web:downloadDone', (_e, d) => cb(d)),

  // ---- 开发工具箱:API 管理 接口测试 ----
  apiTest: (args) => ipcRenderer.invoke('api:test', args),
});

// 冒烟测试标志(仅开发时传入 --smoke,通过 URL 参数传递,见 main.js)
contextBridge.exposeInMainWorld('__SMOKE_FLAG__', new URLSearchParams(window.location.search).get('smoke') === '1');
