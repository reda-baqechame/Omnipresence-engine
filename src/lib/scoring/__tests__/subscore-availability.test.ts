import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubScoreAvailable, getSubScoreAvailability } from "../subscore-availability.ts";
import type { OmniPresenceScore } from "@/types/database.ts";

/**
 * P0 fix (hostile-audit punch list item #3): calculateOmniPresenceScore()
 * already computes per-dimension availability (breakdown.dimension_availability)
 * and re-normalizes the headline score over only measured dimensions — but
 * every report/dashboard renderer that displays a per-dimension subScore was
 * reading the raw numeric column directly, with NO gate. An unmeasured
 * dimension's raw value is a real `0` in the DB (calculateLocalVisibility()
 * etc. literally return 0 when there's no data), indistinguishable from an
 * actually-measured zero — rendering it produces a false "we checked, you
 * scored nothing" verdict instead of an honest "no data yet". These pin the
 * gate function every renderer (dashboard SubScoreBar, standard report,
 * deep report, React-PDF document) now calls before showing a numeric score.
 */

function score(breakdown?: Record<string, unknown>): OmniPresenceScore {
  return {
    id: "s1",
    project_id: "p1",
    omnipresence_score: 42,
    ai_visibility: 0,
    search_visibility: 0,
    local_visibility: 0,
    social_presence: 0,
    directory_coverage: 0,
    authority_mentions: 0,
    technical_readiness: 50,
    conversion_readiness: 0,
    breakdown,
  } as OmniPresenceScore;
}

test("isSubScoreAvailable: reflects breakdown.dimension_availability per dimension", () => {
  const s = score({
    dimension_availability: {
      ai_visibility: true,
      local_visibility: false,
      social_presence: false,
    },
  });
  assert.equal(isSubScoreAvailable(s, "ai_visibility"), true);
  assert.equal(isSubScoreAvailable(s, "local_visibility"), false);
  assert.equal(isSubScoreAvailable(s, "social_presence"), false);
});

test("isSubScoreAvailable: a dimension key absent from dimension_availability is unavailable, not a silent default", () => {
  const s = score({ dimension_availability: { ai_visibility: true } });
  // technical_readiness wasn't included in this breakdown — must not be
  // treated as available just because the key is missing (Boolean(undefined) === false).
  assert.equal(isSubScoreAvailable(s, "technical_readiness"), false);
});

test("isSubScoreAvailable: backward compatible — scores rows with no breakdown.dimension_availability default to available", () => {
  const s = score(undefined);
  assert.equal(isSubScoreAvailable(s, "local_visibility"), true, "pre-existing scores rows must not retroactively hide dimensions");

  const sEmptyBreakdown = score({});
  assert.equal(isSubScoreAvailable(sEmptyBreakdown, "local_visibility"), true);
});

test("getSubScoreAvailability: batch-maps labels to their dimension keys", () => {
  const s = score({
    dimension_availability: {
      ai_visibility: true,
      search_visibility: true,
      local_visibility: false,
      social_presence: false,
      directory_coverage: true,
      authority_mentions: false,
      technical_readiness: true,
      conversion_readiness: false,
    },
  });

  const result = getSubScoreAvailability(s, {
    AI: "ai_visibility",
    Search: "search_visibility",
    Local: "local_visibility",
    Social: "social_presence",
    Directories: "directory_coverage",
    Authority: "authority_mentions",
    Technical: "technical_readiness",
    Conversion: "conversion_readiness",
  });

  assert.deepEqual(result, {
    AI: true,
    Search: true,
    Local: false,
    Social: false,
    Directories: true,
    Authority: false,
    Technical: true,
    Conversion: false,
  });
});

test("getSubScoreAvailability: different renderer label sets can map to the same underlying dimension key", () => {
  const s = score({ dimension_availability: { authority_mentions: false } });
  // The React-PDF document uses "Authority Mentions"; the deep report uses
  // "Authority" — both must resolve to the same false for authority_mentions.
  const pdfLabels = getSubScoreAvailability(s, { "Authority Mentions": "authority_mentions" });
  const deepLabels = getSubScoreAvailability(s, { Authority: "authority_mentions" });
  assert.equal(pdfLabels["Authority Mentions"], false);
  assert.equal(deepLabels.Authority, false);
});
