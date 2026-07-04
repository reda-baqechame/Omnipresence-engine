import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/transport";
import { apiError, readJsonBody } from "@/lib/security/api-response";
import { guardPublicEndpoint, isValidEmail } from "@/lib/security/public-guard";

const RESET_LIMIT = 5;
const RESET_WINDOW_MS = 60 * 60_000;

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "auth-password-reset", RESET_LIMIT, RESET_WINDOW_MS);
  if (limited) return limited;

  let body: { email?: string };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) return apiError("Enter a valid email address");

  const origin = request.nextUrl.origin;
  const service = await createServiceClient();

  const { data, error } = await service.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/auth/reset` },
  });

  // Avoid account enumeration in the UI. Log server-side so production can still
  // be diagnosed if Resend or Supabase link generation fails.
  if (error || !data.properties?.action_link) {
    console.warn("[auth/password-reset] generateLink failed:", error?.message || "missing action link");
    return NextResponse.json({ ok: true });
  }

  const resetUrl = data.properties.action_link;
  const sent = await sendEmail({
    to: email,
    subject: "Reset your OmniPresence password",
    html: `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
    <h1 style="font-size:20px">Reset your OmniPresence password</h1>
    <p>Use this secure link to choose a new password:</p>
    <p><a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none">Reset password</a></p>
    <p>If the button does not work, copy and paste this URL into your browser:</p>
    <p style="word-break:break-all"><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If you did not request this, you can ignore this email.</p>
  </body>
</html>`,
  });

  if (!sent.sent) {
    console.warn("[auth/password-reset] email send failed:", sent.reason);
  }

  return NextResponse.json({ ok: true });
}
