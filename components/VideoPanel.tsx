"use client";
import { Camera, Download, Maximize2, RotateCw, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRobot } from "@/lib/store";
import { Chip, IconBtn, Panel } from "./Panel";

interface Stats { fps: number; w: number; h: number; kbps: number; rttMs: number | null; jitterMs: number | null }

/** non-trickle WHEP: ICE 수집을 끝까지 기다렸다가 SDP 한 번에 POST (MediaMTX · go2rtc 공통) */
async function whepConnect(url: string, video: HTMLVideoElement, signal: AbortSignal) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }], bundlePolicy: "max-bundle" });
  const tr = pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  // 저지연: 지터 버퍼 최소화 (Chrome 지원, 다른 브라우저는 무시)
  const r = tr.receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number };
  try { r.jitterBufferTarget = 0; } catch { /* noop */ }
  try { r.playoutDelayHint = 0; } catch { /* noop */ }

  pc.ontrack = (e) => {
    if (!video.srcObject) video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise<void>((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const t = setTimeout(res, 1500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); }
    });
  });
  const resp = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription!.sdp, signal,
  });
  if (!resp.ok) throw new Error(`WHEP ${resp.status} ${resp.statusText}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
  return { pc, resource: resp.headers.get("Location") };
}

/** 시뮬레이터용 가짜 카메라 — 바닥 원근 격자 + 빨간 공 */
function mockStream(): MediaStream {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const g = c.getContext("2d")!;
  let t = 0;
  const draw = () => {
    t += 1 / 30;
    const { odom } = useRobot.getState();
    const yaw = odom?.yaw ?? 0, px = odom?.x ?? 0, py = odom?.y ?? 0;
    const sky = g.createLinearGradient(0, 0, 0, 160);
    sky.addColorStop(0, "#26313d"); sky.addColorStop(1, "#3a4654");
    g.fillStyle = sky; g.fillRect(0, 0, 640, 160);
    g.fillStyle = "#5b5146"; g.fillRect(0, 160, 640, 200);
    g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
    const shift = ((px * Math.cos(yaw) + py * Math.sin(yaw)) * 120) % 40;
    for (let k = 0; k < 12; k++) {
      const z = 160 + Math.pow((k * 40 + 40 - shift) / 480, 2) * 200;
      g.beginPath(); g.moveTo(0, z); g.lineTo(640, z); g.stroke();
    }
    const off = (yaw * 300) % 80;
    for (let k = -10; k < 18; k++) {
      g.beginPath(); g.moveTo(320 + (k * 80 - off - 320) * 0.05, 160); g.lineTo(k * 80 - off, 360); g.stroke();
    }
    const bx = 320 + Math.sin(t * 0.7 - yaw * 2) * 220, by = 270 + Math.sin(t * 0.4) * 20;
    const rg = g.createRadialGradient(bx - 8, by - 8, 3, bx, by, 26);
    rg.addColorStop(0, "#ff7a6b"); rg.addColorStop(1, "#b0121b");
    g.fillStyle = rg; g.beginPath(); g.arc(bx, by, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(8, 8, 196, 20);
    g.fillStyle = "#2ee6c5"; g.font = "12px monospace";
    g.fillText(`SIM CAM  ${new Date().toLocaleTimeString()}`, 14, 22);
  };
  const timer = setInterval(draw, 1000 / 30);
  const s = c.captureStream(30);
  s.getTracks()[0].addEventListener("ended", () => clearInterval(timer));
  (s as MediaStream & { _stop?: () => void })._stop = () => clearInterval(timer);
  return s;
}

export default function VideoPanel() {
  const settings = useRobot((s) => s.settings);
  const conn = useRobot((s) => s.conn);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [err, setErr] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [nonce, setNonce] = useState(0);
  const isMock = settings.transport === "mock";
  const mode = isMock ? "mock" : settings.videoMode;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode === "mjpeg" || mode === "none") return;
    const ac = new AbortController();
    let pc: RTCPeerConnection | null = null;
    let resource: string | null = null;
    let statTimer: ReturnType<typeof setInterval> | undefined;
    let mock: MediaStream | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus("connecting"); setErr(""); setStats(null);

    if (mode === "mock") {
      if (conn !== "connected") { setStatus("idle"); return; }
      mock = mockStream();
      video.srcObject = mock;
      setStatus("live");
      setStats({ fps: 30, w: 640, h: 360, kbps: 0, rttMs: null, jitterMs: null });
    } else {
      let lastBytes = 0, lastT = 0;
      whepConnect(settings.videoUrl, video, ac.signal)
        .then((r) => {
          pc = r.pc;
          resource = r.resource;
          pc.onconnectionstatechange = () => {
            if (pc?.connectionState === "connected") setStatus("live");
            if (pc?.connectionState === "failed" || pc?.connectionState === "disconnected") {
              setStatus("error"); setErr("WebRTC 연결 끊김 — 3초 후 재시도");
              retry = setTimeout(() => setNonce((n) => n + 1), 3000);
            }
          };
          statTimer = setInterval(async () => {
            if (!pc) return;
            const rep = await pc.getStats();
            let s: Stats = { fps: 0, w: 0, h: 0, kbps: 0, rttMs: null, jitterMs: null };
            rep.forEach((v) => {
              if (v.type === "inbound-rtp" && v.kind === "video") {
                const now = v.timestamp as number;
                const kbps = lastT ? ((v.bytesReceived - lastBytes) * 8) / (now - lastT) : 0;
                lastBytes = v.bytesReceived; lastT = now;
                const jb = v.jitterBufferEmittedCount ? (v.jitterBufferDelay / v.jitterBufferEmittedCount) * 1000 : null;
                s = { ...s, fps: v.framesPerSecond ?? 0, w: v.frameWidth ?? 0, h: v.frameHeight ?? 0, kbps, jitterMs: jb };
              }
              if (v.type === "candidate-pair" && v.state === "succeeded" && v.nominated && v.currentRoundTripTime != null)
                s.rttMs = v.currentRoundTripTime * 1000;
            });
            setStats(s);
          }, 1000);
        })
        .catch((e) => {
          if (ac.signal.aborted) return;
          setStatus("error");
          setErr(`${String(e.message ?? e)} — 5초 후 재시도`);
          retry = setTimeout(() => setNonce((n) => n + 1), 5000);
        });
    }

    return () => {
      ac.abort();
      clearInterval(statTimer);
      clearTimeout(retry);
      if (resource) fetch(new URL(resource, settings.videoUrl), { method: "DELETE" }).catch(() => {});
      pc?.close();
      (mock as (MediaStream & { _stop?: () => void }) | null)?._stop?.();
      mock?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [mode, settings.videoUrl, nonce, conn]);

  const snapshot = useCallback(() => {
    const v = videoRef.current;
    const img = wrapRef.current?.querySelector("img");
    const src = mode === "mjpeg" ? img : v;
    if (!src) return;
    const w = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth;
    const h = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight;
    if (!w) return;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    try {
      c.getContext("2d")!.drawImage(src, 0, 0);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `snapshot_${Date.now()}.png`;
      a.click();
    } catch {
      useRobot.getState().log("warn", "스냅샷 실패 — MJPEG 서버에 CORS 헤더가 없으면 캔버스로 복사할 수 없습니다");
    }
  }, [mode]);

  const latencyTone = stats?.rttMs != null ? (stats.rttMs > 150 ? "warn" : "ok") : "muted";

  return (
    <Panel
      title="카메라"
      icon={Video}
      className="h-full"
      right={
        <>
          <Chip tone={status === "live" ? "ok" : status === "error" ? "bad" : "muted"}>
            {mode === "mock" ? "SIM" : mode === "whep" ? "WebRTC" : mode.toUpperCase()} · {status === "live" ? "LIVE" : status.toUpperCase()}
          </Chip>
          <IconBtn title="다시 연결" onClick={() => setNonce((n) => n + 1)}><RotateCw className="size-3.5" /></IconBtn>
          <IconBtn title="스냅샷 저장" onClick={snapshot}><Download className="size-3.5" /></IconBtn>
          <IconBtn title="전체 화면" onClick={() => wrapRef.current?.requestFullscreen?.()}><Maximize2 className="size-3.5" /></IconBtn>
        </>
      }
    >
      <div ref={wrapRef} className="relative h-full w-full bg-black">
        {mode === "mjpeg" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={nonce} src={settings.videoUrl} alt="camera" crossOrigin="anonymous" className="h-full w-full object-contain"
            onLoad={() => setStatus("live")} onError={() => { setStatus("error"); setErr("MJPEG 스트림을 열 수 없음"); }} />
        ) : mode === "none" ? (
          <div className="grid h-full place-items-center text-xs text-ink-400">영상 꺼짐 (설정에서 켜기)</div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
        )}

        {/* 조준선 — 화면 중앙 = 로봇 정면 */}
        {status === "live" && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="50" y1="46" x2="50" y2="54" stroke="#2ee6c5" strokeOpacity="0.6" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
            <line x1="47.5" y1="50" x2="52.5" y2="50" stroke="#2ee6c5" strokeOpacity="0.6" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {status !== "live" && mode !== "none" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex max-w-xs flex-col items-center gap-2 text-center">
              <Camera className={`size-6 ${status === "error" ? "text-alert" : "text-ink-400"}`} />
              <div className="text-xs text-ink-300">{status === "error" ? err : status === "connecting" ? "영상 연결 중…" : "로봇 연결 대기"}</div>
              {mode !== "mock" && <div className="break-all font-mono text-[10px] text-ink-400">{settings.videoUrl}</div>}
            </div>
          </div>
        )}

        {stats && status === "live" && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
            <Chip>{stats.w}×{stats.h}</Chip>
            <Chip>{stats.fps.toFixed(0)} fps</Chip>
            {stats.kbps > 0 && <Chip>{(stats.kbps / 1000).toFixed(2)} Mbps</Chip>}
            {stats.rttMs != null && <Chip tone={latencyTone}>RTT {stats.rttMs.toFixed(0)} ms</Chip>}
            {stats.jitterMs != null && <Chip>JB {stats.jitterMs.toFixed(0)} ms</Chip>}
          </div>
        )}
      </div>
    </Panel>
  );
}
