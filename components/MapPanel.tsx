"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Building2, Flag, LocateFixed, Map as MapIcon, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useRobot } from "@/lib/store";
import { sendGoal } from "@/lib/ros";
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

function IndoorLayers({ goalMode, follow, onGoalSent }: { goalMode: boolean; follow: boolean; onGoalSent: () => void }) {
  const map = useMap();
  const overlay = useRef<L.ImageOverlay | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const trail = useRef<L.Polyline | null>(null);
  const goalArrow = useRef<L.Polyline | null>(null);
  const fitted = useRef(false);
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
        if (!fitted.current) { map.fitBounds(b, { padding: [10, 10] }); fitted.current = true; }
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

  // 목표 지정: 누른 곳 = 위치, 끌어서 방향
  useEffect(() => {
    if (!goalMode) return;
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
      sendGoal(start.lng, start.lat, yaw);
      const s = start;
      start = null;
      setTimeout(() => goalArrow.current?.setLatLngs([s, [s.lat + Math.sin(yaw) * 0.3, s.lng + Math.cos(yaw) * 0.3]]), 0);
      onGoalSent();
    };
    map.on("mousedown", down); map.on("mousemove", move); map.on("mouseup", up);
    return () => {
      map.off("mousedown", down); map.off("mousemove", move); map.off("mouseup", up);
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    };
  }, [goalMode, map, onGoalSent]);

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

export default function MapPanel() {
  const [mode, setMode] = useState<"indoor" | "outdoor">("indoor");
  const [goalMode, setGoalMode] = useState(false);
  const [follow, setFollow] = useState(true);
  const hasMap = useRobot((s) => !!s.map);
  const hasAmcl = useRobot((s) => !!s.mapPose);
  const gps = useRobot((s) => s.gps);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return (
    <Panel
      title={mode === "indoor" ? "실내 맵" : "실외 GPS"}
      icon={MapIcon}
      className="h-full"
      right={
        <>
          {mode === "indoor" ? (
            <Chip tone={hasMap ? "ok" : "muted"}>{hasMap ? (hasAmcl ? "map · amcl" : "map · odom") : "map 없음"}</Chip>
          ) : (
            <Chip tone={gps ? (gps.fix >= 0 ? "ok" : "warn") : "muted"}>{gps ? (gps.fix >= 1 ? "RTK/DGPS" : gps.fix === 0 ? "GPS FIX" : "NO FIX") : "GPS 없음"}</Chip>
          )}
          {mode === "indoor" && (
            <IconBtn title="Nav2 목표 지정 (누르고 끌어서 방향)" active={goalMode} onClick={() => setGoalMode((v) => !v)}>
              <Flag className="size-3.5" />
            </IconBtn>
          )}
          <IconBtn title="로봇 따라가기" active={follow} onClick={() => setFollow((v) => !v)}><LocateFixed className="size-3.5" /></IconBtn>
          <IconBtn title={mode === "indoor" ? "실외 지도로" : "실내 맵으로"} onClick={() => { setMode((m) => (m === "indoor" ? "outdoor" : "indoor")); setGoalMode(false); }}>
            {mode === "indoor" ? <Satellite className="size-3.5" /> : <Building2 className="size-3.5" />}
          </IconBtn>
        </>
      }
    >
      {mode === "indoor" ? (
        <MapContainer key="indoor" crs={L.CRS.Simple} center={[0, 0]} zoom={6} minZoom={2} maxZoom={10}
          zoomSnap={0.25} attributionControl={false} className="grid-bg h-full w-full">
          <IndoorLayers goalMode={goalMode} follow={follow} onGoalSent={() => setGoalMode(false)} />
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
      {goalMode && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[500] -translate-x-1/2 rounded bg-amber px-2 py-1 text-[11px] font-medium text-ink-950">
          지도에서 목표 위치를 누르고, 끌어서 방향을 정하세요
        </div>
      )}
    </Panel>
  );
}
