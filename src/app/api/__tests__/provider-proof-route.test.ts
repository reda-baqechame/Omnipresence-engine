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
    createServiceClient: async () => ({}),
  },
});

mock.module("@/lib/engines/provider-proof", {
  namedExports: {
    loadProviderProofCockpit: async () => ({
      generatedAt: new Date().toISOString(),
      adapters: [],
      capabilities: [],
      demotion: [],
      rowCount: 0,
      honestSummary: "No benchmark evidence yet.",
    }),
  },
});

const { GET } = await import("../admin/provider-proof/route.ts");

test("provider-proof: unauthorized without admin", async () => {
  authorized = false;
  const res = await GET(new NextRequest("http://localhost/api/admin/provider-proof"));
  assert.equal(res.status, 401);
  authorized = true;
});

test("provider-proof: authorized returns cockpit JSON", async () => {
  authorized = true;
  const res = await GET(new NextRequest("http://localhost/api/admin/provider-proof"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rowCount, 0);
  assert.ok(typeof body.honestSummary === "string");
});
