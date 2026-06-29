/**
 * Professional-output defect detector (dependency-free, hot-path safe).
 *
 * Flags the classic LLM artifacts that make generated copy look unprofessional
 * and must NEVER ship to a client: AI self-references, refusals/apologies,
 * leftover placeholders, and unrendered template tokens. These are HARD fails in
 * the generation quality gate — the engine regenerates (or upgrades to a better
 * model) rather than shipping them, and never returns them as a degraded
 * fallback. Pure + zero-dependency so it is trivially testable and cheap to run
 * on every generation.
 *
 * Patterns are deliberately specific (AI self-reference REQUIRES the first-person
 * disclaimer form) so legitimate copy — including content written *about* AI — is
 * not falsely rejected.
 */
const DEFECT_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  // AI self-disclaimers — these never appear in real brand/marketing copy.
  { re: /\bas an ai language model\b/i, label: "AI self-reference" },
  { re: /\bas a language model\b/i, label: "AI self-reference" },
  { re: /\bas an ai,?\s+i\b/i, label: "AI self-reference" },
  { re: /\bi(?:'|’)?m an ai\b/i, label: "AI self-reference" },
  { re: /\bi am an ai\b/i, label: "AI self-reference" },
  // Refusals / apologies / meta-references to the model's own limits.
  { re: /\b(i(?:'|’)?m sorry,?\s+but|i apologize,?\s+but|unfortunately,?\s+i (?:cannot|can(?:'|’)?t))\b/i, label: "AI apology/refusal" },
  { re: /\b(my (?:training data|knowledge cutoff|last update)|knowledge cutoff)\b/i, label: "AI meta-reference" },
  { re: /\bi (?:cannot|can(?:'|’)?t|do not have|don(?:'|’)?t have)\b.{0,40}\b(?:access|browse|real[- ]?time|the internet)\b/i, label: "AI refusal" },
  // Leftover scaffolding that means the draft was never finished.
  { re: /\blorem ipsum\b/i, label: "placeholder (lorem ipsum)" },
  { re: /\[(?:insert|your|brand|company|product|client|todo|placeholder|x{2,})[^\]\n]{0,40}\]/i, label: "unfilled bracket placeholder" },
  { re: /\{\{[^}\n]+\}\}/, label: "unrendered template token" },
  { re: /(?:^|\s)(?:todo|fixme|tbd)\s*[:\-]/i, label: "TODO/FIXME marker" },
  { re: /\bx{4,}\b/i, label: "placeholder Xs" },
];

/**
 * Returns human-readable labels for every professional defect found (empty array
 * = clean). De-duplicated so the same defect class is reported once.
 */
export function detectContentDefects(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const { re, label } of DEFECT_PATTERNS) {
    if (re.test(text)) found.add(label);
  }
  return [...found];
}
