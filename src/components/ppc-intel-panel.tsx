"use client";

import { useState } from "react";
import { Loader2, Megaphone, Calculator, ShieldCheck } from "lucide-react";
import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

interface CompetitorAd {
  advertiserDomain: string;
  title: string;
  url: string;
  keywords: string[];
  appearances: number;
}
interface AdSnapshot {
  available: boolean;
  reason?: string;
  keywordsScanned: number;
  keywordsWithAds: number;
  advertisers: CompetitorAd[];
  provider?: string;
}
interface Savings {
  organicSessions: number;
  aiReferralSessions: number;
  estimatedCpc: number;
  totalOrganicValue: number;
  estimatedPaidCost: number;
  savingsEstimate: number;
  replacementRatio: number;
  cpcSource: "real" | "industry_estimate";
  keywordsPriced: number;
}

export function PpcIntelPanel({
  projectId,
  organicSessions,
  aiReferralSessions,
}: {
  projectId: string;
  organicSessions: number;
  aiReferralSessions: number;
}) {
  const [ads, setAds] = useState<AdSnapshot | null>(null);
  const [loadingAds, setLoadingAds] = useState(false);
  const [savings, setSavings] = useState<Savings | null>(null);
  const [loadingSavings, setLoadingSavings] = useState(false);
  const [adSpend, setAdSpend] = useState(2000);

  async function scanAds() {
    setLoadingAds(true);
    try {
      const r = await fetch("/api/ppc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "competitor_ads" }),
      });
      setAds((await r.json()) as AdSnapshot);
    } finally {
      setLoadingAds(false);
    }
  }

  async function calcSavings() {
    setLoadingSavings(true);
    try {
      const keywords = ads?.advertisers.flatMap((a) => a.keywords) || [];
      const r = await fetch("/api/ppc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "savings",
          organicSessions,
          aiReferralSessions,
          monthlyAdSpend: adSpend,
          keywords: [...new Set(keywords)].slice(0, 50),
        }),
      });
      setSavings((await r.json()) as Savings);
    } finally {
      setLoadingSavings(false);
    }
  }

  return (
    <div className="space-y-6">
      <CapabilityEvidenceBar
        projectId={projectId}
        capability="ppc"
        target=""
        label="PPC proof"
        quality={ads?.available ? "measured" : "unavailable"}
      />
      {/* Competitor ad snapshots */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Megaphone className="h-4 w-4" /> Competitor ad snapshots
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Who is buying ads on your tracked keywords, their ad copy, and landing pages — captured live from the SERP
              paid block.
            </p>
          </div>
          <button
            type="button"
            onClick={scanAds}
            disabled={loadingAds}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm disabled:opacity-50 shrink-0"
          >
            {loadingAds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Scan ads
          </button>
        </div>

        {ads && !ads.available && <p className="mt-3 text-sm text-yellow-400">{ads.reason}</p>}
        {ads?.available && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <ShieldCheck className="h-3 w-3 text-green-400" />
              measured · {ads.provider} · {ads.keywordsWithAds}/{ads.keywordsScanned} keywords showed ads
            </div>
            {ads.advertisers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No paid competitors detected on these keywords.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {ads.advertisers.map((a) => (
                  <li key={a.advertiserDomain} className="border-b border-border/40 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.advertiserDomain}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.appearances} ad{a.appearances === 1 ? "" : "s"} · {a.keywords.length} keyword
                        {a.keywords.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs break-all">
                      {a.title || a.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* CPC / CAC savings */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Calculator className="h-4 w-4" /> CPC / CAC savings
        </h3>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          The paid-search cost your organic + AI sessions replace. Uses the real Google Ads Keyword Planner CPC for your
          scanned keywords when available, otherwise an industry default.
        </p>
        <div className="flex items-end gap-2 mb-3">
          <label className="text-sm">
            Current monthly ad spend ($)
            <input
              type="number"
              value={adSpend}
              onChange={(e) => setAdSpend(Number(e.target.value))}
              className="block mt-1 bg-background border border-input rounded px-2 py-1 w-36"
            />
          </label>
          <button
            type="button"
            onClick={calcSavings}
            disabled={loadingSavings}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loadingSavings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Calculate
          </button>
        </div>
        {savings && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Organic + AI sessions</dt>
              <dd>{(savings.organicSessions + savings.aiReferralSessions).toLocaleString()}</dd>
              <dt className="text-muted-foreground">CPC used</dt>
              <dd>
                ${savings.estimatedCpc.toFixed(2)}{" "}
                <span
                  className={`text-[10px] uppercase rounded px-1 py-0.5 ${
                    savings.cpcSource === "real" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"
                  }`}
                >
                  {savings.cpcSource === "real" ? "real (keyword planner)" : "industry estimate"}
                </span>
              </dd>
              <dt className="text-muted-foreground">Equivalent paid cost</dt>
              <dd>${savings.estimatedPaidCost.toLocaleString()}/mo</dd>
              <dt className="text-muted-foreground">Total organic value</dt>
              <dd className="font-semibold">${savings.totalOrganicValue.toLocaleString()}/mo</dd>
              <dt className="text-muted-foreground">Estimated savings</dt>
              <dd className="font-semibold text-green-400">${savings.savingsEstimate.toLocaleString()}/mo</dd>
            </dl>
            <p className="text-[10px] text-muted-foreground mt-3">
              {savings.keywordsPriced > 0
                ? `CPC priced from ${savings.keywordsPriced} real Keyword Planner keywords.`
                : "CPC is an industry default — connect OmniData Keyword Planner for measured CPC."}{" "}
              Session counts come from your measured first-party analytics.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
