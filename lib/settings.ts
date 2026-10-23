// 대시보드 설정 — 브라우저 localStorage 에 저장, 기본값은 .env 의 NEXT_PUBLIC_* 에서 옵니다.

export type TransportKind = "mock" | "rosbridge" | "mqtt";
export type VideoMode = "whep" | "mjpeg" | "none";
export type RobotModel = "waffle_pi" | "burger";

export interface TopicNames {
  odom: string;
  scan: string;
  map: string;
  amclPose: string;
  battery: string;
  jointStates: string;
  gps: string;
  pointCloud: string;
  walleStatus: string;
  visionStatus: string;
  cmdVel: string;
  walleCommand: string;
  driveMode: string;
  goalPose: string;
  pickPoint: string;
}

export interface Settings {
  transport: TransportKind;
  rosbridgeUrl: string;
  mqttUrl: string;
  mqttPrefix: string;
  mqttUsername: string;
  mqttPassword: string;
  robotId: string;
  videoMode: VideoMode;
  videoUrl: string;
  robotModel: RobotModel;
  /** Jazzy 의 turtlebot3_node / diff_drive_controller 는 버전에 따라 TwistStamped 를 받습니다 */
  cmdVelStamped: boolean;
  /** 버거 경로 B 에서 팔 바닥(link1) 위치 — walle_arm 의 mount_x / mount_z 와 같은 값 */
  armMountX: number;
  armMountZ: number;
  showArm: boolean;
  topics: TopicNames;
}

export const DEFAULT_TOPICS: TopicNames = {
  odom: "/odom",
  scan: "/scan",
  map: "/map",
  amclPose: "/amcl_pose",
  battery: "/battery_state",
  jointStates: "/joint_states",
  gps: "/fix",
  pointCloud: "",
  walleStatus: "/walle/status",
  visionStatus: "/walle/vision/status",
  cmdVel: "/cmd_vel",
  walleCommand: "/walle/command",
  driveMode: "/walle/drive_mode",
  goalPose: "/goal_pose",
  pickPoint: "/walle/pick_point",
};

export const DEFAULT_SETTINGS: Settings = {
  transport: (process.env.NEXT_PUBLIC_DEFAULT_TRANSPORT as TransportKind) || "mock",
  rosbridgeUrl: process.env.NEXT_PUBLIC_ROSBRIDGE_URL || "ws://192.168.0.50:9090",
  mqttUrl: process.env.NEXT_PUBLIC_MQTT_URL || "ws://192.168.0.50:9001",
  mqttPrefix: "robots",
  mqttUsername: "",
  mqttPassword: "",
  robotId: process.env.NEXT_PUBLIC_ROBOT_ID || "tb3_01",
  videoMode: "whep",
  videoUrl: process.env.NEXT_PUBLIC_VIDEO_URL || "http://192.168.0.50:8889/cam/whep",
  robotModel: "waffle_pi",
  cmdVelStamped: false,
  armMountX: -0.092,
  armMountZ: 0.091,
  showArm: true,
  topics: DEFAULT_TOPICS,
};

const KEY = "robot-dashboard.settings.v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return sameHostDefaults();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, topics: { ...DEFAULT_TOPICS, ...(parsed.topics ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * 저장된 설정이 없을 때의 기본값.
 * 대시보드를 로봇이 직접 서비스하는 경우(tb3@dashboard, http://<로봇IP>:3000) 같은 호스트의
 * rosbridge·MediaMTX 로 바로 연결합니다. localhost 에서 열면(개발 중) 시뮬레이터로 시작합니다.
 */
function sameHostDefaults(): Settings {
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  if (local || process.env.NEXT_PUBLIC_DEFAULT_TRANSPORT) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    transport: "rosbridge",
    rosbridgeUrl: `ws://${host}:9090`,
    mqttUrl: `ws://${host}:9001`,
    videoMode: "whep",
    videoUrl: `http://${host}:8889/cam/whep`,
  };
}

export function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode 등 — 무시 */
  }
}

/** 모델별 속도 한계 (TurtleBot3 e-Manual 사양) */
export const SPEED_LIMITS: Record<RobotModel, { lin: number; ang: number }> = {
  burger: { lin: 0.22, ang: 2.84 },
  waffle_pi: { lin: 0.26, ang: 1.82 },
};
