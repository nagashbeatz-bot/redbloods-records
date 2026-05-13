import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/clients-store";

export async function GET() {
  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, phone, email, type, status, notes } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הלקוח חסר" }, { status: 400 });
    }
    const client = await createClient({
      name:   name.trim(),
      phone:  phone?.trim()  || "",
      email:  email?.trim()  || "",
      type:   type           || "אחר",
      status: status         || "חדש",
      notes:  notes?.trim()  || "",
    });
    return NextResponse.json({ client });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
