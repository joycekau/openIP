# oneIP.io — Go-Live 上线清单

软件都写好了,每个功能都能 **mock 模式** 跑;下面每填一个 key,就把对应功能从 mock 切成真实。
顺序按"最容易 → 最难"排。**key 一律填进 `.env`(不是 `.env.example`),`.env` 不会上传 GitHub。**

拿到任意一个 key 发给我(或自己填),我帮你接好 + 验证。

---

## ① Pinata(IPFS)— 免费,~5 分钟  ⭐ 最简单

**解锁**:发币时 logo + 元数据 JSON 钉到 IPFS,拿到永久 URI → 所有钱包/浏览器显示一致。

1. 注册 https://pinata.cloud(免费档够用)
2. 左侧 **API Keys** → **New Key** → 勾 Admin → 创建
3. 复制弹出的 **JWT**(很长那串)
4. 填进 `.env`:
   ```
   PINATA_JWT=粘贴你的JWT
   IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
   ```
**验证**:发币页创建一个币 → 显示 “pinned to IPFS” + 一个 `ipfs://…` 地址。

---

## ② Anthropic API key — 需充值 ~$5,~5 分钟  ⭐ SDK 已装好

**解锁**:AI 分身用真模型回复粉丝 + AI 帮你起草帖子(现在是占位文案)。

1. 注册 https://console.anthropic.com
2. **Billing** → 充值最低额度(~$5,按用量扣,很便宜)
3. **API Keys** → **Create Key** → 复制 `sk-ant-…`
4. 填进 `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-粘贴你的key
   ```
   (可选 `AI_MODEL=claude-haiku-4-5` 用更便宜的模型跑高频回复)
**验证**:Creator Studio 点 “✨ AI draft” → 出来的是真内容(不再是 “…big things coming”)。

---

## ③ Stripe(订阅收费)— 免费,~15 分钟

**解锁**:Pro $10/月、Pro+ $39/月 真实订阅扣费(现在是本地 dev 秒升)。

1. 注册 https://dashboard.stripe.com
2. **Product catalog** → 建两个产品,各加一个 **recurring(每月)价格**:
   - Pro:$10/月 → 复制它的 **Price ID**(`price_…`)
   - Pro+:$39/月 → 复制它的 **Price ID**
3. **Developers → API keys** → 复制 **Secret key**(`sk_live_…` 或测试 `sk_test_…`)
4. **Developers → Webhooks** → Add endpoint → URL 填 `https://你的域名/webhooks/stripe` → 复制 **Signing secret**(`whsec_…`)
5. 填进 `.env`:
   ```
   STRIPE_SECRET_KEY=sk_...
   STRIPE_PRICE_ID=price_...(10刀那个)
   STRIPE_PRICE_ID_PUBLISH=price_...(39刀那个)
   STRIPE_WEBHOOK_SECRET=whsec_...
   PUBLIC_URL=https://你的域名
   ```
**验证**:Creator Studio 点 Upgrade → 跳转到真实 Stripe 收银台。

---

## ④ AiToEarn + X 开发者 app(多平台真发布)— 较复杂,X 审核可能要几天

**解锁**:一键真发布到 Twitter/TikTok/YouTube/Instagram…(现在是 mock)。

1. **X 开发者 app**:https://developer.x.com → 申请 → 建 app(名字/logo 填 oneIP)→ 拿 OAuth 凭据
   (其它平台同理:TikTok / YouTube / Instagram 各自的开发者后台)
2. **部署 AiToEarn 引擎**(它是独立服务):把上面各平台的凭据填进它的 `config.yaml`
3. 填进 `.env`:
   ```
   AITOEARN_API_KEY=AiToEarn给的master key
   AITOEARN_BASE_URL=https://你的AiToEarn地址/api
   ```
**验证**:Studio 点 “+ Twitter” → 跳到真实 X 授权页;发帖勾群发 → 真的发出去。

> 这步最重，可以最后做;前面 ①②③ 不依赖它。

---

## ⑤ 部署 kolpad 上链(让币变真)— 最重要也最技术

**解锁**:真正铸造 SPL 代币 + 20% 底池 + 2% 卖出税 + 赎回(现在 `/launch` 是链下占位演示)。

需要 Windows 装 **WSL2**,然后在 Linux 里:
```bash
# 1. 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"          # solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# 2. 先白嫖验证数学(不用上链)
cargo test -p kolpad-curve

# 3. 建钱包 + 领测试币 + 部署到 devnet
solana-keygen new
solana airdrop 2 --url devnet
cd onchain && anchor build && anchor deploy --provider.cluster devnet
```
拿到 **program ID** 后,把发币流程从链下占位切到真实合约(这步我帮你改前后端)。

> 这是真产品的核心。建议我们抽一整段时间一起做,我全程带你过。

---

## 推荐顺序

**①②(10 分钟,立刻有真东西)→ ③(收费)→ ⑤(上链,核心)→ ④(多平台,最后)**

拿到哪个 key 就发我哪个,我接好并当场验证给你看。
