#!/usr/bin/env node
/**
 * Railway spend guard CLI — wraps the same logic as the Inngest cron.
 * For local/CI use without bundling into Next.js.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envProviders = join(root, ".env.providers");
if (existsSync(envProviders)) {
  for (const line of readFileSync(envProviders, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const budgetUsd = Number(process.env.RAILWAY_MONTHLY_BUDGET_USD || 35);
const workspaceId = process.env.RAILWAY_WORKSPACE_ID || "";
const webhook = process.env.RAILWAY_SPEND_ALERT_WEBHOOK || "";
const projectId = process.env.RAILWAY_PROJECT_ID || "a59cacd1-25d3-404e-996b-4c61cc47f038";

function getToken() {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  try {
    const cfgPath = join(homedir(), ".railway", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    return cfg.user?.accessToken || cfg.accessToken || "";
  } catch {
    return "";
  }
}

async function gql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error("No Railway token (run `railway login` or set RAILWAY_TOKEN)");
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

async function fetchEstimatedSpendUsd() {
  if (!workspaceId) return null;
  try {
    const data = await gql(
      `query($workspaceId: String!) {
        workspace(workspaceId: $workspaceId) {
          customer { subscriptions { nextInvoiceCurrentTotal } }
        }
      }`,
      { workspaceId }
    );
    const total = data?.workspace?.customer?.subscriptions?.[0]?.nextInvoiceCurrentTotal;
    if (typeof total === "number") return total / 100;
    if (typeof total === "string") return Number(total) / 100;
    return null;
  } catch {
    return null;
  }
}

async function fetchVolumeCapGb() {
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
    const instances =
      data?.project?.environments?.edges?.flatMap((e) =>
        (e.node.volumeInstances?.edges || []).map((vi) => vi.node)
      ) || [];
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

async function postAlert(level, message, details) {
  const line = `[railway-spend-guard] ${level}: ${message}`;
  console.log(line);
  if (details) console.log(JSON.stringify(details, null, 2));
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${line}\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\`` }),
    });
  } catch (e) {
    console.warn("Webhook post failed:", e instanceof Error ? e.message : e);
  }
}

console.log("\n=== railway-spend-guard ===\n");

const [spendUsd, volume] = await Promise.all([fetchEstimatedSpendUsd(), fetchVolumeCapGb()]);

if (volume) {
  console.log(`Volume ${volume.name}: ${volume.usedGb}GB / ${volume.capGb}GB cap`);
  if (volume.capGb < 20) {
    await postAlert("WARN", "Webgraph volume below 20GB — full Common Crawl edges unavailable", volume);
  }
}

if (spendUsd == null) {
  console.log("Billing total unavailable (set RAILWAY_WORKSPACE_ID + Railway token).\n");
  process.exit(volume && volume.capGb < 20 ? 1 : 0);
}

const pct = budgetUsd > 0 ? (spendUsd / budgetUsd) * 100 : 0;
console.log(`Estimated cycle spend: $${spendUsd.toFixed(2)} / $${budgetUsd} budget (${pct.toFixed(0)}%)`);

const details = { spendUsd, budgetUsd, pct, volume };

if (pct >= 100) {
  await postAlert("CRITICAL", `Railway spend at or above budget ($${spendUsd.toFixed(2)} >= $${budgetUsd})`, details);
  process.exit(2);
}
if (pct >= 80) {
  await postAlert("WARN", `Railway spend at ${pct.toFixed(0)}% of budget`, details);
  process.exit(1);
}

console.log("✓ Within budget\n");
process.exit(0);
