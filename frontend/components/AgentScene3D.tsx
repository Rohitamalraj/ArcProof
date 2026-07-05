"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html, OrbitControls, PerspectiveCamera } from "@react-three/drei";
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

interface Packet {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  start: number;
  duration: number;
}

function AgentBooth({ role, pulseAt }: { role: Role; pulseAt: number }) {
  const pos = POSITIONS[role];
  const color = COLORS[role];
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    const age = pulseAt > 0 ? (performance.now() - pulseAt) / 700 : 2;
    const flash = Math.max(0, 1 - age);
    if (ringMatRef.current) ringMatRef.current.emissiveIntensity = 0.7 + flash * 3;
    if (bodyMatRef.current) bodyMatRef.current.emissiveIntensity = 0.25 + flash * 1.2;
  });

  return (
    <group position={pos}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.98, 40]} />
        <meshStandardMaterial ref={ringMatRef} color={color} emissive={color} emissiveIntensity={0.7} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <boxGeometry args={[0.55, 0.72, 0.55]} />
        <meshStandardMaterial ref={bodyMatRef} color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.88, 0]} castShadow>
        <coneGeometry args={[0.22, 0.36, 4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      <Html position={[0, 1.5, 0]} center distanceFactor={9} occlude={false}>
        <div className="whitespace-nowrap rounded-full border border-white/15 bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
          {LABELS[role]}
        </div>
      </Html>
    </group>
  );
}

function PacketDot({ packet, onDone }: { packet: Packet; onDone: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const from = useRef(new THREE.Vector3(...packet.from));
  const to = useRef(new THREE.Vector3(...packet.to));
  const done = useRef(false);

  useFrame(() => {
    const t = (performance.now() - packet.start) / packet.duration;
    if (t < 0) return; // staggered start, not yet begun
    if (t >= 1) {
      if (!done.current) {
        done.current = true;
        onDone(packet.id);
      }
      return;
    }
    if (ref.current) {
      const p = new THREE.Vector3().lerpVectors(from.current, to.current, t);
      p.y += Math.sin(t * Math.PI) * 1.15;
      ref.current.position.copy(p);
    }
  });

  return (
    <mesh ref={ref} position={packet.from}>
      <sphereGeometry args={[0.14, 12, 12]} />
      <meshStandardMaterial color={packet.color} emissive={packet.color} emissiveIntensity={2} />
    </mesh>
  );
}

function Scene({ logs }: { logs: JobLogEntry[] }) {
  const [packets, setPackets] = useState<Packet[]>([]);
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

  const removePacket = (id: string) => setPackets((prev) => prev.filter((p) => p.id !== id));

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 9, 4]} intensity={1.2} castShadow />
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
      {(Object.keys(POSITIONS) as Role[]).map((role) => (
        <AgentBooth key={role} role={role} pulseAt={pulses[role] || 0} />
      ))}
      {packets.map((p) => (
        <PacketDot key={p.id} packet={p} onDone={removePacket} />
      ))}
      <OrbitControls enablePan={false} minDistance={8} maxDistance={22} minPolarAngle={0.35} maxPolarAngle={1.2} target={[0, 0.6, 0]} />
    </>
  );
}

type Props = {
  logs: JobLogEntry[];
};

/**
 * Real-time 3D visualization of the actual agent network -- every booth is
 * one real role (requester, orchestrator, escrow contract, the 3
 * specialists, the evaluator), and every traveling packet corresponds to a
 * real event from the orchestrator's own job log (a real call, a real
 * x402 nanopayment, a real settlement release, ...), driven by the same
 * from/to/kind metadata ActivityLog renders as text. Nothing here is a
 * canned animation -- it only moves in response to logs actually changing.
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
