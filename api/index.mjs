// Vercel serverless entrypoint. Vercel routes every request here (see vercel.json rewrites); the
// zero-dep Node HTTP handler serves both pages and API. ensureReady() loads launchpad state from
// Supabase once per cold start (memoized), then the same handler runs as on a persistent host.
import { handler, ensureReady } from "../src/server.js";

export default async function (req, res) {
  await ensureReady();
  return handler(req, res);
}
