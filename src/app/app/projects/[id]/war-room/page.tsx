import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { isWithinDays } from "@/lib/time";

export default async function WarRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();

  const [{ data: probes }, { data: crawlers }, { data: tasks }, { data: scores }] = await Promise.all([
    supabase
      .from("ai_probe_traces")
      .select("engine, brand_mentioned, brand_cited, competitors_mentioned, grounding_mode, prompt, checked_at")
      .eq("project_id", id)
      .order("checked_at", { ascending: false })
      .limit(400),
    supabase
      .from("ai_crawler_hits")
      .select("vendor, hit_at")
      .eq("project_id", id)
      .order("hit_at", { ascending: false })
      .limit(500),
    supabase
      .from("execution_tasks")
      .select("title, impact, status, priority, source_module")
      .eq("project_id", id)
      .order("impact", { ascending: false })
      .limit(60),
    supabase
      .from("scores")
      .select("omnipresence_score, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(2),
  ]);

  const probeRows = probes || [];
  const total = probeRows.length;
  const mentioned = probeRows.filter((p) => p.brand_mentioned).length;
  const cited = probeRows.filter((p) => p.brand_cited).length;
  const grounded = probeRows.filter((p) => p.grounding_mode === "grounded" || p.grounding_mode === "ui_capture").length;
  const sov = total ? Math.round((mentioned / total) * 100) : null;
  const citationRate = total ? Math.round((cited / total) * 100) : null;
  const groundedPct = total ? Math.round((grounded / total) * 100) : null;

  // Per-engine health.
  const byEngine = new Map<string, { total: number; mentioned: number; cited: number }>();
  for (const p of probeRows) {
    const e = byEngine.get(p.engine) || { total: 0, mentioned: 0, cited: 0 };
    e.total += 1;
    if (p.brand_mentioned) e.mentioned += 1;
    if (p.brand_cited) e.cited += 1;
    byEngine.set(p.engine, e);
  }
  const engines = [...byEngine.entries()].sort((a, b) => b[1].total - a[1].total);

  // Crawler activity (last 30d) by vendor.
  const recentCrawls = (crawlers || []).filter((c) => isWithinDays(c.hit_at, 30));
  const byVendor = new Map<string, number>();
  for (const c of recentCrawls) byVendor.set(c.vendor, (byVendor.get(c.vendor) || 0) + 1);
  const crawlerVendors = [...byVendor.entries()].sort((a, b) => b[1] - a[1]);

  // Competitor moves: recent probes mentioning competitors but not the brand.
  const competitorMoves = probeRows
    .filter((p) => !p.brand_mentioned && (p.competitors_mentioned || []).length > 0)
    .slice(0, 8);

  // Actions to win.
  const openTasks = (tasks || [])
    .filter((t) => t.status !== "done" && t.status !== "completed")
    .slice(0, 8);

  // Alert: score drop.
  const scoreNow = scores?.[0]?.omnipresence_score as number | undefined;
  const scorePrev = scores?.[1]?.omnipresence_score as number | undefined;
  const scoreDrop = scoreNow != null && scorePrev != null && scoreNow < scorePrev ? scorePrev - scoreNow : 0;

  const base = `/app/projects/${id}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">AI Visibility War Room</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One screen: share of voice, per-engine health, AI crawler activity, competitor moves, and the
          highest-impact actions to win. Everything is measured from your scan history — no fabricated
          numbers.
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No probe history yet. Run a{" "}
          <Link href={`${base}/visibility`} className="text-primary">visibility scan</Link> to populate the
          War Room.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-primary">{sov ?? "—"}{sov != null ? "%" : ""}</div>
              <div className="text-xs text-muted-foreground">Share of voice (mention rate)</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-cyan-400">{citationRate ?? "—"}{citationRate != null ? "%" : ""}</div>
              <div className="text-xs text-muted-foreground">Citation rate</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{groundedPct ?? "—"}{groundedPct != null ? "%" : ""}</div>
              <div className="text-xs text-muted-foreground">Grounded coverage</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className={`text-3xl font-bold ${scoreDrop > 0 ? "text-red-400" : "text-primary"}`}>
                {scoreNow != null ? Math.round(scoreNow) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                OmniPresence score{scoreDrop > 0 ? ` (▼${Math.round(scoreDrop)})` : ""}
              </div>
            </div>
          </div>

          {scoreDrop > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm p-3">
              Alert: OmniPresence score dropped {Math.round(scoreDrop)} points since the previous scan.
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <section className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold mb-3">Per-engine health</h3>
              <div className="space-y-2">
                {engines.map(([engine, e]) => {
                  const rate = Math.round((e.mentioned / e.total) * 100);
                  return (
                    <div key={engine}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize">{engine}</span>
                        <span className="text-muted-foreground">{rate}% · {e.cited}/{e.total} cited</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${rate}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold mb-3">AI crawler activity (30d)</h3>
              {crawlerVendors.length ? (
                <div className="space-y-2">
                  {crawlerVendors.map(([vendor, count]) => (
                    <div key={vendor} className="flex justify-between text-sm">
                      <span>{vendor}</span>
                      <span className="text-muted-foreground">{count} hits</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No AI crawler hits recorded. Install the crawler beacon to see GPTBot, ClaudeBot,
                  PerplexityBot and others fetching your pages.
                </p>
              )}
            </section>

            <section className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold mb-3">Competitor-move ticker</h3>
              {competitorMoves.length ? (
                <ul className="space-y-2 text-sm">
                  {competitorMoves.map((p, i) => (
                    <li key={i} className="text-muted-foreground">
                      <span className="text-red-400">{(p.competitors_mentioned || []).slice(0, 2).join(", ")}</span>{" "}
                      won a {p.engine} answer you were absent from: &ldquo;{(p.prompt || "").slice(0, 60)}&rdquo;
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No competitor-only answers detected recently.</p>
              )}
            </section>

            <section className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold mb-3">Actions to win</h3>
              {openTasks.length ? (
                <ul className="space-y-2 text-sm">
                  {openTasks.map((t, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">{t.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        impact {t.impact ?? "—"} · {t.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No open actions. New fixes appear here as scans surface gaps.{" "}
                  <Link href={`${base}/tasks`} className="text-primary">View all tasks</Link>.
                </p>
              )}
            </section>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`${base}/visibility`} className="text-primary">Visibility detail →</Link>
            <Link href={`${base}/intelligence`} className="text-primary">AEO intel →</Link>
            <Link href={`${base}/crawlers`} className="text-primary">Crawler detail →</Link>
            <Link href={`${base}/source-graph`} className="text-primary">Source graph →</Link>
          </div>
        </>
      )}
    </div>
  );
}
