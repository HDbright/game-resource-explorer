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
import { thumbnailService } from './thumbnails.js';

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

  // 截图默认保存路径:未设置时使用图片库目录/Spine截图
  if (!state.settings.screenshotPath) {
    try {
      const info = await window.api.appInfo();
      const pics = (info && info.pictures) || (info && info.userData) || '';
      if (pics) state.settings.screenshotPath = pics.replace(/[\\/]$/, '') + '/Spine截图';
    } catch (err) {
      console.error('获取图片库目录失败:', err);
    }
  }

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
          out.ok = out.menuItems.join() === ['播放', '打开目录', '编辑', '重命名', '移动到...', '收藏', '删除', '属性'].join()
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
      case 'navfix': {
        // 回归:在资源工具箱 / 游戏场景管理 / 设置 页点击左侧资源分类节点,必须能切回资源区;
        // 且工具箱 / 场景页应显示顶栏"返回"按钮。
        const out = {};
        const clickNodeByName = (nm) => {
          const n = [...document.querySelectorAll('.cat-node')]
            .find((el) => (el.querySelector('.cat-name') || {}).textContent === nm);
          if (n) { n.click(); return true; }
          return false;
        };
        const vis = (id) => { const el = document.getElementById(id); return !!(el && !el.hidden); };
        const backBtn = () => document.getElementById('btn-back-special');
        const clickAll = () => {
          const all = document.querySelector('.cat-node[data-id="all"]');
          if (all) all.click();
          return !!all;
        };

        // 1) 打开资源工具箱子页面(astc 转 png):展开工具箱根 → 点"文件格式转换"名称直接打开该工具
        const tbRoot = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (tbRoot) { const ar = tbRoot.querySelector('.cat-arrow'); if (ar) ar.click(); } // 展开工具箱(名称点击不展开)
        await sleep(200);
        out.openedTool = clickNodeByName('文件格式转换'); // 名称点击 → openTool('astc2png')
        await sleep(250);
        out.toolboxVisible = vis('page-toolbox');
        out.backShownOnTool = !backBtn().hidden;

        // 2) 工具箱页点资源分类节点('all') → 必须切回资源区
        out.clickedAll1 = clickAll();
        await sleep(250);
        out.toolboxHidden = !vis('page-toolbox');
        out.resAfterTool = vis('page-home') || vis('page-folder');
        out.backHiddenAfterRes = backBtn().hidden;

        // 3) 打开游戏场景管理(主页)
        out.openedScene = clickNodeByName('游戏场景管理');
        await sleep(250);
        out.sceneVisible = vis('page-scene');
        out.backShownOnScene = !backBtn().hidden;

        // 4) 场景主页点资源分类节点('all') → 必须切回资源区
        out.clickedAll2 = clickAll();
        await sleep(250);
        out.sceneHidden = !vis('page-scene');
        out.resAfterScene = vis('page-home') || vis('page-folder');

        // 5) 打开设置页
        const setBtn = document.getElementById('btn-settings');
        if (setBtn) setBtn.click();
        await sleep(250);
        out.settingsVisible = vis('page-settings');
        out.backHiddenOnSettings = backBtn().hidden; // 设置页用自身返回按钮

        // 6) 设置页点资源分类节点('all') → 必须切回资源区
        out.clickedAll3 = clickAll();
        await sleep(250);
        out.settingsHidden = !vis('page-settings');
        out.resAfterSettings = vis('page-home') || vis('page-folder');

        out.ok = out.toolboxVisible && out.toolboxHidden && out.resAfterTool
          && out.sceneVisible && out.sceneHidden && out.resAfterScene
          && out.settingsVisible && out.settingsHidden && out.resAfterSettings
          && out.backShownOnTool && out.backShownOnScene && out.backHiddenAfterRes
          && out.backHiddenOnSettings;
        return out;
      }
      case 'toolhome': {
        // 回归:点击"资源工具箱"根名称 → 右侧进入工具箱主页(汇总视图),且含全部子菜单入口卡片
        const out = {};
        const tbRoot = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (!tbRoot) return { err: 'no-toolbox-root' };
        tbRoot.click(); // 名称点击 → 进入工具箱主页
        await sleep(250);
        out.toolboxVisible = !document.getElementById('page-toolbox').hidden;
        out.homeGrid = document.querySelectorAll('.tool-grid').length;
        out.entries = document.querySelectorAll('.tool-entry').length;
        out.entryTitles = [...document.querySelectorAll('.tool-entry-title')].map((el) => el.textContent).join('|');
        // 点击第一个入口卡片 → 应进入对应子工具页面
        const firstCard = document.querySelector('.tool-entry');
        out.hasFirstCard = !!firstCard;
        if (firstCard) firstCard.click();
        await sleep(250);
        out.afterGrid = document.querySelectorAll('.tool-grid').length;
        out.afterToolboxHidden = document.getElementById('page-toolbox').hidden;
        out.breadcrumb = (document.getElementById('breadcrumb').textContent || '').trim();
        out.enteredSub = document.querySelectorAll('.tool-grid').length === 0 && !document.getElementById('page-toolbox').hidden;
        out.ok = out.toolboxVisible && out.homeGrid === 1 && out.entries === 4 && out.enteredSub;
        return out;
      }
      case 'batchui': {
        // 回归:ASTC/SKEL 工具面板升级为批量(可多选文件/文件夹),关键控件存在
        const out = {};
        // 进入工具箱主页 → 打开 astc 子工具
        const tbRoot = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (!tbRoot) return { err: 'no-toolbox-root' };
        tbRoot.click();
        await sleep(250);
        const astcCard = [...document.querySelectorAll('.tool-entry')]
          .find((el) => (el.querySelector('.tool-entry-title') || {}).textContent === 'ASTC → PNG');
        if (!astcCard) return { err: 'no-astc-card' };
        astcCard.click();
        await sleep(250);
        const q = (id) => document.getElementById(id);
        out.hasPick = !!q('astc-pick');
        out.hasList = !!q('astc-list');
        out.hasOutToggle = !!q('astc-outdir-toggle');
        out.hasPreserve = !!q('astc-preserve');
        out.hasRun = !!q('astc-run');
        out.hasClear = !!q('astc-clear');
        out.runDisabled = q('astc-run') ? q('astc-run').disabled : true;
        out.listEmpty = q('astc-list') ? (q('astc-list').innerHTML.trim() === '') : false;
        out.ok = out.hasPick && out.hasList && out.hasOutToggle && out.hasPreserve && out.hasRun && out.hasClear && out.runDisabled && out.listEmpty;
        // 打开 outdir 开关 → 输出目录行 + 保持结构行应显示
        if (q('astc-outdir-toggle')) {
          q('astc-outdir-toggle').click();
          await sleep(100);
          out.outRowVisible = q('astc-outdir-row') ? (q('astc-outdir-row').style.display !== 'none') : false;
          out.preserveVisible = q('astc-preserve-wrap') ? (q('astc-preserve-wrap').style.display !== 'none') : false;
          out.ok = out.ok && out.outRowVisible && out.preserveVisible;
        }
        return out;
      }
      case 'toolhistory': {
        // 回归:批量转换工具选择区拆「选择文件 / 选择目录」两个按钮 + 最近输入目录历史 chips
        const out = {};
        // 预置一条历史记录,验证历史持久化与渲染
        try { localStorage.setItem('toolInputHistory', JSON.stringify(['C:\\fake\\hist_dir\\astc_src'])); } catch (e) {}
        const tbRoot = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (!tbRoot) return { err: 'no-toolbox-root' };
        tbRoot.click();
        await sleep(250);
        const astcCard = [...document.querySelectorAll('.tool-entry')]
          .find((el) => (el.querySelector('.tool-entry-title') || {}).textContent === 'ASTC → PNG');
        if (!astcCard) return { err: 'no-astc-card' };
        astcCard.click();
        await sleep(250);
        const q = (id) => document.getElementById(id);
        out.hasPick = !!q('astc-pick');
        out.hasPickDir = !!q('astc-pick-dir');
        out.hasHistory = !!q('astc-history');
        out.histVisible = q('astc-history') ? (q('astc-history').style.display !== 'none') : false;
        out.chipTexts = [...(q('astc-hist-chips') || { querySelectorAll: () => [] }).querySelectorAll('.hist-chip')]
          .map((el) => el.getAttribute('title')).join('|');
        // 清掉预置历史(不影响用户数据),重新渲染确认历史行隐藏
        try { localStorage.removeItem('toolInputHistory'); } catch (e) {}
        out.ok = out.hasPick && out.hasPickDir && out.hasHistory && out.histVisible
          && out.chipTexts.includes('C:\\fake\\hist_dir\\astc_src');
        // 再验证 spine 文件修复工具同样接入批量选择 + 历史(先回到工具箱主页)
        const tbRoot2 = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (tbRoot2) tbRoot2.click();
        await sleep(250);
        const fixCard = [...document.querySelectorAll('.tool-entry')]
          .find((el) => (el.querySelector('.tool-entry-title') || {}).textContent === 'Spine 文件修复');
        if (!fixCard) return { ...out, err: 'no-spinefix-card' };
        fixCard.click();
        await sleep(250);
        out.fixHasPick = !!q('fix-pick');
        out.fixHasPickDir = !!q('fix-pick-dir');
        out.fixHasHistory = !!q('fix-history');
        out.fixRunLabel = q('fix-run') ? q('fix-run').textContent.trim() : '';
        out.fixOk = out.fixHasPick && out.fixHasPickDir && out.fixHasHistory
          && (out.fixRunLabel || '').includes('修复');
        out.ok = out.ok && out.fixOk;
        return out;
      }
      case 'img-mode': {
        // 图片预览显示模式按钮:点「100%」→ 缩放=100%、transform scale(1);点「适配窗口」→ 恢复自适应缩放
        const it = itemById('sample-image');
        if (!it) return 'no-sample';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + (err && err.message); }
        await sleep(500);
        const q = (id) => document.getElementById(id);
        const out = {};
        const fitBtn = q('img-fit');
        const actualBtn = q('img-actual');
        out.hasBtns = !!fitBtn && !!actualBtn;
        if (actualBtn) {
          actualBtn.click();
          await sleep(120);
          out.zoomAfterActual = q('img-zoom-range') ? q('img-zoom-range').value : '';
          out.transformAfterActual = q('img-display') ? q('img-display').style.transform : '';
        }
        if (fitBtn) {
          fitBtn.click();
          await sleep(120);
          out.zoomAfterFit = q('img-zoom-range') ? q('img-zoom-range').value : '';
          out.transformAfterFit = q('img-display') ? q('img-display').style.transform : '';
        }
        out.ok = out.hasBtns
          && out.zoomAfterActual === '100'
          && /scale\(1\)/.test(out.transformAfterActual || '')
          && /scale\(/.test(out.transformAfterFit || '')
          && Number(out.zoomAfterFit) > 0 && Number(out.zoomAfterFit) <= 100;
        return out;
      }
      case 'audiohome': {
        // 音频播放器主页:音频 tab 主页 = 播放器页面(自建播放列表标签页 + 分类目录 + 播放器控件)
        const out = {};
        const tabAudio = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === 'audio');
        if (!tabAudio) return 'no-audio-tab';
        tabAudio.click();
        await sleep(400);
        const q = (id) => document.getElementById(id);
        out.homeVisible = !!q('page-audio-home') && !q('page-audio-home').hidden;
        out.hasTabs = !!q('ah-tabs');
        out.hasNew = !!q('ah-list-new');
        out.hasMgr = !!q('ah-list-mgr');
        out.hasCats = !!q('ah-cat-chips');
        out.hasPlay = !!q('ah-play');
        out.hasRate = !!q('ah-rate');
        out.hasMode = !!q('ah-mode');
        out.hasQueue = !!q('ah-queue');
        // 预置播放列表 → 标签渲染,点击标签 → 队列播放
        const sa = itemById('sample-audio');
        const bak = state.settings.audioPlaylists || [];
        state.settings.audioPlaylists = [{ id: 'pl_ah', name: '主页列表', paths: sa ? [sa.filePath] : [] }];
        state.settings.audioCurrentListId = 'pl_ah';
        tabAudio.click(); // 重渲染主页
        await sleep(400);
        const tabBtns = q('ah-tabs') ? [...q('ah-tabs').querySelectorAll('.ah-tab')] : [];
        out.tabCount = tabBtns.length;
        out.tabText = tabBtns.map((b) => b.textContent).join('|');
        if (tabBtns[0]) { tabBtns[0].click(); await sleep(500); }
        out.queueCount = q('ah-queue') ? q('ah-queue').querySelectorAll('.aq-item').length : 0;
        out.catChips = q('ah-cat-chips') ? q('ah-cat-chips').querySelectorAll('.ah-cat-chip').length : 0;
        out.ok = out.homeVisible && out.hasTabs && out.hasNew && out.hasMgr && out.hasCats
          && out.hasPlay && out.hasRate && out.hasMode && out.hasQueue
          && out.tabCount === 1 && out.tabText === '主页列表' && out.queueCount === 1
          && out.catChips >= 1;
        // 还原
        state.settings.audioPlaylists = bak;
        state.settings.audioCurrentListId = null;
        const mc = q('audio-mini-close');
        if (mc) mc.click();
        tabAudio.click();
        return out;
      }
      case 'audioplaylist': {
        // 播放列表增强:①条目可移动到其它播放列表;②音频资源右键菜单有「添加到播放列表...」
        const out = {};
        const q = (id) => document.getElementById(id);
        const sa = itemById('sample-audio');
        if (!sa) return 'no-sample';
        const bak = state.settings.audioPlaylists || [];
        state.settings.audioPlaylists = [
          { id: 'pl_a', name: '列表A', paths: [sa.filePath] },
          { id: 'pl_b', name: '列表B', paths: [] },
        ];
        state.settings.audioCurrentListId = 'pl_a';
        const tabAudio = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === 'audio');
        if (!tabAudio) return 'no-audio-tab';
        tabAudio.click();
        await sleep(400);
        // ① 管理对话框:移动按钮存在;勾选条目 → 移动到列表B
        q('ah-list-mgr').click();
        await sleep(250);
        out.hasMoveBtn = !!q('plm-move');
        out.itemCount = q('plm-items') ? q('plm-items').querySelectorAll('.plm-item').length : 0;
        const chk = q('plm-items') ? q('plm-items').querySelector('.plm-chk') : null;
        if (chk) {
          chk.click();
          q('plm-move').click();
          await sleep(250);
          const lastMask = () => { const m = document.querySelectorAll('.modal-mask'); return m[m.length - 1]; };
          const mt = lastMask() ? lastMask().querySelector('.modal-title') : null;
          out.moveModalTitle = mt ? mt.textContent : '';
          const mSel = lastMask() ? lastMask().querySelector('select') : null;
          if (mSel) { mSel.value = 'pl_b'; mSel.dispatchEvent(new Event('change')); }
          const okBtn = lastMask() ? [...lastMask().querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '确定') : null;
          if (okBtn) okBtn.click();
          await sleep(300);
        }
        const listA = (state.settings.audioPlaylists || []).find((l) => l.id === 'pl_a');
        const listB = (state.settings.audioPlaylists || []).find((l) => l.id === 'pl_b');
        out.aCount = listA ? listA.paths.length : -1;
        out.bCount = listB ? listB.paths.length : -1;
        // 关闭管理对话框
        const closeBtn = [...document.querySelectorAll('.modal-mask .modal-head .icon-btn')];
        if (closeBtn.length) closeBtn[closeBtn.length - 1].click();
        await sleep(250);
        // ② 音频目录列表页 → 右键音频条目 → 「添加到播放列表...」
        const catNode = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '内置示例');
        if (catNode) catNode.click();
        await sleep(450);
        const itemEl = document.querySelector('[data-item="sample-audio"]');
        out.hasItem = !!itemEl;
        if (itemEl) {
          const r = itemEl.getBoundingClientRect();
          itemEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
          await sleep(250);
          const menu = document.querySelector('.ctx-menu');
          out.menuLabels = menu ? [...menu.querySelectorAll('.ctx-item')].map((el) => el.textContent).join('|') : '';
          out.hasAddToPlaylist = menu ? [...menu.querySelectorAll('.ctx-item')].some((el) => el.textContent.includes('添加到播放列表')) : false;
          const addItem = menu && [...menu.querySelectorAll('.ctx-item')].find((el) => el.textContent.includes('添加到播放列表'));
          if (addItem) addItem.click();
          await sleep(300);
          const lastMask2 = () => { const m = document.querySelectorAll('.modal-mask'); return m[m.length - 1]; };
          const mt2 = lastMask2() ? lastMask2().querySelector('.modal-title') : null;
          out.addModalTitle = mt2 ? mt2.textContent : '';
          // 目标选列表A(已被移空)→ 确认添加
          const mSel2 = lastMask2() ? lastMask2().querySelector('select') : null;
          if (mSel2) { mSel2.value = 'pl_a'; mSel2.dispatchEvent(new Event('change')); }
          const okBtn2 = lastMask2() ? [...lastMask2().querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '确定') : null;
          if (okBtn2) okBtn2.click();
          await sleep(300);
        }
        const listA2 = (state.settings.audioPlaylists || []).find((l) => l.id === 'pl_a');
        out.aCountAfterAdd = listA2 ? listA2.paths.length : -1;
        out.ok = out.hasMoveBtn && out.itemCount === 1 && String(out.moveModalTitle).includes('移动 1 个音频到')
          && out.aCount === 0 && out.bCount === 1
          && out.hasItem && out.hasAddToPlaylist && String(out.addModalTitle).includes('添加到播放列表')
          && out.aCountAfterAdd === 1;
        // 还原
        state.settings.audioPlaylists = bak;
        state.settings.audioCurrentListId = null;
        document.querySelectorAll('.modal-mask').forEach((m) => m.remove());
        return out;
      }
      case 'audioplayer': {
        // 音频播放器:模式 6 项 / 倍速 / 播放列表控件 / 元信息按钮 / 队列渲染 / 后台迷你条
        const it = itemById('sample-audio');
        if (!it) return 'no-sample';
        const bak = state.settings.audioPlaylists || [];
        state.settings.audioPlaylists = [{ id: 'pl_smoke', name: '冒烟列表', paths: [it.filePath] }];
        state.settings.audioCurrentListId = 'pl_smoke';
        state.settings.audioMode = 'listLoop';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + (err && err.message); }
        await sleep(700);
        const q = (id) => document.getElementById(id);
        const out = {};
        out.modeOptions = q('audio-mode') ? q('audio-mode').options.length : 0;
        out.modeValue = q('audio-mode') ? q('audio-mode').value : '';
        out.hasRate = !!q('audio-rate');
        out.rateValue = q('audio-rate') ? q('audio-rate').value : '';
        out.hasListSel = !!q('audio-list-select');
        out.hasListNew = !!q('audio-list-new');
        out.hasListMgr = !!q('audio-list-manage');
        out.hasListAdd = !!q('audio-list-add');
        out.queueCount = q('audio-queue') ? q('audio-queue').querySelectorAll('.aq-item').length : 0;
        out.listSelValue = q('audio-list-select') ? q('audio-list-select').value : '';
        out.miniVisible = q('audio-mini') ? !q('audio-mini').hidden : false;
        out.miniName = q('audio-mini-name') ? q('audio-mini-name').textContent : '';
        // 队列条目:序号列 + 时长列(等元信息/时长异步加载完成)
        await sleep(4000);
        const aqItem = q('audio-queue') ? q('audio-queue').querySelector('.aq-item') : null;
        out.idxText = aqItem ? (aqItem.querySelector('.aq-idx') || {}).textContent : '';
        out.durText = aqItem ? (aqItem.querySelector('.aq-dur') || {}).textContent : '';
        out.ok = out.modeOptions === 6 && out.modeValue === 'listLoop'
          && out.hasRate && out.rateValue === '1'
          && out.hasListSel && out.hasListNew && out.hasListMgr && out.hasListAdd
          && out.queueCount === 1 && out.listSelValue === 'pl_smoke'
          && out.miniVisible && String(out.miniName).includes('tone')
          && out.idxText === '1' && !!out.durText;
        // 还原(不污染用户设置;点迷你条 × 停止播放)
        state.settings.audioPlaylists = bak;
        state.settings.audioCurrentListId = null;
        state.settings.audioMode = 'single';
        const mc = q('audio-mini-close');
        if (mc) mc.click();
        return out;
      }
      case 'img-bg': {
        // 图片预览背景色:控件存在;点「浅」→ 查看区背景变浅 + settings 更新;点「深」恢复;最后还原用户原设置
        const it = itemById('sample-image');
        if (!it) return 'no-sample';
        try { await selectItem(it.id); } catch (err) { return 'load-error:' + (err && err.message); }
        await sleep(500);
        const q = (id) => document.getElementById(id);
        const out = {};
        const orig = state.settings.bgColor || '#22242b';
        out.hasColor = !!q('img-bg-color');
        out.hasDark = !!q('img-bg-dark');
        out.hasLight = !!q('img-bg-light');
        const wrapEl = document.querySelector('.img-canvas-wrap');
        if (q('img-bg-light')) q('img-bg-light').click();
        await sleep(100);
        out.bgAfterLight = wrapEl ? wrapEl.style.background : '';
        out.settingAfterLight = state.settings.bgColor;
        if (q('img-bg-dark')) q('img-bg-dark').click();
        await sleep(100);
        out.settingAfterDark = state.settings.bgColor;
        // 浏览器会把 #eef0f5 解析为 rgb(238, 240, 245) 存回 style.background
        out.ok = out.hasColor && out.hasDark && out.hasLight
          && out.bgAfterLight === 'rgb(238, 240, 245)' && out.settingAfterLight === '#eef0f5'
          && out.settingAfterDark === '#22242b';
        // 还原用户原背景色设置与查看区背景
        setSetting('bgColor', orig);
        if (q('img-bg-color')) q('img-bg-color').value = orig;
        if (wrapEl) wrapEl.style.background = orig;
        return out;
      }
      case 'ieoverwrite': {
        // 回归:图片编辑新增「保存方式」——可切换覆盖原文件,切换后输出格式/输出目录行隐藏
        const out = {};
        const tbRoot = [...document.querySelectorAll('.cat-node')]
          .find((el) => (el.querySelector('.cat-name') || {}).textContent === '资源工具箱');
        if (!tbRoot) return { err: 'no-toolbox-root' };
        tbRoot.click();
        await sleep(250);
        const ieCard = [...document.querySelectorAll('.tool-entry')]
          .find((el) => (el.querySelector('.tool-entry-title') || {}).textContent === '图片编辑');
        if (!ieCard) return { err: 'no-imageedit-card' };
        ieCard.click();
        await sleep(250);
        const q = (id) => document.getElementById(id);
        out.hasSave = !!q('ie-save');
        out.hasOutRow = !!q('ie-outrow');
        out.saveDefault = q('ie-save') ? q('ie-save').value : '';
        out.outRowVisibleDefault = q('ie-outrow') ? (q('ie-outrow').style.display !== 'none') : false;
        // 切到覆盖原文件 → 输出行隐藏 + 输出目录清空
        if (q('ie-save')) {
          q('ie-save').value = 'overwrite';
          q('ie-save').dispatchEvent(new Event('change'));
          await sleep(100);
          out.outRowHiddenAfterSwitch = q('ie-outrow') ? (q('ie-outrow').style.display === 'none') : false;
          // 切回另存 → 输出行恢复
          q('ie-save').value = 'new';
          q('ie-save').dispatchEvent(new Event('change'));
          await sleep(100);
          out.outRowVisibleAfterBack = q('ie-outrow') ? (q('ie-outrow').style.display !== 'none') : false;
        }
        out.ok = out.hasSave && out.hasOutRow && out.saveDefault === 'new' && out.outRowVisibleDefault
          && out.outRowHiddenAfterSwitch && out.outRowVisibleAfterBack;
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
      case 'tags': {
        // 标签:编辑对话框加标签(空格/回车) → 保存持久化 → 标签库建议 → 工具栏标签过滤 + 搜索过滤
        const out = {};
        // 切到动画 tab,再进第一个分类目录(确保有可编辑条目)
        const animTab = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === 'anim');
        if (animTab) { animTab.click(); await sleep(250); }
        let catNode = [...document.querySelectorAll('.cat-node')].find((n) => n.dataset.id && !n.dataset.id.startsWith('__') && n.dataset.id !== 'all' && !n.dataset.id.startsWith('fav:'));
        if (!catNode) return { err: 'no-cat-node' };
        catNode.click();
        await sleep(300);
        const editBtn = document.querySelector('[data-op="edit"]');
        if (!editBtn) return { err: 'no-edit-btn' };
        const targetId = editBtn.dataset.item;
        editBtn.click();
        await sleep(300);
        const tagInput = document.querySelector('.tag-editor .tag-input');
        if (!tagInput) return { err: 'no-tag-editor' };
        // 输入标签 → 回车添加(空格同理,共用 keydown 分支)
        const TAG = '__冒烟标签__';
        tagInput.value = TAG;
        tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(120);
        out.chipsAfterEnter = document.querySelectorAll('.tag-editor .tag-chip').length;
        out.chipText = [...document.querySelectorAll('.tag-editor .tag-chip')].map((c) => c.textContent).join(',');
        out.addedOk = out.chipsAfterEnter >= 1 && (out.chipText || '').includes(TAG);
        // 保存
        const saveBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '保存');
        if (!saveBtn) return { err: 'no-save-btn' };
        saveBtn.click();
        await sleep(400);
        const tagged = state.items.find((i) => i.id === targetId);
        out.saved = !!(tagged && (tagged.tags || []).includes(TAG));
        // 重开条目A编辑窗:已保存的标签以 chip 形式回显
        const editBtn2 = document.querySelector('[data-op="edit"]');
        if (editBtn2) {
          editBtn2.click();
          await sleep(300);
          const chipsA = [...document.querySelectorAll('.tag-editor .tag-chip')].map((c) => c.textContent);
          out.reopenChips = chipsA.join(',');
          out.reopenOk = chipsA.some((c) => c.includes(TAG));
          const cancelBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '取消');
          if (cancelBtn) cancelBtn.click();
          await sleep(300);
        }
        // 打开另一个条目(无该标签):输入前缀 → 标签库建议中出现 TAG(点击可直接添加)
        const editBtns = [...document.querySelectorAll('[data-op="edit"]')];
        const editBtnB = editBtns.find((b) => b.dataset.item !== targetId);
        if (editBtnB) {
          editBtnB.click();
          await sleep(300);
          const tiB = document.querySelector('.tag-editor .tag-input');
          if (tiB) {
            tiB.value = TAG.slice(0, 4);
            tiB.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(150);
            const items = [...document.querySelectorAll('.tag-suggest-item')];
            out.suggestCount = items.length;
            out.suggestHasTag = items.some((el) => el.textContent.includes(TAG));
          }
          const cancelBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '取消');
          if (cancelBtn) cancelBtn.click();
          await sleep(300);
        }
        // 工具栏出现标签过滤下拉
        const tagSel = document.getElementById('tag-filter');
        out.filterSelect = !!tagSel;
        if (tagSel) {
          out.filterOptions = [...tagSel.options].map((o) => o.value);
          tagSel.value = TAG;
          tagSel.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(300);
          out.filterRows = document.querySelectorAll('[data-item]').length;
          out.filterOk = out.filterRows >= 1;
        }
        // 搜索框:按标签文本过滤
        const fSearch = document.getElementById('folder-search');
        if (fSearch) {
          fSearch.value = TAG;
          fSearch.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(300);
          out.searchRows = document.querySelectorAll('[data-item]').length;
          out.searchOk = out.searchRows >= 1;
        }
        // 清理:恢复全部 + 移除测试标签
        if (tagSel) { tagSel.value = ''; tagSel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); }
        if (fSearch) { fSearch.value = ''; fSearch.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200); }
        updateItem(targetId, { tags: [] });
        renderMainArea(); // 反映清理后的状态
        return out;
      }
      case 'batchmenu': {
        // 编辑模式多选右键:编辑(批量标签)/移动到.../收藏 三个批量功能
        const out = {};
        const animTab = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === 'anim');
        if (animTab) { animTab.click(); await sleep(250); }
        let catNode = [...document.querySelectorAll('.cat-node')].find((n) => n.dataset.id && !n.dataset.id.startsWith('__') && n.dataset.id !== 'all' && !n.dataset.id.startsWith('fav:'));
        if (!catNode) return { err: 'no-cat-node' };
        catNode.click();
        await sleep(300);
        // 进入编辑模式
        document.getElementById('edit-mode-btn').click();
        await sleep(300);
        out.editModeOn = !!document.querySelector('[data-edit-act]');
        // 编辑模式下 #page-folder 内 [data-item] 仅匹配资源行(操作按钮已隐藏);取前两个行作为批量目标
        // ⚠️ 不能用全局 [data-item]:home 页 .type-cat-item 也有 data-item(隐藏但 DOM 存在)
        const folderSel = '#page-folder [data-item]';
        const itemRows = [...document.querySelectorAll(folderSel)];
        if (itemRows.length < 2) return { err: 'no-two-items' };
        const targets = itemRows.slice(0, 2).map((el) => el.dataset.item);
        const origCats = targets.map((id) => (state.items.find((i) => i.id === id) || {}).categoryId || '');
        // 点选前两个条目(每次点击触发 renderMainArea 重建 DOM,须重新查询)
        for (const id of targets) {
          const el = [...document.querySelectorAll(folderSel)].find((r) => r.dataset.item === id);
          if (el) { el.click(); await sleep(150); }
        }
        out.selectedCount = (document.getElementById('res-count') || {}).textContent || '';
        const ctx = (x, y) => new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
        // 右键第一个条目 → 批量菜单(#page-folder 限定)
        document.querySelector('#page-folder [data-item]').dispatchEvent(ctx(300, 300));
        await sleep(200);
        out.menuItems = [...document.querySelectorAll('.ctx-item')].map((el) => el.textContent);
        out.menuOk = out.menuItems.includes('编辑标签 (2 项)') && out.menuItems.includes('移动到...') && out.menuItems.includes('收藏') && out.menuItems.includes('删除') && out.menuItems.includes('取消选择');
        // ① 批量标签:点「编辑标签 (2 项)」→ 输入新标签 → 直接点保存(不按回车,验证 commit 提交未确认输入)
        const bTag = [...document.querySelectorAll('.ctx-item')].find((el) => el.textContent.startsWith('编辑标签'));
        if (!bTag) return { err: 'no-batch-edit-menu' };
        bTag.click();
        await sleep(300);
        const bTagInput = document.querySelector('.tag-editor .tag-input');
        if (!bTagInput) return { err: 'no-batch-tag-editor' };
        bTagInput.value = '__批量标签__';
        bTagInput.focus();
        await sleep(100);
        // 不按回车,直接点保存
        const bSave = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '保存');
        if (!bSave) return { err: 'no-batch-save' };
        bSave.click();
        await sleep(400);
        out.taggedCount = state.items.filter((i) => targets.includes(i.id) && (i.tags || []).includes('__批量标签__')).length;
        out.batchTagOk = out.taggedCount === 2;
        // ② 批量收藏:右键 → 收藏 → 输入新收藏分类名 → 确定
        document.querySelector('#page-folder [data-item]').dispatchEvent(ctx(300, 300));
        await sleep(200);
        const bFav = [...document.querySelectorAll('.ctx-item')].find((el) => el.textContent === '收藏');
        if (!bFav) return { err: 'no-fav-menu' };
        bFav.click();
        await sleep(300);
        const favInput = document.querySelector('.modal-body input[type="text"]');
        if (!favInput) return { err: 'no-fav-input' };
        favInput.value = '__批量收藏__';
        const favOk = [...document.querySelectorAll('.modal-foot .btn')].find((el) => el.textContent.trim() === '确定');
        favOk.click();
        await sleep(400);
        const fcSmoke = state.favCategories.find((c) => c.name === '__批量收藏__');
        out.favCatCreated = !!fcSmoke;
        out.favCount = fcSmoke ? state.favItems.filter((f) => f.favCategoryId === fcSmoke.id && targets.includes(f.itemId)).length : 0;
        out.batchFavOk = out.favCount === 2;
        // ③ 批量移动:右键 → 移动到... → 选第一个分类 → 移动
        document.querySelector('#page-folder [data-item]').dispatchEvent(ctx(300, 300));
        await sleep(200);
        const bMv = [...document.querySelectorAll('.ctx-item')].find((el) => el.textContent === '移动到...');
        if (!bMv) return { err: 'no-move-menu' };
        bMv.click();
        await sleep(300);
        const radios = [...document.querySelectorAll('.fav-pick-list input[type="radio"]')];
        const targetRadio = radios[1]; // [0] 是「未分类」
        if (!targetRadio) return { err: 'no-move-radio' };
        targetRadio.checked = true;
        const mvBtn = [...document.querySelectorAll('.modal-foot .btn')].find((b) => b.textContent.trim() === '移动');
        if (!mvBtn) return { err: 'no-move-btn' };
        mvBtn.click();
        await sleep(400);
        out.movedCount = state.items.filter((i) => targets.includes(i.id) && (i.categoryId || '') === targetRadio.value).length;
        out.batchMoveOk = out.movedCount === 2;
        // 清理:退出编辑模式 + 恢复分类/标签 + 删收藏分类
        const editBtnExit = document.getElementById('edit-mode-btn');
        if (editBtnExit) editBtnExit.click();
        await sleep(250);
        if (fcSmoke) removeFavCategory(fcSmoke.id);
        targets.forEach((id, idx) => {
          removeFavItem(id, undefined); // 清所有收藏引用
          updateItem(id, { tags: [], categoryId: origCats[idx] });
          thumbnailService.invalidate(id);
        });
        renderCategories(); renderItems(); renderMainArea();
        return out;
      }
      case 'ctrlshift': {
        // Ctrl+点击进入编辑选择模式并选中;Shift+点击范围选中;编辑模式点击保持滚动位置。自清理。
        const out = {};
        const catX = addCategory({ name: '__cs_cat__' });
        const ids = [];
        for (let i = 0; i < 30; i++) {
          const it = addItem({ categoryId: catX.id, type: 'spine', filePath: `E:/fake/cs_${i}.json`, displayName: `__cs_${String(i).padStart(2, '0')}__` });
          ids.push(it.id);
        }
        await sleep(700); // 防抖保存 + 树渲染
        renderCategories(); renderMainArea();
        const catNode = [...document.querySelectorAll('.cat-node')]
          .find((n) => (n.querySelector('.cat-name') || {}).textContent === '__cs_cat__');
        if (!catNode) return { err: 'no-cat-node' };
        catNode.click();
        await sleep(400);
        const rows = () => [...document.querySelectorAll('#page-folder .res-row[data-item]')];
        const clickRow = (row, opts = {}) => row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
        const resCount = () => (document.getElementById('res-count') || {}).textContent || '';
        // ① Ctrl+点击第一行 → 进入编辑模式并选中
        const r0 = rows()[0];
        if (!r0) return { err: 'no-row' };
        clickRow(r0, { ctrlKey: true });
        await sleep(300);
        out.ctrlEnteredEdit = !!document.querySelector('[data-edit-act]');
        out.ctrlSelected1 = resCount();
        out.ctrlOk = out.ctrlEnteredEdit && out.ctrlSelected1.includes('已选 1 项');
        // ② Shift+点击第三行 → 范围选中第 1..3 行(锚点=第 1 行)
        const r2 = rows()[2];
        if (!r2) return { err: 'no-row2' };
        clickRow(r2, { shiftKey: true });
        await sleep(300);
        out.shiftRangeCount = resCount();
        out.shiftOk = out.shiftRangeCount.includes('已选 3 项');
        // ③ 编辑模式点击保持滚动位置:设 scrollTop → 点击中间行 → 重渲染后应保持
        const body = document.getElementById('folder-body');
        body.scrollTop = 120;
        const scrollBefore = body.scrollTop;
        const mid = rows()[5];
        if (mid) clickRow(mid); // 编辑模式普通点击 = toggle 选中
        await sleep(300);
        const scrollAfter = document.getElementById('folder-body').scrollTop;
        out.scrollBefore = scrollBefore;
        out.scrollAfter = scrollAfter;
        out.scrollKept = scrollBefore > 0 && scrollAfter === scrollBefore;
        // 清理:退出编辑模式 + 删测试条目与分类
        const editBtn = document.getElementById('edit-mode-btn');
        if (editBtn) editBtn.click();
        await sleep(250);
        for (const id of ids) removeItem(id);
        removeCategory(catX.id);
        renderCategories(); renderItems(); renderMainArea();
        return out;
      }
      case 'tipicon': {
        // 悬停提示:title 含 名称/类型/分类/标签;图标视图卡片显示至少一个标签 chip。自清理。
        const out = {};
        const animTab = [...document.querySelectorAll('#resource-tabs .tab')].find((b) => b.dataset.tab === 'anim');
        if (animTab) { animTab.click(); await sleep(250); }
        const catNode = [...document.querySelectorAll('.cat-node')]
          .find((n) => n.dataset.id && !n.dataset.id.startsWith('__') && n.dataset.id !== 'all' && !n.dataset.id.startsWith('fav:'));
        if (!catNode) return { err: 'no-cat-node' };
        catNode.click();
        await sleep(300);
        // 给第一个条目加测试标签
        const firstRow = document.querySelector('#page-folder .res-row[data-item]');
        if (!firstRow) return { err: 'no-row' };
        const id = firstRow.dataset.item;
        updateItem(id, { tags: ['__冒烟提示__'] });
        await sleep(400);
        renderMainArea();
        await sleep(200);
        // 列表视图行 title 包含分类/标签
        const row = document.querySelector(`#page-folder .res-row[data-item="${id}"]`);
        out.rowTitle = row ? row.title : '';
        out.rowHasCat = row ? row.title.includes('分类:') : false;
        out.rowHasTag = row ? row.title.includes('标签:') : false;
        // 图标视图:卡片 title + rc-tags chip
        const iconBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'icon');
        if (iconBtn) iconBtn.click();
        await sleep(400);
        const card = document.querySelector(`#page-folder .res-card[data-item="${id}"]`);
        out.cardFound = !!card;
        out.cardTitle = card ? card.title : '';
        out.titleHasCat = card ? card.title.includes('分类:') : false;
        out.titleHasTag = card ? card.title.includes('标签:') : false;
        const chip = card ? card.querySelector('.rc-tags .tag-chip') : null;
        out.rcTagText = chip ? chip.textContent : '';
        out.iconTagOk = out.rcTagText.includes('__冒烟提示__');
        // 清理:移除标签 + 恢复列表视图
        updateItem(id, { tags: [] });
        const listBtn = [...document.querySelectorAll('.view-btn')].find((b) => b.dataset.view === 'list');
        if (listBtn) listBtn.click();
        await sleep(200);
        renderMainArea();
        return out;
      }
      case 'favhome': {
        // 收藏夹:默认折叠 → 点击根进收藏夹主页 → 点分类入口进收藏夹目录列表页 → 箭头展开树内条目。自清理。
        const out = {};
        const fc = addFavCategory({ name: '__fav_home__' });
        await sleep(300);
        addFavItem('sample-spine', fc.id);
        addFavItem('sample-db', fc.id);
        await sleep(400);
        renderCategories();
        // 分隔线:收藏夹区域与资源分类目录区域之间
        out.hasTreeSep = !!document.querySelector('.tree-section-sep');
        // ① 树内状态:记录收藏夹根当前箭头(前置步骤可能已展开);验证箭头可切换折叠/展开
        const favRoot = [...document.querySelectorAll('.cat-node.fav-root')][0];
        out.arrowBefore = favRoot ? favRoot.querySelector('.cat-arrow').textContent : '';
        out.favCatInTreeBefore = !!document.querySelector('.cat-node.fav-cat');
        // 点击根节点 → 收藏夹主页
        favRoot.click();
        await sleep(300);
        out.homeVisible = !document.getElementById('page-home').hidden;
        out.homeTitle = [...document.querySelectorAll('.home-title')].map((el) => el.textContent).join(',');
        out.statCards = document.querySelectorAll('#page-home .stat-card').length;
        out.hasFavCatEntry = [...document.querySelectorAll('#page-home [data-favcat]')].some((el) => el.textContent.includes('__fav_home__'));
        out.breadcrumb = document.getElementById('breadcrumb').textContent;
        // ③ 点击收藏分类入口 → 收藏夹目录列表页
        const entry = [...document.querySelectorAll('#page-home [data-favcat]')].find((el) => el.textContent.includes('__fav_home__'));
        if (entry) entry.click();
        await sleep(300);
        out.folderVisible = !document.getElementById('page-folder').hidden;
        out.folderStats = (document.getElementById('folder-stats') || {}).textContent || '';
        out.folderRows = document.querySelectorAll('#page-folder .res-row, #page-folder tr[data-item], #page-folder .res-card').length;
        out.breadcrumb2 = document.getElementById('breadcrumb').textContent;
        // ④ 面包屑「收藏夹主页」→ 返回收藏夹主页
        const crumb = [...document.querySelectorAll('#breadcrumb .crumb')].find((el) => el.dataset.crumb === 'favhome');
        if (crumb) crumb.click();
        await sleep(300);
        out.backToFavHome = !document.getElementById('page-home').hidden && [...document.querySelectorAll('.home-title')].map((el) => el.textContent).join(',').includes('收藏夹主页');
        // ⑤ 树内:先折叠再展开,验证箭头可切换;展开后应出现 __fav_home__ 分类节点 → 再展开显示条目
        const root2 = document.querySelector('.cat-node.fav-root');
        if (root2) {
          if (root2.querySelector('.cat-arrow').textContent === '▼') {
            root2.querySelector('.cat-arrow').click(); // 折叠
            await sleep(200);
          }
          const rootCheck = document.querySelector('.cat-node.fav-root');
          out.rootCollapsedAfterToggle = rootCheck ? rootCheck.querySelector('.cat-arrow').textContent === '▶' : false;
          if (rootCheck) rootCheck.querySelector('.cat-arrow').click(); // 展开(重新查询避免旧引用)
          await sleep(200);
        }
        const fcNode = [...document.querySelectorAll('.cat-node.fav-cat')].find((n) => (n.querySelector('.cat-name') || {}).textContent === '__fav_home__');
        out.favCatShownAfterExpand = !!fcNode;
        if (fcNode) {
          // 进入目录页时树内该分类已被展开(▼);先折叠再展开,验证箭头切换 + 条目显示
          if (fcNode.querySelector('.cat-arrow').textContent === '▼') {
            fcNode.querySelector('.cat-arrow').click();
            await sleep(200);
          }
          const fcCheck = [...document.querySelectorAll('.cat-node.fav-cat')].find((n) => (n.querySelector('.cat-name') || {}).textContent === '__fav_home__');
          out.diagFcArrowBefore = fcCheck ? fcCheck.querySelector('.cat-arrow').textContent : '';
          if (fcCheck) {
            fcCheck.querySelector('.cat-arrow').click(); // 展开
            await sleep(250);
            const names = [...document.querySelectorAll('.item-node .ic-name')].map((el) => el.textContent);
            out.favItemNames = names.filter((t) => t.includes('Spine 示例') || t.includes('DragonBones 示例'));
            out.favItemsShown = out.favItemNames.length >= 1;
            out.diagItemNodes = document.querySelectorAll('.item-node').length;
            // 右键收藏分类节点 → 编辑/删除菜单
            const fcNode3 = [...document.querySelectorAll('.cat-node.fav-cat')].find((n) => (n.querySelector('.cat-name') || {}).textContent === '__fav_home__');
            out.diagFc3 = fcNode3 ? 'found' : 'null';
            out.diagAllFavCatNames = [...document.querySelectorAll('.cat-node.fav-cat .cat-name')].map((el) => el.textContent);
            out.diagFavOpenNow = [...document.querySelectorAll('.cat-node.fav-cat .cat-arrow')].map((el) => el.textContent);
            if (fcNode3) {
              fcNode3.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
              await sleep(150);
              out.favCatMenuItems = [...document.querySelectorAll('.ctx-item')].map((el) => el.textContent);
              out.favCatMenuOk = out.favCatMenuItems.includes('编辑分类') && out.favCatMenuItems.includes('删除分类');
              document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
            }
            // 右键收藏条目 → 预览/移动收藏分类/取消收藏菜单
            const favItemRow = [...document.querySelectorAll('.item-node')].find((n) => (n.querySelector('.ic-name') || {}).textContent.includes('Spine 示例'));
            out.diagFavItemRow = favItemRow ? 'found' : 'null';
            out.diagAllItemNames = [...document.querySelectorAll('.item-node .ic-name')].map((el) => el.textContent);
            if (favItemRow) {
              favItemRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
              await sleep(150);
              out.favItemMenuItems = [...document.querySelectorAll('.ctx-item')].map((el) => el.textContent);
              out.favItemMenuOk = out.favItemMenuItems.includes('取消收藏') && out.favItemMenuItems.includes('移动到其他收藏分类') && out.favItemMenuItems.includes('属性');
              document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
            }
            // 右键收藏夹根节点 → 收藏夹主页/新建收藏分类菜单
            const favRoot2 = document.querySelector('.cat-node.fav-root');
            if (favRoot2) {
              favRoot2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
              await sleep(150);
              out.favRootMenuItems = [...document.querySelectorAll('.ctx-item')].map((el) => el.textContent);
              out.favRootMenuOk = out.favRootMenuItems.includes('收藏夹主页') && out.favRootMenuItems.includes('新建收藏分类');
              document.querySelectorAll('.ctx-menu').forEach((el) => el.remove());
            }
          }
        }
        // 清理:取消收藏 + 删分类 + 点品牌回全局主页(重置收藏夹页面状态)
        removeFavItem('sample-spine', fc.id);
        removeFavItem('sample-db', fc.id);
        removeFavCategory(fc.id);
        const brand = document.querySelector('.brand');
        if (brand) brand.click();
        await sleep(300);
        renderCategories(); renderMainArea();
        out.catNamesAfter = state.categories.map((c) => c.name);
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
