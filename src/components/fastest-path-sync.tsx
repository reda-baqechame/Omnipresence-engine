"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ListChecks } from "lucide-react";

export function FastestPathSync({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/fastest-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        setMsg("Could not create tasks");
        return;
      }
      const data = (await res.json()) as { created?: number; plan?: unknown[] };
      const created = typeof data.created === "number" ? data.created : (data.plan?.length ?? 0);
      setMsg(`Synced ${created} task${created === 1 ? "" : "s"} to your execution queue`);
      router.refresh();
    } catch {
      setMsg("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={sync}
        disabled={loading || disabled}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
        Create execution tasks
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
