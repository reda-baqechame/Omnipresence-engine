"use client";

import { useEffect, useState } from "react";

interface Annotation {
  id: string;
  date: string;
  label: string;
  annotation_type: string;
}

const TYPE_STYLE: Record<string, string> = {
  publish: "bg-blue-500/15 text-blue-400",
  fix: "bg-green-500/15 text-green-400",
  campaign: "bg-purple-500/15 text-purple-400",
  algo_update: "bg-red-500/15 text-red-400",
  note: "bg-muted text-muted-foreground",
};

const TYPES = ["note", "publish", "fix", "campaign", "algo_update"];

export function AnnotationsBar({ projectId }: { projectId: string }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("publish");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch(`/api/annotations?projectId=${projectId}`);
    const data = await res.json();
    setAnnotations(data.annotations || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function add() {
    if (!label.trim()) return;
    setSaving(true);
    await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, label, date, annotationType: type }),
    });
    setLabel("");
    setSaving(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/annotations?id=${id}&projectId=${projectId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold mb-1">Annotations</h3>
      <p className="text-sm text-muted-foreground mb-3">
        Mark when you published, shipped a fix, or ran a campaign to correlate it with ranking movement.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Annotation date"
          className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Annotation type"
          className="bg-background border border-input rounded-lg px-3 py-2 text-sm capitalize"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Published comparison page"
          className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={saving || !label.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>

      {annotations.length > 0 && (
        <ul className="mt-4 space-y-2">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">{a.date}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${TYPE_STYLE[a.annotation_type] || TYPE_STYLE.note}`}>
                  {a.annotation_type.replace(/_/g, " ")}
                </span>
                <span>{a.label}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="text-muted-foreground hover:text-red-400 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
