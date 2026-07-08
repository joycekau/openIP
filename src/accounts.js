// Email-first accounts for oneIP. Register with email + password (pick a handle); the HANDLE is
// your account identity everywhere (storefront, studio, value pool — same string the rest of the app
// already uses as `account`/`creator`). A Phantom WALLET is bound LATER, only when you go on-chain to
// mint your value-pool token. Low friction for normies; crypto is opt-in.
// Persistence goes through persist.js (Supabase KV on Vercel, data/accounts.json locally).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { loadJson, saveJson } from "./persist.js";

const KEY = "accounts";
// 1-gen refer-a-friend: the referral bond closes PERMANENTLY after this many days with no settled
// sale by the referred creator (use-it-or-lose-it; severs dormant chains). user-locked at 60d.
const REFERRAL_INACTIVE_DAYS = Number(process.env.REFERRAL_INACTIVE_DAYS || 60);
const RESET_TTL_MS = Number(process.env.RESET_TTL_MIN || 30) * 60 * 1000; // password-reset link validity

let accounts = {}; // handle -> { handle, email, salt, hash, wallet, referrerHandle, agentCountry, agentLocalId, lastSettledSaleAt, referralClosed, createdAt }
let sessions = {}; // token -> handle
let resets = {};   // reset token -> { handle, expires }
let loaded = false;

// An email service is wired via env (e.g. RESEND_API_KEY / SMTP_URL). Until then, reset runs in
// dev mode: the reset link is returned to the caller instead of emailed (mirrors billing/ipfs).
const emailConfigured = () => Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);

const newToken = () => randomBytes(24).toString("hex");
const hashPw = (pw, salt) => scryptSync(pw, salt, 64).toString("hex");
const norm = (s) => String(s || "").trim().toLowerCase();

export async function load() {
  const d = await loadJson(KEY, {});
  accounts = d.accounts || {}; sessions = d.sessions || {}; resets = d.resets || {};
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() { saveJson(KEY, { accounts, sessions, resets }); }

const byEmail = (email) => Object.values(accounts).find((a) => a.email === norm(email)) || null;
const publicAccount = (a) => a && ({ handle: a.handle, email: a.email, wallet: a.wallet || "",
  referrerHandle: a.referrerHandle || "", agentCountry: a.agentCountry || "", agentLocalId: a.agentLocalId || "",
  createdAt: a.createdAt });

/** Register with email + password, choosing a handle (your account id everywhere). An optional
 *  `referrer` (an existing handle, not yourself) records the 1-gen refer-a-friend bond — written
 *  ONCE here and never editable after, so it can't be re-pointed later. Bad/self referrers are
 *  silently dropped (registration still succeeds). */
export function register({ handle, email, password, referrer }) {
  handle = String(handle || "").trim();
  if (!/^[A-Za-z0-9_]{2,20}$/.test(handle)) throw new Error("handle: 2-20 letters/numbers/underscore");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw new Error("a valid email is required");
  if (!password || password.length < 6) throw new Error("password must be at least 6 characters");
  if (accounts[handle]) throw new Error("that handle is taken");
  if (byEmail(email)) throw new Error("that email is already registered");
  const ref = String(referrer || "").trim();
  const referrerHandle = ref && ref !== handle && accounts[ref] ? ref : ""; // must be an existing, different account
  const salt = randomBytes(16).toString("hex");
  accounts[handle] = { handle, email: norm(email), salt, hash: hashPw(password, salt), wallet: "",
    referrerHandle, agentCountry: "", agentLocalId: "", lastSettledSaleAt: 0, referralClosed: false,
    createdAt: Date.now() };
  const token = newToken(); sessions[token] = handle;
  persist();
  return { ...publicAccount(accounts[handle]), token };
}

/** Log in with email OR handle + password. */
export function login({ id, password }) {
  const a = accounts[String(id || "").trim()] || byEmail(id);
  if (!a) throw new Error("account not found");
  const expected = Buffer.from(a.hash, "hex");
  const got = Buffer.from(hashPw(password || "", a.salt), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error("wrong password");
  const token = newToken(); sessions[token] = a.handle;
  persist();
  return { ...publicAccount(a), token };
}

/** Start a password reset. `id` = email or handle. Anti-enumeration: ALWAYS returns {ok:true} even
 *  if no such account (never reveals which emails are registered). Dev mode (no email service) returns
 *  a `devToken` so the flow is testable locally; production emails the link and omits the token. */
export function requestReset({ id }) {
  const a = accounts[String(id || "").trim()] || byEmail(id);
  if (!a) return { ok: true }; // silent — don't leak existence
  // Invalidate any prior reset token for this account, issue a fresh one.
  for (const t in resets) if (resets[t].handle === a.handle) delete resets[t];
  const token = newToken();
  resets[token] = { handle: a.handle, expires: Date.now() + RESET_TTL_MS };
  persist();
  if (emailConfigured()) return { ok: true, emailed: true }; // TODO: actually send via RESEND_API_KEY/SMTP
  return { ok: true, devToken: token }; // dev: caller shows the link directly
}

/** Complete a reset: set a new password, consume the token, invalidate all old sessions (force
 *  re-login everywhere), and issue a fresh session so the user is logged in immediately. */
export function resetPassword({ token, password }) {
  const r = resets[token];
  if (!r || r.expires < Date.now()) { delete resets[token]; throw new Error("reset link is invalid or expired"); }
  if (!password || password.length < 6) throw new Error("password must be at least 6 characters");
  const a = accounts[r.handle];
  if (!a) throw new Error("account not found");
  const salt = randomBytes(16).toString("hex");
  a.salt = salt; a.hash = hashPw(password, salt);
  delete resets[token];
  for (const t in sessions) if (sessions[t] === a.handle) delete sessions[t]; // kill existing sessions
  const nt = newToken(); sessions[nt] = a.handle;
  persist();
  return { ...publicAccount(a), token: nt };
}

/** SSO login from corax.live (the caller has already VERIFIED the corax token). Finds the account
 *  bound to this corax identity — or matches by the token's verified email, binding it — else
 *  auto-creates a passwordless account (random unguessable hash; password login stays off until a
 *  reset) with a handle derived from the display name / email. Returns a fresh session + `created`. */
export function loginWithCorax({ coraxId, email, name }) {
  coraxId = String(coraxId || "").trim();
  if (!coraxId) throw new Error("corax identity required");
  let a = Object.values(accounts).find((x) => x.coraxId === coraxId) || (email ? byEmail(email) : null);
  const created = !a;
  if (!a) {
    const base = (String(name || "").replace(/[^A-Za-z0-9_]/g, "") ||
      String(email || "").split("@")[0].replace(/[^A-Za-z0-9_]/g, "") || "creator").slice(0, 16);
    let handle = base.length >= 2 ? base : `cx${base || coraxId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`;
    for (let i = 2; accounts[handle]; i++) handle = `${base.slice(0, 14) || "creator"}${i}`;
    const salt = randomBytes(16).toString("hex");
    a = accounts[handle] = { handle, email: norm(email || ""), salt,
      hash: hashPw(randomBytes(24).toString("hex"), salt), wallet: "",
      referrerHandle: "", agentCountry: "", agentLocalId: "",
      lastSettledSaleAt: 0, referralClosed: false, coraxId, createdAt: Date.now() };
  } else if (!a.coraxId) {
    a.coraxId = coraxId; // email matched an existing account — bind the corax identity to it
  }
  const token = newToken(); sessions[token] = a.handle;
  persist();
  return { ...publicAccount(a), token, created };
}

export function resolveToken(token) { return sessions[token] || null; }

/** Guard for creator-owned writes. If `claimedHandle` is a REGISTERED account, the request MUST
 *  carry that account's session token (blocks impersonation). Unregistered handles / bare wallets
 *  are left open (legacy wallet-based flows) — a documented, narrowing remaining gap. */
export function verifyActor(token, claimedHandle) {
  const h = String(claimedHandle || "").trim();
  if (!h || !accounts[h]) return { ok: true, registered: false }; // not a registered account → open
  return { ok: sessions[token] === h, registered: true };
}
export function me(token) { const h = sessions[token]; return h ? publicAccount(accounts[h]) : null; }
export function logout(token) { delete sessions[token]; persist(); return { ok: true }; }
export function getAccount(handle) { return publicAccount(accounts[handle]); }
export function list() { return Object.values(accounts).map(publicAccount).sort((a, b) => b.createdAt - a.createdAt); }

/** Resolve a bound Phantom wallet back to its account handle (the identity link). */
export function handleForWallet(wallet) {
  if (!wallet) return null;
  const w = String(wallet).trim();
  const a = Object.values(accounts).find((x) => x.wallet === w);
  return a ? a.handle : null;
}
export function byWallet(wallet) {
  const h = handleForWallet(wallet);
  return h ? publicAccount(accounts[h]) : null;
}

/** Bind a Phantom wallet to the account later (so the on-chain value-pool launch is tied to it). */
export function bindWallet(token, wallet) {
  const h = sessions[token];
  if (!h || !accounts[h]) throw new Error("not signed in");
  if (!wallet) throw new Error("wallet required");
  accounts[h].wallet = String(wallet).trim();
  persist();
  return publicAccount(accounts[h]);
}

/** Assign which authorized regional partners a creator belongs to (set by admin/onboarding). */
export function assignAgents(handle, { countryId = null, localId = null } = {}) {
  const a = accounts[handle]; if (!a) throw new Error("account not found");
  if (countryId !== null) a.agentCountry = String(countryId || "");
  if (localId !== null) a.agentLocalId = String(localId || "");
  persist();
  return publicAccount(a);
}

/** Resolve the commission parties for a creator's sale (called once per settle). `creator` may be a
 *  handle or a bound wallet. Evaluates the 60-day refer-a-friend gate AND mutates activity state:
 *  a gap >= REFERRAL_INACTIVE_DAYS between settled sales permanently closes the referral bond, so
 *  that sale (and all later ones) no longer pays the referrer. Empty fields => platform absorbs. */
export function resolveSaleParties(creator, saleTs = Date.now()) {
  let a = accounts[String(creator || "").trim()];
  if (!a) { const h = handleForWallet(creator); a = h ? accounts[h] : null; }
  if (!a) return { account: "", countryAgentId: "", localAgentId: "", referrerHandle: "", referrerActive: false };
  let referrerActive = false;
  if (a.referrerHandle && !a.referralClosed) {
    if (a.lastSettledSaleAt && saleTs - a.lastSettledSaleAt >= REFERRAL_INACTIVE_DAYS * 864e5) {
      a.referralClosed = true; // dormant too long -> permanent close (option A)
    } else {
      referrerActive = true;
    }
  }
  a.lastSettledSaleAt = saleTs;
  persist();
  return {
    account: a.handle,
    countryAgentId: a.agentCountry || "",
    localAgentId: a.agentLocalId || "",
    referrerHandle: referrerActive ? a.referrerHandle : "",
    referrerActive,
  };
}
