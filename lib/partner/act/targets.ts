/**
 * SUNNY UNIVERSAL ACTION LAYER — ADDRESSABILITY. A typed action is only usable if Sunny can find its target. This pure
 * builder turns the sources the Gateway already loads (PROJECT_DETAIL, LABEL_DETAIL, OPERATIONS — secrets already
 * reduced at their read edge) into ready-to-use action keys `<kind>:<id>` under a parent entity. Read-only; no new
 * table reader; never a path, link or credential. The action-family test proves every key kind a primitive parses is
 * either listed here or found by partner_resolve (RESOLVE_KINDS) — an unaddressable action fails the build.
 */
import { ok, type GatewaySources } from "../gateway/core";
import { scrubSecrets } from "../projects/detail-reader";

export interface ActionTarget { key: string; kind: string; label: string; parent: string; state: string | null }

/** Kinds found through partner_resolve / the domain portfolios (top-level entities with names). */
export const RESOLVE_KINDS: readonly string[] = ["project", "client", "label-artist", "show"];
/** Kinds whose key is not `<kind>:<uuid>`: addressed by plain args the primitive's refusal lists (sketchId) or by other reads. */
export const NON_KEY_TARGETS: Readonly<Record<string, string>> = {
  sketch: "labelArtist + sketchId — a wrong / missing sketchId is refused WITH the artist's active sketches (id — title)",
  "victor-month": "workMonth (YYYY-MM) — the months are in victor_view money",
  "victor-review": "victorWork + version label — the versions are in victor_view (the work's reviews)",
  "gcal-event": "the Google event id from the calendar capability",
  gtask: "the Google Task id from the calendar capability",
  system: "no target (company-level action)",
  "project-asset": "project + fileRef — a wrong / missing fileRef is refused WITH the project's files (fileRef — name); a file path is never used",
  "album-prev": "project (+ rowId) — a wrong rowId is refused WITH the table's rows (rowId — song)",
  "victor-asset": "victorWork + fileRef — a wrong / missing fileRef is refused WITH the work's files (fileRef — name); never a path",
  "victor-brief": "victorWork + briefRef — a wrong / missing briefRef is refused WITH the work's brief files (briefRef — name); never a path",
  "victor-reference": "victorWork + referenceId — a wrong / missing id is refused WITH the work's references (referenceId — title)",
  upload: "a file-channel placement key (target + inboxItem) — the inboxItem handle comes from the refusal that lists the Sunny Inbox (inboxItem — name — size)",
  notification: "MARK_NOTIFICATIONS_READ with a wrong / missing key is refused WITH your unread notifications (notification:<id> — title)",
  "owner-inbox": "the item id from owner_inbox (mode new); MARK_OWNER_INBOX_ITEM with a wrong / missing key is refused WITH the unhandled items (owner-inbox:<id> — text)",
  "inbox-link": "a link id from owner_inbox (each item's memory.links) or project_memory mode history (link:<id>); a new link is target inbox-link:new",
  "inbox-interpretation": "an interpretation id from project_memory (understanding / history) or owner_inbox (memory.interpretations); a new one is target inbox-interpretation:new",
};
/** Parent kind → the child kinds listed under it (the capability's contract; the test pins it against the primitives). */
export const TARGET_KINDS: Readonly<Record<string, readonly string[]>> = {
  project: ["session", "meeting", "task", "send-log", "album-track", "mix-work", "victor-work", "clip-row", "rf-production", "proposal", "transaction", "release", "social-campaign"],
  "social-campaign": ["social-content", "promotion", "social-attachment"],
  "social-content": ["social-attachment"],
  "mix-work": ["mix-version", "mix-comment", "mix-attachment", "mix-line", "premix-note"],
  "rf-production": ["rf-budget-line", "rf-payment", "rf-document", "rf-reference", "rf-video-reference"],
  "label-artist": ["ledger-entry", "media-income"],
  client: ["proposal", "meeting", "task"],
  show: ["session", "task"],
  company: ["mix-work", "victor-work", "rf-production", "proposal", "session", "meeting", "task", "rf-equipment", "beat"],
};

const rows = <T>(m: { rows: readonly T[] } | null | undefined): readonly T[] => (m && Array.isArray(m.rows) ? m.rows : []);
const j = (...xs: Array<string | number | null | undefined>) => xs.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").join(" · ");

export type TargetsResult = { ok: true; targets: ActionTarget[] } | { ok: false; reason: "BAD_PARENT" | "SOURCE_UNAVAILABLE"; detail: string };

export function buildActionTargets(src: GatewaySources, parentKey: string, kind?: string): TargetsResult {
  const i = parentKey.indexOf(":");
  const pk = i > 0 ? parentKey.slice(0, i) : parentKey;
  const pid = i > 0 ? parentKey.slice(i + 1).toLowerCase() : "";
  if (!TARGET_KINDS[pk] || (pk !== "company" && !/^[0-9a-f-]{36}$/.test(pid))) return { ok: false, reason: "BAD_PARENT", detail: `parent must be one of ${Object.keys(TARGET_KINDS).map((k) => (k === "company" ? "company" : `${k}:<id>`)).join(", ")}` };
  const want = (k: string) => !kind || kind === k;
  const out: ActionTarget[] = [];
  const add = (k: string, id: string | null | undefined, label: string, state: string | null = null) => { if (id && want(k)) out.push({ key: `${k}:${id}`, kind: k, label: scrubSecrets(label.slice(0, 160)) || "—", parent: parentKey, state }); };
  const det = ok(src.projectDetail), lab = ok(src.labelDetail), ops = ok(src.operations);
  const needDet = () => { if (!det) throw new Error("PROJECT_DETAIL"); return det; };
  try {
    if (pk === "project") {
      const d = needDet();
      for (const x of rows(d.sessions)) if (x.projectId === pid) add("session", x.id, j(x.date, x.startTime, x.type, x.title), x.status);
      for (const x of rows(d.meetings)) if (x.projectId === pid) add("meeting", x.id, j(x.date, x.time, x.clientName), x.status);
      for (const x of rows(d.tasks)) if (x.relatedType === "project" && x.relatedId === pid) add("task", x.id, j(x.title, x.dueDate), x.status);
      for (const x of rows(d.actions)) if (x.projectId === pid) add("send-log", x.id, j(x.actionDate, x.actionType, x.contentType, x.versionLabel, x.recipientName ?? x.recipientRole), x.status);
      for (const x of rows(d.albumTracks)) if (x.projectId === pid) add("album-track", x.id ?? null, j(x.trackNumber, x.title));
      for (const x of rows(d.engineerWork)) if (x.projectId === pid) add("mix-work", x.id, j(x.engineerName, x.workType, x.workTitle), x.status);
      for (const x of rows(d.victor)) if (x.projectId === pid) add("victor-work", x.id, j(x.vendorName, x.title), x.status ?? null);
      for (const x of rows(d.clipItems)) if (x.projectId === pid) add("clip-row", x.id, j(x.category, x.description, x.amount), x.status);
      for (const x of rows(d.productions)) if (x.projectId === pid) add("rf-production", x.id, rows(ops?.redFilms).find((p) => p.id === x.id)?.title ?? j(x.clientNameSnapshot), rows(ops?.redFilms).find((p) => p.id === x.id)?.status ?? null);
      for (const x of rows(d.proposals)) if (x.linkedProjectId === pid) add("proposal", x.id, j(x.title));
      for (const x of rows(d.transactionsText)) if (x.projectId === pid) add("transaction", x.id, j(x.date, x.type, x.description));
      for (const x of rows(d.releases)) if (x.projectId === pid) add("release", x.projectId, j("ריליס", x.nextAction));
      for (const x of rows(d.campaigns)) if (x.projectId === pid) add("social-campaign", x.id, j("קמפיין", x.title));
    } else if (pk === "social-campaign") {
      const d = needDet();
      for (const x of rows(d.contentItems)) if (x.campaignId === pid) add("social-content", x.id, j(x.contentType, x.title, x.publishDate), x.status);
      for (const x of rows(ops?.promotions)) if (x.campaignId === pid) add("promotion", x.id ?? null, j(x.name, x.channel, x.plannedAmount, x.promoDate), x.status);
      for (const x of rows(d.socialFiles)) if (x.campaignId === pid) add("social-attachment", x.id ?? null, j(x.fileName, x.fileType));
    } else if (pk === "social-content") {
      const d = needDet();
      for (const x of rows(d.socialFiles)) if (x.contentItemId === pid) add("social-attachment", x.id ?? null, j(x.fileName, x.fileType));
    } else if (pk === "mix-work") {
      const d = needDet();
      const versions = rows(d.mixVersions).filter((x) => x.workId === pid);
      const vIds = new Set(versions.map((x) => x.id));
      for (const x of versions) add("mix-version", x.id, j(x.label, x.fileName, x.uploadedAt), x.status);
      for (const x of rows(d.mixComments)) if (x.versionId && vIds.has(x.versionId)) add("mix-comment", x.id, j(versions.find((v) => v.id === x.versionId)?.label, x.timestampSeconds !== null ? `${x.timestampSeconds}s` : null, (x.text ?? "").slice(0, 80)), x.status);
      const commentIds = new Set(rows(d.mixComments).filter((x) => x.versionId && vIds.has(x.versionId)).map((x) => x.id));
      for (const x of rows(d.commentAttachments)) if (x.commentId && commentIds.has(x.commentId)) add("mix-attachment", x.id ?? null, j(x.fileName, x.mimeType));
      const lines = rows(d.mixTargets).filter((x) => x.workId === pid && !x.removedAt);
      const lIds = new Set(lines.map((x) => x.id));
      for (const x of lines) add("mix-line", x.id, j(x.sortOrder, x.displayName, x.kind));
      for (const x of rows(d.mixTargetNotes)) if (x.targetId && lIds.has(x.targetId)) add("premix-note", x.id ?? null, j(lines.find((l) => l.id === x.targetId)?.displayName, (x.text ?? "").slice(0, 80)), x.status);
    } else if (pk === "rf-production") {
      const d = needDet();
      for (const x of rows(d.budgetItems)) if (x.productionId === pid) add("rf-budget-line", x.id, j(x.category, x.title, x.vendorName), x.status);
      for (const x of rows(d.budgetPayments)) if (x.productionId === pid) add("rf-payment", x.id ?? null, j(x.date, x.amount, x.currency, x.method), x.linkedTransactionId ? "LINKED_TO_FINANCE" : "NOT_IN_FINANCE"); // DB-1 link state
      for (const x of rows(d.rfDocuments)) if (x.productionId === pid) add("rf-document", x.id, j(x.fileName, x.fileType));
      for (const x of rows(d.rfRefImages)) if (x.productionId === pid) add("rf-reference", x.id, j(x.fileName, x.caption, x.tag));
      for (const x of rows(d.rfRefLinks)) if (x.productionId === pid) add("rf-video-reference", x.id, j(x.provider, x.title, x.notes));
    } else if (pk === "label-artist") {
      if (!lab) throw new Error("LABEL_DETAIL");
      for (const x of rows(lab.ledger)) if (x.artistId === pid) add("ledger-entry", x.id, j(x.entryDate, x.entryType, x.amount, x.description));
      for (const x of rows(lab.mediaIncome)) if (x.artistId === pid) add("media-income", x.id, j(x.reportPeriod, x.source, x.grossAmount), x.status);
    } else if (pk === "client") {
      const d = needDet();
      for (const x of rows(d.proposals)) if (x.clientId === pid) add("proposal", x.id, j(x.title));
      for (const x of rows(d.meetings)) if (x.clientId === pid) add("meeting", x.id, j(x.date, x.time), x.status);
      for (const x of rows(d.tasks)) if (x.relatedType === "client" && x.relatedId === pid) add("task", x.id, j(x.title, x.dueDate), x.status);
    } else if (pk === "show") {
      const d = needDet();
      for (const x of rows(d.sessions)) if (x.showId === pid) add("session", x.id, j(x.date, x.startTime, x.type, x.title), x.status);
      for (const x of rows(d.tasks)) if (x.showId === pid) add("task", x.id, j(x.title, x.dueDate), x.status);
    } else {
      const d = needDet();
      const pname = (id: string | null) => (id ? rows(ops?.projectsMeta).find((p) => p.id === id)?.name ?? null : null);
      for (const x of rows(d.engineerWork)) add("mix-work", x.id, j(x.engineerName, x.workType, x.workTitle, pname(x.projectId)), x.status);
      for (const x of rows(d.victor)) add("victor-work", x.id, j(x.vendorName, x.title, pname(x.projectId)), x.status ?? null);
      for (const x of rows(ops?.redFilms)) add("rf-production", x.id, j(x.title, x.productionType, x.shootDate), x.status);
      for (const x of rows(d.proposals)) add("proposal", x.id, j(x.title, pname(x.linkedProjectId)));
      for (const x of rows(d.sessions)) add("session", x.id, j(x.date, x.startTime, x.type, x.title, pname(x.projectId)), x.status);
      for (const x of rows(d.meetings)) add("meeting", x.id, j(x.date, x.time, x.clientName, pname(x.projectId)), x.status);
      for (const x of rows(d.tasks)) add("task", x.id, j(x.title, x.dueDate), x.status);
      for (const x of rows(d.rfEquipment)) if (!x.removedAt) add("rf-equipment", x.id, j(x.name, x.category, x.quantity), x.status);
      if (!lab) throw new Error("LABEL_DETAIL");
      for (const x of rows(lab.beats)) add("beat", x.id, j(x.name, x.genre, x.musicalKey), x.status);
    }
  } catch (e) {
    return { ok: false, reason: "SOURCE_UNAVAILABLE", detail: e instanceof Error ? e.message : "source" };
  }
  return { ok: true, targets: out };
}
