// ROS 메시지 ↔ 화면 데이터 변환, 명령 발행 도우미
import { useRobot } from "./store";

export const yawOf = (q: { x: number; y: number; z: number; w: number }) =>
  Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

export const quatOf = (yaw: number) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });

export function rosStamp() {
  const t = Date.now();
  return { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1_000_000 };
}

/** LaserScan → base_scan 프레임 xyz (Float32Array) */
export function scanToPoints(m: {
  angle_min: number; angle_increment: number; range_min: number; range_max: number; ranges: (number | null)[];
}) {
  const out = new Float32Array(m.ranges.length * 3);
  let n = 0;
  for (let i = 0; i < m.ranges.length; i++) {
    const r = m.ranges[i];
    if (r == null || !isFinite(r) || r < m.range_min || r > m.range_max) continue;
    const a = m.angle_min + i * m.angle_increment;
    out[n++] = r * Math.cos(a);
    out[n++] = r * Math.sin(a);
    out[n++] = 0;
  }
  return out.slice(0, n);
}

function bytesOf(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") {
    const bin = atob(data);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  return new Uint8Array(0);
}

/** PointCloud2 (x,y,z float32) 디코딩 — rosbridge 의 base64 / cbor(Uint8Array) 둘 다 처리, 최대 maxPts 로 솎음 */
export function decodePointCloud2(m: {
  width: number; height: number; point_step: number; is_bigendian: boolean;
  fields: { name: string; offset: number; datatype: number }[]; data: unknown;
}, maxPts = 60000) {
  const buf = bytesOf(m.data);
  const fx = m.fields.find((f) => f.name === "x"), fy = m.fields.find((f) => f.name === "y"), fz = m.fields.find((f) => f.name === "z");
  if (!fx || !fy || !fz || !m.point_step) return new Float32Array(0);
  const total = Math.floor(buf.byteLength / m.point_step);
  const stride = Math.max(1, Math.ceil(total / maxPts));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = !m.is_bigendian;
  const out = new Float32Array(Math.ceil(total / stride) * 3);
  let n = 0;
  for (let i = 0; i < total; i += stride) {
    const o = i * m.point_step;
    const x = dv.getFloat32(o + fx.offset, le), y = dv.getFloat32(o + fy.offset, le), z = dv.getFloat32(o + fz.offset, le);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    out[n++] = x; out[n++] = y; out[n++] = z;
  }
  return out.slice(0, n);
}

export function parseStatus(data: string): Record<string, unknown> | string {
  try {
    const v = JSON.parse(data);
    return typeof v === "object" && v ? v : data;
  } catch {
    return data;
  }
}

// ---------- 명령 발행 ----------

export function publishTwist(v: number, w: number) {
  const { transport, settings, estop } = useRobot.getState();
  if (!transport) return;
  if (estop) { v = 0; w = 0; }
  const twist = { linear: { x: v, y: 0, z: 0 }, angular: { x: 0, y: 0, z: w } };
  if (settings.cmdVelStamped) {
    transport.publish(settings.topics.cmdVel, "geometry_msgs/msg/TwistStamped", {
      header: { stamp: rosStamp(), frame_id: "base_link" }, twist,
    });
  } else {
    transport.publish(settings.topics.cmdVel, "geometry_msgs/msg/Twist", twist);
  }
}

export function sendString(topicKey: "walleCommand" | "driveMode", data: string) {
  const { transport, settings, log, set } = useRobot.getState();
  if (!transport) return;
  transport.publish(settings.topics[topicKey], "std_msgs/msg/String", { data });
  log("cmd", `${settings.topics[topicKey]} ← ${data}`);
  if (topicKey === "driveMode") set({ driveMode: data === "stop" ? "idle" : data });
}

export function sendGoal(x: number, y: number, yaw: number) {
  const { transport, settings, log } = useRobot.getState();
  if (!transport) return;
  transport.publish(settings.topics.goalPose, "geometry_msgs/msg/PoseStamped", {
    header: { stamp: rosStamp(), frame_id: "map" },
    pose: { position: { x, y, z: 0 }, orientation: quatOf(yaw) },
  });
  log("cmd", `목표 지점 (${x.toFixed(2)}, ${y.toFixed(2)}, ${((yaw * 180) / Math.PI).toFixed(0)}°)`);
}

export function sendPickPoint(kind: "pickPoint", x: number, y: number, z: number) {
  const { transport, settings, log } = useRobot.getState();
  if (!transport) return;
  transport.publish(settings.topics[kind], "geometry_msgs/msg/PointStamped", {
    header: { stamp: rosStamp(), frame_id: "base_link" }, point: { x, y, z },
  });
  log("cmd", `줍기 좌표 base_link (${x}, ${y}, ${z})`);
}

export function placePoint(x: number, y: number, z: number) {
  const { transport, log } = useRobot.getState();
  if (!transport) return;
  transport.publish("/walle/place_point", "geometry_msgs/msg/PointStamped", {
    header: { stamp: rosStamp(), frame_id: "base_link" }, point: { x, y, z },
  });
  log("cmd", `내려놓기 좌표 base_link (${x}, ${y}, ${z})`);
}

/** 비상정지: 정지 명령 여러 번 + 팔 stop + 주행 모드 idle, 그리고 조종 잠금 */
export function emergencyStop() {
  const { set, log } = useRobot.getState();
  set({ estop: true });
  for (let i = 0; i < 5; i++) setTimeout(() => publishTwist(0, 0), i * 60);
  sendString("walleCommand", "stop");
  sendString("driveMode", "idle");
  log("error", "비상정지 — 조종 잠금. 해제하려면 E-STOP 을 다시 누르세요");
}
