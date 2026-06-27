import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * W3C Nu HTML Checker (validator.w3.org/nu) — free, keyless HTML validity API.
 * Returns structured error/warning messages. Degrades to `available:false`.
 */

const NU_URL = "https://validator.w3.org/nu/?out=json";

export interface W3cMessage {
  type: string;
  subType?: string;
  message: string;
  line?: number;
}
export interface W3cResult {
  available: boolean;
  reason?: string;
  errors: number;
  warnings: number;
  messages: W3cMessage[];
}

export async function validateHtml(html: string): Promise<W3cResult> {
  if (!html || html.trim().length === 0) {
    return { available: false, reason: "No HTML to validate", errors: 0, warnings: 0, messages: [] };
  }
  try {
    const res = await fetchWithTimeout(NU_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "User-Agent": "OmniPresence-Audit/1.0 (+https://github.com)",
      },
      body: html,
      timeoutMs: 25_000,
    });
    if (!res.ok) return { available: false, reason: `W3C validator ${res.status}`, errors: 0, warnings: 0, messages: [] };
    const data = (await res.json()) as { messages?: Array<{ type?: string; subType?: string; message?: string; lastLine?: number }> };
    const messages: W3cMessage[] = (data.messages || []).map((m) => ({
      type: m.type || "info",
      subType: m.subType,
      message: m.message || "",
      line: m.lastLine,
    }));
    const errors = messages.filter((m) => m.type === "error").length;
    const warnings = messages.filter((m) => m.type === "info" && m.subType === "warning").length;
    return { available: true, errors, warnings, messages };
  } catch (error) {
    logProviderError("w3c-validator", error, {});
    return { available: false, reason: error instanceof Error ? error.message : "W3C validation failed", errors: 0, warnings: 0, messages: [] };
  }
}
