"use client";

import { useState } from "react";

interface PseoPanelProps {
  projectId: string;
}

export function PseoPanel({ projectId }: PseoPanelProps) {
  const [name, setName] = useState("Location pages campaign");
  const [templateType, setTemplateType] = useState("location_page");
  const [servicesCsv, setServicesCsv] = useState("");
  const [locationsCsv, setLocationsCsv] = useState("");
  const [keywordsCsv, setKeywordsCsv] = useState("");
  const [seedFromKeywords, setSeedFromKeywords] = useState(true);
  const [preview, setPreview] = useState<Array<{ topic: string; url: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function runPreview() {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/pseo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        templateType,
        servicesCsv,
        locationsCsv,
        keywordsCsv: seedFromKeywords ? undefined : keywordsCsv,
        seedFromKeywords,
        previewOnly: true,
      }),
    });
    const data = await res.json();
    setPreview(data.preview || []);
    setMessage(`${data.total} pages in matrix (${data.estimated} estimated)`);
    setLoading(false);
  }

  async function launchCampaign() {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/pseo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        templateType,
        servicesCsv,
        locationsCsv,
        keywordsCsv: seedFromKeywords ? undefined : keywordsCsv,
        seedFromKeywords,
        generateContent: true,
        maxPages: 10,
      }),
    });
    const data = await res.json();
    setMessage(`Campaign created. Generated ${data.generated} draft pages (${data.specs} total specs).`);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-3">Programmatic SEO Campaign</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Expand services × locations into URL patterns and content drafts. CSV: one value per line or comma-separated.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name"
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value)}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="location_page">Location pages</option>
            <option value="service_page">Service pages</option>
            <option value="best_of_page">Best-of pages</option>
            <option value="comparison_page">Comparison pages</option>
          </select>
          <textarea
            value={servicesCsv}
            onChange={(e) => setServicesCsv(e.target.value)}
            placeholder="Services (CSV)&#10;emergency plumbing&#10;drain cleaning"
            rows={4}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
          />
          <textarea
            value={locationsCsv}
            onChange={(e) => setLocationsCsv(e.target.value)}
            placeholder="Locations (CSV)&#10;Montreal&#10;Laval"
            rows={4}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
          />
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm">
          <input
            type="checkbox"
            checked={seedFromKeywords}
            onChange={(e) => setSeedFromKeywords(e.target.checked)}
          />
          Seed keywords from live keyword research (Keywords tab)
        </label>
        {!seedFromKeywords && (
          <textarea
            value={keywordsCsv}
            onChange={(e) => setKeywordsCsv(e.target.value)}
            placeholder="Keywords (CSV) — optional override"
            rows={3}
            className="mt-2 w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono"
          />
        )}
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={runPreview}
            disabled={loading}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            Preview matrix
          </button>
          <button
            type="button"
            onClick={launchCampaign}
            disabled={loading}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Generate first 10 pages
          </button>
        </div>
        {message && <p className="text-sm text-muted-foreground mt-3">{message}</p>}
      </div>

      {preview.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-medium mb-2">Preview (first 20)</h4>
          <ul className="text-sm space-y-1 max-h-64 overflow-y-auto">
            {preview.map((p) => (
              <li key={p.url} className="truncate">
                <span className="text-muted-foreground">{p.url}</span> — {p.topic}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
