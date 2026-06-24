import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user!.id);

  const orgIds = memberships?.map((m) => m.organization_id) || [];

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .in("organization_id", orgIds);

  const projectIds = projects?.map((p) => p.id) || [];

  const { data: reports } = await supabase
    .from("reports")
    .select("*, projects(name, domain)")
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Reports</h1>
      {reports && reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((report) => (
            <div key={report.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{report.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {(report.projects as { name: string; domain: string })?.name} · {new Date(report.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/report/${report.share_token}/pdf`}
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  PDF <ExternalLink className="h-3 w-3" />
                </a>
                {report.pdf_url && (
                  <a href={report.pdf_url} target="_blank" rel="noopener" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
                    HTML <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <Link href={`/report/${report.share_token}`} className="text-sm text-muted-foreground hover:underline">
                  Share
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No reports yet. Run an audit to generate your first report.</p>
      )}
    </div>
  );
}
