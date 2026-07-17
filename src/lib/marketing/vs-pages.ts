/**
 * Data for /vs/[slug] comparison landing pages (Master Plan v4 Phase 4).
 *
 * Honesty rules: competitor facts are limited to their PUBLISHED pricing and
 * packaging as captured in the mid-2026 teardowns (docs/market-intelligence).
 * No invented weaknesses, no fabricated review quotes. Each page states the
 * capture date and tells readers to check the competitor's site for current
 * numbers. Our side only claims what the claims gate allows the product to
 * claim elsewhere.
 */

export interface VsRow {
  dimension: string;
  them: string;
  us: string;
}

export interface VsPage {
  slug: string;
  competitor: string;
  title: string;
  description: string;
  /** One-line fair summary of what the competitor is genuinely good at. */
  strengths: string;
  rows: VsRow[];
  bottomLine: string;
}

export const VS_PAGES: VsPage[] = [
  {
    slug: "otterly",
    competitor: "Otterly.AI",
    title: "PresenceOS vs Otterly.AI",
    description:
      "Otterly.AI Pro is $189/mo for 100 prompts with core engines — Gemini, AI Mode, and Claude are paid add-ons. PresenceOS Agency is $199/mo for 300 prompts, 15 brands, every engine included, and verifiable receipts.",
    strengths:
      "Otterly pioneered accessible AI search monitoring with a clean prompt-tracking workflow and solid multi-engine coverage.",
    rows: [
      { dimension: "Published price (mid-2026)", them: "$189/mo Pro", us: "$199/mo Agency (top plan) — from $29/mo" },
      { dimension: "Prompts", them: "100 prompts", us: "300 prompts pooled across 15 brands" },
      { dimension: "Engines", them: "4 standard; Gemini, AI Mode, Claude sold separately", us: "All engines + Google surfaces on every plan" },
      { dimension: "Feature gating", them: "Tiered features", us: "Every feature on every plan — only capacity differs" },
      { dimension: "Evidence", them: "Screenshots in-app", us: "Hash-chained receipts with public /verify pages anyone can audit" },
      { dimension: "Measurement", them: "Scheduled checks", us: "Multi-run panels with confidence intervals and sample-size floors" },
      { dimension: "After the dashboard", them: "Monitoring-first", us: "Weekly action sprints with honest before/after verdicts" },
    ],
    bottomLine:
      "If you want monitoring with per-engine add-ons, Otterly is a fine tool. If you want every engine, verifiable evidence, and an action loop for less money at the top end, that's what PresenceOS was built for.",
  },
  {
    slug: "peec",
    competitor: "Peec AI",
    title: "PresenceOS vs Peec AI",
    description:
      "Peec AI starts around $95/mo for 50 prompts on 3 selected models, with credit-based agency tiers above. PresenceOS gives you every engine and every feature from $29/mo, capped at $199.",
    strengths:
      "Peec grew fast for a reason: a polished dashboard, strong brand-vs-competitor visualizations, and a team that ships quickly.",
    rows: [
      { dimension: "Published price (mid-2026)", them: "$95+/mo, 50 prompts, 3 models", us: "$29–$199/mo, 25–300 prompts, all engines" },
      { dimension: "Metering", them: "Credits and model selection", us: "One honest unit: the observation (prompt × engine × run)" },
      { dimension: "Feature gating", them: "Agency features on higher tiers", us: "White-label, portals, API/MCP on every plan" },
      { dimension: "Evidence", them: "Dashboard metrics", us: "Every number backed by a hash-chained, publicly verifiable receipt" },
      { dimension: "Statistics", them: "Point-in-time rates", us: "Confidence intervals, minimum samples, volatility separated by cause" },
      { dimension: "Action loop", them: "Insights", us: "Sprints → fixes → remeasure → verdict (increased/unchanged/declined/inconclusive)" },
    ],
    bottomLine:
      "Peec is a strong monitoring dashboard. PresenceOS is a measurement-and-action system: repeatable panels, receipts your clients can verify, and a weekly loop that turns gaps into fixes and fixes into remeasured proof.",
  },
  {
    slug: "rankscale",
    competitor: "Rankscale",
    title: "PresenceOS vs Rankscale",
    description:
      "Rankscale meters responses ($99/mo for ~4,800 up to $385/mo for ~22,000). PresenceOS meters observations with every feature on every plan, from $29 to a hard $199 cap.",
    strengths:
      "Rankscale offers genuinely deep engine coverage and generous response volumes with agency features at the higher tiers.",
    rows: [
      { dimension: "Published price (mid-2026)", them: "$99–$385/mo, response-metered", us: "$29–$199/mo, observation-metered" },
      { dimension: "Top-tier price", them: "$385/mo", us: "$199/mo — hard cap" },
      { dimension: "Feature gating", them: "Agency features on higher tiers", us: "Every feature on every plan" },
      { dimension: "Evidence", them: "In-app results", us: "Public hash-chain receipts — clients verify without trusting us" },
      { dimension: "Statistics", them: "Volume-first", us: "Sample-size floors; thin data is labeled inconclusive, never inflated" },
      { dimension: "Action loop", them: "Recommendations", us: "Weekly sprints with copy-paste fixes and remeasured verdicts" },
    ],
    bottomLine:
      "If raw response volume is your only axis, compare the math with our calculator. If you need evidence clients can independently verify and a fix loop that proves whether work moved the needle, PresenceOS does that at nearly half the top-end price.",
  },
  {
    slug: "profound",
    competitor: "Profound",
    title: "PresenceOS vs Profound",
    description:
      "Profound is the enterprise leader in AI answer intelligence, priced for enterprise contracts. PresenceOS delivers measurement, receipts, and an action loop for boutique agencies at $29–$199/mo.",
    strengths:
      "Profound defined the category, has enterprise-grade scale, and is the right choice for Fortune-500 brands with enterprise budgets.",
    rows: [
      { dimension: "Published price (mid-2026)", them: "Enterprise contracts (undisclosed)", us: "$29–$199/mo self-serve" },
      { dimension: "Target customer", them: "Enterprise brands", us: "Boutique agencies and in-house teams (3–25 people)" },
      { dimension: "Onboarding", them: "Sales-led", us: "Self-serve: domain → prompts → baseline panel in minutes" },
      { dimension: "Evidence", them: "Enterprise reporting", us: "Public hash-chain receipts on every measured answer" },
      { dimension: "Action loop", them: "Insights + enterprise workflows", us: "Weekly sprints, copy-paste fixes, MCP for Claude/Cursor" },
      { dimension: "White-label", them: "Enterprise packaging", us: "Included on every plan, even $29" },
    ],
    bottomLine:
      "Profound is excellent if you have an enterprise budget. If you're an agency that needs client-verifiable proof and an execution loop without a sales call, PresenceOS gives you the working core for under $200.",
  },
  {
    slug: "trakkr",
    competitor: "Trakkr",
    title: "PresenceOS vs Trakkr",
    description:
      "Trakkr made AI visibility tracking simple with fast onboarding and GA4 attribution. PresenceOS keeps that speed and adds multi-run statistics, verifiable receipts, and a weekly action loop.",
    strengths:
      "Trakkr's onboarding is superb — domain to dashboard in minutes — and its GA4 AI-referral view is genuinely useful. We adopted both patterns.",
    rows: [
      { dimension: "Onboarding", them: "Fast domain-based setup", us: "Same pattern: domain → inferred prompts → approve → baseline" },
      { dimension: "GA4 attribution", them: "2-minute connect", us: "Same 2-minute connect + AI conversions/revenue by source" },
      { dimension: "Measurement depth", them: "Single-run checks", us: "Repeated runs with confidence intervals and sample floors" },
      { dimension: "Evidence", them: "Dashboard scores", us: "Hash-chained receipts with public verification pages" },
      { dimension: "Action loop", them: "Monitoring-first", us: "Weekly sprints → fixes → remeasured before/after verdicts" },
      { dimension: "Feature gating", them: "Tiered", us: "Every feature on every plan, $199 cap" },
    ],
    bottomLine:
      "We say this openly: Trakkr's onboarding and GA4 patterns are great, and we learned from them. PresenceOS is for teams that also need statistical rigor, client-verifiable receipts, and proof that fixes worked.",
  },
];

export function getVsPage(slug: string): VsPage | undefined {
  return VS_PAGES.find((p) => p.slug === slug);
}
