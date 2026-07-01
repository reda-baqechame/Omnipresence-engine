"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

interface Schedule {
  id: string;
  name: string;
  cadence: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface RunRow {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result_summary: Record<string, unknown>;
}

export function RankSchedulePanel({ projectId }: { projectId: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [keywordCount, setKeywordCount] = useState(0);
  const [cadence, setCadence] = useState<"daily" | "weekly">("weekly");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/rank-schedules?projectId=${projectId}`);
    const data = await res.json();
    setSchedules(data.schedules || []);
    setRuns(data.runs || []);
    setKeywordCount(data.keywordCount || 0);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/rank-schedules?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setSchedules(d.schedules || []);
        setRuns(d.runs || []);
        setKeywordCount(d.keywordCount || 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  async function ensureSchedule() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/rank-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, cadence, action: "ensure" }),
    });
    const data = await res.json();
    setMsg(data.message || (res.ok ? "Schedule saved" : data.error));
    await load();
    setBusy(false);
  }

  async function runNow() {
    setBusy(true);
    const res = await fetch("/api/rank-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "run_now" }),
    });
    const data = await res.json();
    setMsg(data.message || `Checked ${data.keywordsChecked ?? 0} keywords`);
    await load();
    setBusy(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Rank schedules</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Automated rank checks via Inngest daily cron. Create a schedule to track all keywords on a cadence.
        {keywordCount > 0 ? ` · ${keywordCount} keywords on schedule` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as "daily" | "weekly")}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={ensureSchedule}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Save schedule
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={runNow}
          className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Run now
        </button>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {schedules.length > 0 && (
        <ul className="text-xs space-y-1">
          {schedules.map((s) => (
            <li key={s.id} className="text-muted-foreground">
              {s.name} · {s.cadence} · {s.is_active ? "active" : "paused"}
              {s.next_run_at ? ` · next ${new Date(s.next_run_at).toLocaleString()}` : ""}
            </li>
          ))}
        </ul>
      )}
      {runs.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Last run: {runs[0].status} ·{" "}
          {typeof runs[0].result_summary?.keywords_checked === "number"
            ? `${runs[0].result_summary.keywords_checked} keywords`
            : ""}
        </p>
      )}
    </div>
  );
}
