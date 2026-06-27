import winkNLP, { type WinkMethods } from "wink-nlp";
import model from "wink-eng-lite-web-model";

/**
 * Keyless NLP utilities (wink-nlp, MIT). Used by the content optimizer and
 * editorial QA. The English model is ~small and runs fully in-process — zero
 * API cost, no external calls. The instance is lazily created and cached.
 */

let nlpInstance: WinkMethods | null = null;

function nlp(): WinkMethods {
  if (!nlpInstance) {
    nlpInstance = winkNLP(model);
  }
  return nlpInstance;
}

/** Lowercased, stopword-free, lemmatized content words (>2 chars). */
export function contentTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  const eng = nlp();
  const its = eng.its;
  const doc = eng.readDoc(text.slice(0, 200_000));
  return doc
    .tokens()
    .filter(
      (t) =>
        t.out(its.type) === "word" &&
        !t.out(its.stopWordFlag) &&
        (t.out(its.normal) as string).length > 2
    )
    .out(its.normal)
    .map((w) => String(w).toLowerCase());
}

/** Frequency map of content terms (and bigrams) in a document. */
export function termFrequencies(text: string): Map<string, number> {
  const terms = contentTerms(text);
  const freq = new Map<string, number>();
  for (const t of terms) freq.set(t, (freq.get(t) || 0) + 1);
  // Bigrams capture multi-word phrases ("link building", "content marketing").
  for (let i = 0; i < terms.length - 1; i++) {
    const bigram = `${terms[i]} ${terms[i + 1]}`;
    freq.set(bigram, (freq.get(bigram) || 0) + 1);
  }
  return freq;
}

export interface NamedEntity {
  value: string;
  type: string;
}

/** Named entities (people, orgs, places, dates, money, etc.). */
export function entities(text: string): NamedEntity[] {
  if (!text || !text.trim()) return [];
  const eng = nlp();
  const its = eng.its;
  const doc = eng.readDoc(text.slice(0, 200_000));
  const out = doc.entities().out(its.detail) as Array<{ value: string; type: string }>;
  return out.map((e) => ({ value: e.value, type: e.type }));
}

export interface SentenceStats {
  sentences: number;
  words: number;
  avgWordsPerSentence: number;
}

export function sentenceStats(text: string): SentenceStats {
  const eng = nlp();
  const doc = eng.readDoc((text || "").slice(0, 200_000));
  const sentences = doc.sentences().length();
  const words = doc.tokens().filter((t) => t.out(eng.its.type) === "word").length();
  return {
    sentences,
    words,
    avgWordsPerSentence: sentences ? Math.round((words / sentences) * 10) / 10 : 0,
  };
}
