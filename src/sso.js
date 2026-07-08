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
// (Asymmetric / JWKS verification — the reserved CORAX_JWT_JWKS_URL path — is a later extension:
//  Node's crypto.createPublicKey supports `format:"jwk"` directly, so add a cached JWKS fetch here
//  and branch on header.alg when corax moves to RS256/ES256.)
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.CORAX_JWT_SECRET || process.env.SUPABASE_JWT_SECRET || "";

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

// Normalize a creator identity out of Supabase Auth claims. Supabase nests app-specific fields under
// `user_metadata`; we also accept flat fields so corax can shape the token however it likes. Anything
// missing degrades to a sensible default at the call site.
export function creatorFromClaims(claims = {}) {
  const meta = claims.user_metadata || claims.metadata || {};
  const token = meta.token || claims.token || {};
  const socials = meta.socials || claims.socials || [];
  const coraxCreatorId = claims.sub || meta.creator_id || meta.creatorId || meta.channel_id || "";
  return {
    coraxCreatorId,
    channelId: meta.channel_id || meta.channelId || meta.creator_id || coraxCreatorId,
    wallet: claims.wallet || meta.wallet || meta.wallet_address || "",
    name: token.name || meta.display_name || meta.name || claims.name || "",
    symbol: token.symbol || meta.symbol || "",
    logo: token.logo || token.image || meta.avatar_url || meta.avatar || "",
    website: token.website || meta.website || "",
    twitter: token.twitter || meta.twitter || "",
    telegram: token.telegram || meta.telegram || "",
    description: token.description || meta.bio || "",
    socials: Array.isArray(socials) ? socials : [],
  };
}
