/** Shared "slow down" state for public report/portal pages that are rate-limited. */
export function RateLimitedNotice({ retryAfterSec }: { retryAfterSec?: number }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Too many requests</h1>
      <p className="text-muted-foreground text-center max-w-md">
        This link has been viewed too many times in a short window. Please wait
        {retryAfterSec ? ` about ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}` : " a moment"} and try
        again.
      </p>
    </div>
  );
}
