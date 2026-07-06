// Transak fiat on-ramp (BUY) + off-ramp (SELL) for oneIP — vanilla, zero deps. Per Transak's
// MANDATORY migration, the widget URL must be generated server-side (query-param widget URLs are
// deprecated). So this just asks our own backend (POST /api/transak/widget-url) for a fresh, signed
// widgetUrl and points an <iframe> at it. The Transak API key + SECRET live only on the server.
// Non-custodial: crypto settles to the user's own connected wallet, whose address we pass through so
// Transak delivers funds only there. Exposes window.KolTransak.
(function () {
  if (window.KolTransak) return;

  // Per-chain defaults. `addr()` pulls the address from the matching connector so the prefilled
  // wallet always matches the selected network (a BSC address on a Solana order would be rejected).
  const NET = {
    bsc:    { network: "bsc",    crypto: "USDT", addr: () => window.KolEvm && window.KolEvm.address },
    solana: { network: "solana", crypto: "SOL",  addr: () => window.KolWallet && window.KolWallet.address },
  };

  const KolTransak = {
    _on: null,
    ready() { return !!window.TRANSAK_ENABLED; },
    env() { return (window.TRANSAK_ENVIRONMENT || "STAGING").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "STAGING"; },

    // Generate a signed widget URL on the backend and load it into the iframe.
    // product: "BUY" (on-ramp) | "SELL" (off-ramp). chain: "bsc" | "solana".
    // Returns { ok:true } or { ok:false, error }.
    async mount(iframeEl, { product = "BUY", chain = "bsc", fiat, amount } = {}) {
      if (!iframeEl) return { ok: false, error: "no iframe element" };
      const c = NET[chain] || NET.bsc;
      const body = {
        productsAvailed: product,
        network: c.network,
        cryptoCurrencyCode: c.crypto,
        cryptoCurrencyList: c.crypto,           // keep the user on the chain they picked
        walletAddress: (c.addr && c.addr()) || undefined,
        fiatCurrency: fiat || undefined,
        defaultFiatAmount: amount || undefined,
      };
      try {
        const r = await fetch("/api/transak/widget-url", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.widgetUrl) return { ok: false, error: j.error || j.message || ("HTTP " + r.status) };
        iframeEl.src = j.widgetUrl;
        return { ok: true };
      } catch (e) { return { ok: false, error: (e && e.message) || "network error" }; }
    },

    // Subscribe to Transak widget events (order created/successful, close). One listener; last wins.
    onEvent(fn) { this._on = fn; },
  };

  // Transak posts status events to the parent via window.postMessage from its own origin.
  window.addEventListener("message", (e) => {
    let host = "";
    try { host = new URL(e.origin).hostname; } catch (_) { return; }
    if (!/(^|\.)transak\.com$/i.test(host)) return;
    if (KolTransak._on) { try { KolTransak._on(e.data); } catch (_) {} }
  });

  window.KolTransak = KolTransak;
})();
