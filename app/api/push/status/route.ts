import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, created_at");

  return NextResponse.json({
    count: data?.length ?? 0,
    subscriptions: data?.map((s) => ({
      id: s.id,
      endpoint: s.endpoint.slice(0, 60) + "...",
      created_at: s.created_at,
    })),
    error: error?.message,
  });
}
