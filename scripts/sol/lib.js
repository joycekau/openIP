// Minimal hand-rolled Anchor client for kolpad on devnet (no IDL needed).
// Computes instruction discriminators + PDAs, signs with the devnet deployer keypair.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Buffer } from "node:buffer";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export const PROGRAM_ID = new PublicKey("5SVSaKceFdzdynnuGJDFy74tspXDDxJccWRXh6B1NUdG");
// Metaplex Token Metadata program (same on devnet + mainnet)
export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";

export const connection = new Connection(RPC, "confirmed");

export function loadDeployer() {
  const p = join(__dir, "..", "..", "onchain", ".deployer.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

/** Anchor 8-byte instruction discriminator = sha256("global:<name>")[0..8]. */
export function disc(name) {
  return createHash("sha256").update("global:" + name).digest().subarray(0, 8);
}

/** Derive a PDA owned by the kolpad program. */
export function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

/** Metaplex metadata PDA for a mint. */
export function metadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

/** Borsh-encode a string (u32 LE length prefix + utf8 bytes). */
export function borshString(s) {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

/** u64 little-endian. */
export function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

export { Buffer };
