"use client";
import { Bot, Cable, OctagonX, Plug, PlugZap, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { useRobot } from "@/lib/store";
import { emergencyStop } from "@/lib/ros";

const TRANSPORT_LABEL = { mock: "시뮬레이터", rosbridge: "rosbridge", mqtt: "MQTT" } as const;

export default function Header({
  enabled, onToggle, onReconnect, onSettings,
}: { enabled: boolean; onToggle: () => void; onReconnect: () => void; onSettings: () => void }) {
  const conn = useRobot((s) => s.conn);
  const detail = useRobot((s) => s.connDetail);
  const settings = useRobot((s) => s.settings);
  const estop = useRobot((s) => s.estop);

  const dot = { connected: "bg-signal", connecting: "bg-amber blink", error: "bg-alert blink", disconnected: "bg-ink-600" }[conn];
  const label = { connected: "온라인", connecting: "연결 중", error: "오류", disconnected: "오프라인" }[conn];

  return (
    <header className="sticky top-0 z-[1000] flex h-12 items-center gap-3 border-b border-ink-700 bg-ink-950/95 px-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded bg-signal/10 text-signal"><Bot className="size-4" /></div>
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold tracking-tight">TB3 관제</div>
          <div className="truncate font-mono text-[10px] text-ink-400">
            {settings.robotId} · {settings.robotModel === "waffle_pi" ? "Waffle Pi" : "Burger"}{settings.showArm ? " + OMX" : ""}
          </div>
        </div>
      </div>

      <div className="ml-2 hidden items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 sm:flex">
        <span className={`size-2 rounded-full ${dot}`} />
        <span className="text-xs">{label}</span>
        <span className="flex items-center gap-1 font-mono text-[10px] text-ink-400">
          <Cable className="size-3" />
          {TRANSPORT_LABEL[settings.transport]}
        </span>
        {detail && <span className="max-w-[260px] truncate font-mono text-[10px] text-ink-400">{detail}</span>}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={onReconnect} title="다시 연결" className="grid size-8 place-items-center rounded text-ink-300 hover:bg-ink-800">
          <RefreshCw className="size-4" />
        </button>
        <button
          onClick={onToggle}
          title={enabled ? "연결 끊기" : "연결"}
          className="grid size-8 place-items-center rounded text-ink-300 hover:bg-ink-800"
        >
          {enabled ? <PlugZap className="size-4 text-signal" /> : <Plug className="size-4" />}
        </button>
        <button onClick={onSettings} title="설정" className="grid size-8 place-items-center rounded text-ink-300 hover:bg-ink-800">
          <Settings2 className="size-4" />
        </button>
        <button
          onClick={() => (estop ? useRobot.getState().set({ estop: false }) : emergencyStop())}
          className={`ml-1 flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md px-3 text-xs font-bold tracking-wider transition-colors ${
            estop
              ? "border border-amber/60 bg-amber/10 text-amber"
              : "bg-alert text-white shadow-[0_0_0_1px_rgba(255,77,79,0.4),0_0_18px_rgba(255,77,79,0.35)] hover:bg-red-500"
          }`}
          title="단축키: Space"
        >
          {estop ? <ShieldCheck className="size-4" /> : <OctagonX className="size-4" />}
          {estop ? "잠금 해제" : "E-STOP"}
        </button>
      </div>
    </header>
  );
}
