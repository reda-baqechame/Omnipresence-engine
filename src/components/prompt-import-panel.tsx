"use client";

import { useState } from "react";

interface PromptImportPanelProps {
  projectId: string;
}

export function PromptImportPanel({ projectId }: PromptImportPanelProps) {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function importCsv() {
    if (!csv.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, csv }),
    });
    const data = await res.json();
    setResult(res.ok ? `Imported ${data.imported} prompts` : data.error || "Import failed");
    setLoading(false);
    if (res.ok) setCsv("");
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Import Prompts (CSV)</h3>
        <p className="text-sm text-muted-foreground">
          One prompt per line: <code className="text-xs">text,category,priority</code>. Header row optional.
        </p>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"best plumber in Austin,local,80\nhow to choose a plumber,solution_aware,60"}
        rows={4}
        className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
      />
      <button
        type="button"
        onClick={importCsv}
        disabled={loading || !csv.trim()}
        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
      >
        {loading ? "Importing..." : "Import prompts"}
      </button>
      {result && (
        <p className={`text-sm ${result.startsWith("Imported") ? "text-green-400" : "text-red-400"}`}>
          {result}
        </p>
      )}
    </div>
  );
}
