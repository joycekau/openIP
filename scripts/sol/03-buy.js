// buy: spend SOL on the bonding curve. Proves 80% → curve, 20% → floor vault.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Transaction, TransactionInstruction, SystemProgram,
  sendAndConfirmTransaction, PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection, PROGRAM_ID, loadDeployer, disc, pda, u64, Buffer } from "./lib.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const buyer = loadDeployer();
const mint = new PublicKey(readFileSync(join(__dir, ".last-mint.txt"), "utf8").trim());

const launch = pda([Buffer.from("launch"), mint.toBuffer()]);
const vault = pda([Buffer.from("vault"), mint.toBuffer()]);
const config = pda([Buffer.from("config")]);
const feeRecipient = buyer.publicKey;
const creator = buyer.publicKey; // = launch.creator
const buyerAta = await getAssociatedTokenAddress(mint, buyer.publicKey);

const LAMPORTS_IN = 500_000_000; // 0.5 SOL
const MIN_OUT = 0;

const vaultBefore = await connection.getBalance(vault);
console.log("mint        :", mint.toBase58());
console.log("vault before:", (vaultBefore / 1e9).toFixed(6), "SOL");
console.log("buying with :", (LAMPORTS_IN / 1e9).toFixed(2), "SOL\n");

const ataIx = createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, buyerAta, buyer.publicKey, mint);

const data = Buffer.concat([disc("buy"), u64(LAMPORTS_IN), u64(MIN_OUT)]);
const buyIx = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: launch, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: creator, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ataIx, buyIx), [buyer], { commitment: "confirmed" });

const vaultAfter = await connection.getBalance(vault);
const tokenBal = await connection.getTokenAccountBalance(buyerAta);
const toFloor = (vaultAfter - vaultBefore) / 1e9;

console.log("✓ buy confirmed! tx:", sig);
console.log("vault after :", (vaultAfter / 1e9).toFixed(6), "SOL");
console.log("→ 进金库(底池):", toFloor.toFixed(6), "SOL");
console.log("→ 占买入比例   :", ((toFloor / (LAMPORTS_IN / 1e9)) * 100).toFixed(1), "%  (扣1.25%费后净额的20%)");
console.log("→ 买到代币     :", tokenBal.value.uiAmountString, mint.toBase58().slice(0, 4));
console.log("explorer tx :", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
