#!/usr/bin/env python3
"""
ROS 2 <-> MQTT 브리지 (대시보드 MQTT 모드용)

  로봇 → 웹 :  {prefix}/{robot_id}/state{ros_topic}   JSON(ROS 메시지 dict), 토픽별 최대 rate_hz
  웹 → 로봇 :  {prefix}/{robot_id}/cmd{ros_topic}     JSON {"type": "...", "msg": {...}}
  생존 신호  :  {prefix}/{robot_id}/online            "1" / LWT "0" (retained)

안전
  - 웹 → 로봇 방향은 bridge.yaml 의 inbound 목록에 있는 토픽만 통과 (임의 토픽 주입 차단)
  - cmd_vel 은 0.5 초 동안 새 명령이 없으면 정지 명령을 대신 보냄 (Wi-Fi·브로커 끊김 대비)

실행:  python3 ros2_mqtt_bridge.py --ros-args -p config:=bridge.yaml
의존:  sudo apt install python3-paho-mqtt   (paho-mqtt 2.x)
"""
import json
import math
import threading
import time

import rclpy
import yaml
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, qos_profile_sensor_data
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_message
import paho.mqtt.client as mqtt


def _clean(o):
    """JSON 에 못 들어가는 inf/nan → None, bytes → list"""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (bytes, bytearray)):
        return list(o)
    return o


class Bridge(Node):
    def __init__(self):
        super().__init__("ros2_mqtt_bridge")
        self.declare_parameter("config", "bridge.yaml")
        with open(self.get_parameter("config").value, encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        b = cfg["broker"]
        self.base = f'{cfg.get("prefix", "robots")}/{cfg["robot_id"]}'
        self.cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'bridge_{cfg["robot_id"]}')
        if b.get("username"):
            self.cli.username_pw_set(b["username"], b.get("password"))
        self.cli.will_set(f"{self.base}/online", "0", qos=1, retain=True)
        self.cli.on_connect = self._on_connect
        self.cli.on_message = self._on_message

        # 로봇 → 웹
        self._last_sent = {}
        for t in cfg.get("outbound", []):
            cls = get_message(t["type"])
            latched = t.get("latched", False)
            qos = (
                QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
                if latched else qos_profile_sensor_data if t.get("sensor", False) else 10
            )
            period = 1.0 / float(t.get("rate_hz", 10))
            self.create_subscription(cls, t["topic"], self._make_out(t["topic"], period, latched), qos)

        # 웹 → 로봇 (허용 목록)
        self.inbound = {}
        for t in cfg.get("inbound", []):
            cls = get_message(t["type"])
            self.inbound[t["topic"]] = (cls, self.create_publisher(cls, t["topic"], 10), t["type"])

        self.cmd_vel_topic = cfg.get("cmd_vel_topic", "/cmd_vel")
        self._last_cmd = 0.0
        self._cmd_moving = False
        self._lock = threading.Lock()
        self.create_timer(0.1, self._cmd_vel_watchdog)

        self.cli.connect_async(b.get("host", "localhost"), int(b.get("port", 1883)), keepalive=10)
        self.cli.loop_start()
        self.get_logger().info(f"MQTT {b.get('host')}:{b.get('port')}  prefix={self.base}")

    # ---------- MQTT ----------
    def _on_connect(self, cli, _ud, _flags, rc, _props):
        if rc != 0:
            self.get_logger().error(f"MQTT 연결 실패 rc={rc}")
            return
        cli.publish(f"{self.base}/online", "1", qos=1, retain=True)
        cli.subscribe(f"{self.base}/cmd/#", qos=1)
        self.get_logger().info("MQTT 연결됨")

    def _on_message(self, _cli, _ud, m):
        ros_topic = m.topic[len(f"{self.base}/cmd"):]
        entry = self.inbound.get(ros_topic)
        if not entry:
            self.get_logger().warn(f"허용되지 않은 토픽 무시: {ros_topic}")
            return
        cls, pub, type_name = entry
        try:
            body = json.loads(m.payload)
            if body.get("type") and body["type"].replace("/msg/", "/") != type_name.replace("/msg/", "/"):
                self.get_logger().warn(f"{ros_topic}: 타입 불일치 {body.get('type')} != {type_name}")
                return
            msg = cls()
            set_message_fields(msg, body.get("msg", body))
            pub.publish(msg)
            if ros_topic == self.cmd_vel_topic:
                tw = getattr(msg, "twist", msg)
                with self._lock:
                    self._last_cmd = time.monotonic()
                    self._cmd_moving = abs(tw.linear.x) > 1e-4 or abs(tw.angular.z) > 1e-4
        except Exception as e:  # noqa: BLE001
            self.get_logger().warn(f"{ros_topic} 변환 실패: {e}")

    def _cmd_vel_watchdog(self):
        with self._lock:
            stale = self._cmd_moving and time.monotonic() - self._last_cmd > 0.5
            if stale:
                self._cmd_moving = False
        if stale and self.cmd_vel_topic in self.inbound:
            cls, pub, _ = self.inbound[self.cmd_vel_topic]
            pub.publish(cls())  # 모든 필드 0
            self.get_logger().warn("cmd_vel 끊김 → 정지")

    # ---------- ROS → MQTT ----------
    def _make_out(self, topic, period, latched):
        def cb(msg):
            now = time.monotonic()
            if now - self._last_sent.get(topic, 0.0) < period:
                return
            self._last_sent[topic] = now
            payload = json.dumps(_clean(message_to_ordereddict(msg)), separators=(",", ":"))
            self.cli.publish(f"{self.base}/state{topic}", payload, qos=1 if latched else 0, retain=latched)
        return cb

    def destroy_node(self):
        self.cli.publish(f"{self.base}/online", "0", qos=1, retain=True)
        self.cli.loop_stop()
        self.cli.disconnect()
        super().destroy_node()


def main():
    rclpy.init()
    n = Bridge()
    try:
        rclpy.spin(n)
    except KeyboardInterrupt:
        pass
    finally:
        n.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
