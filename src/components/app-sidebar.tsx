import Link from "next/link";
import {
  Globe,
  LayoutDashboard,
  FolderKanban,
  FileText,
  Settings,
  LogOut,
  Users,
  Workflow,
  Search,
  Shield,
  BarChart3,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/projects", label: "Projects", icon: FolderKanban },
    ],
  },
  {
    label: "Intelligence & Ops",
    items: [
      { href: "/app/reports", label: "Reports", icon: FileText },
      { href: "/app/ops", label: "Ops Console", icon: Workflow },
      { href: "/app/leads", label: "Leads", icon: Users, adminOnly: true },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/app/settings/capabilities", label: "Capabilities", icon: Search },
      { href: "/app/settings/usage", label: "Usage", icon: BarChart3 },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppSidebar({ showLeads = false }: { showLeads?: boolean }) {
  return (
    <aside className="w-64 border-r border-border bg-card min-h-screen p-4 flex flex-col">
      <Link href="/app" className="flex items-center gap-2 px-2 py-4 mb-4">
        <Globe className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">PresenceOS</span>
      </Link>

      <nav className="flex-1 space-y-5">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || showLeads);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2 border-t border-border pt-4 mt-4">
        <Shield className="h-3.5 w-3.5" />
        Proof-led agency OS
      </div>

      <form action="/api/auth/signout" method="POST" className="mt-2">
        <button className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition w-full">
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </form>
    </aside>
  );
}
