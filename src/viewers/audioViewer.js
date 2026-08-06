/**
 * 音频查看器:封装 HTMLAudioElement,播放/暂停/进度/音量。
 */
export class AudioViewerController {
  constructor() {
    this.els = null;
    this.audio = null;
    this.url = null;
  }

  init(els) {
    this.els = els;
    this.audio = els.audio;
    this.audio.preload = 'metadata';

    els.playBtn.addEventListener('click', () => this.toggle());
    els.progress.addEventListener('input', () => this.seek(Number(els.progress.value)));
    els.volume.addEventListener('input', () => this.setVolume(Number(els.volume.value)));

    this.audio.addEventListener('timeupdate', () => this._syncProgress());
    this.audio.addEventListener('loadedmetadata', () => this._syncProgress());
    this.audio.addEventListener('ended', () => {
      els.playBtn.textContent = '▶';
      els.playBtn.title = '播放';
    });
    this.audio.addEventListener('play', () => {
      els.playBtn.textContent = '⏸';
      els.playBtn.title = '暂停';
    });
    this.audio.addEventListener('pause', () => {
      els.playBtn.textContent = '▶';
      els.playBtn.title = '播放';
    });
  }

  load(url, name, path) {
    this.url = url;
    if (this.els.nameEl) this.els.nameEl.textContent = name || '';
    if (this.els.pathEl) this.els.pathEl.textContent = path || '';
    this.audio.src = url;
    this.audio.currentTime = 0;
    this._syncProgress();
  }

  toggle() {
    if (this.audio.paused) {
      this.audio.play().catch((err) => console.warn('[audio] 播放失败', err));
    } else {
      this.audio.pause();
    }
  }

  seek(ratio01) {
    if (!this.audio.duration) return;
    this.audio.currentTime = ratio01 * this.audio.duration;
    this._syncProgress();
  }

  setVolume(v) {
    this.audio.volume = Math.min(Math.max(v / 100, 0), 1);
  }

  _syncProgress() {
    const { playBtn, progress, timeEl } = this.els;
    if (!this.audio.duration) {
      if (progress) progress.value = 0;
      if (timeEl) timeEl.textContent = '0:00 / 0:00';
      return;
    }
    const cur = this.audio.currentTime;
    const dur = this.audio.duration;
    if (progress) progress.value = Math.round((cur / dur) * 1000);
    if (timeEl) timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    void playBtn;
  }

  dispose() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.url = null;
  }
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
