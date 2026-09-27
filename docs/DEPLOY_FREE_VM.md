# 免费云服务器部署指南（Oracle Cloud / Google Cloud 永久免费）

> 目标：**不花服务器租金**，也能让同学随时随地打开。
>
> 这类"永久免费"机器本质上就是一台普通 Ubuntu VM，所以本项目**不需要改任何代码**——
> 前面写好的 `deploy/provision.sh` 直接就能用。

---

## 0. 先看清代价（重要）

永久免费是真的，但不是没代价。选之前先接受这三件事：

| 现实 | 说明 |
|---|---|
| **要绑信用卡验证** | Oracle 与 GCP 都要求用信用卡做身份验证（会小额预授权后退回，不扣费）。国内部分银行卡可能通不过。 |
| **可能抢不到机器** | Oracle 的免费 ARM 实例常年"Out of host capacity"，要换可用域或错峰重试。 |
| **国内访问一般** | 这些机房在海外。能用，但速度和稳定性不如香港/国内节点。**学生集中投递时可能变慢。** |

> 如果这三条里有一条你不能接受，建议改走**学校服务器**（0 成本、国内最快）或**学生机约 ¥99/年**（最稳）。
> 见 [DEPLOY_CLOUD.md](DEPLOY_CLOUD.md) 的方案对比。

---

## 1. Oracle Cloud（首选，永久免费）

### 1.1 注册

1. 打开 <https://www.oracle.com/cloud/free/> → Start for free
2. **Home Region 选亚洲的**，推荐按顺序：`Japan East (Tokyo)` → `South Korea Central (Seoul)` → `Singapore`
   （离国内近，延迟低。**注意：Home Region 注册后不能改**，务必一次选对）
3. 邮箱 + 手机验证 → 绑信用卡验证身份 → 完成

> 注册失败很常见（风控）。换邮箱/换卡/隔天再试，或者直接放弃改走 GCP。

### 1.2 创建实例

控制台 → Compute → Instances → **Create instance**

| 选项 | 选什么 |
|---|---|
| **Image** | Canonical Ubuntu **22.04** 或 **24.04** |
| **Shape** | 点 **Change shape** → Ampere → `VM.Standard.A1.Flex`（ARM 免费额度）<br>**若报 Out of host capacity**：换 Availability Domain，或改用 `VM.Standard.E2.1.Micro`（x86 永久免费，配置小但够用） |
| **OCPU / 内存** | 按你账号当前显示的 Always Free 额度填满（额度被调整过，以控制台为准） |
| **Boot volume** | 默认 50GB 起（免费额度内） |
| **SSH keys** | **选 Paste public keys**，把下面生成的公钥贴进去（不要选"没有密钥"） |

**先在你自己电脑上生成 SSH 密钥**（Windows PowerShell）：

```powershell
ssh-keygen -t ed25519 -C "community-server"
# 一路回车即可；然后打印公钥：
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

把打印出来的整行（`ssh-ed25519 AAAA... `）粘到 Oracle 的 SSH keys 框里。

> ⚠️ Oracle 的 Ubuntu 镜像**默认用户名是 `ubuntu`**，不是 root。

### 1.3 放行端口（**这里是最容易失败的地方**）

Oracle 有**两道**防火墙，**两道都要放**，缺一不可：

**第一道：VCN 安全列表（控制台）**

Networking → Virtual Cloud Networks → 点你的 VCN → Security Lists → 点默认安全列表 → **Add Ingress Rules**，加两条：

| Source Type | Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|---|
| CIDR | `0.0.0.0/0` | TCP | `3000` |
| CIDR | `0.0.0.0/0` | TCP | `3001` |

**第二道：系统自带 iptables**

Oracle 的 Ubuntu 镜像内置了一套 iptables 规则，**除 SSH 外全部 REJECT**。这是"安全列表明明放行了、还是打不开"的头号原因。

**好消息：不用你手动改**——本项目的 `provision.sh` 会自动检测并补上这两条规则并持久化。见第 2 节。

### 1.4 连接

```powershell
ssh ubuntu@<你的公网IP>
```

---

## 2. 部署（和付费服务器完全一样）

连上机器后：

```bash
sudo -i

# 装 git
apt-get update -y && apt-get install -y git

# 拉代码
git clone --depth 1 https://github.com/LLLDIOT/community.git /opt/community

# 一键部署（会自动处理 Oracle 的 iptables！）
bash /opt/community/deploy/provision.sh
```

`provision.sh` 会做：

1. 装 Docker + Compose
2. 生成随机强密码写入 `/opt/community/.env`
3. 构建并启动**两个站点**（社团端 3000 / 学生端 3001）
4. **自动补 Oracle 的 iptables 规则并持久化**（含 ufw / firewalld 兼容）
5. 注册每日 03:30 自动备份

跑完屏幕会打印两个地址和密码。**立刻把密码抄走。**

### 打不开就运行自检

这是本项目专门排"外网为啥访问不到"的脚本：

```bash
bash /opt/community/deploy/doctor.sh
```

它会逐层告诉你卡在哪：容器 → 端口 → 本机 HTTP → **系统防火墙** → 云安全组 → 从公网回连测试。

> 特别提示：自检里社团端返回 **401 是正常的**（说明服务通了，只是要密码，浏览器会弹框）。
> 学生端 3001 应当直接返回 200。

---

## 3. Google Cloud（备选）

Oracle 注册不过或抢不到机器时走这条。

### 3.1 注册与开机器

1. <https://cloud.google.com/free> → 注册（同样要信用卡验证）
2. Compute Engine → **Create instance**

| 选项 | 选什么 |
|---|---|
| **Region** | `us-west1` / `us-central1` / `us-east1`（**只有这三个区有永久免费 e2-micro**） |
| **Machine type** | **e2-micro** |
| **Boot disk** | Ubuntu 22.04/24.04，**标准永久磁盘 30GB**（超过 30GB 会收费） |
| **Firewall** | 勾上 **Allow HTTP traffic** / **Allow HTTPS traffic**（不够，还得单独加规则，见下） |

### 3.2 放行端口

VPC network → **Firewall** → Create firewall rule：

| 字段 | 值 |
|---|---|
| Name | `allow-community` |
| Direction | Ingress |
| Targets | All instances in the network |
| Source IPv4 ranges | `0.0.0.0/0` |
| Protocols and ports | 勾 **TCP**，填 `3000,3001` |

GCP 的 Ubuntu 镜像默认 iptables 是放行的，`provision.sh` 里那段规则对它无害。

### 3.3 连接与部署

GCP 默认用户名取决于你创建时选的（通常是你的 Google 用户名）。在控制台点实例旁的 **SSH** 按钮可直接在浏览器里开终端，最省事——然后用和第 2 节完全相同的命令部署。

---

## 4. 避坑清单（踩过的都在这儿）

| 现象 | 原因 | 处理 |
|---|---|---|
| 安全列表明明放行了，还是打不开 | **Oracle 系统 iptables 拦着** | 跑 `deploy/doctor.sh` 看第 4 节；`provision.sh` 已自动处理 |
| 创建实例报 `Out of host capacity` | 免费 ARM 资源紧张 | 换 Availability Domain，或改用 `VM.Standard.E2.1.Micro` |
| `Permission denied (publickey)` | 用户名错了 | Oracle 用 `ubuntu`；GCP 看控制台提示 |
| 社团端返回 401 | **正常**，不是故障 | 浏览器打开会弹密码框，用 `provision.sh` 打印的密码 |
| 实例过一段时间被回收 | Oracle 会回收长期闲置的免费实例 | 保持服务常驻（Docker 已在跑即算活跃）；重要数据靠每日备份 |
| 国内访问慢 | 机房在海外 | 能忍则忍；忍不了换香港轻量或学校服务器 |
| 磁盘写满 | 备份文件堆积 | 备份脚本已自动只保留 14 天；也可改 `/usr/local/bin/community-backup.sh` |

---

## 5. 数据搬迁

和付费服务器一模一样：在你电脑上 `cd server && npm run data:export`，`scp` 上传，服务器上 `npm run data:import -- --from ... --force`。

完整步骤见 [DEPLOY_CLOUD.md 第 5 节](DEPLOY_CLOUD.md#5-把本机数据搬上去)。

---

## 6. 一句话对比

| | Oracle 永久免费 | GCP 永久免费 | 香港轻量 | 学校服务器 | 学生机 |
|---|---|---|---|---|---|
| 成本 | 0 | 0 | ~¥300/年 | 0 | ~¥99/年 |
| 国内访问 | 一般 | 偏慢 | 好 | 最好 | 最好 |
| 注册难度 | 高（风控+抢机） | 中 | 低 | 低（走申请） | 低 |
| 配置 | 好（ARM） | 小（e2-micro） | 好 | 看学校 | 好 |
| 最省心 | ❌ | ❌ | ✅ | ✅ | ✅ |

> 免费的路能走通，但**要花时间折腾**；付费的路省钱省心。
> 我的建议顺序仍然是：**学校服务器 → 学生机 → Oracle 免费 → GCP 免费**。
