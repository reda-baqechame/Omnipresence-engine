#!/usr/bin/env node
/**
 * Run a full live project scan against production Supabase + provider keys.
 * Usage: node --import ./tests/_lib/register-loader.mjs scripts/run-live-rescan-runner.mjs [projectId]
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.migrate.tmp", ".env.vercel.production"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const projectId = process.argv[2] || "b1055406-874d-4f5b-975a-9be1bf6aabbf";

const { runProjectScan, getOwnerEmail } = await import("../src/lib/engines/scan-runner.ts");
const { assessVisibilityRunQuality } = await import("../src/lib/engines/visibility-run-quality.ts");

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("Starting live scan for project", projectId);
console.log("LLM keys:", {
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  google: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
  perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
  omnidata: Boolean(process.env.OMNIDATA_BASE_URL && process.env.OMNIDATA_API_KEY),
});

await service.from("projects").update({ status: "scanning" }).eq("id", projectId);

const { data: project } = await service.from("projects").select("organization_id").eq("id", projectId).single();
const email = project?.organization_id ? await getOwnerEmail(service, project.organization_id) : undefined;

const started = Date.now();
const result = await runProjectScan(service, projectId, { notifyEmail: email });
const elapsed = Math.round((Date.now() - started) / 1000);

const { data: vis } = await service
  .from("visibility_results")
  .select("engine, data_source")
  .eq("project_id", projectId);

const byEngine = {};
const bySource = {};
for (const r of vis || []) {
  byEngine[r.engine] = byEngine[r.engine] || { measured: 0, model: 0, unavailable: 0 };
  if (r.data_source === "measured") byEngine[r.engine].measured++;
  else if (r.data_source === "model_knowledge") byEngine[r.engine].model++;
  else byEngine[r.engine].unavailable++;
  bySource[r.data_source] = (bySource[r.data_source] || 0) + 1;
}

console.log("\nScan finished in", elapsed + "s");
console.log("Score:", result.score);
console.log("Provenance:", bySource);
console.log("By engine:", JSON.stringify(byEngine, null, 2));

const quality = assessVisibilityRunQuality(
  (vis || []).map((r) => ({ data_source: r.data_source, engine: r.engine }))
);
console.log("Quality:", quality);

process.exit(quality.acceptable ? 0 : 1);
