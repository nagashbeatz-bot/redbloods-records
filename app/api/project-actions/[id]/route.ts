import { NextRequest, NextResponse } from "next/server";
import { deleteSendLogEntry, updateSendLogEntry } from "@/lib/writes/worklog";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const data = await updateSendLogEntry(id, body); // shared writer (lib/writes/worklog)
    return NextResponse.json({ action: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteSendLogEntry(id); // shared writer; Sunny's DELETE_SEND_LOG_ENTRY runs the drawer cascade server-side
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
