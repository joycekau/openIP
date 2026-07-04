// create_token: mint a real SPL token on devnet with name/symbol/uri,
// a launch PDA, a 20% floor-vault PDA, and a Metaplex metadata account.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Transaction, TransactionInstruction, SystemProgram, Keypair,
  SYSVAR_RENT_PUBKEY, sendAndConfirmTransaction, PublicKey,
} from "@solana/web3.js";
import {
  connection, PROGRAM_ID, METADATA_PROGRAM_ID, loadDeployer,
  disc, pda, metadataPda, borshString, Buffer,
} from "./lib.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const __dir = dirname(fileURLToPath(import.meta.url));

const creator = loadDeployer();
const mint = Keypair.generate();
const launch = pda([Buffer.from("launch"), mint.publicKey.toBuffer()]);
const vault = pda([Buffer.from("vault"), mint.publicKey.toBuffer()]);
const metadata = metadataPda(mint.publicKey);
const config = pda([Buffer.from("config")]);
const feeRecipient = creator.publicKey; // = config.fee_recipient

const name = "oneIP Test Coin";
const symbol = "ONET";
const uri = "https://oneip.io/test-metadata.json";

console.log("creator :", creator.publicKey.toBase58());
console.log("mint    :", mint.publicKey.toBase58());
console.log("launch  :", launch.toBase58());
console.log("vault   :", vault.toBase58());

const data = Buffer.concat([disc("create_token"), borshString(name), borshString(symbol), borshString(uri)]);

const keys = [
  { pubkey: launch, isSigner: false, isWritable: true },
  { pubkey: mint.publicKey, isSigner: true, isWritable: true },
  { pubkey: metadata, isSigner: false, isWritable: true },
  { pubkey: vault, isSigner: false, isWritable: true },
  { pubkey: creator.publicKey, isSigner: true, isWritable: true },
  { pubkey: config, isSigner: false, isWritable: false },
  { pubkey: feeRecipient, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
];

console.log("\nsending create_token…");
const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [creator, mint], { commitment: "confirmed" });

writeFileSync(join(__dir, ".last-mint.txt"), mint.publicKey.toBase58());
console.log("✓ token created! tx:", sig);
console.log("explorer tx   :", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
console.log("explorer mint :", `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`);
