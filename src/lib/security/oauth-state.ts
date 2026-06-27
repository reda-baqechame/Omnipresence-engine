import { createHmac, timingSafeEqual } from "crypto";

export interface OAuthStatePayload {
  provider: string;
  projectId: string;
  userId: string;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;
  // Never sign OAuth state with a guessable default in production — an attacker
  // who knows it could forge state and complete OAuth flows against a victim.
  if (process.env.NODE_ENV === "production") {
    throw new Error("OAUTH_STATE_SECRET is required in production");
  }
  return "presenceos-dev-oauth-secret";
}

export function signOAuthState(payload: Omit<OAuthStatePayload, "exp">): string {
  const full: OAuthStatePayload = { ...payload, exp: Date.now() + 10 * 60 * 1000 };
  const data = JSON.stringify(full);
  const sig = createHmac("sha256", getSecret()).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as {
      data: string;
      sig: string;
    };
    const expected = createHmac("sha256", getSecret()).update(parsed.data).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(parsed.sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(parsed.data) as OAuthStatePayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
