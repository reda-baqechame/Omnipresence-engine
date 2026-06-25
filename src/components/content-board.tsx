"use client";

import { useState } from "react";

const STATUSES = ["drafted", "approved", "published", "indexed", "getting_traffic", "needs_refresh"] as const;

interface ContentBoardProps {
  projectId: string;
  assets: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
  }>;
}

export function ContentBoard({ projectId, assets }: ContentBoardProps) {
  const [items, setItems] = useState(assets);
  const [generating, setGenerating] = useState(false);
  const [repurposing, setRepurposing] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("blog_post");
  const [message, setMessage] = useState("");

  async function generateContent() {
    if (!topic) return;
    setGenerating(true);
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, type, topic }),
    });
    const { asset } = await res.json();
    if (asset) setItems((prev) => [asset, ...prev]);
    setGenerating(false);
    setTopic("");
  }

  async function repurposeChain(assetId: string) {
    setRepurposing(assetId);
    setMessage("");
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "repurpose_chain", repurposeFrom: assetId }),
    });
    const data = await res.json();
    if (data.assets?.length) {
      setItems((prev) => [...data.assets, ...prev]);
      setMessage(`Created ${data.count} repurposed assets from hub content`);
    }
    setRepurposing(null);
  }

  async function updateStatus(assetId: string, status: string) {
    await fetch("/api/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, status }),
    });
    setItems((prev) => prev.map((a) => (a.id === assetId ? { ...a, status } : a)));
  }

  return (
    <div>
      <div className="bg-card border border-border rounded-xl p-4 mb-6">
        <h3 className="font-semibold mb-3">Generate Content</h3>
        <div className="flex gap-3 flex-wrap">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm">
            <option value="blog_post">Blog Post</option>
            <option value="service_page">Service Page</option>
            <option value="comparison_page">Comparison Page</option>
            <option value="faq_page">FAQ Page</option>
            <option value="linkedin_post">LinkedIn Post</option>
            <option value="youtube_script">YouTube Script</option>
            <option value="reddit_draft">Reddit Draft</option>
            <option value="podcast_script">Podcast Script</option>
          </select>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic or title"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button onClick={generateContent} disabled={generating}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>
        {message && <p className="text-sm text-muted-foreground mt-2">{message}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {STATUSES.map((status) => (
          <div key={status} className="bg-card border border-border rounded-xl p-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">{status.replace(/_/g, " ")}</h4>
            <div className="space-y-2">
              {items.filter((a) => a.status === status).map((asset) => (
                <div key={asset.id} className="bg-secondary rounded-lg p-2 text-xs">
                  <div className="font-medium truncate">{asset.title}</div>
                  <div className="text-muted-foreground">{asset.type}</div>
                  {["blog_post", "service_page", "case_study"].includes(asset.type) && (
                    <button
                      type="button"
                      onClick={() => repurposeChain(asset.id)}
                      disabled={repurposing === asset.id}
                      className="mt-1 text-primary hover:underline"
                    >
                      {repurposing === asset.id ? "Repurposing..." : "→ 8 formats"}
                    </button>
                  )}
                  {status !== "needs_refresh" && (
                    <select
                      value={asset.status}
                      onChange={(e) => updateStatus(asset.id, e.target.value)}
                      className="mt-1 w-full bg-background border border-input rounded text-xs p-1"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
