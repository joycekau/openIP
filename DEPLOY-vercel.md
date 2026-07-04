# Deploy OpenIP launchpad to Vercel + Supabase

OpenIP is a zero-dependency Node HTTP server. On Vercel it runs as a single serverless function
(`api/index.mjs`); every route is rewritten to it (`vercel.json`). Vercel's filesystem is read-only,
so persistence goes to **Supabase** (a `openip_kv` table).

## 1. Supabase (already provisioned)

- Project: **CoraX2** (`adlrkydasyjqxnooizbh`), table `public.openip_kv (key, value jsonb, updated_at)`.
- The server writes with the **service_role** key, which bypasses RLS. Keep it server-side only.

Get the service key: Supabase dashboard → project **CoraX2** → Project Settings → API →
`service_role` secret (or a `sb_secret_...` key). **Never expose it to the browser.**

## 2. Vercel environment variables

Project **open-ip** → Settings → Environment Variables (Production + Preview):

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://adlrkydasyjqxnooizbh.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the service_role secret from step 1 |
| `ADMIN_TOKEN` | a strong random string (guards `/admin`) |
| `PUBLIC_URL` | your production URL, e.g. `https://open-ip.vercel.app` |
| `HELIUS_API_KEY` | (optional) live KOL data — **rotate the old leaked key first** |
| `PINATA_JWT` | (optional) IPFS logo pinning — **rotate the old leaked key first** |

Leave any unset — the app degrades gracefully (mock/verify modes) without them.

## 3. Deploy

Production builds from `main`. Merge this branch into `main` (PR) and Vercel auto-deploys.
Preview deploys build from every branch push. Verify: open the URL → the launchpad home renders
(no 404), `/api/board` returns JSON.

## Local / Render alternative

With `SUPABASE_URL` unset, the app falls back to local `data/*.json` files — `npm run serve` locally,
or deploy to Render (persistent Node host) using `render.yaml`. Both work unchanged.
