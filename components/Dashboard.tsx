"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRobot } from "@/lib/store";
import { loadSettings } from "@/lib/settings";
import { useConnection } from "@/lib/useConnection";
import Header from "./Header";
import SettingsDrawer from "./SettingsDrawer";
import VideoPanel from "./VideoPanel";
import TeleopPanel from "./TeleopPanel";
import TelemetryPanel from "./TelemetryPanel";
import CommandPanel from "./CommandPanel";
import LogPanel from "./LogPanel";

// WebGL·Leaflet 은 브라우저 전용 → SSR 끔
const Scene3D = dynamic(() => import("./Scene3D"), { ssr: false, loading: () => <Placeholder text="3D 뷰 로딩" /> });
const MapPanel = dynamic(() => import("./MapPanel"), { ssr: false, loading: () => <Placeholder text="지도 로딩" /> });

function Placeholder({ text }: { text: string }) {
  return <div className="grid h-full place-items-center rounded-lg border border-ink-700 bg-ink-900 text-xs text-ink-400">{text}</div>;
}

export default function Dashboard() {
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    useRobot.getState().set({ settings: loadSettings() });
    setReady(true);
  }, []);

  useConnection(ready && connected, nonce);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        enabled={connected}
        onToggle={() => setConnected((c) => !c)}
        onReconnect={() => setNonce((n) => n + 1)}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="grid flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-12 lg:grid-rows-[minmax(360px,1fr)_minmax(380px,1fr)_minmax(260px,auto)]">
        <div className="h-[300px] sm:h-[380px] lg:col-span-6 lg:h-auto"><VideoPanel /></div>
        <div className="h-[340px] sm:h-[380px] lg:col-span-6 lg:h-auto"><Scene3D /></div>
        <div className="h-[380px] lg:col-span-5 lg:h-auto"><MapPanel /></div>
        <div className="lg:col-span-3"><TeleopPanel /></div>
        <div className="lg:col-span-4"><TelemetryPanel /></div>
        <div className="lg:col-span-7"><CommandPanel /></div>
        <div className="h-[260px] lg:col-span-5 lg:h-auto"><LogPanel /></div>
      </main>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
