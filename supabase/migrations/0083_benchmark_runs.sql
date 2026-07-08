-- Benchmark runs: durable history for the PresenceData OS benchmark layer
-- (Section 9 of the PresenceData OS plan). Before this table, sovereign-vs-paid
-- comparisons only ever existed as file-based JSON snapshots
-- (docs/benchmarks/*.json) with no queryable history and no way to prove "30
-- consecutive days meeting threshold" — the evidence bar the plan requires
-- before any capability's DataForSEO adapter may be demoted to
-- fallback/benchmark-only (Patch J). This table is that durable history.
--
-- One row per (capability, metric) per scheduled run. `passed` is nullable —
-- NULL means "not evaluated this run" (e.g. no paid vendor configured to
-- compare against, or the metric requires infrastructure this harness does
-- not yet exercise), which must NEVER be conflated with a real pass. A
-- capability only becomes eligible for promotion once it has 30 consecutive
-- days of non-NULL, true `passed` rows for every threshold that applies to it
-- — see scripts/provider-superiority.mjs and the nightly-provider-benchmark
-- Inngest function for the read/write sides.

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  sovereign_provider TEXT,
  paid_provider TEXT,
  dataset_ref TEXT,
  sovereign_value NUMERIC,
  paid_value NUMERIC,
  delta NUMERIC,
  -- NULL = not evaluated this run (no paid comparison available / metric not
  -- yet instrumented) — an honest "unknown", never coerced to true or false.
  passed BOOLEAN,
  threshold_note TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS benchmark_runs_capability_metric_run_at_idx
  ON benchmark_runs (capability, metric_name, run_at DESC);

-- Service-role-only reference/observability data (same posture as
-- provider_telemetry / api_spend_daily) — RLS on with no public policies.
ALTER TABLE benchmark_runs ENABLE ROW LEVEL SECURITY;
