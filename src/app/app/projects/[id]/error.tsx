"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

/**
 * Scoped to a single project's sub-routes (keywords, technical, reports,
 * etc). Note this does NOT catch errors thrown by the project layout itself
 * (e.g. getProject() failing) — those bubble up to src/app/app/error.tsx —
 * only errors from an individual sub-page, so a bug in one capability panel
 * doesn't take down the whole project shell/nav.
 */
export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[project-error]", error);
  }, [error]);

  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-4 p-8 text-center bg-card border border-border rounded-xl">
      <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">This section failed to load</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Something went wrong loading this capability. The rest of the project — nav, other tabs, your
        data — is unaffected.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/70 font-mono">Error ref: {error.digest}</p>
      )}
      <div className="flex gap-3 mt-1">
        <button
          type="button"
          onClick={reset}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium"
        >
          Try again
        </button>
        <Link
          href="/app/projects"
          className="border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary"
        >
          Back to projects
        </Link>
      </div>
    </div>
  );
}
