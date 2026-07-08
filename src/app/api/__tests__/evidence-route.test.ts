import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P2 fix ("Evidence Drawer field parity"): confidence, trace_id, and
 * captured_at were persisted on measurement_evidence/ai_capture_evidence rows
 * (migrations 0059/0067) but GET /api/evidence never selected trace_id or
 * captured_at, so the drawer had no freshness/trace signal to show even
 * though the data existed. This pins the route's SELECT + response shape so
 * a future refactor can't silently drop those columns again.
 */

const measurementRow = {
  id: "meas-1",
  capability: "rank",
  target: "best crm",
  provider: "serper",
  source_url: "https://google.com/search?q=best+crm",
  parser_version: "rank-tracker@1",
  data_source: "measured",
  confidence: 0.82,
  response_hash: "a".repeat(64),
  payload_excerpt: { position: 3 },
  evidence_url: "measurement/proj-1/rank/best-crm.json",
  trace_id: "trace-abc123",
  captured_at: "2026-07-01T00:00:00.000Z",
  created_at: "2026-07-01T00:00:05.000Z",
};

const aiCaptureRow = {
  id: "ai-1",
  engine: "chatgpt",
  prompt: "best crm for startups",
  raw_answer: "Here are some options...",
  response_hash: "b".repeat(64),
  cited_urls: ["https://example.com"],
  source_domains: ["example.com"],
  evidence_url: null,
  trace_id: "trace-def456",
  captured_at: "2026-07-02T00:00:00.000Z",
  created_at: "2026-07-02T00:00:05.000Z",
};

const sessionClient = {
  auth: {
    getUser: async () => ({ data: { user: { id: "user-1" } } }),
  },
  from(table: string) {
    if (table === "projects") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1", organization_id: "org-1" } }) }) }) };
    }
    if (table === "memberships") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { role: "member" } }) }) }) }),
      };
    }
    if (table === "measurement_evidence") {
      return selectChain([measurementRow]);
    }
    if (table === "ai_capture_evidence") {
      return selectChain([aiCaptureRow]);
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

/**
 * Mimics the real Supabase query builder: every method returns the same
 * chainable object (so callers can keep calling .eq()/.ilike() even after
 * .limit(), exactly as evidence/route.ts does), and the chain itself is
 * thenable so `await`/`Promise.all([...])` resolves it as `{ data }`.
 */
function selectChain<T>(rows: T[]) {
  let limited: number | null = null;
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    ilike() {
      return chain;
    },
    order() {
      return chain;
    },
    limit(n: number) {
      limited = n;
      return chain;
    },
    then(resolve: (v: { data: T[] }) => void) {
      // Route calls `.limit(0)` to suppress ai rows for non-ai capability filters.
      resolve({ data: limited === 0 ? [] : rows });
    },
  };
  return chain;
}

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => sessionClient,
  },
});

const { GET } = await import("../evidence/route.ts");

test("GET /api/evidence selects and returns confidence, trace_id, and captured_at on measurement rows", async () => {
  const req = new NextRequest("http://localhost/api/evidence?projectId=proj-1&capability=rank&target=best");
  const res = await GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.measurement.length, 1);
  const row = body.measurement[0];
  assert.equal(row.confidence, 0.82);
  assert.equal(row.trace_id, "trace-abc123");
  assert.equal(row.captured_at, "2026-07-01T00:00:00.000Z");
});

test("GET /api/evidence selects and returns trace_id and captured_at on ai_capture rows", async () => {
  const req = new NextRequest("http://localhost/api/evidence?projectId=proj-1&capability=ai");
  const res = await GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.aiCapture.length, 1);
  const row = body.aiCapture[0];
  assert.equal(row.trace_id, "trace-def456");
  assert.equal(row.captured_at, "2026-07-02T00:00:00.000Z");
});

test("GET /api/evidence requires a projectId", async () => {
  const req = new NextRequest("http://localhost/api/evidence");
  const res = await GET(req);
  assert.equal(res.status, 400);
});
