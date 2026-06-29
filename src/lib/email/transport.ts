/**
 * Sovereign email transport (Phase 23 / manifest v24, Wave K).
 *
 * Unified `email` port: a self-hosted SMTP adapter is preferred, with Resend as
 * an optional managed upgrade. SMTP makes transactional email fully sovereign —
 * point SMTP_HOST at your own Postfix/Maddy/etc. and configure SPF/DKIM/DMARC on
 * the sending domain (DKIM signing is supported inline via SMTP_DKIM_*). In
 * Zero-Paid-Keys mode only SMTP is used; everything degrades to
 * `{ sent: false }` rather than throwing.
 *
 * DNS guidance for deliverability (set on the From domain):
 *  - SPF:   TXT "v=spf1 ip4:<your-mail-ip> -all"
 *  - DKIM:  TXT <selector>._domainkey  "v=DKIM1; k=rsa; p=<public-key>"
 *  - DMARC: TXT _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>"
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface EmailSendResult {
  sent: boolean;
  provider?: "smtp" | "resend";
  id?: string;
  reason?: string;
}

function defaultFrom(): string {
  return process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "reports@presenceos.app";
}

export function hasSmtpCapability(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

export function hasResendCapability(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim());
}

// Minimal structural types so we don't hard-depend on nodemailer's types at
// compile time (it's dynamically imported with a variable specifier).
interface TransporterLike {
  sendMail(opts: Record<string, unknown>): Promise<{ messageId?: string }>;
}
interface NodemailerLike {
  createTransport(opts: Record<string, unknown>): TransporterLike;
}

async function sendViaSmtp(msg: EmailMessage): Promise<EmailSendResult> {
  try {
    const spec = "nodemailer";
    const mod = (await import(spec)) as unknown as { default?: NodemailerLike } & NodemailerLike;
    const nodemailer = mod.default ?? mod;

    const port = Number(process.env.SMTP_PORT || 587);
    const transport: Record<string, unknown> = {
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
    };
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      transport.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    }
    if (process.env.SMTP_DKIM_DOMAIN && process.env.SMTP_DKIM_SELECTOR && process.env.SMTP_DKIM_PRIVATE_KEY) {
      transport.dkim = {
        domainName: process.env.SMTP_DKIM_DOMAIN,
        keySelector: process.env.SMTP_DKIM_SELECTOR,
        privateKey: process.env.SMTP_DKIM_PRIVATE_KEY.replace(/\\n/g, "\n"),
      };
    }

    const transporter = nodemailer.createTransport(transport);
    const info = await transporter.sendMail({
      from: msg.from || defaultFrom(),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    return { sent: true, provider: "smtp", id: info.messageId };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "SMTP send failed" };
  }
}

async function sendViaResend(msg: EmailMessage): Promise<EmailSendResult> {
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const res = await resend.emails.send({
      from: msg.from || defaultFrom(),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    return { sent: true, provider: "resend", id: res.data?.id };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Resend send failed" };
  }
}

/**
 * Send an email through the sovereign-first port. Tries SMTP, then (unless
 * Zero-Paid-Keys mode) Resend. Returns a structured result; never throws.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const zeroPaidKeys = process.env.ZERO_PAID_KEYS === "true";

  if (hasSmtpCapability()) {
    const smtp = await sendViaSmtp(msg);
    if (smtp.sent) return smtp;
    if (zeroPaidKeys) return smtp; // no paid fallback allowed
  }

  if (!zeroPaidKeys && hasResendCapability()) {
    return sendViaResend(msg);
  }

  return { sent: false, reason: "No email transport configured (set SMTP_HOST or RESEND_API_KEY)" };
}
