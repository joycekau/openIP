// oneIP.io backend — zero-dependency Node HTTP service.
//   GET  /                       -> the web UI
//   GET  /api/trending           -> live Solana trending (DexScreener, 30s cache)
//   GET  /api/kol/leaderboard    -> KOL leaderboard (baseline + live webhook trades)
//   GET  /api/kol/signals        -> recent KOL buy/sell signals
//   GET  /api/token/security?mint=.. -> RugCheck safety report
//   POST /webhooks/helius        -> ingest Helius enhanced SWAP txs for tracked wallets
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
import * as walletStore from "./wallets.js";
import { discoverWallets } from "./discover.js";
import * as social from "./social.js";
import * as ai from "./ai.js";
import * as sync from "./sync.js";
import * as publish from "./publish.js";
import * as ipfs from "./ipfs.js";
import * as markets from "./sources/markets.js";
import * as shopSource from "./commerce/source.js";
import * as orders from "./commerce/orders.js";
import * as treasury from "./commerce/treasury.js";
import * as buyback from "./commerce/buyback.js";
import * as payments from "./commerce/payments.js";
import * as brands from "./commerce/brands.js";
import * as reactions from "./commerce/reactions.js";
import * as agents from "./commerce/agents.js";
import * as aigen from "./aigen.js";
import * as accounts from "./accounts.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const PORT = Number(process.env.PORT) || 8787;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin";
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

// Auto-provision a creator's value-pool token the FIRST time they do anything productive on oneIP.ai
// (list/generate a product, post, or one-click forward to the 14 platforms). Creates the pool under
// the SAME account id and links it on the creator profile, so .ai and .io are connected by one
// account. The pool is off-chain (placeholder mint) until they mint it for real via Phantom on
// /launch; pre-launch revenue escrows to it (see buyback.js). Idempotent — returns the linked coin.
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
// and flush the escrowed pre-launch 20% into the real coin. This is what makes "one account, both
// sides" carry all the way through to the real on-chain token.
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
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }

    // Root is host-aware: oneip.ai → the storefront face; oneip.io (or anything else) → the .io home.
    // /home and /home.html always serve the .io home explicitly.
    if (req.method === "GET" && (path === "/" || path === "/home" || path === "/home.html")) {
      const host = String(req.headers.host || "").toLowerCase();
      const isAi = host.includes("oneip.ai") && path === "/";
      const html = await readFile(join(ROOT, "web", isAi ? "ai.html" : "home.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && (path === "/terminal" || path === "/index.html")) {
      const html = await readFile(join(ROOT, "web", "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && (path === "/launch" || path === "/launch.html")) {
      const html = await readFile(join(ROOT, "web", "launch.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && (path === "/admin" || path === "/admin.html")) {
      const html = await readFile(join(ROOT, "web", "admin.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && (path === "/feed" || path === "/feed.html")) {
      const html = await readFile(join(ROOT, "web", "feed.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && (path === "/coin" || path === "/coin.html")) {
      const html = await readFile(join(ROOT, "web", "coin.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    // oneIP.ai face — pure fiat e-commerce + creator storefront + fan interaction (NO coin info).
    // The only token touchpoint is a deep-link button that jumps to the oneIP.io coin page.
    if (req.method === "GET" && (path === "/ai" || path === "/ai.html" || path === "/shop" || path === "/shop.html")) {
      const html = await readFile(join(ROOT, "web", "ai.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    // oneIP.ai creator Studio — self-serve onboarding + listing (profile, products, digital content).
    if (req.method === "GET" && (path === "/studio" || path === "/studio.html")) {
      const html = await readFile(join(ROOT, "web", "studio.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    // oneIP.ai Brands — supply-side marketplace: brands post offers, creators browse + link them.
    if (req.method === "GET" && (path === "/brands" || path === "/brands.html")) {
      const html = await readFile(join(ROOT, "web", "brands.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ---- creator social layer ----
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
        // Validate FIRST (content gate throws on a sub-threshold post) so a rejected post never
        // mints a value pool. Only a valid post makes you a creator + auto-provisions the token.
        const post = social.createPost(b);
        if (b.creator) ensureValuePool(b.creator);
        return json(res, 200, post);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/creator/launches") {
      const w = url.searchParams.get("w");
      const mine = launchpad.all().filter((l) => l.creator === w).map((l) => ({ mint: l.mint, symbol: l.symbol, name: l.name, verified: l.verified }));
      return json(res, 200, mine);
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
      if (Array.isArray(b.autoReplies)) patch.autoReplies = b.autoReplies;
      if (b.aiEnabled !== undefined) patch.aiEnabled = Boolean(b.aiEnabled);
      if (b.aiPersona !== undefined) patch.aiPersona = String(b.aiPersona).slice(0, 2000);
      if (b.syncPlatform !== undefined) patch.syncPlatform = String(b.syncPlatform);
      if (b.syncHandle !== undefined) patch.syncHandle = String(b.syncHandle).slice(0, 64);
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
      try { return json(res, 200, social.deletePost(b.postId, b.creator)); } catch (e) { return json(res, 400, { error: e.message }); }
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
    // (Pro subscription tiers $10/$39 removed — creator tools are free; no /api/pro/* or Stripe-Pro.)
    // AI drafts a post in the creator's voice (FREE — creator tools are no longer Pro-gated). Prefers
    // the Cora gateway (aigen) when keyed, falls back to the Claude SDK (ai.js), else a mock draft.
    if (req.method === "POST" && path === "/api/ai/draft") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.prompt) return json(res, 400, { error: "prompt required" });
      if (aigen.hasAigen()) return json(res, 200, await aigen.generateMaterial({ kind: "post", prompt: b.prompt, creator: b.wallet || "" }));
      const text = b.wallet && ai.hasKey() ? await ai.generatePost(social.getCreator(b.wallet), b.prompt) : null;
      return json(res, 200, text ? { text } : await aigen.generateMaterial({ kind: "post", prompt: b.prompt, creator: b.wallet || "" }));
    }
    // AI MATERIAL generation via the Cora gateway (gateway.corax.live). Free; mock without CORAX_API_KEY.
    // Lets a creator with no works generate publishable material. kind ∈ post | product | idea.
    if (req.method === "POST" && path === "/api/ai/generate") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.prompt) return json(res, 400, { error: "prompt required" });
      return json(res, 200, await aigen.generateMaterial({ kind: b.kind, prompt: b.prompt, creator: b.creator || b.wallet || "" }));
    }
    if (req.method === "POST" && path === "/api/sync/now") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.wallet) return json(res, 400, { error: "wallet required" });
      try { return json(res, 200, await sync.syncCreator(social.getCreator(b.wallet))); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    // ---- outbound multi-platform publishing (AiToEarn hidden behind these; free creator tool).
    // Identity = `account` (the oneIP.ai handle) or legacy `wallet`. Connect → returns OAuth URL.
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
          const accounts = { ...(social.getCreator(acct).publishAccounts || {}), [platform]: r.accountId };
          social.setCreator(acct, { publishAccounts: accounts });
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
    // Set/clear the creator's PUBLIC @handle on a platform → fans can jump to their profile from oneIP.ai.
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
    // Public: browse + buy (FIAT). Creators curate (wallet-trusted MVP, like social.js).
    // Fulfillment + settle live under the admin API below.
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
    // Owner-guarded update (activate/deactivate): the product's creator + (for registered accounts) a matching token.
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
        const order = orders.createTip({ creator: b.creator, coin: b.coin, amountCents: b.amountCents, fan: b.fan, currency: b.currency });
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
    // (count bumps on webhook, TODO); dev → instant settle + bump now.
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
    // Fiat payment cleared (Stripe webhook) -> mark paid -> hand to supplier for fulfillment.
    if (req.method === "POST" && path === "/webhooks/shop") {
      const raw = await readBody(req);
      if (!payments.verifyWebhook(raw, req.headers["stripe-signature"])) return json(res, 401, { error: "bad signature" });
      const r = payments.parseWebhook(raw);
      if (r?.paid) { try { await orders.markPaid(r.orderId); } catch (e) { console.error("markPaid:", e.message); } }
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
    // Resolve a connected wallet → its account handle (so .io surfaces can find the creator's
    // .ai handle, products, etc. — the handle↔wallet identity link).
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

    // ---- supply side: factories / supply chains / brands post offers; creators link them ----
    if (req.method === "GET" && path === "/api/brands") return json(res, 200, brands.listBrands());
    if (req.method === "POST" && path === "/api/brands") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, brands.registerBrand(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/brand") {
      const brand = brands.getBrand(url.searchParams.get("id"));
      if (!brand) return json(res, 404, { error: "not found" });
      return json(res, 200, { ...brand, offers: brands.listOffers({ brandId: brand.id, activeOnly: false }) });
    }
    // The marketplace creators browse — active offers (optionally by kind: product/endorsement/need).
    if (req.method === "GET" && path === "/api/offers") {
      return json(res, 200, brands.listOffers({ kind: url.searchParams.get("kind") || undefined }));
    }
    if (req.method === "POST" && path === "/api/brand/offer") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, brands.addOffer(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/brand/offer/active") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try { return json(res, 200, brands.setOfferActive(b.id, b.brandId, b.active)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "GET" && path === "/api/brand/links") {
      return json(res, 200, brands.listLinks({ creator: url.searchParams.get("creator") || undefined }));
    }
    // A creator LINKS a brand. For a `product` offer this also drops the item into their storefront
    // (cost = supplier price, retail = creator's price or 2x default) and auto-provisions their pool.
    if (req.method === "POST" && path === "/api/brand/link") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        const link = brands.linkBrand({ creator: b.creator, offerId: b.offerId });
        const offer = brands.getOffer(b.offerId);
        let product = null;
        if (offer && offer.kind === "product") {
          const coin = ensureValuePool(b.creator);
          const priceCents = b.priceCents > offer.priceCents ? Math.round(b.priceCents) : Math.round(offer.priceCents * 2);
          product = shopSource.addProduct({ creator: b.creator, coin, type: "physical", title: offer.title, image: offer.image, description: offer.description, priceCents, costCents: offer.priceCents, supplier: offer.brandId });
        }
        return json(res, 200, { link, product });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- admin API (token-protected) ----
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      if (req.method === "GET" && path === "/api/admin/stats") {
        return json(res, 200, { wallets: walletStore.all().length, launches: launchpad.all().length, verified: launchpad.board().length });
      }
      // Platform operations overview — aggregates accounts / commerce / revenue / floor / reactions.
      if (req.method === "GET" && path === "/api/admin/overview") {
        const all = orders.list();
        const byType = { physical: 0, digital: 0, tip: 0, reaction: 0 };
        let gmv = 0, platformPool = 0, funded = 0, escrow = 0, queued = 0;
        for (const o of all) {
          if (byType[o.type] !== undefined) byType[o.type]++;
          if (o.status === "settled") {
            gmv += o.priceCents || 0;
            platformPool += o.platformFeeCents || 0; // the whole 5% pool collected
            const bs = o.buyback && o.buyback.status;
            if (bs === "funded") funded += o.buyback.buybackCents || 0;
            else if (bs === "escrow") escrow += o.buyback.buybackCents || 0;
            else if (bs === "queued") queued += o.buyback.buybackCents || 0;
          }
        }
        // The 5% pool splits into what the platform KEEPS vs owes partners/referrers (payouts ledger).
        const led = orders.payouts();
        const partnerOwed = led.partners.reduce((a, x) => a + x.usd, 0);
        const referralOwed = led.referrers.reduce((a, x) => a + x.usd, 0);
        return json(res, 200, {
          accounts: accounts.list().length,
          products: shopSource.listProducts({ activeOnly: false }).length,
          orders: all.length, settled: all.filter((o) => o.status === "settled").length, ordersByType: byType,
          gmvUsd: gmv / 100,
          platformPoolUsd: platformPool / 100,      // whole 5% fee collected
          platformRevenueUsd: platformPool / 100 - partnerOwed - referralOwed, // what platform keeps (robust to pre-split orders)
          partnerPayoutUsd: partnerOwed, referralPayoutUsd: referralOwed,
          floorFundedUsd: funded / 100, escrowUsd: escrow / 100, queuedUsd: queued / 100,
          reactions: reactions.totalReactions(),
          brands: brands.listBrands().length, offers: brands.listOffers({ activeOnly: false }).length,
          agents: agents.list().length,
          launches: launchpad.all().length, verified: launchpad.board().length,
          treasury: treasury.snapshot(),
        });
      }
      // ---- authorized regional partners (2-tier country->local) + channel-payout ledger ----
      if (req.method === "GET" && path === "/api/admin/agents") return json(res, 200, agents.list());
      if (req.method === "POST" && path === "/api/admin/agents") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, agents.register(b)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "POST" && path === "/api/admin/agents/active") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, agents.setActive(b.id, b.active)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      // Assign a creator (account handle) to a LOCAL partner; the country tier is derived from its parent.
      if (req.method === "POST" && path === "/api/admin/agents/assign") {
        const b = JSON.parse((await readBody(req)) || "{}");
        try { return json(res, 200, accounts.assignAgents(b.handle, agents.resolveAssignment(b.localAgentId))); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === "GET" && path === "/api/admin/payouts") return json(res, 200, orders.payouts());

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
      if (req.method === "POST" && path === "/api/admin/creator/pro") {
        const b = JSON.parse((await readBody(req)) || "{}");
        if (!b.wallet) return json(res, 400, { error: "wallet required" });
        return json(res, 200, social.setPro(b.wallet, b.pro));
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
      return json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && (path === "/wallet.js" || path === "/i18n.js" || path === "/chain.js" || path === "/header.js" || path === "/aiheader.js")) {
      const js = await readFile(join(ROOT, "web", path.slice(1)), "utf8");
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      return res.end(js);
    }
    // static brand assets (logo, mascot, app icon) under web/assets/
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
    // Image upload: accept a base64 data URL (zero-dep, no multipart), store under data/uploads/,
    // serve it back at /uploads/<file>. Lets creators upload real photos instead of pasting URLs.
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
      const dir = join(ROOT, "data", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), buf);
      return json(res, 200, { url: "/uploads/" + name });
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
    if (req.method === "GET" && path === "/api/trending") return json(res, 200, await getTrending());
    // 全网 SOL Meme 聚合(GeckoTerminal + DexScreener + pump.fun)
    if (req.method === "GET" && path === "/api/markets") return json(res, 200, await getMarkets("all"));
    if (req.method === "GET" && path === "/api/markets/new") return json(res, 200, await getMarkets("new"));
    if (req.method === "GET" && path === "/api/markets/pump") return json(res, 200, await getMarkets("pump"));
    // oneIP 自家发的币(全部 launches,认证的排前面)
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
      const w = url.searchParams.get("w");
      const d = await getKolDetail(w);
      return d ? json(res, 200, d) : json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && path === "/api/token/security") {
      const mint = url.searchParams.get("mint");
      if (!mint) return json(res, 400, { error: "mint required" });
      return json(res, 200, await getSecurity(mint));
    }
    if (req.method === "GET" && path === "/api/board") return json(res, 200, launchpad.board());
    if (req.method === "GET" && path === "/api/launch") {
      const m = url.searchParams.get("mint");
      const l = launchpad.get(m);
      return l ? json(res, 200, l) : json(res, 404, { error: "not found" });
    }
    if (req.method === "POST" && path === "/api/launch") {
      const b = JSON.parse((await readBody(req)) || "{}");
      if (!b.name || !b.symbol || !b.creator) return json(res, 400, { error: "name, symbol, creator required" });
      const l = launchpad.create(b);
      // If this real mint belongs to a .ai account that had an auto-pool, migrate + flush escrow.
      if (b.account && b.mint) { const m = activateRealToken(b.account, b.mint); if (m) l.migrated = m; }
      return json(res, 200, l);
    }
    if (req.method === "GET" && path === "/api/coin/metadata") {
      const m = launchpad.tokenMetadataJson(url.searchParams.get("mint"));
      return m ? json(res, 200, m) : json(res, 404, { error: "not found" });
    }
    // Pin logo + standard metadata JSON to IPFS for a freshly-generated mint, BEFORE the on-chain
    // create_token writes the uri — so the on-chain uri is a permanent ipfs:// address (Flap step 1-3).
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
    // Pin a launch's logo + standard metadata JSON to IPFS -> permanent URI for the on-chain
    // metadata account. Dev mode (no PINATA_JWT) keeps the raw URLs.
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
    if (req.method === "GET" && path === "/api/auth/start") {
      const platform = url.searchParams.get("platform");
      const mint = url.searchParams.get("mint") || "";
      try {
        const redirect = `http://localhost:${PORT}/api/auth/callback`;
        return json(res, 200, { authUrl: oauth.authUrl(platform, mint, redirect), configured: oauth.isConfigured(platform) });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === "POST" && path === "/api/launch/bind") {
      const b = JSON.parse((await readBody(req)) || "{}");
      try {
        // real flow: b.code from the OAuth callback. mock flow: synthesizes a verified profile.
        const profile = await oauth.verifyProfile(b.platform, b.code, { handle: b.handle, followers: b.followers });
        return json(res, 200, launchpad.bindVerifiedSocial(b.mint, profile));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
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

export async function start(port = PORT) {
  await walletStore.ensureLoaded();
  await store.load();
  await launchpad.load();
  await social.ensureLoaded();
  await Promise.all([shopSource.load(), orders.load(), treasury.load(), buyback.load(), brands.load(), reactions.load(), agents.load(), accounts.load()]);
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    // bind to 0.0.0.0 so cloud platforms (Render etc.) can reach the health check
    server.listen(port, "0.0.0.0", () => {
      console.log(`oneIP.io api · listening on 0.0.0.0:${port}  (tracking ${walletStore.all().length} KOL wallets)`);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
