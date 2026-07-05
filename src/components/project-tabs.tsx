"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/ai-visibility", label: "AI Visibility" },
  { href: "/search-performance", label: "Search Performance" },
  { href: "/content-site", label: "Content & Site" },
  { href: "/authority-presence", label: "Authority & Presence" },
  { href: "/competitors", label: "Competitors" },
  { href: "/action-proof", label: "Action Plan & Proof" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;

  return (
    <nav className="flex flex-wrap gap-1 border-b border-border mb-8">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const isActive =
          tab.href === ""
            ? pathname === base
            : pathname.startsWith(href);

        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
