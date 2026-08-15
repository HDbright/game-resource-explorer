// emoji 图标库浏览与管理页(在「图标资源」分类下的「emoji 图标」入口打开)
// 显示本项目内置 emoji 图标库(及用户自定义 emoji/图片图标),支持搜索、复制、添加、重命名、排序、删除、分组管理。
import {
  getIconGroups, getIconItems, addIconItem, removeIconItem,
  renameIconGroup, removeIconGroup, addIconGroup,
  moveIconItem, updateIconItem, isImageIcon, EMOJI_NAMES,
} from '../state.js';
import { toast, confirmDialog, promptDialog, showContextMenu, pickEmojiModal, iconNode } from '../dialogs.js';

const norm = (e) => String(e || '').replace(/️/g, ''); // 去变体选择符便于匹配名称

function copyText(t) {
  const done = () => toast('已复制: ' + t, 'ok', 1500);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    } else fallbackCopy(t, done);
  } catch (e) { fallbackCopy(t, done); }
}
function fallbackCopy(t, done) {
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败', 'error'); }
  document.body.removeChild(ta);
}

/** 渲染 emoji 图标库管理页(容器为 #page-emoji) */
export function renderEmojiPage(container) {
  if (!container) return;
  container.innerHTML = '';
  let selGroup = '__all__';
  let query = '';

  // ---- 头部 ----
  const header = document.createElement('div');
  header.className = 'emoji-page-head';
  const title = document.createElement('div');
  title.className = 'emoji-page-title';
  title.innerHTML = '😀 emoji 图标库 <span class="emoji-page-sub">内置 emoji 图标浏览与管理</span>';
  header.appendChild(title);

  const toolbar = document.createElement('div');
  toolbar.className = 'emoji-page-toolbar';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = '搜索 emoji 或名称…';
  search.className = 'emoji-search';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn primary';
  addBtn.textContent = '＋ 添加 emoji';
  const addGroupBtn = document.createElement('button');
  addGroupBtn.className = 'btn';
  addGroupBtn.textContent = '＋ 新建分组';
  toolbar.appendChild(search);
  toolbar.appendChild(addBtn);
  toolbar.appendChild(addGroupBtn);
  header.appendChild(toolbar);
  container.appendChild(header);

  // ---- 分组标签 ----
  const tabs = document.createElement('div');
  tabs.className = 'emoji-group-tabs';
  container.appendChild(tabs);

  // ---- 图标网格 ----
  const grid = document.createElement('div');
  grid.className = 'emoji-lib-grid';
  container.appendChild(grid);

  // 事件
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  addBtn.addEventListener('click', () => {
    const groups = getIconGroups();
    const gid = selGroup === '__all__' ? (groups[0] ? groups[0].id : '') : selGroup;
    pickEmojiModal((arr) => {
      let n = 0;
      for (const e of arr) {
        if (addIconItem({ groupId: gid, name: EMOJI_NAMES[norm(e)] || '', icon: e })) n++;
      }
      toast('已添加 ' + n + ' 个 emoji', 'ok');
      render();
    });
  });
  addGroupBtn.addEventListener('click', () => {
    promptDialog({
      title: '新建分组',
      fields: [{ key: 'name', label: '分组名称', value: '' }],
      onOk: (v) => {
        const g = addIconGroup((v.name || '').trim());
        if (g) { selGroup = g.id; toast('已新建分组: ' + g.name, 'ok'); render(); }
      },
    });
  });

  function render() {
    const groups = getIconGroups();
    const items = getIconItems();
    if (selGroup !== '__all__' && !groups.some((g) => g.id === selGroup)) selGroup = '__all__';

    // 分组标签
    tabs.innerHTML = '';
    const allTab = document.createElement('div');
    allTab.className = 'emoji-group-tab' + (selGroup === '__all__' ? ' active' : '');
    allTab.textContent = '全部 (' + items.length + ')';
    allTab.addEventListener('click', () => { selGroup = '__all__'; render(); });
    tabs.appendChild(allTab);
    for (const g of groups) {
      const cnt = items.filter((it) => it.groupId === g.id).length;
      const t = document.createElement('div');
      t.className = 'emoji-group-tab' + (selGroup === g.id ? ' active' : '');
      t.textContent = g.name + ' (' + cnt + ')';
      t.addEventListener('click', () => { selGroup = g.id; render(); });
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: '重命名分组', onClick: () => promptDialog({
            title: '重命名分组', fields: [{ key: 'name', label: '名称', value: g.name }],
            onOk: (v) => { renameIconGroup(g.id, (v.name || '').trim()); render(); },
          }) },
          { label: '删除分组', danger: true, onClick: () => confirmDialog({
            title: '删除分组', message: '将删除分组「' + g.name + '」,组内图标移动到其余分组。确定?', danger: true,
            onOk: () => { removeIconGroup(g.id); selGroup = '__all__'; render(); },
          }) },
        ]);
      });
      tabs.appendChild(t);
    }

    // 过滤
    const q = query;
    const list = items.filter((it) => {
      if (selGroup !== '__all__' && it.groupId !== selGroup) return false;
      if (!q) return true;
      const nm = (it.name || '').toLowerCase();
      const en = (EMOJI_NAMES[norm(it.icon)] || '').toLowerCase();
      return (it.icon || '').includes(q) || nm.includes(q) || en.includes(q);
    });

    grid.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'emoji-empty';
      empty.textContent = '没有匹配的 emoji 图标';
      grid.appendChild(empty);
      return;
    }
    // 批量构建(一次 DocumentFragment 挂载,避免逐卡 append 触发多次重排);
    // 卡片加 content-visibility(见 CSS)后浏览器跳过屏幕外卡片的布局/绘制,滚动流畅
    const frag = document.createDocumentFragment();
    for (const it of list) {
      const card = document.createElement('div');
      card.className = 'emoji-card';
      const ic = iconNode(it.icon, 'emoji-card-ic');
      card.appendChild(ic);
      const nm = document.createElement('div');
      nm.className = 'emoji-card-name';
      nm.textContent = it.name || EMOJI_NAMES[norm(it.icon)] || (isImageIcon(it.icon) ? '图片图标' : it.icon);
      nm.title = it.name || '';
      card.appendChild(nm);
      card.title = '点击复制 emoji';
      card.addEventListener('click', () => copyText(it.icon));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: '复制 emoji', onClick: () => copyText(it.icon) },
          { label: '复制名称', onClick: () => copyText(it.name || '') },
          { label: '编辑名称', onClick: () => promptDialog({
            title: '编辑名称', fields: [{ key: 'name', label: '名称', value: it.name || '' }],
            onOk: (v) => { updateIconItem(it.id, { name: (v.name || '').trim() }); render(); },
          }) },
          { label: '上移', onClick: () => { if (moveIconItem(it.id, -1)) render(); } },
          { label: '下移', onClick: () => { if (moveIconItem(it.id, 1)) render(); } },
          { label: '删除', danger: true, onClick: () => confirmDialog({
            title: '删除图标', message: '确定删除该 emoji 图标?', danger: true,
            onOk: () => { removeIconItem(it.id); render(); },
          }) },
        ]);
      });
      frag.appendChild(card);
    }
    grid.appendChild(frag);
  }

  render();
}
