'use strict';

const fs = require('fs');
const path = require('path');
const { probeSkeleton } = require('./tools/skel');

// 图片 / 音频 / 3D 资源扩展名
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.wma', '.m4a'];
const MODEL_EXTS = ['.glb', '.gltf', '.obj', '.fbx', '.dae', '.stl', '.blend', '.3ds', '.pmx', '.pmd', '.vrm'];

/** 探测 .bin 文件是否为 Spine 二进制骨架(.skel)。只读头部 256 字节,避免整文件读取。 */
function probeBinFile(fp) {
  try {
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    return probeSkeleton(buf.subarray(0, n));
  } catch (err) {
    return null;
  }
}

const FGUI_MAGIC = 0x46475549; // "FGUII"

/** 探测 .bin 是否为 FairyGUI 包(魔数 FGUII)。只读头部 8 字节。 */
function probeFguiBin(fp) {
  try {
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (n < 8) return false;
    return buf.readUInt32BE(0) === FGUI_MAGIC;
  } catch (err) {
    return false;
  }
}

/**
 * 扫描一个目录,识别其中的 Spine / DragonBones 骨骼动画、图片、音频、3D 资源。
 * 返回条目列表:
 * { file, dir, type: 'spine' | 'dragonbones' | 'image' | 'audio' | 'model', base, problems: string[], atlasPath?: string, size?, mtime? }
 */
function scanDir(dir, recursive) {
  const results = [];
  const visited = new Set();

  function statOf(fp) {
    try {
      const s = fs.statSync(fp);
      return { size: s.size, mtime: Math.round(s.mtimeMs) };
    } catch (err) {
      return { size: 0, mtime: 0 };
    }
  }

  function visit(d, depth) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      return;
    }
    const files = entries.filter((e) => e.isFile());
    const subDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

    const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
    const skelFiles = files.filter((f) => f.name.toLowerCase().endsWith('.skel'));

    // ---- Spine 二进制 .skel ----
    for (const sk of skelFiles) {
      const base = sk.name.slice(0, -'.skel'.length);
      const hasAtlas = files.some((f) => f.name.toLowerCase() === (base + '.atlas').toLowerCase());
      const fp = path.join(d, sk.name);
      results.push({
        file: fp,
        dir: d,
        type: 'spine',
        base,
        problems: hasAtlas ? [] : ['缺少同名 .atlas 文件'],
        ...statOf(fp),
      });
    }

    // ---- .bin 格式检测:Spine 二进制骨架(.skel) 或 FairyGUI 包(FGUII) ----
    const binSkelBases = [];
    const fguiFiles = [];
    for (const bf of files) {
      if (!bf.name.toLowerCase().endsWith('.bin')) continue;
      const fp = path.join(d, bf.name);
      // FGUI 包优先(魔数 FGUII)
      if (probeFguiBin(fp)) {
        const base = bf.name.slice(0, -'.bin'.length);
        fguiFiles.push({ fp, base });
        continue;
      }
      const probe = probeBinFile(fp);
      if (!probe || probe.kind !== 'binary') continue;
      const base = bf.name.slice(0, -'.bin'.length);
      const skelName = base + '.skel';
      const skelPath = path.join(d, skelName);
      // 已存在同名 .skel:跳过该 .bin(避免重复条目,也避免覆盖已有骨架)
      const hasSkel = files.some((f) => f.name.toLowerCase() === skelName.toLowerCase());
      if (hasSkel) continue;
      // 重命名 .bin → .skel(只改扩展名,不移动/不覆盖)
      let renamed = false;
      try {
        fs.renameSync(fp, skelPath);
        renamed = true;
      } catch (err) {
        // 改名失败(权限/占用等):仍按 .bin 骨架条目处理,并提示
      }
      const hasAtlas = files.some((f) => f.name.toLowerCase() === (base + '.atlas').toLowerCase());
      binSkelBases.push(base.toLowerCase());
      const probMsg = `已识别为 Spine ${probe.version} 二进制骨架(扩展名 .bin)`;
      results.push({
        file: renamed ? skelPath : fp,
        dir: d,
        type: 'spine',
        base,
        binAsSkel: true,
        problems: renamed
          ? (hasAtlas ? [`${probMsg},已统一改名为 ${skelName} 按骨架处理`] : [`${probMsg},已统一改名为 ${skelName},但缺少同名 .atlas 文件`])
          : (hasAtlas ? [`${probMsg},改名 ${skelName} 失败(权限/占用?),按 .bin 处理`] : [`${probMsg},改名 ${skelName} 失败(权限/占用?),且缺少同名 .atlas 文件`]),
        ...statOf(renamed ? skelPath : fp),
      });
    }

    // ---- FairyGUI 包(.bin 魔数 FGUII) ----
    for (const { fp, base } of fguiFiles) {
      results.push({
        file: fp,
        dir: d,
        type: 'fgui',
        base,
        problems: [],
        ...statOf(fp),
      });
    }

    // ---- JSON 分类(spine json / dragonbones json) ----
    const parsed = new Map();
    for (const jf of jsonFiles) {
      const fp = path.join(d, jf.name);
      let data = null;
      try {
        data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      } catch (err) {
        continue; // 非 JSON
      }
      if (!data || typeof data !== 'object') continue;
      parsed.set(jf.name, data);

      const base = jf.name.replace(/\.json$/i, '');

      // DragonBones: 含 armature 数组
      if (Array.isArray(data.armature) && data.armature.length) {
        const problems = [];
        let atlasPath = null;
        const embedded = Array.isArray(data.textureAtlas) && data.textureAtlas.length > 0;
        if (!embedded) {
          // 查找同目录贴图集 json(含 SubTexture)
          const atlasJson = jsonFiles.find(
            (f) =>
              f.name !== jf.name &&
              /(tex|texture|atlas)/i.test(f.name) &&
              isAtlasJson(path.join(d, f.name))
          );
          if (atlasJson) {
            atlasPath = path.join(d, atlasJson.name);
          } else {
            problems.push('未找到贴图集(需内嵌或同目录 *_tex.json)');
          }
        }
        results.push({ file: fp, dir: d, type: 'dragonbones', base, problems, atlasPath, ...statOf(fp) });
        continue;
      }

      // Spine JSON: 含 skeleton + bones
      if (data.skeleton && Array.isArray(data.bones)) {
        const hasAtlas = files.some((f) => f.name.toLowerCase() === (base + '.atlas').toLowerCase());
        results.push({
          file: fp,
          dir: d,
          type: 'spine',
          base,
          problems: hasAtlas ? [] : ['缺少同名 .atlas 文件'],
          ...statOf(fp),
        });
        continue;
      }
    }

    // ---- 图片资源 ----
    const spineBases = new Set(skelFiles.map((f) => f.name.slice(0, -'.skel'.length).toLowerCase()));
    for (const b of binSkelBases) spineBases.add(b);
    for (const jf of jsonFiles) {
      const base = jf.name.replace(/\.json$/i, '');
      const data = parsed.get(jf.name);
      if (data && ((Array.isArray(data.armature) && data.armature.length) || (data.skeleton && Array.isArray(data.bones)))) {
        spineBases.add(base.toLowerCase());
      }
    }
    // 记录有 .atlas 的骨架基名(其同名 png 是贴图,提示用户确认)
    const atlasBaseNames = new Set(
      files.filter((f) => f.name.toLowerCase().endsWith('.atlas')).map((f) => f.name.slice(0, -'.atlas'.length).toLowerCase())
    );

    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;
      const base = f.name.slice(0, -ext.length);
      const problems = [];
      if (spineBases.has(base.toLowerCase()) || atlasBaseNames.has(base.toLowerCase())) {
        problems.push('可能是动画贴图,请确认');
      }
      const fp = path.join(d, f.name);
      results.push({ file: fp, dir: d, type: 'image', base, problems, ...statOf(fp) });
    }

    // ---- 音频资源 ----
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (!AUDIO_EXTS.includes(ext)) continue;
      const base = f.name.slice(0, -ext.length);
      const fp = path.join(d, f.name);
      results.push({ file: fp, dir: d, type: 'audio', base, problems: [], ...statOf(fp) });
    }

    // ---- 3D 模型资源 ----
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if (!MODEL_EXTS.includes(ext)) continue;
      const base = f.name.slice(0, -ext.length);
      const fp = path.join(d, f.name);
      results.push({ file: fp, dir: d, type: 'model', base, problems: [], ...statOf(fp) });
    }

    // 子目录递归(限制深度,避免意外扫过大量目录)
    if (recursive && depth < 4) {
      for (const sd of subDirs) {
        const p = path.join(d, sd.name);
        if (visited.has(p)) continue;
        visited.add(p);
        visit(p, depth + 1);
      }
    }
  }

  visit(dir, 0);
  return results;
}

function isAtlasJson(fp) {
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return !!(data && Array.isArray(data.SubTexture) && data.SubTexture.length);
  } catch (err) {
    return false;
  }
}

module.exports = { scanDir };
