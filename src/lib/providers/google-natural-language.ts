import { fetchWithTimeout } from "./http";
import { getGoogleCloudApiKey, hasGoogleCloudApiKey } from "./google-cloud-key";
import { logProviderError } from "@/lib/observability/log";

const NLP_BASE = "https://language.googleapis.com/v1/documents";

export interface GoogleNlpEntity {
  name: string;
  type: string;
  salience: number;
  wikipediaUrl?: string;
}

export interface GoogleNlpAnalysis {
  available: boolean;
  reason?: string;
  sentiment: { score: number; magnitude: number; label: "positive" | "neutral" | "negative" };
  entities: GoogleNlpEntity[];
}

export function hasGoogleNlpCapability(): boolean {
  return hasGoogleCloudApiKey();
}

/** Entity + sentiment pass for content/entity audits (Cloud Natural Language API). */
export async function analyzeTextWithGoogleNlp(text: string): Promise<GoogleNlpAnalysis> {
  const key = getGoogleCloudApiKey();
  if (!key) {
    return {
      available: false,
      reason: "Google Cloud API key not set (enable Natural Language API on your key).",
      sentiment: { score: 0, magnitude: 0, label: "neutral" },
      entities: [],
    };
  }
  const sample = text.slice(0, 20_000);
  if (sample.trim().length < 40) {
    return {
      available: false,
      reason: "Text too short for NLP analysis.",
      sentiment: { score: 0, magnitude: 0, label: "neutral" },
      entities: [],
    };
  }
  const body = JSON.stringify({
    document: { type: "PLAIN_TEXT", content: sample },
    encodingType: "UTF8",
  });
  try {
    const [entityRes, sentimentRes] = await Promise.all([
      fetchWithTimeout(`${NLP_BASE}:analyzeEntities?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        timeoutMs: 15_000,
      }),
      fetchWithTimeout(`${NLP_BASE}:analyzeSentiment?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        timeoutMs: 15_000,
      }),
    ]);
    if (!entityRes.ok && !sentimentRes.ok) {
      const status = entityRes.status || sentimentRes.status;
      return {
        available: false,
        reason: `Natural Language API ${status} (enable language.googleapis.com on your key).`,
        sentiment: { score: 0, magnitude: 0, label: "neutral" },
        entities: [],
      };
    }
    const entities: GoogleNlpEntity[] = [];
    if (entityRes.ok) {
      const ej = (await entityRes.json()) as {
        entities?: Array<{
          name?: string;
          type?: string;
          salience?: number;
          metadata?: { wikipedia_url?: string };
        }>;
      };
      entities.push(
        ...(ej.entities || [])
          .filter((e) => e.name && (e.salience ?? 0) >= 0.01)
          .map((e) => ({
            name: e.name!,
            type: e.type || "UNKNOWN",
            salience: Math.round((e.salience || 0) * 1000) / 1000,
            wikipediaUrl: e.metadata?.wikipedia_url,
          }))
          .sort((a, b) => b.salience - a.salience)
          .slice(0, 12)
      );
    }
    let sentiment: GoogleNlpAnalysis["sentiment"] = { score: 0, magnitude: 0, label: "neutral" };
    if (sentimentRes.ok) {
      const sj = (await sentimentRes.json()) as {
        documentSentiment?: { score?: number; magnitude?: number };
      };
      const score = sj.documentSentiment?.score ?? 0;
      const magnitude = sj.documentSentiment?.magnitude ?? 0;
      const label = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
      sentiment = { score, magnitude, label };
    }
    return { available: entityRes.ok || sentimentRes.ok, entities, sentiment };
  } catch (error) {
    logProviderError("google-nlp", error);
    return {
      available: false,
      reason: error instanceof Error ? error.message : "Natural Language API failed",
      sentiment: { score: 0, magnitude: 0, label: "neutral" },
      entities: [],
    };
  }
}
