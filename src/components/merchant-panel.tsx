"use client";

import { useCallback, useEffect, useState } from "react";

interface ProductIssue {
  field: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}

interface MerchantProduct {
  id: string;
  product_id: string;
  title: string | null;
  optimized_title: string | null;
  optimized_description: string | null;
  brand: string | null;
  price: string | null;
  issues: ProductIssue[];
  score: number;
}

interface ProductVisibilitySnapshot {
  query: string;
  surface: string;
  engine: string;
  brand_present: boolean;
  position: number | null;
  competitors_present: string[];
  data_source: string;
}
interface ProductVisibility {
  available: boolean;
  reason?: string;
  serpPresenceRate: number | null;
  aiPresenceRate: number | null;
  snapshots: ProductVisibilitySnapshot[];
}

export function MerchantPanel({ projectId }: { projectId: string }) {
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [summary, setSummary] = useState<{ total: number; averageScore: number } | null>(null);
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"xml" | "tsv">("xml");
  const [optimize, setOptimize] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProductVisibility | null>(null);
  const [vizLoading, setVizLoading] = useState(false);
  const [vizMessage, setVizMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/merchant?projectId=${projectId}`);
    if (!res.ok) return;
    const data = await res.json();
    setProducts(data.products || []);
    setSummary(data.summary || null);
    setVisibility(data.visibility || null);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    async function run() {
      const res = await fetch(`/api/merchant?projectId=${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!active) return;
      setProducts(data.products || []);
      setSummary(data.summary || null);
      setVisibility(data.visibility || null);
    }
    void run();
    return () => {
      active = false;
    };
  }, [projectId]);

  async function runVisibility() {
    setVizLoading(true);
    setVizMessage(null);
    const res = await fetch("/api/merchant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "visibility" }),
    });
    const data = await res.json();
    if (!res.ok || !data.available) {
      setVizMessage(data.reason || data.error || "Product visibility scan unavailable");
    } else {
      setVizMessage(
        `Scanned ${data.queries} queries · SERP presence ${data.serpPresenceRate ?? "n/a"}% · AI recommendation presence ${data.aiPresenceRate ?? "n/a"}%`
      );
      await load();
    }
    setVizLoading(false);
  }

  async function submit() {
    if (!content.trim()) return;
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/merchant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, content, format, optimize }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Feed audit failed");
    } else {
      setMessage(
        `Audited ${data.totalProducts} products · avg feed score ${data.averageScore}/100 · optimized ${data.optimized}`
      );
      await load();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">Merchant / Shopping Feed Optimizer</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Paste your Google Merchant Center / Shopping feed (XML or TSV). We audit feed quality
          against Merchant requirements, LLM-optimize titles/descriptions (FeedGen approach), and
          generate Product schema — never inventing prices or specs.
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste feed XML (RSS 2.0 + g: namespace) or TSV export…"
          rows={6}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono"
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <select
            aria-label="Feed format"
            value={format}
            onChange={(e) => setFormat(e.target.value as "xml" | "tsv")}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="xml">XML (RSS)</option>
            <option value="tsv">TSV</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
            LLM-optimize worst products
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "Auditing…" : "Audit & optimize feed"}
          </button>
        </div>
        {message && <p className="text-sm mt-3 text-muted-foreground">{message}</p>}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold mb-1">Product AI Visibility</h3>
            <p className="text-sm text-muted-foreground">
              Measures whether your products surface in Shopping/organic SERP (measured) and in AI
              product recommendations (model-knowledge). Honest labels — no faked precision.
            </p>
          </div>
          <button
            type="button"
            onClick={runVisibility}
            disabled={vizLoading}
            className="shrink-0 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {vizLoading ? "Scanning…" : "Run product visibility scan"}
          </button>
        </div>
        {vizMessage && <p className="text-sm mt-3 text-muted-foreground">{vizMessage}</p>}

        {visibility?.available ? (
          <>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div className="border border-border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-cyan-400">
                  {visibility.serpPresenceRate ?? "—"}{visibility.serpPresenceRate != null ? "%" : ""}
                </div>
                <div className="text-xs text-muted-foreground">Shopping/SERP presence (measured)</div>
              </div>
              <div className="border border-border rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-amber-400">
                  {visibility.aiPresenceRate ?? "—"}{visibility.aiPresenceRate != null ? "%" : ""}
                </div>
                <div className="text-xs text-muted-foreground">AI recommendation presence (model-knowledge)</div>
              </div>
            </div>
            {visibility.snapshots.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="text-left p-2">Query</th>
                      <th className="text-left p-2">Surface</th>
                      <th className="text-left p-2">Brand</th>
                      <th className="text-left p-2">Competitors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibility.snapshots.slice(0, 20).map((s, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="p-2 max-w-xs truncate">{s.query}</td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {s.surface === "shopping_serp" ? `SERP (${s.engine})` : `AI (${s.engine})`}
                        </td>
                        <td className="p-2">
                          {s.brand_present ? (
                            <span className="text-green-400">{s.position ? `#${s.position}` : "present"}</span>
                          ) : (
                            <span className="text-red-400">absent</span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {(s.competitors_present || []).slice(0, 3).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          visibility?.reason && <p className="text-sm mt-3 text-muted-foreground">{visibility.reason}</p>
        )}
      </div>

      {summary && summary.total > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary">{summary.total}</div>
            <div className="text-xs text-muted-foreground">Products audited</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400">{summary.averageScore}/100</div>
            <div className="text-xs text-muted-foreground">Average feed score</div>
          </div>
        </div>
      )}

      {products.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left p-3">Product</th>
                <th className="text-left p-3">Score</th>
                <th className="text-left p-3">Issues</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="p-3 max-w-sm">
                    <div className="truncate">{p.title || p.product_id}</div>
                    {expanded === p.id && p.optimized_title && (
                      <div className="mt-2 text-xs">
                        <span className="text-green-400">Optimized title: </span>
                        {p.optimized_title}
                      </div>
                    )}
                    {expanded === p.id && p.optimized_description && (
                      <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                        {p.optimized_description}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={
                        p.score >= 80 ? "text-green-400" : p.score >= 50 ? "text-amber-400" : "text-red-400"
                      }
                    >
                      {p.score}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {(p.issues || []).slice(0, 3).map((i) => i.field).join(", ") || "—"}
                    {(p.issues || []).length > 3 ? ` +${p.issues.length - 3}` : ""}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="text-primary text-xs"
                      onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                    >
                      {expanded === p.id ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
