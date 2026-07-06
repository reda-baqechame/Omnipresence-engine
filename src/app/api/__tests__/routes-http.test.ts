import { test } from "node:test";
import assert from "node:assert/strict";
import { BillingCheckoutSchema, V1ScanSchema, parseOrError } from "@/lib/validation/schemas";

test("billing checkout rejects invalid plan via Zod", () => {
  const parsed = parseOrError(BillingCheckoutSchema, { plan: "not-a-plan" });
  assert.equal(parsed.ok, false);
  const valid = parseOrError(BillingCheckoutSchema, { plan: "tracking" });
  assert.equal(valid.ok, true);
});

test("v1 scan schema requires projectIds or all:true", () => {
  const bad = parseOrError(V1ScanSchema, {});
  assert.equal(bad.ok, false);
  const good = parseOrError(V1ScanSchema, { all: true });
  assert.equal(good.ok, true);
  const ids = parseOrError(V1ScanSchema, {
    projectIds: ["550e8400-e29b-41d4-a716-446655440000"],
  });
  assert.equal(ids.ok, true);
});

test("hardened route schema registry has at least 30 entries", async () => {
  const mod = await import("@/lib/validation/schemas");
  const count = Object.keys(mod.HARDENED_ROUTE_SCHEMAS).length;
  assert.ok(count >= 30, `expected >=30 hardened routes, got ${count}`);
});
