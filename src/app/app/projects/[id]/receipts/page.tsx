import { notFound } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, Download, ShieldCheck } from "lucide-react";
import { getProject } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ReceiptRow {
  id: string;
  engine: string;
  surface: string | null;
  surface_type: string | null;
  measurement_mode: string | null;
  prompt: string;
  receipt_hash: string | null;
  chain_position: number | null;
  captured_at: string;
}

/**
 * Receipt portal (Master Plan v4, Phase 1): every measured AI answer in this
 * project, as a verifiable receipt. Each row links to the public
 * /verify/{receiptId} page where ANYONE — a client, an auditor, a skeptic —
 * can independently recompute the hash chain without a login.
 */
export default async function ReceiptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_capture_evidence")
    .select("id, engine, surface, surface_type, measurement_mode, prompt, receipt_hash, chain_position, captured_at")
    .eq("project_id", id)
    .order("captured_at", { ascending: false })
    .limit(200);
  const receipts = (data || []) as ReceiptRow[];
  const chained = receipts.filter((r) => r.receipt_hash).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Receipts</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every measured AI answer gets a tamper-evident receipt: prompt, exact surface, capture
            method, timestamp, response hash, and its position in the project&apos;s hash chain. Share any
            receipt link — verification is public and needs no login.
          </p>
        </div>
        <a
          href={`/api/evidence/export?projectId=${id}`}
          className="shrink-0 inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 text-sm hover:border-primary"
        >
          <Download className="h-4 w-4" /> Export all
        </a>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-semibold">{receipts.length}</span>
          <span className="text-muted-foreground">recent receipts</span>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-green-500" />
          <span className="font-semibold">{chained}</span>
          <span className="text-muted-foreground">hash-chained</span>
        </div>
      </div>

      {receipts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          No receipts yet. Run a visibility scan — every measured answer will appear here with its
          verifiable evidence record.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Prompt</th>
                <th className="px-4 py-2.5 font-medium">Surface</th>
                <th className="px-4 py-2.5 font-medium">Mode</th>
                <th className="px-4 py-2.5 font-medium">Captured</th>
                <th className="px-4 py-2.5 font-medium">Chain</th>
                <th className="px-4 py-2.5 font-medium text-right">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2.5 max-w-xs truncate" title={r.prompt}>{r.prompt}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {(r.surface || r.engine).replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {r.measurement_mode || r.surface_type || "—"}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {new Date(r.captured_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {r.receipt_hash ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-500">
                        <BadgeCheck className="h-3.5 w-3.5" /> #{r.chain_position ?? "—"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">unchained</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/verify/${r.id}`} target="_blank" className="text-primary hover:underline text-xs font-medium">
                      Verify →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
