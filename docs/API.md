# API 设计（v1）

> Base URL：`/api/v1`
> 认证：**HTTP Basic Auth**（可选，由 `server/.env` 的 `BASIC_AUTH_DISABLE` 开关；`/healthz` 免认证）。
> 多角色 JWT 登录为 M5 规划项，尚未实现。
> 响应格式：成功 `{ code: 0, data }`；失败 `{ code, message }`。
> 字典：`GET /dict` → `{ typeTags, statuses, statusTransitions }`（前端复用后端状态流转规则）。

## 社团 Club

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /clubs | 社团列表（分页/关键字/分类筛选） | guest |
| GET | /clubs/:id | 社团详情（含招新批次+岗位摘要） | guest |
| POST | /clubs | 创建社团 | club_admin/super_admin |
| PUT | /clubs/:id | 更新社团（名称/规模/说明/联系方式/分类…） | club_admin(super) |
| PUT | /clubs/:id/visibility | 上/下架（is_visible） | super_admin |
| DELETE | /clubs/:id | 删除社团（级联检查） | super_admin |

### 请求示例：创建/更新社团
```json
{
  "name": "计算机协会",
  "scale": 120,
  "scaleLabel": "50-200",
  "description": "面向全校的计算机技术社团…",
  "category": "technical",
  "contactName": "张三",
  "contactPhone": "13800000000",
  "contactEmail": "zs@example.com"
}
```

### 响应示例：GET /clubs/:id
```json
{
  "code": 0,
  "data": {
    "id": "clu_...", "name": "计算机协会", "scale": 120,
    "description": "…", "category": "technical",
    "recruitments": [
      { "id": "rec_...", "title": "2026 秋季招新", "status": "open",
        "positions": [ { "id": "pos_...", "title": "前端干事",
          "headcount": 5, "requirement": "…" } ] }
    ]
  }
}
```

## 招新批次 Recruitment

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /clubs/:clubId/recruitments | 批次列表 |
| POST | /clubs/:clubId/recruitments | 创建批次 |
| PUT | /recruitments/:id | 更新批次 |
| PUT | /recruitments/:id/status | 改状态（draft/open/closed） |
| DELETE | /recruitments/:id | 删除（须无岗位或级联确认） |

```json
{ "title": "2026 秋季招新", "startAt": "2026-09-01", "endAt": "2026-10-15" }
```

## 招新岗位 Position

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /recruitments/:recId/positions | 岗位列表 |
| POST | /recruitments/:recId/positions | 创建岗位 |
| PUT | /positions/:id | 更新岗位（含 headcount） |
| DELETE | /positions/:id | 删除岗位 |

```json
{ "title": "前端开发干事", "requirement": "熟悉 HTML/CSS/JS…", "headcount": 5 }
```

## 简历 Resume

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /resumes | 创建简历（JSON 信息 + 可选附件 multipart/form-data） |
| GET | /resumes/:id | 简历详情 |
| PUT | /resumes/:id | 更新简历 |

multipart 字段：`studentName, phone, email, school, major, grade, content` + `file`（PDF/图片，≤10MB）。

## 投递 Application（归档核心）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /positions/:positionId/applications | 投递简历到岗位（body: `{ resumeId, typeTag }`） |
| GET | /positions/:positionId/applications | 某岗位的投递列表（= 按需求归档视图） |
| GET | /clubs/:clubId/applications | 某社团简历库（支持筛选：typeTag/status/grade/keyword/分页） |
| GET | /applications/:id | 投递详情（含简历全文与附件） |
| PATCH | /applications/:id/status | 状态流转（new/screening/interviewing/admitted/rejected） |
| PATCH | /applications/:id/archive | 归档 / 取消归档 |
| PUT | /applications/:id | 更新评分/备注/类型标签 |
| DELETE | /applications/:id | 删除投递（软删：置 status=archived 或真删，M2 定为真删+提示） |
| GET | /clubs/:clubId/applications/export | 导出 CSV（utf-8 with BOM，Excel 友好） |

### 筛选参数（GET /clubs/:clubId/applications）
`typeTag=technical&status=interviewing&grade=大二&keyword=前端&page=1&pageSize=20`

### 状态流转请求
```json
{ "status": "interviewing" }
```
非法跳转（如 admitted → new）返回 400 与允许的下一状态集合。

## 标签 Tag（二期可选）
| 方法 | 路径 |
|---|---|
| GET/POST | /clubs/:clubId/tags |
| PUT/DELETE | /tags/:id |
| PUT | /applications/:id/tags —— 打标/取消打标 |

## 智能匹配 Match（技能标签）
简历 `skills` 与岗位 `requiredSkills` 均为逗号分隔标签；匹配度 = 命中技能数 / 期望技能数。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /resumes/:id/match-top?clubId=&limit=&minScore= | 简历 → 全平台/指定社团岗位按匹配度排序（返回命中/缺失技能） |
| GET | /clubs/:clubId/match-applicants?limit= | 社团内"转岗建议"：未录取投递者 × open 岗位的高分组合（≥50%） |

## 数据看板 Dashboard（只读统计）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /dashboard?clubId=&days= | 聚合统计：core 指标 / funnel 漏斗 / progress 岗位进度 / distributions 类型与年级 / trend 投递趋势 |

## 学生投递端 Portal（复用管理端接口，无专用 API）

学生端（`web/public/portal.html`）通过适配层 `portal-adapter.js` 调用**既有接口**完成投递，
后端不需要为学生端新增任何接口或数据表：

| 学生端动作 | 调用的既有接口 | 说明 |
|---|---|---|
| 加载社团列表 | `GET /clubs?page=1&pageSize=100` | 经适配层转换字段（`description`→`intro`、`positions[].title`→`name` 等） |
| 查看社团详情与岗位 | `GET /clubs/:id` | 取 `recruitments[].positions[]`，适配层拍平成可选岗位列表 |
| 提交简历 | `POST /resumes`（JSON） | 由模板字段拼成 `content` 正文 + 基本信息 + `skills` |
| 投递岗位 | `POST /positions/:id/applications` | `{ resumeId, typeTag }`，`typeTag` 由社团分类自动映射 |
| 查看投递进度 | `GET /applications/:id` | 本地只存 applicationId 索引，状态每次从服务端拉取最新 |
| 简历模板 | 无接口 | 适配层按 `club.category` 在前端生成字段（技术/文艺/组织/体育/学术/公益） |

> 客户端缓存：学生档案与投递索引存 localStorage（键 `portal_student_profile` / `portal_applications`）。

## 认证 Auth（M5 规划，尚未实现）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/login | 用户名密码登录 → { token, user } |
| POST | /auth/register | 注册（student） |
| GET | /auth/me | 当前用户信息 |

## 错误码约定

| code | 含义 |
|---|---|
| 0 | 成功 |
| 40001 | 参数校验失败（含状态流转非法，消息里带允许的下一状态） |
| 40400 | 资源不存在 |
| 40300 | 权限不足 |
| 40100 | 需要访问密码（Basic Auth 未通过） |
| 50000 | 服务器内部错误 |
