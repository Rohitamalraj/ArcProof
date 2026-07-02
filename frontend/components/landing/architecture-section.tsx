"use client";

import { useEffect, useState, useRef } from "react";

const rails = [
  { name: "Circle Wallets", status: "operational" },
  { name: "x402 protocol",  status: "operational" },
  { name: "Gateway nanopayments", status: "operational" },
  { name: "Arc testnet",    status: "operational" },
];

export function ArchitectureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeRail, setActiveRail] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveRail((prev) => (prev + 1) % rails.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="settlement" ref={sectionRef} className="relative py-32 lg:py-40 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="mb-20">
          <span
            className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 transition-all duration-700 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="w-12 h-px bg-foreground/20" />
            Settlement
          </span>

          <div className="grid lg:grid-cols-[auto_1fr] gap-8 lg:gap-16 items-stretch">
            {/* Globe image — left column */}
            <div
              className={`w-48 lg:w-72 xl:w-80 shrink-0 transition-all duration-1000 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/world-3i68QNWJwmO7W19ztZWbevAwJQHzYL.png"
                alt=""
                className="w-full h-auto object-contain"
              />
            </div>

            {/* Title + description */}
            <div className="flex flex-col justify-center">
              <h2
                className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
                  isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
              >
                Bonded, not
                <br />
                <span className="text-muted-foreground">just billed.</span>
              </h2>

              <p
                className={`mt-8 text-xl text-muted-foreground leading-relaxed max-w-lg transition-all duration-1000 delay-100 ${
                  isVisible ? "opacity-100" : "opacity-0"
                }`}
              >
                Every actor holds a Circle Wallet. Specialists get a small nanopayment for
                responding — the larger conditional fee only clears on Arc once the
                evaluator signs off.
              </p>
            </div>
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Large stat card */}
          <div
            className={`lg:col-span-2 relative p-8 lg:p-12 border border-foreground/10 bg-foreground/[0.02] overflow-hidden transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {/* Animated dots background */}
            <div className="absolute inset-0 opacity-70">
              <svg
                className="absolute inset-0 w-full h-full"
                style={{ pointerEvents: "none" }}
              >
                <defs>
                  <style>{`
                    @keyframes drawLine {
                      0%   { stroke-dashoffset: 1000; opacity: 0; }
                      15%  { opacity: 1; }
                      70%  { opacity: 0.7; }
                      100% { stroke-dashoffset: 0; opacity: 0; }
                    }
                    .connecting-line {
                      stroke: #5eead4;
                      stroke-width: 1.2;
                      fill: none;
                      stroke-dasharray: 1000;
                      animation: drawLine 3s ease-in-out infinite;
                    }
                  `}</style>
                </defs>
                {[...Array(19)].map((_, i) => {
                  const x1 = 10 + (i % 5) * 20;
                  const y1 = 10 + Math.floor(i / 5) * 25;
                  const x2 = 10 + ((i + 1) % 5) * 20;
                  const y2 = 10 + Math.floor((i + 1) / 5) * 25;
                  return (
                    <line
                      key={`line-${i}`}
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                      className="connecting-line"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  );
                })}
              </svg>

              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full bg-[#5eead4]"
                  style={{
                    left: `${10 + (i % 5) * 20}%`,
                    top: `${10 + Math.floor(i / 5) * 25}%`,
                    animation: `pulse 2s ease-in-out ${i * 0.1}s infinite`,
                  }}
                />
              ))}
            </div>

            <div className="relative z-10">
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-8xl lg:text-[10rem] font-display leading-none">2</span>
                <span className="text-2xl text-muted-foreground">tier payment</span>
              </div>
              <p className="text-muted-foreground max-w-md">
                A fixed nanopayment for responding, plus a conditional fee gated by the
                evaluator&apos;s verdict — paid per specialist, not per job.
              </p>
            </div>
          </div>

          {/* Stacked stat cards */}
          <div className="flex flex-col gap-6">
            <div
              className={`p-8 border border-foreground/10 bg-foreground/[0.02] transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              <span className="text-5xl lg:text-6xl font-display">$0.000001</span>
              <span className="block text-sm text-muted-foreground mt-2">Smallest payment, via Gateway</span>
            </div>

            <div
              className={`p-8 border border-foreground/10 bg-foreground/[0.02] transition-all duration-700 delay-200 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              <span className="text-5xl lg:text-6xl font-display">&lt;500ms</span>
              <span className="block text-sm text-muted-foreground mt-2">Arc settlement finality</span>
            </div>
          </div>
        </div>

        {/* Rail list */}
        <div
          className={`mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4 transition-all duration-1000 delay-300 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {rails.map((rail, index) => (
            <div
              key={rail.name}
              className={`p-6 border transition-all duration-300 cursor-default ${
                activeRail === index
                  ? "border-foreground/30 bg-foreground/[0.04]"
                  : "border-foreground/10"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`w-2 h-2 rounded-full transition-colors ${
                    activeRail === index ? "bg-[#5eead4]" : "bg-foreground/20"
                  }`}
                />
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {rail.status}
                </span>
              </div>
              <span className="font-medium block">{rail.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
