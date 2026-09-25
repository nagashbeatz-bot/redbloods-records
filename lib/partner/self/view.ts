/**
 * Sunny FULL-BRAIN COMPLETION — Files / storage metadata, Reports state, and Sunny's knowledge of itself (pure, read-only).
 *
 * Storage: every file that has a DATABASE record, grouped by storage namespace — name / type / size / uploader / date /
 * owning entity only; never a path, link or token. Files that live only in storage are named as a capability gap.
 * Sunny self: what Sunny was told (Owner context), taught (Owner knowledge), did (action events + outcomes) and does not
 * know — never conversation text (none is stored), and the connector audit is explicitly unreadable.
 */
import type { GatewaySources } from "../gateway/core";
import { ok } from "../gateway/core";
import type { PartnerCompanyState } from "../eyes/types";
import type { ProjectDetailRaw, DetailFile } from "../projects/detail-types";
import type { OperationsRaw } from "../operations/types";
import type { SettingsState } from "../settings/types";
import type { PartnerMemory } from "../memory/types";
import { STORAGE_NAMESPACES, STORAGE_READ_DECISION, REPORTS_MODEL, SUNNY_CORE_MODEL } from "../system/platform-domains";

interface FileMeta { name: string | null; type: string | null; size: number | null; uploadedAt: string | null; uploadedBy: string | null; entity: string | null; publicLink: boolean }
const fromDetailFile = (f: DetailFile, entity: string | null): FileMeta => ({ name: f.name, type: f.category ?? f.versionLabel ?? null, size: f.size, uploadedAt: f.uploadedAt, uploadedBy: (f as { uploadedBy?: string | null }).uploadedBy ?? null, entity, publicLink: f.hasShareLink });

export function buildStorageView(src: GatewaySources) {
  const det = ok(src.projectDetail) as ProjectDetailRaw | null;
  const ops = ok(src.operations) as OperationsRaw | null;
  const st = ok(src.state) as PartnerCompanyState | null;
  const pname = (id: string | null | undefined) => (id ? ops?.projectsMeta?.rows.find((p) => p.id === id)?.name ?? st?.domains.projects.data?.index[id]?.name ?? null : null);
  const ns: Record<string, FileMeta[]> = {};
  const put = (id: string, f: FileMeta) => { (ns[id] ??= []).push(f); };
  for (const p of det?.projects?.rows ?? []) for (const f of p.files ?? []) put(/instructions/i.test(f.category ?? "") ? "PROJECT_INSTRUCTIONS" : "PROJECT_FILES", fromDetailFile(f, `project:${p.id}`));
  for (const v of det?.mixVersions?.rows ?? []) put("MIX_VERSIONS", { name: v.fileName, type: v.label, size: null, uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy, entity: v.projectId ? `project:${v.projectId}` : v.workId ? `mix-work:${v.workId}` : null, publicLink: false });
  for (const a of det?.commentAttachments?.rows ?? []) put("MIX_VERSIONS", { name: a.fileName, type: a.mimeType, size: a.size, uploadedAt: a.createdAt, uploadedBy: a.uploadedBy, entity: null, publicLink: false });
  for (const f of det?.finalFiles?.rows ?? []) put("FINAL_FILES", { name: f.fileName, type: f.fileType, size: f.fileSize, uploadedAt: f.createdAt, uploadedBy: f.uploadedBy, entity: f.projectId ? `project:${f.projectId}` : f.workId ? `mix-work:${f.workId}` : null, publicLink: false });
  for (const w of det?.victor?.rows ?? []) for (const f of [...w.filesSent, ...w.filesReceived, ...w.briefFiles]) put("VICTOR_WORK", fromDetailFile(f, `victor-work:${w.id}`));
  for (const d of det?.rfDocuments?.rows ?? []) put("RED_FILMS", { name: d.fileName, type: d.fileType, size: null, uploadedAt: d.createdAt, uploadedBy: null, entity: d.productionId ? `video-production:${d.productionId}` : null, publicLink: d.hasPublicLink });
  for (const r of det?.rfRefImages?.rows ?? []) put("RED_FILMS", { name: (r as { fileName?: string | null }).fileName ?? null, type: "reference image", size: null, uploadedAt: (r as { createdAt?: string | null }).createdAt ?? null, uploadedBy: null, entity: (r as { productionId?: string | null }).productionId ? `video-production:${(r as { productionId: string }).productionId}` : null, publicLink: !!(r as { hasLink?: boolean }).hasLink });
  for (const b of det?.budgetPayments?.rows ?? []) if (b.receiptFileName) put("RED_FILMS", { name: b.receiptFileName, type: b.receiptMime, size: null, uploadedAt: b.createdAt, uploadedBy: null, entity: b.productionId ? `video-production:${b.productionId}` : null, publicLink: b.hasReceiptLink });
  for (const f of det?.socialFiles?.rows ?? []) put("SOCIAL", { name: f.fileName, type: f.fileType, size: f.fileSize, uploadedAt: f.createdAt, uploadedBy: f.uploadedBy || null, entity: f.projectId ? `project:${f.projectId}` : null, publicLink: f.hasShareLink });
  for (const b of ops?.beats?.rows ?? []) put("BEATS", { name: b.name, type: b.genre, size: null, uploadedAt: b.createdAt, uploadedBy: null, entity: `beat:${b.id}`, publicLink: false });
  for (const s of (det?.projectSettings?.rows ?? []).filter((r) => r.kind === "PROJECT_COVER")) put("PROJECT_COVERS", { name: "cover", type: String((s.value as { theme?: unknown } | null)?.theme ?? "custom"), size: null, uploadedAt: String((s.value as { updatedAt?: unknown } | null)?.updatedAt ?? "") || null, uploadedBy: null, entity: `project:${s.projectId}`, publicLink: false });
  const deliveries = det?.deliveries?.rows ?? [];
  const namespaces = STORAGE_NAMESPACES.map((n) => {
    const files = ns[n.id] ?? [];
    const last = files.map((f) => f.uploadedAt ?? "").filter(Boolean).sort().pop() ?? null;
    return { id: n.id, meaningHe: n.meaningHe, dbRecord: n.dbRecord, recordedIn: n.recordedIn, sunnyReads: n.sunnyReads, publicLinks: n.publicLinks,
      recordedFiles: n.dbRecord === "NONE_DROPBOX_ONLY" ? null : n.id === "DELIVERY" ? null : files.length, totalBytes: files.reduce((s, f) => s + (f.size ?? 0), 0) || null, lastUpload: last, withPublicLink: files.filter((f) => f.publicLink).length,
      extra: n.id === "DELIVERY" ? { deliveryFolders: deliveries.length, withPublicLink: deliveries.filter((d) => d.hasLink).length, contents: "NOT_LISTED" } : null };
  });
  const byProject = new Map<string, FileMeta[]>();
  for (const [nsId, files] of Object.entries(ns)) for (const f of files) if (f.entity?.startsWith("project:")) byProject.set(f.entity, [...(byProject.get(f.entity) ?? []), { ...f, type: `${nsId}:${f.type ?? ""}` }]);
  return {
    backends: { dropbox: "the only file store", databaseFileBuckets: "not used", credential: "never read — connected / not connected only" },
    namespaces, byProject: [...byProject.entries()].map(([k, files]) => ({ project: k, name: pname(k.slice(8)), files })).sort((a, b) => b.files.length - a.files.length),
    liveListing: STORAGE_READ_DECISION,
    unavailable: [...(det ? [] : ["PROJECT_DETAIL (file records) — unknown, not none"]), "files that exist only in storage (artist portal manifest / performance / press kit / avatar, delivery contents, files added outside the app) are not listed"],
  };
}

export function buildReportsState(src: GatewaySources) {
  const settings = ok(src.settings) as SettingsState | null;
  const row = settings?.families?.REPORT_SCHEDULE?.rows?.find((r: { key: string }) => r.key === "report_schedule") as { value?: { morningTime?: string; eveningTime?: string }; updatedAt?: string | null } | undefined;
  return {
    schedule: settings ? { morningTime: row?.value?.morningTime ?? "07:00 (default)", eveningTime: row?.value?.eveningTime ?? "19:00 (default)", stored: !!row, updatedAt: row?.updatedAt ?? null } : null,
    model: { types: REPORTS_MODEL.types, recipients: REPORTS_MODEL.recipients, history: REPORTS_MODEL.history, aiRecommendations: REPORTS_MODEL.aiRecommendations, moneySemantics: REPORTS_MODEL.moneySemantics, dateSemantics: REPORTS_MODEL.dateSemantics, vsSunnyMorningBrief: REPORTS_MODEL.vsSunnyMorningBrief, anomalies: REPORTS_MODEL.anomalies },
    unavailable: [...(settings ? [] : ["SETTINGS (report schedule) — unknown"]), "what was actually sent is never recorded (no report history)"],
  };
}

export function buildSunnySelfView(src: GatewaySources) {
  const kn = (ok(src.ownerKnowledge) ?? null) as Array<{ id: string; createdAt: string; kind: string; subjectKey: string; meaningHe: string; operation: string; supersedesId: string | null; provenance?: { source?: string } }> | null;
  const mem = ok(src.memory) as PartnerMemory | null;
  const decisions = mem ? mem.entities.flatMap((e) => e.ownerDecisions.map((d) => ({ entity: d.entity, questionType: d.questionType, answer: d.answerCode, answerDate: d.answerValueYmd, answeredAt: d.answeredAt, status: d.status }))) : null;
  const actions = ok(src.actions);
  const outcomes = ok(src.outcomes);
  const integrity = ok(src.integrity);
  return {
    knowledge: kn ? { records: kn.length, active: kn.filter((k) => k.operation === "ASSERT" && !kn.some((x) => x.supersedesId === k.id)).length, withdrawn: kn.filter((k) => k.operation === "WITHDRAW").length, byKind: kn.reduce<Record<string, number>>((m, k) => ({ ...m, [k.kind]: (m[k.kind] ?? 0) + 1 }), {}), latest: [...kn].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((k) => ({ at: k.createdAt, kind: k.kind, subject: k.subjectKey, meaningHe: k.meaningHe, operation: k.operation, via: k.provenance?.source ?? null })) } : null,
    ownerAnswers: decisions ? { total: decisions.length, active: decisions.filter((d) => d.status === "ACTIVE").length, latest: [...decisions].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt)).slice(0, 10) } : null,
    actions: actions ? actions.map((a) => ({ type: a.actionType, state: a.state, headlineHe: a.headlineHe })) : null,
    outcomes: outcomes ? outcomes.map((o) => ({ type: o.actionType, state: o.state, executedAt: o.executedAt, headlineHe: o.headlineHe })) : null,
    openQuestions: integrity ? { integrity: integrity.questions.length, deferred: integrity.deferredQuestions, learned: integrity.learned.length } : null,
    audit: { readable: false, why: "the connector audit is insert-only for the service role by design, and it stores parameter HASHES — past queries cannot be read back, and even with read rights only capability names, entity keys and times would be recoverable", closesWith: "an Owner-approved read grant + a bounded Owner-only history capability (see gap SC_CONNECTOR_AUDIT_UNREADABLE)" },
    conversationMemory: "NONE — Claude conversations are never stored in Redbloods; only what the Owner explicitly answered / taught / approved is kept",
    canAnswer: SUNNY_CORE_MODEL.whatSunnyCanAnswerAboutItself, cannotAnswer: SUNNY_CORE_MODEL.cannotAnswer,
    unavailable: [...(kn ? [] : ["OWNER_KNOWLEDGE — not active or unreadable (unknown, not none)"]), ...(mem ? [] : ["MEMORY (Owner answers) — unknown"]), ...(actions ? [] : ["ACTIONS"]), ...(outcomes ? [] : ["OUTCOMES"])],
  };
}
