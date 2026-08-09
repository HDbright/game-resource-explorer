'use strict';
/**
 * JS 版 FGUI 解析回归验证:
 * 1) 解析 E:\backup\游戏场景\异兽灵境\res\game_100073549\ui\fgui 下全部 .bin
 * 2) leftover 自检: 全部段声明长度-消费长度 == 0
 * 3) 与 Python 版 out_fgui/*.json 抽样结构化对比(数值归一化到 4 位小数)
 */
const fs = require('fs');
const path = require('path');
const F = require('../electron/tools/fgui/index');
const P = require('../electron/tools/fgui/parser');

const BIN_DIR = 'E:/backup/游戏场景/异兽灵境/res/game_100073549/ui/fgui';
const PY_JSON_DIR = 'E:/backup/游戏场景/异兽灵境/res/out_fgui';

function round4(v) {
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(round4);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = round4(v[k]);
    return o;
  }
  return v;
}

function main() {
  const bins = fs.readdirSync(BIN_DIR).filter((f) => f.toLowerCase().endsWith('.bin')).sort();
  console.log('包数:', bins.length);

  // 自检统计
  const stats = {};
  P.setStats(stats);

  let okPkgs = 0, failPkgs = 0, compCount = 0, childCount = 0, transCount = 0, gearCount = 0;
  const jsonDiffs = [];

  for (const f of bins) {
    const fp = path.join(BIN_DIR, f);
    try {
      const { pkg } = F.parseFile(fp);
      okPkgs++;
      for (const it of pkg.items) {
        const c = it.component;
        if (!c) continue;
        compCount++;
        childCount += c.children.length;
        transCount += c.transitions.length;
        for (const ch of c.children) gearCount += (ch.props.gears || []).length;
      }
      // 与 Python JSON 对比
      const pyJson = path.join(PY_JSON_DIR, f.replace(/\.bin$/i, '.json'));
      if (fs.existsSync(pyJson)) {
        const py = round4(JSON.parse(fs.readFileSync(pyJson, 'utf8')));
        const js = round4(JSON.parse(JSON.stringify(pkg)));
        delete py.rawById; delete js.rawById;
        const a = JSON.stringify(py);
        const b = JSON.stringify(js);
        if (a !== b) {
          jsonDiffs.push({ file: f, pyLen: a.length, jsLen: b.length });
        }
      }
    } catch (e) {
      failPkgs++;
      console.log('FAIL', f, e.message);
    }
  }

  console.log('解析成功:', okPkgs, ' 失败:', failPkgs);
  console.log('组件:', compCount, ' 子对象:', childCount, ' 过渡:', transCount, ' gear:', gearCount);
  console.log('JSON 与 Python 版不一致的包数:', jsonDiffs.length);
  for (const d of jsonDiffs.slice(0, 5)) {
    console.log('  DIFF', d.file, d.pyLen, d.jsLen);
  }

  // leftover 自检
  console.log('\n=== leftover 自检(期望全部为 0) ===');
  const samples = stats._samples || {};
  delete stats._samples;
  let bad = 0;
  const keys = Object.keys(stats).sort();
  for (const k of keys) {
    const dist = stats[k];
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    const zero = dist[0] || 0;
    const flag = zero === total ? 'OK ' : '!! ';
    if (zero !== total) bad++;
    const detail = Object.entries(dist).sort((x, y) => y[1] - x[1]).slice(0, 6)
      .map(([kk, vv]) => `${kk > 0 ? '+' : ''}${kk}:${vv}`).join(', ');
    console.log(`${flag} ${k.padEnd(38)} n=${String(total).padStart(5)} zero=${String(zero).padStart(5)}  ${detail}`);
  }
  console.log('异常段数:', bad);
  if (bad) {
    for (const k of keys) {
      const dist = stats[k];
      const total = Object.values(dist).reduce((s, v) => s + v, 0);
      if ((dist[0] || 0) !== total) {
        for (const [lv, tag] of (samples[k] || []).slice(0, 4)) {
          console.log(`   ${k.padEnd(36)} leftover=${lv} tag=${tag}`);
        }
      }
    }
  }
}

main();
