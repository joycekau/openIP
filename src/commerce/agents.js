// Authorized regional partners (公开措辞: "授权区域伙伴 / Authorized regional partner"). These are
// APPOINTED, territory-based B2B distribution partners — NOT a recruit-to-earn scheme. The hierarchy
// is hard-capped at exactly TWO tiers:
//
//   country partner (国家代理)  ──parent of──►  local partner (地方代理)  ──assigned to──►  creators
//
// A local partner MUST have a parent country partner; a partner can never have a partner below a
// local one (no `parent` of a country, no children of a local). This makes a 3rd tier structurally
// impossible — the single most important guardrail keeping this distribution, not MLM. Partners earn
// a "channel service commission" out of the platform fee pool (see orders.js) on REAL completed
// sales in their territory, as consideration for onboarding + local support.
import { randomBytes } from "node:crypto";
import { loadJson, saveJson } from "../persist.js";

const KEY = "agents";

let agents = {}; // id -> { id, tier, name, territory, contact, payoutHandle, parentCountryId, active, createdAt }
let loaded = false;

const newId = () => "agt_" + randomBytes(6).toString("hex");

export async function load() {
  agents = await loadJson(KEY, {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() { saveJson(KEY, agents); }

export function get(id) { return agents[id] || null; }
export function list({ tier } = {}) {
  return Object.values(agents)
    .filter((a) => (!tier || a.tier === tier))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Appoint a partner. tier="country" has no parent; tier="local" REQUIRES an existing country
 *  partner as parentCountryId (this is the 2-tier cap — locals cannot parent other partners). */
export function register({ tier, name, territory, contact, payoutHandle, parentCountryId }) {
  tier = String(tier || "").trim();
  if (tier !== "country" && tier !== "local") throw new Error('tier must be "country" or "local"');
  if (!name) throw new Error("name required");
  if (!contact) throw new Error("contact required");
  let parent = "";
  if (tier === "local") {
    parent = String(parentCountryId || "").trim();
    const p = agents[parent];
    if (!p || p.tier !== "country") throw new Error("a local partner requires an existing country partner as parent");
  }
  const id = newId();
  agents[id] = {
    id, tier, name: String(name).trim(), territory: String(territory || "").trim(),
    contact: String(contact).trim(), payoutHandle: String(payoutHandle || "").trim(),
    parentCountryId: parent, active: true, createdAt: Date.now(),
  };
  persist();
  return agents[id];
}

export function setActive(id, active) {
  const a = agents[id]; if (!a) throw new Error("agent not found");
  a.active = !!active; persist(); return a;
}

/** Assign a creator (account handle) to a LOCAL partner. The creator's country partner is derived
 *  from the local's parent, so onboarding sets both tiers in one step and the 2-tier shape holds.
 *  Returns the { localId, countryId } to stamp on the account (via accounts.assignAgents). */
export function resolveAssignment(localAgentId) {
  const local = agents[localAgentId];
  if (!local || local.tier !== "local") throw new Error("not a local partner");
  return { localId: local.id, countryId: local.parentCountryId || "" };
}
