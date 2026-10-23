#!/usr/bin/env bash
# tb3@<component>.service 가 실행하는 런처. ROS 환경을 잡은 뒤 해당 프로그램으로 exec 합니다.
#   직접 시험:  /etc/tb3/robot.env 를 읽어  ./tb3-run.sh camera
#   명령만 보기: TB3_DRY_RUN=1 ./tb3-run.sh video
set -eo pipefail     # -u 는 쓰지 않음 (ROS setup.bash 가 미정의 변수를 참조)

COMP="${1:?사용법: tb3-run.sh <bringup|camera|rosbridge|mediamtx|video|vision|arm|mqtt|dashboard>}"
ENV_FILE="${TB3_ENV_FILE:-/etc/tb3/robot.env}"
ROBOT_SIDE="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"

log() { echo "[tb3-$COMP] $*"; }
die() { log "오류: $*"; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE 이 없습니다 (sudo ./install.sh 를 먼저 실행)"
set -a; source "$ENV_FILE"; set +a

run() {
  if [ -n "${TB3_DRY_RUN:-}" ]; then printf '%q ' "$@"; echo; exit 0; fi
  log "실행: $*"
  exec "$@"
}

wait_for_port() {   # wait_for_port <port> <timeout_s>
  local i=0
  [ -n "${TB3_DRY_RUN:-}" ] && return 0
  until (echo > "/dev/tcp/127.0.0.1/$1") 2>/dev/null; do
    i=$((i + 1)); [ "$i" -ge "$2" ] && die "포트 $1 이 ${2}초 동안 열리지 않음"
    sleep 1
  done
}

wait_for_dev() {    # wait_for_dev <path> <timeout_s>
  local i=0
  [ -z "$1" ] || [ -n "${TB3_DRY_RUN:-}" ] && return 0
  until [ -e "$1" ]; do
    i=$((i + 1)); [ "$i" -ge "$2" ] && die "$1 장치가 없습니다 (USB 케이블·전원 확인)"
    sleep 1
  done
}

source_ros() {
  local setup="/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"
  [ -f "$setup" ] || die "$setup 이 없습니다"
  source "$setup"
  for ws in ${TB3_WORKSPACES:-}; do
    if [ -f "$ws/install/setup.bash" ]; then source "$ws/install/setup.bash"
    else log "경고: $ws/install/setup.bash 없음 — 건너뜀"; fi
  done
}

# 공백이 든 *_CMD / *_ARGS 를 단어로 나눔 (따옴표 안 공백은 지원하지 않음)
split() { read -r -a WORDS <<< "$1"; }

case "$COMP" in
  bringup)
    source_ros
    wait_for_dev "${OPENCR_DEV:-}" 60
    split "${BRINGUP_CMD:-ros2 launch turtlebot3_bringup robot.launch.py}"
    run "${WORDS[@]}"
    ;;
  camera)
    source_ros
    split "${CAMERA_ARGS:-}"
    run ros2 run camera_ros camera_node --ros-args "${WORDS[@]}"
    ;;
  rosbridge)
    source_ros
    run ros2 launch rosbridge_server rosbridge_websocket_launch.xml "port:=${ROSBRIDGE_PORT:-9090}"
    ;;
  mediamtx)
    bin="${MEDIAMTX_BIN:-$ROBOT_SIDE/mediamtx}"
    [ -x "$bin" ] || [ -n "${TB3_DRY_RUN:-}" ] || die "$bin 이 없습니다 (sudo ./install.sh --download-mediamtx)"
    # 브라우저가 붙을 수 있도록 로봇의 IPv4 주소를 WebRTC 후보로 알려 줌 (MediaMTX 환경변수 덮어쓰기)
    ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | paste -sd, -)"
    [ -n "$ips" ] && export MTX_WEBRTCADDITIONALHOSTS="$ips" && log "WebRTC 주소: $ips"
    run "$bin" "${MEDIAMTX_CONF:-$ROBOT_SIDE/mediamtx.yml}"
    ;;
  video)
    source_ros
    wait_for_port 8554 120          # MediaMTX RTSP
    run python3 "$ROBOT_SIDE/image_to_rtsp.py" --ros-args \
      -p "image_topic:=${CAMERA_TOPIC:-/camera/image_raw}" \
      -p "url:=rtsp://127.0.0.1:8554/cam" \
      -p "fps:=${VIDEO_FPS:-15}" \
      -p "encoder:=${VIDEO_ENCODER:-libx264}" \
      -p "bitrate:=${VIDEO_BITRATE:-800k}"
    ;;
  vision)
    source_ros
    split "${VISION_CMD:?VISION_CMD 를 robot.env 에 설정하세요}"
    run "${WORDS[@]}"
    ;;
  arm)
    source_ros
    split "${ARM_CMD:?ARM_CMD 를 robot.env 에 설정하세요}"
    run "${WORDS[@]}"
    ;;
  mqtt)
    source_ros
    run python3 "$ROBOT_SIDE/ros2_mqtt_bridge.py" --ros-args -p "config:=${MQTT_CONFIG:-$ROBOT_SIDE/bridge.yaml}"
    ;;
  dashboard)
    dir="${DASHBOARD_DIR:-$ROBOT_SIDE/../out}"
    [ -f "$dir/index.html" ] || [ -n "${TB3_DRY_RUN:-}" ] || die "$dir/index.html 이 없습니다 (PC 에서 npm run build 후 out/ 복사)"
    run python3 -m http.server "${DASHBOARD_PORT:-3000}" --directory "$dir"
    ;;
  *)
    die "알 수 없는 구성요소: $COMP"
    ;;
esac
