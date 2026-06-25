"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/visibility", label: "Visibility" },
  { href: "/intelligence", label: "AEO Intel" },
  { href: "/keywords", label: "Keywords" },
  { href: "/technical", label: "Technical" },
  { href: "/entity", label: "Entity" },
  { href: "/content", label: "Content" },
  { href: "/pseo", label: "pSEO" },
  { href: "/ranks", label: "Rankings" },
  { href: "/backlinks", label: "Backlinks" },
  { href: "/trends", label: "Trends" },
  { href: "/internal-links", label: "Internal Links" },
  { href: "/coverage", label: "Coverage" },
  { href: "/distribution", label: "Distribution" },
  { href: "/authority", label: "Authority" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/attribution", label: "Attribution" },
  { href: "/guarantee", label: "Guarantee" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;

  return (
    <nav className="flex gap-1 border-b border-border mb-8 overflow-x-auto">
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
