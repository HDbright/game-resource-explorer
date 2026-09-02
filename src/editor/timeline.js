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
import icoTabDopesheet from '../assets/spine-icons/skin_icon-tabDopesheet.png';
import icoTabAnimations from '../assets/spine-icons/skin_icon-tabAnimations.png';
import icoTabGraph from '../assets/spine-icons/skin_icon-tabGraph.png';

const CH_COLOR = { translate: '#4f8cff', rotate: '#46a758', scale: '#b8842f', shear: '#e6a817', color: '#c05fd8', display: '#5fa8c0' };
// 动画/曲线侧栏宽度:最小保留原固定宽(容纳曲线画布),最大与层级树右列上限一致
const SIDE_MIN = 170;
const SIDE_MAX = 600;
const SIDE_W_KEY = 'beTlSideW';
const BONE_CH = [
  { id: 'translate', label: '位移' },
  { id: 'rotate', label: '旋转' },
  { id: 'scale', label: '缩放' },
  { id: 'shear', label: '倾斜' },
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
    // 侧栏宽度:用户拖拽值优先;null = 未拖过,默认跟随层级树面板宽度(左边框对齐)
    this.sideWUser = (() => {
      try {
        const w = parseFloat(localStorage.getItem(SIDE_W_KEY));
        return Number.isFinite(w) && w >= SIDE_MIN ? Math.min(SIDE_MAX, w) : null;
      } catch (err) { return null; }
    })();
    this._scrubbing = false;
    this._dragKey = null;
    this.loopStart = 0;         // 循环起始帧
    this.loopEnd = 30;          // 循环结束帧
    this.abA = null;            // AB 播放 A 起点帧(未设置 = null)
    this.abB = null;            // AB 播放 B 结束帧(未设置 = null)
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
          </div>
          <div class="be-tl-playhead"></div>
          <div class="be-tl-endline"></div>
        </div>
        <div class="be-tl-side-resize" title="拖拽调整动画/曲线面板宽度(默认与层级树面板左边缘对齐;双击恢复对齐)"></div>
        <div class="be-tl-side">
          <div class="be-tl-tabs">
            <button data-tab="anim" class="active"><img class="be-tab-ico" src="${icoTabAnimations}" draggable="false" alt="">动画</button>
            <button data-tab="curve"><img class="be-tab-ico" src="${icoTabGraph}" draggable="false" alt="">曲线</button>
          </div>
          <div class="be-tl-side-anim"></div>
          <div class="be-tl-side-curve" hidden></div>
        </div>
      </div>`;
    this._buildTransport();
    this._bindSide();
    this._bindSideResize();
    this._bindRight();
    this._applySide();
    this._applySideW();
    this._watchRightcol();
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
    this.btnLoop = mkIco('<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>', '循环播放 (Ctrl+R)', () => ctx.toggleLoop(), ctx.loop ? 'active be-loop-btn' : 'be-loop-btn');
    mkIco('<svg viewBox="0 0 20 20" width="15" height="15"><circle cx="4" cy="10" r="2.2" fill="currentColor"/><path d="M17 10H8m0 0 3-3m-3 3 3 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', '上一个关键帧 (W)', () => this._stepKey(-1));
    mkIco('<svg viewBox="0 0 20 20" width="15" height="15"><circle cx="16" cy="10" r="2.2" fill="currentColor"/><path d="M3 10h9m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', '下一个关键帧 (S)', () => this._stepKey(1));

    // AB 播放(Spine 风格):点 A/B 采集当前帧为区间端点,再次点击(若位置未变)取消整个 AB 模式;后接数值框可手动改帧
    const mkABInput = (which, title) => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = 0;
      inp.className = 'be-ab-input';
      inp.title = title;
      inp.addEventListener('change', () => {
        const raw = parseFloat(inp.value);
        if (Number.isFinite(raw) && raw >= 0) this['ab' + which] = Math.round(raw);
        else this['ab' + which] = null; // 清空输入 = 取消该端点
        this._syncAB();
      });
      bar.appendChild(inp);
      return inp;
    };
    this.btnAB_A = mkIco('A', '循环起点:点击采集当前帧为 A;再点(位置未变时)取消 AB 播放', () => this._clickAB('A'), 'be-ab-btn');
    this.abAInput = mkABInput('A', 'A 起点帧(可直接输入;清空则取消 A)');
    this.btnAB_B = mkIco('B', '循环终点:点击采集当前帧为 B;再点(位置未变时)取消 AB 播放', () => this._clickAB('B'), 'be-ab-btn');
    this.abBInput = mkABInput('B', 'B 结束帧(可直接输入;清空则取消 B)');

    const sep = () => { const s = document.createElement('span'); s.className = 'be-tl-sep'; bar.appendChild(s); };
    sep();

    // 当前帧:可输入帧号回车跳转(输入中不被播放刷新覆盖;失焦/非法输入恢复实际帧)
    this.frameInput = document.createElement('input');
    this.frameInput.type = 'number';
    this.frameInput.min = 0;
    this.frameInput.className = 'be-tl-frame-input';
    this.frameInput.title = '当前帧:输入帧号后回车跳转';
    const commitFrame = () => {
      const raw = parseFloat(this.frameInput.value);
      if (!Number.isFinite(raw)) { this.frameInput.value = Math.round(this.ctx.frame); return; }
      const max = this.ctx.anim ? this.ctx.anim.duration : Infinity;
      const v = Math.max(0, Math.min(max, Math.round(raw)));
      this.ctx.setFrame(v);
      this.frameInput.value = v;
    };
    this.frameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitFrame(); this.frameInput.blur(); }
      if (e.key === 'Escape') { this.frameInput.value = Math.round(this.ctx.frame); this.frameInput.blur(); }
    });
    this.frameInput.addEventListener('change', commitFrame);
    this.frameInput.addEventListener('blur', () => { this.frameInput.value = Math.round(this.ctx.frame); });
    bar.appendChild(this.frameInput);
    this.frameLabel = document.createElement('span');
    this.frameLabel.className = 'be-tl-frame-suffix';
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

    // 自动关键帧 / 洋葱皮 / 时间轴缩放(左边缘固定,向右伸缩)
    this.btnAutoKey = mkIco('●K', '自动关键帧:动画模式下拖动骨骼自动记录关键帧 (Ctrl+Shift+A)', () => ctx.toggleAutoKey(), ctx.autoKey ? 'active be-autokey' : 'be-autokey');
    this.btnOnion = mkIco('◌', '洋葱皮:显示前后帧残影 (I)', () => ctx.toggleOnion(), ctx.onion ? 'active' : '');
    mkIco('－', '时间轴缩小(刻度尺上滚轮缩放)', () => this._zoomBy(1 / 1.25));
    mkIco('＋', '时间轴放大(刻度尺上滚轮缩放)', () => this._zoomBy(1.25));
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
    // 收起时连左边框拖拽手柄一起隐藏,空间全部让渡给摄影表
    const rz = this.el?.querySelector('.be-tl-side-resize');
    if (rz) rz.style.display = this.sideMin ? 'none' : '';
    if (this.btnSide) {
      this.btnSide.innerHTML = this.sideMin ? '«' : '»';
      this.btnSide.title = this.sideMin ? '展开动画/曲线面板' : '收起动画/曲线面板';
    }
  }

  // ---------------- 侧栏宽度(左边框拖拽 / 默认对齐层级树面板) ----------------

  /** 默认宽度 = 层级树所在右列宽度(两者都锚定窗口右缘,宽度一致即左边框垂直对齐;按应用缩放归一) */
  _defaultSideW() {
    const rc = this.el?.closest('.be-root')?.querySelector('.be-rightcol');
    if (!rc) return 300;
    const w = rc.getBoundingClientRect().width / this._zoomFactor();
    return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(w)));
  }

  /** 应用侧栏宽度:用户拖拽值优先,否则跟随层级树面板宽度 */
  _applySideW() {
    const side = this.el?.querySelector('.be-tl-side');
    if (side) side.style.width = (this.sideWUser ?? this._defaultSideW()) + 'px';
  }

  /** 左边框拖拽调宽:向左拖变宽;松手持久化;双击恢复跟随层级树面板 */
  _bindSideResize() {
    const rz = this.el.querySelector('.be-tl-side-resize');
    if (!rz) return;
    rz.addEventListener('pointerdown', (e) => {
      if (this.sideMin) return;
      e.preventDefault();
      const side = this.el.querySelector('.be-tl-side');
      const zf = this._zoomFactor();
      const startX = e.clientX;
      const startW = side.getBoundingClientRect().width / zf;
      const maxW = Math.max(SIDE_MIN, Math.min(SIDE_MAX, this.el.querySelector('.be-tl-content').clientWidth * 0.6));
      let curW = startW;
      const mv = (ev) => {
        curW = Math.max(SIDE_MIN, Math.min(maxW, startW - (ev.clientX - startX) / zf));
        this.sideWUser = curW;
        side.style.width = curW + 'px';
        this.updatePlayhead(); // 轨道区原点随宽度变化,播放头/时长线同步
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        try { localStorage.setItem(SIDE_W_KEY, String(Math.round(curW))); } catch (err) { /* ignore */ }
        this.refresh(); // 刻度尺/轨道宽度按新侧栏宽度重算
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    rz.addEventListener('dblclick', () => {
      if (this.sideWUser == null) return;
      this.sideWUser = null;
      try { localStorage.removeItem(SIDE_W_KEY); } catch (err) { /* ignore */ }
      this._applySideW();
      this.refresh();
    });
  }

  /** 层级树面板宽度被拖拽/恢复时,侧栏跟随对齐(仅未手动拖宽时) */
  _watchRightcol() {
    const rc = this.el?.closest('.be-root')?.querySelector('.be-rightcol');
    if (!rc || typeof ResizeObserver !== 'function') return;
    this._roSide = new ResizeObserver(() => { if (this.sideWUser == null) this._applySideW(); });
    this._roSide.observe(rc);
  }

  refreshHead() {
    const ctx = this.ctx;
    const cur = this.el.querySelector('.be-tl-cur');
    if (cur) {
      cur.innerHTML = `<img class="be-tab-ico" src="${icoTabDopesheet}" draggable="false" alt=""><span>${ctx.anim ? `摄影表 · ${ctx.anim.name}` : '摄影表'}</span>`;
      // 右键标题:最小化摄影表面板(顶栏 ⧉ 前出现还原图标)
      if (!cur._minCtxBound) {
        cur._minCtxBound = true;
        cur.title = '摄影表面板(右键:最小化)';
        cur.addEventListener('contextmenu', (e) => { e.preventDefault(); ctx.minimizeDopesheet?.(); });
      }
    }
    this.durInput.value = ctx.anim ? ctx.anim.duration : 30;
    this.btnPlay.innerHTML = ctx.playing ? '⏸' : '▶';
    this.btnPlay.classList.toggle('active', !!ctx.playing);
    this.btnLoop.classList.toggle('active', !!ctx.loop);
    this.btnAutoKey.classList.toggle('active', !!ctx.autoKey);
    this.btnOnion.classList.toggle('active', !!ctx.onion);
    // 同步 AB 播放按钮高亮
    if (this.btnAB_A) this.btnAB_A.classList.toggle('active', this.abA != null);
    if (this.btnAB_B) this.btnAB_B.classList.toggle('active', this.abB != null);
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

    // 轨道列表与层级树联动:选中骨骼 → 仅显示该骨骼轨道;选中插槽/附件 → 仅显示该插槽轨道
    // (选中节点即使暂无关键帧也显示 —— 它是自动打帧的落点);无选中 → 仅显示有关键帧的轨道
    const selType = ctx.selection && ctx.selection.type;
    const selBoneName = selType === 'bone' ? ctx.selection.name : null;
    const selSlotName = selType === 'slot' ? ctx.selection.name : (selType === 'att' ? ctx.selection.slot : null);
    const hasSel = !!(selBoneName || selSlotName);

    // ---- 骨骼轨道 ----
    for (const bone of bonesInTreeOrder(ctx.project)) {
      const name = bone.name;
      const chs = (anim && anim.bones[name]) || {};
      const hasKeys = BONE_CH.some((c) => (chs[c.id] || []).length);
      if (selBoneName ? name !== selBoneName : (hasSel || !hasKeys)) continue; // 联动过滤 + 无键隐藏
      const isCollapsed = this.collapsed.has(name);
      const sel = ctx.selection?.type === 'bone' && ctx.selection.name === name;

      const tRow = document.createElement('div');
      tRow.className = 'be-track bone' + (sel ? ' sel' : '');
      tRow.style.paddingLeft = (4 + (bone._depth || 0) * 14) + 'px';
      tRow.innerHTML = `<span class="be-caret ${isCollapsed ? '' : 'open'}">${isCollapsed ? '▸' : '▾'}</span><span class="be-track-name">${name}</span>`;
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
          const marked = (anim.bones[name] && (anim.bones[name][c.id] || []).length) > 0;
          if (!marked) continue; // 无关键帧的通道行隐藏
          const ctRow = document.createElement('div');
          ctRow.className = 'be-track ch';
          ctRow.style.paddingLeft = (18 + (bone._depth || 0) * 14) + 'px';
          ctRow.innerHTML = `<span class="be-dot" style="background:${CH_COLOR[c.id]}"></span><span>${c.label}</span>`;
          ctRow.addEventListener('click', () => ctx.select('bone', name));
          ctRow.addEventListener('dblclick', () => ctx.insertBoneKeys(name, [c.id]));
          const cl = mkRow(ctRow, { kind: 'ch', target: name, channel: c.id }, lanes);
          this._renderKeys(cl, name, [c.id], true);
        }
      }
    }

    // ---- 插槽轨道 ----
    for (const slot of ctx.project.armature.slots) {
      const name = slot.name;
      const chs = (anim && anim.slots[name]) || {};
      const hasKeys = SLOT_CH.some((c) => (chs[c.id] || []).length);
      if (selSlotName ? name !== selSlotName : (hasSel || !hasKeys)) continue; // 联动过滤 + 无键隐藏
      const isCollapsed = this.collapsed.has('s:' + name);
      const sel = ctx.selection?.type === 'slot' && ctx.selection.name === name;
      const tRow = document.createElement('div');
      tRow.className = 'be-track slot' + (sel ? ' sel' : '');
      tRow.innerHTML = `<span class="be-caret ${isCollapsed ? '' : 'open'}">${isCollapsed ? '▸' : '▾'}</span><span class="be-track-name">${name}</span>`;
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
          const marked = (anim.slots[name] && (anim.slots[name][c.id] || []).length) > 0;
          if (!marked) continue; // 无关键帧的通道行隐藏
          const ctRow = document.createElement('div');
          ctRow.className = 'be-track ch';
          ctRow.innerHTML = `<span class="be-dot" style="background:${CH_COLOR[c.id]}"></span><span>${c.label}</span>`;
          ctRow.addEventListener('click', () => ctx.select('slot', name));
          ctRow.addEventListener('dblclick', () => ctx.insertSlotKeys(name, [c.id]));
          const cl = mkRow(ctRow, { kind: 'ch', target: name, channel: c.id }, lanes);
          this._renderKeys(cl, name, [c.id], true);
        }
      }
    }

    this._drawRuler();
    this.updatePlayhead();
  }

  /**
   * 拖拽中轻量刷新:只更新当前选中目标的轨道关键帧(不重建整个 DOM 树)。
   * 舞台手柄拖拽(pointermove 高频触发)期间由 ctx.editBone 调用,把全量 refresh()
   * 从每次 17ms(64 骨骼×52 插槽全量重建)降为 <1ms;拖拽结束(pointerup)再全量重建一次。
   */
  lightweightRefresh(target, isSlot = false) {
    if (!this.el) return;
    const anim = this.ctx.anim;
    if (!anim) return;
    const store = isSlot ? anim.slots[target] : anim.bones[target];
    if (!store) return;
    // 定位该目标对应的轨道 lane(骨级行 + 展开的通道行)
    const lanes = this.el.querySelectorAll('.be-lane');
    for (const lane of lanes) {
      const t = lane.dataset.target || '';
      const ch = lane.dataset.channel || '';
      if (t !== target || !ch) continue;
      // 清空该 lane 的关键帧元素,保留 lane 本身(轨道名行不重建)
      const kids = [...lane.children];
      for (const k of kids) k.remove();
      const isBone = !isSlot;
      if (isBone && BONE_CH.some((c) => c.id === ch)) {
        this._renderKeys(lane, target, [ch], true);
      } else if (!isBone && SLOT_CH.some((c) => c.id === ch)) {
        this._renderKeys(lane, target, [ch], true);
      }
    }
    // 骨级行(汇总通道并集)
    for (const lane of lanes) {
      if ((lane.dataset.target || '') !== target || lane.dataset.channel) continue;
      const kids = [...lane.children];
      for (const k of kids) k.remove();
      const CHS = isSlot ? SLOT_CH.map((c) => c.id) : BONE_CH.map((c) => c.id);
      this._renderKeys(lane, target, CHS, false);
    }
    // 首键兜底:「无关键帧的通道行/轨道不渲染」意味着拖拽前无键的通道没有 lane ——
    // 拖拽中打进第一个关键帧时 lane 缺失,补一次全量重建让轨道出现(仅此一次,后续照常轻量)。
    // 轨道处于折叠态时通道行本就不存在,属正常,不触发兜底。
    const collapseKey = isSlot ? 's:' + target : target;
    if (!this.collapsed.has(collapseKey)) {
      const CHS = isSlot ? SLOT_CH : BONE_CH;
      for (const c of CHS) {
        if (!(store[c.id] || []).length) continue;
        const laneMissing = ![...this.el.querySelectorAll('.be-lane')].some((l) => l.dataset.target === target && l.dataset.channel === c.id);
        if (laneMissing) { this.refresh(); return; }
      }
    }
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
      const f = Math.max(0, Math.round((this._localX(e, scroll) + scroll.scrollLeft) / this.pxf));
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
      const f = Math.max(0, Math.round((this._localX(e, scroll) + scroll.scrollLeft) / this.pxf));
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
      const f = Math.max(0, Math.round((this._localX(e, scroll) + scroll.scrollLeft) / this.pxf));
      if (f !== dk.key.frame) {
        // 碰撞:同帧已有关键帧 → 移除旧的
        const dup = dk.store.findIndex((k) => k !== dk.key && k.frame === f);
        if (dup >= 0) dk.store.splice(dup, 1);
        dk.key.frame = f;
        dk.moved = true;
        this.ctx.keySel = { target: this.ctx.keySel.target, channel: this.ctx.keySel.channel, frame: f };
        // 拖拽中只重绘受影响轨道(全量重建 ~17ms/次,pointermove 高频触发掉帧);松手再全量
        const chId = this.ctx.keySel.channel;
        this.lightweightRefresh(this.ctx.keySel.target, chId === 'color' || chId === 'display');
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

    // 悬停刻度尺:滚轮直接缩放(左边缘固定);轨道区 Ctrl+滚轮同
    rulerScroll.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this._zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  /** 应用级 CSS zoom 系数(外观设置「字体字号缩放」写 #app.style.zoom):
   *  zoom≠1 时 clientX 是根视口像素、getBoundingClientRect 是视觉像素,二者相减须除回该系数 */
  _zoomFactor() {
    try {
      const z = parseFloat(getComputedStyle(document.getElementById('app')).zoom);
      return Number.isFinite(z) && z > 0 ? z : 1;
    } catch (err) { return 1; }
  }

  /** 事件 X -> 轨道区局部 CSS 坐标(含缩放归一) */
  _localX(e, el) {
    const r = el.getBoundingClientRect();
    return (e.clientX - r.left) / this._zoomFactor();
  }

  /** AB 播放:点击 A/B 采集当前帧;再点同一按钮时位置未变 → 取消整个 AB 模式 */
  _clickAB(which) {
    const cur = Math.round(this.ctx.frame);
    if (which === 'A') {
      if (this.abA == null || cur !== this.abA) this.abA = cur;
      else { this.abA = null; this.abB = null; } // 回到 A 起点 → 取消 AB 模式
    } else {
      if (this.abB == null || cur !== this.abB) this.abB = cur;
      else { this.abA = null; this.abB = null; }
    }
    this._syncAB();
  }

  /** AB 状态 → 按钮高亮 + 输入框数值 + 循环区间(loopStart/loopEnd,驱动区间着色与播放循环) */
  _syncAB() {
    if (this.btnAB_A) this.btnAB_A.classList.toggle('active', this.abA != null);
    if (this.btnAB_B) this.btnAB_B.classList.toggle('active', this.abB != null);
    if (this.abAInput) this.abAInput.value = this.abA == null ? '' : this.abA;
    if (this.abBInput) this.abBInput.value = this.abB == null ? '' : this.abB;
    if (this.abA != null && this.abB != null && this.abA !== this.abB) {
      this.loopStart = Math.min(this.abA, this.abB);
      this.loopEnd = Math.max(this.abA, this.abB);
    } else {
      this.loopStart = 0; this.loopEnd = 0; // 未成对设置:不显示区间、不做 AB 循环
    }
    this.refresh(); // 重画刻度尺区间着色
  }

  /** 缩放时间轴:左边缘(起点帧)固定不动,仅向右伸缩 */
  _zoomBy(factor) {
    const scroll = this.el.querySelector('.be-tl-scroll');
    const oldPxf = this.pxf;
    this.pxf = Math.min(40, Math.max(2, this.pxf * factor));
    if (this.pxf === oldPxf) return;
    if (!scroll) { this.refresh(); return; }
    const leftFrame = scroll.scrollLeft / oldPxf; // 左边缘当前所在帧,缩放后钉在原处
    this.refresh();
    scroll.scrollLeft = Math.max(0, Math.round(leftFrame * this.pxf));
    const rs = this.el.querySelector('.be-tl-ruler-scroll');
    if (rs) rs.scrollLeft = scroll.scrollLeft;
    this.updatePlayhead();
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
    g.fillStyle = '#33363f';
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
    g.strokeStyle = '#7a7f8c';
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
      g.strokeStyle = '#858a98';
      g.beginPath();
      g.moveTo(x, 12); g.lineTo(x, 26);
      g.stroke();
      g.fillStyle = '#d5dae4';
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

    // 动画时长边界改由 DOM 浮层 .be-tl-endline 渲染(贯穿刻度尺与全部轨道行,随滚动/缩放同步)
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
    const scroll = this.el.querySelector('.be-tl-scroll');
    if (scroll) {
      const sr = scroll.getBoundingClientRect();
      const br = this.el.querySelector('.be-tl-body').getBoundingClientRect();
      // sr/br 均为视觉像素,差值须除回缩放系数换算成 CSS 像素
      const base = (sr.left - br.left) / this._zoomFactor() - scroll.scrollLeft;
      // 播放头是 .be-tl-center 内浮层:left = 轨道区原点 + 帧位置 - 水平滚动量
      if (ph) ph.style.left = (base + this.ctx.frame * this.pxf) + 'px';
      // 动画时长边界红线:与播放头同构,贯穿刻度尺与全部轨道行
      const en = this.el.querySelector('.be-tl-endline');
      if (en) {
        const dur = this.ctx.anim ? this.ctx.anim.duration : 0;
        en.style.left = (base + dur * this.pxf) + 'px';
        en.style.display = (this.ctx.mode === 'anim' && dur > 0) ? 'block' : 'none';
      }
    }
    if (ph) ph.style.display = this.ctx.mode === 'anim' ? 'block' : 'none';
    const dur = this.ctx.anim ? this.ctx.anim.duration : 0;
    // 输入中不覆盖(避免打字被播放刷新打断);后缀显示总帧数
    if (this.frameInput && document.activeElement !== this.frameInput) this.frameInput.value = Math.round(this.ctx.frame);
    if (this.frameLabel) this.frameLabel.textContent = `/ ${dur} 帧`;
  }

  destroy() {
    if (this._onWinMove) window.removeEventListener('pointermove', this._onWinMove);
    if (this._onWinUp) window.removeEventListener('pointerup', this._onWinUp);
    if (this._roSide) { this._roSide.disconnect(); this._roSide = null; }
    this.el = null;
  }
}
