#!/usr/bin/env node
/** Poll until Vercel marketplace terms accepted, then install Inngest + Firecrawl */
import { spawnSync } from "child_process";

const MAX = 30;
const SLEEP_MS = 10000;

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

function tryInstall(name, args) {
  const r = run(`vercel integration add ${name} ${args} -e production --format json`);
  return !r.out.includes("integration_terms_acceptance_required");
}

console.log("Waiting for Vercel marketplace terms (accept Inngest + Firecrawl in your browser)...\n");

for (let i = 1; i <= MAX; i++) {
  const inngestOk = tryInstall(
    "inngest",
    "-n omnipresence-inngest --plan a6658100-abeb-48d3-8cd6-81bbe78e80f0"
  );
  const firecrawlOk = tryInstall("firecrawl", "-n omnipresence-firecrawl");

  if (inngestOk && firecrawlOk) {
    run("vercel integration resource connect omnipresence-inngest -e production --yes");
    run("vercel integration resource connect omnipresence-firecrawl -e production --yes");
    console.log("Installed Inngest + Firecrawl. Run: vercel --prod");
    process.exit(0);
  }

  console.log(`Attempt ${i}/${MAX} — accept terms at:`);
  console.log("  https://vercel.com/redabaquechame58-2565s-projects/~/integrations/accept-terms/inngest");
  console.log("  https://vercel.com/redabaquechame58-2565s-projects/~/integrations/accept-terms/firecrawl\n");
  await new Promise((r) => setTimeout(r, SLEEP_MS));
}

console.error("Timed out. Accept terms manually, then re-run.");
process.exit(1);
