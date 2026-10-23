# 부팅 시 자동 실행

터틀봇(SBC)을 켜기만 하면 bringup · 카메라 · rosbridge · 영상 서버가 자동으로 뜨고,
1~2분 뒤 대시보드에서 바로 연결할 수 있게 합니다. systemd 서비스로 동작하므로
죽으면 5초 뒤 다시 살아나고, 로그는 `journalctl` 에 남습니다.

```
전원 ON → Ubuntu 부팅 → Wi-Fi 연결 → tb3.target
                                      ├─ tb3@bringup     turtlebot3_bringup (OpenCR /dev/ttyACM0 을 기다렸다가)
                                      ├─ tb3@camera      camera_ros → /camera/image_raw
                                      ├─ tb3@rosbridge   ws://<로봇IP>:9090
                                      ├─ tb3@mediamtx    WebRTC :8889  (로봇 IP 자동 등록)
                                      ├─ tb3@video       image_to_rtsp.py (MediaMTX 가 열릴 때까지 대기)
                                      └─ 선택: vision · arm · mqtt · dashboard
```

---

## 1. 설치 (SBC, 한 번만)

```bash
# 저장소 받기 (이미 있으면 git pull)
cd ~
git clone https://github.com/luxlike/turtlebot3-dashboard.git
cd turtlebot3-dashboard/robot-side/autostart

# 필요한 패키지
sudo apt install ros-jazzy-rosbridge-suite ffmpeg

# 설치 + MediaMTX 받기 + 바로 시작
sudo ./install.sh --download-mediamtx --now
```

설치 스크립트가 하는 일:
1. ROS·rosbridge·ffmpeg 설치 여부, 사용자의 `dialout`(OpenCR)·`video`(카메라) 그룹 확인
2. MediaMTX v1.21.2 를 아키텍처에 맞게 받아 `robot-side/mediamtx` 에 저장
3. 설정 파일 `/etc/tb3/robot.env` 생성 (이미 있으면 그대로 둠)
4. `tb3@.service`, `tb3.target` 설치, `tb3ctl` 명령 등록, 부팅 시 자동 실행 등록

**경고(!)가 나오면 먼저 해결**하세요. 예: `rosbridge 미설치`, `MediaMTX 실행 파일이 없습니다`.

## 2. 설정 확인

```bash
sudo nano /etc/tb3/robot.env
```

꼭 확인할 값:

| 항목 | 기본값 | 설명 |
|---|---|---|
| `TURTLEBOT3_MODEL` | `burger` | Waffle Pi 면 `waffle_pi` |
| `TB3_WORKSPACES` | `~/camera_ws ~/turtlebot3_ws` | source 할 워크스페이스 (순서대로) |
| `ROS_DOMAIN_ID` | `30` | PC 에서 `ros2 topic list` 로 볼 때 PC 와 같은 값 |
| `BRINGUP_CMD` | `turtlebot3_bringup robot.launch.py` | 경로 A(팔+OpenCR)면 `turtlebot3_manipulation_bringup hardware.launch.py` |
| `CAMERA_ARGS` | `640x480, RGB888` | 해상도·포맷 |
| `VIDEO_ENCODER` | `libx264` | CPU 가 높으면 `h264_v4l2m2m` (Pi 4) |

고친 뒤에는 `sudo tb3ctl restart` 로 적용합니다.

## 3. 확인

```bash
tb3ctl status
```
```
구성요소   자동실행 상태       비고
bringup    enabled  active
camera     enabled  active
rosbridge  enabled  active
mediamtx   enabled  active
video      enabled  active

포트: rosbridge 9090 열림 · WebRTC 8889 열림 · RTSP 8554 열림
대시보드 설정: rosbridge ws://192.168.0.50:9090 · 영상 http://192.168.0.50:8889/cam/whep
```

마지막 줄의 주소를 대시보드 ⚙ 설정에 넣으면 됩니다. 그다음 **재부팅 시험**:

```bash
sudo reboot
# 1~2분 뒤 PC 대시보드에서 연결되는지 확인
```

## 4. tb3ctl 명령

| 명령 | 하는 일 |
|---|---|
| `tb3ctl status` | 구성요소별 상태, 재시작 횟수, 포트, 대시보드에 넣을 주소 |
| `tb3ctl logs video` | 해당 구성요소 로그 따라가기 (이름 없으면 전체) |
| `sudo tb3ctl restart` | 전체 재시작 (설정 바꾼 뒤) |
| `sudo tb3ctl restart camera` | 하나만 재시작 |
| `sudo tb3ctl stop` / `start` | 전체 정지 / 시작 |
| `sudo tb3ctl enable vision` | 선택 기능을 자동 실행에 추가하고 바로 시작 |
| `sudo tb3ctl disable vision` | 자동 실행에서 빼고 정지 |
| `tb3ctl run camera` | 서비스 대신 터미널에서 직접 실행 (디버깅, 먼저 `sudo tb3ctl stop camera`) |

### 선택 기능

| 이름 | 내용 | 켜기 전에 |
|---|---|---|
| `vision` | walle_vision (idle 로 시작 → 대시보드에서 모드 선택) | `VISION_CMD` 의 profile 확인 |
| `arm` | walle_arm 월-E 팔 노드 | walle_arm 빌드, 팔 bringup 구성 |
| `mqtt` | ROS 2 ↔ MQTT 브리지 | mosquitto 설치, `bridge.yaml` |
| `dashboard` | 로봇이 대시보드를 직접 서비스 → `http://<로봇IP>:3000` | PC 에서 `npm run build` 후 `out/` 를 로봇의 `~/turtlebot3-dashboard/out` 으로 복사 |

`dashboard` 를 켜고 `http://<로봇IP>:3000` 으로 접속하면, 처음 열 때 **같은 로봇의 rosbridge·영상으로 자동 연결**됩니다
(설정 입력 불필요). 휴대폰으로 바로 관제할 때 편합니다.

```bash
# [PC]
npm run build
scp -r out <user>@<로봇IP>:~/turtlebot3-dashboard/
# [SBC]
sudo tb3ctl enable dashboard
```

## 5. 동작 방식과 안전

- **재시작:** 프로그램이 죽으면 5초 뒤 자동 재시작, 횟수 제한 없음. `tb3ctl status` 의 "재시작 N회"가 계속 늘면 로그를 보세요.
- **순서:** bringup 은 OpenCR(`/dev/ttyACM0`)이 잡힐 때까지 최대 60초 기다리고, video 는 MediaMTX 가 열릴 때까지 기다립니다.
- **정지:** 서비스 정지·재부팅 때 `ros2 launch` 에 SIGINT 를 보내 노드들이 정상 종료합니다 (walle_vision 은 종료 직전 정지 명령 발행).
- **로봇이 저절로 움직이지 않습니다.** 자동 실행되는 것은 bringup·센서·통신뿐이고, walle_vision 은 `idle` 로 시작합니다.
  주행은 대시보드에서 조종하거나 모드를 골라야 시작됩니다.
- **영상 주소:** MediaMTX 가 시작할 때 로봇의 IPv4 주소를 WebRTC 후보로 자동 등록합니다
  (`mediamtx.yml` 의 `webrtcAdditionalHosts` 를 따로 고칠 필요 없음). Wi-Fi 가 바뀌어 IP 가 달라지면 `sudo tb3ctl restart mediamtx`.
- **전원:** 12 V 어댑터 없이 Pi 전원만 넣으면 bringup 이 모터 초기화 단계에서 계속 재시작될 수 있습니다. 카메라·rosbridge·영상은 그래도 동작합니다.

## 6. 문제 해결

| 증상 | 확인 |
|---|---|
| `tb3ctl: command not found` | `sudo ./install.sh` 를 다시 실행 |
| bringup 재시작 반복, "장치가 없습니다" | OpenCR USB 케이블, 12 V 전원. `ls /dev/ttyACM*` |
| bringup 재시작 반복, 그 외 | `tb3ctl logs bringup`. `TURTLEBOT3_MODEL`·`LDS_MODEL`·워크스페이스 경로 |
| camera 재시작 반복 | 다른 프로그램이 카메라를 열고 있는지 (수동으로 띄운 camera_node 를 끄세요). `tb3ctl logs camera` |
| video "포트 8554 가 열리지 않음" | `tb3ctl logs mediamtx` — 실행 파일 경로(`MEDIAMTX_BIN`) 확인 |
| 대시보드 영상 `WHEP 404 — no stream is available` | 카메라·video 서비스 상태, `ros2 topic hz /camera/image_raw` |
| 대시보드 영상 `codecs not supported by client` | H.264 를 못 쓰는 브라우저. Chrome·Edge·Safari 로 열기 (일부 리눅스 Chromium 빌드는 H.264 없음) |
| PC 에서 `ros2 topic list` 에 안 보임 | `ROS_DOMAIN_ID` 를 PC 와 같게 |
| 수동으로 띄우던 노드와 충돌 | 자동 실행 중에는 같은 노드를 터미널에서 또 띄우지 마세요. 필요하면 `sudo tb3ctl stop <이름>` 후 실행 |

## 7. 제거

```bash
cd ~/turtlebot3-dashboard/robot-side/autostart
sudo ./uninstall.sh            # 설정(/etc/tb3/robot.env)은 남김
sudo ./uninstall.sh --purge    # 설정까지 삭제
```

## 파일

```
robot-side/autostart/
  install.sh            설치 (점검 · MediaMTX 받기 · 설정 · systemd 등록)
  uninstall.sh          제거
  tb3ctl                관리 명령 (/usr/local/bin/tb3ctl 로 링크)
  tb3-run.sh            각 서비스가 실행하는 런처 (ROS 환경 → 프로그램 exec)
  tb3@.service.in       systemd 템플릿 유닛 (설치 시 사용자·경로 채움)
  tb3.target            묶음 타깃 (multi-user.target 에 연결)
  robot.env.example     /etc/tb3/robot.env 원본
```

## 검증 상태

| 항목 | 상태 |
|---|---|
| 스크립트 문법 · shellcheck | 통과 |
| 설치 스크립트 (임시 경로에 파일 생성) · `systemd-analyze verify` | 통과 |
| 구성요소별 실행 명령 (dry-run) | 확인 |
| MediaMTX v1.21.2 + `mediamtx.yml` + IP 자동 등록 + image_to_rtsp.py(가짜 프레임) → 대시보드 WebRTC 재생 | 확인 (VP8 로 재생 확인, H.264 는 송출까지 확인) |
| 실제 Pi 에서 부팅 자동 실행 · bringup · 카메라 | 실물 확인 필요 |
