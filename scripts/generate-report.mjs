import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const API_BASE = "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions";
const MODELS = ["GLM-5-Turbo"];
const TIMEOUT_MS = 480_000;
const MAX_TOKENS = 16384;

const TARGET_DATE = process.env.TARGET_DATE || new Date().toISOString().split("T")[0];
const API_KEY = process.env.ZHIPU_API_KEY;

if (!API_KEY) {
  console.error("ZHIPU_API_KEY is not set");
  process.exit(1);
}

function safeParseJson(text) {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const jsonStr = cleaned.substring(start, end + 1);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error(`JSON parse failed: ${e.message}`);
    console.error(`Raw text (first 500): ${text.substring(0, 500)}`);
    return null;
  }
}

async function callZhipuAI(prompt, modelIndex = 0) {
  if (modelIndex >= MODELS.length) {
    throw new Error("All models exhausted");
  }
  const model = MODELS[modelIndex];
  console.log(`Calling ${model}...`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是一位老年精神醫學與老年憂鬱症研究領域的專家。你的任務是閱讀英文文獻資料，用繁體中文進行專業總結、分類，並以嚴格的 JSON 格式輸出結果。所有輸出必須使用繁體中文。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
        top_p: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`${model} API error ${response.status}: ${errText.substring(0, 200)}`);
      console.log(`Falling back to next model...`);
      return callZhipuAI(prompt, modelIndex + 1);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error(`${model}: Empty response, trying next model...`);
      return callZhipuAI(prompt, modelIndex + 1);
    }
    return content;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      console.error(`${model}: Timeout after ${TIMEOUT_MS / 1000}s`);
    } else {
      console.error(`${model}: ${e.message}`);
    }
    console.log(`Falling back to next model...`);
    return callZhipuAI(prompt, modelIndex + 1);
  }
}

function buildPrompt(papers) {
  const paperList = papers
    .map(
      (p, i) => `[${i + 1}] PMID:${p.pmid}
Title: ${p.title}
Journal: ${p.journal}
Authors: ${p.authors}
Date: ${p.pubDate}
Abstract: ${(p.abstract || "No abstract available").substring(0, 600)}`
    )
    .join("\n\n");

  return `以下是今天從 PubMed 搜尋到的老年憂鬱症相關文獻。請仔細閱讀所有文獻，然後進行總結和分類。

---
${paperList}
---

請以嚴格的 JSON 格式回應（不要用 markdown code block 包裹），格式如下：

{
  "date": "${TARGET_DATE}",
  "trend_summary": "今日文獻趨勢的繁體中文總結（3-5句話）",
  "top_picks": [
    {
      "rank": 1,
      "emoji": "🔬",
      "title_zh": "繁體中文標題",
      "title_en": "${papers[0]?.title || ""}",
      "journal": "期刊名",
      "summary": "繁體中文摘要（80-150字）",
      "utility": "高實用性",
      "utility_class": "high",
      "pico": {"P": "","I": "","C": "","O": ""},
      "tags": ["標籤1", "標籤2"],
      "pmid": "${papers[0]?.pmid || ""}"
    }
  ],
  "other_notable": [
    {
      "emoji": "📚",
      "title_zh": "繁體中文標題",
      "title_en": "",
      "journal": "",
      "summary": "簡短摘要（50-100字）",
      "utility": "中實用性",
      "utility_class": "mid",
      "tags": [],
      "pmid": ""
    }
  ],
  "topic_distribution": {
    "老年憂鬱症": 0,
    "血管性憂鬱": 0,
    "失智症與認知": 0,
    "自殺防治": 0,
    "藥物治療": 0,
    "心理治療": 0,
    "神經科學": 0,
    "社會孤立與孤獨": 0,
    "長期照護": 0,
    "台灣研究": 0,
    "神經調節治療": 0,
    "運動與生活型態": 0,
    "篩檢與評估": 0,
    "照護者負擔": 0,
    "多重共病": 0
  },
  "keywords": ["關鍵字1", "關鍵字2"]
}

重要規則：
1. 所有文字必須使用繁體中文
2. top_picks 選出最重要的 3-5 篇（utility_class 為 "high" 或 "mid"）
3. other_notable 放其餘值得關注的文獻
4. emoji 從以下選擇：🔬 🧠 🔥 🌟 💊 💡 📊 🏥 👴 👩‍⚕️ 🎯 ⚡
5. topic_distribution 的數字加總應等於文獻總數
6. 每篇文獻的 tags 提供 3-4 個
7. utility_class 只能是 "high", "mid", "low"
8. utility 對應為 "高實用性", "中實用性", "低實用性"
9. 輸出純 JSON，不要用 \`\`\`json\`\`\` 包裹`;
}

function generateHtml(data) {
  const topPicksHtml = (data.top_picks || [])
    .map(
      (p) => `
        <div class="news-card featured">
          <div class="card-header">
            <span class="rank-badge">#${p.rank || 1}</span>
            <span class="emoji-icon">${p.emoji || "🔬"}</span>
            <span class="utility-${p.utility_class || "mid"}">${p.utility || "中實用性"}</span>
          </div>
          <h3>${escapeHtml(p.title_zh || p.title_en || "")}</h3>
          <p class="journal-source">${escapeHtml(p.journal || "")} &middot; ${escapeHtml(p.title_en || "").substring(0, 100)}</p>
          <p>${escapeHtml(p.summary || "")}</p>
          ${
            p.pico
              ? `<div class="pico-grid">
              <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${escapeHtml(p.pico.P || "")}</span></div>
              <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${escapeHtml(p.pico.I || "")}</span></div>
              <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${escapeHtml(p.pico.C || "")}</span></div>
              <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${escapeHtml(p.pico.O || "")}</span></div>
            </div>`
              : ""
          }
          <div class="card-footer">
            ${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
            ${p.pmid ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" target="_blank">閱讀原文 →</a>` : ""}
          </div>
        </div>`
    )
    .join("");

  const otherHtml = (data.other_notable || [])
    .map(
      (p) => `
        <div class="news-card">
          <div class="card-header-row">
            <span class="emoji-sm">${p.emoji || "📚"}</span>
            <span class="utility-${p.utility_class || "mid"} utility-sm">${(p.utility || "中實用性").charAt(0)}</span>
          </div>
          <h3>${escapeHtml(p.title_zh || p.title_en || "")}</h3>
          <p class="journal-source">${escapeHtml(p.journal || "")}</p>
          <p>${escapeHtml(p.summary || "")}</p>
          <div class="card-footer">
            ${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
            ${p.pmid ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" target="_blank">PubMed →</a>` : ""}
          </div>
        </div>`
    )
    .join("");

  const maxCount = Math.max(
    1,
    ...Object.values(data.topic_distribution || {}).map(Number)
  );
  const topicHtml = Object.entries(data.topic_distribution || {})
    .map(
      ([name, count]) => `
            <div class="topic-row">
              <span class="topic-name">${escapeHtml(name)}</span>
              <div class="topic-bar-bg"><div class="topic-bar" style="width:${(Number(count) / maxCount) * 100}%"></div></div>
              <span class="topic-count">${count}</span>
            </div>`
    )
    .join("");

  const keywordsHtml = (data.keywords || [])
    .map((k) => `<span class="keyword">${escapeHtml(k)}</span>`)
    .join("");

  const totalPapers =
    (data.top_picks?.length || 0) + (data.other_notable?.length || 0);

  const dateObj = new Date(TARGET_DATE);
  const dateStr = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const weekDay = `週${weekDays[dateObj.getDay()]}`;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>老年憂鬱症文獻日報 &middot; ${dateStr}</title>
<meta name="description" content="${dateStr} 老年憂鬱症文獻日報，由 AI 自動彙整 PubMed 最新論文"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(140,79,43,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(140,79,43,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(61,36,15,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(61,36,15,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff7f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(118,100,83,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding: 12px; background: rgba(255,253,249,0.8); border-radius: 14px; border: 1px solid var(--line); }
  .pico-item { display: flex; gap: 8px; align-items: baseline; }
  .pico-label { font-size: 10px; font-weight: 700; color: #fff7f0; background: var(--accent); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
  .pico-text { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(140,79,43,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 120px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .clinic-banner { margin-top: 48px; animation: fadeUp 0.5s ease 0.4s both; }
  .clinic-link { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(61,36,15,0.04); margin-bottom: 12px; }
  .clinic-link:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .clinic-icon { font-size: 28px; flex-shrink: 0; }
  .clinic-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .clinic-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  .footer-links { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } .pico-grid { grid-template-columns: 1fr; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 80px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">👴</div>
    <div class="header-text">
      <h1>老年憂鬱症文獻日報</h1>
      <div class="header-meta">
        <span class="badge badge-date">📅 ${dateStr}（${weekDay}）</span>
        <span class="badge badge-count">📊 ${totalPapers} 篇文獻</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>📋 今日文獻趨勢</h2>
    <p class="summary-text">${escapeHtml(data.trend_summary || "今日無新文獻。")}</p>
  </div>

  ${topPicksHtml ? `<div class="section"><div class="section-title"><span class="section-icon">⭐</span>今日精選 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${otherHtml ? `<div class="section"><div class="section-title"><span class="section-icon">📚</span>其他值得關注的文獻</div>${otherHtml}</div>` : ""}

  <div class="topic-section section"><div class="section-title"><span class="section-icon">📊</span>主題分佈</div>${topicHtml}</div>

  <div class="keywords-section section"><div class="section-title"><span class="section-icon">🏷️</span>關鍵字</div><div class="keywords">${keywordsHtml}</div></div>

  <div class="clinic-banner footer-links">
    <a href="https://www.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">
      <span class="clinic-icon">🏥</span>
      <span class="clinic-name">李政洋身心診所首頁</span>
      <span class="clinic-arrow">→</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">
      <span class="clinic-icon">📬</span>
      <span class="clinic-name">訂閱電子報</span>
      <span class="clinic-arrow">→</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="clinic-link" target="_blank" rel="noopener">
      <span class="clinic-icon">☕</span>
      <span class="clinic-name">Buy Me a Coffee</span>
      <span class="clinic-arrow">→</span>
    </a>
  </div>

  <footer>
    <span>資料來源：PubMed &middot; 分析模型：${MODELS[0]}</span>
    <span><a href="https://github.com/u8901006/elder-depression">GitHub</a> &middot; <a href="index.html">回首頁</a></span>
  </footer>
</div>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function main() {
  const papersPath = join(process.cwd(), "papers.json");
  if (!existsSync(papersPath)) {
    console.error("papers.json not found");
    process.exit(1);
  }

  const papersData = JSON.parse(readFileSync(papersPath, "utf-8"));
  if (!papersData.papers?.length) {
    console.log("No papers to process");
    process.exit(0);
  }

  console.log(`Processing ${papersData.papers.length} papers with AI...`);
  const prompt = buildPrompt(papersData.papers);
  const aiResponse = await callZhipuAI(prompt, 0);

  if (!aiResponse) {
    console.error("AI returned empty response after all retries");
    process.exit(1);
  }

  const parsed = safeParseJson(aiResponse);
  if (!parsed) {
    console.error("Failed to parse AI response as JSON");
    console.log("Attempting repair...");
    const fallback = buildFallbackData(papersData.papers);
    const html = generateHtml(fallback);
    const docsDir = join(process.cwd(), "docs");
    if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, `geriatric-${TARGET_DATE}.html`), html);
    console.log(`Generated fallback report: geriatric-${TARGET_DATE}.html`);
    return;
  }

  const html = generateHtml(parsed);
  const docsDir = join(process.cwd(), "docs");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, `geriatric-${TARGET_DATE}.html`), html);
  console.log(`Generated report: geriatric-${TARGET_DATE}.html`);
}

function buildFallbackData(papersData) {
  const papers = papersData.papers || [];
  const topPicks = papers.slice(0, 5).map((p, i) => ({
    rank: i + 1,
    emoji: "🔬",
    title_zh: p.title,
    title_en: p.title,
    journal: p.journal,
    summary: (p.abstract || "").substring(0, 200),
    utility: "中實用性",
    utility_class: "mid",
    pico: { P: "", I: "", C: "", O: "" },
    tags: p.keywords?.slice(0, 4) || ["老年憂鬱"],
    pmid: p.pmid,
  }));

  const otherNotable = papers.slice(5).map((p) => ({
    emoji: "📚",
    title_zh: p.title,
    title_en: p.title,
    journal: p.journal,
    summary: (p.abstract || "").substring(0, 150),
    utility: "低實用性",
    utility_class: "low",
    tags: p.keywords?.slice(0, 3) || ["老年憂鬱"],
    pmid: p.pmid,
  }));

  return {
    date: TARGET_DATE,
    trend_summary: `今日共收錄 ${papers.length} 篇老年憂鬱症相關文獻。`,
    top_picks: topPicks,
    other_notable: otherNotable,
    topic_distribution: { 老年憂鬱症: papers.length },
    keywords: ["老年憂鬱症", "late-life depression", "geriatric depression"],
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
