// 图片集打包核心算法(MaxRects 装箱 + 多格式导出)
// 纯逻辑模块:不依赖 DOM。图片像素/画布处理放在调用方(渲染进程 canvas)。
//
// 参考 OpenPacker(free-tex-packer fork)的图集打包能力:
//   - 多图合并为一张/多张纹理图集(自动分页)
//   - 支持旋转装箱、透明像素修剪、内边距、强制 2 的幂尺寸
//   - 导出 PixiJS( JSON Hash )/ Phaser3( JSON Array )/ Cocos2d( JSON )/ CSS 雪碧图
//
// 坐标约定(与 TexturePacker 兼容):
//   - 每个精灵在图集内的可见矩形 frame = {x,y,w,h}
//   - rotated=true 表示精灵在图集内顺时针旋转 90°,消费端按逆时针旋回
//   - trimmed=true 表示做了透明像素修剪;精灵源尺寸 sourceSize = {w:srcW,h:srcH}
//     spriteSourceSize.offset = 修剪后区域在原图中的偏移 {x:trimX,y:trimY}

/** MaxRects 装箱器(Best Short Side Fit 启发式,支持旋转) */
export class MaxRectsPacker {
  constructor(width, height) {
    this.binWidth = width;
    this.binHeight = height;
    this.usedRects = [];
    this.freeRects = [{ x: 0, y: 0, width, height }];
  }

  /**
   * 尝试放入一个 w×h 的矩形。允许旋转时也会尝试 h×w。
   * @returns {{x:number,y:number,width:number,height:number,rotated:boolean}|null}
   *          返回在图集中的占位矩形(已按旋转后的占用尺寸展开)
   */
  insert(w, h, allowRotation) {
    let bestNode = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    let bestRotated = false;

    const node = this._scoreNode(w, h);
    if (node.width !== 0) {
      bestNode = node;
      bestShort = node.score1;
      bestLong = node.score2;
      bestRotated = false;
    }
    if (allowRotation) {
      const r = this._scoreNode(h, w);
      if (r.width !== 0) {
        if (r.score1 < bestShort || (r.score1 === bestShort && r.score2 < bestLong)) {
          bestNode = r;
          bestShort = r.score1;
          bestLong = r.score2;
          bestRotated = true;
        }
      }
    }
    if (!bestNode || bestNode.width === 0) return null;

    const placed = {
      x: bestNode.x,
      y: bestNode.y,
      width: bestRotated ? h : w,
      height: bestRotated ? w : h,
      rotated: bestRotated,
    };
    this._placeRect(bestNode);
    return placed;
  }

  _scoreNode(w, h) {
    let best = { x: 0, y: 0, width: 0, height: 0, score1: Infinity, score2: Infinity };
    for (const fr of this.freeRects) {
      if (fr.width >= w && fr.height >= h) {
        const leftoverH = fr.width - w;
        const leftoverV = fr.height - h;
        const shortSide = Math.min(leftoverH, leftoverV);
        const longSide = Math.max(leftoverH, leftoverV);
        if (shortSide < best.score1 || (shortSide === best.score1 && longSide < best.score2)) {
          best.x = fr.x;
          best.y = fr.y;
          best.width = w;
          best.height = h;
          best.score1 = shortSide;
          best.score2 = longSide;
        }
      }
    }
    return best;
  }

  _placeRect(node) {
    const free = this.freeRects;
    for (let i = 0; i < free.length; i++) {
      if (this._splitFreeNode(free[i], node)) {
        free.splice(i, 1);
        i--;
      }
    }
    this._pruneFreeList();
    this.usedRects.push(node);
  }

  _splitFreeNode(freeNode, usedNode) {
    // SAT 判定是否相交
    if (
      usedNode.x >= freeNode.x + freeNode.width ||
      usedNode.x + usedNode.width <= freeNode.x ||
      usedNode.y >= freeNode.y + freeNode.height ||
      usedNode.y + usedNode.height <= freeNode.y
    ) {
      return false;
    }
    // 上下切分
    if (usedNode.x < freeNode.x + freeNode.width && usedNode.x + usedNode.width > freeNode.x) {
      if (usedNode.y > freeNode.y && usedNode.y < freeNode.y + freeNode.height) {
        this.freeRects.push({ x: freeNode.x, y: freeNode.y, width: freeNode.width, height: usedNode.y - freeNode.y });
      }
      if (usedNode.y + usedNode.height < freeNode.y + freeNode.height) {
        this.freeRects.push({
          x: freeNode.x,
          y: usedNode.y + usedNode.height,
          width: freeNode.width,
          height: freeNode.y + freeNode.height - (usedNode.y + usedNode.height),
        });
      }
    }
    // 左右切分
    if (usedNode.y < freeNode.y + freeNode.height && usedNode.y + usedNode.height > freeNode.y) {
      if (usedNode.x > freeNode.x && usedNode.x < freeNode.x + freeNode.width) {
        this.freeRects.push({ x: freeNode.x, y: freeNode.y, width: usedNode.x - freeNode.x, height: freeNode.height });
      }
      if (usedNode.x + usedNode.width < freeNode.x + freeNode.width) {
        this.freeRects.push({
          x: usedNode.x + usedNode.width,
          y: freeNode.y,
          width: freeNode.x + freeNode.width - (usedNode.x + usedNode.width),
          height: freeNode.height,
        });
      }
    }
    return true;
  }

  _pruneFreeList() {
    const free = this.freeRects;
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (this._isContainedIn(free[i], free[j])) {
          free.splice(i, 1);
          i--;
          break;
        }
        if (this._isContainedIn(free[j], free[i])) {
          free.splice(j, 1);
        }
      }
    }
  }

  _isContainedIn(a, b) {
    return (
      a.x >= b.x &&
      a.y >= b.y &&
      a.x + a.width <= b.x + b.width &&
      a.y + a.height <= b.y + b.height
    );
  }
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * 把若干图片打包成一张或多张图集。
 * @param {Array<{name:string,srcW:number,srcH:number,trimX:number,trimY:number,trimW:number,trimH:number,img?:any}>} items
 * @param {object} opts { maxSize, padding, allowRotation, pot, imgMap? }
 * @returns {Array<{width:number,height:number,placements:Array}>} pages
 *   每个 placement: { name, srcW, srcH, trimX, trimY, trimW, trimH, ax, ay, rotated, img }
 */
export function packImages(items, opts) {
  const maxSize = opts.maxSize || 2048;
  const pad = Math.max(0, (opts.padding | 0));
  const allowRotation = !!opts.allowRotation;
  const pot = !!opts.pot;

  // 面积降序:大图先放,装箱更紧凑
  const sorted = items.slice().sort((a, b) => b.trimW * b.trimH - a.trimW * a.trimH);
  const pages = [];
  const newPage = (w, h) => {
    const p = { width: w, height: h, packer: new MaxRectsPacker(w, h), placements: [] };
    pages.push(p);
    return p;
  };
  newPage(maxSize, maxSize);

  for (const it of sorted) {
    const fw = it.trimW + pad * 2;
    const fh = it.trimH + pad * 2;
    let placed = null;
    let pageRef = null;
    for (const p of pages) {
      const node = p.packer.insert(fw, fh, allowRotation);
      if (node) {
        placed = node;
        pageRef = p;
        break;
      }
    }
    if (!placed) {
      // 当前所有页都放不下 → 新建一页(必要时放大到能容纳该图)
      let pw = maxSize;
      let ph = maxSize;
      if (fw > maxSize || fh > maxSize) {
        pw = nextPow2(Math.max(fw, maxSize));
        ph = nextPow2(Math.max(fh, maxSize));
      }
      const p = newPage(pw, ph);
      placed = p.packer.insert(fw, fh, allowRotation);
      pageRef = p;
    }
    if (!placed) {
      // 理论上不会发生(新页已按尺寸放大),兜底:左上角溢出放置
      placed = { x: 0, y: 0, width: fw, height: fh, rotated: false };
      pageRef = pages[pages.length - 1];
    }

    const rotated = !!placed.rotated;
    const ax = placed.x + pad; // 实际绘制(已修剪区域)的左上角
    const ay = placed.y + pad;
    pageRef.placements.push({
      name: it.name,
      srcW: it.srcW,
      srcH: it.srcH,
      trimX: it.trimX,
      trimY: it.trimY,
      trimW: it.trimW,
      trimH: it.trimH,
      ax,
      ay,
      rotated,
      img: it.img,
    });
  }

  // 按实际占用收紧/可选 POT 上取整页面尺寸
  for (const p of pages) {
    let maxX = 0;
    let maxY = 0;
    for (const pl of p.placements) {
      const pw = pl.rotated ? pl.trimH + pad * 2 : pl.trimW + pad * 2;
      const ph = pl.rotated ? pl.trimW + pad * 2 : pl.trimH + pad * 2;
      maxX = Math.max(maxX, pl.ax - pad + pw);
      maxY = Math.max(maxY, pl.ay - pad + ph);
    }
    let w = Math.max(1, maxX);
    let h = Math.max(1, maxY);
    if (pot) {
      w = nextPow2(w);
      h = nextPow2(h);
    }
    p.width = w;
    p.height = h;
  }
  return pages;
}

// 计算某 placement 在图集内的可见矩形 frame(已考虑旋转)
function frameOf(pl) {
  if (pl.rotated) return { x: pl.ax, y: pl.ay, w: pl.trimH, h: pl.trimW };
  return { x: pl.ax, y: pl.ay, w: pl.trimW, h: pl.trimH };
}
function isTrimmed(pl) {
  return pl.trimW !== pl.srcW || pl.trimH !== pl.srcH;
}
function metaObj(app, image, page) {
  return {
    app,
    version: '1.0',
    image,
    format: 'RGBA8888',
    size: { w: page.width, h: page.height },
    scale: 1,
  };
}
function cssEscape(s) {
  return String(s).replace(/[^\w-]/g, '_');
}

/**
 * 把打包结果序列化为导出文件(图集 PNG 由调用方另存)。
 * @param {string} format 'pixi' | 'phaser' | 'cocos' | 'css'
 * @param {Array} pages packImages 的返回
 * @param {string} prefix 输出文件名前缀
 * @returns {{pagePngNames:string[], metaFiles:Array<{name:string,content:string}>}}
 */
export function serializeAtlas(format, pages, prefix) {
  const APP = '游戏资源管理器 · 图片集打包';
  const pagePngNames = pages.map((p, i) =>
    pages.length > 1 ? `${prefix}_${i}.png` : `${prefix}.png`
  );
  const metaFiles = [];

  if (format === 'css') {
    let css = `/* Sprite sheet generated by ${APP} */\n`;
    for (let i = 0; i < pages.length; i++) {
      const img = pagePngNames[i];
      for (const pl of pages[i].placements) {
        const f = frameOf(pl);
        css +=
          `.${cssEscape(prefix)}-${cssEscape(pl.name)} ` +
          `{ background-image:url(${img}); background-repeat:no-repeat; ` +
          `background-position:-${f.x}px -${f.y}px; width:${f.w}px; height:${f.h}px; }\n`;
      }
    }
    metaFiles.push({ name: `${prefix}.css`, content: css });
    return { pagePngNames, metaFiles };
  }

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const img = pagePngNames[i];
    const baseName = pages.length > 1 ? `${prefix}_${i}` : prefix;

    if (format === 'pixi') {
      const frames = {};
      for (const pl of p.placements) {
        const f = frameOf(pl);
        frames[pl.name] = {
          frame: { x: f.x, y: f.y, w: f.w, h: f.h },
          rotated: !!pl.rotated,
          trimmed: isTrimmed(pl),
          spriteSourceSize: { x: pl.trimX, y: pl.trimY, w: pl.srcW, h: pl.srcH },
          sourceSize: { w: pl.srcW, h: pl.srcH },
        };
      }
      metaFiles.push({
        name: `${baseName}.json`,
        content: JSON.stringify({ frames, meta: metaObj(APP, img, p) }, null, 2),
      });
    } else if (format === 'phaser') {
      const frames = p.placements.map((pl) => {
        const f = frameOf(pl);
        return {
          filename: pl.name,
          frame: { x: f.x, y: f.y, w: f.w, h: f.h },
          rotated: !!pl.rotated,
          trimmed: isTrimmed(pl),
          spriteSourceSize: { x: pl.trimX, y: pl.trimY, w: pl.srcW, h: pl.srcH },
          sourceSize: { w: pl.srcW, h: pl.srcH },
        };
      });
      metaFiles.push({
        name: `${baseName}.json`,
        content: JSON.stringify({ frames, meta: metaObj(APP, img, p) }, null, 2),
      });
    } else if (format === 'cocos') {
      const frames = {};
      for (const pl of p.placements) {
        const f = frameOf(pl);
        frames[pl.name] = {
          rect: [f.x, f.y, f.w, f.h],
          rotated: !!pl.rotated,
          offset: [pl.trimX, pl.trimY],
          sourceSize: { w: pl.srcW, h: pl.srcH },
        };
      }
      metaFiles.push({
        name: `${baseName}.json`,
        content: JSON.stringify({ frames, meta: metaObj(APP, img, p) }, null, 2),
      });
    }
  }
  return { pagePngNames, metaFiles };
}
