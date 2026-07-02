"use client";

import { useEffect, useState, useRef } from "react";

const integrations = [
  { name: "DefiLlama",     category: "TVL"          },
  { name: "CoinGecko",     category: "Price"        },
  { name: "Block explorer",category: "Wallet flows" },
  { name: "Sanctions DB",  category: "Compliance"    },
  { name: "Governance forum", category: "Proposals" },
  { name: "News sources",  category: "Incidents"     },
  { name: "Circle Wallets",category: "Identity"      },
  { name: "x402",          category: "Metering"      },
  { name: "Gateway",       category: "Nanopayments"  },
  { name: "Arc",           category: "Settlement"    },
  { name: "App Kit",       category: "Balances"      },
  { name: "Contracts",     category: "Escrow"        },
];

export function ProtocolsSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
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

  return (
    <section id="sources" ref={sectionRef} className="relative overflow-hidden">
      {/* Header — centred */}
      <div className="relative z-10 pt-32 lg:pt-40 text-center">
        <span
          className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 transition-all duration-700 justify-center ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="w-12 h-px bg-foreground/20" />
          Sources & rails
          <span className="w-12 h-px bg-foreground/20" />
        </span>

        <h2
          className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Independent
          <br />
          <span className="text-muted-foreground">by construction.</span>
        </h2>

        <p
          className={`mt-8 text-xl text-muted-foreground leading-relaxed max-w-lg mx-auto transition-all duration-1000 delay-100 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          Every claim is re-derived from a source the provider agent never touched.
          Every payment moves over Circle and Arc's native rails.
        </p>
      </div>

      {/* Dark gradient band */}
      <div
        className={`relative w-full h-[200px] -mt-16 bg-gradient-to-b from-background via-foreground/[0.02] to-background transition-all duration-1000 delay-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Integration grid */}
      <div className="relative z-10 mt-0 lg:-mt-24 max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-16">
          {integrations.map((integration, index) => (
            <div
              key={integration.name}
              className={`group relative overflow-hidden p-6 lg:p-8 border transition-all duration-500 cursor-default ${
                hoveredIndex === index
                  ? "border-foreground bg-foreground/[0.04] scale-[1.02]"
                  : "border-foreground/10 hover:border-foreground/30"
              } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
              style={{
                transitionDelay: `${index * 30 + 300}ms`,
              }}
              onMouseEnter={(e) => {
                setHoveredIndex(index);
                const rect = e.currentTarget.getBoundingClientRect();
                setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseLeave={() => {
                setHoveredIndex(null);
                setMousePos(null);
              }}
            >
              {/* Cursor-following halo */}
              {hoveredIndex === index && mousePos && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0"
                  style={{
                    background: `radial-gradient(200px circle at ${mousePos.x}px ${mousePos.y}px, rgba(94,234,212,0.12) 0%, transparent 70%)`,
                  }}
                />
              )}

              {/* Category tag */}
              <span
                className={`absolute top-3 right-3 text-[10px] font-mono px-2 py-0.5 transition-colors ${
                  hoveredIndex === index
                    ? "bg-foreground text-background"
                    : "bg-foreground/10 text-muted-foreground"
                }`}
              >
                {integration.category}
              </span>

              {/* Text-only icon (first letter) */}
              <div
                className={`w-10 h-10 mb-6 flex items-center justify-center border transition-colors text-lg font-display font-bold ${
                  hoveredIndex === index
                    ? "border-foreground/30 text-foreground"
                    : "border-foreground/10 text-foreground/40"
                }`}
              >
                {integration.name.charAt(0)}
              </div>

              <span className="font-medium block relative z-10">{integration.name}</span>

              {/* Animated underline */}
              <div className="absolute bottom-0 left-0 right-0 h-px bg-foreground/20 overflow-hidden">
                <div
                  className={`h-full bg-foreground transition-all duration-500 ${
                    hoveredIndex === index ? "w-full" : "w-0"
                  }`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stats row */}
        <div
          className={`flex flex-wrap items-center justify-between gap-8 pt-12 border-t border-foreground/10 transition-all duration-1000 delay-500 pb-32 lg:pb-40 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex flex-wrap gap-12">
            {[
              { value: "7",           label: "claim types"        },
              { value: "12+",         label: "sources & rails"    },
              { value: "Testnet",     label: "USDC only"          },
            ].map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-3">
                <span className="text-3xl font-display">{stat.value}</span>
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
            ))}
          </div>

          <a
            href="#network"
            className="group inline-flex items-center gap-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            View the network
            <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
          </a>
        </div>
      </div>
    </section>
  );
}
