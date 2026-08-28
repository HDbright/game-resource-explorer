/**
 * 骨骼动画编辑器 - 动画采样与正向运动学。
 *
 * 坐标系:与 DragonBones 一致(y 向下,rotation 顺时针为正,单位度)。
 * 关键帧按「帧号」存储,时间 = frame / frameRate。
 * 2x3 仿射矩阵约定:x' = a*x + c*y + tx;y' = b*x + d*y + ty。
 */

// ---------------- 缓动 ----------------

const HALF_PI = Math.PI / 2;

function bezierY(t, x1, y1, x2, y2) {
  // 三次贝塞尔:以 x 为自变量,二分求参数 u 再算 y(编辑器精度足够)
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const x = 3 * mid * (1 - mid) * (1 - mid) * x1 + 3 * mid * mid * (1 - mid) * x2 + mid * mid * mid;
    if (x < t) lo = mid; else hi = mid;
  }
  const u = (lo + hi) / 2;
  return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u * u * u;
}

/** 缓动函数:t∈[0,1] → 映射后的进度 */
export function applyEase(ease, t) {
  if (!ease || t <= 0 || t >= 1) return t;
  switch (ease.type) {
    case 'step': return 0;
    case 'sineIn': return 1 - Math.cos(t * HALF_PI);
    case 'sineOut': return Math.sin(t * HALF_PI);
    case 'sineInOut': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'quadIn': return t * t;
    case 'quadOut': return 1 - (1 - t) * (1 - t);
    case 'quadInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'cubicIn': return t * t * t;
    case 'cubicOut': return 1 - Math.pow(1 - t, 3);
    case 'cubicInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'backIn': { const s = 1.70158; return t * t * ((s + 1) * t - s); }
    case 'backOut': { const s = 1.70158; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * (t - 1) * (t - 1); }
    case 'bezier': {
      const p = ease.pts || [0.42, 0, 0.58, 1];
      return bezierY(t, p[0], p[1], p[2], p[3]);
    }
    case 'linear': default: return t;
  }
}

/** 命名缓动 → 贝塞尔控制点(导出 DragonBones curve 用);null 表示线性(数字 0) */
export function easeToBezier(ease) {
  switch (ease && ease.type) {
    case 'sineIn': return [0.12, 0, 0.39, 0];
    case 'sineOut': return [0.61, 1, 0.88, 1];
    case 'sineInOut': case undefined: case null: return [0.37, 0, 0.63, 1];
    case 'quadIn': return [0.11, 0, 0.5, 0];
    case 'quadOut': return [0.5, 1, 0.89, 1];
    case 'quadInOut': return [0.45, 0, 0.55, 1];
    case 'cubicIn': return [0.32, 0, 0.67, 0];
    case 'cubicOut': return [0.33, 1, 0.68, 1];
    case 'cubicInOut': return [0.65, 0, 0.35, 1];
    case 'backIn': return [0.36, 0, 0.66, -0.56];
    case 'backOut': return [0.34, 1.56, 0.64, 1];
    case 'bezier': return (ease.pts || [0.42, 0, 0.58, 1]).slice();
    default: return null;
  }
}

// ---------------- 关键帧通道采样 ----------------

function sortKeys(keys) { return [...keys].sort((a, b) => a.frame - b.frame); }
const lerp = (a, b, t) => a + (b - a) * t;

/** 采样单个通道:extract(key)→number[];mix(a,b,t)→number[];无关键帧返回 null */
export function sampleChannel(keys, frame, extract, mix) {
  if (!keys || !keys.length) return null;
  const ks = sortKeys(keys);
  if (frame < ks[0].frame) return null; // 首键之前保持 setup(Spine/DragonBones 时间线语义)
  const last = ks[ks.length - 1];
  if (frame >= last.frame) return extract(last);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (frame >= a.frame && frame < b.frame) {
      const span = b.frame - a.frame || 1;
      const t = applyEase(a.ease, (frame - a.frame) / span);
      return mix(extract(a), extract(b), t);
    }
  }
  return extract(last);
}

/**
 * 采样动画在指定帧的姿态。
 * 返回 { bones: {name:{x?,y?,rotation?,scaleX?,scaleY?}}, slots: {name:{r?,g?,b?,a?,displayIndex?}} }
 * 只含有_keyframe 的通道,其余由绑定姿势回退(bonePose)。
 */
export function sampleAnimation(anim, frame) {
  const out = { bones: {}, slots: {} };
  if (!anim) return out;
  for (const [boneName, ch] of Object.entries(anim.bones || {})) {
    const o = {};
    const tr = sampleChannel(ch.translate, frame, (k) => [k.v.x, k.v.y], (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    if (tr) { o.x = tr[0]; o.y = tr[1]; }
    // 旋转通道:按「最短角度差」插值(与 spine 官方 RotateTimeline 一致:
    // 差值 wrap 到 ±180°,如 -320.57->-23.74 实走 -63.17° 短路径,而非 +296.83° 长路径)
    const ro = sampleChannel(ch.rotate, frame, (k) => [k.v.rotation], (a, b, t) => [a[0] + angleDelta(b[0], a[0]) * t]);
    if (ro) o.rotation = ro[0];
    const sc = sampleChannel(ch.scale, frame, (k) => [k.v.scaleX, k.v.scaleY], (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    if (sc) { o.scaleX = sc[0]; o.scaleY = sc[1]; }
    const sh = sampleChannel(ch.shear, frame, (k) => [k.v.shearX || 0, k.v.shearY || 0], (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
    if (sh) { o.shearX = sh[0]; o.shearY = sh[1]; }
    if (Object.keys(o).length) out.bones[boneName] = o;
  }
  for (const [slotName, ch] of Object.entries(anim.slots || {})) {
    const o = {};
    const co = sampleChannel(ch.color, frame, (k) => [k.v.r, k.v.g, k.v.b, k.v.a], (a, b, t) => a.map((x, i) => lerp(x, b[i], t)));
    if (co) { o.r = co[0]; o.g = co[1]; o.b = co[2]; o.a = co[3]; }
    const di = sampleChannel(ch.display, frame, (k) => [k.v.displayIndex], (a, b, t) => [t < 1 ? a[0] : b[0]]);
    if (di) o.displayIndex = Math.round(di[0]);
    if (Object.keys(o).length) out.slots[slotName] = o;
  }
  return out;
}

// ---------------- 正向运动学 ----------------

const IDENT = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function mul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  };
}

/**
 * 计算所有骨骼的世界矩阵。
 * poseOverrides: sampleAnimation 的 bones 部分(可为 null,即绑定姿势)。
 * 返回 Map<boneName, {…矩阵, rotation(rad), scaleX, scaleY, bone}>
 */
export function computeWorldTransforms(project, poseOverrides, setupOverrides) {
  const result = new Map();
  const bones = project.armature.bones;
  const byName = new Map(bones.map((b) => [b.name, b]));

  const compute = (bone) => {
    const hit = result.get(bone.name);
    if (hit) return hit;
    const ov = poseOverrides && poseOverrides[bone.name];
    const co = setupOverrides && setupOverrides[bone.name]; // 补偿覆盖层(编辑器预览,不入存档)
    const pick = (k, dflt) => co && co[k] !== undefined ? co[k] : ov && ov[k] !== undefined ? ov[k] : dflt;
    const pose = {
      x: pick('x', bone.x),
      y: pick('y', bone.y),
      rotation: pick('rotation', bone.rotation),
      scaleX: pick('scaleX', bone.scaleX),
      scaleY: pick('scaleY', bone.scaleY),
      shearX: pick('shearX', bone.shearX || 0),
      shearY: pick('shearY', bone.shearY || 0),
    };
    const rad = (pose.rotation * Math.PI) / 180;
    const shx = (pose.shearX * Math.PI) / 180;
    const shy = (pose.shearY * Math.PI) / 180;
    // L = T(x,y) · R(rot) · Shear(shx,shy) · S(scale)  (Spine 标准公式)
    const la = Math.cos(rad + shx) * pose.scaleX;
    const lb = Math.sin(rad + shx) * pose.scaleX;
    const lc = -Math.sin(rad - shy) * pose.scaleY;
    const ld = Math.cos(rad - shy) * pose.scaleY;
    const L = { a: la, b: lb, c: lc, d: ld, tx: pose.x, ty: pose.y };
    const parent = bone.parent ? byName.get(bone.parent) : null;
    let m;
    if (!parent) {
      m = L;
    } else {
      const pw = compute(parent);
      const inhT = bone.inheritTranslation !== false;
      const inhR = bone.inheritRotation !== false;
      const inhS = bone.inheritScale !== false;
      if (inhT && inhR && inhS) {
        m = mul(pw, L); // 常规路径:父矩阵 × 局部矩阵
      } else {
        // 分解父矩阵:平移/旋转/缩放,按继承开关重建(编辑器近似,覆盖常用组合)
        const pr = Math.atan2(pw.b, pw.a);
        const psx = Math.hypot(pw.a, pw.b) || 1;
        const psy = Math.hypot(pw.c, pw.d) || 1;
        const effRot = inhR ? pr : 0;
        const c2 = Math.cos(effRot), s2 = Math.sin(effRot);
        const sx = inhS ? psx : 1, sy = inhS ? psy : 1;
        const P = { a: c2 * sx, b: s2 * sx, c: -s2 * sy, d: c2 * sy, tx: inhT ? pw.tx : 0, ty: inhT ? pw.ty : 0 };
        m = mul(P, L);
      }
    }
    const w = { ...m, rotation: Math.atan2(m.b, m.a), scaleX: pose.scaleX, scaleY: pose.scaleY, bone };
    result.set(bone.name, w);
    return w;
  };

  for (const b of bones) compute(b);
  return result;
}

/** 骨骼尖端世界坐标(length 方向);RT 路径优先用 localToWorld 真值(tipX/tipY) */
export function boneTipWorld(world, bone) {
  if (Number.isFinite(world.tipX) && Number.isFinite(world.tipY)) return { x: world.tipX, y: world.tipY };
  const len = bone.length || 0;
  return { x: world.tx + world.a * len, y: world.ty + world.b * len };
}

/** 世界点 → 父矩阵局部坐标(拖拽骨骼关节时求解新的局部 x/y) */
export function worldToParentLocal(parentWorld, gx, gy) {
  const pw = parentWorld || IDENT;
  const det = pw.a * pw.d - pw.b * pw.c || 1e-9;
  const dx = gx - pw.tx, dy = gy - pw.ty;
  return { x: (pw.d * dx - pw.c * dy) / det, y: (pw.a * dy - pw.b * dx) / det };
}

/** 两角度差(度),归一到 (-180,180] */
export function angleDelta(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
