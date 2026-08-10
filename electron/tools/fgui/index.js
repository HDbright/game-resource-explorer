'use strict';
/** FGUI 逆向工具对外 API: 探测 / 单文件解析 / 目录批量导出 / 源工程还原 */
const fs = require('fs');
const path = require('path');
const { ByteBuffer } = require('./byteBuffer');
const { parsePackage } = require('./parser');
const { buildOutputs } = require('./xml');
const { restoreSource } = require('./restoreSource');

const MAGIC = 0x46475549; // "FGUII"

/** 探测 Buffer 是否为 FGUI 包 */
function probeFgui(data) {
  if (!data || data.length < 8) return false;
  return data.readUInt32BE(0) === MAGIC;
}

/** 解析单个 .bin 文件 → { pkg(结构树), packageXml, componentXmls } */
function parseFile(filePath, opts = {}) {
  const data = fs.readFileSync(filePath);
  if (!probeFgui(data)) {
    throw new Error('不是 FGUI 包 (magic 不匹配): ' + filePath);
  }
  const buf = new ByteBuffer(data);
  const pkg = parsePackage(filePath, buf);
  const outputs = buildOutputs(pkg);
  return { pkg, ...outputs };
}

/** 解析目录下所有 .bin(不递归), 返回结果列表 */
function parseDir(dir, opts = {}) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.bin'))
    .sort();
  const out = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      out.push({ file: fp, ...parseFile(fp) });
    } catch (e) {
      out.push({ file: fp, error: e.message });
    }
  }
  return out;
}

/**
 * 批量导出: 目录下所有 .bin → 输出目录
 * 每个包生成: <base>.json, <base>.xml, 以及每个组件 <base>_<comp>.xml
 * 保持与 Python 版 save_outputs 完全一致的命名与内容。
 * 返回 { ok, total, failed, errors: [{file, error}], outDir }
 */
function batchExport(inputDir, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(inputDir)
    .filter((f) => f.toLowerCase().endsWith('.bin'))
    .sort();
  const errors = [];
  let total = 0;
  let failed = 0;
  for (const f of files) {
    const base = f.replace(/\.bin$/i, '');
    const src = path.join(inputDir, f);
    try {
      const { pkg, packageXml, componentXmls } = parseFile(src);
      // JSON: 不含 rawById
      const info = JSON.parse(JSON.stringify(pkg));
      delete info.rawById;
      fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify(info, null, 2), 'utf8');
      fs.writeFileSync(path.join(outDir, base + '.xml'), packageXml, 'utf8');
      for (const c of componentXmls) {
        fs.writeFileSync(path.join(outDir, base + '_' + c.name + '.xml'), c.xml, 'utf8');
      }
      total++;
    } catch (e) {
      failed++;
      errors.push({ file: f, error: e.message });
    }
  }
  return { ok: true, total, failed, errors, outDir };
}

/**
 * 单文件导出: 一个 .bin → 输出目录
 * 生成: <base>.json, <base>.xml, 以及每个组件 <base>_<comp>.xml
 * 返回 { ok, base, outDir, ownAtlasKeys, deps }
 *   ownAtlasKeys: 本包图集 key 列表(形如 `${pkgName}_${atlasId}`, 供解压时只复制本包切图)
 *   deps: 依赖包名列表(供 UI 提示需一并解压的包)
 */
function exportFile(inputFile, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(inputFile).replace(/\.bin$/i, '');
  const { pkg, packageXml, componentXmls } = parseFile(inputFile);
  const info = JSON.parse(JSON.stringify(pkg));
  delete info.rawById;
  fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify(info, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, base + '.xml'), packageXml, 'utf8');
  for (const c of componentXmls) {
    fs.writeFileSync(path.join(outDir, base + '_' + c.name + '.xml'), c.xml, 'utf8');
  }
  const ownAtlasKeys = (pkg.items || [])
    .filter((it) => it.type === 'Atlas')
    .map((it) => `${pkg.name}_${String(it.file || (it.id + '.png')).replace(/\.png$/i, '')}`);
  const deps = (pkg.deps || []).map((d) => d.name);
  return { ok: true, base, outDir, ownAtlasKeys, deps };
}

/** 还原为 FairyGUI 源工程包目录(完整可被编辑器打开的包) */
function restoreSourcePkg(inputFile, outDir, opts = {}) {
  return restoreSource(inputFile, outDir, opts);
}

/** 递归查找包目录下的 <组件名>.xml */
function findCompXml(pkgDir, compName) {
  const name = String(compName || '').replace(/\.xml$/i, '');
  const stack = [pkgDir];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const en of entries) {
      const full = path.join(dir, en.name);
      if (en.isDirectory()) {
        if (!seen.has(full)) { seen.add(full); stack.push(full); }
      } else if (en.isFile() && /\.xml$/i.test(en.name)) {
        const base = en.name.replace(/\.xml$/i, '');
        if (base === name) return full;
      }
    }
  }
  return null;
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const r2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);

/**
 * 将编辑器中的节点属性修改写回 FGUI_src/<包名>/<组件名>.xml 的 displayList。
 * 节点按 XML id 匹配; 属性名遵循源工程 XML: xy/size/scale/rotation/alpha/visible。
 * @param {string} inputFile .bin 绝对路径
 * @param {string} compName 组件名(资源名)
 * @param {Array<{id,x,y,width,height,rotation,alpha,visible,scaleX,scaleY}>} nodes
 */
function saveSourceEdits(inputFile, compName, nodes) {
  if (!inputFile || !Array.isArray(nodes) || !nodes.length) {
    return { ok: false, error: '参数不足' };
  }
  const pkgName = (path.basename(inputFile) || '').replace(/\.bin$/i, '') || '未命名';
  const srcDir = path.dirname(inputFile);
  const srcRoot = path.join(srcDir, 'FGUI_src');
  const pkgDir = path.join(srcRoot, pkgName);
  // 源工程不存在 → 先自动还原
  if (!fs.existsSync(path.join(pkgDir, 'package.xml'))) {
    const r = restoreSource(inputFile, srcRoot);
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '源工程还原失败' };
  }
  const target = findCompXml(pkgDir, compName);
  if (!target) return { ok: false, error: `未找到组件 ${compName}.xml` };
  let xml;
  try { xml = fs.readFileSync(target, 'utf8'); } catch (e) { return { ok: false, error: '读取组件 XML 失败: ' + e.message }; }

  let updated = 0;
  for (const nd of nodes) {
    if (!nd || nd.id == null) continue;
    // id 变更: 全局替换引号包裹的完整 token(节点自身 id + 所有引用它的地方:
    // relations target / controller action objectId / transition item target / group 等)
    if (nd.newId && nd.newId !== nd.id) {
      xml = xml.split(`"${nd.id}"`).join(`"${nd.newId}"`);
    }
    const matchId = nd.newId && nd.newId !== nd.id ? nd.newId : nd.id;
    const idRe = new RegExp(`(<[a-zA-Z0-9_]+\\b[^>]*\\bid="${escRe(matchId)}"[^>]*>)`);
    if (!idRe.test(xml)) continue;
    xml = xml.replace(idRe, (tag) => {
      let s = tag;
      const attrs = {};
      if (nd.x != null && nd.y != null) attrs.xy = `${r2(nd.x)},${r2(nd.y)}`;
      if (nd.width != null && nd.height != null) attrs.size = `${r2(nd.width)},${r2(nd.height)}`;
      if (nd.rotation != null) attrs.rotation = String(r2(nd.rotation));
      if (nd.alpha != null) attrs.alpha = String(r2(nd.alpha));
      if (nd.visible != null) attrs.visible = nd.visible ? 'true' : 'false';
      if (nd.scaleX != null) {
        const sy = nd.scaleY != null ? nd.scaleY : nd.scaleX;
        attrs.scale = `${r2(nd.scaleX)},${r2(sy)}`;
      }
      if (nd.name != null) attrs.name = String(nd.name);
      for (const [k, v] of Object.entries(attrs)) {
        const kv = `${k}="${v}"`;
        const attrRe = new RegExp(`\\b${k}="[^"]*"`);
        if (attrRe.test(s)) s = s.replace(attrRe, kv);
        else if (/\/>$/.test(s)) s = s.replace(/\/>$/, ` ${kv}/>`);
        else if (/>$/.test(s)) s = s.replace(/>$/, ` ${kv}>`);
      }
      return s;
    });
    updated++;
  }
  if (!updated) return { ok: true, file: target, updated: 0, warning: '没有可更新的节点(id 未匹配)' };
  try { fs.writeFileSync(target, xml, 'utf8'); } catch (e) { return { ok: false, error: '写入失败: ' + e.message }; }
  return { ok: true, file: target, updated };
}

module.exports = { probeFgui, parseFile, parseDir, batchExport, exportFile, restoreSourcePkg, parsePackage, saveSourceEdits };
