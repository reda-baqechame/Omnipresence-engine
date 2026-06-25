"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SetupStep {
  id: string;
  title: string;
  done: boolean;
  action: string;
  href?: string;
}

export default function SetupPage() {
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [version, setVersion] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/capabilities").then((r) => r.json()),
    ]).then(([health, caps]) => {
      setVersion(health.version || caps.version);
      const p = Object.fromEntries((caps.providers || []).map((x: { id: string; configured: boolean }) => [x.id, x.configured]));

      setSteps([
        {
          id: "supabase",
          title: "Connect Supabase (login + dashboard)",
          done: p.supabase === true && health.checks?.supabase === "ok",
          action: "Add NEXT_PUBLIC_SUPABASE_* + SUPABASE_SERVICE_ROLE_KEY on Vercel. Run supabase/migrations/combined.sql.",
        },
        {
          id: "migration",
          title: "Apply database migration 0009 (v2 tables)",
          done: health.checks?.supabase === "ok",
          action: "SQL Editor → paste combined.sql (includes results_ledger, citation_sources, ops_queue).",
        },
        {
          id: "live",
          title: "Enable live AI citation tracking",
          done: caps.citationTracking === true && caps.liveData === true,
          action:
            "Set at least one: SERPER_API_KEY or BRAVE_SEARCH_API_KEY (free tier) + OPENAI/ANTHROPIC/GOOGLE key. PERPLEXITY recommended. DATAFORSEO optional.",
        },
        {
          id: "serp",
          title: "Google SERP + AI Overview data",
          done: caps.serpCapability === true,
          action: "Serper (cheap) or Brave Search API (2,000 free queries/mo at brave.com/search/api).",
        },
        {
          id: "inngest",
          title: "Connect Inngest (background scans + agents)",
          done: p.inngest === true,
          action: "Set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY. Sync https://your-domain/api/inngest",
        },
        {
          id: "indexnow",
          title: "IndexNow for faster URL discovery",
          done: p.indexnow === true,
          action: "Set INDEXNOW_KEY on Vercel. Host {key}.txt on client domains when submitting URLs.",
        },
        {
          id: "oauth",
          title: "OAuth for GSC / Bing / GA4 attribution",
          done: p.google_oauth === true && p.bing_oauth === true,
          action: "Set GOOGLE_CLIENT_* and BING_CLIENT_* + redirect URI /api/oauth/callback",
        },
      ]);
    });
  }, []);

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Production Setup Checklist</h2>
      <p className="text-sm text-muted-foreground mb-6">
        OmniPresence Engine v{version} — {doneCount}/{steps.length} complete.
        See DEPLOY.md in the repo for the full guide. Run <code className="text-xs bg-secondary px-1 rounded">npm run verify:prod</code> from CLI.
      </p>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className={`border rounded-xl p-4 ${step.done ? "border-green-500/30 bg-green-500/5" : "border-border bg-card"}`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step.done ? "bg-green-500 text-white" : "bg-secondary text-muted-foreground"
              }`}>
                {step.done ? "✓" : i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{step.action}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Link href="/app/settings/capabilities" className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-lg">
          View provider status
        </Link>
        <a
          href="https://vercel.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-secondary px-4 py-2 rounded-lg"
        >
          Open Vercel env vars
        </a>
      </div>
    </div>
  );
}
