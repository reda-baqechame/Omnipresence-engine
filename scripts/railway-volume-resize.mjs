#!/usr/bin/env node
/**
 * Report Railway volume capacity and open dashboard Live Resize (API has no public resize mutation).
 *
 * Usage: node scripts/railway-volume-resize.mjs [sizeGB] [volumeName]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

const sizeGb = Number(process.argv[2] || process.env.RAILWAY_VOLUME_GB || 20);
const volumeName = process.argv[3] || "omnipresence-engine-volume";
const targetSizeMB = Math.round(sizeGb * 1024);
const projectId = "a59cacd1-25d3-404e-996b-4c61cc47f038";
const dashboardUrl = `https://railway.com/project/${projectId}`;

function getToken() {
  const cfgPath = join(homedir(), ".railway", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  return cfg.user?.accessToken || cfg.accessToken;
}

async function gql(query, variables = {}) {
  const token = getToken();
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

console.log(`\n=== railway-volume-resize → ${sizeGb}GB (${targetSizeMB}MB) ===\n`);

const envData = await gql(
  `query($id: String!) {
    project(id: $id) {
      environments {
        edges {
          node {
            id
            name
            volumeInstances {
              edges {
                node {
                  id
                  volumeId
                  sizeMB
                  currentSizeMB
                  mountPath
                  isPendingDeletion
                  deletedAt
                  state
                  volume { id name }
                  service { id name }
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
  envData?.project?.environments?.edges?.flatMap((e) =>
    (e.node.volumeInstances?.edges || []).map((vi) => ({
      ...vi.node,
      environmentId: e.node.id,
      environmentName: e.node.name,
    }))
  ) || [];

const inst = instances.find((v) => v.volume?.name === volumeName);
if (!inst) {
  console.error(
    `Volume instance "${volumeName}" not found. Available:`,
    instances.map((v) => `${v.volume?.name} (${v.environmentName})`)
  );
  process.exit(1);
}

const usedGb = (inst.currentSizeMB / 1024).toFixed(1);
const capGb = (inst.sizeMB / 1024).toFixed(0);
console.log(`Volume: ${inst.volume.name}`);
console.log(`Service: ${inst.service?.name} @ ${inst.mountPath} (${inst.environmentName})`);
console.log(`Usage: ${usedGb}GB / ${capGb}GB cap | state=${inst.state || "?"}`);

if (inst.isPendingDeletion) {
  console.warn(`\n⚠ CRITICAL: Volume is scheduled for deletion (${inst.deletedAt || "pending"})`);
  console.warn("  Cancel deletion in dashboard before it wipes ingest data.\n");
}

if (inst.sizeMB >= targetSizeMB) {
  console.log(`✓ Already at or above ${sizeGb}GB cap\n`);
  process.exit(0);
}

console.log("\nRailway's public GraphQL/CLI API does not expose Live Resize.");
console.log("Resize must be done in the dashboard:\n");
console.log(`  1. Open ${dashboardUrl}`);
console.log(`  2. omnipresence-engine → Volumes → ${volumeName}`);
console.log(`  3. Live Resize → ${sizeGb}GB+ (Pro plan)\n`);

if (process.platform === "win32") {
  spawnSync("cmd", ["/c", "start", "", dashboardUrl], { stdio: "ignore" });
} else if (process.platform === "darwin") {
  spawnSync("open", [dashboardUrl], { stdio: "ignore" });
} else {
  spawnSync("xdg-open", [dashboardUrl], { stdio: "ignore" });
}

console.log("(Opened dashboard in your browser — log in if prompted.)\n");
process.exit(2);
