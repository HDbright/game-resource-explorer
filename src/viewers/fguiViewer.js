/**
 * FGUI 包查看器:解析 .bin(FGUI 逆向)后展示
 * - 资源清单(items) + 组件树(displayList)
 * - 点击树节点查看属性
 * - 源码标签页:组件 XML / 包 XML / 包 JSON(可复制)
 */
export class FguiViewerController {
  constructor() {
    this.wrap = null;
    this.pkg = null;
    this.packageXml = '';
    this.componentXmls = [];
    this.currentComp = null;   // 当前选中的组件 item
    this.currentNode = null;   // 当前选中的树节点
    this.statusEl = null;
    this._drag = null;
  }

  init(wrap) {
    this.wrap = wrap;
    this.statusEl = wrap.querySelector('#fgui-status');

    // 组件列表切换
    const compSelect = wrap.querySelector('#fgui-comp-select');
    if (compSelect) compSelect.addEventListener('change', () => this.selectComp(compSelect.value));

    // 树节点点击
    const tree = wrap.querySelector('#fgui-tree');
    if (tree) tree.addEventListener('click', (e) => {
      const li = e.target.closest('.fg-node');
      if (!li) return;
      const idx = Number(li.dataset.idx);
      this.selectNode(this.currentComp ? this.currentComp.children[idx] : null);
    });

    // 源码标签页切换
    const tabs = wrap.querySelectorAll('.fg-src-tab');
    tabs.forEach((t) => t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      this.renderSource(t.dataset.tab);
    }));

    // 复制源码按钮
    const copyBtn = wrap.querySelector('#fgui-copy-src');
    if (copyBtn) copyBtn.addEventListener('click', () => this.copyCurrentSource());

    // 导出当前包
    const exportBtn = wrap.querySelector('#fgui-export-pkg');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportCurrentPkg());

    // 拖拽平移属性面板?不需要,保持简单
  }

  async load(item) {
    const res = await window.api.fguiParse({ inputPath: item.filePath });
    if (!res || !res.ok) throw new Error((res && res.error) || 'FGUI 解析失败');
    this.pkg = res.pkg;
    this.packageXml = res.packageXml;
    this.componentXmls = res.componentXmls || [];
    this.srcDir = res.srcDir || '';
    this.currentComp = null;
    this.currentNode = null;
    this.renderPkgInfo(item);
    this.renderCompList();
    this.renderSource('component');
    if (this.statusEl) this.statusEl.textContent = '';
  }

  // ---------- 顶部包信息 ----------
  renderPkgInfo(item) {
    const el = (id) => this.wrap.querySelector(id);
    if (!this.pkg) return;
    el('#fgui-name').textContent = this.pkg.name || this.pkg.id || '';
    el('#fgui-pkg-id').textContent = this.pkg.id || '';
    el('#fgui-version').textContent = 'v' + this.pkg.version;
    const deps = (this.pkg.deps || []).map((d) => d.name).join(', ') || '—';
    el('#fgui-deps').textContent = deps;
    el('#fgui-items').textContent = (this.pkg.items || []).length + ' 个资源';
    el('#fgui-sprites').textContent = (this.pkg.sprites || []).length + ' 个图集精灵';
  }

  // ---------- 组件列表 ----------
  renderCompList() {
    const sel = this.wrap.querySelector('#fgui-comp-select');
    if (!sel) return;
    sel.innerHTML = '';
    const comps = (this.pkg.items || []).filter((it) => it.type === 'Component');
    if (!comps.length) {
      const op = document.createElement('option');
      op.textContent = '(无组件)';
      sel.appendChild(op);
      return;
    }
    for (const it of comps) {
      const op = document.createElement('option');
      op.value = it.id;
      op.textContent = (it.name || it.id) + (it.objectType && it.objectType !== 'Component' ? ` [${it.objectType}]` : '');
      op.dataset.objType = it.objectType || '';
      sel.appendChild(op);
    }
    sel.selectedIndex = 0;
    this.selectComp(sel.value);
  }

  selectComp(id) {
    const comp = (this.pkg.items || []).find((it) => it.type === 'Component' && it.id === id);
    this.currentComp = comp || null;
    this.currentNode = null;
    this.renderTree();
    this.renderSource('component');
    const badge = this.wrap.querySelector('#fgui-comp-type');
    if (badge) badge.textContent = (comp && comp.objectType) || 'Component';
  }

  // ---------- 组件树 ----------
  renderTree() {
    const tree = this.wrap.querySelector('#fgui-tree');
    if (!tree) return;
    tree.innerHTML = '';
    if (!this.currentComp || !this.currentComp.component) {
      tree.innerHTML = '<div class="hint">(该组件无子对象)</div>';
      return;
    }
    const children = this.currentComp.component.children || [];
    const ul = document.createElement('ul');
    ul.className = 'fg-tree';
    children.forEach((ch, i) => {
      const li = document.createElement('li');
      li.className = 'fg-node';
      li.dataset.idx = i;
      const p = ch.props || {};
      const name = p.name || p.id || '(未命名)';
      const badge = document.createElement('span');
      badge.className = 'fg-node-type';
      badge.textContent = ch.type;
      const txt = document.createElement('span');
      txt.className = 'fg-node-name';
      txt.textContent = name;
      txt.title = `id=${p.id || ''}\nxy=${p.x},${p.y}`;
      li.appendChild(badge);
      li.appendChild(txt);
      if (p.text || ch.titleText) {
        const t = document.createElement('span');
        t.className = 'fg-node-text';
        t.textContent = (p.text || ch.titleText).slice(0, 20);
        t.title = p.text || ch.titleText;
        li.appendChild(t);
      }
      ul.appendChild(li);
    });
    tree.appendChild(ul);
  }

  selectNode(node) {
    this.currentNode = node;
    this.renderProps(node);
  }

  // ---------- 属性面板 ----------
  renderProps(node) {
    const panel = this.wrap.querySelector('#fgui-props');
    if (!panel) return;
    if (!node) {
      panel.innerHTML = '<div class="hint">点击左侧树节点查看属性</div>';
      return;
    }
    const p = node.props || {};
    const rows = [];
    const add = (k, v) => {
      if (v === undefined || v === null) return;
      let s = v;
      if (typeof v === 'object') s = JSON.stringify(v);
      rows.push(`<div class="fg-prop"><span class="fg-prop-k">${esc(k)}</span><span class="fg-prop-v">${esc(s)}</span></div>`);
    };
    add('type', node.type);
    add('id', p.id);
    add('name', p.name);
    add('src', node.src);
    add('pkg', node.pkgId);
    add('x', p.x);
    add('y', p.y);
    add('size', p.initWidth != null ? p.initWidth + ',' + p.initHeight : null);
    add('alpha', p.alpha);
    add('rotation', p.rotation);
    add('visible', p.visible);
    add('text', p.text);
    add('title', p.title);
    add('icon', p.icon);
    add('url', p.url);
    add('fontSize', p.textFormat && p.textFormat.size);
    add('color', p.textFormat && p.textFormat.color);
    add('layout', p.layout);
    add('group', p.groupId);
    add('tooltips', p.tooltips);
    add('data', p.data);
    add('gears', p.gears ? p.gears.length + ' 个' : null);
    add('relations', p.relations ? p.relations.length + ' 条' : null);
    panel.innerHTML = rows.length
      ? rows.join('')
      : '<div class="hint">(该节点无可显示属性)</div>';
  }

  // ---------- 源码标签页 ----------
  currentSourceText(tab) {
    if (tab === 'package') return this.packageXml;
    if (tab === 'json') return this.pkg ? JSON.stringify(this.pkg, null, 2) : '';
    // component: 当前选中组件的 XML
    if (this.currentComp) {
      const c = this.componentXmls.find((x) => x.name === ((this.currentComp.name || this.currentComp.id).replace(/[\\/]/g, '_')));
      if (c) return c.xml;
      // 找不到就用当前选中组件的名字尝试(含路径分支名)
      return this.componentXmls.find((x) => x.name.endsWith('_' + this.currentComp.id))?.xml || '';
    }
    return '';
  }

  renderSource(tab) {
    const pre = this.wrap.querySelector('#fgui-src');
    if (!pre) return;
    const text = this.currentSourceText(tab);
    pre.textContent = text || '(无源码)';
  }

  async copyCurrentSource() {
    const tab = this.wrap.querySelector('.fg-src-tab.active')?.dataset.tab || 'component';
    const text = this.currentSourceText(tab);
    try {
      await navigator.clipboard.writeText(text);
      if (this.statusEl) this.statusEl.textContent = '已复制';
    } catch (e) {
      if (this.statusEl) this.statusEl.textContent = '复制失败';
    }
  }

  // ---------- 导出当前包(复用工具箱的目录选择) ----------
  async exportCurrentPkg() {
    if (!this.pkg) return;
    const r = await window.api.pickFiles({
      title: '选择导出目录(FGUI 逆向输出 JSON + XML)',
      directory: true,
    });
    if (r.canceled || !r.filePaths.length) return;
    const outDir = r.filePaths[0];
    const res = await window.api.fguiBatchExport({
      inputDir: this.srcDir,
      outputDir: outDir,
    });
    if (this.statusEl) {
      this.statusEl.textContent = res && res.ok
        ? `已导出 ${res.total} 个包(${res.failed} 失败)`
        : (res && res.error) || '导出失败';
    }
  }

  dispose() {
    this.wrap = null;
    this.pkg = null;
    this.currentComp = null;
    this.currentNode = null;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
