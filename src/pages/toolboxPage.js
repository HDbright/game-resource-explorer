// 资源工具箱页面
// 4 个工具:astc2png / skel2json / spinefix / imageedit(单/批量图片编辑)
// 由 ui.js 调用 renderToolboxPage(container, tool) 根据 tool 渲染对应工具面板。

import { toast, confirmDialog } from '../dialogs.js';

/**
 * 渲染工具箱页面。tool: 'astc2png' | 'skel2json' | 'spinefix' | 'imageedit' | '__home__'
 */
export function renderToolboxPage(container, tool) {
  if (!container) return;
  container.innerHTML = '';
  // ---- 工具箱主页(汇总视图):列出所有子菜单入口 ----
  if (tool === '__home__') {
    renderToolboxHome(container);
    return;
  }
  const tools = {
    astc2png: { title: 'ASTC → PNG', desc: '纯软件解码 .astc GPU 压缩贴图为 PNG;支持 2D LDR/HDR,3D 文件暂不支持。', render: renderAstcTool },
    skel2json: { title: 'SKEL → JSON', desc: '把 Spine 二进制骨架(.skel)转为 JSON(自动探测 3.x / 4.x 版本,调用对应运行时解析)。', render: renderSkelTool },
    spinefix: { title: 'Spine 文件修复', desc: '对 .json / .skel / .atlas 执行诊断与自动修复(JSON 注释/尾逗号/版本字段;atlas 缺图检测),输出修复副本。可单选/多选文件或整个目录(含子目录),记住最近输入目录。', render: renderSpineFixTool },
    imageedit: { title: '图片编辑', desc: '单个或批量处理图片:镜像翻转、旋转、缩放、生成指定大小/样式的缩略图(canvas 处理,导出 PNG/JPEG,可覆盖原文件)。', render: renderImageEditTool },
    fgui: { title: 'FGUI 导出源', desc: '把 FairyGUI 发布的 .bin 包批量还原为标准源工程:每个包在其同目录生成 FGUI_src/<包名>(package.xml + 组件 XML + 碎图 + 字体 + 动画),可直接用 FairyGUI 编辑器打开。', render: renderFguiTool },
    sk2spine: { title: 'Laya .sk → Spine', desc: '把 LayaAir 骨骼动画二进制(.sk,DragonBones 导出)逆向转换为 Spine 可读文件:骨架 .json + 纹理图集 .atlas。可单选/多选文件或整个目录(含子目录);选择时自动探测是否为 .sk 格式。', render: renderSk2SpineTool },
  };
  const cfg = tools[tool] || tools.astc2png;
  const head = document.createElement('div');
  head.className = 'tool-head';
  head.innerHTML = `<h2 class="tool-title">${cfg.title}</h2><p class="tool-desc">${cfg.desc}</p>`;
  container.appendChild(head);
  const body = document.createElement('div');
  body.className = 'tool-body';
  container.appendChild(body);
  cfg.render(body);
}

/** 工具箱主页:所有子菜单功能入口卡片 */
function renderToolboxHome(container) {
  const entries = [
    { id: 'astc2png', icon: '🖼', title: 'ASTC → PNG', desc: '纯软件解码 .astc GPU 压缩贴图为 PNG;支持 2D LDR/HDR,3D 文件暂不支持。可单选/多选文件或整个目录(含子目录),记住最近输入目录。' },
    { id: 'skel2json', icon: '📦', title: 'SKEL → JSON', desc: '把 Spine 二进制骨架(.skel)转为 JSON(自动探测 3.x / 4.x 版本,调用对应运行时解析)。可单选/多选文件或整个目录(含子目录),记住最近输入目录。' },
    { id: 'spinefix', icon: '🛠', title: 'Spine 文件修复', desc: '对 .json / .skel / .atlas 执行诊断与自动修复(JSON 注释/尾逗号/版本字段;atlas 缺图检测),输出修复副本。可单选/多选文件或整个目录(含子目录),记住最近输入目录。' },
    { id: 'imageedit', icon: '🎨', title: '图片编辑', desc: '单个或批量处理图片:镜像翻转、旋转、缩放、生成指定大小/样式的缩略图(canvas 处理,导出 PNG/JPEG,可覆盖原文件)。' },
    { id: 'fgui', icon: '🧩', title: 'FGUI 导出源', desc: '把 FairyGUI 发布的 .bin 包批量还原为标准源工程:每个包在其同目录生成 FGUI_src/<包名>(package.xml + 组件 XML + 碎图 + 字体 + 动画),可直接用 FairyGUI 编辑器打开。' },
    { id: 'sk2spine', icon: '🦴', title: 'Laya .sk → Spine', desc: '把 LayaAir 骨骼动画二进制(.sk,DragonBones 导出)逆向转换为 Spine 可读文件:骨架 .json + 纹理图集 .atlas。可单选/多选文件或整个目录(含子目录);选择时自动探测是否为 .sk 格式。' },
  ];
  const head = document.createElement('div');
  head.className = 'tool-head';
  head.innerHTML = `<h2 class="tool-title">资源工具箱</h2><p class="tool-desc">本机离线工具集,无需联网。选择下方任意功能入口开始处理。</p>`;
  container.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'tool-grid';
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'tool-entry';
    card.innerHTML = `
      <div class="tool-entry-ico">${entry.icon}</div>
      <div class="tool-entry-main">
        <div class="tool-entry-title">${escHtml(entry.title)}</div>
        <div class="tool-entry-desc">${escHtml(entry.desc)}</div>
      </div>
      <div class="tool-entry-go" aria-hidden="true">进入 →</div>`;
    // 通过自定义事件通知 ui.js 导航,避免跨模块直接传递函数(规避 minify 绑定问题)
    card.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('toolbox:navigate', { detail: { id: entry.id } }));
    });
    grid.appendChild(card);
  }
  container.appendChild(grid);
}

// ---- 批量转换公共面板(ASTC→PNG / SKEL→JSON 共用) ----
// 支持:选择单个/多个文件,或选择整个目录(递归收集含子目录);可混合追加;
// 记住最近 10 条输入目录(选择对话框默认定位到最近目录,可点击历史路径直达);
// 可选输出目录 + 保持相对目录结构;进度显示 + 成功/失败汇总(失败列表可展开)。

function baseName(p) {
  return (p.split(/[\\/]/).pop()) || p;
}
function relFrom(baseDir, full) {
  const b = baseDir.replace(/[\\/]+$/, '');
  const f = full.replace(/[\\/]+$/, '');
  if (f === b) return baseName(full);
  if (f.indexOf(b) === 0) {
    const rest = f.slice(b.length).replace(/^[\\/]+/, '');
    if (rest) return rest;
  }
  return baseName(full);
}

// ---- 最近输入目录历史(localStorage 全局共享,最多 10 条,新→旧,去重) ----
const INPUT_HIST_KEY = 'toolInputHistory';
const INPUT_HIST_MAX = 10;
function getInputHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(INPUT_HIST_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  } catch (e) { return []; }
}
function pushInputHistory(dirs) {
  let h = getInputHistory();
  for (const d of dirs) {
    if (!d) continue;
    h = h.filter((x) => x.toLowerCase() !== d.toLowerCase());
    h.unshift(d);
  }
  h = h.slice(0, INPUT_HIST_MAX);
  try { localStorage.setItem(INPUT_HIST_KEY, JSON.stringify(h)); } catch (e) { /* ignore */ }
  return h;
}

function buildBatchTool(body, cfg) {
  const px = cfg.prefix;
  body.innerHTML = `
    <div class="tool-card">
      <div class="field-row">
        <label class="field-label">输入(${escHtml(cfg.inputLabel)})</label>
        <div class="field-ctrl">
          <button class="btn" id="${px}-pick" title="选择一个或多个文件(可多选)">选择文件...</button>
          <button class="btn" id="${px}-pick-dir" title="选择整个目录,递归收集其中所有匹配文件(含子目录)">选择目录...</button>
          <span class="${px}-count" id="${px}-count"></span>
        </div>
      </div>
      <div class="tool-history" id="${px}-history" style="display:none">
        <span class="hist-label">最近目录:</span>
        <span class="hist-chips" id="${px}-hist-chips"></span>
        <span class="hist-hint">(点击定位到该目录)</span>
      </div>
      <div class="tool-filelist" id="${px}-list"></div>
      <div class="field-row">
        <label class="field-label">输出设置</label>
        <div class="field-ctrl col">
          <label class="chk"><input type="checkbox" id="${px}-outdir-toggle" /> 输出到指定目录(否则保存到源文件同目录)</label>
          <div class="field-ctrl outdir-row" id="${px}-outdir-row" style="display:none">
            <input type="text" id="${px}-outdir" placeholder="选择输出目录..." readonly />
            <button class="btn" id="${px}-outdir-pick">选择目录...</button>
          </div>
          <label class="chk" id="${px}-preserve-wrap" style="display:none"><input type="checkbox" id="${px}-preserve" checked /> 保持相对目录结构(文件夹内的子目录一并保留)</label>
        </div>
      </div>
      <div class="field-row">
        <div class="field-ctrl">
          <button class="btn primary" id="${px}-run" disabled>开始批量${cfg.runLabel || '转换'}</button>
          <button class="btn" id="${px}-clear">清空</button>
        </div>
      </div>
      <div class="tool-result" id="${px}-result"></div>
    </div>
  `;
  const listEl = body.querySelector(`#${px}-list`);
  const countEl = body.querySelector(`#${px}-count`);
  const runBtn = body.querySelector(`#${px}-run`);
  const clearBtn = body.querySelector(`#${px}-clear`);
  const outToggle = body.querySelector(`#${px}-outdir-toggle`);
  const outRow = body.querySelector(`#${px}-outdir-row`);
  const outDirEl = body.querySelector(`#${px}-outdir`);
  const preserveWrap = body.querySelector(`#${px}-preserve-wrap`);
  const preserveEl = body.querySelector(`#${px}-preserve`);
  const histWrap = body.querySelector(`#${px}-history`);
  const histChips = body.querySelector(`#${px}-hist-chips`);

  let selectedPaths = [];   // 用户选中的文件/文件夹原始路径
  let matchedFiles = [];    // 后端递归收集后的 [{path, baseDir}]
  let skippedFiles = [];    // 格式校验未通过的 [{name, reason}]

  function renderList() {
    if (!selectedPaths.length) {
      listEl.innerHTML = '';
      countEl.textContent = '';
    } else {
      listEl.innerHTML = selectedPaths.map((p) => `<div class="tfile">${escHtml(p)}</div>`).join('');
      const m = matchedFiles.length;
      const skipTxt = skippedFiles.length ? ` · 跳过 ${skippedFiles.length} 个` : '';
      countEl.textContent = `已选 ${selectedPaths.length} 项 · 匹配 ${m} 个文件${skipTxt}`;
    }
    runBtn.disabled = !matchedFiles.length;
  }

  function updateOutdirUI() {
    const on = outToggle.checked;
    outRow.style.display = on ? '' : 'none';
    preserveWrap.style.display = on ? '' : 'none';
  }

  async function collect() {
    matchedFiles = [];
    skippedFiles = [];
    if (!selectedPaths.length) { renderList(); return; }
    setResult(body, `#${px}-result`, { type: 'busy', msg: '正在扫描文件...' });
    const r = await window.api.collectFiles({ paths: selectedPaths, extensions: cfg.inputExt });
    if (!r.ok) {
      setResult(body, `#${px}-result`, { type: 'err', msg: '✗ ' + r.error });
      toast(r.error, 'error');
      renderList();
      return;
    }
    let files = r.files || [];
    // 可选格式校验(选择时即探测每个文件是否为目标格式,非目标格式跳过并提示)
    if (typeof cfg.validateFile === 'function') {
      const results = await Promise.all(files.map(async (f) => {
        try {
          const v = await cfg.validateFile(f.path);
          return { f, v };
        } catch (e) {
          return { f, v: { ok: false, reason: e.message || '校验失败' } };
        }
      }));
      const kept = [];
      const skipped = [];
      for (const { f, v } of results) {
        if (v.ok) kept.push(f);
        else skipped.push({ name: baseName(f.path), reason: v.reason || '格式校验未通过' });
      }
      files = kept;
      skippedFiles = skipped;
    }
    matchedFiles = files;
    renderList();
    if (skippedFiles.length) {
      const list = skippedFiles.map((s) => `${s.name}(${s.reason})`).join('；');
      setResult(body, `#${px}-result`, { type: 'warn', msg: `⚠ 已跳过 ${skippedFiles.length} 个非 Skel 格式文件:${list}` });
    } else {
      setResult(body, `#${px}-result`, { type: 'idle', msg: '' });
    }
  }

  // 打开选择对话框:mode='files'(单个/多个文件)或 'dir'(整个目录,递归含子目录)
  // startPath: 指定的历史目录;未指定时默认定位到最近一条历史目录
  async function pickInput(mode, startPath) {
    const isDir = mode === 'dir';
    const r = await window.api.pickFiles({
      title: isDir ? (cfg.pickDirTitle || cfg.pickTitle) : cfg.pickTitle,
      filters: isDir ? undefined : cfg.filters,
      directory: isDir,
      defaultPath: startPath || getInputHistory()[0] || undefined,
    });
    if (r.canceled || !r.filePaths.length) return;
    // 追加选中项(文件与目录可混合累积)
    selectedPaths = selectedPaths.concat(r.filePaths);
    // 记录输入目录历史:目录→其本身;文件→其所在目录(去重)
    const dirs = r.filePaths.map((p) => (isDir ? p : p.replace(/[\\/][^\\/]*$/, '')));
    pushInputHistory(dirs);
    renderHistory();
    await collect();
  }

  // 渲染最近输入目录 chips(点击 → 以该目录为定位打开文件选择对话框)
  function renderHistory() {
    const h = getInputHistory();
    histWrap.style.display = h.length ? '' : 'none';
    histChips.innerHTML = h.map((p) => `<span class="hist-chip" title="${escHtml(p)}">${escHtml(p)}</span>`).join('');
    histChips.querySelectorAll('.hist-chip').forEach((el) => {
      el.addEventListener('click', () => pickInput('files', el.getAttribute('title')));
    });
  }

  body.querySelector(`#${px}-pick`).addEventListener('click', () => pickInput('files'));
  body.querySelector(`#${px}-pick-dir`).addEventListener('click', () => pickInput('dir'));

  body.querySelector(`#${px}-outdir-pick`).addEventListener('click', async () => {
    const r = await window.api.pickFiles({ directory: true, title: '选择输出目录' });
    if (!r.canceled && r.filePaths.length) outDirEl.value = r.filePaths[0];
  });

  outToggle.addEventListener('change', updateOutdirUI);
  clearBtn.addEventListener('click', () => {
    selectedPaths = [];
    matchedFiles = [];
    skippedFiles = [];
    outDirEl.value = '';
    renderList();
    setResult(body, `#${px}-result`, { type: 'idle', msg: '' });
  });

  runBtn.addEventListener('click', async () => {
    if (!matchedFiles.length) return;
    const outDir = outToggle.checked ? outDirEl.value.trim() : '';
    const preserve = preserveEl.checked;
    if (outToggle.checked && !outDir) {
      toast('请先选择输出目录', 'error');
      return;
    }
    // 预计算每个文件的输出路径(扁平化时做同名防碰撞)
    const used = new Set();
    const tag = cfg.suffixTag || ''; // 例如 '_fixed':输出 = 原文件名 + tag + 原扩展名;否则换扩展名 cfg.outExt
    const plan = matchedFiles.map((f) => {
      const extMatch = f.path.match(/\.[^.\\/]+$/);
      const ext = extMatch ? extMatch[0] : '';
      let output;
      if (!outDir) {
        output = tag
          ? f.path.replace(/\.[^.\\/]+$/, tag + ext)
          : f.path.replace(/\.[^.]+$/, cfg.outExt);
      } else {
        const rel = preserve ? relFrom(f.baseDir, f.path) : baseName(f.path);
        let name = tag
          ? rel.replace(/\.[^.]+$/, '') + tag + ext
          : rel.replace(/\.[^.]+$/, '') + cfg.outExt;
        let cand = joinPath(outDir, name);
        let i = 1;
        const outDirLc = outDir.replace(/[\\/]+$/, '').toLowerCase();
        while (used.has(cand.toLowerCase())) {
          name = (tag
            ? rel.replace(/\.[^.]+$/, '') + tag
            : rel.replace(/\.[^.]+$/, '')) + `_${i}${tag ? ext : cfg.outExt}`;
          cand = joinPath(outDir, name);
          i++;
        }
        used.add(cand.toLowerCase());
        output = cand;
      }
      return { input: f.path, output };
    });

    runBtn.disabled = true;
    let okCount = 0, fail = [], skipped = 0;
    const total = plan.length;
    const api = window.api[cfg.apiName];
    const resEl = body.querySelector(`#${px}-result`);
    for (let i = 0; i < total; i++) {
      const item = plan[i];
      setResult(body, `#${px}-result`, { type: 'busy', msg: `处理 ${i + 1}/${total}: ${baseName(item.input)}` });
      try {
        const rr = await api({ inputPath: item.input, outputPath: item.output });
        if (rr.ok) okCount++;
        else fail.push(`${baseName(item.input)}: ${rr.error}`);
      } catch (e) {
        fail.push(`${baseName(item.input)}: ${e.message}`);
      }
      // 让出主线程,避免大批量时界面卡死
      if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
    }

    const verb = cfg.doneVerb || '转换';
    const failedHtml = fail.length
      ? `<details class="batch-fail"><summary>失败 ${fail.length} 个(点击展开)</summary><ul>${fail.map((f) => `<li>${escHtml(f)}</li>`).join('')}</ul></details>`
      : '';
    const outDirBtn = (outDir && okCount)
      ? `<button class="btn" id="${px}-open-out">打开输出目录</button>`
      : '';
    resEl.innerHTML = `
      <div class="result-ok">✓ 批量${verb}完成:成功 ${okCount} / 失败 ${fail.length}${skipped ? ' / 跳过 ' + skipped : ''}</div>
      <div class="batch-summary">
        ${outDir ? `<div class="result-path">输出目录:<code>${escHtml(outDir)}</code></div>` : '<div class="result-path">输出位置:源文件同目录</div>'}
        ${failedHtml}
        <div class="batch-actions">${outDirBtn}</div>
      </div>`;
    const openBtn = resEl.querySelector(`#${px}-open-out`);
    if (openBtn) openBtn.addEventListener('click', () => window.api.openPath(outDir));
    runBtn.disabled = false;
    toast(`批量${verb}完成:成功 ${okCount},失败 ${fail.length}`);
  });

  updateOutdirUI();
  renderHistory();
  renderList();
}

function renderAstcTool(body) {
  buildBatchTool(body, {
    prefix: 'astc',
    title: 'ASTC → PNG',
    desc: '纯软件解码 .astc GPU 压缩贴图为 PNG;支持 2D LDR/HDR,3D 文件暂不支持。可单选/多选文件,或选择整个目录(递归收集含子目录);自动记住最近 10 条输入目录,选择时直接定位。',
    inputLabel: 'ASTC 贴图 .astc',
    pickTitle: '选择 .astc 文件(可多选)',
    pickDirTitle: '选择目录(递归收集其中所有 .astc 文件,含子目录)',
    filters: [{ name: 'ASTC 贴图', extensions: ['astc'] }],
    inputExt: ['astc'],
    outExt: '.png',
    apiName: 'astc2png',
  });
}

// ---- SKEL → JSON ----

function renderSkelTool(body) {
  buildBatchTool(body, {
    prefix: 'skel',
    title: 'SKEL → JSON',
    desc: '把 Spine 二进制骨架(.skel,也支持 .bin 后缀但实为 Skel 格式的骨骼文件)转为 JSON(自动探测 3.x / 4.x 版本,调用对应运行时解析)。可单选/多选文件,或选择整个目录(递归收集含子目录);选择时自动检测文件是否确为 Skel 格式,非 Skel 文件会被跳过;自动记住最近 10 条输入目录,选择时直接定位。',
    inputLabel: 'Spine 二进制骨架 .skel / .bin',
    pickTitle: '选择 .skel / .bin 文件(可多选)',
    pickDirTitle: '选择目录(递归收集其中所有 .skel / .bin 文件,含子目录)',
    filters: [{ name: 'Spine 骨架 (.skel / .bin)', extensions: ['skel', 'bin'] }],
    inputExt: ['skel', 'bin'],
    outExt: '.json',
    apiName: 'skel2json',
    // 选择时探测文件是否确为 Skel 二进制格式(.bin 后缀常为误命名,需校验)
    validateFile: async (p) => window.api.probeSkel({ inputPath: p }),
  });
}

// ---- LayaAir .sk → Spine(JSON + .atlas) ----

function renderSk2SpineTool(body) {
  buildBatchTool(body, {
    prefix: 'sk2spine',
    title: 'Laya .sk → Spine',
    desc: '把 LayaAir 骨骼动画二进制(.sk,DragonBones 导出,LAYAANIMATION:1.7.x)逆向转换为 Spine 可读文件:骨架 .json + 纹理图集 .atlas(自动同源目录输出 .atlas)。可单选/多选文件,或选择整个目录(递归收集含子目录);选择时自动探测是否为 .sk 格式,非 .sk 文件会被跳过;自动记住最近 10 条输入目录,选择时直接定位。',
    inputLabel: 'LayaAir 骨骼动画 .sk',
    pickTitle: '选择 .sk 文件(可多选)',
    pickDirTitle: '选择目录(递归收集其中所有 .sk 文件,含子目录)',
    filters: [{ name: 'LayaAir 骨骼动画 (.sk)', extensions: ['sk'] }],
    inputExt: ['sk'],
    outExt: '.json',
    apiName: 'sk2spine',
    runLabel: '转换',
    doneVerb: '转换',
    // 选择时探测文件是否确为 LayaAir .sk 二进制格式,非 .sk 文件跳过
    validateFile: async (p) => window.api.probeSk2spine({ inputPath: p }),
  });
}

// ---- FGUI 导出源(批量还原标准 FairyGUI 源工程到每个包同目录 FGUI_src/<包名>) ----

function renderFguiTool(body) {
  const px = 'fgui';
  body.innerHTML = `
    <div class="tool-card">
      <div class="field-row">
        <label class="field-label">输入目录</label>
        <div class="field-ctrl">
          <input type="text" id="${px}-indir" placeholder="选择包含 FGUI 包(.bin)的目录..." readonly />
          <button class="btn" id="${px}-indir-pick">选择目录...</button>
          <span class="${px}-count" id="${px}-count"></span>
        </div>
      </div>
      <div class="tool-history" id="${px}-history" style="display:none">
        <span class="hist-label">最近目录:</span>
        <span class="hist-chips" id="${px}-hist-chips"></span>
        <span class="hist-hint">(点击定位到该目录)</span>
      </div>
      <div class="field-row">
        <div class="field-ctrl">
          <button class="btn primary" id="${px}-run" disabled>开始导出源工程</button>
          <span class="status" id="${px}-status"></span>
        </div>
      </div>
      <div class="tool-result" id="${px}-result"></div>
    </div>
  `;
  const indirEl = body.querySelector(`#${px}-indir`);
  const countEl = body.querySelector(`#${px}-count`);
  const runBtn = body.querySelector(`#${px}-run`);
  const statusEl = body.querySelector(`#${px}-status`);
  const resultEl = body.querySelector(`#${px}-result`);
  const histWrap = body.querySelector(`#${px}-history`);
  const histChips = body.querySelector(`#${px}-hist-chips`);

  let inputDir = '';

  function renderHistory() {
    const h = getInputHistory();
    histWrap.style.display = h.length ? '' : 'none';
    histChips.innerHTML = h.map((p) => `<span class="hist-chip" title="${escHtml(p)}">${escHtml(p)}</span>`).join('');
    histChips.querySelectorAll('.hist-chip').forEach((el) => {
      el.addEventListener('click', () => {
        inputDir = el.title;
        indirEl.value = inputDir;
        refreshCount();
      });
    });
  }

  async function refreshCount() {
    if (!inputDir) { countEl.textContent = ''; runBtn.disabled = true; return; }
    countEl.textContent = '正在统计...';
    const r = await window.api.collectFiles({ paths: [inputDir], extensions: ['bin'] });
    const n = r.ok ? (r.files || []).length : 0;
    countEl.textContent = n ? `发现 ${n} 个 .bin 文件` : '(未发现 .bin 文件)';
    runBtn.disabled = !n;
  }

  body.querySelector(`#${px}-indir-pick`).addEventListener('click', async () => {
    const r = await window.api.pickFiles({
      title: '选择包含 FGUI 包(.bin)的目录',
      directory: true,
      defaultPath: getInputHistory()[0] || undefined,
    });
    if (r.canceled || !r.filePaths.length) return;
    inputDir = r.filePaths[0];
    indirEl.value = inputDir;
    pushInputHistory([inputDir]);
    renderHistory();
    await refreshCount();
  });

  runBtn.addEventListener('click', async () => {
    if (!inputDir) { toast('请先选择输入目录', 'error'); return; }
    const r = await window.api.collectFiles({ paths: [inputDir], extensions: ['bin'] });
    const bins = (r.ok ? (r.files || []) : []).filter(Boolean);
    if (!bins.length) { toast('目录中没有 .bin 文件', 'error'); return; }
    runBtn.disabled = true;
    statusEl.textContent = `正在导出源工程(0/${bins.length})...`;
    setResult(body, `#${px}-result`, { type: 'busy', msg: '正在解析并还原 FairyGUI 源工程...' });
    let okCount = 0;
    const errs = [];
    try {
      for (let i = 0; i < bins.length; i++) {
        const bin = bins[i];
        statusEl.textContent = `正在导出源工程(${i + 1}/${bins.length})...`;
        // 输出到 bin 同目录 FGUI_src/<包名>
        const binDir = bin.replace(/[\\/]+[^\\/]+$/, '');
        const outRoot = binDir + '/FGUI_src';
        // 已存在该包源工程时确认是否覆盖
        const base = bin.split(/[\\/]/).pop() || '';
        const pkgName = base.replace(/\.[^.]+$/, '');
        try {
          const st = await window.api.statFile(outRoot + '/' + pkgName + '/package.xml');
          if (st && st.size != null) {
            const go = window.confirm(`「FGUI_src/${pkgName}」目录已存在该包的源工程,是否覆盖?\n${outRoot}/${pkgName}`);
            if (!go) { errs.push({ file: base, error: '已取消(目录已存在)' }); continue; }
          }
        } catch (e) { /* ignore */ }
        const res = await window.api.fguiExportSource({ inputPath: bin, outputDir: outRoot });
        if (res && res.ok) okCount++;
        else errs.push({ file: base, error: (res && res.error) || '导出失败' });
      }
      statusEl.textContent = '';
      let msg = `✅ 导出源工程完成:成功 ${okCount} 个包`;
      if (errs.length) msg += `,失败/跳过 ${errs.length} 个`;
      msg += `(输出到各包同目录 FGUI_src/<包名>)`;
      setResult(body, `#${px}-result`, { type: errs.length ? 'warn' : 'ok', msg });
      if (errs.length) {
        setResult(body, `#${px}-result`, { type: 'warn', msg: errs.map((e) => `${escHtml(e.file)}:${escHtml(e.error)}`).join('<br/>') });
      }
    } catch (e) {
      statusEl.textContent = '';
      setResult(body, `#${px}-result`, { type: 'err', msg: '✗ ' + (e.message || String(e)) });
    } finally {
      runBtn.disabled = false;
      await refreshCount();
    }
  });

  renderHistory();
}

// ---- Spine 修复 ----

function renderSpineFixTool(body) {
  buildBatchTool(body, {
    prefix: 'fix',
    title: 'Spine 文件修复',
    desc: '对 .json / .skel / .atlas 执行诊断与自动修复(JSON 注释/尾逗号/版本字段;atlas 缺图检测),输出修复副本(文件名 + _fixed)。可单选/多选文件,或选择整个目录(递归收集含子目录);自动记住最近 10 条输入目录,选择时直接定位。',
    inputLabel: 'Spine 文件 .json / .skel / .atlas',
    pickTitle: '选择 Spine 文件(.json / .skel / .atlas,可多选)',
    pickDirTitle: '选择目录(递归收集其中所有 .json / .skel / .atlas,含子目录)',
    filters: [{ name: 'Spine 文件', extensions: ['json', 'skel', 'atlas'] }],
    inputExt: ['json', 'skel', 'atlas'],
    outExt: '',
    suffixTag: '_fixed',
    apiName: 'spineFix',
    runLabel: '修复',
    doneVerb: '修复',
  });
}

// ---- 图片编辑(单/批量) ----

function renderImageEditTool(body) {
  body.innerHTML = `
    <div class="tool-card">
      <div class="field-row">
        <label class="field-label">图片文件(可多选)</label>
        <div class="field-ctrl">
          <input type="text" id="ie-input" placeholder="选择若干张图片..." readonly />
          <button class="btn" id="ie-pick">选择...</button>
          <span class="ie-count" id="ie-count"></span>
        </div>
      </div>
      <div class="field-row">
        <label class="field-label">操作</label>
        <div class="field-ctrl">
          <select id="ie-op">
            <option value="flipH">水平镜像翻转</option>
            <option value="flipV">垂直镜像翻转</option>
            <option value="rotate90">顺时针旋转 90°</option>
            <option value="rotate180">旋转 180°</option>
            <option value="rotate270">顺时针旋转 270°</option>
            <option value="resize">缩放大小</option>
            <option value="thumbnail">生成缩略图</option>
          </select>
        </div>
      </div>
      <div class="ie-params" id="ie-params">
        <!-- 由选择操作动态填充参数表 -->
      </div>
      <div class="field-row">
        <label class="field-label">保存方式</label>
        <div class="field-ctrl">
          <select id="ie-save">
            <option value="new">另存为新文件(原文件保留)</option>
            <option value="overwrite">覆盖原文件(⚠ 不可恢复)</option>
          </select>
        </div>
      </div>
      <div class="field-row" id="ie-outrow">
        <label class="field-label">输出格式 / 输出目录</label>
        <div class="field-ctrl">
          <select id="ie-fmt">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
          <input type="text" id="ie-outdir" placeholder="默认:输入文件所在目录,文件名 + _op + .ext" />
          <button class="btn" id="ie-pick-outdir">选择目录...</button>
        </div>
      </div>
      <div class="field-row">
        <div class="field-ctrl">
          <button class="btn primary" id="ie-run" disabled>开始处理</button>
        </div>
      </div>
      <div class="tool-result" id="ie-result"></div>
    </div>
  `;

  let files = []; // [{ path, image, fileName, ext }]
  const inputEl = body.querySelector('#ie-input');
  const countEl = body.querySelector('#ie-count');
  const opEl = body.querySelector('#ie-op');
  const paramsEl = body.querySelector('#ie-params');
  const saveEl = body.querySelector('#ie-save');
  const outRowEl = body.querySelector('#ie-outrow');
  const outdirEl = body.querySelector('#ie-outdir');
  const fmtEl = body.querySelector('#ie-fmt');
  const runBtn = body.querySelector('#ie-run');

  saveEl.addEventListener('change', () => {
    const ow = saveEl.value === 'overwrite';
    outRowEl.style.display = ow ? 'none' : '';
    if (ow) outdirEl.value = '';
  });

  body.querySelector('#ie-pick').addEventListener('click', async () => {
    const r = await window.api.pickFiles({
      title: '选择图片(可多选)',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths.length) return;
    files = [];
    const out = [];
    for (const p of r.filePaths) {
      const base = (p.split(/[\\/]/).pop()) || 'image';
      const ext = (base.match(/\.([^.]+)$/) || [, 'png'])[1].toLowerCase();
      const isImg = ['png','jpg','jpeg','gif','webp','bmp'].includes(ext);
      if (!isImg) continue;
      const rd = await window.api.readBase64(p);
      if (!rd.ok) { toast(`无法读取 ${p}: ${rd.error}`, 'error'); continue; }
      const img = await loadImg(rd.dataUrl);
      files.push({ path: p, image: img, fileName: base, ext });
      out.push(base);
    }
    inputEl.value = out.join(', ');
    countEl.textContent = files.length ? `已选 ${files.length} 张` : '';
    runBtn.disabled = !files.length;
  });

  body.querySelector('#ie-pick-outdir').addEventListener('click', async () => {
    const r = await window.api.pickFiles({ directory: true, title: '选择输出目录' });
    if (!r.canceled && r.filePaths.length) outdirEl.value = r.filePaths[0];
  });

  opEl.addEventListener('change', updateParams);
  updateParams();

  function updateParams() {
    const op = opEl.value;
    if (op === 'resize') {
      paramsEl.innerHTML = `
        <div class="field-row"><label class="field-label">宽度 / 高度</label><div class="field-ctrl">
          <input type="number" id="ie-w" min="1" value="512" style="width:90px" /> ×
          <input type="number" id="ie-h" min="1" value="512" style="width:90px" />
          <label class="chk"><input type="checkbox" id="ie-keepaspect" checked /> 保持比例</label>
          <label class="chk"><input type="checkbox" id="ie-stretch" /> 强制拉伸</label>
        </div></div>
      `;
    } else if (op === 'thumbnail') {
      paramsEl.innerHTML = `
        <div class="field-row"><label class="field-label">目标尺寸</label><div class="field-ctrl">
          <input type="number" id="ie-w" min="1" value="256" style="width:90px" /> ×
          <input type="number" id="ie-h" min="1" value="256" style="width:90px" />
        </div></div>
        <div class="field-row"><label class="field-label">缩放样式</label><div class="field-ctrl">
          <select id="ie-style">
            <option value="contain">contain(适应/留白)</option>
            <option value="cover">cover(裁剪填充)</option>
            <option value="stretch">stretch(拉伸)</option>
          </select>
          <label class="chk">背景色 <input type="color" id="ie-bgcolor" value="#22242b" /></label>
        </div></div>
      `;
    } else {
      paramsEl.innerHTML = '';
    }
  }

  runBtn.addEventListener('click', () => {
    if (!files.length) return;
    if (saveEl.value === 'overwrite') {
      confirmDialog({
        title: '覆盖原文件',
        message: `将<strong>直接覆盖</strong>选中的 <strong>${files.length}</strong> 个原文件,此操作<strong>不可恢复</strong>。建议先备份。确定继续吗?`,
        okText: '覆盖',
        danger: true,
        onOk: () => runAll(),
      });
      return;
    }
    runAll();
  });

  async function runAll() {
    if (!files.length) return;
    runBtn.disabled = true;
    const op = opEl.value;
    const fmt = fmtEl.value;
    const outdir = outdirEl.value || '';
    const isOverwrite = saveEl.value === 'overwrite';
    let okCount = 0, fail = [];
    setResult(body, '#ie-result', { type: 'busy', msg: `处理 0/${files.length}...` });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setResult(body, '#ie-result', { type: 'busy', msg: `处理 ${i + 1}/${files.length}: ${f.fileName}` });
      try {
        let outFmt = fmt, outPath;
        if (isOverwrite) {
          // 覆盖原文件:格式跟随原扩展名,路径即原文件
          if (f.ext === 'gif' || f.ext === 'bmp') {
            fail.push(`${f.fileName}: 该格式不支持直接覆盖,请改用「另存为新文件」`);
            continue;
          }
          outFmt = f.ext === 'jpg' || f.ext === 'jpeg' ? 'jpeg' : (f.ext === 'webp' ? 'webp' : 'png');
          outPath = f.path;
        } else {
          const ext = fmt === 'jpeg' ? 'jpg' : 'png';
          const opTag = { flipH: 'flipH', flipV: 'flipV', rotate90: 'rot90', rotate180: 'rot180', rotate270: 'rot270', resize: 'resized', thumbnail: 'thumb' }[op];
          const base = f.fileName.replace(/\.[^.]+$/, '');
          const outName = `${base}_${opTag}.${ext}`;
          outPath = outdir ? joinPath(outdir, outName) : deriveSibling(f.path, `_${opTag}.${ext}`);
        }
        const blob = await applyOp(f.image, op, outFmt);
        const dataUrl = await blobToDataUrl(blob);
        const wr = await window.api.writeFileBase64(outPath, dataUrl);
        if (wr.ok) okCount++; else fail.push(`${f.fileName}: ${wr.error}`);
      } catch (e) {
        fail.push(`${f.fileName}: ${e.message}`);
      }
    }
    const out = body.querySelector('#ie-result');
    out.innerHTML = `<div class="result-ok">✓ 完成:成功 ${okCount} / 失败 ${fail.length}${fail.length ? '</div><div class="result-warn">失败列表:' + escHtml(fail.join('\n')) : ''}</div>
      <div class="result-path">${isOverwrite ? `已覆盖 ${okCount} 个原文件` : '输出目录:' + escHtml(outdir || '(输入文件所在目录)')}</div>`;
    runBtn.disabled = false;
    toast(`处理完成:成功 ${okCount}`);
  }
}

function loadImg(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}

async function applyOp(img, op, fmt) {
  let targetW = img.naturalWidth, targetH = img.naturalHeight;
  let drawW = targetW, drawH = targetH;
  let offX = 0, offY = 0;
  let finalW = targetW, finalH = targetH;
  let ctxTransform = '';

  if (op === 'flipH') ctxTransform = 'translateX(-1)';
  else if (op === 'flipV') ctxTransform = 'translateY(-1)';
  else if (op === 'rotate90') { ctxTransform = 'rotate(90deg) translateY(-1)'; finalW = img.naturalHeight; finalH = img.naturalWidth; }
  else if (op === 'rotate180') ctxTransform = 'rotate(180deg) translate(-1,-1)';
  else if (op === 'rotate270') { ctxTransform = 'rotate(-90deg) translateX(-1)'; finalW = img.naturalHeight; finalH = img.naturalWidth; }
  else if (op === 'resize') {
    finalW = +document.getElementById('ie-w').value || 1;
    finalH = +document.getElementById('ie-h').value || 1;
    if (document.getElementById('ie-keepaspect').checked && !document.getElementById('ie-stretch').checked) {
      const ar = img.naturalWidth / img.naturalHeight;
      if (finalW / finalH > ar) finalW = Math.round(finalH * ar);
      else finalH = Math.round(finalW / ar);
    }
    drawW = finalW; drawH = finalH;
  } else if (op === 'thumbnail') {
    finalW = +document.getElementById('ie-w').value || 256;
    finalH = +document.getElementById('ie-h').value || 256;
    const style = document.getElementById('ie-style').value;
    const ar = img.naturalWidth / img.naturalHeight;
    const tar = finalW / finalH;
    if (style === 'contain') {
      if (tar > ar) { drawH = finalH; drawW = Math.round(finalH * ar); offX = (finalW - drawW) / 2; }
      else { drawW = finalW; drawH = Math.round(finalW / ar); offY = (finalH - drawH) / 2; }
    } else if (style === 'cover') {
      if (tar > ar) { drawW = finalW; drawH = Math.round(finalW / ar); offY = (finalH - drawH) / 2; }
      else { drawH = finalH; drawW = Math.round(finalH * ar); offX = (finalW - drawW) / 2; }
    } else {
      drawW = finalW; drawH = finalH; offX = 0; offY = 0;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, finalW);
  canvas.height = Math.max(1, finalH);
  const ctx = canvas.getContext('2d');
  if (op === 'thumbnail' && document.getElementById('ie-style').value === 'contain') {
    const bg = document.getElementById('ie-bgcolor').value || '#22242b';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (op !== 'resize') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (ctxTransform) {
    // 用 setTransform 应用变换矩阵,以 finalW/finalH 为画布
    ctx.save();
    switch (op) {
      case 'flipH': ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
      case 'flipV': ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
      case 'rotate90': ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); break;
      case 'rotate180': ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
      case 'rotate270': ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); break;
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(img, offX, offY, drawW, drawH);
  }
  // JPEG 输出无 alpha,需填充白底;webp 保留 alpha
  const fmtFinal = fmt || document.getElementById('ie-fmt').value;
  if (fmtFinal === 'jpeg') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width; flat.height = canvas.height;
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    return await new Promise((res) => flat.toBlob(res, 'image/jpeg', 0.92));
  }
  if (fmtFinal === 'webp') {
    return await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.92));
  }
  return await new Promise((res) => canvas.toBlob(res, 'image/png'));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ---- 公共工具 ----

function deriveSibling(p, newExt) {
  // 把 .foo 后缀换成 newExt
  return p.replace(/\.[^\\/]+$/, newExt);
}
function joinPath(dir, name) {
  return dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + name;
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function setResult(body, sel, info) {
  const el = body.querySelector(sel);
  if (!el) return;
  if (info.type === 'idle' || !info.msg) { el.innerHTML = ''; return; }
  const cls = info.type === 'err' ? 'result-err' : (info.type === 'warn' ? 'result-warn' : (info.type === 'busy' ? 'result-busy' : 'result-ok'));
  el.innerHTML = `<div class="${cls}">${escHtml(info.msg)}${info.path ? '</div><div class="result-path">路径:<code>' + escHtml(info.path) + '</code></div>' : ''}</div>`;
}