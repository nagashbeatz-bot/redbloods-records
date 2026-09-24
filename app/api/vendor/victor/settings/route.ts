import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-auth";
import { validateVictorPaymentPatch, validateVictorSettingsPatch } from "@/lib/victor-settings-input";

/**
 * OWNER-ONLY (F2.19–F2.23 security) — Victor's compensation configuration.
 * GET   /api/vendor/victor/settings         — get Victor settings
 * PATCH /api/vendor/victor/settings         — update Victor settings (strict keys, validated)
 *
 * Payment sub-resource:
 * PATCH /api/vendor/victor/settings?payment=YYYY-MM  — mark payment status (strict, validated)
 *
 * Salary amount / currency feed the Owner's "send to finance" transaction and Partner finance
 * readiness, so Victor must never read-modify them: requireOwner here, and the path is excluded
 * from Victor's proxy allowlist (lib/roles.ts). Victor's own portal never calls this route.
 */

export async function GET() {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { getVictorSettings } = await import("@/lib/vendor-store");
    const settings = await getVictorSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireOwner(); if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const paymentMonth = searchParams.get("payment");
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

    if (searchParams.has("payment")) {
      const v = validateVictorPaymentPatch(paymentMonth, body);
      if (!v.ok) return NextResponse.json({ ok: false, errors: v.errors }, { status: 400 });
      const { setVictorPaymentStatus } = await import("@/lib/vendor-store");
      await setVictorPaymentStatus(v.value.month, v.value.status, v.value.paidDate);
    } else {
      const v = validateVictorSettingsPatch(body);
      if (!v.ok) return NextResponse.json({ ok: false, errors: v.errors }, { status: 400 });
      const { updateVictorSettings } = await import("@/lib/vendor-store");
      await updateVictorSettings(v.value);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
