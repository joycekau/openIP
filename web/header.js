// Shared oneIP.io header — ONE source of truth so every page's nav/buttons match exactly.
// Self-contained: injects its own styles, renders the logo + nav + language switcher + Connect
// Wallet, and self-wires KolI18n (language, 7 langs) + KolWallet (connect). Drop-in: add
//   <div id="appHeader"></div> ... <script src="i18n.js"></script><script src="wallet.js"></script><script src="header.js"></script>
// It replaces #appHeader (or prepends to <body>). Active link is derived from the URL.
(function () {
  const CSS = `
  /* global mobile safety — applied on every page that loads the header */
  img,svg,video,iframe{max-width:100%}
  @media(max-width:860px){html,body{overflow-x:hidden;max-width:100%}}
  .oneip-hdr{position:sticky;top:0;z-index:50;background:rgba(8,5,16,.72);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08);font-family:"Plus Jakarta Sans","Noto Sans SC",system-ui,sans-serif}
  .oneip-hdr__in{max-width:1200px;margin:0 auto;padding:0 20px;height:68px;display:flex;align-items:center;justify-content:space-between;gap:14px}
  .oneip-hdr__logo{display:flex;align-items:center;gap:8px;cursor:pointer;font-family:"Space Grotesk","Plus Jakarta Sans",sans-serif;font-weight:700;font-size:21px;letter-spacing:-.3px;color:#F4EFFC}
  .oneip-hdr__logo .io{color:#A99FC0}
  .oneip-hdr__nav{display:flex;gap:20px;font-size:14.5px;font-weight:600;color:#A99FC0}
  .oneip-hdr__nav a{color:inherit;text-decoration:none;transition:.2s;cursor:pointer;white-space:nowrap}
  .oneip-hdr__nav a:hover,.oneip-hdr__nav a.is-active{color:#F4EFFC}
  .oneip-hdr__right{display:flex;align-items:center;gap:12px}
  .oneip-lang{position:relative}
  .oneip-lang__btn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#F4EFFC;border-radius:999px;padding:8px 13px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
  .oneip-lang__btn:hover{border-color:rgba(168,85,247,.5)}
  .oneip-lang__btn svg{width:11px;height:11px;opacity:.6;transition:transform .2s}
  .oneip-lang.open .oneip-lang__btn svg{transform:rotate(180deg)}
  .oneip-lang__menu{position:absolute;top:calc(100% + 8px);right:0;min-width:150px;background:#150E26;border:1px solid rgba(168,85,247,.28);border-radius:14px;padding:6px;display:none;z-index:60;box-shadow:0 20px 50px -14px rgba(0,0,0,.7)}
  .oneip-lang.open .oneip-lang__menu{display:block}
  .oneip-lang__opt{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border-radius:9px;font-size:14px;color:#C9C2DC;cursor:pointer;white-space:nowrap}
  .oneip-lang__opt:hover{background:rgba(255,255,255,.05);color:#F4EFFC}
  .oneip-lang__opt.sel{background:linear-gradient(120deg,#A855F7,#EC4899);color:#fff}
  .oneip-lang__opt .ck{font-size:12px;opacity:0}
  .oneip-lang__opt.sel .ck{opacity:1}
  .oneip-hdr__cta{font-family:inherit;font-size:14px;font-weight:700;display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:10px 16px;border-radius:999px;border:0;color:#fff;
    background:linear-gradient(120deg,#A855F7 0%,#EC4899 55%,#FB7185 100%);box-shadow:0 8px 26px -8px rgba(236,72,153,.6);transition:transform .18s,box-shadow .25s}
  .oneip-hdr__cta:hover{transform:translateY(-2px);box-shadow:0 16px 38px -10px rgba(236,72,153,.75)}
  .oneip-hdr__burger{display:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;width:40px;height:40px;color:#F4EFFC;cursor:pointer;align-items:center;justify-content:center;flex:none}
  .oneip-hdr__burger svg{width:20px;height:20px;display:block}
  .oneip-mnav{position:fixed;inset:0;z-index:120;background:rgba(6,4,12,.6);backdrop-filter:blur(6px);display:none}
  .oneip-mnav.open{display:block}
  .oneip-mnav__panel{position:absolute;top:0;right:0;height:100%;width:min(320px,86vw);background:#0F0A1C;border-left:1px solid rgba(168,85,247,.24);
    display:flex;flex-direction:column;padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:-24px 0 60px -20px rgba(0,0,0,.7)}
  .oneip-mnav__top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .oneip-mnav__x{background:none;border:0;color:#A99FC0;font-size:24px;line-height:1;cursor:pointer;padding:4px 8px}
  .oneip-mnav a{color:#C9C2DC;text-decoration:none;font-size:16.5px;font-weight:600;padding:14px 8px;border-radius:10px;border-bottom:1px solid rgba(255,255,255,.06)}
  .oneip-mnav a:active,.oneip-mnav a.is-active{color:#F4EFFC;background:rgba(255,255,255,.04)}
  .oneip-mnav__langs{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}
  .oneip-mnav__langs button{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#C9C2DC;border-radius:999px;padding:8px 13px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  .oneip-mnav__langs button.sel{background:linear-gradient(120deg,#A855F7,#EC4899);color:#fff;border-color:transparent}
  @media(max-width:860px){
    .oneip-hdr__nav{display:none}
    .oneip-hdr__burger{display:inline-flex}
    .oneip-hdr__in{padding:0 14px;height:60px}
    .oneip-lang{display:none}
    .oneip-hdr__cta{padding:9px 14px;font-size:13.5px}
  }
  @media(max-width:380px){ .oneip-hdr__logo{font-size:19px} }
  /* unified dual-chain connect modal */
  .oneip-wm{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;background:rgba(6,4,12,.6);backdrop-filter:blur(4px)}
  .oneip-wm.open{display:flex}
  .oneip-wm__card{width:min(400px,92vw);background:#150E26;border:1px solid rgba(168,85,247,.28);border-radius:18px;padding:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.8);font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#F4EFFC}
  .oneip-wm__h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .oneip-wm__h b{font-size:17px;font-weight:800}
  .oneip-wm__x{background:none;border:0;color:#A99FC0;font-size:20px;cursor:pointer;line-height:1}
  .oneip-wm__sub{font-size:12.5px;color:#A99FC0;margin-bottom:16px}
  .oneip-wm__opt{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:13px;padding:14px;margin-bottom:10px;cursor:pointer;color:inherit;font-family:inherit;transition:.15s}
  .oneip-wm__opt:hover{border-color:rgba(168,85,247,.5);background:rgba(255,255,255,.06)}
  .oneip-wm__ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-size:19px;flex:none}
  .oneip-wm__ic.sol{background:linear-gradient(135deg,#9945FF,#14F195)}
  .oneip-wm__ic.bsc{background:linear-gradient(135deg,#F0B90B,#F8D12F);color:#2A2300}
  .oneip-wm__t{flex:1;min-width:0}
  .oneip-wm__t .n{font-size:14.5px;font-weight:700}
  .oneip-wm__t .m{font-size:11.5px;color:#A99FC0;margin-top:1px}
  .oneip-wm__t .m.on{color:#25F4EE}
  .oneip-wm__act{font-size:12px;font-weight:700;color:#A99FC0;white-space:nowrap}
  .oneip-wm__swap{display:block;text-align:center;margin-top:6px;font-size:12.5px;color:#C9A9FF;text-decoration:none}
  .oneip-wm__swap:hover{color:#F4EFFC}
  .oneip-wm__more{width:100%;background:none;border:1px dashed rgba(255,255,255,.14);border-radius:12px;padding:11px;margin-top:2px;color:#A99FC0;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
  .oneip-wm__more:hover{border-color:rgba(240,185,11,.5);color:#F0B90B}
  .oneip-wm__div{display:flex;align-items:center;gap:10px;margin:12px 2px 8px;color:#6E6684;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .oneip-wm__div::before,.oneip-wm__div::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.08)}
  `;

  // nav: [path, i18n-key, fallback]. Creators = creator directory/profiles,
  // Shop = the on-oneIP marketplace (all creators' products & services).
  const NAV = [
    ["/", "nav_home", "Home"],
    ["/terminal", "nav_terminal", "Terminal"],
    ["/launch", "nav_launch", "Launch"],
    ["/creators", "nav_creators", "Creators"],
    ["/shop", "nav_shop", "Shop"],
    ["/studio", "nav_studio", "Studio"],
    ["/swap", "nav_swap", "Swap"],
  ];
  const tr = (key, fb) => (window.KolI18n ? KolI18n.t(key) : fb) || fb;
  const curLangLabel = () => { const f = window.KolI18n && KolI18n.LANGS.find((x) => x[0] === KolI18n.lang()); return f ? f[1] : "EN"; };
  function syncLang() {
    const lbl = document.getElementById("oneipLangLabel"); if (lbl) lbl.textContent = curLangLabel();
    document.querySelectorAll("#oneipLangMenu .oneip-lang__opt").forEach((o) => o.classList.toggle("sel", !!window.KolI18n && o.dataset.l === KolI18n.lang()));
  }

  function activeFor(path) {
    const p = location.pathname;
    if (path === "/") return p === "/" || p === "/home" || p === "/home.html";
    if (path.startsWith("http")) return false;
    return p === path || p === path + ".html";
  }

  function render() {
    let host = document.getElementById("appHeader");
    if (!host) { host = document.createElement("div"); host.id = "appHeader"; document.body.insertBefore(host, document.body.firstChild); }
    const navHtml = NAV.map(([path, key, fb]) =>
      `<a href="${path}"${path.startsWith("http") ? ' rel="noopener"' : ""} class="${activeFor(path) ? "is-active" : ""}" data-i18n="${key}">${tr(key, fb)}</a>`
    ).join("");
    const langHtml = window.KolI18n ? `
      <div class="oneip-lang" id="oneipLangWrap">
        <button class="oneip-lang__btn" id="oneipLangBtn" type="button" aria-label="language">
          <span id="oneipLangLabel">${curLangLabel()}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="oneip-lang__menu" id="oneipLangMenu">
          ${KolI18n.LANGS.map(([c, label]) => `<div class="oneip-lang__opt${c === KolI18n.lang() ? " sel" : ""}" data-l="${c}">${label}<span class="ck">✓</span></div>`).join("")}
        </div>
      </div>` : "";
    host.className = "oneip-hdr";
    host.innerHTML = `<div class="oneip-hdr__in">
      <div class="oneip-hdr__logo" onclick="location.href='/'"><span class="oneip-hdr__word">oneIP<span class="io">.io</span></span></div>
      <nav class="oneip-hdr__nav">${navHtml}</nav>
      <div class="oneip-hdr__right"><span id="appHeaderExtra" style="display:flex;align-items:center;gap:10px"></span>${langHtml}
        <button class="oneip-hdr__cta" id="oneipConnect">${tr("connect_wallet", "Connect Wallet")}</button>
        <button class="oneip-hdr__burger" id="oneipBurger" type="button" aria-label="menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
    </div>`;
    renderMobileNav();
    wire();
  }

  // The header uses backdrop-filter, which would trap a position:fixed drawer inside it — so the
  // mobile menu is a separate body-level overlay.
  function renderMobileNav() {
    let m = document.getElementById("oneipMnav");
    if (!m) { m = document.createElement("div"); m.id = "oneipMnav"; m.className = "oneip-mnav"; document.body.appendChild(m); m.addEventListener("click", () => m.classList.remove("open")); }
    const links = NAV.map(([path, key, fb]) =>
      `<a href="${path}"${path.startsWith("http") ? ' rel="noopener"' : ""} class="${activeFor(path) ? "is-active" : ""}" data-i18n="${key}">${tr(key, fb)}</a>`).join("");
    const langs = window.KolI18n ? `<div class="oneip-mnav__langs">${KolI18n.LANGS.map(([c, label]) => `<button data-l="${c}" class="${c === KolI18n.lang() ? "sel" : ""}">${label}</button>`).join("")}</div>` : "";
    m.innerHTML = `<div class="oneip-mnav__panel">
      <div class="oneip-mnav__top"><div class="oneip-hdr__logo" onclick="location.href='/'"><span class="oneip-hdr__word">oneIP<span class="io">.io</span></span></div>
        <button class="oneip-mnav__x" id="oneipMnavX" type="button" aria-label="close">✕</button></div>
      ${links}${langs}</div>`;
    // stop clicks inside the panel from closing; wire close + lang
    m.querySelector(".oneip-mnav__panel").addEventListener("click", (e) => e.stopPropagation());
    m.querySelector("#oneipMnavX").onclick = () => m.classList.remove("open");
    m.querySelectorAll(".oneip-mnav__langs button").forEach((b) => b.onclick = () => {
      if (window.KolI18n) KolI18n.setLang(b.dataset.l);
      if (window.onLangChange) try { window.onLangChange(b.dataset.l); } catch (e) {}
      m.classList.remove("open");
    });
  }

  function wire() {
    const wrap = document.getElementById("oneipLangWrap");
    if (wrap) {
      document.getElementById("oneipLangBtn").onclick = (e) => { e.stopPropagation(); wrap.classList.toggle("open"); };
      wrap.querySelectorAll(".oneip-lang__opt").forEach((o) => o.onclick = () => {
        const l = o.dataset.l;
        wrap.classList.remove("open");
        if (window.KolI18n) KolI18n.setLang(l);   // updates KolI18n-tagged content + the header
        if (window.onLangChange) try { window.onLangChange(l); } catch (e) {} // bridge for pages with their own i18n
        syncLang();
      });
      if (!window.__oneipLangDoc) { window.__oneipLangDoc = true; document.addEventListener("click", () => { const w = document.getElementById("oneipLangWrap"); if (w) w.classList.remove("open"); }); }
    }
    const btn = document.getElementById("oneipConnect");
    if (btn) {
      btn.onclick = openWalletModal;
      refreshConnectLabel();
      if (window.KolWallet) { KolWallet.onChange(refreshConnectLabel); KolWallet.onList(() => renderWalletModal()); }
      // KolEvm (thirdweb) may load a tick later (module import); subscribe when it's ready.
      const hookEvm = () => { if (window.KolEvm) { window.KolEvm.onChange(refreshConnectLabel); return true; } return false; };
      if (!hookEvm()) { let n = 0; const iv = setInterval(() => { if (hookEvm() || ++n > 40) clearInterval(iv); }, 100); }
    }
    const burger = document.getElementById("oneipBurger");
    if (burger) burger.onclick = () => { const m = document.getElementById("oneipMnav"); if (m) m.classList.add("open"); };
  }

  // ---- unified dual-chain connect (Solana · Phantom  +  BSC · thirdweb) ----
  function connectLabel() {
    const sol = window.KolWallet && KolWallet.address;
    const evm = window.KolEvm && KolEvm.address;
    if (sol && evm) return KolWallet.short() + " +BSC";
    if (sol) return KolWallet.short();
    if (evm) return KolEvm.short();
    return tr("connect_wallet", "Connect Wallet");
  }
  function refreshConnectLabel() {
    const btn = document.getElementById("oneipConnect");
    if (btn) btn.textContent = connectLabel();
    renderWalletModal();
  }
  function ensureModal() {
    let m = document.getElementById("oneipWalletModal");
    if (!m) {
      m = document.createElement("div");
      m.id = "oneipWalletModal"; m.className = "oneip-wm";
      document.body.appendChild(m);
      m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); });
    }
    return m;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const walletIcon = (icon, fallback, cls) =>
    icon && /^data:image\//.test(icon)
      ? `<span class="oneip-wm__ic ${cls}" style="background:#0d0a18"><img src="${esc(icon)}" alt="" style="width:24px;height:24px;border-radius:6px"></span>`
      : `<span class="oneip-wm__ic ${cls}">${fallback}</span>`;

  // Solana section: one row per detected Wallet Standard wallet (Phantom, Solflare, Backpack …).
  // When connected, collapses to a single "connected" row. When none are installed, shows install links.
  function solanaSection() {
    const kw = window.KolWallet;
    if (kw && kw.address) {
      return `<button class="oneip-wm__opt" data-k="sol-disc">
        <span class="oneip-wm__ic sol">◎</span>
        <span class="oneip-wm__t"><span class="n">Solana wallet</span><span class="m on">${esc(kw.short())}</span></span>
        <span class="oneip-wm__act">Disconnect</span>
      </button>`;
    }
    const wallets = kw ? kw.list() : [];
    if (wallets.length) {
      return wallets.map((w) => `<button class="oneip-wm__opt" data-k="sol" data-name="${esc(w.name)}">
        ${walletIcon(w.icon, "◎", "sol")}
        <span class="oneip-wm__t"><span class="n">${esc(w.name)}</span><span class="m">Creator tokens · launch, trade, top-up</span></span>
        <span class="oneip-wm__act">Connect</span>
      </button>`).join("");
    }
    return `<div class="oneip-wm__opt" style="cursor:default">
      <span class="oneip-wm__ic sol">◎</span>
      <span class="oneip-wm__t"><span class="n">No Solana wallet detected</span><span class="m">Install one to launch &amp; trade tokens</span></span>
    </div>
    <div style="display:flex;gap:8px;margin:-2px 0 10px">
      <a class="oneip-wm__swap" style="flex:1;text-align:center;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px" href="https://phantom.app/" target="_blank" rel="noopener">Phantom ↗</a>
      <a class="oneip-wm__swap" style="flex:1;text-align:center;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px" href="https://solflare.com/" target="_blank" rel="noopener">Solflare ↗</a>
      <a class="oneip-wm__swap" style="flex:1;text-align:center;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px" href="https://backpack.app/" target="_blank" rel="noopener">Backpack ↗</a>
    </div>`;
  }
  function bscRow() {
    const w = window.KolEvm;
    const on = w && w.address;
    return `<button class="oneip-wm__opt" data-k="bsc">
      <span class="oneip-wm__ic bsc">⬡</span>
      <span class="oneip-wm__t"><span class="n">BNB Chain · thirdweb</span><span class="m ${on ? "on" : ""}">${on ? esc(w.short()) : "Marketplace payments (BSC)"}</span></span>
      <span class="oneip-wm__act">${on ? "Disconnect" : "Connect"}</span>
    </button>`;
  }
  // Solana-first, contextual connect: the modal leads with Solana (the creator's identity + token)
  // and keeps BSC — which is payments-only — behind a small expander, so pages like the Studio never
  // offer the wrong chain. BSC auto-expands once connected (or when a page asks for it via scope).
  let wmShowBsc = false;
  function renderWalletModal() {
    const m = document.getElementById("oneipWalletModal");
    if (!m || !m.classList.contains("open")) return;
    const bscOn = !!(window.KolEvm && window.KolEvm.address);
    const showBsc = wmShowBsc || bscOn;
    const bscBlock = showBsc
      ? `<div class="oneip-wm__div">BNB Chain · payments</div>${bscRow()}`
      : `<button class="oneip-wm__more" id="oneipWmMore">＋ Paying on the marketplace? Connect BNB Chain</button>`;
    m.innerHTML = `<div class="oneip-wm__card">
      <div class="oneip-wm__h"><b>Connect your wallet</b><button class="oneip-wm__x" id="oneipWmX">✕</button></div>
      <div class="oneip-wm__sub">Your creator token &amp; identity live on <b>Solana</b> — connect a Solana wallet to launch, trade and manage your Studio.</div>
      ${solanaSection()}
      ${bscBlock}
    </div>`;
    m.querySelector("#oneipWmX").onclick = () => m.classList.remove("open");
    const more = m.querySelector("#oneipWmMore");
    if (more) more.onclick = () => { wmShowBsc = true; renderWalletModal(); };
    m.querySelectorAll(".oneip-wm__opt[data-k]").forEach((b) => b.onclick = async () => {
      const k = b.dataset.k;
      try {
        if (k === "sol") { await window.KolWallet.connect(b.dataset.name); }
        else if (k === "sol-disc") { await window.KolWallet.disconnect(); }
        else if (k === "bsc") {
          const w = window.KolEvm;
          if (!w) { alert("thirdweb not loaded yet — try again in a moment"); return; }
          if (w.address) await w.disconnect(); else await w.connect();
        }
      } catch (e) {
        if (e && e.message === "PICK_WALLET") { /* list already shown */ }
        else alert((e && e.message) || "Wallet error");
      }
      refreshConnectLabel();
    });
  }
  // scope: "sol" (default, Solana-first with BSC tucked away) or "bsc"/"both" (start with BSC shown,
  // e.g. from the Swap page or a checkout). Pages can also set window.ONEIP_WALLET_SCOPE.
  function openWalletModal(scope) {
    const s = scope || window.ONEIP_WALLET_SCOPE || "sol";
    wmShowBsc = (s === "bsc" || s === "both");
    const m = ensureModal();
    m.classList.add("open");
    renderWalletModal();
  }
  // Expose the unified connect modal so any page (e.g. the Studio gate) can trigger it instead of
  // hard-jumping to a single wallet's site.
  window.openWalletModal = openWalletModal;

  // re-translate header labels when the language changes elsewhere
  window.addEventListener("i18n", () => {
    document.querySelectorAll(".oneip-hdr__nav a, .oneip-mnav a").forEach((a) => { const k = a.getAttribute("data-i18n"); if (k) a.textContent = tr(k, a.textContent); });
    const btn = document.getElementById("oneipConnect");
    if (btn && !(window.KolWallet && KolWallet.address)) btn.textContent = tr("connect_wallet", "Connect Wallet");
    document.querySelectorAll(".oneip-mnav__langs button").forEach((b) => b.classList.toggle("sel", !!window.KolI18n && b.dataset.l === KolI18n.lang()));
    syncLang();
  });

  // PWA: inject manifest + iOS/theme meta once, and register the (network-first) service worker so
  // oneIP is installable on mobile home screens. Done here so every page gets it without editing heads.
  (function pwa() {
    if (window.__oneipPwa) return; window.__oneipPwa = true;
    const head = document.head;
    const add = (tag, attrs) => { if (document.querySelector(tag + (attrs.rel ? `[rel="${attrs.rel}"]` : attrs.name ? `[name="${attrs.name}"]` : ""))) return; const el = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); head.appendChild(el); };
    add("link", { rel: "manifest", href: "/manifest.webmanifest" });
    add("meta", { name: "theme-color", content: "#080510" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
    add("meta", { name: "apple-mobile-web-app-title", content: "oneIP" });
    add("link", { rel: "apple-touch-icon", href: "/assets/logo_mark.png" });
    add("link", { rel: "icon", href: "/assets/logo_mark.png" });
    if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  })();

  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  // Load public runtime config (publishable keys from Vercel env) then the thirdweb (BSC) connector,
  // once, globally — so every page has window.THIRDWEB_CLIENT_ID + window.KolEvm for the dual-chain
  // connect modal without each page including them. thirdweb.js reads the client ID lazily, so the
  // two loading in any order is fine.
  if (!window.__oneipCfgLoaded) { window.__oneipCfgLoaded = true; const c = document.createElement("script"); c.src = "/config.js"; c.onerror = () => {}; document.head.appendChild(c); }
  if (!window.__oneipEvmLoaded) { window.__oneipEvmLoaded = true; const s = document.createElement("script"); s.type = "module"; s.src = "/thirdweb.js"; s.onerror = () => {}; document.head.appendChild(s); }
  // Load the Solana (Wallet Standard) connector globally so every page's Connect button works — pages
  // that need signing (studio/launch/coin) still include wallet.js directly; the IIFE self-guards.
  if (!window.KolWallet && !window.__oneipWalletLoaded) { window.__oneipWalletLoaded = true; const w = document.createElement("script"); w.src = "/wallet.js"; w.onerror = () => {}; document.head.appendChild(w); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
