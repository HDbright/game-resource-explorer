/**
 * 骨骼动画编辑器 - 底部时间轴(摄影表)。
 *
 * 结构:顶部播放控制条(动画管理 / 传输控制 / 帧计数 / 时长 / 自动关键帧 / 洋葱皮)
 *      下方左右分栏:左 = 轨道树(骨骼→位移/旋转/缩放,插槽→颜色/显示);
 *      右 = 刻度尺 + 关键帧菱形(可拖动/右键缓动) + 播放头(可拖动)。
 *
 * 重建策略:rebuild() 全量;updatePlayhead() 仅移动播放头与帧计数(播放中每帧调用)。
 */

import { showContextMenu } from '../dialogs.js';
import { EASE_PRESETS, bonesInTreeOrder } from './model.js';
import { channelLabel } from './panels.js';

const CH_COLOR = { translate: '#4f8cff', rotate: '#46a758', scale: '#b8842f', color: '#c05fd8', display: '#5fa8c0' };
const BONE_CH = [
  { id: 'translate', label: '位移' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
];
const SLOT_CH = [
  { id: 'color', label: '颜色' },
  { id: 'display', label: '显示' },
];

export class EditorTimeline {
  constructor(ctx) {
    this.ctx = ctx;
    this.pxf = 9;             // 每帧像素
    this.collapsed = new Set(); // 展开状态:骨骼名折叠集合
    this.clipboard = null;      // 复制的关键帧 { channel, v, ease }
    this._scrubbing = false;
    this._dragKey = null;
  }

  mount(el) {
    this.el = el;
    // 结构(参考 Spine 摄影表):
    //   顶栏控制 → 刻度尺固定行(不随垂直滚动,水平位置与轨道同步)
    //   主体 = 左侧部件树 + 右侧轨道区(水平滚动,垂直滚动由 body 统一承担,两列同步)
    //   播放头为宿主级浮层,贯穿刻度尺与全部轨道行
    el.innerHTML = `
      <div class="be-tl-head"></div>
      <div class="be-tl-ruler-row">
        <div class="be-tl-ruler-spacer"></div>
        <div class="be-tl-ruler-scroll"><canvas class="be-tl-ruler" height="26"></canvas></div>
      </div>
      <div class="be-tl-body">
        <div class="be-tl-left"><div class="be-tl-tracks"></div></div>
        <div class="be-tl-scroll">
          <div class="be-tl-lanes"></div>
        </div>
        <div class="be-tl-playhead"></div>
      </div>`;
    this._buildHead();
    this._bindRight();
    this.refresh();
  }

  // ---------------- 顶部控制条 ----------------

  _buildHead() {
    const ctx = this.ctx;
    const head = this.el.querySelector('.be-tl-head');
    head.innerHTML = '';

    const mkBtn = (html, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'btn sm be-tl-btn ' + cls;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };

    // 动画管理
    const animSel = document.createElement('select');
    animSel.className = 'be-tl-anim';
    this.animSel = animSel;
    animSel.addEventListener('change', () => ctx.setAnimation(animSel.value));
    head.appendChild(animSel);
    head.appendChild(mkBtn('＋', '新建动画', () => ctx.newAnimation()));
    head.appendChild(mkBtn('✎', '重命名动画', () => ctx.renameAnimation()));
    head.appendChild(mkBtn('🗑', '删除动画', () => ctx.deleteAnimation()));

    const sep = () => { const s = document.createElement('span'); s.className = 'be-tl-sep'; return s; };
    head.appendChild(sep());

    // 传输控制
    this.btnPlay = mkBtn('▶', '播放/暂停 (空格输入框外为工具快捷键,此处点击或回车)', () => ctx.togglePlay());
    head.appendChild(mkBtn('⏮', '跳到开头', () => ctx.setFrame(0)));
    head.appendChild(mkBtn('◀', '上一帧', () => ctx.setFrame(Math.round(ctx.frame) - 1)));
    head.appendChild(this.btnPlay);
    head.appendChild(mkBtn('▶|', '下一帧', () => ctx.setFrame(Math.round(ctx.frame) + 1)));
    head.appendChild(mkBtn('⏭', '跳到结尾', () => ctx.setFrame(ctx.anim ? ctx.anim.duration : 0)));

    this.btnLoop = mkBtn('🔁', '循环播放', () => ctx.toggleLoop(), ctx.loop ? 'active' : '');
    head.appendChild(this.btnLoop);

    head.appendChild(sep());
    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'be-tl-frame';
    head.appendChild(this.frameLabel);

    head.appendChild(sep());
    const durRow = document.createElement('label');
    durRow.className = 'be-tl-dur';
    durRow.innerHTML = '<span>时长</span>';
    this.durInput = document.createElement('input');
    this.durInput.type = 'number';
    this.durInput.min = 1;
    this.durInput.title = '动画总帧数';
    this.durInput.addEventListener('change', () => {
      const v = Math.max(1, Math.round(parseFloat(this.durInput.value) || 1));
      if (ctx.anim) { ctx.beginEdit('修改时长'); ctx.anim.duration = v; ctx.refresh(); }
    });
    durRow.appendChild(this.durInput);
    head.appendChild(durRow);

    head.appendChild(document.createElement('span')).className = 'spacer';

    // 自动关键帧 / 洋葱皮
    this.btnAutoKey = mkBtn('●K', '自动关键帧:动画模式下拖动骨骼自动记录关键帧', () => ctx.toggleAutoKey(), ctx.autoKey ? 'active' : '');
    this.btnAutoKey.classList.add('be-autokey');
    head.appendChild(this.btnAutoKey);
    this.btnOnion = mkBtn(' OCI', '洋葱皮:显示前后帧残影', () => ctx.toggleOnion(), ctx.onion ? 'active' : '');
    head.appendChild(this.btnOnion);
    const zoomOut = mkBtn('－', '时间轴缩小', () => { this.pxf = Math.max(2, this.pxf - 2); this.refresh(); });
    const zoomIn = mkBtn('＋', '时间轴放大', () => { this.pxf = Math.min(40, this.pxf + 2); this.refresh(); });
    head.appendChild(zoomOut);
    head.appendChild(zoomIn);
  }

  refreshHead() {
    const ctx = this.ctx;
    const anims = ctx.project.armature.animations;
    this.animSel.innerHTML = '';
    for (const a of anims) {
      const op = document.createElement('option');
      op.value = a.name; op.textContent = a.name;
      this.animSel.appendChild(op);
    }
    if (ctx.anim) this.animSel.value = ctx.anim.name;
    this.durInput.value = ctx.anim ? ctx.anim.duration : 30;
    this.btnPlay.innerHTML = ctx.playing ? '⏸' : '▶';
    this.btnPlay.classList.toggle('active', !!ctx.playing);
    this.btnLoop.classList.toggle('active', !!ctx.loop);
    this.btnAutoKey.classList.toggle('active', !!ctx.autoKey);
    this.btnOnion.classList.toggle('active', !!ctx.onion);
  }

  // ---------------- 轨道与关键帧 ----------------

  _lanesWidth() {
    const w = this.el.querySelector('.be-tl-scroll');
    return Math.max(w.clientWidth, (this.ctx.anim ? this.ctx.anim.duration : 60) * this.pxf + 160);
  }

  refresh() {
    if (!this.el) return;
    this.refreshHead();
    const tracks = this.el.querySelector('.be-tl-tracks');
    const lanes = this.el.querySelector('.be-tl-lanes');
    tracks.innerHTML = '';
    lanes.innerHTML = '';
    lanes.style.width = this._lanesWidth() + 'px';

    const ctx = this.ctx;
    const anim = ctx.anim;
    const mkRow = (trackRow, laneRow, laneEl) => {
      tracks.appendChild(trackRow);
      const l = document.createElement('div');
      l.className = 'be-lane' + (laneRow.cls ? ' ' + laneRow.cls : '');
      l.style.height = '24px';
      l.dataset.kind = laneRow.kind || '';
      l.dataset.target = laneRow.target || '';
      l.dataset.channel = laneRow.channel || '';
      laneEl.appendChild(l);
      return l;
    };

    // ---- 骨骼轨道 ----
    for (const bone of bonesInTreeOrder(ctx.project)) {
      const name = bone.name;
      const chs = (anim && anim.bones[name]) || {};
      const hasKeys = BONE_CH.some((c) => (chs[c.id] || []).length);
      const isCollapsed = this.collapsed.has(name);
      const sel = ctx.selection?.type === 'bone' && ctx.selection.name === name;

      const tRow = document.createElement('div');
      tRow.className = 'be-track bone' + (sel ? ' sel' : '');
      tRow.style.paddingLeft = (4 + (bone._depth || 0) * 14) + 'px';
      tRow.innerHTML = `<span class="be-caret ${isCollapsed ? '' : 'open'}">${hasKeys ? '▾' : '▸'}</span><span class="be-track-name">${name}</span>`;
      tRow.querySelector('.be-caret').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.collapsed.has(name)) this.collapsed.delete(name); else this.collapsed.add(name);
        this.refresh();
      });
      tRow.addEventListener('click', () => ctx.select('bone', name));
      tRow.addEventListener('dblclick', () => ctx.insertBoneKeys(name));
      const l = mkRow(tRow, { kind: 'bone', target: name }, lanes);
      // 骨级行:汇总显示所有通道关键帧的并集(细菱形,点击定位)
      if (hasKeys && anim) this._renderKeys(l, name, BONE_CH.map((c) => c.id), false);
      if (anim && !isCollapsed) {
        for (const c of BONE_CH) {
          const ctRow = document.createElement('div');
          ctRow.className = 'be-track ch';
          ctRow.style.paddingLeft = (18 + (bone._depth || 0) * 14) + 'px';
          const marked = (anim.bones[name] && (anim.bones[name][c.id] || []).length) > 0;
          ctRow.innerHTML = `<span class="be-dot" style="background:${marked ? CH_COLOR[c.id] : 'var(--bg4)'}"></span><span>${c.label}</span>`;
          ctRow.addEventListener('click', () => ctx.select('bone', name));
          ctRow.addEventListener('dblclick', () => ctx.insertBoneKeys(name, [c.id]));
          const cl = mkRow(ctRow, { kind: 'ch', target: name, channel: c.id }, lanes);
          if (marked) this._renderKeys(cl, name, [c.id], true);
        }
      }
    }

    // ---- 插槽轨道 ----
    for (const slot of ctx.project.armature.slots) {
      const name = slot.name;
      const chs = (anim && anim.slots[name]) || {};
      const hasKeys = SLOT_CH.some((c) => (chs[c.id] || []).length);
      const isCollapsed = this.collapsed.has('s:' + name);
      const sel = ctx.selection?.type === 'slot' && ctx.selection.name === name;
      const tRow = document.createElement('div');
      tRow.className = 'be-track slot' + (sel ? ' sel' : '');
      tRow.innerHTML = `<span class="be-caret ${isCollapsed ? '' : 'open'}">${hasKeys ? '▾' : '▸'}</span><span class="be-track-name">${name}</span>`;
      tRow.querySelector('.be-caret').addEventListener('click', (e) => {
        e.stopPropagation();
        const k = 's:' + name;
        if (this.collapsed.has(k)) this.collapsed.delete(k); else this.collapsed.add(k);
        this.refresh();
      });
      tRow.addEventListener('click', () => ctx.select('slot', name));
      tRow.addEventListener('dblclick', () => ctx.insertSlotKeys(name));
      const l = mkRow(tRow, { kind: 'slot', target: name }, lanes);
      if (hasKeys && anim) this._renderKeys(l, name, SLOT_CH.map((c) => c.id), false);
      if (anim && !isCollapsed) {
        for (const c of SLOT_CH) {
          const ctRow = document.createElement('div');
          ctRow.className = 'be-track ch';
          const marked = (anim.slots[name] && (anim.slots[name][c.id] || []).length) > 0;
          ctRow.innerHTML = `<span class="be-dot" style="background:${marked ? CH_COLOR[c.id] : 'var(--bg4)'}"></span><span>${c.label}</span>`;
          ctRow.addEventListener('click', () => ctx.select('slot', name));
          ctRow.addEventListener('dblclick', () => ctx.insertSlotKeys(name, [c.id]));
          const cl = mkRow(ctRow, { kind: 'ch', target: name, channel: c.id }, lanes);
          if (marked) this._renderKeys(cl, name, [c.id], true);
        }
      }
    }

    this._drawRuler();
    this.updatePlayhead();
  }

  _renderKeys(lane, target, channels, interactive) {
    const ctx = this.ctx;
    const anim = ctx.anim;
    const isBone = channels[0] !== 'color' && channels[0] !== 'display';
    const store = isBone ? anim.bones[target] : anim.slots[target];
    if (!store) return;
    const keyColor = CH_COLOR;
    for (const ch of channels) {
      const keys = store[ch] || [];
      for (const key of keys) {
        const d = document.createElement('div');
        d.className = 'be-key' + (interactive ? '' : ' mini');
        d.style.left = key.frame * this.pxf + 'px';
        d.style.background = interactive ? keyColor[ch] : undefined;
        const ksel = ctx.keySel && ctx.keySel.target === target && ctx.keySel.channel === ch && ctx.keySel.frame === key.frame;
        if (ksel) d.classList.add('sel');
        if (interactive) {
          d.title = `${channelLabel(ch)} @ ${key.frame} 帧`;
          d.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            ctx.keySel = { target, channel: ch, frame: key.frame };
            ctx.beginEdit('移动关键帧');
            this._dragKey = { key, store: store[ch], moved: false };
            this.refresh();
            ctx.refreshPanelsOnly?.();
          });
          d.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            ctx.keySel = { target, channel: ch, frame: key.frame };
            this._showKeyMenu(e.clientX, e.clientY, store[ch], key);
          });
        }
        lane.appendChild(d);
      }
    }
  }

  _showKeyMenu(x, y, keys, key) {
    const ctx = this.ctx;
    const easeItems = EASE_PRESETS.map((e) => ({
      label: e.label,
      onClick: () => {
        ctx.beginEdit('设置缓动');
        key.ease = { type: e.type };
        if (e.type === 'bezier') key.ease.pts = [0.42, 0, 0.58, 1];
        ctx.refresh();
      },
    }));
    showContextMenu(x, y, [
      { label: '删除关键帧', danger: true, onClick: () => ctx.deleteKey() },
      { label: '复制关键帧', onClick: () => { this.clipboard = { channel: ctx.keySel.channel, v: JSON.parse(JSON.stringify(key.v)), ease: key.ease ? JSON.parse(JSON.stringify(key.ease)) : undefined }; } },
      { label: '粘贴到当前帧', disabled: !this.clipboard, onClick: () => ctx.pasteKey(this.clipboard) },
      { label: '设置缓动 ▸', sub: easeItems },
    ]);
  }

  // ---------------- 刻度尺 / 播放头 / 拖动 ----------------

  _bindRight() {
    const rulerScroll = this.el.querySelector('.be-tl-ruler-scroll');
    const rulerRow = this.el.querySelector('.be-tl-ruler-row');
    const scroll = this.el.querySelector('.be-tl-scroll');

    const scrub = (e) => {
      const r = scroll.getBoundingClientRect();
      const f = Math.max(0, Math.round((e.clientX - r.left + scroll.scrollLeft - 0) / this.pxf));
      this.ctx.setFrame(Math.min(f, this.ctx.anim ? this.ctx.anim.duration : f));
    };
    rulerRow.addEventListener('pointerdown', (e) => {
      this._scrubbing = true;
      scrub(e);
      const mv = (ev) => scrub(ev);
      const up = () => { this._scrubbing = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    scroll.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('be-key')) return;
      scrub(e);
    });
    scroll.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('be-key')) return;
      const lane = e.target.closest('.be-lane');
      if (!lane || !this.ctx.anim) return;
      const r = scroll.getBoundingClientRect();
      const f = Math.max(0, Math.round((e.clientX - r.left + scroll.scrollLeft) / this.pxf));
      if (lane.dataset.kind === 'ch') this.ctx.insertChannelKeyAt(lane.dataset.target, lane.dataset.channel, f);
      else if (lane.dataset.kind === 'bone') this.ctx.insertBoneKeys(lane.dataset.target, undefined, f);
      else if (lane.dataset.kind === 'slot') this.ctx.insertSlotKeys(lane.dataset.target, undefined, f);
    });

    // 水平滚动同步:刻度尺跟随轨道区;播放头重定位
    scroll.addEventListener('scroll', () => {
      rulerScroll.scrollLeft = scroll.scrollLeft;
      this.updatePlayhead();
    });

    // 关键帧拖动(window 级,销毁时解绑)
    this._onWinMove = (e) => {
      const dk = this._dragKey;
      if (!dk) return;
      const r = scroll.getBoundingClientRect();
      const f = Math.max(0, Math.round((e.clientX - r.left + scroll.scrollLeft) / this.pxf));
      if (f !== dk.key.frame) {
        // 碰撞:同帧已有关键帧 → 移除旧的
        const dup = dk.store.findIndex((k) => k !== dk.key && k.frame === f);
        if (dup >= 0) dk.store.splice(dup, 1);
        dk.key.frame = f;
        dk.moved = true;
        this.ctx.keySel = { target: this.ctx.keySel.target, channel: this.ctx.keySel.channel, frame: f };
        this.refresh();
      }
    };
    this._onWinUp = () => {
      if (this._dragKey) {
        if (this._dragKey.moved) this.ctx.refresh();
        this._dragKey = null;
      }
    };
    window.addEventListener('pointermove', this._onWinMove);
    window.addEventListener('pointerup', this._onWinUp);

    // Ctrl+滚轮:时间轴缩放
    scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.pxf = Math.min(40, Math.max(2, this.pxf * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.refresh();
    }, { passive: false });
  }

  _drawRuler() {
    const ruler = this.el.querySelector('.be-tl-ruler');
    const w = this._lanesWidth();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ruler.width = w * dpr;
    ruler.height = 26 * dpr;
    ruler.style.width = w + 'px';
    ruler.style.height = '26px';
    const g = ruler.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, 26);
    g.fillStyle = '#20222b';
    g.fillRect(0, 0, w, 26);
    // 选合适步长(≥44px)
    const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const step = STEPS.find((s) => s * this.pxf >= 44) || 1000;
    for (let f = 0; f * this.pxf <= w; f += step) {
      const x = Math.round(f * this.pxf) + 0.5;
      g.strokeStyle = '#3a3e4a';
      g.beginPath();
      g.moveTo(x, 14); g.lineTo(x, 26);
      g.stroke();
      g.fillStyle = '#9aa1b2';
      g.font = '10px Consolas, monospace';
      g.fillText(String(f), x + 3, 11);
    }
    // 动画时长边界
    if (this.ctx.anim) {
      const x = Math.round(this.ctx.anim.duration * this.pxf) + 0.5;
      g.strokeStyle = '#e5484d';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 26); g.stroke();
    }
  }

  updatePlayhead() {
    if (!this.el) return;
    const ph = this.el.querySelector('.be-tl-playhead');
    if (!ph) return;
    // 播放头是 .be-tl-body 内浮层:left = 轨道区原点 + 帧位置 - 水平滚动量
    const scroll = this.el.querySelector('.be-tl-scroll');
    if (scroll) {
      const sr = scroll.getBoundingClientRect();
      const br = this.el.querySelector('.be-tl-body').getBoundingClientRect();
      ph.style.left = (sr.left - br.left + this.ctx.frame * this.pxf - scroll.scrollLeft) + 'px';
    }
    ph.style.display = this.ctx.mode === 'anim' ? 'block' : 'none';
    const dur = this.ctx.anim ? this.ctx.anim.duration : 0;
    if (this.frameLabel) this.frameLabel.textContent = `${Math.round(this.ctx.frame)} / ${dur} 帧`;
  }

  destroy() {
    if (this._onWinMove) window.removeEventListener('pointermove', this._onWinMove);
    if (this._onWinUp) window.removeEventListener('pointerup', this._onWinUp);
    this.el = null;
  }
}
