/**
 * 骨骼动画编辑器页面(复刻 LoongBones / DragonBones 编辑器核心工作流)。
 *
 * 布局:顶部工具栏 / 左侧(资源库·大纲·层级)/ 中央舞台 / 右侧属性 / 底部摄影表时间轴。
 * 页面持有 ctx 控制器(状态 + 全部编辑意图),stage/panels/timeline 组件通过 ctx 驱动。
 */

import { toast, confirmDialog, promptDialog, openModal, footButtons } from '../dialogs.js';
import { getPixi } from '../pixiLazy.js';
import {
  createProject, createBlankProject, createBone, createSlot, createDisplay, uniqueName, findAnim,
  bonesInTreeOrder, serialize, deserialize,
} from '../editor/model.js';
import { sampleAnimation, computeWorldTransforms, worldToParentLocal } from '../editor/animator.js';
import { EditorStage } from '../editor/stage.js';
import { EditorPanels } from '../editor/panels.js';
import { EditorTimeline } from '../editor/timeline.js';
import { loadDbBundle } from '../preview/dbPlayer.js';
import { packProjectAtlas, buildDragonBonesExport, saveProjectFile, openProjectFile, exportDragonBonesFiles } from '../editor/exporter.js';
import { importSpineProject, exportSpineFiles, parseAtlasText } from '../editor/spineIO.js';
import { loongDocToDbSke, importDragonBonesProject } from '../editor/dbIO.js';

const DRAFT_KEY = 'boneEditorDraft';
let _active = null; // 当前活动实例(离开页面时销毁)

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
    // 默认空白等待态:不自动恢复上次草稿,由用户选择 打开 / 新建 / 导入
    this.project = createBlankProject();

    // ---- ctx 状态 ----
    this.mode = 'setup';
    this.tool = 'select';
    this.frame = 0;
    this.playing = false;
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
          <div class="be-left">
            <div class="be-tabs">
              <button class="be-tab active" data-tab="lib">资源库</button>
              <button class="be-tab" data-tab="outline">大纲</button>
              <button class="be-tab" data-tab="zorder">层级</button>
            </div>
            <div class="be-tab-body" data-body="lib"></div>
            <div class="be-tab-body" data-body="outline" hidden></div>
            <div class="be-tab-body" data-body="zorder" hidden></div>
          </div>
          <div class="be-center">
            <div class="be-stage-host"></div>
            <div class="be-stage-info"></div>
            <div class="be-stage-viewctl">
              <button data-act="zo" title="缩小视图">−</button>
              <span class="be-zoom-label">100%</span>
              <button data-act="zi" title="放大视图">＋</button>
              <button data-act="fit" title="适配全部内容 (F)">⤢</button>
            </div>
            <div class="be-stage-empty" hidden>
              <div class="be-stage-empty-title">空白工程</div>
              <div class="be-stage-empty-line">「📂 打开」 .lbone.json 工程</div>
              <div class="be-stage-empty-line">「✚ 新建」 搭建新骨架</div>
              <div class="be-stage-empty-line">「🦂 导入 Spine JSON」 导入 Spine 骨架(自动配图集)</div>
              <div class="be-stage-empty-line">或直接从资源库拖图片 / 按 B 键拖拽创建第一根骨骼</div>
              <button class="btn sm be-restore-draft" hidden>↩ 恢复上次编辑</button>
            </div>
          </div>
          <div class="be-right"><div class="be-props"></div></div>
        </div>
        <div class="be-timeline-host"></div>
        <div class="be-tl-resize" title="拖拽调整时间轴高度"></div>
      </div>`;
    this.toolbarEl = c.querySelector('.be-toolbar');
    this.stageHost = c.querySelector('.be-stage-host');
    this.propsHost = c.querySelector('.be-props');
    this.timelineHost = c.querySelector('.be-timeline-host');
    this.rootEl = c.querySelector('.be-root');
    // 时间轴高度持久化 + 拖拽调高
    const savedH = parseFloat(localStorage.getItem('beTlHeight'));
    if (savedH >= 120) this.timelineHost.style.height = savedH + 'px';
    const rz = c.querySelector('.be-tl-resize');
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = this.timelineHost.getBoundingClientRect().height;
      const maxH = Math.max(200, window.innerHeight * 0.72);
      const mv = (ev) => {
        const h = Math.min(maxH, Math.max(120, startH + (startY - ev.clientY)));
        this.timelineHost.style.height = h + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        try { localStorage.setItem('beTlHeight', String(this.timelineHost.getBoundingClientRect().height)); } catch (err) { /* ignore */ }
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

    // 模式
    this.btnModeSetup = mkBtn('骨架编辑', '编辑绑定姿势(骨架搭建)', () => this.setMode('setup'));
    this.btnModeAnim = mkBtn('动画编辑', '编辑关键帧动画', () => this.setMode('anim'));
    sep();
    // 工具
    this.btnToolSel = mkBtn('⬈ 选择', '选择/移动工具 (V)', () => this.setTool('select'));
    this.btnToolBone = mkBtn('🦴 创建骨骼', '拖拽创建骨骼:按住从起点拖到终点 (B)', () => this.setTool('bone'));
    sep();
    this.btnUndo = mkBtn('↩ 撤销', '撤销 (Ctrl+Z)', () => this.undo());
    this.btnRedo = mkBtn('↪ 重做', '重做 (Ctrl+Y)', () => this.redo());
    sep();
    this.btnBones = mkBtn('🦴 骨骼', '显示/隐藏骨骼辅助线', () => { this.showBones = !this.showBones; this.refresh(); });
    this.btnGrid = mkBtn('▦ 网格', '显示/隐藏网格', () => { this.showGrid = !this.showGrid; this.refresh(); });
    mkBtn('⤢ 适配', '缩放适配全部内容 (F)', () => this.stage.fitAll());
    this.btnOnion = mkBtn('◌ 洋葱皮', '显示前后帧残影', () => { this.onion = !this.onion; this.refresh(); });

    const sp = document.createElement('span');
    sp.className = 'spacer';
    tb.appendChild(sp);

    mkBtn('✚ 新建', '新建工程(带根骨骼,可直接搭建骨架)', () => this.newProject());
    mkBtn('📂 打开', '打开工程文件 (.lbone.json)', () => this.openProject());
    mkBtn('💾 保存工程', '保存工程 (Ctrl+S)', () => this.saveProject());
    mkBtn('✖ 关闭', '关闭当前工程,回到空白等待态(未保存的修改将丢失)', () => this.closeProject());
    mkBtn('🖼 导入图片', '导入图片到资源库', () => this.panels.importImages());
    this.btnSpineImport = mkBtn('🦂 导入 Spine JSON', '导入 Spine 骨架 JSON(3.8/4.x,含 Pro 网格/IK/约束;自动找同目录 .atlas 与页图)', () => this.importSpine());
    this.btnDbImport = mkBtn('🐲 导入 DragonBones/LoongBones', '导入 DragonBones 5.5 骨架 JSON(自动找同目录 _tex.json 与页图)或 LoongBones 工程文档(需同目录 texture.json/png);导入后骨骼动画完全可编辑', () => this.importDbOrLoong());
    this.btnSpineExport = mkBtn('🦂 导出 Spine JSON', '导出编辑后的 Spine JSON + atlas + 页图(_edit 后缀防覆盖)', () => this.exportSpine());
    mkBtn('📦 导出 DragonBones', '导出 <名>_ske.json / _tex.json / .png(可直接入库预览)', () => this.exportDb());
    mkBtn('▶ 导出预览', '用 DragonBones 官方运行时实时预览导出数据', () => this.previewExport(), 'primary');
    this._syncToolbar();
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
    if (this.btnSpineExport) this.btnSpineExport.hidden = !this.project.spine;
  }

  /** Spine 工程守卫:结构增删会破坏原引用,仅允许变换/动画/颜色编辑 */
  _spineGuard() {
    if (this.project.spine) { toast('Spine 导入工程暂不支持增删/改名骨骼与插槽(会破坏原始引用);可编辑变换、关键帧、颜色与显示切换', 'warn'); return true; }
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
      this.beginEdit('导入 Spine 工程');
      this.project = p;
      this.animName = (p.armature.animations[0] || {}).name || null;
      this.selection = null;
      this.keySel = null;
      this.frame = 0;
      this.mode = 'setup';
      this.refresh();
      this.stage.fitAll();
      toast(`已导入 Spine ${p.spine.version}:${p.armature.bones.length} 骨骼 / ${p.armature.slots.length} 插槽 / ${p.armature.animations.length} 动画 / 皮肤「${p.spine.skin}」`);
    } catch (err) {
      toast('导入失败:' + err.message, 'err');
    }
  }

  /** 导入 DragonBones 骨架 JSON 或 LoongBones 工程文档(Loong 先进程内转 DB 5.5) */
  async importDbOrLoong() {
    try {
      const r = await window.api.pickFiles({
        title: '选择 DragonBones 骨架 JSON 或 LoongBones 工程文档',
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
        throw new Error('无法识别的 JSON:既不是 DragonBones 骨架也不是 LoongBones 工程文档');
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

  async exportSpine() {
    try {
      const r = await exportSpineFiles(this.project);
      if (r) toast(`已导出:${r.files.join(' / ')} → ${r.dir}`);
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
    const hint = this.container.querySelector('.be-stage-empty');
    if (hint) {
      hint.hidden = !this.isBlank;
      const rb = hint.querySelector('.be-restore-draft');
      if (rb) {
        const d = this._loadDraft();
        const restorable = !!(d && (d.armature.bones.length || d.armature.slots.length || d.spine));
        rb.hidden = !this.isBlank || !restorable;
      }
    }
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveDraftNow(), 900);
  }

  refreshPanels() {
    this.panels?.refreshProps?.();
    this.timeline?.refresh?.();
    this.stage?.render();
  }

  _saveDraftNow() {
    // 空白等待态不写草稿:避免覆盖「恢复上次编辑」可用的草稿(关闭工程时显式清除)
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
    if (props.x !== undefined || props.y !== undefined) {
      this._upsertKey(anim, name, 'translate', f, { x: props.x ?? (ov.x ?? bone.x), y: props.y ?? (ov.y ?? bone.y) });
    }
    if (props.rotation !== undefined) this._upsertKey(anim, name, 'rotate', f, { rotation: props.rotation });
    if (props.scaleX !== undefined || props.scaleY !== undefined) {
      this._upsertKey(anim, name, 'scale', f, { scaleX: props.scaleX ?? (ov.scaleX ?? bone.scaleX), scaleY: props.scaleY ?? (ov.scaleY ?? bone.scaleY) });
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
    if (this.mode === 'anim' && anim) {
      const ov = sampleAnimation(anim, this.frame).bones[name] || {};
      return {
        translate: { x: ov.x ?? bone.x, y: ov.y ?? bone.y },
        rotate: { rotation: ov.rotation ?? bone.rotation },
        scale: { scaleX: ov.scaleX ?? bone.scaleX, scaleY: ov.scaleY ?? bone.scaleY },
      };
    }
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

  togglePlay() {
    if (this.mode !== 'anim') { toast('播放需在动画编辑模式', 'warn'); return; }
    this.playing = !this.playing;
    this.timeline?.refreshHead?.();
  }

  // ---------------- 播放循环 ----------------

  _tick(t) {
    this._raf = requestAnimationFrame(this._loop);
    if (!this.playing) return;
    const dt = this._lastT ? Math.min(0.05, (t - this._lastT) / 1000) : 0.016;
    this._lastT = t;
    const dur = this.ctx.anim ? this.ctx.anim.duration : 0;
    let f = this.frame + dt * (this.project.frameRate || 30);
    if (f >= dur) {
      if (this.loop) f = f % Math.max(1, dur);
      else { f = dur; this.playing = false; this.timeline?.refreshHead?.(); }
    }
    this.frame = f;
    this.stage?.render();
    this.timeline?.updatePlayhead();
    if (!this.playing) this._lastT = 0;
    if (this.playing) this._lastT = t;
  }

  // ---------------- 工程 ----------------

  /** 是否空白等待态(无骨骼无贴图) */
  get isBlank() {
    return !this.project.armature.bones.length && !this.project.images.length && !this.project.spine;
  }

  /** 关闭当前工程:回到空白等待态 */
  closeProject() {
    if (this.isBlank) { toast('当前已是空白状态'); return; }
    confirmDialog({
      title: '关闭工程', message: `确定关闭「${this.project.name}」?未保存的修改将丢失。`, danger: true,
      onOk: () => {
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
        toast('已关闭,等待 打开 / 新建 / 导入');
      },
    });
  }

  newProject() {
    confirmDialog({
      title: '新建工程', message: '当前未保存的修改将丢失(自动草稿会被覆盖)。确定新建?', danger: true,
      onOk: () => {
        this.beginEdit('新建工程');
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

  async openProject() {
    try {
      const p = await openProjectFile();
      if (!p) return;
      this.beginEdit('打开工程');
      this.project = p;
      this.animName = (this.project.armature.animations[0] || {}).name || null;
      this.selection = null;
      this.keySel = null;
      this.frame = 0;
      this.mode = 'setup';
      this.refresh();
      this.stage.fitAll();
      toast('工程已打开');
    } catch (err) {
      toast('打开失败:' + err.message, 'err');
    }
  }

  async saveProject() {
    const p = await saveProjectFile(this.project);
    if (p) toast('已保存:' + p);
  }

  async exportDb() {
    if (this.project.spine) { toast('Spine 导入工程请使用「导出 Spine JSON」;DragonBones 导出仅适用自建工程', 'warn'); return; }
    try {
      const r = await exportDragonBonesFiles(this.project);
      if (r) toast(`已导出:${r.files.join(' / ')} → ${r.dir}`);
    } catch (err) {
      toast('导出失败:' + err.message, 'err');
    }
  }

  /** 导出预览:DragonBones 官方运行时实时播放导出数据(格式正确性的活体验证) */
  async previewExport() {
    if (this.project.spine) { toast('Spine 导入工程请使用「导出 Spine JSON」后入库预览', 'warn'); return; }
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

  // ---------------- 快捷键 ----------------

  _onKey(e) {
    // 仅当编辑器页可见时响应
    if (!this.container?.isConnected || !this.container.querySelector('.be-root')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); this.redo(); return; }
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); this.saveProject(); return; }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (this.keySel) { this.deleteKey(); return; }
      if (this.selection?.type === 'bone') { this.deleteBone(this.selection.name); return; }
      if (this.selection?.type === 'slot') { this.deleteSlot(this.selection.name); return; }
      return;
    }
    if (k === 'v' || k === 'V') this.setTool('select');
    else if (k === 'b' || k === 'B') this.setTool('bone');
    else if (k === 'Escape') this.setTool('select');
    else if (k === 'k' || k === 'K') {
      if (this.selection?.type === 'bone') this.insertBoneKeys(this.selection.name);
      else if (this.selection?.type === 'slot') this.insertSlotKeys(this.selection.name);
    } else if (k === 'f' || k === 'F') this.stage.fitAll();
    else if (k === 'Enter') { e.preventDefault(); this.togglePlay(); }
    else if (k === ' ') { e.preventDefault(); this.togglePlay(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); this.setFrame(Math.round(this.frame) - (e.shiftKey ? 10 : 1)); }
    else if (k === 'ArrowRight') { e.preventDefault(); this.setFrame(Math.round(this.frame) + (e.shiftKey ? 10 : 1)); }
  }
}
