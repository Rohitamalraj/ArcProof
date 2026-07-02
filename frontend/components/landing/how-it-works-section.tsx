"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    number: "01",
    title: "Submit",
    subtitle: "a job + budget",
    description:
      "Requester submits a research request and locks a budget in escrow. The orchestrator decomposes it into fixed subtasks and calls specialist agents via x402.",
    code: `POST /jobs
{
  "template": "protocol_treasury_diligence",
  "request_text": "Assess Protocol X before treasury deployment",
  "budget_usdc": 25.00
}
// escrow locked → orchestrator.decompose(job)`,
  },
  {
    number: "02",
    title: "Verify",
    subtitle: "every claim",
    description:
      "The evaluator parses each specialist's structured claims and re-derives every fact from an independent live source — never the provider's own.",
    code: `for (claim of memo.claims) {
  const truth = await fetch(sourceFor(claim.claim_type))
  claim.verification_status =
    withinTolerance(claim.claim_value, truth) ? "match" : "mismatch"
}`,
  },
  {
    number: "03",
    title: "Settle",
    subtitle: "on Arc",
    description:
      "Payment releases per specialist, based on that specialist's own accuracy — not the job's overall verdict. Reputation updates the same instant.",
    code: `if (specialist.allClaimsMatch) release(specialist.wallet, fullFee)
else if (specialist.hasHighStakesMismatch) withhold(specialist.wallet)
else releasePartial(specialist.wallet, accuracyRatio)`,
  },
];

export function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
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
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative py-24 lg:py-32 bg-[oklch(0.09_0.01_260)] text-white overflow-hidden"
    >
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-white/[0.02] blur-[100px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-[#5eead4]/[0.03] blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="relative mb-0 lg:mb-0 grid lg:grid-cols-2 gap-4 lg:gap-12 items-end">
          {/* Title column left */}
          <div className="overflow-hidden pb-0 lg:pb-32">
            <div
              className={`transition-all duration-1000 ${
                isVisible ? "translate-x-0 opacity-100" : "-translate-x-12 opacity-0"
              }`}
            >
              <span className="inline-flex items-center gap-3 text-sm font-mono text-white/40 mb-8">
                <span className="w-12 h-px bg-white/20" />
                Process
              </span>
            </div>

            <h2
              className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.85] transition-all duration-1000 delay-100 ${
                isVisible ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
              }`}
            >
              <span className="block">Submit.</span>
              <span className="block text-white/30">Verify.</span>
              <span className="block text-white/10">Settle.</span>
            </h2>
          </div>

          {/* Right: tree image */}
          <div
            className={`relative h-[320px] lg:h-[640px] overflow-hidden transition-all duration-1000 delay-200 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/tree-uAia6REvB137CQyHFCf0za3O6h2zKO.png"
              alt=""
              className="absolute bottom-0 right-0 h-full w-auto object-cover object-bottom"
            />
            {/* Fade left edge */}
            <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.09_0.01_260)] via-transparent to-transparent pointer-events-none" />
          </div>
        </div>

        <div className="h-16 lg:h-20" />

        {/* Horizontal Steps Layout */}
        <div className="grid lg:grid-cols-3 gap-4">
          {steps.map((step, index) => (
            <button
              key={step.number}
              type="button"
              onClick={() => setActiveStep(index)}
              className={`relative text-left p-8 lg:p-12 border transition-all duration-500 ${
                activeStep === index
                  ? "bg-[#000000] border-white/60"
                  : "bg-[#000000] border-white/25 hover:border-white/50"
              }`}
            >
              {/* Step number with animated line */}
              <div className="flex items-center gap-4 mb-8">
                <span
                  className={`text-4xl font-display transition-colors duration-300 ${
                    activeStep === index ? "text-[#5eead4]" : "text-white/20"
                  }`}
                >
                  {step.number}
                </span>
                <div className="flex-1 h-px bg-white/10 overflow-hidden">
                  {activeStep === index && (
                    <div className="h-full bg-[#5eead4]/50 animate-progress" />
                  )}
                </div>
              </div>

              {/* Title */}
              <h3 className="text-3xl lg:text-4xl font-display mb-2">{step.title}</h3>
              <span className="text-xl text-white/40 font-display block mb-6">
                {step.subtitle}
              </span>

              {/* Description */}
              <p
                className={`text-white/60 leading-relaxed text-sm mb-6 transition-opacity duration-300 ${
                  activeStep === index ? "opacity-100" : "opacity-60"
                }`}
              >
                {step.description}
              </p>

              {/* Code snippet */}
              {activeStep === index && (
                <pre className="bg-white/5 border border-white/10 p-4 text-[11px] font-mono text-white/60 overflow-x-auto leading-relaxed">
                  <code>{step.code}</code>
                </pre>
              )}

              {/* Active indicator */}
              <div
                className={`absolute bottom-0 left-0 right-0 h-1 bg-[#5eead4] transition-transform duration-500 origin-left ${
                  activeStep === index ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes progress {
          from { width: 0%; }
          to { width: 100%; }
        }
        .animate-progress {
          animation: progress 6s linear forwards;
        }
      `}</style>
    </section>
  );
}
