// Shared oneIP.ai header — ONE source of truth for the .ai face (storefront / studio / brands),
// so their nav/buttons match. Self-contained: injects styles, renders logo + nav + EN/中文 toggle
// + "Start selling" CTA. The .ai pages keep their own inline (en/zh) i18n for the body; this header
// drives the language via window.onLangChange(l). Drop-in: add <div id="aiHeader"></div> +
// <script src="aiheader.js"></script>. Active link derived from the URL.
(function () {
  const CSS = `
  .ai-hdr{position:sticky;top:0;z-index:50;background:rgba(8,5,16,.72);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08);font-family:"Plus Jakarta Sans","Noto Sans SC",system-ui,sans-serif}
  .ai-hdr__in{max-width:1200px;margin:0 auto;padding:0 20px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:14px}
  .ai-hdr__logo{display:flex;align-items:center;gap:8px;cursor:pointer;font-family:"Space Grotesk","Plus Jakarta Sans",sans-serif;font-weight:700;font-size:20px;color:#F4EFFC}
  .ai-hdr__logo .mark{width:28px;height:28px;border-radius:9px;background:linear-gradient(120deg,#A855F7,#EC4899,#FB7185);display:grid;place-items:center;font-size:15px}
  .ai-hdr__logo .ai{color:#A99FC0}
  .ai-hdr__nav{display:flex;gap:20px;font-size:14.5px;font-weight:600;color:#A99FC0}
  .ai-hdr__nav a{color:inherit;text-decoration:none;cursor:pointer;transition:.2s;white-space:nowrap}
  .ai-hdr__nav a:hover,.ai-hdr__nav a.is-active{color:#F4EFFC}
  .ai-hdr__right{display:flex;align-items:center;gap:12px}
  .ai-hdr__lang{display:inline-flex;border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:3px;background:rgba(255,255,255,.03)}
  .ai-hdr__lang button{font-family:inherit;font-size:12.5px;font-weight:600;border:0;background:transparent;color:#A99FC0;cursor:pointer;padding:5px 12px;border-radius:999px}
  .ai-hdr__lang button.sel{background:linear-gradient(120deg,#A855F7,#EC4899,#FB7185);color:#fff}
  .ai-hdr__cta{font-family:inherit;font-size:14px;font-weight:700;display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:10px 18px;border-radius:999px;border:0;color:#fff;background:linear-gradient(120deg,#A855F7,#EC4899,#FB7185);box-shadow:0 8px 26px -8px rgba(236,72,153,.6);text-decoration:none;transition:transform .18s}
  .ai-hdr__cta:hover{transform:translateY(-2px)}
  @media(max-width:560px){.ai-hdr__nav{display:none}}
  `;

  const L = {
    shop: { en: "Shop", zh: "商城" }, brands: { en: "Brands", zh: "品牌" },
    studio: { en: "Studio", zh: "工作台" }, community: { en: "Community", zh: "社区" },
    sell: { en: "Start selling", zh: "我要开店" },
  };
  const NAV = [["/ai", "shop"], ["/brands", "brands"], ["/studio", "studio"], ["/feed", "community"]];
  const lang = () => (localStorage.getItem("kol_lang") === "zh" ? "zh" : "en");
  const tr = (k) => (L[k] ? L[k][lang()] : k);
  function activeFor(p) {
    const path = location.pathname;
    if (p === "/ai") return path === "/ai" || path === "/shop" || path === "/" || path === "/ai.html";
    return path === p || path === p + ".html";
  }

  function render() {
    let host = document.getElementById("aiHeader");
    if (!host) { host = document.createElement("div"); host.id = "aiHeader"; document.body.insertBefore(host, document.body.firstChild); }
    const navHtml = NAV.map(([p, k]) => `<a href="${p}" class="${activeFor(p) ? "is-active" : ""}" data-aik="${k}">${tr(k)}</a>`).join("");
    host.className = "ai-hdr";
    host.innerHTML = `<div class="ai-hdr__in">
      <div class="ai-hdr__logo" onclick="location.href='/ai'"><span class="mark">🛍️</span>oneIP<span class="ai">.ai</span></div>
      <nav class="ai-hdr__nav">${navHtml}</nav>
      <div class="ai-hdr__right">
        <div class="ai-hdr__lang">
          <button data-l="en" class="${lang() === "en" ? "sel" : ""}">EN</button>
          <button data-l="zh" class="${lang() === "zh" ? "sel" : ""}">中文</button>
        </div>
        <a class="ai-hdr__cta" href="/studio" data-aik="sell">${tr("sell")}</a>
      </div>
    </div>`;
    wire();
  }

  function setLang(l) {
    localStorage.setItem("kol_lang", l);
    if (window.onLangChange) try { window.onLangChange(l); } catch (e) {} // drives the page's own body i18n
    document.querySelectorAll(".ai-hdr__lang button").forEach((b) => b.classList.toggle("sel", b.dataset.l === l));
    document.querySelectorAll(".ai-hdr [data-aik]").forEach((el) => { el.textContent = tr(el.getAttribute("data-aik")); });
  }
  function wire() {
    document.querySelectorAll(".ai-hdr__lang button").forEach((b) => (b.onclick = () => setLang(b.dataset.l)));
  }

  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
