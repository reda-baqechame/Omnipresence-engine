"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function EmbedAuditPage() {
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand") || "";
  const color = searchParams.get("color") || "#6366f1";
  const logo = searchParams.get("logo") || "";

  const [form, setForm] = useState({ domain: "", brandName: brand, industry: "", email: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    score?: {
      omnipresence: number;
      ai_visibility: number;
      search_visibility: number;
      technical_readiness: number;
      availability?: { ai_visibility: boolean; search_visibility: boolean; technical_readiness: boolean };
    };
    criticalIssues?: number;
    topIssues?: Array<{ title: string; severity: string }>;
    error?: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/public/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, brandName: form.brandName || brand }),
      });
      const data = await res.json();
      if (!res.ok) setResult({ error: data.error || "Audit failed" });
      else setResult(data);
    } catch {
      setResult({ error: "Network error" });
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4 font-sans" style={{ "--primary": color } as React.CSSProperties}>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-md mx-auto">
        <div className="flex items-center gap-2 mb-2">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- external agency logo URL
            <img src={logo} alt="" className="h-8 w-8 rounded object-contain" />
          ) : null}
          <h1 className="text-lg font-bold">{brand || "OmniPresence"} Audit</h1>
        </div>
        <input
          required
          value={form.domain}
          onChange={(e) => setForm({ ...form, domain: e.target.value })}
          placeholder="yourdomain.com"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
        />
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="work@email.com"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
        />
        {!brand && (
          <input
            value={form.brandName}
            onChange={(e) => setForm({ ...form, brandName: e.target.value })}
            placeholder="Brand name (optional)"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          {loading ? "Scanning..." : "Run free audit"}
        </button>
      </form>

      {result?.error && <p className="text-sm text-red-400 mt-4 text-center">{result.error}</p>}

      {result?.score && (
        <div className="mt-6 text-center space-y-2">
          <div className="text-4xl font-bold" style={{ color }}>{result.score.omnipresence}</div>
          <div className="text-sm text-muted-foreground">OmniPresence Score</div>
          <div className="grid grid-cols-2 gap-2 text-xs mt-4">
            <div className="bg-card border border-border rounded-lg p-2">AI {result.score.availability?.ai_visibility === false ? "n/a" : result.score.ai_visibility}</div>
            <div className="bg-card border border-border rounded-lg p-2">Search {result.score.availability?.search_visibility === false ? "n/a" : result.score.search_visibility}</div>
            <div className="bg-card border border-border rounded-lg p-2">Technical {result.score.availability?.technical_readiness === false ? "n/a" : result.score.technical_readiness}</div>
            <div className="bg-card border border-border rounded-lg p-2">Issues {result.criticalIssues ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}
