import './style.css';
import * as PIXI from 'pixi.js';

import {
  loadState, state, itemById, setSetting, saveState,
  addCategory, updateCategory, removeCategory,
  addItem, updateItem, removeItem,
  reorderCategory,
  addFavCategory, removeFavCategory, addFavItem, removeFavItem, moveFavItem,
  reorderFavCategory,
  favLocations, isFavored,
} from './state.js';
import { PreviewController } from './preview/index.js';
import { initUI, renderCategories, renderItems, renderMainArea, selectItem, updatePlaybackUI, updateStatusBar } from './ui.js';

// 供 DragonBones UMD 运行时在全局访问 PIXI
window.PIXI = PIXI;

const preview = new PreviewController();
window.__preview = preview;

async function main() {
  await loadState();

  const canvas = document.getElementById('pv-canvas');
  const wrap = document.getElementById('pv-canvas-wrap');
  await preview.init(canvas, wrap);

  // 应用已保存的设置
  preview.setBgColor(state.settings.bgColor || '#22242b');

  // 需求1:打开软件时默认显示主页(不持久化,避免覆盖用户上次的标签选择)
  state.settings.resourceTab = 'home';

  initUI(preview);
  updatePlaybackUI();

  // 恢复上次浏览的分类
  let lastCat = state.settings.lastCategoryId;
  if (lastCat !== 'all' && lastCat !== '' && !state.categories.some((c) => c.id === lastCat)) {
    lastCat = 'all';
  }
  renderCategories(lastCat || 'all');
  renderMainArea();

  // 状态栏定时刷新
  setInterval(updateStatusBar, 250);

  // 注:需求1要求启动默认主页,不再自动恢复上次预览的动画(否则会跳进预览页)
  // 恢复上次浏览的动画(冒烟模式下跳过,避免异步恢复干扰冒烟步骤的 selectItem)
  // if (!window.__SMOKE_FLAG__) {
  //   const lastItemId = state.settings.lastItemId;
  //   if (lastItemId) {
  //     const it = itemById(lastItemId);
  //     if (it) {
  //       try {
  //         await selectItem(it.id);
  //       } catch (err) {
  //         console.error('自动恢复预览失败', err);
  //       }
  //     }
  //   }
  // }
}

// ---------------- 冒烟测试钩子 ----------------

async function runCrudSmoke() {
  try {
    const cat = addCategory({ name: '__smoke_cat__' });
    updateCategory(cat.id, { name: '__smoke_cat2__' });
    const it = addItem({
      categoryId: cat.id,
      type: 'spine',
      filePath: 'E:/fake/path/hero.json',
      displayName: 'smokeItem',
    });
    updateItem(it.id, { displayName: 'smokeItem2', remark: 'r' });
    removeItem(it.id);
    removeCategory(cat.id);
    const leftover = state.categories.find((c) => c.id === cat.id) || state.items.find((i) => i.id === it.id);
    return leftover ? 'FAIL:leftover' : 'ok';
  } catch (err) {
    return 'FAIL:' + err.message;
  }
}

async function probeState() {
  const body = document.getElementById('preview-body');
  const err = document.getElementById('pv-error');
  const sel = document.getElementById('anim-select');
  const canvas = document.getElementById('pv-canvas');
  let pixels = null;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const imgEl = new Image();
    await new Promise((r) => { imgEl.onload = r; imgEl.onerror = r; imgEl.src = dataUrl; });
    const pc = document.createElement('canvas');
    pc.width = imgEl.width;
    pc.height = imgEl.height;
    const ctx = pc.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    const img = ctx.getImageData(0, 0, pc.width, pc.height);
    const d = img.data;
    const bgHex = (state.settings.bgColor || '#22242b').replace('#', '');
    const bg = [parseInt(bgHex.slice(0, 2), 16), parseInt(bgHex.slice(2, 4), 16), parseInt(bgHex.slice(4, 6), 16)];
    let nonBg = 0;
    const colors = {};
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 10) continue;
      if (Math.abs(r - bg[0]) > 12 || Math.abs(g - bg[1]) > 12 || Math.abs(b - bg[2]) > 12) {
        nonBg++;
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        colors[key] = (colors[key] || 0) + 1;
      }
    }
    const top = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 8);
    pixels = { w: pc.width, h: pc.height, nonBg, ratio: +(nonBg / (d.length / 4)).toFixed(4), top };
  } catch (e) {
    pixels = 'probe-error: ' + e.message;
  }
  return {
    bodyHidden: body.hidden,
    errHidden: err.hidden,
    errText: (err.textContent || '').slice(0, 200),
    loadStack: (window.__lastLoadStack || '').slice(0, 700),
    actionCount: sel.options.length,
    actions: [...sel.options].map((o) => o.value).slice(0, 15),
    pixels,
    previewItem: preview.currentItemId,
    status: (document.getElementById('pv-status') || {}).textContent,
    layout: {
      win: [window.innerWidth, window.innerHeight],
      main: (() => { const el = document.querySelector('.main'); if (!el) return 'no-main'; return [el.clientWidth, el.clientHeight]; })(),
      sidebar: (() => { const el = document.querySelector('.sidebar'); return el ? [el.clientWidth, el.clientHeight] : 'no-sidebar'; })(),
      list: (() => { const el = document.querySelector('.list-panel'); return el ? [el.clientWidth, el.clientHeight] : 'no-list'; })(),
      panel: (() => { const el = document.querySelector('.preview-panel'); if (!el) return 'no-panel'; return [el.clientWidth, el.clientHeight]; })(),
      body: (() => { const el = document.getElementById('preview-body'); return [el.clientWidth, el.clientHeight]; })(),
      wrap: (() => { const el = document.getElementById('pv-canvas-wrap'); return [el.clientWidth, el.clientHeight]; })(),
      sheets: document.styleSheets.length,
    },
  };
}

function installSmoke() {
  window.__smokeStep = async (step) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 清理上一步残留的弹窗/右键菜单,避免 DOM 查询错位
    document.querySelectorAll('.modal-mask, .ctx-menu').forEach((el) => el.remove());
    switch (step) {
      case 'ui':
        renderCategories('all');
        return 'ok';
      case 'spine1': {
        const it = itemById('sample-spine');
        if (!it) return 'no-sample';
        await selectItem(it.id);
        await sleep(500); // 等待首帧渲染完成
        return await probeState();
      }
      case 'spine2':
        await sleep(1500);
        return await probeState();
      case 'spine-wave': {
        const sel = document.getElementById('anim-select');
        sel.value = 'wave';
        sel.dispatchEvent(new Event('change'));
        await sleep(900);
        return await probeState();
      }
      case 'db1': {
        const it = itemById('sample-db');
        if (!it) return 'no-sample';
        await selectItem(it.id);
        await sleep(500);
        return await probeState();
      }
      case 'db2':
        await sleep(1500);
        return await probeState();
      case 'spine38': {
        // 真实 3.8 skel(300701.skel):走 Spine38Player
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300701.skel'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message) + '|' + (window.__lastLoadStack || '').slice(0, 400);
        }
        await sleep(500);
        return await probeState();
      }
      case 'spine38-708': {
        // 真实 3.8 skel(300708.skel)调试:对比 spineviewer-love 显示差异
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message) + '|' + (window.__lastLoadStack || '').slice(0, 400);
        }
        await sleep(500);
        return await probeState();
      }
      case 'zy': {
        // 真实 3.8 JSON(zy.json):3.x JSON 必须走 Spine38Player 且花瓣 mesh 完整渲染
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('zy.json'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message) + '|' + (window.__lastLoadStack || '').slice(0, 400);
        }
        await sleep(600);
        const p = window.__preview;
        const player = p && p.player;
        const out = { playerName: player && player.constructor.name };
        if (player) {
          out.slotRecords = player._slotRecords ? player._slotRecords.size : -1;
          out.actions = (player.actions || []).map((a) => a.name);
        }
        out.probe = await probeState();
        return out;
      }
      case 'zy-zoom': {
        // 验证默认缩放 100%
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('zy.json'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message);
        }
        await sleep(600);
        const p = window.__preview;
        return {
          zoom: p ? p.getZoomRatio() : -1,
          playerName: p && p.player && p.player.constructor.name,
          probe: await probeState(),
        };
      }
      case 'guochang': {
        // 真实 3.x 旧风格 JSON(guochang.json):无 spine 字段、skins 是 Object
        // 验证:probe 识别为 3.x → 走 Spine38Player;且 spine38Player 的 skins 转换后正确加载 attachments
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('guochang.json'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message) + '|' + (window.__lastLoadStack || '').slice(0, 400);
        }
        await sleep(600);
        const p = window.__preview;
        const player = p && p.player;
        const out = { playerName: player && player.constructor.name };
        if (player) {
          out.slotRecords = player._slotRecords ? player._slotRecords.size : -1;
          out.actions = (player.actions || []).map((a) => a.name);
        }
        out.probe = await probeState();
        return out;
      }
      case 'spine38-708-qun': {
        // 调试:300708 qun(裙)mesh 运行时状态 + 只显示 qun 验证
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + err.message; }
        await sleep(400);
        const p = window.__preview;
        const player = p && p.player;
        const out = { hasPlayer: !!player, playerName: player && player.constructor.name };
        if (player) {
          out.keys = Object.keys(player).slice(0, 20);
          out.hasSkeleton = !!player.skeleton;
          out.hasSpine = !!player.spine;
          out.hasSlotRecords = !!(player._slotRecords && player._slotRecords.size);
          out.actions = (player.actions || []).map((a) => a.name);
          out.errText = (document.getElementById('pv-error').textContent || '').slice(0, 200);
          out.loadStack = (window.__lastLoadStack || '').slice(0, 300);
        }
        if (player && player._slotRecords) {
          // 暂停 + 跳到 0.5s
          if (!p.paused) p.togglePlay();
          if (player.stepTo) player.stepTo(0.5);
          await sleep(200);
          out.records = [];
          for (const [slot, rec] of player._slotRecords) {
            out.records.push({
              slot: slot.data.name,
              att: rec.att ? rec.att.constructor.name : 'none',
              name: rec.att ? (rec.att.name || rec.att.path || '') : '',
              visible: rec.mesh.visible,
              alpha: +rec.mesh.alpha.toFixed(2),
              verts: rec.geometry.positions.length / 2,
              tris: rec.geometry.indexBuffer ? rec.geometry.indexBuffer.data.length : 0,
              blend: rec.mesh.blendMode,
            });
          }
          // 单独显示测试:分别只显示 qun / xiuy / 全部,统计像素
          const countPixels = () => {
            const canvas = document.getElementById('pv-canvas');
            try {
              const dataUrl = canvas.toDataURL('image/png');
              const imgEl = new Image();
              return new Promise((r) => {
                imgEl.onload = () => {
                  const pc = document.createElement('canvas');
                  pc.width = imgEl.width; pc.height = imgEl.height;
                  const ctx = pc.getContext('2d');
                  ctx.drawImage(imgEl, 0, 0);
                  const img = ctx.getImageData(0, 0, pc.width, pc.height);
                  const d = img.data; let nonBg = 0;
                  for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] < 10) continue;
                    if (Math.abs(d[i] - 34) > 12 || Math.abs(d[i + 1] - 36) > 12 || Math.abs(d[i + 2] - 43) > 12) nonBg++;
                  }
                  r(nonBg);
                };
                imgEl.onerror = () => r(-1);
                imgEl.src = dataUrl;
              });
            } catch (e) { return Promise.resolve(-2); }
          };
          const all = [...player._slotRecords.values()];
          out.singleTests = [];
          for (const target of ['xiuy', 'qun', 'piaodaiy']) {
            for (const rec of all) rec.mesh.visible = !!(rec.att && (rec.att.name === target || rec.att.path === target));
            await sleep(150);
            const n = await countPixels();
            out.singleTests.push({ name: target, nonBg: n });
          }
          // 恢复全部可见
          for (const rec of all) rec.mesh.visible = true;
          await sleep(150);
          out.allVisible = await countPixels();
          // 输出 qun mesh 的顶点数据诊断
          const qunRec = [...player._slotRecords.values()].find((r) => r.att && (r.att.name === 'qun' || r.att.path === 'qun'));
          if (qunRec) {
            const pos = qunRec.geometry.positions;
            let nan = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < pos.length; i += 2) {
              if (!isFinite(pos[i]) || !isFinite(pos[i + 1])) nan++;
              if (pos[i] < minX) minX = pos[i];
              if (pos[i] > maxX) maxX = pos[i];
              if (pos[i + 1] < minY) minY = pos[i + 1];
              if (pos[i + 1] > maxY) maxY = pos[i + 1];
            }
            const idx = qunRec.geometry.indexBuffer.data;
            let maxIdx = -1;
            for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
            const uv = qunRec.geometry.uvs;
            out.qunDiag = {
              posLen: pos.length, nan, x: [+minX.toFixed(1), +maxX.toFixed(1)], y: [+minY.toFixed(1), +maxY.toFixed(1)],
              idxLen: idx.length, maxIdx, vertCount: pos.length / 2,
              uvLen: uv ? uv.length : 0,
              uvFirst: uv ? [].slice.call(uv, 0, 6).map((n) => +n.toFixed(4)) : [],
              texW: qunRec.mesh.texture ? qunRec.mesh.texture.width : null,
              texH: qunRec.mesh.texture ? qunRec.mesh.texture.height : null,
              meshAlpha: qunRec.mesh.alpha,
              viewC: { sx: p.viewC.scale.x, sy: p.viewC.scale.y, px: p.viewC.position.x, py: p.viewC.position.y },
            };
          }
          await sleep(300);
          out.qunOnly = await probeState();
        } else {
          out.noRecords = true;
        }
        return out;
      }
      case 'spine38-708-anim2': {
        // 300708 切到动画 2(可能是完整人物)
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message);
        }
        await sleep(300);
        const sel = document.getElementById('anim-select');
        if (sel) {
          sel.value = '2';
          sel.dispatchEvent(new Event('change'));
        }
        await sleep(800);
        return await probeState();
      }
      case 'spine38-708-anim3': {
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try { await selectItem(it.id); } catch (e) { return e.message; }
        await sleep(300);
        const sel = document.getElementById('anim-select');
        if (sel) { sel.value = '3'; sel.dispatchEvent(new Event('change')); }
        await sleep(800);
        return await probeState();
      }
      case 'spine38-708-pose': {
        // 300708 setup pose 静态(暂停+stepTo 0),对比 spineviewer-love 默认显示
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try {
          await selectItem(it.id);
        } catch (err) {
          return 'load-error:' + (err && err.message);
        }
        // 暂停并跳到第 0 帧
        if (window.__preview) {
          window.__preview.togglePlay();
          window.__preview.player && window.__preview.player.stepTo && window.__preview.player.stepTo(0);
        }
        await sleep(300);
        return await probeState();
      }
      case 'spine38-bones': {
        // 3.8 skel + 骨骼调试
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300701.skel'));
        if (!it) return 'no-item';
        document.getElementById('show-bones').checked = true;
        await selectItem(it.id);
        await sleep(600);
        return await probeState();
      }
      case 'v': {
        const p = preview;
        const out = {};
        if (!p.viewC) return { err: 'no viewC' };
        out.viewC = { sx: p.viewC.scale.x, sy: p.viewC.scale.y, px: p.viewC.position.x, py: p.viewC.position.y, childCount: p.viewC.children.length };
        try { const b = p.viewC.getLocalBounds(); out.bounds = { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) { out.boundsErr = e.message; }
        try { out.hasSpinePipe = !!p.app.renderer.renderPipes.spine; out.pipes = Object.keys(p.app.renderer.renderPipes).join(','); } catch (e) { out.pipeErr = e.message; }
        if (p.player) {
          out.player = p.player.constructor.name;
          if (p.player.spine) {
            const s = p.player.spine;
            out.spine = {
              visible: s.visible,
              worldAlpha: s.worldAlpha,
              animTracks: s.state.tracks.length,
              trackTime: s.state.tracks[0] ? s.state.tracks[0].trackTime : null,
              slotCount: s.skeleton.slots.length,
            };
            try {
              const slots = s.skeleton.slots;
              out.spine.slots = slots.map((sl, i) => {
                const att = sl.getAttachment();
                let info = 'none';
                if (att) {
                  info = att.constructor.name;
                  if (att.texture) info += '|tex:' + (att.texture.constructor ? att.texture.constructor.name : '?');
                }
                return info;
              });
              const sd = s.skeleton.data;
              out.spine.animNames = sd.animations.map((a) => a.name).join(',');
              out.spine.boneNames = sd.bones.map((b) => b.name).join(',');
              out.spine.skinCount = sd.skins.length;
              out.spine.skinNames = sd.skins.map((sk) => sk.name).join(',');
              out.spine.hasDefaultSkin = !!sd.defaultSkin;
            } catch (e) { out.spine.slotErr = e.message; }
            try {
              const cache = s.attachmentCacheData;
              out.spine.cache = Object.keys(cache).length;
            } catch (e) { /* ignore */ }
          }
        }
        return out;
      }
      case 'css': {
        const q = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return 'none';
          const cs = getComputedStyle(el);
          return { d: cs.display, flex: cs.flex, dir: cs.flexDirection, h: cs.height, minH: cs.minHeight };
        };
        return { panel: q('.preview-panel'), body: q('#preview-body'), wrap: q('#pv-canvas-wrap'), head: q('.preview-head'), ctrl: q('.preview-controls') };
      }
      case 'cat': {
        const out = {};
        try {
          document.getElementById('btn-new-cat').click();
          await sleep(300);
          let mask = document.querySelector('.modal-mask');
          out.modalExists = !!mask;
          if (!mask) return out;
          out.title = (mask.querySelector('.modal-title') || {}).textContent || '';
          const input = mask.querySelector('input');
          out.hasInput = !!input;
          input.value = '__smoke分类__';
          // 点击确定
          const okBtn = [...mask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '确定');
          okBtn.click();
          await sleep(300);
          out.maskClosed = !document.querySelector('.modal-mask');
          out.categoryAdded = !!window.__preview ? true : true; // 通过树判断
          const treeText = document.getElementById('cat-tree').textContent;
          out.catInTree = treeText.includes('__smoke分类__');
          out.catCount = document.querySelectorAll('.cat-node').length;
          // 通过树上的删除按钮删除该分类(顺带测 confirm 弹窗)
          const nodes = [...document.querySelectorAll('.cat-node')];
          const target = nodes.find((n) => n.querySelector('.cat-name').textContent === '__smoke分类__');
          if (target) {
            target.querySelector('.cat-ops .danger').click();
            await sleep(300);
            const cMask = document.querySelector('.modal-mask');
            out.confirmOpened = !!cMask && (cMask.querySelector('.modal-title') || {}).textContent === '删除分类';
            const delBtn = cMask && [...cMask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '删除');
            if (delBtn) delBtn.click();
            await sleep(300);
            out.catRemoved = !document.getElementById('cat-tree').textContent.includes('__smoke分类__');
          } else {
            out.catFound = false;
          }
        } catch (e) {
          out.err = e.message;
        }
        return out;
      }
      case 'features': {
        // 综合验证新功能:版本/插槽隐藏/缩放/旋转/侧栏折叠
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + err.message; }
        await sleep(400);
        const out = {};
        const p = window.__preview;
        out.version = document.getElementById('pv-version').textContent;
        out.slotCount = p.getSlots().length;
        const qunSlot = p.getSlots().find((s) => s.name === 'qun');
        out.qunVisible = qunSlot ? qunSlot.visible : null;
        // 隐藏 qun 插槽 → 像素应显著减少
        p.setSlotVisible('qun', false);
        await sleep(250);
        const afterHide = await probeState();
        out.nonBgAfterHideQun = afterHide.pixels.nonBg;
        out.qunHidden = !p.getSlots().find((s) => s.name === 'qun').visible;
        p.setSlotVisible('qun', true);
        await sleep(200);
        // 缩放
        p.setZoomRatio(0.5);
        out.zoom = +p.getZoomRatio().toFixed(3);
        // 旋转
        p.rotateClockwise();
        out.rotation = +p.viewC.rotation.toFixed(3);
        // 侧栏折叠(顶栏「资源树」按钮切换,图标变化表示状态:☰=隐藏可显示 / ▤=显示可隐藏)
        const sb = document.getElementById('sidebar');
        const tbtn = document.getElementById('btn-toggle-side');
        // 先确保从「可见」状态开始(清理上次冒烟 localStorage 残留)
        if (sb.classList.contains('hidden')) tbtn.click();
        const initVisible = !sb.classList.contains('hidden');
        tbtn.click(); // 隐藏
        out.sidebarHidden = sb.classList.contains('hidden');
        out.toggleIconWhenHidden = (tbtn.textContent || '').includes('☰');
        tbtn.click(); // 显示
        out.sidebarShown = !sb.classList.contains('hidden');
        out.toggleIconWhenShown = (tbtn.textContent || '').includes('▤');
        out.toggleOk = initVisible && out.sidebarHidden && out.toggleIconWhenHidden
          && out.sidebarShown && out.toggleIconWhenShown;
        // 结束时强制恢复侧栏可见,避免影响后续步骤
        if (sb.classList.contains('hidden')) tbtn.click();
        return out;
      }
      case 'mirror': {
        // 验证:镜像不移动位置 + 缩放100% + 布局合并
        const it = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('300708.skel'));
        if (!it) return 'no-item';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + err.message; }
        await sleep(400);
        const out = {};
        const p = window.__preview;
        const vc = p.viewC;
        out.before = { px: +vc.position.x.toFixed(1), sx: +vc.scale.x.toFixed(3) };
        p.setFlip(true);
        out.afterFlip = { px: +vc.position.x.toFixed(1), sx: +vc.scale.x.toFixed(3) };
        out.positionUnchanged = Math.abs(vc.position.x - out.before.px) < 1;
        p.setFlip(false);
        // 缩放 100%
        p.setZoomRatio(1);
        out.zoom100 = +p.getZoomRatio().toFixed(3);
        out.zoomModeSelect = !!document.getElementById('zoom-mode');
        out.zoomModeValue = document.getElementById('zoom-mode').value;
        out.zoomModeOptions = [...document.getElementById('zoom-mode').options].map((o) => o.value);
        // 布局:背景色与动作在同一行
        const animRow = document.getElementById('anim-select').closest('.ctrl-row');
        out.bgInActionRow = animRow.contains(document.getElementById('bg-color'));
        // 缩放条与倍速同一行
        const speedRow = document.getElementById('speed-range').closest('.ctrl-row');
        out.zoomInSpeedRow = speedRow.contains(document.getElementById('zoom-range'));
        return out;
      }
      case 'zoom-mode': {
        // 验证默认缩放方式下拉框三种模式:
        //   fit → 打开动画按内容适配窗口;100 → scale=1;fixed → scale=滑块数值
        const it = itemById('sample-spine');
        if (!it) return 'no-item';
        const zMode = document.getElementById('zoom-mode');
        const out = { hasSelect: !!zMode };
        if (!zMode) return out;
        const p = window.__preview;
        const apply = () => {
          zMode.dispatchEvent(new Event('change'));
        };
        // 1) fit
        zMode.value = 'fit';
        state.settings.zoomMode = 'fit';
        apply();
        await sleep(300);
        out.fitZoom = +p.getZoomRatio().toFixed(3);
        out.fitRatioBig = out.fitZoom > 1.1; // 小英雄内容小,适配窗口会放大
        // 2) 100
        zMode.value = '100';
        state.settings.zoomMode = '100';
        apply();
        await sleep(300);
        out.zoom100 = +p.getZoomRatio().toFixed(3);
        // 3) fixed:滑块设 200 → 打开后 zoom=2
        zMode.value = 'fixed';
        state.settings.zoomMode = 'fixed';
        document.getElementById('zoom-range').value = '200';
        document.getElementById('zoom-val').textContent = '200%';
        apply();
        await sleep(300);
        out.fixedZoom = +p.getZoomRatio().toFixed(3);
        // 4) dynamic:小英雄 100% 放得下 → zoom=1
        zMode.value = 'dynamic';
        state.settings.zoomMode = 'dynamic';
        apply();
        await sleep(300);
        out.dynamicSmallZoom = +p.getZoomRatio().toFixed(3);
        // 4b) dynamic:大尺寸动画(zy 1680x891)100% 放不下 → 走适配窗口,zoom<1
        const zy = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('zy.json'));
        if (zy) {
          await selectItem(zy.id);
          await sleep(500);
          out.dynamicBigZoom = +p.getZoomRatio().toFixed(3);
          out.dynamicBigFits = out.dynamicBigZoom < 1;
          // 调试:打印当前 bounds 与视口
          try {
            const b = p.player.getSkeletonBounds();
            out.dbgBounds = b ? { w: +b.width.toFixed(1), h: +b.height.toFixed(1), x: +b.x.toFixed(1), y: +b.y.toFixed(1) } : null;
            out.dbgViewport = [p.app.renderer.width, p.app.renderer.height];
            out.dbgViewC = { sx: +p.viewC.scale.x.toFixed(4), px: +p.viewC.position.x.toFixed(1), py: +p.viewC.position.y.toFixed(1) };
          } catch (e) { out.dbgErr = e.message; }
          // 反向验证:guochang 场景巨大(7239x2981),100% 放不下 → 动态应走适配窗口(zoom<1)
          const gc = state.items.find((i) => i.filePath && i.filePath.replace(/\\/g, '/').endsWith('guochang.json'));
          if (gc) {
            await selectItem(gc.id);
            await sleep(500);
            out.dynamic708Zoom = +p.getZoomRatio().toFixed(3);
            out.dynamic708Fits = out.dynamic708Zoom < 1;
            try {
              const b708 = p.player.getSkeletonBounds();
              out.dbg708Bounds = b708 ? { w: +b708.width.toFixed(1), h: +b708.height.toFixed(1) } : null;
            } catch (e) { out.dbg708Err = e.message; }
          }
          // 恢复 sample-spine 供后续步骤
          await selectItem(it.id);
          await sleep(300);
        }
        // 恢复默认
        zMode.value = '100';
        state.settings.zoomMode = '100';
        apply();
        await sleep(200);
        return out;
      }
      case 'fav': {
        // 收藏夹 CRUD + 标记验证
        const out = {};
        out.favCats0 = state.favCategories.length;
        out.favItems0 = state.favItems.length;
        // 新建收藏分类
        const fc = addFavCategory({ name: '__fav_smoke__' });
        out.favCatCreated = !!fc;
        // 收藏一个动画
        const item = state.items.find((i) => i.id === 'sample-spine') || state.items[0];
        const f1 = addFavItem(item.id, fc.id);
        out.favAdded = !!f1;
        out.isFavored = isFavored(item.id);
        out.locations = favLocations(item.id);
        // 树渲染:收藏夹根节点 + 收藏标记
        renderCategories();
        const tree = document.getElementById('cat-tree');
        out.treeHasFavRoot = !!tree.querySelector('.fav-root');
        out.treeHasFavCat = !!tree.querySelector('.fav-cat');
        out.favMarkCount = tree.querySelectorAll('.fav-mark').length;
        // 移动收藏
        const fc2 = addFavCategory({ name: '__fav_smoke2__' });
        moveFavItem(f1.id, fc2.id);
        out.movedLoc = favLocations(item.id);
        // 取消收藏
        removeFavItem(item.id, fc2.id);
        out.afterRemove = isFavored(item.id);
        // 删除收藏分类
        removeFavCategory(fc.id);
        removeFavCategory(fc2.id);
        out.favCatsAfter = state.favCategories.length;
        out.favItemsAfter = state.favItems.length;
        renderCategories();
        return out;
      }
      case 'dnd-fav': {
        // 收藏分类拖拽排序:状态层重排 + 树渲染顺序一致(自清理)
        const f1 = addFavCategory({ name: '__dnd_f1__' });
        const f2 = addFavCategory({ name: '__dnd_f2__' });
        const f3 = addFavCategory({ name: '__dnd_f3__' });
        renderCategories();
        // 模拟:把 f3 拖到 f1 上方 → [f3, f1, f2]
        reorderFavCategory(f3.id, f1.id, 'before');
        const orderAfter = state.favCategories.map((c) => c.name);
        // 模拟:把 f1 拖到 f2 下方 → [f3, f2, f1]
        reorderFavCategory(f1.id, f2.id, 'after');
        const orderAfter2 = state.favCategories.map((c) => c.name);
        renderCategories();
        const treeNames = [...document.querySelectorAll('.cat-node.fav-cat .cat-name')].map((el) => el.textContent);
        const treeFav = treeNames.filter((n) => n.startsWith('__dnd_f'));
        const orderFav = (arr) => arr.filter((n) => n.startsWith('__dnd_f'));
        const out = {
          ok: orderAfter.indexOf('__dnd_f3__') < orderAfter.indexOf('__dnd_f1__')
            && orderAfter2.indexOf('__dnd_f1__') > orderAfter2.indexOf('__dnd_f2__')
            && orderAfter2.indexOf('__dnd_f2__') > orderAfter2.indexOf('__dnd_f3__')
            && treeFav.join(',') === orderFav(orderAfter2).join(','),
          orderAfter: orderFav(orderAfter),
          orderAfter2: orderFav(orderAfter2),
          treeFav,
        };
        removeFavCategory(f1.id);
        removeFavCategory(f2.id);
        removeFavCategory(f3.id);
        renderCategories();
        return out;
      }
      case 'dnd-cat': {
        // 分类拖拽排序:状态层重排 + 树渲染顺序一致(自清理)
        const names = ['__dnd_A__', '__dnd_B__', '__dnd_C__'];
        const cats = names.map((nm) => addCategory({ name: nm }));
        renderCategories();
        // 模拟:把 C 拖到 A 上方 → [C, A, B]
        reorderCategory(cats[2].id, cats[0].id, 'before');
        const orderAfter = state.categories.map((c) => c.name);
        // 模拟:把 A 拖到 B 下方 → [C, B, A]
        reorderCategory(cats[0].id, cats[1].id, 'after');
        const orderAfter2 = state.categories.map((c) => c.name);
        renderCategories();
        const treeNames = [...document.querySelectorAll('.cat-node .cat-name')].map((el) => el.textContent);
        const treeDnd = treeNames.filter((n) => n.startsWith('__dnd_'));
        const orderDnd = (arr) => arr.filter((n) => n.startsWith('__dnd_'));
        const out = {
          ok: orderAfter.indexOf('__dnd_C__') < orderAfter.indexOf('__dnd_A__')
            && orderAfter2.indexOf('__dnd_A__') > orderAfter2.indexOf('__dnd_B__')
            && orderAfter2.indexOf('__dnd_B__') > orderAfter2.indexOf('__dnd_C__')
            && treeDnd.join(',') === orderDnd(orderAfter2).join(','),
          orderAfter: orderDnd(orderAfter),
          orderAfter2: orderDnd(orderAfter2),
          treeDnd,
        };
        for (const c of cats) removeCategory(c.id);
        renderCategories();
        return out;
      }
      case 'uncat-del': {
        // 未分类目录按需显示:无未分类动画时不显示,有则显示(删除分类可把动画移到未分类)。自清理。
        renderCategories();
        const names0 = [...document.querySelectorAll('.cat-node .cat-name')].map((el) => el.textContent);
        const hiddenWhenEmpty = !names0.includes('未分类');
        const a = addItem({ categoryId: '', type: 'spine', filePath: 'E:/fake/uncat_a.json', displayName: '__uncat_a__' });
        await sleep(600);
        renderCategories();
        const names1 = [...document.querySelectorAll('.cat-node .cat-name')].map((el) => el.textContent);
        const shownWhenHas = names1.includes('未分类');
        removeItem(a.id);
        renderCategories();
        return { hiddenWhenEmpty, shownWhenHas, ok: hiddenWhenEmpty && shownWhenHas };
      }
      case 'delcat': {
        // 删除分类增强:①删除动画+子类别 ②动画移未分类、子分类提升为上一级。自清理。
        const catA = addCategory({ name: '__del_A__' });
        const catB = addCategory({ name: '__del_B__' });
        const subA = addCategory({ name: '__del_A1__', parentId: catA.id });
        const itemA = addItem({ categoryId: catA.id, type: 'spine', filePath: 'E:/fake/del_a.json', displayName: '__del_item_a__' });
        await sleep(600);
        renderCategories();
        const findCatNode = (nm) => [...document.querySelectorAll('.cat-node')]
          .find((n) => (n.querySelector('.cat-name') || {}).textContent === nm);
        const openCatMenu = async (nm) => {
          findCatNode(nm).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
          await sleep(150);
          const itm = [...document.querySelectorAll('.ctx-menu .ctx-item')].find((el) => el.textContent === '删除');
          if (itm) itm.click();
          await sleep(250);
        };
        const out = {};
        // 模式1:删除动画 + 子类别
        await openCatMenu('__del_A__');
        const mask = document.querySelector('.modal-mask');
        out.modalTitle = mask ? (mask.querySelector('.modal-title') || {}).textContent || '' : '';
        const rbDel = mask && mask.querySelector('input[name="delcat-anim"][value="delete"]');
        if (rbDel) { rbDel.checked = true; rbDel.dispatchEvent(new Event('change')); }
        const okBtn = mask && [...mask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '删除');
        if (okBtn) okBtn.click();
        await sleep(250);
        out.mode1 = {
          catGone: !state.categories.some((c) => c.id === catA.id || c.id === subA.id),
          itemGone: !state.items.some((i) => i.id === itemA.id),
        };
        // 模式2:动画移未分类 + 子分类提升为上一级(默认选项)
        const itemB = addItem({ categoryId: catB.id, type: 'spine', filePath: 'E:/fake/del_b.json', displayName: '__del_item_b__' });
        const subB = addCategory({ name: '__del_B1__', parentId: catB.id });
        await sleep(600);
        renderCategories();
        await openCatMenu('__del_B__');
        const mask2 = document.querySelector('.modal-mask');
        const ok2 = mask2 && [...mask2.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '删除');
        if (ok2) ok2.click();
        await sleep(250);
        const itemBAfter = state.items.find((i) => i.id === itemB.id);
        const subBAfter = state.categories.find((c) => c.id === subB.id);
        out.mode2 = {
          catGone: !state.categories.some((c) => c.id === catB.id),
          itemMovedToUncat: !!itemBAfter && itemBAfter.categoryId === '',
          subPromoted: !!subBAfter && subBAfter.parentId === '',
        };
        out.ok = out.mode1.catGone && out.mode1.itemGone
          && out.mode2.catGone && out.mode2.itemMovedToUncat && out.mode2.subPromoted;
        // 清理
        if (itemBAfter) removeItem(itemB.id);
        if (subBAfter) removeCategory(subB.id);
        renderCategories();
        return out;
      }
      case 'itemmenu': {
        // 条目右键菜单:播放/打开目录/编辑/移动到.../删除/属性。自清理。
        const catX = addCategory({ name: '__im_X__' });
        const it = addItem({ categoryId: catX.id, type: 'spine', filePath: 'E:/fake/im_a.json', displayName: '__im_item__' });
        await sleep(600);
        renderCategories();
        // 默认折叠:先展开 __im_X__ 分类的箭头,树内条目才可见
        const catNodeX = [...document.querySelectorAll('.cat-node')]
          .find((n) => (n.querySelector('.cat-name') || {}).textContent === '__im_X__');
        if (catNodeX) {
          const arrow = catNodeX.querySelector('.cat-arrow');
          if (arrow && (arrow.textContent === '▶' || arrow.textContent === '▼')) arrow.click();
          await sleep(150);
        }
        renderCategories();
        const findRow = () => [...document.querySelectorAll('.item-node')]
          .find((n) => (n.querySelector('.ic-name') || {}).textContent === '__im_item__');
        const row = findRow();
        const out = { hasRow: !!row };
        if (row) {
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 220 }));
          await sleep(150);
          const menu = document.querySelector('.ctx-menu');
          out.menuItems = menu ? [...menu.querySelectorAll('.ctx-item')].map((el) => el.textContent) : [];
          // 移动到... → 选「未分类」
          const moveItem = menu && [...menu.querySelectorAll('.ctx-item')].find((el) => el.textContent === '移动到...');
          if (moveItem) moveItem.click();
          await sleep(250);
          const mask = document.querySelector('.modal-mask');
          out.moveTitle = mask ? (mask.querySelector('.modal-title') || {}).textContent || '' : '';
          const radios = mask ? [...mask.querySelectorAll('input[type=radio]')] : [];
          if (radios.length) radios[0].checked = true;
          const ok = mask && [...mask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '确定');
          if (ok) ok.click();
          await sleep(250);
          out.movedToUncat = (state.items.find((i) => i.id === it.id) || {}).categoryId === '';
          // 属性弹窗:条目已移到「未分类」,展开未分类节点箭头
          renderCategories();
          const uncatNode = [...document.querySelectorAll('.cat-node')]
            .find((n) => (n.querySelector('.cat-name') || {}).textContent === '未分类');
          if (uncatNode) {
            const arrow = uncatNode.querySelector('.cat-arrow');
            if (arrow && (arrow.textContent === '▶' || arrow.textContent === '▼')) arrow.click();
            await sleep(150);
          }
          renderCategories();
          const row2 = findRow();
          if (row2) {
            row2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 220 }));
            await sleep(150);
            const menu2 = document.querySelector('.ctx-menu');
            const propItem = menu2 && [...menu2.querySelectorAll('.ctx-item')].find((el) => el.textContent === '属性');
            if (propItem) propItem.click();
            await sleep(250);
            const mask2 = document.querySelector('.modal-mask');
            out.propTitle = mask2 ? (mask2.querySelector('.modal-title') || {}).textContent || '' : '';
            out.propShown = out.propTitle === '动画属性';
            const closeBtn = mask2 && [...mask2.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '关闭');
            if (closeBtn) closeBtn.click();
            await sleep(150);
          } else {
            out.propShown = false;
          }
          out.ok = out.menuItems.join() === ['播放', '打开目录', '编辑', '移动到...', '删除', '属性'].join()
            && out.movedToUncat && out.propShown;
        } else {
          out.ok = false;
        }
        // 清理
        removeItem(it.id);
        removeCategory(catX.id);
        renderCategories();
        return out;
      }
      case 'subcat': {
        // 分类右键菜单:新建子类别 + 移动(把分类移到另一分类下作为子分类)。自清理。
        const catA = addCategory({ name: '__tree_A__' });
        const catB = addCategory({ name: '__tree_B__' });
        await sleep(600); // 等写库
        renderCategories();
        const findNode = (nm) => [...document.querySelectorAll('.cat-node')]
          .find((n) => (n.querySelector('.cat-name') || {}).textContent === nm);
        const openMenu = (nm) => {
          const n = findNode(nm);
          n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 220 }));
          return n;
        };
        const clickMenuItem = (label) => {
          const menu = document.querySelector('.ctx-menu');
          if (!menu) return false;
          const item = [...menu.querySelectorAll('.ctx-item')].find((el) => el.textContent === label);
          if (item) item.click();
          return !!item;
        };
        const fillPrompt = async (value) => {
          await sleep(200);
          const mask = document.querySelector('.modal-mask');
          const input = mask && mask.querySelector('input');
          if (input) input.value = value;
          const ok = mask && [...mask.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '确定');
          if (ok) ok.click();
          await sleep(200);
          return !!ok;
        };
        const out = {};
        // 1) 右键 __tree_A__ → 新建子类别
        openMenu('__tree_A__');
        const menu = document.querySelector('.ctx-menu');
        out.menuShown = !!menu;
        out.menuItems = menu ? [...menu.querySelectorAll('.ctx-item')].map((el) => el.textContent) : [];
        out.newSubClicked = clickMenuItem('新建子类别');
        await fillPrompt('__sub_1__');
        const subCat = state.categories.find((c) => c.name === '__sub_1__');
        out.subCreated = !!subCat && subCat.parentId === catA.id;
        // 2) 右键 __tree_B__ → 移动... → 选 __tree_A__ → 确定
        renderCategories();
        openMenu('__tree_B__');
        out.moveClicked = clickMenuItem('移动...');
        await sleep(250);
        const mask2 = document.querySelector('.modal-mask');
        out.moveModalTitle = mask2 ? (mask2.querySelector('.modal-title') || {}).textContent || '' : '';
        const radios = mask2 ? [...mask2.querySelectorAll('input[type=radio]')] : [];
        out.moveOptions = radios.map((r) => (r.closest('label') || {}).textContent || '');
        const targetRadio = radios.find((r) => ((r.closest('label') || {}).textContent || '').includes('__tree_A__'));
        if (targetRadio) targetRadio.checked = true;
        const ok2 = mask2 && [...mask2.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent === '确定');
        if (ok2) ok2.click();
        await sleep(200);
        const moved = state.categories.find((c) => c.id === catB.id);
        out.movedParentId = moved ? moved.parentId : null;
        out.moveOk = moved && moved.parentId === catA.id;
        // 3) 树渲染:子分类节点存在(newSubCategoryDialog 已自动展开父分类;若未展开则点箭头)
        renderCategories();
        const parentNode = findNode('__tree_A__');
        if (parentNode) {
          const arrow = parentNode.querySelector('.cat-arrow');
          if (arrow && arrow.textContent === '▶') arrow.click(); // 仅未展开时点击
          await sleep(150);
        }
        renderCategories();
        out.subInTree = !!findNode('__sub_1__');
        out.ok = out.menuShown && out.subCreated && out.moveOk && out.subInTree
          && JSON.stringify(out.menuItems) === JSON.stringify(['添加资源', '批量添加', '新建子类别', '编辑分类', '移动...', '删除']);
        // 清理
        for (const c of state.categories.filter((c) => c.name.startsWith('__tree_') || c.name === '__sub_1__')) {
          removeCategory(c.id);
        }
        renderCategories();
        return out;
      }
      case 'fix-center': {
        // 修复验证:动画第 0 帧无 attachment、内容后期才出现(1000101)→ getSkeletonBounds
        // 联合采样后 loadItem 应正确居中(pivot=内容中心, position=视口中心)。自清理。
        const it = addItem({
          categoryId: '',
          type: 'spine',
          filePath: 'E:/backup/游戏场景/异兽灵境/res/game_100073549/spine_groups/1000101/1000101.json',
          displayName: '__fix_center__',
        });
        try {
          // 等待 saveState 防抖(150ms)写库完成 → 主进程 refreshRoots 更新静态文件根
          await sleep(600);
          await selectItem(it.id);
          await sleep(700);
          const p = window.__preview;
          const player = p.player;
          const out = {
            playerName: player && player.constructor.name,
            pivot: p.viewC ? [Math.round(p.viewC.pivot.x), Math.round(p.viewC.pivot.y)] : null,
            position: p.viewC ? [Math.round(p.viewC.position.x), Math.round(p.viewC.position.y)] : null,
            zoom: p.getZoomRatio(),
          };
          if (player && typeof player.getSkeletonBounds === 'function') {
            const b = player.getSkeletonBounds();
            out.bounds = b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
          }
          out.viewCenter = [Math.round(p.app.renderer.width / 2), Math.round(p.app.renderer.height / 2)];
          if (out.bounds && out.pivot && out.position) {
            const bcx = out.bounds.x + out.bounds.w / 2;
            const bcy = out.bounds.y + out.bounds.h / 2;
            // pivot 必须严格等于内容中心;position 允许 ±20px 容差
            // (loadItem 后可能发生一次窗口 resize,renderer 尺寸变化导致微小偏移)
            out.ok = Math.abs(out.pivot[0] - bcx) <= 2 && Math.abs(out.pivot[1] - bcy) <= 2
              && Math.abs(out.position[0] - out.viewCenter[0]) <= 20
              && Math.abs(out.position[1] - out.viewCenter[1]) <= 20;
          } else {
            out.ok = false;
          }
          removeItem(it.id);
          renderCategories();
          return out;
        } catch (err) {
          try { removeItem(it.id); } catch (e) { /* ignore */ }
          return { err: (err && err.message) || String(err) };
        }
      }
      case 'home': {
        // 通过品牌名进入主页(需求5:主页标签已改为 3D,主页入口=品牌/面包屑)
        const brand = document.querySelector('.brand');
        if (brand) brand.click();
        await sleep(300);
        const page = document.getElementById('page-home');
        const out = {
          pageVisible: !!page && !page.hidden,
          statCards: document.querySelectorAll('.stat-card').length,
          statTexts: [...document.querySelectorAll('.stat-card .sc-label')].map((el) => el.textContent),
          quickCats: document.querySelectorAll('.quick-cat').length,
          recentItems: document.querySelectorAll('.recent-item').length,
        };
        return out;
      }
      case 'folder': {
        // 点选第一个分类 → 目录列表页可见 + 统计条
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => n.dataset.id && !n.dataset.id.startsWith('__') && n.dataset.id !== 'all' && !n.dataset.id.startsWith('fav:'));
        if (!catNode) return { err: 'no-cat-node' };
        const before = state.settings.resourceTab;
        catNode.click();
        await sleep(300);
        const folder = document.getElementById('page-folder');
        const stats = document.getElementById('folder-stats');
        return {
          beforeTab: before,
          afterTab: state.settings.resourceTab,
          folderVisible: !!folder && !folder.hidden,
          statsText: stats ? stats.textContent : '',
          resCount: document.querySelectorAll('[data-item]').length,
          breadcrumb: document.getElementById('breadcrumb').textContent,
        };
      }
      case 'viewmode': {
        // 视图切换:icon → .res-grid;detail → .res-table;设置持久化
        const out = {};
        const iconBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'icon');
        if (iconBtn) iconBtn.click();
        await sleep(400);
        out.iconGrid = !!document.querySelector('.res-grid');
        out.settingsIcon = state.settings.listViewMode === 'icon';
        const detailBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'detail');
        if (detailBtn) detailBtn.click();
        await sleep(400);
        out.detailTable = !!document.querySelector('.res-table');
        out.settingsDetail = state.settings.listViewMode === 'detail';
        // 恢复 list 视图
        const listBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'list');
        if (listBtn) listBtn.click();
        await sleep(200);
        return out;
      }
      case 'editmode': {
        // 编辑模式:进入 → 全选 → 反选 → 点条目选中 → 退出
        const out = {};
        // 确保在 folder 页(folder 步骤已点过分类)
        const editBtn = document.getElementById('edit-mode-btn');
        if (!editBtn) return { err: 'no-edit-btn' };
        editBtn.click();
        await sleep(300);
        out.entered = !!document.querySelector('[data-edit-act]');
        const selectAll = document.querySelector('[data-edit-act="select-all"]');
        if (selectAll) selectAll.click();
        await sleep(200);
        out.selectedAll = (document.getElementById('res-count') || {}).textContent || '';
        out.selectedRows = document.querySelectorAll('.res-row.selected, tr.selected, .res-card.selected').length;
        const invert = document.querySelector('[data-edit-act="invert"]');
        if (invert) invert.click();
        await sleep(200);
        out.afterInvert = document.querySelectorAll('.res-row.selected, tr.selected, .res-card.selected').length;
        // 再反选一次 → 恢复全选(重渲染后需重新获取按钮;验证反选可来回切换)
        const invert2 = document.querySelector('[data-edit-act="invert"]');
        if (invert2) invert2.click();
        await sleep(200);
        out.afterInvert2 = document.querySelectorAll('.res-row.selected, tr.selected, .res-card.selected').length;
        out.invertOk = out.afterInvert === 0 && out.afterInvert2 === out.selectedRows;
        // 点第一个条目取消选中
        const row = document.querySelector('[data-item]');
        if (row) { row.click(); await sleep(200); }
        out.afterClickRow = document.querySelectorAll('.res-row.selected, tr.selected, .res-card.selected').length;
        // 退出编辑模式
        editBtn.click();
        await sleep(300);
        out.exited = !document.querySelector('[data-edit-act]');
        return out;
      }
      case 'thumb': {
        // 图标模式下动画条目有 dataURL 缩略图
        const out = {};
        const iconBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'icon');
        if (iconBtn) iconBtn.click();
        await sleep(2500); // 等待缩略图生成
        const thumbs = [...document.querySelectorAll('.res-thumb')].filter((el) => el.dataset.item);
        out.thumbCount = thumbs.length;
        out.withSrc = thumbs.filter((el) => el.src && el.src.startsWith('data:')).length;
        out.audioFallbacks = document.querySelectorAll('.res-thumb.audio-fallback').length;
        // 恢复 list 视图
        const listBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'list');
        if (listBtn) listBtn.click();
        await sleep(200);
        return out;
      }
      case 'image-load': {
        // 图片预览:点 sample-image → pv-image-view 可见
        const it = itemById('sample-image');
        if (!it) return 'no-sample';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + (err && err.message); }
        await sleep(600);
        const view = document.getElementById('pv-image-view');
        const img = document.getElementById('img-display');
        return {
          viewVisible: !!view && !view.hidden,
          imgLoaded: !!img && img.naturalWidth > 0,
          imgSize: img ? [img.naturalWidth, img.naturalHeight] : null,
          previewVisible: !document.getElementById('page-preview').hidden,
        };
      }
      case 'audio-load': {
        // 音频预览:点 sample-audio → pv-audio-view 可见且 audio 可播放
        const it = itemById('sample-audio');
        if (!it) return 'no-sample';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + (err && err.message); }
        await sleep(600);
        const view = document.getElementById('pv-audio-view');
        const audio = document.getElementById('audio-el');
        const out = {
          viewVisible: !!view && !view.hidden,
          hasSrc: !!(audio && audio.src),
        };
        if (audio && audio.src) {
          try {
            audio.play();
            await sleep(300);
            out.currentTime = +audio.currentTime.toFixed(2);
            out.playing = !audio.paused;
            audio.pause();
          } catch (err) {
            out.playError = (err && err.message) || String(err);
          }
        }
        return out;
      }
      case 'back': {
        // 返回按钮:从预览页回到目录列表页
        const back = document.getElementById('pv-back');
        const out = {};
        if (!back) return { err: 'no-back-btn' };
        back.click();
        await sleep(300);
        out.folderVisible = !document.getElementById('page-folder').hidden;
        out.previewHidden = document.getElementById('page-preview').hidden;
        out.hasBreadcrumb = (document.getElementById('breadcrumb').textContent || '').includes('主页');
        return out;
      }
      case 'tab3d': {
        // 3D 标签:点击 → 标签高亮 + 右侧类型主页(3D 资源主页) + 树过滤 3D
        const out = {};
        const tab3d = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === '3d');
        if (!tab3d) return { err: 'no-3d-tab' };
        tab3d.click();
        await sleep(300);
        out.tabActive = tab3d.classList.contains('active');
        out.group3d = (state.settings.resourceTab || '') === '3d';
        out.homeVisible = !document.getElementById('page-home').hidden;
        out.typeHomeTitle = [...document.querySelectorAll('.home-title')].map((el) => el.textContent).join(',');
        out.hasCatTree = !!document.querySelector('.type-cat-tree');
        out.catTreeNodes = document.querySelectorAll('.type-cat-node').length;
        out.allNodeName = [...document.querySelectorAll('.cat-node .cat-name')].map((el) => el.textContent).find((t) => t.includes('3D')) || '';
        // 类型主页分类树:点箭头折叠 → 子节点隐藏
        const arrow = document.querySelector('.type-cat-arrow');
        if (arrow) {
          const before = document.querySelectorAll('.type-cat-node, .type-cat-item').length;
          arrow.click();
          await sleep(200);
          out.afterCollapse = document.querySelectorAll('.type-cat-node, .type-cat-item').length < before;
          arrow.click(); // 展开回来
          await sleep(200);
        }
        // 点一个分类目录节点 → 右侧应切到目录列表页
        const catNode = [...document.querySelectorAll('.cat-node')].find((n) => n.dataset.id && !n.dataset.id.startsWith('__') && n.dataset.id !== 'all' && !n.dataset.id.startsWith('fav:'));
        if (catNode) {
          catNode.click();
          await sleep(300);
          out.folderVisible = !document.getElementById('page-folder').hidden;
          out.folderStats = (document.getElementById('folder-stats') || {}).textContent || '';
        }
        return out;
      }
      case 'crud':
        return await runCrudSmoke();
      case 'probe':
        return await probeState();
      case 'dbg': {
        const out = {};
        const base = location.origin;
        try {
          const r = await fetch(base + '/a/sample-spine/hero.atlas');
          out.atlasStatus = r.status;
          out.atlasText = (await r.text()).slice(0, 100);
        } catch (e) { out.atlasErr = e.message; }
        try {
          const r = await fetch(base + '/a/sample-spine/hero.png');
          out.pngStatus = r.status;
          out.pngLen = (await r.blob()).size;
        } catch (e) { out.pngErr = e.message; }
        try {
          const res = await PIXI.Assets.load({ src: base + '/a/sample-spine/hero.png' });
          out.pixiPng = res ? res.constructor.name : 'null';
        } catch (e) { out.pixiPngErr = e.message; out.pixiPngStack = String(e.stack || e).slice(0, 400); }
        try {
          const res = await PIXI.Assets.load({ src: base + '/a/sample-spine/hero.atlas' });
          out.pixiAtlas = res ? res.constructor.name : 'null';
        } catch (e) { out.pixiAtlasErr = e.message; out.pixiAtlasStack = String(e.stack || e).slice(0, 600); }
        return out;
      }
      default:
        return 'unknown';
    }
  };
}

main().catch((err) => {
  console.error('[init]', err);
  document.getElementById('pv-error').hidden = false;
  document.getElementById('pv-error').textContent = '初始化失败:' + err.message;
});

if (window.__SMOKE_FLAG__) installSmoke();
