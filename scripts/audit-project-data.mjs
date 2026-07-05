#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.migrate.tmp"]) {
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
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: project } = await s.from("projects").select("*").eq("id", projectId).single();

const tables = [
  ["visibility_results", "*"],
  ["prompts", "id,text,category,priority,is_tracked,created_at"],
  ["scores", "*"],
  ["technical_findings", "id,title,severity,category,data_source"],
  ["authority_opportunities", "id,type,target_site,target_url,data_source,is_estimated,estimated_impact,evidence_url"],
  ["execution_tasks", "id,title,status,source_module,evidence,impact,description"],
  ["roadmaps", "id,items,created_at"],
  ["brand_profiles", "*"],
];

for (const [table, sel] of tables) {
  const q = s.from(table).select(sel).eq("project_id", projectId).order("created_at", { ascending: false }).limit(5);
  const { data, error } = await q;
  if (error) console.log(`\n## ${table} ERROR`, error.message);
  else console.log(`\n## ${table} (${data?.length || 0} rows sampled)`);
}

// Visibility breakdown
const { data: vis } = await s.from("visibility_results").select("engine,data_source,measurement_mode,brand_mentioned,brand_cited,confidence").eq("project_id", projectId);
const byEngine = {};
const bySource = {};
for (const r of vis || []) {
  byEngine[r.engine] = byEngine[r.engine] || { total: 0, mentioned: 0, cited: 0, sources: {} };
  byEngine[r.engine].total++;
  if (r.brand_mentioned) byEngine[r.engine].mentioned++;
  if (r.brand_cited) byEngine[r.engine].cited++;
  byEngine[r.engine].sources[r.data_source] = (byEngine[r.engine].sources[r.data_source] || 0) + 1;
  bySource[r.data_source] = (bySource[r.data_source] || 0) + 1;
}
console.log("\n## visibility breakdown", JSON.stringify({ total: vis?.length, byEngine, bySource }, null, 2));

// Prompts sample
const { data: prompts } = await s.from("prompts").select("text,category,priority,is_tracked").eq("project_id", projectId).limit(15);
console.log("\n## sample prompts", JSON.stringify(prompts?.slice(0, 8), null, 2));

// Generic tasks
const { data: tasks } = await s.from("execution_tasks").select("title,source_module,evidence,impact,description").eq("project_id", projectId).limit(20);
console.log("\n## sample tasks", JSON.stringify(tasks?.slice(0, 10), null, 2));

// Roadmap items
const { data: roadmap } = await s.from("roadmaps").select("items").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
const items = (roadmap?.items || []).slice(0, 8);
console.log("\n## roadmap sample", JSON.stringify(items, null, 2));

// Simulated/estimated counts (tables with data_source column only)
for (const table of ["visibility_results", "authority_opportunities"]) {
  const { count: sim } = await s.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("data_source", "simulated");
  const { count: est } = await s.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("data_source", "estimated");
  const { count: unav } = await s.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("data_source", "unavailable");
  console.log(`\n## ${table} provenance counts`, { simulated: sim, estimated: est, unavailable: unav });
}

console.log("\nProject:", project?.name, project?.domain, project?.status);
