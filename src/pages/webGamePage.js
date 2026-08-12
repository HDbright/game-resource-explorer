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

/** 是否为图片扩展名(无论归类到何种类型, 均显示缩略图) */
const isImageUrl = (u) => /\.(png|jpe?g|webp|gif|bmp|astc|tga|ktx2?)(\?|$)/i.test(u);

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
    // 重入: 若视图仍被「移至新窗口」悬浮在外, 折叠主窗口浏览器区(让位给下方侧栏)
    try {
      window.api.webIsFloated().then((d) => {
        if (d && d.floated) container.querySelector('.wg-wrap').classList.add('floated-out');
      }).catch(() => {});
    } catch (e) { /* ignore */ }
    return container;
  }
  container._webGameInited = true;

  let records = [];        // 捕获列表
  // 类型筛选(默认全选 fgui/spine/image/audio; 重启时恢复上次选择, localStorage 在启动时已初始化过, 此处访问不慢)
  let filter = new Set(['fgui', 'spine', 'image', 'audio']);
  try {
    const savedFilter = localStorage.getItem('wg-filter-types');
    if (savedFilter) {
      const arr = JSON.parse(savedFilter);
      if (Array.isArray(arr) && arr.length) filter = new Set(arr.filter((t) => TYPE_GROUP.includes(t)));
    }
  } catch (e) { /* ignore */ }
  let downloadRoot = '';   // 输出根目录
  let lastStatus = '';
  let curBmCat = 'all';    // 网址收藏夹当前分类('all' = 全部; 无"未分类"概念)
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
        <button class="btn sm" id="wg-toggle-side" title="隐藏侧栏区"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="1.5" width="12" height="13" rx="1.5"/><line x1="2" y1="11.5" x2="14" y2="11.5"/></svg></button>
      </div>
      <div class="wg-tabs" id="wg-tabs" hidden></div>
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
            <input type="search" class="wg-search" id="wg-search" placeholder="🔍 搜索文件名..." title="按文件名过滤捕获列表" spellcheck="false" />
            <label class="wg-filter-pv" title="开启/关闭 鼠标悬停资源时自动弹出悬浮预览窗"><input type="checkbox" id="wg-pv-switch" checked /> 悬浮预览</label>
            <label class="wg-filter-onlyurl"><input type="checkbox" id="wg-onlyurl" title="只下载选中, 不入库"> 仅下载不入库</label>
          </div>
          <div class="wg-list" id="wg-list"><div class="wg-empty">尚未捕获资源 — 打开网页后, 加载的资源会实时出现在这里</div></div>
          <div class="wg-actions">
            <span class="wg-actions-label">输出目录</span>
            <input class="wg-dir" id="wg-dir" type="text" placeholder="选择保存目录(留空则仅记录 URL)" spellcheck="false" />
            <button class="btn sm" id="wg-pickdir">📁 选择</button>
            <span class="wg-tbsep"></span>
            <button class="btn sm" id="wg-open-dir" title="用系统文件管理器打开下载目录">📂 打开目录</button>
            <button class="btn sm" id="wg-dl-sel" title="下载选中项并按类型入库">⬇ 下载选中</button>
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
  // 恢复上次勾选状态「仅下载不入库」并持久化(重启记住)
  try { if (localStorage.getItem('wg-only-url') === '1') onlyUrlEl.checked = true; } catch (e) { /* ignore */ }
  onlyUrlEl.addEventListener('change', () => {
    try { localStorage.setItem('wg-only-url', onlyUrlEl.checked ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  const pvSwitchEl = container.querySelector('#wg-pv-switch');
  const searchEl = container.querySelector('#wg-search');
  const tabsEl = container.querySelector('#wg-tabs');
  const bmListEl = container.querySelector('#wg-bm-list');
  const bmCatnameEl = container.querySelector('#wg-bm-catname');
  const selAllEl = container.querySelector('#wg-selall');
  const selCountEl = container.querySelector('#wg-selcount');
  const ctxMenuEl = container.querySelector('#wg-ctxmenu');

  // ---- 面板切换(资源捕获 / 网址收藏夹) ----
  // keepBrowser: 左侧树点击收藏夹目录进入时保留浏览器视图(网页已打开时不黑屏);
  // 内部 tab 点击仍按原逻辑隐藏浏览器(0×0), 用户主动聚焦收藏夹面板。
  let keepBrowser = false;
  const setPanel = (panel, keepBrowserInPanel = false) => {
    curPanel = panel;
    keepBrowser = !!keepBrowserInPanel;
    container.querySelectorAll('.wg-stab').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
    container.querySelectorAll('.wg-panel').forEach((p) => { p.hidden = p.dataset.panel !== panel; });
    if (panel === 'capture' || keepBrowser) container._webGameSyncBounds && container._webGameSyncBounds();
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
    if (curPanel !== 'capture' && !keepBrowser) return; // 收藏夹面板保留浏览器视图时仍需同步
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
        try { localStorage.setItem('wg-filter-types', JSON.stringify([...filter])); } catch (e) { /* ignore */ }
        renderList();
      });
    });
  };
  renderFilter();

  // 搜索过滤: 按文件名(忽略大小写)实时过滤捕获列表
  searchEl.addEventListener('input', () => {
    searchText = searchEl.value.trim();
    try { localStorage.setItem('wg-search', searchText); } catch (e) { /* ignore */ }
    renderList();
  });

  // ---- 捕获列表渲染 ----
  // 搜索过滤: 按文件名(忽略大小写); 重启时恢复上次搜索词
  let searchText = '';
  try { searchText = localStorage.getItem('wg-search') || ''; } catch (e) { /* ignore */ }
  searchEl.value = searchText;
  const shownRecords = () => {
    // 始终按类型筛选 chips 过滤(「仅下载不入库」只影响下载后是否入库, 不影响列表显示;
    // 修复: 之前仅下载不入库勾选时列表无视类型筛选显示全部, 导致点击类型按钮无法筛选)
    const base = records.filter((r) => filter.has(r.type));
    if (!searchText) return base;
    const kw = searchText.toLowerCase();
    return base.filter((r) => fileNameOf(r.url).toLowerCase().includes(kw));
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

  // ---- 资源归类修正 ----
  // ① .bin/.fui → fgui(FGUI 包); ② 部分 .bin 实为 spine .skel 改后缀,
  // 其同名(同目录同 base 名)的 .bin/.skel/.atlas/.astc/.png 配套资源统一归 spine。
  // ③ 参考 AIX 下载插件的「资源组」思路: spine 组内 .png 作为整组骨骼动画的预览图;
  //    .atlas/.atlas.txt/.png/.astc 标记 groupOnly —— 随主文件整组保存, 不再单独入库(避免重复)。
  const SPINE_SIB_EXT = new Set(['.bin', '.skel', '.atlas', '.atlas.txt', '.astc', '.png']);
  const SPINE_MAIN_EXT = new Set(['.skel', '.json', '.bin', '.sk']); // spine 骨骼数据主文件
  const urlKeyOf = (url) => {
    const pathPart = (url.split('?')[0].split('#')[0]);
    const slash = pathPart.lastIndexOf('/');
    const dir = slash >= 0 ? pathPart.slice(0, slash) : '';
    let fname = slash >= 0 ? pathPart.slice(slash + 1) : pathPart;
    let base, ext;
    if (/\.atlas\.txt$/i.test(fname)) { base = fname.slice(0, -10); ext = '.atlas.txt'; }
    else {
      const m = fname.match(/^(.*?)(\.[a-zA-Z0-9]+)?$/);
      base = (m && m[1]) || fname;
      ext = (m && m[2] ? m[2].toLowerCase() : '');
    }
    return { key: dir + '\u0000' + base, dir, base, ext };
  };
  const fixRecordTypes = () => {
    // 1) 按 (目录, base 名) 分组, 记录组内扩展名集合
    const groups = new Map(); // key -> Set(ext)
    for (const r of records) {
      const { key, ext } = urlKeyOf(r.url);
      if (!ext) continue;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(ext);
    }
    // 2) spine 组 = 组内含 .skel 或 .atlas(.txt)
    const spineGroups = new Set();
    for (const [key, exts] of groups) {
      if (exts.has('.skel') || exts.has('.atlas') || exts.has('.atlas.txt')) spineGroups.add(key);
    }
    // 3) 逐条归类
    for (const r of records) {
      const { key, ext } = urlKeyOf(r.url);
      if (!ext) continue;
      if (spineGroups.has(key)) {
        if (SPINE_SIB_EXT.has(ext)) r.type = 'spine'; // skel 改名的 bin 及配套 atlas/astc/png
      } else if (ext === '.bin' || ext === '.fui') {
        r.type = 'fgui';
      }
    }
    // 4) 预览图 + 配套标记
    const thumbByKey = new Map(); // key -> 组内第一个 png url
    for (const r of records) {
      const { key, ext } = urlKeyOf(r.url);
      if (ext === '.png' && !thumbByKey.has(key)) thumbByKey.set(key, r.url);
    }
    for (const r of records) {
      const { key, ext } = urlKeyOf(r.url);
      if (r.type === 'spine' || r.type === 'spine-skel' || r.type === 'spine-atlas') {
        if (thumbByKey.has(key)) r.thumb = thumbByKey.get(key); // 骨骼动画预览图
        if (r.type === 'spine' && !SPINE_MAIN_EXT.has(ext)) r.groupOnly = true;
      }
    }
  };

  // ---- 捕获列表渲染(含勾选框 + 图片缩略图) ----
  // 缩略图直连失败 → 用网页分区 session 下载转 data URL 兜底; 内存缓存避免重复下载
  const thumbCache = new Map(); // url -> {ok,dataUrl}
  const renderList = () => {
    const shown = shownRecords();
    countEl.textContent = `${shown.length} 条 / 共 ${records.length} 条`;
    if (!shown.length) {
      listEl.innerHTML = '<div class="wg-empty">当前筛选无资源 — 打开网页后, 加载的资源会实时出现在这里</div>';
      updateSelUI();
      return;
    }
    const byUrl = new Map(shown.map((r) => [r.url, r]));
    listEl.innerHTML = shown.map((r) => {
      const thumbSrc = r.thumb || (isImageUrl(r.url) ? r.url : '');
      return `
      <div class="wg-row" data-url="${esc(r.url)}" data-type="${r.type}">
        <input type="checkbox" class="wg-sel" data-url="${esc(r.url)}" ${selected.has(r.url) ? 'checked' : ''} title="选择此项" />
        <span class="wg-type" style="background:${typeColor[r.type] || '#666'}">${typeLabel[r.type] || r.type}</span>
        <span class="wg-thumbwrap">
          ${thumbSrc ? `<img class="wg-thumb" loading="lazy" src="${esc(thumbSrc)}" data-url="${esc(r.url)}" data-thumb="${esc(thumbSrc)}" alt="" title="缩略图" />` : ''}
          <button class="wg-playbtn" title="在悬浮预览窗中播放预览" data-url="${esc(r.url)}">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M8 5v14l11-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
        </span>
        <span class="wg-file" title="${esc(r.url)}">${esc(fileNameOf(r.url))}</span>
        <span class="wg-urltext" title="${esc(r.url)}">${esc(r.url)}</span>
        <span class="wg-size">${r.size ? fmtSize(r.size) : '?'}</span>
        <span class="wg-state ${r.downloaded ? 'ok' : ''}" id="wg-state-${r.id}">${r.downloaded ? '✓ 已下载' : (r.path ? '本地' : '')}</span>
      </div>
    `;
    }).join('');
    listEl.querySelectorAll('.wg-row').forEach((row) => {
      const u = row.dataset.url;
      const rec = byUrl.get(u);
      // 播放按钮: 点击在悬浮预览窗中播放预览(不受「悬浮预览」开关限制, 显式触发)
      const playBtn = row.querySelector('.wg-playbtn');
      if (playBtn) playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (rec) showPreview(rec);
      });
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
          // 直连失败(跨 session 无登录态 / 防盗链 403):
          // 用网页分区 session(persist:webgame, 共享 cookie/Referer) 下载转 data URL 兜底
          if (thumb.dataset.tried) return; // 已兜底过一次, 防止 error 反复触发死循环
          thumb.dataset.tried = '1';
          // spine 预览图可能是同组 png URL(非本记录 URL), 兜底需下载该图本身
          const thumbUrl = thumb.dataset.thumb || rec.url;
          let d = thumbCache.get(thumbUrl);
          if (!d) {
            d = await window.api.webThumbFetch({ url: thumbUrl, referrer: rec.referrer || '' }).catch(() => null);
            if (d && d.ok) thumbCache.set(thumbUrl, d);
          }
          if (d && d.ok) thumb.src = d.dataUrl;
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

  // ---- 右键菜单(资源行 / 收藏夹行通用) ----
  let ctxMenuAct = [];
  const showMenu = (items, x, y) => {
    ctxMenuAct = items || [];
    ctxMenuEl.innerHTML = ctxMenuAct.map((a, i) => `<div class="wg-ctx-item" data-i="${i}">${a.label}</div>`).join('');
    ctxMenuEl.hidden = false;
    const mw = ctxMenuEl.offsetWidth, mh = ctxMenuEl.offsetHeight;
    ctxMenuEl.style.left = Math.min(x, window.innerWidth - mw - 6) + 'px';
    ctxMenuEl.style.top = Math.min(y, window.innerHeight - mh - 6) + 'px';
    ctxMenuEl.querySelectorAll('.wg-ctx-item').forEach((el) => {
      el.addEventListener('click', () => {
        ctxMenuEl.hidden = true;
        const it = ctxMenuAct[+el.dataset.i];
        if (it) it.act();
      });
    });
  };
  // 已下载资源: 用系统文件管理器打开其所在目录
  const openDownloadDir = async (rec) => {
    const p = rec.path || '';
    if (!p) { toast('该资源尚未下载', 'warn'); return; }
    const dir = p.replace(/[\\/][^\\/]*$/, '') || p;
    const r = await window.api.openPath(dir);
    if (r && r !== '') toast('打开目录失败: ' + r, 'warn');
  };
  let ctxMenuPos = null; // 右键菜单弹出位置(预览悬浮窗定位用)
  const ctxActions = (rec) => {
    const items = [
      { label: '💾 保存此资源...', act: () => saveSingleRec(rec) },
      { label: '📁 另存..', act: () => saveAsRec(rec) },
      { label: '👁 预览', act: () => showPreview(rec, ctxMenuPos || pvMouse) },
    ];
    // 已下载(含组内连带下载的配套) → 可打开所在目录
    if (rec.downloaded || rec.path) items.push({ label: '📂 打开下载目录', act: () => openDownloadDir(rec) });
    items.push({ label: '🔗 复制 URL', act: () => copyText(rec.url) });
    return items;
  };
  const showCtxMenu = (rec, x, y) => { ctxMenuPos = { x, y }; showMenu(ctxActions(rec), x, y); };
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

  // 另存..: 弹出目录选择器(默认定位到顶栏输出目录), 保存到用户指定位置(不改变顶栏输出目录)
  const saveAsRec = async (rec) => {
    const r = await window.api.pickDirs({ title: '选择「另存」目标目录', multi: false, defaultPath: downloadRoot || undefined });
    if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return; // 用户取消
    const dir = r.filePaths[0].replace(/[\\/]+$/, '');
    const rel = relPathForUrl(rec.url, rec.type);
    const fname = pathName(rel) || fileNameOf(rec.url);
    const safeFname = safeName(fname);
    let savePath = `${dir}/${safeFname}`;
    let i = 1;
    while (await fsExists(savePath)) savePath = `${dir}/${i++}_${safeFname}`;
    const rr = await window.api.webDownload({
      url: rec.url,
      savePath,
      referrer: rec.referrer,
      type: rec.type,
    });
    if (rr && rr.ok) {
      rec.downloaded = true;
      rec.path = rr.path;
      rec.downloadType = rr.type || rec.type;
      if (rec.type === 'spine') await downloadSpineGroup(rec, dir); // 配套 .atlas/.png/.skel 一并另存
      renderList();
      toast('已另存: ' + fileNameOf(rec.url));
      if (!onlyUrlEl.checked) { const msg = await importToLibrary(rec, rr.path); if (msg) toast(msg); }
    } else toast('另存失败: ' + ((rr && rr.error) || ''), 'warn');
  };

  // ---- 悬浮预览窗: 独立窗口(像 DevTools detach, 由主进程 webPreviewWindow 管理) ----
  // 悬停资源行 → 显示独立预览窗并推送内容; 移出(未置顶)自动隐藏;
  // 点击进入预览窗自动置顶常驻(不自动消失); 预览窗内 📌 切换 alwaysOnTop。
  let pvTimer = null, pvRec = null, pvPinned = false, pvHoveringRow = false, pvMouse = null;
  // 悬浮预览开关(默认开, 状态持久化 localStorage)
  let pvEnabled = localStorage.getItem('wg-pv-enabled') !== '0';
  pvSwitchEl.checked = pvEnabled;
  pvSwitchEl.addEventListener('change', () => {
    pvEnabled = pvSwitchEl.checked;
    try { localStorage.setItem('wg-pv-enabled', pvEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!pvEnabled) { // 关闭: 取消待弹计时器并彻底关闭当前预览窗
      pvRec = null; pvHoveringRow = false;
      clearTimeout(pvTimer);
      window.api.webPreviewClose();
    }
  });
  const schedulePreview = (rec, e) => {
    if (!pvEnabled) return; // 开关关闭: 悬停不弹悬浮预览窗
    pvRec = rec; pvHoveringRow = true;
    // 记录鼠标屏幕坐标(悬浮窗定位到鼠标右下方, 不遮挡缩略图/文件名)
    if (e && e.screenX != null && e.screenY != null) pvMouse = { x: e.screenX, y: e.screenY };
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => { if (pvRec) showPreview(pvRec, pvMouse); }, 350);
  };
  const cancelPreview = () => {
    pvHoveringRow = false;
    if (pvPinned) return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => { if (!pvHoveringRow && !pvPinned) hidePreview(); }, 280);
  };
  const showPreview = (rec, mousePos) => {
    pvRec = rec;
    window.api.webPreviewShow({
      type: rec.type, url: rec.url, name: fileNameOf(rec.url),
      size: rec.size || 0, referrer: rec.referrer || '', host: rec.host || '',
      mouse: (mousePos && mousePos.x != null) ? mousePos : null,
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
  // 折叠浏览器区: 仅当「手动移至新窗口」浮出时(manual=true), 把主窗口浏览器区让给下方侧栏;
  // 其余浮出场景(切到其它模块)页面本就隐藏, 无需折叠。关闭悬浮窗(floatClose)→ state='back' 还原。
  const applyFloatCollapse = (collapsed) => {
    const wrap = container.querySelector('.wg-wrap');
    if (wrap) wrap.classList.toggle('floated-out', !!collapsed);
  };
  window.api.onWebStatus((s) => {
    lastStatus = s.state || '';
    if (s.state === 'floated') {
      if (s.manual) applyFloatCollapse(true);
    } else if (s.state === 'back') {
      // 悬浮窗关闭/切回: 还原主窗口浏览器区(先取消折叠, 再恢复视图矩形)
      applyFloatCollapse(false);
      container._webGameSyncBounds && container._webGameSyncBounds();
    }
    if (s.title) statusEl.textContent = s.title;
    else if (s.state === 'loading') statusEl.textContent = '加载中…';
    else if (s.state === 'idle') statusEl.textContent = '就绪';
    else if (s.state === 'navigated') { statusEl.textContent = s.url || ''; if (s.url) urlEl.value = s.url; }
    else if (s.state === 'closed') { statusEl.textContent = '已停止(捕获记录保留)'; }
  });
  window.api.onWebCaptured((rec) => {
    const existing = records.find((r) => r.url === rec.url);
    if (existing) Object.assign(existing, rec);
    else records.push(rec);
    fixRecordTypes(); // 新记录可能补齐 spine 组, 全量重算归类
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

  // ---- 多标签条(顶栏下): 切换 / 关闭 / 新开 / 右键菜单 / 静音图标 ----
  // 取 URL 的 host(用于按网站静音)
  const hostOfUrl = (u) => { try { return new URL(u).hostname || ''; } catch (e) { return ''; } };
  // 线条绘制风格、透明背景的静音喇叭图标(已静音的标签浮于角上)
  const muteIconSvg = (cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="16" y1="9" x2="21" y2="14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="21" y1="9" x2="16" y2="14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
  const renderTabs = ({ tabs, activeId } = {}) => {
    const list = tabs || [];
    if (!list.length) { tabsEl.hidden = true; tabsEl.innerHTML = ''; return; }
    tabsEl.hidden = false;
    tabsEl.innerHTML = list.map((t) => {
      const host = hostOfUrl(t.url);
      const muteIco = t.muted ? muteIconSvg('wg-tab-mute-ico') : '';
      return `
      <div class="wg-tab ${t.id === activeId ? 'active' : ''}" data-id="${esc(t.id)}" data-host="${esc(host)}" title="${esc(t.url || '')}">
        ${muteIco}
        <span class="wg-tab-title">${esc(t.title || '新标签')}</span>
        <span class="wg-tab-close" data-close="${esc(t.id)}" title="关闭标签">×</span>
      </div>`;
    }).join('') + '<button class="wg-tab-add" id="wg-tab-add" title="新开标签页">＋</button>';
    tabsEl.querySelectorAll('.wg-tab').forEach((el) => {
      const tid = el.dataset.id;
      const host = el.dataset.host || '';
      el.addEventListener('click', () => { window.api.webSwitchTab(tid); container._webGameSyncBounds(); });
      el.querySelector('[data-close]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.api.webCloseTab(tid);
        container._webGameSyncBounds();
      });
      // 右键菜单: 将标签页移至新窗口 / 将这个网站静音(切换)
      // ⚠️ 用原生 OS 菜单弹出(经 web:tabMenu), 因为 WebContentsView 永远盖在 DOM 之上,
      //    DOM 浮层菜单会被网页内容遮挡; 原生菜单始终在最上层, 且天然符合系统样式。
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const t = list.find((x) => x.id === tid);
        window.api.webTabMenu({ x: e.clientX, y: e.clientY, tid, host, muted: !!(t && t.muted) });
      });
    });
    tabsEl.querySelector('#wg-tab-add').addEventListener('click', async () => {
      const r = await window.api.webNewTab('');
      if (r && r.ok) { setPanel('capture'); container._webGameSyncBounds(); urlEl.focus(); }
    });
    // 同步顶栏全局静音按钮状态为「当前活动标签所属网站是否静音」
    const activeTab = list.find((t) => t.id === activeId);
    if (typeof setMuteBtn === 'function') setMuteBtn(!!(activeTab && activeTab.muted));
  };
  window.api.onWebTabs((d) => { renderTabs(d); });

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
    // 隐藏侧栏时图标: 面板+底部线(表示"可显示面板"); 显示侧栏时: 同样式(表示"可隐藏面板")
    sideBtn.innerHTML = hidden
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="1.5" width="12" height="13" rx="1.5"/><line x1="2" y1="11.5" x2="14" y2="11.5"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="1.5" width="12" height="13" rx="1.5"/><line x1="2" y1="11.5" x2="14" y2="11.5"/></svg>';
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
  /** 网站域名(保存目录第一层) */
  const hostOf = (url) => { try { return new URL(url).hostname || 'site'; } catch (e) { return 'site'; } };
  /** spine 组配套扩展名(随主文件整组保存) */
  const SPINE_GROUP_EXT = new Set(['.atlas', '.atlas.txt', '.png', '.skel', '.bin', '.sk']);
  /** 下载 spine 主文件时, 把同组(同目录同 base 名)配套文件一并保存到同一目录 */
  const downloadSpineGroup = async (rec, saveDir) => {
    const { key } = urlKeyOf(rec.url);
    for (const g of records) {
      if (g === rec || g.downloaded === true) continue;
      const gk = urlKeyOf(g.url);
      if (gk.key !== key || !SPINE_GROUP_EXT.has(gk.ext)) continue;
      const gf = pathName(relPathForUrl(g.url, g.type)) || fileNameOf(g.url);
      let sp = `${saveDir}/${safeName(gf)}`;
      let i = 1;
      while (await fsExists(sp)) sp = `${saveDir}/${i++}_${safeName(gf)}`;
      const rr = await window.api.webDownload({ url: g.url, savePath: sp, referrer: g.referrer, type: g.type });
      if (rr && rr.ok) { g.downloaded = true; g.path = rr.path; g.downloadType = rr.type || g.type; }
    }
  };

  const downloadOne = async (rec) => {
    if (!downloadRoot) return { ok: false, error: '未设置输出目录' };
    const rel = relPathForUrl(rec.url, rec.type);
    const base = pathBase(rel);
    const fname = pathName(rel) || fileNameOf(rec.url);
    const safeFname = safeName(fname);
    // 目录: 输出目录/{网站域名}/{URL 相对路径目录} —— 同组 spine 配套文件天然同目录
    const saveDir = `${downloadRoot}/${safeName(hostOf(rec.url))}${base ? '/' + safeName(base) : ''}`.replace(/\/+/g, '/');
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
      if (rec.type === 'spine') await downloadSpineGroup(rec, saveDir); // 配套 .atlas/.png/.skel 一起保存
      renderList();
      return { ok: true, rec, path: r.path, type: r.type || rec.type };
    }
    return { ok: false, error: (r && r.error) || '下载失败', rec };
  };
  const pathBase = (rel) => rel.split('/').slice(0, -1).join('/');
  const pathName = (rel) => rel.split('/').pop();
  const fsExists = async (p) => { try { return !!(await window.api.statFile(p)); } catch (e) { return false; } };

  // ---- 入库 ----
  const importToLibrary = async (rec, savePath) => {
    // 配套文件(atlas/png/astc)随 spine 主文件整组保存, 不再单独入库(避免重复 spine 条目)
    if (rec.groupOnly) return null;
    // 归类修正后的明确类型优先(fgui/spine 等); 其余(如 json→config)用下载后探测类型(如 spine)升级
    const KNOWN_TYPES = ['fgui', 'spine', 'spine-json', 'spine-skel', 'spine-atlas', 'image', 'audio'];
    const type = KNOWN_TYPES.includes(rec.type) ? rec.type : (rec.downloadType || rec.type);
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
        selected.delete(rec.url); // 下载成功: 取消勾选(行状态显示「✓ 已下载」), 避免残留勾选导致再点「下载选中」误报
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
    if (ok) renderList(); // 刷新勾选状态与行「✓ 已下载」标记
    toast(`下载完成: 成功 ${ok} / 失败 ${fail}`);
  };

  // 打开下载目录(系统文件管理器)
  container.querySelector('#wg-open-dir').addEventListener('click', async () => {
    if (!downloadRoot) { toast('请先选择输出目录(顶栏「选择」)', 'warn'); return; }
    const r = await window.api.openPath(downloadRoot);
    if (r && r !== '') toast('打开目录失败: ' + r, 'warn');
  });

  container.querySelector('#wg-dl-sel').addEventListener('click', () => {
    // 从全量捕获记录匹配勾选(而非当前筛选/搜索视图):
    // 用户勾选后切换类型筛选 chips / 输入搜索词 / 资源被 fixRecordTypes 重新归类,
    // 勾选项可能已不在 shownRecords() 中, 旧逻辑会误报「请先勾选」。
    const picked = records.filter((r) => selected.has(r.url));
    if (!picked.length) { toast('请先勾选要下载的资源(复选框)', 'warn'); return; }
    const targets = picked.filter((r) => r.downloaded !== true && DOWNLOADABLE.includes(r.type));
    if (!targets.length) {
      const done = picked.filter((r) => r.downloaded === true).length;
      if (done === picked.length) toast('勾选的资源均已下载', 'warn');
      else toast('勾选的资源类型暂不支持下载', 'warn');
      return;
    }
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
    if (catId === 'all') return '全部';
    if (!catId) return '未分类';
    const segs = [];
    let id = catId, guard = 0;
    while (id && guard++ < 10) {
      const c = webBookmarkCategoryById(id);
      if (!c) break;
      segs.unshift(c.name);
      id = c.parentId || '';
    }
    return segs.join('/') || '未分类';
  };
  // 打开网址: 已打开相同网址 → 切换到已有标签页(不新开); 否则新开; 主窗口未激活过则兜底 webOpen 首开
  const openUrl = async (url) => {
    if (!url) return;
    setPanel('capture');
    const r = await window.api.webOpenOrSwitch(url);
    if (r && r.ok) {
      container._webGameSyncBounds();
      hintEl.style.display = 'none';
      return;
    }
    const r2 = await window.api.webOpen(url, { ua: undefined, proxy: state.settings.webGameProxy || undefined });
    if (r2 && r2.ok) { container._webGameSyncBounds(); hintEl.style.display = 'none'; }
  };
  // 强制新开标签页(右键菜单「新标签打开」)
  const openUrlNewTab = async (url) => {
    if (!url) return;
    setPanel('capture');
    const r = await window.api.webNewTab(url);
    if (r && r.ok) { container._webGameSyncBounds(); hintEl.style.display = 'none'; }
  };
  const renderBookmarks = () => {
    bmCatnameEl.textContent = catPathName(curBmCat);
    const list = webBookmarksInCategory(curBmCat);
    if (!list.length) {
      bmListEl.innerHTML = `<div class="wg-empty">${curBmCat === 'all' ? '暂无收藏网址' : '该分类下暂无收藏网址'}</div>`;
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
      // 右键: 复制网址 / 新标签打开 / 移动到 / 修改 / 删除
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const b = webBookmarkById(id);
        if (!b) return;
        showMenu([
          { label: '🔗 复制网址', act: () => copyText(b.url) },
          { label: '▶ 新标签打开', act: () => openUrlNewTab(b.url) },
          { label: '📂 移动到...', act: () => moveBookmarkDialog(id) },
          { label: '✎ 修改', act: () => editWebBookmarkDialog(id) },
          { label: '🗑 删除', act: () => removeWebBookmarkDialog(id) },
        ], e.clientX, e.clientY);
      });
      // 点击网址项 → 在新标签页中打开(复制请用右键菜单)
      row.addEventListener('click', () => {
        const b = webBookmarkById(id);
        if (b) openUrl(b.url);
      });
    });
  };
  const addWebBookmarkDialog = (currentUrl) => {
    // 主动隐藏网页原生视图(避免弹窗瞬间被其遮挡/闪现); 关闭后由 modal-root 监听器恢复
    window.api.webSetBounds({ width: 0, height: 0 });
    const cats = allWebBookmarkCats();
    const cur = (curBmCat && curBmCat !== 'all' && cats.some((c) => c.id === curBmCat)) ? curBmCat : (cats.length ? cats[0].id : '');
    const fields = [
      { key: 'url', label: '网址', type: 'text', value: currentUrl || '' },
      { key: 'name', label: '名称(可空,默认取网址)', type: 'text', value: '' },
    ];
    if (cats.length) {
      // 已有分类 → 必须选择(可新建)
      fields.push({
        key: 'cat', label: '分类(必选)', type: 'select',
        options: cats.map((c) => ({ value: c.id, label: catPathName(c.id) })).concat([{ value: '__new__', label: '➕ 新建分类...' }]),
        value: cur,
      });
    } else {
      // 无任何分类 → 必须输入分类名称(自动新建)
      fields.push({ key: 'cat', label: '分类名称(将新建)', type: 'text', value: '' });
    }
    promptDialog({
      title: '收藏网址',
      fields,
      onOk: ({ url, name, cat }) => {
        const u = (url || '').trim();
        if (!u) return toast('网址不能为空', 'error');
        const save = (catId) => {
          if (!catId) return toast('请选择分类', 'error');
          addWebBookmark({ categoryId: catId, url: u, name: (name || '').trim() });
          renderBookmarks();
          refreshTree();
          toast('已收藏网址');
        };
        if (cats.length) {
          if (cat === '__new__') {
            // 选「新建分类...」→ 再输入分类名称
            promptDialog({
              title: '新建收藏夹分类',
              fields: [{ key: 'cname', label: '分类名称', type: 'text', value: '' }],
              onOk: ({ cname }) => {
                const cn = (cname || '').trim();
                if (!cn) return toast('分类名称不能为空', 'error');
                const nc = addWebBookmarkCategory({ name: cn, parentId: '' });
                refreshTree();
                save(nc.id);
              },
            });
            return;
          }
          save(cat);
        } else {
          const cn = (cat || '').trim();
          if (!cn) return toast('请填写分类名称', 'error');
          const nc = addWebBookmarkCategory({ name: cn, parentId: '' });
          refreshTree();
          save(nc.id);
        }
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
        refreshTree();
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
      onOk: () => { removeWebBookmark(id); renderBookmarks(); refreshTree(); toast('已删除收藏网址'); },
    });
  };
  // 侧栏树刷新(收藏夹结构/计数变化后同步左侧树)
  const refreshTree = () => { try { container._webGameTreeRefresher && container._webGameTreeRefresher(); } catch (e) { /* ignore */ } };
  /** 平铺全部收藏夹分类(递归) */
  const allWebBookmarkCats = () => {
    const out = [];
    const walk = (parentId) => {
      for (const c of getWebBookmarkCategoryChildren(parentId)) { out.push(c); walk(c.id); }
    };
    walk('');
    return out;
  };
  /** 移动收藏网址到其它分类(必须选择有效分类) */
  const moveBookmarkDialog = (id) => {
    const bm = webBookmarkById(id);
    if (!bm) return;
    const cats = allWebBookmarkCats();
    if (!cats.length) { toast('暂无分类目录,请先创建', 'warn'); return; }
    promptDialog({
      title: `移动「${bm.name || bm.url}」到`,
      fields: [{
        key: 'cat', label: '目标分类', type: 'select',
        options: cats.map((c) => ({ value: c.id, label: catPathName(c.id) })),
        value: cats.some((c) => c.id === bm.categoryId) ? bm.categoryId : cats[0].id,
      }],
      onOk: ({ cat }) => {
        if (!cat) return toast('请选择目标分类', 'error');
        updateWebBookmark(id, { categoryId: cat });
        renderBookmarks();
        refreshTree();
        toast('已移动收藏网址');
      },
    });
  };
  const addBookmarkCategoryDialog = () => {
    const parentId = (curBmCat && curBmCat !== 'all') ? curBmCat : '';
    promptDialog({
      title: '新建收藏夹子目录',
      fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
      onOk: ({ name }) => {
        if (!name) return toast('目录名称不能为空', 'error');
        addWebBookmarkCategory({ name, parentId });
        renderBookmarks();
        refreshTree();
        toast('已创建收藏夹子目录');
      },
    });
  };
  // 收藏网址: 默认预填浏览器当前网址(网页已打开时), 否则可手动输入
  container.querySelector('#wg-bm-add-url').addEventListener('click', async () => {
    let cur = '';
    try { const r = await window.api.webGetUrl(); cur = (r && r.ok && r.url) || ''; } catch (e) { /* ignore */ }
    addWebBookmarkDialog(cur);
  });
  container.querySelector('#wg-bm-add-cat').addEventListener('click', addBookmarkCategoryDialog);

  // ---- 侧栏联动回调 ----
  // 打开某分类收藏夹(切到收藏夹面板); 空/未分类 → 显示全部;
  // opts.keepBrowser=true(左树点击)时保留浏览器视图, 已打开的网页不黑屏
  container._webGameShowBookmarks = (catId, opts = {}) => {
    curBmCat = (catId && catId !== 'all') ? catId : 'all';
    setPanel('bookmark', !!(opts && opts.keepBrowser));
  };
  // 直接打开网址(侧栏收藏夹节点 → 新开网页标签页)
  container._webGameOpenUrl = (url) => {
    if (url) { urlEl.value = url; openUrl(url); }
  };
  // 回填 URL(最近历史点击 → 新开网页标签页)
  container._webGameSetUrl = (url) => {
    if (url) { urlEl.value = url; openUrl(url); }
  };
  // 离开页面时: 浏览器视图迁入独立悬浮窗(可拖拽/最小化/关闭), 防止遮挡其它页; 同步隐藏独立预览窗
  container._webGameDetach = () => {
    // 断开弹窗遮挡监听(避免离开抓取页后仍在全局响应)
    if (container._webGameModalObserver) { try { container._webGameModalObserver.disconnect(); } catch (e) {} container._webGameModalObserver = null; }
    window.api.webPreviewHide();
    window.api.webFloatOut();
  };
  // 弹窗遮挡修复: 抓取页任意通用弹窗(promptDialog/确认框)打开时, 原生 WebContentsView 会盖住 DOM 浮层,
  // 故监听 #modal-root: 有 .modal-mask 则隐藏网页视图, 全部关闭后由 _webGameSyncBounds 恢复(受面板状态约束)。
  const modalRootEl = document.getElementById('modal-root');
  if (modalRootEl) {
    const syncWebForModal = () => {
      const hasModal = !!modalRootEl.querySelector('.modal-mask');
      if (hasModal) {
        window.api.webSetBounds({ width: 0, height: 0 }); // 隐藏原生网页视图, 让 DOM 弹窗可见可点
      } else {
        container._webGameSyncBounds && container._webGameSyncBounds(); // 恢复(收藏夹面板仍保持隐藏)
      }
    };
    const mo = new MutationObserver(syncWebForModal);
    mo.observe(modalRootEl, { childList: true, subtree: true });
    container._webGameModalObserver = mo;
  }

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
      fixRecordTypes();
      if (records.length) hintEl.style.display = 'none';
      renderList();
    }
  };
  init();

  return container;
}
