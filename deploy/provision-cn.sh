#!/usr/bin/env bash
#
# 国内云服务器部署（原生安装 + 国内镜像源 + systemd 常驻）
#
# 为什么单独做一份：国内服务器拉 Docker Hub 经常超时甚至失败，
# 镜像构建会卡在 `docker compose up --build`。这条路径完全不碰 Docker：
#   Node 从 npmmirror 下载 → npm 用淘宝镜像 → systemd 常驻
# 对腾讯云/阿里云/华为云的免费试用机、学生机最稳。
#
# 用法（服务器上，root）：
#   bash deploy/provision-cn.sh
#
# 可用环境变量覆盖：
#   APP_DIR=/opt/community  APP_PORT=3000  STUDENT_APP_PORT=3001
#   NODE_VERSION=22.20.0    REPO_URL=...
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "${SCRIPT_DIR}/lib.sh"

APP_DIR="${APP_DIR:-/opt/community}"
REPO_URL="${REPO_URL:-https://github.com/LLLDIOT/community.git}"
NODE_VERSION="${NODE_VERSION:-22.20.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
NODE_MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
SERVICE_NAME="community"

[[ $EUID -eq 0 ]] || die "请用 root 运行：sudo bash deploy/provision-cn.sh"

# ─────────────────────────────────────────────────────────────
log "1/7 安装基础工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential + python3 是给 better-sqlite3 兜底的：
# 它默认去 GitHub releases 下预编译包，国内可能拉不到，拉不到就会回退到本地编译。
apt-get install -y -qq git curl ca-certificates xz-utils \
  build-essential python3 sqlite3 >/dev/null

# ─────────────────────────────────────────────────────────────
log "2/7 安装 Node.js ${NODE_VERSION}（走 npmmirror，国内快）"
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v//')"
  major="${cur%%.*}"
  if [[ "${major:-0}" -ge 22 ]]; then
    ok "已有 Node v${cur}，跳过安装"
    need_node=0
  else
    warn "现有 Node v${cur} 过旧（本系统需要 >=22），将替换"
  fi
fi

if [[ "$need_node" -eq 1 ]]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64)  node_arch="x64" ;;
    aarch64) node_arch="arm64" ;;
    *) die "不支持的架构：$arch" ;;
  esac
  tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  url="${NODE_MIRROR}/v${NODE_VERSION}/${tarball}"

  echo "下载 ${url}"
  if ! curl -fL --retry 3 --connect-timeout 15 -o "/tmp/${tarball}" "$url"; then
    warn "从 npmmirror 下载失败，改用 Node 官方源"
    curl -fL --retry 3 --connect-timeout 15 -o "/tmp/${tarball}" \
      "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" \
      || die "Node 下载失败，请检查网络或手动指定 NODE_VERSION"
  fi

  tar -xJf "/tmp/${tarball}" -C /usr/local --strip-components=1
  rm -f "/tmp/${tarball}"
  ok "Node $(node -v) / npm $(npm -v) 已安装到 /usr/local"
fi

# npm 走国内镜像：这是国内部署提速最明显的一步
npm config set registry "$NPM_REGISTRY"
ok "npm registry = $NPM_REGISTRY"

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
log "4/7 构建前端 + 安装后端依赖"
echo "── 前端（需要 devDependencies 才能构建）──"
( cd web && npm ci --no-audit --no-fund && npm run build )
ok "前端已构建到 web/dist"

echo "── 后端（仅生产依赖）──"
( cd server && npm ci --omit=dev --no-audit --no-fund )
ok "后端依赖已安装"

# 自检：better-sqlite3 的原生模块是否真的可用
if ! ( cd server && node -e "require('better-sqlite3');" >/dev/null 2>&1 ); then
  warn "better-sqlite3 原生模块加载失败，尝试本地编译重建…"
  ( cd server && npm rebuild better-sqlite3 --build-from-source ) || die "better-sqlite3 构建失败"
  ( cd server && node -e "require('better-sqlite3');" ) || die "better-sqlite3 仍不可用"
fi
ok "better-sqlite3 原生模块可用"

# ─────────────────────────────────────────────────────────────
log "5/7 生成配置"
ensure_env_file "${APP_DIR}/.env"
# 应用自身也会读 server/.env（不覆盖已存在的环境变量），放一份保持一致
cp -f "${APP_DIR}/.env" "${APP_DIR}/server/.env" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────
log "6/7 注册 systemd 服务（开机自启 + 崩溃自动重启）"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=社团招新系统（社团端 :${APP_PORT} + 学生端 :${STUDENT_APP_PORT}）
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/local/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
systemctl restart "${SERVICE_NAME}"
sleep 4

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  ok "服务已启动（systemctl status ${SERVICE_NAME} 查看状态）"
else
  warn "服务未能启动，日志如下："
  journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
  die "请把上面的日志发给我"
fi

# 两个站点探活
for p in "$APP_PORT" "$STUDENT_APP_PORT"; do
  for i in $(seq 1 20); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${p}/healthz" >/dev/null 2>&1; then
      ok "本机 :${p} 探活通过"
      break
    fi
    sleep 1
    [[ $i -eq 20 ]] && warn "本机 :${p} 无响应，看 journalctl -u ${SERVICE_NAME}"
  done
done

# ─────────────────────────────────────────────────────────────
log "7/7 防火墙与自动备份"
open_ports
install_backup_cron "$APP_DIR"

print_summary "$APP_DIR" "国内原生部署"
