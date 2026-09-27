# 上云部署指南（香港轻量服务器）

> 目标：把系统从"跑在你自己电脑上"搬到公网服务器，**随时随地打开**，电脑关机也不影响。
>
> 全程只需三件事：**买一台服务器 → 跑两条命令 → 搬数据**。

---

## 0. 为什么推荐「香港 / 境外轻量服务器」

| 方案 | 国内学生能直连吗 | 需要备案吗 | 成本 | 结论 |
|---|---|---|---|---|
| **香港轻量服务器** | ✅ 能，不用梯子 | ❌ 不需要 | 约 ¥25-35/月 | **推荐** |
| 大陆节点服务器 | ✅ 最快 | ✅ **需要 ICP 备案**（1-3 周） | 约 ¥25-40/月 | 想用自己域名再说 |
| 海外 PaaS（Render 等） | ⚠️ 慢/可能打不开 | ❌ 不需要 | 免费额度小，持久磁盘要付费 | 不推荐给学生用 |
| 继续跑自己电脑 + 穿透 | ✅ | ❌ | 便宜 | ❌ 电脑关机就没了 |

**关键点**：你是要给同学用的，同学在国内。香港节点不用备案、国内直连速度可接受，是这类校园小系统最省事的落点。

---

## 1. 买服务器（腾讯云轻量应用服务器 · 香港）

### 1.1 下单

1. 打开 <https://cloud.tencent.com/product/lighthouse>（阿里云同理：轻量应用服务器 → 地域选香港）
2. 点「立即选购」，按下表选：

| 选项 | 选什么 | 说明 |
|---|---|---|
| **地域** | **中国香港** | 关键！选大陆节点就要备案 |
| **镜像** | **系统镜像 → Ubuntu Server 24.04 LTS 64位** | 不要选"应用镜像" |
| **套餐** | 2核2G / 40GB SSD 起 | 本系统很轻，2核2G 绰绰有余 |
| **带宽** | 30Mbps 峰值 或 按流量计费 | 校园系统流量很小 |
| **时长** | 1 年（新用户通常有优惠） | 买一年比按月便宜很多 |

3. 付款后进入 **[轻量应用服务器控制台](https://console.cloud.tencent.com/lighthouse)**

### 1.2 买完必做的两件事

**① 放行端口**（最容易漏，漏了就打不开）

控制台 → 点你的实例 → 「**防火墙**」标签页 → 「添加规则」：

| 应用类型 | 协议 | 端口 | 来源 |
|---|---|---|---|
| 自定义 | TCP | **3000** | 全部 IPv4（0.0.0.0/0） |

**② 设置 root 密码并记下公网 IP**

- 实例列表页能看到「**公网 IP**」，形如 `43.xxx.xxx.xxx` —— 抄下来
- 「更多」→「重置密码」→ 设置一个你记得住的 root 密码

> 💡 后续如果买了域名，可以再加 80/443 端口并用 nginx 做 HTTPS。现在先用 IP:3000 完全够用。

---

## 2. 连上服务器

Windows 打开 **PowerShell**，输入（把 IP 换成你的）：

```powershell
ssh root@43.xxx.xxx.xxx
```

第一次连接会问 `Are you sure you want to continue connecting?` → 输入 `yes`，然后输入刚才设的 root 密码。

看到 `root@VM-xx-xx:~#` 就说明连上了。

---

## 3. 一条命令部署

在服务器上执行：

```bash
apt-get update -y && apt-get install -y git
git clone --depth 1 https://github.com/LLLDIOT/community.git /opt/community
bash /opt/community/deploy/provision.sh
```

`provision.sh` 会自动完成：

1. 安装 Docker + Compose
2. 拉取代码到 `/opt/community`
3. **生成随机强密码**写入 `.env`（全站访问口令 + 创建社团开通口令）
4. 构建镜像并启动容器
5. 放行防火墙、注册每日 03:30 自动备份

跑完后屏幕会打印：

```
════════════════════════════════════════
  ✅ 部署完成
  访问地址：http://43.xxx.xxx.xxx:3000
  学生端  ：http://43.xxx.xxx.xxx:3000/portal.html
  全站访问密码：用户名 admin / 密码 xxxxxxxx
  创建社团开通口令：xxxxxxxx
════════════════════════════════════════
```

**⚠️ 立刻把这两个密码抄到安全的地方。** 它们也在服务器的 `/opt/community/.env` 里。

> 仓库是公开的，所以服务器能直接 clone。代码里**没有任何密码**，密码是你这台服务器现场随机生成的。

---

## 4. 把本机数据搬上去

### 4.1 在**你的电脑**上导出

```powershell
cd D:\GitHub库\社团\server
node scripts/export-data.mjs
```

会生成一个 `server\export-<时间戳>\` 目录，里面是：

```
club.db        ← 所有业务数据（社团/岗位/简历/投递/账号）
uploads\       ← 简历附件
MANIFEST.txt   ← 各表行数清单，用于核对
```

> 导出脚本会先执行 `wal_checkpoint`，保证最新写入已合并进 `club.db`。
> 帐号口令是 scrypt 派生值，随库一起走 —— **登录仍用你原来的社长密码**。

### 4.2 上传到服务器

在**你的电脑**上执行（把 IP 换成你的）：

```powershell
cd D:\GitHub库\社团\server
scp -r .\export-* root@43.xxx.xxx.xxx:/root/
```

### 4.3 在**服务器**上导入

```bash
# 先停服务，避免文件被占用
cd /opt/community && docker compose down

# 导入（把路径换成实际目录名）
cd /opt/community/server
node scripts/import-data.mjs --from /root/export-2026-09-27T14-14-33 --force

# 重新启动
cd /opt/community && docker compose up -d
```

> 容器里已经有 Node，所以直接用 `node` 跑脚本没问题。
> `import-data.mjs` 会在覆盖前把服务器上的旧库备份成 `club.db.bak-<时间戳>`。

### 4.4 核对

打开 `http://你的IP:3000`，用**原来的社长账号密码**登录，确认：

- 招新广场里能看到你的 2 个社团
- 简历库里 4 份简历都在
- 面试工作台的投递记录在

---

## 5. 日常运维

```bash
cd /opt/community

docker compose logs -f          # 看实时日志
docker compose restart          # 重启
docker compose down             # 停止
docker compose up -d --build    # 拉最新代码并重建（更新用）

# 更新到 GitHub 上的最新版本
git pull && docker compose up -d --build
```

**数据在哪**（已挂载到宿主机，容器重建不丢）：

```
/opt/community/server/data/club.db     ← 数据库
/opt/community/server/uploads/         ← 简历附件
```

**备份**：已自动每日 03:30 备份到 `/opt/community-backups`，保留 14 天。手动备份：

```bash
/usr/local/bin/community-backup.sh
```

---

## 6. 安全须知（重要）

| 项目 | 说明 |
|---|---|
| **全站密码** | `provision.sh` 已生成强随机密码。想换：编辑 `/opt/community/.env` 的 `BASIC_AUTH_PASS` 后 `docker compose up -d` |
| **绝对不要** | 把 `.env` 里的 `BASIC_AUTH_DISABLE` 设成 `1` —— 那会关掉全站密码，任何人可访问 |
| **社团账号** | 首次导入后，社长账号随库迁移。忘记密码：`cd /opt/community/server && npm run account:reset -- --club 社团名` |
| **学生投递入口** | 保持开放（否则学生投不了）。这意味着**无法阻止冒名投递**，需要接校园统一认证才能根治 |
| **简历隐私** | 已收紧：简历库/附件/CSV 导出都必须登录本社团账号才能看。**不要**把这些接口再放开 |
| **HTTPS** | 现在是 `http://IP:3000`，密码是明文传输的。要更安全就买域名 + nginx + Let's Encrypt |

---

## 7. 常见问题

**Q：浏览器打不开？**
按顺序查：① 控制台安全组放行了 3000 吗 ② `docker compose ps` 容器是 Up 吗 ③ `docker compose logs` 有报错吗 ④ 服务器上 `curl http://127.0.0.1:3000/healthz` 通不通。

**Q：每次都弹密码框好烦？**
这是 HTTP Basic Auth 的正常行为，浏览器记住后会一直带着。或者换成域名 + HTTPS 后用正式的登录页。

**Q：能用自己的域名吗？**
可以。买了域名后解析到这台 IP，再装 nginx 反代到 3000 并申请免费证书。香港节点**不需要备案**。

**Q：学生端要单独发链接吗？**
不用，同一个域名下：管理端 `/`，学生端 `/portal.html`。学生只发后者即可。

**Q：想改端口？**
编辑 `.env` 里的 `APP_PORT`，然后 `docker compose up -d`。记得同步改安全组。

**Q：以后代码更新了怎么同步？**
推送到 GitHub 后，在服务器上 `cd /opt/community && git pull && docker compose up -d --build`。
