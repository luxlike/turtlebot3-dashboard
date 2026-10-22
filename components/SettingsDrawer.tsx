"use client";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRobot } from "@/lib/store";
import { DEFAULT_SETTINGS, saveSettings, Settings, TopicNames } from "@/lib/settings";

const TOPIC_LABELS: [keyof TopicNames, string][] = [
  ["odom", "Odometry"], ["scan", "LaserScan"], ["map", "OccupancyGrid"], ["amclPose", "AMCL 위치"],
  ["battery", "BatteryState"], ["jointStates", "JointState (팔)"], ["gps", "NavSatFix (실외)"],
  ["pointCloud", "PointCloud2 (비우면 끔)"], ["walleStatus", "walle_arm 상태"], ["visionStatus", "walle_vision 상태"],
  ["cmdVel", "cmd_vel"], ["walleCommand", "팔 명령"], ["driveMode", "주행 모드"], ["goalPose", "Nav2 목표"], ["pickPoint", "줍기 좌표"],
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-snug text-ink-400">{hint}</span>}
    </label>
  );
}
const inp = "w-full rounded border border-ink-600 bg-ink-950 px-2 py-1.5 font-mono text-xs text-ink-100 outline-none focus:border-signal";

export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useRobot((s) => s.settings);
  const [d, setD] = useState<Settings>(current);
  useEffect(() => { if (open) setD(current); }, [open, current]);
  const up = <K extends keyof Settings>(k: K, v: Settings[K]) => setD((p) => ({ ...p, [k]: v }));

  if (!open) return null;
  const apply = () => {
    saveSettings(d);
    useRobot.getState().set({ settings: d });
    useRobot.getState().log("info", "설정 적용 — 다시 연결합니다");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col border-l border-ink-700 bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-12 items-center border-b border-ink-700 px-4">
          <h2 className="text-sm font-semibold">연결 · 로봇 설정</h2>
          <button onClick={onClose} className="ml-auto text-ink-400 hover:text-ink-100"><X className="size-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal">통신</h3>
            <div className="grid grid-cols-3 gap-1 rounded-md bg-ink-950 p-1">
              {(["mock", "rosbridge", "mqtt"] as const).map((k) => (
                <button key={k} onClick={() => up("transport", k)}
                  className={`rounded py-1.5 text-xs ${d.transport === k ? "bg-ink-700 text-ink-100" : "text-ink-400"}`}>
                  {k === "mock" ? "시뮬레이터" : k === "rosbridge" ? "rosbridge" : "MQTT"}
                </button>
              ))}
            </div>
            {d.transport === "rosbridge" && (
              <Field label="rosbridge WebSocket URL" hint="SBC: ros2 launch rosbridge_server rosbridge_websocket_launch.xml (기본 9090)">
                <input className={inp} value={d.rosbridgeUrl} onChange={(e) => up("rosbridgeUrl", e.target.value)} />
              </Field>
            )}
            {d.transport === "mqtt" && (
              <>
                <Field label="MQTT over WebSocket URL" hint="Mosquitto: listener 9001 + protocol websockets / EMQX: ws://host:8083/mqtt">
                  <input className={inp} value={d.mqttUrl} onChange={(e) => up("mqttUrl", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="토픽 prefix"><input className={inp} value={d.mqttPrefix} onChange={(e) => up("mqttPrefix", e.target.value)} /></Field>
                  <Field label="로봇 ID"><input className={inp} value={d.robotId} onChange={(e) => up("robotId", e.target.value)} /></Field>
                  <Field label="사용자"><input className={inp} value={d.mqttUsername} onChange={(e) => up("mqttUsername", e.target.value)} /></Field>
                  <Field label="비밀번호"><input type="password" className={inp} value={d.mqttPassword} onChange={(e) => up("mqttPassword", e.target.value)} /></Field>
                </div>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal">영상</h3>
            <div className="grid grid-cols-3 gap-1 rounded-md bg-ink-950 p-1">
              {(["whep", "mjpeg", "none"] as const).map((k) => (
                <button key={k} onClick={() => up("videoMode", k)}
                  className={`rounded py-1.5 text-xs ${d.videoMode === k ? "bg-ink-700 text-ink-100" : "text-ink-400"}`}>
                  {k === "whep" ? "WebRTC (WHEP)" : k === "mjpeg" ? "MJPEG" : "끄기"}
                </button>
              ))}
            </div>
            {d.videoMode !== "none" && (
              <Field label="영상 URL" hint={d.videoMode === "whep"
                ? "MediaMTX: http://host:8889/cam/whep · go2rtc: http://host:1984/api/webrtc?src=cam"
                : "web_video_server: http://host:8080/stream?topic=/camera/image_raw&type=mjpeg"}>
                <input className={inp} value={d.videoUrl} onChange={(e) => up("videoUrl", e.target.value)} />
              </Field>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal">로봇</h3>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-ink-950 p-1">
              {(["waffle_pi", "burger"] as const).map((k) => (
                <button key={k} onClick={() => setD((p) => ({
                  ...p, robotModel: k,
                  armMountX: k === "waffle_pi" ? -0.092 : 0.0, armMountZ: k === "waffle_pi" ? 0.091 : 0.17,
                }))}
                  className={`rounded py-1.5 text-xs ${d.robotModel === k ? "bg-ink-700 text-ink-100" : "text-ink-400"}`}>
                  {k === "waffle_pi" ? "Waffle Pi (경로 A)" : "Burger (경로 B)"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="팔 표시">
                <select className={inp} value={d.showArm ? "1" : "0"} onChange={(e) => up("showArm", e.target.value === "1")}>
                  <option value="1">켬</option><option value="0">끔</option>
                </select>
              </Field>
              <Field label="mount_x (m)"><input type="number" step="0.001" className={inp} value={d.armMountX} onChange={(e) => up("armMountX", +e.target.value)} /></Field>
              <Field label="mount_z (m)"><input type="number" step="0.001" className={inp} value={d.armMountZ} onChange={(e) => up("armMountZ", +e.target.value)} /></Field>
            </div>
            <Field label="cmd_vel 메시지 타입" hint="로봇에서 ros2 topic info /cmd_vel -v 로 구독자 타입을 확인하세요">
              <select className={inp} value={d.cmdVelStamped ? "s" : "t"} onChange={(e) => up("cmdVelStamped", e.target.value === "s")}>
                <option value="t">geometry_msgs/Twist</option>
                <option value="s">geometry_msgs/TwistStamped</option>
              </select>
            </Field>
          </section>

          <section className="space-y-2">
            <div className="flex items-center">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal">토픽 이름</h3>
              <button className="ml-auto text-[10px] text-ink-400 hover:text-ink-100"
                onClick={() => setD((p) => ({ ...p, topics: DEFAULT_SETTINGS.topics }))}>기본값</button>
            </div>
            <p className="text-[10px] leading-snug text-ink-400">경로 B(버거 + U2D2)는 팔이 /arm 네임스페이스라 JointState 를 /arm/joint_states 로 바꿔 주세요.</p>
            {TOPIC_LABELS.map(([k, label]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] items-center gap-2">
                <span className="truncate text-[11px] text-ink-300">{label}</span>
                <input className={inp} value={d.topics[k]} onChange={(e) => setD((p) => ({ ...p, topics: { ...p.topics, [k]: e.target.value } }))} />
              </div>
            ))}
          </section>
        </div>
        <div className="flex gap-2 border-t border-ink-700 p-3">
          <button onClick={onClose} className="flex-1 rounded border border-ink-600 py-2 text-xs text-ink-300">취소</button>
          <button onClick={apply} className="flex-1 rounded bg-signal py-2 text-xs font-semibold text-ink-950">적용 · 재연결</button>
        </div>
      </aside>
    </div>
  );
}
