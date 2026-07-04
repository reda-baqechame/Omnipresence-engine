"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function ScanPoller({
  projectId,
  initialStatus,
}: {
  projectId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [score, setScore] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "scanning") return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/scan`);
      const data = await res.json();
      setStatus(data.status);
      if (typeof data.score === "number") setScore(data.score);
      if (typeof data.message === "string") setMessage(data.message);
      if (data.status !== "scanning") {
        clearInterval(interval);
        router.refresh();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [projectId, status, router]);

  if (status !== "scanning") return null;

  return (
    <div className="bg-primary/10 border border-primary/30 rounded-xl p-6 flex items-center gap-4">
      <Loader2 className="h-6 w-6 text-primary animate-spin" />
      <div>
        <p className="font-medium">OmniPresence scan in progress...</p>
        <p className="text-sm text-muted-foreground">
          {message || "Running technical audit, AI visibility checks, competitor analysis, and coverage scan."}
          {score !== null && ` Current score: ${Math.round(score)}/100`}
        </p>
      </div>
    </div>
  );
}
