import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const DEV_FALLBACK = "dev-only-insecure-key-change-in-production";

export function isProductionDeploy(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview" ||
    // Railway deploys must enforce the same secret requirements as Vercel:
    // require a real encryption key and never fall back to the dev secret.
    Boolean(process.env.RAILWAY_ENVIRONMENT)
  );
}

export function hasIntegrationEncryptionKey(): boolean {
  const v = process.env.INTEGRATION_ENCRYPTION_KEY;
  return Boolean(v && v.length >= 32 && !v.startsWith("your-"));
}

function deriveKeyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function deriveEncryptKey(): Buffer {
  if (hasIntegrationEncryptionKey()) {
    return deriveKeyFromSecret(process.env.INTEGRATION_ENCRYPTION_KEY!);
  }
  if (isProductionDeploy()) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY (32+ chars) is required in production to store integrations"
    );
  }
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || DEV_FALLBACK;
  return deriveKeyFromSecret(fallback);
}

function deriveDecryptKeys(): Buffer[] {
  const secrets: string[] = [];
  if (hasIntegrationEncryptionKey()) secrets.push(process.env.INTEGRATION_ENCRYPTION_KEY!);
  const previous = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  if (previous && previous.length >= 32 && !previous.startsWith("your-")) {
    secrets.push(previous);
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) secrets.push(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!isProductionDeploy()) secrets.push(DEV_FALLBACK);
  const unique = [...new Set(secrets)];
  return unique.map(deriveKeyFromSecret);
}

export function encryptCredentials(payload: Record<string, unknown>): string {
  const key = deriveEncryptKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptCredentials<T extends Record<string, unknown>>(blob: string): T {
  const [ivB64, tagB64, dataB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid credential blob");

  let lastError: Error | null = null;
  for (const key of deriveDecryptKeys()) {
    try {
      const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(dec.toString("utf8")) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Decrypt failed");
    }
  }
  throw lastError || new Error("Decrypt failed");
}

export function maskCredentials(payload: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && /key|token|secret|password/i.test(k)) {
      masked[k] = v.length > 4 ? `${v.slice(0, 2)}***${v.slice(-2)}` : "***";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}
