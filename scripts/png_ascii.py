# -*- coding: utf-8 -*-
"""把截图转成 ASCII 可视化,便于验证界面布局与渲染内容(纯标准库)"""
import sys
import zlib
import struct
import os

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not png'
    pos = 8
    idat = b''
    w = h = bitdepth = colortype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bitdepth, colortype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    bpp = 4 if colortype == 6 else 3
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        row = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pr) & 255
        out += row
        prev = row
    return w, h, out, bpp

CHARS = ' .:-=+*#%@'
def color_mark(r, g, b):
    mx = max(r, g, b); mn = min(r, g, b)
    if mx < 30:
        return None
    if mx - mn < 40:
        return None  # 灰
    # 高饱和色
    if r > 120 and g > 60 and b < 110 and r > g + 40:
        return 'O'  # 橙/红
    if b > 150 and b > r + 60 and b > g + 40:
        return 'B'  # 蓝
    if g > 120 and g > r + 50 and g > b + 50:
        return 'G'  # 绿
    if r > 150 and g > 80 and b > 150 and abs(r - b) < 60:
        return 'M'  # 紫
    if r > 150 and g > 150 and b < 120:
        return 'Y'
    return None

def ascii_view(path, cols=88, rows=36):
    w, h, pix, bpp = read_png(path)
    cw = w / cols
    ch = h / rows
    lines = []
    for ry in range(rows):
        line = ''
        for rx in range(cols):
            x0, x1 = int(rx * cw), int((rx + 1) * cw)
            y0, y1 = int(ry * ch), int((ry + 1) * ch)
            rs = gs = bs = n = 0
            marks = {}
            sy = max(1, int(ch // 4))
            sx = max(1, int(cw // 4))
            for y in range(y0, min(y1, h), sy):
                base = y * w * bpp
                for x in range(x0, min(x1, w), sx):
                    i = base + x * bpp
                    r = pix[i]; g = pix[i + 1]; b = pix[i + 2]
                    rs += r; gs += g; bs += b; n += 1
                    m = color_mark(r, g, b)
                    if m:
                        marks[m] = marks.get(m, 0) + 1
            if n == 0:
                line += '?'
                continue
            r, g, b = rs // n, gs // n, bs // n
            if marks:
                mark = max(marks, key=marks.get)
                line += mark
                continue
            lum = (r * 3 + g * 6 + b * 1) // 10
            line += CHARS[min(9, lum * 10 // 256)]
        lines.append(line)
    print('====', os.path.basename(path), f'{w}x{h}', '====')
    for l in lines:
        print(l)
    print()

if __name__ == '__main__':
    d = sys.argv[1]
    for f in sorted(os.listdir(d)):
        if f.endswith('.png'):
            ascii_view(os.path.join(d, f))
