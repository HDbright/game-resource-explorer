/**
 * 骨骼动画编辑器 - 底部时间轴(摄影表,参考 Spine 布局)。
 *
 * 结构:
 *   顶部:紧凑图标传输条(到头/上一帧/播放/下一帧/到尾/循环 | 帧计数 | 时长 | 自动K/洋葱皮/缩放)
 *   内容区左:轨道树 —— 总轨道(全部关键帧汇总) / 事件轨道(浅蓝行) /
 *             骨骼(位移·旋转·缩放子轨道) / 插槽(颜色·显示),树形层级可折叠
 *   内容区中:刻度尺 + 关键帧菱形(可拖动/右键缓动) + 播放头(可拖动)
 *   内容区右:侧栏标签页(动画列表 / 曲线)
 *
 * 重建策略:refresh() 全量;updatePlayhead() 仅移动播放头与帧计数(播放中每帧调用)。
 */

import { showContextMenu } from '../dialogs.js';
import { EASE_PRESETS, bonesInTreeOrder, defaultEase } from './model.js';
import { channelLabel, drawEaseCurve } from './panels.js';

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class EditorTimeline {
  constructor(ctx) {
    this.ctx = ctx;
    this.pxf = 9;             // 每帧像素
    this.collapsed = new Set(); // 展开状态:骨骼名折叠集合
    this.clipboard = null;      // 复制的关键帧 { channel, v, ease }
    this.sideTab = 'anim';      // 右侧侧栏当前标签:anim | curve
    this._scrubbing = false;
    this._dragKey = null;
    this.loopStart = 0;         // 循环起始帧
    this.loopEnd = 30;          // 循环结束帧
  }

  mount(el) {
    this.el = el;
    this.sideMin = (() => { try { return localStorage.getItem('beTlSideMin') === '1'; } catch (err) { return false; } })();
    // 结构(参考 Spine 摄影表):
    //   顶栏紧凑图标传输控制 → 内容区 = 中间(刻度尺固定行 + 左轨道树 + 右轨道区)
    //   摄影表右侧为侧栏(动画列表/曲线,可收起为传输条尾部图标);播放头为 body 级浮层,贯穿刻度尺与全部轨道行
    el.innerHTML = `
      <div class="be-tl-transport"></div>
      <div class="be-tl-content">
        <div class="be-tl-center">
          <div class="be-tl-ruler-row">
            <div class="be-tl-ruler-spacer" title="当前动画;点击打开右侧动画列表"><span class="be-tl-cur"></span></div>
            <div class="be-tl-ruler-scroll"><canvas class="be-tl-ruler" height="26"></canvas></div>
          </div>
          <div class="be-tl-body">
            <div class="be-tl-left"><div class="be-tl-tracks"></div></div>
            <div class="be-tl-scroll">
              <div class="be-tl-lanes"></div>
            </div>
            <div class="be-tl-playhead"></div>
          </div>
        </div>
        <div class="be-tl-side">
          <div class="be-tl-tabs">
            <button data-tab="anim" class="active">动画</button>
            <button data-tab="curve">曲线</button>
          </div>
          <div class="be-tl-side-anim"></div>
          <div class="be-tl-side-curve" hidden></div>
        </div>
      </div>`;
    this._buildTransport();
    this._bindSide();
    this._bindRight();
    this._applySide();
    this.refresh();
  }

  // ---------------- 顶部传输控制条(紧凑图标) ----------------

  _buildTransport() {
    const ctx = this.ctx;
    const bar = this.el.querySelector('.be-tl-transport');
    bar.innerHTML = '';

    const mkIco = (html, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'be-tl-ico ' + cls;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };

    // 传输控制(Spine 快捷键:D 播放 / A 反向 / Q 首帧 / E 末帧 / R·F 前后帧 / W·S 前后关键帧)
    mkIco('⏮', '跳到开头 (Q)', () => ctx.setFrame(0));
    mkIco('◀', '上一帧 (F,Shift×10)', () => ctx.setFrame(Math.round(ctx.frame) - 1));
    this.btnPlay = mkIco('▶', '播放/暂停 (D;A=反向播放)', () => ctx.togglePlay());
    mkIco('▶|', '下一帧 (R,Shift×10)', () => ctx.setFrame(Math.round(ctx.frame) + 1));
    mkIco('⏭', '跳到结尾 (E)', () => ctx.setFrame(ctx.anim ? ctx.anim.duration : 0));
    this.btnLoop = mkIco('🔁', '循环播放 (Ctrl+R)', () => ctx.toggleLoop(), ctx.loop ? 'active' : '');
    mkIco('◀◀', '上一个关键帧 (W)', () => this._stepKey(-1));
    mkIco('▶▶', '下一个关键帧 (S)', () => this._stepKey(1));

    // 循环起止(Spine 风格:循环开始 / 结束 帧号输入)
    const loopStartLabel = document.createElement('label');
    loopStartLabel.className = 'be-tl-dur';
    loopStartLabel.innerHTML = '<span>循环</span>';
    this.loopStartInput = document.createElement('input');
    this.loopStartInput.type = 'number';
    this.loopStartInput.min = 0;
    this.loopStartInput.value = 0;
    this.loopStartInput.title = '循环起始帧';
    this.loopStartInput.style.width = '40px';
    this.loopStartInput.addEventListener('change', () => {
      const v = Math.max(0, Math.round(parseFloat(this.loopStartInput.value) || 0));
      this.loopStart = v;
    });
    loopStartLabel.appendChild(this.loopStartInput);
    bar.appendChild(loopStartLabel);
    const loopEndLabel = document.createElement('label');
    loopEndLabel.className = 'be-tl-dur';
    loopEndLabel.innerHTML = '<span>结束</span>';
    this.loopEndInput = document.createElement('input');
    this.loopEndInput.type = 'number';
    this.loopEndInput.min = 1;
    this.loopEndInput.value = 30;
    this.loopEndInput.title = '循环结束帧';
    this.loopEndInput.style.width = '40px';
    this.loopEndInput.addEventListener('change', () => {
      const v = Math.max(1, Math.round(parseFloat(this.loopEndInput.value) || 30));
      this.loopEnd = v;
    });
    loopEndLabel.appendChild(this.loopEndInput);
    bar.appendChild(loopEndLabel);

    const sep = () => { const s = document.createElement('span'); s.className = 'be-tl-sep'; bar.appendChild(s); };
    sep();

    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'be-tl-frame';
    bar.appendChild(this.frameLabel);
    sep();

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
    bar.appendChild(durRow);

    const sp = document.createElement('span');
    sp.className = 'spacer';
    bar.appendChild(sp);

    // 自动关键帧 / 洋葱皮 / 时间轴缩放(以轨道区中心为锚点)
    this.btnAutoKey = mkIco('●K', '自动关键帧:动画模式下拖动骨骼自动记录关键帧 (Ctrl+Shift+A)', () => ctx.toggleAutoKey(), ctx.autoKey ? 'active be-autokey' : 'be-autokey');
    this.btnOnion = mkIco('◌', '洋葱皮:显示前后帧残影 (I)', () => ctx.toggleOnion(), ctx.onion ? 'active' : '');
    const zoomAtCenter = (f) => {
      const s = this.el.querySelector('.be-tl-scroll');
      if (!s) { this.pxf = Math.min(40, Math.max(2, this.pxf * f)); this.refresh(); return; }
      const r = s.getBoundingClientRect();
      this._zoomBy(f, r.left + r.width / 2);
    };
    mkIco('－', '时间轴缩小(刻度尺上滚轮缩放)', () => zoomAtCenter(1 / 1.25));
    mkIco('＋', '时间轴放大(刻度尺上滚轮缩放)', () => zoomAtCenter(1.25));
    // 动画/曲线侧栏收起开关(收起后空间让渡给摄影表)
    this.btnSide = mkIco('»', '收起动画/曲线面板', () => this._toggleSide(), 'be-tl-side-toggle');
  }

  /** 收起/展开右侧「动画·曲线」侧栏(收起为传输条尾部图标;状态持久化) */
  _toggleSide() {
    this.sideMin = !this.sideMin;
    try { localStorage.setItem('beTlSideMin', this.sideMin ? '1' : '0'); } catch (err) { /* ignore */ }
    this._applySide();
    this.refresh();
  }

  _applySide() {
    const side = this.el?.querySelector('.be-tl-side');
    if (side) side.style.display = this.sideMin ? 'none' : '';
    if (this.btnSide) {
      this.btnSide.innerHTML = this.sideMin ? '«' : '»';
      this.btnSide.title = this.sideMin ? '展开动画/曲线面板' : '收起动画/曲线面板';
    }
  }

  refreshHead() {
    const ctx = this.ctx;
    const cur = this.el.querySelector('.be-tl-cur');
    if (cur) cur.textContent = ctx.anim ? `摄影表 · ${ctx.anim.name}` : '摄影表';
    this.durInput.value = ctx.anim ? ctx.anim.duration : 30;
    this.btnPlay.innerHTML = ctx.playing ? '⏸' : '▶';
    this.btnPlay.classList.toggle('active', !!ctx.playing);
    this.btnLoop.classList.toggle('active', !!ctx.loop);
    this.btnAutoKey.classList.toggle('active', !!ctx.autoKey);
    this.btnOnion.classList.toggle('active', !!ctx.onion);
    // 同步循环起止帧输入
    if (this.loopStartInput) this.loopStartInput.value = this.loopStart;
    if (this.loopEndInput) this.loopEndInput.value = this.loopEnd;
    this._renderAnimList();
    if (this.sideTab === 'curve') this._renderCurveTab();
  }

  // ---------------- 右侧侧栏(动画列表 / 曲线) ----------------

  _bindSide() {
    const side = this.el.querySelector('.be-tl-side');
    side.querySelector('.be-tl-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      this.sideTab = btn.dataset.tab;
      side.querySelectorAll('.be-tl-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      side.querySelector('.be-tl-side-anim').hidden = this.sideTab !== 'anim';
      side.querySelector('.be-tl-side-curve').hidden = this.sideTab !== 'curve';
      if (this.sideTab === 'curve') this._renderCurveTab();
    });
  }

  _renderAnimList() {
    const ctx = this.ctx;
    const box = this.el.querySelector('.be-tl-side-anim');
    if (!box) return;
    box.innerHTML = '';
    const ops = document.createElement('div');
    ops.className = 'be-anim-ops';
    const mkOp = (html, title, fn) => {
      const b = document.createElement('button');
      b.className = 'be-anim-op';
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      ops.appendChild(b);
    };
    mkOp('＋', '新建动画', () => ctx.newAnimation());
    mkOp('✎', '重命名当前动画', () => ctx.renameAnimation());
    mkOp('🗑', '删除当前动画', () => ctx.deleteAnimation());
    box.appendChild(ops);
    for (const a of ctx.project.armature.animations) {
      const row = document.createElement('div');
      row.className = 'be-anim-row' + (ctx.anim && ctx.anim.name === a.name ? ' active' : '');
      row.title = a.name;
      row.innerHTML = `<span class="be-anim-name">${escapeHtml(a.name)}</span><span class="be-anim-dur">${a.duration}帧</span>`;
      row.addEventListener('click', () => ctx.setAnimation(a.name));
      box.appendChild(row);
    }
  }

  _renderCurveTab() {
    const ctx = this.ctx;
    const box = this.el.querySelector('.be-tl-side-curve');
    if (!box) return;
    box.innerHTML = '';
    const ks = ctx.keySel;
    const key = ks ? ctx.findKey(ks) : null;
    if (!key) {
      const hint = document.createElement('div');
      hint.className = 'be-tl-side-hint';
      hint.innerHTML = '在摄影表中选中一个关键帧<br>(右键也可设缓动),<br>这里会显示并编辑它的缓动曲线。';
      box.appendChild(hint);
      return;
    }
    if (!key.ease) key.ease = defaultEase();
    const ease = key.ease;
    const title = document.createElement('div');
    title.className = 'be-curve-title';
    title.textContent = `${ks.target} · ${channelLabel(ks.channel)} @ ${ks.frame}帧`;
    box.appendChild(title);
    const cv = document.createElement('canvas');
    cv.width = 140;
    cv.height = 108;
    cv.className = 'be-ease-curve';
    drawEaseCurve(cv, ease);
    box.appendChild(cv);
    const sel = document.createElement('select');
    sel.className = 'be-ease-sel';
    for (const e of EASE_PRESETS) {
      const op = document.createElement('option');
      op.value = e.type;
      op.textContent = e.label;
      sel.appendChild(op);
    }
    sel.value = ease.type;
    sel.addEventListener('change', () => {
      ctx.beginEdit('设置缓动');
      ease.type = sel.value;
      if (ease.type === 'bezier' && !ease.pts) ease.pts = [0.42, 0, 0.58, 1];
      ctx.refresh();
    });
    box.appendChild(sel);
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
      l.style.height = '20px';
      l.dataset.kind = laneRow.kind || '';
      l.dataset.target = laneRow.target || '';
      l.dataset.channel = laneRow.channel || '';
      laneEl.appendChild(l);
      return l;
    };

    // ---- 总轨道:全部关键帧汇总(细菱形,定位参考) ----
    {
      const tRow = document.createElement('div');
      tRow.className = 'be-track summary';
      tRow.innerHTML = '<span class="be-caret"></span><span class="be-track-name">总轨道</span>';
      const l = mkRow(tRow, { kind: 'all' }, lanes);
      if (anim) {
        const frames = new Set();
        const collect = (store) => { for (const ch of Object.values(store || {})) for (const k of ch) frames.add(k.frame); };
        for (const b of Object.values(anim.bones)) collect(b);
        for (const s of Object.values(anim.slots)) collect(s);
        for (const f of [...frames].sort((a, b) => a - b)) {
          const d = document.createElement('div');
          d.className = 'be-key mini';
          d.style.left = f * this.pxf + 'px';
          l.appendChild(d);
        }
      }
    }

    // ---- 事件轨道(Spine 风格:事件名标记 + 事件轨道名显示事件列表) ----
    {
      const tRow = document.createElement('div');
      tRow.className = 'be-track event';
      // 收集所有事件名(用于轨道名显示)
      const evNames = [];
      if (anim) {
        for (const ev of (anim.rawKeep && anim.rawKeep.events) || []) {
          if (ev.name && !evNames.includes(ev.name)) evNames.push(ev.name);
        }
      }
      tRow.innerHTML = `<span class="be-caret"></span><span class="be-track-name">${evNames.length ? '事件:' + evNames.join(',') : '事件轨道'}</span>`;
      const l = mkRow(tRow, { kind: 'event', cls: 'event' }, lanes);
      if (anim) {
        const fps = (ctx.project.spine && ctx.project.spine.frameRate) || 30;
        for (const ev of (anim.rawKeep && anim.rawKeep.events) || []) {
          const f = Math.round((ev.time || 0) * fps);
          const d = document.createElement('div');
          d.className = 'be-key mini event';
          d.style.left = f * this.pxf + 'px';
          d.title = `${ev.name || 'event'} @ ${f} 帧`;
          l.appendChild(d);
          // 事件名标签(显示在关键帧下方)
          if (ev.name) {
            const lbl = document.createElement('span');
            lbl.className = 'be-key-lbl';
            lbl.textContent = ev.name;
            lbl.style.left = (f * this.pxf + 4) + 'px';
            l.appendChild(lbl);
          }
        }
      }
    }

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
      // 关键帧连接线(Spine 风格:同通道相邻关键帧之间画水平细线)
      if (keys.length > 1 && interactive) {
        for (let i = 0; i < keys.length - 1; i++) {
          const x0 = keys[i].frame * this.pxf + 5.5;
          const x1 = keys[i + 1].frame * this.pxf - 5.5;
          if (x1 <= x0) continue;
          const line = document.createElement('div');
          line.className = 'be-key-line';
          line.style.left = x0 + 'px';
          line.style.width = (x1 - x0) + 'px';
          line.style.background = keyColor[ch] || '#4f8cff';
          lane.appendChild(line);
        }
      }
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
    // 刻度尺左空位(当前动画名):点击 → 切到右侧动画列表(已收起则先展开)
    this.el.querySelector('.be-tl-ruler-spacer').addEventListener('click', () => {
      if (this.sideMin) this._toggleSide();
      this.el.querySelector('.be-tl-tabs button[data-tab=anim]')?.click();
    });
    rulerRow.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.be-tl-ruler-spacer')) return;
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
      if (lane.dataset.kind !== 'ch' && lane.dataset.kind !== 'bone' && lane.dataset.kind !== 'slot') return;
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

    // 悬停刻度尺:滚轮直接缩放(以鼠标位置为锚点);轨道区 Ctrl+滚轮同
    rulerScroll.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
    }, { passive: false });
    scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this._zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
    }, { passive: false });
  }

  /** 缩放时间轴;anchorClientX 给定时保持该屏幕位置下的帧不动(锚点缩放) */
  _zoomBy(factor, anchorClientX) {
    const scroll = this.el.querySelector('.be-tl-scroll');
    const oldPxf = this.pxf;
    this.pxf = Math.min(40, Math.max(2, this.pxf * factor));
    if (this.pxf === oldPxf) return;
    if (anchorClientX != null && scroll) {
      const r = scroll.getBoundingClientRect();
      const frameAt = (anchorClientX - r.left + scroll.scrollLeft) / oldPxf;
      this.refresh();
      scroll.scrollLeft = Math.max(0, frameAt * this.pxf - (anchorClientX - r.left));
      const rs = this.el.querySelector('.be-tl-ruler-scroll');
      rs.scrollLeft = scroll.scrollLeft;
      this.updatePlayhead();
    } else {
      this.refresh();
    }
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

    const ctx = this.ctx;
    const anim = ctx.anim;
    const fps = (ctx.project.frameRate || 30);
    const pxf = this.pxf;

    // ---- 循环区间着色(Spine 风格:loopStart→loopEnd 浅色半透明背景) ----
    if (anim && this.loopEnd > this.loopStart) {
      const x0 = Math.round(this.loopStart * pxf);
      const x1 = Math.round(Math.min(anim.duration, this.loopEnd) * pxf);
      g.fillStyle = 'rgba(255,159,67,.10)';
      g.fillRect(x0, 0, x1 - x0, 26);
    }

    // 两级刻度
    const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let minor = NICE.find((s) => s * pxf >= 7) || 1000;
    const major = NICE.find((s) => s * pxf >= 44) || 1000;
    let mi = NICE.indexOf(minor);
    while (mi < NICE.length - 1 && major % NICE[mi] !== 0) mi++;
    minor = NICE[mi];
    const maxF = Math.ceil(w / pxf);
    // 小刻度(下半段 18→26)
    g.strokeStyle = '#333642';
    g.beginPath();
    for (let f = minor; f <= maxF; f += minor) {
      if (f % major === 0) continue;
      const x = Math.round(f * pxf) + 0.5;
      g.moveTo(x, 18); g.lineTo(x, 26);
    }
    g.stroke();
    // 大刻度(12→26)+ 数字
    for (let f = 0; f <= maxF; f += major) {
      const x = Math.round(f * pxf) + 0.5;
      g.strokeStyle = '#3a3e4a';
      g.beginPath();
      g.moveTo(x, 12); g.lineTo(x, 26);
      g.stroke();
      g.fillStyle = '#9aa1b2';
      g.font = '10px Consolas, monospace';
      g.fillText(String(f), x + 3, 11);
    }

    // ---- 关键帧标记(Spine 风格:刻度尺顶部红色小菱形,标记所有关键帧位置) ----
    if (anim) {
      const frames = new Set();
      const collect = (store) => { for (const ch of Object.values(store || {})) for (const k of ch) frames.add(k.frame); };
      for (const b of Object.values(anim.bones)) collect(b);
      for (const s of Object.values(anim.slots)) collect(s);
      g.fillStyle = '#e5484d';
      for (const f of frames) {
        const x = Math.round(f * pxf);
        g.save();
        g.translate(x + 0.5, 4.5);
        g.rotate(Math.PI / 4);
        g.fillRect(-2, -2, 4, 4);
        g.restore();
      }
    }

    // ---- 循环起止标记线(橙色竖线 + 帧号标注) ----
    if (anim && this.loopEnd > this.loopStart) {
      // 循环起始线
      const lx0 = Math.round(this.loopStart * pxf) + 0.5;
      g.strokeStyle = '#ff9f43';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(lx0, 0); g.lineTo(lx0, 26); g.stroke();
      // 循环结束线
      const lx1 = Math.round(Math.min(anim.duration, this.loopEnd) * pxf) + 0.5;
      g.beginPath(); g.moveTo(lx1, 0); g.lineTo(lx1, 26); g.stroke();
      g.lineWidth = 1;
      // 帧号标注
      g.fillStyle = '#ff9f43';
      g.font = '9px Consolas, monospace';
      if (this.loopStart > 0) g.fillText(String(this.loopStart), lx0 + 2, 9);
      if (this.loopEnd < anim.duration) g.fillText(String(this.loopEnd), lx1 + 2, 9);
    }

    // 动画时长边界(红色)
    if (anim) {
      const x = Math.round(anim.duration * pxf) + 0.5;
      g.strokeStyle = '#e5484d';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 26); g.stroke();
    }
  }

  /** 跳到上一个/下一个关键帧(dir=-1/+1) */
  _stepKey(dir) {
    const ctx = this.ctx;
    const anim = ctx.anim;
    if (!anim) return;
    const cur = Math.round(ctx.frame);
    let best = null;
    const scan = (store) => {
      for (const ch of Object.values(store || {})) {
        for (const k of ch) {
          const f = k.frame;
          if (dir > 0 ? (f > cur && (best === null || f < best)) : (f < cur && (best === null || f > best))) best = f;
        }
      }
    };
    for (const b of Object.values(anim.bones)) scan(b);
    for (const s of Object.values(anim.slots)) scan(s);
    if (best !== null) ctx.setFrame(best);
  }

  /** 滚动轨道区使指定帧可见(居中);'/' 快捷键用(Spine Scroll To Selected) */
  scrollToFrame(f) {
    if (!this.el) return;
    const scroll = this.el.querySelector('.be-tl-scroll');
    if (!scroll) return;
    scroll.scrollLeft = Math.max(0, f * this.pxf - scroll.clientWidth / 2);
    const rs = this.el.querySelector('.be-tl-ruler-scroll');
    if (rs) rs.scrollLeft = scroll.scrollLeft;
    this.updatePlayhead();
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
