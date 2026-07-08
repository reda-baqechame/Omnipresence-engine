import { Loader2 } from "lucide-react";

/** Suspense fallback while a project sub-page's server-side data fetch is in flight. */
export default function ProjectSectionLoading() {
  return (
    <div className="min-h-[30vh] flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
