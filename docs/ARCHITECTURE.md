# 社团招新系统 · 架构设计

> 版本：v0.3　|　仓库：LLLDIOT/community　|　协议：MIT
> 更新记录：v0.1 基础系统（M0-M6）；v0.2 智能匹配 + 数据看板；v0.3 学生投递端整合

## 1. 系统定位

面向高校社团的招新管理平台，**两端一后端**。核心解决四个问题：

1. **社团自我展示**：社团名称、规模、说明、招新需求、招新人数等信息的在线化维护。
2. **简历归档分类**：把学生投递的简历沉淀成"简历库"，支持**按招新需求分类**与**按简历类型分类**，便于筛选、流转与复盘。
3. **智能匹配**：简历技能标签 ↔ 岗位期望技能自动算匹配度，推荐岗位、发现误投。
4. **数据洞察**：招新漏斗、岗位进度、类型分布、投递趋势的可视化看板。

## 2. 角色与使用方式

| 角色 | 入口 | 能力范围 |
|---|---|---|
| 学生 | `/portal.html`（手机风格 H5） | 浏览社团、选择岗位、按模板填写简历、真实投递、查看投递进度 |
| 社团管理员 | `/`（管理端 SPA） | 维护社团资料、招新批次与岗位；简历库归档/筛选/状态流转/评分/导出；智能匹配；数据看板 |
| 访客 | 同管理端（当前开放模式） | 只读浏览 |

> **认证现状**：当前为"开放模式"（可选 HTTP Basic Auth 单密码保护，通过 `server/.env` 开关）。
> 多角色登录（学生学号验证、`club_admin` 与社团绑定）尚未实现，见第 8 节 M5。

## 3. 领域模型（概念层）

```
Club 社团
 └── Recruitment 招新批次 (每学期/每轮招新 = 一个批次)
      └── Position 招新岗位需求 (title / requirement / headcount / required_skills)
           └── Application 投递记录 (status 状态机 / type_tag / score / archived)
                └── Resume 简历 (学生信息 + skills 技能标签 + 附件文件)

Tag 标签（多对多，预留：用于自由打标）
```

**按需求分类**：`Position` 天然形成树 `社团 → 批次 → 岗位 → 投递/简历`。
**按类型分类**：`Application.type_tag` 枚举（技术/组织/文艺/体育/学术/公益/其他）交叉筛选。
**智能匹配**：`Resume.skills` ↔ `Position.required_skills` 标签集合求交。

## 4. 系统架构

```
   ┌────────────────────────┐        ┌─────────────────────────────┐
   │  学生端 H5 (手机风格)    │        │  管理端 SPA (PC)             │
   │  web/public/portal.html │        │  web/src/（Vue3 + Element +  │
   │  + portal-adapter.js    │        │  ECharts）                   │
   │    （适配层）            │        │                             │
   └───────────┬────────────┘        └──────────────┬──────────────┘
               │ fetch /api/v1                      │ axios /api/v1
               └────────────────┬───────────────────┘
                                ▼
              ┌─────────────────────────────────────┐
              │  Express API (server/, :3000)        │
              │  ┌───────────────────────────────┐   │
              │  │ middlewares: basicAuth /      │   │
              │  │              upload(multer)   │   │
              │  ├───────────────────────────────┤   │
              │  │ routes/  薄层：取参→调服务→响应 │   │
              │  ├───────────────────────────────┤   │
              │  │ services/ 业务规则 + SQL       │   │
              │  │  club / recruitment / position │   │
              │  │  resume / application(状态机)  │   │
              │  │  match(匹配引擎) / dashboard   │   │
              │  └───────────────────────────────┘   │
              │  生产模式：托管 web/dist（SPA fallback）│
              └──────────────┬──────────────────────┘
                             │ better-sqlite3（同步 API）
              ┌──────────────▼──────────────────────┐
              │  SQLite (server/data/club.db, WAL)   │
              │  + server/uploads/（简历附件）        │
              └─────────────────────────────────────┘
```

- 单仓库（monorepo-lite）：`server/` + `web/` 两个独立包，共享 `docs/` 与根 README。
- **单端口部署**：后端检测到 `web/dist` 存在即托管前端，页面 + API + 附件同源，无需 CORS。
- 开发期 `npm run dev` 由 Vite（:5173）代理 `/api` 与 `/uploads` 到 :3000。
- 学生端为**免构建的原生 HTML/JS**（放 `web/public/`，构建时原样复制到 `dist/`）。

## 5. 后端分层

```
server/src/
├─ index.js                    # 入口：loadEnv → migrate → listen
├─ app.js                      # Express 装配（json/basicAuth/静态/路由/托管/错误）
├─ db/
│  ├─ connection.js            # SQLite 单例（WAL、外键）+ 迁移器（user_version）
│  └─ ../db/migrations/        # 001-init / 002-add-was-admitted / 003-add-skill-tags
├─ routes/                     # 7 个路由文件（薄层，3 行/路由）
│  clubRoutes / recruitmentRoutes / positionRoutes / resumeRoutes
│  applicationRoutes / matchRoutes / dashboardRoutes
├─ services/                   # 业务核心
│  clubService(121) recruitmentService(100) positionService(82)
│  resumeService(58) applicationService(301, 状态机) 
│  matchService(155, 匹配引擎) dashboardService(131, 统计聚合)
├─ middlewares/
│  ├─ basicAuth.js             # HTTP Basic Auth（可 env 开关）
│  └─ upload.js                # multer：白名单 + 10MB 限制
└─ utils/
   ├─ id.js                    # genId(前缀+随机) / nowIso
   ├─ respond.js               # ok() 统一响应 + parsePage 分页归一化
   ├─ errors.js                # BizError + notFound/badRequest/forbidden
   └─ env.js                   # 极简 .env 加载器（不依赖 dotenv）
```

**分层纪律**：routes 不写 SQL，services 不写 `res.send`，db 只被 service 引用。

## 6. API 约定

- Base URL：`/api/v1`
- 认证：HTTP Basic Auth（可选，`BASIC_AUTH_DISABLE=1` 关闭）；`/healthz` 免认证
- 响应统一：成功 `{ code: 0, data }`；失败 `{ code, message }`（HTTP 状态码同时表达语义）
- 分页：`?page=1&pageSize=20` → `{ list, total, page, pageSize }`
- 字典：`GET /dict` 返回类型标签、状态文案、**状态流转白名单**（前端复用后端规则）
- 学生端不新增后端接口，**复用** `/clubs`、`/clubs/:id`、`/resumes`、`/positions/:id/applications`、`/applications/:id`

详见 [API.md](API.md)。

## 7. 核心机制

| 机制 | 位置 | 说明 |
|---|---|---|
| 状态机 | `applicationService.STATUS_TRANSITIONS` | 白名单数据表 + `assertTransition` 校验；非法跳转返回允许的下一状态 |
| 招满计数 | `refreshPositionFilledCount` | `filled_count = COUNT(was_admitted=1)`，录取后归档也不丢计数 |
| 六维筛选 | `listClubApplications` | typeTag/status/grade/keyword/positionId/recruitmentId 动态 WHERE + 状态优先级排序 + statusCounts |
| 技能匹配 | `matchService.matchSkills` | 归一化标签 → 命中率百分比 + 命中/缺失明细 |
| 转岗建议 | `matchService.matchClubApplicants` | 未录取投递者 × open 岗位，≥50% 建议改投（已批量取 existingPairs 防 N+1） |
| 看板聚合 | `dashboardService.getDashboard` | 8 条只读 SQL → core/funnel/progress/distributions/trend（趋势补 0 值） |
| 访问保护 | `middlewares/basicAuth.js` | 常量时间比较；未配置强密码时启动告警 |
| 数据持久化 | SQLite WAL | 投递真实落库；学生端 localStorage 仅存档案与投递 id 索引 |

## 8. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 仓库初始化 + docs | ✅ |
| M1 | 数据模型 + 社团/批次/岗位 CRUD API | ✅ |
| M2 | 简历上传 + 投递 + 状态机 API | ✅ |
| M3 | 前端框架 + 社团资料与招新管理页 | ✅ |
| M4 | 前端简历库：列表/详情/筛选/归档 | ✅ |
| M5 | 认证与角色权限（多角色 JWT / 学号验证） | ⏸ 暂缓（当前为开放模式 + 可选 Basic Auth） |
| M6 | 导出 / Docker / 部署文档 | ✅ |
| M7 | 智能匹配（技能标签 + match API + 推荐 UI） | ✅ |
| M8 | 数据看板（指标/漏斗/进度/分布/趋势 + 导航分区） | ✅ |
| M9 | 学生投递端整合（H5 + 适配层，真实落库） | ✅ |

> **M5 说明**：需要时补 user 表 + JWT 登录 + `club_admin` 与 club 绑定 + 路由守卫
> （预留位置：`recruitmentService.assertClubAccess` 的 TODO；学生端可加学号+短信验证）。

## 9. 环境与工具链

- Node.js ≥ 20（开发机 v24.18.0）
- npm 11、Vite 6、Vue 3.5、Element Plus 2.9、ECharts 5
- Express 4 + better-sqlite3 13 + multer 2
- SQLite 3（内嵌，无独立数据库服务）
- Git 2.55（受限网络下经 SOCKS5 代理访问 GitHub）

## 10. 关键设计决策记录（ADR 摘要）

| 决策 | 选择 | 理由 |
|---|---|---|
| DB | SQLite（better-sqlite3） | 零配置、单文件备份、同步 API 让代码是顺序流 |
| 后端 | Express 薄路由 + service 层 | 简单可控，不引入过重框架 |
| 管理端 | Vue3 + Element Plus + ECharts | 中后台组件全、中文生态好、图表开箱即用 |
| 学生端 | 原生 HTML + **适配层**而非重写 | 复用后端接口零改动，代码量约重写方案的 1/12 |
| 学生端模板 | 按社团分类动态生成（不建模板表） | 免迁移即得差异化模板；需自定义时再补表 |
| 简历文件 | multer 本地磁盘 | 避免对象存储账号成本，投产可换 S3/OSS |
| 状态流转 | 显式白名单数据 | 后端校验 + 前端复用同一份规则，杜绝非法跳转 |
| 招满计数 | 冗余 `filled_count` + 单入口刷新 | 列表页零成本读招满情况；写入收敛到一处保证一致 |
| 归档语义 | `was_admitted` 终身标记 | 修"录取后归档导致招满数归零"的缺陷 |
| 简历"优化" | 只规范格式 + 给建议，**不篡改事实** | 原型的"多名→15名"式改写属伪造经历，必须禁止 |
| 部署 | Docker 多阶段 + Windows 计划任务 | 前者标准可移植，后者本机登录自启 |
