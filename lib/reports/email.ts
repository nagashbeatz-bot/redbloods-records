/**
 * Email sender for daily reports.
 * Uses Resend HTTP API (port 443) — works on Railway and any host.
 * SERVER ONLY.
 *
 * Required env vars:
 *   RESEND_API_KEY  — get free key at resend.com
 *   EMAIL_TO        — recipient address (usually yourself)
 *   EMAIL_FROM      — sender display (optional, default: onboarding@resend.dev)
 *                     Note: with free Resend plan, sender must be @resend.dev
 *                     unless you verify a custom domain.
 */
import "server-only";

export interface EmailPayload {
  subject: string;
  html:    string;
  text:    string;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_TO);
}

export async function sendReportEmail(payload: EmailPayload): Promise<void> {
  const { RESEND_API_KEY, EMAIL_TO, EMAIL_FROM } = process.env;

  if (!RESEND_API_KEY || !EMAIL_TO) {
    throw new Error(
      "משתני הסביבה RESEND_API_KEY / EMAIL_TO חסרים. הגדר אותם ב-Railway Variables"
    );
  }

  const from = EMAIL_FROM ?? "Redbloods Records <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from,
      to:      [EMAIL_TO],
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    }),
  });

  const data = await res.json() as { id?: string; name?: string; message?: string; statusCode?: number };

  if (!res.ok) {
    throw new Error(
      `Resend error ${res.status}: ${data.name ?? data.message ?? JSON.stringify(data)}`
    );
  }

  console.log(`[email] ✓ נשלח דרך Resend, id=${data.id}`);
}
