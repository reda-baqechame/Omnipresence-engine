"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface ExportReportButtonProps {
  projectId: string;
}

/**
 * Header-level quick export. POSTs to the report-generate API (JSON) and
 * navigates to the resulting report URL, instead of a raw HTML <form> POST
 * that dumped the route's JSON response straight into the browser.
 */
export function ExportReportButton({ projectId }: ExportReportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_type: "standard" }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Failed to generate report");
    } catch {
      setError("Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm flex items-center gap-1 hover:opacity-90 transition disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Generating…" : "Export Report"}
      </button>
      {error && <p className="text-xs text-red-400 max-w-[220px] text-right">{error}</p>}
    </div>
  );
}
