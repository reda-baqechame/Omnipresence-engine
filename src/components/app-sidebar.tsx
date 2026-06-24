import Link from "next/link";
import { Globe, LayoutDashboard, FolderKanban, FileText, Settings, LogOut, Users, Workflow } from "lucide-react";

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/projects", label: "Projects", icon: FolderKanban },
  { href: "/app/ops", label: "Ops Console", icon: Workflow },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/leads", label: "Leads", icon: Users },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  return (
    <aside className="w-64 border-r border-border bg-card min-h-screen p-4 flex flex-col">
      <Link href="/app" className="flex items-center gap-2 px-2 py-4 mb-4">
        <Globe className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">PresenceOS</span>
      </Link>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      <form action="/api/auth/signout" method="POST">
        <button className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition w-full">
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </form>
    </aside>
  );
}
