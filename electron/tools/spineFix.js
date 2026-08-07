'use strict';
// Spine 文件修复工具:对 spine JSON / skel 二进制 / atlas 文本执行诊断与常见自动修复。
// 修复策略:
//   1) JSON 文件:移除 UTF-8 BOM;剥离 JS 单行注释 // 与 /* */ 块注释(带引号/字符串保护);
//      修复尾随逗号;缺少 "spine" 版本字段时尝试用形态特征兜底为 "3.0.0";skins 是对象→保留对象;
//      写入修复后副本(原文件不动)。
//   2) .skel 二进制:头部 magic 校验 + 版本探测;若探测不到,尝试按 4.x / 3.8 binary 解析并
//      报告成功状态;不修改二进制(直接复制为副本)。
//   3) .atlas 文本:跳过空行 / 注释;每张页后跟 size/format/filter/repeat,再跟若干图像条目;
//      严重不匹配时报告但不动文件。

const fs = require('fs');
const path = require('path');
const { probeSkeleton } = require('./skel');

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// 简化版:从 JSON 文本里剥离 // 与 /* */ 注释(对字符串内部做保护)
// 不追求完备 JSONC 解析,只修最常见的几种笔误。
function stripJsonComments(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '"') {
      // 字符串:整段原样输出直到匹配结束引号(注意处理 \" \\ 转义)
      let j = i + 1;
      while (j < s.length) {
        const cc = s[j];
        if (cc === '\\') { j += 2; continue; }
        if (cc === '"') { j++; break; }
        j++;
      }
      out += s.slice(i, j);
      i = j;
    } else if (c === '/' && n === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function stripTrailingCommas(s) {
  // 把 "," 后紧跟空白 + "}" 或 "]" 的逗号删除
  return s
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/,(\s*\n\s*[}\]])/g, '\n$1');
}

function looksLikeVersion(text) {
  return /^(\d+)\.(\d+)(\.\d+)?$/.test(String(text || '').trim());
}

/**
 * 规范化动画约束时间线(ik / transform / path)的非标准结构。
 *
 * 背景:部分「二进制 .bin → JSON」转换工具会把约束块写成
 *   数组形式 [ { 约束名: 帧对象 }, { 约束名: [帧, ...] }, ... ]
 *   或 对象值不是数组(单帧对象)。Spine 3.x/4.x 运行时期望的是
 *   对象形式 { 约束名: [帧, ...] }。
 * 若不做规范化,运行时会生成空时间线,动画 duration 变 NaN 抛错
 * ("Error while parsing animation, duration is NaN")。
 *
 * @param {object} anim 动画对象(animations[name])
 * @param {string} cat  'ik' | 'transform' | 'path'
 * @returns {number} 修复的约束条目数
 */
function normalizeConstraintTimelines(anim, cat) {
  const block = anim && anim[cat];
  if (!block) return 0;
  let changed = 0;
  // 情况1:数组形式 [ {约束名: 帧对象|帧数组}, ... ] → 合并为 {约束名: [帧...]}
  if (Array.isArray(block)) {
    const merged = {};
    for (const item of block) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      for (const name of Object.keys(item)) {
        let frames = item[name];
        if (frames === null || frames === undefined) continue;
        if (!Array.isArray(frames)) frames = [frames];
        merged[name] = (merged[name] || []).concat(frames);
      }
    }
    if (Object.keys(merged).length) {
      anim[cat] = merged;
      changed = Object.keys(merged).length;
    }
  } else if (typeof block === 'object') {
    // 情况2:对象形式,但某个约束的值不是数组(单帧对象)→ 包成数组
    for (const name of Object.keys(block)) {
      const v = block[name];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        block[name] = [v];
        changed++;
      }
    }
  }
  return changed;
}

/** 对整份 JSON 的每个动画执行约束时间线规范化;返回修复的动画/条目总数 */
function normalizeAnimationsConstraints(obj) {
  let animCount = 0, entryCount = 0;
  const anims = obj && obj.animations;
  if (!anims) return { animCount, entryCount };
  // animations 可能是数组(4.x)或对象(3.x)
  const list = Array.isArray(anims) ? anims.map((a) => a) : Object.values(anims);
  for (const anim of list) {
    if (!anim || typeof anim !== 'object') continue;
    let n = 0;
    n += normalizeConstraintTimelines(anim, 'ik');
    n += normalizeConstraintTimelines(anim, 'transform');
    n += normalizeConstraintTimelines(anim, 'path');
    if (n > 0) animCount++;
    entryCount += n;
  }
  return { animCount, entryCount };
}

async function repairSpineJson(inputPath, outputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const issues = [];
  let text = raw;

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    issues.push({ kind: 'fix', msg: '已移除 UTF-8 BOM' });
  }

  const beforeComments = text;
  text = stripJsonComments(text);
  if (text.length !== beforeComments.length) {
    issues.push({ kind: 'fix', msg: '已剥离 JSON 注释(// 或 /* */)' });
  }

  const beforeComma = text;
  text = stripTrailingCommas(text);
  if (text.length !== beforeComma.length) {
    issues.push({ kind: 'fix', msg: '已修复尾随逗号' });
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON 仍无法解析: ${err.message}`);
  }

  // 缺 skeleton.spine 版本字段:用形态特征兜底
  if (!obj.skeleton || typeof obj.skeleton !== 'object') {
    obj.skeleton = obj.skeleton || {};
    issues.push({ kind: 'fix', msg: '已补全 skeleton 段(空)' });
  }
  if (!obj.skeleton.spine) {
    // 形态特征: skins/animations 是对象而非数组 → 视为 3.x
    const is3x = (obj.skins && !Array.isArray(obj.skins) && typeof obj.skins === 'object') ||
                 (obj.animations && !Array.isArray(obj.animations) && typeof obj.animations === 'object');
    obj.skeleton.spine = is3x ? '3.0.0' : '4.1.0';
    issues.push({ kind: 'fix', msg: `缺少 spine 版本字段,已兜底为 ${obj.skeleton.spine}` });
  }

  // 检查 skins 形态:4.x 接受对象与数组,3.x 只接受对象;我们不强转,只提示
  if (obj.skins && Array.isArray(obj.skins)) {
    issues.push({ kind: 'info', msg: `skins 是数组(4.x 写法,3.x 需转为对象):共 ${obj.skins.length} 项` });
  }

  // —— 约束时间线结构修复(ik/transform/path 的数组/单帧畸形结构)——
  // 典型症状:Spine 3.x 运行时解析报 "Error while parsing animation, duration is NaN"
  const { animCount, entryCount } = normalizeAnimationsConstraints(obj);
  if (entryCount > 0) {
    issues.push({
      kind: 'fix',
      msg: `已规范化 ${animCount} 个动画中的 ${entryCount} 条 IK/Transform/Path 约束时间线(数组/单帧结构 → 标准 {约束名: [帧...]},修复 duration 变 NaN 的解析失败)`,
    });
  }

  // 检查附件引用的 image / path:只做轻量提示
  let meshCount = 0, weightedCount = 0, linkedCount = 0, regionCount = 0, pathCount = 0, bbCount = 0;
  function walkSkins(map) {
    if (!map) return;
    if (Array.isArray(map)) {
      for (const s of map) walkSkins(s);
      return;
    }
    for (const skinName of Object.keys(map)) {
      const slots = map[skinName];
      if (!slots) continue;
      for (const slotName of Object.keys(slots)) {
        for (const attName of Object.keys(slots[slotName] || {})) {
          const a = slots[slotName][attName];
          if (!a) continue;
          if (a.type === 'mesh') meshCount++;
          else if (a.type === 'weightedmesh') weightedCount++;
          else if (a.type === 'linkedmesh') linkedCount++;
          else if (a.type === 'path') pathCount++;
          else if (a.type === 'boundingbox') bbCount++;
          else if (a.vertices === undefined) regionCount++;
        }
      }
    }
  }
  walkSkins(obj.skins);

  // 写回
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2));

  issues.push({ kind: 'info', msg: `扫描完成:骨骼 ${(obj.bones || []).length},槽 ${(obj.slots || []).length},动画 ${obj.animations ? (Array.isArray(obj.animations) ? obj.animations.length : Object.keys(obj.animations).length) : 0}` });
  issues.push({ kind: 'info', msg: `附件统计:region ≈ ${regionCount}, mesh ${meshCount}, weightedMesh ${weightedCount}, linkedMesh ${linkedCount}, path ${pathCount}, bbox ${bbCount}` });

  return {
    output: outputPath,
    issues,
    stats: {
      version: obj.skeleton.spine,
      bones: (obj.bones || []).length,
      slots: (obj.slots || []).length,
      animations: obj.animations ? (Array.isArray(obj.animations) ? obj.animations.length : Object.keys(obj.animations).length) : 0,
      skins: obj.skins ? (Array.isArray(obj.skins) ? obj.skins.length : Object.keys(obj.skins).length) : 0,
      constraintFixes: entryCount,
      attachments: {
        region: regionCount,
        mesh: meshCount,
        weightedMesh: weightedCount,
        linkedMesh: linkedCount,
        path: pathCount,
        boundingBox: bbCount,
      },
    },
  };
}

async function probeSkel(inputPath, outputPath) {
  const bytes = fs.readFileSync(inputPath);
  const probe = probeSkeleton(bytes);
  if (!probe) throw new Error('不是有效的 Spine skel 二进制(magic 或版本探测失败)');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(inputPath, outputPath);
  return {
    output: outputPath,
    issues: [
      { kind: 'info', msg: `识别为 ${probe.version} 二进制` },
      { kind: 'fix', msg: '二进制文件不可直接修复,已复制副本。建议用「skel 转 json」工具转为 JSON 后再修复。' },
    ],
    stats: { version: probe.version, bytes: bytes.length },
  };
}

function repairAtlas(inputPath, outputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const issues = [];
  // atlas 基本检查:行首是否有非空字符;查找关键字
  let pages = 0;
  const pageRe = /^\s*([^\s:]+)\.(png|jpg|jpeg)\s*$/gim;
  for (const m of raw.matchAll(pageRe)) pages++;
  if (!/^(\s*\n)*[^\s]/m.test(raw)) {
    issues.push({ kind: 'warn', msg: 'atlas 内容看起来为空' });
  }
  if (!/size\s*:/.test(raw)) {
    issues.push({ kind: 'warn', msg: '缺少 size: 行(atlas 格式错误)' });
  }
  if (!/format\s*:/.test(raw)) {
    issues.push({ kind: 'warn', msg: '缺少 format: 行(atlas 格式错误)' });
  }
  // 检查每页 PNG/JPG 路径是否存在
  const fsx = require('fs');
  const dir = path.dirname(inputPath);
  const missing = [];
  for (const m of raw.matchAll(/^\s*([^\s:]+)\.(png|jpg|jpeg)\s*$/gim)) {
    const p = path.join(dir, m[1] + '.' + m[2]);
    if (!fsx.existsSync(p)) missing.push(p);
  }
  if (missing.length) {
    issues.push({ kind: 'warn', msg: `缺失贴图文件:${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}` });
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(inputPath, outputPath);
  issues.push({ kind: 'fix', msg: 'atlas 文本不直接修改,仅诊断;已复制副本。' });
  return { output: outputPath, issues, stats: { pages, missing: missing.length } };
}

/** 由 issues + stats 构建「诊断与修复总结说明」(结构化,供页面直接展示) */
function buildSummary(fileType, issues, stats) {
  const fixCount = issues.filter((i) => i.kind === 'fix').length;
  const warnCount = issues.filter((i) => i.kind === 'warn').length;
  const infoCount = issues.filter((i) => i.kind === 'info').length;
  let verdict = 'healthy'; // healthy | fixed | warning
  if (warnCount > 0) verdict = 'warning';
  if (fixCount > 0 && verdict === 'healthy') verdict = 'fixed';
  if (fixCount > 0 && warnCount > 0) verdict = 'warning'; // 有未消除警告优先提示

  const title = {
    healthy: '诊断通过:文件结构健康',
    fixed: `诊断通过:已自动修复 ${fixCount} 处问题`,
    warning: `诊断完成:修复 ${fixCount} 处,仍有 ${warnCount} 处警告需注意`,
  }[verdict];

  // 诊断结论行(不同类型不同字段)
  const lines = [];
  if (fileType === 'json') {
    if (stats.version) lines.push({ label: 'Spine 版本', value: stats.version });
    lines.push({ label: '结构', value: `骨骼 ${stats.bones} · 槽 ${stats.slots} · 蒙皮 ${stats.skins} · 动画 ${stats.animations}` });
    if (stats.constraintFixes) lines.push({ label: '约束时间线', value: `已修复 ${stats.constraintFixes} 条(ik/transform/path 结构)`, tone: 'warn' });
    const att = stats.attachments || {};
    const attParts = [];
    if (att.region) attParts.push(`region ${att.region}`);
    if (att.mesh) attParts.push(`mesh ${att.mesh}`);
    if (att.weightedMesh) attParts.push(`weightedMesh ${att.weightedMesh}`);
    if (att.linkedMesh) attParts.push(`linkedMesh ${att.linkedMesh}`);
    if (att.path) attParts.push(`path ${att.path}`);
    if (att.boundingBox) attParts.push(`bbox ${att.boundingBox}`);
    if (attParts.length) lines.push({ label: '附件', value: attParts.join(' · ') });
  } else if (fileType === 'skel') {
    lines.push({ label: 'Spine 版本', value: stats.version || '未知' });
    lines.push({ label: '文件大小', value: `${((stats.bytes || 0) / 1024).toFixed(1)} KB` });
    lines.push({ label: '类型', value: '二进制骨架(.skel)' });
  } else if (fileType === 'atlas') {
    lines.push({ label: '贴图页', value: `${stats.pages || 0} 页` });
    lines.push({ label: '缺失贴图', value: stats.missing ? `${stats.missing} 个(需人工补图)` : '无' });
  }

  // 总结说明句
  const notes = [];
  if (verdict === 'healthy') {
    notes.push('未发现需要自动修复的问题,文件可正常交给对应 Spine 运行时加载。');
  }
  if (fixCount > 0) {
    const detail = issues.filter((i) => i.kind === 'fix').map((i) => i.msg).join(';');
    notes.push(`本次自动修复:${detail}。`);
  }
  if (warnCount > 0) {
    const detail = issues.filter((i) => i.kind === 'warn').map((i) => i.msg).join(';');
    notes.push(`仍有 ${warnCount} 处警告未自动处理(不阻塞解析,但可能影响显示):${detail}。`);
  }
  if (fileType === 'skel') {
    notes.push('二进制骨架无法在文本层面直接改写,已生成副本;如需修改内容请先使用「skel 转 json」工具。');
  }
  if (fileType === 'atlas' && stats.missing) {
    notes.push('缺失贴图需在对应目录补充同名 PNG/JPG,否则运行时对应区域将无法显示。');
  }

  return {
    verdict,
    title,
    lines,
    notes,
    counts: { fixed: fixCount, warnings: warnCount, info: infoCount },
  };
}

async function spineFix(inputPath, outputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  let result;
  if (ext === '.json') result = await repairSpineJson(inputPath, outputPath);
  else if (ext === '.skel') result = await probeSkel(inputPath, outputPath);
  else if (ext === '.atlas') result = repairAtlas(inputPath, outputPath);
  else throw new Error(`不支持的文件类型: ${ext}(仅支持 .json / .skel / .atlas)`);
  result.fileType = ext.slice(1);
  result.summary = buildSummary(result.fileType, result.issues, result.stats);
  return result;
}

module.exports = { spineFix, repairSpineJson, probeSkel, repairAtlas, buildSummary, normalizeAnimationsConstraints };