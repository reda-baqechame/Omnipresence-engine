#!/usr/bin/env node
/**
 * Recover a wedged project and trigger rescan on production, then poll until done.
 *
 * Usage:
 *   node scripts/recover-and-rescan.mjs --project <id>
 *   node scripts/recover-and-rescan.mjs --domain mytegroup.ai
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.production.local"]) {
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

const base =
  args.find((a) => a.startsWith("http")) ||
  process.env.SMOKE_BASE_URL ||
  "https://omnipresence-engine.vercel.app";
const projectIdArg = arg("--project");
const domainArg = arg("--domain");
const email = arg("--email") || "redabaquechame58@gmail.com";
const password = arg("--password") || "OmniReset!mr6nilwwAa1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const cookieJar = new Map();
function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function makeSupabaseAuth() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) cookieJar.set(name, value);
      },
    },
  });
}

async function api(path, opts = {}, timeoutMs = 120_000) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON);
  const { error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Login failed: ${signInError.message}`);

  const sessionClient = makeSupabaseAuth();
  await sessionClient.auth.signInWithPassword({ email, password });

  let projectId = projectIdArg;
  if (!projectId && domainArg) {
    const { data: projects } = await sessionClient
      .from("projects")
      .select("id, domain, status")
      .eq("domain", domainArg)
      .limit(1);
    projectId = projects?.[0]?.id;
  }
  if (!projectId) throw new Error("Provide --project or --domain");

  const { data: project } = await sessionClient
    .from("projects")
    .select("id, name, domain, status")
    .eq("id", projectId)
    .single();
  console.log("Project:", project);

  const { data: activeRun } = await sessionClient
    .from("visibility_runs")
    .select("id, status, started_at")
    .eq("project_id", projectId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRun?.id) {
    const { count } = await sessionClient
      .from("visibility_results")
      .select("id", { count: "exact", head: true })
      .eq("run_id", activeRun.id);
    if ((count ?? 0) === 0) {
      await sessionClient
        .from("visibility_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: "manual_recovery: wedged before rescan",
        })
        .eq("id", activeRun.id);
      await sessionClient.from("projects").update({ status: "active" }).eq("id", projectId);
      console.log("Recovered wedged run", activeRun.id);
    }
  }

  const rescan = await api(`/api/projects/${projectId}/rescan`, { method: "POST", body: "{}" });
  if (!rescan.ok) {
    console.error("Rescan failed", rescan.status, rescan.json);
    process.exit(1);
  }
  console.log("Rescan triggered");

  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const { json } = await api(`/api/projects/${projectId}/scan`, {}, 30_000);
    const st = json?.status;
    const progress = json?.progress?.visibilityResults ?? 0;
    const score = json?.score;
    console.log(
      `[poll] status=${st} progress=${progress} score=${score ?? "—"} message=${json?.message || ""}`
    );
    if (st === "active" && score != null) {
      console.log("✓ Scan complete", { score, progress });
      process.exit(0);
    }
    if (json?.recovered) {
      console.warn("Scan recovered by server — may need another rescan");
    }
    await new Promise((r) => setTimeout(r, 8000));
  }

  console.error("Timed out waiting for scan (20 min)");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
