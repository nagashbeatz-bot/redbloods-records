import { NextRequest, NextResponse } from "next/server";
import {
  getSoundEngineerWorkForProject,
  listSoundEngineerWork,
  createSoundEngineerWork,
  listEngineerNames,
} from "@/lib/sound-engineer-store";
import type { SoundEngineerStatus, SoundEngineerWorkType } from "@/lib/types";

/**
 * GET /api/sound-engineer?projectId=xxx   — get record for a project
 * GET /api/sound-engineer                 — list all records
 * GET /api/sound-engineer?names=1         — list all engineer names
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const projectId = searchParams.get("projectId");
    const names     = searchParams.get("names");
    const engineer  = searchParams.get("engineer");

    if (names === "1") {
      const list = await listEngineerNames();
      return NextResponse.json({ ok: true, names: list });
    }

    if (projectId) {
      const work = await getSoundEngineerWorkForProject(projectId);
      return NextResponse.json({ ok: true, work });
    }

    const works = await listSoundEngineerWork(engineer ?? undefined);
    return NextResponse.json({ ok: true, works });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sound-engineer
 * Body: { projectId, engineerName, workType?, status?, agreedPrice?, currency?,
 *         amountPaid?, sentDate?, internalDeadline?, filesLink?, notes? }
 * Creates work record + auto-creates expense transaction if agreedPrice > 0.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      projectId:        string;
      engineerName:     string;
      workType?:        SoundEngineerWorkType;
      status?:          SoundEngineerStatus;
      agreedPrice?:     number;
      currency?:        string;
      amountPaid?:      number;
      sentDate?:        string | null;
      internalDeadline?: string | null;
      filesLink?:       string | null;
      notes?:           string;
      skipFinanceSync?: boolean;
    };

    if (!body.projectId)    return NextResponse.json({ ok: false, error: "projectId חסר" },    { status: 400 });
    if (!body.engineerName) return NextResponse.json({ ok: false, error: "engineerName חסר" }, { status: 400 });

    const work = await createSoundEngineerWork(body.projectId, {
      engineerName:     body.engineerName,
      workType:         body.workType,
      status:           body.status,
      agreedPrice:      body.agreedPrice,
      currency:         body.currency,
      amountPaid:       body.amountPaid,
      sentDate:         body.sentDate,
      internalDeadline: body.internalDeadline,
      filesLink:        body.filesLink,
      notes:            body.notes,
      skipFinanceSync:  body.skipFinanceSync,
    });

    return NextResponse.json({ ok: true, work });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "שגיאת שרת";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
