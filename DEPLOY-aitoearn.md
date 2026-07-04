# 部署 AiToEarn 发布引擎(让 oneip.io 线上能真实发帖)

oneIP 本体在 Render(轻量、零依赖)。**AiToEarn 不能放在 Render**——它是 NestJS + MongoDB + Redis + RustFS 的重型栈,Render free plan 扛不住,而且这些数据库不该跟 web 进程挤在一起。它需要**一台独立的 VPS**,跑 `docker compose`,然后给 oneIP 一个公网地址。

```
创币者  ──▶  oneip.io (Render, 轻量)  ──x-api-key──▶  publish.aitoearn 你自己的 VPS (Docker 全栈)
                                                              │
                                                              ▼
                                                Twitter / TikTok / YouTube ... 14 平台
```

oneIP 通过两个环境变量找到它:`AITOEARN_BASE_URL`(公网地址)+ `AITOEARN_API_KEY`。没配 → `src/publish.js` 自动走 mock,不报错。

---

## 1. 选 VPS

AiToEarn 文档要求 **4GB+ 内存、20GB+ 磁盘**。实际跑 7 个容器(nginx/web/server/ai/mongo/redis/rustfs),建议:

| 档位 | 配置 | 月费(约) | 适合 |
|---|---|---|---|
| 起步 | 4GB RAM / 2 vCPU / 80GB | $20–24 | MVP、少量创币者 |
| 推荐 | 8GB RAM / 4 vCPU / 160GB | $40–48 | 正式上线 |

可选服务商:Hetzner(最便宜,欧/美机房)、DigitalOcean、Vultr、Linode、AWS Lightsail。东南亚用户为主可选**新加坡机房**(DO/Vultr/Linode 都有 SG)。

> 别用 Render/Vercel/Netlify 这类 serverless/PaaS 跑 AiToEarn——它要常驻多容器 + 持久化卷,PaaS 不合适。

---

## 2. 在 VPS 上部署

```bash
# 1. 装 Docker(Ubuntu 22.04/24.04)
curl -fsSL https://get.docker.com | sh

# 2. 拉代码
git clone https://github.com/yikart/AiToEarn.git && cd AiToEarn

# 3. 改默认密码(重要!compose 里 mongo/rustfs 默认密码是 password/rustfsadmin)
#    编辑 docker-compose.yml,改 MONGO_INITDB_ROOT_PASSWORD / RUSTFS_*_KEY / JWT_SECRET

# 4. 起服务
docker compose up -d
docker compose ps   # 等全部 healthy
```

首次启动会自动建管理员并登录,本机 `http://<VPS_IP>:8080` 可访问。

---

## 3. 加域名 + HTTPS(拿到公网 AITOEARN_BASE_URL)

给它一个子域名,例如 `publish.oneip.io`(DNS A 记录指向 VPS IP)。**不要直接用 `http://IP:8080`**——明文 + API Key 在公网裸奔很危险。

最省事:在 AiToEarn 的 nginx 前面再套一层带证书的反代,或用 Caddy(自动 HTTPS):

```bash
# /etc/caddy/Caddyfile
publish.oneip.io {
    reverse_proxy localhost:8080
}
```

完成后:
- 公网入口:`https://publish.oneip.io`
- **oneIP 要填的 `AITOEARN_BASE_URL` = `https://publish.oneip.io/api`**(注意带 `/api`,因为 v2 路由是 `…/api/v2/...`)

---

## 4. 安全加固(务必做)

API Key 在公网传,且这台机器握着所有创币者的社交 token,是高价值目标:

- **只对外开放 443**(Caddy/nginx)。MongoDB(27017)、Redis、RustFS(9000/9001)**全部不要映射到公网** —— 我们本地已删了 redis 的 host 端口,VPS 上同理把 mongo/rustfs 的 `ports:` 也去掉,只走 Docker 内网。
- 开防火墙(`ufw allow 22,443/tcp` + `ufw enable`),22 端口建议改密钥登录。
- AiToEarn 后台 API Key 视作密钥级别,只存在 Render 的 secret 环境变量里(`sync: false`),**绝不进 git**。
- 定期 `docker compose pull && up -d` 更新镜像。

---

## 5. 接到 oneIP(Render)

`render.yaml` 里已经预留了这两个变量(`sync: false`,即需要你在 Render 面板手填):

```yaml
- key: AITOEARN_API_KEY   # AiToEarn 后台 设置→API Key 生成的那个
- key: AITOEARN_BASE_URL  # https://publish.oneip.io/api
```

在 Render → 你的 oneip 服务 → Environment 里填入这两个值 → 保存触发重新部署。部署后 `src/publish.js` 的 `isLive()` 变 true,线上发布从 mock 切到真实。

验证:用一个 $39 Pro+ 账号,在 feed 里连一个平台、发一条勾选"同步发布"的帖,看 `/api/publish/status` 返回真实 flowId。

---

## 6. 白标:让授权页显示 oneIP 而不是 AiToEarn

体验阶段可先用官方 **Relay**(aitoearn.ai 建 API Key → AiToEarn 配置管理填入),一个 Key 通全部平台,但 OAuth 同意页会短暂显示 "AiToEarn"。

正式上线前,逐个平台换成**你自己的开发者 app**(填 oneIP 名称 + logo),把 `clientId/clientSecret/redirectUri/logoUrl` 填进 AiToEarn 的 `config.yaml` 对应平台配置。这样同意页显示 "oneIP",彻底白标,也不再依赖第三方。**第一个先做 Twitter/X。**

> redirectUri 要填 oneIP 的回调:`https://oneip.io/feed?connected=twitter`(`src/publish.js` 里 `connectStart` 用的就是这个)。

---

## 成本小结

| 项 | 月费 |
|---|---|
| oneIP (Render) | $0(free)→ 按量 |
| AiToEarn VPS | $20–48 |
| 域名/HTTPS | 域名年费,证书免费(Caddy) |
| Relay(可选,测试期) | 看 aitoearn.ai 定价 |

MVP 阶段:一台 $24 的 VPS + 一个子域名即可让 oneip.io 线上真实发帖。
