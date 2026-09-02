/**
 * spineProjectToJson.js — 将 Spine 编辑器二进制工程文件(.spine)转换为明文 JSON。
 *
 * 用法:  node spineProjectToJson.js <file.spine> [输出.json]
 *
 * ── 格式说明(逆向工程所得, 针对项目版本 3.8.x, 由 4.x 编辑器保存的文件布局;
 *     骨骼/网格几何/动画关键帧已用官方 spineboy-3.8 示例(goblins ess/pro)逐值核对) ──
 *
 * 1. 文件整体: raw DEFLATE 压缩(无 zlib 头), 解压后为[tag][value]流。
 * 2. 数值:
 *    - 浮点: 4 字节大端 float32(全精度, 导出 JSON 的两位小数即由此四舍五入)
 *    - varint: 标准 protobuf 变长整数(高位为延续位)
 *    - 颜色: tag 后跟 "1e 01" + RGBA 四字节
 * 3. 字符串/列表/对象通用形态: [01][数据] = 内联; 裸 varint = 驻留表(intern
 *    table)引用编号。编辑器对重复值全局去重 —— 相同字符串/浮点数组(如链接网格
 *    共享的 uvs/顶点/三角形/边)只写一次全文, 后续均为引用。
 * 4. 对象值: [2b|2e|34] 标记后跟 [01 + 内联子对象] 或 [varint 引用]。
 *    例如插槽的 setup attachment 字段、动画关键帧的 attachment 引用。
 * 5. 对象图: 全文件对象按写入顺序分配递增 id, 骨骼=每根 4 个 id
 *    (骨骼本身 + 名称字符串 + 2 个子对象),root/hip 因内联 "bone" 字符串各多 1 个。
 *    由此得出骨骼 id 表: root=8, hip=14, torso=18, ... 每骨 +4。
 * 6. 区块: [0f 01 <类型>] 标记(0x12=骨骼, 0x1b=插槽/附件, 0x07=动画...)。
 * 7. 记录: 骨骼 = "0c 01 1a 00 04 01" + 名称 + 字段; 插槽 = "01 0d 00 04 01" + 名称
 *    + 字段(02=骨骼引用); 附件 = [2b 01 10 几何字段...00] + 名称 + 标志;
 *    结束符 7e 00。
 * 8. 附件名记录位于几何之后: <几何> [01+内联名|varint引用] 04 <varint>
 *    [05 01 20 <varint>] [20|21|23]+varint …。链接网格的 04 字段为引用编号。
 *    名字按「最近未命名附件」LIFO 补绑: 插槽记录的 08(setup 附件)字段可内联未写过的
 *    几何(08 2e 01 1b <网格…>),内联几何的名字先写、插槽记录之前预写几何的名字后写
 *    (alien-pro slot head: [burst01 几何][SLOT head + 内联 head 网格][名 head][名 burst01]
 *    [burst02 几何][名 burst02]…),按邻接(curAtt)绑定会把名字安到错误附件。
 *    slot_hint 以命名时刻上下文为准: 插槽记录进行中 → 该插槽; 否则 → 最近完成插槽
 *    (预写几何解析时其插槽记录尚未出现,解析时刻必滞后一槽)。
 * 9. 网格附件: 2e 01 1b | 0c<uvs:11+内联|引用> 0d<ref> <三角形:01 n×u16BE 内联|
 *    裸varint引用> 0e<ref> [81 加权网格标记] 10<宽f32> 11<高f32> 1a 1b 22 <多边形> [1c 链接记录]。
 *    uvs/三角形为引用 → 链接网格(官方导出 "linkedmesh" 类型), 输出按 (宽,高,hull)
 *    结构匹配回填共享几何并以 linked_source 标注来源。
 *    81 标记仅蒙皮网格出现(vine/raptor 等), 误当未知标签会丢宽高与多边形体。
 *    裸多边形锚点: 07 <hull varint 1-3 字节> 08 10 <01 内联边|≥0x80 引用> —— hull≥64
 *    时 varint 双字节(coin clipping), 单字节假设会漏检整个附件。
 * 9b. 名字/归属兜底(名字节点为驻留引用且对象图 id 未模拟时的回退):
 *    ① 签名孪生(同型同宽高, mesh 比对 uvs)→ ①b 槽名去序号(windmill ×15 槽共享附件)
 *    → ② 槽名兜底(未被认领的单插槽附件: goggles/portal-streaks2/裸多边形 path)
 *    → ③ 槽名±序号校正(muzzle01→slot muzzle)。path/clipping 以 -path 命名惯例区分;
 *    路径式名(goblingirl/neck)按基名对齐插槽; 无顶点幻影多边形过滤。
 * 10. 多边形体: 07<hull×4> 08<固定16> <边:01 n×u8 内联|裸varint引用> 09 0a 0b
 *     12<顶点:11+内联|引用> 13 14 15 [1c 链接] 颜色 00。顶点数=vertices.length/2。
 * 11. 动画: 记录头 "12 01 XX XX 04 01 <名>";时间线组 "13 01 04 00 <refA> 01 <骨骼refB>"
 *     + 02 0f 01 <组内时间线数>;时间线 "14 01"(rotate/translate/scale/attachment,
 *     头部 09 00 <refA> 01 <通道refB>——refB 为通道类型驻留 id, 同文件内
 *     rotate/translate 恒定)与 "12 01 08"/"18 01"(deform, 头部为浮点串);
 *     关键帧 "52 01 11 00 <refA> [01 <refB>]" + 字段: 02=时间(帧, 30fps, 秒=帧/30),
 *     03=曲线(内联 01 <类型> 或引用), 04~07=贝塞尔控制点(默认线性 0.25/0/0.75/1),
 *     08=值(rotate 角度 / translate.x), 09=translate.y, 0d=attachment/事件引用等;
 *     帧尾 0d..10 varint 字段组 + 11 i32。键间 "01" 为记录分隔标记。
 *     变形时间线的浮点串以哨兵 "11 00 00 00 00" 终止, 其后紧邻强锚点(键/组头/
 *     时间线头), 原子跳过可防串内浮点误触 13 01/14 01 形成幻影记录。
 *     官方导出会剔除编辑器全零通道(kind=zero)与变形时间线(kind=deform)。
 * 12. 皮肤区段(与插槽/附件区同域, 位于动画区之前; goblins/mix-and-match 官方导出逐值核对):
 *     皮肤块头 "[04 01 <01 内联名|varint 引用名>] 02 0f 01 <条目数>"(与动画名记录同形态,
 *     以区段位置区分; 前导哨兵 "22 01 08 00", 其前另有 "0f 01 <v> 22 <v>" 簿记)。
 *     块内条目 = 皮肤自有附件几何; default 皮肤无块头(其条目伴随插槽记录写入, goblins
 *     的 dagger/spear/shield), 首个皮肤亦可能无块头而按 "前缀/附件名" 路径命名(mix 的 boy)。
 *     条目形态两种: 展开(goblin)=[几何][键节点: lead=插槽id, 附件名, f04=0][插槽记录]
 *     [路径节点: f04=条目对象id, "皮肤名/图片名"]; 紧凑(goblingirl)=[几何][单节点:
 *     lead=插槽id, 路径名, f04=条目id, 05 01 20=皮肤id]。插槽记录内部的键节点(f04=0,
 *     名与插槽名同前缀)用于学习 lead→插槽名; 插槽记录可横跨多个皮肤块, 块头探测须
 *     先于 04 颜色字段消费。加权网格的 0x18-0x1f 影响记录族按骨骼记录同源语法跳过,
 *     否则按未知标签吞 f32 会吃掉紧随的皮肤块头。
 *     输出 skins=[{name, attachments:{slot:{key:att}}}](运行时 JSON 数组形态,
 *     键=显式键节点名或插槽名); 附件对象补 path=图片路径(皮肤目录前缀)。
 *     已知局限: 纯组合皮肤(无自有几何, 条目全部引用既有附件, mix 的 hoodie-orange)
 *     与皮肤名目录前缀(clothes/hoodie-orange)、皮肤自有骨骼(mix 有 92 根未解码)不重建。
 *
 * 注意: 未识别的记录头(如 0x18 01 变形时间线)按 1 字节重同步; 插槽/附件/时间轴的
 * 引用编号尚未完全映射到名称(需要完整的对象 id 分配模拟), 这些引用以原始数字输出
 * 在 *_ref 字段中; 骨骼引用已完全解析。未识别的编辑器簿记区段以 raw 十六进制保留。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function convert(file) {
  const raw = zlib.inflateRawSync(fs.readFileSync(file));
  const buf = raw;
  const sectionCounts = {}; // 各区块头 0f 01 <count> 中的计数(已验证:骨骼数/附件数/动画数)
  let p = 0;
  const u8 = () => buf[p++];
  const peek = (n = 0) => buf[p + n];
  const f32 = () => { const v = buf.readFloatBE(p); p += 4; return v; };
  const i32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const varint = () => { let v = 0, s = 0, b; do { b = u8(); v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
  const intern = new Map();
  const strv = () => {
    if (peek() === 0x01) { p++; let s = ''; for (;;) { const c = u8(); if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; }
    const id = varint(); return { __ref: id };
  };
  const namev = () => { expect(0x04, 0x01); return strv(); };
  const color = () => { const a = u8(); if (a !== 0x1e) err('color marker'); u8(); const c = buf.subarray(p, p + 4).toString('hex'); p += 4; return c; };
  function err(msg) { throw new Error(`@0x${p.toString(16)}: ${msg} | ctx: ${buf.subarray(Math.max(0, p - 24), p + 24).toString('hex')}`); }
  function expect(...bytes) { for (const b of bytes) if (u8() !== b) err(`expected ${bytes.map(x => x.toString(16)).join(' ')}`); }
  const r2 = (v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);

  // ── 头部: 扫描到骨骼区锚点 ──
  const version = (() => { let i = 5, s = ''; for (;;) { const c = buf[i++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; })();
  // 骨骼区头: 0f 01 <骨骼数>(ess=0x12=18 / pro=0x40=64),后跟首个骨骼记录 0c 01 1a 00。
  // 通用锚点:定位首个骨骼记录,再回扫 3 字节取区块头中的骨骼数。
  const firstBone = buf.indexOf(Buffer.from('0c011a00', 'hex'));
  if (firstBone < 4) throw new Error('未找到骨骼区(0c 01 1a 00)');
  let boneCount = null;
  if (buf[firstBone - 3] === 0x0f && buf[firstBone - 2] === 0x01) boneCount = buf[firstBone - 1];
  const boneMark = firstBone - 3;
  const projName = scanString(boneMark);
  function scanString(from) { // 在头部区域宽松提取字符串(项目名)
    let i = Math.max(0, from - 60);
    while (i < boneMark) {
      let s = '', j = i, ok = false;
      while (j < boneMark) { const c = buf[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); ok = true; break; } if (c < 0x20) break; s += String.fromCharCode(c); if (s.length > 60) break; }
      if (ok && s.length > 3) return s;
      i = j;
    }
    return null;
  }
  const imagesName = (() => { const i = buf.indexOf(Buffer.from('2e2f', 'hex'), 0x10); if (i < 0) return ''; let s = ''; let j = i; for (;;) { const c = buf[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; } s += String.fromCharCode(c); } return s; })();
  p = firstBone;

  // ── 骨骼 ──
  const bones = [];
  function parseBone() {
    expect(0x0c, 0x01, 0x1a, 0x00);
    const b = { name: namev() };
    if (typeof b.name !== 'string') b.name = '#ref' + b.name.__ref;
    for (;;) {
      const t = u8();
      if (t === 0x02) u8();
      else if (t === 0x03) b.parentRef = varint();
      else if (t === 0x04) b.x = f32();
      else if (t === 0x05) b.y = f32();
      else if (t === 0x06) b.rotation = f32();
      else if (t === 0x07) b.scaleX = f32();
      else if (t === 0x08) b.scaleY = f32();
      else if (t === 0x09) b.length = f32();
      else if (t === 0x0a) b.x2 = f32();
      else if (t === 0x0b) b.y2 = f32();
      else if (t === 0x0c) b.rotation2 = f32();
      else if (t === 0x0d) b.scaleX2 = f32();
      else if (t === 0x0e) b.scaleY2 = f32();
      else if (t === 0x11) b.color = color();
      else if (t >= 0x17 && t <= 0x1a) f32();
      else if (t === 0x1b) { // 标志字段:普通骨骼单值 0b;root/带变换模式骨骼为 [01, <mode>] 双值
        const v = varint();
        if (v === 1) b.transformMode_raw = u8();
        b.inheritFlags = v;
      }
      else if (t === 0x1c) { const v = strv(); if (typeof v === 'string') { b.nodeType = v; b._typeInline = true; } else { b.nodeTypeRef = v.__ref; } }
      else if (t === 0x1d) varint();
      else if (t === 0x1e) varint();
      else if (t === 0x1f) break;
      else err('bone tag ' + t.toString(16));
    }
    expect(0x0f); u8(); u8(); expect(0x7e, 0x00);
    bones.push(b);
  }
  while (peek() === 0x0c && peek(1) === 0x01) {
    try { parseBone(); }
    catch (e) {
      // 4.x 编辑器保存的工程存在尾部变体(mix-and-match 0f 01 04 22 01 08 …,非 0f .. .. 7e 00):
      // 丢弃该骨骼,重同步到下一骨骼锚点 —— 宁可缺一根也不中断整个解码
      const next = buf.indexOf(Buffer.from([0x0c, 0x01, 0x1a, 0x00]), p);
      if (next < 0) break;
      p = next;
    }
  }

  // 骨骼 id 表:对象图按写入顺序分配 id(每骨骼 4 个:骨骼+名称字符串+2 子对象);
  // root 记录的 1b 额外字节 +1;类型串(1c)内联首现 +1(ess: root/hip 内联 "bone";pro: crosshair 等内联 "circle")。
  // 按实际解析到的内联情况自模拟,不再硬编码 ess 的布局。
  const boneId = new Map();
  const nameStrId = new Map();
  {
    let id = 8;
    bones.forEach((b) => {
      boneId.set(id, b.name);
      intern.set(id + 1, b.name);
      nameStrId.set(id + 1, b.name);
      id += 4;
      if (b.transformMode_raw !== undefined) id += 1; // 1b 双值形态多占一个 id
      if (b._typeInline) id += 1;
    });
  }
  const resolveRef = (id) => intern.get(id) ?? nameStrId.get(id);
  bones.forEach(b => { b.parent = boneId.get(b.parentRef) ?? null; delete b.parentRef; delete b._typeInline; });

  // ── 插槽与附件区 ──
  // 区块头: 0f 01 <count>(count=附件总数,ess=27/pro=80;已验证);pro 其后另有若干头部杂项字节
  // (0f 01 50 54 01 14),容忍跳过 —— 扫描到第一个锚点(插槽 0d 00 04 01 / 附件几何 / 裸多边形)。
  {
    u8(); // 06 = 骨骼区结束标记
    if (process.env.SPJ_DEBUG) console.error(`[spj] 0x${p.toString(16)} bones-end`);
    if (peek() === 0x0f && peek(1) === 0x01) { p += 3; sectionCounts.slotsAttachments = buf[p - 1]; }
    if (process.env.SPJ_DEBUG) console.error(`[spj] 0x${p.toString(16)} slotsec-start count=${sectionCounts.slotsAttachments}`);
    let guard = 0;
    while (guard++ < 32 && !(
      (peek() === 0x01 && peek(1) === 0x0d && peek(2) === 0x00) ||
      ((peek() === 0x2b || peek() === 0x34 || peek() === 0x2e) && peek(1) === 0x01) ||
      (peek() === 0x07 && peek(2) === 0x08) || // 裸多边形开头 07 XX 08 10
      (peek() === 0x0c && peek(1) === 0x01 && peek(2) === 0x0d && peek(3) === 0x00) // pro 首插槽前缀 0c 01 0d 00
    )) p++;
  }
  const slots = [], attachments = [];
  const DBG = !!process.env.SPJ_DEBUG;
  const dbg = (kind, extra) => { if (DBG) console.error(`[spj] 0x${p.toString(16)} ${kind} ${extra || ''}`); };
  // ── 皮肤区段状态 ──
  // 皮肤块头: [04 01 <01 内联名|varint 引用名>] 02 0f 01 <条目数>(与动画名记录同形态,
  // 仅出现在插槽/附件区内;default 皮肤无块头 —— 其条目 = 各插槽记录的邻接附件)。
  // 块内条目归该皮肤;块外条目默认 default,若其路径名前缀恰为某皮肤名(如 goblin/neck)
  // 则归该前缀皮肤(首个使用某插槽的皮肤条目会先于块头与插槽记录同写)。
  let curSkin = null; // null = 块外(default 候选)
  let skinEntriesLeft = 0; // 当前皮肤块剩余条目数(按块头 N 几何条目递减,归零即块结束 → 回到块外)
  const skinOrder = []; // 皮肤块发现顺序(不含 default)
  const slotLead = new Map(); // 插槽对象引用(名称节点 lead varint)→ 插槽名
  const skinNameRe = /^[A-Za-z0-9_][\w .-]{0,47}$/;
  /** 皮肤块头探测:返回 {name, next}(消费后的位置),不匹配返回 null */
  const isSkinHeader = () => {
    if (peek() !== 0x04 || peek(1) !== 0x01) return null;
    let q = p + 2, name = null;
    if (buf[q] === 0x01) {
      q++;
      let s = '';
      for (let g = 0; g < 64; g++) {
        const c = buf[q];
        if (c === undefined) return null;
        if (c & 0x80) { if ((c & 0x7f) < 0x20 || (c & 0x7f) > 0x7e) return null; s += String.fromCharCode(c & 0x7f); q++; break; }
        if (c < 0x20 || c > 0x7e) return null;
        s += String.fromCharCode(c); q++;
      }
      if (!skinNameRe.test(s)) return null;
      name = s;
    } else {
      let v = 0, sh = 0, b;
      do { b = buf[q]; if (b === undefined) return null; v |= (b & 0x7f) << sh; sh += 7; q++; } while ((b & 0x80) && sh < 21);
      if (v > 0xffff) return null;
      name = { __ref: v };
    }
    if (buf[q] !== 0x02 || buf[q + 1] !== 0x0f || buf[q + 2] !== 0x01) return null;
    return { name, next: q + 4, count: buf[q + 3] };
  };
  /** 浮点列表: 11 <01 varint n + n×f32>(内联)| 11 <varint>(驻留引用 —— 编辑器对重复
   *  数组全局去重:首次出现内联写全文,后续(如各皮肤共享的网格 uvs/顶点)仅写引用编号) */
  function parseFloatList() {
    expect(0x11);
    if (peek() !== 0x01) return { __ref: varint() };
    u8();
    const n = varint(); const a = []; for (let i = 0; i < n; i++) a.push(f32()); return a;
  }
  /** 未知编辑器簿记 → 跳到对象尾部 "1e 01 <RGBA> 00" 并读取颜色。
   *  皮肤块头([04 01 <名>] 02 0f 01)是硬边界:加权网格的权重记录(1a-1f 标签族)
   *  常触发本扫描,若放任扫过颜色终止符会把下一个皮肤块头连同其条目吞进当前附件
   *  (mix-and-match cape-red 等 9 块皮肤曾因此整体丢失)—— 命中即截断当前附件。 */
  function skipToColorEnd(d) {
    while (p < buf.length - 6 && !(buf[p] === 0x1e && buf[p + 1] === 0x01 && buf[p + 6] === 0x00)) {
      if (!activeSlot && isSkinHeader()) { d._truncated = true; return; }
      p++;
    }
    d.color = color(); u8();
  }
  /** 多边形体(边界框/裁剪/网格共用): 07<hull×4> 08<固定16> <edges: 01 n 边内联 | 裸varint引用>
   *  09 0a 0b 12<顶点> 13 14 15 [簿记] 颜色 00(07 为 hull 而非顶点数 —— 已用官方导出逐值核对) */
  function parsePolygon(d) {
    for (;;) {
      const t = u8();
      if (t === 0x07) d.hull = Math.round(varint() / 4);
      else if (t === 0x08) { // 固定值 16(含义未知,23 处样本一致);edges 紧随其后:内联或驻留引用(链接网格共享)
        varint();
        if (peek() === 0x01) { p++; const n = varint(); const e = []; for (let i = 0; i < n; i++) e.push(u8()); d.edges = e; }
        else if (peek() !== undefined && peek() >= 0x80) d.edges_ref = varint();
      }
      else if (t === 0x01) { const n = varint(); const e = []; for (let i = 0; i < n; i++) e.push(u8()); d.edges = e; }
      else if (t === 0x09) d.f09 = f32();
      else if (t === 0x0a) d.f0a = f32();
      else if (t === 0x0b) d.f0b = f32();
      else if (t === 0x12) d.vertices = parseFloatList();
      else if (t === 0x13) d.f13 = f32();
      else if (t === 0x14) d.f14 = f32();
      else if (t === 0x15) d.f15 = f32();
      else if (t === 0x1e) d.color = color();
      else if (t === 0x00) break;
      else { skipToColorEnd(d); break; }
    }
  }
  /** 皮肤块边界探测:块头本身,或其固定前导哨兵 "22 01 08 00"(两处样本一致:
   *  goblins/mix-and-match 的每个 [04 01 <皮肤名>] 之前)。几何字段循环在按 f32
   *  盲吞未知标签时,以本哨兵截断,防止步进跨过块头起始字节 */
  const isSkinBoundary = () => isSkinHeader() || (peek() === 0x22 && peek(1) === 0x01 && peek(2) === 0x08 && peek(3) === 0x00);
  /** 加权影响记录(0x18-0x1f 标签族,与骨骼记录同源):18/19/1a=f32,1b=标志,
   *  1c=引用,1d/1e=varint,1f=记录结束。region/mesh 字段循环遇 0x18+ 按此跳过 */
  function skipInfluence(d) {
    for (let g = 0; g < 24; g++) {
      const t = u8();
      if (t === 0x1f) return;
      if (t === 0x1b) { if (peek() === 0x01) { u8(); u8(); } else u8(); }
      else if (t === 0x1c) { if (peek() === 0x01) strv(); else varint(); }
      else if (t === 0x1d || t === 0x1e) varint();
      else f32(); // 18/19/1a 及其余数值字段
    }
    d._influenceUnparsed = true; // 超长防御
  }
  function parseGeomBody(type) {
    const d = { type: type === 0x10 ? 'region' : type === 0x13 ? 'boundingbox' : type === 0x1b ? 'mesh' : 'type' + type.toString(16) };
    if (type === 0x10) { // region
      for (;;) {
        const t = u8();
        if (t === 0x06) d.x = f32();
        else if (t === 0x07) d.y = f32();
        else if (t === 0x08) d.scaleX = f32();
        else if (t === 0x09) d.scaleY = f32();
        else if (t === 0x0a) d.rotation = f32();
        else if (t === 0x0b) d.width = f32();
        else if (t === 0x0c) d.height = f32();
        else if (t === 0x0d) { // 图片路径引用;另有内联字符串形态(0d 01 <strv> = 图片目录前缀,
          // mix-and-match cape-red 的网格引用 girl-spring-dress/cloak-up 共享其它皮肤目录的图)
          if (peek() === 0x01 && peek(1) >= 0x20 && peek(1) <= 0x7e) {
            p++;
            let s2 = '';
            for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); }
            d.pathDir = s2;
          } else {
            const raw = [u8()];
            if (raw[0] & 0x80) { while (raw[raw.length - 1] & 0x80) raw.push(u8()); }
            else if (peek() >= 0x80) raw.push(u8());
            d.f0d_raw = raw.map(x => x.toString(16)).join(' ');
          }
        }
        else if (t === 0x0e) d.color = color();
        else if (t === 0x00) break;
        else if (t >= 0x18 && t <= 0x1f) { p--; skipInfluence(d); } // 加权影响记录
        else {
          // 未知标签:先探皮肤块边界(加权影响记录后常紧跟下一皮肤块头,误吞 5 字节 f32
          // 会把块头的 04 01 前缀和名称吃掉 —— mix-and-match hoodie-blue-and-scarf 曾因此丢失)
          if (!activeSlot && isSkinBoundary()) { p--; d._truncated = true; break; }
          d['t' + t.toString(16)] = f32();
        }
      }
    } else if (type === 0x1b) { // mesh: 0c<uvs> 0d<ref> <三角形: 01 n 内联 | 裸varint引用> 0e<ref> 10<宽> 11<高> 1a 1b 22 <多边形> [簿记]
      for (;;) {
        const t = u8();
        if (t === 0x0c) d.uvs = parseFloatList();
        else if (t === 0x0d) { // f0d 引用;三角形列表紧随其后:内联(01)或驻留引用(链接网格与源网格共享)
          d.f0d_ref = varint();
          if (peek() === 0x01) { p++; const n = varint(); const tri = []; for (let i = 0; i < n; i++) tri.push((u8() << 8) | u8()); d.triangles = tri; }
          else if (peek() !== undefined && peek() >= 0x80) d.triangles_ref = varint();
        }
        else if (t === 0x01) { const n = varint(); const tri = []; for (let i = 0; i < n; i++) tri.push((u8() << 8) | u8()); d.triangles = tri; }
        else if (t === 0x0e) d.f0e_ref = varint();
        else if (t === 0x81) { /* 加权网格标记:宽高字段(10/11)前的额外字节,vine/raptor
           等蒙皮网格实测;误当未知标签走 skipToColorEnd 会丢宽高与整个多边形体 */ }
        else if (t === 0x10) d.width = f32();
        else if (t === 0x11) d.height = f32();
        else if (t === 0x1a) d.f1a = varint();
        else if (t === 0x1b) d.f1b = varint();
        else if (t === 0x22) d.f22 = varint();
        else if (t === 0x07) { p--; parsePolygon(d); break; } // 进入多边形体
        else if (t === 0x1e) d.color = color();
        else if (t === 0x00) break;
        else if (t >= 0x18 && t <= 0x1f) { p--; skipInfluence(d); } // 加权影响记录
        else {
          if (!activeSlot && isSkinBoundary()) { p--; d._truncated = true; break; } // 同 region:皮肤块边界屏障
          skipToColorEnd(d); break;
        }
      }
      // 链接网格:uvs/三角形为驻留引用(与源网格共享几何,导出 JSON 的 "linkedmesh" 类型)
      if (d.uvs && d.uvs.__ref !== undefined || d.triangles_ref !== undefined) d.type = 'linkedmesh';
    } else { // boundingbox / clipping(裸多边形) / 其它
      p--; parsePolygon(d);
    }
    return d;
  }
  const flagTags = new Set([0x04, 0x05, 0x20, 0x21, 0x23]);
  let curAtt = null;
  let curSlotName = null; // 最近解析完的插槽名
  let activeSlot = null;  // 正在解析的插槽记录(名字节点在记录内部出现时,归属此插槽)
  let orphanKey = null;   // 预写键节点名(几何随其后出现时补绑为编辑器名)
  /** 最近一个尚未命名的附件:名字节点按 LIFO 补绑 —— 插槽记录 08 字段可内联 setup 附件
   *  几何(alien-pro 实测:08 2e 01 1b <网格>…),内联几何的名字先写、预写几何(记录之前)
   *  的名字后写,按 curAtt 邻接绑定会把名字安到错误附件上(head↔burst01 串号) */
  const lastUnnamedAtt = () => {
    for (let i = attachments.length - 1, n = 0; i >= 0 && n < 8; i--, n++) {
      const a = attachments[i];
      if (a.name === undefined && a.name_ref === undefined) return a;
    }
    return null;
  };
  // 区块结束: 07 0f 01 <动画数> 12 01(后必跟动画记录,ess=07/pro=0b;强锚点避免数据中误触发)
  const sectionEnd = () => (peek() === 0x07 && peek(1) === 0x0f && peek(2) === 0x01 && peek(4) === 0x12 && peek(5) === 0x01) || (peek() === 0x0f && peek(1) === 0x01 && peek(3) === 0x12 && peek(4) === 0x01);
  // 几何标记后跟合法字段标签(region:06-0e / mesh:0c / bbox:07),降低浮点数据中杂散 2b 01 10 的误报
  const isGeomStart = () => (peek() === 0x2b || peek() === 0x34 || peek() === 0x2e) && peek(1) === 0x01
    && ((peek(2) === 0x10 && peek(3) >= 0x06 && peek(3) <= 0x0e) || (peek(2) === 0x1b && peek(3) === 0x0c) || (peek(2) === 0x13 && peek(3) === 0x07));
  // 裸多边形锚点:07 <hull varint(1-3 字节)> 08 10 <01 内联边 | ≥0x80 引用> —— hull≥64 时
  // varint 双字节(coin clipping:07 9c 01 08 …),按单字节假设会漏检整个附件
  const isBarePolygon = () => {
    if (peek() !== 0x07) return false;
    let q = p + 1, b;
    do { b = buf[q]; if (b === undefined) return false; q++; } while ((b & 0x80) && q - p < 4);
    return buf[q] === 0x08 && buf[q + 1] === 0x10 && (buf[q + 2] === 0x01 || (buf[q + 2] ?? 0) >= 0x80);
  };
  const isSlotStart = () => (peek() === 0x01 && peek(1) === 0x0d && peek(2) === 0x00) || (peek() === 0x0c && peek(1) === 0x01 && peek(2) === 0x0d && peek(3) === 0x00);
  /**
   * 严格锚点的附件名节点: [lead varint]? 01 (01+内联字符 | varint引用) 04 <varint> [05 01 20 <varint>] [20|21|23]+varint…
   * 名称后必须紧跟 04 字段 —— 逐字节向前探测,任何一环不符返回 null(调用方跳 1 字节重同步)。
   * 名称记录位于附件几何之后:<mesh 几何> "goblin/head" 04 00 … 21 01 23 00 <下一个记录>(已用
   * 官方导出的宽高/hull/几何逐值核对),故名称套用到刚解析完的附件(curAtt)。
   */
  /** 调试用:名称节点解析结果摘要 */
  const rs_log = (name) => (name && typeof name !== 'string' && name.__ref !== undefined && resolveRef(name.__ref) ? `(=${resolveRef(name.__ref)})` : '');
  function tryNameNode() {
    let q = p, lead = null;    if (buf[q] !== 0x01) {
      // lead varint(1-2 字节)
      if (buf[q] === undefined) return null;
      const s0 = q;
      let v = 0, sh = 0, b;
      do { b = buf[q]; if (b === undefined) return null; v |= (b & 0x7f) << sh; sh += 7; q++; } while ((b & 0x80) && q - s0 < 2);
      if (v > 0xfff) return null;
      lead = v;
    }
    if (buf[q] !== 0x01) return null;
    q++;
    let name = null;
    if (buf[q] === 0x01) { // 内联字符串:ASCII 字符,末字符高位置位
      q++;
      let s = '';
      for (let g = 0; g < 64; g++) {
        const c = buf[q];
        if (c === undefined) return null;
        if (c & 0x80) { if ((c & 0x7f) < 0x20 || (c & 0x7f) > 0x7e) return null; s += String.fromCharCode(c & 0x7f); q++; break; }
        if (c < 0x20 || c > 0x7e) return null;
        s += String.fromCharCode(c); q++;
      }
      if (!s) return null;
      name = s;
    } else { // varint 引用
      const s0 = q;
      let v = 0, sh = 0, b;
      do { b = buf[q]; if (b === undefined) return null; v |= (b & 0x7f) << sh; sh += 7; q++; } while ((b & 0x80) && q - s0 < 3);
      if (v > 0xffff) return null;
      name = { __ref: v };
    }
    // 名称后必须紧跟 04 字段(强校验):04 <varint>(值含义:条目名引用/链接网格源,详见调用处分析)
    if (buf[q] !== 0x04) return null;
    q++;
    let f04 = 0;
    { let sh = 0, b; do { b = buf[q]; if (b === undefined) return null; f04 |= (b & 0x7f) << sh; q++; sh += 7; } while ((b & 0x80) && sh < 21); }
    p = q;
    // 套用到最近未命名的附件(名称在几何之后;内联 setup 几何的名字先于预写几何的名字 → LIFO)
    // slot_hint 以命名时刻上下文为准(预写几何在自身插槽记录之前解析,解析时刻必然滞后一槽)
    const tgt = lastUnnamedAtt();
    const hintNow = (activeSlot && activeSlot.name) || curSlotName;
    if (typeof name === 'string') { if (tgt) { tgt.name = name; tgt._slotHint = hintNow; if (orphanKey !== null) { tgt._keyNode = orphanKey; orphanKey = null; } } }
    else if (tgt) { const rs = resolveRef(name.__ref); if (rs) { tgt.name = rs; tgt._slotHint = hintNow; } else { tgt.name_ref = name.__ref; tgt._slotHint = hintNow; } }
    if (lead !== null && tgt && tgt.lead_ref === undefined) tgt.lead_ref = lead;
    // 皮肤条目语义:f04≠0 = 皮肤条目对象引用(该节点为路径/条目节点);
    // f04=0 且有内联名 = 附件编辑器名(键节点);tgt=null 的节点 = 刚解析几何的路径补充
    if (tgt) {
      if (f04) tgt._entryRef = f04;
      else if (typeof name === 'string') tgt._keyNode = name;
    } else if (f04) {
      if (curAtt) {
        if (typeof name === 'string') curAtt._path = name;
        if (curAtt.lead_ref === undefined && lead !== null) curAtt.lead_ref = lead;
        curAtt._entryRef = f04;
      }
    } else if (typeof name === 'string') {
      orphanKey = name; // 预写键节点(几何随其后):下一几何命名时补绑编辑器名
    }
    // 本节点所属的皮肤条目附件(f04≠0 时):皮肤引用(05 01 20)记录到它身上
    const entryAtt = f04 ? (tgt ?? curAtt ?? null) : null;
    // 插槽记录内部的键节点(f04=0 的附件名节点)→ 学习 lead → 插槽名。键节点名须与插槽名
    // 相同或以插槽名为前缀(mouth 槽的键是 mouth-close);记录内可能混入其它插槽条目的
    // 键节点(写入顺序交错),名称不匹配的一律不学,防止大面积串槽
    if (activeSlot && lead !== null && f04 === 0 && typeof name === 'string'
      && (name === activeSlot.name || name.startsWith(activeSlot.name))) {
      if (DBG && slotLead.get(lead) !== activeSlot.name) console.error(`[spj] 0x${p.toString(16)} LEARN ${lead} -> ${activeSlot.name} (node=${name})`);
      slotLead.set(lead, activeSlot.name);
    }
    if (DBG) console.error(`[spj] 0x${p.toString(16)} NAME ${typeof name === 'string' ? name : '#ref' + name.__ref}${rs_log(name)} -> att#${tgt ? attachments.indexOf(tgt) : -1} hint=${hintNow} lead=${lead} f04=${f04}`);
    // 标志尾:吃掉 05 01 20 <varint>(皮肤引用,记录到条目附件) / 20|21|23|04|05 + varint 等标志对。
    // 下一皮肤块头([04 01 <名>] 02 0f 01)的 04 01 前缀会被本循环当标志对吃掉导致块头丢失
    // (mix-and-match hoodie-blue-and-scarf:girl 块首条目名节点的尾随 04 吞了下一块头的 04 01)
    for (let g = 0; g < 8 && p < buf.length; g++) {
      const t = peek();
      if ((t === 0x04 || t === 0x05) && !activeSlot && isSkinHeader()) break;
      if (t === 0x05 && peek(1) === 0x01 && peek(2) === 0x20) { p += 3; const v = varint(); if (entryAtt && entryAtt._skinRef === undefined) entryAtt._skinRef = v; }
      else if (t === 0x20 || t === 0x21 || t === 0x23 || t === 0x04 || t === 0x05) { p++; varint(); }
      else break;
    }
    return true;
  }
  while (!sectionEnd() && p < buf.length - 4) {
    // 皮肤块头(优先于其它锚点:块头标志字节 04 01 与几何/插槽标记不冲突)
    if (!activeSlot) {
      const sh = isSkinHeader();
      if (sh) {
        curSkin = typeof sh.name === 'string' ? sh.name : ('#ref' + sh.name.__ref);
        if (typeof sh.name === 'string' && !skinOrder.includes(sh.name)) skinOrder.push(sh.name);
        skinEntriesLeft = sh.count;
        p = sh.next;
        if (DBG) console.error(`[spj] 0x${p.toString(16)} SKIN ${curSkin} entries=${sh.count}`);
        continue;
      }
    }
    if (isGeomStart()) {
      const st = p;
      u8(); u8();
      const ty = u8();
      curAtt = parseGeomBody(ty);
      curAtt._slotHint = curSlotName;
      if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; }
      attachments.push(curAtt);
      if (DBG) console.error(`[spj] 0x${st.toString(16)} GEOM ${curAtt.type}${curAtt.name ? ' ' + curAtt.name : ''}`);
      continue;
    }
    if (isBarePolygon()) { // 裁剪附件等:插槽记录后直接跟多边形体(无 2b/2e/34 标记)
      curAtt = { type: 'clipping?' };
      curAtt._slotHint = curSlotName;
      if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; }
      parsePolygon(curAtt);
      attachments.push(curAtt);
      continue;
    }
    if (peek() === 0x2b && !isGeomStart()) { u8(); const ref = varint(); if (curAtt) curAtt.link_ref = ref; continue; }
    if (isSlotStart()) {
      const slotAt = p;
      if (peek() === 0x0c) u8();
      p += 3;
      const nm = namev();
      const slot = { name: typeof nm === 'string' ? nm : (resolveRef(nm.__ref) ?? '#ref' + nm.__ref) };
      activeSlot = slot; // 记录内部出现的内联几何/名字节点归属此插槽
      const slotTags = new Set([0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x7e]);
      for (;;) {
        // 皮肤块头探测必须先于字段消费:块头前缀 04 01 与插槽颜色字段(04)同字节,
        // 先按字段消费会把块头前缀和名称吃掉(mix-and-match hoodie-blue-and-scarf)
        if (peek() === 0x04 && isSkinHeader()) {
          const sh = isSkinHeader();
          curSkin = typeof sh.name === 'string' ? sh.name : ('#ref' + sh.name.__ref);
          if (typeof sh.name === 'string' && !skinOrder.includes(sh.name)) skinOrder.push(sh.name);
          skinEntriesLeft = sh.count;
          p = sh.next;
          if (DBG) console.error(`[spj] 0x${p.toString(16)} SKIN ${curSkin} entries=${sh.count} (in-slot)`);
          continue;
        }
        if (!slotTags.has(peek())) {
          if (isGeomStart()) { u8(); u8(); curAtt = parseGeomBody(u8()); curAtt._slotHint = slot.name; if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; } attachments.push(curAtt); continue; }
          if (isBarePolygon()) { curAtt = { type: 'clipping?' }; curAtt._slotHint = slot.name; if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; } parsePolygon(curAtt); attachments.push(curAtt); continue; }
          if (tryNameNode()) continue;
          p++; // 未知字节:跳 1 字节重同步
          continue;
        }
        const t = u8();
        if (t === 0x02) { const r = varint(); if (slot.bone === undefined) slot.bone = boneId.get(r) ?? ('#ref' + r); }
        else if (t === 0x03) slot.f03 = varint();
        else if (t === 0x04) { slot.color = peek() === 0x1e ? color() : undefined; if (slot.color === undefined) varint(); }
        else if (t === 0x05) { if (peek() === 0x1e) slot.color2 = color(); else if (peek() === 0x01 && peek(1) === 0x20 && peek(2) === 0x00) p += 3; else varint(); }
        else if (t === 0x07) { const v = varint(); slot.f07 = v === 1 ? [v, u8()] : v; }
        else if (t === 0x08 || t === 0x09) {
          const k = t === 0x08 ? 'attachment_ref' : 'f09_ref';
          // setup 附件:已写对象 → 2b/2e/34 + varint 引用;未写 → 内联几何(marker 01 type)。
          // 内联形态(alien-pro slot head:08 2e 01 1b <网格7KB>):此前多查一个 01 再按
          // varint 吞引用,把类型字节 0x1b 当数值吃掉,整段几何被盲跳、名字串到其它附件
          if (isGeomStart()) { u8(); u8(); curAtt = parseGeomBody(u8()); curAtt._slotHint = slot.name; if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; } attachments.push(curAtt); }
          else if (isBarePolygon()) { curAtt = { type: 'clipping?' }; curAtt._slotHint = slot.name; if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; } parsePolygon(curAtt); attachments.push(curAtt); }
          else if (peek() === 0x2b || peek() === 0x2e || peek() === 0x34) { const mk = u8(); if (peek() === 0x01) { u8(); curAtt = parseGeomBody(u8()); curAtt._slotHint = slot.name; if (curSkin) { curAtt._skinBlock = curSkin; if (--skinEntriesLeft <= 0) curSkin = null; } attachments.push(curAtt); } else slot[k] = varint(); } // 对象标记(2b/2e/34):01=内联几何,否则 varint 引用
          else if (peek() === 0x00) u8();
          else slot[k + '_raw'] = varint();
        }
        else if (t === 0x0a) { if (peek() === 0x1e) slot.darkColor = color(); else varint(); }
        else if (t === 0x0b) { if (peek() === 0x1e) slot.darkColor2 = color(); else varint(); }
        else if (t === 0x0c) slot.f0c = varint();
        else if (t === 0x7e) { u8(); break; }
      }
      curSlotName = slot.name;
      activeSlot = null;
      slots.push(slot);
      if (DBG) console.error(`[spj] 0x${slotAt.toString(16)} SLOT ${slot.name}`);
      if (DBG) console.error(`[spj] 0x${p.toString(16)} /SLOT ${slot.name} end`);
      continue;
    }
    // 顶层附件名(严格模式):不匹配任何锚点 → 跳 1 字节重同步
    if (!tryNameNode()) p++;
  }

  // ── 皮肤区段后处理:插槽 lead 精确归属 + 皮肤归属 + 组装 skins ──
  // ① 学习插槽 lead → 插槽名:块外(default 区)附件的邻接 hint 可靠,连同 lead 一起学习
  //   (goblin eyes-closed 的路径节点 lead=219 → eyes 即由此学到;块内插槽的键节点在解析时已学)
  // ① 学习插槽 lead → 插槽名:块外(default 区)附件的邻接 hint 可靠,连同 lead 一起学习。
  //    名字未解析(#ref)的附件其 hint 可能是漂移的邻接结果(mix-and-match 曾把 mouth 的
  //    lead=537 误学到 boot-ribbon-front,污染全部皮肤的 mouth 条目),不参与学习
  for (const a of attachments) {
    if (!a._skinBlock && a.name !== undefined && a.lead_ref != null && a._slotHint && !slotLead.has(a.lead_ref)) slotLead.set(a.lead_ref, a._slotHint);
  }
  // ② 用 lead 精确重绑插槽(优先于邻接 hint:皮肤块内的紧凑条目无插槽记录,邻接 hint 会串槽)。
  //    _leadBound 标记:后续 9b 名称兜底启发式(槽名±序号/路径基名对齐)不得再覆盖 lead 结论
  for (const a of attachments) {
    const sl = a.lead_ref != null ? slotLead.get(a.lead_ref) : null;
    if (sl) { a._slotHint = sl; a._leadBound = true; }
  }
  // ③ 皮肤归属(优先级:皮肤块 > 路径前缀 > default):
  //    块内条目归块皮肤(权威 —— 组合皮肤条目可引用其它皮肤的图片目录,如 cape-red 的
  //    girl-spring-dress/cloak-up,按前缀会误归);块外条目按路径前缀(goblin/neck、boy/collar
  //    —— 首个皮肤无块头,其条目直接伴随插槽记录写入,以前缀成肤);其余(default 的 setup
  //    附件,无路径前缀)归 default
  const skinNameSet = new Set(skinOrder);
  const prefixSkins = new Map(); // 前缀 → 条目数(块外无块皮肤,如首个皮肤 boy/)
  for (const a of attachments) {
    const pathName = a._path || a.name || '';
    const pref = typeof pathName === 'string' && pathName.includes('/') ? pathName.split('/')[0] : null;
    if (a._skinBlock && a._entryRef !== undefined) a.skin = a._skinBlock;
    else if (pref && skinNameSet.has(pref)) a.skin = pref;
    else if (pref && !a._skinBlock) { a.skin = pref; prefixSkins.set(pref, (prefixSkins.get(pref) || 0) + 1); }
    else a.skin = 'default';
    delete a._skinBlock;
    // 皮肤条目键(运行时 JSON 的附件条目名):显式键节点 > 无路径前缀的附件名 > 插槽名
    a._skinKey = a._keyNode || (typeof a.name === 'string' && !a.name.includes('/') ? a.name : (a._slotHint || '(unknown)'));
  }
  for (const ps of prefixSkins.keys()) if (!skinOrder.includes(ps)) skinOrder.push(ps); // boy 等首皮肤按前缀补录

  // ── 动画区 ──
  const animations = {};
  let anim = null, group = null, tl = null;
  function isGroupTrailer() {
    if (peek() !== 0x03) return false;
    let q = p + 1, b; do { b = buf[q]; q++; } while (b & 0x80 && q < buf.length);
    return buf[q] === 0x04 && buf[q + 1] === 0x00 && buf[q + 2] === 0x05 && buf[q + 3] === 0x00 && buf[q + 4] === 0x06;
  }
  function isRecordStart() {
    const b = peek();
    if (b === 0x52) return peek(1) === 0x01 && peek(2) === 0x11 && peek(3) === 0x00; // 键=52 01 11 00 四字节锚点(防浮点数据中的杂散 52)
    return b === 0x12 || b === 0x13 || b === 0x14 || (b === 0x18 && peek(1) === 0x01) || (b === 0x0f && peek(1) === 0x01) || isGroupTrailer();
  }
  /** 锚点预校验:52 01 11 00 会偶然命中变形时间线的浮点负载形成幻影键,其字段一旦错位会
   *  整段吞掉后续动画组头。要求锚点后 refA(/01 refB) + 至少 2 个形态合法的连续字段才确认。 */
  function keyPlausible(q) {
    let r = q + 4, sh = 0, b;
    do { b = buf[r]; if (b === undefined) return false; r++; sh += 7; if (sh > 14) return false; } while (b & 0x80);
    if (buf[r] === 0x01) { r++; sh = 0; do { b = buf[r]; if (b === undefined) return false; r++; sh += 7; if (sh > 14) return false; } while (b & 0x80); }
    let ok = 0;
    for (let g = 0; g < 5 && ok < 2; g++) {
      const t = buf[r];
      if (t === 0x02 || (t >= 0x04 && t <= 0x0b)) { r += 5; ok++; } // tag + f32
      else if (t === 0x03) { r++; if (buf[r] === 0x01) r += 2; else { sh = 0; do { b = buf[r]; if (b === undefined) return false; r++; sh += 7; if (sh > 14) return false; } while (b & 0x80); } ok++; } // 曲线:内联类型或 varint 引用
      else if (t >= 0x0c && t <= 0x10) { r++; sh = 0; do { b = buf[r]; if (b === undefined) return false; r++; sh += 7; if (sh > 21) return false; } while (b & 0x80); ok++; } // varint 字段
      else if (t === 0x11) { r += 5; ok++; } // i32
      else break;
    }
    return ok >= 2;
  }
  /** 变形时间线的浮点串以哨兵 "11 00 00 00 00" 终止,其后紧邻强锚点(键/组头/时间线头)。
   *  原子跳过整个串:逐字节重扫会让串内浮点数据误触 14 01/13 01 等模式形成幻影记录,
   *  把后续真实关键帧挂到幻影时间线上(表现为部分骨骼键数大量缺失)。 */
  function skipDeformBlob() {
    const sent = Buffer.from([0x11, 0x00, 0x00, 0x00, 0x00]);
    let q = p;
    for (let g = 0; g < 8192; g++) {
      q = buf.indexOf(sent, q);
      if (q < 0 || q + 40 > buf.length) return false;
      const w = buf.subarray(q + 5, q + 37);
      if (w.indexOf(Buffer.from('52011100', 'hex')) >= 0 || w.indexOf(Buffer.from('13010400', 'hex')) >= 0
        || w.indexOf(Buffer.from('14010900', 'hex')) >= 0 || w.indexOf(Buffer.from('03000400', 'hex')) >= 0) {
        p = q + 5;
        return true;
      }
      q += 1;
    }
    return false;
  }
  function parseKey() {
    expect(0x52, 0x01, 0x11, 0x00);
    const refA = varint();
    const refB = peek() === 0x01 ? (p++, varint()) : null;
    const k = { refA, refB };
    for (;;) {
      if (isRecordStart()) break;
      const t = u8();
      if (t === 0x01) { // 记录分隔标记:其后紧跟新记录(时间线/组头/键)时结束本键。
        // 不识别它而按未知字段吞 varint 会把后续记录头当数值吃掉,造成大段错位(曾吞掉整个动画组头)
        const nb = peek();
        if (nb === 0x12 || nb === 0x13 || nb === 0x14 || nb === 0x18 || nb === 0x52 || (nb === 0x0f && peek(1) === 0x01)) break;
        continue;
      }
      if (t === 0x02) k.time = f32();
      else if (t === 0x03) { if (peek() === 0x01) { p++; k.curveType = u8(); } else k.curveRef = varint(); }
      else if (t === 0x04) k.c1 = f32();
      else if (t === 0x05) k.c2 = f32();
      else if (t === 0x06) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } k.eventName = s2; } else k.c3 = f32(); }
      else if (t === 0x07) k.c4 = f32();
      else if (t === 0x08) k.v1 = f32();
      else if (t === 0x09) k.v2 = f32();
      else if (t === 0x0a) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } if (k.eventName === undefined) k.eventName = s2; } else k.v3 = f32(); }
      else if (t === 0x0b) k.v4 = f32();
      else if (t === 0x0c) { if (peek() === 0x11) k.values = parseFloatList(); else k.f0c = varint(); }
      else if (t === 0x12) { if (peek() === 0x11) k.values = k.values || parseFloatList(); else k.f12 = varint(); }
      else if (t === 0x0d) { if (peek() === 0x2b) { p++; k.attachment_ref = varint(); } else k.f0d = varint(); }
      else if (t === 0x0e) { if (peek() === 0x01 && peek(1) === 0x01) { p += 2; let s2 = ''; for (;;) { const c = u8(); if (c & 0x80) { s2 += String.fromCharCode(c & 0x7f); break; } s2 += String.fromCharCode(c); } k.eventName = s2; } else k.f0e = varint(); }
      else if (t === 0x0f) k.f0f = varint();
      else if (t === 0x10) k.f10 = varint();
      else if (t === 0x11) k.f11 = i32();
      else break; // 未知标签:终止本键。按 varint 吞未知字段曾把 18 01 等记录头当数值,
      // 错位雪崩吞掉后续动画组头(0x18 01 与 12 01/14 01 同为时间线标记)
    }
    return k;
  }
  let guard = 0;
  const animStart = p;
  while (p < buf.length && guard++ < 500000) {
    if (peek() === 0x07 && peek(1) === 0x0f && peek(2) === 0x01) { p += 4; continue; }
    // 动画记录: 12 01 XX XX 04 01 <名称>(第 4-5 字节必为 04 01);
    // 12 01 08 <f32…> 是变形(deform)时间线,误按动画解析会在 expect(04 01) 抛错
    if (peek() === 0x12 && peek(1) === 0x01 && peek(4) === 0x04 && peek(5) === 0x01) {
      p += 2; u8(); u8();
      expect(0x04, 0x01);
      const nm = strv();
      anim = { timelines: [] };
      animations[typeof nm === 'string' ? nm : (resolveRef(nm.__ref) ?? '#ref' + nm.__ref)] = anim;
      group = tl = null; u8();
      continue;
    }
    if (peek() === 0x0f && peek(1) === 0x01) { p += 3; continue; }
    // 组头: 真实形态 13 01 04 00 <refA> 01 <refB>(04 00 强锚点);合成/简化形态 13 01 01 <骨骼ref>
    if (peek() === 0x13 && peek(1) === 0x01 && ((peek(2) === 0x04 && peek(3) === 0x00) || peek(2) === 0x01)) {
      p += 2;
      group = { target: null, refA: null, refB: null, tlIndex: 0 };
      if (peek() === 0x04 && peek(1) === 0x00) { p += 2; group.refA = varint(); }
      if (peek() === 0x01) { p++; group.refB = varint(); group.target = boneId.get(group.refB) ?? null; }
      continue;
    }
    // 时间线: 14 01(09 00 <refA> 01 <refB> 头部 / 08 <f32…> 变形配置)、12 01 08 <f32…>(deform)、
    // 时间线: 14 01(真实头部 "09 00 <refA> 01 <refB>" / 变形 "08 <f32串>";合成/简化形态无引用头)
    // 与 12 01 08 / 18 01(变形)。变形浮点串以哨兵 "11 00000000" 终止,原子跳过防幻影锚点。
    if (peek() === 0x14 && peek(1) === 0x01) {
      p += 2;
      // 时间线类型推断:骨骼组内时间线按 rotate(0)/translate(1)/scale(2) 顺序存储(官方 Spine 二进制规范);
      // 附件/事件组用值启发式兜底
      const isBoneGroup = group?.target && boneId.has(group.refB);
      const inferredKind = isBoneGroup ? (group.tlIndex === 0 ? 'rotate' : group.tlIndex === 1 ? 'translate' : 'scale') : null;
      if (isBoneGroup) group.tlIndex++;
      tl = { group_refA: group?.refA ?? null, group_refB: group?.refB ?? null, target: group?.target ?? null, keys: [], inferredKind };
      if (peek() === 0x09 && peek(1) === 0x00) { p += 2; tl.refA = varint(); }
      if (peek() === 0x01) { p++; tl.refB = varint(); }
      if (tl.refA === undefined && tl.refB === undefined && peek() === 0x08) {
        varint(); // 变形配置头部计数
        skipDeformBlob();
        tl._deform = true;
      } else {
        const trail = [];
        while (peek() !== 0x0f && peek() !== 0x52 && trail.length < 8) trail.push(u8().toString(16));
        tl.trail_raw = trail.join(' ');
      }
      if (anim) anim.timelines.push(tl);
      continue;
    }
    if ((peek() === 0x12 && peek(1) === 0x01 && peek(2) === 0x08) || (peek() === 0x18 && peek(1) === 0x01)) {
      p += 2;
      tl = { group_refA: group?.refA ?? null, group_refB: group?.refB ?? null, target: group?.target ?? null, keys: [], inferredKind: 'deform' };
      if (peek() !== 0x52) varint(); // 头部计数
      skipDeformBlob();
      if (anim) anim.timelines.push(tl);
      continue;
    }
    if (peek() === 0x03 && isGroupTrailer()) { p++; varint(); p += 10; continue; }
    if (peek() === 0x52 && peek(1) === 0x01 && peek(2) === 0x11 && peek(3) === 0x00 && keyPlausible(p)) { const k = parseKey(); if (tl) tl.keys.push(k); continue; }
    u8(); // 未识别字节, 跳过续扫
  }
  const animEnd = p;

  // ── 尾部原始区(事件定义/皮肤/导出设置等) ──
  const tail = buf.subarray(animEnd);
  const tailStrings = [];
  { let i = 0; while (i < tail.length) { let s = '', j = i, ok = false; while (j < tail.length) { const c = tail[j++]; if (c & 0x80) { s += String.fromCharCode(c & 0x7f); ok = true; break; } if (c === 0) break; s += String.fromCharCode(c); if (s.length > 100) break; } if (ok && s.length >= 2 && /^[\x20-\x7e]+$/.test(s)) tailStrings.push(s); i = j; } }

  // ── 附件名/归属兜底(名字节点的驻留引用无法解析时的三级回退) ──
  // 背景:共享附件被多插槽引用时按插槽重复写出,副本的名字是驻留引用(#ref);
  // 单插槽附件(goggles/portal-streaks2)名字节点同样为引用。引用编号需完整对象图
  // id 模拟才能解析,此处按结构特征兜底:
  // ① 签名孪生:同型同宽高(mesh 另比对 uvs)的唯一已命名孪生 → 采用其名
  //    (hoverglow-small ×8 槽 / portal-flare1-3 ×10 槽 / muzzle-ring ×4 槽)
  // ② 槽名兜底:仍无名的附件,slot_hint 恰为无其它附件认领的插槽名 → 名=槽名
  //    (单插槽附件命名惯例:setup 附件名 = 槽名)
  // ③ 槽名±序号:附件名 = 槽名 或 槽名+数字后缀 时归属该槽(muzzle01-05 → slot muzzle;
  //    系列附件按全局字母序写在插槽记录之前,位置 hint 滞后一槽)
  {
    // 签名:类型+宽高;region 附加图片路径引用(f0d_raw)—— 同一附件的跨槽副本共享
    // 路径对象,而尺寸相同的不同附件(windmill 叶片 front/back 同为 32x22)可借此区分
    const sigKey = (a) => String(a.type || '') + '|' + Math.round(a.width || 0) + '|' + Math.round(a.height || 0)
      + '|' + (a.type === 'region' ? String(a.f0d_raw || '') : '');
    const bySig = new Map();
    for (const a of attachments) { const k = sigKey(a); if (!bySig.has(k)) bySig.set(k, []); bySig.get(k).push(a); }
    for (const a of attachments) {
      if (a.name !== undefined) continue;
      const uvEq = (x) => {
        if (!Array.isArray(a.uvs) || !Array.isArray(x.uvs)) return true;
        if (a.uvs.length !== x.uvs.length) return false;
        for (let i = 0; i < a.uvs.length; i++) if (Math.abs(a.uvs[i] - x.uvs[i]) > 1e-4) return false;
        return true;
      };
      const names = new Set((bySig.get(sigKey(a)) || []).filter((x) => x !== a && x.name !== undefined && uvEq(x)).map((x) => x.name));
      if (names.size === 1) a.name = [...names][0];
      else if (a._slotHint) {
        // ①b 签名无孪生/歧义时的槽名去序号匹配:windmill 共享附件 ×15 槽,副本槽名
        // flower-leaf-back2..15,去尾数字 = 已命名的首槽附件名(f0d 路径引用解析不可靠)
        const base = a._slotHint.replace(/\d+$/, '');
        const hit = attachments.find((x) => x !== a && x.name === base);
        if (hit) a.name = base;
      }
    }
    const slotNames = slots.map((s) => s.name);
    const hintCount = new Map();
    for (const a of attachments) if (a._slotHint) hintCount.set(a._slotHint, (hintCount.get(a._slotHint) || 0) + 1);
    // ② 槽名兜底:槽未被任何已命名附件认领(名字与 hint 均未占用)、该 hint 唯一 → 名=槽名
    //    (goggles/portal-streaks2 单插槽附件;stretchyman front-arm-path 等裸多边形 path;
    //    守卫避免 windmill 式共享附件被按槽误命名 —— 那类由 ①b 先行处理)
    const claimed = new Set();
    for (const x of attachments) if (x.name !== undefined) { claimed.add(x.name); if (x._slotHint) claimed.add(x._slotHint); }
    for (const a of attachments) {
      if (a.name !== undefined || !a._slotHint) continue;
      if (!claimed.has(a._slotHint) && slotNames.includes(a._slotHint) && hintCount.get(a._slotHint) === 1) a.name = a._slotHint;
    }
    for (const a of attachments) {
      if (a.name === undefined || !a._slotHint || a._leadBound) continue;
      const cands = slotNames.filter((s) => a.name === s || (a.name.startsWith(s) && /^\d+$/.test(a.name.slice(s.length))));
      if (cands.length === 1) a._slotHint = cands[0];
    }
    // 路径式附件名(goblins 皮肤目录:goblingirl/neck)按基名对齐插槽 —— 二皮肤附件
    // 成批写在全部插槽记录之后,位置 hint 全落到最后一个槽(undie-straps),不可用
    // (lead 已精确绑定的条目跳过:基名可能与插槽名撞车而串槽,如 goblingirl/right-hand-thumb
    //  条目复用 right-hand 的图片名)
    for (const a of attachments) {
      if (a.name === undefined || !a._slotHint || a._leadBound || !String(a.name).includes('/')) continue;
      const base = String(a.name).replace(/^.*\//, '');
      if (slotNames.includes(base)) a._slotHint = base;
    }
    // 裸多边形的 path/clipping 区分:Spine 惯例 path 附件/插槽以 -path 结尾(tank treads-path 等);
    // 字节层尚无法稳定区分(path 的 lengths 区段未逆向),以命名惯例标注
    for (const a of attachments) {
      if (a.type !== 'clipping?') continue;
      const s = String(a.name || '') + ' ' + String(a._slotHint || '');
      if (/path\b|path$/i.test(s)) a.type = 'path';
    }
  }

  // ── 输出 ──
  const roundKey = (k) => {
    const o = {
      time: r2((k.time ?? 0) / 30),
    };
    if (k.eventName !== undefined) o.event = k.eventName;
    if (k.v1 !== undefined) o.value = r2(k.v1);
    if (k.v2 !== undefined) o.value2 = r2(k.v2);
    if (k.attachment_ref !== undefined) o.attachment_ref = k.attachment_ref;
    if (k.values !== undefined) { if (k.values.__ref !== undefined) o.values_ref = k.values.__ref; else o.values = k.values.map(r2); }
    const linear = Math.abs((k.c1 ?? 0) - 0.25) < 1e-6 && (k.c2 ?? 0) === 0 && Math.abs((k.c3 ?? 0) - 0.75) < 1e-6 && (k.c4 ?? 0) === 1;
    if (k.c1 !== undefined && !linear) o.curve = [r2(k.c1), r2(k.c2), r2(k.c3), r2(k.c4)];
    o.ref = k.refA + '/' + k.refB;
    return o;
  };
  // 附件扁平输出(幻影裸多边形过滤:锚点误触 + 解析半途而废(无顶点)—— tank treads-path
  // 变体会产生 hull=66/verts=0 的假 clipping,混入输出会挤占真附件名)
  const attOutArr = attachments.filter(a => a.type !== 'clipping?' || a.vertices).map(a => {
      // 未解析名称引用(#ref)保留原始编号;slot_hint = 解析时所属插槽(骨骼动画编辑器据此归属插槽;多插槽共享附件时仅供参考)
      const o = { name: a.name ?? ('#ref' + (a.name_ref ?? '?')) };
      if (a._path !== undefined && a._path !== o.name) o.path = a._path; // 图片路径(皮肤目录前缀,如 goblin/neck)
      if (a._slotHint) o.slot_hint = a._slotHint;
      if (a.skin) o.skin = a.skin;
      if (a.type) o.type = a.type;
      if (a.x !== undefined) o.x = r2(a.x);
      if (a.y !== undefined) o.y = r2(a.y);
      if (a.rotation !== undefined) o.rotation = r2(a.rotation);
      if (a.width !== undefined) o.width = r2(a.width);
      if (a.height !== undefined) o.height = r2(a.height);
      if (a.scaleX !== undefined && a.scaleX !== 1) o.scaleX = r2(a.scaleX);
      if (a.scaleY !== undefined && a.scaleY !== 1) o.scaleY = r2(a.scaleY);
      if (a.f0d_raw !== undefined) o.f0d_raw = a.f0d_raw; // 图片路径对象引用(region 孪生匹配用)
      if (a.vertices) { if (a.vertices.__ref !== undefined) o.vertices_ref = a.vertices.__ref; else { o.vertices = a.vertices.map(r2); o.vertexCount = a.vertices.length / 2; } }
      // mesh 附件完整几何:uvs/triangles/hull/edges(解码器已解析,导出 .skel 转换器需要)
      if (a.uvs) { if (a.uvs.__ref !== undefined) o.uvs_ref = a.uvs.__ref; else o.uvs = a.uvs.map(r2); }
      if (a.triangles) o.triangles = a.triangles;
      if (a.triangles_ref !== undefined) o.triangles_ref = a.triangles_ref;
      if (a.hull !== undefined) o.hull = a.hull;
      if (a.edges) o.edges = a.edges;
      if (a.edges_ref !== undefined) o.edges_ref = a.edges_ref;
      if (a.edges_raw) o.edges_raw = a.edges_raw;
      // 链接网格(uvs/三角形为驻留引用):按 (宽,高,hull) 与先前解析的内联网格匹配回填共享几何,
      // linked_source 标注来源(编辑器仅存引用编号,此为结构匹配推断)
      if (o.type === 'linkedmesh' && (o.uvs_ref !== undefined || o.vertices_ref !== undefined)) {
        const cands = attachments.filter((s) => s !== a && s.type === 'mesh' && Array.isArray(s.uvs) && Array.isArray(s.vertices)
          && s.width === a.width && s.height === a.height && s.hull === a.hull);
        const src = cands.length === 1 ? cands[0] : (cands.find((s) => JSON.stringify(s.edges) === JSON.stringify(a.edges)) ?? null);
        if (src) {
          o.linked_source = src.name ?? ('#ref' + (src.name_ref ?? '?'));
          if (o.uvs_ref !== undefined) o.uvs = src.uvs.map(r2);
          if (o.vertices_ref !== undefined) { o.vertices = src.vertices.map(r2); o.vertexCount = src.vertices.length / 2; }
          if (o.triangles_ref !== undefined && src.triangles) o.triangles = src.triangles;
          if (o.edges_ref !== undefined && src.edges) o.edges = src.edges;
        }
      }
      if (a.color && a.color !== 'ffffffff') o.color = a.color;
      if (a.lead_ref !== undefined) o.lead_ref = a.lead_ref;
      if (a.link_ref !== undefined) o.link_ref = a.link_ref;
      return o;
  });
  // 皮肤分组输出(运行时 JSON 形态:[{name, attachments: {slot: {key: att}}}];default 在前,
  // 其余按块发现顺序;条目键 = 编辑器附件名(显式键节点)或插槽名,附件对象与扁平列表同源)
  {
    const byRaw = new Map(attachments.map((a, i) => [a, attOutArr[i]]).filter(([, o]) => o !== undefined));
    const skinEntryMap = new Map(); // skinName → Map(slot → [att…])
    for (const a of attachments) {
      const o = byRaw.get(a);
      if (!o) continue; // 幻影裸多边形
      const slot = a._slotHint || '(unknown)';
      if (!skinEntryMap.has(a.skin)) skinEntryMap.set(a.skin, new Map());
      const bySlot = skinEntryMap.get(a.skin);
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push([a._skinKey, o]);
    }
    var skinsOut = [];
    for (const sn of ['default', ...skinOrder]) {
      if (!skinEntryMap.has(sn)) continue;
      const atts = {};
      for (const [slot, entries] of skinEntryMap.get(sn)) {
        const seen = new Set();
        atts[slot] = Object.fromEntries(entries.map(([k, o]) => {
          let key = k, n = 2;
          while (seen.has(key)) key = `${k}#${n++}`; // 同插槽同键兜底(不应出现,防覆盖)
          seen.add(key);
          return [key, o];
        }));
      }
      skinsOut.push({ name: sn, attachments: atts });
    }
  }
  const out = {
    _format: {
      source: path.basename(file),
      spineProjectVersion: version,
      generator: 'spineProjectToJson.js (reverse-engineered .spine reader)',
      notes: '时间已换算为秒(帧/30); *_ref 为编辑器内部对象引用编号; raw 字段为未完全逆向的编辑器数据。',
    },
    skeleton: { name: projName, images: imagesName, spine: version },
    bones: bones.map(b => {
      const o = { name: b.name };
      if (b.parent) o.parent = b.parent;
      // 0a-0e 组 = setup 姿势(与导出 JSON 精确一致);04-09 组另存 _pose(编辑器当前姿态,ess 中两组相同)
      const sx = b.x2 !== undefined ? b.x2 : b.x, sy = b.y2 !== undefined ? b.y2 : b.y;
      const srot = b.rotation2 !== undefined ? b.rotation2 : b.rotation;
      const ssx = b.scaleX2 !== undefined ? b.scaleX2 : b.scaleX, ssy = b.scaleY2 !== undefined ? b.scaleY2 : b.scaleY;
      if (sx) o.x = r2(sx);
      if (sy) o.y = r2(sy);
      if (srot) o.rotation = r2(srot);
      if (b.length) o.length = r2(b.length);
      if (ssx !== undefined && ssx !== 1) o.scaleX = r2(ssx);
      if (ssy !== undefined && ssy !== 1) o.scaleY = r2(ssy);
      if (b.color) o.color = b.color;
      if (b.inheritFlags !== undefined) o.inheritFlags_raw = b.inheritFlags;
      return o;
    }),
    slots: slots.map(s => {
      const o = { name: s.name, bone: s.bone };
      if (s.color) o.color = s.color;
      if (s.darkColor) o.darkColor = s.darkColor;
      if (s.attachment_ref !== undefined) o.attachment_ref = s.attachment_ref;
      if (s.f07 !== undefined) o.f07_raw = s.f07;
      return o;
    }),
    attachments: attOutArr,
    skins: skinsOut,
    animations: Object.fromEntries(Object.entries(animations).map(([name, a]) => [name, {
      timelines: a.timelines.map(t => {
        // 时间线类型推断:骨骼组用索引(inferredKind) + 值启发式交叉验证
        // 问题:当骨骼缺少某些通道(如只有 translate 无 rotate)时,索引推断会错位
        // 修正:inferredKind 与 key 值矛盾时,以值为准
        let kind;
        if (t.keys.some(k => k.eventName !== undefined)) kind = 'event';
        else if (t.keys.some(k => k.attachment_ref !== undefined)) kind = 'attachment';
        else if (t.keys.some(k => k.values !== undefined)) kind = 'deform';
        else if (t._deform || t.inferredKind === 'deform') kind = 'deform'; // 12/14/18 01 变形时间线(08 浮点串头)
        else if (t.keys.length && t.keys.every(k => (k.v1 ?? 0) === 0 && (k.v2 ?? 0) === 0)) kind = 'zero'; // 编辑器全零通道,官方导出剔除
        else {
          const hasV2 = t.keys.some(k => (k.v2 ?? 0) !== 0);
          const hasV1 = t.keys.some(k => k.v1 !== undefined);
          const inf = t.inferredKind;
          // 索引推断与值矛盾 -> 以值为准(rotate 只有 v1,translate/scale 有 v1+v2)
          if (inf === 'rotate' && hasV2) kind = 'translate';
          else if (inf === 'translate' && !hasV2 && hasV1) kind = 'rotate';
          else if (inf === 'scale' && !hasV2 && hasV1) kind = 'rotate';
          else kind = inf || (hasV2 ? 'translate' : hasV1 ? 'rotate' : t.keys.length ? 'other' : 'empty');
        }
        return {
          kind,
          target: t.target ?? undefined,
          group_refs: [t.group_refA, t.group_refB],
          refs: [t.refA ?? null, t.refB ?? null],
          trail_raw: t.trail_raw,
          keys: t.keys.map(roundKey),
        };
      }),
    }])),
    _tail: {
      offset: '0x' + animEnd.toString(16),
      length: tail.length,
      note: '动画区之后的编辑器数据(事件定义/导出设置等), 尚未完全解析',
      strings: tailStrings,
      hex_preview: '0x' + Math.min(tail.length, 256).toString(16) + ' bytes: ' + tail.subarray(0, 256).toString('hex'),
      rawBase64: tail.length ? tail.toString('base64') : '', // 原始字节:导出 round-trip 时可原样回嵌
    },
  };
  return out;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法: node spineProjectToJson.js <file.spine> [输出.json]'); process.exit(1); }
  const out = convert(file);
  const outFile = process.argv[3] || file.replace(/\.spine$/i, '') + '.decoded.json';
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`已转换: ${file}\n输出: ${outFile}`);
  console.log(`骨骼 ${out.bones.length}, 插槽 ${out.slots.length}, 附件 ${out.attachments.length}, 皮肤 ${out.skins.length}, 动画 ${Object.keys(out.animations).length}`);
}

/**
 * 轻量探测:文件是否为可识别的 Spine 编辑器二进制工程(.spine)。
 * 校验:① 能以 raw DEFLATE 解压;② 头部前 32 字节内存在 x.y.z 版本串;
 * ③ 解压数据含首骨骼记录锚点 0c 01 1a 00(骨骼数因文件而异,不能用固定计数字节)。
 * 失败时抛错(错误信息即原因)。
 */
function probe(filePath) {
  let raw;
  try {
    raw = zlib.inflateRawSync(fs.readFileSync(filePath));
  } catch (e) {
    throw new Error('不是 Spine 工程文件(raw DEFLATE 解压失败)');
  }
  if (!raw || raw.length < 16) throw new Error('不是 Spine 工程文件(解压后数据过短)');
  // 头部版本串:逐字符、末字符高位置 1 终止;在偏移 0..32 内扫描以提高容错
  let version = null;
  for (let off = 0; off + 4 <= Math.min(32, raw.length) && !version; off++) {
    if (!/\d/.test(String.fromCharCode(raw[off]))) continue;
    let s = '';
    for (let i = off; i < raw.length; i++) {
      const c = raw[i];
      if (c & 0x80) { s += String.fromCharCode(c & 0x7f); break; }
      if (c < 0x20) break;
      s += String.fromCharCode(c);
      if (s.length > 24) break;
    }
    if (/^(\d+)\.(\d+)\.(\d+)$/.test(s)) version = s;
  }
  if (!version) throw new Error('未检测到工程版本号(x.y.z)');
  if (raw.indexOf(Buffer.from([0x0c, 0x01, 0x1a, 0x00])) < 0) {
    throw new Error('未检测到骨骼区标记,不是 Spine 工程文件');
  }
  return { ok: true, version };
}

/** 转换并写盘(主进程 IPC 用):{ inputPath, outputPath } → { ok, outputPath, version, stats } */
function convertFile({ inputPath, outputPath }) {
  if (!inputPath || !outputPath) throw new Error('缺少输入或输出路径');
  const out = convert(inputPath);
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  let keyCount = 0;
  for (const a of Object.values(out.animations || {})) {
    for (const t of a.timelines || []) keyCount += (t.keys || []).length;
  }
  return {
    ok: true,
    outputPath,
    version: out.skeleton && out.skeleton.spine,
    stats: {
      bones: out.bones.length,
      slots: out.slots.length,
      attachments: out.attachments.length,
      animations: Object.keys(out.animations || {}).length,
      timelineKeys: keyCount,
    },
  };
}

module.exports = { convert, probe, convertFile };
