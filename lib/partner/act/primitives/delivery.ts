/**
 * SUNNY UNIVERSAL ACTION LAYER — client delivery (the project's Delivery folder + status). Writes go through
 * lib/writes/delivery — the writers the project drawer uses. The folder path and the public link are never plan values
 * (plans never persist a path / URL); the preview says a public link is created. Uploading files into the folder needs
 * a new file's bytes (the file channel). "Delivered" is only what this record says — never inferred.
 */
import type { ArgSpec } from "../types";
import { finishPlan, parseKey, realYmd, refuse, type Fields, type PlanRefusal, type PrimitiveMeta, type PrimitiveSpec, type ResolvedTarget, type WriterDeps } from "./core";

export interface DeliveryFamilyWriters {
  readDeliveryState(projectId: string): Promise<{ status: string; deliveredAt: string | null; hasFolder: boolean; hasLink: boolean }>;
  createDeliveryFolder(projectId: string, artist: string, projectName: string): Promise<void>;
  setDeliveryStatus(projectId: string, patch: { deliveryStatus: string; deliveredAt: string | null }): Promise<void>;
  deleteDeliveryFolder(projectId: string): Promise<void>;
}
/** Pinned to components/ui/ProjectDrawer.tsx + lib/writes/delivery by the family test. */
export const DELIVERY_STATUS_VALUES: readonly string[] = ["not_created", "ready", "delivered"];
const K = (name: string): ArgSpec => ({ name, kind: "entityKey", required: true });
const ilToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const meta = (he: string, en: string, args: readonly ArgSpec[], fields: readonly string[], writer: string, o: Partial<PrimitiveMeta>): PrimitiveMeta =>
  ({ domain: "PROJECT", he, en, args, fields, effects: [], riskClass: "SAFE_REVERSIBLE", reversible: "YES", writer, compensation: "a new approved plan restoring the previous status shown in the preview", ...o });

const stateOf = async (d: WriterDeps, id: string): Promise<Fields | null> => {
  const p = await d.readProjectMeta(id); if (!p) return null;
  const s = await d.readDeliveryState(id);
  return { projectName: p.name, status: s.status, deliveredAt: s.deliveredAt, hasFolder: s.hasFolder };
};
async function onProject(d: WriterDeps, a: Readonly<Record<string, unknown>>): Promise<ResolvedTarget | PlanRefusal> {
  const k = parseKey(a.project, ["project"]); if (!k) return refuse("BAD_ENTITY", "צריך פרויקט (project:…)");
  const f = await stateOf(d, k.id); if (!f) return refuse("ENTITY_NOT_FOUND", "לא מצאתי את הפרויקט");
  return { key: `project:${k.id}`, id: k.id, label: `מסירה — ${f.projectName}`, fields: f };
}

export const DELIVERY_PRIMITIVES: readonly PrimitiveSpec[] = [
  {
    actionId: "CREATE_DELIVERY_FOLDER", kinds: ["project"],
    meta: meta("יצירת תיקיית מסירה ללקוח (עם קישור ציבורי)", "Create the project's Delivery folder with a PUBLIC share link (status ready) — the drawer's 'create delivery'", [K("project")], ["status", "hasFolder"], "createDeliveryFolder (lib/writes/delivery)", { effects: ["FILES", "EXTERNAL_LINK"], riskClass: "FILE_MUTATION", reversible: "PARTIAL", compensation: "DELETE_DELIVERY_FOLDER" }),
    resolve: onProject, read: stateOf,
    plan(_a, cur) { if (cur.status !== "not_created" && cur.hasFolder) return refuse("ALREADY_EXISTS", "כבר יש תיקיית מסירה לפרויקט"); return finishPlan(cur, { status: "ready", hasFolder: true }); },
    async apply(d, id) { const p = await d.readProjectMeta(id); if (!p) throw new Error("project not found"); await d.createDeliveryFolder(id, p.artist ?? "", p.name); },
    requiredValues: () => ["קישור ציבורי"],
    disclosuresHe: ["נוצרת תיקייה בתיקיית הפרויקט ונוצר קישור ציבורי אליה — מי שמחזיק בקישור יכול לפתוח אותה", "הקישור לא נשלח לאף אחד; לא נוצר שום קובץ", "העלאת קבצים לתיקייה = ערוץ הקבצים (עוד לא)"],
  },
  {
    actionId: "SET_DELIVERY_STATUS", kinds: ["project"],
    meta: meta("סימון מסירה (נמסר / חזרה למוכן)", "Mark the delivery delivered (with the date) or back to ready — only the status and the delivered date change", [K("project"), { name: "status", kind: "enum", required: true, values: ["ready", "delivered"] }, { name: "deliveredAt", kind: "ymd", required: false }], ["status", "deliveredAt"], "setDeliveryStatus (lib/writes/delivery)", {}),
    resolve: onProject, read: stateOf,
    plan(a, cur) {
      if (!cur.hasFolder || cur.status === "not_created") return refuse("NO_DELIVERY", "אין עדיין תיקיית מסירה לפרויקט");
      if (a.status === "delivered") {
        if (a.deliveredAt !== undefined && !realYmd(a.deliveredAt)) return refuse("BAD_DATE", "תאריך לא תקין");
        // B5: delivered always carries a date — the given one, else today in Israel (the writer's own default)
        return finishPlan(cur, { status: "delivered", deliveredAt: String(a.deliveredAt ?? ilToday()) });
      }
      if (a.deliveredAt !== undefined) return refuse("BAD_ARGS", "תאריך מסירה רק כשמסמנים 'נמסר'");
      return finishPlan(cur, { status: "ready", deliveredAt: null });
    },
    apply: (d, id, a) => d.setDeliveryStatus(id, { deliveryStatus: String(a.status), deliveredAt: a.status === "delivered" ? String(a.deliveredAt ?? ilToday()) : null }),
    disclosuresHe: ["רק הסטטוס ותאריך המסירה משתנים — התיקייה והקישור לא", "חזרה ל'מוכן' מנקה את תאריך המסירה הנוכחי; תאריך המסירה האחרון נשמר כהיסטוריה", "לא נשלח כלום ללקוח"],
  },
  {
    actionId: "DELETE_DELIVERY_FOLDER", kinds: ["project"],
    meta: meta("מחיקת תיקיית המסירה (וכל מה שבתוכה)", "Delete the whole Delivery folder and reset the delivery to not created — the drawer's delete", [K("project")], ["status", "hasFolder"], "deleteDeliveryFolder (lib/writes/delivery)", { effects: ["FILES", "DELETION", "EXTERNAL_LINK"], riskClass: "DESTRUCTIVE", reversible: "NO", compensation: null }),
    resolve: onProject, read: stateOf,
    plan(_a, cur) { if (!cur.hasFolder && cur.status === "not_created") return refuse("NO_DELIVERY", "אין תיקיית מסירה למחוק"); return finishPlan(cur, { status: "not_created", hasFolder: false }); },
    apply: (d, id) => d.deleteDeliveryFolder(id),
    requiredValues: () => ["מחיקה"],
    warnings: (c) => [c.status === "delivered" ? "הפרויקט מסומן 'נמסר' — הלקוח אולי עוד משתמש בקישור" : "כל הקבצים שבתיקיית המסירה נמחקים", "הקישור הציבורי מפסיק לעבוד"],
    disclosuresHe: ["התיקייה וכל הקבצים שבה נמחקים מהאחסון; המסירה חוזרת ל'לא נוצרה'", "אם הפרויקט נמסר בעבר — תאריך המסירה האחרון נשמר (עובדת המסירה לא נמחקת)", "לא נשלח כלום"],
  },
];
