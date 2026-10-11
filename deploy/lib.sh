#!/usr/bin/env bash
#
# 部署脚本共用库 —— 被 provision.sh（Docker 版）与 provision-cn.sh（国内原生版）source
#
# 只放"两边都要用、且逻辑必须一致"的东西，避免两份脚本各自漂移。

# ── 日志 ──
log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[1;32m✅ %s\033[0m\n' "$*"; }

# ── 端口变量（两个站点）──
: "${APP_PORT:=3000}"
: "${STUDENT_APP_PORT:=3001}"

# ─────────────────────────────────────────────────────────────
# 放行端口：把系统级防火墙全部处理掉
#
# 为什么必须做：Oracle Cloud 的 Ubuntu 镜像自带 iptables，除 SSH 外全部 REJECT；
# 这是"云控制台安全列表明明放行了、端口还是不通"的头号原因。
# 国内厂商（腾讯云/阿里云）的镜像一般没有这套规则，做了也无害。
# 注意：云控制台的安全组/防火墙脚本改不了，只能事后提醒。
# ─────────────────────────────────────────────────────────────
open_ports() {
  local ports=("$APP_PORT" "$STUDENT_APP_PORT")

  # ① iptables（Oracle 等）
  if command -v iptables >/dev/null 2>&1; then
    ensure_ipt_accept() {
      local port="$1"
      iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null && return 0
      local pos
      pos="$(iptables -L INPUT --line-numbers -n 2>/dev/null | awk '/REJECT|DROP/ {print $1; exit}')"
      if [[ -n "$pos" ]]; then
        iptables -I INPUT "$pos" -p tcp --dport "$port" -j ACCEPT
      else
        iptables -A INPUT -p tcp --dport "$port" -j ACCEPT
      fi
    }
    for p in "${ports[@]}"; do ensure_ipt_accept "$p"; done

    if ! command -v netfilter-persistent >/dev/null 2>&1; then
      echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections 2>/dev/null || true
      echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections 2>/dev/null || true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
    fi
    if command -v netfilter-persistent >/dev/null 2>&1; then
      netfilter-persistent save >/dev/null 2>&1 || true
      ok "iptables 规则已写入并持久化（${APP_PORT} / ${STUDENT_APP_PORT}）"
    else
      mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
      warn "iptables 规则已写入，但未安装持久化工具，重启后可能失效"
    fi
  fi

  # ② ufw
  if command -v ufw >/dev/null 2>&1; then
    for p in "${ports[@]}"; do ufw allow "${p}/tcp" >/dev/null 2>&1 || true; done
    ok "ufw 已放行 ${APP_PORT} 与 ${STUDENT_APP_PORT}"
  fi

  # ③ firewalld
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    for p in "${ports[@]}"; do
      firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null 2>&1 || true
    done
    firewall-cmd --reload >/dev/null 2>&1 || true
    ok "firewalld 已放行两个端口"
  fi
}

# ─────────────────────────────────────────────────────────────
# 生成 .env（已存在则保留，密码不变）
# ─────────────────────────────────────────────────────────────
ensure_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    echo "$env_file 已存在，保留原有口令（要换密码请先备份并删除它）"
    return 0
  fi

  local basic_pass create_token
  basic_pass="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  create_token="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"

  cat > "$env_file" <<EOF
# ══ 社团招新系统 · 运行配置 ══
# 本文件含明文口令，权限 600，不要提交到任何仓库

# ── 两个站点 ──
#   社团端（PC 管理台）：有全站访问密码
#   学生端（手机投递）：无需密码，学生的投递入口
# PORT / STUDENT_PORT        应用监听的端口（原生部署用）
# APP_PORT / STUDENT_APP_PORT 对外暴露的端口（Docker 端口映射用）
PORT=${APP_PORT}
STUDENT_PORT=${STUDENT_APP_PORT}
APP_PORT=${APP_PORT}
STUDENT_APP_PORT=${STUDENT_APP_PORT}

# ── 社团端全站访问密码（浏览器弹窗里输入）──
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=${basic_pass}
# 绝对不要设为 1：那会关闭社团端的密码保护
BASIC_AUTH_DISABLE=0

# ── 社团账号会话有效期（小时）──
CLUB_SESSION_HOURS=12

# ── 创建社团所需的开通口令（留空 = 任何人都能创建社团）──
CLUB_CREATE_TOKEN=${create_token}

# ── 可选：学生端的完整外部地址。配了域名就填（如 https://apply.example.com），
#    社团端侧边栏的「学生投递端」链接会指向它；不填则按访问主机名 + 学生端端口推导 ──
STUDENT_SITE_URL=
EOF
  chmod 600 "$env_file"
  ok "已生成 $env_file（随机强密码，权限 600）"
}

# ─────────────────────────────────────────────────────────────
# 每日自动备份
# ─────────────────────────────────────────────────────────────
install_backup_cron() {
  local app_dir="$1"
  mkdir -p /opt/community-backups
  cat > /usr/local/bin/community-backup.sh <<BACKUP
#!/usr/bin/env bash
set -euo pipefail
DIR="${app_dir}/server"
OUT=/opt/community-backups
STAMP=\$(date +%F)
mkdir -p "\$OUT"
# SQLite 用 .backup 做在线一致性备份（比直接 cp 安全，WAL 里未合并的写入也能带上）
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "\$DIR/data/club.db" ".backup '\$OUT/club-\$STAMP.db'"
else
  cp "\$DIR/data/club.db" "\$OUT/club-\$STAMP.db"
fi
tar czf "\$OUT/uploads-\$STAMP.tar.gz" -C "\$DIR" uploads 2>/dev/null || true
find "\$OUT" -type f -mtime +14 -delete
BACKUP
  chmod +x /usr/local/bin/community-backup.sh
  ( crontab -l 2>/dev/null | grep -v community-backup ; echo "30 3 * * * /usr/local/bin/community-backup.sh" ) | crontab -
  ok "已注册每日 03:30 备份到 /opt/community-backups（保留 14 天）"
}

# ─────────────────────────────────────────────────────────────
# 打印部署结果
# ─────────────────────────────────────────────────────────────
print_summary() {
  local app_dir="$1" mode="$2"
  # shellcheck disable=SC1091
  local basic_user basic_pass create_token
  basic_user="$(grep -E '^BASIC_AUTH_USER=' "$app_dir/.env" | cut -d= -f2-)"
  basic_pass="$(grep -E '^BASIC_AUTH_PASS=' "$app_dir/.env" | cut -d= -f2-)"
  create_token="$(grep -E '^CLUB_CREATE_TOKEN=' "$app_dir/.env" | cut -d= -f2-)"

  local ip
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<你的服务器IP>')"

  cat <<EOF

════════════════════════════════════════════════════════════
  ✅ 部署完成（两个独立网站，同一份数据）   [$mode]

  🖥️  社团端（你和社团干部用，需要密码）
      http://${ip}:${APP_PORT}

  📱  学生端（发给学生，无需密码）
      http://${ip}:${STUDENT_APP_PORT}

  ── 社团端访问密码（浏览器弹窗里输入）──
    用户名：${basic_user:-admin}
    密码  ：${basic_pass}

  ── 创建社团开通口令（在社团端新建社团时需要填）──
    ${create_token}

  两个站点的边界：
    · 学生端只有 5 个接口（看社团 / 看岗位 / 建简历 / 投递 / 查自己进度）
    · 简历库、导出、看板、账号管理等只在社团端，且必须登录
    · 学生端不暴露简历附件目录

  数据位置（重要，备份就靠它）：
    ${app_dir}/server/data/club.db
    ${app_dir}/server/uploads/

  ⚠️ 立刻把上面的密码抄到安全的地方（也在 ${app_dir}/.env 里）
  ⚠️ 还必须在云控制台的【安全组 / 防火墙】放行 ${APP_PORT} 与 ${STUDENT_APP_PORT}！
     打不开就跑： bash ${app_dir}/deploy/doctor.sh
════════════════════════════════════════════════════════════
EOF
}
