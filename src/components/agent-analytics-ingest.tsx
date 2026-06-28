"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AgentAnalyticsIngest({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit() {
    if (!logs.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent-analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error || "Ingestion failed." });
      } else if (data.ingested === 0) {
        setResult({ ok: false, message: data.message || "No AI crawler hits found in those logs." });
      } else {
        setResult({
          ok: true,
          message: `Ingested ${data.ingested} AI crawler hit${data.ingested === 1 ? "" : "s"} from ${data.bots?.length || 0} bot${data.bots?.length === 1 ? "" : "s"}.`,
        });
        setLogs("");
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div>
        <h3 className="font-semibold">Feed your access logs</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Paste raw server or CDN access logs (Nginx/Apache combined, Cloudflare, Vercel). We classify locally and store
          only AI crawler hits — GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, and more. Human and
          generic-bot traffic is ignored.
        </p>
      </div>
      <textarea
        value={logs}
        onChange={(e) => setLogs(e.target.value)}
        placeholder={`1.2.3.4 - - [10/Oct/2026:13:55:36 +0000] "GET /pricing HTTP/1.1" 200 512 "-" "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"`}
        rows={6}
        className="w-full rounded-lg bg-background border border-border p-3 text-xs font-mono"
        title="Paste raw access-log lines"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !logs.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Ingesting…" : "Ingest logs"}
        </button>
        {result && (
          <span className={`text-sm ${result.ok ? "text-green-400" : "text-yellow-400"}`}>{result.message}</span>
        )}
      </div>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Or stream hits continuously (edge middleware)</summary>
        <p className="mt-2">
          Forward each request from your own edge/middleware to keep this live. Only AI-bot user-agents are stored:
        </p>
        <pre className="mt-2 rounded-lg bg-background border border-border p-3 text-xs font-mono overflow-x-auto">{`// In your site's middleware / server:
await fetch("${typeof window !== "undefined" ? window.location.origin : ""}/api/projects/${projectId}/agent-analytics", {
  method: "POST",
  headers: { "Content-Type": "application/json", /* your session cookie */ },
  body: JSON.stringify({
    hits: [{
      userAgent: req.headers["user-agent"],
      path: req.url,
      statusCode: res.statusCode,
      hitAt: new Date().toISOString(),
    }],
  }),
});`}</pre>
      </details>
    </div>
  );
}
