#!/usr/bin/env bash
#
# 部署自检 —— 打不开的时候跑这个
#
#   bash /opt/community/deploy/doctor.sh
#
# 它会逐层检查"外网为什么访问不到"：
#   容器 → 端口监听 → 系统防火墙 → 云安全组（只能提示）→ 从外部回连
#
set -uo pipefail

APP_PORT="${APP_PORT:-3000}"
STUDENT_APP_PORT="${STUDENT_APP_PORT:-3001}"
APP_DIR="${APP_DIR:-/opt/community}"

ok()   { printf '  \033[1;32m✅ %s\033[0m\n' "$*"; }
bad()  { printf '  \033[1;31m❌ %s\033[0m\n' "$*"; }
warn() { printf '  \033[1;33m⚠️  %s\033[0m\n' "$*"; }
head_() { printf '\n\033[1;36m── %s ──\033[0m\n' "$*"; }

echo "═══════════ 社团招新系统 · 部署自检 ═══════════"

# ── 1. 容器 ──
head_ "1. 容器状态"
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    ( cd "$APP_DIR" && docker compose ps ) 2>/dev/null || warn "在 $APP_DIR 下执行 docker compose ps 失败"
    state="$(cd "$APP_DIR" && docker compose ps --format '{{.State}}' 2>/dev/null | head -1)"
    if [[ "$state" == "running" ]]; then ok "容器 running"; else bad "容器状态：${state:-未知}（应为 running）"; fi
  else
    bad "缺少 docker compose 插件"
  fi
else
  bad "未安装 Docker"
fi

# ── 2. 端口监听 ──
head_ "2. 端口监听"
for p in "$APP_PORT" "$STUDENT_APP_PORT"; do
  if ss -ltn 2>/dev/null | grep -q ":${p} "; then
    ok "本机已监听 :${p}"
  else
    bad "本机未监听 :${p}"
  fi
done

# ── 3. 本机 HTTP ──
head_ "3. 本机 HTTP 自测"
for p in "$APP_PORT" "$STUDENT_APP_PORT"; do
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${p}/healthz" 2>/dev/null || true)"
  if [[ -n "$body" ]]; then
    ok "127.0.0.1:${p}/healthz → ${body}"
  else
    bad "127.0.0.1:${p}/healthz 无响应（容器内服务可能没起来，看 docker compose logs）"
  fi
done

# ── 4. 系统防火墙 ──
head_ "4. 系统防火墙"
if command -v iptables >/dev/null 2>&1; then
  # Oracle 的 Ubuntu 镜像默认 REJECT 掉除 SSH 外的一切，这是最常见的坑
  rejects="$(iptables -L INPUT -n 2>/dev/null | grep -cE 'REJECT|DROP' || true)"
  if [[ "${rejects:-0}" -gt 0 ]]; then
    warn "iptables INPUT 链存在 ${rejects} 条 REJECT/DROP 规则（Oracle 云常见）"
    for p in "$APP_PORT" "$STUDENT_APP_PORT"; do
      if iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
        ok "iptables 已放行 TCP ${p}"
      else
        bad "iptables 未放行 TCP ${p}"
        echo "     修复： iptables -I INPUT 6 -p tcp --dport ${p} -j ACCEPT && netfilter-persistent save"
      fi
    done
  else
    ok "iptables INPUT 无 REJECT/DROP 规则"
  fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ok "ufw 处于启用状态，当前规则："
  ufw status numbered 2>/dev/null | sed 's/^/     /'
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  ok "firewalld 启用中，已放行端口：$(firewall-cmd --list-ports 2>/dev/null)"
fi

# ── 5. 公网 IP ──
head_ "5. 公网地址"
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '获取失败')"
echo "  本机公网 IP：${IP}"
echo "  🖥️  社团端：http://${IP}:${APP_PORT}"
echo "  📱  学生端：http://${IP}:${STUDENT_APP_PORT}"

# ── 6. 从外部回连（关键：能区分"防火墙"还是"应用"问题）──
head_ "6. 从公网回连自测"
if [[ "$IP" != "获取失败" ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${IP}:${APP_PORT}/healthz" 2>/dev/null || echo '000')"
  if [[ "$code" == "200" ]]; then
    ok "从公网访问社团端成功（HTTP 200）—— 部署完成！"
  elif [[ "$code" == "401" ]]; then
    ok "从公网访问社团端返回 401（需要密码）—— 这其实是正常的！浏览器会弹密码框"
  else
    bad "从公网访问社团端失败（HTTP ${code}）"
    echo "     说明本机能通、但外网进不来，几乎一定是下面之一："
    echo "       · 云控制台的【安全组 / VCN 安全列表】没放行 TCP ${APP_PORT}"
    echo "       · 系统 iptables 仍拦着（看第 4 节）"
  fi
else
  warn "拿不到公网 IP，跳过外部回连测试"
fi

printf '\n\033[1;36m排查顺序建议：\033[0m 1 容器 → 2 端口 → 3 本机HTTP → 4 系统防火墙 → 云安全组\n'
echo "═══════════════════════════════════════════════"
