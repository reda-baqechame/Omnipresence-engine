#!/usr/bin/env node
/** Generate INTEGRATION_ENCRYPTION_KEY for Vercel production. */
import { randomBytes } from "crypto";

const key = randomBytes(32).toString("base64url");
console.log("\nINTEGRATION_ENCRYPTION_KEY (add to Vercel production env):\n");
console.log(key);
console.log("\nvercel env add INTEGRATION_ENCRYPTION_KEY production\n");
