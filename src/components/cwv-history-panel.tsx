"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

interface CwvRow {
  collected_on: string;
  lcp_ms?: number | null;
  inp_ms?: number | null;
  cls?: number | null;
}

export function CwvHistoryPanel({ projectId }: { projectId: string }) {
  const [history, setHistory] = useState<CwvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/cwv?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setHistory(d.history || []))
      .catch(() => {});
  }, [projectId]);

  async function sync() {
    setLoading(true);
    setReason(null);
    const res = await fetch("/api/cwv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const d = await res.json();
    if (d.available) setHistory(d.history || []);
    else setReason(d.reason || "Unavailable");
    setLoading(false);
  }

  const chartData = history.map((h) => ({
    date: h.collected_on?.slice(5),
    LCP: h.lcp_ms ?? undefined,
    INP: h.inp_ms ?? undefined,
    CLS: h.cls != null ? Math.round(h.cls * 1000) : undefined,
  }));

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3">
      <CapabilityEvidenceBar
        projectId={projectId}
        capability="performance"
        target="cwv"
        label="CWV proof"
        quality={history.length > 0 ? "measured" : "unavailable"}
      />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Core Web Vitals history</h2>
          <p className="text-xs text-muted-foreground">Real-user p75 trend (Chrome UX Report). LCP/INP in ms, CLS ×1000.</p>
        </div>
        <button type="button" onClick={sync} disabled={loading} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
          {loading ? "Syncing…" : "Sync CrUX"}
        </button>
      </div>
      {reason && <p className="text-sm text-yellow-400">{reason}</p>}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="date" stroke="#8888a0" fontSize={11} />
            <YAxis stroke="#8888a0" fontSize={11} />
            <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8 }} labelStyle={{ color: "#f0f0f5" }} />
            <Legend />
            <Line type="monotone" dataKey="LCP" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="INP" stroke="#22d3ee" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="CLS" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        !reason && <p className="text-sm text-muted-foreground">No CrUX history yet — click &quot;Sync CrUX&quot; to pull real-user trends.</p>
      )}
    </div>
  );
}
