import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: "APP_PASSWORD לא מוגדר" }, { status: 500 });
  }

  if (password !== expected) {
    return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("rb_auth", expected, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    path:     "/",
    maxAge:   60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
