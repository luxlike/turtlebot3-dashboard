# 실물 터틀봇3 모니터링 가이드

대시보드(PC 브라우저)와 로봇(SBC, Raspberry Pi)을 연결해 실제 터틀봇을 보고 조종하기까지의 순서입니다.
ROS 2 Jazzy · Ubuntu 24.04 on Pi 기준입니다.

```
[PC]  브라우저 ── 대시보드 (Next.js, http://localhost:3000)
        │ ws://로봇IP:9090        rosbridge — 토픽 주고받기
        │ http://로봇IP:8889      MediaMTX — WebRTC 영상   (또는 :8080 web_video_server — MJPEG)
[SBC] rosbridge_server · MediaMTX · image_to_rtsp.py
        └─ ROS 2 (turtlebot3_bringup, camera_ros, walle_vision, walle_arm)
```

순서: **1. PC에서 시뮬레이터로 확인 → 2. 전원 준비 → 3. 로봇 bringup + rosbridge → 4. 영상 → 5. 확인**

---

## 1. PC — 대시보드 실행 (로봇 없이)

Node.js **20.9 이상**(LTS 20/22)이 필요합니다.

```bash
node -v
cd robot-dashboard
npm install
npm run dev                       # http://localhost:3000
```

처음에는 **시뮬레이터 모드**로 켜집니다. 헤더에 초록 점 + "온라인"이 보이면 정상입니다.

| 해 볼 것 | 결과 |
|---|---|
| `W A S D` 또는 조이스틱 | 3D 뷰·지도에서 로봇 이동 |
| "손 흔들기" | 3D 뷰의 팔이 움직임 |
| "회피" | 장애물 피해 돌아다님 |
| 지도 🚩 → 지도에서 누르고 끌기 | 그 지점·방향으로 이동 (Nav2 목표) |
| `Space` | E-STOP, 조종 잠김 (헤더 버튼을 다시 눌러 해제) |

- 휴대폰·태블릿에서 보려면 `npm run dev -- -H 0.0.0.0` 후 `http://PC의IP:3000`.
- 회사망에서 `npm install` 이 `SELF_SIGNED_CERT_IN_CHAIN` 으로 실패하면 SSL 검사 때문입니다.
  `export NODE_EXTRA_CA_CERTS=/경로/회사루트인증서.pem` 과 `npm config set cafile /경로/회사루트인증서.pem` 후 다시 설치하세요.

---

## 2. 전원 — 배터리가 꼭 필요한가?

아니요. 다만 터틀봇은 전원이 두 갈래입니다.

- **Raspberry Pi (5 V)** — 네트워크, ROS 2, rosbridge, 카메라, LiDAR(USB 전원)
- **OpenCR (12 V)** — 바퀴 모터, OpenMANIPULATOR-X 다이나믹셀

| 전원 | 대시보드에서 되는 것 |
|---|---|
| Pi만 USB-C 어댑터 | 연결·카메라·LiDAR ✅ / 바퀴·odom·팔·배터리 ❌ |
| OpenCR에 **SMPS 12 V 5 A** | 전부 ✅ (책상 작업용 추천) |
| 배터리 (11.1 V LiPo) | 전부 ✅ (실제 주행) |

- 12 V 어댑터로 테스트할 때는 **로봇을 받침대 위에 올려 바퀴를 띄우세요.** 팔은 실제로 움직이니 주변을 비우세요.
- 경로 B(버거 + U2D2)는 팔 쪽 U2D2 Power Hub에도 12 V가 따로 필요합니다.
- 어댑터 사용 시 배터리 칸은 어댑터 전압(≈12 V)을 보여 주므로 11.0 V 경고는 의미가 없습니다.
- **이중 전원 주의:** Pi를 USB-C로 켜면서 OpenCR에도 12 V를 넣으면 Pi에 5 V가 두 경로로 들어갈 수 있습니다.
  12 V로 전부 켤 때는 Pi의 USB-C를 빼고, Pi만 따로 켤 때는 OpenCR→Pi 5 V 케이블을 빼세요.
- Pi 4는 5 V 3 A 이상 어댑터를 쓰세요.

---

## 3. SBC — 로봇 bringup + rosbridge

### 팔 없는 기본 구성 (현재 워크스페이스)

`turtlebot3_manipulation_bringup hardware.launch.py` 는 **Waffle Pi + 팔을 OpenCR에 연결한 경로 A 전용**입니다.
패키지가 없다는 오류(`Package 'turtlebot3_manipulation_bringup' not found`)가 나면 아래 일반 bringup을 쓰세요.

```bash
# 터미널 1 — 로봇 bringup
export TURTLEBOT3_MODEL=burger            # Waffle Pi 면 waffle_pi
export LDS_MODEL=LDS-02
ros2 launch turtlebot3_bringup robot.launch.py

# 터미널 2 — 카메라
source ~/camera_ws/install/setup.bash
ros2 run camera_ros camera_node --ros-args -p width:=640 -p height:=480 -p format:=RGB888

# 터미널 3 — 비전 노드 (쓸 때만)
ros2 launch walle_vision vision.launch.py profile:=burger      # 또는 waffle

# 터미널 4 — 대시보드 연결
sudo apt install ros-jazzy-rosbridge-suite                    # 처음 한 번
ros2 launch rosbridge_server rosbridge_websocket_launch.xml   # "started on port 9090" 확인
```

`walle_arm` 을 아직 빌드하지 않았다면 팔 launch는 건너뜁니다. 이때 대시보드의 팔 버튼·joints 칩은 반응이 없는 게 정상입니다.

### 팔을 단 구성

| | 경로 A (Waffle Pi + 팔 → OpenCR) | 경로 B (Burger + U2D2) |
|---|---|---|
| 준비 | `turtlebot3_manipulation` 빌드 + **OpenCR 펌웨어 교체** | `open_manipulator` 빌드, 펌웨어 그대로 |
| bringup | `turtlebot3_manipulation_bringup hardware.launch.py` | `turtlebot3_bringup robot.launch.py` + `walle_arm burger_arm.launch.py` |
| 월-E 노드 | `walle_arm walle_arm.launch.py profile:=waffle` | `walle_arm walle_arm.launch.py profile:=burger` |
| 대시보드 JointState | `/joint_states` | `/arm/joint_states` |

펌웨어를 바꾸면 일반 `robot.launch.py` 대신 경로 A bringup을 써야 하므로, 팔을 실제로 연결한 뒤에 하세요.
자세한 설치는 walle_arm README를 참고하세요.

### 방화벽 (ufw를 켠 경우만)

```bash
sudo ufw allow 9090/tcp      # rosbridge
sudo ufw allow 8889/tcp      # MediaMTX WebRTC (WHEP)
sudo ufw allow 8189/udp      # MediaMTX WebRTC 미디어
sudo ufw allow 8080/tcp      # web_video_server (MJPEG)
```

### 대시보드 연결 설정 (⚙)

1. 통신 **rosbridge**, `ws://<SBC IP>:9090` (IP는 SBC에서 `hostname -I`)
2. 로봇 모델: Waffle Pi / Burger
3. **cmd_vel 메시지 타입** — SBC에서 확인:
   ```bash
   ros2 topic info /cmd_vel -v      # Subscription 의 Topic type
   ```
   `TwistStamped` 면 TwistStamped 선택. 다르면 **조종해도 로봇이 안 움직입니다.**
4. 경로 B면 JointState를 `/arm/joint_states`, mount_x/z를 실측값으로
5. **적용 · 재연결** (설정은 브라우저에 저장됨)

---

## 4. 영상

> **시뮬레이터 모드에서는 실제 영상이 안 나옵니다.** 통신이 시뮬레이터면 영상 설정과 무관하게 가짜 화면(빨간 공)이 나옵니다.
> 통신을 rosbridge로 바꿔야 실제 영상으로 바뀝니다.

카메라 토픽 확인:
```bash
ros2 topic hz /camera/image_raw                              # 10~30 Hz
ros2 topic echo /camera/image_raw --field encoding --once    # bgr8/rgb8/bgra8/rgba8/yuyv/mono8 이면 OK
```

walle_vision과 함께 써도 됩니다. 둘 다 같은 `/camera/image_raw` 를 구독할 뿐 카메라를 따로 열지 않습니다.

### A. MJPEG — 간단한 확인용

```bash
# [SBC]
sudo apt install ros-jazzy-web-video-server
ros2 run web_video_server web_video_server
```
- 먼저 PC 브라우저로 `http://<SBC IP>:8080` → `/camera/image_raw` 링크로 확인
- 대시보드 ⚙ 영상 **MJPEG**, URL
  `http://<SBC IP>:8080/stream?topic=/camera/image_raw&type=mjpeg&quality=60`

### B. WebRTC — 저지연 (권장)

설치 (SBC, 한 번만):
```bash
# [PC] robot-side 폴더를 SBC로 복사
scp -r robot-dashboard/robot-side <user>@<SBC IP>:~/

# [SBC]
sudo apt install ffmpeg
cd ~/robot-side
wget https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_linux_arm64.tar.gz
tar -xzf mediamtx_v1.21.2_linux_arm64.tar.gz       # uname -m 이 aarch64 면 arm64
```
`mediamtx.yml` 에 SBC Wi-Fi IP 지정:
```yaml
webrtcAdditionalHosts: [192.168.0.xx]
```

실행 (SBC):
```bash
# 터미널 A — 카메라 (3장, 이미 떠 있으면 생략)

# 터미널 B — 스트리밍 서버
cd ~/robot-side && ./mediamtx mediamtx.yml          # "[WebRTC] listener opened on :8889"

# 터미널 C — ROS 영상 → H.264 → MediaMTX
cd ~/robot-side
source ~/camera_ws/install/setup.bash
python3 image_to_rtsp.py --ros-args -p image_topic:=/camera/image_raw -p fps:=15
#   → 터미널 B 에 "[path cam] stream is available and online"
#   CPU 가 높으면  -p encoder:=h264_v4l2m2m  (Pi 4 하드웨어 인코더)
```
- PC 브라우저 `http://<SBC IP>:8889/cam` 에서 MediaMTX 자체 플레이어로 먼저 확인
- 대시보드 ⚙ 영상 **WebRTC (WHEP)**, URL `http://<SBC IP>:8889/cam/whep`
- 카메라 패널에 `WebRTC · LIVE` + 해상도·fps·RTT가 나오면 성공

`./start_robot_side.sh rosbridge` 로 rosbridge + MediaMTX + image_to_rtsp 를 한 번에 띄울 수도 있습니다
(bringup·카메라·walle 노드는 따로).

---

## 5. 연결 확인 — 텔레메트리 "토픽 수신" 칩

| 칩 | 정상 | 안 들어오면 |
|---|---|---|
| odom, scan, battery | 초록 + Hz | bringup 확인, SBC에서 `ros2 topic hz /odom` |
| joints | 초록 | 팔 bringup·토픽 이름 확인 (경로 B `/arm/joint_states`) |
| walle, vision | 초록 또는 `<1Hz` | walle 노드 실행 확인 |
| map, amcl | SLAM·Nav2 켰을 때만 | 평소엔 "—" 정상 |

처음 조종할 때는 **속도 한계 슬라이더를 낮추고** 주변을 비운 상태에서 시작하세요.

---

## 6. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| 헤더 "오류", 계속 재접속 | rosbridge 꺼짐 또는 IP·포트 오타. PC에서 `nc -zv <IP> 9090` |
| 연결은 되는데 토픽이 전부 "—" | SBC 안에서 `ros2 topic list` 확인. bringup 미실행 또는 ROS_DOMAIN_ID 불일치 |
| 조종해도 안 움직임 | cmd_vel 타입 불일치 / E-STOP 잠금 / walle_vision이 자율 모드로 cmd_vel 발행 중 |
| 팔 버튼 무반응 | 주행 중 motion_lock 대기, 또는 팔 토픽 이름 |
| 카메라 패널이 계속 빨간 공 | 통신이 시뮬레이터 → rosbridge로 |
| `WHEP 404` | MediaMTX에 영상 미유입 → 터미널 C 로그, `ros2 topic hz /camera/image_raw` |
| `Failed to fetch` | MediaMTX 꺼짐·IP 오타·방화벽 |
| "연결 끊김 — 재시도" 반복 | `webrtcAdditionalHosts` 에 SBC Wi-Fi IP |
| "지원하지 않는 encoding" | 카메라에 `-p format:=RGB888` |
| 영상 끊김 | `fps:=10`, 또는 카메라 `width:=480 height:=360` |
| 실내 맵이 비어 있음 | SLAM/Nav2를 켜야 `/map` 이 나옴 |
| 대시보드를 https로 열었더니 연결 안 됨 | 브라우저가 ws:// · http:// 영상을 막음(mixed content). LAN에서는 http로 |

### 포트가 이미 사용 중일 때 (예: 8080)

```bash
sudo ss -ltnp | grep :8080        # 프로그램 이름·pid 확인
sudo kill <pid>                   # 안 죽으면 sudo kill -9 <pid>
sudo fuser -k 8080/tcp            # 한 번에 종료
sudo systemctl stop nginx         # 서비스라면 (이름에 맞게), 부팅 시 끄기: disable
```
끄기 곤란하면 다른 포트로: `ros2 run web_video_server web_video_server --ros-args -p port:=8081`
(대시보드 MJPEG URL도 8081로).

---

## 7. 운영 배포 (PC 없이 접속)

```bash
# [PC]
npm run build                                  # out/ 생성
scp -r out <user>@<SBC IP>:~/dashboard
# [SBC]
cd ~/dashboard && python3 -m http.server 3000
```
아무 기기에서 `http://<SBC IP>:3000`. (web_video_server가 8080을 쓰므로 다른 포트로)
접속할 때마다 설정을 넣기 싫으면 `.env.example` → `.env.local` 로 복사해 IP를 채운 뒤 빌드하세요.

---

## 검증 상태

| 항목 | 상태 |
|---|---|
| 시뮬레이터 모드 전체 UI | 헤드리스 브라우저로 확인 |
| MQTT 송수신 (odom·scan·battery 수신, cmd_vel·제스처 발신) | 로컬 브로커로 확인 |
| rosbridge 실물 연결 | 실물 확인 필요 |
| WebRTC 영상 (MediaMTX + image_to_rtsp.py) | 실물 확인 필요 |
| ros2_mqtt_bridge.py | 문법·설정 파일만 확인 |
