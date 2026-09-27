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
# ── 全站访问密码（浏览器打开网站时弹出，必须输入）──
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=${BASIC_AUTH_PASS}

# 绝对不要设为 1（那会关闭全站密码保护）
BASIC_AUTH_DISABLE=0

# 社团账号会话有效期（小时）
CLUB_SESSION_HOURS=12

# 创建社团所需的开通口令（留空 = 任何人都能创建社团）
CLUB_CREATE_TOKEN=${CLUB_CREATE_TOKEN}

# 对外暴露的端口
APP_PORT=${APP_PORT}
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
  if curl -fsS "http://127.0.0.1:${APP_PORT:-3000}/healthz" >/dev/null 2>&1; then
    echo "服务已就绪"
    break
  fi
  sleep 2
  [[ $i -eq 40 ]] && warn "等待超时，请用 docker compose logs 查看日志"
done

# ─────────────────────────────────────────────────────────────
log "5/6 防火墙"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${APP_PORT:-3000}/tcp" >/dev/null 2>&1 || true
  echo "已放行 ufw ${APP_PORT:-3000}/tcp（若 ufw 未启用则无影响）"
fi
warn "别忘了在云厂商控制台的【安全组/防火墙】里也放行 TCP ${APP_PORT:-3000}，否则外网仍然打不开！"

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
  ✅ 部署完成

  访问地址：http://${IP}:${APP_PORT:-3000}
  学生端  ：http://${IP}:${APP_PORT:-3000}/portal.html

  全站访问密码（浏览器弹窗里输入）：
    用户名：${BASIC_AUTH_USER:-admin}
    密码  ：${BASIC_AUTH_PASS}

  创建社团开通口令（新建社团时需要填）：
    ${CLUB_CREATE_TOKEN}

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
