"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { DataTableToolbar } from "@/components/data-table-toolbar";
import { PanelError } from "@/components/panel-states";

interface BacklinkRow {
  url: string;
  domain: string;
  rank: number;
}

interface BacklinkDiff {
  newLinks: BacklinkRow[];
  lostLinks: BacklinkRow[];
  totalCurrent: number;
  totalPrevious: number;
}

interface BacklinksPanelProps {
  projectId: string;
}

interface AuthorityDist {
  buckets: { label: string; count: number }[];
  total: number;
  median: number | null;
}
interface LinkGap {
  domain: string;
  linksToCompetitors: string[];
  count: number;
  type: string;
}
interface PrAsset {
  type: string;
  title: string;
  description: string;
  why_linkable: string;
  pitch_angle: string;
}
interface UnlinkedMention {
  url: string;
  title: string;
  domain: string;
}
interface ExpertQuote {
  topic: string;
  quote: string;
  credibility_hook: string;
}

export function BacklinksPanel({ projectId }: BacklinksPanelProps) {
  const [latest, setLatest] = useState<{
    total_count?: number;
    new_count?: number;
    lost_count?: number;
    created_at?: string;
  } | null>(null);
  const [diff, setDiff] = useState<BacklinkDiff | null>(null);
  const [authority, setAuthority] = useState<AuthorityDist | null>(null);
  const [webgraphReady, setWebgraphReady] = useState<boolean | null>(null);
  const [webgraphIngest, setWebgraphIngest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [work, setWork] = useState("");
  const [gaps, setGaps] = useState<{ available: boolean; reason?: string; gaps: LinkGap[] } | null>(null);
  const [prAssets, setPrAssets] = useState<PrAsset[] | null>(null);
  const [mentions, setMentions] = useState<UnlinkedMention[] | null>(null);
  const [quotes, setQuotes] = useState<{ quotes?: ExpertQuote[]; platforms: { name: string; url: string }[] } | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [linkFilter, setLinkFilter] = useState("all");
  const [loadError, setLoadError] = useState<string | null>(null);

  const filterLinks = useCallback(
    (items: BacklinkRow[]) =>
      items.filter((l) => {
        if (
          searchQ &&
          !l.domain.toLowerCase().includes(searchQ.toLowerCase()) &&
          !l.url.toLowerCase().includes(searchQ.toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [searchQ]
  );

  const filteredDiff = useMemo(() => {
    if (!diff) return null;
    if (linkFilter === "new") return { newLinks: filterLinks(diff.newLinks), lostLinks: [], totalCurrent: diff.totalCurrent, totalPrevious: diff.totalPrevious };
    if (linkFilter === "lost") return { newLinks: [], lostLinks: filterLinks(diff.lostLinks), totalCurrent: diff.totalCurrent, totalPrevious: diff.totalPrevious };
    return { ...diff, newLinks: filterLinks(diff.newLinks), lostLinks: filterLinks(diff.lostLinks) };
  }, [diff, linkFilter, filterLinks]);

  async function load() {
    const res = await fetch(`/api/backlinks?projectId=${projectId}`);
    const data = await res.json();
    setLatest(data.latest);
    setDiff(data.diff);
    setAuthority(data.authority);
    setWebgraphReady(Boolean(data.webgraph?.ready));
    setWebgraphIngest(Boolean(data.webgraph?.ingestInProgress));
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/backlinks?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setLatest(data.latest);
        setDiff(data.diff);
        setAuthority(data.authority);
        setWebgraphReady(Boolean(data.webgraph?.ready));
        setWebgraphIngest(Boolean(data.webgraph?.ingestInProgress));
      })
      .catch(() => {
        // A failed initial load must not look like "no data yet" — that would
        // silently tell the user their backlinks are at zero when the fetch
        // simply never succeeded.
        if (active) setLoadError("Couldn't load backlink data. Check your connection and reload.");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function runLink(action: string) {
    setWork(action);
    const res = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action }),
    });
    const data = await res.json();
    if (action === "competitor_gap") setGaps(data);
    if (action === "pr_assets") setPrAssets(data.assets || []);
    if (action === "unlinked_mentions") setMentions(data.candidates || []);
    if (action === "expert_quotes") setQuotes({ quotes: data.quotes, platforms: data.platforms || [] });
    setWork("");
  }

  async function snapshot() {
    setLoading(true);
    await fetch("/api/backlinks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    await load();
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="Backlink data unavailable" message={loadError} />}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Backlink Monitor</h3>
            <ProvenanceBadge quality={latest ? "measured" : "unavailable"} />
            {latest && (
              <EvidenceDrawer projectId={projectId} capability="backlink_graph" target="snapshot" label="Proof" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Track referring domains via OmniData / Serper. Weekly cron snapshots new and lost links.
          </p>
        </div>
        <button
          type="button"
          onClick={snapshot}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50 shrink-0"
        >
          {loading ? "Scanning..." : "Run snapshot"}
        </button>
      </div>

      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total backlinks" value={latest.total_count ?? 0} />
          <Stat label="New (last run)" value={latest.new_count ?? 0} />
          <Stat label="Lost (last run)" value={latest.lost_count ?? 0} />
          <Stat
            label="Last checked"
            value={latest.created_at ? new Date(latest.created_at).toLocaleDateString() : "—"}
          />
        </div>
      )}

      {webgraphReady === false && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm">
          <p className="font-medium text-amber-200">Backlink index not ingested — authority unavailable</p>
          <p className="text-muted-foreground mt-1">
            {webgraphIngest
              ? "Common Crawl webgraph ingest is in progress on OmniData."
              : "Full referring-domain authority requires the Common Crawl webgraph ingest (Railway volume 20GB+). Snapshot counts may still update via fallback providers."}
          </p>
        </div>
      )}

      {authority && authority.total > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-medium mb-3">Authority distribution {authority.median != null ? `(median rank ${authority.median})` : ""}</h4>
          <div className="space-y-2">
            {authority.buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3 text-sm">
                <span className="w-40 text-muted-foreground shrink-0">{b.label}</span>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-2 bg-primary" style={{ width: `${Math.round((b.count / authority.total) * 100)}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diff && (
        <div className="space-y-3">
          <DataTableToolbar
            storageKey={`bl-cols-${projectId}`}
            columns={[
              { id: "domain", label: "Domain" },
              { id: "url", label: "URL" },
              { id: "rank", label: "Rank" },
            ]}
            filters={[
              { id: "all", label: "All changes" },
              { id: "new", label: "New links only" },
              { id: "lost", label: "Lost links only" },
            ]}
            onColumnsChange={() => {}}
            onFilterChange={setLinkFilter}
            searchPlaceholder="Filter by domain or URL…"
            onSearchChange={setSearchQ}
          />
          <div className="grid md:grid-cols-2 gap-4">
          <LinkList title="New links" items={filteredDiff?.newLinks || []} empty="No new links since last snapshot." />
          <LinkList title="Lost links" items={filteredDiff?.lostLinks || []} empty="No lost links since last snapshot." />
          </div>
        </div>
      )}

      {!latest && !diff && (
        <p className="text-sm text-muted-foreground">No snapshots yet. Run a snapshot to establish baseline.</p>
      )}

      {/* Link-building workflows */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-1">Link-building workflows</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Competitor backlink gaps (measured), plus AI-assisted digital-PR assets, unlinked-mention
          reclamation, and HARO-style expert quotes.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => runLink("competitor_gap")} disabled={work === "competitor_gap"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {work === "competitor_gap" ? "Finding…" : "Competitor link gap"}
          </button>
          <button type="button" onClick={() => runLink("pr_assets")} disabled={work === "pr_assets"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {work === "pr_assets" ? "Ideating…" : "Digital-PR assets"}
          </button>
          <button type="button" onClick={() => runLink("unlinked_mentions")} disabled={work === "unlinked_mentions"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {work === "unlinked_mentions" ? "Searching…" : "Unlinked mentions"}
          </button>
          <button type="button" onClick={() => runLink("expert_quotes")} disabled={work === "expert_quotes"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {work === "expert_quotes" ? "Drafting…" : "Expert quotes (HARO)"}
          </button>
        </div>

        {gaps && (
          <div className="mt-4">
            <h4 className="font-medium mb-2 text-sm">Competitor backlink gap</h4>
            {!gaps.available ? (
              <p className="text-sm text-yellow-400">{gaps.reason}</p>
            ) : gaps.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No gap domains found.</p>
            ) : (
              <ul className="space-y-1.5 text-sm max-h-64 overflow-y-auto">
                {gaps.gaps.slice(0, 25).map((g) => (
                  <li key={g.domain} className="flex justify-between gap-2">
                    <span><span className="font-medium">{g.domain}</span> <span className="text-xs text-muted-foreground">({g.type})</span></span>
                    <span className="text-xs text-muted-foreground shrink-0">links to {g.count}: {g.linksToCompetitors.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {prAssets && (
          <div className="mt-4">
            <h4 className="font-medium mb-2 text-sm">Digital-PR linkable assets</h4>
            <ul className="space-y-2 text-sm">
              {prAssets.map((a) => (
                <li key={a.title} className="border border-border/50 rounded-lg p-2">
                  <div className="font-medium">{a.title} <span className="text-xs text-muted-foreground">({a.type})</span></div>
                  <p className="text-muted-foreground">{a.description}</p>
                  <p className="text-xs text-primary mt-1">Pitch: {a.pitch_angle}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mentions && (
          <div className="mt-4">
            <h4 className="font-medium mb-2 text-sm">Unlinked mention candidates (verify & request a link)</h4>
            {mentions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates found.</p>
            ) : (
              <ul className="space-y-1.5 text-sm max-h-64 overflow-y-auto">
                {mentions.map((m) => (
                  <li key={m.url}>
                    <a href={m.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{m.domain}</a>
                    <span className="text-muted-foreground"> — {m.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {quotes && (
          <div className="mt-4">
            <h4 className="font-medium mb-2 text-sm">Expert quotes</h4>
            {quotes.quotes?.map((q) => (
              <div key={q.topic} className="border border-border/50 rounded-lg p-2 mb-2 text-sm">
                <div className="font-medium">{q.topic}</div>
                <p className="text-muted-foreground italic">&ldquo;{q.quote}&rdquo;</p>
                <p className="text-xs text-muted-foreground mt-1">{q.credibility_hook}</p>
              </div>
            ))}
            <div className="text-xs text-muted-foreground mt-2">
              Submit on: {quotes.platforms.map((p) => (
                <a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="text-primary hover:underline mr-2">{p.name}</a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  );
}

function LinkList({
  title,
  items,
  empty,
}: {
  title: string;
  items: BacklinkRow[];
  empty: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h4 className="font-medium mb-3">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
          {items.slice(0, 20).map((b) => (
            <li key={`${b.domain}-${b.url}`} className="truncate">
              <span className="font-medium">{b.domain}</span>
              <span className="text-muted-foreground"> — {b.url}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
