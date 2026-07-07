import { NextResponse } from "next/server";
import { validateBody } from "@/lib/security/api-response";
import { ProviderBenchmarkSchema } from "@/lib/validation/schemas";
import { runProviderBenchmark, type BenchmarkInputs } from "@/lib/engines/provider-benchmark";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Live sovereign-vs-paid provider benchmark. Runs the real engines and returns
 * measured numbers. Guarded by BENCHMARK_SECRET (required in every environment).
 * Uses NO Supabase service client and reads no tenant data — only outbound calls.
 */
function authorized(req: Request): boolean {
  const secret = process.env.BENCHMARK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || req.headers.get("x-benchmark-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let inputs: BenchmarkInputs | undefined;
  const v = await validateBody(req, ProviderBenchmarkSchema);
  if (v.response) return v.response;
  if (v.data && typeof v.data === "object") inputs = v.data as BenchmarkInputs;

  try {
    const report = await runProviderBenchmark(inputs);
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Benchmark failed" },
      { status: 500 }
    );
  }
}
