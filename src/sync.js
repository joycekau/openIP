// Social-platform sync — mirrors a creator's posts from a bound platform into the oneIP feed.
// Real mode needs that platform's read API + the creator's stored OAuth token (per-platform,
// wire in fetchLatest). Mock mode (default) synthesizes one sample post so the flow is
// demonstrable without credentials. Trigger via POST /api/sync/now (or a scheduler in prod).
import * as social from "./social.js";

export const PLATFORMS = ["twitter", "instagram", "tiktok", "youtube"];

// Fetch posts newer than `since` from the platform for `handle`.
// TODO real: e.g. Twitter/X GET /2/users/:id/tweets with the creator's bearer token,
// map each to { text, image, ts }. Each platform differs — implement per provider.
async function fetchLatest(platform, handle, since) {
  // mock: one fresh item
  return [{ text: `New update from @${handle || "creator"} (synced from ${platform}).`, image: "", ts: Date.now() }];
}

/** Pull a creator's latest from their bound platform and mirror into the feed (deduped by ts). */
export async function syncCreator(creator) {
  if (!creator || !creator.syncPlatform) return { synced: 0 };
  if (!PLATFORMS.includes(creator.syncPlatform)) return { synced: 0, error: "unsupported platform" };
  const since = creator.syncSince || 0;
  const items = (await fetchLatest(creator.syncPlatform, creator.syncHandle, since)).filter((i) => i.ts > since);
  for (const it of items) {
    social.createPost({ creator: creator.wallet, text: it.text, image: it.image, synced: true, source: creator.syncPlatform });
  }
  if (items.length) social.setCreator(creator.wallet, { syncSince: Math.max(...items.map((i) => i.ts)) });
  return { synced: items.length, platform: creator.syncPlatform };
}
