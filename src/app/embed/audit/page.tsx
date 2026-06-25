"use client";

import { useState } from "react";

export default function EmbedAuditPage() {
  const [form, setForm] = useState({ domain: "", brandName: "", industry: "", email: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    score?: { omnipresence: number; ai_visibility: number; search_visibility: number; technical_readiness: number };
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
        body: JSON.stringify(form),
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
    <div className="min-h-screen bg-background text-foreground p-4 font-sans">
      <form onSubmit={handleSubmit} className="space-y-3 max-w-md mx-auto">
        <h1 className="text-lg font-bold">OmniPresence Audit</h1>
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
        <input
          value={form.brandName}
          onChange={(e) => setForm({ ...form, brandName: e.target.value })}
          placeholder="Brand name (optional)"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Scanning..." : "Run free audit"}
        </button>
      </form>

      {result?.error && <p className="text-sm text-red-400 mt-4 text-center">{result.error}</p>}

      {result?.score && (
        <div className="mt-6 text-center space-y-2">
          <div className="text-4xl font-bold text-primary">{result.score.omnipresence}</div>
          <div className="text-sm text-muted-foreground">OmniPresence Score</div>
          <div className="grid grid-cols-2 gap-2 text-xs mt-4">
            <div className="bg-card border border-border rounded-lg p-2">
              AI {result.score.ai_visibility}
            </div>
            <div className="bg-card border border-border rounded-lg p-2">
              Search {result.score.search_visibility}
            </div>
            <div className="bg-card border border-border rounded-lg p-2">
              Technical {result.score.technical_readiness}
            </div>
            <div className="bg-card border border-border rounded-lg p-2">
              Issues {result.criticalIssues ?? 0}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
