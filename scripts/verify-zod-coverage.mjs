#!/usr/bin/env node
/**
 * Ensures high-risk mutation routes use validateBody + a schema from schemas.ts.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimum routes that must call validateBody (maps to HARDENED_ROUTE_SCHEMAS). */
const ROUTES = [
  { file: "src/app/api/billing/checkout/route.ts", schema: "BillingCheckoutSchema" },
  { file: "src/app/api/keys/route.ts", schema: "ApiKeyCreateSchema" },
  { file: "src/app/api/projects/route.ts", schema: "ProjectCreateSchema" },
  { file: "src/app/api/projects/[id]/report/route.ts", schema: "ReportGenerateSchema" },
  { file: "src/app/api/v1/scan/route.ts", schema: "V1ScanSchema" },
  { file: "src/app/api/ops/route.ts", schema: "OpsCreateSchema" },
  { file: "src/app/api/keywords/route.ts", schema: "KeywordsSchema" },
  { file: "src/app/api/fastest-path/route.ts", schema: "ProjectIdSchema" },
  { file: "src/app/api/attribution/sync/route.ts", schema: "ProjectIdSchema" },
  { file: "src/app/api/integrations/route.ts", schema: "IntegrationsUpsertSchema" },
  { file: "src/app/api/tasks/route.ts", schema: "TasksCreateSchema" },
  { file: "src/app/api/serp-capture/route.ts", schema: "SerpCaptureSchema" },
  { file: "src/app/api/backlinks/route.ts", schema: "BacklinksQuerySchema" },
  { file: "src/app/api/deep-crawl/route.ts", schema: "DeepCrawlSchema" },
  { file: "src/app/api/content/route.ts", schema: "ContentAnalyzeSchema" },
  { file: "src/app/api/intelligence/route.ts", schema: "IntelligenceRunSchema" },
  { file: "src/app/api/annotations/route.ts", schema: "AnnotationsCreateSchema" },
  { file: "src/app/api/demand/route.ts", schema: "DemandRefreshSchema" },
  { file: "src/app/api/distribution/route.ts", schema: "DistributionScheduleSchema" },
  { file: "src/app/api/panels/route.ts", schema: "PanelCreateSchema" },
  { file: "src/app/api/leads/convert/route.ts", schema: "LeadsConvertSchema" },
  { file: "src/app/api/embed/audit-snippet/route.ts", schema: "EmbedAuditSnippetSchema" },
  { file: "src/app/api/attribution/plausible/route.ts", schema: "AttributionPlausibleSchema" },
  { file: "src/app/api/attribution/referrals/route.ts", schema: "AttributionReferralsSchema" },
  { file: "src/app/api/traffic-panel/ingest/route.ts", schema: "TrafficPanelIngestSchema" },
  { file: "src/app/api/projects/[id]/rescan/route.ts", schema: "RescanSchema" },
  { file: "src/app/api/geo-rewrite/route.ts", schema: "GeoRewriteSchema" },
  { file: "src/app/api/auth/register/route.ts", schema: "AuthRegisterSchema" },
  { file: "src/app/api/auth/setup-org/route.ts", schema: "AuthSetupOrgSchema" },
  { file: "src/app/api/oauth/route.ts", schema: "OAuthConnectSchema" },
  { file: "src/app/api/panels/[id]/run/route.ts", schema: "PanelRunSchema" },
];

const schemaSrc = readFileSync(join(root, "src/lib/validation/schemas.ts"), "utf8");
const schemaCount = (schemaSrc.match(/export const \w+Schema/g) || []).length;
if (schemaCount < 30) {
  console.error(`verify:zod-coverage — FAIL: only ${schemaCount} exported schemas (need ≥30)`);
  process.exit(1);
}

const errors = [];
for (const r of ROUTES) {
  const path = join(root, r.file);
  if (!existsSync(path)) {
    errors.push(`${r.file}: missing`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  if (!src.includes("validateBody")) errors.push(`${r.file}: missing validateBody`);
  if (!src.includes(r.schema)) errors.push(`${r.file}: missing ${r.schema}`);
}

console.log(`verify:zod-coverage — ${ROUTES.length} routes, ${schemaCount} schemas, ${errors.length} issue(s)`);
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("verify:zod-coverage — OK");
process.exit(0);
