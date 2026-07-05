"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Grid, Html, Line, OrbitControls, PerspectiveCamera, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import type { JobLogEntry } from "@/lib/types";

type Role =
  | "requester"
  | "orchestrator"
  | "escrow"
  | "onchain-agent-v1"
  | "news-agent-v1"
  | "compliance-agent-v1"
  | "evaluator-v1";

// Fixed hub-and-spoke layout: orchestrator is the hub every specialist call
// and payment routes through; escrow sits just behind it (every real
// contract call goes through there too); requester faces the "camera";
// specialists fan out behind; the evaluator sits off to its own side since
// it independently re-checks everyone else's work rather than being "in
// the loop" the way the orchestrator is.
const POSITIONS: Record<Role, [number, number, number]> = {
  requester: [0, 0, 5.2],
  orchestrator: [0, 0, 0],
  escrow: [0, 0, -1.7],
  "onchain-agent-v1": [-4.3, 0, -3],
  "news-agent-v1": [0, 0, -5.3],
  "compliance-agent-v1": [4.3, 0, -3],
  "evaluator-v1": [5.3, 0, 1.8],
};

const COLORS: Record<Role, string> = {
  requester: "#e4e4e7",
  orchestrator: "#5eead4",
  escrow: "#fbbf24",
  "onchain-agent-v1": "#60a5fa",
  "news-agent-v1": "#fb923c",
  "compliance-agent-v1": "#f87171",
  "evaluator-v1": "#a78bfa",
};

const LABELS: Record<Role, string> = {
  requester: "Requester",
  orchestrator: "Orchestrator",
  escrow: "Escrow",
  "onchain-agent-v1": "On-Chain",
  "news-agent-v1": "News",
  "compliance-agent-v1": "Compliance",
  "evaluator-v1": "Evaluator",
};

const KIND_COLORS: Record<string, string> = {
  call: "#5eead4",
  payment: "#fbbf24",
  response: "#4ade80",
  verdict: "#a78bfa",
  settlement: "#fbbf24",
  system: "#94a3b8",
};

function isRole(x: string | undefined): x is Role {
  return !!x && Object.prototype.hasOwnProperty.call(POSITIONS, x);
}

// Stable per-role phase offset so idle bob/rotation isn't perfectly
// synchronized across booths -- purely cosmetic, deterministic from the
// role string so it doesn't change between renders.
function hashPhase(role: string): number {
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) % 1000;
  return (h / 1000) * Math.PI * 2;
}

interface Packet {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  start: number;
  duration: number;
}

interface Impact {
  id: string;
  pos: [number, number, number];
  color: string;
  start: number;
}

/** A distinct silhouette per role instead of one generic shape repeated 7
 * times -- recognizable at a glance, not just color-coded. */
function RoleIcon({ role, color }: { role: Role; color: string }) {
  switch (role) {
    case "orchestrator":
      return (
        <>
          <mesh castShadow>
            <icosahedronGeometry args={[0.32, 0]} />
            <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.25} metalness={0.5} clearcoat={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2.4, 0, 0]}>
            <torusGeometry args={[0.56, 0.035, 12, 48]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.2} metalness={0.6} />
          </mesh>
        </>
      );
    case "escrow":
      return (
        <>
          <mesh castShadow>
            <boxGeometry args={[0.58, 0.58, 0.5]} />
            <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.35} metalness={0.6} clearcoat={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.27]}>
            <torusGeometry args={[0.16, 0.035, 10, 32]} />
            <meshStandardMaterial color="#241a04" emissive={color} emissiveIntensity={0.8} metalness={0.8} roughness={0.15} />
          </mesh>
        </>
      );
    case "onchain-agent-v1":
      return (
        <>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, i * 0.26, 0]} rotation={[0, i * 0.4, 0]} castShadow>
              <boxGeometry args={[0.46 - i * 0.06, 0.2, 0.46 - i * 0.06]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.35} metalness={0.4} />
            </mesh>
          ))}
        </>
      );
    case "news-agent-v1":
      return (
        <>
          <mesh rotation={[0.25, 0.5, 0.08]} castShadow>
            <boxGeometry args={[0.56, 0.05, 0.4]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
          </mesh>
        </>
      );
    case "compliance-agent-v1":
      return (
        <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
          <octahedronGeometry args={[0.4, 0]} />
          <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.2} metalness={0.5} clearcoat={0.6} />
        </mesh>
      );
    case "evaluator-v1":
      return (
        <>
          <mesh castShadow>
            <torusGeometry args={[0.3, 0.065, 16, 32]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.2} metalness={0.6} />
          </mesh>
          <mesh position={[0.36, -0.36, 0]} rotation={[0, 0, Math.PI / 4]}>
            <cylinderGeometry args={[0.035, 0.035, 0.42, 8]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
          </mesh>
        </>
      );
    default:
      return (
        <>
          <mesh position={[0, 0.16, 0]} castShadow>
            <capsuleGeometry args={[0.22, 0.34, 4, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.58, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.4} />
          </mesh>
        </>
      );
  }
}

function AgentBooth({ role, pulseAt }: { role: Role; pulseAt: number }) {
  const pos = POSITIONS[role];
  const color = COLORS[role];
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const iconGroupRef = useRef<THREE.Group>(null);
  const phase = useMemo(() => hashPhase(role), [role]);

  useFrame((state) => {
    const age = pulseAt > 0 ? (performance.now() - pulseAt) / 700 : 2;
    const flash = Math.max(0, 1 - age);
    if (ringMatRef.current) ringMatRef.current.emissiveIntensity = 0.7 + flash * 3;
    if (iconGroupRef.current) {
      const t = state.clock.elapsedTime;
      iconGroupRef.current.position.y = 0.55 + Math.sin(t * 0.9 + phase) * 0.07 + flash * 0.18;
      iconGroupRef.current.rotation.y = t * 0.22 + phase;
    }
  });

  return (
    <group position={pos}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.98, 40]} />
        <meshStandardMaterial ref={ringMatRef} color={color} emissive={color} emissiveIntensity={0.7} transparent opacity={0.9} />
      </mesh>
      <group ref={iconGroupRef} position={[0, 0.55, 0]}>
        <RoleIcon role={role} color={color} />
      </group>
      <Html position={[0, 1.55, 0]} center distanceFactor={9} occlude={false}>
        <div
          className="whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm"
          style={{ borderColor: `${color}66`, background: "rgba(0,0,0,0.7)" }}
        >
          {LABELS[role]}
        </div>
      </Html>
    </group>
  );
}

function NetworkLines() {
  const hub = POSITIONS.orchestrator;
  const spokes = (Object.keys(POSITIONS) as Role[]).filter((r) => r !== "orchestrator");
  return (
    <>
      {spokes.map((role) => (
        <Line key={role} points={[hub, POSITIONS[role]]} color={COLORS[role]} lineWidth={1} transparent opacity={0.18} />
      ))}
    </>
  );
}

function PacketDot({ packet, onDone }: { packet: Packet; onDone: (id: string, pos: [number, number, number]) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const from = useRef(new THREE.Vector3(...packet.from));
  const to = useRef(new THREE.Vector3(...packet.to));
  const done = useRef(false);

  useFrame(() => {
    const t = (performance.now() - packet.start) / packet.duration;
    if (t < 0) return; // staggered start, not yet begun
    if (t >= 1) {
      if (!done.current) {
        done.current = true;
        onDone(packet.id, packet.to);
      }
      return;
    }
    const p = new THREE.Vector3().lerpVectors(from.current, to.current, t);
    p.y += Math.sin(t * Math.PI) * 1.15 + 0.5;
    if (ref.current) ref.current.position.copy(p);
    if (lightRef.current) lightRef.current.position.copy(p);
  });

  return (
    <group>
      <mesh ref={ref} position={packet.from}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshStandardMaterial color={packet.color} emissive={packet.color} emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} color={packet.color} intensity={8} distance={3.5} decay={2} />
    </group>
  );
}

function ImpactRing({ impact, onDone }: { impact: Impact; onDone: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const done = useRef(false);

  useFrame(() => {
    const t = (performance.now() - impact.start) / 550;
    if (t >= 1) {
      if (!done.current) {
        done.current = true;
        onDone(impact.id);
      }
      return;
    }
    if (ref.current) ref.current.scale.setScalar(0.3 + t * 1.6);
    if (matRef.current) matRef.current.opacity = 0.8 * (1 - t);
  });

  return (
    <mesh ref={ref} position={[impact.pos[0], 0.05, impact.pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.6, 0.75, 32]} />
      <meshBasicMaterial ref={matRef} color={impact.color} transparent opacity={0.8} />
    </mesh>
  );
}

function Scene({ logs }: { logs: JobLogEntry[] }) {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const seenCount = useRef(0);

  useEffect(() => {
    if (logs.length < seenCount.current) {
      // A new job started (log was reset) -- replay from the top instead
      // of treating the shorter array as "nothing new".
      seenCount.current = 0;
    }
    if (logs.length <= seenCount.current) return;

    const newEntries = logs.slice(seenCount.current);
    seenCount.current = logs.length;
    const now = performance.now();

    const spawned: Packet[] = [];
    newEntries.forEach((entry, i) => {
      if (!isRole(entry.from) || !isRole(entry.to) || entry.from === entry.to) return;
      const delay = i * 260;
      spawned.push({
        id: `${entry.ts}-${entry.from}-${entry.to}-${i}`,
        from: POSITIONS[entry.from],
        to: POSITIONS[entry.to],
        color: KIND_COLORS[entry.kind || "system"],
        start: now + delay,
        duration: 1100,
      });
      const toRole = entry.to;
      window.setTimeout(() => {
        setPulses((prev) => ({ ...prev, [toRole]: performance.now() }));
      }, delay + 1100);
    });

    if (spawned.length) {
      setPackets((prev) => [...prev, ...spawned]);
    }
  }, [logs]);

  const removePacket = (id: string, pos: [number, number, number]) => {
    setPackets((prev) => prev.filter((p) => p.id !== id));
    setImpacts((prev) => [...prev, { id: `${id}-impact`, pos, color: "#ffffff", start: performance.now() }]);
  };
  const removeImpact = (id: string) => setImpacts((prev) => prev.filter((i) => i.id !== id));

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 9, 4]} intensity={1.2} castShadow />
      <Environment preset="night" environmentIntensity={0.4} />
      <Sparkles count={90} scale={[22, 6, 22]} size={2.2} speed={0.25} color="#5eead4" opacity={0.35} />
      <Grid
        args={[60, 60]}
        cellSize={1}
        cellColor="#134e4a"
        sectionSize={5}
        sectionColor="#5eead4"
        fadeDistance={24}
        fadeStrength={1.4}
        infiniteGrid
        position={[0, -0.01, 0]}
      />
      <NetworkLines />
      {(Object.keys(POSITIONS) as Role[]).map((role) => (
        <AgentBooth key={role} role={role} pulseAt={pulses[role] || 0} />
      ))}
      {packets.map((p) => (
        <PacketDot key={p.id} packet={p} onDone={removePacket} />
      ))}
      {impacts.map((i) => (
        <ImpactRing key={i.id} impact={i} onDone={removeImpact} />
      ))}
      <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.35} minDistance={8} maxDistance={22} minPolarAngle={0.35} maxPolarAngle={1.2} target={[0, 0.6, 0]} />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.15} intensity={0.7} radius={0.55} />
      </EffectComposer>
    </>
  );
}

type Props = {
  logs: JobLogEntry[];
};

/**
 * Real-time 3D visualization of the actual agent network -- every booth is
 * one real role (requester, orchestrator, escrow contract, the 3
 * specialists, the evaluator), each with its own distinct silhouette (not
 * just a color swap), gently bobbing/rotating so the scene never looks
 * static. Every traveling packet corresponds to a real event from the
 * orchestrator's own job log (a real call, a real x402 nanopayment, a real
 * settlement release, ...), driven by the same from/to/kind metadata
 * ActivityLog renders as text -- nothing here is a canned animation, it
 * only moves in response to logs actually changing.
 */
export function AgentScene3D({ logs }: Props) {
  return (
    <div className="h-full min-h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black/50">
      <Canvas dpr={[1, 1.5]} shadows gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[9.5, 8.5, 12.5]} fov={40} />
        <color attach="background" args={["#050507"]} />
        <fog attach="fog" args={["#050507", 15, 30]} />
        <Scene logs={logs} />
      </Canvas>
    </div>
  );
}
