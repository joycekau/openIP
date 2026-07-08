// End-to-end proof of the commerce closed loop in MOCK mode (no Stripe, no chain).
// UNIFIED SPLIT (user-locked 2026-07-08, same on oneIP and corax.live channels):
//   digital / tip / reaction: price = 70% creator + 20% token pool (80% liquidity / 20% floor)
//   + 10% platform (payment/settlement costs absorbed by the platform's 10%).
//   physical: category commission (5%, min $1) — OUTSIDE the token program, no pool routing.
// Also proves the guardrails: refunds never touch the pool, physical settles only after the
// refund window, settle is idempotent. Exits fast so it doesn't persist test data.
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
// store (a live server may have written real records for any reused mint).
const COIN = "SmokeCoin" + Date.now();

// 1) PHYSICAL product (outside the token program): fan pays $39.90, supplier cost $12.00
const product = source.addProduct({
  creator: CREATOR, coin: COIN, title: "Onee Plush Toy",
  priceCents: 3990, costCents: 1200, currency: "USD", sku: "ONEE-PLUSH",
});
ok(product.id, `physical product curated: ${product.title} @ ${usd(product.priceCents)} (cost ${usd(product.costCents)})`);

const order = orders.create({ productId: product.id, fan: "fan@example.com", address: { name: "Fan", line1: "1 Test St", country: "PH" } });
console.log(`  commission = max(5% of ${usd(order.priceCents)}, $1) = ${usd(order.platformFeeCents)} · PSP fee ${usd(order.feeCents)} · supplier ${usd(order.costCents)}`);
ok(order.platformFeeCents === Math.max(Math.round(order.priceCents * 0.05), 100), "physical: platform commission = max(5%, $1)");
ok(order.creatorCents === order.priceCents - order.platformFeeCents - order.feeCents - order.costCents, "physical: creator keeps price - commission - fee - cost");
ok(order.poolCents === 0, "physical: NO token-pool share (outside the token program)");

// 2) fulfillment: paid -> shipped -> delivered
await orders.markPaid(order.id);
ok(orders.get(order.id).supplierOrderRef, "paid -> supplier order placed (mock)");
orders.markShipped(order.id, "TRACK-123");
orders.markDelivered(order.id);
ok(orders.get(order.id).status === "delivered", "shipped -> delivered");

// 3) guardrail: cannot settle before the refund window (without force)
let blocked = false;
try { await orders.settle(order.id); } catch { blocked = true; }
ok(blocked, "settle BLOCKED before refund window elapses (no force)");

// 4) SETTLE (force = window elapsed) -> no buyback for physical, float untouched
const floatBefore = treasury.balanceLamports();
const settled = await orders.settle(order.id, { force: true });
ok(settled.status === "settled", "physical order SETTLED");
ok(settled.buyback && settled.buyback.skipped, "physical: buyback correctly SKIPPED (no pool share)");
ok(treasury.balanceLamports() === floatBefore, "physical: float pool untouched");

// 5) settle is idempotent
const again = await orders.settle(order.id, { force: true });
ok(again.settledAt === settled.settledAt, "settle is idempotent");

// 6) guardrail: a refunded order never settles
const order2 = orders.create({ productId: product.id, fan: "fan2@example.com" });
await orders.markPaid(order2.id);
orders.refund(order2.id, "fan changed mind");
ok(orders.get(order2.id).status === "refunded", "second order refunded before settle");
let cantSettle = false;
try { await orders.settle(order2.id, { force: true }); } catch { cantSettle = true; }
ok(cantSettle, "refunded order cannot settle -> pool untouched");

// 7) DIGITAL item (paid video) — the token program: 70/20/10, instant settle, content unlocked
console.log("");
const vid = source.addProduct({ creator: CREATOR, coin: COIN, type: "digital", title: "Behind-the-scenes vlog", priceCents: 1000, contentUrl: "https://cdn.oneip.io/secret-vlog.mp4" });
ok(source.listProducts({ creator: CREATOR }).find((p) => p.id === vid.id).contentUrl === undefined, "digital contentUrl hidden in public listing");
const dOrder = orders.create({ productId: vid.id, fan: "fan@example.com" });
console.log(`  ${usd(dOrder.priceCents)} = creator ${usd(dOrder.creatorCents)} + pool ${usd(dOrder.poolCents)} (liq ${usd(dOrder.liquidityCents)} / floor ${usd(dOrder.floorCents)}) + platform ${usd(dOrder.platformFeeCents)} · PSP ${usd(dOrder.feeCents)} absorbed`);
ok(dOrder.creatorCents + dOrder.poolCents + dOrder.platformFeeCents === dOrder.priceCents, "digital: 70/20/10 sums to the price EXACTLY (no rounding leak)");
ok(dOrder.creatorCents === Math.round(dOrder.priceCents * 0.70), "digital: creator = 70% of price");
ok(dOrder.poolCents === Math.round(dOrder.priceCents * 0.20), "digital: token pool = 20% of price");
ok(dOrder.platformFeeCents === Math.round(dOrder.priceCents * 0.10), "digital: platform = 10% of price (settlement absorbed)");
ok(dOrder.liquidityCents === Math.round(dOrder.poolCents * 0.80) && dOrder.floorCents === dOrder.poolCents - dOrder.liquidityCents, "pool splits 80% liquidity / 20% floor");
ok(dOrder.feeAbsorbed === true, "PSP fee marked absorbed by the platform (not off the top)");
const dPaid = await orders.markPaid(dOrder.id); // instant: pays -> delivers -> settles
ok(dPaid.status === "settled", "digital: paid -> instantly settled (no shipping/window)");
ok(dPaid.unlocked && dPaid.content === "https://cdn.oneip.io/secret-vlog.mp4", "digital: content unlocked for the buyer");
ok(dPaid.buyback && dPaid.buyback.buybackCents === dPaid.poolCents, "digital: the FULL 20% pool share routed to the buyback");

// 8) TIP (打赏) — same digital economics, instant settle
const tip = orders.createTip({ creator: CREATOR, coin: COIN, amountCents: 2000, fan: "superfan@example.com" });
const tipPaid = await orders.markPaid(tip.id);
ok(tipPaid.type === "tip" && tipPaid.status === "settled", "tip: created + instantly settled");
ok(tipPaid.creatorCents === 1400 && tipPaid.poolCents === 400 && tipPaid.platformFeeCents === 200, `tip $20: creator $14 / pool $4 / platform $2 (70/20/10)`);

// 8b) pre-launch creator (no value pool/coin yet): the sale still settles, buyback is skipped (not errored)
const teaser = source.addProduct({ creator: CREATOR, coin: "", type: "digital", title: "Pre-launch teaser", priceCents: 500, contentUrl: "https://cdn.oneip.io/teaser.mp4" });
const ncPaid = await orders.markPaid(orders.create({ productId: teaser.id, fan: "early@example.com" }).id);
ok(ncPaid.status === "settled" && ncPaid.buyback.skipped, "no value pool yet: sale settles + content unlocks, buyback skipped (not errored)");

// 9) queue fallback: drain the float, then a tip still SETTLES but its buyback is queued
treasury.reserve(treasury.balanceLamports(), "drain for test");
const tip2 = orders.createTip({ creator: CREATOR, coin: COIN, amountCents: 5000, fan: "whale@example.com" });
const tip2Paid = await orders.markPaid(tip2.id);
ok(tip2Paid.status === "settled", "float empty: order still SETTLES");
ok(tip2Paid.buyback.status === "queued", "float empty: buyback is QUEUED (awaits fiat->SOL top-up)");

// 10) public proof: funded sales count, queued shown separately; physical + refund excluded
const proof = buyback.proof(COIN);
console.log("\n— Value-pool proof for", COIN.slice(0, 8) + "… —");
console.log(`  funded sales : ${proof.count}  ·  queued: ${proof.queuedCount}`);
console.log(`  pool routed  : ${proof.totalFloorAddedSol.toFixed(6)} SOL  (from ${usd(proof.totalBuybackUsd * 100)})  ·  queued ${usd(proof.queuedUsd * 100)}`);
ok(proof.count === 2 && proof.queuedCount === 1, "proof: 2 funded (digital+tip), 1 queued; physical + refund excluded");

// 11) authorized regional partners (2-tier) + 1-gen referral, carved from the 10% platform take
console.log("\n— 授权区域伙伴 (国家→地方) + 老带新 1 代 (从平台 10% 内切) —");
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

treasury.topUp(1_000_000_000, "smoke seed 2"); // refill (step 9 drained the float)
const COIN2 = "SmokeCoin2" + ts;
const prod2 = source.addProduct({ creator: creator.handle, coin: COIN2, type: "digital", title: "Split test", priceCents: 10000, contentUrl: "https://cdn.oneip.io/x.mp4" });
const so = await orders.markPaid(orders.create({ productId: prod2.id, fan: "buyer@smk.test" }).id);
const p = so.payout;
console.log(`  price ${usd(so.priceCents)} · country ${usd(p.countryAgentCents)} · local ${usd(p.localAgentCents)} · referral ${usd(p.referrerCents)} · platform keeps ${usd(p.platformBaseCents)}`);
ok(p.countryAgentCents === Math.round(so.priceCents * 0.005), "country partner = 0.5% of price");
ok(p.localAgentCents === Math.round(so.priceCents * 0.010), "local partner = 1.0% of price");
ok(p.referrerCents === Math.round(so.priceCents * 0.010), "referral (1-gen) = 1.0% of price");
ok(p.countryAgentId === country.id && p.localAgentId === local.id && p.referrerHandle === inviter.handle, "cuts tagged to the right parties");
ok(p.platformBaseCents + p.countryAgentCents + p.localAgentCents + p.referrerCents === so.platformFeeCents, "sub-split sums to the 10% platform take EXACTLY");

// 60-day referral gate: a >60d gap between sales permanently closes the bond (option A)
const gc = accounts.register({ handle: "smkgat" + ts, email: "gat" + ts + "@smk.test", password: "secret123", referrer: inviter.handle }).handle;
const T0 = ts;
ok(accounts.resolveSaleParties(gc, T0).referrerActive, "gate: first sale -> referral active");
ok(accounts.resolveSaleParties(gc, T0 + 30 * 864e5).referrerActive, "gate: 30-day gap -> still active");
ok(!accounts.resolveSaleParties(gc, T0 + 30 * 864e5 + 61 * 864e5).referrerActive, "gate: 61-day gap -> referral PERMANENTLY closed");
ok(!accounts.resolveSaleParties(gc, T0 + 400 * 864e5).referrerActive, "gate: stays closed forever even if creator returns (option A)");

const led = orders.payouts();
ok(led.partners.some((x) => x.id === local.id) && led.referrers.some((x) => x.handle === inviter.handle), "payouts ledger aggregates what the platform owes partners + referrer");

console.log("\n✅ unified split proven (mock): digital/tip = 70% creator / 20% pool (80 liq / 20 floor) / 10% platform, settlement absorbed.");
console.log("✅ physical = category commission (5% min $1), outside the token program. 渠道分成从平台 10% 内切, 60天推荐闸门.");
process.exit(0); // fast exit: debounced persists are cancelled, no test data written
