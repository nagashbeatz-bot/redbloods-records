/**
 * Pure text-building for lib/red-artists/sketches-notify.ts — no
 * "server-only"/Supabase/push imports, testable from a plain tsx script.
 * Text is EXACT copy requested; workName/projectName are the only variables.
 */

export interface SketchNotifyPush { title: string; body: string }

export function buildNewSketchPush(workName: string): SketchNotifyPush {
  return { title: "הועלתה סקיצה חדשה 🎵", body: `הועלתה סקיצה חדשה בשם ״${workName}״` };
}

export function buildNewSketchOwnerAck(workName: string): SketchNotifyPush {
  return { title: "ההתראה נשלחה לשליו ✅", body: `נשלחה לשליו התראה על סקיצה חדשה בשם ״${workName}״` };
}

export function buildSketchUpdatedPush(projectName: string): SketchNotifyPush {
  return { title: "עודכנה סקיצה בפרויקט 🎵", body: `הסקיצה בפרויקט ״${projectName}״ עודכנה` };
}

export function buildSketchUpdatedOwnerAck(projectName: string): SketchNotifyPush {
  return { title: "ההתראה נשלחה לשליו ✅", body: `נשלחה לשליו התראה שהסקיצה בפרויקט ״${projectName}״ עודכנה` };
}
