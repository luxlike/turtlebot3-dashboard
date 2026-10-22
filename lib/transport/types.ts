export type ConnState = "disconnected" | "connecting" | "connected" | "error";

export interface SubscribeSpec {
  topic: string;
  /** ROS 2 타입 이름, 예: nav_msgs/msg/Odometry */
  type: string;
  /** rosbridge 쪽 스로틀(ms). MQTT 는 로봇 쪽 브리지 설정이 담당 */
  throttleMs?: number;
  compression?: "none" | "cbor" | "png";
}

export type MessageHandler = (msg: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * 대시보드가 쓰는 통신 계층의 공통 인터페이스.
 * rosbridge(WebSocket) / MQTT / Mock(시뮬레이터) 모두 ROS 메시지와 같은 JSON 구조를 주고받습니다.
 */
export interface Transport {
  readonly kind: string;
  connect(): Promise<void>;
  disconnect(): void;
  subscribe(spec: SubscribeSpec, cb: MessageHandler): () => void;
  publish(topic: string, type: string, msg: unknown): void;
  onState(cb: (s: ConnState, detail?: string) => void): () => void;
}

export class StateEmitter {
  private listeners = new Set<(s: ConnState, d?: string) => void>();
  state: ConnState = "disconnected";
  on(cb: (s: ConnState, d?: string) => void) {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(s: ConnState, d?: string) {
    this.state = s;
    this.listeners.forEach((l) => l(s, d));
  }
}
