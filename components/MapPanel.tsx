"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Building2, CircleStop, Crosshair, Flag, FolderOpen, LocateFixed, Map as MapIcon, RefreshCw, Satellite } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useRobot } from "@/lib/store";
import { sendGoal, sendInitialPose, sendMapCmd } from "@/lib/ros";
import { Chip, IconBtn, Panel } from "./Panel";

const robotIcon = (color: string) =>
  L.divIcon({
    className: "robot-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="rot" style="width:34px;height:34px;transform-origin:50% 50%">
      <svg viewBox="0 0 34 34" width="34" height="34">
        <circle cx="17" cy="17" r="9" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>
        <path d="M17 11 L28 17 L17 23 Z" fill="${color}"/>
        <circle cx="17" cy="17" r="2.4" fill="#fff"/>
      </svg></div>`,
  });

function setMarkerYaw(m: L.Marker, yaw: number) {
  const el = m.getElement()?.querySelector<HTMLDivElement>(".rot");
  if (el) el.style.transform = `rotate(${(-yaw * 180) / Math.PI}deg)`;
}

/** OccupancyGrid → PNG dataURL (빈 곳 밝은 회색, 벽 검정, 미탐색 투명) */
function gridToDataUrl(g: NonNullable<ReturnType<typeof useRobot.getState>["map"]>) {
  const c = document.createElement("canvas");
  c.width = g.width; c.height = g.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(g.width, g.height);
  for (let j = 0; j < g.height; j++) {
    const row = g.height - 1 - j; // ROS 그리드는 아래에서 위로
    for (let i = 0; i < g.width; i++) {
      const v = g.data[j * g.width + i];
      const o = (row * g.width + i) * 4;
      if (v < 0) { img.data[o + 3] = 0; continue; }
      const occ = v / 100;
      const free = [38, 52, 66], wall = [214, 228, 240];
      img.data[o] = free[0] + (wall[0] - free[0]) * occ;
      img.data[o + 1] = free[1] + (wall[1] - free[1]) * occ;
      img.data[o + 2] = free[2] + (wall[2] - free[2]) * occ;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** 지도 위 지정 도구: Nav2 목표(/goal_pose) 또는 AMCL 초기 위치(/initialpose) */
type Tool = "none" | "goal" | "pose";
const TOOL_COLOR = { goal: "#f5b33d", pose: "#5aa9ff" } as const;

function IndoorLayers({ tool, follow, onDone }: { tool: Tool; follow: boolean; onDone: () => void }) {
  const map = useMap();
  const overlay = useRef<L.ImageOverlay | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const trail = useRef<L.Polyline | null>(null);
  const goalArrow = useRef<L.Polyline | null>(null);
  const fitted = useRef(false);
  const lastBounds = useRef("");
  const follows = useRef(follow);
  follows.current = follow;

  useEffect(() => {
    marker.current = L.marker([0, 0], { icon: robotIcon("#2ee6c5"), interactive: false, zIndexOffset: 1000 }).addTo(map);
    trail.current = L.polyline([], { color: "#2ee6c5", weight: 2, opacity: 0.5 }).addTo(map);
    goalArrow.current = L.polyline([], { color: "#f5b33d", weight: 3 }).addTo(map);
    // 1 m 격자 기준 축척
    L.control.scale({ metric: true, imperial: false, maxWidth: 120 }).addTo(map);

    let lastMapVer = -1;
    let trailPts: L.LatLngExpression[] = [];
    const apply = (s: ReturnType<typeof useRobot.getState>) => {
      if (s.map && s.map.version !== lastMapVer) {
        lastMapVer = s.map.version;
        const g = s.map;
        const b = L.latLngBounds([g.originY, g.originX], [g.originY + g.height * g.resolution, g.originX + g.width * g.resolution]);
        const url = gridToDataUrl(g);
        if (!overlay.current) overlay.current = L.imageOverlay(url, b, { opacity: 0.95, className: "pixelated" }).addTo(map).bringToBack();
        else { overlay.current.setUrl(url); overlay.current.setBounds(b); }
        const el = overlay.current.getElement();
        if (el) el.style.imageRendering = "pixelated";
        // 다른 지도를 불러오면(크기·원점이 바뀌면) 다시 맞춤
        const key = `${g.width}x${g.height}@${g.originX},${g.originY},${g.resolution}`;
        if (!fitted.current || key !== lastBounds.current) { map.fitBounds(b, { padding: [10, 10] }); fitted.current = true; }
        lastBounds.current = key;
      }
      const p = s.mapPose ?? s.odom;
      if (p && marker.current) {
        marker.current.setLatLng([p.y, p.x]);
        setMarkerYaw(marker.current, p.yaw);
        const last = trailPts[trailPts.length - 1] as [number, number] | undefined;
        if (!last || Math.hypot(last[0] - p.y, last[1] - p.x) > 0.03) {
          trailPts = [...trailPts.slice(-1500), [p.y, p.x]];
          trail.current?.setLatLngs(trailPts);
        }
        if (!fitted.current) { map.setView([p.y, p.x], 6); fitted.current = true; }
        if (follows.current && !map.getBounds().pad(-0.25).contains([p.y, p.x])) map.panTo([p.y, p.x], { animate: true });
      }
    };
    apply(useRobot.getState());
    const unsub = useRobot.subscribe(apply);
    return () => {
      unsub();
      marker.current?.remove(); trail.current?.remove(); goalArrow.current?.remove(); overlay.current?.remove();
      overlay.current = null;
    };
  }, [map]);

  // 목표·초기 위치 지정: 누른 곳 = 위치, 끌어서 방향
  useEffect(() => {
    if (tool === "none") return;
    goalArrow.current?.setStyle({ color: TOOL_COLOR[tool] });
    map.dragging.disable();
    map.getContainer().style.cursor = "crosshair";
    let start: L.LatLng | null = null;
    const down = (e: L.LeafletMouseEvent) => { start = e.latlng; goalArrow.current?.setLatLngs([start, start]); };
    const move = (e: L.LeafletMouseEvent) => { if (start) goalArrow.current?.setLatLngs([start, e.latlng]); };
    const up = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      let yaw: number;
      const dx = e.latlng.lng - start.lng, dy = e.latlng.lat - start.lat;
      if (Math.hypot(dx, dy) > 0.05) yaw = Math.atan2(dy, dx);
      else {
        const p = useRobot.getState().mapPose ?? useRobot.getState().odom;
        yaw = p ? Math.atan2(start.lat - p.y, start.lng - p.x) : 0;
      }
      if (tool === "goal") sendGoal(start.lng, start.lat, yaw);
      else sendInitialPose(start.lng, start.lat, yaw);
      const s = start;
      start = null;
      setTimeout(() => goalArrow.current?.setLatLngs([s, [s.lat + Math.sin(yaw) * 0.3, s.lng + Math.cos(yaw) * 0.3]]), 0);
      onDone();
    };
    map.on("mousedown", down); map.on("mousemove", move); map.on("mouseup", up);
    return () => {
      map.off("mousedown", down); map.off("mousemove", move); map.off("mouseup", up);
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    };
  }, [tool, map, onDone]);

  return null;
}

function OutdoorLayers({ follow }: { follow: boolean }) {
  const map = useMap();
  const follows = useRef(follow);
  follows.current = follow;
  useEffect(() => {
    const m = L.marker([0, 0], { icon: robotIcon("#f5b33d"), interactive: false }).addTo(map);
    const tr = L.polyline([], { color: "#f5b33d", weight: 3, opacity: 0.7 }).addTo(map);
    let centered = false;
    let lastLen = -1;
    const apply = (s: ReturnType<typeof useRobot.getState>) => {
      if (!s.gps) return;
      m.setLatLng([s.gps.lat, s.gps.lon]);
      // NavSatFix 에는 방향이 없으므로 odom yaw 를 같이 씀 (IMU/GPS 헤딩이 있으면 교체)
      if (s.odom) setMarkerYaw(m, s.odom.yaw);
      if (s.gpsTrail.length !== lastLen) { lastLen = s.gpsTrail.length; tr.setLatLngs(s.gpsTrail); }
      if (!centered) { map.setView([s.gps.lat, s.gps.lon], 19); centered = true; }
      else if (follows.current && !map.getBounds().pad(-0.25).contains([s.gps.lat, s.gps.lon])) map.panTo([s.gps.lat, s.gps.lon]);
    };
    apply(useRobot.getState());
    const unsub = useRobot.subscribe(apply);
    return () => { unsub(); m.remove(); tr.remove(); };
  }, [map]);
  return null;
}

const NAV2_LABEL = { off: "Nav2 꺼짐", starting: "Nav2 시작 중", active: "Nav2 실행 중" } as const;

/** robot-side/map_manager.py 의 지도 목록 — tb3_lidar_mapper 가 ~/maps 에 저장한 지도를 Nav2 로 불러오기 */
function MapPicker({ onClose }: { onClose: () => void }) {
  const mm = useRobot((s) => s.mapManager);
  const [initPose, setInitPose] = useState(true);
  return (
    <div className="absolute right-2 top-2 z-[600] w-72 max-w-[calc(100%-16px)] rounded-md border border-ink-600 bg-ink-900/95 p-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-semibold text-ink-100">지도 불러오기</span>
        {mm && <Chip tone={mm.nav2 === "active" ? "ok" : mm.nav2 === "starting" ? "warn" : "muted"}>{NAV2_LABEL[mm.nav2] ?? mm.nav2}</Chip>}
        <button title="목록 새로고침" onClick={() => sendMapCmd({ action: "refresh" })} className="ml-auto text-ink-400 hover:text-ink-100">
          <RefreshCw className="size-3.5" />
        </button>
        <button onClick={onClose} className="px-1 text-ink-400 hover:text-ink-100">✕</button>
      </div>
      {!mm ? (
        <p className="leading-snug text-ink-400">
          지도 관리 노드 응답 없음. 로봇에서 <code className="text-ink-200">robot-side/map_manager.py</code> 를 실행하세요.
        </p>
      ) : (
        <>
          <div className="mb-1 truncate font-mono text-[10px] text-ink-400" title={mm.dir}>{mm.dir}</div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {mm.maps.length === 0 && <li className="text-ink-400">지도가 없습니다 — TB3 Mapper 앱에서 업로드하세요</li>}
            {mm.maps.map((m) => (
              <li key={m.name} className={`flex items-center gap-2 rounded px-1.5 py-1 ${mm.loaded === m.name ? "bg-signal/10" : "hover:bg-ink-800"}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-ink-100">{m.name}{mm.loaded === m.name && <span className="ml-1 text-signal">●</span>}</div>
                  {m.error ? <div className="text-[10px] text-alert">{m.error}</div> : <div className="text-[10px] text-ink-400">
                    {m.width_m != null ? `${m.width_m}×${m.height_m} m · ` : ""}{(m.res * 100).toFixed(0)} cm · yaw {((m.yaw * 180) / Math.PI).toFixed(1)}° · {new Date(m.mtime * 1000).toLocaleDateString()}
                  </div>}
                </div>
                <button disabled={mm.busy || !!m.error} onClick={() => sendMapCmd({ action: "load", name: m.name, initial_pose: initPose })}
                  className="rounded bg-signal px-2 py-1 text-[11px] font-semibold text-ink-950 disabled:opacity-40">
                  {mm.loaded === m.name ? "다시" : "불러오기"}
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-300">
            <input type="checkbox" checked={initPose} onChange={(e) => setInitPose(e.target.checked)} />
            출발 자리(0, 0)를 초기 위치로 — 로봇을 출발 테이프 위에 두세요
          </label>
          {mm.msg && <p className={`mt-1.5 leading-snug ${mm.busy ? "text-amber" : "text-ink-300"}`}>{mm.busy ? "⏳ " : ""}{mm.msg}</p>}
          {mm.managed && mm.nav2 !== "off" && (
            <button onClick={() => sendMapCmd({ action: "stop_nav2" })} disabled={mm.busy}
              className="mt-2 w-full rounded border border-ink-600 py-1 text-[11px] text-ink-300 hover:text-ink-100 disabled:opacity-40">Nav2 끄기</button>
          )}
        </>
      )}
    </div>
  );
}

export default function MapPanel() {
  const [mode, setMode] = useState<"indoor" | "outdoor">("indoor");
  const [tool, setTool] = useState<Tool>("none");
  const [picker, setPicker] = useState(false);
  const [follow, setFollow] = useState(true);
  const hasMap = useRobot((s) => !!s.map);
  const hasAmcl = useRobot((s) => !!s.mapPose);
  const loaded = useRobot((s) => s.mapManager?.loaded ?? null);
  const navActive = useRobot((s) => s.mapManager?.nav === "active");
  const gps = useRobot((s) => s.gps);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const toggleTool = (t: Tool) => setTool((v) => (v === t ? "none" : t));
  const onDone = useCallback(() => setTool("none"), []);

  return (
    <Panel
      title={mode === "indoor" ? "실내 맵" : "실외 GPS"}
      icon={MapIcon}
      className="h-full"
      right={
        <>
          {mode === "indoor" ? (
            <Chip tone={hasMap ? "ok" : "muted"}>{hasMap ? `${loaded ?? "map"} · ${hasAmcl ? "amcl" : "odom"}` : "map 없음"}</Chip>
          ) : (
            <Chip tone={gps ? (gps.fix >= 0 ? "ok" : "warn") : "muted"}>{gps ? (gps.fix >= 1 ? "RTK/DGPS" : gps.fix === 0 ? "GPS FIX" : "NO FIX") : "GPS 없음"}</Chip>
          )}
          {mode === "indoor" && (
            <>
              <IconBtn title="지도 불러오기 (tb3_lidar_mapper)" active={picker} onClick={() => setPicker((v) => !v)}>
                <FolderOpen className="size-3.5" />
              </IconBtn>
              <IconBtn title="초기 위치 지정 (누르고 끌어서 방향)" active={tool === "pose"} onClick={() => toggleTool("pose")}>
                <Crosshair className="size-3.5" />
              </IconBtn>
              <IconBtn title="Nav2 목표 지정 (누르고 끌어서 방향)" active={tool === "goal"} onClick={() => toggleTool("goal")}>
                <Flag className="size-3.5" />
              </IconBtn>
              {navActive && (
                <IconBtn title="주행 취소" onClick={() => sendMapCmd({ action: "cancel" })}>
                  <CircleStop className="size-3.5 text-alert" />
                </IconBtn>
              )}
            </>
          )}
          <IconBtn title="로봇 따라가기" active={follow} onClick={() => setFollow((v) => !v)}><LocateFixed className="size-3.5" /></IconBtn>
          <IconBtn title={mode === "indoor" ? "실외 지도로" : "실내 맵으로"} onClick={() => { setMode((m) => (m === "indoor" ? "outdoor" : "indoor")); setTool("none"); setPicker(false); }}>
            {mode === "indoor" ? <Satellite className="size-3.5" /> : <Building2 className="size-3.5" />}
          </IconBtn>
        </>
      }
    >
      {mode === "indoor" ? (
        <MapContainer key="indoor" crs={L.CRS.Simple} center={[0, 0]} zoom={6} minZoom={2} maxZoom={10}
          zoomSnap={0.25} attributionControl={false} className="grid-bg h-full w-full">
          <IndoorLayers tool={tool} follow={follow} onDone={onDone} />
        </MapContainer>
      ) : (
        <MapContainer key="outdoor" center={[37.5665, 126.978]} zoom={17} maxZoom={21} className="h-full w-full">
          {token ? (
            <TileLayer
              url={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${token}`}
              attribution='© <a href="https://www.mapbox.com/">Mapbox</a> © OpenStreetMap' tileSize={512} zoomOffset={-1} maxZoom={21}
            />
          ) : (
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='© OpenStreetMap © CARTO' maxNativeZoom={19} maxZoom={21} />
          )}
          <OutdoorLayers follow={follow} />
        </MapContainer>
      )}
      {mode === "indoor" && picker && <MapPicker onClose={() => setPicker(false)} />}
      {tool !== "none" && (
        <div className={`pointer-events-none absolute left-1/2 top-2 z-[500] -translate-x-1/2 rounded px-2 py-1 text-[11px] font-medium text-ink-950 ${tool === "goal" ? "bg-amber" : "bg-[#5aa9ff]"}`}>
          {tool === "goal" ? "지도에서 목표 위치를 누르고, 끌어서 방향을 정하세요" : "로봇이 있는 곳을 누르고, 로봇이 보는 방향으로 끄세요"}
        </div>
      )}
    </Panel>
  );
}
