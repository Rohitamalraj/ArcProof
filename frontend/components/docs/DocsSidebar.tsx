"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; href: string };
type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Introduction",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Core Concepts", href: "/docs/core-concepts" },
    ],
  },
  {
    title: "Packages",
    items: [
      { label: "@arcproof/sdk", href: "/docs/sdk" },
      { label: "@arcproof/sdk-langchain", href: "/docs/sdk-langchain" },
      { label: "@arcproof/sdk-elizaos", href: "/docs/sdk-elizaos" },
    ],
  },
  {
    title: "Guides",
    items: [{ label: "Circle Wallets Setup", href: "/docs/circle-wallets" }],
  },
  {
    title: "Examples",
    items: [{ label: "Worked Examples", href: "/docs/examples" }],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-full shrink-0 space-y-6 lg:w-56">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">{group.title}</p>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      active ? "bg-[#5eead4]/10 text-[#5eead4]" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
