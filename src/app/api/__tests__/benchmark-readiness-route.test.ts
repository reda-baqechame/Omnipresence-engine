import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let authorized = true;
mock.module("@/lib/security/admin-auth", {
  namedExports: {
    isPlatformAdminAuthorized: async () => authorized,
  },
});

mock.module("@/lib/supabase/server", {
  namedExports: {
    createServiceClient: async () => ({
      from: () => ({
        select: () => ({
          gte: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
});

const { GET } = await import("../admin/benchmark-readiness/route.ts");

test("benchmark-readiness: unauthorized without admin", async () => {
  authorized = false;
  const res = await GET(new NextRequest("http://localhost/api/admin/benchmark-readiness"));
  assert.equal(res.status, 401);
  authorized = true;
});

test("benchmark-readiness: authorized returns readiness JSON", async () => {
  authorized = true;
  const res = await GET(new NextRequest("http://localhost/api/admin/benchmark-readiness"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.evidenceStarted, false);
  assert.ok(Array.isArray(body.env));
  assert.ok(Array.isArray(body.manualTriggerNotes));
});
