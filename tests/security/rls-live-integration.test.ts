/**
 * Live/test-schema RLS integration scaffold (repo hardening).
 *
 * Patch E cross-tenant tests use mocked Supabase clients. This file exercises
 * REAL Postgres RLS when a dedicated test Supabase project is configured.
 *
 * SAFETY: skips unless all guards pass. Never runs against production.
 *
 * Setup: docs/audits/live-rls-test-setup.md
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_ANON = process.env.SUPABASE_TEST_ANON_KEY;
const TEST_SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const ALLOW_LIVE = process.env.SUPABASE_TEST_ALLOW_LIVE_RLS === "1";

const PROD_URL_HINTS = ["prod", "production"];
const PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

interface LiveContext {
  service: SupabaseClient;
  orgA: string;
  orgB: string;
  projectA: string;
  projectB: string;
  reportA: string;
  reportB: string;
  runA: string;
  userAId: string;
  userBId: string;
  userAClient: SupabaseClient;
  userBClient: SupabaseClient;
  createdUsers: boolean;
}

let ctx: LiveContext | null = null;

function skipReason(): string | null {
  if (!TEST_URL || !TEST_ANON || !TEST_SERVICE) {
    return "Missing SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, or SUPABASE_TEST_SERVICE_ROLE_KEY — see docs/audits/live-rls-test-setup.md";
  }
  if (!ALLOW_LIVE) {
    return "SUPABASE_TEST_ALLOW_LIVE_RLS is not set to 1 — refusing to run live RLS tests without explicit opt-in";
  }
  const lower = TEST_URL.toLowerCase();
  if (PROD_URL_HINTS.some((h) => lower.includes(h))) {
    return `SUPABASE_TEST_URL looks like production (${TEST_URL}) — refusing`;
  }
  if (PUBLIC_URL && TEST_URL === PUBLIC_URL && PROD_URL_HINTS.some((h) => PUBLIC_URL.toLowerCase().includes(h))) {
    return "SUPABASE_TEST_URL matches a production-looking NEXT_PUBLIC_SUPABASE_URL — refusing";
  }
  return null;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureAuthUser(
  service: SupabaseClient,
  email: string,
  password: string
): Promise<{ id: string; created: boolean }> {
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createErr && created.user) return { id: created.user.id, created: true };

  // User may already exist from a prior failed run — try sign-in to resolve id.
  const anon = createClient(TEST_URL!, TEST_ANON!);
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signIn.user) {
    throw new Error(`Could not create or sign in test user ${email}: ${createErr?.message || signErr?.message}`);
  }
  return { id: signIn.user.id, created: false };
}

async function setupLive(): Promise<LiveContext> {
  const service = createClient(TEST_URL!, TEST_SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const suffix = uid("rls");
  const emailA = process.env.SUPABASE_TEST_USER_A_EMAIL || `rls-a-${suffix}@example.test`;
  const emailB = process.env.SUPABASE_TEST_USER_B_EMAIL || `rls-b-${suffix}@example.test`;
  const passwordA = process.env.SUPABASE_TEST_USER_A_PASSWORD || `Test-${suffix}-A!`;
  const passwordB = process.env.SUPABASE_TEST_USER_B_PASSWORD || `Test-${suffix}-B!`;

  const userA = await ensureAuthUser(service, emailA, passwordA);
  const userB = await ensureAuthUser(service, emailB, passwordB);

  const { data: orgARow, error: orgAErr } = await service
    .from("organizations")
    .insert({ name: `RLS Test Org A ${suffix}` })
    .select("id")
    .single();
  if (orgAErr || !orgARow) throw new Error(`org A insert failed: ${orgAErr?.message}`);

  const { data: orgBRow, error: orgBErr } = await service
    .from("organizations")
    .insert({ name: `RLS Test Org B ${suffix}` })
    .select("id")
    .single();
  if (orgBErr || !orgBRow) throw new Error(`org B insert failed: ${orgBErr?.message}`);

  await service.from("memberships").insert([
    { organization_id: orgARow.id, user_id: userA.id, role: "owner" },
    { organization_id: orgBRow.id, user_id: userB.id, role: "owner" },
  ]);

  const { data: projA, error: projAErr } = await service
    .from("projects")
    .insert({
      organization_id: orgARow.id,
      name: `RLS Project A ${suffix}`,
      domain: `rls-a-${suffix}.example.com`,
    })
    .select("id")
    .single();
  if (projAErr || !projA) throw new Error(`project A insert failed: ${projAErr?.message}`);

  const { data: projB, error: projBErr } = await service
    .from("projects")
    .insert({
      organization_id: orgBRow.id,
      name: `RLS Project B ${suffix}`,
      domain: `rls-b-${suffix}.example.com`,
    })
    .select("id")
    .single();
  if (projBErr || !projB) throw new Error(`project B insert failed: ${projBErr?.message}`);

  const shareTokenA = `rls-token-a-${suffix}`;
  const shareTokenB = `rls-token-b-${suffix}`;

  const { data: reportA, error: repAErr } = await service
    .from("reports")
    .insert({
      project_id: projA.id,
      title: `RLS Report A ${suffix}`,
      status: "generating",
      share_token: shareTokenA,
    })
    .select("id")
    .single();
  if (repAErr || !reportA) throw new Error(`report A insert failed: ${repAErr?.message}`);

  const { data: reportB, error: repBErr } = await service
    .from("reports")
    .insert({
      project_id: projB.id,
      title: `RLS Report B ${suffix}`,
      status: "generating",
      share_token: shareTokenB,
    })
    .select("id")
    .single();
  if (repBErr || !reportB) throw new Error(`report B insert failed: ${repBErr?.message}`);

  const { data: runA, error: runAErr } = await service
    .from("visibility_runs")
    .insert({
      project_id: projA.id,
      status: "running",
      current_step: "rls_test",
      progress_percent: 10,
    })
    .select("id")
    .single();
  if (runAErr || !runA) throw new Error(`visibility_run A insert failed: ${runAErr?.message}`);

  const anonA = createClient(TEST_URL!, TEST_ANON!);
  const { error: signAErr } = await anonA.auth.signInWithPassword({ email: emailA, password: passwordA });
  if (signAErr) throw new Error(`user A sign-in failed: ${signAErr.message}`);

  const anonB = createClient(TEST_URL!, TEST_ANON!);
  const { error: signBErr } = await anonB.auth.signInWithPassword({ email: emailB, password: passwordB });
  if (signBErr) throw new Error(`user B sign-in failed: ${signBErr.message}`);

  return {
    service,
    orgA: orgARow.id,
    orgB: orgBRow.id,
    projectA: projA.id,
    projectB: projB.id,
    reportA: reportA.id,
    reportB: reportB.id,
    runA: runA.id,
    userAId: userA.id,
    userBId: userB.id,
    userAClient: anonA,
    userBClient: anonB,
    createdUsers: userA.created || userB.created,
  };
}

async function teardownLive(c: LiveContext): Promise<void> {
  // Best-effort cleanup — order matters for FK constraints.
  await c.service.from("visibility_runs").delete().in("id", [c.runA]);
  await c.service.from("reports").delete().in("id", [c.reportA, c.reportB]);
  await c.service.from("projects").delete().in("id", [c.projectA, c.projectB]);
  await c.service.from("memberships").delete().in("user_id", [c.userAId, c.userBId]);
  await c.service.from("organizations").delete().in("id", [c.orgA, c.orgB]);
  if (c.createdUsers) {
    await c.service.auth.admin.deleteUser(c.userAId).catch(() => {});
    await c.service.auth.admin.deleteUser(c.userBId).catch(() => {});
  }
}

test("RLS live scaffold: env guard explains skip when not configured", async (t) => {
  const reason = skipReason();
  if (!reason) {
    t.skip("Live RLS env is configured — this meta-test only runs without env");
    return;
  }
  assert.match(reason, /SUPABASE_TEST|ALLOW_LIVE|production/i);
});

test("RLS live: User B cannot SELECT Org A report rows via authenticated anon client", async (t) => {
  const reason = skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  try {
    ctx = await setupLive();

    // User A can see their own report.
    const { data: aRows, error: aErr } = await ctx.userAClient
      .from("reports")
      .select("id, project_id")
      .eq("id", ctx.reportA);
    assert.ifError(aErr);
    assert.equal(aRows?.length, 1, "User A should see own report");

    // User B must NOT see Org A report (RLS isolation).
    const { data: bLeak, error: bErr } = await ctx.userBClient
      .from("reports")
      .select("id, project_id")
      .eq("id", ctx.reportA);
    assert.ifError(bErr);
    assert.equal(
      bLeak?.length ?? 0,
      0,
      "User B must not read Org A report — RLS leak if rows returned"
    );
  } finally {
    if (ctx) {
      await teardownLive(ctx);
      ctx = null;
    }
  }
});

test("RLS live: User B cannot SELECT Org A visibility_runs via authenticated anon client", async (t) => {
  const reason = skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  try {
    ctx = await setupLive();

    const { data: leak, error } = await ctx.userBClient
      .from("visibility_runs")
      .select("id, project_id, current_step")
      .eq("id", ctx.runA);
    assert.ifError(error);
    assert.equal(leak?.length ?? 0, 0, "User B must not read Org A visibility run");
  } finally {
    if (ctx) {
      await teardownLive(ctx);
      ctx = null;
    }
  }
});

test("RLS live: User B cannot SELECT Org A project by id", async (t) => {
  const reason = skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  try {
    ctx = await setupLive();

    const { data: leak, error } = await ctx.userBClient
      .from("projects")
      .select("id, organization_id, domain")
      .eq("id", ctx.projectA);
    assert.ifError(error);
    assert.equal(leak?.length ?? 0, 0, "User B must not read Org A project");
  } finally {
    if (ctx) {
      await teardownLive(ctx);
      ctx = null;
    }
  }
});

test("RLS live: service role can read setup rows (sanity)", async (t) => {
  const reason = skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  try {
    ctx = await setupLive();

    const { data, error } = await ctx.service.from("reports").select("id").eq("id", ctx.reportA);
    assert.ifError(error);
    assert.equal(data?.length, 1);
  } finally {
    if (ctx) {
      await teardownLive(ctx);
      ctx = null;
    }
  }
});

/**
 * TODO (future hardening): measurement_evidence cross-tenant SELECT
 * Requires evidence row schema + RLS policy alignment. Add when
 * SUPABASE_TEST_URL has seed migration for evidence tables.
 */
test("RLS live: measurement_evidence cross-tenant — TODO when evidence insert path confirmed", async (t) => {
  const reason = skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  t.skip(
    "TODO: insert measurement_evidence for projectA via service role, assert User B cannot SELECT — extend after schema review"
  );
});
