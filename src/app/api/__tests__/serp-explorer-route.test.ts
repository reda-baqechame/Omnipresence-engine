import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let authed = true;
let projectAccess = true;
let serpAvailable = true;
let serpResult: unknown = {
  provider: "omnidata",
  organic: [],
  ads: [],
  peopleAlsoAsk: [],
  localPack: [],
  featureTypes: [],
};

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: authed ? { id: "user-1" } : null } }),
      },
    }),
  },
});

mock.module("@/lib/security/project-access", {
  namedExports: {
    verifyProjectAccess: async () => projectAccess,
  },
});

mock.module("@/lib/providers/serp-intelligence-router", {
  namedExports: {
    isSerpIntelligenceAvailable: () => serpAvailable,
    serpIntelligenceUnavailableReason: () => "SERP unavailable",
    routeSerpIntelligence: async () => serpResult,
  },
});

mock.module("@/lib/engines/evidence", {
  namedExports: {
    recordMeasurementEvidence: async () => {},
  },
});

const { POST } = await import("../serp-explorer/route.ts");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/serp-explorer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

test("serp-explorer: unauthenticated denied", async () => {
  authed = false;
  const res = await post({ projectId: PROJECT_ID, keyword: "crm" });
  assert.equal(res.status, 401);
  authed = true;
});

test("serp-explorer: non-member denied", async () => {
  projectAccess = false;
  const res = await post({ projectId: PROJECT_ID, keyword: "crm" });
  assert.equal(res.status, 403);
  projectAccess = true;
});

test("serp-explorer: unavailable when routed backend inactive", async () => {
  serpAvailable = false;
  const res = await post({ projectId: PROJECT_ID, keyword: "crm" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.available, false);
  serpAvailable = true;
});

test("serp-explorer: returns honest unavailable on provider failure", async () => {
  serpResult = null;
  const res = await post({ projectId: PROJECT_ID, keyword: "crm" });
  const json = await res.json();
  assert.equal(json.available, false);
  serpResult = {
    provider: "omnidata",
    organic: [{ position: 1, title: "t", url: "https://a.example", domain: "a.example" }],
    ads: [],
    peopleAlsoAsk: [],
    localPack: [],
    featureTypes: ["organic"],
  };
});

test("serp-explorer: success path returns serp payload", async () => {
  const res = await post({ projectId: PROJECT_ID, keyword: "crm" });
  const json = await res.json();
  assert.equal(json.available, true);
  assert.ok(json.serp);
});
