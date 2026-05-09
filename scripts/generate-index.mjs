import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DOCS_DIR = join(process.cwd(), "docs");
const SITE_NAME = "老年憂鬱症文獻日報";
const SITE_SUBTITLE = "老年憂鬱症研究文獻每日自動更新";

const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];

function getDateInfo(filename) {
  const match = filename.match(/geriatric-(\d{4}-\d{2}-\d{2})\.html/);
  if (!match) return null;
  const dateStr = match[1];
  const d = new Date(dateStr + "T00:00:00");
  return {
    dateStr,
    display: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    weekDay: `週${WEEK_DAYS[d.getDay()]}`,
  };
}

function generateIndex() {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

  const files = readdirSync(DOCS_DIR)
    .filter((f) => f.match(/^geriatric-\d{4}-\d{2}-\d{2}\.html$/))
    .sort()
    .reverse();

  const entries = files.map((f) => getDateInfo(f)).filter(Boolean);

  const listHtml = entries
    .map(
      (e) =>
        `<li><a href="geriatric-${e.dateStr}.html">📅 ${e.display}（${e.weekDay}）</a></li>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${SITE_NAME} · 每日自動更新</title>
<meta name="description" content="老年憂鬱症文獻日報，每日自動從 PubMed 搜尋並以 AI 分析最新老年憂鬱症研究"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 16px; }
  .description { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.7; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .links-section { margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--line); }
  .link-card { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; text-decoration: none; color: var(--text); transition: all 0.2s; margin-bottom: 8px; font-size: 14px; }
  .link-card:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .link-icon { font-size: 20px; }
  .link-text { flex: 1; font-weight: 600; }
  .link-arrow { color: var(--accent); font-weight: 700; }
  footer { margin-top: 56px; text-align: center; font-size: 12px; color: var(--muted); }
  footer a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">👴</div>
  <h1>老年憂鬱症文獻日報</h1>
  <p class="subtitle">Geriatric Depression Daily · 每日自動更新</p>
  <p class="description">每日自動從 PubMed 搜尋老年憂鬱症（Late-Life Depression / Geriatric Depression）最新研究文獻，由 Zhipu AI 進行分析總結與分類。</p>
  <p class="count">共 ${entries.length} 期日報</p>
  <ul>${listHtml}</ul>
  <div class="links-section">
    <a href="https://www.leepsyclinic.com/" class="link-card" target="_blank" rel="noopener">
      <span class="link-icon">🏥</span>
      <span class="link-text">李政洋身心診所首頁</span>
      <span class="link-arrow">→</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="link-card" target="_blank" rel="noopener">
      <span class="link-icon">📬</span>
      <span class="link-text">訂閱電子報</span>
      <span class="link-arrow">→</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="link-card" target="_blank" rel="noopener">
      <span class="link-icon">☕</span>
      <span class="link-text">Buy Me a Coffee</span>
      <span class="link-arrow">→</span>
    </a>
  </div>
  <footer>
    <p>Powered by PubMed + Zhipu AI · <a href="https://github.com/u8901006/elder-depression">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;

  writeFileSync(join(DOCS_DIR, "index.html"), html);
  console.log(`Generated index.html with ${entries.length} entries`);
}

generateIndex();
