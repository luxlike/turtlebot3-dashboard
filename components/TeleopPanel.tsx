"use client";
import { Gamepad2, Keyboard, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRobot } from "@/lib/store";
import { SPEED_LIMITS } from "@/lib/settings";
import { emergencyStop, publishTwist, sendString } from "@/lib/ros";
import { Chip, Panel } from "./Panel";

/**
 * 원격 조종
 * - 가상 조이스틱(마우스·터치) / 키보드 WASD·방향키 / Xbox 컨트롤러(LB 데드맨), Space·B = 비상정지
 * - 누르고 있는 동안만 10 Hz 로 cmd_vel 발행(데드맨), 떼면 0 을 3번 보내고 발행 중단
 * - 조종을 시작하면 walle_vision 을 idle 로 돌려 cmd_vel 충돌을 막음
 */
export default function TeleopPanel() {
  const model = useRobot((s) => s.settings.robotModel);
  const estop = useRobot((s) => s.estop);
  const conn = useRobot((s) => s.conn);
  const driveMode = useRobot((s) => s.driveMode);
  const lim = SPEED_LIMITS[model];
  const [scale, setScale] = useState(0.6);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const [keyboard, setKeyboard] = useState(true);
  const cmd = useRef({ v: 0, w: 0 });
  const padRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const start = useCallback(() => {
    if (timer.current) return;
    if (useRobot.getState().driveMode !== "idle") sendString("driveMode", "idle");
    setActive(true);
    timer.current = setInterval(() => publishTwist(cmd.current.v, cmd.current.w), 100);
    publishTwist(cmd.current.v, cmd.current.w);
  }, []);
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    cmd.current = { v: 0, w: 0 };
    setActive(false);
    for (let i = 0; i < 3; i++) setTimeout(() => publishTwist(0, 0), i * 50);
  }, []);

  // 조이스틱 → 속도 (위 = 전진, 왼쪽 = 반시계 회전)
  const setFromVec = useCallback((x: number, y: number, scaleOverride?: number) => {
    const r = Math.hypot(x, y);
    if (r > 1) { x /= r; y /= r; }
    setKnob({ x, y });
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    const s = scaleOverride ?? scaleRef.current;
    cmd.current = { v: dz(-y) * lim.lin * s, w: dz(-x) * lim.ang * s };
  }, [lim]);

  // Xbox 컨트롤러 (브라우저 Gamepad API, standard 매핑)
  // LB 누르고 있는 동안만 발행(데드맨) · 왼쪽 스틱 상하 = 전진/후진 · 오른쪽 스틱 좌우 = 회전
  // RB = 최대 속도(터보) · B = 비상정지 · 십자키 ↑↓ = 속도 한계 ±5%
  const [pad, setPad] = useState<string | null>(null);
  const [padHeld, setPadHeld] = useState(false);
  const [padIssue, setPadIssue] = useState<string | null>(null);
  useEffect(() => {
    // http(비보안) 로 열면 Firefox 등은 Gamepad API 를 아예 막음 → 이유를 화면에 표시
    if (typeof navigator.getGamepads !== "function") {
      setPadIssue(window.isSecureContext ? "이 브라우저는 Gamepad API 미지원" : "http 접속이라 브라우저가 컨트롤러를 막음 — Chrome/Edge 사용 또는 localhost·https 로 여세요");
      return;
    }
    let raf = 0;
    let held = false;
    let prev: boolean[] = [];
    const release = () => {
      if (!held) return;
      held = false;
      setPadHeld(false);
      setKnob({ x: 0, y: 0 });
      stop();
    };
    // standard 매핑 패드를 우선(맥에서 가끔 보이는 가상 장치·비표준 매핑 회피)
    const pick = () => {
      let list: Gamepad[] = [];
      try { list = Array.from(navigator.getGamepads()).filter((g): g is Gamepad => !!g && g.connected); } catch { /* 권한 정책 차단 */ }
      return list.find((g) => g.mapping === "standard") ?? list[0] ?? null;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const g = pick();
      if (!g) { setPad(null); release(); prev = []; return; }
      setPad(g.id);
      setPadIssue(g.mapping === "standard" ? null : "비표준 매핑 — 버튼 배치가 다를 수 있음 (Chrome/Edge 권장)");
      const btn = (i: number) => !!g.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !prev[i];
      const st = useRobot.getState();

      if (edge(1)) { release(); emergencyStop(); }
      if (edge(12)) setScale((s) => Math.min(1, +(s + 0.05).toFixed(2)));
      if (edge(13)) setScale((s) => Math.max(0.1, +(s - 0.05).toFixed(2)));
      prev = g.buttons.map((b) => b.pressed);

      const ok = btn(4) && !st.estop && st.conn === "connected" && !document.hidden && document.hasFocus(); // 포커스를 잃으면 패드 값이 멈출 수 있음
      if (!ok) { release(); return; }
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85); // 스틱 드리프트 제거
      setFromVec(dz(g.axes[2] ?? 0), dz(g.axes[1] ?? 0), btn(5) ? 1 : undefined);
      if (!held) { held = true; setPadHeld(true); }
      start();
    };
    raf = requestAnimationFrame(loop);
    // 탭이 숨겨지면 rAF 가 멈춰 루프 안의 포커스 검사가 돌지 않음 → 이벤트로 직접 정지
    // (키보드 조종을 꺼 둔 경우에도 패드 발행이 계속되지 않도록)
    const onDisconnect = () => release();
    window.addEventListener("gamepaddisconnected", onDisconnect);
    window.addEventListener("blur", onDisconnect);
    document.addEventListener("visibilitychange", onDisconnect);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      window.removeEventListener("blur", onDisconnect);
      document.removeEventListener("visibilitychange", onDisconnect);
      release();
    };
  }, [setFromVec, start, stop]);

  const onPointer = (e: React.PointerEvent) => {
    const el = padRef.current;
    if (!el || estop) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 18);
    const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 - 18);
    setFromVec(x, y);
  };

  // 키보드
  useEffect(() => {
    if (!keyboard) return;
    const map: Record<string, [number, number]> = {
      KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
      KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
    };
    const recompute = () => {
      let x = 0, y = 0;
      keys.current.forEach((k) => { x += map[k][0]; y += map[k][1]; });
      if (keys.current.size === 0) { setKnob({ x: 0, y: 0 }); stop(); return; }
      setFromVec(x * 0.75, y);
      start();
    };
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === "Space") { e.preventDefault(); stop(); emergencyStop(); return; }
      if (!map[e.code] || useRobot.getState().estop) return;
      e.preventDefault();
      if (!keys.current.has(e.code)) { keys.current.add(e.code); recompute(); }
    };
    const up = (e: KeyboardEvent) => {
      if (keys.current.delete(e.code)) recompute();
    };
    const blur = () => { keys.current.clear(); setKnob({ x: 0, y: 0 }); stop(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", blur);
    };
  }, [keyboard, setFromVec, start, stop]);

  useEffect(() => { if (estop) { stop(); setKnob({ x: 0, y: 0 }); } }, [estop, stop]);
  useEffect(() => () => stop(), [stop]);

  const disabled = estop || conn !== "connected";

  return (
    <Panel
      title="원격 조종"
      icon={Gamepad2}
      className="h-full"
      right={
        <>
          {driveMode !== "idle" && !active && <Chip tone="warn">자율: {driveMode}</Chip>}
          {pad && <Chip tone={padHeld ? "ok" : "muted"}>패드{padHeld ? " LB" : ""}</Chip>}
          <Chip tone={active ? "ok" : "muted"}>{active ? "TX 10Hz" : "대기"}</Chip>
        </>
      }
      bodyClass="p-3"
    >
      <div className="flex h-full flex-col items-center gap-3">
        <div
          ref={padRef}
          onPointerDown={(e) => { if (disabled) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); onPointer(e); start(); }}
          onPointerMove={(e) => active && onPointer(e)}
          onPointerUp={() => { setKnob({ x: 0, y: 0 }); stop(); }}
          onPointerCancel={() => { setKnob({ x: 0, y: 0 }); stop(); }}
          className={`relative aspect-square w-full max-w-[200px] touch-none select-none rounded-full border ${
            disabled ? "border-ink-700 opacity-50" : active ? "border-signal/60" : "border-ink-600"
          } bg-[radial-gradient(circle,#141c26_0%,#0b1016_70%)]`}
        >
          <div className="absolute inset-[22%] rounded-full border border-dashed border-ink-700" />
          <div className="absolute left-1/2 top-2 -translate-x-1/2 font-mono text-[9px] text-ink-400">FWD</div>
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-ink-700/60" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-ink-700/60" />
          <div
            className={`absolute left-1/2 top-1/2 size-12 rounded-full border-2 ${active ? "border-signal bg-signal/25" : "border-ink-400 bg-ink-700"}`}
            style={{ transform: `translate(-50%, -50%) translate(${knob.x * 70}px, ${knob.y * 70}px)` }}
          />
          {disabled && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-1 rounded bg-ink-950/80 px-2 py-1 text-[11px] text-ink-300">
                <Lock className="size-3" />{estop ? "E-STOP 잠금" : "미연결"}
              </div>
            </div>
          )}
        </div>

        <div className="grid w-full grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded border border-ink-700 bg-ink-950 px-2 py-1">
            <div className="text-[9px] text-ink-400">LINEAR</div>
            <div className="tabular-nums">{cmd.current.v.toFixed(2)} <span className="text-ink-400">m/s</span></div>
          </div>
          <div className="rounded border border-ink-700 bg-ink-950 px-2 py-1">
            <div className="text-[9px] text-ink-400">ANGULAR</div>
            <div className="tabular-nums">{cmd.current.w.toFixed(2)} <span className="text-ink-400">rad/s</span></div>
          </div>
        </div>

        <label className="w-full">
          <div className="mb-1 flex justify-between text-[10px] text-ink-400">
            <span>속도 한계</span>
            <span className="font-mono">{(lim.lin * scale).toFixed(2)} m/s · {(lim.ang * scale).toFixed(1)} rad/s</span>
          </div>
          <input type="range" min={0.1} max={1} step={0.05} value={scale} onChange={(e) => setScale(+e.target.value)} className="w-full" />
        </label>

        <button onClick={() => setKeyboard((k) => !k)}
          className={`flex w-full items-center justify-center gap-1.5 rounded border py-1 text-[11px] ${keyboard ? "border-signal-dim text-signal" : "border-ink-600 text-ink-400"}`}>
          <Keyboard className="size-3.5" /> WASD / 방향키 {keyboard ? "켜짐" : "꺼짐"} · Space 비상정지
        </button>

        <div className={`w-full rounded border px-2 py-1 text-[10px] leading-relaxed ${pad ? "border-ink-600 text-ink-300" : "border-ink-700 text-ink-400"}`}>
          <div className="flex items-center gap-1.5">
            <Gamepad2 className="size-3.5 shrink-0" />
            <span className="truncate">{pad ? pad.replace(/\s*\(.*\)\s*$/, "") || "컨트롤러" : "컨트롤러 없음 — 연결 후 아무 버튼이나 누르세요"}</span>
          </div>
          {pad && <div className="font-mono text-[9px] text-ink-400">LB 누른 채 L스틱↕ 전후 · R스틱↔ 회전 · RB 최대속도 · B 비상정지 · 십자↕ 속도</div>}
          {padIssue && <div className="text-[9px] text-amber">{padIssue}</div>}
        </div>
      </div>
    </Panel>
  );
}
