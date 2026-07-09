import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let authorized = true;
let lastLimit = 0;

mock.module("@/lib/security/admin-auth", {
  namedExports: {
    isPlatformAdminAuthorized: async () => authorized,
  },
});

mock.module("@/lib/supabase/server", {
  namedExports: {
    createServiceClient: async () => ({
      from(table: string) {
        assert.equal(table, "report_quality_violations");
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              order() {
                return chain;
              },
              limit(n: number) {
                lastLimit = n;
                return chain;
              },
              then(onFulfilled: (v: { data: unknown[]; error: null; count: number }) => void) {
                onFulfilled({
                  data: [{ id: "v1", severity: "warning", claim_id: "roadmap.item.0" }],
                  error: null,
                  count: 1,
                });
              },
            };
            return chain;
          },
        };
      },
    }),
  },
});

const { GET } = await import("../admin/report-quality-violations/route.ts");

test("report-quality-violations: unauthenticated denied", async () => {
  authorized = false;
  const res = await GET(new NextRequest("http://localhost/api/admin/report-quality-violations"));
  assert.equal(res.status, 401);
  authorized = true;
});

test("report-quality-violations: admin allowed with bounded limit", async () => {
  const res = await GET(
    new NextRequest("http://localhost/api/admin/report-quality-violations?limit=9999&severity=warning")
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.rows));
  assert.equal(json.limit, 200);
  assert.equal(lastLimit, 200);
});

test("report-quality-violations: invalid severity rejected", async () => {
  const res = await GET(
    new NextRequest("http://localhost/api/admin/report-quality-violations?severity=critical")
  );
  assert.equal(res.status, 400);
});
