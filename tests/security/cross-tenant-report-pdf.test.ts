import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch E: HTTP-level cross-tenant proof for GET /api/report/[token]/pdf.
 *
 * This route is INTENTIONALLY public (an unguessable 128-bit share_token is
 * the capability, not a session) — report-pdf-degraded-header.test.ts
 * (src/app/api/__tests__/) already pins its header contract for every
 * "is_public: true" branch. "Cross-tenant" for a public-token route does not
 * mean an org-membership check; it means:
 *   1. `is_public: false` (a revoked/never-shared report) must 404 for EVERY
 *      token, even the report's own correct token — this is the only
 *      mechanism that stops a report from being permanently public once its
 *      token has leaked or been guessed.
 *   2. The lookup is a strict equality match on share_token — a token from
 *      one org's report must never resolve to a different org's report row,
 *      and an empty/malformed token must never fall through to "any" report.
 */

interface ReportRow {
  project_id: string;
  is_public: boolean;
  report_type: "standard" | "deep";
  status: string;
  pdf_storage_path: string | null;
  html_storage_path: string | null;
  pdf_degraded: boolean;
  sections: string[] | null;
}

// Two orgs' reports, keyed by their real share_token — the mock's `.eq()`
// enforces exact-match lookup exactly like the real query.
const reportsByToken: Record<string, ReportRow> = {
  "tok-org-a": {
    project_id: "proj-a",
    is_public: true,
    report_type: "standard",
    status: "ready",
    pdf_storage_path: "reports/proj-a/r-a.pdf",
    html_storage_path: null,
    pdf_degraded: false,
    sections: null,
  },
  "tok-org-b-private": {
    project_id: "proj-b",
    is_public: false,
    report_type: "standard",
    status: "ready",
    pdf_storage_path: "reports/proj-b/r-b.pdf",
    html_storage_path: null,
    pdf_degraded: false,
    sections: null,
  },
};

const storage = new Map<string, string>([
  ["reports/proj-a/r-a.pdf", "ORG-A-REAL-PDF-BYTES"],
  ["reports/proj-b/r-b.pdf", "ORG-B-REAL-PDF-BYTES"],
]);

let lastLookupToken: string | null = null;

const serviceClient = {
  from: (table: string) => {
    assert.equal(table, "reports");
    return {
      select: () => ({
        eq: (_col: string, token: string) => {
          lastLookupToken = token;
          return { single: async () => ({ data: reportsByToken[token] ?? null }) };
        },
      }),
    };
  },
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, "reports");
      return {
        download: async (path: string) => {
          const content = storage.get(path);
          if (content === undefined) return { data: null, error: { message: "not found" } };
          return { data: { arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer }, error: null };
        },
      };
    },
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createServiceClient: async () => serviceClient, createClient: async () => serviceClient },
});

mock.module("@/lib/engines/report-builder", {
  namedExports: {
    renderReportHtmlForView: async () => null,
    gatherReportData: async () => null,
  },
});

mock.module("@/lib/providers/ai-ui-capture", {
  namedExports: { renderReportPdf: async () => null },
});

mock.module("@/lib/engines/report-pdf", {
  namedExports: {
    generateReportPDF: async () => {
      throw new Error("must not regenerate — a private/nonexistent report should 404 before this point");
    },
  },
});

mock.module("@/lib/security/public-guard", {
  namedExports: { guardPublicEndpoint: async () => null },
});

mock.module("@/lib/security/rate-limit", {
  namedExports: {
    checkRateLimitDistributed: async () => ({ allowed: true }),
    rateLimitResponse: () => new Response("rate limited", { status: 429 }),
  },
});

const { GET } = await import("../../src/app/api/report/[token]/pdf/route.ts");

function req(token: string) {
  return new NextRequest(`http://localhost/api/report/${token}/pdf`);
}

test("cross-tenant: a revoked (is_public: false) report 404s even for its own correct token", async () => {
  lastLookupToken = null;
  const res = await GET(req("tok-org-b-private"), { params: Promise.resolve({ token: "tok-org-b-private" }) });
  assert.equal(res.status, 404);
  assert.equal(lastLookupToken, "tok-org-b-private", "the route must look up by the exact requested token, not fall back");
});

test("cross-tenant: an unknown/guessed token never resolves to another org's report", async () => {
  const res = await GET(req("tok-does-not-exist"), { params: Promise.resolve({ token: "tok-does-not-exist" }) });
  assert.equal(res.status, 404);
});

test("cross-tenant: a valid public token returns exactly that org's stored PDF bytes, never another org's", async () => {
  const res = await GET(req("tok-org-a"), { params: Promise.resolve({ token: "tok-org-a" }) });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.toString(), "ORG-A-REAL-PDF-BYTES");
});

test("cross-tenant: empty token string never falls through to returning any report", async () => {
  const res = await GET(req(""), { params: Promise.resolve({ token: "" }) });
  assert.equal(res.status, 404);
});
