"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RefreshCw, Plus, Wand2, CheckCircle2 } from "lucide-react";
import type { ExecutionTask, ExecutionTaskStatus, TaskPriority } from "@/types/database";

const COLUMNS: { key: ExecutionTaskStatus; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
  { key: "verified", label: "Verified" },
];

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: "text-red-400 bg-red-500/10",
  high: "text-orange-400 bg-orange-500/10",
  medium: "text-yellow-400 bg-yellow-500/10",
  low: "text-blue-400 bg-blue-500/10",
};

const NEXT_STATUS: Partial<Record<ExecutionTaskStatus, ExecutionTaskStatus>> = {
  todo: "in_progress",
  in_progress: "done",
  blocked: "in_progress",
};

function isSearchOpsTask(task: ExecutionTask): boolean {
  return (
    task.source_module === "searchops_opportunity" ||
    Boolean((task.evidence as { searchops_opportunity_id?: string } | null)?.searchops_opportunity_id)
  );
}

/** Maps a task to the generator surface that can produce its fix. */
function fixHref(projectId: string, task: ExecutionTask): string | null {
  const base = `/app/projects/${projectId}`;
  const cat = (task.category || "").toLowerCase();
  switch (task.source_module) {
    case "content_gap":
      return `${base}/content`;
    case "keyword_opportunity":
      return `${base}/keywords`;
    case "coverage_gap":
      return `${base}/coverage`;
    case "authority":
      return `${base}/authority`;
    case "searchops_opportunity":
      if (cat.includes("gsc") || cat.includes("serp")) return `${base}/gsc`;
      if (cat.includes("ai")) return `${base}/ai-visibility`;
      if (cat.includes("authority")) return `${base}/authority`;
      if (cat.includes("technical")) return `${base}/technical`;
      return `${base}/opportunities`;
    case "technical_finding":
      if (cat.includes("schema") || cat.includes("entity")) return `${base}/entity`;
      if (cat.includes("content")) return `${base}/content`;
      return `${base}/technical`;
    case "roadmap":
      if (cat.includes("content")) return `${base}/content`;
      if (cat.includes("local") || cat.includes("directory") || cat.includes("social")) return `${base}/coverage`;
      if (cat.includes("authority")) return `${base}/authority`;
      return `${base}/technical`;
    default:
      return null;
  }
}

export function TasksBoard({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tasks?projectId=${projectId}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
    }
    setLoading(false);
  }, [projectId]);

  async function searchOpsAction(
    taskId: string,
    action: "ready_for_verification" | "verify" | "auto_verify",
    afterMetric?: Record<string, unknown> | null
  ) {
    setBusy(true);
    setVerifyNote(null);
    try {
      const res = await fetch("/api/searchops/verify-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskId,
          action,
          afterMetric: afterMetric ?? null,
          unavailableReason:
            action === "verify" && afterMetric == null
              ? "Operator marked verification without measured after metric — unavailable, not success."
              : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setVerifyNote(json.error || "Verification action failed");
        return;
      }
      if (json.status === "verification_unavailable") {
        setVerifyNote(json.reason || "Verification unavailable — not recorded as success.");
      } else if (json.status === "verified") {
        setVerifyNote(
          json.autoResolved
            ? "Auto-verified from stored snapshots with proof ledger entry."
            : "Verified with before/after metrics and proof ledger entry."
        );
      } else if (json.status === "ready_for_verification") {
        setVerifyNote("Marked ready for verification (status: done). Add measured after metrics to verify.");
      }
      await load();
    } catch {
      setVerifyNote("Verification action failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/tasks?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((data) => {
        if (active) setTasks(data.tasks || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function sync() {
    setBusy(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "sync" }),
    });
    await load();
    setBusy(false);
  }

  async function updateStatus(id: string, status: ExecutionTaskStatus) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function addTask() {
    if (!newTitle.trim()) return;
    setBusy(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: newTitle.trim() }),
    });
    setNewTitle("");
    await load();
    setBusy(false);
  }

  const counts = COLUMNS.reduce(
    (acc, c) => ({ ...acc, [c.key]: tasks.filter((t) => t.status === c.key).length }),
    {} as Record<string, number>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={sync}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync from scan
        </button>
        <div className="flex items-center gap-1.5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Add a custom task…"
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm w-56"
          />
          <button
            onClick={addTask}
            disabled={busy || !newTitle.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          No tasks yet. Click <strong>Sync from scan</strong> to turn your findings, gaps, and roadmap into tracked actions.
        </div>
      ) : (
        <>
          {verifyNote && <p className="text-xs text-muted-foreground">{verifyNote}</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {COLUMNS.map((col) => (
              <div key={col.key} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <span className="text-xs text-muted-foreground">{counts[col.key] || 0}</span>
                </div>
                <div className="space-y-2">
                  {tasks
                    .filter((t) => t.status === col.key)
                    .map((t) => {
                      const href = fixHref(projectId, t);
                      const next = NEXT_STATUS[t.status];
                      const searchOps = isSearchOpsTask(t);
                      const oppId = (t.evidence as { searchops_opportunity_id?: string } | null)
                        ?.searchops_opportunity_id;
                      const resultOutcome = (t.result_metric as { outcome?: string } | null)?.outcome;
                      return (
                        <div key={t.id} className="bg-card border border-border rounded-xl p-3 space-y-2">
                          <div className="flex items-start gap-2 flex-wrap">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLOR[t.priority]}`}
                            >
                              {t.priority}
                            </span>
                            {searchOps && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">
                                searchops
                              </span>
                            )}
                            {t.status === "verified" && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 ml-auto" />
                            )}
                          </div>
                          <p className="text-sm font-medium leading-snug">{t.title}</p>
                          {t.description && (
                            <p className="text-xs text-muted-foreground line-clamp-3">{t.description}</p>
                          )}
                          {oppId && (
                            <p className="text-[11px] text-muted-foreground">
                              Opportunity: <span className="font-mono">{oppId}</span>
                            </p>
                          )}
                          {resultOutcome === "verification_unavailable" && (
                            <p className="text-[11px] text-yellow-500/90">
                              Verification unavailable — not recorded as success or no-impact.
                            </p>
                          )}
                          {t.status === "verified" && t.after_metric && t.before_metric && (
                            <p className="text-[11px] text-green-400">
                              Before/after recorded
                              {(t.before_metric as { omnipresence_score?: number }).omnipresence_score !=
                                null && (
                                <>
                                  {" "}
                                  · score{" "}
                                  {(t.before_metric as { omnipresence_score?: number }).omnipresence_score} →{" "}
                                  {(t.after_metric as { omnipresence_score?: number }).omnipresence_score ??
                                    "—"}
                                </>
                              )}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {href && t.status !== "verified" && (
                              <Link
                                href={href}
                                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                              >
                                <Wand2 className="h-3 w-3" /> Generate fix
                              </Link>
                            )}
                            {searchOps && (t.status === "todo" || t.status === "in_progress") && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void searchOpsAction(t.id, "ready_for_verification")}
                                className="text-[11px] text-primary hover:underline disabled:opacity-50"
                              >
                                Ready for verification
                              </button>
                            )}
                            {searchOps && t.status === "done" && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void searchOpsAction(t.id, "auto_verify")}
                                  className="text-[11px] text-primary hover:underline disabled:opacity-50"
                                >
                                  Auto-verify from snapshots
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    const raw = window.prompt(
                                      "Paste measured after_metric JSON (must include status: \"measured\" or a numeric value). Cancel if unavailable."
                                    );
                                    if (raw == null) return;
                                    try {
                                      const parsed = JSON.parse(raw) as Record<string, unknown>;
                                      void searchOpsAction(t.id, "verify", parsed);
                                    } catch {
                                      setVerifyNote("After metric must be valid JSON.");
                                    }
                                  }}
                                  className="text-[11px] text-primary hover:underline disabled:opacity-50"
                                >
                                  Verify with measured after JSON
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void searchOpsAction(t.id, "verify", null)}
                                  className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                                >
                                  Mark verification unavailable
                                </button>
                              </>
                            )}
                            {next && !searchOps && (
                              <button
                                onClick={() => updateStatus(t.id, next)}
                                className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
                              >
                                → {next.replace("_", " ")}
                              </button>
                            )}
                            {next && searchOps && t.status !== "done" && (
                              <button
                                onClick={() => updateStatus(t.id, next)}
                                className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
                              >
                                → {next.replace("_", " ")}
                              </button>
                            )}
                            {searchOps && (
                              <Link
                                href={`/app/projects/${projectId}/proof-ledger`}
                                className="text-[11px] text-primary hover:underline"
                              >
                                Proof ledger
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
