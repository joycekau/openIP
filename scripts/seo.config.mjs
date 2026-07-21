// SEO source-of-truth for OneIP (oneip.io).
//
// Edit this file to steer SEO. `scripts/generate-seo.mjs` reads it to regenerate
// web/sitemap.xml, web/robots.txt, web/llms.txt and the auto-managed regions of
// web/home.html, rotating the keyword/FAQ pools by ISO week so search + AI answer
// engines keep re-crawling fresh, broadening long-tail coverage over time.

export const SEO = {
  site: {
    name: "OneIP",
    alternateName: "OneIP Launchpad",
    origin: "https://oneip.io",
    tagline: "Turn your influence into a tradeable token",
    summary:
      "OneIP is a Solana creator-IP launchpad — turn your influence into a tradeable token that can't go to zero. One-click creator-token launch, a 20% floor treasury that backs every holder, a KOL trading terminal and a built-in creator social. IP-Fi on Solana. Part of the CoraX ecosystem.",
  },

  pages: [
    { path: "/", priority: "1.0", changefreq: "daily", fresh: true },
    { path: "/launch", priority: "0.9", changefreq: "weekly", fresh: true },
    { path: "/terminal", priority: "0.8", changefreq: "daily", fresh: true },
    { path: "/creators", priority: "0.7", changefreq: "weekly", fresh: true },
    { path: "/shop", priority: "0.6", changefreq: "weekly", fresh: false },
    { path: "/swap", priority: "0.6", changefreq: "weekly", fresh: false },
    { path: "/terms", priority: "0.3", changefreq: "yearly", fresh: false },
    { path: "/privacy", priority: "0.3", changefreq: "yearly", fresh: false },
  ],

  robots: {
    disallow: ["/admin"],
    aiBots: [
      "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot",
      "Claude-User", "anthropic-ai", "PerplexityBot", "Perplexity-User",
      "Google-Extended", "Applebot", "Applebot-Extended", "Amazonbot",
      "Bytespider", "Meta-ExternalAgent", "cohere-ai", "CCBot",
    ],
  },

  keywords: {
    primary: [
      "OneIP", "creator token launchpad", "tokenize your influence", "IP-Fi",
      "Solana creator economy",
    ],
    longTail: [
      "one-click token launch", "floor treasury", "20% floor treasury",
      "KOL terminal", "KOL trading terminal", "creator coin",
      "launch a creator token on Solana", "creator IP token", "Solana creator token",
      "token that can't go to zero", "tradeable creator token", "creator token with a floor",
      "creator economy on Solana", "turn influence into a token", "IP-Fi on Solana",
      "one-click creator token launch", "creator social launchpad", "bonding curve launchpad",
      "influencer token launch", "meme coin with a floor", "Solana launchpad for creators",
      "CoraX ecosystem launchpad", "back your token with a treasury",
    ],
    windowSize: 10,
  },

  faq: {
    core: [
      { q: "What is OneIP?", a: "OneIP is a Solana creator-IP launchpad that turns your influence into a tradeable token that can't go to zero. It offers one-click creator-token launch, a 20% floor treasury that backs holders, a KOL trading terminal and a built-in creator social. It is IP-Fi on Solana and part of the CoraX ecosystem." },
    ],
    rotating: [
      { q: "Which blockchain is OneIP on?", a: "OneIP runs on Solana — creator tokens are launched and traded on Solana, with fast, low-cost transactions." },
      { q: "What is the 20% floor treasury?", a: "Every OneIP creator token routes 20% of revenue into a floor treasury that backs the coin. This price floor is why a OneIP token 'can't go to zero' — holders are backed by real, accumulating value." },
      { q: "How do I launch a creator token on OneIP?", a: "Connect a Solana wallet (e.g. Phantom) and use one-click launch on OneIP to mint your creator token. Revenue from posts, products and reactions escrows to your 20% floor treasury from day one." },
      { q: "What is IP-Fi?", a: "IP-Fi (IP finance) is turning a creator's intellectual property and influence into a tradeable, treasury-backed on-chain token. OneIP is IP-Fi on Solana." },
      { q: "Is OneIP part of CoraX?", a: "Yes. OneIP is the creator-IP launchpad in the CoraX ecosystem, which also includes CahtX (CLOB DEX on Base), Botbuilder, the Cora AI Gateway, StarLive and Qi Gate — all under one login." },
      { q: "What is the KOL terminal?", a: "The KOL terminal is OneIP's trading terminal for tracking key opinion leaders and live Solana creator-token markets — leaderboards, signals and security checks in one place." },
      { q: "Why can't a OneIP token go to zero?", a: "Because 20% of every creator's revenue accumulates in a floor treasury that backs the token. That growing floor sets a price the coin is backed to, so it can't fall to zero the way an unbacked meme coin can." },
      { q: "Does OneIP have a creator social?", a: "Yes. OneIP includes a built-in creator social — posts, follows, comments and paid reactions — so creators can grow an audience and monetize directly, with earnings feeding their token's floor treasury." },
    ],
    windowSize: 3,
  },

  ecosystem: [
    { name: "CoraX", tag: "Web4 super-community app — chat, pay and earn", url: "https://corax.live" },
    { name: "CahtX", tag: "CLOB DEX on Base for meme, community and creator tokens", url: "https://cahtx.com" },
    { name: "Botbuilder", tag: "No-code trading bots for the CahtX DEX", url: "https://botbuilder.cahtx.com" },
    { name: "Cora AI Gateway", tag: "Chat, image & video models behind one API key", url: "https://gateway.corax.live" },
    { name: "StarLive", tag: "Seven-layer AI market intelligence — signals & forecasts", url: "https://starlive.com" },
    { name: "Qi Gate", tag: "Qi Men, Bazi, ZiWei and Yijing readings, guided by Cora", url: "https://qigate.corax.live" },
  ],

  keyPages: [
    { label: "Home", url: "https://oneip.io/" },
    { label: "Launch a creator token", url: "https://oneip.io/launch" },
    { label: "KOL trading terminal", url: "https://oneip.io/terminal" },
    { label: "Creators", url: "https://oneip.io/creators" },
  ],
};

export default SEO;
