# Service Level Objectives — Omnipresence Engine

Operational SLOs for the measurement-first platform. Breaches trigger the `slo/check` Inngest cron (Slack webhook when `SLACK_ALERT_WEBHOOK_URL` is set).

| SLO | Target | Window | Signal |
|-----|--------|--------|--------|
| Evidence write success | ≥ 99.9% | 24h | `measurement_evidence` + `ai_capture_evidence` insert success vs failures (metric: `evidence.write`) |
| Rank freshness | ≥ 95% of active projects | 24h | `rank_checks.checked_at` within project `rank_frequency` SLA |
| Provider route latency P95 | ≤ 8s | 1h | `provider.route.latency_ms` from `provider_telemetry` |
| OmniData queue delay P95 | ≤ 60s | 1h | BullMQ job wait time (metric: `omnidata.queue.delay_ms`) |
| Rate-limit rejection rate | ≤ 2% of authenticated mutations | 1h | metric: `rate_limit.rejected` / `api.request` |

## Error budget

When an SLO misses for two consecutive windows, treat as **incident**: pause non-critical deploys, inspect provider health (`/api/capabilities`), and check Redis/Supabase status.

## Alert routing

1. `SLACK_ALERT_WEBHOOK_URL` — primary operator channel.
2. Structured logs — `[slo-breach]` JSON lines in `log.ts` / Vercel log drain.
3. Sentry — hard failures from evidence persistence (`captureException`).

## Dashboards (minimal)

Until a full metrics backend ships, grep Vercel/Railway logs for:

- `[metric]` — counters and histograms from `recordMetric()`
- `[slo-breach]` — automated cron output
- `[provider-error]` — upstream outages
