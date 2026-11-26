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
                                      ├─ tb3@dashboard   ~/dashboard/start_dash.sh (있으면 자동 포함)
                                      └─ 선택: vision · arm · mqtt · sound
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
1. ROS·rosbridge·ffmpeg 설치 여부, 사용자의 `dialout`(OpenCR)·`video`(카메라)·`audio`(스피커) 그룹 확인
2. MediaMTX v1.21.2 를 아키텍처에 맞게 받아 `robot-side/mediamtx` 에 저장
3. 설정 파일 `/etc/tb3/robot.env` 생성 (이미 있으면 그대로 둠)
4. `tb3@.service`, `tb3.target` 설치, `tb3ctl` 명령 등록, 부팅 시 자동 실행 등록
5. `~/dashboard/start_dash.sh` 가 있으면 **관제 대시보드도 자동 실행에 포함**

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
| `sound` | walle_sound 음성(TTS)·효과음, 시작하면 `ready` 음 | `sudo apt install alsa-utils espeak-ng`, walle_sound 빌드, `aplay -l` 에 재생 장치 |

### 스피커 (`sound`)

3.5mm 잭(또는 USB 사운드카드) → PAM8403 → 스피커로 `/walle/say`(음성)·`/walle/sound`(효과음)를 재생합니다.
켜 두면 부팅이 끝났을 때 `ready` 음이 나서 화면 없이도 준비 상태를 알 수 있고,
walle_arm 제스처(`/walle/command`)에 맞춰 효과음이 납니다.

```bash
sudo apt install alsa-utils espeak-ng
cd ~/turtlebot3_ws && colcon build --symlink-install --packages-select walle_sound
ros2 run walle_sound say --cards          # 재생 장치 확인 (먼저 이것부터)
sudo tb3ctl enable sound
ros2 topic pub --once /walle/say std_msgs/String "{data: '준비 완료'}"
```

- 장치·음량은 `/etc/tb3/robot.env` 의 `SOUND_CMD` (`device:=auto` 는 Headphones > USB > 첫 번째 카드 순으로 고름,
  `mixer_volume:=80`). 예전에 만든 robot.env 에 이 줄이 없어도 기본값으로 실행됩니다.
- 서비스는 사운드 카드가 잡힐 때까지 30초 기다리고, 없으면 오류로 끝난 뒤 5초마다 다시 시도합니다.
- 이미 설치해 둔 경우 `git pull` 만 하면 `tb3ctl`·런처가 갱신됩니다(저장소를 가리키는 링크).
  사용자가 `audio` 그룹이 아니면 `sudo usermod -aG audio $USER` 하거나 `sudo ./install.sh` 를 다시 실행하세요
  (새 서비스 유닛은 `SupplementaryGroups` 에 `audio` 포함). 다시 설치할 때는 `--components` 에 지금 켜 둔 항목을 모두 넣으세요 — 목록에 없는 것은 꺼집니다.

### 관제 대시보드 (`dashboard`)

로봇이 켜질 때 **`~/dashboard/start_dash.sh`** 를 실행해 대시보드도 함께 띄웁니다.
설치할 때 이 파일이 있으면 자동으로 포함되고, 나중에 만들었다면 `sudo tb3ctl enable dashboard` 로 켜면 됩니다.

- 스크립트는 **자기 폴더(`~/dashboard`)에서** 실행되므로 상대 경로를 그대로 써도 됩니다.
- 실행 권한이 있으면(`chmod +x`) 스크립트 첫 줄(shebang)대로, 없으면 `bash` 로 실행합니다.
- nvm 으로 설치한 node/npm 도 찾도록 `~/.nvm/nvm.sh` 와 `~/.local/bin` 을 경로에 넣습니다.
- 스크립트가 서버를 **앞에서 계속 실행**하든(`exec npm start`, `python3 -m http.server 3000` 등),
  **`&` 로 띄우고 끝나든** 둘 다 됩니다. 뒤의 경우 띄운 서버가 살아 있는 동안 서비스가 유지되고,
  서버가 죽으면 5초 뒤 스크립트를 다시 실행합니다.
- `sudo tb3ctl stop dashboard` 나 재부팅 때 스크립트가 띄운 프로세스까지 함께 정리합니다.
- 스크립트 위치를 바꾸려면 `/etc/tb3/robot.env` 의 `DASHBOARD_SCRIPT` 를 고치세요.
  스크립트가 없으면 `DASHBOARD_DIR`(빌드한 `out/`)을 `DASHBOARD_PORT` 로 바로 서비스합니다.

예시 `~/dashboard/start_dash.sh`:
```bash
#!/bin/bash
# 빌드한 정적 파일(out/)을 3000 포트로
exec python3 -m http.server 3000 --directory out
```
```bash
#!/bin/bash
# Next.js 프로젝트를 그대로 둔 경우
exec npm run start -- -p 3000       # 먼저 npm run build 필요 (output: export 설정이면 위 예시 사용)
```

확인:
```bash
tb3ctl status            # dashboard active + "대시보드 주소: http://<로봇IP>:3000"
tb3ctl logs dashboard    # 스크립트 출력
```

`http://<로봇IP>:<포트>` 로 접속하면 처음 열 때 **같은 로봇의 rosbridge·영상으로 자동 연결**됩니다
(이 저장소의 대시보드를 빌드해 쓴 경우). 휴대폰으로 바로 관제할 때 편합니다.
`tb3ctl status` 의 대시보드 주소는 `DASHBOARD_PORT`(기본 3000) 기준이니, 스크립트가 다른 포트를 쓰면 이 값도 맞춰 주세요.

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
| dashboard "스크립트가 바로 끝났고 실행 중인 서버가 없습니다" | start_dash.sh 의 마지막 명령이 서버를 계속 실행하는지, `tb3ctl logs dashboard` 에서 오류 확인 |
| dashboard 재시작 반복 + "Address already in use" | 터미널에서 띄운 대시보드가 이미 포트를 쓰는 중 → 그 프로세스를 끄세요 (`sudo ss -ltnp \| grep :3000`) |
| dashboard 에서 `npm: command not found` | node 경로 문제. 스크립트에서 절대 경로 사용 (`which npm` 결과) |
| 수동으로 띄우던 노드와 충돌 | 자동 실행 중에는 같은 노드를 터미널에서 또 띄우지 마세요. 필요하면 `sudo tb3ctl stop <이름>` 후 실행 |
| sound 재시작 반복, "재생 장치가 없습니다" | `aplay -l`. 3.5mm 잭: `config.txt` 의 `dtparam=audio=on` + `sudo modprobe snd_bcm2835` (모듈이 없으면 `linux-modules-extra-$(uname -r)`), 안 되면 USB 사운드카드 |
| sound 는 active 인데 소리가 안 남 | `tb3ctl logs sound` 의 `출력 장치:` 줄, PAM8403 전원·배선, 앰프 볼륨 노브. `ros2 run walle_sound say --sound beep` |

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
  robot.env.example     /etc/tb3/robot.env 원본 (DASHBOARD_SCRIPT 등)
```

## 검증 상태

| 항목 | 상태 |
|---|---|
| 스크립트 문법 · shellcheck | 통과 |
| 설치 스크립트 (임시 경로에 파일 생성) · `systemd-analyze verify` | 통과 |
| 구성요소별 실행 명령 (dry-run) | 확인 |
| MediaMTX v1.21.2 + `mediamtx.yml` + IP 자동 등록 + image_to_rtsp.py(가짜 프레임) → 대시보드 WebRTC 재생 | 확인 (VP8 로 재생 확인, H.264 는 송출까지 확인) |
| dashboard 스크립트: 포그라운드 / `&` 백그라운드 / 서버 종료 시 재시작 / 실패 / 정지 시 정리 | 새 세션·기본 시그널(systemd 와 같은 조건)로 확인 |
| sound: dry-run 명령 (robot.env 있음/없음) · 재생 장치 없을 때 30초 대기 후 오류 · 설치 시 점검 · walle_sound 테스트 10개(가짜 aplay/espeak-ng) | 확인 |
| 실제 Pi 에서 부팅 자동 실행 · bringup · 카메라 · 스피커 | 실물 확인 필요 |
