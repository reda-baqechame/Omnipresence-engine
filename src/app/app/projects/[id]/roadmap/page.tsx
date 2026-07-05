import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RoadmapItem } from "@/types/database";
import { getProject } from "@/lib/projects";

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data: roadmap } = await supabase
    .from("roadmaps")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const items = (roadmap?.items || []) as RoadmapItem[];
  const byWeek = items.reduce(
    (acc, item) => {
      if (!acc[item.week]) acc[item.week] = [];
      acc[item.week].push(item);
      return acc;
    },
    {} as Record<number, RoadmapItem[]>
  );

  const impactColor = {
    critical: "text-red-400 bg-red-500/10",
    high: "text-orange-400 bg-orange-500/10",
    medium: "text-yellow-400 bg-yellow-500/10",
    low: "text-blue-400 bg-blue-500/10",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">90-Day Execution Roadmap</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Prioritized actions ranked by revenue impact for {project.name}.
        </p>
      </div>

      {items.length > 0 ? (
        <div className="space-y-8">
          {Object.entries(byWeek)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([week, weekItems]) => (
              <div key={week}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <span className="bg-primary text-primary-foreground text-sm px-3 py-1 rounded-lg">
                    Week {week}
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">
                    {weekItems.length} tasks
                  </span>
                </h3>
                <div className="space-y-2">
                  {weekItems.map((item, i) => (
                    <div
                      key={i}
                      className="bg-card border border-border rounded-xl p-4 flex gap-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{item.title}</h4>
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${impactColor[item.impact]}`}
                          >
                            {item.impact}
                          </span>
                          <span className="text-xs text-muted-foreground">{item.category}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        {item.evidence_label && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Evidence:{" "}
                            {item.evidence_url ? (
                              <a href={item.evidence_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                {item.evidence_label}
                              </a>
                            ) : (
                              item.evidence_label
                            )}
                          </p>
                        )}
                      </div>
                      {item.estimated_hours && (
                        <div className="text-sm text-muted-foreground whitespace-nowrap">
                          ~{item.estimated_hours}h
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          No roadmap generated yet. Run a scan to get your 90-day execution plan.
        </div>
      )}
    </div>
  );
}
