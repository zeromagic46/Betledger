// betledger background service worker
// 截图 → 裁剪 → 解析引擎(云端 Claude / 本地 Ollama)→ 存草稿

const DASH = chrome.runtime.getURL("dashboard.html");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "start-capture") {
    startCapture().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.type === "area-selected") {
    handleArea(msg, sender.tab).catch((e) =>
      chrome.storage.local.set({ parsing: false, lastError: "截取失败:" + String(e.message || e) }));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "open-dashboard") {
    chrome.tabs.create({ url: DASH });
    sendResponse({ ok: true });
    return false;
  }
});

async function startCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return { error: "无法在当前页面截取,请切换到目标网站标签页。" };
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["selector.js"] });
  return { ok: true };
}

async function handleArea(msg, tab) {
  const { rect, dpr } = msg;
  await new Promise((r) => setTimeout(r, 120));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bmp.width - sx, Math.round(rect.w * dpr));
  const sh = Math.min(bmp.height - sy, Math.round(rect.h * dpr));
  if (sw < 10 || sh < 10) throw new Error("框选区域太小");
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const cropBlob = await canvas.convertToBlob({ type: "image/png" });
  const b64 = await blobToBase64(cropBlob);

  // 生成缩略图存入草稿,便于入库前对照原注单
  const tScale = Math.min(1, 560 / sw);
  const tc = new OffscreenCanvas(Math.round(sw * tScale), Math.round(sh * tScale));
  tc.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, tc.width, tc.height);
  const thumbBlob = await tc.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const thumb = "data:image/jpeg;base64," + (await blobToBase64(thumbBlob));

  const cfg = await chrome.storage.local.get(["engine", "apiKey", "ollamaUrl", "ollamaModel", "customBase", "customKey", "customModel", "paddleUrl", "paddleToken", "paddleStructModel", "paddleModel"]);
  const engine = cfg.engine || "claude";

  if (engine === "claude" && !cfg.apiKey) {
    await chrome.storage.local.set({ lastError: "尚未配置 API Key,请在「设置」填写,或切换其他解析引擎。" });
    chrome.tabs.create({ url: DASH + "#settings" });
    return;
  }
  if (engine === "custom" && !cfg.customKey) {
    await chrome.storage.local.set({ lastError: "尚未配置自定义 API Key,请在「设置」填写。" });
    chrome.tabs.create({ url: DASH + "#settings" });
    return;
  }
  if (engine === "paddleocr" && (!cfg.paddleUrl || !cfg.paddleToken)) {
    await chrome.storage.local.set({ lastError: "尚未配置 PaddleOCR 服务地址或访问令牌,请在「设置」填写。" });
    chrome.tabs.create({ url: DASH + "#settings" });
    return;
  }

  await chrome.storage.local.set({ parsing: true, lastError: "" });
  chrome.tabs.create({ url: DASH + "#confirm" });

  try {
    const raw = engine === "ollama" ? await callOllama(cfg, b64)
      : engine === "custom" ? await callOpenAICompat(cfg, b64)
      : engine === "paddleocr" ? await callPaddleOCR(cfg, b64)
      : await callClaude(cfg.apiKey, b64);
    const bets = normalize(raw);
    if (!bets.length) throw new Error("未识别到任何投注,请框选更完整的注单区域");
    const { drafts = [] } = await chrome.storage.local.get("drafts");
    await chrome.storage.local.set({ drafts: [...bets.map((b) => ({ ...b, img: thumb })), ...drafts], parsing: false });
  } catch (e) {
    await chrome.storage.local.set({
      parsing: false,
      lastError: (engine === "ollama" ? "本地 Ollama 解析失败:" : engine === "custom" ? "自定义 API 解析失败:" : engine === "paddleocr" ? "PaddleOCR 解析失败:" : "AI 解析失败:") + String(e.message || e),
    });
  }
}

// ---------- 共用提示词与结果规范化 ----------
function buildPrompt() {
  return `这是一张体育投注注单截图,可能包含一注或多注(网格/列表排列)。请逐注提取,只输出 JSON 数组,不要任何解释文字或 Markdown 代码块。每个元素格式:
{"date":"YYYY-MM-DD","sport":"运动(中文:足球/篮球/网球等)","event":"对阵(主队 vs 客队)","market":"玩法及选项","odds":欧赔小数,"stake":投注额数字,"payout":支付额数字,"sportsbook":"平台名","status":"pending/win/loss/halfwin/halfloss/void"}
识别规则:
- 每张卡片是一注,分别提取,不要合并不同卡片。
- 玩法通常在卡片顶部,如"高于1.5"→大球1.5、"低于2.5"→小球2.5、"胜平负-主胜"等。
- odds 取"赔率"后的数字;stake 取"投注额"的整数部分;美式赔率换算成欧赔,港赔加1。
- 【重要】务必提取"支付额"的数字到 payout 字段(注单底部"支付额"后的数字,取整数部分);"投注额"到 stake。盈亏将用 payout-stake 计算,所以这两个金额必须准确。
- 状态 status 按角标文字判断:"胜/赢/已兑现"=win,"负/输/亏损"=loss,"赢一半"=halfwin,"输一半"=halfloss,"无效/走水/退款"=void,未结算=pending。
- sportsbook 如 Stake、Bet365 等平台名。
- 日期如"7月06日"→当年补全为 YYYY-07-06;缺失用 ${new Date().toISOString().slice(0, 10)}。
- 识别不到的字段:文本用空字符串,odds/stake 用 null。`;
}

function extractJson(text) {
  let clean = String(text).replace(/```json|```/g, "").trim();
  // 本地小模型偶尔会带前后废话,截取第一个 [ 到最后一个 ]
  const a = clean.indexOf("["), b = clean.lastIndexOf("]");
  if (a !== -1 && b > a) clean = clean.slice(a, b + 1);
  return JSON.parse(clean);
}

function normalize(arr) {
  const today = new Date().toISOString().slice(0, 10);
  return (Array.isArray(arr) ? arr : [arr])
    .filter((b) => b && (b.event || b.market || b.odds))
    .map((b) => ({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: b.date || today,
      sport: b.sport || "",
      event: b.event || "",
      market: b.market || "",
      odds: b.odds ?? "",
      stake: b.stake ?? "",
      payout: b.payout ?? "",
      sportsbook: b.sportsbook || "",
      status: ["win", "loss", "void", "halfwin", "halfloss"].includes(b.status) ? b.status : "pending",
    }));
}

// ---------- 云端 Claude ----------
async function callClaude(apiKey, base64Png) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64Png } },
          { type: "text", text: buildPrompt() },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = (data.content || []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
  return extractJson(text);
}

// ---------- PaddleOCR-VL 异步任务:提交 job → 轮询 → 取 jsonl → 文本模型结构化 ----------
async function callPaddleOCR(cfg, base64Png) {
  const jobUrl = (cfg.paddleUrl || "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs").trim().replace(/\/+$/, "");
  const token = cfg.paddleToken;
  const model = cfg.paddleModel || "PaddleOCR-VL-1.6";

  // base64 → Blob 走 multipart 上传
  const bin = atob(base64Png);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const form = new FormData();
  form.append("model", model);
  form.append("optionalPayload", JSON.stringify({
    useDocOrientationClassify: false, useDocUnwarping: false, useChartRecognition: false,
  }));
  form.append("file", new Blob([bytes], { type: "image/png" }), "slip.png");

  // 1) 提交任务
  const sub = await fetch(jobUrl, {
    method: "POST",
    headers: { "Authorization": "bearer " + token },
    body: form,
  });
  if (sub.status === 401 || sub.status === 403) throw new Error("OCR 鉴权失败(" + sub.status + "),请检查访问令牌");
  if (!sub.ok) throw new Error("提交任务失败 HTTP " + sub.status + ": " + (await sub.text()).slice(0, 200));
  const subJson = await sub.json();
  const jobId = subJson.data && subJson.data.jobId;
  if (!jobId) throw new Error("未拿到 jobId:" + JSON.stringify(subJson).slice(0, 150));

  // 2) 轮询(最多约 60 秒)
  let jsonlUrl = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const pr = await fetch(jobUrl + "/" + jobId, { headers: { "Authorization": "bearer " + token } });
    if (!pr.ok) throw new Error("查询任务失败 HTTP " + pr.status);
    const pj = await pr.json();
    const state = pj.data && pj.data.state;
    if (state === "done") { jsonlUrl = pj.data.resultUrl && pj.data.resultUrl.jsonUrl; break; }
    if (state === "failed") throw new Error("OCR 任务失败:" + (pj.data && pj.data.errorMsg || "未知原因"));
  }
  if (!jsonlUrl) throw new Error("OCR 处理超时,请重试或换用其他引擎");

  // 3) 下载 jsonl,拼接所有页 markdown
  const jr = await fetch(jsonlUrl);
  if (!jr.ok) throw new Error("下载结果失败 HTTP " + jr.status);
  const lines = (await jr.text()).trim().split("\n").filter(Boolean);
  let mdText = "";
  for (const line of lines) {
    try {
      const res = JSON.parse(line).result;
      for (const r of (res.layoutParsingResults || [])) {
        mdText += ((r.markdown && r.markdown.text) || "") + "\n";
      }
    } catch (e) {}
  }
  mdText = mdText.trim();
  if (!mdText) throw new Error("OCR 未识别到文字,请框选更清晰完整的注单区域");

  // 4) 本地规则解析(不调大模型):先切分多注,再逐条解析
  const bets = parseSlips(mdText);
  if (!bets.length) throw new Error("识别到文本但未能解析出投注,请核对或手动录入。OCR原文:" + mdText.slice(0, 120));
  return bets;
}

// 从 OCR 文本规则解析注单:支持整页多注,按"支付额/派彩"行切分
function parseSlips(md) {
  const lines = md.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);

  // 以每条注单的结束标志切段:含"支付额"或"派彩"或"退还"的行作为一段的收尾
  const segments = [];
  let cur = [];
  for (const l of lines) {
    cur.push(l);
    if (/(支付额|派彩金额|派彩|已支付|退还金额)/.test(l)) {
      segments.push(cur); cur = [];
    }
  }
  if (cur.length) segments.push(cur); // 收尾残余(可能是没有支付额行的未结算注单)

  // 若完全没切出多段(单注或无结束标志),整体当一段
  const chunks = segments.length ? segments : [lines];
  const bets = [];
  for (const seg of chunks) {
    const b = parseOneSlip(seg);
    if (b) bets.push(b);
  }
  return bets;
}

// 解析单条注单(输入为该注单的文本行数组)
function parseOneSlip(raw) {
  const joined = raw.join("\n");
  const today = new Date().toISOString().slice(0, 10);

  const oddsM = joined.match(/赔率\s*([0-9]+\.[0-9]+)/) || joined.match(/@\s*([0-9]+\.[0-9]+)/);
  const odds = oddsM ? parseFloat(oddsM[1]) : "";

  const stakeM = joined.match(/投注额\s*([0-9]+(?:\.[0-9]+)?)/) || joined.match(/本金\s*([0-9]+(?:\.[0-9]+)?)/);
  const stake = stakeM ? Math.round(parseFloat(stakeM[1]) * 100) / 100 : "";

  const payM = joined.match(/(?:支付额|派彩金额|派彩|已支付)\s*([0-9]+(?:\.[0-9]+)?)/);
  const pay = payM ? parseFloat(payM[1]) : null;
  let status = "pending";
  if (/亏损|输|lost|lose/i.test(joined)) status = "loss";
  else if (/盈利|赢|won|win/i.test(joined) || (pay !== null && pay > 0)) status = "win";
  else if (pay !== null && pay === 0) status = "loss"; // 结算了且派彩为0 → 输

  const bookM = joined.match(/\b(Stake|Bet365|Pinnacle|1xBet|Betfair|DraftKings|FanDuel|William\s*Hill|皇冠|沙巴|BB体育)\b/i);
  const sportsbook = bookM ? bookM[1] : "";

  let date = today;
  const dM = joined.match(/([0-9]{1,2})月([0-9]{1,2})日/);
  const dM2 = joined.match(/(20[0-9]{2})[-\/.]([0-9]{1,2})[-\/.]([0-9]{1,2})/);
  if (dM2) date = `${dM2[1]}-${dM2[2].padStart(2, "0")}-${dM2[3].padStart(2, "0")}`;
  else if (dM) date = `${today.slice(0, 4)}-${dM[1].padStart(2, "0")}-${dM[2].padStart(2, "0")}`;

  let market = "";
  const ouM = joined.match(/(高于|低于|大于|小于)\s*([0-9]+(?:\.[0-9]+)?)/);
  if (ouM) market = (ouM[1] === "高于" || ouM[1] === "大于" ? "大球 " : "小球 ") + ouM[2];
  const mkLine = raw.find((l) => /(大小球|让球|胜平负|独赢|角球|入球|半场|全场|独中|单双)/.test(l));
  if (mkLine) market = (market ? market + " · " : "") + mkLine;

  const isTeamLine = (l) =>
    l.length <= 20 &&
    !/[0-9]/.test(l.replace(/\d+$/, "")) &&
    !/(赔率|投注额|支付额|派彩|合计|分钟|补时|周[一二三四五六日]|高于|低于|大于|小于|大小球|让球|胜平负|角球|亏损|盈利|Stake|Bet365)/i.test(l) &&
    !/^[0-9:：]+$/.test(l);
  const teams = [];
  for (const l of raw) {
    const name = l.replace(/\s*\d+\s*$/, "").trim();
    if (isTeamLine(l) && name && name.length >= 2) teams.push(name);
    if (teams.length >= 2) break;
  }
  const event = teams.length >= 2 ? teams[0] + " vs " + teams[1] : (teams[0] || "");

  const sport = /(篮球|NBA|CBA)/i.test(joined) ? "篮球" : /(网球|ATP|WTA)/i.test(joined) ? "网球" : "足球";

  if (!event && !odds && !stake) return null;
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date, sport, event, market, odds, stake, sportsbook, status,
  };
}



// ---------- OpenAI 兼容 API(百度千帆 / 通义 / 智谱 / SiliconFlow 等) ----------
async function callOpenAICompat(cfg, base64Png) {
  const base = (cfg.customBase || "https://aistudio.baidu.com/llm/lmapi/v3").replace(/\/+$/, "");
  const model = cfg.customModel || "ernie-4.5-turbo-vl-32k";
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.customKey },
    body: JSON.stringify({
      model,
      temperature: 0.01,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64," + base64Png } },
          { type: "text", text: buildPrompt() },
        ],
      }],
    }),
  });
  if (resp.status === 401 || resp.status === 403) throw new Error("鉴权失败(" + resp.status + "),请检查 API Key 是否正确、是否已开通该模型");
  if (resp.status === 404) throw new Error("接口或模型不存在(404),请检查 Base URL 与模型名(当前:" + model + ")");
  if (!resp.ok) throw new Error("HTTP " + resp.status + ": " + (await resp.text()).slice(0, 200));
  const data = await resp.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  let text = "";
  if (typeof (msg && msg.content) === "string") text = msg.content;
  else if (Array.isArray(msg && msg.content)) text = msg.content.map((c) => c.text || "").join("\n");
  if (!text) throw new Error("接口未返回内容:" + JSON.stringify(data).slice(0, 150));
  return extractJson(text);
}

// ---------- 本地 Ollama ----------
async function callOllama(cfg, base64Png) {
  const url = (cfg.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
  const model = cfg.ollamaModel || "qwen2.5vl:7b";
  let resp;
  try {
    resp = await fetch(url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0 },
        messages: [{ role: "user", content: buildPrompt(), images: [base64Png] }],
      }),
    });
  } catch (e) {
    throw new Error("无法连接 " + url + ",请确认 Ollama 已启动且设置了 OLLAMA_ORIGINS(见设置页说明)");
  }
  if (resp.status === 403) throw new Error("Ollama 拒绝了跨域请求,请设置环境变量 OLLAMA_ORIGINS=* 后重启 Ollama");
  if (resp.status === 404) throw new Error(`模型 ${model} 不存在,请先执行 ollama pull ${model}`);
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return extractJson(data.message && data.message.content || "");
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  });
}
