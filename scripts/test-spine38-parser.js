/* Node 冒烟测试:验证 spine-core 3.8 运行时能解析用户真实 .skel + .atlas */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = 'E:/MyProject/spine_viewer';
const SRC_DIR = 'E:/Download/页游资源/spine';

// ---- 1. 在 vm 上下文加载 spine-core.js ----
const code = fs.readFileSync(path.join(ROOT, 'vendor/spine38/spine-core.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const spine = ctx.spine;
if (!spine) { console.error('FAIL: spine 全局未挂载'); process.exit(1); }
console.log('spine 运行时已加载。');

// ---- 2. 读取 skel/atlas/png ----
const base = '300701';
const skelBuf = new Uint8Array(fs.readFileSync(path.join(SRC_DIR, base + '.skel')));
const atlasText = fs.readFileSync(path.join(SRC_DIR, base + '.atlas'), 'utf8');

// 解析 PNG 头拿宽高(模拟浏览器图片)
function pngSize(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return { width: w, height: h };
}
const pngData = fs.readFileSync(path.join(SRC_DIR, base + '.png'));
const pngSizeObj = pngSize(pngData);

// ---- 3. 构造 TextureAtlas ----
const atlas = new spine.TextureAtlas(atlasText, (p) => ({
  getImage: () => ({ width: pngSizeObj.width, height: pngSizeObj.height }),
  setFilters: () => {},
  setWraps: () => {},
}));
console.log('atlas pages:', atlas.pages.length, 'regions:', atlas.regions.length);

// ---- 4. 解析骨架 ----
const loader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary(loader);
let data;
try {
  data = binary.readSkeletonData(skelBuf);
} catch (e) {
  console.error('FAIL: 解析失败', e.message);
  process.exit(1);
}
console.log('骨架版本:', data.version, '| hash:', data.hash);
console.log('fps:', data.fps);
console.log('骨骼:', data.bones.map((b) => b.name).join(','));
console.log('槽:', data.slots.map((s) => s.name).join(','));
console.log('皮肤:', (data.skins || []).map((s) => s.name).join(','));
console.log('动画:', (data.animations || []).map((a) => a.name + '(' + a.duration.toFixed(2) + 's)').join(', '));

// ---- 5. 创建骨架并应用动画 ----
const skeleton = new spine.Skeleton(data);
const state = new spine.AnimationState(new spine.AnimationStateData(data));
const anim = data.animations[0];
skeleton.setToSetupPose();
state.setAnimation(0, anim.name, true);
state.update(0.1);
state.apply(skeleton);
skeleton.updateWorldTransform();

// ---- 6. 提取顶点验证 ----
let totalVerts = 0, nonZero = 0, regionCount = 0, meshCount = 0, bad = [];
for (const slot of skeleton.drawOrder) {
  const att = slot.getAttachment();
  if (att instanceof spine.RegionAttachment) {
    const v = new Float32Array(8);
    att.computeWorldVertices(slot.bone, v, 0, 2);
    regionCount++;
    totalVerts += 4;
    for (let i = 0; i < 8; i += 2) {
      if (Number.isFinite(v[i]) && Number.isFinite(v[i + 1]) && (Math.abs(v[i]) > 1e-4 || Math.abs(v[i + 1]) > 1e-4)) nonZero++;
      if (!Number.isFinite(v[i]) || !Number.isFinite(v[i + 1])) bad.push('region ' + slot.data.name + ' @' + i);
    }
  } else if (att instanceof spine.MeshAttachment) {
    const n = att.worldVerticesLength;
    const v = new Float32Array(n);
    att.computeWorldVertices(slot, 0, n, v, 0, 2);
    meshCount++;
    totalVerts += n / 2;
    for (let i = 0; i < n; i += 2) {
      if (Number.isFinite(v[i]) && Number.isFinite(v[i + 1]) && (Math.abs(v[i]) > 1e-4 || Math.abs(v[i + 1]) > 1e-4)) nonZero++;
      if (!Number.isFinite(v[i]) || !Number.isFinite(v[i + 1])) bad.push('mesh ' + slot.data.name + ' @' + i);
    }
  }
}
console.log('region 附件:', regionCount, '| mesh 附件:', meshCount, '| 总顶点:', totalVerts, '| 非零顶点:', nonZero);
if (bad.length) { console.error('FAIL: 非法顶点', bad.slice(0, 10)); process.exit(1); }
if (totalVerts === 0) { console.error('FAIL: 无渲染顶点'); process.exit(1); }

// ---- 7. 遍历其余 3 个 skel ----
for (const name of ['300705', '300708', '300712']) {
  try {
    const b = new Uint8Array(fs.readFileSync(path.join(SRC_DIR, name + '.skel')));
    const t = fs.readFileSync(path.join(SRC_DIR, name + '.atlas'), 'utf8');
    const png = fs.readFileSync(path.join(SRC_DIR, name + '.png'));
    const sz = pngSize(png);
    const a = new spine.TextureAtlas(t, () => ({ getImage: () => ({ width: sz.width, height: sz.height }), setFilters: () => {}, setWraps: () => {} }));
    const d = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(a)).readSkeletonData(b);
    console.log('ok', name, '| version:', d.version, '| anims:', (d.animations || []).map((x) => x.name).join(','));
  } catch (e) {
    console.error('FAIL', name, e.message);
    process.exit(1);
  }
}
console.log('ALL PASS');
