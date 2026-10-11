#!/usr/bin/env bash
#
# 通用部署（Docker 版）—— 适合**海外 / 香港**服务器
#
# ⚠️ 如果你的服务器在中国大陆（腾讯云 / 阿里云 / 华为云），请改用：
#       bash deploy/provision-cn.sh
#    因为国内拉 Docker Hub 经常超时，镜像构建会卡在拉取 node:22-alpine。
#    国内那条路径完全不碰 Docker，走 npmmirror + systemd，稳得多。
#
# 用法（服务器上，root）：
#   bash deploy/provision.sh
#
# 可用环境变量覆盖：
#   APP_DIR=/opt/community  APP_PORT=3000  STUDENT_APP_PORT=3001
#   DOCKER_MIRROR=<镜像加速地址>   NPM_REGISTRY=<npm 源>
#
# 幂等：重复执行会更新代码并重建容器，不会覆盖已有的 .env（密码不变）。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "${SCRIPT_DIR}/lib.sh"

APP_DIR="${APP_DIR:-/opt/community}"
REPO_URL="${REPO_URL:-https://github.com/LLLDIOT/community.git}"
DOCKER_MIRROR="${DOCKER_MIRROR:-}"
NPM_REGISTRY="${NPM_REGISTRY:-}"

[[ $EUID -eq 0 ]] || die "请用 root 运行：sudo bash deploy/provision.sh"

# ─────────────────────────────────────────────────────────────
log "1/7 安装依赖（Docker / git / curl）"
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git ufw

  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  systemctl enable --now docker
  ok "Docker 已安装：$(docker --version)"
else
  ok "Docker 已就绪：$(docker --version)"
fi
docker compose version >/dev/null 2>&1 || die "缺少 docker compose 插件，请先安装 docker-compose-plugin"

# ─────────────────────────────────────────────────────────────
log "2/7 配置 Docker 镜像加速（国内服务器重要）"
# 自动探测：腾讯云内网镜像只有腾讯云机器能通，能通就用
if [[ -z "$DOCKER_MIRROR" ]] && curl -fsS --max-time 5 https://mirror.ccs.tencentyun.com/v2/ >/dev/null 2>&1; then
  DOCKER_MIRROR="https://mirror.ccs.tencentyun.com"
  ok "探测到腾讯云内网镜像源，将自动启用"
fi

if [[ -n "$DOCKER_MIRROR" ]]; then
  mkdir -p /etc/docker
  if [[ -f /etc/docker/daemon.json ]]; then
    cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak-$(date +%s)"
  fi
  cat > /etc/docker/daemon.json <<JSON
{
  "registry-mirrors": ["${DOCKER_MIRROR}"]
}
JSON
  systemctl restart docker
  ok "已配置 registry-mirrors = ${DOCKER_MIRROR}"
else
  warn "未配置 Docker 镜像加速。若构建时卡在拉取 node:22-alpine："
  warn "  1) 阿里云控制台搜「容器镜像服务」→ 镜像加速器，拿专属地址"
  warn "  2) 重新执行： DOCKER_MIRROR=<那个地址> bash deploy/provision.sh"
fi

# ─────────────────────────────────────────────────────────────
log "3/7 获取代码到 ${APP_DIR}"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/main
  ok "已更新到最新代码"
elif [[ -f "${SCRIPT_DIR}/../docker-compose.yml" ]]; then
  APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  ok "就地使用当前仓库：$APP_DIR"
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
  ok "已克隆仓库"
fi
cd "$APP_DIR"

# ─────────────────────────────────────────────────────────────
log "4/7 生成配置"
ensure_env_file "${APP_DIR}/.env"

# ─────────────────────────────────────────────────────────────
log "5/7 构建并启动"
if [[ -n "$NPM_REGISTRY" ]]; then
  export NPM_REGISTRY
  ok "构建期 npm registry = ${NPM_REGISTRY}"
fi
docker compose up -d --build

log "等待服务就绪…"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null 2>&1; then
    ok "社团端已就绪"
    break
  fi
  sleep 2
  if [[ $i -eq 40 ]]; then
    warn "等待超时，最近日志："
    docker compose logs --tail=40 || true
  fi
done
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${STUDENT_APP_PORT}/healthz" >/dev/null 2>&1; then
    ok "学生端已就绪"
    break
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────
log "6/7 防火墙"
open_ports

# ─────────────────────────────────────────────────────────────
log "7/7 自动备份"
install_backup_cron "$APP_DIR"

print_summary "$APP_DIR" "Docker 部署"
