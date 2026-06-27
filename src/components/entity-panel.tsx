"use client";

import { useEffect, useState } from "react";

interface NapFinding {
  field: string;
  expected: string;
  found?: string;
  url?: string;
  severity: string;
}

export function EntityPanel({ projectId }: { projectId: string }) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [wikidataDraft, setWikidataDraft] = useState("");
  const [sameAsJsonLd, setSameAsJsonLd] = useState("");
  const [schemaSnippet, setSchemaSnippet] = useState("");
  const [napFindings, setNapFindings] = useState<NapFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [napLoading, setNapLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/entity?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.profile));
  }, [projectId]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

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
    setSameAsJsonLd(data.sameAsJsonLd || "");
    setLoading(false);
  }

  async function checkNap() {
    setNapLoading(true);
    const res = await fetch(`/api/entity?projectId=${projectId}&checkNap=1`);
    const data = await res.json();
    setNapFindings(data.findings || []);
    setNapLoading(false);
  }

  async function generateSchema() {
    setSchemaLoading(true);
    const res = await fetch("/api/schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    setSchemaSnippet(data.schema?.htmlSnippet || "");
    setSchemaLoading(false);
  }

  async function deploySchema(platform: "wordpress" | "webflow") {
    if (!schemaSnippet) return;
    const res = await fetch("/api/schema/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, platform, htmlSnippet: schemaSnippet }),
    });
    const data = await res.json();
    alert(data.ok ? `Deployed to ${platform}.` : `Deploy failed: ${data.error || "unknown"}`);
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
          <h3 className="font-semibold">NAP Consistency</h3>
          <button
            onClick={checkNap}
            disabled={napLoading}
            className="text-sm bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80 disabled:opacity-50"
          >
            {napLoading ? "Scanning..." : "Check NAP"}
          </button>
        </div>
        {napFindings.length > 0 ? (
          <ul className="text-sm space-y-2">
            {napFindings.map((f, i) => (
              <li key={i} className="text-yellow-400">
                {f.field}: expected &quot;{f.expected}&quot;
                {f.found && ` — found "${f.found}"`}
                {f.url && <span className="text-muted-foreground"> on {f.url}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Scan homepage for name, address, and phone mismatches vs brand profile.
          </p>
        )}
      </div>

      {sameAsJsonLd && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Copyable sameAs JSON-LD</h3>
            <button
              onClick={() => copy(sameAsJsonLd, "sameas")}
              className="text-sm bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80"
            >
              {copied === "sameas" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="text-xs bg-secondary p-4 rounded-lg overflow-auto max-h-64">{sameAsJsonLd}</pre>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Schema Deployment</h3>
          <button
            onClick={generateSchema}
            disabled={schemaLoading}
            className="text-sm bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80 disabled:opacity-50"
          >
            {schemaLoading ? "Generating..." : "Generate JSON-LD"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Generates Organization (with reconciled sameAs + Wikidata ID), WebSite, Article, Person,
          and FAQPage schema.
        </p>

        {schemaSnippet && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Generated JSON-LD</span>
              <div className="flex gap-2">
                <button
                  onClick={() => copy(schemaSnippet, "schema")}
                  className="text-xs bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80"
                >
                  {copied === "schema" ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => deploySchema("wordpress")}
                  className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-secondary"
                >
                  Deploy to WordPress
                </button>
                <button
                  onClick={() => deploySchema("webflow")}
                  className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-secondary"
                >
                  Deploy to Webflow
                </button>
              </div>
            </div>
            <pre className="text-xs bg-secondary p-4 rounded-lg overflow-auto max-h-64">{schemaSnippet}</pre>
            <p className="text-xs text-muted-foreground">
              Deploy uses your connected CMS credentials. Paste the snippet manually if you publish elsewhere.
            </p>
          </div>
        )}
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
