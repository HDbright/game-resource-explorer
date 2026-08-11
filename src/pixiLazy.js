'use strict';
/**
 * pixi.js 懒加载(优化应用启动速度)。
 * pixi.js 约 918KB(gzip 259KB), 此前被多模块静态 import → 启动首屏必须下载+解析,
 * 导致界面延迟数秒。统一改为: 首次真正需要 Pixi(预览/缩略图/FGUI 编辑)时才动态导入,
 * 并同步设置 window.PIXI(DragonBones UMD 运行时与各 player 需要)。
 */
let _pixi = null;
let _promise = null;

/** 惰性获取 PIXI 命名空间(首次调用时动态 import pixi.js, 之后复用) */
export async function getPixi() {
  if (_pixi) return _pixi;
  if (!_promise) {
    _promise = import('pixi.js').then((m) => {
      _pixi = m;
      if (typeof window !== 'undefined' && !window.PIXI) window.PIXI = m;
      return m;
    });
  }
  return _promise;
}

/** 运行时获取已加载的 PIXI(供同步方法引用; 须先 await getPixi) */
export function pixiRef() {
  return window.PIXI || _pixi;
}
