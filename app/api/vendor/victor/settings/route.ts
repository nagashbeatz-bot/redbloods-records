import { NextResponse } from "next/server";

/**
 * GET   /api/vendor/victor/settings         — get Victor settings
 * PATCH /api/vendor/victor/settings         — update Victor settings
 *
 * Payment sub-resource:
 * PATCH /api/vendor/victor/settings?payment=YYYY-MM  — mark payment status
 */

export async function GET() {
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
  try {
    const { searchParams } = new URL(req.url);
    const paymentMonth = searchParams.get("payment");
    const body = await req.json() as Record<string, unknown>;

    if (paymentMonth) {
      const { setVictorPaymentStatus } = await import("@/lib/vendor-store");
      await setVictorPaymentStatus(
        paymentMonth,
        (body.status as string) ?? "שולם",
        body.paidDate as string | undefined
      );
    } else {
      const { updateVictorSettings } = await import("@/lib/vendor-store");
      await updateVictorSettings(body as Parameters<typeof updateVictorSettings>[0]);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
