import { AppSidebar } from "@/components/app-sidebar";
import { RunningJobsStrip } from "@/components/running-jobs-strip";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let showLeads = false;
  if (user) {
    const { data: adminMembership } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    showLeads = Boolean(adminMembership);
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar showLeads={showLeads} />
      <main className="flex-1 overflow-auto">
        <RunningJobsStrip />
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
