/**
 * Live RLS test environment guards — extracted for unit testing (Shot 2).
 * See docs/audits/live-rls-test-setup.md
 */

const PROD_URL_HINTS = ["prod", "production", "live", "primary"] as const;

export interface RlsLiveGuardEnv {
  testUrl?: string;
  testAnon?: string;
  testService?: string;
  allowLive?: string;
  confirmNonProd?: string;
  testEnv?: string;
  testProjectRef?: string;
  testUrlConfirm?: string;
  publicUrl?: string;
}

export function evaluateRlsLiveGuard(env: RlsLiveGuardEnv = {}): string | null {
  const testUrl = env.testUrl ?? process.env.SUPABASE_TEST_URL;
  const testAnon = env.testAnon ?? process.env.SUPABASE_TEST_ANON_KEY;
  const testService = env.testService ?? process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  const allowLive = env.allowLive ?? process.env.SUPABASE_TEST_ALLOW_LIVE_RLS;
  const confirmNonProd = env.confirmNonProd ?? process.env.SUPABASE_TEST_CONFIRM_NON_PROD;
  const testEnv = env.testEnv ?? process.env.SUPABASE_TEST_ENV;
  const testProjectRef = env.testProjectRef ?? process.env.SUPABASE_TEST_PROJECT_REF;
  const testUrlConfirm = env.testUrlConfirm ?? process.env.SUPABASE_TEST_URL_CONFIRM;
  const publicUrl =
    env.publicUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";

  if (!testUrl || !testAnon || !testService) {
    return "Missing SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, or SUPABASE_TEST_SERVICE_ROLE_KEY — see docs/audits/live-rls-test-setup.md";
  }
  if (allowLive !== "1") {
    return "SUPABASE_TEST_ALLOW_LIVE_RLS is not set to 1 — refusing to run live RLS tests without explicit opt-in";
  }
  if (confirmNonProd !== "1") {
    return "SUPABASE_TEST_CONFIRM_NON_PROD is not set to 1 — refusing without explicit non-production confirmation";
  }

  const lower = testUrl.toLowerCase();
  if (PROD_URL_HINTS.some((h) => lower.includes(h))) {
    return `SUPABASE_TEST_URL looks like production (${testUrl}) — refusing`;
  }
  if (publicUrl && testUrl === publicUrl && PROD_URL_HINTS.some((h) => publicUrl.toLowerCase().includes(h))) {
    return "SUPABASE_TEST_URL matches a production-looking NEXT_PUBLIC_SUPABASE_URL — refusing";
  }

  const safeEnv = testEnv === "staging" || testEnv === "test";
  const hasProjectRef = Boolean(testProjectRef && lower.includes(testProjectRef.toLowerCase()));
  const hasExplicitConfirm = testUrlConfirm === "I_UNDERSTAND_THIS_IS_NOT_PRODUCTION";

  if (!safeEnv && !hasProjectRef && !hasExplicitConfirm) {
    return "Live RLS requires SUPABASE_TEST_ENV=staging|test, SUPABASE_TEST_PROJECT_REF matching the URL, or SUPABASE_TEST_URL_CONFIRM=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION";
  }

  return null;
}
