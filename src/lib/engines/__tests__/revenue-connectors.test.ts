import { test } from "node:test";
import assert from "node:assert/strict";
import {
  syncStripeRevenue,
  syncShopifyRevenue,
  syncHubspotCrm,
} from "../revenue-connectors.ts";

/**
 * Unit tests for the first-party revenue / CRM connectors (Wave S1). We stub the
 * global fetch so the parsing + summing logic is exercised without network, and
 * we assert the refund-safety contract: a failed upstream call must surface as
 * available:false, never a confident zero presented as measured.
 */

type FetchImpl = typeof globalThis.fetch;

function withFetch(impl: (url: string, init?: RequestInit) => unknown, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(impl(String(url), init))) as unknown as FetchImpl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    headers: { get: (k: string) => init?.headers?.[k.toLowerCase()] ?? init?.headers?.[k] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("stripe revenue sums succeeded, non-refunded charges in major units", async () => {
  await withFetch(
    () =>
      jsonResponse({
        data: [
          { id: "ch_1", amount: 10000, currency: "usd", paid: true, refunded: false, amount_refunded: 0, status: "succeeded" },
          { id: "ch_2", amount: 5000, currency: "usd", paid: true, refunded: true, amount_refunded: 5000, status: "succeeded" },
          { id: "ch_3", amount: 2000, currency: "usd", paid: false, refunded: false, amount_refunded: 0, status: "failed" },
        ],
        has_more: false,
      }),
    async () => {
      const r = await syncStripeRevenue("sk_test_x", 0);
      assert.equal(r.available, true);
      assert.equal(r.purchases, 1);
      assert.equal(r.revenue, 100);
    }
  );
});

test("stripe failure is unavailable, not a confident zero", async () => {
  await withFetch(
    () => jsonResponse({ error: "bad key" }, { status: 401 }),
    async () => {
      const r = await syncStripeRevenue("bad", 0);
      assert.equal(r.available, false);
      assert.equal(r.revenue, 0);
    }
  );
});

test("shopify counts only paid/partially_paid orders", async () => {
  await withFetch(
    () =>
      jsonResponse({
        orders: [
          { total_price: "49.99", financial_status: "paid" },
          { total_price: "10.00", financial_status: "pending" },
          { total_price: "20.00", financial_status: "partially_paid" },
        ],
      }),
    async () => {
      const r = await syncShopifyRevenue("acme.myshopify.com", "tok", "2026-01-01T00:00:00Z");
      assert.equal(r.available, true);
      assert.equal(r.purchases, 2);
      assert.equal(r.revenue, 69.99);
    }
  );
});

test("hubspot splits closed-won from open pipeline", async () => {
  let call = 0;
  await withFetch(
    (url) => {
      call += 1;
      if (url.includes("/contacts/search")) return jsonResponse({ total: 7 });
      return jsonResponse({
        results: [
          { properties: { amount: "1000", hs_is_closed_won: "true" } },
          { properties: { amount: "500", hs_is_closed_won: "false" } },
        ],
      });
    },
    async () => {
      const r = await syncHubspotCrm("tok", 0);
      assert.equal(r.available, true);
      assert.equal(r.leads, 7);
      assert.equal(r.wonValue, 1000);
      assert.equal(r.pipelineValue, 500);
      assert.ok(call >= 2);
    }
  );
});
