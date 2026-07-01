"use client";

import { useState } from "react";
import { Loader2, Search, Sparkles, ShieldCheck } from "lucide-react";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { ProvenanceBadge } from "@/components/provenance-badge";

interface SerpIntel {
  keyword: string;
  location: string;
  device: string;
  organic: Array<{ position: number; title: string; url: string; domain: string; description?: string }>;
  ads: Array<{ position: number; title: string; url: string; domain: string }>;
  peopleAlsoAsk: string[];
  localPack: Array<{ title: string; url?: string }>;
  featuredSnippet?: { title?: string; url?: string; description?: string };
  aiOverview?: { present: boolean; text?: string; citedUrls: string[]; citedDomains: string[] };
  featureTypes: string[];
  provider: string;
}

interface ApiResponse {
  available: boolean;
  reason?: string;
  serp?: SerpIntel;
}

const FEATURE_LABEL: Record<string, string> = {
  ai_overview: "AI Overview",
  featured_snippet: "Featured snippet",
  people_also_ask: "People Also Ask",
  local_pack: "Local pack",
  paid: "Ads",
  related_searches: "Related searches",
  knowledge_graph: "Knowledge panel",
  images: "Images",
  video: "Video",
  top_stories: "Top stories",
};

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border">
      <div className="border-b border-border bg-secondary/40 px-4 py-2.5 text-sm font-medium">
        {title}
        {typeof count === "number" && <span className="ml-2 text-muted-foreground">({count})</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function SerpIntelligenceExplorer({ projectId }: { projectId: string }) {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("United States");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetch("/api/serp-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, keyword: keyword.trim(), location, device }),
      });
      if (!r.ok) {
        setError(`Request failed (${r.status})`);
        return;
      }
      setRes((await r.json()) as ApiResponse);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const serp = res?.serp;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground">Keyword</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. best crm for startups"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Location</label>
          <input
            aria-label="SERP location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Device</label>
          <select
            aria-label="SERP device"
            value={device}
            onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
          </select>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !keyword.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Capture SERP
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {res && !res.available && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Unavailable: {res.reason}
        </div>
      )}

      {serp && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-1 text-green-300">
              <ShieldCheck className="h-3 w-3" /> measured · {serp.provider}
            </span>
            <ProvenanceBadge quality="measured" />
            <EvidenceDrawer projectId={projectId} capability="serp" target={serp.keyword} label="View proof" />
            {serp.featureTypes.map((f) => (
              <span key={f} className="rounded-full bg-secondary px-2 py-1 text-muted-foreground">
                {FEATURE_LABEL[f] || f}
              </span>
            ))}
          </div>

          {serp.aiOverview?.present && (
            <Section title="AI Overview">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="space-y-2">
                  {serp.aiOverview.text && <p className="text-sm">{serp.aiOverview.text}</p>}
                  {serp.aiOverview.citedDomains.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {serp.aiOverview.citedDomains.map((d) => (
                        <span key={d} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          {serp.featuredSnippet && (
            <Section title="Featured snippet">
              <div className="text-sm">
                <a href={serp.featuredSnippet.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {serp.featuredSnippet.title || serp.featuredSnippet.url}
                </a>
                {serp.featuredSnippet.description && (
                  <p className="text-muted-foreground mt-1">{serp.featuredSnippet.description}</p>
                )}
              </div>
            </Section>
          )}

          {serp.ads.length > 0 && (
            <Section title="Ads / paid" count={serp.ads.length}>
              <ul className="space-y-2 text-sm">
                {serp.ads.map((a, i) => (
                  <li key={i}>
                    <span className="text-xs text-muted-foreground mr-2">#{a.position}</span>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {a.title || a.domain}
                    </a>
                    <span className="text-xs text-muted-foreground ml-2">{a.domain}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Organic results" count={serp.organic.length}>
            <ol className="space-y-2.5 text-sm">
              {serp.organic.map((o, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-xs text-muted-foreground w-6 shrink-0">#{o.position}</span>
                  <div className="min-w-0">
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-words">
                      {o.title || o.url}
                    </a>
                    <div className="text-xs text-muted-foreground">{o.domain}</div>
                    {o.description && <p className="text-muted-foreground mt-0.5 line-clamp-2">{o.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            {serp.peopleAlsoAsk.length > 0 && (
              <Section title="People Also Ask" count={serp.peopleAlsoAsk.length}>
                <ul className="space-y-1.5 text-sm list-disc pl-4">
                  {serp.peopleAlsoAsk.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </Section>
            )}
            {serp.localPack.length > 0 && (
              <Section title="Local pack" count={serp.localPack.length}>
                <ul className="space-y-1.5 text-sm">
                  {serp.localPack.map((p, i) => (
                    <li key={i}>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {p.title}
                        </a>
                      ) : (
                        p.title
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
