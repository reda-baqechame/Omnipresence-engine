"use client";

import { useState } from "react";

interface LinkOrder {
  id: string;
  target_url: string;
  anchor_text: string;
  anchor_type: string;
  vendor_tier: string;
  estimated_dr: number;
  status: string;
  created_at: string;
}

export function LinkBuildingPanel({ projectId }: { projectId: string }) {
  const [orders, setOrders] = useState<LinkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(`/api/link-building?projectId=${projectId}`);
    const data = await res.json();
    setOrders(data.orders || []);
  }

  async function generateCampaign(tier: "growth" | "scale") {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/link-building", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, tier }),
    });
    const data = await res.json();
    setMessage(`Generated ${data.count || 0} draft orders (55% branded / 25% partial / 20% exact)`);
    await load();
    setLoading(false);
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/link-building", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Link Building Campaigns</h3>
          <p className="text-sm text-muted-foreground">
            Monthly vendor-ready orders from backlink gaps + keyword targets. Auto-generated on the 10th via cron.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="border border-border px-3 py-2 rounded text-sm">
            Refresh
          </button>
          <button
            type="button"
            onClick={() => generateCampaign("growth")}
            disabled={loading}
            className="bg-primary text-primary-foreground px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Generate (4 links)
          </button>
          <button
            type="button"
            onClick={() => generateCampaign("scale")}
            disabled={loading}
            className="border border-border px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            Scale (8 links)
          </button>
        </div>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No campaigns yet. Run backlink monitor first, then generate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left p-2">Anchor</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">DR</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 20).map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="p-2">
                    <div className="font-medium">{o.anchor_text}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-xs">{o.target_url}</div>
                  </td>
                  <td className="p-2 capitalize">{o.anchor_type}</td>
                  <td className="p-2">{o.estimated_dr}</td>
                  <td className="p-2">
                    <select
                      value={o.status}
                      onChange={(e) => updateStatus(o.id, e.target.value)}
                      className="bg-background border border-input rounded text-xs px-2 py-1"
                    >
                      <option value="draft">Draft</option>
                      <option value="ordered">Ordered</option>
                      <option value="live">Live</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
