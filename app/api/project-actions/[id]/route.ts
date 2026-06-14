import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.actionType      !== undefined) patch.action_type         = body.actionType;
    if (body.contentType     !== undefined) patch.content_type        = body.contentType     || null;
    if (body.versionLabel    !== undefined) patch.version_label       = body.versionLabel    || null;
    if (body.recipientRole   !== undefined) patch.recipient_role      = body.recipientRole   || null;
    if (body.recipientName   !== undefined) patch.recipient_name      = body.recipientName   || null;
    if (body.recipientPhone  !== undefined) patch.recipient_phone     = body.recipientPhone  || null;
    if (body.dropboxUrl      !== undefined) patch.dropbox_url         = body.dropboxUrl      || null;
    if (body.status          !== undefined) patch.status              = body.status;
    if (body.actionDate      !== undefined) patch.action_date         = body.actionDate;
    if (body.followupDate    !== undefined) patch.followup_date       = body.followupDate    || null;
    if (body.notes           !== undefined) patch.notes               = body.notes           || null;
    if (body.linkedTaskId    !== undefined) patch.linked_task_id      = body.linkedTaskId    || null;

    const { data, error } = await supabase
      .from("project_actions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ action: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
