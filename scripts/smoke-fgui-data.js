'use strict';
/**
 * FGUI 预览数据层断言(纯 Node, 不依赖 electron)
 * 用真实包 ActEmperorArrival 验证 buildPreviewData:
 * - 组件数量 / 子对象数量 / 跨包 Common 解析 / 无 initSize 的 Image 取 sprite 尺寸
 * - 纹理自动探测命中 / 控制器页数
 */
const assert = require('assert');
const path = require('path');
const { buildPreviewData } = require('../electron/tools/fgui/previewData');

const SAMPLE = 'E:/backup/游戏场景/异兽灵境/res/game_100073549/ui/fgui/ActEmperorArrival.bin';

const data = buildPreviewData(SAMPLE);

// 1) 组件数
assert.strictEqual(data.ok, true, 'ok');
assert.strictEqual(data.components.length, 3, `components.length 应为 3, 实际 ${data.components.length}`);

// 2) 首个组件 ActEmperorArrivalItem
const item = data.components.find((c) => c.name === 'ActEmperorArrivalItem');
assert(item, '应存在 ActEmperorArrivalItem 组件');
assert.strictEqual(item.root.kind, 'container');
assert.strictEqual(item.root.children.length, 6, `root.children.length 应为 6, 实际 ${item.root.children.length}`);

// 3) 控制器 stateCtrl 3 页
const ctrl = item.controllers.find((c) => c.name === 'stateCtrl');
assert(ctrl, '应存在 stateCtrl 控制器');
assert.strictEqual(ctrl.pages.length, 3, `stateCtrl 页数应为 3, 实际 ${ctrl.pages.length}`);

// 4) 子对象类型分布
const kinds = {};
for (const ch of item.root.children) kinds[ch.type] = (kinds[ch.type] || 0) + 1;
assert.strictEqual(kinds['Image'], 2, 'Image 子对象 2 个');
assert.strictEqual(kinds['RichText'], 1, 'RichText 子对象 1 个');
assert(kinds['Button'], 'Button 子对象存在');

// 5) 无 initSize 的 Image 子对象(n5, src=mah9b) → 取 sprite 原始尺寸 192x351
const n5 = item.root.children.find((ch) => ch.type === 'Image' && ch.srcPkgId == null && ch.id === 'n5_mah9b');
if (n5) {
  assert(n5.sprite, 'n5 应有 sprite');
  assert.strictEqual(n5.sprite.ow, 192, 'n5 sprite.ow 192');
  assert.strictEqual(n5.sprite.oh, 351, 'n5 sprite.oh 351');
  assert(n5.initWidth == null, 'n5 无 initWidth(渲染端用 sprite 尺寸)');
}

// 6) 跨包解析: Button(mvle2d) 子树来自 Common 包(9njo6dpe)
const btn = item.root.children.find((ch) => ch.type === 'Button');
if (btn) {
  assert.strictEqual(btn.srcPkgId, '9njo6dpe', 'Button srcPkgId 应为 Common 包 id');
  assert(btn.kind === 'container' && btn.children.length > 0, 'Button 应为容器且有子树');
}

// 7) 纹理探测: textures 含 ActEmperorArrival_atlas0 或 Common_atlas0
const texKeys = Object.keys(data.textures);
assert(texKeys.length > 0, '应有纹理条目');
const mainAtlas = texKeys.find((k) => k.includes('ActEmperorArrival_atlas'));
if (mainAtlas) assert(data.textures[mainAtlas] && data.textures[mainAtlas].endsWith('.png'), '主包 atlas 命中绝对路径');
assert.strictEqual(data.textureSource, 'auto', 'textureSource 应为 auto');

// 8) 递归统计节点数(不超过上限)
let nodeCount = 0;
(function walk(n) {
  nodeCount++;
  for (const c of n.children || []) walk(c);
})(item.root);
assert(nodeCount > 10, `节点数应 > 10, 实际 ${nodeCount}`);
assert(nodeCount <= 2000, '节点数不超上限');

console.log('✅ smoke-fgui-data 全部断言通过');
console.log('  组件:', data.components.map((c) => c.name).join(', '));
console.log('  纹理:', texKeys.map((k) => k + '=' + (data.textures[k] ? path.basename(data.textures[k]) : '缺失')).join(', '));
console.log('  节点总数:', nodeCount, ' 警告:', data.warnings.length ? data.warnings : '无');
