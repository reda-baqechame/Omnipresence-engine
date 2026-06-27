"use client";

import { useState } from "react";

interface Rewrite {
  heading: string;
  answerFirst: string;
  supporting: string;
}
interface Faq {
  question: string;
  answer: string;
}
interface StructuralQC {
  score: number;
  passed: boolean;
  issues: string[];
}
interface StructuredDoc {
  markdown: string;
  jsonLd: Record<string, unknown>[];
  qc: StructuralQC;
}
interface RewriteResponse {
  url: string;
  rewrites: Rewrite[];
  suggestedFaqs: Faq[];
  structured?: StructuredDoc;
  source: "ai" | "unavailable";
  error?: string;
}

export function PassageRewriterPanel({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RewriteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  async function publish(platform: "wordpress" | "webflow") {
    setPublishing(true);
    try {
      const res = await fetch("/api/aeo/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url: url.trim() || undefined, publish: true, platform }),
      });
      const data = await res.json();
      alert(res.ok && data.published?.ok ? `Published to ${platform}.` : `Publish failed: ${data.error || "unknown"}`);
    } finally {
      setPublishing(false);
    }
  }

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/aeo/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url: url.trim() || undefined }),
      });
      const data = (await res.json()) as RewriteResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || "Rewrite failed");
      } else if (data.source === "unavailable") {
        setError(data.error || "Rewrite unavailable");
      } else {
        setResult(data);
      }
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-semibold mb-1">Answer-first passage rewriter</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Generate verbatim-quotable rewrites: a 40-80 word direct answer + a 120-180 word supporting block per section, plus FAQ pairs for schema. Leave the URL blank to use the homepage.
      </p>
      <div className="flex gap-2 mb-4">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourdomain.com/page (optional)"
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={run}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate rewrites"}
        </button>
      </div>

      {error && <p className="text-sm text-yellow-400">{error}</p>}

      {result && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Source page: {result.url}</p>
          {result.rewrites.map((r, i) => (
            <div key={i} className="border border-border rounded-lg p-4">
              <div className="font-medium text-sm mb-2">{r.heading}</div>
              <div className="text-xs text-muted-foreground mb-1">Answer-first lead</div>
              <p className="text-sm mb-3">{r.answerFirst}</p>
              <div className="text-xs text-muted-foreground mb-1">Supporting block</div>
              <p className="text-sm">{r.supporting}</p>
            </div>
          ))}

          {result.structured && (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">
                  Structural QC:{" "}
                  <span className={result.structured.qc.passed ? "text-green-400" : "text-yellow-400"}>
                    {result.structured.qc.score}/100 {result.structured.qc.passed ? "(pass)" : "(needs work)"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => publish("wordpress")}
                    disabled={publishing}
                    className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50"
                  >
                    Publish to WordPress
                  </button>
                  <button
                    onClick={() => publish("webflow")}
                    disabled={publishing}
                    className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-secondary disabled:opacity-50"
                  >
                    Publish to Webflow
                  </button>
                </div>
              </div>
              {result.structured.qc.issues.length > 0 && (
                <ul className="text-xs text-yellow-400 list-disc pl-4 space-y-0.5">
                  {result.structured.qc.issues.map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer">Assembled markdown + JSON-LD</summary>
                <pre className="text-xs bg-secondary p-3 rounded-lg overflow-auto max-h-72 mt-2">
                  {result.structured.markdown}
                  {"\n\n"}
                  {result.structured.jsonLd.map((b) => JSON.stringify(b, null, 2)).join("\n")}
                </pre>
              </details>
            </div>
          )}

          {result.suggestedFaqs.length > 0 && (
            <div className="border border-border rounded-lg p-4">
              <div className="font-medium text-sm mb-2">Suggested FAQs (for FAQPage schema)</div>
              <ul className="space-y-2">
                {result.suggestedFaqs.map((f, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{f.question}</span>
                    <br />
                    <span className="text-muted-foreground">{f.answer}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
