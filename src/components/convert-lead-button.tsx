"use client";

import { useState } from "react";

export function ConvertLeadButton({ leadId, domain }: { leadId: string; domain: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function convert() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/leads/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Conversion failed");
      setLoading(false);
      return;
    }
    window.location.href = `/app/projects/${data.project.id}`;
  }

  return (
    <div>
      <button
        onClick={convert}
        disabled={loading}
        className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 disabled:opacity-50"
        title={`Create project for ${domain}`}
      >
        {loading ? "..." : "→ Project"}
      </button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
