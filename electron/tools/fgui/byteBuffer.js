'use strict';
/**
 * FGUI .bin 大端 ByteBuffer —— 忠实复刻 FairyGUI 的 ByteBuffer(小端标志默认 false)语义。
 * 字符串表建立前用 ReadString(2 字节长度前缀), 建立后用 ReadS(2 字节索引)。
 */

const OOR_WARN = true;

class ByteBuffer {
  /**
   * @param {Buffer} data 底层字节
   * @param {number} [offset=0] 本缓冲相对 data 的起点
   * @param {number} [length] 缓冲长度(相对 offset), 默认到 data 末尾
   * @param {string[]|null} [stringTable]
   * @param {number} [version=0]
   */
  constructor(data, offset = 0, length = null, stringTable = null, version = 0) {
    this.data = data;
    this.offset = offset;
    this.length = length != null ? length : data.length - offset;
    this._pointer = 0;
    this.stringTable = stringTable;
    this.version = version;
  }

  get pointer() { return this._pointer; }
  set pointer(v) { this._pointer = v; }

  _pos(i) { return this.offset + i; }

  ReadByte() {
    const b = this.data[this._pos(this._pointer)];
    this._pointer += 1;
    return b;
  }

  ReadBool() {
    const v = this.data[this._pos(this._pointer)] === 1;
    this._pointer += 1;
    return v;
  }

  /** 无符号 16 位 */
  ReadShort() {
    const s = this._pos(this._pointer);
    this._pointer += 2;
    return (this.data[s] << 8) | this.data[s + 1];
  }

  ReadUshort() { return this.ReadShort() & 0xffff; }

  /** 有符号 16 位 */
  ReadShortS() {
    const v = this.ReadShort();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  /** 无符号 32 位 */
  ReadInt() {
    const s = this._pos(this._pointer);
    this._pointer += 4;
    return ((this.data[s] << 24) | (this.data[s + 1] << 16) |
            (this.data[s + 2] << 8) | this.data[s + 3]) >>> 0;
  }

  /** 有符号 32 位 */
  ReadIntS() {
    const v = this.ReadInt();
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }

  ReadUint() { return this.ReadInt() >>> 0; }

  ReadFloat() {
    const s = this._pos(this._pointer);
    this._pointer += 4;
    return this.data.readFloatBE(s);
  }

  /** 内联字符串: 2 字节长度 + UTF-8 */
  ReadString() {
    const n = this.ReadUshort();
    const s = this._pos(this._pointer);
    this._pointer += n;
    return this.data.toString('utf8', s, s + n);
  }

  /** 定长 UTF-8 字符串(扩展字符串表用) */
  ReadStringN(n) {
    const s = this._pos(this._pointer);
    this._pointer += n;
    return this.data.toString('utf8', s, s + n);
  }

  /** 字符串表索引: 0xFFFE=null, 0xFFFD="", 越界 → "#OOR<idx>" */
  ReadS() {
    const idx = this.ReadUshort();
    if (idx === 65534) return null;
    if (idx === 65533) return '';
    if (!this.stringTable || idx >= this.stringTable.length) {
      if (OOR_WARN) {
        try {
          process.stderr.write(`WARN ReadS OOR idx=${idx} table=${this.stringTable ? this.stringTable.length : 0}\n`);
        } catch (e) { /* ignore */ }
      }
      return '#OOR' + idx;
    }
    return this.stringTable[idx];
  }

  ReadSArray(cnt) {
    const out = [];
    for (let i = 0; i < cnt; i++) out.push(this.ReadS());
    return out;
  }

  ReadBytes(n) {
    const s = this._pos(this._pointer);
    this._pointer += n;
    return this.data.subarray(s, s + n);
  }

  /** RGBA 4 字节 → '#rrggbbaa' */
  ReadColor() {
    const r = this.ReadByte();
    const g = this.ReadByte();
    const b = this.ReadByte();
    const a = this.ReadByte();
    const h = (v) => v.toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b) + h(a);
  }

  /** 内嵌子缓冲: int 长度 + 子 ByteBuffer */
  ReadBuffer() {
    const cnt = this.ReadInt();
    const sub = new ByteBuffer(this.data, this.offset + this._pointer, cnt, this.stringTable, this.version);
    this._pointer += cnt;
    return sub;
  }

  /** ByteBuffer.ReadPath —— GPath 控制点 (0=CRSpline,1=Bezier,2=Cubic,3=Quad,4=Line) */
  ReadPath() {
    const pts = [];
    const cnt = this.ReadInt();
    for (let i = 0; i < cnt; i++) {
      const ct = this.ReadByte();
      let p;
      if (ct === 1) { // Bezier
        p = { curve: 'Bezier',
              c1: [this.ReadFloat(), this.ReadFloat()],
              c2: [this.ReadFloat(), this.ReadFloat()],
              x: this.ReadFloat(), y: this.ReadFloat() };
      } else if (ct === 2 || ct === 3) { // Cubic / Quad
        p = { curve: ct === 2 ? 'Cubic' : 'Quad',
              c1: [this.ReadFloat(), this.ReadFloat()],
              x: this.ReadFloat(), y: this.ReadFloat() };
      } else {
        p = { curve: ct === 4 ? 'Line' : 'CRSpline',
              x: this.ReadFloat(), y: this.ReadFloat() };
      }
      pts.push(p);
    }
    return pts;
  }

  Skip(n) { this._pointer += n; }

  /** 段表定位: indexTablePos 处的 [segCount(1)][useShort(1)][offsets...], 定位到 block[blockIndex] */
  Seek(indexTablePos, blockIndex) {
    const tmp = this._pointer;
    this._pointer = indexTablePos;
    const segCount = this.data[this._pos(this._pointer)];
    this._pointer += 1;
    if (blockIndex >= segCount) {
      this._pointer = tmp;
      return false;
    }
    const useShort = this.data[this._pos(this._pointer)] === 1;
    this._pointer += 1;
    let newPos;
    if (useShort) {
      this._pointer += 2 * blockIndex;
      newPos = this.ReadShort();
    } else {
      this._pointer += 4 * blockIndex;
      newPos = this.ReadInt();
    }
    if (newPos > 0) {
      this._pointer = indexTablePos + newPos;
      return true;
    }
    this._pointer = tmp;
    return false;
  }
}

/** 返回 buf 中 block[blockIndex] 的 [start, end) 相对 buf 起点的区间; 不存在返回 null */
function segBounds(buf, indexTablePos, blockIndex) {
  const data = buf.data;
  const off = buf.offset;
  const p = off + indexTablePos;
  const segCount = data[p];
  if (blockIndex >= segCount) return null;
  const useShort = data[p + 1] === 1;
  const base = p + 2;
  const offs = [];
  for (let i = 0; i < segCount; i++) {
    if (useShort) {
      const s = base + 2 * i;
      offs.push((data[s] << 8) | data[s + 1]);
    } else {
      const s = base + 4 * i;
      offs.push(((data[s] << 24) | (data[s + 1] << 16) |
                 (data[s + 2] << 8) | data[s + 3]) >>> 0);
    }
  }
  if (offs[blockIndex] <= 0) return null;
  const start = indexTablePos + offs[blockIndex];
  let end = buf.length;
  for (let i = blockIndex + 1; i < offs.length; i++) {
    if (offs[i] > 0) { end = indexTablePos + offs[i]; break; }
  }
  return [start, end];
}

module.exports = { ByteBuffer, segBounds };
