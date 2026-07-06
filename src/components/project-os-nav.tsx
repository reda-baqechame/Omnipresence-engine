"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Blueprint OS categories — practitioner-familiar groupings (Ahrefs/Semrush/GSC mental model). */
const OS_CATEGORIES = [
  {
    label: "Command",
    items: [
      { href: "", label: "Domain Overview" },
      { href: "/trust", label: "Data Trust" },
      { href: "/competitors", label: "Competitor Compare" },
    ],
  },
  {
    label: "Search Intelligence",
    items: [
      { href: "/keywords", label: "Keywords" },
      { href: "/ranks", label: "Rankings" },
      { href: "/search-performance", label: "Search Performance" },
      { href: "/gsc", label: "Search Console" },
    ],
  },
  {
    label: "Technical SEO",
    items: [
      { href: "/technical", label: "Technical Audit" },
      { href: "/indexation", label: "Indexation" },
      { href: "/crawlers", label: "Crawler Logs" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/content-site", label: "Content & Site" },
      { href: "/topical", label: "Topical Map" },
      { href: "/pseo", label: "Programmatic SEO" },
    ],
  },
  {
    label: "Authority",
    items: [
      { href: "/authority-presence", label: "Authority & Presence" },
      { href: "/backlinks", label: "Backlinks" },
      { href: "/authority", label: "Outreach CRM" },
    ],
  },
  {
    label: "Local",
    items: [{ href: "/local", label: "Local SEO" }],
  },
  {
    label: "AEO / GEO",
    items: [
      { href: "/ai-visibility", label: "AI Visibility" },
      { href: "/aeo-readiness", label: "AEO Readiness" },
      { href: "/prompts", label: "Prompt Campaigns" },
      { href: "/source-graph", label: "Source Graph" },
      { href: "/panels", label: "Prompt Panels" },
    ],
  },
  {
    label: "Analytics & Attribution",
    items: [
      { href: "/attribution", label: "Attribution" },
      { href: "/roi", label: "ROI Command" },
      { href: "/traffic", label: "Traffic Panel" },
    ],
  },
  {
    label: "Execution & Ops",
    items: [
      { href: "/action-proof", label: "Action Plan & Proof" },
      { href: "/tasks", label: "Tasks" },
      { href: "/proof-ledger", label: "Proof Ledger" },
      { href: "/roadmap", label: "Roadmap" },
    ],
  },
];

export function ProjectOsNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;

  return (
    <aside className="hidden xl:block w-56 shrink-0 border-r border-border pr-4 mr-6">
      <nav className="space-y-5 sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto text-sm">
        {OS_CATEGORIES.map((cat) => (
          <div key={cat.label}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">
              {cat.label}
            </div>
            <ul className="space-y-0.5">
              {cat.items.map((item) => {
                const href = `${base}${item.href}`;
                const isActive =
                  item.href === ""
                    ? pathname === base
                    : pathname.startsWith(href);
                return (
                  <li key={item.href}>
                    <Link
                      href={href}
                      className={cn(
                        "block px-2 py-1.5 rounded-md transition",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
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
    </aside>
  );
}
