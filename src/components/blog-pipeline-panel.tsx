"use client";

import { BLOG_PIPELINE_STEPS, type BlogPipelineStepKey } from "@/lib/engines/blog-pipeline";

interface BlogAsset {
  id: string;
  title: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
}

interface BlogPipelinePanelProps {
  assets: BlogAsset[];
}

export function BlogPipelinePanel({ assets }: BlogPipelinePanelProps) {
  const blogPosts = assets.filter((a) => a.type === "blog_post");

  async function advance(assetId: string, stepKey: BlogPipelineStepKey) {
    await fetch("/api/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, pipelineStep: stepKey }),
    });
    window.location.reload();
  }

  if (blogPosts.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        Generate a blog post to track the 14-step AEO pipeline.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">14-Step Blog Pipeline</h3>
        <p className="text-sm text-muted-foreground">
          Keyword research through performance check — advance each hub post through the domination workflow.
        </p>
      </div>
      {blogPosts.map((asset) => {
        const completed = new Set((asset.metadata?.pipeline_completed as string[]) || []);
        const currentStep = typeof asset.metadata?.pipeline_step === "number" ? asset.metadata.pipeline_step : 1;
        return (
          <div key={asset.id} className="bg-card border border-border rounded-xl p-4">
            <div className="font-medium mb-3">{asset.title}</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {BLOG_PIPELINE_STEPS.map((step) => {
                const done = completed.has(step.key);
                const isCurrent = step.id === currentStep;
                return (
                  <div
                    key={step.key}
                    className={`text-xs rounded-lg px-2 py-2 border ${
                      done
                        ? "border-green-500/40 bg-green-500/10"
                        : isCurrent
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-secondary/50"
                    }`}
                  >
                    <div className="font-medium">{step.id}. {step.label}</div>
                    {!done && isCurrent && (
                      <button
                        type="button"
                        onClick={() => advance(asset.id, step.key)}
                        className="mt-1 text-primary hover:underline"
                      >
                        Mark complete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
