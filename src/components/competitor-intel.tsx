import { detectTechStack, type TechStackResult } from "@/lib/engines/tech-stack";
import { getPopularityIndex, type PopularityIndex } from "@/lib/engines/popularity-index";

/**
 * Server component: best-effort tech-stack fingerprint + relative Popularity
 * Index for the brand and its competitors (SimilarWeb tech-tracker lite).
 * Keyless; labeled as best-effort / relative (never absolute traffic).
 */
export async function CompetitorIntel({
  domain,
  competitors,
  brandName,
}: {
  domain: string;
  competitors: string[];
  brandName?: string;
}) {
  const targets = [domain, ...competitors.slice(0, 4)].filter(Boolean);
  const results = await Promise.all(
    targets.map(async (t, i) => ({
      target: t,
      stack: await safeDetect(t),
      popularity: await safePopularity(t, i === 0 ? brandName : undefined, i === 0),
    }))
  );

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Competitor Tech Stack</h3>
        <span className="text-xs text-muted-foreground">
          Best-effort fingerprint (public signals only)
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {results.map(({ target, stack, popularity }, i) => (
          <div key={target} className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{cleanLabel(target)}</span>
              {i === 0 && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                  You
                </span>
              )}
            </div>
            {popularity.score > 0 && (
              <div className="mt-2" title={popularity.note}>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Popularity Index (relative)</span>
                  <span className="font-medium text-foreground">{popularity.score}/100</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded bg-muted">
                  <div
                    className="h-1.5 rounded bg-primary"
                    style={{ width: `${popularity.score}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {popularity.signals.join(" + ") || "no signals"}
                </p>
              </div>
            )}
            {stack.available ? (
              <div className="mt-2 space-y-1.5">
                {Object.entries(stack.categories).map(([cat, names]) => (
                  <div key={cat} className="text-xs">
                    <span className="text-muted-foreground">{cat}: </span>
                    <span>{names.join(", ")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No public fingerprints detected (or site blocked the probe).
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

async function safeDetect(target: string): Promise<TechStackResult> {
  try {
    return await detectTechStack(target);
  } catch {
    return { url: target, technologies: [], categories: {}, data_source: "fingerprint", available: false };
  }
}

async function safePopularity(
  target: string,
  name: string | undefined,
  includeWiki: boolean
): Promise<PopularityIndex> {
  try {
    return await getPopularityIndex(target, { name, includeWiki });
  } catch {
    return {
      domain: target,
      score: 0,
      components: { authority: 0, referringDomains: 0, wikiViews: 0, ageYears: 0 },
      signals: [],
      note: "",
    };
  }
}

function cleanLabel(t: string): string {
  return t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}
