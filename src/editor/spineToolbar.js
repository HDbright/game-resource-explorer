/**
 * 骨骼动画编辑器 - Spine 风格悬浮工具面板。
 * 悬浮于舞台下方,可左右拖动,可最小化为顶栏图标按钮。
 * 分组:Tools(姿势/权重/创建) | Transform(旋转/移动/缩放/倾斜 + 数值 + 关键帧) |
 *      Axes(本地/父级/世界) | Compensate(骨骼/图片) | Options(骨骼/图片/其他 + 快捷图标)
 */
import { toast } from '../dialogs.js';
import { sampleAnimation } from './animator.js';

import icoPose from '../assets/spine-icons/pose-green.png';
import icoWeights from '../assets/spine-icons/skin_icon-weights.png';
import icoCreate from '../assets/spine-icons/skin_icon-drawBones.png';
import icoCreateOff from '../assets/spine-icons/skin_icon-drawBones-disabled.png';
import icoScaleRed from '../assets/spine-icons/scale-red.png';
import icoShear from '../assets/spine-icons/skin_icon-shear.png';
import icoAxisLocal from '../assets/spine-icons/skin_icon-axisLocal.png';
import icoAxisParent from '../assets/spine-icons/skin_icon-axisParent.png';
import icoAxisWorld from '../assets/spine-icons/skin_icon-axisWorld.png';
import icoBoneComp from '../assets/spine-icons/skin_icon-boneComp.png';
import icoBoneCompOff from '../assets/spine-icons/skin_icon-boneComp-disabled.png';
import icoAttachComp from '../assets/spine-icons/skin_icon-attachmentComp.png';
import icoAttachCompOff from '../assets/spine-icons/skin_icon-attachmentComp-disabled.png';

const MIN_KEY = 'beSpineTBMin';
const X_KEY = 'beSpineTBX';

/* Spine 风格按钮图标(12x12 彩色 SVG,与编辑器工具语义一一对应) */
const ICO = {
  pose: '<img class="stb-ico" src="' + icoPose + '" draggable="false">',
  weights: '<img class="stb-ico" src="' + icoWeights + '" draggable="false">',
  create: '<img class="stb-ico" src="' + icoCreate + '" draggable="false">',
  createOff: '<img class="stb-ico" src="' + icoCreateOff + '" draggable="false">',
  rotate: '<svg viewBox="0 0 14 14" width="13" height="13"><path d="M12 7A5 5 0 1 1 9.6 2.7" fill="none" stroke="#35d461" stroke-width="1.8" stroke-linecap="round"/><path d="M9.2 0.8 10 3.2 7.6 3.6" fill="none" stroke="#35d461" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  move: '<svg viewBox="0 0 14 14" width="13" height="13"><g stroke="#4f8cff" stroke-width="1.5" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/><path d="M7 1.5 5.4 3.1M7 1.5l1.6 1.6M7 12.5 5.4 10.9M7 12.5l1.6-1.6M1.5 7l1.6-1.6M1.5 7l1.6 1.6M12.5 7l-1.6-1.6M12.5 7l-1.6 1.6"/></g></svg>',
  scale: '<img class="stb-ico" src="' + icoScaleRed + '" draggable="false">',
  shear: '<img class="stb-ico" src="' + icoShear + '" draggable="false">',
  local: '<img class="stb-ico" src="' + icoAxisLocal + '" draggable="false">',
  parent: '<img class="stb-ico" src="' + icoAxisParent + '" draggable="false">',
  world: '<img class="stb-ico" src="' + icoAxisWorld + '" draggable="false">',
  bones: '<img class="stb-ico" src="' + icoBoneComp + '" draggable="false">',
  bonesOff: '<img class="stb-ico" src="' + icoBoneCompOff + '" draggable="false">',
  images: '<img class="stb-ico" src="' + icoAttachComp + '" draggable="false">',
  imagesOff: '<img class="stb-ico" src="' + icoAttachCompOff + '" draggable="false">',
  edit: '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M9.5 1.8l2.7 2.7-7.4 7.4-3.2.5.5-3.2z" fill="none" stroke="#c8cdd6" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M1.5 7C3 4 5 2.8 7 2.8S11 4 12.5 7C11 10 9 11.2 7 11.2S3 10 1.5 7z" fill="none" stroke="#c8cdd6" stroke-width="1.2"/><circle cx="7" cy="7" r="1.8" fill="#c8cdd6"/></svg>',
  fit: '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M5 1.5H1.5V5M9 1.5h3.5V5M5 12.5H1.5V9M9 12.5h3.5V9" fill="none" stroke="#c8cdd6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cursor: '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M3 1.5 11.5 7.2l-3.8.6 2 3.6-1.8 1-2-3.7L3.5 12z" fill="#c8cdd6"/></svg>',
  tag: '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M7.6 1.5h4.9v4.9L7.3 11.6a1.5 1.5 0 0 1-2.1 0L2.4 8.8a1.5 1.5 0 0 1 0-2.1z" fill="none" stroke="#c8cdd6" stroke-width="1.3" stroke-linejoin="round"/><circle cx="10.1" cy="3.9" r="1.1" fill="#c8cdd6"/></svg>',
};

export class SpineToolbar {
  constructor(page) {
    this.page = page;
    this.minimized = localStorage.getItem(MIN_KEY) === '1';
    this.el = null;
  }

  mount(center) {
    this.center = center;
    this.render();
    this.applyMin();
  }

  render() {
    const ctx = this.page.ctx;
    const el = document.createElement('div');
    el.className = 'spine-tb' + (this.minimized ? ' hidden' : '');
    // 位置恢复:新格式 {l,t} JSON / 旧格式纯数字(仅水平偏移)
    const saved = localStorage.getItem(X_KEY);
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        if (Number.isFinite(pos.l)) el.style.left = pos.l + 'px';
        if (Number.isFinite(pos.t)) { el.style.top = pos.t + 'px'; el.style.bottom = 'auto'; el.style.transform = 'none'; }
      } catch (err) {
        const x = parseFloat(saved);
        if (Number.isFinite(x)) el.style.left = x + 'px';
      }
    }

    const group = (label) => {
      const g = document.createElement('div');
      g.className = 'stb-group';
      const lab = document.createElement('span');
      lab.className = 'stb-glabel';
      lab.textContent = label;
      lab.title = '右键:最小化该面板';
      g.appendChild(lab);
      const body = document.createElement('div');
      body.className = 'stb-gbody';
      g.appendChild(body);
      el.appendChild(g);
      // 右键组标题:最小化整个工具面板(顶栏 🧰 图标恢复)
      lab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.minimized = true;
        localStorage.setItem(MIN_KEY, '1');
        this.applyMin();
      });
      return body;
    };
    const btn = (parent, html, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'stb-btn ' + cls;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      parent.appendChild(b);
      return b;
    };
    const num = (parent, title, get, set, { step = 1, w = 46 } = {}) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.className = 'stb-num';
      i.title = title;
      i.step = step;
      i.style.width = w + 'px';
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) set(v); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
      parent.appendChild(i);
      i._get = get;
      return i;
    };

    // ── Tools 组:姿势 Q / 权重 W(子模式) / 创建 E ──
    const tools = group('Tools');
    this.btnPose = btn(tools, ICO.pose + '姿势', '姿势工具:选择/变换/K帧 (Q;做完权重/创建务必切回)', () => this.page.setTool('select'), 'wide');
    this.btnWeights = btn(tools, ICO.weights + '权重', '权重工具:Mesh 网格蒙皮笔刷 (W;仅 Setup,普通图片无效)', () => this.page.setTool('weights'), 'wide');
    this.btnCreate = btn(tools, ICO.create + '创建', '创建工具:拖拽新建骨骼,父级=选中骨骼 (E;仅 Setup)', () => this.page.setTool('bone'), 'wide');
    // 权重子模式条(仅权重工具+Setup 显示):增加/减去/平滑/复制/粘贴
    const wbar = document.createElement('div');
    wbar.className = 'stb-subbar';
    const wbtn = (html, tip) => btn(wbar, html, tip, () => toast('权重笔刷:暂未实现(占位)', 'info'), 'sm2');
    wbtn('增', '增加:涂抹提升选中骨骼对顶点的权重');
    wbtn('减', '减去:涂抹降低该骨骼权重');
    wbtn('滑', '平滑:平滑顶点间权重过渡(最常用)');
    wbtn('复制', '复制权重');
    wbtn('粘贴', '粘贴权重');
    tools.appendChild(wbar);
    this.wbar = wbar;

    // ── Transform 组 ──
    const tf = group('Transform');
    this.tfGroup = tf.parentElement;
    const row = (parent) => { const r = document.createElement('div'); r.className = 'stb-row'; parent.appendChild(r); return r; };
    const trow = row(tf);
    this.btnRot = btn(trow, ICO.rotate + '旋转', '旋转骨骼 (C)', () => this.page.setTool('rotate'), 'wide');
    this.inRot = num(trow, '旋转角度', () => this._val('rotation'), (v) => this._set({ rotation: v }), { step: 0.5, w: 58 });
    this.keyRot = this._keyBtn(trow, 'rotate', '旋转');
    const mrow = row(tf);
    this.btnMove = btn(mrow, ICO.move + '移动', '移动工具:拖拽骨骼/关节移动位置 (V)', () => this.page.setTool('move'), 'wide');
    this.inMx = num(mrow, 'X', () => this._val('x'), (v) => this._set({ x: v }), { w: 44 });
    this.inMy = num(mrow, 'Y', () => this._val('y'), (v) => this._set({ y: v }), { w: 44 });
    this.keyMove = this._keyBtn(mrow, 'translate', '移动');
    const srow = row(tf);
    this.btnScale = btn(srow, ICO.scale + '缩放', '缩放骨骼 (X)', () => this.page.setTool('scale'), 'wide');
    this.inSx = num(srow, '缩放X', () => this._val('scaleX'), (v) => this._set({ scaleX: v }), { step: 0.05, w: 44 });
    this.inSy = num(srow, '缩放Y', () => this._val('scaleY'), (v) => this._set({ scaleY: v }), { step: 0.05, w: 44 });
    this.keyScale = this._keyBtn(srow, 'scale', '缩放');
    const hrow = row(tf);
    this.btnShear = btn(hrow, ICO.shear + '倾斜', '倾斜骨骼 (Z)', () => this.page.setTool('shear'), 'wide');
    this.inHx = num(hrow, '斜切X', () => this._val('shearX'), (v) => this._set({ shearX: v }), { step: 0.5, w: 44 });
    this.inHy = num(hrow, '斜切Y', () => this._val('shearY'), (v) => this._set({ shearY: v }), { step: 0.5, w: 44 });
    this.keyShear = this._keyBtn(hrow, 'shear', '倾斜');

    // ── Axes 组:本地/父级/世界(操纵器参考系;底层存储不变) ──
    const axes = group('Axes');
    this.axGroup = axes.parentElement;
    this.axBtns = {};
    const AX_ICO = { local: ICO.local, parent: ICO.parent, world: ICO.world };
    const AX_TIP = {
      local: '本地:数值为相对于父项的逆时针旋转度数,0 与父项 X 轴同向;动画模式可超出 0-360° 实现多圈旋转',
      parent: '父级:选择父级轴不影响旋转,显示为本地旋转;=文件真实存储值,搭建骨架首选',
      world: '世界:数值为逆时针世界旋转度数(0向右/90向上/180向左/270向下);旋转恒锁 0-360°,不能记录多圈(动画模式键入旋转值时按钮橙色提醒)',
    };
    for (const [key, label] of [['local', '本地'], ['parent', '父级'], ['world', '世界']]) {
      this.axBtns[key] = btn(axes, AX_ICO[key] + label, AX_TIP[key], () => { this.page.axes = key; this.sync(); }, 'wide' + (this.page.axes === key ? ' on' : ''));
    }

    // ── Compensate 组:骨骼/图片(仅编辑器预览,导出无效;正式项目用 Transform 约束) ──
    const comp = group('Compensate');
    this.compGroup = comp.parentElement;
    this.cbBones = btn(comp, ICO.bones + '骨骼', '骨骼补偿:父骨骼变换时子骨骼原地不动(仅编辑器预览,关闭即还原;导出无效,正式项目用 Transform 约束)', () => { this.page.setCompensate('bones', !this.page.compBones); this.sync(); }, 'wide' + (this.page.compBones ? ' on' : ''));
    this.cbImages = btn(comp, ICO.images + '图片', '图片补偿:骨骼跟随父级而图片保持正向(仅编辑器预览,关闭即还原;导出无效,正式项目用 Transform 约束)', () => { this.page.setCompensate('images', !this.page.compImages); this.sync(); }, 'wide' + (this.page.compImages ? ' on' : ''));

    // ── Options 组(Spine 标准 3×3:选择/显示/标签 × 骨骼/图片/其他;仅姿势工具显示) ──
    const optWrap = group('Options');
    this.optGroup = optWrap.parentElement; // stb-group 根(用于整组显隐)
    const grid = document.createElement('div');
    grid.className = 'stb-opt-grid';
    optWrap.appendChild(grid);
    const cell = (parent, tag, cls, html, title, fn) => {
      const c = document.createElement(tag);
      c.className = cls;
      if (html !== null) c.innerHTML = html;
      if (title) c.title = title;
      if (fn) c.addEventListener('click', fn);
      parent.appendChild(c);
      return c;
    };
    // 表头行:空角 + 选择(cursor) + 显示(eye) + 标签(tag)
    cell(grid, 'span', 'stb-opt-head', null);
    cell(grid, 'span', 'stb-opt-head', ICO.cursor, '选择:该类对象可否在视图中点击选中', null);
    cell(grid, 'span', 'stb-opt-head', ICO.eye, '显示:视图中是否渲染该类对象(仅预览,不影响导出)', null);
    cell(grid, 'span', 'stb-opt-head', ICO.tag, '标签:视图中是否显示该类对象的名称标签', null);
    const ROWS = [['bones', '骨骼'], ['images', '图片'], ['others', '其他']];
    this.optDots = {}; // {row}{col: el}
    for (const [key, label] of ROWS) {
      this.optDots[key] = {};
      cell(grid, 'span', 'stb-olabel2', label, null, null);
      // 选择列
      this.optDots[key].sel = cell(grid, 'button', 'stb-dot',
        null, `${label}:视图点击选择 ${label === 'others' ? '(路径/辅助点,暂不可点选)' : ''}`,
        () => { this.page.optSelect[key] = !this.page.optSelect[key]; this.sync(); });
      // 显示列:骨骼/图片映射现有 showBones/showImages,其他为新开关
      this.optDots[key].vis = cell(grid, 'button', 'stb-dot', null,
        `${label}:视图显示`,
        () => {
          if (key === 'bones') this.page.showBones = !this.page.showBones;
          else if (key === 'images') this.page.showImages = !this.page.showImages;
          else this.page.showOthers = !this.page.showOthers;
          this.page.refresh();
        });
      // 标签列:视图中显示该类对象的名称标签
      this.optDots[key].lab = cell(grid, 'button', 'stb-dot', null,
        `${label}:视图中显示${key === 'bones' ? '骨骼名称' : key === 'images' ? '图片(插槽)名称' : '辅助点名称'}标签`,
        () => { this.page.optLabels[key] = !this.page.optLabels[key]; this.page.refresh(); });
    }

    // ── 自由拖动:仅当鼠标悬停/按在各面板标题栏(竖排组名)时才可拖拽 ──
    const startDrag = (handle) => {
      handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('input,button,.stb-row')) return;
      e.preventDefault();
      this._userMoved = true;
      const startX = e.clientX, startY = e.clientY;
      const startL = el.offsetLeft, startT = el.offsetTop;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针,忽略 */ }
      const zf = (() => { try { const z = parseFloat(getComputedStyle(document.getElementById('app')).zoom); return Number.isFinite(z) && z > 0 ? z : 1; } catch (err) { return 1; } })();
      const mv = (ev) => {
        let L = startL + (ev.clientX - startX) / zf;
        let T = startT + (ev.clientY - startY) / zf;
        L = Math.max(0, Math.min(this.center.clientWidth - el.offsetWidth, L));
        T = Math.max(0, Math.min(this.center.clientHeight - el.offsetHeight, T));
        el.style.left = L + 'px';
        el.style.top = T + 'px';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        // 底边吸附:松手时距舞台底边 24px 内自动贴齐
        const bottomGap = this.center.clientHeight - (el.offsetTop + el.offsetHeight);
        if (bottomGap < 24) this.snapBottom();
        try { localStorage.setItem(X_KEY, JSON.stringify({ l: el.offsetLeft, t: el.offsetTop })); } catch (err) { /* ignore */ }
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      });
    };
    // 各面板标题栏(竖排组名)接入拖拽;面板空白区/控件不可拖
    [...el.querySelectorAll('.stb-group')].forEach((g) => {
      const lab = g.querySelector('.stb-glabel');
      if (lab) startDrag(lab);
    });

    this.el = el;
    this.center.appendChild(el);
    // 默认位置:吸附舞台底边。双 rAF 等首次布局完成(挂载瞬间舞台高度可能还是 0)
    this.settle(true);
    // 舞台尺寸变化(摄影表显隐/窗口缩放)时:RO 回调在布局之后,同步钳制+吸附最可靠
    this._ro = new ResizeObserver(() => {
      if (this.minimized) { this.alignMinHost(); return; }
      this.clampPos();
      this.snapBottom();
      this.alignMinHost();
    });
    this._ro.observe(this.center);
    this.sync();
  }

  /** 布局稳定后执行钳制/吸附/对齐(双 rAF 确保测量有效);snap=是否强制吸附底边 */
  settle(snap = false) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!this.el || !this.center) return;
      this.clampPos();
      if (snap) this.snapBottom();
      this.alignMinHost();
    }));
  }

  /** 底边吸附:面板贴齐舞台底边 */
  snapBottom() {
    if (!this.el || !this.center || this.minimized) return;
    this.el.style.top = (this.center.clientHeight - this.el.offsetHeight) + 'px';
    this.el.style.bottom = 'auto';
    this.el.style.transform = 'none';
  }

  /** 面板位置钳制:始终保持在舞台可视区内 */
  clampPos() {
    if (!this.el || !this.center || this.minimized) return;
    const L = Math.max(0, Math.min(this.center.clientWidth - this.el.offsetWidth, this.el.offsetLeft));
    const T = Math.max(0, Math.min(this.center.clientHeight - this.el.offsetHeight, this.el.offsetTop));
    this.el.style.left = L + 'px';
    this.el.style.top = T + 'px';
    this.el.style.bottom = 'auto';
    this.el.style.transform = 'none';
  }

  /** 关键帧按钮:绿实心=当前帧有键(点击删除) / 灰空心=无键(点击添加) / Setup 模式禁用 */
  _keyBtn(parent, ch, label) {
    const b = document.createElement('button');
    b.className = 'stb-key';
    b.innerHTML = '<svg viewBox="0 0 12 12" width="11" height="11"><circle class="khead" cx="4" cy="6" r="2.4"/><path d="M6.4 6h4.6M9 6v2.2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
    b.dataset.ch = ch;
    b.addEventListener('click', () => {
      const sel = this.page.ctx.selection;
      if (!sel || sel.type !== 'bone') { toast('请先选中骨骼', 'warn'); return; }
      this.page.ctx.toggleBoneKey(sel.name, ch);
      this.sync();
    });
    parent.appendChild(b);
    return b;
  }

  /** 骨骼世界角度(pixi 顺时针,归一 -180~180) */
  _worldAng(name) {
    const w = this._worldOf(name);
    if (!w) return null;
    const d = Math.atan2(w.b, w.a) * 180 / Math.PI;
    return ((d + 180) % 360 + 360) % 360 - 180;
  }
  _worldOf(name) {
    const st = this.page.stage;
    return st && st.worlds ? st.worlds.get(name) : null;
  }

  /**
   * 当前选中对象的通道值(Axes 联动):
   * 旋转:本地存储;世界模式显示全局角(编辑自动换算回本地,±180 无多圈)
   * 移动:父级存储;世界模式显示世界位置(编辑换算回父级)
   * 缩放/倾斜:恒本地,不受 Axes 影响;插槽恒本地
   */
  _val(ch) {
    const ctx = this.page.ctx;
    const sel = ctx.selection;
    if (!sel) return 0;
    if (sel.type === 'slot' || sel.type === 'att') {
      // 附件级选择({type:'att'})读取其指定附件的变换;插槽选择读当前生效附件
      const slot = ctx.project.armature.slots.find((x) => x.name === (sel.type === 'att' ? sel.slot : sel.name));
      const di = sel.type === 'att' ? sel.index
        : (slot && slot.displayIndex >= 0 && slot.displayIndex < (slot.displays || []).length ? slot.displayIndex : 0);
      const t = slot && slot.displays[di] && slot.displays[di].transform;
      return t ? (t[ch] ?? 0) : 0;
    }
    if (sel.type !== 'bone') return 0;
    const bone = ctx.project.armature.bones.find((b) => b.name === sel.name);
    if (!bone) return 0;
    // 补偿覆盖层预览值优先(规格:补偿修改面板显示,关闭恢复)
    const cov = ctx.getCompBone && ctx.getCompBone(sel.name);
    if (cov && (ch === 'x' || ch === 'y' || ch === 'rotation') && cov[ch] !== undefined) return cov[ch];
    const axes = this.page.axes || 'world';
    // 世界模式:旋转显示全局角(0-360°,Spine 惯例),移动显示世界坐标
    if (axes === 'world') {
      if (ch === 'rotation') { const w = this._worldAng(sel.name); if (w !== null) return ((w % 360) + 360) % 360; }
      if (ch === 'x' || ch === 'y') { const w = this._worldOf(sel.name); if (w) return ch === 'x' ? w.tx : w.ty; }
    }
    // 本地/父级(及世界回退):采样姿态或绑定值
    if (ctx.mode === 'anim' && ctx.anim) {
      const o = sampleAnimation(ctx.anim, ctx.frame).bones[sel.name] || {};
      if (ch === 'x') return o.x !== undefined ? bone.x + o.x : bone.x;
      if (ch === 'y') return o.y !== undefined ? bone.y + o.y : bone.y;
      if (ch === 'rotation') return o.rotation !== undefined ? bone.rotation + o.rotation : bone.rotation;
      if (ch === 'scaleX') return o.scaleX !== undefined ? bone.scaleX * o.scaleX : bone.scaleX;
      if (ch === 'scaleY') return o.scaleY !== undefined ? bone.scaleY * o.scaleY : bone.scaleY;
      if (ch === 'shearX') return o.shearX !== undefined ? (bone.shearX || 0) + o.shearX : (bone.shearX || 0);
      if (ch === 'shearY') return o.shearY !== undefined ? (bone.shearY || 0) + o.shearY : (bone.shearY || 0);
      return 0;
    }
    return ch === 'shearX' ? (bone.shearX || 0) : ch === 'shearY' ? (bone.shearY || 0) : (bone[ch] ?? 0);
  }

  _set(props) {
    const ctx = this.page.ctx;
    const sel = ctx.selection;
    if (!sel) { toast('请先选中骨骼或插槽', 'warn'); return; }
    if (sel.type === 'slot' || sel.type === 'att') {
      // 附件级选择({type:'att'})写其指定附件的变换
      const slot = ctx.project.armature.slots.find((x) => x.name === (sel.type === 'att' ? sel.slot : sel.name));
      const di = sel.type === 'att' ? sel.index
        : (slot && slot.displayIndex >= 0 && slot.displayIndex < (slot.displays || []).length ? slot.displayIndex : 0);
      const t = slot && slot.displays[di] && slot.displays[di].transform;
      if (!t) { toast('该插槽没有附件', 'warn'); return; }
      this.page.beginEdit('编辑附件变换');
      Object.assign(t, props);
      this.page.refresh();
      return;
    }
    if (sel.type !== 'bone') { toast('请先选中骨骼或插槽', 'warn'); return; }
    // 世界模式:旋转/移动输入的世界值换算回本地/父级再存储(底层格式不变)
    const axes = this.page.axes || 'world';
    const out = { ...props };
    if (axes === 'world') {
      const bone = ctx.project.armature.bones.find((b) => b.name === sel.name);
      if (props.rotation !== undefined) {
        // Spine 旋转约束:装配模式恒锁 0-360°;动画模式本地/父级不限制(可写多圈),世界轴仍锁 0-360°
        const animWorld = ctx.mode === 'anim';
        let r = animWorld ? (((props.rotation % 360) + 360) % 360) : props.rotation;
        if (animWorld) this._warnWorldAxis(); // 键入旋转值时世界轴按钮橙色提醒(该轴下不能记录多圈)
        const cur = this._worldAng(sel.name);
        if (cur !== null && bone) out.rotation = bone.rotation + (((r - cur + 540) % 360) - 180);
      }
      if (props.x !== undefined || props.y !== undefined) {
        const w = this._worldOf(sel.name);
        const P = bone && bone.parent ? this._worldOf(bone.parent) : null;
        if (w && P && bone) {
          const twx = props.x !== undefined ? props.x : w.tx;
          const twy = props.y !== undefined ? props.y : w.ty;
          const det = (P.a * P.d - P.b * P.c) || 1e-9;
          const lx = twx - P.tx, ly = twy - P.ty;
          out.x = (P.d * lx - P.c * ly) / det;
          out.y = (-P.b * lx + P.a * ly) / det;
        }
      }
    }
    ctx.editBone(sel.name, out);
    this.sync();
  }

  /** 世界轴橙色提醒:动画模式下键入旋转值时短暂点亮世界轴按钮(Spine:该轴下旋转锁 0-360°,不能记录多圈) */
  _warnWorldAxis() {
    const b = this.axBtns && this.axBtns.world;
    if (!b) return;
    b.classList.add('stb-warn');
    clearTimeout(this._warnT);
    this._warnT = setTimeout(() => b.classList.remove('stb-warn'), 1200);
  }

  /** 同步按钮态/输入值/关键帧高亮(选中变化、拖拽、刷新时调用) */
  sync() {
    if (!this.el || this.minimized) return;
    const ctx = this.page.ctx;
    const setupMode = ctx.mode !== 'anim';
    const sel = ctx.selection && (ctx.selection.type === 'bone' || ctx.selection.type === 'slot' || ctx.selection.type === 'att');
    const tool = this.page.tool;
    this.btnPose.classList.toggle('on', tool === 'select');
    this.btnMove.classList.toggle('on', tool === 'move');
    this.btnCreate.classList.toggle('on', tool === 'bone');
    this.btnRot.classList.toggle('on', tool === 'rotate');
    this.btnScale.classList.toggle('on', tool === 'scale');
    this.btnShear.classList.toggle('on', tool === 'shear');
    for (const k of Object.keys(this.axBtns)) this.axBtns[k].classList.toggle('on', this.page.axes === k);
    this.cbBones.classList.toggle('on', !!this.page.compBones);
    this.cbImages.classList.toggle('on', !!this.page.compImages);
    // 双态图标:创建(Setup 可用性) / 补偿(开启彩色,关闭灰色)
    const swap = (btn, onUrl, offUrl) => { const im = btn && btn.querySelector('img'); if (im && im.dataset.on) im.src = on ? onUrl : offUrl; };
    swap(this.btnCreate, icoCreate, icoCreateOff);
    swap(this.cbBones, icoBoneComp, icoBoneCompOff);
    swap(this.cbImages, icoAttachComp, icoAttachCompOff);
    // 变换族工具(选择/移动/旋转/缩放/倾斜)均显示 Transform/Axes/Compensate/Options;
    // 旋转等按钮本身在 Transform 组内,整组隐藏会让切换后的高亮态不可见(且无法切回)
    const tfTool = this.page.tool === 'select' || this.page.tool === 'move' || this.page.tool === 'rotate'
      || this.page.tool === 'scale' || this.page.tool === 'shear';
    if (this.optGroup) this.optGroup.style.display = tfTool ? '' : 'none';
    if (this.tfGroup) this.tfGroup.style.display = tfTool ? '' : 'none';
    if (this.axGroup) this.axGroup.style.display = tfTool ? '' : 'none';
    if (this.compGroup) this.compGroup.style.display = tfTool ? '' : 'none';
    if (this.wbar) this.wbar.style.display = (this.page.tool === 'weights' && setupMode) ? 'flex' : 'none';
    this.btnWeights.classList.toggle('off', !setupMode);
    this.btnCreate.classList.toggle('off', !setupMode);
    const visOf = (k) => k === 'bones' ? this.page.showBones : k === 'images' ? this.page.showImages : this.page.showOthers;
    for (const key of Object.keys(this.optDots || {})) {
      const d = this.optDots[key];
      d.sel.classList.toggle('on', !!this.page.optSelect[key]);
      d.vis.classList.toggle('on', !!visOf(key));
      d.lab.classList.toggle('on', !!this.page.optLabels[key]);
    }
    // 数值
    const fields = [[this.inRot, 'rotation'], [this.inMx, 'x'], [this.inMy, 'y'], [this.inSx, 'scaleX'], [this.inSy, 'scaleY'], [this.inHx, 'shearX'], [this.inHy, 'shearY']];
    for (const [inp, ch] of fields) if (document.activeElement !== inp) inp.value = sel ? (+this._val(ch).toFixed(2)) : '';
    // 关键帧高亮:该通道当前帧已有键 → 绿色
    const selName = ctx.selection?.type === 'bone' ? ctx.selection.name : null;
    const f = Math.round(ctx.frame);
    const keyed = (ch) => selName && !!ctx.findKey({ target: selName, channel: ch, frame: f });
    const keyAvail = ctx.mode === 'anim' && !!ctx.anim;
    const keyState = (btn, ch) => {
      btn.classList.toggle('solid', keyAvail && keyed(ch));
      btn.classList.toggle('hollow', keyAvail && !keyed(ch));
      btn.classList.toggle('off', !keyAvail);
      btn.title = setupMode ? '设置模式:钥匙不可用(修改绑定数据,不产生关键帧)'
        : keyed(ch) ? `${'当前帧已有'}关键帧,点击删除` : '点击在当前帧插入关键帧';
    };
    keyState(this.keyRot, 'rotate');
    keyState(this.keyMove, 'translate');
    keyState(this.keyScale, 'scale');
    keyState(this.keyShear, 'shear');
    // 未被用户拖离时,保持吸附舞台底边(Spine 面板默认停靠位)
    if (!this._userMoved) this.snapBottom();
    this.alignMinHost();
  }

  /** 最小化:面板隐藏,顶栏显示 🧰 图标(点击恢复) */
  /** 应用最小化/恢复:面板显隐 + 舞台左下角图标 + 布局稳定后钳制对齐 */
  applyMin() {
    if (!this.el || !this.center) return;
    this.el.classList.toggle('hidden', this.minimized);
    let host = document.querySelector('.be-spine-min-host');
    if (this.minimized) {
      if (!host) {
        host = document.createElement('span');
        host.className = 'be-spine-min-host';
        (this.center || document.body).appendChild(host);
      }
      host.innerHTML = '';
      host.style.display = 'inline-flex';
      const b = document.createElement('button');
      b.className = 'be-spine-min-btn';
      b.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15">'
        + '<g transform="rotate(45 8 8)">'
        + '<path d="M6.2 2.2h3.6v2.6H6.2z" fill="#4ecdc4"/>'
        + '<path d="M7.2 4.8h1.6l-.4 4.6H7.6z" fill="#4ecdc4"/>'
        + '</g>'
        + '<g transform="rotate(-45 8 8)">'
        + '<path d="M10.8 2.6a2.6 2.6 0 0 0-3.5 3.2L2.6 10.5a1.5 1.5 0 1 0 2.1 2.1l4.7-4.7a2.6 2.6 0 0 0 3.2-3.5l-1.8 1.8-1.8-.6-.6-1.8z" fill="none" stroke="#8fd3ff" stroke-width="1.2" stroke-linejoin="round"/>'
        + '</g></svg>';
      b.title = '展开变换工具面板';
      b.addEventListener('click', () => { this.minimized = false; localStorage.setItem(MIN_KEY, '0'); this.applyMin(); });
      host.appendChild(b);
      this.settle(false);
    } else if (host) {
      host.innerHTML = '';
      host.style.display = 'none';
    }
    this.settle(false);
  }

  /** 布局稳定后执行钳制/吸附/对齐(双 rAF 确保测量有效);snapBottom=强制吸附舞台底边 */
  settle(snapBottom = false) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!this.el || !this.center) return;
      this.clampPos();
      if (snapBottom) this.snapBottom();
      this.alignMinHost();
    }));
  }

  /** 最小化图标与缩放控件右对齐(缩放控件右缘为基准,按应用缩放归一) */
  alignMinHost() {
    const host = document.querySelector('.be-spine-min-host');
    if (!host || !this.center) return;
    host.style.display = 'inline-flex';
    try {
      const vc = this.center.querySelector('.be-stage-viewctl');
      const vcRect = vc ? vc.getBoundingClientRect() : null;
      const cRect = this.center.getBoundingClientRect();
      if (vcRect && cRect.width) {
        const zf = (() => { const z = parseFloat(getComputedStyle(document.getElementById('app')).zoom); return Number.isFinite(z) && z > 0 ? z : 1; })();
        const right = (vcRect.right - cRect.left) / zf; // 缩放控件右缘(相对舞台 CSS 像素)
        host.style.left = '0px';
        const w = host.offsetWidth || 30;
        host.style.left = Math.max(8, right - w) + 'px';
      } else {
        host.style.left = '30px';
      }
    } catch (err) { host.style.left = '30px'; }
    host.style.bottom = '8px';
    host.style.top = 'auto';
  }

  destroy() {
    if (this._ro) this._ro.disconnect();
    if (this.el) this.el.remove();
    this.el = null;
  }
}
