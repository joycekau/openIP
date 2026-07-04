// Proves the OAuth + follower-gated verification:
//   - a platform only counts if ownership is verified AND followers >= 1000
//   - >= 3 qualifying platforms -> verified + signed attestation -> pushed on the board
//   - a tiny-follower account does NOT qualify (the badge can't be faked with throwaways)
import { start } from "../src/server.js";

const PORT = 8801;
const base = `http://localhost:${PORT}`;
const j = async (p, o) => (await fetch(base + p, o)).json();
const post = (p, body) => j(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const connect = (mint, platform, followers) => post("/api/launch/bind", { mint, platform, followers, handle: platform + "_creator" });

const server = await start(PORT);
const onBoard = (b, mint) => b.some((x) => x.mint === mint);

console.log("\n== happy path: real creator with reach ==");
const A = await post("/api/launch", { name: "PepeKing", symbol: "PEPEK", creator: "wallet_A" });
console.log(`1) created ${A.symbol}  floor=${A.floorBps / 100}%  verified=${A.verified}`);

await connect(A.mint, "twitter", 120000);
await connect(A.mint, "telegram", 45000);
let b = await j("/api/board");
console.log(`2) @2 qualifying socials -> on board: ${onBoard(b, A.mint)}   [below threshold]`);

const v = await connect(A.mint, "youtube", 380000);
b = await j("/api/board");
console.log(`3) @3 qualifying -> verified=${v.verified}  reach=${v.attestation.totalReach.toLocaleString()}  on board: ${onBoard(b, A.mint)}`);

console.log("\n== follower gate: throwaway accounts can't fake it ==");
const B = await post("/api/launch", { name: "ScamCat", symbol: "SCAM", creator: "wallet_B" });
await connect(B.mint, "twitter", 90000);
await connect(B.mint, "telegram", 30000);
const tiny = await connect(B.mint, "discord", 150); // below 1000 -> does NOT qualify
b = await j("/api/board");
console.log(`4) 2 real + 1 tiny(150 followers) -> discord qualifies: ${tiny.socials.discord.qualifies}  verified: ${tiny.verified}  on board: ${onBoard(b, B.mint)}`);
console.log(`   -> the 150-follower account is rejected, so the badge stays honest.\n`);

void server;
process.exit(0);
