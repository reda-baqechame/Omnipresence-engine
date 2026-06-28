import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { summarizeCrawlerHits, type CrawlerHit } from "@/lib/engines/agent-analytics";
import { crawlerPurposeLabel, type CrawlerPurpose } from "@/lib/tracking/ai-crawlers";
import { AgentAnalyticsIngest } from "@/components/agent-analytics-ingest";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(diff / 60_000);
  return `${mins}m ago`;
}

const PURPOSE_ORDER: CrawlerPurpose[] = ["ai_user_action", "ai_search", "ai_training", "search_index"];

export default async function CrawlersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_crawler_hits")
    .select("bot,vendor,purpose,path,status_code,user_agent,hit_at")
    .eq("project_id", id)
    .order("hit_at", { ascending: false })
    .limit(20_000);

  const hits = (data || []) as CrawlerHit[];
  const summary = summarizeCrawlerHits(hits);
  const maxDay = Math.max(1, ...summary.byDay.map((d) => d.hits));
  const maxBot = Math.max(1, ...summary.byBot.map((b) => b.hits));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">AI Crawler Analytics</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          AI engines must fetch your pages before they can cite you. This is the leading indicator of AI visibility —
          which AI agents crawl your site, how often, and what they read. Most tools gate this behind enterprise CDN
          integrations; here it&apos;s keyless from your own logs.
        </p>
      </div>

      {summary.totalHits === 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground">
          No AI crawler hits recorded yet. Paste your access logs below to see which AI engines are reading your content.
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { label: "Total AI crawls", value: summary.totalHits.toLocaleString() },
              { label: "Distinct AI bots", value: String(summary.uniqueBots) },
              { label: "Vendors crawling", value: String(summary.uniqueVendors) },
              {
                label: "High-intent (live user)",
                value: summary.byPurpose.ai_user_action.toLocaleString(),
              },
            ].map((m) => (
              <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-primary">{m.value}</div>
                <div className="text-sm text-muted-foreground">{m.label}</div>
              </div>
            ))}
          </div>

          {summary.missingVendors.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
              <span className="font-semibold text-yellow-400">Coverage gap: </span>
              <span className="text-muted-foreground">
                No crawls recorded from{" "}
                <span className="text-foreground font-medium">{summary.missingVendors.join(", ")}</span> in this window.
                If these engines never fetch you, they can&apos;t cite you — check robots.txt, server firewall rules, and
                make sure your key pages are linked and fast.
              </span>
            </div>
          )}

          <div>
            <h2 className="text-xl font-semibold mb-4">Crawls by AI bot</h2>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-3">Bot</th>
                    <th className="text-left p-3">Vendor</th>
                    <th className="text-left p-3">Purpose</th>
                    <th className="text-right p-3">Crawls</th>
                    <th className="text-right p-3">Error rate</th>
                    <th className="text-right p-3">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byBot.map((b) => (
                    <tr key={b.bot} className="border-b border-border/50">
                      <td className="p-3 font-medium">{b.bot}</td>
                      <td className="p-3 text-muted-foreground">{b.vendor}</td>
                      <td className="p-3 text-muted-foreground text-xs">{crawlerPurposeLabel(b.purpose)}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 rounded-full bg-primary/30 w-24 overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${(b.hits / maxBot) * 100}%` }}
                            />
                          </div>
                          <span>{b.hits.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className={`p-3 text-right ${b.errorRate > 0.1 ? "text-red-400" : "text-muted-foreground"}`}>
                        {Math.round(b.errorRate * 100)}%
                      </td>
                      <td className="p-3 text-right text-muted-foreground">{timeAgo(b.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">Crawl intent mix</h2>
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                {PURPOSE_ORDER.map((p) => {
                  const count = summary.byPurpose[p];
                  const pct = summary.totalHits > 0 ? Math.round((count / summary.totalHits) * 100) : 0;
                  return (
                    <div key={p}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{crawlerPurposeLabel(p)}</span>
                        <span>{count.toLocaleString()} · {pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-background overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">Most-crawled pages</h2>
              <div className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm">
                {summary.topPaths.length === 0 ? (
                  <p className="text-muted-foreground">No path data in these logs.</p>
                ) : (
                  summary.topPaths.slice(0, 10).map((p) => (
                    <div key={p.path} className="flex justify-between gap-3">
                      <span className="truncate text-muted-foreground" title={p.path}>{p.path}</span>
                      <span className="font-medium shrink-0">{p.hits.toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {summary.byDay.length > 1 && (
            <div>
              <h2 className="text-xl font-semibold mb-4">Crawl volume over time</h2>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-end gap-1 h-32">
                  {summary.byDay.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end group" title={`${d.date}: ${d.hits} crawls`}>
                      <div
                        className="w-full bg-primary/70 rounded-t group-hover:bg-primary transition"
                        style={{ height: `${(d.hits / maxDay) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>{summary.byDay[0]?.date}</span>
                  <span>{summary.byDay[summary.byDay.length - 1]?.date}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <AgentAnalyticsIngest projectId={id} />
    </div>
  );
}
