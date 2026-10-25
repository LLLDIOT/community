# 运行时详解 —— 每一步在做什么，背后的知识点是什么

> 这份文档不只说"系统怎么走"，而是把**每个环节背后的计算机知识**讲清楚：
> 它解决什么问题、为什么这样设计、以及本项目在这里踩过什么坑。
>
> 阅读建议：按顺序读一遍；日后排查问题时按目录跳转。

---

## 目录

1. [进程与端口：一个进程为什么要跑两个网站](#一)
2. [启动六步：从进程拉起 to 端口可访问](#二)
3. [请求处理链：中间件的洋葱模型](#三)
4. [认证三层：你能进、你是谁、你能改什么](#四)
5. [主线一：学生投递（全公开链路）](#五)
6. [主线二：社团决策（登录后的写链路）](#六)
7. [ML 层：语义匹配是怎么跑起来的](#七)
8. [公网链路：内网穿透到底发生了什么](#八)
9. [一次请求的完整走查](#九)
10. [常见误解与答疑](#十)

---

<a id="一"></a>
## 一、进程与端口：一个进程为什么要跑两个网站

### 1.1 它现在长什么样

```
        :3000                          :3001
   ┌──────────────┐              ┌──────────────┐
   │  社团端       │              │  学生端       │
   │  Basic Auth  │              │  无密码       │
   └──────┬───────┘              └──────┬───────┘
          └───────────┬──────────────────┘
                      ▼
            ┌──────────────────┐
            │  同一个 node 进程 │
            └────────┬─────────┘
                     ▼
            ┌──────────────────┐
            │  club.db (SQLite)│
            └──────────────────┘
```

### 1.2 知识点：进程、端口、监听

- **进程**：操作系统分配资源的最小单位。一个 `node src/index.js` 就是一个进程。
- **端口**：一台机器上区分不同服务的"门牌号"（0~65535）。`listen(3000)` 表示"这个进程要在 3000 号门收信"。
- **一个进程可以监听多个端口**——这不是取巧，是标准做法。所以"两个网站"完全可以是"一个进程、两个门牌"。

> **关键区分**：网站 ≠ 服务 ≠ 进程。
> 网站是"用户看到的东西"，服务是"处理请求的程序"，进程是"操作系统里的执行体"。
> 三者不必一一对应。

### 1.3 知识点：为什么不用两个进程（SQLite 单写者）

这是本项目最核心的架构约束。

**SQLite 的工作方式**：整个数据库就是一个文件 `club.db`。

- 允许多个进程**同时读**（因为有 WAL，见下）
- 但**写入必须串行**——同一时刻只能有一个写者持有写锁

如果开两个 node 进程（一个管社团端、一个管学生端），它们会：
1. 争抢写锁 → 出现 `SQLITE_BUSY`
2. 更糟的是**WAL 文件被两个进程交错写入**，极端情况下损坏数据库

**WAL 是什么**：
> Write-Ahead Logging（预写日志）。传统模式写入要锁住整个库文件；
> WAL 模式先追加到 `club.db-wal` 日志，再择机合并回主库。
> 好处是**读不阻塞写、写不阻塞读**，并发性能好很多。
> 代价是多出 `-wal` 和 `-shm` 两个文件，备份时必须一起拷（否则数据不全）。

所以本项目的选择是：**一个进程、两个端口、一条写入路径**。对外是两个网站，对内只有一套读写逻辑。

### 1.4 知识点：静态资源怎么变成"网站"

两个站点托管的东西其实在同一台机器上：

```
web/dist/
  ├── index.html + assets/   ← Vue SPA（社团端）
  └── portal.html            ← 学生端 H5
  └── portal-adapter.js
```

- **社团端**：`express.static(dist)` + SPA fallback → 访问任何非 API 路径都返回 `index.html`，由前端路由接管
- **学生端**：只精确返回 `portal.html` / `portal-adapter.js` / 根路径，其它一律 404

**为什么学生端不做 SPA fallback**：它只有一个页面，不需要前端路由。让它"什么路径都返回首页"反而会让攻击面变大、排错变难。

### 1.5 本项目踩过的坑

- **Docker 起初只映射了 3000**，学生端 3001 在容器里跑着但外面访问不到。修复：`ports` 加一条 `3001:3001`，`EXPOSE` 也补上。
- 学生端一开始挂在社团端的 `/portal.html` 下，导致**学生必须知道管理密码**才能投递。这是拆分两个站点的根本原因。

---

<a id="二"></a>
## 二、启动六步：从进程拉起 to 端口可访问

`src/index.js` 只有 60 多行，但每一步都有讲究。

```
① loadEnv()               读 .env
② migrate()               建表/升级
③ purgeExpiredSessions()  清过期会话
④ ensureSeedAccounts()    播种社长账号
⑤ warmupML()              【异步】加载嵌入模型
⑥ listen(3000); listen(3001)
```

### 2.1 知识点：环境变量的优先级

`loadEnv()` 的规则是：**只写入 process.env 里还不存在的键**。

```js
if (process.env[key] === undefined) process.env[key] = value;
```

为什么这样写？因为部署时要允许"平台环境变量覆盖 .env 文件"：

```
优先级（高 → 低）：
  云平台控制台设置的环境变量
    ↓
  shell 里 export 的变量
    ↓
  server/.env 文件
    ↓
  代码里的默认值 (process.env.X || 'default')
```

如果 `.env` 无条件覆盖，你在云平台改的密码就永远不生效——这类问题极其难查。

### 2.2 知识点：数据库迁移（schema versioning）

**问题**：代码在迭代，数据库结构也要跟着变。但线上的数据库里有真实数据，不能删库重建。

**解法**：把每次结构变更写成一个**带序号的 SQL 文件**，按顺序执行一次，永不重复。

```
server/db/migrations/
  001-init.sql             建表
  002-add-was-admitted.sql 加一列
  003-add-skill-tags.sql   加两列
  004-club-console.sql     面试决策 + 账号表
  005-ml-embeddings.sql    向量缓存 + 自动标签
```

**版本记在哪**：SQLite 内置的 `PRAGMA user_version`（一个整数，跟着库文件走，不用额外建表）。

```js
const applied = db.pragma('user_version', { simple: true });  // 比如 3
for (let i = applied; i < files.length; i += 1) {
  db.exec(readFile(files[i]));          // 执行第 i 个迁移
  db.pragma(`user_version = ${i + 1}`); // 记下"已经到第几个"
}
```

**知识点：幂等（idempotent）**
> 同样的操作执行一次和执行多次，结果相同。
> 迁移必须是幂等的——服务重启很频繁，每次启动都会调 `migrate()`。
> 靠 `user_version` 让"已执行的跳过"，这就是幂等的实现方式。

**知识点：为什么整个迁移包在事务里**

```js
const runMigrations = db.transaction(() => { ... });
```

如果第 4 个迁移执行到一半报错，事务回滚 → 数据库保持在第 3 个迁移的状态，`user_version` 也不会前进。**不会出现"一半新一半旧"的畸形结构。**

### 2.3 知识点：会话清理与"过期"的含义

```js
db.prepare('DELETE FROM club_session WHERE expires_at < ?').run(now)
```

- 登录后发的 token 存在 `club_session`，带 `expires_at`（默认 12 小时）
- 过期 ≠ 自动消失。**数据库不会自己删东西**，必须有代码主动清理
- 校验时也做双重检查：查不到 → 拒；查到了但已过期 → 删掉并拒

**知识点：为什么用数据库存 token 而不是 JWT**

| | 数据库 token | JWT |
|---|---|---|
| 服务端能否主动失效 | ✅ 删一行就失效 | ❌ 签发后只能等它过期 |
| 是否需要一个"会话表" | 需要 | 不需要 |
| 适合场景 | 内部系统、要能踢人下线 | 无状态、大规模分布式 |

本项目要支持"改密码后强制下线"（`changeOwnPassword` 会删掉该账号所有会话），所以必须能主动失效 → 选数据库 token。

### 2.4 知识点：播种（seeding）与首次运行体验

**问题**：全新部署时数据库是空的，一个社团都没有 → 也就没有账号 → 登录不了 → 什么都做不了。

**解法**：启动时检查"哪些社团还没有账号"，给它们各建一个社长账号，随机密码写进本地文件。

```js
WHERE NOT EXISTS (SELECT 1 FROM club_account a WHERE a.club_id = c.id)
```

这个 SQL 的写法本身就是幂等的：**已经有的不会被重复创建**。

**但这里有个更隐蔽的坑**：

> 空库启动时**一个社团都没有**，所以一个账号都不会被播种。
> 等用户建好第一个社团，发现"没有账号可登录"——因为播种只在启动时跑一次。

修复方式是 `createClubWithOwner()`：**建社团的那一刻就给它开账号，并把凭据一次性返回**。这是"首次运行体验"（first-run experience）的典型问题——光测"有数据时正常"是不够的。

### 2.5 知识点：为什么 ML 预热不 await

```js
warmupML();            // 不 await
clubApp.listen(...);   // 立刻监听
```

模型首次要下载 20~30MB。如果 `await`，端口会晚几十秒才通，平台健康检查会判死、容器会被重启。

**知识点：阻塞启动 vs 非阻塞预热**

- 阻塞：启动慢但状态确定
- 非阻塞：启动快但需要处理"还没准备好"的中间态

本项目的处理方式是**非阻塞 + 可降级**：模型没就绪时匹配自动走规则，用户只是拿不到语义分，功能不缺失。

### 2.6 知识点：端口占用的错误处理

```js
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') { /* 给可读提示 */ }
});
```

`EADDRINUSE` 是最常见的启动失败（上次的进程没死透）。默认的报错是一大坨堆栈，指向 node 内部；显式处理之后，输出的是"端口 3000 已被占用，请停掉占用进程或改 .env"。

---

<a id="三"></a>
## 三、请求处理链：中间件的洋葱模型

### 3.1 社团端的完整链

```
请求
 ↓  ① trust proxy        识别 X-Forwarded-*（将来上 nginx 用）
 ↓  ② express.json()     解析 JSON 请求体
 ↓  ③ basicAuth()        ★ 全站密码（/healthz 豁免）→ 失败 401
 ↓  ④ /healthz           探活
 ↓  ⑤ /uploads 静态       简历附件
 ↓  ⑥ /portal.html       302 跳学生端
 ↓  ⑦ optionalAccount()  解析 X-Club-Token（不拦，只标注身份）
 ↓  ⑧ 业务路由            /clubs · /applications · /decision · /ml ...
 ↓  ⑨ /api/v1/dict       前端字典
 ↓  ⑩ 静态 SPA + fallback
 ↓  ⑪ 404
 ↓  ⑫ 错误中间件
响应
```

### 3.2 知识点：中间件与"洋葱模型"

Express 的中间件就是一个函数 `(req, res, next) => {}`。调 `next()` 表示"交给下一个"。

```
        ┌───── basicAuth ─────┐
        │   ┌─ 权限 ─┐         │
  req → │   │        │ → 业务  │ → res
        │   └────────┘         │
        └──────────────────────┘
```

**知识点：顺序就是安全边界**

`app.use()` 的注册顺序 = 执行顺序。所以：

> **凡是"必须拦住所有人"的东西，必须注册在最前面。**

如果 `basicAuth()` 写在业务路由之后，那么请求会先被业务路由处理完，密码保护形同虚设。这类漏洞在真实项目里出过很多次。

同理，`requireCapability` 必须在路由处理函数之前。

### 3.3 知识点：为什么 /healthz 要豁免

```js
function authRequired(req) { return req.path !== '/healthz'; }
```

**健康检查**是给运维/负载均衡用的探针：它需要**在没有任何凭据的情况下**判断"进程还活着吗"。

如果 healthz 也要密码：
- Docker 的 `HEALTHCHECK` 会一直失败 → 容器被反复重启
- 云平台的探活会判死

所以标准做法是：**healthz 极简、免认证、不查数据库**（我们连 SQL 都不执行，直接返回 `{status:"ok"}`）。

### 3.4 知识点：SPA fallback 与"404 的边界"

```js
app.get(/^\/(?!api|uploads|healthz|portal\.html).*/, (req, res) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});
```

**为什么要 fallback**：Vue 用的是 History 模式，URL 形如 `/clusters`、`/match/123`。这些路径**在服务器上没有对应文件**——是前端路由在管。如果服务器直接 404，用户刷新页面就白屏了。

**为什么要排除 `api|uploads|healthz`**：否则一个写错的 API 路径会被"回"一个 HTML 页面，前端拿到 200 但内容是 HTML，解析 JSON 失败 → 报错信息完全误导。**这是排查时最浪费时间的一类问题。**

### 3.5 知识点：错误中间件的四个参数

```js
app.use((err, req, res, next) => { ... });   // ← 必须是 4 个参数
```

Express 靠**参数个数**区分"普通中间件"和"错误处理中间件"。少写一个 `next`，它就会被当成普通中间件，**永远不会被调用**。

### 3.6 知识点：Express 4 不会捕获 async 异常

```js
router.get('/x', async (req, res) => {
  throw new Error('boom');     // ← 不会进错误中间件！
});
```

Express 4 只捕获**同步**抛出的异常。async 函数返回的是一个 Promise，如果它 reject 了：

- 请求**一直挂着**（客户端看到的是超时，而不是 500）
- Node 打印 `UnhandledPromiseRejection`

引入 ML 之后匹配接口必须是 async，所以加了包装器：

```js
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
```

**这是本项目 ML 改造时踩到的真实坑**——`/resumes/:id/match-top` 一开始用的是普通 handler，出错时前端卡死 15 秒（axios 超时）才报错。

### 3.7 学生端的链（刻意做短）

```
请求
 ↓ json / urlencoded
 ↓ /healthz
 ↓ /api/v1 → studentRoutes（5 个接口白名单，其余 404）
 ↓ /            → portal.html
 ↓ /portal.html  → 同一个文件
 ↓ /portal-adapter.js
 ↓ 404
 ↓ 错误中间件
```

**没有 `/uploads`**：学生端物理上不挂载附件目录。**攻击面越小的站点越安全**，这是"能用就行"的反面——这里刻意选择了"能不给就不给"。

---

<a id="四"></a>
## 四、认证三层：你能进、你是谁、你能改什么

```
第 1 层  Basic Auth       →  能不能进这个系统        （全站一个密码）
第 2 层  社团账号 token    →  你是哪个社团的谁         （每社团多账号）
第 3 层  能力 + 归属       →  这一下能不能改这条数据   （RBAC + 本社团校验）
```

### 4.1 知识点：401 和 403 的区别

| 状态码 | 含义 | 本项目的场景 |
|---|---|---|
| **401** Unauthorized | **没认证**（或认证失效） | 没带密码 / token 过期 |
| **403** Forbidden | **认证了，但没权限** | 观察员去点"录用"；别社团账号读我的简历库 |

这个区分对前端很重要：401 应该弹登录框，403 应该提示"你无权操作"。

### 4.2 知识点：HTTP Basic Auth 到底是什么

```
客户端把 "用户名:密码" 做 Base64，放进请求头：
Authorization: Basic YWRtaW46cGFzcw==
```

**必须强调的三件事**：

1. **Base64 不是加密**，只是编码。任何人 Base64 解码就能看到明文
2. 所以**必须配合 HTTPS**，否则密码在网络上是裸奔的
3. 它是**浏览器原生弹窗**，没有登出按钮（要关浏览器或清缓存）

**为什么本项目还用它**：它是一层"总门禁"，成本极低、零代码。真正的身份靠第 2 层。

### 4.3 知识点：口令不能存明文 —— scrypt + 盐 + 恒定时间比较

**① 为什么不能存明文**：数据库一旦泄露，所有账号直接沦陷。

**② 为什么要"盐"（salt）**：

```
不加盐：两个人密码都是 123456 → 哈希值相同 → 一眼看出"这两个人密码一样"
        而且黑客可以预先算好"常用密码 → 哈希"的对照表（彩虹表），直接反查
加盐  ：每个账号一个随机盐，即使密码相同，哈希也不同
```

**③ 为什么用 scrypt 而不是 MD5/SHA256**：

| 算法 | 特点 |
|---|---|
| MD5 / SHA256 | **快**——这对密码是缺点，黑客一秒能试几十亿次 |
| **scrypt** | **故意慢**，且吃内存。单次约几十毫秒，暴力破解成本急剧上升 |

**知识点：慢哈希（slow hash）**
> 密码哈希的设计目标是"验证一个人只要 50ms，暴力猜十亿个要几百年"。
> 所以 bcrypt / scrypt / argon2 这类算法会**故意消耗时间与内存**。

**④ 知识点：恒定时间比较（timingSafeEqual）**

```js
if (expected.length !== actual.length) return false;
return timingSafeEqual(expected, actual);
```

普通字符串比较 `a === b` 在**第一个不同的字符处就返回**，所以比较耗时与"前多少个字符相同"相关。攻击者可以逐位试探，通过响应时间推断密码——这叫**时序侧信道攻击**。

`timingSafeEqual` 无论内容如何都花固定时间。

### 4.4 知识点：为什么用自定义头 X-Club-Token

这是本项目一个具体的、踩过坑的决定。

```
Basic Auth 用：Authorization: Basic xxx
如果把社团 token 也放：Authorization: Bearer xxx   ← 冲突！
```

**后果**：前端 JS 显式设置 `Authorization` 会**覆盖**浏览器自动附加的 Basic 凭据。一旦同时启用两层，所有请求都会 401，而且报错信息完全指不到原因。

解法：社团 token 用**独立的自定义头** `X-Club-Token`，两者互不干扰。同时保留 `Authorization: Bearer` 的解析，方便 curl 调试。

**知识点：自定义请求头**
> HTTP 头名不受限制（约定俗成的之外），`X-` 前缀是"非标准头"的传统命名。
> 用自定义头的代价是：**跨域时需要服务端显式允许**（CORS 的 `Access-Control-Allow-Headers`）。

### 4.5 知识点：RBAC 与"前端隐藏 + 后端拦截"双保险

```
角色 → 能力矩阵（唯一事实来源，存在后端）
  owner        club:edit, recruitment:edit, position:edit,
               application:read, application:decide, dashboard:read, account:manage
  interviewer  application:read, application:decide, dashboard:read
  viewer       application:read, dashboard:read
```

- 前端：`can('application:decide')` 决定按钮显不显示
- 后端：`requireCapability('application:decide')` 真的拦

**为什么两边都要做**：

> 前端隐藏只是**体验优化**，不是安全措施。
> 用户可以直接构造 HTTP 请求绕过界面——所以后端必须再拦一道。

**知识点：为什么能力矩阵放在后端并下发给前端**

如果前端自己写一份权限表，两份会逐渐不一致（改了一边忘了另一边）。所以后端的 `ROLE_CAPABILITIES` 是唯一事实来源，通过 `/dict` 下发，前端只读。

### 4.6 知识点：为什么还要校验"这条数据是不是你的"

只有能力还不够。`interviewer` 有 `application:decide` 能力，但**只能决策自己社团的投递**。

```js
// URL 里没有 clubId 时，要反查这条投递属于哪个社团
requireOwnClubVia('application', 'id', 'application:decide')
```

**知识点：对象级权限（object-level authorization）**
> 也叫 IDOR（Insecure Direct Object Reference）防护。
> "你有删除权限"和"你能删这一条"是两回事。
> 大量真实漏洞都出在这里：接口校验了"已登录"，但没校验"这条数据是不是你的"。

本项目的具体实现：投递 → 岗位 → 批次 → 社团，跨三张表反查归属，一次查询完成。

### 4.7 知识点：能力 URL（capability URL）

学生端有一处**故意不做鉴权**的接口：

```
GET /api/v1/applications/:id
```

学生没有身份体系，无法鉴权。所以靠 **64 位随机（8 字节 CSPRNG）的 application id** 当凭据——只有投递成功时才会返回给本人，猜不到。

```js
// server/src/utils/id.js
`${prefix}_${randomBytes(8).toString('hex')}`   // 8 字节 = 64 位 = 16 个十六进制字符
// 例：app_f1ef1955473f18fe
```

**知识点：capability URL**
> 把"权限"编码进 URL 本身（知道链接 = 有权限）。
> 适用场景：无账号体系的一次性访问（下载链接、订单查询）。
> 风险：链接一旦泄露（分享、日志、浏览器历史）就等于泄露数据。

**为什么 64 位够用**：这是一个**在线**猜解问题——攻击者只能发 HTTP 请求，按 20 次/分钟的限流，猜中一个特定 ID 的期望时间是天文数字。64 位对"不可被离线爆破"的场景是够的。
但要知道**边界**：64 位低于 bearer token 的推荐值（128 位）。如果将来学生端要承载更敏感的数据，应把 `genId` 的随机字节数提到 16。

> **这是本项目明确记录的已知局限。**

---

<a id="五"></a>
## 五、主线一：学生投递（全公开链路）

### 5.1 时序

```
学生手机 :3001
  │
  ├─ GET /api/v1/clubs?page=1&pageSize=100
  │     → listClubs() → SELECT ... WHERE is_visible=1
  │     → 返回 2 个社团（无任何投递者信息）
  │
  ├─ GET /api/v1/clubs/:id
  │     → getClubDetail() → 社团 + 批次 + 岗位
  │     → 前端据此渲染"可投递岗位"（含名额、是否招满）
  │
  ├─ POST /api/v1/resumes
  │     → ① 限流：同 IP 每分钟最多 20 次
  │     → ② multer 收附件（10MB、扩展名白名单）
  │     → ③ INSERT resume → 返回 res_xxx
  │
  ├─ POST /api/v1/positions/:id/applications
  │     → 校验岗位存在、简历存在、typeTag 合法
  │     → INSERT application (status='new', decision='')
  │     → UNIQUE(position_id, resume_id) 冲突 → "请勿重复投递"
  │     → 返回 app_xxx
  │
  └─ GET /api/v1/applications/:id
        → 5 张真实表 JOIN（外加一次自连接取调剂岗位）→ 返回本人简历 + 当前状态
```

### 5.2 知识点：REST 与状态码

| 动作 | 方法 | 期望状态码 |
|---|---|---|
| 查列表 | GET | 200 |
| 查单条 | GET | 200 / 404 |
| **创建** | POST | **201 Created** |
| 全量更新 | PUT | 200 |
| 局部更新 | PATCH | 200 |
| 删除 | DELETE | 200 / 204 |

本项目的 `POST /resumes` 返回 **201**，是 REST 的规范做法（表示"已创建新资源"）。

### 5.3 知识点：唯一约束是"并发下的最后一道防线"

```sql
UNIQUE (position_id, resume_id)
```

前端可能做了防重点击，但那挡不住：
- 用户开了两个标签页
- 网络重试导致重复请求
- 直接构造请求

**数据库层面的唯一约束是唯一可靠的手段**。代码里捕获 `UNIQUE` 错误并翻译成友好提示：

```js
if (String(e.message).includes('UNIQUE')) throw badRequest('该简历已投递过此岗位');
```

**知识点：把底层错误翻译成用户语言**
> 不要把 `SQLITE_CONSTRAINT_UNIQUE` 直接甩给用户。也不要在翻译时丢掉原始信息——日志里要留全。

### 5.4 知识点：限流（rate limiting）

学生端是公开站点，没有身份体系，必须挡住脚本刷。

```js
rateLimit({ windowMs: 60_000, max: 20 })
```

**知识点：固定窗口计数**
> 最简单的一种限流：按 IP 计数，60 秒窗口内超过 20 次就返回 429。
>
> 已知缺陷：**边界突刺**——在窗口切换的瞬间可能放过两倍的量。
> 更严谨的方案是滑动窗口或令牌桶，但对这个量级没必要。

返回 **429 Too Many Requests**，并带 `Retry-After` 头告诉客户端多久后重试。

**知识点：限流的计数存哪**
> 本项目存在**进程内存**里（`Map`）。重启归零，多实例时各算各的。
> 单进程部署完全够用；要精确就得放 Redis。

### 5.5 知识点：文件上传的安全要点

```js
limits: { fileSize: 10 * 1024 * 1024 }                  // ① 大小上限
const ALLOWED_EXT = ['.pdf','.png','.jpg','.jpeg','.webp','.doc','.docx'];  // ② 扩展名白名单
const safe = basename.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);    // ③ 文件名净化
```

**① 大小上限**：防止有人传 4GB 文件把磁盘占满。

**② 扩展名白名单**（而不是黑名单）：黑名单永远漏（`.php` 之外还有 `.phtml`、`.php5`…）。白名单是"只允许这几个"。

> **局限要说清**：扩展名可以伪造。真正的防线是**不要让学生端能执行上传的文件**——本项目把 `uploads/` 挂在 `/uploads` 下做静态服务，且不与任何可执行路径重合，所以风险可控。

**③ 文件名净化**：`../../etc/passwd` 这种名字如果直接落盘会写到目录外面——这叫**路径穿越（path traversal）**。所以只保留字母数字中文下划线，再加时间戳+随机数保证唯一。

### 5.6 知识点：为什么"换浏览器不丢数据"

学生端只把 `app_xxx` 存进 localStorage，简历内容全在服务器。所以：
- 换浏览器 → 看不到历史列表（因为 localStorage 是浏览器本地的）
- 但**数据一条都不会丢**（都在 SQLite 里）

**知识点：localStorage 是浏览器本地存储**
> 按域名隔离、永不过期（除非清除）、不参与 HTTP 请求。
> 它**不是**服务器数据，用户清缓存就没了。所以只能存"索引"，不能当数据源。

### 5.7 本项目的已知局限

> 学生端**无法阻止冒名投递**——谁都能填任何人的名字投简历。
> 根治需要接校园统一认证（学号 + 短信/统一登录），这是 M5 未完成的部分。
> 现在作为补偿：学生端只暴露 5 个接口、不挂附件目录、写入限流。

---

<a id="六"></a>
## 六、主线二：社团决策（登录后的写链路）

### 6.1 一次"录用"到底发生了什么

```
PATCH /api/v1/applications/:id/decision  { decision: 'hired' }
  │
  ├─ ① requireApplicationClub('application:decide')
  │      → 解析 token → 查能力 → 反查这条投递属于哪个社团 → 比对
  │
  ├─ ② setDecision() 校验
  │      → decision 必须合法
  │      → 如果是 waitlist：分配序号（同岗位唯一性检查）
  │      → 如果是 adjust：目标岗位必须同社团且不是当前岗位
  │
  ├─ ③ 开启事务，做两件事：
  │      a) 写决策层：decision='hired', decided_at, decided_by
  │      b) 驱动状态机：transitionStatus(id, 'admitted')
  │             → 白名单校验（new → admitted 会被拒！）
  │             → UPDATE status, was_admitted=1
  │             → refreshPositionFilledCount() 重算岗位已录数
  │
  └─ ④ 提交。任一步失败 → 整体回滚
```

### 6.2 知识点：事务（transaction）与 ACID

```js
const tx = db.transaction(() => { /* 多条写操作 */ });
tx();
```

**ACID 四条**：

| | 含义 | 在本项目的体现 |
|---|---|---|
| **A** 原子性 | 要么全做，要么全不做 | 决策写了但状态没转过去？不存在的 |
| **C** 一致性 | 约束始终成立 | `filled_count` 永远等于 `was_admitted=1` 的条数 |
| **I** 隔离性 | 并发事务互不干扰 | 两人同时点录用，不会互相覆盖 |
| **D** 持久性 | 提交后永久生效 | WAL + 磁盘 |

**为什么这里必须用事务**：决策和状态机是**两次写**。如果只成功一半，会出现"标了录用但流程还停在面试中"，`filled_count` 也不会更新——数据就此脏掉。

### 6.3 知识点：状态机与白名单

```js
STATUS_TRANSITIONS = {
  new:          ['screening', 'rejected', 'archived'],
  screening:    ['interviewing', 'rejected', 'admitted', 'archived'],
  interviewing: ['admitted', 'rejected', 'archived'],
  admitted:     ['archived'],
  rejected:     ['archived'],
  archived:     [],
}
```

**知识点：有限状态机（FSM）**
> 用"当前状态 + 允许的下一状态"的表格，把流程约束变成数据。
> 好处：规则集中一处、可下发给前端（下拉框里根本不会出现非法选项）、新增状态只改表。

**为什么 `new → admitted` 被禁**：一份刚投进来的简历，还没筛选、没面试，直接录用是流程漏洞。必须先走到 `screening` 或 `interviewing`。

这条规则在测试里被专门验证：

```
✅ 新收到不能直接录用（状态机拦截 400）
```

### 6.4 知识点：状态（status）与结论（decision）为什么必须分两层

这是本项目最关键的数据设计。

```
status   = 流程走到哪   new → screening → interviewing → admitted / rejected → archived
decision = 面试结论     '' / hired / waitlist / adjust / reject
```

**如果把"候补 1 号"塞进 status 会怎样**：

1. `status` 的 CHECK 约束要加值，状态机表要重写
2. `filled_count` 的统计逻辑（"status='admitted' 的人数"）会算错
3. "候补"既是流程状态又是排序结果，两种语义混在一个字段里
4. **一旦混了，标签就再也干净不回来了**——这是真实 ML 项目返工的头号原因

所以：**候补是 decision，不改 status**。这样：
- 流程状态清晰（这个人在"面试中"）
- 结论清晰（这个人是"候补"）
- 名额统计准确（候补不占名额）

### 6.5 知识点：派生字段——重算还是增量维护？

`position.filled_count`（岗位已录人数）是一个**派生数据**，它其实等于"该岗位 `was_admitted=1` 的投递条数"。

两种维护方式：

| 方式 | 做法 | 风险 |
|---|---|---|
| **增量** | 录用就 +1，撤销就 -1 | 漏减/多减一次，数据永久错，且难发现 |
| **重算** | 每次变更后 `COUNT(*)` 重算 | 多一次查询，但永远正确 |

本项目选**重算**：

```js
export function refreshPositionFilledCount(positionId) {
  db.prepare(`UPDATE position SET filled_count = (
    SELECT COUNT(*) FROM application WHERE position_id = ? AND was_admitted = 1
  ) WHERE id = ?`).run(positionId, positionId);
}
```

**知识点：为什么用 `was_admitted` 而不是 `status='admitted'`**

因为录取者后来可能被**归档**（`archived`）。如果用 `status` 判断，归档后就不再计数，岗位会"突然空出一个名额"——统计失真。

`was_admitted` 记录"**曾经**录取过"，归档不影响。

> **知识点：软状态 vs 历史事实**
> `status` 是当前状态（会变）；`was_admitted` 是历史事实（不会变）。
> 做统计要用历史事实，不要用当前状态。

### 6.6 知识点：唯一性与排序——候补序号

```sql
ALTER TABLE application ADD COLUMN waitlist_rank INTEGER;
```

**业务规则**：同一岗位内，候补序号不能重复（杜绝两个"候补 1 号"）。

**怎么保证**：不是靠数据库唯一约束（因为候补员撤销后序号会空出来），而是**业务校验 + 事务内检查**：

```js
const clash = db.prepare(
  `SELECT id FROM application WHERE position_id = ? AND decision = 'waitlist'
   AND waitlist_rank = ? AND id != ?`
).get(...);
if (clash) throw badRequest('该岗位的候补 N 号已被占用');
```

**递补为什么要重排序号**：

```
递补前：候补 1 号(张三)  2 号(李四)  3 号(王五)
把 1 号提升为录用
递补后：候补 1 号(李四)  2 号(王五)     ← 序号前移
```

**知识点：不变式（invariant）**
> "候补 1 号永远是最优先的那个人"——这个性质在任何操作后都必须成立。
> 保证方式就是每次递补后重排。如果不重排，界面上会显示"2 号、3 号"，
> 使用者会困惑"1 号去哪了"。

### 6.7 知识点：撤销录用时的"回退"

```js
} else if (!decision && row.status === 'admitted') {
  db.prepare(`UPDATE application SET status = 'interviewing', was_admitted = 0 ...`).run();
  refreshPositionFilledCount(row.position_id);
}
```

**知识点：为什么撤销要单独处理**

其他决策都是"往前走"，撤销是"往回退"。但状态机是单向白名单（`admitted` 只能到 `archived`），所以退回 `interviewing` **必须绕过状态机显式处理**，并同步把 `was_admitted` 归零、重算名额。

测试里专门验证：

```
✅ 撤销录用结论
✅ 撤销后已录数回落
```

### 6.8 知识点：调剂 = 建新投递 + 标注原投递

```
POST /applications/:id/adjust { adjustPositionId }
  → 目标岗位新建一条投递（复用 createApplication，自动去重）
  → 原投递 decision='adjust', adjust_position_id=目标
```

**为什么不直接改原投递的 position_id**：

1. 投递历史会丢失（"他当初投的是前端岗"这个事实没了）
2. 岗位的 `UNIQUE(position_id, resume_id)` 会冲突
3. 状态机、统计都按岗位维度组织，搬家会打乱

**知识点：追加（append）优于修改（mutate）**
> 保留历史事实，比覆盖它更好。
> 代价是数据量增长，但对这个规模完全不是问题。

---

<a id="七"></a>
## 七、ML 层：语义匹配是怎么跑起来的

### 7.1 先厘清一个根本问题：训练 vs 推理

```
训练（training）  ：用数据调整模型参数           ← 本项目没做，因为标注样本 = 0
推理（inference） ：用已有的模型参数算结果        ← 本项目做的是这个
```

**知识点：预训练模型的"知识"从哪来**

模型在海量通用语料上训练过，所以它**懂中文**。你的 4 份简历不需要教它中文——只需要它把中文变成向量。

**这就是"零标注也能用 ML"的原因**：

> 需要数据的是"训练"，不是"推理"。
> 你不训练它，只是使用它已经具备的语言理解能力。

### 7.2 知识点：嵌入（embedding）是什么

```
"精通 Vue 与 Node.js"  →  [0.12, -0.34, 0.88, ... ]   ← 512 个浮点数
```

**核心思想**：把一段文字映射到高维空间的**一个点**，让"意思相近的文本，点在空间里也靠得近"。

```
        ↑
        │        · "精通Vue"
        │      · "熟悉Vue3框架"      ← 聚在一起（语义相近）
        │
        │
        │                    · "会打篮球"   ← 离得远
        └──────────────────────────→
```

**为什么这比"字符串匹配"强**：

| 场景 | 字符串匹配 | 嵌入 |
|---|---|---|
| `Vue` vs `vue3` | ❌ 不同 | ✅ 相近 |
| `文案` vs `文案写作` | ❌ 不同 | ✅ 相近 |
| `海报设计` vs `视觉传达` | ❌ 不同 | ✅ 相近 |

本项目实测（`server/scripts/verify-ml.mjs`）：

```
人工标签：文案,活动组织,沟通
自动抽取：活动组织、活动策划、文案写作    ← 语义把「文案」泛化成了「文案写作」
```

### 7.3 知识点：余弦相似度

```
                A·B
cos(A,B) = ───────────
            ‖A‖ · ‖B‖
```

**几何意义**：两个向量的**夹角**余弦。夹角越小（越同向）越相似，取值 -1 ~ 1。

**为什么不用欧氏距离**：

> 文本长度会影响向量的"长度"（模长）。用距离会混入"长度差异"这个无关因素；
> 用夹角则只关心**方向**——方向才代表语义。

**关键优化**：模型输出时已经做了 `normalize`（单位化），所以 `‖A‖ = ‖B‖ = 1`：

```
cos(A,B) = A·B       ← 余弦相似度退化为点积，算起来更快
```

### 7.4 知识点：为什么必须做"校准"（本项目最大的一个坑）

**现象**：bge 这类模型对**任意**两段中文短文本都给出 0.4~0.5 的余弦。

```
「精通Vue」 vs 「会打篮球」   →  0.5020    ← 完全无关，却有 0.5！
「精通Vue」 vs 「熟悉Vue3」   →  0.7479    ← 真正相关
```

**如果直接乘 100**：

- 无关 → 50 分
- 相关 → 75 分

界面上所有匹配都挤在 50~75，**用户完全看不出差别**。

**知识点：分数标定（calibration）**

> 模型的原始输出（logits / 余弦）只是"相对可比较"，不是"绝对可解释"。
> 要让它变成人能读的分数，需要按实测分布做**线性映射**。

本项目的映射（实测后确定）：

```
[0.46, 0.75] → [0, 100]

无关 0.4848 → 8        相关 0.6908 → 79
弱相关 0.6209 → 55     强相关 0.7479 → 99
```

**教训**：我最初把上限设成 `0.82`——但实测最高只到 0.7479，这个上限**永远达不到**，导致所有分数被压到 70 以下。**这类错误只有实测才能发现**，所以参数写成了环境变量 `ML_CALIB_MIN/MAX`，换模型必须重标。

### 7.5 知识点：混合打分（为什么不是纯语义）

```js
score = 0.6 × 语义分 + 0.4 × 标签命中率     // 岗位有技能要求时
score = 语义分                              // 岗位没写技能要求时
```

**为什么不全用语义**：

1. **可解释性**：招新必须能回答"为什么录取他"。"命中 vue / 缺 html" 是能解释的，"语义 79 分"不能单独解释
2. **语义会把"普遍相似"当成"匹配"**：所有简历都是"学生写的简历"，天然有相似度
3. **标签是人工确认过的信号**，精度高，不该丢

**知识点：模型融合（ensemble）**
> 多个信号按权重合成，比单一路径稳。
> 权重 0.6/0.4 是经验值，需要数据调优——本项目样本太少，先取了这个保守值。

### 7.6 知识点：缓存与失效

```
一次匹配要编码：1 份简历 + N 个岗位
每次请求都跑模型 → 太慢，且浪费
```

**两级缓存**：

```
① 内存 Map          （最快，进程内）
② embedding_cache 表（重启后仍有效）
```

**失效策略：内容哈希**

```js
const hash = sha1(text);          // 文本变了，哈希就变
if (row.text_hash === hash) { 用缓存 } else { 重算 }
```

**知识点：为什么用"内容哈希"而不是"更新时间"**

> 时间戳只能告诉你"改过"，不能告诉你"内容真的不同"。
> 存一次空操作（update 但内容没变）就会让缓存白白失效。
> **哈希精确描述内容**，是缓存的正确键。

**性能**：单条编码约 **2ms**，命中缓存 **0ms**。缓存表里 512 维向量用 Float32 + base64 存，一条约 2.7KB。

### 7.7 知识点：降级设计（fail-open vs fail-closed）

```js
if (!ML_ENABLED || !isReady()) {
  return ruleBasedResult();     // 模型不可用 → 走规则
}
```

**知识点：降级（graceful degradation）**
> 系统能力分主次。次要能力出问题时，退化到更简单但仍可用的路径，
> 而不是整体失败。

**为什么这里选 fail-open**：匹配只是"建议"，**不参与任何写操作**。模型挂了顶多是分数不准，绝不该让整个系统不可用。

**对比**：如果是"鉴权"模块挂了，就必须 **fail-closed**（拒绝所有请求），因为放行等于开门。

> **判断标准**：这个能力失败时，"继续"和"停止"哪个后果更严重？

### 7.8 知识点：无监督聚类（K-means）

**要解决的问题**：40 份投递，怎么快速看出"有哪几类人"？

**K-means 算法**（三步循环）：

```
① 随机/启发式选 k 个中心点
② 每个点分配给最近的中心 → 形成 k 个簇
③ 每个簇的中心移到簇内点的平均位置
   重复 ②③ 直到不再变化
```

**知识点：K-means++ 初始化**

纯随机选初始中心有个大问题：**可能两个中心落得很近**，导致最后有个簇是空的（退化）。

K-means++ 的做法：**第一个中心随机选，之后每个中心按"离已有中心的距离平方"加权抽取**——距离越远越容易被选中。这样初始中心天然分散。

**知识点：如何选 k**

本项目用**轮廓系数（silhouette coefficient）**：

```
对每个点：
  a = 它到"同簇其它点"的平均距离   （内聚度，越小越好）
  b = 它到"最近的其他簇"的平均距离 （分离度，越大越好）
  s = (b - a) / max(a, b)          → -1 ~ 1

全局取平均。越接近 1 说明"簇内紧、簇间远"，分得越清晰。
```

- `s ≥ 0.5` → 分组清晰
- `s ≈ 0.25` → 勉强可分
- `s ≈ 0` → 这批人本身同质，分不出类别（**这也是有价值的结论**）
- `s < 0` → 分错了

### 7.9 知识点：小样本下聚类为什么会"假好"

**坑**：如果 `k` 接近样本数 `n`，几乎每个点自成一簇。此时：

- 内聚度 `a ≈ 0`（簇里只有自己）
- 轮廓系数可能算出 **1.0**

**这是假象**——它不代表"分得好"，只是"没得分"。

**本项目的保护**（写代码时才发现的问题）：

```js
const MIN_N = 6;
if (rows.length < MIN_N) return { clusters: [], reason: '人数太少，聚类没有统计意义' };

const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));  // k ≤ n/2
```

实测对比（同一份 4 人数据）：

| 保护前 | 保护后 |
|---|---|
| `k=6, silhouette=1`（假象） | 直接拒绝聚类，提示"人数太少" |
| `k=2, silhouette=0.0687` | `k=2, silhouette=0.2227`（合理） |

**知识点：算法在小样本上会退化成"教科书没写的形态"**
> 论文里的 K-means 假设 n 足够大。工程上必须显式处理 n 很小的情况，
> 否则它会给你一个看起来很好、实则无意义的数字。

### 7.10 知识点：精确率 vs 召回率（技能抽取的双路径）

| 路径 | 方法 | 特点 |
|---|---|---|
| **词典精确匹配** | 正文里出现了词表里的词 | **精确率高**（不会乱标），召回率低（换种说法就漏） |
| **语义近邻** | 正文向量与词表向量余弦 ≥ 0.62 | **召回率高**（同义表述能抓到），精确率低（可能误标） |

本项目**两条都跑，结果合并，并标注来源**（`source: 'exact' | 'semantic'`），界面上用实心/空心标签区分，并提示"语义标签可能有误，请人工核对"。

**知识点：为什么不干脆只用语义**
> 因为误标比漏标更糟——它会让筛选依据失真。
> 把"确定"和"推测"分开呈现，让人自己判断，是更负责的做法。

### 7.11 本项目的 ML 边界（必须说清）

| 没做的事 | 原因 |
|---|---|
| 录取概率预测 | 标注样本 = 0，做了就是造假 |
| 学习排序（LTR） | 同上，且标签受名额约束影响，不是真实偏好 |
| 微调模型 | 没有数据，且会过拟合到 4 份简历 |

**这是"预训练推理"而非"训练模型"。** 对外不能说"训练了一个匹配模型"。

---

<a id="八"></a>
## 八、公网链路：内网穿透到底发生了什么

### 8.1 为什么需要它

```
你的电脑：私网 IP（192.168.x.x / 10.x.x.x），运营商 NAT 后面
外网：只有运营商的一个公网 IP，且不给你做端口映射
```

**知识点：NAT（网络地址转换）**
> 运营商让成百上千用户共用一个公网 IP，靠端口区分。
> 所以你在家里"监听 3000 端口"，外网是**看不到**的——没有到你家 3000 的路由。

**内网穿透的原理**：既然外面进不来，就让里面的程序**主动连出去**，建立一条长连接；外面的请求顺着这条连接**反向**送进来。

```
cpolar.exe（你电脑）──主动长连接到──→ cpolar 云端（有公网 IP:443）
                                        ↑
                                    学生手机访问
                                  https://xxx.cpolar.cn
                                        ↓
                              云端把请求顺着长连接送回你家
```

**知识点：反向连接**
> 不需要公网 IP、不需要路由器端口映射、不需要动防火墙入站规则。
> 代价：延迟多一跳，且依赖隧道服务商。

### 8.2 为什么这台机器还需要代理

```
cpolar.exe 要连 cpolard.cpolar.com:4443
  ↓ 但本机直连不稳定
  ↓ 所以 start-with-proxy.ps1 里设了：
ALL_PROXY = socks5://127.0.0.1:7897
HTTPS_PROXY = http://127.0.0.1:7897
  ↓ 走 Clash
  ↓ 所以：Clash 没开 → 隧道必断
```

**这是本项目最脆弱的一环**：日志里曾出现整天的

```
dial tcp 127.0.0.1:7897: connectex: No connection could be made
because the target machine actively refused it
```

翻译：**Clash 没启动，cpolar 连不上**。所以"网站打不开"的第一排查项不是代码，是代理。

### 8.3 知识点：401 / 404 / 502 怎么区分问题

排查公网访问时，状态码能直接指出问题在哪一层：

| 看到 | 含义 | 问题在哪 |
|---|---|---|
| **404 + HTML 里写 "domain doesn't exist"** | 隧道断了 | cpolar 边缘不认识这个域名 → 隧道没连上 |
| **401** | 服务通了，但要密码 | ✅ 正常（社团端本来就要密码） |
| **200** | 一切正常 | — |
| **502 / 504** | 隧道通了，但后端没响应 | 应用没起来 / 端口不对 |
| **连接被拒绝** | 本机端口没监听 | 进程没启动 |

> **这是最省时间的技能**：先看状态码定位层级，再看日志。
> 本项目写了个 `deploy/doctor.sh` 把这套判断自动化了。

### 8.4 知识点：免费隧道的代价——域名会变

```
每一次重连 → cpolar 随机分配一个二级域名
```

本会话里就变过三次：

```
12d78ad2.r6.cpolar.top          （已 404）
2c14a503.r11.vip.cpolar.cn      （当前学生端）
72448697.r6.cpolar.top          （当前社团端）
```

**为什么**：免费版不保证域名，按连接动态分配。要固定必须购买保留域名。

**工程量化的影响**：每次隧道重启都要重新通知学生地址 → 这对招新是致命的。

> 这也是为什么我一直建议：**长期用必须上云服务器**（固定 IP），隧道只适合应急。

### 8.5 自启为什么用"启动文件夹"而不是计划任务

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\community-cpolar.cmd
```

**踩过的坑**：

```
Register-ScheduledTask -AtLogOn  →  Access is denied
```

`-AtLogOn` 触发器需要管理员权限（因为它可能影响其他用户）。普通会话下注册会失败。

**为什么"启动文件夹"可以**：

> 它就是个普通目录，登录时 Windows 自动执行里面的 `.cmd`/`.lnk`。
> **不需要任何提权**，也不需要动系统配置。

顺带修了一个更隐蔽的问题：脚本如果在前台跑 cpolar，**计划任务一结束，子进程会被一起回收**（表现为"任务显示成功，但隧道没起来"）。所以改用 `Start-Process` **分离启动**。

**知识点：进程的生命周期归属**
> 子进程默认跟父进程"同生共死"（在作业对象/控制台组里）。
> 要让它独立存活，必须显式"分离"（detach）。

---

<a id="九"></a>
## 九、一次请求的完整走查

以**"面试官在公网点了『录用』"**为例，走完全部层次：

```
① 手机/浏览器
   PATCH https://72448697.r6.cpolar.top/api/v1/applications/app_xxx/decision
   Headers: Authorization: Basic YWRtaW46...（浏览器缓存的密码）
            X-Club-Token: 7d17dba7...（登录时拿到的）
   Body:    { "decision": "hired" }

② DNS + 网络
   → 解析到 cpolar 边缘服务器
   → 校园网/运营商 → cpolar 云端

③ cpolar 云端
   → 查隧道表：这个域名 → 哪条长连接
   → 顺着长连接把请求推回你电脑上的 cpolar.exe

④ 本机 cpolar.exe
   → 转发到 127.0.0.1:3000

⑤ node 进程（社团端 app）
   → trust proxy：读 X-Forwarded-For
   → express.json：解析 Body
   → basicAuth：Base64 解码 → 恒定时间比较 → 通过
   → /healthz /uploads /portal.html：都不匹配
   → optionalAccount：解析 X-Club-Token
        → 查 club_session → 校验 expires_at → 查 club_account
        → req.account = { id, clubId, role:'owner', capabilities:[...] }

⑥ 路由匹配
   → /api/v1/applications/:id/decision  →  decisionRoutes

⑦ 中间件链
   → requireApplicationClub('application:decide')
        a) 有 token？     → 有
        b) 能力够？       → owner 有 application:decide ✅
        c) 反查归属：
             application → position → recruitment → club_id
             比对 account.clubId  → 一致 ✅
   → asyncHandler 包裹（Promise reject 也能进错误中间件）

⑧ service 层（decisionService.setDecision）
   → loadApplicationClub：确认投递存在
   → assertClubScope：再校验一次归属（服务层的自防御）
   → 校验 decision 合法性
   → 校验状态机：当前 status 是否允许 → admitted
        status='interviewing' → 允许 ✅
        （若是 'new' → 抛 400）

⑨ 事务
   BEGIN
   a) UPDATE application SET decision='hired', decided_at, decided_by
   b) UPDATE application SET status='admitted', was_admitted=1
   c) UPDATE position SET filled_count = (
        SELECT COUNT(*) FROM application
        WHERE position_id=? AND was_admitted=1)
   COMMIT

⑩ 返回
   → getDecisionDetail：5 表 JOIN 读回完整状态
   → { code:0, data:{ status:'admitted', decision:'hired', position:{filledCount, remaining} } }
   → JSON → cpolar → 浏览器

⑪ 前端
   → axios 响应拦截：code===0 → 返回 data
   → 刷新看板：卡片从"面试中"移到"已录取"
   → 若岗位已满 → 卡片显示"已招满"
```

**这条链上有 6 个"拦截点"**，任何一处不通过都会提前返回：

```
Basic Auth  →  账号解析  →  能力校验  →  归属校验  →  状态机校验  →  数据库约束
```

---

<a id="十"></a>
## 十、常见误解与答疑

**Q1：为什么"匹配度 88%"? 是 88% 会被录取吗？**
不是。88 只表示"这人的简历文本与岗位要求在语义上比较接近"。它是**相似度**，不是**概率**。录取概率需要历史数据训练，本项目没有。

**Q2：为什么同一岗位昨天 100 分，今天 88 分？**
因为匹配算法从"标签命中率"换成了"语义 60% + 标签 40%"的混合分。现在界面上会拆开显示两个子分，并标明当前模式。

**Q3：为什么学生端不需要密码？那不就是谁都能进？**
对，**谁都能进**——这是设计目标（学生必须能自助投递）。作为补偿：
- 只暴露 5 个白名单接口，其余 404
- 不挂载简历附件目录
- 写接口限流 20 次/分钟
- 看不到任何其他人的简历

**Q4：为什么改密后要重新登录？**
`changeOwnPassword` 会 `DELETE FROM club_session WHERE account_id=?`。这是安全要求：密码泄露后改密，必须让旧会话立即失效。

**Q5：为什么删除社团要求登录，但创建社团不要求？**
创建是"自服务开通"（新用户没有账号，拦住就进不来）。删除会**级联清空**该社团的所有批次、岗位、投递——必须验证归属。

**Q6：数据库文件可以直接拷贝备份吗？**
**不能只拷 `club.db`**。WAL 模式下最新写入可能还在 `club.db-wal` 里，单独拷主文件会丢数据。正确方式：
- 用 `sqlite3 club.db ".backup out.db"`（在线一致性备份）
- 或同时拷 `club.db` + `club.db-wal` + `club.db-shm`
- 或先 `PRAGMA wal_checkpoint(TRUNCATE)` 再拷

本项目的导出脚本就是这么做的。

**Q7：为什么测试有 166 项这么多？**
因为每个"拦截点"都要验证：权限、归属、状态机、唯一性、降级路径。
**改动越大，越需要测试兜底**——这轮 ML 改造就靠测试抓出了两个真实 bug：
- `/ml/status` 被同名路由抢先匹配
- 启用 Basic Auth 后整套测试全挂

**Q8：为什么不直接把整个系统重写成 ML 架构？**
因为**大部分模块没有 ML 的位置**：认证、CRUD、状态机、UI、部署。硬套只会增加复杂度、降低可维护性，并不带来任何智能。真正该用 ML 的只有"匹配"这一层，也只重写了这一层。

---

## 附录：关键文件地图

| 想知道什么 | 看哪个文件 |
|---|---|
| 启动顺序 | `server/src/index.js` |
| 社团端装配（中间件顺序） | `server/src/apps/clubApp.js` |
| 学生端装配（白名单） | `server/src/apps/studentApp.js` |
| 学生端接口白名单 | `server/src/routes/studentRoutes.js` |
| 认证与角色能力 | `server/src/services/authService.js` |
| 权限中间件 | `server/src/middlewares/clubAuth.js` |
| 状态机与归档 | `server/src/services/applicationService.js` |
| 录用/候补/调剂/递补 | `server/src/services/decisionService.js` |
| 匹配（分发层） | `server/src/services/matchService.js` |
| 语义匹配与校准 | `server/src/ml/semanticMatchService.js` |
| 嵌入模型与缓存 | `server/src/ml/embeddingService.js` |
| 技能抽取 | `server/src/ml/skillExtractor.js` |
| 聚类 | `server/src/ml/clustering.js` |
| 建表/升级 | `server/db/migrations/*.sql` |
| 端到端测试（166 项） | `server/scripts/smoke-club-console.mjs` |
| 部署自检 | `deploy/doctor.sh` |
