# 更新日记 (Changelog)

> **游戏资源管理器**（原骨骼动画预览器）变更记录。
>
> **约定**：每次新增功能（标记 `[新增]`）或修复问题（标记 `[修复]`）后，均在此文件追加一条**带日期**的记录，新记录置顶（最新的在最上面）。
> 旧记录仅作归档，不再修改内容。版本号以 `package.json` 中 `version` 为准（当前 `v1.7.6`）。

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
