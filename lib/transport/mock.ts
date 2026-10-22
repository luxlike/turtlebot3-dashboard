import { MessageHandler, StateEmitter, SubscribeSpec, Transport } from "./types";
import { GESTURES, JOINT_NAMES } from "../gestures";

/**
 * 로봇 없이 UI 를 확인하기 위한 시뮬레이터.
 * rosbridge 와 같은 모양의 JSON 메시지를 만들어 내므로, 대시보드 코드는 실제 로봇과 똑같이 동작합니다.
 * - 6×5 m 방 + 장애물, LDS 360° 레이캐스트, /cmd_vel 적분, Nav2 /goal_pose 흉내
 * - walle_vision 의 avoid / ball / line 모드, walle_arm 제스처 키프레임 재생
 */

type Seg = [number, number, number, number];
const ROOM: Seg[] = (() => {
  const s: Seg[] = [
    [-3, -2.5, 3, -2.5], [3, -2.5, 3, 2.5], [3, 2.5, -3, 2.5], [-3, 2.5, -3, -2.5],
  ];
  const box = (cx: number, cy: number, w: number, h: number) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    s.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
  };
  box(1.2, 1.0, 0.6, 0.4);
  box(-1.5, -1.2, 0.5, 0.8);
  box(-0.8, 1.6, 1.2, 0.3);
  box(1.8, -1.5, 0.35, 0.35);
  return s;
})();

function ray(px: number, py: number, a: number, max: number) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = max;
  for (const [x1, y1, x2, y2] of ROOM) {
    const ex = x2 - x1, ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - px) * ey - (y1 - py) * ex) / den;
    const u = ((x1 - px) * dy - (y1 - py) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

const quat = (yaw: number) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
const stamp = () => {
  const t = Date.now();
  return { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 };
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class MockTransport implements Transport {
  readonly kind = "mock";
  private state = new StateEmitter();
  private handlers = new Map<string, Set<MessageHandler>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  // 로봇 상태
  private x = -1.8; private y = 0.4; private yaw = 0;
  private v = 0; private w = 0;
  private cmd = { v: 0, w: 0, t: 0 };
  private goal: { x: number; y: number } | null = null;
  private mode = "idle";
  private avoidTurn = 0;
  private battery = 12.3;
  private joints = [0, -1.0, 0.3, 0.7, 0.01];
  private gestureQueue: { name: string; frames: number[][]; dur: number }[] = [];
  private gestureT = 0;
  private gestureFrom: number[] | null = null;
  private armState = "idle";

  constructor(private topicNames: Record<string, string>) {}

  onState(cb: Parameters<StateEmitter["on"]>[0]) {
    return this.state.on(cb);
  }

  async connect() {
    this.state.emit("connecting", "시뮬레이터");
    await new Promise((r) => setTimeout(r, 300));
    this.state.emit("connected", "가상 로봇 · 6×5 m 방");
    this.timer = setInterval(() => this.step(0.05), 50);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.emit("disconnected");
  }

  subscribe(spec: SubscribeSpec, cb: MessageHandler) {
    let hs = this.handlers.get(spec.topic);
    if (!hs) this.handlers.set(spec.topic, (hs = new Set()));
    hs.add(cb);
    if (spec.topic === this.topicNames.map) setTimeout(() => cb(this.mapMsg()), 100);
    return () => hs!.delete(cb);
  }

  private emit(topic: string, msg: unknown) {
    this.handlers.get(topic)?.forEach((h) => h(msg));
  }

  publish(topic: string, _type: string, msg: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const T = this.topicNames;
    if (topic === T.cmdVel) {
      const tw = msg.twist ?? msg;
      this.cmd = { v: tw.linear.x, w: tw.angular.z, t: Date.now() };
      this.goal = null;
    } else if (topic === T.goalPose) {
      this.goal = { x: msg.pose.position.x, y: msg.pose.position.y };
      this.mode = "idle";
    } else if (topic === T.driveMode) {
      const m = String(msg.data);
      if (["ball", "line", "lane", "avoid", "idle", "stop"].includes(m)) this.mode = m === "stop" ? "idle" : m;
      this.emitVision();
    } else if (topic === T.walleCommand) {
      const c = String(msg.data);
      if (c === "stop") {
        this.gestureQueue = [];
        this.gestureFrom = null;
        this.armState = "idle";
      } else if (c === "open" || c === "close") {
        const target = [...this.joints];
        target[4] = c === "open" ? 0.019 : -0.01;
        this.gestureQueue.push({ name: c, frames: [target], dur: 0.6 });
      } else if (GESTURES[c]) {
        this.gestureQueue.push({ name: c, frames: GESTURES[c], dur: 0.7 });
      }
    } else if (topic === T.pickPoint) {
      this.gestureQueue.push({ name: "pick", frames: GESTURES.pick, dur: 0.9 });
    }
  }

  private step(dt: number) {
    this.tick++;
    let tv = 0, tw = 0;
    const front = Math.min(...[-0.35, -0.17, 0, 0.17, 0.35].map((da) => ray(this.x, this.y, this.yaw + da, 3.5)));

    if (Date.now() - this.cmd.t < 500) {
      tv = this.cmd.v; tw = this.cmd.w;
    } else if (this.goal) {
      const dx = this.goal.x - this.x, dy = this.goal.y - this.y;
      const d = Math.hypot(dx, dy);
      const e = wrap(Math.atan2(dy, dx) - this.yaw);
      if (d < 0.08) this.goal = null;
      else {
        tw = Math.max(-1.2, Math.min(1.2, 2.0 * e));
        tv = Math.abs(e) > 0.6 ? 0 : Math.min(0.22, 0.5 * d);
      }
    } else if (this.mode === "avoid") {
      if (front < 0.45) {
        if (!this.avoidTurn) {
          const l = ray(this.x, this.y, this.yaw + 1.0, 3.5), r = ray(this.x, this.y, this.yaw - 1.0, 3.5);
          this.avoidTurn = l > r ? 1 : -1;
        }
        tv = 0; tw = 1.2 * this.avoidTurn;
      } else {
        this.avoidTurn = 0;
        tv = front > 0.8 ? 0.18 : 0.08;
        tw = 0.15 * Math.sin(this.tick / 40);
      }
    } else if (this.mode === "line" || this.mode === "lane") {
      tv = 0.12; tw = 0.12 / 1.2; // 반지름 1.2 m 원 트랙 흉내
    } else if (this.mode === "ball") {
      tv = 0; tw = 0.6;
    }

    // LiDAR 정면 안전정지 (walle_vision 과 같은 규칙)
    if (tv > 0 && front < 0.18) tv = 0;

    // 가감속 제한
    const acc = 0.5 * dt, aacc = 3.0 * dt;
    this.v += Math.max(-acc * 2, Math.min(acc, tv - this.v));
    this.w += Math.max(-aacc * 2, Math.min(aacc, tw - this.w));
    this.yaw = wrap(this.yaw + this.w * dt);
    this.x += this.v * Math.cos(this.yaw) * dt;
    this.y += this.v * Math.sin(this.yaw) * dt;
    this.battery = Math.max(10.6, this.battery - (0.00002 + Math.abs(this.v) * 0.0002));

    this.stepArm(dt);
    this.publishAll();
  }

  private stepArm(dt: number) {
    const g = this.gestureQueue[0];
    if (!g) return;
    if (!this.gestureFrom) {
      this.gestureFrom = [...this.joints];
      this.gestureT = 0;
      this.armState = `running:${g.name}`;
    }
    this.gestureT += dt;
    const total = g.frames.length * g.dur;
    const k = Math.min(this.gestureT / g.dur, g.frames.length - 1e-6);
    const i = Math.floor(k);
    const f = k - i;
    const a = i === 0 ? this.gestureFrom : g.frames[i - 1];
    const b = g.frames[i];
    const s = f * f * (3 - 2 * f);
    this.joints = a.map((av, j) => av + (b[j] - av) * s);
    if (this.gestureT >= total) {
      this.joints = [...g.frames[g.frames.length - 1]];
      this.gestureQueue.shift();
      this.gestureFrom = null;
      this.armState = this.gestureQueue.length ? this.armState : "idle";
    }
  }

  private publishAll() {
    const T = this.topicNames;
    const header = (frame: string) => ({ stamp: stamp(), frame_id: frame });
    const pose = { position: { x: this.x, y: this.y, z: 0 }, orientation: quat(this.yaw) };

    this.emit(T.odom, {
      header: header("odom"), child_frame_id: "base_footprint",
      pose: { pose, covariance: [] },
      twist: { twist: { linear: { x: this.v, y: 0, z: 0 }, angular: { x: 0, y: 0, z: this.w } }, covariance: [] },
    });

    if (this.tick % 3 === 0) {
      const n = 360, ranges: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = this.yaw + (i * 2 * Math.PI) / n;
        const r = ray(this.x, this.y, a, 3.5);
        ranges.push(r >= 3.5 ? 0 : r + (Math.random() - 0.5) * 0.01);
      }
      this.emit(T.scan, {
        header: header("base_scan"), angle_min: 0, angle_max: 2 * Math.PI, angle_increment: (2 * Math.PI) / n,
        range_min: 0.12, range_max: 3.5, ranges, intensities: [],
      });
    }

    if (this.tick % 2 === 0) {
      this.emit(T.jointStates, {
        header: header(""), name: JOINT_NAMES,
        position: [...this.joints, this.joints[4]], velocity: [], effort: [],
      });
    }

    if (this.tick % 4 === 0) {
      this.emit(T.amclPose, { header: header("map"), pose: { pose, covariance: [] } });
      // 위경도는 임의 기준점 기준 m → 도 변환
      const lat0 = 37.5665, lon0 = 126.978;
      this.emit(T.gps, {
        header: header("gps"), status: { status: 0, service: 1 },
        latitude: lat0 + (this.y * 8) / 111320, longitude: lon0 + (this.x * 8) / (111320 * Math.cos((lat0 * Math.PI) / 180)),
        altitude: 38, position_covariance: [], position_covariance_type: 0,
      });
    }

    if (this.tick % 20 === 0) {
      const pct = Math.max(0, Math.min(1, (this.battery - 10.6) / (12.6 - 10.6)));
      this.emit(T.battery, { header: header(""), voltage: this.battery, percentage: pct, current: -(0.6 + Math.abs(this.v) * 3), present: true });
      this.emit(T.walleStatus, {
        data: JSON.stringify({ state: this.armState, queue: this.gestureQueue.map((g) => g.name), motion_lock: Math.abs(this.v) > 0.02 || Math.abs(this.w) > 0.08 }),
      });
      this.emitVision();
    }
    if (this.tick % 100 === 0) this.emit(T.map, this.mapMsg());
  }

  private emitVision() {
    this.emit(this.topicNames.visionStatus, {
      data: JSON.stringify({ mode: this.mode, fps: 15 + Math.round(Math.random() * 2), detected: this.mode === "ball" ? false : undefined }),
    });
  }

  private mapMsg() {
    const res = 0.05, w = 128, h = 108, ox = -3.2, oy = -2.7;
    const data = new Array<number>(w * h).fill(0);
    // 아직 탐색 안 된 바깥(-1) + 벽(100)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = ox + (i + 0.5) * res, y = oy + (j + 0.5) * res;
        if (Math.abs(x) > 3.03 || Math.abs(y) > 2.53) data[j * w + i] = -1;
      }
    for (const [x1, y1, x2, y2] of ROOM) {
      const L = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(L / (res / 2));
      for (let k = 0; k <= n; k++) {
        const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n;
        const i = Math.floor((x - ox) / res), j = Math.floor((y - oy) / res);
        if (i >= 0 && i < w && j >= 0 && j < h) data[j * w + i] = 100;
      }
    }
    return {
      header: { stamp: stamp(), frame_id: "map" },
      info: { resolution: res, width: w, height: h, origin: { position: { x: ox, y: oy, z: 0 }, orientation: quat(0) } },
      data,
    };
  }
}
