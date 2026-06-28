import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { buildProjectProof } from "@/lib/engines/proof-kpis";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function SourceBadge({ available, label }: { available: boolean; label: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
        available
          ? "bg-green-500/10 text-green-400 border-green-500/30"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {available ? label : "unavailable"}
    </span>
  );
}

export default async function ProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const proof = await buildProjectProof(supabase, id);

  const { aiVisibility: ai, firstPartyRank: rank, authority, coverage, execution } = proof;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Proof of Results</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Every metric below is <strong>measured</strong> from your first-party data
          (AI probe history, Search Console rank, the Common Crawl authority graph,
          and completed execution tasks). Missing signals are labeled{" "}
          <em>unavailable</em> — never faked. This is the refund shield: real
          movement you can see.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Generated {new Date(proof.generatedAt).toLocaleString()}
        </p>
      </div>

      {/* AI visibility lift */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">AI Visibility Lift (last 30d vs prior 30d)</h2>
          <SourceBadge available={ai.available} label="measured" />
        </div>
        {ai.available ? (
          <div className="grid sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className={`text-2xl font-bold ${ai.citationLiftPp >= 0 ? "text-green-400" : "text-red-400"}`}>
                {signed(ai.citationLiftPp)}pp
              </div>
              <div className="text-xs text-muted-foreground">Citation rate lift</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${ai.mentionLiftPp >= 0 ? "text-green-400" : "text-red-400"}`}>
                {signed(ai.mentionLiftPp)}pp
              </div>
              <div className="text-xs text-muted-foreground">Mention rate lift</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{pct(ai.after.citationRate)}</div>
              <div className="text-xs text-muted-foreground">
                Current citation rate ({ai.after.probes} probes)
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{pct(ai.after.mentionRate)}</div>
              <div className="text-xs text-muted-foreground">
                Current mention rate (was {pct(ai.before.citationRate)} cited)
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No AI probe history yet. Run a visibility scan to start measuring citation
            and mention movement across engines.
          </p>
        )}
      </section>

      {/* First-party rank */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">First-Party Rank (Search Console truth)</h2>
          <SourceBadge available={rank.available} label="first-party" />
        </div>
        {rank.available ? (
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {rank.avgFirstPartyPosition ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Avg GSC position</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{rank.firstPartyKeywords}</div>
              <div className="text-xs text-muted-foreground">Keywords on first-party data</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{rank.trackedKeywords}</div>
              <div className="text-xs text-muted-foreground">Total tracked keywords</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect Google Search Console to replace public SERP estimates with
            measured first-party positions for your tracked queries.
          </p>
        )}
      </section>

      {/* Authority moat */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Authority Moat (Common Crawl webgraph)</h2>
          <SourceBadge available={authority.available} label="measured" />
        </div>
        {authority.available ? (
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {authority.referringDomains.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">Hosts in webgraph index</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{authority.webgraphRelease ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Crawl release</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-muted-foreground">
                {authority.ingestedAt ? new Date(authority.ingestedAt).toLocaleDateString() : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Last ingested</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The webgraph index is not provisioned. Deploy OmniData with a persistent
            volume and run the webgraph ingest to unlock measured referring-domain and
            authority data.
          </p>
        )}
      </section>

      {/* Coverage + execution */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4">Capability Coverage</h2>
          <div className="flex items-end gap-3 mb-3">
            <div className="text-3xl font-bold text-primary">{coverage.coveragePct}%</div>
            <div className="text-xs text-muted-foreground mb-1">
              {coverage.measuredFlags}/{coverage.totalFlags} signals active
            </div>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${coverage.coveragePct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {coverage.configuredProviders}/{coverage.totalProviders} providers configured.
            Provision the open-source backend to push coverage toward 100%.
          </p>
        </section>

        <section className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4">Execution Evidence</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold text-green-400">{execution.completedTasks}</div>
              <div className="text-xs text-muted-foreground">Tasks completed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">{execution.openTasks}</div>
              <div className="text-xs text-muted-foreground">Tasks open</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{execution.verifiedLedgerEntries}</div>
              <div className="text-xs text-muted-foreground">Ledger entries verified</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-cyan-400">{execution.measuredGeoLifts}</div>
              <div className="text-xs text-muted-foreground">Measured GEO lifts</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
