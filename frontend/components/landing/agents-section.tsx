"use client";

import { useEffect, useRef, useState } from "react";

const agents = [
  {
    number: "01",
    title: "ORCHESTRATOR",
    description:
      "Decomposes each request into fixed subtasks, calls specialist agents via x402, allocates budget across them, and assembles their claims into one structured memo.",
    stats: { value: "x402", label: "pay-per-call metering" },
  },
  {
    number: "02",
    title: "ON-CHAIN DATA",
    description:
      "Returns TVL, treasury and whale-wallet flows, and token concentration as structured claims — each one tagged with the source it used.",
    stats: { value: "4", label: "claim types covered" },
  },
  {
    number: "03",
    title: "NEWS & FUNDAMENTALS",
    description:
      "Surfaces recent incidents, governance actions, and partnership or exchange changes — flagged for independent corroboration.",
    stats: { value: "2x", label: "sources required for incidents" },
  },
  {
    number: "04",
    title: "EVALUATOR",
    description:
      "Re-derives every claim from an independent live source and issues a rule-based verdict. Gates payment — nothing is paid on trust alone.",
    stats: { value: "100%", label: "claims independently re-checked" },
  },
];

// Floating dot particles visualization behind the orchestrator card.
function ParticleVisualization() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    };
    canvas.addEventListener("mousemove", handleMouseMove);

    const COUNT = 70;
    const particles = Array.from({ length: COUNT }, (_, i) => {
      const seed = i * 1.618;
      return {
        bx: ((seed * 127.1) % 1),
        by: ((seed * 311.7) % 1),
        phase: seed * Math.PI * 2,
        speed: 0.4 + (seed % 0.4),
        radius: 1.2 + (seed % 2.2),
      };
    });

    let time = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      particles.forEach((p) => {
        const flowX = Math.sin(time * p.speed * 0.4 + p.phase) * 38;
        const flowY = Math.cos(time * p.speed * 0.3 + p.phase * 0.7) * 24;

        const bx = p.bx * w;
        const by = p.by * h;
        const dx = p.bx - mx;
        const dy = p.by - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const influence = Math.max(0, 1 - dist * 2.8);

        const x = bx + flowX + influence * Math.cos(time + p.phase) * 36;
        const y = by + flowY + influence * Math.sin(time + p.phase) * 36;

        const pulse = Math.sin(time * p.speed + p.phase) * 0.5 + 0.5;
        const alpha = 0.08 + pulse * 0.18 + influence * 0.3;

        ctx.beginPath();
        ctx.arc(x, y, p.radius + pulse * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(94, 234, 212, ${alpha})`;
        ctx.fill();
      });

      time += 0.016;
      frameRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-auto"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export function AgentsSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="network"
      ref={sectionRef}
      className="relative py-24 lg:py-32 overflow-hidden"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="relative mb-24 lg:mb-32">
          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
                <span className="w-12 h-px bg-foreground/30" />
                Network
              </span>
              <h2
                className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
              >
                Every claim
                <br />
                <span className="text-muted-foreground">has a checker.</span>
              </h2>
            </div>
            <div className="lg:col-span-5 lg:pb-4">
              <p
                className={`text-xl text-muted-foreground leading-relaxed transition-all duration-1000 delay-200 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
              >
                The orchestrator routes work to specialists over x402. The evaluator
                re-checks every claim they emit against a live, independent source
                before a single dollar moves.
              </p>
            </div>
          </div>
        </div>

        {/* Bento Grid Layout */}
        <div className="grid lg:grid-cols-12 gap-4 lg:gap-6">
          {/* Large feature card (01 — Orchestrator) */}
          <div
            className={`lg:col-span-12 relative bg-black border border-foreground/10 min-h-[420px] overflow-hidden group transition-all duration-700 flex ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
            }`}
            onMouseEnter={() => setActiveFeature(0)}
          >
            <div className="relative flex-1 p-8 lg:p-12 bg-black">
              <ParticleVisualization />
              <div className="relative z-10">
                <span className="font-mono text-sm text-muted-foreground">{agents[0].number}</span>
                <h3 className="text-3xl lg:text-4xl font-display mt-4 mb-6 group-hover:translate-x-2 transition-transform duration-500">
                  {agents[0].title}
                </h3>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-md mb-8">
                  {agents[0].description}
                </p>
                <div>
                  <span className="text-5xl lg:text-6xl font-display">{agents[0].stats.value}</span>
                  <span className="block text-sm text-muted-foreground font-mono mt-2">
                    {agents[0].stats.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: image panel */}
            <div className="hidden lg:block relative w-[42%] shrink-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Upscaled%20Image%20%2812%29-ng3RrNnsPMJ5CrtOjcPTmhHg01W11q.png"
                alt=""
                className="absolute inset-0 w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/10 to-transparent" />
            </div>
          </div>

          {/* 3 small cards */}
          {agents.slice(1).map((agent, index) => (
            <div
              key={agent.number}
              className={`lg:col-span-4 relative bg-black border border-foreground/10 min-h-[320px] overflow-hidden group transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
              }`}
              style={{ transitionDelay: `${(index + 1) * 100}ms` }}
              onMouseEnter={() => setActiveFeature(index + 1)}
            >
              <div className="relative p-8 lg:p-10 z-10">
                <span className="font-mono text-sm text-muted-foreground">{agent.number}</span>
                <h3 className="text-2xl lg:text-3xl font-display mt-4 mb-4 group-hover:translate-x-1 transition-transform duration-500">
                  {agent.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                  {agent.description}
                </p>
                <div>
                  <span className="text-3xl lg:text-4xl font-display">{agent.stats.value}</span>
                  <span className="block text-xs text-muted-foreground font-mono mt-2">
                    {agent.stats.label}
                  </span>
                </div>
              </div>
              <div
                className={`absolute bottom-0 left-0 right-0 h-px bg-foreground/20 transition-all duration-500 ${
                  activeFeature === index + 1 ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
