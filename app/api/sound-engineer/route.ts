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
      projectId?:       string | null;
      workTitle?:       string | null;
      title?:           string | null;
      engineerName?:    string;
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

    // Hardening: engineerName must be a real, non-empty string (never trusted
    // blindly). NOTE: this route legitimately serves multiple engineers —
    // Steven, Bill and custom ("אחר") names from ProjectDrawer / MixSetupModal —
    // so a hard [Steven,Bill] allowlist would break custom-engineer creation.
    const engineerName = typeof body.engineerName === "string" ? body.engineerName.trim() : "";
    if (!engineerName) return NextResponse.json({ ok: false, error: "engineerName חסר" }, { status: 400 });

    // A work is EITHER linked to an existing project OR standalone (free title).
    const projectId = body.projectId || null;
    const workTitle = (body.workTitle ?? body.title ?? "").trim();
    if (!projectId && !workTitle) {
      return NextResponse.json({ ok: false, error: "יש לבחור פרויקט קיים או להזין שם עבודה" }, { status: 400 });
    }

    const work = await createSoundEngineerWork(projectId, {
      engineerName,
      workTitle:        workTitle || null,
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
