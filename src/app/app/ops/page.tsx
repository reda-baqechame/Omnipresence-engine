"use client";

import { useEffect, useState } from "react";

interface OpsItem {
  id: string;
  title: string;
  action_type: string;
  status: string;
  risk_level: string;
  sla_due_at?: string;
  projects?: { name: string; domain: string };
}

export default function OpsConsolePage() {
  const [items, setItems] = useState<OpsItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/ops");
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateItem(id: string, status: string, execute = false) {
    await fetch("/api/ops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, execute }),
    });
    load();
  }

  if (loading) return <div className="p-8">Loading ops queue...</div>;

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">DFY Ops Console</h1>
      <p className="text-muted-foreground mb-8">
        Cross-client action queue — approve, reject, or bulk-execute fulfillment tasks
      </p>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">{item.title}</div>
              <div className="text-sm text-muted-foreground">
                {item.projects?.name} ({item.projects?.domain}) · {item.action_type} ·{" "}
                <span className={item.risk_level === "high" ? "text-red-400" : "text-green-400"}>
                  {item.risk_level} risk
                </span>
              </div>
              {item.sla_due_at && (
                <div className="text-xs text-muted-foreground">SLA: {new Date(item.sla_due_at).toLocaleString()}</div>
              )}
            </div>
            <div className="flex gap-2">
              {item.status === "pending" && (
                <>
                  <button
                    onClick={() => updateItem(item.id, "approved", true)}
                    className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs"
                  >
                    Approve & Run
                  </button>
                  <button
                    onClick={() => updateItem(item.id, "rejected")}
                    className="bg-secondary px-3 py-1.5 rounded-lg text-xs"
                  >
                    Reject
                  </button>
                </>
              )}
              {item.status === "approved" && (
                <button
                  onClick={() => updateItem(item.id, "approved", true)}
                  className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs"
                >
                  Execute
                </button>
              )}
              <span className="text-xs text-muted-foreground self-center">{item.status}</span>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">No pending ops actions. Actions auto-queue from scans and publishing.</p>
        )}
      </div>
    </div>
  );
}
