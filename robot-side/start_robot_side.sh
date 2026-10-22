#!/usr/bin/env bash
# [SBC] 대시보드용 서버 쪽 프로세스를 한 번에 띄우는 예시 (bringup·카메라·walle 노드는 별도 터미널)
#   ./start_robot_side.sh rosbridge   # rosbridge + 영상
#   ./start_robot_side.sh mqtt        # MQTT 브리지 + 영상
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-rosbridge}"
source /opt/ros/jazzy/setup.bash
[ -f ~/turtlebot3_ws/install/setup.bash ] && source ~/turtlebot3_ws/install/setup.bash

pids=()
trap 'kill ${pids[@]} 2>/dev/null' EXIT INT TERM

if [ "$MODE" = "rosbridge" ]; then
  # sudo apt install ros-jazzy-rosbridge-suite
  ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9090 &
  pids+=($!)
else
  python3 ros2_mqtt_bridge.py --ros-args -p config:=bridge.yaml &
  pids+=($!)
fi

# 영상: MediaMTX 가 같은 폴더에 있다고 가정
if [ -x ./mediamtx ]; then
  ./mediamtx mediamtx.yml &
  pids+=($!)
  sleep 1
  python3 image_to_rtsp.py --ros-args -p image_topic:=/camera/image_raw -p url:=rtsp://localhost:8554/cam -p fps:=15 &
  pids+=($!)
else
  echo "mediamtx 실행 파일이 없어 영상은 건너뜁니다 (README 4장 참고)"
fi

wait
