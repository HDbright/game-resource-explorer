// ============ 项目管理中心(补丁·113) ============
// 三种视图:管理中心主页(汇总) / 项目详情页(综述+运行状况+部署+服务启停) / 项目资源文档(目录树+条目)。
// 数据源:state.projects(项目配置)+ state.projectEntries(文档条目)+ menuNodes(项目节点/子目录)。
// 服务启停走主进程 projectRunner:window.api.projectStart/Stop/Status。
// 导航:通过 ctx.actions 回调(renderProjectsPage 内)或 projects:navigate 自定义事件(侧栏右键菜单等)驱动。

import {
  getProjects, projectById, updateProject, removeProject, addProject,
  addProjectEntry, updateProjectEntry, removeProjectEntry, getProjectEntries, getProjectAllEntries, projectEntryById,
  getProjectFolders, getProjectSubFolders, addProjectFolder, renameProjectFolder, removeProjectFolder,
  projectMenuNode, menuNodeById, projectNodeIcon,
} from '../state.js';
import { openModal, footButtons, confirmDialog, promptDialog, toast } from '../dialogs.js';

// 实时运行状态缓存(不落库):projectId -> {all, frontend, backend, procs}
const liveStatus = {};
// 最近一次启停操作错误:projectId -> string(展示为「异常」状态)
const lastOpError = {};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDateTime(sec) {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusMeta(status) {
  if (status === 'running') return { text: '运行中', cls: 'running', dot: '🟢' };
  if (status === 'error') return { text: '异常', cls: 'error', dot: '🔴' };
  return { text: '已停止', cls: 'stopped', dot: '⚪' };
}

/** 项目整体状态:优先异常 → 运行中 → 已停止 */
function overallStatus(p) {
  if (lastOpError[p.id]) return 'error';
  const ls = liveStatus[p.id];
  if (ls && (ls.all || ls.frontend || ls.backend)) return 'running';
  return p.status === 'running' || p.status === 'error' ? p.status : 'stopped';
}

/** 探测一组项目的实时状态并(在状态变化时)回写持久化 status */
async function probeProjects(ids) {
  const projects = getProjects().filter((p) => !ids || ids.includes(p.id));
  const specs = projects.map((p) => ({
    projectId: p.id,
    accessUrl: p.accessUrl,
    frontendUrl: p.frontendUrl,
    backendUrl: p.backendUrl,
  }));
  if (!specs.length) return;
  let res = {};
  try {
    res = (await window.api.projectStatus(specs)) || {};
  } catch (e) {
    console.error('[projects] 状态探测失败:', e);
    return;
  }
  for (const p of projects) {
    const st = res[p.id];
    if (!st) continue;
    liveStatus[p.id] = st;
    const next = overallStatus(p);
    if (p.status !== next) updateProject(p.id, { status: next });
  }
}

// ---------------- 服务启停 ----------------

/** 执行一次服务操作(启动/停止),返回结果对象 */
async function runServiceOp(p, kind, op) {
  const key = p.id;
  try {
    if (op === 'start') {
      if (kind === 'all') {
        const cmd = (p.launchMethod || '').trim();
        if (!cmd) return { ok: false, error: '未配置「启动方法」' };
        return await window.api.projectStart({ projectId: p.id, kind: 'all', cmd, cwd: p.rootPath });
      }
      const cmd = kind === 'frontend' ? (p.frontendCmd || '').trim() : (p.backendCmd || '').trim();
      if (!cmd) return { ok: false, error: kind === 'frontend' ? '未配置「前端服务命令」' : '未配置「后端服务命令」' };
      return await window.api.projectStart({ projectId: p.id, kind, cmd, cwd: p.rootPath });
    }
    return await window.api.projectStop({ projectId: p.id, kind });
  } finally {
    delete lastOpError[key];
  }
}

/** 启停按钮通用处理器:进行中反馈 → IPC → toast 结果 → 刷新状态 */
async function handleServiceOp(p, kind, op, btn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 进行中…';
  try {
    const r = await runServiceOp(p, kind, op);
    if (r && r.ok) {
      if (op === 'start') {
        toast(`已启动${kind === 'all' ? '全部服务' : kind === 'frontend' ? '前端服务' : '后端服务'}`, 'ok');
        // 稍等片刻让进程真正起来,再探测状态
        await probeProjects([p.id]);
      } else {
        toast('已停止', 'ok');
        liveStatus[p.id] = { all: false, frontend: false, backend: false, procs: {} };
        updateProject(p.id, { status: 'stopped' });
      }
    } else {
      const msg = (r && r.error) || '操作失败';
      lastOpError[p.id] = msg;
      updateProject(p.id, { status: 'error' });
      toast(msg, 'error');
    }
  } catch (e) {
    lastOpError[p.id] = e.message;
    updateProject(p.id, { status: 'error' });
    toast('操作失败:' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/** 重启服务:先停止对应服务,短暂等待进程退出后重新启动 */
async function handleRestartOp(p, kind, btn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 重启中…';
  try {
    const stopRes = await window.api.projectStop({ projectId: p.id, kind });
    if (stopRes && stopRes.error) {
      const msg = '停止失败:' + stopRes.error;
      lastOpError[p.id] = msg;
      updateProject(p.id, { status: 'error' });
      toast(msg, 'error');
      return;
    }
    await new Promise((r) => setTimeout(r, 500)); // 等待进程树退出
    const cmd = kind === 'all'
      ? (p.launchMethod || '').trim()
      : (kind === 'frontend' ? (p.frontendCmd || '').trim() : (p.backendCmd || '').trim());
    if (!cmd) {
      const msg = kind === 'all' ? '未配置「启动方法」' : kind === 'frontend' ? '未配置「前端服务命令」' : '未配置「后端服务命令」';
      lastOpError[p.id] = msg;
      updateProject(p.id, { status: 'error' });
      toast(msg, 'error');
      return;
    }
    const r = await window.api.projectStart({ projectId: p.id, kind, cmd, cwd: p.rootPath });
    if (r && r.ok) {
      delete lastOpError[p.id];
      toast(`已重启${kind === 'all' ? '全部服务' : kind === 'frontend' ? '前端服务' : '后端服务'}`, 'ok');
      await probeProjects([p.id]);
    } else {
      const msg = (r && r.error) || '重启失败';
      lastOpError[p.id] = msg;
      updateProject(p.id, { status: 'error' });
      toast(msg, 'error');
    }
  } catch (e) {
    lastOpError[p.id] = e.message;
    updateProject(p.id, { status: 'error' });
    toast('重启失败:' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function openExternalUrl(url) {
  if (!url) return;
  const u = String(url).trim();
  if (!u) return;
  if (/^https?:\/\//i.test(u)) window.api.openExternal(u);
  else window.api.openPath(u);
}

// ---------------- 主页(汇总视图) ----------------

function renderHome(container, actions) {
  const projects = getProjects();
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'proj-home';

  const head = document.createElement('div');
  head.className = 'proj-home-head';
  const title = document.createElement('h2');
  title.className = 'proj-home-title';
  title.textContent = '🗂 项目管理中心';
  head.appendChild(title);
  const sub = document.createElement('div');
  sub.className = 'proj-home-sub';
  const running = projects.filter((p) => overallStatus(p) === 'running').length;
  const error = projects.filter((p) => overallStatus(p) === 'error').length;
  sub.innerHTML = `共 <b>${projects.length}</b> 个项目 · 运行中 <b class="c-running">${running}</b> · 异常 <b class="c-error">${error}</b> · 已停止 <b>${projects.length - running - error}</b>`;
  head.appendChild(sub);
  const addBtn = document.createElement('button');
  addBtn.className = 'btn primary';
  addBtn.textContent = '＋ 新增项目';
  addBtn.addEventListener('click', () => newProjectDialog());
  head.appendChild(addBtn);
  wrap.appendChild(head);

  // 状态探测(后台刷新卡片状态)
  probeProjects(projects.map((p) => p.id)).then(() => {
    // 状态有变化 → 重绘(避免状态卡片显示过期)
    if (container._lastProbe !== JSON.stringify(projects.map((p) => overallStatus(p)))) {
      container._lastProbe = JSON.stringify(projects.map((p) => overallStatus(p)));
      renderHome(container, actions);
    }
  }).catch(() => {});

  if (!projects.length) {
    const hint = document.createElement('div');
    hint.className = 'hint proj-empty';
    hint.innerHTML = '暂无管理项目。点击右上角「＋ 新增项目」创建第一个项目,系统将自动在左侧「项目管理中心」根下生成项目节点。';
    wrap.appendChild(hint);
    container.appendChild(wrap);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'proj-grid';
  for (const p of projects) {
    const st = overallStatus(p);
    const meta = statusMeta(st);
    const card = document.createElement('div');
    card.className = 'proj-card';
    card.innerHTML = `
      <div class="proj-card-head">
        <span class="proj-card-icon">${projectNodeIcon()}</span>
        <span class="proj-card-name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="proj-status proj-status-${meta.cls}" title="${st === 'error' ? esc((lastOpError[p.id] || '') + (p.description ? '' : '')) : meta.text}">${meta.dot} ${meta.text}</span>
      </div>
      <div class="proj-card-desc">${esc(p.description || '暂无描述')}</div>
      <div class="proj-card-meta">
        <span class="proj-meta-item" title="最近更新时间">🕒 ${fmtDateTime(p.updatedAt)}</span>
        ${p.accessUrl ? `<span class="proj-meta-item" title="访问地址">🔗 ${esc(p.accessUrl)}</span>` : ''}
      </div>
      <div class="proj-card-actions">
        <button class="btn sm primary" data-act="open">进入详情</button>
        <button class="btn sm" data-act="remark" title="编辑备注">📝 备注</button>
        <button class="btn sm" data-act="edit" title="编辑项目配置">✏️ 编辑</button>
        <button class="btn sm danger" data-act="del" title="删除项目">🗑 删除</button>
      </div>`;
    const btns = card.querySelector('.proj-card-actions');
    btns.querySelector('[data-act="open"]').addEventListener('click', () => actions.onOpenProject(p.id));
    btns.querySelector('[data-act="remark"]').addEventListener('click', () => editRemarkDialog(p.id));
    btns.querySelector('[data-act="edit"]').addEventListener('click', () => editProjectDialog(p.id));
    btns.querySelector('[data-act="del"]').addEventListener('click', () => deleteProjectDialog(p.id));
    card.addEventListener('dblclick', () => actions.onOpenProject(p.id));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
  container.appendChild(wrap);
}

// ---------------- 项目详情页 ----------------

function renderDetail(container, ctx) {
  const { projectId, folderId, docTab, actions } = ctx;
  const p = projectById(projectId);
  container.innerHTML = '';
  if (!p) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '项目不存在或已删除';
    container.appendChild(hint);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'proj-detail';

  // 顶栏:返回 + 标题 + 状态 + 操作按钮
  const head = document.createElement('div');
  head.className = 'proj-detail-head';
  const backBtn = document.createElement('button');
  backBtn.className = 'btn sm';
  backBtn.textContent = '← 返回管理中心';
  backBtn.addEventListener('click', () => actions.onHome());
  head.appendChild(backBtn);
  const title = document.createElement('h2');
  title.className = 'proj-detail-title';
  title.textContent = p.name;
  head.appendChild(title);
  const st = overallStatus(p);
  const meta = statusMeta(st);
  const stBadge = document.createElement('span');
  stBadge.className = `proj-status proj-status-${meta.cls} st-badge`;
  stBadge.textContent = `${meta.dot} ${meta.text}`;
  if (st === 'error' && lastOpError[p.id]) stBadge.title = lastOpError[p.id];
  head.appendChild(stBadge);
  head.appendChild(document.createElement('span')).className = 'ctrl-spacer';
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn sm';
  refreshBtn.textContent = '⟳ 刷新状态';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳ 探测中…';
    await probeProjects([p.id]);
    refreshBtn.disabled = false;
    refreshBtn.textContent = '⟳ 刷新状态';
    actions.onRefresh();
  });
  head.appendChild(refreshBtn);
  const editBtn = document.createElement('button');
  editBtn.className = 'btn sm primary';
  editBtn.textContent = '✏️ 编辑项目';
  editBtn.addEventListener('click', () => editProjectDialog(p.id));
  head.appendChild(editBtn);
  const delBtn = document.createElement('button');
  delBtn.className = 'btn sm danger';
  delBtn.textContent = '🗑 删除';
  delBtn.addEventListener('click', () => deleteProjectDialog(p.id));
  head.appendChild(delBtn);
  wrap.appendChild(head);

  // 子页签:综述详情 / 资源文档
  const tabs = document.createElement('div');
  tabs.className = 'proj-tabs';
  const mkTab = (key, label) => {
    const b = document.createElement('button');
    b.className = 'proj-tab' + ((docTab || 'overview') === key ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      actions.setDocTab(key);
    });
    return b;
  };
  tabs.appendChild(mkTab('overview', '📋 综述详情'));
  tabs.appendChild(mkTab('docs', '📁 资源文档'));
  wrap.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'proj-detail-body';
  if ((docTab || 'overview') === 'docs') renderDocsTab(body, p, folderId, actions);
  else renderOverviewTab(body, p, actions);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

/** 综述详情页签:运行状况 + 部署信息 + 服务配置 */
function renderOverviewTab(body, p, actions) {
  // ---- 运行状况 ----
  const runCard = document.createElement('div');
  runCard.className = 'proj-card proj-card-block';
  runCard.innerHTML = `<h3 class="proj-block-title">⚡ 运行状况</h3>`;
  const ls = liveStatus[p.id] || {};
  const refresh = () => { if (actions && actions.onRefresh) actions.onRefresh(); };
  const mkOpBtn = (label, kind, op, cls, title) => {
    const b = document.createElement('button');
    b.className = 'btn sm ' + (cls || '');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', () => {
      if (op === 'restart') handleRestartOp(p, kind, b).then(refresh);
      else handleServiceOp(p, kind, op, b).then(refresh);
    });
    return b;
  };
  // 运行状态行:名称 + 状态 + (弹性留白) + 行内操作按钮(启动/停止/重启)
  const runRow = (label, state, url, buttons) => {
    const r = document.createElement('div');
    r.className = 'proj-run-row';
    const nm = document.createElement('span');
    nm.className = 'proj-run-name';
    nm.textContent = label;
    const stt = document.createElement('span');
    stt.className = 'proj-run-state ' + (state ? 'on' : 'off');
    stt.textContent = state ? '● 运行中' : '○ 未运行';
    if (url) stt.title = url;
    const spacer = document.createElement('span');
    spacer.className = 'proj-run-spacer';
    const btns = document.createElement('span');
    btns.className = 'proj-run-btns';
    for (const btn of buttons) btns.appendChild(btn);
    r.appendChild(nm);
    r.appendChild(stt);
    r.appendChild(spacer);
    r.appendChild(btns);
    return r;
  };
  // 一键启动(全部服务)行
  runCard.appendChild(runRow('一键启动(全部服务)', ls.all, p.accessUrl, [
    mkOpBtn('▶ 一键启动', 'all', 'start', 'primary', '按「启动方法」执行一键启动'),
    mkOpBtn('■ 全部停止', 'all', 'stop', '', '停止全部服务进程'),
    mkOpBtn('↻ 重启', 'all', 'restart', '', '停止后重新一键启动'),
  ]));
  // 前端服务行
  runCard.appendChild(runRow('前端服务', ls.frontend, p.frontendUrl, [
    mkOpBtn('▶ 启动', 'frontend', 'start', '', '启动前端服务'),
    mkOpBtn('■ 停止', 'frontend', 'stop', '', '停止前端服务'),
    mkOpBtn('↻ 重启', 'frontend', 'restart', '', '停止后重新启动前端服务'),
  ]));
  // 后端服务行
  runCard.appendChild(runRow('后端服务', ls.backend, p.backendUrl, [
    mkOpBtn('▶ 启动', 'backend', 'start', '', '启动后端服务'),
    mkOpBtn('■ 停止', 'backend', 'stop', '', '停止后端服务'),
    mkOpBtn('↻ 重启', 'backend', 'restart', '', '停止后重新启动后端服务'),
  ]));
  if (lastOpError[p.id]) {
    const err = document.createElement('div');
    err.className = 'proj-op-error';
    err.textContent = '最近操作失败: ' + lastOpError[p.id];
    runCard.appendChild(err);
  }
  body.appendChild(runCard);

  // ---- 综述详情 ----
  const infoCard = document.createElement('div');
  infoCard.className = 'proj-card proj-card-block';
  infoCard.innerHTML = `<h3 class="proj-block-title">📋 综述详情</h3>`;
  const kv = (label, value, extra) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'proj-kv';
    const lb = document.createElement('span');
    lb.className = 'proj-kv-label';
    lb.textContent = label;
    const vl = document.createElement('span');
    vl.className = 'proj-kv-value';
    if (extra) vl.appendChild(extra);
    else vl.textContent = value || '—';
    rowEl.appendChild(lb);
    rowEl.appendChild(vl);
    return rowEl;
  };
  infoCard.appendChild(kv('项目名称', p.name));
  infoCard.appendChild(kv('项目描述', p.description));
  infoCard.appendChild(kv('部署方式', p.deployMethod));
  infoCard.appendChild(kv('启动方法', p.launchMethod));
  infoCard.appendChild(kv('备注', p.remark));
  body.appendChild(infoCard);

  // ---- 部署信息 ----
  const depCard = document.createElement('div');
  depCard.className = 'proj-card proj-card-block';
  depCard.innerHTML = `<h3 class="proj-block-title">📡 部署信息</h3>`;
  const linkBtn = (label, onClick, title) => {
    const b = document.createElement('button');
    b.className = 'btn xs';
    b.textContent = label;
    b.title = title || '';
    b.addEventListener('click', onClick);
    return b;
  };
  depCard.appendChild(kv('项目根路径', p.rootPath, p.rootPath ? linkBtn('打开目录', () => window.api.openPath(p.rootPath), '打开项目根目录') : null));
  depCard.appendChild(kv('访问地址', p.accessUrl, p.accessUrl ? linkBtn('打开', () => openExternalUrl(p.accessUrl)) : null));
  depCard.appendChild(kv('网址', p.website, p.website ? linkBtn('打开', () => openExternalUrl(p.website)) : null));
  depCard.appendChild(kv('外部应用启动路径', p.launchPath, p.launchPath ? (() => {
    const g = document.createElement('span');
    g.className = 'proj-link-group';
    g.appendChild(linkBtn('启动应用', () => {
      window.api.openExternal(p.launchPath).then((r) => {
        if (r && r.error) toast('启动失败:' + r.error, 'error');
        else toast('外部应用已启动', 'ok');
      });
    }));
    g.appendChild(linkBtn('打开位置', () => window.api.showItem(p.launchPath)));
    return g;
  })() : null));
  body.appendChild(depCard);

  // ---- 前端/后端服务配置 ----
  const svcCard = document.createElement('div');
  svcCard.className = 'proj-card proj-card-block';
  svcCard.innerHTML = `<h3 class="proj-block-title">🔧 服务配置</h3>`;
  const svcRow = (label, cmd, url) => {
    const r = document.createElement('div');
    r.className = 'proj-svc';
    const t = document.createElement('div');
    t.className = 'proj-svc-title';
    t.textContent = label;
    r.appendChild(t);
    const cmdEl = document.createElement('div');
    cmdEl.className = 'proj-svc-cmd';
    cmdEl.innerHTML = `<span class="proj-kv-label">启动命令</span><code>${esc(cmd || '—')}</code>`;
    r.appendChild(cmdEl);
    // 访问地址:http(s) → 可点击链接(外部浏览器打开);其它 → 纯文本(可选中复制)
    const urlEl = document.createElement('div');
    urlEl.className = 'proj-svc-url';
    const lb2 = document.createElement('span');
    lb2.className = 'proj-kv-label';
    lb2.textContent = '访问地址';
    urlEl.appendChild(lb2);
    if (url && /^https?:\/\//i.test(String(url).trim())) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'btn xs proj-svc-link';
      link.textContent = url;
      link.title = '用外部浏览器打开: ' + url;
      link.addEventListener('click', () => openExternalUrl(url));
      urlEl.appendChild(link);
    } else {
      const code = document.createElement('code');
      code.textContent = url || '—';
      urlEl.appendChild(code);
    }
    r.appendChild(urlEl);
    return r;
  };
  svcCard.appendChild(svcRow('前端服务', p.frontendCmd, p.frontendUrl));
  svcCard.appendChild(svcRow('后端服务', p.backendCmd, p.backendUrl));
  body.appendChild(svcCard);
}

/** 资源文档页签:项目目录树(递归)+ 当前目录条目列表 */
function renderDocsTab(body, p, folderId, actions) {
  const wrap = document.createElement('div');
  wrap.className = 'proj-docs';

  const col = document.createElement('div');
  col.className = 'proj-docs-col proj-docs-tree-col';
  const treeTitle = document.createElement('div');
  treeTitle.className = 'proj-docs-col-title';
  treeTitle.innerHTML = `📁 项目目录 <button class="btn xs" title="在项目根新建目录">＋ 新建目录</button>`;
  treeTitle.querySelector('button').addEventListener('click', () => newProjectFolderDialog(p.id, ''));
  col.appendChild(treeTitle);

  const tree = document.createElement('div');
  tree.className = 'proj-folder-tree';
  const projNode = projectMenuNode(p.id);
  const rootEntry = document.createElement('div');
  rootEntry.className = 'proj-folder-node' + ((folderId || '') === '' ? ' active' : '');
  const rootMain = document.createElement('div');
  rootMain.className = 'proj-folder-main';
  rootMain.innerHTML = `<span class="proj-folder-ico">📦</span><span class="proj-folder-name">项目根目录</span><span class="proj-folder-count">${getProjectEntries(p.id, '').length}</span>`;
  rootMain.addEventListener('click', () => actions.onOpenFolder(p.id, ''));
  rootEntry.appendChild(rootMain);
  tree.appendChild(rootEntry);

  const renderFolder = (parent, folderNode, depth) => {
    const entry = document.createElement('div');
    entry.className = 'proj-folder-node' + ((folderId || '') === folderNode.id ? ' active' : '');
    const main = document.createElement('div');
    main.className = 'proj-folder-main';
    main.style.paddingLeft = `${12 + depth * 14}px`;
    const arrow = document.createElement('span');
    arrow.className = 'proj-folder-arrow';
    arrow.textContent = '▸';
    const kids = getProjectSubFolders(folderNode.id);
    const count = getProjectEntries(p.id, folderNode.id).length;
    main.innerHTML = '';
    main.appendChild(arrow);
    main.appendChild(document.createTextNode(' '));
    const ico = document.createElement('span');
    ico.className = 'proj-folder-ico';
    ico.textContent = folderNode.icon || '📁';
    main.appendChild(ico);
    const nm = document.createElement('span');
    nm.className = 'proj-folder-name';
    nm.textContent = folderNode.name;
    main.appendChild(nm);
    const cnt = document.createElement('span');
    cnt.className = 'proj-folder-count';
    cnt.textContent = count;
    main.appendChild(cnt);
    main.addEventListener('click', () => actions.onOpenFolder(p.id, folderNode.id));
    entry.appendChild(main);
    // 目录操作(新建子目录/重命名/删除)
    const ops = document.createElement('span');
    ops.className = 'proj-folder-ops';
    const mkOp = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'btn xs';
      b.textContent = label;
      b.title = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    ops.appendChild(mkOp('＋', () => newProjectFolderDialog(p.id, folderNode.id)));
    ops.appendChild(mkOp('✏️', () => renameProjectFolderDialog(folderNode.id)));
    ops.appendChild(mkOp('🗑', () => deleteProjectFolderDialog(folderNode.id)));
    main.appendChild(ops);
    parent.appendChild(entry);
    // 子目录(默认展开第一层)
    const subWrap = document.createElement('div');
    subWrap.className = 'proj-folder-subs';
    for (const k of kids) renderFolder(subWrap, k, depth + 1);
    parent.appendChild(subWrap);
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      subWrap.hidden = !subWrap.hidden;
      arrow.textContent = subWrap.hidden ? '▸' : '▾';
    });
  };
  for (const f of getProjectFolders(p.id)) renderFolder(tree, f, 1);
  col.appendChild(tree);
  wrap.appendChild(col);

  // 条目列表
  const listCol = document.createElement('div');
  listCol.className = 'proj-docs-col proj-docs-list-col';
  const folderName = (folderId || '') === '' ? '项目根目录' : ((menuNodeById(folderId) || {}).name || '未知目录');
  const listTitle = document.createElement('div');
  listTitle.className = 'proj-docs-col-title';
  listTitle.innerHTML = `📄 条目 · ${esc(folderName)} <button class="btn xs primary" title="在当前目录新增文档/链接/文件条目">＋ 新增条目</button>`;
  listTitle.querySelector('button').addEventListener('click', () => newEntryDialog(p.id, folderId || ''));
  listCol.appendChild(listTitle);

  const entries = getProjectEntries(p.id, folderId || '');
  if (!entries.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '该目录下暂无条目,点击右上角「＋ 新增条目」添加文档 / 链接 / 文件。';
    listCol.appendChild(hint);
  } else {
    const list = document.createElement('div');
    list.className = 'proj-entry-list';
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'proj-entry';
      const icon = e.type === 'link' ? '🔗' : e.type === 'file' ? '📎' : '📄';
      row.innerHTML = `
        <span class="proj-entry-ico">${icon}</span>
        <span class="proj-entry-name" title="${esc(e.name)}">${esc(e.name)}</span>
        <span class="proj-entry-type">${e.type === 'link' ? '链接' : e.type === 'file' ? '文件' : '文档'}</span>
        <span class="proj-entry-content">${esc((e.content || '').slice(0, 60))}${(e.content || '').length > 60 ? '…' : ''}</span>
        <span class="proj-entry-ops">
          <button class="btn xs" data-op="open" title="打开">打开</button>
          <button class="btn xs" data-op="edit" title="编辑">编辑</button>
          <button class="btn xs danger" data-op="del" title="删除">删除</button>
        </span>`;
      row.querySelector('[data-op="open"]').addEventListener('click', () => openEntry(e));
      row.querySelector('[data-op="edit"]').addEventListener('click', () => editEntryDialog(e.id));
      row.querySelector('[data-op="del"]').addEventListener('click', () => {
        confirmDialog({
          title: '删除条目',
          message: `确定删除条目「${esc(e.name)}」吗?`,
          danger: true,
          onOk: () => {
            removeProjectEntry(e.id);
            toast('已删除');
            actions.onRefresh();
          },
        });
      });
      list.appendChild(row);
    }
    listCol.appendChild(list);
  }
  wrap.appendChild(listCol);
  body.appendChild(wrap);
}

/** 打开条目:文档 → 内容弹窗;链接 → 外部打开;文件 → 系统打开 */
function openEntry(e) {
  if (e.type === 'link') {
    openExternalUrl(e.content);
    return;
  }
  if (e.type === 'file') {
    if (!e.content) return toast('未配置文件路径', 'error');
    window.api.openPath(e.content).then((r) => { if (r) toast('已打开:' + r, 'ok'); });
    return;
  }
  // 文档:内容弹窗(可复制)
  const body = document.createElement('div');
  body.className = 'modal-body';
  const pre = document.createElement('pre');
  pre.className = 'proj-entry-doc';
  pre.textContent = e.content || '(空文档)';
  body.appendChild(pre);
  openModal({
    title: '📄 ' + e.name,
    body,
    wide: true,
    foot: footButtons([
      { text: '复制内容', cls: '', onClick: () => { try { navigator.clipboard.writeText(e.content || ''); toast('已复制'); } catch (err) { toast('复制失败', 'error'); } } },
      { text: '关闭', cls: 'primary', onClick: (btn) => btn.closest('.modal-mask').remove() },
    ]),
  });
}

// ---------------- 表单:新增 / 编辑项目 ----------------

function projectFormFields(values = {}) {
  const v = (k, d = '') => (values[k] == null ? d : values[k]);
  const rows = [
    { key: 'name', label: '项目名称 *', type: 'text', value: v('name'), required: true },
    { key: 'description', label: '项目描述', type: 'textarea', value: v('description'), hint: '项目简介 / 技术栈 / 用途等' },
    { key: 'rootPath', label: '项目根路径', type: 'text', value: v('rootPath'), hint: '服务启动的工作目录(如 E:/MyProject/hedaoedu)' },
    { key: 'accessUrl', label: '访问地址', type: 'text', value: v('accessUrl'), hint: '主访问入口,如 http://localhost:5173/' },
    { key: 'website', label: '网址', type: 'text', value: v('website'), hint: '线上网址(可选)' },
    { key: 'launchPath', label: '外部应用启动路径', type: 'text', value: v('launchPath'), hint: '一键启动的外部程序 / 脚本路径(可选)' },
    { key: 'deployMethod', label: '部署方式', type: 'textarea', value: v('deployMethod'), hint: '如:本地开发环境 + Docker MySQL' },
    { key: 'launchMethod', label: '启动方法', type: 'textarea', value: v('launchMethod'), hint: '一键启动执行的命令(如 bash start-dev.sh),留空则依次启动前后端' },
    { key: 'frontendCmd', label: '前端服务配置(启动命令)', type: 'text', value: v('frontendCmd'), hint: '如 npm run dev / npm run dev --prefix admin-web' },
    { key: 'frontendUrl', label: '前端服务配置(访问地址)', type: 'text', value: v('frontendUrl'), hint: '用于探测前端是否运行,如 http://localhost:5173/' },
    { key: 'backendCmd', label: '后端服务配置(启动命令)', type: 'text', value: v('backendCmd'), hint: '如 java -jar admin-server/target/app.jar' },
    { key: 'backendUrl', label: '后端服务配置(访问地址)', type: 'text', value: v('backendUrl'), hint: '用于探测后端是否运行,如 http://localhost:8080/health' },
    { key: 'remark', label: '备注', type: 'textarea', value: v('remark'), hint: '账号信息 / 注意事项等' },
  ];
  return rows.map((f) => ({ ...f, required: false }));
}

/** 新增项目:模板表单(统一字段) → 创建 → 自动生成侧栏节点 → 进入详情页 */
export function newProjectDialog(opts = {}) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  const form = document.createElement('div');
  form.className = 'proj-form';
  const inputs = {};
  for (const f of projectFormFields()) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.className = 'f-label';
    label.textContent = f.label;
    if (f.hint) label.title = f.hint;
    row.appendChild(label);
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.value = f.value;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = f.value;
    }
    // 路径字段附加「浏览…」按钮
    if (f.key === 'rootPath' || f.key === 'launchPath') {
      const g = document.createElement('div');
      g.className = 'proj-form-path';
      g.appendChild(input);
      const pick = document.createElement('button');
      pick.className = 'btn xs';
      pick.textContent = '浏览…';
      pick.type = 'button';
      pick.addEventListener('click', async () => {
        if (f.key === 'rootPath') {
          const r = await window.api.pickDirs({ title: '选择项目根目录', multi: false });
          if (!r.canceled && r.filePaths.length) input.value = r.filePaths[0];
        } else {
          const r = await window.api.pickFiles({ title: '选择外部应用', filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd', 'sh'] }] });
          if (!r.canceled && r.filePaths.length) input.value = r.filePaths[0];
        }
      });
      g.appendChild(pick);
      row.appendChild(g);
    } else {
      row.appendChild(input);
    }
    inputs[f.key] = input;
    form.appendChild(row);
  }
  body.appendChild(form);
  openModal({
    title: '＋ 新增项目',
    body,
    wide: true,
    foot: footButtons([
      { text: '取消', cls: '', onClick: (btn) => btn.closest('.modal-mask').remove() },
      {
        text: '创建项目',
        cls: 'primary',
        onClick: async (btn) => {
          const name = (inputs.name.value || '').trim();
          if (!name) return toast('项目名称不能为空', 'error');
          const data = {
            name,
            description: inputs.description.value,
            rootPath: inputs.rootPath.value.trim(),
            accessUrl: inputs.accessUrl.value.trim(),
            website: inputs.website.value.trim(),
            launchPath: inputs.launchPath.value.trim(),
            deployMethod: inputs.deployMethod.value,
            launchMethod: inputs.launchMethod.value,
            frontendCmd: inputs.frontendCmd.value.trim(),
            frontendUrl: inputs.frontendUrl.value.trim(),
            backendCmd: inputs.backendCmd.value.trim(),
            backendUrl: inputs.backendUrl.value.trim(),
            remark: inputs.remark.value,
          };
          const p = addProject(data);
          if (!p) return toast('创建失败', 'error');
          toast('项目「' + p.name + '」创建成功', 'ok');
          btn.closest('.modal-mask').remove();
          dispatchNav({ action: 'open', projectId: p.id });
        },
      },
    ]),
  });
}

/** 编辑项目:全字段表单,保存后实时同步详情页与侧栏节点 */
export function editProjectDialog(projectId, opts = {}) {
  const p = projectById(projectId);
  if (!p) return toast('项目不存在', 'error');
  const body = document.createElement('div');
  body.className = 'modal-body';
  const form = document.createElement('div');
  form.className = 'proj-form';
  const inputs = {};
  for (const f of projectFormFields(p)) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.className = 'f-label';
    label.textContent = f.label;
    row.appendChild(label);
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.value = f.value;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = f.value;
    }
    if (f.key === 'rootPath' || f.key === 'launchPath') {
      const g = document.createElement('div');
      g.className = 'proj-form-path';
      g.appendChild(input);
      const pick = document.createElement('button');
      pick.className = 'btn xs';
      pick.textContent = '浏览…';
      pick.type = 'button';
      pick.addEventListener('click', async () => {
        if (f.key === 'rootPath') {
          const r = await window.api.pickDirs({ title: '选择项目根目录', multi: false });
          if (!r.canceled && r.filePaths.length) input.value = r.filePaths[0];
        } else {
          const r = await window.api.pickFiles({ title: '选择外部应用', filters: [{ name: '程序', extensions: ['exe', 'bat', 'cmd', 'sh'] }] });
          if (!r.canceled && r.filePaths.length) input.value = r.filePaths[0];
        }
      });
      g.appendChild(pick);
      row.appendChild(g);
    } else {
      row.appendChild(input);
    }
    inputs[f.key] = input;
    form.appendChild(row);
  }
  body.appendChild(form);
  openModal({
    title: '✏️ 编辑项目 · ' + p.name,
    body,
    wide: true,
    foot: footButtons([
      { text: '取消', cls: '', onClick: (btn) => btn.closest('.modal-mask').remove() },
      {
        text: '保存',
        cls: 'primary',
        onClick: (btn) => {
          const name = (inputs.name.value || '').trim();
          if (!name) return toast('项目名称不能为空', 'error');
          const patched = updateProject(projectId, {
            name,
            description: inputs.description.value,
            rootPath: inputs.rootPath.value.trim(),
            accessUrl: inputs.accessUrl.value.trim(),
            website: inputs.website.value.trim(),
            launchPath: inputs.launchPath.value.trim(),
            deployMethod: inputs.deployMethod.value,
            launchMethod: inputs.launchMethod.value,
            frontendCmd: inputs.frontendCmd.value.trim(),
            frontendUrl: inputs.frontendUrl.value.trim(),
            backendCmd: inputs.backendCmd.value.trim(),
            backendUrl: inputs.backendUrl.value.trim(),
            remark: inputs.remark.value,
          });
          if (!patched) return toast('保存失败', 'error');
          toast('项目配置已保存,导航菜单已同步', 'ok');
          btn.closest('.modal-mask').remove();
          dispatchNav({ action: 'refresh' });
        },
      },
    ]),
  });
}

/** 备注编辑(主页卡片快捷入口) */
function editRemarkDialog(projectId) {
  const p = projectById(projectId);
  if (!p) return;
  promptDialog({
    title: '📝 备注 · ' + p.name,
    fields: [{ key: 'remark', label: '备注', type: 'textarea', value: p.remark }],
    onOk: ({ remark }) => {
      updateProject(projectId, { remark: String(remark || '') });
      toast('备注已保存');
    },
  });
}

/** 删除项目:确认后删除项目配置 + 侧栏节点 + 文档条目 */
export function deleteProjectDialog(projectId, opts = {}) {
  const p = projectById(projectId);
  if (!p) return toast('项目不存在', 'error');
  confirmDialog({
    title: '删除项目',
    message: `确定删除项目「${esc(p.name)}」吗?<br/>将同时移除:侧栏项目节点(含全部子目录)、全部项目资源/文档条目。<br/><b style="color:var(--danger,#e5534b)">此操作不可恢复(不删除磁盘上的实际文件)。</b>`,
    danger: true,
    okText: '删除项目',
    onOk: () => {
      removeProject(projectId);
      toast('项目已删除');
      dispatchNav({ action: 'home' });
    },
  });
}

// ---------------- 项目子目录 对话框 ----------------

export function newProjectFolderDialog(projectId, parentId = '') {
  const p = projectById(projectId);
  if (!p) return toast('项目不存在', 'error');
  promptDialog({
    title: '新建项目目录 · ' + p.name,
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: '' }],
    onOk: ({ name }) => {
      if (!String(name || '').trim()) return toast('目录名称不能为空', 'error');
      addProjectFolder(projectId, { name, parentId });
      toast('目录已创建');
      dispatchNav({ action: 'refresh' });
    },
  });
}

export function renameProjectFolderDialog(folderNodeId) {
  const node = menuNodeById(folderNodeId);
  if (!node) return toast('目录不存在', 'error');
  promptDialog({
    title: '重命名目录',
    fields: [{ key: 'name', label: '目录名称', type: 'text', value: node.name }],
    onOk: ({ name }) => {
      if (!String(name || '').trim()) return toast('目录名称不能为空', 'error');
      renameProjectFolder(folderNodeId, name);
      toast('目录已重命名');
      dispatchNav({ action: 'refresh' });
    },
  });
}

export function deleteProjectFolderDialog(folderNodeId) {
  const node = menuNodeById(folderNodeId);
  if (!node) return toast('目录不存在', 'error');
  confirmDialog({
    title: '删除目录',
    message: `确定删除目录「${esc(node.name)}」及其全部子目录吗?<br/>目录下的条目将提升到项目根目录,不会丢失。`,
    danger: true,
    okText: '删除目录',
    onOk: () => {
      removeProjectFolder(folderNodeId);
      toast('目录已删除');
      dispatchNav({ action: 'refresh' });
    },
  });
}

// ---------------- 条目 对话框 ----------------

function newEntryDialog(projectId, folderId) {
  promptDialog({
    title: '＋ 新增条目',
    fields: [
      { key: 'name', label: '条目名称 *', type: 'text', value: '' },
      { key: 'type', label: '类型', type: 'select', options: [{ value: 'doc', label: '📄 文档' }, { value: 'link', label: '🔗 链接' }, { value: 'file', label: '📎 本地文件' }], value: 'doc' },
      { key: 'content', label: '内容 / 地址 / 路径', type: 'textarea', value: '' },
    ],
    onOk: ({ name, type, content }) => {
      if (!String(name || '').trim()) return toast('条目名称不能为空', 'error');
      addProjectEntry({ projectId, folderId, name, type, content: String(content || '') });
      toast('条目已添加');
      dispatchNav({ action: 'refresh' });
    },
  });
}

function editEntryDialog(entryId) {
  const e = projectEntryById(entryId);
  if (!e) return toast('条目不存在', 'error');
  promptDialog({
    title: '编辑条目',
    fields: [
      { key: 'name', label: '条目名称', type: 'text', value: e.name },
      { key: 'type', label: '类型', type: 'select', options: [{ value: 'doc', label: '📄 文档' }, { value: 'link', label: '🔗 链接' }, { value: 'file', label: '📎 本地文件' }], value: e.type },
      { key: 'content', label: '内容 / 地址 / 路径', type: 'textarea', value: e.content },
    ],
    onOk: ({ name, type, content }) => {
      if (!String(name || '').trim()) return toast('条目名称不能为空', 'error');
      updateProjectEntry(entryId, { name, type, content: String(content || '') });
      toast('条目已更新');
      dispatchNav({ action: 'refresh' });
    },
  });
}

// ---------------- 导航事件(侧栏右键菜单 → ui.js) ----------------

function dispatchNav(detail) {
  document.dispatchEvent(new CustomEvent('projects:navigate', { detail }));
}

// ---------------- 页面入口 ----------------

/**
 * 渲染项目管理中心页面。
 * ctx: { mode: 'home'|'detail', projectId, folderId, docTab, actions: {onOpenProject,onOpenFolder,onHome,onRefresh,setDocTab} }
 */
export function renderProjectsPage(container, ctx = {}) {
  if (!container) return;
  const actions = ctx.actions || {};
  const safeActions = {
    onOpenProject: actions.onOpenProject || ((pid) => dispatchNav({ action: 'open', projectId: pid })),
    onOpenFolder: actions.onOpenFolder || ((pid, folderId) => dispatchNav({ action: 'folder', projectId: pid, folderId })),
    onHome: actions.onHome || (() => dispatchNav({ action: 'home' })),
    onRefresh: actions.onRefresh || (() => dispatchNav({ action: 'refresh' })),
    setDocTab: actions.setDocTab || ((tab) => dispatchNav({ action: 'doctab', tab })),
  };
  container.innerHTML = '';
  if (ctx.mode !== 'detail' || !ctx.projectId || !projectById(ctx.projectId)) {
    renderHome(container, safeActions);
    return;
  }
  renderDetail(container, {
    projectId: ctx.projectId,
    folderId: ctx.folderId || '',
    docTab: ctx.docTab || 'overview',
    actions: safeActions,
  });
}

/** 打开项目详情(供侧栏右键菜单等调用) */
export function openProjectDetail(projectId) {
  dispatchNav({ action: 'open', projectId });
}
