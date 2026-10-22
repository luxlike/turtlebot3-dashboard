"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Box, Crosshair, Eye, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useRobot } from "@/lib/store";

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;
import { Chip, IconBtn, Panel } from "./Panel";

/*
 * 좌표계: 바깥 그룹을 X축으로 -90° 돌려 ROS(z-up, x 앞, y 왼쪽) 좌표를 그대로 씁니다.
 * 월드 = odom 프레임. 로봇은 odom 포즈에, 스캔/포인트클라우드는 로봇의 자식(센서 프레임)으로 둡니다.
 */

const C = { body: "#2b3644", plate: "#1d2633", dark: "#0f141b", accent: "#2ee6c5", arm: "#d7dee7", servo: "#30363f", wheel: "#14181e" };

/** OpenMANIPULATOR-X 치수 (open_manipulator_x URDF) */
function OmxArm({ joints }: { joints: React.RefObject<Record<string, number>> }) {
  const j1 = useRef<THREE.Group>(null), j2 = useRef<THREE.Group>(null), j3 = useRef<THREE.Group>(null), j4 = useRef<THREE.Group>(null);
  const fl = useRef<THREE.Mesh>(null), fr = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const j = joints.current ?? {};
    const lerp = (g: THREE.Group | null, axis: "y" | "z", v: number | undefined) => {
      if (g && v != null && isFinite(v)) g.rotation[axis] += (v - g.rotation[axis]) * 0.35;
    };
    lerp(j1.current, "z", j.joint1);
    lerp(j2.current, "y", j.joint2);
    lerp(j3.current, "y", j.joint3);
    lerp(j4.current, "y", j.joint4);
    const g = j.gripper ?? 0.01;
    if (fl.current) fl.current.position.y = 0.021 + g;
    if (fr.current) fr.current.position.y = -(0.021 + g);
  });
  const servo = (args: [number, number, number], pos: [number, number, number] = [0, 0, 0]) => (
    <mesh position={pos} castShadow><boxGeometry args={args} /><meshStandardMaterial color={C.servo} roughness={0.6} /></mesh>
  );
  return (
    <group>
      {servo([0.034, 0.028, 0.046], [0.012, 0, 0.023])}
      <group ref={j1} position={[0.012, 0, 0.017]}>
        <group position={[0, 0, 0.0595]}>
          <group ref={j2}>
            {servo([0.028, 0.034, 0.046])}
            <mesh position={[0.012, 0, 0.064]} rotation={[0, Math.atan2(0.024, 0.128), 0]}>
              <boxGeometry args={[0.02, 0.026, 0.128]} /><meshStandardMaterial color={C.arm} metalness={0.2} roughness={0.4} />
            </mesh>
            <group ref={j3} position={[0.024, 0, 0.128]}>
              {servo([0.028, 0.034, 0.046])}
              <mesh position={[0.062, 0, 0]}>
                <boxGeometry args={[0.124, 0.026, 0.02]} /><meshStandardMaterial color={C.arm} metalness={0.2} roughness={0.4} />
              </mesh>
              <group ref={j4} position={[0.124, 0, 0]}>
                {servo([0.046, 0.034, 0.028], [0.02, 0, 0])}
                <mesh position={[0.06, 0, 0]}>
                  <boxGeometry args={[0.03, 0.06, 0.016]} /><meshStandardMaterial color={C.dark} />
                </mesh>
                <mesh ref={fl} position={[0.1, 0.03, 0]}>
                  <boxGeometry args={[0.05, 0.006, 0.018]} /><meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.25} />
                </mesh>
                <mesh ref={fr} position={[0.1, -0.03, 0]}>
                  <boxGeometry args={[0.05, 0.006, 0.018]} /><meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.25} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function TurtleBot() {
  const model = useRobot((s) => s.settings.robotModel);
  const showArm = useRobot((s) => s.settings.showArm);
  const mx = useRobot((s) => s.settings.armMountX);
  const mz = useRobot((s) => s.settings.armMountZ);
  const group = useRef<THREE.Group>(null);
  const jointsRef = useRef<Record<string, number>>({});

  useFrame(() => {
    const s = useRobot.getState();
    jointsRef.current = s.joints;
    if (!group.current || !s.odom) return;
    group.current.position.set(s.odom.x, s.odom.y, 0);
    group.current.rotation.z = s.odom.yaw;
  });

  const waffle = model === "waffle_pi";
  const L = waffle ? 0.281 : 0.138, W = waffle ? 0.306 : 0.178;
  const wheelY = waffle ? 0.144 : 0.08;
  const plates = waffle ? [0.03, 0.075, 0.12] : [0.03, 0.075, 0.12, 0.165];
  // 경로 A 는 LiDAR 가 앞쪽으로 이동
  const lidarX = waffle ? (showArm ? 0.05 : -0.064) : -0.032;
  const lidarZ = waffle ? 0.135 : 0.19;

  return (
    <group ref={group}>
      {plates.map((z, i) => (
        <mesh key={i} position={[waffle ? -0.064 : -0.032, 0, z]} castShadow>
          <boxGeometry args={[L, W, 0.006]} />
          <meshStandardMaterial color={i === plates.length - 1 ? C.body : C.plate} roughness={0.8} />
        </mesh>
      ))}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => (
        <mesh key={i} position={[(waffle ? -0.064 : -0.032) + (sx * L) / 2.3, (sy * W) / 2.3, 0.075]}>
          <cylinderGeometry args={[0.004, 0.004, 0.09]} /><meshStandardMaterial color="#556" />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, s * wheelY, 0.033]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.033, 0.033, 0.018, 24]} /><meshStandardMaterial color={C.wheel} roughness={0.9} />
        </mesh>
      ))}
      <group position={[lidarX, 0, lidarZ]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.038, 0.03, 32]} /><meshStandardMaterial color="#1a1d22" />
        </mesh>
        <mesh position={[0, 0, 0.018]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.028, 0.006, 32]} /><meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.6} />
        </mesh>
      </group>
      {/* 정면 표시 */}
      <mesh position={[(waffle ? 0.08 : 0.04), 0, plates[plates.length - 1] + 0.006]}>
        <coneGeometry args={[0.018, 0.035, 3]} /><meshBasicMaterial color={C.accent} />
      </mesh>
      {showArm && (
        <group position={[mx, 0, mz]}>
          <OmxArm joints={jointsRef} />
        </group>
      )}
      <ScanPoints lidarX={lidarX} lidarZ={lidarZ + 0.01} />
      <CloudPoints />
    </group>
  );
}

function ScanPoints({ lidarX, lidarZ }: { lidarX: number; lidarZ: number }) {
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const ver = useRef(-1);
  useFrame(() => {
    const s = useRobot.getState();
    if (s.scanVersion === ver.current) return;
    ver.current = s.scanVersion;
    geo.setAttribute("position", new THREE.BufferAttribute(s.scan, 3));
    geo.computeBoundingSphere();
  });
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo} position={[lidarX, 0, lidarZ]}>
      <pointsMaterial size={0.035} color="#ff5a5f" sizeAttenuation />
    </points>
  );
}

function CloudPoints() {
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const ver = useRef(-1);
  useFrame(() => {
    const s = useRobot.getState();
    if (s.cloudVersion === ver.current) return;
    ver.current = s.cloudVersion;
    const pos = s.cloud;
    const col = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      // 높이 기반 색 (0 ~ 1.5 m: 청록 → 호박색)
      const t = Math.max(0, Math.min(1, pos[i + 2] / 1.5));
      col[i] = 0.18 + 0.78 * t; col[i + 1] = 0.9 - 0.2 * t; col[i + 2] = 0.77 - 0.53 * t;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
  });
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.02} vertexColors sizeAttenuation />
    </points>
  );
}

function Trail() {
  const line = useMemo(
    () => new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#2ee6c5", transparent: true, opacity: 0.55 })),
    [],
  );
  const len = useRef(-1);
  useFrame(() => {
    const s = useRobot.getState();
    if (s.odomTrailLen === len.current) return;
    len.current = s.odomTrailLen;
    const p = new Float32Array(s.odomTrailLen * 3);
    for (let i = 0; i < s.odomTrailLen; i++) {
      p[i * 3] = s.odomTrail[i * 2];
      p[i * 3 + 1] = s.odomTrail[i * 2 + 1];
      p[i * 3 + 2] = 0.002;
    }
    line.geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
    line.geometry.computeBoundingSphere();
  });
  return <primitive object={line} />;
}

/** 카메라 타깃이 로봇을 따라가도록 (follow 켰을 때) */
function Follow({ enabled, controls }: { enabled: boolean; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const o = useRobot.getState().odom;
    const c = controls.current;
    if (!enabled || !o || !c) return;
    // ROS (x, y, z) → three (x, z, -y)
    tmp.set(o.x, 0.1, -o.y);
    const delta = tmp.clone().sub(c.target).multiplyScalar(0.12);
    c.target.add(delta);
    camera.position.add(delta);
    c.update();
  });
  return null;
}

export default function Scene3D() {
  const [follow, setFollow] = useState(true);
  const [topView, setTopView] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const scanHz = useRobot((s) => s.rates[s.settings.topics.scan] ?? 0);
  const cloudOn = useRobot((s) => !!s.settings.topics.pointCloud);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const t = c.target;
    if (topView) c.object.position.set(t.x, 3.2, t.z + 0.001);
    else c.object.position.set(t.x - 1.3, 1.1, t.z + 1.3);
    c.update();
  }, [topView]);

  return (
    <Panel
      title="3D 뷰"
      icon={Box}
      className="h-full"
      right={
        <>
          <Chip tone={scanHz > 0 ? "ok" : "muted"}>scan {scanHz} Hz</Chip>
          {cloudOn && <Chip>cloud</Chip>}
          <IconBtn title="격자" active={showGrid} onClick={() => setShowGrid((v) => !v)}><Layers className="size-3.5" /></IconBtn>
          <IconBtn title="위에서 보기" active={topView} onClick={() => setTopView((v) => !v)}><Eye className="size-3.5" /></IconBtn>
          <IconBtn title="로봇 따라가기" active={follow} onClick={() => setFollow((v) => !v)}><Crosshair className="size-3.5" /></IconBtn>
        </>
      }
    >
      <Canvas shadows dpr={[1, 2]} camera={{ position: [-1.3, 1.1, 1.3], fov: 45, near: 0.01, far: 200 }} gl={{ antialias: true }}>
        <color attach="background" args={["#0b1016"]} />
        <fog attach="fog" args={["#0b1016", 6, 18]} />
        <hemisphereLight args={["#cfe8ff", "#1a1f26", 0.8]} />
        <directionalLight position={[2, 4, 1.5]} intensity={1.4} castShadow />
        {showGrid && (
          <Grid args={[40, 40]} cellSize={0.1} sectionSize={1} cellColor="#16202b" sectionColor="#24425a" fadeDistance={14} infiniteGrid />
        )}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <axesHelper args={[0.3]} />
          <Trail />
          <TurtleBot />
        </group>
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} />
        <Follow enabled={follow} controls={controls} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-ink-400">
        odom 프레임 · 드래그 회전 · 휠 확대 · 우클릭 이동
      </div>
    </Panel>
  );
}
