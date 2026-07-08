"use client";

import { useEffect } from "react";

/**
 * The shared report link is customer/prospect-facing (often shared outside
 * the org) — an unhandled crash here previously fell through to Next's
 * default error screen with PresenceOS branding entirely absent.
 */
export default function ReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[report-error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">This report couldn&apos;t be loaded</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Something went wrong rendering this report. Please try again — if the problem persists, ask
        whoever shared this link to regenerate it.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/70 font-mono">Error ref: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
      >
        Try again
      </button>
    </div>
  );
}
