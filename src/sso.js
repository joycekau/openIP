// CoraX SSO — verify corax.live's Supabase Auth JWT so a launch can be attributed to (and
// auto-created for) a corax creator the moment they sign up. This is the missing trigger behind
// the reserved `coraxCreatorId` seam: corax authenticates the creator, hands us its Supabase Auth
// JWT, and we turn that identity into an off-chain listing (20% floor, auto:true).
//
// Two modes, same graceful-degrade pattern as oauth.js / helius.js:
//   • CORAX_JWT_SECRET (or SUPABASE_JWT_SECRET) set  -> real HS256 verification (signature + exp).
//     Supabase Auth signs its access tokens HS256 with the project's JWT secret by default.
//   • unset                                          -> DEV/mock mode: the token is decoded but NOT
//     trusted (verified:false), so the whole onboarding flow is demonstrable without a shared secret
//     (mirrors oauth's mock profiles). Wire the secret before production.
//
// A THIRD mode covers corax's sso-issue tokens (the /apps/oneip embed handoff): those are RS256,
// signed with corax's own keypair and published at its JWKS endpoint (sso-jwks). verifyAny() below
// branches on header.alg — RS256 verifies against the (cached) JWKS via CORAX_JWT_JWKS_URL, HS256
// falls through to verifyJwt(). Use verifyAny() for any token that may come from the corax embed.
import { createHmac, createPublicKey, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const SECRET = process.env.CORAX_JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "";
// corax publishes its SSO public key here (supabase edge fn `sso-jwks`, CoraX project).
const JWKS_URL = process.env.CORAX_JWT_JWKS_URL ||
  "https://aokaupvmtakfegdpyvky.supabase.co/functions/v1/sso-jwks";

export function isConfigured() {
  return Boolean(SECRET);
}

function b64urlToBuf(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return Buffer.from(s, "base64");
}
function b64urlToJson(s) {
  return JSON.parse(b64urlToBuf(s).toString("utf8"));
}

// Verify (or, in dev mode, just decode) a CoraX Supabase Auth JWT.
// Returns { claims, verified }. Throws on a malformed / bad-signature / expired token when a
// secret is configured.
export function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;
  const header = b64urlToJson(h);
  const claims = b64urlToJson(p);

  if (!SECRET) return { claims, verified: false }; // dev/mock: decode without trusting

  if (header.alg !== "HS256") throw new Error(`unsupported alg ${header.alg} (set CORAX_JWT_JWKS_URL path)`);
  const expected = createHmac("sha256", SECRET).update(`${h}.${p}`).digest();
  const got = b64urlToBuf(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("bad signature");
  if (claims.exp && Math.floor(Date.now() / 1000) > Number(claims.exp)) throw new Error("token expired");
  return { claims, verified: true };
}

// ---- RS256 (corax sso-issue tokens) --------------------------------------------------------
// JWKS is cached for an hour; on fetch failure we keep serving a previously-good keyset.
let _jwks = { keys: null, at: 0 };
async function fetchJwks() {
  if (_jwks.keys && Date.now() - _jwks.at < 3600_000) return _jwks.keys;
  try {
    const r = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`jwks ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j.keys) || !j.keys.length) throw new Error("jwks empty");
    _jwks = { keys: j.keys, at: Date.now() };
  } catch (e) {
    if (_jwks.keys) return _jwks.keys; // stale beats none — keys rotate rarely
    throw e;
  }
  return _jwks.keys;
}

/** Verify a corax token of EITHER kind: RS256 (sso-issue embed handoff, verified against corax's
 *  JWKS) or HS256 (raw Supabase Auth JWT, verified with the shared secret via verifyJwt). Same
 *  return shape: { claims, verified }. RS256 dev fallback mirrors the HS256 one — if the JWKS is
 *  unreachable AND no HS256 secret is configured, the token is decoded untrusted (verified:false). */
export async function verifyAny(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;
  const header = b64urlToJson(h);
  if (header.alg !== "RS256") return verifyJwt(token);

  const claims = b64urlToJson(p);
  let keys;
  try { keys = await fetchJwks(); }
  catch (e) {
    if (!SECRET) return { claims, verified: false }; // dev/mock parity with the HS256 path
    throw new Error("corax jwks unavailable: " + e.message);
  }
  const jwk = (header.kid && keys.find((k) => k && k.kid === header.kid)) || keys[0];
  const pub = createPublicKey({ key: jwk, format: "jwk" });
  const ok = rsaVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), pub, b64urlToBuf(sig));
  if (!ok) throw new Error("bad signature");
  if (claims.exp && Math.floor(Date.now() / 1000) > Number(claims.exp)) throw new Error("token expired");
  return { claims, verified: true };
}

// Normalize a creator identity out of Supabase Auth claims. Verified against the live CoraX project
// (aokaupvmtakfegdpyvky): `sub` is the auth user id; `user_metadata` carries display_name / name /
// full_name and avatar_url / picture. It does NOT carry the token config, socials, channel, or wallet —
// those live in relational tables (profiles.wallet_address, profiles.linked_providers, the channel_*
// tables). So we read what's actually in the token and treat token/socials as OPTIONAL enrichment corax
// may add later via `custom_claims`; the caller supplies wallet/symbol when the JWT can't.
export function creatorFromClaims(claims = {}) {
  const meta = claims.user_metadata || claims.metadata || {};
  const custom = meta.custom_claims || claims.custom_claims || {};
  const token = meta.token || custom.token || claims.token || {};        // optional enrichment
  const socials = meta.socials || custom.socials || claims.socials || []; // optional enrichment
  const app = claims.app_metadata || {};
  const coraxCreatorId = claims.sub || meta.sub || meta.creator_id || meta.creatorId || "";
  return {
    coraxCreatorId,                                    // = auth.users.id = profiles.user_id = oneip_creator_tokens.creator_id
    channelId: meta.channel_id || meta.channelId || custom.channel_id || "", // empty unless corax adds it
    wallet: claims.wallet || meta.wallet_address || custom.wallet_address || "", // usually NOT in the JWT
    name: token.name || meta.display_name || meta.name || meta.full_name || claims.name || "",
    symbol: token.symbol || meta.symbol || "",         // not in the JWT → caller derives from name
    logo: token.logo || token.image || meta.avatar_url || meta.picture || "",
    website: token.website || meta.website || "",
    twitter: token.twitter || meta.twitter || "",
    telegram: token.telegram || meta.telegram || "",
    description: token.description || meta.bio || "",
    provider: app.provider || meta.provider_id || "",  // google / twitter / … (linked_providers)
    socials: Array.isArray(socials) ? socials : [],    // empty from a stock CoraX JWT → no auto-verify
  };
}
