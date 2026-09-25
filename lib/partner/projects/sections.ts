/**
 * Sunny — PROJECT VIEW V2: progressive disclosure over EVERYTHING Redbloods stores about one project. Pure, READ-ONLY.
 *
 *   summary (default)  → the connected view (V1) + an index of every section and how much each holds
 *   <section>          → the full detail of that section, one item per record, with provenance
 *
 * Epistemics are explicit on every item:
 *   FACT            canonical structured state (status, dates, ids, amounts)
 *   OWNER_REPORTED  free text the Owner wrote (notes, instructions, blockers) — evidence, NEVER a canonical fact
 *   OBSERVATION     text written by someone else (engineer comments, notification text) or recorded by the system
 *   DERIVED         computed from canonical facts (signals, waiting evidence, classifications)
 *   UNKNOWN         Redbloods itself does not record it (the item says so)
 * Relationship quality comes from the project contract (CANONICAL_RELATION / DERIVED_RELATION / TEXT_MATCH / …).
 * Nothing here invents a relation, a price, a history or a priority.
 */
import type { GatewaySources } from "../gateway/core";
import type { OperationsRaw } from "../operations/types";
import type { PartnerCompanyState } from "../eyes/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { ProjectDetailRaw, DetailFile } from "./detail-types";
import { KNOWLEDGE_GAPS } from "../system/gaps";
import { buildProjectView, type ProjectView } from "./view";

export const PROJECT_SECTIONS = [
  "summary", "identity", "people", "money", "notes", "files", "materials", "sessions", "calendar", "proposal", "tasks", "meetings", "waiting",
  "victor", "engineers", "red_films", "clip", "social", "release", "album", "show_context", "delivery", "notifications", "history",
  "owner_knowledge", "actions_outcomes", "integrity", "graph", "missing",
] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export type SectionEpistemic = "FACT" | "OWNER_REPORTED" | "OBSERVATION" | "DERIVED" | "UNKNOWN";
export interface SectionRow { id: string; label: string; recordText: boolean; epistemic: SectionEpistemic; fields: Record<string, unknown> }
export interface SectionResult { found: boolean; rows: SectionRow[]; notes: string[]; unavailable: string[] }

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const rows = <T,>(sec: { rows: T[] } | null | undefined): T[] => sec?.rows ?? [];
const snip = (t: string | null | undefined, n = 80) => { const x = (t ?? "").replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
const R = (id: string, label: string, epistemic: SectionEpistemic, fields: Record<string, unknown>, recordText = false): SectionRow => ({ id, label, epistemic, fields, recordText });
/** A piece of human text: always OWNER_REPORTED / OBSERVATION, carried as RECORD text with its provenance. */
const TEXT = (id: string, source: string, text: string | null, o: { author?: string | null; at?: string | null; by?: "OWNER" | "ENGINEER" | "VICTOR" | "SYSTEM" | "UNKNOWN"; context?: Record<string, unknown> } = {}): SectionRow | null =>
  text && text.trim() ? R(id, snip(text), o.by === "OWNER" ? "OWNER_REPORTED" : "OBSERVATION", {
    source, text: { text, trust: "RECORD" }, author: o.author ?? null, at: o.at ?? null, writtenBy: o.by ?? "UNKNOWN",
    textClass: "FREE_TEXT_EVIDENCE_NOT_CANONICAL", ...(o.context ?? {}),
  }, true) : null;
const nn = <T,>(x: (T | null)[]): T[] => x.filter((v): v is T => v !== null);

interface Ctx {
  src: GatewaySources; id: string; key: string; v: ProjectView; today: string;
  st: PartnerCompanyState | null;
  ops: OperationsRaw | null; det: ProjectDetailRaw | null;
  workIds: Set<string>; versionIds: Set<string>; targetIds: Set<string>; productionIds: Set<string>;
}

function ctxOf(src: GatewaySources, projectId: string): Ctx {
  const st = ok(src.state) as PartnerCompanyState | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const v = buildProjectView(src, projectId);
  const workIds = new Set(rows(det?.engineerWork).filter((w) => w.projectId === projectId).map((w) => w.id));
  for (const w of rows(ops?.engineerWork)) if (w.projectId === projectId) workIds.add(w.id);
  const versionIds = new Set(rows(det?.mixVersions).filter((x) => (x.workId && workIds.has(x.workId)) || x.projectId === projectId).map((x) => x.id));
  const targetIds = new Set(rows(det?.mixTargets).filter((x) => x.workId && workIds.has(x.workId)).map((x) => x.id));
  const productionIds = new Set([...rows(det?.productions), ...rows(ops?.redFilms)].filter((p) => p.projectId === projectId).map((p) => p.id));
  return { src, id: projectId, key: `project:${projectId}`, v, today: st?.todayIL ?? src.now.toISOString().slice(0, 10), st, ops, det, workIds, versionIds, targetIds, productionIds };
}

// ── price evidence (never collapsed into PRICE_UNKNOWN; never picks between conflicting sources) ──
export type PriceClass =
  | "PRICE_EXISTS_CANONICALLY" | "FINANCE_EXCEPTION" | "PRICE_ZERO_STORED" | "CLIP_PRICE_ONLY" | "PRICE_EXISTS_ELSEWHERE" | "PRICE_CONFLICT"
  | "LABEL_NO_RECEIVABLE_CONTEXT" | "PRICE_NOT_RECORDED" | "UNRESOLVED";
export function priceEvidence(src: GatewaySources, projectId: string) {
  const fin = ok(src.finance);
  const st = ok(src.state);
  const ops = ok(src.operations) as OperationsRaw | null;
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  if (!fin) return { class: "UNRESOLVED" as PriceClass, reasonHe: "מוח הכספים לא נקרא — אין ראיות מחיר.", evidence: null };
  const setting = fin.raw.financeSettings.find((s) => s.projectId === projectId) ?? null;
  const val = (setting?.value && typeof setting.value === "object" ? setting.value : {}) as Record<string, unknown>;
  const storedPrice = setting && "agreedPrice" in val ? val.agreedPrice : undefined;
  const priceNum = storedPrice === undefined || storedPrice === null || storedPrice === "" ? null : Number(storedPrice);
  const clipPrice = Number(val.clipAgreedPrice ?? 0) > 0 ? Number(val.clipAgreedPrice) : null;
  const exception = val.financeException === true;
  const proposals = (st?.domains.proposalsFull.data?.items ?? []).filter((p) => p.linkedProjectId === projectId).map((p) => ({ status: p.status, amount: p.amount, currency: p.currency }));
  const productions = rows(ops?.redFilms).filter((p) => p.projectId === projectId).map((p) => ({ status: p.status, clientPrice: p.clientPrice, generalBudget: p.generalBudget }));
  const income = fin.raw.transactions.filter((t) => t.projectId === projectId && t.type === "income").length;
  const notes = rows(det?.financeNotes).find((f) => f.projectId === projectId) ?? null;
  const businessType = st?.domains.projects.data?.index[projectId]?.businessType ?? rows(ops?.projectsMeta).find((p) => p.id === projectId)?.businessType ?? null;
  const evidence = {
    setting: setting ? { exists: true, agreedPriceStored: storedPrice ?? null, currency: typeof val.currency === "string" ? val.currency : null, financeException: exception, clipAgreedPrice: clipPrice, financialNotes: notes?.financialNotes ?? null, exceptionReason: notes?.exceptionReason ?? null } : { exists: false },
    linkedProposals: proposals, productionPrices: productions, incomeRows: income, businessType,
  };
  const proposalAmounts = [...new Set(proposals.filter((p) => p.amount > 0).map((p) => `${p.amount}${p.currency}`))];
  let cls: PriceClass; let reasonHe: string;
  if (exception) { cls = "FINANCE_EXCEPTION"; reasonHe = "מסומן כחריג כספים (ללא חיוב) — אין חוב."; }
  else if (priceNum !== null && Number.isFinite(priceNum) && priceNum > 0) {
    const cur = typeof val.currency === "string" ? val.currency : "₪";
    const disagree = proposalAmounts.filter((a) => a !== `${priceNum}${cur}`);
    cls = disagree.length ? "PRICE_CONFLICT" : "PRICE_EXISTS_CANONICALLY";
    reasonHe = disagree.length ? `המחיר השמור ${cur}${priceNum} שונה מסכום ההצעה המקושרת (${disagree.join(", ")}) — לא נבחר מקור.` : `מחיר מוסכם שמור: ${cur}${priceNum}.`;
  } else if (priceNum === 0) { cls = "PRICE_ZERO_STORED"; reasonHe = "המחיר נשמר במפורש כ-0 בלי סימון חריג כספים — לא ידוע אם זו עבודה חינם, מחיר זמני או חוסר. דורש החלטת בעלים."; }
  else if (clipPrice) { cls = "CLIP_PRICE_ONLY"; reasonHe = `יש רק מחיר קליפ (${clipPrice}) — הוא של עסקת הקליפ, לא מחיר השיר/הפרויקט. מחיר השיר לא נרשם.`; }
  else if (proposalAmounts.length > 1) { cls = "PRICE_CONFLICT"; reasonHe = `כמה הצעות מקושרות בסכומים שונים (${proposalAmounts.join(", ")}) ואין מחיר שמור — לא נבחר מקור.`; }
  else if (proposalAmounts.length === 1) { cls = "PRICE_EXISTS_ELSEWHERE"; reasonHe = `אין מחיר שמור, אבל ההצעה המקושרת היא ${proposalAmounts[0]} — זה לא מחיר מוסכם שמור.`; }
  else if (businessType === "לייבל") { cls = "LABEL_NO_RECEIVABLE_CONTEXT"; reasonHe = "פרויקט לייבל — הסיווג יכול להסביר למה אין חוב של לקוח; לא ממציאים מחיר."; }
  else if (income > 0 || productions.some((p) => (p.clientPrice ?? 0) > 0)) { cls = "UNRESOLVED"; reasonHe = "אין מחיר שמור, אבל יש שורות הכנסה / מחיר הפקה — לא ניתן לקבוע מחיר מוסכם."; }
  else { cls = "PRICE_NOT_RECORDED"; reasonHe = "המחיר לא נרשם בשום מקור (אין הגדרה, הצעה, תנועה או מחיר הפקה)."; }
  return { class: cls, reasonHe, evidence };
}

// ── sections ──
function notesOf(c: Ctx): SectionRow[] {
  const d = c.det; const id = c.id;
  const p = rows(d?.projects).find((x) => x.id === id);
  const fn = rows(d?.financeNotes).find((x) => x.projectId === id);
  const out: (SectionRow | null)[] = [
    TEXT(`project-notes`, "PROJECT_NOTES", p?.notes ?? null, { by: "OWNER" }),
    TEXT(`finance-notes`, "FINANCIAL_NOTES", fn?.financialNotes ?? null, { by: "OWNER" }),
    TEXT(`finance-exception-reason`, "FINANCE_EXCEPTION_REASON", fn?.exceptionReason ?? null, { by: "OWNER", at: fn?.exceptionDate }),
    TEXT(`work-instructions`, "ENGINEER_INSTRUCTIONS", p?.workMaterials?.instructions ?? null, { by: "OWNER" }),
  ];
  for (const a of rows(d?.actions).filter((x) => x.projectId === id)) out.push(TEXT(`action:${a.id}`, "SEND_LOG_NOTE", a.notes, { by: "OWNER", at: a.actionDate, context: { recipient: a.recipientName, recipientRole: a.recipientRole, status: a.status } }));
  for (const s of rows(d?.sessions).filter((x) => x.projectId === id)) out.push(TEXT(`session:${s.id}`, "SESSION_NOTE", [s.title, s.notes, s.location ? `מיקום: ${s.location}` : null].filter(Boolean).join(" · ") || null, { by: "OWNER", at: s.date, context: { status: s.status } }));
  for (const m of rows(d?.meetings).filter((x) => x.projectId === id)) out.push(TEXT(`meeting:${m.id}`, "MEETING_NOTE", [m.notes, m.location ? `מיקום: ${m.location}` : null].filter(Boolean).join(" · ") || null, { by: "OWNER", at: m.date }));
  for (const t of rows(d?.tasks).filter((x) => x.relatedType === "project" && x.relatedId === id)) out.push(TEXT(`task:${t.id}`, "TASK", [t.title, t.notes].filter(Boolean).join(" — ") || null, { by: "OWNER", at: t.dueDate, context: { status: t.status } }));
  for (const w of rows(d?.engineerWork).filter((x) => x.projectId === id)) out.push(TEXT(`engineer-work:${w.id}`, "ENGINEER_WORK_NOTE", w.notes, { by: "OWNER", context: { engineer: w.engineerName } }));
  for (const m of rows(d?.mixComments).filter((x) => x.versionId && c.versionIds.has(x.versionId))) out.push(TEXT(`mix-comment:${m.id}`, "MIX_COMMENT", m.text, { by: "OWNER", author: m.author, at: m.createdAt, context: { status: m.status, timestampSeconds: m.timestampSeconds, role: m.role } }));
  for (const [i, n] of rows(d?.mixTargetNotes).filter((x) => x.targetId && c.targetIds.has(x.targetId)).entries()) out.push(TEXT(`mix-target-note:${i}`, "PRE_MIX_NOTE", n.text, { by: "OWNER", author: n.author, at: n.createdAt, context: { status: n.status } }));
  for (const w of rows(d?.victor).filter((x) => x.projectId === id)) {
    out.push(TEXT(`victor:${w.id}:notes`, "VICTOR_WORK_NOTE", w.notes, { by: "OWNER" }), TEXT(`victor:${w.id}:brief`, "VICTOR_BRIEF", w.briefText, { by: "OWNER" }));
    for (const r of w.reviews) out.push(TEXT(`victor:${w.id}:review:${r.version}`, "VICTOR_VERSION_REVIEW", r.notes, { by: "OWNER", at: r.reviewedAt, context: { version: r.version, status: r.status, sentToVictor: !!r.sentAt, sentAt: r.sentAt, draft: r.draft } }));
    for (const [i, ref] of w.references.entries()) out.push(TEXT(`victor:${w.id}:ref:${i}`, "VICTOR_REFERENCE", [ref.title, ref.note].filter(Boolean).join(" — ") || null, { by: "OWNER", context: { publicUrl: ref.publicUrl } }));
  }
  for (const p2 of rows(d?.productions).filter((x) => x.projectId === id)) {
    const script = [p2.script.start, p2.script.middle, p2.script.end].filter(Boolean).join(" / ") || null;
    out.push(TEXT(`production:${p2.id}:concept`, "RED_FILMS_CONCEPT", [p2.conceptSummary, p2.conceptVibe].filter(Boolean).join(" — ") || null, { by: "OWNER" }), TEXT(`production:${p2.id}:script`, "RED_FILMS_SCRIPT", script, { by: "OWNER" }),
      TEXT(`production:${p2.id}:director`, "DIRECTOR_NOTES", p2.directorNotes, { by: "OWNER" }), TEXT(`production:${p2.id}:photographer`, "PHOTOGRAPHER_NOTES", p2.photographerNotes, { by: "OWNER" }),
      TEXT(`production:${p2.id}:fix`, "EDIT_FIX_NOTES", p2.fixNotes, { by: "OWNER" }), TEXT(`production:${p2.id}:notes`, "PRODUCTION_NOTES", p2.notes, { by: "OWNER" }), TEXT(`production:${p2.id}:locations`, "LOCATIONS", p2.locations, { by: "OWNER" }));
  }
  for (const [i, b] of rows(d?.budgetItems).filter((x) => x.productionId && c.productionIds.has(x.productionId)).entries()) out.push(TEXT(`budget:${i}`, "BUDGET_ITEM_NOTE", b.notes, { by: "OWNER", context: { item: b.title, vendor: b.vendorName } }));
  for (const t of rows(d?.albumTracks).filter((x) => x.projectId === id)) out.push(TEXT(`track:${t.trackNumber}`, "ALBUM_TRACK_NOTE", t.notes, { by: "OWNER", context: { track: t.title } }));
  for (const [i, k] of rows(d?.clipItems).filter((x) => x.projectId === id).entries()) out.push(TEXT(`clip-item:${i}`, "CLIP_PLANNING_NOTE", [k.description, k.notes].filter(Boolean).join(" — ") || null, { by: "OWNER", context: { category: k.category, status: k.status } }));
  for (const x of rows(d?.transactionsText).filter((y) => y.projectId === id)) out.push(TEXT(`tx:${x.id}`, "TRANSACTION_TEXT", [x.description, x.notes].filter(Boolean).join(" — ") || null, { by: "OWNER", at: x.date, context: { type: x.type, paymentMethod: x.paymentMethod } }));
  for (const [i, b] of rows(d?.budgetPayments).filter((x) => x.productionId && c.productionIds.has(x.productionId)).entries()) out.push(TEXT(`budget-payment:${i}`, "PRODUCTION_PAYMENT_NOTE", b.notes, { by: "OWNER", at: b.date, context: { amount: b.amount, method: b.method } }));
  for (const pr of rows(d?.proposals).filter((x) => x.linkedProjectId === id)) out.push(TEXT(`proposal:${pr.id}`, "PROPOSAL_NOTE", pr.notes, { by: "OWNER", context: { proposal: pr.title } }));
  const rel = rows(d?.releases).find((x) => x.projectId === id);
  out.push(TEXT(`release:next`, "RELEASE_NEXT_ACTION", rel?.nextAction ?? null, { by: "OWNER" }), TEXT(`release:blocker`, "RELEASE_BLOCKER", rel?.blocker ?? null, { by: "OWNER", context: { responsible: rel?.responsible ?? null } }));
  for (const k of rows(d?.campaigns).filter((x) => x.projectId === id)) out.push(TEXT(`campaign:${k.id}`, "SOCIAL_CAMPAIGN", [k.marketingAngle, k.targetAudience, k.mainMessage, k.notes].filter(Boolean).join(" · ") || null, { by: "OWNER", context: { campaign: k.title, platforms: k.platforms } }));
  for (const k of rows(d?.contentItems).filter((x) => x.projectId === id)) out.push(TEXT(`content:${k.id}`, "SOCIAL_CONTENT", [k.hook, k.caption, k.notes].filter(Boolean).join(" · ") || null, { by: "OWNER", at: k.dueDate, context: { title: k.title, status: k.status, platform: k.platform } }));
  return nn(out);
}

function fileRow(kind: string, id: string, f: DetailFile, extra: Record<string, unknown> = {}): SectionRow {
  return R(id, f.name, "FACT", { kind, name: f.name, category: f.category, version: f.versionLabel, trackId: f.trackId, durationSeconds: f.durationSeconds, size: f.size, uploadedAt: f.uploadedAt, path: f.path, hasShareLink: f.hasShareLink, copiedFromMixVersion: f.fromMixVersionId, structureMarkers: f.structureMarkers, ...extra });
}
function filesOf(c: Ctx): SectionRow[] {
  const d = c.det; const id = c.id;
  const p = rows(d?.projects).find((x) => x.id === id);
  const out: SectionRow[] = (p?.files ?? []).map((f, i) => fileRow("PROJECT_FILE", `file:${i}`, f, { source: f.fromMixVersionId ? "MIX_VERSION_COPY" : f.category === "חומרי עבודה" ? "WORK_MATERIALS" : "UPLOAD_OR_INTAKE" }));
  for (const v of rows(d?.mixVersions).filter((x) => c.versionIds.has(x.id))) out.push(R(`mix-version:${v.id}`, `${v.label ?? ""} ${v.fileName ?? ""}`.trim(), "FACT", { kind: "MIX_VERSION", label: v.label, name: v.fileName, status: v.status, uploadedBy: v.uploadedBy, uploadedAt: v.uploadedAt, durationSeconds: v.durationSeconds, workId: v.workId, mixLine: v.targetId }));
  for (const [i, f] of rows(d?.finalFiles).filter((x) => x.projectId === id || (x.workId && c.workIds.has(x.workId))).entries()) out.push(R(`final:${i}`, f.fileName ?? "", "FACT", { kind: "FINAL_FILE", name: f.fileName, type: f.fileType, size: f.fileSize, uploadedBy: f.uploadedBy, uploadedAt: f.createdAt, workId: f.workId }));
  for (const w of rows(d?.victor).filter((x) => x.projectId === id)) {
    w.filesSent.forEach((f, i) => out.push(fileRow("VICTOR_DELIVERED", `victor:${w.id}:sent:${i}`, f, { by: "VICTOR" })));
    w.filesReceived.forEach((f, i) => out.push(fileRow("SENT_TO_VICTOR", `victor:${w.id}:received:${i}`, f, { by: "OWNER" })));
    w.briefFiles.forEach((f, i) => out.push(fileRow("VICTOR_BRIEF_FILE", `victor:${w.id}:brief:${i}`, f, { by: "OWNER" })));
  }
  for (const [i, f] of rows(d?.socialFiles).filter((x) => x.projectId === id).entries()) out.push(R(`social-file:${i}`, f.fileName ?? "", "FACT", { kind: "SOCIAL_FILE", name: f.fileName, type: f.fileType, size: f.fileSize, uploadedBy: f.uploadedBy, uploadedAt: f.createdAt, path: f.path, hasShareLink: f.hasShareLink }));
  for (const [i, b] of rows(d?.budgetPayments).filter((x) => x.productionId && c.productionIds.has(x.productionId) && x.receiptFileName).entries()) out.push(R(`receipt:${i}`, b.receiptFileName!, "FACT", { kind: "PRODUCTION_RECEIPT", name: b.receiptFileName, paidOn: b.date, amount: b.amount, hasShareLink: b.hasReceiptLink }));
  for (const x of rows(d?.transactionsText).filter((y) => y.projectId === id && y.hasReceipt)) out.push(R(`tx-receipt:${x.id}`, "קבלה לתנועה", "FACT", { kind: "TRANSACTION_RECEIPT_REFERENCE", date: x.date, type: x.type }));
  const comments = new Set(rows(d?.mixComments).filter((x) => x.versionId && c.versionIds.has(x.versionId)).map((x) => x.id));
  for (const [i, a] of rows(d?.commentAttachments).filter((x) => x.commentId && comments.has(x.commentId)).entries()) out.push(R(`comment-attachment:${i}`, a.fileName ?? "", "FACT", { kind: "COMMENT_ATTACHMENT", name: a.fileName, mime: a.mimeType, uploadedBy: a.uploadedBy, uploadedAt: a.createdAt }));
  return out;
}

function waitingOf(c: Ctx): SectionRow[] {
  const d = c.det; const id = c.id; const out: SectionRow[] = [];
  for (const a of rows(d?.actions).filter((x) => x.projectId === id && !["approved", "closed", "cancelled"].includes(x.status ?? ""))) {
    const on = a.status === "got_notes" ? "OWNER" : a.recipientRole ? a.recipientRole.toUpperCase() : "UNKNOWN";
    out.push(R(`send-log:${a.id}`, `${a.recipientName ?? a.recipientRole ?? "?"} · ${a.status ?? "?"}`, "DERIVED", { waitingOn: on, evidence: "send log entry", status: a.status, recipient: a.recipientName, role: a.recipientRole, sentOn: a.actionDate, followup: a.followupDate, followupOverdue: !!(a.followupDate && a.followupDate < c.today), content: a.contentType, version: a.versionLabel }));
  }
  for (const w of rows(c.ops?.engineerWork).filter((x) => x.projectId === id && !["אושר", "בוטל"].includes(x.status ?? ""))) {
    out.push(R(`engineer:${w.id}`, `${w.engineerName} · ${w.status}`, "DERIVED", { waitingOn: w.status === "חזר" ? "OWNER" : "ENGINEER", evidence: "engineer work status", engineer: w.engineerName, status: w.status, internalDeadline: w.internalDeadline, deadlinePassed: !!(w.internalDeadline && w.internalDeadline < c.today) }));
  }
  const openComments = rows(d?.mixComments).filter((x) => x.versionId && c.versionIds.has(x.versionId) && x.status === "open").length;
  if (openComments) out.push(R("open-mix-comments", `${openComments} הערות מיקס פתוחות`, "DERIVED", { waitingOn: "ENGINEER", evidence: "open mix comments", count: openComments }));
  for (const w of rows(d?.victor).filter((x) => x.projectId === id)) for (const r of w.reviews) {
    if (r.draft || (r.notes && !r.sentAt)) out.push(R(`victor-draft:${w.id}:${r.version}`, `הערות ל-${r.version} לא נשלחו לויקטור`, "DERIVED", { waitingOn: "OWNER", evidence: "Victor review notes written but not sent", version: r.version }));
    else if (r.status === "needs_revision") out.push(R(`victor-revision:${w.id}:${r.version}`, `${r.version} צריך תיקון`, "DERIVED", { waitingOn: "VICTOR", evidence: "Victor version review needs revision", version: r.version, sentAt: r.sentAt }));
  }
  for (const w of c.v.work.victor ?? []) out.push(R(`victor-ball:${w.title}`, `ויקטור: הכדור אצל ${w.ball}`, "DERIVED", { waitingOn: w.ball.toUpperCase(), evidence: "Victor upload vs recorded Owner response timestamps (does not prove it was not handled outside the system)", stuck: w.stuck }));
  const rel = rows(d?.releases).find((x) => x.projectId === id);
  if (rel?.blocker) out.push(R("release-blocker", snip(rel.blocker), "OWNER_REPORTED", { waitingOn: rel.responsible ?? "UNKNOWN", evidence: "release blocker text (Owner-written, not canonical)", text: { text: rel.blocker, trust: "RECORD" } }, true));
  const del = rows(d?.deliveries).find((x) => x.projectId === id);
  if (del && del.status !== "delivered" && del.status !== "not_created") out.push(R("delivery", `מסירה: ${del.status}`, "DERIVED", { waitingOn: "OWNER_OR_CLIENT", evidence: "delivery folder ready, not marked delivered", status: del.status }));
  if (c.v.money?.verdict === "DEBT") out.push(R("payment", "כסף פתוח מהלקוח", "DERIVED", { waitingOn: "CLIENT", evidence: c.v.money.reasonsHe }));
  const kn = (ok(c.src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [];
  for (const k of kn.filter((x) => x.kind === "PROJECT_BLOCKER" && (x.subjectKey === c.key || x.identityKeys.includes(c.key)))) out.push(R(`owner-blocker:${k.id}`, k.meaningHe, "OWNER_REPORTED", { waitingOn: String((k.value as Record<string, unknown>).reason ?? "UNKNOWN"), evidence: "taught by the Owner (P2)", learnedAt: k.createdAt }));
  if (!out.length) out.push(R("not-recorded", "לא נרשם במערכת על מי הפרויקט מחכה", "UNKNOWN", { waitingOn: "DATA_NOT_RECORDED", evidence: "no open send-log entry, engineer / Victor wait, blocker, delivery or payment signal; Redbloods has no 'waiting for client / artist' field" }));
  return out;
}

function calendarOf(c: Ctx): SectionRow[] {
  const d = c.det; const id = c.id; const out: SectionRow[] = [];
  for (const s of rows(d?.sessions).filter((x) => x.projectId === id)) out.push(R(`session:${s.id}`, `סשן ${s.date ?? "?"} ${s.startTime ?? ""}`.trim(), "FACT", { kind: "SESSION", date: s.date, start: s.startTime, end: s.endTime, status: s.status, type: s.type, hasCalendarEvent: s.hasCalendarEvent, entity: `session:${s.id}` }));
  for (const m of rows(d?.meetings).filter((x) => x.projectId === id)) out.push(R(`meeting:${m.id}`, `פגישה ${m.date ?? "?"} ${m.time ?? ""}`.trim(), "FACT", { kind: "MEETING", date: m.date, time: m.time, duration: m.duration, status: m.status, hasCalendarEvent: m.hasCalendarEvent }));
  for (const t of rows(d?.tasks).filter((x) => x.relatedType === "project" && x.relatedId === id)) out.push(R(`task:${t.id}`, t.title ?? "משימה", "FACT", { kind: "TASK", due: t.dueDate, status: t.status, hasGoogleTask: t.hasGoogleTask }));
  for (const k of rows(d?.contentItems).filter((x) => x.projectId === id && x.hasCalendarEvent)) out.push(R(`content:${k.id}`, k.title ?? "תוכן", "FACT", { kind: "SOCIAL_CONTENT", due: k.dueDate, publish: k.publishDate, hasCalendarEvent: true }));
  if (c.v.identity?.deadline) out.push(R("deadline", `דדליין ${c.v.identity.deadline}`, "FACT", { kind: "DEADLINE", date: c.v.identity.deadline, onCalendar: false }));
  return out;
}

function historyOf(c: Ctx): SectionRow[] {
  const d = c.det; const id = c.id; const ev: Array<{ at: string; what: string; kind: string; fields?: Record<string, unknown> }> = [];
  const p = rows(d?.projects).find((x) => x.id === id);
  if (p?.createdAt) ev.push({ at: p.createdAt, what: "הפרויקט נוצר", kind: "CREATED" });
  if (c.v.identity?.startDate) ev.push({ at: c.v.identity.startDate, what: "תאריך התחלה", kind: "START_DATE" });
  if (c.v.identity?.endDate) ev.push({ at: c.v.identity.endDate, what: "תאריך סיום (הושלם)", kind: "END_DATE" });
  for (const a of rows(d?.actions).filter((x) => x.projectId === id)) ev.push({ at: a.actionDate ?? a.createdAt ?? "", what: `${a.actionType ?? "?"} → ${a.recipientName ?? a.recipientRole ?? "?"} (${a.status ?? "?"})`, kind: "SEND_LOG", fields: { lastUpdated: a.updatedAt } });
  for (const s of rows(d?.sessions).filter((x) => x.projectId === id)) ev.push({ at: s.date ?? "", what: `סשן (${s.status ?? "?"})`, kind: "SESSION" });
  for (const v of rows(d?.mixVersions).filter((x) => c.versionIds.has(x.id))) ev.push({ at: v.uploadedAt ?? "", what: `גרסת מיקס ${v.label ?? ""} הועלתה (${v.uploadedBy ?? "?"})`, kind: "MIX_VERSION" });
  for (const f of rows(d?.finalFiles).filter((x) => x.projectId === id || (x.workId && c.workIds.has(x.workId)))) ev.push({ at: f.createdAt ?? "", what: `קובץ סופי ${f.fileName ?? ""}`, kind: "FINAL_FILE" });
  for (const w of rows(d?.victor).filter((x) => x.projectId === id)) { for (const r of w.reviews) if (r.sentAt) ev.push({ at: r.sentAt, what: `הערות ${r.version} נשלחו לויקטור`, kind: "VICTOR_NOTES_SENT" }); if (w.returnedDate) ev.push({ at: w.returnedDate, what: "ויקטור החזיר", kind: "VICTOR_RETURNED" }); }
  const rel = rows(d?.releases).find((x) => x.projectId === id);
  if (rel?.stageEnteredAt) ev.push({ at: rel.stageEnteredAt, what: "נכנס לשלב הריליס הנוכחי", kind: "RELEASE_STAGE" });
  if (rel?.releasedAt) ev.push({ at: rel.releasedAt, what: "יצא (ריליס)", kind: "RELEASED" });
  for (const n of rows(d?.notifications).filter((x) => x.projectId === id)) ev.push({ at: n.createdAt ?? "", what: n.title ?? "התראה", kind: "NOTIFICATION" });
  for (const a of rows(d?.agentAlerts).filter((x) => x.projectId === id)) ev.push({ at: a.createdAt ?? "", what: `התראת סוכן: ${a.title ?? a.type ?? "?"} (${a.status ?? "?"})`, kind: "AGENT_ALERT" });
  for (const o of (ok(c.src.outcomes) ?? []).filter((x) => "projectId" in x && x.projectId === id)) ev.push({ at: (o as { executedAt: string }).executedAt, what: `פעולת סאני בוצעה: ${o.actionType}`, kind: "SUNNY_ACTION_OUTCOME" });
  const out = ev.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at)).map((e, i) => R(`event:${i}`, e.what, "FACT", { at: e.at, kind: e.kind, historical: true, ...(e.fields ?? {}) }));
  out.push(R("not-recorded", "היסטוריית סטטוס / דדליין / מחיר / אמן לא נשמרת", "UNKNOWN", { kind: "HISTORY_NOT_RECORDED", fields: ["status", "deadline", "agreed price", "artist", "name", "notes"], current: { status: c.v.identity?.status ?? null, deadline: c.v.identity?.deadline ?? null, lastUpdatedDaysAgo: c.v.identity?.daysSinceUpdate ?? null }, note: "Redbloods overwrites these fields in place; only the current value and the last update time exist. Sunny deadline actions are the exception (append-only events)." }));
  return out;
}

function graphOf(c: Ctx): SectionRow[] {
  const out: SectionRow[] = []; const id = c.id;
  const E = (rel: string, to: string, quality: string, basis: string, extra: Record<string, unknown> = {}) => out.push(R(`${rel}:${to}`, `${rel} → ${to}`, quality === "CANONICAL_RELATION" ? "FACT" : "DERIVED", { relation: rel, to, quality, basis, traversable: /^(project|client|label-artist|dj|show|session|release|vendor):/.test(to), ...extra }));
  for (const p of c.v.people.clients) E("CLIENT", p.value.key, p.quality, p.basis);
  for (const p of c.v.people.labelArtists) E("LABEL_ARTIST", p.value.key, p.quality, p.basis);
  const bridges: Array<{ clientId: string; via: string }> = [];
  for (const pr of (c.st?.domains.proposalsFull.data?.items ?? []).filter((x) => x.linkedProjectId === id)) { E("PROPOSAL", `proposal:${pr.id}`, "CANONICAL_RELATION", "proposal linked project id", { readVia: "proposals" }); if (pr.clientId) bridges.push({ clientId: pr.clientId, via: "proposal" }); }
  for (const m of rows(c.det?.meetings).filter((x) => x.projectId === id && x.clientId)) bridges.push({ clientId: m.clientId!, via: "meeting" });
  for (const r of rows(c.ops?.redFilms).filter((x) => x.projectId === id && x.clientId)) bridges.push({ clientId: r.clientId!, via: "red films production" });
  for (const a of rows(c.det?.actions).filter((x) => x.projectId === id && x.recipientClientId)) bridges.push({ clientId: a.recipientClientId!, via: "send log recipient" });
  const textClients = new Set(c.v.people.clients.map((x) => x.value.key));
  for (const [cid, vias] of Object.entries(bridges.reduce<Record<string, string[]>>((m, b) => ({ ...m, [b.clientId]: [...(m[b.clientId] ?? []), b.via] }), {}))) {
    const k = `client:${cid}`;
    E("CLIENT_BY_ID_BRIDGE", k, "DERIVED_RELATION", `id bridge: ${[...new Set(vias)].join(", ")}`, { agreesWithArtistText: textClients.has(k), conflict: textClients.size > 0 && !textClients.has(k) });
  }
  for (const s of (c.st?.domains.sessions.data?.items ?? []).filter((x) => x.projectId === id)) E("SESSION", `session:${s.id}`, "CANONICAL_RELATION", "session project id");
  if (c.v.work.release) E("RELEASE", `release:${id}`, "CANONICAL_RELATION", "release details keyed by project id");
  if (c.v.people.victor) E("VICTOR", "vendor:VICTOR", "CANONICAL_RELATION", "Victor work project id");
  if ((c.v.work.engineers ?? []).some((w) => w.engineer === "Steven")) E("STEVEN", "vendor:STEVEN", "CANONICAL_RELATION", "engineer work project id");
  for (const w of (c.v.work.engineers ?? []).filter((x) => x.engineer !== "Steven")) E("EXTERNAL_ENGINEER", `engineer:${w.engineer}`, "CANONICAL_RELATION", "engineer work project id (engineer = free-text name)", { readVia: "mix_pipeline" });
  for (const r of rows(c.ops?.redFilms).filter((x) => x.projectId === id)) E("RED_FILMS_PRODUCTION", `production:${r.id}`, "CANONICAL_RELATION", "production project id", { readVia: "red_films" });
  for (const t of rows(c.det?.tasks).filter((x) => x.relatedType === "project" && x.relatedId === id)) E("TASK", `task:${t.id}`, "CANONICAL_RELATION", "task related project id", { readVia: "tasks" });
  for (const m of rows(c.det?.meetings).filter((x) => x.projectId === id)) E("MEETING", `meeting:${m.id}`, "CANONICAL_RELATION", "meeting project id (no FK)", { readVia: "meetings" });
  const tx = ok(c.src.finance)?.raw.transactions.filter((t) => t.projectId === id).length ?? 0;
  if (tx) E("TRANSACTIONS", `transactions:${tx}`, "CANONICAL_RELATION", "transaction project id (no FK)", { readVia: "finance_transactions", count: tx });
  const meta = rows(c.ops?.projectsMeta);
  const self = meta.find((x) => x.id === id);
  const parentText = self?.parentProject && self.parentProject !== "ללא שיוך" ? self.parentProject : null;
  if (parentText) {
    const bare = parentText.replace(/^(אלבום|EP|Riddim):\s*/, "").trim();
    const matches = meta.filter((x) => x.id !== id && (x.name === parentText || x.name === bare));
    if (matches.length === 1) E("PARENT_PROJECT", `project:${matches[0].id}`, "TEXT_MATCH", `parent text '${parentText}' equals that project's name`);
    else E("PARENT_PROJECT", `text:${parentText}`, matches.length ? "AMBIGUOUS" : "UNKNOWN", matches.length ? `${matches.length} projects share that name` : "no project has that name (renamed or a free label)");
  }
  const name = self?.name ?? c.v.identity?.name ?? null;
  if (name) for (const ch of meta.filter((x) => x.id !== id && x.parentProject && (x.parentProject === name || x.parentProject.replace(/^(אלבום|EP|Riddim):\s*/, "").trim() === name))) E("CHILD_PROJECT", `project:${ch.id}`, "TEXT_MATCH", "child's parent text equals this project's name");
  return out;
}

function showContextOf(c: Ctx): SectionRow[] {
  const clientIds = new Set(c.v.people.clients.map((x) => x.value.key.slice("client:".length)));
  const shows = (c.st?.domains.shows.data?.items ?? []).filter((s) => (s.artistClientId && clientIds.has(s.artistClientId)) || (s.bookerClientId && clientIds.has(s.bookerClientId)));
  const out = shows.map((s) => R(`show:${s.id}`, s.name, "DERIVED", { relation: "ARTIST_LEVEL_CONTEXT", notAProjectRelation: true, show: `show:${s.id}`, date: s.dateYmd, status: s.status, via: s.artistClientId && clientIds.has(s.artistClientId) ? "same artist client (the project's artist link is TEXT_MATCH)" : "same booker client" }));
  out.push(R("no-project-link", "אין בנתונים קישור בין הופעות לפרויקט", "UNKNOWN", { relation: "DATA_MODEL_GAP", note: "Shows never reference a project or release; the rows above are the same artist's shows, not this project's." }));
  return out;
}

export function buildProjectSection(src: GatewaySources, projectId: string, section: ProjectSection): SectionResult & { view: ProjectView } {
  const c = ctxOf(src, projectId);
  const unavailable = [!c.det ? "פרטי הפרויקט (הערות / קבצים / טקסטים) לא נקראו" : null, !c.ops ? "מקור התפעול לא נקרא" : null, !c.st ? "מצב החברה לא נקרא" : null].filter((x): x is string => !!x);
  const base = { found: c.v.found, view: c.v, unavailable, notes: [] as string[] };
  if (!c.v.found) return { ...base, rows: [] };
  const d = c.det; const id = c.id; const v = c.v;
  const one = (label: string, fields: Record<string, unknown>, e: SectionEpistemic = "FACT") => [R(section, label, e, fields)];
  switch (section) {
    case "summary": {
      const counts = Object.fromEntries(PROJECT_SECTIONS.filter((s) => !["summary", "identity", "people", "money", "missing"].includes(s)).map((s) => [s, buildProjectSection(src, projectId, s).rows.filter((r) => r.epistemic !== "UNKNOWN").length]));
      const price = priceEvidence(src, projectId);
      return { ...base, rows: [R("summary", v.identity!.name, "FACT", { ...(v as unknown as Record<string, unknown>), priceClass: price.class, priceReasonHe: price.reasonHe, sections: counts, howToDeepen: "partner_query project_view with params.section = one of the section names" })] };
    }
    case "identity": {
      const p = rows(d?.projects).find((x) => x.id === id);
      const meta = rows(c.ops?.projectsMeta).find((x) => x.id === id);
      return { ...base, rows: one(v.identity!.name, { ...v.identity, createdAt: p?.createdAt ?? null, dropboxFolder: p?.dropboxFolder ?? null, folderFrozen: p ? !!p.dropboxFolder : null, parentProjectText: meta?.parentProject ?? null, lastUpdated: meta?.updatedAt ?? null }) };
    }
    case "people": return { ...base, rows: one("people", { ...v.people, idBridges: graphOf(c).filter((r) => r.fields.relation === "CLIENT_BY_ID_BRIDGE").map((r) => r.fields) }, "DERIVED") };
    case "money": { const price = priceEvidence(src, projectId); return { ...base, rows: one("money", { ...v.money, moneyBrain: v.moneyBrain, priceClass: price.class, priceReasonHe: price.reasonHe, priceEvidence: price.evidence }, "DERIVED") }; }
    case "notes": return { ...base, rows: notesOf(c), notes: ["טקסט חופשי הוא ראיה (מה שנכתב), לא עובדה קנונית."] };
    case "files": {
      const r = filesOf(c);
      const p = rows(d?.projects).find((x) => x.id === id);
      const approvedNoFinals = (c.ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === id && w.status === "אושר" && !rows(d?.finalFiles).some((f) => f.workId === w.id));
      const missing = approvedNoFinals.map((w) => R(`expected-final:${w.id}`, `${w.engineerName}: עבודה אושרה ואין קבצים סופיים`, "DERIVED", { kind: "EXPECTED_MATERIAL_MISSING", engineer: w.engineerName }));
      const requested = rows(d?.projectSettings).filter((x) => (x.kind === "STEVEN_FINAL_FILES_REQUESTED_PROJECT" && x.projectId === id) || (x.kind === "STEVEN_FINAL_FILES_REQUESTED_WORK" && c.workIds.has(x.projectId)))
        .map((x, i) => R(`final-files-requested:${i}`, "סטיבן התבקש לשלוח קבצים סופיים", "FACT", { kind: "FINAL_FILES_REQUESTED", scope: x.kind === "STEVEN_FINAL_FILES_REQUESTED_PROJECT" ? "PROJECT" : "WORK", request: x.value }));
      missing.push(...requested);
      return { ...base, rows: [...r, ...missing], notes: [p ? (p.dropboxFolder ? `תיקייה קפואה: ${p.dropboxFolder}` : "התיקייה לא קפואה — מחושבת מהאמן והשם; שינוי אמן יעביר העלאות עתידיות.") : "", "תוכן הקבצים ורשימת דרופבוקס החיה לא נקראים (פער יכולת רשום)."].filter(Boolean) };
    }
    case "materials": {
      const p = rows(d?.projects).find((x) => x.id === id);
      const mat = (p?.files ?? []).filter((f) => f.category === "חומרי עבודה").map((f, i) => fileRow("WORK_MATERIAL_FILE", `material:${i}`, f));
      const vic = rows(d?.victor).filter((x) => x.projectId === id).flatMap((w) => [...w.briefFiles.map((f, i) => fileRow("VICTOR_BRIEF_FILE", `brief:${w.id}:${i}`, f)), ...nn([TEXT(`brief-text:${w.id}`, "VICTOR_BRIEF", w.briefText, { by: "OWNER" })])]);
      return { ...base, rows: [R("work-materials", "חומרי עבודה למהנדס", "OWNER_REPORTED", { bpm: p?.workMaterials?.bpm ?? null, key: p?.workMaterials?.key ?? null, instructions: p?.workMaterials?.instructions ? { text: p.workMaterials.instructions, trust: "RECORD" } : null }), ...mat, ...vic] };
    }
    case "sessions": return { ...base, rows: rows(d?.sessions).filter((x) => x.projectId === id).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((s) => R(`session:${s.id}`, `${s.date ?? "?"} · ${s.status ?? "?"}`, "FACT", { ...s, entity: `session:${s.id}`, notes: s.notes ? { text: s.notes, trust: "RECORD" } : null })) };
    case "calendar": return { ...base, rows: calendarOf(c), notes: ["סאני רואה כל קישור יומן ש-Redbloods שומרת (סשנים, פגישות, משימות, תוכן). האירוע החי ב-Google לא נקרא — פער יכולת רשום (קריאה חיה מרעננת אסימון ושומרת אותו)."] };
    case "proposal": return { ...base, rows: (c.st?.domains.proposalsFull.data?.items ?? []).filter((p) => p.linkedProjectId === id).map((p) => R(`proposal:${p.id}`, p.title, "FACT", { ...p, notes: rows(d?.proposals).find((x) => x.id === p.id)?.notes ? { text: rows(d?.proposals).find((x) => x.id === p.id)!.notes!, trust: "RECORD" } : null })) };
    case "tasks": return { ...base, rows: rows(d?.tasks).filter((t) => (t.relatedType === "project" && t.relatedId === id) || rows(d?.actions).some((a) => a.projectId === id && a.linkedTaskId === t.id)).map((t) => R(`task:${t.id}`, t.title ?? "משימה", "FACT", { ...t, notes: t.notes ? { text: t.notes, trust: "RECORD" } : null, overdue: !!(t.dueDate && t.dueDate < c.today && t.status === "פתוח") })) };
    case "meetings": return { ...base, rows: rows(d?.meetings).filter((m) => m.projectId === id).map((m) => R(`meeting:${m.id}`, `${m.date ?? "?"} ${m.clientName ?? ""}`.trim(), "FACT", { ...m, notes: m.notes ? { text: m.notes, trust: "RECORD" } : null })) };
    case "waiting": return { ...base, rows: waitingOf(c), notes: ["'מי מחכה למי' נגזר מראיות. אין ברדבלאדס שדה 'מחכה ללקוח/אמן' — אם אין ראיה, זה DATA_NOT_RECORDED."] };
    case "victor": return { ...base, rows: rows(d?.victor).filter((w) => w.projectId === id).map((w) => R(`victor:${w.id}`, "עבודת ויקטור", "FACT", { outcome: w.outcome, quality: w.quality, returnedDate: w.returnedDate, enteredProject: w.enteredProject, reviews: w.reviews.map((r) => ({ ...r, notes: r.notes ? { text: r.notes, trust: "RECORD" } : null, sentNotes: r.sentNotes ? { text: r.sentNotes, trust: "RECORD" } : null })), filesDelivered: w.filesSent.length, filesSentToVictor: w.filesReceived.length, briefFiles: w.briefFiles.length, references: w.references.length, folder: w.dropboxFolder, hasFolderLink: w.hasFolderLink, live: (v.work.victor ?? []) })) };
    case "engineers": {
      const out: SectionRow[] = [];
      for (const w of (c.ops?.engineerWork?.rows ?? []).filter((x) => x.projectId === id)) {
        const vs = rows(d?.mixVersions).filter((x) => x.workId === w.id);
        const lines = rows(d?.mixTargets).filter((x) => x.workId === w.id);
        out.push(R(`engineer:${w.id}`, `${w.engineerName} · ${w.status ?? "?"}`, "FACT", { engineer: w.engineerName, workType: w.workType, status: w.status, sentDate: w.sentDate, internalDeadline: w.internalDeadline, agreedPrice: w.agreedPrice, amountPaid: w.amountPaid, currency: w.currency, paymentDate: w.paymentDate,
          versions: vs.map((x) => ({ label: x.label, status: x.status, uploadedBy: x.uploadedBy, uploadedAt: x.uploadedAt, mixLine: x.targetId })), mixLines: lines.map((l) => ({ kind: l.kind, name: l.displayName, removed: !!l.removedAt })),
          comments: rows(d?.mixComments).filter((m) => m.versionId && vs.some((x) => x.id === m.versionId)).map((m) => ({ status: m.status, at: m.createdAt, timestampSeconds: m.timestampSeconds, author: m.author, text: m.text ? { text: m.text, trust: "RECORD" } : null })),
          finalFiles: rows(d?.finalFiles).filter((f) => f.workId === w.id).length, hasFilesLink: rows(d?.engineerWork).find((x) => x.id === w.id)?.hasFilesLink ?? null }));
      }
      return { ...base, rows: out };
    }
    case "red_films": return { ...base, rows: rows(d?.productions).filter((p) => p.projectId === id).map((p) => {
      const live = rows(c.ops?.redFilms).find((x) => x.id === p.id);
      return R(`production:${p.id}`, live?.title ?? "הפקה", "FACT", { relation: "RED_FILMS_LINK_EXISTS", status: live?.status ?? null, type: live?.productionType ?? null, shootDate: live?.shootDate ?? null, publishDate: live?.publishDate ?? null, editStatus: live?.editStatus ?? null,
        crew: { photographer: p.photographer, director: p.director, editor: p.editor, identity: "CREW_IDENTITY_TEXT (names typed by hand; not linked people)" }, publishedWhere: p.publishedWhere, folder: p.dropboxFolderPath, links: p.links,
        budget: rows(d?.budgetItems).filter((b) => b.productionId === p.id).map((b) => ({ title: b.title, category: b.category, vendor: b.vendorName, status: b.status, planned: b.planned, actual: b.actual })) });
    }) };
    case "clip": return { ...base, rows: one("clip", { finance: v.money?.clip ?? null, clipPrice: v.money?.price.clipAgreed ?? null, planning: rows(d?.clipItems).filter((k) => k.projectId === id).map((k) => ({ category: k.category, status: k.status, description: k.description, notes: k.notes })), redFilms: v.work.redFilms }) };
    case "social": return { ...base, rows: [...rows(d?.campaigns).filter((k) => k.projectId === id).map((k) => R(`campaign:${k.id}`, k.title ?? "קמפיין", "FACT", { ...k })), ...rows(d?.contentItems).filter((k) => k.projectId === id).map((k) => R(`content:${k.id}`, k.title ?? "תוכן", "FACT", { ...k }))] };
    case "release": { const rel = rows(d?.releases).find((x) => x.projectId === id); return { ...base, rows: v.work.release || rel ? one("release", { ...(v.work.release ?? {}), nextAction: rel?.nextAction ?? null, blocker: rel?.blocker ?? null, responsible: rel?.responsible ?? null, stageEnteredAt: rel?.stageEnteredAt ?? null }) : [] }; }
    case "album": return { ...base, rows: [...rows(d?.albumTracks).filter((t) => t.projectId === id).map((t) => R(`track:${t.trackNumber}`, t.title ?? "", "FACT", { ...t, live: (c.ops?.albumTracks?.rows ?? []).find((x) => x.projectId === id && x.trackNumber === t.trackNumber) ?? null })),
      ...rows(d?.projectSettings).filter((x) => x.projectId === id).map((x) => R(`setting:${x.kind}`, x.kind, "FACT", { kind: x.kind, value: x.value }))] };
    case "show_context": return { ...base, rows: showContextOf(c) };
    case "delivery": { const del = rows(d?.deliveries).find((x) => x.projectId === id); return { ...base, rows: del ? one("delivery", { ...del }) : [], notes: ["רשימת הקבצים בתיקיית המסירה נמצאת בדרופבוקס ולא נקראת חי (פער יכולת)."] }; }
    case "notifications": return { ...base, rows: [
      ...rows(d?.notifications).filter((n) => n.projectId === id).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).map((n, i) => R(`notification:${i}`, n.title ?? "התראה", "OBSERVATION", { kind: "BELL_NOTIFICATION", ...n, body: n.body ? { text: n.body, trust: "RECORD" } : null })),
      ...rows(d?.agentAlerts).filter((a) => a.projectId === id).map((a, i) => R(`agent-alert:${i}`, a.title ?? "התראת סוכן", "OBSERVATION", { kind: "AGENT_ALERT", ...a, message: a.message ? { text: a.message, trust: "RECORD" } : null })),
    ], notes: ["התראות הבעלים נמחקות כל שישי — רק מה שקיים עכשיו. התראות הסוכן (מערכת כבויה) נשמרות."] };
    case "history": return { ...base, rows: historyOf(c) };
    case "owner_knowledge": return { ...base, rows: v.ownerKnowledge.map((k, i) => R(`knowledge:${i}`, k.meaningHe, "OWNER_REPORTED", { ...k, layer: "OWNER_ORGANIZATIONAL_KNOWLEDGE (P2) — separate from canonical state; live state wins" })) };
    case "actions_outcomes": {
      const acts = (ok(src.actions) ?? []).filter((a) => "projectId" in a && a.projectId === id).map((a, i) => R(`action:${i}`, a.actionType, "FACT", { kind: "ACTION", type: a.actionType, state: a.state }));
      const outs = (ok(src.outcomes) ?? []).filter((o) => "projectId" in o && o.projectId === id).map((o, i) => R(`outcome:${i}`, o.actionType, "FACT", { kind: "OUTCOME", type: o.actionType, state: o.state, executedAt: (o as { executedAt?: string }).executedAt ?? null }));
      const cases = v.cases.map((k, i) => R(`case:${i}`, k.type, "DERIVED", { kind: "CASE", ...k }));
      return { ...base, rows: [...acts, ...outs, ...cases] };
    }
    case "integrity": {
      const out: SectionRow[] = [];
      for (const r of graphOf(c).filter((x) => x.fields.conflict === true)) out.push(R(`client-conflict:${r.fields.to}`, "קישור מזהה ללקוח אחר משם האמן", "DERIVED", { class: "CONFLICTING_SOURCES", ...r.fields }));
      const p = rows(d?.projects).find((x) => x.id === id);
      if (p && !p.dropboxFolder) out.push(R("unfrozen-folder", "תיקייה לא קפואה", "FACT", { class: "SYSTEM_BEHAVIOR_GAP", note: "artist change moves future uploads" }));
      const price = priceEvidence(src, projectId);
      if (["PRICE_CONFLICT", "PRICE_ZERO_STORED", "UNRESOLVED"].includes(price.class)) out.push(R("price", price.reasonHe, "DERIVED", { class: price.class === "PRICE_CONFLICT" ? "CONFLICTING_SOURCES" : "AMBIGUOUS", priceClass: price.class }));
      for (const g of graphOf(c).filter((x) => x.fields.relation === "PARENT_PROJECT" && x.fields.quality !== "TEXT_MATCH")) out.push(R("parent", String(g.fields.basis), "DERIVED", { class: "DATA_MODEL_GAP", ...g.fields }));
      return { ...base, rows: out };
    }
    case "graph": return { ...base, rows: graphOf(c), notes: ["traversable = אפשר להמשיך עם partner_entity; אחרת readVia = היכולת שקוראת אותו."] };
    case "missing": {
      const gaps = KNOWLEDGE_GAPS.filter((g) => g.id.startsWith("PRJ_") && g.status !== "CLOSED_NOW");
      return { ...base, rows: [...v.missing.map((m, i) => R(`missing:${i}`, m, "UNKNOWN", { kind: "NOT_READ_OR_NOT_RECORDED" })), ...gaps.map((g) => R(`gap:${g.id}`, g.description, "UNKNOWN", { gap: g.id, class: g.class, status: g.status, wouldClose: g.wouldClose }))] };
    }
  }
}
