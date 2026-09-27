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
  用 `BASIC_AUTH_DISABLE=1` 可关闭密码（仅建议本机使用）。
- 免费版 cpolar 公网域名是**随机的**，重启隧道后变化；
  查看当前地址：`Get-Content "$env:USERPROFILE\.cpolar\run.log*" | Select-String "established"`
  固定域名需在 cpolar 控制台购买保留域名。

### 访问入口一览（本机部署）

| 入口 | 地址 | 说明 |
|---|---|---|
| 管理端（PC） | `http://localhost:3000` | 默认进「招新广场」；另有面试与录用 / 数据看板 / 社团管理 / 简历库 / 智能匹配 |
| **招新广场** | `http://localhost:3000/square` | 双面板：左侧全校社团总览（可查看任意社团的招新情况与投递人数），右侧本社团管理面板 |
| **面试与录用工作台** | `http://localhost:3000/interview` | 标注录用 / 候补 1 号·2 号 / 调剂 / 淘汰，并做候补递补招满员（需登录社团账号） |
| 学生投递端（手机风格） | `http://localhost:3000/portal.html` | 学生选社团岗位、按模板填简历、真实投递；管理端侧边栏底部也有入口 |
| 健康检查 | `http://localhost:3000/healthz` | 免认证，用于探活 |
| 开发模式前端 | `http://localhost:5173` | 仅开发用（`npm run dev`），已代理 `/api` 到 3000 |

> **登录说明**：现在有两层保护，职责不同。
> - **社团账号（本系统内的"每个人"）**：首次启动会给还没有账号的社团自动创建一个社长账号，
>   账密写在 `server/data/initial-accounts.txt`（该目录已 gitignore，不会进仓库）。
>   登录后可在「招新广场 → 我的社团 → 账号与权限」里新建面试官 / 观察员账号。
>   角色决定能做什么：社长（全部）、面试官（可决策与评分）、观察员（只读）。
> - **HTTP Basic Auth（全站一把密码）**：由 `server/.env` 的 `BASIC_AUTH_*` 控制，
>   当前本机部署设了 `BASIC_AUTH_DISABLE=1` 关闭。**公网部署前请务必开启**。
>
> 注意：修改简历状态、评分备注、归档、删除等写操作现在都要求登录社团账号且只能操作本社团的投递；
> 学生端的投递入口（建简历 / 投递）保持开放，否则学生无法自助投递。

> 学生端是 `web/public/` 下的免构建页面，`npm run build` 时原样复制到 `web/dist/`，
> 因此生产模式下由后端单端口一起托管，无需额外配置。
> 数据库文件 `server/data/club.db`（含学生投递的简历），备份即完整备份业务数据。

### 部署拓扑

```mermaid
flowchart TB
    subgraph PC["本机（Windows）"]
        subgraph TASKS["Windows 计划任务（登录自启）"]
            T1["Community-Server<br/>node src/index.js"]
            T2["Community-Cpolar<br/>cpolar start community（带代理）"]
        end
        N["node 进程<br/>监听 :3000"]
        DBF[("server/data/club.db<br/>WAL")]
        UP[("server/uploads/<br/>简历附件")]
        DIST["web/dist/<br/>前端构建产物"]

        T1 --> N
        N --> DBF
        N --> UP
        N -->|"express.static + SPA fallback"| DIST
    end

    B1["🧑‍💼 管理端浏览器<br/>localhost:3000"]
    B2["👨‍🎓 学生端<br/>localhost:3000/portal.html"]

    B1 --> N
    B2 --> N
    T2 -.->|"可选：公网隧道"| NET["☁️ cpolar 云端<br/>https://xxx.cpolar.cn"]
    NET -.->|"转发"| N
```

**要点**：只有一个 node 进程对外服务（:3000），前端页面由它一并托管；
计划任务保证登录即自启；数据落在 `data/` 与 `uploads/`，两个目录即完整备份。

### 两种运行模式对照

```mermaid
flowchart LR
    subgraph DEV["开发模式（改代码时）"]
        V["Vite :5173<br/>热更新"] -->|"代理 /api /uploads"| BE1["后端 :3000"]
    end
    subgraph PROD["生产模式（日常使用）"]
        BE2["后端 :3000<br/>同时托管 web/dist"] --> U["浏览器访问 :3000"]
    end
```

| | 开发模式 | 生产模式 |
|---|---|---|
| 启动 | `cd server && npm run dev` + `cd web && npm run dev` | `node src/index.js`（计划任务自动） |
| 访问 | `http://localhost:5173` | `http://localhost:3000` |
| 改前端代码后 | 浏览器自动刷新 | **必须 `npm run build`** 重新构建 |
| 用途 | 写代码、调界面 | 给真实用户使用 |

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
| 社团账号与角色 | 已有社长 / 面试官 / 观察员三角色；投递的写操作（状态、评分、归档、删除）要求登录且限本社团 | ✅ |
| 全站访问密码 | HTTP Basic Auth，由 `server/.env` 的 `BASIC_AUTH_*` 控制；**本机当前设了 `BASIC_AUTH_DISABLE=1` 关闭** | ⚠️ 公网部署前必须开启 |
| 学生端防冒名 | 建简历与投递接口保持开放（否则学生无法自助投递），无法阻止冒名投递 | ⚠️ 需接校园统一认证 |
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
