import { SpinePlayer } from './spinePlayer.js';
import { Spine38Player } from './spine38Player.js';
import { DbPlayer } from './dbPlayer.js';
import { probeSkeleton, isLegacy } from './skelProbe.js';

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

/**
 * 播放器工厂:按资源类型 + 版本探测结果构造并加载播放器。
 * PreviewController 与 ThumbnailService 共用,保证行为一致。
 *
 * @param {import('pixi.js').Application} app
 * @param {object} item - { id, type: 'spine'|'dragonbones', filePath, atlasPath }
 * @returns {Promise<{player: object}>} 加载完成的播放器
 */
export async function createPlayer(app, item) {
  const root = `${location.origin}/a/${item.id}`;

  if (item.type === 'spine') {
    const skeletonUrl = `${root}/${encodeURIComponent(basename(item.filePath))}`;
    const atlasName = basename(item.filePath).replace(/\.[^.]+$/, '') + '.atlas';
    const atlasUrl = `${root}/${encodeURIComponent(atlasName)}`;

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
    await player.load({ skeletonUrl, atlasUrl });
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
