/**
 * 骨骼动画编辑器页面(复刻 LoongBones / DragonBones 编辑器核心工作流)。
 *
 * 布局:顶部工具栏 / 左侧(资源库·大纲·层级)/ 中央舞台 / 右侧属性 / 底部摄影表时间轴。
 * 页面持有 ctx 控制器(状态 + 全部编辑意图),stage/panels/timeline 组件通过 ctx 驱动。
 */

import { toast, confirmDialog, promptDialog, openModal, footButtons, showContextMenu } from '../dialogs.js';
import { getPixi } from '../pixiLazy.js';
import {
  createProject, createBlankProject, createBone, createSlot, createDisplay, uniqueName, findAnim,
  bonesInTreeOrder, boneChildren, serialize, deserialize,
} from '../editor/model.js';
import { sampleAnimation, computeWorldTransforms, worldToParentLocal } from '../editor/animator.js';
import { EditorStage } from '../editor/stage.js';
import { EditorPanels } from '../editor/panels.js';
import { EditorTimeline } from '../editor/timeline.js';
import { loadDbBundle } from '../preview/dbPlayer.js';
import { packProjectAtlas, buildDragonBonesExport, saveProjectFile, exportDragonBonesFiles } from '../editor/exporter.js';
import { importSpineProject, importSpineEditorProject, exportSpineFiles, buildSpineJsonFromModel, parseAtlasText, cropRegionToDataUrl } from '../editor/spineIO.js';
import { packImages } from '../atlasPacker.js';
import { loongDocToDbSke, importDragonBonesProject } from '../editor/dbIO.js';

const DRAFT_KEY = 'boneEditorDraft';
const RECENT_KEY = 'boneEditorRecent'; // 首页「最近打开/导入」入口: [{path,name,kind,openedAt}] kind=project|spine|spineproj, 最新在前, 上限 5
const RECENT_MAX = 5;
let _active = null; // 当前活动实例(离开页面时销毁)

function _normPath(p) { return String(p || '').replace(/\\/g, '/'); }

function getBoneRecent() {
  try {
    const s = localStorage.getItem(RECENT_KEY);
    const a = s ? JSON.parse(s) : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function recordBoneRecent(path, name, kind) {
  if (!path) return;
  let list = getBoneRecent().filter((r) => _normPath(r.path) !== _normPath(path));
  list.unshift({ path, name: name || String(path).split(/[\\/]/).pop(), kind, openedAt: Date.now() });
  list = list.slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function disposeBoneEditor() {
  if (_active) { _active.destroy(); _active = null; }
}

export function renderBoneEditorTool(container) {
  disposeBoneEditor();
  const inst = new BoneEditor(container);
  _active = inst;
}

class BoneEditor {
  constructor(container) {
    this.container = container;
    try { window.__beEditor = this; } catch (err) { /* 调试探针 */ }
    this._packMod = { pack: packImages, parse: parseAtlasText, crop: cropRegionToDataUrl }; // 纹理打包/解包共用函数(验证/工具桥)
    // 默认进入「首页」等待态:快速打开 / 新建 / 导入 / 最近入口,不自动恢复草稿
    // 点击「新建」后才进入空白项目页(空白等待态),由用户搭建新骨架
    this.project = createBlankProject();
    this.view = 'home'; // 'home' = 默认首页; 'editor' = 编辑视图(空白项目/正常项目)

    // ---- ctx 状态 ----
    this.mode = 'setup';
    this.tool = 'select';
    this.frame = 0;
    this.playing = false;
    this.playDir = 1;         // 播放方向:1 前进 / -1 后退(Spine D/A)
    this.loop = true;
    this.autoKey = true;
    this.onion = false;
    this.onionRange = 4;
    this.showBones = true;
    this.showGrid = true;
    this.selection = null;   // { type:'bone'|'slot', name } | null
    this.keySel = null;      // { target, channel, frame }
    this.animName = (this.project.armature.animations[0] && this.project.armature.animations[0].name) || null;

    this.undoStack = [];
    this.redoStack = [];
    this._raf = 0;
    this._lastT = 0;
    this._saveTimer = 0;

    const self = this;
    this.ctx = {
      get project() { return self.project; },
      get mode() { return self.mode; },
      get anim() { return findAnim(self.project, self.animName); },
      get frame() { return self.frame; },
      get playing() { return self.playing; },
      get playDir() { return self.playDir || 1; },
      get tool() { return self.tool; },
      get selection() { return self.selection; },
      get showBones() { return self.showBones; },
      get showGrid() { return self.showGrid; },
      get onion() { return self.onion; },
      get onionRange() { return self.onionRange; },
      get keySel() { return self.keySel; },
      set keySel(v) { self.keySel = v; },
      select: (t, n) => self.select(t, n),
      beginEdit: (label) => self.beginEdit(label),
      refresh: (opts) => self.refresh(opts),
      refreshPanelsOnly: () => self.refreshPanels(),
      onAutoFit: () => self._syncZoomLabel(),
      editBone: (name, props) => self.editBone(name, props),
      createBone: (...a) => self.createBone(...a),
      bindImageAt: (id, x, y) => self.bindImageAt(id, x, y),
      reparentBone: (n, p) => self.reparentBone(n, p),
      addBoneChild: (n) => self.addBoneChild(n),
      addSlotTo: (n) => self.addSlotTo(n),
      deleteBone: (n) => self.deleteBone(n),
      deleteSlot: (n) => self.deleteSlot(n),
      renameSlot: (n, v) => self.renameSlot(n, v),
      moveSlotZ: (n, d) => self.moveSlotZ(n, d),
      setAnimation: (n) => self.setAnimation(n),
      newAnimation: () => self.newAnimation(),
      renameAnimation: () => self.renameAnimation(),
      deleteAnimation: () => self.deleteAnimation(),
      setFrame: (f) => self.setFrame(f),
      togglePlay: () => self.togglePlay(),
      toggleLoop: () => { self.loop = !self.loop; self.refresh(); },
      toggleAutoKey: () => { self.autoKey = !self.autoKey; self.refresh(); },
      toggleOnion: () => { self.onion = !self.onion; self.refresh(); },
      insertBoneKeys: (n, ch, f) => self.insertBoneKeys(n, ch, f),
      insertSlotKeys: (n, ch, f) => self.insertSlotKeys(n, ch, f),
      insertChannelKeyAt: (t, c, f) => self.insertChannelKeyAt(t, c, f),
      findKey: (ks) => self.findKey(ks),
      moveKey: (ks, f) => self.moveKey(ks, f),
      deleteKey: () => self.deleteKey(),
      pasteKey: (clip) => self.pasteKey(clip),
    };

    this._buildDom();
    this.rootEl.classList.add('setup-mode'); // 初始为骨架编辑模式:隐藏时间轴
    this.stage = new EditorStage(this.ctx);
    this.panels = new EditorPanels(this.ctx);
    this.timeline = new EditorTimeline(this.ctx);
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler);
    (async () => {
      await this.stage.mount(this.stageHost);
      this.panels.mountLibrary(this.tabBodies.lib);
      this.panels.mountOutline(this.tabBodies.outline);
      this.panels.mountZOrder(this.tabBodies.zorder);
      this.panels.mountProps(this.propsHost);
      this.timeline.mount(this.timelineHost);
      this.refresh();
      this.stage.fitAll();
    })();
    this._loop = (t) => this._tick(t);
    this._raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._keyHandler);
    this.timeline?.destroy?.();
    this.stage?.dispose();
    this._saveDraftNow();
    this.container.innerHTML = '';
  }

  // ---------------- DOM ----------------

  _buildDom() {
    const c = this.container;
    c.innerHTML = `
      <div class="be-root">
        <div class="be-toolbar"></div>
        <div class="be-main">
          <div class="be-center">
            <div class="be-stage-host"></div>
            <div class="be-stage-info"></div>
            <div class="be-stage-viewctl">
              <button data-act="zo" title="缩小视图">−</button>
              <span class="be-zoom-label">100%</span>
              <button data-act="zi" title="放大视图">＋</button>
              <button data-act="fit" title="适配全部内容 (Ctrl+F)">⤢</button>
            </div>
            <div class="be-stage-empty" hidden>
              <div class="be-stage-empty-title">空白项目</div>
              <div class="be-stage-empty-line">或直接从资源库拖图片 / 按 N 键(B 兼容)拖拽创建第一根骨骼</div>
              <button class="btn sm be-restore-draft" hidden>↩ 恢复上次编辑</button>
            </div>
          </div>
          <div class="be-col-resize" title="拖拽调整层级树面板宽度(与舞台的分界线)"></div>
          <div class="be-rightcol">
            <div class="be-left">
              <div class="be-tabs">
                <button class="be-tab active" data-tab="outline">层级树</button>
                <button class="be-tab" data-tab="lib">资源库</button>
                <button class="be-tab" data-tab="zorder">层级</button>
              </div>
              <div class="be-tab-body" data-body="outline"></div>
              <div class="be-tab-body" data-body="lib" hidden></div>
              <div class="be-tab-body" data-body="zorder" hidden></div>
            </div>
            <div class="be-right"><div class="be-props"></div></div>
          </div>
        </div>
        <div class="be-tl-resize" title="拖拽调整摄影表高度(舞台与摄影表分界线)"></div>
        <div class="be-timeline-host"></div>
        <div class="be-home" hidden>
          <div class="be-home-title">🦴 骨骼动画编辑器</div>
          <div class="be-home-sub">新建 · 打开 · 导入 骨骼动画项目</div>
          <div class="be-home-actions">
            <button class="btn be-home-action" data-act="open" title="打开 .lbone.json 项目 / Spine .spine 工程 / Spine 动画(.json/.atlas/.png)">📂 打开项目</button>
            <button class="btn be-home-action" data-act="new" title="搭建新骨架(新建动画项目)">✚ 新建项目</button>
            <button class="btn be-home-action" data-act="spine" title="导入 Spine 骨架 JSON(自动配图集)">🦂 导入 Spine JSON</button>
            <button class="btn be-home-action" data-act="db" title="导入 DragonBones / LoongBones 骨架">🐲 导入 DragonBones</button>
          </div>
          <div class="be-recent" hidden></div>
        </div>
      </div>`;
    this.toolbarEl = c.querySelector('.be-toolbar');
    this.stageHost = c.querySelector('.be-stage-host');
    this.propsHost = c.querySelector('.be-props');
    this.timelineHost = c.querySelector('.be-timeline-host');
    this.rootEl = c.querySelector('.be-root');
    // UI 缩放系数(rect 像素 / CSS 像素,应用级 zoom 时 ≠1):拖拽位移换算 + 持久化存 CSS 设定值,避免保存/恢复循环累积误差
    this._uiScale = (() => {
      try {
        this.timelineHost.style.width = '100px';
        const s = this.timelineHost.getBoundingClientRect().width / 100;
        this.timelineHost.style.width = '';
        return s > 0 ? s : 1;
      } catch (err) { return 1; }
    })();
    // 时间轴高度持久化 + 拖拽调高
    const savedH = parseFloat(localStorage.getItem('beTlHeight'));
    if (savedH >= 120) this.timelineHost.style.height = savedH + 'px';
    const rz = c.querySelector('.be-tl-resize');
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = this.timelineHost.getBoundingClientRect().height / this._uiScale;
      const maxH = Math.max(200, window.innerHeight * 0.72);
      let curH = startH;
      const mv = (ev) => {
        curH = Math.min(maxH, Math.max(120, startH + (startY - ev.clientY) / this._uiScale));
        this.timelineHost.style.height = curH + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        try { localStorage.setItem('beTlHeight', String(curH)); } catch (err) { /* ignore */ }
        this.stage?.render();
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    // 层级树面板宽度持久化 + 拖拽竖向分界线(舞台 ↔ 右列)
    const rightcol = c.querySelector('.be-rightcol');
    const savedW = parseFloat(localStorage.getItem('beRightColW'));
    if (savedW >= 230) rightcol.style.width = savedW + 'px';
    const crz = c.querySelector('.be-col-resize');
    crz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightcol.getBoundingClientRect().width / this._uiScale;
      let curW = startW;
      const mv = (ev) => {
        curW = Math.min(600, Math.max(230, startW - (ev.clientX - startX) / this._uiScale));
        rightcol.style.width = curW + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        try { localStorage.setItem('beRightColW', String(curW)); } catch (err) { /* ignore */ }
        this.stage?.render();
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    this.tabBodies = {
      lib: c.querySelector('[data-body=lib]'),
      outline: c.querySelector('[data-body=outline]'),
      zorder: c.querySelector('[data-body=zorder]'),
    };
    c.querySelectorAll('.be-tab').forEach((b) => {
      b.addEventListener('click', () => {
        c.querySelectorAll('.be-tab').forEach((x) => x.classList.toggle('active', x === b));
        for (const k of Object.keys(this.tabBodies)) this.tabBodies[k].hidden = k !== b.dataset.tab;
      });
    });
    c.querySelector('.be-restore-draft')?.addEventListener('click', () => this.restoreDraft());
    // 默认首页快捷入口:打开 / 新建 / 导入(与「文件」菜单功能一致)
    c.querySelectorAll('.be-home-action').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'open') this.openProject();
        else if (b.dataset.act === 'new') this.newProject();
        else if (b.dataset.act === 'spine') this.importSpine();
        else if (b.dataset.act === 'db') this.importDbOrLoong();
      });
    });
    // 舞台视图控制浮层:缩放 / 适配
    const vc = c.querySelector('.be-stage-viewctl');
    vc?.querySelector('[data-act=zo]').addEventListener('click', () => { this.stage.zoomBy(1 / 1.2); this._syncZoomLabel(); });
    vc?.querySelector('[data-act=zi]').addEventListener('click', () => { this.stage.zoomBy(1.2); this._syncZoomLabel(); });
    vc?.querySelector('[data-act=fit]').addEventListener('click', () => { this.stage.fitAll(); this._syncZoomLabel(); });
    this._buildToolbar();
  }

  _syncZoomLabel() {
    const el = this.container.querySelector('.be-zoom-label');
    if (el && this.stage) el.textContent = Math.round(this.stage.camera.zoom * 100) + '%';
  }

  /** 恢复上次编辑草稿(用户主动点击,不自动加载) */
  restoreDraft() {
    const d = this._loadDraft();
    if (!d || !(d.armature.bones.length || d.armature.slots.length || d.spine)) { toast('没有可恢复的草稿', 'warn'); return; }
    this.view = 'editor';
    this.beginEdit('恢复草稿');
    this.project = d;
    this.animName = (d.armature.animations[0] || {}).name || null;
    this.selection = null;
    this.keySel = null;
    this.frame = 0;
    this.mode = 'setup';
    this.refresh();
    this.stage.fitAll();
    toast(`已恢复「${d.name}」`);
  }

  _buildToolbar() {
    const tb = this.toolbarEl;
    tb.innerHTML = '';
    const mkBtn = (html, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'btn sm ' + cls;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', fn);
      tb.appendChild(b);
      return b;
    };
    const sep = () => { const s = document.createElement('span'); s.className = 'be-tl-sep'; tb.appendChild(s); };

    // 文件菜单(项目/导入导出统一入口)
    this.btnFile = mkBtn('文件 ▾', '新建 / 打开 / 保存 / 关闭 / 导入导出', () => this._openFileMenu(this.btnFile));
    sep();
    // 模式
    this.btnModeSetup = mkBtn('骨架编辑', '编辑绑定姿势(骨架搭建)', () => this.setMode('setup'));
    this.btnModeAnim = mkBtn('动画编辑', '编辑关键帧动画', () => this.setMode('anim'));
    sep();
    // 工具
    this.btnToolSel = mkBtn('⬈ 选择', '选择/移动工具 (V)', () => this.setTool('select'));
    this.btnToolBone = mkBtn('🦴 创建骨骼', '拖拽创建骨骼:按住从起点拖到终点 (N / B)', () => this.setTool('bone'));
    sep();
    this.btnUndo = mkBtn('↩ 撤销', '撤销 (Ctrl+Z)', () => this.undo());
    this.btnRedo = mkBtn('↪ 重做', '重做 (Ctrl+Y)', () => this.redo());
    sep();
    this.btnBones = mkBtn('🦴 骨骼', '显示/隐藏骨骼辅助线', () => { this.showBones = !this.showBones; this.refresh(); });
    this.btnGrid = mkBtn('▦ 网格', '显示/隐藏网格', () => { this.showGrid = !this.showGrid; this.refresh(); });
    mkBtn('⤢ 适配', '缩放适配全部内容 (Ctrl+F)', () => this.stage.fitAll());
    this.btnOnion = mkBtn('◌ 洋葱皮', '显示前后帧残影', () => { this.onion = !this.onion; this.refresh(); });
    this._syncToolbar();
  }

  /** 文件菜单:项目管理 + 导入导出(原工具栏按钮全部收拢于此) */
  _openFileMenu(btn) {
    const r = btn.getBoundingClientRect();
    const recents = getBoneRecent().slice(0, RECENT_MAX);
    showContextMenu(r.left, r.bottom + 4, [
      { label: '✚ 新建项目', onClick: () => this.newProject() },
      { label: '📂 打开项目…', onClick: () => this.openProject() },
      { label: '🦂 打开 Spine 工程文件…', onClick: () => this.importSpineProjectFilePicker() },
      ...(recents.length
        ? [{ label: '🕘 打开最近 ▸', sub: recents.map((rc) => ({ label: `${rc.kind === 'spine' ? '🦂 Spine · ' : rc.kind === 'spineproj' ? '🦂 Spine 工程 · ' : '📂 项目 · '}${rc.name}`, onClick: () => this._openRecent(rc.path) })) }]
        : [{ label: '🕘 打开最近(暂无记录)', disabled: true }]),
      { label: '💾 保存项目(Ctrl+S)', onClick: () => this.saveProject() },
      { label: '💾 项目另存为…', onClick: () => this.saveProjectAs() },
      { label: '✖ 关闭项目', onClick: () => this.closeProject() },
      { label: '🖼 导入图片…', onClick: () => this.panels.importImages() },
      { label: '🦂 导入 Spine JSON…', onClick: () => this.importSpine() },
      { label: '🐲 导入 DragonBones/LoongBones…', onClick: () => this.importDbOrLoong() },
      { label: '📦 导出 DragonBones…', onClick: () => this.exportDb() },
      { label: '🦂 导出 Spine JSON…', onClick: () => this.exportSpine() },
      { label: '🦴 导出 Spine .skel…', onClick: () => this.exportSkel() },
      ...(this.project.spine ? [{ label: '🦂 导出 Spine 包(.json+.skel+.atlas)…', onClick: () => this.exportSpineBundle() }] : []),
      { label: '▶ 导出预览', onClick: () => this.previewExport() },
      { label: '🧩 纹理解包器…', onClick: () => this.textureUnpackTool() },
      { label: '📦 纹理打包器…', onClick: () => this.texturePackTool() },
    ]);
  }

  _syncToolbar() {
    this.btnModeSetup.classList.toggle('active', this.mode === 'setup');
    this.btnModeAnim.classList.toggle('active', this.mode === 'anim');
    this.btnToolSel.classList.toggle('active', this.tool === 'select');
    this.btnToolBone.classList.toggle('active', this.tool === 'bone');
    this.btnBones.classList.toggle('active', this.showBones);
    this.btnGrid.classList.toggle('active', this.showGrid);
    this.btnOnion.classList.toggle('active', this.onion);
    this.btnUndo.disabled = !this.undoStack.length;
    this.btnRedo.disabled = !this.redoStack.length;
  }

  /** Spine 项目守卫:结构增删会破坏原引用,仅允许变换/动画/颜色编辑 */
  _spineGuard() {
    if (this.project.spine) { toast('Spine 导入项目暂不支持增删/改名骨骼与插槽(会破坏原始引用);可编辑变换、关键帧、颜色与显示切换', 'warn'); return true; }
    return false;
  }

  /** 导入 Spine JSON:选 json → 同目录找 .atlas → 读页图 → 结构无损导入 */
  async importSpine() {
    try {
      const r = await window.api.pickFiles({
        title: '选择 Spine 骨架 JSON',
        multi: false,
        filters: [{ name: 'Spine JSON', extensions: ['json'] }],
      });
      const jsonPath = (!r || r.canceled) ? null : (r.filePaths || [])[0];
      if (!jsonPath) return;
      await this.importSpinePath(jsonPath);
    } catch (err) {
      toast('导入失败:' + err.message, 'err');
    }
  }

  /** 按路径导入 Spine JSON(文件菜单选择与空白页「最近导入」入口共用) */
  async importSpinePath(jsonPath) {
    const jr = await window.api.readText(jsonPath);
    if (!jr || !jr.ok) throw new Error('读取 JSON 失败');
    const json = JSON.parse(jr.text);
    // 同目录找 atlas:同名优先 → 非 -pma → 任一(-pma 为预乘 alpha 变体,仅作兜底)
    const dir = jsonPath.replace(/[\\/][^\\/]+$/, '');
    const base = jsonPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const dl = await window.api.listDir(dir);
    const names = ((dl && dl.files) || []).map((f) => f.name);
    const atlasName = names.find((f) => f.toLowerCase() === (base + '.atlas').toLowerCase())
      || names.find((f) => f.toLowerCase().endsWith('.atlas') && !f.toLowerCase().includes('pma'))
      || names.find((f) => f.toLowerCase().endsWith('.atlas'));
    let atlasText = '', pages = [];
    if (atlasName) {
      const ar = await window.api.readText(dir + '\\' + atlasName);
      if (ar && ar.ok) atlasText = ar.text;
      const atlas = parseAtlasText(atlasText);
      for (const pg of atlas.pages) {
        const pngName = names.find((f) => f.toLowerCase() === pg.name.toLowerCase())
          || names.find((f) => f.toLowerCase() === (pg.name + '.png').toLowerCase());
        if (!pngName) { toast(`页图 ${pg.name} 未找到,已跳过`, 'warn'); continue; }
        const b64 = await window.api.readBase64(dir + '\\' + pngName);
        if (b64 && b64.ok) pages.push({ name: pg.name, dataUrl: b64.dataUrl });
      }
    } else {
      toast('同目录未找到 .atlas,导入后无贴图(仅骨骼/动画数据)', 'warn');
    }
    const p = importSpineProject(json, { atlasText, pages });
    this._loadProject(p, '导入 Spine 项目');
    recordBoneRecent(jsonPath, p.name, 'spine');
    toast(`已导入 Spine ${p.spine.version}:${p.armature.bones.length} 骨骼 / ${p.armature.slots.length} 插槽 / ${p.armature.animations.length} 动画 / 皮肤「${p.spine.skin}」`);
  }

  // ---------------- Spine 编辑器工程文件(.spine) ----------------

  /** 选择并打开 Spine 编辑器工程文件(.spine,内置逆向解码 -> 可编辑项目) */
  async importSpineProjectFilePicker() {
    try {
      const r = await window.api.pickFiles({
        title: '选择 Spine 编辑器工程文件(.spine)',
        multi: false,
        filters: [{ name: 'Spine 工程文件', extensions: ['spine'] }],
      });
      const p = (!r || r.canceled) ? null : (r.filePaths || [])[0];
      if (!p) return;
      await this.importSpineProjectFile(p);
    } catch (err) {
      toast('打开失败:' + err.message, 'err');
    }
  }

  /**
   * 打开 Spine 编辑器工程文件(.spine):优先查找同目录或 export/ 子目录中的运行时 JSON
   * (.json + .atlas + .png),找到则走完整 Spine JSON 导入(官方运行时渲染,IK/约束/网格完整);
   * 未找到时降级为内置逆向解码器 -> 明文 JSON -> 编辑器项目(骨架变换可编辑,部分附件/动画有损)。
   */
  async importSpineProjectFile(spinePath) {
    const base = spinePath.replace(/^.*[\\/]/, '').replace(/\.spine$/i, '');
    const dir = spinePath.replace(/[\\/][^\\/]+$/, '');

    // ---- 优先:查找运行时 JSON(.json + .atlas 同目录;常见布局为 export/ 子目录) ----
    const runtimeJson = await this._findSiblingRuntimeJson(dir, base);
    if (runtimeJson) {
      await this.importSpinePath(runtimeJson);
      // 附加标记:来源为 .spine 工程,在最近记录中注明
      recordBoneRecent(spinePath, this.project.name, 'spineproj');
      toast(`已打开 Spine 工程(via 运行时 JSON):${runtimeJson.replace(/^.*[\\/]/, '')}`);
      return;
    }

    // ---- 降级:逆向解码器(解码数据有损 -- slot_hint 不可靠,mesh 附件无法渲染,仅 region + 骨架可编辑) ----
    const r = await window.api.decodeSpineProject({ inputPath: spinePath });
    if (!r || !r.ok) throw new Error('解码 .spine 工程失败:' + ((r && r.error) || '未知错误'));
    const decoded = JSON.parse(r.json);
    const imageFiles = await this._loadSpineProjectImages(spinePath, decoded);
    const p = importSpineEditorProject(decoded, { srcPath: spinePath, imageFiles });
    this._loadProject(p, '打开 Spine 工程');
    recordBoneRecent(spinePath, p.name, 'spineproj');
    const stats = r.stats || {};
    const imgNote = imageFiles.length ? ` / ${imageFiles.length} 张源图` : '(未找到源图目录,无贴图,仅骨骼)';
    toast(`已打开 Spine 工程 ${r.version || '?'}(逆向解码):${stats.bones ?? p.armature.bones.length} 骨骼 / ${stats.slots ?? p.armature.slots.length} 插槽 / ${p.armature.animations.length} 动画${imgNote}`);
  }

  /**
   * 在 .spine 文件同目录及 export/ 子目录查找运行时 JSON:
   * 同基名优先(如 spineboy-pro.spine -> spineboy-pro.json),其次目录中任意非 .lbone.json 的骨架 JSON。
   */
  async _findSiblingRuntimeJson(dir, base) {
    const cands = [];
    // 1) export/ 子目录同基名.json(Spine 编辑器常见的导出目录)
    cands.push(dir + '/export/' + base + '.json');
    // 2) 同目录同基名.json
    cands.push(dir + '/' + base + '.json');
    for (const p of cands) {
      if (await this._isSpineJson(p)) return p;
    }
    // 3) export/ 目录中任意非 .lbone.json 的骨架 JSON
    try {
      const dl = await window.api.listDir(dir + '/export');
      if (dl && dl.ok) {
        for (const f of (dl.files || [])) {
          if (f.isDir || !/\.json$/i.test(f.name) || /\.lbone\.json$/i.test(f.name)) continue;
          const full = dir + '/export/' + f.name;
          if (await this._isSpineJson(full)) return full;
        }
      }
    } catch (e) { /* export/ 不存在等 */ }
    return null;
  }

  /**
   * 加载 .spine 工程引用的源图目录图片:骨架 images 字段为相对路径(如 ./images/),
   * 先按「工程目录 + images 路径」查找,失败回落工程目录本身;
   * 每张图片读为 dataUrl 并解码出宽高(与 region 附件名同名即匹配)。
   */
  async _loadSpineProjectImages(spinePath, decoded) {
    const dir = spinePath.replace(/[\\/][^\\/]+$/, '');
    const rel = String((decoded.skeleton && decoded.skeleton.images) || '').replace(/^\.\//, '').replace(/[\\/]+$/, '');
    const cands = [];
    if (rel) cands.push(dir + '/' + rel);
    cands.push(dir);
    for (const d of cands) {
      let pngNames = [];
      try {
        const dl = await window.api.listDir(d);
        if (dl && dl.ok) pngNames = (dl.files || []).filter((f) => !f.isDir && /\.(png|jpg|jpeg|webp)$/i.test(f.name)).map((f) => f.name);
      } catch (e) { /* 目录不存在等 -> 试下一个候选 */ }
      if (!pngNames.length) continue;
      const out = [];
      for (const n of pngNames) {
        try {
          const b64 = await window.api.readBase64(d + '/' + n);
          if (!b64 || !b64.ok) continue;
          const el = await this._loadDataUrlImage(b64.dataUrl);
          out.push({ name: n.replace(/\.[^.]+$/, ''), dataUrl: b64.dataUrl, w: el.naturalWidth, h: el.naturalHeight });
        } catch (e) { /* 单图失败跳过,不影响其余 */ }
      }
      if (out.length) return out;
    }
    return [];
  }

  /** 导入 DragonBones 骨架 JSON 或 LoongBones 项目文档(Loong 先进程内转 DB 5.5) */
  async importDbOrLoong() {
    try {
      const r = await window.api.pickFiles({
        title: '选择 DragonBones 骨架 JSON 或 LoongBones 项目文档',
        multi: false,
        filters: [{ name: '骨骼动画数据', extensions: ['json'] }],
      });
      const jsonPath = (!r || r.canceled) ? null : (r.filePaths || [])[0];
      if (!jsonPath) return;
      const jr = await window.api.readText(jsonPath);
      if (!jr || !jr.ok) throw new Error('读取 JSON 失败');
      const json = JSON.parse(jr.text);

      // 类型识别与归一化 → DB 5.5 骨架对象
      let ske, texFileNameHint;
      if (json.runtime && json.runtime.dragonbones) {
        ske = loongDocToDbSke(json);
        texFileNameHint = 'texture'; // LoongBones 约定:同目录 texture.json + texture.png
      } else if (Array.isArray(json.armature)) {
        ske = json;
        texFileNameHint = jsonPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') + '_tex';
      } else {
        throw new Error('无法识别的 JSON:既不是 DragonBones 骨架也不是 LoongBones 项目文档');
      }

      // 同目录找纹理图集 json 与页图
      const dir = jsonPath.replace(/[\\/][^\\/]+$/, '');
      const dl = await window.api.listDir(dir);
      const names = ((dl && dl.files) || []).map((f) => f.name);
      const base = texFileNameHint;
      const texName = names.find((f) => f.toLowerCase() === (base + '.json').toLowerCase())
        || names.find((f) => /(^|_)tex\.json$/i.test(f))
        || names.find((f) => f.toLowerCase() === 'texture.json');
      if (!texName) throw new Error('同目录未找到纹理图集 JSON(_tex.json / texture.json)');
      const tr = await window.api.readText(dir + '\\' + texName);
      if (!tr || !tr.ok) throw new Error('读取纹理图集失败');
      const texJson = JSON.parse(tr.text);
      const pngName = names.find((f) => f === (texJson.imagePath || ''))
        || names.find((f) => f.toLowerCase() === (texJson.imagePath || 'texture.png').toLowerCase());
      if (!pngName) throw new Error(`页图 ${texJson.imagePath || 'texture.png'} 未找到`);
      const b64 = await window.api.readBase64(dir + '\\' + pngName);
      if (!b64 || !b64.ok) throw new Error('读取页图失败');

      const p = await importDragonBonesProject(ske, texJson, [{ name: pngName, dataUrl: b64.dataUrl }]);
      this.view = 'editor';
      this.beginEdit('导入 DragonBones/LoongBones');
      this.project = p;
      this.animName = (p.armature.animations[0] || {}).name || null;
      this.selection = null;
      this.keySel = null;
      this.frame = 0;
      this.mode = 'setup';
      this.rootEl?.classList.add('setup-mode');
      this.refresh();
      this.stage.fitAll();
      toast(`已导入:${p.armature.bones.length} 骨骼 / ${p.armature.slots.length} 插槽 / ${p.armature.animations.length} 动画`);
    } catch (err) {
      toast('导入失败:' + err.message, 'err');
    }
  }

  /** 导出 Spine JSON(任意项目类型:运行时导入/解码 .spine/自建) */
  async exportSpine() {
    try {
      const result = await buildSpineJsonFromModel(this.project);
      if (!result || !result.json) return;
      const dirR = await window.api.pickDirs({ title: '选择 Spine JSON 导出目录' });
      const dir = (!dirR || dirR.canceled) ? null : (dirR.filePaths || [])[0];
      if (!dir) return;
      const base = (this.project.name || 'spine_project').replace(/[\\/:*?"<>|]/g, '_');
      const jsonPath = dir + '\\' + base + '.json';
      await window.api.writeFileBase64(jsonPath, 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(result.json))));
      const files = [base + '.json'];
      // 有 atlas 数据时同步导出
      if (this.project.spine?.atlasText) {
        const { serializeAtlas } = await import('../editor/spineIO.js');
        const nameMap = new Map();
        for (const pg of this.project.spine.pages || []) {
          const ext = (pg.name.match(/\.[^.]+$/)?.[0]) || '.png';
          const newN = pg.name.slice(0, -ext.length) + '_edit' + ext;
          nameMap.set(pg.name, newN);
          await window.api.writeFileBase64(dir + '\\' + newN, pg.dataUrl);
          files.push(newN);
        }
        await window.api.writeFileBase64(dir + '\\' + base + '.atlas', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(serializeAtlas(this.project.spine.atlasText, nameMap)))));
        files.push(base + '.atlas');
      }
      toast(`已导出:${files.join(' / ')} -> ${dir}`);
    } catch (err) {
      toast('导出失败:' + err.message, 'err');
    }
  }

  /** 导出 Spine .skel 二进制(任意项目类型,复用 C++ SpineSkeletonDataConverter) */
  async exportSkel() {
    try {
      const result = await buildSpineJsonFromModel(this.project);
      if (!result || !result.json) return;
      const dirR = await window.api.pickDirs({ title: '选择 Spine .skel 导出目录' });
      const dir = (!dirR || dirR.canceled) ? null : (dirR.filePaths || [])[0];
      if (!dir) return;
      const base = (this.project.name || 'spine_project').replace(/[\\/:*?"<>|]/g, '_');
      const skelPath = dir + '\\' + base + '.skel';
      const ver = this.project.spine?.version;
      const targetVer = ver ? ver.split('.').slice(0, 2).join('.') : 'auto';
      const r = await window.api.jsonToSkel({ jsonContent: result.json, outputPath: skelPath, targetVersion: targetVer });
      if (!r || !r.ok) throw new Error((r && r.error) || '.skel 转换失败');
      toast(`已导出:${base}.skel -> ${dir}`);
    } catch (err) {
      toast('导出失败:' + err.message, 'err');
    }
  }

  /** 导出 Spine 完整包(.json + .skel + .atlas + 页图,仅 Spine 导入项目) */
  async exportSpineBundle() {
    try {
      const result = await buildSpineJsonFromModel(this.project);
      if (!result || !result.json) return;
      const dirR = await window.api.pickDirs({ title: '选择 Spine 包导出目录' });
      const dir = (!dirR || dirR.canceled) ? null : (dirR.filePaths || [])[0];
      if (!dir) return;
      const base = (this.project.name || 'spine_project').replace(/[\\/:*?"<>|]/g, '_');
      const files = [];
      // .json
      await window.api.writeFileBase64(dir + '\\' + base + '.json', 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(result.json))));
      files.push(base + '.json');
      // .skel
      const ver = this.project.spine?.version;
      const targetVer = ver ? ver.split('.').slice(0, 2).join('.') : 'auto';
      const skelR = await window.api.jsonToSkel({ jsonContent: result.json, outputPath: dir + '\\' + base + '.skel', targetVersion: targetVer });
      if (skelR && skelR.ok) files.push(base + '.skel');
      // .atlas + 页图
      if (this.project.spine?.atlasText) {
        const { serializeAtlas } = await import('../editor/spineIO.js');
        const nameMap = new Map();
        for (const pg of this.project.spine.pages || []) {
          const ext = (pg.name.match(/\.[^.]+$/)?.[0]) || '.png';
          const newN = pg.name.slice(0, -ext.length) + '_edit' + ext;
          nameMap.set(pg.name, newN);
          await window.api.writeFileBase64(dir + '\\' + newN, pg.dataUrl);
          files.push(newN);
        }
        await window.api.writeFileBase64(dir + '\\' + base + '.atlas', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(serializeAtlas(this.project.spine.atlasText, nameMap)))));
        files.push(base + '.atlas');
      }
      toast(`已导出 Spine 包:${files.join(' / ')} -> ${dir}`);
    } catch (err) {
      toast('导出失败:' + err.message, 'err');
    }
  }

  // ---------------- 状态与历史 ----------------

  beginEdit(label) {
    this.undoStack.push(serialize(this.project));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
    this._lastLabel = label;
    this._syncToolbar();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(serialize(this.project));
    this.project = deserialize(this.undoStack.pop());
    this._afterHistorySwap();
    toast('已撤销:' + (this._lastLabel || ''));
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(serialize(this.project));
    this.project = deserialize(this.redoStack.pop());
    this._afterHistorySwap();
  }

  _afterHistorySwap() {
    // 校验引用有效性
    if (this.animName && !findAnim(this.project, this.animName)) this.animName = (this.project.armature.animations[0] || {}).name || null;
    if (this.selection) {
      const ok = this.selection.type === 'bone'
        ? this.project.armature.bones.some((b) => b.name === this.selection.name)
        : this.project.armature.slots.some((s) => s.name === this.selection.name);
      if (!ok) this.selection = null;
    }
    this.keySel = null;
    this.refresh();
  }

  select(type, name) {
    this.selection = type ? { type, name } : null;
    this.keySel = null;
    this.refresh();
  }

  refresh(opts = {}) {
    this.stage?.render();
    if (!opts.skipProps) this.panels?.refreshProps?.();
    this.panels?.refreshLibrary?.();
    this.panels?.refreshOutline?.();
    this.panels?.refreshZOrder?.();
    this.timeline?.refresh?.();
    this._syncToolbar();
    this._syncZoomLabel();
    // 视图切换:默认首页(快速打开/新建/导入/最近) vs 编辑视图(空白项目/正常项目)
    const home = this.container.querySelector('.be-home');
    if (home) home.hidden = this.view !== 'home';
    const hint = this.container.querySelector('.be-stage-empty');
    if (hint) {
      const inBlankProject = this.view === 'editor' && this.isBlank;
      hint.hidden = !inBlankProject;
      const rb = hint.querySelector('.be-restore-draft');
      if (rb) {
        const d = this._loadDraft();
        const restorable = !!(d && (d.armature.bones.length || d.armature.slots.length || d.spine));
        rb.hidden = !inBlankProject || !restorable;
      }
    }
    this._renderRecent();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveDraftNow(), 900);
  }

  refreshPanels() {
    this.panels?.refreshProps?.();
    this.timeline?.refresh?.();
    this.stage?.render();
  }

  _saveDraftNow() {
    // 空白等待态不写草稿:避免覆盖「恢复上次编辑」可用的草稿(关闭项目时显式清除)
    if (this.isBlank) return;
    try { localStorage.setItem(DRAFT_KEY, serialize(this.project)); } catch (e) { /* 超限时忽略 */ }
  }

  _loadDraft() {
    try {
      const s = localStorage.getItem(DRAFT_KEY);
      if (!s) return null;
      return deserialize(s);
    } catch (e) { return null; }
  }

  // ---------------- 编辑意图 ----------------

  setMode(m) {
    this.mode = m;
    if (m === 'anim') {
      if (!this.animName) {
        if (!this.project.armature.animations.length) this.project.armature.animations.push({ name: 'new_animation', duration: 30, loop: true, bones: {}, slots: {} });
        this.animName = this.project.armature.animations[0].name;
      }
      this.frame = 0;
    } else {
      this.playing = false;
    }
    this.tool = 'select';
    // 骨架编辑模式隐藏时间轴(摄影表),动画模式展开(参考 Spine 工作流)
    this.rootEl?.classList.toggle('setup-mode', m !== 'anim');
    this.refresh();
  }

  setTool(t) { this.tool = t; this._syncToolbar(); }

  /** 骨骼编辑入口:绑定模式写 setup;动画模式自动关键帧 */
  editBone(name, props) {
    const bone = this.project.armature.bones.find((b) => b.name === name);
    if (!bone) return;
    if (this.mode === 'setup') {
      Object.assign(bone, props);
      this.stage.render();
      return;
    }
    const anim = this.ctx.anim;
    if (!anim) return;
    const f = Math.round(this.frame);
    const cur = sampleAnimation(anim, f);
    const ov = cur.bones[name] || {};
    // Spine 项目的键值语义 = 相对 setup 的增量(translate/rotate)与倍率(scale),与导入键一致;
    // props 传入的是绝对局部值 -> 换算后再存
    const sp = !!this.project.spine;
    if (props.x !== undefined || props.y !== undefined) {
      const x = props.x !== undefined ? (sp ? props.x - bone.x : props.x) : (ov.x !== undefined ? ov.x : (sp ? 0 : bone.x));
      const y = props.y !== undefined ? (sp ? props.y - bone.y : props.y) : (ov.y !== undefined ? ov.y : (sp ? 0 : bone.y));
      this._upsertKey(anim, name, 'translate', f, { x, y });
    }
    if (props.rotation !== undefined) {
      this._upsertKey(anim, name, 'rotate', f, { rotation: sp ? props.rotation - bone.rotation : props.rotation });
    }
    if (props.scaleX !== undefined || props.scaleY !== undefined) {
      const sx = props.scaleX !== undefined ? (sp ? props.scaleX / (bone.scaleX || 1) : props.scaleX) : (ov.scaleX !== undefined ? ov.scaleX : (sp ? 1 : bone.scaleX));
      const sy = props.scaleY !== undefined ? (sp ? props.scaleY / (bone.scaleY || 1) : props.scaleY) : (ov.scaleY !== undefined ? ov.scaleY : (sp ? 1 : bone.scaleY));
      this._upsertKey(anim, name, 'scale', f, { scaleX: sx, scaleY: sy });
    }
    this.stage.render();
    this.timeline.refresh();
  }

  _boneStore(anim, name, ch, create = true) {
    if (!anim.bones[name] && create) anim.bones[name] = {};
    const st = anim.bones[name];
    if (!st[ch] && create) st[ch] = [];
    return st ? st[ch] : null;
  }

  _slotStore(anim, name, ch, create = true) {
    if (!anim.slots[name] && create) anim.slots[name] = {};
    const st = anim.slots[name];
    if (!st[ch] && create) st[ch] = [];
    return st ? st[ch] : null;
  }

  _upsertKey(anim, name, ch, frame, v, isSlot = false) {
    const arr = isSlot ? this._slotStore(anim, name, ch) : this._boneStore(anim, name, ch);
    if (!arr) return;
    let key = arr.find((k) => k.frame === frame);
    if (!key) {
      key = { frame, v: { ...v }, ease: { type: 'sineInOut' } };
      arr.push(key);
      arr.sort((a, b) => a.frame - b.frame);
    } else {
      key.v = { ...key.v, ...v };
    }
    return key;
  }

  /** 当前姿势下骨骼各通道的值(动画模式优先采样) */
  _boneChannelValue(name) {
    const bone = this.project.armature.bones.find((b) => b.name === name);
    if (!bone) return null;
    const anim = this.ctx.anim;
    // Spine 项目:键值 = 相对 setup 的增量/倍率 -> 无键时回落 0/1 而非 setup 绝对值
    const sp = !!this.project.spine;
    if (this.mode === 'anim' && anim) {
      const ov = sampleAnimation(anim, this.frame).bones[name] || {};
      return {
        translate: { x: ov.x ?? (sp ? 0 : bone.x), y: ov.y ?? (sp ? 0 : bone.y) },
        rotate: { rotation: ov.rotation ?? (sp ? 0 : bone.rotation) },
        scale: { scaleX: ov.scaleX ?? (sp ? 1 : bone.scaleX), scaleY: ov.scaleY ?? (sp ? 1 : bone.scaleY) },
      };
    }
    if (sp) return { translate: { x: 0, y: 0 }, rotate: { rotation: 0 }, scale: { scaleX: 1, scaleY: 1 } };
    return {
      translate: { x: bone.x, y: bone.y },
      rotate: { rotation: bone.rotation },
      scale: { scaleX: bone.scaleX, scaleY: bone.scaleY },
    };
  }

  insertBoneKeys(name, channels, atFrame) {
    const anim = this.ctx.anim;
    if (!anim) { toast('请先切换到动画编辑模式', 'warn'); return; }
    this.beginEdit('插入关键帧');
    const f = Math.round(atFrame !== undefined ? atFrame : this.frame);
    const val = this._boneChannelValue(name);
    if (!val) return;
    for (const ch of channels || ['translate', 'rotate', 'scale']) {
      if (!val[ch]) continue;
      this._upsertKey(anim, name, ch, f, val[ch]);
    }
    this.frame = Math.min(f, anim.duration);
    this.refresh();
  }

  insertSlotKeys(name, channels, atFrame) {
    const anim = this.ctx.anim;
    if (!anim) { toast('请先切换到动画编辑模式', 'warn'); return; }
    const slot = this.project.armature.slots.find((s) => s.name === name);
    if (!slot) return;
    this.beginEdit('插入关键帧');
    const f = Math.round(atFrame !== undefined ? atFrame : this.frame);
    const ov = sampleAnimation(anim, f).slots[name] || {};
    for (const ch of channels || ['color', 'display']) {
      if (ch === 'color') this._upsertKey(anim, name, 'color', f, { r: ov.r ?? slot.color.r, g: ov.g ?? slot.color.g, b: ov.b ?? slot.color.b, a: ov.a ?? slot.color.a }, true);
      else this._upsertKey(anim, name, 'display', f, { displayIndex: ov.displayIndex ?? slot.displayIndex }, true);
    }
    this.frame = Math.min(f, anim.duration);
    this.refresh();
  }

  insertChannelKeyAt(target, channel, f) {
    const isSlot = channel === 'color' || channel === 'display';
    if (isSlot) this.insertSlotKeys(target, [channel], f);
    else this.insertBoneKeys(target, [channel], f);
  }

  findKey(ks) {
    if (!ks) return null;
    const anim = this.ctx.anim;
    if (!anim) return null;
    const isSlot = ks.channel === 'color' || ks.channel === 'display';
    const store = isSlot ? (anim.slots[ks.target] || {}) : (anim.bones[ks.target] || {});
    const arr = store[ks.channel] || [];
    return arr.find((k) => k.frame === ks.frame) || null;
  }

  moveKey(ks, frame) {
    const key = this.findKey(ks);
    if (!key) return;
    this.beginEdit('移动关键帧');
    const anim = this.ctx.anim;
    const isSlot = ks.channel === 'color' || ks.channel === 'display';
    const arr = isSlot ? this._slotStore(anim, ks.target, ks.channel) : this._boneStore(anim, ks.target, ks.channel);
    const dup = arr.findIndex((k) => k !== key && k.frame === frame);
    if (dup >= 0) arr.splice(dup, 1);
    key.frame = Math.max(0, frame);
    arr.sort((a, b) => a.frame - b.frame);
    this.keySel = { ...ks, frame: key.frame };
    this.refresh();
  }

  deleteKey() {
    const ks = this.keySel;
    if (!ks) return;
    const anim = this.ctx.anim;
    if (!anim) return;
    this.beginEdit('删除关键帧');
    const isSlot = ks.channel === 'color' || ks.channel === 'display';
    const store = isSlot ? anim.slots[ks.target] : anim.bones[ks.target];
    if (store && store[ks.channel]) {
      store[ks.channel] = store[ks.channel].filter((k) => k.frame !== ks.frame);
      if (!store[ks.channel].length) delete store[ks.channel];
      if (!Object.keys(store).length) delete (isSlot ? anim.slots : anim.bones)[ks.target];
    }
    this.keySel = null;
    this.refresh();
  }

  pasteKey(clip) {
    if (!clip) return;
    const anim = this.ctx.anim;
    if (!anim) return;
    const target = this.keySel ? this.keySel.target
      : this.selection ? this.selection.name : null;
    if (!target) { toast('请先选中骨骼/插槽或关键帧', 'warn'); return; }
    this.beginEdit('粘贴关键帧');
    const f = Math.round(this.frame);
    this._upsertKey(anim, target, clip.channel, f, JSON.parse(JSON.stringify(clip.v)), clip.channel === 'color' || clip.channel === 'display');
    const key = this.findKey({ target, channel: clip.channel, frame: f });
    if (key && clip.ease) key.ease = JSON.parse(JSON.stringify(clip.ease));
    this.keySel = { target, channel: clip.channel, frame: f };
    this.refresh();
  }

  // ---------------- 骨架结构编辑 ----------------

  createBone(parentName, x, y, rotation, length) {
    if (this._spineGuard()) return;
    this.beginEdit('创建骨骼');
    const name = uniqueName(this.project.armature.bones.map((b) => b.name), 'bone');
    const bone = createBone(name, parentName || '', x, y, rotation, length);
    this.project.armature.bones.push(bone);
    this.selection = { type: 'bone', name };
    // 链式创建(参考 LoongBones/DragonBones):保持骨骼工具激活,下一根自动挂到本骨骼
    if (this.tool === 'bone') this._syncToolbar();
    else this.setTool('select');
    this.refresh();
    toast(`已创建骨骼 ${name}(继续拖拽可链式创建子骨骼)`);
  }

  addBoneChild(parentName) {
    if (this._spineGuard()) return;
    const parent = this.project.armature.bones.find((b) => b.name === parentName);
    if (!parent) return;
    const worlds = computeWorldTransforms(this.project, null);
    const pw = worlds.get(parentName);
    const tipLocal = { x: parent.length, y: 0 };
    this.createBone(parentName, tipLocal.x, tipLocal.y, 0, 50);
    void pw;
  }

  addSlotTo(boneName) {
    if (this._spineGuard()) return;
    const im = this.project.images[0];
    if (!im) { toast('请先在资源库导入图片', 'warn'); return; }
    this.beginEdit('添加插槽');
    const name = uniqueName(this.project.armature.slots.map((s) => s.name), 'slot');
    const slot = createSlot(name, boneName);
    slot.displays.push(createDisplay(im.name.replace(/\.[^.]+$/, ''), im.id));
    slot.z = this.project.armature.slots.length;
    this.project.armature.slots.push(slot);
    this.selection = { type: 'slot', name };
    this.refresh();
  }

  bindImageAt(imageId, wx, wy) {
    if (this._spineGuard()) return;
    const boneName = (this.selection && this.selection.type === 'bone' && this.selection.name)
      || (this.project.armature.bones[0] && this.project.armature.bones[0].name);
    if (!boneName) { toast('请先创建骨骼', 'warn'); return; }
    const im = this.project.images.find((i) => i.id === imageId);
    if (!im) return;
    this.beginEdit('绑定图片');
    const worlds = computeWorldTransforms(this.project, null);
    const local = worldToParentLocal(worlds.get(boneName), wx, wy);
    const slotName = uniqueName(this.project.armature.slots.map((s) => s.name), im.name.replace(/\.[^.]+$/, '') || 'slot');
    const slot = createSlot(slotName, boneName);
    const disp = createDisplay(im.name.replace(/\.[^.]+$/, ''), imageId);
    disp.transform.x = Math.round(local.x);
    disp.transform.y = Math.round(local.y);
    slot.displays.push(disp);
    slot.z = this.project.armature.slots.length;
    this.project.armature.slots.push(slot);
    this.selection = { type: 'slot', name: slotName };
    this.refresh();
    toast(`已绑定 ${im.name} → 骨骼 ${boneName}`);
  }

  deleteBone(name) {
    if (this._spineGuard()) return;
    const bones = this.project.armature.bones;
    const bone = bones.find((b) => b.name === name);
    if (!bone) return;
    const childN = bones.filter((b) => b.parent === name).length;
    const doDel = () => {
      this.beginEdit('删除骨骼');
      for (const b of bones) if (b.parent === name) b.parent = bone.parent || '';
      this.project.armature.bones = bones.filter((b) => b.name !== name);
      // 挂在该骨骼下的插槽:移到父骨骼(无父则删除)
      for (const s of this.project.armature.slots) if (s.parent === name) s.parent = bone.parent || (this.project.armature.bones[0] ? this.project.armature.bones[0].name : s.parent);
      for (const a of this.project.armature.animations) if (a.bones[name]) delete a.bones[name];
      this.selection = null;
      this.refresh();
    };
    if (childN) {
      confirmDialog({ title: '删除骨骼', message: `${name} 有 ${childN} 个子骨骼,删除后子骨骼将挂到其父级。确定删除?`, danger: true, onOk: doDel });
    } else doDel();
  }

  deleteSlot(name) {
    if (this._spineGuard()) return;
    this.beginEdit('删除插槽');
    this.project.armature.slots = this.project.armature.slots.filter((s) => s.name !== name);
    for (const a of this.project.armature.animations) if (a.slots[name]) delete a.slots[name];
    this.selection = null;
    this.refresh();
  }

  renameSlot(name, newName) {
    if (this._spineGuard()) return;
    const slot = this.project.armature.slots.find((s) => s.name === name);
    if (!slot || !newName || newName === name) return;
    const final = uniqueName(this.project.armature.slots.filter((s) => s.name !== name).map((s) => s.name), newName);
    slot.name = final;
    for (const a of this.project.armature.animations) {
      if (a.slots[name]) { a.slots[final] = a.slots[name]; delete a.slots[name]; }
    }
    this.selection = { type: 'slot', name: final };
  }

  reparentBone(name, newParent) {
    if (this._spineGuard()) return;
    if (name === newParent) return;
    // 环检测:newParent 不能是 name 的后代
    const bones = this.project.armature.bones;
    let p = newParent;
    while (p) {
      if (p === name) { toast('不能挂到自己的子骨骼下', 'warn'); return; }
      p = (bones.find((b) => b.name === p) || {}).parent;
    }
    this.beginEdit('调整父级');
    (bones.find((b) => b.name === name) || {}).parent = newParent;
    this.refresh();
  }

  moveSlotZ(name, dir) {
    const order = [...this.project.armature.slots].sort((a, b) => a.z - b.z);
    const idx = order.findIndex((s) => s.name === name);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= order.length) return;
    this.beginEdit('调整层级');
    [order[idx], order[swap]] = [order[swap], order[idx]];
    order.forEach((s, i) => { s.z = i; });
    this.refresh();
  }

  // ---------------- 动画管理 ----------------

  setAnimation(name) {
    this.animName = name;
    this.frame = 0;
    this.keySel = null;
    if (this.mode !== 'anim') this.mode = 'anim';
    this.refresh();
  }

  newAnimation() {
    promptDialog({
      title: '新建动画',
      fields: [{ name: 'name', label: '动画名', value: 'animation' + (this.project.armature.animations.length + 1) }, { name: 'dur', label: '时长(帧)', value: '30' }],
      onOk: (v) => {
        const name = uniqueName(this.project.armature.animations.map((a) => a.name), v.name || 'animation');
        const dur = Math.max(1, parseInt(v.dur, 10) || 30);
        this.beginEdit('新建动画');
        this.project.armature.animations.push({ name, duration: dur, loop: true, bones: {}, slots: {} });
        this.animName = name;
        this.mode = 'anim';
        this.frame = 0;
        this.refresh();
      },
    });
  }

  renameAnimation() {
    const anim = this.ctx.anim;
    if (!anim) return;
    promptDialog({
      title: '重命名动画', fields: [{ name: 'name', label: '动画名', value: anim.name }],
      onOk: (v) => {
        if (!v.name || v.name === anim.name) return;
        this.beginEdit('重命名动画');
        anim.name = uniqueName(this.project.armature.animations.map((a) => a.name).filter((n) => n !== anim.name), v.name);
        this.animName = anim.name;
        this.refresh();
      },
    });
  }

  deleteAnimation() {
    const anim = this.ctx.anim;
    if (!anim) return;
    if (this.project.armature.animations.length <= 1) { toast('至少保留一个动画', 'warn'); return; }
    confirmDialog({
      title: '删除动画', message: `确定删除动画「${anim.name}」?其全部关键帧将丢失。`, danger: true,
      onOk: () => {
        this.beginEdit('删除动画');
        this.project.armature.animations = this.project.armature.animations.filter((a) => a !== anim);
        this.animName = this.project.armature.animations[0].name;
        this.frame = 0;
        this.keySel = null;
        this.refresh();
      },
    });
  }

  setFrame(f) {
    const dur = this.ctx.anim ? this.ctx.anim.duration : 1e9;
    if (this.loop && this.playing && f > dur) f = 0;
    this.frame = Math.max(0, Math.min(dur, f));
    this.stage?.render();
    this.timeline?.updatePlayhead();
  }

  // ---------------- 播放循环 ----------------

  _tick(t) {
    this._raf = requestAnimationFrame(this._loop);
    if (!this.playing) return;
    const dt = this._lastT ? Math.min(0.05, (t - this._lastT) / 1000) : 0.016;
    this._lastT = t;
    const dur = this.ctx.anim ? this.ctx.anim.duration : 0;
    const dir = this.playDir || 1;
    let f = this.frame + dt * (this.project.frameRate || 30) * dir;
    if (dir > 0 && f >= dur) {
      if (this.loop) f = f % Math.max(1, dur);
      else { f = dur; this.playing = false; this.timeline?.refreshHead?.(); }
    } else if (dir < 0 && f <= 0) {
      if (this.loop) f = dur - (Math.max(1, dur) ? (0 - f) % Math.max(1, dur) : 0);
      else { f = 0; this.playing = false; this.timeline?.refreshHead?.(); }
    }
    this.frame = f;
    this.stage?.render();
    this.timeline?.updatePlayhead();
    if (!this.playing) this._lastT = 0;
    if (this.playing) this._lastT = t;
  }

  // ---------------- 项目 ----------------

  /** 是否空白等待态(无骨骼无贴图) */
  get isBlank() {
    return !this.project.armature.bones.length && !this.project.images.length && !this.project.spine;
  }

  /** 载入项目并复位编辑器状态(打开/导入/最近入口共用);从首页切到编辑视图 */
  _loadProject(p, label) {
    this.beginEdit(label);
    this.view = 'editor';
    this.project = p;
    this.animName = (p.armature.animations[0] || {}).name || null;
    this.selection = null;
    this.keySel = null;
    this.frame = 0;
    this.mode = 'setup';
    this.refresh();
    this.stage.fitAll();
  }

  /** 默认首页「最近打开 / 导入」快捷入口(最多 5 条,仅首页展示) */
  _renderRecent() {
    const box = this.container.querySelector('.be-recent');
    if (!box) return;
    const list = getBoneRecent().slice(0, RECENT_MAX);
    if (this.view !== 'home' || !list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="be-recent-title">🕘 最近打开 / 导入</div>
      ${list.map((r) => `
        <div class="be-recent-item" data-path="${escapeHtml(r.path || '')}" title="${escapeHtml((r.name || '') + ' · ' + (r.path || ''))}">
          <span class="be-recent-ico">${r.kind === 'spine' ? '🦂' : r.kind === 'spineproj' ? '🦂' : '📂'}</span>
          <span class="be-recent-name">${escapeHtml(r.name || '')}</span>
          <span class="be-recent-kind">${r.kind === 'spine' ? 'Spine' : r.kind === 'spineproj' ? 'Spine 工程' : '项目'}</span>
        </div>`).join('')}`;
    box.querySelectorAll('.be-recent-item').forEach((el) => {
      el.addEventListener('click', () => this._openRecent(el.dataset.path));
    });
  }

  /** 点击最近入口:按记录类型再次 打开项目 / 打开 Spine 工程 / 导入 Spine */
  async _openRecent(path) {
    const rec = getBoneRecent().find((r) => _normPath(r.path) === _normPath(path));
    if (!rec) { toast('记录不存在', 'warn'); return; }
    try {
      if (rec.kind === 'spineproj') { await this.importSpineProjectFile(rec.path); return; }
      if (rec.kind === 'spine') { await this.importSpinePath(rec.path); return; }
      const r = await window.api.readText(rec.path);
      if (!r || !r.ok) throw new Error('读取项目文件失败:' + (r && r.error));
      const p = JSON.parse(r.text);
      this._loadProject(p, '打开项目');
      recordBoneRecent(rec.path, p.name, 'project');
      toast('项目已打开');
    } catch (err) {
      toast('打开失败:' + err.message, 'err');
    }
  }

  /** 回到默认首页(重置编辑器为空白等待态,不写草稿) */
  _goHome() {
    this.view = 'home';
    this.project = createBlankProject();
    this.animName = this.project.armature.animations[0].name;
    this.selection = null;
    this.keySel = null;
    this.frame = 0;
    this.playing = false;
    this.mode = 'setup';
    this.tool = 'select';
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    this.refresh();
    this.stage.camera = { x: (this.stage.container?.clientWidth || 800) / 2, y: (this.stage.container?.clientHeight || 500) / 2, zoom: 1 };
    this.stage.render();
  }

  /** 关闭当前项目:回到默认首页(空白项目 / 正常项目均适用) */
  closeProject() {
    if (this.view === 'home') { toast('当前已在首页'); return; }
    if (this.isBlank) { this._goHome(); toast('已返回首页'); return; }
    confirmDialog({
      title: '关闭项目', message: `确定关闭「${this.project.name}」?未保存的修改将丢失。`, danger: true,
      onOk: () => {
        this._goHome();
        toast('已关闭,返回首页(快速 打开 / 新建 / 导入)');
      },
    });
  }

  newProject() {
    confirmDialog({
      title: '新建项目', message: '当前未保存的修改将丢失(自动草稿会被覆盖)。确定新建?', danger: true,
      onOk: () => {
        // 新建动画项目 → 进入编辑视图,显示空白项目页(空白等待态)
        this.view = 'editor';
        this.beginEdit('新建项目');
        this.project = createProject();
        this.animName = this.project.armature.animations[0].name;
        this.selection = null;
        this.keySel = null;
        this.frame = 0;
        this.mode = 'setup';
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.refresh();
        this.stage.fitAll();
      },
    });
  }

  /** 读取 JSON 文本并判断是否 Spine 骨架数据 */
  async _isSpineJson(path) {
    const r = await window.api.readText(path);
    if (!r || !r.ok) return false;
    try { const d = JSON.parse(r.text); return !!(d && d.skeleton && d.bones); } catch (err) { return false; }
  }

  /** 依据所选 .atlas/.png 在同目录推导 Spine 骨架 JSON(同基名优先,其次任意非 .lbone.json 的 json) */
  async _findSiblingSpineJson(path) {
    const dir = path.replace(/[\\/][^\\/]+$/, '');
    const base = path.replace(/^.*[\\/]/, '').replace(/\.(atlas|png)$/i, '');
    const ld = await window.api.listDir(dir);
    if (!ld || !ld.ok) return null;
    const names = (ld.files || []).filter((f) => !f.isDir).map((f) => f.name);
    const cands = [];
    if (names.includes(base + '.json')) cands.push(base + '.json');
    for (const n of names) if (/\.json$/i.test(n) && !/\.lbone\.json$/i.test(n) && !cands.includes(n)) cands.push(n);
    for (const c of cands) {
      if (await this._isSpineJson(dir + '/' + c)) return dir + '/' + c;
    }
    return null;
  }

  /** 打开:支持 .lbone.json 项目、Spine 编辑器工程 .spine,或直接选 Spine 的 .json / .atlas / .png(可多选,自动识别组合) */
  async openProject() {
    try {
      const pr = await window.api.pickFiles({
        title: '打开项目 / Spine 工程或动画(.spine .json .atlas .png 可多选)',
        multi: true,
        filters: [
          { name: '骨骼动画相关文件', extensions: ['lbone.json', 'json', 'atlas', 'png', 'spine'] },
        ],
      });
      const paths = (!pr || pr.canceled) ? [] : (pr.filePaths || []);
      if (!paths.length) return;
      // 0) Spine 编辑器工程文件(.spine)-> 逆向解码为可编辑项目
      const spineProj = paths.find((p) => /\.spine$/i.test(p));
      if (spineProj) { await this.importSpineProjectFile(spineProj); return; }
      // 1) 选中的 .json 若为 Spine 骨架 -> 直接按 Spine 组合导入
      const json = paths.find((p) => /\.json$/i.test(p));
      if (json && await this._isSpineJson(json)) { await this.importSpinePath(json); return; }
      // 2) 选了 .atlas / .png -> 同目录找 Spine 骨架 json
      for (const p of paths) {
        if (/\.(atlas|png)$/i.test(p)) {
          const cand = await this._findSiblingSpineJson(p);
          if (cand) { await this.importSpinePath(cand); return; }
        }
      }
      // 3) 普通项目(.lbone.json / 编辑器导出的 json)
      const projPath = json || paths[0];
      const r = await window.api.readText(projPath);
      if (!r || !r.ok) throw new Error('读取项目文件失败:' + (r && r.error));
      let p;
      try { p = JSON.parse(r.text); } catch (err) { throw new Error('不是有效的项目或 Spine JSON 文件'); }
      this._loadProject(p, '打开项目');
      recordBoneRecent(projPath, p.name, 'project');
      toast('项目已打开');
    } catch (err) {
      toast('打开失败:' + err.message, 'err');
    }
  }

  _loadDataUrlImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片解码失败'));
      el.src = dataUrl;
    });
  }

  /** 纹理解包器:选 Spine .atlas(自动配同目录页图)-> 每个区域还原(旋转/trim)导出为独立 PNG */
  async textureUnpackTool() {
    try {
      const pr = await window.api.pickFiles({
        title: '选择要解包的纹理图集(.atlas,页图取同目录)',
        multi: false,
        filters: [{ name: 'Spine 图集', extensions: ['atlas'] }],
      });
      const paths = (!pr || pr.canceled) ? [] : (pr.filePaths || []);
      if (!paths.length) return;
      const tr = await window.api.readText(paths[0]);
      if (!tr || !tr.ok) throw new Error('读取图集失败:' + (tr && tr.error));
      const atlas = parseAtlasText(tr.text);
      if (!atlas.regions.size) throw new Error('图集中没有区域');
      const dir = paths[0].replace(/[\\/][^\\/]+$/, '');
      const ld = await window.api.listDir(dir);
      const dirPngs = (ld && ld.ok) ? (ld.files || []).filter((f) => !f.isDir && /\.png$/i.test(f.name)).map((f) => f.name) : [];
      const pageImgs = new Map();
      for (const pg of atlas.pages) {
        const hit = dirPngs.includes(pg.name) ? pg.name : dirPngs.find((n) => n.replace(/\.[^.]+$/, '') === pg.name.replace(/\.[^.]+$/, ''));
        if (!hit) throw new Error('找不到页图:' + pg.name + '(需与 .atlas 同目录)');
        const rb = await window.api.readBase64(dir + '/' + hit);
        if (!rb || !rb.ok) throw new Error('读取页图失败:' + hit);
        pageImgs.set(pg.name, await this._loadDataUrlImage(rb.dataUrl));
      }
      const dr = await window.api.pickDirs({ title: '选择解包输出目录' });
      const outDirs = (!dr || dr.canceled) ? [] : (dr.filePaths || []);
      if (!outDirs.length) return;
      const outDir = outDirs[0].replace(/[\\/]+$/, '');
      const multiPage = atlas.pages.length > 1;
      let n = 0;
      const fails = [];
      for (const pg of atlas.pages) {
        const img = pageImgs.get(pg.name);
        const prefix = multiPage ? pg.name.replace(/\.[^.]+$/, '') + '_' : '';
        for (const r of atlas.regions.values()) {
          if (r.page !== pg.name) continue;
          try {
            const url = cropRegionToDataUrl(img, r);
            const safe = (r.index >= 0 ? `${r.name}_${r.index}` : r.name).replace(/[\\/:*?"<>|]/g, '_');
            const w = await window.api.writeFileBase64(outDir + '/' + prefix + safe + '.png', url);
            if (w && w.ok !== false) n++; else fails.push(r.name);
          } catch (err) { fails.push(r.name); }
        }
      }
      if (fails.length) toast(`解包完成:${n} 张,失败 ${fails.length} 张(${fails.slice(0, 3).join(', ')}…)`, 'warn');
      else toast(`解包完成:共导出 ${n} 张 PNG → ${outDir}`);
    } catch (err) {
      toast('解包失败:' + err.message, 'err');
    }
  }

  /** 纹理打包器:选多张 PNG -> MaxRects 装箱导出图集 PNG(多页自动编号) + Spine 格式 .atlas */
  async texturePackTool() {
    try {
      const pr = await window.api.pickFiles({
        title: '选择要打包的图片(可多选)',
        multi: true,
        filters: [{ name: '图片', extensions: ['png'] }],
      });
      const paths = (!pr || pr.canceled) ? [] : (pr.filePaths || []);
      if (!paths.length) return;
      const items = [];
      for (const p of paths) {
        const rb = await window.api.readBase64(p);
        if (!rb || !rb.ok) throw new Error('读取图片失败:' + p);
        const el = await this._loadDataUrlImage(rb.dataUrl);
        const name = p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
        items.push({ name, srcW: el.naturalWidth, srcH: el.naturalHeight, trimX: 0, trimY: 0, trimW: el.naturalWidth, trimH: el.naturalHeight, img: el });
      }
      const pages = packImages(items, { maxSize: 2048, padding: 2, allowRotation: false, pot: false });
      const dr = await window.api.pickDirs({ title: '选择打包输出目录' });
      const outDirs = (!dr || dr.canceled) ? [] : (dr.filePaths || []);
      if (!outDirs.length) return;
      const outDir = outDirs[0].replace(/[\\/]+$/, '');
      let atlasText = '';
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const cv = document.createElement('canvas');
        cv.width = p.width; cv.height = p.height;
        const g = cv.getContext('2d');
        for (const pl of p.placements) g.drawImage(pl.img, pl.ax, pl.ay);
        const pngName = pages.length > 1 ? `atlas_${i + 1}.png` : 'atlas.png';
        const w = await window.api.writeFileBase64(outDir + '/' + pngName, cv.toDataURL('image/png'));
        if (!w || w.ok === false) throw new Error('写页图失败:' + pngName);
        atlasText += `${pngName}\nsize: ${p.width},${p.height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n`;
        for (const pl of p.placements) {
          atlasText += `${pl.name}\n  rotate: false\n  xy: ${pl.ax},${pl.ay}\n  size: ${pl.trimW},${pl.trimH}\n  orig: ${pl.srcW},${pl.srcH}\n  offset: 0,0\n  index: -1\n`;
        }
        atlasText += '\n';
      }
      const tw = await window.api.writeFileBase64(outDir + '/atlas.atlas', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(atlasText))));
      if (!tw || tw.ok === false) throw new Error('写 atlas 文本失败');
      toast(`打包完成:${items.length} 张图 → ${pages.length} 页(${pages.map((p) => p.width + 'x' + p.height).join(' / ')})→ ${outDir}`);
    } catch (err) {
      toast('打包失败:' + err.message, 'err');
    }
  }

  async saveProject() {
    const p = await saveProjectFile(this.project);
    if (p) { recordBoneRecent(p, this.project.name, 'project'); toast('已保存:' + p); }
  }

  async saveProjectAs() {
    const r = await saveProjectFile(this.project);
    if (r) { recordBoneRecent(r, this.project.name, 'project'); toast('已另存为:' + r); }
  }

  async exportDb() {
    if (this.project.spine) { toast('Spine 导入项目请使用「导出 Spine JSON」;DragonBones 导出仅适用自建项目', 'warn'); return; }
    try {
      const r = await exportDragonBonesFiles(this.project);
      if (r) toast(`已导出:${r.files.join(' / ')} → ${r.dir}`);
    } catch (err) {
      toast('导出失败:' + err.message, 'err');
    }
  }

  /** 导出预览:DragonBones 官方运行时实时播放导出数据(格式正确性的活体验证) */
  async previewExport() {
    if (this.project.spine) { toast('Spine 导入项目请使用「导出 Spine JSON」后入库预览', 'warn'); return; }
    try {
      const atlas = await packProjectAtlas(this.project);
      const { ske, tex } = buildDragonBonesExport(this.project, atlas);
      const body = document.createElement('div');
      body.innerHTML = `
        <div class="be-pv-bar">
          <select class="be-pv-anim"></select>
          <button class="btn sm be-pv-replay">↻ 重播</button>
          <span class="be-pv-hint">DragonBones 5.5 官方运行时 · 数据与导出文件一致</span>
        </div>
        <div class="be-pv-canvas-host"></div>`;
      const { close } = openModal({ title: '导出预览(运行时验证)', body, wide: true, foot: footButtons([{ text: '关闭', cls: '', onClick: () => close() }]) });

      const PIXI = await getPixi();
      const db = await loadDbBundle();
      const factory = new db.PixiFactory(null, false);
      if (!factory.parseDragonBonesData(ske)) throw new Error('运行时无法解析导出的骨架数据');
      const texture = PIXI.Texture.from(atlas.canvas);
      factory.parseTextureAtlasData(tex, texture);

      const host = body.querySelector('.be-pv-canvas-host');
      const app = new PIXI.Application();
      await app.init({ background: 0x2a2d36, resizeTo: host, antialias: true });
      host.appendChild(app.canvas);

      const sel = body.querySelector('.be-pv-anim');
      for (const a of ske.armature[0].animation) {
        const op = document.createElement('option');
        op.value = op.textContent = a.name;
        sel.appendChild(op);
      }
      let display = null;
      const play = (name) => {
        if (display) { app.stage.removeChild(display); display.dispose?.(); }
        const armName = ske.armature[0].name;
        display = factory.buildArmatureDisplay(armName, ske.name);
        if (!display) { toast('构建骨架失败', 'err'); return; }
        display.x = app.renderer.screen.width / 2;
        display.y = app.renderer.screen.height / 2 + 40;
        app.stage.addChild(display);
        display.animation.play(name, 0);
      };
      sel.addEventListener('change', () => play(sel.value));
      body.querySelector('.be-pv-replay').addEventListener('click', () => play(sel.value));
      play(sel.value || ske.armature[0].animation[0].name);
      const onResize = setTimeout(() => { if (display) { display.x = app.renderer.screen.width / 2; display.y = app.renderer.screen.height / 2 + 40; } }, 100);
      void onResize;
    } catch (err) {
      toast('预览失败:' + err.message, 'err');
    }
  }

  // ---------------- 键盘(快捷键体系对齐 Spine 3.8 默认配置 hotkeys.txt) ----------------

  _onKey(e) {
    // 仅当编辑器页可见时响应
    if (!this.container?.isConnected || !this.container.querySelector('.be-root')) return;
    if (this.view === 'home') return; // 首页(快速入口)不响应编辑快捷键
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const lower = k.length === 1 ? k.toLowerCase() : k;

    // ---- 编辑基础 ----
    if (ctrl && lower === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && lower === 'y') { e.preventDefault(); this.redo(); return; }
    if (ctrl && lower === 's') { e.preventDefault(); this.saveProject(); return; }
    if (ctrl && lower === 'c') { // 复制选中关键帧
      const key = this.keySel ? this.findKey(this.keySel) : null;
      if (key) {
        this.timeline.clipboard = { channel: this.keySel.channel, v: JSON.parse(JSON.stringify(key.v)), ease: key.ease ? JSON.parse(JSON.stringify(key.ease)) : undefined };
        toast('已复制关键帧');
      }
      return;
    }
    if (ctrl && lower === 'v') {
      if (this.timeline?.clipboard) { e.preventDefault(); this.pasteKey(this.timeline.clipboard); }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (this.keySel) { this.deleteKey(); return; }
      if (this.selection?.type === 'bone') { this.deleteBone(this.selection.name); return; }
      if (this.selection?.type === 'slot') { this.deleteSlot(this.selection.name); return; }
      return;
    }
    if (k === 'F2') { e.preventDefault(); this._renameSelection(); return; }

    // ---- 模式 / 工具(Spine: ctrl+TAB 切模式 / V 选择 / N 创建) ----
    if (ctrl && k === 'Tab') { e.preventDefault(); this.setMode(this.mode === 'setup' ? 'anim' : 'setup'); return; }
    if (k === 'Escape') { this.setTool('select'); return; }

    // ---- 视图 / 显隐(Spine: ctrl+F 适配 / ctrl+B 骨骼 / H·ctrl+H 插槽) ----
    if (ctrl && lower === 'f') { e.preventDefault(); this.stage.fitAll(); this._syncZoomLabel(); return; }
    if (ctrl && lower === 'b') { e.preventDefault(); this.showBones = !this.showBones; this.refresh(); return; }
    if (lower === 'h') { ctrl ? this._showAllSlots() : this._toggleSelectedVisibility(); return; }

    // ---- 动画:自动关键帧 / 循环 / 洋葱皮(Spine: ctrl+shift+A / ctrl+R / I) ----
    if (ctrl && e.shiftKey && lower === 'a') { e.preventDefault(); this.ctx.toggleAutoKey(); return; }
    if (ctrl && lower === 'r') { e.preventDefault(); this.ctx.toggleLoop(); return; }
    if (ctrl || alt) return; // 以下为单键快捷键

    if (lower === 'v') { this.setTool('select'); return; }
    if (lower === 'n' || lower === 'b') { this.setTool('bone'); return; } // N=Spine创建工具;B 兼容旧习惯
    if (lower === 'd') { e.preventDefault(); this.togglePlay(1); return; }   // 播放/暂停(前进)
    if (lower === 'a') { e.preventDefault(); this.togglePlay(-1); return; }  // 播放/暂停(后退)
    if (lower === 'q') { this.setFrame(0); return; }                        // 首帧
    if (lower === 'e') { this.setFrame(this.ctx.anim ? this.ctx.anim.duration : 0); return; } // 末帧
    if (lower === 'r') { this.setFrame(Math.round(this.frame) + (e.shiftKey ? 10 : 1)); return; } // 下一帧
    if (lower === 'f') { this.setFrame(Math.round(this.frame) - (e.shiftKey ? 10 : 1)); return; } // 上一帧
    if (lower === 'w') { this._stepKey(1); return; }   // 下一关键帧
    if (lower === 's') { this._stepKey(-1); return; }  // 上一关键帧
    if (lower === 't') { this._stepAnimation(-1); return; } // 上一个动画
    if (lower === 'y') { this._stepAnimation(1); return; }  // 下一个动画
    if (lower === 'i') { this.ctx.toggleOnion(); return; }  // 洋葱皮(Spine Ghosting)
    if (lower === 'k') { // 为选中对象打关键帧(Spine Key Edited)
      if (this.selection?.type === 'bone') this.insertBoneKeys(this.selection.name);
      else if (this.selection?.type === 'slot') this.insertSlotKeys(this.selection.name);
      return;
    }
    if (k === '/') { this.timeline?.scrollToFrame?.(this.frame); return; } // 摄影表滚动到播放头(Spine Scroll To Selected)
    if (k === ' ') { e.preventDefault(); this.select(null, null); return; } // 取消选择(Spine Deselect)
    if (k === 'Enter') { e.preventDefault(); this.togglePlay(); return; }

    // ---- 方向键:微移选中骨骼(Spine Nudge,shift=×10);未选中时退化为翻帧 ----
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (ctrl) { this._navigateBoneTree(k); return; }  // ctrl+↑↓←→ 父/子/兄弟骨骼
      if (alt) { this._treeCollapseExpand(k); return; } // alt+←→ 折叠/展开层级树
      if (this.selection?.type === 'bone') { this._nudgeBone(k, e.shiftKey); return; }
      if (k === 'ArrowLeft') this.setFrame(Math.round(this.frame) - (e.shiftKey ? 10 : 1));
      else if (k === 'ArrowRight') this.setFrame(Math.round(this.frame) + (e.shiftKey ? 10 : 1));
      return;
    }
  }

  /** 播放/暂停;dir=1 前进 / -1 后退(Spine D/A) */
  togglePlay(dir) {
    if (this.mode !== 'anim') { toast('播放需在动画编辑模式', 'warn'); return; }
    if (dir === undefined) dir = this.playDir || 1;
    if (this.playing && (this.playDir || 1) === dir) { this.playing = false; }
    else { this.playDir = dir; this.playing = true; }
    this.timeline?.refreshHead?.();
  }

  /** 跳到下一个/上一个关键帧(全部轨道取最近) */
  _stepKey(dir) {
    const anim = this.ctx.anim;
    if (!anim) return;
    const cur = Math.round(this.frame);
    let best = null;
    const scan = (store) => {
      for (const ch of Object.values(store || {})) {
        for (const kk of ch) {
          const f = kk.frame;
          if (dir > 0 ? (f > cur && (best === null || f < best)) : (f < cur && (best === null || f > best))) best = f;
        }
      }
    };
    for (const b of Object.values(anim.bones)) scan(b);
    for (const s of Object.values(anim.slots)) scan(s);
    if (best !== null) this.setFrame(best);
  }

  /** 切换到上一个/下一个动画(Spine T/Y) */
  _stepAnimation(dir) {
    const list = this.project.armature.animations;
    if (!list.length) return;
    const i = list.findIndex((a) => a.name === this.animName);
    const ni = Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
    if (ni !== i) this.setAnimation(list[ni].name);
  }

  /** 键盘微移选中骨骼(动画模式走 editBone 自动关键帧) */
  _nudgeBone(k, big) {
    const sel = this.selection;
    if (sel?.type !== 'bone') return;
    const bone = this.project.armature.bones.find((b) => b.name === sel.name);
    if (!bone) return;
    const d = big ? 10 : 1;
    const x = (bone.x || 0) + (k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0);
    const y = (bone.y || 0) + (k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    this.beginEdit('微移骨骼');
    this.editBone(sel.name, { x, y });
    this.refreshPanels?.();
  }

  /** 层级树导航:ctrl+↑父 ↓子 ←前兄弟 →后兄弟(Spine Tree) */
  _navigateBoneTree(k) {
    const bones = this.project.armature.bones;
    if (!bones.length) return;
    const cur = this.selection?.type === 'bone' ? bones.find((b) => b.name === this.selection.name) : bones.find((b) => !b.parent);
    if (!cur) return;
    let target = null;
    if (k === 'ArrowUp') target = cur.parent ? bones.find((b) => b.name === cur.parent) : null;
    else if (k === 'ArrowDown') target = boneChildren(this.project, cur.name)[0] || null;
    else {
      const sibs = cur.parent ? boneChildren(this.project, cur.parent) : bones.filter((b) => !b.parent);
      const i = sibs.findIndex((b) => b.name === cur.name);
      if (k === 'ArrowLeft') target = sibs[i - 1] || null;
      else if (k === 'ArrowRight') target = sibs[i + 1] || null;
    }
    if (target) this.select('bone', target.name);
  }

  /** 层级树折叠/展开选中骨骼:alt+← 折叠 / alt+→ 展开(Spine) */
  _treeCollapseExpand(k) {
    const sel = this.selection;
    if (sel?.type !== 'bone' || !this.panels?.treeCollapsed) return;
    if (k === 'ArrowLeft') this.panels.treeCollapsed.add(sel.name);
    else if (k === 'ArrowRight') this.panels.treeCollapsed.delete(sel.name);
    this.panels.refreshOutline();
  }

  /** 显隐选中插槽(H);ctrl+H 显示全部插槽(Spine Visibility) */
  _toggleSelectedVisibility() {
    const sel = this.selection;
    if (sel?.type !== 'slot') { toast('选中插槽后按 H 切换显隐(ctrl+H 显示全部)', 'info'); return; }
    const s = this.project.armature.slots.find((x) => x.name === sel.name);
    if (!s) return;
    this.beginEdit(s.visible === false ? '显示插槽' : '隐藏插槽');
    s.visible = s.visible === false;
    this.refresh();
  }

  _showAllSlots() {
    if (!this.project.armature.slots.some((s) => s.visible === false)) return;
    this.beginEdit('显示全部插槽');
    for (const s of this.project.armature.slots) s.visible = true;
    this.refresh();
  }

  /** F2 重命名:插槽 → prompt;否则重命名当前动画(Spine Rename) */
  _renameSelection() {
    const sel = this.selection;
    if (sel?.type === 'slot') {
      if (this.project.spine) { toast('Spine 导入项目暂不支持改名插槽', 'warn'); return; }
      promptDialog({
        title: '重命名插槽',
        fields: [{ name: 'name', label: '插槽名', value: sel.name }],
        onOk: (v) => {
          if (v.name && v.name !== sel.name) { this.beginEdit('重命名插槽'); this.renameSlot(sel.name, v.name.trim()); }
        },
      });
    } else {
      this.renameAnimation();
    }
  }
}
