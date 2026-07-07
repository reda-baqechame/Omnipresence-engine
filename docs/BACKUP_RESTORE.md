# Backup & Restore Drill

Quarterly drill to prove Supabase + object storage recovery within RPO/RTO targets.

## Scope

| Asset | Location | RPO target | RTO target |
|-------|----------|------------|------------|
| Postgres (app data) | Supabase | 24h (daily backup) | 4h |
| Auth users | Supabase Auth | 24h | 4h |
| Report PDFs | Supabase Storage `reports` bucket | 24h | 4h |
| OmniData webgraph | Railway volume | 7d (re-ingest acceptable) | 24h |

## Pre-drill checklist

- [ ] Staging Supabase project available (never drill on production without maintenance window).
- [ ] Operator has Supabase dashboard + service role key access.
- [ ] `docs/OMNIDATA_DEPLOY.md` handy for webgraph re-ingest if needed.

## Drill steps — Postgres

1. **Record baseline** — note row count for `organizations`, `projects`, latest `visibility_results.created_at`.
2. **Create test marker** — in staging, insert org slug `drill-<ISO-date>` via SQL or app signup.
3. **Restore** — Supabase Dashboard → Database → Backups → Restore to new project **or** use point-in-time recovery if on Pro plan.
4. **Verify** — connect app to restored project env vars; confirm marker org exists and counts match ± backup lag.
5. **Run smoke** — `SMOKE_BASE_URL=<staging> npm run smoke` and `npm run verify:prod` against restored stack.
6. **Document** — record start/end time, backup timestamp used, pass/fail, issues.

## Drill steps — Storage (`reports` bucket)

1. Upload a test PDF via app export or Supabase dashboard.
2. Delete object in staging bucket (simulated loss).
3. Restore from Supabase Storage backup or re-generate report from DB.
4. Confirm signed URL access works for org member (RLS).

## Drill steps — OmniData webgraph (optional)

1. `WEBGRAPH_REQUIRE_FULL=0 npm run webgraph:verify` — baseline auth + partial graph.
2. Simulate loss: note `edges_ready` false on `/health`.
3. Re-run ingest per `scripts/ensure-railway-webgraph.mjs` or ops runbook.
4. `WEBGRAPH_REQUIRE_FULL=1 npm run webgraph:verify` when volume catch-up complete.

## Pass criteria

- Restored DB readable by app within RTO.
- Tenant A cannot read Tenant B data post-restore (spot-check RLS).
- At least one end-to-end user flow works: login → project hub → health OK.

## Failure escalation

- Supabase support ticket with project ref + backup ID.
- Communicate via internal incident channel; do not flip `FREE_ACCESS_MODE=false` during recovery.

## Record template

```
Date:
Operator:
Backup used (timestamp):
Restore started / finished:
RTO met (Y/N):
Issues:
Sign-off:
```

Store completed records in your compliance evidence folder (not in this repo if they contain internal IDs).
