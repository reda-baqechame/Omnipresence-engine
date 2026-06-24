/** Classify AI/search referrers for attribution tracking */

const AI_REFERRER_PATTERNS: Array<{ pattern: RegExp; source: string }> = [
  { pattern: /chat\.openai\.com|chatgpt\.com/i, source: "chatgpt" },
  { pattern: /perplexity\.ai/i, source: "perplexity" },
  { pattern: /gemini\.google\.com|bard\.google\.com/i, source: "gemini" },
  { pattern: /copilot\.microsoft\.com|bing\.com\/chat/i, source: "bing_copilot" },
  { pattern: /claude\.ai/i, source: "claude" },
  { pattern: /you\.com/i, source: "you_com" },
  { pattern: /phind\.com/i, source: "phind" },
];

export function classifyReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  for (const { pattern, source } of AI_REFERRER_PATTERNS) {
    if (pattern.test(referrer)) return source;
  }
  return null;
}

export function isAIReferrer(referrer: string | null | undefined): boolean {
  return classifyReferrer(referrer) !== null;
}
