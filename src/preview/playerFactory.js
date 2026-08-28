import { SpinePlayer } from './spinePlayer.js';
import { Spine38Player } from './spine38Player.js';
import { DbPlayer } from './dbPlayer.js';
import { probeSkeleton, isLegacy } from './skelProbe.js';
import { getPixi } from '../pixiLazy.js';

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

/**
 * 播放器工厂:按资源类型 + 版本探测结果构造并加载播放器。
 * PreviewController 与 ThumbnailService 共用,保证行为一致。
 *
 * LayaAir .sk 一律使用官方引擎方案(Templet 解析 + Skeleton 驱动 + pixi 提取渲染)。
 *
 * @param {import('pixi.js').Application} app
 * @param {object} item - { id, type: 'spine'|'dragonbones', filePath, atlasPath }
 * @returns {Promise<{player: object}>} 加载完成的播放器
 */
export async function createPlayer(app, item) {
  const root = `${location.origin}/a/${item.id}`;
  await getPixi(); // 首次创建播放器时加载 pixi.js 并确保 window.PIXI(DragonBones UMD / player 运行时)

  // ---- LayaAir 骨骼动画 .sk:官方引擎驱动,提取顶点到 pixi 渲染 ----
  if (/\.sk$/i.test(item.filePath || '')) {
    const { LayaSkPlayer } = await import('./layaSkPlayer.js');
    const player = new LayaSkPlayer(app);
    const name = basename(item.filePath);
    const pngName = name.replace(/\.[^.]+$/, '') + '.png';
    await player.load({
      skUrl: `${root}/${encodeURIComponent(name)}`,
      pngUrl: `${root}/${encodeURIComponent(pngName)}`,
      urlKey: item.filePath,
    });
    return { player };
  }

  if (item.type === 'spine') {
    const skelBase = basename(item.filePath).replace(/\.[^.]+$/, '');
    const skeletonUrl = `${root}/${encodeURIComponent(basename(item.filePath))}`;

    // atlas 匹配链:
    //   1. 同名 atlas (goblins-ess.atlas)
    //   2. 去掉 -ess / -pro 后缀的 atlas (goblins.atlas)
    //   3. images/ 目录下的解包图片(无 atlas 时回退)
    const atlasCandidates = [skelBase + '.atlas'];
    const stripped = skelBase.replace(/-(?:ess|pro)$/i, '');
    if (stripped !== skelBase) atlasCandidates.push(stripped + '.atlas');

    let atlasUrl = null;
    for (const name of atlasCandidates) {
      const url = `${root}/${encodeURIComponent(name)}`;
      try {
        const res = await fetch(url);
        if (res.ok) { atlasUrl = url; break; }
      } catch (_) { /* ignore */ }
    }

    // 版本探测:3.x 资源(JSON 或二进制 skel)→ 3.8 运行时;
    // 其余(4.x JSON / 4.x skel)→ 4.x 运行时。
    let probe = null;
    try {
      const res = await fetch(skeletonUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      probe = probeSkeleton(buf);
    } catch (err) {
      probe = null; // 探测失败则走默认 4.x 运行时,由其报错
    }
    const player = isLegacy(probe) ? new Spine38Player(app) : new SpinePlayer(app);
    await player.load({ skeletonUrl, atlasUrl, imageDir: atlasUrl ? null : `${root}/images` });
    return { player };
  }

  if (item.type === 'dragonbones') {
    const skeletonUrl = `${root}/${encodeURIComponent(basename(item.filePath))}`;
    let atlasBase;
    if (item.atlasPath) {
      atlasBase = basename(item.atlasPath);
    } else {
      const skelJson = await (await fetch(skeletonUrl)).json();
      atlasBase = (skelJson.name || basename(item.filePath).replace(/\.[^.]+$/, '')) + '_tex.json';
    }
    const atlasUrl = `${root}/${encodeURIComponent(atlasBase)}`;
    const player = new DbPlayer(app);
    await player.load({ skeletonUrl, atlasUrl });
    return { player };
  }

  throw new Error('不支持的资源类型:' + item.type);
}
