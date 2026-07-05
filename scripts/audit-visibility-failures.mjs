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

const { data: vis } = await s
  .from("visibility_results")
  .select("engine, data_source, raw_response, prompt_text, created_at")
  .eq("project_id", projectId)
  .eq("engine", "chatgpt")
  .limit(5);

console.log("chatgpt samples:", JSON.stringify(vis, null, 2));

const { data: runs } = await s
  .from("visibility_runs")
  .select("*")
  .eq("project_id", projectId)
  .order("created_at", { ascending: false })
  .limit(3);
console.log("runs:", JSON.stringify(runs, null, 2));

const { data: traces } = await s
  .from("ai_probe_traces")
  .select("engine, data_source, grounding_mode, model, checked_at")
  .eq("project_id", projectId)
  .limit(10);
console.log("traces:", JSON.stringify(traces, null, 2));
