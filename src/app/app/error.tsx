"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

/**
 * Catches errors thrown anywhere under the authenticated /app tree that
 * aren't already caught by a more specific boundary (e.g.
 * projects/[id]/error.tsx). Without this, a thrown Supabase query or a bug
 * in any dashboard page previously fell through to Next's default
 * unstyled error screen with no way back into the product.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold">This page hit an error</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Something went wrong loading this part of PresenceOS. Your other data is unaffected — try
        reloading this page or head back to your projects.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/70 font-mono">Error ref: {error.digest}</p>
      )}
      <div className="flex gap-3 mt-2">
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
