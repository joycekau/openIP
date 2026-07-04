// Initialize the kolpad Config (one-time). attester + fee_recipient = deployer for now.
import { Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { connection, PROGRAM_ID, loadDeployer, disc, pda, Buffer } from "./lib.js";

const deployer = loadDeployer();
const config = pda([Buffer.from("config")]);
console.log("deployer    :", deployer.publicKey.toBase58());
console.log("config PDA  :", config.toBase58());

const bal = await connection.getBalance(deployer.publicKey);
console.log("balance     :", (bal / 1e9).toFixed(3), "SOL");

const existing = await connection.getAccountInfo(config);
if (existing) { console.log("\n✓ Config already initialized — nothing to do."); process.exit(0); }

const attester = deployer.publicKey;
const feeRecipient = deployer.publicKey;
const data = Buffer.concat([disc("initialize"), attester.toBuffer(), feeRecipient.toBuffer()]);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

console.log("\nsending initialize…");
const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [deployer], { commitment: "confirmed" });
console.log("✓ initialized! tx:", sig);
console.log("explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
