"use client";

import { useState } from "react";
import { ALL_INTELLIGENCE_SECTIONS, type IntelligenceReportSectionId } from "@/types/intelligence-report";

interface GenerateReportFormProps {
  projectId: string;
  canDeepReport: boolean;
}

export function GenerateReportForm({ projectId, canDeepReport }: GenerateReportFormProps) {
  const [reportType, setReportType] = useState<"standard" | "deep">("standard");
  const [sections, setSections] = useState<IntelligenceReportSectionId[]>([...ALL_INTELLIGENCE_SECTIONS]);
  const [loading, setLoading] = useState(false);

  function toggleSection(id: IntelligenceReportSectionId) {
    setSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_type: reportType,
          sections: reportType === "deep" ? sections : undefined,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else if (!res.ok) alert(data.error || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold">Generate Report</h3>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="reportType"
            checked={reportType === "standard"}
            onChange={() => setReportType("standard")}
          />
          <span>
            <strong>Standard</strong>
            <span className="block text-xs text-muted-foreground">Quick summary · sync generation</span>
          </span>
        </label>
        <label className={`flex items-center gap-2 ${canDeepReport ? "cursor-pointer" : "opacity-50"}`}>
          <input
            type="radio"
            name="reportType"
            checked={reportType === "deep"}
            disabled={!canDeepReport}
            onChange={() => setReportType("deep")}
          />
          <span>
            <strong>Deep Intelligence</strong>
            <span className="block text-xs text-muted-foreground">
              Full agency-grade report · all engines · PDF
            </span>
          </span>
        </label>
      </div>

      {reportType === "deep" && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {ALL_INTELLIGENCE_SECTIONS.map((id) => (
            <label key={id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sections.includes(id)}
                onChange={() => toggleSection(id)}
              />
              {id.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Generating…" : reportType === "deep" ? "Generate Deep Report" : "Generate Standard Report"}
      </button>
    </form>
  );
}
