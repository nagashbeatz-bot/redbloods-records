/**
 * Email sender for daily reports.
 * Uses Nodemailer + Gmail SMTP (App Password).
 * SERVER ONLY.
 *
 * Required env vars:
 *   SMTP_HOST   (default: smtp.gmail.com)
 *   SMTP_PORT   (default: 587)
 *   SMTP_USER   — your Gmail address
 *   SMTP_PASS   — Gmail App Password (not your regular password)
 *   EMAIL_FROM  — sender display (default: same as SMTP_USER)
 *   EMAIL_TO    — recipient (usually yourself)
 */
import "server-only";

export interface EmailPayload {
  subject: string;
  html:    string;
  text:    string;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_TO);
}

export async function sendReportEmail(payload: EmailPayload): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO } = process.env;

  if (!SMTP_USER || !SMTP_PASS || !EMAIL_TO) {
    throw new Error(
      "משתני הסביבה SMTP_USER / SMTP_PASS / EMAIL_TO חסרים. הגדר אותם ב-.env.local"
    );
  }

  const nodemailer = (await import("nodemailer")).default;

  const port   = parseInt(SMTP_PORT ?? "465", 10);
  const secure = port === 465;          // 465 = SSL, 587 = STARTTLS

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure,
    family: 4,                          // force IPv4 — Railway blocks IPv6 SMTP
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  } as any);

  await transporter.sendMail({
    from:    EMAIL_FROM ?? SMTP_USER,
    to:      EMAIL_TO,
    subject: payload.subject,
    html:    payload.html,
    text:    payload.text,
  });
}
