# Golden datasets — accuracy ground truth

These datasets are the **ground truth** the sovereign (keyless/self-hosted) providers are measured against. They turn "we replaced a paid API" into a provable "the replacement returns accurate data."

## Doctrine
- **Known-true values only.** Each fixture records facts that are independently verifiable (publicly-known backlinks, stable navigational SERP #1s, published Core Web Vitals ranges, known tech stacks, hand-labeled AI answer transcripts). Sources are noted inline.
- **Measure, don't assert.** Tests compute precision/recall/F1, MAE/percentage error, or Spearman rank correlation via [`_lib/score.ts`](_lib/score.ts) and assert against an explicit floor.
- **Fix the engine, never the threshold.** If a sovereign path can't clear its floor, the engine is fixed — the bar is not lowered to pass.
- **Self-skip when offline.** Tests call `requireService()` from [`_lib/env.ts`](_lib/env.ts) and skip with a reason when the needed service/network isn't configured, so CI stays green locally and fails hard only where the service IS configured but inaccurate.

## Layout
```
tests/golden/
  _lib/score.ts        # precision/recall/F1, MAE, Spearman, monotonicity, top-K
  _lib/env.ts          # requireService() gate for live sovereign services
  backlinks/           # *.json fixtures + backlinks.accuracy.test.ts
  serp/                # stable-query fixtures + serp.accuracy.test.ts
  keywords/            # volume bands + KD ordering + keywords.accuracy.test.ts
  performance/         # CWV ranges + perf.accuracy.test.ts
  local/               # geocode + ranking fixtures + local.accuracy.test.ts
  tech/                # known-stack fixtures + tech.accuracy.test.ts
  citations/           # labeled AI transcripts + citations.accuracy.test.ts
```

## Running
```
npm run verify:accuracy          # discovers and runs all *.accuracy.test.ts (+ score lib self-test)
GOLDEN_ALLOW_NETWORK=true npm run verify:accuracy   # also exercise keyless network paths (OSM/PageSpeed)
```
Configure the relevant env (`OMNIDATA_BASE_URL`, `SEARXNG_URLS`, `OLLAMA_BASE_URL`, ...) to activate the corresponding live audits.

## Fixture format
Each dataset is a `.json` file with a top-level `source` note and `cases[]`. See each subfolder's fixture for the exact shape consumed by its test.
