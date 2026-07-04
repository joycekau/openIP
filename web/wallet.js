// Phantom (Solana) non-custodial wallet connector — vanilla, zero deps.
// The user keeps their own keys; we never touch funds. Exposes window.KolWallet.
(function () {
  const KolWallet = {
    address: null,
    _subs: [],

    provider() {
      if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) return window.phantom.solana;
      if (window.solana && window.solana.isPhantom) return window.solana;
      return null;
    },

    async connect() {
      const p = this.provider();
      if (!p) { window.open("https://phantom.app/", "_blank"); throw new Error("Phantom wallet not found — install it to continue"); }
      const res = await p.connect();
      this.address = res.publicKey.toString();
      this._emit();
      return this.address;
    },

    async disconnect() {
      const p = this.provider();
      if (p && p.disconnect) { try { await p.disconnect(); } catch (e) {} }
      this.address = null;
      this._emit();
    },

    // silently reconnect if the user already trusted this site
    async eager() {
      const p = this.provider();
      if (!p) return;
      try { const res = await p.connect({ onlyIfTrusted: true }); this.address = res.publicKey.toString(); this._emit(); } catch (e) {}
    },

    short() { return this.address ? this.address.slice(0, 4) + "…" + this.address.slice(-4) : null; },

    onChange(fn) { this._subs.push(fn); },
    _emit() { for (const fn of this._subs) { try { fn(this.address); } catch (e) {} } },
  };

  window.KolWallet = KolWallet;
  document.addEventListener("DOMContentLoaded", () => KolWallet.eager());
})();
