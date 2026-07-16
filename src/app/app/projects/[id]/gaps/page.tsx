import { notFound } from "next/navigation";
import Link from "next/link";
import { FileText, Link2, ServerCog } from "lucide-react";
import { getProject } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import {
  pageOpportunities,
  missingCitationSources,
} from "@/lib/engines/visibility-insights";
import type { TechnicalFinding, VisibilityResult } from "@/types/database";
import { CopyFixButton } from "@/components/copy-fix-button";

export const dynamic = "force-dynamic";

const TECHNICAL_CATEGORIES = new Set([
  "crawlability",
  "robots",
  "sitemap",
  "rendering",
  "index_coverage",
  "schema",
  "performance",
  "security",
  "meta",
]);
const CONTENT_CATEGORIES = new Set(["passage", "freshness", "content"]);

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function sortBySeverity(findings: TechnicalFinding[]): TechnicalFinding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

/**
 * Gap analysis (Master Plan v4, Phase 1): every measured gap sorted into
 * exactly three fix categories — technical AI access/readiness, answer-ready
 * content/passages, and source/citation opportunities. Each item carries a
 * concrete fix, copy-paste ready where possible.
 */
export default async function GapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const [{ data: findingsData }, { data: resultsData }, { data: authorityData }] = await Promise.all([
    supabase
      .from("technical_findings")
      .select("*")
      .eq("project_id", id)
      .eq("is_resolved", false)
      .limit(200),
    supabase.from("visibility_results").select("*").eq("project_id", id).limit(1000),
    supabase
      .from("authority_opportunities")
      .select("type, target_site, pitch_angle, estimated_impact")
      .eq("project_id", id)
      .order("estimated_impact", { ascending: false })
      .limit(15),
  ]);

  const findings = (findingsData || []) as TechnicalFinding[];
  const results = (resultsData || []) as VisibilityResult[];

  const technicalGaps = sortBySeverity(
    findings.filter((f) => TECHNICAL_CATEGORIES.has(f.category) || !CONTENT_CATEGORIES.has(f.category))
  ).slice(0, 15);
  const contentFindings = sortBySeverity(findings.filter((f) => CONTENT_CATEGORIES.has(f.category))).slice(0, 10);
  const pages = pageOpportunities(results, 10);
  const missingSources = missingCitationSources(results, project.domain, 10);
  const authority = (authorityData || []) as Array<{
    type: string;
    target_site: string;
    pitch_angle: string | null;
    estimated_impact: number | null;
  }>;

  const categories = [
    {
      icon: ServerCog,
      title: "1 — Technical AI access & readiness",
      description:
        "Can AI crawlers reach, render, and trust the site? Robots, sitemaps, rendering, schema, and index coverage — the plumbing every AI answer depends on.",
      count: technicalGaps.length,
    },
    {
      icon: FileText,
      title: "2 — Answer-ready content & passages",
      description:
        "Do pages answer the buyer prompts AI engines are actually asked? Passage structure, freshness, and the specific pages to create or update.",
      count: contentFindings.length + pages.create.length + pages.update.length,
    },
    {
      icon: Link2,
      title: "3 — Source & citation opportunities",
      description:
        "Which domains do AI engines cite instead of you? Earn presence on the sources that already win the answers.",
      count: missingSources.length + authority.length,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Gap Analysis</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every gap below is derived from this project&apos;s own measured scans — nothing generic.
          Three fix categories, in the order that usually moves AI visibility fastest.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {categories.map((c) => (
          <div key={c.title} className="bg-card border border-border rounded-xl p-4">
            <c.icon className="h-5 w-5 text-primary mb-2" />
            <div className="font-medium text-sm">{c.title}</div>
            <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
            <div className="text-2xl font-bold mt-2">{c.count}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold">1 — Technical AI access &amp; readiness</h3>
        {technicalGaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open technical findings. Re-scan to refresh.</p>
        ) : (
          technicalGaps.map((f, i) => (
            <div key={`${f.title}-${i}`} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                    f.severity === "critical"
                      ? "bg-red-500/10 text-red-400"
                      : f.severity === "high"
                        ? "bg-orange-500/10 text-orange-400"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {f.severity}
                </span>
                <span className="font-medium text-sm">{f.title}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5">{f.description}</p>
              {f.fix_recommendation && (
                <div className="mt-2 flex items-start gap-2 bg-background border border-border rounded-lg p-3">
                  <p className="text-sm flex-1 whitespace-pre-wrap">{f.fix_recommendation}</p>
                  <CopyFixButton text={f.fix_recommendation} />
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">2 — Answer-ready content &amp; passages</h3>
        {contentFindings.map((f, i) => (
          <div key={`${f.title}-${i}`} className="bg-card border border-border rounded-lg p-4">
            <div className="font-medium text-sm">{f.title}</div>
            <p className="text-sm text-muted-foreground mt-1.5">{f.description}</p>
            {f.fix_recommendation && (
              <div className="mt-2 flex items-start gap-2 bg-background border border-border rounded-lg p-3">
                <p className="text-sm flex-1 whitespace-pre-wrap">{f.fix_recommendation}</p>
                <CopyFixButton text={f.fix_recommendation} />
              </div>
            )}
          </div>
        ))}
        {pages.create.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-medium text-sm mb-2">Pages to create (brand absent from measured answers)</div>
            <ul className="space-y-1.5 text-sm">
              {pages.create.map((p) => (
                <li key={p.prompt} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    &ldquo;{p.prompt}&rdquo;{" "}
                    <span className="text-xs text-muted-foreground">
                      ({p.engines.join(", ")}{p.competitors.length ? ` — won by ${p.competitors.slice(0, 3).join(", ")}` : ""})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pages.update.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-medium text-sm mb-2">Pages to update (mentioned but never cited)</div>
            <ul className="space-y-1.5 text-sm">
              {pages.update.map((p) => (
                <li key={p.prompt} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    &ldquo;{p.prompt}&rdquo; <span className="text-xs text-muted-foreground">({p.reason})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {contentFindings.length === 0 && pages.create.length === 0 && pages.update.length === 0 && (
          <p className="text-sm text-muted-foreground">No measured content gaps yet. Run a scan first.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">3 — Source &amp; citation opportunities</h3>
        {missingSources.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-medium text-sm mb-2">Domains AI engines cite instead of you</div>
            <ul className="space-y-1.5 text-sm">
              {missingSources.map((s) => (
                <li key={s.domain} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <span className="font-medium">{s.domain}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      cited in {s.count} answer{s.count === 1 ? "" : "s"} where you weren&apos;t
                      {s.competitors.length ? ` — alongside ${s.competitors.slice(0, 3).join(", ")}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {authority.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-medium text-sm mb-2">Authority targets with a pitch angle</div>
            <ul className="space-y-1.5 text-sm">
              {authority.map((o, i) => (
                <li key={`${o.target_site}-${i}`} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <span className="font-medium">{o.target_site}</span>{" "}
                    <span className="text-xs text-muted-foreground">{o.pitch_angle || o.type}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {missingSources.length === 0 && authority.length === 0 && (
          <p className="text-sm text-muted-foreground">No source gaps measured yet. Run a scan first.</p>
        )}
      </section>

      <div className="text-sm text-muted-foreground">
        Turn these into executable work on the{" "}
        <Link href={`/app/projects/${id}/action-proof`} className="text-primary hover:underline">
          Action Plan &amp; Proof
        </Link>{" "}
        page — every deployed fix gets remeasured.
      </div>
    </div>
  );
}
