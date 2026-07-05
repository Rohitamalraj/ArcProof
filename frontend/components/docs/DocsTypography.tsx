import type { ReactNode } from "react";
import Link from "next/link";

export function DocsH1({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-4xl tracking-tight text-white">{children}</h1>;
}

export function DocsLead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-lg text-zinc-400">{children}</p>;
}

export function DocsH2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-10 mb-3 font-display text-2xl tracking-tight text-white">
      {children}
    </h2>
  );
}

export function DocsH3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-lg font-semibold text-zinc-100">{children}</h3>;
}

export function DocsP({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed text-zinc-300">{children}</p>;
}

export function DocsUl({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-zinc-300 marker:text-[#5eead4]">{children}</ul>;
}

export function DocsOl({ children }: { children: ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed text-zinc-300 marker:text-[#5eead4]">{children}</ol>;
}

export function DocsInlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-[#5eead4]">{children}</code>;
}

export function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="text-[#5eead4] underline decoration-dotted underline-offset-2 hover:no-underline"
    >
      {children}
    </Link>
  );
}

export function DocsPre({ children, title }: { children: string; title?: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/50">
      {title ? (
        <div className="border-b border-white/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">{title}</div>
      ) : null}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-200">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function DocsCallout({ kind = "info", children }: { kind?: "info" | "warn"; children: ReactNode }) {
  const styles =
    kind === "warn"
      ? "border-amber-800/50 bg-amber-950/25 text-amber-200"
      : "border-[#5eead4]/30 bg-[#5eead4]/10 text-[#5eead4]";
  return <div className={`mt-4 rounded-xl border p-4 text-sm ${styles}`}>{children}</div>;
}

export function DocsTable({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
