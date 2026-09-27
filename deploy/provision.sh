#!/usr/bin/env bash
#
# 社团招新系统 · 云服务器一键部署（Ubuntu 22.04 / 24.04，Debian 12 亦可）
#
# 用法：把本脚本连同仓库一起放到服务器，然后
#   sudo bash deploy/provision.sh
#
# 它会：
#   1) 安装 Docker + Compose 插件 + git
#   2) 把仓库克隆/更新到 /opt/community（或就地使用当前目录）
#   3) 生成 .env（含随机强密码的全站访问口令、随机会话密钥、开通口令）
#   4) 构建镜像并启动容器
#   5) 注册每日自动备份的 cron
#   6) 打印访问地址与登录凭据
#
# 幂等：重复执行会更新代码并重建容器，不会覆盖已有的 .env（密码不变）。
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/community}"
REPO_URL="${REPO_URL:-https://github.com/LLLDIOT/community.git}"
APP_PORT="${APP_PORT:-3000}"
STUDENT_APP_PORT="${STUDENT_APP_PORT:-3001}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行：sudo bash deploy/provision.sh"

# ─────────────────────────────────────────────────────────────
log "1/6 安装依赖（Docker / git / curl）"
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git ufw

  # 用 Docker 官方脚本安装（国内服务器若拉取慢，可改用镜像源）
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  systemctl enable --now docker
else
  echo "Docker 已安装：$(docker --version)"
fi
docker compose version >/dev/null 2>&1 || die "缺少 docker compose 插件，请手动安装 docker-compose-plugin"

# ─────────────────────────────────────────────────────────────
log "2/6 获取代码到 ${APP_DIR}"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
  echo "已更新到最新代码"
elif [[ -f "./docker-compose.yml" && -f "./Dockerfile" ]]; then
  # 就地部署：脚本就在仓库里，直接用当前目录
  APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  echo "就地使用当前仓库：$APP_DIR"
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
  echo "已克隆仓库"
fi
cd "$APP_DIR"

# ─────────────────────────────────────────────────────────────
log "3/6 生成配置 .env"
if [[ -f .env ]]; then
  echo ".env 已存在，保留原有口令（如需更换请先备份并删除它）"
else
  BASIC_AUTH_PASS="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  CLUB_CREATE_TOKEN="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  cat > .env <<EOF
# ── 两个站点 ──
# 社团端：PC 管理台，有全站访问密码
# 学生端：手机投递用，无需密码（学生的投递入口）
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=${BASIC_AUTH_PASS}

# 绝对不要设为 1（那会关闭社团端的全站密码保护）
BASIC_AUTH_DISABLE=0

# 社团账号会话有效期（小时）
CLUB_SESSION_HOURS=12

# 创建社团所需的开通口令（留空 = 任何人都能创建社团）
CLUB_CREATE_TOKEN=${CLUB_CREATE_TOKEN}

# 对外暴露的端口
APP_PORT=${APP_PORT}
STUDENT_APP_PORT=${STUDENT_APP_PORT}
EOF
  chmod 600 .env
  echo "已生成 .env（权限 600，仅 root 可读）"
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

# ─────────────────────────────────────────────────────────────
log "4/6 构建并启动"
docker compose up -d --build

log "等待服务就绪…"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3000/healthz" >/dev/null 2>&1; then
    echo "社团端已就绪"
    break
  fi
  sleep 2
  [[ $i -eq 40 ]] && warn "等待超时，请用 docker compose logs 查看日志"
done
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:3001/healthz" >/dev/null 2>&1; then
    echo "学生端已就绪"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────
log "5/6 防火墙"

# ── 云厂商安全组（控制台里的）脚本改不了，只能提醒 ──
CLOUD_HINT="云厂商控制台的【安全组 / 防火墙 / VCN 安全列表】"

# ── ① Oracle Cloud 的系统级 iptables ──
# Oracle 的 Ubuntu 镜像自带一套 iptables 规则：除 SSH 外全部 REJECT。
# 这是"安全列表明明放行了、端口还是不通"的头号原因，所以这里自动补规则。
# 注：Docker 发布的端口走 FORWARD 链，但 Oracle 镜像同时会拦 INPUT，
#     两边都补上最省事。
if command -v iptables >/dev/null 2>&1; then
  ensure_ipt_accept() {
    local port="$1"
    if iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      return 0
    fi
    # 插到第一条 REJECT/DROP 之前；没有就追加
    local pos
    pos="$(iptables -L INPUT --line-numbers -n 2>/dev/null | awk '/REJECT|DROP/ {print $1; exit}')"
    if [[ -n "$pos" ]]; then
      iptables -I INPUT "$pos" -p tcp --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp --dport "$port" -j ACCEPT
    fi
  }
  ensure_ipt_accept "${APP_PORT:-3000}"
  ensure_ipt_accept "${STUDENT_APP_PORT:-3001}"

  # 让规则重启后仍在
  if ! command -v netfilter-persistent >/dev/null 2>&1; then
    echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections 2>/dev/null || true
    echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections 2>/dev/null || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
    echo "已写入 iptables 规则并持久化（${APP_PORT:-3000} / ${STUDENT_APP_PORT:-3001}）"
  else
    mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    echo "已写入 iptables 规则（未能安装持久化工具，重启后可能失效）"
  fi
fi

# ── ② Debian/Ubuntu 的 ufw（若启用了）──
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${APP_PORT:-3000}/tcp" >/dev/null 2>&1 || true
  ufw allow "${STUDENT_APP_PORT:-3001}/tcp" >/dev/null 2>&1 || true
  echo "已放行 ufw：${APP_PORT:-3000}/tcp（社团端）与 ${STUDENT_APP_PORT:-3001}/tcp（学生端）"
fi

# ── ③ firewalld（CentOS 系；本项目主要面向 Ubuntu，顺手兼容）──
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${APP_PORT:-3000}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-port="${STUDENT_APP_PORT:-3001}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "已放行 firewalld 两个端口"
fi

warn "还需要在 ${CLOUD_HINT} 放行 TCP ${APP_PORT:-3000} 与 ${STUDENT_APP_PORT:-3001}，否则外网仍然打不开！"
warn "Oracle Cloud 尤其注意：VCN → 安全列表 → 入站规则，要单独加这两条。"

# ─────────────────────────────────────────────────────────────
log "6/6 每日自动备份"
mkdir -p /opt/community-backups
cat > /usr/local/bin/community-backup.sh <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
DIR=/opt/community/server
OUT=/opt/community-backups
STAMP=$(date +%F)
mkdir -p "$OUT"
# SQLite 用 .backup 命令做在线一致性备份（比直接 cp 安全）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DIR/data/club.db" ".backup '$OUT/club-$STAMP.db'"
else
  cp "$DIR/data/club.db" "$OUT/club-$STAMP.db"
fi
tar czf "$OUT/uploads-$STAMP.tar.gz" -C "$DIR" uploads 2>/dev/null || true
# 只保留最近 14 天
find "$OUT" -type f -mtime +14 -delete
BACKUP
chmod +x /usr/local/bin/community-backup.sh
( crontab -l 2>/dev/null | grep -v community-backup ; echo "30 3 * * * /usr/local/bin/community-backup.sh" ) | crontab -
echo "已注册每日 03:30 备份到 /opt/community-backups（保留 14 天）"

# ─────────────────────────────────────────────────────────────
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<你的服务器IP>')"
cat <<EOF

════════════════════════════════════════════════════════════
  ✅ 部署完成（两个独立网站，同一份数据）

  🖥️  社团端（你和社团干部用，需要密码）
      http://${IP}:${APP_PORT:-3000}

  📱  学生端（发给学生，无需密码）
      http://${IP}:${STUDENT_APP_PORT:-3001}

  ── 社团端访问密码（浏览器弹窗里输入）──
    用户名：${BASIC_AUTH_USER:-admin}
    密码  ：${BASIC_AUTH_PASS}

  ── 创建社团开通口令（在社团端新建社团时需要填）──
    ${CLUB_CREATE_TOKEN}

  两个站点的边界：
    · 学生端只有 5 个接口（看社团 / 看岗位 / 建简历 / 投递 / 查自己进度）
    · 简历库、导出、看板、账号管理等只在社团端，且必须登录
    · 学生端不暴露简历附件目录

  常用命令：
    cd ${APP_DIR}
    docker compose logs -f          # 看日志
    docker compose restart          # 重启
    docker compose up -d --build    # 更新代码后重建
    docker compose down             # 停止

  数据位置（已挂载到宿主机，容器重建不丢）：
    ${APP_DIR}/server/data/club.db
    ${APP_DIR}/server/uploads/

  ⚠️ 请立刻把上面的密码抄到安全的地方（也在 ${APP_DIR}/.env 里）
════════════════════════════════════════════════════════════
EOF
