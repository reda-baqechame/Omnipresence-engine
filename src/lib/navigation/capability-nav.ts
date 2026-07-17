import {
  ENGINES_ENABLED,
  hasBacklinksIndexCapability,
  hasCitationTrackingCapability,
  hasSerpCapability,
} from "@/lib/config/capabilities";

export type HubCapability =
  | "always"
  | "visibility"
  | "serp"
  | "backlinks"
  | "schema"
  | "attribution"
  | "distribution"
  | "content";

export interface HubNavItem {
  href: string;
  label: string;
  requires?: HubCapability;
}

export interface HubNavCategory {
  label: string;
  items: HubNavItem[];
}

/** Full project hub tree — filtered at runtime by {@link filterProjectHubNav}. */
export const PROJECT_HUB_NAV: HubNavCategory[] = [
  {
    label: "Command",
    items: [
      { href: "", label: "Domain Overview", requires: "always" },
      { href: "/command-center", label: "SearchOps Command", requires: "always" },
      { href: "/opportunities", label: "Opportunities", requires: "always" },
      { href: "/gate", label: "Presence Gate", requires: "always" },
      { href: "/trust", label: "Data Trust", requires: "always" },
      { href: "/competitors", label: "Competitor Compare", requires: "serp" },
    ],
  },
  {
    label: "Search Intelligence",
    items: [
      { href: "/keywords", label: "Keywords", requires: "serp" },
      { href: "/ranks", label: "Rankings", requires: "serp" },
      { href: "/search-performance", label: "Search Performance", requires: "serp" },
      { href: "/gsc", label: "Search Console", requires: "attribution" },
    ],
  },
  {
    label: "Technical SEO",
    items: [
      { href: "/technical", label: "Technical Audit", requires: "always" },
      { href: "/indexation", label: "Indexation", requires: "always" },
      { href: "/crawlers", label: "Crawler Logs", requires: "always" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/content-site", label: "Content & Site", requires: "content" },
      { href: "/topical", label: "Topical Map", requires: "content" },
      { href: "/pseo", label: "Programmatic SEO", requires: "content" },
    ],
  },
  {
    label: "Authority",
    items: [
      { href: "/authority-presence", label: "Authority & Presence", requires: "always" },
      { href: "/backlinks", label: "Backlinks", requires: "backlinks" },
      { href: "/authority", label: "Outreach CRM", requires: "always" },
    ],
  },
  {
    label: "Local",
    items: [{ href: "/local", label: "Local SEO", requires: "always" }],
  },
  {
    label: "AEO / GEO",
    items: [
      { href: "/ai-visibility", label: "AI Visibility", requires: "visibility" },
      { href: "/aeo-readiness", label: "AEO Readiness", requires: "visibility" },
      { href: "/prompts", label: "Prompt Campaigns", requires: "visibility" },
      { href: "/source-graph", label: "Source Graph", requires: "visibility" },
      { href: "/panels", label: "Prompt Panels", requires: "visibility" },
      { href: "/gaps", label: "Gap Analysis", requires: "always" },
    ],
  },
  {
    label: "Analytics & Attribution",
    items: [
      { href: "/attribution", label: "Attribution", requires: "attribution" },
      { href: "/roi", label: "ROI Command", requires: "attribution" },
      { href: "/traffic", label: "Traffic Panel", requires: "attribution" },
    ],
  },
  {
    label: "Execution & Ops",
    items: [
      { href: "/action-proof", label: "Action Plan & Proof", requires: "always" },
      { href: "/sprints", label: "Action Sprints", requires: "always" },
      { href: "/tasks", label: "Tasks", requires: "always" },
      { href: "/proof-ledger", label: "Proof Ledger", requires: "always" },
      { href: "/receipts", label: "Receipts", requires: "always" },
      { href: "/roadmap", label: "Roadmap", requires: "always" },
    ],
  },
];

export interface HubNavCapabilities {
  visibility?: boolean;
  serp?: boolean;
  backlinks?: boolean;
  schema?: boolean;
  attribution?: boolean;
  distribution?: boolean;
  content?: boolean;
}

/** Resolve live capability flags (defaults match production FREE_ACCESS_MODE paths). */
export function resolveHubCapabilities(overrides?: Partial<HubNavCapabilities>): HubNavCapabilities {
  return {
    visibility: overrides?.visibility ?? (ENGINES_ENABLED.visibilityTracking && hasCitationTrackingCapability()),
    serp: overrides?.serp ?? hasSerpCapability(),
    backlinks: overrides?.backlinks ?? hasBacklinksIndexCapability(),
    schema: overrides?.schema ?? ENGINES_ENABLED.schemaDeployment,
    attribution: overrides?.attribution ?? ENGINES_ENABLED.attributionProof,
    distribution: overrides?.distribution ?? ENGINES_ENABLED.distribution,
    content: overrides?.content ?? ENGINES_ENABLED.contentDomination,
  };
}

function isAllowed(requires: HubCapability | undefined, caps: HubNavCapabilities): boolean {
  if (!requires || requires === "always") return true;
  return Boolean(caps[requires]);
}

/** Filter hub nav categories/items by resolved capabilities. */
export function filterProjectHubNav(caps?: Partial<HubNavCapabilities>): HubNavCategory[] {
  const resolved = resolveHubCapabilities(caps);
  return PROJECT_HUB_NAV.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => isAllowed(item.requires, resolved)),
  })).filter((cat) => cat.items.length > 0);
}

/** Top-level mobile tabs derived from the same capability registry. */
export const PROJECT_HUB_TABS: HubNavItem[] = [
  { href: "", label: "Overview", requires: "always" },
  { href: "/command-center", label: "Command", requires: "always" },
  { href: "/ai-visibility", label: "AEO/GEO", requires: "visibility" },
  { href: "/search-performance", label: "Search", requires: "serp" },
  { href: "/opportunities", label: "Opps", requires: "always" },
  { href: "/action-proof", label: "Execution", requires: "always" },
  { href: "/trust", label: "Trust", requires: "always" },
];

export function filterProjectHubTabs(caps?: Partial<HubNavCapabilities>): HubNavItem[] {
  const resolved = resolveHubCapabilities(caps);
  return PROJECT_HUB_TABS.filter((tab) => isAllowed(tab.requires, resolved));
}
