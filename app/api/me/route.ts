import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/require-auth";
import { roleForEmail } from "@/lib/roles";

/** GET /api/me — returns the signed-in user's email + role (for nav rendering). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = roleForEmail(user.email);
  if (role === "unknown") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ email: user.email, role });
}
