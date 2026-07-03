"use client";

import { useState } from "react";
import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

interface TermTarget {
  term: string;
  prevalence: number;
  recommended: number;
  inDraft: number;
  status: "missing" | "underused" | "ok";
}
interface EntityTarget {
  entity: string;
  type: string;
  prevalence: number;
  inDraft: boolean;
}
interface EditorialQA {
  readability: { fleschReadingEase: number; fleschKincaidGrade: number; words: number; avgWordsPerSentence: number; label: string };
  keyphrases: Array<{ phrase: string; score: number }>;
  language: { code: string; name: string };
  thinContent: boolean;
  uniqueTermRatio: number;
  grammar: { available: boolean; reason?: string; selfHosted: boolean; errorCount: number; topIssues: Array<{ message: string; category: string; replacements: string[] }> };
  googleNlp?: {
    available: boolean;
    reason?: string;
    sentiment: { score: number; magnitude: number; label: "positive" | "neutral" | "negative" };
    entities: Array<{ name: string; type: string; salience: number; wikipediaUrl?: string }>;
  };
  warnings: string[];
}
interface ContentScoreResult {
  available: boolean;
  reason?: string;
  keyword: string;
  competitorsAnalyzed: number;
  medianWordCount: number;
  draftWordCount: number;
  score: number;
  termTargets: TermTarget[];
  entityTargets: EntityTarget[];
  headingSuggestions: string[];
  editorial?: EditorialQA | null;
}

const STATUS_STYLE: Record<string, string> = {
  missing: "text-red-400",
  underused: "text-yellow-400",
  ok: "text-green-400",
};

export function ContentOptimizerPanel({ projectId }: { projectId: string }) {
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContentScoreResult | null>(null);

  async function run() {
    if (!keyword.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/content-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, keyword, draftText: draft }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <CapabilityEvidenceBar
        projectId={projectId}
        capability="content"
        target=""
        label="Content proof"
        quality={result?.available ? "measured" : "unavailable"}
      />
      <div>
        <h3 className="font-semibold">Content Optimizer</h3>
        <p className="text-sm text-muted-foreground">
          Keyless Surfer-class scoring: enter a target keyword (and optionally paste your draft) to score it
          against the live top-10 ranking pages — term gaps, entity coverage, and a heading plan.
        </p>
      </div>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Target keyword (e.g. best crm for startups)"
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
      />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Optional: paste your draft to get a 0-100 content score and gap list"
        rows={5}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={run}
        disabled={loading || !keyword.trim()}
        className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
      >
        {loading ? "Analyzing top-10…" : "Score content"}
      </button>

      {result && !result.available && <p className="text-sm text-yellow-400">{result.reason}</p>}
      {result?.available && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-6 text-sm">
            {draft.trim() && (
              <span>Score: <strong className={result.score >= 70 ? "text-green-400" : result.score >= 40 ? "text-yellow-400" : "text-red-400"}>{result.score}/100</strong></span>
            )}
            <span>Median length: <strong>{result.medianWordCount}</strong> words</span>
            <span>Pages analyzed: <strong>{result.competitorsAnalyzed}</strong></span>
          </div>

          {result.termTargets.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Term targets</h4>
              <div className="flex flex-wrap gap-1.5">
                {result.termTargets.map((t) => (
                  <span key={t.term} className={`text-xs border border-border/60 rounded px-1.5 py-0.5 ${STATUS_STYLE[t.status]}`} title={`In ${Math.round(t.prevalence * 100)}% of pages · use ~${t.recommended}× · draft ${t.inDraft}×`}>
                    {t.term} {draft.trim() ? `(${t.inDraft}/${t.recommended})` : `·${Math.round(t.prevalence * 100)}%`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.entityTargets.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Entities to cover</h4>
              <div className="flex flex-wrap gap-1.5">
                {result.entityTargets.map((e) => (
                  <span key={e.entity} className={`text-xs border border-border/60 rounded px-1.5 py-0.5 ${draft.trim() ? (e.inDraft ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}>
                    {e.entity}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.headingSuggestions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Suggested headings</h4>
              <ul className="text-sm list-disc pl-5 space-y-0.5">
                {result.headingSuggestions.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {result.editorial && (
            <div className="border-t border-border/60 pt-3 space-y-2">
              <h4 className="text-sm font-medium">Editorial QA</h4>
              <div className="flex flex-wrap gap-4 text-sm">
                <span>Readability: <strong className={result.editorial.readability.fleschReadingEase >= 50 ? "text-green-400" : "text-yellow-400"}>{result.editorial.readability.label}</strong> ({result.editorial.readability.fleschReadingEase})</span>
                <span>Grade level: <strong>{result.editorial.readability.fleschKincaidGrade}</strong></span>
                <span>Language: <strong>{result.editorial.language.name}</strong></span>
                {result.editorial.grammar.available && (
                  <span>Grammar issues: <strong className={result.editorial.grammar.errorCount === 0 ? "text-green-400" : "text-yellow-400"}>{result.editorial.grammar.errorCount}</strong></span>
                )}
                {result.editorial.googleNlp?.available && (
                  <span>Google NLP tone: <strong className={result.editorial.googleNlp.sentiment.label === "negative" ? "text-yellow-400" : "text-green-400"}>{result.editorial.googleNlp.sentiment.label}</strong></span>
                )}
              </div>
              {result.editorial.googleNlp?.available && result.editorial.googleNlp.entities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.editorial.googleNlp.entities.slice(0, 8).map((e) => (
                    <span key={e.name} className="text-xs border border-border/60 rounded px-1.5 py-0.5 text-muted-foreground" title={e.type}>
                      {e.name}
                    </span>
                  ))}
                </div>
              )}
              {result.editorial.warnings.length > 0 && (
                <ul className="text-xs text-yellow-400 list-disc pl-5 space-y-0.5">
                  {result.editorial.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
              {result.editorial.keyphrases.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.editorial.keyphrases.slice(0, 12).map((k) => (
                    <span key={k.phrase} className="text-xs border border-border/60 rounded px-1.5 py-0.5 text-muted-foreground">{k.phrase}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
