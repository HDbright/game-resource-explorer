// ============ 系统设置页面 ============
// 当前包含「截图」相关设置:默认保存路径 / 默认格式(PNG·WebP) / WebP 质量。

import { state, setSetting, saveState } from '../state.js';
import { toast } from '../dialogs.js';

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
      <section class="settings-card">
        <h3>动画截图</h3>
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
      </section>

      <section class="settings-card">
        <h3>音频播放器</h3>
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
      </section>

      <section class="settings-card">
        <h3>资源标签页</h3>
        <p class="settings-hint">控制从资源列表打开动画 / 图片 / 音频 / 3D 文件时,主区标签页的行为。</p>
        <div class="form-row">
          <label class="f-label">同类型新标签</label>
          <label class="ss-check"><input type="checkbox" id="ss-newtab" ${s.openSameTypeNewTab !== false ? 'checked' : ''} /> 打开同一类型资源文件时,通过新开标签页打开</label>
        </div>
        <p class="settings-hint">开启:每个资源文件独立一个标签页(默认,可同时打开多个动画对照)。关闭:同一类型(如动画)的资源复用当前预览标签,打开新资源时替换内容,避免标签页堆积。</p>
        <div class="settings-actions">
          <button class="btn primary" id="ss-newtab-save">保存设置</button>
        </div>
      </section>

      <section class="settings-card">
        <h3>网络资源抓取</h3>
        <p class="settings-hint">控制从「网络资源抓取」(网页浏览器)页面切到其它模块时的行为。</p>
        <div class="form-row">
          <label class="f-label">自动弹出悬浮窗</label>
          <label class="ss-check"><input type="checkbox" id="wg-autofloat" ${s.webgameAutoFloatOnSwitch ? 'checked' : ''} /> 切换到别的模块时,自动把网页弹出独立悬浮窗</label>
        </div>
        <p class="settings-hint">关闭(默认):切走后网页视图仅隐藏,不弹窗;回到抓取页网页依旧可见,浏览进度不中断。开启:切走后网页自动弹出可拖拽的独立悬浮窗(原行为)。</p>
        <div class="settings-actions">
          <button class="btn primary" id="wg-autofloat-save">保存设置</button>
        </div>
      </section>

      <section class="settings-card">
        <h3>开发者调试 (Chrome DevTools)</h3>
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
      </section>

      <section class="settings-card">
        <h3>开发者调试 · 组件源码定位</h3>
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
      </section>
    </div>
  `;

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

  // 返回
  container.querySelector('#settings-back').addEventListener('click', () => {
    if (opts.onClose) opts.onClose();
  });
}
