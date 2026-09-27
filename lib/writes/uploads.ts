/**
 * Shared upload writers — the screens' upload routes and Sunny's file-channel primitives call the SAME function per
 * destination, so a file placed by Sunny is identical to a screen upload: same limits / types (unchanged, copied from
 * the routes), same folder + naming, same duplicate rule (add + autorename, or the route's overwrite / conflict rule),
 * same metadata rows. Route bodies moved verbatim (2026-09-27, Universal Actions — file channel).
 * Every function takes the File exactly as the route received it; the result carries the route's own status + message.
 */
import { supabase } from "@/lib/supabase";
import { sanitizeFolder, projectBaseFolder, instructionsFolder, commentAttachmentsFolder } from "@/lib/project-paths";
import { queueVictorUploadNotice } from "@/lib/victor-upload-notify";

export type UploadFail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): UploadFail => ({ ok: false, status, error });
export function dropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
async function token(): Promise<string> { const { getDropboxToken } = await import("@/lib/dropbox-token"); return getDropboxToken(); }
async function put(t: string, path: string, file: File, o: { mode: "add" | "overwrite"; autorename: boolean; mute: boolean }): Promise<{ ok: true; path: string; name: string; id?: string } | { ok: false; detail: string; raw: string }> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ path, mode: o.mode, autorename: o.autorename, mute: o.mute }) },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) { const raw = await res.text(); let detail = raw; try { detail = JSON.parse(raw)?.error_summary ?? raw; } catch { /* keep raw */ } return { ok: false, detail, raw }; }
  const d = (await res.json()) as { path_display: string; name: string; id?: string };
  return { ok: true, path: d.path_display, name: d.name, id: d.id };
}
/** create_shared_link_with_settings (public) → url, or the already-existing link's url, or "" (non-fatal everywhere). */
async function shareUrlOf(t: string, path: string, fallbackList = false): Promise<string> {
  try {
    const r = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ path, settings: { requested_visibility: "public" } }) });
    let url = "";
    if (r.ok) url = ((await r.json()) as { url: string }).url;
    else url = ((await r.json()) as { error?: { shared_link_already_exists?: { metadata?: { url?: string } } } })?.error?.shared_link_already_exists?.metadata?.url ?? "";
    if (!url && fallbackList) {
      const l = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ path, direct_only: true }) });
      if (l.ok) url = ((await l.json()) as { links?: { url?: string }[] }).links?.[0]?.url ?? "";
    }
    return url;
  } catch { return ""; }
}

// ── project file (POST /api/dropbox/upload) ─────────────────────────────────────────────────────────────────────────
export async function uploadProjectFile(projectId: string, file: File, o: { newName: string; subfolder?: string | null; trackId?: string | null; versionLabel?: string | null; durationSeconds?: number }) {
  const t = await token();
  const { getProject } = await import("@/lib/projects-store");
  const project = await getProject(projectId);
  // Frozen folder (projects.dropbox_folder) wins → renaming never moves uploads.
  let folderPath = projectBaseFolder(project?.artist ?? "", project?.name ?? "", projectId, project?.dropboxFolder);
  if (o.subfolder) { const sub = o.subfolder.split("/").map(sanitizeFolder).filter(Boolean).join("/"); if (sub) folderPath = `${folderPath}/${sub}`; }
  const up = await put(t, `${folderPath}/${o.newName}`, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) { console.error("[dropbox/upload] upload failed:", up.raw); return fail(500, `Dropbox: ${up.detail}`); }
  const { commitFileToProject } = await import("@/lib/project-file-commit");
  const { shareUrl, shareLinkError, fileUrl } = await commitFileToProject(t, projectId, up.path, o.newName, {
    ...(o.trackId ? { trackId: o.trackId } : {}), ...(o.versionLabel ? { versionLabel: o.versionLabel } : {}), ...(o.durationSeconds ? { durationSeconds: o.durationSeconds } : {}),
  });
  return { ok: true as const, shareUrl, shareLinkError, file: { name: o.newName, url: fileUrl, dropboxPath: up.path, dropboxShareUrl: shareUrl } };
}

// ── delivery (POST /api/delivery/upload) — overwrite mode: re-uploading the same name replaces it ──────────────────
export async function uploadToDelivery(projectId: string, file: File) {
  const { data } = await supabase.from("settings").select("value").eq("key", `delivery_${projectId}`).maybeSingle();
  const folderPath = ((data?.value ?? {}) as Record<string, unknown>).folderPath as string | undefined;
  if (!folderPath) return fail(400, "לא נוצרה תיקיית מסירה לפרויקט זה");
  const up = await put(await token(), `${folderPath}/${file.name}`, file, { mode: "overwrite", autorename: false, mute: false });
  if (!up.ok) { console.error("[delivery/upload] Dropbox error:", up.raw); return fail(500, `Dropbox: ${up.detail}`); }
  return { ok: true as const, file: { name: up.name, path: up.path } };
}

// ── work materials (POST /api/sound-engineer/[id]/work-materials) ───────────────────────────────────────────────────
export const WM_CATEGORY = "חומרי עבודה";
export type MaterialType = "rough" | "reference" | "stems" | "doc";
export const MATERIAL_TYPES: MaterialType[] = ["rough", "reference", "stems", "doc"];
const TYPE_LABEL: Record<MaterialType, string> = { rough: "Rough Mix", reference: "Reference", stems: "Stems", doc: "Instructions" };
export async function uploadWorkMaterial(workId: string, file: File, materialType: MaterialType, durationSeconds?: number) {
  const { data: work } = await supabase.from("sound_engineer_work").select("id, project_id").eq("id", workId).maybeSingle();
  if (!work) return fail(404, "עבודה לא נמצאה");
  if (!work.project_id) return fail(400, "אין פרויקט מקושר לעבודה — חומרי עבודה זמינים רק לעבודה עם פרויקט");
  const { getProject } = await import("@/lib/projects-store");
  const project = await getProject(String(work.project_id));
  if (!project) return fail(400, "אין פרויקט מקושר לעבודה — חומרי עבודה זמינים רק לעבודה עם פרויקט");
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const wmFiles = (project.files as Array<{ name?: string; category?: string; versionLabel?: string }>).filter((f) => f.category === WM_CATEGORY);
  const existingNames = new Set(wmFiles.map((f) => f.name ?? ""));
  const typeLabel = TYPE_LABEL[materialType];
  let label = typeLabel;
  if (materialType === "reference") label = `${typeLabel} ${wmFiles.filter((f) => f.versionLabel === "reference").length + 1}`;
  const base = [sanitizeFolder(project.name ?? ""), label].filter(Boolean).join(" ") || label;
  let cleanName = ext ? `${base}.${ext}` : base;
  for (let n = 2; existingNames.has(cleanName); n++) { const numbered = `${base} ${n}`; cleanName = ext ? `${numbered}.${ext}` : numbered; }
  const folder = instructionsFolder(project.artist ?? "", project.name ?? "", project.id, project.dropboxFolder);
  const t = await token();
  const up = await put(t, `${folder}/${cleanName}`, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) return fail(500, `Dropbox: ${up.detail}`);
  try {
    const { addFileToProject } = await import("@/lib/projects-store");
    await addFileToProject(project.id, { name: cleanName, url: `/api/dropbox/stream?path=${encodeURIComponent(up.path)}`, dropboxPath: up.path, category: WM_CATEGORY, versionLabel: materialType, size: file.size, ...(durationSeconds ? { durationSeconds } : {}) });
  } catch (dbErr) {
    // Compensating delete so we never orphan a file without a DB record.
    try { await fetch("https://api.dropboxapi.com/2/files/delete_v2", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: up.path }) }); } catch { /* best-effort */ }
    throw dbErr;
  }
  return { ok: true as const, cleanName, finalPath: up.path, size: file.size, durationSeconds };
}

// ── mix comment attachment (POST /api/sound-engineer/comments/[commentId]/attachments) ──────────────────────────────
export const ATTACH_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// M4A in particular is reported inconsistently across browsers/OSes.
export const ATTACH_AUDIO_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave", "audio/mp4", "audio/x-m4a"]);
export const ATTACH_AUDIO_EXT_FALLBACK_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
export const ATTACH_MAX_SIZE = 10 * 1024 * 1024; // 10MB — same limit for images and audio.
function resolveAttachment(file: File): { ok: true; kind: "image" | "audio"; mimeType: string } | { ok: false } {
  if (file.type) {
    if (ATTACH_IMAGE_MIME.has(file.type)) return { ok: true, kind: "image", mimeType: file.type };
    if (ATTACH_AUDIO_MIME.has(file.type)) return { ok: true, kind: "audio", mimeType: file.type };
    return { ok: false };
  }
  const fallbackMime = ATTACH_AUDIO_EXT_FALLBACK_MIME[file.name.toLowerCase().split(".").pop() ?? ""];
  return fallbackMime ? { ok: true, kind: "audio", mimeType: fallbackMime } : { ok: false };
}
export async function attachFileToMixComment(commentId: string, file: File) {
  const { getMixComment } = await import("@/lib/mix-comments-store");
  const comment = await getMixComment(commentId);
  if (!comment) return fail(404, "הערה לא נמצאה");
  const resolved = resolveAttachment(file);
  if (!resolved.ok) return fail(400, "סוג קובץ לא נתמך — jpeg/png/webp/gif או mp3/wav/m4a בלבד");
  if (file.size > ATTACH_MAX_SIZE) return fail(413, "הקובץ גדול מדי (מקסימום 10MB)");
  const { getMixVersion } = await import("@/lib/mix-versions-store");
  const version = await getMixVersion(comment.mixVersionId);
  if (!version) return fail(404, "גרסה לא נמצאה");
  const { getSoundEngineerWork } = await import("@/lib/sound-engineer-store");
  const work = await getSoundEngineerWork(version.soundEngineerWorkId);
  if (!work) return fail(404, "עבודה לא נמצאה");
  let artist = "", projectName = "", dropboxFolder: string | null = null;
  if (work.projectId) { const { getProject } = await import("@/lib/projects-store"); const p = await getProject(work.projectId); artist = p?.artist ?? ""; projectName = p?.name ?? ""; dropboxFolder = p?.dropboxFolder ?? null; }
  const folder = commentAttachmentsFolder({ projectId: work.projectId, artist, projectName, workId: work.id, dropboxFolder, mixVersionId: version.id, commentId });
  const sanitizedName = sanitizeFolder(file.name) || (resolved.kind === "audio" ? "audio" : "image");
  const up = await put(await token(), `${folder}/${sanitizedName}`, file, { mode: "add", autorename: true, mute: true });
  if (!up.ok) { console.error("[comments/attachments] Dropbox upload error:", up.raw); return fail(500, "שגיאה בהעלאת הקובץ"); }
  const { createAttachment } = await import("@/lib/mix-comment-attachments-store");
  const attachment = await createAttachment({ commentId, dropboxPath: up.path, fileName: file.name, fileSize: file.size, mimeType: resolved.mimeType, uploadedBy: "owner" });
  return { ok: true as const, attachment };
}

// ── social content file (POST /api/social/upload) ────────────────────────────────────────────────────────────────────
export const SOCIAL_MAX_SIZE = 500 * 1024 * 1024; // 500MB
export async function uploadSocialContentFile(contentItemId: string, campaignId: string, projectId: string | null, file: File) {
  if (file.size > SOCIAL_MAX_SIZE) return fail(413, "הקובץ גדול מדי (מקסימום 500MB)");
  const t = await token();
  const sanitizedName = file.name.replace(/[<>:"/\\|?*]/g, "_");
  let dropboxPath: string;
  if (projectId) {
    dropboxPath = `/${projectId}/Social/${contentItemId}/${sanitizedName}`; // production project — the existing path stays
  } else {
    const { getCampaign } = await import("@/lib/social-store");
    const campaign = await getCampaign(campaignId);
    const campaignFolder = (campaign?.title ?? "").trim().replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || `campaign-${campaignId}`;
    const mediaFolder = `/Social/${campaignFolder}/Media`;
    const { createDropboxFolder } = await import("@/lib/dropbox-folder");
    await createDropboxFolder(t, `/Social/${campaignFolder}`);
    await createDropboxFolder(t, mediaFolder);
    dropboxPath = `${mediaFolder}/${sanitizedName}`;
  }
  const up = await put(t, dropboxPath, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) { console.error("[social/upload] Dropbox upload error:", up.detail); return fail(500, `שגיאת Dropbox: ${up.detail}`); }
  const shareUrl = await shareUrlOf(t, up.path, true);
  const { createSocialFile } = await import("@/lib/social-files-store");
  const fileRecord = await createSocialFile({ content_item_id: contentItemId, campaign_id: campaignId, project_id: projectId, file_name: file.name, file_type: file.type || "application/octet-stream", file_size: file.size, dropbox_path: up.path, dropbox_file_id: up.id ?? "", dropbox_share_link: shareUrl, uploaded_by: "" });
  return { ok: true as const, file: fileRecord };
}

// ── Red Films: receipt / document / reference image ──────────────────────────────────────────────────────────────────
export const RECEIPT_EXTS = new Set(["jpg", "jpeg", "png", "webp", "heic", "gif", "pdf", "doc", "docx", "xls", "xlsx"]);
export const RECEIPT_MAX_SIZE = 20 * 1024 * 1024; // 20MB (the new-payment form's limit)
const sanitize = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
const dl1 = (u: string) => u.replace(/[?&]dl=0/, "?dl=1");
/** Receipt file placed + linked; the name is "{item} - {amount} - {date} - אסמכתא.{ext}". */
async function placeReceipt(productionId: string, itemTitle: string, amount: unknown, date: unknown, file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fileName = `${sanitize(itemTitle)} - ${amount} - ${date} - אסמכתא.${ext}`.slice(0, 200);
  const t = await token();
  const up = await put(t, `/Red Films/Productions/${productionId}/receipts/${fileName}`, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) return { ok: false as const, detail: up.detail, raw: up.raw };
  const url = await shareUrlOf(t, up.path);
  return { ok: true as const, fileName, mimeType: file.type ?? "", path: up.path, url: url ? dl1(url) : `/api/dropbox/stream?path=${encodeURIComponent(up.path)}` };
}
/** POST /api/red-films/budget-items/[itemId]/payments — the optional receipt (non-fatal on a storage error). */
export async function receiptForNewPayment(productionId: string, itemTitle: string, amount: number, paymentDate: string, file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!RECEIPT_EXTS.has(ext)) return fail(400, `סוג קובץ לא נתמך לאסמכתא: .${ext}`);
  if (file.size > RECEIPT_MAX_SIZE) return fail(400, "קובץ גדול מדי — מקסימום 20MB");
  const r = await placeReceipt(productionId, itemTitle, amount, paymentDate, file);
  if (!r.ok) { console.error("[budget-payment receipt] Dropbox upload error:", r.raw); return { ok: true as const, receipt: undefined }; }
  return { ok: true as const, receipt: { fileName: r.fileName, mimeType: r.mimeType, dropboxPath: r.path, dropboxUrl: r.url } };
}
/** POST /api/red-films/budget-payments/[paymentId]/receipt — attach a receipt to an existing payment. */
export async function attachReceiptToPayment(paymentId: string, file: File) {
  if (!file || file.size === 0) return fail(400, "קובץ חסר");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!RECEIPT_EXTS.has(ext)) return fail(400, `סוג קובץ לא נתמך: .${ext}`);
  const { data: payment, error: pErr } = await supabase.from("red_films_budget_payments").select("id, production_id, budget_item_id, amount, payment_date").eq("id", paymentId).maybeSingle();
  if (pErr) throw pErr;
  if (!payment) return fail(404, "תשלום לא נמצא");
  let itemTitle = "תשלום";
  try { const { data: it } = await supabase.from("red_films_budget_items").select("title").eq("id", payment.budget_item_id).maybeSingle(); if (it?.title) itemTitle = it.title as string; } catch { /* non-fatal */ }
  const r = await placeReceipt(String(payment.production_id), itemTitle, payment.amount, payment.payment_date, file);
  if (!r.ok) return fail(500, `Dropbox: ${r.detail}`);
  const { data, error } = await supabase.from("red_films_budget_payments").update({ receipt_file_name: r.fileName, receipt_mime_type: r.mimeType, receipt_dropbox_path: r.path, receipt_dropbox_url: r.url, updated_at: new Date().toISOString() }).eq("id", paymentId).select().single();
  if (error) throw error;
  return { ok: true as const, payment: data };
}
export const DOC_EXTS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "pages", "numbers", "key", "jpg", "jpeg", "png", "webp", "heic", "zip", "rar"]);
export const DOC_MAX_SIZE = 50 * 1024 * 1024; // 50MB
/** POST /api/red-films/productions/[id]/documents/upload — auto-named "{title} - {artist|client} - {type} - {date}.{ext}". */
export async function uploadRfDocument(productionId: string, file: File, fileType: string | null, notes: string) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!DOC_EXTS.has(ext)) return fail(400, `סוג קובץ לא נתמך: .${ext}`);
  if (file.size > DOC_MAX_SIZE) return fail(400, "הקובץ גדול מדי — מקסימום 50MB");
  let prodTitle = "הפקה", artistOrClient = "";
  try {
    const { data: prod } = await supabase.from("red_films_productions").select("title, artist_name, client_name").eq("id", productionId).maybeSingle();
    if (prod) { prodTitle = (prod.title as string) || "הפקה"; artistOrClient = (prod.artist_name as string) || (prod.client_name as string) || ""; }
  } catch { /* non-fatal — fall back to generic name */ }
  const today = new Date().toISOString().slice(0, 10);
  const typeLabel = fileType === "אחר" || !fileType ? "מסמך" : fileType;
  const parts = [sanitize(prodTitle)]; if (artistOrClient) parts.push(sanitize(artistOrClient)); parts.push(sanitize(typeLabel)); parts.push(today);
  const fileName = `${parts.join(" - ").slice(0, 120)}.${ext}`;
  const t = await token();
  const up = await put(t, `/Red Films/Productions/${productionId}/documents/${fileName}`, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) { console.error("[documents/upload] Dropbox error:", up.detail); return fail(500, `Dropbox: ${up.detail}`); }
  const url = await shareUrlOf(t, up.path);
  const dropboxUrl = url ? dl1(url) : `/api/dropbox/stream?path=${encodeURIComponent(up.path)}`;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_documents").insert({ production_id: productionId, file_name: fileName, file_type: fileType ?? "אחר", mime_type: file.type ?? "", dropbox_path: up.path, dropbox_url: dropboxUrl, notes, created_at: now, updated_at: now }).select().single();
  if (error) throw error;
  return { ok: true as const, document: data };
}
export const REF_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"]);
export const REF_MAX_SIZE = 20 * 1024 * 1024; // 20MB
/** POST /api/red-films/productions/[id]/references/upload — the image + a w640h480 thumbnail link for the grid. */
export async function uploadRfReferenceImage(productionId: string, file: File, tag: string) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!REF_IMAGE_EXTS.has(ext)) return fail(400, `סוג קובץ לא נתמך: .${ext} — יש להעלות תמונה (JPG, PNG, WEBP, GIF)`);
  if (file.size > REF_MAX_SIZE) return fail(400, "הקובץ גדול מדי — מקסימום 20MB");
  const t = await token();
  const ts = Date.now();
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const fileName = `${ts}_${safeName}`;
  const up = await put(t, `/Red Films/Productions/${productionId}/references/${fileName}`, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) { console.error("[references/upload] Dropbox upload error:", up.detail); return fail(500, `Dropbox: ${up.detail}`); }
  let dropboxUrl = "";
  try {
    const thumbRes = await fetch("https://content.dropboxapi.com/2/files/get_thumbnail", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Dropbox-API-Arg": dropboxArg({ path: up.path, format: { ".tag": "jpeg" }, size: { ".tag": "w640h480" }, mode: { ".tag": "fitone_way" } }) } });
    if (thumbRes.ok) {
      const thumbPath = `/Red Films/Productions/${productionId}/references/.thumbs/${ts}_thumb_${safeName.replace(/\.[^.]+$/, "")}.jpg`;
      const tu = await fetch("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dropboxArg({ path: thumbPath, mode: "add", autorename: true, mute: true }) }, body: await thumbRes.arrayBuffer() });
      if (tu.ok) {
        const raw = await shareUrlOf(t, ((await tu.json()) as { path_display: string }).path_display);
        if (raw) dropboxUrl = raw.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[?&]dl=0/, "");
      }
    }
  } catch { /* non-fatal — fall through to stream fallback */ }
  if (!dropboxUrl) dropboxUrl = `/api/dropbox/stream?path=${encodeURIComponent(up.path)}`;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("red_films_reference_images").insert({ production_id: productionId, file_name: fileName, dropbox_path: up.path, dropbox_url: dropboxUrl, tag, sort_order: 0, created_at: now, updated_at: now }).select().single();
  if (error) throw error;
  return { ok: true as const, reference: data };
}

// ── Victor: work files (POST /api/dropbox/vendor-upload) + brief files (POST /api/vendor/victor/work/[id]/brief) ─────
export async function uploadVictorWorkFile(workId: string, file: File, o: { subFolder: string; role: "owner" | "victor"; versionLabel?: string; runTotal: number }) {
  const { isWithinRoot, uploadDestination } = await import("@/lib/victor-scope");
  let baseFolder: string;
  try { const { ensureVendorFolder } = await import("@/lib/vendor-folder"); baseFolder = await ensureVendorFolder(workId); } catch (e) { console.error("[vendor-upload] folder resolve failed:", e); return fail(409, "folder not ready"); }
  // The destination is derived server-side (lib/victor-scope): inside the work folder only, a plain bucket name, a sanitized file name.
  const dropboxPath = uploadDestination(baseFolder, o.subFolder, file.name, o.role);
  if (!dropboxPath) return fail(403, "forbidden");
  const t = await token();
  const up = await put(t, dropboxPath, file, { mode: "add", autorename: true, mute: false });
  if (!up.ok) return fail(500, `Dropbox: ${up.detail}`);
  if (!isWithinRoot(up.path, baseFolder)) { console.error("[vendor-upload] committed path left the work folder - refusing to record it"); return fail(403, "forbidden"); }
  const shareUrl = await shareUrlOf(t, up.path);
  const newFile = { name: up.name, url: `/api/dropbox/stream?path=${encodeURIComponent(up.path)}`, dropboxPath: up.path, dropboxShareUrl: shareUrl, uploadedAt: new Date().toISOString(), uploadedBy: o.role, ...(o.versionLabel ? { versionLabel: o.versionLabel } : {}) };
  const { data: row } = await supabase.from("vendor_project_work").select("files_sent, project_id, vendor_name, title").eq("id", workId).maybeSingle();
  // Ownership: only Victor's work rows may receive uploads here.
  if (!row || (row.vendor_name as string) !== "victor") return fail(403, "forbidden");
  const currentFiles = (row.files_sent as typeof newFile[]) ?? [];
  // Idempotent append: the same file committed to the same path is listed once.
  if (!currentFiles.some((f) => f?.dropboxPath === up.path)) { const { updateVictorWork } = await import("@/lib/vendor-store"); await updateVictorWork(workId, { filesSent: [...currentFiles, newFile] }); }
  // Owner push (batched) ONLY when Victor uploaded — best-effort, never blocks the upload.
  try {
    if (o.role === "victor") {
      let projectName = (row.title as string | null) ?? "";
      if (!projectName && row.project_id) { const { data: proj } = await supabase.from("projects").select("name").eq("id", row.project_id as string).maybeSingle(); projectName = (proj?.name as string) ?? ""; }
      await queueVictorUploadNotice(workId, projectName || "פרויקט", o.runTotal);
    }
  } catch (e) { console.error("[vendor-upload] notify queue failed (non-fatal):", e); }
  return { ok: true as const, newFile };
}
export const BRIEF_MAX_BYTES = 100 * 1024 * 1024; // 100 MB — brief may include zip/rar/stems
const briefName = (name: string) => (name || "file").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\.{2,}/g, "_").slice(0, 200) || "file";
export async function uploadVictorBriefFile(workId: string, file: File) {
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  const work = await getVictorWorkById(workId);
  if (!work) return fail(404, "not found");
  if (file.size > BRIEF_MAX_BYTES) return fail(400, "file too large (max 100MB)");
  const baseFolder = work.dropboxFolder;
  if (!baseFolder) return fail(409, "no work folder yet — upload a version first");
  const t = await token();
  const up = await put(t, `${baseFolder.replace(/\/+$/, "")}/00_Brief/${briefName(file.name)}`, file, { mode: "add", autorename: true, mute: true });
  if (!up.ok) { console.error("[victor/brief] upload:", up.raw); return fail(502, `Dropbox: ${up.detail}`); }
  const shareUrl = await shareUrlOf(t, up.path);
  const newFile = { name: up.name, url: `/api/dropbox/stream?path=${encodeURIComponent(up.path)}`, dropboxPath: up.path, dropboxShareUrl: shareUrl, size: file.size };
  const briefFiles = [...(work.briefFiles ?? []), newFile];
  await updateVictorWork(workId, { briefFiles });
  return { ok: true as const, file: newFile, briefFiles };
}
