"use client";

import { useEffect, useState, useRef } from "react";
import { ShieldCheck, Gauge, SplitSquareVertical, ScrollText } from "lucide-react";

const verificationFeatures = [
  {
    icon: Gauge,
    title: "Documented tolerance",
    description:
      "Numeric claims (TVL, price, concentration) match within a published tolerance band — e.g. ±5% — never tuned to flatter a demo.",
    image: "/images/isolated.jpg",
  },
  {
    icon: ShieldCheck,
    title: "Rule-based verdicts",
    description:
      "The LLM only extracts claims into schema. Accept, partial, or reject is decided by deterministic rules — auditable, not vibes-based.",
    image: "/images/encrypted.jpg",
  },
  {
    icon: SplitSquareVertical,
    title: "Per-specialist payment",
    description:
      "Payment is computed from each specialist's own claim accuracy. One agent gets paid in full while another, in the same job, does not.",
    image: "/images/permissions.jpg",
  },
  {
    icon: ScrollText,
    title: "Onchain-auditable trail",
    description:
      "Every verdict stores the exact independent-source query and response behind it, so a requester or judge can check our work.",
    image: "/images/audit.jpg",
  },
];

const mockClaims: { type: string; status: "match" | "mismatch" | "unverifiable" }[] = [
  { type: "tvl",                status: "match"        },
  { type: "wallet_flow",        status: "match"        },
  { type: "token_concentration",status: "match"        },
  { type: "news_incident",      status: "unverifiable" },
  { type: "compliance_flag",    status: "mismatch"      },
];

const statusColor: Record<string, string> = {
  match: "text-[#5eead4] border-[#5eead4]/30 bg-[#5eead4]/10",
  mismatch: "text-red-400 border-red-400/30 bg-red-400/10",
  unverifiable: "text-white/40 border-white/15 bg-white/5",
};

const certifications = ["x402", "Rule-based", "ERC-8004-ready", "Auditable"];

export function SecuritySection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
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
      setActiveFeature((prev) => (prev + 1) % verificationFeatures.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="verification" ref={sectionRef} className="relative py-32 lg:py-40 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="mb-20">
          <span
            className={`inline-flex items-center gap-4 text-sm font-mono text-muted-foreground mb-8 transition-all duration-700 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="w-12 h-px bg-foreground/20" />
            Verification
          </span>

          <h2
            className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] mb-12 transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            Autonomous,
            <br />
            <span className="text-muted-foreground">not credulous.</span>
          </h2>

          <div
            className={`transition-all duration-1000 delay-100 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Every claim gets re-derived from an independent source before payment
              moves. Nothing is paid on a specialist&apos;s word alone.
            </p>
          </div>
        </div>

        {/* Main content */}
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Large visual card — mock claim ledger */}
          <div
            className={`lg:col-span-7 relative p-8 lg:p-12 border border-foreground/10 min-h-[400px] overflow-hidden bg-black transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {/* Cross-fading verification images */}
            {verificationFeatures.map((feature, index) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={feature.image}
                src={feature.image}
                alt=""
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                style={{ opacity: activeFeature === index ? 1 : 0 }}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />

            <div className="relative z-10">
              <span className="font-mono text-sm text-white/50">Evaluator output — sample job</span>

              <div className="mt-8 flex flex-col gap-2">
                {mockClaims.map((claim, index) => (
                  <div
                    key={claim.type}
                    className={`flex items-center justify-between px-4 py-3 border font-mono text-sm transition-all duration-500 ${statusColor[claim.status]}`}
                    style={{ transitionDelay: `${index * 60}ms` }}
                  >
                    <span>{claim.type}</span>
                    <span className="uppercase tracking-wider text-xs">{claim.status}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <span className="text-5xl lg:text-6xl font-display text-white">1/5</span>
                <span className="block text-white/50 mt-2">
                  mismatches on this job — that specialist&apos;s payment is withheld, the rest are paid in full
                </span>
              </div>
            </div>

            {/* Certification badges */}
            <div className="absolute bottom-8 left-8 right-8 flex flex-wrap gap-2">
              {certifications.map((cert, index) => (
                <span
                  key={cert}
                  className={`px-3 py-1 border border-white/10 text-xs font-mono text-white/50 transition-all duration-500 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: `${index * 100 + 300}ms` }}
                >
                  {cert}
                </span>
              ))}
            </div>
          </div>

          {/* Feature cards stack */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {verificationFeatures.map((feature, index) => (
              <div
                key={feature.title}
                className={`p-6 border transition-all duration-500 cursor-default ${
                  activeFeature === index
                    ? "border-foreground/30 bg-foreground/[0.04]"
                    : "border-foreground/10"
                } ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}`}
                style={{ transitionDelay: `${index * 80}ms` }}
                onClick={() => setActiveFeature(index)}
                onMouseEnter={() => setActiveFeature(index)}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`shrink-0 w-10 h-10 flex items-center justify-center border transition-colors ${
                      activeFeature === index
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/20"
                    }`}
                  >
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
