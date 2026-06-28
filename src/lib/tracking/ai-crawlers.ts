/**
 * AI crawler / agent classifier — the core of Agent Analytics.
 *
 * AI engines fetch your pages with distinct user-agents BEFORE they can cite
 * you. Knowing which ones crawl (and how often) is the leading indicator of
 * future citation — the enterprise signal Profound charges for and the cheaper
 * tools lack. We classify the user-agent into a known bot, its vendor, and its
 * PURPOSE so a customer can tell "training my content" from "answering a live
 * user query" (the latter is the high-intent, citation-adjacent one).
 */

export type CrawlerPurpose = "ai_search" | "ai_training" | "ai_user_action" | "search_index";

export interface CrawlerInfo {
  bot: string;
  vendor: string;
  purpose: CrawlerPurpose;
}

// Order matters: more specific UA tokens first (e.g. OAI-SearchBot before a
// generic "openai" match) so a search bot isn't mislabeled as a training bot.
const CRAWLERS: Array<{ pattern: RegExp; info: CrawlerInfo }> = [
  // OpenAI
  { pattern: /OAI-SearchBot/i, info: { bot: "OAI-SearchBot", vendor: "OpenAI", purpose: "ai_search" } },
  { pattern: /ChatGPT-User/i, info: { bot: "ChatGPT-User", vendor: "OpenAI", purpose: "ai_user_action" } },
  { pattern: /GPTBot/i, info: { bot: "GPTBot", vendor: "OpenAI", purpose: "ai_training" } },
  // Anthropic
  { pattern: /Claude-SearchBot/i, info: { bot: "Claude-SearchBot", vendor: "Anthropic", purpose: "ai_search" } },
  { pattern: /Claude-User/i, info: { bot: "Claude-User", vendor: "Anthropic", purpose: "ai_user_action" } },
  { pattern: /Claude-Web/i, info: { bot: "Claude-Web", vendor: "Anthropic", purpose: "ai_user_action" } },
  { pattern: /ClaudeBot/i, info: { bot: "ClaudeBot", vendor: "Anthropic", purpose: "ai_training" } },
  { pattern: /anthropic-ai/i, info: { bot: "anthropic-ai", vendor: "Anthropic", purpose: "ai_training" } },
  // Perplexity
  { pattern: /Perplexity-User/i, info: { bot: "Perplexity-User", vendor: "Perplexity", purpose: "ai_user_action" } },
  { pattern: /PerplexityBot/i, info: { bot: "PerplexityBot", vendor: "Perplexity", purpose: "ai_search" } },
  // Google
  { pattern: /Google-Extended/i, info: { bot: "Google-Extended", vendor: "Google", purpose: "ai_training" } },
  { pattern: /GoogleOther/i, info: { bot: "GoogleOther", vendor: "Google", purpose: "ai_training" } },
  // Microsoft / Bing
  { pattern: /BingbotAI|Bing-AI/i, info: { bot: "Bing AI", vendor: "Microsoft", purpose: "ai_search" } },
  // Apple
  { pattern: /Applebot-Extended/i, info: { bot: "Applebot-Extended", vendor: "Apple", purpose: "ai_training" } },
  // Amazon
  { pattern: /Amazonbot/i, info: { bot: "Amazonbot", vendor: "Amazon", purpose: "ai_training" } },
  // Meta
  { pattern: /meta-externalagent|FacebookBot|meta-externalfetcher/i, info: { bot: "Meta AI", vendor: "Meta", purpose: "ai_training" } },
  // ByteDance
  { pattern: /Bytespider/i, info: { bot: "Bytespider", vendor: "ByteDance", purpose: "ai_training" } },
  // Cohere
  { pattern: /cohere-ai|cohere-training-data-crawler/i, info: { bot: "cohere", vendor: "Cohere", purpose: "ai_training" } },
  // Mistral
  { pattern: /MistralAI-User/i, info: { bot: "MistralAI-User", vendor: "Mistral", purpose: "ai_user_action" } },
  // DuckDuckGo
  { pattern: /DuckAssistBot/i, info: { bot: "DuckAssistBot", vendor: "DuckDuckGo", purpose: "ai_search" } },
  // You.com
  { pattern: /YouBot/i, info: { bot: "YouBot", vendor: "You.com", purpose: "ai_search" } },
  // Diffbot (powers several LLM pipelines)
  { pattern: /Diffbot/i, info: { bot: "Diffbot", vendor: "Diffbot", purpose: "ai_training" } },
  // Common Crawl (training corpus for most open models)
  { pattern: /CCBot/i, info: { bot: "CCBot", vendor: "Common Crawl", purpose: "ai_training" } },
  // Timpi / Petal / others
  { pattern: /PetalBot/i, info: { bot: "PetalBot", vendor: "Huawei", purpose: "search_index" } },
];

/** Classify a user-agent string. Returns null when it is not a known AI crawler. */
export function classifyCrawler(userAgent: string | null | undefined): CrawlerInfo | null {
  if (!userAgent) return null;
  for (const { pattern, info } of CRAWLERS) {
    if (pattern.test(userAgent)) return info;
  }
  return null;
}

export function isAICrawler(userAgent: string | null | undefined): boolean {
  return classifyCrawler(userAgent) !== null;
}

/** Human-readable label for a purpose code. */
export function crawlerPurposeLabel(purpose: CrawlerPurpose): string {
  switch (purpose) {
    case "ai_search":
      return "AI search index (citation-adjacent)";
    case "ai_user_action":
      return "Live user query (high intent)";
    case "ai_training":
      return "Model training crawl";
    case "search_index":
      return "Search index";
  }
}
