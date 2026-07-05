import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import { hasDirectLLMCapability } from "@/lib/config/capabilities";

const IntentSchema = z.object({
  items: z.array(
    z.object({
      keyword: z.string(),
      intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
    })
  ),
});

/** LLM batch intent classification when AI key present; regex fallback otherwise. */
export async function classifyKeywordIntents(
  keywords: string[]
): Promise<Map<string, "informational" | "commercial" | "transactional" | "navigational">> {
  const out = new Map<string, "informational" | "commercial" | "transactional" | "navigational">();
  const list = [...new Set(keywords)].filter(Boolean).slice(0, 40);
  if (!list.length) return out;

  if (hasDirectLLMCapability()) {
    const res = await generateStructured(
      "Classify each keyword's search intent for SEO.",
      `Classify intent for:\n${list.map((k) => `- ${k}`).join("\n")}`,
      IntentSchema
    );
    if (res.success && res.data?.items) {
      for (const item of res.data.items) {
        out.set(item.keyword.toLowerCase(), item.intent);
      }
      return out;
    }
  }

  for (const k of list) {
    const lower = k.toLowerCase();
    if (/\b(buy|price|pricing|cost|order|shop)\b/.test(lower)) out.set(lower, "transactional");
    else if (/\b(best|top|review|vs|compare|alternative)\b/.test(lower)) out.set(lower, "commercial");
    else if (/\b(login|official|website|app)\b/.test(lower)) out.set(lower, "navigational");
    else out.set(lower, "informational");
  }
  return out;
}
