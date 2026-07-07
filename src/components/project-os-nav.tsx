"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { filterProjectHubNav } from "@/lib/navigation/capability-nav";

export function ProjectOsNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/app/projects/${projectId}`;
  const categories = filterProjectHubNav();

  return (
    <aside className="hidden xl:block w-56 shrink-0 border-r border-border pr-4 mr-6">
      <nav className="space-y-5 sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto text-sm">
        {categories.map((cat) => (
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
