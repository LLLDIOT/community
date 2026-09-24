# 社团招新系统 · 新手完全指南

> 面向第一次接触本项目的同学：从"这是个什么东西"讲到"数据怎么流动""部署在哪台机器上"。
> 阅读顺序建议：第 1 节 → 第 2 节（结构图）→ 第 3 节（时序图）→ 第 4 节（数据流）→ 第 5 节（部署）。

---

## 1. 先用生活比喻认识它

把整个系统想象成一个**招新市场**：

| 系统里的东西 | 现实中的对应物 | 一句话解释 |
|---|---|---|
| **学生端**（`portal.html`） | 市场里学生手里的**手机** | 学生用它看社团、填表、交表 |
| **管理端**（Vue 页面） | 社团办公室里的**电脑** | 管理员用它看谁交了表、决定录不录 |
| **后端 API**（Express） | 中间的**服务台/邮局** | 两边都不直接对话，所有事都交给它办 |
| **数据库**（SQLite） | 服务台后面的**档案柜** | 表格交上来就锁进柜子，永不丢失 |
| **前端/后端** | 门面 / 后厨 | 前端=你看到和点的界面；后端=真正干活和记账的地方 |

**为什么要分"前端/后端"？**
因为界面会变（换手机、换电脑、换成小程序），但"谁被录取了""社团招了几个人"这些规则和数据不能乱。分开之后，改界面不影响数据规则，改规则也不用重画界面。

---

## 2. 结构图（系统长什么样）

结构图回答的问题是：**这个系统由哪几块拼成，谁跟谁说话。**

### 2.1 整体结构图

```mermaid
flowchart TB
    subgraph 用户["使用者"]
        S["👨‍🎓 学生<br/>（用手机）"]
        A["🧑‍💼 社团管理员<br/>（用电脑）"]
    end

    subgraph 前端["前端（浏览器里运行的界面）"]
        P["学生端 H5<br/>portal.html<br/>+ portal-adapter.js 适配层"]
        M["管理端 SPA<br/>Vue3 + Element Plus + ECharts"]
    end

    subgraph 后端["后端（一台机器上跑的程序）"]
        R["路由层 routes/<br/>接收请求、分发"]
        SV["服务层 services/<br/>业务规则 + 读写数据库"]
        MW["中间件<br/>basicAuth 门禁<br/>upload 文件接收"]
    end

    DB[("数据库<br/>club.db<br/>SQLite 单文件")]
    FS[("文件仓库<br/>uploads/<br/>简历附件")]

    S -->|"填简历、投递"| P
    A -->|"看板、筛选、录取"| M
    P -->|"HTTP 请求 /api/v1/..."| MW
    M -->|"HTTP 请求 /api/v1/..."| MW
    MW --> R
    R --> SV
    SV --> DB
    SV --> FS
```

**看图要点（新手最容易搞混的）**：
- 学生端和管理端**从不直接读写数据库**。它们只会"喊话"（发 HTTP 请求），由后端决定给不给、怎么给。
- 中间件像**门卫**：`basicAuth` 检查你有没有密码，`upload` 负责接收上传的文件。
- 数据库只有一个文件（`club.db`），拷走它=备份了全部业务数据。

### 2.2 后端分层结构图

后端内部按"责任"分成三层，每层只干自己的事：

```mermaid
flowchart LR
    A["① 路由层<br/>routes/*.js<br/><br/>职责：<br/>• 取出 URL 里的参数<br/>• 调用服务层<br/>• 把结果发回去<br/><br/>✅ 不写 SQL<br/>✅ 不写业务规则"]
    B["② 服务层<br/>services/*.js<br/><br/>职责：<br/>• 业务规则（如状态不能乱跳）<br/>• 读写数据库<br/><br/>✅ 不关心 HTTP<br/>✅ 不碰 req/res"]
    C["③ 数据层<br/>db/connection.js<br/><br/>职责：<br/>• 打开数据库文件<br/>• 建表/升级表结构"]

    A --> B --> C
```

**为什么这样分？（新手必读）**
假设以后要做手机 App，只需要重写"路由层"（换成 App 能听懂的格式），服务层的规则和数据库完全不用动。
反过来，如果"招新人数不能少于已录取数"这条规则要改，只改服务层一处，前端、App、后台脚本全都自动生效。

### 2.3 前端结构图

```mermaid
flowchart TB
    subgraph 管理端["管理端（Vue 单页应用）"]
        L["MainLayout.vue<br/>左侧菜单：数据看板 / 社团端"]
        V1["DashboardView<br/>数据看板"]
        V2["ClubListView<br/>社团列表"]
        V3["ClubDetailView<br/>社团详情+批次+岗位"]
        V4["ApplicationLibraryView<br/>简历库（核心）"]
        V5["MatchView<br/>智能匹配"]
        API["api/client.js<br/>统一的请求工具"]
        L --- V1 & V2 & V3 & V4 & V5
        V1 & V2 & V3 & V4 & V5 --> API
    end

    subgraph 学生端["学生端（免构建的单文件网页）"]
        PH["portal.html<br/>页面与交互"]
        PA["portal-adapter.js<br/>适配层"]
        PH --> PA
    end

    API -->|"fetch/axios"| BE["后端 :3000"]
    PA -->|"fetch"| BE
```

**"适配层"是什么？**
学生端原本是一个独立做的原型，它期望的数据格式（字段名）和后端给的不一样。
适配层就是**翻译官**：后端说 `description`，适配层翻译成原型认识的 `intro`；后端说 `positions[].title`，翻译成 `name`。
好处是：**后端一行都不用改**，学生端就能用真实数据。

---

## 3. 时序图（事情是按什么顺序发生的）

时序图回答的问题是：**从头到尾，谁先动、谁后动、传了什么。**

### 3.1 学生投递简历（最核心的流程）

```mermaid
sequenceDiagram
    autonumber
    actor S as 学生
    participant P as 学生端页面
    participant AD as 适配层
    participant API as 后端 API
    participant DB as SQLite

    Note over S,DB: 阶段一：打开页面
    S->>P: 打开 /portal.html
    P->>AD: listClubs()
    AD->>API: GET /api/v1/clubs
    API->>DB: SELECT * FROM club
    DB-->>API: 社团数据
    API-->>AD: {code:0, data:{list:[...]}}
    AD->>AD: 翻译字段 + 生成简历模板
    AD-->>P: 可直接渲染的社团列表

    Note over S,DB: 阶段二：选岗位
    S->>P: 点进"计算机协会"
    P->>AD: getClub(id)
    AD->>API: GET /api/v1/clubs/:id
    API->>DB: 查社团+批次+岗位
    DB-->>API: 嵌套结构
    API-->>AD: recruitments[].positions[]
    AD->>AD: 拍平成岗位列表（带剩余名额）
    AD-->>P: 显示可选岗位
    S->>P: 选择一个岗位并点"我要投递"

    Note over S,DB: 阶段三：填写简历
    P->>P: 第1步 自动带出学生档案
    S->>P: 第2步 补全内容
    S->>P: 第3步 选择"整理规则"（可选）
    P->>P: 只规范格式+给出建议（不改写事实）
    S->>P: 第4步 确认投递

    Note over S,DB: 阶段四：真正落库（关键）
    P->>AD: apply({社团, 岗位, 学生, 简历数据})
    AD->>API: POST /api/v1/resumes
    API->>DB: INSERT INTO resume (...)
    DB-->>API: res_xxx
    API-->>AD: 新简历 id
    AD->>API: POST /api/v1/positions/:id/applications
    API->>API: 校验岗位/简历/类型
    API->>DB: INSERT INTO application (status='new')
    DB-->>API: app_xxx
    API-->>AD: 投递记录
    AD->>AD: localStorage 只存 app_xxx 索引
    AD-->>P: 投递成功
    P-->>S: 显示回执（社团/岗位/时间）
```

**新手重点理解**：
- "投递成功"这句话之所以可信，是因为它前面真的执行了两次数据库写入（简历 + 投递）。
- 浏览器只存了一个编号（`app_xxx`），内容全在服务器上——所以**换浏览器只是看不到历史列表，数据本身不会丢**。

### 3.2 管理员处理简历

```mermaid
sequenceDiagram
    autonumber
    actor A as 管理员
    participant M as 管理端页面
    participant API as 后端 API
    participant DB as SQLite

    A->>M: 打开「简历库」
    M->>API: GET /clubs/:clubId/applications?status=&typeTag=&...
    API->>DB: 动态条件查询 + 状态分布统计
    DB-->>API: 列表 + 各状态数量
    API-->>M: {list, total, statusCounts}
    M-->>A: 表格 + 顶部统计条

    A->>M: 点姓名看详情（抽屉）
    M->>API: GET /applications/:id
    API-->>M: 简历全文 + 技能标签
    M->>API: GET /resumes/:id/match-top
    API->>API: 技能标签求交集算匹配度
    API-->>M: 推荐岗位（含命中/缺失技能）
    M-->>A: 显示匹配度与"一键转投"

    A->>M: 把状态改为"面试中"
    M->>API: PATCH /applications/:id/status {status:'interviewing'}
    API->>API: assertTransition 检查是否允许（白名单）
    alt 允许
        API->>DB: UPDATE status + reviewed_at
        DB-->>API: ok
        API-->>M: 新状态
        M-->>A: 提示成功并刷新
    else 不允许（如已归档→面试中）
        API-->>M: 400 {message:'非法的状态流转...'}
        M-->>A: 红色错误提示
    end
```

### 3.3 系统启动（后端开机自启时发生什么）

```mermaid
sequenceDiagram
    autonumber
    participant T as Windows 计划任务
    participant N as node 进程
    participant E as env 加载器
    participant D as 数据库
    participant H as HTTP 服务

    T->>N: 用户登录 → 启动 node src/index.js
    N->>E: loadEnv() 读 server/.env
    E-->>N: 密码/端口等配置
    N->>D: migrate() 检查 user_version
    alt 有新迁移文件
        D->>D: 执行 003-xxx.sql
        D-->>N: 记录版本号=3
    else 无新迁移
        D-->>N: 版本号已是最新，跳过
    end
    N->>H: app.listen(3000)
    H->>H: 检测 web/dist 是否存在
    Note over H: 存在 → 同时托管前端页面
    H-->>T: 服务就绪
```

---

## 4. 数据流详解（数据从哪来、到哪去、变成什么）

### 4.1 三种数据，去三个地方

```mermaid
flowchart LR
    subgraph 输入["数据产生的地方"]
        I1["学生填的简历内容"]
        I2["管理员改的社团资料"]
        I3["上传的 PDF 附件"]
        I4["学生档案（姓名/经历）"]
    end
    subgraph 存放["数据的家"]
        D1[("club.db<br/>resume 表 / application 表")]
        D2[("club.db<br/>club 表 / position 表")]
        D3[("uploads/ 文件夹<br/>真实文件")]
        D4[("浏览器 localStorage<br/>不是数据库！")]
    end
    I1 --> D1
    I2 --> D2
    I3 --> D3
    I4 --> D4
```

**为什么要区分 localStorage 和数据库？**
- **数据库**：所有"业务数据"（谁投了哪个岗位、社团招了几个人）——永久保存、多人共享、重启不丢。
- **localStorage**：只是**这台电脑这个浏览器**里的小本子，用来记住"我叫什么、我投过哪几份"。
  换个浏览器就空了，但服务端的数据一条都不会少。

### 4.2 一次投递，数据"变形记"

这是新手最该理解的一段：**同一份信息，在流动过程中换了三次样子。**

```
【第 1 次变形】学生在手机页面上填的（一堆输入框）
  姓名: 张三
  技术技能: Vue, Node.js
  代表项目作品描述: 二手交易平台，Vue3+Express...

        ↓ 适配层 apply() 把它拼成一段文本

【第 2 次变形】简历正文（content 字段，人可读的字符串）
  【姓名】
  张三

  【基本信息（学院/专业/年级）】
  计算机学院 · 软件工程 · 大二

  【技术技能】
  Vue, Node.js

  【代表项目作品描述】
  二手交易平台，Vue3+Express...

        ↓ POST /resumes → 后端 INSERT

【第 3 次变形】数据库里的一行（结构化字段）
  resume 表:
    id            = res_a1b2c3
    student_name  = 张三          ← 单独存，方便按姓名搜索
    skills        = Vue, Node.js  ← 单独存，用于智能匹配
    content       = "【姓名】\n张三\n\n…"  ← 整段存，用于展示
    major         = 软件工程
    grade         = 大二
  application 表:
    id            = app_x9y8z7
    position_id   = pos_前端开发干事
    resume_id     = res_a1b2c3
    status        = new           ← 新收到，等待社团处理
    type_tag      = technical     ← 从社团分类自动映射而来

        ↓ 管理端 GET /clubs/:id/applications

【第 4 次变形】管理端表格里的一行（多表拼出来的）
  张三 | 大二 | 软件工程 | 2026秋季招新·前端开发干事 | 技术型 | 新收到 | ☆☆☆☆☆
```

**新手注意**：为什么"技能"要单独存一列，而不是只留整段文本？
因为智能匹配需要**精确比对标签**（`Vue` vs `vue`），从一整段文字里猜技能不可靠。
这体现了数据库设计的一个原则：**要用来筛选/计算的字段，就单独给它一列。**

### 4.3 一条简历的完整生命周期

```mermaid
stateDiagram-v2
    [*] --> 新收到new: 学生投递 / 管理员导入
    新收到new --> 待筛选screening: 开始看
    新收到new --> 已淘汰rejected: 一眼不合适
    待筛选screening --> 面试中interviewing: 约面试
    待筛选screening --> 已录取admitted: 直接通过
    面试中interviewing --> 已录取admitted: 面试通过
    面试中interviewing --> 已淘汰rejected: 面试未过
    已录取admitted --> 已归档archived: 招新结束
    已淘汰rejected --> 已归档archived: 存入人才池
    已归档archived --> 已淘汰rejected: 取消归档（复活）
    已归档archived --> [*]
```

**两条重要规则**：
1. **不能跳步**：`新收到` 不能直接变 `已录取`（必须先经过筛选/面试），后端会拒绝并告诉你允许的下一步。
2. **归档不等于删除**：归档只是"这件事处理完了"，数据还在，随时能取消归档。

### 4.4 数据存在哪：一张地图

```
D:\GitHub库\社团\
├─ server\
│  ├─ data\
│  │  ├─ club.db          ← ★ 所有业务数据（社团/岗位/简历/投递）
│  │  ├─ club.db-wal      ← 数据库的"正在写入"暂存区（WAL 模式）
│  │  └─ club.db-shm      ← 数据库的索引共享内存
│  ├─ uploads\            ← 简历附件实体文件（PDF/图片）
│  └─ .env                ← 访问密码（不提交到 Git）
└─ web\
   └─ dist\               ← 前端构建产物（后端会自动托管它）
```

**备份方法（新手版）**：
```powershell
# 停服务 → 复制这两个地方 → 完成
Copy-Item "D:\GitHub库\社团\server\data" "$env:USERPROFILE\backup\data" -Recurse
Copy-Item "D:\GitHub库\社团\server\uploads" "$env:USERPROFILE\backup\uploads" -Recurse
```
（`club.db-wal` 里可能存着还没并入主库的最新写入，所以整个 `data` 文件夹一起拷。）

---

## 5. 部署拓扑（程序跑在哪、怎么连起来）

### 5.1 当前的实际部署（本机 Windows）

```mermaid
flowchart TB
    subgraph PC["你的电脑（Windows）"]
        subgraph 任务["Windows 计划任务（登录自动启动）"]
            T1["Community-Server<br/>运行 node src/index.js"]
            T2["Community-Cpolar<br/>运行 cpolar 隧道"]
        end
        N["node 进程<br/>监听 :3000"]
        DBF[("server/data/club.db")]
        UP[("server/uploads/")]
        DIST["web/dist/<br/>前端构建产物"]

        T1 --> N
        N --> DBF
        N --> UP
        N -->|"静态托管"| DIST
    end

    B1["🧑‍💼 管理端浏览器<br/>http://localhost:3000"]
    B2["👨‍🎓 学生手机/浏览器<br/>http://localhost:3000/portal.html"]

    B1 -->|"HTTP"| N
    B2 -->|"HTTP"| N
    T2 -.->|"可选：映射到公网"| NET["☁️ cpolar 服务器"]
```

**新手理解要点**：
- **只有一个进程在对外服务**（node，监听 3000）。前端页面不是"另一个服务器"，而是被这个 node 顺手一起发出去的。
- 所以只要 3000 活着，管理端、学生端、API、附件全都能访问。
- 计划任务的作用：让你**不用每次开机手动敲命令**。

### 5.2 两种运行模式的区别

```mermaid
flowchart LR
    subgraph dev["开发模式（改代码时用）"]
        DV1["Vite 开发服务器 :5173<br/>改代码秒级热更新"]
        DV2["后端 :3000"]
        DV1 -->|"代理 /api → :3000"| DV2
    end
    subgraph prod["生产模式（日常使用）"]
        PV1["后端 :3000<br/>同时托管 web/dist"]
    end
```

| | 开发模式 | 生产模式 |
|---|---|---|
| 启动命令 | 两个终端：`cd server && npm run dev`、`cd web && npm run dev` | `node src/index.js`（或计划任务） |
| 访问地址 | `http://localhost:5173` | `http://localhost:3000` |
| 改代码后 | 浏览器自动刷新 | 需要 `npm run build` 重新构建前端 |
| 用途 | 写代码、调界面 | 给真实用户用 |

**新手最常见的坑**：改了 Vue 代码，但访问的是 `:3000` → 看不到变化。因为 3000 用的是**上次构建的旧产物**，必须先 `npm run build`。

### 5.3 Docker 部署（换台机器时用）

```mermaid
flowchart TB
    subgraph build["构建阶段（临时容器）"]
        S1["node:22-alpine<br/>安装 web 依赖"]
        S2["npm run build<br/>产出 dist/"]
        S1 --> S2
    end
    subgraph run["运行容器"]
        R1["node:22-alpine"]
        R2["server/ 代码"]
        R3["web/dist/ ← 从构建阶段拷入"]
        R4[("挂载卷<br/>data/ + uploads/")]
        R1 --- R2 & R3 & R4
    end
    S2 -->|"COPY --from"| R3
```

一条命令启动：`docker compose up -d --build` → 访问 `http://服务器IP:3000`。
**为什么数据要挂载卷**：容器删了重建，卷里的数据还在（否则每次更新都清空简历库）。

### 5.4 公网访问（可选，cpolar 隧道）

```mermaid
flowchart LR
    U["任意地方的浏览器"] -->|"https://xxx.cpolar.cn"| C["cpolar 云端"]
    C -->|"隧道"| L["你电脑上的 cpolar 客户端"]
    L -->|"转发到"| N["localhost:3000"]
```

**两个新手必须知道的限制**：
1. 免费版域名是**随机**的，重启隧道会变（要固定得买保留域名）。
2. 你的电脑必须开着、cpolar 必须运行，公网才能访问（因为它本质是把**你家电脑**暴露出去）。

---

## 6. 新手速查表

| 我想… | 怎么做 |
|---|---|
| 启动系统 | 双击计划任务即可；或 `cd server; node src/index.js` |
| 改界面样式 | `cd web; npm run dev` → 改 `web/src/` → 浏览器 5173 实时看 |
| 让改动对外生效 | `cd web; npm run build` → 刷新 3000 页面 |
| 改业务规则（如状态流转） | 改 `server/src/services/applicationService.js` → 重启后端 |
| 加一个数据库字段 | 新建 `server/db/migrations/004-xxx.sql`（**不要改 001**）→ 重启后端自动执行 |
| 备份数据 | 复制 `server/data` 和 `server/uploads` 两个文件夹 |
| 看服务是否活着 | 打开 `http://localhost:3000/healthz`，返回 `{"code":0,...}` 就是正常 |
| 打不开页面 | ① 查 3000 是否在监听 ② 查计划任务是否 Running ③ 看 `healthz` |
| 忘记访问密码 | 打开 `server/.env` 看 `BASIC_AUTH_PASS`，或设 `BASIC_AUTH_DISABLE=1` 关闭 |

### 术语小词典

| 术语 | 通俗解释 |
|---|---|
| **API** | 后端开给前端的一组"办事窗口"，每个窗口对应一个功能 |
| **REST** | 一种 API 风格：用 URL 表示"东西"，用 GET/POST/PUT/DELETE 表示"对它做什么" |
| **路由** | 负责把请求分发给正确的处理函数（像前台分诊） |
| **中间件** | 请求到达目的地前经过的"关卡"（门禁、查文件大小、记日志） |
| **状态机** | 规定"事情只能按某些步骤往下走"的规则表 |
| **迁移（migration）** | 数据库结构的版本升级脚本，一个一个按顺序执行 |
| **SQLite** | 一个数据库就是一个文件，不需要单独安装数据库软件 |
| **WAL** | 数据库的一种写入方式，写的时候先记小本子，更安全也更快 |
| **SPA** | 单页应用：整个网站只有一个 HTML，切换页面由 JS 完成，不重新加载 |
| **构建（build）** | 把开发时的源码（Vue 组件等）打包成浏览器能直接跑的 JS/CSS |
| **代理（proxy）** | 开发时把 `/api` 请求转给后端，避免跨域问题 |
| **localStorage** | 浏览器自带的小仓库，只存在这台电脑的这个浏览器里 |
| **Promise / async-await** | 处理"要等一会儿才有结果"的操作（如网络请求）的写法 |

---

## 7. 后端目录速查（每个文件干什么）

```
server/src/
├─ index.js             入口：读配置 → 升级数据库 → 开始监听（11 行）
├─ app.js               装配：门禁、静态文件、7 组路由、错误兜底（87 行）
├─ db/connection.js     打开数据库 + 执行迁移（32 行）
├─ utils/
│  ├─ id.js             生成带前缀的随机编号（club_xxx / app_xxx）
│  ├─ respond.js        统一返回格式 ok() + 分页参数归一化
│  ├─ errors.js         业务异常类与快捷方法（notFound/badRequest）
│  └─ env.js            极简 .env 读取器
├─ middlewares/
│  ├─ basicAuth.js      访问密码校验（可开关）
│  └─ upload.js         接收简历附件（限 10MB、限扩展名）
├─ routes/              7 个"分诊台"，每个路由约 3 行
│  clubRoutes / recruitmentRoutes / positionRoutes / resumeRoutes
│  applicationRoutes / matchRoutes / dashboardRoutes
└─ services/            业务大脑
   ├─ clubService.js            社团增删改查、详情树
   ├─ recruitmentService.js     招新批次、状态、删除保护
   ├─ positionService.js        岗位、招新人数校验
   ├─ resumeService.js          简历创建/更新
   ├─ applicationService.js     ★ 状态机 + 归档 + 六维筛选 + 导出
   ├─ matchService.js           技能匹配引擎
   └─ dashboardService.js       看板统计聚合
```

---

## 8. 前端目录速查

```
web/
├─ public/                     ← 不参与打包，原样复制到 dist
│  ├─ portal.html              学生端页面（手机风格）
│  └─ portal-adapter.js        学生端适配层（翻译官 + 真实投递）
├─ src/                        ← 管理端源码（需要构建）
│  ├─ main.js                  创建应用、装 Element Plus、注册图标
│  ├─ App.vue                  根组件（只放一个 router-view）
│  ├─ router/index.js          路由表（含侧边栏分区标记 meta.group）
│  ├─ layout/MainLayout.vue    框架：左侧菜单 + 顶部面包屑
│  ├─ api/client.js            axios 实例 + 响应拦截器（统一解包/报错）
│  ├─ api/index.js             按资源分组的接口函数
│  ├─ components/EChart.vue    ECharts 封装（自适应 + 自动销毁）
│  └─ views/                   5 个页面
│     ├─ DashboardView.vue         看板：指标卡/漏斗/趋势/分布/进度
│     ├─ ClubListView.vue          社团列表 + 新建
│     ├─ ClubDetailView.vue        社团详情 + 批次 + 岗位管理
│     ├─ ApplicationLibraryView.vue 简历库（筛选/流转/评分/归档/导出）
│     └─ MatchView.vue             智能匹配与转岗建议
└─ vite.config.js              开发服务器配置（端口 + /api 代理）
```

---

**遇到看不懂的地方**：先回到第 1 节的"市场比喻"，把术语替换成现实中的角色，通常就明白了。
