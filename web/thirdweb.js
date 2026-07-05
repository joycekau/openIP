// thirdweb EVM (BNB Smart Chain) connector — the marketplace/payments side of oneIP.
// oneIP is dual-chain: the creator TOKEN lives on Solana (see wallet.js / window.KolWallet), the
// MARKETPLACE settles on BSC. thirdweb Connect is EVM-only, so it handles BSC here while Phantom
// handles Solana. This module mirrors KolWallet's shape (address / connect / disconnect / short /
// onChange) so header.js can treat both chains through one UI.
//
// SETUP: thirdweb needs a free, publishable client ID (thirdweb.com → dashboard → Settings → API
// Keys). It's safe to expose in the frontend. Set it either by editing CLIENT_ID below, or by
// defining window.THIRDWEB_CLIENT_ID before this script loads.
import { createThirdwebClient, defineChain } from "https://esm.sh/thirdweb@5?bundle";
import { createWallet, injectedProvider } from "https://esm.sh/thirdweb@5/wallets?bundle";

const CLIENT_ID = (typeof window !== "undefined" && window.THIRDWEB_CLIENT_ID) || "REPLACE_WITH_THIRDWEB_CLIENT_ID";
const BSC = 56; // BNB Smart Chain mainnet

const KolEvm = {
  chain: "bsc",
  address: null,
  _wallet: null,
  _subs: [],
  ready() { return CLIENT_ID && CLIENT_ID !== "REPLACE_WITH_THIRDWEB_CLIENT_ID"; },

  // Connect a BSC wallet via thirdweb. `rdns` picks the injected wallet (default MetaMask).
  async connect(rdns = "io.metamask") {
    if (!this.ready()) throw new Error("thirdweb client ID not set — add it in thirdweb.js (see SETUP)");
    if (!injectedProvider(rdns)) { window.open("https://metamask.io/download/", "_blank"); throw new Error("No EVM wallet found — install MetaMask to pay on BSC"); }
    const client = createThirdwebClient({ clientId: CLIENT_ID });
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
