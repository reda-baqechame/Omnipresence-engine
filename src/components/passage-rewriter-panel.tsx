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
interface RewriteResponse {
  url: string;
  rewrites: Rewrite[];
  suggestedFaqs: Faq[];
  source: "ai" | "unavailable";
  error?: string;
}

export function PassageRewriterPanel({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RewriteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
