/**
 * AutoGEO (MIT) — distilled Generative Engine Optimization rule set.
 *
 * AutoGEO (cx-cmu, MIT-licensed code + Qwen weights) automatically discovers the
 * edits that raise a page's visibility inside generative engines (ChatGPT,
 * Gemini, Claude, Perplexity, AI Overviews). We integrate it in two modes:
 *
 *   1. AutoGEO-API (default, zero infra): feed its discovered rule set as an
 *      instruction to our existing ai-gateway LLMs during the rewrite.
 *   2. AutoGEO-Mini (optional): the cx-cmu/AutoGEO_mini_Qwen model served via
 *      Ollama for keyless/cheap inference (set GEO_REWRITE_USE_OLLAMA=true).
 *
 * The rules below are the defensible, paper-grounded edits AutoGEO converges on
 * (statistics with citations, authoritative quotations, fluent self-contained
 * passages, entity coverage, source citation, unique specifics). They never
 * invent facts — they restructure and enrich existing, true content.
 */

export const AUTOGEO_RULES = `Apply these Generative Engine Optimization (GEO) edits — they measurably raise how often AI engines quote and cite a page (AutoGEO, MIT):
1. Statistics: surface concrete numbers, percentages, dates, and quantities that are already true of the brand/source. Numbers are quoted far more often than vague claims.
2. Cite sources: attribute facts to named, authoritative sources (studies, standards bodies, official docs) where the source content supports it.
3. Authoritative quotations: include short, verbatim-quotable expert or first-party statements.
4. Fluency & clarity: write self-contained, plainly-worded sentences an engine can lift without surrounding context.
5. Entity & term coverage: name the relevant entities, products, and technical terms a user's question would contain, so retrieval matches.
6. Unique specifics: include concrete, differentiated detail (exact features, constraints, comparisons) rather than generic marketing language.
7. Answer-first structure: lead every section with a direct 40-80 word answer, then a dense supporting block.
Never fabricate statistics, quotations, prices, or sources. Only restructure and enrich content that is true of the source.`;

/** Returns the AutoGEO instruction block (API mode). */
export function autoGeoInstructions(): string {
  return AUTOGEO_RULES;
}

/** Whether to route the rewrite through a self-hosted AutoGEO-Mini via Ollama. */
export function useAutoGeoOllama(): boolean {
  return (
    process.env.GEO_REWRITE_USE_OLLAMA === "true" &&
    Boolean(process.env.OLLAMA_BASE_URL)
  );
}
