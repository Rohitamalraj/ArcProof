import { HeroSection } from "@/components/landing/hero-section";
import { AgentsSection } from "@/components/landing/agents-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { ArchitectureSection } from "@/components/landing/architecture-section";
import { MetricsSection } from "@/components/landing/metrics-section";
import { ProtocolsSection } from "@/components/landing/protocols-section";
import { SecuritySection } from "@/components/landing/security-section";
import { DevelopersSection } from "@/components/landing/developers-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <HeroSection />
      <AgentsSection />
      <HowItWorksSection />
      <ArchitectureSection />
      <MetricsSection />
      <ProtocolsSection />
      <SecuritySection />
      <DevelopersSection />
      <CtaSection />
      <FooterSection />
    </main>
  );
}
