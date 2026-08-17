// ============================================================================
// 得乐学苑(为 10 岁四年级男孩定制)
// 模块:①今日挑战(身体锻炼/背诵/听写默写书法/数学口算 四类任务打卡+星级)
//       ②学习计划(周一~周日每周计划制订,今日任务自动按计划生成)
//       ③成长奖励(金币/钻石/皇冠/奖章 五级奖励;等级称号晋级;数字人形象随等级进化;头像)
// 置顶「今天要处理」:逾期项标红 + 一键处理,昨天没完成的自动滚到今天。
// 数据:localStorage(wb_kid_ 前缀,导出 JSON 备份 + 导入恢复),家长模式 4 位密码。
// 规范:全内联(CSS 注入 <style>),SVG 图标/形象/图表手写,零外部依赖,PC/移动双适配。
// ============================================================================

import { toast, confirmDialog } from '../dialogs.js';

// ---------------- 样式(内联注入,固定明亮配色,不受应用暗色主题影响) ----------------
const CSS = `.kid-wb{--kblue:#4f7cff;--kgold:#f59e0b;--kdiamond:#22d3ee;--kred:#ef4444;--kgreen:#22c55e;
  --kpurple:#8b5cf6;--kpink:#ec4899;--korange:#f97316;
  --kbg:#f6f7fb;--kbg-top:#eef2ff;--kcard:#ffffff;--kcard2:#f7f8fc;--kcard3:#f1f3fa;
  --kborder:#e3e6f0;--kborder2:#c9cfe0;--ktext:#23262f;--ktext2:#5b6172;--ktext3:#8a90a3;
  --kaccent:var(--accent,#4f7cff);--kaccent2:var(--accent2,#6a5cff);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;
  background:linear-gradient(180deg,var(--kbg-top) 0%,var(--kbg) 220px);min-height:100%;color:var(--ktext);padding:14px 16px 40px;box-sizing:border-box}
.kid-wb *{box-sizing:border-box;margin:0;padding:0}
.kid-wb button{font-family:inherit;cursor:pointer;border:none;background:none;-webkit-tap-highlight-color:transparent}
.kid-wb input,.kid-wb select,.kid-wb textarea{font-family:inherit;font-size:16px}
.kid-wb input[type=text],.kid-wb input[type=number],.kid-wb input[type=password],.kid-wb select,.kid-wb textarea{
  width:100%;padding:11px 12px;border:2px solid var(--kborder);border-radius:12px;background:var(--kcard);color:var(--ktext);outline:none}
.kid-wb input:focus,.kid-wb select:focus,.kid-wb textarea:focus{border-color:var(--kaccent)}
/* 主题模式:跟随项目(默认,映射应用外观变量) / 儿童亮色(默认值) / 深色 */
.kid-wb.theme-project{--kbg:var(--bg);--kbg-top:var(--bg);--kcard:var(--bg2);--kcard2:var(--bg3);--kcard3:var(--bg4);
  --kborder:var(--border);--kborder2:var(--border);--ktext:var(--text);--ktext2:var(--text2);--ktext3:var(--text2);
  --kaccent:var(--accent);--kaccent2:var(--accent2);--kblue:var(--accent)}
.kid-wb.theme-dark{--kbg:#1b1d23;--kbg-top:#1b1d23;--kcard:#22242b;--kcard2:#2a2d36;--kcard3:#333642;
  --kborder:#343845;--kborder2:#3d424f;--ktext:#e6e8ee;--ktext2:#9aa1b2;--ktext3:#9aa1b2;
  --kaccent:var(--accent,#4f8cff);--kaccent2:var(--accent2,#6a5cff);--kblue:var(--accent,#4f8cff)}
.kid-topbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.kid-brand{display:flex;align-items:center;gap:10px;min-width:0}
.kid-logo{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#4f7cff,#8b5cf6);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(79,124,255,.35)}
.kid-title{font-size:19px;font-weight:800;letter-spacing:.5px;line-height:1.2;color:var(--ktext)}
.kid-title small{display:block;font-size:11px;font-weight:600;color:var(--ktext3);letter-spacing:1px}
.kid-date{font-size:12px;color:var(--ktext2);background:var(--kcard);border:1px solid var(--kborder);padding:5px 10px;border-radius:20px;font-weight:600}
.kid-top-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kid-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;
  border-radius:12px;font-size:15px;font-weight:700;color:var(--ktext);background:var(--kcard);border:2px solid var(--kborder);transition:transform .08s,box-shadow .15s;user-select:none}
.kid-btn:active{transform:scale(.96)}
.kid-btn.primary{background:linear-gradient(135deg,var(--kaccent),var(--kaccent2));color:#fff;border:none;box-shadow:0 4px 12px rgba(79,124,255,.35)}
.kid-btn.gold{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#fff;border:none;box-shadow:0 4px 12px rgba(245,158,11,.35)}
.kid-btn.green{background:linear-gradient(135deg,#4ade80,#22c55e);color:#fff;border:none;box-shadow:0 4px 12px rgba(34,197,94,.35)}
.kid-btn.red{background:linear-gradient(135deg,#f87171,#ef4444);color:#fff;border:none;box-shadow:0 4px 12px rgba(239,68,68,.3)}
.kid-btn.sm{min-height:34px;padding:0 12px;font-size:13px;border-radius:10px}
.kid-btn:disabled{opacity:.5;cursor:not-allowed}
.kid-today{margin-bottom:14px}
.kid-today-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.kid-today-head .kid-today-title{font-size:16px;font-weight:800;color:var(--ktext)}
.kid-today-head .kid-today-sub{font-size:12px;color:var(--ktext3)}
.kid-today-list{display:flex;flex-direction:column;gap:6px}
.kid-today-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--kcard);
  border:1.5px solid var(--kborder);box-shadow:0 2px 6px rgba(30,41,59,.05)}
.kid-today-item.overdue{border-color:#f87171;background:var(--kcard)}
.kid-today-item .k-ti-ico{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kid-today-item .k-ti-main{flex:1;min-width:0}
.kid-today-item .k-ti-title{font-size:14px;font-weight:700;color:var(--ktext);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kid-today-item .k-ti-sub{font-size:11px;color:var(--ktext3)}
.kid-today-item.overdue .k-ti-title{color:#f87171}
.kid-today-item .k-ti-tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:#fee2e2;color:#dc2626;flex-shrink:0}
.kid-today-empty{font-size:13px;color:var(--ktext3);background:var(--kcard);border:1.5px dashed var(--kborder2);border-radius:12px;padding:14px;text-align:center}
.kid-today-banner{display:flex;align-items:center;gap:8px;margin-top:8px;padding:9px 12px;border-radius:10px;
  background:#fffbeb;border:1px solid #fde68a;font-size:12px;color:#92400e}
.kid-today-banner b{color:#b45309}
.kid-tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.kid-tab{flex:1;min-width:120px;min-height:48px;border-radius:14px;background:var(--kcard);border:2px solid var(--kborder);
  font-size:15px;font-weight:800;color:var(--ktext2);display:flex;align-items:center;justify-content:center;gap:8px}
.kid-tab.on{background:var(--kcard2);color:var(--kaccent);border-color:var(--kaccent);box-shadow:0 2px 8px color-mix(in srgb,var(--kaccent) 16%,transparent)}
.kid-tab.on .kid-tab-dot{background:none}
.kid-sec-head{display:flex;align-items:center;gap:8px;margin:4px 0 10px}
.kid-sec-head .kid-sec-title{font-size:16px;font-weight:800;color:var(--ktext)}
.kid-sec-head .kid-sec-sub{font-size:12px;color:var(--ktext3);margin-left:auto}
.kid-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.kid-task{background:var(--kcard);border-radius:16px;border:2px solid var(--kborder);padding:14px;display:flex;flex-direction:column;gap:10px;
  box-shadow:0 2px 8px rgba(30,41,59,.06);transition:box-shadow .15s}
.kid-task.carry{border-color:#f87171;box-shadow:0 2px 10px rgba(239,68,68,.15)}
.kid-task.started{border-color:var(--kaccent)}
.kid-task.done{background:var(--kcard);border-color:#4ade80}
.kid-task.done .k-task-main{opacity:.75}
.k-task-head{display:flex;align-items:center;gap:10px}
.k-task-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.k-task-titles{flex:1;min-width:0}
.k-task-name{font-size:15px;font-weight:800;color:var(--ktext)}
.k-task-cat{font-size:11px;font-weight:700;color:var(--ktext3)}
.k-task-badges{display:flex;gap:5px;flex-shrink:0}
.k-badge{font-size:10px;font-weight:800;padding:3px 8px;border-radius:9px}
.k-badge.overdue{background:#fee2e2;color:#dc2626}
.k-badge.carry{background:#fef3c7;color:#b45309}
.k-badge.doing{background:#dbeafe;color:#2563eb}
.k-badge.done{background:#dcfce7;color:#15803d}
.k-task-target{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ktext2);flex-wrap:wrap}
.k-task-target .k-unit-chip{background:var(--kcard3);border-radius:8px;padding:3px 9px;font-weight:700}
.k-task-actions{display:flex;gap:8px;flex-wrap:wrap}
.k-task-actions .kid-btn{flex:1;min-width:110px}
.k-task-reward{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.k-reward-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:800;color:var(--ktext2);
  background:var(--kcard2);border-radius:20px;padding:4px 10px}
.k-task-stars{display:flex;gap:2px;align-items:center}
.k-task-tips{font-size:12px;color:var(--ktext2);background:var(--kcard2);border-radius:10px;padding:8px 10px;line-height:1.5}
.k-task-foot{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ktext3)}
.k-addtask{min-height:52px;border:2px dashed var(--kborder2);border-radius:16px;background:var(--kcard);
  display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:700;color:var(--ktext2);width:100%}
.k-addtask:hover{border-color:var(--kaccent);color:var(--kaccent)}
.kid-plan-wrap{display:flex;flex-direction:column;gap:12px}
.kid-plan-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kid-plan-days{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.kid-plan-day{background:var(--kcard);border:2px solid var(--kborder);border-radius:14px;padding:10px;min-height:150px;display:flex;flex-direction:column;gap:6px}
.kid-plan-day.today{border-color:var(--kaccent);box-shadow:0 0 0 1px var(--kaccent) inset}
.kid-plan-day.off{opacity:.5}
.kid-plan-day-head{display:flex;align-items:center;justify-content:space-between;gap:4px}
.kid-plan-day-name{font-size:13px;font-weight:800;color:var(--ktext)}
.kid-plan-day-head .kid-btn{padding:0 8px;min-height:30px;font-size:12px}
.kid-plan-item{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;background:var(--kcard2);border-radius:9px;padding:6px 8px}
.kid-plan-item .k-pi-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.kid-plan-item .k-pi-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kid-plan-item .k-pi-x{color:var(--kborder2);font-size:13px;padding:0 2px;flex-shrink:0}
.kid-plan-item .k-pi-x:hover{color:#ef4444}
.kid-plan-empty{font-size:11px;color:var(--ktext3);text-align:center;padding:8px 0}
.kid-wallet{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.kid-wallet-card{background:var(--kcard);border-radius:14px;border:2px solid var(--kborder);padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 6px rgba(30,41,59,.05)}
.kid-wallet-card .k-w-ico{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kid-wallet-card .k-w-num{font-size:19px;font-weight:800;line-height:1.1;color:var(--ktext)}
.kid-wallet-card .k-w-name{font-size:11px;color:var(--ktext3);font-weight:600}
.kid-row2{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;margin-bottom:12px}
.kid-card{background:var(--kcard);border-radius:16px;border:2px solid var(--kborder);padding:14px;box-shadow:0 2px 8px rgba(30,41,59,.06)}
.kid-card-title{font-size:15px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:8px;color:var(--ktext)}
.kid-level-row{display:flex;align-items:center;gap:14px}
.kid-hero-box{flex-shrink:0;width:120px;height:150px;border-radius:16px;background:var(--kcard2);
  border:2px solid var(--kborder);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.kid-level-info{flex:1;min-width:0}
.kid-lv-title{font-size:17px;font-weight:800;display:flex;align-items:center;gap:8px;color:var(--ktext)}
.kid-lv-tag{font-size:11px;font-weight:800;color:#fff;border-radius:9px;padding:3px 8px}
.kid-lv-desc{font-size:12px;color:var(--ktext2);margin:6px 0 10px;line-height:1.5}
.kid-ring-row{display:flex;align-items:center;gap:12px}
.kid-ring-label{font-size:12px;color:var(--ktext3)}
.kid-ring-val{font-size:13px;font-weight:800;color:var(--ktext)}
.kid-ring-bar{flex:1;height:10px;border-radius:6px;background:var(--kcard3);overflow:hidden}
.kid-ring-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--kaccent),#8b5cf6);transition:width .4s}
.kid-avatars{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kid-avatar-item{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;padding:6px;border-radius:12px;border:2px solid transparent}
.kid-avatar-item.on{border-color:var(--kaccent);background:var(--kcard2)}
.kid-avatar-item.locked{opacity:.45}
.kid-avatar-item .k-a-name{font-size:10px;color:var(--ktext3);font-weight:600}
.kid-shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.kid-shop-item{background:var(--kcard);border-radius:14px;border:2px solid var(--kborder);padding:12px;display:flex;flex-direction:column;gap:8px}
.kid-shop-item .k-s-head{display:flex;align-items:center;gap:10px}
.kid-shop-item .k-s-ico{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--kcard3)}
.kid-shop-item .k-s-name{font-size:14px;font-weight:800;color:var(--ktext)}
.kid-shop-item .k-s-note{font-size:12px;color:var(--ktext2);line-height:1.4}
.kid-shop-item .k-s-foot{display:flex;align-items:center;justify-content:space-between;gap:6px}
.kid-shop-item .k-s-price{font-size:13px;font-weight:800;color:var(--ktext);display:flex;align-items:center;gap:4px}
.kid-medal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.kid-medal{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border-radius:14px;background:var(--kcard);
  border:2px solid var(--kborder);text-align:center}
.kid-medal.got{border-color:#fde68a;background:#fffbeb}
.kid-medal .k-m-name{font-size:12px;font-weight:800;color:var(--ktext)}
.kid-medal .k-m-desc{font-size:10px;color:var(--ktext3);line-height:1.4}
.kid-medal.locked .k-m-name{color:var(--ktext3)}
.kid-medal.locked{opacity:.65}
.kid-hint-strip{font-size:12px;color:#7c6a12;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 12px;margin-bottom:12px}
.kid-overlay{position:fixed;inset:0;z-index:9990;background:rgba(20,24,40,.45);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px)}
.kid-modal{background:var(--kcard);border-radius:20px;max-width:420px;width:100%;max-height:88vh;overflow:auto;padding:18px;box-shadow:0 20px 60px rgba(20,24,40,.3);animation:kidPop .18s ease}
@keyframes kidPop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}
.kid-modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px}
.kid-modal-title{font-size:17px;font-weight:800;color:var(--ktext)}
.kid-modal-x{width:38px;height:38px;border-radius:10px;background:var(--kcard3);font-size:16px;color:var(--ktext2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kid-modal-x:hover{background:var(--kcard2)}
.kid-field{margin-bottom:12px}
.kid-label{display:block;font-size:12px;font-weight:700;color:var(--ktext2);margin-bottom:6px}
.kid-stars-pick{display:flex;justify-content:center;gap:14px;padding:8px 0 14px}
.kid-star-btn{width:64px;height:64px;border-radius:16px;background:var(--kcard3);display:flex;align-items:center;justify-content:center;transition:transform .1s}
.kid-star-btn.on{background:#fef3c7;transform:scale(1.08);box-shadow:0 0 0 2px #f59e0b}
.kid-star-btn:hover{transform:scale(1.06)}
.kid-modal-actions{display:flex;gap:10px;margin-top:14px}
.kid-modal-actions .kid-btn{flex:1}
.kid-drawer{position:fixed;top:0;right:0;bottom:0;z-index:9990;width:min(420px,94vw);background:var(--kcard);
  box-shadow:-12px 0 40px rgba(20,24,40,.25);display:flex;flex-direction:column;animation:kidSlide .18s ease}
@keyframes kidSlide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
.kid-drawer-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--kborder)}
.kid-drawer-body{flex:1;overflow:auto;padding:16px 18px;padding-bottom:calc(16px + env(safe-area-inset-bottom))}
.kid-drawer-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid var(--kborder)}
.kid-drawer-row .k-dr-label{font-size:14px;font-weight:700;color:var(--ktext)}
.kid-drawer-row .k-dr-sub{font-size:11px;color:var(--ktext3)}
.kid-switch{width:50px;height:28px;border-radius:16px;background:var(--kborder2);position:relative;transition:background .15s;flex-shrink:0}
.kid-switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--kcard);transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.kid-switch.on{background:var(--kaccent)}
.kid-switch.on::after{left:25px}
.kid-sec-gap{margin-top:16px}
.kid-pwd-dots{display:flex;gap:10px;justify-content:center;padding:6px 0 12px}
.kid-pwd-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--kborder2);background:var(--kcard2)}
.kid-pwd-dot.fill{background:var(--kaccent);border-color:var(--kaccent)}
.kid-pwd-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.kid-pwd-key{min-height:56px;border-radius:14px;background:var(--kcard3);font-size:20px;font-weight:800;color:var(--ktext);display:flex;align-items:center;justify-content:center}
.kid-pwd-key:hover{background:var(--kcard2)}
.kid-pwd-key.del{font-size:15px;color:#ef4444}
.kid-confetti{position:absolute;pointer-events:none}
.kid-toast-ok{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;background:#22c55e;color:#fff;
  padding:12px 22px;border-radius:30px;font-size:14px;font-weight:700;box-shadow:0 8px 24px rgba(34,197,94,.4);animation:kidPop .2s ease}
.kid-hl{animation:kidHl 1s ease 2}
@keyframes kidHl{0%,100%{box-shadow:0 0 0 0 rgba(79,124,255,0)}40%{box-shadow:0 0 0 6px rgba(79,124,255,.45)}}
@media (max-width:768px){
  .kid-wb{padding:10px 10px 30px}
  .kid-title{font-size:17px}
  .kid-grid{grid-template-columns:1fr}
  .kid-plan-days{grid-template-columns:1fr}
  .kid-wallet{grid-template-columns:repeat(2,1fr)}
  .kid-row2{grid-template-columns:1fr}
  .kid-tab{min-width:100px;min-height:46px;font-size:14px}
  .kid-avatars{grid-template-columns:repeat(4,1fr)}
  .kid-modal{max-height:90vh}
}
@media (max-width:420px){
  .kid-avatars{grid-template-columns:repeat(4,1fr)}
  .kid-wallet-card{padding:8px 10px}
  .kid-wallet-card .k-w-num{font-size:16px}
}

/* ============ 主题模式支持(深色/浅色/跟随项目,追加覆盖,优先级高于基础样式) ============ */
.kid-wb{--kbg:#f6f7fb;--kbg-top:#eef2ff;--kcard:#ffffff;--kcard2:#f7f8fc;--kcard3:#f1f3fa;
  --kborder:#e3e6f0;--kborder2:#c9cfe0;--ktext:#23262f;--ktext2:#5b6172;--ktext3:#8a90a3;
  --kaccent:var(--accent,#4f7cff);--kaccent2:var(--accent2,#6a5cff);--kblue:var(--accent,#4f7cff);
  background:linear-gradient(180deg,var(--kbg-top) 0%,var(--kbg) 220px);color:var(--ktext)}
/* 跟随项目:映射应用外观变量(深色/浅色/自定义/系统主题自动同步) */
.kid-wb.theme-project{--kbg:var(--bg);--kbg-top:var(--bg);--kcard:var(--bg2);--kcard2:var(--bg3);--kcard3:var(--bg4);
  --kborder:var(--border);--kborder2:var(--border);--ktext:var(--text);--ktext2:var(--text2);--ktext3:var(--text2);
  --kaccent:var(--accent);--kaccent2:var(--accent2);--kblue:var(--accent)}
/* 固定深色 */
.kid-wb.theme-dark{--kbg:#1b1d23;--kbg-top:#1b1d23;--kcard:#22242b;--kcard2:#2a2d36;--kcard3:#333642;
  --kborder:#343845;--kborder2:#3d424f;--ktext:#e6e8ee;--ktext2:#9aa1b2;--ktext3:#9aa1b2;
  --kaccent:var(--accent,#4f8cff);--kaccent2:var(--accent2,#6a5cff);--kblue:var(--accent,#4f8cff)}
/* 卡片/面板/输入框:背景 + 边框 + 主文字 */
/* 注:.kid-btn 默认背景由下方 :where(.kid-wb) .kid-btn 段(0,1,0) 接管,变体 .primary/.gold/.green/.red/.challenge 自有样式胜出 */
.kid-wb .kid-card,.kid-wb .kid-task:not(.carry):not(.started):not(.done),.kid-wb .kid-wallet-card,
.kid-wb .kid-shop-item,.kid-wb .kid-medal:not(.got),.kid-wb .kid-today-item:not(.overdue),
.kid-wb .kid-today-empty,.kid-wb .kid-plan-day,.kid-wb .kid-tab:not(.on),.kid-wb .kid-date,
.kid-wb .kid-addtask,.kid-wb .kid-modal,.kid-wb .kid-drawer,
.kid-wb input[type=text],.kid-wb input[type=number],.kid-wb input[type=password],.kid-wb select,.kid-wb textarea{background:var(--kcard)}
.kid-wb .kid-task:not(.carry):not(.started):not(.done),.kid-wb .kid-wallet-card,.kid-wb .kid-shop-item,
.kid-wb .kid-medal:not(.got),.kid-wb .kid-today-item:not(.overdue),.kid-wb .kid-today-empty,
.kid-wb .kid-plan-day,.kid-wb .kid-tab:not(.on),.kid-wb .kid-date,.kid-wb .kid-card,
.kid-wb .kid-addtask,.kid-wb .kid-modal,.kid-wb .kid-drawer,
.kid-wb input[type=text],.kid-wb input[type=number],.kid-wb input[type=password],.kid-wb select,.kid-wb textarea{border-color:var(--kborder)}
/* 次级背景(内嵌 chip/工具条) */
.kid-wb .kid-plan-item,.kid-wb .k-unit-chip,.kid-wb .k-reward-chip,.kid-wb .kid-avatar-item.on,
.kid-wb .kid-hero-box,.kid-wb .k-s-ico,.kid-wb .kid-modal-x,.kid-wb .kid-pwd-key,.kid-wb .kid-star-btn,
.kid-wb .kid-ring-bar,.kid-wb .kid-pwd-dot,.kid-wb .kid-switch{background:var(--kcard2)}
/* 第三级背景 */
.kid-wb .kid-modal-x,.kid-wb .kid-pwd-key,.kid-wb .kid-star-btn,.kid-wb .kid-ring-bar,.kid-wb .kid-pwd-dot{background:var(--kcard3)}
/* 主文字 */
.kid-wb .kid-title,.kid-wb .kid-today-title,.kid-wb .kid-sec-title,.kid-wb .kid-card-title,.kid-wb .kid-modal-title,
.kid-wb .kid-lv-title,.kid-wb .kid-plan-day-name,.kid-wb .kid-task-name,.kid-wb .k-s-name,.kid-wb .k-dr-label,
.kid-wb .k-m-name,.kid-wb .kid-wallet-card .k-w-num,.kid-wb .kid-pwd-key,.kid-wb .k-ti-title{color:var(--ktext)}
.kid-wb .kid-today-item.overdue .k-ti-title{color:#f87171}
/* 弱文字 */
.kid-wb .kid-title small,.kid-wb .kid-date,.kid-wb .kid-today-sub,.kid-wb .kid-sec-sub,.kid-wb .k-task-cat,
.kid-wb .k-task-foot,.kid-wb .kid-plan-empty,.kid-wb .kid-today-empty,.kid-wb .k-w-name,.kid-wb .k-a-name,
.kid-wb .k-m-desc,.kid-wb .k-dr-sub,.kid-wb .kid-ring-label,.kid-wb .kid-lv-desc{color:var(--ktext3)}
/* 次文字 */
.kid-wb .kid-tab,.kid-wb .kid-label,.kid-wb .kid-btn,.kid-wb .kid-addtask,.kid-wb .kid-modal-x,
.kid-wb .k-task-target,.kid-wb .k-task-tips,.kid-wb .k-s-note,.kid-wb .k-reward-chip,.kid-wb .k-s-price{color:var(--ktext2)}
/* 虚线边框 */
.kid-wb .kid-today-empty,.kid-wb .kid-addtask{border-color:var(--kborder2)}
/* 强调色 */
.kid-wb .kid-btn.primary{background:linear-gradient(135deg,var(--kaccent),var(--kaccent2))}
.kid-wb .kid-task.started,.kid-wb .kid-plan-day.today,.kid-wb .kid-avatar-item.on,.kid-wb .kid-addtask:hover{border-color:var(--kaccent)}
.kid-wb .kid-switch.on,.kid-wb .kid-pwd-dot.fill{background:var(--kaccent);border-color:var(--kaccent)}
.kid-wb .kid-ring-fill{background:linear-gradient(90deg,var(--kaccent),#8b5cf6)}
.kid-wb .kid-addtask:hover{color:var(--kaccent)}
.kid-wb input:focus,.kid-wb select:focus,.kid-wb textarea:focus{border-color:var(--kaccent)}

/* ============ v2.1.9 UI 设计系统升级:设计 token + 糖果乐园/星际探险主题 + 组件精修 ============ */
/* —— 设计 Token(圆角/阴影/进度环底色) —— */
.kid-wb{
  --kr-sm:10px;--kr:14px;--kr-lg:18px;--kr-xl:22px;--kr-pill:999px;
  --ks-1:0 2px 8px rgba(20,30,60,.07);
  --ks-2:0 10px 28px rgba(20,30,60,.13);
  --ks-3:0 18px 48px rgba(20,30,60,.20);
  --kring-bg:color-mix(in srgb,var(--kaccent) 22%,var(--kcard));
  --kglow:0 6px 18px color-mix(in srgb,var(--kaccent) 38%,transparent);
}
/* —— 主题皮肤:糖果乐园(柔和粉彩马卡龙) —— */
.kid-wb.theme-candy{
  --kbg:#fff2f7;--kbg-top:#ffeaf3;--kcard:#fffdfe;--kcard2:#fff5fa;--kcard3:#ffe9f3;
  --kborder:#f6d5e4;--kborder2:#f0bcd5;--ktext:#4a1d5f;--ktext2:#8a5a94;--ktext3:#b48ab8;
  --kaccent:var(--accent,#f472b6);--kaccent2:var(--accent2,#c084fc);--kblue:var(--accent,#f472b6);
}
/* —— 主题皮肤:星际探险(深蓝星空霓虹) —— */
.kid-wb.theme-space{
  --kbg:#0b1026;--kbg-top:#0d1230;--kcard:#1a2340;--kcard2:#212c52;--kcard3:#2a3763;
  --kborder:#2b3a6b;--kborder2:#3a4c85;--ktext:#e2e8ff;--ktext2:#9fb0e8;--ktext3:#7d90c8;
  --kaccent:var(--accent,#38bdf8);--kaccent2:var(--accent2,#8b5cf6);--kblue:var(--accent,#38bdf8);
  background:
    radial-gradient(1.5px 1.5px at 12% 20%,rgba(255,255,255,.55) 50%,transparent 51%),
    radial-gradient(1.5px 1.5px at 80% 10%,rgba(255,255,255,.45) 50%,transparent 51%),
    radial-gradient(1px 1px at 30% 65%,rgba(255,255,255,.4) 50%,transparent 51%),
    radial-gradient(1.5px 1.5px at 90% 55%,rgba(255,255,255,.5) 50%,transparent 51%),
    radial-gradient(1px 1px at 55% 88%,rgba(255,255,255,.35) 50%,transparent 51%),
    radial-gradient(2px 2px at 66% 32%,rgba(255,255,255,.3) 50%,transparent 51%),
    linear-gradient(180deg,var(--kbg-top) 0%,var(--kbg) 260px);
}
/* —— 品牌区:Logo 光晕 + 等级徽章胶囊 —— */
.kid-wb .kid-logo{border-radius:16px;box-shadow:0 6px 18px color-mix(in srgb,var(--kaccent) 45%,transparent)}
.kid-wb .kid-title{font-size:20px}
.kid-wb .kid-lv-pill{display:inline-flex;align-items:center;gap:4px;min-height:26px;padding:0 12px;border-radius:var(--kr-pill);
  color:#fff;font-size:12px;font-weight:800;letter-spacing:.5px;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.kid-wb .kid-date{border-radius:var(--kr-pill)}
/* —— 今日仪表盘:进度环 + 列表 —— */
.kid-wb .kid-today-head{flex-wrap:wrap}
.kid-wb .kid-progress{display:inline-flex;align-items:center;gap:6px}
.kid-wb .kid-progress svg{filter:drop-shadow(0 2px 6px color-mix(in srgb,var(--kaccent) 40%,transparent))}
.kid-wb .kid-progress circle:last-child{transition:stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)}
.kid-wb .kid-progress-txt{font-size:12px;font-weight:800;color:var(--kaccent);min-width:32px}
.kid-wb .kid-today-item{border-radius:var(--kr-lg);transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .18s}
.kid-wb .kid-today-item:hover{transform:translateY(-1px);box-shadow:var(--ks-2)}
.kid-wb .kid-today-item .k-ti-ico{border-radius:10px}
.kid-wb .kid-today-item.overdue{background:linear-gradient(90deg,color-mix(in srgb,#f87171 12%,var(--kcard)),var(--kcard))}
/* —— Tab 胶囊 + 激活光效 —— */
.kid-wb .kid-tabs{gap:10px}
.kid-wb .kid-tab{border-radius:var(--kr-lg);transition:transform .16s cubic-bezier(.22,1,.36,1),box-shadow .16s}
.kid-wb .kid-tab:hover:not(.on){transform:translateY(-1px);box-shadow:var(--ks-1)}
.kid-wb .kid-tab.on{box-shadow:0 2px 8px color-mix(in srgb,var(--kaccent) 14%,transparent)}
.kid-wb .kid-tab .kid-tab-dot{font-size:16px}
/* —— 任务卡:渐变顶条 + 悬停上浮 —— */
.kid-wb .kid-task{position:relative;border-radius:var(--kr-lg);overflow:hidden;transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .18s,border-color .18s}
.kid-wb .kid-task:hover{transform:translateY(-2px);box-shadow:var(--ks-2)}
.kid-wb .kid-task::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;
  background:linear-gradient(90deg,var(--kaccent),var(--kaccent2));opacity:.9}
.kid-wb .kid-task.done::before{background:linear-gradient(90deg,#4ade80,#22c55e)}
.kid-wb .kid-task.carry::before{background:linear-gradient(90deg,#f87171,#ef4444)}
.kid-wb .k-task-ico{border-radius:14px;box-shadow:0 4px 10px color-mix(in srgb,var(--kaccent) 22%,transparent)}
.kid-wb .k-badge,.kid-wb .k-unit-chip,.kid-wb .k-reward-chip{border-radius:var(--kr-pill)}
.kid-wb .kid-task .kid-btn{min-height:40px;border-radius:var(--kr)}
/* —— 按钮质感 —— */
.kid-wb .kid-btn{font-weight:700;transition:transform .12s cubic-bezier(.22,1,.36,1),box-shadow .18s,background .18s}
.kid-wb .kid-btn:hover:not(:disabled){transform:translateY(-1px)}
.kid-wb .kid-btn.primary,.kid-wb .kid-btn.gold,.kid-wb .kid-btn.green,.kid-wb .kid-btn.red{box-shadow:0 5px 14px color-mix(in srgb,currentColor 20%,transparent)}
/* —— 钱包:圆形徽章 + 悬停 —— */
.kid-wb .kid-wallet-card{border-radius:var(--kr-lg);transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .18s}
.kid-wb .kid-wallet-card:hover{transform:translateY(-2px);box-shadow:var(--ks-2)}
.kid-wb .kid-wallet-card .k-w-ico{border-radius:50%;width:40px;height:40px}
/* —— 数字人舞台:主题光晕 —— */
.kid-wb .kid-hero-box{border-radius:var(--kr-lg);background:
  radial-gradient(circle at 50% 28%,color-mix(in srgb,var(--kaccent) 34%,var(--kcard2)),var(--kcard2) 72%)}
/* —— 计划/商城/奖章 —— */
.kid-wb .kid-plan-day{border-radius:var(--kr-lg)}
.kid-wb .kid-plan-item{border-radius:10px}
.kid-wb .kid-shop-item{border-radius:var(--kr-lg)}
.kid-wb .kid-medal{border-radius:var(--kr-lg);transition:transform .18s,box-shadow .18s}
.kid-wb .kid-medal:hover{transform:translateY(-2px);box-shadow:var(--ks-2)}
/* —— 弹窗/抽屉/密码键盘 —— */
.kid-wb .kid-modal{border-radius:var(--kr-xl)}
.kid-wb .kid-modal-x,.kid-wb .kid-pwd-key{border-radius:var(--kr)}
/* —— 可访问性:焦点可见 + 减少动效 —— */
.kid-wb :focus-visible{outline:2px solid var(--kaccent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){
  .kid-wb *,.kid-wb *::before,.kid-wb *::after{animation-duration:.001s!important;transition-duration:.001s!important}
}

/* ============ v2.1.9 配色优化:按钮/图标对比度全面修正 ============ */
/* 主因修复:主题覆盖段「次文字」规则曾把主按钮 color 覆盖成灰/深 → 彩色按钮统一高对比文字 */
.kid-wb .kid-btn.primary,.kid-wb .kid-btn.green,.kid-wb .kid-btn.red{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.18)}
.kid-wb .kid-btn.gold{color:#7c2d12;text-shadow:none}
/* 主按钮底色加深,保证白字对比(≥3:1 大字标准,接近 AA) */
.kid-wb .kid-btn.primary{background:linear-gradient(135deg,var(--kaccent),color-mix(in srgb,var(--kaccent2) 72%,#000))}
.kid-wb .kid-btn.green{background:linear-gradient(135deg,#4ade80,#15803d)}
.kid-wb .kid-btn.red{background:linear-gradient(135deg,#f87171,#dc2626)}
.kid-wb .kid-btn.gold{background:linear-gradient(135deg,#fbbf24,#d97706)}
/* 糖果乐园/星际探险:强调色偏亮,主按钮单独加深(白字对比≥3:1) */
.kid-wb.theme-candy .kid-btn.primary{background:linear-gradient(135deg,var(--kaccent),color-mix(in srgb,var(--kaccent2) 72%,#000))}
.kid-wb.theme-space .kid-btn.primary{background:linear-gradient(135deg,var(--kaccent),color-mix(in srgb,var(--kaccent2) 72%,#000))}
/* 默认按钮基础(非彩色):次级亮底 + 主文字,深浅主题下对比充足(原暗底灰字不可读) */
/* 用 :where() 把基础段 specificity 压到 0,1,0,让 .kid-btn.challenge (0,3,0) 等变体自然胜出 */
:where(.kid-wb) .kid-btn{background:var(--kcard2);color:var(--ktext);border-color:var(--kborder)}
:where(.kid-wb) .kid-btn:hover:not(:disabled){border-color:var(--kaccent);color:var(--ktext)}
/* 分类徽章(浅色分类底上的白线条图标)与锁定头像可读性 */
.kid-wb .kid-avatar-item.locked{opacity:.62}
.kid-wb .kid-lv-pill{text-shadow:0 1px 2px rgba(0,0,0,.5),0 0 4px rgba(0,0,0,.28)}
/* 今日列表「去完成」与任务卡按钮同主按钮规则(默认按钮统一) */
.kid-wb .kid-today-item .kid-btn.primary{color:#fff}
/* Tab 激活态:不再用白字+渐变填充,改主题强调色文字(贴近非激活标签的浅底配色) */
.kid-wb .kid-tab.on{color:var(--kaccent)}

/* ============ 开启挑战按钮(直接使用背景图片) ============
   来源:E:\backup\asset\btn\btn_start_challenge256.png (256×96 橙黄渐变胶囊+紫描边+紫火箭+紫文字)
   嵌入 base64,零外部资源;渲染端/预览页/独立 HTML 均可用 */
.kid-wb .kid-btn.challenge{
  background-image:url(data:image/png;base64,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);
  background-size:contain;
  background-repeat:no-repeat;
  background-position:center;
  background-color:transparent;
  border:none;
  box-shadow:none;
  text-shadow:none;
  color:transparent;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  aspect-ratio:256 / 96;
  height:44px;
  width:auto;
  padding:0;
  border-radius:0;
  font-weight:800;
  gap:0;
  flex:0 0 auto;
  max-width:100%;
}
.kid-wb .kid-btn.sm.challenge{
  width:160px;
  aspect-ratio:256 / 96;
  flex:0 0 auto;
}
.kid-wb .k-task-actions .kid-btn.challenge{margin:0 auto}
.kid-wb .kid-btn.challenge:hover:not(:disabled){
  transform:translateY(-1px);
  filter:brightness(1.05) drop-shadow(0 6px 16px rgba(245,158,11,.35));
}
.kid-wb .kid-btn.challenge:active:not(:disabled){transform:translateY(0);filter:brightness(.98)}
.kid-wb .kid-btn.challenge svg{display:none}

/* ============ 跟随项目模式:变量兜底(应用内取应用主题变量;独立/预览环境回退系统深浅色) ============ */
/* 关键修复:此前 var(--accent) 等无兜底,在无应用变量的环境(预览页/独立部署)下渐变全部失效 → 按钮透明底+白字 */
.kid-wb.theme-project{
  --kbg: var(--bg, #1b1d23); --kbg-top: var(--bg, #1b1d23);
  --kcard: var(--bg2, #22242b); --kcard2: var(--bg3, #2a2d36); --kcard3: var(--bg4, #333642);
  --kborder: var(--border, #343845); --kborder2: var(--border, #343845);
  --ktext: var(--text, #e6e8ee); --ktext2: var(--text2, #9aa1b2); --ktext3: var(--text2, #9aa1b2);
  --kaccent: var(--accent, #4f8cff); --kaccent2: var(--accent2, #6a5cff); --kblue: var(--accent, #4f8cff);
}
/* 系统浅色时(仅无应用变量的环境生效,应用内取应用变量值不受影响) */
@media (prefers-color-scheme: light){
  .kid-wb.theme-project{
    --kbg: var(--bg, #f3f4f7); --kbg-top: var(--bg, #f3f4f7);
    --kcard: var(--bg2, #ffffff); --kcard2: var(--bg3, #e8eaef); --kcard3: var(--bg4, #dce0e7);
    --kborder: var(--border, #d2d6df); --kborder2: var(--border, #d2d6df);
    --ktext: var(--text, #1f2329); --ktext2: var(--text2, #6b7280); --ktext3: var(--text2, #6b7280);
    --kaccent: var(--accent, #2f6fe0); --kaccent2: var(--accent2, #1f5fd0); --kblue: var(--accent, #2f6fe0);
  }
}
`;

function ensureKidStyle() {
  if (!document.getElementById('kid-wb-style')) {
    const st = document.createElement('style');
    st.id = 'kid-wb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
}

// ---------------- 分类配置 ----------------
// deep:图标线条深色变体,在浅色分类底(bg)上高对比(白线条在浅底上不可见)
const CATS = {
  sport: { name: '身体锻炼', color: '#f59e0b', deep: '#b45309', bg: '#fff7ed', unit: '分钟',
    icon: '<path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#fff"/>',
    tips: ['跳绳 200 个', '开合跳 3 组 × 20 个', '原地慢跑 5 分钟', '广播体操 1 遍', '拉伸放松 3 分钟'] },
  recite: { name: '背诵', color: '#8b5cf6', deep: '#6d28d9', bg: '#f5f3ff', unit: '篇',
    icon: '<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm4-1v16M12 7h4M12 11h4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    tips: ['课文大声读 3 遍再背', '先背一段再连起来', '让家长抽查 2 次', '睡前再默背一遍更牢'] },
  write: { name: '听写·默写·书法', color: '#ec4899', deep: '#be185d', bg: '#fdf2f8', unit: '课',
    icon: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    tips: ['生字先看笔顺再写', '写 3 遍记牢它', '英文单词边读边拼', '注意坐姿和握笔姿势'] },
  math: { name: '数学口算·习题', color: '#3b82f6', deep: '#1d4ed8', bg: '#eff6ff', unit: '组',
    icon: '<path d="M9 3h6v18H9zM3 8h3v10H3zM18 8h3v10h-3z" fill="#fff"/>',
    tips: ['先计时口算一页', '错题抄进错题本', '用凑十法算得更快', '做完自己检查一遍'] },
};
const CAT_ORDER = ['sport', 'recite', 'write', 'math'];

// ---------------- 等级/称号(12 级) ----------------
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
function levelDef(exp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (exp >= l.exp) cur = l;
  return cur;
}
function nextLevel(exp) {
  const cur = levelDef(exp);
  if (cur.lv >= 12) return null;
  return LEVELS[cur.lv];
}

// ---------------- 成就奖章 ----------------
const MEDALS = [
  { id: 'first', name: '初次挑战', desc: '完成第 1 个任务', icon: '🚩', check: (s) => s.totalTasks >= 1 },
  { id: 'streak3', name: '三天连胜', desc: '连续打卡 3 天', icon: '🔥', check: (s) => s.bestStreak >= 3 },
  { id: 'streak7', name: '一周坚持', desc: '连续打卡 7 天', icon: '🎯', check: (s) => s.bestStreak >= 7 },
  { id: 'streak14', name: '半月达人', desc: '连续打卡 14 天', icon: '⚡', check: (s) => s.bestStreak >= 14 },
  { id: 'streak30', name: '月度战神', desc: '连续打卡 30 天', icon: '🏆', check: (s) => s.bestStreak >= 30 },
  { id: 'task50', name: '任务小能手', desc: '累计完成 50 个任务', icon: '💪', check: (s) => s.totalTasks >= 50 },
  { id: 'task100', name: '百炼成钢', desc: '累计完成 100 个任务', icon: '🏅', check: (s) => s.totalTasks >= 100 },
  { id: 'all4', name: '全能四连', desc: '一天完成全部 4 类任务', icon: '🌈', check: (s) => s.bestAllFour >= 1 },
  { id: 'crown', name: '皇冠加冕', desc: '获得第 1 个皇冠', icon: '👑', check: (s) => s.crowns >= 1 },
  { id: 'lv6', name: '等级飞升', desc: '达到 6 级', icon: '🚀', check: (s) => levelDef(s.exp).lv >= 6 },
  { id: 'lv10', name: '大师之路', desc: '达到 10 级', icon: '🌟', check: (s) => levelDef(s.exp).lv >= 10 },
];

// ---------------- 默认道具商城 ----------------
const DEFAULT_SHOP = [
  { id: 'g1', name: '游戏时间 +30 分钟', cost: 80, cur: 'coin', icon: '🎮', note: '完成今日任务后,找爸爸妈妈兑换' },
  { id: 'g2', name: '动画片 +20 分钟', cost: 60, cur: 'coin', icon: '📺', note: '周末专属,记得写完作业再看' },
  { id: 'g3', name: '零花钱 +5 元', cost: 120, cur: 'coin', icon: '💰', note: '存入自己的小钱包' },
  { id: 'g4', name: '周末郊游券', cost: 5, cur: 'diamond', icon: '🏕️', note: '兑换一次周末亲子出游' },
];

// ---------------- 示例计划(均衡模板) ----------------
const TEMPLATE_PLAN = [
  { day: 0, name: '周日', items: [{ id: 'tpl-sun-1', cat: 'sport', title: '户外运动', target: '30' }, { id: 'tpl-sun-2', cat: 'recite', title: '背诵古诗', target: '1' }, { id: 'tpl-sun-3', cat: 'write', title: '书法练习', target: '1' }] },
  { day: 1, name: '周一', items: [{ id: 'tpl-mon-1', cat: 'sport', title: '跳绳训练', target: '20' }, { id: 'tpl-mon-2', cat: 'recite', title: '背诵课文', target: '1' }, { id: 'tpl-mon-3', cat: 'write', title: '生词听写', target: '1' }, { id: 'tpl-mon-4', cat: 'math', title: '口算练习', target: '2' }] },
  { day: 2, name: '周二', items: [{ id: 'tpl-tue-1', cat: 'sport', title: '开合跳', target: '3' }, { id: 'tpl-tue-2', cat: 'recite', title: '背诵英语单词', target: '10' }, { id: 'tpl-tue-3', cat: 'write', title: '默写生字', target: '1' }, { id: 'tpl-tue-4', cat: 'math', title: '竖式计算', target: '1' }] },
  { day: 3, name: '周三', items: [{ id: 'tpl-wed-1', cat: 'sport', title: '广播体操', target: '1' }, { id: 'tpl-wed-2', cat: 'recite', title: '背诵课文', target: '1' }, { id: 'tpl-wed-3', cat: 'write', title: '英文书写', target: '1' }, { id: 'tpl-wed-4', cat: 'math', title: '口算练习', target: '2' }] },
  { day: 4, name: '周四', items: [{ id: 'tpl-thu-1', cat: 'sport', title: '跑步慢走', target: '15' }, { id: 'tpl-thu-2', cat: 'recite', title: '背诵古诗', target: '1' }, { id: 'tpl-thu-3', cat: 'write', title: '生词听写', target: '1' }, { id: 'tpl-thu-4', cat: 'math', title: '应用题练习', target: '2' }] },
  { day: 5, name: '周五', items: [{ id: 'tpl-fri-1', cat: 'sport', title: '跳绳训练', target: '20' }, { id: 'tpl-fri-2', cat: 'recite', title: '背诵英语单词', target: '10' }, { id: 'tpl-fri-3', cat: 'write', title: '书法练习', target: '1' }, { id: 'tpl-fri-4', cat: 'math', title: '口算练习', target: '2' }] },
  { day: 6, name: '周六', items: [{ id: 'tpl-sat-1', cat: 'sport', title: '户外运动', target: '40' }, { id: 'tpl-sat-2', cat: 'recite', title: '背诵课文', target: '1' }, { id: 'tpl-sat-3', cat: 'write', title: '周记书写', target: '1' }] },
];

// ---------------- 头像(内置 8 个 SVG 头像,高等级解锁) ----------------
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
  const p = (v) => `${Math.round(v)}`;
  return `<svg viewBox="0 0 60 60" width="52" height="52" aria-hidden="true">
    <circle cx="30" cy="30" r="29" fill="${H.bg}"/>
    ${H.crown ? `<path d="M16 14l4 5 4-6 6 7 4-6 4 5 4-2-2 10H14L14 12z" fill="#f59e0b" stroke="#b45309" stroke-width="1"/><path d="M26 11l2 3 2-3z" fill="#7c3aed"/>` : ''}
    ${H.sparkle ? `<path d="M8 18l1.6 3.4L13 23l-3.4 1.6L8 28l-1.6-3.4L3 23l3.4-1.6zM48 10l1.2 2.6L52 14l-2.8 1.4L48 18l-1.2-2.6L44 14l2.8-1.4z" fill="#fff"/>` : ''}
    <path d="M16 26q0-12 14-12t14 12v2q0 8-7 9v4a7 7 0 0 1-14 0v-4q-7-1-7-9z" fill="${H.hair}"/>
    <circle cx="30" cy="31" r="13.5" fill="${H.skin}"/>
    ${H.glasses ? `<rect x="18" y="24" width="9" height="7" rx="2.5" fill="none" stroke="#1f2937" stroke-width="1.6"/><rect x="33" y="24" width="9" height="7" rx="2.5" fill="none" stroke="#1f2937" stroke-width="1.6"/><path d="M27 27h6" stroke="#1f2937" stroke-width="1.6"/>` : ''}
    ${!H.glasses ? H.eye.replace(/q/g, `q`) : ''}
    ${H.wink ? `<path d="M22 27q2 2 4 0" stroke="#1f2937" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="36" cy="28" r="1.9" fill="#1f2937"/>` : ''}
    ${H.sparkle && !H.glasses ? `<path d="M20 25l2.2 2.2M27 25l-2.2 2.2M33 25l2.2 2.2M40 25l-2.2 2.2" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round"/>` : ''}
    ${H.brow ? `<path d="M20 23q3-2 6 0M34 23q3-2 6 0" stroke="#1f2937" stroke-width="1.8" fill="none" stroke-linecap="round"/>` : ''}
    <circle cx="24.5" cy="28.5" r="1.7" fill="#fda4af"/><circle cx="35.5" cy="28.5" r="1.7" fill="#fda4af"/>
    ${H.tongue ? `<path d="M27 34q0 4 3 4t3-4z" fill="#fb7185"/>` : ''}
    <path d="${H.mouth}" stroke="#b45309" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// ---------------- 数字人形象(随等级进化,手绘 SVG) ----------------
function heroSvg(exp) {
  const lv = levelDef(exp).lv;
  const hairColors = ['#8b5a2b', '#6d4a2f', '#1f2937', '#1f2937', '#312e81', '#4c1d95', '#7c2d12', '#9f1239', '#b45309', '#92400e', '#713f12', '#5b21b6'];
  const shirtColors = ['#84cc16', '#22c55e', '#3b82f6', '#06b6d4', '#6366f1', '#8b5cf6', '#ef4444', '#f43f5e', '#f59e0b', '#f97316', '#fbbf24', '#facc15'];
  const hair = hairColors[lv - 1], shirt = shirtColors[lv - 1];
  const pant = '#475569';
  const cape = lv >= 9 ? '#f97316' : (lv >= 5 ? '#8b5cf6' : null);
  const hasHat = lv >= 3 && lv < 5;
  const hasGlasses = lv >= 5;
  const hasCrown = lv >= 7;
  const bigCrown = lv >= 11;
  const halo = lv >= 10;
  const stars = lv >= 9;
  const sparkles = lv >= 10;
  const bgGrad = lv <= 8 ? 'url(#hg1)' : 'url(#hg2)';
  const mouth = lv >= 9 ? 'M62 96q8 9 16 0' : (lv >= 3 ? 'M62 94q8 8 16 0' : 'M64 95q6 5 12 0');
  const eyeY = lv >= 9 ? 'M57 86h8M75 86h8' : 'M57 88h8M75 88h8';
  const brow = lv >= 7 ? '<path d="M55 82q5-3 10 0M75 82q5-3 10 0" stroke="#1f2937" stroke-width="2.6" fill="none" stroke-linecap="round"/>' : '';
  return `<svg viewBox="0 0 140 170" width="104" height="126" aria-hidden="true" style="display:block">
    <defs>
      <radialGradient id="hg1" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#dbeafe"/><stop offset="100%" stop-color="#eef2ff"/></radialGradient>
      <radialGradient id="hg2" cx="50%" cy="35%" r="75%"><stop offset="0%" stop-color="#fef3c7"/><stop offset="100%" stop-color="#fff7ed"/></radialGradient>
    </defs>
    ${stars ? Array.from({ length: 5 }).map((_, i) => {
      const x = 12 + i * 26 + (i % 2) * 8, y = 14 + (i % 3) * 8;
      return `<path d="M${x} ${y}l2 4 4.4.6-3.2 3.1.8 4.4-4-2-4 2 .8-4.4L${x - 2} ${y + 4.6}l4.4-.6z" fill="#fbbf24" opacity=".9"/>`;
    }).join('') : ''}
    ${sparkles ? `<path d="M16 130l1.8 3.8 3.8 1.8-3.8 1.8-1.8 3.8-1.8-3.8-3.8-1.8 3.8-1.8zM122 40l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4z" fill="#fff" opacity=".95"/>` : ''}
    ${halo ? `<ellipse cx="70" cy="20" rx="26" ry="7" fill="none" stroke="#fbbf24" stroke-width="4" opacity=".9"/><ellipse cx="70" cy="20" rx="18" ry="4.5" fill="none" stroke="#f59e0b" stroke-width="2.5" opacity=".8"/>` : ''}
    <circle cx="70" cy="88" r="64" fill="${bgGrad}"/>
    ${bigCrown ? `<path d="M30 20l8 10 7-12 8 14 7-12 7 10 7-8-4 20H26L26 12z" fill="#fbbf24" stroke="#b45309" stroke-width="2"/><circle cx="44" cy="18" r="3" fill="#ec4899"/><circle cx="70" cy="16" r="3.4" fill="#22d3ee"/><circle cx="96" cy="18" r="3" fill="#a3e635"/>` :
      (hasCrown ? `<path d="M40 32l6 7 5-9 6 10 5-9 6 8 5-5-3 14H37L34 24z" fill="#fbbf24" stroke="#b45309" stroke-width="1.6"/><circle cx="52" cy="30" r="2.2" fill="#ec4899"/><circle cx="68" cy="28" r="2.4" fill="#22d3ee"/>` : '')}
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
    <rect x="36" y="80" width="10" height="26" rx="5" fill="${shirt}"/>
    <rect x="94" y="80" width="10" height="26" rx="5" fill="${shirt}"/>
    <circle cx="41" cy="108" r="5" fill="#ffd9b3"/><circle cx="99" cy="108" r="5" fill="#ffd9b3"/>
    <rect x="52" y="108" width="14" height="24" rx="6" fill="${pant}"/>
    <rect x="74" y="108" width="14" height="24" rx="6" fill="${pant}"/>
    <ellipse cx="59" cy="134" rx="11" ry="6.5" fill="#3b4252"/><ellipse cx="81" cy="134" rx="11" ry="6.5" fill="#3b4252"/>
  </svg>`;
}

// ---------------- 通用 SVG 小件 ----------------
function coinSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="12" r="10.5" fill="#fbbf24" stroke="#d97706" stroke-width="1.4"/><circle cx="12" cy="12" r="7" fill="#f59e0b"/><path d="M12 7.5l1.3 2.9 3.2.3-2.4 2.1.7 3.1L12 14.3l-2.8 1.6.7-3.1-2.4-2.1 3.2-.3z" fill="#fff7ed"/></svg>`; }
function diamondSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M7 4h10l4 5-9 11L3 9z" fill="#22d3ee" stroke="#0891b2" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 9h18M12 4l-3 5 3 11 3-11z" fill="#a5f3fc" opacity=".55"/></svg>`; }
function crownSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M3 8l4 4 5-6 5 6 4-4-2 10H5z" fill="#fbbf24" stroke="#d97706" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="6.5" r="1.6" fill="#ec4899"/><circle cx="16" cy="6.5" r="1.6" fill="#22d3ee"/></svg>`; }
function medalSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="14" r="7" fill="#fb923c" stroke="#ea580c" stroke-width="1.3"/><circle cx="12" cy="14" r="4.5" fill="#fff7ed"/><path d="M9 3l3 5 3-5-2 8h-2z" fill="#fbbf24" stroke="#d97706" stroke-width="1"/><path d="M8.5 2l2 4-1.5 1.5L6 5.5zM15.5 2l-2 4 1.5 1.5 3.5-2z" fill="#f59e0b"/></svg>`; }
function starSvg(s = 16, fill = '#fbbf24') { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z" fill="${fill}" stroke="#d97706" stroke-width="0.8" stroke-linejoin="round"/></svg>`; }
function expSvg(s = 16) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M13 2L4.5 13.5h5L8 22l8.5-11.5h-5L13 2z" fill="#a78bfa" stroke="#7c3aed" stroke-width="1" stroke-linejoin="round"/></svg>`; }
function lockSvg(s = 14) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="var(--ktext3)"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="var(--ktext3)" stroke-width="2.4"/></svg>`; }
// 火箭(线条绘制分隔风格):三角形头+矩形身+分隔线+圆窗+左右翼+火焰尾。currentColor 让按钮 color 控制描边。
function rocketSvg(s = 16) {
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 L16 8 H8 Z"/><path d="M8 8 H16 V18 H8 Z"/><line x1="8" y1="12" x2="16" y2="12"/><circle cx="12" cy="14" r="1.4"/><path d="M8 14 L5 18 V21 H8 Z"/><path d="M16 14 L19 18 V21 H16 Z"/><path d="M10 19 L9 22 M12 19 L12 23 M14 19 L15 22" stroke-width="1.4"/></svg>`;
}

function catIco(cat) {
  const c = CATS[cat] || CATS.math;
  // 白色线条 → 分类深色变体(浅色分类底上高对比)
  const icon = c.icon.split('#fff').join(c.deep || '#3a4056');
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${icon}</svg>`;
}

// ---------------- 工具函数 ----------------
let _uid = 0;
function uid(prefix) { _uid = (_uid + 1) % 100000; return `${prefix}${Date.now().toString(36)}${_uid.toString(36)}`; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return dateStr(new Date()); }
function ystr() { const d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); }
function fmtCn(tsOrStr) {
  const d = typeof tsOrStr === 'number' ? new Date(tsOrStr) : new Date(String(tsOrStr).replace(/-/g, '/'));
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd}`;
}
function daysAgo(dateStrKey) {
  const d = new Date(String(dateStrKey).replace(/-/g, '/'));
  const today = new Date(todayStr().replace(/-/g, '/'));
  return Math.round((today - d) / 86400000);
}
function weekKeyOf(d) {
  const date = d || new Date();
  const onejan = new Date(date.getFullYear(), 0, 1);
  return `${date.getFullYear()}-W${Math.ceil((((date - onejan) / 86400000) + onejan.getDay() + 1) / 7)}`;
}

// ---------------- 状态管理 ----------------
const LS_KEY = 'wb_kid_state_v1';
let S = null;
let activeTab = 'today';
let rootEl = null;

function emptyState() {
  return {
    v: 1,
    name: '小勇士',
    avatarId: 'a1',
    themeMode: 'project',   // project(跟随项目) | light(儿童亮色) | dark(深色)
    parentMode: false,
    parentPwd: '',
    rewardMult: 1,          // 金币/经验倍数 1 | 1.5 | 2
    coins: 0, diamonds: 0, crowns: 0, exp: 0,
    totalTasks: 0,
    streak: 0, bestStreak: 0, lastDoneDate: '', lastStreakDia: 0,
    bestAllFour: 0, lastAllFourDate: '',
    lastWeeklyCrown: '',
    medals: {},
    tasks: [],
    plan: { enabled: true, weekly: JSON.parse(JSON.stringify(TEMPLATE_PLAN)) },
    shop: JSON.parse(JSON.stringify(DEFAULT_SHOP)),
    claimLog: [],
    lastEnterDate: '',
    sampleLoaded: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      // 结构合并(向后兼容)
      const base = emptyState();
      S = Object.assign(base, d);
      if (!Array.isArray(S.plan.weekly) || S.plan.weekly.length !== 7) S.plan.weekly = JSON.parse(JSON.stringify(TEMPLATE_PLAN));
      if (!Array.isArray(S.shop)) S.shop = JSON.parse(JSON.stringify(DEFAULT_SHOP));
      if (!S.medals) S.medals = {};
      if (!S.claimLog) S.claimLog = [];
      return;
    }
  } catch (e) { /* 数据损坏则重置 */ }
  S = emptyState();
  seedSample();
}

function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ } }

// ---------------- 示例数据(首次进入,含 1 条逾期) ----------------
// 只预置 1 条「昨天未完成」的逾期示例(自动顺延到今天,演示今天要处理);
// 今天的计划任务由 rollover() 按学习计划模板自动生成,避免示例与计划重复。
function seedSample() {
  const t = todayStr();
  S.sampleLoaded = true;
  S.coins = 90; S.exp = 20;
  S.tasks = [
    { id: uid('tk'), date: ystr(), cat: 'write', title: '生词听写', target: '1', unit: CATS.write.unit, done: false, started: false, stars: 0, carryover: 1, planItemId: null, doneAt: 0, rewarded: false },
  ];
  persist();
}

// ---------------- 每日滚动(昨天没做完的自动滚到今天) ----------------
function rollover() {
  const today = todayStr();
  if (S.lastEnterDate === today) return;
  // 未完成且日期早于今天的 → 自动顺延到今天(昨天没做完的自动滚到今天,不凭空消失)
  for (const t of S.tasks) {
    if (t.date < today && !t.done) {
      t.date = today;
      t.carryover = (t.carryover || 0) + 1;
      t.started = false;
    }
  }
  // 按计划补齐今日任务
  const day = new Date().getDay();
  if (S.plan.enabled) {
    const items = (S.plan.weekly[day] && S.plan.weekly[day].items) || [];
    for (const it of items) {
      if (!S.tasks.some((t) => t.date === today && t.planItemId === it.id)) {
        S.tasks.push({ id: uid('tk'), date: today, cat: it.cat, title: it.title || CATS[it.cat].name, target: String(it.target != null ? it.target : 1), unit: CATS[it.cat].unit, done: false, started: false, stars: 0, carryover: 0, planItemId: it.id, doneAt: 0, rewarded: false });
      }
    }
  }
  S.lastEnterDate = today;
  persist();
}

function tasksToday() { return S.tasks.filter((t) => t.date === todayStr()); }

// ---------------- 奖励计算 ----------------
function taskBase(rev, mult) { return Math.round(rev * mult * 2) / 2; }
function rewardFor(stars) {
  const mult = S.rewardMult || 1;
  return { coins: taskBase(10, mult) + stars * taskBase(5, mult), exp: taskBase(10, mult) + stars * taskBase(5, mult) };
}

function grantReward(task, stars) {
  const r = rewardFor(stars);
  S.coins += r.coins;
  S.exp += r.exp;
  S.totalTasks += 1;
  task.done = true;
  task.stars = stars;
  task.doneAt = Date.now();
  task.rewarded = true;
  // 连胜
  const today = todayStr();
  if (S.lastDoneDate === today) { /* 今天已打过卡,连胜不变 */ }
  else if (S.lastDoneDate === ystr()) S.streak += 1;
  else S.streak = 1;
  S.lastDoneDate = today;
  if (S.streak > S.bestStreak) S.bestStreak = S.streak;
  // 连胜里程碑钻石(3/7/14/30 当天一次性)
  if ([3, 7, 14, 30].includes(S.streak) && S.lastStreakDia !== S.streak) {
    S.lastStreakDia = S.streak;
    S.diamonds += 5;
    toast(`连续打卡 ${S.streak} 天!+${5} 钻石 💎`, 'ok');
  }
  // 全能四连:当天 4 类任务全部完成
  if (S.lastAllFourDate !== today) {
    const doneCats = new Set(tasksToday().filter((t) => t.done).map((t) => t.cat));
    if (CAT_ORDER.every((c) => doneCats.has(c))) {
      S.bestAllFour += 1;
      S.lastAllFourDate = today;
    }
  }
  // 周皇冠:本周计划任务全部完成
  const wk = weekKeyOf();
  if (S.lastWeeklyCrown !== wk && S.plan.enabled) {
    const weekTasks = S.tasks.filter((t) => {
      const d = new Date(String(t.date).replace(/-/g, '/'));
      return weekKeyOf(d) === wk;
    });
    const planItems = S.plan.weekly.map((d) => d.items).flat().map((i) => i.id);
    const relevant = weekTasks.filter((t) => t.planItemId && planItems.includes(t.planItemId));
    if (relevant.length && relevant.every((t) => t.done)) {
      S.lastWeeklyCrown = wk;
      S.crowns += 1;
      toast('本周计划全部完成!+1 皇冠 👑', 'ok');
    }
  }
  checkMedals();
  persist();
}

function checkMedals() {
  for (const m of MEDALS) {
    if (!S.medals[m.id] && m.check(S)) {
      S.medals[m.id] = { got: true, at: Date.now() };
      toast(`解锁奖章「${m.name}」🏅`, 'ok');
    }
  }
  persist();
}

function undoTask(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t || !t.done) return;
  const r = rewardFor(t.stars || 3);
  S.coins = Math.max(0, S.coins - r.coins);
  S.exp = Math.max(0, S.exp - r.exp);
  S.totalTasks = Math.max(0, S.totalTasks - 1);
  t.done = false; t.stars = 0; t.doneAt = 0; t.started = false; t.rewarded = false;
  checkMedals();
  persist();
  render();
}

// ---------------- 渲染入口 ----------------
export function renderKidWorkspaceTool(container) {
  if (!container) return;
  ensureKidStyle();
  loadState();
  rollover();
  activeTab = 'today';
  container.innerHTML = '';
  rootEl = document.createElement('div');
  rootEl.className = 'kid-wb theme-' + (S.themeMode || 'project');
  container.appendChild(rootEl);
  render();
}

function render() {
  if (!rootEl) return;
  rootEl.className = 'kid-wb theme-' + (S.themeMode || 'project');
  rootEl.innerHTML = '';
  rootEl.appendChild(renderTopbar());
  rootEl.appendChild(renderToday());
  rootEl.appendChild(renderTabs());
  const content = document.createElement('div');
  content.className = 'kid-content';
  if (activeTab === 'today') content.appendChild(renderTodayTab());
  else if (activeTab === 'plan') content.appendChild(renderPlanTab());
  else content.appendChild(renderRewardTab());
  rootEl.appendChild(content);
}

// ---------------- 顶栏 ----------------
function renderTopbar() {
  const bar = document.createElement('div');
  bar.className = 'kid-topbar';
  const lv = levelDef(S.exp);
  bar.innerHTML = `
    <div class="kid-brand">
      <div class="kid-logo">${starSvg(24, '#fff')}</div>
      <div class="kid-title">得乐学苑<small>${esc(S.name)} · ${lv.title}</small></div>
    </div>
    <span class="kid-lv-pill" style="background:${lv.color}" title="当前等级:${esc(lv.title)}">★ Lv.${lv.lv}</span>
    <span class="kid-date">📅 ${fmtCn(Date.now())}</span>
    <div class="kid-top-actions">
      <button class="kid-btn sm" data-act="export" title="导出 JSON 备份">⬇ 导出</button>
      <button class="kid-btn sm" data-act="import" title="从 JSON 恢复">⬆ 导入</button>
      <button class="kid-btn sm ${S.parentMode ? 'gold' : ''}" data-act="parent" title="家长模式(编辑计划/管理道具/撤销)">${S.parentMode ? '👨‍👩‍👦 家长' : '🔒 家长'}</button>
      <button class="kid-btn sm" data-act="settings" title="设置">⚙ 设置</button>
    </div>`;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'export') exportData();
    else if (act === 'import') importData();
    else if (act === 'parent') enterParentGate();
    else if (act === 'settings') openSettings();
  });
  return bar;
}

// ---------------- 「今天要处理」置顶区 ----------------
function renderToday() {
  const sec = document.createElement('div');
  sec.className = 'kid-today';
  const today = tasksToday();
  const pending = today.filter((t) => !t.done);
  const overdue = pending.filter((t) => (t.carryover || 0) > 0);
  const doneCount = today.length - pending.length;
  const done = doneCount === today.length && today.length > 0;

  let itemsHtml = '';
  if (!today.length) {
    itemsHtml = `<div class="kid-today-empty">今天还没有安排任务,去「学习计划」给今天加几关吧 🎯</div>`;
  } else {
    for (const t of today) {
      const c = CATS[t.cat] || CATS.math;
      const isOv = !t.done && (t.carryover || 0) > 0;
      itemsHtml += `
        <div class="kid-today-item${isOv ? ' overdue' : ''}" data-today="${t.id}">
          <div class="k-ti-ico" style="background:${c.bg}">${catIco(t.cat)}</div>
          <div class="k-ti-main">
            <div class="k-ti-title">${isOv ? '⚠ ' : ''}${esc(t.title)}</div>
            <div class="k-ti-sub">${c.name} · ${esc(t.target)}${esc(t.unit)}${t.done ? ' · 已挑战 ✅' : ''}</div>
          </div>
          ${isOv ? `<span class="k-ti-tag">逾期 ${t.carryover} 天</span>` : ''}
          ${!t.done ? `<button class="kid-btn sm" data-go="${t.id}">去完成 →</button>` : `<span style="font-size:18px">✅</span>`}
        </div>`;
    }
  }
  const lv = levelDef(S.exp);
  const pct = today.length ? Math.round((doneCount / today.length) * 100) : 0;
  const R = 17, CIRC = 2 * Math.PI * R;
  sec.innerHTML = `
    <div class="kid-today-head">
      <span class="kid-today-title">🎯 今天要处理</span>
      <span class="kid-today-sub">${done ? '全部挑战完成,今天也超棒!' : `已完成 ${doneCount}/${today.length}`}${S.streak > 1 ? ` · 已连续打卡 ${S.streak} 天 🔥` : ''}</span>
      <span class="kid-progress" title="今日完成率 ${pct}%">
        <svg viewBox="0 0 44 44" width="40" height="40" aria-hidden="true">
          <circle cx="22" cy="22" r="${R}" fill="none" stroke="var(--kring-bg)" stroke-width="5"/>
          <circle cx="22" cy="22" r="${R}" fill="none" stroke="var(--kaccent)" stroke-width="5" stroke-linecap="round"
            stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 22 22)"/>
        </svg>
        <span class="kid-progress-txt">${pct}%</span>
      </span>
      ${lv.lv < 12 ? `<button class="kid-btn sm challenge" data-act="go-today" title="去完成今天的任务" style="margin-left:auto"></button>` : ''}
    </div>
    <div class="kid-today-list">${itemsHtml}</div>
    ${S.totalTasks >= 30 ? `<div class="kid-today-banner">📌 <span>已累计完成 <b>${S.totalTasks}</b> 个任务,建议在顶部点「⬇ 导出」做一次数据备份</span></div>` : ''}`;
  sec.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    const gt = e.target.closest('[data-act="go-today"]');
    if (go) { switchTab('today'); scrollToTask(go.dataset.go); }
    else if (gt) { switchTab('today'); scrollToTask(today.find((t) => !t.done)?.id); }
  });
  return sec;
}

function scrollToTask(id) {
  if (!id) return;
  setTimeout(() => {
    const card = rootEl.querySelector(`[data-task-id="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('kid-hl'); setTimeout(() => card.classList.remove('kid-hl'), 2200); }
  }, 60);
}

// ---------------- Tab ----------------
function renderTabs() {
  const tabs = document.createElement('div');
  tabs.className = 'kid-tabs';
  const items = [
    { id: 'today', label: '今日挑战', dot: '🚀' },
    { id: 'plan', label: '学习计划', dot: '🗓️' },
    { id: 'reward', label: '成长奖励', dot: '👑' },
  ];
  tabs.innerHTML = items.map((it) => `<button class="kid-tab${activeTab === it.id ? ' on' : ''}" data-tab="${it.id}"><span class="kid-tab-dot">${it.dot}</span>${it.label}</button>`).join('');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  return tabs;
}
function switchTab(tab) { activeTab = tab; render(); }

// ---------------- 今日挑战 Tab ----------------
function renderTodayTab() {
  const wrap = document.createElement('div');
  const today = tasksToday();
  const sec = document.createElement('div');
  sec.className = 'kid-sec-head';
  sec.innerHTML = `<span class="kid-sec-title">⚔️ 今日任务(${today.filter((t) => t.done).length}/${today.length})</span>
    <span class="kid-sec-sub">完成后请家长验收打星,获得金币和经验</span>`;
  wrap.appendChild(sec);

  const grid = document.createElement('div');
  grid.className = 'kid-grid';
  if (!today.length || !today.some((t) => !t.done)) {
    grid.innerHTML = `<div class="kid-today-empty" style="grid-column:1/-1">${!today.length ? '今天没有任务。' + (S.plan.enabled ? '去「学习计划」给今天安排任务,或' : '') + '点下方按钮添加一个自定义任务吧!' : '今天的任务全部挑战完成,太棒了!🏆'}</div>`;
  }
  for (const t of today) { if (!t.done) grid.appendChild(renderTaskCard(t)); }
  wrap.appendChild(grid);

  const add = document.createElement('button');
  add.className = 'kid-addtask';
  add.innerHTML = `＋ 添加自定义任务`;
  add.addEventListener('click', () => openTaskModal());
  wrap.appendChild(add);

  // 已完成的今日任务(在下方汇总区展示奖励与撤销)
  const doneTasks = today.filter((t) => t.done);
  if (doneTasks.length) {
    const doneSec = document.createElement('div');
    doneSec.style.marginTop = '16px';
    doneSec.innerHTML = `<div class="kid-sec-head"><span class="kid-sec-title">🏆 今日已挑战</span></div>`;
    const dgrid = document.createElement('div');
    dgrid.className = 'kid-grid';
    for (const t of doneTasks) dgrid.appendChild(renderTaskCard(t));
    doneSec.appendChild(dgrid);
    wrap.appendChild(doneSec);
  }
  return wrap;
}

function renderTaskCard(t) {
  const c = CATS[t.cat] || CATS.math;
  const card = document.createElement('div');
  const carry = (t.carryover || 0) > 0 && !t.done;
  card.className = `kid-task${t.done ? ' done' : t.started ? ' started' : ''}${carry ? ' carry' : ''}`;
  card.setAttribute('data-task-id', t.id);
  const starsHtml = t.done
    ? `<div class="k-task-stars">${[1, 2, 3].map((i) => starSvg(16, i <= t.stars ? '#fbbf24' : '#e5e7f0')).join('')}</div>`
    : '';
  const badge = t.done ? `<span class="k-badge done">✅ 已完成</span>`
    : carry ? `<span class="k-badge carry">⚠ 昨日未完成</span>`
    : t.started ? `<span class="k-badge doing">⏳ 挑战中</span>` : '';
  const rewardHtml = t.done && t.rewarded
    ? (() => { const r = rewardFor(t.stars || 3); return `<div class="k-task-reward"><span class="k-reward-chip c">${coinSvg(14)} +${r.coins} 金币</span><span class="k-reward-chip e">${expSvg(14)} +${r.exp} 经验</span><span class="k-reward-chip">⭐ ${t.stars} 星</span></div>`; })()
    : t.done ? `<div class="k-task-reward"><span class="k-reward-chip">${starsHtml}</span></div>` : '';

  let actions = '';
  if (!t.done) {
    actions = t.started
      ? `<div class="k-task-actions"><button class="kid-btn green" data-act="finish" data-id="${t.id}">${rocketSvg(14)} 挑战成功!</button><button class="kid-btn" data-act="reset" data-id="${t.id}">↺ 重来</button></div>`
      : `<div class="k-task-actions"><button class="kid-btn challenge" data-act="start" data-id="${t.id}"></button>${S.parentMode ? `<button class="kid-btn" data-act="del" data-id="${t.id}">✕ 移除</button>` : ''}</div>`;
  } else if (S.parentMode) {
    actions = `<div class="k-task-actions"><button class="kid-btn" data-act="undo" data-id="${t.id}" title="撤销完成并退回奖励(家长)">↺ 撤销(家长)</button></div>`;
  }

  const tip = c.tips[Math.abs(t.title.length + t.cat.length) % c.tips.length];
  card.innerHTML = `
    <div class="k-task-head">
      <div class="k-task-ico" style="background:${c.bg}">${catIco(t.cat)}</div>
      <div class="k-task-titles">
        <div class="k-task-name">${esc(t.title)}</div>
        <div class="k-task-cat">${c.name}</div>
      </div>
      <div class="k-task-badges">${badge}</div>
    </div>
    <div class="k-task-target">目标:<span class="k-unit-chip">${esc(t.target)} ${esc(t.unit)}</span>${t.done ? `<span style="font-size:11px;color:var(--ktext3)">${fmtCn(t.doneAt)}</span>` : ''}</div>
    ${t.done ? rewardHtml : ''}
    ${actions}
    <div class="k-task-tips">💡 ${esc(tip)}</div>
    <div class="k-task-foot">${carry ? `从昨天自动顺延到今天,坚持就是胜利!` : t.started ? '集中注意力,一鼓作气挑战到底!' : '点击「开启挑战」开始挑战'}</div>`;

  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'start') { const tt = S.tasks.find((x) => x.id === id); if (tt) { tt.started = true; persist(); render(); } }
    else if (act === 'finish') openStarModal(id);
    else if (act === 'reset') { const tt = S.tasks.find((x) => x.id === id); if (tt) { tt.started = false; persist(); render(); } }
    else if (act === 'del') { confirmDialog({ title: '移除任务', message: '确定移除这个任务吗?', okText: '移除', danger: true, onOk: () => { S.tasks = S.tasks.filter((x) => x.id !== id); persist(); render(); } }); }
    else if (act === 'undo') { confirmDialog({ title: '撤销完成', message: '将退回该任务的金币与经验,确认撤销?', okText: '确认撤销', danger: true, onOk: () => undoTask(id) }); }
  });
  return card;
}

// ---------------- 星级验收弹窗 ----------------
function openStarModal(taskId) {
  const t = S.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const c = CATS[t.cat] || CATS.math;
  const r3 = rewardFor(3), r2 = rewardFor(2), r1 = rewardFor(1);
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  let stars = 3;
  box.innerHTML = `
    <div class="kid-modal-head">
      <div class="kid-modal-title">🎉 挑战成功!</div>
      <button class="kid-modal-x" data-close>✕</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;background:${c.bg};border-radius:12px;padding:10px 12px;margin-bottom:12px">
      <div class="k-task-ico" style="background:${c.bg}">${catIco(t.cat)}</div>
      <div style="font-weight:800;font-size:15px">${esc(t.title)}<div style="font-size:12px;color:var(--ktext2);font-weight:600">${c.name} · ${esc(t.target)} ${esc(t.unit)}</div></div>
    </div>
    <div class="kid-label" style="text-align:center">请家长验收,给这次挑战打星 ⭐</div>
    <div class="kid-stars-pick">
      ${[1, 2, 3].map((i) => `<button class="kid-star-btn${i === stars ? ' on' : ''}" data-star="${i}">${starSvg(34, '#fbbf24')}</button>`).join('')}
    </div>
    <div id="kid-star-preview" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"></div>
    <div class="kid-modal-actions">
      <button class="kid-btn" data-close>稍后</button>
      <button class="kid-btn gold" data-confirm>确认领取 🎁</button>
    </div>`;
  function preview() {
    const r = stars === 1 ? r1 : stars === 2 ? r2 : r3;
    box.querySelector('#kid-star-preview').innerHTML = `
      <span class="k-reward-chip c">${coinSvg(14)} +${r.coins} 金币</span>
      <span class="k-reward-chip e">${expSvg(14)} +${r.exp} 经验</span>`;
  }
  preview();
  box.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => {
    stars = Number(b.dataset.star);
    box.querySelectorAll('[data-star]').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) === stars));
    preview();
  }));
  const close = () => { ov.remove(); };
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelector('[data-confirm]').addEventListener('click', () => {
    grantReward(t, stars);
    close();
    confetti();
    render();
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// 简单撒花效果(SVG 彩片,不引库)
function confetti() {
  const host = document.createElement('div');
  host.className = 'kid-overlay';
  host.style.background = 'transparent';
  host.style.pointerEvents = 'none';
  const colors = ['#4f7cff', '#f59e0b', '#22c55e', '#ec4899', '#8b5cf6', '#22d3ee'];
  let html = '';
  for (let i = 0; i < 26; i++) {
    const x = 10 + Math.random() * 80;
    const y = -10 - Math.random() * 20;
    const size = 6 + Math.random() * 8;
    const color = colors[i % colors.length];
    const dur = 1.2 + Math.random() * 1.2;
    const delay = Math.random() * 0.3;
    html += `<svg width="${size}" height="${size}" style="position:absolute;left:${x}%;top:${y}%;animation:kidFall ${dur}s ${delay}s ease-in forwards;opacity:0"><rect x="0" y="0" width="${size}" height="${size}" rx="2" fill="${color}" transform="rotate(${Math.random() * 180} ${size / 2} ${size / 2})"/></svg>`;
  }
  const st = document.createElement('style');
  st.textContent = `@keyframes kidFall{0%{opacity:1;transform:translateY(0) rotate(0)}100%{opacity:0;transform:translateY(${window.innerHeight * 0.7}px) rotate(540deg)}}`;
  host.appendChild(st);
  host.innerHTML += html;
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3000);
}

// ---------------- 自定义任务弹窗 ----------------
function openTaskModal() {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  box.innerHTML = `
    <div class="kid-modal-head"><div class="kid-modal-title">＋ 添加今日任务</div><button class="kid-modal-x" data-close>✕</button></div>
    <div class="kid-field"><label class="kid-label">任务类型</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px" data-cats>
        ${CAT_ORDER.map((c) => { const cc = CATS[c]; return `<button class="kid-btn" data-cat="${c}" style="justify-content:flex-start;border-color:${cc.color}44;background:${cc.bg};color:#3a4056"><span style="width:20px;height:20px;border-radius:6px;background:${cc.color};display:flex;align-items:center;justify-content:center">${catIco(c)}</span>${cc.name}</button>`; }).join('')}
      </div></div>
    <div class="kid-field"><label class="kid-label">任务名称</label><input type="text" data-in="title" placeholder="例如:跳绳 200 个" maxlength="30"></div>
    <div class="kid-field"><label class="kid-label">目标数量</label><input type="number" data-in="target" min="1" max="999" value="1"></div>
    <div class="kid-modal-actions"><button class="kid-btn" data-close>取消</button><button class="kid-btn primary" data-save>添加任务</button></div>`;
  let cat = 'sport';
  box.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    box.querySelectorAll('[data-cat]').forEach((x) => x.style.outline = x === b ? `2px solid ${CATS[cat].color}` : '');
  }));
  box.querySelectorAll('[data-cat]')[0].style.outline = `2px solid ${CATS.sport.color}`;
  const close = () => ov.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelector('[data-save]').addEventListener('click', () => {
    const title = box.querySelector('[data-in="title"]').value.trim();
    const target = box.querySelector('[data-in="target"]').value || '1';
    const cc = CATS[cat];
    S.tasks.push({ id: uid('tk'), date: todayStr(), cat, title: title || cc.name, target: String(target), unit: cc.unit, done: false, started: false, stars: 0, carryover: 0, planItemId: null, doneAt: 0, rewarded: false });
    persist();
    toast('已添加到今日任务 🎯', 'ok');
    close();
    render();
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---------------- 学习计划 Tab ----------------
function renderPlanTab() {
  const wrap = document.createElement('div');
  wrap.className = 'kid-plan-wrap';
  const tools = document.createElement('div');
  tools.className = 'kid-plan-tools';
  tools.innerHTML = `
    <button class="kid-btn primary" data-plan="template">📋 套用均衡模板</button>
    <button class="kid-btn" data-plan="clear">🗑 清空计划</button>
    <label class="kid-plan-enable" style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;margin-left:auto;cursor:pointer">
      <span>计划生成今日任务</span>
      <span class="kid-switch${S.plan.enabled ? ' on' : ''}" data-plan="toggle"></span>
    </label>`;
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plan]');
    if (!b) return;
    const act = b.dataset.plan;
    if (act === 'template') {
      confirmDialog({ title: '套用均衡模板', message: '将用「四科均衡」模板覆盖当前每周计划(不会删除已打卡记录)。', okText: '套用', onOk: () => { S.plan.weekly = JSON.parse(JSON.stringify(TEMPLATE_PLAN)); S.plan.enabled = true; persist(); render(); } });
    } else if (act === 'clear') {
      confirmDialog({ title: '清空计划', message: '清空每周计划后,今日任务将只来自手动添加。确定?', okText: '清空', danger: true, onOk: () => { S.plan.weekly = TEMPLATE_PLAN.map((d) => ({ day: d.day, name: d.name, items: [] })); persist(); render(); } });
    } else if (act === 'toggle') {
      S.plan.enabled = !S.plan.enabled;
      if (S.plan.enabled) { const today = todayStr(); const day = new Date().getDay(); const items = S.plan.weekly[day].items; for (const it of items) { if (!S.tasks.some((t) => t.date === today && t.planItemId === it.id)) { S.tasks.push({ id: uid('tk'), date: today, cat: it.cat, title: it.title || CATS[it.cat].name, target: String(it.target != null ? it.target : 1), unit: CATS[it.cat].unit, done: false, started: false, stars: 0, carryover: 0, planItemId: it.id, doneAt: 0, rewarded: false }); } } }
      persist(); render();
    }
  });
  wrap.appendChild(tools);

  const todayDay = new Date().getDay();
  const days = document.createElement('div');
  days.className = 'kid-plan-days';
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let d = 0; d < 7; d++) {
    const col = document.createElement('div');
    col.className = `kid-plan-day${d === todayDay ? ' today' : ''}`;
    const items = S.plan.weekly[d].items || [];
    // 本周该天计划任务的完成情况
    const wk = weekKeyOf();
    const doneCount = items.filter((it) => S.tasks.some((t) => weekKeyOf(new Date(String(t.date).replace(/-/g, '/'))) === wk && t.planItemId === it.id && t.done)).length;
    col.innerHTML = `
      <div class="kid-plan-day-head">
        <span class="kid-plan-day-name">${weekNames[d]}${d === todayDay ? ' · 今天' : ''}</span>
        ${items.length ? `<span style="font-size:10px;color:var(--ktext3);font-weight:700">${doneCount}/${items.length}</span>` : ''}
      </div>
      ${items.map((it) => { const cc = CATS[it.cat] || CATS.math; return `<div class="kid-plan-item"><span class="k-pi-dot" style="background:${cc.color}"></span><span class="k-pi-text">${esc(it.title)} · ${esc(it.target)}${esc(cc.unit)}</span><button class="k-pi-x" data-del="${d}:${it.id}" title="删除">✕</button></div>`; }).join('') || `<div class="kid-plan-empty">${S.plan.enabled ? '空,点「＋」添加' : '计划已停用'}</div>`}
      <button class="kid-addtask" style="min-height:40px;font-size:12px" data-add="${d}">＋ 添加</button>`;
    days.appendChild(col);
  }
  wrap.appendChild(days);

  const hint = document.createElement('div');
  hint.className = 'kid-today-banner';
  hint.style.marginTop = '4px';
  hint.innerHTML = '💡 每个任务都有固定奖励:完成 +10 金币/经验,星级越高奖励越多;连续打卡 3/7/14/30 天额外送钻石,一周计划全完成送 1 皇冠。';
  wrap.appendChild(hint);

  wrap.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    const add = e.target.closest('[data-add]');
    if (del) {
      const [day, itemId] = del.dataset.del.split(':');
      const arr = S.plan.weekly[Number(day)].items;
      const idx = arr.findIndex((i) => i.id === itemId);
      if (idx >= 0) { arr.splice(idx, 1); persist(); render(); }
    } else if (add) {
      openPlanItemModal(Number(add.dataset.add));
    }
  });
  return wrap;
}

function openPlanItemModal(day) {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  box.innerHTML = `
    <div class="kid-modal-head"><div class="kid-modal-title">${weekNames[day]} · 添加计划任务</div><button class="kid-modal-x" data-close>✕</button></div>
    <div class="kid-field"><label class="kid-label">任务类型</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px" data-cats>
        ${CAT_ORDER.map((c) => { const cc = CATS[c]; return `<button class="kid-btn" data-cat="${c}" style="justify-content:flex-start;border-color:${cc.color}44;background:${cc.bg};color:#3a4056"><span style="width:20px;height:20px;border-radius:6px;background:${cc.color};display:flex;align-items:center;justify-content:center">${catIco(c)}</span>${cc.name}</button>`; }).join('')}
      </div></div>
    <div class="kid-field"><label class="kid-label">任务名称</label><input type="text" data-in="title" placeholder="例如:跳绳训练" maxlength="30"></div>
    <div class="kid-field"><label class="kid-label">目标数量</label><input type="number" data-in="target" min="1" max="999" value="1"></div>
    <div class="kid-modal-actions"><button class="kid-btn" data-close>取消</button><button class="kid-btn primary" data-save>加入计划</button></div>`;
  let cat = 'sport';
  box.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    box.querySelectorAll('[data-cat]').forEach((x) => x.style.outline = x === b ? `2px solid ${CATS[cat].color}` : '');
  }));
  box.querySelectorAll('[data-cat]')[0].style.outline = `2px solid ${CATS.sport.color}`;
  const close = () => ov.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelector('[data-save]').addEventListener('click', () => {
    const title = box.querySelector('[data-in="title"]').value.trim();
    const target = box.querySelector('[data-in="target"]').value || '1';
    const cc = CATS[cat];
    const items = (S.plan.weekly[day].items = S.plan.weekly[day].items || []);
    items.push({ id: uid('tp'), cat, title: title || cc.name, target: String(target) });
    persist();
    toast('已加入计划 🗓️', 'ok');
    close();
    render();
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---------------- 成长奖励 Tab ----------------
function renderRewardTab() {
  const wrap = document.createElement('div');
  const lv = levelDef(S.exp);
  const next = nextLevel(S.exp);
  const progress = next ? Math.min(100, Math.round(((S.exp - lv.exp) / (next.exp - lv.exp)) * 100)) : 100;

  // 钱包
  const wallet = document.createElement('div');
  wallet.className = 'kid-wallet';
  wallet.innerHTML = `
    <div class="kid-wallet-card"><div class="k-w-ico" style="background:#fffbeb">${coinSvg(22)}</div><div><div class="k-w-num">${S.coins}</div><div class="k-w-name">金币</div></div></div>
    <div class="kid-wallet-card"><div class="k-w-ico" style="background:#ecfeff">${diamondSvg(22)}</div><div><div class="k-w-num">${S.diamonds}</div><div class="k-w-name">钻石</div></div></div>
    <div class="kid-wallet-card"><div class="k-w-ico" style="background:#fffbeb">${crownSvg(22)}</div><div><div class="k-w-num">${S.crowns}</div><div class="k-w-name">皇冠</div></div></div>
    <div class="kid-wallet-card"><div class="k-w-ico" style="background:var(--kcard)7ed">${medalSvg(22)}</div><div><div class="k-w-num">${Object.keys(S.medals).length}/${MEDALS.length}</div><div class="k-w-name">奖章</div></div></div>`;
  wrap.appendChild(wallet);

  // 等级 + 数字人
  const row2 = document.createElement('div');
  row2.className = 'kid-row2';
  row2.innerHTML = `
    <div class="kid-card">
      <div class="kid-card-title">🏅 等级称号</div>
      <div class="kid-level-row">
        <div class="kid-hero-box">${heroSvg(S.exp)}</div>
        <div class="kid-level-info">
          <div class="kid-lv-title">${esc(lv.title)}<span class="kid-lv-tag" style="background:${lv.color}">Lv.${lv.lv}</span></div>
          <div class="kid-lv-desc">${esc(lv.desc)}</div>
          <div class="kid-ring-row">
            <span class="kid-ring-label">经验</span>
            <div class="kid-ring-bar"><div class="kid-ring-fill" style="width:${progress}%"></div></div>
            <span class="kid-ring-val">${S.exp}${next ? `/${next.exp}` : '/MAX'}</span>
          </div>
          <div style="font-size:11px;color:var(--ktext3);margin-top:6px">${next ? `再攒 ${next.exp - S.exp} 经验晋级「${next.title}」` : '已达最高等级,你是传奇!🌟'}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--ktext2);margin-top:10px;line-height:1.6">${S.streak > 0 ? `🔥 已连续打卡 <b>${S.streak}</b> 天(历史最长 ${S.bestStreak} 天)` : '今天开始打卡,点亮你的连胜吧!'}${S.totalTasks > 0 ? ` · 累计挑战 <b>${S.totalTasks}</b> 关` : ''}</div>
    </div>
    <div class="kid-card">
      <div class="kid-card-title">😀 我的头像</div>
      <div class="kid-avatars">
        ${['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id) => {
          const def = { a1: '开心', a2: '酷酷', a3: '眨眼', a4: '淘气', a5: '惊讶', a6: '得意', a7: '星星眼', a8: '小王子' }[id];
          const unlock = { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 5, a8: 8 }[id];
          const locked = lv.lv < unlock;
          return `<div class="kid-avatar-item${S.avatarId === id ? ' on' : ''}${locked ? ' locked' : ''}" data-avatar="${id}" data-lv="${unlock}" title="${def}${locked ? ` · Lv.${unlock} 解锁` : ''}">
            ${headSvg(id)}<span class="k-a-name">${locked ? `${lockSvg(11)} Lv.${unlock}` : def}</span></div>`;
        }).join('')}
      </div>
      <div style="font-size:11px;color:var(--ktext3);margin-top:8px">数字人会随等级换装进化:帽子(3级)→ 眼镜披风(5级)→ 皇冠(7级)→ 星光(9级)→ 光环(10级)→ 钻石王冠(11级)</div>
    </div>`;
  wrap.appendChild(row2);

  // 道具商城
  const shop = document.createElement('div');
  shop.className = 'kid-card';
  const shopHead = document.createElement('div');
  shopHead.className = 'kid-card-title';
  shopHead.innerHTML = `🎁 道具商城${S.parentMode ? `<button class="kid-btn sm" data-shop="manage" style="margin-left:auto">＋ 管理道具</button>` : ''}<button class="kid-btn sm" data-shop="log" style="margin-left:8px">兑换记录</button>`;
  shop.appendChild(shopHead);
  const grid = document.createElement('div');
  grid.className = 'kid-shop-grid';
  if (!S.shop.length) grid.innerHTML = `<div class="kid-today-empty" style="grid-column:1/-1">商城空空如也,家长可点击「管理道具」添加奖励</div>`;
  for (const it of S.shop) {
    const isDia = it.cur === 'diamond';
    const item = document.createElement('div');
    item.className = 'kid-shop-item';
    item.innerHTML = `
      <div class="k-s-head"><div class="k-s-ico" style="background:${isDia ? '#ecfeff' : '#fffbeb'}">${it.icon}</div>
        <div><div class="k-s-name">${esc(it.name)}</div><div style="font-size:11px;color:var(--ktext3)">${isDia ? '钻石道具' : '金币道具'}</div></div></div>
      <div class="k-s-note">${esc(it.note)}</div>
      <div class="k-s-foot">
        <span class="k-s-price${isDia ? ' d' : ''}">${isDia ? diamondSvg(15) : coinSvg(15)} ${it.cost}</span>
        <button class="kid-btn sm ${isDia ? 'primary' : 'gold'}" data-claim="${it.id}">兑换</button>
      </div>`;
    grid.appendChild(item);
  }
  shop.appendChild(grid);
  shop.addEventListener('click', (e) => {
    const claim = e.target.closest('[data-claim]');
    const mg = e.target.closest('[data-shop="manage"]');
    const log = e.target.closest('[data-shop="log"]');
    if (claim) claimItem(claim.dataset.claim);
    else if (mg) openShopManageModal();
    else if (log) openClaimLog();
  });
  wrap.appendChild(shop);

  // 奖章墙
  const medalsCard = document.createElement('div');
  medalsCard.className = 'kid-card';
  medalsCard.innerHTML = `<div class="kid-card-title">🏅 奖章墙</div>`;
  const mgrid = document.createElement('div');
  mgrid.className = 'kid-medal-grid';
  for (const m of MEDALS) {
    const got = !!S.medals[m.id];
    const cell = document.createElement('div');
    cell.className = `kid-medal${got ? ' got' : ' locked'}`;
    cell.innerHTML = `
      <div style="font-size:30px;filter:${got ? 'none' : 'grayscale(1)'}">${m.icon}</div>
      <div class="k-m-name">${esc(m.name)}</div>
      <div class="k-m-desc">${esc(m.desc)}</div>
      <div style="font-size:10px;font-weight:700;color:${got ? '#b45309' : '#9aa0b3'}">${got ? '✅ 已获得' : '未解锁'}</div>`;
    mgrid.appendChild(cell);
  }
  medalsCard.appendChild(mgrid);
  wrap.appendChild(medalsCard);

  // 奖励规则说明
  const rule = document.createElement('div');
  rule.className = 'kid-today-banner';
  rule.style.marginTop = '4px';
  rule.innerHTML = '💰 奖励规则:基础完成 +10 金币/经验(家长可在设置调整倍数);星级加成 ⭐×5;金币可兑换道具,钻石由连胜里程碑获得,皇冠由周计划全勤获得。';
  wrap.appendChild(rule);

  wrap.addEventListener('click', (e) => {
    const av = e.target.closest('[data-avatar]');
    if (av) {
      const need = Number(av.dataset.lv);
      if (lv.lv < need) { toast(`达到 Lv.${need} 解锁此头像`, 'warn'); return; }
      S.avatarId = av.dataset.avatar;
      persist();
      render();
    }
  });
  return wrap;
}

// ---------------- 道具兑换 ----------------
function claimItem(id) {
  const it = S.shop.find((x) => x.id === id);
  if (!it) return;
  const isDia = it.cur === 'diamond';
  const balance = isDia ? S.diamonds : S.coins;
  const curName = isDia ? '钻石' : '金币';
  if (balance < it.cost) { toast(`${curName}不够啦,继续挑战赚取吧!`, 'warn'); return; }
  confirmDialog({
    title: '兑换道具', message: `确定用 ${it.cost} ${curName} 兑换「${it.name}」吗?`, okText: '确认兑换',
    onOk: () => {
      if (isDia) S.diamonds -= it.cost; else S.coins -= it.cost;
      S.claimLog.unshift({ name: it.name, cur: it.cur, cost: it.cost, at: Date.now() });
      persist();
      render();
      toast(`兑换成功!向爸爸妈妈出示「${it.name}」🎉`, 'ok');
    },
  });
}

function openClaimLog() {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  box.innerHTML = `
    <div class="kid-modal-head"><div class="kid-modal-title">📜 兑换记录</div><button class="kid-modal-x" data-close>✕</button></div>
    <div style="max-height:52vh;overflow:auto">
      ${S.claimLog.length ? S.claimLog.map((c) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--kborder)"><span style="font-size:18px">🎁</span><div style="flex:1"><div style="font-size:14px;font-weight:700">${esc(c.name)}</div><div style="font-size:11px;color:var(--ktext3)">${fmtCn(c.at)}</div></div><span class="k-s-price${c.cur === 'diamond' ? ' d' : ''}">${c.cur === 'diamond' ? diamondSvg(14) : coinSvg(14)} ${c.cost}</span></div>`).join('') : `<div class="kid-today-empty">还没有兑换记录,去商城看看喜欢的道具吧 🎁</div>`}
    </div>`;
  const close = () => ov.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---------------- 道具管理(家长) ----------------
function openShopManageModal() {
  if (!S.parentMode) { toast('请在家长模式下管理道具', 'warn'); return; }
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  box.style.maxWidth = '480px';
  box.innerHTML = `
    <div class="kid-modal-head"><div class="kid-modal-title">🎁 管理道具</div><button class="kid-modal-x" data-close>✕</button></div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input type="text" data-new-name placeholder="道具名称,如:冰淇淋券" style="flex:1">
      <input type="number" data-new-cost placeholder="价格" style="width:76px" min="1">
      <button class="kid-btn primary" data-new-cur="coin" title="金币道具">金币</button>
      <button class="kid-btn" data-new-cur="diamond" title="钻石道具">钻石</button>
    </div>
    <div style="max-height:46vh;overflow:auto">
      ${S.shop.length ? S.shop.map((it) => {
        const isDia = it.cur === 'diamond';
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--kborder)">
          <span style="font-size:20px">${it.icon}</span>
          <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</div><div style="font-size:11px;color:var(--ktext3)">${isDia ? '💎' : '🪙'} ${it.cost}</div></div>
          <button class="kid-btn sm" data-del-shop="${it.id}">删除</button></div>`;
      }).join('') : '<div class="kid-today-empty">还没有道具</div>'}
    </div>`;
  let newCur = 'coin';
  const close = () => ov.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelector('[data-new-cur="coin"]').addEventListener('click', (e) => { newCur = 'coin'; e.currentTarget.className = 'kid-btn primary'; box.querySelector('[data-new-cur="diamond"]').className = 'kid-btn'; });
  box.querySelector('[data-new-cur="diamond"]').addEventListener('click', (e) => { newCur = 'diamond'; e.currentTarget.className = 'kid-btn primary'; box.querySelector('[data-new-cur="coin"]').className = 'kid-btn'; });
  box.querySelector('[data-new-cur="coin"]').addEventListener('click', (e) => { newCur = 'coin'; });
  const addItem = () => {
    const name = box.querySelector('[data-new-name]').value.trim();
    const cost = Number(box.querySelector('[data-new-cost]').value);
    if (!name) { toast('请输入道具名称', 'warn'); return; }
    if (!cost || cost <= 0) { toast('请输入有效价格', 'warn'); return; }
    S.shop.push({ id: uid('sp'), name, cost, cur: newCur, icon: '🎁', note: '家长自定义奖励' });
    persist();
    toast('道具已添加 🎁', 'ok');
    close();
    render();
  };
  box.querySelector('[data-new-cur="coin"]').addEventListener('click', (e) => { if (e.target === e.currentTarget) { newCur = 'coin'; } });
  box.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-shop]');
    if (del) { S.shop = S.shop.filter((x) => x.id !== del.dataset.delShop); persist(); close(); render(); }
    const cur = e.target.closest('[data-new-cur]');
    if (cur && cur.tagName === 'BUTTON' && cur.dataset.newCur !== undefined && e.target === cur) {
      newCur = cur.dataset.newCur;
      box.querySelectorAll('[data-new-cur]').forEach((x) => x.className = x === cur ? 'kid-btn primary' : 'kid-btn');
    }
  });
  // 回车添加
  box.querySelector('[data-new-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---------------- 家长模式(4 位密码) ----------------
function enterParentGate() {
  if (S.parentMode) { S.parentMode = false; persist(); toast('已退出家长模式', 'ok'); render(); return; }
  if (!S.parentPwd) {
    // 首次:设置 4 位密码
    openPwdModal('设置家长模式密码(4 位数字)', (pwd) => {
      S.parentPwd = pwd;
      S.parentMode = true;
      persist();
      toast('家长模式已开启 👨‍👩‍👦', 'ok');
      render();
    });
  } else {
    openPwdModal('输入家长密码', (pwd) => {
      if (pwd === S.parentPwd) {
        S.parentMode = true;
        persist();
        toast('家长模式已开启 👨‍👩‍👦', 'ok');
        render();
      } else {
        toast('密码不对哦 🔒', 'warn');
      }
    });
  }
}

function openPwdModal(title, onSuccess) {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  const box = document.createElement('div');
  box.className = 'kid-modal';
  box.style.maxWidth = '300px';
  let input = '';
  box.innerHTML = `
    <div class="kid-modal-head"><div class="kid-modal-title">${esc(title)}</div><button class="kid-modal-x" data-close>✕</button></div>
    <div class="kid-pwd-dots">${[0, 1, 2, 3].map(() => '<span class="kid-pwd-dot"></span>').join('')}</div>
    <div class="kid-pwd-pad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '⌫'].map((k) => `<button class="kid-pwd-key${k === '清空' || k === '⌫' ? ' del' : ''}" data-key="${k}">${k}</button>`).join('')}
    </div>`;
  const dots = box.querySelectorAll('.kid-pwd-dot');
  function refresh() { dots.forEach((d, i) => d.classList.toggle('fill', i < input.length)); }
  const close = () => ov.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  box.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.key;
    if (k === '清空') { input = ''; refresh(); return; }
    if (k === '⌫') { input = input.slice(0, -1); refresh(); return; }
    if (input.length >= 4) return;
    input += k;
    refresh();
    if (input.length === 4) {
      setTimeout(() => { close(); onSuccess(input); }, 120);
    }
  }));
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
}

// ---------------- 设置抽屉 ----------------
function openSettings() {
  const ov = document.createElement('div');
  ov.className = 'kid-overlay';
  ov.style.alignItems = 'stretch';
  ov.style.justifyContent = 'flex-end';
  ov.style.padding = '0';
  const drawer = document.createElement('div');
  drawer.className = 'kid-drawer';
  const lv = levelDef(S.exp);
  drawer.innerHTML = `
    <div class="kid-drawer-head">
      <div class="kid-logo" style="width:38px;height:38px">${starSvg(20, '#fff')}</div>
      <div class="kid-title" style="font-size:16px">设置</div>
      <button class="kid-modal-x" data-close style="margin-left:auto">✕</button>
    </div>
    <div class="kid-drawer-body">
      <div class="kid-drawer-row"><div><div class="k-dr-label">我的昵称</div><div class="k-dr-sub">显示在顶部与等级旁</div></div>
        <input type="text" data-set="name" value="${esc(S.name)}" style="width:130px;padding:8px 10px" maxlength="12"></div>

      <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">主题模式</div><div class="k-dr-sub">「跟随项目」与应用外观(深色/浅色)自动一致</div></div>
        <select data-set="theme" style="width:138px;padding:8px 10px">
          <option value="project"${S.themeMode === 'project' ? ' selected' : ''}>跟随项目</option>
          <option value="light"${S.themeMode === 'light' ? ' selected' : ''}>儿童亮色</option>
          <option value="candy"${S.themeMode === 'candy' ? ' selected' : ''}>糖果乐园 🍬</option>
          <option value="space"${S.themeMode === 'space' ? ' selected' : ''}>星际探险 🚀</option>
          <option value="dark"${S.themeMode === 'dark' ? ' selected' : ''}>深色</option>
        </select></div>

      <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">奖励倍数</div><div class="k-dr-sub">金币/经验按此倍数发放</div></div>
        <select data-set="mult" style="width:110px;padding:8px 10px">
          <option value="1"${S.rewardMult === 1 ? ' selected' : ''}>×1 标准</option>
          <option value="1.5"${S.rewardMult === 1.5 ? ' selected' : ''}>×1.5 加量</option>
          <option value="2"${S.rewardMult === 2 ? ' selected' : ''}>×2 翻倍</option>
        </select></div>

      <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">家长模式</div><div class="k-dr-sub">${S.parentMode ? '已开启 · 编辑计划/管理道具/撤销已解锁' : '开启后解锁家长专属操作'}</div></div>
        <span class="kid-switch${S.parentMode ? ' on' : ''}" data-set="parent"></span></div>

      ${S.parentPwd ? `<div class="kid-drawer-row"><div><div class="k-dr-label">修改家长密码</div><div class="k-dr-sub">重新设置 4 位数字密码</div></div>
        <button class="kid-btn sm" data-set="pwd">修改</button></div>` : ''}

      <div class="kid-sec-gap kid-drawer-row"><div><div class="k-dr-label">清空示例数据</div><div class="k-dr-sub">删除示例任务,重置为全新开始</div></div>
        <button class="kid-btn sm" data-set="sample">清空</button></div>

      <div class="kid-drawer-row"><div><div class="k-dr-label" style="color:#ef4444">清空全部数据</div><div class="k-dr-sub">删除所有任务/金币/等级/计划</div></div>
        <button class="kid-btn sm red" data-set="wipe">清空</button></div>

      <div class="kid-sec-gap" style="font-size:12px;color:var(--ktext3);line-height:1.7">
        当前:${esc(S.name)} · ${esc(lv.title)} Lv.${lv.lv} · 金币 ${S.coins} · 钻石 ${S.diamonds} · 皇冠 ${S.crowns} · 累计 ${S.totalTasks} 关<br>
        <br>数据保存在本机浏览器(localStorage),可随时「⬇ 导出」备份。首次打开内置示例数据(含 1 条逾期任务),用于演示「今天要处理」。
      </div>
    </div>`;

  const close = () => ov.remove();
  drawer.querySelector('[data-close]').addEventListener('click', close);
  drawer.querySelector('[data-set="name"]').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v) { S.name = v.slice(0, 12); persist(); render(); }
  });
  drawer.querySelector('[data-set="theme"]').addEventListener('change', (e) => {
    S.themeMode = e.target.value;
    persist();
    render();
  });
  drawer.querySelector('[data-set="mult"]').addEventListener('change', (e) => {
    S.rewardMult = Number(e.target.value); persist(); toast('奖励倍数已更新', 'ok');
  });
  drawer.querySelector('[data-set="parent"]').addEventListener('click', () => {
    if (S.parentMode) { S.parentMode = false; persist(); render(); }
    else enterParentGate();
  });
  const pwdBtn = drawer.querySelector('[data-set="pwd"]');
  if (pwdBtn) pwdBtn.addEventListener('click', () => {
    openPwdModal('设置新的家长密码', (pwd) => { S.parentPwd = pwd; persist(); toast('密码已更新 🔒', 'ok'); render(); });
  });
  drawer.querySelector('[data-set="sample"]').addEventListener('click', () => {
    if (!S.sampleLoaded) { toast('当前不是示例数据', 'warn'); return; }
    confirmDialog({ title: '清空示例数据', message: '将删除全部示例任务并重置金币/经验为初始值(孩子进度也会清空)。确定?', okText: '清空', danger: true, onOk: () => { S = emptyState(); seedSample(); close(); render(); toast('已重置为初始示例', 'ok'); } });
  });
  drawer.querySelector('[data-set="wipe"]').addEventListener('click', () => {
    confirmDialog({ title: '清空全部数据', message: '将永久删除所有任务、金币、等级、计划与设置。此操作不可恢复,建议先导出备份!确定?', okText: '清空', danger: true, onOk: () => { localStorage.removeItem(LS_KEY); loadState(); close(); render(); toast('已清空全部数据,重新开始', 'ok'); } });
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.appendChild(drawer);
  document.body.appendChild(ov);
}

// ---------------- 导出 / 导入 ----------------
function exportData() {
  const payload = { app: 'kid-workspace', exportedAt: new Date().toISOString(), data: S };
  const text = JSON.stringify(payload, null, 2);
  const name = `得乐学苑备份-${todayStr()}.json`;
  if (window.api && window.api.saveText) {
    window.api.saveText({ defaultName: name, content: text, filters: [{ name: 'JSON 备份', extensions: ['json'] }] })
      .then((r) => { if (r && r.ok) toast(`已导出到 ${r.path}`, 'ok'); else if (r && r.error) toast('导出失败: ' + r.error, 'warn'); });
  } else {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 JSON 备份', 'ok');
  }
}

function importData() {
  const doImport = (text) => {
    try {
      const d = JSON.parse(text);
      const data = d && d.app === 'kid-workspace' ? d.data : d;
      if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) { toast('文件不是有效的挑战台备份', 'warn'); return; }
      confirmDialog({
        title: '导入数据', message: '导入将覆盖当前全部数据(任务/金币/等级/计划)。建议先导出当前备份。确定导入?', okText: '导入', danger: true,
        onOk: () => {
          const base = emptyState();
          S = Object.assign(base, data);
          if (!Array.isArray(S.plan.weekly) || S.plan.weekly.length !== 7) S.plan.weekly = JSON.parse(JSON.stringify(TEMPLATE_PLAN));
          if (!Array.isArray(S.shop)) S.shop = JSON.parse(JSON.stringify(DEFAULT_SHOP));
          if (!S.medals) S.medals = {};
          if (!S.claimLog) S.claimLog = [];
          persist();
          render();
          toast(`导入成功!共 ${S.tasks.length} 条任务记录`, 'ok');
        },
      });
    } catch (e) { toast('JSON 解析失败: ' + e.message, 'warn'); }
  };

  if (window.api && window.api.pickFiles && window.api.readText) {
    window.api.pickFiles({ title: '选择备份文件', filters: [{ name: 'JSON 备份', extensions: ['json'] }], multi: false })
      .then(async (pick) => {
        if (!pick || pick.canceled || !pick.filePaths || !pick.filePaths.length) return;
        const rd = await window.api.readText(pick.filePaths[0]);
        if (!rd || !rd.ok) { toast('读取文件失败', 'warn'); return; }
        doImport(rd.text);
      });
  } else {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => doImport(String(reader.result));
      reader.readAsText(f);
    });
    inp.click();
  }
}
