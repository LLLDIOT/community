# 部署指南

三种运行方式，按场景选择：

## 0. 当前部署状态（本机 Windows）

- 已注册开机自启计划任务（登录 Windows 自动运行）：
  - `Community-Server` —— 后端 node 服务（:3000）
  - `Community-Cpolar` —— cpolar 公网隧道
- 注册命令见 `scripts/install-services.ps1`（node 部分）；
  cpolar 隧道配置位于 `~/.cpolar/cpolar.yml`（community → :3000）。
- 公网访问受 **HTTP Basic Auth** 保护，凭据在 `server/.env`
  （`BASIC_AUTH_USER` / `BASIC_AUTH_PASS`），该文件不入库。
- 免费版 cpolar 公网域名是**随机的**，重启隧道后变化；
  查看当前地址：`Get-Content "$env:USERPROFILE\.cpolar\run.log*" | Select-String "established"`
  固定域名需在 cpolar 控制台购买保留域名。

## 1. 本地开发（前后端分离，热更新）

```bash
# 终端 A：后端
cd server
npm install
npm run dev            # http://localhost:3000（自动执行数据库迁移）

# 终端 B：前端
cd web
npm install
npm run dev            # http://localhost:5173（vite 代理 /api → 3000）
```

## 2. 本地生产模式（单端口，需先构建前端）

```bash
cd web && npm install && npm run build   # 产出 web/dist
cd ../server && npm install
node src/index.js                        # http://localhost:3000
```

> server 检测到 `web/dist/index.html` 存在时自动托管前端（SPA fallback），
> 单端口同时提供页面与 `/api/v1` 接口，无需额外配置。

## 3. Docker 部署（推荐生产）

```bash
docker compose up -d --build
# 访问 http://<服务器IP>:3000
```

- 多阶段构建：镜像内含已构建前端 + Node 后端，无多余依赖。
- 数据持久化：`server/data/`（SQLite 库）与 `server/uploads/`（简历附件）
  以 volume 挂载，重建容器不丢数据。
- 环境变量：`PORT`（默认 3000）。

## 数据备份

SQLite 单文件，备份即复制：

```bash
cp server/data/club.db backups/club-$(date +%F).db
# 附件目录一并备份
cp -r server/uploads backups/
```

## 上线前检查清单（重要）

| 项目 | 说明 | 状态 |
|---|---|---|
| 认证 | 当前**无登录保护**（开放模式，M5 暂缓） | ⚠️ 需先完成 M5 再对外 |
| HTTPS | 生产建议置于反向代理（nginx/caddy）后启用 TLS | 待做 |
| 数据库迁移 | 启动自动执行 `db/migrations/*.sql`，幂等 | ✅ |
| 备份 | 建议 cron 每日备份 club.db 与 uploads | 待做 |
| 附件域名 | 简历下载链接为相对路径 `/uploads/...`，随部署域名自动生效 | ✅ |

## 目录说明（容器内）

```
/app/server         后端（node src/index.js）
/app/web/dist       前端构建产物（由后端托管）
/app/server/data    运行时 SQLite 数据库
/app/server/uploads 简历附件
```
