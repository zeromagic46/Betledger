// betledger dashboard v3 — mybets.gg replica styling
const $ = (s) => document.querySelector(s);
const S = {
  pending: ["待结算", "var(--warn)"], win: ["赢", "var(--win)"],
  loss: ["输", "var(--loss)"],
  halfwin: ["赢一半", "var(--win)"], halfloss: ["输一半", "var(--loss)"],
  void: ["走水", "var(--dim)"],
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (n, d = 2) => (n < 0 ? "-" : "") + Math.abs(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mix = (c, p) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
const pillBg = (st) => ({ win: "var(--winbg)", halfwin: "var(--winbg)", loss: "var(--lossbg)", halfloss: "var(--lossbg)", pending: "var(--warnbg)", void: "var(--panel-soft)" }[st] || "var(--panel-soft)");
const pnl = (b) => {
  const st = +b.stake || 0, od = +b.odds || 0;
  // 优先用真实派彩:盈亏 = 支付额 - 投注额(覆盖走水/赢一半/输一半/提前兑现所有情况)
  if (b.payout !== "" && b.payout != null && !isNaN(+b.payout)) return (+b.payout) - st;
  // 无支付额时按状态回退估算
  if (b.status === "win") return st * (od - 1);
  if (b.status === "loss") return -st;
  if (b.status === "halfwin") return st * (od - 1) / 2;
  if (b.status === "halfloss") return -st / 2;
  if (b.status === "void") return 0;
  return 0;
};
const PAGE = 50;
const DEF_BET = () => ({ id: "", date: new Date().toISOString().slice(0, 10), sport: "足球",
  event: "", market: "", odds: "", stake: "", sportsbook: "", status: "pending",
  strategy: "", closeOdds: "", note: "" });

let state = { bets: [], drafts: [], parsing: false, lastError: "", apiKey: "",
  engine: "claude", ollamaUrl: "http://localhost:11434", ollamaModel: "qwen2.5vl:7b", bankroll: 0,
  customBase: "https://aistudio.baidu.com/llm/lmapi/v3", customKey: "", customModel: "ernie-4.5-turbo-vl-32k",
  paddleUrl: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs", paddleToken: "", paddleStructModel: "ernie-3.5-8k", paddleModel: "PaddleOCR-VL-1.6" };
let tab = location.hash === "#settings" ? "settings" : location.hash === "#confirm" ? "confirm" : "dash";
let editId = null;
let range = "all"; // dashboard range: 7 / 30 / 90 / all
let calMonth = null; // 日历当前显示月份 YYYY-MM,null=最近有数据的月
let fs = { q: "", status: "all", sport: "all", book: "all", strategy: "all", from: "", to: "", sort: "date-desc", page: 0 };
const TITLES = { dash: "仪表盘", confirm: "待确认", list: "我的注单", add: "新增注单", analysis: "分析", tools: "工具", settings: "设置" };

async function load() {
  const d = await chrome.storage.local.get(["bets", "drafts", "parsing", "lastError", "apiKey", "theme",
    "engine", "ollamaUrl", "ollamaModel", "bankroll", "customBase", "customKey", "customModel",
    "paddleUrl", "paddleToken", "paddleStructModel", "paddleModel"]);
  state = { bets: d.bets || [], drafts: d.drafts || [], parsing: !!d.parsing, lastError: d.lastError || "",
    apiKey: d.apiKey || "", engine: d.engine || "claude",
    ollamaUrl: d.ollamaUrl || "http://localhost:11434", ollamaModel: d.ollamaModel || "qwen2.5vl:7b",
    bankroll: +d.bankroll || 0,
    customBase: d.customBase || "https://aistudio.baidu.com/llm/lmapi/v3", customKey: d.customKey || "",
    customModel: d.customModel || "ernie-4.5-turbo-vl-32k",
    paddleUrl: d.paddleUrl || "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs", paddleToken: d.paddleToken || "", paddleStructModel: d.paddleStructModel || "ernie-3.5-8k", paddleModel: d.paddleModel || "PaddleOCR-VL-1.6" };
  render();
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.bets) state.bets = ch.bets.newValue || [];
  if (ch.drafts) state.drafts = ch.drafts.newValue || [];
  if (ch.parsing) state.parsing = !!ch.parsing.newValue;
  if (ch.lastError) state.lastError = ch.lastError.newValue || "";
  render();
});
const saveBets = () => chrome.storage.local.set({ bets: state.bets });
const saveDrafts = () => chrome.storage.local.set({ drafts: state.drafts });

// ================= stats =================
const SETTLED = ["win", "loss", "halfwin", "halfloss", "void"];
function settledBets(src) { return (src || state.bets).filter((b) => SETTLED.includes(b.status)); }
function rangeBets() {
  if (range === "all") return state.bets;
  const cut = new Date(Date.now() - (+range) * 864e5).toISOString().slice(0, 10);
  return state.bets.filter((b) => String(b.date) >= cut);
}
function calc(src) {
  const bets = src || state.bets;
  const settled = settledBets(bets);
  const staked = settled.reduce((s, b) => s + (+b.stake || 0), 0);
  const profit = settled.reduce((s, b) => s + pnl(b), 0);
  const wins = settled.filter((b) => b.status === "win" || b.status === "halfwin").length;
  const pending = bets.filter((b) => b.status === "pending");
  const sorted = [...settled].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let cum = 0, peak = 0, maxDD = 0;
  const curve = sorted.map((b) => {
    cum += pnl(b); peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum);
    return { date: String(b.date).slice(5), v: cum };
  });
  let curStreak = 0, maxWinStreak = 0, maxLossStreak = 0, w = 0, l = 0;
  sorted.forEach((b) => {
    if (b.status === "win") { w++; l = 0; } else { l++; w = 0; }
    maxWinStreak = Math.max(maxWinStreak, w); maxLossStreak = Math.max(maxLossStreak, l);
  });
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (i === sorted.length - 1) curStreak = sorted[i].status === "win" ? 1 : -1;
    else if ((curStreak > 0) === (sorted[i].status === "win")) curStreak += curStreak > 0 ? 1 : -1;
    else break;
  }
  const clvBets = settled.filter((b) => +b.closeOdds > 1 && +b.odds > 1);
  const clv = clvBets.length
    ? clvBets.reduce((s, b) => s + ((+b.odds) / (+b.closeOdds) - 1) * 100, 0) / clvBets.length : null;
  const avgOdds = settled.length ? settled.reduce((s, b) => s + (+b.odds || 0), 0) / settled.length : 0;
  const potential = pending.reduce((s, b) => s + (+b.stake || 0) * (+b.odds || 0), 0);
  return {
    staked, profit, wins, settledN: settled.length, totalBets: bets.length,
    roi: staked > 0 ? (profit / staked) * 100 : 0,
    winRate: settled.length > 0 ? (wins / settled.length) * 100 : 0,
    pendingN: pending.length, pendingStake: pending.reduce((s, b) => s + (+b.stake || 0), 0),
    potential, sorted,
    curve, maxDD, curStreak, maxWinStreak, maxLossStreak, clv, clvN: clvBets.length, avgOdds,
    bankNow: state.bankroll ? state.bankroll + profit : null,
  };
}
function groupBy(keyFn, labelOther = "其他") {
  const g = {};
  settledBets().forEach((b) => {
    const k = keyFn(b) || labelOther;
    g[k] = g[k] || { k, p: 0, n: 0, staked: 0, wins: 0 };
    g[k].p += pnl(b); g[k].n++; g[k].staked += (+b.stake || 0);
    if (b.status === "win") g[k].wins++;
  });
  return Object.values(g).sort((a, b) => b.p - a.p);
}
const oddsBucket = (b) => {
  const o = +b.odds || 0;
  return o < 1.5 ? "1.01–1.50" : o < 2 ? "1.50–2.00" : o < 3 ? "2.00–3.00" : o < 5 ? "3.00–5.00" : "5.00+";
};

// ================= charts =================
function lineChart(curve) {
  const W = 960, H = 240, P = 42;
  const vals = curve.map((c) => c.v);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const x = (i) => P + (i / (curve.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const pts = curve.map((c, i) => `${x(i)},${y(c.v)}`).join(" ");
  const areaPts = `${P},${y(0)} ${pts} ${x(curve.length - 1)},${y(0)}`;
  const zero = y(0), last = curve[curve.length - 1].v;
  const step = Math.max(1, Math.ceil(curve.length / 8));
  let labels = "";
  for (let i = 0; i < curve.length; i += step)
    labels += `<text x="${x(i)}" y="${H - 12}" style="fill:var(--dim)" font-size="10" text-anchor="middle">${esc(curve[i].date)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--profit)" stop-opacity=".25"/>
      <stop offset="1" style="stop-color:var(--profit)" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${areaPts}" fill="url(#area)"/>
    <line x1="${P}" y1="${zero}" x2="${W - P}" y2="${zero}" style="stroke:#d0d0d0" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" style="stroke:var(--profit)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(curve.length - 1)}" cy="${y(last)}" r="3.5" style="fill:var(--profit)"/>
    <text x="${x(curve.length - 1) - 8}" y="${y(last) - 10}" style="fill:${last >= 0 ? "var(--win)" : "var(--loss)"}" font-size="12" font-weight="600" text-anchor="end">${last >= 0 ? "+" : ""}${fmt(last)}</text>
    ${labels}</svg>`;
}
function groupBars(rows) {
  if (!rows.length) return `<div class="hint">暂无数据</div>`;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.p)), 1);
  return rows.map((r) => {
    const w = Math.max(2, (Math.abs(r.p) / maxAbs) * 100);
    const col = r.p >= 0 ? "var(--win)" : "var(--loss)";
    const roi = r.staked > 0 ? (r.p / r.staked) * 100 : 0;
    const wr = r.n > 0 ? (r.wins / r.n) * 100 : 0;
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="width:110px;font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.06em" title="${esc(r.k)}">${esc(r.k)}</div>
      <div style="flex:1;background:var(--panel-soft);border-radius:3px;height:8px;overflow:hidden">
        <div style="width:${w}%;height:100%;background:${col}"></div></div>
      <div class="mono" style="width:88px;text-align:right;font-size:12.5px;font-weight:600;color:${col}">${r.p >= 0 ? "+" : ""}${fmt(r.p)}</div>
      <div class="mono" style="width:66px;text-align:right;font-size:11px;color:${roi >= 0 ? "var(--win)" : "var(--loss)"}">${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%</div>
      <div class="hint" style="width:96px;margin:0">${r.n} 注 · ${wr.toFixed(0)}% 胜</div>
    </div>`;
  }).join("");
}
function calendarMap() {
  const byDay = {};
  settledBets().forEach((b) => {
    const d = String(b.date);
    byDay[d] = byDay[d] || { p: 0, w: 0, l: 0 };
    byDay[d].p += pnl(b);
    if (b.status === "win" || b.status === "halfwin") byDay[d].w++; else byDay[d].l++;
  });
  // 所有有数据的月份(YYYY-MM),用于下拉
  const monthsSet = new Set(Object.keys(byDay).map((d) => d.slice(0, 7)));
  const months = [...monthsSet].sort().reverse();
  const latest = months[0] || new Date().toISOString().slice(0, 7);
  const cur = (calMonth && monthsSet.has(calMonth)) ? calMonth : latest;
  const [y, m] = cur.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();

  let cells = ["一", "二", "三", "四", "五", "六", "日"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) cells += `<div class="cell empty2"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const rec = byDay[key];
    if (!rec) { cells += `<div class="cell"><div class="d">${d}</div></div>`; continue; }
    const cls = rec.p > 0 ? "win" : rec.p < 0 ? "loss" : "mix";
    const col = rec.p > 0 ? "var(--win)" : rec.p < 0 ? "var(--loss)" : "var(--warn)";
    cells += `<div class="cell ${cls}"><div class="d">${d}</div><div class="p" style="color:${col}">${rec.p >= 0 ? "+" : ""}${Math.round(rec.p)}</div></div>`;
  }
  // 月份下拉
  const monLabel = months.length
    ? `<select data-f2="calmonth" style="width:auto;height:30px;font-size:11px;font-family:ui-monospace,Consolas,monospace">
        ${months.map((mo) => { const [yy, mm] = mo.split("-"); return `<option value="${mo}" ${mo === cur ? "selected" : ""}>${yy}年${+mm}月</option>`; }).join("")}
      </select>`
    : `<span style="font-size:11px;color:var(--dim)">暂无数据</span>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-size:11px;color:var(--dim);font-family:ui-monospace,Consolas,monospace">${y}年${m}月</span>${monLabel}</div><div class="cal">${cells}</div>`;
}

const statCard = (label, value, color, sub) =>
  `<div class="statcell"><div class="l">${label}</div>
   <div class="v mono" ${color ? `style="color:${color}"` : ""}>${value}</div></div>`;

// ================= form =================
function formHtml(b, saveLabel, saveAct, cancelAct) {
  return `<div class="panel" data-form="${b.id || ""}">
    ${b.img ? `<div style="margin-bottom:14px"><img src="${b.img}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--line)"></div>` : ""}
    <div class="fields">
      <label><div class="fl micro">日期</div><input type="date" name="date" value="${esc(b.date)}"></label>
      <label><div class="fl micro">运动</div><input name="sport" value="${esc(b.sport)}" placeholder="足球" list="sportList"></label>
      <label><div class="fl micro">平台</div><input name="sportsbook" value="${esc(b.sportsbook)}" placeholder="平台名称" list="bookList"></label>
      <label><div class="fl micro">策略标签</div><input name="strategy" value="${esc(b.strategy || "")}" placeholder="如 主胜低赔 / 角球" list="strategyList"></label>
    </div>
    <div class="fields">
      <label style="flex:2"><div class="fl micro">对阵 / 赛事</div><input name="event" value="${esc(b.event)}" placeholder="法国 vs 巴西"></label>
      <label style="flex:2"><div class="fl micro">玩法 / 选择</div><input name="market" value="${esc(b.market)}" placeholder="胜平负-主胜"></label>
    </div>
    <div class="fields">
      <label><div class="fl micro">赔率(欧赔)</div><input type="number" step="0.01" name="odds" value="${esc(b.odds)}" placeholder="1.85"></label>
      <label><div class="fl micro">本金</div><input type="number" name="stake" value="${esc(b.stake)}" placeholder="100"></label>
      <label><div class="fl micro">支付额(优先算盈亏)</div><input type="number" step="0.01" name="payout" value="${esc(b.payout ?? "")}"></label>
      <label><div class="fl micro">收盘赔率(算CLV,选填)</div><input type="number" step="0.01" name="closeOdds" value="${esc(b.closeOdds || "")}"></label>
      <label><div class="fl micro">状态</div><select name="status">${Object.entries(S).map(([k, v]) => `<option value="${k}" ${b.status === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
    </div>
    <div class="fields"><label><div class="fl micro">备注</div><input name="note" value="${esc(b.note || "")}" placeholder="选填"></label></div>
    <button class="btn btn-primary" data-act="${saveAct}" data-id="${b.id || ""}">${saveLabel}</button>
    ${cancelAct ? `<button class="btn btn-outline" data-act="${cancelAct}" data-id="${b.id || ""}" style="margin-left:8px">取消</button>` : ""}
  </div>`;
}
function readForm(el) {
  const g = (n) => { const el2 = el.querySelector(`[name=${n}]`); return el2 ? el2.value : ""; };
  return { date: g("date"), sport: g("sport"), sportsbook: g("sportsbook"), event: g("event"),
    market: g("market"), odds: g("odds"), stake: g("stake"), status: g("status"),
    strategy: g("strategy"), closeOdds: g("closeOdds"), payout: g("payout"), note: g("note") };
}
function validBet(b) { return b.event && +b.odds > 0 && +b.stake > 0; }

// ================= list filter =================
function filteredBets() {
  let arr = state.bets.filter((b) => {
    if (fs.status !== "all" && b.status !== fs.status) return false;
    if (fs.sport !== "all" && (b.sport || "其他") !== fs.sport) return false;
    if (fs.book !== "all" && (b.sportsbook || "其他") !== fs.book) return false;
    if (fs.strategy !== "all" && (b.strategy || "无标签") !== fs.strategy) return false;
    if (fs.from && String(b.date) < fs.from) return false;
    if (fs.to && String(b.date) > fs.to) return false;
    if (fs.q) {
      const q = fs.q.toLowerCase();
      if (![b.event, b.market, b.sportsbook, b.sport, b.strategy, b.note].join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const [key, dir] = fs.sort.split("-");
  arr.sort((a, b) => {
    let v = 0;
    if (key === "date") v = String(a.date).localeCompare(String(b.date));
    if (key === "pnl") v = pnl(a) - pnl(b);
    if (key === "stake") v = (+a.stake || 0) - (+b.stake || 0);
    if (key === "odds") v = (+a.odds || 0) - (+b.odds || 0);
    return dir === "asc" ? v : -v;
  });
  return arr;
}
const opts = (field, extra) => [...new Set(state.bets.map((b) => b[field] || extra))].sort();

// ================= render =================
function render() {
  const stAll = calc();
  $("#pageTitle").textContent = TITLES[tab] || "仪表盘";

  // 侧边栏导航(带图标)
  const IC = {
    dash: '<path d="M3 3v18h18"/><path d="m7 14 3-3 3 3 5-6"/>',
    list: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
    confirm: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    analysis: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="12" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/>',
    tools: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h4M8 12h8M8 16h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  const tabs = [
    ["dash", "仪表盘"], ["list", `我的注单`], ["confirm", `待确认`],
    ["analysis", "分析"], ["tools", "工具"], ["settings", "设置"],
  ];
  $("#nav").innerHTML = tabs.map(([k, l]) => {
    const badge = k === "confirm" && state.drafts.length ? ` <span style="margin-left:auto;background:var(--warn);color:#fff;border-radius:999px;padding:1px 7px;font-size:11px">${state.drafts.length}</span>` : "";
    const cnt = k === "list" && state.bets.length ? ` <span style="margin-left:auto;color:var(--faint);font-size:12px">${state.bets.length}</span>` : "";
    return `<button class="navitem ${tab === k ? "on" : ""}" data-tab="${k}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>${l}${badge}${cnt}</button>`;
  }).join("");

  // 页头战绩条(仅仪表盘页显示)
  const last10 = stAll.sorted.slice(-10);
  const wlHtml = last10.length
    ? last10.map((b) => { const w = b.status === "win" || b.status === "halfwin"; return `<span class="${w ? "w" : "l"}">${w ? "W" : "L"}</span>`; }).join("")
    : `<span style="font-size:10px;color:var(--faint)">暂无</span>`;

  let html = `<datalist id="strategyList">${opts("strategy", "").filter(Boolean).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <datalist id="bookList">${opts("sportsbook", "").filter(Boolean).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <datalist id="sportList">${["足球", "篮球", "网球", "电竞", ...opts("sport", "").filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
  if (state.lastError) html += `<div class="err">${esc(state.lastError)}</div>`;

  // -------- dashboard --------
  if (tab === "dash") {
    const st = calc(rangeBets());
    html += `<div class="pagehead">
      <div class="ph-ic"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>
      <div><div class="ph-t">DASHBOARD</div><div class="ph-live"><span class="dot-live"></span>LIVE STATS</div></div>
      <div class="form"><span class="form-l">FORM</span><span class="wl">${wlHtml}</span></div>
    </div>`;
    html += `<div class="statrow">
      ${statCard("NET P/L", `${st.profit >= 0 ? "+" : ""}${fmt(st.profit)}`, st.profit >= 0 ? "var(--win)" : "var(--loss)")}
      ${statCard("ROI", `${st.roi >= 0 ? "+" : ""}${st.roi.toFixed(1)}%`, st.roi >= 0 ? "var(--win)" : "var(--loss)")}
      ${statCard("胜率", `${st.winRate.toFixed(1)}% <small>/${st.settledN} 注</small>`, "var(--ink)")}
      ${statCard("赢", st.wins, "var(--win)")}
      ${statCard("输/半输", st.settledN - st.wins, "var(--loss)")}
      ${statCard("总投入", fmt(st.staked), "var(--ink)")}
    </div>`;
    if (st.bankNow !== null || st.clv !== null) {
      html += `<div class="statrow">
        ${st.bankNow !== null ? statCard("当前资金", fmt(st.bankNow), "var(--ink)") : ""}
        ${statCard("在投敞口", fmt(st.pendingStake), "var(--warn)") }
        ${statCard("最大回撤", fmt(st.maxDD), "var(--loss)")}
        ${statCard("均赔", "@" + st.avgOdds.toFixed(2), "var(--ink)")}
        ${st.clv !== null ? statCard("平均 CLV", `${st.clv >= 0 ? "+" : ""}${st.clv.toFixed(2)}%`, st.clv >= 0 ? "var(--win)" : "var(--loss)") : ""}
      </div>`;
    }
    const rangeBtns = `<div class="range">${[["7", "7D"], ["30", "30D"], ["all", "ALL"]].map(([v, l]) => `<button class="${range === v ? "on" : ""}" data-f2="range" data-rv="${v}">${l}</button>`).join("")}</div>`;
    html += st.curve.length >= 2
      ? `<div class="panel"><div class="panel-head"><div class="panel-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>PROFIT HISTORY</div>${rangeBtns}</div>${lineChart(st.curve)}</div>`
      : `<div class="panel empty">暂无数据。框选注单区域,AI 解析后会进入待确认队列。</div>`;
    // Pending results
    const pend = rangeBets().filter((b) => b.status === "pending").slice(0, 8);
    if (pend.length) {
      html += `<div class="panel"><div class="panel-title" style="margin-bottom:12px">待结算注单</div>
        <table><thead><tr><th>日期</th><th>赛事</th><th>玩法</th><th class="num">本金 / 赔率</th><th class="num">可回收</th><th></th></tr></thead><tbody>`;
      pend.forEach((b) => {
        html += `<tr>
          <td class="mono" style="color:var(--dim);font-size:12px">${esc(b.date)}</td>
          <td style="font-weight:600">${esc(b.event)}</td>
          <td style="color:var(--dim)">${esc(b.market)}</td>
          <td class="num mono">${fmt(+b.stake || 0, 0)} @ ${(+b.odds || 0).toFixed(2)}</td>
          <td class="num mono" style="color:var(--warn)">${fmt((+b.stake || 0) * (+b.odds || 0))}</td>
          <td><span class="pill" data-act="cycle" data-id="${b.id}" style="color:var(--warn);background:var(--warnbg)">待结算</span></td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    // Recent settled
    const recent = stAll.sorted.slice(-6).reverse();
    if (recent.length) {
      html += `<div class="panel"><div class="panel-title" style="margin-bottom:12px">已结算注单</div>
        <table><thead><tr><th>日期</th><th>赛事</th><th>玩法</th><th class="num">本金 / 赔率</th><th>状态</th><th class="num">净盈亏</th></tr></thead><tbody>`;
      recent.forEach((b) => {
        const p = pnl(b); const [sl, sc] = S[b.status];
        html += `<tr>
          <td class="mono" style="color:var(--dim);font-size:12px">${esc(b.date)}</td>
          <td style="font-weight:600">${esc(b.event)}</td>
          <td style="color:var(--dim)">${esc(b.market)}</td>
          <td class="num mono">${fmt(+b.stake || 0, 0)} @ ${(+b.odds || 0).toFixed(2)}</td>
          <td><span class="pill" style="cursor:default;color:${sc};background:${pillBg(b.status)}">${sl}</span></td>
          <td class="num mono" style="font-weight:600;color:${p >= 0 ? "var(--win)" : "var(--loss)"}">${p >= 0 ? "+" : ""}${fmt(p)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
  }

  // -------- review queue --------
  if (tab === "confirm") {
    html += `<div style="margin-top:16px"></div>`;
    if (state.parsing) html += `<div class="panel empty">AI 解析中,完成后会自动显示在这里…</div>`;
    if (state.drafts.length) {
      html += `<div class="micro" style="margin:4px 0 12px;color:var(--warn)">识别到 ${state.drafts.length} 条投注,请对照截图核对后入库:</div>`;
      html += state.drafts.map((d) => formHtml(d, "确认入库", "confirm-save", "confirm-drop")).join("");
    } else if (!state.parsing) {
      html += `<div class="panel empty">暂无待确认注单。到目标网站点击插件图标 →「框选注单区域」。</div>`;
    }
  }

  // -------- my bets --------
  if (tab === "list") {
    const all = filteredBets();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    fs.page = Math.min(fs.page, pages - 1);
    const view = all.slice(fs.page * PAGE, fs.page * PAGE + PAGE);
    const fp = settledBets(all).reduce((s, b) => s + pnl(b), 0);
    html += `<div class="panel" style="margin-top:16px;padding:14px 16px">
      <div class="fields" style="margin-bottom:0">
        <label style="flex:1.7"><div class="fl micro">搜索</div><input data-f="q" value="${esc(fs.q)}" placeholder="按赛事/玩法/备注筛选…(回车应用)"></label>
        <label><div class="fl micro">状态</div><select data-f="status"><option value="all">全部</option>${Object.entries(S).map(([k, v]) => `<option value="${k}" ${fs.status === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
        <label><div class="fl micro">运动</div><select data-f="sport"><option value="all">全部</option>${opts("sport", "其他").map((o) => `<option ${fs.sport === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
        <label><div class="fl micro">平台</div><select data-f="book"><option value="all">全部</option>${opts("sportsbook", "其他").map((o) => `<option ${fs.book === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
        <label><div class="fl micro">策略</div><select data-f="strategy"><option value="all">全部</option>${opts("strategy", "无标签").map((o) => `<option ${fs.strategy === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
        <label><div class="fl micro">从</div><input type="date" data-f="from" value="${esc(fs.from)}"></label>
        <label><div class="fl micro">到</div><input type="date" data-f="to" value="${esc(fs.to)}"></label>
        <label><div class="fl micro">排序</div><select data-f="sort">
          ${[["date-desc", "日期 新→旧"], ["date-asc", "日期 旧→新"], ["stake-desc", "本金 大→小"], ["stake-asc", "本金 小→大"], ["pnl-desc", "盈亏 高→低"], ["pnl-asc", "盈亏 低→高"], ["odds-desc", "赔率 高→低"]]
            .map(([v, l]) => `<option value="${v}" ${fs.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="hint">显示 ${view.length} / 共 ${all.length} 注 · 合计盈亏 <span class="mono" style="font-weight:600;color:${fp >= 0 ? "var(--win)" : "var(--loss)"}">${fp >= 0 ? "+" : ""}${fmt(fp)}</span>
      ${(fs.q || fs.status !== "all" || fs.sport !== "all" || fs.book !== "all" || fs.strategy !== "all" || fs.from || fs.to) ? ` · <a href="#" data-act="clear-filter">清除筛选</a>` : ""}</div>
    </div>`;
    if (!all.length) html += `<div class="panel empty">没有符合条件的注单。</div>`;
    else {
      html += `<div class="panel" style="padding:6px 8px"><table><thead><tr>
        <th>日期</th><th>赛事</th><th class="num">本金 / 赔率</th><th>状态</th><th class="num">净盈亏</th><th></th></tr></thead><tbody>`;
      view.forEach((b) => {
        if (editId === b.id) return;
        const p = pnl(b); const [sl, sc] = S[b.status] || S.pending;
        const sub = [b.sport, b.market, b.sportsbook, b.strategy].filter(Boolean).join(" · ");
        html += `<tr>
          <td class="mono" style="color:var(--dim);font-size:12px;white-space:nowrap">${esc(b.date)}</td>
          <td><div style="font-weight:600">${esc(b.event)}${b.note ? ` <span title="${esc(b.note)}" style="color:var(--dim);cursor:help">✎</span>` : ""}</div>
              <div style="font-size:12px;color:var(--dim)">${esc(sub)}</div></td>
          <td class="num mono" style="white-space:nowrap">${fmt(+b.stake || 0, 0)} @ ${(+b.odds || 0).toFixed(2)}</td>
          <td><span class="pill" data-act="cycle" data-id="${b.id}" style="color:${sc};background:${pillBg(b.status)}">${sl}</span></td>
          <td class="num mono" style="font-weight:600;color:${p > 0 ? "var(--win)" : p < 0 ? "var(--loss)" : "var(--dim)"}">${b.status === "pending" ? "—" : (p >= 0 ? "+" : "") + fmt(p)}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="btn btn-outline" style="height:28px;padding:0 12px;font-size:12px" data-act="edit" data-id="${b.id}">编辑</button>
            <button class="btn btn-danger" style="height:28px;padding:0 8px;font-size:12px" data-act="del" data-id="${b.id}">删除</button></td></tr>`;
      });
      html += `</tbody></table></div>`;
      if (editId) {
        const b = state.bets.find((x) => x.id === editId);
        if (b) html += formHtml(b, "保存修改", "edit-save", "edit-cancel");
      }
      if (pages > 1) html += `<div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <button class="btn btn-outline" data-act="page-prev" ${fs.page === 0 ? "disabled" : ""}>上一页</button>
        <span class="micro">${fs.page + 1} / ${pages}</span>
        <button class="btn btn-outline" data-act="page-next" ${fs.page >= pages - 1 ? "disabled" : ""}>下一页</button></div>`;
      html += `<button class="btn btn-outline" data-act="csv" style="margin-top:12px">导出 CSV</button>
        <div class="hint">点击状态标签快速切换:待结算 → 赢 → 输 → 走盘。</div>`;
    }
  }

  // -------- add --------
  if (tab === "add") { html += `<div style="margin-top:16px"></div>` + formHtml(DEF_BET(), "保存注单", "add-save", ""); }

  // -------- analytics --------
  if (tab === "analysis") {
    const st = stAll;
    if (!settledBets().length) html += `<div class="panel empty" style="margin-top:16px">暂无已结算注单,出结果后这里会解锁多维分析。</div>`;
    else {
      html += `<div class="statrow">
        ${statCard("最长连胜", st.maxWinStreak, "var(--win)")}
        ${statCard("最长连败", st.maxLossStreak, "var(--loss)")}
        ${statCard("平均赔率", "@" + st.avgOdds.toFixed(2))}
        ${statCard("平均 CLV", st.clv === null ? "—" : (st.clv >= 0 ? "+" : "") + st.clv.toFixed(2) + "%", (st.clv ?? 0) >= 0 ? "var(--win)" : "var(--loss)", st.clv === null ? "在注单里填收盘赔率后解锁" : "持续为正 = 拿到了好价")}
      </div>`;
      html += `<div class="panel"><div class="panel-head"><div class="panel-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>CONSISTENCY MAP</div><div class="panel-sub">每日盈亏</div></div>${calendarMap()}</div>`;
      const sec = (t, rows) => `<div class="panel"><div class="panel-title" style="margin-bottom:14px">${t}</div>${groupBars(rows)}</div>`;
      html += sec("按运动", groupBy((b) => b.sport));
      html += sec("按玩法", groupBy((b) => String(b.market).split(/[-—:@]/)[0].trim()));
      html += sec("按平台", groupBy((b) => b.sportsbook));
      html += sec("按策略", groupBy((b) => b.strategy, "无标签"));
      html += sec("按赔率区间", groupBy(oddsBucket).sort((a, b) => a.k.localeCompare(b.k)));
      html += sec("按月份", groupBy((b) => String(b.date).slice(0, 7)).sort((a, b) => a.k.localeCompare(b.k)));
    }
  }

  // -------- tools --------
  if (tab === "tools") {
    html += `<div style="margin-top:16px"></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">赔率转换</div>
      <div class="fields" style="max-width:760px">
        <label><div class="fl micro">欧赔</div><input type="number" step="0.01" id="c-eu" placeholder="1.85"></label>
        <label><div class="fl micro">美式</div><input type="number" id="c-us" placeholder="-118"></label>
        <label><div class="fl micro">港赔</div><input type="number" step="0.01" id="c-hk" placeholder="0.85"></label>
        <label><div class="fl micro">隐含概率</div><input id="c-prob" readonly placeholder="—"></label>
      </div><div class="hint">修改任意一栏,其余自动换算。隐含概率 = 1 / 欧赔。</div></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">凯利公式注码</div>
      <div class="fields" style="max-width:760px">
        <label><div class="fl micro">估计胜率 %</div><input type="number" id="k-p" placeholder="58"></label>
        <label><div class="fl micro">欧赔</div><input type="number" step="0.01" id="k-odds" placeholder="1.85"></label>
        <label><div class="fl micro">资金</div><input type="number" id="k-bank" value="${state.bankroll || ""}" placeholder="10000"></label>
      </div><div id="k-out" class="hint">填入参数自动计算全凯利 / 半凯利建议注码。</div></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">两向套利计算</div>
      <div class="fields" style="max-width:760px">
        <label><div class="fl micro">结果A赔率</div><input type="number" step="0.01" id="a-o1" placeholder="2.10"></label>
        <label><div class="fl micro">结果B赔率</div><input type="number" step="0.01" id="a-o2" placeholder="2.05"></label>
        <label><div class="fl micro">总投入</div><input type="number" id="a-stake" placeholder="1000"></label>
      </div><div id="a-out" class="hint">1/A + 1/B &lt; 1 时存在套利空间,自动给出双边分配。</div></div>`;
  }

  // -------- settings --------
  if (tab === "settings") {
    const eng = state.engine;
    html += `<div style="margin-top:16px"></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">资金管理</div>
      <div class="hint" style="margin:0 0 12px">设置初始资金后,仪表盘显示当前资金、收益率和回撤占比,凯利计算器默认引用。</div>
      <div style="display:flex;gap:8px;max-width:420px">
        <input type="number" id="bankrollInput" placeholder="如 10000" value="${state.bankroll || ""}">
        <button class="btn btn-primary" data-act="save-bankroll" style="white-space:nowrap">保存</button>
      </div></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">解析引擎</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn ${eng === "claude" ? "btn-primary" : "btn-outline"}" data-act="set-engine" data-id="claude">云端 Claude</button>
        <button class="btn ${eng === "ollama" ? "btn-primary" : "btn-outline"}" data-act="set-engine" data-id="ollama">本地 Ollama</button>
        <button class="btn ${eng === "custom" ? "btn-primary" : "btn-outline"}" data-act="set-engine" data-id="custom">百度星河 / 兼容 API</button>
        <button class="btn ${eng === "paddleocr" ? "btn-primary" : "btn-outline"}" data-act="set-engine" data-id="paddleocr">PaddleOCR-VL</button>
      </div>
      <div style="display:${eng === "claude" ? "block" : "none"}">
        <div class="hint" style="margin:0 0 12px">识别精度最高。Key 只保存在本机浏览器,截图直接发送到 Anthropic API,不经过任何第三方服务器。在 console.anthropic.com 创建 Key。</div>
        <div style="display:flex;gap:8px;max-width:560px">
          <input type="password" id="apiKeyInput" placeholder="sk-ant-..." value="${esc(state.apiKey)}">
          <button class="btn btn-primary" data-act="save-key" style="white-space:nowrap">保存</button>
        </div>
      </div>
      <div style="display:${eng === "ollama" ? "block" : "none"}">
        <div class="hint" style="margin:0 0 12px">使用本机视觉大模型解析,截图完全不出本机,无 API 费用。推荐模型 qwen2.5vl:7b(显存紧张用 :3b 或 minicpm-v)。</div>
        <div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:var(--dim)">
          首次配置(终端执行):<br><code>ollama pull qwen2.5vl:7b</code><br>
          允许插件访问 Ollama(设置环境变量后重启 Ollama):<br>
          Windows: <code>setx OLLAMA_ORIGINS "*"</code> ·
          macOS/Linux: <code>export OLLAMA_ORIGINS="*"</code>
        </div>
        <div class="fields" style="max-width:640px">
          <label><div class="fl micro">Ollama 地址</div><input id="ollamaUrlInput" value="${esc(state.ollamaUrl)}"></label>
          <label><div class="fl micro">模型名称</div><input id="ollamaModelInput" value="${esc(state.ollamaModel)}"></label>
        </div>
        <button class="btn btn-primary" data-act="save-ollama">保存</button>
        <button class="btn btn-outline" data-act="test-ollama" style="margin-left:8px">测试连接</button>
      </div>
      <div style="display:${eng === "custom" ? "block" : "none"}">
        <div class="hint" style="margin:0 0 12px">适用于任何 OpenAI 兼容接口,默认已配置百度星河 AI Studio(每人 100 万免费 Tokens)。也兼容千帆、阿里通义、智谱、SiliconFlow 等。必须选择支持图片输入的视觉(VL)模型。</div>
        <div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:var(--dim)">
          百度千帆:Base URL <code>https://aistudio.baidu.com/llm/lmapi/v3</code>,Key 在千帆控制台「API Key」创建(bce-v3/ 开头),模型如 <code>ernie-4.5-turbo-vl-32k</code><br>
          阿里通义:<code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>,模型如 <code>qwen-vl-plus</code><br>
          模型名以各家控制台当前列表为准。
        </div>
        <div class="fields" style="max-width:760px">
          <label style="flex:1.6"><div class="fl micro">Base URL</div><input id="customBaseInput" value="${esc(state.customBase)}"></label>
          <label><div class="fl micro">模型名称</div><input id="customModelInput" value="${esc(state.customModel)}"></label>
        </div>
        <div style="display:flex;gap:8px;max-width:560px;margin-bottom:12px">
          <input type="password" id="customKeyInput" placeholder="API Key" value="${esc(state.customKey)}">
        </div>
        <button class="btn btn-primary" data-act="save-custom">保存</button>
        <button class="btn btn-outline" data-act="test-custom" style="margin-left:8px">测试连接</button>
      </div>
      <div style="display:${eng === "paddleocr" ? "block" : "none"}">
        <div class="hint" style="margin:0 0 12px">PaddleOCR-VL 异步识别注单为文本(提交任务→自动轮询),再用内置规则解析成注单数据,全程只用 OCR 令牌,不需要大模型权限。文字密集、倾斜、屏摄的注单用这个最稳,单次约几秒。</div>
        <div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:var(--dim)">
          服务地址已默认填好(<code>paddleocr.aistudio-app.com/api/v2/ocr/jobs</code>),一般无需改动<br>
          令牌:打开 <code>aistudio.baidu.com/paddleocr/task</code> 的「API 调用示例」,复制里面 TOKEN 那一串
        </div>
        <div class="fields" style="max-width:820px">
          <label style="flex:2"><div class="fl micro">任务接口地址</div><input id="paddleUrlInput" value="${esc(state.paddleUrl)}"></label>
          <label><div class="fl micro">OCR 模型</div><input id="paddleModelInput" value="${esc(state.paddleModel)}" placeholder="PaddleOCR-VL-1.6"></label>
        </div>
        <div style="display:flex;gap:8px;max-width:560px;margin-bottom:12px">
          <input type="password" id="paddleTokenInput" placeholder="TOKEN" value="${esc(state.paddleToken)}">
        </div>
        <button class="btn btn-primary" data-act="save-paddle">保存</button>
        <span class="hint" style="margin-left:10px">保存后直接去注单页框选即可</span>
      </div>
      <div id="keyMsg" class="hint"></div></div>
    <div class="panel"><div class="panel-title" style="margin-bottom:14px">数据管理</div>
      <button class="btn btn-outline" data-act="csv">导出 CSV</button>
      <button class="btn btn-outline" data-act="backup" style="margin-left:8px">备份 JSON</button>
      <button class="btn btn-outline" data-act="import" style="margin-left:8px">恢复 / 导入</button>
      <button class="btn btn-danger" style="border:1px solid ${mix("var(--destructive)", 30)};margin-left:8px" data-act="wipe">清空全部数据</button>
      <input type="file" id="importFile" accept=".json" style="display:none">
      <div class="hint">备份包含全部注单与设置(不含 API Key)。恢复时可选择覆盖或按 ID 合并去重。</div></div>`;
  }

  $("#main").innerHTML = html;
}

// ================= events: filters & tools =================
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.f) { fs[t.dataset.f] = t.value; fs.page = 0; render(); return; }

  if (t.id === "importFile") return handleImport(t.files[0]);
  if (["c-eu", "c-us", "c-hk"].includes(t.id)) return convertOdds(t.id);
  if (["k-p", "k-odds", "k-bank"].includes(t.id)) return kelly();
  if (["a-o1", "a-o2", "a-stake"].includes(t.id)) return arb();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.f === "q") {
    fs.q = e.target.value; fs.page = 0; render();
  }
});

function convertOdds(src) {
  let eu = NaN;
  if (src === "c-eu") eu = +$("#c-eu").value;
  if (src === "c-hk") eu = +$("#c-hk").value + 1;
  if (src === "c-us") { const us = +$("#c-us").value; eu = us > 0 ? us / 100 + 1 : us < 0 ? 100 / -us + 1 : NaN; }
  if (!(eu > 1)) return;
  if (src !== "c-eu") $("#c-eu").value = eu.toFixed(3);
  if (src !== "c-hk") $("#c-hk").value = (eu - 1).toFixed(3);
  if (src !== "c-us") $("#c-us").value = eu >= 2 ? "+" + Math.round((eu - 1) * 100) : String(Math.round(-100 / (eu - 1)));
  $("#c-prob").value = (100 / eu).toFixed(2) + "%";
}
function kelly() {
  const p = +$("#k-p").value / 100, odds = +$("#k-odds").value, bank = +$("#k-bank").value;
  const out = $("#k-out");
  if (!(p > 0 && p < 1) || !(odds > 1)) { out.textContent = "填入参数自动计算全凯利 / 半凯利建议注码。"; return; }
  const b = odds - 1, f = (b * p - (1 - p)) / b;
  if (f <= 0) { out.innerHTML = `凯利值 <b style="color:var(--loss)">${(f * 100).toFixed(2)}%</b> — 按此胜率与赔率期望为负,不建议下注。`; return; }
  const full = bank > 0 ? ` = <span class="mono">${fmt(bank * f)}</span>` : "";
  const half = bank > 0 ? ` = <span class="mono">${fmt(bank * f / 2)}</span>` : "";
  out.innerHTML = `全凯利:<b style="color:var(--profit)">${(f * 100).toFixed(2)}%</b>${full} · 半凯利:<b>${(f * 50).toFixed(2)}%</b>${half} · 期望 ROI:<b style="color:var(--win)">+${((p * odds - 1) * 100).toFixed(2)}%</b>`;
}
function arb() {
  const o1 = +$("#a-o1").value, o2 = +$("#a-o2").value, stake = +$("#a-stake").value || 1000;
  const out = $("#a-out");
  if (!(o1 > 1) || !(o2 > 1)) { out.textContent = "1/A + 1/B < 1 时存在套利空间,自动给出双边分配。"; return; }
  const m = 1 / o1 + 1 / o2;
  if (m >= 1) { out.innerHTML = `合计隐含概率 <b style="color:var(--loss)">${(m * 100).toFixed(2)}%</b> ≥ 100%,无套利空间。`; return; }
  const s1 = stake * (1 / o1) / m, s2 = stake * (1 / o2) / m;
  out.innerHTML = `套利空间 <b style="color:var(--win)">${((1 / m - 1) * 100).toFixed(2)}%</b> · A 投 <span class="mono">${fmt(s1)}</span>,B 投 <span class="mono">${fmt(s2)}</span>,任一结果净赚 <span class="mono" style="color:var(--win)">+${fmt(stake * (1 / m - 1))}</span>`;
}

// ================= events: clicks =================
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-act]");
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; editId = null; render(); return; }
  const act = t.dataset.act, id = t.dataset.id;
  const form = t.closest("[data-form]");
  if (t.dataset.f2 === "range") { range = t.dataset.rv; render(); return; }
  if (act === "clear-filter") { e.preventDefault(); fs = { q: "", status: "all", sport: "all", book: "all", strategy: "all", from: "", to: "", sort: "date-desc", page: 0 }; render(); }
  if (act === "page-prev") { fs.page = Math.max(0, fs.page - 1); render(); }
  if (act === "page-next") { fs.page++; render(); }
  if (act === "confirm-save") {
    const b = { ...readForm(form), id: uid() };
    if (!validBet(b)) return alert("请填写对阵、赔率和本金");
    state.bets = [b, ...state.bets]; saveBets();
    state.drafts = state.drafts.filter((d) => d.id !== id); saveDrafts();
    chrome.storage.local.set({ lastError: "" });
  }
  if (act === "confirm-drop") { state.drafts = state.drafts.filter((d) => d.id !== id); saveDrafts(); render(); }
  if (act === "add-save") {
    const b = { ...readForm(form), id: uid() };
    if (!validBet(b)) return alert("请填写对阵、赔率和本金");
    state.bets = [b, ...state.bets]; saveBets(); tab = "list"; render();
  }
  if (act === "edit") { editId = id; render(); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }
  if (act === "edit-cancel") { editId = null; render(); }
  if (act === "edit-save") {
    const nb = { ...readForm(form), id };
    state.bets = state.bets.map((x) => (x.id === id ? { ...x, ...nb } : x)); saveBets(); editId = null; render();
  }
  if (act === "cycle") {
    const order = ["pending", "win", "loss", "halfwin", "halfloss", "void"];
    state.bets = state.bets.map((x) => x.id === id ? { ...x, status: order[(order.indexOf(x.status) + 1) % 4] } : x);
    saveBets(); render();
  }
  if (act === "del") { if (confirm("删除这条注单?此操作不可恢复。")) { state.bets = state.bets.filter((x) => x.id !== id); saveBets(); render(); } }
  if (act === "save-bankroll") {
    state.bankroll = +$("#bankrollInput").value || 0;
    chrome.storage.local.set({ bankroll: state.bankroll });
    $("#keyMsg") && ($("#keyMsg").textContent = "已保存。"); render();
  }
  if (act === "save-key") {
    const v = $("#apiKeyInput").value.trim();
    chrome.storage.local.set({ apiKey: v }); state.apiKey = v;
    $("#keyMsg").textContent = v ? "已保存。" : "已清除。";
  }
  if (act === "set-engine") { state.engine = id; chrome.storage.local.set({ engine: id }); render(); }
  if (act === "save-ollama") {
    state.ollamaUrl = $("#ollamaUrlInput").value.trim() || "http://localhost:11434";
    state.ollamaModel = $("#ollamaModelInput").value.trim() || "qwen2.5vl:7b";
    chrome.storage.local.set({ ollamaUrl: state.ollamaUrl, ollamaModel: state.ollamaModel });
    $("#keyMsg").textContent = "已保存。";
  }
  if (act === "test-ollama") {
    const url = ($("#ollamaUrlInput").value.trim() || "http://localhost:11434").replace(/\/+$/, "");
    const model = $("#ollamaModelInput").value.trim() || "qwen2.5vl:7b";
    $("#keyMsg").textContent = "正在连接 " + url + " …";
    fetch(url + "/api/tags").then(async (r) => {
      if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 403 ? "(需设置 OLLAMA_ORIGINS,见上方说明)" : ""));
      const d = await r.json();
      const names = (d.models || []).map((m) => m.name);
      $("#keyMsg").textContent = names.includes(model)
        ? `连接成功,模型 ${model} 已就绪。`
        : `连接成功,但未找到模型 ${model}。已安装:${names.join("、") || "无"}。请先执行 ollama pull ${model}`;
    }).catch((err) => {
      $("#keyMsg").textContent = "连接失败:" + err.message + "。请确认 Ollama 正在运行且已设置 OLLAMA_ORIGINS。";
    });
  }
  if (act === "save-custom") {
    state.customBase = $("#customBaseInput").value.trim().replace(/\/+$/, "") || "https://aistudio.baidu.com/llm/lmapi/v3";
    state.customKey = $("#customKeyInput").value.trim();
    state.customModel = $("#customModelInput").value.trim() || "ernie-4.5-turbo-vl-32k";
    chrome.storage.local.set({ customBase: state.customBase, customKey: state.customKey, customModel: state.customModel });
    $("#keyMsg").textContent = "已保存。";
  }
  if (act === "test-custom") {
    const base = ($("#customBaseInput").value.trim() || "https://aistudio.baidu.com/llm/lmapi/v3").replace(/\/+$/, "");
    const key = $("#customKeyInput").value.trim();
    const model = $("#customModelInput").value.trim() || "ernie-4.5-turbo-vl-32k";
    if (!key) { $("#keyMsg").textContent = "请先填写 API Key。"; return; }
    $("#keyMsg").textContent = "正在测试 " + base + " …";
    fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "回复:OK" }] }),
    }).then(async (r) => {
      if (r.status === 401 || r.status === 403) throw new Error("鉴权失败(" + r.status + "),请检查 Key");
      if (r.status === 404) throw new Error("接口或模型不存在(404),检查 Base URL 与模型名");
      if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 120));
      $("#keyMsg").textContent = "连接成功,模型 " + model + " 可用。注意:文本连通不代表该模型支持图片,请确认选的是视觉(VL)模型。";
    }).catch((err) => { $("#keyMsg").textContent = "测试失败:" + err.message; });
  }
  if (act === "save-paddle") {
    state.paddleUrl = $("#paddleUrlInput").value.trim();
    state.paddleToken = $("#paddleTokenInput").value.trim();
    state.paddleModel = $("#paddleModelInput").value.trim() || "PaddleOCR-VL-1.6";
    chrome.storage.local.set({ paddleUrl: state.paddleUrl, paddleToken: state.paddleToken, paddleModel: state.paddleModel });
    $("#keyMsg").textContent = state.paddleUrl && state.paddleToken ? "已保存。" : "已保存,但服务地址和访问令牌都填上才能用。";
  }
  if (act === "test-paddle") {
    const token = $("#paddleTokenInput").value.trim();
    const model = $("#paddleStructModelInput").value.trim() || "ernie-3.5-8k";
    if (!token) { $("#keyMsg").textContent = "请先填写访问令牌。"; return; }
    $("#keyMsg").textContent = "正在验证令牌…";
    fetch("https://aistudio.baidu.com/llm/lmapi/v3/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ model, max_completion_tokens: 2, messages: [{ role: "user", content: "OK" }] }),
    }).then(async (r) => {
      if (r.status === 401 || r.status === 403) throw new Error("鉴权失败(" + r.status + "),请检查令牌");
      if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 120));
      $("#keyMsg").textContent = "令牌有效,结构化模型 " + model + " 可用。OCR 服务地址是否正确要框选一次才能验证。";
    }).catch((err) => { $("#keyMsg").textContent = "测试失败:" + err.message; });
  }
  if (act === "csv") exportCsv();
  if (act === "backup") backupJson();
  if (act === "import") $("#importFile").click();
  if (act === "wipe") {
    if (confirm("确定清空所有注单和待确认草稿?此操作不可恢复,建议先备份 JSON。")) {
      state.bets = []; state.drafts = [];
      chrome.storage.local.set({ bets: [], drafts: [], lastError: "" }); render();
    }
  }
});

// ================= import / export =================
function exportCsv() {
  const src = tab === "list" ? filteredBets() : state.bets;
  const head = "日期,运动,赛事,玩法,平台,策略,赔率,本金,支付额,状态,净盈亏,备注\n";
  const rows = src.map((b) =>
    [b.date, b.sport, b.event, b.market, b.sportsbook, b.strategy, b.odds, b.stake, b.payout,
     S[b.status]?.[0] || b.status, b.status === "pending" ? "" : pnl(b).toFixed(2), b.note]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + head + rows], { type: "text/csv;charset=utf-8" }));
  chrome.downloads.download({ url, filename: `betledger-${new Date().toISOString().slice(0, 10)}.csv` });
}
function backupJson() {
  const data = { app: "betledger", version: 3, exportedAt: new Date().toISOString(),
    bets: state.bets, bankroll: state.bankroll,
    engine: state.engine, ollamaUrl: state.ollamaUrl, ollamaModel: state.ollamaModel };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  chrome.downloads.download({ url, filename: `betledger-backup-${new Date().toISOString().slice(0, 10)}.json` });
}
function handleImport(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const incoming = Array.isArray(d) ? d : d.bets;
      if (!Array.isArray(incoming)) throw new Error("文件里找不到注单数组");
      const replace = confirm(`备份含 ${incoming.length} 注。「确定」= 覆盖当前数据,「取消」= 按 ID 合并去重。`);
      if (replace) state.bets = incoming;
      else {
        const have = new Set(state.bets.map((b) => b.id));
        state.bets = [...state.bets, ...incoming.filter((b) => !have.has(b.id))];
      }
      if (d.bankroll) { state.bankroll = +d.bankroll || 0; chrome.storage.local.set({ bankroll: state.bankroll }); }
      saveBets(); render();
      alert("导入完成,当前共 " + state.bets.length + " 注。");
    } catch (err) { alert("导入失败:" + err.message); }
  };
  r.readAsText(file);
}

load();
