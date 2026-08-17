// 生成「得乐学苑」模块可视化标注报告
// 抽取 kidWorkspacePage.js 中的真实 CSS,渲染真实组件,叠加编号 pin 与可点击图例
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'pages', 'kidWorkspacePage.js');
const OUT = path.join(__dirname, '..', 'docs', 'kid-workspace-component-report.html');

const src = fs.readFileSync(SRC, 'utf8');
// 抽取 const CSS = `...`;
const css = src.split('const CSS = `')[1].split('`;')[0];

// ---- 组件清单(编号 / 名称 / 代码位置 / 作用) ----
const LEGEND = [
  // 主框架
  { id: '1', name: '顶部栏 kid-topbar', code: 'renderTopbar() · L860', role: '整页头部：品牌 Logo、标题+昵称/等级、等级胶囊、日期、以及导出/导入/家长/设置四个操作入口。修改 L864-876 的 innerHTML 与点击事件。' },
  { id: '2', name: '「今天要处理」置顶区 kid-today', code: 'renderToday() · L890', role: '页面置顶展示当天任务、完成进度环、逾期标红、一键「去完成」、累计完成后的备份提醒。L922-936 控制结构与文案。' },
  { id: '3', name: 'Tab 切换栏 kid-tabs', code: 'renderTabs() · L955', role: '在「今日挑战 / 学习计划 / 成长奖励」三个主视图间切换；点击改变 activeTab 后整体重渲染。L958-963 定义三 tab。' },
  // 今日挑战
  { id: '4', name: '今日任务区标题 kid-sec-head', code: 'renderTodayTab() · L973', role: '显示「⚔️ 今日任务(已完成/总数)」与验收说明副标题。L977-979。' },
  { id: '5', name: '任务卡 kid-task', code: 'renderTaskCard() · L1011', role: '单条任务卡片整体（含头部/目标/奖励/操作/提示/底部六块，见细节屏）。状态类：done/started/carry 对应不同边框色。L1013-1062。' },
  { id: '6', name: '添加自定义任务按钮 kid-addtask', code: 'renderTodayTab() · L990', role: '点击打开「添加任务」弹窗(openTaskModal)。L990-994。' },
  { id: '7', name: '今日已挑战汇总区 doneSec', code: 'renderTodayTab() · L998', role: '已完成任务的汇总区，展示奖励与（家长模式下）撤销按钮。L997-1007。' },
  // 学习计划
  { id: '8', name: '计划工具条 kid-plan-tools', code: 'renderPlanTab() · L1188', role: '「套用均衡模板 / 清空计划 / 计划生成今日任务」开关。L1188-1208。' },
  { id: '9', name: '周计划网格 kid-plan-days', code: 'renderPlanTab() · L1212', role: '周一到周日七列，每日含完成计数、计划项列表、删除(✕)、当日加「＋添加」。今天列高亮。L1215-1230。' },
  { id: '10', name: '计划奖励提示横幅', code: 'renderPlanTab() · L1233', role: '底部奖励规则说明横幅(kid-today-banner 复用样式)。L1233-1237。' },
  // 成长奖励
  { id: '11', name: '钱包四宫格 kid-wallet', code: 'renderRewardTab() · L1301', role: '金币 / 钻石 / 皇冠 / 奖章 四项余额卡片。L1303-1308。' },
  { id: '12', name: '等级称号卡(左) kid-card', code: 'renderRewardTab() · L1314', role: '数字人舞台 + 等级称号 + 经验进度条 + 连胜/累计信息。L1314-1330。' },
  { id: '13', name: '我的头像墙(右) kid-card', code: 'renderRewardTab() · L1331', role: '8 个头像，按等级解锁(Lv.5/8 解锁 a7/a8)，点击切换当前头像。L1333-1341。' },
  { id: '14', name: '道具商城 kid-card', code: 'renderRewardTab() · L1347', role: '金币/钻石道具列表，含「管理道具(家长) / 兑换记录」按钮与「兑换」操作。L1349-1379。' },
  { id: '15', name: '奖章墙 kid-card', code: 'renderRewardTab() · L1382', role: '里程碑奖章网格，已获得高亮、未解锁灰度。L1384-1399。' },
  { id: '16', name: '奖励规则说明', code: 'renderRewardTab() · L1402', role: '成长奖励页底部全局奖励规则横幅。L1402-1406。' },
  // 弹窗 / 抽屉
  { id: '17', name: '星级验收弹窗 kid-modal', code: 'openStarModal() · L1066', role: '任务完成后家长打 1~3 星并预览/领取奖励；确认后撒花(confetti)并重渲染。L1076-1116。' },
  { id: '18', name: '添加任务弹窗 kid-modal', code: 'openTaskModal() · L1145', role: '选择任务类型/名称/目标数量，写入今日任务。L1150-1179。' },
  { id: '19', name: '添加计划项弹窗', code: 'openPlanItemModal() · L1254', role: '给某一天添加计划项(分类/名称/目标)，用于生成每日任务。' },
  { id: '20', name: '兑换记录弹窗', code: 'openClaimLog() · L1441', role: '展示已兑换道具历史列表。L1446-1455。' },
  { id: '21', name: '管理道具弹窗(家长)', code: 'openShopManageModal() · L1459', role: '家长增删商城道具(名称/价格/金币或钻石)。L1466-1514。' },
  { id: '22', name: '家长密码键盘 kid-pwd-pad', code: 'openPwdModal() · L1543', role: '4 位数字密码输入键盘 + 圆点指示，用于进入/退出家长模式与修改密码。L1550-1573。' },
  { id: '23', name: '设置抽屉 kid-drawer', code: 'openSettings() · L1577', role: '右侧抽屉：昵称/主题模式/奖励倍数/家长模式/修改密码/清空示例/清空全部数据。L1586-1661。' },
  // 细节放大
  { id: 'A', name: '任务头部 k-task-head', code: 'renderTaskCard() · L1038', role: '图标(k-task-ico) + 标题/分类(k-task-titles) + 状态徽章(k-task-badges)。' },
  { id: 'B', name: '目标芯片 k-task-target', code: 'renderTaskCard() · L1046', role: '展示「目标: <数量 单位>」与完成时间。' },
  { id: 'C', name: '奖励信息 k-task-reward', code: 'renderTaskCard() · L1047', role: '完成后显示金币/经验/星级奖励芯片。' },
  { id: 'D', name: '操作按钮 k-task-actions', code: 'renderTaskCard() · L1048', role: '开启挑战 / 挑战成功 / 重来 / 移除(家长) / 撤销(家长)。' },
  { id: 'E', name: '提示语 k-task-tips', code: 'renderTaskCard() · L1049', role: '按分类随机展示一句鼓励/方法提示。' },
  { id: 'F', name: '底部说明 k-task-foot', code: 'renderTaskCard() · L1050', role: '顺延/挑战中/待开始等状态说明文字。' },
  { id: 'G', name: '数字人舞台 kid-hero-box', code: 'renderRewardTab() · L1317', role: '手绘 SVG 数字人，随等级换装进化(帽子/眼镜披风/皇冠/星光/光环/钻石王冠)。' },
  { id: 'H', name: '等级信息 kid-level-info', code: 'renderRewardTab() · L1318', role: '等级称号 + 标签 + 描述 + 经验进度条 + 晋级提示。' },
  { id: 'I', name: '头像项 kid-avatar-item', code: 'renderRewardTab() · L1338', role: '单个头像(手绘 SVG)，选中(on)/锁定(locked)状态，点选切换。' },
  { id: 'J', name: '商城项 kid-shop-item', code: 'renderRewardTab() · L1359', role: '单个道具：图标/名称/说明/价格/兑换按钮。' },
  { id: 'K', name: '奖章格 kid-medal', code: 'renderRewardTab() · L1390', role: '单个奖章：图标/名称/描述/获得状态。' },
  { id: 'L', name: '钱包卡片 kid-wallet-card', code: 'renderRewardTab() · L1304', role: '单个余额卡片：圆形图标 + 数值 + 名称。' },
];

// 通用 pin + pinwrap
const pin = (id) => `<span class="pin" data-id="${id}" title="组件 ${id}">${id}</span>`;
const wrap = (id, cls, html) => `<div class="${cls} pinwrap" id="pw-${id}">${pin(id)}${html}</div>`;

// ---------- 样例数据(仅用于还原外观) ----------
const CAT = {
  sport: { name: '身体锻炼', bg: '#e0f2fe', color: '#0ea5e9', ico: '🏃' },
  rec:   { name: '背诵',     bg: '#fef3c7', color: '#f59e0b', ico: '📖' },
  write: { name: '听写默写书法', bg: '#e0e7ff', color: '#6366f1', ico: '✍️' },
  math:  { name: '数学口算', bg: '#dcfce7', color: '#22c55e', ico: '🔢' },
};

const starSvg = (f = '#fbbf24') => `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z" fill="${f}" stroke="#d97706" stroke-width="0.8"/></svg>`;
const coinSvg = (s = 15) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="12" r="10.5" fill="#fbbf24" stroke="#d97706" stroke-width="1.4"/><circle cx="12" cy="12" r="7" fill="#f59e0b"/><path d="M12 7.5l1.3 2.9 3.2.3-2.4 2.1.7 3.1L12 14.3l-2.8 1.6.7-3.1-2.4-2.1 3.2-.3z" fill="#fff7ed"/></svg>`;
const diamondSvg = (s = 15) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M7 4h10l4 5-9 11L3 9z" fill="#22d3ee" stroke="#0891b2" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const crownSvg = (s = 15) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M3 8l4 4 5-6 5 6 4-4-2 10H5z" fill="#fbbf24" stroke="#d97706" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const medalSvg = (s = 15) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="14" r="7" fill="#fb923c" stroke="#ea580c" stroke-width="1.3"/><circle cx="12" cy="14" r="4.5" fill="#fff7ed"/></svg>`;

// ---------- 各屏标记组件 ----------
const SCREEN_A = `
${wrap('1', 'kid-topbar', `
  <div class="kid-brand">
    <div class="kid-logo">${starSvg(22, '#fff')}</div>
    <div class="kid-title">得乐学苑<small>小宇 · 初级学者</small></div>
  </div>
  <span class="kid-lv-pill" style="background:#4f7cff">★ Lv.3</span>
  <span class="kid-date">📅 2026年8月17日 周一</span>
  <div class="kid-top-actions">
    <button class="kid-btn sm">⬇ 导出</button>
    <button class="kid-btn sm">⬆ 导入</button>
    <button class="kid-btn sm">🔒 家长</button>
    <button class="kid-btn sm">⚙ 设置</button>
  </div>`)}
${wrap('2', 'kid-today', `
  <div class="kid-today-head">
    <span class="kid-today-title">🎯 今天要处理</span>
    <span class="kid-today-sub">已完成 1/3 · 已连续打卡 5 天 🔥</span>
    <span class="kid-progress"><svg viewBox="0 0 44 44" width="40" height="40"><circle cx="22" cy="22" r="17" fill="none" stroke="var(--kring-bg)" stroke-width="5"/><circle cx="22" cy="22" r="17" fill="none" stroke="var(--kaccent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="106.8" stroke-dashoffset="71" transform="rotate(-90 22 22)"/></svg><span class="kid-progress-txt">33%</span></span>
  </div>
  <div class="kid-today-list">
    <div class="kid-today-item overdue" data-today="x">
      <div class="k-ti-ico" style="background:${CAT.math.bg}">${CAT.math.ico}</div>
      <div class="k-ti-main"><div class="k-ti-title">⚠ 口算 50 道</div><div class="k-ti-sub">${CAT.math.name} · 50 道</div></div>
      <span class="k-ti-tag">逾期 1 天</span>
      <button class="kid-btn sm">去完成 →</button>
    </div>
    <div class="kid-today-item" data-today="y">
      <div class="k-ti-ico" style="background:${CAT.sport.bg}">${CAT.sport.ico}</div>
      <div class="k-ti-main"><div class="k-ti-title">跳绳 200 个</div><div class="k-ti-sub">${CAT.sport.name} · 200 个</div></div>
      <button class="kid-btn sm">去完成 →</button>
    </div>
  </div>
  <div class="kid-today-banner">📌 <span>已累计完成 <b>32</b> 个任务,建议在顶部点「⬇ 导出」做一次数据备份</span></div>`)}
${wrap('3', 'kid-tabs', `
  <button class="kid-tab on"><span class="kid-tab-dot">🚀</span>今日挑战</button>
  <button class="kid-tab"><span class="kid-tab-dot">🗓️</span>学习计划</button>
  <button class="kid-tab"><span class="kid-tab-dot">👑</span>成长奖励</button>`)}
`;

// 任务卡(含状态示例)
const taskCard = (t, opts) => {
  const c = CAT[t.cat];
  const cls = `kid-task${opts.done ? ' done' : opts.carry ? ' carry' : opts.started ? ' started' : ''}`;
  const badge = opts.done ? `<span class="k-badge done">✅ 已完成</span>`
    : opts.carry ? `<span class="k-badge carry">⚠ 昨日未完成</span>`
    : opts.started ? `<span class="k-badge doing">⏳ 挑战中</span>` : '';
  const reward = opts.done ? `<div class="k-task-reward"><span class="k-reward-chip c">${coinSvg(14)} +15 金币</span><span class="k-reward-chip e">${'' /*exp*/}<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#a78bfa" stroke="#7c3aed" stroke-width="1"/></svg> +15 经验</span><span class="k-reward-chip">⭐ 3 星</span></div>` : '';
  const actions = opts.done ? `<div class="k-task-actions"><button class="kid-btn">↺ 撤销(家长)</button></div>`
    : opts.started ? `<div class="k-task-actions"><button class="kid-btn green">${'' /*rocket*/}🚀 挑战成功!</button><button class="kid-btn">↺ 重来</button></div>`
    : `<div class="k-task-actions"><button class="kid-btn challenge"></button><button class="kid-btn">✕ 移除</button></div>`;
  return `<div class="${cls}" data-task-id="x">
    <div class="k-task-head">
      <div class="k-task-ico" style="background:${c.bg}">${c.ico}</div>
      <div class="k-task-titles"><div class="k-task-name">${t.title}</div><div class="k-task-cat">${c.name}</div></div>
      <div class="k-task-badges">${badge}</div>
    </div>
    <div class="k-task-target">目标:<span class="k-unit-chip">${t.target} ${t.unit}</span></div>
    ${reward}${actions}
    <div class="k-task-tips">💡 每天进步一点点,坚持就是胜利!</div>
    <div class="k-task-foot">${opts.carry ? '从昨天自动顺延到今天,坚持就是胜利!' : opts.started ? '集中注意力,一鼓作气挑战到底!' : '点击「开启挑战」开始挑战'}</div>
  </div>`;
};

const SCREEN_B = `
${wrap('4', 'kid-sec-head', `<span class="kid-sec-title">⚔️ 今日任务(1/3)</span><span class="kid-sec-sub">完成后请家长验收打星,获得金币和经验</span>`)}
${wrap('5', 'kid-grid', taskCard({ cat: 'math', title: '口算 50 道', target: 50, unit: '道' }, { carry: true }) + taskCard({ cat: 'sport', title: '跳绳 200 个', target: 200, unit: '个' }, { started: true }) + taskCard({ cat: 'rec', title: '背诵古诗 2 首', target: 2, unit: '首' }, { done: true }))}
${wrap('6', 'kid-addtask', `＋ 添加自定义任务`)}
${wrap('7', 'kid-sec-head', `<span class="kid-sec-title">🏆 今日已挑战</span>`)}
`;

const SCREEN_C = `
${wrap('8', 'kid-plan-tools', `
  <button class="kid-btn primary">📋 套用均衡模板</button>
  <button class="kid-btn">🗑 清空计划</button>
  <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;margin-left:auto;cursor:pointer"><span>计划生成今日任务</span><span class="kid-switch on"></span></label>`)}
${wrap('9', 'kid-plan-days', [0,1,2,3,4,5,6].map(d=>{
  const names=['周日','周一','周二','周三','周四','周五','周六'];
  const items = d===1 ? [{t:'口算 50 道',u:'道'},{t:'跳绳 200 个',u:'个'}] : (d===3?[{}]:[]);
  const inner = items.length ? items.map(it=>`<div class="kid-plan-item"><span class="k-pi-dot" style="background:${CAT.math.color}"></span><span class="k-pi-text">${it.t} · ${it.u}</span><button class="k-pi-x">✕</button></div>`).join('') : `<div class="kid-plan-empty">空,点「＋」添加</div>`;
  return `<div class="kid-plan-day${d===1?' today':''}"><div class="kid-plan-day-head"><span class="kid-plan-day-name">${names[d]}${d===1?' · 今天':''}</span>${items.length?'<span style="font-size:10px;color:var(--ktext3);font-weight:700">1/2</span>':''}</div>${inner}<button class="kid-addtask" style="min-height:40px;font-size:12px">＋ 添加</button></div>`;
}).join(''))}
${wrap('10', 'kid-today-banner', `💡 每个任务都有固定奖励:完成 +10 金币/经验,星级越高奖励越多;连续打卡 3/7/14/30 天额外送钻石,一周计划全完成送 1 皇冠。`)}
`;

const SCREEN_D = `
${wrap('11', 'kid-wallet', `
  <div class="kid-wallet-card"><div class="k-w-ico" style="background:#fffbeb">${coinSvg(22)}</div><div><div class="k-w-num">120</div><div class="k-w-name">金币</div></div></div>
  <div class="kid-wallet-card"><div class="k-w-ico" style="background:#ecfeff">${diamondSvg(22)}</div><div><div class="k-w-num">4</div><div class="k-w-name">钻石</div></div></div>
  <div class="kid-wallet-card"><div class="k-w-ico" style="background:#fffbeb">${crownSvg(22)}</div><div><div class="k-w-num">2</div><div class="k-w-name">皇冠</div></div></div>
  <div class="kid-wallet-card"><div class="k-w-ico" style="background:var(--kcard)">${medalSvg(22)}</div><div><div class="k-w-num">3/6</div><div class="k-w-name">奖章</div></div></div>`)}
${wrap('12', 'kid-row2', `
  <div class="kid-card">
    <div class="kid-card-title">🏅 等级称号</div>
    <div class="kid-level-row">
      <div class="kid-hero-box">${'' /*heroSvg*/}<div style="font-size:54px">🧒</div></div>
      <div class="kid-level-info">
        <div class="kid-lv-title">初级学者<span class="kid-lv-tag" style="background:#4f7cff">Lv.3</span></div>
        <div class="kid-lv-desc">稳步前进的小学霸,继续加油!</div>
        <div class="kid-ring-row"><span class="kid-ring-label">经验</span><div class="kid-ring-bar"><div class="kid-ring-fill" style="width:60%"></div></div><span class="kid-ring-val">180/300</span></div>
        <div style="font-size:11px;color:var(--ktext3);margin-top:6px">再攒 120 经验晋级「中级学者」</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--ktext2);margin-top:10px;line-height:1.6">🔥 已连续打卡 <b>5</b> 天(历史最长 12 天) · 累计挑战 <b>32</b> 关</div>
  </div>
  <div class="kid-card">
    <div class="kid-card-title">😀 我的头像</div>
    <div class="kid-avatars">
      ${['a1','a2','a3','a4','a5','a6','a7','a8'].map((id,i)=>`<div class="kid-avatar-item${i===0?' on':''}${i>=6?' locked':''}" title="头像${i+1}"><div style="font-size:30px">${['😀','😎','😉','😜','😲','😏','🤩','🤴'][i]}</div><span class="k-a-name">${i>=6?`🔒 Lv.${i===6?5:8}`:['开心','酷酷','眨眼','淘气','惊讶','得意','星星眼','小王子'][i]}</span></div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--ktext3);margin-top:8px">数字人会随等级换装进化:帽子(3级)→ 眼镜披风(5级)→ 皇冠(7级)→ 星光(9级)→ 光环(10级)→ 钻石王冠(11级)</div>
  </div>`)}
${wrap('14', 'kid-card', `
  <div class="kid-card-title">🎁 道具商城<button class="kid-btn sm" style="margin-left:auto">＋ 管理道具</button><button class="kid-btn sm" style="margin-left:8px">兑换记录</button></div>
  <div class="kid-shop-grid">
    ${[
      {n:'冰淇淋券',note:'夏日清凉奖励',cost:30,dia:false},
      {n:'周末多玩30分',note:'游戏时间+30分钟',cost:50,dia:false},
      {n:'星空投影灯',note:'钻石专属好物',cost:3,dia:true},
    ].map(it=>`<div class="kid-shop-item"><div class="k-s-head"><div class="k-s-ico" style="background:${it.dia?'#ecfeff':'#fffbeb'}">🎁</div><div><div class="k-s-name">${it.n}</div><div style="font-size:11px;color:var(--ktext3)">${it.dia?'钻石道具':'金币道具'}</div></div></div><div class="k-s-note">${it.note}</div><div class="k-s-foot"><span class="k-s-price${it.dia?' d':''}">${it.dia?diamondSvg(15):coinSvg(15)} ${it.cost}</span><button class="kid-btn sm ${it.dia?'primary':'gold'}">兑换</button></div></div>`).join('')}
  </div>`)}
${wrap('15', 'kid-card', `
  <div class="kid-card-title">🏅 奖章墙</div>
  <div class="kid-medal-grid">
    ${[
      {n:'连胜3天',d:'连续打卡3天',got:true},{n:'连胜7天',d:'连续打卡7天',got:true},
      {n:'周计划全勤',d:'一周计划全完成',got:true},{n:'累计30关',d:'累计挑战30关',got:false},
      {n:'集齐头像',d:'解锁全部头像',got:false},{n:'首次挑战',d:'完成第一个任务',got:true},
    ].map(m=>`<div class="kid-medal${m.got?' got':' locked'}"><div style="font-size:30px;filter:${m.got?'none':'grayscale(1)'}">🏅</div><div class="k-m-name">${m.n}</div><div class="k-m-desc">${m.d}</div><div style="font-size:10px;font-weight:700;color:${m.got?'#b45309':'#9aa0b3'}">${m.got?'✅ 已获得':'未解锁'}</div></div>`).join('')}
  </div>`)}
${wrap('16', 'kid-today-banner', `💰 奖励规则:基础完成 +10 金币/经验(家长可在设置调整倍数);星级加成 ⭐×5;金币可兑换道具,钻石由连胜里程碑获得,皇冠由周计划全勤获得。`)}
`;

// 弹窗/抽屉屏:把各 overlay 直接渲染在设备框内
const SCREEN_E = `
${wrap('17', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  <div class="kid-modal-head"><div class="kid-modal-title">🎉 挑战成功!</div><button class="kid-modal-x">✕</button></div>
  <div style="display:flex;align-items:center;gap:10px;background:${CAT.rec.bg};border-radius:12px;padding:10px 12px;margin-bottom:12px"><div class="k-task-ico" style="background:${CAT.rec.bg}">${CAT.rec.ico}</div><div style="font-weight:800;font-size:15px">背诵古诗 2 首<div style="font-size:12px;color:var(--ktext2);font-weight:600">${CAT.rec.name} · 2 首</div></div></div>
  <div class="kid-label" style="text-align:center">请家长验收,给这次挑战打星 ⭐</div>
  <div class="kid-stars-pick">${[1,2,3].map(i=>`<button class="kid-star-btn${i===3?' on':''}">${starSvg(34,'#fbbf24')}</button>`).join('')}</div>
  <div id="kid-star-preview" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><span class="k-reward-chip c">${coinSvg(14)} +15 金币</span><span class="k-reward-chip e">${''}<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#a78bfa" stroke="#7c3aed" stroke-width="1"/></svg> +15 经验</span></div>
  <div class="kid-modal-actions"><button class="kid-btn">稍后</button><button class="kid-btn gold">确认领取 🎁</button></div>
</div>`)}
${wrap('18', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:420px;width:100%">
  <div class="kid-modal-head"><div class="kid-modal-title">＋ 添加今日任务</div><button class="kid-modal-x">✕</button></div>
  <div class="kid-field"><label class="kid-label">任务类型</label><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">${Object.entries(CAT).map(([k,v])=>`<button class="kid-btn" style="justify-content:flex-start;border-color:${v.color}44;background:${v.bg};color:#3a4056"><span style="width:20px;height:20px;border-radius:6px;background:${v.color};display:flex;align-items:center;justify-content:center">${v.ico}</span>${v.name}</button>`).join('')}</div></div>
  <div class="kid-field"><label class="kid-label">任务名称</label><input type="text" placeholder="例如:跳绳 200 个" maxlength="30"></div>
  <div class="kid-field"><label class="kid-label">目标数量</label><input type="number" value="1" min="1" max="999"></div>
  <div class="kid-modal-actions"><button class="kid-btn">取消</button><button class="kid-btn primary">添加任务</button></div>
</div>`)}
${wrap('22', 'kid-overlay', `<div class="kid-modal" style="position:relative;max-width:300px;width:100%">
  <div class="kid-modal-head"><div class="kid-modal-title">输入家长密码</div><button class="kid-modal-x">✕</button></div>
  <div class="kid-pwd-dots"><span class="kid-pwd-dot fill"></span><span class="kid-pwd-dot fill"></span><span class="kid-pwd-dot"></span><span class="kid-pwd-dot"></span></div>
  <div class="kid-pwd-pad">${['1','2','3','4','5','6','7','8','9','清空','0','⌫'].map(k=>`<button class="kid-pwd-key${k==='清空'||k==='⌫'?' del':''}">${k}</button>`).join('')}</div>
</div>`)}
`;

// 设置抽屉(画在右侧)
const SCREEN_E2 = `
${wrap('23', 'kid-drawer', `
  <div class="kid-drawer-head"><div class="kid-logo" style="width:38px;height:38px">${starSvg(20,'#fff')}</div><div class="kid-title" style="font-size:16px">设置</div><button class="kid-modal-x" style="margin-left:auto">✕</button></div>
  <div class="kid-drawer-body">
    <div class="kid-drawer-row"><div><div class="k-dr-label">我的昵称</div><div class="k-dr-sub">显示在顶部与等级旁</div></div><input type="text" value="小宇" style="width:130px;padding:8px 10px" maxlength="12"></div>
    <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">主题模式</div><div class="k-dr-sub">「跟随项目」与应用外观自动一致</div></div><select style="width:138px;padding:8px 10px"><option>跟随项目</option><option>儿童亮色</option><option>糖果乐园 🍬</option><option>星际探险 🚀</option><option>深色</option></select></div>
    <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">奖励倍数</div><div class="k-dr-sub">金币/经验按此倍数发放</div></div><select style="width:110px;padding:8px 10px"><option>×1 标准</option><option>×1.5 加量</option><option>×2 翻倍</option></select></div>
    <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">家长模式</div><div class="k-dr-sub">开启后解锁家长专属操作</div></div><span class="kid-switch on"></span></div>
    <div class="kid-drawer-row"><div><div class="k-dr-label" style="color:#ef4444">清空全部数据</div><div class="k-dr-sub">删除所有任务/金币/等级/计划</div></div><button class="kid-btn sm red">清空</button></div>
  </div>`)}
`;

// 细节放大屏:任务卡内部 + 奖励页部件
const SCREEN_ZOOM = `
<div class="zoom-grid">
${wrap('A', 'kid-task started', `<div class="k-task-head"><div class="k-task-ico" style="background:${CAT.sport.bg}">${CAT.sport.ico}</div><div class="k-task-titles"><div class="k-task-name">跳绳 200 个</div><div class="k-task-cat">${CAT.sport.name}</div></div><div class="k-task-badges"><span class="k-badge doing">⏳ 挑战中</span></div></div>`)}
${wrap('B', 'kid-task', `<div class="k-task-target">目标:<span class="k-unit-chip">200 个</span></div>`)}
${wrap('C', 'kid-task', `<div class="k-task-reward"><span class="k-reward-chip c">${coinSvg(14)} +15 金币</span><span class="k-reward-chip e">${''}<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#a78bfa" stroke="#7c3aed" stroke-width="1"/></svg> +15 经验</span><span class="k-reward-chip">⭐ 3 星</span></div>`)}
${wrap('D', 'kid-task', `<div class="k-task-actions"><button class="kid-btn green">🚀 挑战成功!</button><button class="kid-btn">↺ 重来</button></div>`)}
${wrap('E', 'kid-task', `<div class="k-task-tips">💡 每天进步一点点,坚持就是胜利!</div>`)}
${wrap('F', 'kid-task', `<div class="k-task-foot">集中注意力,一鼓作气挑战到底!</div>`)}
</div>
<div class="zoom-grid" style="margin-top:14px">
${wrap('G', 'kid-hero-box', `<div style="font-size:54px">🧒</div>`)}
${wrap('H', 'kid-level-info', `<div class="kid-lv-title">初级学者<span class="kid-lv-tag" style="background:#4f7cff">Lv.3</span></div><div class="kid-lv-desc">稳步前进的小学霸</div><div class="kid-ring-row"><span class="kid-ring-label">经验</span><div class="kid-ring-bar"><div class="kid-ring-fill" style="width:60%"></div></div><span class="kid-ring-val">180/300</span></div>`)}
${wrap('I', 'kid-avatar-item on', `<div style="font-size:30px">😀</div><span class="k-a-name">开心</span>`)}
${wrap('J', 'kid-shop-item', `<div class="k-s-head"><div class="k-s-ico" style="background:#fffbeb">🎁</div><div><div class="k-s-name">冰淇淋券</div><div style="font-size:11px;color:var(--ktext3)">金币道具</div></div></div><div class="k-s-note">夏日清凉奖励</div><div class="k-s-foot"><span class="k-s-price">${coinSvg(15)} 30</span><button class="kid-btn sm gold">兑换</button></div>`)}
${wrap('K', 'kid-medal got', `<div style="font-size:30px">🏅</div><div class="k-m-name">连胜7天</div><div class="k-m-desc">连续打卡7天</div><div style="font-size:10px;font-weight:700;color:#b45309">✅ 已获得</div>`)}
${wrap('L', 'kid-wallet-card', `<div class="k-w-ico" style="background:#fffbeb">${coinSvg(22)}</div><div><div class="k-w-num">120</div><div class="k-w-name">金币</div></div>`)}
</div>
`;

// ---------- 组装 ----------
const legendRows = LEGEND.map(l => `<tr class="leg" data-id="${l.id}"><td class="cnum">${l.id}</td><td class="cname">${l.name}</td><td class="ccode">${l.code}</td><td class="crole">${l.role}</td></tr>`).join('');

const navItems = [
  ['A','主框架(顶栏/今天要处理/Tab)'],
  ['B','今日挑战'],
  ['C','学习计划'],
  ['D','成长奖励'],
  ['E','弹窗与键盘'],
  ['E2','设置抽屉'],
  ['Z','部件细节放大'],
];

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>得乐学苑 · 组件标注报告</title>
<style>
  :root{--bg:#f4f6fb;--panel:#ffffff;--ink:#1f2330;--sub:#5b6172;--line:#e3e6f0;--accent:#4f7cff;--hot:#ff4d4f}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
  header.top{background:linear-gradient(135deg,#4f7cff,#8b5cf6);color:#fff;padding:22px 26px}
  header.top h1{margin:0 0 6px;font-size:22px;letter-spacing:.5px}
  header.top p{margin:0;opacity:.92;font-size:13px}
  .wrap{max-width:1180px;margin:0 auto;padding:18px;display:grid;grid-template-columns:1fr 360px;gap:18px}
  @media(max-width:1000px){.wrap{grid-template-columns:1fr}}
  .col-main{min-width:0}
  .col-side{position:sticky;top:14px;align-self:start;max-height:calc(100vh - 28px);overflow:auto}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:0 4px 16px rgba(20,30,60,.05)}
  .panel h2{margin:0 0 4px;font-size:17px}
  .panel .hint{margin:0 0 12px;font-size:12px;color:var(--sub)}
  .device{border:1px solid #d0d5e0;border-radius:14px;padding:10px;background:#fff;box-shadow:0 6px 20px rgba(20,30,60,.07);overflow:hidden}
  .device .kid-wb{max-height:none}
  /* pin */
  .pinwrap{position:relative}
  .pin{position:absolute;top:-13px;left:-13px;width:26px;height:26px;border-radius:50%;background:var(--hot);color:#fff;font:800 13px/26px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.28);cursor:pointer;z-index:30;border:2px solid #fff;transition:transform .12s}
  .pin:hover{transform:scale(1.12)}
  .pin.hot{background:#111;transform:scale(1.28);box-shadow:0 0 0 4px rgba(255,77,79,.35)}
  /* 侧栏图例 */
  .legend{width:100%;border-collapse:collapse;font-size:12px}
  .legend th{text-align:left;color:var(--sub);font-weight:700;padding:6px 8px;border-bottom:2px solid var(--line);position:sticky;top:0;background:#fff;font-size:11px}
  .legend td{border-bottom:1px solid var(--line);padding:8px;border-top:1px solid #f0f2f7;vertical-align:top}
  .legend tr{cursor:pointer}
  .legend tr:hover td{background:#f7f9ff}
  .legend tr.hot td{background:#fff3f3;box-shadow:inset 3px 0 0 var(--hot)}
  .legend .cnum{font-weight:800;color:var(--accent);width:26px;text-align:center}
  .legend .cname{font-weight:700;width:120px}
  .legend .ccode{color:#2563eb;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;width:150px}
  .legend .crole{color:var(--sub)}
  .zoom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:640px){.zoom-grid{grid-template-columns:1fr 1fr}}
  .note{font-size:12px;color:var(--sub);background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:14px}
  .toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
  .toc a{font-size:12px;text-decoration:none;background:#eef2ff;color:#3742b0;padding:5px 10px;border-radius:20px;font-weight:700}
  .toc a:hover{background:#dfe6ff}
  .src{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#2563eb}
  footer{color:var(--sub);font-size:12px;text-align:center;padding:18px}
  .kid-wb{--kaccent:#4f7cff;--kaccent2:#6a5cff}
</style>
<style>${css}</style>
</head>
<body>
<header class="top">
  <h1>得乐学苑 · 页面组件可视化标注报告</h1>
  <p>模块文件：src/pages/kidWorkspacePage.js（小学生成长闯关台 / 定制版）。下方每个可视组件均标注编号，点击编号或右侧图例可联动高亮，方便精准描述与手动修改布局与功能。</p>
</header>
<div class="wrap">
  <div class="col-main">
    <div class="note">说明：本报告使用模块<strong>真实 CSS</strong> 还原各组件外观（示例数据为演示用），编号所对应的<strong>代码位置</strong>指向 <span class="src">src/pages/kidWorkspacePage.js</span> 中的渲染函数与行号。修改 UI 时，按编号定位函数即可。</div>
    <div class="toc">${navItems.map(([id,t])=>`<a href="#scr-${id}">${t}</a>`).join('')}<a href="#legend-top">📑 组件总表</a></div>

    <div class="panel" id="scr-A">
      <h2>① 主框架：顶栏 / 今天要处理 / Tab 栏</h2>
      <p class="hint">renderTopbar() · renderToday() · renderTabs()</p>
      <div class="device"><div class="kid-wb">${SCREEN_A}</div></div>
    </div>

    <div class="panel" id="scr-B">
      <h2>② 今日挑战 Tab</h2>
      <p class="hint">renderTodayTab() · renderTaskCard()</p>
      <div class="device"><div class="kid-wb">${SCREEN_B}</div></div>
    </div>

    <div class="panel" id="scr-C">
      <h2>③ 学习计划 Tab</h2>
      <p class="hint">renderPlanTab()</p>
      <div class="device"><div class="kid-wb">${SCREEN_C}</div></div>
    </div>

    <div class="panel" id="scr-D">
      <h2>④ 成长奖励 Tab</h2>
      <p class="hint">renderRewardTab()</p>
      <div class="device"><div class="kid-wb">${SCREEN_D}</div></div>
    </div>

    <div class="panel" id="scr-E">
      <h2>⑤ 弹窗与密码键盘</h2>
      <p class="hint">openStarModal() · openTaskModal() · openPwdModal()</p>
      <div class="device"><div class="kid-wb">${SCREEN_E}</div></div>
    </div>

    <div class="panel" id="scr-E2">
      <h2>⑥ 设置抽屉</h2>
      <p class="hint">openSettings()</p>
      <div class="device"><div class="kid-wb">${SCREEN_E2}</div></div>
    </div>

    <div class="panel" id="scr-Z">
      <h2>⑦ 部件细节放大（任务卡内部 & 奖励页部件）</h2>
      <p class="hint">renderTaskCard() 子块 · renderRewardTab() 子块</p>
      <div class="device"><div class="kid-wb">${SCREEN_ZOOM}</div></div>
    </div>
  </div>

  <div class="col-side">
    <div class="panel" id="legend-top">
      <h2>📑 组件清单总表</h2>
      <p class="hint">点击任意行 → 左侧对应组件高亮并滚动到视图</p>
      <table class="legend"><thead><tr><th>#</th><th>组件</th><th>代码位置</th><th>作用</th></tr></thead><tbody>${legendRows}</tbody></table>
    </div>
  </div>
</div>
<footer>得乐学苑组件标注报告 · 由模块真实 CSS 自动还原 · 共 ${LEGEND.length} 个标注组件</footer>

<script>
  function focusId(id){
    document.querySelectorAll('.pin').forEach(p=>p.classList.toggle('hot',p.dataset.id===id));
    document.querySelectorAll('.leg').forEach(r=>r.classList.toggle('hot',r.dataset.id===id));
    const w=document.getElementById('pw-'+id); if(w) w.scrollIntoView({behavior:'smooth',block:'center'});
    const r=document.querySelector('.leg[data-id="'+id+'"]'); if(r) r.scrollIntoView({behavior:'smooth',block:'center'});
  }
  document.querySelectorAll('.pin').forEach(p=>p.addEventListener('click',e=>{e.stopPropagation();focusId(p.dataset.id);}));
  document.querySelectorAll('.leg').forEach(r=>r.addEventListener('click',()=>focusId(r.dataset.id)));
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('written:', OUT, 'bytes=', html.length, 'components=', LEGEND.length);
