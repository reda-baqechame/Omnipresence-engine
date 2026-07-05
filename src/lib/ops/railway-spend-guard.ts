/**
 * Railway spend guard — alerts at 80% and 100% of RAILWAY_MONTHLY_BUDGET_USD.
 * Used by Inngest cron and callable from ops routes.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface RailwaySpendGuardResult {
  level: "ok" | "warn" | "critical" | "skipped";
  spendUsd: number | null;
  budgetUsd: number;
  pct: number;
  volume?: { capGb: number; usedGb: number; name?: string } | null;
  message: string;
}

function getToken(): string {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  try {
    const cfgPath = join(homedir(), ".railway", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
      user?: { accessToken?: string };
      accessToken?: string;
    };
    return cfg.user?.accessToken || cfg.accessToken || "";
  } catch {
    return "";
  }
}

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const token = getToken();
  if (!token) throw new Error("No Railway token");
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { errors?: Array<{ message: string }>; data?: unknown };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data as Record<string, unknown>;
}

async function fetchEstimatedSpendUsd(workspaceId: string): Promise<number | null> {
  if (!workspaceId) return null;
  try {
    const data = await gql(
      `query($workspaceId: String!) {
        workspace(workspaceId: $workspaceId) {
          customer {
            subscriptions {
              nextInvoiceCurrentTotal
            }
          }
        }
      }`,
      { workspaceId }
    );
    const total = (
      data?.workspace as { customer?: { subscriptions?: Array<{ nextInvoiceCurrentTotal?: number | string }> } }
    )?.customer?.subscriptions?.[0]?.nextInvoiceCurrentTotal;
    if (typeof total === "number") return total / 100;
    if (typeof total === "string") return Number(total) / 100;
    return null;
  } catch {
    return null;
  }
}

async function fetchVolumeCapGb(projectId: string) {
  try {
    const data = await gql(
      `query($id: String!) {
        project(id: $id) {
          environments {
            edges {
              node {
                volumeInstances {
                  edges {
                    node {
                      sizeMB
                      currentSizeMB
                      volume { name }
                      service { name }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { id: projectId }
    );
    const envs = (data?.project as { environments?: { edges?: Array<{ node: { volumeInstances?: { edges?: Array<{ node: {
      sizeMB: number;
      currentSizeMB: number;
      volume?: { name?: string };
      service?: { name?: string };
    } }> } } }> } })?.environments?.edges || [];
    const instances = envs.flatMap((e) => (e.node.volumeInstances?.edges || []).map((vi) => vi.node));
    const engineVol = instances.find((v) => v.service?.name === "omnipresence-engine");
    if (!engineVol) return null;
    return {
      capGb: Math.round(engineVol.sizeMB / 1024),
      usedGb: Number((engineVol.currentSizeMB / 1024).toFixed(1)),
      name: engineVol.volume?.name,
    };
  } catch {
    return null;
  }
}

async function postWebhook(webhook: string, text: string): Promise<void> {
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // best-effort
  }
}

export async function runRailwaySpendGuard(): Promise<RailwaySpendGuardResult> {
  const budgetUsd = Number(process.env.RAILWAY_MONTHLY_BUDGET_USD || 35);
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID || "";
  const webhook = process.env.RAILWAY_SPEND_ALERT_WEBHOOK || "";
  const projectId = process.env.RAILWAY_PROJECT_ID || "a59cacd1-25d3-404e-996b-4c61cc47f038";

  const [spendUsd, volume] = await Promise.all([
    fetchEstimatedSpendUsd(workspaceId),
    fetchVolumeCapGb(projectId),
  ]);

  if (volume && volume.capGb < 20) {
    const msg = `Webgraph volume below 20GB (${volume.usedGb}GB / ${volume.capGb}GB)`;
    await postWebhook(webhook, `[railway-spend-guard] WARN: ${msg}`);
    if (spendUsd == null) {
      return { level: "warn", spendUsd: null, budgetUsd, pct: 0, volume, message: msg };
    }
  }

  if (spendUsd == null) {
    return {
      level: "skipped",
      spendUsd: null,
      budgetUsd,
      pct: 0,
      volume,
      message: "Billing total unavailable (set RAILWAY_WORKSPACE_ID + Railway token)",
    };
  }

  const pct = budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : 0;

  if (pct >= 100) {
    const message = `Railway spend at or above budget ($${spendUsd.toFixed(2)} >= $${budgetUsd})`;
    await postWebhook(webhook, `[railway-spend-guard] CRITICAL: ${message}`);
    return { level: "critical", spendUsd, budgetUsd, pct, volume, message };
  }
  if (pct >= 80) {
    const message = `Railway spend at ${pct.toFixed(0)}% of budget`;
    await postWebhook(webhook, `[railway-spend-guard] WARN: ${message}`);
    return { level: "warn", spendUsd, budgetUsd, pct, volume, message };
  }

  return {
    level: "ok",
    spendUsd,
    budgetUsd,
    pct,
    volume,
    message: "Within budget",
  };
}
