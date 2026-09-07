# 社团招新系统 · 架构设计

> 版本：v0.1（M0）　|　仓库：LLLDIOT/community　|　协议：MIT

## 1. 系统定位

面向高校社团的招新管理平台。核心解决两个问题：

1. **社团自我展示**：社团名称、规模、说明、招新需求、招新人数等信息的在线化维护。
2. **简历归档分类**：把学生投递的简历沉淀成"简历库"，支持**按招新需求分类**与**按简历类型分类**，便于筛选、流转与复盘。

## 2. 角色与权限

| 角色 | 简称 | 能力范围 |
|---|---|---|
| 访客 | guest | 浏览社团列表与详情（只读） |
| 学生 | student | 注册登录、填写/上传简历、投递招新岗位、查看投递进度（二期） |
| 社团管理员 | club_admin | 维护本社团资料、招新批次与岗位；管理本社团简历库（归档/分类/状态流转/导出）（一期重点） |
| 超级管理员 | super_admin | 社团与账号审核、全局统计（三期） |

一期交付聚焦 **club_admin 的社团资料维护 + 简历归档**，其他角色预留数据模型与路由守卫。

## 3. 领域模型（概念层）

```
Club 社团
 └── Recruitment 招新批次 (每学期/每轮招新 = 一个批次)
      └── Position 招新岗位需求 (title / requirement / headcount)
           └── Application 投递记录 (status 状态机 / type_tag / 归档标记)
                └── Resume 简历 (学生信息 + 附件文件)

Tag 标签（多对多，用于"按类型分类"）
```

**按需求分类**：`Position` 天然形成树 `社团 → 批次 → 岗位 → 投递/简历`。
**按类型分类**：`Application.type_tag` 与 `Tag` 多标签交叉筛选（如"技术型/组织型"、"大一/大二"）。

## 4. 系统架构

```
┌──────────────────────────────┐
│  Vue 3 SPA (web/)            │
│  Element Plus + Pinia + Vue Router
└──────────────┬───────────────┘
               │ HTTPS / JSON (REST)
┌──────────────▼───────────────┐
│  Express API (server/)       │
│  ├─ routes: auth / clubs /   │
│  │   recruitments / positions │
│  │   / applications / resumes │
│  ├─ middleware: 鉴权+角色守卫  │
│  └─ services: 业务逻辑层      │
└──────────────┬───────────────┘
               │ better-sqlite3
┌──────────────▼───────────────┐
│  SQLite (data/club.db)       │
│  + uploads/ (简历附件文件)    │
└──────────────────────────────┘
```

- 单仓库（monorepo-lite）：`server/` + `web/` 两个独立 Node 包，共享 `docs/` 与根 README。
- 开发期 SQLite 单文件零配置，投产期可平滑替换为 PostgreSQL（SQL 层已按标准约束编写）。
- 简历附件存储于 `server/uploads/`，投产期替换为对象存储（S3/OSS）。

## 5. 后端分层

```
server/src/
├─ index.js            # 启动入口：创建 app、连接数据库、注册路由
├─ app.js              # Express 实例装配（json/静态目录/路由挂载/错误处理）
├─ db/
│  ├─ connection.js    # better-sqlite3 单例 + 迁移执行
│  └─ migrations/      # 001-init.sql 等（顺序编号）
├─ routes/             # 路由层：参数校验 → 调 service → 响应
├─ services/           # 业务层：数据访问与规则
├─ middlewares/        # auth.js（JWT）、role.js、upload.js（multer）
└─ utils/              # 响应封装、错误类、id 生成
```

## 6. API 约定

- Base URL：`/api/v1`
- 认证：`Authorization: Bearer <JWT>`；角色信息放在 JWT payload（`{ sub, role }`）。
- 响应统一：成功 `{ code: 0, data }`；失败 `{ code: <业务码>, message }`（HTTP 状态码同时表达语义）。
- 分页：`?page=1&pageSize=20` → `{ list, total, page, pageSize }`。

## 7. 里程碑（M0 → M6）

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M0 | 仓库初始化 + docs | 文档齐全、目录可读 |
| M1 | 数据模型 + 社团/批次/岗位 CRUD API | curl 可完成增删改查 |
| M2 | 简历上传 + 投递 + 状态机 API | 简历可走"已投递→已录取"流转 |
| M3 | 前端框架 + 社团资料与招新管理页 | 页面可编辑保存 |
| M4 | 前端简历库：列表/详情/筛选/归档树 | 按需求、按类型可筛 |
| M5 | 认证与角色权限（JWT） | 越权访问被拦截 |
| M6 | 导出/统计/Docker/部署文档 | 可演示上线 |

## 8. 环境与工具链

- Node.js ≥ 20（开发机 v24.18.0）
- npm 11
- Git 2.55（经 SOCKS5 代理访问 GitHub：`http.proxy=socks5h://127.0.0.1:7897`）
- 无独立数据库服务依赖（SQLite 内嵌）

## 9. 关键设计决策记录（ADR 摘要）

| 决策 | 选择 | 理由 |
|---|---|---|
| DB | SQLite（better-sqlite3） | 零配置、单文件备份易、够用即止 |
| 后端 | Express（薄路由+service 层） | 简单可控，不引入过重框架 |
| 前端 | Vue3 + Element Plus | 中后台组件全、中文生态好 |
| 简历文件 | multer 本地磁盘 | 一期避免对象存储账号成本 |
| 状态流转 | 显式白名单（新收到→待筛选→面试中→已录取/已淘汰） | 防非法跳转，便于审计 |
| 分类 | type_tag 枚举 + 自由 Tag 多对多 | 兼顾"结构化筛选"与"灵活打标" |
