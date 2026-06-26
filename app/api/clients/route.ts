import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/clients-store";
import { requireAuth } from "@/lib/require-auth";

export async function GET() {
  const unauth = await requireAuth(); if (unauth) return unauth;
  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauth = await requireAuth(); if (unauth) return unauth;
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "שם חובה" }, { status: 400 });
    }
    const client = await createClient({
      name:   body.name.trim(),
      phone:  body.phone?.trim()  ?? "",
      email:  body.email?.trim()  ?? "",
      type:   body.type           ?? "לקוח",
      status: body.status         ?? "חדש",
      notes:  body.notes          ?? "",
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
