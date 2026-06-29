---
name: omnipresence-loop
description: >-
  Autonomous build loop for OmniPresence Super Engine. Reads docs/BUILD_MANIFEST.json,
  implements one task per iteration, runs verification gates, updates progress.
  Use when the user asks to loop until production-ready or run the super engine build.
---

# OmniPresence Build Loop

## When to use

- User says `/loop` with OmniPresence build intent
- User wants autonomous iteration until all manifest tasks are `done`
- Overnight / continuous build of the Super Engine plan

## Each iteration (ONE task only)

1. Read `docs/BUILD_MANIFEST.json` and `docs/BUILD_PROGRESS.md`
2. Pick the **first** task with `status: "pending"` (respect `dependsOn`)
3. Implement only that task's `files` and `acceptance`
4. Run verification:
   ```bash
   npm run verify:all
   ```
   If OmniData changed: `npm run omnidata:test` + `npm run omnidata:parity`
5. If green: set task `status: "done"` in manifest, append progress log, commit
6. If red after 3 fix attempts: set `status: "blocked"`, log error, stop loop

## Guardrails (NEVER violate)

- One manifest task per iteration
- Never commit with failing `verify:all`
- Never push to `main` without user approval
- Never edit `.env`, `.env.local`, or commit secrets
- Never skip security review on new fetch/crawl endpoints
- Stop after 3 consecutive failures on same task

## Launch (PowerShell / Windows)

```powershell
# Run once immediately, then every 30m until manifest complete
while ($true) {
  Start-Sleep -Seconds 1800
  Write-Output 'AGENT_LOOP_TICK_omnipresence {"prompt":"Read .cursor/skills/omnipresence-loop/SKILL.md and execute the next pending BUILD_MANIFEST task."}'
}
```

Or use Cursor `/loop 30m` with prompt:
> Execute omnipresence-loop skill: next pending BUILD_MANIFEST task only.

## Completion

When all tasks are `done`, run `npm run production:ready` (or `verify:all` + `audit:full` + `verify:prod`) and report summary.

## Phase priority

Read `docs/OMNIPRESENCE_PHASE12_SPEC.md` for the current (Index Expansion &
Calibration) plan, `docs/OMNIPRESENCE_PHASE11_SPEC.md` for the Free Data Moat,
`docs/OMNIPRESENCE_PHASE10_SPEC.md` for the real-data plan, and
`docs/OMNIPRESENCE_PHASE8_SPEC.md` for competitive gap analysis vs AEO Engine.

| Phase | Manifest version | Status |
|-------|------------------|--------|
| Phase 1–5 | v1–v5 | done |
| Phase 6 Intelligence Spine | v6.0.0 | done |
| Phase 7 Production Launch | v7.0.0 | done |
| **Phase 8 Beat AEO Engine** | **v8.0.0** | **done** |
| **Phase 9 Dominate AEO** | **v9.0.0** | **done** |
| **Phase 10 Real Results, Real Data** | **v10.0.0** | **done — provision OmniData host + keys, then `audit:live`** |
| **Phase 11 The Free Data Moat** | **v11.0.0** | **done — keyless Trends/tech/popularity/authority/HN/entity** |
| **Phase 12 Index Expansion & Calibration** | **v12.0.0** | **done — keyword-volume calibration, rank.to popularity, competitive matrix + CrUX field** |
| **OmniPresence Expert Machine (Phases 1–22)** | **v22.0.0** | **done — rank depth, scale, frontier levers, alerts/API, local SEO, backlinks, reputation, topical, pSEO, indexation, distribution, SERP capture, demand, ROI command center, onboarding + continuous loop** |
| **Sovereign 200x Machine** | **v24.0.0** | **done — Source Graph, merchant AI visibility, grounded AI UI capture, War Room/Proof Ledger/agency cockpit, snapshots + data-quality, claims/benchmark harness, provider router, sovereign data/AI/comms, Zero-Paid-Keys mode** |

## Expert Machine focus order (v22.0.0)

All 22 phases of the Expert Machine plan are implemented. Phase 22 closes the
loop: the onboarding/objective wizard captures the business model (offer, AOV/LTV,
conversion, scope, competitors) and generates a persisted master competitor list +
keyword universe + 90-day operating plan from real data; daily/weekly/monthly/
quarterly cadence reviews surface gainers/losers, regressions and citation gaps and
materialize them as tracked execution tasks; and the guarantee/ledger auto-verifies
the operational guarantees we actually cause (audit delivered, entity deployed,
structural optimization shipped, GSC movement measurable). Never guarantee rankings
or "appear everywhere in AI."

## Phase 12 focus order (v12.0.0)

All Phase 12 tasks are implemented. Honest keyword volume via Google Trends
proportional extrapolation anchored to a GSC/Keyword-Planner known volume (log
buckets + confidence + ±30% range); keyless global domain rank (rank.to) blended
into the Popularity Index; a unified Competitive Matrix (popularity + authority +
tech stack + real-user CrUX field CWV) computed in one pass per domain.
Everything is keyless; set the free `PAGESPEED_API_KEY` to make CWV field data
reliable (otherwise it degrades to "no field data").

## Phase 10 focus order (v10.0.0)

1. **Wave A (real data)** — cc-webgraph-backlinks, keyword-planner-real, serp-scrape-fallback
2. **Wave B (real signals)** — community-local-real, guarantee-real-loop, tech-probes
3. **Wave C (parity)** — aeo-parity-extras
4. **Wave D (ship)** — omnidata-deploy, phase10-loop

All Phase 10 tasks are implemented; the only remaining step is user provisioning of
the OmniData host + provider keys, then `npm run audit:live` to verify real data.

## Loop prompt (Cursor)

```
Read .cursor/skills/omnipresence-loop/SKILL.md and docs/OMNIPRESENCE_PHASE12_SPEC.md.
Execute the next pending BUILD_MANIFEST v12 task only. Run verify:all (+ omnidata:parity
if OmniData changed). Commit if green.
```

## Phase 2 manifest (v2.0.0) — archived

Phase 2 tasks complete. See `docs/OMNIPRESENCE_PHASE2_SPEC.md` for history.
