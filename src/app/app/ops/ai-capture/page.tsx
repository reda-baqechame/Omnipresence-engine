interface SurfaceRow {
  attempts: number;
  success: number;
  blocked: number;
  ungrounded: number;
  failed: number;
  successRate: number;
  blockedRate: number;
  updatedAt: string;
}

interface HealthPayload {
  ok: boolean;
  service?: string;
  version?: string;
  surfaceHealth?: {
    surfaces?: Record<string, SurfaceRow>;
    totals?: { attempts: number; success: number; blocked: number; ungrounded: number; failed: number };
  };
}

function healthUrlFromCaptureUrl(captureUrl?: string): string | null {
  if (!captureUrl) return null;
  try {
    const parsed = new URL(captureUrl);
    parsed.pathname = "/health";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function loadHealth(): Promise<{ url: string | null; data: HealthPayload | null; error?: string }> {
  const url = healthUrlFromCaptureUrl(process.env.AI_UI_CAPTURE_URL);
  if (!url) return { url: null, data: null, error: "AI_UI_CAPTURE_URL is not configured." };
  try {
    const res = await fetch(url, { cache: "no-store", next: { revalidate: 0 } });
    if (!res.ok) return { url, data: null, error: `Health endpoint returned ${res.status}` };
    return { url, data: (await res.json()) as HealthPayload };
  } catch (error) {
    return { url, data: null, error: error instanceof Error ? error.message : "Failed to reach AI capture service" };
  }
}

export default async function AiCaptureOpsPage() {
  const health = await loadHealth();
  const surfaces = Object.entries(health.data?.surfaceHealth?.surfaces || {});
  const totals = health.data?.surfaceHealth?.totals;

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">AI Capture Surface Health</h1>
        <p className="text-muted-foreground">
          Live success and block rates from the AI UI capture service.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 text-sm">
        <div><span className="text-muted-foreground">Endpoint:</span> {health.url || "Not configured"}</div>
        <div><span className="text-muted-foreground">Service:</span> {health.data?.service || "n/a"}</div>
        <div><span className="text-muted-foreground">Version:</span> {health.data?.version || "n/a"}</div>
        {health.error && <div className="text-red-400 mt-2">{health.error}</div>}
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["Attempts", totals.attempts],
            ["Success", totals.success],
            ["Blocked", totals.blocked],
            ["Ungrounded", totals.ungrounded],
            ["Failed", totals.failed],
          ].map(([label, value]) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {surfaces.map(([surface, row]) => (
          <div key={surface} className="bg-card border border-border rounded-xl p-4">
            <div className="font-medium">{surface}</div>
            <div className="text-sm text-muted-foreground">
              attempts {row.attempts} · success {(row.successRate * 100).toFixed(1)}% · blocked {(row.blockedRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              success {row.success} · blocked {row.blocked} · ungrounded {row.ungrounded} · failed {row.failed}
            </div>
          </div>
        ))}
        {surfaces.length === 0 && (
          <div className="text-sm text-muted-foreground">No surface health metrics yet.</div>
        )}
      </div>
    </div>
  );
}
