"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  required: boolean;
  category: string;
}

interface DiyStack {
  serp: string | null;
  llmDirect: boolean;
  perplexity: boolean;
  firecrawl: boolean;
  dataForSeoOptional: boolean;
}

interface GoogleCloudCaps {
  keyConfigured: boolean;
  pagespeed: boolean;
  cruxHistory: boolean;
  youtube: boolean;
  knowledgeGraph: boolean;
  naturalLanguage: boolean;
}

export default function CapabilitiesSettingsPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [liveData, setLiveData] = useState(false);
  const [citationTracking, setCitationTracking] = useState(false);
  const [serpCapability, setSerpCapability] = useState(false);
  const [activeSerp, setActiveSerp] = useState<string | null>(null);
  const [diyStack, setDiyStack] = useState<DiyStack | null>(null);
  const [version, setVersion] = useState("");
  const [prodReady, setProdReady] = useState(false);
  const [prodScore, setProdScore] = useState(0);
  const [googleCloud, setGoogleCloud] = useState<GoogleCloudCaps | null>(null);

  useEffect(() => {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((d) => {
        setProviders(d.providers || []);
        setLiveData(d.liveData);
        setCitationTracking(d.citationTracking);
        setSerpCapability(d.serpCapability);
        setActiveSerp(d.activeSerpProvider);
        setDiyStack(d.diyStack);
        setVersion(d.version);
        setProdReady(d.production?.ready ?? false);
        setProdScore(d.production?.score ?? 0);
        const m = d.freeDataMoat100x;
        if (m) {
          setGoogleCloud({
            keyConfigured: Boolean(m.videoSeo),
            pagespeed: Boolean(d.freeSignals?.realUserCwv),
            cruxHistory: Boolean(m.cwvHistory),
            youtube: Boolean(m.videoSeo),
            knowledgeGraph: Boolean(m.googleKnowledgeGraph),
            naturalLanguage: Boolean(m.googleNaturalLanguage),
          });
        }
      });
  }, []);

  const configured = providers.filter((p) => p.configured).length;

  const stackItems = [
    { label: "SERP (Google rankings)", ok: serpCapability, detail: activeSerp ? `via ${activeSerp}` : "Add SERPER or BRAVE key" },
    { label: "Direct LLM visibility", ok: diyStack?.llmDirect, detail: "OpenAI / Anthropic / Google GenAI" },
    { label: "Perplexity citations", ok: diyStack?.perplexity, detail: "Real cited URLs in AI answers" },
    { label: "Site crawling", ok: diyStack?.firecrawl, detail: "Firecrawl for audits + content" },
    { label: "DataForSEO boost", ok: diyStack?.dataForSeoOptional, detail: "Optional — backlinks index + AI volume" },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Live Provider Status</h2>
      <p className="text-sm text-muted-foreground mb-6">
        OmniPresence Engine v{version} — {configured}/{providers.length} providers configured.
        Live data: <strong className={liveData ? "text-green-400" : "text-yellow-400"}>{liveData ? "ON" : "Demo fallback"}</strong>
        {" · "}
        Citation tracking: <strong className={citationTracking ? "text-green-400" : "text-yellow-400"}>{citationTracking ? "ON" : "OFF"}</strong>
        {" · "}
        Production: <strong className={prodReady ? "text-green-400" : "text-yellow-400"}>{prodReady ? "READY" : `${prodScore}%`}</strong>
      </p>

      <div className="mb-8 border border-border rounded-xl p-4 bg-card">
        <h3 className="font-semibold mb-3">DIY Stack (replaces DataForSEO)</h3>
        <div className="space-y-2">
          {stackItems.map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={item.ok ? "text-green-400" : "text-muted-foreground"}>
                  {item.ok ? "✓" : "○"}
                </span>
                <span>{item.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">{item.detail}</span>
            </div>
          ))}
        </div>
        {!liveData && (
          <p className="text-xs text-yellow-400 mt-4">
            Add at least one SERP key (Serper or Brave) plus one LLM key to enable live scans.
          </p>
        )}
        <Link href="/app/settings/setup" className="inline-block text-xs text-primary mt-3 hover:underline">
          Open production setup checklist →
        </Link>
      </div>

      {googleCloud && (
        <div className="mb-8 border border-border rounded-xl p-4 bg-card">
          <h3 className="font-semibold mb-1">Google Cloud stack</h3>
          <p className="text-xs text-muted-foreground mb-3">
            One key (<code>PAGESPEED_API_KEY</code>) powers PageSpeed, CrUX, YouTube, Knowledge Graph, and Natural Language.
          </p>
          <div className="space-y-2">
            {[
              { label: "API key configured", ok: googleCloud.keyConfigured, detail: "PAGESPEED_API_KEY on Vercel" },
              { label: "PageSpeed + CrUX field data", ok: googleCloud.pagespeed, detail: "Technical audits & scans" },
              { label: "CrUX History trends", ok: googleCloud.cruxHistory, detail: "CWV history panel" },
              { label: "YouTube video SEO", ok: googleCloud.youtube, detail: "Channel gaps vs competitors" },
              { label: "Knowledge Graph entities", ok: googleCloud.knowledgeGraph, detail: "Entity panel & gaps" },
              { label: "Natural Language QA", ok: googleCloud.naturalLanguage, detail: "Content score entities + tone" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={item.ok ? "text-green-400" : "text-muted-foreground"}>{item.ok ? "✓" : "○"}</span>
                  <span>{item.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3 rounded-lg border ${
              p.configured ? "border-green-500/30 bg-green-500/5" : "border-border bg-card"
            }`}
          >
            <div>
              <div className="font-medium text-sm">{p.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{p.category}</div>
            </div>
            <span className={`text-xs font-medium ${p.configured ? "text-green-400" : "text-muted-foreground"}`}>
              {p.configured ? "Connected" : p.required ? "Required" : "Optional"}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Set API keys in Vercel env or <code>.env.local</code>. Run <code>npm run wire:diy</code> to validate your stack locally.
      </p>
    </div>
  );
}
