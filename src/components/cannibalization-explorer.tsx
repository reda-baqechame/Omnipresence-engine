"use client";

import { useState } from "react";
import { Loader2, Search, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Pair {
  a: string;
  b: string;
  similarity: number;
}

interface ApiResult {
  available: boolean;
  reason?: string;
  pairs?: Pair[];
}

export function CannibalizationExplorer({ projectId, domain }: { projectId: string; domain: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "cannibalization" }),
      });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as ApiResult);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {loading ? `Crawling ${domain}…` : "Scan for cannibalization"}
      </button>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {result && !result.available && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Unavailable: {result.reason || "semantic engine not configured"}
        </div>
      )}

      {result?.available && (result.pairs?.length ?? 0) === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300">
          <CheckCircle2 className="h-4 w-4" /> No cannibalization detected across crawled pages.
        </div>
      )}

      {result?.available && (result.pairs?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            {result!.pairs!.length} competing page pair{result!.pairs!.length === 1 ? "" : "s"}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Page A</th>
                <th className="px-4 py-2 font-medium">Page B</th>
                <th className="px-4 py-2 font-medium">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {result!.pairs!.map((p, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-4 py-2.5 break-all">
                    <a href={p.a} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {p.a}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 break-all">
                    <a href={p.b} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {p.b}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-orange-300">{Math.round(p.similarity * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
