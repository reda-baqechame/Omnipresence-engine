import Link from "next/link";
import { SearchX } from "lucide-react";

/** Replaces Next's generic 404 for notFound() calls under a project's routes (e.g. an unknown/deleted project id). */
export default function ProjectNotFound() {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">Project not found</h2>
      <p className="text-muted-foreground max-w-md text-sm">
        This project doesn&apos;t exist, was deleted, or you don&apos;t have access to it.
      </p>
      <Link
        href="/app/projects"
        className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium"
      >
        Back to projects
      </Link>
    </div>
  );
}
