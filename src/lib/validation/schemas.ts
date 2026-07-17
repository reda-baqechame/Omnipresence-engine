import { z } from "zod";

/**
 * Input-validation schemas for hot authenticated API routes (production
 * hardening). Kept dependency-free (only `zod`) so they can be unit-tested
 * directly with `node --test`. Route handlers call `parseOrError` and return a
 * clean 400 instead of letting malformed input reach the engines/DB.
 */

/** Pure parse helper: returns either the typed data or a flat error message. */
export function parseOrError<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
  return { ok: false, error: `${path}${first?.message || "invalid input"}` };
}

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

/** Known SLA risk levels for queued ops. */
export const RISK_LEVELS = ["low", "medium", "high"] as const;

/** Mutable ops-queue statuses a client is allowed to set via PATCH. Must match
 * the ops_queue.status CHECK constraint (0009_v2_real_results.sql) exactly —
 * "cancelled" was previously listed here but rejected by that constraint,
 * which the DFY approval panel's reject button hit on every use. */
export const OPS_PATCH_STATUSES = ["approved", "rejected", "pending"] as const;

export const OpsCreateSchema = z.object({
  projectId: uuid,
  organizationId: uuid,
  // actionType is dispatched by the executor (unknown types fail cleanly), so we
  // only enforce it's a bounded non-empty string here — not a brittle enum that
  // would reject newly-added runners.
  actionType: nonEmpty.max(64),
  title: nonEmpty.max(300),
  payload: z.record(z.string(), z.unknown()).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  taskId: uuid.optional(),
});
export type OpsCreateInput = z.infer<typeof OpsCreateSchema>;

export const OpsPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(OPS_PATCH_STATUSES).optional(),
    assignedTo: uuid.optional(),
    execute: z.boolean().optional(),
  })
  .refine((b) => b.status !== undefined || b.assignedTo !== undefined || b.execute !== undefined, {
    message: "no mutation supplied (status, assignedTo, or execute required)",
  });
export type OpsPatchInput = z.infer<typeof OpsPatchSchema>;

/** Project-scoped action triggers (fastest-path sync, attribution sync, etc.). */
export const ProjectIdSchema = z.object({ projectId: uuid });

/** Base for project-scoped mutation routes — validates projectId, passthrough extras. */
export const ProjectMutationSchema = z.object({ projectId: uuid }).passthrough();

export const RanksPostSchema = z.object({
  projectId: uuid,
  keyword: z.string().trim().max(200).optional(),
  location: z.string().trim().max(120).optional(),
  device: z.enum(["desktop", "mobile"]).optional(),
  action: z.enum(["check_all", "import_prompts", "ack_alert"]).optional(),
  alertId: uuid.optional(),
});

/** Public tools/* routes that accept a domain string. */
export const ToolsDomainSchema = z.object({ domain: nonEmpty.max(253) }).passthrough();

export const ToolsCanonicalSchema = z.object({
  domain: nonEmpty.max(253),
  path: z.string().trim().max(2048).optional(),
});

export const ToolsCitationPlannerSchema = z.object({
  brand: nonEmpty.max(80),
  industry: nonEmpty.max(80),
  location: z.string().trim().max(80).optional(),
  domain: z.string().trim().max(120).optional(),
});

export const ToolsRoiSchema = z
  .object({
    organicSessions: z.coerce.number().optional(),
    aiReferralSessions: z.coerce.number().optional(),
    monthlyAdSpend: z.coerce.number().optional(),
    industry: z.string().optional(),
    customCpc: z.coerce.number().optional(),
  })
  .refine(
    (b) => b.monthlyAdSpend !== undefined || b.organicSessions !== undefined,
    { message: "monthlyAdSpend or organicSessions required" }
  );

export const PublicAuditSchema = z.object({
  domain: nonEmpty.max(253),
  email: z.string().email().max(320),
  brandName: z.string().trim().max(120).optional(),
  industry: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
  competitors: z.array(z.string().trim().max(80)).max(5).optional(),
  orgToken: z.string().trim().max(256).optional(),
});

export const PasswordResetSchema = z.object({
  email: z.string().email().max(320),
});

export const SignOutSchema = z.object({}).passthrough();

export const TrackBeaconSchema = z.object({
  projectId: uuid,
  referrer: z.string().max(500).optional(),
  path: z.string().max(500).optional(),
  sessionId: z.string().max(100).optional(),
});

/** Keyword-intelligence actions the POST handler dispatches on. */
export const KEYWORD_ACTIONS = [
  "research",
  "bulk_research",
  "content_gaps",
  "backlink_gaps",
  "difficulty",
  "universe",
] as const;

/** Keyword research request (covers all `action` variants of the route). */
export const KeywordsSchema = z.object({
  projectId: uuid,
  action: z.enum(KEYWORD_ACTIONS).optional(),
  seed: z.string().trim().max(200).optional(),
  seeds: z.array(nonEmpty.max(200)).max(200).optional(),
  keyword: z.string().trim().max(200).optional(),
  geo: z.string().trim().max(64).optional(),
  depth: z.enum(["shallow", "deep"]).optional(),
});
export type KeywordsInput = z.infer<typeof KeywordsSchema>;

// ---------------------------------------------------------------------------
// High-risk mutation route schemas (Wave 1 hardening — ~30 routes)
// ---------------------------------------------------------------------------

const urlish = z.string().trim().max(2048);
const boundedText = z.string().trim().max(500);

export const PLAN_KEYS = ["solo", "growth", "agency"] as const;

export const BillingCheckoutSchema = z.object({
  plan: z.enum(PLAN_KEYS).optional(),
});

export const BillingPortalSchema = z.object({}).optional();

export const ApiKeyCreateSchema = z.object({
  name: boundedText.max(100).optional(),
});

export const ApiKeyDeleteSchema = z.object({
  id: uuid,
});

export const ReportGenerateSchema = z.object({
  report_type: z.enum(["standard", "deep"]).optional(),
  sections: z.array(z.string().trim().max(64)).max(32).optional(),
  preset: z.string().trim().max(64).optional(),
  /** Client-generated UUID so a double-clicked Generate button (or a
   * retried request) reuses the in-flight/completed report instead of
   * creating a duplicate row. Scoped per-project via a unique index. */
  idempotency_key: uuid.optional(),
});

/** PATCH /api/projects/[id]/report/[reportId] — toggle public share-link access. */
export const ReportVisibilitySchema = z.object({
  is_public: z.boolean(),
});

export const ProjectCreateSchema = z.object({
  name: nonEmpty.max(200),
  domain: nonEmpty.max(253),
  competitors: z.array(z.string().trim().max(80)).max(10).optional(),
  scope: z.enum(["local", "national", "global"]).optional(),
  main_offer: z.string().trim().max(200).optional(),
  conversion_goal: z.string().trim().max(120).optional(),
  aov: z.number().min(0).optional(),
  ltv: z.number().min(0).optional(),
  monthly_ad_spend: z.number().optional(),
  industry: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  target_buyer: z.string().trim().max(200).optional(),
  current_monthly_traffic: z.number().min(0).optional(),
  /** Onboarding fork: is this the user's own brand or an agency's client? */
  client_mode: z.enum(["myself", "client"]).optional(),
  /** Prompts the user approved during onboarding. When present, the first scan
   * uses exactly these instead of regenerating a prompt universe — the user's
   * approval is the source of truth (no surprise provider spend on prompts
   * they never saw). */
  approved_prompts: z
    .array(
      z.object({
        text: nonEmpty.max(180),
        category: z.string().trim().max(32).optional(),
        priority: z.number().min(1).max(100).optional(),
      })
    )
    .max(60)
    .optional(),
});

/** POST /api/onboarding/analyze — pre-project domain intelligence. */
export const OnboardingAnalyzeSchema = z.object({
  domain: nonEmpty.max(253),
});

/** POST /api/sprints — propose this week's action sprint for a project. */
export const SprintCreateSchema = z.object({
  projectId: uuid,
});

/** POST /api/mcp — JSON-RPC 2.0 envelope for the MCP server. */
export const McpRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: nonEmpty,
  params: z.unknown().optional(),
});

/** PATCH /api/sprints/[id] — sprint lifecycle + item completion. */
export const SprintPatchSchema = z
  .object({
    action: z.enum(["start", "complete", "skip"]).optional(),
    /** Toggle a sprint item's done flag by its index. */
    toggleItemIndex: z.number().int().min(0).max(19).optional(),
  })
  .refine((b) => b.action !== undefined || b.toggleItemIndex !== undefined, {
    message: "action or toggleItemIndex required",
  });

export const V1ScanSchema = z
  .object({
    all: z.boolean().optional(),
    projectIds: z.array(uuid).max(50).optional(),
  })
  .refine((b) => b.all === true || (Array.isArray(b.projectIds) && b.projectIds.length > 0), {
    message: "projectIds required (or all:true)",
  });

export const V1ExportSchema = z.object({
  projectId: uuid,
  format: z.enum(["json", "csv"]).optional(),
});

export const V1RanksSchema = z.object({
  projectId: uuid,
  keywords: z.array(nonEmpty.max(200)).max(100).optional(),
});

export const IntegrationsUpsertSchema = z.object({
  projectId: uuid,
  provider: nonEmpty.max(64),
  credentials: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const TasksCreateSchema = z.object({
  projectId: uuid,
  title: nonEmpty.max(300),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  /** Optional SearchOps / structured task fields (backward compatible). */
  source_module: z
    .enum([
      "manual",
      "searchops_opportunity",
      "technical_finding",
      "keyword_opportunity",
      "authority",
      "source_opportunity",
    ])
    .optional(),
  source_id: z.string().trim().max(500).optional(),
  category: z.string().trim().max(64).optional(),
  impact: z.number().int().min(0).max(100).optional(),
  effort: z.number().int().min(0).max(20).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  before_metric: z.record(z.string(), z.unknown()).optional(),
});

export const TasksPatchSchema = z
  .object({
    status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
    title: boundedText.max(300).optional(),
    assignedTo: uuid.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "no mutation supplied",
  });

export const PanelRunSchema = z.object({
  force: z.boolean().optional(),
});

export const AuthRegisterSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: boundedText.max(120).optional(),
});

export const AuthSetupOrgSchema = z.object({
  name: nonEmpty.max(200),
  domain: nonEmpty.max(253).optional(),
});

export const OAuthConnectSchema = z.object({
  provider: z.enum(["google", "bing", "ga4", "gsc"]),
  projectId: uuid.optional(),
  redirectUrl: urlish.optional(),
});

export const SerpCaptureSchema = z.object({
  projectId: uuid,
  keyword: nonEmpty.max(200),
  location: z.string().trim().max(120).optional(),
});

export const BacklinksQuerySchema = z.object({
  domain: nonEmpty.max(253),
  limit: z.number().int().min(1).max(100).optional(),
});

export const DeepCrawlSchema = z.object({
  projectId: uuid,
  url: urlish,
  maxPages: z.number().int().min(1).max(50).optional(),
});

export const ContentAnalyzeSchema = z.object({
  projectId: uuid,
  url: urlish.optional(),
  text: z.string().max(100_000).optional(),
});

export const IntelligenceRunSchema = z.object({
  projectId: uuid,
  section: z.string().trim().max(64).optional(),
});

export const AnnotationsCreateSchema = z.object({
  projectId: uuid,
  note: nonEmpty.max(2000),
  url: urlish.optional(),
});

export const DemandRefreshSchema = z.object({
  projectId: uuid,
  seeds: z.array(nonEmpty.max(200)).max(50).optional(),
});

export const DistributionScheduleSchema = z.object({
  projectId: uuid,
  channel: z.enum(["email", "slack", "webhook"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const PanelCreateSchema = z.object({
  projectId: uuid,
  name: nonEmpty.max(200),
  prompts: z.array(nonEmpty.max(500)).min(1).max(50),
});

export const LeadsConvertSchema = z.object({
  leadId: uuid,
  organizationName: nonEmpty.max(200).optional(),
});

export const EmbedAuditSnippetSchema = z.object({
  projectId: uuid,
  domain: nonEmpty.max(253),
});

export const AttributionPlausibleSchema = z.object({
  projectId: uuid,
  siteId: nonEmpty.max(120),
  apiKey: nonEmpty.max(256),
});

export const AttributionReferralsSchema = z.object({
  projectId: uuid,
  utmSource: nonEmpty.max(120).optional(),
});

export const TrafficPanelIngestSchema = z.object({
  projectId: uuid,
  domain: nonEmpty.max(253),
  visits: z.number().int().min(0).optional(),
});

export const RescanSchema = z.object({
  engines: z.array(z.string().trim().max(64)).max(20).optional(),
  /** Client-generated UUID so a double-clicked Rescan button doesn't
   * trigger a second concurrent scan. Combined with an atomic
   * status != 'scanning' guard so the protection also holds for callers
   * that omit the key. */
  idempotency_key: uuid.optional(),
});

export const GeoRewriteSchema = z.object({
  projectId: uuid,
  url: urlish,
  passage: z.string().max(20_000).optional(),
});

export const ContentPatchSchema = z
  .object({
    assetId: uuid,
    status: z.string().trim().max(64).optional(),
    pipelineStep: z.string().trim().max(64).optional(),
  })
  .refine((b) => b.status !== undefined || b.pipelineStep !== undefined, {
    message: "status or pipelineStep required",
  });

export const CoveragePatchSchema = z.object({
  itemId: uuid,
  submissionStatus: z.enum(["not_started", "in_progress", "submitted", "live"]).optional(),
  profileUrl: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const DistributionIndexPutSchema = z.object({
  projectId: uuid,
  urls: z.array(urlish).min(1).max(50),
  engines: z.array(z.enum(["google", "bing", "indexnow"])).optional(),
});

export const DistributionSocialPatchSchema = z.object({
  projectId: uuid,
  platform: z.enum(["ayrshare", "buffer", "gbp"]),
  credentials: z
    .object({
      apiKey: z.string().optional(),
      accessToken: z.string().optional(),
      accountId: z.string().optional(),
      locationId: z.string().optional(),
      gbpToken: z.string().optional(),
      profileIds: z.array(z.string().trim().max(128)).optional(),
    })
    .passthrough(),
  text: nonEmpty.max(5000),
  platforms: z.array(z.string().trim().max(64)).optional(),
  profileIds: z.array(z.string().trim().max(128)).optional(),
  scheduleDate: z.string().trim().max(64).optional(),
});

export const AuthorityOutreachPostSchema = z.object({ opportunityId: uuid });
export const AuthorityStatusPatchSchema = z.object({
  opportunityId: uuid,
  status: nonEmpty.max(64),
});
export const AuthorityEmailPutSchema = z.object({
  opportunityId: uuid,
  to: z.string().email().max(320),
  subject: z.string().trim().max(300).optional(),
});

export const ContentScoreSchema = z.object({
  projectId: uuid,
  keyword: nonEmpty.max(200),
  draftText: z.string().max(100_000).optional(),
  targetUrl: urlish.optional(),
});

export const Ga4PropertiesPostSchema = z.object({
  projectId: uuid,
  propertyId: nonEmpty.max(128),
});

export const IndexingSubmitSchema = z.object({
  projectId: uuid,
  urls: z.array(urlish).max(50).optional(),
  urlsCsv: z.string().max(10_000).optional(),
  engines: z.array(z.string().trim().max(64)).max(10).optional(),
});

export const InternalLinksAnalyzeSchema = z.object({
  projectId: uuid,
  maxPages: z.number().int().min(1).max(100).optional(),
});

export const InternalLinksPatchSchema = z.object({
  id: uuid,
  status: nonEmpty.max(64),
  apply: z.boolean().optional(),
});

export const LinkBuildingPostSchema = z.object({
  projectId: uuid,
  tier: z.enum(["growth", "scale"]).optional(),
});

export const LinkBuildingPatchSchema = z.object({
  id: uuid,
  status: nonEmpty.max(64),
});

export const OnPagePatchSchema = z.object({
  queueId: uuid,
  apply: z.boolean().optional(),
});

export const RepurposePostSchema = z.object({
  assetId: uuid,
  targets: z.array(z.string().trim().max(64)).optional(),
});

export const RepurposePatchSchema = z.object({
  jobId: uuid,
  stage: nonEmpty.max(64),
  publishedUrl: urlish.optional(),
  scheduledAt: z.string().trim().max(64).optional(),
});

export const ExecutionTaskPatchSchema = z
  .object({
    status: z.string().trim().max(64).optional(),
    priority: z.string().trim().max(32).optional(),
    owner: z.string().uuid().nullable().optional(),
    due_date: z.string().trim().max(64).nullable().optional(),
    description: z.string().trim().max(5000).optional(),
    after_metric: z.record(z.string(), z.unknown()).nullable().optional(),
    before_metric: z.record(z.string(), z.unknown()).nullable().optional(),
    result_metric: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "no mutation supplied",
  });

export const PanelPatchSchema = z
  .object({
    name: boundedText.max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    geos: z.array(z.string().trim().max(64)).optional(),
    personas: z.array(z.string().trim().max(128)).optional(),
    engines: z.array(z.string().trim().max(64)).optional(),
    runsPerPrompt: z.number().int().min(1).max(20).optional(),
    isActive: z.boolean().optional(),
    prompts: z.array(nonEmpty.max(500)).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "no mutation supplied",
  });

export const PodcastGenerateSchema = z.object({
  projectId: uuid,
  assetId: uuid,
});

export const SerpExplorerSchema = z.object({
  projectId: uuid,
  keyword: nonEmpty.max(200),
  location: z.string().trim().max(120).optional(),
  device: z.enum(["desktop", "mobile"]).optional(),
});

export const SchemaGenerateSchema = z.object({
  projectId: uuid,
  pageUrl: urlish.optional(),
  pageTitle: z.string().trim().max(300).optional(),
  pageContent: z.string().max(100_000).optional(),
});

export const SchemaDeploySchema = z.object({
  projectId: uuid,
  platform: nonEmpty.max(64),
  htmlSnippet: nonEmpty.max(50_000),
  postId: z.string().trim().max(128).optional(),
  itemId: uuid.optional(),
});

export const AgentAnalyticsIngestSchema = z
  .object({
    logs: z.string().max(500_000).optional(),
    hits: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .refine((b) => b.logs !== undefined || b.hits !== undefined, {
    message: "logs or hits required",
  });

export const ProviderBenchmarkSchema = z
  .object({
    urls: z.array(urlish).optional(),
    domains: z.array(nonEmpty.max(253)).optional(),
    queries: z.array(nonEmpty.max(200)).optional(),
  })
  .passthrough();

export const RankSchedulesPostSchema = z.object({
  projectId: uuid,
  cadence: z.string().trim().max(32).optional(),
  action: z.enum(["ensure", "run_now"]).optional(),
});

export const PromptsPostSchema = z.object({
  projectId: uuid,
  csv: z.string().max(500_000).optional(),
  prompts: z.array(nonEmpty.max(500)).optional(),
  action: z.enum(["import_gsc"]).optional(),
});

export const PseoCampaignSchema = z.object({
  projectId: uuid,
  name: nonEmpty.max(200),
  templateType: nonEmpty.max(64),
  urlPattern: z.string().trim().max(500).optional(),
  servicesCsv: z.string().max(10_000).optional(),
  locationsCsv: z.string().max(10_000).optional(),
  keywordsCsv: z.string().max(10_000).optional(),
  matrixCsv: z.string().max(50_000).optional(),
  maxPages: z.number().int().min(1).max(500).optional(),
  previewOnly: z.boolean().optional(),
  generateContent: z.boolean().optional(),
  seedFromKeywords: z.boolean().optional(),
});

export const AeoRewriteSchema = z.object({
  projectId: uuid,
  url: urlish.optional(),
  publish: z.boolean().optional(),
  platform: z.string().trim().max(64).optional(),
});

export const CommunityPostSchema = z.object({
  projectId: uuid,
  csv: z.string().max(500_000).optional(),
  action: z.enum(["fetch_live", "fetch_firehose"]).optional(),
});

export const GuaranteePostSchema = z.object({
  projectId: uuid,
  action: z.enum(["lock_baseline", "verify", "claim"]),
  snapshot: z.record(z.string(), z.unknown()).optional(),
  currentMetrics: z.record(z.string(), z.number()).optional(),
  evidence: z.array(z.unknown()).optional(),
});

export const IndexationPostSchema = z.object({
  projectId: uuid,
  action: z.enum(["coverage", "crawler_logs"]),
  logText: z.string().max(100_000).optional(),
});

export const LocalPostSchema = z.object({
  projectId: uuid,
  action: nonEmpty.max(64),
  keyword: z.string().trim().max(200).optional(),
  gridSize: z.number().int().min(1).max(20).optional(),
  radiusKm: z.number().min(0).max(500).optional(),
  service: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
});

export const MerchantPostSchema = z.object({
  projectId: uuid,
  action: z.enum(["visibility"]).optional(),
  content: z.string().max(100_000).optional(),
  format: z.string().trim().max(32).optional(),
  optimize: z.boolean().optional(),
  optimizeLimit: z.number().int().min(1).max(100).optional(),
});

export const OperatingPlanPostSchema = z.object({
  projectId: uuid,
  action: z.enum(["generate_plan", "run_review"]),
  businessModel: z.string().trim().max(120).optional(),
  cadence: z.string().trim().max(64).optional(),
});

export const PpcPostSchema = z.object({
  projectId: uuid,
  action: nonEmpty.max(64),
  keywords: z.array(nonEmpty.max(200)).optional(),
  location: z.string().trim().max(120).optional(),
  device: z.enum(["desktop", "mobile"]).optional(),
  organicSessions: z.coerce.number().optional(),
  aiReferralSessions: z.coerce.number().optional(),
  monthlyAdSpend: z.coerce.number().optional(),
});

export const RoiPostSchema = z.object({
  projectId: uuid,
  action: z.enum(["landing_pages", "save_ux"]),
  clarityProjectId: z.string().trim().max(128).optional(),
  hotjarSiteId: z.string().trim().max(128).optional(),
});

/** Routes that must use validateBody + one of the schemas above (CI contract). */
export const HARDENED_ROUTE_SCHEMAS = {
  "billing/checkout": BillingCheckoutSchema,
  "billing/portal": BillingPortalSchema,
  "keys/create": ApiKeyCreateSchema,
  "keys/delete": ApiKeyDeleteSchema,
  "projects/report": ReportGenerateSchema,
  "projects/create": ProjectCreateSchema,
  "v1/scan": V1ScanSchema,
  "v1/export": V1ExportSchema,
  "v1/ranks": V1RanksSchema,
  "integrations": IntegrationsUpsertSchema,
  "tasks/create": TasksCreateSchema,
  "tasks/patch": TasksPatchSchema,
  "panels/run": PanelRunSchema,
  "auth/register": AuthRegisterSchema,
  "auth/setup-org": AuthSetupOrgSchema,
  "oauth": OAuthConnectSchema,
  "serp-capture": SerpCaptureSchema,
  "backlinks": BacklinksQuerySchema,
  "deep-crawl": DeepCrawlSchema,
  "content": ContentAnalyzeSchema,
  "intelligence": IntelligenceRunSchema,
  "annotations": AnnotationsCreateSchema,
  "demand": DemandRefreshSchema,
  "distribution": DistributionScheduleSchema,
  "panels/create": PanelCreateSchema,
  "leads/convert": LeadsConvertSchema,
  "embed/audit-snippet": EmbedAuditSnippetSchema,
  "attribution/plausible": AttributionPlausibleSchema,
  "attribution/referrals": AttributionReferralsSchema,
  "traffic-panel/ingest": TrafficPanelIngestSchema,
  "projects/rescan": RescanSchema,
  "projects/report-visibility": ReportVisibilitySchema,
  "geo-rewrite": GeoRewriteSchema,
} as const;
