"use client";

import { useState, useEffect } from "react";

interface Ga4PropertyPickerProps {
  projectId: string;
  currentPropertyId?: string;
}

export function Ga4PropertyPicker({ projectId, currentPropertyId }: Ga4PropertyPickerProps) {
  const [properties, setProperties] = useState<Array<{ id: string; displayName: string }>>([]);
  const [selected, setSelected] = useState(currentPropertyId || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/attribution/ga4-properties?projectId=${projectId}`);
      const data = await res.json();
      setProperties(data.properties || []);
      if (data.currentPropertyId) {
        setSelected(data.currentPropertyId);
      } else if (data.properties?.[0]?.id) {
        setSelected(data.properties[0].id);
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  async function saveProperty() {
    setSaving(true);
    await fetch("/api/attribution/ga4-properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, propertyId: selected }),
    });
    setSaved(true);
    setSaving(false);
  }

  if (loading) return null;
  if (properties.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-medium mb-2">GA4 Property</h3>
      <p className="text-sm text-muted-foreground mb-3">
        Select which Google Analytics property to sync for this project.
      </p>
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(e) => { setSelected(e.target.value); setSaved(false); }}
          className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <button
          onClick={saveProperty}
          disabled={saving || !selected}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {saved && <p className="text-xs text-green-400 mt-2">Property saved.</p>}
    </div>
  );
}
