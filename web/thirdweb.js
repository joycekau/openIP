// thirdweb EVM (BNB Smart Chain) connector — the marketplace/payments side of oneIP.
// oneIP is dual-chain: the creator TOKEN lives on Solana (see wallet.js / window.KolWallet), the
// MARKETPLACE settles on BSC. thirdweb Connect is EVM-only, so it handles BSC here while Phantom
// handles Solana. This module mirrors KolWallet's shape (address / connect / disconnect / short /
// onChange) so header.js can treat both chains through one UI.
//
// SETUP: thirdweb needs a free, publishable client ID (thirdweb.com → dashboard → your project →
// Settings → API Keys). It's safe to expose in the frontend. Set THIRDWEB_CLIENT_ID as a Vercel env
// var on the open-ip project — /config.js serves it to the browser as window.THIRDWEB_CLIENT_ID,
// which this module reads lazily at connect time. Add oneip.io to the key's allowed domains.
import { createThirdwebClient, defineChain } from "https://esm.sh/thirdweb@5?bundle";
import { createWallet, injectedProvider } from "https://esm.sh/thirdweb@5/wallets?bundle";

// Read the publishable client ID lazily (at connect time), so it works no matter whether
// /config.js (which sets window.THIRDWEB_CLIENT_ID from the Vercel env) loaded before or after this.
const clientId = () => ((typeof window !== "undefined" && window.THIRDWEB_CLIENT_ID) || "").trim();
const BSC = 56; // BNB Smart Chain mainnet

const KolEvm = {
  chain: "bsc",
  address: null,
  _wallet: null,
  _subs: [],
  ready() { return !!clientId(); },

  // Connect a BSC wallet via thirdweb. `rdns` picks the injected wallet (default MetaMask).
  async connect(rdns = "io.metamask") {
    if (!this.ready()) throw new Error("thirdweb client ID not set — add THIRDWEB_CLIENT_ID in Vercel env (open-ip project)");
    if (!injectedProvider(rdns)) { window.open("https://metamask.io/download/", "_blank"); throw new Error("No EVM wallet found — install MetaMask to pay on BSC"); }
    const client = createThirdwebClient({ clientId: clientId() });
    const wallet = createWallet(rdns);
    const account = await wallet.connect({ client, chain: defineChain(BSC) });
    this._wallet = wallet;
    this.address = account.address;
    this._emit();
    return this.address;
  },

  async disconnect() {
    try { if (this._wallet && this._wallet.disconnect) await this._wallet.disconnect(); } catch (e) {}
    this._wallet = null; this.address = null; this._emit();
  },

  short() { return this.address ? this.address.slice(0, 6) + "…" + this.address.slice(-4) : null; },
  onChange(fn) { this._subs.push(fn); },
  _emit() { for (const fn of this._subs) { try { fn(this.address); } catch (e) {} } },
};

window.KolEvm = KolEvm;
