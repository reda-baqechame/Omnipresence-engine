"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, ArrowLeft } from "lucide-react";

type ToolId = "audit" | "robots" | "schema" | "llms" | "canonical" | "sitemap" | "citation" | "roi" | "fanout";

const TOOLS: Array<{ id: ToolId; name: string; desc: string }> = [
    { id: "audit", name: "AI Readiness Checker", desc: "Full technical + AI bot access audit" },
    { id: "fanout", name: "Query Fan-Out Tool", desc: "The sub-queries AI engines run for a prompt — and where you rank" },
    { id: "robots", name: "Robots.txt Checker", desc: "Verify AI crawlers can access your site" },
    { id: "schema", name: "Schema Validator", desc: "Check structured data on your homepage" },
    { id: "llms", name: "llms.txt Generator", desc: "Generate an llms.txt file for AI crawlers" },
    { id: "canonical", name: "Canonical Checker", desc: "Detect missing or mismatched canonical tags" },
    { id: "sitemap", name: "Sitemap Validator", desc: "Validate sitemap.xml reachability and URL count" },
    { id: "citation", name: "Citation Planner", desc: "AI citation prompts and surface priorities" },
    { id: "roi", name: "Organic ROI Calculator", desc: "Organic traffic value vs paid ad spend" },
];

export default function FreeToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolId>("audit");
  const [domain, setDomain] = useState("");
  const [brand, setBrand] = useState("");
  const [industry, setIndustry] = useState("");
  const [prompt, setPrompt] = useState("");
  const [adSpend, setAdSpend] = useState("2000");
  const [sessions, setSessions] = useState("500");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function runTool() {
    setLoading(true);
    setResult(null);

    const endpoints: Record<ToolId, string> = {
      audit: "/api/tools/audit",
      robots: "/api/tools/robots",
      schema: "/api/tools/schema",
      llms: "/api/tools/llms",
      canonical: "/api/tools/canonical",
      sitemap: "/api/tools/sitemap",
      citation: "/api/tools/citation-planner",
      roi: "/api/tools/roi",
      fanout: "/api/tools/fanout",
    };

    let body: Record<string, unknown> = { domain };
    if (activeTool === "fanout") {
      if (!prompt) {
        setLoading(false);
        return;
      }
      body = { prompt, domain: domain || undefined };
    } else if (activeTool === "citation") {
      if (!brand || !industry) {
        setLoading(false);
        return;
      }
      body = { brand, industry, location: domain || "United States" };
    } else if (activeTool === "roi") {
      body = {
        organicSessions: Number(sessions) || 0,
        monthlyAdSpend: Number(adSpend) || 0,
        industry: industry || undefined,
      };
    } else if (!domain) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(endpoints[activeTool], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult(await res.json());
    } catch {
      setResult({ error: "Request failed" });
    }
    setLoading(false);
  }

  const canRun =
    activeTool === "citation"
      ? Boolean(brand && industry)
      : activeTool === "roi"
        ? Boolean(sessions || adSpend)
        : activeTool === "fanout"
          ? Boolean(prompt)
          : Boolean(domain);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <Link href="/signup" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">
          Full Audit
        </Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <h1 className="text-4xl font-bold mb-4">Free AEO Tools</h1>
        <p className="text-muted-foreground mb-8">
          Test whether your brand is ready for ChatGPT, Perplexity, Google AI Overviews, and traditional search.
        </p>

        <div className="grid md:grid-cols-4 gap-3 mb-8">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { setActiveTool(tool.id); setResult(null); }}
              className={`text-left p-4 rounded-xl border transition ${
                activeTool === tool.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className="font-medium text-sm">{tool.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{tool.desc}</div>
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 mb-8 space-y-3">
          {activeTool === "fanout" ? (
            <div className="grid md:grid-cols-2 gap-3">
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='Prompt, e.g. "best CRM for small agencies"' className="bg-background border border-input rounded-lg px-3 py-2 text-sm" maxLength={300} />
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Your domain (optional — adds rank check)" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
            </div>
          ) : activeTool === "citation" ? (
            <div className="grid md:grid-cols-3 gap-3">
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Location (optional)" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
            </div>
          ) : activeTool === "roi" ? (
            <div className="grid md:grid-cols-3 gap-3">
              <input value={sessions} onChange={(e) => setSessions(e.target.value)} placeholder="Monthly organic sessions" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
              <input value={adSpend} onChange={(e) => setAdSpend(e.target.value)} placeholder="Monthly ad spend ($)" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (optional)" className="bg-background border border-input rounded-lg px-3 py-2 text-sm" />
            </div>
          ) : (
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Enter your domain (e.g. example.com)"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            onClick={runTool}
            disabled={loading || !canRun}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? "Running..." : "Run"}
          </button>
        </div>

        {result !== null && <ToolResult tool={activeTool} data={result} />}
      </div>
    </div>
  );
}

function ToolResult({ tool, data }: { tool: ToolId; data: Record<string, unknown> }) {
  const d = data;

  if (tool === "audit" && Array.isArray(d.findings)) {
    const findings = d.findings as Array<{ severity: string; category: string; title: string; description: string; fix_recommendation?: string }>;
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{findings.length} issues found</h2>
        {findings.map((f, i) => (
          <div key={i} className={`border-l-4 rounded-r-lg p-4 ${
            f.severity === "critical" ? "border-red-500 bg-red-500/5" :
            f.severity === "high" ? "border-orange-500 bg-orange-500/5" :
            "border-yellow-500 bg-yellow-500/5"
          }`}>
            <div className="text-xs font-semibold uppercase opacity-70">{f.severity} · {f.category}</div>
            <h3 className="font-semibold text-sm mt-1">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.description}</p>
            {f.fix_recommendation && <p className="text-sm mt-2"><span className="text-primary font-medium">Fix:</span> {f.fix_recommendation}</p>}
          </div>
        ))}
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "robots" && d.bots) {
    const bots = d.bots as Array<{ name: string; allowed: boolean }>;
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">AI Bot Access</h2>
        {bots.map((b) => (
          <div key={b.name} className={`flex justify-between p-3 rounded-lg ${b.allowed ? "bg-green-500/10" : "bg-red-500/10"}`}>
            <span>{b.name}</span>
            <span className={b.allowed ? "text-green-400" : "text-red-400"}>{b.allowed ? "Allowed" : "Blocked"}</span>
          </div>
        ))}
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "schema" && d.schemaTypes) {
    const types = d.schemaTypes as string[];
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Schema Markup</h2>
        {types.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {types.map((t) => <span key={t} className="bg-primary/10 text-primary px-3 py-1 rounded-lg text-sm">{t}</span>)}
          </div>
        ) : (
          <p className="text-muted-foreground">No structured data found. Add JSON-LD schema to help AI understand your business.</p>
        )}
        {Array.isArray(d.missing) && (d.missing as string[]).length > 0 && (
          <p className="text-sm text-muted-foreground">Recommended missing types: {(d.missing as string[]).join(", ")}</p>
        )}
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "llms" && d.content) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Generated llms.txt</h2>
        <pre className="bg-secondary rounded-xl p-4 text-sm overflow-x-auto whitespace-pre-wrap">{d.content as string}</pre>
        <p className="text-sm text-muted-foreground">Save this as /llms.txt on your domain root.</p>
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "canonical") {
    return (
      <div className="space-y-2 text-sm">
        <p>Canonical: <strong>{String(d.canonical || "none")}</strong></p>
        <p>Status: {String(d.issue)}</p>
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "sitemap") {
    return (
      <div className="space-y-2 text-sm">
        <p>Sitemap found: {d.found ? "yes" : "no"}</p>
        <p>URL count: {String(d.urlCount)}</p>
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "citation" && Array.isArray(d.prompts)) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Citation prompts</h2>
        <ul className="list-disc pl-5 text-sm space-y-1">
          {(d.prompts as string[]).map((p) => <li key={p}>{p}</li>)}
        </ul>
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "fanout" && Array.isArray(d.subqueries)) {
    const subs = d.subqueries as Array<{ subquery: string; position: number | null; retrievable: boolean | null }>;
    const hasRanks = subs.some((s) => s.retrievable !== null);
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">AI engines would fan this out into:</h2>
        <div className="space-y-2">
          {subs.map((s) => (
            <div key={s.subquery} className="flex items-center justify-between bg-secondary rounded-lg px-4 py-2.5 text-sm gap-3">
              <span>{s.subquery}</span>
              {hasRanks && (
                <span className={`text-xs shrink-0 ${s.retrievable ? "text-green-400" : "text-muted-foreground"}`}>
                  {s.position ? `#${s.position}${s.retrievable ? " — retrievable" : ""}` : "not in top results"}
                </span>
              )}
            </div>
          ))}
        </div>
        {hasRanks && typeof d.coverage === "number" && (
          <p className="text-sm">
            Retrieval coverage: <strong>{Math.round((d.coverage as number) * 100)}%</strong> of sub-queries rank your domain in the top 10 — that&apos;s where AI engines pull sources from.
          </p>
        )}
        <p className="text-xs text-muted-foreground">{String(d.methodology || "")}</p>
        <UpsellCTA />
      </div>
    );
  }

  if (tool === "roi" && d.totalOrganicValue !== undefined) {
    return (
      <div className="space-y-2 text-sm">
        <p>Total organic value: <strong>${Number(d.totalOrganicValue).toLocaleString()}</strong></p>
        <p>Replacement ratio: {Math.round(Number(d.replacementRatio) * 100)}%</p>
        <UpsellCTA />
      </div>
    );
  }

  return <p className="text-muted-foreground">No results.</p>;
}

function UpsellCTA() {
  return (
    <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 text-center mt-6">
      <p className="font-semibold mb-2">Want the full OmniPresence Score?</p>
      <p className="text-sm text-muted-foreground mb-4">AI visibility across every engine, competitor reveal, and verifiable receipts — no signup needed.</p>
      <Link href="/audit" className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium inline-block">
        Run Free Audit
      </Link>
    </div>
  );
}
