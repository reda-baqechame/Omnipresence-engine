"use client";

import { useEffect, useState } from "react";
import { PanelError } from "@/components/panel-states";

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
  const [gapsLoading, setGapsLoading] = useState(false);
  const [gaps, setGaps] = useState<{
    googleKgConfigured: boolean;
    brand: { name: string; inWikidata: boolean; inGoogleKg: boolean; inWikipedia: boolean; inDbpedia: boolean };
    competitors: Array<{ name: string; inWikidata: boolean; inGoogleKg: boolean; inWikipedia: boolean; inDbpedia: boolean }>;
    gaps: string[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/entity?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setProfile(d.profile))
      .catch(() => setLoadError("Couldn't load entity data. Check your connection and reload."));
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

  async function detectGaps() {
    setGapsLoading(true);
    const res = await fetch("/api/entity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "entity_gaps" }),
    });
    setGaps(await res.json());
    setGapsLoading(false);
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
      {loadError && <PanelError title="Entity data unavailable" message={loadError} />}
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

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">Entity gaps vs competitors</h3>
            <p className="text-xs text-muted-foreground">Knowledge-graph presence across Wikidata, Google KG, Wikipedia, DBpedia.</p>
          </div>
          <button
            onClick={detectGaps}
            disabled={gapsLoading}
            className="text-sm bg-secondary px-3 py-1.5 rounded-lg hover:bg-secondary/80 disabled:opacity-50"
          >
            {gapsLoading ? "Probing…" : "Detect gaps"}
          </button>
        </div>
        {gaps && (
          <div className="space-y-3 text-sm">
            {!gaps.googleKgConfigured && (
              <p className="text-xs text-muted-foreground">Uses your Google Cloud API key (<code>PAGESPEED_API_KEY</code>) with Knowledge Graph Search API enabled.</p>
            )}
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left p-1.5">Entity</th>
                    <th className="p-1.5">Wikidata</th>
                    <th className="p-1.5">Google KG</th>
                    <th className="p-1.5">Wikipedia</th>
                    <th className="p-1.5">DBpedia</th>
                  </tr>
                </thead>
                <tbody>
                  {[{ ...gaps.brand, isBrand: true }, ...gaps.competitors.map((c) => ({ ...c, isBrand: false }))].map((e) => (
                    <tr key={e.name} className="border-t border-border/50">
                      <td className="p-1.5">{e.name} {e.isBrand && <span className="text-primary">(you)</span>}</td>
                      {(["inWikidata", "inGoogleKg", "inWikipedia", "inDbpedia"] as const).map((k) => (
                        <td key={k} className={`p-1.5 text-center ${e[k] ? "text-green-400" : "text-red-400"}`}>{e[k] ? "✓" : "✗"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gaps.gaps.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1 text-yellow-400">
                {gaps.gaps.map((g) => <li key={g}>{g}</li>)}
              </ul>
            ) : (
              <p className="text-green-400">No entity gaps — you match or lead competitors across knowledge graphs.</p>
            )}
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
