'use strict';
/**
 * 开发工具箱 - API 管理页(重构):
 * 双标签页:
 *   🗂 项目管理 — 分类树(可嵌套) / 项目 / API 数据字典 三级管理 + 接口测试(主进程代发 HTTP 请求)。
 *   📖 API 文档 — 内嵌 api-doc.html(iframe 隔离, 保留原 API 参考文档)。
 * 数据持久化: state.apiCategories / apiProjects / apiEndpoints(经 db.js 三表 SQLite 存储)。
 */
import {
  state, saveState,
  addApiCategory, updateApiCategory, removeApiCategory, apiCategoryById,
  getApiCategoryChildren,
  addApiProject, updateApiProject, removeApiProject, apiProjectById, apiProjectsInCategory,
  addApiEndpoint, updateApiEndpoint, removeApiEndpoint, apiEndpointById, apiEndpointsInProject,
} from '../state.js';
import { promptDialog, confirmDialog, toast, showContextMenu } from '../dialogs.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
const METHOD_COLOR = {
  GET: '#2fcf6f', POST: '#6d5cff', PUT: '#3aa0ff', DELETE: '#ff5d7e', PATCH: '#ffb86c', HEAD: '#7b87a9',
};

// ---- 模块状态 ----
let tab = 'project';          // 'project' | 'doc'
let selCatId = null;          // 选中分类 id(null=未选, '__uncat__'=未分类虚拟节点)
let selProjId = null;         // 选中项目 id
let selEpId = null;           // 选中接口 id
const expandedCats = new Set(); // 展开的分类 id
let dirty = false;            // 接口表单是否有未保存修改

export function renderApiPage(container, opts = {}) {
  if (container._apmInited) return container;
  container._apmInited = true;
  container.innerHTML = `
    <div class="apm-wrap">
      <div class="apm-tabs">
        <button class="apm-tab active" data-tab="project">🗂 项目管理</button>
        <button class="apm-tab" data-tab="doc">📖 API 文档</button>
      </div>
      <div class="apm-body">
        <div class="apm-project" id="apm-project">
          <div class="apm-left">
            <div class="apm-left-head">
              <span>分类 / 项目</span>
              <button class="btn sm" id="apm-add-cat" title="新建顶级分类">+ 分类</button>
            </div>
            <div class="apm-cat-tree" id="apm-cat-tree"></div>
          </div>
          <div class="apm-main" id="apm-main"></div>
        </div>
        <div class="apm-doc" id="apm-doc" hidden>
          <iframe class="api-doc-frame" src="./api-doc.html" title="API 文档" allow="clipboard-read; clipboard-write"></iframe>
        </div>
      </div>
    </div>
  `;
  bindEvents(container);
  renderAll();
  return container;
}

// ---------------- 渲染 ----------------

function renderAll() {
  renderTabs();
  renderCatTree();
  renderMain();
}

function renderTabs() {
  const wrap = document.querySelector('.apm-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.apm-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const project = wrap.querySelector('#apm-project');
  const doc = wrap.querySelector('#apm-doc');
  if (project) project.hidden = tab !== 'project';
  if (doc) doc.hidden = tab !== 'doc';
}

function catPathOf(catId) {
  const out = [];
  let cur = apiCategoryById(catId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? apiCategoryById(cur.parentId) : null;
  }
  return out;
}

function renderCatTree() {
  const tree = document.getElementById('apm-cat-tree');
  if (!tree) return;
  tree.innerHTML = '';
  // 未分类虚拟节点(存放 categoryId='' 的项目)
  const uncatProjects = apiProjectsInCategory('');
  const uncatNode = document.createElement('div');
  uncatNode.className = 'apm-node' + (selCatId === '__uncat__' ? ' active' : '');
  uncatNode.innerHTML = `<span class="apm-node-icon">🗂</span><span class="apm-node-name">未分类</span><span class="apm-node-count">${uncatProjects.length}</span>`;
  uncatNode.addEventListener('click', () => {
    selCatId = '__uncat__'; selProjId = null; selEpId = null; dirty = false;
    renderCatTree(); renderMain();
  });
  tree.appendChild(uncatNode);

  // 递归分类树(顶层 → 子层)
  const walk = (pid, depth) => {
    for (const cat of getApiCategoryChildren(pid)) {
      const subs = getApiCategoryChildren(cat.id);
      const projs = apiProjectsInCategory(cat.id);
      const isOpen = expandedCats.has(cat.id);
      const node = document.createElement('div');
      node.className = 'apm-cat' + (selCatId === cat.id && !selProjId ? ' active' : '');
      node.style.paddingLeft = (6 + depth * 16) + 'px';
      node.innerHTML = `
        <span class="apm-cat-arrow${subs.length ? '' : ' empty'}">${subs.length ? (isOpen ? '▾' : '▸') : ''}</span>
        <span class="apm-node-icon">📁</span>
        <span class="apm-node-name">${esc(cat.name)}</span>
        <span class="apm-node-count">${projs.length + (subs.length ? `/${subs.length}` : '')}</span>`;
      node.addEventListener('click', (e) => {
        if (e.target.closest('.apm-cat-arrow') && subs.length) {
          if (expandedCats.has(cat.id)) expandedCats.delete(cat.id); else expandedCats.add(cat.id);
          renderCatTree();
          return;
        }
        selCatId = cat.id; selProjId = null; selEpId = null; dirty = false;
        expandedCats.add(cat.id);
        renderCatTree(); renderMain();
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCatMenu(e.clientX, e.clientY, cat);
      });
      tree.appendChild(node);
      // 项目叶子(直接挂在该分类下)
      for (const p of projs) {
        const leaf = document.createElement('div');
        leaf.className = 'apm-node apm-proj-leaf' + (selProjId === p.id ? ' active' : '');
        leaf.style.paddingLeft = (6 + depth * 16 + 18) + 'px';
        leaf.innerHTML = `<span class="apm-node-icon">📄</span><span class="apm-node-name">${esc(p.name)}</span>`;
        leaf.addEventListener('click', () => {
          selProjId = p.id; selCatId = p.categoryId || '__uncat__'; selEpId = null; dirty = false;
          renderCatTree(); renderMain();
        });
        leaf.addEventListener('contextmenu', (e) => {
          e.preventDefault(); e.stopPropagation();
          showProjMenu(e.clientX, e.clientY, p);
        });
        tree.appendChild(leaf);
      }
      if (isOpen) walk(cat.id, depth + 1);
    }
  };
  walk('', 0);
}

function renderMain() {
  const main = document.getElementById('apm-main');
  if (!main) return;
  if (selProjId) {
    renderProjView(main);
  } else if (selCatId !== null) {
    renderCatView(main);
  } else {
    renderOverview(main);
  }
}

/** 总览: 全部统计 + 快速入口 */
function renderOverview(main) {
  const cats = state.apiCategories.length;
  const projs = state.apiProjects.length;
  const eps = state.apiEndpoints.length;
  main.innerHTML = `
    <div class="apm-overview">
      <div class="apm-ov-title">API 项目管理</div>
      <div class="apm-ov-desc">在左侧分类树中建立分类与项目，为项目维护 API 数据字典，并可直接测试接口。</div>
      <div class="apm-ov-cards">
        <div class="apm-ov-card"><b>${cats}</b><span>分类</span></div>
        <div class="apm-ov-card"><b>${projs}</b><span>项目</span></div>
        <div class="apm-ov-card"><b>${eps}</b><span>接口</span></div>
      </div>
      <div class="apm-ov-actions">
        <button class="btn" id="apm-ov-add-cat">+ 新建分类</button>
        <button class="btn" id="apm-ov-add-proj">+ 新建项目</button>
      </div>
    </div>`;
  main.querySelector('#apm-ov-add-cat').addEventListener('click', () => addCategoryDialog(''));
  main.querySelector('#apm-ov-add-proj').addEventListener('click', () => addProjectDialog(null));
}

/** 分类视图: 分类信息 + 项目列表 */
function renderCatView(main) {
  const isUncat = selCatId === '__uncat__';
  const cat = isUncat ? null : apiCategoryById(selCatId);
  const projs = apiProjectsInCategory(isUncat ? '' : selCatId);
  const title = isUncat ? '未分类' : (cat ? cat.name : '');
  main.innerHTML = `
    <div class="apm-cat-view">
      <div class="apm-cat-head">
        <span class="apm-cat-title">${esc(title)}</span>
        <span class="apm-cat-count">${projs.length} 个项目</span>
        <div class="ctrl-spacer"></div>
        <button class="btn sm" id="apm-new-proj">+ 新建项目</button>
        ${isUncat ? '' : `<button class="btn sm" id="apm-cat-add-sub">+ 子分类</button>
        <button class="btn sm" id="apm-cat-edit">✎ 编辑</button>
        <button class="btn sm danger" id="apm-cat-del">删除</button>`}
      </div>
      <div class="apm-proj-cards">
        ${projs.length ? projs.map((p) => `
          <div class="apm-proj-card" data-proj="${p.id}">
            <div class="apm-pc-name">📄 ${esc(p.name)}</div>
            <div class="apm-pc-base">${esc(p.baseUrl || '(未设置 Base URL)')}</div>
            <div class="apm-pc-meta">${apiEndpointsInProject(p.id).length} 个接口${p.remark ? ' · ' + esc(p.remark) : ''}</div>
          </div>`).join('') : `<div class="apm-empty">该分类下暂无项目，点击「+ 新建项目」创建。</div>`}
      </div>
    </div>`;
  main.querySelectorAll('.apm-proj-card').forEach((el) => {
    el.addEventListener('click', () => {
      const pid = el.dataset.proj;
      selProjId = pid; selEpId = null; dirty = false;
      renderCatTree(); renderMain();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = apiProjectById(el.dataset.proj);
      if (p) showProjMenu(e.clientX, e.clientY, p);
    });
  });
  const b = (id) => main.querySelector('#' + id);
  b('apm-new-proj').addEventListener('click', () => addProjectDialog(isUncat ? '' : selCatId));
  if (b('apm-cat-add-sub')) b('apm-cat-add-sub').addEventListener('click', () => addCategoryDialog(selCatId));
  if (b('apm-cat-edit')) b('apm-cat-edit').addEventListener('click', () => editCategoryDialog(selCatId));
  if (b('apm-cat-del')) b('apm-cat-del').addEventListener('click', () => deleteCategoryDialog(selCatId));
}

/** 项目视图: 项目信息 + API 数据字典 + 接口详情/测试 */
function renderProjView(main) {
  const proj = apiProjectById(selProjId);
  if (!proj) { selProjId = null; selEpId = null; renderMain(); return; }
  const eps = apiEndpointsInProject(proj.id);
  const ep = selEpId ? apiEndpointById(selEpId) : null;
  const backCatId = proj.categoryId || '__uncat__';
  main.innerHTML = `
    <div class="apm-proj-view">
      <div class="apm-proj-head">
        <button class="btn sm" id="apm-back">← 返回分类</button>
        <span class="apm-proj-title">${esc(proj.name)}</span>
        <button class="btn sm" id="apm-proj-edit" title="编辑项目信息">✎</button>
        <button class="btn sm danger" id="apm-proj-del" title="删除项目(连同全部接口)">🗑</button>
      </div>
      <div class="apm-proj-base">Base URL: <code>${esc(proj.baseUrl || '(未设置)')}</code>${proj.remark ? ' — ' + esc(proj.remark) : ''}</div>
      <div class="apm-dict-head">
        <span class="apm-dict-title">📚 API 数据字典 <span class="apm-dict-count">${eps.length}</span></span>
        <div class="ctrl-spacer"></div>
        <button class="btn sm" id="apm-new-ep">+ 新建接口</button>
      </div>
      <div class="apm-dict-body">
        <div class="apm-ep-list">
          ${eps.length ? eps.map((e) => `
            <div class="apm-ep-row${ep && ep.id === e.id ? ' active' : ''}" data-ep="${e.id}">
              <span class="apm-method" style="background:${METHOD_COLOR[e.method] || '#7b87a9'}">${esc(e.method)}</span>
              <span class="apm-ep-name">${esc(e.name)}</span>
              <span class="apm-ep-path">${esc(e.path || '')}</span>
            </div>`).join('') : `<div class="apm-empty">该项目暂无接口，点击「+ 新建接口」开始维护数据字典。</div>`}
        </div>
        <div class="apm-ep-detail" id="apm-ep-detail">
          ${ep ? renderEpDetail(ep) : '<div class="apm-hint">选择左侧接口查看 / 编辑详情，或点击「+ 新建接口」。</div>'}
        </div>
      </div>
    </div>`;
  main.querySelector('#apm-back').addEventListener('click', () => {
    selProjId = null; selEpId = null; dirty = false;
    selCatId = backCatId;
    renderCatTree(); renderMain();
  });
  main.querySelector('#apm-proj-edit').addEventListener('click', () => editProjectDialog(proj.id));
  main.querySelector('#apm-proj-del').addEventListener('click', () => deleteProjectDialog(proj.id));
  main.querySelector('#apm-new-ep').addEventListener('click', () => addEndpointDialog(proj.id));
  main.querySelectorAll('.apm-ep-row').forEach((el) => {
    el.addEventListener('click', () => {
      if (dirty && !confirmDiscard()) return;
      selEpId = el.dataset.ep; dirty = false;
      renderMain();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const ep0 = apiEndpointById(el.dataset.ep);
      if (ep0) showEpMenu(e.clientX, e.clientY, ep0);
    });
  });
  if (ep) bindEpDetail(main);
}

/** 接口详情表单(可编辑) + 测试面板 */
function renderEpDetail(ep) {
  const rows = (arr, kind) => (arr || []).map((r, i) => {
    const name = (r.name || '').replace(/"/g, '&quot;');
    const val = String(r.value == null ? '' : r.value).replace(/"/g, '&quot;');
    if (kind === 'param') {
      return `<div class="apm-kv-row" data-kind="param">
        <input class="apm-inp p-name" value="${name}" placeholder="参数名">
        <select class="apm-inp p-type"><option>string</option><option>number</option><option>boolean</option><option>array</option><option>object</option><option>file</option></select>
        <label class="apm-chk"><input type="checkbox" class="p-req" ${r.required ? 'checked' : ''}>必填</label>
        <input class="apm-inp p-desc" value="${esc(r.desc || '')}" placeholder="说明">
        <button class="btn sm apm-del-row" title="删除该行">✕</button>
      </div>`;
    }
    return `<div class="apm-kv-row" data-kind="header">
      <input class="apm-inp h-name" value="${name}" placeholder="名称">
      <input class="apm-inp h-val" value="${val}" placeholder="值">
      <input class="apm-inp h-desc" value="${esc(r.desc || '')}" placeholder="说明">
      <button class="btn sm apm-del-row" title="删除该行">✕</button>
    </div>`;
  }).join('');
  return `
    <div class="apm-ep-form">
      <div class="apm-ep-form-head">
        <input class="apm-inp ep-name" value="${esc(ep.name)}" placeholder="接口名称">
        <select class="apm-inp ep-method">${METHODS.map((m) => `<option ${m === ep.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input class="apm-inp ep-path" value="${esc(ep.path)}" placeholder="路径(如 /v1/users 或完整 URL)" style="flex:1.4">
        <button class="btn sm" id="apm-save-ep" title="保存接口到数据字典">💾 保存</button>
      </div>
      <textarea class="apm-inp ep-desc" rows="2" placeholder="接口说明...">${esc(ep.desc)}</textarea>
      <div class="apm-sec">请求参数 <button class="btn sm apm-add-row" data-kind="param">+ 参数</button></div>
      <div class="apm-kv-list" data-list="params">${rows(ep.params, 'param') || '<div class="apm-empty">暂无参数</div>'}</div>
      <div class="apm-sec">请求头 <button class="btn sm apm-add-row" data-kind="header">+ 请求头</button></div>
      <div class="apm-kv-list" data-list="headers">${rows(ep.headers, 'header') || '<div class="apm-empty">暂无请求头</div>'}</div>
      <div class="apm-sec">请求体(JSON 示例)</div>
      <textarea class="apm-inp ep-body" rows="5" spellcheck="false">${esc(ep.body)}</textarea>
      <div class="apm-sec">响应示例(JSON)</div>
      <textarea class="apm-inp ep-resp" rows="5" spellcheck="false">${esc(ep.response)}</textarea>
    </div>
    <div class="apm-test">
      <div class="apm-test-head">🧪 接口测试</div>
      <div class="apm-test-url">
        <select class="apm-inp t-method">${METHODS.map((m) => `<option ${m === ep.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input class="apm-inp t-url" value="${esc(joinUrl(ep))}" spellcheck="false" placeholder="https://...">
      </div>
      <div class="apm-test-opts">
        <label>超时 <input class="apm-inp t-timeout" type="number" min="1000" max="120000" step="500" value="15000"></label>
        <label>代理 <input class="apm-inp t-proxy" value="${esc((state.settings && state.settings.webGameProxy) || '')}" placeholder="如 http://127.0.0.1:7890(可选)"></label>
      </div>
      <div class="apm-sec">请求头(每行 "名称: 值")</div>
      <textarea class="apm-inp t-headers" rows="3" spellcheck="false">${esc(headersToText(ep.headers))}</textarea>
      <div class="apm-sec">请求体(${ep.method === 'GET' || ep.method === 'HEAD' ? 'GET/HEAD 不发送请求体' : '原样发送'})</div>
      <textarea class="apm-inp t-body" rows="4" spellcheck="false">${esc(ep.body)}</textarea>
      <div class="apm-test-actions">
        <button class="btn" id="apm-send">▶ 发送请求</button>
        <button class="btn sm" id="apm-clear-resp">清空</button>
        <span class="status" id="apm-test-status"></span>
      </div>
      <div class="apm-resp" id="apm-resp" hidden></div>
    </div>`;
}

function joinUrl(ep) {
  const p = apiProjectById(ep.projectId);
  const base = (p && p.baseUrl || '').replace(/[\\/]+$/, '');
  const path = (ep.path || '').replace(/^\/+/, '');
  if (!base) return ep.path || '';
  if (/^https?:\/\//i.test(ep.path)) return ep.path;
  return base + (path ? '/' + path : '');
}

function headersToText(arr) {
  return (arr || []).map((h) => (h.name ? `${h.name}: ${h.value == null ? '' : h.value}` : '')).filter(Boolean).join('\n');
}

function parseHeadersText(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    if (name) out.push({ name, value: line.slice(i + 1).trim() });
  }
  return out;
}

/** 绑定接口详情事件(表单字段 → 草稿; 保存/测试) */
function bindEpDetail(main) {
  const form = main.querySelector('.apm-ep-form');
  if (!form) return;
  const draft = () => {
    const params = [...form.querySelectorAll('.apm-kv-row[data-kind="param"]')].map((r) => ({
      name: r.querySelector('.p-name').value.trim(),
      type: r.querySelector('.p-type').value,
      required: r.querySelector('.p-req').checked,
      desc: r.querySelector('.p-desc').value,
    })).filter((x) => x.name);
    const headers = [...form.querySelectorAll('.apm-kv-row[data-kind="header"]')].map((r) => ({
      name: r.querySelector('.h-name').value.trim(),
      value: r.querySelector('.h-val').value,
      desc: r.querySelector('.h-desc').value,
    })).filter((x) => x.name);
    return {
      name: form.querySelector('.ep-name').value.trim(),
      method: form.querySelector('.ep-method').value,
      path: form.querySelector('.ep-path').value.trim(),
      desc: form.querySelector('.ep-desc').value,
      params,
      headers,
      body: form.querySelector('.ep-body').value,
      response: form.querySelector('.ep-resp').value,
    };
  };
  form.addEventListener('input', () => { dirty = true; });
  form.querySelector('#apm-save-ep').addEventListener('click', () => {
    const d = draft();
    if (!d.name && !d.path) return toast('接口名称或路径至少填一项', 'error');
    updateApiEndpoint(selEpId, d);
    dirty = false;
    renderMain();
    toast('接口已保存');
  });
  form.querySelectorAll('.apm-add-row').forEach((b) => {
    b.addEventListener('click', () => {
      const kind = b.dataset.kind;
      const list = form.querySelector(`.apm-kv-list[data-list="${kind}"]`);
      const row = document.createElement('div');
      row.className = 'apm-kv-row';
      row.dataset.kind = kind;
      if (kind === 'param') {
        row.innerHTML = `<input class="apm-inp p-name" placeholder="参数名"><select class="apm-inp p-type"><option>string</option><option>number</option><option>boolean</option><option>array</option><option>object</option><option>file</option></select><label class="apm-chk"><input type="checkbox" class="p-req">必填</label><input class="apm-inp p-desc" placeholder="说明"><button class="btn sm apm-del-row" title="删除该行">✕</button>`;
      } else {
        row.innerHTML = `<input class="apm-inp h-name" placeholder="名称"><input class="apm-inp h-val" placeholder="值"><input class="apm-inp h-desc" placeholder="说明"><button class="btn sm apm-del-row" title="删除该行">✕</button>`;
      }
      if (list.querySelector('.apm-empty')) list.innerHTML = '';
      list.appendChild(row);
      row.querySelector('.apm-del-row').addEventListener('click', () => { row.remove(); dirty = true; });
      row.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', () => { dirty = true; }));
      dirty = true;
    });
  });
  form.querySelectorAll('.apm-del-row').forEach((b) => {
    b.addEventListener('click', () => { b.closest('.apm-kv-row').remove(); dirty = true; });
  });

  // ---- 测试面板 ----
  const test = main.querySelector('.apm-test');
  if (!test) return;
  // 测试面板 method 切换: 联动 URL 里的 base+path? 无需联动, 直接由用户编辑 URL。
  const setStatus = (msg, type) => {
    const el = test.querySelector('#apm-test-status');
    el.textContent = msg;
    el.style.color = type === 'error' ? '#ff5d7e' : (type === 'ok' ? '#2fcf6f' : '');
  };
  test.querySelector('#apm-send').addEventListener('click', async () => {
    const url = test.querySelector('.t-url').value.trim();
    const method = test.querySelector('.t-method').value;
    const headers = parseHeadersText(test.querySelector('.t-headers').value);
    const body = test.querySelector('.t-body').value;
    const timeout = Number(test.querySelector('.t-timeout').value) || 15000;
    const proxy = test.querySelector('.t-proxy').value.trim();
    if (!url) return toast('请输入要测试的 URL', 'error');
    setStatus('请求中…');
    const sendBtn = test.querySelector('#apm-send');
    sendBtn.disabled = true;
    try {
      const res = await window.api.apiTest({ method, url, headers, body, timeout, proxy });
      renderTestResult(test, res);
      if (!res || !res.ok) setStatus(res && res.error ? '失败: ' + res.error : '请求失败', 'error');
      else setStatus(`完成 (${res.timeMs}ms)`, res.status >= 400 ? 'error' : 'ok');
    } catch (err) {
      setStatus('异常: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  });
  test.querySelector('#apm-clear-resp').addEventListener('click', () => {
    const r = test.querySelector('#apm-resp');
    r.hidden = true; r.innerHTML = '';
    setStatus('');
  });
}

/** 渲染测试结果 */
function renderTestResult(test, res) {
  const box = test.querySelector('#apm-resp');
  if (!res || !res.ok) {
    box.hidden = false;
    box.innerHTML = `<div class="apm-resp-error">${esc((res && res.error) || '请求失败')}</div>`;
    return;
  }
  const hs = Object.entries(res.headers || {}).map(([k, v]) => `${esc(k)}: ${esc(Array.isArray(v) ? v.join(', ') : String(v))}`).join('\n');
  let pretty = res.body;
  try { pretty = JSON.stringify(JSON.parse(res.body), null, 2); } catch (e) { /* 非 JSON 原样展示 */ }
  const statusColor = res.status >= 400 ? '#ff5d7e' : (res.status >= 300 ? '#ffb86c' : '#2fcf6f');
  box.hidden = false;
  box.innerHTML = `
    <div class="apm-resp-meta">
      <span class="apm-resp-status" style="background:${statusColor}">${res.status} ${esc(res.statusText)}</span>
      <span>耗时 <b>${res.timeMs}ms</b></span>
      <span>大小 <b>${res.size}B</b></span>
      ${res.truncated ? '<span class="apm-resp-warn">已截断(>2MB)</span>' : ''}
      ${res.redirected ? `<span>重定向 <b>${res.redirected}</b> 次</span>` : ''}
      <div class="ctrl-spacer"></div>
      <button class="btn sm" id="apm-copy-resp">📋 复制</button>
    </div>
    <details class="apm-resp-headers"><summary>响应头 (${Object.keys(res.headers || {}).length})</summary><pre>${hs || '(无)'}</pre></details>
    <div class="apm-resp-body"><pre>${pretty || '(空响应体)'}</pre></div>`;
  box.querySelector('#apm-copy-resp').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(res.body); toast('已复制'); }
    catch (e) { toast('复制失败', 'error'); }
  });
}

function confirmDiscard() {
  return window.confirm('当前接口有未保存的修改，切换后将丢弃。确定继续?');
}

// ---------------- 对话框 ----------------

function addCategoryDialog(parentId) {
  promptDialog({
    title: '新建分类',
    fields: [{ key: 'name', label: '分类名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!name.trim()) return toast('名称不能为空', 'error');
      const cat = addApiCategory({ name: name.trim(), parentId });
      if (parentId) expandedCats.add(parentId);
      expandedCats.add(cat.id);
      selCatId = cat.id; selProjId = null; selEpId = null;
      renderCatTree(); renderMain();
      toast('分类已创建');
    },
  });
}

function editCategoryDialog(id) {
  const cat = apiCategoryById(id);
  if (!cat) return;
  promptDialog({
    title: '编辑分类',
    fields: [{ key: 'name', label: '分类名称', type: 'text', value: cat.name }],
    onOk: ({ name }) => {
      if (!name.trim()) return toast('名称不能为空', 'error');
      updateApiCategory(id, { name: name.trim() });
      renderCatTree(); renderMain();
      toast('分类已更新');
    },
  });
}

function deleteCategoryDialog(id) {
  const cat = apiCategoryById(id);
  if (!cat) return;
  const subs = getApiCategoryChildren(id);
  const projs = apiProjectsInCategory(id);
  confirmDialog({
    title: `删除分类「${cat.name}」?`,
    message: `子分类 ${subs.length} 个、项目 ${projs.length} 个将被一并处理(子分类提升到被删分类的父级;项目移到「未分类」)。`,
    danger: true,
    onOk: () => {
      removeApiCategory(id);
      if (selCatId === id) selCatId = null;
      selProjId = null; selEpId = null;
      renderCatTree(); renderMain();
      toast('分类已删除');
    },
  });
}

function addProjectDialog(categoryId) {
  promptDialog({
    title: '新建项目',
    fields: [
      { key: 'name', label: '项目名称', type: 'text', value: '' },
      { key: 'baseUrl', label: 'Base URL', type: 'text', value: '' },
    ],
    onOk: ({ name, baseUrl }) => {
      if (!name.trim()) return toast('项目名称不能为空', 'error');
      const p = addApiProject({ categoryId: categoryId || '', name: name.trim(), baseUrl: baseUrl.trim() });
      selProjId = p.id; selEpId = null; dirty = false;
      renderCatTree(); renderMain();
      toast('项目已创建');
    },
  });
}

function editProjectDialog(id) {
  const p = apiProjectById(id);
  if (!p) return;
  promptDialog({
    title: '编辑项目',
    fields: [
      { key: 'name', label: '项目名称', type: 'text', value: p.name },
      { key: 'baseUrl', label: 'Base URL', type: 'text', value: p.baseUrl || '' },
      { key: 'remark', label: '备注', type: 'text', value: p.remark || '' },
    ],
    onOk: ({ name, baseUrl, remark }) => {
      if (!name.trim()) return toast('项目名称不能为空', 'error');
      updateApiProject(id, { name: name.trim(), baseUrl: baseUrl.trim(), remark });
      renderCatTree(); renderMain();
      toast('项目已更新');
    },
  });
}

function deleteProjectDialog(id) {
  const p = apiProjectById(id);
  if (!p) return;
  const n = apiEndpointsInProject(id).length;
  confirmDialog({
    title: `删除项目「${p.name}」?`,
    message: n ? `其下 ${n} 个数据字典接口将一并删除。` : '确定删除该项目?',
    danger: true,
    onOk: () => {
      removeApiProject(id);
      if (selProjId === id) selProjId = null;
      selEpId = null; dirty = false;
      renderCatTree(); renderMain();
      toast('项目已删除');
    },
  });
}

function addEndpointDialog(projectId) {
  promptDialog({
    title: '新建接口',
    fields: [
      { key: 'name', label: '接口名称', type: 'text', value: '' },
      { key: 'method', label: '请求方法', type: 'select', options: METHODS.map((m) => ({ value: m, label: m })), value: 'GET' },
      { key: 'path', label: '路径', type: 'text', value: '' },
    ],
    onOk: ({ name, method, path }) => {
      if (!name.trim() && !path.trim()) return toast('接口名称或路径至少填一项', 'error');
      const ep = addApiEndpoint({ projectId, name: name.trim(), method, path: path.trim() });
      selEpId = ep.id; dirty = false;
      renderMain();
      toast('接口已创建');
    },
  });
}

function deleteEndpointDialog(id) {
  const ep = apiEndpointById(id);
  if (!ep) return;
  confirmDialog({
    title: `删除接口「${ep.name || ep.path}」?`,
    danger: true,
    onOk: () => {
      removeApiEndpoint(id);
      if (selEpId === id) selEpId = null;
      renderMain();
      toast('接口已删除');
    },
  });
}

/** 移动到分类: 收集所有分类作选择 */
function moveProjectDialog(projId) {
  const p = apiProjectById(projId);
  if (!p) return;
  const catOptions = [{ value: '', label: '未分类' }];
  const collect = (pid, depth) => {
    for (const c of getApiCategoryChildren(pid)) {
      catOptions.push({ value: c.id, label: '　'.repeat(depth) + c.name });
      collect(c.id, depth + 1);
    }
  };
  collect('', 0);
  promptDialog({
    title: `移动项目「${p.name}」到分类`,
    fields: [{ key: 'cat', label: '目标分类', type: 'select', options: catOptions, value: p.categoryId || '' }],
    onOk: ({ cat }) => {
      updateApiProject(projId, { categoryId: cat });
      selProjId = projId;
      selCatId = cat || '__uncat__';
      renderCatTree(); renderMain();
      toast('已移动');
    },
  });
}

// ---------------- 右键菜单 ----------------

function showCatMenu(x, y, cat) {
  showContextMenu(x, y, [
    { label: '新建子分类', onClick: () => addCategoryDialog(cat.id) },
    { label: '在此分类新建项目', onClick: () => addProjectDialog(cat.id) },
    { label: '重命名', onClick: () => editCategoryDialog(cat.id) },
    { label: '删除分类', danger: true, onClick: () => deleteCategoryDialog(cat.id) },
  ]);
}

function showProjMenu(x, y, p) {
  showContextMenu(x, y, [
    { label: '打开项目', onClick: () => { selProjId = p.id; selEpId = null; dirty = false; renderCatTree(); renderMain(); } },
    { label: '编辑项目', onClick: () => editProjectDialog(p.id) },
    { label: '移动到分类', onClick: () => moveProjectDialog(p.id) },
    { label: '删除项目', danger: true, onClick: () => deleteProjectDialog(p.id) },
  ]);
}

function showEpMenu(x, y, ep) {
  showContextMenu(x, y, [
    { label: '编辑', onClick: () => { selEpId = ep.id; renderMain(); } },
    { label: '复制路径', onClick: async () => {
      try { await navigator.clipboard.writeText(joinUrl(ep)); toast('已复制'); }
      catch (e) { toast('复制失败', 'error'); }
    } },
    { label: '删除接口', danger: true, onClick: () => deleteEndpointDialog(ep.id) },
  ]);
}

// ---------------- 事件绑定(容器级委托) ----------------

function bindEvents(container) {
  container.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.apm-tab');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      renderTabs();
      return;
    }
    if (e.target.closest('#apm-add-cat')) {
      addCategoryDialog('');
      return;
    }
  });
  // 阻止容器内 iframe 事件冒泡干扰
  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('iframe')) e.stopPropagation();
  });
}
