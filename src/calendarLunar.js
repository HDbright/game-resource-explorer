// 农历 / 24节气 / 节假日工具(供 Todo-List 日历使用)
// 农历:1900-2100 年压缩数据表 + 公历转农历算法(经典实现)
// 节气:sTermInfo 世纪参数法(近似定气,与主流农历库一致)
// 节假日:公历固定节日 + 农历节日(按当年农历推算) + 清明(节气节日)

// ---------------- 农历年数据表(1900-2100) ----------------
// 每项 16 进制位:低 4 位=闰月月份(0=无闰月);0x10000 位=闰月大小月(30/29);
// 0x8000>>m 位=第 m 个月大小(30/29)。
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
];
const MIN_YEAR = 1900, MAX_YEAR = 2100;

// ---------------- 节气(世纪参数法) ----------------
// sTermInfo[n] 为第 n 个节气相对基准的分钟偏移;n=0 小寒(1月6日左右)
const TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];
const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

/** 第 n 个节气(0=小寒)在 y 年出现的 UTC 日期号(1-31) */
function solarTermDay(y, n) {
  const off = new Date((31556925974.7 * (y - 1900) + TERM_INFO[n] * 60000) + Date.UTC(1900, 0, 6, 2, 5));
  return off.getUTCDate();
}

// ---------------- 农历基础 ----------------
function lYearDays(y) {
  let i, sum = 348;
  for (i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - MIN_YEAR] & i) ? 1 : 0;
  return sum + lLeapDays(y);
}
function lLeapMonth(y) { return LUNAR_INFO[y - MIN_YEAR] & 0xf; }
function lLeapDays(y) { return lLeapMonth(y) ? ((LUNAR_INFO[y - MIN_YEAR] & 0x10000) ? 30 : 29) : 0; }
function lMonthDays(y, m) { return (LUNAR_INFO[y - MIN_YEAR] & (0x10000 >> m)) ? 30 : 29; }

const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const CN_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

function formatLunarDay(d) {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  if (d < 10) return '初' + CN_NUM[d];
  if (d < 20) return '十' + CN_NUM[d % 10];
  return '廿' + CN_NUM[d % 10];
}
function formatLunarMonth(m, isLeap) {
  return (isLeap ? '闰' : '') + CN_MONTH[m - 1] + '月';
}

/**
 * 公历 y-m-d → 农历信息
 * @returns {{lunarYear:number, lunarMonth:number, lunarDay:number, isLeap:boolean}}
 */
export function solar2lunar(y, m, d) {
  const baseDate = Date.UTC(1900, 0, 31);
  const objDate = Date.UTC(y, m - 1, d);
  let offset = Math.floor((objDate - baseDate) / 86400000);
  let i, temp = 0;
  for (i = MIN_YEAR; i < MAX_YEAR && offset > 0; i++) { temp = lYearDays(i); offset -= temp; }
  if (offset < 0) { offset += temp; i--; }
  const year = i;
  let leap = lLeapMonth(year);
  let isLeap = false;
  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = lLeapDays(year); }
    else { temp = lMonthDays(year, i); }
    if (isLeap && i === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && i === leap + 1) {
    if (isLeap) { isLeap = false; } else { isLeap = true; --i; }
  }
  if (offset < 0) { offset += temp; --i; }
  return { lunarYear: year, lunarMonth: i, lunarDay: offset + 1, isLeap };
}

// ---------------- 节日规则 ----------------
// 公历固定节日(月-日 → 名称)
const SOLAR_HOLIDAYS = {
  '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '3-12': '植树节',
  '4-1': '愚人节', '5-1': '劳动节', '5-4': '青年节', '6-1': '儿童节',
  '7-1': '建党节', '8-1': '建军节', '9-10': '教师节', '10-1': '国庆节',
  '12-24': '平安夜', '12-25': '圣诞节',
};
// 农历节日(月-日 → 名称;闰月不计)
const LUNAR_HOLIDAYS = {
  '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节',
  '7-7': '七夕', '7-15': '中元节', '8-15': '中秋节', '9-9': '重阳节',
  '12-8': '腊八节', '12-23': '小年',
};
// 节气节日(节气名 → 节日名)
const TERM_HOLIDAYS = { '清明': '清明节' };

/**
 * 获取 y-m-d 的农历/节气/节假日展示信息
 * @returns {{lunarText:string, term:string, holiday:string, isLeapMonth:boolean, lunarMonth:number, lunarDay:number}}
 * lunarText: 农历日文字(初一显示「六月」,普通日显示「十五」;节气日仍显示农历日供参考)
 * term: 节气名(当日为节气,否则 '')
 * holiday: 节日名(当日为公历/农历/节气节日,否则 '')
 */
export function getLunarInfo(y, m, d) {
  const l = solar2lunar(y, m, d);
  // 农历日文字(完整格式:「七月初五」「正月初一」「闰六月十五」)
  const lunarText = formatLunarMonth(l.lunarMonth, l.isLeap) + formatLunarDay(l.lunarDay);
  // 节气
  let term = '';
  const termIdx = (m - 1) * 2; // 第 m 月的两个节气:index (m-1)*2, (m-1)*2+1
  for (let k = 0; k < 2; k++) {
    const n = termIdx + k;
    if (n < 0 || n >= 24) continue;
    if (solarTermDay(y, n) === d) { term = TERM_NAMES[n]; break; }
  }
  // 节日:节气节日 > 公历节日 > 农历节日
  let holiday = '';
  if (term && TERM_HOLIDAYS[term]) holiday = TERM_HOLIDAYS[term];
  if (!holiday) holiday = SOLAR_HOLIDAYS[`${m}-${d}`] || '';
  if (!holiday && !l.isLeap) holiday = LUNAR_HOLIDAYS[`${l.lunarMonth}-${l.lunarDay}`] || '';
  return { lunarText, term, holiday, isLeapMonth: l.isLeap, lunarMonth: l.lunarMonth, lunarDay: l.lunarDay };
}

/** 计算验证用:某年某月农历初一的公历日期(供测试断言) */
export function lunarNewYearDay(y) {
  const l = solar2lunar(y, 2, 1);
  return l;
}

/**
 * 农历月日 → 公历日期(在 year 年内查找;isLeap 支持闰月标记)
 * @returns {{y:number,m:number,d:number}|null}
 */
export function lunarMonthDayToSolar(year, lunarMonth, lunarDay, isLeap) {
  // 农历年跨公历年,遍历公历 year 年初 ~ 次年 3 月底覆盖完整农历年
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 2, 31);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const l = solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (!!l.isLeap === !!isLeap && l.lunarMonth === lunarMonth && l.lunarDay === lunarDay) {
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
    }
  }
  return null;
}
