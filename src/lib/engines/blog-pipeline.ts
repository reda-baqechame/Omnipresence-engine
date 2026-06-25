/** 14-step blog pipeline (AEO Engine pattern) for content domination. */

export const BLOG_PIPELINE_STEPS = [
  { id: 1, key: "keyword_research", label: "Keyword research" },
  { id: 2, key: "serp_analysis", label: "SERP analysis" },
  { id: 3, key: "outline", label: "Outline" },
  { id: 4, key: "brief_approval", label: "Brief approval" },
  { id: 5, key: "first_draft", label: "First draft" },
  { id: 6, key: "answer_capsules", label: "Answer capsules" },
  { id: 7, key: "internal_links", label: "Internal links" },
  { id: 8, key: "schema_markup", label: "Schema markup" },
  { id: 9, key: "meta_optimization", label: "Meta optimization" },
  { id: 10, key: "image_alt", label: "Image alt text" },
  { id: 11, key: "human_review", label: "Human review" },
  { id: 12, key: "publish", label: "Publish" },
  { id: 13, key: "index_submit", label: "Index submission" },
  { id: 14, key: "performance_check", label: "Performance check" },
] as const;

export type BlogPipelineStepKey = (typeof BLOG_PIPELINE_STEPS)[number]["key"];

export function getPipelineProgress(metadata: Record<string, unknown> | null | undefined): {
  currentStep: number;
  completedSteps: string[];
} {
  const completed = (metadata?.pipeline_completed as string[]) || [];
  const current = typeof metadata?.pipeline_step === "number" ? metadata.pipeline_step : 1;
  return { currentStep: current, completedSteps: completed };
}

export function advancePipeline(
  metadata: Record<string, unknown> | null | undefined,
  stepKey: BlogPipelineStepKey
): Record<string, unknown> {
  const step = BLOG_PIPELINE_STEPS.find((s) => s.key === stepKey);
  const completed = new Set((metadata?.pipeline_completed as string[]) || []);
  if (step) completed.add(step.key);
  const nextId = step ? Math.min(step.id + 1, BLOG_PIPELINE_STEPS.length) : 1;
  return {
    ...(metadata || {}),
    pipeline_step: nextId,
    pipeline_completed: [...completed],
    pipeline_updated_at: new Date().toISOString(),
  };
}
