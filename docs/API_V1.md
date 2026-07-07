# API v1 — Versioning Policy

PresenceOS exposes a small **machine-facing API** under `/api/v1/*` for scans, ranks, and exports. This document defines how we version and deprecate those endpoints.

## Current surface

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/v1/scan` | API key (`guardApiKeyEndpoint`) | Trigger project scan(s) |
| `GET /api/v1/ranks` | API key | Rank snapshot export |
| `POST /api/v1/export` | API key | Bulk data export |

Internal dashboard routes under `/api/*` (non-v1) are **not** part of the public contract and may change without a version bump.

## Version scheme

- **Path version** — breaking changes ship as `/api/v2/...`. v1 remains until sunset.
- **Additive changes** — new optional JSON fields on v1 responses do **not** require a version bump.
- **Breaking changes** include: removing fields, changing field types, new required body fields, auth model changes, or semantic changes to filters.

## Stability guarantees

| Class | Guarantee |
|-------|-----------|
| v1 request schemas (Zod in `HARDENED_ROUTE_SCHEMAS`) | Frozen unless documented breaking release |
| v1 response shapes | Additive-only within a major version |
| Rate limits | May tighten with notice; documented in `docs/SLO.md` |

## Deprecation process

1. Announce deprecation in changelog + email to API key holders (90-day minimum).
2. Add `Deprecation: true` response header and `warning` field in JSON body.
3. Log usage per org; contact remaining integrators at 60 and 30 days.
4. After sunset, v1 returns `410 Gone` with link to v2 docs for 30 days, then remove route.

## Authentication

- Org-scoped API keys only (`/app/settings/api`).
- Keys inherit org RBAC; no cross-tenant access.
- Rotate keys via create/delete endpoints; old keys revoked immediately on delete.

## Error contract

All v1 errors use:

```json
{ "error": "human-readable message" }
```

HTTP status: `400` validation, `401`/`403` auth, `402` billing (when `FREE_ACCESS_MODE=false`), `429` rate limit, `500` server.

## Changelog location

Breaking API changes are recorded in release notes and `docs/DATA_CONTRACT.md` when response schemas affect exports.
