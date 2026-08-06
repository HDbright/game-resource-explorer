# -*- coding: utf-8 -*-
"""生成内置 Spine 示例资源与应用图标(纯标准库,无第三方依赖)"""
import os
import zlib
import struct
import json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------- PNG 写入(纯标准库) ----------
def write_png(path, w, h, scene_fn, ss=4):
    def sample(x, y):
        r = g = b = a = 0
        n = 0
        for i in range(ss):
            for j in range(ss):
                r2, g2, b2, a2 = scene_fn(x + (i + 0.5) / ss, y + (j + 0.5) / ss)
                r += r2; g += g2; b += b2; a += a2
                n += 1
        return (round(r / n), round(g / n), round(b / n), round(a / n))

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        for x in range(w):
            raw += bytes(sample(x, y))

    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('written', path, f'{w}x{h}')


# ---------- 形状辅助 ----------
def inside_rounded_rect(x, y, rx, ry, w, h, corner):
    if x < rx or x >= rx + w or y < ry or y >= ry + h:
        return False
    # 四角圆弧
    for cx, cy in ((rx + corner, ry + corner), (rx + w - corner - 1, ry + corner),
                   (rx + corner, ry + h - corner - 1), (rx + w - corner - 1, ry + h - corner - 1)):
        if (x - cx) ** 2 + (y - cy) ** 2 <= corner ** 2:
            return True
    if corner <= x < rx + w - corner or corner <= y < ry + h - corner:
        return True
    return False


def inside_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2


# ---------- Spine 示例:小英雄 ----------
def gen_spine_sample():
    out = os.path.join(BASE, 'samples', 'spine_hero')
    os.makedirs(out, exist_ok=True)

    def hero_scene(x, y):
        # body: 蓝色圆角矩形 (0,0,80,100)
        if inside_rounded_rect(x, y, 0, 0, 80, 100, 14):
            return (63, 142, 252, 255)
        # head: 橙色圆形 (120,30) r=30
        if inside_circle(x, y, 120, 30, 30):
            return (255, 176, 63, 255)
        # arm: 紫色圆角矩形 (160,0,24,70)
        if inside_rounded_rect(x, y, 160, 0, 24, 70, 10):
            return (155, 89, 182, 255)
        return (0, 0, 0, 0)

    write_png(os.path.join(out, 'hero.png'), 200, 128, hero_scene)

    # 注意:Spine atlas 格式不允许空行(空行会导致解析器把区域名误判为新页面)
    atlas = """hero.png
size: 200,128
format: RGBA8888
filter: Linear,Linear
repeat: none
body
  rotate: false
  xy: 0, 0
  size: 80, 100
  orig: 80, 100
  offset: 0, 0
  index: -1
head
  rotate: false
  xy: 90, 0
  size: 60, 60
  orig: 60, 60
  offset: 0, 0
  index: -1
arm
  rotate: false
  xy: 160, 0
  size: 24, 70
  orig: 24, 70
  offset: 0, 0
  index: -1
"""
    with open(os.path.join(out, 'hero.atlas'), 'w', encoding='utf-8') as f:
        f.write(atlas)

    skeleton = {
        "skeleton": {"spine": "3.8.99", "images": "", "fps": 30, "hash": "spine-viewer-sample", "name": "hero"},
        "bones": [
            {"name": "root"},
            {"name": "head", "parent": "root", "y": -45},
            {"name": "arm", "parent": "root", "x": 0, "y": -8},
        ],
        "slots": [
            {"name": "body", "bone": "root", "attachment": "body"},
            {"name": "head", "bone": "head", "attachment": "head"},
            {"name": "arm", "bone": "arm", "attachment": "arm"},
        ],
        "skins": {
            "default": {
                "body": {"body": {"name": "body", "path": "body", "x": 0, "y": 15, "rotation": 0, "width": 80, "height": 100}},
                "head": {"head": {"name": "head", "path": "head", "x": 0, "y": 0, "rotation": 0, "width": 60, "height": 60}},
                "arm": {"arm": {"name": "arm", "path": "arm", "x": 0, "y": 0, "rotation": 0, "width": 24, "height": 70}},
            }
        },
        "animations": {
            "idle": {
                "bones": {
                    "root": {"rotate": [{"time": 0, "angle": 0}, {"time": 1, "angle": 12}, {"time": 2, "angle": 0}]},
                    "head": {"rotate": [{"time": 0, "angle": 0}, {"time": 1, "angle": -8}, {"time": 2, "angle": 0}]},
                    "arm": {"rotate": [{"time": 0, "angle": 0}, {"time": 1, "angle": -40}, {"time": 2, "angle": 0}]},
                }
            },
            "wave": {
                "bones": {
                    "arm": {"rotate": [
                        {"time": 0, "angle": 0},
                        {"time": 0.4, "angle": -75},
                        {"time": 0.8, "angle": -15},
                        {"time": 1.2, "angle": -75},
                        {"time": 1.6, "angle": 0},
                    ]}
                }
            },
            "walk": {
                "bones": {
                    "root": {
                        "rotate": [{"time": 0, "angle": 0}, {"time": 0.5, "angle": -6}, {"time": 1, "angle": 0}],
                        "translate": [
                            {"time": 0, "x": 0, "y": 0},
                            {"time": 0.5, "x": 40, "y": -4},
                            {"time": 1, "x": 80, "y": 0},
                        ],
                    },
                    "arm": {"rotate": [{"time": 0, "angle": 0}, {"time": 0.5, "angle": -60}, {"time": 1, "angle": 0}]},
                }
            },
        },
        "defaultSkin": "default",
    }
    with open(os.path.join(out, 'hero.json'), 'w', encoding='utf-8') as f:
        json.dump(skeleton, f, ensure_ascii=False)
    print('written', os.path.join(out, 'hero.json'))


# ---------- 应用图标 ----------
def gen_icon():
    out = os.path.join(BASE, 'build')
    os.makedirs(out, exist_ok=True)
    size = 256

    def icon_scene(x, y):
        # 深色圆角底板
        if not inside_rounded_rect(x, y, 0, 0, size, size, 56):
            return (0, 0, 0, 0)
        # 渐变背景(垂直)
        t = y / size
        bg = (int(24 + 20 * t), int(26 + 22 * t), int(32 + 28 * t), 255)
        # 骨骼:两端圆 + 中杆(斜 45 度)
        cx, cy = size / 2, size / 2
        half = 62
        # 旋转 45 度坐标
        import math
        c, s = math.cos(math.radians(-45)), math.sin(math.radians(-45))
        rx = (x - cx) * c - (y - cy) * s + cx
        ry = (x - cx) * s + (y - cy) * c + cy
        bone_color = (79, 140, 255, 255)
        # 中杆
        if abs(rx - cx) < 16 and abs(ry - cy) < half + 6:
            return bone_color
        # 两端圆
        for ex in (cx - half, cx + half):
            if inside_circle(rx, ry, ex, cy, 26):
                return bone_color
        return bg

    write_png(os.path.join(out, 'icon.png'), size, size, icon_scene, ss=3)


if __name__ == '__main__':
    gen_spine_sample()
    gen_icon()
    print('done')
