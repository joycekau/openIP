#!/usr/bin/env node
/**
 * Auto-SEO generator (reusable across CoraX products).
 *
 * Reads ./seo.config.mjs and regenerates the site's machine-facing SEO surface:
 *   • public/sitemap.xml   — rolling <lastmod> on "fresh" pages (recrawl signal)
 *   • public/robots.txt    — search + AI answer-engine allow-list
 *   • public/llms.txt      — the AI-answer-engine brief (ChatGPT/Claude/Perplexity…)
 *   • index.html           — the SEO:AUTO:KEYWORDS and SEO:AUTO:FAQ marker regions
 *
 * "Auto-improves over time" without an LLM in the loop: the keyword, FAQ and
 * spotlight pools are ROTATED by ISO week, so each scheduled run surfaces a fresh
 * window of long-tail terms and Q&A. Deterministic — same week + same config in,
 * same bytes out — so CI only commits when the week (or the config) actually moves.
 *
 * Usage:  node scripts/generate-seo.mjs        (also wired into `npm run build`)
 *         node scripts/generate-seo.mjs --check (exit 1 if anything is stale — for CI)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SEO } from "./seo.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PUBLIC = join(ROOT, "web");
const CHECK = process.argv.includes("--check");

// --- date / rotation helpers ------------------------------------------------
const now = new Date();

/** ISO-8601 week number — the deterministic clock that drives rotation. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
const WEEK = isoWeek(now);

/** Monday (UTC) of the current ISO week. Stamping generated files with this —
 *  instead of the wall-clock day — keeps sitemap <lastmod> and llms.txt stable
 *  for the whole week, so `--check` only flags staleness when the rotation
 *  window (or config) actually changes, matching the weekly contract. */
function isoWeekMonday(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  return t.toISOString().slice(0, 10);
}
const today = isoWeekMonday(now); // YYYY-MM-DD, stable within the ISO week

/** Take `size` items from `arr` starting at a week-shifted offset, wrapping. */
function rotateWindow(arr, offset, size) {
  if (arr.length === 0 || size <= 0) return [];
  const n = Math.min(size, arr.length);
  const start = ((offset % arr.length) + arr.length) % arr.length;
  return Array.from({ length: n }, (_, i) => arr[(start + i) % arr.length]);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- builders ---------------------------------------------------------------
function buildSitemap() {
  const urls = SEO.pages
    .map((p) => {
      const loc = `${SEO.site.origin}${p.path}`;
      const lastmod = p.fresh ? `\n    <lastmod>${today}</lastmod>` : "";
      return `  <url>\n    <loc>${esc(loc)}</loc>${lastmod}\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildRobots() {
  const { disallow = [], aiBots = [] } = SEO.robots || {};
  const lines = [
    `# ${SEO.site.name} — ${SEO.site.origin}`,
    "# Search engines and AI answer engines are welcome to crawl the public site.",
    "",
    "User-agent: *",
    "Allow: /",
    "# Keep private / app-only areas out of the index.",
    ...disallow.map((d) => `Disallow: ${d}`),
    "",
    "# --- AI search / answer-engine crawlers (explicitly allowed) ---",
  ];
  // Each named bot forms its own group and does NOT inherit the "*" group's
  // rules (robots.txt groups are not merged), so repeat the disallows here —
  // otherwise these crawlers would be free to fetch the private paths above.
  for (const bot of aiBots) {
    lines.push(`User-agent: ${bot}`, "Allow: /");
    for (const d of disallow) lines.push(`Disallow: ${d}`);
    lines.push("");
  }
  lines.push(`Sitemap: ${SEO.site.origin}/sitemap.xml`, "");
  return lines.join("\n");
}

function buildLlms() {
  const spotlight = rotateWindow(SEO.faq.rotating, WEEK, 2);
  const L = [];
  L.push(`# ${SEO.site.name}`, "");
  L.push(`> ${SEO.site.summary}`, "");
  L.push(`${SEO.site.name} (also called the ${SEO.site.alternateName}) lives at ${SEO.site.origin} and is part of the CoraX ecosystem.`, "");
  L.push("## Common questions");
  for (const f of SEO.faq.core) L.push(`- ${f.q} ${f.a}`);
  L.push("");
  if (spotlight.length) {
    L.push(`## In focus this week`);
    for (const f of spotlight) L.push(`- ${f.q} ${f.a}`);
    L.push("");
  }
  L.push("## Key pages");
  for (const p of SEO.keyPages) L.push(`- ${p.label}: ${p.url}`);
  L.push("");
  L.push("## The CoraX ecosystem");
  for (const a of SEO.ecosystem) L.push(`- ${a.name} — ${a.tag}: ${a.url}`);
  L.push("");
  L.push(`_Last refreshed ${today} (week ${WEEK}). Generated by scripts/generate-seo.mjs._`, "");
  return L.join("\n");
}

function buildKeywords() {
  const terms = [...SEO.keywords.primary, ...rotateWindow(SEO.keywords.longTail, WEEK, SEO.keywords.windowSize)];
  return [...new Set(terms)].join(", ");
}

function buildFaqJsonLd() {
  const entries = [...SEO.faq.core, ...rotateWindow(SEO.faq.rotating, WEEK, SEO.faq.windowSize)];
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return JSON.stringify(obj, null, 2);
}

/** Replace the content between `<!-- SEO:AUTO:<name>:START ... -->` and `:END`. */
function replaceRegion(html, name, inner) {
  const start = html.indexOf(`SEO:AUTO:${name}:START`);
  const end = html.indexOf(`SEO:AUTO:${name}:END`);
  if (start === -1 || end === -1) {
    throw new Error(`index.html missing SEO:AUTO:${name} markers`);
  }
  const startClose = html.indexOf("-->", start) + 3;
  const endOpen = html.lastIndexOf("<!--", end);
  return html.slice(0, startClose) + "\n" + inner + "\n    " + html.slice(endOpen);
}

// --- write / check ----------------------------------------------------------
const outputs = [];
outputs.push([join(PUBLIC, "sitemap.xml"), buildSitemap()]);
outputs.push([join(PUBLIC, "robots.txt"), buildRobots()]);
outputs.push([join(PUBLIC, "llms.txt"), buildLlms()]);

const indexPath = join(PUBLIC, "home.html");
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, "utf8");
  const keywordsMeta = `    <meta\n      name="keywords"\n      content="${buildKeywords()}"\n    />`;
  const faqScript = `    <script type="application/ld+json">\n${buildFaqJsonLd().split("\n").map((l) => "      " + l).join("\n")}\n    </script>`;
  html = replaceRegion(html, "KEYWORDS", keywordsMeta);
  html = replaceRegion(html, "FAQ", faqScript);
  outputs.push([indexPath, html]);
}

let changed = 0;
for (const [path, content] of outputs) {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev === content) continue;
  changed++;
  if (CHECK) {
    console.error(`stale: ${path.replace(ROOT + "/", "")}`);
  } else {
    writeFileSync(path, content);
    console.log(`updated: ${path.replace(ROOT + "/", "")}`);
  }
}

if (CHECK && changed) {
  console.error(`\n${changed} SEO file(s) stale — run: node scripts/generate-seo.mjs`);
  process.exit(1);
}
console.log(`SEO generation complete (week ${WEEK}, ${today}) — ${changed} file(s) ${CHECK ? "stale" : "changed"}.`);
