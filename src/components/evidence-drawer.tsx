"use client";

import { useCallback, useState } from "react";
import { FileSearch, X, Loader2 } from "lucide-react";

export interface EvidenceDrawerProps {
  projectId: string;
  capability: string;
  target: string;
  label?: string;
  className?: string;
}

interface MeasurementRow {
  id: string;
  capability: string;
  target: string;
  provider: string | null;
  source_url: string | null;
  parser_version: string | null;
  data_source: string;
  confidence: number | null;
  response_hash: string;
  payload_excerpt: Record<string, unknown>;
  evidence_url: string | null;
  created_at: string;
}

interface AiCaptureRow {
  id: string;
  engine: string;
  prompt: string;
  response_hash: string;
  cited_urls: string[];
  source_domains: string[];
  evidence_url: string | null;
  created_at: string;
}

/**
 * Shared "View Proof" drawer: fetches measurement_evidence + ai_capture_evidence
 * for a capability/target and shows tamper-evident hashes + excerpts.
 */
export function EvidenceDrawer({ projectId, capability, target, label = "View proof", className }: EvidenceDrawerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [measurement, setMeasurement] = useState<MeasurementRow[]>([]);
  const [aiCapture, setAiCapture] = useState<AiCaptureRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ projectId, capability, target, limit: "15" });
      const res = await fetch(`/api/evidence?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load evidence");
      setMeasurement(data.measurement || []);
      setAiCapture(data.aiCapture || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId, capability, target]);

  function handleOpen() {
    setOpen(true);
    void load();
  }

  const total = measurement.length + aiCapture.length;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center gap-1 text-xs text-primary hover:underline ${className ?? ""}`}
        title="View measurement evidence"
      >
        <FileSearch className="h-3 w-3" />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="font-semibold text-sm">Measurement evidence</h3>
                <p className="text-xs text-muted-foreground capitalize">
                  {capability.replace(/_/g, " ")} · {target}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
              {!loading && !error && total === 0 && (
                <p className="text-sm text-muted-foreground">No evidence rows yet. Run a scan that measures this metric.</p>
              )}

              {measurement.map((row) => (
                <div key={row.id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium capitalize">{row.data_source}</span>
                    <span className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                  {row.provider && <p className="text-muted-foreground">Provider: {row.provider}</p>}
                  <p className="font-mono text-[10px] break-all text-muted-foreground">sha256:{row.response_hash.slice(0, 16)}…</p>
                  {Object.keys(row.payload_excerpt || {}).length > 0 && (
                    <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                      {JSON.stringify(row.payload_excerpt, null, 2)}
                    </pre>
                  )}
                  {row.evidence_url && (
                    <p className="text-muted-foreground truncate" title={row.evidence_url}>
                      Artifact: {row.evidence_url}
                    </p>
                  )}
                </div>
              ))}

              {aiCapture.map((row) => (
                <div key={row.id} className="rounded-lg border border-border p-3 text-xs space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{row.engine}</span>
                    <span className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{row.prompt}</p>
                  <p className="font-mono text-[10px] break-all text-muted-foreground">sha256:{row.response_hash.slice(0, 16)}…</p>
                  {row.cited_urls?.length > 0 && (
                    <p className="text-muted-foreground">{row.cited_urls.length} cited URL(s)</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
