// ============ 系统设置页面 ============
// 当前包含「截图」相关设置:默认保存路径 / 默认格式(PNG·WebP) / WebP 质量。

import { state, setSetting, saveState, getMenuRoots, getMenuChildren, menuNodeById, menuNodePath, getMenuNodeDescendants, addMenuNode, updateMenuNode, removeMenuNode, moveMenuNodeBeside, moveMenuNodeToParent, PROJECTS_ROOT_ID, getToolboxChildren, getCategoryChildren, catVisibleInGroup, getSceneCategoryChildren, getWebBookmarkCategoryChildren, webBookmarksInCategory, typeGroup, addToolboxFolder, updateToolboxFolder, removeToolboxFolder, toolboxFolderById, addCategory, updateCategory, removeCategoryAdvanced, categoryById, getCategoryDescendants, categoryPath, addSceneCategory, updateSceneCategory, removeSceneCategory, sceneCategoryById, addWebBookmarkCategory, updateWebBookmarkCategory, removeWebBookmarkCategory, webBookmarkCategoryById, removeWebBookmark, addFavCategory, updateFavCategory, removeFavCategory, removeFavItem, favCategoryById, isUrlPath, nameFromPath, customPages, customPageById, addCustomPage, updateCustomPage, removeCustomPage, PAGE_TEMPLATES, customTypes, customTypeById, addCustomType, updateCustomType, removeCustomType, customTypeGroups, customTypeGroupById, addCustomTypeGroup, updateCustomTypeGroup, removeCustomTypeGroup, typeLabel, TYPE_EXTENSIONS, groupTagOptions, groupTagOptionSections, extOwners, CAT_TYPE_TAG_LABELS, isCategoryLocked, isMenuNodeLocked, resourceGroupIcon, resourceTypeIcon, setResourceGroupIcon, setResourceTypeIcon, builtinTypeName, builtinTypeExts, setBuiltinTypeOverride } from '../state.js';
import { applyAppearance } from '../appearance.js';
import { toast, openModal, footButtons, confirmDialog, promptDialog, showContextMenu, openEmojiPicker, iconNode, attachIconPreview, newPageDialog, finalizeIcon } from '../dialogs.js';
import { toolboxToolActions } from './toolboxPage.js';

function basename(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}
function pathJoin(dir, name) {
  if (!dir) return name;
  return /[\\/]$/.test(dir) ? dir + name : dir + '/' + name;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ================= 系统设置页卡片:默认定义 / 顺序 / 自定义标题与图标 =================
const SETTING_CARDS = [
  { id: 'shot', title: '动画截图' },
  { id: 'audio', title: '音频播放器' },
  { id: 'tabs', title: '资源标签页' },
  { id: 'webgame', title: '网络资源抓取' },
  { id: 'devtools', title: '开发者调试 (Chrome DevTools)' },
  { id: 'srcdbg', title: '开发者调试 · 组件源码定位' },
  { id: 'openwith', title: '外部打开方式' },
  { id: 'font', title: '系统字体字号' },
  { id: 'theme', title: '主题背景' },
  { id: 'menumgr', title: '菜单管理' },
  { id: 'pages', title: '页面管理' },
  { id: 'types', title: '资源类型管理' },
];
function settingCardMeta() {
  return (state.settings && state.settings.settingCardMeta) || {};
}
/** 生成卡片图标 HTML:图片(dataURL)用 <img>,否则文本 emoji */
function cardIconHtml(icon) {
  if (!icon) return '';
  if (icon.startsWith('data:image')) {
    const safe = icon.replace(/"/g, '&quot;');
    return `<span class="settings-card-icon"><img src="${safe}" alt="" /></span>`;
  }
  return `<span class="settings-card-icon">${esc(icon)}</span>`;
}
/** 生成卡片标题行 HTML(图标 + 标题 + 折叠箭头);支持用户自定义标题/图标 */
function cardHeadHtml(id, defTitle) {
  const m = settingCardMeta()[id];
  const title = (m && m.title) ? m.title : defTitle;
  const icon = (m && m.icon) ? m.icon : '';
  return cardIconHtml(icon) +
    `<span class="settings-card-title">${esc(title)}</span><span class="cat-arrow">▸</span>`;
}
function saveCardMeta(id, patch) {
  const meta = { ...settingCardMeta() };
  meta[id] = { ...(meta[id] || {}), ...patch };
  setSetting('settingCardMeta', meta);
}
function clearCardMeta(id) {
  const meta = { ...settingCardMeta() };
  if (!meta[id]) return false;
  delete meta[id];
  setSetting('settingCardMeta', meta);
  return true;
}

/** 外部程序路径输入自动填充:路径变化时,名称空→自动填程序名(去扩展名/网址取主机名);图标空→自动取文件图标 */
function attachExeAutoFill(exeInp, nameInp, iconInp) {
  let lastPath = '';
  let deb = null;
  const run = () => {
    const p = exeInp.value;
    if (p === lastPath) return;
    lastPath = p;
    const t = p.trim();
    if (!t) return;
    if (!nameInp.value.trim()) {
      const n = nameFromPath(t);
      if (n) nameInp.value = n;
    }
    if (!iconInp.value.trim() && !isUrlPath(t)) {
      window.api.fileIcon(t).then((r) => { if (r && r.ok && !iconInp.value.trim()) iconInp.value = r.dataUrl; });
    }
  };
  exeInp.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(run, 400);
  });
}

/** 目标页面下拉:内置动作 + 自定义页面 + 「＋ 新建页面…」(基于模板建立,标题/图标默认取节点名称/图标) */
/** 目标页面下拉:内置动作 + 自定义页面 + 「＋ 新建页面…」(基于模板建立,标题/图标默认取节点名称/图标);opts.allowEmpty=true 时首项为「(无)」且默认选中 */
function fillTargetSelect(actSel, currentAction, ctx, opts = {}) {
  actSel.innerHTML = '';
  if (opts.allowEmpty) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = opts.emptyLabel || '(无 - 仅展开/折叠)';
    actSel.appendChild(none);
  }
  for (const o of MENU_ACTION_OPTIONS) {
    const op = document.createElement('option');
    op.value = o.value;
    op.textContent = o.label;
    actSel.appendChild(op);
  }
  const cts = customTypes();
  if (cts.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '──────── 资源浏览(自定义类型) ────────';
    actSel.appendChild(sep);
    for (const ct of cts) {
      const op = document.createElement('option');
      op.value = 'res:type:' + ct.id;
      op.textContent = '资源浏览页 · ' + ct.name;
      actSel.appendChild(op);
    }
  }
  const cgs = customTypeGroups();
  if (cgs.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '──────── 资源浏览(自定义分组) ────────';
    actSel.appendChild(sep);
    for (const g of cgs) {
      const op = document.createElement('option');
      op.value = 'res:group:' + g.id;
      op.textContent = '资源浏览页 · ' + g.name;
      actSel.appendChild(op);
    }
  }
  const pages = customPages();
  if (pages.length) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '──────── 自定义页面 ────────';
    actSel.appendChild(sep);
    for (const p of pages) {
      const op = document.createElement('option');
      op.value = 'page:custom:' + p.id;
      op.textContent = p.title;
      actSel.appendChild(op);
    }
  }
  const np = document.createElement('option');
  np.value = '__new_page__';
  np.textContent = '＋ 新建页面…';
  actSel.appendChild(np);
  // 当前 action 不在可选项里(如内置页面尚未登记)时,补一个临时项,避免保存时被静默重置为第一项
  const hasCurrent = currentAction && [...actSel.options].some((o) => o.value === currentAction);
  if (currentAction && !hasCurrent) {
    const op = document.createElement('option');
    op.value = currentAction;
    op.textContent = currentAction;
    actSel.appendChild(op);
  }
  actSel.value = currentAction
    ? currentAction
    : (opts.allowEmpty ? '' : MENU_ACTION_OPTIONS[0].value);
  actSel.onchange = () => {
    if (actSel.value !== '__new_page__') return;
    newPageDialog({
      defaultTitle: (ctx && ctx.nameInp && ctx.nameInp.value.trim()) || '',
      defaultIcon: (ctx && ctx.iconInp && ctx.iconInp.value.trim()) || '',
    }, (pg) => {
      actSel.value = 'page:custom:' + pg.id;
      fillTargetSelect(actSel, 'page:custom:' + pg.id, ctx, opts);
    });
  };
}

/**
 * 渲染系统设置页面
 * @param {HTMLElement} container
 * @param {{onClose?:()=>void}} [opts]
 */
export function renderSettingsPage(container, opts = {}) {
  const s = state.settings;
  const fmt = s.screenshotFormat === 'webp' ? 'webp' : 'png';

  container.innerHTML = `
    <div class="settings-head">
      <button class="btn sm" id="settings-back">← 返回</button>
      <h2>系统设置</h2>
    </div>
    <div class="settings-body">
      <section class="settings-card collapsed" data-card="shot">
        <h3 class="settings-card-head">${cardHeadHtml('shot', '动画截图')}</h3>
        <div class="settings-card-body">
          <div class="form-row">
            <label class="f-label">默认保存路径</label>
            <div class="path-edit">
              <input id="ss-path" class="text-input" type="text" placeholder="未设置(将使用图片库目录/Spine截图)" value="${esc(s.screenshotPath || '')}" />
              <button class="btn sm" id="ss-pick">选择目录</button>
            </div>
          </div>
          <div class="form-row">
            <label class="f-label">默认格式</label>
            <div class="seg" id="ss-format">
              <button class="seg-btn ${fmt === 'png' ? 'active' : ''}" data-fmt="png">PNG</button>
              <button class="seg-btn ${fmt === 'webp' ? 'active' : ''}" data-fmt="webp">WebP</button>
            </div>
          </div>
          <div class="form-row" id="ss-quality-row" ${fmt === 'png' ? 'hidden' : ''}>
            <label class="f-label">WebP 质量</label>
            <input id="ss-quality" type="range" min="0.1" max="1" step="0.02" value="${s.screenshotQuality || 0.92}" />
            <span class="speed-val" id="ss-quality-val">${((s.screenshotQuality || 0.92) * 100).toFixed(0)}%</span>
          </div>
          <div class="form-row">
            <label class="f-label">加入图片资源</label>
            <label class="ss-check"><input type="checkbox" id="ss-addlib" ${s.screenshotAddToLibrary ? 'checked' : ''} /> 截图后自动加入「图片资源」的指定分类</label>
          </div>
          <div class="form-row">
            <label class="f-label">图片分类名</label>
            <input id="ss-cat" class="text-input" type="text" placeholder="spine截图" value="${esc(s.screenshotCategory || 'spine截图')}" />
          </div>
          <p class="settings-hint">截图将保存为透明背景图片,文件名格式:&lt;资源名&gt;_&lt;动作名&gt;_&lt;时间戳&gt;.&lt;扩展名&gt;。开启「加入图片资源」后,截图会作为图片条目归入上方指定分类(分类不存在将自动创建)。</p>
          <div class="settings-actions">
            <button class="btn sm" id="ss-open-dir">打开截图目录</button>
            <button class="btn primary" id="ss-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="audio">
        <h3 class="settings-card-head">${cardHeadHtml('audio', '音频播放器')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">播放列表 / 播放队列的条目中显示哪些信息(元信息来自音频文件内置 ID3 标签,仅支持含标签的格式;时长自动识别)。</p>
          <div class="form-row">
            <label class="f-label">条目显示字段</label>
            <div class="ss-field-chips" id="ap-fields">
              <label class="ss-check"><input type="checkbox" data-field="fileName" /> 文件名</label>
              <label class="ss-check"><input type="checkbox" data-field="title" /> 标题</label>
              <label class="ss-check"><input type="checkbox" data-field="artist" /> 艺术家</label>
              <label class="ss-check"><input type="checkbox" data-field="album" /> 专辑</label>
              <label class="ss-check"><input type="checkbox" data-field="duration" /> 时长</label>
            </div>
          </div>
          <div class="settings-actions">
            <button class="btn primary" id="ap-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="tabs">
        <h3 class="settings-card-head">${cardHeadHtml('tabs', '资源标签页')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">控制从资源列表打开动画 / 图片 / 音频 / 3D 文件时,主区标签页的行为。</p>
          <div class="form-row">
            <label class="f-label">同类型新标签</label>
            <label class="ss-check"><input type="checkbox" id="ss-newtab" ${s.openSameTypeNewTab !== false ? 'checked' : ''} /> 打开同一类型资源文件时,通过新开标签页打开</label>
          </div>
          <p class="settings-hint">开启:每个资源文件独立一个标签页(默认,可同时打开多个动画对照)。关闭:同一类型(如动画)的资源复用当前预览标签,打开新资源时替换内容,避免标签页堆积。</p>
          <div class="settings-actions">
            <button class="btn primary" id="ss-newtab-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="webgame">
        <h3 class="settings-card-head">${cardHeadHtml('webgame', '网络资源抓取')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">控制从「网络资源抓取」(网页浏览器)页面切到其它模块时的行为。</p>
          <div class="form-row">
            <label class="f-label">自动弹出悬浮窗</label>
            <label class="ss-check"><input type="checkbox" id="wg-autofloat" ${s.webgameAutoFloatOnSwitch ? 'checked' : ''} /> 切换到别的模块时,自动把网页弹出独立悬浮窗</label>
          </div>
          <p class="settings-hint">关闭(默认):切走后网页视图仅隐藏,不弹窗;回到抓取页网页依旧可见,浏览进度不中断。开启:切走后网页自动弹出可拖拽的独立悬浮窗(原行为)。</p>
          <div class="settings-actions">
            <button class="btn primary" id="wg-autofloat-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="devtools">
        <h3 class="settings-card-head">${cardHeadHtml('devtools', '开发者调试 (Chrome DevTools)')}</h3>
        <div class="settings-card-body">
          <div class="form-row">
            <label class="f-label">调试服务</label>
            <label class="ss-check"><input type="checkbox" id="cdp-enable" /> 启用 Chrome DevTools 调试端口 (CDP)</label>
          </div>
          <div class="form-row">
            <label class="f-label">调试端口</label>
            <input id="cdp-port" class="text-input" type="number" min="1024" max="65535" placeholder="9222" />
            <span class="cdp-status" id="cdp-status"></span>
          </div>
          <p class="settings-hint">启用后应用将自动重启,并开放本地调试端口,供 Chrome DevTools / AI 连接器(chrome-devtools)调试本应用的内置浏览器与页面。默认端口 9222,保存即重启生效。⚠️ 调试端口无访问认证,任何本机程序均可连接,仅限开发调试使用,勿在共享环境开启。</p>
          <div class="settings-actions">
            <button class="btn sm" id="cdp-dashboard">🔧 工具面板</button>
            <button class="btn sm" id="cdp-doc">📖 连接说明</button>
            <button class="btn primary" id="cdp-save">保存并重启</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="srcdbg">
        <h3 class="settings-card-head">${cardHeadHtml('srcdbg', '开发者调试 · 组件源码定位')}</h3>
        <div class="settings-card-body">
          <div class="form-row">
            <label class="f-label">默认代码编辑器</label>
            <input id="dbg-editor" class="text-input flex-1" type="text"
                   placeholder="C:\Program Files\Notepad++\notepad++.exe"
                   value="${esc(s.editorPath || '')}" />
            <button class="btn sm" id="dbg-editor-pick">选择程序</button>
          </div>
          <p class="settings-hint">调试模式中右键组件「源码位置」→「编辑文件」使用的编辑器。未设置时优先用 Notepad++（存在则打开并<b>定位到组件代码行号</b>）；找不到则弹窗选择并自动记住。VS Code(code.exe)会自动用 --goto 定位。</p>
          <div class="form-row">
            <label class="f-label">项目源码根目录</label>
            <input id="dbg-srcroot" class="text-input flex-1" type="text"
                   placeholder="默认:应用目录(app.getAppPath())"
                   value="${esc(s.sourceRoot || '')}" />
            <button class="btn sm" id="dbg-srcroot-pick">选择目录</button>
          </div>
          <p class="settings-hint">「源码位置」的相对路径(如 <code>src/ui.js</code>)基于该目录解析为绝对路径。打包版若源码不在应用目录，请填写源码目录(如 <code>E:\MyProject\spine_viewer</code>)。</p>
          <div class="settings-actions">
            <button class="btn primary" id="dbg-save">保存</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="openwith">
        <h3 class="settings-card-head">${cardHeadHtml('openwith', '外部打开方式')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">为「图片资源」右键菜单新增的「打开方式」配置外部程序：配置后右键任意图片 → 「打开方式」即可选择用图片编辑软件或浏览软件打开该图片文件。未配置时右键菜单会显示「到设置页配置」入口。</p>
          <div class="form-row">
            <label class="f-label">图片编辑软件</label>
            <input id="ow-edit-app" class="text-input flex-1" type="text"
                   placeholder="如 C:\Program Files\Adobe\Photoshop.exe"
                   value="${esc(s.imageEditApp || '')}" />
            <button class="btn sm" id="ow-edit-pick">选择程序</button>
          </div>
          <div class="form-row">
            <label class="f-label">图片浏览软件</label>
            <input id="ow-view-app" class="text-input flex-1" type="text"
                   placeholder="如 C:\Program Files\看图王\KingViewer.exe"
                   value="${esc(s.imageViewApp || '')}" />
            <button class="btn sm" id="ow-view-pick">选择程序</button>
          </div>
          <div class="settings-actions">
            <button class="btn primary" id="ow-save">保存</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="font">
        <h3 class="settings-card-head">${cardHeadHtml('font', '系统字体字号')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">调整整个应用界面的字体与控件大小(作用于主窗口 #app,缩放含字号与布局)。修改后实时预览,点「保存设置」固化,下次启动自动应用。</p>
          <div class="form-row">
            <label class="f-label">预设</label>
            <div class="seg" id="fs-presets">
              <button class="seg-btn" data-scale="0.9">小</button>
              <button class="seg-btn" data-scale="1">标准</button>
              <button class="seg-btn" data-scale="1.15">大</button>
              <button class="seg-btn" data-scale="1.3">特大</button>
            </div>
          </div>
          <div class="form-row">
            <label class="f-label">缩放比例</label>
            <input id="fs-scale" type="range" min="0.8" max="1.6" step="0.05" value="${s.fontScale || 1}" />
            <span class="speed-val" id="fs-scale-val">${Math.round((s.fontScale || 1) * 100)}%</span>
          </div>
          <div class="settings-actions">
            <button class="btn sm ghost" id="fs-reset">恢复默认(100%)</button>
            <span class="spacer"></span>
            <button class="btn primary" id="fs-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="theme">
        <h3 class="settings-card-head">${cardHeadHtml('theme', '主题背景')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">深色 / 浅色 / 自定义 / 跟随系统 四种主题各自独立保存「强调色 / 背景色 / 前景色 / 模块背景 / 菜单背景 / 按钮背景 / 悬停高亮 / 边框 / 背景图」,互不共享;「跟随系统」会按系统配色自动套用深色或浅色主题的设置。下方颜色控件始终编辑当前所选主题的配置,切换主题模式时自动载入该主题自己的设定。修改后实时预览,点「保存设置」固化,下次启动自动应用。</p>
          <div class="form-row">
            <label class="f-label">主题模式</label>
            <div class="seg" id="tb-theme">
              <button class="seg-btn" data-theme="dark">深色</button>
              <button class="seg-btn" data-theme="light">浅色</button>
              <button class="seg-btn" data-theme="custom">自定义</button>
              <button class="seg-btn" data-theme="system">跟随系统</button>
            </div>
          </div>
          <div class="form-row">
            <label class="f-label">强调色</label>
            <span class="path-edit">
              <input id="tb-accent" class="text-input" type="color" value="#4f8cff" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-accent-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">背景色</label>
            <span class="path-edit">
              <input id="tb-bgcolor" class="text-input" type="color" value="#1b1d23" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-bgcolor-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">前景色</label>
            <span class="path-edit">
              <input id="tb-fgcolor" class="text-input" type="color" value="#e6e8ee" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-fgcolor-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">模块背景色</label>
            <span class="path-edit">
              <input id="tb-panelbg" class="text-input" type="color" value="#22242b" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-panelbg-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">菜单背景色</label>
            <span class="path-edit">
              <input id="tb-menubg" class="text-input" type="color" value="#2a2d36" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-menubg-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">按钮背景色</label>
            <span class="path-edit">
              <input id="tb-btnbg" class="text-input" type="color" value="#2a2d36" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-btnbg-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">悬停高亮色</label>
            <span class="path-edit">
              <input id="tb-hoverbg" class="text-input" type="color" value="#333642" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-hoverbg-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">边框颜色</label>
            <span class="path-edit">
              <input id="tb-border" class="text-input" type="color" value="#343845" style="width:48px;padding:2px;" />
              <button class="btn sm ghost" id="tb-border-reset">恢复默认</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">背景图</label>
            <span class="path-edit">
              <input id="tb-bgimage" class="text-input flex-1" type="text" placeholder="未设置(点击选择图片)" value="" readonly />
              <button class="btn sm" id="tb-bgimage-pick">选择图片</button>
            </span>
          </div>
          <div class="form-row">
            <label class="f-label">启用背景图</label>
            <label class="ss-check"><input type="checkbox" id="tb-bgon" /> 在主窗口显示所选背景图(cover 铺满)</label>
          </div>
          <div class="settings-actions">
            <button class="btn sm ghost" id="tb-bgimage-clear">清除背景图</button>
            <span class="spacer"></span>
            <button class="btn primary" id="tb-save">保存设置</button>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="menumgr">
        <h3 class="settings-card-head">${cardHeadHtml('menumgr', '菜单管理')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">管理左侧菜单栏的全部目录节点与终端节点:改名、改图标、排序、移动到其它目录、编辑悬停提示/备注;终端节点可指定点击后打开的内置页面或调用外部程序。目录节点右键可 新建子目录 / 新建终端 / 编辑 / 移动 / 删除;点击目录前的箭头可展开或折叠其子节点(也可用上方「展开全部/折叠全部」)。拖拽可排序或移入其它目录。改动实时反映到左侧菜单栏。</p>
          <div class="mm-tabs">
            <button class="mm-tab active" data-mm-tab="menu">菜单目录</button>
            <button class="mm-tab" data-mm-tab="cat">分类目录</button>
          </div>
          <div id="mm-pane-menu">
            <div class="settings-actions">
              <button class="btn sm" id="mm-add-dir">＋ 新增顶级目录</button>
              <button class="btn sm" id="mm-add-term">＋ 新增顶级终端</button>
              <span class="spacer"></span>
              <button class="btn sm ghost" id="mm-expand-all">展开全部</button>
              <button class="btn sm ghost" id="mm-collapse-all">折叠全部</button>
            </div>
            <div class="menu-mgr-tree" id="mm-tree"></div>
          </div>
          <div id="mm-pane-cat" style="display:none">
            <p class="settings-hint">管理所有资源分类目录(含各资源类型下、以及跨资源类型显示的分类)。子分类会自动继承父分类的资源组,且继承的资源组不可修改,避免分类"消失"。<b>若某个分类找不到了,通常是因为它的资源组与父分类不一致,在此编辑它会自动补回父分类的资源组。</b>勾选了「视频/文档」组的分类会自动在左侧菜单创建「视频资源/文档资源」根目录进行挂载。</p>
            <div class="settings-actions">
              <button class="btn sm" id="cat-add-top">＋ 新增顶级分类</button>
              <span class="spacer"></span>
              <button class="btn sm ghost" id="cat-expand-all">展开全部</button>
              <button class="btn sm ghost" id="cat-collapse-all">折叠全部</button>
            </div>
            <div class="menu-mgr-tree" id="cat-tree"></div>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="pages">
        <h3 class="settings-card-head">${cardHeadHtml('pages', '页面管理')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint">自定义页面可作为终端节点的「目标页面」(终端节点编辑框的「目标页面」→「＋ 新建页面…」即基于模板建立,标题/图标默认取该节点的名称/图标)。基于模板建立后,标题、图标、内容可随时在此修改;点击终端节点时:内嵌网页模板在主显示区打开网页,文本笔记模板在主显示区显示可编辑笔记。</p>
          <div class="form-row">
            <label class="f-label">模板页</label>
            <div class="pg-templates" id="pg-templates"></div>
          </div>
          <div class="form-row">
            <label class="f-label">已有页面</label>
            <div class="pg-list" id="pg-list"></div>
          </div>
          <div class="settings-actions">
            <button class="btn sm" id="pg-add">＋ 新建页面</button>
          </div>
          <div class="settings-sep"><span>系统页面结构</span></div>
          <div class="form-row">
            <label class="f-label">系统页面</label>
            <div class="pg-list sys-pages" id="sys-pages"></div>
          </div>
        </div>
      </section>

      <section class="settings-card collapsed" data-card="types">
        <h3 class="settings-card-head">${cardHeadHtml('types', '资源类型管理')}</h3>
        <div class="settings-card-body">
          <p class="settings-hint"><b>自定义分组</b>(如 图标/数据/文件/视频资源)= 独立资源组:文件按扩展名归入,侧栏自动创建对应资源根。<b>自定义类型</b>(如「视频」)= 一种类型,必须归属某个内置分组(动画/图片/音频/3D),文件显示在该分组下(如「视频」归「图片」组 → .mp4 会出现在图片资源下)。<br>⚠ <b>优先级:自定义类型 &gt; 自定义分组 &gt; 内置类型</b>。若同一扩展名同时被「自定义类型」和「自定义分组」声明,文件只会归类型,分组收不到该文件——建议同一扩展名只配置其中一套。创建分组/类型后,可在目录节点「编辑节点」窗口的「设置类型组」中勾选。</p>
          <div class="form-row">
            <label class="f-label section-label">资源分组<span class="f-label-sub">(内置)</span></label>
            <div class="pg-templates" id="cg-builtin"></div>
          </div>
          <div class="form-row">
            <label class="f-label section-label">资源分组<span class="f-label-sub">(自定义)</span></label>
            <div class="pg-list" id="cg-list"></div>
          </div>
          <div class="settings-actions">
            <button class="btn sm" id="cg-add">＋ 新增分组</button>
          </div>
          <div class="settings-sep"><span>类型配置</span></div>
          <div class="form-row">
            <label class="f-label section-label">资源类型<span class="f-label-sub">(内置)</span></label>
            <div class="pg-templates" id="ct-builtin"></div>
          </div>
          <div class="form-row">
            <label class="f-label section-label">资源类型<span class="f-label-sub">(自定义)</span></label>
            <div class="pg-list" id="ct-list"></div>
          </div>
          <div class="settings-actions">
            <button class="btn sm" id="ct-add">＋ 新增资源类型</button>
          </div>
        </div>
      </section>
    </div>
  `;

  // 设置模块卡片:折叠 / 展开(默认折叠)
  container.querySelectorAll('.settings-card').forEach((card) => {
    const head = card.querySelector('.settings-card-head');
    const arrow = head.querySelector('.cat-arrow');
    const collapsed = card.classList.contains('collapsed');
    arrow.textContent = collapsed ? '▸' : '▾';
    head.addEventListener('click', () => {
      const nowCollapsed = card.classList.toggle('collapsed');
      arrow.textContent = nowCollapsed ? '▸' : '▾';
    });
  });

  // ---------- 卡片:按上次拖拽顺序重排 ----------
  const body = container.querySelector('.settings-body');
  const cardOrder = Array.isArray(state.settings.settingCardOrder) ? state.settings.settingCardOrder : [];
  if (cardOrder.length) {
    const secs = [...body.querySelectorAll('.settings-card')];
    const byId = new Map(secs.map((s) => [s.dataset.card, s]));
    const frag = document.createDocumentFragment();
    for (const id of cardOrder) { const el = byId.get(id); if (el) frag.appendChild(el); }
    for (const el of secs) if (!frag.contains(el)) frag.appendChild(el);
    body.appendChild(frag);
  }

  // ---------- 卡片:鼠标拖动排序(仅头部可拖) ----------
  let dragCard = null;
  const clearCardDrop = () => {
    dragCard = null;
    body.querySelectorAll('.settings-card.dragging, .settings-card.drop-before, .settings-card.drop-after')
      .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  };
  body.querySelectorAll('.settings-card').forEach((sec) => {
    const head = sec.querySelector('.settings-card-head');
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      dragCard = sec;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', sec.dataset.card); } catch (_) {}
      sec.classList.add('dragging');
    });
    head.addEventListener('dragend', clearCardDrop);
    sec.addEventListener('dragover', (e) => {
      if (!dragCard || dragCard === sec) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = sec.getBoundingClientRect();
      sec.classList.remove('drop-before', 'drop-after');
      sec.classList.toggle('drop-before', e.clientY - r.top < r.height / 2);
      sec.classList.toggle('drop-after', e.clientY - r.top >= r.height / 2);
    });
    sec.addEventListener('dragleave', () => sec.classList.remove('drop-before', 'drop-after'));
    sec.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      sec.classList.remove('drop-before', 'drop-after');
      if (!dragCard || dragCard === sec) { clearCardDrop(); return; }
      const r = sec.getBoundingClientRect();
      body.insertBefore(dragCard, e.clientY - r.top < r.height / 2 ? sec : sec.nextSibling);
      const ids = [...body.querySelectorAll('.settings-card')].map((s) => s.dataset.card);
      setSetting('settingCardOrder', ids);
      clearCardDrop();
      toast('卡片顺序已调整');
    });
  });

  // ---------- 卡片:右键编辑标题与图标 ----------
  const editCardDialog = (sec, id, defTitle) => {
    const m = settingCardMeta()[id] || {};
    const dlgBody = document.createElement('div');
    dlgBody.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const titleRow = makeRow('标题');
    const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.value = m.title || defTitle; titleRow.appendChild(titleInp);
    const iconRow = makeRow('图标(emoji 或导入图片)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = m.icon || ''; iconRow.appendChild(iconInp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button'; pickBtn.className = 'btn sm emoji-pick-btn'; pickBtn.textContent = '😀'; pickBtn.title = '选择图标';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
    iconRow.appendChild(pickBtn);
    attachIconPreview(iconInp, iconRow);
    dlgBody.appendChild(titleRow); dlgBody.appendChild(iconRow);
    const { close } = openModal({
      title: '编辑卡片标题与图标',
      body: dlgBody,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const title = titleInp.value.trim();
            if (!title) { toast('标题不能为空', 'error'); return; }
            const icon = iconInp.value.trim();
            saveCardMeta(id, { title, icon });
            const hd = sec.querySelector('.settings-card-head');
            const ar = hd.querySelector('.cat-arrow');
            hd.innerHTML = cardIconHtml(icon) + `<span class="settings-card-title">${esc(title)}</span>`;
            hd.appendChild(ar);
            close();
            toast('已保存');
          },
        },
      ]),
    });
  };
  body.querySelectorAll('.settings-card').forEach((sec) => {
    const id = sec.dataset.card;
    const def = (SETTING_CARDS.find((c) => c.id === id) || {}).title || '';
    const head = sec.querySelector('.settings-card-head');
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: '✎ 编辑标题与图标', onClick: () => editCardDialog(sec, id, def) },
        {
          label: '恢复默认标题', onClick: () => {
            if (!clearCardMeta(id)) { toast('已是默认标题', 'info', 1500); return; }
            const hd = sec.querySelector('.settings-card-head');
            const ar = hd.querySelector('.cat-arrow');
            hd.innerHTML = `<span class="settings-card-title">${esc(def)}</span>`;
            hd.appendChild(ar);
            toast('已恢复默认标题');
          },
        },
      ]);
    });
  });

  const pathInput = container.querySelector('#ss-path');
  const fmtSeg = container.querySelector('#ss-format');
  const qualityRow = container.querySelector('#ss-quality-row');
  const qualityRange = container.querySelector('#ss-quality');
  const qualityVal = container.querySelector('#ss-quality-val');

  // 选择目录
  container.querySelector('#ss-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickDirs();
      if (r && !r.canceled && r.filePaths && r.filePaths.length) {
        pathInput.value = r.filePaths[0];
      }
    } catch (err) {
      toast('选择目录失败: ' + err.message, 'error');
    }
  });

  // 格式切换:联动 WebP 质量行
  fmtSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      fmtSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      qualityRow.hidden = b.dataset.fmt !== 'webp';
    });
  });

  // 质量滑块
  qualityRange.addEventListener('input', () => {
    qualityVal.textContent = (parseFloat(qualityRange.value) * 100).toFixed(0) + '%';
  });

  // 打开截图目录
  container.querySelector('#ss-open-dir').addEventListener('click', () => {
    const p = pathInput.value.trim();
    if (!p) return toast('请先设置默认保存路径', 'error');
    window.api.showItem(p);
  });

  // 保存
  container.querySelector('#ss-save').addEventListener('click', () => {
    const fmtVal = fmtSeg.querySelector('.seg-btn.active').dataset.fmt;
    setSetting('screenshotPath', pathInput.value.trim());
    setSetting('screenshotFormat', fmtVal);
    setSetting('screenshotQuality', parseFloat(qualityRange.value));
    setSetting('screenshotAddToLibrary', container.querySelector('#ss-addlib').checked);
    setSetting('screenshotCategory', container.querySelector('#ss-cat').value.trim() || 'spine截图');
    saveState();
    toast('设置已保存');
  });

  // ---- 音频播放器:条目显示字段 ----
  const apFields = Object.assign(
    { fileName: true, title: true, artist: true, album: false, duration: true },
    s.audioListFields || {}
  );
  container.querySelectorAll('#ap-fields input[data-field]').forEach((inp) => {
    inp.checked = apFields[inp.dataset.field] !== false;
  });
  container.querySelector('#ap-save').addEventListener('click', () => {
    const val = {};
    container.querySelectorAll('#ap-fields input[data-field]').forEach((inp) => {
      val[inp.dataset.field] = inp.checked;
    });
    setSetting('audioListFields', val);
    saveState();
    // 通知播放器立即刷新队列显示
    document.dispatchEvent(new CustomEvent('audio:fieldsChanged'));
    toast('设置已保存');
  });

  // ---- 资源标签页:同类型新标签开关 ----
  container.querySelector('#ss-newtab-save').addEventListener('click', () => {
    setSetting('openSameTypeNewTab', container.querySelector('#ss-newtab').checked);
    saveState();
    toast('设置已保存');
  });

  // ---- 网络资源抓取:切模块时是否自动弹出悬浮窗 ----
  container.querySelector('#wg-autofloat-save').addEventListener('click', () => {
    setSetting('webgameAutoFloatOnSwitch', container.querySelector('#wg-autofloat').checked);
    saveState();
    toast('设置已保存');
  });

  // ---- 系统字体字号 ----
  const fsScale = container.querySelector('#fs-scale');
  const fsScaleVal = container.querySelector('#fs-scale-val');
  const fsPresets = container.querySelector('#fs-presets');
  const syncFsPresetActive = (scale) => {
    fsPresets.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', parseFloat(b.dataset.scale) === scale);
    });
  };
  const applyFsPreview = () => {
    const scale = parseFloat(fsScale.value);
    fsScaleVal.textContent = Math.round(scale * 100) + '%';
    syncFsPresetActive(scale);
    setSetting('fontScale', scale); // 仅内存预览,未落盘
    applyAppearance();
  };
  fsScale.addEventListener('input', applyFsPreview);
  fsPresets.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      fsScale.value = b.dataset.scale;
      applyFsPreview();
    });
  });
  container.querySelector('#fs-reset').addEventListener('click', () => {
    fsScale.value = '1';
    applyFsPreview();
  });
  container.querySelector('#fs-save').addEventListener('click', () => {
    setSetting('fontScale', parseFloat(fsScale.value));
    saveState();
    applyAppearance();
    toast('字体字号设置已保存');
  });

  // ---- 主题背景(深色 / 浅色 / 自定义 各主题独立配置) ----
  const tbTheme = container.querySelector('#tb-theme');
  const tbAccent = container.querySelector('#tb-accent');
  const tbBgColor = container.querySelector('#tb-bgcolor');
  const tbFgColor = container.querySelector('#tb-fgcolor');
  const tbBgImage = container.querySelector('#tb-bgimage');
  const tbBgOn = container.querySelector('#tb-bgon');
  const tbPanelBg = container.querySelector('#tb-panelbg');
  const tbMenuBg = container.querySelector('#tb-menubg');
  const tbBtnBg = container.querySelector('#tb-btnbg');
  const tbHoverBg = container.querySelector('#tb-hoverbg');
  const tbBorder = container.querySelector('#tb-border');

  const THEME_DEFAULTS = {
    dark:   { accent: '#4f8cff', bgColor: '#1b1d23', fgColor: '#e6e8ee', panelBg: '#22242b', menuBg: '#2a2d36', btnBg: '#2a2d36', hoverBg: '#333642', borderColor: '#343845' },
    light:  { accent: '#2f6fe0', bgColor: '#f3f4f7', fgColor: '#1f2329', panelBg: '#ffffff', menuBg: '#e8eaef', btnBg: '#e8eaef', hoverBg: '#dce0e7', borderColor: '#d2d6df' },
    custom: { accent: '#4f8cff', bgColor: '#1b1d23', fgColor: '#e6e8ee', panelBg: '#22242b', menuBg: '#2a2d36', btnBg: '#2a2d36', hoverBg: '#333642', borderColor: '#343845' },
  };
  // 当前编辑所针对的主题名(跟随系统 -> 解析为 dark/light)
  const editThemeName = () => {
    const sel = tbTheme.querySelector('.seg-btn.active')?.dataset.theme || 'dark';
    if (sel === 'system') {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    return sel;
  };
  const getThemeCfg = (name) => (state.settings.themes && state.settings.themes[name]) || {};
  // 把某主题的配置载入控件
  const loadThemeControls = () => {
    const name = editThemeName();
    const cfg = getThemeCfg(name);
    const def = THEME_DEFAULTS[name] || THEME_DEFAULTS.dark;
    tbAccent.value = cfg.accent || def.accent;
    tbBgColor.value = cfg.bgColor || def.bgColor;
    tbFgColor.value = cfg.fgColor || def.fgColor;
    tbPanelBg.value = cfg.panelBg || def.panelBg;
    tbMenuBg.value = cfg.menuBg || def.menuBg;
    tbBtnBg.value = cfg.btnBg || def.btnBg;
    tbHoverBg.value = cfg.hoverBg || def.hoverBg;
    tbBorder.value = cfg.borderColor || def.borderColor;
    tbBgImage.value = cfg.bgImage || '';
    tbBgOn.checked = !!cfg.bgImageOn;
  };
  // 写入当前编辑主题的配置 + 实时预览(立即落盘)
  const writeThemeField = (field, value) => {
    const name = editThemeName();
    if (!state.settings.themes) state.settings.themes = { dark: {}, light: {}, custom: {} };
    if (!state.settings.themes[name]) state.settings.themes[name] = {};
    state.settings.themes[name][field] = value;
    saveState();
    applyAppearance();
  };
  const syncTbThemeActive = () => {
    const cur = state.settings.theme || 'dark';
    tbTheme.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === cur);
    });
  };
  syncTbThemeActive();
  loadThemeControls();

  tbTheme.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      tbTheme.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      setSetting('theme', b.dataset.theme); // 仅记录选中,颜色各自独立存储
      loadThemeControls(); // 载入该主题自己的配置
      applyAppearance();
    });
  });
  tbAccent.addEventListener('input', () => writeThemeField('accent', tbAccent.value));
  tbBgColor.addEventListener('input', () => writeThemeField('bgColor', tbBgColor.value));
  tbFgColor.addEventListener('input', () => writeThemeField('fgColor', tbFgColor.value));
  tbPanelBg.addEventListener('input', () => writeThemeField('panelBg', tbPanelBg.value));
  tbMenuBg.addEventListener('input', () => writeThemeField('menuBg', tbMenuBg.value));
  tbBtnBg.addEventListener('input', () => writeThemeField('btnBg', tbBtnBg.value));
  tbHoverBg.addEventListener('input', () => writeThemeField('hoverBg', tbHoverBg.value));
  tbBorder.addEventListener('input', () => writeThemeField('borderColor', tbBorder.value));
  tbBgOn.addEventListener('change', () => writeThemeField('bgImageOn', tbBgOn.checked));
  container.querySelector('#tb-accent-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).accent;
    tbAccent.value = def;
    writeThemeField('accent', def);
  });
  container.querySelector('#tb-bgcolor-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).bgColor;
    tbBgColor.value = def;
    writeThemeField('bgColor', def);
  });
  container.querySelector('#tb-fgcolor-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).fgColor;
    tbFgColor.value = def;
    writeThemeField('fgColor', def);
  });
  container.querySelector('#tb-panelbg-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).panelBg;
    tbPanelBg.value = def;
    writeThemeField('panelBg', def);
  });
  container.querySelector('#tb-menubg-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).menuBg;
    tbMenuBg.value = def;
    writeThemeField('menuBg', def);
  });
  container.querySelector('#tb-btnbg-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).btnBg;
    tbBtnBg.value = def;
    writeThemeField('btnBg', def);
  });
  container.querySelector('#tb-hoverbg-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).hoverBg;
    tbHoverBg.value = def;
    writeThemeField('hoverBg', def);
  });
  container.querySelector('#tb-border-reset').addEventListener('click', () => {
    const def = (THEME_DEFAULTS[editThemeName()] || THEME_DEFAULTS.dark).borderColor;
    tbBorder.value = def;
    writeThemeField('borderColor', def);
  });
  container.querySelector('#tb-bgimage-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickFiles({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] });
      if (r && !r.canceled && r.filePaths && r.filePaths.length) {
        tbBgImage.value = r.filePaths[0];
        writeThemeField('bgImage', r.filePaths[0]);
      }
    } catch (err) {
      toast('选择图片失败: ' + err.message, 'error');
    }
  });
  container.querySelector('#tb-bgimage-clear').addEventListener('click', () => {
    tbBgImage.value = '';
    tbBgOn.checked = false;
    writeThemeField('bgImage', '');
    writeThemeField('bgImageOn', false);
  });
  container.querySelector('#tb-save').addEventListener('click', () => {
    // 字段此前已 writeThemeField 落盘,这里仅确保 theme 选中与外观生效
    setSetting('theme', tbTheme.querySelector('.seg-btn.active')?.dataset.theme || 'dark');
    saveState();
    applyAppearance();
    toast('主题背景设置已保存');
  });

  // ---- 开发者调试 (CDP) ----
  const cdpEnable = container.querySelector('#cdp-enable');
  const cdpPort = container.querySelector('#cdp-port');
  const cdpStatus = container.querySelector('#cdp-status');
  (async () => {
    try {
      const st = await window.api.cdpGetState();
      cdpEnable.checked = !!st.enabled;
      cdpPort.value = st.port || 9222;
      cdpPort.disabled = !st.enabled;
      cdpStatus.textContent = st.enabled
        ? (st.listening ? '● 已生效,可连接' : '○ 待重启生效')
        : '关闭';
      cdpStatus.className = 'cdp-status ' + (st.enabled ? (st.listening ? 'ok' : 'warn') : 'off');
    } catch (e) { /* 忽略 */ }
  })();
  cdpEnable.addEventListener('change', () => {
    cdpPort.disabled = !cdpEnable.checked;
    cdpStatus.textContent = cdpEnable.checked ? '○ 保存后重启生效' : '关闭';
    cdpStatus.className = 'cdp-status ' + (cdpEnable.checked ? 'warn' : 'off');
  });
  container.querySelector('#cdp-save').addEventListener('click', async () => {
    const enabled = cdpEnable.checked;
    const port = parseInt(cdpPort.value, 10);
    if (enabled && (!Number.isFinite(port) || port < 1024 || port > 65535)) {
      return toast('调试端口需在 1024-65535 之间', 'warn');
    }
    try {
      await window.api.cdpSetState({ enabled, port: enabled ? port : 9222 });
      toast('已保存,应用即将重启以应用调试服务…', 'warn');
      setTimeout(() => { /* 等 relaunch */ }, 500);
    } catch (err) {
      toast('切换失败: ' + err.message, 'error');
    }
  });
  // 「连接说明」:打开独立文档窗口
  container.querySelector('#cdp-doc').addEventListener('click', async () => {
    try {
      await window.api.cdpOpenDoc();
    } catch (err) {
      toast('打开说明失败: ' + err.message, 'error');
    }
  });
  // 「工具面板」:打开交互式 CDP 调试面板
  container.querySelector('#cdp-dashboard').addEventListener('click', async () => {
    try {
      await window.api.cdpOpenDashboard();
    } catch (err) {
      toast('打开工具面板失败: ' + err.message, 'error');
    }
  });

  // ---- 开发者调试 · 组件源码定位:默认编辑器 / 项目源码根目录 ----
  const dbgEditor = container.querySelector('#dbg-editor');
  const dbgSrcRoot = container.querySelector('#dbg-srcroot');
  container.querySelector('#dbg-editor-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickFiles({ title: '选择代码编辑器', filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd'] }] });
      if (r && !r.canceled && r.filePaths && r.filePaths.length) dbgEditor.value = r.filePaths[0];
    } catch (err) {
      toast('选择编辑器失败: ' + err.message, 'error');
    }
  });
  container.querySelector('#dbg-srcroot-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickDirs({ title: '选择项目源码根目录' });
      if (r && !r.canceled && r.filePaths && r.filePaths.length) dbgSrcRoot.value = r.filePaths[0];
    } catch (err) {
      toast('选择目录失败: ' + err.message, 'error');
    }
  });
  container.querySelector('#dbg-save').addEventListener('click', () => {
    setSetting('editorPath', dbgEditor.value.trim());
    setSetting('sourceRoot', dbgSrcRoot.value.trim());
    saveState();
    toast('设置已保存');
  });

  // ---- 外部打开方式:图片编辑/浏览软件(图片右键「打开方式」) ----
  const owEdit = container.querySelector('#ow-edit-app');
  const owView = container.querySelector('#ow-view-app');
  container.querySelector('#ow-edit-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickFiles({ title: '选择图片编辑软件', filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd'] }] });
      if (r && !r.canceled && r.filePaths && r.filePaths.length) owEdit.value = r.filePaths[0];
    } catch (err) {
      toast('选择程序失败: ' + err.message, 'error');
    }
  });
  container.querySelector('#ow-view-pick').addEventListener('click', async () => {
    try {
      const r = await window.api.pickFiles({ title: '选择图片浏览软件', filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd'] }] });
      if (r && !r.canceled && r.filePaths && r.filePaths.length) owView.value = r.filePaths[0];
    } catch (err) {
      toast('选择程序失败: ' + err.message, 'error');
    }
  });
  container.querySelector('#ow-save').addEventListener('click', () => {
    setSetting('imageEditApp', owEdit.value.trim());
    setSetting('imageViewApp', owView.value.trim());
    saveState();
    toast('设置已保存');
  });

  // ---- 菜单管理 ----
  bindMenuManagement(container);

  // ---- 页面管理:模板页说明 + 自定义页面增删改 ----
  // 系统页面结构目录(名称/功能/源码位置/内置入口;菜单节点引用动态计算)
  const SYS_PAGES_TREE = [
    {
      group: '资源浏览区',
      pages: [
        { name: '全局首页', desc: '全部资源组统计卡片 + 目录快捷入口 + 最近打开/最近添加(含缩略图)', file: 'src/pages/homePage.js', builtinEntries: ['顶栏 tabs「🏠首页」'], actions: [] },
        { name: '资源组主页(动画/图片/音频/3D/图标/视频/UI/数据/文档资源)', desc: '各资源组统计 + 分类目录树 + 最近添加', file: 'src/pages/homePage.js(renderTypeHome)', builtinEntries: ['侧栏资源根点击', '首页统计卡片'], actions: ['res:anim', 'res:image', 'res:audio', 'res:3d', 'res:article', 'res:video', 'res:group:*'] },
        { name: '分类目录页', desc: '目录条目列表(缩略图/管理模式/标签过滤/统计)', file: 'src/pages/folderPage.js', builtinEntries: ['侧栏分类点击', '首页目录快捷'], actions: [] },
        { name: '资源预览页', desc: 'Spine/龙骨/图片/音频/视频/FGUI/3D 资源预览', file: 'src/preview/*.js, src/viewers/*.js', builtinEntries: ['点击资源条目'], actions: [] },
        { name: '收藏夹主页', desc: '收藏统计 + 收藏分类 + 最近收藏', file: 'src/pages/folderPage.js(renderFavResources)', builtinEntries: ['侧栏「收藏夹」'], actions: ['page:fav'] },
      ],
    },
    {
      group: '工具区',
      pages: [
        { name: '项目管理中心', desc: '项目生命周期管理(主页汇总/详情/资源文档/服务启停)', file: 'src/pages/projectsPage.js + electron/projectRunner.js', builtinEntries: ['侧栏「项目管理中心」根'], actions: ['page:projects'] },
        { name: '资源工具箱', desc: '工具目录树(可管理的工具入口)', file: 'src/pages/toolboxPage.js', builtinEntries: ['侧栏「资源工具箱」根'], actions: ['page:toolbox'] },
        { name: '工具箱工具页(astc2png/skel2json/spinefix/sk2spine/spine 格式转换/图片集打包/图片编辑/FGUI 导出源/Todo-List/Markdown/得乐学苑)', desc: '各工具功能页(部分为独立 C++ EXE);菜单终端节点「目标页面」下拉由 toolboxToolActions() 动态生成,新增工具自动出现', file: 'src/pages/toolboxPage.js + electron/tools/*', builtinEntries: ['工具箱目录树节点'], actions: ['tool:astc2png', 'tool:skel2json', 'tool:spinefix', 'tool:sk2spine', 'tool:spineconvert', 'tool:atlas', 'tool:imageedit', 'tool:fgui', 'tool:todo', 'tool:markdown', 'tool:kidworkspace'] },
      ],
    },
    {
      group: '场景区',
      pages: [
        { name: '游戏场景管理', desc: '游戏场景/FGUI 包浏览', file: 'src/pages/scenePage.js + electron/tools/fgui/previewData.js', builtinEntries: ['侧栏「游戏场景管理」根'], actions: ['page:scene'] },
        { name: 'FGUI 编辑器', desc: 'FGUI 包编辑(资源面板/画布/控制器/导出源工程)', file: 'src/pages/fguiEditorPage.js', builtinEntries: ['工具箱「FGUI编辑器」', '场景 FGUI 包打开'], actions: [] },
      ],
    },
    {
      group: '网络与数据区',
      pages: [
        { name: '网络资源抓取', desc: '多标签网页浏览 + 资源归类下载入库', file: 'src/pages/webGamePage.js + electron/tools/webGame.js', builtinEntries: ['侧栏「网络资源抓取」根'], actions: ['page:webgame'] },
        { name: 'API 管理', desc: '接口文档/测试', file: 'src/pages/apiPage.js', builtinEntries: ['侧栏「API 管理」节点'], actions: ['page:api'] },
        { name: 'emoji 图标管理', desc: 'emoji 图标库浏览与导出', file: 'src/pages/emojiPage.js', builtinEntries: ['侧栏「emoji 图标管理」节点'], actions: ['page:emoji'] },
      ],
    },
    {
      group: '系统区',
      pages: [
        { name: '系统设置', desc: '资源类型管理/菜单和分类管理/页面管理/外观等', file: 'src/pages/settingsPage.js', builtinEntries: ['顶栏「⚙ 设置」', '侧栏「系统设置」节点'], actions: ['page:settings'] },
        { name: '自定义页面', desc: '网页模板/笔记模板,可作终端节点的「目标页面」', file: 'src/pages/settingsPage.js(customPages)', builtinEntries: ['终端节点「目标页面」→「＋ 新建页面…」'], actions: ['page:custom:*'] },
      ],
    },
  ];
  // 菜单节点中引用指定 action(支持前缀 * 通配)的路径列表
  const menuNodeRefs = (pattern) => {
    const refs = [];
    for (const m of state.menuNodes) {
      const a = m.action || '';
      const hit = pattern.endsWith('*') ? a.startsWith(pattern.slice(0, -1)) : a === pattern;
      if (hit) {
        const p = menuNodePath(m.id);
        if (p) refs.push(p);
      }
    }
    return refs;
  };
  const sysPagesEl = container.querySelector('#sys-pages');
  if (sysPagesEl) {
    for (const group of SYS_PAGES_TREE) {
      const gh = document.createElement('div');
      gh.className = 'sys-page-group';
      gh.textContent = '▸ ' + group.group;
      sysPagesEl.appendChild(gh);
      for (const p of group.pages) {
        const row = document.createElement('div');
        row.className = 'sys-page';
        const head = document.createElement('div');
        head.className = 'sys-page-head';
        const nmEl = document.createElement('span');
        nmEl.className = 'sys-page-name';
        nmEl.textContent = p.name;
        const fileEl = document.createElement('span');
        fileEl.className = 'sys-page-file';
        fileEl.textContent = p.file;
        fileEl.title = '源码位置';
        head.appendChild(nmEl);
        head.appendChild(fileEl);
        row.appendChild(head);
        const descEl = document.createElement('div');
        descEl.className = 'sys-page-desc';
        descEl.textContent = p.desc;
        row.appendChild(descEl);
        const entries = [...p.builtinEntries];
        for (const act of p.actions || []) entries.push(...menuNodeRefs(act));
        const unique = [...new Set(entries)];
        if (unique.length) {
          const en = document.createElement('div');
          en.className = 'sys-page-entries';
          en.textContent = '入口: ' + unique.join(' · ');
          row.appendChild(en);
        }
        sysPagesEl.appendChild(row);
      }
    }
  }
  const pgTemplatesEl = container.querySelector('#pg-templates');
  if (pgTemplatesEl) {
    for (const t of PAGE_TEMPLATES) {
      const row = document.createElement('div');
      row.className = 'pg-row';
      const nm = document.createElement('span');
      nm.className = 'pg-tpl-name';
      nm.textContent = t.name;
      const ds = document.createElement('span');
      ds.className = 'pg-tpl-desc';
      ds.textContent = t.desc;
      row.appendChild(nm);
      row.appendChild(ds);
      pgTemplatesEl.appendChild(row);
    }
  }
  const editPageDialog = (p, after) => {
    const dlgBody = document.createElement('div');
    dlgBody.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const titleRow = makeRow('页面标题');
    const titleInp = document.createElement('input'); titleInp.type = 'text'; titleInp.value = p.title; titleRow.appendChild(titleInp);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = p.icon || ''; iconRow.appendChild(iconInp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button'; pickBtn.className = 'btn sm emoji-pick-btn'; pickBtn.textContent = '😀'; pickBtn.title = '从图标库选择';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
    iconRow.appendChild(pickBtn);
    attachIconPreview(iconInp, iconRow);
    dlgBody.appendChild(titleRow); dlgBody.appendChild(iconRow);
    let paramRow = null, paramInp = null;
    if (p.templateId === 'web') {
      paramRow = makeRow('网址');
      paramInp = document.createElement('input'); paramInp.type = 'text'; paramInp.value = p.url || ''; paramInp.placeholder = '网页地址或本地 HTML 文件路径';
      paramRow.appendChild(paramInp);
    } else {
      paramRow = makeRow('内容');
      paramInp = document.createElement('textarea'); paramInp.value = p.content || ''; paramInp.placeholder = '笔记内容';
      paramRow.appendChild(paramInp);
    }
    dlgBody.appendChild(paramRow);
    const noteRow = makeRow('备注');
    const noteInp = document.createElement('input'); noteInp.type = 'text'; noteInp.value = p.note || ''; noteRow.appendChild(noteInp);
    dlgBody.appendChild(noteRow);
    const { close } = openModal({
      title: '编辑页面「' + p.title + '」',
      body: dlgBody,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '保存', cls: 'primary', onClick: () => {
            const title = titleInp.value.trim();
            if (!title) { toast('页面标题不能为空', 'error'); return; }
            const patch = { title, icon: iconInp.value.trim(), note: noteInp.value.trim() };
            if (p.templateId === 'web') patch.url = paramInp.value.trim();
            else patch.content = paramInp.value;
            updateCustomPage(p.id, patch);
            close();
            toast('已保存');
            if (after) after();
          },
        },
      ]),
    });
  };
  const renderPgList = () => {
    const el = container.querySelector('#pg-list');
    if (!el) return;
    el.innerHTML = '';
    const pages = customPages();
    if (!pages.length) {
      const d = document.createElement('div');
      d.className = 'hint';
      d.textContent = '暂无自定义页面。可在终端节点编辑框「目标页面」→「＋ 新建页面…」创建,或点下方按钮。';
      el.appendChild(d);
      return;
    }
    for (const p of pages) {
      const row = document.createElement('div');
      row.className = 'pg-row';
      row.appendChild(iconNode(p.icon || '📄'));
      const nm = document.createElement('span');
      nm.className = 'pg-name';
      nm.textContent = p.title;
      const tpl = document.createElement('span');
      tpl.className = 'pg-tpl';
      tpl.textContent = (PAGE_TEMPLATES.find((t) => t.id === p.templateId) || {}).name || p.templateId;
      const ops = document.createElement('span');
      ops.className = 'pg-ops';
      const eb = document.createElement('button');
      eb.type = 'button'; eb.className = 'btn sm ghost'; eb.textContent = '✎ 编辑';
      eb.addEventListener('click', () => editPageDialog(p, renderPgList));
      const db = document.createElement('button');
      db.type = 'button'; db.className = 'btn sm ghost danger'; db.textContent = '删除';
      db.addEventListener('click', () => {
        confirmDialog({
          title: '删除页面「' + p.title + '」?',
          message: '引用该页面的终端节点将提示「页面不存在」。',
          danger: true,
          onOk: () => { removeCustomPage(p.id); renderPgList(); toast('已删除'); },
        });
      });
      ops.appendChild(eb); ops.appendChild(db);
      row.appendChild(nm); row.appendChild(tpl); row.appendChild(ops);
      el.appendChild(row);
    }
  };
  renderPgList();
  const pgAdd = container.querySelector('#pg-add');
  if (pgAdd) pgAdd.addEventListener('click', () => newPageDialog({}, () => renderPgList()));

  // ---- 资源类型管理:内置类型只读 + 自定义类型增删改 ----
  const GROUP_LABELS = { anim: '动画资源', image: '图片资源', audio: '音频资源', '3d': '3D资源', article: '文档资源', icon: '图标资源', video: '视频资源', ui: 'UI资源', database: '数据资源' };
  /** 内置分组/类型图标编辑对话框(emoji 或 dataURL 图片,实时预览) */
  const editBuiltinIconDialog = (title, current, onSave) => {
    const dlgBody = document.createElement('div');
    dlgBody.className = 'modal-body';
    const row = document.createElement('div');
    row.className = 'form-row';
    row.innerHTML = '<label class="f-label">图标</label>';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = current || '';
    inp.placeholder = 'emoji 或粘贴图片(dataURL)';
    row.appendChild(inp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn sm emoji-pick-btn';
    pickBtn.textContent = '😀';
    pickBtn.title = '从图标库选择';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, inp); });
    row.appendChild(pickBtn);
    attachIconPreview(inp, row);
    dlgBody.appendChild(row);
    const { close } = openModal({
      title,
      body: dlgBody,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '保存', cls: 'primary', onClick: () => {
            onSave(inp.value.trim());
            close();
            toast('已保存');
          },
        },
      ]),
    });
  };
  // 资源分组(内置 anim/image/audio/3d):图标在名称前,右侧「✎ 编辑」改图标(与自定义分组排列一致)
  const cgBuiltinEl = container.querySelector('#cg-builtin');
  if (cgBuiltinEl) {
    for (const [v, l] of Object.entries(GROUP_LABELS)) {
      const row = document.createElement('div');
      row.className = 'pg-row';
      const icEl = iconNode(resourceGroupIcon(v) || '📁', 'cat-icon');
      const refreshIcon = () => {
        icEl.innerHTML = '';
        const ic = resourceGroupIcon(v) || '📁';
        if (ic.startsWith('data:image')) {
          const img = document.createElement('img'); img.src = ic; img.alt = '';
          icEl.appendChild(img);
        } else {
          icEl.textContent = ic;
        }
      };
      refreshIcon();
      const nm = document.createElement('span');
      nm.className = 'pg-name';
      nm.textContent = l;
      const ds = document.createElement('span');
      ds.className = 'pg-tpl-desc';
      ds.textContent = '内置分组 · 图标用于侧栏资源根';
      const ops = document.createElement('span');
      ops.className = 'pg-ops';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn sm ghost';
      editBtn.textContent = '✎ 编辑';
      editBtn.title = '修改「' + l + '」分组图标(用于侧栏资源根)';
      editBtn.addEventListener('click', () => {
        editBuiltinIconDialog('修改「' + l + '」分组图标(侧栏资源根)', resourceGroupIcon(v), (ic) => {
          setResourceGroupIcon(v, ic);
          refreshIcon();
          try { document.dispatchEvent(new CustomEvent('library:changed')); } catch (e) { /* ignore */ }
        });
      });
      ops.appendChild(editBtn);
      row.appendChild(icEl);
      row.appendChild(nm);
      row.appendChild(ds);
      row.appendChild(ops);
      cgBuiltinEl.appendChild(row);
    }
  }
  // 自定义分组增删改
  /** 扩展名重叠检测:输入 exts 与其它自定义类型/分组(排除 selfId)重叠时返回提示 DOM,否则 null */
  const extConflictHint = (extsText, selfId) => {
    const exts = String(extsText || '').split(/[,，;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const hits = [];
    for (const e of exts) {
      for (const o of extOwners(e)) {
        if (o.id === selfId) continue;
        hits.push(`${e} ← ${o.kind === 'type' ? '自定义类型' : '自定义分组'}「${o.name}」`);
      }
    }
    if (!hits.length) return null;
    const div = document.createElement('div');
    div.className = 'form-hint conflict';
    div.innerHTML = '⚠ 扩展名已被声明: ' + hits.map((h) => `<b>${esc(h)}</b>`).join('; ') + '。按优先级(自定义类型 &gt; 自定义分组)文件只会归前者,建议同一扩展名只保留一套。';
    return div;
  };
  /** 给扩展名输入行挂接重叠检测 */
  const attachExtConflictCheck = (extsInp, selfId) => {
    const box = document.createElement('div');
    extsInp.closest('.form-row').appendChild(box);
    const refresh = () => { box.innerHTML = ''; const h = extConflictHint(extsInp.value, selfId); if (h) box.appendChild(h); };
    extsInp.addEventListener('input', refresh);
    refresh();
  };
  const editCustomTypeGroupDialog = (g, after) => {
    const dlgBody = document.createElement('div');
    dlgBody.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow('分组名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = g ? g.name : ''; nameInp.placeholder = '如 图标 / 数据 / 文件';
    nameRow.appendChild(nameInp);
    const extsRow = makeRow('扩展名');
    const extsInp = document.createElement('input'); extsInp.type = 'text'; extsInp.value = g ? (g.exts || []).join(',') : ''; extsInp.placeholder = '逗号分隔,如 .db,.txt,.json,.xml';
    extsRow.appendChild(extsInp);
    attachExtConflictCheck(extsInp, g ? g.id : null);
    const iconRow = makeRow('图标(emoji 或导入图片)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = g ? (g.icon || '') : '';
    iconRow.appendChild(iconInp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button'; pickBtn.className = 'btn sm emoji-pick-btn'; pickBtn.textContent = '😀'; pickBtn.title = '从图标库选择';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
    iconRow.appendChild(pickBtn);
    attachIconPreview(iconInp, iconRow);
    dlgBody.appendChild(nameRow); dlgBody.appendChild(extsRow); dlgBody.appendChild(iconRow);
    const { close } = openModal({
      title: g ? '编辑资源分组「' + g.name + '」' : '新增资源分组',
      body: dlgBody,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast('分组名称不能为空', 'error'); return; }
            const exts = extsInp.value.split(/[,，;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
            if (!exts.length) { toast('请填写至少一个扩展名', 'error'); return; }
            if (g) updateCustomTypeGroup(g.id, { name, exts, icon: iconInp.value.trim() });
            else addCustomTypeGroup({ name, exts, icon: iconInp.value.trim() });
            close();
            toast('已保存');
            if (after) after();
          },
        },
      ]),
    });
  };
  const renderCgList = () => {
    const el = container.querySelector('#cg-list');
    if (!el) return;
    el.innerHTML = '';
    const groups = customTypeGroups();
    if (!groups.length) {
      const d = document.createElement('div');
      d.className = 'hint';
      d.textContent = '暂无自定义资源分组。例如「数据」(.db,.txt,.json,.xml)、「文件」(.md,.htm,.html,.txt)。';
      el.appendChild(d);
      return;
    }
    for (const g of groups) {
      const row = document.createElement('div');
      row.className = 'pg-row';
      const ic = iconNode(g.icon || '🗂', 'cat-icon');
      const nm = document.createElement('span');
      nm.className = 'pg-name';
      nm.textContent = g.name;
      const ex = document.createElement('span');
      ex.className = 'pg-tpl-desc';
      ex.textContent = (g.exts || []).join(' ');
      const ops = document.createElement('span');
      ops.className = 'pg-ops';
      const eb = document.createElement('button');
      eb.type = 'button'; eb.className = 'btn sm ghost'; eb.textContent = '✎ 编辑';
      eb.addEventListener('click', () => editCustomTypeGroupDialog(g, refreshAfterCgChange));
      const db = document.createElement('button');
      db.type = 'button'; db.className = 'btn sm ghost danger'; db.textContent = '删除';
      db.addEventListener('click', () => {
        confirmDialog({
          title: '删除资源分组「' + g.name + '」?',
          message: '已按该分组入库的条目将保留(类型名显示为 id);其扩展名恢复由内置类型接管。',
          danger: true,
          onOk: () => { removeCustomTypeGroup(g.id); refreshAfterCgChange(); toast('已删除'); },
        });
      });
      ops.appendChild(eb); ops.appendChild(db);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(ex); row.appendChild(ops);
      el.appendChild(row);
    }
  };
  renderCgList();
  // 分组增删改后:刷新分组列表 + 立即刷新侧栏(自定义分组 → 自动资源根立即可见)
  const refreshAfterCgChange = () => {
    renderCgList();
    document.dispatchEvent(new CustomEvent('library:changed'));
  };
  const cgAdd = container.querySelector('#cg-add');
  if (cgAdd) cgAdd.addEventListener('click', () => editCustomTypeGroupDialog(null, refreshAfterCgChange));

  const ctBuiltinEl = container.querySelector('#ct-builtin');
  if (ctBuiltinEl) {
    // 内置类型:名称/扩展名/图标均可配置(名称与扩展名用于识别与显示,图标用于条目徽标)
    const builtins = [
      'spine', 'dragonbones', 'image', 'audio', 'model', 'fgui',
      'markdown', 'text', 'config', 'database', 'web',
      'icon', 'video', 'project',
    ];
    // 编辑内置类型:名称 + 扩展名 + 图标(名称/扩展名存 builtinTypeOverrides,图标存 resourceTypeIcons)
    const editBuiltinTypeDialog = (id) => {
      const dlgBody = document.createElement('div');
      dlgBody.className = 'modal-body';
      const mkRow = (label) => {
        const r = document.createElement('div'); r.className = 'form-row';
        const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; r.appendChild(lb);
        return r;
      };
      const nameRow = mkRow('类型名称');
      const nameInp = document.createElement('input');
      nameInp.type = 'text';
      nameInp.value = builtinTypeName(id);
      nameRow.appendChild(nameInp);
      const extsRow = mkRow('扩展名');
      const extsInp = document.createElement('input');
      extsInp.type = 'text';
      extsInp.value = builtinTypeExts(id).join(' ');
      extsInp.placeholder = '以空格分隔,如 .md .markdown';
      extsRow.appendChild(extsInp);
      const iconRow = mkRow('图标');
      const iconInp = document.createElement('input');
      iconInp.type = 'text';
      iconInp.value = resourceTypeIcon(id) || '';
      iconInp.placeholder = 'emoji 或粘贴图片(dataURL)';
      iconRow.appendChild(iconInp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'btn sm emoji-pick-btn';
      pickBtn.textContent = '😀';
      pickBtn.title = '从图标库选择';
      pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
      iconRow.appendChild(pickBtn);
      attachIconPreview(iconInp, iconRow);
      dlgBody.appendChild(nameRow);
      dlgBody.appendChild(extsRow);
      dlgBody.appendChild(iconRow);
      const { close } = openModal({
        title: '编辑内置资源类型「' + builtinTypeName(id) + '」',
        body: dlgBody,
        foot: footButtons([
          { text: '取消', cls: '', onClick: () => close() },
          {
            text: '保存', cls: 'primary', onClick: () => {
              const name = nameInp.value.trim();
              const exts = String(extsInp.value || '').split(/[,，;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.startsWith('.'));
              if (!name) return toast('类型名称不能为空', 'error');
              setBuiltinTypeOverride(id, { name, exts });
              setResourceTypeIcon(id, iconInp.value.trim());
              close();
              toast('已保存');
              // 刷新内置类型区显示
              const list = container.querySelector('#ct-builtin');
              if (list) list.innerHTML = '';
              if (list) {
                const rows = builtins.map(buildBuiltinTypeRow);
                for (const r of rows) list.appendChild(r);
              }
              try { document.dispatchEvent(new CustomEvent('library:changed')); } catch (e) { /* ignore */ }
            },
          },
        ]),
      });
    };
    const buildBuiltinTypeRow = (id) => {
      const row = document.createElement('div');
      row.className = 'pg-row';
      const icEl = iconNode(resourceTypeIcon(id) || '🗂', 'cat-icon');
      const refreshIcon = () => {
        icEl.innerHTML = '';
        const ic = resourceTypeIcon(id) || '🗂';
        if (ic.startsWith('data:image')) {
          const img = document.createElement('img'); img.src = ic; img.alt = '';
          icEl.appendChild(img);
        } else {
          icEl.textContent = ic;
        }
      };
      refreshIcon();
      const nm = document.createElement('span');
      nm.className = 'pg-name';
      nm.textContent = builtinTypeName(id);
      const ds = document.createElement('span');
      ds.className = 'pg-tpl-desc';
      // 不同内置类型的描述:图标/视频 → 各自用途;其余 → 通用说明
      const descNote = (id === 'icon') ? '图标用于条目徽标'
        : (id === 'video') ? '用于视频卡片缩略图'
        : '扩展名用于识别该类型';
      ds.textContent = (builtinTypeExts(id).join(' ') || '(无扩展名)') + ' · ' + descNote;
      const ops = document.createElement('span');
      ops.className = 'pg-ops';
      const editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'btn sm ghost'; editBtn.textContent = '✎ 编辑';
      editBtn.title = '修改名称 / 扩展名 / 图标';
      editBtn.addEventListener('click', () => editBuiltinTypeDialog(id));
      ops.appendChild(editBtn);
      row.appendChild(icEl);
      row.appendChild(nm);
      row.appendChild(ds);
      row.appendChild(ops);
      return row;
    };
    for (const id of builtins) ctBuiltinEl.appendChild(buildBuiltinTypeRow(id));
  }
  const editCustomTypeDialog = (ct, after) => {
    const dlgBody = document.createElement('div');
    dlgBody.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow('类型名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = ct ? ct.name : ''; nameInp.placeholder = '如 图标资源';
    nameRow.appendChild(nameInp);
    const groupRow = makeRow('资源分组');
    const groupSel = document.createElement('select');
    for (const [v, l] of Object.entries(GROUP_LABELS)) {
      const op = document.createElement('option'); op.value = v; op.textContent = l; groupSel.appendChild(op);
    }
    for (const g of customTypeGroups()) {
      const op = document.createElement('option'); op.value = g.id; op.textContent = g.name; groupSel.appendChild(op);
    }
    groupSel.value = ct ? (ct.group || 'image') : 'image';
    groupRow.appendChild(groupSel);
    const extsRow = makeRow('扩展名');
    const extsInp = document.createElement('input'); extsInp.type = 'text'; extsInp.value = ct ? (ct.exts || []).join(',') : ''; extsInp.placeholder = '逗号分隔,如 .png,.ico';
    extsRow.appendChild(extsInp);
    attachExtConflictCheck(extsInp, ct ? ct.id : null);
    const iconRow = makeRow('图标(emoji 或导入图片)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = ct ? (ct.icon || '') : '';
    iconRow.appendChild(iconInp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button'; pickBtn.className = 'btn sm emoji-pick-btn'; pickBtn.textContent = '😀'; pickBtn.title = '从图标库选择';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
    iconRow.appendChild(pickBtn);
    attachIconPreview(iconInp, iconRow);
    dlgBody.appendChild(nameRow); dlgBody.appendChild(groupRow); dlgBody.appendChild(extsRow); dlgBody.appendChild(iconRow);
    const { close } = openModal({
      title: ct ? '编辑资源类型「' + ct.name + '」' : '新增资源类型',
      body: dlgBody,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast('类型名称不能为空', 'error'); return; }
            const exts = extsInp.value.split(/[,，;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
            if (!exts.length) { toast('请填写至少一个扩展名', 'error'); return; }
            if (ct) updateCustomType(ct.id, { name, group: groupSel.value, exts, icon: iconInp.value.trim() });
            else addCustomType({ name, group: groupSel.value, exts, icon: iconInp.value.trim() });
            close();
            toast('已保存');
            if (after) after();
          },
        },
      ]),
    });
  };
  const renderCtList = () => {
    const el = container.querySelector('#ct-list');
    if (!el) return;
    el.innerHTML = '';
    const cts = customTypes();
    if (!cts.length) {
      const d = document.createElement('div');
      d.className = 'hint';
      d.textContent = '暂无自定义资源类型。点「＋ 新增资源类型」创建,例如 图标资源(.png,.ico)。';
      el.appendChild(d);
      return;
    }
    for (const ct of cts) {
      const row = document.createElement('div');
      row.className = 'pg-row';
      const ic = iconNode(ct.icon || '🗂', 'cat-icon');
      const nm = document.createElement('span');
      nm.className = 'pg-name';
      nm.textContent = ct.name;
      const grp = document.createElement('span');
      grp.className = 'pg-tpl';
      const gName = GROUP_LABELS[ct.group] || (customTypeGroupById(ct.group) ? customTypeGroupById(ct.group).name : ct.group);
      grp.textContent = gName;
      const ex = document.createElement('span');
      ex.className = 'pg-tpl-desc';
      ex.textContent = (ct.exts || []).join(' ');
      const ops = document.createElement('span');
      ops.className = 'pg-ops';
      const eb = document.createElement('button');
      eb.type = 'button'; eb.className = 'btn sm ghost'; eb.textContent = '✎ 编辑';
      eb.addEventListener('click', () => editCustomTypeDialog(ct, renderCtList));
      const db = document.createElement('button');
      db.type = 'button'; db.className = 'btn sm ghost danger'; db.textContent = '删除';
      db.addEventListener('click', () => {
        confirmDialog({
          title: '删除资源类型「' + ct.name + '」?',
          message: '已按该类型入库的条目将保留(类型名显示为 id);其扩展名恢复由内置类型接管。',
          danger: true,
          onOk: () => { removeCustomType(ct.id); renderCtList(); toast('已删除'); },
        });
      });
      ops.appendChild(eb); ops.appendChild(db);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(grp); row.appendChild(ex); row.appendChild(ops);
      el.appendChild(row);
    }
  };
  renderCtList();
  const ctAdd = container.querySelector('#ct-add');
  if (ctAdd) ctAdd.addEventListener('click', () => editCustomTypeDialog(null, renderCtList));

  // 返回
  container.querySelector('#settings-back').addEventListener('click', () => {
    if (opts.onClose) opts.onClose();
  });
}

// ================= 菜单管理(设置页内嵌的侧栏菜单树编辑器) =================

const MENU_ACTION_OPTIONS = [
  { value: 'page:settings', label: '系统设置' },
  { value: 'page:api', label: 'API 管理' },
  { value: 'page:webgame', label: '网络资源抓取' },
  { value: 'page:scene', label: '游戏场景管理主页' },
  { value: 'page:toolbox', label: '资源工具箱主页' },
  { value: 'page:projects', label: '项目管理中心主页' },
  { value: 'page:fav', label: '收藏夹主页' },
  { value: 'page:emoji', label: 'emoji 图标管理' },
  { value: 'res:anim', label: '动画资源' },
  { value: 'res:image', label: '图片资源' },
  { value: 'res:audio', label: '音频资源' },
  { value: 'res:3d', label: '3D资源' },
  // 工具箱全部工具动态生成(新增工具自动出现在目标页面下拉)
  ...toolboxToolActions(),
];

function menuActionLabel(action) {
  const hit = MENU_ACTION_OPTIONS.find((o) => o.value === action);
  return hit ? hit.label : (action || '');
}

function actionSummary(node) {
  if (node.nodeType === 'dir') {
    const a = node.action || '';
    if (a.startsWith('res:')) return '资源类型目录';
    if (a === 'fav') return '收藏夹';
    if (a === 'scene') return '场景管理';
    if (a === 'webgame') return '网络抓取';
    if (a === 'toolbox') return '资源工具箱';
    if (a === 'projects') return '项目管理中心';
    if (a.startsWith('project:')) return '项目节点';
    if (a.startsWith('projectfolder:')) return '项目目录';
    if (a === 'devtools') return '开发工具箱';
    return '目录';
  }
  if (node.actionType === 'exe') return '外部程序: ' + (node.action || '');
  return menuActionLabel(node.action);
}

function bindMenuManagement(container) {
  const tree = container.querySelector('#mm-tree');
  let dragId = null;
  // 目录展开状态:默认展开所有含子节点的目录(初始与旧行为一致:全部可见)
  const mmExpanded = new Set(state.menuNodes.filter((n) => n.nodeType === 'dir' && getMenuChildren(n.id).length > 0).map((n) => n.id));

  const refresh = () => {
    renderMmTree();
    // 同步刷新左侧菜单栏
    document.dispatchEvent(new CustomEvent('library:changed'));
  };

  const nodeMenu = (x, y, node) => {
    const items = [];
    if (node.nodeType === 'dir') {
      items.push({ label: '新建子目录', onClick: () => newMmNodeDialog(node.id, 'dir') });
      items.push({ label: '新建终端', onClick: () => newMmNodeDialog(node.id, 'term') });
    }
    items.push({ label: node.nodeType === 'term' ? '编辑终端节点' : '编辑目录节点', onClick: () => editMmNodeDialog(node.id) });
    // 锁定节点:隐藏「移动...」「删除」项(锁定即防移动/删除)
    if (!isMenuNodeLocked(node.id)) {
      items.push({ label: '移动...', onClick: () => moveMmNodeDialog(node) });
      items.push({ label: '删除', danger: true, onClick: () => deleteMmNodeDialog(node.id) });
    }
    showContextMenu(x, y, items);
  };

  // 编辑资源工具箱目录/工具(名称 + 图标,带 emoji 选择面板)
  const mmEditToolboxDialog = (id) => {
    const n = toolboxFolderById(id);
    if (!n) return;
    const isTool = !!n.toolId;
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow(isTool ? '工具名称' : '目录名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = n.name; nameRow.appendChild(nameInp);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = n.icon || ''; iconRow.appendChild(iconInp);
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn sm emoji-pick-btn';
    pickBtn.textContent = '😀';
    pickBtn.title = '选择图标';
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(pickBtn, iconInp); });
    iconRow.appendChild(pickBtn);
    attachIconPreview(iconInp, iconRow);
    body.appendChild(nameRow); body.appendChild(iconRow);

    const { close } = openModal({
      title: isTool ? '编辑工具' : '编辑目录',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast(isTool ? '工具名称不能为空' : '目录名称不能为空', 'error'); return; }
            updateToolboxFolder(id, { name, icon: iconInp.value.trim() });
            close();
            refresh();
            toast(isTool ? '工具已更新' : '目录已更新');
          },
        },
      ]),
    });
  };

  // ---------- 动态内容节点(资源工具箱/分类/场景/网址收藏/收藏夹)右键管理 ----------
  // 镜像左侧栏同款右键功能:新建 / 重命名 / 删除(底层数据由 state.js 统一处理级联)
  const descMenu = (x, y, desc) => {
    const realId = (s) => s.slice(s.indexOf(':') + 1);
    const items = [];
    switch (desc.kind) {
      case 'tb-folder': {
        const id = realId(desc.id);
        items.push({ label: '新建子目录', onClick: () => promptDialog({ title: '新建目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); const f = addToolboxFolder({ name, parentId: id }); mmExpanded.add('tb:' + f.id); refresh(); toast('已创建子目录'); } }) });
        items.push({ label: '编辑目录', onClick: () => mmEditToolboxDialog(id) });
        items.push({ label: '删除目录', danger: true, onClick: () => { const cc = getToolboxChildren(id).length; confirmDialog({ title: '删除目录「' + desc.name + '」', message: `确定删除目录「<b>${esc(desc.name)}</b>」吗?` + (cc ? `<br/>其下 ${cc} 个子项将一并处理:子目录被删除,内置工具链接提升到上一级。` : ''), danger: true, onOk: () => { removeToolboxFolder(id); refresh(); toast('目录已删除'); } }); } });
        break;
      }
      case 'tb-tool': {
        const id = realId(desc.id);
        items.push({ label: '编辑工具', onClick: () => mmEditToolboxDialog(id) });
        items.push({ label: '说明', onClick: () => toast('内置工具链接,可在「资源工具箱」中移动排序', 'info', 3200) });
        break;
      }
      case 'cat': {
        const id = realId(desc.id);
        const group = desc.group;
        items.push({ label: '新建子目录', onClick: () => { const p = categoryById(id); const tt = (p && Array.isArray(p.typeTags) && p.typeTags.length) ? p.typeTags : (group ? [group] : []); promptDialog({ title: '新建目录', fields: [{ key: 'name', label: '子目录名称', type: 'text', value: '' }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); const c = addCategory({ name, parentId: id, typeTags: tt }); mmExpanded.add('cat:' + c.id); refresh(); toast('已创建子目录'); } }); } });
        items.push({ label: '编辑目录', onClick: () => { const c = categoryById(id); if (!c) return; promptDialog({ title: '编辑目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: c.name }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); updateCategory(id, { name }); refresh(); toast('目录已更新'); } }); } });
        items.push({ label: '删除目录', danger: true, onClick: () => { confirmDialog({ title: '删除目录「' + desc.name + '」', message: `确定删除目录「<b>${esc(desc.name)}</b>」吗?其下动画将移到「未分类」,子目录提升到上一级。`, danger: true, onOk: () => { removeCategoryAdvanced(id, { deleteItems: false, subAction: 'parent', subTargetId: '' }); refresh(); toast('目录已删除'); } }); } });
        break;
      }
      case 'sc': {
        const id = realId(desc.id);
        items.push({ label: '新建目录', onClick: () => promptDialog({ title: '新建目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); const c = addSceneCategory({ name, parentId: id }); mmExpanded.add('sc:' + c.id); refresh(); toast('已创建目录'); } }) });
        items.push({ label: '编辑目录', onClick: () => { const c = sceneCategoryById(id); if (!c) return; promptDialog({ title: '编辑目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: c.name }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); updateSceneCategory(id, { name }); refresh(); toast('目录已更新'); } }); } });
        items.push({ label: '删除目录', danger: true, onClick: () => { confirmDialog({ title: '删除目录「' + desc.name + '」', message: `确定删除目录「<b>${esc(desc.name)}</b>」吗?其下场景将移到「未分类」,子目录提升到上一级。`, danger: true, onOk: () => { removeSceneCategory(id); refresh(); toast('目录已删除'); } }); } });
        break;
      }
      case 'wb': {
        const id = realId(desc.id);
        items.push({ label: '新建子目录', onClick: () => promptDialog({ title: '新建收藏夹目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); const c = addWebBookmarkCategory({ name, parentId: id }); mmExpanded.add('wb:' + c.id); refresh(); toast('已创建收藏夹目录'); } }) });
        items.push({ label: '编辑目录', onClick: () => { const c = webBookmarkCategoryById(id); if (!c) return; promptDialog({ title: '编辑收藏夹目录', fields: [{ key: 'name', label: '目录名称', type: 'text', value: c.name }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('目录名称不能为空', 'error'); updateWebBookmarkCategory(id, { name }); refresh(); toast('目录已更新'); } }); } });
        items.push({ label: '删除目录', danger: true, onClick: () => { confirmDialog({ title: '删除收藏夹目录「' + desc.name + '」', message: `确定删除目录「<b>${esc(desc.name)}</b>」吗?其下网址移到上一级目录,子目录提升到上一级。`, danger: true, onOk: () => { removeWebBookmarkCategory(id); refresh(); toast('目录已删除'); } }); } });
        break;
      }
      case 'wb-url': {
        const id = realId(desc.id);
        items.push({ label: '删除网址', danger: true, onClick: () => { confirmDialog({ title: '删除网址', message: `确定删除「<b>${esc(desc.name)}</b>」?`, danger: true, onOk: () => { removeWebBookmark(id); refresh(); toast('已删除网址'); } }); } });
        break;
      }
      case 'favc': {
        const id = realId(desc.id);
        items.push({ label: '新建子分类', onClick: () => promptDialog({ title: '新建收藏夹分类', fields: [{ key: 'name', label: '分类名称', type: 'text', value: '' }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('分类名称不能为空', 'error'); const c = addFavCategory({ name }); mmExpanded.add('favc:' + c.id); refresh(); toast('已创建收藏夹分类'); } }) });
        items.push({ label: '编辑分类', onClick: () => { const c = favCategoryById(id); if (!c) return; promptDialog({ title: '编辑收藏夹分类', fields: [{ key: 'name', label: '分类名称', type: 'text', value: c.name }], onOk: ({ name }) => { name = (name || '').trim(); if (!name) return toast('分类名称不能为空', 'error'); updateFavCategory(id, { name }); refresh(); toast('分类已更新'); } }); } });
        items.push({ label: '删除分类', danger: true, onClick: () => { confirmDialog({ title: '删除收藏夹分类「' + desc.name + '」', message: `确定删除分类「<b>${esc(desc.name)}</b>」吗?其下收藏移到「未分类收藏」。`, danger: true, onOk: () => { removeFavCategory(id); refresh(); toast('分类已删除'); } }); } });
        break;
      }
      case 'fav': {
        const id = realId(desc.id);
        items.push({ label: '取消收藏', danger: true, onClick: () => { confirmDialog({ title: '取消收藏', message: `确定取消收藏「<b>${esc(desc.name)}</b>」?`, danger: true, onOk: () => { const f = state.favItems.find((x) => x.id === id); if (f) removeFavItem(f.itemId, f.favCategoryId); refresh(); toast('已取消收藏'); } }); } });
        break;
      }
      default:
        // 容器节点(最近打开/网址收藏夹/未分类等)无直接管理项
        return;
    }
    if (!items.length) return;
    showContextMenu(x, y, items);
  };

  const renderMmTree = () => {
    tree.innerHTML = '';
    const roots = getMenuRoots();
    const render = (parent, node, depth) => {
      const row = document.createElement('div');
      row.className = 'cat-node mm-node';
      row.style.paddingLeft = 10 + depth * 18 + 'px';
      row.dataset.id = node.id;
      row.draggable = true;

      const arrow = document.createElement('span');
      arrow.className = 'cat-arrow';
      arrow.textContent = node.nodeType === 'dir' ? (mmExpanded.has(node.id) ? '▼' : '▶') : '·';
      row.appendChild(arrow);
      // 箭头点击:展开/折叠(不触发编辑)。所有目录节点均可展开(即使暂无子节点,也可展开后新建)
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (node.nodeType === 'dir') {
          if (mmExpanded.has(node.id)) mmExpanded.delete(node.id);
          else mmExpanded.add(node.id);
          renderMmTree();
        }
      });

      row.appendChild(iconNode(node.icon || (node.nodeType === 'term' ? '•' : '📁'), 'cat-icon'));

      const nm = document.createElement('span');
      nm.className = 'cat-name';
      nm.textContent = node.name + (node.hidden ? ' 👁‍🗨' : '') + (node.locked ? ' 🔒' : '');
      if (node.hidden) nm.title = '该节点已隐藏:左侧菜单树不显示(可在此取消勾选)';
      row.appendChild(nm);

      const kind = document.createElement('span');
      kind.className = 'mm-badge ' + (node.nodeType === 'term' ? 'term' : 'dir');
      kind.textContent = node.nodeType === 'term' ? '终端' : '目录';
      row.appendChild(kind);

      const summary = document.createElement('span');
      summary.className = 'mm-summary';
      summary.textContent = actionSummary(node);
      row.appendChild(summary);

      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); nodeMenu(e.clientX, e.clientY, node); });
      row.addEventListener('click', () => { editMmNodeDialog(node.id); });

      // 拖拽排序/移动
      row.addEventListener('dragstart', (e) => {
        dragId = node.id;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', node.id); } catch (_) {}
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); clearMmMarkers(); });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === node.id) return;
        const src = menuNodeById(dragId);
        if (!src || (node.nodeType === 'dir' && getMenuNodeDescendants(dragId).includes(node.id))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        const canIn = node.nodeType === 'dir' && (src.parentId || '') !== node.id;
        const before = canIn ? y < h / 3 : y < h / 2;
        const after = canIn ? y > (h * 2) / 3 : !before;
        row.classList.remove('drop-before', 'drop-after', 'drop-in');
        row.classList.toggle('drop-before', before);
        row.classList.toggle('drop-after', after);
        row.classList.toggle('drop-in', !before && !after && canIn);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-in'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        row.classList.remove('drop-before', 'drop-after', 'drop-in');
        if (!dragId || dragId === node.id) { dragId = null; return; }
        const src = menuNodeById(dragId);
        if (!src || (node.nodeType === 'dir' && getMenuNodeDescendants(dragId).includes(node.id))) { dragId = null; return; }
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        const canIn = node.nodeType === 'dir' && (src.parentId || '') !== node.id;
        const before = canIn ? y < h / 3 : y < h / 2;
        const after = canIn ? y > (h * 2) / 3 : !before;
        if (!before && !after && canIn) moveMenuNodeToParent(dragId, node.id);
        else moveMenuNodeBeside(dragId, node.id, before ? 'before' : 'after');
        dragId = null;
        refresh();
        toast('已调整');
      });

      parent.appendChild(row);

      // 递归子节点(仅当目录已展开):菜单子节点 + 左侧栏同款动态子内容
      if (node.nodeType === 'dir' && mmExpanded.has(node.id)) {
        const menuKids = getMenuChildren(node.id);
        const dyn = mmDynamicChildren(node);
        if (menuKids.length === 0 && dyn.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'mm-empty';
          empty.style.paddingLeft = 10 + (depth + 1) * 18 + 'px';
          empty.textContent = '（暂无子节点，可右键「新建子目录」）';
          parent.appendChild(empty);
        } else {
          for (const c of menuKids) render(parent, c, depth + 1);
          for (const d of dyn) renderMmDesc(parent, d, depth + 1);
        }
      }
    };

    // ---------- 左侧栏同款动态子内容(资源工具箱/分类/场景/抓取/收藏夹等) ----------
    // 这些子节点来自各自模块的数据源(非 menu_nodes),在菜单管理中可右键管理(新建/重命名/删除),展开后与左侧栏一致。
    const tbDesc = (f) => {
      const kids = getToolboxChildren(f.id);
      return {
        id: 'tb:' + f.id, name: f.name, icon: f.icon || (f.toolId ? '🔧' : '📁'),
        badge: f.toolId ? '工具' : '目录',
        kind: f.toolId ? 'tb-tool' : 'tb-folder',
        leaf: kids.length === 0,
        kids: () => kids.map(tbDesc),
      };
    };
    const catDesc = (c, group) => ({
      id: 'cat:' + c.id, name: c.name, icon: '📂', badge: '分类',
      kind: 'cat', group,
      kids: () => getCategoryChildren(c.id).filter((x) => catVisibleInGroup(x, group)).map((x) => catDesc(x, group)),
    });
    const scDesc = (c) => ({
      id: 'sc:' + c.id, name: c.name, icon: '📂', badge: '场景',
      kind: 'sc',
      kids: () => getSceneCategoryChildren(c.id).map(scDesc),
    });
    const webCatDesc = (c) => ({
      id: 'wb:' + c.id, name: c.name, icon: '▣', badge: '网址目录',
      kind: 'wb',
      kids: () => [
        ...getWebBookmarkCategoryChildren(c.id).map(webCatDesc),
        ...webBookmarksInCategory(c.id).map((b) => ({ id: 'wbm:' + b.id, name: b.title || b.url, icon: '🔗', badge: '网址', kind: 'wb-url', leaf: true })),
      ],
    });
    const favCatDesc = (fc) => ({
      id: 'favc:' + fc.id, name: fc.name, icon: '🔖', badge: '收藏分类',
      kind: 'favc',
      kids: () => state.favItems.filter((f) => f.favCategoryId === fc.id)
        .map((f) => ({ id: 'fav:' + f.id, name: f.itemName || f.name || ('item:' + f.itemId), icon: '⭐', badge: '收藏', kind: 'fav', leaf: true })),
    });

    /** 计算某菜单节点展开后应显示的内置动态子内容(与左侧栏 renderMenuChildren 一致) */
    const mmDynamicChildren = (node) => {
      const a = node.action || '';
      const out = [];
      if (a === 'toolbox') {
        for (const f of getToolboxChildren('')) out.push(tbDesc(f));
      } else if (a === 'scene') {
        for (const c of getSceneCategoryChildren('')) out.push(scDesc(c));
      } else if (a.startsWith('res:')) {
        const group = a.slice(4);
        const uncat = state.items.filter((i) => typeGroup(i.type) === group && !i.categoryId);
        if (uncat.length) out.push({ id: 'uncat:' + group, name: '未分类', icon: '○', badge: '内容', kind: 'uncat', leaf: true });
        for (const c of getCategoryChildren('')) if (catVisibleInGroup(c, group)) out.push(catDesc(c, group));
      } else if (a === 'webgame') {
        const history = ((state.settings && state.settings.webGameHistory) || []).slice(0, 8);
        if (history.length) out.push({
          id: '__webgame_hist__', name: '最近打开', icon: '🕹', badge: '内容',
          kids: () => history.map((h) => ({ id: 'wh:' + (h.url || ''), name: h.title || h.url, icon: '🕹', badge: '记录', leaf: true })),
        });
        out.push({ id: '__webgame_fav__', name: '网址收藏夹', icon: '🔖', badge: '内容', kids: () => getWebBookmarkCategoryChildren('').map(webCatDesc) });
      } else if (a === 'fav') {
        for (const fc of state.favCategories) out.push(favCatDesc(fc));
      } else if (a === 'projects') {
        // 项目管理中心:项目节点(子目录在项目节点自身的子级渲染)
        const projDesc = (m) => {
          const pid = (m.action || '').slice('project:'.length);
          const proj = (state.projects || []).find((p) => p.id === pid);
          return {
            id: m.id, name: m.name, icon: m.icon || '📦',
            badge: proj ? '项目' : '项目(缺数据)',
            kind: 'menunode',
            kids: () => getMenuChildren(m.id).map((k) => ({ id: k.id, name: k.name, icon: k.icon || '📁', badge: '项目目录', kind: 'menunode', kids: () => [] })),
          };
        };
        for (const m of getMenuChildren(PROJECTS_ROOT_ID)) out.push(projDesc(m));
      }
      return out;
    };

    /** 渲染一个动态内容节点(只读,可展开) */
    const renderMmDesc = (parent, desc, depth) => {
      const hasKids = desc.leaf ? false : (desc.kids ? desc.kids().length > 0 : false);
      const isOpen = mmExpanded.has(desc.id);
      const row = document.createElement('div');
      row.className = 'cat-node mm-node mm-content';
      row.style.paddingLeft = 10 + depth * 18 + 'px';
      row.dataset.id = desc.id;

      const arrow = document.createElement('span');
      arrow.className = 'cat-arrow';
      arrow.textContent = hasKids ? (isOpen ? '▼' : '▶') : '·';
      row.appendChild(arrow);
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasKids) {
          if (mmExpanded.has(desc.id)) mmExpanded.delete(desc.id);
          else mmExpanded.add(desc.id);
          renderMmTree();
        }
      });

      row.appendChild(iconNode(desc.icon || '•', 'cat-icon'));

      const nm = document.createElement('span');
      nm.className = 'cat-name';
      nm.textContent = desc.name;
      row.appendChild(nm);

      const kind = document.createElement('span');
      kind.className = 'mm-badge content';
      kind.textContent = desc.badge || '内容';
      row.appendChild(kind);

      row.title = '右键可进行管理(新建/重命名/删除)';
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); descMenu(e.clientX, e.clientY, desc); });
      row.addEventListener('click', () => { /* 内容节点单击不编辑,右键管理 */ });

      parent.appendChild(row);

      if (hasKids && isOpen) {
        for (const c of desc.kids()) renderMmDesc(parent, c, depth + 1);
      }
    };

    for (const r of roots) render(tree, r, 0);
  };

  const clearMmMarkers = () => {
    tree.querySelectorAll('.dragging, .drop-before, .drop-after, .drop-in')
      .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-in'));
  };

  // 名称行 + 内联「资源」勾选框(与 ui.js buildNameResourceRow 逻辑一致,因为本文件未从 ui 导入)
  function buildNameResourceRow(nameValue, opts = {}) {
    const isResource = !!opts.isResource;
    const locked = !!opts.locked;
    const row = document.createElement('div');
    row.className = 'form-row';
    const lb = document.createElement('label');
    lb.className = 'f-label';
    lb.textContent = '名称';
    row.appendChild(lb);
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'name-input-short';
    nameInp.value = nameValue;
    row.appendChild(nameInp);
    const resWrap = document.createElement('label');
    resWrap.className = 'res-flag-wrap' + (locked ? ' locked' : '');
    const resCb = document.createElement('input');
    resCb.type = 'checkbox';
    resCb.checked = isResource;
    if (locked) resCb.disabled = true;
    resWrap.appendChild(resCb);
    const resTxt = document.createElement('span');
    resTxt.textContent = '资源';
    resWrap.appendChild(resTxt);
    row.appendChild(resWrap);
    return { row, nameInp, resCb };
  }

  /** 上溯祖先,取最近的 res:* 动作(父节点自身 action 可能为空但祖先为资源型) */
  const nearestResAction = (node) => {
    let cur = node;
    while (cur) {
      if (cur.action && String(cur.action).startsWith('res:')) return cur.action;
      cur = cur.parentId ? menuNodeById(cur.parentId) : null;
    }
    return '';
  };

  /** 资源类型下拉(仅目录节点):动画/图片/音频/3D + 自定义分组;存量 res:* 值不在选项内时追加临时选项保留 */
  const fillResTypeSelect = (sel, currentVal, opts = {}) => {
    sel.innerHTML = '';
    const locked = !!opts.locked;
    const builtins = [['res:anim', '动画资源'], ['res:image', '图片资源'], ['res:audio', '音频资源'], ['res:3d', '3D资源']];
    for (const [v, l] of builtins) {
      const op = document.createElement('option'); op.value = v; op.textContent = l; sel.appendChild(op);
    }
    const cgs = customTypeGroups();
    if (cgs.length) {
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '──────── 自定义分组 ────────';
      sel.appendChild(sep);
      for (const g of cgs) {
        const op = document.createElement('option');
        op.value = 'res:group:' + g.id;
        op.textContent = g.name;
        sel.appendChild(op);
      }
    }
    const cur = String(currentVal || '');
    if (cur.startsWith('res:') && ![...sel.options].some((o) => o.value === cur)) {
      const tmp = document.createElement('option');
      tmp.value = cur;
      tmp.textContent = cur;
      sel.appendChild(tmp);
    }
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
    else sel.value = builtins[1][0]; // 默认图片资源
    if (locked) sel.disabled = true;
  };

  /** 目录节点:勾选「资源」→ 显示「资源类型」行并隐藏「目标页面」行(action 由资源类型决定);取消 → 反向(保留 actSel 原值) */
  const buildResTypeRow = ({ resCb, actRow, actSel, isTerm }) => {
    const resTypeRow = document.createElement('div');
    resTypeRow.className = 'form-row';
    const lb = document.createElement('label');
    lb.className = 'f-label';
    lb.textContent = '资源类型';
    resTypeRow.appendChild(lb);
    const resTypeSel = document.createElement('select');
    resTypeRow.appendChild(resTypeSel);
    const tip = document.createElement('span');
    tip.className = 'form-hint';
    tip.style.margin = '0 0 0 8px';
    tip.textContent = '资源型目录：可创建分类目录、侧栏显示分类树';
    resTypeRow.appendChild(tip);
    resTypeRow.style.display = 'none';
    const syncRes = () => {
      if (isTerm) return;
      const isRes = resCb.checked;
      resTypeRow.style.display = isRes ? '' : 'none';
      if (actRow) actRow.style.display = isRes ? 'none' : '';
    };
    resCb.addEventListener('change', syncRes);
    return { resTypeRow, resTypeSel, syncRes };
  };

  const newMmNodeDialog = (parentId, nodeType) => {
    const isTerm = nodeType === 'term';
    const parentNodeMM = parentId ? menuNodeById(parentId) : null;
    const resLockedMM = !!(parentNodeMM && parentNodeMM.isResource);
    const resDefaultMM = resLockedMM;
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const { row: nameRow, nameInp, resCb } = buildNameResourceRow('', { isResource: resDefaultMM, locked: resLockedMM });
    body.appendChild(nameRow);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = ''; iconRow.appendChild(iconInp);
    const iconPickBtn = document.createElement('button');
    iconPickBtn.type = 'button';
    iconPickBtn.className = 'btn sm emoji-pick-btn';
    iconPickBtn.textContent = '😀';
    iconPickBtn.title = '选择图标';
    iconPickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(iconPickBtn, iconInp); });
    iconRow.appendChild(iconPickBtn);
    attachIconPreview(iconInp, iconRow);
    body.appendChild(iconRow);

    let typeSel = null, actSel = null, exeRow = null, exeInp = null, typeTagsRow = null, resTypeSel = null;
    // 目录:「设置类型组」默认继承父目录已勾选的组,且灰显不可改
    const inheritSetMM = new Set(parentNodeMM && Array.isArray(parentNodeMM.typeTags) ? parentNodeMM.typeTags : []);
    // 目标页面(目录可空,默认仅展开/折叠;终端必选)
    const actRow = makeRow('目标页面');
    actSel = document.createElement('select');
    fillTargetSelect(actSel, '', { nameInp, iconInp }, { allowEmpty: !isTerm, emptyLabel: '(无 - 仅展开/折叠)' });
    actRow.appendChild(actSel);
    if (isTerm) {
      const typeRow = makeRow('动作类型');
      typeSel = document.createElement('select');
      [['builtin', '内置页面/工具'], ['exe', '外部程序']].forEach(([v, l]) => {
        const op = document.createElement('option'); op.value = v; op.textContent = l; typeSel.appendChild(op);
      });
      typeSel.value = 'builtin';
      typeRow.appendChild(typeSel); body.appendChild(typeRow);
      body.appendChild(actRow); // 目标页面在动作类型之后,与选外部程序时「动作类型」位置一致

      exeRow = makeRow('程序路径');
      exeInp = document.createElement('input'); exeInp.type = 'text'; exeInp.value = '';
      exeInp.placeholder = '例如 C:\\Program Files\\App.exe 参数 或 https://example.com';
      exeRow.appendChild(exeInp); body.appendChild(exeRow);
      attachExeAutoFill(exeInp, nameInp, iconInp);

      const sync = () => {
        const isExe = typeSel.value === 'exe';
        actSel.closest('.form-row').style.display = isExe ? 'none' : '';
        exeRow.style.display = isExe ? '' : 'none';
      };
      typeSel.addEventListener('change', sync); sync();
    } else {
      body.appendChild(actRow);
      // 资源型目录:勾选「资源」→ 显示「资源类型」行并隐藏「目标页面」行(action 由资源类型决定)
      const resInit = resLockedMM ? (nearestResAction(parentNodeMM) || 'res:image') : 'res:image';
      const builtRes = buildResTypeRow({ resCb, actRow, actSel, isTerm: false });
      resTypeSel = builtRes.resTypeSel;
      fillResTypeSelect(resTypeSel, resInit, { locked: resLockedMM });
      body.appendChild(builtRes.resTypeRow);
      builtRes.syncRes();
      // 目录:「设置类型组」(继承父目录已勾选的组,灰显不可改)
      const tagsRowMM = makeRow('设置类型组');
      tagsRowMM.style.alignItems = 'flex-start';
      typeTagsRow = buildTypeTagCheckGroup(groupTagOptionSections(), { inheritSet: inheritSetMM });
      const hintMM = document.createElement('div');
      hintMM.className = 'form-hint';
      hintMM.textContent = '勾选该目录下允许显示的类型组(可多选)。点击该目录时,分类树中只显示「资源组命中了勾选类型组」或「未勾选任何资源组(全部)」的目录;不勾选 = 点击目录仅展开/折叠。';
      if (inheritSetMM.size) hintMM.textContent += '（带灰色的组继承自父目录,默认勾选且不可修改,可额外勾选其它组）';
      typeTagsRow.appendChild(hintMM);
      tagsRowMM.appendChild(typeTagsRow);
      body.appendChild(tagsRowMM);
    }

    // 锁定:禁止删除(右键删除项置灰)
    const lockRowMM = makeRow('锁定');
    const lockCbMM = document.createElement('input');
    lockCbMM.type = 'checkbox';
    lockCbMM.checked = false;
    const lockLbMM = document.createElement('span');
    lockLbMM.style.fontSize = '13px';
    lockLbMM.style.color = 'var(--text2)';
    lockLbMM.textContent = ' 锁定(禁止删除)';
    lockRowMM.appendChild(lockCbMM);
    lockRowMM.appendChild(lockLbMM);
    body.appendChild(lockRowMM);

    const { close } = openModal({
      title: isTerm ? '新建终端节点' : '新建目录节点',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '创建', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast('名称不能为空', 'error'); return; }
            let actionType = '', action = '';
            if (isTerm) {
              const isExe = typeSel.value === 'exe';
              actionType = isExe ? 'exe' : 'builtin';
              action = isExe ? exeInp.value.trim() : actSel.value;
              if (!action) { toast(isExe ? '程序路径不能为空' : '请选择目标页面', 'error'); return; }
            } else {
              actionType = 'builtin';
              // 资源型目录(勾选「资源」):action 由「资源类型」下拉决定;否则取目标页面(可为空)
              action = resCb.checked && resTypeSel ? resTypeSel.value : actSel.value;
            }
            addMenuNode({ name, icon: finalizeIcon(iconInp.value), parentId, nodeType, actionType, action, isResource: resCb.checked, locked: lockCbMM.checked, typeTags: typeTagsRow ? [...typeTagsRow.querySelectorAll('input:checked')].map((c) => c.value) : [] });
            close();
            if (parentId) mmExpanded.add(parentId); // 新建子节点后展开父目录,便于看到
            refresh();
            toast('已创建');
            // 新建顶级资源根 → 通知主界面引导用户在该根下建立第一个分类(资源管理流程:建根 → 建分类 → 加资源)
            if (!parentId && action && String(action).startsWith('res:')) {
              const grp = action === 'res:anim' ? 'anim'
                : action === 'res:image' ? 'image'
                : action === 'res:audio' ? 'audio'
                : action === 'res:3d' ? '3d'
                : action.startsWith('res:group:') ? action.slice('res:group:'.length)
                : '';
              if (grp) setTimeout(() => document.dispatchEvent(new CustomEvent('mm:request-new-top-cat', { detail: { grp } })), 50);
            }
          },
        },
      ]),
    });
  };

  const editMmNodeDialog = (id) => {
    const node = menuNodeById(id);
    if (!node) return;
    const isTerm = node.nodeType === 'term';
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const { row: nameRow, nameInp, resCb } = buildNameResourceRow(node.name, { isResource: node.isResource, locked: false });
    body.appendChild(nameRow);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = node.icon || ''; iconRow.appendChild(iconInp);
    const iconPickBtn = document.createElement('button');
    iconPickBtn.type = 'button';
    iconPickBtn.className = 'btn sm emoji-pick-btn';
    iconPickBtn.textContent = '😀';
    iconPickBtn.title = '选择图标';
    iconPickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(iconPickBtn, iconInp); });
    iconRow.appendChild(iconPickBtn);
    attachIconPreview(iconInp, iconRow);
    const tipRow = makeRow('悬停提示');
    const tipInp = document.createElement('input'); tipInp.type = 'text'; tipInp.value = node.tooltip || ''; tipRow.appendChild(tipInp);
    const noteRow = makeRow('备注');
    const noteInp = document.createElement('textarea'); noteInp.value = node.note || ''; noteRow.appendChild(noteInp);
    body.appendChild(iconRow); body.appendChild(tipRow); body.appendChild(noteRow);

    let typeSel = null, actSel = null, exeRow = null, exeInp = null, resTypeSel = null;
    // 目标页面(目录可空,默认仅展开/折叠;终端必选)
    const actRow = makeRow('目标页面');
    actSel = document.createElement('select');
    fillTargetSelect(actSel, node.action, { nameInp, iconInp }, { allowEmpty: !isTerm, emptyLabel: '(无 - 仅展开/折叠)' });
    actRow.appendChild(actSel);
    // 目录:「设置类型组」(继承父目录已勾选的组,灰显不可改;其余可勾选)
    let typeTagsList = null;
    if (!isTerm) {
      body.appendChild(actRow);
      // 资源型目录:勾选「资源」→ 显示「资源类型」行并隐藏「目标页面」行;存量 isResource=true 且 action 非 res:* → 默认图片(保存时自动补 res:image)
      const resInit = node.isResource ? (node.action && String(node.action).startsWith('res:') ? node.action : 'res:image') : 'res:image';
      const builtRes = buildResTypeRow({ resCb, actRow, actSel, isTerm: false });
      resTypeSel = builtRes.resTypeSel;
      fillResTypeSelect(resTypeSel, resInit, { locked: false });
      body.appendChild(builtRes.resTypeRow);
      builtRes.syncRes();
      const tagsRow = makeRow('设置类型组');
      tagsRow.style.alignItems = 'flex-start';
      typeTagsList = document.createElement('div');
      typeTagsList.className = 'check-group';
      const cur = new Set(Array.isArray(node.typeTags) ? node.typeTags : []);
      // 继承自父目录的类型组:默认勾选且灰显不可改
      const parentNodeEditMM = node.parentId ? menuNodeById(node.parentId) : null;
      const inheritSetMM = new Set(parentNodeEditMM && Array.isArray(parentNodeEditMM.typeTags) ? parentNodeEditMM.typeTags : []);
      typeTagsList.appendChild(buildTypeTagCheckGroup(groupTagOptionSections(), { curSet: cur, inheritSet: inheritSetMM }));
      const hint = document.createElement('div');
      hint.className = 'form-hint';
      hint.textContent = '勾选该目录下允许显示的类型组(可多选)。点击该目录时,分类树中只显示「资源组命中了勾选类型组」或「未勾选任何资源组(全部)」的目录;不勾选 = 点击目录仅展开/折叠。';
      if (inheritSetMM.size) hint.textContent += '（带灰色的组继承自父目录,默认勾选且不可修改,可额外勾选其它组）';
      typeTagsList.appendChild(hint);
      tagsRow.appendChild(typeTagsList);
      body.appendChild(tagsRow);
    }
    if (isTerm) {
      const typeRow = makeRow('动作类型');
      typeSel = document.createElement('select');
      [['builtin', '内置页面/工具'], ['exe', '外部程序']].forEach(([v, l]) => {
        const op = document.createElement('option'); op.value = v; op.textContent = l; typeSel.appendChild(op);
      });
      typeSel.value = node.actionType === 'exe' ? 'exe' : 'builtin';
      typeRow.appendChild(typeSel); body.appendChild(typeRow);
      body.appendChild(actRow); // 目标页面放在动作类型之后,与选外部程序时「动作类型」位置一致

      exeRow = makeRow('程序路径');
      exeInp = document.createElement('input'); exeInp.type = 'text'; exeInp.value = node.actionType === 'exe' ? (node.action || '') : '';
      exeInp.placeholder = '例如 C:\\Program Files\\App.exe 参数 或 https://example.com';
      exeRow.appendChild(exeInp); body.appendChild(exeRow);
      attachExeAutoFill(exeInp, nameInp, iconInp);

      const sync = () => {
        const isExe = typeSel.value === 'exe';
        actSel.closest('.form-row').style.display = isExe ? 'none' : '';
        exeRow.style.display = isExe ? '' : 'none';
      };
      typeSel.addEventListener('change', sync); sync();
    }

    // 锁定 + 隐藏:同一行(隐藏 = 左侧菜单树不显示该节点,此处仍可见可取消)
    const lockRowMM = makeRow('锁定');
    const lockCbMM = document.createElement('input');
    lockCbMM.type = 'checkbox';
    lockCbMM.checked = !!node.locked;
    const lockLbMM = document.createElement('span');
    lockLbMM.style.fontSize = '13px';
    lockLbMM.style.color = 'var(--text2)';
    lockLbMM.textContent = ' 锁定(禁止删除)';
    lockRowMM.appendChild(lockCbMM);
    lockRowMM.appendChild(lockLbMM);
    const hideCbMM = document.createElement('input');
    hideCbMM.type = 'checkbox';
    hideCbMM.checked = !!node.hidden;
    const hideLbMM = document.createElement('span');
    hideLbMM.style.fontSize = '13px';
    hideLbMM.style.color = 'var(--text2)';
    hideLbMM.style.marginLeft = '16px';
    hideLbMM.textContent = ' 隐藏(侧栏不显示)';
    lockRowMM.appendChild(hideCbMM);
    lockRowMM.appendChild(hideLbMM);
    body.appendChild(lockRowMM);

    const { close } = openModal({
      title: isTerm ? '编辑终端节点' : '编辑目录节点',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast('名称不能为空', 'error'); return; }
            const patch = { name, icon: finalizeIcon(iconInp.value), tooltip: tipInp.value.trim(), note: noteInp.value.trim(), isResource: resCb.checked, locked: lockCbMM.checked, hidden: hideCbMM.checked };
            if (isTerm) {
              const isExe = typeSel.value === 'exe';
              patch.actionType = isExe ? 'exe' : 'builtin';
              patch.action = isExe ? exeInp.value.trim() : actSel.value;
            } else {
              patch.actionType = 'builtin';
              // 资源型目录(勾选「资源」):action 由「资源类型」下拉决定(存量 isResource=true 且 action 非 res:* → 自动补默认图片)
              patch.action = resCb.checked && resTypeSel ? resTypeSel.value : actSel.value;
              patch.typeTags = typeTagsList ? [...typeTagsList.querySelectorAll('input:checked')].map((c) => c.value) : [];
            }
            updateMenuNode(id, patch);
            close();
            refresh();
            toast('已保存');
          },
        },
      ]),
    });
  };

  const moveMmNodeDialog = (node) => {
    const body = document.createElement('div');
    body.className = 'modal-body';
    const list = document.createElement('div');
    list.className = 'fav-pick-list';
    body.appendChild(list);
    const exclude = new Set([node.id, ...getMenuNodeDescendants(node.id)]);
    let checked = false;
    const pick = (value, label) => {
      const lb = document.createElement('label'); lb.className = 'fav-pick-item';
      const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'movemm'; rb.value = value;
      if (!checked) { rb.checked = true; checked = true; }
      const sp = document.createElement('span'); sp.textContent = label;
      lb.appendChild(rb); lb.appendChild(sp); list.appendChild(lb);
    };
    pick('', '移至顶级');
    for (const m of state.menuNodes) {
      if (m.nodeType !== 'dir' || exclude.has(m.id)) continue;
      pick(m.id, menuNodePath(m.id));
    }
    const { close } = openModal({
      title: '移动节点',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '确定', cls: 'primary', onClick: () => {
          const selected = list.querySelector('input:checked');
          if (!selected) return;
          updateMenuNode(node.id, { parentId: selected.value });
          close();
          refresh();
          toast('已移动');
        } },
      ]),
    });
  };

  const deleteMmNodeDialog = (id) => {
    const node = menuNodeById(id);
    if (!node) return;
    if (isMenuNodeLocked(id)) return toast('该节点已锁定,无法删除', 'error');
    const subs = getMenuNodeDescendants(id).length;
    confirmDialog({
      title: `删除「${node.name}」?`,
      message: subs ? `其下 ${subs} 个子节点将一并删除。` : '该节点将被删除。',
      onOk: () => {
        if (!removeMenuNode(id)) return toast('删除失败:该节点或其子节点已锁定', 'error');
        refresh();
        toast('已删除');
      },
    });
  };

  container.querySelector('#mm-add-dir').addEventListener('click', () => newMmNodeDialog('', 'dir'));
  container.querySelector('#mm-add-term').addEventListener('click', () => newMmNodeDialog('', 'term'));
  container.querySelector('#mm-expand-all').addEventListener('click', () => {
    state.menuNodes.forEach((n) => {
      if (n.nodeType !== 'dir') return;
      if (getMenuChildren(n.id).length > 0 || mmDynamicChildren(n).length > 0) mmExpanded.add(n.id);
    });
    renderMmTree();
  });
  container.querySelector('#mm-collapse-all').addEventListener('click', () => {
    mmExpanded.clear();
    renderMmTree();
  });

  // ================= 分类目录(独立标签页) =================
  const catTree = container.querySelector('#cat-tree');
  const catExpanded = new Set();

  /** 类型组勾选:按分区(内置标签 / 自定义分组)渲染复选框,分区标题 + 说明,避免「视频」标签与「视频资源」分组混淆 */
  const buildTypeTagCheckGroup = (sections, { curSet, inheritSet } = {}) => {
    const cur = new Set(Array.isArray(curSet) ? curSet : []);
    const inh = new Set(Array.isArray(inheritSet) ? inheritSet : []);
    const list = document.createElement('div');
    list.className = 'check-group';
    for (const sec of sections) {
      const sep = document.createElement('div');
      sep.className = 'tag-opt-sep';
      const t = document.createElement('span');
      t.className = 'tag-opt-sep-title';
      t.textContent = sec.title;
      sep.appendChild(t);
      if (sec.note) {
        const n = document.createElement('span');
        n.className = 'tag-opt-sep-note';
        n.textContent = ' ' + sec.note;
        sep.appendChild(n);
      }
      list.appendChild(sep);
      for (const o of sec.options) {
        const locked = inh.has(o.value);
        const isChecked = cur.has(o.value) || locked;
        const lb = document.createElement('label');
        lb.className = 'check-item' + (isChecked ? ' checked' : '') + (locked ? ' disabled' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.value;
        cb.checked = isChecked;
        if (locked) cb.disabled = true;
        cb.addEventListener('change', () => lb.classList.toggle('checked', cb.checked));
        lb.appendChild(cb);
        lb.appendChild(document.createTextNode(o.label));
        list.appendChild(lb);
      }
    }
    return list;
  };

  // 资源组勾选字段(带继承锁):继承项灰显不可改,且默认勾选
  const catTypeTagField = (value, inherited) => {
    const inheritSet = new Set(Array.isArray(inherited) ? inherited : []);
    const cur = new Set(Array.isArray(value) ? value : []);
    const list = buildTypeTagCheckGroup(groupTagOptionSections(), { curSet: cur, inheritSet });
    const hint = document.createElement('div');
    hint.className = 'form-hint';
    hint.textContent = '不勾选 = 在所有资源组中显示;勾选后仅在该资源组(可多选)的资源树中显示。';
    if (inheritSet.size) hint.textContent += '（带灰色的组继承自父分类,默认勾选且不可修改,可额外勾选其它组）';
    list.appendChild(hint);
    return list;
  };

  const renderCatTree = () => {
    catTree.innerHTML = '';
    const roots = getCategoryChildren('');
    if (!roots.length) {
      const empty = document.createElement('div');
      empty.className = 'mm-empty';
      empty.textContent = '（暂无分类目录,可点击「＋ 新增顶级分类」创建）';
      catTree.appendChild(empty);
      return;
    }
    const render = (parent, cat, depth) => {
      const kids = getCategoryChildren(cat.id);
      const hasKids = kids.length > 0;
      const isOpen = catExpanded.has(cat.id);
      const row = document.createElement('div');
      row.className = 'cat-node mm-node';
      row.style.paddingLeft = 10 + depth * 18 + 'px';
      row.dataset.id = cat.id;

      const arrow = document.createElement('span');
      arrow.className = 'cat-arrow';
      arrow.textContent = hasKids ? (isOpen ? '▼' : '▶') : '·';
      row.appendChild(arrow);
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!hasKids) return;
        if (catExpanded.has(cat.id)) catExpanded.delete(cat.id);
        else catExpanded.add(cat.id);
        renderCatTree();
      });

      row.appendChild(iconNode('📂', 'cat-icon'));
      const nm = document.createElement('span');
      nm.className = 'cat-name';
      nm.textContent = cat.name + (cat.locked ? ' 🔒' : '');
      row.appendChild(nm);

      // 资源组徽标(显示该分类归属的资源组)
      const tags = Array.isArray(cat.typeTags) ? cat.typeTags : [];
      if (tags.length) {
        const tg = document.createElement('span');
        tg.className = 'mm-badge group';
        tg.textContent = tags.map((t) => (CAT_TYPE_TAG_LABELS[t] || (customTypeGroupById(t) || {}).name || t)).join('/');
        tg.title = '资源组';
        row.appendChild(tg);
      } else {
        const tg = document.createElement('span');
        tg.className = 'mm-badge group all';
        tg.textContent = '全部';
        tg.title = '未限定资源组(所有类型显示)';
        row.appendChild(tg);
      }

      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); catNodeMenu(e.clientX, e.clientY, cat); });
      row.addEventListener('click', () => editCatDialog(cat.id));

      catTree.appendChild(row);
      if (hasKids && isOpen) for (const c of kids) render(catTree, c, depth + 1);
    };
    for (const r of roots) render(catTree, r, 0);
  };

  const catNodeMenu = (x, y, cat) => {
    const items = [
      { label: '新建子目录', onClick: () => newCatDialog(cat.id) },
      { label: '编辑分类目录', onClick: () => editCatDialog(cat.id) },
    ];
    // 锁定分类:隐藏「移动...」「删除」项(锁定即防移动/删除)
    if (!isCategoryLocked(cat.id)) {
      items.push({ label: '移动...', onClick: () => moveCatDialog(cat) });
      items.push({ label: '删除', danger: true, onClick: () => deleteCatDialog(cat.id) });
    }
    showContextMenu(x, y, items);
  };

  const catTagsFromList = (list) => [...list.querySelectorAll('input:checked')].map((c) => c.value);

  const newCatDialog = (parentId) => {
    const parent = parentId ? categoryById(parentId) : null;
    const inherited = parent && Array.isArray(parent.typeTags) ? parent.typeTags : [];
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow('目录名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = '';
    nameRow.appendChild(nameInp);
    body.appendChild(nameRow);
    const tagsRow = makeRow('资源组');
    tagsRow.style.alignItems = 'flex-start';
    const list = catTypeTagField([], inherited);
    tagsRow.appendChild(list);
    body.appendChild(tagsRow);
    // 锁定:禁止删除(右键删除项置灰)
    const lockRow = makeRow('锁定');
    const lockCb = document.createElement('input');
    lockCb.type = 'checkbox';
    lockCb.checked = false;
    const lockLb = document.createElement('span');
    lockLb.style.fontSize = '13px';
    lockLb.style.color = 'var(--text2)';
    lockLb.textContent = ' 锁定(禁止删除)';
    lockRow.appendChild(lockCb);
    lockRow.appendChild(lockLb);
    body.appendChild(lockRow);
    const { close } = openModal({
      title: '新建分类目录',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '创建', cls: 'primary', onClick: () => {
          const name = nameInp.value.trim();
          if (!name) { toast('目录名称不能为空', 'error'); return; }
          const merged = Array.from(new Set([...inherited, ...catTagsFromList(list)]));
          addCategory({ name, typeTags: merged, parentId: parentId || '', locked: lockCb.checked });
          if (parentId) catExpanded.add(parentId);
          close();
          renderCatTree();
          document.dispatchEvent(new CustomEvent('library:changed'));
          toast('已创建分类目录');
        } },
      ]),
    });
  };

  const editCatDialog = (id) => {
    const cat = categoryById(id);
    if (!cat) return;
    const parent = cat.parentId ? categoryById(cat.parentId) : null;
    const inherited = parent && Array.isArray(parent.typeTags) ? parent.typeTags : [];
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow('目录名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = cat.name;
    nameRow.appendChild(nameInp);
    body.appendChild(nameRow);
    const tagsRow = makeRow('资源组');
    tagsRow.style.alignItems = 'flex-start';
    const list = catTypeTagField(cat.typeTags, inherited);
    tagsRow.appendChild(list);
    body.appendChild(tagsRow);
    // 锁定:禁止删除(右键删除项置灰)
    const lockRow = makeRow('锁定');
    const lockCb = document.createElement('input');
    lockCb.type = 'checkbox';
    lockCb.checked = !!cat.locked;
    const lockLb = document.createElement('span');
    lockLb.style.fontSize = '13px';
    lockLb.style.color = 'var(--text2)';
    lockLb.textContent = ' 锁定(禁止删除)';
    lockRow.appendChild(lockCb);
    lockRow.appendChild(lockLb);
    body.appendChild(lockRow);
    const { close } = openModal({
      title: '编辑分类目录',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '确定', cls: 'primary', onClick: () => {
          const name = nameInp.value.trim();
          if (!name) { toast('目录名称不能为空', 'error'); return; }
          // 强制保留继承自父分类的资源组(安全兜底)
          const merged = Array.from(new Set([...inherited, ...catTagsFromList(list)]));
          updateCategory(id, { name, typeTags: merged, locked: lockCb.checked });
          close();
          renderCatTree();
          document.dispatchEvent(new CustomEvent('library:changed'));
          toast('已更新分类目录');
        } },
      ]),
    });
  };

  const deleteCatDialog = (id) => {
    const cat = categoryById(id);
    if (!cat) return;
    if (isCategoryLocked(id)) return toast('该分类已锁定,无法删除', 'error');
    const subs = getCategoryChildren(id);
    const subDesc = getCategoryDescendants(id);
    const nItems = state.items.filter((i) => i.categoryId === id || subDesc.includes(i.categoryId)).length;
    const hasSubs = subs.length > 0;
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = `<div class="hint" style="margin-bottom:10px">将删除分类目录「<b>${esc(cat.name)}</b>」(${nItems} 个资源${hasSubs ? `,${subs.length} 个子目录` : ''}),请选择处理方式:</div>`;
    const animRow = document.createElement('div'); animRow.className = 'form-row';
    const optDel = document.createElement('label'); optDel.className = 'fav-pick-item';
    const rbDel = document.createElement('input'); rbDel.type = 'radio'; rbDel.name = 'delcat-anim'; rbDel.value = 'delete'; rbDel.checked = true;
    optDel.appendChild(rbDel); optDel.appendChild(document.createTextNode('删除目录下的所有资源(仅从列表移除,不删磁盘文件)和子目录'));
    const optMove = document.createElement('label'); optMove.className = 'fav-pick-item';
    const rbMove = document.createElement('input'); rbMove.type = 'radio'; rbMove.name = 'delcat-anim'; rbMove.value = 'move';
    optMove.appendChild(rbMove); optMove.appendChild(document.createTextNode('将目录下的资源移动到「未分类」'));
    animRow.appendChild(optDel); animRow.appendChild(optMove); body.appendChild(animRow);
    const subBox = document.createElement('div');
    if (hasSubs) {
      const subTip = document.createElement('div'); subTip.className = 'hint'; subTip.style.margin = '8px 0 4px';
      subTip.textContent = '子目录处理:'; subBox.appendChild(subTip);
      const optUp = document.createElement('label'); optUp.className = 'fav-pick-item';
      const rbUp = document.createElement('input'); rbUp.type = 'radio'; rbUp.name = 'delcat-sub'; rbUp.value = 'parent'; rbUp.checked = true;
      optUp.appendChild(rbUp); optUp.appendChild(document.createTextNode(cat.parentId ? '提升为上一级目录的子目录' : '提升为顶级目录'));
      const optTo = document.createElement('label'); optTo.className = 'fav-pick-item';
      const rbTo = document.createElement('input'); rbTo.type = 'radio'; rbTo.name = 'delcat-sub'; rbTo.value = 'top';
      optTo.appendChild(rbTo); optTo.appendChild(document.createTextNode('提升为顶级目录'));
      subBox.appendChild(optUp); subBox.appendChild(optTo);
    }
    body.appendChild(subBox);
    const { close } = openModal({
      title: `删除分类「${cat.name}」?`,
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '删除', cls: 'danger', onClick: () => {
          const deleteItems = body.querySelector('input[name="delcat-anim"]:checked').value === 'delete';
          const subAction = hasSubs ? body.querySelector('input[name="delcat-sub"]:checked').value : 'parent';
          if (!removeCategoryAdvanced(id, { deleteItems, subAction })) {
            close();
            return toast('删除失败:该分类或其子分类已锁定', 'error');
          }
          close();
          renderCatTree();
          document.dispatchEvent(new CustomEvent('library:changed'));
          toast('已删除分类目录');
        } },
      ]),
    });
  };

  const moveCatDialog = (cat) => {
    const body = document.createElement('div');
    body.className = 'modal-body';
    const list = document.createElement('div');
    list.className = 'fav-pick-list';
    body.appendChild(list);
    const exclude = new Set([cat.id, ...getCategoryDescendants(cat.id)]);
    let checked = false;
    const pick = (value, label) => {
      const lb = document.createElement('label'); lb.className = 'fav-pick-item';
      const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'movecat'; rb.value = value;
      if (!checked) { rb.checked = true; checked = true; }
      const sp = document.createElement('span'); sp.textContent = label;
      lb.appendChild(rb); lb.appendChild(sp); list.appendChild(lb);
    };
    pick('', '移至顶级');
    for (const c of state.categories) {
      if (exclude.has(c.id)) continue;
      pick(c.id, categoryPath(c.id));
    }
    const { close } = openModal({
      title: '移动分类目录',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        { text: '确定', cls: 'primary', onClick: () => {
          const selected = list.querySelector('input:checked');
          if (!selected) return;
          updateCategory(cat.id, { parentId: selected.value });
          close();
          renderCatTree();
          document.dispatchEvent(new CustomEvent('library:changed'));
          toast('已移动分类目录');
        } },
      ]),
    });
  };

  // 标签页切换
  container.querySelectorAll('.mm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.mm-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const which = tab.dataset.mmTab;
      container.querySelector('#mm-pane-menu').style.display = which === 'menu' ? '' : 'none';
      container.querySelector('#mm-pane-cat').style.display = which === 'cat' ? '' : 'none';
      if (which === 'cat') renderCatTree();
    });
  });

  container.querySelector('#cat-add-top').addEventListener('click', () => newCatDialog(''));
  container.querySelector('#cat-expand-all').addEventListener('click', () => {
    state.categories.forEach((c) => { if (getCategoryChildren(c.id).length > 0) catExpanded.add(c.id); });
    renderCatTree();
  });
  container.querySelector('#cat-collapse-all').addEventListener('click', () => {
    catExpanded.clear();
    renderCatTree();
  });

  renderMmTree();
}

