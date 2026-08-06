/* 诊断 1000101.json:验证 getSkeletonBounds 与骨骼姿态 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = 'E:/MyProject/spine_viewer';
const DIR = 'E:/backup/游戏场景/异兽灵境/res/game_100073549/spine_groups/1000101';
const base = '1000101';

const code = fs.readFileSync(path.join(ROOT, 'vendor/spine38/spine-core.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const spine = ctx.spine;

const jsonText = fs.readFileSync(path.join(DIR, base + '.json'), 'utf8');
const atlasText = fs.readFileSync(path.join(DIR, base + '.atlas'), 'utf8');
const pngData = fs.readFileSync(path.join(DIR, base + '.png'));
const pngSizeObj = { width: pngData.readUInt32BE(16), height: pngData.readUInt32BE(20) };

const atlas = new spine.TextureAtlas(atlasText, () => ({
  getImage: () => ({ width: pngSizeObj.width, height: pngSizeObj.height }),
  setFilters: () => {},
  setWraps: () => {},
}));

const loader = new spine.AtlasAttachmentLoader(atlas);
const parser = new spine.SkeletonJson(loader);
let jsonObj = JSON.parse(jsonText);
if (jsonObj.skins && !Array.isArray(jsonObj.skins)) {
  const skins = [];
  for (const skinName of Object.keys(jsonObj.skins)) skins.push({ name: skinName, attachments: jsonObj.skins[skinName] });
  jsonObj.skins = skins;
}
const data = parser.readSkeletonData(jsonObj);

console.log('版本:', data.version, '| fps:', data.fps);
console.log('骨骼:', data.bones.map((b) => b.name + '(' + b.x + ',' + b.y + ')').join(', '));
console.log('动画:', (data.animations || []).map((a) => a.name + '(' + a.duration.toFixed(2) + 's)').join(', '));

const skeleton = new spine.Skeleton(data);
const state = new spine.AnimationState(new spine.AnimationStateData(data));

function calcBounds(label) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const accum = (verts, n) => {
    for (let i = 0; i < n; i += 2) {
      const x = verts[i], y = -verts[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };
  let slotNames = [];
  for (const slot of skeleton.drawOrder) {
    const att = slot.getAttachment();
    if (att instanceof spine.RegionAttachment) {
      const v = new Float32Array(8);
      att.computeWorldVertices(slot.bone, v, 0, 2);
      accum(v, 8);
      slotNames.push(slot.data.name + '(R)');
    } else if (att instanceof spine.MeshAttachment) {
      const v = new Float32Array(att.worldVerticesLength);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
      accum(v, v.length);
      slotNames.push(slot.data.name + '(M)');
    }
  }
  if (!isFinite(minX)) { console.log(label, '=> 无可见 attachment'); return null; }
  const b = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  console.log(label, '=> bounds', JSON.stringify(b), '中心', ((b.x + b.width / 2).toFixed(1)) + ',' + ((b.y + b.height / 2).toFixed(1)));
  console.log('   slots:', slotNames.join(', '));
  return b;
}

// 场景 1:setup pose
skeleton.setToSetupPose();
skeleton.updateWorldTransform();
calcBounds('[setup pose]');

// 场景 2:第一个动画第 0 帧
const anim0 = data.animations[0];
skeleton.setToSetupPose();
state.setAnimation(0, anim0.name, true);
state.apply(skeleton);
skeleton.updateWorldTransform();
calcBounds('[anim0 @t=0] ' + anim0.name);

// 场景 3:第一个动画 t=0.5s
state.update(0.5);
state.apply(skeleton);
skeleton.updateWorldTransform();
calcBounds('[anim0 @t=0.5]');

// 骨头世界坐标
console.log('骨头 world:');
for (const b of skeleton.bones) {
  console.log('  ', b.data.name, 'world=(' + b.worldX.toFixed(1) + ',' + b.worldY.toFixed(1) + ') active=' + b.active);
}
