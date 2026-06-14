import { NextRequest, NextResponse } from "next/server";
import { listShows, createShow } from "@/lib/shows-store";

export async function GET() {
  try {
    const shows = await listShows();
    return NextResponse.json({ shows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "שם ההופעה חובה" }, { status: 400 });
    }
    const show = await createShow({
      name:             body.name.trim(),
      artist:           body.artist?.trim()            ?? "",
      artist_client_id: body.artist_client_id          ?? null,
      booker_client_id: body.booker_client_id          ?? null,
      booker_name:      body.booker_name?.trim()       ?? "",
      date:             body.date                      ?? null,
      start_time:       body.start_time                ?? null,
      location:         body.location?.trim()          ?? "",
      contact_person:   body.contact_person?.trim()    ?? "",
      phone:            body.phone?.trim()             ?? "",
      status:           body.status                    ?? "ליד חדש",
      payment_status:   body.payment_status            ?? "לא שולם",
      show_price:       Number(body.show_price)        || 0,
      dj_fee:           body.dj_fee !== undefined ? Number(body.dj_fee) : 500,
      advance_payment:  Number(body.advance_payment)   || 0,
      notes:            body.notes?.trim()             ?? "",
    });
    return NextResponse.json({ show }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
