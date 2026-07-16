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

interface ProductionCheck {
  id: string;
  label: string;
  status: string;
  message?: string;
}

export default function SetupPage() {
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [version, setVersion] = useState("");
  const [prodScore, setProdScore] = useState(0);
  const [prodReady, setProdReady] = useState(false);
  const [checks, setChecks] = useState<ProductionCheck[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/capabilities").then((r) => r.json()),
    ]).then(([health, caps]) => {
      setVersion(health.version || caps.version);
      const production = health.production || caps.production;
      setProdScore(production?.score ?? 0);
      setProdReady(production?.ready ?? false);
      setChecks(production?.checks || []);

      const p = Object.fromEntries((caps.providers || []).map((x: { id: string; configured: boolean }) => [x.id, x.configured]));

      setSteps([
        {
          id: "supabase",
          title: "Connect Supabase (login + dashboard)",
          done: p.supabase === true && health.checks?.supabase === "ok",
          action: "Add NEXT_PUBLIC_SUPABASE_* + SUPABASE_SERVICE_ROLE_KEY. Run npm run db:migrate (through 0017).",
        },
        {
          id: "phase9-db",
          title: "Apply Phase 9 migration (0017)",
          done: health.checks?.phase9_schema === "ok",
          action: "npm run db:migrate:prod — visitor_sessions for identity tracking.",
        },
        {
          id: "phase8-db",
          title: "Apply Phase 8 migration (0016)",
          done: health.checks?.phase8_schema === "ok",
          action: "npm run db:migrate:prod — indexing log, link building orders, community mentions.",
        },
        {
          id: "intelligence-db",
          title: "Apply intelligence migration (0015)",
          done: health.checks?.intelligence_schema === "ok",
          action: "npm run db:migrate — creates keyword_opportunities + content_gap_findings tables.",
        },
        {
          id: "encryption",
          title: "Set INTEGRATION_ENCRYPTION_KEY (production)",
          done: health.checks?.integration_encryption === "ok",
          action: "32+ char random string on Vercel — required before saving WordPress/CMS credentials.",
        },
        {
          id: "live",
          title: "Enable live AI citation tracking",
          done: caps.citationTracking === true && caps.liveData === true,
          action: "SERPER or OMNIDATA + OPENAI/ANTHROPIC/GOOGLE key. PERPLEXITY recommended.",
        },
        {
          id: "intelligence",
          title: "Enable keyword & gap intelligence",
          done: health.checks?.intelligence_api === "ok",
          action: "OMNIDATA_BASE_URL + keys on Vercel, or SERPER_API_KEY for app-level SERP. Weekly cron syncs gaps.",
        },
        {
          id: "omnidata",
          title: "Deploy OmniData engine (recommended)",
          done: health.checks?.omnidata === "ok",
          action: "docker compose up in services/omnidata. Set OMNIDATA_BASE_URL + API key + signing secret.",
        },
        {
          id: "inngest",
          title: "Connect Inngest (manual scans + jobs)",
          done: p.inngest === true && health.checks?.inngest === "ok",
          action:
            "INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY. Set MANUAL_ONLY_MODE=true to disable all crons and auto follow-ups — paid APIs only run when you click Rescan, generate a report, run a panel, or approve ops. Keep Inngest keys so those button-triggered jobs still work on serverless.",
        },
        {
          id: "execution",
          title: "Wire Phase 8 execution engines",
          done: health.checks?.phase8_schema === "ok" && health.checks?.integration_encryption === "ok",
          action: "Connect WordPress in Distribution → run on-page scan → approve fixes. Bulk indexing on Distribution tab.",
        },
        {
          id: "indexnow",
          title: "IndexNow for faster URL discovery",
          done: p.indexnow === true,
          action: "Set INDEXNOW_KEY. Auto-submitted on CMS publish.",
        },
        {
          id: "oauth",
          title: "OAuth for GSC / Bing / GA4 attribution",
          done: p.google_oauth === true,
          action: "GOOGLE_CLIENT_* + BING_CLIENT_* + redirect URI /api/oauth/callback",
        },
      ]);
    });
  }, []);

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <h2 className="text-xl font-bold mb-2">Production Setup Checklist</h2>
      <p className="text-sm text-muted-foreground mb-2">
        OmniPresence Engine v{version} — {doneCount}/{steps.length} steps complete.
        Production readiness:{" "}
        <strong className={prodReady ? "text-green-400" : "text-yellow-400"}>
          {prodReady ? "READY" : `${prodScore}%`}
        </strong>
      </p>
      <p className="text-sm text-muted-foreground mb-6">
        See DEPLOY.md and .env.example. Run <code className="text-xs bg-secondary px-1 rounded">npm run verify:prod</code> against your live URL.
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

      {checks.length > 0 && (
        <div className="mt-8 border border-border rounded-xl p-4 bg-card">
          <h3 className="font-semibold mb-3">Full production audit</h3>
          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="flex justify-between gap-4">
                <span>{c.label}</span>
                <span className={
                  c.status === "ok" ? "text-green-400" :
                  c.status === "error" ? "text-red-400" :
                  c.status === "warning" ? "text-yellow-400" : "text-muted-foreground"
                }>
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
