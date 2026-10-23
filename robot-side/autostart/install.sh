#!/usr/bin/env bash
# 터틀봇 부팅 시 자동 실행 설치 (SBC 에서 실행)
#
#   sudo ./install.sh                         # 기본: bringup camera rosbridge mediamtx video
#   sudo ./install.sh --download-mediamtx     # MediaMTX 실행 파일도 받기
#   sudo ./install.sh --components "bringup camera rosbridge mediamtx video vision"
#   sudo ./install.sh --now                   # 설치 후 바로 시작
#   sudo ./install.sh --user luxlike          # 서비스를 실행할 사용자 (기본: sudo 를 실행한 사용자)
#
# 시험용: DESTDIR=/tmp/stage ./install.sh --no-systemctl   (파일만 만들어 봄)
set -euo pipefail

MEDIAMTX_VERSION="v1.21.2"
DEFAULT_COMPONENTS="bringup camera rosbridge mediamtx video"
ALL_COMPONENTS="bringup camera rosbridge mediamtx video vision arm mqtt dashboard"

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROBOT_SIDE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$ROBOT_SIDE/.." && pwd)"
DESTDIR="${DESTDIR:-}"
SYSTEMD_DIR="$DESTDIR/etc/systemd/system"
ETC_DIR="$DESTDIR/etc/tb3"
BIN_DIR="$DESTDIR/usr/local/bin"

TARGET_USER="${SUDO_USER:-$(id -un)}"
COMPONENTS="$DEFAULT_COMPONENTS"
COMPONENTS_GIVEN=0
DOWNLOAD_MTX=0
START_NOW=0
USE_SYSTEMCTL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user) TARGET_USER="$2"; shift 2 ;;
    --components) COMPONENTS="$2"; COMPONENTS_GIVEN=1; shift 2 ;;
    --download-mediamtx) DOWNLOAD_MTX=1; shift ;;
    --now) START_NOW=1; shift ;;
    --no-systemctl) USE_SYSTEMCTL=0; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

ok()   { echo -e "  \e[32m✔\e[0m $*"; }
warn() { echo -e "  \e[33m!\e[0m $*"; WARNINGS=$((WARNINGS + 1)); }
step() { echo -e "\n\e[1m$*\e[0m"; }
WARNINGS=0

if [ "$USE_SYSTEMCTL" = 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo $0 $*"; exit 1
fi
for c in $COMPONENTS; do
  [[ " $ALL_COMPONENTS " == *" $c "* ]] || { echo "알 수 없는 구성요소: $c  (가능: $ALL_COMPONENTS)"; exit 1; }
done
if [ -z "$DESTDIR" ]; then
  USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  [ -n "$USER_HOME" ] || { echo "사용자 $TARGET_USER 가 없습니다"; exit 1; }
else
  USER_HOME="/home/$TARGET_USER"
fi

# ~/dashboard/start_dash.sh 가 있으면 관제 대시보드도 함께 자동 실행
if [ "$COMPONENTS_GIVEN" = 0 ] && [ -f "$USER_HOME/dashboard/start_dash.sh" ]; then
  COMPONENTS="$COMPONENTS dashboard"
  DASH_FOUND=1
fi

echo "TurtleBot3 자동 실행 설치"
echo "  사용자      : $TARGET_USER ($USER_HOME)"
echo "  robot-side  : $ROBOT_SIDE"
echo "  구성요소    : $COMPONENTS"

# ---------------------------------------------------------------- 사전 점검
step "1. 사전 점검"
[ -f "/opt/ros/jazzy/setup.bash" ] && ok "ROS 2 Jazzy" || warn "/opt/ros/jazzy 가 없습니다"
has_pkg() { dpkg -s "$1" >/dev/null 2>&1; }
if [[ " $COMPONENTS " == *" rosbridge "* ]]; then
  has_pkg ros-jazzy-rosbridge-suite && ok "rosbridge_suite" || warn "rosbridge 미설치 → sudo apt install ros-jazzy-rosbridge-suite"
fi
if [[ " $COMPONENTS " == *" video "* ]]; then
  command -v ffmpeg >/dev/null && ok "ffmpeg" || warn "ffmpeg 미설치 → sudo apt install ffmpeg"
fi
if [[ " $COMPONENTS " == *" mqtt "* ]]; then
  python3 -c "import paho.mqtt" 2>/dev/null && ok "paho-mqtt" || warn "paho-mqtt 미설치 → sudo apt install python3-paho-mqtt"
fi
if [ -z "$DESTDIR" ]; then
  for g in dialout video; do
    id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx "$g" && ok "$TARGET_USER ∈ $g 그룹" \
      || warn "$TARGET_USER 가 $g 그룹이 아님 → sudo usermod -aG $g $TARGET_USER (서비스는 SupplementaryGroups 로 동작하지만 수동 실행용으로 권장)"
  done
fi

if [ "${DASH_FOUND:-0}" = 1 ]; then
  ok "$USER_HOME/dashboard/start_dash.sh 발견 → 대시보드도 자동 실행"
  [ -x "$USER_HOME/dashboard/start_dash.sh" ] || warn "start_dash.sh 에 실행 권한이 없어 bash 로 실행합니다 (chmod +x 권장)"
fi

# ---------------------------------------------------------------- MediaMTX
if [[ " $COMPONENTS " == *" mediamtx "* ]]; then
  step "2. MediaMTX"
  if [ -x "$ROBOT_SIDE/mediamtx" ]; then
    ok "$ROBOT_SIDE/mediamtx 있음"
  elif [ "$DOWNLOAD_MTX" = 1 ]; then
    case "$(uname -m)" in
      aarch64|arm64) arch=arm64 ;; armv7l) arch=armv7 ;; armv6l) arch=armv6 ;; x86_64) arch=amd64 ;;
      *) echo "지원하지 않는 아키텍처: $(uname -m)"; exit 1 ;;
    esac
    url="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_${arch}.tar.gz"
    echo "  받는 중: $url"
    tmp="$(mktemp -d)"
    curl -fsSL "$url" -o "$tmp/mtx.tar.gz"
    tar -xzf "$tmp/mtx.tar.gz" -C "$tmp" mediamtx
    install -m 755 "$tmp/mediamtx" "$ROBOT_SIDE/mediamtx"
    rm -rf "$tmp"
    [ -z "$DESTDIR" ] && chown "$TARGET_USER": "$ROBOT_SIDE/mediamtx" || true
    ok "MediaMTX ${MEDIAMTX_VERSION} (${arch}) 설치"
  else
    warn "MediaMTX 실행 파일이 없습니다 → sudo $0 --download-mediamtx  (또는 $ROBOT_SIDE/mediamtx 에 직접 두기)"
  fi
fi

# ---------------------------------------------------------------- 설정 파일
step "3. 설정 파일"
mkdir -p "$ETC_DIR"
if [ -f "$ETC_DIR/robot.env" ]; then
  ok "$ETC_DIR/robot.env 유지 (기존 설정 보존)"
else
  sed -e "s|@HOME@|$USER_HOME|g" -e "s|@ROBOT_SIDE@|$ROBOT_SIDE|g" -e "s|@REPO@|$REPO|g" \
    "$HERE/robot.env.example" > "$ETC_DIR/robot.env"
  chmod 644 "$ETC_DIR/robot.env"
  ok "$ETC_DIR/robot.env 생성 — TURTLEBOT3_MODEL·워크스페이스 경로를 확인하세요"
fi
chmod 755 "$HERE/tb3-run.sh" "$HERE/tb3ctl"

# ---------------------------------------------------------------- systemd
step "4. systemd 유닛"
mkdir -p "$SYSTEMD_DIR" "$BIN_DIR"
sed -e "s|@USER@|$TARGET_USER|g" -e "s|@ROBOT_SIDE@|$ROBOT_SIDE|g" "$HERE/tb3@.service.in" > "$SYSTEMD_DIR/tb3@.service"
install -m 644 "$HERE/tb3.target" "$SYSTEMD_DIR/tb3.target"
ln -sf "$HERE/tb3ctl" "$BIN_DIR/tb3ctl"
ok "tb3@.service, tb3.target, /usr/local/bin/tb3ctl"

if [ "$USE_SYSTEMCTL" = 1 ]; then
  systemctl daemon-reload
  # 이전에 켜 둔 것 중 이번 목록에 없는 것은 끔
  for c in $ALL_COMPONENTS; do
    if [[ " $COMPONENTS " != *" $c "* ]] && systemctl is-enabled --quiet "tb3@$c" 2>/dev/null; then
      systemctl disable --quiet "tb3@$c"; ok "tb3@$c 끔"
    fi
  done
  for c in $COMPONENTS; do systemctl enable --quiet "tb3@$c"; done
  systemctl enable --quiet tb3.target
  ok "부팅 시 자동 실행 등록: $COMPONENTS"
  # 부팅 직후 Wi-Fi 연결을 기다리도록
  if systemctl list-unit-files systemd-networkd-wait-online.service >/dev/null 2>&1; then
    systemctl is-enabled --quiet systemd-networkd-wait-online.service 2>/dev/null \
      || warn "network-online 대기 서비스가 꺼져 있음 — 영상 주소(Wi-Fi IP)가 늦게 잡히면 sudo tb3ctl restart mediamtx"
  fi
  if [ "$START_NOW" = 1 ]; then
    systemctl restart tb3.target
    for c in $COMPONENTS; do systemctl start "tb3@$c"; done
    ok "시작함"
  fi
fi

# ---------------------------------------------------------------- 안내
step "완료"
[ "$WARNINGS" -gt 0 ] && echo -e "  \e[33m경고 ${WARNINGS}개\e[0m — 위 내용을 먼저 해결하세요."
cat <<EOF
  설정 확인   : sudo nano /etc/tb3/robot.env
  지금 시작   : sudo tb3ctl start
  상태 보기   : tb3ctl status
  로그 보기   : tb3ctl logs video        (Ctrl+C 로 나가기)
  재부팅 시험 : sudo reboot  → 1~2분 뒤 대시보드에서 ws://<로봇IP>:${ROSBRIDGE_PORT:-9090} 연결
EOF
