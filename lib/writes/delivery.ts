/**
 * Shared writers for client delivery (settings `delivery_<project>`: folderPath, deliveryLink, deliveryStatus,
 * deliveredAt). Used by BOTH /api/delivery and Sunny's typed primitives; route bodies moved verbatim.
 * HARDENED (2026-09-27, Universal Actions):
 *   • setDeliveryStatus writes ONLY deliveryStatus (not_created / ready / delivered) + deliveredAt (YYYY-MM-DD or null)
 *     merged into the current record — it used to merge the whole request body (folderPath / deliveryLink could be
 *     overwritten by any key). Unknown keys / values are refused.
 *   • createDeliveryFolder / deleteDeliveryFolder check the settings write (it used to be ignored on create).
 * B5 (2026-09-27) — status / date coherence:
 *   • "delivered" always carries deliveredAt (the given YYYY-MM-DD, default = today in Israel); any other status clears
 *     deliveredAt. Every delivered date is also kept as `lastDeliveredAt` (history in the SAME settings value): leaving
 *     "delivered", re-creating the folder or deleting it never erases the fact that it was delivered once.
 *   • deleteDeliveryFolder resets the record to not_created (the drawer UI) but keeps lastDeliveredAt.
 */
import { supabase } from "@/lib/supabase";
import { getDropboxToken } from "@/lib/dropbox-token";
import { deliveryFolder } from "@/lib/project-paths";

export const DELIVERY_STATUSES = ["not_created", "ready", "delivered"] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const key = (projectId: string) => `delivery_${projectId}`;
const ilTodayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** The history field that survives status changes and folder deletion (only when there is one). */
function keepHistory(current: Record<string, unknown>): { lastDeliveredAt?: string } {
  const last = typeof current.lastDeliveredAt === "string" && current.lastDeliveredAt ? current.lastDeliveredAt
    : current.deliveryStatus === "delivered" && typeof current.deliveredAt === "string" && current.deliveredAt ? current.deliveredAt : null;
  return last ? { lastDeliveredAt: last } : {};
}

/**
 * Pure: the next delivery record for a status / date patch (B5 coherence). delivered ⇒ deliveredAt (given or today)
 * (null / missing → the record's own date on a re-save, else today) and lastDeliveredAt = that date; any other status
 * ⇒ deliveredAt null, lastDeliveredAt kept. A date is refused unless the record is (or becomes) delivered.
 */
export function nextDeliveryRecord(current: Record<string, unknown>, patch: { deliveryStatus?: string; deliveredAt?: string | null }, today: string = ilTodayYmd()): Record<string, unknown> {
  const status = patch.deliveryStatus ?? String(current.deliveryStatus ?? "not_created");
  if (status === "delivered") {
    // the given date; else the record's own delivered date (a re-save); else today (Israel) — never delivered without a date
    const at = typeof patch.deliveredAt === "string" ? patch.deliveredAt
      : (current.deliveryStatus === "delivered" && typeof current.deliveredAt === "string" && current.deliveredAt ? current.deliveredAt : null);
    const date = at ?? today;
    return { ...current, deliveryStatus: "delivered", deliveredAt: date, lastDeliveredAt: date };
  }
  if (typeof patch.deliveredAt === "string") throw new DeliveryInputError("תאריך מסירה נשמר רק כשהסטטוס 'נמסר'");
  const { lastDeliveredAt: _drop, ...rest } = current;
  void _drop;
  return { ...rest, deliveryStatus: status, deliveredAt: null, ...keepHistory(current) };
}

async function createFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (res.ok) return;
  const err = (await res.json()) as Record<string, unknown>;
  const errObj  = err.error as Record<string, unknown> | undefined;
  const pathErr = errObj?.path as Record<string, unknown> | undefined;
  // "conflict" means it already exists — that's fine
  if (errObj?.[".tag"] === "path" && pathErr?.[".tag"] === "conflict") return;
  throw new Error((err.error_summary as string) ?? "Failed to create Dropbox folder");
}

async function createShareLink(token: string, path: string): Promise<string> {
  const res = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
  });
  if (res.ok) return ((await res.json()) as { url: string }).url;
  const err    = (await res.json()) as Record<string, unknown>;
  const errObj = err.error as Record<string, unknown> | undefined;
  if (errObj?.[".tag"] === "shared_link_already_exists") {
    const inner = errObj.shared_link_already_exists as Record<string, unknown> | undefined;
    const url   = (inner?.metadata as Record<string, string> | undefined)?.url;
    if (url) return url;
  }
  throw new Error((err.error_summary as string) ?? "Failed to create share link");
}

export { ilTodayYmd as deliveryTodayYmd };

export async function readDeliveryRecord(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", key(projectId)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value ?? {}) as Record<string, unknown>;
}

/** Metadata only (the folder path and the public link never leave as values). */
export async function readDeliveryState(projectId: string): Promise<{ status: string; deliveredAt: string | null; lastDeliveredAt: string | null; hasFolder: boolean; hasLink: boolean }> {
  const v = await readDeliveryRecord(projectId);
  return { status: String(v.deliveryStatus ?? "not_created"), deliveredAt: (v.deliveredAt as string | null) ?? null, lastDeliveredAt: (v.lastDeliveredAt as string | null) ?? null, hasFolder: !!v.folderPath, hasLink: !!v.deliveryLink };
}

/** POST /api/delivery semantics: the Delivery folder (frozen folder wins) + a public share link; status "ready". */
export async function createDeliveryFolder(projectId: string, artist: string, projectName: string): Promise<{ folderPath: string; deliveryLink: string }> {
  const token = await getDropboxToken();
  const { getProject } = await import("@/lib/projects-store");
  const frozen = (await getProject(projectId))?.dropboxFolder ?? null;
  const folderPath = deliveryFolder(artist ?? "", projectName, projectId, frozen);
  await createFolder(token, folderPath);
  const deliveryLink = await createShareLink(token, folderPath);
  const history = keepHistory(await readDeliveryRecord(projectId));
  const { error } = await supabase.from("settings").upsert({ key: key(projectId), value: { folderPath, deliveryLink, deliveryStatus: "ready", deliveredAt: null, ...history } }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return { folderPath, deliveryLink };
}

export class DeliveryInputError extends Error {}
/** PATCH /api/delivery — HARDENED: only the status and the delivered date change. */
export async function setDeliveryStatus(projectId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const allowed = new Set(["deliveryStatus", "deliveredAt"]);
  const extra = Object.keys(patch).filter((k) => !allowed.has(k));
  if (extra.length) throw new DeliveryInputError(`שדות לא מותרים: ${extra.join(", ")}`);
  const next: { deliveryStatus?: string; deliveredAt?: string | null } = {};
  if (patch.deliveryStatus !== undefined) {
    if (!(DELIVERY_STATUSES as readonly string[]).includes(String(patch.deliveryStatus))) throw new DeliveryInputError("סטטוס מסירה לא תקין");
    next.deliveryStatus = String(patch.deliveryStatus);
  }
  if (patch.deliveredAt !== undefined) {
    if (patch.deliveredAt !== null && !(typeof patch.deliveredAt === "string" && YMD.test(patch.deliveredAt))) throw new DeliveryInputError("תאריך מסירה לא תקין");
    next.deliveredAt = patch.deliveredAt as string | null;
  }
  const merged = nextDeliveryRecord(await readDeliveryRecord(projectId), next);
  const { error } = await supabase.from("settings").upsert({ key: key(projectId), value: merged }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return merged;
}

/** DELETE /api/delivery semantics: the Delivery folder is deleted and the record reset to not_created. */
export async function deleteDeliveryFolder(projectId: string): Promise<void> {
  const token = await getDropboxToken();
  const before = await readDeliveryRecord(projectId);
  const folderPath = String(before.folderPath ?? "");
  if (folderPath) {
    const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath }),
    });
    if (!delRes.ok) {
      let errJson: Record<string, unknown> = {};
      try { errJson = await delRes.json(); } catch {}
      const errObj = errJson.error as Record<string, unknown> | undefined;
      const tag    = errObj?.[".tag"] as string | undefined;
      // "path_lookup" means folder doesn't exist — that's fine (already deleted)
      if (tag !== "path_lookup") {
        const errPath = errObj?.path_lookup as Record<string, unknown> | undefined;
        if (errPath?.[".tag"] !== "not_found") {
          console.error("[delivery DELETE] Dropbox error:", errJson);
          throw new Error("שגיאה במחיקה מ-Dropbox");
        }
      }
    }
  }
  // B5: the folder is gone (status not_created for the drawer), but a past delivery is a fact — lastDeliveredAt stays.
  const { error } = await supabase.from("settings").upsert({ key: key(projectId), value: { deliveryStatus: "not_created", ...keepHistory(before) } }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
