// End-to-end proof of the commerce closed loop in MOCK mode (no Stripe, no chain):
//   curate product -> fan buys (fiat) -> supplier ships -> deliver -> SETTLE -> 20% funds the floor.
// Also proves the guardrails: a refund before settle never touches the floor, and settle is
// blocked until the refund window elapses. Exits fast so it doesn't persist test data.
import * as source from "../src/commerce/source.js";
import * as orders from "../src/commerce/orders.js";
import * as treasury from "../src/commerce/treasury.js";
import * as buyback from "../src/commerce/buyback.js";
import * as accounts from "../src/accounts.js";
import * as agents from "../src/commerce/agents.js";

const ok = (c, m) => { if (!c) { console.error("✗ FAIL:", m); process.exit(1); } console.log("✓", m); };
const usd = (cents) => "$" + (cents / 100).toFixed(2);

await Promise.all([source.load(), orders.load(), treasury.load(), buyback.load(), accounts.load(), agents.load()]);

// Start each run from a clean in-memory float (this run only; not persisted on fast exit).
treasury.topUp(5_000_000_000, "smoke seed"); // 5 SOL float
console.log("float pool seeded:", treasury.balanceSol(), "SOL\n");

const CREATOR = "DemoCreatorWa11et1111111111111111111111111";
// Unique per run so the proof reflects ONLY this run — buyback.load() reads the shared
// data/buybacks.json (a live server may have written real records for any reused mint).
const COIN = "SmokeCoin" + Date.now();

// 1) creator curates a product (fan pays $39.90, supplier cost $12.00)
const product = source.addProduct({
  creator: CREATOR, coin: COIN, title: "Onee Plush Toy",
  priceCents: 3990, costCents: 1200, currency: "USD", sku: "ONEE-PLUSH",
});
ok(product.id, `product curated: ${product.title} @ ${usd(product.priceCents)} (cost ${usd(product.costCents)})`);

// 2) fan buys it (fiat) — order snapshots the economics
const order = orders.create({ productId: product.id, fan: "fan@example.com", address: { name: "Fan", line1: "1 Test St", country: "PH" } });
console.log(`  net profit = price - cost - fee = ${usd(order.priceCents)} - ${usd(order.costCents)} - ${usd(order.feeCents)} = ${usd(order.netProfitCents)}`);
ok(order.netProfitCents > 0, `order created with positive net profit ${usd(order.netProfitCents)}`);

const q = buyback.quote(order.netProfitCents);
console.log(`  20% buyback = ${usd(q.buybackCents)}  ->  ${(q.lamports / 1e9).toFixed(6)} SOL @ $${q.solUsd}/SOL\n`);

// 3) fulfillment: paid -> shipped -> delivered
await orders.markPaid(order.id);
ok(orders.get(order.id).supplierOrderRef, "paid -> supplier order placed (mock)");
orders.markShipped(order.id, "TRACK-123");
orders.markDelivered(order.id);
ok(orders.get(order.id).status === "delivered", "shipped -> delivered");

// 4) guardrail: cannot settle before the refund window (without force)
let blocked = false;
try { await orders.settle(order.id); } catch { blocked = true; }
ok(blocked, "settle BLOCKED before refund window elapses (no force)");

// 5) SETTLE (force = window elapsed) -> buyback fires, floor funded
const floatBefore = treasury.balanceLamports();
const settled = await orders.settle(order.id, { force: true });
ok(settled.status === "settled", "order SETTLED");
ok(settled.buyback && !settled.buyback.skipped, `buyback executed: ${usd(settled.buyback.buybackCents)} -> floor (sig ${settled.buyback.sig})`);
ok(treasury.balanceLamports() === floatBefore - settled.buyback.lamports, "float pool debited by the buyback amount");

// 6) settle is idempotent (no double-funding)
const again = await orders.settle(order.id, { force: true });
ok(again.buyback.sig === settled.buyback.sig, "settle is idempotent (floor funded once)");

// 7) guardrail: a refunded order never funds the floor
const order2 = orders.create({ productId: product.id, fan: "fan2@example.com" });
await orders.markPaid(order2.id);
orders.refund(order2.id, "fan changed mind");
ok(orders.get(order2.id).status === "refunded", "second order refunded before settle");
let cantSettle = false;
try { await orders.settle(order2.id, { force: true }); } catch { cantSettle = true; }
ok(cantSettle, "refunded order cannot settle -> floor untouched");

// 8) DIGITAL item (paid video) — instant settle on payment, content unlocked, no shipping
console.log("");
const vid = source.addProduct({ creator: CREATOR, coin: COIN, type: "digital", title: "Behind-the-scenes vlog", priceCents: 900, contentUrl: "https://cdn.oneip.ai/secret-vlog.mp4" });
ok(source.listProducts({ creator: CREATOR }).find((p) => p.id === vid.id).contentUrl === undefined, "digital contentUrl hidden in public listing");
const dOrder = orders.create({ productId: vid.id, fan: "fan@example.com" });
const dPaid = await orders.markPaid(dOrder.id); // instant: pays -> delivers -> settles
ok(dPaid.status === "settled", "digital: paid -> instantly settled (no shipping/window)");
ok(dPaid.unlocked && dPaid.content === "https://cdn.oneip.ai/secret-vlog.mp4", "digital: content unlocked for the buyer");
ok(dPaid.buyback && dPaid.buyback.buybackCents === Math.round(dPaid.netProfitCents * 0.2), "digital: 20% of net funded the floor");

// 9) TIP (打赏) — ad-hoc, no catalog item, instant settle, net = amount - fee
const tip = orders.createTip({ creator: CREATOR, coin: COIN, amountCents: 2000, fan: "superfan@example.com" });
const tipPaid = await orders.markPaid(tip.id);
ok(tipPaid.type === "tip" && tipPaid.status === "settled", "tip: created + instantly settled");
ok(tipPaid.buyback.buybackCents === Math.round(tipPaid.netProfitCents * 0.2), `tip: 20% of net (${usd(tipPaid.netProfitCents)}) -> floor`);

// 9b) pre-launch creator (no value pool/coin yet): the sale still settles, buyback is skipped (not errored)
const teaser = source.addProduct({ creator: CREATOR, coin: "", type: "digital", title: "Pre-launch teaser", priceCents: 500, contentUrl: "https://cdn.oneip.ai/teaser.mp4" });
const ncPaid = await orders.markPaid(orders.create({ productId: teaser.id, fan: "early@example.com" }).id);
ok(ncPaid.status === "settled" && ncPaid.buyback.skipped, "no value pool yet: sale settles + content unlocks, buyback skipped (not errored)");

// 10) queue fallback: drain the float, then a tip still SETTLES but its buyback is queued
treasury.reserve(treasury.balanceLamports(), "drain for test");
const tip2 = orders.createTip({ creator: CREATOR, coin: COIN, amountCents: 5000, fan: "whale@example.com" });
const tip2Paid = await orders.markPaid(tip2.id);
ok(tip2Paid.status === "settled", "float empty: order still SETTLES");
ok(tip2Paid.buyback.status === "queued", "float empty: buyback is QUEUED (awaits fiat->SOL top-up)");

// 11) public proof: funded sales count the floor, queued shown separately
const proof = buyback.proof(COIN);
console.log("\n— Revenue Floor proof for", COIN.slice(0, 8) + "… —");
console.log(`  funded sales : ${proof.count}  ·  queued: ${proof.queuedCount}`);
console.log(`  floor added  : ${proof.totalFloorAddedSol.toFixed(6)} SOL  (from ${usd(proof.totalBuybackUsd * 100)})  ·  queued ${usd(proof.queuedUsd * 100)}`);
ok(proof.count === 3 && proof.queuedCount === 1, "proof: 3 funded (physical+digital+tip), 1 queued; refund excluded");

// 12) revenue split (user-locked): net = 75% creator / 20% floor / 5% platform pool
console.log("\n— 分账 75/20/5 (net = 售价 - 供货 - 支付费) —");
{
  const net = settled.netProfitCents;
  console.log(`  net ${usd(net)} = creator ${usd(settled.creatorCents)} + floor ${usd(settled.floorCents)} + platform ${usd(settled.platformFeeCents)}`);
  ok(settled.creatorCents + settled.floorCents + settled.platformFeeCents === net, "75/20/5 sums to net EXACTLY (no rounding leak)");
  ok(Math.abs(settled.floorCents - net * 0.20) < 1, "floor ≈ 20% of net");
  ok(Math.abs(settled.platformFeeCents - net * 0.05) < 1, "platform pool ≈ 5% of net");
  ok(Math.abs(settled.creatorCents - net * 0.75) < 1, "creator ≈ 75% of net");
  // this creator is a bare wallet with no account -> no partners/referrer -> platform absorbs the pool
  ok(settled.payout.platformBaseCents === settled.platformFeeCents, "no partners/referrer -> platform base = full 5% pool");
  ok(!settled.payout.referrerHandle && !settled.payout.countryAgentId && !settled.payout.localAgentId, "empty-slot: no partner/referrer cuts recorded");
}

// 13) authorized regional partners (2-tier) + 1-gen referral split + 60-day gate
console.log("\n— 授权区域伙伴 (国家→地方) + 老带新 1 代 —");
const ts = Date.now();
const country = agents.register({ tier: "country", name: "PH Country", territory: "Philippines", contact: "+63-900" });
const local = agents.register({ tier: "local", name: "Manila", territory: "Metro Manila", contact: "+63-901", parentCountryId: country.id });
ok(local.parentCountryId === country.id, "partner tree: country -> local (local's parent is the country partner)");
let capped = false;
try { agents.register({ tier: "local", name: "sub", contact: "x", parentCountryId: local.id }); } catch { capped = true; }
ok(capped, "2-tier cap: a local partner CANNOT parent another partner (no 3rd tier)");

const inviter = accounts.register({ handle: "smkinv" + ts, email: "inv" + ts + "@smk.test", password: "secret123" });
const creator = accounts.register({ handle: "smkcrt" + ts, email: "crt" + ts + "@smk.test", password: "secret123", referrer: inviter.handle });
ok(creator.referrerHandle === inviter.handle, "referred creator records referrer (written once at register)");
accounts.assignAgents(creator.handle, agents.resolveAssignment(local.id)); // stamps both local + derived country

treasury.topUp(1_000_000_000, "smoke seed 2"); // refill (step 10 drained the float)
const COIN2 = "SmokeCoin2" + ts;
const prod2 = source.addProduct({ creator: creator.handle, coin: COIN2, type: "digital", title: "Split test", priceCents: 10000, contentUrl: "https://cdn.oneip.ai/x.mp4" });
const so = await orders.markPaid(orders.create({ productId: prod2.id, fan: "buyer@smk.test" }).id);
const net2 = so.netProfitCents, p = so.payout;
console.log(`  net ${usd(net2)} · country ${usd(p.countryAgentCents)} · local ${usd(p.localAgentCents)} · referral ${usd(p.referrerCents)} · platform ${usd(p.platformBaseCents)}`);
ok(Math.abs(p.countryAgentCents - net2 * 0.005) < 1, "country partner = 0.5% of net");
ok(Math.abs(p.localAgentCents - net2 * 0.010) < 1, "local partner = 1.0% of net");
ok(Math.abs(p.referrerCents - net2 * 0.010) < 1, "referral (1-gen) = 1.0% of net");
ok(p.countryAgentId === country.id && p.localAgentId === local.id && p.referrerHandle === inviter.handle, "cuts tagged to the right parties");
ok(p.platformBaseCents + p.countryAgentCents + p.localAgentCents + p.referrerCents === so.platformFeeCents, "4-way sub-split sums to the 5% pool EXACTLY");

// 60-day referral gate: a >60d gap between sales permanently closes the bond (option A)
const gc = accounts.register({ handle: "smkgat" + ts, email: "gat" + ts + "@smk.test", password: "secret123", referrer: inviter.handle }).handle;
const T0 = ts;
ok(accounts.resolveSaleParties(gc, T0).referrerActive, "gate: first sale -> referral active");
ok(accounts.resolveSaleParties(gc, T0 + 30 * 864e5).referrerActive, "gate: 30-day gap -> still active");
ok(!accounts.resolveSaleParties(gc, T0 + 30 * 864e5 + 61 * 864e5).referrerActive, "gate: 61-day gap -> referral PERMANENTLY closed");
ok(!accounts.resolveSaleParties(gc, T0 + 400 * 864e5).referrerActive, "gate: stays closed forever even if creator returns (option A)");

const led = orders.payouts();
ok(led.partners.some((x) => x.id === local.id) && led.referrers.some((x) => x.handle === inviter.handle), "payouts ledger aggregates what the platform owes partners + referrer");

console.log("\n✅ all monetization types proven (mock): 实物 / 数字内容 / 打赏 — 每种 net 75/20/5.");
console.log("✅ 四方分账 proven: 平台 / 国家代理 / 地方代理 / 推荐1代 (从 5% 池切, 空位回落平台, 60天推荐闸门).");
process.exit(0); // fast exit: debounced persists are cancelled, no test data written
