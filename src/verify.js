// Platform attester — signs a verification attestation once a creator binds >= 3 socials.
// MVP uses HMAC as a stand-in. On-chain (Solana) analog: an ed25519 signature by the
// platform attester pubkey, verified inside the `verify_token` instruction. Same trust model:
// you trust the platform ONLY for the social check; funds/floor stay fully trustless.
import { createHmac } from "node:crypto";

const SECRET = process.env.PLATFORM_ATTESTER_SECRET || "dev-attester-secret-change-me";
export const MIN_SOCIALS = 3;

export function signAttestation({ mint, creator, socialCount, expiry }) {
  const msg = `${mint}|${creator}|${socialCount}|${expiry}`;
  return createHmac("sha256", SECRET).update(msg).digest("hex");
}

export function verifyAttestation(payload, sig) {
  return signAttestation(payload) === sig;
}
