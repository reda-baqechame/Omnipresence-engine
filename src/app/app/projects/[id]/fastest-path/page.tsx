import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { getFastestPath } from "@/lib/engines/fastest-path-service";
import { FastestPathSync } from "@/components/fastest-path-sync";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  long_tail_content: "Long-tail content",
  local_gbp: "Local / GBP",
  comparison_alternative: "Comparison / alternative",
  directory: "Directory",
  reddit_quora: "Reddit / Quora",
  ai_cited_source: "AI-cited source",
  review_site: "Review site",
  schema_markup: "Schema markup",
};

function effortColor(effort: string): string {
  return effort === "low" ? "text-green-400" : effort === "medium" ? "text-yellow-400" : "text-orange-400";
}

export default async function FastestPathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { plan, generatedAt } = await getFastestPath(supabase, id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Fastest Path to Visibility</h2>
          <p className="text-sm text-muted-foreground mt-1">
            A new brand can&apos;t win high-authority head terms on day one. This ranks the surfaces you can realistically
            win soonest — by time-to-impact, winnability, business impact, and effort — derived from your real project
            context (authority, long-tail keywords, citation gaps, missing directories).
          </p>
        </div>
        <FastestPathSync projectId={id} disabled={plan.length === 0} />
      </div>

      {plan.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center text-muted-foreground">
          No winnable surfaces derived yet. Run a scan and add keyword/backlink data, then refresh.
        </div>
      ) : (
        <ol className="space-y-3">
          {plan.map((item) => (
            <li key={item.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {item.rank}
                    </span>
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                      {TYPE_LABEL[item.type] || item.type}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">{item.why}</p>
                  <p className="text-xs text-muted-foreground/80 mt-1">{item.rationale}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-primary">{Math.round(item.score)}</div>
                  <div className="text-xs text-muted-foreground">priority</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>~{item.timeToImpactDays}d to impact</span>
                <span className={effortColor(item.effort)}>{item.effort} effort</span>
                <span>{Math.round(item.winnability * 100)}% winnable</span>
                <span>{Math.round(item.impact)} impact</span>
                <span className="text-muted-foreground/70">action: {item.action}</span>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs text-muted-foreground">Generated {new Date(generatedAt).toLocaleString()}</p>
    </div>
  );
}
