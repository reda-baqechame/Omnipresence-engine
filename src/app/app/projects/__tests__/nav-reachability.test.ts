import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Guards against P2-1: a new page.tsx dropped under
// src/app/app/projects/[id]/<segment>/ that nobody links to from either the
// primary hub sidebar (PROJECT_HUB_NAV) or a hub page's `tools={[...]}`
// spoke list. PresenceOS intentionally uses a hub-and-spoke nav (a handful
// of top-level hub pages, dozens of spoke pages reachable only from within
// them) rather than a flat sidebar of 50 links, so "not in the sidebar" is
// fine — "not linked from anywhere" is a real orphan a user could never
// reach through the UI.

const projectsDir = join(import.meta.dirname, "..");
const capabilityNavPath = join(import.meta.dirname, "../../../../lib/navigation/capability-nav.ts");

// Segments that intentionally do not represent a linkable project sub-route.
const EXEMPT_SEGMENTS = new Set([
  "new", // src/app/app/projects/new — "create project" page, not under [id]
  "__tests__",
]);

function listDynamicProjectRouteSegments(): string[] {
  const idDir = join(projectsDir, "[id]");
  return readdirSync(idDir)
    .filter((name) => {
      if (EXEMPT_SEGMENTS.has(name)) return false;
      const full = join(idDir, name);
      if (!statSync(full).isDirectory()) return false;
      // Only count directories that actually define a page.
      try {
        statSync(join(full, "page.tsx"));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

/** Every `href: "/segment"` referenced anywhere under the projects tree (hub `tools=[...]` spokes, capability-nav, etc). */
function listReferencedHrefSegments(): Set<string> {
  const referenced = new Set<string>();
  const hrefPattern = /href:\s*["'`]\/([a-z0-9-]+)["'`]/g;

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        scanDir(full);
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
        const content = readFileSync(full, "utf8");
        for (const match of content.matchAll(hrefPattern)) {
          referenced.add(match[1]);
        }
      }
    }
  }

  scanDir(projectsDir);

  const navContent = readFileSync(capabilityNavPath, "utf8");
  for (const match of navContent.matchAll(hrefPattern)) {
    referenced.add(match[1]);
  }

  return referenced;
}

test("nav-reachability: every project sub-route directory is linked from the hub nav or a hub page's tools list", () => {
  const segments = listDynamicProjectRouteSegments();
  const referenced = listReferencedHrefSegments();

  const orphans = segments.filter((segment) => !referenced.has(segment));

  assert.deepEqual(
    orphans,
    [],
    `Found project sub-route(s) with no href reference anywhere in capability-nav.ts or a hub page's tools=[...] list: ${orphans.join(", ")}. ` +
      `Either add them to PROJECT_HUB_NAV, link them from a hub page's tools array, or delete the unreachable page.`
  );
});

test("nav-reachability: PROJECT_HUB_NAV and hub tools=[...] entries all point at real page.tsx routes", () => {
  const segments = new Set(listDynamicProjectRouteSegments());
  const referenced = listReferencedHrefSegments();

  // The reverse check: catch stale links left behind after a page is deleted
  // or renamed. `competitors` and `trust` are exempt because their routes are
  // top-level dirs under [id]/ already covered by listDynamicProjectRouteSegments;
  // this just re-confirms every referenced href resolves to a real directory.
  const dangling = [...referenced].filter((href) => !segments.has(href));

  assert.deepEqual(
    dangling,
    [],
    `Found href(s) referenced from nav/hub tools lists with no matching src/app/app/projects/[id]/<segment>/page.tsx: ${dangling.join(", ")}`
  );
});
