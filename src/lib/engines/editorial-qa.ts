import { franc } from "franc-min";
import { contentTerms, termFrequencies, sentenceStats } from "@/lib/nlp/wink";
import { checkGrammar, type GrammarIssue } from "@/lib/providers/languagetool";
import { analyzeTextWithGoogleNlp, type GoogleNlpAnalysis } from "@/lib/providers/google-natural-language";

/**
 * Editorial QA engine (Phase 12) — keyless content-quality pass.
 *  - Readability: Flesch Reading Ease + Flesch-Kincaid grade.
 *  - Keyphrase extraction: RAKE-style scoring over wink term frequencies.
 *  - Language detection: franc (MIT).
 *  - Thin-content detection: word-count thresholds.
 *  - Grammar/style: LanguageTool (self-host LGPL or public fallback), optional.
 */

const ISO3_TO_NAME: Record<string, string> = {
  eng: "English", spa: "Spanish", fra: "French", deu: "German", por: "Portuguese",
  ita: "Italian", nld: "Dutch", rus: "Russian", jpn: "Japanese", cmn: "Chinese",
  arb: "Arabic", hin: "Hindi", kor: "Korean",
};

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export interface Readability {
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  words: number;
  sentences: number;
  avgWordsPerSentence: number;
  label: string;
}

export function computeReadability(text: string): Readability {
  const stats = sentenceStats(text);
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length || 1;
  const sentences = Math.max(1, stats.sentences);
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);

  const wordsPerSentence = wordCount / sentences;
  const syllablesPerWord = syllables / wordCount;

  const ease = Math.round((206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord) * 10) / 10;
  const grade = Math.round((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) * 10) / 10;

  let label = "Standard";
  if (ease >= 80) label = "Very easy";
  else if (ease >= 60) label = "Plain English";
  else if (ease >= 50) label = "Fairly difficult";
  else if (ease >= 30) label = "Difficult";
  else label = "Very confusing";

  return {
    fleschReadingEase: ease,
    fleschKincaidGrade: grade,
    words: wordCount,
    sentences,
    avgWordsPerSentence: stats.avgWordsPerSentence,
    label,
  };
}

export interface Keyphrase {
  phrase: string;
  score: number;
}

/** RAKE-flavored keyphrase extraction over wink term frequencies. */
export function extractKeyphrases(text: string, limit = 15): Keyphrase[] {
  const freq = termFrequencies(text);
  const entries = [...freq.entries()]
    .filter(([term]) => term.includes(" ") || (freq.get(term) || 0) >= 2)
    .map(([phrase, count]) => {
      const words = phrase.split(" ").length;
      // Favor multi-word phrases (degree) weighted by frequency.
      return { phrase, score: Math.round(count * (1 + (words - 1) * 0.75) * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
  return entries.slice(0, limit);
}

export function detectLanguage(text: string): { code: string; name: string } {
  const sample = text.slice(0, 4000);
  if (sample.trim().length < 10) return { code: "und", name: "Unknown" };
  const iso3 = franc(sample, { minLength: 10 });
  return { code: iso3, name: ISO3_TO_NAME[iso3] || iso3 };
}

export interface EditorialQA {
  readability: Readability;
  keyphrases: Keyphrase[];
  language: { code: string; name: string };
  thinContent: boolean;
  uniqueTermRatio: number;
  grammar: {
    available: boolean;
    reason?: string;
    selfHosted: boolean;
    errorCount: number;
    topIssues: GrammarIssue[];
  };
  googleNlp: Pick<GoogleNlpAnalysis, "available" | "reason" | "sentiment" | "entities">;
  warnings: string[];
}

export async function runEditorialQA(
  text: string,
  options: { targetLanguage?: string; checkGrammar?: boolean } = {}
): Promise<EditorialQA> {
  const readability = computeReadability(text);
  const keyphrases = extractKeyphrases(text);
  const language = detectLanguage(text);

  const terms = contentTerms(text);
  const uniqueTermRatio = terms.length ? Math.round((new Set(terms).size / terms.length) * 100) / 100 : 0;
  const thinContent = readability.words < 300;

  const warnings: string[] = [];
  if (thinContent) warnings.push(`Thin content: only ${readability.words} words (aim for 800+ on key pages).`);
  if (readability.fleschReadingEase < 40) warnings.push(`Hard to read (Flesch ${readability.fleschReadingEase}). Shorten sentences and simplify words.`);
  if (readability.avgWordsPerSentence > 25) warnings.push(`Long sentences (avg ${readability.avgWordsPerSentence} words). Break them up.`);
  if (uniqueTermRatio < 0.35 && terms.length > 100) warnings.push(`Low lexical diversity (${uniqueTermRatio}) — content may be repetitive/thin.`);
  if (options.targetLanguage && !options.targetLanguage.startsWith(language.code.slice(0, 2)) && language.code !== "und") {
    warnings.push(`Detected language "${language.name}" differs from target "${options.targetLanguage}".`);
  }

  let grammar: EditorialQA["grammar"] = {
    available: false,
    reason: "Grammar check not requested",
    selfHosted: false,
    errorCount: 0,
    topIssues: [],
  };
  if (options.checkGrammar !== false) {
    const g = await checkGrammar(text);
    grammar = {
      available: g.available,
      reason: g.reason,
      selfHosted: g.selfHosted,
      errorCount: g.errorCount,
      topIssues: g.issues.slice(0, 10),
    };
    if (g.available && g.errorCount > 0) warnings.push(`${g.errorCount} grammar/style issue(s) found.`);
  }

  const nlp = await analyzeTextWithGoogleNlp(text);
  if (nlp.available) {
    const top = nlp.entities.slice(0, 3).map((e) => e.name);
    if (top.length) warnings.push(`Top entities (Google NLP): ${top.join(", ")}.`);
    if (nlp.sentiment.label === "negative" && nlp.sentiment.magnitude > 0.6) {
      warnings.push("Negative tone detected — consider neutral/authoritative phrasing for YMYL topics.");
    }
  }

  return {
    readability,
    keyphrases,
    language,
    thinContent,
    uniqueTermRatio,
    grammar,
    googleNlp: {
      available: nlp.available,
      reason: nlp.reason,
      sentiment: nlp.sentiment,
      entities: nlp.entities,
    },
    warnings,
  };
}
