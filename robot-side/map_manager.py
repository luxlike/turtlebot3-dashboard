#!/usr/bin/env python3
"""
대시보드용 지도 관리 노드 — tb3_lidar_mapper 가 만든 ~/maps/<이름>.yaml 을 골라 Nav2 로 주행

  /dashboard/maps     std_msgs/String (로봇 → 웹, 1 Hz)  JSON 상태
      {"dir": "...", "maps": [{"name", "yaw", "width_m", "height_m", "res", "mtime"}],
       "loaded": "home" | null, "nav2": "off" | "starting" | "active", "managed": bool,
       "nav": "idle" | "active" | "succeeded" | "canceled" | "aborted", "msg": "..."}
  /dashboard/map_cmd  std_msgs/String (웹 → 로봇)  JSON 명령
      {"action": "load", "name": "home", "initial_pose": true}   지도 불러오기 (+ 출발 자리로 초기 위치)
      {"action": "cancel"}                                       현재 Nav2 목표 취소
      {"action": "stop_nav2"}                                    이 노드가 띄운 Nav2 끄기
      {"action": "refresh"}                                      지도 목록 다시 읽기

  Nav2 가 이미 떠 있으면(/map_server/load_map 서비스) 지도만 바꿔 끼우고,
  없으면 nav2_bringup 을 그 지도로 직접 띄웁니다 (params 는 turtlebot3_navigation2 의 모델별 파일).

실행:  python3 map_manager.py --ros-args -p maps_dir:=~/maps
       -p params_file:=~/walle_nav/burger_home.yaml   (walle_nav 2-3 조정본이 있으면)
       -p autostart_map:=home                         (켜자마자 이 지도로 Nav2)
       또는 환경변수 MAPS_DIR · NAV2_PARAMS · NAV_MAP
"""
import glob
import json
import math
import os
import re
import shlex
import signal
import subprocess
import threading
import time

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from action_msgs.msg import GoalStatus, GoalStatusArray
from action_msgs.srv import CancelGoal
from geometry_msgs.msg import PoseWithCovarianceStamped
from lifecycle_msgs.srv import GetState
from nav2_msgs.srv import LoadMap
from std_msgs.msg import String

NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
YAW_COMMENT_RE = re.compile(r"yaw=\s*(-?[\d.]+)\s*deg")
NAV_STATUS = {
    GoalStatus.STATUS_ACCEPTED: "active", GoalStatus.STATUS_EXECUTING: "active",
    GoalStatus.STATUS_CANCELING: "active", GoalStatus.STATUS_SUCCEEDED: "succeeded",
    GoalStatus.STATUS_CANCELED: "canceled", GoalStatus.STATUS_ABORTED: "aborted",
}


def read_map_info(yaml_path):
    """map.yaml 의 resolution·origin, 이미지 크기, 초기 yaw(_meta.json 또는 주석)를 읽음. pyyaml 없이도 동작."""
    info = {"res": None, "origin": [0.0, 0.0, 0.0], "image": None, "yaw": 0.0}
    with open(yaml_path, encoding="utf-8") as f:
        text = f.read()
    for line in text.splitlines():
        m = YAW_COMMENT_RE.search(line)
        if line.lstrip().startswith("#"):
            if m:
                info["yaw"] = math.radians(float(m.group(1)))
            continue
        body = line.split("#", 1)[0]
        if ":" not in body:
            continue
        k, v = (s.strip() for s in body.split(":", 1))
        if k == "resolution":
            info["res"] = float(v)
        elif k == "origin":
            info["origin"] = [float(x) for x in v.strip("[]").split(",")]
        elif k == "image":
            info["image"] = v.strip("'\"")
    base = yaml_path[: -len(".yaml")]
    meta = base + "_meta.json"
    if os.path.exists(meta):
        try:
            with open(meta, encoding="utf-8") as f:
                y = json.load(f).get("start_yaw_deg")
            if isinstance(y, (int, float)):
                info["yaw"] = math.radians(y)
        except (OSError, ValueError):
            pass
    # PGM 헤더에서 크기 — 이미지가 없으면 Nav2 가 못 읽으므로 error 로 표시
    info["w"] = info["h"] = info["error"] = None
    if not info["image"]:
        info["error"] = "yaml 에 image: 가 없습니다"
    else:
        img = info["image"] if os.path.isabs(info["image"]) else os.path.join(os.path.dirname(yaml_path), info["image"])
        if not os.path.exists(img):
            info["error"] = f"{os.path.basename(img)} 파일이 없습니다"
        try:
            with open(img, "rb") as f:
                head = f.read(256)
            toks = re.sub(rb"#[^\n]*\n", b" ", head).split()
            if toks[0] in (b"P5", b"P2"):
                info["w"], info["h"] = int(toks[1]), int(toks[2])
        except (OSError, IndexError, ValueError):
            pass
    return info


def find_params_file(model):
    try:
        from ament_index_python.packages import get_package_share_directory
        share = get_package_share_directory("turtlebot3_navigation2")
    except Exception:  # noqa: BLE001
        return ""
    for pat in (f"param/{model}.yaml", f"param/*/{model}.yaml"):
        hits = sorted(glob.glob(os.path.join(share, pat)))
        if hits:
            return hits[-1]
    return ""


class MapManager(Node):
    def __init__(self):
        super().__init__("dashboard_map_manager")
        # 기본값은 환경변수 (tb3 자동 실행: /etc/tb3/robot.env 의 MAPS_DIR · NAV2_PARAMS · NAV_MAP)
        self.declare_parameter("maps_dir", os.environ.get("MAPS_DIR", "~/maps"))
        self.declare_parameter("params_file", os.environ.get("NAV2_PARAMS", ""))
        self.declare_parameter("autostart_map", os.environ.get("NAV_MAP", ""))
        # {map} {params} {sim} 이 채워짐. 다른 launch 를 쓰려면 바꾸기
        self.declare_parameter(
            "nav2_cmd",
            "ros2 launch nav2_bringup bringup_launch.py map:={map} params_file:={params} use_sim_time:={sim} autostart:=True",
        )
        self.maps_dir = os.path.expanduser(self.get_parameter("maps_dir").value)
        model = os.environ.get("TURTLEBOT3_MODEL", "burger")
        self.params_file = os.path.expanduser(self.get_parameter("params_file").value) or find_params_file(model)

        self.state = {"loaded": None, "nav2": "off", "managed": False, "nav": "idle", "msg": ""}
        self.maps = []
        self.proc = None
        self.lock = threading.Lock()
        self.busy = False

        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.pub = self.create_publisher(String, "/dashboard/maps", latched)
        self.init_pub = self.create_publisher(PoseWithCovarianceStamped, "/initialpose", 10)
        self.create_subscription(String, "/dashboard/map_cmd", self.on_cmd, 10)
        self.create_subscription(GoalStatusArray, "/navigate_to_pose/_action/status", self.on_nav_status, 10)

        self.load_cli = self.create_client(LoadMap, "/map_server/load_map")
        self.cancel_cli = self.create_client(CancelGoal, "/navigate_to_pose/_action/cancel_goal")
        self.state_cli = self.create_client(GetState, "/bt_navigator/get_state")
        self.amcl_state_cli = self.create_client(GetState, "/amcl/get_state")

        self.scan_maps()
        self.create_timer(1.0, self.publish_state)
        self.create_timer(2.0, self.poll_nav2)
        self.create_timer(10.0, self.scan_maps)
        self.get_logger().info(f"지도 폴더 {self.maps_dir} · {len(self.maps)}개 · Nav2 params {self.params_file or '(없음)'}")

        auto = self.get_parameter("autostart_map").value
        if auto:
            self.create_timer(3.0, self._autostart_once(auto))

    def _autostart_once(self, name):
        done = {"v": False}

        def cb():
            if done["v"]:
                return
            done["v"] = True
            self.start_job(self.do_load, name, True)
        return cb

    # ---------- 상태 ----------
    def scan_maps(self):
        out = []
        for y in sorted(glob.glob(os.path.join(self.maps_dir, "*.yaml"))):
            name = os.path.basename(y)[:-5]
            if not NAME_RE.match(name) or name.endswith("_check"):
                continue
            try:
                i = read_map_info(y)
            except (OSError, ValueError) as e:
                self.get_logger().warn(f"{y}: {e}")
                continue
            if i["res"] is None:
                continue
            out.append({
                "name": name, "yaw": round(i["yaw"], 4), "res": i["res"],
                "width_m": round(i["w"] * i["res"], 2) if i["w"] else None,
                "height_m": round(i["h"] * i["res"], 2) if i["h"] else None,
                "mtime": int(os.path.getmtime(y)), "error": i["error"],
            })
        self.maps = out

    def publish_state(self):
        if self.proc and self.proc.poll() is not None:
            self.get_logger().warn(f"Nav2 프로세스 종료 (code {self.proc.returncode})")
            self.proc = None
            with self.lock:
                self.state.update(managed=False, nav2="off", loaded=None, msg="Nav2 가 종료되었습니다")
        with self.lock:
            body = {"dir": self.maps_dir, "maps": self.maps, "busy": self.busy, **self.state}
        self.pub.publish(String(data=json.dumps(body, ensure_ascii=False)))

    def set_msg(self, msg, **kw):
        with self.lock:
            self.state.update(msg=msg, **kw)
        self.get_logger().info(msg)
        self.publish_state()

    def poll_nav2(self):
        if not self.state_cli.service_is_ready():
            with self.lock:
                if self.state["nav2"] == "active":
                    self.state["nav2"] = "off"
            return
        fut = self.state_cli.call_async(GetState.Request())

        def done(f):
            try:
                active = f.result().current_state.id == 3  # PRIMARY_STATE_ACTIVE
            except Exception:  # noqa: BLE001
                return
            with self.lock:
                if active:
                    self.state["nav2"] = "active"
                elif self.state["nav2"] == "active":
                    self.state["nav2"] = "starting"
        fut.add_done_callback(done)

    def on_nav_status(self, msg):
        if not msg.status_list:
            return
        last = max(msg.status_list, key=lambda s: (s.goal_info.stamp.sec, s.goal_info.stamp.nanosec))
        with self.lock:
            self.state["nav"] = NAV_STATUS.get(last.status, "idle")

    # ---------- 명령 ----------
    def on_cmd(self, msg):
        try:
            c = json.loads(msg.data)
        except ValueError:
            self.get_logger().warn(f"잘못된 명령: {msg.data!r}")
            return
        a = c.get("action")
        if a == "refresh":
            self.scan_maps()
            self.publish_state()
        elif a == "load":
            name = str(c.get("name", ""))
            if not NAME_RE.match(name) or not os.path.exists(self.yaml_of(name)):
                self.set_msg(f"지도 '{name}' 이(가) {self.maps_dir} 에 없습니다")
                return
            self.start_job(self.do_load, name, bool(c.get("initial_pose", True)))
        elif a == "cancel":
            self.cancel_goals()
        elif a == "stop_nav2":
            self.start_job(self.do_stop)
        else:
            self.get_logger().warn(f"알 수 없는 action: {a}")

    def yaml_of(self, name):
        return os.path.join(self.maps_dir, f"{name}.yaml")

    def start_job(self, fn, *args):
        with self.lock:
            if self.busy:
                self.state["msg"] = "이전 작업이 진행 중입니다"
                return
            self.busy = True
        threading.Thread(target=self._run_job, args=(fn, *args), daemon=True).start()

    def _run_job(self, fn, *args):
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001
            self.set_msg(f"오류: {e}")
        finally:
            with self.lock:
                self.busy = False
            self.publish_state()

    def do_load(self, name, initial_pose):
        path = self.yaml_of(name)
        info = read_map_info(path)
        if info["error"]:
            self.set_msg(f"지도 '{name}' 을(를) 불러올 수 없습니다 — {info['error']}")
            return
        if self.load_cli.service_is_ready():
            self.set_msg(f"Nav2 에 지도 '{name}' 불러오는 중…")
            req = LoadMap.Request()
            req.map_url = path
            res = self.wait_future(self.load_cli.call_async(req), 15.0)
            if res is None or res.result != LoadMap.Response.RESULT_SUCCESS:
                code = None if res is None else res.result
                self.set_msg(f"지도 불러오기 실패 (result={code})")
                return
        else:
            if not self.params_file:
                self.set_msg("Nav2 params 파일을 찾지 못했습니다 — params_file 파라미터를 지정하세요")
                return
            self.stop_nav2()
            sim = "True" if self.get_parameter("use_sim_time").value else "False"
            cmd = self.get_parameter("nav2_cmd").value.format(
                map=shlex.quote(path), params=shlex.quote(self.params_file), sim=sim)
            self.set_msg(f"Nav2 시작 중 — 지도 '{name}'", nav2="starting", managed=True)
            self.get_logger().info(cmd)
            with open("/tmp/dashboard_nav2.log", "wb") as log:
                self.proc = subprocess.Popen(cmd, shell=True, start_new_session=True, stdout=log, stderr=subprocess.STDOUT)
            # global_costmap 은 map→base_link TF 를 기다리고, 그 TF 는 AMCL 이 초기 위치를 받아야 생김
            # → AMCL 이 켜지는 즉시 초기 위치를 넣어야 나머지 Nav2 가 활성화됨
            if not self.wait_active(self.amcl_state_cli, 90.0):
                self.set_msg("AMCL 이 90초 안에 켜지지 않았습니다 (로그: /tmp/dashboard_nav2.log)")
                return
            if initial_pose:
                self.send_start_pose(info["yaw"])
                self.set_msg(f"AMCL 준비 · 초기 위치 (0, 0, {math.degrees(info['yaw']):.1f}°) — 나머지 Nav2 시작 중", nav2="starting")
            else:
                self.set_msg("AMCL 준비 — 대시보드 ⌖ 로 초기 위치를 지정하면 Nav2 가 마저 켜집니다", nav2="starting")
            if not self.wait_active(self.state_cli, 120.0):
                self.set_msg("Nav2 가 활성화되지 않았습니다 — 초기 위치를 지정했는지 확인 (로그: /tmp/dashboard_nav2.log)")
                return
            self.set_msg(f"지도 '{name}' 준비 완료 — Nav2 실행 중", loaded=name, nav2="active")
            return
        # 이미 떠 있던 Nav2 에 지도만 바꿈 → 초기 위치도 새 지도 기준으로
        with self.lock:
            self.state.update(loaded=name, nav2="active")
        if initial_pose:
            self.send_start_pose(info["yaw"])
            self.set_msg(f"지도 '{name}' 준비 완료 · 초기 위치 (0, 0, {math.degrees(info['yaw']):.1f}°)")
        else:
            self.set_msg(f"지도 '{name}' 준비 완료 — 초기 위치를 지정하세요")

    def do_stop(self):
        if not self.proc:
            self.set_msg("이 노드가 띄운 Nav2 가 아니라 끌 수 없습니다 (직접 실행한 launch 를 종료하세요)")
            return
        self.stop_nav2()
        self.set_msg("Nav2 를 껐습니다", nav2="off", loaded=None, managed=False)

    def send_start_pose(self, yaw):
        # AMCL 이 막 켜졌을 때 놓치지 않도록 몇 번
        for _ in range(3):
            self.publish_initial_pose(0.0, 0.0, yaw)
            time.sleep(0.5)

    def wait_active(self, cli, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.proc and self.proc.poll() is not None:
                return False
            if cli.service_is_ready():
                res = self.wait_future(cli.call_async(GetState.Request()), 3.0)
                if res is not None and res.current_state.id == 3:
                    return True
            time.sleep(1.0)
        return False

    @staticmethod
    def wait_future(fut, timeout):
        ev = threading.Event()
        fut.add_done_callback(lambda _f: ev.set())
        if not ev.wait(timeout):
            return None
        try:
            return fut.result()
        except Exception:  # noqa: BLE001
            return None

    def publish_initial_pose(self, x, y, yaw):
        m = PoseWithCovarianceStamped()
        m.header.frame_id = "map"
        m.header.stamp = self.get_clock().now().to_msg()
        m.pose.pose.position.x, m.pose.pose.position.y = x, y
        m.pose.pose.orientation.z, m.pose.pose.orientation.w = math.sin(yaw / 2), math.cos(yaw / 2)
        cov = [0.0] * 36
        cov[0] = cov[7] = 0.25
        cov[35] = 0.0685
        m.pose.covariance = cov
        self.init_pub.publish(m)

    def cancel_goals(self):
        if not self.cancel_cli.service_is_ready():
            self.set_msg("Nav2 가 실행 중이 아닙니다")
            return
        # goal_id 0 + stamp 0 = 모든 목표 취소
        self.cancel_cli.call_async(CancelGoal.Request())
        self.set_msg("Nav2 목표 취소")

    def stop_nav2(self):
        p = self.proc
        self.proc = None
        if not p or p.poll() is not None:
            return
        try:
            os.killpg(p.pid, signal.SIGINT)
            p.wait(timeout=15)
        except (subprocess.TimeoutExpired, ProcessLookupError):
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def destroy_node(self):
        self.stop_nav2()
        super().destroy_node()


def _sigterm(_sig, _frame):
    raise KeyboardInterrupt


def main():
    rclpy.init()
    # SIGTERM(kill·timeout) 에도 띄운 Nav2 를 정리하도록
    signal.signal(signal.SIGTERM, _sigterm)
    n = MapManager()
    try:
        rclpy.spin(n)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        n.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
