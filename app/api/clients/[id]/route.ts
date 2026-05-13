import { NextRequest, NextResponse } from "next/server";
import { updateClient, deleteClient } from "@/lib/clients-store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const { name, phone, email, type, status, notes } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: "שם הלקוח חסר" }, { status: 400 });
    }
    await updateClient(id, {
      name:   name.trim(),
      phone:  phone?.trim()  || "",
      email:  email?.trim()  || "",
      type:   type           || "אחר",
      status: status         || "חדש",
      notes:  notes?.trim()  || "",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients PATCH]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteClient(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    console.error("[clients DELETE]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
