/**
 * Problem-aware landing pages for /learn/[slug] (Master Plan v4 Phase 4).
 *
 * These target the questions people actually search before they know tools
 * like this exist ("why doesn't ChatGPT recommend my brand"). Each page gives
 * genuinely useful, honest guidance first and offers the free grader as the
 * measured next step — no scare tactics, no fabricated statistics.
 */

export interface LearnSection {
  heading: string;
  body: string;
}

export interface LearnPage {
  slug: string;
  title: string;
  description: string;
  intro: string;
  sections: LearnSection[];
  cta: string;
}

export const LEARN_PAGES: LearnPage[] = [
  {
    slug: "why-chatgpt-doesnt-recommend-my-brand",
    title: "Why ChatGPT doesn't recommend your brand (and how to check)",
    description:
      "The real reasons ChatGPT skips your brand in recommendations — training data, retrieval sources, entity clarity — and how to measure where you stand for free.",
    intro:
      "When someone asks ChatGPT for \"the best [your category]\" and your brand never appears, there is always a mechanical reason. None of them are magic, and most of them are fixable. Here are the ones that actually matter.",
    sections: [
      {
        heading: "1. The model has no confident association between your brand and the category",
        body: "Language models recommend brands they've repeatedly seen associated with a category across their training and retrieval sources. If your brand is young, renamed, or mostly known through paid channels, that association can simply be missing. The fix is earned coverage on the pages engines actually read: comparison articles, category roundups, community threads, and documentation-grade content that names your brand and category in the same breath.",
      },
      {
        heading: "2. Web-browsing answers pull from sources where you're absent",
        body: "ChatGPT with browsing, Perplexity, and Google AI Overviews cite live web sources — usually a small set of review sites, listicles, and forums per category. If those specific pages don't mention you, you don't exist for that answer, no matter how good your own site is. Finding which sources each engine cites for your buying prompts (and which competitors sit there) tells you exactly where to pitch coverage.",
      },
      {
        heading: "3. Your site blocks or confuses AI crawlers",
        body: "GPTBot, ClaudeBot, PerplexityBot and Google-Extended each obey robots.txt. Some sites block them accidentally (copied robots rules, aggressive CDN bot rules). Others render key content only via JavaScript that crawlers don't execute. Check your robots.txt for AI user-agents and make sure your pricing, feature, and comparison pages exist as real HTML.",
      },
      {
        heading: "4. Entity ambiguity: the model isn't sure who you are",
        body: "If your brand name collides with a common word or another company, models hedge by leaving you out. Consistent naming across your site, schema.org Organization markup, a Wikipedia/Wikidata presence where warranted, and consistent third-party profiles reduce that ambiguity.",
      },
      {
        heading: "5. One-off checks lie to you",
        body: "AI answers vary between runs — the same prompt can include you at 9am and skip you at noon. A single screenshot proves nothing in either direction. Measuring honestly requires repeated runs across engines with sample-size floors — that's the difference between measurement and anecdote.",
      },
    ],
    cta: "Run the free grader to see — with receipts — whether AI engines recommend you today, which sources they cite, and who wins your category prompts.",
  },
  {
    slug: "how-to-get-cited-by-chatgpt",
    title: "How to get cited by ChatGPT: what actually moves citations",
    description:
      "A practical, no-hype guide to earning citations in ChatGPT, Perplexity, and Google AI Overviews — source placement, answer-ready content, and technical access.",
    intro:
      "Getting cited by AI engines isn't a trick — it's three mechanical conditions being true at once: the engine can read you, your page answers the question directly, and you appear in the sources that engine trusts for your category.",
    sections: [
      {
        heading: "Condition 1: The engine can crawl you",
        body: "Verify GPTBot, PerplexityBot, ClaudeBot, and Google-Extended are allowed in robots.txt, your content is server-rendered HTML, and your key pages return fast. This is table stakes — and the single most common silent failure we measure.",
      },
      {
        heading: "Condition 2: Your pages contain extractable answers",
        body: "Engines lift passages, not pages. Content that gets cited leads with the answer: a direct definition, a numbered comparison, a table with real figures, an FAQ that mirrors how buyers phrase questions. Rewrite key pages so the first 2–3 sentences under each heading could stand alone as a quoted answer.",
      },
      {
        heading: "Condition 3: You appear in the engine's trusted sources",
        body: "For commercial prompts, engines repeatedly cite a small set of third-party pages — category roundups, review platforms, Reddit threads, industry publications. Identify which pages get cited for your prompts, then earn placement there: pitch inclusions, update outdated listicles, answer forum threads genuinely. One placement in a repeatedly-cited source outweighs ten blog posts on your own domain.",
      },
      {
        heading: "Measure before and after, or you're guessing",
        body: "Citation work takes weeks and answers are volatile. Baseline your citation rate with repeated runs, do the work, then remeasure the same panel. If your measured citation rate doesn't move outside the noise band, the honest verdict is 'unchanged' — and you try the next source. That's the loop that compounds.",
      },
    ],
    cta: "Run the free grader to see which sources AI engines actually cite for your category — and where your competitors are cited but you aren't.",
  },
  {
    slug: "ai-visibility-tracker-accuracy",
    title: "Why most AI visibility numbers can't be trusted (accuracy explained)",
    description:
      "AI answers change between runs. Learn why single-run 'AI visibility scores' mislead, and what statistically honest AI search measurement looks like.",
    intro:
      "Ask the same engine the same question five times and you can get five different answers. Any tool that turns one run into a percentage is selling you noise. Here's what honest measurement requires.",
    sections: [
      {
        heading: "The volatility problem",
        body: "LLM answers are stochastic: sampling temperature, retrieval variation, and model updates all shift results between identical runs. A brand can 'appear' in 3 of 5 runs of the same prompt. Single-run trackers report that as either 100% or 0% visibility — both wrong.",
      },
      {
        heading: "What a real measurement needs",
        body: "Repeated runs per prompt-engine cell (at least 3), minimum total samples before reporting a headline rate (we require 30+ for directional and 50+ for headline numbers), confidence intervals so you can see the uncertainty, and volatility separated by cause — run-to-run noise vs prompt differences vs engine disagreement are different phenomena.",
      },
      {
        heading: "Only count what was actually measured",
        body: "Some tools blend estimates, cached results, and live measurements into one score. Every number should be labeled: measured (a real engine answered), estimated (a model guessed), or unavailable (the engine couldn't be reached). Estimates presented as measurements are how dashboards lie.",
      },
      {
        heading: "Receipts make it auditable",
        body: "The strongest honesty check is evidence you can verify without trusting the vendor: the raw answer, its capture time, the exact surface, and a cryptographic hash chained to previous receipts. If your tool can't show you the receipt behind a number, the number is an assertion, not a measurement.",
      },
    ],
    cta: "Run a free multi-run panel on your brand — every result comes with a verifiable receipt and its sample size, so you can judge the confidence yourself.",
  },
  {
    slug: "ai-search-audit-for-agencies",
    title: "AI search audits for agencies: selling GEO work clients believe",
    description:
      "How boutique agencies package AI visibility audits clients pay for — evidence-first reporting, honest baselines, and remeasured outcomes.",
    intro:
      "Clients are asking every agency the same question: 'how do we show up in ChatGPT?' The agencies winning that revenue aren't the ones with the prettiest dashboard — they're the ones whose numbers survive client scrutiny.",
    sections: [
      {
        heading: "Lead with a measured baseline, not a pitch",
        body: "An audit that opens with 'you appear in 12% of category prompts across 6 engines (n=240 measured answers)' — with evidence attached — closes retainers that generic 'AI is coming' decks don't. Baselines make the problem concrete and give you the before-picture for every future report.",
      },
      {
        heading: "Show the competitor gap, name the sources",
        body: "The most persuasive artifact in an AI search audit is the source gap: 'Perplexity cites these 5 pages for your category; your competitor is on 4 of them, you're on 0.' It converts an abstract problem into a concrete work order the client can approve line by line.",
      },
      {
        heading: "Sell the loop, not the report",
        body: "One-off audits are a foot in the door; retainers come from the loop — weekly fix sprints, each ending in a remeasured verdict. Reporting 'unchanged' honestly when a fix didn't move the needle builds more trust (and longer retainers) than success theater.",
      },
      {
        heading: "White-label the proof",
        body: "Your deliverable should carry your brand, and its numbers should be independently verifiable so the client never has to take your word. Receipts with public verification pages turn every report into a trust asset.",
      },
    ],
    cta: "Run a free audit on any prospect's domain — competitor reveal included — and see the white-label evidence report you'd hand them.",
  },
  {
    slug: "prove-ai-search-visibility",
    title: "How to prove AI search visibility changed (before/after that holds up)",
    description:
      "A rigorous way to prove GEO/AEO work moved AI visibility: matched panels, sample-size floors, and verifiable receipts on both sides.",
    intro:
      "Anyone can screenshot a good answer. Proving that your work changed AI visibility requires the same discipline as an A/B test: matched measurement before and after, enough samples, and evidence for both sides.",
    sections: [
      {
        heading: "Rule 1: The panels must match",
        body: "Before and after must run the same prompts, on the same engines, from the same geography and persona setup, with the same number of runs. Change any of those and the delta measures your methodology, not your work.",
      },
      {
        heading: "Rule 2: Respect the noise band",
        body: "With realistic sample sizes, mention-rate swings of a couple of percentage points are indistinguishable from noise. Set a movement threshold in advance (we use 3pp) and a minimum sample on both sides (we use 30 measured answers). Below the threshold, the honest verdict is 'unchanged'; below the sample floor, it's 'inconclusive'.",
      },
      {
        heading: "Rule 3: Correlation, labeled as such",
        body: "Even a clean before/after proves correlation, not causation — engines update, competitors act, seasonality exists. Say so in the report. Clients trust agencies that label their claims correctly, and it protects you when a number moves for reasons that weren't your work.",
      },
      {
        heading: "Rule 4: Receipts on both sides",
        body: "The before-panel and after-panel should both produce verifiable evidence — raw answers, timestamps, hashes. That's what makes the delta bulletproof in a client meeting: they can audit both endpoints themselves.",
      },
    ],
    cta: "Baseline your brand with a free measured panel now — so when you do the work, you'll have a defensible before-picture with receipts.",
  },
];

export function getLearnPage(slug: string): LearnPage | undefined {
  return LEARN_PAGES.find((p) => p.slug === slug);
}
