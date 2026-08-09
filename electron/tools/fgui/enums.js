'use strict';
/** FGUI 枚举表 —— 与 fgui_bin2xml.py 保持一致(实测验证版) */

// PackageItem 类型
const ITEM_TYPE = {
  0: 'Image', 1: 'MovieClip', 2: 'Sound', 3: 'Component',
  4: 'Atlas', 5: 'Font', 6: 'Misc', 7: 'Unknown',
  8: 'Spine', 9: 'DragonBones', 10: 'Particle',
};

// ObjectType 枚举 —— 8 是 InputText, 漏掉会导致 >=8 的全部类型错位
const OBJ_TYPE = {
  0: 'Image', 1: 'MovieClip', 2: 'Swf', 3: 'Graph', 4: 'Loader',
  5: 'Group', 6: 'Text', 7: 'RichText', 8: 'InputText', 9: 'Component',
  10: 'List', 11: 'Label', 12: 'Button', 13: 'ComboBox',
  14: 'ProgressBar', 15: 'Slider', 16: 'ScrollBar', 17: 'Tree',
  18: 'Loader3D',
};

// 组件派生类型: 子记录首字节恒为 9(Component), 真实类型写在子记录 block6 首字节
const COMPONENT_EXT_TYPES = new Set([11, 12, 13, 14, 15, 16, 17]);

const OVERFLOW_TYPE = { 0: 'visible', 1: 'hidden', 2: 'scroll' };
const SCROLL_TYPE = { 0: 'horizontal', 1: 'vertical', 2: 'both' };
const SCROLLBAR_DISPLAY = { 0: 'default', 1: 'visible', 2: 'auto', 3: 'hidden' };
const LIST_LAYOUT = { 0: 'single_column', 1: 'single_row', 2: 'flow_horizontal', 3: 'flow_vertical', 4: 'pagination' };
const SELECTION_MODE = { 0: 'single', 1: 'multiple', 2: 'multiple_singleclick', 3: 'none' };
const ALIGN_TYPE = { 0: 'left', 1: 'center', 2: 'right' };
const VALIGN_TYPE = { 0: 'top', 1: 'middle', 2: 'bottom' };
const RENDER_ORDER = { 0: 'ascent', 1: 'descent', 2: 'arch' };
const PROGRESS_TITLE = { 0: 'percent', 1: 'value_max', 2: 'value', 3: 'max' };
const BUTTON_MODE = { 0: 'common', 1: 'check', 2: 'radio' };
const POPUP_DIRECTION = { 0: 'auto', 1: 'up', 2: 'down' };
const GROUP_LAYOUT = { 0: 'none', 1: 'horizontal', 2: 'vertical' };
const AUTOSIZE_TYPE = { 0: 'none', 1: 'both', 2: 'height', 3: 'shrink', 4: 'ellipsis' };
const LOADER_FILL = { 0: 'none', 1: 'scale', 2: 'scale_match_height', 3: 'scale_match_width', 4: 'scale_free', 5: 'scale_no_border' };
const FLIP_TYPE = { 0: 'none', 1: 'horizontal', 2: 'vertical', 3: 'both' };
const FILL_METHOD = { 0: 'none', 1: 'horizontal', 2: 'vertical', 3: 'radial90', 4: 'radial180', 5: 'radial360' };
const SHAPE_TYPE = { 0: 'empty', 1: 'rect', 2: 'ellipse', 3: 'polygon', 4: 'regular_polygon' };

// ScrollPane flags 位含义
const SCROLL_FLAGS = [
  [1, 'displayOnLeft'], [2, 'snapToItem'], [4, 'displayInDemand'],
  [8, 'pageMode'], [16, 'touchEffect'], [32, 'touchEffectOff'],
  [64, 'bouncebackEffect'], [128, 'bouncebackEffectOff'],
  [256, 'inertiaDisabled'], [512, 'maskDisabled'],
  [1024, 'floating'], [2048, 'dontClipMargin'],
];

// Gear 索引 <-> 名称
const GEAR_TYPE = { 0: 'Display', 1: 'XY', 2: 'Size', 3: 'Look', 4: 'Color',
                    5: 'Animation', 6: 'Text', 7: 'Icon', 8: 'Display2', 9: 'FontSize' };

// TransitionActionType 枚举
const TAT = { 0: 'XY', 1: 'Size', 2: 'Scale', 3: 'Pivot', 4: 'Alpha', 5: 'Rotation',
              6: 'Color', 7: 'Animation', 8: 'Visible', 9: 'Sound', 10: 'Transition',
              11: 'Shake', 12: 'ColorFilter', 13: 'Skew', 14: 'Text', 15: 'Icon',
              16: 'Unknown' };

// ControllerAction.ActionType 枚举
const ACTION_TYPE = { 0: 'PlayTransition', 1: 'ChangePage', 2: 'PlaySound', 3: 'SetVar', 4: 'SetProp' };

// RelationType 枚举 (28 个)
const RELATION_TYPE = [
  'Left_Left', 'Left_Center', 'Left_Right', 'Center_Left', 'Center_Center',
  'Center_Right', 'Right_Left', 'Right_Center', 'Right_Right', 'Top_Top',
  'Top_Middle', 'Top_Bottom', 'Middle_Top', 'Middle_Middle', 'Middle_Bottom',
  'Bottom_Top', 'Bottom_Middle', 'Bottom_Bottom', 'Width', 'Height',
  'LeftExt_Left', 'LeftExt_Right', 'RightExt_Left', 'RightExt_Right',
  'TopExt_Top', 'TopExt_Bottom', 'BottomExt_Top', 'BottomExt_Bottom',
];

const EASE_CUSTOM = 31;

module.exports = {
  ITEM_TYPE, OBJ_TYPE, COMPONENT_EXT_TYPES,
  OVERFLOW_TYPE, SCROLL_TYPE, SCROLLBAR_DISPLAY, LIST_LAYOUT, SELECTION_MODE,
  ALIGN_TYPE, VALIGN_TYPE, RENDER_ORDER, PROGRESS_TITLE, BUTTON_MODE,
  POPUP_DIRECTION, GROUP_LAYOUT, AUTOSIZE_TYPE, LOADER_FILL, FLIP_TYPE,
  FILL_METHOD, SHAPE_TYPE, SCROLL_FLAGS, GEAR_TYPE, TAT, ACTION_TYPE,
  RELATION_TYPE, EASE_CUSTOM,
};
