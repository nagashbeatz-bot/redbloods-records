import "server-only";

/**
 * SUNNY UNIVERSAL ACTION LAYER — the REAL dependencies on Redbloods MAIN (server-only).
 * The writers are the SAME shared functions the Redbloods UI routes use; nothing here calls an internal API over HTTP,
 * and nothing here is a generic writer. Built lazily, only when the action endpoint is enabled and authenticated.
 */
import type { ActServiceDeps } from "./service";
import type { CoreWriters, WriterDeps } from "./primitives";
import type { ProjectFamilyWriters } from "./primitives/projects";
import type { CrmFamilyWriters } from "./primitives/crm";
import type { SessionFamilyWriters } from "./primitives/sessions";
import type { FinanceFamilyWriters } from "./primitives/finance";
import type { ShowFamilyWriters } from "./primitives/shows";
import type { MixFamilyWriters } from "./primitives/mix";
import type { VictorFamilyWriters } from "./primitives/victor";
import type { LabelFamilyWriters } from "./primitives/label";
import type { RedFilmsFamilyWriters } from "./primitives/redfilms";
import type { WorklogFamilyWriters } from "./primitives/worklog";
import type { DeliveryFamilyWriters } from "./primitives/delivery";
import type { SocialFamilyWriters } from "./primitives/social";
import type { SystemFamilyWriters } from "./primitives/system";
import type { FilesFamilyWriters } from "./primitives/files";
import type { BackfillFamilyWriters } from "./primitives/backfills";
import type { UploadFamilyWriters } from "./primitives/uploads";
import type { LinkFamilyWriters } from "./primitives/links";
import { PRODUCTION_LINK_FIELDS, SOCIAL_LINK_FIELDS, segmentsText } from "./primitives/links";
/** Social link arg → the content column (the wiring owns storage column names; primitives only know the typed args). */
export const SOCIAL_LINK_COLUMNS: Readonly<Record<string, string>> = { assetLink: "asset_link", storageLink: "dropbox_link", postedLink: "posted_url" };
if (Object.keys(SOCIAL_LINK_COLUMNS).join() !== SOCIAL_LINK_FIELDS.join()) throw new Error("social link args drifted");
import { linkRef } from "./primitives/core";
import { knownSecretValues } from "./persist";
import { approvalKeyFrom, ACT_SECRET_ENV } from "./internal-handler";
import { ACTION_REGISTRY, ACTION_REGISTRY_VERSION } from "./registry";
import { supabaseActStores } from "./store-supabase";

const OWNER_CACHE_MS = 5 * 60_000;
const ownerCache = new Map<string, { ok: boolean; at: number }>();

export async function realWriterDeps(): Promise<WriterDeps> {
  return { ...(await coreWriters()), ...(await projectFamilyWriters()), ...(await crmFamilyWriters()), ...(await sessionFamilyWriters()), ...(await financeFamilyWriters()), ...(await showFamilyWriters()), ...(await mixFamilyWriters()), ...(await victorFamilyWriters()), ...(await labelFamilyWriters()), ...(await redFilmsFamilyWriters()), ...(await worklogFamilyWriters()), ...(await deliveryFamilyWriters()), ...(await socialFamilyWriters()), ...(await systemFamilyWriters()), ...(await filesFamilyWriters()), ...(await backfillFamilyWriters()), ...(await uploadFamilyWriters()), ...(await linkFamilyWriters()) };
}

async function coreWriters(): Promise<CoreWriters> {
  const { getProject, updateProject } = await import("@/lib/projects-store");
  const { getReleaseDetails, updateReleaseDetails } = await import("@/lib/release-store");
  const { getSoundEngineerWork } = await import("@/lib/sound-engineer-store");
  const { listMixVersions, getMixVersion, updateMixVersion } = await import("@/lib/mix-versions-store");
  const { listMixComments, getMixComment, updateMixCommentStatus } = await import("@/lib/mix-comments-store");
  const { getLabelArtist, updateLabelArtist } = await import("@/lib/label-artists-store");
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  type VPatch = Parameters<typeof updateVictorWork>[1];
  return {
    async readProject(id) {
      const p = await getProject(id);
      return p ? { name: p.name ?? "", notes: p.notes ?? "", startDate: p.startDate ?? null, plannedHours: p.plannedHours ?? null, plannedDays: p.plannedDays ?? null, projectType: p.projectType ?? "", parentProject: p.parentProject ?? "", deadline: p.deadline ?? null } : null;
    },
    writeProject: (id, patch) => updateProject(id, patch),
    async readRelease(projectId) {
      const r = await getReleaseDetails(projectId);
      if (!r) return null;
      const p = await getProject(projectId);
      return { projectName: p?.name ?? "", releaseStage: r.releaseStage, releaseTargetDate: r.releaseTargetDate, nextAction: r.nextAction ?? "", blocker: r.blocker ?? "", responsible: r.responsible ?? "", updatedAt: r.updatedAt };
    },
    async writeRelease(projectId, expectedUpdatedAt, patch) {
      const r = await updateReleaseDetails(projectId, expectedUpdatedAt, patch as Parameters<typeof updateReleaseDetails>[2]);
      return r.status === "ok" ? "ok" : r.status === "conflict" ? "conflict" : "not_found";
    },
    async readMixWork(id) { const w = await getSoundEngineerWork(id); return w ? { title: String((w as { workTitle?: string | null }).workTitle ?? "") } : null; },
    async listMixVersions(workId) { return (await listMixVersions(workId)).map((v) => ({ id: v.id, label: v.label, status: v.status, createdAt: v.createdAt })); },
    async listMixComments(workId) {
      const out: Array<{ id: string; versionId: string; versionLabel: string; text: string; status: string; timestampSeconds: number | null; createdAt: string }> = [];
      for (const v of await listMixVersions(workId)) for (const c of await listMixComments(v.id)) out.push({ id: c.id, versionId: v.id, versionLabel: v.label, text: c.commentText, status: c.status, timestampSeconds: c.timestampSeconds, createdAt: c.createdAt });
      return out;
    },
    async readMixComment(id) {
      const c = await getMixComment(id);
      if (!c) return null;
      const v = await getMixVersion(c.mixVersionId);
      return v ? { workId: v.soundEngineerWorkId, versionLabel: v.label, text: c.commentText, status: c.status } : null;
    },
    writeMixCommentStatus: async (id, status) => { await updateMixCommentStatus(id, status); },
    async readMixVersion(id) { const v = await getMixVersion(id); return v ? { workId: v.soundEngineerWorkId, label: v.label, status: v.status } : null; },
    writeMixVersion: async (id, patch) => { await updateMixVersion(id, patch); },
    async readLabelArtist(id) { const a = await getLabelArtist(id); return a ? { name: a.name, notes: a.notes ?? "", status: a.status } : null; },
    async writeLabelArtist(id, patch) { return (await updateLabelArtist(id, patch as Parameters<typeof updateLabelArtist>[1])).status; },
    async readVictorWork(id) {
      const w = await getVictorWorkById(id);
      return w ? { title: (w.title ?? "").trim() || w.projectName || "", vendorName: w.vendorName, workState: w.workState ?? null, outcome: w.outcome ?? null, notes: w.notes ?? "" } : null;
    },
    writeVictorWork: (id, patch) => updateVictorWork(id, patch as VPatch),
  };
}

/** Projects family (lib/writes/projects + the existing project / release / cover stores). */
async function projectFamilyWriters(): Promise<ProjectFamilyWriters> {
  const PD = await import("@/lib/writes/project-delete");
  const { getProject, updateProject } = await import("@/lib/projects-store");
  const { getReleaseDetails, setProjectBusinessType, createLabelSongRelease, convertProjectToLabelRelease } = await import("@/lib/release-store");
  const { getProjectCover, saveThemeCover, resetProjectCover } = await import("@/lib/project-cover-store");
  const W = await import("@/lib/writes/projects");
  type Theme = Parameters<typeof saveThemeCover>[1];
  type Biz = Parameters<typeof setProjectBusinessType>[1];
  type RelIn = Parameters<typeof convertProjectToLabelRelease>[2];
  return {
    projectDeleteImpact: (id) => PD.projectDeleteImpact(id),
    deleteProjectCompletely: (id) => PD.deleteProjectCompletely(id),
    async readProjectMeta(id) {
      const p = await getProject(id);
      return p ? { name: p.name ?? "", artist: p.artist ?? "", status: p.status ?? "", isHidden: !!p.isHidden, businessType: p.businessType ?? "", projectType: p.projectType ?? "", hasRelease: !!(await getReleaseDetails(id)) } : null;
    },
    writeProjectStatus: (id, status) => updateProject(id, W.statusPatch(status)),
    writeProjectHidden: (id, hidden) => updateProject(id, { is_hidden: hidden }),
    renameProject: (id, name) => W.renameProject(id, name),
    changeProjectArtist: (id, artist) => W.changeProjectArtist(id, artist),
    setProjectBusinessType: (id, t) => setProjectBusinessType(id, t as Biz),
    async readProjectCover(id) { const c = await getProjectCover(id); return c ? { theme: String(c.theme), customImage: !!c.customImage } : null; },
    saveProjectCoverTheme: async (id, theme) => { await saveThemeCover(id, theme as Theme); },
    resetProjectCover: (id) => resetProjectCover(id),
    readSessionLimit: (id) => W.getSessionLimit(id),
    setSessionLimit: (id, n) => W.setSessionLimit(id, n),
    countProjectsNamed: (name) => W.countProjectsNamed(name),
    createClientProject: async (f) => (await W.createClientProject(f)).id,
    createLabelSong: (f) => createLabelSongRelease({ ...f, releaseStage: f.releaseStage as RelIn["releaseStage"] }),
    convertToLabelRelease: async (pid, aid, input) => (await convertProjectToLabelRelease(pid, aid, { ...input, releaseStage: input.releaseStage as RelIn["releaseStage"] })).status,
  };
}

/** Clients / proposals / meetings / tasks / calendar family (lib/writes/{clients,proposals,meetings,tasks} + lib/google-calendar). */
async function crmFamilyWriters(): Promise<CrmFamilyWriters> {
  const { getClient } = await import("@/lib/clients-store");
  const C = await import("@/lib/writes/clients");
  const P = await import("@/lib/writes/proposals");
  const M = await import("@/lib/writes/meetings");
  const T = await import("@/lib/writes/tasks");
  const G = await import("@/lib/writes/calendar");
  const { getTask } = await import("@/lib/tasks-store");
  type TaskIn = Parameters<typeof T.createTaskWithOptionalGoogle>[0];
  type TaskPatch = Parameters<typeof T.patchTaskRecord>[1];
  return {
    async readClient(id) { const c = await getClient(id); return c ? { name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", type: String(c.type ?? ""), status: String(c.status ?? ""), notes: c.notes ?? "" } : null; },
    countClientsNamed: (name) => C.countClientsNamed(name),
    countClientLinks: (id) => C.countClientLinks(id),
    projectsNamingArtist: async (name) => (await C.projectsNamingArtist(name)).length,
    createClient: async (c) => (await C.createClientRecord(c)).id,
    patchClient: async (id, patch) => { await C.patchClient(id, patch); },
    deleteClient: async (id) => { await C.deleteClientRecord(id); },
    readProposal: (id) => P.readProposal(id),
    createProposal: async (p) => String((await P.createProposal(p)).id),
    updateProposal: async (id, patch) => { await P.updateProposal(id, patch as Parameters<typeof P.updateProposal>[1]); },
    deleteProposal: (id) => P.deleteProposal(id),
    async convertProposal(id, name) { const r = await P.convertProposal(id, name); return r.status === "ok" ? { status: "ok", projectId: r.project.id } : { status: r.status }; },
    projectExists: (id) => P.projectExists(id),
    readMeeting: (id) => M.readMeeting(id),
    async createMeeting(m) { const c = await getClient(m.clientId); if (!c) throw new Error("client not found"); const r = await M.createMeeting({ ...m, clientName: c.name }); return { id: String(r.meeting.id), calendarError: r.calendarError }; },
    updateMeeting: async (id, patch) => ({ calendarSynced: (await M.updateMeeting(id, patch)).calendarSynced }),
    deleteMeeting: async (id) => { await M.deleteMeeting(id); },
    async readTask(id) { const t = await getTask(id); return t ? { title: t.title, notes: t.notes ?? null, status: t.status, relatedType: t.related_type, relatedId: t.related_id ?? null, dueDate: t.due_date ?? null, startTime: t.start_time ?? null, endTime: t.end_time ?? null, mirrored: !!t.calendar_event_id } : null; },
    createTask: (t, mirror) => T.createTaskWithOptionalGoogle(t as TaskIn, mirror),
    patchTask: async (id, patch) => { await T.patchTaskRecord(id, patch as TaskPatch); },
    deleteTask: (id) => T.deleteTaskRecord(id),
    syncGoogleTasks: async () => ({ synced: (await T.syncCompletedGoogleTasks()).synced }),
    countOpenTasksTitled: (title) => T.countOpenTasksTitled(title),
    calendarConnected: () => G.calendarConnected(),
    readCalendarEvent: (id) => G.readEvent(id),
    addCalendarEvent: (e) => G.addEvent(e),
    editCalendarEvent: (id, patch) => G.editEvent(id, patch),
    removeCalendarEvent: (id) => G.removeEvent(id),
    addGoogleTask: (title, due, notes) => G.addStandaloneGoogleTask(title, due, notes),
    readGoogleTask: (id) => G.readGoogleTask(id),
    googleTaskLinkedToTask: (id) => G.googleTaskLinkedToTask(id),
    removeGoogleTask: (id) => G.removeGoogleTask(id),
    disconnectGoogle: () => G.disconnectGoogle(),
  };
}

/** Sessions family (lib/writes/sessions). */
async function sessionFamilyWriters(): Promise<SessionFamilyWriters> {
  const S = await import("@/lib/writes/sessions");
  return {
    readSession: (id) => S.readSession(id),
    countSessionTransactions: (id) => S.countSessionTransactions(id),
    isShalevProject: (id) => S.isShalevProject(id),
    async createSession(s) { const r = await S.createSession(s); return { id: String(r.session.id), calendarError: r.calendarError }; },
    updateSession: async (id, patch) => ({ calendarSynced: (await S.updateSession(id, patch as Parameters<typeof S.updateSession>[1])).calendarSynced }),
    deleteSession: async (id) => ({ calendarDeleted: (await S.deleteSession(id)).calendarDeleted }),
  };
}

/** Finance family (lib/writes/finance). */
async function financeFamilyWriters(): Promise<FinanceFamilyWriters> {
  const F = await import("@/lib/writes/finance");
  return {
    readTransaction: (id) => F.readTransaction(id),
    financeOwnerOf: (id) => F.financeOwnerOf(id),
    countSimilarTransactions: (t) => F.countSimilarTransactions(t),
    createTransaction: async (t) => String((await F.createTransactionRecord(t)).id),
    updateTransaction: async (id, patch) => { await F.updateTransactionRecord(id, patch as Parameters<typeof F.updateTransactionRecord>[1]); },
    deleteTransaction: (id) => F.deleteTransactionRecord(id),
    async splitIncome(id, paid, date, method) { const r = await F.splitIncome(id, paid, date, method); return r.status === "ok" ? "ok" : r.code === "TX404" ? "not_found" : r.code === "TX409" ? "conflict" : "invalid"; },
    readFinanceSettings: (id) => F.readFinanceSettings(id),
    setFinanceSettings: async (id, patch) => { await F.setFinanceSettings(id, patch); },
  };
}

/** Shows + DJ family (lib/writes/shows; rehearsals go through the sessions writers). */
async function showFamilyWriters(): Promise<ShowFamilyWriters> {
  const W = await import("@/lib/writes/shows");
  const { countShowRehearsals } = await import("@/lib/shows-finance-sync");
  const kind = (r: Awaited<ReturnType<typeof W.updateShowRecord>>) => ({ kind: r.kind, warning: r.kind === "ok" ? r.calendarWarning ?? null : r.kind === "refused" ? r.messageHe : null });
  const { showMoneyForShow } = await import("@/lib/shows-finance-sync");
  return {
    async readShow(id) {
      const s = await W.readShow(id);
      if (!s) return null;
      return { name: s.name ?? "", artist: s.artist ?? "", artistClientId: s.artist_client_id ?? null, bookerName: s.booker_name ?? "", bookerClientId: s.booker_client_id ?? null, date: s.date ?? null, startTime: s.start_time ? String(s.start_time).slice(0, 5) : null, location: s.location ?? "", contactPerson: s.contact_person ?? "", phone: s.phone ?? "", status: s.status, paymentStatus: s.payment_status, showPrice: Number(s.show_price) || 0, djFee: Number(s.dj_fee) || 0, djClientId: s.dj_client_id ?? null, djName: s.dj_name ?? "", djConfirmation: s.dj_confirmation_status ?? null, advancePayment: Number(s.advance_payment) || 0, notes: s.notes ?? "", hasCalendarEvent: !!s.calendar_event_id, financeRows: await W.showFinanceRowCount(s), rehearsals: await countShowRehearsals(id), ...(await (async () => { const m = await showMoneyForShow(s); return { currency: m.currency, received: m.received, remaining: m.remaining, credit: m.credit, payments: m.payments.map((x) => `${x.amount}@${x.date ?? ""}`).sort().join(";") }; })()) };
    },
    async createShow(body) { const r = await W.createShowRecord(body); return { id: r.show.id, calendarWarning: r.calendarWarning ?? null, paymentWarning: r.paymentWarning ?? null }; },
    async recordShowPayment(id, p) { const { recordShowPayment } = await import("@/lib/writes/show-payments"); const r = await recordShowPayment(id, { amount: p.amount, date: p.date, currency: p.currency || undefined, method: p.method, note: p.note }); return r.kind === "ok" ? { kind: "ok", transactionId: r.transactionId } : r.kind === "refused" ? { kind: "refused", messageHe: r.messageHe } : { kind: "not_found" }; },
    updateShow: async (id, body) => kind(await W.updateShowRecord(id, body)),
    closeShow: async (id, c) => kind(await W.closeShowRecord(id, c)),
    deleteShowCompletely: async (id) => ({ kind: (await W.deleteShowCompletely(id)).kind }),
    markShowQuoteSent: async (id) => (await W.markQuoteSent(id)).kind,
    async notifyShowArtist(id) { const r = await W.notifyShowArtist(id); return r.ok ? { ok: true } : { ok: false, reason: String(r.reason) }; },
    async notifyShowDj(id) { const r = await W.notifyShowDj(id); return r.ok ? { ok: true } : { ok: false, reason: String(r.reason) }; },
  };
}

/** Mix / mastering family (lib/sound-engineer-store, lib/mix-*-store, lib/riddim-work, lib/writes/mix, the Steven notifiers). */
async function mixFamilyWriters(): Promise<MixFamilyWriters> {
  const SE = await import("@/lib/sound-engineer-store");
  const M = await import("@/lib/writes/mix");
  const C = await import("@/lib/mix-comments-store");
  const V = await import("@/lib/mix-versions-store");
  const TG = await import("@/lib/mix-targets-store");
  const N = await import("@/lib/mix-target-notes-store");
  const RW = await import("@/lib/riddim-work");
  const { projectTypeOfProject } = await import("@/lib/writes/projects");
  type WType = Parameters<typeof SE.createSoundEngineerWork>[1]["workType"];
  type WStatus = Parameters<typeof SE.createSoundEngineerWork>[1]["status"];
  return {
    async readCommentAttachment(id) { const { readCommentAttachment } = await import("@/lib/writes/mix"); return readCommentAttachment(id); },
    async deleteCommentAttachment(cid, id) { const { deleteCommentAttachment } = await import("@/lib/writes/mix"); return deleteCommentAttachment(cid, id); },
    async readEngineerWork(id) {
      const w = await SE.getSoundEngineerWork(id);
      if (!w) return null;
      const exp = await M.engineerWorkExpense(id);
      return { projectId: w.projectId, projectType: w.projectType ?? "", title: w.projectName || w.workTitle || "", engineerName: w.engineerName, workType: w.workType, status: w.status, agreedPrice: w.agreedPrice, currency: w.currency, amountPaid: w.amountPaid, paymentDate: w.paymentDate, sentDate: w.sentDate, internalDeadline: w.internalDeadline, notes: w.notes ?? "", expenseStatus: exp ? exp.status : null };
    },
    listEngineerOrder: async (eng) => (await SE.listSoundEngineerWork(eng)).map((w) => w.id),
    projectTypeOf: (pid) => projectTypeOfProject(pid),
    createEngineerWork: async (pid, f) => (await SE.createSoundEngineerWork(pid, { ...f, workType: f.workType as WType, status: f.status as WStatus })).id,
    updateEngineerWork: async (id, f) => { await SE.updateSoundEngineerWork(id, f as Parameters<typeof SE.updateSoundEngineerWork>[1]); },
    recordEngineerPayment: (id, paid, date) => M.recordEngineerPayment(id, paid, date),
    deleteEngineerWork: (id) => M.deleteEngineerWorkClean(id),
    reorderEngineerWork: (ids) => SE.reorderSoundEngineerWork(ids),
    forceEngineerFinanceSync: async (id) => (await SE.forceSyncTransaction(id)).txId,
    async readMixCommentFull(id) {
      const c = await C.getMixComment(id);
      if (!c) return null;
      const v = await V.getMixVersion(c.mixVersionId);
      return { versionId: c.mixVersionId, workId: v?.soundEngineerWorkId ?? "", text: c.commentText, timestampSeconds: c.timestampSeconds, status: c.status, attachments: c.attachments?.length ?? 0 };
    },
    createMixComment: async (c) => (await C.createMixComment({ mixVersionId: c.versionId, timestampSeconds: c.timestampSeconds, commentText: c.text, author: null, role: c.role })).id,
    editMixComment: async (id, p) => { await C.updateMixComment(id, p); },
    deleteMixComment: (id) => M.deleteMixCommentWithAttachments(id),
    deleteMixVersion: (id) => M.deleteMixVersionWithFile(id),
    isRiddimWork: async (wid) => (await RW.assertRiddimWork(wid)).ok,
    async readMixTarget(id) { const t = await TG.getMixTarget(id); return t ? { workId: t.workId, name: t.displayName, kind: t.targetKind, removed: !!t.removedAt } : null; },
    async addRiddimLine(wid, name) { await TG.ensureInstrumental(wid); const r = await TG.addArtistTarget(wid, name); return { status: r.status, id: r.target.id }; },
    renameRiddimLine: async (id, name) => (await TG.renameArtistTarget(id, name)).status,
    removeRiddimLine: async (id) => (await TG.softRemoveTarget(id)).status,
    async readPremixNote(id) { const n = await N.getMixTargetNote(id); return n ? { targetId: n.mixTargetId, text: n.noteText, status: n.status } : null; },
    createPremixNote: async (tid, text) => (await N.createMixTargetNote({ mixTargetId: tid, noteText: text })).id,
    updatePremixNote: async (id, p) => { await N.updateMixTargetNote(id, p as { noteText?: string; status?: "open" | "resolved" }); },
    deletePremixNote: (id) => N.deleteMixTargetNote(id),
    async notifyMixReady(wid, again) {
      const w = await SE.getSoundEngineerWork(wid); if (!w) return { ok: false, reason: "not_found" };
      const { notifyStevenMixReady } = await import("@/lib/steven-mix-ready-notify");
      const r = await notifyStevenMixReady({ id: w.id, displayName: SE.stevenDisplayName(w) }, { resend: again }) as { ok: boolean; alreadySent?: boolean; skipped?: boolean };
      return { ok: r.ok, alreadySent: r.alreadySent, skipped: r.skipped };
    },
    async sendMixNotes(wid, versionId) {
      const w = await SE.getSoundEngineerWork(wid); if (!w) return { ok: false, reason: "not_found" };
      const { notifyStevenMixNotes } = await import("@/lib/steven-notes-notify");
      const ctx = versionId ? await RW.resolveMixLineContext(w.id, versionId) : null;
      const r = await notifyStevenMixNotes({ id: w.id, displayName: SE.stevenDisplayName(w), projectId: w.projectId ?? null }, ctx ? { kind: "version", ...ctx } : null) as { ok: boolean; skipped?: boolean };
      return { ok: r.ok, skipped: r.skipped };
    },
  };
}

/** Victor family (lib/vendor-store + lib/writes/victor). */
async function victorFamilyWriters(): Promise<VictorFamilyWriters> {
  const VS = await import("@/lib/vendor-store");
  const W = await import("@/lib/writes/victor");
  type Init = NonNullable<Parameters<typeof VS.createVictorWork>[1]>;
  return {
    victorWorkFiles: (id) => W.victorWorkFiles(id),
    victorFolderState: (id) => W.victorFolderState(id),
    setUpVictorFolder: (id) => W.setUpVictorFolderForWork(id),
    deleteVictorWorkFile: (id, ref) => W.deleteVictorWorkFileByRef(id, ref, () => true), // the Owner may delete any file of the work
    async readVictorWorkFull(id) {
      const w = await VS.getVictorWorkById(id);
      if (!w) return null;
      return { title: w.title ?? "", projectId: w.projectId ?? null, projectName: w.projectName ?? "", status: w.status, workState: w.workState ?? null, sentDate: w.sentDate ?? null, internalDeadline: w.internalDeadline ?? null, briefText: w.briefText ?? "", hasTask: !!w.linkedTaskId, reviewKeys: Object.keys(w.versionReviews ?? {}).join(","), vendorName: w.vendorName };
    },
    victorWorkForProject: async (pid) => (await VS.getVictorWorkForProject(pid))?.id ?? null,
    createVictorWorkRecord: async (pid, f) => (await VS.createVictorWork(pid, { title: f.title, sentDate: f.sentDate, notes: f.notes, ...(f.workState ? { workState: f.workState as Init["workState"] } : {}) })).id,
    ownerPatchVictorWork: (id, body) => W.ownerPatchVictorWork(id, body),
    removeVictorWork: (id) => W.removeVictorWork(id),
    async notifyVictorWork(id) { const r = await W.notifyVictorWork(id); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; },
    async readVictorReview(id, vk) { const w = await VS.getVictorWorkById(id); const r = w?.versionReviews?.[vk]; return r ? { notes: r.notes ?? "", draft: !!r.draft, sent: !!r.sentAt } : null; },
    saveVictorReviewDraft: (id, vk, notes) => W.saveVictorReviewDraft(id, vk, notes),
    async sendVictorVersionNotes(id, vk) { const r = await W.sendVictorVersionNotes(id, vk); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; },
    async readVictorSettings() { const s = await VS.getVictorSettings(); return { monthlyGoal: s.monthlyGoal, monthlySalary: s.monthlySalary, salaryCurrency: s.salaryCurrency, salaryPayDay: s.salaryPayDay, stuckAfterDays: s.stuckAfterDays }; },
    updateVictorSettings: (p) => VS.updateVictorSettings(p),
    async readVictorSalaryMonth(m) { return { row: await W.victorSalaryRow(m), ...(await W.victorMonthStatements(m)) }; },
    async recordVictorSalaryMonth(p) { return (await W.recordVictorSalaryMonth(p)).kind; },
    async setVictorSalaryOverride(m, p) { if (p.amount !== undefined) await VS.setSalaryAmountOverride(m, p.amount); if (p.status !== undefined) await VS.setSalaryStatusOverride(m, p.status); },
    setVictorLegacyPaymentMark: (m, s, pd) => VS.setVictorPaymentStatus(m, s, pd),
  };
}

/** Label family (label-artists-store, artist-balance-*, media-income-store, availability, beats, sketches, lib/writes/label). */
async function labelFamilyWriters(): Promise<LabelFamilyWriters> {
  const LA = await import("@/lib/label-artists-store");
  const AB = await import("@/lib/artist-balance-store");
  const CY = await import("@/lib/artist-balance-cycles-store");
  const MI = await import("@/lib/media-income-store");
  const AV = await import("@/lib/red-artists/availability");
  const BS = await import("@/lib/beats-store");
  const BU = await import("@/lib/beat-upload");
  const SK = await import("@/lib/red-artists/sketches-store");
  const PC = await import("@/lib/red-artists/portal-config");
  const WL = await import("@/lib/writes/label");
  type EType = Parameters<typeof AB.createArtistBalanceEntry>[0]["entryType"];
  type AStatus = NonNullable<Parameters<typeof LA.createLabelArtist>[0]["status"]>;
  type Genre = Parameters<typeof BS.updateBeatMeta>[1]["genre"];
  const cycle = async (id: string) => CY.getBalanceCycleState(id, await AB.listArtistBalanceEntries(id));
  return {
    async readLabelArtistFull(id) { const a = await LA.getLabelArtist(id); if (!a) return null; const pc = await PC.resolvePortalConfig(id); return { name: a.name, status: a.status, notes: a.notes ?? "", portalSlug: pc?.slug ?? null }; },
    countLabelArtistsNamed: async (name) => (await LA.listLabelArtists()).filter((a) => a.name.trim() === name.trim()).length,
    async createLabelArtistRecord(a) { const r = await LA.createLabelArtist({ name: a.name, status: a.status as AStatus, imageUrl: null, notes: a.notes }); if (r.status !== "ok") throw new Error("duplicate"); return r.artist.id; },
    renameLabelArtist: async (id, name) => (await LA.updateLabelArtist(id, { name })).status as "ok" | "duplicate" | "not_found",
    readLedgerEntry: (id) => WL.readLedgerEntry(id),
    createLedgerEntry: async (e) => (await AB.createArtistBalanceEntry({ ...e, entryType: e.entryType as EType })).id,
    updateLedgerEntry: async (id, artistId, e) => !!(await AB.updateArtistBalanceEntry(id, artistId, { ...e, entryType: e.entryType as EType })),
    deleteLedgerEntry: (id, artistId) => AB.deleteArtistBalanceEntry(id, artistId),
    async readCycleState(id) { const s = await cycle(id); return { anchorDate: s.anchorDate ?? null, currentIndex: s.current?.index ?? null, currentEnd: s.current?.endDate ?? null, daysUntilClose: s.current?.daysUntilClose ?? null }; },
    setCycleAnchor: async (id, date, mode) => { if (mode === "SET") await CY.setBalanceCycleAnchor(id, date); else await CY.updateBalanceCycleAnchor(id, date); },
    closeCycle: async (id, force) => { await CY.closeCurrentBalanceCycle(id, await AB.listArtistBalanceEntries(id), force); },
    async sendCycleReminder(id, o, a) { const r = await WL.sendCycleReminder(id, o, a); return r.kind === "ok" ? { kind: "ok", ownerSent: r.ownerSent, artistSent: r.artistSent } : { kind: r.kind }; },
    readMediaRecord: (id) => WL.readMediaRecord(id),
    async createMediaRecord(artistId, m) { const a = await LA.getLabelArtist(artistId); if (!a) return { ok: false, message: "artist not found" }; const r = await MI.createMedia(artistId, a.name, m); return r.ok ? { ok: true, id: r.id } : { ok: false, message: r.message }; },
    async updateMediaRecord(id, artistId, exp, m) { const a = await LA.getLabelArtist(artistId); if (!a) return { ok: false, message: "artist not found" }; const r = await MI.updateMedia(id, artistId, a.name, exp, m as Parameters<typeof MI.updateMedia>[4]); return r.ok ? { ok: true } : { ok: false, message: r.message }; },
    async cancelMediaRecord(id, artistId, exp) { const r = await MI.cancelMedia(id, artistId, exp); return r.ok ? { ok: true } : { ok: false, message: r.message }; },
    async readAvailability(slug) { const a = await AV.getAvailability(slug); return a ? a.days.filter((x) => x.available).map((x) => `${x.day} ${x.date} ${x.from}`).join(", ") : ""; },
    saveOwnerAvailability: async (slug, days) => { await AV.saveAvailability(slug, days, "owner"); },
    async readBeat(id) { const b = await BS.getBeat(id); return b ? { name: b.name, genre: b.genre, musicalKey: b.musicalKey ?? null, assigned: (await BS.listBeatAssignments(id)).sort().join(",") } : null; },
    async assignBeat(id, slug) { const r = await WL.assignBeatWithNotify(id, slug); const n = r.notification as { status?: string } | null; return { notified: n?.status ?? null }; },
    unassignBeat: (id, slug) => BS.unassignBeatFromArtist(id, slug),
    updateBeatDetails: async (id, f) => (await BS.updateBeatMeta(id, { ...f, genre: f.genre as Genre })).status,
    async deleteBeatFully(id) { const r = await BU.deleteBeatFully(id); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
    async readSketch(slug, id) {
      const all = (await SK.listSketches(slug)).filter((s) => !s.archived);
      const s = (await SK.listSketches(slug)).find((x) => x.id === id);
      if (!s) return null;
      const ratings = await SK.getSketchRatings(slug);
      return { title: s.title, description: s.description, notes: s.notes, latestVersion: s.latestVersion, archived: !!s.archived, position: all.findIndex((x) => x.id === id) + 1, count: all.length, rating: ratings[id] ?? null };
    },
    patchSketch: async (slug, id, p) => { await SK.patchDetails(slug, id, p); },
    rateSketch: async (slug, id, r) => { await SK.setSketchRating(slug, id, r); },
    archiveSketch: (slug, id) => SK.softDeleteSketch(slug, id),
    orderSketches: async (slug) => (await SK.listSketches(slug)).filter((s) => !s.archived).map((s) => s.id),
    listSketchChoices: async (slug) => (await SK.listSketches(slug)).filter((s) => !s.archived).map((s) => ({ id: s.id, title: s.title })),
    reorderSketches: async (slug, ids) => { await SK.reorderSketches(slug, ids); },
    async notifySketch(artistId, name, slug, sketchId) { const s = (await SK.listSketches(slug)).find((x) => x.id === sketchId); if (!s) return { kind: "not_found" }; return { kind: (await WL.notifySketchToArtist(artistId, name, s)).kind }; },
    setNextWork: async (slug, id, dl) => { await SK.setNextWorkConfig(slug, id, dl); },
    setNextRelease: async (slug, id, date) => { await SK.setNextReleaseConfig(slug, id, date); },
  };
}

/** Red Films + clip planning family (lib/writes/redfilms). */
async function redFilmsFamilyWriters(): Promise<RedFilmsFamilyWriters> {
  const RF = await import("@/lib/writes/redfilms");
  return {
    productionFolderState: (id) => RF.productionFolderState(id),
    createProductionFolder: async (id) => { await RF.createProductionFolder(id); },
    readProductionRow: (id) => RF.readProductionRow(id),
    countProductionsTitled: (t) => RF.countProductionsTitled(t),
    isManagedProduction: (id, pid) => RF.isManagedProduction(id, pid),
    createProductionRecord: async (b) => String((await RF.createProduction(b)).id),
    updateProductionRecord: async (id, b) => (await RF.updateProduction(id, b)).kind,
    readBudgetLineRow: (id) => RF.readBudgetLineRow(id),
    countBudgetLinePayments: (itemId) => RF.countBudgetLinePayments(itemId),
    createBudgetLineRecord: async (pid, b) => String((await RF.createBudgetLine(pid, b)).id),
    updateBudgetLineRecord: async (id, b) => { await RF.updateBudgetLine(id, b); },
    deleteBudgetLineRecord: (id) => RF.deleteBudgetLine(id),
    async readBudgetPaymentRow(id) { const r = await RF.readBudgetPaymentRow(id); return r ? { amount: r.amount, payment_date: r.payment_date, payment_method: r.payment_method, notes: r.notes, has_receipt: !!r.receipt_dropbox_path } : null; },
    async insertBudgetPaymentRecord(itemId, p) { const r = await RF.insertBudgetPayment(itemId, p); if (r.kind !== "ok") throw new Error("budget line not found"); return String(r.payment.id); },
    updateBudgetPaymentRecord: async (id, b) => { await RF.updateBudgetPayment(id, b); },
    deleteBudgetPaymentRecord: (id) => RF.deleteBudgetPayment(id),
    readClipItemRow: (id) => RF.readClipItemRow(id),
    createClipItemRecord: async (b) => String((await RF.createClipItem(b)).id),
    updateClipItemRecord: async (id, b) => { await RF.updateClipItem(id, b); },
    deleteClipItemRecord: (id) => RF.deleteClipItem(id),
    promoteClipItemRecord: async (id, date) => (await RF.promoteClipItem(id, date)).kind,
    clipDealOf: async (pid) => (await import("@/lib/writes/clip")).clipDealOf(pid),
    setClipPrice: async (pid, price) => { await (await import("@/lib/writes/clip")).setClipPrice(pid, price); },
    addClipPayments: async (pid, body) => (await (await import("@/lib/writes/clip")).addClipPayments(pid, body)).kind,
    sendClipToRedFilms: async (pid) => (await (await import("@/lib/writes/clip")).sendClipToRedFilms(pid)).kind,
    readEquipmentRow: (id) => RF.readEquipmentRow(id),
    countEquipmentNamed: (n) => RF.countEquipmentNamed(n),
    async createEquipmentRecord(b) { const r = await RF.createEquipment(b); if (r.kind !== "ok") throw new Error(r.error); return String(r.item.id); },
    async updateEquipmentRecord(id, b) { const r = await RF.updateEquipment(id, b); return r.kind === "ok" ? "ok" : r.status === 404 ? "not_found" : "bad"; },
    readDocumentRow: (id) => RF.readDocumentRow(id),
    deleteRfDocumentRecord: async (id) => ((await RF.deleteRfDocument(id)).kind === "ok" ? "ok" : "not_found"),
    readReferenceRow: (id) => RF.readReferenceRow(id),
    setRfReferenceTagRecord: async (id, tag) => { await RF.setRfReferenceTag(id, tag); },
    deleteRfReferenceRecord: async (id) => ((await RF.deleteRfReference(id)).kind === "ok" ? "ok" : "not_found"),
    productionsByIds: (ids) => RF.productionsByIds(ids),
    async deleteCancelledProductionsRecord(ids) { const r = await RF.deleteCancelledProductions(ids); return r.kind === "ok" ? { kind: "ok", deleted: r.deleted } : { kind: "bad", error: r.error }; },
  };
}

const sendLinkBody = (b: Record<string, unknown>): Record<string, unknown> => { if (!("sendLink" in b)) return b; const { sendLink, ...rest } = b; return { ...rest, dropboxUrl: sendLink }; };
/** Send log + album tracks (lib/writes/worklog). */
async function worklogFamilyWriters(): Promise<WorklogFamilyWriters> {
  const W = await import("@/lib/writes/worklog");
  return {
    // the stored link never leaves MAIN: primitives see only its fingerprint (send_link_ref) and hand back `sendLink`
    async readSendLogEntry(id) { const r = await W.readSendLogEntry(id); if (!r) return null; const { dropbox_url, ...rest } = r as Record<string, unknown>; return { ...rest, send_link_ref: linkRef(dropbox_url) }; },
    createSendLogEntry: async (b) => String((await W.createSendLogEntry(sendLinkBody(b))).id),
    updateSendLogEntry: async (id, b) => { await W.updateSendLogEntry(id, sendLinkBody(b)); },
    deleteSendLogEntryWithCascade: (id) => W.deleteSendLogEntryWithCascade(id),
    readAlbumTrack: (id) => W.readAlbumTrack(id),
    albumTrackOrder: (pid) => W.albumTrackOrder(pid),
    createAlbumTrack: async (b) => String((await W.createAlbumTrack(b)).id),
    updateAlbumTrack: async (id, b) => { await W.updateAlbumTrack(id, b); },
    deleteAlbumTrack: (id) => W.deleteAlbumTrack(id),
    renumberAlbumTracks: (t) => W.renumberAlbumTracks(t),
    async readAlbumPrevInfo(pid) { const v = await W.readAlbumPrevInfo(pid); return { rows: v.rows, note: v.note }; },
    saveAlbumPrevInfo: async (pid, v) => { await W.saveAlbumPrevInfo(pid, v); },
  };
}

/** Client delivery (lib/writes/delivery) — the folder path / public link never leave the writer. */
async function deliveryFamilyWriters(): Promise<DeliveryFamilyWriters> {
  const W = await import("@/lib/writes/delivery");
  return {
    readDeliveryState: (pid) => W.readDeliveryState(pid),
    createDeliveryFolder: async (pid, artist, name) => { await W.createDeliveryFolder(pid, artist, name); },
    setDeliveryStatus: async (pid, p) => { await W.setDeliveryStatus(pid, p); },
    deleteDeliveryFolder: (pid) => W.deleteDeliveryFolder(pid),
  };
}

/** Social campaigns / content / files / promotions (lib/writes/social) — storage paths never leave the writer. */
async function socialFamilyWriters(): Promise<SocialFamilyWriters> {
  const W = await import("@/lib/writes/social");
  const row = (x: unknown) => (x ? (x as unknown as Record<string, unknown>) : null);
  return {
    readSocialCampaign: async (id) => row(await W.readSocialCampaign(id)),
    campaignForProject: (pid) => W.campaignForProject(pid),
    createSocialCampaign: async (b) => String((await W.createSocialCampaign(b)).id),
    updateSocialCampaign: async (id, b) => { await W.updateSocialCampaign(id, b); },
    deleteSocialCampaign: (id) => W.deleteSocialCampaign(id),
    campaignCounts: (id) => W.campaignCounts(id),
    readSocialContent: async (id) => row(await W.readSocialContent(id)),
    createSocialContent: async (b) => String((await W.createSocialContent(b)).id),
    updateSocialContent: async (id, b) => { await W.updateSocialContent(id, b); },
    deleteSocialContentWithFiles: (id) => W.deleteSocialContentWithFiles(id),
    contentFileCount: (id) => W.contentFileCount(id),
    async readSocialFile(id) { const f = await W.readSocialFile(id); return f ? { contentItemId: f.content_item_id ?? null, fileName: f.file_name ?? null } : null; },
    deleteSocialFileWithStorage: (id) => W.deleteSocialFileWithStorage(id),
    readPromotion: (id) => W.readPromotion(id),
    createPromotion: async (i) => String((await W.createPromotion(i)).id),
    updatePromotionFields: (id, p) => W.updatePromotionFields(id, p),
    syncActualExpense: (id, n) => W.syncActualExpense(id, n),
    deletePromotion: (id) => W.deletePromotion(id),
  };
}

/** The Owner's company-level operations (lib/writes/system) — no credential leaves the writer. */
async function systemFamilyWriters(): Promise<SystemFamilyWriters> {
  const W = await import("@/lib/writes/system");
  return {
    readOwnerNotification: (id) => W.readOwnerNotification(id),
    listOwnerUnread: () => W.listOwnerUnread(),
    countOwnerUnread: () => W.countOwnerUnread(),
    markOwnerNotificationRead: (id) => W.markOwnerNotificationRead(id),
    markAllOwnerNotificationsRead: () => W.markAllOwnerNotificationsRead(),
    readBusinessGoals: async () => (await W.readBusinessGoals()) as unknown as Record<string, { target: number; currency?: string }>,
    setBusinessGoal: (n, v) => W.setBusinessGoal(n, v),
    readAlert: (id) => W.readAlert(id),
    alertActionable: (t) => W.alertActionable(t),
    setAlertStatus: (id, s) => W.setAlertStatus(id, s),
    readReportSchedule: () => W.readReportSchedule(),
    setReportSchedule: (m, e) => W.setReportSchedule(m, e),
    reportEmailConfigured: () => W.reportEmailConfigured(),
    sendReportNow: (k) => W.sendReportNow(k as "morning" | "evening" | "weekly"),
    fileStorageConnected: () => W.dropboxConnected(),
    disconnectFileStorage: () => W.disconnectDropbox(),
    readMaintenance: () => W.readMaintenance(),
    setMaintenance: (e) => W.setMaintenanceChecked(e),
  };
}

/** Existing project files by handle + work materials (lib/writes/files) — a path never leaves the writer. */
async function filesFamilyWriters(): Promise<FilesFamilyWriters> {
  const W = await import("@/lib/writes/files");
  const pathOf = async (pid: string, ref: string) => { const p = await W.projectFilePath(pid, ref); if (!p) throw new Error("file not found in the project"); return p; };
  return {
    async projectFiles(pid) { const xs = await W.projectFilesMeta(pid); return xs ? xs.map((f) => ({ ref: f.ref, name: f.name, category: f.category, versionLabel: f.versionLabel, trackId: f.trackId })) : null; },
    async deleteProjectFile(pid, ref) { return W.deleteProjectFileByPath(pid, await pathOf(pid, ref)); },
    readWorkMaterials: (pid) => W.readWorkMaterials(pid),
    setWorkMaterials: (pid, p) => W.setWorkMaterials(pid, p),
    portalOfProject: (pid) => W.portalOfProject(pid),
    async shareProjectFileToPortal(pid, ref, sketchId, newTitle) {
      const portal = await W.portalOfProject(pid); if (!portal) throw new Error("not linkable");
      const sk = await W.linkProjectFileToPortal(portal.artistName, portal.slug, pid, await pathOf(pid, ref), sketchId, newTitle);
      return { sketchId: String((sk as { id: string }).id) };
    },
  };
}

/** Company-wide backfills (lib/writes/backfills) — apply recomputes the same plan the fingerprint pinned. */
async function backfillFamilyWriters(): Promise<BackfillFamilyWriters> {
  const W = await import("@/lib/writes/backfills");
  return {
    startDatePlan: () => W.startDatePlan(),
    async applyStartDatesNow() { return W.applyStartDates((await W.startDatePlan()).rows); },
    missingArtistClients: () => W.missingArtistClients(),
    async createMissingArtistClients() { return W.createArtistClients((await W.missingArtistClients()).missing); },
    async folderFreezeCandidates() { return (await W.folderFreezePlan()).filter((r) => r.willSet).map((r) => ({ id: r.id, name: r.name })); },
    async applyFolderFreezeNow() { const r = await W.applyFolderFreeze((await W.folderFreezePlan()).filter((x) => x.willSet)); return { applied: r.applied.length, failed: r.failed.length }; },
  };
}

/** The file channel (lib/writes/inbox + lib/writes/file-channel) — handles only, never a path. */
async function uploadFamilyWriters(): Promise<UploadFamilyWriters> {
  const I = await import("@/lib/writes/inbox");
  const F = await import("@/lib/writes/file-channel");
  const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    async listInbox() { return (await I.listInbox()).map((x) => ({ ref: x.ref, name: x.name, size: x.size, mime: x.mime })); },
    async inboxItemView(ref) { const x = await I.inboxItem(ref); return x ? { ref: x.ref, name: x.name, size: x.size, mime: x.mime } : null; },
    async inboxFits(dest, ref) {
      const map: Record<string, Parameters<typeof F.fileFits>[0]> = { PROJECT_FILE: "PROJECT_FILE", DELIVERY: "DELIVERY", WORK_MATERIAL: "WORK_MATERIAL", MIX_VERSION: "MIX_VERSION", FINAL_FILE: "FINAL_FILE", COMMENT_ATTACHMENT: "COMMENT_ATTACHMENT", SOCIAL: "SOCIAL", RF_DOCUMENT: "RF_DOCUMENT", RF_REFERENCE: "RF_REFERENCE", RF_RECEIPT: "RF_RECEIPT", VICTOR_FILE: "VICTOR_FILE", VICTOR_BRIEF: "VICTOR_BRIEF", SKETCH_NEW: "SKETCH", SKETCH_VERSION: "SKETCH", SKETCH_BEAT: "SKETCH", BEAT_NEW: "BEAT", BEAT_FILE: "BEAT", PROFILE_IMAGE: "PROFILE_IMAGE", PORTAL_FILE: "PORTAL_FILE", PROJECT_COVER: "PROJECT_COVER" };
      return map[dest] ? F.fileFits(map[dest], ref) : null;
    },
    async placeInboxItem(dest, t, ref, o) {
      switch (dest) {
        case "PROJECT_FILE": return F.placeProjectFile(String(t.projectId), ref, { name: s(o.name), subfolder: s(o.subfolder), trackId: s(o.trackId), versionLabel: s(o.versionLabel) });
        case "DELIVERY": return F.placeInDelivery(String(t.projectId), ref);
        case "WORK_MATERIAL": return F.placeWorkMaterial(String(t.workId), ref, o.materialType as "rough" | "reference" | "stems" | "doc");
        case "MIX_VERSION": return F.placeMixVersion(String(t.workId), ref, { label: String(o.label), addToExisting: o.addToExisting === true, mixTargetId: s(o.mixTargetId) ?? null });
        case "FINAL_FILE": return F.placeFinalFile(String(t.workId), ref);
        case "COMMENT_ATTACHMENT": return F.placeCommentAttachment(String(t.commentId), ref);
        case "SOCIAL": return F.placeSocialFile(String(t.contentItemId), String(t.campaignId), t.projectId ?? null, ref);
        case "RF_DOCUMENT": return F.placeRfDocument(String(t.productionId), ref, String(o.fileType ?? "אחר"), String(o.notes ?? ""));
        case "RF_REFERENCE": return F.placeRfReference(String(t.productionId), ref, String(o.tag ?? "כללי"));
        case "RF_RECEIPT": return F.placeRfReceipt(String(t.paymentId), ref);
        case "VICTOR_FILE": return F.placeVictorFile(String(t.workId), ref, String(o.subFolder), s(o.versionLabel));
        case "VICTOR_BRIEF": return F.placeVictorBrief(String(t.workId), ref);
        case "SKETCH_NEW": return F.placeNewSketch(String(t.slug), ref, { title: String(o.title), description: s(o.description), notes: s(o.notes) });
        case "SKETCH_VERSION": return F.placeSketchVersion(String(t.slug), String(t.sketchId), ref);
        case "SKETCH_BEAT": return F.placeSketchBeat(String(t.slug), String(t.sketchId), ref);
        case "BEAT_NEW": return F.placeNewBeat(ref, { name: String(o.name), genre: String(o.genre ?? ""), musicalKey: String(o.musicalKey ?? "") });
        case "BEAT_FILE": return F.placeBeatFile(String(t.beatId), ref, { name: String(t.name), genre: String(t.genre ?? ""), musicalKey: String(t.musicalKey ?? "") });
        case "PROFILE_IMAGE": return F.placeArtistProfileImage(String(t.slug), ref);
        case "PORTAL_FILE": return F.placeArtistPortalFile(String(t.slug), ref, o.kind as "performance" | "pressKit");
        case "PROJECT_COVER": return F.placeProjectCover(String(t.projectId), ref);
        case "DISCARD": return F.discardInboxItem(ref);
      }
    },
  };
}

/** Link fields — a stored link is returned ONLY as a fingerprint (linkRef); the new URL comes from the Boss. */
async function linkFamilyWriters(): Promise<LinkFamilyWriters> {
  const RF = await import("@/lib/writes/redfilms");
  const SO = await import("@/lib/writes/social");
  const V = await import("@/lib/writes/victor");
  const lastLine = (t: unknown) => String(t ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).pop() ?? null;
  return {
    async productionLinks(id) {
      const r = await RF.readProductionRow(id); if (!r) return null;
      const links: Record<string, string | null> = {};
      for (const [f, col] of Object.entries(PRODUCTION_LINK_FIELDS)) links[f] = linkRef((r as Record<string, unknown>)[col]);
      links.addReferenceLink = linkRef(lastLine((r as Record<string, unknown>).ref_links));
      return { title: String((r as Record<string, unknown>).title ?? ""), links };
    },
    async setProductionLinks(id, patch, appendReference) {
      const body: Record<string, unknown> = { ...patch };
      for (const k of Object.keys(body)) if (body[k] === null) body[k] = "";
      if (appendReference) { const r = await RF.readProductionRow(id); const cur = String((r as Record<string, unknown> | null)?.ref_links ?? "").trimEnd(); body.ref_links = cur ? `${cur}\n${appendReference}` : appendReference; }
      const res = await RF.updateProduction(id, body);
      if (res.kind !== "ok") throw new Error(`not updated: ${res.kind}`);
    },
    youtubeVideoId: (u) => RF.youtubeVideoId(u),
    videoReferenceCount: (id) => RF.videoReferenceCount(id),
    async addVideoReference(id, i) { const r = await RF.addVideoReference(id, { url: i.url, video_id: i.videoId, title: i.title, notes: i.notes }); return String(r.id); },
    async socialContentLinks(id) {
      const r = await SO.readSocialContent(id); if (!r) return null;
      const links: Record<string, string | null> = {};
      for (const [f, col] of Object.entries(SOCIAL_LINK_COLUMNS)) links[f] = linkRef((r as unknown as Record<string, unknown>)[col]);
      return { title: String(r.title ?? ""), links };
    },
    async setSocialContentLinks(id, patch) { const body: Record<string, unknown> = {}; for (const [k, v] of Object.entries(patch)) if (SOCIAL_LINK_COLUMNS[k]) body[SOCIAL_LINK_COLUMNS[k]] = v ?? ""; await SO.updateSocialContent(id, body); },
    async victorReferenceViews(workId) { const r = await V.listVictorReferences(workId); return r ? r.map((x) => ({ id: x.id, title: x.title, note: x.note, link: linkRef(x.url) })) : null; },
    addVictorReference: (w, i) => V.addVictorReference(w, i),
    updateVictorReference: (w, id, p) => V.updateVictorReference(w, id, p),
    removeVictorReference: (w, id) => V.removeVictorReference(w, id),
    async previewIntakeLink(u, n) { const I = await import("@/lib/writes/intake"); return I.previewIntakeLink(u, n); },
    async importIntakeLink(pid, u, n, del) { const I = await import("@/lib/writes/intake"); return I.importIntakeLink(pid, u, n, del); },
    readVideoReference: (id) => RF.readVideoReference(id),
    async updateVideoReference(id, p) { const r = await RF.updateVideoReference(id, p); if (r === "empty") throw new Error("nothing to update"); },
    deleteVideoReference: (id) => RF.deleteVideoReference(id),
    async briefFileViews(w) { const r = await V.briefFileViews(w); return r ? r.map((x) => ({ ref: x.ref, name: x.name, segments: segmentsText(x.segments) })) : null; },
    async removeBriefFile(w, ref) { const p = await V.briefPathOf(w, ref); if (!p) throw new Error("brief file not found"); const r = await V.removeBriefFile(w, p); if (!Array.isArray(r)) throw new Error(String(r)); },
    async setBriefSegments(w, ref, segs) { const p = await V.briefPathOf(w, ref); if (!p) throw new Error("brief file not found"); const r = await V.setBriefSegments(w, p, segs.map((s, i) => ({ id: `${s.start}-${s.end}-${i}`, ...s }))); if (!Array.isArray(r)) throw new Error(String(r)); return "ok"; },
  };
}

export async function realActDeps(env: Record<string, string | undefined> = process.env): Promise<ActServiceDeps> {
  const secret = env[ACT_SECRET_ENV];
  if (!secret || secret.length < 32) throw new Error("act secret not configured");
  const { supabase } = await import("@/lib/supabase");
  const { roleForEmail } = await import("@/lib/roles");
  return {
    nowMs: () => Date.now(),
    approvalSecret: approvalKeyFrom(secret),
    registry: ACTION_REGISTRY, registryVersion: ACTION_REGISTRY_VERSION,
    stores: supabaseActStores(supabase),
    writers: await realWriterDeps(),
    knownSecrets: knownSecretValues(env),
    async isOwner(userId) {
      const hit = ownerCache.get(userId);
      if (hit && Date.now() - hit.at < OWNER_CACHE_MS) return hit.ok;
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      const ok = !error && !!data?.user && roleForEmail(data.user.email ?? null) === "owner";
      ownerCache.set(userId, { ok, at: Date.now() });
      return ok;
    },
  };
}
