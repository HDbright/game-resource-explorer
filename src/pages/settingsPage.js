// ============ 系统设置页面 ============
// 当前包含「截图」相关设置:默认保存路径 / 默认格式(PNG·WebP) / WebP 质量。

import { state, setSetting, saveState, getMenuRoots, getMenuChildren, menuNodeById, menuNodePath, getMenuNodeDescendants, addMenuNode, updateMenuNode, removeMenuNode, moveMenuNodeBeside, moveMenuNodeToParent, getToolboxChildren, getCategoryChildren, catVisibleInGroup, getSceneCategoryChildren, getWebBookmarkCategoryChildren, webBookmarksInCategory, typeGroup, addToolboxFolder, updateToolboxFolder, removeToolboxFolder, toolboxFolderById, addCategory, updateCategory, removeCategoryAdvanced, categoryById, addSceneCategory, updateSceneCategory, removeSceneCategory, sceneCategoryById, addWebBookmarkCategory, updateWebBookmarkCategory, removeWebBookmarkCategory, webBookmarkCategoryById, removeWebBookmark, addFavCategory, updateFavCategory, removeFavCategory, removeFavItem, favCategoryById } from '../state.js';
import { applyAppearance } from '../appearance.js';
import { toast, openModal, footButtons, confirmDialog, promptDialog, showContextMenu, openEmojiPicker } from '../dialogs.js';

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
      <section class="settings-card collapsed">
        <h3 class="settings-card-head">动画截图<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">音频播放器<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">资源标签页<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">网络资源抓取<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">开发者调试 (Chrome DevTools)<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">开发者调试 · 组件源码定位<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">系统字体字号<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">主题背景<span class="cat-arrow">▸</span></h3>
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

      <section class="settings-card collapsed">
        <h3 class="settings-card-head">菜单管理<span class="cat-arrow">▸</span></h3>
        <div class="settings-card-body">
          <p class="settings-hint">管理左侧菜单栏的全部目录节点与终端节点:改名、改图标、排序、移动到其它目录、编辑悬停提示/备注;终端节点可指定点击后打开的内置页面或调用外部程序。目录节点右键可 新建子目录 / 新建终端 / 编辑 / 移动 / 删除;点击目录前的箭头可展开或折叠其子节点(也可用上方「展开全部/折叠全部」)。拖拽可排序或移入其它目录。改动实时反映到左侧菜单栏。</p>
          <div class="settings-actions">
            <button class="btn sm" id="mm-add-dir">＋ 新增顶级目录</button>
            <button class="btn sm" id="mm-add-term">＋ 新增顶级终端</button>
            <span class="spacer"></span>
            <button class="btn sm ghost" id="mm-expand-all">展开全部</button>
            <button class="btn sm ghost" id="mm-collapse-all">折叠全部</button>
          </div>
          <div class="menu-mgr-tree" id="mm-tree"></div>
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

  // ---- 菜单管理 ----
  bindMenuManagement(container);

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
  { value: 'page:fav', label: '收藏夹主页' },
  { value: 'res:anim', label: '动画资源' },
  { value: 'res:image', label: '图片资源' },
  { value: 'res:audio', label: '音频资源' },
  { value: 'res:3d', label: '3D资源' },
  { value: 'tool:astc2png', label: 'astc 转 png' },
  { value: 'tool:skel2json', label: 'skel 转 json' },
  { value: 'tool:spinefix', label: 'spine 文件修复' },
  { value: 'tool:sk2spine', label: 'Laya .sk 转 Spine' },
  { value: 'tool:spineconvert', label: 'spine 格式转换' },
  { value: 'tool:atlas', label: '图片集打包' },
  { value: 'tool:imageedit', label: '图片编辑' },
  { value: 'tool:fgui', label: 'FGUI 导出源' },
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
    items.push({ label: node.nodeType === 'term' ? '编辑终端' : '编辑节点', onClick: () => editMmNodeDialog(node.id) });
    items.push({ label: '移动...', onClick: () => moveMmNodeDialog(node) });
    items.push({ label: '删除', danger: true, onClick: () => deleteMmNodeDialog(node.id) });
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

      const ic = document.createElement('span');
      ic.className = 'cat-icon';
      ic.textContent = node.icon || (node.nodeType === 'term' ? '•' : '📁');
      row.appendChild(ic);

      const nm = document.createElement('span');
      nm.className = 'cat-name';
      nm.textContent = node.name;
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

      const ic = document.createElement('span');
      ic.className = 'cat-icon';
      ic.textContent = desc.icon || '•';
      row.appendChild(ic);

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

  const newMmNodeDialog = (parentId, nodeType) => {
    const isTerm = nodeType === 'term';
    const body = document.createElement('div');
    body.className = 'modal-body';
    const makeRow = (label) => {
      const row = document.createElement('div'); row.className = 'form-row';
      const lb = document.createElement('label'); lb.className = 'f-label'; lb.textContent = label; row.appendChild(lb);
      return row;
    };
    const nameRow = makeRow('名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = ''; nameRow.appendChild(nameInp);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = ''; iconRow.appendChild(iconInp);
    const iconPickBtn = document.createElement('button');
    iconPickBtn.type = 'button';
    iconPickBtn.className = 'btn sm emoji-pick-btn';
    iconPickBtn.textContent = '😀';
    iconPickBtn.title = '选择图标';
    iconPickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(iconPickBtn, iconInp); });
    iconRow.appendChild(iconPickBtn);
    body.appendChild(nameRow); body.appendChild(iconRow);

    let typeSel = null, actSel = null, exeRow = null, exeInp = null;
    if (isTerm) {
      const typeRow = makeRow('动作类型');
      typeSel = document.createElement('select');
      [['builtin', '内置页面/工具'], ['exe', '外部程序']].forEach(([v, l]) => {
        const op = document.createElement('option'); op.value = v; op.textContent = l; typeSel.appendChild(op);
      });
      typeSel.value = 'builtin';
      typeRow.appendChild(typeSel); body.appendChild(typeRow);

      const actRow = makeRow('目标页面');
      actSel = document.createElement('select');
      for (const o of MENU_ACTION_OPTIONS) {
        const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; actSel.appendChild(op);
      }
      actSel.value = MENU_ACTION_OPTIONS[0].value;
      actRow.appendChild(actSel); body.appendChild(actRow);

      exeRow = makeRow('程序路径');
      exeInp = document.createElement('input'); exeInp.type = 'text'; exeInp.value = '';
      exeInp.placeholder = '例如 C:\\Tools\\app.exe 参数';
      exeRow.appendChild(exeInp); body.appendChild(exeRow);

      const sync = () => {
        const isExe = typeSel.value === 'exe';
        actSel.closest('.form-row').style.display = isExe ? 'none' : '';
        exeRow.style.display = isExe ? '' : 'none';
      };
      typeSel.addEventListener('change', sync); sync();
    }

    const { close } = openModal({
      title: isTerm ? '新建终端节点' : '新建目录',
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
            }
            addMenuNode({ name, icon: iconInp.value.trim(), parentId, nodeType, actionType, action });
            close();
            if (parentId) mmExpanded.add(parentId); // 新建子节点后展开父目录,便于看到
            refresh();
            toast('已创建');
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
    const nameRow = makeRow('名称');
    const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = node.name; nameRow.appendChild(nameInp);
    const iconRow = makeRow('图标(emoji)');
    const iconInp = document.createElement('input'); iconInp.type = 'text'; iconInp.value = node.icon || ''; iconRow.appendChild(iconInp);
    const iconPickBtn = document.createElement('button');
    iconPickBtn.type = 'button';
    iconPickBtn.className = 'btn sm emoji-pick-btn';
    iconPickBtn.textContent = '😀';
    iconPickBtn.title = '选择图标';
    iconPickBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmojiPicker(iconPickBtn, iconInp); });
    iconRow.appendChild(iconPickBtn);
    const tipRow = makeRow('悬停提示');
    const tipInp = document.createElement('input'); tipInp.type = 'text'; tipInp.value = node.tooltip || ''; tipRow.appendChild(tipInp);
    const noteRow = makeRow('备注');
    const noteInp = document.createElement('textarea'); noteInp.value = node.note || ''; noteRow.appendChild(noteInp);
    body.appendChild(nameRow); body.appendChild(iconRow); body.appendChild(tipRow); body.appendChild(noteRow);

    let typeSel = null, actSel = null, exeRow = null, exeInp = null;
    if (isTerm) {
      const typeRow = makeRow('动作类型');
      typeSel = document.createElement('select');
      [['builtin', '内置页面/工具'], ['exe', '外部程序']].forEach(([v, l]) => {
        const op = document.createElement('option'); op.value = v; op.textContent = l; typeSel.appendChild(op);
      });
      typeSel.value = node.actionType === 'exe' ? 'exe' : 'builtin';
      typeRow.appendChild(typeSel); body.appendChild(typeRow);

      const actRow = makeRow('目标页面');
      actSel = document.createElement('select');
      for (const o of MENU_ACTION_OPTIONS) {
        const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; actSel.appendChild(op);
      }
      if (!MENU_ACTION_OPTIONS.some((o) => o.value === node.action)) {
        const op = document.createElement('option'); op.value = node.action; op.textContent = node.action; actSel.appendChild(op);
      }
      actSel.value = node.action || MENU_ACTION_OPTIONS[0].value;
      actRow.appendChild(actSel); body.appendChild(actRow);

      exeRow = makeRow('程序路径');
      exeInp = document.createElement('input'); exeInp.type = 'text'; exeInp.value = node.actionType === 'exe' ? (node.action || '') : '';
      exeInp.placeholder = '例如 C:\\Tools\\app.exe 参数';
      exeRow.appendChild(exeInp); body.appendChild(exeRow);

      const sync = () => {
        const isExe = typeSel.value === 'exe';
        actSel.closest('.form-row').style.display = isExe ? 'none' : '';
        exeRow.style.display = isExe ? '' : 'none';
      };
      typeSel.addEventListener('change', sync); sync();
    }

    const { close } = openModal({
      title: isTerm ? '编辑终端节点' : '编辑目录节点',
      body,
      foot: footButtons([
        { text: '取消', cls: '', onClick: () => close() },
        {
          text: '确定', cls: 'primary', onClick: () => {
            const name = nameInp.value.trim();
            if (!name) { toast('名称不能为空', 'error'); return; }
            const patch = { name, icon: iconInp.value.trim(), tooltip: tipInp.value.trim(), note: noteInp.value.trim() };
            if (isTerm) {
              const isExe = typeSel.value === 'exe';
              patch.actionType = isExe ? 'exe' : 'builtin';
              patch.action = isExe ? exeInp.value.trim() : actSel.value;
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
    const subs = getMenuNodeDescendants(id).length;
    confirmDialog({
      title: `删除「${node.name}」?`,
      message: subs ? `其下 ${subs} 个子节点将一并删除。` : '该节点将被删除。',
      onOk: () => { removeMenuNode(id); refresh(); toast('已删除'); },
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

  renderMmTree();
}

