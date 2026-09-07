# API 设计（v1）

> Base URL：`/api/v1`　|　认证：`Authorization: Bearer <JWT>`（M5 启用，M1-M2 先开放）
> 响应格式：成功 `{ code: 0, data }`；失败 `{ code, message }`。

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

## 认证 Auth（M5 启用）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/login | 用户名密码登录 → { token, user } |
| POST | /auth/register | 注册（student） |
| GET | /auth/me | 当前用户信息 |

## 错误码约定

| code | 含义 |
|---|---|
| 0 | 成功 |
| 40001 | 参数校验失败 |
| 40002 | 状态流转非法（含 allowed 列表） |
| 40400 | 资源不存在 |
| 40300 | 权限不足 |
| 50000 | 服务器内部错误 |
