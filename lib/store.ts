import { create } from "zustand";
import type { ConnState, Transport } from "./transport/types";
import { DEFAULT_SETTINGS, Settings } from "./settings";

export interface Pose2D { x: number; y: number; yaw: number }
export interface GridMap {
  width: number; height: number; resolution: number;
  originX: number; originY: number; originYaw: number;
  data: Int8Array; version: number;
}
export interface LogEntry { t: number; level: "info" | "warn" | "error" | "cmd"; text: string }

interface RobotState {
  settings: Settings;
  transport: Transport | null;
  conn: ConnState;
  connDetail: string;
  estop: boolean;

  odom: Pose2D | null;
  vel: { v: number; w: number };
  odomTrail: Float32Array; // x,y 반복 (고정 길이 링버퍼를 매번 새로 만들지 않도록 최대 2000점)
  odomTrailLen: number;
  mapPose: Pose2D | null;
  map: GridMap | null;

  /** base_scan 프레임 xyz 반복 */
  scan: Float32Array;
  scanVersion: number;
  cloud: Float32Array;
  cloudVersion: number;

  joints: Record<string, number>;
  battery: { voltage: number; percentage: number | null; current: number | null } | null;
  gps: { lat: number; lon: number; alt: number; fix: number } | null;
  gpsTrail: [number, number][];
  walleStatus: Record<string, unknown> | string | null;
  visionStatus: Record<string, unknown> | string | null;
  driveMode: string;

  rates: Record<string, number>;
  lastSeen: Record<string, number>;
  logs: LogEntry[];

  set: (p: Partial<RobotState>) => void;
  log: (level: LogEntry["level"], text: string) => void;
  resetData: () => void;
}

const empty = () => ({
  odom: null, vel: { v: 0, w: 0 }, odomTrail: new Float32Array(4000), odomTrailLen: 0,
  mapPose: null, map: null, scan: new Float32Array(0), scanVersion: 0, cloud: new Float32Array(0), cloudVersion: 0,
  joints: {}, battery: null, gps: null, gpsTrail: [], walleStatus: null, visionStatus: null,
  rates: {}, lastSeen: {},
});

export const useRobot = create<RobotState>((set) => ({
  settings: DEFAULT_SETTINGS,
  transport: null,
  conn: "disconnected",
  connDetail: "",
  estop: false,
  driveMode: "idle",
  logs: [],
  ...empty(),
  set: (p) => set(p),
  log: (level, text) =>
    set((s) => ({ logs: [{ t: Date.now(), level, text }, ...s.logs].slice(0, 300) })),
  resetData: () => set(empty()),
}));
