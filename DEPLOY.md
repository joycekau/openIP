# 把 oneIP.io 上线到域名（新手版）

域名 = 门牌号；要先有一台公网服务器（房子），再把域名指过去。两步。

## 阶段 1：把 app 部署到服务器（用 Render，免费）

### 1a. 把代码传到 GitHub
```bash
cd C:\Users\user\kol-meme
git init
git add .
git commit -m "oneIP.io"
```
然后去 https://github.com/new 建一个仓库（比如叫 `oneip`），按页面提示：
```bash
git remote add origin https://github.com/你的用户名/oneip.git
git branch -M main
git push -u origin main
```
> `.env` 不会被上传（在 .gitignore 里），key 不会泄露。✓

### 1b. 在 Render 部署
1. 注册 https://render.com（用 GitHub 登录）
2. New → **Web Service** → 选你刚推的 `oneip` 仓库
3. 设置（一般会自动识别）：
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. **Environment（环境变量）** 里填上你的 key（不是放 .env，是放这里）：
   - `HELIUS_API_KEY` = 你的 Helius key
   - 其它（GMGN / OAuth）有就填，没有留空
5. Create Web Service → 等几分钟 → 得到一个网址，像 `https://oneip.onrender.com`
6. 打开那个网址，能看到 oneIP.io 界面 = 部署成功 ✓

> 免费档闲置会休眠，首次访问慢 ~30 秒。以后想常驻升 $7/月即可。

## 阶段 2：把 oneip.io 指过去

### 2a. 在 Render 加自定义域名
1. 你的服务 → Settings → **Custom Domains** → Add
2. 加两个：`oneip.io` 和 `www.oneip.io`
3. Render 会给你一组 **DNS 记录**（记下来）：
   - 顶级域 `oneip.io` → 一条 **A 记录**（指向 Render 的 IP）或 **ALIAS/ANAME**
   - `www` → 一条 **CNAME** 指向 `oneip.onrender.com`

### 2b. 在你买域名的网站（注册商）填 DNS
1. 登录你买 oneip.io 的那个网站 → 找 **DNS** / **DNS 管理** / **Set Up**
2. 把 Render 给的记录照填：
   | 类型 | 名称(Host) | 值(Value) |
   |---|---|---|
   | A 或 ALIAS | `@`（代表 oneip.io 本身） | Render 给的 IP / 地址 |
   | CNAME | `www` | `oneip.onrender.com` |
3. 保存。等 10 分钟~1 小时生效（DNS 传播）

### 2c. HTTPS
Render 检测到 DNS 生效后，**自动**签发免费 HTTPS 证书。之后 `https://oneip.io` 直接能开。✓

## 上线后

- Helius 实时推送：注册 webhook 指向你的公网地址
  ```bash
  npm run helius:webhook -- https://oneip.io/webhooks/helius
  ```
- 改了代码想更新：`git push`，Render 自动重新部署。

## 注意
- 当前 API / webhook 没有鉴权，是 demo 状态。正式运营前要加访问控制。
- `data/kol-wallets.json` 仍是占位钱包，换成真实地址才有真 KOL 数据。
