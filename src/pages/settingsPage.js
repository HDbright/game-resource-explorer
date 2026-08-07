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

  // 返回
  container.querySelector('#settings-back').addEventListener('click', () => {
    if (opts.onClose) opts.onClose();
  });
}
