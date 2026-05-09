import { execSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_DATE = process.env.TARGET_DATE || new Date().toISOString().split("T")[0];

const SEARCH_QUERIES = [
  {
    name: "broad",
    query: '("late-life depression"[tiab] OR "late life depression"[tiab] OR "geriatric depression"[tiab] OR "old-age depression"[tiab] OR (depress*[tiab] AND ("older adults"[tiab] OR elderly[tiab] OR geriatric*[tiab])))',
  },
  {
    name: "vascular",
    query: '("vascular depression"[tiab] OR "depression-executive dysfunction syndrome"[tiab]) AND (neuroimaging[tiab] OR MRI[tiab] OR "white matter hyperintensit*"[tiab])',
  },
  {
    name: "suicide",
    query: '(depress*[tiab] OR "late-life depression"[tiab]) AND (suicide[tiab] OR suicid*[tiab] OR "self-harm"[tiab]) AND ("older adults"[tiab] OR elderly[tiab] OR geriatric*[tiab])',
  },
  {
    name: "treatment",
    query: '("late-life depression"[tiab] OR "geriatric depression"[tiab]) AND (antidepressant*[tiab] OR psychotherapy[tiab] OR CBT[tiab] OR ECT[tiab] OR rTMS[tiab] OR ketamine[tiab] OR exercise[tiab])',
  },
  {
    name: "social",
    query: '("depressive symptoms"[tiab] OR depression[tiab]) AND ("older adults"[tiab] OR elderly[tiab] OR geriatric*[tiab]) AND (loneliness[tiab] OR "social isolation"[tiab] OR bereavement[tiab] OR caregiving[tiab])',
  },
  {
    name: "taiwan",
    query: '("late-life depression"[tiab] OR "geriatric depression"[tiab] OR (depress*[tiab] AND ("older adults"[tiab] OR elderly[tiab] OR geriatric*[tiab]))) AND (Taiwan[tiab] OR Taiwanese[tiab])',
  },
  {
    name: "dementia",
    query: '("late-life depression"[tiab] OR "geriatric depression"[tiab]) AND (dementia[tiab] OR "mild cognitive impairment"[tiab] OR MCI[tiab] OR "cognitive impairment"[tiab] OR apathy[tiab])',
  },
  {
    name: "neuroscience",
    query: '("late-life depression"[tiab] OR "geriatric depression"[tiab]) AND (neuroimaging[tiab] OR fMRI[tiab] OR DTI[tiab] OR inflammation[tiab] OR cytokine*[tiab] OR hippocamp*[tiab])',
  },
];

const SEVEN_DAYS_AGO = new Date();
SEVEN_DAYS_AGO.setDate(SEVEN_DAYS_AGO.getDate() - 7);
const SINCE_DATE = SEVEN_DAYS_AGO.toISOString().split("T")[0];

const BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function fetchJson(url) {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = execSync(`curl -sL --max-time 60 "${url}"`, {
        encoding: "utf-8",
        timeout: 90000,
      });
      return JSON.parse(result);
    } catch (e) {
      console.error(`Retry ${i + 1}/${maxRetries} for ${url}: ${e.message}`);
      if (i === maxRetries - 1) return null;
    }
  }
  return null;
}

function fetchPaperDetails(pmids) {
  if (!pmids.length) return [];
  const chunks = [];
  for (let i = 0; i < pmids.length; i += 50) {
    chunks.push(pmids.slice(i, i + 50));
  }

  const papers = [];
  for (const chunk of chunks) {
    const idList = chunk.join(",");
    const url = `${BASE_URL}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(idList)}&rettype=xml&retmode=xml`;
    try {
      const xml = execSync(`curl -sL --max-time 60 "${url}"`, {
        encoding: "utf-8",
        timeout: 90000,
      });
      const articles = parsePubmedXml(xml);
      papers.push(...articles);
    } catch (e) {
      console.error(`Failed to fetch details: ${e.message}`);
    }
  }
  return papers;
}

function parsePubmedXml(xml) {
  const articles = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    try {
      const pmid = extractTag(block, "PMID") || "";
      const title = extractTag(block, "ArticleTitle") || "No title";
      const abstract = extractAbstract(block);
      const journal = extractTag(block, "Title") || "";
      const pubDate = extractPubDate(block);
      const authors = extractAuthors(block);
      const doi = extractDoi(block);
      const keywords = extractMeshTerms(block);

      articles.push({
        pmid,
        title: cleanText(title),
        abstract: cleanText(abstract),
        journal,
        pubDate,
        authors,
        doi,
        keywords,
      });
    } catch (e) {
      console.error(`Failed to parse article: ${e.message}`);
    }
  }
  return articles;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, " ").trim() : "";
}

function extractAbstract(xml) {
  const re = /<Abstract>([\s\S]*?)<\/Abstract>/i;
  const m = xml.match(re);
  if (!m) return "";
  return m[1]
    .replace(/<\/?AbstractText[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPubDate(xml) {
  const re = /<PubDate>([\s\S]*?)<\/PubDate>/i;
  const m = xml.match(re);
  if (!m) return "";
  const y = extractTag(m[1], "Year");
  const mo = extractTag(m[1], "Month");
  const d = extractTag(m[1], "Day");
  return `${y}-${mo || "01"}-${d || "01"}`.trim();
}

function extractAuthors(xml) {
  const authors = [];
  const re = /<Author[^>]*>([\s\S]*?)<\/Author>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const ln = extractTag(m[1], "LastName");
    const ini = extractTag(m[1], "Initials");
    if (ln) authors.push(`${ln} ${ini}`);
  }
  return authors.slice(0, 5).join(", ") + (authors.length > 5 ? " et al." : "");
}

function extractDoi(xml) {
  const re = /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/i;
  const m = xml.match(re);
  return m ? m[1] : "";
}

function extractMeshTerms(xml) {
  const terms = [];
  const re = /<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    terms.push(m[1]);
  }
  return [...new Set(terms)].slice(0, 10);
}

function cleanText(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x0D;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getExistingPmids() {
  const summaryPath = join(process.cwd(), "docs", "summary-pmids.json");
  if (existsSync(summaryPath)) {
    try {
      return new Set(JSON.parse(readFileSync(summaryPath, "utf-8")));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveExistingPmids(pmids) {
  const summaryPath = join(process.cwd(), "docs", "summary-pmids.json");
  const existing = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, "utf-8"))
    : [];
  const merged = [...new Set([...existing, ...pmids])];
  writeFileSync(summaryPath, JSON.stringify(merged, null, 0));
}

async function main() {
  console.log(`Fetching papers since ${SINCE_DATE}...`);

  const allPmids = new Set();
  const apiKey = process.env.PUBMED_API_KEY || "";

  for (const sq of SEARCH_QUERIES) {
    const filter = `AND ("${SINCE_DATE}"[Date - Publication] : "3000"[Date - Publication])`;
    const fullQuery = `${sq.query} ${filter}`;
    const searchUrl = `${BASE_URL}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(fullQuery)}&retmax=100&retmode=json&sort=relevance${apiKey ? `&api_key=${apiKey}` : ""}`;

    console.log(`\nSearching: ${sq.name}...`);
    const data = fetchJson(searchUrl);
    if (data?.esearchresult?.idlist) {
      data.esearchresult.idlist.forEach((id) => allPmids.add(id));
      console.log(`  Found ${data.esearchresult.idlist.length} PMIDs`);
    } else {
      console.log(`  No results or error`);
    }
  }

  console.log(`\nTotal unique PMIDs: ${allPmids.size}`);

  const existingPmids = getExistingPmids();
  const newPmids = [...allPmids].filter((id) => !existingPmids.has(id));
  console.log(`Already summarized: ${existingPmids.size}, New: ${newPmids.length}`);

  if (newPmids.length === 0) {
    console.log("No new papers to summarize.");
    writeFileSync("papers.json", JSON.stringify({ date: TARGET_DATE, count: 0, papers: [] }));
    return;
  }

  const limitedPmids = newPmids.slice(0, 60);
  console.log(`Fetching details for ${limitedPmids.length} papers...`);

  const papers = fetchPaperDetails(limitedPmids);
  console.log(`Got details for ${papers.length} papers`);

  papers.sort((a, b) => (b.pubDate > a.pubDate ? 1 : -1));

  const result = {
    date: TARGET_DATE,
    since: SINCE_DATE,
    count: papers.length,
    pmids: limitedPmids,
    papers,
  };

  writeFileSync("papers.json", JSON.stringify(result));
  saveExistingPmids(limitedPmids);
  console.log(`Saved papers.json with ${papers.length} papers`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
