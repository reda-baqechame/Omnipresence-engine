"use client";

import { useEffect, useState } from "react";

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

export function BacklinksPanel({ projectId }: BacklinksPanelProps) {
  const [latest, setLatest] = useState<{
    total_count?: number;
    new_count?: number;
    lost_count?: number;
    created_at?: string;
  } | null>(null);
  const [diff, setDiff] = useState<BacklinkDiff | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch(`/api/backlinks?projectId=${projectId}`);
    const data = await res.json();
    setLatest(data.latest);
    setDiff(data.diff);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/backlinks?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setLatest(data.latest);
        setDiff(data.diff);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

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
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Backlink Monitor</h3>
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

      {diff && (
        <div className="grid md:grid-cols-2 gap-4">
          <LinkList title="New links" items={diff.newLinks} empty="No new links since last snapshot." />
          <LinkList title="Lost links" items={diff.lostLinks} empty="No lost links since last snapshot." />
        </div>
      )}

      {!latest && !diff && (
        <p className="text-sm text-muted-foreground">No snapshots yet. Run a snapshot to establish baseline.</p>
      )}
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
