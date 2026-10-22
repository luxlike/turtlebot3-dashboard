import * as ROSLIB from "roslib";
import { MessageHandler, StateEmitter, SubscribeSpec, Transport } from "./types";

/**
 * rosbridge_suite (ros2 launch rosbridge_server rosbridge_websocket_launch.xml) 용 전송 계층.
 * - 연결이 끊기면 2초 → 최대 10초 간격으로 재접속
 * - roslib Topic 은 reconnect_on_close 로 재구독/재광고를 스스로 처리
 */
export class RosbridgeTransport implements Transport {
  readonly kind = "rosbridge";
  private ros: ROSLIB.Ros | null = null;
  private state = new StateEmitter();
  private pubs = new Map<string, ROSLIB.Topic<unknown>>();
  private subs = new Set<ROSLIB.Topic<unknown>>();
  private retryMs = 2000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(private url: string) {}

  onState(cb: Parameters<StateEmitter["on"]>[0]) {
    return this.state.on(cb);
  }

  async connect() {
    this.closedByUser = false;
    if (!this.ros) {
      this.ros = new ROSLIB.Ros({});
      this.ros.on("connection", () => {
        this.retryMs = 2000;
        this.state.emit("connected", this.url);
      });
      this.ros.on("error", () => this.state.emit("error", `${this.url} 연결 실패`));
      this.ros.on("close", () => {
        if (this.closedByUser) return this.state.emit("disconnected");
        this.state.emit("error", "연결 끊김 — 재접속 대기");
        this.scheduleRetry();
      });
    }
    this.state.emit("connecting", this.url);
    try {
      await this.ros.connect(this.url);
    } catch (e) {
      this.state.emit("error", String(e));
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.closedByUser || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryMs = Math.min(this.retryMs * 1.5, 10000);
      void this.connect();
    }, this.retryMs);
  }

  disconnect() {
    this.closedByUser = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.subs.forEach((t) => t.unsubscribe());
    this.pubs.forEach((t) => t.unadvertise());
    this.subs.clear();
    this.pubs.clear();
    this.ros?.close();
    this.ros = null;
    this.state.emit("disconnected");
  }

  subscribe(spec: SubscribeSpec, cb: MessageHandler) {
    if (!this.ros) throw new Error("not connected");
    const t = new ROSLIB.Topic<unknown>({
      ros: this.ros,
      name: spec.topic,
      messageType: spec.type,
      throttle_rate: spec.throttleMs ?? 0,
      compression: spec.compression ?? "none",
      queue_size: 1,
    });
    t.subscribe(cb);
    this.subs.add(t);
    return () => {
      t.unsubscribe();
      this.subs.delete(t);
    };
  }

  publish(topic: string, type: string, msg: unknown) {
    if (!this.ros || !this.ros.isConnected) return;
    let t = this.pubs.get(topic);
    if (!t) {
      t = new ROSLIB.Topic<unknown>({ ros: this.ros, name: topic, messageType: type, queue_size: 1 });
      t.advertise();
      this.pubs.set(topic, t);
    }
    t.publish(msg);
  }
}
