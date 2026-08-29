# .skani —— 骨骼动画编辑器专属工程文件格式 · 实施方案

> 版本:v1(方案)→ 对应格式 schema **v2**
> 目标:为编辑器设计单文件、可版本演进、导入友好的专属工程格式,替代明文 `.lbone.json` 作为**首选存档格式**(`.lbone.json` 保留兼容读取与调试导出)。

---

## 1. 设计决策:明文内核 + ZIP 容器(否决纯二进制)

| 维度 | 纯二进制(.spine 式) | ZIP + JSON(采纳) |
|---|---|---|
| 写坏一个字节 | 整文件报废 | 局部损坏仍可解出大部分条目 |
| 排查/调试 | 逆向工具 | 解压即读,文本编辑器可看 |
| 版本演进 | 自研编解码兼容 | 加字段即可,未知字段原样保留 |
| 图片存储 | 需自定二进制区 | 原样 PNG,不 base64(省 33%) |
| 实现成本 | 数周(状态机+引用表) | 主进程 ~200 行(zip 读写)+ IPC |

**结论**:外壳 ZIP(deflate)、内核明文 JSON——与 .docx/.odt 同构。zip 读写在**主进程**自研极简实现(node `zlib` + `crypto`,无第三方依赖),渲染进程经 IPC 存取。

## 2. 文件布局

```
myproject.skani              ← ZIP 容器(条目 deflate 压缩)
 ├─ meta.json                ← 格式头(必含,首个逻辑条目)
 ├─ doc.json                 ← 工程内核:模型 + 编辑信息(紧凑 JSON,单行)
 ├─ images/<sha1>.<ext>      ← 位图资产,按内容哈希命名(自动去重;png/jpg/webp/gif)
 └─ thumb.png                ← 可选:舞台缩略图(最近列表显示)
```

### 2.1 meta.json

```json
{
  "format": "skani",
  "version": 2,
  "app": "游戏资源管理器 2.4.18",
  "createdAt": 1788000000000,
  "modifiedAt": 1788000000000,
  "imageCount": 3,
  "docSha1": "<doc.json 内容哈希,完整性校验>"
}
```

### 2.2 doc.json

```json
{
  "format": "skani",            // 与 meta 一致,双重标识
  "version": 2,
  "project": { ... },           // 现有 project 模型原样(见 2.3 改造点)
  "source": {                   // 导入溯源(编辑信息分区)
    "kind": "spineproj|spine|skel|sk|fresh|lbone",
    "path": "E:/.../spineboy-pro.spine",
    "version": "3.8.55",
    "sha1": "<源文件指纹>",
    "openedAt": 1788000000000
  },
  "editor": {                   // 编辑器状态(视角,非内容)
    "axes": "parent", "compBones": false, "compImages": false,
    "skin": "default"
  }
}
```

### 2.3 模型改造点(图片去内嵌)

- `project.images[i]`:`dataUrl` 字段**不再写入 doc.json**,改写 `hash`(sha1)+ `ext`;加载时由容器 `images/<hash>.<ext>` 回填 `dataUrl`;
- `project.spine.pages[i]`(Spine 导入的图集页图):同样 `dataUrl → hash/ext` 引用;`spineRegion` 裁剪逻辑不变(渲染端按需 resolve,依赖 pages[].dataUrl 回填后即可用);
- 同内容图片(多插槽同图/页图重复)哈希同名,**天然去重**;
- 其余模型字段(bones/slots/displays/animations/spine.raw 等)**原样透传**——导入源 passthrough 原则:`spine.raw` 整块保留,保证导出 .json/.skel 无损合并。

## 3. 读写流程

### 3.1 保存(渲染进程主导,主进程打包落盘)

```
saveProject()
  ├─ _savePath 以 .skani 结尾 → skaniSave(_savePath, project)   [直写覆盖]
  ├─ 无 _savePath / 另存为 → 对话框(默认扩展名 .skani,可选 .lbone.json)
  │     ├─ 选 .skani    → skaniSave(path, project);_savePath = path
  │     └─ 选 .lbone.json → 现有明文路径(调试/明文偏好)
  └─ skaniSave:
      1. 深拷贝 project;剥离 images[].dataUrl / spine.pages[].dataUrl → 资产清单(sha1 由主进程算)
      2. doc = { format, version:2, project:剥离后模型, source, editor }
      3. IPC 'skani:write' { path, docJson, assets:[{hash,ext,dataUrl}], thumbDataUrl? }
      4. 主进程:组 zip(逐条 deflateRaw + central directory)→ 写 <path>.tmp → fs.renameSync 原子替换
      5. 成功 → _markSaved();失败 → toast 并回退另存对话框
```

### 3.2 打开(含最近记录/文件菜单/首页)

```
路径以 .skani 结尾:
  1. IPC 'skani:read' { path } → 主进程解 zip → { meta, docJson, assets:[{hash,ext,base64}] }
  2. doc.version 迁移链(v2 当前;未来 vN → migrate)
  3. project 模型回填 dataUrl(data:image/ext;base64,)
  4. _loadProject;_savePath = path(后续 Ctrl+S 直写)
路径以 .lbone.json/.json 结尾:现有明文读取路径不变(兼容)
```

### 3.3 损坏降级

- zip 解不开 / meta 缺失 / doc 缺失 → 明确报错「文件损坏或不是 .skani 工程」;
- 某图片条目损坏 → 该图置空 dataUrl(舞台缺图占位),**工程本身照常打开**,toast 提示缺哪张;
- doc.json 解析失败 → 尝试从 `<path>.skani.bak`(保存前自动备份上一版)恢复。

### 3.4 草稿(draft)迁移

- 现:`localStorage`(大工程序列化超限静默丢失)→ 改:主进程 `userData/draft/draft.skani` 原子写(同 skani:write,节流 900ms 不变);
- 首页「恢复上次编辑」读该文件;关闭项目/新建清除;localStorage 旧 key 读取兼容(读到旧草稿转存新位置后清除)。

## 4. 主进程 zip 极简实现(electron/skaniFile.js,无三方依赖)

- **写**:entries = [meta.json, doc.json, images/*, thumb.png];每条 `zlib.deflateRawSync`,组装 local file header(通用位 0x0800 UTF-8)+ 数据 + central directory + EOCD;CRC32 查表实现(~20 行);
- **读**:定位 EOCD(倒扫 22B..65KB)→ central directory → 各条目 local header 偏移 → `zlib.inflateRawSync`;
- sha1:`crypto.createHash('sha1')`;
- IPC:`skani:write` / `skani:read` / `skani:draftWrite` / `skani:draftRead` / `skani:draftClear`(preload 暴露 `window.api.skani*`);
- **原子性**:一律 `tmp + renameSync`;正式保存额外先把旧文件 `renameSync` 为 `.bak`。

## 5. 兼容与迁移

| 场景 | 处理 |
|---|---|
| 打开旧 `.lbone.json` | 现路径原样读;保存时仍可存回明文;「另存为」默认给 .skani |
| v2 → 未来 v3 | `migrate(doc)` 链式升级;未知字段透传不丢 |
| 导出 .skel/.json | **零改动**(buildSpineJsonFromModel 管线与存档格式无关;dataUrl 已回填,模型视图一致) |
| 最近记录 | kind 增 `skani`(徽标「工程」);文件名/时间显示逻辑不变 |

## 6. 验证计划

1. 冒烟新增(专项脚本):
   - 新建→加图→存 .skani→重开:骨骼/插槽/动画/图片字节级往返一致(hash 对比);
   - spine 导入项目(RT)存 .skani→重开→导出 Spine JSON 与直开导出一致;
   - 旧 .lbone.json 打开兼容;
   - 损坏降级:截断 zip → 明确报错;删一个图片条目 → 工程可开+缺图提示;
   - 草稿:写 draft.skani→新会话恢复;
   - 原子性:保存中断(模拟 tmp 残留)不影响原文件。
2. `npm run smoke` 全量回归零 err。
3. 人工:真实 spineboy-pro 打开→改→存 .skani→重开→回写运行时文件。

## 7. 实施顺序(P0)

1. `electron/skaniFile.js`:zip 读写 + sha1 + 原子写 + IPC;
2. `preload.js`:暴露 `skaniWrite/skaniRead/skaniDraft*`;
3. `boneEditorPage.js`:`_stripAssets/_hydrateAssets` + 保存/打开/另存为接入 + 对话框 filters + source/editor 分区记录;
4. 草稿迁移(userData/draft.skani + 旧 localStorage 兼容一次);
5. 冒烟扩展 + 全量回归 + CHANGELOG(补丁·184)。
