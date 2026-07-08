import { Loader2 } from "lucide-react";

/**
 * Route-level Suspense fallback for the authenticated /app tree. Shown
 * instantly on navigation while a page's server-side data fetch (Supabase
 * queries, etc.) is in flight, instead of a frozen/blank screen.
 */
export default function AppLoading() {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
