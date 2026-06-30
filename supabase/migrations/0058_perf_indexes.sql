-- 0058_perf_indexes.sql
-- Production hardening: indexes for hot queries introduced by the per-tenant
-- surface-measurement budget firewall and proof-chain reads.

-- The daily tenant budget check (assertTenantSurfaceBudget) filters api_usage by
-- (organization_id, created_at >= day-start) on every paid scan/panel trigger.
-- The existing single-column idx_api_usage_org can't serve the time range
-- efficiently; a composite index keeps the firewall cheap under load.
CREATE INDEX IF NOT EXISTS idx_api_usage_org_created
  ON api_usage(organization_id, created_at DESC);

-- ops_queue is polled by status for the executor and read by task_id for the
-- proof chain; a composite (organization_id, status) index speeds the worker's
-- "next pending item for this org" scan.
CREATE INDEX IF NOT EXISTS idx_ops_queue_org_status
  ON ops_queue(organization_id, status);
