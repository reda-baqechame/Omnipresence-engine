"use client";

import { useState } from "react";
import type { CoverageItem } from "@/types/database";

type SubmissionStatus = NonNullable<CoverageItem["submission_status"]>;

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  live: "Live",
};

const STATUS_COLORS: Record<SubmissionStatus, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-yellow-400",
  submitted: "text-blue-400",
  live: "text-green-400",
};

interface DirectoryTrackerProps {
  projectId: string;
  items: CoverageItem[];
}

export function DirectoryTracker({ projectId, items }: DirectoryTrackerProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  async function updateItem(
    itemId: string,
    submissionStatus: SubmissionStatus,
    profileUrl?: string
  ) {
    setUpdating(itemId);
    await fetch("/api/coverage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, submissionStatus, profileUrl }),
    });
    setUpdating(null);
    window.location.reload();
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Run a scan first to discover directory and review site opportunities.
      </p>
    );
  }

  const live = items.filter((i) => i.submission_status === "live" || i.is_present).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {live} / {items.length} directories live or submitted
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const status = (item.submission_status || "not_started") as SubmissionStatus;
          return (
            <div
              key={item.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 bg-secondary rounded-lg p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{item.platform_name}</div>
                {item.profile_url && (
                  <a
                    href={item.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline truncate block"
                  >
                    {item.profile_url}
                  </a>
                )}
              </div>
              <div className={`text-xs font-medium ${STATUS_COLORS[status]}`}>
                {STATUS_LABELS[status]}
              </div>
              <select
                value={status}
                disabled={updating === item.id}
                onChange={(e) =>
                  updateItem(item.id, e.target.value as SubmissionStatus, item.profile_url)
                }
                className="bg-background border border-input rounded-lg px-2 py-1 text-xs"
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
