"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

interface OpsItem {
  id: string;
  project_id: string;
  title: string;
  action_type: string;
  risk_level: string;
  status: string;
  created_at: string;
}

export function OpsApprovalPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<OpsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ops?projectId=${projectId}&status=pending`);
    const data = await res.json();
    setItems((data.items || []).filter((i: OpsItem) => i.risk_level === "high" || i.status === "pending"));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/ops?projectId=${projectId}&status=pending`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setItems((data.items || []).filter((i: OpsItem) => i.risk_level === "high" || i.status === "pending"));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function approve(id: string) {
    setBusy(id);
    await fetch("/api/ops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "approved", execute: true }),
    });
    await load();
    setBusy(null);
  }

  async function reject(id: string) {
    setBusy(id);
    await fetch("/api/ops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "rejected" }),
    });
    await load();
    setBusy(null);
  }

  if (loading) return null;
  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-400">
        <ShieldAlert className="h-4 w-4" />
        <h3 className="font-semibold text-sm">High-risk ops awaiting approval ({items.length})</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{item.title}</span>
              <span className="ml-2 text-xs text-muted-foreground capitalize">{item.action_type.replace(/_/g, " ")}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => approve(item.id)}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Approve & run
              </button>
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => reject(item.id)}
                className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
