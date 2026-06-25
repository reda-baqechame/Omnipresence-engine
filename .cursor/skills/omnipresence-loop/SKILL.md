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
   If OmniData changed: `npm run omnidata:test`
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

Read `docs/OMNIPRESENCE_PHASE8_SPEC.md` for competitive gap analysis vs AEO Engine.

| Phase | Manifest version | Status |
|-------|------------------|--------|
| Phase 1–5 | v1–v5 | done |
| Phase 6 Intelligence Spine | v6.0.0 | done |
| Phase 7 Production Launch | v7.0.0 | done |
| **Phase 8 Beat AEO Engine** | **v8.0.0** | **done** |
| **Phase 9 Dominate AEO** | **v9.0.0** | **done — run audit:phase9 + verify:prod** |

## Phase 9 focus order

1. **Wave A** — prompt-campaign-ui, gsc-prompt-import, blog-pipeline-ui, llm-referral-chart
2. **Wave B** — visitor-identity, embed-widget-v2, nap-consistency
3. **Wave C** — guarantee-traffic-rules, podcast-audio-stub, prompt-heatmap
4. **Wave D** — phase9-migration, phase9-wiring-docs

## Loop prompt (Cursor)

```
Read .cursor/skills/omnipresence-loop/SKILL.md and docs/OMNIPRESENCE_PHASE9_SPEC.md.
Execute the next pending BUILD_MANIFEST v9 task only. Run verify:all. Commit if green.
```

## Phase 2 manifest (v2.0.0) — archived

Phase 2 tasks complete. See `docs/OMNIPRESENCE_PHASE2_SPEC.md` for history.
