import type { ReactNode } from "react";

import { AppBackground } from "@/components/AppBackground";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen px-6 pb-16 pt-28 text-zinc-100">
      <AppBackground />
      <div className="relative z-10 mx-auto flex max-w-6xl gap-10">
        <DocsSidebar />
        <div className="min-w-0 flex-1 pb-20">{children}</div>
      </div>
    </main>
  );
}
