/**
 * 音频播放器:队列管理 + 6 种播放模式 + 变速播放 + 后台播放(离开预览页不中断)。
 *
 * 播放模式:
 *  - single    单次播放(当前曲播完停止)
 *  - loop      单曲循环
 *  - dirOrder  当前目录顺序播放(播完停止)
 *  - dirLoop   当前目录循环播放
 *  - listOrder 播放列表顺序播放(播完停止)
 *  - listLoop  播放列表循环播放
 *
 * 队列来源:单曲(资源库条目)/ 当前目录(主进程 audio:listDir,不递归)/ 播放列表(paths)。
 * 所有曲目统一经内部 HTTP `/afile?p=<绝对路径>` 播放(支持 Range 拖动进度)。
 *
 * 支持多组 UI 绑定(音频主页播放器 + 预览页播放器共用同一实例与 audio 元素):
 *  - init(els, 'main') 绑定主组并挂载 audio 事件
 *  - attachEls(els, key) 绑定/替换其它组(如音频主页),同 key 自动替换旧 DOM 引用
 */
import { setCopyablePath } from '../clipboard.js';
import { state } from '../state.js';

export class AudioPlayerController {
  constructor() {
    this.elsList = [];    // [{ key, els }]
    this.audio = null;
    this.queue = [];      // [{ path, name }]
    this.index = -1;      // 当前曲目下标(-1 = 未播放)
    this.mode = 'single'; // single|loop|dirOrder|dirLoop|listOrder|listLoop
    this.rate = 1;
    this._metaCache = new Map(); // path -> ID3 tags(会话级缓存)
    this._durCache = new Map(); // path -> 时长(秒)
    this._listening = false;
  }

  init(els, key = 'main') {
    this.audio = els.audio;
    this.audio.preload = 'metadata';
    this._bindEls(els, key);

    // 重启恢复上次选择: 播放模式 / 倍速 / 音量(localStorage 启动时已初始化过)
    try {
      const m = localStorage.getItem('audio-mode');
      if (m && /^(single|loop|dirOrder|dirLoop|listOrder|listLoop)$/.test(m)) this.mode = m;
      const r = parseFloat(localStorage.getItem('audio-rate'));
      if (isFinite(r)) this.rate = Math.min(Math.max(r, 0.25), 4);
      const v = parseInt(localStorage.getItem('audio-volume'), 10);
      if (isFinite(v)) this.audio.volume = Math.min(Math.max(v / 100, 0), 1);
    } catch (e) { /* ignore */ }
    this._eachEls((e) => {
      if (e.volume) e.volume.value = String(Math.round(this.audio.volume * 100));
      if (e.rate) e.rate.value = String(this.rate);
      if (e.mode) e.mode.value = this.mode;
    });

    this.audio.addEventListener('timeupdate', () => this._syncProgress());
    this.audio.addEventListener('loadedmetadata', () => this._syncProgress());
    this.audio.addEventListener('play', () => this._syncButtons('⏸', '暂停'));
    this.audio.addEventListener('pause', () => this._syncButtons('▶', '播放'));
    this.audio.addEventListener('ended', () => this._onEnded());
    this._listening = true;
    this._applyMode();
    this._applyRate();
  }

  /** 附加/替换一组 UI(同 key 替换;新组立即同步状态) */
  attachEls(els, key) {
    this._bindEls(els, key);
    this.refreshUI();
  }

  /** 绑定一组控件:注册事件 + 加入 elsList(同 key 先移除旧组) */
  _bindEls(els, key) {
    this.elsList = this.elsList.filter((g) => g.key !== key);
    this.elsList.push({ key, els });
    if (els.playBtn) els.playBtn.addEventListener('click', () => this.toggle());
    if (els.prevBtn) els.prevBtn.addEventListener('click', () => this.prev());
    if (els.nextBtn) els.nextBtn.addEventListener('click', () => this.next());
    if (els.progress) els.progress.addEventListener('input', () => this.seek(Number(els.progress.value)));
    if (els.volume) els.volume.addEventListener('input', () => this.setVolume(Number(els.volume.value)));
    if (els.rate) els.rate.addEventListener('change', () => this.setRate(Number(els.rate.value)));
    if (els.mode) els.mode.addEventListener('change', () => this.setMode(els.mode.value));
  }

  /** 遍历所有绑定的 UI 组 */
  _eachEls(fn) {
    for (const g of this.elsList) {
      if (g && g.els) fn(g.els);
    }
  }

  // ---------- 队列加载 ----------

  /** 单曲播放(资源库条目) */
  openSingle(item) {
    this.queue = [{ path: item.filePath, name: item.displayName || this._nameOf(item.filePath) }];
    this.index = 0;
    this._playAt(0);
    this._loadQueueInfo();
  }

  /** 目录播放:列出目录内所有音频(不递归);targetPath 存在时从该文件开始(默认第一首) */
  async openDir(dirPath, targetPath) {
    const r = await window.api.listDirAudios(dirPath);
    const files = (r && r.ok && r.files) ? r.files : [];
    this.queue = files.map((p) => ({ path: p, name: this._nameOf(p) }));
    if (!this.queue.length) {
      this._updateInfo(null);
      this._eachEls((e) => { if (e.statusEl) e.statusEl.textContent = '目录中没有音频文件'; });
      return false;
    }
    let idx = 0;
    if (targetPath) {
      const t = String(targetPath).toLowerCase();
      const found = this.queue.findIndex((q) => q.path.toLowerCase() === t);
      if (found >= 0) idx = found;
    }
    this._playAt(idx);
    this._loadQueueInfo();
    return true;
  }

  /** 播放列表播放 */
  openList(paths) {
    this.queue = paths.map((p) => ({ path: p, name: this._nameOf(p) }));
    if (!this.queue.length) {
      this._updateInfo(null);
      this._eachEls((e) => { if (e.statusEl) e.statusEl.textContent = '播放列表为空'; });
      return false;
    }
    this._playAt(0);
    this._loadQueueInfo();
    return true;
  }

  /** 播放队列第 i 项 */
  playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this._playAt(i);
  }

  _playAt(i) {
    this.index = i;
    const item = this.queue[i];
    if (!item) return;
    if (this.audio.src) this.audio.src = '';
    this.audio.src = this._urlOf(item.path);
    this.audio.currentTime = 0;
    this._updateInfo(item);
    this.audio.play().catch((err) => console.warn('[audio] 播放失败', err));
    this._renderQueue();
  }

  // ---------- 播放控制 ----------

  toggle() {
    if (!this.queue.length || this.index < 0) return;
    if (this.audio.paused) {
      this.audio.play().catch((err) => console.warn('[audio] 播放失败', err));
    } else {
      this.audio.pause();
    }
  }

  play() {
    if (this.audio.paused) this.toggle();
  }

  pause() {
    if (!this.audio.paused) this.audio.pause();
  }

  /** 下一首(按模式循环/顺序;单曲/单曲循环无下一首时停在当前) */
  next() {
    if (!this.queue.length) return;
    const looping = this.mode === 'loop' || this.mode === 'dirLoop' || this.mode === 'listLoop';
    const nextIdx = this.index + 1;
    if (nextIdx < this.queue.length) { this._playAt(nextIdx); return; }
    if (looping) { this._playAt(0); return; }
  }

  prev() {
    if (!this.queue.length) return;
    const prevIdx = this.index - 1;
    if (prevIdx >= 0) { this._playAt(prevIdx); return; }
    if (this.mode === 'loop' || this.mode === 'dirLoop' || this.mode === 'listLoop') {
      this._playAt(this.queue.length - 1);
    }
  }

  seek(ratio01) {
    if (!this.audio.duration) return;
    this.audio.currentTime = ratio01 * this.audio.duration;
    this._syncProgress();
  }

  setVolume(v) {
    this.audio.volume = Math.min(Math.max(v / 100, 0), 1);
    try { localStorage.setItem('audio-volume', String(Math.round(this.audio.volume * 100))); } catch (e) { /* ignore */ }
  }

  setRate(r) {
    this.rate = Math.min(Math.max(r, 0.25), 4);
    this._applyRate();
    this._eachEls((e) => { if (e.rate) e.rate.value = String(this.rate); });
    try { localStorage.setItem('audio-rate', String(this.rate)); } catch (e) { /* ignore */ }
  }

  setMode(m) {
    this.mode = m || 'single';
    this._applyMode();
    this._eachEls((e) => { if (e.mode) e.mode.value = this.mode; });
    try { localStorage.setItem('audio-mode', this.mode); } catch (e) { /* ignore */ }
  }

  _applyRate() {
    if (this.audio) this.audio.playbackRate = this.rate;
  }

  _applyMode() {
    if (!this.audio) return;
    // 单曲循环用原生 loop,其余手动调度
    this.audio.loop = this.mode === 'loop';
  }

  /** ended 调度:按模式决定下一首/停止/重播 */
  _onEnded() {
    if (this.mode === 'loop') return; // audio.loop 已处理
    if (!this.queue.length) return;
    if (this.mode === 'dirLoop' || this.mode === 'listLoop') {
      const nextIdx = this.index + 1;
      if (nextIdx < this.queue.length) this._playAt(nextIdx);
      else this._playAt(0);
      return;
    }
    // 顺序模式(single/dirOrder/listOrder):播到队列末尾停止
    if (this.mode === 'dirOrder' || this.mode === 'listOrder') {
      const nextIdx = this.index + 1;
      if (nextIdx < this.queue.length) { this._playAt(nextIdx); return; }
    }
    // 单次 / 顺序播完 → 停止
    this._syncButtons('▶', '播放');
    this._eachEls((e) => { if (e.statusEl) e.statusEl.textContent = '播放结束'; });
    this._renderQueue();
  }

  // ---------- UI 同步(遍历所有绑定组) ----------

  _syncButtons(text, title) {
    this._eachEls((e) => {
      if (e.playBtn) { e.playBtn.textContent = text; e.playBtn.title = title; }
      if (e.miniPlay) { e.miniPlay.textContent = text; e.miniPlay.title = title; }
    });
  }

  _updateInfo(item) {
    this._eachEls((e) => {
      if (!item) {
        if (e.nameEl) e.nameEl.textContent = '—';
        if (e.pathEl) setCopyablePath(e.pathEl, '');
        return;
      }
      if (e.nameEl) e.nameEl.textContent = item.name;
      if (e.pathEl) setCopyablePath(e.pathEl, item.path);
    });
    this._updateMini();
  }

  _syncProgress() {
    this._eachEls((e) => {
      const { progress, timeEl } = e;
      if (!this.audio.duration) {
        if (progress) progress.value = 0;
        if (timeEl) timeEl.textContent = '0:00 / 0:00';
        return;
      }
      const cur = this.audio.currentTime;
      const dur = this.audio.duration;
      if (progress) progress.value = Math.round((cur / dur) * 1000);
      if (timeEl) timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    });
  }

  /** 渲染当前队列(序号列 + 按设置显示 文件名/标题/艺术家/专辑/时长;点击跳播,当前曲高亮) */
  _renderQueue() {
    this._eachEls((e) => {
      const qEl = e.queueEl;
      if (!qEl) return;
      if (!this.queue.length) { qEl.innerHTML = ''; return; }
      const fields = (state.settings && state.settings.audioListFields) || {};
      qEl.innerHTML = this.queue.map((it, i) => {
        const cur = i === this.index ? ' cur' : '';
        const playing = cur && !this.audio.paused ? '▶ ' : '';
        const meta = this._metaCache.get(it.path) || {};
        const dur = this._durCache.get(it.path);
        const subParts = [];
        if (fields.title !== false && meta.title) subParts.push(`<span class="aq-title">${esc(meta.title)}</span>`);
        if (fields.artist !== false && meta.artist) subParts.push(`<span class="aq-artist">${esc(meta.artist)}</span>`);
        if (fields.album !== false && meta.album) subParts.push(`<span class="aq-album">${esc(meta.album)}</span>`);
        const durTxt = (fields.duration !== false) && dur != null ? `<span class="aq-dur">${fmtTime(dur)}</span>` : '';
        const subHtml = subParts.length ? `<div class="aq-sub">${subParts.join('')}</div>` : '';
        const nameHtml = fields.fileName === false ? '' : `<span class="aq-name">${playing}${esc(it.name)}</span>`;
        return `<div class="aq-item${cur}" data-i="${i}" title="${esc(it.path)}">
          <span class="aq-idx">${i + 1}</span>
          <div class="aq-main">${nameHtml}${subHtml}</div>
          ${durTxt}
        </div>`;
      }).join('');
      qEl.querySelectorAll('.aq-item').forEach((el) => {
        el.addEventListener('click', () => this.playAt(Number(el.dataset.i)));
      });
    });
  }

  /** 队列确定后加载条目信息:批量读 ID3 + 并发预载时长,完成后刷新队列 */
  async _loadQueueInfo() {
    const paths = this.queue.map((x) => x.path);
    this._renderQueue();
    const noMeta = paths.filter((p) => !this._metaCache.has(p));
    if (noMeta.length) {
      try {
        const r = await window.api.readAudioMetas(noMeta);
        if (r && r.ok) for (const it of r.items) this._metaCache.set(it.path, it.tags || {});
      } catch (err) { /* ignore */ }
    }
    // 并发预载时长(限 3 个并行)
    let idx = 0;
    const worker = async () => {
      while (idx < paths.length) {
        const p = paths[idx++];
        await this._loadDuration(p);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this._renderQueue();
  }

  /** 预载单个文件时长(隐藏 Audio 加载 metadata,缓存) */
  _loadDuration(path) {
    if (this._durCache.has(path)) return Promise.resolve(this._durCache.get(path));
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      const timer = setTimeout(() => {
        if (!this._durCache.has(path)) this._durCache.set(path, null);
        resolve(this._durCache.get(path) ?? null);
      }, 5000);
      a.onloadedmetadata = () => {
        clearTimeout(timer);
        const d = isFinite(a.duration) ? a.duration : null;
        this._durCache.set(path, d);
        // 注意:此处不能 a.src=''(会触发 onerror 覆盖已缓存值)
        resolve(d);
      };
      a.onerror = () => {
        clearTimeout(timer);
        if (!this._durCache.has(path)) this._durCache.set(path, null);
        resolve(this._durCache.get(path) ?? null);
      };
      try { a.src = this._urlOf(path); } catch (err) {
        clearTimeout(timer);
        if (!this._durCache.has(path)) this._durCache.set(path, null);
        resolve(null);
      }
    });
  }

  // ---------- 后台播放(迷你条) ----------

  _updateMini() {
    this._eachEls((e) => {
      if (!e.miniBar || !e.miniName) return;
      const has = this.queue.length > 0 && this.index >= 0;
      e.miniBar.hidden = !has;
      if (has && this.queue[this.index]) {
        e.miniName.textContent = this.queue[this.index].name;
        e.miniName.title = '点击返回音频预览页';
      }
    });
  }

  // ---------- 其它 ----------

  _urlOf(p) {
    return `${location.origin}/afile?p=${encodeURIComponent(p)}`;
  }

  _nameOf(p) {
    return (p.split(/[\\/]/).pop()) || p;
  }

  /** 停止播放并清空(迷你条 × ) */
  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.queue = [];
    this.index = -1;
    this._updateInfo(null);
    this._renderQueue();
    this._updateMini();
    this._eachEls((e) => { if (e.statusEl) e.statusEl.textContent = ''; });
  }

  /** 重新同步所有 UI(后台播放返回/主页重渲染时调用) */
  refreshUI() {
    const item = this.queue[this.index];
    this._updateInfo(item || null);
    this._renderQueue();
    this._syncButtons(this.audio.paused ? '▶' : '⏸', this.audio.paused ? '播放' : '暂停');
    this._syncProgress();
    this._eachEls((e) => { if (e.rate) e.rate.value = String(this.rate); if (e.mode) e.mode.value = this.mode; });
  }

  /** 元信息被修改后:清除缓存并刷新队列显示 */
  invalidateMeta(path) {
    if (path) this._metaCache.delete(path);
    this._renderQueue();
    if (path) this._loadQueueInfo();
  }

  /** 文件被重命名后:更新队列路径与缓存 */
  renamePath(oldPath, newPath) {
    for (const q of this.queue) {
      if (q.path === oldPath) {
        q.path = newPath;
        q.name = this._nameOf(newPath);
      }
    }
    this._metaCache.delete(oldPath);
    this._durCache.delete(oldPath);
    const item = this.queue[this.index];
    if (item) this._updateInfo(item);
    this._renderQueue();
    this._loadQueueInfo();
  }

  /** 追加路径到当前队列尾部(不打断播放;已存在项跳过) */
  appendPaths(paths) {
    if (!this.queue.length || !paths || !paths.length) return 0;
    const existing = new Set(this.queue.map((x) => x.path.toLowerCase()));
    const added = paths.filter((p) => !existing.has(String(p).toLowerCase()));
    for (const p of added) this.queue.push({ path: p, name: this._nameOf(p) });
    if (added.length) this._loadQueueInfo();
    return added.length;
  }

  dispose() {
    // 后台播放:离开预览页不销毁音频,仅断开主组引用(事件回调已判空保护,播放继续)
    this.elsList = this.elsList.filter((g) => g.key !== 'main');
  }
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
