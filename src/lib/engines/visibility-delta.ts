import type { VisibilityResult } from "@/types/database";

export type MovementType =
  | "gained_mention"
  | "lost_mention"
  | "gained_citation"
  | "lost_citation";

export interface PromptMovement {
  promptText: string;
  engine: string;
  type: MovementType;
}

export interface VisibilityRunDelta {
  gainedMentions: number;
  lostMentions: number;
  gainedCitations: number;
  lostCitations: number;
  competitorGains: Record<string, number>;
  competitorLosses: Record<string, number>;
  movements: PromptMovement[];
  currentRunDate?: string;
  previousRunDate?: string;
}

function resultKey(r: Pick<VisibilityResult, "prompt_text" | "engine">) {
  return `${r.engine}::${r.prompt_text}`;
}

export function compareVisibilityRuns(
  current: VisibilityResult[],
  previous: VisibilityResult[],
  competitors: string[] = []
): VisibilityRunDelta {
  const prevMap = new Map(previous.map((r) => [resultKey(r), r]));
  const currMap = new Map(current.map((r) => [resultKey(r), r]));

  let gainedMentions = 0;
  let lostMentions = 0;
  let gainedCitations = 0;
  let lostCitations = 0;
  const competitorGains: Record<string, number> = {};
  const competitorLosses: Record<string, number> = {};
  const movements: PromptMovement[] = [];

  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) continue;

    if (curr.brand_mentioned && !prev.brand_mentioned) {
      gainedMentions++;
      movements.push({ promptText: curr.prompt_text, engine: curr.engine, type: "gained_mention" });
    } else if (!curr.brand_mentioned && prev.brand_mentioned) {
      lostMentions++;
      movements.push({ promptText: curr.prompt_text, engine: curr.engine, type: "lost_mention" });
    }

    if (curr.brand_cited && !prev.brand_cited) {
      gainedCitations++;
      movements.push({ promptText: curr.prompt_text, engine: curr.engine, type: "gained_citation" });
    } else if (!curr.brand_cited && prev.brand_cited) {
      lostCitations++;
      movements.push({ promptText: curr.prompt_text, engine: curr.engine, type: "lost_citation" });
    }

    for (const comp of competitors) {
      const currMentioned = curr.competitor_mentions?.[comp] || false;
      const prevMentioned = prev.competitor_mentions?.[comp] || false;
      if (currMentioned && !prevMentioned) {
        competitorGains[comp] = (competitorGains[comp] || 0) + 1;
      } else if (!currMentioned && prevMentioned) {
        competitorLosses[comp] = (competitorLosses[comp] || 0) + 1;
      }
    }
  }

  return {
    gainedMentions,
    lostMentions,
    gainedCitations,
    lostCitations,
    competitorGains,
    competitorLosses,
    movements: movements.slice(0, 20),
  };
}
