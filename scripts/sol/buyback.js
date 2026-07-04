// Programmatic floor-funding for the revenue->buyback loop (called lazily by src/commerce/buyback.js
// only when SOLANA_BUYBACK=1). MVP reuses the proven `buy` instruction: spending `lamports` on the
// curve routes 20% straight into that token's floor vault (the exact mechanic 03-buy.js verified on
// devnet). Tokens minted by the buy land in the platform-deployer ATA (treasury). A later, purer
// version adds a dedicated `fund_floor` ix that transfers 100% into the vault with no curve/slippage.
import {
  Transaction, TransactionInstruction, SystemProgram,
  sendAndConfirmTransaction, PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection, PROGRAM_ID, loadDeployer, disc, pda, u64, Buffer } from "./lib.js";

/** Fund `mint`'s floor vault by buying `lamports` on its curve (20% -> floor vault).
 *  Returns { sig, explorer, mock:false, vaultDeltaSol }. */
export async function fundFloorViaBuy({ mint, lamports }) {
  const buyer = loadDeployer();
  const mintPk = new PublicKey(mint);
  const launch = pda([Buffer.from("launch"), mintPk.toBuffer()]);
  const vault = pda([Buffer.from("vault"), mintPk.toBuffer()]);
  const buyerAta = await getAssociatedTokenAddress(mintPk, buyer.publicKey);
  const feeRecipient = buyer.publicKey;
  const creator = buyer.publicKey;

  const vaultBefore = await connection.getBalance(vault);
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, buyerAta, buyer.publicKey, mintPk);
  const data = Buffer.concat([disc("buy"), u64(lamports), u64(0)]);
  const buyIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: launch, isSigner: false, isWritable: true },
      { pubkey: mintPk, isSigner: false, isWritable: true },
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
  const cluster = (process.env.SOLANA_RPC || "").includes("devnet") || !process.env.SOLANA_RPC ? "?cluster=devnet" : "";
  return {
    sig, mock: false,
    explorer: `https://explorer.solana.com/tx/${sig}${cluster}`,
    vaultDeltaSol: (vaultAfter - vaultBefore) / 1e9,
  };
}
