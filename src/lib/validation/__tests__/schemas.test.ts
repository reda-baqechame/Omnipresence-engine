import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrError, OpsCreateSchema, OpsPatchSchema, KeywordsSchema } from "../schemas.ts";

/**
 * Input validation is a production gate: malformed/hostile bodies must turn into
 * a clean 400 at the edge, never reach the executor/DB. These tests pin the hot
 * ops schemas and the flat error-message shape used by validateBody.
 */

// A valid RFC-variant UUID (zod's .uuid() enforces the version/variant nibbles;
// Supabase gen_random_uuid() always produces these).
const UUID = "550e8400-e29b-41d4-a716-446655440000";

test("OpsCreateSchema accepts a well-formed body", () => {
  const r = parseOrError(OpsCreateSchema, {
    projectId: UUID,
    organizationId: UUID,
    actionType: "content_publish",
    title: "Publish pillar page",
    payload: { assetId: "abc" },
    riskLevel: "low",
  });
  assert.equal(r.ok, true);
});

test("OpsCreateSchema rejects non-uuid ids with a path-prefixed message", () => {
  const r = parseOrError(OpsCreateSchema, {
    projectId: "not-a-uuid",
    organizationId: UUID,
    actionType: "content_publish",
    title: "x",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /projectId/);
});

test("OpsCreateSchema rejects empty title and over-long actionType", () => {
  assert.equal(
    parseOrError(OpsCreateSchema, { projectId: UUID, organizationId: UUID, actionType: "x", title: "" }).ok,
    false
  );
  assert.equal(
    parseOrError(OpsCreateSchema, { projectId: UUID, organizationId: UUID, actionType: "a".repeat(65), title: "ok" }).ok,
    false
  );
});

test("OpsCreateSchema rejects an unknown riskLevel enum", () => {
  const r = parseOrError(OpsCreateSchema, {
    projectId: UUID,
    organizationId: UUID,
    actionType: "content_publish",
    title: "ok",
    riskLevel: "extreme",
  });
  assert.equal(r.ok, false);
});

test("OpsPatchSchema requires at least one mutation", () => {
  assert.equal(parseOrError(OpsPatchSchema, { id: UUID }).ok, false);
  assert.equal(parseOrError(OpsPatchSchema, { id: UUID, execute: true }).ok, true);
  assert.equal(parseOrError(OpsPatchSchema, { id: UUID, status: "approved" }).ok, true);
});

test("OpsPatchSchema rejects an out-of-allowlist status (e.g. completed)", () => {
  // Clients must not be able to mark an item 'completed' directly — only the
  // executor may, after doing the real work.
  assert.equal(parseOrError(OpsPatchSchema, { id: UUID, status: "completed" }).ok, false);
});

test("KeywordsSchema bounds seeds array and geo length", () => {
  assert.equal(parseOrError(KeywordsSchema, { projectId: UUID, seeds: ["a", "b"] }).ok, true);
  assert.equal(
    parseOrError(KeywordsSchema, { projectId: UUID, seeds: Array(201).fill("x") }).ok,
    false
  );
});

test("KeywordsSchema accepts the real route payload variants", () => {
  // bulk_research
  assert.equal(
    parseOrError(KeywordsSchema, {
      projectId: UUID,
      action: "bulk_research",
      seeds: ["plumber near me", "emergency plumber"],
      geo: "US",
    }).ok,
    true
  );
  // universe
  assert.equal(
    parseOrError(KeywordsSchema, { projectId: UUID, action: "universe", seed: "saas seo", depth: "deep" }).ok,
    true
  );
  // difficulty
  assert.equal(parseOrError(KeywordsSchema, { projectId: UUID, action: "difficulty", keyword: "ai seo" }).ok, true);
});

test("KeywordsSchema rejects an unknown action and bad depth", () => {
  assert.equal(parseOrError(KeywordsSchema, { projectId: UUID, action: "delete_everything" }).ok, false);
  assert.equal(parseOrError(KeywordsSchema, { projectId: UUID, depth: "infinite" }).ok, false);
});
