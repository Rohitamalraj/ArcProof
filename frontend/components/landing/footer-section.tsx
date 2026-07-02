"use client";

import { ArrowUpRight } from "lucide-react";

const footerLinks = {
  Network: [
    { name: "Orchestrator",         href: "#network" },
    { name: "On-chain data",        href: "#network" },
    { name: "News & fundamentals",  href: "#network" },
    { name: "Evaluator",            href: "#network" },
  ],
  Protocol: [
    { name: "Settlement",    href: "#settlement"   },
    { name: "How it works",  href: "#how-it-works" },
    { name: "Verification",  href: "#verification" },
    { name: "Sources & rails", href: "#sources"     },
  ],
  Build: [
    { name: "GitHub",      href: "https://github.com" },
    { name: "Circle Agent Stack", href: "#" },
    { name: "Arc docs",    href: "#" },
    { name: "x402 protocol", href: "#" },
  ],
  Legal: [
    { name: "Privacy",    href: "#" },
    { name: "Terms",      href: "#" },
    { name: "Hackathon",  href: "#" },
  ],
};

const socialLinks = [
  { name: "X",       href: "#" },
  { name: "GitHub",  href: "https://github.com" },
  { name: "Discord", href: "#" },
];

export function FooterSection() {
  return (
    <footer className="relative bg-black">
      {/* Panoramic banner image */}
      <div className="relative w-full h-[340px] lg:h-[420px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Upscaled%20Image%20%2810%29-UnDKstODkIENp5xqTYUEpt0Sm8tNOw.png"
          alt=""
          className="w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/30 to-black" />
      </div>

      {/* Footer content */}
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display text-white">ArcProof</span>
                <span className="text-xs text-white/40 font-mono">testnet</span>
              </a>

              <p className="text-white/50 leading-relaxed mb-8 max-w-xs text-sm">
                A bonded, multi-agent financial diligence network. Specialists get paid
                only after an evaluator verifies their claims against live data.
              </p>

              {/* Social Links */}
              <div className="flex gap-6">
                {socialLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-sm text-white/40 hover:text-white transition-colors flex items-center gap-1 group"
                  >
                    {link.name}
                    <ArrowUpRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                ))}
              </div>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium text-white mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="text-sm text-white/40 hover:text-white transition-colors inline-flex items-center gap-2"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/30">
            &copy; 2026 ArcProof. Built for the Lepton Agents Hackathon &times; Circle &times; Arc.
          </p>

          <div className="flex items-center gap-4 text-sm text-white/30">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#5eead4]" />
              Evaluator online on testnet
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
