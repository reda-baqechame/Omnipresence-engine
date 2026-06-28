-- Global LLM / paid-API spend ledger for the cost guard.
-- Tracks estimated USD spend per day+provider so the app can enforce a hard
-- daily/monthly budget across all callers (scans, public audits, crons) and
-- never run up an unbounded API bill. This is intentionally global (not
-- org-scoped) — it protects the platform owner's provider accounts.

CREATE TABLE IF NOT EXISTS api_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  provider text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  est_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, provider)
);

CREATE INDEX IF NOT EXISTS api_spend_daily_day_idx ON api_spend_daily (day);

-- Only the service role touches this ledger; RLS on with no public policies.
ALTER TABLE api_spend_daily ENABLE ROW LEVEL SECURITY;

-- Atomic increment so concurrent LLM calls can't lose updates (race-free budget).
CREATE OR REPLACE FUNCTION increment_api_spend(
  p_day date,
  p_provider text,
  p_calls integer,
  p_in bigint,
  p_out bigint,
  p_cost numeric
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO api_spend_daily (day, provider, calls, input_tokens, output_tokens, est_cost_usd, updated_at)
  VALUES (p_day, p_provider, p_calls, p_in, p_out, p_cost, now())
  ON CONFLICT (day, provider) DO UPDATE SET
    calls = api_spend_daily.calls + EXCLUDED.calls,
    input_tokens = api_spend_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = api_spend_daily.output_tokens + EXCLUDED.output_tokens,
    est_cost_usd = api_spend_daily.est_cost_usd + EXCLUDED.est_cost_usd,
    updated_at = now();
$$;
