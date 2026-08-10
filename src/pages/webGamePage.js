'use strict';
/**
 * 网络资源抓取与网址收藏夹页。
 * - 内嵌 WebContentsView 打开网页(主进程 webGame 单例), 实时拦截网络请求分类展示。
 * - 支持筛选 / 下载 / 入库: fgui .bin → addScene(subtype='fgui'), spine/image/audio → addItem。
 * - 网址收藏夹: 分类树(可嵌套) + 网址条目增删改查, 侧栏「网址收藏夹」节点联动。
 * - 状态保持: container._webGameInited 标志, 切页回来不重建; _webGameSyncBounds 上报浏览器视图矩形。
 */
import {
  addItem, addScene, addSceneCategory, findOrCreateCategoryByName, setSetting, state,
  addWebBookmarkCategory, updateWebBookmarkCategory, removeWebBookmarkCategory,
  webBookmarkCategoryById, getWebBookmarkCategoryChildren,
  addWebBookmark, updateWebBookmark, removeWebBookmark,
  webBookmarkById, webBookmarksInCategory,
} from '../state.js';
import { toast, confirmDialog, promptDialog } from '../dialogs.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => {
  n = Number(n) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
};
const typeLabel = {
  fgui: 'FGUI', spine: 'Spine', 'spine-json': 'Spine', 'spine-skel': 'Spine', 'spine-atlas': 'Atlas',
  image: '图片', audio: '音频', video: '视频', font: '字体', script: '脚本', config: '配置', other: '其他',
  bin: 'Bin',
};
const typeColor = {
  fgui: '#7c5cff', spine: '#ff7c5c', 'spine-json': '#ff7c5c', 'spine-skel': '#ff7c5c', 'spine-atlas': '#ff9c5c',
  image: '#5c9cff', audio: '#5cff9c', video: '#ff5c9c', font: '#ffcc5c', script: '#9c9c9c', config: '#7c9c9c', other: '#666',
  bin: '#aa77ff',
};
const TYPE_GROUP = ['fgui', 'spine', 'image', 'audio', 'video', 'font', 'config', 'other', 'script'];

function safeName(n) {
  return String(n).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'file';
}

/** 从 URL 派生相对保存路径(保留目录结构, 文件重名加 -1/-2) */
function relPathForUrl(url, type) {
  let p = '';
  try {
    const u = new URL(url);
    p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  } catch (e) {
    p = url.split(/[?#]/)[0].replace(/^\/+/, '');
  }
  if (!p) p = 'index';
  return p.split('/').map(safeName).join('/');
}

export function renderWebGamePage(container, opts = {}) {
  if (container._webGameInited) {
    container._webGameSyncBounds && container._webGameSyncBounds();
    return container;
  }
  container._webGameInited = true;

  let records = [];        // 捕获列表
  let filter = new Set(['fgui', 'spine', 'image', 'audio']);
  let downloadRoot = '';   // 输出根目录
  let lastStatus = '';
  let curBmCat = '';       // 网址收藏夹当前分类('' = 未分类)
  let curPanel = 'capture'; // 'capture' | 'bookmark'
  const selected = new Set(); // 勾选的资源 url 集合

  container.innerHTML = `
    <div class="wg-wrap">
      <div class="wg-toolbar">
        <div class="wg-url-wrap">
          <input class="wg-url" id="wg-url" type="text" placeholder="输入网址, 如 https://h.api.4399.com/g.php?gameId=100073549" spellcheck="false" />
          <span class="wg-status" id="wg-status">未打开</span>
        </div>
        <button class="btn sm primary" id="wg-open" title="在内嵌浏览器中打开并开始拦截">▶ 打开</button>
        <button class="btn sm" id="wg-stop" title="关闭内嵌浏览器(保留捕获记录)">⏹ 停止</button>
        <span class="wg-tbsep"></span>
        <button class="btn sm" id="wg-back" title="后退">◀</button>
        <button class="btn sm" id="wg-fwd" title="前进">▶</button>
        <button class="btn sm" id="wg-reload" title="刷新">⟳</button>
        <button class="btn sm" id="wg-fav" title="收藏当前浏览的网址到收藏夹">🔖 收藏</button>
        <button class="btn sm" id="wg-devtools" title="打开网页 DevTools(独立窗口, 可查看网络/控制台/元素)">&lt;/&gt;</button>
        <span class="wg-tbsep"></span>
        <button class="btn sm" id="wg-mute" title="网页音频播放中 — 点击静音">🔊</button>
        <button class="btn sm" id="wg-toggle-side" title="隐藏侧栏区">🗂 隐藏侧栏</button>
      </div>
      <div class="wg-browser-scroll" id="wg-browser-scroll">
        <div class="wg-browser" id="wg-browser">
          <div class="wg-browser-hint" id="wg-hint">🌐 输入 URL 后点击「打开」, 网页将在此区域运行;<br/>所有网络请求会被自动拦截识别为 FGUI / Spine / 图片 / 音频 等资源;<br/>页面内容超出时可滚动查看。</div>
        </div>
      </div>
      <div class="wg-hsplit" id="wg-hsplit" title="拖动调整浏览器/下方区域高度比例"></div>
      <div class="wg-side">
        <div class="wg-side-tabs">
          <button class="wg-stab active" data-panel="capture">📡 资源捕获</button>
          <button class="wg-stab" data-panel="bookmark">🔖 网址收藏夹</button>
        </div>
        <div class="wg-panel" data-panel="capture">
          <div class="wg-filter" id="wg-filter">
            <div class="wg-chips" id="wg-chips"></div>
            <span class="wg-filter-count" id="wg-count">0 条</span>
            <label class="wg-selall" title="全选/取消全选当前筛选的资源"><input type="checkbox" id="wg-selall" /> 全选</label>
            <span class="wg-selcount" id="wg-selcount">已选 0</span>
            <label class="wg-filter-onlyurl"><input type="checkbox" id="wg-onlyurl" title="只下载选中, 不入库"> 仅下载不入库</label>
          </div>
          <div class="wg-list" id="wg-list"><div class="wg-empty">尚未捕获资源 — 打开网页后, 加载的资源会实时出现在这里</div></div>
          <div class="wg-actions">
            <span class="wg-actions-label">输出目录</span>
            <input class="wg-dir" id="wg-dir" type="text" placeholder="选择保存目录(留空则仅记录 URL)" spellcheck="false" />
            <button class="btn sm" id="wg-pickdir">📁 选择</button>
            <span class="wg-tbsep"></span>
            <button class="btn sm primary" id="wg-dl-sel" title="下载选中项并按类型入库">⬇ 下载选中</button>
            <button class="btn sm" id="wg-dl-all" title="下载全部可下载类型(fgui/spine/image/audio)">⬇ 下载全部</button>
            <button class="btn sm" id="wg-clear" title="清空捕获列表">🗑 清空</button>
          </div>
          <div class="wg-progress" id="wg-progress" hidden>
            <div class="wg-progress-bar"><div class="wg-progress-fill" id="wg-progress-fill"></div></div>
            <span class="wg-progress-text" id="wg-progress-text"></span>
          </div>
        </div>
        <div class="wg-panel" data-panel="bookmark" hidden>
          <div class="wg-bm-toolbar">
            <button class="btn sm primary" id="wg-bm-add-url" title="新增收藏网址">＋ 收藏网址</button>
            <button class="btn sm" id="wg-bm-add-cat" title="新建收藏夹子目录">＋ 新建目录</button>
            <span class="wg-bm-catname" id="wg-bm-catname">未分类</span>
          </div>
          <div class="wg-list wg-bm-list" id="wg-bm-list"><div class="wg-empty">收藏夹为空 — 点「＋ 收藏网址」添加</div></div>
          <div class="wg-bm-hint">💡 侧栏「网址收藏夹」也可管理分类与网址;点网址可直达浏览。</div>
        </div>
      </div>
    </div>
    <div class="wg-ctxmenu" id="wg-ctxmenu" hidden></div>
  `;

  const urlEl = container.querySelector('#wg-url');
  const statusEl = container.querySelector('#wg-status');
  const hintEl = container.querySelector('#wg-hint');
  const browserScrollEl = container.querySelector('#wg-browser-scroll');
  const browserEl = container.querySelector('#wg-browser');
  const listEl = container.querySelector('#wg-list');
  const countEl = container.querySelector('#wg-count');
  const filterEl = container.querySelector('#wg-chips');
  const dirEl = container.querySelector('#wg-dir');
  const progressEl = container.querySelector('#wg-progress');
  const progressFill = container.querySelector('#wg-progress-fill');
  const progressText = container.querySelector('#wg-progress-text');
  const onlyUrlEl = container.querySelector('#wg-onlyurl');
  const bmListEl = container.querySelector('#wg-bm-list');
  const bmCatnameEl = container.querySelector('#wg-bm-catname');
  const selAllEl = container.querySelector('#wg-selall');
  const selCountEl = container.querySelector('#wg-selcount');
  const ctxMenuEl = container.querySelector('#wg-ctxmenu');

  // ---- 面板切换(资源捕获 / 网址收藏夹) ----
  const setPanel = (panel) => {
    curPanel = panel;
    container.querySelectorAll('.wg-stab').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
    container.querySelectorAll('.wg-panel').forEach((p) => { p.hidden = p.dataset.panel !== panel; });
    if (panel === 'capture') container._webGameSyncBounds && container._webGameSyncBounds();
    else window.api.webSetBounds({ width: 0, height: 0 }); // 收藏夹面板下隐藏浏览器视图
    renderBookmarks();
  };
  container.querySelectorAll('.wg-stab').forEach((b) => b.addEventListener('click', () => setPanel(b.dataset.panel)));

  // ---- 布局: 浏览器区与下方区域上下分割(可拖动) ----
  // 注意: .wg-browser 使用 flex:0 0 auto + height 控制(非 flex-basis), 拖动改 height 才生效
  const splitEl = container.querySelector('#wg-hsplit');
  splitEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = browserScrollEl.offsetHeight;
    const maxH = container.offsetHeight - 300;
    const onMove = (ev) => {
      const h = Math.min(Math.max(120, startH + (ev.clientY - startY)), maxH);
      browserScrollEl.style.height = h + 'px';
      browserScrollEl.style.flexBasis = 'auto';
      container._webGameSyncBounds && container._webGameSyncBounds();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // ---- 上报浏览器视图矩形(WebContentsView native 叠加需要) ----
  container._webGameSyncBounds = () => {
    if (curPanel !== 'capture') return;
    const rect = browserEl.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
      window.api.webSetBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }
  };
  window.addEventListener('resize', container._webGameSyncBounds);

  // ---- 类型筛选 chips ----
  const renderFilter = () => {
    filterEl.innerHTML = TYPE_GROUP.map((t) => {
      const active = filter.has(t);
      return `<button class="chip ${active ? 'on' : ''}" data-type="${t}" style="--chip-color:${typeColor[t] || '#888'}">${typeLabel[t] || t}</button>`;
    }).join('');
    filterEl.querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => {
        const t = c.dataset.type;
        if (filter.has(t)) filter.delete(t); else filter.add(t);
        c.classList.toggle('on', filter.has(t));
        renderList();
      });
    });
  };
  renderFilter();

  // ---- 捕获列表渲染 ----
  const shownRecords = () => {
    if (onlyUrlEl.checked) return records;
    return records.filter((r) => filter.has(r.type));
  };
  const DOWNLOADABLE = ['fgui', 'spine', 'spine-json', 'spine-skel', 'spine-atlas', 'image', 'audio', 'video', 'bin'];

  // ---- 选中状态 UI 同步 ----
  const updateSelUI = () => {
    const shown = shownRecords();
    let n = 0;
    for (const r of shown) if (selected.has(r.url)) n++;
    selCountEl.textContent = `已选 ${n}`;
    if (shown.length && n === shown.length) { selAllEl.checked = true; selAllEl.indeterminate = false; }
    else if (n > 0) { selAllEl.checked = false; selAllEl.indeterminate = true; }
    else { selAllEl.checked = false; selAllEl.indeterminate = false; }
  };

  // ---- 捕获列表渲染(含勾选框 + 图片缩略图) ----
  const renderList = () => {
    const shown = shownRecords();
    countEl.textContent = `${shown.length} 条 / 共 ${records.length} 条`;
    if (!shown.length) {
      listEl.innerHTML = '<div class="wg-empty">当前筛选无资源 — 打开网页后, 加载的资源会实时出现在这里</div>';
      updateSelUI();
      return;
    }
    const byUrl = new Map(shown.map((r) => [r.url, r]));
    listEl.innerHTML = shown.map((r) => `
      <div class="wg-row" data-url="${esc(r.url)}" data-type="${r.type}">
        <input type="checkbox" class="wg-sel" data-url="${esc(r.url)}" ${selected.has(r.url) ? 'checked' : ''} title="选择此项" />
        <span class="wg-type" style="background:${typeColor[r.type] || '#666'}">${typeLabel[r.type] || r.type}</span>
        ${r.type === 'image' ? `<img class="wg-thumb" loading="lazy" src="${esc(r.url)}" data-url="${esc(r.url)}" alt="" title="缩略图" />` : ''}
        <span class="wg-file" title="${esc(r.url)}">${esc(fileNameOf(r.url))}</span>
        <span class="wg-urltext" title="${esc(r.url)}">${esc(r.url)}</span>
        <span class="wg-size">${r.size ? fmtSize(r.size) : '?'}</span>
        <span class="wg-state ${r.downloaded ? 'ok' : ''}" id="wg-state-${r.id}">${r.downloaded ? '✓ 已下载' : (r.path ? '本地' : '')}</span>
      </div>
    `).join('');
    listEl.querySelectorAll('.wg-row').forEach((row) => {
      const u = row.dataset.url;
      const rec = byUrl.get(u);
      const cb = row.querySelector('.wg-sel');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (e.target.checked) selected.add(u); else selected.delete(u);
        updateSelUI();
      });
      const thumb = row.querySelector('.wg-thumb');
      if (thumb) {
        thumb.addEventListener('click', (e) => e.stopPropagation());
        thumb.addEventListener('error', async () => {
          const d = await loadMediaPreview(rec);
          if (d) thumb.src = d;
        });
      }
      row.addEventListener('click', () => { if (u) copyText(u); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (rec) showCtxMenu(rec, e.clientX, e.clientY); });
      row.addEventListener('mouseenter', (e) => { if (rec) schedulePreview(rec, e); });
      row.addEventListener('mouseleave', () => { if (rec) cancelPreview(); });
    });
    updateSelUI();
  };

  // ---- 临时预览目录(主进程 userData 下) ----
  let _userData = '';
  const ensureTempDir = async () => {
    if (!_userData) { const info = await window.api.appInfo(); _userData = (info && info.userData) || ''; }
    return `${_userData}/webgame_preview_cache`;
  };

  // ---- 右键菜单「保存...」 ----
  const ctxActions = (rec) => ([
    { label: '💾 保存此资源...', act: () => saveSingleRec(rec) },
    { label: '👁 预览', act: () => showPreview(rec) },
    { label: '🔗 复制 URL', act: () => copyText(rec.url) },
  ]);
  const showCtxMenu = (rec, x, y) => {
    ctxMenuEl.innerHTML = ctxActions(rec).map((a, i) => `<div class="wg-ctx-item" data-i="${i}">${a.label}</div>`).join('');
    ctxMenuEl.hidden = false;
    const mw = ctxMenuEl.offsetWidth, mh = ctxMenuEl.offsetHeight;
    ctxMenuEl.style.left = Math.min(x, window.innerWidth - mw - 6) + 'px';
    ctxMenuEl.style.top = Math.min(y, window.innerHeight - mh - 6) + 'px';
    ctxMenuEl.querySelectorAll('.wg-ctx-item').forEach((el) => {
      el.addEventListener('click', () => { ctxMenuEl.hidden = true; ctxActions(rec)[+el.dataset.i].act(); });
    });
  };
  document.addEventListener('click', (e) => { if (!ctxMenuEl.hidden && !ctxMenuEl.contains(e.target)) ctxMenuEl.hidden = true; });
  window.addEventListener('scroll', () => { if (!ctxMenuEl.hidden) ctxMenuEl.hidden = true; }, true);

  const saveSingleRec = async (rec) => {
    if (!downloadRoot) { toast('请先选择输出目录(顶栏「选择」)', 'warn'); return; }
    const r = await downloadOne(rec);
    if (r.ok) {
      toast('已保存: ' + fileNameOf(rec.url));
      if (!onlyUrlEl.checked) { const msg = await importToLibrary(rec, r.path); if (msg) toast(msg); }
    } else toast('保存失败: ' + ((r && r.error) || ''), 'warn');
  };

  // ---- 悬浮预览窗: 独立窗口(像 DevTools detach, 由主进程 webPreviewWindow 管理) ----
  // 悬停资源行 → 显示独立预览窗并推送内容; 移出(未置顶)自动隐藏;
  // 点击进入预览窗自动置顶常驻(不自动消失); 预览窗内 📌 切换 alwaysOnTop。
  let pvTimer = null, pvRec = null, pvPinned = false, pvHoveringRow = false;
  const schedulePreview = (rec) => {
    pvRec = rec; pvHoveringRow = true;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => { if (pvRec) showPreview(pvRec); }, 350);
  };
  const cancelPreview = () => {
    pvHoveringRow = false;
    if (pvPinned) return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => { if (!pvHoveringRow && !pvPinned) hidePreview(); }, 280);
  };
  const showPreview = (rec) => {
    pvRec = rec;
    window.api.webPreviewShow({
      type: rec.type, url: rec.url, name: fileNameOf(rec.url),
      size: rec.size || 0, referrer: rec.referrer || '', host: rec.host || '',
    });
  };
  const hidePreview = () => {
    if (pvPinned) return;
    window.api.webPreviewHide();
  };
  // 预览窗事件: 置顶状态(点击进入预览窗自动置顶) / 被用户关闭 / 预览窗内按钮动作
  window.api.onWebPreviewPinState((d) => { pvPinned = !!(d && d.pinned); });
  window.api.onWebPreviewClosed(() => { pvPinned = false; });
  window.api.onWebPreviewAction((d) => {
    if (!d || !d.payload) return;
    const rec = records.find((r) => r.url === d.payload.url);
    if (!rec) return;
    if (d.action === 'save') saveSingleRec(rec);
    else if (d.action === 'fgui') openFguiPreview(rec);
    else if (d.action === 'spine') openSpinePreview(rec);
  });

  const openFguiPreview = async (rec) => {
    const dir = await ensureTempDir();
    const sp = `${dir}/${safeName(fileNameOf(rec.url) || 'pkg')}.bin`;
    const r = await window.api.webDownload({ url: rec.url, savePath: sp, referrer: rec.referrer, type: 'bin' });
    if (r && r.ok) {
      document.dispatchEvent(new CustomEvent('scene:navigate', { detail: { to: 'fgui-editor', binPath: sp } }));
      return true;
    }
    return false;
  };
  const openSpinePreview = async (rec) => {
    const dir = await ensureTempDir();
    const base = (fileNameOf(rec.url).split('?')[0].replace(/\.[^.]+$/, '')) || 'spine';
    const mainPath = `${dir}/${safeName(fileNameOf(rec.url))}`;
    const r = await window.api.webDownload({ url: rec.url, savePath: mainPath, referrer: rec.referrer, type: rec.type });
    if (!(r && r.ok)) { toast('下载失败', 'warn'); return; }
    const dirUrl = rec.url.replace(/\?.*$/, '').replace(/[^/]+$/, '');
    let atlasPath = null;
    for (const ae of [`${base}.atlas`, `${base}.atlas.txt`]) {
      const ap = `${dir}/${safeName(ae)}`;
      const ar = await window.api.webDownload({ url: dirUrl + ae, savePath: ap, referrer: rec.referrer, type: 'spine-atlas' }).catch(() => null);
      if (ar && ar.ok) { atlasPath = ap; break; }
    }
    if (atlasPath) {
      const t = await window.api.webFetchText({ url: dirUrl + base + '.atlas', maxBytes: 64 * 1024 }).catch(() => null);
      if (t && t.ok) {
        const m = t.text.split('\n').map((s) => s.trim()).find((s) => /\.(png|webp|ktx2?|astc)$/i.test(s));
        if (m) await window.api.webDownload({ url: dirUrl + m, savePath: `${dir}/${safeName(m)}`, referrer: rec.referrer, type: 'image' }).catch(() => null);
      }
    }
    const cat = findOrCreateCategoryByName('网页游戏预览', '');
    addItem({ categoryId: cat.id, type: 'spine', filePath: mainPath, atlasPath, displayName: base, remark: '来源: ' + rec.url, tags: ['webgame', 'temp-preview'], size: null, mtime: null });
    toast('已加入资源库(分类「网页游戏预览」), 可在「预览」页打开');
  };
  const fileNameOf = (url) => {
    try { const u = new URL(url); const b = decodeURIComponent(u.pathname.split('/').pop() || ''); return b || u.hostname; } catch (e) { return url; }
  };
  const copyText = async (t) => {
    try { await navigator.clipboard.writeText(t); toast('URL 已复制'); } catch (e) { /* ignore */ }
  };

  // ---- 状态/捕获/进度事件 ----
  window.api.onWebStatus((s) => {
    lastStatus = s.state || '';
    if (s.title) statusEl.textContent = s.title;
    else if (s.state === 'loading') statusEl.textContent = '加载中…';
    else if (s.state === 'idle') statusEl.textContent = '就绪';
    else if (s.state === 'navigated') statusEl.textContent = s.url || '';
  });
  window.api.onWebCaptured((rec) => {
    const existing = records.find((r) => r.url === rec.url);
    if (existing) Object.assign(existing, rec);
    else records.push(rec);
    renderList();
    hintEl.style.display = 'none';
  });
  window.api.onWebProgress((p) => {
    progressEl.hidden = false;
    progressFill.style.width = Math.min(100, p.percent || 0) + '%';
    progressText.textContent = `${fileNameOf(p.url)} ${fmtSize(p.got)}${p.total ? ' / ' + fmtSize(p.total) : ''} (${p.percent || 0}%)`;
  });
  window.api.onWebDownloadDone((d) => {
    // 兜底: 主进程 web:download 本身返回结果, 事件主要用于多任务通知(保留)
  });

  // ---- 打开 / 停止 / 导航 ----
  const openGame = async () => {
    const url = (urlEl.value || '').trim();
    if (!url) { toast('请输入网址', 'warn'); return; }
    setSetting('webGameLastUrl', url);
    const hist = (state.settings.webGameHistory || []).filter((h) => h.url !== url);
    hist.unshift({ url, title: (() => { try { return new URL(url).hostname; } catch (e) { return url; } })(), openedAt: Date.now() });
    setSetting('webGameHistory', hist.slice(0, 20));
    const r = await window.api.webOpen(url, { ua: undefined, proxy: state.settings.webGameProxy || undefined });
    if (r && r.ok) {
      statusEl.textContent = '已打开';
      hintEl.style.display = 'none';
      setPanel('capture');
      container._webGameSyncBounds();
    } else {
      toast((r && r.error) || '打开失败', 'warn');
    }
  };
  urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openGame(); });
  container.querySelector('#wg-open').addEventListener('click', openGame);
  container.querySelector('#wg-stop').addEventListener('click', async () => {
    await window.api.webClose();
    statusEl.textContent = '已停止(捕获记录保留)';
  });
  container.querySelector('#wg-back').addEventListener('click', () => window.api.webGoBack());
  container.querySelector('#wg-fwd').addEventListener('click', () => window.api.webGoForward());
  container.querySelector('#wg-reload').addEventListener('click', () => window.api.webReload());
  // DevTools: 独立窗口(detach)模式, 可观察网页网络请求/控制台/元素
  container.querySelector('#wg-devtools').addEventListener('click', async () => {
    const r = await window.api.webOpenDevTools('open');
    if (r && r.ok) toast('DevTools 已打开(独立窗口)');
    else toast((r && r.error) || '请先打开网页', 'warn');
  });
  // DevTools 关闭(工具提示)
  container.querySelector('#wg-devtools').addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    await window.api.webCloseDevTools();
    toast('DevTools 已关闭');
  });
  container.querySelector('#wg-clear').addEventListener('click', async () => {
    await window.api.webClearCaptured();
    records = [];
    selected.clear();
    renderList();
  });
  // 收藏当前浏览 URL
  container.querySelector('#wg-fav').addEventListener('click', () => {
    const u = (urlEl.value || '').trim();
    if (!u) { toast('请先输入/打开网址', 'warn'); return; }
    addWebBookmarkDialog(u);
  });

  // ---- 网页音频静音 / 取消禁音 切换 ----
  const muteBtn = container.querySelector('#wg-mute');
  let audioMuted = false;
  const setMuteBtn = (muted) => {
    muteBtn.innerHTML = muted ? '🔇' : '🔊';
    muteBtn.title = muted ? '网页音频已静音 — 点击取消禁音' : '网页音频播放中 — 点击静音';
    muteBtn.classList.toggle('muted', muted);
  };
  muteBtn.addEventListener('click', async () => {
    const next = !audioMuted;
    const r = await window.api.webSetAudioMuted(next);
    // 即使网页尚未打开(返回 not opened), 也按用户意图切换 UI 状态, 打开时会继承该静音状态
    audioMuted = (r && r.ok) ? !!r.muted : next;
    setMuteBtn(audioMuted);
  });

  // ---- 侧栏区 隐藏 / 显示 切换 ----
  const sideEl = container.querySelector('.wg-side');
  const sideBtn = container.querySelector('#wg-toggle-side');
  let sideHidden = false;
  const setSideBtn = (hidden) => {
    sideBtn.innerHTML = hidden ? '👁 显示侧栏' : '🗂 隐藏侧栏';
    sideBtn.title = hidden ? '显示侧栏区' : '隐藏侧栏区';
    sideBtn.classList.toggle('side-hidden', hidden);
  };
  sideBtn.addEventListener('click', () => {
    sideHidden = !sideHidden;
    if (sideHidden) {
      // 折叠侧栏高度(≈0), 浏览器区 flex:1 占据空出区域
      sideEl.style.flex = '0 0 1px';
      sideEl.style.overflow = 'hidden';
      browserScrollEl.style.flex = '1 1 auto';
      browserScrollEl.style.height = 'auto';
    } else {
      // 还原: 浏览器固定 46%, 侧栏 flex:1
      sideEl.style.flex = '';
      sideEl.style.overflow = '';
      browserScrollEl.style.flex = '';
      browserScrollEl.style.height = '';
    }
    setSideBtn(sideHidden);
    // 浏览器区域尺寸变化, 重新上报视图矩形(WebContentsView 跟随缩放)
    container._webGameSyncBounds && container._webGameSyncBounds();
  });

  // ---- 输出目录 ----
  container.querySelector('#wg-pickdir').addEventListener('click', async () => {
    const r = await window.api.pickDirs();
    if (r && !r.canceled && r.filePaths && r.filePaths.length) {
      downloadRoot = r.filePaths[0];
      dirEl.value = downloadRoot;
      setSetting('webGameSaveDir', downloadRoot);
    }
  });

  // ---- 下载 ----
  const gameNameOf = async (url) => {
    try {
      const u = new URL(url);
      const last = u.pathname.split('/').filter(Boolean).pop() || '';
      const gid = u.searchParams.get('gameId') || u.searchParams.get('game_id');
      if (gid) return `game_${gid}`;
      return last.replace(/\.html?$/i, '') || u.hostname;
    } catch (e) { return 'game'; }
  };

  const downloadOne = async (rec) => {
    if (!downloadRoot) return { ok: false, error: '未设置输出目录' };
    const rel = relPathForUrl(rec.url, rec.type);
    const base = pathBase(rel);
    const fname = pathName(rel) || fileNameOf(rec.url);
    const safeFname = safeName(fname);
    const saveDir = `${downloadRoot}/${safeName((await gameNameOf(rec.url)) || 'game')}/${typeDirName(rec.type)}/${base}`.replace(/\/+/g, '/');
    let savePath = `${saveDir}/${safeFname}`;
    let i = 1;
    while (await fsExists(savePath)) savePath = `${saveDir}/${i++}_${safeFname}`;
    const r = await window.api.webDownload({
      url: rec.url,
      savePath,
      referrer: rec.referrer,
      type: rec.type,
    });
    if (r && r.ok) {
      rec.downloaded = true;
      rec.path = r.path;
      rec.downloadType = r.type || rec.type;
      renderList();
      return { ok: true, rec, path: r.path, type: r.type || rec.type };
    }
    return { ok: false, error: (r && r.error) || '下载失败', rec };
  };
  const pathBase = (rel) => rel.split('/').slice(0, -1).join('/');
  const pathName = (rel) => rel.split('/').pop();
  const fsExists = async (p) => { try { return !!(await window.api.statFile(p)); } catch (e) { return false; } };
  const typeDirName = (t) => ({ fgui: 'fgui', spine: 'spine', 'spine-json': 'spine', 'spine-skel': 'spine', 'spine-atlas': 'spine', image: 'image', audio: 'audio', video: 'video', font: 'font', config: 'config', bin: 'fgui' }[t] || 'other');

  // ---- 入库 ----
  const importToLibrary = async (rec, savePath) => {
    const type = rec.downloadType || rec.type;
    try {
      const st = await window.api.statFile(savePath);
      const size = st ? st.size : null;
      const mtime = st ? st.mtime : null;
      if (type === 'fgui' || type === 'bin') {
        const catName = (await gameNameOf(rec.url)) || '网页游戏';
        let catId = '';
        const found = state.sceneCategories.find((c) => c.name === catName);
        if (found) catId = found.id;
        else catId = addSceneCategory({ name: catName }).id;
        addScene({ categoryId: catId, name: fileNameOf(rec.url).replace(/\.[^.]+$/, ''), filePath: savePath, type: 'file', subtype: 'fgui', remark: '来源: ' + rec.url, tags: ['webgame', rec.host || ''], size, mtime });
        return `FGUI 已入库场景「${catName}」`;
      }
      const cat = findOrCreateCategoryByName((await gameNameOf(rec.url)) || '网页游戏', '');
      const itemType = type === 'spine' || type === 'spine-json' || type === 'spine-skel' ? 'spine'
        : (type === 'image' ? 'image' : (type === 'audio' ? 'audio' : null));
      if (!itemType) return null;
      let atlasPath = null;
      if (itemType === 'spine') {
        const base = pathBase(savePath);
        const name = pathName(savePath).replace(/\.[^.]+$/, '');
        for (const ap of [`${base}/${name}.atlas`, `${base}/${name}.atlas.txt`]) {
          const st2 = await window.api.statFile(ap);
          if (st2) { atlasPath = ap; break; }
        }
      }
      addItem({
        categoryId: cat.id,
        type: itemType,
        filePath: savePath,
        atlasPath,
        displayName: fileNameOf(rec.url).replace(/\.[^.]+$/, ''),
        remark: '来源: ' + rec.url,
        tags: ['webgame', rec.host || ''],
        size,
        mtime,
      });
      return `${typeLabel[type] || type} 已入库`;
    } catch (e) {
      return '入库失败: ' + e.message;
    }
  };

  const downloadAndImport = async (targets) => {
    if (!downloadRoot) { toast('请先选择输出目录', 'warn'); return; }
    let ok = 0, fail = 0;
    progressEl.hidden = false;
    for (const rec of targets) {
      const r = await downloadOne(rec);
      if (r.ok) {
        ok++;
        if (!onlyUrlEl.checked) {
          const msg = await importToLibrary(rec, r.path);
          if (msg) toast(msg);
        }
      } else {
        fail++;
      }
    }
    progressEl.hidden = true;
    progressFill.style.width = '0%';
    progressText.textContent = '';
    toast(`下载完成: 成功 ${ok} / 失败 ${fail}`);
  };

  container.querySelector('#wg-dl-sel').addEventListener('click', () => {
    const targets = shownRecords().filter((r) => selected.has(r.url) && r.downloaded !== true && DOWNLOADABLE.includes(r.type));
    if (!targets.length) { toast('请先勾选要下载的资源(复选框)', 'warn'); return; }
    downloadAndImport(targets);
  });
  selAllEl.addEventListener('change', () => {
    const shown = shownRecords();
    if (selAllEl.checked) shown.forEach((r) => selected.add(r.url));
    else shown.forEach((r) => selected.delete(r.url));
    renderList();
  });
  container.querySelector('#wg-dl-all').addEventListener('click', () => {
    const targets = records.filter((r) => r.downloaded !== true && ['fgui', 'spine', 'image', 'audio', 'spine-json', 'spine-skel', 'spine-atlas'].includes(r.type));
    if (!targets.length) { toast('没有可下载的资源', 'warn'); return; }
    downloadAndImport(targets);
  });

  // ---- 网址收藏夹面板 ----
  const catPathName = (catId) => {
    if (!catId) return '未分类';
    const cat = webBookmarkCategoryById(catId);
    return cat ? cat.name : '未分类';
  };
  const renderBookmarks = () => {
    bmCatnameEl.textContent = catPathName(curBmCat);
    const list = webBookmarksInCategory(curBmCat);
    if (!list.length) {
      bmListEl.innerHTML = '<div class="wg-empty">该分类下暂无收藏网址</div>';
      return;
    }
    bmListEl.innerHTML = list.map((b) => `
      <div class="wg-row" data-bm-id="${b.id}">
        <span class="wg-type" style="background:#ff9c5c">🔖</span>
        <span class="wg-file" title="${esc(b.url)}">${esc(b.name || b.url)}</span>
        <span class="wg-urltext" title="${esc(b.url)}">${esc(b.url)}</span>
        <span class="wg-bm-ops">
          <button class="btn sm" data-bm-open title="打开">▶</button>
          <button class="btn sm" data-bm-edit title="编辑">✎</button>
          <button class="btn sm" data-bm-del title="删除">🗑</button>
        </span>
      </div>
    `).join('');
    bmListEl.querySelectorAll('.wg-row').forEach((row) => {
      const id = row.dataset.bmId;
      row.querySelector('[data-bm-open]').addEventListener('click', (e) => {
        e.stopPropagation();
        const b = webBookmarkById(id);
        if (b) openUrl(b.url);
      });
      row.querySelector('[data-bm-edit]').addEventListener('click', (e) => {
        e.stopPropagation();
        editWebBookmarkDialog(id);
      });
      row.querySelector('[data-bm-del]').addEventListener('click', (e) => {
        e.stopPropagation();
        removeWebBookmarkDialog(id);
      });
      row.addEventListener('click', () => {
        const b = webBookmarkById(id);
        if (b) copyText(b.url);
      });
    });
  };
  const addWebBookmarkDialog = (currentUrl) => {
    promptDialog({
      title: '收藏网址',
      fields: [
        { key: 'url', label: '网址', type: 'text', value: currentUrl || '' },
        { key: 'name', label: '名称(可空,默认取网址)', type: 'text', value: '' },
      ],
      onOk: ({ url, name }) => {
        const u = (url || '').trim();
        if (!u) return toast('网址不能为空', 'error');
        addWebBookmark({ categoryId: curBmCat, url: u, name: (name || '').trim() });
        renderBookmarks();
        toast('已收藏网址');
      },
    });
  };
  const editWebBookmarkDialog = (id) => {
    const bm = webBookmarkById(id);
    if (!bm) return;
    promptDialog({
      title: '编辑收藏网址',
      fields: [
        { key: 'name', label: '名称', type: 'text', value: bm.name || '' },
        { key: 'url', label: '网址', type: 'text', value: bm.url || '' },
      ],
      onOk: ({ name, url }) => {
        if (!(url || '').trim()) return toast('网址不能为空', 'error');
        updateWebBookmark(id, { name: (name || '').trim() || url, url: (url || '').trim() });
        renderBookmarks();
        toast('收藏网址已更新');
      },
    });
  };
  const removeWebBookmarkDialog = (id) => {
    const bm = webBookmarkById(id);
    if (!bm) return;
    confirmDialog({
      title: `删除收藏网址「${bm.name || bm.url}」?`,
      message: '',
      onOk: () => { removeWebBookmark(id); renderBookmarks(); toast('已删除收藏网址'); },
    });
  };
  const addBookmarkCategoryDialog = () => {
    promptDialog({
      title: '新建收藏夹子目录',
      fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
      onOk: ({ name }) => {
        if (!name) return toast('目录名称不能为空', 'error');
        addWebBookmarkCategory({ name, parentId: curBmCat });
        renderBookmarks();
        toast('已创建收藏夹子目录');
      },
    });
  };
  container.querySelector('#wg-bm-add-url').addEventListener('click', () => addWebBookmarkDialog(''));
  container.querySelector('#wg-bm-add-cat').addEventListener('click', addBookmarkCategoryDialog);

  // ---- 侧栏联动回调 ----
  // 打开某分类收藏夹(切到收藏夹面板)
  container._webGameShowBookmarks = (catId) => {
    curBmCat = catId || '';
    setPanel('bookmark');
  };
  // 直接打开网址
  container._webGameOpenUrl = (url) => {
    if (url) { urlEl.value = url; setPanel('capture'); openGame(); }
  };
  // 回填 URL(最近历史点击)
  container._webGameSetUrl = (url) => {
    if (url) { urlEl.value = url; setPanel('capture'); openGame(); }
  };
  // 离开页面时隐藏浏览器视图(防止遮挡其它页); 同步隐藏独立预览窗
  container._webGameDetach = () => {
    window.api.webPreviewHide();
    window.api.webSetBounds({ width: 0, height: 0 });
  };

  // ---- 初始化: 恢复历史 URL / 输出目录 / 捕获记录 ----
  const init = async () => {
    await window.api.appInfo();
    if (state.settings && state.settings.webGameLastUrl) urlEl.value = state.settings.webGameLastUrl;
    if (state.settings && state.settings.webGameSaveDir) {
      downloadRoot = state.settings.webGameSaveDir;
      dirEl.value = downloadRoot;
    }
    const cap = await window.api.webGetCaptured();
    if (cap && cap.ok && cap.records) {
      records = cap.records.slice();
      if (records.length) hintEl.style.display = 'none';
      renderList();
    }
  };
  init();

  return container;
}
