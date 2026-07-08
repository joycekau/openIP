// AI clone — drafts a reply in the creator's voice using the official Anthropic SDK.
// Enabled when ANTHROPIC_API_KEY is set AND @anthropic-ai/sdk is installed (npm install).
// The SDK is loaded lazily so the rest of the server runs zero-install when AI is off.
//
// Model defaults to claude-opus-4-8. Override with AI_MODEL — e.g. claude-haiku-4-5 for a
// cheaper, faster high-volume reply bot (that's the operator's cost decision, not a default).
const KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-opus-4-8";

export function hasKey() {
  return Boolean(KEY);
}

let clientPromise = null;
async function getClient() {
  if (!KEY) return null;
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk")
      .then((m) => new m.default({ apiKey: KEY }))
      .catch(() => null); // SDK not installed -> AI disabled, caller falls back to canned replies
  }
  return clientPromise;
}

/** Generate a reply as the creator to a fan's comment. Returns null on any failure (never throws). */
export async function generateReply(creator, post, fanComment) {
  const client = await getClient();
  if (!client) return null;

  const persona = (creator.aiPersona || "").trim();
  const system = persona
    ? persona
    : `You are ${creator.displayName || "a creator"} on oneIP.io, replying to a fan's comment in first person.` +
      (creator.bio ? ` Your bio: ${creator.bio}.` : "") +
      " Keep it warm, on-brand, and to 1-2 sentences. No hashtags, no emoji spam. If a comment is hostile or spam, reply briefly and politely.";

  const content =
    `Your post said: "${(post.text || "(image post)").slice(0, 500)}"\n` +
    `A fan commented: "${fanComment.slice(0, 500)}"\n` +
    `Write your reply as the creator.`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content }],
    });
    const text = res.content.find((b) => b.type === "text")?.text?.trim();
    return text || null;
  } catch {
    return null; // never break commenting because the AI call failed
  }
}

/** Draft a social post in the creator's voice from a topic/idea. Returns null on any failure. */
export async function generatePost(creator, prompt) {
  const client = await getClient();
  if (!client) return null;

  const persona = (creator.aiPersona || "").trim();
  const system =
    `You write short social posts as ${creator.displayName || "a creator"} on oneIP.io, in first person.` +
    (creator.bio ? ` Bio: ${creator.bio}.` : "") +
    (persona ? ` Voice/persona: ${persona}.` : "") +
    " The same text is posted to several platforms (X, TikTok, YouTube, Instagram), so keep it platform-neutral," +
    " punchy, 1-3 sentences, at most a couple of tasteful hashtags. Output only the post text — no preamble.";

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: `Write a post about: ${String(prompt).slice(0, 600)}` }],
    });
    return res.content.find((b) => b.type === "text")?.text?.trim() || null;
  } catch {
    return null;
  }
}
