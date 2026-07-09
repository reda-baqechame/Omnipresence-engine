import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { evaluateRlsLiveGuard } from "@/lib/security/rls-live-guard";

test("RLS guard: skips when credentials missing", () => {
  const reason = evaluateRlsLiveGuard({});
  assert.ok(reason);
  assert.match(reason!, /SUPABASE_TEST/);
});

test("RLS guard: skips without ALLOW_LIVE_RLS", () => {
  const reason = evaluateRlsLiveGuard({
    testUrl: "https://staging-test.supabase.co",
    testAnon: "anon",
    testService: "service",
    confirmNonProd: "1",
    testEnv: "staging",
  });
  assert.match(reason!, /ALLOW_LIVE_RLS/);
});

test("RLS guard: blocks production-like URLs", () => {
  const reason = evaluateRlsLiveGuard({
    testUrl: "https://my-prod-project.supabase.co",
    testAnon: "anon",
    testService: "service",
    allowLive: "1",
    confirmNonProd: "1",
    testEnv: "staging",
  });
  assert.match(reason!, /production|prod/i);
});

test("RLS guard: requires non-prod confirmation", () => {
  const reason = evaluateRlsLiveGuard({
    testUrl: "https://staging-test.supabase.co",
    testAnon: "anon",
    testService: "service",
    allowLive: "1",
  });
  assert.match(reason!, /CONFIRM_NON_PROD|staging|test|PROJECT_REF|URL_CONFIRM/);
});

test("RLS guard: passes with staging env marker", () => {
  const reason = evaluateRlsLiveGuard({
    testUrl: "https://staging-test.supabase.co",
    testAnon: "anon",
    testService: "service",
    allowLive: "1",
    confirmNonProd: "1",
    testEnv: "staging",
  });
  assert.equal(reason, null);
});

test("RLS guard: passes with explicit URL confirm", () => {
  const reason = evaluateRlsLiveGuard({
    testUrl: "https://abc123.supabase.co",
    testAnon: "anon",
    testService: "service",
    allowLive: "1",
    confirmNonProd: "1",
    testUrlConfirm: "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION",
  });
  assert.equal(reason, null);
});
