#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.providers", ".env.local", ".env.migrate.tmp"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const { queryLLMForVisibility } = await import("../src/lib/providers/ai-gateway.ts");
const { queryPerplexitySonar } = await import("../src/lib/providers/perplexity.ts");

const prompt = "best skincare brands in Canada";
const brand = "Sirocco skin";
const domain = "siroccoskin.com";
const comps = ["Loreal"];

const models = {
  claude: ["claude-haiku-4-5", "claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
  gemini: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-8b"],
};

for (const p of ["openai", "gemini", "claude"]) {
  const r = await queryLLMForVisibility(p, prompt, brand, domain, comps, { grounded: false });
  console.log(p, "default", r.success, (r.error || "ok").slice(0, 120), r.data?.brandMentioned);
}

for (const [prov, ids] of Object.entries(models)) {
  for (const id of ids) {
    const envKey = prov === "claude" ? "AI_ANTHROPIC_MODEL" : "AI_GEMINI_MODEL";
    process.env[envKey] = id;
    const r = await queryLLMForVisibility(prov === "claude" ? "claude" : "gemini", prompt, brand, domain, comps, { grounded: false });
    console.log(prov, id, r.success, (r.error || "ok").slice(0, 100));
  }
}

const px = await queryPerplexitySonar(prompt, brand, domain, comps);
console.log("perplexity", px.success, px.error || "ok", px.data?.brandMentioned);
