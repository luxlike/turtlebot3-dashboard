import mqtt, { MqttClient } from "mqtt";
import { MessageHandler, StateEmitter, SubscribeSpec, Transport } from "./types";

/**
 * MQTT (EMQX / Mosquitto, WebSocket 리스너) 용 전송 계층.
 * 로봇 쪽 robot-side/ros2_mqtt_bridge.py 와 짝을 이룹니다.
 *
 *   로봇 → 웹 :  {prefix}/{robotId}/state{rosTopic}     예) robots/tb3_01/state/odom
 *   웹 → 로봇 :  {prefix}/{robotId}/cmd{rosTopic}       예) robots/tb3_01/cmd/cmd_vel
 *   payload    :  ROS 메시지를 dict 로 바꾼 JSON (rosbridge 와 같은 구조)
 *   생존 신호   :  {prefix}/{robotId}/online  ("1" / LWT "0", retained)
 */
export class MqttTransport implements Transport {
  readonly kind = "mqtt";
  private client: MqttClient | null = null;
  private state = new StateEmitter();
  private handlers = new Map<string, Set<MessageHandler>>();

  constructor(
    private url: string,
    private prefix: string,
    private robotId: string,
    private auth: { username?: string; password?: string } = {},
  ) {}

  private base() {
    return `${this.prefix}/${this.robotId}`;
  }
  private stateTopic(rosTopic: string) {
    return `${this.base()}/state${rosTopic.startsWith("/") ? rosTopic : "/" + rosTopic}`;
  }
  private cmdTopic(rosTopic: string) {
    return `${this.base()}/cmd${rosTopic.startsWith("/") ? rosTopic : "/" + rosTopic}`;
  }

  onState(cb: Parameters<StateEmitter["on"]>[0]) {
    return this.state.on(cb);
  }

  async connect() {
    this.state.emit("connecting", this.url);
    this.client = mqtt.connect(this.url, {
      clientId: `dash_${Math.random().toString(16).slice(2, 10)}`,
      username: this.auth.username || undefined,
      password: this.auth.password || undefined,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
      clean: true,
    });
    this.client.on("connect", () => {
      this.state.emit("connected", this.url);
      // 재접속 시 기존 구독 복구
      const topics = [...this.handlers.keys()];
      if (topics.length) this.client?.subscribe(topics, { qos: 0 });
    });
    this.client.on("reconnect", () => this.state.emit("connecting", "재접속 중"));
    this.client.on("error", (e) => this.state.emit("error", e.message));
    this.client.on("close", () => {
      if (this.state.state === "connected") this.state.emit("error", "연결 끊김");
    });
    this.client.on("message", (topic, payload) => {
      const hs = this.handlers.get(topic);
      if (!hs) return;
      let msg: unknown;
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        msg = { data: payload.toString() };
      }
      hs.forEach((h) => h(msg));
    });
  }

  disconnect() {
    this.client?.end(true);
    this.client = null;
    this.handlers.clear();
    this.state.emit("disconnected");
  }

  subscribe(spec: SubscribeSpec, cb: MessageHandler) {
    const t = this.stateTopic(spec.topic);
    let hs = this.handlers.get(t);
    if (!hs) {
      hs = new Set();
      this.handlers.set(t, hs);
      this.client?.subscribe(t, { qos: 0 });
    }
    hs.add(cb);
    return () => {
      hs!.delete(cb);
      if (hs!.size === 0) {
        this.handlers.delete(t);
        this.client?.unsubscribe(t);
      }
    };
  }

  publish(topic: string, type: string, msg: unknown) {
    if (!this.client?.connected) return;
    // 조작 명령은 QoS 0 (최신 값만 의미 있음), 모드·제스처 같은 이산 명령은 QoS 1
    const qos = topic.endsWith("cmd_vel") ? 0 : 1;
    this.client.publish(this.cmdTopic(topic), JSON.stringify({ type, msg }), { qos });
  }
}
