import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * LanguageTool — grammar/style/clarity checker (Phase 12). Self-host (LGPL) on
 * Railway and point `LANGUAGETOOL_URL` at it, or use the public API as a
 * fallback. Keyless when self-hosted. Degrades to `available:false`.
 */

function getLanguageToolUrl(): string {
  const u = process.env.LANGUAGETOOL_URL;
  if (u && u.trim() && !u.startsWith("your-")) return u.replace(/\/+$/, "");
  return "https://api.languagetool.org"; // public fallback (rate-limited)
}

export function hasSelfHostedLanguageTool(): boolean {
  const u = process.env.LANGUAGETOOL_URL;
  return Boolean(u && u.trim() && !u.startsWith("your-"));
}

export interface GrammarIssue {
  message: string;
  category: string;
  offset: number;
  length: number;
  replacements: string[];
  context: string;
}

export interface GrammarResult {
  available: boolean;
  reason?: string;
  selfHosted: boolean;
  issues: GrammarIssue[];
  errorCount: number;
}

export async function checkGrammar(text: string, language = "en-US"): Promise<GrammarResult> {
  if (!text || text.trim().length < 5) {
    return { available: false, reason: "No text to check", selfHosted: hasSelfHostedLanguageTool(), issues: [], errorCount: 0 };
  }
  const base = getLanguageToolUrl();
  try {
    const body = new URLSearchParams({ text: text.slice(0, 40_000), language });
    const res = await fetchWithTimeout(`${base}/v2/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      return { available: false, reason: `LanguageTool ${res.status}`, selfHosted: hasSelfHostedLanguageTool(), issues: [], errorCount: 0 };
    }
    const data = (await res.json()) as {
      matches?: Array<{
        message?: string;
        rule?: { category?: { name?: string } };
        offset?: number;
        length?: number;
        replacements?: Array<{ value?: string }>;
        context?: { text?: string };
      }>;
    };
    const issues: GrammarIssue[] = (data.matches || []).map((m) => ({
      message: m.message || "",
      category: m.rule?.category?.name || "Other",
      offset: m.offset || 0,
      length: m.length || 0,
      replacements: (m.replacements || []).map((r) => r.value || "").filter(Boolean).slice(0, 3),
      context: m.context?.text || "",
    }));
    return { available: true, selfHosted: hasSelfHostedLanguageTool(), issues, errorCount: issues.length };
  } catch (error) {
    logProviderError("languagetool", error, {});
    return { available: false, reason: error instanceof Error ? error.message : "LanguageTool failed", selfHosted: hasSelfHostedLanguageTool(), issues: [], errorCount: 0 };
  }
}
