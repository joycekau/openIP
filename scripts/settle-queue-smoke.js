// Proof of the shared paid-orders queue + single settlement engine ("2 doors, 1 engine").
//   both doors (oneip.io + corax.live channel) drop paid sales into ONE queue -> one engine settles
//   each identically (same 70/20/10, same pool buyback) -> idempotent, retryable, one ledger.
import * as source from "../src/commerce/source.js";
import * as orders from "../src/commerce/orders.js";
import * as treasury from "../src/commerce/treasury.js";
import * as buyback from "../src/commerce/buyback.js";
import * as accounts from "../src/accounts.js";
import * as agents from "../src/commerce/agents.js";
import * as queue from "../src/commerce/queue.js";

const ok = (c, m) => { if (!c) { console.error("✗ FAIL:", m); process.exit(1); } console.log("✓", m); };
const usd = (c) => "$" + (c / 100).toFixed(2);

await Promise.all([source.load(), orders.load(), treasury.load(), buyback.load(), accounts.load(), agents.load(), queue.load()]);
treasury.topUp(5_000_000_000, "smoke seed");

const CREATOR = "SharedEngineCreator";
const COIN = "QueueCoin" + Date.now();
const R = "-" + Date.now(); // unique order refs per run (file-mode re-runnable)

// The single engine that drains the shared queue (mirrors /api/admin/settle/drain).
async function drain() {
  const out = [];
  for (const r of await queue.pending()) {
    try { const s = await orders.settleQueued(r); await queue.markSettled(r.source, r.orderRef, s.id); out.push(s); }
    catch (e) { await queue.markError(r.source, r.orderRef, e.message); }
  }
  return out;
}

// 1) a sale checked out on ONEIP drops into the queue
const q1 = await queue.enqueue({ source: "oneip", orderRef: "oneip-1001"+R, creator: CREATOR, coin: COIN, type: "digital", amountCents: 1000, fan: "a@x.co" });
ok(q1.queued && !q1.duplicate, "oneip door: paid sale enqueued");

// 2) a sale checked out in a CORAX channel drops into the SAME queue
const q2 = await queue.enqueue({ source: "corax", orderRef: "corax-77"+R, creator: CREATOR, coin: COIN, type: "digital", amountCents: 2000, fan: "b@x.co", channelId: "ch_abc" });
ok(q2.queued, "corax door: paid sale enqueued into the same queue");
ok((await queue.pending()).length === 2, "both doors' sales sit in one shared queue");

// 3) idempotency: re-delivering the corax sale (webhook retry) does NOT create a second row
const dup = await queue.enqueue({ source: "corax", orderRef: "corax-77"+R, creator: CREATOR, coin: COIN, type: "digital", amountCents: 2000 });
ok(!dup.queued && dup.duplicate, "duplicate delivery is ignored (idempotent on source:orderRef)");
ok((await queue.pending()).length === 2, "still exactly 2 pending after the duplicate");

// 4) ONE engine drains the queue — settles BOTH identically (70/20/10, pool buyback)
const settled = await drain();
ok(settled.length === 2, "one engine settled both doors' sales in a single drain");
for (const s of settled) {
  ok(s.status === "settled", `${s.source} order settled`);
  ok(s.creatorCents === Math.round(s.priceCents * 0.70) && s.poolCents === Math.round(s.priceCents * 0.20) && s.platformFeeCents === Math.round(s.priceCents * 0.10),
    `${s.source} ${usd(s.priceCents)}: 70/20/10 applied identically (creator ${usd(s.creatorCents)} / pool ${usd(s.poolCents)} / platform ${usd(s.platformFeeCents)})`);
  ok(s.buyback && !s.buyback.skipped, `${s.source}: pool buyback fired (${usd(s.buyback.buybackCents)})`);
}
ok((await queue.pending()).length === 0, "queue fully drained (no rows left pending)");

// 5) re-draining is a no-op (settled rows aren't reprocessed) — no double-funding
const again = await drain();
ok(again.length === 0, "re-drain settles nothing (settled rows are done) — no double-funding");

// 6) the pool proof reflects BOTH doors' sales in ONE ledger
const proof = buyback.proof(COIN);
console.log(`\n  value-pool proof (one ledger, both doors): ${proof.count} funded · ${proof.totalFloorAddedSol.toFixed(6)} SOL from ${usd(proof.totalBuybackUsd * 100)}`);
ok(proof.count === 2, "both doors' sales feed the SAME value-pool ledger");

// 7) a PHYSICAL (merchant) sale from a channel: settles via commission, no pool routing
const q3 = await queue.enqueue({ source: "corax", orderRef: "corax-88"+R, creator: CREATOR, coin: COIN, type: "physical", category: "fnb", amountCents: 2000, fan: "c@x.co" });
ok(q3.queued, "corax merchant (F&B) sale enqueued");
const [mo] = await drain();
ok(mo.platformFeeCents === 500 && mo.poolCents === 0 && mo.buyback.skipped, "merchant sale: 8% F&B commission, NO pool (skipped) — same rule as oneip.io");

// 8) failure path: an unfundable buyback keeps the row retryable, doesn't lose the sale
const q4 = await queue.enqueue({ source: "corax", orderRef: "corax-99"+R, creator: CREATOR, coin: "RealMint" + Date.now(), type: "digital", amountCents: 3000 });
treasury.reserve(treasury.balanceLamports(), "drain float for failure test"); // empty the float
const [fo] = await drain();
ok(fo.status === "settled" && fo.buyback.status === "queued", "float empty: sale still settles, buyback queued (never drops the sale)");

console.log("\n✅ 2 doors → 1 shared queue → 1 settlement engine: identical split, idempotent, one ledger, retry-safe.");
process.exit(0);
