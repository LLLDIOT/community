# Community · 社团招新系统

高校社团招新管理平台：社团资料在线维护 + 学生简历归档分类。

- **社团端**：社团名称 / 规模 / 说明 / 招新需求 / 招新人数 的维护；简历归档，支持**按需求**与**按类型**分类。
- **技术栈**：Vue 3 + Element Plus（web/） · Express + better-sqlite3（server/）
- **协议**：MIT（本仓库 LICENSE）

## 仓库结构

```
community/
├─ docs/
│  ├─ ARCHITECTURE.md   # 架构设计与里程碑
│  ├─ DATA_MODEL.md     # 数据模型 + SQL DDL
│  └─ API.md            # REST API 设计
├─ server/              # Express API（开发中 M1-M2）
├─ web/                 # Vue3 前端（规划中 M3-M4）
├─ README.md
└─ LICENSE              # MIT
```

## 快速开始

> 详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。当前开发进度见文末。

### 后端（server）
```bash
cd server
npm install
npm run dev        # http://localhost:3000
# 首次启动自动执行 db/migrations 建库
```

### 冒烟测试
```bash
curl http://localhost:3000/api/v1/clubs
```

## 开发进度

| 里程碑 | 状态 |
|---|---|
| M0 仓库初始化 + docs | ✅ |
| M1 数据模型 + 社团/批次/岗位 CRUD | ⏳ |
| M2 简历上传 + 投递 + 状态机 | ⬜ |
| M3 前端社团资料与招新管理 | ⬜ |
| M4 前端简历库归档/筛选 | ⬜ |
| M5 认证权限 | ⬜ |
| M6 导出/部署 | ⬜ |
