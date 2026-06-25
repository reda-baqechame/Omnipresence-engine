import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FindingCard } from "@/components/finding-card";
import { OnPagePanel } from "@/components/on-page-panel";
import { getProject } from "@/lib/projects";
import { AI_BOTS } from "@/lib/providers/ai-gateway";

export default async function TechnicalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: findings } = await supabase
    .from("technical_findings")
    .select("*")
    .eq("project_id", id)
    .order("severity");

  const all = findings || [];
  const byCategory = all.reduce(
    (acc, f) => {
      if (!acc[f.category]) acc[f.category] = [];
      acc[f.category].push(f);
      return acc;
    },
    {} as Record<string, typeof all>
  );

  const critical = all.filter((f) => f.severity === "critical").length;
  const high = all.filter((f) => f.severity === "high").length;
  const aiBotIssues = all.filter((f) => f.category === "ai_bot_access").length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Technical Readiness Audit</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Crawlability, indexability, schema, on-page SEO, and AI bot access for {project.domain}
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{critical}</div>
          <div className="text-sm text-muted-foreground">Critical</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-orange-400">{high}</div>
          <div className="text-sm text-muted-foreground">High</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold">{all.length}</div>
          <div className="text-sm text-muted-foreground">Total Issues</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{aiBotIssues}</div>
          <div className="text-sm text-muted-foreground">AI Bot Issues</div>
        </div>
      </div>

      <OnPagePanel projectId={id} />

      <div>
        <h3 className="font-semibold mb-3">AI Crawler Access Checklist</h3>
        <div className="grid md:grid-cols-3 gap-2">
          {AI_BOTS.slice(0, 9).map((bot) => {
            const blocked = all.some(
              (f) => f.category === "ai_bot_access" && f.title.includes(bot)
            );
            return (
              <div
                key={bot}
                className={`text-sm px-3 py-2 rounded-lg ${
                  blocked ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
                }`}
              >
                {blocked ? "✗" : "✓"} {bot}
              </div>
            );
          })}
        </div>
      </div>

      {(Object.entries(byCategory) as [string, typeof all][]).map(([category, items]) => (
        <div key={category}>
          <h3 className="font-semibold mb-3 capitalize">{category.replace(/_/g, " ")} ({items.length})</h3>
          <div className="space-y-2">
            {items.map((f) => (
              <FindingCard
                key={f.id}
                title={f.title}
                description={f.description}
                severity={f.severity}
                fix={f.fix_recommendation}
                category={f.category}
              />
            ))}
          </div>
        </div>
      ))}

      {all.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          No technical findings yet. Run a scan to audit {project.domain}.
        </div>
      )}
    </div>
  );
}
