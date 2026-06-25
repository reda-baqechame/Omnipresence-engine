"use client";

interface VisitorRow {
  id: string;
  company_name?: string | null;
  company_domain?: string | null;
  industry?: string | null;
  referrer_source?: string | null;
  landing_path?: string | null;
  enriched: boolean;
  created_at: string;
}

export function VisitorIdentityPanel({ sessions }: { sessions: VisitorRow[] }) {
  const enriched = sessions.filter((s) => s.enriched);

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-semibold mb-2">Visitor Identity</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Sessions from your tracking beacon. Optional Clearbit Reveal enriches company data when configured.
      </p>
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold">{sessions.length}</div>
          <div className="text-xs text-muted-foreground">Sessions</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{enriched.length}</div>
          <div className="text-xs text-muted-foreground">Enriched</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">
            {new Set(sessions.map((s) => s.referrer_source).filter(Boolean)).size}
          </div>
          <div className="text-xs text-muted-foreground">Referrer sources</div>
        </div>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
        {sessions.slice(0, 20).map((s) => (
          <div key={s.id} className="flex justify-between border-b border-border pb-2 gap-4">
            <span>
              {s.company_name || s.referrer_source || "Direct"}
              {s.company_domain && (
                <span className="text-muted-foreground ml-1">({s.company_domain})</span>
              )}
            </span>
            <span className="text-muted-foreground text-xs shrink-0">
              {new Date(s.created_at).toLocaleDateString()}
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-muted-foreground">No visitor sessions recorded yet.</p>
        )}
      </div>
    </div>
  );
}
