'use strict';
/** FGUI 逆向工具对外 API: 探测 / 单文件解析 / 目录批量导出 */
const fs = require('fs');
const path = require('path');
const { ByteBuffer } = require('./byteBuffer');
const { parsePackage } = require('./parser');
const { buildOutputs } = require('./xml');

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

module.exports = { probeFgui, parseFile, parseDir, batchExport, exportFile, parsePackage };
