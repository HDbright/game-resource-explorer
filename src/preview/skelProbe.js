/**
 * Spine 骨架文件版本探测(移植自 spineviewer-love 的 sl_skeleton_probe.cpp)。
 *
 * 识别三种布局:
 *  - JSON:      {"skeleton": {"spine": "3.8.99", ...}, ...}
 *  - binary#1:  int64 hash(8字节) + varint version   → Spine 4.x
 *  - binary#2:  varint字符串 hash + varint字符串 version → Spine 3.x(3.4~3.8)
 *
 * 返回: { kind: 'json' | 'binary', version: string } 或 null
 */

function looksLikeVersion(text) {
  if (!text || text.length === 0 || text.length > 31) return false;
  let hasDot = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 46 /* '.' */) {
      hasDot = true;
      continue;
    }
    if (c < 48 || c > 57 /* 非数字 */) return false;
  }
  const first = text.charCodeAt(0);
  return hasDot && first >= 48 && first <= 57;
}

function tryJsonProbe(bytes) {
  // 跳过 BOM 与空白
  let pos = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) pos = 3;
  while (pos < bytes.length) {
    const c = bytes[pos];
    if (c === 32 || c === 13 || c === 10 || c === 9) pos++;
    else break;
  }
  if (pos >= bytes.length || bytes[pos] !== 0x7b /* '{' */) return null;

  let text;
  try {
    text = new TextDecoder('utf-8').decode(bytes);
  } catch (err) {
    return null;
  }
  // 在 skeleton 对象内查找 spine 版本字段
  const m = /"skeleton"\s*:\s*\{[\s\S]*?"spine"\s*:\s*"([^"]+)"/.exec(text);
  if (m && looksLikeVersion(m[1])) return { kind: 'json', version: m[1] };

  // 3.x 编辑器导出的旧版 JSON 可能没有 "spine" 版本字段(只填 hash/name/width/height/fps)。
  // 此时用形态特征兜底识别:
  //   - 顶层包含 bones/slots/skins/animations(events 可选)
  //   - skins 是对象 {skinName: {slotName: {...}}} —— 3.x 写法;4.x 写为数组 [{name, attachments}]
  //   - animations 是对象 {animName: timeline} —— 3.x 写法;4.x 写为数组
  // 这种情况视为 Spine 3.x(以 3.0 标记,通过 isLegacy 走 3.8 运行时)
  const looksLike3xJson = (() => {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object') return false;
      if (!Array.isArray(obj.bones) || !Array.isArray(obj.slots)) return false;
      const skins = obj.skins;
      const anims = obj.animations;
      // 3.x 特征:skins/animations 至少一个是对象(非数组)
      const skinsObj = skins && !Array.isArray(skins) && typeof skins === 'object';
      const animsObj = anims && !Array.isArray(anims) && typeof anims === 'object';
      return skinsObj || animsObj;
    } catch (e) {
      return false;
    }
  })();
  if (looksLike3xJson) return { kind: 'json', version: '3.0.0' };

  return null;
}

function readVarint(bytes, pos) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (pos >= bytes.length) return null;
    const b = bytes[pos++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, nextPos: pos };
  }
  return null;
}

/** 读取 spine 二进制字符串:varint 长度(+1 编码) + 字节 */
function readSpineBinaryString(bytes, pos) {
  const len = readVarint(bytes, pos);
  if (!len) return null;
  const encodedLength = len.value;
  if (encodedLength === 0) return null;
  const byteLength = encodedLength - 1;
  if (byteLength > 512 || len.nextPos + byteLength > bytes.length) return null;
  let text = '';
  for (let i = 0; i < byteLength; i++) {
    text += String.fromCharCode(bytes[len.nextPos + i]);
  }
  return { text, nextPos: len.nextPos + byteLength };
}

function tryBinaryProbeAfterFixedHash(bytes) {
  if (bytes.length < 10) return null;
  const ver = readSpineBinaryString(bytes, 8);
  if (!ver || !looksLikeVersion(ver.text)) return null;
  return { kind: 'binary', version: ver.text };
}

function tryBinaryProbeAfterStringHash(bytes) {
  const hash = readSpineBinaryString(bytes, 0);
  if (!hash) return null;
  const ver = readSpineBinaryString(bytes, hash.nextPos);
  if (!ver || !looksLikeVersion(ver.text)) return null;
  return { kind: 'binary', version: ver.text };
}

export function probeSkeleton(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const json = tryJsonProbe(bytes);
  if (json) return json;
  const fixed = tryBinaryProbeAfterFixedHash(bytes);
  if (fixed) return fixed;
  return tryBinaryProbeAfterStringHash(bytes);
}

/** 是否是 3.x 旧版二进制(需要 3.8 运行时) */
export function isLegacyBinary(probe) {
  return !!(probe && probe.kind === 'binary' && /^3\./.test(probe.version));
}

/**
 * 是否是需要 3.8 运行时的旧版资源:3.x 版本,JSON 或二进制都算。
 * 3.x JSON 经 spine-core 4.x 解析时,mesh/path/linkedMesh 渲染链路有兼容缺陷
 * (花瓣 mesh 不渲染),统一交给 3.8 运行时解析渲染更可靠。
 */
export function isLegacy(probe) {
  return !!(probe && /^3\./.test(probe.version));
}

/** 是否是需要 4.x 运行时的二进制 */
export function isModernBinary(probe) {
  return !!(probe && probe.kind === 'binary' && /^(4|5|2[0-9])\./.test(probe.version));
}
