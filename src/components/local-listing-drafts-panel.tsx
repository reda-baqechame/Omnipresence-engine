"use client";

import { useState } from "react";
import type { LocalListingDraft } from "@/lib/engines/local-listings";

export function LocalListingDraftsPanel({ drafts }: { drafts: LocalListingDraft[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyText(platform: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(platform);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div>
        <h3 className="font-semibold">Local Listing Drafts</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Copy-ready descriptions for Google Business Profile, Bing Places, and Apple Business Connect.
        </p>
      </div>
      {drafts.map((draft) => (
        <div key={draft.platform} className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-sm">{draft.title}</h4>
            <button
              onClick={() => copyText(draft.platform, `${draft.description}\n\n${draft.highlights.join("\n")}`)}
              className="text-xs text-primary hover:underline"
            >
              {copied === draft.platform ? "Copied!" : "Copy all"}
            </button>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-3">{draft.description}</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {draft.highlights.map((h, i) => (
              <li key={i}>• {h}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
