// Browser-side kolpad client: mint a REAL token on Solana devnet, signed by the user's connected
// Solana wallet (any Wallet Standard wallet — Phantom, Solflare, Backpack …, via window.KolWallet).
// Ports the exact account ordering proven in scripts/sol/02-create-token.js. Loaded as an ES module
// (CDN web3.js); exposes window.OneChain. No private keys here — the user's wallet signs as the
// creator/fee-payer; a fresh mint keypair co-signs in-memory and is discarded.
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, Keypair, SYSVAR_RENT_PUBKEY,
} from "https://esm.sh/@solana/web3.js@1.95.3?bundle";
import { Buffer } from "https://esm.sh/buffer@6.0.3";
if (!globalThis.Buffer) globalThis.Buffer = Buffer; // some web3 paths expect a global Buffer

const PROGRAM_ID = new PublicKey("5SVSaKceFdzdynnuGJDFy74tspXDDxJccWRXh6B1NUdG");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
// = the Config.fee_recipient set at initialize (the kolpad deployer); create_token pays it 0.1◎.
const FEE_RECIPIENT = new PublicKey("4U5Jzb2H6DcmwqaNEMibBDy1zhezWutsjJXE1ByuC17r");
const RPC = "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

// The user's Solana wallet is chosen + connected through the shared connect modal (window.KolWallet,
// Wallet Standard). Signing flows require an already-connected wallet; the UI gates on this first.
function requireWallet() {
  const addr = window.KolWallet && window.KolWallet.address;
  if (!addr) throw new Error("Connect your Solana wallet first");
  return addr;
}
// Sign + broadcast a built transaction via the connected wallet. Returns the base58 signature.
function signAndSend(tx) {
  if (!window.KolWallet) throw new Error("Wallet connector not loaded");
  return window.KolWallet.signAndSend(tx, "solana:devnet", connection);
}

// Anchor discriminator = sha256("global:<name>")[0..8], via WebCrypto.
async function disc(name) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("global:" + name));
  return new Uint8Array(d).slice(0, 8);
}
function borshString(s) {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}
function borshU64(v) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(v), true); // little-endian u64
  return out;
}
// The holder's Associated Token Account for a mint (standard ATA derivation, no spl-token import).
function ataFor(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}
function cat(...arrs) {
  const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
  let i = 0; for (const x of arrs) { out.set(x, i); i += x.length; }
  return out;
}
const seed = (s) => new TextEncoder().encode(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

/** Mint a real token on devnet. uri defaults to this server's metadata endpoint for the new mint.
 *  Returns { mint, sig, explorer }. Throws on reject / insufficient SOL / program error. */
// Generate a mint keypair up front, so its metadata can be pinned to IPFS before minting.
function newMint() { return Keypair.generate(); }

async function createToken({ name, symbol, uri, mint } = {}) {
  if (!name || !symbol) throw new Error("name and symbol required");
  const creator = new PublicKey(requireWallet());

  if (!mint || !mint.publicKey) mint = Keypair.generate();
  const mintB58 = mint.publicKey.toBase58();
  const launch = pda([seed("launch"), mint.publicKey.toBytes()]);
  const vault = pda([seed("vault"), mint.publicKey.toBytes()]);
  const config = pda([seed("config")]);
  const metadata = PublicKey.findProgramAddressSync(
    [seed("metadata"), METADATA_PROGRAM_ID.toBytes(), mint.publicKey.toBytes()],
    METADATA_PROGRAM_ID
  )[0];
  const metaUri = uri || `${location.origin}/api/coin/metadata?mint=${mintB58}`;

  const data = Buffer.from(cat(await disc("create_token"), borshString(name), borshString(symbol), borshString(metaUri)));
  const keys = [
    { pubkey: launch, isSigner: false, isWritable: true },
    { pubkey: mint.publicKey, isSigner: true, isWritable: true },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = creator;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.partialSign(mint); // the mint co-signs its own creation; the wallet adds the creator signature
  const signature = await signAndSend(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { mint: mintB58, sig: signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
}

/** Preview a floor redemption WITHOUT sending: reads the vault balance, total supply, and the
 *  holder's balance via standard RPC (no on-chain struct parsing). payout ≈ vault × holder/supply.
 *  Returns { holderRaw, holderUi, supplyUi, vaultSol, fraction, estSol }. estSol is a close estimate
 *  (the vault also holds a tiny rent reserve); the on-chain pro-rata math is authoritative. */
async function redeemQuote(mintB58, ownerStr) {
  const mint = new PublicKey(mintB58);
  const owner = new PublicKey(ownerStr || requireWallet());
  const vault = pda([seed("vault"), mint.toBytes()]);
  const ata = ataFor(owner, mint);
  const [vaultLamports, supply, holder] = await Promise.all([
    connection.getBalance(vault),
    connection.getTokenSupply(mint).then((r) => r.value).catch(() => ({ amount: "0", uiAmount: 0 })),
    connection.getTokenAccountBalance(ata).then((r) => r.value).catch(() => ({ amount: "0", uiAmount: 0 })),
  ]);
  const holderRaw = holder.amount || "0";
  const supplyRaw = Number(supply.amount || 0);
  const fraction = supplyRaw > 0 ? Number(holderRaw) / supplyRaw : 0;
  const vaultSol = vaultLamports / 1e9;
  return { holderRaw, holderUi: holder.uiAmount || 0, supplyUi: supply.uiAmount || 0, vaultSol, fraction, estSol: vaultSol * fraction };
}

/** THE anti-rug exit: burn your tokens for a pro-rata share of the locked floor vault. Redeems the
 *  holder's FULL balance by default (pass rawAmount for a partial burn). Phantom signs as the holder
 *  + fee-payer. Ports the RedeemFloor account order from lib.rs. Returns { sig, explorer, redeemedRaw }. */
async function redeemFloor({ mint: mintB58, rawAmount } = {}) {
  if (!mintB58) throw new Error("mint required");
  const holder = new PublicKey(requireWallet());
  const mint = new PublicKey(mintB58);
  const launch = pda([seed("launch"), mint.toBytes()]);
  const vault = pda([seed("vault"), mint.toBytes()]);
  const holderToken = ataFor(holder, mint);

  let amount = rawAmount;
  if (amount == null) {
    const bal = await connection.getTokenAccountBalance(holderToken).then((r) => r.value.amount).catch(() => "0");
    amount = bal;
  }
  if (!amount || BigInt(amount) <= 0n) throw new Error("you hold none of this token to redeem");

  const data = Buffer.from(cat(await disc("redeem_floor"), borshU64(amount)));
  const keys = [
    { pubkey: launch, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: holderToken, isSigner: false, isWritable: true },
    { pubkey: holder, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, keys, data }));
  tx.feePayer = holder;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await signAndSend(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { sig: signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, redeemedRaw: String(amount) };
}

// Idempotent create of an Associated Token Account (no spl-token import). data=[1] = createIdempotent.
function createAtaIx(payer, owner, mint, ata) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Buy on the bonding curve: 80% → LP, 20% → floor vault, 1.25% fee (0.75 platform / 0.5 creator).
 *  Creates the buyer's ATA if missing. `creator` = the launch's on-chain creator (from the launch
 *  record). Ports the Buy account order from lib.rs. Returns { sig, explorer }. */
async function buy({ mint: mintB58, creator, solAmount } = {}) {
  if (!mintB58 || !creator) throw new Error("mint and creator required");
  if (!(solAmount > 0)) throw new Error("SOL amount must be > 0");
  const buyer = new PublicKey(requireWallet());
  const mint = new PublicKey(mintB58);
  const launch = pda([seed("launch"), mint.toBytes()]);
  const vault = pda([seed("vault"), mint.toBytes()]);
  const buyerToken = ataFor(buyer, mint);
  const lamports = BigInt(Math.round(solAmount * 1e9));

  const tx = new Transaction();
  if (!(await connection.getAccountInfo(buyerToken))) tx.add(createAtaIx(buyer, buyer, mint, buyerToken));
  // Anchor handler is buy(lamports_in, min_tokens_out) — serialize BOTH u64s. min_tokens_out=0 =
  // market order (no slippage floor). Wire a slippage input to raise it later.
  const data = Buffer.from(cat(await disc("buy"), borshU64(lamports), borshU64(0)));
  tx.add(new TransactionInstruction({ programId: PROGRAM_ID, data, keys: [
    { pubkey: launch, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: buyerToken, isSigner: false, isWritable: true },
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(creator), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ] }));
  tx.feePayer = buyer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await signAndSend(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { sig: signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
}

/** Sell on the curve: seller receives the curve payout minus 1.25% fee and a 2% floor tax (the tax
 *  goes INTO the floor vault — "dumping raises the floor"). Sells the FULL balance by default. Ports
 *  the SellMarket account order from lib.rs. Returns { sig, explorer, soldRaw }. */
async function sellMarket({ mint: mintB58, creator, rawAmount } = {}) {
  if (!mintB58 || !creator) throw new Error("mint and creator required");
  const seller = new PublicKey(requireWallet());
  const mint = new PublicKey(mintB58);
  const launch = pda([seed("launch"), mint.toBytes()]);
  const vault = pda([seed("vault"), mint.toBytes()]);
  const sellerToken = ataFor(seller, mint);
  let amount = rawAmount;
  if (amount == null) amount = await connection.getTokenAccountBalance(sellerToken).then((r) => r.value.amount).catch(() => "0");
  if (!amount || BigInt(amount) <= 0n) throw new Error("you hold none of this token to sell");

  // Anchor handler is sell_market(token_amount, min_lamports_out) — serialize BOTH u64s.
  // min_lamports_out=0 = market order (no slippage floor).
  const data = Buffer.from(cat(await disc("sell_market"), borshU64(amount), borshU64(0)));
  const tx = new Transaction().add(new TransactionInstruction({ programId: PROGRAM_ID, data, keys: [
    { pubkey: launch, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: sellerToken, isSigner: false, isWritable: true },
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(creator), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ] }));
  tx.feePayer = seller;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await signAndSend(tx);
  await connection.confirmTransaction(signature, "confirmed");
  return { sig: signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, soldRaw: String(amount) };
}

// Debug: derive the same PDAs + discriminator the tx uses, to cross-check against the Node client.
async function derive(mintB58) {
  const mint = new PublicKey(mintB58);
  const hex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    disc: hex(await disc("create_token")),
    launch: pda([seed("launch"), mint.toBytes()]).toBase58(),
    vault: pda([seed("vault"), mint.toBytes()]).toBase58(),
    config: pda([seed("config")]).toBase58(),
    metadata: PublicKey.findProgramAddressSync([seed("metadata"), METADATA_PROGRAM_ID.toBytes(), mint.toBytes()], METADATA_PROGRAM_ID)[0].toBase58(),
    redeemDisc: hex(await disc("redeem_floor")),
    buyDisc: hex(await disc("buy")),
    sellDisc: hex(await disc("sell_market")),
    ata: ataFor(mint, mint).toBase58(), // shape check only (owner==mint is nonsense, just proves derivation runs)
  };
}

window.OneChain = { createToken, newMint, buy, sellMarket, redeemFloor, redeemQuote, derive, cluster: "devnet", programId: PROGRAM_ID.toBase58() };
