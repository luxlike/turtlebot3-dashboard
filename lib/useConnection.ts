"use client";
import { useEffect } from "react";
import { useRobot } from "./store";
import { MockTransport } from "./transport/mock";
import { MqttTransport } from "./transport/mqtt";
import { RosbridgeTransport } from "./transport/rosbridge";
import type { SubscribeSpec, Transport } from "./transport/types";
import { decodePointCloud2, parseStatus, scanToPoints, yawOf } from "./ros";
import type { Settings } from "./settings";

function makeTransport(s: Settings): Transport {
  switch (s.transport) {
    case "rosbridge":
      return new RosbridgeTransport(s.rosbridgeUrl);
    case "mqtt":
      return new MqttTransport(s.mqttUrl, s.mqttPrefix, s.robotId, { username: s.mqttUsername, password: s.mqttPassword });
    default:
      return new MockTransport(s.topics as unknown as Record<string, string>);
  }
}

/** 메시지 수신 빈도(Hz) 집계 */
const counts: Record<string, number> = {};
function tickTopic(topic: string) {
  counts[topic] = (counts[topic] ?? 0) + 1;
}

/**
 * 연결 생명주기: settings.transport 나 URL 이 바뀌면 새로 연결합니다.
 * `connectNonce` 를 올리면 같은 설정으로 다시 연결합니다.
 */
export function useConnection(enabled: boolean, nonce: number) {
  const settings = useRobot((s) => s.settings);

  useEffect(() => {
    const st = useRobot.getState();
    if (!enabled) {
      st.set({ transport: null, conn: "disconnected", connDetail: "" });
      return;
    }
    const tr = makeTransport(settings);
    const unsubs: (() => void)[] = [];
    st.resetData();
    st.set({ transport: tr });

    const T = settings.topics;
    const sub = (spec: SubscribeSpec, fn: (m: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!spec.topic) return;
      unsubs.push(
        tr.subscribe(spec, (m) => {
          tickTopic(spec.topic);
          useRobot.getState().lastSeen[spec.topic] = Date.now();
          try {
            fn(m);
          } catch (e) {
            useRobot.getState().log("warn", `${spec.topic} 처리 오류: ${String(e)}`);
          }
        }),
      );
    };

    const subscribeAll = () => {
      const S = useRobot.getState;
      sub({ topic: T.odom, type: "nav_msgs/msg/Odometry", throttleMs: 50 }, (m) => {
        const p = m.pose.pose;
        const x = p.position.x, y = p.position.y;
        const s = S();
        let trail = s.odomTrail, len = s.odomTrailLen;
        const lx = trail[len * 2 - 2], ly = trail[len * 2 - 1];
        if (len === 0 || Math.hypot(x - lx, y - ly) > 0.03) {
          if (len >= 2000) {
            trail = new Float32Array(4000);
            trail.set(s.odomTrail.subarray(2000), 0);
            len = 1000;
          }
          trail[len * 2] = x;
          trail[len * 2 + 1] = y;
          len++;
        }
        s.set({
          odom: { x, y, yaw: yawOf(p.orientation) },
          vel: { v: m.twist.twist.linear.x, w: m.twist.twist.angular.z },
          odomTrail: trail, odomTrailLen: len,
        });
      });
      sub({ topic: T.scan, type: "sensor_msgs/msg/LaserScan", throttleMs: 100 }, (m) => {
        S().set({ scan: scanToPoints(m), scanVersion: S().scanVersion + 1 });
      });
      sub({ topic: T.map, type: "nav_msgs/msg/OccupancyGrid", throttleMs: 2000 }, (m) => {
        const i = m.info;
        const data = m.data instanceof Int8Array ? m.data : Int8Array.from(m.data as number[]);
        S().set({
          map: {
            width: i.width, height: i.height, resolution: i.resolution,
            originX: i.origin.position.x, originY: i.origin.position.y, originYaw: yawOf(i.origin.orientation),
            data, version: (S().map?.version ?? 0) + 1,
          },
        });
      });
      sub({ topic: T.amclPose, type: "geometry_msgs/msg/PoseWithCovarianceStamped", throttleMs: 200 }, (m) => {
        const p = m.pose.pose;
        S().set({ mapPose: { x: p.position.x, y: p.position.y, yaw: yawOf(p.orientation) } });
      });
      sub({ topic: T.battery, type: "sensor_msgs/msg/BatteryState", throttleMs: 1000 }, (m) => {
        const pct = typeof m.percentage === "number" && isFinite(m.percentage) ? (m.percentage > 1 ? m.percentage / 100 : m.percentage) : null;
        S().set({ battery: { voltage: m.voltage, percentage: pct, current: isFinite(m.current) ? m.current : null } });
      });
      sub({ topic: T.jointStates, type: "sensor_msgs/msg/JointState", throttleMs: 50 }, (m) => {
        const j: Record<string, number> = { ...S().joints };
        (m.name as string[]).forEach((n, k) => (j[n] = m.position[k]));
        S().set({ joints: j });
      });
      sub({ topic: T.gps, type: "sensor_msgs/msg/NavSatFix", throttleMs: 500 }, (m) => {
        if (!isFinite(m.latitude) || !isFinite(m.longitude)) return;
        const s = S();
        const trail = s.gpsTrail;
        const last = trail[trail.length - 1];
        const next: [number, number] = [m.latitude, m.longitude];
        const moved = !last || Math.hypot(last[0] - next[0], last[1] - next[1]) > 3e-6;
        s.set({
          gps: { lat: m.latitude, lon: m.longitude, alt: m.altitude, fix: m.status?.status ?? -1 },
          gpsTrail: moved ? [...trail.slice(-999), next] : trail,
        });
      });
      if (T.pointCloud)
        sub({ topic: T.pointCloud, type: "sensor_msgs/msg/PointCloud2", throttleMs: 500, compression: "cbor" }, (m) => {
          S().set({ cloud: decodePointCloud2(m), cloudVersion: S().cloudVersion + 1 });
        });
      sub({ topic: T.walleStatus, type: "std_msgs/msg/String" }, (m) => S().set({ walleStatus: parseStatus(m.data) }));
      sub({ topic: T.visionStatus, type: "std_msgs/msg/String", throttleMs: 250 }, (m) => {
        const v = parseStatus(m.data);
        const patch: Record<string, unknown> = { visionStatus: v };
        if (typeof v === "object" && typeof v.mode === "string") patch.driveMode = v.mode;
        S().set(patch);
      });
    };

    let subscribed = false;
    const offState = tr.onState((state, detail) => {
      const s = useRobot.getState();
      const prev = s.conn;
      s.set({ conn: state, connDetail: detail ?? "" });
      if (state === "connected" && prev !== "connected") s.log("info", `연결됨 — ${detail ?? settings.transport}`);
      if (state === "error") s.log("error", detail ?? "연결 오류");
      if (state === "connected" && !subscribed) {
        subscribed = true;
        subscribeAll();
      }
    });

    void tr.connect();

    const rateTimer = setInterval(() => {
      const r: Record<string, number> = {};
      for (const k of Object.keys(counts)) {
        r[k] = counts[k];
        counts[k] = 0;
      }
      useRobot.getState().set({ rates: r });
    }, 1000);

    return () => {
      clearInterval(rateTimer);
      unsubs.forEach((u) => u());
      offState();
      tr.disconnect();
    };
  }, [enabled, nonce, settings]);
}
