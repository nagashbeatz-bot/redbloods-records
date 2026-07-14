import "server-only";
import { NextResponse } from "next/server";
import { SketchError } from "./sketches-store";

/** Map a SketchError.code → HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "BAD_INPUT":
    case "BAD_TYPE":         return 400;
    case "TOO_BIG":          return 413;
    case "NOT_FOUND":        return 404;
    case "DUP_TITLE":        return 409;
    case "MANIFEST_BUSY":    return 409;
    case "MANIFEST_CORRUPT": return 409;
    default:                 return 500;
  }
}

/** Turn any thrown value into a safe JSON error response (Hebrew message, no internals). */
export function errResponse(err: unknown): NextResponse {
  if (err instanceof SketchError) {
    return NextResponse.json({ error: err.message }, { status: statusForCode(err.code) });
  }
  console.error("[red-artists/sketches]", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "שגיאת שרת, נסה שוב" }, { status: 500 });
}
