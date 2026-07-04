> # 🟣 给接手这个项目的 Claude —— 请先读这一段
>
> **你正在接手 oneIP 项目的开发(换了电脑/账号)。开始前请照做:**
>
> 1. **先完整读两个文件,不用让用户重讲背景:**
>    - 本文件 `PROJECT-STATUS.md`(完整现状 + 完善度 + 待办)。
>    - `MEMORY-detailed-log.md`(超详细逐功能实现细节、坑、验证结果 —— 是真相来源)。
> 2. **仓库** = 零依赖 Node。`npm install` → `npm run serve` 起 8787。`npm run commerce:smoke` 跑分账测试。ADMIN_TOKEN 在 `.env`(=`Qwer1234@admin`)。
> 3. **⚠️ Git 规矩**:平时改在 `dev` 分支、本地测;**稳了才合 `main`**——合进 main 才会自动部署上线(Render → oneip.io)。**别直接往 main 推没测过的东西。** 若从这份快照(zip)接手,先把工作提交进 git(远端 main 不含这些未提交改动,以本快照为准)。
> 4. **🔴 有一个未决策等用户拍板:Pro 到底砍没砍?** 早期说"已砍 $10/$39 Pro、创作者工具免费",据此改了 `/api/ai/draft`;但 `/api/publish/*` 仍挂 `hasPublish`($39)门禁没拆,且发布 UI 有两套(`feed.html` 老/Pro门禁 vs `studio.html` 新/免费账号后台)。**动发布相关代码前,先问用户 Pro 保留还是砍,再统一。**
> 5. **对外措辞铁律**:只讲"营收→协议回购→抬高保底(utility/协议机制)",**绝不讲**分红/上市/持币人分钱/投资回报(触证券 Howey 线)。代理/推荐分成对外叫"渠道服务佣金/老带新奖励",绝不叫"下级/发展会员"。
> 6. **preview 工具本环境不稳**(导航抽风、ai.html 截图超时);用 preview_eval 查 DOM 验证,`npm run serve` 手动跑正常。
>
> —— 读完以上,你就有完整上下文了,可以直接继续开发。下面是正文。

---

# oneIP — 完整现状文档 (Project Status)

> 生成于 2026-07-02。用于换机接手开发。标注每个功能"已完善 ✅ / 部分 🟡 / 未做 ❌ / 待部署或花钱 ⏳"。
> 仓库:`C:\Users\user\kol-meme`(内部标识符仍叫 kol-meme;品牌 = oneIP)。

---

## 0. 一分钟总览

**oneIP = 网红/创作者 IP 发币台 + 电商变现 + gmgn 式终端。两个域名:**
- **oneIP.ai** = 面向普通人/粉丝的「正门」:纯法币电商 + 创作者作品 + 社交互动 + 一键分发。**完全不露币**。
- **oneIP.io** = 代币引擎:发币 / 20%地板 / 买卖赎回 / 终端。

**核心机制(链上宪法):** 每个币标准化 10 亿盘、公平发射零预挖;买入 80%进曲线/20%灌地板;卖出 2%税进地板("砸盘反抬保底");随时按持仓比例赎回金库 SOL = 数学保底"永不归零";无冻结权、非貔貅。

**商业闭环:** 粉丝法币买货/打赏/表情 → 净利 20% 自动回购灌该创作者的币地板(链上可查)。**对外只讲"营收→协议回购→抬高保底(utility)",绝不讲分红/上市/证券。**

**技术栈:** 零依赖 Node(`npm run serve` 起 8787,`process.env.PORT`)、文件式 JSON 存储(`data/*.json`)、原生 http。链上 = Solana Rust/Anchor(`onchain/programs/kolpad`)。前端 = 纯 HTML/JS(无框架),CDN 引 web3.js。部署 = Render(Blueprint `render.yaml`)。

**运行:**
```
npm run serve      # 起服务器 8787(读 .env)
npm run commerce:smoke   # 电商+分账 e2e 测试(全绿)
npm run launch:smoke     # 发币验证流程
```

---

## 1. 架构与身份模型

- **一种账号**:邮箱注册出的 `handle` = 全站唯一身份。绑 Phantom 钱包后 handle↔wallet 互查。**没有"粉丝账号"和"创作者账号"之分**——发布任何东西(产品/原创帖/供应链产品/一键14平台)就自动"变创作者"+ 自动生成价值池代币(`ensureValuePool`,幂等)。
- **免费/零门槛**:变创作者、发帖、生成占位代币 = **全免费、不用钱包**。只有**主动上链激活**(Phantom 真铸币)才付 **0.1 SOL 发币费**(+少量租金 ≈ 0.11◎)。
- **占位池 → 真币迁移**:没上链前代币是占位 mint(`Kol...`),销售 20% 存 escrow;真上链时 `activateRealToken` 把 escrow flush 进真实地板。
- **鉴权(部分)**:已注册账号的创作者写操作需带 session token(`mayActAs` 守卫);未注册 handle/钱包保持开放(向后兼容,narrowing gap)。

---

## 2. oneIP.ai(法币电商正门)—— 前端 + 后端

### 2.1 首页瀑布流(`web/ai.html`) ✅ 已完善
- **Pinterest 式瀑布流**(CSS columns,响应式 5 列):混排商品(实物/数字/NFT)+ 作品(带图/视频的帖),作品最新在前 = **全站发现 feed**。
- 卡片:图满版 + 类型角标 + 悬停浮层(标题+价/Buy/解锁 或 💝react)+ 底部创作者(**真名 displayName**)+ 付费表情。作品挂商品时右上 🛍️ 徽章。
- tabs:全部/实物/视频/作品。
- **点进去 = 详情页**(`openDetail`)✅:大图/视频左;右栏=创作者(真名+粉丝)+ 标题 + 买/解锁 或 💝react + **付费表情条** + **作品挂的「买同款」转化卡** + **创作者社交平台跳转链接**(从 studio 填的公开@账号生成真实主页 URL:x.com/、tiktok.com/@、ig、抖音、小红书、github…)+「价值池 →」深链 + **评论区**(作品可评论);下方**相关作品**。
- 买流程:法币 modal(邮箱/姓名/国家[东南亚预设]/地址)→ Stripe 或 devMode。
- 付费表情:单触发器(心形+总数)+ 弹出选择器(👍$0.5/✌️$1/💪$2/❤️$5/🔥$10)。
- i18n:body en/zh(其余语言回退英文)。
- **⚠️ preview 注意**:ai.html 有 blur 图层,`preview_screenshot` 会 30s 超时,验证用 preview_eval 查 DOM。

### 2.2 创作者工作台(`web/studio.html`) ✅ 已完善
- **邮箱注册/登录/忘记密码**(`?reset=token` 重置流)✅。
- 资料编辑(displayName/bio)、绑 Phantom 钱包。
- **价值池 4 态**:无池→"发布自动开启" / 已开启 / **可激活(显示 $X held + 「激活上链 →」按钮,带 `?account=` 深链去 /launch flush escrow)** / 已上链(显示 floor SOL)。
- **上架商品**(实物/数字,含**真图片上传**)✅ → 自动建池。
- **「我的社交账号」绑定后台**(14 平台每行:平台名+状态[已连接/未连接]+**公开@账号输入框**+ 连接/解绑按钮)✅。连接=OAuth 授权(不存密码);@账号=粉丝跳主页用。
- **一键发布**到已连接平台。
- **⚠️ 真发帖需部署 AiToEarn**(见 §9)。现在点连接是 mock 演示。

### 2.3 品牌/供给侧(`web/brands.html`) ✅ 已完善
- 品牌/工厂/供应链**入驻**(名称/类型/联系[必填]/官网/简介)。
- 发布 offer(产品/代言/需求,产品带供货价)。
- 创作者**链接品牌** → 产品自动落店铺(cost=供货价,retail=2x)+ 自动建池。
- mode 切换(浏览机会 / 我是品牌)。

### 2.4 .ai 后端模块
- `src/commerce/source.js` — 商品目录 + 供应商履约(🟡 mock;真 1688/代发 API 未接,throw "not implemented")。
- `src/commerce/orders.js` — 订单状态机 + **75/20/5 分账 + 代理/推荐四方拆分**(见 §5)✅。
- `src/commerce/buyback.js` — 营收→地板回购(🟡 mock;`SOLANA_BUYBACK=1` 时真上链;占位币走 escrow)。
- `src/commerce/treasury.js` — SOL 浮动池会计(🟡 fiat→SOL 兑换是 out-of-band stub)。
- `src/commerce/payments.js` — Stripe 一次性支付 + 东南亚本地法(⏳ 需真 key + webhook)。
- `src/commerce/reactions.js` — 付费表情配置 + 计数 ✅。
- `src/commerce/agents.js` — 授权区域伙伴(国家→地方 2 层封顶)✅。
- `src/commerce/brands.js` — 品牌/供给侧 ✅。
- `src/accounts.js` — 邮箱账号(注册/登录/忘记密码/绑钱包/verifyActor/代理归属/60天推荐闸门)✅。
- `src/social.js` — 社交层(帖/关注/评论/赞/订阅/通知/创作者/feed/内容门槛/AI门禁)✅。
- `src/publish.js` — AiToEarn 14平台适配器(🟡 mock,⏳ 需部署引擎)。
- `src/ai.js` — Claude AI 分身/草稿(Anthropic SDK,🟡 需 ANTHROPIC_API_KEY + npm install)。
- `src/aigen.js` — corax AI 网关(🟡 mock,**按 user 指令暂停**,等 key/指令)。

---

## 3. oneIP.io(代币引擎 + 终端)—— 前端 + 后端

### 3.1 首页(`web/home.html`) ✅
Hero + Onee 吉祥物 + 「创业者发币流程」弹窗(透明展示 100% 分配/买卖资金流/赎回/创作者收入)+ 统一页头 + 7 语言下拉。

### 3.2 终端(`web/index.html`) ✅
3 面板:① oneIP 榜 ② 全网 SOL Meme 聚合(`src/sources/markets.js` = GeckoTerminal trending+new + DexScreener boosted + pump.fun,4 tabs 热门/新币/pump/涨幅,20s 刷新)③ 聪明钱/KOL。点币→本平台详情 modal(DexScreener 图表内嵌 + Jupiter 买入 + RugCheck 安全标)。i18n 7 语言干净。

### 3.3 发币页(`web/launch.html`) ✅ 前端完成
连 Phantom → 先 pin IPFS 拿 `ipfs://CID` → 再链上 `create_token`(付 0.1◎ + 明示费用 chip/note)→ 存 `/api/launch`。机制芯片(买80/20、卖2%税、随时赎回、无冻结无预挖、0.1◎发币费)。带 `?account=` 时激活迁移 flush escrow。返回按钮 ✅。**⏳ 真钱包 devnet 实测未跑;主网未上。**

### 3.4 币页(`web/coin.html`) ✅ 前端完成
币信息 + 20%地板标 + **交易面板(买/卖/赎回三件套)**(`web/chain.js` 浏览器 web3.js 客户端,字节级验证过 disc + account 顺序)+ 社区帖/评论。**⏳ 真 Phantom 签名未实测。**

### 3.5 链上程序(`onchain/programs/kolpad/src/lib.rs`)🟡
- **8 条指令**:initialize / create_token / buy / sell_market / redeem_floor / verify_token / graduate / top_up_floor。
- **已部署 devnet**:Program Id `5SVSaKceFdzdynnuGJDFy74tspXDDxJccWRXh6B1NUdG`。
- **已链上证明**:initialize / create_token / buy(20% 精确灌地板,publicly verifiable)✅。
- **参数**:总量 10 亿(INIT_TOKENS 1e9,6 decimals)、虚拟盘 2◎、毕业 85◎、发币费 0.1◎、交易费 1.25%(平台0.75/创业者0.5)、卖出税 2%、地板 20%。
- **未完成**:❌ 真钱包实测 sell/redeem;❌ Raydium 毕业迁移(现 stub);❌ Jupiter Verify;🟡 Flap 步④(毕业时 revoke mint + immutable metadata)代码+编译好**未部署**;❌ 主网;❌ 安全审计。
- **curve/ 纯数学**:`cargo test` 5/5(含 sell_tax_raises_floor)✅。

### 3.6 .io 后端模块
- `src/launchpad.js` — 发币记录 + Metaplex 元数据 JSON + 社交验证 + `chain` 字段(默认 "sol",留 BNB 口子)✅。
- `src/wallets.js` / `src/kol/*` / `src/sources/*` — KOL 追踪 + FIFO PnL + 市场数据(`npm run kol` LIVE Helius)✅。
- `src/security.js`(RugCheck)/ `src/verify.js`(签名背书)✅。
- `src/ipfs.js` — Pinata pin(⏳ 需 PINATA_JWT;sandbox 网络不通,user 环境可用)。
- `src/oauth.js` — 社交 OAuth 验证(🟡 mock,粉丝门槛 gate 未接真凭证)。
- `src/sync.js` — 入站社交镜像(🟡 mock)。
- `scripts/sol/*` — 已证的 web3.js Node 客户端(initialize/create/buy/buyback + lib)✅。

---

## 4. 平台运营后台(`web/admin.html`,token `Qwer1234@admin`)✅
- **9+ overview 卡**:accounts/products/orders/GMV/平台费池/平台净留存/代理分账/推荐分账/floor/reactions/brands/partners/launches。
- **订单表**(类型/创作者/金额/状态 + Ship/Deliver/Settle/Refund 按钮)。
- **Treasury**(浮动池余额 + funded/escrow/queued + top-up)。
- **Channel partners & payouts**:注册国家/地方代理 + 指派 creator→local + 代理列表 + payouts 台账(各代理/推荐欠款)✅。
- **Brands 表 / KOL 钱包 CRUD + discover / 发币认证**。
- **⚠️** 几个 Tabler 图标本环境不渲染(内部页,低优先);screenshot 本环境常超时,靠 DOM 验证。

---

## 5. 收益/经济模型定案(v1,已实现+测绿)✅

**原则:所有渠道分成从"平台那一池"里切,绝不叠加在其上、绝不从创业者或地板挖。**

**oneIP.ai(电商,底=成交净利=售价−供货−支付费):**
```
净利 100% = 创业者 75% + 持币人地板 20% + 平台费 5%
平台费 5% 再拆 → 平台基础 2.5% / 国家代理 0.5% / 地方代理 1.0% / 推荐1代 1.0%
(空缺方回落平台)
```

**oneIP.io(代币交易,底=每笔买/卖 1.25% 交易费):**
```
1.25% = 创业者 0.5%(链上直发) + 平台池 0.75%
平台池 0.75% 拆 → 平台 0.40% / 国家 0.05% / 地方 0.15% / 推荐 0.15%(链下 Helius 结算,❌未做)
另:买入 20% / 卖出 2% → 地板;发币费 0.1◎ → 平台
```

**护栏(反庞氏/证券):** 代理≤2层(国家→地方,硬编码不可递归)、推荐≤1代、法币发放不挂币价、只奖励真实成交。**推荐奖金不限期但被推荐人 60 天无成交→永久停(选项A)。合法措辞:授权区域伙伴/渠道服务佣金/老带新奖励/平台服务费。**

- 后端 `orders.js` 75/20/5 + 四方拆分 ✅、`agents.js` 2层 ✅、`accounts.js` 推荐/闸门 ✅、admin payouts ✅、smoke + HTTP 全绿。
- ⏳ 前端注册页 `?ref=` 捕获推荐人、.io 0.75% 链下 Helius 分账未做。

---

## 6. API 路由清单(server.js,~130 条)

**页面路由:** `/`(按 host 分流 .ai→ai.html / .io→home.html)、`/home` `/terminal` `/launch` `/admin` `/feed` `/coin` `/ai` `/shop` `/studio` `/brands`。
**静态:** `/wallet.js /i18n.js /chain.js /header.js /aiheader.js`、`/assets/*`、`/uploads/*`(图片上传)。

**社交:** `/api/feed` `/api/posts`(+delete) `/api/creator`(GET/POST) `/api/creator/launches` `/api/follow` `/api/unfollow` `/api/comments`(GET/POST) `/api/like` `/api/subscribe` `/api/unsubscribe` `/api/notifications`(+read)。
**AI:** `/api/ai/draft`(free,走 corax→Claude→mock) `/api/ai/generate`(corax mock) `/api/sync/now`。
**发布:** `/api/publish/connect`(+status) `/api/publish/accounts` `/api/publish/disconnect` `/api/publish/handle` `/api/publish/now` `/api/publish/status`。
**商城:** `/api/shop/products` `/api/shop/product`(GET/POST,含 creatorName)`/api/shop/product/active` `/api/shop/order`(GET/POST)`/api/shop/proof` `/api/shop/dev-paid` `/webhooks/shop` `/api/tip`。
**表情:** `/api/reactions/config` `/api/reactions` `/api/react`。
**账号:** `/api/account/register` `/login` `/forgot` `/reset` `/me` `/by-wallet` `/logout` `/bind-wallet`。
**品牌:** `/api/brands`(GET/POST) `/api/brand` `/api/offers` `/api/brand/offer`(+active) `/api/brand/links` `/api/brand/link`。
**上传:** `/api/upload`(base64→data/uploads,≤5MB,png/jpg/webp/gif)。
**Admin(x-admin-token):** `/api/admin/stats` `/overview` `/agents`(+active/assign) `/payouts` `/wallets`(+add/remove) `/discover` `/launches`(+verify) `/creator/pro` `/shop/orders` `/shop/ship` `/deliver` `/refund` `/settle` `/treasury`(+topup)。
**链上/终端:** `/api/trending` `/api/markets`(+new/pump/oneip) `/api/kol/*` `/api/token/security` `/api/board` `/api/launch`(GET/POST) `/api/coin/metadata` `/api/coin/pin` `/api/coin/finalize` `/api/auth/start` `/api/launch/bind` `/webhooks/helius`。

---

## 7. 完善度总结（按块）

| 模块 | 状态 | 说明 |
|---|---|---|
| .ai 瀑布流首页 + 详情页 | ✅ | Pinterest 风格,商品+作品混排,悬停/详情/表情/评论/社交跳转全过 |
| .ai 创作者工作台 studio | ✅ | 注册/登录/忘密/资料/上架/图片上传/价值池/社交账号后台 |
| .ai 品牌供给侧 brands | ✅ | 入驻/offer/链接品牌落店铺 |
| 邮箱账号系统 | ✅ | 注册/登录/忘密/绑钱包/handle↔wallet |
| 收益分账(75/20/5+四方) | ✅ | 后端+admin+测试全绿;前端 ?ref 捕获 🟡 |
| 付费表情/打赏 | ✅ | 5 表情+5% 平台费;Stripe 上线后计数挪 webhook 🟡 |
| 内容门槛(防刷) | ✅ | ≥20字+附件才发+发币;video/file 字段 |
| 平台运营后台 admin | ✅ | overview/订单/treasury/代理payouts/品牌/钱包/发币认证 |
| .io 首页/终端/币页/发币页 | ✅ 前端 | UI 全在;链上真钱包实测 ⏳ |
| 链上 kolpad | 🟡 | devnet 部署+create/buy 已证;sell/redeem/毕业真测 ❌;主网/审计 ❌ |
| 浏览器 web3 客户端(create/buy/sell/redeem) | 🟡 | 字节级验证过;真 Phantom 签名 ⏳ |
| 图片上传 | ✅ | base64→本地存储;可选走 IPFS 🟡 |
| BNB 链留口子 | ✅ | coin.chain 字段;真适配器未做(floorpad 是 EVM 起点) |

---

## 8. 未完成 / 待办清单（按类）

### 🟢 纯代码可做(不花钱)
- [ ] home/.ai body 全 7 语言(现 en/zh)。
- [ ] .io feed 帖挂付费表情(现仅 .ai)。
- [ ] 退款窗口到期自动 settle 的 scheduler。
- [ ] .io 交易费 0.75% 四方分账走链下 Helius 索引。
- [ ] 注册页 `?ref=` 捕获推荐人。
- [ ] brand/link 路由加鉴权;邮箱验证邮件(注册确认)。
- [ ] feed 钱包写(createPost)鉴权;feed 正文多语言。
- [ ] Pro 门禁统一(见 §11 决策)。

### 🟡 需凭证/部署(等你)
- [ ] **Stripe 真上线**(key + webhook;表情/打赏计数挪 webhook)。
- [ ] **IPFS pin 线上验证**(PINATA_JWT 在 .env,user 环境可用)。
- [ ] **AiToEarn 部署到 VPS**(见 DEPLOY-aitoearn.md)→ 一键发布真生效。
- [ ] 社交 OAuth 真凭证(粉丝验证门槛)。
- [ ] 真实货源/代发 adapter(1688/SaaS)。
- [ ] fiat→SOL 真兑换管道(回补浮动池)。
- [ ] corax AI 网关接 UI + 真 CORAX_API_KEY(**按 user 指令暂停中**)。

### 🟠 链上 devnet→主网
- [ ] **真 Phantom devnet 实测**买/卖/赎回/发币(唯一没 headless 验的环)。
- [ ] Raydium 毕业真 CPI + Jupiter Verify。
- [ ] Flap 步④部署(revoke mint + immutable metadata,已编译未部署)。
- [ ] escrow flush 真模式(现 mock re-key)。
- [ ] 主网部署 + **安全审计**(动真钱前必须)。

---

## 9. 部署现状

- **线上:** https://oneip.io(Render free tier,service `oneip-cegu.onrender.com`,Blueprint `render.yaml`,build `npm install --omit=dev --omit=optional`,start `node src/server.js`,`0.0.0.0`)。GitHub **Bossses001/oneIP.io**(PRIVATE)。根路径按 host 分流 .ai/.io。DNS:GoDaddy A `@`→216.24.57.1、CNAME `www`→oneip-cegu.onrender.com。
- **两域名:** oneip.io + oneip.ai 都指同一 Render service(代码按 host 分流)。⏳ oneip.ai 域名/绑卡待用户。
- **AiToEarn:** 已克隆 `C:\Users\user\AiToEarn`,本地 Docker 栈跑过;⏳ **待公网部署**(方案见 `DEPLOY-aitoearn.md`:VPS + 子域名 publish.oneip.io + Caddy HTTPS + 填 AITOEARN_API_KEY/BASE_URL[带 /api])。
- **env:** 见 `.env.example`(ADMIN_TOKEN、STRIPE_*、PINATA_JWT、HELIUS_API_KEY、AITOEARN_*、CORAX_*、ANTHROPIC_API_KEY、SOLANA_BUYBACK 等)。

---

## 10. 文件地图

**前端(web/):** home.html(.io首页) index.html(终端) launch.html(发币) coin.html(币页) admin.html(运营后台) ai.html(.ai商城首页) studio.html(创作者工作台) brands.html(品牌供给侧) feed.html(社交feed) · 共享 header.js(.io页头)/aiheader.js(.ai页头)/i18n.js/wallet.js/chain.js(浏览器发币/交易客户端)。
**后端(src/):** server.js(主服务器+路由) accounts.js social.js launchpad.js publish.js ai.js aigen.js ipfs.js oauth.js sync.js security.js verify.js wallets.js billing.js · commerce/(orders source buyback treasury payments reactions agents brands) · sources/(markets dexscreener gmgn birdeye rugcheck helius) · kol/(pnl track)。
**链上:** onchain/programs/kolpad/src/lib.rs(8指令) + onchain/curve/(纯数学)。
**脚本:** scripts/commerce-smoke.js launch-smoke.js smoke.js · scripts/sol/(01-initialize 02-create-token 03-buy buyback lib)。
**数据:** data/*.json(20 个运行时文件,含 demo/测试数据,可清)。
**文档:** README.md DEPLOY.md DEPLOY-aitoearn.md docs/(DATA.md GO-LIVE.md 融资 deck)。

---

## 11. ⚠️ 换机接手必读

1. **未提交的工作**:本 zip 打包的是**工作区快照**(含大量未提交改动:Pinterest 改版、图片上传、社交账号后台、内容门槛、收益分账、accounts/agents/aigen 等)。**换机后建议先 `git init`/接上远端并提交,别再只靠 git clone**(远端 main = fd2aa80,不含这些)。工作流约定:平时在 `dev` 分支改,稳了合 `main`(合进 main 才自动上 Render)。
2. **多会话**:此仓库有多个 Claude 窗口/会话并行过。git 归属方那个 session 拥有 main/deploy,其它顾问性。换机后单机开发就没这问题了。
3. **🔴 一个未决策:Pro 到底砍没砍?** 早期交接说"已砍 $10/$39 Pro,创作者工具免费",据此改了 `/api/ai/draft`(去 Pro 门禁);但 `/api/publish/*` 路由**仍挂 `hasPublish`($39)门禁**没拆,且另一会话把 Pro 当在用。**发布 UI 有两套**:feed.html(老,Pro门禁)vs studio.html(新,免费账号后台)。**接手第一件事:定 Pro 保留 or 砍掉,然后统一发布门禁 + 二选一发布 UI。**
4. **preview 工具**:本环境预览面板不稳(导航抽风、ai.html 截图超时),用 preview_eval 查 DOM 验证;`npm run serve` 手动跑完全正常。
5. **preview 启动**:`.claude/launch.json` 配置名 `oneip`(`npm --prefix ... run serve`,port 8787)。ADMIN_TOKEN=Qwer1234@admin(经 .env)。
6. **data/ 里有测试数据**:@t.co 账号、AATEST 发币夹具、demo 商品/帖等,可按需清(scratchpad 有 clean.cjs 思路:按 email 后缀 @t.co 精确删本机测试账号)。

---

*文档完 — 详细逐功能实现细节/坑/验证结果见记忆文件 `kol-meme-project.md`(如随附)。*
