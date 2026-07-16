import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { checkPublicPageRateLimit } from "@/lib/security/public-guard";
import { RateLimitedNotice } from "@/components/rate-limited-notice";
import { loadPublicReceipt } from "@/lib/engines/receipt-verify";

export const dynamic = "force-dynamic";

/**
 * Public receipt verification page (Phase 0, Master Plan v4).
 *
 * Anyone holding a receipt link can independently confirm: what was asked,
 * which exact surface answered, when it was captured, that the stored answer
 * still matches its sha256 fingerprint, and that the receipt's chain link
 * recomputes. No login; the unguessable receipt id is the capability.
 */
export default async function VerifyReceiptPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { receiptId } = await params;

  const rateLimit = await checkPublicPageRateLimit(await headers(), "receipt-verify-view", 60, 60_000);
  if (!rateLimit.allowed) {
    return <RateLimitedNotice retryAfterSec={rateLimit.retryAfterSec} />;
  }

  const supabase = await createServiceClient();
  const receipt = await loadPublicReceipt(supabase, receiptId);
  if (!receipt) notFound();

  const v = receipt.verification;
  const verdictStyles: Record<string, { label: string; cls: string }> = {
    verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    unchained: { label: "Recorded (not chained)", cls: "bg-amber-100 text-amber-800 border-amber-300" },
    failed: { label: "Verification failed", cls: "bg-red-100 text-red-800 border-red-300" },
  };
  const verdict = verdictStyles[v.verdict];

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: "Answer integrity",
      ok: v.answerHashValid,
      detail: "sha256 of the stored answer matches the recorded response_hash",
    },
    {
      name: "Receipt hash",
      ok: v.receiptHashValid,
      detail: "receipt_hash recomputes from prev_hash + response_hash + id + captured_at",
    },
    {
      name: "Chain link",
      ok: v.prevLinkFound ? v.prevLinkValid : true,
      detail: v.prevLinkFound
        ? "prev_hash matches the previous receipt in this project's chain"
        : "previous receipt was pruned by the retention policy (reported, not a failure)",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            PresenceOS receipt verification
          </p>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Measurement receipt</h1>
            <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${verdict.cls}`}>
              {verdict.label}
            </span>
          </div>
          <p className="text-sm text-slate-600">
            This page independently recomputes the cryptographic fingerprints below from the stored
            record — it proves the measurement rather than asserting it.
          </p>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Integrity checks
          </h2>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    c.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {c.ok ? "✓" : "✗"}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.detail}</p>
                </div>
              </li>
            ))}
            {!v.chained && (
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                  !
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">Not yet chained</p>
                  <p className="text-xs text-slate-500">
                    This receipt was recorded before hash chaining was enabled (or chaining was
                    unavailable at capture time). Its answer fingerprint above still verifies.
                  </p>
                </div>
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            What was measured
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Engine</dt>
              <dd className="text-sm font-medium text-slate-900">{receipt.engine}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Exact surface</dt>
              <dd className="text-sm font-medium text-slate-900">
                {receipt.surface || `${receipt.surfaceType} (legacy label)`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Measurement mode</dt>
              <dd className="text-sm font-medium text-slate-900">{receipt.measurementMode || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Captured (UTC)</dt>
              <dd className="text-sm font-medium text-slate-900">
                {new Date(receipt.capturedAt).toISOString()}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <dt className="text-xs text-slate-500">Prompt</dt>
            <dd className="mt-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{receipt.prompt}</dd>
          </div>
          {receipt.rawAnswer && (
            <div className="mt-4">
              <dt className="text-xs text-slate-500">Recorded answer</dt>
              <dd className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                {receipt.rawAnswer}
              </dd>
            </div>
          )}
          {receipt.citedUrls.length > 0 && (
            <div className="mt-4">
              <dt className="text-xs text-slate-500">Cited URLs</dt>
              <ul className="mt-1 list-inside list-disc text-sm text-indigo-700">
                {receipt.citedUrls.slice(0, 25).map((u) => (
                  <li key={u} className="truncate">
                    <a href={u} rel="nofollow noopener noreferrer" target="_blank" className="hover:underline">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {receipt.screenshotUrl && (
            <div className="mt-4">
              <dt className="text-xs text-slate-500">Screenshot artifact</dt>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receipt.screenshotUrl}
                alt="Captured surface screenshot"
                className="mt-1 max-h-[480px] rounded-lg border border-slate-200"
              />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Cryptographic record
          </h2>
          <dl className="space-y-2 font-mono text-xs text-slate-700">
            <div>
              <dt className="text-slate-500">receipt_id</dt>
              <dd className="break-all">{receipt.id}</dd>
            </div>
            <div>
              <dt className="text-slate-500">response_hash (sha256)</dt>
              <dd className="break-all">{receipt.responseHash}</dd>
            </div>
            <div>
              <dt className="text-slate-500">prev_hash</dt>
              <dd className="break-all">{receipt.prevHash || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">receipt_hash</dt>
              <dd className="break-all">{receipt.receiptHash || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">chain_position</dt>
              <dd>{receipt.chainPosition ?? "—"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Recompute independently: <code>receipt_hash = sha256(prev_hash + &quot;:&quot; + response_hash +
            &quot;:&quot; + receipt_id + &quot;:&quot; + captured_at_utc_iso_microseconds)</code>. A JSON
            version of this receipt is available at{" "}
            <a className="text-indigo-700 hover:underline" href={`/api/public/verify/${receipt.id}`}>
              /api/public/verify/{receipt.id}
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
