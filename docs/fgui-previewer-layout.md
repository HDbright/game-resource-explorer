# FGUI 包预览器 — 布局与组件说明

> 对象：游戏资源管理器（Electron）内嵌的 **FGUI 界面预览器**
> 代码：`src/pages/scenePage.js`（页面/工具栏/事件）、`src/viewers/fguiLayoutPreview.js`（PixiJS 渲染与交互）、`src/style.css`（`.fg-*` 样式）
> 入口：左侧「游戏场景管理」→ 主页「🧩 FGUI 界面预览」卡片 / 场景目录页 🧩 按钮 / 侧栏 FGUI 条目单击 / 「添加场景」登记后从场景管理打开

---

## 一、整体布局（三区结构）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ① 工具栏 .fg-pv-toolbar（一行按钮，自动换行）                                │
│   ←返回 | 📦选择FGUI包 | 📌登记到场景管理 | 包名 | 📌已登记:目录/名称        │
│   | 组件下拉 ▼ | (控制器条) | ……空隙…… | ✎编辑模式 | ↩撤销 | 📦解压FGUI包   │
│   | 📤导出资源 | 💾保存快照 | 🔧选择纹理目录 | 状态文本                      │
├──────────────────────────────────────────────┬──────────────────────────────┤
│ ② 画布区 .fg-canvas-wrap（flex:1）            │ ③ 右侧面板 .fg-side         │
│   - <canvas id="fgpv-canvas">  PixiJS 渲染     │  ║ #fgpv-hsplit 左边框拖宽  │
│   - .fg-text-layer 文本 DOM 叠加层            │  ├ 组件列表 .fg-comp-bar     │
│   交互：滚轮缩放/拖拽平移/点选/编辑模式        │  │  📋组件列表(树形,滚动)    │
│   组件高亮：点击列表项画黄色定位框             │  ═ #fgpv-vsplit 分割线拖高   │
│                                              │  ├ 快照条 .fg-snap-bar       │
│                                              │  │  📋快照 ▾ | ↺加载|🗑|📂  │
│                                              │  └ 属性面板 #fgpv-props      │
│                                              │     （点击对象后显示属性）    │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

- 布局 CSS：`.fg-preview-page`（整页）→ `.fg-pv-toolbar`（顶部横条，`flex-wrap` 可换行）→ `.fg-preview-layout`（`display:flex`，画布 + 右侧）
- 右侧 `.fg-side`（默认宽 250px，**可拖左边缘调整 180~480px**）纵向排列：组件列表 → 分割线 → 快照条 → 属性面板
- **组件列表**与**属性面板**默认各占一半垂直空间（`flex: 1 1 50%`），中间分割线可上下拖动调整占比
- 尺寸记忆：`localStorage`（`fgpv-sideW` / `fgpv-compH`），下次打开自动恢复

---

## 二、工具栏控件清单（①区）

| # | id | 名称 | 功能 | 默认状态 |
|---|---|---|---|---|
| 1 | `#fgpv-back` | ← 返回 | 退出预览，回到场景主页 | 常显 |
| 2 | `#fgpv-pick` | 📦 选择 FGUI 包(.bin) | 弹出文件选择，加载 .bin；加载后未登记则弹「登记 FGUI 包」对话框 | 常显 |
| 3 | `#fgpv-register` | 📌 登记到场景管理 | 补登记当前包到指定场景目录（`promptRegisterFgui`） | 未登记时显示，已登记隐藏 |
| 4 | `#fgpv-pkg` | 包名（文本） | 显示 `包名 (v版本)` | 加载后填充 |
| 5 | `#fgpv-reg` | 已登记状态（文本） | 显示 `📌 已登记:目录路径 / 名称`，未登记为空 | 加载后更新 |
| 6 | `#fgpv-comp` | 组件下拉（select） | 选择要预览的组件（包内所有 Component）；切换即 `load(compId)` 重渲染 | 加载后启用 |
| 7 | `#fgpv-ctrls` | 控制器条 | 每个控制器一个按钮组（页名按钮），点击切换控制器页并按 gearDisplay 重算可见性 | 有控制器时显示 |
| 8 | `#fgpv-edit` | ✎ 编辑模式 | 开关可视化编辑：拖拽移动、8 手柄缩放、属性面板可编辑、双击文本内联编辑；激活时按钮高亮 `.active` | 加载后启用 |
| 9 | `#fgpv-undo` | ↩ 撤销 | 撤销上一步编辑（Ctrl+Z 同效）；无历史时禁用 | 仅编辑模式启用 |
| 10 | `#fgpv-unpack` | 📦 解压FGUI包 | 单文件导出到 `.bin` 同目录/`<包名>/`（`fguiExportSingle` + 复制图集 PNG）；已存在文件时弹覆盖确认 | 加载后启用 |
| 11 | `#fgpv-export` | 📤 导出资源 | 同上（`exportCurrentPkg({actionLabel:'导出'})`），状态文案为「已导出到」 | 加载后启用 |
| 12 | `#fgpv-snapshot` | 💾 保存快照 | 保存当前组件编辑后布局为 JSON 快照，默认存 `.bin` 同目录/`<包名>/`，并关联到场景条目（`fguiSnapshots`） | 加载后启用 |
| 13 | `#fgpv-texdir` | 🔧 选择纹理目录 | 自动探测图集失败时手动指定纹理目录后重载 | 仅缺纹理时显示 |
| 14 | `#fgpv-status` | 状态文本 | 解析/渲染/操作结果提示（含「编辑历史 N 条」） | 常显 |

> 控件 8-12 初始 `disabled`，包加载成功（`payload` 就绪）后启用（`updateToolbarState()`）；`#fgpv-undo` 额外要求编辑模式开启。

---

## 三、画布区（②区）交互

| 操作 | 行为 | 实现 |
|---|---|---|
| 滚轮 | 缩放 0.05×~8×，以鼠标位置为锚点 | `wheel` 监听 + `viewC.scale` |
| 左键拖拽（非编辑模式） | 平移画布 | `pointerdown/move/up` + `viewC.position` |
| 单击对象 | 选中并高亮（蓝色边框 `.sel`），右侧属性面板显示该对象属性 | `_pick` / `selectNode` / `_renderProps` |
| 编辑模式下拖拽对象 | 移动节点（x/y 实时更新，同步文本层与属性面板） | `_editDrag` / `_applyNodeXY` |
| 编辑模式下拖拽 8 个手柄 | 调整宽高（`initWidth/initHeight`） | `_resizeDrag` / `_hitResizeHandle` / `_updateResize` |
| 双击文本节点 | 内联编辑文本（DOM textarea，失焦提交） | `_startTextEdit` |
| Ctrl+Z / ↩ 撤销 | 回退上一步编辑（撤销栈 `_editStack`） | `undo()` |
| 文本对象 | 独立 DOM overlay（`.fg-text-node`）随画布 transform 同步，天然支持中文/换行/选中框 | `_makeTextDiv` / `_syncOverlay` |

### 渲染与数据
- PixiJS 8 独立 `Application`（不复用动画预览画布），`ticker.stop()` + 交互后手动 `render()`
- 节点 = 双层容器：外层定位 `x+pivot*w`，内层 `-pivot` 偏移 + scale/rotation/alpha
- 可见性由控制器页 + gearDisplay 统一计算（`_applyVisibility`）

---

## 四、右侧面板（③区）

### 4.0 组件列表面板 `.fg-comp-bar`（v1.6.4+）
| id | 控件 | 功能 |
|---|---|---|
| `#fgpv-compbar` | 组件列表面板 | 右侧顶部；**默认与属性面板各占一半垂直空间**，`#fgpv-vsplit` 分割线可上下拖动调占比（60px~面板高-140px） |
| `#fgpv-complist` | 组件树列表 | 完整列出包内全部组件及组件树全部节点（按深度缩进）：主组件 `📦 名称 (类型)`，子节点 `└ 名称 (类型)`；**引用外部包的节点标注 `@外部包名`**（橙色，如 `└ btnGet @Common Button`） |
| `#fgpv-compcnt` | 条目计数 | 列表条目总数 |
| 点击条目 | 联动 | ① 画布黄色定位框（`highlightNode`，偏离视口自动平移居中）② **属性面板显示该节点属性**（`selectNode`）③ 若节点属于未显示的主组件，自动切换组件 ④ 列表 active 高亮；画布点选节点时列表同步高亮 |
| `#fgpv-hsplit` | 面板宽度拖拽条 | 右侧面板左边缘竖条，左右拖动调整面板宽度（180~480px，向左拖变宽） |
| 尺寸记忆 | localStorage | `fgpv-compH` / `fgpv-sideW` 持久化，重建自动恢复 |

### 4.1 快照条 `.fg-snap-bar`
| id | 控件 | 功能 |
|---|---|---|
| `#fgpv-snaps` | 下拉 | 该 FGUI 包已保存的布局快照列表（`名称 · 时间`，按时间倒序） |
| `#fgpv-snap-load` | ↺ 加载 | 回放选中快照（`applySnapshot`；组件不匹配自动切换组件） |
| `#fgpv-snap-del` | 🗑 | 从关联记录移除（磁盘文件保留，有确认框） |
| `#fgpv-snap-folder` | 📂 | 打开快照所在目录 |
> 数据源：场景条目 `fguiSnapshots`；未加载包时整条隐藏。

### 4.2 属性面板 `#fgpv-props`
- 未选中：提示「点击画布中的对象查看属性」
- 选中对象后渲染 `_renderProps(node)`：
  - 基础信息：名称 / id / 类型 / kind / 跨包归属（srcPkgId）
  - **坐标尺寸**：x / y / width / height（编辑模式下为输入框，`change` 提交并写编辑历史）
  - **变换**：scaleX / scaleY / pivotX / pivotY / rotation / alpha
  - **可见性**：visible（checkbox）+ gearDisplay 控制器约束
  - **文本**：text / 字号 / 颜色（kind=text 时）
  - 图集引用：atlasKey + sprite 矩形（kind=image 时）

---

## 五、布局演进记录（已实现改进）

| 版本 | 改进 |
|---|---|
| v1.6.4 | **组件列表面板**：右侧顶部新增「📋 组件列表」——树形列出主包组件 + 跨包子组件（`@外部包名` 标注），点击画布黄色定位框高亮 |
| v1.6.5 | **可拖拽布局**：组件列表/属性面板默认 50/50 + `#fgpv-vsplit` 分割线调占比；右侧面板左边缘 `#fgpv-hsplit` 拖宽；localStorage 记忆 |
| v1.6.6 | **列表完整化 + 属性联动**：列表完整列出组件树**全部节点**（本包 + 跨包，按深度缩进，本包节点不再缺失）；点击列表项**属性面板联动显示**该节点属性；点击其他主组件项自动切换组件；顶部组件下拉与列表双向同步 |

## 六、关键代码位置索引

| 能力 | 位置 |
|---|---|
| 页面 HTML/事件 | `src/pages/scenePage.js` → `renderFguiPreviewPage()`（约 123 行起） |
| 渲染器初始化/加载 | `fguiLayoutPreview.js` → `init()` / `load()` / `_buildNode()` |
| 点选/高亮/属性 | `_pick()` / `selectNode()` / `_renderProps()` |
| 编辑模式/撤销 | `setEditMode()` / `_applyPropFromInput()` / `undo()` / `_commitEdit()` |
| 快照 | `exportEdits()` / `applySnapshot()` |
| 控制器 | `_renderCtrlBar()` / `_applyVisibility()` |
| 样式 | `src/style.css`：`.fg-pv-toolbar` / `.fg-canvas-wrap` / `.fg-side` / `.fg-snap-bar` / `.fg-prop-panel` / `.fg-ctrl-*` |
