// Creator social layer for oneIP — posts, follows, comments, and creator settings
// (display name, bio, avatar, socials, auto-replies). Identity = account handle or Solana wallet.
// NOTE (MVP): posting/commenting trusts the identity field for unregistered handles; registered
// accounts are guarded by the session token at the route layer (accounts.verifyActor).
// Persistence goes through persist.js (Supabase KV on Vercel, data/*.json locally).
import { randomBytes } from "node:crypto";
import * as ai from "./ai.js";
import * as launchpad from "./launchpad.js";
import * as shopSource from "./commerce/source.js";
import { loadJson, saveJson } from "./persist.js";

let posts = [];      // [{id, creator, text, image, ts}]
let comments = {};   // postId -> [{id, fan, text, ts, auto}]
let follows = {};    // creator -> [fan,...]
let creators = {};   // id -> {wallet, displayName, bio, autoReplies:[{keyword,reply}], socials, publishAccounts, coin}
let likes = {};        // postId -> [fan,...]
let subscribers = {};  // creator -> [fan,...]   (distinct from follows)
let notifs = {};       // id -> [{id, type, text, ts, read}]
let loaded = false;

const newId = () => randomBytes(8).toString("hex");

export async function load() {
  posts = await loadJson("posts", []);
  comments = await loadJson("comments", {});
  follows = await loadJson("follows", {});
  creators = await loadJson("creators", {});
  likes = await loadJson("likes", {});
  subscribers = await loadJson("subscribers", {});
  notifs = await loadJson("notifs", {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() {
  saveJson("posts", posts);
  saveJson("comments", comments);
  saveJson("follows", follows);
  saveJson("creators", creators);
  saveJson("likes", likes);
  saveJson("subscribers", subscribers);
  saveJson("notifs", notifs);
}

// ---- creators ----
export function getCreator(wallet) {
  return creators[wallet] || { wallet, displayName: "", bio: "", pro: false, proTier: "", autoReplies: [], aiEnabled: false, aiPersona: "", syncPlatform: "", syncHandle: "" };
}
export function setCreator(wallet, patch) {
  const next = { ...getCreator(wallet), ...patch, wallet };
  if (patch.proTier !== undefined) next.pro = patch.proTier !== ""; // keep the boolean in sync
  creators[wallet] = next;
  persist();
  return creators[wallet];
}
/** Set a creator's subscription tier ("", "ai", or "publish"). */
export function setTier(wallet, tier) {
  const t = ["", "ai", "publish"].includes(tier) ? tier : "";
  return setCreator(wallet, { proTier: t });
}
/** Legacy boolean grant → maps to the basic AI tier. */
export function setPro(wallet, pro) { return setTier(wallet, pro ? "ai" : ""); }
// Pro subscription tiers were dropped — the AI clone + multi-platform publishing are free creator
// tools now (the platform earns on the commerce/token loop, not SaaS).
export function hasAi() { return true; }
export function hasPublish() { return true; }

// ---- posts / feed ----
// Content gate (anti-spam): a REAL post — the action that makes you a creator + auto-mints your
// value pool — needs a paragraph AND at least one attachment (photo / video / file / product). A
// bare one-liner must not qualify. Synced mirrors (from external platforms) bypass it.
const POST_MIN_CHARS = Number(process.env.POST_MIN_CHARS || 20);
export function createPost({ creator, text, image, video, file, coin, product, synced, source }) {
  if (!creator) throw new Error("sign in to post");
  const body = String(text || "").trim();
  const hasMedia = !!(image || video || file || product);
  if (!synced && (body.length < POST_MIN_CHARS || !hasMedia))
    throw new Error(`a post needs at least ${POST_MIN_CHARS} characters and one of: photo, video, file, or product`);
  const p = { id: newId(), creator, text: (text || "").slice(0, 2000), image: image || "", video: video || "", file: file || "", coin: coin || "", product: product || "", synced: !!synced, source: source || "", ts: Date.now() };
  posts.unshift(p);
  persist();
  return p;
}

// pump.fun-style: resolve a post's attached coin to a compact card payload.
function coinCard(mint) {
  if (!mint) return null;
  const l = launchpad.get(mint);
  if (!l) return null;
  return { mint: l.mint, symbol: l.symbol, name: l.name, verified: l.verified, createdAt: l.createdAt, floorBps: l.floorBps };
}
// Resolve a post's attached product to a compact card payload (shop item to buy).
function productCard(id) {
  if (!id) return null;
  const p = shopSource.getProduct(id);
  if (!p) return null;
  return { id: p.id, title: p.title, image: p.image, priceCents: p.priceCents, currency: p.currency, type: p.type, creator: p.creator };
}
export function feed({ creator, following, viewer, coin, limit = 50 } = {}) {
  let list = posts;
  if (creator) list = list.filter((p) => p.creator === creator);
  else if (coin) list = list.filter((p) => p.coin === coin);
  else if (following) { const set = new Set(getFollowing(following)); list = list.filter((p) => set.has(p.creator)); }
  return list.slice(0, limit).map((p) => ({
    ...p,
    creatorName: getCreator(p.creator).displayName || p.creator.slice(0, 6),
    creatorPro: getCreator(p.creator).pro,
    commentCount: (comments[p.id] || []).length,
    likes: (likes[p.id] || []).length,
    liked: viewer ? (likes[p.id] || []).includes(viewer) : false,
    coin: coinCard(p.coin),
    product: productCard(p.product),
  }));
}

// ---- follows ----
export function follow(fan, creator) {
  if (!fan || !creator) throw new Error("fan + creator required");
  follows[creator] = follows[creator] || [];
  if (!follows[creator].includes(fan)) { follows[creator].push(fan); notify(creator, "follow", fan.slice(0, 6) + "… followed you", fan); }
  persist();
  return { following: true, followers: follows[creator].length };
}
export function unfollow(fan, creator) {
  follows[creator] = (follows[creator] || []).filter((f) => f !== fan);
  persist();
  return { following: false, followers: follows[creator].length };
}
export function followerCount(creator) { return (follows[creator] || []).length; }
export function isFollowing(fan, creator) { return (follows[creator] || []).includes(fan); }

// ---- comments + auto-reply ----
export async function addComment({ postId, fan, text }) {
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error("post not found");
  if (!text) throw new Error("empty comment");
  comments[postId] = comments[postId] || [];
  comments[postId].push({ id: newId(), fan, text: text.slice(0, 1000), ts: Date.now(), auto: false });
  notify(post.creator, "comment", fan.slice(0, 6) + "… commented: " + text.slice(0, 40), fan);

  // Auto-reply as the creator: first the canned keyword rules; if none match and the creator has
  // the AI clone enabled, draft a reply with Claude (src/ai.js).
  let reply = matchAutoReply(post.creator, text);
  let viaAI = false;
  if (!reply) {
    const c = creators[post.creator];
    if (c && c.aiEnabled && ai.hasKey()) {
      reply = await ai.generateReply(c, post, text);
      viaAI = Boolean(reply);
    }
  }
  if (reply) comments[postId].push({ id: newId(), fan: post.creator, text: reply, ts: Date.now() + 1, auto: true, ai: viaAI });

  persist();
  return comments[postId];
}
export function getComments(postId) { return comments[postId] || []; }

function matchAutoReply(creator, text) {
  const c = creators[creator];
  if (!c || !Array.isArray(c.autoReplies) || !c.autoReplies.length) return null;
  const low = text.toLowerCase();
  for (const r of c.autoReplies) {
    if (r.keyword && r.keyword !== "*" && low.includes(r.keyword.toLowerCase())) return r.reply;
  }
  const fallback = c.autoReplies.find((r) => r.keyword === "*" || r.keyword === "");
  return fallback ? fallback.reply : null;
}

// ---- likes ----
export function like(postId, fan) {
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error("post not found");
  likes[postId] = likes[postId] || [];
  const i = likes[postId].indexOf(fan);
  let liked;
  if (i >= 0) { likes[postId].splice(i, 1); liked = false; }
  else { likes[postId].push(fan); liked = true; notify(post.creator, "like", fan.slice(0, 6) + "… liked your post", fan); }
  persist();
  return { liked, likes: likes[postId].length };
}

// ---- subscribe (distinct from follow) ----
export function subscribe(fan, creator) {
  if (!fan || !creator) throw new Error("fan + creator required");
  subscribers[creator] = subscribers[creator] || [];
  if (!subscribers[creator].includes(fan)) { subscribers[creator].push(fan); notify(creator, "subscribe", fan.slice(0, 6) + "… subscribed to you", fan); }
  persist();
  return { subscribed: true, subscribers: subscribers[creator].length };
}
export function unsubscribe(fan, creator) {
  subscribers[creator] = (subscribers[creator] || []).filter((f) => f !== fan);
  persist();
  return { subscribed: false, subscribers: subscribers[creator].length };
}
export function subscriberCount(creator) { return (subscribers[creator] || []).length; }
export function isSubscribed(fan, creator) { return (subscribers[creator] || []).includes(fan); }

export function getFollowing(fan) {
  return Object.keys(follows).filter((c) => (follows[c] || []).includes(fan));
}

// ---- delete own post ----
export function deletePost(postId, creator) {
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx < 0) throw new Error("post not found");
  if (posts[idx].creator !== creator) throw new Error("not your post");
  posts.splice(idx, 1);
  delete comments[postId];
  delete likes[postId];
  persist();
  return { ok: true };
}

// ---- notifications ----
function notify(wallet, type, text, actor) {
  if (!wallet || wallet === actor) return;
  notifs[wallet] = notifs[wallet] || [];
  notifs[wallet].unshift({ id: newId(), type, text, ts: Date.now(), read: false });
  notifs[wallet] = notifs[wallet].slice(0, 50);
}
export function getNotifications(wallet) { return notifs[wallet] || []; }
export function unreadCount(wallet) { return (notifs[wallet] || []).filter((n) => !n.read).length; }
export function markRead(wallet) { (notifs[wallet] || []).forEach((n) => (n.read = true)); persist(); }
