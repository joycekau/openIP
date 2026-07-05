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
import { loadJson, saveJson } from "./persist.js";
import * as walletStore from "./wallets.js";
import { discoverWallets } from "./discover.js";
import * as ipfs from "./ipfs.js";
import * as markets from "./sources/markets.js";

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

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-admin-token,authorization" }); return res.end(); }

    // ---- pages (OpenIP is one brand; every host serves the launchpad) ----
    if (req.method === "GET" && (path === "/" || path === "/home" || path === "/home.html")) return servePage(res, "home.html");
    if (req.method === "GET" && (path === "/terminal" || path === "/index.html")) return servePage(res, "index.html");
    if (req.method === "GET" && (path === "/launch" || path === "/launch.html")) return servePage(res, "launch.html");
    if (req.method === "GET" && (path === "/admin" || path === "/admin.html")) return servePage(res, "admin.html");
    if (req.method === "GET" && (path === "/coin" || path === "/coin.html")) return servePage(res, "coin.html");
    if (req.method === "GET" && (path === "/shop" || path === "/shop.html")) return servePage(res, "shop.html");
    if (req.method === "GET" && (path === "/creators" || path === "/creator" || path === "/creator.html")) return servePage(res, "creator.html");

    // static scripts + brand assets
    if (req.method === "GET" && (path === "/wallet.js" || path === "/i18n.js" || path === "/chain.js" || path === "/header.js")) {
      const js = await readFile(join(ROOT, "web", path.slice(1)), "utf8");
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      return res.end(js);
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

    // ---- launchpad ----
    if (req.method === "GET" && path === "/api/board") return json(res, 200, launchpad.board());

    // ---- marketplace products/services (creators list these in the studio) ----
    // Stored in openip_kv key "products": [{ id, creatorId, coraxCreatorId, title,
    // image, price, currency, url, kind, syncCorax }]. syncCorax = discoverable in
    // the creator's corax.live channel (creator's opt-in per product).
    if (req.method === "GET" && path === "/api/shop/products") {
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
      const row = {
        id: "prod_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        creatorId: body.creatorId, coraxCreatorId: body.coraxCreatorId || "",
        title: String(body.title).slice(0, 200), image: body.image || "",
        price: body.price != null ? Number(body.price) : null, currency: body.currency || "USD",
        url: body.url || "", kind: body.kind || "product", syncCorax: !!body.syncCorax,
        active: true, createdAt: Date.now(),
      };
      list.push(row); saveJson("products", list);
      return json(res, 200, row);
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
