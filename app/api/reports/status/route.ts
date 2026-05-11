import { NextResponse } from "next/server";

/**
 * GET /api/reports/status
 * Returns whether SMTP is configured (never exposes secrets).
 */
export async function GET() {
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const to   = process.env.EMAIL_TO  ?? "";

  const configured = !!(user && pass && to);

  return NextResponse.json({
    configured,
    smtpUser:  configured ? user  : null,
    emailTo:   configured ? to    : null,
    smtpHost:  process.env.SMTP_HOST ?? "smtp.gmail.com",
    smtpPort:  process.env.SMTP_PORT ?? "587",
  });
}
