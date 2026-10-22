#!/usr/bin/env python3
"""
ROS 이미지 토픽 → ffmpeg(H.264) → MediaMTX(RTSP) → 브라우저 WebRTC(WHEP)

왜 필요한가: Pi Camera 는 한 프로세스만 열 수 있습니다. walle_vision 이 camera_ros 로 이미
/camera/image_raw 를 쓰고 있으니, 영상은 카메라를 다시 여는 대신 ROS 토픽에서 받아 인코딩합니다.

  python3 image_to_rtsp.py --ros-args -p image_topic:=/camera/image_raw \
      -p url:=rtsp://localhost:8554/cam -p fps:=15 -p encoder:=libx264

  encoder: libx264 (CPU, 640x480@15 이면 Pi 4 에서 코어 1개 정도) | h264_v4l2m2m (Pi 4 하드웨어 인코더)
의존: sudo apt install ffmpeg
"""
import subprocess
import threading
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import CompressedImage, Image

PIX = {"rgb8": "rgb24", "bgr8": "bgr24", "mono8": "gray", "yuv422_yuy2": "yuyv422", "yuyv": "yuyv422", "rgba8": "rgba", "bgra8": "bgra"}


class ImageToRtsp(Node):
    def __init__(self):
        super().__init__("image_to_rtsp")
        self.topic = self.declare_parameter("image_topic", "/camera/image_raw").value
        self.url = self.declare_parameter("url", "rtsp://localhost:8554/cam").value
        self.fps = int(self.declare_parameter("fps", 15).value)
        self.encoder = self.declare_parameter("encoder", "libx264").value
        self.bitrate = self.declare_parameter("bitrate", "800k").value
        compressed = self.topic.endswith("/compressed")
        self.proc = None
        self.fmt = None
        self.lock = threading.Lock()
        self.last = 0.0
        if compressed:
            self.create_subscription(CompressedImage, self.topic, self.on_compressed, qos_profile_sensor_data)
        else:
            self.create_subscription(Image, self.topic, self.on_raw, qos_profile_sensor_data)
        self.get_logger().info(f"{self.topic} → {self.url} ({self.encoder}, {self.fps} fps)")

    def _enc_args(self):
        if self.encoder == "h264_v4l2m2m":
            return ["-c:v", "h264_v4l2m2m", "-b:v", self.bitrate, "-pix_fmt", "yuv420p"]
        # zerolatency: B 프레임 없음, 버퍼 최소 / GOP = 1초 → 새 시청자가 빨리 붙음
        return ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-b:v", self.bitrate,
                "-maxrate", self.bitrate, "-bufsize", "400k", "-pix_fmt", "yuv420p", "-profile:v", "baseline"]

    def _start(self, in_args):
        cmd = ["ffmpeg", "-loglevel", "warning", "-fflags", "nobuffer", *in_args,
               *self._enc_args(), "-g", str(self.fps), "-r", str(self.fps),
               "-f", "rtsp", "-rtsp_transport", "tcp", self.url]
        self.get_logger().info(" ".join(cmd))
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def _write(self, data):
        try:
            self.proc.stdin.write(data)
        except (BrokenPipeError, ValueError):
            self.get_logger().warn("ffmpeg 종료됨 — 다시 시작")
            self.proc = None
            self.fmt = None

    def _throttle(self):
        now = time.monotonic()
        if now - self.last < 1.0 / self.fps * 0.9:
            return True
        self.last = now
        return False

    def on_raw(self, m: Image):
        if self._throttle():
            return
        pix = PIX.get(m.encoding)
        if not pix:
            self.get_logger().error(f"지원하지 않는 encoding: {m.encoding}", throttle_duration_sec=5)
            return
        fmt = (m.width, m.height, pix)
        with self.lock:
            if self.proc is None or fmt != self.fmt:
                if self.proc:
                    self.proc.kill()
                self.fmt = fmt
                self._start(["-f", "rawvideo", "-pix_fmt", pix, "-s", f"{m.width}x{m.height}", "-r", str(self.fps), "-i", "-"])
            self._write(bytes(m.data))

    def on_compressed(self, m: CompressedImage):
        if self._throttle():
            return
        with self.lock:
            if self.proc is None:
                self.fmt = "jpeg"
                self._start(["-f", "image2pipe", "-c:v", "mjpeg", "-r", str(self.fps), "-i", "-"])
            self._write(bytes(m.data))

    def destroy_node(self):
        if self.proc:
            self.proc.kill()
        super().destroy_node()


def main():
    rclpy.init()
    n = ImageToRtsp()
    try:
        rclpy.spin(n)
    except KeyboardInterrupt:
        pass
    finally:
        n.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
