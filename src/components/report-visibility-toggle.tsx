"use client";

import { useState } from "react";
import { Globe, Lock, Loader2 } from "lucide-react";

interface ReportVisibilityToggleProps {
  projectId: string;
  reportId: string;
  initialIsPublic: boolean;
}

/**
 * Every report is created with the share link enabled by default (the
 * share_token itself is an unguessable 128-bit capability URL). This is the
 * only control that lets a user revoke that link after the fact — without
 * it, a report shared once (or leaked) stayed publicly downloadable forever
 * with no way to turn it off short of a direct database edit.
 */
export function ReportVisibilityToggle({ projectId, reportId, initialIsPublic }: ReportVisibilityToggleProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !isPublic;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/report/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Failed to update");
        return;
      }
      setIsPublic(next);
    } catch {
      setError("Failed to update");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        title={isPublic ? "Share link is public — click to make private" : "Share link is private — click to make public"}
        className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 transition disabled:opacity-50 ${
          isPublic
            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
            : "bg-secondary text-muted-foreground hover:bg-secondary/80"
        }`}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isPublic ? (
          <Globe className="h-3 w-3" />
        ) : (
          <Lock className="h-3 w-3" />
        )}
        {isPublic ? "Public link" : "Private"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
