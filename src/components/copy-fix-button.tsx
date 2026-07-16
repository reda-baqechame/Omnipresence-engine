"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Foglift-pattern copy button: one click turns a fix recommendation into
 *  clipboard-ready text the user can paste into their CMS/code. */
export function CopyFixButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — no-op.
    }
  }

  return (
    <button
      onClick={copy}
      title="Copy fix"
      aria-label="Copy fix"
      className="shrink-0 border border-border rounded-md p-1.5 hover:border-primary text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
