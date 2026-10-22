"use client";
import { Ban, Camera, Hand, Navigation, PackageOpen, RefreshCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useRobot } from "@/lib/store";
import { ARM_COMMANDS, DRIVE_MODES } from "@/lib/gestures";
import { placePoint, sendPickPoint, sendString } from "@/lib/ros";
import { Chip, Panel } from "./Panel";

const JOINT_LIMITS: Record<string, [number, number]> = {
  joint1: [-Math.PI, Math.PI], joint2: [-2.05, 1.57], joint3: [-1.57, 1.53], joint4: [-1.8, 2.0], gripper: [-0.01, 0.019],
};

function JointBar({ name, value }: { name: string; value: number | undefined }) {
  const [lo, hi] = JOINT_LIMITS[name];
  const t = value == null ? 0.5 : (value - lo) / (hi - lo);
  const zero = (0 - lo) / (hi - lo);
  const isGrip = name === "gripper";
  return (
    <div className="grid grid-cols-[52px_1fr_52px] items-center gap-2">
      <span className="font-mono text-[10px] text-ink-400">{name}</span>
      <div className="relative h-1.5 rounded-full bg-ink-700">
        <div className="absolute top-[-2px] h-[10px] w-px bg-ink-400" style={{ left: `${zero * 100}%` }} />
        {value != null && <div className="absolute top-[-3px] size-3 -translate-x-1/2 rounded-full border-2 border-signal bg-ink-950" style={{ left: `${t * 100}%` }} />}
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-ink-300">
        {value == null ? "—" : isGrip ? `${(value * 1000).toFixed(1)}mm` : `${((value * 180) / Math.PI).toFixed(0)}°`}
      </span>
    </div>
  );
}

const num = "w-full rounded border border-ink-600 bg-ink-950 px-1.5 py-1 font-mono text-xs outline-none focus:border-signal";

export default function CommandPanel() {
  const conn = useRobot((s) => s.conn);
  const driveMode = useRobot((s) => s.driveMode);
  const joints = useRobot((s) => s.joints);
  const estop = useRobot((s) => s.estop);
  const vel = useRobot((s) => s.vel);
  const [pick, setPick] = useState({ x: 0.2, y: 0, z: 0.02 });
  const [place, setPlace] = useState({ x: 0.22, y: -0.08, z: 0.03 });
  const off = conn !== "connected";
  const moving = Math.abs(vel.v) > 0.02 || Math.abs(vel.w) > 0.08;

  const btn = (active: boolean) =>
    `rounded-md border px-2 py-2 text-left transition-colors disabled:opacity-40 ${
      active ? "border-signal bg-signal/10 text-signal" : "border-ink-700 bg-ink-850 text-ink-100 hover:border-ink-600 hover:bg-ink-800"
    }`;

  return (
    <Panel
      title="자율 주행 · 팔"
      icon={Sparkles}
      className="h-full"
      right={moving ? <Chip tone="warn">주행 중 — 팔 motion_lock</Chip> : <Chip>정차</Chip>}
      bodyClass="p-3"
    >
      <div className="grid h-full gap-4 md:grid-cols-[1fr_1.25fr]">
        {/* 주행 모드 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-400">
            <Navigation className="size-3" /> walle_vision 주행 모드
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3">
            {DRIVE_MODES.map((m) => (
              <button key={m.id} disabled={off || (estop && m.id !== "idle")} onClick={() => sendString("driveMode", m.id)} className={btn(driveMode === m.id)}>
                <div className="text-xs font-medium">{m.label}</div>
                <div className="truncate text-[10px] text-ink-400">{m.hint}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button disabled={off} onClick={() => sendString("driveMode", "relearn_floor")} className="flex flex-1 items-center justify-center gap-1 rounded border border-ink-700 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">
              <RefreshCcw className="size-3" /> 바닥 재학습
            </button>
            <button disabled={off} onClick={() => sendString("driveMode", "snapshot")} className="flex flex-1 items-center justify-center gap-1 rounded border border-ink-700 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">
              <Camera className="size-3" /> HSV 스냅샷
            </button>
          </div>
          <p className="text-[10px] leading-snug text-ink-400">
            조종 패드를 잡으면 자동으로 idle 로 바뀝니다. avoid 는 로봇 앞이 빈 바닥일 때 켜세요.
          </p>
        </div>

        {/* 팔 */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-400">
            <Hand className="size-3" /> walle_arm 제스처
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ARM_COMMANDS.map((c) => (
              <button key={c.id} disabled={off || estop} onClick={() => sendString("walleCommand", c.id)}
                className="rounded border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs hover:border-signal-dim hover:text-signal disabled:opacity-40">
                {c.label}
              </button>
            ))}
            <button disabled={off} onClick={() => sendString("walleCommand", "stop")}
              className="flex items-center gap-1 rounded border border-alert/50 px-2.5 py-1 text-xs text-alert hover:bg-alert/10 disabled:opacity-40">
              <Ban className="size-3" /> 정지
            </button>
          </div>

          <div className="space-y-1.5">
            {["joint1", "joint2", "joint3", "joint4", "gripper"].map((n) => <JointBar key={n} name={n} value={joints[n]} />)}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([["줍기", pick, setPick, () => sendPickPoint("pickPoint", pick.x, pick.y, pick.z)],
               ["내려놓기", place, setPlace, () => placePoint(place.x, place.y, place.z)]] as const).map(([label, p, setP, go]) => (
              <div key={label} className="rounded-md border border-ink-700 bg-ink-950 p-2">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] text-ink-400">
                  <PackageOpen className="size-3" /> {label} · base_link (m)
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(["x", "y", "z"] as const).map((k) => (
                    <input key={k} type="number" step={0.01} className={num} value={p[k]} aria-label={k}
                      onChange={(e) => setP({ ...p, [k]: +e.target.value })} />
                  ))}
                </div>
                <button disabled={off || estop} onClick={go}
                  className="mt-1.5 w-full rounded bg-ink-700 py-1 text-[11px] hover:bg-ink-600 disabled:opacity-40">{label} 실행</button>
              </div>
            ))}
          </div>
          <p className="text-[10px] leading-snug text-ink-400">바닥 근처 도달 범위: base_link 앞 약 0.12–0.25 m · 그리퍼 2–7.5 cm</p>
        </div>
      </div>
    </Panel>
  );
}
