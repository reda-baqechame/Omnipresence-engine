import { test } from "node:test";
import assert from "node:assert/strict";
import { writeCaptureEvidence } from "../evidence-writer.js";

test("writeCaptureEvidence persists local artifacts without Supabase", async () => {
  const prev = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  const paths = await writeCaptureEvidence({
    surface: "chatgpt",
    responseHash: "abc123hash",
    answer: "test answer",
    citedUrls: ["https://example.com"],
  });
  assert.ok(paths.answerPath);
  assert.equal(paths.evidencePublicUrl, null);
  if (prev) process.env.SUPABASE_URL = prev;
});
