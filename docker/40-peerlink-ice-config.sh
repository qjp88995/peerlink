#!/bin/sh
# nginx:alpine 启动时自动执行 /docker-entrypoint.d/*.sh。
# 这里按容器环境变量生成前端运行时 ICE 配置——改 env 后重启容器即生效，无需重建镜像。
set -e

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

cat > /usr/share/nginx/html/ice-config.js <<EOF
window.__PEERLINK_ICE__ = {
  stunUrls: "$(esc "${STUN_URLS:-}")",
  turnUrl: "$(esc "${TURN_URL:-}")",
  turnUsername: "$(esc "${TURN_USERNAME:-}")",
  turnCredential: "$(esc "${TURN_CREDENTIAL:-}")",
};
EOF

echo "[ice-config] STUN_URLS=${STUN_URLS:-<unset>} TURN_URL=${TURN_URL:-<unset>}"
