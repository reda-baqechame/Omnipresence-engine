# OmniPresence Engine — Phase 9 Spec: Dominate AEO Engine

**Goal:** Close remaining AEO Engine gaps — visitor identity, content pipeline depth, prompt scale, agency embeds, guarantee UX.

**Baseline:** Phase 8 complete — `verify:prod` 100%, `audit:phase8` PASS, production deployed.

---

## Phase 9 waves

### Wave A — Prompt & content scale
1. Prompt campaign UI (bulk CSV + funnel clustering, 300–1000 prompts)
2. GSC query → prompt import (OAuth required)
3. 14-step blog pipeline UI on Content tab
4. LLM referral breakdown chart on Attribution

### Wave B — Identity & agency
5. Visitor identity beacon + optional Clearbit Reveal
6. Embeddable widget v2 (brand color + logo params)
7. NAP consistency checker on Entity tab

### Wave C — Guarantee & media
8. Guarantee qualified-traffic rules UI
9. Podcast script → audio generation stub (OpenAI TTS ready)
10. Prompt ownership heatmap on Visibility

### Wave D — Production
11. Migration `0017_phase9.sql` (visitor_sessions)
12. Phase 9 wiring docs + audit script

---

## Manual wiring (Phase 9)

| Item | Env / action |
|------|----------------|
| Clearbit Reveal | `CLEARBIT_REVEAL_KEY` (optional) |
| GSC prompt import | Connect Google Search Console OAuth |
| Podcast TTS | `OPENAI_API_KEY` for `/api/podcast/generate` |
| Agency embed | Copy snippet from Settings → White Label |

---

## Success metrics

- [ ] `npm run audit:phase9` PASS
- [ ] `verify:prod` stays 100%
- [ ] Prompt campaign imports 500+ rows without timeout
- [ ] Visitor sessions visible when beacon installed
