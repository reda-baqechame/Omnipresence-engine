import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveOrgFromMemberships } from "../../src/lib/security/org-context.ts";
import { signTrackingBeacon, verifyTrackingBeacon } from "../../src/lib/security/tracking-beacon.ts";

/**
 * Tenant isolation invariants — org context resolution and beacon signing.
 * Mock-based: exercises pure resolver logic without live Supabase or Next cookies.
 */

test("resolveActiveOrgFromMemberships returns null when user has no memberships", () => {
  assert.equal(resolveActiveOrgFromMemberships([]), null);
});

test("resolveActiveOrgFromMemberships prefers preferred org when user belongs to it", () => {
  const ctx = resolveActiveOrgFromMemberships(
    [
      { organization_id: "org-a", role: "member" },
      { organization_id: "org-b", role: "admin" },
    ],
    "org-b"
  );
  assert.deepEqual(ctx, { orgId: "org-b", role: "admin" });
});

test("resolveActiveOrgFromMemberships ignores foreign preferred org (cross-org isolation)", () => {
  const ctx = resolveActiveOrgFromMemberships(
    [{ organization_id: "org-a", role: "owner" }],
    "org-evil"
  );
  assert.deepEqual(ctx, { orgId: "org-a", role: "owner" });
});

test("resolveActiveOrgFromMemberships falls back to first membership when no preference", () => {
  const ctx = resolveActiveOrgFromMemberships([
    { organization_id: "org-first", role: "member" },
    { organization_id: "org-second", role: "admin" },
  ]);
  assert.deepEqual(ctx, { orgId: "org-first", role: "member" });
});

test("tracking beacon HMAC rejects tampered body", () => {
  const secret = "project-secret-abc";
  const body = JSON.stringify({ projectId: "p1", path: "/" });
  const sig = signTrackingBeacon(body, secret);
  assert.equal(verifyTrackingBeacon(body, secret, sig), true);
  assert.equal(verifyTrackingBeacon(JSON.stringify({ projectId: "p1", path: "/evil" }), secret, sig), false);
  assert.equal(verifyTrackingBeacon(body, secret, null), false);
});

test("tracking beacon HMAC rejects wrong secret", () => {
  const body = JSON.stringify({ projectId: "p1" });
  const sig = signTrackingBeacon(body, "secret-a");
  assert.equal(verifyTrackingBeacon(body, "secret-b", sig), false);
});
