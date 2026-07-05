// Shared affiliate-network registry for oneIP — Model A (non-custodial): creators generate their OWN
// tracked link on each network and paste it in. oneIP stores/serves it; the network pays the creator
// directly. We only validate that a pasted URL looks like that network's *tracked* link (so a raw,
// untracked product URL can't sneak in) — lenient host substring match, since networks span many TLDs.
// Exposes window.KolAffiliates (used by the Studio manager + creator profile).
(function () {
  const NETWORKS = [
    { id: "aliexpress",  name: "AliExpress",           emoji: "🛒", color: "#E62E04", region: "Global" },
    { id: "shopee",      name: "Shopee",               emoji: "🧡", color: "#EE4D2D", region: "SEA" },
    { id: "lazada",      name: "Lazada",               emoji: "💙", color: "#0F146D", region: "SEA" },
    { id: "amazon",      name: "Amazon Associates",    emoji: "📦", color: "#FF9900", region: "Global" },
    { id: "tiktok_shop", name: "TikTok Shop",          emoji: "🎵", color: "#111111", region: "Global" },
    { id: "rakuten",     name: "Rakuten Advertising",  emoji: "🅡", color: "#BF0000", region: "Global" },
    { id: "cj",          name: "CJ Affiliate",         emoji: "🔗", color: "#1B7F3B", region: "Global" },
    { id: "impact",      name: "Impact.com",           emoji: "💥", color: "#0A66FF", region: "Global" },
    { id: "awin",        name: "Awin",                 emoji: "🅰️", color: "#FF6B00", region: "Global" },
    { id: "shareasale",  name: "ShareASale",           emoji: "🤝", color: "#0B5FA5", region: "US" },
    { id: "admitad",     name: "Admitad",              emoji: "🧭", color: "#00A0E3", region: "Global" },
    { id: "ebay",        name: "eBay Partner Network", emoji: "🏷️", color: "#E53238", region: "Global" },
    { id: "clickbank",   name: "ClickBank",            emoji: "🏦", color: "#1F7A3A", region: "Global" },
  ];

  const LINK_HOSTS = {
    aliexpress: ["s.click.aliexpress.com", "a.aliexpress.com", "aliexpress.com"],
    shopee: ["shope.ee", "shopee."],
    lazada: ["lazada.", "c.lazada."],
    amazon: ["amzn.to", "amazon."],
    tiktok_shop: ["vt.tiktok.com", "shop.tiktok.com", "tiktok.com"],
    rakuten: ["click.linksynergy.com", "rakuten."],
    cj: ["anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "tkqlhce.com", "kqzyfj.com", "cj.com"],
    impact: ["sjv.io", "imp.i", "impact.com"],
    awin: ["awin1.com", "tidd.ly", "awin.com"],
    shareasale: ["shareasale.com", "shrsl.com"],
    admitad: ["ad.admitad.com", "admitad.com", "tygbg.com"],
    ebay: ["rover.ebay.com", "ebay.to", "ebay."],
    clickbank: ["hop.clickbank.net", "clickbank.net"],
  };

  function byId(id) { return NETWORKS.find((n) => n.id === id) || null; }

  // Lenient check that a pasted URL looks like the network's tracked link.
  function looksValid(networkId, url) {
    const hosts = LINK_HOSTS[networkId];
    if (!hosts) return true;
    let host = "";
    try { host = new URL(url).host.toLowerCase(); } catch { return false; }
    return hosts.some((h) => host.includes(h));
  }

  const api = { NETWORKS, LINK_HOSTS, byId, looksValid };
  if (typeof window !== "undefined") window.KolAffiliates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api; // server-side reuse
})();
