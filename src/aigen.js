// AI content gateway (Cora — gateway.corax.live). OpenAI-compatible: ONE key routes to many models
// (gpt-5.x, claude-*, deepseek, gemini). Lets a creator with NO works of their own generate
// publishable MATERIAL — post copy, product descriptions, content ideas — then publish → become a
// creator + auto value pool. Zero-dep (native fetch).
//
// Mock-first (mirrors billing/ipfs/publish): no CORAX_API_KEY → demo output so the flow runs
// locally; set the key later to route to real models. The interface stays identical either way.
// NOTE: corax's /v1/models lists TEXT models only — image/video generation needs a separate service.
const KEY = process.env.CORAX_API_KEY || "";
const BASE = (process.env.CORAX_BASE_URL || "https://gateway.corax.live/v1").replace(/\/$/, "");
const MODEL = process.env.CORAX_MODEL || "gpt-4o-mini"; // cheap default; operator can raise it

export function hasAigen() { return Boolean(KEY); }

// System prompt per material kind. `c` = the creator's display name/handle (for voice).
const SYSTEM = {
  post: (c) => `You write a short, punchy social post as ${c || "a creator"} on oneIP, first person, platform-neutral (X/TikTok/Instagram), 1-3 sentences, at most a couple of tasteful hashtags. Output only the post text — no preamble.`,
  product: (c) => `You write e-commerce copy for ${c || "a creator"}'s product on oneIP. Output a catchy title (max 8 words) on the first line, then a 2-3 sentence description. No preamble.`,
  idea: (c) => `You are a content strategist for ${c || "a creator"} on oneIP. Suggest 3 concrete, postable content ideas as a short bulleted list. No preamble.`,
};

// Demo output when no key is set — keeps the "generate → publish → become creator" flow runnable.
function mock(kind, prompt) {
  const p = String(prompt || "your idea").slice(0, 80);
  if (kind === "product") return `${p} — limited drop\nHand-made ${p}, built to last and priced fair. Every sale quietly builds your on-chain value pool. Grab yours before it's gone.`;
  if (kind === "idea") return `• A behind-the-scenes of how you make ${p}\n• A 30-second "day in the life" clip around ${p}\n• Ask your fans to vote on your next ${p}`;
  return `Just made something new around ${p} — been working on this a while, tell me what you think. ✨ #oneIP`;
}

/** Generate publishable material. kind ∈ {post, product, idea}. Never throws — falls back to mock,
 *  so a failed/again-unkeyed AI call never breaks the creator's publish flow. */
export async function generateMaterial({ kind = "post", prompt = "", creator = "" } = {}) {
  const k = SYSTEM[kind] ? kind : "post";
  if (!KEY) return { text: mock(k, prompt), model: "mock", mock: true };
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM[k](creator) },
          { role: "user", content: `Topic: ${String(prompt).slice(0, 600)}` },
        ],
      }),
    });
    const data = await r.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text || !text.trim()) throw new Error("empty response");
    return { text: text.trim(), model: MODEL, mock: false };
  } catch {
    return { text: mock(k, prompt), model: "mock", mock: true }; // never break the publish flow
  }
}
