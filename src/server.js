// OpenIP launchpad — zero-dependency Node HTTP service.
//   GET  /                       -> the launchpad UI (home)
//   GET  /terminal /launch /coin /admin -> the other pages
//   GET  /api/markets|trending   -> live Solana meme markets (aggregated)
//   GET  /api/board              -> verified OpenIP launches
//   POST /api/launch             -> record a token launch (wallet-first)
//   POST /webhooks/helius        -> ingest Helius enhanced SWAP txs for tracked KOL wallets
//
// Scope: this service is JUST the token launchpad. The creator community + AI creation + commerce
// (the old .ai side) now live in corax.live; OpenIP embeds into a corax channel via SSO + API
// (see the reserved `coraxCreatorId` on each launch record).
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getBoostedSolanaAddresses, getPairsForTokens } from "./sources/dexscreener.js";
import { bestPairPerToken, normalize } from "./normalize.js";
import { buildKolBoard, getKolDetail } from "./kol/track.js";
import { enrich, getSecurity } from "./security.js";
import * as helius from "./sources/helius.js";
import * as store from "./store.js";
import * as launchpad from "./launchpad.js";
import * as oauth from "./oauth.js";
import * as sso from "./sso.js";
import * as coraxdb from "./coraxdb.js";
import { loadJson, saveJson, saveJsonNow } from "./persist.js";
import * as walletStore from "./wallets.js";
import { discoverWallets } from "./discover.js";
import * as ipfs from "./ipfs.js";
import * as markets from "./sources/markets.js";
import * as social from "./social.js";
import * as ai from "./ai.js";
import * as aigen from "./aigen.js";
import * as publish from "./publish.js";
import * as accounts from "./accounts.js";
import * as shopSource from "./commerce/source.js";
import * as orders from "./commerce/orders.js";
import * as treasury from "./commerce/treasury.js";
import * as buyback from "./commerce/buyback.js";
import * as payments from "./commerce/payments.js";
import * as reactions from "./commerce/reactions.js";
import * as agents from "./commerce/agents.js";

const __dir = dirname(fileURLToPath(import.meta.url));
// On a persistent host / locally, web/ + data/ sit one level up from src/. On Vercel the function
// bundle places includeFiles at the project cwd, so prefer cwd when the web/ folder is there.
const ROOT = existsSync(join(process.cwd(), "web", "home.html")) ? process.cwd() : join(__dir, "..");
const PORT = Number(process.env.PORT) || 8787;

// Fail closed: if ADMIN_TOKEN is unset in a deployed env, the admin API is DISABLED entirely
// (no public "admin" fallback). Set ADMIN_TOKEN to enable /admin. Local dev sets it via .env.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
let trendingCache = { ts: 0, data: [] };

// cached aggregated meme markets (全网 SOL Meme) — refreshed every 45s
const mCache = { all: { ts: 0, data: [] }, new: { ts: 0, data: [] }, pump: { ts: 0, data: [] } };
async function getMarkets(kind) {
  const c = mCache[kind] || mCache.all;
  if (Date.now() - c.ts < 45_000 && c.data.length) return c.data;
  const data = kind === "new" ? await markets.getNewMemes(40)
    : kind === "pump" ? await markets.getPumpMemes(50)
    : await markets.getAllMemes(60);
  if (data.length) mCache[kind] = { ts: Date.now(), data };
  return data;
}

async function getTrending() {
  if (Date.now() - trendingCache.ts < 30_000 && trendingCache.data.length) return trendingCache.data;
  const addrs = await getBoostedSolanaAddresses(30);
  const pairs = await getPairsForTokens(addrs);
  const data = bestPairPerToken(pairs)
    .map(normalize)
    .filter((t) => t.liquidity > 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 20);
  await enrich(data, 12);
  trendingCache = { ts: Date.now(), data };
  return data;
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false; // no token configured → admin API is off (deny all)
  return (req.headers["x-admin-token"] || "") === ADMIN_TOKEN;
}

// Session token for creator-owned writes: "Authorization: Bearer <t>", "x-oneip-token", or body.token.
function actorToken(req, body) {
  const a = req.headers["authorization"] || "";
  if (a.startsWith("Bearer ")) return a.slice(7).trim();
  return req.headers["x-oneip-token"] || (body && body.token) || "";
}
// Returns true if the request may act AS `claimedHandle` (registered accounts require their token;
// unregistered handles/wallets stay open for legacy flows). Use to gate creator-authored writes.
function mayActAs(req, claimedHandle, body) {
  return accounts.verifyActor(actorToken(req, body), claimedHandle).ok;
}

const deriveSymbol = (account) => {
  const s = String(account || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  return s.length >= 2 ? s : "IP" + s;
};

// Auto-provision a creator's value-pool token the FIRST time they do anything productive (list a
// product, post, or one-click forward to the platforms). Creates the pool under the SAME account id
// and links it on the creator profile. The pool is off-chain (placeholder mint) until they mint it
// for real via Phantom on /launch; pre-launch revenue escrows to it (see buyback.js). Idempotent.
function ensureValuePool(account) {
  if (!account) return null;
  const c = social.getCreator(account);
  if (c.coin) return c.coin;
  const l = launchpad.create({ name: c.displayName || account, symbol: deriveSymbol(account), creator: account, auto: true });
  social.setCreator(account, { coin: l.mint });
  return l.mint;
}

// When an account mints its value-pool token FOR REAL (Phantom on /launch), migrate everything off
// the auto-provisioned placeholder: relink the account's coin → real mint, re-point its products,
// and flush the escrowed pre-launch 20% into the real coin.
function activateRealToken(account, realMint) {
  if (!account || !realMint) return null;
  const old = social.getCreator(account).coin;
  if (!old || !old.startsWith("Kol") || old === realMint) return null;
  social.setCreator(account, { coin: realMint });
  const repointed = shopSource.repointCreatorCoin(account, old, realMint);
  const flush = buyback.flushEscrow(old, realMint);
  try { launchpad.setMeta(old, { superseded: realMint }); } catch (e) {}
  return { migratedFrom: old, repointed, ...flush };
}

function readBody(req) {
  // Vercel's Node runtime may pre-parse the body onto req.body (draining the stream). Prefer it when
  // present; otherwise read the raw stream (local / Render / plain Node).
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    return Promise.resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  }
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

async function servePage(res, file) {
  const html = await readFile(join(ROOT, "web", file), "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  return res.end(html);
}

// Transak partner access token — exchanged from apiKey + api-secret, valid 7 days (only the latest is
// valid). Cached in memory and refreshed proactively so we don't re-auth on every widget-url request.
let _transakTok = { token: null, exp: 0 };
async function transakAccessToken(env, apiKey, apiSecret) {
  const now = Date.now();
  if (_transakTok.token && now < _transakTok.exp) return _transakTok.token;
  // refresh-token lives on api.transak.com (the gateway 404s it); create-widget-url is on the gateway.
  const base = env === "PRODUCTION" ? "https://api.transak.com" : "https://api-stg.transak.com";
  const r = await fetch(base + "/partners/api/v2/refresh-token", {
    method: "POST",
    headers: { "content-type": "application/json", "api-secret": apiSecret },
    body: JSON.stringify({ apiKey }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j && (j.data?.accessToken || j.accessToken);
  if (!r.ok || !token) throw new Error((j && (j.error?.message || j.message)) || `Transak access token failed (${r.status})`);
  // Token lives 7 days; cache for 6 to stay clear of the boundary.
  _transakTok = { token, exp: now + 6 * 24 * 3600 * 1000 };
  return token;
}

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-admin-token,authorization,x-oneip-token" }); return res.end(); }

    // ---- pages (OpenIP is one brand; every host serves the launchpad) ----
    if (req.method === "GET" && (path === "/" || path === "/home" || path === "/home.html")) return servePage(res, "home.html");
    if (req.method === "GET" && (path === "/terminal" || path === "/index.html")) return servePage(res, "index.html");
    if (req.method === "GET" && (path === "/launch" || path === "/launch.html")) return servePage(res, "launch.html");
    if (req.method === "GET" && (path === "/admin" || path === "/admin.html")) return servePage(res, "admin.html");
    if (req.method === "GET" && (path === "/coin" || path === "/coin.html")) return servePage(res, "coin.html");
    if (req.method === "GET" && (path === "/shop" || path === "/shop.html")) return servePage(res, "shop.html");
    if (req.method === "GET" && (path === "/creators" || path === "/creator" || path === "/creator.html")) return servePage(res, "creator.html");
    if (req.method === "GET" && (path === "/studio" || path === "/studio.html")) return servePage(res, "studio.html");
    if (req.method === "GET" && (path === "/swap" || path === "/swap.html")) return servePage(res, "swap.html");
    if (req.method === "GET" && (path === "/privacy" || path === "/privacy.html")) return servePage(res, "privacy.html");
    if (req.method === "GET" && (path === "/terms" || path === "/terms.html")) return servePage(res, "terms.html");

    // static scripts + brand assets
    if (req.method === "GET" && (path === "/wallet.js" || path === "/i18n.js" || path === "/chain.js" || path === "/header.js" || path === "/thirdweb.js" || path === "/transak.js" || path === "/affiliate-networks.js" || path === "/sw.js")) {
      const js = await readFile(join(ROOT, "web", path.slice(1)), "utf8");
      // sw.js must be allowed root scope; served from "/" so its scope is the whole origin already
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "service-worker-allowed": "/" });
      return res.end(js);
    }
    // PWA manifest
    if (req.method === "GET" && path === "/manifest.webmanifest") {
      const mf = await readFile(join(ROOT, "web", "manifest.webmanifest"), "utf8");
      res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300" });
      return res.end(mf);
    }
    // Public runtime config — the PUBLISHABLE keys only, read from env so they're set once in Vercel
    // (open-ip → Settings → Environment Variables), never committed. The SECRET LIFI_API_KEY is NOT
    // here — it stays server-side in the /api/lifi proxy below.
    if (req.method === "GET" && (path === "/config.js")) {
      // Sanitize the integrator to LI.FI's rules (alphanumeric + . _ -, max 23 chars): strip any
      // protocol/path so an accidental "https://oneip.io" becomes "oneip.io" instead of 400-ing.
      const integrator = (process.env.LIFI_INTEGRATOR || "oneip")
        .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 23) || "oneip";
      const cfg = {
        THIRDWEB_CLIENT_ID: process.env.THIRDWEB_CLIENT_ID || "",
        LIFI_INTEGRATOR: integrator,
        LIFI_FEE: process.env.LIFI_FEE ? Number(process.env.LIFI_FEE) : 0, // e.g. 0.01 = 1% integrator fee
        // MoonPay: FREE to integrate (no subscription) — on-ramp AND off-ramp. Publishable key
        // (pk_test_… = sandbox, pk_live_… = production). Sandbox needs no URL signing.
        MOONPAY_API_KEY: process.env.MOONPAY_API_KEY || "",
        // Transak: fiat on-ramp + off-ramp. Per Transak's mandatory migration, the widget URL is
        // generated server-side (POST /api/transak/widget-url) — the API key + SECRET stay on the
        // server, never in the browser. We only expose an "enabled" flag + the environment so the UI
        // knows whether to show the widget and the staging badge.
        TRANSAK_ENABLED: !!(process.env.TRANSAK_API_KEY && process.env.TRANSAK_API_SECRET),
        TRANSAK_ENVIRONMENT: (process.env.TRANSAK_ENVIRONMENT || "STAGING").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "STAGING",
      };
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=30" });
      return res.end(`window.THIRDWEB_CLIENT_ID=${JSON.stringify(cfg.THIRDWEB_CLIENT_ID)};window.LIFI_INTEGRATOR=${JSON.stringify(cfg.LIFI_INTEGRATOR)};window.LIFI_FEE=${JSON.stringify(cfg.LIFI_FEE)};window.MOONPAY_API_KEY=${JSON.stringify(cfg.MOONPAY_API_KEY)};window.TRANSAK_ENABLED=${JSON.stringify(cfg.TRANSAK_ENABLED)};window.TRANSAK_ENVIRONMENT=${JSON.stringify(cfg.TRANSAK_ENVIRONMENT)};`);
    }
    // Transak fiat on-ramp/off-ramp — server-side widget-URL generation (Transak's MANDATORY
    // migration: query-param widget URLs are deprecated). Flow: apiKey+secret → short-lived partner
    // access token (cached) → POST create-widget-url with widgetParams → return the 5-min widgetUrl.
    // The API key + SECRET never reach the browser; the client only iframes the returned URL.
    if (req.method === "POST" && path === "/api/transak/widget-url") {
      const apiKey = process.env.TRANSAK_API_KEY, apiSecret = process.env.TRANSAK_API_SECRET;
      const env = (process.env.TRANSAK_ENVIRONMENT || "STAGING").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "STAGING";
      if (!apiKey || !apiSecret) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Transak not configured — set TRANSAK_API_KEY and TRANSAK_API_SECRET in Vercel env (open-ip project)" }));
      }
      let inBody = {};
      try { inBody = JSON.parse((await readBody(req)) || "{}"); } catch (_) {}
      // referrerDomain is mandatory; use the calling host (must match a domain whitelisted in the
      // Transak dashboard). Falls back to oneip.io.
      const referrerDomain = String(req.headers.host || "oneip.io").replace(/:\d+$/, "");
      // create-widget-url REQUIRES x-user-ip (end user's IP) + x-api-key headers.
      const userIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "1.1.1.1";
      const widgetParams = { apiKey, referrerDomain, productsAvailed: inBody.productsAvailed === "SELL" ? "SELL" : "BUY" };
      for (const k of ["network", "defaultNetwork", "cryptoCurrencyCode", "walletAddress", "fiatCurrency", "defaultFiatAmount", "cryptoCurrencyList", "themeColor", "colorMode", "hideMenu", "disableWalletAddressForm", "defaultPaymentMethod"]) {
        if (inBody[k] != null && inBody[k] !== "") widgetParams[k] = inBody[k];
      }
      if (!widgetParams.themeColor) widgetParams.themeColor = "A855F7";
      if (!widgetParams.colorMode) widgetParams.colorMode = "DARK";           // oneip.io is a dark UI
      if (widgetParams.hideMenu == null) widgetParams.hideMenu = true;        // cleaner embedded widget
      // Prefilled a wallet? Lock the destination so funds can only reach the user's own address.
      if (widgetParams.walletAddress && widgetParams.disableWalletAddressForm == null) widgetParams.disableWalletAddressForm = true;
      try {
        const token = await transakAccessToken(env, apiKey, apiSecret);
        const gw = env === "PRODUCTION" ? "https://api-gateway.transak.com" : "https://api-gateway-stg.transak.com";
        const r = await fetch(gw + "/api/v2/auth/session", {
          method: "POST",
          // create-widget-url requires x-api-key + access-token + x-user-ip headers.
          headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey, "access-token": token, authorization: `Bearer ${token}`, "x-user-ip": userIp },
          body: JSON.stringify({ widgetParams }),
        });
        const j = await r.json().catch(() => ({}));
        const widgetUrl = j && (j.widgetUrl || (j.data && j.data.widgetUrl));
        if (!r.ok || !widgetUrl) {
          res.writeHead(r.status && r.status >= 400 ? r.status : 502, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: (j && (j.error?.message || j.message)) || "Could not create Transak widget URL" }));
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ widgetUrl }));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: (e && e.message) || "Transak request failed" }));
      }
    }
    // LI.FI API proxy — forwards /api/lifi/<path> → https://li.quest/v1/<path>, injecting the SECRET
    // x-lifi-api-key server-side so it's never exposed to the browser. The widget points its apiUrl
    // here. Higher rate limits + integrator fee attribution ride on the key without leaking it.
    if (path.startsWith("/api/lifi/")) {
      const rest = path.slice("/api/lifi/".length);
      const target = "https://li.quest/v1/" + rest + (url.search || "");
      const headers = { "content-type": "application/json", accept: "application/json" };
      if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
      const init = { method: req.method, headers };
      if (req.method === "POST" || req.method === "PUT") init.body = await readBody(req);
      try {
        const r = await fetch(target, init);
        const body = await r.text();
        res.writeHead(r.status, { "content-type": "application/json", "access-control-allow-origin": "*" });
        return res.end(body);
      } catch (e) {
        return json(res, 502, { error: "lifi proxy failed", detail: String(e && e.message || e) });
      }
    }
    // MoonPay diagnostic — validates MOONPAY_API_KEY and reports whether buy (on-ramp) and sell
    // (off-ramp) are enabled. Uses the publishable key against MoonPay's ip_address endpoint; no
    // secret is exposed. Handy to confirm the widget will work before opening it in a browser.
    if (req.method === "GET" && path === "/api/moonpay/test") {
      const key = process.env.MOONPAY_API_KEY || "";
      if (!key) return json(res, 200, { ok: false, error: "MOONPAY_API_KEY not set" });
      const sandbox = /^pk_test/i.test(key);
      try {
        const r = await fetch("https://api.moonpay.com/v3/ip_address?apiKey=" + encodeURIComponent(key));
        const info = await r.json().catch(() => ({}));
        return json(res, 200, {
          ok: r.status === 200,
          env: sandbox ? "sandbox" : "production",
          keyPrefix: key.slice(0, 12) + "…",
          status: r.status,
          country: info.alpha2 || info.countryCode || info.country || null,
          isAllowed: info.isAllowed,
          isBuyAllowed: info.isBuyAllowed,
          isSellAllowed: info.isSellAllowed,
          raw: info,
        });
      } catch (e) {
        return json(res, 502, { ok: false, error: String((e && e.message) || e) });
      }
    }
    if (req.method === "GET" && path.startsWith("/assets/")) {
      const name = path.slice("/assets/".length);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: "bad asset name" });
      const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", gif: "image/gif" };
      const ext = (name.split(".").pop() || "").toLowerCase();
      try {
        const buf = await readFile(join(ROOT, "web", "assets", name));
        res.writeHead(200, { "content-type": types[ext] || "application/octet-stream", "cache-control": "public, max-age=60" });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end("not found"); }
    }

    // Image upload (token logo). Accepts a base64 data URL (zero-dep). On a persistent host we store
    // it under data/uploads/; on a read-only serverless FS (Vercel) we echo the data URL back so the
    // logo still renders without disk. Pin to IPFS via /api/coin/pin for the permanent on-chain uri.
    if (req.method === "POST" && path === "/api/upload") {
      const raw = await readBody(req);
      if (raw.length > 7_000_000) return json(res, 413, { error: "file too large (max ~5MB)" });
      let b; try { b = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: "bad body" }); }
      const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(b.data || "");
      if (!m) return json(res, 400, { error: "only png / jpg / webp / gif images accepted" });
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 5_000_000) return json(res, 413, { error: "image too large (max 5MB)" });
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const name = "up_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + "." + ext;
      try {
        const dir = join(ROOT, "data", "uploads");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, name), buf);
        return json(res, 200, { url: "/uploads/" + name });
      } catch {
        return json(res, 200, { url: b.data }); // read-only FS → use the data URL directly
      }
    }
    if (req.method === "GET" && path.startsWith("/uploads/")) {
      const name = path.slice("/uploads/".length);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: "bad name" });
      const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
      const ext = (name.split(".").pop() || "").toLowerCase();
      try {
        const buf = await readFile(join(ROOT, "data", "uploads", name));
        res.writeHead(200, { "content-type": types[ext] || "application/octet-stream", "cache-control": "public, max-age=31536000" });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end("not found"); }
    }

    // ---- market data (terminal) ----
    if (req.method === "GET" && path === "/api/trending") return json(res, 200, await getTrending());
    if (req.method === "GET" && path === "/api/markets") return json(res, 200, await getMarkets("all"));
    if (req.method === "GET" && path === "/api/markets/new") return json(res, 200, await getMarkets("new"));
    if (req.method === "GET" && path === "/api/markets/pump") return json(res, 200, await getMarkets("pump"));
    // OpenIP's own launches (verified first)
    if (req.method === "GET" && path === "/api/markets/oneip") {
      const rows = launchpad.all().map((l) => ({
        mint: l.mint, symbol: l.symbol, name: l.name, logo: l.logo || "",
        verified: !!l.verified, floorBps: l.floorBps || 2000, socials: Object.keys(l.socials || {}).length,
        createdAt: l.createdAt || 0,
      })).sort((a, b) => (b.verified - a.verified) || (b.createdAt - a.createdAt));
      return json(res, 200, rows);
    }
    if (req.method === "GET" && path === "/api/kol/leaderboard") return json(res, 200, (await buildKolBoard()).rows);
    if (req.method === "GET" && path === "/api/kol/signals") return json(res, 200, (await buildKolBoard()).signals);
    if (req.method === "GET" && path === "/api/kol/detail") {
      const d = await getKolDetail(url.searchParams.get("w"));
      return d ? json(res, 200, d) : json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && path === "/api/token/security") {
      const mint = url.searchParams.get("mint");
      if (!mint) return json(res, 400, { error: "mint required" });
      return json(res, 200, await getSecurity(mint));
    }
    // Live market data for a creator token (deepest-liquidity Solana pair).
    if (req.method === "GET" && path === "/api/token/price") {
      const mint = url.searchParams.get("mint");
      if (!mint) return json(res, 400, { error: "mint required" });
      let pairs = [];
      try { pairs = await getPairsForTokens([mint]); } catch (e) { pairs = []; }
      if (!pairs.length) return json(res, 200, { priceUsd: null, marketCap: null, change24h: null, volume24h: null });
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const p = pairs[0];
      return json(res, 200, {
        priceUsd: Number(p.priceUsd) || null,
        marketCap: p.marketCap || p.fdv || null,
        change24h: typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
        volume24h: p.volume?.h24 ?? null,
      });
    }

    // ---- launchpad ----
    if (req.method === "GET" && path === "/api/board") return json(res, 200, launchpad.board());

    // ---- creator social layer (posts / follows / comments / likes / profiles) ----
    if (req.method === "GET" && path === "/api/feed") {
      return json(res, 200, social.feed({
        creator: url.searchParams.get("creator") || undefined,
        following: url.searchParams.get("following") || undefined,
        viewer: url.searchParams.get("viewer") || undefined,
        coin: url.searchParams.get("coin") || undefined,
      }));
    }
    if (req.method === "POST" && path === "/api/posts") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        if (!mayActAs(req, b.creator, b)) return json(res, 401, { error: "sign in as this creator to post" });
        // Validate FIRST (content gate throws on a sub-threshold post) so a rejected post never
        // mints a value pool. Only a valid post makes you a creator + auto-provisions the token.
        const post = social.createPost(b);
        if (b.creator) ensureValuePool(b.creator);
        return json(res, 200, post);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/creator") {
      const w = url.searchParams.get("w");
      const viewer = url.searchParams.get("viewer") || undefined;
      if (!w) return json(res, 400, { error: "w required" });
      return json(res, 200, {
        ...social.getCreator(w),
        followers: social.followerCount(w),
        subscribers: social.subscriberCount(w),
        following: viewer ? social.isFollowing(viewer, w) : false,
        subscribed: viewer ? social.isSubscribed(viewer, w) : false,
        posts: social.feed({ creator: w, viewer }),
      });
    }
    if (req.method === "POST" && path === "/api/creator") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.wallet) return json(res, 400, { error: "wallet required" });
      if (!mayActAs(req, b.wallet, b)) return json(res, 401, { error: "sign in as this creator to edit" });
      const patch = {};
      if (b.displayName !== undefined) patch.displayName = b.displayName;
      if (b.bio !== undefined) patch.bio = b.bio;
      if (b.avatar !== undefined) patch.avatar = String(b.avatar).slice(0, 500);
      if (Array.isArray(b.autoReplies)) patch.autoReplies = b.autoReplies;
      if (b.aiEnabled !== undefined) patch.aiEnabled = Boolean(b.aiEnabled);
      if (b.aiPersona !== undefined) patch.aiPersona = String(b.aiPersona).slice(0, 2000);
      return json(res, 200, social.setCreator(b.wallet, patch));
    }
    if (req.method === "POST" && path === "/api/follow") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, social.follow(b.fan, b.creator)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/unfollow") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, social.unfollow(b.fan, b.creator)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/comments") {
      return json(res, 200, social.getComments(url.searchParams.get("post")));
    }
    if (req.method === "POST" && path === "/api/comments") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, await social.addComment(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/like") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, social.like(b.postId, b.fan)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/subscribe") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, social.subscribe(b.fan, b.creator)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/unsubscribe") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, social.unsubscribe(b.fan, b.creator)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/posts/delete") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        if (!mayActAs(req, b.creator, b)) return json(res, 401, { error: "sign in as this creator" });
        return json(res, 200, social.deletePost(b.postId, b.creator));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/notifications") {
      const w = url.searchParams.get("w");
      return json(res, 200, { items: social.getNotifications(w), unread: social.unreadCount(w) });
    }
    if (req.method === "POST" && path === "/api/notifications/read") {
      const b = JSON.parse((await readBody(req)) || "{}");
      social.markRead(b.wallet);
      return json(res, 200, { ok: true });
    }
    // AI drafts a post in the creator's voice (free creator tool). Smart routing: prefers the Cora
    // AI Gateway (gateway.corax.live — the same routing corax.live uses; CORAX_API_KEY), falls back
    // to the direct Claude SDK (ANTHROPIC_API_KEY), else a mock draft so the flow always works.
    if (req.method === "POST" && path === "/api/ai/draft") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.prompt) return json(res, 400, { error: "prompt required" });
      if (aigen.hasAigen()) return json(res, 200, await aigen.generateMaterial({ kind: "post", prompt: b.prompt, creator: b.wallet || "" }));
      const text = b.wallet && ai.hasKey() ? await ai.generatePost(social.getCreator(b.wallet), b.prompt) : null;
      return json(res, 200, text ? { text } : await aigen.generateMaterial({ kind: "post", prompt: b.prompt, creator: b.wallet || "" }));
    }
    // AI MATERIAL generation via the Cora gateway. Lets a creator with no works generate publishable
    // material (post copy / product descriptions / content ideas). kind ∈ post | product | idea.
    if (req.method === "POST" && path === "/api/ai/generate") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.prompt) return json(res, 400, { error: "prompt required" });
      return json(res, 200, await aigen.generateMaterial({ kind: b.kind, prompt: b.prompt, creator: b.creator || b.wallet || "" }));
    }

    // ---- outbound multi-platform publishing (AiToEarn hidden behind these; free creator tool).
    // Identity = `account` (the oneIP handle) or legacy `wallet`. Connect → returns OAuth URL.
    if (req.method === "POST" && path === "/api/publish/connect") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const acct = b.account || b.wallet;
      if (!acct || !b.platform) return json(res, 400, { error: "account and platform required" });
      try { return json(res, 200, await publish.connectStart(b.platform, acct)); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Poll OAuth completion; on success persist the bound accountId onto the creator.
    if (req.method === "GET" && path === "/api/publish/connect/status") {
      const acct = url.searchParams.get("account") || url.searchParams.get("wallet");
      const platform = url.searchParams.get("platform");
      const sessionId = url.searchParams.get("sessionId");
      if (!acct || !platform || !sessionId) return json(res, 400, { error: "account, platform, sessionId required" });
      try {
        const r = await publish.connectStatus(platform, sessionId);
        if (r.status === "authorized" && r.accountId) {
          const bound = { ...(social.getCreator(acct).publishAccounts || {}), [platform]: r.accountId };
          social.setCreator(acct, { publishAccounts: bound });
        }
        return json(res, 200, r);
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Which platforms this creator has connected (+ their public @handles for fan-facing links).
    if (req.method === "GET" && path === "/api/publish/accounts") {
      const acct = url.searchParams.get("account") || url.searchParams.get("wallet");
      if (!acct) return json(res, 400, { error: "account required" });
      const c = social.getCreator(acct);
      return json(res, 200, { accounts: c.publishAccounts || {}, socials: c.socials || {} });
    }
    // Disconnect a platform (creator-owned write).
    if (req.method === "POST" && path === "/api/publish/disconnect") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const acct = b.account || b.wallet;
      if (!acct || !b.platform) return json(res, 400, { error: "account and platform required" });
      if (!mayActAs(req, acct, b)) return json(res, 401, { error: "sign in as this creator" });
      const bound = { ...(social.getCreator(acct).publishAccounts || {}) };
      delete bound[b.platform];
      social.setCreator(acct, { publishAccounts: bound });
      return json(res, 200, { accounts: bound });
    }
    // Set/clear the creator's PUBLIC @handle on a platform → fans can jump to their profile.
    if (req.method === "POST" && path === "/api/publish/handle") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const acct = b.account || b.wallet;
      if (!acct || !b.platform) return json(res, 400, { error: "account and platform required" });
      if (!mayActAs(req, acct, b)) return json(res, 401, { error: "sign in as this creator" });
      const socials = { ...(social.getCreator(acct).socials || {}) };
      const h = String(b.handle || "").trim();
      if (h) socials[b.platform] = h; else delete socials[b.platform];
      social.setCreator(acct, { socials });
      return json(res, 200, { socials });
    }
    // One-click publish to all (or chosen) connected platforms.
    if (req.method === "POST" && path === "/api/publish/now") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const acct = b.account || b.wallet;
      if (!acct || !b.text) return json(res, 400, { error: "account and text required" });
      if (!mayActAs(req, acct, b)) return json(res, 401, { error: "sign in as this creator to publish" });
      const creator = social.getCreator(acct);
      const bound = creator.publishAccounts || {};
      const targets = (b.platforms && b.platforms.length ? b.platforms : Object.keys(bound)).filter((p) => bound[p]);
      if (!targets.length) return json(res, 400, { error: "no connected platforms" });
      const items = targets.map((platform) => ({ platform, accountId: bound[platform] }));
      ensureValuePool(acct); // forwarding to the platforms → auto-create the account's value pool
      try { return json(res, 200, await publish.publish({ text: b.text, mediaUrls: b.mediaUrls || [], items })); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Status of a publish flow.
    if (req.method === "GET" && path === "/api/publish/status") {
      const flowId = url.searchParams.get("flowId");
      if (!flowId) return json(res, 400, { error: "flowId required" });
      try { return json(res, 200, await publish.publishStatus(flowId)); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }

    // ---- commerce closed-loop: fiat storefront -> settle -> floor buyback ----
    // Public: browse + buy (FIAT). Creators curate in the Studio.
    if (req.method === "GET" && path === "/api/shop/products") {
      // activeOnly=false (a creator's own Studio view) includes hidden listings; default hides them.
      const activeOnly = url.searchParams.get("activeOnly") !== "false";
      const list = shopSource.listProducts({ creator: url.searchParams.get("creator") || undefined, coin: url.searchParams.get("coin") || undefined, activeOnly });
      // Attach the creator's display name so the storefront shows a real name, not a raw handle/wallet.
      return json(res, 200, list.map((p) => ({ ...p, creatorName: social.getCreator(p.creator).displayName || p.creator })));
    }
    if (req.method === "GET" && path === "/api/shop/product") {
      const p = shopSource.getProduct(url.searchParams.get("id"));
      return p ? json(res, 200, shopSource.publicProduct(p)) : json(res, 404, { error: "not found" });
    }
    if (req.method === "POST" && path === "/api/shop/product") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!mayActAs(req, b.creator, b)) return json(res, 401, { error: "sign in as this creator to list products" });
      try {
        if (!b.coin && b.creator) b.coin = ensureValuePool(b.creator); // first product → auto-create the account's value pool
        return json(res, 200, shopSource.addProduct(b));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Owner-guarded update (activate/deactivate).
    if (req.method === "POST" && path === "/api/shop/product/active") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const p = shopSource.getProduct(b.id);
      if (!p) return json(res, 404, { error: "product not found" });
      if (p.creator !== b.creator) return json(res, 403, { error: "not your product" });
      if (!mayActAs(req, b.creator, b)) return json(res, 401, { error: "sign in as this creator" });
      try { return json(res, 200, shopSource.publicProduct(shopSource.setProduct(b.id, { active: !!b.active }))); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/shop/order") {
      const o = orders.get(url.searchParams.get("id"));
      return o ? json(res, 200, orders.publicOrder(o)) : json(res, 404, { error: "not found" });
    }
    // Tip (打赏): ad-hoc fiat payment to a creator. 20% of net funds their floor like any sale.
    if (req.method === "POST" && path === "/api/tip") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        const coin = b.coin || ensureValuePool(b.creator);
        const order = orders.createTip({ creator: b.creator, coin, amountCents: b.amountCents, fan: b.fan, currency: b.currency });
        const origin = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        const checkout = await payments.createCheckout(order, origin);
        return json(res, 200, { order: orders.publicOrder(order), checkout });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // ---- paid emoji reactions ("web4 likes") — fan pays per reaction; 5% platform + 20% floor ----
    if (req.method === "GET" && path === "/api/reactions/config") return json(res, 200, reactions.REACTIONS);
    if (req.method === "GET" && path === "/api/reactions") {
      const target = url.searchParams.get("target");
      if (!target) return json(res, 400, { error: "target required" });
      return json(res, 200, { target, counts: reactions.getCounts(target) });
    }
    // React: a fixed-price emoji reaction to a target (product/post/creator). Stripe → checkout
    // (count bumps on webhook); dev → instant settle + bump now.
    if (req.method === "POST" && path === "/api/react") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const r = reactions.byKey(b.key);
      if (!r) return json(res, 400, { error: "unknown reaction" });
      if (!b.target || !b.creator) return json(res, 400, { error: "target and creator required" });
      try {
        const coin = b.coin || ensureValuePool(b.creator); // auto-provision the creator's value pool
        const order = orders.createReaction({ creator: b.creator, coin, amountCents: r.priceCents, emoji: r.emoji, target: b.target, reactionKey: b.key, fan: b.fan });
        if (payments.hasStripe()) {
          const origin = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
          const checkout = await payments.createCheckout(order, origin);
          return json(res, 200, { order: orders.publicOrder(order), checkout, pending: true, counts: reactions.getCounts(b.target) });
        }
        await orders.markPaid(order.id);          // dev: instant settle (tip-like) → 5%/20% applied
        const counts = reactions.bump(b.target, b.key);
        return json(res, 200, { order: orders.publicOrder(orders.get(order.id)), counts });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Public proof for a coin page: total floor added by real sales + each verifiable tx.
    if (req.method === "GET" && path === "/api/shop/proof") {
      const coin = url.searchParams.get("coin");
      if (!coin) return json(res, 400, { error: "coin required" });
      return json(res, 200, buyback.proof(coin));
    }
    // Buy: create the order + a FIAT checkout session (Stripe live, or devMode when unkeyed).
    if (req.method === "POST" && path === "/api/shop/order") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        const order = orders.create({ productId: b.productId, fan: b.fan, address: b.address });
        const origin = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        const checkout = await payments.createCheckout(order, origin);
        return json(res, 200, { order: orders.publicOrder(order), checkout });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Fiat payment cleared (Stripe webhook) -> mark paid -> hand to supplier / instant settle.
    if (req.method === "POST" && path === "/webhooks/shop") {
      const raw = await readBody(req);
      if (!payments.verifyWebhook(raw, req.headers["stripe-signature"])) return json(res, 401, { error: "bad signature" });
      const r = payments.parseWebhook(raw);
      if (r?.paid) {
        try {
          const o = await orders.markPaid(r.orderId);
          if (o && o.type === "reaction" && o.target && o.reactionKey) reactions.bump(o.target, o.reactionKey);
        } catch (e) { console.error("markPaid:", e.message); }
      }
      return json(res, 200, { received: true });
    }
    // Dev-only: simulate a cleared payment when Stripe isn't configured.
    if (req.method === "POST" && path === "/api/shop/dev-paid") {
      if (payments.hasStripe()) return json(res, 400, { error: "use Stripe checkout in production" });
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, orders.publicOrder(await orders.markPaid(b.orderId))); } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- email-first accounts (register with email → handle is your account; bind wallet later) ----
    if (req.method === "POST" && path === "/api/account/register") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        const a = accounts.register(b);
        social.setCreator(a.handle, { email: a.email }); // seed the creator profile under the same handle
        return json(res, 200, a);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/account/login") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, accounts.login(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Forgot password: request a reset link (dev returns devToken; prod emails it). Always 200 (anti-enum).
    if (req.method === "POST" && path === "/api/account/forgot") {
      const b = JSON.parse((await readBody(req)) || "{}");
      return json(res, 200, accounts.requestReset({ id: b.id }));
    }
    // Complete a reset with the token + new password → returns a fresh session (logged in).
    if (req.method === "POST" && path === "/api/account/reset") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, accounts.resetPassword({ token: b.token, password: b.password })); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/account/me") {
      const a = accounts.me(url.searchParams.get("token"));
      return a ? json(res, 200, a) : json(res, 401, { error: "not signed in" });
    }
    // Resolve a connected wallet → its account handle (the handle↔wallet identity link).
    if (req.method === "GET" && path === "/api/account/by-wallet") {
      const a = accounts.byWallet(url.searchParams.get("wallet"));
      return a ? json(res, 200, a) : json(res, 404, { error: "no account bound to this wallet" });
    }
    if (req.method === "POST" && path === "/api/account/logout") {
      const b = JSON.parse((await readBody(req)) || "{}");
      return json(res, 200, accounts.logout(b.token));
    }
    // Bind a Phantom wallet to the account later (ties the on-chain value-pool launch to it).
    if (req.method === "POST" && path === "/api/account/bind-wallet") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, accounts.bindWallet(b.token, b.wallet)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // CoraX SSO session: the corax embed host (/apps/oneip) hands us a short-lived corax-signed
    // RS256 token (#sso_token, minted by corax's sso-issue). Verify it against corax's JWKS and
    // mint a regular oneIP account session — the embedded app is signed in with no extra login.
    // (Distinct from /api/sso/corax, which creates a LISTING; this creates a SESSION.)
    if (req.method === "POST" && path === "/api/sso/corax/session") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      const token = bearer || b.token || "";
      if (!token) return json(res, 400, { error: "corax sso token required" });
      let auth;
      try { auth = await sso.verifyAny(token); }
      catch (e) { return json(res, 401, { error: "invalid corax token: " + e.message }); }
      // Session minting is real auth — unverified (dev-decoded) claims are only accepted in
      // explicit local dev (no secret configured AND not a deployed environment).
      if (!auth.verified && (sso.isConfigured() || process.env.VERCEL || process.env.NODE_ENV === "production")) {
        return json(res, 401, { error: "corax token could not be verified" });
      }
      const who = sso.creatorFromClaims(auth.claims);
      if (!who.coraxCreatorId) return json(res, 400, { error: "token has no identity (sub)" });
      try {
        const a = accounts.loginWithCorax({ coraxId: who.coraxCreatorId, email: auth.claims.email || "", name: who.name });
        // Seed the creator profile only on first creation — never clobber an existing profile.
        if (a.created) social.setCreator(a.handle, { ...(a.email ? { email: a.email } : {}), ...(who.name ? { displayName: who.name } : {}) });
        return json(res, 200, a);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- legacy link-out marketplace (kept for CoraX channel feeds / older records) ----
    if (req.method === "GET" && path === "/api/shop/link-products") {
      const all = await loadJson("products", []);
      return json(res, 200, Array.isArray(all) ? all.filter((p) => p && p.active !== false) : []);
    }
    if (req.method === "GET" && path === "/api/creator/products") {
      const id = url.searchParams.get("id") || "";
      const all = await loadJson("products", []);
      const mine = (Array.isArray(all) ? all : []).filter((p) => p && p.active !== false && (p.creatorId === id || p.coraxCreatorId === id));
      return json(res, 200, mine);
    }
    if (req.method === "POST" && path === "/api/products") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.creatorId || !body.title) return json(res, 400, { error: "creatorId and title required" });
      const all = await loadJson("products", []);
      const list = Array.isArray(all) ? all : [];
      const linkedCh = (await loadJson("links", {}))[body.creatorId] || ""; // auto-stamp their CoraX channel
      const row = {
        id: "prod_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        creatorId: body.creatorId, coraxCreatorId: body.coraxCreatorId || linkedCh,
        title: String(body.title).slice(0, 200), image: body.image || "",
        price: body.price != null ? Number(body.price) : null, currency: body.currency || "USD",
        url: body.url || "", kind: body.kind || "product", syncCorax: !!body.syncCorax,
        active: true, createdAt: Date.now(),
      };
      list.push(row); await saveJsonNow("products", list);
      return json(res, 200, row);
    }
    if (req.method === "POST" && path === "/api/products/remove") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const all = await loadJson("products", []);
      const list = (Array.isArray(all) ? all : []).map((p) =>
        p.id === body.id && p.creatorId === body.creatorId ? { ...p, active: false } : p);
      await saveJsonNow("products", list);
      return json(res, 200, { ok: true });
    }
    // Toggle a single product's CoraX sync (the per-product "Show in CoraX" control, post-create).
    if (req.method === "POST" && path === "/api/products/sync") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const all = await loadJson("products", []);
      const list = (Array.isArray(all) ? all : []).map((p) =>
        p.id === body.id && p.creatorId === body.creatorId ? { ...p, syncCorax: !!body.syncCorax } : p);
      await saveJsonNow("products", list);
      return json(res, 200, { ok: true });
    }

    // ---- CoraX channel link + product-sync feed (Phase 1) ----
    // A creator links their CoraX channel once; we store creatorId -> coraxChannelId and stamp it onto
    // their products/links. Their syncCorax products become the "OneIP picks" feed CoraX pulls (Phase 2).
    if (req.method === "GET" && path === "/api/creator/link") {
      const id = url.searchParams.get("id") || "";
      const links = await loadJson("links", {});
      return json(res, 200, { creatorId: id, coraxChannelId: (links && links[id]) || "" });
    }
    if (req.method === "POST" && path === "/api/creator/link") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = body.creatorId;
      if (!id) return json(res, 400, { error: "creatorId required" });
      // accept a raw channel id or a corax channel/creator URL — extract the id segment
      let ch = String(body.coraxChannelId || "").trim();
      const m = ch.match(/\/(?:channel|oneip\/creator|c)\/([^/?#]+)/i);
      if (m) ch = m[1];
      ch = ch.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120);
      const links = await loadJson("links", {});
      if (ch) links[id] = ch; else delete links[id];
      await saveJsonNow("links", links);
      // backfill coraxCreatorId onto this creator's products + promoted so the feed resolves immediately
      for (const store of ["products", "promoted"]) {
        const arr = await loadJson(store, []);
        const upd = (Array.isArray(arr) ? arr : []).map((p) => (p && p.creatorId === id ? { ...p, coraxCreatorId: ch } : p));
        await saveJsonNow(store, upd);
      }
      return json(res, 200, { creatorId: id, coraxChannelId: ch });
    }

    // ---- CoraX SSO auto-listing: sign up on CoraX → the system lists your token automatically ----
    // The missing trigger behind the reserved `coraxCreatorId` seam. Corax authenticates the creator
    // and hands us its Supabase Auth JWT (Authorization: Bearer <jwt>, or { token } in the body). We
    // verify it, read the creator identity (+ any socials corax already OAuth-verified), and auto-create
    // the launch record the moment the account exists — 20% floor, auto:true. Idempotent: one corax
    // creator ⇒ one auto-listing. If ≥ 3 socials qualify it lands on the verified board immediately;
    // otherwise it's tradable and waits for more socials. The trustless on-chain mint stays a later
    // wallet-signed step — this creates the off-chain listing + metadata seam, not the SPL token.
    if (req.method === "POST" && (path === "/api/creator/onboard" || path === "/api/sso/corax")) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      const token = bearer || body.token || "";
      if (!token) return json(res, 400, { error: "corax auth token required (Authorization: Bearer <jwt>, or { token })" });

      let auth;
      try { auth = await sso.verifyAny(token); } // HS256 Supabase JWT or RS256 sso-issue token
      catch (e) { return json(res, 401, { error: "invalid corax token: " + e.message }); }
      const who = sso.creatorFromClaims(auth.claims);
      if (!who.coraxCreatorId) return json(res, 400, { error: "token has no creator id (sub / creator_id)" });

      // Stable creator key: the real wallet if the account already has one, else a synthetic corax id
      // (wallet-first launches later re-key to the real mint anyway).
      const creator = body.creator || who.wallet || ("corax:" + who.coraxCreatorId);
      const name = (body.name || who.name || who.coraxCreatorId).slice(0, 60);
      const symbol = String(body.symbol || who.symbol || name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "TOKEN";

      // Idempotent: reuse this corax creator's existing auto-listing instead of minting duplicates.
      let l = launchpad.getByCoraxCreator(who.coraxCreatorId);
      const created = !l;
      if (!l) {
        l = launchpad.create({
          name, symbol, creator, coraxCreatorId: who.coraxCreatorId,
          logo: who.logo, website: who.website, twitter: who.twitter, telegram: who.telegram,
          description: who.description, auto: true,
        });
      }

      // Auto-bind the socials corax already OAuth-verified → may flip the listing verified onto the board.
      const socials = Array.isArray(body.socials) && body.socials.length ? body.socials : who.socials;
      for (const s of socials) {
        if (!s || !s.platform) continue;
        try {
          l = launchpad.bindVerifiedSocial(l.mint, {
            platform: s.platform, handle: s.handle, followers: s.followers,
            userId: s.userId, verifiedOwnership: s.verifiedOwnership !== false, mock: !!s.mock,
          });
        } catch { /* skip an unsupported platform, keep binding the rest */ }
      }

      // Stamp creator → CoraX channel so their product/shop feed resolves immediately (same as /api/creator/link).
      if (who.channelId) {
        const links = await loadJson("links", {});
        if (links[creator] !== who.channelId) { links[creator] = who.channelId; await saveJsonNow("links", links); }
      }

      return json(res, 200, { created, tokenVerified: auth.verified, listing: l });
    }

    // ---- Draft → launched: flip the CoraX draft token to launched once minted on-chain ----
    // Closes the loop after the wallet-signed create_token (0.1 SOL launch fee). The creator's draft
    // row in oneip_creator_tokens (placeholder mint 'draft:<uid>', launch_status 'draft') gets the
    // REAL mint address and launch_status 'launched'. creator_id is taken from the verified CoraX JWT
    // when supplied (authoritative — a creator can only launch their OWN row); else from the body (dev).
    // Idempotent (only matches rows still in 'draft'). Also mirrors into the repo's KV launch record so
    // the board/coin pages resolve. If the creator never had a draft (wallet-first), inserts a launched
    // row when name+symbol are provided.
    if (req.method === "POST" && path === "/api/creator/launch-complete") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const mint = String(body.mint || "").trim();
      if (!mint) return json(res, 400, { error: "mint (real Solana mint address) required" });

      let creatorId = body.creatorId || "";
      const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      const token = bearer || body.token || "";
      if (token) {
        try { creatorId = sso.verifyJwt(token).claims.sub || creatorId; }
        catch (e) { return json(res, 401, { error: "invalid corax token: " + e.message }); }
      }
      if (!creatorId) return json(res, 400, { error: "creatorId (or a corax Bearer token) required" });

      // Mirror into the repo KV launch record too (best-effort) so /api/board + coin pages resolve.
      try {
        const existing = launchpad.get(mint);
        if (!existing) launchpad.create({ ...body, mint, coraxCreatorId: creatorId, creator: body.creator || mint, onchain: true, mintTx: body.mintTx || "" });
        else launchpad.setMeta(mint, { onchain: true, mintTx: body.mintTx || existing.mintTx });
      } catch { /* KV mirror is best-effort */ }

      if (!coraxdb.hasCoraxDb()) {
        return json(res, 200, { devMode: true, note: "set SUPABASE_URL + SUPABASE_SERVICE_KEY to update oneip_creator_tokens", creatorId, mint });
      }
      try {
        const updated = await coraxdb.markTokenLaunched({ creatorId, mint, decimals: body.decimals, totalSupply: body.totalSupply });
        if (updated.length) return json(res, 200, { launched: true, updated: updated.length, token: updated[0] });
        // no draft existed → insert a launched row when we have enough to satisfy NOT NULLs
        if (body.name && body.symbol) {
          const ins = await coraxdb.insertLaunchedToken({ creatorId, mint, name: body.name, symbol: body.symbol, decimals: body.decimals, totalSupply: body.totalSupply });
          return json(res, 200, { launched: true, inserted: true, token: ins[0] || null });
        }
        return json(res, 200, { launched: false, updated: 0, note: "no draft token for this creator; pass name+symbol to insert one" });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Public feed CoraX pulls for a channel: the creator's syncCorax products (their "OneIP picks").
    if (req.method === "GET" && path === "/api/channel-products") {
      const ch = url.searchParams.get("corax") || "";
      if (!ch) return json(res, 400, { error: "corax channel id required" });
      const products = await loadJson("products", []);
      const links = await loadJson("links", {});
      const creatorId = Object.keys(links || {}).find((k) => links[k] === ch) || "";
      const launch = launchpad.board().find((l) => l.creator === creatorId || l.coraxCreatorId === ch) || null;
      const items = (Array.isArray(products) ? products : [])
        .filter((p) => p && p.active !== false && p.coraxCreatorId === ch && p.syncCorax === true)
        .map((p) => ({ id: p.id, kind: p.kind, title: p.title, image: p.image, price: p.price, currency: p.currency, url: p.url }));
      // Also surface the creator's on-platform commerce listings (fiat checkout on oneIP).
      if (creatorId) {
        for (const p of shopSource.listProducts({ creator: creatorId })) {
          items.push({ id: p.id, kind: p.type, title: p.title, image: p.image, price: p.priceCents / 100, currency: p.currency, url: "https://oneip.io/shop?p=" + encodeURIComponent(p.id) });
        }
      }
      return json(res, 200, {
        coraxChannelId: ch, creatorId,
        creator: launch ? { name: launch.name, symbol: launch.symbol, mint: launch.mint } : null,
        products: items,
        profileUrl: creatorId ? "https://oneip.io/creator?id=" + encodeURIComponent(creatorId) : "https://oneip.io",
      });
    }

    // ---- affiliate & token-growth ledger ----
    // Model A is non-custodial: creators earn commission off-platform (Shopee/Lazada/AliExpress…),
    // so the split can't be auto-withheld. Instead we track what they earned and nudge them to top
    // up their Solana token pool. Each top-up follows 70% pool / 20% floor / 10% platform.
    // CONTRIB_RATE is the suggested share of commission to route back — used only to size the
    // "growth you skipped" nudge, never enforced.
    const CONTRIB_RATE = 0.20;
    const TOPUP_SPLIT = { pool: 0.70, floor: 0.20, platform: 0.10 };
    // Transparent estimate: turn tracked clicks into an indicative commission. Shown WITH the
    // assumptions so it's honest, not fabricated. Per click ≈ conv × AOV × commission.
    const AFF_EST = { convRate: 0.04, avgOrderUsd: 40, commissionRate: 0.06 };
    const estFromClicks = (clicks) => (Number(clicks) || 0) * AFF_EST.convRate * AFF_EST.avgOrderUsd * AFF_EST.commissionRate;
    const sumClicks = (promoted, id) => (Array.isArray(promoted) ? promoted : [])
      .filter((p) => p && p.active !== false && (p.creatorId === id || p.coraxCreatorId === id))
      .reduce((s, p) => s + (Number(p.clicks) || 0), 0);
    // rec.selfCommission: number = creator's self-reported figure (override); null/undefined = use the
    // click estimate. (Back-compat: an old rec.commissionEarned is treated as a self-report.)
    const affiliateView = (rec, clicks) => {
      const topups = Array.isArray(rec.topups) ? rec.topups : [];
      const contributed = topups.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const estimated = estFromClicks(clicks);
      const selfCommission = rec.selfCommission != null ? Number(rec.selfCommission)
        : (rec.commissionEarned != null ? Number(rec.commissionEarned) : null);
      const usingEstimate = selfCommission == null;
      const commission = usingEstimate ? estimated : selfCommission;
      const recommended = commission * CONTRIB_RATE;
      const missed = Math.max(0, recommended - contributed);
      return {
        clicks: Number(clicks) || 0, estimated, selfCommission, usingEstimate, commission,
        contributed, toPool: contributed * TOPUP_SPLIT.pool, toFloor: contributed * TOPUP_SPLIT.floor,
        toPlatform: contributed * TOPUP_SPLIT.platform, recommended, missed,
        contributionRate: CONTRIB_RATE, split: TOPUP_SPLIT, estAssumptions: AFF_EST, topups,
      };
    };
    if (req.method === "GET" && path === "/api/creator/affiliate") {
      const id = url.searchParams.get("id") || "";
      const all = await loadJson("affiliate", {});
      const clicks = sumClicks(await loadJson("promoted", []), id);
      return json(res, 200, affiliateView((all && all[id]) || {}, clicks));
    }
    if (req.method === "POST" && path === "/api/creator/affiliate/earnings") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = body.creatorId;
      if (!id) return json(res, 400, { error: "creatorId required" });
      const all = await loadJson("affiliate", {});
      const rec = all[id] || { topups: [] };
      if (body.reset === true || body.commissionEarned === null) { rec.selfCommission = null; delete rec.commissionEarned; } // revert to estimate
      else rec.selfCommission = Math.max(0, Number(body.commissionEarned) || 0);
      all[id] = rec; await saveJsonNow("affiliate", all);
      const clicks = sumClicks(await loadJson("promoted", []), id);
      return json(res, 200, affiliateView(rec, clicks));
    }
    if (req.method === "POST" && path === "/api/creator/affiliate/topup") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = body.creatorId;
      const amount = Number(body.amount) || 0;
      if (!id || amount <= 0) return json(res, 400, { error: "creatorId and positive amount required" });
      const all = await loadJson("affiliate", {});
      const rec = all[id] || { topups: [] };
      if (!Array.isArray(rec.topups)) rec.topups = [];
      rec.topups.push({
        amount,
        pool: amount * TOPUP_SPLIT.pool,
        floor: amount * TOPUP_SPLIT.floor,
        platform: amount * TOPUP_SPLIT.platform,
        currency: body.currency || "USDC",
        mint: body.mint || "",
        sig: body.sig || "",              // on-chain signature when paid on Solana
        onchain: !!body.sig,
        ts: Date.now(),
      });
      all[id] = rec; await saveJsonNow("affiliate", all);
      const clicks = sumClicks(await loadJson("promoted", []), id);
      return json(res, 200, affiliateView(rec, clicks));
    }

    // ---- promoted affiliate links (Model A: paste-your-own tracked links) ----
    // Creators generate their OWN tracked link on each network (AliExpress Portals, Shopee/Lazada
    // tool, Amazon SiteStripe, …) and paste it in. oneIP stores/serves it and counts clicks; the
    // network pays the creator directly (non-custodial — oneIP never touches the money). We only
    // validate the pasted URL looks like that network's *tracked* link so a raw product URL can't slip in.
    const AFF_LINK_HOSTS = {
      aliexpress: ["s.click.aliexpress.com", "a.aliexpress.com", "aliexpress.com"],
      shopee: ["shope.ee", "shopee."], lazada: ["lazada.", "c.lazada."],
      amazon: ["amzn.to", "amazon."], tiktok_shop: ["vt.tiktok.com", "shop.tiktok.com", "tiktok.com"],
      rakuten: ["click.linksynergy.com", "rakuten."],
      cj: ["anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "tkqlhce.com", "kqzyfj.com", "cj.com"],
      impact: ["sjv.io", "imp.i", "impact.com"], awin: ["awin1.com", "tidd.ly", "awin.com"],
      shareasale: ["shareasale.com", "shrsl.com"], admitad: ["ad.admitad.com", "admitad.com", "tygbg.com"],
      ebay: ["rover.ebay.com", "ebay.to", "ebay."], clickbank: ["hop.clickbank.net", "clickbank.net"],
    };
    const affUrlValid = (network, u) => {
      const hosts = AFF_LINK_HOSTS[network]; if (!hosts) return true;
      let host = ""; try { host = new URL(u).host.toLowerCase(); } catch { return false; }
      return hosts.some((h) => host.includes(h));
    };
    if (req.method === "GET" && path === "/api/creator/promoted") {
      const id = url.searchParams.get("id") || "";
      const all = await loadJson("promoted", []);
      const mine = (Array.isArray(all) ? all : []).filter((p) => p && p.active !== false && (p.creatorId === id || p.coraxCreatorId === id));
      return json(res, 200, mine);
    }
    if (req.method === "POST" && path === "/api/promoted") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.creatorId || !body.network || !body.url) return json(res, 400, { error: "creatorId, network and url required" });
      if (!/^https?:\/\//i.test(body.url)) return json(res, 400, { error: "url must start with http(s)://" });
      if (!affUrlValid(body.network, body.url)) return json(res, 400, { error: "That doesn't look like a tracked " + body.network + " link — paste the affiliate/deep link, not a raw product URL." });
      const all = await loadJson("promoted", []);
      const list = Array.isArray(all) ? all : [];
      const row = {
        id: "promo_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        creatorId: body.creatorId, coraxCreatorId: body.coraxCreatorId || "",
        network: body.network, url: body.url, title: (body.title || "").slice(0, 200), image: body.image || "",
        clicks: 0, active: true, createdAt: Date.now(),
      };
      list.push(row); await saveJsonNow("promoted", list);
      return json(res, 200, row);
    }
    if (req.method === "POST" && path === "/api/promoted/remove") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const all = await loadJson("promoted", []);
      const list = (Array.isArray(all) ? all : []).map((p) => (p.id === body.id && p.creatorId === body.creatorId ? { ...p, active: false } : p));
      await saveJsonNow("promoted", list);
      return json(res, 200, { ok: true });
    }
    // Click-tracking redirect: count the click, then forward to the creator's real tracked link.
    if (req.method === "GET" && path === "/go") {
      const id = url.searchParams.get("id") || "";
      const all = await loadJson("promoted", []);
      const list = Array.isArray(all) ? all : [];
      const row = list.find((p) => p && p.id === id && p.active !== false);
      if (!row) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("link not found"); }
      row.clicks = (row.clicks || 0) + 1;
      // durable write (not the debounced saveJson) so rapid sequential clicks don't coalesce and lose
      // increments — a few ms before the redirect is fine.
      await saveJsonNow("promoted", list);
      res.writeHead(302, { location: row.url, "cache-control": "no-store" });
      return res.end();
    }

    // A creator's own launches (wallet-first: keyed by the launching wallet/creator id).
    if (req.method === "GET" && path === "/api/creator/launches") {
      const w = url.searchParams.get("w");
      const mine = launchpad.all().filter((l) => l.creator === w).map((l) => ({ mint: l.mint, symbol: l.symbol, name: l.name, verified: l.verified }));
      return json(res, 200, mine);
    }
    if (req.method === "GET" && path === "/api/launch") {
      const l = launchpad.get(url.searchParams.get("mint"));
      return l ? json(res, 200, l) : json(res, 404, { error: "not found" });
    }
    if (req.method === "POST" && path === "/api/launch") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.name || !b.symbol || !b.creator) return json(res, 400, { error: "name, symbol, creator required" });
      // coraxCreatorId is the reserved SSO seam — set when launched from inside a corax.live channel.
      const l = launchpad.create(b);
      // If this real mint belongs to an account that had an auto-pool, migrate + flush escrow.
      if (b.account && b.mint) { const m = activateRealToken(b.account, b.mint); if (m) l.migrated = m; }
      return json(res, 200, l);
    }
    if (req.method === "GET" && path === "/api/coin/metadata") {
      const m = launchpad.tokenMetadataJson(url.searchParams.get("mint"));
      return m ? json(res, 200, m) : json(res, 404, { error: "not found" });
    }
    // Pin logo + standard metadata JSON to IPFS for a freshly-generated mint, BEFORE the on-chain
    // create_token writes the uri — so the on-chain uri is a permanent ipfs:// address.
    if (req.method === "POST" && path === "/api/coin/pin") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.mint || !b.name || !b.symbol) return json(res, 400, { error: "mint, name, symbol required" });
      if (!ipfs.hasIpfs()) return json(res, 200, { devMode: true, note: "set PINATA_JWT to pin to IPFS" });
      try {
        let image = "";
        if (b.logo) { const img = await ipfs.pinImageFromUrl(b.logo); image = img.gateway; }
        const meta = launchpad.metadataJsonFrom({ mint: b.mint, name: b.name, symbol: b.symbol, image, website: b.website, twitter: b.twitter, telegram: b.telegram, description: b.description, creator: b.creator });
        const pin = await ipfs.pinJson(meta, `${b.symbol}-metadata`);
        return json(res, 200, { uri: pin.uri, gateway: pin.gateway, image });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Pin an existing launch's logo + metadata JSON to IPFS. Dev mode (no PINATA_JWT) keeps raw URLs.
    if (req.method === "POST" && path === "/api/coin/finalize") {
      const b = JSON.parse((await readBody(req)) || "{}");
      const l = launchpad.get(b.mint);
      if (!l) return json(res, 404, { error: "not found" });
      if (!ipfs.hasIpfs()) return json(res, 200, { devMode: true, note: "set PINATA_JWT to pin to IPFS" });
      try {
        let logo = l.logo;
        if (l.logo) { const img = await ipfs.pinImageFromUrl(l.logo); logo = img.gateway; }
        const meta = launchpad.tokenMetadataJson(b.mint);
        meta.image = logo;
        const pin = await ipfs.pinJson(meta, `${l.symbol}-metadata`);
        launchpad.setMeta(b.mint, { logo, metadataUri: pin.uri, metadataGateway: pin.gateway });
        return json(res, 200, { metadataUri: pin.uri, metadataGateway: pin.gateway, logo });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Social verification for a launch (>= 3 owned platforms → verified badge → eligible for the board).
    if (req.method === "GET" && path === "/api/auth/start") {
      const platform = url.searchParams.get("platform");
      const mint = url.searchParams.get("mint") || "";
      try {
        const origin = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        return json(res, 200, { authUrl: oauth.authUrl(platform, mint, `${origin}/api/auth/callback`), configured: oauth.isConfigured(platform) });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/launch/bind") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        const profile = await oauth.verifyProfile(b.platform, b.code, { handle: b.handle, followers: b.followers });
        return json(res, 200, launchpad.bindVerifiedSocial(b.mint, profile));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- admin API (token-protected): launchpad ops only ----
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      if (req.method === "GET" && (path === "/api/admin/stats" || path === "/api/admin/overview")) {
        return json(res, 200, {
          wallets: walletStore.all().length,
          launches: launchpad.all().length,
          verified: launchpad.board().length,
        });
      }
      if (req.method === "GET" && path === "/api/admin/wallets") return json(res, 200, walletStore.all());
      if (req.method === "POST" && path === "/api/admin/wallets/add") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, await walletStore.add(b)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/wallets/remove") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { await walletStore.remove(b.wallet); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "GET" && path === "/api/admin/discover") {
        try {
          const d = await discoverWallets();
          d.candidates = d.candidates.map((c) => ({ ...c, tracked: walletStore.has(c.wallet) }));
          return json(res, 200, d);
        } catch (e) { return json(res, 502, { error: e.message }); }
      }
      if (req.method === "GET" && path === "/api/admin/launches") return json(res, 200, launchpad.all());
      if (req.method === "POST" && path === "/api/admin/launches/verify") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, launchpad.setVerified(b.mint, b.verified)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      // ---- commerce: order fulfillment + settle + treasury (admin / ops) ----
      if (req.method === "GET" && path === "/api/admin/shop/orders") {
        return json(res, 200, orders.list({ creator: url.searchParams.get("creator") || undefined, coin: url.searchParams.get("coin") || undefined, status: url.searchParams.get("status") || undefined }));
      }
      if (req.method === "POST" && path === "/api/admin/shop/ship") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, orders.markShipped(b.orderId, b.tracking)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/shop/deliver") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, orders.markDelivered(b.orderId)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/shop/refund") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, orders.refund(b.orderId, b.reason)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      // Settle -> 20% of net profit funds the floor. `force` skips the refund-window wait.
      if (req.method === "POST" && path === "/api/admin/shop/settle") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, await orders.settle(b.orderId, { force: !!b.force })); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      // SOL float pool: view balance/history, top up (records a batch fiat->SOL conversion).
      if (req.method === "GET" && path === "/api/admin/shop/treasury") return json(res, 200, treasury.snapshot());
      if (req.method === "POST" && path === "/api/admin/shop/treasury/topup") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, { lamports: treasury.topUp(Number(b.lamports), b.note), sol: treasury.balanceSol() }); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      // Channel-payout ledger + authorized regional partners (2-tier country->local).
      if (req.method === "GET" && path === "/api/admin/payouts") return json(res, 200, orders.payouts());
      if (req.method === "GET" && path === "/api/admin/agents") return json(res, 200, agents.list());
      if (req.method === "POST" && path === "/api/admin/agents") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, agents.register(b)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/agents/active") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, agents.setActive(b.id, b.active)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/agents/assign") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, accounts.assignAgents(b.handle, agents.resolveAssignment(b.localAgentId))); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      return json(res, 404, { error: "not found" });
    }

    // ---- KOL trade ingestion (Helius webhook) ----
    if (req.method === "POST" && path === "/webhooks/helius") {
      if (WEBHOOK_SECRET && req.headers["authorization"] !== WEBHOOK_SECRET) return json(res, 401, { error: "unauthorized" });
      const raw = await readBody(req);
      let txs;
      try { txs = JSON.parse(raw); } catch { return json(res, 400, { error: "bad json" }); }
      if (!Array.isArray(txs)) txs = [txs];
      let ingested = 0;
      for (const tx of txs) {
        const wallet = tx.feePayer;
        if (!walletStore.has(wallet)) continue;
        const swap = helius.parseSwap(tx, wallet);
        if (!swap) continue;
        store.add(wallet, swap);
        ingested += 1;
      }
      return json(res, 200, { ok: true, ingested });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

// Load all launchpad state once. Memoized so a serverless entrypoint can `await ensureReady()` on
// every invocation without re-loading, and a persistent server calls it once in start().
let _ready = null;
export function ensureReady() {
  if (!_ready) {
    _ready = (async () => {
      await walletStore.ensureLoaded();
      await store.load();
      await launchpad.load();
      await accounts.load();
      await social.load();
      await shopSource.load();
      await orders.load();
      await treasury.load();
      await buyback.load();
      await reactions.load();
      await agents.load();
    })();
  }
  return _ready;
}

export { handler };

export async function start(port = PORT) {
  await ensureReady();
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    // bind to 0.0.0.0 so cloud platforms can reach the health check
    server.listen(port, "0.0.0.0", () => {
      console.log(`OpenIP launchpad · listening on 0.0.0.0:${port}  (tracking ${walletStore.all().length} KOL wallets)`);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
