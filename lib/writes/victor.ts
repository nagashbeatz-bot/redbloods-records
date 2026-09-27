/**
 * Shared Victor writers — used by BOTH the Victor routes (Owner side; the Victor-role checks stay in the routes and in
 * lib/victor-scope) and Sunny's typed primitives. Route logic moved here verbatim:
 *   • ownerPatchVictorWork: the update + the "work completed" push on a real → הושלם transition + the internal-deadline
 *     follow-up task / Google Task (create or move);
 *   • notifyVictorWork / sendVictorVersionNotes: the Owner's two send buttons (server-built content);
 *   • recordVictorSalaryMonth: the salary month's expense row (duplicate-guarded by the salary key; a cancelled row is
 *     reused). A salary month is paid only when that row is שולם.
 * HARDENED (2026-09-27, Universal Actions):
 *   • removeVictorWork deletes the work's follow-up task (and its Google Task) before the work — the "task stays behind"
 *     finding; the Dropbox folder is never touched here.
 *   • saveVictorReviewDraft writes ONE version's review (read-merge-write with an updated_at claim), instead of the whole
 *     JSON column blindly.
 */
import { supabase } from "@/lib/supabase";
import type { BriefSegment, BriefSegmentType, FileLink, VersionReview } from "@/lib/types";
type VendorWork = NonNullable<Awaited<ReturnType<typeof import("@/lib/vendor-store").getScopedVictorWork>>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const MISSING = "not_found" as const;
const FILE_MISSING = "file_not_found" as const;
const STORAGE_FAILED = "storage_error" as const;

export async function ownerPatchVictorWork(id: string, body: Body): Promise<void> {
  const { updateVictorWork, getVictorWorkById } = await import("@/lib/vendor-store");
  const existingWork = await getVictorWorkById(id);
  await updateVictorWork(id, body);

  if ("status" in body && existingWork && existingWork.status !== "הושלם" && body.status === "הושלם") {
    try {
      const updatedWork = await getVictorWorkById(id);
      if (updatedWork) {
        const { notifyVictorWorkCompleted } = await import("@/lib/victor-completed-notify");
        const displayName = (updatedWork.title && updatedWork.title.trim()) ? updatedWork.title : updatedWork.projectName;
        await notifyVictorWorkCompleted({ id: updatedWork.id, displayName, fromUpdatedAt: existingWork.updatedAt });
      }
    } catch (e) {
      console.error("[vendor/victor/work] completed-notify failed (non-fatal):", e);
    }
  }

  const internalDeadline: string | null = "internalDeadline" in body ? (body.internalDeadline as string | null) : null;
  if (!("internalDeadline" in body) || !internalDeadline) return;

  const { createTask, patchTask, getTask } = await import("@/lib/tasks-store");
  const { createGoogleTask, updateGoogleTaskDue, isConnected } = await import("@/lib/google-calendar");
  if (!existingWork?.linkedTaskId) {
    const title = `מעקב ויקטור — ${existingWork?.projectName ?? id}`;
    const task = await createTask({ title, related_type: "project", related_id: existingWork?.projectId ?? null, due_date: internalDeadline, status: "פתוח" });
    try {
      if (await isConnected()) {
        const { id: googleId } = await createGoogleTask(title, internalDeadline);
        await patchTask(task.id, { calendar_event_id: googleId });
      }
    } catch { /* Google Tasks is best-effort — the Redbloods task exists */ }
    await updateVictorWork(id, { linkedTaskId: task.id });
  } else {
    const existingTask = await getTask(existingWork.linkedTaskId);
    if (existingTask) {
      await patchTask(existingTask.id, { due_date: internalDeadline });
      try {
        if (existingTask.calendar_event_id && (await isConnected())) await updateGoogleTaskDue(existingTask.calendar_event_id, internalDeadline);
      } catch { /* best-effort */ }
    }
  }
}

/** HARDENED remove: the follow-up task (+ its Google Task) first, then the work. The Dropbox folder stays. */
export async function removeVictorWork(id: string): Promise<{ removedTask: boolean }> {
  const { getVictorWorkById, deleteVictorWork } = await import("@/lib/vendor-store");
  const w = await getVictorWorkById(id);
  let removedTask = false;
  if (w?.linkedTaskId) {
    const { deleteTaskRecord } = await import("@/lib/writes/tasks");
    removedTask = (await deleteTaskRecord(w.linkedTaskId)) === "ok";
  }
  await deleteVictorWork(id);
  return { removedTask };
}

export type SendResult = { ok: true; victorSent?: unknown; ownerSent?: unknown } | { ok: false; reason: string };

/** The Owner's 'send to Victor' push (server-built; needs a Victor-facing title). */
export async function notifyVictorWork(workId: string): Promise<SendResult> {
  const { data: row } = await supabase.from("vendor_project_work").select("id, title, vendor_name, project_id").eq("id", workId).maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if ((row.vendor_name as string) !== "victor") return { ok: false, reason: "forbidden" };
  const title = ((row.title as string | null) ?? "").trim();
  if (!title) return { ok: false, reason: "no_title" };
  const { notifyVictorNewWork } = await import("@/lib/victor-work-notify");
  const r = await notifyVictorNewWork(workId, title, (row.project_id as string | null) ?? null);
  return r.ok ? { ok: true, victorSent: r.victorSent, ownerSent: r.ownerSent } : { ok: false, reason: r.reason };
}

/** The Owner's 'send notes' on one version: push, then the review is marked sent (sentNotes / sentAt, draft false). */
export async function sendVictorVersionNotes(workId: string, versionKey: string): Promise<SendResult & { review?: VersionReview }> {
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  const work = await getVictorWorkById(workId);
  if (!work) return { ok: false, reason: "not_found" };
  if (work.vendorName !== "victor") return { ok: false, reason: "forbidden" };
  const title = (work.title ?? "").trim();
  if (!title) return { ok: false, reason: "no_title" };
  const reviews = { ...(work.versionReviews ?? {}) };
  const review = reviews[versionKey];
  const notes = (review?.notes ?? "").trim();
  if (!review || !notes) return { ok: false, reason: "no_notes" };
  const ownerLabel = (work.projectName ?? "").trim() || title;
  const { notifyVictorVersionNotes } = await import("@/lib/victor-version-notes-notify");
  const result = await notifyVictorVersionNotes(workId, title, versionKey, ownerLabel);
  if (!result.ok) return { ok: false, reason: result.reason };
  const updated: VersionReview = { ...review, notes, sentNotes: notes, sentAt: new Date().toISOString(), draft: false };
  reviews[versionKey] = updated;
  await updateVictorWork(workId, { versionReviews: reviews });
  return { ok: true, review: updated, victorSent: result.victorSent };
}

/** Save ONE version's review draft (per-version, claimed by updated_at so a concurrent save is refused, not lost). */
export async function saveVictorReviewDraft(workId: string, versionKey: string, notes: string): Promise<"ok" | "not_found" | "conflict"> {
  const { data: row, error } = await supabase.from("vendor_project_work").select("version_reviews, updated_at, vendor_name").eq("id", workId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.vendor_name !== "victor") return MISSING;
  const reviews = { ...((row.version_reviews ?? {}) as Record<string, VersionReview>) };
  reviews[versionKey] = { ...(reviews[versionKey] ?? {}), notes, draft: true } as VersionReview;
  const { data: upd, error: uErr } = await supabase.from("vendor_project_work").update({ version_reviews: reviews, updated_at: new Date().toISOString() }).eq("id", workId).eq("updated_at", row.updated_at).select("id");
  if (uErr) throw new Error(uErr.message);
  return (upd ?? []).length ? "ok" : "conflict";
}

/** POST /api/vendor/victor/salary semantics. */
export async function recordVictorSalaryMonth(p: { workMonth: string; amount: number; currency: string; historicPaid?: boolean; paidDate?: string }): Promise<{ kind: "ok" | "duplicate"; transaction: Record<string, unknown> } | { kind: "error"; message: string }> {
  const { salaryLinkedId, salaryDueDate, salaryTransactionDescription } = await import("@/lib/vendor-store");
  const { workMonth, amount, currency, historicPaid = false, paidDate } = p;
  const linkedId = salaryLinkedId(workMonth);
  const dueDate = salaryDueDate(workMonth);
  const { data: existing } = await supabase.from("transactions").select("id, payment_status").eq("linked_session_id", linkedId).maybeSingle();
  if (existing) {
    const ex = existing as { id: string; payment_status: string };
    if (ex.payment_status !== "בוטל") return { kind: "duplicate", transaction: existing as Record<string, unknown> };
    const { data: updated, error: updateErr } = await supabase.from("transactions").update({
      payment_status: historicPaid ? "שולם" : "לא שולם", amount, currency, date: paidDate ?? dueDate, notes: historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "",
    }).eq("id", ex.id).select().single();
    if (updateErr) return { kind: "error", message: updateErr.message };
    return { kind: "ok", transaction: updated as Record<string, unknown> };
  }
  const { data, error } = await supabase.from("transactions").insert({
    scope: "general", type: "expense", project_id: null, artist: "Victor", description: salaryTransactionDescription(workMonth), amount, currency,
    payment_status: historicPaid ? "שולם" : "לא שולם", category: "צוות", date: paidDate ?? dueDate, linked_session_id: linkedId,
    notes: historicPaid ? "סומן כשולם היסטורית מתוך כרטיס Victor" : "", payment_method: "", receipt_ref: "", expense_scope: "כללי",
  }).select().single();
  if (error) {
    const conflict = error.code === "23505" && /\btransactions_victor_salary_period_uk\b/.test(`${error.message ?? ""} ${error.details ?? ""}`);
    if (conflict) {
      const { data: winner } = await supabase.from("transactions").select("id, payment_status").eq("linked_session_id", linkedId).maybeSingle();
      const w = winner as { id: string; payment_status: string } | null;
      if (w && w.payment_status !== "בוטל") return { kind: "duplicate", transaction: w as unknown as Record<string, unknown> };
    }
    return { kind: "error", message: error.message };
  }
  return { kind: "ok", transaction: data as Record<string, unknown> };
}

/** The salary month's finance row (paid only when שולם). */
export async function victorSalaryRow(workMonth: string): Promise<{ id: string; status: string; amount: number; currency: string } | null> {
  const { salaryLinkedId } = await import("@/lib/vendor-store");
  const { data } = await supabase.from("transactions").select("id, payment_status, amount, currency").eq("linked_session_id", salaryLinkedId(workMonth)).maybeSingle();
  return data ? { id: String(data.id), status: String(data.payment_status ?? ""), amount: Number(data.amount) || 0, currency: String(data.currency ?? "") } : null;
}

/** The Owner's statements about one salary month (settings): amount / status overrides + the legacy monthly mark.
 *  null = no statement recorded (the legacy getter's "צפוי" default is NOT treated as a statement). */
export async function victorMonthStatements(workMonth: string): Promise<{ amountOverride: number | null; statusOverride: string | null; legacyMark: string | null }> {
  const keys = ["vendor_victor_salary_overrides", "vendor_victor_salary_status_overrides", `vendor_victor_payment_${workMonth.replace("-", "_")}`];
  const { data, error } = await supabase.from("settings").select("key, value").in("key", keys);
  if (error) throw new Error(error.message);
  const by = new Map(((data ?? []) as Array<{ key: string; value: Record<string, unknown> | null }>).map((r) => [r.key, r.value ?? {}]));
  const a = by.get(keys[0])?.[workMonth];
  const st = by.get(keys[1])?.[workMonth];
  const lg = by.get(keys[2])?.status;
  return { amountOverride: typeof a === "number" ? a : null, statusOverride: typeof st === "string" ? st : null, legacyMark: typeof lg === "string" ? lg : null };
}

// ── Victor work file delete (the route + Sunny) — version-key helpers kept in sync with VictorProfilePage.tsx so the
//    server prunes a version's review exactly like the owner's client flow does. ──
function parseVersionKey(name: string): string | null {
  const n = name.toLowerCase();
  const m = n.match(/\bv[\s._-]?(\d{1,3})\b/) || n.match(/version[\s._-]?(\d{1,3})/) || n.match(/מיקס[\s._-]?(\d{1,3})/);
  if (m) return `V${Number(m[1])}`;
  if (/\bfinal\b|פיינל/.test(n)) return "FINAL";
  if (/\bfix\b/.test(n))         return "FIX";
  return null;
}
function versionKeysOf(files: FileLink[]): Set<string> {
  const keys = new Set<string>();
  if (files.length === 0) return keys;
  const vkeys = files.map(f => (f.versionLabel && /^V\d+$/i.test(f.versionLabel)) ? f.versionLabel.toUpperCase() : parseVersionKey(f.name));
  if (!vkeys.some(Boolean)) { keys.add("all"); return keys; }
  for (const k of vkeys) keys.add(k ?? "__untagged__");
  return keys;
}

/** DELETE /api/vendor/victor/work/[id]/file core: resolve the fileRef within THIS work's filesSent only; the caller's
 *  permission predicate decides (Owner: any; Victor: victorMayDelete); storage first, then only this entry. */
export async function deleteVictorWorkFileByRef(workId: string, fileRef: string, mayDelete: (work: VendorWork, file: FileLink) => boolean): Promise<"ok" | "not_found" | "file_not_found" | "forbidden" | "storage_error"> {
  const { getScopedVictorWork, updateVictorWork } = await import("@/lib/vendor-store");
  const { fileRefOf } = await import("@/lib/victor-files");
  const work = await getScopedVictorWork(workId);
  if (!work) return MISSING;
  const filesSent: FileLink[] = work.filesSent ?? [];
  const idx = filesSent.findIndex((f) => f.dropboxPath && fileRefOf(f.dropboxPath) === fileRef);
  if (idx < 0) return FILE_MISSING;
  if (!mayDelete(work, filesSent[idx])) return "forbidden";
  const dropboxPath = filesSent[idx].dropboxPath as string;
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const delRes = await fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: dropboxPath }) });
  if (!delRes.ok) {
    const errText = await delRes.text();
    let summary = errText;
    try { summary = JSON.parse(errText)?.error_summary ?? errText; } catch { /* keep raw */ }
    // Already gone in storage → idempotent success: still remove the DB metadata.
    if (!summary.includes(MISSING)) { console.error("[victor work file delete]", summary); return STORAGE_FAILED; }
  }
  const nextFiles = filesSent.filter((_, i) => i !== idx);
  const remainingKeys = versionKeysOf(nextFiles);
  const reviews = work.versionReviews ?? {};
  const prunedReviews = Object.fromEntries(Object.entries(reviews).filter(([k]) => remainingKeys.has(k))) as Record<string, VersionReview>;
  const reviewsChanged = Object.keys(prunedReviews).length !== Object.keys(reviews).length;
  await updateVictorWork(workId, reviewsChanged ? { filesSent: nextFiles, versionReviews: prunedReviews } : { filesSent: nextFiles });
  return "ok";
}
/** Sunny: the work's filesSent as handles + names (never a path). */
export async function victorWorkFiles(workId: string): Promise<Array<{ ref: string; name: string; uploadedBy: string | null }> | null> {
  const { getScopedVictorWork } = await import("@/lib/vendor-store");
  const { fileRefOf } = await import("@/lib/victor-files");
  const w = await getScopedVictorWork(workId);
  return w ? (w.filesSent ?? []).filter((f) => f.dropboxPath).map((f) => ({ ref: fileRefOf(f.dropboxPath!), name: f.name, uploadedBy: f.uploadedBy ?? null })) : null;
}

// ── Victor folder set-up (POST /api/dropbox/vendor-folder + Sunny SET_UP_VICTOR_FOLDER) ──
function sanitizeName(s: string): string {
  return s
    .replace(/[<>:"/\\|?*]/g, "") // remove forbidden chars
    .replace(/\s+/g, " ")
    .trim();
}

/** First (primary) artist from a comma/semicolon-separated artist string —
 *  matches the /Projects folder convention used by /api/dropbox/upload. */
function primaryArtist(raw: string): string {
  return (raw || "").split(/[,،;]/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
}

async function createFolder(token: string, path: string): Promise<void> {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, autorename: false }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error_summary?: string };
    // Ignore "folder already exists" errors
    if (typeof body.error_summary === "string" && body.error_summary.startsWith("path/conflict/folder")) return;
    // Ignore "path/conflict" (already exists)
    if (typeof body.error_summary === "string" && body.error_summary.includes("conflict")) return;
    throw new Error(`׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳” ׳ ׳›׳©׳׳”: ${JSON.stringify(body)}`);
  }
}

async function getOrCreateShareLink(token: string, path: string): Promise<string> {
  const res = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path,
      settings: { requested_visibility: { ".tag": "public" } },
    }),
  });

  if (res.ok) {
    const data = await res.json() as { url: string };
    return data.url.replace("?dl=0", "?dl=0"); // keep as-is
  }

  // If link already exists, fetch it
  const body = await res.json() as { error?: { shared_link_already_exists?: { metadata?: { url?: string } } }; url?: string };
  const existing = body?.error?.shared_link_already_exists?.metadata?.url;
  if (existing) return existing;

  // Fallback: list existing links
  const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, direct_only: true }),
  });
  if (listRes.ok) {
    const listData = await listRes.json() as { links?: { url: string }[] };
    if (listData.links?.length) return listData.links[0].url;
  }

  throw new Error("׳׳ ׳ ׳™׳×׳ ׳׳™׳¦׳•׳¨ ׳׳• ׳׳§׳‘׳ ׳׳™׳ ׳§ ׳©׳™׳×׳•׳£ ׳׳×׳™׳§׳™׳™׳× ׳”׳¡׳₪׳§");
}

/** The base folder, exactly the route's two layouts (projects layout: /Projects/<artist>/<project>/Victor, or
 *  /Projects/Victor/<work title> for a work without a project; legacy: /Victor/<artist> - <project>). */
export function victorFolderBasePath(body: { vendorName: string; artistName?: string; projectName?: string; useProjectsLayout?: boolean; projectId?: string | null; workTitle?: string | null; workId?: string | null }): string {
  const vendor = sanitizeName(body.vendorName);
  if (body.useProjectsLayout) {
    const hasProject = !!(body.projectId && (body.projectName ?? "").trim());
    if (hasProject) {
      const artistFolder = sanitizeName(primaryArtist(body.artistName ?? ""));
      const projectFolder = sanitizeName(body.projectName ?? "");
      return `${artistFolder ? `/Projects/${artistFolder}/${projectFolder}` : `/Projects/ללא אמן/${projectFolder}`}/${vendor}`;
    }
    const titleFolder = sanitizeName(body.workTitle ?? "") || `vendor_work_${(body.workId ?? "").slice(0, 8)}`;
    return `/Projects/${vendor}/${titleFolder}`;
  }
  return `/${vendor}/${sanitizeName(body.artistName ?? "")} - ${sanitizeName(body.projectName ?? "")}`;
}
/** Creates the base + 01_From_Redbloods / 02_From_<Vendor> / 03_Approved / Production and returns a PUBLIC link. */
export async function buildVictorFolderTree(vendorName: string, basePath: string): Promise<string> {
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const token = await getDropboxToken();
  const vendor = sanitizeName(vendorName);
  const fromThem = `02_From_${vendor.charAt(0).toUpperCase() + vendor.slice(1)}`;
  await createFolder(token, basePath);
  await createFolder(token, `${basePath}/01_From_Redbloods`);
  await createFolder(token, `${basePath}/${fromThem}`);
  await createFolder(token, `${basePath}/03_Approved`);
  await createFolder(token, `${basePath}/Production`);
  return getOrCreateShareLink(token, basePath);
}
/** Sunny: set up the work's folder (projects layout, names read server-side) and store it on the work. */
export async function setUpVictorFolderForWork(workId: string): Promise<void> {
  const { getScopedVictorWork, updateVictorWork } = await import("@/lib/vendor-store");
  const w = await getScopedVictorWork(workId);
  if (!w) throw new Error("work not found");
  let projectName = "", artistName = "";
  if (w.projectId) { const { getProject } = await import("@/lib/projects-store"); const p = await getProject(w.projectId); projectName = p?.name ?? ""; artistName = p?.artist ?? ""; }
  const basePath = victorFolderBasePath({ vendorName: "Victor", useProjectsLayout: true, projectId: w.projectId, projectName, artistName, workTitle: w.title, workId });
  const shareLink = await buildVictorFolderTree("Victor", basePath);
  await updateVictorWork(workId, { dropboxFolder: basePath, dropboxShareLink: shareLink });
}
export async function victorFolderState(workId: string): Promise<{ hasFolder: boolean } | null> {
  const { getScopedVictorWork } = await import("@/lib/vendor-store");
  const w = await getScopedVictorWork(workId);
  return w ? { hasFolder: !!(w as { dropboxFolder?: string | null }).dropboxFolder } : null;
}

// ── Victor brief references (the Owner's YouTube / link references on a work; the profile page's add / edit / delete) ──
type VRef = { id: string; url: string; title: string; note: string; provider: "youtube"; createdAt: string };
async function refsOf(workId: string): Promise<VRef[] | null> {
  const { getVictorWorkById } = await import("@/lib/vendor-store");
  const w = await getVictorWorkById(workId);
  return w ? ((w.references ?? []) as VRef[]) : null;
}
async function saveRefs(workId: string, next: VRef[]): Promise<void> { await ownerPatchVictorWork(workId, { references: next }); }
/** Sunny's read: ids + title + note + a fingerprint of the link (the link itself never leaves). */
export async function listVictorReferences(workId: string): Promise<Array<{ id: string; title: string; note: string; url: string }> | null> {
  const r = await refsOf(workId); return r ? r.map((x) => ({ id: x.id, title: x.title, note: x.note, url: x.url })) : null;
}
export async function addVictorReference(workId: string, input: { url: string; title: string; note: string }): Promise<string> {
  const r = await refsOf(workId); if (!r) throw new Error("work not found");
  const ref: VRef = { id: crypto.randomUUID(), url: input.url, title: input.title, note: input.note, provider: "youtube", createdAt: new Date().toISOString() };
  await saveRefs(workId, [...r, ref]);
  return ref.id;
}
export async function updateVictorReference(workId: string, refId: string, patch: { url?: string; title?: string; note?: string }): Promise<void> {
  const r = await refsOf(workId); if (!r) throw new Error("work not found");
  if (!r.some((x) => x.id === refId)) throw new Error("reference not found");
  await saveRefs(workId, r.map((x) => (x.id === refId ? { ...x, ...patch } : x)));
}
export async function removeVictorReference(workId: string, refId: string): Promise<void> {
  const r = await refsOf(workId); if (!r) throw new Error("work not found");
  await saveRefs(workId, r.filter((x) => x.id !== refId));
}

// ── Victor brief files: remove one / structure markers (the brief route's DELETE / PATCH + Sunny by handle) ──
// Segment markers for ONE brief audio file (moved from the brief route). Owner-only (requireOwner) → Victor
// can never write these. Stored on the matching brief_files[].segments — no new
// DB column/table. Sanitized server-side so a bad client can't inject junk.
const SEGMENT_TYPES = new Set<BriefSegmentType>([
  "intro", "verse1", "prechorus", "chorus1", "verse2", "chorus3",
  "cpart", "bridge", "finalChorus", "outro", "custom",
]);

function sanitizeSegments(raw: unknown): BriefSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefSegment[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const type = SEGMENT_TYPES.has(o.type as BriefSegmentType) ? (o.type as BriefSegmentType) : "custom";
    const start = Number(o.start);
    const end = Number(o.end);
    if (!isFinite(start) || !isFinite(end)) continue;
    const s0 = Math.max(0, start);
    const e0 = Math.max(s0, end);
    out.push({
      id: typeof o.id === "string" && o.id ? o.id.slice(0, 64) : `${s0}-${e0}-${out.length}`,
      type,
      ...(type === "custom" && typeof o.label === "string" ? { label: o.label.slice(0, 40) } : {}),
      color: typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : "#8B5CF6",
      start: s0,
      end: e0,
    });
    if (out.length >= 40) break; // sane cap
  }
  return out;
}

export { sanitizeSegments };
export async function removeBriefFile(workId: string, dropboxPath: string): Promise<FileLink[] | "not_found"> {
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  const work = await getVictorWorkById(workId);
  if (!work) return MISSING;
  const remaining = (work.briefFiles ?? []).filter((f) => f.dropboxPath !== dropboxPath);
  if (dropboxPath) {
    try {
      const { getDropboxToken } = await import("@/lib/dropbox-token");
      const token = await getDropboxToken();
      await fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: dropboxPath }) });
    } catch { /* not_found / already gone is fine */ }
  }
  await updateVictorWork(workId, { briefFiles: remaining });
  return remaining;
}
export async function setBriefSegments(workId: string, dropboxPath: string, segments: unknown): Promise<FileLink[] | "not_found" | "file_not_found"> {
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  const work = await getVictorWorkById(workId);
  if (!work) return MISSING;
  const clean = sanitizeSegments(segments);
  let matched = false;
  const briefFiles = (work.briefFiles ?? []).map((f) => { if (f.dropboxPath !== dropboxPath) return f; matched = true; return { ...f, segments: clean } as FileLink; });
  if (!matched) return FILE_MISSING;
  await updateVictorWork(workId, { briefFiles });
  return briefFiles;
}
/** Sunny: the brief files as handles + names + marker counts (never a path). */
export async function briefFileViews(workId: string): Promise<Array<{ ref: string; name: string; segments: Array<{ type: string; start: number; end: number; label?: string }> }> | null> {
  const { getVictorWorkById } = await import("@/lib/vendor-store");
  const { fileRefOf } = await import("@/lib/victor-files");
  const w = await getVictorWorkById(workId);
  return w ? (w.briefFiles ?? []).filter((f) => f.dropboxPath).map((f) => ({ ref: fileRefOf(f.dropboxPath!), name: f.name, segments: (f.segments ?? []).map((s) => ({ type: s.type, start: s.start, end: s.end, ...(s.label ? { label: s.label } : {}) })) })) : null;
}
export async function briefPathOf(workId: string, ref: string): Promise<string | null> {
  const { getVictorWorkById } = await import("@/lib/vendor-store");
  const { fileRefOf } = await import("@/lib/victor-files");
  const w = await getVictorWorkById(workId);
  return (w?.briefFiles ?? []).find((f) => f.dropboxPath && fileRefOf(f.dropboxPath) === ref)?.dropboxPath ?? null;
}
