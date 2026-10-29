#!/usr/bin/env bash
# 자동 실행 제거:  sudo ./uninstall.sh          (설정 /etc/tb3/robot.env 는 남김)
#                  sudo ./uninstall.sh --purge  (설정까지 삭제)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행하세요"; exit 1; }

for c in bringup camera rosbridge mediamtx video vision arm mqtt sound dashboard; do
  systemctl disable --now --quiet "tb3@$c" 2>/dev/null || true
done
systemctl disable --now --quiet tb3.target 2>/dev/null || true
rm -f /etc/systemd/system/tb3@.service /etc/systemd/system/tb3.target /usr/local/bin/tb3ctl
systemctl daemon-reload
[ "${1:-}" = "--purge" ] && rm -rf /etc/tb3 && echo "설정 삭제: /etc/tb3"
echo "자동 실행을 제거했습니다."
