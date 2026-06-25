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
}
