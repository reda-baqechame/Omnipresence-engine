import { test } from "node:test";
import assert from "node:assert/strict";
import { opportunityToTaskDraft } from "../searchops-opportunity-engine.ts";
import type { SearchOpsOpportunity } from "../searchops-opportunity-engine.ts";
import { verifySearchOpsTask } from "../searchops-task-loop.ts";
import type { ExecutionTask } from "../../../types/database.ts";

const sampleOp: SearchOpsOpportunity = {
  id: "p1:ai_answer_gap:test",
  projectId: "11111111-1111-1111-1111-111111111111",
  category: "ai_visibility",
  title: "Answer gap: brand absent on test prompt",
  diagnosis: "Measured probe shows brand absent.",
  evidence: [
    {
      label: "Competitor-won prompt",
      source: "visibility_results",
      status: "measured",
      confidence: 0.8,
      value: { prompt: "test", engines: ["chatgpt"] },
    },
  ],
  priority: "high",
  impactType: "measured",
  effort: "high",
  recommendedAction: "Publish an answer-first page for this prompt.",
  verificationPlan: "Re-run visibility probes; brand_mentioned must be true.",
  limitations: ["No guaranteed LLM citation."],
};

test("create draft preserves opportunity id and evidence snapshot", () => {
  const draft = opportunityToTaskDraft(sampleOp);
  assert.equal(draft.source_module, "searchops_opportunity");
  assert.equal(draft.source_id, sampleOp.id);
  assert.equal(draft.evidence.searchops_opportunity_id, sampleOp.id);
  assert.ok(draft.before_metric.primary_evidence);
  assert.ok(Array.isArray(draft.evidence.evidence));
});

function mockSupabase(task: ExecutionTask) {
  let stored = { ...task };
  return {
    from() {
      return {
        update(patch: Record<string, unknown>) {
          stored = { ...stored, ...patch } as ExecutionTask;
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({ data: stored, error: null }),
                  };
                },
              };
            },
          };
        },
        insert() {
          return {
            select() {
              return {
                single: async () => ({ data: { id: "ledger-1" }, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

test("verification unavailable does not become verified success", async () => {
  const task: ExecutionTask = {
    id: "t1",
    project_id: sampleOp.projectId,
    organization_id: "o1",
    title: sampleOp.title,
    source_module: "searchops_opportunity",
    source_id: sampleOp.id,
    category: "ai_visibility",
    priority: "high",
    impact: 70,
    effort: 8,
    status: "done",
    evidence: opportunityToTaskDraft(sampleOp).evidence,
    before_metric: opportunityToTaskDraft(sampleOp).before_metric,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const sb = mockSupabase(task) as never;
  const outcome = await verifySearchOpsTask(sb, { task, afterMetric: null });
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.status, "verification_unavailable");
    assert.equal(outcome.task.status, "done");
    assert.notEqual(outcome.task.status, "verified");
  }
});

test("verified proof requires measured before/after", async () => {
  const draft = opportunityToTaskDraft(sampleOp);
  const task: ExecutionTask = {
    id: "t2",
    project_id: sampleOp.projectId,
    organization_id: "o1",
    title: sampleOp.title,
    source_module: "searchops_opportunity",
    source_id: sampleOp.id,
    category: "ai_visibility",
    priority: "high",
    impact: 70,
    effort: 8,
    status: "done",
    evidence: draft.evidence,
    before_metric: { status: "measured", mention_rate: 0.1 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const sb = mockSupabase(task) as never;
  const outcome = await verifySearchOpsTask(sb, {
    task,
    afterMetric: { status: "measured", mention_rate: 0.35 },
  });
  assert.equal(outcome.ok, true);
  if (outcome.ok && outcome.status === "verified") {
    assert.equal(outcome.task.status, "verified");
    assert.ok(outcome.task.verified_at);
    assert.equal(outcome.ledgerId, "ledger-1");
  } else {
    assert.fail("expected verified outcome");
  }
});
