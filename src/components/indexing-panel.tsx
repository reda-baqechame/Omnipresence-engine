"use client";

import { useState } from "react";

interface IndexingPanelProps {
  projectId: string;
  domain: string;
}

interface Submission {
  id: string;
  url: string;
  engine: string;
  status: string;
  submitted_at: string;
}

export function IndexingPanel({ projectId, domain }: IndexingPanelProps) {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  async function loadLog() {
    const res = await fetch(`/api/indexing?projectId=${projectId}`);
    const data = await res.json();
    setSubmissions(data.submissions || []);
  }

  async function submitBulk() {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/indexing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, urlsCsv: csv, engines: ["indexnow", "bing"] }),
    });
    const data = await res.json();
    setMessage(`Submitted ${data.submitted || 0} URLs (${data.failed || 0} failed)`);
    await loadLog();
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <h3 className="font-semibold">Bulk Indexing</h3>
      <p className="text-sm text-muted-foreground">
        Submit URLs to IndexNow + Bing for faster discovery on {domain}.
      </p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
        rows={5}
        className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submitBulk}
          disabled={loading || !csv.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Submit to IndexNow + Bing
        </button>
        <button type="button" onClick={loadLog} className="border border-border px-4 py-2 rounded-lg text-sm">
          View log
        </button>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {submissions.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left p-2">URL</th>
                <th className="text-left p-2">Engine</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {submissions.slice(0, 15).map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="p-2 truncate max-w-xs">{s.url}</td>
                  <td className="p-2">{s.engine}</td>
                  <td className="p-2">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
