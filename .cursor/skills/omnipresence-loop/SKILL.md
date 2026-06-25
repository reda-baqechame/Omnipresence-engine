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

When all tasks are `done`, run full `npm run verify:all` + `npm run wire:diy` and report summary.

## Phase 2 manifest (v2.0.0)

Phase 1 tasks remain `done`. Phase 2 tasks start at `phase2-spec`. Continue picking first `pending` task until the full v2 manifest is complete. See `docs/OMNIPRESENCE_PHASE2_SPEC.md` for wave priorities.
