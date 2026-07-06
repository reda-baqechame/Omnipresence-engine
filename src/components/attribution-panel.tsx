"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import type { AttributionMetric } from "@/types/database";
import { Ga4PropertyPicker } from "@/components/ga4-property-picker";
import { AdsEquivalentPanel } from "@/components/ads-equivalent";
import { ProjectionBadge } from "@/components/projection-badge";
import { LlmReferralChart } from "@/components/llm-referral-chart";
import { VisitorIdentityPanel } from "@/components/visitor-identity-panel";
import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

interface VisitorSession {
  id: string;
  company_name?: string | null;
  company_domain?: string | null;
  industry?: string | null;
  referrer_source?: string | null;
  landing_path?: string | null;
  enriched: boolean;
  created_at: string;
}

interface AttributionPanelProps {
  projectId: string;
  domain: string;
  industry?: string;
  monthlyAdSpend?: number;
  metrics: AttributionMetric[];
  hasGscConnection: boolean;
  hasBingConnection: boolean;
  hasGa4Connection: boolean;
  hasPlausibleConnection: boolean;
  ga4PropertyId?: string;
  plausibleSiteId?: string;
}

export function AttributionPanel({
  projectId,
  domain,
  industry,
  monthlyAdSpend,
  metrics,
  hasGscConnection,
  hasBingConnection,
  hasGa4Connection,
  hasPlausibleConnection,
  ga4PropertyId,
  plausibleSiteId,
}: AttributionPanelProps) {
  const [plausibleSite, setPlausibleSite] = useState(plausibleSiteId || domain);
  const [plausibleApiKey, setPlausibleApiKey] = useState("");
  const [connectingPlausible, setConnectingPlausible] = useState(false);
  const [referrals, setReferrals] = useState<Array<{ source: string; count: number }>>([]);
  const [sessions, setSessions] = useState<VisitorSession[]>([]);
  const current = metrics[0];
  const previous = metrics[1];

  useEffect(() => {
    fetch(`/api/attribution/referrals?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setReferrals(d.referrals || []));
    fetch(`/api/visitors?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []));
  }, [projectId]);

  async function connectPlausible() {
    if (!plausibleApiKey.trim()) return;
    setConnectingPlausible(true);
    const res = await fetch("/api/attribution/plausible", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, siteId: plausibleSite, apiKey: plausibleApiKey }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      setConnectingPlausible(false);
    }
  }

  async function syncAttribution() {
    await fetch("/api/attribution/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    window.location.reload();
  }

  function delta(key: keyof AttributionMetric): { change: number; percent: number } | null {
    if (!current || !previous) return null;
    const curr = current[key] as number;
    const prev = previous[key] as number;
    if (typeof curr !== "number" || typeof prev !== "number") return null;
    const change = curr - prev;
    const percent = prev > 0 ? (change / prev) * 100 : curr > 0 ? 100 : 0;
    return { change, percent };
  }

  return (
    <div className="space-y-8">
      <CapabilityEvidenceBar
        projectId={projectId}
        capability="attribution"
        target=""
        label="Attribution proof"
        quality={hasGa4Connection || hasGscConnection ? "measured" : "unavailable"}
      />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Traffic Attribution</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Prove ROI — organic traffic, AI referrals, leads, and paid-ads-equivalent value.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!hasGscConnection && (
            <a
              href={`/api/oauth?provider=google_search_console&projectId=${projectId}`}
              className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary transition"
            >
              Connect Google Search Console
            </a>
          )}
          {!hasBingConnection && (
            <a
              href={`/api/oauth?provider=bing_webmaster&projectId=${projectId}`}
              className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary transition"
            >
              Connect Bing Webmaster
            </a>
          )}
          {!hasGa4Connection && (
            <a
              href={`/api/oauth?provider=google_analytics&projectId=${projectId}`}
              className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary transition"
            >
              Connect Google Analytics
            </a>
          )}
          {!hasPlausibleConnection && (
            <button
              onClick={connectPlausible}
              disabled={connectingPlausible || !plausibleApiKey.trim()}
              className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary transition disabled:opacity-50"
            >
              {connectingPlausible ? "Connecting..." : "Connect Plausible"}
            </button>
          )}
          <button
            onClick={syncAttribution}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium"
          >
            Sync Data
          </button>
        </div>
      </div>

      {!hasPlausibleConnection && (
        <div className="bg-card border border-border rounded-xl p-4 max-w-md space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">Plausible site ID</label>
            <input
              value={plausibleSite}
              onChange={(e) => setPlausibleSite(e.target.value)}
              placeholder={domain}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Plausible API key</label>
            <input
              value={plausibleApiKey}
              onChange={(e) => setPlausibleApiKey(e.target.value)}
              type="password"
              placeholder="From Plausible → Settings → API keys"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Stored per project. Site ID is usually your domain.
          </p>
        </div>
      )}

      {hasGa4Connection && <Ga4PropertyPicker projectId={projectId} currentPropertyId={ga4PropertyId} />}

      <AdsEquivalentPanel
        organicSessions={current?.organic_traffic}
        aiReferralSessions={current?.ai_referral_traffic}
        industry={industry}
      />

      {current ? (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { label: "Organic Traffic", key: "organic_traffic" as const },
              { label: "AI Referrals", key: "ai_referral_traffic" as const },
              { label: "Leads", key: "leads" as const },
              { label: "Revenue", key: "revenue" as const, format: "currency" },
            ].map((m) => {
              const d = delta(m.key);
              const value = current[m.key] as number;
              return (
                <div key={m.key} className="bg-card border border-border rounded-xl p-4">
                  <div className="text-sm text-muted-foreground">{m.label}</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    {m.format === "currency" ? formatCurrency(value) : value.toLocaleString()}
                  </div>
                  {d && (
                    <div className={`text-xs mt-1 ${d.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {d.change >= 0 ? "+" : ""}
                      {m.format === "currency" ? formatCurrency(d.change) : d.change} ({d.percent.toFixed(1)}% MoM)
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-gradient-to-r from-primary/10 to-transparent border border-primary/20 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
              Paid Ads Equivalent
              <ProjectionBadge />
            </h3>
            <div className="text-4xl font-bold text-primary">
              {formatCurrency(current.paid_ads_equivalent)}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Estimated value of your organic visibility if purchased via paid ads
              {industry && ` (${industry} industry CPC benchmark)`}.
              {monthlyAdSpend && monthlyAdSpend > 0 && (
                <span className="block mt-1">
                  Your monthly ad spend: {formatCurrency(monthlyAdSpend)} — organic is building compounding assets.
                </span>
              )}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: "Search Clicks", value: current.search_clicks },
              { label: "Social Clicks", value: current.social_clicks },
              { label: "Directory Referrals", value: current.directory_referrals },
            ].map((m) => (
              <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
                <div className="text-xl font-bold">{m.value}</div>
                <div className="text-sm text-muted-foreground">{m.label}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-4">
            No attribution data yet. Connect GSC, Bing Webmaster, or Google Analytics and sync to start tracking.
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            <a
              href={`/api/oauth?provider=google_search_console&projectId=${projectId}`}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium inline-block"
            >
              Connect GSC
            </a>
            <a
              href={`/api/oauth?provider=bing_webmaster&projectId=${projectId}`}
              className="border border-border px-6 py-2 rounded-lg font-medium inline-block hover:bg-secondary transition"
            >
              Connect Bing
            </a>
            <a
              href={`/api/oauth?provider=google_analytics&projectId=${projectId}`}
              className="border border-border px-6 py-2 rounded-lg font-medium inline-block hover:bg-secondary transition"
            >
              Connect GA4
            </a>
          </div>
        </div>
      )}

      <LlmReferralChart referrals={referrals} />
      <VisitorIdentityPanel sessions={sessions} />

      <div className="bg-card border border-border rounded-xl p-6 mt-8">
        <h3 className="font-semibold mb-2">AI Referral Tracking (v2)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Add this snippet to <strong>{domain}</strong> to detect traffic from ChatGPT, Perplexity, Copilot, and Gemini.
        </p>
        <pre className="text-xs bg-secondary p-4 rounded-lg overflow-x-auto">{`<script>
(function(){
  var r=document.referrer;if(!r)return;
  fetch("${process.env.NEXT_PUBLIC_APP_URL || "https://omnipresence-engine.vercel.app"}/api/track",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({projectId:"${projectId}",referrer:r,path:location.pathname,sessionId:sessionStorage.getItem("op_sid")||crypto.randomUUID()})
  }).catch(function(){});
})();
</script>`}</pre>
      </div>
    </div>
  );
}
