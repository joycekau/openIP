// oneIP.io launchpad registry (off-chain MVP mirror of the Solana program).
// Rules the product is built on:
//   - every launch carries a 20% floor (floorBps 2000) -> can't go to zero
//   - bind >= 3 social platforms  -> platform verifies + signs attestation -> eligible for the board
//   - 0 socials (or < 3)          -> launch is tradable but NOT pushed on the board
import { randomBytes } from "node:crypto";
import { signAttestation, MIN_SOCIALS } from "./verify.js";
import { loadJson, saveJson } from "./persist.js";

const KEY = "launches";
const FLOOR_BPS = 2000;
const VALID_PLATFORMS = ["twitter", "telegram", "discord", "tiktok", "instagram", "youtube", "website"];

let mem = {};

export async function load() {
  mem = await loadJson(KEY, {});
}
function persist() {
  saveJson(KEY, mem);
}

export function create({ name, symbol, creator, coraxCreatorId, logo, website, twitter, telegram, description, mint, mintTx, metadataUri, auto, chain }) {
  // Real on-chain launches pass the actual Solana mint (minted via Phantom); off-chain demos
  // fall back to a placeholder address until a real mint exists.
  const addr = mint || "Kol" + randomBytes(16).toString("hex");
  mem[addr] = {
    mint: addr, name, symbol, creator,
    // Reserved SSO seam: when OpenIP is embedded in a corax.live channel, the launch is attributed
    // to the corax creator via this id (verified from corax's Supabase Auth JWT). Empty for
    // standalone wallet-first launches until that integration is wired.
    coraxCreatorId: coraxCreatorId || "",
    logo: logo || "", website: website || "", twitter: twitter || "", telegram: telegram || "", description: description || "",
    metadataUri: metadataUri || "",
    floorBps: FLOOR_BPS,
    // Which chain this token/floor lives on. Solana today; kept explicit so adding BNB Chain later is
    // "route by coin.chain to its adapter", NOT a rewrite (user directive: don't lock into one chain).
    chain: chain || "sol",
    onchain: Boolean(mint), mintTx: mintTx || "", // true once minted on-chain
    auto: Boolean(auto),
    socials: {}, verified: false, verifiedAt: null, attestation: null,
    createdAt: Date.now(),
  };
  persist();
  return mem[addr];
}

// Standard Metaplex off-chain token-metadata JSON. Host this on IPFS/Arweave and write its
// URI into the token's on-chain metadata account (Metaplex Token Metadata) — then EVERY wallet
// (Phantom/Solflare/Backpack), explorer (Solscan), and DEX (Jupiter/Raydium) renders the logo,
// name, and links identically. That cross-wallet consistency is the credibility.
// Pure builder — works from raw fields, so it can run BEFORE a launch record exists (i.e. to pin
// metadata to IPFS for a freshly-generated mint, before the on-chain create_token writes the uri).
export function metadataJsonFrom({ mint, name, symbol, image, website, twitter, telegram, description, creator }) {
  return {
    name,
    symbol,
    description: description || `${name} — launched on oneIP.io with a 20% floor.`,
    image: image || "",
    external_url: website || "",
    extensions: {
      website: website || "",
      twitter: twitter || "",
      telegram: telegram || "",
      oneip: `https://oneip.io/coin?mint=${mint}`,
    },
    properties: { category: "token", creators: creator ? [{ address: creator, share: 100 }] : [] },
  };
}

export function tokenMetadataJson(mint) {
  const l = mem[mint];
  if (!l) return null;
  return metadataJsonFrom({ mint, name: l.name, symbol: l.symbol, image: l.logo, website: l.website, twitter: l.twitter, telegram: l.telegram, description: l.description, creator: l.creator });
}

const MIN_FOLLOWERS = 1000; // a platform only COUNTS toward verification above this reach

// Bind an OAuth-verified social profile (handle + follower count + proven ownership).
export function bindVerifiedSocial(mint, profile) {
  const l = mem[mint];
  if (!l) throw new Error("launch not found");
  const platform = String(profile.platform || "").toLowerCase();
  if (!VALID_PLATFORMS.includes(platform)) throw new Error("unsupported platform");

  l.socials[platform] = {
    handle: profile.handle,
    followers: profile.followers || 0,
    userId: profile.userId,
    verifiedOwnership: !!profile.verifiedOwnership,
    qualifies: (profile.followers || 0) >= MIN_FOLLOWERS && !!profile.verifiedOwnership,
    mock: !!profile.mock,
  };
  recomputeVerification(l, mint);
  persist();
  return l;
}

// Verified = at least MIN_SOCIALS platforms that are owned AND above the follower floor.
function recomputeVerification(l, mint) {
  const qualifying = Object.values(l.socials).filter((s) => s.qualifies);
  const count = qualifying.length;
  const totalReach = qualifying.reduce((a, s) => a + s.followers, 0);
  if (count >= MIN_SOCIALS) {
    const expiry = Date.now() + 365 * 864e5;
    if (!l.verified) { l.verified = true; l.verifiedAt = Date.now(); }
    l.attestation = { socialCount: count, totalReach, expiry, sig: signAttestation({ mint, creator: l.creator, socialCount: count, expiry }) };
  } else {
    l.verified = false;
    l.attestation = null;
  }
}

export function get(mint) { return mem[mint] || null; }

export function setMeta(mint, patch) {
  const l = mem[mint];
  if (!l) throw new Error("launch not found");
  Object.assign(l, patch);
  persist();
  return l;
}

// Admin manual override: force a launch verified/unverified (e.g. after off-platform review).
export function setVerified(mint, verified) {
  const l = mem[mint];
  if (!l) throw new Error("launch not found");
  l.verified = !!verified;
  if (verified) {
    if (!l.verifiedAt) l.verifiedAt = Date.now();
    if (!l.attestation) {
      l.attestation = { socialCount: Object.keys(l.socials).length, totalReach: 0, sig: "admin-override", expiry: Date.now() + 365 * 864e5 };
    }
  }
  persist();
  return l;
}

/** The board: only verified (>= 3 socials) launches get pushed, newest first. */
export function board() {
  return Object.values(mem)
    .filter((l) => l.verified)
    .sort((a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0));
}

export function all() { return Object.values(mem); }
