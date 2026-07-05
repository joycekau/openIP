// Solana connector for oneIP — built on the Wallet Standard, so it auto-detects EVERY installed
// Solana wallet (Phantom, Solflare, Backpack, …) instead of hard-jumping to phantom.app. Vanilla,
// zero deps: the Wallet Standard handshake is a tiny browser protocol we implement inline. The user
// keeps their own keys; we never touch funds. Exposes window.KolWallet.
//
// Why not thirdweb here? thirdweb's client-side in-app wallets are EVM-only; its 2025 Solana support
// is a server-side API (secret key), not a browser signer. So Solana stays on real Solana wallets
// (this file) and thirdweb handles the BSC marketplace side (thirdweb.js / window.KolEvm).
(function () {
  if (window.KolWallet) return; // guard: some pages include wallet.js directly AND header.js injects it
  const LS_KEY = "oneip.wallet"; // remember the last wallet the user picked, for silent reconnect
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  // Minimal base58 encoder — wallet-standard returns signatures as raw bytes; RPC + explorers want b58.
  function bs58encode(bytes) {
    bytes = Array.from(bytes || []);
    let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    const digits = [0];
    for (let i = zeros; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let str = ""; for (let k = 0; k < zeros; k++) str += "1";
    for (let i = digits.length - 1; i >= 0; i--) str += B58[digits[i]];
    return str;
  }

  const SOL_SIGN_SEND = "solana:signAndSendTransaction";
  const SOL_SIGN = "solana:signTransaction";
  const isSolanaWallet = (w) => !!(w && w.features && (w.features[SOL_SIGN_SEND] || w.features[SOL_SIGN]));

  // ---- Wallet Standard app-side discovery (implements the two-way register/app-ready handshake) ----
  const registry = new Map(); // name -> wallet object
  function register(...wallets) {
    let added = false;
    for (const w of wallets) { if (isSolanaWallet(w) && !registry.has(w.name)) { registry.set(w.name, w); added = true; } }
    if (added && window.KolWallet) window.KolWallet._emitList();
    return () => {};
  }
  const api = { register };
  try { window.addEventListener("wallet-standard:register-wallet", (e) => { try { e.detail(api); } catch (_) {} }); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api })); } catch (_) {}

  const KolWallet = {
    address: null,
    _wallet: null,   // the chosen wallet-standard wallet
    _account: null,  // the chosen WalletAccount
    _chain: "solana:devnet", // chain.js targets devnet; keep in sync if that moves to mainnet
    _off: null,      // standard:events unsubscribe
    _subs: [],
    _listSubs: [],

    // All detected Solana wallets, for the connect modal. Each: { name, icon }.
    list() { return Array.from(registry.values()).map((w) => ({ name: w.name, icon: w.icon || "" })); },
    has(name) { return registry.has(name); },

    // Connect a specific wallet by name. With no name: reconnect the last-used one, or if exactly one
    // wallet is installed, connect it; otherwise throw and let the caller open the picker modal.
    async connect(name) {
      let w = name ? registry.get(name) : null;
      if (!w) {
        const last = registry.get(localStorage.getItem(LS_KEY) || "");
        const only = registry.size === 1 ? registry.values().next().value : null;
        w = last || only;
      }
      if (!w) {
        if (registry.size === 0) throw new Error("No Solana wallet found — install Phantom, Solflare or Backpack to continue");
        throw new Error("PICK_WALLET"); // sentinel: caller should show the wallet picker
      }
      const feat = w.features["standard:connect"];
      if (!feat) throw new Error(`${w.name} does not support connect`);
      const { accounts } = await feat.connect();
      const acc = (accounts && accounts[0]) || (w.accounts && w.accounts[0]);
      if (!acc) throw new Error(`${w.name} returned no account`);
      this._bind(w, acc);
      try { localStorage.setItem(LS_KEY, w.name); } catch (_) {}
      return this.address;
    },

    _bind(w, acc) {
      if (this._off) { try { this._off(); } catch (_) {} this._off = null; }
      this._wallet = w; this._account = acc; this.address = acc.address;
      const events = w.features["standard:events"];
      if (events && events.on) {
        this._off = events.on("change", (props) => {
          // account disconnected or switched underneath us
          const next = props && props.accounts;
          if (next) {
            if (!next.length) { this._clear(); }
            else if (next[0].address !== this.address) { this._account = next[0]; this.address = next[0].address; this._emit(); }
          }
        });
      }
      this._emit();
    },

    async disconnect() {
      const w = this._wallet;
      if (w && w.features && w.features["standard:disconnect"]) {
        try { await w.features["standard:disconnect"].disconnect(); } catch (_) {}
      }
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
      this._clear();
    },

    _clear() {
      if (this._off) { try { this._off(); } catch (_) {} this._off = null; }
      this._wallet = null; this._account = null; this.address = null; this._emit();
    },

    // Silently reconnect the last-used wallet if it already trusts this site.
    async eager() {
      const name = (() => { try { return localStorage.getItem(LS_KEY); } catch (_) { return null; } })();
      if (!name) return;
      const w = registry.get(name);
      if (!w) return;
      const feat = w.features["standard:connect"];
      if (!feat) return;
      try {
        const { accounts } = await feat.connect({ silent: true });
        const acc = (accounts && accounts[0]) || (w.accounts && w.accounts[0]);
        if (acc) this._bind(w, acc);
      } catch (_) {}
    },

    // Ensure a wallet is connected before a signing action; returns the address or throws.
    async ensure() {
      if (this.address) return this.address;
      return this.connect();
    },

    // Serialize a web3.js Transaction and sign+broadcast via the connected wallet. Returns the
    // base58 signature string. `connection` (optional) is used only for the signTransaction fallback
    // when a wallet lacks signAndSendTransaction. chain defaults to devnet (matches chain.js).
    async signAndSend(tx, chain, connection) {
      const w = this._wallet, acc = this._account;
      if (!w || !acc) throw new Error("Connect your Solana wallet first");
      chain = chain || this._chain;
      const serialized = new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      const sns = w.features[SOL_SIGN_SEND];
      if (sns) {
        const out = await sns.signAndSendTransaction({ account: acc, transaction: serialized, chain });
        const res = Array.isArray(out) ? out[0] : out;
        return bs58encode(res.signature);
      }
      const sf = w.features[SOL_SIGN];
      if (!sf) throw new Error(`${w.name} cannot sign Solana transactions`);
      if (!connection) throw new Error("Cannot broadcast — wallet only signs, no connection provided");
      const so = await sf.signTransaction({ account: acc, transaction: serialized, chain });
      const signed = (Array.isArray(so) ? so[0] : so).signedTransaction;
      return await connection.sendRawTransaction(signed);
    },

    short() { return this.address ? this.address.slice(0, 4) + "…" + this.address.slice(-4) : null; },

    onChange(fn) { this._subs.push(fn); },
    onList(fn) { this._listSubs.push(fn); },
    _emit() { for (const fn of this._subs) { try { fn(this.address); } catch (_) {} } },
    _emitList() { for (const fn of this._listSubs) { try { fn(this.list()); } catch (_) {} } },
  };

  window.KolWallet = KolWallet;
  // eager-reconnect once the DOM is ready (or now, if header.js injected us after that point)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => KolWallet.eager());
  else KolWallet.eager();
})();
