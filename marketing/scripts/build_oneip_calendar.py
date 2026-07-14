# -*- coding: utf-8 -*-
"""
Generic 365-day social calendar generator with SEPARATE X (Twitter) and Telegram
captions + hashtags per day. Product-agnostic templates + per-product configs.

Usage: python3 build_split_calendar.py <ProductKey> <output.xlsx>
Keys:  Colony | OneIP | Polyfun | CoraX
"""
import sys
from datetime import date, timedelta
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

START_DATE = date(2026, 1, 1)
WEEK = ["SPOTLIGHT","HOWTO","COMPARE","DEEPDIVE","STORY","ENGAGE","CTA"]

# ---------------- generic X (Twitter) templates: short, <=280 ----------------
X_CAP = {
"SPOTLIGHT":[
 "✨ {feat} on {product}: {hook}. → {site}",
 "Meet {feat}. 👀 {hook_cap}. This is {product}. → {site}",
 "{feat} is live on {product}. {hook_cap}. → {site}",
 "New on {product}: {feat}. {hook_cap}. 🚀 {site}",
 "What if you could {hook_lower}? On {product} you can. → {site}",
 "{feat}. {hook_cap}. Built for you, not middlemen. {site}",
 "🔦 {feat} on {product}: {hook}. {site}",
 "One tap: {feat}. {hook_cap}. {product} → {site}",
],
"HOWTO":[
 "💡 {product} tip: use {feat} to {hook_lower}. {site}",
 "How to {hook_lower} on {product}: open {feat}. 🛠️ {site}",
 "Pro move on {product}: {feat}. {hook_cap}. 👇 {site}",
 "Most people miss this: {feat} lets you {hook_lower}. {site}",
 "Quick win 🎯 {feat} → {hook}. {site}",
 "Learn it once: {feat}. {hook_cap}. Save 🔖 {site}",
 "Did you know? {product}'s {feat} lets you {hook_lower}. {site}",
 "3 steps and you {hook_lower}. That's {feat}. {site}",
],
"COMPARE":[
 "{compare_cap} makes you settle. {product} doesn't — {feat}: {hook}. → {site} 🥇",
 "{compare_cap} vs {product}? {feat} decides it: {hook}. {site}",
 "Why stay on {compare_target}? {product} adds {feat} — {hook}. {site}",
 "{compare_cap} can't let you {hook_lower}. {product} can → {feat}. {site}",
 "Ditch {compare_target}. {feat} on {product}: {hook}. → {site}",
 "Same idea, done right: {feat}. {hook_cap}. {site}",
 "{compare_cap} was the old way. {product} → {feat}: {hook}. {site}",
 "Upgrade from {compare_target}: {feat} → {hook}. {site}",
],
"DEEPDIVE":[
 "🧠 Under the hood: {feat}. {hook_cap}. Powerful AND yours. {site}",
 "How {feat} works on {product}: {hook}. Real infra. {site}",
 "Why {feat} matters: {hook}. Your keys, your rules. 🔒 {site}",
 "Deep-dive 🌊 {feat}: {hook}. No black boxes. {site}",
 "For builders 👷 {feat}: {hook}. {site}",
 "One truth: {feat} = {hook}. Simple promise. {site}",
 "Transparency > hype 🔎 {feat}: {hook}. {site}",
 "The 'how' behind {feat}: {hook}. {site}",
],
"STORY":[
 "Real scenario 🎬 {hook_cap}. Starts with {feat} on {product}. {site}",
 "The turning point? {feat}. {hook_cap}. → {site}",
 "Someone came for one thing, stayed for {feat}: {hook}. {site}",
 "From the old grind to one flow: {feat}. {hook_cap}. {site}",
 "The 'aha' moment: {feat}. {hook_cap}. Find yours → {site}",
 "People are using {feat} to {hook_lower}. {site}",
 "Picture this 🌆 {hook_cap}. {feat} makes it real. {site}",
 "Use-case of the week: {feat}. {hook_cap}. {site}",
],
"ENGAGE":[
 "POLL 🗳️ What matters most: A) {hook_lower} B) low fees C) real ownership D) all? ({product}: D 😏) {site}",
 "If you had {feat} ({hook}), what would you do first? Reply 👇 {site}",
 "Hot take 🌶️ {hook}. Agree? {feat} makes it real. {site}",
 "Tag someone 👀 who doesn't believe you can {hook_lower}. Then show {feat}. {site}",
 "This or that 🔀 old way, OR {feat}? {site}",
 "GM ☀️ what should we ship next: {feat} or your idea? 🗨️ {site}",
 "RT 🔁 if you're done settling. {feat}: {hook}. {site}",
 "Fill the blank: 'I'd switch to {product} if it had ___.' {site}",
],
"CTA":[
 "Start on {product} → {site}. Follow {x} · join {tg} 👥",
 "Your invite is open → {site}. Community: {tg} 💬",
 "Don't just watch — jump in → {site}. Follow {x}. 🚀",
 "One tap to better → {site}. Move with us on {tg}. 🪑",
 "Join the people going all-in → {site}. Say GM in {tg}. ✨",
 "Build on YOUR terms → {site}. {x} + {tg} in bio. 🔥",
 "Ready? {product} → {site}. Community: {tg} 🤝",
 "Early is a superpower ⏳ {product} → {site}. Follow {x}. 📌",
],
}

# ---------------- generic Telegram templates: richer, multi-line ----------------
TG_CAP = {
"SPOTLIGHT":[
 "✨ *{feat}*\n\n{hook_cap}.\n\nOn {product}, this is built in — the way it should be. Come see for yourself.\n\n👉 {site}",
 "🔦 Feature spotlight — *{feat}*\n\n{hook_cap}. That's the whole point of {product}.\n\n👉 Try it: {site}\nQuestions? Ask below 👇",
 "🚀 *{feat}* is live on {product}\n\n{hook_cap}. This is what makes {product} different.\n\n👉 {site}",
],
"HOWTO":[
 "🛠️ *How-To: {feat}*\n\nWant to {hook_lower}? On {product} it takes seconds:\n1️⃣ Open {feat}\n2️⃣ Follow the flow\n3️⃣ Done ✅\n\n👉 {site}",
 "💡 *Pro tip* — {feat}\n\n{hook_cap}. Most people miss this one. Try it and drop your result in the chat 👇\n\n👉 {site}",
 "📌 *{feat}* in a nutshell\n\n{hook_cap}. Save this so you remember it.\n\n👉 {site}",
],
"COMPARE":[
 "⚔️ *{compare_cap} vs {product}*\n\nOn {compare_target} you'd be stuck. On {product} you get *{feat}*: {hook}.\n\n👉 Make the switch: {site}",
 "🧾 Honest comparison — *{feat}*\n\n{compare_cap}? Fine. {product}? {hook_cap} — and it's built for you.\n\n👉 {site}",
 "Why people are leaving {compare_target} 👀\n\n*{feat}*: {hook}. {product} makes that normal.\n\n👉 See for yourself: {site}",
],
"DEEPDIVE":[
 "🧠 *Under the hood: {feat}*\n\n{hook_cap}. We built this so it's powerful *and* yours — transparency over hype.\n\n👉 {site}\nAsk your hardest question below 👇",
 "🔬 *Deep-dive — {feat}*\n\n{hook_cap}. No black boxes. This is the kind of thing that should be the standard, not the exception.\n\n👉 {site}",
 "🔒 Trust note — *{feat}*\n\n{hook_cap}. Your keys, your rules. Non-negotiable on {product}.\n\n👉 {site}",
],
"STORY":[
 "🎬 *Real scenario*\n\n{hook_cap}. That moment usually starts with *{feat}* on {product}.\n\n👉 Your turn: {site}",
 "💼 A little story\n\nSomeone joined {product} for one thing and stayed for *{feat}*: {hook}.\n\nWhat'll be your reason? 👇\n👉 {site}",
 "☀️ A day on {product}\n\n*{feat}* kicks in and suddenly you {hook_lower}. That's the magic.\n\n👉 {site}",
],
"ENGAGE":[
 "🗳️ *POLL* — what matters most to you?\n\n🅰️ {hook_cap}\n🅱️ Low fees\n🇨 Real ownership\n🇩 All of it\n\n({product} says 🇩 😏) Vote + tell us why 👇\n👉 {site}",
 "💬 Quick one — if you had *{feat}* ({hook}), what would you do first?\n\nBest answer gets a shoutout 👇\n👉 {site}",
 "🌶️ Hot take: {hook}.\n\nAgree? *{feat}* on {product} makes it real. 👇\n👉 {site}",
],
"CTA":[
 "🚀 *Start on {product}*\n\n{hook_cap} with *{feat}*. Free to jump in.\n\n👉 {site}\n🐦 Follow us on X: {x}\n💬 Invite a friend who needs this 👇",
 "✨ Ready to jump in?\n\n{product} → {site}\nFollow the journey on X: {x}\nYou're already in the right place — bring a friend 👇",
 "💛 The app is the start. The community is the point.\n\nBegin 👉 {site}\nFollow {x} for drops. Share this 👇",
],
}

IMG={"SPOTLIGHT":"Hero product shot: {subject}. Bold headline '{feat}', small tag '{site}'. {style}",
 "HOWTO":"Instructional carousel cover: {subject}, numbered 1-2-3 steps + lightbulb. Text '{feat} in 3 steps'. {style}",
 "COMPARE":"Split-screen VS: left a dull {ct}, right a glowing {product} screen with {subject}. 'VS' badge, 'Upgrade → {site}'. {style}",
 "DEEPDIVE":"Techy blueprint illustration: {subject}, circuit lines, tokens, data particles. Label '{feat}'. {style}",
 "STORY":"Lifestyle scene: a real, diverse person delighted at a device showing {subject}. Warm setting, subtle {product} branding. {style}",
 "ENGAGE":"Bold social poll graphic: big question, 2-4 option chips, emojis, clean space. {subject} as a small motif. {style}",
 "CTA":"Punchy CTA poster: {subject} as hero, giant 'Join {site}' button, small X + Telegram icons. {style}"}

def cap_first(s): return s[:1].upper()+s[1:] if s else s
def pick(pool,i,n):
    out=[]
    for k in range(n):
        t=pool[(i+k*3)%len(pool)]
        if t not in out: out.append(t)
    return " ".join(out)

WRAP=Alignment(wrap_text=True,vertical="top"); CENTER=Alignment(horizontal="center",vertical="center",wrap_text=True)
_th=Side(style="thin",color="D9D9D9"); BORDER=Border(left=_th,right=_th,top=_th,bottom=_th)
def tint(h,f):
    r,g,b=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    return f"{int(r+(255-r)*f):02X}{int(g+(255-g)*f):02X}{int(b+(255-b)*f):02X}"

def build(cfg,out):
    feats=list(cfg["features"].keys()); rows=[]
    for i in range(365):
        d=START_DATE+timedelta(days=i); role=WEEK[d.weekday()]
        feat=feats[i%len(feats)]; hook,subject=cfg["features"][feat]
        theme=cfg["themes"][d.month-1][0]
        fmt=dict(product=cfg["name"],feat=feat,hook=hook,hook_cap=cap_first(hook),hook_lower=hook[0].lower()+hook[1:],
                 site=cfg["site"],compare_target=cfg["compare_target"],compare_cap=cap_first(cfg["compare_target"]),
                 x=cfg["x"],tg=cfg["tg"])
        xcap=X_CAP[role][(i//7)%len(X_CAP[role])].format(**fmt)
        tgcap=TG_CAP[role][(i//7)%len(TG_CAP[role])].format(**fmt)
        img=IMG[role].format(subject=subject,feat=feat,site=cfg["site"],ct=cfg["compare_target"],product=cfg["name"],style=cfg["style"])
        if cfg.get("mascot"): img=cfg["mascot"]+img
        rows.append({"Day":i+1,"Date":d.strftime("%Y-%m-%d"),"Weekday":d.strftime("%a"),
            "Month Theme":theme,"Content Type":cfg["labels"][role],"Feature Focus":feat,
            "Best Time (local)":["9:00 AM","12:30 PM","6:00 PM","8:00 PM"][i%4],
            "X (Twitter) Caption":xcap,"X Hashtags":pick(cfg["x_tags"],i,3),
            "Telegram Caption":tgcap,"Telegram Hashtags":pick(cfg["tg_tags"],i,4),
            "Image Prompt (Grok / Gemini / Cora AI)":img,
            "CTA":f"Start at {cfg['site']} · Follow {cfg['x']} on X · Join {cfg['tg']}"})
    wb=Workbook(); ws=wb.active; ws.title="365-Day Calendar (X + Telegram)"
    hdr=list(rows[0].keys()); ws.append(hdr)
    for c,_ in enumerate(hdr,1):
        x=ws.cell(row=1,column=c); x.fill=PatternFill("solid",fgColor=cfg["brand_color"]); x.font=Font(bold=True,color=cfg["accent"],size=11)
        x.alignment=CENTER; x.border=BORDER
    ba,bb=tint(cfg["accent"],.86),tint(cfg["accent"],.74)
    for ri,row in enumerate(rows,2):
        fill=PatternFill("solid",fgColor=(ba if date.fromisoformat(row["Date"]).month%2==0 else bb))
        for ci,k in enumerate(hdr,1):
            x=ws.cell(row=ri,column=ci,value=row[k]); x.alignment=WRAP; x.border=BORDER; x.fill=fill
    W={"Day":5,"Date":11,"Weekday":8,"Month Theme":20,"Content Type":22,"Feature Focus":26,"Best Time (local)":12,
       "X (Twitter) Caption":56,"X Hashtags":26,"Telegram Caption":75,"Telegram Hashtags":28,
       "Image Prompt (Grok / Gemini / Cora AI)":70,"CTA":40}
    for ci,k in enumerate(hdr,1): ws.column_dimensions[get_column_letter(ci)].width=W.get(k,16)
    ws.freeze_panes="A2"; ws.auto_filter.ref=f"A1:{get_column_letter(len(hdr))}1"
    s=wb.create_sheet("Read Me"); s.column_dimensions["A"].width=24; s.column_dimensions["B"].width=118
    r=[1]
    def kv(a,b):
        s.cell(row=r[0],column=1,value=a).font=Font(bold=True,color=cfg["brand_color"],size=11); s.cell(row=r[0],column=1).alignment=WRAP
        s.cell(row=r[0],column=2,value=b).alignment=WRAP; s.row_dimensions[r[0]].height=54; r[0]+=1
    s.cell(row=r[0],column=1,value=f"{cfg['name']} · 365-Day Calendar (X + Telegram)").font=Font(bold=True,size=20,color=cfg["brand_color"]); r[0]+=1
    s.cell(row=r[0],column=1,value=cfg["tagline"]).font=Font(italic=True,color="444444"); r[0]+=2
    kv("What it is",cfg["positioning"]); kv("Target segments",cfg["audience"])
    kv("Format","Each row = one day with a SEPARATE X post (short ≤280, 3 hashtags) and Telegram post (longer, community tone, 4 hashtags), sharing theme/feature/image.")
    kv("Weekly rhythm"," · ".join(f"{dd}: {cfg['labels'][WEEK[i]]}" for i,dd in enumerate(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])))
    kv("How to use","Copy X Caption + X Hashtags → X; copy Telegram Caption + Telegram Hashtags → your Telegram channel. Paste the Image Prompt into Grok/Gemini/Cora AI. Post at the suggested time.")
    if cfg.get("compliance"): kv("⚠️ Compliance",cfg["compliance"])
    kv("⚠️ Placeholders",f"'{cfg['site']}', X '{cfg['x']}', Telegram '{cfg['tg']}' — replace with your real links.")
    h=wb.create_sheet("Hashtag Bank"); h.column_dimensions["A"].width=16; h.column_dimensions["B"].width=90
    h.cell(row=1,column=1,value="X pool").font=Font(bold=True,color=cfg["brand_color"]); h.cell(row=1,column=2,value=" ".join(cfg["x_tags"])).alignment=WRAP
    h.cell(row=2,column=1,value="Telegram pool").font=Font(bold=True,color=cfg["brand_color"]); h.cell(row=2,column=2,value=" ".join(cfg["tg_tags"])).alignment=WRAP
    h.cell(row=3,column=1,value="Image style").font=Font(bold=True,color=cfg["brand_color"]); h.cell(row=3,column=2,value=cfg["style"]).alignment=WRAP
    wb.save(out); return len(rows)

# ============================== PRODUCT CONFIGS ==============================
P={}
P["Colony"]={"name":"Colony","site":"colony.land","x":"@ColonyLand","tg":"t.me/ColonyLand",
 "brand_color":"1A0B0B","accent":"58F542","compare_target":"a rigged casino game",
 "tagline":"High-frequency Web3 battle royale — bet the safe room, and losing pays you back.",
 "positioning":"Every 45 seconds, 9 rooms appear — 8 get invaded by zombies, 1 is safe. Pick your room; winners split the pot. Lose? The Mining Pool pays you back over time in COLONY. Provably fair, non-custodial.",
 "audience":"Web3 gamers & degens wanting fast fair on-chain action; players burned by riggable games; casual ($1) to whales ($100); Auto-Mode grinders.",
 "compliance":"Real-money on-chain betting — keep it responsible. Never promise winnings or guaranteed recovery amounts/timing. Exclude wallet addresses & operator mechanics. Add play-responsibly framing; respect age/geo rules.",
 "x_tags":["#Colony","#ColonyLand","#Web3Gaming","#ProvablyFair","#GameFi","#BattleRoyale","#PlayOnChain","#Crypto"],
 "tg_tags":["#Colony","#ColonyLand","#Web3Gaming","#GameFi","#ProvablyFair","#PlayOnChain"],
 "labels":{"SPOTLIGHT":"Gameplay Spotlight","HOWTO":"How to Play","COMPARE":"Colony vs Rigged Games","DEEPDIVE":"Provably-Fair Tech","STORY":"Player Story","ENGAGE":"Poll / Meme","CTA":"Play Now"},
 "style":"cinematic post-apocalyptic arcade art, dark ruins, toxic radioactive-green glow, neon HUD, 9-doors motif, countdown timers, stylized 3D, 8k, high contrast.",
 "themes":[("Enter the Colony",""),("How a Round Works",""),("Losing Pays You Back",""),("Play Your Level",""),("The Zombie King",""),("Auto Mode",""),("We Can't Rig It",""),("The COLONY Token",""),("Own a Node",""),("Pro-Player Season",""),("Player Spotlight",""),("Year of the Colony","")],
 "features":{
  "45-Second Rounds":("play a full round every 45 seconds — no lobbies, pure adrenaline","a countdown timer over 9 doors as a crowd piles in and zombies loom in green fog"),
  "Pick the Safe Room":("make one decision — which of 9 rooms is safe — and win the pot","nine doors, eight leaking green zombie glow and one golden safe door"),
  "Losing Pays You Back":("recover your stake over time through the Mining Pool in COLONY","a red loss turning into a glowing seed growing COLONY coins in a mining pool"),
  "Bet Tiers $1-$100":("play your level — $1 to $100, each tier in its own fair pool","five stake chips $1 $5 $10 $50 $100 each feeding its own prize pool"),
  "Zombie King Jackpot":("catch the Zombie King storming your room and win a massive jackpot","a crowned Zombie King bursting into a room raining a huge jackpot of coins"),
  "Auto Mode":("set your strategy, round limit and loss cap and play hands-free","an autopilot panel with room-strategy, max-rounds and loss-cap dials"),
  "Provably Fair":("trust the result — the safe room is on-chain random, nobody can rig it","a glowing on-chain RNG dice sealed in a tamper-proof shield, 'we can't rig it'"),
  "Non-Custodial Vault":("your funds stay yours — deposit, play, withdraw anytime on-chain","a personal vault whose key is held by the player, funds never leaving their control"),
  "COLONY Token":("clean tokenomics — fixed supply, no tax, buyback-and-burn","a COLONY coin above a supply curve pointing down, a burn flame consuming tokens"),
  "Node Shareholder Program":("own a node and share in the growth of the game","a premium glowing node badge beside a revenue-share pie, a community behind it")}}

P["OneIP"]={"name":"OneIP","site":"oneip.io","x":"@OneIP","tg":"t.me/OneIP",
 "brand_color":"1A1608","accent":"E9C46A","compare_target":"a typical meme-coin launchpad",
 "tagline":"Tokenize your influence — launch your creator coin on Solana, with a 20% floor.",
 "positioning":"A Solana creator/KOL token launchpad + gmgn-style trading terminal + creator social platform. Launch a coin in one click — every coin ships with a 20% floor treasury (can't go to zero), verified socials across every wallet, and a creator feed. Non-custodial, 7 languages.",
 "audience":"Creators/KOLs (esp. SE-Asia) monetizing influence; traders trading creator coins & tracking KOL smart-money; fans who buy, hold and redeem the floor.",
 "compliance":"Not financial advice; token trading is risky. The 20% floor is a treasury backstop, NOT a price/return guarantee. Never promise gains. Some on-chain features run on Solana devnet — don't claim mainnet features that aren't live. Never post API keys.",
 "x_tags":["#OneIP","#Solana","#CreatorCoin","#KOL","#Launchpad","#SOL","#CreatorEconomy","#Web3"],
 "tg_tags":["#OneIP","#Solana","#CreatorCoin","#KOL","#Launchpad","#CreatorEconomy"],
 "labels":{"SPOTLIGHT":"Feature Spotlight","HOWTO":"Launch How-To","COMPARE":"OneIP vs Meme Launchpads","DEEPDIVE":"On-Chain / Trust Tech","STORY":"Creator Story","ENGAGE":"Poll","CTA":"Launch Now"},
 "style":"premium dark-and-gold 'noble' fintech UI, near-black background, rich gold accents, Solana hints, gmgn-style charts, verified/checkmark & floor motifs, elegant, 8k, high contrast.",
 "themes":[("Meet OneIP",""),("One-Click Launch",""),("The 20% Floor",""),("Verified Everywhere",""),("The Trading Terminal",""),("Follow the Smart Money",""),("Your Creator Feed",""),("Your AI Clone",""),("Safe & Verified",""),("Non-Custodial & Global",""),("Creator Spotlight",""),("Year of OneIP","")],
 "features":{
  "One-Click Token Launch":("launch your own creator coin in one click — logo, site, socials attached","a creator tapping a glowing gold Launch button as their coin mints with logo and socials"),
  "20% Floor Treasury":("every coin ships with a 20% floor treasury so it can't go to zero","a gold coin resting on a glowing '20%' floor, a falling price arrow stopped dead"),
  "Cross-Wallet Credibility":("your logo and verified socials show in Phantom, Solflare, Backpack, Jupiter & Solscan","one coin's logo and a verified checkmark appearing across several wallet screens"),
  "gmgn-Style Trading Terminal":("track trending coins and trade on a fast pro data terminal","a sleek dark-and-gold terminal showing trending Solana tokens with live charts"),
  "KOL Smart-Money Tracker":("see what top KOL wallets are buying, with a live PnL engine","a smart-money leaderboard of KOL wallets with live PnL and buys/sells"),
  "Creator Social Feed":("post, grow followers and sell subscriptions on your own feed","a creator social feed with posts, follow and subscribe buttons and a community"),
  "AI Clone Auto-Reply":("a Pro AI clone that auto-replies to your community in your voice","a glowing AI twin of a creator automatically answering fan messages"),
  "Redeem the Floor":("holders can redeem the on-chain floor value anytime — real backing","a holder pressing 'redeem floor' and receiving backed value from an on-chain vault"),
  "Security & Verification":("RugCheck badges and signed social attestation build trust at a glance","a coin card with a green RugCheck shield and a verified-social checkmark"),
  "Non-Custodial · 7 Languages":("connect Phantom, keep custody, use it in 7 languages","a Phantom connect screen with a language selector EN 中文 ไทย Bahasa Tiếng-Việt 日本語 한국어")}}

P["Polyfun"]={"name":"Polyfun","site":"polyfun.app","x":"@Polyfun","tg":"t.me/Polyfun",
 "brand_color":"2A1240","accent":"B98CFF","compare_target":"a typical affiliate program",
 "tagline":"Own a node. Grow the network. Earn together.",
 "positioning":"Polyfun turns growing the network into shared upside: own a node, invite your circle, and earn transparent, multi-tier rewards as the ecosystem expands. On-chain and provable.",
 "audience":"Crypto-curious earners, affiliate marketers, community leaders and WeChat/WhatsApp network-builders who want a simple, transparent way to earn by growing a network.",
 "compliance":"Rewards depend on real network growth — never promise fixed/guaranteed income. Be transparent about how commissions work; follow local rules on referral/earning programs.",
 "x_tags":["#Polyfun","#NodeOwner","#PassiveIncome","#Referral","#EarnCrypto","#Web3Rewards","#RunANode","#Web3"],
 "tg_tags":["#Polyfun","#NodeOwner","#EarnCrypto","#Referral","#Web3Rewards","#PassiveIncome"],
 "labels":{"SPOTLIGHT":"Node Spotlight","HOWTO":"Earn How-To","COMPARE":"Polyfun vs Old Referrals","DEEPDIVE":"Tokenomics Deep-Dive","STORY":"Earner Story","ENGAGE":"Poll","CTA":"Join Us"},
 "style":"vibrant playful Web3 finance UI, deep violet background, glowing magenta & gold reward coins, upward arrows, node-network constellations, friendly bold, 8k, high contrast. Features the Polyfun rainbow-parrot mascot 'Lucky' as the hero.",
 "mascot":("[ATTACH REFERENCE IMAGE: marketing/brand/mascot/reference/polyfun-mascot-canonical.png — keep the character IDENTICAL] "
   "Featuring the Polyfun mascot 'Lucky', a cute chubby cartoon RAINBOW PARROT: golden-yellow face, orange crest & beak, big violet eyes, "
   "signature PURPLE 'polyFUN' cap and PURPLE 'polyFUN' bandana, rainbow-gradient plumage, glossy 3D Pixar-style. The mascot is the hero. "),
 "themes":[("Meet Polyfun",""),("Node 101",""),("The Referral Engine",""),("Multi-Tier Rewards",""),("Become a Leader",""),("Passive by Design",""),("Transparent Earnings",""),("Grow the Ecosystem",""),("Team Playbook",""),("Top-Earner Season",""),("Earner Spotlight",""),("Year of Polyfun","")],
 "features":{
  "Node Ownership":("own a piece of the network and earn from its growth","the rainbow parrot mascot proudly holding a glowing crystalline network node, energy pulsing outward"),
  "Referral Rewards":("earn rewards every time your invite grows the network","the parrot mascot sharing a referral link that splits into golden coins flowing back"),
  "Multi-Tier Commissions":("earn across multiple tiers as your team expands","the mascot atop a tidy pyramid of avatars with reward coins cascading up the tiers"),
  "Leader Program":("level up to leader and unlock bigger rewards & tools","the mascot ascending a glowing podium with a leader badge and a team behind"),
  "Passive Node Rewards":("collect rewards passively just for running a node","the mascot relaxing as a node quietly streams coins into a wallet under a moon"),
  "Instant Payouts":("get paid out fast and transparently, on-chain","the mascot pressing a payout button, coins zipping instantly into a wallet with a check"),
  "Team Dashboard":("track your whole team and earnings in one clean dashboard","the mascot pointing at a dashboard with team size, tiers and a rising earnings chart"),
  "Promo Toolkit":("share ready-made promo assets in one tap","the mascot opening a toolkit of glowing share cards, links and QR codes"),
  "Reserved Invites":("hand out exclusive reserved invites to your inner circle","the mascot passing a golden VIP invite ticket with a glowing seal to a friend"),
  "On-Chain Transparency":("see every commission verifiably recorded on-chain","the mascot beside a transparent glass ledger of provable reward entries with a shield check")}}

P["CoraX"]={"name":"CoraX","site":"corax.live","x":"@CoraXlive","tg":"t.me/CoraX",
 "brand_color":"0B1F3A","accent":"6FE9FF","compare_target":"WhatsApp",
 "tagline":"WhatsApp's privacy + WeChat's super-app convenience + a creator economy that pays you.",
 "positioning":"CoraX is the all-in-one, end-to-end encrypted app where your community, chats, AI assistant (Cora) and money live together — chats, groups, calls and stories, plus a built-in wallet, creator channels and auto-translation in 21+ languages. Private, and on your terms.",
 "audience":"Influencers/KOLs & community leaders wanting to own + monetize their audience; merchants selling in chat; privacy-conscious users; global multilingual communities; WeChat/WhatsApp users ready to switch.",
 "compliance":"Promote only user-facing, available features; mark roadmap items as 'coming soon'. Don't overstate encryption scope (full E2EE is for 1:1 direct chats). Respect privacy positioning — no data-harvesting claims must stay true.",
 "x_tags":["#CoraX","#coraxlive","#SuperApp","#PrivacyFirst","#Web3Social","#E2EE","#CreatorEconomy","#Web3"],
 "tg_tags":["#CoraX","#coraxlive","#SuperApp","#PrivacyFirst","#CreatorEconomy","#Web3Social"],
 "labels":{"SPOTLIGHT":"Feature Spotlight","HOWTO":"Tip / How-To","COMPARE":"CoraX vs WhatsApp/WeChat","DEEPDIVE":"Privacy / Tech","STORY":"Creator Story","ENGAGE":"Poll","CTA":"Join Us"},
 "style":"sleek dark-mode UI, deep midnight-navy & obsidian background, glowing electric-cyan and violet gradient accents, glassmorphism, soft neon glow, premium fintech-meets-messaging, 8k, crisp, minimal.",
 "themes":[("Meet CoraX",""),("Privacy First",""),("Your AI Companion",""),("Your Keys, Your Money",""),("Find Your People",""),("One App, Everything",""),("The Great Switch",""),("Earn While You Chat",""),("Connected Everywhere",""),("Power-User Season",""),("Community Spotlight",""),("Year of CoraX","")],
 "features":{
  "End-to-End Encryption":("chat with full end-to-end encryption — keys only you hold","a chat bubble sealed with a glowing padlock, encryption key particles dissolving into light"),
  "Cora AI Assistant":("an AI that translates, drafts and summarizes right inside your chats","a friendly glowing AI orb assistant beside a chat window answering in real time"),
  "Built-In Crypto Wallet":("accept tips, sell and gate content with a wallet built into chat","a sleek in-app wallet card with balances and a send button, coins floating"),
  "Creator Channels":("turn your group chat into a channel you own, grow and monetize","a vibrant channel feed with avatars, reactions and a growing member counter"),
  "Auto-Translation (21+ langs)":("everyone reads your community in their own language, automatically","a chat where each member's bubble shows a different language, a globe glowing"),
  "Voice & Video Meetings":("host AMAs and classes right inside the app — no Zoom link","a video call grid of diverse friends with a small encryption shield badge"),
  "Creator Monetization":("tips, paid content and product sales flow straight to your wallet","a chat bubble turning into a glowing coin flying to a creator's wallet, confetti"),
  "Moderation & Analytics":("run your community like a brand with moderation + analytics","a clean channel dashboard with engagement charts and moderation controls"),
  "Stories & Media":("share disappearing Stories, voice and video messages","a ring of circular story avatars at the top of a chat app, one opening a photo"),
  "Mini-Apps (Super-App)":("chat, pay, shop and more — dozens of mini-apps in one place","a grid of glowing app icons blooming out of a single chat app, super-app layout")}}

if __name__=="__main__":
    key=sys.argv[1]; out=sys.argv[2] if len(sys.argv)>2 else f"{key.lower()}_365_social_calendar.xlsx"
    if key not in P: print("keys:",", ".join(P)); sys.exit(1)
    print("Wrote",out,"("+str(build(P[key],out))+" days) ["+key+"]")
