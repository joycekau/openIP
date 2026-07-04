// Outbound multi-platform publishing — AiToEarn as a HIDDEN white-label engine.
// Creators never see AiToEarn: oneIP proxies everything. This wraps its REST v2 API:
//   - connect a social account (OAuth, the platform's own consent page is the only non-oneIP
//     screen; redirectUri brings the creator back to oneip.io)
//   - one-click publish the same content to every chosen platform
// Auth is a single platform-wide master key (x-api-key); per-creator account ids are tracked
// on the oneIP side (creator.publishAccounts). Mock mode (no AITOEARN_API_KEY) synthesizes
// responses so the whole flow is demonstrable without the engine running — same pattern as sync.js.

const BASE = (process.env.AITOEARN_BASE_URL || "http://localhost:8080/api").replace(/\/+$/, "");
const API_KEY = process.env.AITOEARN_API_KEY || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:8787").replace(/\/+$/, "");

// Platforms creators can one-click publish to. 13 are AiToEarn-native; `github` is for dev/builder
// creators and needs its own GitHub adapter (OAuth + gist/release/discussion API) wired at deploy.
export const PLATFORMS = [
  "twitter", "tiktok", "youtube", "instagram", "facebook", "linkedin",
  "pinterest", "threads", "bilibili", "douyin", "kwai", "rednote", "wechat",
  "github",
];

export const isLive = () => !!API_KEY;

async function api(method, pathname, { query, body } = {}) {
  const url = new URL(BASE + "/v2" + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { "x-api-key": API_KEY, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`AiToEarn ${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

/** Start connecting a creator's social account.
 *  Returns { authUrl, sessionId }: send the creator to authUrl (the platform's consent page,
 *  branded with YOUR dev app so it reads "oneIP"), they land back on oneip.io afterward. */
export async function connectStart(platform, wallet) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unsupported platform: ${platform}`);
  const redirectUri = `${PUBLIC_URL}/feed?connected=${platform}`;
  if (!isLive()) return { authUrl: `${redirectUri}&mock=1`, sessionId: `mock-${platform}-${Date.now()}`, mock: true };
  const data = await api("GET", `/channels/accounts/auth/${platform}`, { query: { redirectUri } });
  return { authUrl: data.authUrl || data.url, sessionId: data.sessionId, mock: false };
}

/** Poll whether the OAuth handshake finished. On success returns { status, accountId }. */
export async function connectStatus(platform, sessionId) {
  if (!isLive() || String(sessionId).startsWith("mock-")) return { status: "authorized", accountId: `mock-acct-${platform}` };
  const data = await api("GET", `/channels/accounts/auth/${platform}/status/${sessionId}`);
  return { status: data.status, accountId: data.accountId || data.account?.id, raw: data };
}

/** Every social account bound under the platform master key (admin view). */
export async function listAccounts() {
  if (!isLive()) return [];
  const data = await api("GET", "/channels/accounts");
  return data.list || data.items || data;
}

/** One-click publish to every chosen platform.
 *  items = [{ accountId, platform }]. Text fills both title and body so it works across
 *  micro-blog (X) and long-form (YouTube) platforms; per-platform tweaks go via overrides later. */
export async function publish({ text, mediaUrls = [], items, publishAt }) {
  if (!Array.isArray(items) || !items.length) throw new Error("no target accounts");
  const content = {
    title: (text || "").slice(0, 100),
    body: text || "",
    media: mediaUrls.map((url) => ({ url, options: {} })),
  };
  const payload = { content, publishAt: publishAt || new Date().toISOString(), items };
  if (!isLive()) return { flowId: `mock-flow-${Date.now()}`, status: "queued", items, mock: true };
  return api("POST", "/channels/publish/flows", { body: payload });
}

/** Result/status of a publish flow created by publish(). */
export async function publishStatus(flowId) {
  if (!isLive() || String(flowId).startsWith("mock-")) return { flowId, status: "published", mock: true };
  return api("GET", `/channels/publish/flows/${flowId}`);
}
