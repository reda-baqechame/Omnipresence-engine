"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary (Next.js App Router). Only fires when the error
 * originates in the root layout itself — everything below that is caught by
 * the more specific boundaries in src/app/app/error.tsx and
 * src/app/report/[token]/error.tsx. Must render its own <html>/<body> since
 * it replaces the root layout entirely while active.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased bg-background text-foreground">
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">
            PresenceOS hit an unexpected error loading this page. This has been logged — try again, or
            head back to the homepage.
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
            {/* global-error replaces the root layout entirely, so the app router
                context Link relies on isn't guaranteed — a plain <a> is the
                pattern Next.js itself recommends here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary"
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
