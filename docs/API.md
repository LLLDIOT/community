# API 设计（v1）

> Base URL：`/api/v1`
> 认证：**两层**。① 全站访问门禁：**HTTP Basic Auth**（可选，由 `server/.env` 的 `BASIC_AUTH_DISABLE` 开关；`/healthz` 免认证）；
> ② 社团端账号：登录后拿到 token，前端放在自定义头 **`X-Club-Token`** 里（也兼容 `Authorization: Bearer <token>`，便于 curl）。见「认证与账号」。
> 响应格式：成功 `{ code: 0, data }`；失败 `{ code, message }`。
> 字典：`GET /dict` → `{ typeTags, statuses, statusTransitions, decisions, roles, roleLabels, roleCapabilities }`
> （前端复用后端状态流转规则、面试结论枚举与角色能力矩阵）。

## 社团 Club

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /clubs | 社团列表（分页/关键字/分类筛选） | guest |
| GET | /clubs/:id | 社团详情（含招新批次+岗位摘要） | guest |
| POST | /clubs | 创建社团 | club_admin/super_admin |
| PUT | /clubs/:id | 更新社团（名称/规模/说明/联系方式/分类…） | club_admin(super) |
| PUT | /clubs/:clubId/standard | 修改本社团的**信息录入标准**与**投递时间** | club:edit + 本社团 |
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

### 请求示例：修改本社团录入标准与投递时间（PUT /clubs/:clubId/standard）
```json
{
  "entryCriteria": "需提交作品集或 GitHub 链接；有前端项目经验者优先",
  "applyStartAt": "2026-09-01T00:00:00.000Z",
  "applyEndAt": "2026-10-15T23:59:59.000Z"
}
```
- `entryCriteria` 与社团介绍 `description` 是两个字段：前者告诉投递者"要交什么、达到什么条件"。
- `applyStartAt` / `applyEndAt` 是**社团级**投递时间窗；批次（recruitment）上的 `startAt`/`endAt` 优先级更高，
  未填时回落到这里（招新广场的阶段推导即按此规则）。
- 校验：开始时间不能晚于结束时间（400）。
- 权限：需登录社团账号且角色具备 `club:edit`（仅 `owner`），并且 `:clubId` 必须是自己的社团（否则 403）。

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
| DELETE | /resumes/:id | 删除简历（清理误建/测试归档用）|

**DELETE /resumes/:id 的限制**：该简历**还有投递记录时拒绝删除**（400，消息带上投递条数），
必须先把投递处理掉。原因是外键级联会把 `application` 一起带走，等于绕过状态机删掉社团的面试历史
（含面试结论、候补序号）。没有投递时才真删，返回 `{ id, deleted: true }`。

multipart 字段：`studentName, phone, email, school, major, grade, content` + `file`（PDF/图片，≤10MB）。

## 投递 Application（归档核心）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /positions/:positionId/applications | 投递简历到岗位（body: `{ resumeId, typeTag }`） |
| GET | /positions/:positionId/applications | 某岗位的投递列表（= 按需求归档视图） |
| GET | /clubs/:clubId/applications | 某社团简历库（支持筛选：typeTag/status/grade/keyword/positionId/recruitmentId/**decision**/分页） |
| GET | /applications/:id | 投递详情（含简历全文与附件） |
| PATCH | /applications/:id/status | 状态流转（new/screening/interviewing/admitted/rejected） |
| PATCH | /applications/:id/archive | 归档 / 取消归档 |
| PUT | /applications/:id | 更新评分/备注/类型标签 |
| DELETE | /applications/:id | 删除投递（软删：置 status=archived 或真删，M2 定为真删+提示） |
| GET | /clubs/:clubId/applications/export | 导出 CSV（utf-8 with BOM，Excel 友好） |

### 筛选参数（GET /clubs/:clubId/applications）
`typeTag=technical&status=interviewing&grade=大二&keyword=前端&decision=hired&page=1&pageSize=20`

新增的 `decision` 筛选（迁移 004）取值：`hired` / `waitlist` / `adjust` / `reject`（按面试结论筛），
以及特殊值 **`__undecided__`**（只看还没标结论的，对应 `decision = ''`）；传空或不传 = 不按结论筛。

### 返回字段（GET /clubs/:clubId/applications）
除原有的 `list / total / page / pageSize / statusCounts` 外，迁移 004 新增：

| 字段 | 说明 |
|---|---|
| `decisionCounts` | 按面试结论统计的条数，键为 `hired/waitlist/adjust/reject/undecided`；**忽略 `decision` 过滤**（用于前端"结论统计条"点击即筛） |
| 列表项 `decision` | 面试结论，`''` = 未决定 |
| 列表项 `waitlist_rank` | 候补序号（仅候补有值） |
| 列表项 `adjust_position_id` / `adjust_position_title` | 调剂去向岗位 id 与标题 |
| 列表项 `resume_id` / `skills` | 简历 id 与技能标签（前端直接算匹配度） |

### CSV 导出
在原有列基础上新增三列：**面试结论、候补序号、调剂去向**
（完整顺序：姓名/类型/状态/面试结论/候补序号/调剂去向/评分/岗位/招新批次/学校/专业/年级/投递时间/备注），
并支持与列表一致的 `decision` 筛选（含 `__undecided__`）。

### 状态流转请求
```json
{ "status": "interviewing" }
```
非法跳转（如 admitted → new）返回 400 与允许的下一状态集合。

## 招新广场 Square（只读）

社团端「双面板」的**左侧面板**：全校社团总览 + 点进去看某个社团的招新情况与投递人数。
三个接口**全部只读、无需登录**（Basic Auth 例外情况与全站一致），挂在 `/api/v1/square` 下。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /square/clubs | 全校社团总览卡片：招新情况（阶段、名额、已录、招满率、候补数）+ 投递人数 | 公开 |
| GET | /square/clubs/:id | 单社团招新情况详情：批次/岗位/投递人数/状态分布/结论分布/近 N 天趋势 | 公开 |
| GET | /square/categories | 分类筛选项（值 + 社团数） | 公开 |

### GET /square/clubs
query：`keyword`（匹配社团名/介绍/录入标准）、`category`、`stage`（`open` 招新中 / `closed` 已截止或即将开始）、
`sort`（`applications` 投递人数，默认 / `scale` 规模 / `name` 名称）。

返回 `{ list, total, totals }`；每张卡片含 `id/name/category/scale/scaleLabel/description/entryCriteria/applyStartAt/applyEndAt`、
`stage` + `stageLabel`、`currentRecruitment`（当前进行中的批次摘要，可空）与
`stats`（`recruitmentCount/openRecruitmentCount/positionCount/openHeadcount/openFilled/fillRate/applicationCount/admittedCount/pendingCount/waitlistCount/adjustCount`）。
`totals` 为筛选后的合计（社团数/招新中社团数/岗位数/名额/投递数）。

### 招新阶段（stage / stageLabel）
由**批次状态 + 时间窗**推导，时间窗取"批次 `start_at`/`end_at`，未填则回落社团级 `apply_start_at`/`apply_end_at`"：

| stage | stageLabel | 触发条件 |
|---|---|---|
| `none` | 暂无招新 | 该社团没有进行中的批次 |
| `upcoming` | 即将开始 | 开始时间还在未来 |
| `open` | 招新中 | 在时间窗内（或没填开始/结束时间） |
| `closed` | 已截止 | 结束时间已过，或批次状态为 `closed` |

### GET /square/clubs/:id
query：`days`（投递趋势天数，取值被夹在 **7~180**，默认 30）。
返回 `club`（含 `entryCriteria` 与社团级投递时间）、`stage`/`stageLabel`、`window`（实际生效的起止时间）、
`recruitments[]`（每个批次带 `positions[]` 与 `stats`）、`stats`（含 `statusCounts` 与 `decisionCounts`）、
`trend[]`（近 N 天逐日投递数，**含 0 值补全**，前端可直接画连续折线）。

## 面试决策 Decision（录用/调剂/候补递补）

面试与录用工作台的后端接口：标注录用/候补/调剂/淘汰、排候补序号、按序号递补招满、调剂到本社团其他岗位。
读需要 `application:read`（`viewer` 起），写需要 `application:decide`（`interviewer` 起）；
服务层再校验"这条投递/岗位是否属于你的社团"（跨社团 403）。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /clubs/:clubId/interview-board | 面试工作台数据：候选人分列（新收到/待筛选/面试中/已录取/已淘汰）+ 岗位进度 + 汇总 | application:read |
| GET | /applications/:id/decision | 单条投递的决策详情（含匹配度、岗位余缺、调剂去向标题） | application:read |
| PATCH | /applications/:id/decision | 标注面试结论 | application:decide |
| GET | /applications/:id/adjust-suggestions | 调剂建议（复用技能匹配引擎推荐本社团其他岗位） | application:decide |
| POST | /applications/:id/adjust | 执行调剂：在目标岗位新建投递 + 原投递标注为"调剂" | application:decide |
| GET | /positions/:positionId/waitlist | 候补队列（按序号升序 = 递补顺序） | application:read |
| POST | /positions/:positionId/promote-waitlist | 递补：把候补队首提升为录用，其余序号自动前移 | application:decide |
| GET | /positions/:positionId/progress | 岗位招满进度（含候补数、是否招满、是否超招） | application:read |

### GET /clubs/:clubId/interview-board
query：`recruitmentId`、`positionId`、`keyword`（姓名/专业/学校）、`onlyUndecided`（`1`/`true` 只看未标结论）。
返回 `candidates`（扁平列表，含 `status`/`decision`/`waitlistRank`/`adjustPositionTitle`/`matchScore`/`hitSkills`）、
`columns`（按 `status` 分列的看板数据）、`progress`（每个岗位的招满进度）、
`summary`（`total/hired/waitlist/adjust/rejected/undecided/needTotal/filledTotal/waitlistTotal/remainingTotal/fillRate`）、
`positions`（筛选项用的岗位列表）。

### PATCH /applications/:id/decision
```json
{ "decision": "waitlist", "waitlistRank": 2, "score": 4, "note": "面试不错，等名额" }
```
- `decision` 枚举：`hired` 录用 / `waitlist` 候补 / `adjust` 调剂 / `reject` 淘汰 / `''` 撤销结论。
- `waitlistRank` 仅候补有效，不传则排到队尾；**同岗位内不可重复**（重复返回 400）。
- `adjustPositionId` 仅调剂有效，必须指定且是同社团的其他岗位。
- `score` / `note` 可选，等价于顺带更新评分与备注。

**各结论的副作用**（在**同一事务**内执行，失败整体回滚）：

| decision | 副作用 |
|---|---|
| `hired` | 复用既有状态机推进到 `admitted`（置 `was_admitted=1` 并重算岗位 `filled_count`）；`new` 状态不能直接录用，报 400 并提示允许的下一状态 |
| `reject` | 推进到 `rejected` |
| `waitlist` | 分配候补序号；**不改流程状态、不占名额**（招满数不变） |
| `adjust` | 记录调剂去向；不改流程状态 |
| `''` | 撤销结论；若原为 `admitted` 则退回 `interviewing`，清 `was_admitted` 并让 `filled_count` 正确回落 |

### 候补与递补语义
- 候补队列 = `decision='waitlist'` 按 `waitlist_rank` 升序，**序号即递补顺序，1 号永远最优先**。
- `POST /positions/:positionId/promote-waitlist`，body 可选 `{ applicationId }`：不传则提升队首，
  传了则必须在该岗位候补队列中（否则 400）；队列为空返回 400。
- 递补会把被提升者置为 `hired`（占一个名额），并把**剩余候补的序号自动前移**重排为 1,2,3…。
  返回 `{ promoted, remaining, position }`（重排后的队列与该岗位最新进度）。

### 调剂
- `GET /applications/:id/adjust-suggestions`：返回 `{ application, suggestions[] }`，
  每条含 `positionId/positionTitle/matchScore/hitSkills/missingSkills/headcount/filledCount/remaining/reason`，
  已排除当前岗位、候选人已投过的岗位，按匹配度与余缺排序。
- `POST /applications/:id/adjust`，body `{ adjustPositionId }`：在目标岗位新建一条投递（复用既有去重与状态机），
  并把原投递标注为 `adjust`（保留历史、不改流程状态）；已投过则 `alreadyApplied: true` 而不报错。

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

## 认证与账号 Auth / Account

社团级账号体系（迁移 004）：**一个社团 → 多个账号**，登录后能判定"你是哪个社团的谁、能不能改这条数据"。
全站 Basic Auth 仍在，是**另一层**（见下）。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /auth/login | 登录 → `{ token, expiresAt, account }` | 公开 |
| POST | /auth/logout | 退出（销毁当前 token） | 登录 |
| GET | /auth/me | 当前登录者（含角色、角色标签、能力清单） | 登录 |
| PATCH | /auth/password | 修改**自己**的密码（需原密码，改后强制下线） | 登录 |
| GET | /clubs/:clubId/accounts | 本社团账号列表 | account:manage |
| POST | /clubs/:clubId/accounts | 新建账号（body `{ username, password, displayName?, role? }`，密码 ≥6 位） | account:manage |
| PUT | /accounts/:id | 改角色 / 停用启用 / 重置密码（body 任意组合 `{ displayName?, role?, isActive?, password? }`） | account:manage |
| DELETE | /accounts/:id | 删除账号 | account:manage |

### 两种登录方式
`POST /auth/login` 的 body 是**三选一**的写法：

| 方式 | body | 说明 |
|---|---|---|
| 按账号登录 | `{ "username": "owner_abc123", "password": "…" }` | 最直接的账号名 + 密码 |
| 按社团名登录 | `{ "username": "计算机协会", "password": "…" }` | `username` 填社团名时，取该社团的 `owner` 账号（对中文用户更友好） |
| 按社团选择登录 | `{ "clubId": "clu_xxx", "password": "…" }` | 前端"选择社团 + 输密码"表单；优先取该社团的 `owner`，没有则取最早创建的可用账号 |

账号不存在、账号已停用、密码错误都落到 **401**（同一状态码，消息分别为"账号不存在或已停用""密码不正确"）。

### 登录态为什么用 `X-Club-Token` 而不是 `Authorization`
全站还有一层 HTTP Basic Auth 也用 `Authorization` 头。如果前端 JS 显式设置
`Authorization: Bearer <token>`，会**覆盖浏览器自动附加的 Basic 凭据**，
一旦重新开启 Basic Auth，前端所有请求都会 401。因此社团端 token 走独立头：

```
X-Club-Token: <32 字节随机 token>
```

同时服务端**兼容** `Authorization: Bearer <token>`（便于 curl / 脚本调用）；
`X-Club-Token` 优先，取不到才回落到 Bearer。前端由 `web/src/api/client.js` 的请求拦截器自动附加，
收到 **401** 时清掉本地 token 并广播 `club-auth-expired`，由界面弹出登录框。

### 安全与会话
- 口令：**scrypt + 每账号随机盐**派生，不落明文；比对用 `timingSafeEqual` 防时序侧信道。
- 会话：token 为 32 字节随机数，存 `club_session` 表；默认 **12 小时**过期，可用环境变量
  `CLUB_SESSION_HOURS` 覆盖。退出即删行；改密/重置密码会删掉该账号全部会话（强制下线）；
  过期会话在解析时清理，服务启动时另做一次批量清理。
- 首次启动会给**还没有账号的社团**自动播种一个 `owner` 账号，随机口令写入
  `server/data/initial-accounts.txt`（该目录已 gitignore，不入库）。
- 每个社团必须保留至少一个启用状态的 `owner`；不能删除自己正在使用的账号。

### 角色与能力矩阵
角色的能力清单定义在 `server/src/services/authService.js` 的 `ROLE_CAPABILITIES`，
并经 `GET /dict` 的 `roles` / `roleLabels` / `roleCapabilities` 下发给前端（前端只用它隐藏按钮，
真正的拦截在 `server/src/middlewares/clubAuth.js`）。权限判定顺序：登录（401）→ 能力（403）→ 本社团（403）。

| 角色 | 中文 | 能力 |
|---|---|---|
| `owner` | 社长 / 管理员 | `club:edit`、`recruitment:edit`、`position:edit`、`application:read`、`application:decide`、`dashboard:read`、`account:manage` |
| `interviewer` | 面试官 | `application:read`、`application:decide`、`dashboard:read` |
| `viewer` | 观察员 | `application:read`、`dashboard:read` |

> **与 Basic Auth 的关系**：Basic Auth 回答"你能不能进这个系统"（全站一把密码，可选开关）；
> 社团账号回答"你是哪个社团的谁、这一下能不能改这条数据"。两者并存、互不替代，且不共用请求头（见上）。M5 里原计划的"多角色 JWT 登录"即由这套社团级账号体系落地。

## 错误码约定

| code | 含义 |
|---|---|
| 0 | 成功 |
| 40001 | 参数校验失败（含状态流转非法、候补序号重复、调剂目标非法、投递开始晚于结束等，消息里说明原因） |
| 40400 | 资源不存在 |
| 40300 | 权限不足（角色缺少所需能力，或试图操作其他社团的数据） |
| 40100 | **未登录 / 登录已失效**（社团端 token 缺失、过期、账号被停用），或 Basic Auth 未通过（访问密码缺失） |
| 50000 | 服务器内部错误 |
