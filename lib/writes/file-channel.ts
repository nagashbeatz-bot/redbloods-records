/**
 * THE FILE CHANNEL — placement. Each function takes an inbox HANDLE (never a path) and hands the file to the SAME
 * canonical writer the screen upload uses. Large engineer uploads (mix versions / final files) are MOVED inside the
 * storage account to the destination the canonical resolver computed (no size ceiling beyond the storage's own, like
 * the chunked screen upload); every other destination receives the file exactly as a browser upload (same limit /
 * type / naming checks). A successful placement removes the item from the inbox; a failed one leaves it there.
 */
import { inboxAsFile, inboxItem, moveInboxItem, removeInboxItem } from "@/lib/writes/inbox";

export type Placed = { ok: true; receipt: string } | { ok: false; error: string };
const bad = (error: string): Placed => ({ ok: false, error });

/** File-based writers: run, then consume the inbox item only when the writer succeeded. */
async function viaFile(ref: string, run: (f: File) => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, receipt: (r: Record<string, unknown>, f: File) => string): Promise<Placed> {
  const f = await inboxAsFile(ref);
  const r = await run(f);
  if (!r.ok) return bad(String(r.error ?? "upload failed"));
  await removeInboxItem(ref);
  return { ok: true, receipt: receipt(r, f) };
}
async function viaThrowing(ref: string, run: (f: File) => Promise<unknown>, receipt: (f: File) => string): Promise<Placed> {
  const f = await inboxAsFile(ref);
  try { await run(f); } catch (e) { return bad(e instanceof Error ? e.message : "upload failed"); }
  await removeInboxItem(ref);
  return { ok: true, receipt: receipt(f) };
}
const U = () => import("@/lib/writes/uploads");

export async function placeProjectFile(projectId: string, ref: string, o: { name?: string; subfolder?: string; trackId?: string; versionLabel?: string }) {
  const W = await U();
  return viaFile(ref, (f) => W.uploadProjectFile(projectId, f, { newName: o.name || f.name.replace(/[\\/]/g, "_"), subfolder: o.subfolder ?? null, trackId: o.trackId ?? null, versionLabel: o.versionLabel ?? null }), (_r, f) => `נוסף לקבצי הפרויקט: ${o.name || f.name}`);
}
export async function placeInDelivery(projectId: string, ref: string) { const W = await U(); return viaFile(ref, (f) => W.uploadToDelivery(projectId, f), (_r, f) => `הועלה לתיקיית המסירה: ${f.name}`); }
export async function placeWorkMaterial(workId: string, ref: string, type: "rough" | "reference" | "stems" | "doc") { const W = await U(); return viaFile(ref, (f) => W.uploadWorkMaterial(workId, f, type), (r) => `חומר עבודה: ${String(r.cleanName)}`); }
export async function placeCommentAttachment(commentId: string, ref: string) { const W = await U(); return viaFile(ref, (f) => W.attachFileToMixComment(commentId, f), (_r, f) => `צורף להערה: ${f.name}`); }
export async function placeSocialFile(contentItemId: string, campaignId: string, projectId: string | null, ref: string) { const W = await U(); return viaFile(ref, (f) => W.uploadSocialContentFile(contentItemId, campaignId, projectId, f), (_r, f) => `צורף לפריט התוכן: ${f.name}`); }
export async function placeRfDocument(productionId: string, ref: string, fileType: string, notes: string) { const W = await U(); return viaFile(ref, (f) => W.uploadRfDocument(productionId, f, fileType, notes), () => "מסמך נוסף להפקה"); }
export async function placeRfReference(productionId: string, ref: string, tag: string) { const W = await U(); return viaFile(ref, (f) => W.uploadRfReferenceImage(productionId, f, tag), () => "תמונת רפרנס נוספה"); }
export async function placeRfReceipt(paymentId: string, ref: string) { const W = await U(); return viaFile(ref, (f) => W.attachReceiptToPayment(paymentId, f), () => "אסמכתא צורפה לתשלום"); }
export async function placeVictorFile(workId: string, ref: string, subFolder: string, versionLabel?: string) { const W = await U(); return viaFile(ref, (f) => W.uploadVictorWorkFile(workId, f, { subFolder, role: "owner", versionLabel, runTotal: 1 }), (_r, f) => `נוסף לעבודת ויקטור (${subFolder}): ${f.name}`); }
export async function placeVictorBrief(workId: string, ref: string) { const W = await U(); return viaFile(ref, (f) => W.uploadVictorBriefFile(workId, f), (_r, f) => `נוסף לבריף: ${f.name}`); }

// ── engineer uploads: MOVE to the canonical destination, then the canonical finalizer ──
export async function placeMixVersion(workId: string, ref: string, o: { label: string; addToExisting: boolean; mixTargetId?: string | null }): Promise<Placed> {
  const item = await inboxItem(ref); if (!item) return bad("inbox item not found");
  const { resolveVersionTarget, finalizeMixVersion } = await import("@/lib/mix-version-upload");
  const resolved = await resolveVersionTarget(workId, { fileName: item.name, label: o.label, addToExisting: o.addToExisting, roleParam: null, mixTargetId: o.mixTargetId ?? null });
  if (!resolved.ok) return bad(resolved.error);
  const moved = await moveInboxItem(ref, resolved.target.dropboxPath, true); // add + autorename, as the screen upload
  if (!moved.ok) return bad(moved.error);
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const version = await finalizeMixVersion({ workId, target: resolved.target, finalPath: moved.path, fileSize: moved.size, durationSeconds: null, token: await getDropboxToken() });
  return { ok: true, receipt: `גרסה ${version.label} נוספה` };
}
export async function placeFinalFile(workId: string, ref: string): Promise<Placed> {
  const item = await inboxItem(ref); if (!item) return bad("inbox item not found");
  const F = await import("@/lib/final-file-upload");
  const nameErr = F.validateFinalFileName(item.name); if (nameErr) return bad(nameErr);
  const resolved = await F.resolveFinalTarget(workId); if (!resolved.ok) return bad(resolved.error);
  const { finalFileNameExists } = await import("@/lib/final-files-store");
  if (await finalFileNameExists(workId, item.name)) return bad(F.FINAL_CONFLICT_MSG);
  const moved = await moveInboxItem(ref, `${resolved.target.folder}/${item.name}`, false); // a name clash is a hard error, never a silent rename
  if (!moved.ok) return bad(moved.conflict ? F.FINAL_CONFLICT_MSG : moved.error);
  const { getDropboxToken } = await import("@/lib/dropbox-token");
  const batchId = crypto.randomUUID();
  const r = await F.finalizeFinalFile({ workId, target: resolved.target, fileName: item.name, finalPath: moved.path, fileSize: moved.size, token: await getDropboxToken(), batchId, uploader: "owner" });
  if (!r.ok) return bad(r.error);
  // the same batch-complete notice the screen sends after its upload loop (at most one, idempotent)
  try { const { completeFinalFilesBatch } = await import("@/lib/final-files-batch-notify"); await completeFinalFilesBatch(batchId, workId); } catch { /* best-effort, like the route */ }
  return { ok: true, receipt: `קובץ סופי נוסף: ${item.name}` };
}

// ── label: sketches, beats, portal images / files, project cover ──
export async function placeNewSketch(slug: string, ref: string, o: { title: string; description?: string; notes?: string }) {
  const S = await import("@/lib/red-artists/sketches-store");
  return viaThrowing(ref, async (f) => S.createSketch(slug, { title: o.title, description: o.description ?? "", notes: o.notes ?? "", audio: await S.validateAudio(f) }), () => `סקיצה חדשה: ${o.title}`);
}
export async function placeSketchVersion(slug: string, sketchId: string, ref: string) { const S = await import("@/lib/red-artists/sketches-store"); return viaThrowing(ref, async (f) => S.addVersion(slug, sketchId, await S.validateAudio(f)), () => "גרסה חדשה לסקיצה"); }
export async function placeSketchBeat(slug: string, sketchId: string, ref: string) { const S = await import("@/lib/red-artists/sketches-store"); return viaThrowing(ref, async (f) => S.setBeat(slug, sketchId, await S.validateAudio(f)), () => "ביט צורף לסקיצה"); }
export async function placeNewBeat(ref: string, o: { name: string; genre: string; musicalKey: string }) {
  const { uploadBeatSingle } = await import("@/lib/beat-upload");
  const { notifyBeatUploaded } = await import("@/lib/beat-notify");
  return viaFile(ref, async (f) => { const r = await uploadBeatSingle({ file: f, ...o }); if (r.ok) await notifyBeatUploaded(r.beat); return r as never; }, () => `ביט חדש: ${o.name}`);
}
export async function placeBeatFile(beatId: string, ref: string, o: { name: string; genre: string; musicalKey: string }) {
  const { updateBeatFile } = await import("@/lib/beat-upload");
  const { notifyBeatUpdated } = await import("@/lib/beat-notify");
  return viaFile(ref, async (f) => { const r = await updateBeatFile({ beatId, file: f, ...o }); if (r.ok) await notifyBeatUpdated(r.beat); return r as never; }, () => "קובץ הביט הוחלף");
}
export async function placeArtistProfileImage(slug: string, ref: string) {
  const { saveProfileImage } = await import("@/lib/red-artists/portal-files");
  return viaFile(ref, (f) => { const form = new FormData(); form.set("avatar", f); form.set("original", f); form.set("zoom", "1"); form.set("posX", "0"); form.set("posY", "0"); form.set("originalFileName", f.name); return saveProfileImage(slug, form) as never; }, () => "תמונת הפרופיל עודכנה (בלי חיתוך)");
}
export async function placeArtistPortalFile(slug: string, ref: string, kind: "performance" | "pressKit") {
  const { uploadArtistFile } = await import("@/lib/red-artists/portal-files");
  return viaFile(ref, (f) => uploadArtistFile(slug, kind, f) as never, (_r, f) => `${kind === "pressKit" ? "קובץ פרס-קיט" : "קובץ הופעה"}: ${f.name}`);
}
export async function placeProjectCover(projectId: string, ref: string) {
  const C = await import("@/lib/project-cover-store");
  return viaThrowing(ref, async (f) => {
    if (f.size > C.MAX_COVER_BYTES) throw new Error("הקובץ גדול מדי");
    await C.saveImageCover(projectId, Buffer.from(await f.arrayBuffer()));
  }, () => "תמונת הנושא של הפרויקט עודכנה");
}
export async function discardInboxItem(ref: string): Promise<Placed> { await removeInboxItem(ref); return { ok: true, receipt: "הוסר מתיבת הקבצים" }; }

// ── preview-time pre-check: the destination's OWN limits (the constants its writer uses), so an impossible placement
//    is refused before approval. Anything a writer checks without an exported constant is checked at execution. ──
export type Destination = "PROJECT_FILE" | "DELIVERY" | "WORK_MATERIAL" | "MIX_VERSION" | "FINAL_FILE" | "COMMENT_ATTACHMENT" | "SOCIAL" | "RF_DOCUMENT" | "RF_REFERENCE" | "RF_RECEIPT" | "VICTOR_FILE" | "VICTOR_BRIEF" | "SKETCH" | "BEAT" | "PROFILE_IMAGE" | "PORTAL_FILE" | "PROJECT_COVER";
const extOf = (n: string) => (n.split(".").pop() ?? "").toLowerCase();
export async function fileFits(dest: Destination, ref: string): Promise<string | null> {
  const it = await inboxItem(ref); if (!it) return "inbox item not found";
  const W = await U();
  const ext = extOf(it.name);
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  switch (dest) {
    case "MIX_VERSION": { const { AUDIO_ZIP } = await import("@/lib/mix-version-upload"); return AUDIO_ZIP.test(it.name) ? null : "סוג קובץ לא נתמך (WAV/MP3/AIFF/M4A/FLAC/OGG/ZIP)"; }
    case "FINAL_FILE": { const F = await import("@/lib/final-file-upload"); return F.validateFinalFileName(it.name); }
    case "COMMENT_ATTACHMENT": return (W.ATTACH_IMAGE_MIME.has(it.mime) || W.ATTACH_AUDIO_MIME.has(it.mime)) ? (it.size > W.ATTACH_MAX_SIZE ? "הקובץ גדול מדי (מקסימום 10MB)" : null) : "סוג קובץ לא נתמך — jpeg/png/webp/gif או mp3/wav/m4a בלבד";
    case "SOCIAL": return it.size > W.SOCIAL_MAX_SIZE ? "הקובץ גדול מדי (מקסימום 500MB)" : null;
    case "RF_DOCUMENT": return !W.DOC_EXTS.has(ext) ? `סוג קובץ לא נתמך: .${ext}` : it.size > W.DOC_MAX_SIZE ? `הקובץ גדול מדי — מקסימום ${mb(W.DOC_MAX_SIZE)}` : null;
    case "RF_REFERENCE": return !W.REF_IMAGE_EXTS.has(ext) ? `סוג קובץ לא נתמך: .${ext} — יש להעלות תמונה` : it.size > W.REF_MAX_SIZE ? `הקובץ גדול מדי — מקסימום ${mb(W.REF_MAX_SIZE)}` : null;
    case "RF_RECEIPT": return W.RECEIPT_EXTS.has(ext) ? null : `סוג קובץ לא נתמך: .${ext}`;
    case "VICTOR_BRIEF": return it.size > W.BRIEF_MAX_BYTES ? "file too large (max 100MB)" : null;
    case "SKETCH": { const S = await import("@/lib/red-artists/sketches-store"); return !(S.SKETCH_AUDIO_EXT as readonly string[]).includes(ext) ? "ניתן להעלות קובצי אודיו בלבד (MP3, WAV, AIFF, M4A)" : it.size > S.SKETCH_MAX_BYTES ? "הקובץ גדול מדי (מקסימום 500MB)" : null; }
    case "PROFILE_IMAGE": { const P = await import("@/lib/red-artists/portal-files"); return !["image/jpeg", "image/png", "image/webp"].includes(it.mime) ? "סוג קובץ לא נתמך — jpg / png / webp בלבד" : it.size > P.PROFILE_IMAGE_MAX_BYTES ? `הקובץ גדול מהמגבלה (מקסימום ${P.PROFILE_IMAGE_MAX_LABEL})` : null; }
    case "PORTAL_FILE": { const P = await import("@/lib/red-artists/portal-files"); return it.size > P.UPLOAD_MAX_BYTES ? "הקובץ גדול מדי (מקסימום 140MB)" : null; }
    case "PROJECT_COVER": { const C = await import("@/lib/project-cover-store"); return !["jpg", "jpeg"].includes(ext) ? "התמונה צריכה להיות JPEG" : it.size > C.MAX_COVER_BYTES ? "הקובץ גדול מדי" : null; }
    default: return null; // PROJECT_FILE / DELIVERY / WORK_MATERIAL / VICTOR_FILE / BEAT: the writer's own checks run at execution
  }
}
