import { NextRequest, NextResponse } from "next/server";
import { listClients } from "@/lib/clients-store";
import { createClientRecord } from "@/lib/writes/clients";
import { requireOwner } from "@/lib/require-auth";

export async function GET() {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauth = await requireOwner(); if (unauth) return unauth;
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "שם חובה" }, { status: 400 });
    }
    const client = await createClientRecord(body); // shared writer (lib/writes/clients)
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
