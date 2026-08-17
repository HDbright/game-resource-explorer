// 生成「得乐学苑」组件可视化标注报告（层级分编号版）
// 抽取 kidWorkspacePage.js 真实 CSS，还原外观；每个可见组件编号，子组件用「父.子」层级编号。
const fs = require('fs');
const src = fs.readFileSync('src/pages/kidWorkspacePage.js', 'utf8');
const css = src.split('const CSS = `')[1].split('`;')[0];

// ---------------- 源码中的 SVG / 数据 helper（原样复制以真实还原外观）----------------
const CATS = {
  sport: { name: '身体锻炼', color: '#f59e0b', deep: '#b45309', bg: '#fff7ed', unit: '分钟',
    icon: '<path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#fff"/>',
    tips: ['跳绳 200 个', '开合跳 3 组 × 20 个', '原地慢跑 5 分钟'] },
  recite: { name: '背诵', color: '#8b5cf6', deep: '#6d28d9', bg: '#f5f3ff', unit: '篇',
    icon: '<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm4-1v16M12 7h4M12 11h4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    tips: ['课文大声读 3 遍再背', '先背一段再连起来', '让家长抽查 2 次'] },
  write: { name: '听写·默写·书法', color: '#ec4899', deep: '#be185d', bg: '#fdf2f8', unit: '课',
    icon: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    tips: ['生字先看笔顺再写', '写 3 遍记牢它', '英文单词边读边拼'] },
  math: { name: '数学口算·习题', color: '#3b82f6', deep: '#1d4ed8', bg: '#eff6ff', unit: '组',
    icon: '<path d="M9 3h6v18H9zM3 8h3v10H3zM18 8h3v10h-3z" fill="#fff"/>',
    tips: ['先计时口算一页', '错题抄进错题本', '用凑十法算得更快'] },
};
const CAT_ORDER = ['sport', 'recite', 'write', 'math'];
const LEVELS = [
  { lv: 1, exp: 0, title: '萌芽新芽', color: '#84cc16', desc: '刚刚出发的小种子,坚持就会发芽!' },
  { lv: 2, exp: 50, title: '学习小兵', color: '#22c55e', desc: '开始训练啦,今天也要好好挑战!' },
  { lv: 3, exp: 120, title: '挑战新秀', color: '#06b6d4', desc: '戴上棒球帽,挑战更有范儿!' },
  { lv: 4, exp: 220, title: '打卡达人', color: '#3b82f6', desc: '每天的坚持,就是你变强的秘诀!' },
  { lv: 5, exp: 360, title: '记忆小博士', color: '#6366f1', desc: '戴上眼镜,知识全都看得清清楚楚!' },
  { lv: 6, exp: 540, title: '计算小能手', color: '#8b5cf6', desc: '披风加身,口算题目统统拿下!' },
  { lv: 7, exp: 760, title: '知识勇士', color: '#ef4444', desc: '皇冠加冕,你是知识的守护者!' },
  { lv: 8, exp: 1020, title: '全能小学霸', color: '#f43f5e', desc: '四科全能,所向披靡!' },
  { lv: 9, exp: 1320, title: '挑战大师', color: '#f59e0b', desc: '星光闪耀,挑战对你小菜一碟!' },
  { lv: 10, exp: 1660, title: '智慧骑士', color: '#f97316', desc: '黄金披风,智慧与勇气并存!' },
  { lv: 11, exp: 2060, title: '闪耀学神', color: '#fbbf24', desc: '彩虹光环,光芒万丈!' },
  { lv: 12, exp: 2520, title: '无敌学霸王', color: '#facc15', desc: '钻石王冠加身,终极挑战霸主诞生!' },
];
function levelDef(exp) { let cur = LEVELS[0]; for (const l of LEVELS) if (exp >= l.exp) cur = l; return cur; }
function nextLevel(exp) { const cur = levelDef(exp); if (cur.lv >= 12) return null; return LEVELS[cur.lv]; }
const MEDALS = [
  { id: 'first', name: '初次挑战', desc: '完成第 1 个任务', icon: '🚩' },
  { id: 'streak3', name: '三天连胜', desc: '连续打卡 3 天', icon: '🔥' },
  { id: 'streak7', name: '一周坚持', desc: '连续打卡 7 天', icon: '🎯' },
  { id: 'streak14', name: '半月达人', desc: '连续打卡 14 天', icon: '⚡' },
  { id: 'streak30', name: '月度战神', desc: '连续打卡 30 天', icon: '🏆' },
  { id: 'task50', name: '任务小能手', desc: '累计完成 50 个任务', icon: '💪' },
  { id: 'task100', name: '百炼成钢', desc: '累计完成 100 个任务', icon: '🏅' },
  { id: 'all4', name: '全能四连', desc: '一天完成全部 4 类任务', icon: '🌈' },
  { id: 'crown', name: '皇冠加冕', desc: '获得第 1 个皇冠', icon: '👑' },
  { id: 'exp1000', name: '千验进阶', desc: '累计经验达到 1000', icon: '✨' },
  { id: 'exp3000', name: '经验王者', desc: '累计经验达到 3000', icon: '🌟' },
];
function coinSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="12" r="10.5" fill="#fbbf24" stroke="#d97706" stroke-width="1.4"/><circle cx="12" cy="12" r="7" fill="#f59e0b"/><path d="M12 7.5l1.3 2.9 3.2.3-2.4 2.1.7 3.1L12 14.3l-2.8 1.6.7-3.1-2.4-2.1 3.2-.3z" fill="#fff7ed"/></svg>`; }
function diamondSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M7 4h10l4 5-9 11L3 9z" fill="#22d3ee" stroke="#0891b2" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 9h18M12 4l-3 5 3 11 3-11z" fill="#a5f3fc" opacity=".55"/></svg>`; }
function crownSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M3 8l4 4 5-6 5 6 4-4-2 10H5z" fill="#fbbf24" stroke="#d97706" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="6.5" r="1.6" fill="#ec4899"/><circle cx="16" cy="6.5" r="1.6" fill="#22d3ee"/></svg>`; }
function medalSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="14" r="7" fill="#fb923c" stroke="#ea580c" stroke-width="1.3"/><circle cx="12" cy="14" r="4.5" fill="#fff7ed"/><path d="M9 3l3 5 3-5-2 8h-2z" fill="#fbbf24" stroke="#d97706" stroke-width="1"/><path d="M8.5 2l2 4-1.5 1.5L6 5.5zM15.5 2l-2 4 1.5 1.5 3.5-2z" fill="#f59e0b"/></svg>`; }
function starSvg(s = 16, fill = '#fbbf24') { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z" fill="${fill}" stroke="#d97706" stroke-width="0.8" stroke-linejoin="round"/></svg>`; }
function rocketSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 L16 8 H8 Z"/><path d="M8 8 H16 V18 H8 Z"/><path d="M8 12 H16"/><circle cx="12" cy="14" r="1.4"/><path d="M8 14 L5 18 V21 H8 Z"/><path d="M16 14 L19 18 V21 H16 Z"/><path d="M10 19 L9 22 M12 19 L12 23 M14 19 L15 22" stroke-width="1.4"/></svg>`; }
function expSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#a78bfa" stroke="#7c3aed" stroke-width="1" stroke-linejoin="round"/></svg>`; }
function lockSvg(s = 14) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="var(--ktext3)"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="var(--ktext3)" stroke-width="2.4"/></svg>`; }
function rocketSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 L16 8 H8 Z"/><path d="M8 8 H16 V18 H8 Z"/><line x1="8" y1="12" x2="16" y2="12"/><circle cx="12" cy="14" r="1.4"/><path d="M8 14 L5 18 V21 H8 Z"/><path d="M16 14 L19 18 V21 H16 Z"/><path d="M10 19 L9 22 M12 19 L12 23 M14 19 L15 22" stroke-width="1.4"/></svg>`; }
function catIco(cat) { const c = CATS[cat] || CATS.math; const icon = c.icon.split('#fff').join(c.deep || '#3a4056'); return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${icon}</svg>`; }
function headSvg(id) {
  const H = {
    a1: { bg: '#fbbf24', skin: '#ffd9b3', hair: '#8b5a2b', mouth: 'M25 33q5 5 10 0', eye: 'M22 27h4M34 27h4', unlock: 0 },
    a2: { bg: '#60a5fa', skin: '#ffd9b3', hair: '#111827', mouth: 'M27 33h6', eye: 'M21 28h5M34 28h5', unlock: 0, glasses: true },
    a3: { bg: '#f472b6', skin: '#ffd9b3', hair: '#7c3aed', mouth: 'M24 33q6 6 12 0', eye: 'M22 27h4M35 28h4', unlock: 0, wink: true },
    a4: { bg: '#34d399', skin: '#ffd9b3', hair: '#1f2937', mouth: 'M26 35q4 -4 8 0q4 4 8 0', eye: 'M22 27h4M34 27h4', unlock: 0, tongue: true },
    a5: { bg: '#a78bfa', skin: '#ffd9b3', hair: '#374151', mouth: 'M27 36a3 3 0 0 0 6 0', eye: 'M21 26a2.6 2.6 0 1 0 0 .1M34 26a2.6 2.6 0 1 0 0 .1', unlock: 0 },
    a6: { bg: '#fb923c', skin: '#ffd9b3', hair: '#78350f', mouth: 'M25 31q5 -3 10 0', eye: 'M22 26h4M34 26h4', unlock: 0, brow: true },
    a7: { bg: '#22d3ee', skin: '#ffd9b3', hair: '#0f766e', mouth: 'M26 34q4 4 8 0', eye: 'M21 26l3 3M25 26l-3 3M34 26l3 3M38 26l-3 3', unlock: 5, sparkle: true },
    a8: { bg: '#facc15', skin: '#ffd9b3', hair: '#f59e0b', mouth: 'M25 32q5 5 10 0', eye: 'M22 26h4M34 26h4', unlock: 8, crown: true },
  }[id] || { bg: '#fbbf24', skin: '#ffd9b3', hair: '#8b5a2b', mouth: 'M25 33q5 5 10 0', eye: 'M22 27h4M34 27h4', unlock: 0 };
  return `<svg viewBox="0 0 60 60" width="52" height="52" aria-hidden="true">
    <circle cx="30" cy="30" r="29" fill="${H.bg}"/>
    ${H.crown ? `<path d="M16 14l4 5 4-6 6 7 4-6 4 5 4-2-2 10H14L14 12z" fill="#f59e0b" stroke="#b45309" stroke-width="1"/><path d="M26 11l2 3 2-3z" fill="#7c3aed"/>` : ''}
    ${H.sparkle ? `<path d="M8 18l1.6 3.4L13 23l-3.4 1.6L8 28l-1.6-3.4L3 23l3.4-1.6zM48 10l1.2 2.6L52 14l-2.8 1.4L48 18l-1.2-2.6L44 14l2.8-1.4z" fill="#fff"/>` : ''}
    <path d="M16 26q0-12 14-12t14 12v2q0 8-7 9v4a7 7 0 0 1-14 0v-4q-7-1-7-9z" fill="${H.hair}"/>
    <circle cx="30" cy="31" r="13.5" fill="${H.skin}"/>
    ${H.glasses ? `<rect x="18" y="24" width="9" height="7" rx="2.5" fill="none" stroke="#1f2937" stroke-width="1.6"/><rect x="33" y="24" width="9" height="7" rx="2.5" fill="none" stroke="#1f2937" stroke-width="1.6"/><path d="M27 27h6" stroke="#1f2937" stroke-width="1.6"/>` : (H.wink ? `<path d="M22 27q2 2 4 0" stroke="#1f2937" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="36" cy="28" r="1.9" fill="#1f2937"/>` : H.eye)}
    ${H.sparkle && !H.glasses ? `<path d="M20 25l2.2 2.2M27 25l-2.2 2.2M33 25l2.2 2.2M40 25l-2.2 2.2" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round"/>` : ''}
    ${H.brow ? `<path d="M20 23q3-2 6 0M34 23q3-2 6 0" stroke="#1f2937" stroke-width="1.8" fill="none" stroke-linecap="round"/>` : ''}
    <circle cx="24.5" cy="28.5" r="1.7" fill="#fda4af"/><circle cx="35.5" cy="28.5" r="1.7" fill="#fda4af"/>
    ${H.tongue ? `<path d="M27 34q0 4 3 4t3-4z" fill="#fb7185"/>` : ''}
    <path d="${H.mouth}" stroke="#b45309" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
}
function heroSvg(exp) {
  const lv = levelDef(exp).lv;
  const hairColors = ['#8b5a2b', '#6d4a2f', '#1f2937', '#1f2937', '#312e81', '#4c1d95', '#7c2d12', '#9f1239', '#b45309', '#92400e', '#713f12', '#5b21b6'];
  const shirtColors = ['#84cc16', '#22c55e', '#3b82f6', '#06b6d4', '#6366f1', '#8b5cf6', '#ef4444', '#f43f5e', '#f59e0b', '#f97316', '#fbbf24', '#facc15'];
  const hair = hairColors[lv - 1], shirt = shirtColors[lv - 1], pant = '#475569';
  const cape = lv >= 9 ? '#f97316' : (lv >= 5 ? '#8b5cf6' : null);
  const hasHat = lv >= 3 && lv < 5, hasGlasses = lv >= 5, hasCrown = lv >= 7, bigCrown = lv >= 11, halo = lv >= 10, stars = lv >= 9, sparkles = lv >= 10;
  const bgGrad = lv <= 8 ? 'url(#hg1)' : 'url(#hg2)';
  const mouth = lv >= 9 ? 'M62 96q8 9 16 0' : (lv >= 3 ? 'M62 94q8 8 16 0' : 'M64 95q6 5 12 0');
  const eyeY = lv >= 9 ? 'M57 86h8M75 86h8' : 'M57 88h8M75 88h8';
  const brow = lv >= 7 ? '<path d="M55 82q5-3 10 0M75 82q5-3 10 0" stroke="#1f2937" stroke-width="2.6" fill="none" stroke-linecap="round"/>' : '';
  return `<svg viewBox="0 0 140 170" width="104" height="126" aria-hidden="true" style="display:block">
    <defs><radialGradient id="hg1" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#dbeafe"/><stop offset="100%" stop-color="#eef2ff"/></radialGradient>
    <radialGradient id="hg2" cx="50%" cy="35%" r="75%"><stop offset="0%" stop-color="#fef3c7"/><stop offset="100%" stop-color="#fff7ed"/></radialGradient></defs>
    ${stars ? Array.from({ length: 5 }).map((_, i) => { const x = 12 + i * 26 + (i % 2) * 8, y = 14 + (i % 3) * 8; return `<path d="M${x} ${y}l2 4 4.4.6-3.2 3.1.8 4.4-4-2-4 2 .8-4.4L${x - 2} ${y + 4.6}l4.4-.6z" fill="#fbbf24" opacity=".9"/>`; }).join('') : ''}
    ${sparkles ? `<path d="M16 130l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8zM122 40l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff" opacity=".95"/>` : ''}
    ${halo ? `<ellipse cx="70" cy="20" rx="26" ry="7" fill="none" stroke="#fbbf24" stroke-width="4" opacity=".9"/><ellipse cx="70" cy="20" rx="18" ry="4.5" fill="none" stroke="#f59e0b" stroke-width="2.5" opacity=".8"/>` : ''}
    <circle cx="70" cy="88" r="64" fill="${bgGrad}"/>
    ${bigCrown ? `<path d="M30 20l8 10 7-12 8 14 7-12 6 8 7-8-4 20H26L26 12z" fill="#fbbf24" stroke="#b45309" stroke-width="2"/><circle cx="44" cy="18" r="3" fill="#ec4899"/><circle cx="70" cy="16" r="3.4" fill="#22d3ee"/><circle cx="96" cy="18" r="3" fill="#a3e635"/>` : (hasCrown ? `<path d="M40 32l6 7 5-9 6 10 5-9 6 8 5-5-3 14H37L34 24z" fill="#fbbf24" stroke="#b45309" stroke-width="1.6"/><circle cx="52" cy="30" r="2.2" fill="#ec4899"/><circle cx="68" cy="28" r="2.4" fill="#22d3ee"/>` : '')}
    ${cape ? `<path d="M52 92q-20 8-26 26l6 14q20-12 30-14q10 2 30 14l6-14q-6-18-26-26z" fill="${cape}" opacity=".9"/>` : ''}
    ${hasHat ? `<path d="M46 44q0-16 24-16t24 16v4H46z" fill="#1e40af"/><path d="M46 46h48q-4 10-10 10H56q-6 0-10-10z" fill="#1e3a8a"/><circle cx="70" cy="30" r="4" fill="#fbbf24"/>` : ''}
    <path d="M42 52q0-18 28-18t28 18q0 16-8 17v9a13 13 0 0 1-40 0v-9q-8-1-8-17z" fill="${hair}"/>
    <circle cx="70" cy="54" r="20" fill="#ffd9b3"/>
    ${brow}
    ${hasGlasses ? `<rect x="52" y="82" width="15" height="11" rx="4" fill="none" stroke="#1f2937" stroke-width="2.2"/><rect x="73" y="82" width="15" height="11" rx="4" fill="none" stroke="#1f2937" stroke-width="2.2"/><path d="M67 87h6" stroke="#1f2937" stroke-width="2.2"/>` : `<path d="${eyeY}" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round"/>`}
    <circle cx="61" cy="84" r="3" fill="#fda4af" opacity=".7"/><circle cx="79" cy="84" r="3" fill="#fda4af" opacity=".7"/>
    <path d="${mouth}" stroke="#b45309" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M48 70h44a22 22 0 0 1-44 0z" fill="#fff" opacity=".28"/>
    <rect x="46" y="74" width="48" height="34" rx="12" fill="${shirt}"/>
    <rect x="36" y="80" width="10" height="26" rx="5" fill="${shirt}"/><rect x="94" y="80" width="10" height="26" rx="5" fill="${shirt}"/>
    <circle cx="41" cy="108" r="5" fill="#ffd9b3"/><circle cx="99" cy="108" r="5" fill="#ffd9b3"/>
    <rect x="52" y="108" width="14" height="24" rx="6" fill="${pant}"/><rect x="74" y="108" width="14" height="24" rx="6" fill="${pant}"/>
    <ellipse cx="59" cy="134" rx="11" ry="6.5" fill="#3b4252"/><ellipse cx="81" cy="134" rx="11" ry="6.5" fill="#3b4252"/>
  </svg>`;
}

// ---------------- 示例状态（仅用于还原外观，非真实数据）----------------
const S = { exp: 460, name: '小宇', coins: 120, diamonds: 3, crowns: 1, streak: 5, bestStreak: 7, totalTasks: 42, parentMode: true, themeMode: 'project', avatarId: 'a1', medals: { first: true, streak3: true } };
const lv = levelDef(S.exp), next = nextLevel(S.exp);
const progress = next ? Math.round(((S.exp - lv.exp) / (next.exp - lv.exp)) * 100) : 100;
const shop = [{ name: '星空投影灯', cost: 5, cur: 'coin', icon: '🎁', note: '睡前小夜灯,呵护视力' }, { name: '冰淇淋券', cost: 30, cur: 'coin', icon: '🍦', note: '周末小奖励' }];
const claimLog = [{ name: '星空投影灯', cur: 'coin', cost: 5, at: Date.now() - 86400000 * 3 }];

// ---------------- 标注包裹：父编号左上红圆，子编号(含'.')右上橙圆 ----------------
function wrap(id, cls, html) {
  const sub = id.includes('.') ? ' sub' : '';
  return `<div class="pinwrap" id="pw-${id}"><span class="pin${sub}" data-id="${id}" title="组件 ${id}">${id}</span><div class="${cls}">${html}</div></div>`;
}
function rewardChips(stars) { const r = { coins: stars * 10, exp: stars * 10 }; return `<span class="k-reward-chip c">${coinSvg(14)} +${r.coins} 金币</span><span class="k-reward-chip e">${expSvg(14)} +${r.exp} 经验</span><span class="k-reward-chip">⭐ ${stars} 星</span>`; }

// ---------------- 组件清单（层级有序：父编号 + 父.子 子编号）----------------
const COMP = [
  { id: '1', name: '顶栏 kid-topbar', code: 'renderTopbar() · L860', role: '顶部品牌区 + 等级胶囊 + 日期 + 操作按钮入口' },
  { id: '1.1', name: '品牌区 kid-brand', code: 'L865', role: 'Logo 与标题容器' },
  { id: '1.1.1', name: 'Logo kid-logo', code: 'L866', role: '星形 Logo 图标' },
  { id: '1.1.2', name: '标题文本 kid-title', code: 'L867', role: '「得乐学苑」+ 昵称/等级副标题' },
  { id: '1.2', name: '等级胶囊 kid-lv-pill', code: 'L869', role: '★ Lv.N 当前等级徽章(背景随等级变色)' },
  { id: '1.3', name: '日期标签 kid-date', code: 'L870', role: '今日日期 📅' },
  { id: '1.4', name: '操作区 kid-top-actions', code: 'L871', role: '导出/导入/家长/设置 按钮组' },
  { id: '1.4.1', name: '导出按钮', code: 'L872', role: '导出 JSON 备份(data-act=export)' },
  { id: '1.4.2', name: '导入按钮', code: 'L873', role: '从 JSON 恢复(data-act=import)' },
  { id: '1.4.3', name: '家长按钮', code: 'L874', role: '进入/退出家长模式(data-act=parent)' },
  { id: '1.4.4', name: '设置按钮', code: 'L875', role: '打开设置抽屉(data-act=settings)' },

  { id: '2', name: '今天要处理 kid-today', code: 'renderToday() · L890', role: '置顶区:逾期/今日任务列表 + 完成率' },
  { id: '2.1', name: '头部 kid-today-head', code: 'L922', role: '标题 + 完成率进度环 + 去完成' },
  { id: '2.1.1', name: '标题 kid-today-title', code: 'L923', role: '「🎯 今天要处理」' },
  { id: '2.1.2', name: '副标题 kid-today-sub', code: 'L924', role: '完成计数 / 连续打卡天数' },
  { id: '2.1.3', name: '完成率进度环 kid-progress', code: 'L925', role: 'SVG 圆环显示今日完成百分比' },
  { id: '2.1.4', name: '去完成按钮(挑战)', code: 'L933', role: '跳转今日挑战(lv<12 才显示)' },
  { id: '2.2', name: '列表 kid-today-list', code: 'L935', role: '今日任务项容器' },
  { id: '2.2.1', name: '任务项 kid-today-item', code: 'L907', role: '单条(图标/标题/逾期标/去完成);以逾期条为例' },
  { id: '2.2.1.1', name: '图标 k-ti-ico', code: 'L908', role: '分类色块图标' },
  { id: '2.2.1.2', name: '标题 k-ti-title', code: 'L910', role: '任务标题(逾期加 ⚠)' },
  { id: '2.2.1.3', name: '副标题 k-ti-sub', code: 'L911', role: '分类 · 目标' },
  { id: '2.2.1.4', name: '逾期标签 k-ti-tag', code: 'L913', role: '「逾期 N 天」(逾期时显示)' },
  { id: '2.2.1.5', name: '去完成按钮', code: 'L914', role: '跳转并滚动到对应任务卡' },
  { id: '2.3', name: '备份提示 banner', code: 'L936', role: '累计≥30 提示导出备份' },

  { id: '3', name: 'Tab 栏 kid-tabs', code: 'renderTabs() · L955', role: '三 Tab 切换:今日挑战/学习计划/成长奖励' },
  { id: '3.1', name: '今日挑战 Tab', code: 'L963', role: '🚀 今日挑战(data-tab=today)' },
  { id: '3.2', name: '学习计划 Tab', code: 'L963', role: '🗓️ 学习计划(data-tab=plan)' },
  { id: '3.3', name: '成长奖励 Tab', code: 'L963', role: '👑 成长奖励(data-tab=reward)' },

  { id: '4', name: '区标题 kid-sec-head', code: 'renderTodayTab() · L977', role: '「⚔️ 今日任务(n/n)」区标题' },
  { id: '4.1', name: '区标题文本', code: 'L978', role: '标题 + 副标题(验收说明)' },

  { id: '5', name: '任务卡 kid-task', code: 'renderTaskCard() · L1011', role: '单项任务卡片(以未开始态为例)' },
  { id: '5.1', name: '头部 k-task-head', code: 'L1038', role: '图标 + 标题 + 状态徽章' },
  { id: '5.1.1', name: '图标 k-task-ico', code: 'L1039', role: '分类图标' },
  { id: '5.1.2', name: '标题区 k-task-titles', code: 'L1040', role: '名称 + 分类' },
  { id: '5.1.2.1', name: '名称 k-task-name', code: 'L1041', role: '任务名称' },
  { id: '5.1.2.2', name: '分类 k-task-cat', code: 'L1042', role: '分类名' },
  { id: '5.1.3', name: '徽章区 k-task-badges', code: 'L1044', role: '状态徽章(已完成/逾期/挑战中)' },
  { id: '5.2', name: '目标行 k-task-target', code: 'L1046', role: '目标数量 + 单位 chip' },
  { id: '5.2.1', name: '目标 chip k-unit-chip', code: 'L1046', role: '「目标 单位」胶囊' },
  { id: '5.3', name: '操作区 k-task-actions', code: 'L1048', role: '开始挑战 / 移除 按钮(未开始态)' },
  { id: '5.3.1', name: '开始挑战按钮', code: 'L1031', role: '图标+文字非高亮按钮(未开始态,rocket 图标 + 蓝色文字「开始挑战」)' },
  { id: '5.3.2', name: '移除按钮', code: 'L1031', role: '删除任务(仅家长模式显示)' },
  { id: '5.4', name: '提示 k-task-tips', code: 'L1049', role: '分类小贴士' },
  { id: '5.5', name: '底部 k-task-foot', code: 'L1050', role: '引导文案' },

  { id: '6', name: '添加自定义任务按钮 kid-addtask', code: 'renderTodayTab() · L990', role: '＋ 添加自定义任务' },
  { id: '7', name: '今日已挑战汇总', code: 'renderTodayTab() · L999', role: '🏆 今日已挑战 区(已完成任务)' },

  { id: '8', name: '工具条 kid-plan-tools', code: 'renderPlanTab() · L1186', role: '套用模板 / 清空 / 计划开关' },
  { id: '8.1', name: '套用模板按钮', code: 'L1189', role: '套用四科均衡模板(data-plan=template)' },
  { id: '8.2', name: '清空计划按钮', code: 'L1190', role: '清空每周计划(data-plan=clear)' },
  { id: '8.3', name: '计划开关标签 kid-plan-enable', code: 'L1191', role: '计划生成今日任务 开关' },
  { id: '8.3.1', name: '开关 kid-switch', code: 'L1193', role: '开/关切换(data-plan=toggle)' },

  { id: '9', name: '周计划网格 kid-plan-days', code: 'renderPlanTab() · L1212', role: '周一~周日 7 列计划' },
  { id: '9.1', name: '今日列 kid-plan-day.today', code: 'L1217', role: '以今天列为例(高亮 today)' },
  { id: '9.1.1', name: '列头 kid-plan-day-head', code: 'L1223', role: '星期名 + 完成计数' },
  { id: '9.1.2', name: '计划项 kid-plan-item', code: 'L1227', role: '单条(圆点/文本/删除)' },
  { id: '9.1.2.1', name: '圆点 k-pi-dot', code: 'L1227', role: '分类色点' },
  { id: '9.1.2.2', name: '文本 k-pi-text', code: 'L1227', role: '任务 · 目标' },
  { id: '9.1.2.3', name: '删除按钮 k-pi-x', code: 'L1227', role: '删除计划项(data-del)' },
  { id: '9.1.3', name: '添加按钮', code: 'L1228', role: '＋ 添加计划项(data-add)' },

  { id: '10', name: '计划规则提示', code: 'renderPlanTab() · L1233', role: '奖励规则说明 banner' },

  { id: '11', name: '钱包 kid-wallet', code: 'renderRewardTab() · L1301', role: '金币/钻石/皇冠/奖章 四卡' },
  { id: '11.1', name: '金币卡 kid-wallet-card', code: 'L1304', role: '金币数量' },
  { id: '11.2', name: '钻石卡 kid-wallet-card', code: 'L1305', role: '钻石数量' },
  { id: '11.3', name: '皇冠卡 kid-wallet-card', code: 'L1306', role: '皇冠数量' },
  { id: '11.4', name: '奖章卡 kid-wallet-card', code: 'L1307', role: '奖章 x/y' },

  { id: '12', name: '等级+数字人卡 kid-card', code: 'renderRewardTab() · L1311', role: '等级称号 + 手绘数字人' },
  { id: '12.1', name: '标题', code: 'L1315', role: '🏅 等级称号' },
  { id: '12.2', name: '等级行 kid-level-row', code: 'L1316', role: '数字人 + 等级信息' },
  { id: '12.2.1', name: '数字人 kid-hero-box', code: 'L1317', role: '手绘 SVG,随等级换装进化' },
  { id: '12.2.2', name: '等级信息 kid-level-info', code: 'L1318', role: '称号/描述/经验进度' },
  { id: '12.2.2.1', name: '等级标题 kid-lv-title', code: 'L1319', role: '称号 + Lv.N 标签' },
  { id: '12.2.2.2', name: '等级描述 kid-lv-desc', code: 'L1320', role: '等级描述文案' },
  { id: '12.2.2.3', name: '经验进度条 kid-ring-row', code: 'L1321', role: '经验进度' },
  { id: '12.2.2.3.1', name: '标签 kid-ring-label', code: 'L1322', role: '「经验」' },
  { id: '12.2.2.3.2', name: '进度条 kid-ring-bar', code: 'L1323', role: '进度填充(width=%)' },
  { id: '12.2.2.3.3', name: '数值 kid-ring-val', code: 'L1324', role: '当前/下一级经验' },
  { id: '12.3', name: '连胜说明', code: 'L1329', role: '连续打卡 / 累计挑战' },

  { id: '13', name: '头像墙 kid-card', code: 'renderRewardTab() · L1331', role: '8 个头像,按等级解锁' },
  { id: '13.1', name: '标题', code: 'L1332', role: '😀 我的头像' },
  { id: '13.2', name: '头像网格 kid-avatars', code: 'L1333', role: '头像项容器' },
  { id: '13.2.1', name: '头像项 kid-avatar-item', code: 'L1338', role: '单个(以第 1 个为例)' },
  { id: '13.3', name: '说明文字', code: 'L1342', role: '进化说明' },

  { id: '14', name: '道具商城 kid-card', code: 'renderRewardTab() · L1347', role: '道具列表 + 管理/记录入口' },
  { id: '14.1', name: '标题+按钮 kid-card-title', code: 'L1350', role: '管理道具 / 兑换记录 按钮' },
  { id: '14.1.1', name: '管理道具按钮', code: 'L1351', role: '家长模式显示,打开管理弹窗' },
  { id: '14.1.2', name: '兑换记录按钮', code: 'L1351', role: '打开兑换记录弹窗' },
  { id: '14.2', name: '商城网格 kid-shop-grid', code: 'L1353', role: '道具项容器' },
  { id: '14.2.1', name: '商城项 kid-shop-item', code: 'L1359', role: '单个(以第 1 个为例)' },
  { id: '14.2.1.1', name: '头部 k-s-head', code: 'L1361', role: '图标 + 名称' },
  { id: '14.2.1.2', name: '名称 k-s-name', code: 'L1362', role: '道具名' },
  { id: '14.2.1.3', name: '说明 k-s-note', code: 'L1363', role: '道具说明' },
  { id: '14.2.1.4', name: '底部 k-s-foot', code: 'L1364', role: '价格 + 兑换按钮' },
  { id: '14.2.1.4.1', name: '价格 k-s-price', code: 'L1365', role: '金币/钻石价格' },
  { id: '14.2.1.4.2', name: '兑换按钮', code: 'L1366', role: '兑换(data-claim)' },

  { id: '15', name: '奖章墙 kid-card', code: 'renderRewardTab() · L1382', role: '11 枚成就奖章' },
  { id: '15.1', name: '标题', code: 'L1384', role: '🏅 奖章墙' },
  { id: '15.2', name: '奖章网格 kid-medal-grid', code: 'L1386', role: '奖章格容器' },
  { id: '15.2.1', name: '奖章格 kid-medal', code: 'L1390', role: '单个(以第 1 个为例)' },

  { id: '16', name: '奖励规则', code: 'renderRewardTab() · L1402', role: '奖励规则说明 banner' },

  { id: '17', name: '星级验收弹窗 kid-overlay', code: 'openStarModal() · L1066', role: '挑战成功 → 家长打星领取' },
  { id: '17.1', name: '弹窗头 kid-modal-head', code: 'L1077', role: '标题 + 关闭' },
  { id: '17.1.1', name: '标题', code: 'L1078', role: '🎉 挑战成功!' },
  { id: '17.1.2', name: '关闭按钮 kid-modal-x', code: 'L1079', role: '✕ 关闭(data-close)' },
  { id: '17.2', name: '任务信息条', code: 'L1081', role: '图标 + 任务名 + 目标' },
  { id: '17.2.1', name: '图标 k-task-ico', code: 'L1082', role: '分类图标' },
  { id: '17.2.2', name: '标题文本', code: 'L1083', role: '任务名 + 分类·目标' },
  { id: '17.3', name: '验收提示 kid-label', code: 'L1085', role: '请家长验收打星' },
  { id: '17.4', name: '星级选择 kid-stars-pick', code: 'L1086', role: '1/2/3 星按钮组' },
  { id: '17.4.1', name: '星按钮 kid-star-btn', code: 'L1087', role: '第 1 星(data-star=1)' },
  { id: '17.4.2', name: '星按钮 kid-star-btn', code: 'L1087', role: '第 2 星(data-star=2)' },
  { id: '17.4.3', name: '星按钮 kid-star-btn', code: 'L1087', role: '第 3 星(data-star=3)' },
  { id: '17.5', name: '奖励预览 kid-star-preview', code: 'L1089', role: '金币/经验预览' },
  { id: '17.6', name: '操作区 kid-modal-actions', code: 'L1090', role: '稍后 / 确认领取' },
  { id: '17.6.1', name: '稍后按钮', code: 'L1091', role: '稍后(data-close)' },
  { id: '17.6.2', name: '确认领取按钮', code: 'L1092', role: '确认领取 🎁(data-confirm)' },

  { id: '18', name: '添加任务弹窗 kid-overlay', code: 'openTaskModal() · L1145', role: '添加今日自定义任务' },
  { id: '18.1', name: '弹窗头', code: 'L1151', role: '标题 + 关闭' },
  { id: '18.2', name: '类型选择区 data-cats', code: 'L1153', role: '4 分类按钮组' },
  { id: '18.2.1', name: '类型按钮 kid-btn', code: 'L1154', role: '分类(以第 1 个为例,data-cat)' },
  { id: '18.3', name: '名称输入 kid-field', code: 'L1156', role: '任务名称 input' },
  { id: '18.4', name: '目标数量输入 kid-field', code: 'L1157', role: '目标数量 number' },
  { id: '18.5', name: '操作区', code: 'L1158', role: '取消 / 添加任务' },
  { id: '18.5.1', name: '取消按钮', code: 'L1158', role: '取消(data-close)' },
  { id: '18.5.2', name: '添加任务按钮', code: 'L1158', role: '添加任务(data-save)' },

  { id: '19', name: '添加计划项弹窗 kid-overlay', code: 'openPlanItemModal() · L1254', role: '周计划加项(结构同 18)' },
  { id: '19.1', name: '弹窗头', code: 'L1261', role: '标题 + 关闭' },
  { id: '19.2', name: '类型选择区', code: 'L1263', role: '4 分类按钮组' },
  { id: '19.2.1', name: '类型按钮 kid-btn', code: 'L1264', role: '分类(以第 1 个为例)' },
  { id: '19.3', name: '名称输入', code: 'L1266', role: '任务名称' },
  { id: '19.4', name: '目标数量输入', code: 'L1267', role: '目标数量' },
  { id: '19.5', name: '操作区', code: 'L1268', role: '取消 / 加入计划' },
  { id: '19.5.1', name: '取消按钮', code: 'L1268', role: '取消' },
  { id: '19.5.2', name: '加入计划按钮', code: 'L1268', role: '加入计划(data-save)' },

  { id: '20', name: '兑换记录弹窗 kid-overlay', code: 'openClaimLog() · L1441', role: '兑换历史列表' },
  { id: '20.1', name: '弹窗头', code: 'L1447', role: '标题 + 关闭' },
  { id: '20.2', name: '记录列表', code: 'L1448', role: '记录行容器' },
  { id: '20.2.1', name: '记录行', code: 'L1449', role: '单条(图标/名称/时间/价格)' },

  { id: '21', name: '管理道具弹窗 kid-overlay', code: 'openShopManageModal() · L1459', role: '家长管理道具' },
  { id: '21.1', name: '弹窗头', code: 'L1467', role: '标题 + 关闭' },
  { id: '21.2', name: '新增输入区', code: 'L1468', role: '名称/价格/金币/钻石' },
  { id: '21.2.1', name: '名称输入', code: 'L1469', role: '道具名称' },
  { id: '21.2.2', name: '价格输入', code: 'L1470', role: '价格 number' },
  { id: '21.2.3', name: '金币按钮', code: 'L1471', role: '金币道具(data-new-cur=coin)' },
  { id: '21.2.4', name: '钻石按钮', code: 'L1472', role: '钻石道具(data-new-cur=diamond)' },
  { id: '21.3', name: '道具列表', code: 'L1474', role: '道具行容器' },
  { id: '21.3.1', name: '道具行', code: 'L1477', role: '单条(图标/名称/价格/删除)' },

  { id: '22', name: '家长密码弹窗 kid-overlay', code: 'openPwdModal() · L1543', role: '4 位数字密码键盘' },
  { id: '22.1', name: '弹窗头', code: 'L1551', role: '标题 + 关闭' },
  { id: '22.2', name: '密码点 kid-pwd-dots', code: 'L1552', role: '4 个密码点' },
  { id: '22.3', name: '键盘 kid-pwd-pad', code: 'L1553', role: '0-9 / 清空 / ⌫' },
  { id: '22.3.1', name: '按键 kid-pwd-key', code: 'L1554', role: '单键(以 1 为例,data-key)' },

  { id: '23', name: '设置抽屉 kid-drawer', code: 'openSettings() · L1577', role: '设置:昵称/主题/倍数/家长/密码/清空' },
  { id: '23.1', name: '抽屉头 kid-drawer-head', code: 'L1587', role: 'Logo + 标题 + 关闭' },
  { id: '23.1.1', name: 'Logo', code: 'L1588', role: '星形 Logo' },
  { id: '23.1.2', name: '标题', code: 'L1589', role: '设置' },
  { id: '23.1.3', name: '关闭按钮', code: 'L1590', role: '✕ 关闭(data-close)' },
  { id: '23.2', name: '抽屉体 kid-drawer-body', code: 'L1592', role: '各设置行容器' },
  { id: '23.2.1', name: '昵称行', code: 'L1593', role: '昵称 input(data-set=name)' },
  { id: '23.2.2', name: '主题模式行', code: 'L1596', role: '主题 select(data-set=theme)' },
  { id: '23.2.3', name: '奖励倍数行', code: 'L1605', role: '倍数 select(data-set=mult)' },
  { id: '23.2.4', name: '家长模式行', code: 'L1612', role: '家长模式 + 开关' },
  { id: '23.2.4.1', name: '开关 kid-switch', code: 'L1613', role: '开/关(data-set=parent)' },
  { id: '23.2.5', name: '修改密码行', code: 'L1615', role: '修改家长密码(有密码时)' },
  { id: '23.2.6', name: '清空示例行', code: 'L1618', role: '清空示例数据(data-set=sample)' },
  { id: '23.2.7', name: '清空全部数据行', code: 'L1621', role: '清空全部(data-set=wipe)' },
  { id: '23.2.8', name: '说明文字', code: 'L1624', role: '当前状态/数据保存说明' },
];

// ---------------- 各屏内容 ----------------
const topbarHtml = wrap('1', 'kid-topbar', `
  ${wrap('1.1', 'kid-brand', `${wrap('1.1.1', 'kid-logo', starSvg(24, '#fff'))}${wrap('1.1.2', 'kid-title', `得乐学苑<small>${esc(S.name)} · ${lv.title}</small>`)}`)}
  ${wrap('1.2', 'kid-lv-pill', `★ Lv.${lv.lv}`)}
  ${wrap('1.3', 'kid-date', `📅 8月17日 周一`)}
  ${wrap('1.4', 'kid-top-actions', `
    ${wrap('1.4.1', 'kid-btn sm', '⬇ 导出')}
    ${wrap('1.4.2', 'kid-btn sm', '⬆ 导入')}
    ${wrap('1.4.3', 'kid-btn sm gold', '👨‍👩‍👦 家长')}
    ${wrap('1.4.4', 'kid-btn sm', '⚙ 设置')}
  `)}
`);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const todayHtml = wrap('2', 'kid-today', `
  ${wrap('2.1', 'kid-today-head', `
    ${wrap('2.1.1', 'kid-today-title', '🎯 今天要处理')}
    ${wrap('2.1.2', 'kid-today-sub', `已完成 1/2 · 已连续打卡 ${S.streak} 天 🔥`)}
    ${wrap('2.1.3', 'kid-progress', `<svg viewBox="0 0 44 44" width="40" height="40"><circle cx="22" cy="22" r="17" fill="none" stroke="var(--kring-bg)" stroke-width="5"/><circle cx="22" cy="22" r="17" fill="none" stroke="var(--kaccent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="53.4" transform="rotate(-90 22 22)"/></svg><span class="kid-progress-txt">50%</span>`)}
    ${wrap('2.1.4', 'kid-btn sm challenge', '')}
  `)}
  ${wrap('2.2', 'kid-today-list', `
    ${wrap('2.2.1', 'kid-today-item overdue', `
      ${wrap('2.2.1.1', 'k-ti-ico', catIco('recite'))}
      <div class="k-ti-main">
        ${wrap('2.2.1.2', 'k-ti-title', '⚠ 生词听写')}
        ${wrap('2.2.1.3', 'k-ti-sub', '背诵 · 10 篇')}
      </div>
      ${wrap('2.2.1.4', 'k-ti-tag', '逾期 1 天')}
      ${wrap('2.2.1.5', 'kid-btn sm', '去完成 →')}
    `)}
  `)}
  ${wrap('2.3', 'kid-today-banner', '📌 已累计完成 <b>42</b> 个任务,建议在顶部点「⬇ 导出」做一次数据备份')}
`);
const tabsHtml = wrap('3', 'kid-tabs', `
  ${wrap('3.1', 'kid-tab on', `<span class="kid-tab-dot">🚀</span>今日挑战`)}
  ${wrap('3.2', 'kid-tab', `<span class="kid-tab-dot">🗓️</span>学习计划`)}
  ${wrap('3.3', 'kid-tab', `<span class="kid-tab-dot">👑</span>成长奖励`)}
`);

const SCREEN1 = `<div class="device"><div class="kid-wb theme-project">${topbarHtml}${todayHtml}${tabsHtml}</div></div>`;

const taskCardHtml = wrap('5', 'kid-task', `
  ${wrap('5.1', 'k-task-head', `
    ${wrap('5.1.1', 'k-task-ico', catIco('sport'))}
    ${wrap('5.1.2', 'k-task-titles', `${wrap('5.1.2.1', 'k-task-name', '跳绳 200 个')}${wrap('5.1.2.2', 'k-task-cat', '身体锻炼')}`)}
    ${wrap('5.1.3', 'k-task-badges', `<span class="k-badge">未开始</span>`)}
  `)}
  ${wrap('5.2', 'k-task-target', `目标:${wrap('5.2.1', 'k-unit-chip', '200 分钟')}`)}
  ${wrap('5.3', 'k-task-actions', `${wrap('5.3.1', 'kid-btn', rocketSvg(14) + ' 开始挑战')}${wrap('5.3.2', 'kid-btn', '✕ 移除')}`)}
  ${wrap('5.4', 'k-task-tips', '💡 跳绳 200 个')}
  ${wrap('5.5', 'k-task-foot', '点击「开始挑战」按钮开始挑战')}
`);
const SCREEN2 = `<div class="device"><div class="kid-wb theme-project">
  ${wrap('4', 'kid-sec-head', `${wrap('4.1', 'kid-sec-title', '⚔️ 今日任务(1/2)')}<span class="kid-sec-sub">完成后请家长验收打星,获得金币和经验</span>`)}
  <div class="kid-grid">${taskCardHtml}</div>
  ${wrap('6', 'kid-addtask', '＋ 添加自定义任务')}
  ${wrap('7', 'kid-sec-head', `<span class="kid-sec-title">🏆 今日已挑战</span>`)}
</div></div>`;

const planDayHtml = (d, name, today, items) => wrap(today ? '9.1' : 'x', 'kid-plan-day' + (today ? ' today' : ''), `
  ${wrap(today ? '9.1.1' : 'x.1', 'kid-plan-day-head', `<span class="kid-plan-day-name">${name}${today ? ' · 今天' : ''}</span>`)}
  ${items.map((it, i) => wrap(today ? '9.1.2' : 'x.2', 'kid-plan-item', `${wrap(today ? '9.1.2.1' : 'x.2.1', 'k-pi-dot', '')}<span class="k-pi-text">${esc(it.t)} · ${esc(it.u)}</span>${wrap(today ? '9.1.2.3' : 'x.2.3', 'k-pi-x', '✕')}`)).join('')}
  ${wrap(today ? '9.1.3' : 'x.3', 'kid-addtask', '＋ 添加')}
`);
const SCREEN3 = `<div class="device"><div class="kid-wb theme-project">
  ${wrap('8', 'kid-plan-tools', `
    ${wrap('8.1', 'kid-btn primary', '📋 套用均衡模板')}
    ${wrap('8.2', 'kid-btn', '🗑 清空计划')}
    ${wrap('8.3', 'kid-plan-enable', `计划生成今日任务 ${wrap('8.3.1', 'kid-switch on', '')}`)}
  `)}
  ${wrap('9', 'kid-plan-days', planDayHtml(1, '周一', true, [{ t: '跳绳 200 个', u: '分钟' }, { t: '课文背诵', u: '篇' }]) + planDayHtml(2, '周二', false, [{ t: '听写生字', u: '课' }]))}
  ${wrap('10', 'kid-today-banner', '💡 每个任务固定奖励:完成 +10 金币/经验,星级越高奖励越多;连续打卡送钻石,周计划全完成送皇冠。')}
</div></div>`;

const walletHtml = wrap('11', 'kid-wallet', `
  ${wrap('11.1', 'kid-wallet-card', `<div class="k-w-ico" style="background:#fffbeb">${coinSvg(22)}</div><div><div class="k-w-num">${S.coins}</div><div class="k-w-name">金币</div></div>`)}
  ${wrap('11.2', 'kid-wallet-card', `<div class="k-w-ico" style="background:#ecfeff">${diamondSvg(22)}</div><div><div class="k-w-num">${S.diamonds}</div><div class="k-w-name">钻石</div></div>`)}
  ${wrap('11.3', 'kid-wallet-card', `<div class="k-w-ico" style="background:#fffbeb">${crownSvg(22)}</div><div><div class="k-w-num">${S.crowns}</div><div class="k-w-name">皇冠</div></div>`)}
  ${wrap('11.4', 'kid-wallet-card', `<div class="k-w-ico" style="background:#fff">${medalSvg(22)}</div><div><div class="k-w-num">${Object.keys(S.medals).length}/${MEDALS.length}</div><div class="k-w-name">奖章</div></div>`)}
`);
const heroHtml = wrap('12', 'kid-card', `
  ${wrap('12.1', 'kid-card-title', '🏅 等级称号')}
  ${wrap('12.2', 'kid-level-row', `
    ${wrap('12.2.1', 'kid-hero-box', heroSvg(S.exp))}
    ${wrap('12.2.2', 'kid-level-info', `
      ${wrap('12.2.2.1', 'kid-lv-title', `${esc(lv.title)}<span class="kid-lv-tag" style="background:${lv.color}">Lv.${lv.lv}</span>`)}
      ${wrap('12.2.2.2', 'kid-lv-desc', esc(lv.desc))}
      ${wrap('12.2.2.3', 'kid-ring-row', `${wrap('12.2.2.3.1', 'kid-ring-label', '经验')}<div class="kid-ring-bar">${wrap('12.2.2.3.2', 'kid-ring-fill', '')}</div>${wrap('12.2.2.3.3', 'kid-ring-val', `${S.exp}/${next.exp}`)}`)}
      <div style="font-size:11px;color:var(--ktext3);margin-top:6px">再攒 ${next.exp - S.exp} 经验晋级「${next.title}」</div>
    `)}
  `)}
  ${wrap('12.3', 'kid-level-info', `🔥 已连续打卡 <b>${S.streak}</b> 天(历史最长 ${S.bestStreak} 天) · 累计挑战 <b>${S.totalTasks}</b> 关`)}
`);
const avatarHtml = wrap('13', 'kid-card', `
  ${wrap('13.1', 'kid-card-title', '😀 我的头像')}
  ${wrap('13.2', 'kid-avatars', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id, i) => wrap(i === 0 ? '13.2.1' : 'x', 'kid-avatar-item' + (S.avatarId === id ? ' on' : '') + (lv.lv < [0, 0, 0, 0, 0, 0, 5, 8][i] ? ' locked' : ''), `${headSvg(id)}<span class="k-a-name">${lv.lv < [0, 0, 0, 0, 0, 0, 5, 8][i] ? '🔒 Lv.' + [0, 0, 0, 0, 0, 0, 5, 8][i] : ['开心', '酷酷', '眨眼', '淘气', '惊讶', '得意', '星星眼', '小王子'][i]}</span>`)).join(''))}
  ${wrap('13.3', 'kid-card-title', '数字人会随等级换装进化:帽子(3级)→ 眼镜披风(5级)→ 皇冠(7级)→ 星光(9级)→ 光环(10级)→ 钻石王冠(11级)')}
`);
const shopHtml = wrap('14', 'kid-card', `
  ${wrap('14.1', 'kid-card-title', `🎁 道具商城${wrap('14.1.1', 'kid-btn sm', '＋ 管理道具')}${wrap('14.1.2', 'kid-btn sm', '兑换记录')}`)}
  ${wrap('14.2', 'kid-shop-grid', shop.map((it, i) => wrap(i === 0 ? '14.2.1' : 'x', 'kid-shop-item', `
    ${wrap(i === 0 ? '14.2.1.1' : 'x.1', 'k-s-head', `<div class="k-s-ico" style="background:#fffbeb">${it.icon}</div><div>${wrap(i === 0 ? '14.2.1.2' : 'x.2', 'k-s-name', esc(it.name))}<div style="font-size:11px;color:var(--ktext3)">金币道具</div></div>`)}
    ${wrap(i === 0 ? '14.2.1.3' : 'x.3', 'k-s-note', esc(it.note))}
    ${wrap(i === 0 ? '14.2.1.4' : 'x.4', 'k-s-foot', `${wrap(i === 0 ? '14.2.1.4.1' : 'x.4.1', 'k-s-price', coinSvg(15) + ' ' + it.cost)}${wrap(i === 0 ? '14.2.1.4.2' : 'x.4.2', 'kid-btn sm gold', '兑换')}`)}
  `)).join(''))}
`);
const medalHtml = wrap('15', 'kid-card', `
  ${wrap('15.1', 'kid-card-title', '🏅 奖章墙')}
  ${wrap('15.2', 'kid-medal-grid', MEDALS.map((m, i) => wrap(i === 0 ? '15.2.1' : 'x', 'kid-medal' + (S.medals[m.id] ? ' got' : ' locked'), `
    <div style="font-size:30px;filter:${S.medals[m.id] ? 'none' : 'grayscale(1)'}">${m.icon}</div>
    <div class="k-m-name">${esc(m.name)}</div>
    <div class="k-m-desc">${esc(m.desc)}</div>
    <div style="font-size:10px;font-weight:700;color:${S.medals[m.id] ? '#b45309' : '#9aa0b3'}">${S.medals[m.id] ? '✅ 已获得' : '未解锁'}</div>
  `)).join(''))}
`);
const SCREEN4 = `<div class="device"><div class="kid-wb theme-project">
  ${walletHtml}${heroHtml}${avatarHtml}${shopHtml}${medalHtml}
  ${wrap('16', 'kid-today-banner', '💰 奖励规则:基础完成 +10 金币/经验;星级加成 ⭐×5;金币可兑换道具,钻石由连胜里程碑获得,皇冠由周计划全勤获得。')}
</div></div>`;

const starModalHtml = wrap('17', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  ${wrap('17.1', 'kid-modal-head', `${wrap('17.1.1', 'kid-modal-title', '🎉 挑战成功!')}${wrap('17.1.2', 'kid-modal-x', '✕')}`)}
  ${wrap('17.2', '', `<div style="display:flex;align-items:center;gap:10px;background:${CATS.sport.bg};border-radius:12px;padding:10px 12px">${wrap('17.2.1', 'k-task-ico', catIco('sport'))}<div style="font-weight:800;font-size:15px">跳绳 200 个<div style="font-size:12px;color:var(--ktext2);font-weight:600">身体锻炼 · 200 分钟</div></div></div>`)}
  ${wrap('17.3', 'kid-label', '请家长验收,给这次挑战打星 ⭐')}
  ${wrap('17.4', 'kid-stars-pick', [1, 2, 3].map(i => wrap('17.4.' + i, 'kid-star-btn' + (i === 3 ? ' on' : ''), starSvg(34, '#fbbf24'))).join(''))}
  ${wrap('17.5', 'kid-star-preview', rewardChips(3))}
  ${wrap('17.6', 'kid-modal-actions', `${wrap('17.6.1', 'kid-btn', '稍后')}${wrap('17.6.2', 'kid-btn gold', '确认领取 🎁')}`)}
</div>`);
const addTaskHtml = wrap('18', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  ${wrap('18.1', 'kid-modal-head', `<div class="kid-modal-title">＋ 添加今日任务</div><div class="kid-modal-x">✕</div>`)}
  ${wrap('18.2', 'kid-field', `<label class="kid-label">任务类型</label><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">${CAT_ORDER.map((c, i) => wrap(i === 0 ? '18.2.1' : 'x', 'kid-btn', `<span style="width:20px;height:20px;border-radius:6px;background:${CATS[c].color};display:flex;align-items:center;justify-content:center">${catIco(c)}</span>${CATS[c].name}`)).join('')}</div>`)}
  ${wrap('18.3', 'kid-field', `<label class="kid-label">任务名称</label><input type="text" placeholder="例如:跳绳 200 个" maxlength="30">`)}
  ${wrap('18.4', 'kid-field', `<label class="kid-label">目标数量</label><input type="number" min="1" max="999" value="1">`)}
  ${wrap('18.5', 'kid-modal-actions', `${wrap('18.5.1', 'kid-btn', '取消')}${wrap('18.5.2', 'kid-btn primary', '添加任务')}`)}
</div>`);
const addPlanHtml = wrap('19', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  ${wrap('19.1', 'kid-modal-head', `<div class="kid-modal-title">周一 · 添加计划任务</div><div class="kid-modal-x">✕</div>`)}
  ${wrap('19.2', 'kid-field', `<label class="kid-label">任务类型</label><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">${CAT_ORDER.map((c, i) => wrap(i === 0 ? '19.2.1' : 'x', 'kid-btn', `<span style="width:20px;height:20px;border-radius:6px;background:${CATS[c].color};display:flex;align-items:center;justify-content:center">${catIco(c)}</span>${CATS[c].name}`)).join('')}</div>`)}
  ${wrap('19.3', 'kid-field', `<label class="kid-label">任务名称</label><input type="text" placeholder="例如:跳绳训练" maxlength="30">`)}
  ${wrap('19.4', 'kid-field', `<label class="kid-label">目标数量</label><input type="number" min="1" max="999" value="1">`)}
  ${wrap('19.5', 'kid-modal-actions', `${wrap('19.5.1', 'kid-btn', '取消')}${wrap('19.5.2', 'kid-btn primary', '加入计划')}`)}
</div>`);
const claimLogHtml = wrap('20', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  ${wrap('20.1', 'kid-modal-head', `<div class="kid-modal-title">📜 兑换记录</div><div class="kid-modal-x">✕</div>`)}
  ${wrap('20.2', '', `<div style="max-height:52vh;overflow:auto">${claimLog.map((c, i) => wrap(i === 0 ? '20.2.1' : 'x', '', `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--kborder)"><span style="font-size:18px">🎁</span><div style="flex:1"><div style="font-size:14px;font-weight:700">${esc(c.name)}</div><div style="font-size:11px;color:var(--ktext3)">8月14日</div></div><span class="k-s-price">${coinSvg(14)} ${c.cost}</span></div>`)).join('')}</div>`)}
</div>`);
const shopManageHtml = wrap('21', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:480px;width:100%">
  ${wrap('21.1', 'kid-modal-head', `<div class="kid-modal-title">🎁 管理道具</div><div class="kid-modal-x">✕</div>`)}
  ${wrap('21.2', '', `<div style="display:flex;gap:8px;margin-bottom:12px">${wrap('21.2.1', '', '<input type="text" placeholder="道具名称,如:冰淇淋券" style="flex:1">')}${wrap('21.2.2', '', '<input type="number" placeholder="价格" style="width:76px" min="1">')}${wrap('21.2.3', 'kid-btn primary', '金币')}${wrap('21.2.4', 'kid-btn', '钻石')}</div>`)}
  ${wrap('21.3', '', `<div style="max-height:46vh;overflow:auto">${shop.map((it, i) => wrap(i === 0 ? '21.3.1' : 'x', '', `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--kborder)"><span style="font-size:20px">${it.icon}</span><div style="flex:1"><div style="font-size:14px;font-weight:700">${esc(it.name)}</div><div style="font-size:11px;color:var(--ktext3)">🪙 ${it.cost}</div></div><button class="kid-btn sm">删除</button></div>`)).join('')}</div>`)}
</div>`);
const pwdHtml = wrap('22', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:300px;width:100%">
  ${wrap('22.1', 'kid-modal-head', `<div class="kid-modal-title">输入家长密码</div><div class="kid-modal-x">✕</div>`)}
  ${wrap('22.2', 'kid-pwd-dots', [0, 1, 2, 3].map(() => '<span class="kid-pwd-dot"></span>').join(''))}
  ${wrap('22.3', 'kid-pwd-pad', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '⌫'].map((k, i) => wrap(i === 0 ? '22.3.1' : 'x', 'kid-pwd-key' + (k === '清空' || k === '⌫' ? ' del' : ''), k)).join(''))}
</div>`);
const SCREEN5 = `<div class="device"><div class="kid-wb theme-project">${starModalHtml}${addTaskHtml}${addPlanHtml}${claimLogHtml}${shopManageHtml}${pwdHtml}</div></div>`;

const SCREEN6 = `<div class="device"><div class="kid-wb theme-project">${wrap('23', 'kid-overlay', `<div class="kid-drawer" style="position:relative;max-width:440px;width:100%">
  ${wrap('23.1', 'kid-drawer-head', `${wrap('23.1.1', 'kid-logo', starSvg(20, '#fff'))}${wrap('23.1.2', 'kid-title', '设置')}${wrap('23.1.3', 'kid-modal-x', '✕')}`)}
  ${wrap('23.2', 'kid-drawer-body', `
    ${wrap('23.2.1', 'kid-drawer-row', `<div><div class="k-dr-label">我的昵称</div><div class="k-dr-sub">显示在顶部与等级旁</div></div><input type="text" value="${esc(S.name)}" style="width:130px;padding:8px 10px" maxlength="12">`)}
    ${wrap('23.2.2', 'kid-sec-gap kid-drawer-row', `<div><div class="k-dr-label">主题模式</div><div class="k-dr-sub">「跟随项目」与应用外观自动一致</div></div><select style="width:138px;padding:8px 10px"><option>跟随项目</option><option>儿童亮色</option><option>糖果乐园 🍬</option><option>星际探险 🚀</option><option>深色</option></select>`)}
    ${wrap('23.2.3', 'kid-sec-gap kid-drawer-row', `<div><div class="k-dr-label">奖励倍数</div><div class="k-dr-sub">金币/经验按此倍数发放</div></div><select style="width:110px;padding:8px 10px"><option>×1 标准</option><option>×1.5 加量</option><option>×2 翻倍</option></select>`)}
    ${wrap('23.2.4', 'kid-sec-gap kid-drawer-row', `<div><div class="k-dr-label">家长模式</div><div class="k-dr-sub">开启后解锁家长专属操作</div></div>${wrap('23.2.4.1', 'kid-switch on', '')}`)}
    ${wrap('23.2.5', 'kid-drawer-row', `<div><div class="k-dr-label">修改家长密码</div><div class="k-dr-sub">重新设置 4 位数字密码</div></div><button class="kid-btn sm">修改</button>`)}
    ${wrap('23.2.6', 'kid-sec-gap kid-drawer-row', `<div><div class="k-dr-label">清空示例数据</div><div class="k-dr-sub">删除示例任务,重置为全新开始</div></div><button class="kid-btn sm">清空</button>`)}
    ${wrap('23.2.7', 'kid-drawer-row', `<div><div class="k-dr-label" style="color:#ef4444">清空全部数据</div><div class="k-dr-sub">删除所有任务/金币/等级/计划</div></div><button class="kid-btn sm red">清空</button>`)}
    ${wrap('23.2.8', 'kid-sec-gap', `当前:${esc(S.name)} · ${esc(lv.title)} Lv.${lv.lv} · 金币 ${S.coins} · 钻石 ${S.diamonds} · 皇冠 ${S.crowns} · 累计 ${S.totalTasks} 关`)}
  `)}
</div>`)}</div></div>`;

// ---------------- 图例总表（层级缩进）----------------
const legendRows = COMP.map(c => {
  const depth = c.id.split('.').length - 1;
  const indent = '&nbsp;'.repeat(depth * 3);
  const cls = depth === 0 ? 'clevel0' : 'clevel' + depth;
  return `<tr class="${cls}" data-id="${c.id}"><td class="cnum">${c.id}</td><td class="cname">${indent}${c.name}</td><td class="ccode">${c.code}</td><td class="crole">${c.role}</td></tr>`;
}).join('');

// ---------------- 主 HTML ----------------
const navItems = [['1', '① 主框架'], ['2', '② 今日挑战'], ['3', '③ 学习计划'], ['4', '④ 成长奖励'], ['5', '⑤ 弹窗键盘'], ['6', '⑥ 设置抽屉']];
const panels = [
  ['1', '① 主框架：顶栏 / 今天要处理 / Tab 栏', SCREEN1],
  ['2', '② 今日挑战：区标题 / 任务卡 / 添加 / 已挑战', SCREEN2],
  ['3', '③ 学习计划：工具条 / 周计划 / 规则', SCREEN3],
  ['4', '④ 成长奖励：钱包 / 等级数字人 / 头像 / 商城 / 奖章 / 规则', SCREEN4],
  ['5', '⑤ 弹窗与键盘：星级验收 / 添加任务 / 添加计划 / 兑换记录 / 管理道具 / 家长密码', SCREEN5],
  ['6', '⑥ 设置抽屉', SCREEN6],
];
const mainPanels = panels.map(([id, title, body]) => `<div class="panel" id="scr-${id}"><h2>${title}</h2>${body}</div>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>得乐学苑 · 组件标注报告(层级分编号)</title>
<style>
  :root{--bg:#f4f6fb;--panel:#ffffff;--ink:#1f2330;--sub:#5b6172;--line:#e3e6f0;--accent:#4f7cff;--hot:#ff4d4f;--subc:#ff8c1a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
  header.top{background:linear-gradient(135deg,#4f7cff,#8b5cf6);color:#fff;padding:22px 26px}
  header.top h1{margin:0 0 6px;font-size:22px;letter-spacing:.5px}
  header.top p{margin:0;opacity:.92;font-size:13px}
  .wrap{max-width:1240px;margin:0 auto;padding:18px;display:grid;grid-template-columns:1fr 380px;gap:18px}
  @media(max-width:1000px){.wrap{grid-template-columns:1fr}}
  .col-main{min-width:0}
  .col-side{position:sticky;top:14px;align-self:start;max-height:calc(100vh - 28px);overflow:auto}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:0 4px 16px rgba(20,30,60,.05)}
  .panel h2{margin:0 0 12px;font-size:17px}
  .device{border:1px solid #d0d5e0;border-radius:14px;padding:10px;background:#fff;box-shadow:0 6px 20px rgba(20,30,60,.07);overflow:visible}
  .device .kid-wb{max-height:none}
  .pinwrap{position:relative}
  .pin{position:absolute;top:-13px;left:-13px;width:26px;height:26px;border-radius:50%;background:var(--hot);color:#fff;font:800 12px/26px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.28);cursor:pointer;z-index:30;border:2px solid #fff;transition:transform .12s}
  .pin.sub{top:-9px;right:-9px;left:auto;width:18px;height:18px;font:700 9px/18px system-ui;background:var(--subc);border-width:1.5px}
  .pin:hover{transform:scale(1.12)}
  .pin.hot{background:#111;transform:scale(1.3);box-shadow:0 0 0 4px rgba(255,77,79,.35);z-index:40}
  .legend{width:100%;border-collapse:collapse;font-size:11.5px}
  .legend th{text-align:left;color:var(--sub);font-weight:700;padding:6px 8px;border-bottom:2px solid var(--line);position:sticky;top:0;background:#fff}
  .legend td{border-bottom:1px solid #eee;padding:6px 8px;vertical-align:top}
  .legend tr{cursor:pointer}
  .legend tr:hover td{background:#f7f9ff}
  .legend tr.hot td{background:#fff3f3;box-shadow:inset 3px 0 0 var(--hot)}
  .legend .cnum{font-weight:800;color:var(--accent);width:34px;text-align:center;white-space:nowrap}
  .legend .clevel0 .cnum{color:var(--hot)}
  .legend .cname{font-weight:700;min-width:120px}
  .legend .clevel0 .cname{font-size:12.5px}
  .legend .ccode{color:#2563eb;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;width:140px}
  .legend .crole{color:var(--sub)}
  .legend .clevel1{background:#fffaf3}
  .legend .clevel2{background:#fdf6f0}
  .legend .clevel3{background:#fbf2ec}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
  .toc a{font-size:12px;text-decoration:none;background:#eef2ff;color:#3742b0;padding:5px 10px;border-radius:20px;font-weight:700}
  .toc a:hover{background:#dfe6ff}
  .src{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#2563eb}
  .note{font-size:12px;color:var(--sub);background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:14px}
  footer{color:var(--sub);font-size:12px;text-align:center;padding:18px}
  .kid-wb{--kaccent:#4f7cff;--kaccent2:#6a5cff}
</style>
<style>${css}</style>
<style>
/* 报告专用：弹窗遮罩/抽屉从 fixed 全屏降级为文档流内静态展示,避免覆盖整页 */
.kid-overlay{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;z-index:auto!important;background:none!important;backdrop-filter:none!important;display:flex!important;justify-content:center;align-items:flex-start;flex-wrap:wrap;gap:14px;padding:8px 0!important;min-height:0!important}
.kid-drawer{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;z-index:auto!important;width:100%!important;max-width:440px!important;box-shadow:0 10px 30px rgba(20,24,40,.12)!important;margin:8px 0!important}
.kid-toast-ok{position:static!important;transform:none!important;z-index:auto!important;margin:8px 0!important}
</style>
</head>
<body>
<header class="top">
  <h1>得乐学苑 · 页面组件可视化标注报告（层级分编号）</h1>
  <p>模块文件：src/pages/kidWorkspacePage.js（小学生成长闯关台 / 定制版）。父组件编号为 1–23，其内部按钮/卡片/标签用 <b>父.子</b> 层级编号（如 17 → 17.1 / 17.2 …）。点击编号或右侧图例可联动高亮并定位。</p>
</header>
<div class="wrap">
  <div class="col-main">
    <div class="note">说明：本报告使用模块<strong>真实 CSS</strong> 还原各组件外观（示例数据为演示用）。<strong>红圆=大组件编号</strong>，<strong>橙圆=子组件编号</strong>。编号对应的<strong>代码位置</strong>指向 <span class="src">src/pages/kidWorkspacePage.js</span> 中的渲染函数与行号。</div>
    <div class="toc">${navItems.map(([id, t]) => `<a href="#scr-${id}">${t}</a>`).join('')}<a href="#legend-top">📑 组件总表</a></div>
    ${mainPanels}
  </div>
  <div class="col-side">
    <div id="legend-top" class="panel" style="padding:12px">
      <h2 style="margin:0 0 8px;font-size:15px">📑 组件总表（层级）</h2>
      <table class="legend"><thead><tr><th>编号</th><th>组件</th><th>代码位置</th><th>作用</th></tr></thead><tbody>${legendRows}</tbody></table>
    </div>
  </div>
</div>
<footer>得乐学苑组件标注报告 · 由 gen-kid-annotation-report.js 生成（抽取真实 CSS，可重跑刷新）</footer>
<script>
document.querySelectorAll('.pin').forEach(p=>{
  p.addEventListener('click',()=>focusId(p.dataset.id));
});
document.querySelectorAll('.legend tr[data-id]').forEach(tr=>{
  tr.addEventListener('click',()=>focusId(tr.dataset.id));
});
function focusId(id){
  document.querySelectorAll('.pin.hot,.legend tr.hot').forEach(e=>e.classList.remove('hot'));
  const pin=document.querySelector('.pin[data-id="'+id+'"]');
  const tr=document.querySelector('.legend tr[data-id="'+id+'"]');
  if(pin){pin.classList.add('hot');const box=document.getElementById('pw-'+id);if(box){box.scrollIntoView({behavior:'smooth',block:'center'});}}
  if(tr){tr.classList.add('hot');tr.scrollIntoView({behavior:'smooth',block:'nearest'});}
}
</script>
</body>
</html>`;

fs.writeFileSync('docs/kid-workspace-component-report.html', html, 'utf8');
console.log('written: docs/kid-workspace-component-report.html bytes=', Buffer.byteLength(html), 'components=', COMP.length);
