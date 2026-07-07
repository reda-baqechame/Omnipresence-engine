# Compliance Gaps — SOC 2 Prep Checklist

Operational checklist for SOC 2 Type I readiness. Items marked **Gap** need owner + target date before auditor engagement.

## Security (CC6)

| Control | Status | Notes |
|---------|--------|-------|
| Tenant isolation tests (`tests/security/tenant-isolation.test.ts`) | Done | CI via `verify:all` |
| RLS on all tenant tables | Done | `verify:rls` gate |
| API route auth coverage | Done | `verify:route-auth` |
| Secrets in env / Vercel + Railway, not repo | Done | `audit:zero-paid-keys` |
| Integration credential encryption | Done | `INTEGRATION_ENCRYPTION_KEY` health check |
| Admin health endpoint gated | Done | `HEALTH_ADMIN_SECRET` |
| **Gap:** Formal access review cadence (quarterly) | Gap | Document in HR/IT policy |
| **Gap:** MFA enforced for Supabase/Vercel/Railway org admins | Gap | Enable on all infra accounts |

## Availability (A1)

| Control | Status | Notes |
|---------|--------|-------|
| Production gate workflow (weekly) | Done | `.github/workflows/production-gate.yml` |
| SLO doc | Done | `docs/SLO.md` |
| **Gap:** Published status page | Gap | e.g. Instatus or Better Stack |
| **Gap:** Incident response runbook with RACI | Partial | Extend `docs/SECURITY_RUNBOOK.md` |

## Processing integrity (PI1)

| Control | Status | Notes |
|---------|--------|-------|
| Zod validation on hardened routes | Done | `verify:zod` |
| Data source provenance constraints | Done | migration 0068 + verify script |
| **Gap:** Change management tickets linked to deploys | Gap | Require PR + CI green |

## Confidentiality (C1)

| Control | Status | Notes |
|---------|--------|-------|
| Reports bucket private (0073) | Done | migration |
| PII minimization on public audit leads | Done | rate limits + guard |
| **Gap:** DPA template for enterprise customers | Gap | Legal |
| **Gap:** Data retention / deletion SOP | Gap | Define per-table retention |

## Privacy (P1) — if handling EU data

| Control | Status | Notes |
|---------|--------|-------|
| **Gap:** GDPR lawful basis documented | Gap | Privacy policy update |
| **Gap:** Subprocessor list (Supabase, Stripe, Vercel, Railway, etc.) | Gap | Publish on site |
| **Gap:** Data export / erase request process | Gap | Supabase + manual playbook |

## Evidence to collect for audit

- Last 90 days CI logs (`verify:all`, production-gate)
- Access logs for production Supabase (if enabled)
- Stripe webhook delivery logs
- Backup restore drill record (see `BACKUP_RESTORE.md`)
- Pen test or third-party security review (recommended before Type II)

## Next actions (recommended order)

1. Enable MFA on all operator accounts.
2. Run backup restore drill and file timestamped record.
3. Publish subprocessor list + retention policy.
4. Schedule quarterly access review calendar event.
