"use client";
import { Activity, BatteryFull, BatteryLow, BatteryMedium } from "lucide-react";
import { useRobot } from "@/lib/store";
import { Chip, Panel, Readout } from "./Panel";

const TOPIC_ROWS: [keyof ReturnType<typeof useRobot.getState>["settings"]["topics"], string][] = [
  ["odom", "odom"], ["scan", "scan"], ["jointStates", "joints"], ["battery", "battery"],
  ["amclPose", "amcl"], ["map", "map"], ["gps", "gps"], ["walleStatus", "walle"], ["visionStatus", "vision"],
];

function statusText(v: Record<string, unknown> | string | null) {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  return Object.entries(v)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => `${k}: ${Array.isArray(x) ? `[${x.join(", ")}]` : typeof x === "object" ? JSON.stringify(x) : String(x)}`)
    .join("\n");
}

export default function TelemetryPanel() {
  const odom = useRobot((s) => s.odom);
  const vel = useRobot((s) => s.vel);
  const mapPose = useRobot((s) => s.mapPose);
  const battery = useRobot((s) => s.battery);
  const rates = useRobot((s) => s.rates);
  const lastSeen = useRobot((s) => s.lastSeen);
  const topics = useRobot((s) => s.settings.topics);
  const walle = useRobot((s) => s.walleStatus);
  const vision = useRobot((s) => s.visionStatus);

  // 3S LiPo 11.1 V: 12.6 V 만충, 11.0 V 아래면 충전 권장
  const pct = battery?.percentage ?? (battery ? Math.max(0, Math.min(1, (battery.voltage - 10.6) / 2.0)) : null);
  const low = battery && battery.voltage < 11.0;
  const BIcon = pct == null ? BatteryMedium : pct > 0.6 ? BatteryFull : pct > 0.25 ? BatteryMedium : BatteryLow;
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
  const now = Date.now();

  return (
    <Panel title="텔레메트리" icon={Activity} className="h-full" bodyClass="overflow-y-auto p-3">
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-950 p-2.5">
          <BIcon className={`size-7 ${low ? "text-alert" : "text-signal"}`} />
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className={`font-mono text-xl tabular-nums ${low ? "text-alert" : ""}`}>{battery ? battery.voltage.toFixed(2) : "--.--"}</span>
              <span className="text-[10px] text-ink-400">V</span>
              {pct != null && <span className="ml-auto font-mono text-xs text-ink-300">{Math.round(pct * 100)}%</span>}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className={`h-full ${low ? "bg-alert" : pct != null && pct < 0.3 ? "bg-amber" : "bg-signal"}`} style={{ width: `${(pct ?? 0) * 100}%` }} />
            </div>
            {low && <div className="mt-1 text-[10px] text-alert">11.0 V 미만 — 충전하세요 (팔 동작 중 전압 강하 주의)</div>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-2">
          <Readout label="속도" value={vel.v.toFixed(2)} unit="m/s" />
          <Readout label="각속도" value={vel.w.toFixed(2)} unit="rad/s" />
          <Readout label="전류" value={battery?.current != null ? Math.abs(battery.current).toFixed(2) : "—"} unit="A" />
          <Readout label="odom x" value={odom ? odom.x.toFixed(2) : "—"} unit="m" />
          <Readout label="odom y" value={odom ? odom.y.toFixed(2) : "—"} unit="m" />
          <Readout label="odom θ" value={odom ? deg(odom.yaw) : "—"} unit="°" />
          {mapPose && (
            <>
              <Readout label="map x" value={mapPose.x.toFixed(2)} unit="m" />
              <Readout label="map y" value={mapPose.y.toFixed(2)} unit="m" />
              <Readout label="map θ" value={deg(mapPose.yaw)} unit="°" />
            </>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">토픽 수신</div>
          <div className="flex flex-wrap gap-1">
            {TOPIC_ROWS.filter(([k]) => topics[k]).map(([k, label]) => {
              const hz = rates[topics[k]] ?? 0;
              const seen = lastSeen[topics[k]];
              const stale = seen && now - seen > 3000;
              return (
                <Chip key={k} tone={!seen ? "muted" : stale ? "warn" : "ok"}>
                  {label} {hz > 0 ? `${hz}Hz` : !seen ? "—" : stale ? `${Math.round((now - seen) / 1000)}s 전` : "<1Hz"}
                </Chip>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">walle_arm</div>
            <pre className="min-h-[52px] whitespace-pre-wrap break-all rounded border border-ink-700 bg-ink-950 p-1.5 font-mono text-[10px] leading-snug text-ink-300">{statusText(walle)}</pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">walle_vision</div>
            <pre className="min-h-[52px] whitespace-pre-wrap break-all rounded border border-ink-700 bg-ink-950 p-1.5 font-mono text-[10px] leading-snug text-ink-300">{statusText(vision)}</pre>
          </div>
        </div>
      </div>
    </Panel>
  );
}
