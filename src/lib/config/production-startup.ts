import { getProductionReadiness, isProductionDeploy } from "@/lib/config/production";

let logged = false;

/** Log once per process when production env is misconfigured. */
export function logProductionWarnings(): void {
  if (logged || !isProductionDeploy()) return;
  logged = true;

  const { ready, blockers, warnings, checks } = getProductionReadiness();
  if (ready && warnings.length === 0) return;

  const lines: string[] = ["[OmniPresence] Production readiness:"];
  for (const check of checks) {
    if (check.status === "ok" || check.status === "skipped") continue;
    lines.push(`  ${check.status.toUpperCase()} ${check.label}: ${check.message || ""}`);
  }
  if (blockers.length) {
    console.error(lines.join("\n"));
  } else if (warnings.length) {
    console.warn(lines.join("\n"));
  }

  enforceFatalEnv(blockers);
}

/**
 * Fail fast on UNRECOVERABLE misconfiguration, but only on a real Vercel
 * runtime (not during `next build` and not in CI, which lack VERCEL). This
 * turns "cryptic error deep in a request handler" into a loud boot failure for
 * the two blockers that make the whole app non-functional, while leaving
 * optional-provider gaps as warnings.
 */
function enforceFatalEnv(blockers: string[]): void {
  const onVercelRuntime =
    process.env.VERCEL === "1" && process.env.NEXT_PHASE !== "phase-production-build";
  if (!onVercelRuntime) return;

  const fatal = blockers.filter((b) => b === "supabase" || b === "oauth_secret");
  if (fatal.length) {
    throw new Error(
      `[OmniPresence] Fatal production misconfiguration: missing ${fatal.join(", ")}. ` +
        `Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and OAUTH_STATE_SECRET.`
    );
  }
}
