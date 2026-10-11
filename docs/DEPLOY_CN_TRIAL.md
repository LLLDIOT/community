# 国内云服务器部署指南（新用户免费试用）

> 适用于**腾讯云 / 阿里云 / 华为云**等国内厂商的免费试用机、学生机。
>
> 特点：**只要身份证实名，不需要信用卡**；国内节点，学生访问最快。
> 代价：免费试用通常只有 1 个月（部分活动 3 个月），到期需决定是否续费。

---

## 0. 为什么国内服务器要单独一条部署路径

因为**国内拉 Docker Hub 经常超时**。通用部署脚本 `provision.sh` 用的是 Docker，
在国内机器上大概率会卡在拉取 `node:22-alpine`。

所以国内请用别人写好的另一条路径 **`deploy/provision-cn.sh`**：

| | `provision.sh`（Docker） | `provision-cn.sh`（原生） |
|---|---|---|
| 适合 | 海外 / 香港服务器 | **国内服务器** |
| 依赖 | Docker Hub（国内常超时） | npmmirror（国内快） |
| Node 来源 | 镜像内置 | 从 npmmirror 下载 |
| npm 源 | 官方源 | 淘宝镜像 |
| 常驻方式 | Docker 重启策略 | systemd |
| 调试 | `docker compose logs` | `journalctl -u community` |

---

## 1. 哪家有免费试用

| 厂商 | 入口 | 常见额度 |
|---|---|---|
| 腾讯云 | <https://cloud.tencent.com/act/free> | 轻量应用服务器，1 个月（部分活动 3 个月） |
| 阿里云 | <https://free.aliyun.com> | ECS / 轻量，1 个月 |
| 华为云 | <https://activity.huaweicloud.com/free/> | 云服务器，1 个月 |

> 各家活动经常变，以你打开时页面为准（[2026 年各家对比](https://cloud.tencent.com/developer/article/2659144)）。

**选哪个？** 优先选你**已经实名过**的那家，省一步。都没有的话，腾讯云轻量的控制台对新手最友好。

---

## 2. 下单时怎么选

| 选项 | 选什么 | 说明 |
|---|---|---|
| **地域** | 离你学校近的（如华东-上海、华南-广州） | **不要选海外**——那还不如用香港机 |
| **镜像** | **系统镜像 → Ubuntu Server 24.04 LTS 64位** | 不要选"应用镜像"/"宝塔面板" |
| **规格** | 2核2G 起 | 本系统很轻，2核2G 够用 |
| **带宽** | 免费试用通常 3-5Mbps | 够用；学生投递是文本，不传大文件 |
| **系统盘** | 默认 40-50GB | 足够 |
| **时长** | 试用期（1 个月） | 到期前再决定续不续 |

下单只需要**实名认证**（身份证 + 人脸），**不需要信用卡**。

---

## 3. ⚠️ 备案问题（国内节点必看）

这是国内节点和香港最大的区别：

| 访问方式 | 需要备案吗 |
|---|---|
| **`http://IP:3000`（直接用 IP + 端口）** | ❌ **不需要** |
| `http://你的域名`（域名 + 80/443） | ✅ **需要 ICP 备案**（1-3 周） |

**所以：先用 IP + 端口，完全不用备案。** 学生端发 `http://IP:3001`，社团端你自己用 `http://IP:3000`。

以后想让网址好记、上 HTTPS，再去办备案——那时把域名解析到这台机器即可，代码不用改。

---

## 4. 买完必做：放行端口

**控制台 → 你的实例 → 防火墙 / 安全组 → 添加入站规则**，加两条：

| 协议 | 端口 | 来源 | 用途 |
|---|---|---|---|
| TCP | **3000** | `0.0.0.0/0` | 社团端（管理台） |
| TCP | **3001** | `0.0.0.0/0` | 学生端（投递页） |

- 腾讯云轻量：叫「**防火墙**」，在实例详情页
- 阿里云 ECS：叫「**安全组**」，在网络与安全里
- 华为云：叫「**安全组**」

同时记下实例列表里的**公网 IP**，并重置 root 密码。

---

## 5. 部署（一条命令）

连上服务器（Windows PowerShell）：

```powershell
ssh root@你的公网IP
```

然后：

```bash
# 装 git
apt-get update -y && apt-get install -y git

# 拉代码
git clone --depth 1 https://github.com/LLLDIOT/community.git /opt/community

# 国内专用一键部署
bash /opt/community/deploy/provision-cn.sh
```

脚本会依次完成：

1. 装基础工具（含 `build-essential` + `python3`，给 better-sqlite3 兜底编译）
2. **从 npmmirror 下载 Node 22**（国内快），并把 npm 源设为淘宝镜像
3. 拉代码到 `/opt/community`
4. `npm ci` + 构建前端 + 装后端依赖，并**验证 better-sqlite3 原生模块真的能加载**
5. 生成 `.env`（随机强密码）
6. 注册 **systemd 服务**（开机自启、崩溃自动重启）
7. 放行系统防火墙、配每日 03:30 自动备份
8. 打印两个地址与密码

跑完屏幕会显示：

```
════════════════════════════════════════
  ✅ 部署完成（两个独立网站，同一份数据）   [国内原生部署]
  🖥️  社团端：http://<IP>:3000   （要密码）
  📱  学生端：http://<IP>:3001   （无需密码）
  ── 社团端访问密码 ──
    用户名：admin   密码：xxxxxxxx
════════════════════════════════════════
```

**立刻把密码抄走。**

### 打不开就跑自检

```bash
bash /opt/community/deploy/doctor.sh
```

它会自动识别你是 Docker 还是 systemd 部署，并逐层检查：
服务状态 → 端口监听 → 本机 HTTP → **系统防火墙** → 云安全组 → 从公网回连。

> 提示：社团端返回 **401 是正常的**（在要密码，浏览器会弹框）；学生端应该是 200。

---

## 6. 日常运维（原生部署）

```bash
systemctl status community      # 看状态
systemctl restart community     # 重启
systemctl stop community        # 停止
journalctl -u community -f      # 实时日志
journalctl -u community -n 100  # 最近 100 行

# 更新到 GitHub 最新版
cd /opt/community
git pull
cd web && npm ci && npm run build
cd ../server && npm ci --omit=dev
systemctl restart community
```

> 更省事：直接重跑 `bash /opt/community/deploy/provision-cn.sh`，它是幂等的，
> 会自己更新代码、重装依赖、重建前端、重启服务，且**不会覆盖已有密码**。

**数据位置**：

```
/opt/community/server/data/club.db     ← 数据库
/opt/community/server/uploads/         ← 简历附件
```

**备份**：已自动每日 03:30 备份到 `/opt/community-backups`，保留 14 天。手动跑：`/usr/local/bin/community-backup.sh`

---

## 7. 试用到期怎么办

到期前一周会提醒。三个选择：

| 选择 | 说明 |
|---|---|
| **续费成学生机** | 约 ¥99/年，最省心。数据原地不动，什么都不用做 |
| **换学生机/另一家试用** | 用 `npm run data:export` 导出，在新机器 `npm run data:import` 导入，十分钟搞定 |
| **不续了** | 导出数据留档，之后随时可以在任何 Ubuntu 机器上恢复 |

**务必养成习惯：定期把 `server/data` 和 `server/uploads` 拷回自己电脑。** 备份脚本在服务器上，服务器没了备份也没了。

```powershell
# 在你电脑上拉回备份
scp -r root@你的IP:/opt/community-backups ./backups
```

---

## 8. 避坑清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 外网打不开 | **安全组没放行** | 控制台加 3000/3001 入站规则；跑 `doctor.sh` 确认卡在哪层 |
| 社团端 401 | **正常**，在要密码 | 用脚本打印的密码 |
| `npm ci` 很慢 | 没走国内源 | 脚本已自动设淘宝镜像；手动：`npm config set registry https://registry.npmmirror.com` |
| better-sqlite3 报错 | 预编译包没拉到 | 脚本已装 build-essential 会自动本地编译；重跑一次即可 |
| 服务起来又挂 | 看日志 | `journalctl -u community -n 100` |
| 想换端口 | 改 `.env` 的 `PORT`/`STUDENT_PORT` | 改完 `systemctl restart community`，并同步改安全组 |
| 想上域名 | 需要 ICP 备案 | 先继续用 IP；备案下来后把域名解析过来即可，代码不用改 |

---

## 9. 和另外两条路的关系

- 想在**你自己的电脑**上先跑通再上云 → 看项目根 README 的本地启动方式
- 用**香港/海外**服务器 → 看 [DEPLOY_CLOUD.md](DEPLOY_CLOUD.md)（用 `provision.sh`）
- 想用 **Oracle / GCP 永久免费**（要信用卡）→ 看 [DEPLOY_FREE_VM.md](DEPLOY_FREE_VM.md)

三条路的数据搬迁方式**完全一样**（`npm run data:export` / `data:import`）。
