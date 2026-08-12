# 更新日记 (Changelog)

> **游戏资源管理器**（原骨骼动画预览器）变更记录。
>
> **约定**：每次新增功能（标记 `[新增]`）或修复问题（标记 `[修复]`）后，均在此文件追加一条**带日期**的记录，新记录置顶（最新的在最上面）。
> 旧记录仅作归档，不再修改内容。版本号以 `package.json` 中 `version` 为准（当前 `v1.9.32`）。

---

## 2026-08-12

### [修复] 发布 v1.9.39：右键菜单位置/悬浮折叠/设置页滚动条
- **标签右键菜单从鼠标点击处弹出**: 原生 `Menu.popup` 传入 `window` 时 `x/y` 为窗口内容区坐标, 原代码又叠加 `win.getPosition()`(屏幕坐标)导致菜单被推到很远。改为 `menu.popup({ window: win, x: clientX, y: clientY })`。
- **手动「移至新窗口」后主窗口浏览器区折叠让位给下方侧栏**: `moveTabToNewWindow` 置 `_floatedManual`, 经 `web:status` 透传 `manual`; 渲染端收到 `floated`+manual 时给 `.wg-wrap` 加 `floated-out`(隐藏浏览器区与分隔条, 下方侧栏填满); 关闭悬浮窗(`floatClose`→`back`)或切回时取消, 浏览器区按分隔条记录的 height 自动还原比例。重入页面时按 `web:isFloated` 恢复折叠态。
- **系统设置页垂直滚动条生效**: `.page-settings` 选择器特异性低于 `.content-panel .page` 的 `overflow:hidden`, 导致 `overflow-y:auto` 被覆盖。改为 `.content-panel .page.page-settings` 提升特异性, 默认窗口大小下底部设置项可滚动浏览。

### [修复] 发布 v1.9.38：标签右键菜单不被网页遮挡、悬浮窗最大化/最小化改系统行为
- **标签右键菜单不再被网页遮挡**: 网页抓取标签页右键菜单原用 DOM 浮层(`#wg-ctxmenu`), 但 `WebContentsView`(网页)永远盖在 DOM 之上, 菜单下半部会被网页内容遮住。改为经 `web:tabMenu` 调用主进程原生 `Menu.buildFromTemplate` + `menu.popup()` 在屏幕坐标弹出 —— 原生 OS 菜单始终在最上层, 且天然符合系统样式。
- **悬浮窗新增最大化/还原按钮(系统风格)**: 独立悬浮窗标题栏改为三按钮(右侧, 系统顺序) `最小化 | 最大化/还原 | 关闭`; 最大化按钮点击在 `maximize()`/`unmaximize()` 间切换, 图标用系统风格 SVG(单框=最大化, 重叠双框=还原), 消除原先不符合系统的 `▶` 播放按钮; 主进程 `maximize`/`unmaximize` 事件经 `float:maxState` 转发给标题栏切换图标。
- **悬浮窗最小化改为隐藏到系统任务栏**: `floatMinimize()` 改为 `this.floatWin.minimize()`(最小化到系统任务栏, 点击任务栏图标可还原), 不再缩成迷你按钮。
- 新增 IPC: `web:tabMenu` / `float:toggleMax`; 新增 preload API: `webTabMenu` / `floatApi.toggleMax` / `floatApi.onMaxState`。

### [新增] 发布 v1.9.37：网页抓取标签右键菜单(移至新窗口 / 按网站静音) + 静音图标
- **网页抓取标签页右键菜单**: 在任意标签页上右键弹出菜单, 含:
  - 「🪟 将标签页移至新窗口」→ 调用 `web:moveTabToWindow`: 将该标签设为活动标签并浮出到独立悬浮窗(复用切模块时的悬浮窗机制), 其余标签留主窗口。
  - 「🔇 将这个网站静音 / 🔊 取消静音此网站」→ 按 host 静音(同一网站所有标签同步), 复用全局静音按钮的 host 静音逻辑。
- **按网站(host)静音**: `WebGameView` 新增 `mutedHosts` 集合, 持久化到 `userData/webgame-muted.json`(重启恢复); `muteSite`/`unmuteSite`/`toggleSiteMute` 同步所有同 host 标签的 `tab.muted` 与 `webContents.setAudioMuted`; `getTabs()` 返回 `muted` 标志; 新标签创建 / `did-navigate` / `open` 时自动应用静音状态; 全局静音按钮(`#wg-mute`)改为按当前活动标签所属网站静音, 与右键菜单统一(标签页列表渲染时同步全局按钮状态)。
- **已静音标签图标**: 静音的标签渲染透明背景、线条绘制风格的静音喇叭 SVG 图标(`.wg-tab-mute-ico`), 绝对定位浮于标签左上角, `pointer-events:none` 不挡点击, 活动标签颜色稍亮。
- 新增 IPC: `web:muteSite` / `web:unmuteSite` / `web:toggleSiteMute` / `web:moveTabToWindow`; preload 暴露 `webMuteSite` / `webUnmuteSite` / `webToggleSiteMute` / `webMoveTabToWindow`。

### [新增] 发布 v1.9.36：系统设置页滚动条、CDP 说明页完善、交互式 CDP 工具面板
- **系统设置页增加滚动条**: `.page-settings` 增加 `flex:1; min-height:0` 确保高度约束生效,并添加自定义 WebKit 滚动条样式(8px 宽,圆角,hover 高亮),方便浏览底部设置项(开发者调试等卡片)。
- **CDP 说明页(cdp-doc.html)大幅完善**: 参考实际调试场景重写文档内容:
  - 新增「手动操作完整流程」三步走(list_pages→select_page→观察+操作)含流程图和详细说明。
  - 工具速查表扩充为 9 行完整表格(list_pages/select_page/take_snapshot/take_screenshot/evaluate_script/click-type_text/navigate_page/press_key/list_console_messages),含「用途」和「何时使用」两列实用说明。
  - 关键注意事项增加操作顺序要点(select_page 优先、canvas 无 uid 靠 JS+截图、take_screenshot filePath 参数等)和技术细节。
  - FAQ 增加 3 条常见问题(click 无反应、截图空白、如何识别网页视图 id)。
  - HTTP REST 端点速查表和 CDP WebSocket 命令示例均补充完善。
- **新增 CDP 交互式工具面板**(public/cdp-dashboard.html):
  - 独立窗口打开的 HTML 应用,连接本地 9222 端口,提供可视化调试操作台。
  - 左侧:实时页面列表(自动刷新,点击切换目标,显示 id/title/url/type)。
  - 右侧:分组工具面板——快速操作(list_pages/take_screenshot/take_snapshot/list_console_messages)、页面导航(navigate/reload/activate)、JS 执行(代码输入框+快捷片段按钮)、输入模拟(click/type_text/press_key)。
  - 底部:结果输出区 + 状态栏(连接状态/当前目标/WebSocket 状态)。
  - 通过 WebSocket 发送 CDP 命令(Runtime.evaluate/Page.captureScreenshot/Accessibility.getFullAXTree 等),截图支持 base64 内联预览。
  - 主进程新增 `cdp:dashboard` IPC handler; preload 暴露 `cdpOpenDashboard`;设置页 CDP 卡片新增「🔧 工具面板」按钮。

### [新增] 发布 v1.9.35：同类型资源标签开关、CDP 连接说明页、顶栏调试状态指示灯
- **系统设置新增「资源标签页」卡片**: 「打开同一类型资源文件时,通过新开标签页打开」开关(默认开启)。
  - 开:每个资源独立标签页(原行为);关:同一类型(动画/图片/音频/3D)资源复用当前预览标签,打开新资源时替换内容,避免标签页堆积(`selectItem` 按开关选择标签 key, 复用标签时同步更新名称/参数)。
- **开发者调试 (CDP) 新增「📖 连接说明」**: 点击打开独立文档窗口(`public/cdp-doc.html`), 内容含: ①手动建立连接的操作完整流程(启用→验证端口→Chrome DevTools / chrome-devtools 连接器两种方式) ②工具速查表(CDP 端点 + WebSocket + curl 命令示例) ③关键注意事项(端口无认证、重启生效机制、端口占用、监听地址等) ④FAQ。
  - 主进程新增 `cdp:doc` handler(独立 BrowserWindow 加载 `dist/cdp-doc.html`, 已打开则聚焦); preload 暴露 `cdpOpenDoc`。
- **顶栏搜索框前新增 Chrome DevTools 连接状态指示灯**: 圆点指示灯(绿=已生效可连接 / 黄=已启用待重启 / 灰=关闭) + 鼠标悬停提示(状态 + 端口 + 指引) + 点击打开连接说明; 8s 轮询 `cdp:getState` 自动刷新。

---

## 2026-08-12

### [新增] 发布 v1.9.34：侧栏系统设置入口、场景管理未分类移除、FGUI 导出源、场景首页 FGUI 包快速打开、Laya sk→Spine 入口
- **侧栏新增「系统设置」入口**: 左侧树底部(开发工具箱下方)新增「⚙️ 系统设置」叶子节点, 点击进入设置页。
- **移除游戏场景管理下的「未分类」节点**: 侧栏场景树与场景管理主页分类树中的「未分类」目录节点一并去除。
- **资源工具箱「FGUI导出」→「FGUI导出源」**: 侧栏菜单改名; 工具页由"逆向导出 JSON+XML"改为**导出源工程**——选择含 .bin 的目录后逐包调用 `fguiExportSource`, 输出到各包同目录 `FGUI_src/<包名>`(package.xml + 组件 XML + 碎图 + 字体 + 动画, 可直接用 FairyGUI 编辑器打开); 已存在源工程时弹确认覆盖; 支持批量与最近目录记忆。
- **场景管理首页「最近添加」点击 FGUI 包直接用 FGUI 编辑器打开**: `subtype==='fgui'` 的条目单击不再弹右键菜单, 直接进入 FGUI 编辑器加载该包; 其它条目仍弹右键菜单。
- **资源工具箱「文件格式转换」子菜单新增「Laya .sk 转 Spine」入口**: 直达已有的 sk2spine 工具页(骨架 .json + 图集 .atlas)。
- 主冒烟 `toolhome` 步骤同步: 检查「FGUI导出源」叶子与页面标题, 并修正 `entries===5 → 6` 的遗留误判(实际 6 张工具卡片)。
- ⚠️ 已知: 冒烟 `delcat` 步骤 mode2 失败为既有测试与实现语义不匹配(对话框默认"删除动画", 测试期望默认"移入未分类"), 与本次改动无关。

---

## 2026-08-12

### [修复] 发布 v1.9.33：Spine 预览「Ot is not a constructor」崩溃修复
- **症状**: 预览 Spine 动画报「加载失败:Ot is not a constructor」,3.x 与 4.x 资源均可能触发, 缩略图同步失败。
- **根因(两层)**:
  1. `spine38Player.js` / `fguiLayoutPreview.js`: pixi 懒加载改造时, 将 `new PIXI.Container()` 机械替换为 `new P().Container()`, 而 `P` 是箭头函数 `() => pixiRef()` — 箭头函数无 `[[Construct]]`, `new P()` 必抛 `"Xxx is not a constructor"`(压缩后即 `Ot is not a constructor`); 即使改成 `P().X()`, `Container/Mesh/MeshGeometry` 等 Pixi 类是 class, 直接调用仍抛 `"Class constructor X cannot be invoked without 'new'"`。正确写法为 `new (P().X)()`。
  2. `spinePlayer.js`(4.x): 从 `@pixi/spine-pixi` 解构 `SkeletonJson/SkeletonBinary/AtlasAttachmentLoader` — 这些类只是经 `export *` 星级透传自 `@esotericsoftware/spine-core`, 生产构建(Vite/Rollup)会丢弃该透传, 解构得 `undefined` → `new` 时同样报 not a constructor。
- **修复**:
  - `spine38Player.js`: 4 处 `new P().X()` → `new (P().X)()`(Container/MeshGeometry/Mesh; `Texture.from` 静态方法保持 `P()` 不变)。
  - `fguiLayoutPreview.js`: 19 处 `new P().X()` → `new (P().X)()`。
  - `spinePlayer.js`: 改用官方 `Spine.from({ skeleton, atlas })` 解析并创建实例 — 其内部使用与 `Spine` 类同一 spine-core 实例解析, 既保证解析类可用(不再依赖星级透传导出), 又保证 `skeletonData` 通过 `Spine` 构造函数的 `instanceof SkeletonData` 校验。`@esotericsoftware/spine-core` 加入 package.json 直接依赖(`~4.2.45`, 与 spine-pixi 要求一致)。
- **验证**: 完整冒烟测试通过 — sample-spine(3.8.99, 走 Spine38Player) 3 动作正常播放渲染; DragonBones 正常; 缩略图 429/429 全部生成成功(此前 2 个失败); 独立 4.x 资源端到端测试(Spine.from + 真实渲染) PASS。
- **补充(FGUI 相关排查)**:
  - 定位到 FGUI 冒烟测试检查点过时: 场景主页「FGUI 编辑器」卡片实际打开的是**独立编辑器页**(canvas id `fge-canvas`), 而冒烟脚本仍在检查已废弃的场景内预览子页(`fgpv-canvas`, 现为无入口的死代码路径) → 误报 pvPage=false。已更新 `fgui-smoke-main.js` 检查点至 `fge-*` 并验证通过(pvPage/pvCanvasGL/pvTextLayer 等全 true, 画布 482x610)。
  - 验证 v1.9.33 下 FGUI 编辑器页完整链路正常: FguiLayoutPreview.init 成功、样例 bin 加载、画布渲染出内容(nonBg 15 万+ 像素)。
  - `vite.config.js` `emptyOutDir: false → true`: 此前历次构建的旧 chunk 全部残留在 dist 并被打入安装包(asar 43MB→20MB, 含 60+ 冗余 js), 现已干净(仅 2 个 js)。
  - **zip 不再打包 electron.exe**: 「游戏资源管理器.exe」是 electron.exe 的副本 + rcedit 注入图标, 运行时自包含(靠同目录 resources/app.asar + DLL), 不依赖 electron.exe。已实测: 移除 electron.exe 后 exe 正常启动。`pack-manual.js` zip 阶段排除 electron.exe → **便携版 zip 249MB→152MB(省 97MB)**。

---

## 2026-08-12

### [说明] 发布 v1.9.32(便携版)
- 例行递增版本号并重新打包便携版：1.9.31 → 1.9.32。
- 本次打包包含截至 v1.9.31 的全部功能与修复（设置页开发者调试 CDP 开关、网络资源抓取内置浏览器 sandbox 修复、另存默认定位输出目录等，详见上方各版本记录），以及自 v1.9.31 以来的工作区累积改动。

---

## 2026-08-11

### [新增] v1.9.31: 设置页新增「开发者调试」开关 — 常规启动后一键开启 Chrome DevTools(CDP) 调试服务
- 需求: 常规启动(双击 exe, 不带命令行参数)后, 希望在应用内通过开关开启 chrome-devtools 连接器的调试服务(CDP 端口)。
- 方案: Chromium 的 `--remote-debugging-port` 只能在**进程启动时**生效, 运行时无法动态开启 → 用「持久化标志 + 自动重启」:
  - 开关状态存 `userData/dev-cdp.json`(`{ enabled, port }`, 默认关/9222)。
  - 主进程启动早期(ready 前)同步读标志, 已启用则 `appendSwitch('remote-debugging-port', port)` + `appendSwitch('remote-allow-origins', '*')`。
  - 切换开关 → IPC 写标志 → `app.relaunch({ args: 过滤掉旧调试参数 })` 自动重启生效, 参数统一由标志文件控制。
- 新增 `electron/tools/devCdp.js`: `readState` / `applyOnStartup` / `saveState` / `probePort`(TCP 探测端口是否真在监听) / `relaunchArgs`。
- main.js: `cdp:getState`(返回 enabled/port/listening)、`cdp:setState`(写标志 + 300ms 后 relaunch); preload 暴露 `cdpGetState`/`cdpSetState`。
- settingsPage.js 新增「开发者调试 (Chrome DevTools)」卡片: 启用开关 + 端口输入(1024-65535, 随开关禁用) + 状态徽标(● 已生效,可连接 / ○ 待重启生效 / 关闭) + 「保存并重启」按钮; style.css 加 `.cdp-status` 三态色。
- ⚠️ 安全提示已写入 UI: CDP 端口无访问认证, 任何本机程序可连接, 仅限本机开发调试, 勿在共享环境开启。
- 验证: 设置页开开关 → 保存并重启 → 新进程(无命令行调试参数)读标志自动开 9222 → `curl /json/version` 与 chrome-devtools 连接器均连上; `cdp:getState` 返回 `{enabled:true,port:9222,listening:true}`。

## 2026-08-11

### [修复] v1.9.30: 网络资源抓取内置浏览器打不开网页(渲染进程被杀)
- 现象: 内置浏览器(WebContentsView)打开任意网页(http/https 均如此)都失败——`did-start-loading` 后立即 `render-process-gone {reason:'killed', exitCode:1}`, 标签停留在「新标签」, 捕获列表无资源; 应用主窗口(非 sandbox)正常。
- 根因: `_createTab` 的 `webPreferences` 设了 `sandbox: true`, 在本机无 GPU(软渲染 `--disable-gpu` / `SKELETON_VIEWER_SOFTWARE=1`)环境下, sandboxed 渲染进程无法正常初始化被系统杀死; 主窗口 BrowserWindow 默认非 sandbox 所以不受影响。
- 修复: `electron/tools/webGame.js` `_createTab` 的 `sandbox: true → false`(nodeIntegration 仍为 false + contextIsolation 仍为 true, 无安全降级; 远程网页无 node 访问能力)。
- 顺带: `_createTab` 增加 `did-fail-load` / `did-finish-load` / `render-process-gone` / `did-start-loading` 主进程日志, 便于日后排查网页加载失败。
- 验证: 打开 `https://www.chuangciyingyu.com/release/client/web/index.html` → 主进程 `did-finish-load` 触发, CDP target 标题「闯词Ai-游戏化背单词」, 捕获列表 33 条/共 76 条(Spine / 配置等)。

## 2026-08-11

### [新增] v1.9.29: 「另存..」默认定位输出目录 + 捕获列表播放按钮改悬浮线条风格
- 需求: ① 「另存为」弹出的路径选择窗口默认保存地址设置为输出目录(`webGameSaveDir`)里设置的路径; ② 捕获列表 `#wg-list` 快捷预览播放按钮不再挤占缩略图和文件名位置, 改为透明背景、悬浮在缩略图上的简洁线条风格播放按钮。
- 实现:
  - `electron/main.js`: `dir:pick` 支持可选参数 `defaultPath`(目录选择对话框默认定位目录)。
  - `src/pages/webGamePage.js`:
    - `saveAsRec` 调 `pickDirs({ ..., defaultPath: downloadRoot || undefined })` —— 另存对话框默认打开输出目录; 未设置输出目录时回退系统默认。
    - `renderList` 行模板: 播放按钮与缩略图包进固定 28×28 的 `.wg-thumbwrap` 插槽; 播放按钮改为内联 SVG 线条三角图标(无填充、stroke 2), 不再占据独立 22px 空间。
  - `src/style.css`: `.wg-thumbwrap`(relative 28×28 插槽, 所有行对齐); `.wg-thumb` 绝对定位填满插槽; `.wg-playbtn` 绝对悬浮于缩略图上、透明背景、悬停行显示、hover 加轻微暗色遮罩 + 图标投影保证对比度。
- 验证: 3 文件 `node --check` 通过; vite build 通过。

## 2026-08-11

### [新增] v1.9.28: 捕获列表右键菜单增加「另存..」
- 需求: 网络资源抓取模块捕获列表 `#wg-list` 右键菜单增加「另存..」, 点击弹出目录选择器, 保存到用户指定位置。
- 实现:
  - `src/pages/webGamePage.js`: `ctxActions(rec)` 在「保存此资源...」后新增 `📁 另存..` 菜单项 → `saveAsRec(rec)`: 弹目录选择器(单选) → 以资源原文件名(重名自动 `1_`/`2_` 前缀)下载到所选目录 → spine 组配套文件一并另存 → 更新行状态/`rec.path`(可「打开下载目录」) → 非「仅下载不入库」时照常入库。不改变顶栏输出目录 `downloadRoot`。
  - `electron/main.js` + `electron/preload.js`: `dir:pick` 支持可选参数 `{ title?, multi? }`(原有调用不传参行为不变)。
- 验证: 3 文件 `node --check` 通过; vite build 通过。

## 2026-08-11

### [修复] v1.9.27: 有网页打开时点击侧栏收藏夹目录, 网页显示区保持内容不黑屏
- 需求: 网络资源抓取模块中如果有网页打开的情况下, 点击左侧树状菜单栏的网址收藏夹目录(非收藏网址), 显示的网页内容要保持不变, 而不是将网页显示区变成黑屏。
- 现象: 点击侧栏「网址收藏夹」根节点/分类目录时, 网页显示区变黑(且可能闪出网页悬浮窗)。
- 根因:
  - `src/ui.js` `enterWebGame()` 无条件调用 `clearOverlays()`, 而 `clearOverlays` 在已处于抓取页(`webGameShown=true`)时仍触发 `_webGameDetach()→webFloatOut()`, 把网页视图迁出主窗口; 随后 `renderMainArea→syncBounds` 又将其迁回, 最后 `setPanel('bookmark')` 再以 `webSetBounds(0×0)` 隐藏视图 → 浏览器区黑屏。
  - `setPanel('bookmark')` 按原设计隐藏浏览器视图, 左树点击分类目录时并不需要隐藏。
- 改动:
  - `src/ui.js` `enterWebGame()`: **已在抓取页时跳过 `clearOverlays()`**(仅首次进入才清状态/触发 detach); 收藏夹根节点/分类节点/右键「打开收藏夹」点击传入 `{ keepBrowser: true }`。
  - `src/pages/webGamePage.js`: `setPanel(panel, keepBrowserInPanel)` 新增参数——`keepBrowser` 时收藏夹面板下**保留浏览器视图**(走 `_webGameSyncBounds` 而非 `0×0`); `_webGameSyncBounds` 在 `keepBrowser` 时不再提前返回(窗口 resize/拖分割条仍跟随); `_webGameShowBookmarks(catId, opts)` 透传 `keepBrowser`。
  - 内部侧栏 tab「🔖 网址收藏夹」仍按原逻辑隐藏浏览器(用户主动聚焦收藏夹面板), 不受影响。
- 验证: 3 文件 `node --check` 通过; vite build 通过。

## 2026-08-11

### [修复] v1.9.26: 侧栏收藏夹点击不再出现左上角小窗 + 已打开网址点击改为切换标签页
- 需求: ① 有网页打开时点击侧栏「网址收藏夹」/收藏夹子目录节点, 网页内容缩小为应用左上角悬浮小窗——任何时候都不应出现; ② 有网页打开时点击侧栏收藏夹中该网页的网址, 应切换到已打开的标签页而非新开。
- 实现:
  - `electron/tools/webGame.js`: `syncBounds` 的 **width/height clamp 由 80 改为允许 0** —— 收藏夹面板切换时 `webSetBounds(0×0)` 隐藏浏览器视图, 此前被 clamp 成 80×80 左上角小窗(WebContentsView 0×0 合法隐藏, 非活动 tab 本就用 0×0); 新增 **`openOrSwitch(url)`**(`normUrl` 规范化比较忽略尾斜杠/hash): 已打开相同 URL 标签页 → 切换过去, 否则新开。
  - `electron/main.js` + `electron/preload.js`: 新增 `web:openOrSwitch` IPC 与 `webOpenOrSwitch` API。
  - `src/pages/webGamePage.js`: `openUrl`(侧栏收藏夹网址/最近历史/收藏夹行点击)改走 **openOrSwitch**(切换优先); 右键「▶ 新标签打开」保留强制新开(openUrlNewTab)。
- 验证: 4 文件 `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [修复] v1.9.25: 悬浮窗关闭后左上角残留小窗 + 切走页面停止网页媒体播放
- 需求: ① 网页悬浮窗点关闭后, 应用窗口左上角出现一个小窗口, 应不显示; ② 打开网页时切换到别的页面, 应停止网页中的媒体播放(参考 Chrome 后台标签页处理)。
- 实现(`electron/tools/webGame.js`):
  - floatClose 关闭悬浮窗时, 视图迁回主窗口后 **setBounds(0×0) 隐藏**(此前保留悬浮窗内坐标 → 主窗口左上角残留小窗); 切回抓取页时 syncBounds 恢复显示。
  - 新增 `pauseMedia()`: 向活动标签页注入 JS 暂停全部 `video/audio`(参考 Chrome 切走标签页时后台页媒体处理); **floatOut(切离抓取页)与 floatClose(关闭悬浮窗)时调用**, 切换到其它页面即停止网页媒体播放; 悬浮窗还原后由用户手动继续播放。
- 验证: webGame.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [修复] v1.9.24: 悬浮窗关闭/最小化行为调整 + 资源列表类型筛选失效
- 需求: ① 悬浮窗点击关闭应真正关闭; 最小化应在原位置缩小为只有「还原+关闭」两个按钮; ② 资源列表类型按钮没选中时也显示资源、点击类型按钮无法筛选。
- 实现:
  - `electron/tools/webGame.js` + `public/float-window.html`: **关闭(✕) → 真正关闭悬浮窗**(网页视图迁回主窗口 + 销毁悬浮窗, 退出悬浮模式; 再切模块可重新悬浮); **最小化(─) → 在原位置居中缩小为 64×32 迷你按钮**(不再跳主窗口右上角), 迷你按钮仅含 **▶ 还原 + ✕ 关闭** 两按钮, 标题栏原生 `app-region: drag` 拖拽(移除上版 JS 拖拽)。
  - `src/pages/webGamePage.js`: **`shownRecords` 始终按类型筛选 chips 过滤** — 修复「仅下载不入库」勾选时列表无视类型筛选显示全部、导致点击类型按钮无法筛选; 「仅下载不入库」现在只影响下载后是否入库, 不影响列表显示; 「下载全部」仍下载全部可下载类型。
- 验证: webGame.js/webGamePage.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [修复] v1.9.23: localStorage 持久化失效根因(端口随机) + 网页悬浮窗迷你按钮
- 需求: ① 网页悬浮窗最小化/关闭后无法恢复悬浮模式——最小化应缩小为可拖拽小按钮, 点击还原; ② 悬浮预览开关/仅下载不入库/类型筛选勾选状态未持久化。
- 根因(问题②③): `electron/server.js` `server.listen(0)` **端口随机** → 渲染端 origin(含端口)每次启动不同 → **localStorage 按 origin 隔离, 全部持久化状态(悬浮预览/仅下载不入库/类型筛选/搜索词/侧栏/音频模式等)重启后丢失**。
- 修复:
  - `electron/server.js`: **固定端口 13456**(EADDRINUSE 时 +1 重试, 最多 30 次) → origin 稳定, localStorage 持久化全部恢复生效。
  - 网页悬浮窗迷你按钮(`electron/tools/webGame.js` + `electron/main.js` + `electron/floatPreload.js` + `public/float-window.html`): 最小化/关闭按钮不再最小化到任务栏/隐藏, 而是**收起为 64×36 迷你按钮**(默认停靠主窗口右上角内侧, alwaysOnTop 悬停其上), 标题栏 JS 拖拽移动(原生 drag 不派发点击, 改 JS pointer 拖拽并区分"未移动=点击"), **点击还原**为迷你化前的大小/位置; 切回网页抓取页自动复位。
- 验证: server 端口两次启动均 13456(固定 OK); 4 个文件 `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.22: 资源行播放按钮 — 悬停显示, 点击在悬浮预览窗播放(不受开关限制)
- 需求: 悬停资源列表的音频/视频/动画/图片等资源时显示小播放按钮, 点击在悬浮预览窗中播放预览; 悬浮预览开关关闭时播放按钮也能弹出预览窗。
- 实现:
  - `src/pages/webGamePage.js` + `src/style.css`: 资源行新增 **`▶` 播放按钮**(`.wg-playbtn`, 行悬停时显示圆形按钮), 点击 `showPreview(rec)` **显式触发**(绕过 `wg-pv-enabled` 开关; 原悬停自动预览仍受开关控制)。
  - `public/preview-window.html`: 音频/视频渲染加 **autoplay 自动播放**(`play().catch` 兜底, 直连失败仍走 downloadDataUrl 兜底并恢复播放); **Spine 动画**优先显示组内图集预览图(`rec.thumb` + 兜底), 并保留下载入库/保存入口。
  - `electron/tools/webPreviewWindow.js`: 预览窗 `partition: 'persist:webgame'` — 共享网页抓取分区 session, 预览窗内 `<audio>/<video>/<img>` 直连外链携带 cookie/登录态, 避免需登录态/防盗链资源 403。
- 验证: webPreviewWindow.js/webGamePage.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.21: 悬浮窗位置/大小持久化(重启恢复)
- 需求: 悬浮窗的位置和缩放大小也要能记住。
- 实现(主进程持久化到 userData JSON 文件, 300ms 节流):
  - `electron/tools/webGame.js`: 网页悬浮窗(floatWin)创建时从 `userData/webgame-float-state.json` 恢复位置+大小(resize/move/close 事件保存); 恢复位置若不在任何显示器可见区(显示器变更)则回退默认左上角。
  - `electron/tools/webPreviewWindow.js`: 资源悬浮预览窗创建时恢复**大小**(用户调整过)与上次位置(lastPos, 用于手动预览/无鼠标定位); resize/move/close 事件持久化到 `userData/web-preview-state.json`; 悬停跟随鼠标定位(v1.9.19)不受影响。
- 验证: webGame.js/webPreviewWindow.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.20: 运行状态持久化 — 重启记住上次的选择/勾选
- 需求: 程序运行中的各种选择和勾选状态(如网络资源抓取的「仅下载不入库」「悬浮预览」、资源列表类型筛选等)重启后要能恢复。
- 实现(localStorage, 启动时已初始化过, 页面级读取无卡顿):
  - `src/pages/webGamePage.js`: 新增持久化 **`wg-only-url`(仅下载不入库勾选)**、**`wg-filter-types`(类型筛选 chips 选择数组 JSON)**、**`wg-search`(文件名搜索词)**; 页面初始化时恢复(过滤集合与 TYPE_GROUP 取交集校验)。
  - `src/viewers/audioViewer.js`: 音频播放器新增持久化 **`audio-mode`(播放模式)/`audio-rate`(倍速)/`audio-volume`(音量)**, init 恢复并同步控件, setMode/setRate/setVolume 变更即存。
  - 既有已持久化: 悬浮预览开关 `wg-pv-enabled`、输出目录/最近网址/历史/代理(settings)、目录列表页视图/排序、场景页分割尺寸、工具箱输入历史。
- 验证: webGamePage.js/audioViewer.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.19: 资源悬浮预览窗默认位置改为鼠标右下方(不遮挡缩略图/文件名)
- 需求: 悬浮预览窗开启后默认位置不要放在应用窗口右上角, 改为鼠标右边、不遮挡资源文件缩略图和文件名的位置。
- 实现:
  - `electron/tools/webPreviewWindow.js`: `show()` 位置策略改造——不可见时若带 `payload.mouse`(悬停资源行) → 定位到**光标右下方**(x+18 / y+14), 右侧/下方放不下则翻转到光标左侧/上方, 并 clamp 到鼠标所在显示器 workArea(`getDisplayNearestPoint`); 窗口已可见不动(拖动中不跳动); 无鼠标位置(手动预览等)仍用 lastPos/右上角兜底。
  - `src/pages/webGamePage.js`: 记录悬停鼠标屏幕坐标(`pvMouse = e.screenX/Y`, mouseenter 传入), 预览窗 payload 带 `mouse`; 右键「👁 预览」用菜单弹出位置(`ctxMenuPos`)。
- 验证: webPreviewWindow.js/webGamePage.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [修复] v1.9.18: 关闭窗口后进程残留(不彻底退出) + 启动 handler 顺序
- 需求: 点击关闭窗口后, 任务管理器里进程仍残留, 需确保关闭后彻底退出。
- 根因: 退出依赖 `window-all-closed` 事件, 但**主窗口关闭时网页悬浮窗(v1.9.14 floatWin)/悬浮预览窗等附属窗口仍开着 → 事件不触发 → 进程残留**。
- 修复:
  - `electron/main.js`: 主窗口 `win.on('closed')` 主动清理附属窗口(`webPreviewWindow.close()` + `webGame.destroy()` 内部销毁 floatWin)并 `app.quit()`, 不再依赖 window-all-closed; 保留原 window-all-closed 兜底。
  - 顺带修复 v1.9.16 重构引入的 **双重 `createWindow` 调用 + IPC handler 注册顺序错误**(渲染端启动 `db:read` 在 handler 注册前调用报错): 删除提前的 createWindow, 所有 handler 先注册、`createWindow` 移到 whenReady 末尾(唯一一次调用)。
- 验证: **真实关闭测试**(后台软件模式启动 → 枚举窗口发 WM_CLOSE 等效点击 ✕) → electron 进程数归零, 彻底退出; 冒烟(含 db:read 无报错)PASS。

## 2026-08-11

### [修复] v1.9.17: 启动黑屏优化(窗口出现前不再显示黑屏)
- 现象: v1.9.16 修复 6.5s 阻塞后, 打开窗口仍有约 2 秒黑屏(深色背景等待内容)。
- 定位(主进程启动探针): 主进程初始化仅 23ms; 黑屏来自 **createWindow 约 3.5 秒**(渲染进程冷启动 + HTML/JS 加载期间窗口已显示深色背景)。
- 修复:
  - `index.html`: body 增加 **启动骨架屏 `#splash`**(纯内联 CSS: 🎮 图标 + 「游戏资源管理器」标题 + 加载动画, CSP 允许 unsafe-inline)——渲染进程首帧即可绘制, JS 未就绪时不再显示纯黑背景。
  - `electron/main.js`(主进程): 窗口 `show: false` + `ready-to-show` 后再显示(首帧可绘制=骨架屏就绪), **窗口出现即见内容/骨架, 全程无黑屏**; 5 秒兜底强制显示防异常; 保留启动探针(`[main-init]` 各阶段耗时, 后续优化参考)。
  - `src/main.js`(渲染端): 首屏渲染完成后移除 `#splash`。
- 验证: 语法 `node --check` + vite build 通过; 完整冒烟 PASS(createWindow 约 3.5s 为渲染进程冷启动, 黑屏已由「窗口延后显示 + 骨架屏」消除)。

## 2026-08-11

### [修复] v1.9.16: 启动过慢(打开后要等好几秒才显示界面)
- 现象: 打开应用后需等数秒才显示界面内容, 比之前慢很多。
- 根因(冒烟探针逐段定位): `initUI` 内 `localStorage.getItem('sidebarHidden')` **首次访问耗时约 6.5 秒**——Electron 渲染进程 localStorage 首次访问需初始化 LevelDB, 该机器上极慢, 直接阻塞首屏渲染(启动 gap 4.9s 全在此)。
- 修复:
  - `src/ui.js`: 侧栏隐藏状态改为 **requestIdleCallback/空闲时读取应用**(首屏先按展开显示, 不再阻塞); 移除 initUI 末尾重复的 `renderCategories/renderMainArea`(由 main 统一渲染一次)。
  - `src/main.js`: **预览渲染器(PIXI.Application/WebGL)延迟到首屏渲染后后台初始化**(`preview.init` 不阻塞, `loadItem` 首次预览时自动 ensure)。
  - **pixi.js 918KB 动态导入**: 新建 `src/pixiLazy.js`(`getPixi`/`pixiRef`), 移除全部 7 处静态 `import * as PIXI`(main/preview/index/spinePlayer/spine38Player/dbPlayer/thumbnails/fguiLayoutPreview), 首次预览/缩略图/FGUI 编辑时才加载, 首屏只加载 438KB index; `@pixi/spine-pixi` 同步动态导入; window.PIXI 由 getPixi 首次加载时设置(DragonBones UMD 兼容)。
- 验证: 冒烟探针显示启动到渲染端首日志 gap 由 **~4.9 秒降至 ~4ms**(localStorage 不再阻塞); 9 个 JS `node --check` 通过; vite build 通过; 完整冒烟(含动画预览触发 pixi 动态加载 / DragonBones 运行时)PASS。

## 2026-08-11

### [新增] v1.9.15: 资源首页 — 删除目录默认项调整 + 目录管理模式(批量勾选/删除/移动)
- 需求: ① 资源首页右键删除目录时, 默认选项改为第一项「删除目录下的所有动画和子目录(仅从列表移除,不删磁盘文件)」; ② 首页增加「管理」按钮, 管理模式可勾选目录、批量勾选/全选后进行删除和移动。
- 实现:
  - `src/ui.js`: 删除目录对话框(`deleteCategoryDialog`)默认选中由「移动到未分类」改为第一项「删除所有动画和子目录」(`rbDel.checked = true`, 子目录区块联动自动隐藏); 新增 `batchDeleteCategories`(批量删除, 按默认语义 `removeCategoryAdvanced({deleteItems:true, subAction:'parent'})`, 确认框统计目录/子目录/动画数)与 `batchMoveCategoriesDialog`(批量移动, 目标排除选中目录及其子孙, 支持移至顶级); renderMainArea 全局主页分支传入 `onManageDelete/onManageMove`。
  - `src/pages/homePage.js`: 全局主页新增模块级管理模式状态 `homeManage`; 标题行增加「🛠 管理」按钮(管理时变「✓ 完成管理」); 管理模式下目录快捷入口每项前显示勾选框 + 「全选」+ 操作条(已选计数/📂 移动/🗑 删除, 未勾选时禁用); 管理模式点击目录不跳转。
  - `src/style.css`: `.home-title-row`(管理按钮右对齐)/`.home-mgmt-bar`/`.home-mgmt-selectall`/`.quick-cat.mgmt`/`.qc-check` 样式。
- 验证: homePage.js/ui.js `node --check` 通过; vite build + 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.14: 网页悬浮窗 — 可拖拽移动 / 最小化 / 关闭
- 需求: 网络资源抓取打开网页后切到其它模块, 网页以小窗口悬浮在应用左上角; 为该小窗口增加**拖拽移动位置 / 最小化 / 关闭**功能。
- 根因: 原 detach 用 `webSetBounds(0×0)` 隐藏浏览器视图, 但 syncBounds 将宽高 clamp 到最小 80 → 变成左上角 80×80 小窗且无法控制。
- 实现(借鉴 v1.9.0 悬浮预览窗的独立窗口方案, 解决「DOM 浮层盖不住 native WebContentsView」):
  - `electron/tools/webGame.js`: 新增网页悬浮窗 `floatWin`(frameless BrowserWindow + `float-window.html` 自绘标题栏, `-webkit-app-region: drag` 原生支持拖拽); `_moveView` 把活动 tab 的 WebContentsView 在主窗口与悬浮窗间迁移(`removeChildView`/`addChildView`); `floatOut`(切走时迁入悬浮窗并显示, 推送标题)/`floatBack`(切回抓取页时迁回主窗口并隐藏悬浮窗)/`floatMinimize`/`floatClose`(隐藏, 视图保留); `syncBounds` 悬浮时忽略主窗口布局; 窗口 resize 同步视图 bounds; tab 记录所在窗口, closeTab/close/destroy 兼容悬浮窗。
  - `electron/main.js`: 新增 `web:floatOut/floatBack` + `float:minimize/close` handler; `electron/preload.js` 暴露 `webFloatOut/webFloatBack`; 新建 `electron/floatPreload.js`(悬浮窗专用) 与 `public/float-window.html`(标题栏: 🌐 标题 + ─ 最小化 + ✕ 关闭, 按钮 no-drag)。
  - `src/pages/webGamePage.js`: `_webGameDetach` 由 `webSetBounds(0×0)` 改为 `webFloatOut()`; 回到抓取页时 `_webGameSyncBounds → webSetBounds → floatBack` 自动收回。
- 验证: 5 个 JS `node --check` 通过; vite build 通过(dist/float-window.html 已生成); 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.13: 捕获列表右键菜单增加「打开下载目录」
- 需求: 资源列表右键菜单增加「打开下载目录」, 已下载的资源可用系统文件管理器打开其所在目录。
- 实现: `src/pages/webGamePage.js` —— `ctxActions` 动态生成: 资源已下载(`rec.downloaded` 或 `rec.path`, 含 spine 组连带下载的配套)时插入「📂 打开下载目录」(位于「复制 URL」前), 点击调 `openDownloadDir(rec)` → `window.api.openPath(rec.path 所在目录)`, 未下载的资源不显示该菜单项。
- 验证: webGamePage.js `node --check` 通过; vite build + 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.12: 骨骼动画资源 — 预览图 + 配套整组保存 + 按域名/URL 路径归档
- 需求: ① 参考 `AIXdownload` 插件(content/anim-hook.js, 主世界注入 hook 引擎+扫描场景资源)监测骨骼动画资源的方法, 在资源列表显示**骨骼动画预览图片**; ② 保存 spine 资源时将 `.atlas/.png/.skel` 等配套文件**一起保存到同一目录**; ③ 保存时**先以网站域名建目录**, 再按资源 URL 相对路径归档。
- 实现(`src/pages/webGamePage.js`):
  - 归类修正扩展(借鉴插件「资源组」思路): 提取 `urlKeyOf` 复用; spine 组/Spine 类型记录取**同组(同目录同 base 名)第一个 .png 作为预览图**(`rec.thumb`); 组内 `.atlas/.atlas.txt/.png/.astc` 标记 `groupOnly`(随主文件整组保存、不再单独入库, 避免重复 spine 条目; 主文件 = `.skel/.json/.bin/.sk`)。
  - 资源列表缩略图: 由 `isImageUrl(r.url)` 改为 `r.thumb || isImageUrl(r.url)`, 兜底 `webThumbFetch` 改下载 `data-thumb`(预览图 URL)本身。
  - 下载保存: 目录改为 `{输出目录}/{网站域名}/{URL 相对路径目录}`, 去掉原 gameName/type 层(`typeDirName` 删除); spine 主文件下载后 `downloadSpineGroup` 把同组配套 `.atlas/.atlas.txt/.png/.skel/.bin/.sk` 一并下载到**同一目录**(已下载/重名自动跳过或加序号)。
  - 入库: `importToLibrary` 对 `groupOnly` 记录直接跳过(只保存文件)。
- 验证: `node --check` 通过; 预览图/groupOnly 单元验证 7 例全对(主文件有图非配套、atlas/png 配套、.sk 主文件、普通图片不受影响); vite build + 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.11: 网络资源抓取 — 「打开目录」按钮 + 下载选中去高亮
- 需求: ① 「下载选中」按钮前增加「打开目录」按钮(用系统文件管理器打开下载目录); ② 「下载选中」不再高亮。
- 实现: `src/pages/webGamePage.js` —— 操作栏新增 `#wg-open-dir` 按钮(位于「⬇ 下载选中」前), 点击调 `window.api.openPath(downloadRoot)`(复用现有 `shell:openPath` IPC, 未设置输出目录时提示);「⬇ 下载选中」移除 `primary` 高亮类(与其它普通按钮一致)。
- 验证: webGamePage.js `node --check` 通过; vite build 通过; 完整冒烟 PASS。

## 2026-08-11

### [新增] v1.9.10: 捕获列表 .sk 文件归类到 Spine 类型
- 需求: 资源列表中 `.sk` 类型的文件归类到 spine 类型(部分游戏用 `.sk` 表示 spine 骨骼数据)。
- 实现: `electron/tools/webGame.js` EXT_TYPE 新增 `[/\.sk(\?|$)/i, 'spine']`(`.skel` 规则在前不受影响;直接归 `spine` 使类型筛选 chip / 下载目录 / 入库 Spine 分支全部生效)。
- 验证: classify 单元验证 10 例全对(`.sk`/`.sk?query` → spine;`.skel` → spine-skel;`.risk`/`.task`/`.ask` 不误伤);`node --check` + vite build 通过。

## 2026-08-11

### [新增] v1.9.9: 网址收藏夹取消「未分类」+ 收藏必须选分类
- 需求: ① 取消网址收藏夹的「未分类」节点; ② 收藏网址时必须选择分类, 若无分类则要求手动输入分类名称(自动新建)。
- 实现:
  - `src/ui.js`: 侧栏「网址收藏夹」移除「未分类」节点(及 v1.9.8 的 renameUncatDialog); 根节点点击进入收藏夹面板「全部」视图; 删除分类提示文案改为「网址移到父分类」。
  - `src/state.js`: `removeWebBookmarkCategory` 删除分类时网址 `categoryId` 提升到父分类(原置空为未分类)。
  - `src/pages/webGamePage.js`: 收藏夹面板新增「全部」虚拟视图(`curBmCat='all'`, 顶部显示「全部」, 列出全部分类网址); 收藏网址对话框**分类必选**——有分类时 select 选择(可「➕ 新建分类...」二次输入名称自动建分类), 无分类时直接输入分类名称新建; 「移动到...」移除「未分类」选项(无分类时提示先创建); 面板「＋ 新建目录」在全部视图下建于顶级; `catPathName` 支持递归路径与「全部」。
- 验证: 三个 JS `node --check` 通过; vite build 通过; 完整冒烟(含 webgame 页 + 收藏夹 CRUD)全部 PASS。

## 2026-08-11

### [新增] v1.9.8: 网址收藏夹 — 点击新标签打开 + 移动到分类 + 「未分类」可重命名
- 需求: ① 收藏夹列表点击网址项由复制改为**新标签页打开**; ② 收藏夹列表右键菜单增加「移动到...」; ③ 侧栏树中「未分类」与分类目录平级且可重命名为普通分类。
- 实现:
  - `src/pages/webGamePage.js`: 收藏夹行点击 → `openUrl`(新标签打开, 复制移入右键菜单); 右键菜单新增「📂 移动到...」→ `moveBookmarkDialog`(select 列出全部分类含未分类, `updateWebBookmark` 改 `categoryId`, 支持嵌套分类路径名 `catPathName`); 新增 `refreshTree()`——收藏增/改/删/移/建目录后回调 `container._webGameTreeRefresher` 同步左侧树(计数与结构)。
  - `src/ui.js`: 侧栏「未分类」节点**始终显示**(与分类目录平级, 不再仅在有网址时出现) + 右键「重命名(转为普通分类)」→ `renameUncatDialog`(创建新分类并把未分类网址全部移入); `renderWebGamePage` 调用后挂接 `pageEl._webGameTreeRefresher = renderTree`。
- 验证: 两个 JS `node --check` 通过; vite build 通过; 完整冒烟(含 webgame 页 + 收藏夹 CRUD)全部 PASS。

## 2026-08-11

### [新增] v1.9.7: 网络资源抓取 — 多标签页浏览 + 收藏夹增强
- 需求: ① 收藏网址对话框默认预填浏览器当前网址; ② 点击收藏夹中的网址 → **新开网页标签页**打开; 收藏夹列表右键菜单含 复制网址/修改/删除。
- 多标签实现(主进程 `electron/tools/webGame.js` 重构): `WebGameView` 由单 `WebContentsView` 升级为 `tabs: Map<id,{view,url,title}>` 多标签;`_createTab` 统一创建(继承静音/弹窗拦截/标题导航事件, 事件内 `emitTabs` 推送标签列表);`syncBounds` 仅活动标签显示在浏览器矩形、其余 0×0 隐藏(满足 WebContentsView 叠放约束);新增 `newTab`(收藏/侧栏打开)/`switchTab`/`closeTab`(关闭活动标签自动切到相邻)/`getCurrentUrl`(收藏预填)/`getTabs`;`open` 语义=当前标签导航或首开;`close`=关闭全部标签。`main.js` 新增 `web:newTab/switchTab/closeTab/getUrl` handler;`preload.js` 暴露 `webNewTab/webSwitchTab/webCloseTab/webGetUrl/onWebTabs`。
- 渲染端(`src/pages/webGamePage.js`): 顶栏下新增标签条 `#wg-tabs`(点击切换/×关闭/＋新开空白标签聚焦地址栏, 空标签自动隐藏);`onWebStatus navigated` 同步地址栏; 收藏网址对话框(`#wg-bm-add-url`)打开时 `webGetUrl` 预填当前网址; 收藏夹行右键菜单(复制网址/新标签打开/修改/删除, 右键菜单通用化为 `showMenu`); 修复遗留 bug——收藏列表「▶ 打开」调用的 `openUrl` 此前未定义; 收藏夹/侧栏收藏夹节点/最近历史打开网址统一走 `openUrl`(新开标签, 主窗口未激活过则兜底 `webOpen` 首开)。`src/style.css` 新增 `.wg-tabs/.wg-tab/.wg-tab-add` 标签条样式。
- 验证: 4 个 JS `node --check` 通过; vite build 通过; 完整冒烟(含 webgame 页 + 收藏夹 CRUD)全部 PASS。

## 2026-08-11

### [新增] v1.9.6: API 管理模块 — 项目管理 + API 数据字典 + 接口测试
- 需求: 「API 管理」内新增项目管理功能: ①建立/管理子分类; ②为分类中的项目建立/管理 API 数据字典; ③API 接口测试。
- 数据层(三级模型): `api_categories`(分类树,可嵌套) → `api_projects`(项目,挂分类下) → `api_endpoints`(数据字典接口)。
  - `electron/db.js`: 新建三表 + readDb 读取(JSON 列解析) + writeDb 全量事务写入 + 默认值。
  - `src/state.js`: state 三数组 + loadState 兼容 + CRUD(add/update/remove/byId/children/inCategory/inProject; 删分类子分类提升+项目移未分类; 删项目级联删接口)。
- 接口测试(渲染端 CSP 无法直连外网): 新增 `electron/tools/apiTest.js`(Node http/https, rejectUnauthorized:false, 请求头/请求体/超时/可选代理/重定向≤5次/响应体 2MB 截断) → `electron/main.js` 注册 `api:test` → `preload.js` 暴露 `apiTest`。
- UI(`src/pages/apiPage.js` 重构 + `src/style.css`): 双标签页「🗂 项目管理 / 📖 API 文档」(文档 tab 保留原 iframe)。
  - 项目管理: 左栏分类树(可嵌套/折叠/右键菜单) + 未分类节点; 总览统计; 分类视图(项目卡片); 项目视图(Base URL + 数据字典列表 + 接口详情表单)。
  - 接口详情: 名称/方法/路径/说明/请求参数表(名/类型/必填/说明)/请求头表/请求体/响应示例, 保存按钮。
  - 接口测试面板: URL(默认 baseUrl+path)/方法/请求头("Name: Value" 行)/请求体/超时/代理, 发送后展示状态码/耗时/大小/响应头/格式化响应体/复制。
- 验证: 6 个 JS `node --check` 通过; vite build 通过; 冒烟扩展(devtools-smoke-main.js): 分类→项目→接口 CRUD + **真实请求本地 server 返回 200** + 文档 tab, **PASS**; 冒烟数据自动清理。

## 2026-08-11

### [新增] v1.9.5: 开发工具箱模块 — API 管理(内嵌 API 参考文档)
- 需求: 新增侧栏「开发工具箱」根节点, 将 `E:\MyProject\api_page\index.html`(Stripe 风格 API 参考文档, 零外部依赖) 移植为子节点模块「API 管理」。
- 实现:
  - 侧栏树新增「🛠️ 开发工具箱」根节点(`__devtools__`, 默认展开可折叠, 初始值加入 `expandedCats`) + 子节点「📖 API 管理」(`__devtool:api`); 点击根/子节点 → `enterApiDoc()`。
  - 源文档原样复制到 `public/api-doc.html`(vite 构建随 dist 输出, 本地 HTTP 服务直接可访问)。
  - 新增独立页 `#page-api` + `src/pages/apiPage.js`(`renderApiPage`): 以 iframe(`./api-doc.html`) 隔离嵌入, 文档自身样式/脚本/主题/语言切换 100% 保真, 与主应用互不污染; 懒加载 + 复用实例(保留滚动位置/语言/主题状态)。
  - 全链路接入: `showPage('api')` / `renderMainArea` 分支 / `clearOverlays` / `updateBackSpecial` / 面包屑「主页/开发工具箱/API 管理」/ 主区多标签「API 管理」(`syncTabFromState` + `applyTabState`)。
  - `src/style.css`: `.page-api` / `.api-doc-wrap` / `.api-doc-frame` 布局样式。
- 验证: 语法 `node --check` 通过; vite build 通过; 新增 `scripts/devtools-smoke-main.js` + `run_devtools_smoke.js` 冒烟 **PASS**(侧栏节点/页面显示/iframe 加载文档标题与导航/标签条/面包屑/返回回首页)。

## 2026-08-11

### [新增] v1.9.4: 捕获列表资源归类修正(.bin/.fui → FGUI; spine 配套资源 → Spine)
- 需求:① `.bin`/`.fui` 归类到 FGUI 类型;② 部分 `.bin` 实为 spine `.skel` 改后缀,其**同名**(同目录同 base 名)的 `.bin/.skel/.atlas/.atlas.txt/.astc/.png` 统一归类到 Spine 类型。
- 实现:
  - `electron/tools/webGame.js`:EXT_TYPE 新增 `\.fui → fgui`(.bin 保留 'bin',由渲染端分组判定)。
  - `src/pages/webGamePage.js`:新增 `fixRecordTypes()`——按(目录,base 名)分组,组内含 `.skel`/`.atlas(.txt)` 判为 spine 组,组内 `SPINE_SIB_EXT`(.bin/.skel/.atlas/.atlas.txt/.astc/.png)全部归 `spine`;非 spine 组的 `.bin/.fui` 归 `fgui`;`onWebCaptured` 新记录与 `init()` 初始加载后全量重算。缩略图条件由 `r.type==='image'` 改为 `isImageUrl(r.url)`(归为 spine 的图片仍显示缩略图)。入库 `importToLibrary` 类型优先级改为**修正后的明确类型优先**(KNOWN_TYPES 含 fgui/spine 等),避免 skel 改名 bin 下载探测为 'bin' 走错 FGUI 分支;json→config 等仍保留下载后探测升级能力。
- 验证:语法 `node --check` 通过;归类算法单元验证通过(hero 组→spine、ui_pkg.bin/.fui→fgui、普通 png→image、跨目录同名互不影响);vite build 通过。

## 2026-08-11

### [新增] v1.9.3: 网络资源抓取捕获列表增加文件名搜索过滤
- 需求:在筛选行「悬浮预览」开关(`#wg-pv-switch`)前增加搜索框,按文件名过滤捕获列表。
- 实现:
  - `src/pages/webGamePage.js`:筛选行新增 `#wg-search`(`type=search`, placeholder「🔍 搜索文件名...」);`shownRecords()` 增加搜索过滤——`searchText` 与 `fileNameOf(url)` 忽略大小写 `includes` 匹配,与类型 chips 筛选/**仅下载不入库**模式叠加;`input` 事件实时 `renderList()`(条数统计/全选计数基于过滤后集合自动同步)。
  - `src/style.css`:新增 `.wg-search`(深色输入框,placeholder 弱化,聚焦描边高亮,`flex:0 1 150px` 不挤占右侧开关)。
- 验证:webGamePage.js `node --check` 通过;vite build 通过。

## 2026-08-11

### [修复] v1.9.2: 捕获列表图片缩略图无法显示 + 悬浮预览开关
- 现象:网络资源抓取捕获列表中,图片类型缩略图空白(直连失败时兜底崩溃);且悬浮预览窗无总开关。
- 缩略图修复根因:①直连失败兜底调用已被 v1.9.0 删除的 `loadMediaPreview` → 抛 ReferenceError,兜底失效(必现 bug);②`<img src=原始URL>` 在主窗口默认 session 加载,与网页 `persist:webgame` 分区 session(登录态/cookie)隔离,且直连无 Referer → 需登录态/防盗链的图 403。
- 实现:
  - `electron/tools/webGame.js`:新增 `WebGameView.fetchToDataUrl()`——用 `ses.fetch(url, {credentials:'include', headers:{referer}})`(**与网页共享 cookie/登录态/Referer**)下载并转 base64 data URL,4MB 上限(最大 8MB),mime 优先扩展名表 `THUMB_MIME`(防 CDN 返回 text/plain)。
  - `electron/main.js`:新增 `web:thumbFetch` handler 调 `webGame.fetchToDataUrl`。
  - `electron/preload.js`:暴露 `webThumbFetch`。
  - `src/pages/webGamePage.js`:缩略图 error 兜底改调 `webThumbFetch` + `dataset.tried` 防重试死循环 + `thumbCache` 内存缓存;新增 `#wg-pv-switch`「悬浮预览」开关(`#wg-onlyurl` 前,默认开,localStorage `wg-pv-enabled` 持久化),关闭时取消待弹计时器并 `webPreviewClose` 关闭当前窗,`schedulePreview` 开头 `if (!pvEnabled) return`;右键「👁 预览」手动打开不受开关影响。
  - `src/style.css`:新增 `.wg-filter-pv`(与 `.wg-filter-onlyurl` 同款),`margin-left:auto` 移到开关组,整体右对齐。
- 验证:四个 JS 文件 `node --check` 通过;vite build 通过。

## 2026-08-10

### [修复] v1.9.1: 悬浮预览窗(独立窗口)不再随鼠标移动
- 现象:v1.9.0 独立预览窗每次悬停资源行都会重新定位到鼠标旁,窗口跟着鼠标跳。
- 修复(`electron/tools/webPreviewWindow.js`):定位策略改为——窗口已可见 → **原地不动,只更新内容**;首次显示 → 屏幕右上角(主显示器 workArea 右上,偏移 16px);隐藏/拖动过后 → **记住上次位置(`lastPos`),再次显示恢复到原位**。`showNearCursor` 更名 `show`,主进程 `web:previewShow` 同步更新。
- 交互:悬停行只在首次弹出时定位一次,之后窗口固定在用户放置的位置(可自由拖动),不再随鼠标移动。
- 验证:CJS `node --check` 通过;vite build 通过。

### [新增] v1.9.0: 悬浮预览窗改为独立窗口(像 DevTools detach)
- 需求:预览窗拖到浏览器区上方时不再冻结网页画面 → 改为**独立 BrowserWindow**(像 DevTools detach 一样脱离主窗口),彻底绕开「DOM 无法覆盖原生 WebContentsView」约束——原生窗口天然悬浮在所有窗口之上,可自由拖到浏览器区上方,无遮挡/无黑屏/无冻结,浏览区始终实时。
- 实现:
  - 新增 `electron/tools/webPreviewWindow.js`:单例 `BrowserWindow`(420×360,可缩放,普通系统标题栏自带拖动/关闭),`showNearCursor`(按 `screen.getCursorScreenPoint()` 定位,不抢焦点)、`hide`(**鼠标仍在预览窗内时不隐藏**,防止移入瞬间被关)、`togglePin/setPin`(alwaysOnTop)、关闭/置顶时经回调通知主窗口。
  - 新增 `public/preview-window.html`(vite 复制到 dist,主进程 `loadFile`):独立页面按类型渲染预览(图片/音频/视频/字体/文本脚本 + FGUI 打开/Spine 入库按钮 + 保存按钮),📌 切换置顶;**点击进入窗口自动置顶常驻**;配 `electron/previewPreload.js`(previewApi:onContent/onPinState/downloadDataUrl/fetchText/togglePin/setPin/action)。
  - `electron/main.js`:抽取共享 `mimeOfExt`/`downloadToDataUrl`/`fetchTextOf`(fs:readBase64、web:fetchText、preview:downloadDataUrl、preview:fetchText 统一复用);新增 `web:previewShow/Hide/Close` + `preview:togglePin/setPin/downloadDataUrl/fetchText` + `preview:action`(转发回主窗口);移除 `web:captureBrowser`(快照方案废弃)。
  - `electron/preload.js`:新增 webPreviewShow/Hide/Close + onWebPreviewAction/onWebPreviewPinState/onWebPreviewClosed;移除 webCaptureBrowser。
  - `src/pages/webGamePage.js`:删除 DOM 预览窗(`#wg-pv`)、`syncBrowserOcclusion`/快照垫底全部代码与相关 CSS;悬停改调 `webPreviewShow(payload)`(类型/URL/文件名/大小/referrer),移出未置顶自动隐藏;`onWebPreviewAction` 回传 save/fgui/spine 动作复用 saveSingleRec/openFguiPreview/openSpinePreview;`_webGameDetach` 同步隐藏预览窗。
- 交互说明:悬停资源行 350ms → 独立预览窗出现在鼠标旁;移出列表 280ms 自动隐藏(置顶时除外);点进预览窗即自动置顶常驻,可拖到浏览器区上方任意位置;📌 取消置顶后恢复自动隐藏;✕ 关闭/OS 关闭后置顶状态复位。
- 验证:vite build 通过(dist 含 preview-window.html);electron CJS 五文件 `node --check` 通过。

### [修复] v1.8.9: 悬浮预览窗移到浏览器区上方不再黑屏
- 现象:v1.8.7 起预览窗与浏览器区重叠时隐藏整个 `WebContentsView`(bounds 0×0),浏览器区背后 DOM 为空 → 整块黑屏。
- 修复:**隐藏原生视图前先用 `webContents.capturePage()` 截图,把画面快照 `<img class="wg-browser-snap">` 铺满 `.wg-browser` 垫底**;预览窗(DOM,z-index 9998)浮在快照上方;移出不重叠/关闭预览/离开页面时恢复真实视图并清除快照。浏览器区在预览期间显示冻结画面(不再黑屏),真实视图恢复后继续实时。
- 新增链路:`WebGameView.captureBrowser()`(capturePage→toDataURL, 空图/未打开返回错误)→ `web:captureBrowser` IPC → preload `webCaptureBrowser` → 渲染端 `syncBrowserOcclusion`(重叠时先截图再 `webSetBounds({0,0})`, 非重叠/隐藏时清快照+恢复)。
- 文件改动:`electron/tools/webGame.js`(+captureBrowser)、`electron/main.js`(+IPC)、`electron/preload.js`(+1)、`src/pages/webGamePage.js`(模板+快照 img、syncBrowserOcclusion 异步化、_webGameDetach 清快照)、`src/style.css`(.wg-browser-snap)。
- 验证:node --check 三文件通过;vite build 通过(729 模块)。

### [修复] v1.8.8: 侧栏默认折叠 + 折叠按钮修复 + 预览窗音频播放
- 修复 1: 侧栏「XX资源」类型根节点**默认处于折叠状态**(`expandedCats` 初始值不再含 `'all'`);「网络资源抓取」「网址收藏夹」折叠按钮点击无效——根因是 `renderWebGameSection` 每次渲染都强制 `expandedCats.add('__webgame__'/'__webgame_fav__')`,折叠后立即被重新展开;改为仅初始默认展开(初始 Set 含这两键),折叠/展开状态可持久。
- 配套:新建顶级目录(`newCategoryDialog`)时 `expandedCats.add('all')`,保证新目录在折叠状态下仍可见(同时兼容冒烟 `catInTree` 断言)。
- 修复 2: 悬浮预览窗音频无法播放。根因:①直连 URL 常因缺 referrer/登录态被 403;②回退用的 `file://` 在渲染进程不可靠;③`fs:readBase64` 的 mime 映射只有图片类型,音频返回 `application/octet-stream` 无法播。方案:音频/视频预览 onerror 时改走「主进程带 referrer 下载 → readBase64 → data URL」播放(带 `dataset.fb` 防循环);`readBase64` mime 映射扩充音频(mp3/wav/ogg/m4a/flac/aac/opus)与视频(mp4/webm/mov/m4v/avi/mkv)及字体类型;删除无用 `loadMediaPath`。
- 文件改动:`src/ui.js`(expandedCats 初始值/renderWebGameSection/newCategoryDialog)、`src/pages/webGamePage.js`(audio/video 回退)、`electron/main.js`(readBase64 mime 表)。
- 验证:vite build 通过;electron CJS `node --check` 通过。

### [修复] v1.8.7: 悬浮预览窗图钉固定位置 + 不被浏览器区遮挡
- 修复 1: 图钉置顶常驻后预览窗**固定位置,不再随鼠标移动而移动**(`showPreview` 仅首次显示时按鼠标定位;图钉状态下悬停其它行只更新内容,不重定位)。
- 修复 2: 预览窗与浏览器区重叠时**不再被遮挡**。根因:内嵌浏览器是 `WebContentsView` 原生视图,永远叠在 DOM 之上(z-index 无法超过原生视图)。方案:新增 `syncBrowserOcclusion()`——预览窗与浏览器区矩形重叠时临时 `webSetBounds({0,0})` 隐藏浏览器视图,让预览窗浮到最上层;移出不重叠/关闭预览后自动恢复浏览器视图。在显示/拖拽移动/窗口 resize 时均触发检查,`_webGameDetach` 同步重置遮挡标记。
- 文件改动:`src/pages/webGamePage.js`(showPreview 定位逻辑 + syncBrowserOcclusion 新增)。
- 验证:vite build 通过(729 模块);electron CJS `node --check` 通过。

### [新增] v1.8.6: 网络资源抓取—勾选框/缩略图/右键保存/悬浮预览窗
- 捕获列表权限管理:①每行前加勾选框,`#wg-dl-sel`「下载选中」只下载勾选的资源;②筛选行「资源数据」后加「全选」复选框 +「已选 N」计数;全选/取消全选作用于当前筛选结果。
- 图片资源缩略图:列表行中 `image` 类型显示 28×28 缩略图(`<img>` direct URL;加载失败自动 fallback 下载到 temp + data URL)。
- 右键菜单:列表中右键弹出自定义菜单,含「💾 保存此资源…」(downloadOne + 不入库时入库)、「👁 预览」、「🔗 复制 URL」;点击外部/滚动自动关闭。
- 悬浮预览窗(`.wg-pv`):hover 鼠标移到列表行 350ms 后显示,鼠标移出 280ms 后自动消失。
  - 可**拖动标题栏**移动位置,支持**CSS resize 边框缩放**,📌**图钉按钮**常驻(不自动消失),✕ 关闭。
  - 预览内容按类型:「image」`<img>`(onerror→temp download+data URL)、「audio/video」`<audio/video controls>`(onerror→temp `file://`)、「font」@font-face 样本文字、「text/script/config/json/xml/css/html/other」`web:fetchText` IPC→`<pre>`、**FGUI/bin**→「在 FGUI 编辑器中打开」(temp download bin→`scene:navigate` 事件→FGUI 编辑器)、**Spine**→「下载并加入资源库」(temp download skel/json+atlas+png→`addItem` 入库「网页游戏预览」→预览页可打开)。
  - 底部统一「⬇ 保存此资源」按钮,调用 `saveSingleRec`(下载+入库)。
- 新增 IPC `web:fetchText`:主进程下载 URL 正文→临时文件→读取 UTF-8(截断 ~1MB)→返回文本,供文本/脚本/配置预览旁路 CSP 限制。preload 暴露 `webFetchText`。
- 文件改动:`src/pages/webGamePage.js`(renderList 重写+7 个新函数+2 个 DOM 容器)、`src/style.css`(12 个新选择器~75 行)、`electron/main.js`(+28 行 fetchText 处理器)、`electron/preload.js`(+1 `webFetchText`)。
- 验证:vite build 通过(729 模块);electron CJS 三文件 `node --check` 通过。

### [说明] 发布 v1.8.5
- 版本号由 v1.8.4 提升至 v1.8.5(用户反馈微调)。
- 本次微调:①状态文本 `#wg-status` 移入地址栏尾部(`.wg-url-wrap` 内绝对定位,`right:10px`,灰色 `rgba(255,255,255,0.45)` + 半透明底),地址栏输入加 `padding-right:88px` 避免文字被覆盖;长状态自动省略号截断。②`</>` DevTools 按钮从「刷新」后移到「🔖 收藏」按钮之后。
- 验证:vite build 通过;electron CJS 三文件 `node --check` 通过。pack-manual 打包便携版,rcedit 注入 v1.8.5 版本字符串。
- 产物:`release/游戏资源管理器-v1.8.5-便携版.zip`。

---

## 2026-08-10

### [说明] 发布 v1.8.4
- 版本号由 v1.8.3 提升至 v1.8.4(用户反馈微调)。
- 本次微调:顶栏「🧰 DevTools」按钮改为**只显示 `</>` 符号**(去掉文字,缩短宽度),tooltip 保留「打开网页 DevTools(独立窗口...)」说明;`#wg-devtools` 加等宽字体 + `padding:0 8px;min-width:30px` 收窄,与静音图标按钮一致。
- 验证:vite build 通过;electron CJS 三文件 `node --check` 通过。pack-manual 打包便携版,rcedit 注入 v1.8.4 版本字符串。
- 产物:`release/游戏资源管理器-v1.8.4-便携版.zip`。

---

## 2026-08-10

### [说明] 发布 v1.8.3
- 版本号由 v1.8.2 提升至 v1.8.3(用户反馈微调)。
- 本次微调:①「🗂隐藏侧栏」改为**折叠侧栏高度(≈0)并让浏览器区 `flex:1` 占据空出区域**(不再 `display:none` 留白),切换后重新上报浏览器视图矩形使内嵌网页跟随缩放;②网页音频静音/播放切换按钮改为**纯图标**(🔊/🔇,无文字,缩短按钮宽度),tooltip 保留状态说明。
- 验证:vite build 通过;electron CJS 三文件 `node --check` 通过。pack-manual 打包便携版,rcedit 注入 v1.8.3 版本字符串。
- 产物:`release/游戏资源管理器-v1.8.3-便携版.zip`。

---

## 2026-08-10

### [说明] 发布 v1.8.2
- 版本号由 v1.8.1 提升至 v1.8.2(用户要求每次完成任务都递增版本并构建 exe 以便测试)。
- 本次内容:网络资源抓取页 ①顶栏新增「🔊播放/🔇禁音」网页音频一键静音切换(新增 `web:setAudioMuted` IPC + preload `webSetAudioMuted` + `WebGameView.setAudioMuted`,静音状态继承到新打开网页) ②顶栏新增「🗂隐藏侧栏/👁显示侧栏」一键隐藏/显示 `.wg-side` ③资源捕获 tab 的「资源数据(*条/共**条)」与「仅下载不入库」开关移入类型筛选 chips 行(`#wg-filter`,chips 渲染容器改 `#wg-chips`)。
- 验证:vite build 通过(729 模块);electron CJS 三文件 `node --check` 通过;`src/main.js` 冒烟 `hasFilterChips` 改查 `#wg-chips` + 新增 `hasMuteBtn`/`hasToggleSideBtn`。pack-manual 打包便携版,rcedit 注入 v1.8.2 版本字符串。
- 产物:`release/游戏资源管理器-v1.8.2-便携版.zip`。

---

## 2026-08-10

### [新增] 网络资源抓取:顶栏静音 + 侧栏开关 + 筛选行整合
- **网页音频静音**:顶栏新增「🔊 播放 / 🔇 禁音」一键切换按钮,调用 `WebContentsView.webContents.setAudioMuted` 控制内嵌网页音频;静音状态会继承到新打开的网页。新增 IPC `web:setAudioMuted` + preload `webSetAudioMuted` + `WebGameView.setAudioMuted`。
- **侧栏隐藏/显示**:顶栏新增「🗂 隐藏侧栏 / 👁 显示侧栏」一键切换,控制 `.wg-side` 整块显示/隐藏(再次显示后自动重报浏览器视图矩形)。
- **筛选行整合**:资源捕获 tab 中的「资源数据(*条/共**条)」与「仅下载不入库」开关(`#wg-onlyurl`)由原独立行移入类型筛选 chips 行(`#wg-filter`),chips 渲染容器改为 `#wg-chips`,布局更紧凑。
- **验证**:vite build 通过;electron CJS 三文件 `node --check` 通过;冒烟用例新增 `#wg-mute` / `#wg-toggle-side` 检测。

---

## 2026-08-10

### [新增] 网络资源抓取:DevTools 独立窗口入口 + 网址收藏夹增强
- **DevTools 入口**:网络资源抓取页工具栏新增「🧰 DevTools」按钮,点击后以 `openDevTools({mode:'detach'})` **独立窗口**打开网页 DevTools(可查看 Network 请求/Console/Element,便于逆向分析);右键按钮可关闭。新增 IPC `web:devtools`(action open/close)+ preload `webOpenDevTools`/`webCloseDevTools`。
- **改名**:「网页游戏抓取」→「网络资源抓取」(侧栏节点/tab/面包屑/注释)。
- **网址收藏夹**:侧栏「🔖 网址收藏夹」分类树(可嵌套子目录,默认展开),网址条目增删改查;页面新增「🔖 收藏」按钮 +「📡 资源捕获 / 🔖 网址收藏夹」面板切换;收藏夹面板支持收藏当前 URL / 新建子目录 / 打开 / 编辑 / 删除;数据入 SQLite 新表 web_bookmark_categories / web_bookmarks。
- **分割线拖动**:浏览器区与资源区之间分割线可拖动调整比例(修复 flex-basis 覆盖 height 问题)。
- **滚动条**:网页显示区支持滚动条查看被遮挡区域。
- **验证**:58 步冒烟全绿(webgame 步骤含 DevTools 按钮/API、收藏夹 CRUD 7 项、分割线、面板切换)。

---

## 2026-08-10

### [说明] 版本号提升至 v1.8.0
- 版本号由 v1.7.17 提升为 v1.8.0（主版本号升级,内容同 v1.7.17：网页游戏逆向分析抓取模块 + FGUI 导出源工程声音修复）。

---

## 2026-08-10

### [说明] 发布 v1.7.17(便携版)
- 新增「网页游戏逆向分析与资源抓取」模块(内嵌浏览器拦截网络请求识别 FGUI/Spine/图集/音频等资源,下载入库);FGUI 导出源工程声音查找路径补全 audio 素材库。版本号 1.7.16 → 1.7.17。

---

## 2026-08-10

### [新增] 网页游戏逆向分析与资源抓取模块
- **能力**:侧栏新增「网页游戏抓取」根节点(🌐),进入独立页面后可打开任意网页游戏 URL —— 应用内用 WebContentsView(Electron 43 推荐替代已废弃 BrowserView)内嵌真实游戏页面,独立分区 session(`persist:webgame`)持久化登录态、不污染应用主 session;`session.webRequest` 拦截所有帧(含 iframe,兼容 4399 登录 iframe)的网络请求,按扩展名/content-type 自动分类为 FGUI / Spine / 图集 / 图片 / 音频 / 视频 / 字体 / 脚本 / 配置,实时推送到资源清单。
- **下载与入库**:选中或批量下载(fgui/spine/image/audio,主进程 https 下载,rejectUnauthorized:false + Referer/UA 防盗链 + 可选代理 + 进度条);下载后本地探测(.bin 魔数 FGUII / spine json 特征)精确分类;fgui .bin → `addScene`(subtype='fgui',可被 FGUI 编辑器打开),spine/image/audio → `addItem` 复用现有预览链路,零数据库 schema 改动;spine 自动按 basename 配对同目录 `.atlas` 填 atlasPath。
- **布局**:URL 输入 + 打开/停止/后退/前进/刷新 + 类型筛选 chips + 捕获列表(点击复制 URL) + 输出目录选择 + 下载进度 + 仅下载不入库开关;浏览器区与列表区可拖动分割线调整。
- **持久化**:`webGameLastUrl`/`webGameSaveDir`/`webGameProxy`/`webGameHistory`(最近游戏历史,侧栏子节点点击直达)。
- **改动**:新建 `electron/tools/webGame.js`(WebGameView 单例:open/setBounds/close/destroy + hookWebRequest 拦截 + classify 分类 + downloadResource 下载 + probeFile 探测)、`src/pages/webGamePage.js`(页面 UI + 入库);修改 `electron/main.js`(web:* 10 个 IPC + window-all-closed 销毁)、`electron/preload.js`(10 invoke API + 4 事件监听)、`index.html`(#page-webgame 容器)、`src/ui.js`(webGameShown 状态 + 侧栏节点 + showPage/applyTabState/syncTabFromState/renderMainArea/updateBackSpecial/renderBreadcrumb 接入 + enterWebGame)、`src/state.js`(DEFAULT_SETTINGS 4 项)、`src/style.css`(wg- 样式段)、`src/main.js`(webgame 冒烟 case)、`scripts/pack-manual.js`(MAIN_DEPS 追加 http-proxy-agent/https-proxy-agent)。
- **验证**:classify 12 用例全 PASS;probeFile 真实文件(FGUI bin / spine json / DragonBones json)全 PASS;downloadResource 下载 example.com 559B 成功;端到端 Electron 实测 WebContentsView 打开 example.com 拦截推送成功;58 步冒烟全绿(webgame 步骤:侧栏节点/页面渲染/工具栏/筛选/下载按钮齐全,截图正常)。

---

## 2026-08-10

### [修复] FGUI 导出源工程:声音查找路径补全 audio 素材库
- **现象**:导出源工程时 Sound 资源常被跳过(`sound xxx: 磁盘未找到 <file>`),FairyGUI 编辑器打开后声音缺失。
- **根因**:`restoreSource.js` 声音候选路径仅含 bin 同目录(`<file>`/`<包名>_<file>`)与共享素材库 `ui/fgui_texture/fgui`,未覆盖 Cocos 等引擎把 FGUI 声音导出为独立音频素材目录 `audio/` 的布局。
- **修复**:`electron/tools/fgui/restoreSource.js` 声音查找增加 `{gameRoot}/audio/` 目录候选,支持三种命名(`<file>` / `<包名>_<file>` / `<资源名>.<ext>`);bin 同目录与共享素材库也补上 `<资源名>.<ext>` 候选。
- **验证**:异兽灵境(4399 H5, gameId=100073549)Common.bin 唯一 Sound `dianji`(o2q2ea.mp3) —— 修复前 `sounds=0` 且跳过,修复后 `sounds=1` 输出 `FGUI_src/Common/res/dianji.mp3`,与 CDN `assets/fgui/native/aa/aa8b1334...9d735.mp3` 及本地 `audio/Common_o2q2ea.mp3` MD5 一致(`9d735d6f...`)。回归:Basics 2 声音、Transition 1 声音均正常输出,`_test_restore_src.js` 全 PASS,`npm run build` 通过。

---

## 2026-08-10

### [说明] 发布 v1.7.16(便携版)
- FGUI 编辑器:编辑模式属性面板支持修改节点名称/id(保存时联动更新源工程 XML 及引用);srcPkg/sprite/atlas 属性可一键复制。版本号 1.7.15 → 1.7.16。

### [新增] FGUI 编辑器属性面板:名称/id 可编辑 + 字段复制
- **名称/id 编辑**:编辑模式下属性面板「名称」「id」改为文本输入框;修改后节点实时更新,点「💾 保存源工程」时与原始快照对比,仅变化项提交(`nodeOrig` Map 记录加载时的原始 id/name)。
- **保存联动更新关联引用**:`fgui:saveSourceEdits` 的节点新增 `name`/`newId` 字段;主进程按 XML id 匹配更新 name 属性;id 变更时**全局替换引号包裹的完整 token**(节点自身 id + relations target / controller action objectId / transition item target / group 等所有引用处同步更新)。
- **可复制字段**:srcPkg/sprite/atlas 在属性面板(编辑/非编辑模式)均显示为可复制行——值可选中(复制)或点 📋 按钮复制到剪贴板(事件委托 `_bindCopyButtons`,只绑一次)。
- **改动**:`src/viewers/fguiLayoutPreview.js`(`_renderProps` 名称/id 输入框+`copyable` 渲染+`_bindCopyButtons`;`_applyPropFromInput` 支持 name/id)、`src/pages/fguiEditorPage.js`(nodeOrig 快照、保存时增量提交 name/newId、保存后刷新快照)、`electron/tools/fgui/index.js`(saveSourceEdits 支持 name/newId + 引用全局替换)、`src/style.css`(复制按钮样式)。
- **验证**:主进程单测——节点 `n5_mah9` → `n5_zzz9` 且 name 写入,旧 id 引用 0 残留、新 id 出现、xy/size 更新 PASS;electron 冒烟——名称/id 输入框存在、修改后节点实时更新(名称=改名节点、id=n0_cb4z_x1)、3 个复制按钮、保存成功。

---

## 2026-08-10

### [说明] 发布 v1.7.15(便携版)
- FGUI 编辑器增强:组件列表/层级树分割线可拖动、层级树折叠展开、资源预览+主区 9 点高亮+属性关联、源工程编辑与保存。版本号 1.7.14 → 1.7.15。

### [新增] FGUI 编辑器四大增强
- **1) 分割线拖动**:组件列表与层级树之间的分割线可上下拖动,调整两个区域竖向空间比例(`#fge-hsplit`,pointer 事件调整组件列表高度)。
- **2) 层级树折叠**:层级树节点有子节点时显示 ▶/▼ 箭头,点击按层级折叠/展开(`hierCollapsed` Set 记录折叠节点)。
- **3) 资源预览 + 主区高亮 + 属性关联**:资源 tab 列表下方新增预览区;点击资源:
  - 图片:从图集纹理裁切 sprite 渲染到预览 canvas(支持 rotated 转回);主区用 **9 点可调边框**(2px 外框 + 8 缩放手柄,`FguiLayoutPreview.highlightResource`)高亮第一个使用该资源的节点;右侧属性面板显示 类型/id/名称/路径/尺寸/图集/图集位置/使用节点数。
  - 字体:显示名称与字形数;动画:显示名称与尺寸;声音:显示文件并可播放(读音频 dataUrl → Audio)。
  - 数据层 `buildPreviewData.resources` 扩展:Image 附带 `atlasKey+sprite`(含 atlasItemId),Sound 附带 `file`,Font 附带 `fontCount`。
- **4) 源工程编辑与保存**:工具栏新增「💾 保存源工程」,把当前组件树的编辑结果(节点 id/x/y/width/height/rotation/alpha/visible/scale)写回 `FGUI_src/<包名>/<组件>.xml` 的 displayList(源工程不存在时自动先还原);新增 IPC `fgui:saveSourceEdits`(`electron/tools/fgui/index.js` 的 `saveSourceEdits`,按 XML id 匹配更新 xy/size/scale/rotation/alpha/visible 属性)。
- **改动**:`src/pages/fguiEditorPage.js`、`src/viewers/fguiLayoutPreview.js`(highlightResource)、`electron/tools/fgui/previewData.js`、`electron/tools/fgui/index.js`、`electron/main.js`、`electron/preload.js`、`src/style.css`。
- **验证**:主进程单测——真实节点 id 的 xy/size/rotation/alpha/visible/scale 全部正确写回 XML(updated=1);electron 冒烟——分割线存在、层级树 76 箭头点击折叠 76→1、图片资源预览 canvas+主区高亮+属性面板齐全、保存按钮可用。

---

## 2026-08-10

### [说明] 发布 v1.7.14(便携版)
- FGUI 编辑器入口整合:菜单移入「资源工具箱」下;场景管理中 FGUI 包点击/右键改用 FGUI 编辑器打开;编辑器切页/切标签后保持打开文件与编辑状态。版本号 1.7.13 → 1.7.14。

### [新增] FGUI 编辑器入口整合与状态保持
- **1) 菜单位置**:左侧「FGUI编辑器」从独立 section 移入「资源工具箱」目录节点下(与 图片编辑/FGUI导出 并列,✏️ 图标)。
- **2) 场景 FGUI 包打开方式**:「游戏场景管理」树中的 FGUI 包条目(.bin)、场景主页入口卡片、场景目录页 🧩 按钮与行点击、最近添加列表、场景搜索结果,点击/打开均改用 **FGUI 编辑器**;保留原 FGUI 预览页代码作为内部功能。
- **3) 编辑器状态保持**:FGUI 编辑器页首次进入初始化一次(标记 `_fguiEditorInited`),切到其他菜单/标签再回来时保留已打开包、组件与编辑状态,不重建画布;外部再次加载走 `container._fguiEditorLoad`。
- **4) 右键「编辑器打开」**:侧栏场景树 FGUI 包条目右键菜单、场景主页「最近添加」FGUI 行右键、场景目录页 FGUI 行右键菜单,均新增「✏️ 用FGUI编辑器打开」。
- **改动**:`src/ui.js`(菜单/`enterFguiEditor`/`openFguiEditorFromScene`/scene:navigate/渲染分支/状态保持)、`src/pages/fguiEditorPage.js`(初始化一次+`_fguiEditorLoad`)、`src/pages/scenePage.js`(入口文案/右键菜单/行交互)。
- **验证**(electron 冒烟):菜单叶子在工具箱下;场景树 Bag 条目点击 → 编辑器打开(Bag v7,nodeMap 76);切走再切回状态保持(nodeMap 76 不变);右键菜单含「用FGUI编辑器打开」。

---

## 2026-08-10

### [说明] 发布 v1.7.13(便携版)
- 新增左侧菜单「FGUI编辑器」(位于资源工具箱下方):独立的 FairyGUI 包可视化编辑器,布局参考 FairyGUI-Editor-Online 的 IDE 结构(左资源面板/中画布/右属性),复用现有 FGUI 预览画布引擎与 .bin 解析。版本号 1.7.12 → 1.7.13。

### [新增] FGUI编辑器独立页面(参考 FairyGUI-Editor-Online / OpenFairyGUI)
- **入口**:左侧菜单栏「资源工具箱」下方新增「🧩 FGUI编辑器」菜单项,点击进入独立编辑器页。
- **布局**:顶栏(选择 .bin/组件下拉/撤销/编辑模式/导出源工程/打开目录/背景色)+ 左侧资源面板(组件列表+层级树,可切换「资源」tab 查看 图片/字体/动画/声音 清单)+ 中间画布 + 右侧属性面板(控制器+属性)。
- **改动**:
  - `src/pages/fguiEditorPage.js`(新):编辑器页逻辑,复用 `FguiLayoutPreview` 画布引擎与 `window.api.fguiPreviewLoad` 数据层;层级树点击 ↔ 画布选中联动;导出源工程输出到 `FGUI_src/<包名>`。
  - `electron/tools/fgui/previewData.js`:`buildPreviewData` 返回新增 `resources`(包内 items 按 图片/字体/动画/声音/组件 分组精简列表),供资源面板使用。
  - `src/ui.js`:新增菜单 section `renderFguiEditorSection`、状态 `fguiEditorShown`/`pendingFguiEditorBin`、`showPage('fgui-editor')`、`renderMainArea` 分支、tab 与面包屑/返回按钮适配。
  - `index.html`:新增 `#page-fgui-editor` 页面容器;`src/style.css`:新增 `.fge-*` 编辑器布局样式。
- **验证**(electron 冒烟):菜单出现 → 进入编辑器页 → 加载 `Bag.bin` 成功(`pkg=Bag`、图集纹理 3、层级树 76 项=nodeMap 76、控制器 8、资源面板正常)。

---

## 2026-08-10

### [说明] 发布 v1.7.12(便携版)
- FGUI 包预览工具栏移除「解压FGUI包」按钮,保留「导出源工程」;导出源工程输出目录由 `<包名>_src/<包名>/` 调整为 bin 同目录下的 `FGUI_src/<包名>/`(目录不存在时自动创建)。版本号 1.7.11 → 1.7.12。

### [新增] FGUI 界面预览:工具栏精简 + 导出源工程目录规范为 FGUI_src
- **改动**(`src/pages/scenePage.js`):移除「解压FGUI包」按钮(`#fgpv-unpack`)及其解压逻辑(`exportCurrentPkg`/`copySpritesToDir`),工具栏仅保留「导出源工程」;`exportSourcePkg` 输出根目录由 `bin同目录/<包名>_src` 改为 `bin同目录/FGUI_src`,包内容输出到 `FGUI_src/<包名>/`。
- **联动**(`electron/tools/fgui/previewData.js`):`sourcePngForItem`(位图字形源 PNG 兜底)与 `findFntFile`(.fnt 文本兜底)的导出源工程路径同步改为 `FGUI_src/<包名>/`,与导出逻辑保持一致。
- **验证**:samples/fgui 导出 `ActEmperorArrival.bin` → `FGUI_src/ActEmperorArrival/`(组件3+碎图11)、`Common.bin` → `FGUI_src/Common/`(组件113+碎图495+字体14);`findFntFile` 在新路径命中 `PowerFont3.fnt`。

---

## 2026-08-10

### [说明] 发布 v1.7.11(便携版)
- 真正修复 FGUI 预览中 PNG 预乘 alpha 处理:v1.7.10 把 Pixi v8 常量拼错(`premultiplied-alpha-on-upload` 带 ed 不是有效值),真实 GPU 上仍发白;v1.7.11 改为正确常量 `premultiply-alpha-on-upload`(单数),纹理上传 GPU 时正确预乘。版本号 1.7.10 → 1.7.11。

### [修复] FGUI 界面预览:预乘 alpha 常量拼写错误导致半透明边缘仍发白
- **现象**:v1.7.10 修改后,用户真实 GPU 环境下所有透明 PNG 图像的边缘仍发白(FairyGUI 编辑器中为半透明自然过渡)。
- **根因**:Pixi v8 的 `ALPHA_MODES` 有效值为 `'no-premultiply-alpha' | 'premultiply-alpha-on-upload' | 'premultiplied-alpha'`。v1.7.10 误写成 `'premultiplied-alpha-on-upload'`(过去式,不匹配任何常量)→ `GlTextureSystem` 中 `source.alphaMode === "premultiply-alpha-on-upload"` 恒为 false → `gl.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)` → 标准非预乘 PNG 以 straight 数据上传,却按预乘公式 `normal = (ONE, ONE_MINUS_SRC_ALPHA)` 混合 → 半透明白边缘像素过亮发白。
- **改动**(`src/viewers/fguiLayoutPreview.js` `loadTextureFromDataUrl`):`alphaMode` 改为 Pixi v8 正确常量 `'premultiply-alpha-on-upload'`(单数 premultiply),上传时 GPU 预乘,与 normal 混合公式匹配。
- **排查过程**:swiftshader 软渲染下三种 alphaMode 结果相同无法复现;通过对比用户截图(中央大片白色)、分析图集源 PNG(127079 个半透明白边像素 α∈(30,225) 且 RGB>150)、阅读 `GlTextureSystem.js`/`const.d.ts` 源码,确认常量拼写错误。
- **验证**:electron 运行时确认三张图集纹理 alphaMode 均为 `premultiply-alpha-on-upload`;头像边缘 avgEdge RGB=[26,28,34] 接近背景深色不发白。

---

## 2026-08-10

### [说明] 发布 v1.7.10(便携版)
- 修复 FGUI 预览中图集 PNG 的预乘 alpha 误标:半透明边缘像素不再发白,效果贴近 FairyGUI 编辑器。版本号 1.7.9 → 1.7.10。

### [修复] FGUI 界面预览:位图 PNG 强制预乘 alpha 导致图像周围发白
- **现象**:用户对比 FairyGUI 编辑器与本应用预览器,头像/字形图等"图像周围"出现明显白晕,编辑器中是半透明自然过渡。
- **根因**:`loadTextureFromDataUrl` 把 PIXI 纹理源 `alphaMode` 强制设为 `'premultiplied-alpha'`(假设数据已预乘),但 FairyGUI 输出的 PNG 是标准非预乘(straight alpha)。GPU 按预乘解读半透明像素(R,G,B 已乘 α)→ 边缘像素过亮显示为白色。
- **改动**(`src/viewers/fguiLayoutPreview.js`):`alphaMode` 改为 `'premultiplied-alpha-on-upload'`(Pixi v8 默认值,上传 GPU 时自动预乘),保留显式赋值以防默认值变动。
- **验证**:electron 重新截图 `Bag.bin` 的 `BagView`,头像周围白环消失、"战 1234567.890" 红底黄字清晰、"至尊 级" 棕底红字无白晕。dist 同步清理 100+ 历史 bundle 旧产物。

---

## 2026-08-10

### [说明] 发布 v1.7.9(便携版)
- 位图字体增加「导出源工程字形 PNG」兜底渲染:已核实 PowerFont3 的 13 个字形(sprite `s7rzi3v..44`/`myfwi47-49`)对应 item 全部位于 `/res/数字/主界面战力数字/`(`0-9.png`/`亿`/`点`/`万`),图集纹理缺失时直接从该目录加载独立 PNG 渲染,字体不退化。版本号 1.7.8 → 1.7.9。

### [新增] FGUI 界面预览:位图字体图集缺失时用导出源工程字形 PNG 兜底
- **现象**:位图字体(如 `PowerFont3` 战力数字)依赖图集纹理(`Common_atlas0.png`);若图集缺失/路径不符,字形无法渲染,数字退回系统字体。
- **改动**:
  - `electron/tools/fgui/previewData.js`:新增 `sourcePngForItem`,`glyphFromSprite` 为每个字形附带 `srcFile`(导出源工程独立 PNG:`<包名>_src/<包名>/<path>/<name>.png`,如 `Common_src/Common/res/数字/主界面战力数字/0.png`)。
  - `src/viewers/fguiLayoutPreview.js`:`load()` 时收集图集缺失的字形 `srcFile` 并预加载到 `_glyphTexs`;`_buildBitmapText` 图集纹理优先、缺失时退回独立 PNG(整图为 frame,不旋转)。
- **验证**:electron 真实运行——主路径 11 字形 sprite 不回归;强制置空 `Common_atlas0` 后兜底分支仍渲染 11 字形,`fromSrc:true` 确认使用 `主界面战力数字/*.png` 独立图,且尺寸与图集 frame 一致(数字 18×29、`.` 9×29)。

---

## 2026-08-10

### [说明] 发布 v1.7.8(便携版)
- FGUI 预览位图字体解析补全「.fnt 文本文件」兜底路径,并完成 PowerFont3(战力数字)端到端运行验证:字形表 → 图集 sprite → 图集 PNG 渲染链路确认生效。版本号 1.7.7 → 1.7.8。

### [新增] FGUI 界面预览:位图字体支持 .fnt 文本文件兜底解析
- **现象**:部分位图字体(Font 资源,如 `PowerFont3.fnt`)在源工程里是 `.fnt` 文本文件 + `res/数字/xxx/` 目录数字图片;发布后的 bin 里已内嵌字形表(每个字符 → 图集 sprite),但若内嵌字形表缺失/为空,预览将退回系统字体,丢失字体特效。
- **改动**(`electron/tools/fgui/previewData.js`):
  - 主路径保持 bin 内嵌字形表解码(`decodeBitmapFontGlyphs`,与导源工程 `restoreSource.decodeFontData` 读取顺序一致)。
  - 新增兜底:`findFntFile` 在 包目录 / `font`/`fonts`/`com/font`/`组件/font` / 导出源工程 `<包名>_src/<包名>/...` 中查找 `<字体名>.fnt` 文本文件;`parseFntTextFile` 解析 UIBuilder(`char id=N img=<spriteId>`)与 BMFont 标准(`common lineHeight`/`page file`/`char x,y,width,height`)两种格式,page 文件名按 name 匹配包内 Image item 取图集 sprite。
  - 抽出共用 `glyphFromSprite`(图集解析/纹理探测)供两条路径复用;字形结果结构一致,渲染层无需改动。
- **验证**:用户 `Common.bin` 的 `PowerFont3.fnt`(位于 `Common_src/Common/com/font/`)解析出 13 字形 `0123456789.万亿`,图集 rect 与内嵌解码完全一致;electron 真实运行确认 `powerLb`("1234567.890")渲染 11 个字形 sprite,三张图集纹理全部加载(`Common_atlas0` 1984×1664 等)。

### [说明] FGUI 预览位图字体渲染端到端验证
- 按用户提供的解析路径(`ui://<pkgId><fontId>` → Font item → 字形表 → 图集 sprite → 图集 PNG)确认预览器已完整实现并生效:`Bag.bin` 的 `topItem`(跨包引用 Common `UITopItem`)内 `powerLb` 文本 `font="ui://9njo6dpes7rzi45"` 正确解析为 PowerFont3 位图字体,字形 sprite 逐字排布(数字 18×29、`.` 9×29),tint 不生效(全彩字体 channel=0 保持原色)。

---

## 2026-08-10

### [说明] 发布 v1.7.7(便携版)
- 修复 FGUI 预览中组件 title 文本位置与格式错误,并新增位图字体渲染支持,使 emptyTip/按钮/战力数字等显示更接近 FairyGUI 编辑器效果。版本号 1.7.6 → 1.7.7。

### [新增] FGUI 界面预览:支持位图字体渲染
- **现象**:`topItem` 中的战力数字等使用 `ui://...` 引用的自定义位图字体(`PowerFont3` 等)时,预览中仍是默认系统字体,看不到字体特效。
- **根因**:文本渲染层仅支持系统字体(DOM overlay),未解析 FGUI `Font` 资源中的字形表,也没有把字形对应到图集 sprite。
- **改动**:
  - `electron/tools/fgui/previewData.js`:新增 `resolveFontItem`/`decodeBitmapFontGlyphs`,在生成文本节点时解析 `ui://<pkgId><fontId>` 位图字体引用,从 `.bin` raw 数据解码出每个字符对应的图集 sprite(`atlasKey`+`rect`)与 `xoffset/yoffset/advance/channel`),写入 `node.font`。
  - `src/viewers/fguiLayoutPreview.js`:新增 `_buildBitmapText`,按 advance 逐字排布 PIXI sprite,支持旋转图集、单/多行、水平/垂直对齐;单通道灰度字体用文本颜色着色,全彩字体保持原样。
- **验证**:用户提供的 `Bag.bin`/`Common.bin` 预览中,`powerLb` 的 `1234567.890` 已按 `PowerFont3` 字形渲染(截图 `_tmp_bag_preview.png`)。

### [修复] FGUI 界面预览:组件 title 文本位置与格式错误
- **现象**:`EmptyTips` 中的 "空空如也" 显示位置偏到左上角;`FrameCom` 等按钮的标题没有字号/颜色/对齐格式,显示为默认小黑字。
- **根因**:组件的 `props.title` 被合并为一个合成的 `<node>.title` 文本节点,强制放在 `(0,0)` 且 `textFormat=null`,覆盖了 displayList 中真实 `title` 对象的位置与样式。
- **改动**(`electron/tools/fgui/previewData.js`):合并 title 时,优先查找 displayList 中真实存在的 `name="title"` 文本子节点并更新其 `text`,保留其原有的 `x/y/size/color/align/valign`;找不到真实 title 对象时才回退为旧的合成节点。
- **验证**:用户 `Bag.bin` 的 `BagView` 预览中,`emptyTip.title` 位于 `[344,34]` 且使用 `size=24 color=#1d3630ff center/middle`;所有按钮标题(一键合成/一键熔炼/GM 等)均带有正确格式(截图 `_tmp_bag_preview.png`)。

---

## 2026-08-10

### [说明] 发布 v1.7.6(便携版)
- 在 v1.7.3 基础上累积多轮 FGUI「导出源工程」修复与预览增强:跨包引用 src 统一改为被引用资源 id 并补齐 pkg/fileName、组件目录规范为 com、组件文件按资源名命名、新增「打开目录」按钮。版本号 1.7.3 → 1.7.6。

### [修复] FGUI 导出源工程:跨包图片等非组件引用 src 也改为 id
- **现象**:上一版仅跨包组件 `src` 用 id,跨包图片仍为 `src="Common.已领取"`(包名.资源名),FairyGUI 源工程中图片无法显示。
- **改动**(`electron/tools/fgui/restoreSource.js`):`srcResolver` 对跨包引用(组件/图片等)统一取被引用资源的 `id`(`.bin` 中存储的 `ch.src`,如 `j8esi28`/`hp2kbi`)作为 `src`,不再区分类型;`pkg`(包 ID)保留定位跨包文件,`fileName` 仍仅组件标签输出。依赖包内找不到对应项时回退 `包名.资源名`。
- **验证**:`samples/fgui` 导出后跨包引用共 8 处(6 组件 + 2 图片)`src` 全部为 id,无 `包名.资源名` 残留。

### [修复] FGUI 导出源工程:跨包组件 src 改为被引用组件 id
- **现象**:导出源工程时,组件 displayList 中引用其它包的组件生成 `src="Common.FrameCom"`(包名.资源名),FairyGUI 编辑器无法正确解析跨包引用。
- **根因**:`restoreSource.js` 的 `srcResolver` 跨包解析成功时把 `src` 拼成了 `包名.资源名`。
- **改动**(`electron/tools/fgui/restoreSource.js`):跨包**组件**引用时 `src` 改为被引用组件的 `id`(`.bin` 中存储的 `ch.src` 即该 id,如 `gyk92q`),与同包引用格式一致;`pkg`(包 ID)与 `fileName`(资源名.xml)保留用于定位跨包文件。跨包图片等非组件类型仍维持 `包名.资源名` 格式,避免破坏。
- **验证**:`samples/fgui` 导出后,`BagView.xml` 中跨包引用形如 `<component id="n0_bqux" name="baseBg" src="gyk92q" fileName="FrameCom.xml" pkg="9njo6dpe" xy="0,1023"/>`(src 为 id 而非 包名.资源名)。

### [修复] FGUI 导出源工程:跨包组件引用补齐 pkg(包ID) 与 fileName 属性
- **现象**:导出源工程时,组件 displayList 中引用其它包(如 `Common`)的组件/图片仅生成 `src="Common.FrameCom"`,缺 `pkg` 与 `fileName`,FairyGUI 编辑器无法定位跨包资源。
- **根因**:`restoreSource.js` 的 `srcResolver` 跨包解析成功时返回 `pkg: null`,而 `xml.js` 的 `A.set` 对 null 值跳过,导致 `pkg` 属性被丢弃;且 `fileName` 此前根本未生成。
- **改动**:
  - `electron/tools/fgui/restoreSource.js`:`srcResolver` 跨包解析成功时返回 `pkg: dp.id`(依赖包真实 ID)并补 `fileName: "<资源名>.xml"`;依赖 .bin 缺失时回退为原始 `pkgId`。
  - `electron/tools/fgui/xml.js` `emitChild`:`pkg` 在传入 `srcResolver`(即导出路径)且值有效时输出;`fileName` 仅对组件类标签(Component/Button/ComboBox 等扩展组件,统一映射为 `component`)输出,属性顺序 `src→fileName→pkg→xy`,与 FairyGUI 源工程一致。预览/探测用的 `buildOutputs` 不传 `srcResolver`,输出不变。
- **验证**:`samples/fgui/ActEmperorArrival` 导出后,`btnGet` 子节点生成 `<component id="n0_mah9" name="btnGet" src="Common.ComBtn0" fileName="ComBtn0.xml" pkg="9njo6dpe" xy="-3,247" scale="0.7,0.7">`,跨包引用全部带 `pkg`(共 8 处)。

### [修复] FGUI 导出源工程:组件目录规范为 com、组件文件按资源名命名
- **现象**:源工程还原时组件子目录沿用发布包的中文目录名「组件」(如 `/组件/`、`/组件/item/`),组件文件以资源 id 命名(`bqux1.xml`),不符合源工程惯例。
- **改动**(`electron/tools/fgui/restoreSource.js`):
  - 还原前就地规范化 `it.path`:目录名中的「组件」统一替换为 `com`,`package.xml` 的 `path` 值与输出目录同步(`/组件/item/` → `/com/item/`,字体等含「组件」的路径一并替换);
  - 组件 XML 文件名改用资源名(`(it.name||it.id) + '.xml'`,非法字符 `/` `\` 替换为 `_`),与 `package.xml` 中 `name="BagView.xml"` 一致(`bqux1.xml` → `BagView.xml`)。
- **验证**:ActEmperorArrival(com/ActEmperorArrivalView.xml,path="/com/")、Common(113 组件,子目录 com/item、com/button 等,package.xml 无「组件」字样)通过。

## 2026-08-10

### [新增] FGUI 界面预览「打开目录」按钮
- FGUI 预览子页工具栏新增「📂 打开目录」按钮,用 Windows 资源管理器打开当前 FGUI 包(.bin)所在目录;未加载包时禁用。
- 改动:`src/pages/scenePage.js`(工具栏按钮 + `#fgpv-opendir` 事件绑定 + `updateToolbarState` 状态),复用已有 `shell:openPath` IPC。

## 2026-08-10

### [说明] 发布 v1.7.3(便携版)
- 在 v1.7.2 基础上重新打包,纳入 FGUI「导出源工程」功能的收尾修正(见同页 [新增] 条目与下方 [修复] 条目)。

### [修复] FGUI 导出源工程:解码严格对齐 fgui-restore + 组件元数据补全
- **parser.js**:`parseItems` 补全 `it.path`(包内子目录,如 `/images/`)、Image 项 `scaleOption` 与 `scale9Grid` 字段,供 source `package.xml` 正确输出 `scale="9grid" scale9grid="x,y,w,h"`。
- **restoreSource.js**:`decodeFontData`/`decodeMovieclipData` 的 `nextPos` 改为 `raw.ReadShort() + raw.pointer`(严格对齐 fgui-restore 源码,原版漏加偏移会错位);位图字体/动画帧解析更稳健。
- **scenePage.js**:「📤 导出源工程」按钮增加 `package.xml` 已存在时的覆盖确认对话框(取消则不打断)。
- **index.js / main.js / preload.js**:正式接通 `fgui:exportSource` IPC(`restoreSourcePkg` → `fguiExportSource`)。
- **验证**:`_test_restore_src.js` 回归通过,Common/Cooldown 等包还原正确(`path`/`scale9grid` 字段已写入 `package.xml`)。

### [新增] FGUI 界面预览「导出源工程」:从发布包还原完整可打开的 FairyGUI 源工程
- **功能**：FGUI 界面预览子页工具栏「📤 导出源工程」按钮,将 .bin 发布包还原为 FairyGUI 编辑器可直接打开的源工程包目录(输出到 bin 同目录 `<包名>_src/<包名>/`),还原方法参考开源项目 fgui-restore(krapnikkk)。
- **还原内容**：
  - `package.xml` 标准源工程格式(`<packageDescription id>` + `<resources>` 资源清单 component/image/movieclip/font/sound + `<publish name>` 发布节点),格式对照 FairyGUI-unity 仓库源工程样例;
  - 组件 XML 按 `<id>.xml` 命名写入包内 path 子目录,displayList 扩展组件(Button/Label/ComboBox/ProgressBar/Slider/ScrollBar)改为源工程的内嵌 `<Button/>` 等节点写法,跨包引用在依赖包 .bin 存在时自动转为 `src="包名.资源名"`;
  - 碎图从图集裁剪还原(`pngjs`,支持 rotated 旋转),输出 `<name>.png`;
  - 位图字体还原 `<name>.fnt`(UIBuilder 格式);
  - MovieClip 还原 `<name>.jta`("yytou" 头/version 102/24fps 基准,帧图取 `<id>_<i>` 命名碎图);
  - 声音复制 `<name>.<ext>`(bin 同目录 / 共享素材库探测,缺失时跳过并提示)。
- **改动文件**：
  - 新增 `electron/tools/fgui/restoreSource.js`(还原主逻辑,参考 fgui-restore 的 decodeFontData/decodeMovieclipData/createMovieClip/handleSprites 方法);
  - `electron/tools/fgui/parser.js`(items 保存 path / scaleOption / scale9Grid 字段);
  - `electron/tools/fgui/xml.js`(emitChild 支持 srcResolver + 扩展组件内嵌节点;新增 emitSourcePackageXml);
  - `electron/tools/fgui/index.js` / `electron/main.js`(新增 `fgui:exportSource` IPC) / `electron/preload.js`(暴露 fguiExportSource);
  - `src/pages/scenePage.js`(「导出源工程」按钮;「解压FGUI包」保留旧 JSON/XML 提取);
  - 新依赖 `pngjs`(纯 JS PNG 解码/裁剪),`scripts/pack-manual.js` MAIN_DEPS 已追加。
- **验证**：samples/fgui 的 ActEmperorArrival(3 组件+11 碎图,跨包引用转 Common.xxx) 与 Common(113 组件+495 碎图+14 字体) 全量还原通过;fgui-restore/test 的 Basics(93 组件+121 碎图+3 动画 jta) / Transition / Cooldown 通过,生成 jta 头部校验 yytou/102/24fps 正确。
- **已知限制**：MovieClip 帧图缺失时跳过该 jta(提示);跨包依赖 .bin 不在磁盘时保留原始 id 引用并提示一并导出;.fnt 为 UIBuilder 基础格式(fgui-restore 同款,部分字形属性待完善)。

## 2026-08-09

### [说明] 发布 v1.7.2（侧栏名称挤压优化版）
- 内容：v1.7.1 → v1.7.2，针对上一版 hover 卡顿修复带来的"操作按钮始终占布局导致名称挤压"副作用做优化（仅 `src/style.css`）。
- 产物：`release/游戏资源管理器-v1.7.2-便携版.zip`。

## 2026-08-09

### [修复] 侧栏操作按钮改为右侧绝对定位浮层，名称可显区恢复（v1.7.2）
- **现象**：v1.7.1 hover 卡顿修复后副作用——`.ic-ops` / `.cat-ops` 改为始终 `display:flex` 占布局（~86px），`.ic-name` / `.cat-name` 可显区永久缩小；多层子目录缩进后名称显示不完整。
- **根因**：上版为消除 `display:none→flex` hover 触发的 reflow，让操作按钮**始终占布局**；代价是名称被挤压。
- **改动**：`src/style.css` —— 将 `.ic-ops` / `.cat-ops` 改为 **`position: absolute; right: 6px; top: 50%`** 的右侧浮层；`.item-node` / `.cat-node` 加 `position: relative` 作为定位上下文。hover 时按钮通过 **opacity 0→1 + transform translateX(10px→0)** 切换（仅合成层，**零 reflow**）。hover 时 `.cat-count` 同步淡出避免被按钮浮层遮挡。
- **验证**：CDP 脚本 `scripts/_cdp_hover_verify.js` + `scripts/_cdp_deep_verify.js` 实测：
  - 古荒遗迹顶级条目 `.ic-name` 宽度 **79.3px → 171.3px（+92px，近翻倍）**；
  - 异兽灵境json→特效→UI 特效（3 层缩进）下条目名称完整显示 `fullNameVisible: true`；
  - hover 前后宽度 Δ=0.00px（卡顿修复保持，零 reflow）。
- **副作用**：hover 时按钮浮层会遮住名称尾部 ellipsis 区域的几个字符（用户看名称前面大部分完整，hover 时主要关注按钮而非名称尾字）；cat-count 在分类 hover 时淡出（视觉"计数让位给操作按钮"）。

## 2026-08-09

### [说明] 发布 v1.7.1（侧栏 hover 卡顿修复验证版）
- 内容：v1.7.0 → v1.7.1，仅包含上一条 `[修复] 侧栏 hover 大分类 spine 条目卡顿` 的改动（`src/style.css` + `src/ui.js`），供用户实测。
- 产物：`release/游戏资源管理器-v1.7.1-便携版.zip`。

## 2026-08-09

### [修复] 侧栏 hover 大分类 spine 条目卡顿、鼠标移动缓慢（v1.7.0）
- **现象**：左侧栏展开含几百条 spine 的目录（如本机 495 条「古荒遗迹」）后，鼠标经过条目时电脑卡顿、鼠标箭头移动缓慢、停下好一会才恢复。
- **根因（三层叠加）**：
  1. **CSS reflow**：原 `.item-node:hover .ic-ops { display: none → flex }` 与 `.cat-node:hover .cat-ops` 同款，hover 时每行触发 reflow + `.ic-name` 文本收缩重算 ellipsis，密集条目下 Chromium 合成压力升高。
  2. **HTML5 draggable + Windows OLE 拖拽**：`renderItemNode` 把每条 `row.draggable=true`，495 条全是 draggable，用户无意识按住鼠标划过时 Chromium 启动 OLE 拖拽会话，鼠标被系统捕获用于 OLE 拖拽，**且 Chromium 在大量 draggable 元素间频繁重建 OLE 会话**，体感"鼠标移动变慢、好一会才恢复"（Chromium/Windows 已知问题）。
  3. **原生 title tooltip**：`nm.title` 含完整 Windows 文件路径（80~150+ 字符），495 个条目 hover 频繁触发超长原生 tooltip，与 Windows 系统 UI 频繁交互。
- **改动**：
  - `src/style.css`：`.ic-ops` / `.cat-ops` 改为 **`opacity 0 → 1` + `pointer-events none → auto` 切换**（合成层操作，零 reflow）；`.ic-ops` 默认 `display:flex`，按钮始终占布局但不可见。
  - `src/ui.js renderItemNode`：
    - 去掉 `row.draggable=true` 及 `dragstart`/`dragend` 监听器；分类移动改走右键菜单「移动到...」（`moveItemDialog` 已存在）。
    - `nm.title` 简化为「`名称 · 类型`」（如 `aonao · Spine`，13~37 字符），去掉完整路径；完整信息保留在右键属性对话框。
  - 分类节点（renderCatNode）的 draggable 保留（数量仅 ~20 个，误触概率低）；其 `dragover/drop` 中 `dragKind==='item'` 分支变成死代码但保留（防御回滚）。
- **验证**：CDP 脚本 `scripts/_cdp_hover_verify.js` 软渲染 + 真实加载 495 条 spine 后采样——
  - 修复前预期：`.ic-name` 宽度 hover 时被挤压 ~86px（display:flex 触发 reflow）。
  - 修复后实测：`.ic-name` 宽度 hover 前后 **Δ = 0.00px**，`.ic-ops` opacity 从 0→1 正常生效，rAF 全程 17ms 稳定，无 longtask。
- **副作用（已评估可接受）**：操作按钮区域始终占布局 ~86px，所有条目的 `.ic-name` 可显区永久比修复前窄约 86px（hover 前后一致，不再跳动）；若需恢复"非 hover 时名称占满"可改 `position:absolute` 浮层（当前未做）。

## 2026-08-09

### [新增] 顶栏搜索与侧栏上下文联动 + FGUI 组件列表搜索（v1.7.0）
- **顶栏搜索上下文感知**：搜索范围自动跟随当前上下文——
  - **全部资源首页** → 搜索**全部类型**资源；
  - **动画/图片/音频/3D 类型主页** → 只搜**该类型**资源；
  - **目录节点** → 搜**该目录（含子分类递归）** 内资源；
  - **游戏场景管理（首页/目录）** → 搜**游戏场景**（全部或当前目录递归）；
  - 输入即进入「🔍 搜索结果」列表页（名称/属性/标签/类型/分类匹配），清空搜索恢复原视图；搜索结果中点击分类自动清空搜索进入该分类。
- **实现**：`renderItems` 搜索时走 `renderSearchResults()`（按上下文分发）；`folderPage` 新增 `searchMode`（`collectSearchPool` 全类型/递归子目录范围）；`scenePage` 新增 `renderSceneSearchResults(q, catId, actions)` 场景结果页（点击 FGUI 包直接预览）。
- **FGUI 组件列表搜索**：组件列表面板新增搜索框「🔍 搜索组件(名称/类型/@包名)…」，输入即时过滤列表行（隐藏不匹配项）。
- **验证**：新增 `scripts/search-smoke-main.js` + `run_search_smoke.js` PASS——首页搜索全类型 2 条、动画 tab 搜索仅动画 1 条、场景搜索出 FGUI 包、组件列表搜索 70→2 条；8 个旧冒烟回归全部通过。
- **版本**：v1.6.10 → **v1.7.0**。

## 2026-08-09

### [修复] FGUI 预览背景色不生效 + 保存按钮优化
- **修复 FGUI 预览背景色一直黑色**：`fguiLayoutPreview.js` 的 `setBackground` 之前写 `app.renderer.background = color`——Pixi v8 中 `renderer.background` 是 **BackgroundSystem 实例**（含 `set color(value)`），直接赋值对象不生效导致画布始终为初始黑色。已改为 `renderer.background.color = color`（源码级验证 setter 存在），同时保留画布容器 CSS 背景同步；`setBackground` 额外写 `rootEl.dataset.bg` 作为测试钩子。
- **保存按钮优化**：背景色条「保存」按钮改为单字 **「存」**（更小：`padding 1px 7px / min-width 26px / 11px`），位置移到**调色盘 input 之后**（紧贴色盘），动画预览/图片预览/FGUI 预览三处统一；顺序为 `调色盘 → 存 → 深 → 浅 → 自定`。
- **顺带清理**：修复 FGUI 预览工具栏 `#fgpv-texdir` 按钮重复定义（此前编辑残留，两个相同 id）。
- **验证**：complist 冒烟扩展 PASS——调色盘选白后 `wrap.dataset.bg === '#ffffff'`（setBackground 真实执行）+ CSS 背景变白；「存」按钮文字与紧贴调色盘顺序断言通过；保存自定义 `#ff0000` 后 dataset 变红且持久化；其余 7 个冒烟回归全部通过。
- **版本**：v1.6.9 → v1.6.10。

## 2026-08-09

### [新增] 背景色调色盘统一升级 + 类型主页最近打开 + 主区多标签页
- **背景色统一(动画/图片/FGUI 三模块)**：新增共享工具 `src/bgColor.js`（`initBgColorBar`）——调色盘(`input type=color`)选色**立即生效**；「深」「浅」按钮**背景=对应颜色、文字反色**（深 #22242b 白字 / 浅 #eef0f5 黑字，FGUI 深色 #1b1d23）；新增「自定」按钮（背景=已保存的自定义色、文字反色，点击应用）；调色盘旁新增「保存」按钮——把当前调色盘颜色**保存为自定义颜色**（`settings.customBgColor`，全局共享）并立即应用。动画/图片预览共用 `bgColor` 设置、FGUI 用 `fguiBgColor`。
- **类型主页最近打开**：每个资源类型主页（动画/图片/音频/3D）新增「🕘 最近打开」模块，**只显示对应类型**的最近打开记录（按类型组过滤，上限 10 条），点击同样可再次打开。
- **主区多标签页**：主内容区顶部新增标签条 `#tab-strip`——**打开资源以新标签页打开**（标签=资源名+类型图标）；点击类型/目录/工具箱/场景/设置/首页等导航时**切换为对应标签页**，原标签保留可随时切回；**鼠标悬停标签显示关闭符号 ×，点击关闭该标签**（关闭当前标签自动切到相邻标签，全部关闭时回到首页）。修复「FGUI 预览时点击『全部资源首页』按钮无法切换回首页」——品牌/资源标签切换漏清 `fguiPreviewShown/pendingFguiBin` 导致被 FGUI 预览拦截。
- **验证**：新增 `scripts/tabs-smoke-main.js` + `run_tabs_smoke.js` PASS（打开 FGUI 建标签 → 点品牌回首页且 FGUI 标签保留 → 点标签切回预览 → hover 关闭按钮规则存在 → 关闭标签后回首页）；complist 冒烟更新为调色盘交互 PASS（深浅按钮反色、调色盘立即生效、保存自定义色持久化）；recent 冒烟扩展类型主页过滤 PASS；7 个旧冒烟回归全部通过。
- **版本**：v1.6.8 → v1.6.9。

## 2026-08-09

### [新增] FGUI 预览画布背景色可更改
- **需求**：FGUI 包预览画布区支持更改背景颜色。
- **实现**：工具栏新增「🎨 背景色」按钮——弹出对话框选择预设（深色 `#1b1d23` / 中灰 `#3a4150` / 浅灰 `#c9d1d9` / 白色 `#ffffff`）或自定义输入 `#RRGGBB`；渲染器新增 `setBackground(hex)`（改 Pixi renderer 背景 + 画布容器背景并重渲染）；选择持久化到 `settings.fguiBgColor`，下次打开预览自动应用。
- **验证**：`scripts/run_fgui_complist_smoke.js` 扩展断言 PASS——背景色按钮加载后启用、弹窗出现、选白色后画布容器背景变 `rgb(255,255,255)`、状态提示「背景色已设为 #ffffff」；其余 6 个冒烟回归全部通过。
- **版本**：v1.6.7 → v1.6.8。

## 2026-08-09

### [新增] 首页「最近打开」模块 + 全应用布局与组件说明文档
- **最近打开**：首页新增「🕘 最近打开」模块（位于目录快捷入口与最近添加之间）——展示最近打开的**资源条目 / FGUI 包**：类型徽标 + 名称 + **打开日期时间**（`YYYY-MM-DD HH:mm`）；点击列表项**再次打开**（资源 → 预览页；`.bin` → FGUI 预览）。
- **数据**：`settings.recentOpens`（`[{name, path, type, tab, itemId, openedAt}]`，按路径去重、最新在前、上限 20、随 db 持久化）；`state.js` 新增 `recordRecentOpen()`。
- **埋点**：资源预览统一入口 `selectItem()`（动画/图片/音频/3D）；FGUI 预览 `loadPkg()` 成功时记录。
- **再次打开**：`ui.js openRecentPath()`——`.bin` 直接进 FGUI 预览（按路径自动关联登记）；普通资源按路径匹配 item 后预览；场景条目打开路径；不存在时提示。
- **文档**：新增 `docs/游戏资源管理器-布局与组件说明.md`——覆盖全局布局（顶栏/侧栏/主区 7 页）、首页（统计/最近打开/最近添加/目录快捷）、目录页、预览页（动画/图片/音频/3D）、资源工具箱、游戏场景管理（含 FGUI 预览器）、系统设置、通用组件、快捷键、数据持久化、代码结构、布局演进记录。
- **验证**：新增 `scripts/recent-smoke-main.js` + `run_recent_smoke.js` PASS——首页最近打开渲染 2 条（FGUI + 普通文件，均含时间格式），点击 FGUI 项重新打开预览成功；原有 6 个冒烟（smoke/register/ux/batch/export/complist）回归全部通过。
- **版本**：v1.6.6 → v1.6.7。

## 2026-08-09

### [新增] FGUI 预览器组件列表完整化 + 点击联动属性面板
- **需求**：① 点击组件列表中的组件，属性面板联动显示该组件属性；② 组件列表显示不完整——Bag.bin 中本包的图片/组件（bg/list/hcBt.title 等）未列出，全部显示成 Common 外部包；③ 更新预览器布局说明文档；④ 递增版本打包。
- **列表完整化**：`renderCompList` 重写——不再只列跨包子组件，而是**完整列出组件树全部节点**（主组件 `📦 名称 (类型)` + 递归全部子节点 `└ 名称 (类型)`，按深度缩进）；**本包节点正常显示**（无 @ 标注，如 `└ list List`、`└ bg Loader`），**外部包节点标注 `@外部包名`**（橙色，如 `└ btnGet @Common Button`）；实测 Bag.bin 列表含 8 个本包子节点 + 71 个跨包节点（原 80 节点齐全）。
- **点击联动属性面板**：点击列表项 → ① 画布黄色定位框（`highlightNode`）② **属性面板显示该节点属性**（`selectNode` → `_renderProps`）③ 列表项 active；点击**其他主组件项自动切换组件**再定位；顶部组件下拉与列表**双向同步**（`loadComp` 同步 `compSel.value`）。
- **文档**：`docs/fgui-previewer-layout.md` 更新为三区布局新图（组件列表/分割线/快照条/属性面板）、4.0 组件列表面板章节、五节「布局演进记录」（v1.6.4/1.6.5/1.6.6）。
- **验证**：`scripts/run_fgui_complist_smoke.js` 扩展断言 PASS——列表含本包子节点（无 @ 项）与 @Common 跨包项；点击本包节点/跨包节点属性面板均显示（9~10 项属性）；点击 ActBarCom0 主项自动切换组件且属性面板 7 项；顶部下拉同步为 ActBarCom0；拖拽分割线/宽度在干净状态下生效（276→356 / 250→341）；5 个旧冒烟回归全 PASS。
- **版本**：v1.6.5 → v1.6.6。

## 2026-08-09

### [新增] FGUI 预览器右侧面板可拖拽布局:组件列表/属性面板分割线 + 面板宽度调整
- **需求**：组件列表区域与属性面板默认各占一半垂直空间，中间分割线可拖动改变占比；右侧面板左边框可拖动改变面板宽度。
- **实现**：
  - 组件列表 `.fg-comp-bar` 与属性面板 `.fg-prop-panel` 默认 `flex: 1 1 50%` 各占一半；两者之间新增垂直分割线 `#fgpv-vsplit`（hover 高亮），拖动调整组件列表高度（60px ~ 面板高-140px），快照条保持固定小横条。
  - 右侧面板 `.fg-side` 左边缘新增水平分割线 `#fgpv-hsplit`（绝对定位 6px），拖动调整面板宽度（180~480px，向左拖变宽）。
  - 尺寸持久化到 `localStorage`（`fgpv-compH` / `fgpv-sideW`），下次打开预览自动恢复。
  - `setPointerCapture` 兼容 synthetic 事件（try/catch 包裹）。
- **验证**：`scripts/run_fgui_complist_smoke.js` 扩展拖拽断言 PASS——vsplit 向下拖 80px 组件列表高 276→356、hsplit 左移 90px 面板宽 250→341，localStorage 持久化生效；其余 5 个冒烟回归全部通过。
- **版本**：v1.6.4 → v1.6.5。

## 2026-08-09

### [新增] FGUI 预览器右侧「组件列表」面板 + 组件定位高亮
- **需求**：预览 FGUI 包时右侧要有包中所有组件的列表；列表显示组件名称、组件类型；属于外部包的组件在名称后标注 `@外部组件名`；点击组件名称则预览区域将该组件边框高亮显示。
- **组件列表面板**：右侧 `.fg-side` 顶部（快照条之上）新增「📋 组件列表」面板（`#fgpv-compbar`）——列出**主包全部组件**（`📦 名称` + 类型），并在每个组件下递归列出其组件树中**引用外部包的子组件**（`└ 名称 @外部包名` + 节点类型，如 `└ btnGet @Common Button`）；顶部显示条目计数。
- **点击定位高亮**：渲染器 `fguiLayoutPreview.js` 新增常驻 `_compHL` Graphics 层（`_clearTree` 保留前 3 个子节点），`highlightNode(node)` 按节点世界坐标（外层定位 position + 节点尺寸）画黄色外框，目标明显偏离视口时自动平移画布居中；点击列表项后状态栏显示 `已定位:名称 (x,y w×h)`。
- **双向联动**：组件下拉切换组件时列表主项同步高亮；画布点选节点时（`_onSelect`）列表对应项（含跨包子组件）同步 active。
- **验证**：新增 `scripts/fgui-complist-smoke-main.js` + `run_fgui_complist_smoke.js` PASS——样例包列表 49 条（3 主组件 + 46 条 `@Common` 跨包项），点击跨包项/主组件项均正确高亮定位；`run_fgui_smoke`/`register`/`ux`/`batch`/`export` 五个冒烟回归全部通过。
- **版本**：v1.6.3 → v1.6.4。

## 2026-08-09

### [说明] 发布 v1.6.3(便携版)
- 版本号由 v1.6.2 递增至 v1.6.3(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.6.3-便携版.zip`。
- 本版本主要变更:FGUI 解压素材优化——只复制本包单图、共享素材库优先、跨包图集不复制、跨包解析缓存(见下方 [新增] 条目)。

### [新增] FGUI 解压素材优化:只复制本包单图 + 共享素材库优先
- **只复制本包素材**：解压/导出 FGUI 包时不再盲目复制全部纹理,而是按 `exportFile` 返回的本包图集清单 `ownAtlasKeys`(形如 `${pkgName}_${atlasId}`)过滤——只复制属于当前包的图集,跨包引用的图集一律不复制(由依赖包提供),避免大量重复文件。
- **共享素材库优先**：`fgui:exportSingle` 额外返回 `spriteLibDir`(由 bin 路径回溯探测游戏根 `{gameRoot}/ui/fgui_texture/fgui`,未识别到为 null 时渲染端回退旧行为)。复制素材时优先从共享素材库 `<spriteLibDir>/<图集名>/` 目录取单图(逐张复制到 `<outDir>/<图集名>/`),素材库未生成该图集时回退复制整张图集 PNG。
- **跨包解析缓存**：`previewData.js` 新增 `pkgCache`(bin 路径 → 解析结果 Map),跨包子对象解析 `loadPkg` 命中缓存,避免同一依赖包重复解析。
- **改动**：`src/pages/scenePage.js`(新增 `copySpritesToDir`)、`electron/main.js`(spriteLibDir 探测)、`electron/tools/fgui/index.js`(exportFile 返回 ownAtlasKeys/deps)、`electron/tools/fgui/previewData.js`(pkgCache)。

## 2026-08-08

### [说明] 发布 v1.6.2(便携版)
- 版本号由 v1.6.1 递增至 v1.6.2(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.6.2-便携版.zip`。
- 本版本主要变更:FGUI 界面预览交互增强(侧栏直达/添加场景识别登记/解压/撤销与编辑历史)、FGUI 包批量添加与目录页大小/行点击预览、导出资源统一为包名子目录+覆盖确认(见下方 2026-08-08 条目)。

## 2026-08-08

### [改进] FGUI 预览「导出资源」不再弹目录选择,直接导出到包名子目录 + 已存在文件时确认覆盖
- **行为变更**：预览页「📤 导出资源」不再弹出目录选择框,直接调用单文件导出(`fguiExportSingle`)把当前包导出到 **bin 同目录/`<包名>/`** 子目录(如预览 `City.bin` → `City.bin` 所在目录下 `City/`);目录不存在自动创建,已存在则直接写入。
- **覆盖确认**：导出/解压前检查目标目录是否已存在该包导出文件(`<包名>.json`/`<包名>.xml`),存在则弹「目录已存在导出文件」确认框——点「覆盖」才写入,点「取消」中止(状态提示「已取消,未覆盖原文件」);首次导出无文件时不打扰。
- **统一逻辑**：原「📦 解压FGUI包」与「📤 导出资源」合并为同一导出流程(`exportCurrentPkg`,按按钮区分状态文案「已解压到/已导出到」),均单包、固定目录、带覆盖确认。
- **改动**：`src/pages/scenePage.js`(`exportCurrentPkg` + 两按钮绑定)、`src/dialogs.js`(`confirmDialog` 支持 `onCancel` 回调)。
- **验证**：新增 `scripts/fgui-export-smoke-main.js` + `run_fgui_export_smoke.js` 端到端 PASS——首次点导出直接生成 `ActEmperorArrival/`(JSON+XML+组件XML+atlas PNG)且目录选择从未触发(pickDirCalls=0)→ 二次点击弹覆盖确认 → 取消不改文件 → 覆盖成功;`run_fgui_register_smoke`/`run_fgui_ux_smoke`/`run_fgui_batch_smoke`/`run_fgui_smoke` 回归全部通过。

## 2026-08-08

### [新增] FGUI 包批量添加(单/多文件 + 目录递归) + 目录页显示大小与行点击预览
- **批量添加**：场景主页/目录页新增「🧩 添加FGUI包」按钮,侧栏「游戏场景管理」根节点与分类节点右键菜单新增「添加 FGUI 包」——支持单选/多选 `.bin` 文件,也支持选择一个或多个目录(内部扫描 FGUI 包);选中目录后弹「扫描范围」对话框可选「仅当前目录 / 递归子目录(最多 4 层)」。所有包一次性登记到当前场景目录,按名称字母排序、`fguiProbe` 探测过滤、按路径去重,并记录文件大小。
- **目录页显示大小**：登记时记录 `size`(批量与单个登记均异步补齐);场景目录页表格大小列对 FGUI 包显示实际大小;早期登记未记录大小的条目在打开目录页时惰性 stat 补全。
- **行点击打开预览**：场景目录页点击 FGUI 包所在行(名称/路径等非按钮区域)直接打开该文件的 FGUI 界面预览。
- **解压仅当前包**：预览页「📦 解压FGUI包」始终走单文件导出(`fguiExportSingle`),只解压当前预览的包到 **bin 同目录/`<包名>/`** 子目录,不批量解压同目录其它包。
- **验证**：新增 `scripts/fgui-batch-smoke-main.js` + `run_fgui_batch_smoke.js` 端到端 PASS——目录页「添加FGUI包」选目录→递归扫描→登记 2 个包到当前目录(带大小)→表格显示 🧩/名称/4.5 KB→行点击打开预览(已登记:批量目录)→解压仅生成 `ActEmperorArrival/` 且不产生 `B/`;`run_fgui_register_smoke`/`run_fgui_ux_smoke`/`run_fgui_smoke` 回归全部通过。

## 2026-08-08

### [新增] FGUI 预览交互增强:侧栏直达 / 添加场景识别登记 / 解压包 / 快照目录 / 撤销与编辑历史
- **侧栏单击直达预览**：左侧「游戏场景管理」目录节点下的 FGUI 界面包条目,**单击**直接在主内容区打开预览(不再弹右键菜单;右键菜单仍保留完整操作)。
- **添加场景识别 FGUI 包**：场景主页/目录页「添加场景」与目录节点右键菜单「添加场景」选中 `.bin` 文件时,自动用 `fguiProbe` 探测 magic——确认为 FGUI 包则弹「登记 FGUI 包到游戏场景管理」窗口,**所属目录默认选中点击时的目录**;非 FGUI 文件仍按普通场景添加。
- **解压 FGUI 包**：预览页「保存快照」旁新增「📦 解压FGUI包」按钮——用内置 FGUI 逆向导出(`fgui:exportSingle` 单文件导出,新增)把该包解压到 **bin 同目录/`<包名>/`** 子目录(JSON + 包级 XML + 组件 XML + atlas PNG),形成完整可编辑资源包;编辑状态(快照/历史)默认也存该目录,自动关联。
- **快照默认目录**：保存快照默认定位到 bin 同目录/`<包名>/`(如 `Bag.bin` → `.../fgui/Bag/`),不再用 `fgui_edit/`。
- **撤销 + 编辑历史**：编辑模式下工具栏新增「↩ 撤销」按钮与 Ctrl+Z 快捷键;渲染器 `fguiLayoutPreview.js` 新增撤销栈(`_beginEdit`/`_commitEdit`/`undo`,拖拽/缩放/属性/文本编辑各操作接入),逐步回退;每次编辑提交通过 `_onEditCommitted` 回调写入 **`<包名>/edit_history.json`** 编辑历史文件(timestamp/component/nodeId/changes.before/after),状态栏显示历史条数。
- **验证**：新增 `scripts/fgui-ux-smoke-main.js` + `run_fgui_ux_smoke.js` 端到端 PASS——侧栏单击直达(显示「已登记:UX测试目录 / UX包」)→ 解压生成 5 个 XML/JSON + atlas PNG + edit_history.json → 保存快照 defaultPath=包名子目录 → 编辑 x 0→88 → 撤销还原 0 → 目录页「添加场景」弹登记窗且所属目录默认=当前目录 → 确定后新增条目;`run_fgui_register_smoke.js` 修复为按注入条目名定位(开发库已有真实登记数据不影响)后 PASS。

## 2026-08-08

### [新增] FGUI 界面包与「游戏场景管理」打通:登记 + 关联快照管理
- **需求背景**：用户反馈加载 `Bag.bin` 预览并保存快照后,应用没有记住 .bin 与快照的位置,下次还要手动重新加载。
- **登记到场景管理**：预览子页加载 `.bin` 时自动弹出登记对话框——选择「登记为 FGUI 界面包」+ 指定所属场景目录(未分类/分类树)+ 场景名称,调 `addScene({subtype:'fgui'})` 落库;已按路径登记过的包直接复用(自动升级 subtype 标记)。工具栏新增「📌 登记到场景管理」按钮供补登记;状态栏显示「📌 已登记:目录路径 / 名称」。
- **从场景管理直接预览**：场景目录页表格对 FGUI 条目显示 🧩「FGUI 界面预览」按钮;场景主页「最近添加」与侧栏场景条目右键菜单也提供「🧩 FGUI 界面预览」——点击即进入预览子页并自动加载该条目关联的 .bin(`scene:navigate` 携带 binPath → pendingFguiBin → initialBinPath)。
- **快照与 .bin 关联**：保存快照默认定位到 `.bin` 同目录 `fgui_edit/`(自动建目录),成功后把 `{id, name, path, timestamp}` 追加入场景条目的 `fguiSnapshots` 字段(随 db 持久化);右侧新增「📋 快照」条——下拉列出该包所有快照,可「↺ 加载」回放(组件不匹配时自动切换组件;`fguiPreview.applySnapshot` 按节点 id 回放属性)、「🗑 移除记录」(磁盘文件保留)、「📂 打开快照目录」。
- **数据层**：`scenes` 表新增 `subtype`(标记 FGUI 界面包)与 `fgui_snapshots`(JSON 快照记录)两列(旧库自动迁移);`state.js` 新增 `findSceneByFilePath`(路径分隔符归一化匹配)。
- **验证**：`scripts/run_fgui_register_smoke.js` 端到端冒烟全链路 PASS——注入 FGUI 场景条目 → 场景主页最近添加 → 目录页 🧩 按钮 → 预览子页自动加载 → 已登记状态 → 保存快照落盘+关联+快照条刷新 → 回放 → 删除记录 → 返回;db 迁移与持久化往返脚本 `scripts/test-db-fgui-migrate.js` 通过。

## 2026-08-07

### [修复] FGUI 界面预览图片不显示
- **现象**：「游戏场景管理 → FGUI 界面预览」选择 `.bin` 后,Image/Loader 节点只渲染灰色占位框,图集 PNG 没有显示。
- **根因**：`src/viewers/fguiLayoutPreview.js` 用 `PIXI.Texture.from(dataUrl)` 直接由 data URL 创建纹理,PixiJS v8 中该纹理为异步加载,在创建子纹理(frame 裁切)时源图尚未解码,导致 Sprite 创建失败并降级为占位框。
- **改动**：新增 `loadTextureFromDataUrl()` 先构造 `Image` 并等待 `onload`,再用完全解码后的图片创建 `PIXI.Texture`,并设置 `alphaMode='premultiplied-alpha'`。
- **验证**：`scripts/run-fgui-screenshot.js` 端到端截图显示 `ActEmperorArrivalItem` 金色面板、按钮、装饰图正常渲染;`scripts/run_fgui_smoke.js` 退出码 0。

### [新增] FGUI 界面预览支持可视化编辑 + 资源导出/快照
- **能力**：在原有预览基础上新增「编辑模式」,可拖拽移动节点、拖拽 8 个手柄调整大小、双击文本节点内联修改文字;右侧属性面板可直接编辑 x/y/width/height/scaleX/scaleY/alpha/rotation/visible/text。
- **资源导出**：工具栏新增「📤 导出资源」,调用 `fguiBatchExport` 导出 JSON + XML 结构,并自动把命中图集 PNG 复制到输出目录,形成完整可编辑资源包。
- **布局快照**：工具栏新增「💾 保存快照」,将当前组件中被修改过的节点属性(含原始值)导出为 JSON,方便记录与外部使用。
- **改动**：`src/viewers/fguiLayoutPreview.js`(编辑状态、拖拽/缩放、属性面板输入、文本内联编辑、exportEdits);`src/pages/scenePage.js`(编辑/导出/快照按钮与事件、测试钩子);`src/style.css`(编辑模式输入框/内联文本编辑样式)。
- **验证**：`scripts/run-fgui-screenshot.js` 截图显示编辑模式高亮框、缩放手柄、右侧可编辑属性面板均正常;`scripts/run_fgui_smoke.js` 无回归。

## 2026-08-07

### [说明] 发布 v1.6.1(便携版)
- 版本号由 v1.6.0 递增至 v1.6.1(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.6.1-便携版.zip`。
- 本版本为重新打包,无新增功能变更;包含 FGUI 界面预览、FGUI 包逆向解码、分类命名统一与递归建目录等全部最新功能。

## 2026-08-07

### [新增] 游戏场景管理内「FGUI 界面预览」(PixiJS 交互式布局还原)
- **能力**：在「游戏场景管理」主页新增「🧩 FGUI 界面预览」卡片 → 独立预览子页。选择 FairyGUI 的 `.bin` 界面包 → 选组件 → 用 PixiJS 8 按 xy/size/scale/pivot/alpha 把 Image/Loader/Text 渲染为可交互 UI 布局预览。
- **交互**：滚轮缩放(0.05~8×,以鼠标为锚点)/拖拽平移/点选对象高亮并显示属性面板/组件控制器(controller)页切换(按 gearDisplay 重算可见性)。
- **数据层** `electron/tools/fgui/previewData.js`(新增,纯 Node 可单测)：`buildPreviewData(inputPath, {textureDir})` 把包解析结果扁平化为 RenderNode 树——BFS 递归展开组件子树、跨包依赖解析(按 pkg.deps 找同名 .bin,支持跨包 Image/组件引用)、Image 取 sprite 矩形(无 initSize 时用原始 ow/oh)、纹理自动探测(`{game}/ui/fgui_texture/fgui/{pkgName}_{atlasId}.png` 与 bin 同目录,可手动指定目录兜底)、循环引用/深度上限 8/节点上限 2000 防护。
- **渲染器** `src/viewers/fguiLayoutPreview.js`(新增)：独立 PixiJS 8 应用(不复用动画预览画布)；双层容器坐标换算(外层定位 xy、内层偏移 -pivot*size 保证围绕 pivot 缩放旋转)；Sprite 按 sprite 矩形裁切(含 rotated 修正)；文本用 DOM overlay(与画布同步 transform,天然支持中文/换行,选中高亮边框)；`app.ticker.stop()` + 交互后手动渲染。
- **集成**：`src/pages/scenePage.js`(主页卡片 + `renderFguiPreviewPage`)、`src/ui.js`(fguiPreviewShown 状态 + renderMainArea 分支 + scene:navigate 监听 + clearOverlays)、`src/style.css`(.fg-preview-* / .fg-entry-card)。
- **验证**：`scripts/smoke-fgui-data.js`(纯 Node 断言:3 组件/6 子对象/跨包 Common 解析/纹理命中/stateCtrl 3 页)通过;`scripts/run_fgui_smoke.js` 端到端冒烟(数据链路 + UI 链路:侧栏→主页卡片→子页 Pixi 画布 WebGL 就绪→返回)退出码 0。样例自包含于 `samples/fgui/`。
- **边界(第一版)**:mask/clip 不裁剪、List 运行时子项不展开、rotated sprite 已处理但未专门回归、文本 rotation 用 CSS 兜底。

### [说明] 发布 v1.6.0(便携版)
- 版本号由 v1.5.9 递增至 v1.6.0(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.6.0-便携版.zip`。
- 本版本主要变更:左侧栏「资源工具箱」与「游戏场景管理」位置对换(见下方 [变更] 条目);并包含「分类命名统一 + 递归批量添加自动建目录」与「FGUI 包逆向解码」等全部最新功能。

### [新增] 分类命名统一 + 递归批量添加自动按路径建目录
- **分类命名统一**：「新建子分类」→「新建目录」(分类节点右键)、「新建分类」→「新建目录」(新建顶级目录对话框),移除顶栏「新建分类」按钮;左侧「音频/动画/图片/3D资源」类型根节点新增右键菜单「新建目录」,点击弹出「新建目录」对话框,默认为**顶级目录**(不作为子目录)。
- **递归批量添加自动建目录**：批量添加资源勾选「递归扫描子目录」时,按被添加文件相对所选根目录的路径结构,在目标分类下自动逐级建立对应目录(同名目录复用,不重复创建),资源文件分类到对应目录;新建目录继承目标分类的资源类型标签。未勾选递归时行为不变(全部加入目标分类)。新建目录自动展开以便查看。
- **改动**：`src/ui.js`(根节点右键/文案/items-changed 展开)、`src/state.js`(类型标签)、`src/addFlow.js`(按路径建目录链)。
- **验证**：`scripts/test-addflow-pathdirs.js` 逻辑测试通过(建链/复用/标签继承/多根目录/非递归不建);全量冒烟 `smoke done` 无回归(`subcat` 步骤断言菜单项=添加资源/批量添加/新建目录/编辑目录/移动.../删除、根节点右键菜单含新建目录、对话框标题「新建目录」、顶栏按钮已删除、默认顶级,全部 ok)。

### [新增] FGUI 包逆向解码(FGUI 查看器 + 工具箱批量导出)
- **能力**：把 FairyGUI 编辑器发布的 `.bin` UI 包(魔数 `FGUII`,Cocos Creator / Unity H5 游戏常见)逆向为可读结构——完整组件树、控制器、子对象可视属性、gear、关系、过渡动画、滚动、列表条目;输出 JSON + FGUI 风格 XML。
- **新增** `electron/tools/fgui/`(纯 Node 零依赖):`byteBuffer.js`(大端 + 段表 Seek + ReadS 语义)/ `enums.js`(ObjectType 等枚举)/ `parser.js`(包解析)/ `xml.js`(XML 生成)/ `index.js`(probe/parse/batchExport)。
- **集成**：扫描器识别 `.bin` 魔数 → 新类型「FGUI」;预览页新增 FGUI 查看器(组件清单 + 组件树 + 属性面板 + 源码标签页「组件 XML / 包 XML / 包 JSON」+ 复制 + 导出全部包);工具箱新增「🧩 FGUI 逆向导出」(目录 → 目录批量导出)。
- **验证**：`scripts/verify_fgui_js.js` 对 155 个真实 FGUI 包(异兽灵境)回归——53 段 leftover 全 0、JSON 与 Python 版零差异、XML 仅换行符差异;`scripts/run_fgui_smoke.js` 端到端冒烟(解析/探测/批量导出 155 包 0 失败)退出码 0。

## 2026-08-07

### [变更] 左侧栏「资源工具箱」与「游戏场景管理」位置对换
- **需求**：左侧树状菜单栏中「资源工具箱」与「游戏场景管理」两个区块对调位置。
- **改动**：`src/ui.js` `renderTree` 调整区块渲染顺序——「XX资源」类型根节点之后依次为「游戏场景管理」→「资源工具箱」(分格线随区块同步交换)。收藏夹置顶与资源分类目录区顺序不变。
- **验证**：`vite build` 通过;冒烟全量通过(`smoke done`),`navfix`/`toolhome`/`scenetree` 等按节点名称查找的步骤无回归。

### [说明] 发布 v1.5.9(便携版)
- 版本号由 v1.5.8 递增至 v1.5.9(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.9-便携版.zip`。
- 本版本主要变更:场景管理「新建目录」修复 + 侧栏场景树右键/拖拽/数量增强(见下方 [新增] 条目)。

### [新增] 场景管理增强:修复「新建目录」无效 + 侧栏场景树右键/拖拽/数量
- **修复**：游戏场景管理页面的「新建分类」按钮点击无效,无法新建场景目录。
  - **根因**：`src/ui.js` 中 `addSceneCategoryDialog` / `editSceneCategoryDialog` / `editSceneDialog` 仍使用**旧版 `promptDialog` 签名**(`placeholder`/`defaultValue`/`onOk(name)`),而对话框已升级为 `fields` 数组签名 → 无输入框、确定后 `name` 为空直接 return,表现为"点击无效"。
  - **改动**：三个对话框改用新版 `fields` 签名(「新建目录」/「编辑目录」/「编辑场景」,含名称校验 toast 与 `renderMainArea` 刷新)。
- **新增**：左侧栏「游戏场景管理」交互增强(与资源目录节点对齐)——
  - 场景根节点(「游戏场景管理」)右键菜单「新建目录」(新建顶级场景目录)。
  - 场景分类节点:右键菜单完善为「添加场景 / 新建目录 / 编辑目录 / 移动到顶级 / 删除目录」;新增**拖动排序**(同级上/下排序 + 拖入中部变为子分类,复用 `reorderSceneCategory` / `updateSceneCategory`,与资源分类节点一致);节点显示该目录下场景数量(`cat-count`)。
  - 场景条目节点支持右键菜单(与点击同菜单:查看路径/在文件管理器中显示/编辑场景信息/删除)。
  - `scenePage.js` 按钮/文案统一:主页「+ 新建分类」→「+ 新建目录」、目录页「+ 新建子分类」→「+ 新建子目录」、统计卡「目录数」、区块「场景目录」。
- **验证**：新增冒烟步骤 `scenetree`(主页按钮→对话框「新建目录」创建成功;场景根节点右键→新建顶级目录;分类节点数量/拖拽属性/右键菜单 5 项齐全)全部 ok;全量冒烟 `smoke done` 无回归。

### [说明] 发布 v1.5.8(便携版)
- 版本号由 v1.5.7 递增至 v1.5.8(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.8-便携版.zip`。
- 本版本主要变更:侧栏资源工具箱新增「FGUI导出」菜单项(见下方 [新增] 条目)。

### [新增] 侧栏「资源工具箱」增加 FGUI导出 菜单项
- **需求**：在左侧树状菜单栏的「资源工具箱」下增加「FGUI导出」菜单项,指向「FGUI 逆向导出」功能页。
- **改动**：
  - `src/ui.js` `renderToolboxSection`：在「图片编辑」叶子之后新增「FGUI导出」叶子节点(🧩,`nodeId:'__tool:fgui'`,点击 → `openTool('fgui')`);`currentTool` 注释补充 `'fgui'`。
  - FGUI 逆向导出功能本身此前已完整存在(工具页 `renderFguiTool` + 主页入口卡片 + IPC `fgui:batchExport` + `electron/tools/fgui` 解析器),本次仅补齐侧栏入口。
  - `src/main.js` 冒烟 `toolhome`：主页卡片断言 `entries 4→5`(此前漏同步);新增侧栏「FGUI导出」菜单验证——展开工具箱 → 点击「FGUI导出」叶子 → 断言功能页标题「FGUI 逆向导出」。
- **验证**：`vite build` 通过;冒烟全量通过(`smoke done`),`toolhome` 步骤 `entries:5`、`fguiLeafFound:true`、`fguiPageTitle:"FGUI 逆向导出"`、`ok:true`。

### [说明] 发布 v1.5.7(便携版)
- 版本号由 v1.5.6 递增至 v1.5.7(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.7-便携版.zip`。
- 本版本主要变更:「分类」术语统一为「目录」、新建目录入口迁移到类型根节点右键(见下方 [变更] 条目)。

### [变更] 「分类」统一改称「目录」:顶栏按钮移除,类型根节点右键新建目录
- **需求**：①右键菜单中的「新建子分类」改名为「新建目录」;②删除顶栏「新建分类」按钮;③左侧每个类型资源根节点(动画资源/图片资源/音频资源/3D资源)增加右键菜单「新建目录」,点击弹出原「新建分类」窗口(改名为「新建目录」,默认新建顶级目录)。
- **改动**：
  - `index.html`：删除顶栏 `#btn-new-cat`「新建分类」按钮;`src/ui.js` 移除 `bindToolbar` 中对应绑定。
  - `src/ui.js` `renderPseudoNode`：类型根节点(「XX资源」,id='all')新增右键菜单「新建目录」→ `newCategoryDialog()`(新建顶级目录)。
  - 对话框与菜单统一改「目录」：`newCategoryDialog`(标题「新建目录」/字段「目录名称」)、`newSubCategoryDialog`(新建子目录)、`editCategoryDialog`(编辑目录)、`deleteCategoryDialog`(删除目录,子目录处理文案)、`moveCategoryDialog`(移动目录);资源分类右键菜单项「新建目录/编辑目录」;场景分类右键「新建子分类」→「新建目录」、`addSceneCategoryDialog` 标题统一「新建目录」。
  - 其余术语同步：`addFlow.js`「➕ 新建目录…」及弹窗;`homePage` 空态提示改为「在左侧『XX资源』根节点上右键选择『新建目录』」、统计卡「目录数」、区块标题「目录」;`folderPage` 批量移动/资源悬停提示「目录」;tooltip「目录: xxx」。
  - 冒烟同步：`cat` 步骤改经类型根节点右键打开新建目录对话框;`subcat` 步骤断言菜单 `['添加资源','批量添加','新建目录','编辑目录','移动...','删除']` + 根节点右键「新建目录」+ 对话框标题「新建目录」+ 顶栏按钮已移除 + 顶级创建。
- **验证**：`vite build` 通过;冒烟全量通过(`smoke done`),`cat`/`subcat` 步骤新断言(`newDirTitle:"新建目录"`、`topBtnGone:true`、`rootDirTop:true`、菜单项)全部 ok;打包版冒烟通过。

### [说明] 发布 v1.5.6(便携版)
- 版本号由 v1.5.5 递增至 v1.5.6(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.6-便携版.zip`。
- 本版本主要变更:分类目录资源类型标签(见下方 [新增] 条目)。

### [新增] 分类目录资源类型标签:目录按类型(动画/图片/音频/3D/视频/文章)归属显示
- **需求**：分类树中的目录增加资源类型标签属性(动画/图片/音频/3D/视频/文章);带标签的目录只在对应类型的资源树中显示(可多选,如同时勾选「动画+音频」则在两处资源树都显示);无标签的目录在所有资源类型中都显示;目录的「备注」字段改为标签勾选。
- **改动**：
  - `src/state.js`：新增 `CAT_TYPE_TAG_LABELS`(动画/图片/音频/3D/视频/文章)与 `CAT_TYPE_TAGS`;`addCategory` 支持 `typeTags`(非法值自动过滤),`loadState` 兼容旧库分类补 `typeTags:[]`;新增 `categoryTypeTags` / `categoryTypeTagNames` / `catVisibleInGroup`(无标签→所有类型显示;有标签→仅命中分组显示;home/全部视图→始终显示);`getTypeHomeData` 类型主页分类树按标签过滤。
  - `electron/db.js`：categories 表新增 `type_tags` 列(JSON 数组),旧库自动 `ALTER TABLE` 迁移补列,readDb 解析、writeDb 全量写入。
  - `src/dialogs.js`：`promptDialog` 新增 `type:'checkboxes'` 勾选组字段(含 hint 提示行)。
  - `src/ui.js`：侧栏分类树 `renderPseudoNode`/`renderCatNode` 按标签过滤顶级/子分类,节点悬停提示改为「资源类型: xx / 所有资源类型」;「新建分类」「编辑分类」「新建子类别」对话框的「备注」输入框替换为资源类型标签勾选;音频主页分类 chips 仅显示无标签或含「音频」标签的顶级分类。
  - `src/pages/folderPage.js`：目录列表页子分类卡片按「标签 + 当前类型」过滤,悬停提示标签;`src/pages/homePage.js` 类型主页分类节点悬停提示标签。
  - `src/style.css`：新增 `.check-group/.check-item/.form-hint` 勾选组样式。
- **验证**：`vite build` 通过;`catVisibleInGroup` 12 项断言(无标签/单标签/双标签/视频标签×各类树)全 PASS;冒烟全量通过(`smoke done`),`crud`/`audiohome` 等既有步骤无回归;开发库 categories 表 `type_tags` 列迁移成功、默认 `'[]'`。

### [说明] 发布 v1.5.5(便携版)
- 版本号由 v1.5.4 递增至 v1.5.5(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.5-便携版.zip`。
- 本版本主要变更:播放列表条目显示元信息/时长(设置页可配置)、条目右键菜单(修改元信息/编辑文件信息/删除/移动)、条目拖动排序、播放器面板调整(见下方 [新增] 条目)。

### [新增] 播放列表条目增强:元信息/时长显示 + 右键菜单 + 拖动排序 + 面板调整
- **需求**：①播放列表除文件名外,还要显示元信息(ID3)与音频时长,具体显示哪些在播放器设置页配置;②播放列表音频文件支持右键菜单(修改元信息/编辑音频资源文件信息/从列表删除/移动到其它列表);③播放器面板去掉「编辑元信息」按钮,改为播放列表下拉(已有)+「+ 添加音频」按钮(单个|多个);④播放列表条目可拖动排序改变播放顺序,第一列显示序号。
- **改动**：
  - `electron/main.js`：新增 `audio:readMetas` 批量读 ID3 IPC;`electron/preload.js` 暴露 `readAudioMetas`。
  - `src/viewers/audioViewer.js`：队列渲染升级——第一列序号(`.aq-idx`)+ 文件名 + 标题/艺术家/专辑(`.aq-sub`,按设置字段)+ 时长(`.aq-dur`);ID3 批量读取缓存(`_metaCache`)+ 时长异步预载(`_loadDuration`,隐藏 Audio 加载 metadata,3 路并发,`_durCache`);新增 `invalidateMeta`(元信息改后刷新)/ `renamePath`(重命名后更新队列)/ `appendPaths`(追加到队列尾部)。
  - `src/state.js`：`settings.audioListFields`(文件名/标题/艺术家/专辑/时长 勾选,默认全开除专辑)。
  - `src/pages/settingsPage.js`：新增「音频播放器」设置卡片——播放列表条目显示字段勾选,保存后发 `audio:fieldsChanged` 事件即时刷新队列。
  - `src/ui.js`：播放列表管理对话框条目**右键菜单**(修改元信息→`editAudioMetaDialog(path)`;编辑文件信息→`renameAudioFileDialog`(重命名文件);从列表删除;移动到其它列表);条目**HTML5 拖拽排序**(dragstart/dragover/drop 调整顺序并保存);`editAudioMetaDialog` 支持指定路径;新增 `addAudioToListDialog`(多选音频追加到当前列表,列表播放中同步追加队列尾部)。
  - `index.html`/`renderAudioHomePage`：移除播放器面板「✎ 元信息」按钮,预览页播放列表栏新增「+ 添加音频」(`#audio-list-add`),主页播放器区新增「+ 添加音频」(`#ah-add`)。
  - `src/style.css`：队列条目行式布局(序号/主信息/时长)、拖拽样式、设置页字段 chips。
- **修复**：时长预载的坑——`onloadedmetadata` 中清空 `a.src` 会触发 `onerror` 把已缓存时长覆盖为 null,改为不清空 src,`onerror` 仅在无缓存时写入。
- **验证**：`vite build` 通过;冒烟 `audioplayer`(断言序号列=1、时长列=0:01、「+ 添加音频」按钮)与 `audiohome`/`audioplaylist` 等全部通过(`ok:true`),`smoke done`。

### [说明] 发布 v1.5.4(便携版)
- 版本号由 v1.5.3 递增至 v1.5.4(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.4-便携版.zip`。
- 本版本主要变更:播放列表条目可移动到其它列表、音频资源右键「添加到播放列表...」(见下方 [新增] 条目)。

### [新增] 播放列表条目可移动到其它列表 + 音频资源右键「添加到播放列表」
- **需求**：①播放列表中的音乐文件要能移动到别的播放列表;②音频资源的右键菜单要有「添加到指定播放列表」选项。
- **改动**：
  - `src/ui.js` `renderAudioPlaylistManager`：条目工具栏新增「移动到...」按钮——勾选一个或多个条目 → 弹出目标播放列表选择（排除当前列表）→ 追加到目标（自动去重）并从当前列表移除，同步刷新列表与主页标签页。
  - `src/ui.js` `openItemMenu`：单条目右键菜单在「移动到...」之后新增「添加到播放列表...」（仅 `type==='audio'` 显示）。
  - `src/ui.js` 新增 `addToPlaylistDialog(paths)`：选择目标播放列表（默认当前列表）追加音频（去重）；无播放列表时先引导新建（内联新建对话框，创建后继续弹出目标选择）。
- **验证**：`vite build` 通过；新增冒烟步骤 `audioplaylist`（预置两个列表 → 管理对话框勾选条目移动到列表B → 断言列表A 0 条/列表B 1 条；进入音频目录列表页右键 sample-audio → 菜单含「添加到播放列表...」→ 选择列表A 确认 → 列表A 恢复 1 条）通过（`ok:true`）；`audiohome` 等既有步骤无回归。

### [说明] 发布 v1.5.3(便携版)
- 版本号由 v1.5.2 递增至 v1.5.3(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.3-便携版.zip`。
- 本版本主要变更:音频播放器主页(见下方 [新增] 条目)。

### [新增] 音频主页改为播放器页面:分类目录作播放列表 + 自建播放列表标签页切换
- **需求**：音频主页要有播放器页面;页面中的分类目录作为播放器的可播放列表;通过切换标签页的方式切换播放器的自建播放列表。
- **改动**：
  - `src/ui.js` `renderMainArea`：当 `resourceTab==='audio'` 且位于类型主页(`currentCategoryId==='all'`)时,不再渲染统计主页,改为渲染音频播放器主页 `renderAudioHomePage`(新页面 `page-audio-home`)。
  - `renderAudioHomePage`：页面分三区——
    1. **自建播放列表标签页**(`#ah-tabs`):每个自建播放列表一个标签,点击标签 = 切换当前列表并立即播放(`openList`);「+ 新建」「管理」按钮复用播放列表对话框;无列表时提示。
    2. **分类目录 chips**(`#ah-cat-chips`):列出含音频条目的顶级分类与「未分类」,点击某个分类 = 把该分类(含子分类)下所有音频作为播放列表播放。
    3. **播放器区**:曲名/路径、播放/暂停、上一首/下一首、进度、音量、倍速、六种播放模式、「✎ 元信息」编辑按钮、队列列表。
  - `src/viewers/audioViewer.js`：`AudioPlayerController` 支持**多组 UI 绑定**——`_bindEls(els, key)` + `attachEls(els, key)`(同 key 自动替换),所有 UI 同步方法改为遍历 `elsList`(`_eachEls`);主页播放器与预览页播放器、顶栏迷你条共用同一实例与 `audio` 元素。
  - `index.html`：新增 `page-audio-home` 容器;`showPage` 注册 `audio-home`。
  - `src/style.css`：新增 `.audio-home/.ah-*`(标签页/分类 chips/播放器区)样式。
- **验证**：`vite build` 通过;新增冒烟步骤 `audiohome`(点音频 tab → 断言主页为播放器页、标签页/新建/管理/分类目录/播放器控件齐全;预置播放列表渲染为标签、点击后队列播放 1 项;分类 chips ≥1)通过(`ok:true`);`audioplayer` 等既有步骤无回归。

### [说明] 发布 v1.5.2(便携版)
- 版本号由 v1.5.1 递增至 v1.5.2(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.2-便携版.zip`。
- 本版本主要变更:音频播放器全面增强(见下方 [新增] 条目)、图片预览「适配窗口/100%」按钮修复。

### [新增] 音频播放器全面增强:变速 / 六种播放模式 / 播放列表管理 / ID3 元信息 / 后台播放
- **需求**：音频预览页播放器支持变速播放、单次/单曲循环/当前目录顺序/当前目录循环/播放列表顺序/播放列表循环六种模式;播放列表可增删改,列表内音频可增删改查(单个或批量);音频文件内置信息(ID3)可修改;离开预览页可后台继续播放。
- **改动**：
  - `src/viewers/audioViewer.js` 重构为 `AudioPlayerController`：队列管理(单曲/目录/播放列表三种来源)、6 种播放模式(`single`/`loop`/`dirOrder`/`dirLoop`/`listOrder`/`listLoop`,ended 事件按模式自动切歌/停止/循环)、变速播放(`playbackRate` 0.5~2x)、上一首/下一首、队列列表渲染(点击跳播、当前曲高亮)、后台播放(离开预览页不销毁)。
  - `src/state.js`：`DEFAULT_SETTINGS` 新增 `audioMode`/`audioRate`/`audioPlaylists`(`[{id,name,paths}]`)/`audioCurrentListId`,经 settings 随 DB 持久化。
  - `index.html`：音频预览区重构为完整播放器(信息区+元信息按钮、控制区含倍速/模式/上一首/下一首、播放列表栏、队列列表);顶栏新增后台播放迷你条 `#audio-mini`(曲名/播放暂停/上一首/下一首/停止,点击曲名返回音频预览页)。
  - `src/ui.js`：`showAudioPlayer` 按模式进入队列(目录模式自动收集同目录音频并从当前文件开始;列表模式从当前列表播放);新增播放列表管理对话框(列表新建/重命名/删除,条目添加(多选音频)/勾选批量移除/上移下移/单条移除/清空,全部经 settings 持久化);新增 ID3 编辑对话框(标题/艺术家/专辑/年份/音轨/注释);迷你条与播放列表下拉绑定;`pv-back` 返回不再停止音频(后台播放)。
  - `electron/server.js`：新增 `/afile?p=<绝对路径>` 路由,提供任意音频文件(仅音频扩展名,支持 Range)。
  - `electron/main.js`：新增 `audio:listDir`(列目录内音频)/`audio:readMeta`/`audio:writeMeta`(基于 `node-id3` 读写 ID3v2 标签,仅 MP3 等支持 ID3 的格式,其余格式返回友好错误)。
  - `electron/preload.js`：暴露 `listDirAudios`/`readAudioMeta`/`writeAudioMeta`。
  - 依赖:新增 `node-id3@0.2.9`(纯 JS,依赖 iconv-lite);`scripts/pack-manual.js` `MAIN_DEPS` 追加 `node-id3`(打包自动带上)。
  - `src/style.css`：新增播放器/队列/迷你条/播放列表管理对话框样式。
- **验证**：`vite build` 通过;主进程 `node --check` 无误;新增冒烟步骤 `audioplayer`(进入音频预览,断言 6 种模式/倍速/播放列表控件/元信息按钮/队列渲染 1 项/后台迷你条显示与曲名)通过(`ok:true`);`img-bg`/`img-mode` 等既有步骤无回归。

### [修复] 图片预览页「适配窗口」/「100%」按钮点击无效
- **现象**：图片预览页显示模式按钮「适配窗口」「100%」点击无反应。
- **根因**：`index.html` 中 `#img-fit` / `#img-actual` 两个按钮存在，但 `src/viewers/imageViewer.js` 的 `init()` 从未绑定它们的点击事件（仅绑定了滚轮/拖拽/缩放滑块）。
- **改动**：`ImageViewerController.init()` 补充绑定——「适配窗口」→ `this.fit()`（按图片自然尺寸与容器比例自适应）；「100%」→ `this.setZoomUI(1)`（实际大小，退出适配模式）。
- **验证**：`vite build` 通过；新增冒烟步骤 `img-mode`（进入图片预览，点「100%」后缩放滑块=100 且 transform 为 `scale(1)`；点「适配窗口」后恢复自适应缩放）通过（`ok:true`）；`img-bg` 等既有步骤无回归。

### [说明] 发布 v1.5.1(便携版)
- 版本号由 v1.5.0 递增至 v1.5.1(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.1-便携版.zip`。
- 本版本相较 v1.5.0 的变更:批量转换工具(文件/目录分开选 + 最近 10 条输入目录历史)、spine 文件修复批量接入、图片预览页更改背景颜色。
- 约定:自本版本起,**每次打包新版本版本号递增**。

### [新增] 图片预览页支持更改背景颜色(与动画预览一致)
- **需求**：图片浏览页（预览页图片视图）增加类似动画预览页的「更改背景颜色」功能。
- **改动**：
  - `index.html`：`#pv-image-view` 控制条新增「背景」控件——颜色选择 `#img-bg-color` + 快捷按钮 `#img-bg-dark`（深 `#22242b`）/ `#img-bg-light`（浅 `#eef0f5`）。
  - `src/viewers/imageViewer.js`：新增 `setBgColor(color)`，设置 `.img-canvas-wrap` 的背景色。
  - `src/ui.js`：`bindPreviewControls` 绑定图片背景控件（与动画背景共用 `settings.bgColor`，改任一侧即时同步）；`showImageViewer` 进入图片预览时同步控件值并应用当前背景色。
- **验证**：`vite build` 通过；新增冒烟步骤 `img-bg`（进入图片预览，断言三控件存在；点「浅」后查看区背景变浅且设置更新；点「深」恢复；测试后还原用户原设置）通过（`ok:true`）；`ieoverwrite` 等既有步骤无回归。

### [新增] 批量转换输入选择增强:文件/目录分开选 + 最近输入目录历史(含 spine 文件修复批量接入)
- **需求**：文件格式转换（ASTC→PNG / SKEL→JSON / Spine 文件修复）选择被转换文件时，需要既能选单个/多个文件，也能选择整个目录（含子目录）；并保留最近 10 条输入目录路径记录，选择输入文件时可直接定位到历史路径目录。
- **改动**：
  - `src/pages/toolboxPage.js`：`buildBatchTool` 输入区由单个「选择文件/文件夹...」按钮拆为两个明确按钮——「选择文件...」（单个/多个文件，带扩展名过滤）与「选择目录...」（整个目录，后端递归收集含子目录，跳过 node_modules/.git/.svn）；两次选择可累积混选，由「清空」重置。
  - 新增最近输入目录历史：`getInputHistory()/pushInputHistory()` 基于 `localStorage['toolInputHistory']`（全局共享，最多 10 条、新→旧、去重）；选择文件后记录其所在目录、选择目录后记录目录本身。输入区下方渲染「最近目录」chips（`.hist-chip`），点击某条即以该目录为定位重新打开文件选择对话框；两个选择按钮默认定位到最近一条历史目录。
  - **Spine 文件修复由单文件改造为批量工具**：`renderSpineFixTool` 改为复用 `buildBatchTool`（`prefix:'fix'`），`buildBatchTool` 新增 `suffixTag`（`_fixed`，输出 = 文件名 + _fixed + 原扩展名）、`runLabel`/`doneVerb`（按钮与结果文案用「修复」）支持；支持多文件/整个目录递归批量修复、输出到指定目录 + 保持相对结构、失败列表汇总；旧的单文件实现与 `deriveFixed` 删除。
  - `electron/main.js`：`fs:pickFiles` 支持 `opts.defaultPath`，传给原生对话框实现历史目录定位。
  - `src/style.css`：新增 `.tool-history/.hist-label/.hist-chips/.hist-chip/.hist-hint` 样式。
  - 工具描述与工具箱主页卡片文案同步更新。
- **验证**：`vite build` 通过；新增冒烟步骤 `toolhistory`（进入 ASTC 工具断言两按钮 + 历史行 + 预置历史渲染为 chip；再进 Spine 文件修复工具断言同样结构 + 「开始批量修复」按钮）通过（`ok:true`）；`ieoverwrite` 等既有步骤无回归。

### [修复] 打包版启动报 "Cannot find module '@arkntools/astc-decode'"
- **现象**：v1.5.0 便携版启动即崩溃，`Uncaught Exception: Cannot find module '@arkntools/astc-decode'`（Require stack 指向 `app.asar/electron/tools/astc.js`）。
- **根因**：手工打包脚本 `scripts/pack-manual.js` 组装 asar 时只复制了 `dist` / `electron` / `package.json`，**没有打包 `node_modules` 生产依赖**——主进程运行时的 `@arkntools/astc-decode`（ASTC 解码，含 wasm）与 `@esotericsoftware/spine-core`（SKEL 4.x 转换动态 import）在 asar 内无法解析。
- **改动**：
  - `scripts/pack-manual.js` 新增 `MAIN_DEPS` 清单（`@arkntools/astc-decode`、`@esotericsoftware/spine-core`）+ `collectDeps()`（递归收集其 dependencies）+ `copyNodeModules()`，组装 staging 时复制到 `staging/node_modules`（保持相对结构）。新增主进程依赖时只需在 `MAIN_DEPS` 追加包名。
  - 打包健壮性增强：`copyFileRetry()`（复制遇 EBUSY 自动重试，杀软/Defender 瞬时锁定大文件）；`copyDir()` 目标与源「大小+mtime 相同则跳过」避免重复写入被锁文件；rcedit 临时 exe 改用唯一名（含时间戳 stamp），避免反复覆盖旧临时文件被杀软锁定。
- **验证**：重打包后 asar 内 `node_modules` 114 个文件（astc-decode 7 个含 `astc_decode_bg.wasm`、spine-core 104 个）；打包版完整冒烟（`SKELETON_VIEWER_PACK_SMOKE=1`）启动无异常、全部步骤通过（`smoke done`），用户数据自动备份/恢复。

### [说明] 发布 v1.5.0(便携版)
- 版本号由 v1.4.7 升级至 v1.5.0(`package.json` / `package-lock.json`),重新构建 `dist` 并经 `scripts/pack-manual.js` 手工打包便携版,产物:`release/游戏资源管理器-v1.5.0-便携版.zip`。
- 本版本相较 v1.4.7 的变更:批量转换(ASTC/SKEL)、SKEL 支持 .bin 与选择时格式检测、图片编辑「覆盖原文件」保存方式、覆盖式页面导航修复与顶栏返回按钮、工具箱主页等。

### [新增] 图片编辑工具支持「覆盖原文件」保存方式
- **需求**：图片编辑工具的保存选项里需要提供「替换原文件」的选项——处理结果直接写回原文件，而不是另存为带 `_op` 后缀的新文件。
- **改动**：
  - `src/pages/toolboxPage.js`：`renderImageEditTool` 新增「保存方式」下拉（`#ie-save`）：「另存为新文件（原文件保留）」/「覆盖原文件（⚠ 不可恢复）」。选择覆盖时隐藏「输出格式 / 输出目录」行并清空输出目录；执行前弹 `confirmDialog`（danger 红色按钮）确认「将直接覆盖 N 个原文件，不可恢复」。覆盖模式输出路径即原文件路径，编码格式跟随原扩展名（png→PNG、jpg/jpeg→JPEG、webp→WebP）；gif/bmp 无法由 canvas 以原格式写回，跳过并提示改用另存。结果区显示「已覆盖 N 个原文件」。
  - `applyOp(img, op, fmt)` 增加可选格式参数（支持 `png` / `jpeg` / `webp`），供覆盖模式指定输出编码。
  - 工具箱主页与工具描述文案同步提及「可覆盖原文件」。
  - `src/main.js` / `electron/main.js`：新增冒烟回归步骤 `ieoverwrite`（进入图片编辑工具，断言保存方式默认「另存」、输出行可见；切到「覆盖原文件」后输出行隐藏；切回后恢复）。
- **验证**：`vite build` 通过；冒烟步骤 `ieoverwrite` 通过（`ok:true`）。

### [新增] SKEL→JSON 文件选择支持 .bin 后缀并选择时检测 Skel 格式
- **需求**：SKEL 转 JSON 工具的文件选择对话框，需要把 `.bin` 后缀（实际是 `.skel` 格式、仅扩展名不同）的文件也纳入可选类型；且选择时（尤其是 `.bin`）要检测该文件是否真为 Spine 二进制骨架格式，非 Skel 格式的文件应被跳过并提醒，避免把无关二进制当骨架转换。
- **改动**：
  - `electron/main.js`：导入 `probeSkeleton`；新增 `tool:probeSkel` IPC——读取文件头并用 `probeSkeleton` 探测是否为有效 Skel 二进制（`{ok:true,version}` 或 `{ok:false,reason}`）。
  - `electron/preload.js`：暴露 `probeSkel`。
  - `src/pages/toolboxPage.js`：`renderSkelTool` 的 `filters` 与 `inputExt` 增加 `bin`（`Spine 骨架 (.skel / .bin)`），并新增 `validateFile` 回调（调用 `probeSkel`）；`buildBatchTool` 在 `collect()` 收集后按需对每个匹配文件调用 `validateFile`，非目标格式者进入 `skippedFiles` 从待转换清单剔除，并在结果区以 `⚠ 已跳过 N 个非 Skel 格式文件:...` 提示；`renderList()` 计数追加「· 跳过 N 个」；`setResult` 新增 `warn` 类型；「清空」同步重置 `skippedFiles`。
- **验证**：`vite build` 通过；主进程 `node --check` 无误；以构造的最小合法 Spine 二进制#2 头（`.bin`）验证 `probeSkeleton` 返回 `{kind:'binary',version:'3.8.99'}`，以 PNG 头冒充的 `.bin` 返回 `null`（判为无效）；冒烟步骤 `batchui` 仍通过。

### [新增] ASTC→PNG / SKEL→JSON 工具支持批量转换（多选文件或文件夹）
- **需求**：「资源工具箱」中的 ASTC 转 PNG、SKEL 转 JSON 两个工具，需要可以一次性选取多个文件或文件夹进行批量格式转换（此前仅支持单文件）。
- **改动**：
  - `electron/main.js`：`fs:pickFiles` 新增 `filesAndDirs` 选项（同时允许选文件与文件夹、可多选）；新增 `tool:collectFiles` 处理器——给定若干文件/文件夹路径，递归收集匹配扩展名的文件（跳过 node_modules/.git/.svn 等），并为每个文件记录所属「根目录」（直接选中的文件→其所在目录；选中的文件夹→文件夹本身），供「保持相对目录结构」计算输出位置。错误路径静默忽略。
  - `electron/preload.js`：暴露 `collectFiles`（`tool:collectFiles`）。
  - `electron/tools/skel.js`：新增 `loadSpine38()` 模块级缓存，批量转换时不再逐文件重复 `vm` 沙箱加载 3.x 运行时；`skelToJson` 3.x 分支改用该缓存（行为不变）。
  - `src/pages/toolboxPage.js`：`renderAstcTool` / `renderSkelTool` 重构为共用 `buildBatchTool(body, cfg)` 批量面板——「选择文件/文件夹...」按钮（多选）、选中清单（只读列表 + 已选项数 / 匹配文件数）、输出设置（「输出到指定目录」开关 + 目录选择；「保持相对目录结构」开关）、「开始批量转换」/「清空」按钮、逐项转换 + 进度（处理 i/N）+ 成功/失败汇总（失败列表可展开）+「打开输出目录」按钮。输出路径：未指定目录→源文件同目录同名换扩展名；指定目录且「保持结构」→按根目录还原子目录；扁平→同名防碰撞追加序号。
  - `src/style.css`：新增 `.tool-filelist` / `.tfile` / `.field-ctrl.col` / `.outdir-row` / `.batch-summary` / `.batch-fail` 等样式。
- **验证**：`vite build` 通过；`node --check` 校验主进程 `main.js` / `preload.js` / `skel.js` / `astc.js` 无误；新增冒烟步骤 `batchui`（进入 ASTC 子工具，断言批量控件齐全、空列表、运行按钮禁用、勾选输出目录开关后目录行与保持结构行显示）通过；另行用真实 `.astc` 样本验证 `astcToPng` 生成有效 PNG、`collectFiles` 递归/多文件/容错逻辑、spine38 缓存加载路径均正确。

### [修复] 覆盖式页面拦截左侧资源分类节点切换
- **现象**：当右侧主内容区处于「资源工具箱」子页面 / 「游戏场景管理」页面 / 「设置」页面时，点击左侧资源分类树中的节点（类型根节点 `all`、分类节点等）无法切换页面，主区仍显示原页面。
- **根因**：`renderMainArea()` 按优先级分发页面——`currentTool`(工具箱) → `sceneHomeShown/currentSceneCatId`(场景) → `settingsShown`(设置) → 收藏夹 → 资源。这些「覆盖式」状态在切换进工具箱/场景/设置时并未在资源节点点击处理器中被清除，导致 `renderMainArea` 始终优先渲染旧覆盖页面，资源导航被静默拦截。
- **改动**：
  - `src/ui.js` 新增 `clearOverlays()`（清 `currentTool` / `sceneHomeShown` / `currentSceneCatId` / `settingsShown` / `favHomeShown` / `currentFavCategoryId`）。
  - 在以下入口调用：`renderPseudoNode` 与 `renderCatNode` 的资源节点点击、`renderToolboxSection` 工具箱根点击、`openTool()`、场景根/未分类/分类节点点击、收藏夹根/分类节点点击、以及面包屑点击（顶部先行 `clearOverlays()`）。从而无论从哪个覆盖式页面点击资源节点，都能真正切回资源区。
- **验证**：新增冒烟回归步骤 `navfix`（见 `electron/main.js` 步骤表 + `src/main.js` 实现）——分别进入工具箱子页面、场景主页、设置页后点击 `all` 节点，断言均切回资源区；全部通过（`ok:true`）。`vite build` 通过。

### [新增] 工具箱 / 场景管理页顶栏「← 返回」按钮
- **需求**：资源工具箱子页面、游戏场景管理页面需提供显式「返回」入口，回到进入前的资源浏览区（设置页此前已有自身「← 返回」按钮，保持不变）。
- **改动**：
  - `index.html` 顶栏（品牌名之后、面包屑之前）新增 `id="btn-back-special"` 按钮（默认 `hidden`）。
  - `src/ui.js` 新增 `bindBackSpecial()`（点击 → 若在设置页则 `closeSettings()`，否则 `clearOverlays()` + 重渲染回到资源区）与 `updateBackSpecial()`（仅在 `currentTool` 或场景页显示该按钮，其余页面隐藏）；并在 `renderMainArea()` 开头调用 `updateBackSpecial()` 同步显隐，`init` 中绑定 `bindBackSpecial()`。
- **验证**：`navfix` 冒烟步骤同时断言——工具箱页 / 场景页显示返回按钮、资源区隐藏返回按钮，均通过。

### [新增] 资源文件右键菜单「重命名」
- **需求**：在资源列表/主页资源条目的右键菜单中增加「重命名」项，可快速改名。
- **改动**：
  - `src/ui.js` 新增 `renameItemDialog(it)`：图片类型弹「重命名图片文件」对话框（主名可改、扩展名只读），确认时调用 `window.api.renameFile` 重命名磁盘文件并更新 `item.filePath`（与编辑图片窗口一致）；其它类型弹「重命名」对话框改**显示名称**（纯元数据，避免破坏 Spine 等多文件资源的配套文件）。
  - `openItemMenu`（单条目右键菜单）在「编辑」后增加「重命名」项（影响目录列表页与类型主页资源条目）。
  - `src/main.js` 冒烟测试断言的菜单项顺序同步加入「重命名」（位于「编辑」之后）。
- **验证**：`vite build` 通过（724 模块），`dist` 含新逻辑；同步修正测试期待。

### [新增] 编辑图片窗口可修改图片文件名（重命名磁盘文件）
- **需求**：弹出的「编辑图片」窗口（条目编辑对话框 `editItemDialog`）当前只能改显示名称、分类、备注、标签，不能改实际文件名。现新增「文件名」输入。
- **改动**：
  - `src/ui.js` `editItemDialog` 对 `type==='image'` 条目增加「文件名」输入（显示主名 + 扩展名后缀，扩展名只读不可改）；保存时若文件名被改动，则调用 `window.api.renameFile` 重命名磁盘文件（仅改文件名、不跨目录），成功后用新路径更新 `item.filePath`；同名/含路径分隔符/重命名失败均提示且**不关闭**对话框让用户修正。
  - `electron/main.js` 新增 `fs:rename` IPC（校验原文件存在、目标名已存在、禁止跨目录移动）；`electron/preload.js` 暴露 `renameFile`。
  - `src/style.css` 新增 `.file-name-wrap / .file-name-input / .file-ext` 样式（输入框 + 扩展名后缀拼接）。
- **范围**：仅图片条目支持改名；动画/音频/3D 等多文件资源为避免破坏 `.atlas`、配套 `.png` 等关联文件，暂不开放文件名字段。
- **验证**：`vite build` 通过（724 模块），`dist` 含新逻辑。

### [新增] 截图可自动加入「图片资源」指定分类 + 设置按钮改名
- **设置按钮改名**：顶栏「⚙ 系统设置」按钮改名为「⚙ 设置」（`index.html`）。
- **截图入库选项**：`系统设置` 页「动画截图」区块新增两项——复选框「截图后自动加入『图片资源』的指定分类」（默认开启）、文本框「图片分类名」（默认 `spine截图`）。对应设置项 `screenshotAddToLibrary`(默认 `true`) / `screenshotCategory`(默认 `spine截图`)，并入 `DEFAULT_SETTINGS` 兜底补齐。
- **入库逻辑**：`doCaptureScreenshot()`（`src/ui.js`）在文件保存成功后，若 `screenshotAddToLibrary` 为真，按 `screenshotCategory` 名称查找或自动创建顶级分类（`state.findOrCreateCategoryByName`），并以 `addItem({type:'image', filePath, categoryId})` 把截图作为图片条目加入库（已存在同路径则跳过避免重复），随后 `renderTree()` 刷新侧栏计数。
- 验证：`vite build` 通过（724 模块），`dist` 已含新逻辑。

### [新增] 动画预览截图功能（透明背景 PNG/WebP）+ 系统设置页
- **截图按钮**：动画预览工具栏新增「📷 截图」按钮，截取当前帧为**透明背景**图片。实现：`src/preview/index.js` `PreviewController.captureFrame()` —— 用 `renderer.extract.canvas(viewC)` 提取角色容器（不含渲染器背景色），再 `toDataURL('image/png'|'image/webp')`。
- **默认保存路径 / 默认格式**：在 `系统设置` 页（顶栏「⚙ 系统设置」按钮打开，`src/pages/settingsPage.js`）设置。新增设置项 `screenshotPath` / `screenshotFormat`(`png`|`webp`) / `screenshotQuality`(WebP 质量)，存入 `state.settings` 并持久化（兜底层 `DEFAULT_SETTINGS`，旧库缺字段自动补齐）。
- **默认路径兜底**：`src/main.js` 启动时若 `screenshotPath` 为空，则设为 `app.getPath('pictures')/Spine截图`（`electron/main.js` `app:info` 已返回 `pictures`/`downloads`）。
- **保存逻辑**：`src/ui.js` `doCaptureScreenshot()` 拼接文件名 `<资源名>_<动作名>_<时间戳>.<扩展名>`，通过已有 IPC `fs:writeFileBase64` 写入默认目录（`electron/main.js` 已支持递归建目录），保存后 toast 提示路径。
- **关键约束**：仅动画预览支持（图片/音频预览无此按钮）；WebP 透明由 Chromium canvas 支持；截图尺寸跟随当前画布分辨率（含 devicePixelRatio，最高 2x）。

### [新增] 编辑窗口分类完整路径 + 文件地址可复制 + 搜索框一键清空
- **编辑动画/图片/音频窗口（所属分类）**：下拉选项 label 由 `c.name` 改为 `categoryPath(c.id)`，子分类显示完整路径（如 `父分类 / 子分类`）。改动：`src/ui.js` `editItemDialog`。
- **属性窗口「文件」行 + 编辑窗口「文件」行**：改为可复制路径组件——文本可手动选中（Ctrl+C），右侧 ⧉ 按钮点击直接复制并 toast「已复制路径」。`src/ui.js` `itemPropertiesDialog` / `editItemDialog`。
- **预览页文件地址**（动画 `pv-path`、音频 `audio-path`，图片复用顶部 `pv-path`）：全部改为可复制路径组件。`src/ui.js` `showPreviewPage` + `src/viewers/audioViewer.js` `load`。
- **搜索框一键清空**：顶栏 `#search` 与目录列表 `#folder-search` 右侧增加 × 清空按钮，有输入时显示，点击清空并立即重新过滤。`index.html` + `src/ui.js` 绑定 + `src/pages/folderPage.js` 模板与绑定。
- **新增** `src/clipboard.js`：`copyText`（navigator.clipboard + execCommand 兜底）、`makeCopyablePath`、`setCopyablePath` 复用组件；配套 CSS `.copyable-path / .cp-text / .cp-copy / .search-clear / .folder-search-clear`。
- **验证**：`vite build` 成功（723 模块），`dist` 含 `copyable-path` 与 `search-clear` 逻辑。

### [修复] 播放 `Move` 动画崩溃：`draworder` 偏移被写成无符号整数
- **文件**：`1040701.json`（Spine 3.8.84，63 骨骼 / 115 槽 / 7 动画）
- **现象**：打开转换得到的 JSON 报错 `Cannot read properties of undefined (reading 'bone')`，仅 `Move` 动画触发，其余 6 个动画正常。
- **根因**：`Move` 动画的 `draworder` 时间线中 `slot="luwu_36"` 的 `offset=4294967274`，真实值是有符号 int32 的 **-22**（`0xFFFFFFEA`），却被写成**无符号**形式。Spine 运行时按 `originalIndex + offset` 计算目标槽位 → `60 + 4294967274` 远超槽位数 115 → 该条目被丢弃 → `skeleton.drawOrder` 混入 `undefined` → 播放器遍历 `drawOrder` 时 `slot.bone` 抛错。`.skel` 二进制按有符号 int 存储偏移不受影响，故仅「转换出来的 JSON」触发（本项目的 `skel→json` 工具故意省略 `draworder`，不会产出该问题）。
- **修复**（`src/preview/spine38Player.js`）：
  - 新增 `normalizeDrawOrderOffsets()`，加载时把 `draworder` 每帧 `offsets` 的 `offset` 做 `offset | 0` 转回有符号 int32（合法小偏移不受影响），从根上修复。
  - 对 `skeleton.drawOrder` 全部 4 处遍历（`_pickBestActionName` ×2、`_refreshMeshes`/`_updateRecord`、`getSkeletonBounds`）的守卫由 `if (slot.bone && !slot.bone.active) continue;` 改为 `if (!slot || (slot.bone && !slot.bone.active)) continue;`，任何畸形动画不再拖垮整页预览。
- **验证**：Node 复现脚本套用同一归一化后 7 个动画全部 OK，`drawOrder` 无 `undefined`；`vite build` 成功（`dist/index.html → index-kh8wbPXv.js` 含 `offset|0` 与 `!slot||` 守卫）。
- **用户侧**：用 `launch-electron.js` 启动读 `dist`，需重新 `build` 才生效（已 build）。

### [说明] `1040604.skel` 图标模式无缩略图 → 实为旧构建滞后
- **结论**：当前最新代码下缩略图生成正常；用户当时运行的是旧打包版（`release/骨骼动画预览器.exe` 或 `dist/` 未重新 build），导致旧缩略图链路失败。
- **处置**：用最新代码重启（`npm start` 自动 build）即可，无需重新添加条目。

### [新增] `.bin` 探测增强：识别为 `.skel` 时自动改扩展名统一格式
- **改动**（`electron/scanner.js`）：扫描 `.bin` 若探测为 Spine 二进制骨架，自动 `fs.renameSync` 改扩展名为 `.skel`（仅改名、不移动/不覆盖）；已存在同名 `.skel` 则跳过该 `.bin`，避免重复条目；改名失败仍按 `.bin` 骨架条目处理并提示。

### [新增] `.bin` 格式检测：识别为 Spine 二进制则按 `.skel` 预览
- **改动**（`electron/scanner.js`）：新增 `probeBinFile()` 只读头部 256 字节调 `probeSkeleton` 探测，命中 Spine 二进制则作为 `spine` 类型条目（`binAsSkel: true`），并入 `spineBases` 避免同名 png 被当普通图片。预览端自动拼接同名 `.atlas`，版本探测走 `skelProbe`。

### [修复] `skel→json` 工具 3.x 路径错误 + 序列化器帧错位（`1010104.bin`）
- **根因 1（路径）**：`resolveSpine38Path()` 少一层 `..` 解析到 `electron/vendor/` 而非项目根 `vendor/` → 新增多候选路径解析。
- **根因 2（3.x 加载）**：`AtlasAttachmentLoader` 需要 `atlas.findRegion` → 传入假 atlas `{findRegion: () => fakeRegion}`。
- **根因 3（帧错位，重要）**：各 Timeline 的 `frames` 是**扁平布局**（非按帧索引），旧序列化按索引取字段导致全错位 → 改用 `hookTimelines(spine)` monkey-patch `setFrame/setCurve/setStepped` 记录原始参数，天然兼容 3.x/4.x。
- **根因 4（3.x/4.x 结构差异）**：附件无字符串 type（用枚举）、mesh 的 JSON 应输 `regionUVs`、deform 帧布局不同、linkedmesh 字段名差异、约束/动画结构字段名不同 → 按 `probe.version` 输出对应格式（`format='3'|'4'`），skin 名反查。
- **验证**：`1010104.bin → JSON → 3.8` round-trip 46 条时间线、334 个数值 0 不匹配，bones/slots/skins/ik/duration 全一致。

### [新增] Spine 文件修复增加「诊断与修复总结说明」
- **改动**（`electron/tools/spineFix.js` + `src/pages/toolboxPage.js` + `src/style.css`）：`buildSummary()` 生成结构化 `summary`（verdict：healthy/fixed/warning；lines 诊断结论；notes 总结说明；counts）；结果区先渲染 `.summary-box` 三色总结卡片，再展示修复副本路径与详细诊断记录。

### [新增] 资源工具箱 + 游戏场景管理（侧栏根菜单）
- **资源工具箱**：`astc→png`（`@arkntools/astc-decode` 软件解码）、`skel→json`（3.x 走 `vm` 沙箱加载 `vendor/spine38`、4.x 走 `@esotericsoftware/spine-core`）、`spine 文件修复`（剥 BOM/注释/尾逗号、补缺版本）、图片编辑（镜像/旋转/缩放/缩略图，单张与批量）。配套 `electron/png.js` 自实现 PNG 编码器、`tool:astc2png/skel2json/spinefix` IPC。
- **游戏场景管理**：`state.js` + `electron/db.js` 新增 `scene_categories` / `scenes` 表与完整 CRUD；侧栏「游戏场景管理」根菜单支持场景分类（递归子分类、右键新建/编辑/提升顶级/删除）；`src/pages/scenePage.js` 实现首页统计 + 分类页 + 场景表格。
- **依赖**：`@arkntools/astc-decode@1.0.0`。

### [修改] 主页图标 → 灰度线条 SVG
- **改动**（`index.html` + `src/style.css`）：顶栏品牌图标由彩色 emoji 改为 Feather 风格 home SVG（`stroke="currentColor" fill="none"`），跟随主题、去彩色。

### [修改] 顶栏品牌名 →「全部资源首页」按钮化
- **改动**（`index.html` + `src/style.css` + `src/ui.js`）：`.brand` 文案由「游戏资源管理器」改为「全部资源首页」，样式改为与「资源树」按钮同族（1px 边框 + 圆角 + hover），前置主页图标。

### [新增] 侧栏分类树：类型根节点改「XX资源」并可展开/折叠
- **改动**（`src/ui.js`）：分类树顶部类型根节点名称随 tab 变化（`动画资源` / `图片资源` / `音频资源` / `3D资源` / `资源`），前加 ▶/▼ 箭头展开/折叠该类型的分类目录；`expandedCats` 默认含 `'all'`（默认展开）。

---

> 更早的变更未纳入本日记（本日记自 2026-08-07 起按上述约定维护）。
