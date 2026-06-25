import { Suspense } from "react";

export default function EmbedAuditLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-4 text-sm">Loading audit widget...</div>}>{children}</Suspense>;
}
