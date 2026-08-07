# 更新日记 (Changelog)

> **游戏资源管理器**（原骨骼动画预览器）变更记录。
>
> **约定**：每次新增功能（标记 `[新增]`）或修复问题（标记 `[修复]`）后，均在此文件追加一条**带日期**的记录，新记录置顶（最新的在最上面）。
> 旧记录仅作归档，不再修改内容。版本号以 `package.json` 中 `version` 为准（当前 `v1.5.5`）。

---

## 2026-08-07

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
