"use client";
import { ScrollText, Trash2 } from "lucide-react";
import { useRobot } from "@/lib/store";
import { IconBtn, Panel } from "./Panel";

const TONE = { info: "text-ink-300", warn: "text-amber", error: "text-alert", cmd: "text-signal" } as const;

export default function LogPanel() {
  const logs = useRobot((s) => s.logs);
  return (
    <Panel
      title="이벤트 로그"
      icon={ScrollText}
      className="h-full"
      right={<IconBtn title="지우기" onClick={() => useRobot.getState().set({ logs: [] })}><Trash2 className="size-3.5" /></IconBtn>}
      bodyClass="overflow-y-auto"
    >
      <ol className="divide-y divide-ink-800 font-mono text-[11px]">
        {logs.length === 0 && <li className="p-3 text-ink-400">아직 이벤트가 없습니다</li>}
        {logs.map((l, i) => (
          <li key={l.t + "-" + i} className="flex gap-2 px-3 py-1">
            <span className="shrink-0 text-ink-400">{new Date(l.t).toLocaleTimeString("en-GB")}</span>
            <span className={`shrink-0 w-9 uppercase ${TONE[l.level]}`}>{l.level}</span>
            <span className="break-all text-ink-100">{l.text}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
