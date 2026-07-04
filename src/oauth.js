// OAuth social verification — proves a creator actually CONTROLS an account, and reads the
// follower count, so "verified" means "real creator with reach", not "owns 3 throwaway handles".
//
// Each provider needs an app registered at the platform (CLIENT_ID/SECRET in .env). When those
// are absent the provider runs in MOCK mode: it synthesizes a verified profile so the whole flow
// and the follower gate are demonstrable without real app credentials (same pattern as Helius).
import { randomInt } from "node:crypto";

const PROVIDERS = {
  twitter:   { env: "TWITTER",   authBase: "https://twitter.com/i/oauth2/authorize",       scope: "users.read tweet.read" },
  telegram:  { env: "TELEGRAM",  authBase: "https://oauth.telegram.org/auth",              scope: "" },
  discord:   { env: "DISCORD",   authBase: "https://discord.com/oauth2/authorize",         scope: "identify guilds" },
  tiktok:    { env: "TIKTOK",    authBase: "https://www.tiktok.com/v2/auth/authorize",     scope: "user.info.basic,user.info.stats" },
  youtube:   { env: "YOUTUBE",   authBase: "https://accounts.google.com/o/oauth2/v2/auth", scope: "https://www.googleapis.com/auth/youtube.readonly" },
  instagram: { env: "INSTAGRAM", authBase: "https://api.instagram.com/oauth/authorize",    scope: "user_profile" },
};

export const PLATFORMS = Object.keys(PROVIDERS);

export function isConfigured(platform) {
  const p = PROVIDERS[platform];
  if (!p) return false;
  return Boolean(process.env[`${p.env}_CLIENT_ID`] && process.env[`${p.env}_CLIENT_SECRET`]);
}

/** Authorize URL to redirect the creator to (real flow). */
export function authUrl(platform, state, redirectUri) {
  const p = PROVIDERS[platform];
  if (!p) throw new Error("unsupported platform");
  const clientId = process.env[`${p.env}_CLIENT_ID`] || "MOCK_CLIENT_ID";
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: p.scope, state });
  return `${p.authBase}?${q.toString()}`;
}

// Real mode: exchange `code` for a token, then hit the platform's profile + stats endpoints to
// read the verified handle and follower count. (Per-platform — wire when you have app creds.)
// Mock mode: synthesize a verified creator profile so the flow + follower gate are demonstrable.
export async function verifyProfile(platform, code, opts = {}) {
  if (!PROVIDERS[platform]) throw new Error("unsupported platform");
  if (isConfigured(platform) && code) {
    throw new Error(`real ${platform} OAuth exchange not wired yet — add the token + profile calls in oauth.js`);
  }
  const followers = opts.followers != null ? Number(opts.followers) : randomInt(2000, 480000);
  return {
    platform,
    userId: `${platform}_${randomInt(100000, 999999)}`,
    handle: opts.handle || `creator${randomInt(100, 999)}`,
    followers,
    verifiedOwnership: true,
    mock: true,
  };
}
