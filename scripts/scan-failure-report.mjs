#!/usr/bin/env node
/**
 * Visibility scan failure diagnostics — group results by engine + unavailable reason.
 *
 * Usage:
 *   node scripts/scan-failure-report.mjs
 *   node scripts/scan-failure-report.mjs --project <id>
 *   node scripts/scan-failure-report.mjs --all-projects
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

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const allProjects = args.includes("--all-projects");
const projectId = arg("--project") || "b1055406-874d-4f5b-975a-9be1bf6aabbf";
const MIN_MEASURED_RATE = Number(process.env.MIN_MEASURED_RATE || 1);

const { assessVisibilityRunQuality } = await import("../src/lib/engines/visibility-run-quality.ts");

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function summarizeResults(rows) {
  const byEngine = {};
  const byReason = {};
  const bySource = { measured: 0, model_knowledge: 0, unavailable: 0 };

  for (const r of rows) {
    bySource[r.data_source] = (bySource[r.data_source] || 0) + 1;
    byEngine[r.engine] = byEngine[r.engine] || { measured: 0, model_knowledge: 0, unavailable: 0 };
    byEngine[r.engine][r.data_source] = (byEngine[r.engine][r.data_source] || 0) + 1;
    if (r.data_source === "unavailable") {
      const reason = r.raw_response?.reason || "unknown";
      const key = `${r.engine}::${reason}`;
      byReason[key] = (byReason[key] || 0) + 1;
    }
  }

  const quality = assessVisibilityRunQuality(rows.map((r) => ({ data_source: r.data_source, engine: r.engine })));
  return { byEngine, byReason, bySource, quality };
}

async function latestRunResults(pid) {
  const { data: run } = await service
    .from("visibility_runs")
    .select("id, status, created_at")
    .eq("project_id", pid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run?.id) return { run: null, rows: [] };

  const { data: rows } = await service
    .from("visibility_results")
    .select("engine, data_source, raw_response")
    .eq("run_id", run.id);

  return { run, rows: rows || [] };
}

if (allProjects) {
  const { data: projects } = await service.from("projects").select("id, name, status").neq("status", "archived");
  const fleet = [];
  let failures = 0;

  for (const p of projects || []) {
    const { run, rows } = await latestRunResults(p.id);
    if (!rows.length) continue;
    const summary = summarizeResults(rows);
    const ok = summary.quality.measuredRate >= MIN_MEASURED_RATE && summary.quality.unavailable === 0 && summary.quality.modelKnowledge === 0;
    if (!ok) failures++;
    fleet.push({
      projectId: p.id,
      name: p.name,
      runId: run?.id,
      runStatus: run?.status,
      ...summary,
    });
  }

  console.log(JSON.stringify({ mode: "fleet", minMeasuredRate: MIN_MEASURED_RATE, failures, projects: fleet }, null, 2));
  process.exit(failures > 0 ? 1 : 0);
}

const { run, rows } = await latestRunResults(projectId);
if (!rows.length) {
  console.error("No visibility results for project", projectId);
  process.exit(1);
}

const summary = summarizeResults(rows);
console.log(
  JSON.stringify(
    {
      projectId,
      runId: run?.id,
      runStatus: run?.status,
      minMeasuredRate: MIN_MEASURED_RATE,
      ...summary,
    },
    null,
    2
  )
);

const ok =
  summary.quality.measuredRate >= MIN_MEASURED_RATE &&
  summary.quality.unavailable === 0 &&
  summary.quality.modelKnowledge === 0;
process.exit(ok ? 0 : 1);
