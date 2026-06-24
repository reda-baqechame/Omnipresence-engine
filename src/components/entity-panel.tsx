"use client";

import { useEffect, useState } from "react";

export function EntityPanel({ projectId }: { projectId: string }) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [wikidataDraft, setWikidataDraft] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/entity?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.profile));
  }, [projectId]);

  async function buildEntity() {
    setLoading(true);
    const res = await fetch("/api/entity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    setProfile(data.profile);
    setWikidataDraft(data.wikidataDraft || "");
    setLoading(false);
  }

  async function generateSchema() {
    await fetch("/api/schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    alert("Schema generated and saved to deployments.");
  }

  const sameAs = (profile?.same_as_map || {}) as Record<string, string>;
  const entityScore = (profile?.entity_score as number) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Entity & Knowledge Graph</h2>
          <p className="text-sm text-muted-foreground">
            Wikidata-first entity profile for AI citation and Knowledge Panel readiness
          </p>
        </div>
        <button
          onClick={buildEntity}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Building..." : "Build Entity Profile"}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-primary">{entityScore}</div>
          <div className="text-sm text-muted-foreground">Entity Score</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-3xl font-bold">{Object.keys(sameAs).length}</div>
          <div className="text-sm text-muted-foreground">sameAs Profiles</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-3xl font-bold">{profile?.knowledge_panel_ready ? "Yes" : "No"}</div>
          <div className="text-sm text-muted-foreground">Knowledge Panel Ready</div>
        </div>
      </div>

      {Object.keys(sameAs).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">sameAs Reconciliation Map</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(sameAs).map(([platform, url]) => (
              <div key={platform} className="flex justify-between gap-4">
                <span className="text-muted-foreground capitalize">{platform}</span>
                <a href={url} target="_blank" rel="noreferrer" className="text-primary truncate max-w-md">
                  {url}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Schema Deployment</h3>
          <button
            onClick={generateSchema}
            className="text-sm bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80"
          >
            Generate JSON-LD
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Generates Organization, WebSite, Article, and FAQPage schema with sameAs links.
        </p>
      </div>

      {wikidataDraft && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Wikidata Draft</h3>
          <pre className="text-xs bg-secondary p-4 rounded-lg overflow-auto max-h-64">{wikidataDraft}</pre>
        </div>
      )}

      {profile?.reconciliation_notes ? (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
          <strong>NAP issues:</strong> {String(profile.reconciliation_notes)}
        </div>
      ) : null}
    </div>
  );
}
