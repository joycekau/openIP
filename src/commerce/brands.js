// Supply side of oneIP.ai — factories / supply chains / brands.
// A brand registers (with a contact), then posts OFFERS: products to promote, endorsement deals,
// or sourcing needs, each with a price + contact. Creators browse and LINK a brand; for `product`
// offers the link drops the item into the creator's storefront (server orchestrates that). Same
// zero-dep + data/*.json convention as the rest of src/commerce.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const F = (n) => join(__dir, "..", "..", "data", n);

// product = goods a creator can sell/promote; endorsement = 代言 deal; need = a sourcing/ask.
export const OFFER_KINDS = ["product", "endorsement", "need"];
export const BRAND_TYPES = ["factory", "supply", "brand"]; // 厂商 / 供应链 / 品牌

let brands = {}; // id -> brand
let offers = {}; // id -> offer
let links = [];  // [{ id, creator, offerId, brandId, status, ts }]
let loaded = false;
let timer = null;

const newId = (p) => p + "_" + randomBytes(6).toString("hex");
const read = async (n, def) => { try { return JSON.parse(await readFile(F(n), "utf8")); } catch { return def; } };

export async function load() {
  brands = await read("brands.json", {});
  offers = await read("offers.json", {});
  links = await read("brand-links.json", []);
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    writeFile(F("brands.json"), JSON.stringify(brands, null, 2)).catch(() => {});
    writeFile(F("offers.json"), JSON.stringify(offers, null, 2)).catch(() => {});
    writeFile(F("brand-links.json"), JSON.stringify(links, null, 2)).catch(() => {});
  }, 200);
}

// ---- brands ----
export function registerBrand({ name, type, logo, bio, contact, website }) {
  if (!name) throw new Error("brand name required");
  if (!contact) throw new Error("contact required");
  const t = BRAND_TYPES.includes(type) ? type : "brand";
  const id = newId("brand");
  brands[id] = {
    id, name: String(name).slice(0, 100), type: t,
    logo: logo || "", bio: (bio || "").slice(0, 1000),
    contact: String(contact).slice(0, 100), website: website || "",
    createdAt: Date.now(),
  };
  persist();
  return brands[id];
}
export function getBrand(id) { return brands[id] || null; }
export function listBrands() { return Object.values(brands).sort((a, b) => b.createdAt - a.createdAt); }

// ---- offers ----
export function addOffer({ brandId, kind, title, description, image, priceCents, contact, moq }) {
  const brand = brands[brandId];
  if (!brand) throw new Error("brand not found");
  if (!title) throw new Error("title required");
  const k = OFFER_KINDS.includes(kind) ? kind : "product";
  if (k === "product" && !(priceCents > 0)) throw new Error("product offers need a price");
  const id = newId("offer");
  offers[id] = {
    id, brandId, kind: k,
    title: String(title).slice(0, 200), description: (description || "").slice(0, 2000), image: image || "",
    priceCents: priceCents ? Math.round(priceCents) : 0, currency: "USD",
    contact: contact || brand.contact, moq: moq || 0,
    active: true, createdAt: Date.now(),
  };
  persist();
  return offers[id];
}
export function getOffer(id) { return offers[id] || null; }
export function setOfferActive(id, brandId, active) {
  const o = offers[id];
  if (!o) throw new Error("offer not found");
  if (o.brandId !== brandId) throw new Error("not your offer");
  o.active = !!active; persist(); return o;
}

/** Marketplace view: offers joined with their brand summary (name, type, logo, contact). */
export function listOffers({ kind, brandId, activeOnly = true } = {}) {
  return Object.values(offers)
    .filter((o) => (!kind || o.kind === kind))
    .filter((o) => (!brandId || o.brandId === brandId))
    .filter((o) => (!activeOnly || o.active))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => {
      const b = brands[o.brandId] || {};
      return { ...o, brandName: b.name || "", brandType: b.type || "", brandLogo: b.logo || "", contact: o.contact || b.contact || "" };
    });
}

// ---- links (creator <-> brand offer) ----
export function linkBrand({ creator, offerId }) {
  if (!creator) throw new Error("creator account required");
  const o = offers[offerId];
  if (!o) throw new Error("offer not found");
  const existing = links.find((l) => l.creator === creator && l.offerId === offerId);
  if (existing) return existing;
  const link = { id: newId("link"), creator, offerId, brandId: o.brandId, status: "linked", ts: Date.now() };
  links.unshift(link);
  persist();
  return link;
}
export function listLinks({ creator, offerId } = {}) {
  return links
    .filter((l) => (!creator || l.creator === creator))
    .filter((l) => (!offerId || l.offerId === offerId))
    .map((l) => ({ ...l, offer: listOffers({ activeOnly: false }).find((o) => o.id === l.offerId) || null }));
}
export function linkCount(offerId) { return links.filter((l) => l.offerId === offerId).length; }
