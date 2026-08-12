import { itemById } from './state.js';
import { showContextMenu, toast } from './dialogs.js';

/**
 * 图片图集(Spine/TexturePacker .atlas)解析、拆分浏览与导出模块。
 *
 * 约定:图片资源 `foo.png` 与同名图集 `foo.atlas`(或 `foo.png.atlas`) 位于同一目录。
 * - 图片预览显示「图集」标识。
 * - 右键菜单提供「拆分图集」(按 .atlas 数据把整张图集拆成独立小图,保存到以图集图片命名的目录)。
 * - 双击/打开带图集的图片 → 进入「拆分浏览」页,按 .atlas 中的名称列出每张单图及其计算尺寸。
 * - 拆分浏览页中右键单图 → 「保存图片」(以 .atlas 中的名称命名提取)。
 */

// ---- 路径小工具(渲染端,统一用 / 拼接;Node fs 对 Windows 路径兼容正斜杠) ----
function dirOf(p) { return String(p).replace(/[\\/][^\\/]*$/, ''); }
function baseOf(p) { return String(p).split(/[\\/]/).pop(); }
function noExtOf(p) { return baseOf(p).replace(/\.[^.]+$/, ''); }
function sanitizeName(name) {
  return String(name || 'region').replace(/[\\/:*?"<>|]/g, '_');
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** base64 dataUrl → 纯文本(atlas 为 ASCII) */
function decodeBase64Text(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  if (!b64) return '';
  let bin = '';
  try { bin = atob(b64); } catch (e) { return ''; }
  let s = '';
  for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin.charCodeAt(i) & 0xff);
  return s;
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片加载失败'));
    im.src = src;
  });
}

/**
 * 解析 Spine/TexturePacker .atlas 文本。
 * 结构:页名行(图片文件)→ 无缩进 size/format/filter/repeat 属性 → 空行 → 每个区域(区域名行 + 缩进属性)。
 * rotate 支持 true/false 与 90/180/270(导出器差异)。
 * @returns {Array<{name:string,w:number,h:number,regions:Array<{name:string,x:number,y:number,w:number,h:number,rotate:number,ow?:number,oh?:number,index:number}>}>}
 */
export function parseSpineAtlas(text) {
  const lines = String(text || '').split(/\r?\n/);
  const pages = [];
  let page = null;
  let region = null;
  const pushRegion = () => { if (region && page) { page.regions.push(region); region = null; } };
  for (const line of lines) {
    if (!line.trim()) { pushRegion(); continue; }
    const indented = /^\s/.test(line);
    const kv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!indented && !kv) {
      // 名称行:尚无页 → 页名(图片文件);否则 → 区域名
      const name = line.trim();
      if (!page) {
        page = { name, w: 0, h: 0, regions: [] };
        pages.push(page);
      } else {
        pushRegion();
        region = { name, x: 0, y: 0, w: 0, h: 0, rotate: 0, index: -1 };
      }
      continue;
    }
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    const nums = val.split(',').map((n) => Number(String(n).trim()));
    if (region) {
      if (key === 'xy') { region.x = nums[0] || 0; region.y = nums[1] || 0; }
      else if (key === 'size') { region.w = nums[0] || 0; region.h = nums[1] || 0; }
      else if (key === 'rotate') {
        if (val === 'true' || val === '90') region.rotate = 90;
        else if (val === 'false' || val === '0' || val === '') region.rotate = 0;
        else region.rotate = Number(val) || 0;
      }
      else if (key === 'index') region.index = Number(val) || 0;
      else if (key === 'orig') { region.ow = nums[0] || 0; region.oh = nums[1] || 0; }
      else if (key === 'offset') { region.ox = nums[0] || 0; region.oy = nums[1] || 0; }
    } else if (page) {
      if (key === 'size') { page.w = nums[0] || 0; page.h = nums[1] || 0; }
      else if (key === 'repeat') page.repeat = val;
      // format / filter 无需用于拆分
    }
  }
  pushRegion();
  return pages;
}

/** 区域旋转角度(0/90/180/270) */
function regionDeg(r) { return typeof r.rotate === 'number' ? r.rotate : 0; }
/** 区域展示尺寸(旋转后宽高交换) */
function regionDisplaySize(r) {
  const deg = regionDeg(r);
  const swapped = deg === 90 || deg === 270;
  return { w: swapped ? r.h : r.w, h: swapped ? r.w : r.h };
}

/** 从图集大图提取单张区域 → PNG dataUrl(按 rotate 还原为正向) */
export function extractRegion(img, r) {
  const deg = regionDeg(r);
  const { w: cw, h: ch } = regionDisplaySize(r);
  const c = document.createElement('canvas');
  c.width = Math.max(1, cw);
  c.height = Math.max(1, ch);
  const ctx = c.getContext('2d');
  if (deg) {
    // 打包时顺时针旋转 deg(TexturePacker 默认),提取时逆时针还原
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((-deg * Math.PI) / 180);
    ctx.drawImage(img, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
  } else {
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  return c.toDataURL('image/png');
}

/** 检测图片资源对应的同名 .atlas 文件路径(无则返回 null) */
export async function findAtlasForImage(item) {
  if (!item || item.type !== 'image' || !item.filePath) return null;
  const dir = dirOf(item.filePath);
  const base = noExtOf(item.filePath);   // foo
  const full = baseOf(item.filePath);    // foo.png
  const candidates = [`${dir}/${base}.atlas`, `${dir}/${full}.atlas`];
  for (const c of candidates) {
    const st = await window.api.statFile(c).catch(() => null);
    if (st && st.size != null) return c;
  }
  return null;
}

const _atlasCache = new Map(); // itemId -> { item, atlasPath, pages, page, regions, img }

/** 加载图集数据(解析 atlas + 加载图集大图),带缓存 */
export async function loadAtlasData(item, force = false) {
  if (!force && _atlasCache.has(item.id)) return _atlasCache.get(item.id);
  const atlasPath = await findAtlasForImage(item);
  if (!atlasPath) return null;
  const res = await window.api.readBase64(atlasPath).catch(() => null);
  if (!res || !res.ok) return null;
  const pages = parseSpineAtlas(decodeBase64Text(res.dataUrl));
  if (!pages.length) return null;
  const imgName = baseOf(item.filePath);
  const page = pages.find((p) => baseOf(p.name) === imgName) || pages[0];
  if (!page || !page.regions.length) return null;
  const img = await loadImageEl(`${location.origin}/a/${item.id}/${encodeURIComponent(imgName)}`);
  const data = { item, atlasPath, pages, page, regions: page.regions, img };
  _atlasCache.set(item.id, data);
  return data;
}

/** 图集输出目录:与图集图片同目录、以图集图片名命名的子目录 */
function atlasOutDir(item) {
  return `${dirOf(item.filePath)}/${noExtOf(item.filePath)}`;
}

/**
 * 拆分图集并保存。
 * @param {object} item 图片资源条目
 * @param {object} [opts] - { only: 区域名 } 仅导出某张单图;缺省导出全部
 * @returns {Promise<string|null>} 输出目录(成功)或 null(失败)
 */
export async function splitAtlasToFiles(item, opts = {}) {
  const { only } = opts;
  let data = null;
  try {
    data = await loadAtlasData(item);
  } catch (err) {
    toast('图集加载失败:' + (err && err.message ? err.message : err));
    return null;
  }
  if (!data) { toast('未找到同名 .atlas 图集,或图集解析失败'); return null; }
  const regions = only ? data.regions.filter((r) => r.name === only) : data.regions;
  if (!regions.length) { toast(only ? `图集中未找到单图「${only}」` : '图集中没有可拆分的单图'); return null; }
  const dir = atlasOutDir(item);
  let ok = 0;
  for (const r of regions) {
    try {
      const dataUrl = extractRegion(data.img, r);
      const res = await window.api.writeFileBase64(`${dir}/${sanitizeName(r.name)}.png`, dataUrl);
      if (res && res.ok) ok++;
    } catch (err) { /* 单张失败不影响整体 */ }
  }
  if (ok) {
    toast(only ? `已保存单图「${only}」到:\n${dir}` : `已拆分保存 ${ok}/${regions.length} 张单图到:\n${dir}`);
    window.api.openPath(dir);
  } else {
    toast('拆分失败:无法写入文件');
    return null;
  }
  return dir;
}

/**
 * 图集拆分浏览页:按 .atlas 名称列出每张单图与计算尺寸;右键单图可「保存图片」。
 * @param {HTMLElement} container #page-atlas
 * @param {object} opts - { itemId, onBack(), onOpenImage() }
 */
export async function renderAtlasViewerPage(container, opts = {}) {
  const { itemId, onBack, onOpenImage } = opts;
  const item = itemById(itemId);
  container.innerHTML = '<div class="folder-empty"><div>正在加载图集…</div></div>';
  if (!item) {
    container.innerHTML = '<div class="folder-empty"><div>资源不存在或已删除</div></div>';
    return;
  }
  let data = null;
  let errMsg = null;
  try {
    data = await loadAtlasData(item, true); // 强刷,确保改动后的 atlas 生效
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }
  if (!data) {
    container.innerHTML = `<div class="folder-empty"><div>未找到与「${escHtml(item.displayName)}」同名的 .atlas 图集,无法拆分浏览。${errMsg ? '<br/>' + escHtml(errMsg) : ''}</div></div>`;
    return;
  }

  const head = document.createElement('div');
  head.className = 'atlas-browser-head';
  head.innerHTML = `
    <button class="btn sm" id="atlas-back" title="返回图片预览">← 返回</button>
    <span class="type-badge atlas-badge">🗂 图集</span>
    <span class="atlas-title" title="${escHtml(item.filePath)}">${escHtml(item.displayName)}</span>
    <span class="atlas-sub" title="${escHtml(data.atlasPath)}">${escHtml(baseOf(data.atlasPath))}</span>
    <div class="ctrl-spacer"></div>
    <button class="btn sm" id="atlas-view-raw" title="查看整张图集原图">查看原图</button>
    <button class="btn sm" id="atlas-split-all" title="按 .atlas 拆分全部单图到以图集图片命名的目录">拆分图集</button>
    <button class="btn sm" id="atlas-open-dir" title="在资源管理器中打开图集图片所在目录">打开目录</button>
  `;
  container.innerHTML = '';
  container.appendChild(head);

  const info = document.createElement('div');
  info.className = 'atlas-browser-info';
  const { w: pw, h: ph } = { w: data.page.w || data.img.naturalWidth, h: data.page.h || data.img.naturalHeight };
  info.textContent = `共 ${data.regions.length} 张单图 · 图集页面 ${pw}×${ph} · 右键单图可保存`;
  container.appendChild(info);

  const grid = document.createElement('div');
  grid.className = 'atlas-browser-grid';
  for (const r of data.regions) {
    const ds = regionDisplaySize(r);
    const cell = document.createElement('div');
    cell.className = 'atlas-cell';
    const imgWrap = document.createElement('div');
    imgWrap.className = 'atlas-cell-imgwrap';
    const im = document.createElement('img');
    im.className = 'atlas-cell-img';
    im.alt = r.name;
    im.draggable = false;
    try { im.src = extractRegion(data.img, r); } catch (e) { im.alt = '(提取失败)'; }
    imgWrap.appendChild(im);
    cell.appendChild(imgWrap);
    const name = document.createElement('div');
    name.className = 'atlas-cell-name';
    name.title = r.name;
    name.textContent = r.name;
    cell.appendChild(name);
    const size = document.createElement('div');
    size.className = 'atlas-cell-size';
    size.textContent = `${ds.w}×${ds.h}${regionDeg(r) ? ' ⟳' : ''}`;
    cell.appendChild(size);
    cell.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: `保存图片「${r.name}」`, onClick: () => splitAtlasToFiles(item, { only: r.name }) },
      ]);
    };
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  head.querySelector('#atlas-back').addEventListener('click', () => { if (onBack) onBack(); });
  head.querySelector('#atlas-view-raw').addEventListener('click', () => { if (onOpenImage) onOpenImage(); });
  head.querySelector('#atlas-split-all').addEventListener('click', () => splitAtlasToFiles(item));
  head.querySelector('#atlas-open-dir').addEventListener('click', () => window.api.showItem(item.filePath));
}

/** 清除图集缓存(资源更新/重命名后调用) */
export function invalidateAtlasCache(itemId) {
  if (itemId) _atlasCache.delete(itemId);
}
