import { test, mock } from "node:test";
import assert from "node:assert/strict";

let routeBacklinkCalls = 0;

mock.module("@/lib/providers/backlink-intelligence", {
  namedExports: {
    routeReferringDomains: async (domain: string) => {
      routeBacklinkCalls++;
      if (domain === "rival.example") {
        return {
          available: true,
          provider: "commoncrawl-webgraph",
          data: [{ url: "https://gap.example", domain: "gap.example", rank: 30 }],
        };
      }
      return { available: false, data: [], reason: "unavailable" };
    },
  },
});

mock.module("@/lib/engines/citation-intelligence", {
  namedExports: {
    collectLiveCitationSources: async () => [],
    collectDataForSEOCitationSources: async () => [],
    getStoredCitationSources: async () => [],
    aggregateTopCitedDomains: () => [],
    getTopCitedDomainsFromStored: () => [],
    getDataForSEOTopDomains: async () => [],
  },
});

mock.module("@/lib/providers/competitor-resolve", {
  namedExports: {
    resolveCompetitorDomainFree: async (name: string) =>
      name === "Rival Co" ? "rival.example" : null,
  },
});

mock.module("@/lib/providers/serp-router", {
  namedExports: {
    searchGoogleOrganicRouter: async () => ({ success: true, data: { organicResults: [] } }),
  },
});

const { findAuthorityOpportunities } = await import("../authority-finder.ts");

test("findAuthorityOpportunities uses routed backlinks instead of direct DataForSEO", async () => {
  routeBacklinkCalls = 0;
  const opps = await findAuthorityOpportunities(
    "proj-1",
    "Acme",
    "acme.example",
    "SaaS",
    ["Rival Co"],
    [],
    [{ name: "Rival Co", domain: "rival.example" }]
  );
  assert.ok(routeBacklinkCalls >= 1);
  const backlinkOpp = opps.find((o) => o.type === "backlink");
  assert.ok(backlinkOpp);
  assert.equal(backlinkOpp?.target_site, "gap.example");
});
