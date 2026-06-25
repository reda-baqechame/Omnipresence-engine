"use client";

import { useEffect, useState } from "react";

const CMS_PROVIDERS = [
  { id: "wordpress", label: "WordPress", urlPlaceholder: "https://yoursite.com", extraLabel: "Collection/Blog ID (optional)" },
  { id: "webflow", label: "Webflow", urlPlaceholder: "Site ID (optional)", extraLabel: "Collection ID (required)" },
  { id: "shopify", label: "Shopify", urlPlaceholder: "your-store.myshopify.com", extraLabel: "Blog ID (default: news)" },
] as const;

interface SavedIntegration {
  id: string;
  provider: string;
  is_active: boolean;
  updated_at: string;
}

interface IntegrationsPanelProps {
  projectId: string;
}

export function IntegrationsPanel({ projectId }: IntegrationsPanelProps) {
  const [saved, setSaved] = useState<SavedIntegration[]>([]);
  const [provider, setProvider] = useState<string>("wordpress");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const meta = CMS_PROVIDERS.find((p) => p.id === provider) || CMS_PROVIDERS[0];

  async function load() {
    const res = await fetch(`/api/integrations?projectId=${projectId}`);
    const data = await res.json();
    setSaved(data.integrations || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/integrations?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (active) setSaved(data.integrations || []);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function saveIntegration() {
    if (!apiKey.trim()) {
      setStatus("API key is required");
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          provider,
          credentials: {
            url,
            shop: provider === "shopify" ? url : undefined,
            siteId: provider === "webflow" ? url : undefined,
            apiKey,
            collectionId: collectionId || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Failed to save integration");
      } else {
        setStatus(`${meta.label} credentials saved securely`);
        setApiKey("");
        await load();
      }
    } catch {
      setStatus("Network error saving integration");
    }
    setLoading(false);
  }

  async function removeIntegration(p: string) {
    setLoading(true);
    await fetch(`/api/integrations?projectId=${projectId}&provider=${p}`, { method: "DELETE" });
    await load();
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div>
        <h3 className="font-semibold">Saved CMS Integrations</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Store encrypted credentials for auto-publish and scheduled content. Requires{" "}
          <code className="text-xs">INTEGRATION_ENCRYPTION_KEY</code> in production.
        </p>
      </div>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {saved.map((i) => (
            <span
              key={i.id}
              className="inline-flex items-center gap-2 text-xs bg-secondary px-3 py-1.5 rounded-full"
            >
              {i.provider} · updated {new Date(i.updated_at).toLocaleDateString()}
              <button
                type="button"
                onClick={() => removeIntegration(i.provider)}
                className="text-muted-foreground hover:text-red-400"
                disabled={loading}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
        >
          {CMS_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={meta.urlPlaceholder}
          className="flex-1 min-w-[180px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key / app password"
          type="password"
          className="flex-1 min-w-[180px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          placeholder={meta.extraLabel}
          className="flex-1 min-w-[160px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={saveIntegration}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save integration"}
        </button>
      </div>

      {status && (
        <p className={`text-sm ${status.includes("saved") ? "text-green-400" : "text-red-400"}`}>
          {status}
        </p>
      )}
    </div>
  );
}
