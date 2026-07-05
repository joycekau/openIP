// Shared oneIP.io header — ONE source of truth so every page's nav/buttons match exactly.
// Self-contained: injects its own styles, renders the logo + nav + language switcher + Connect
// Wallet, and self-wires KolI18n (language, 7 langs) + KolWallet (connect). Drop-in: add
//   <div id="appHeader"></div> ... <script src="i18n.js"></script><script src="wallet.js"></script><script src="header.js"></script>
// It replaces #appHeader (or prepends to <body>). Active link is derived from the URL.
(function () {
  const CSS = `
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
  @media(max-width:600px){.oneip-hdr__nav{display:none}}
  `;

  // nav: [path, i18n-key, fallback]. Creators = creator directory/profiles,
  // Shop = the on-oneIP marketplace (all creators' products & services).
  const NAV = [
    ["/", "nav_home", "Home"],
    ["/terminal", "nav_terminal", "Terminal"],
    ["/launch", "nav_launch", "Launch"],
    ["/creators", "nav_creators", "Creators"],
    ["/shop", "nav_shop", "Shop"],
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
      <div class="oneip-hdr__logo" onclick="location.href='/'">oneIP<span class="io">.io</span></div>
      <nav class="oneip-hdr__nav">${navHtml}</nav>
      <div class="oneip-hdr__right"><span id="appHeaderExtra" style="display:flex;align-items:center;gap:10px"></span>${langHtml}
        <button class="oneip-hdr__cta" id="oneipConnect">${tr("connect_wallet", "Connect Wallet")}</button>
      </div>
    </div>`;
    wire();
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
    if (btn && window.KolWallet) {
      const label = () => (KolWallet.address ? KolWallet.short() : tr("connect_wallet", "Connect Wallet"));
      btn.textContent = label();
      btn.onclick = () => (KolWallet.address ? KolWallet.disconnect() : KolWallet.connect().catch((e) => alert(e.message)));
      KolWallet.onChange(() => (btn.textContent = label()));
    }
  }

  // re-translate header labels when the language changes elsewhere
  window.addEventListener("i18n", () => {
    document.querySelectorAll(".oneip-hdr__nav a").forEach((a) => { const k = a.getAttribute("data-i18n"); if (k) a.textContent = tr(k, a.textContent); });
    const btn = document.getElementById("oneipConnect");
    if (btn && !(window.KolWallet && KolWallet.address)) btn.textContent = tr("connect_wallet", "Connect Wallet");
    syncLang();
  });

  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
