/**
 * Sunny — ONE CONNECTED PROJECT VIEW. Pure, READ-ONLY, over the sources every Gateway request already loads
 * (company state, Finance Brain raw + state, operations, owner knowledge, cases, actions, outcomes). No new rule,
 * no scoring, no ranking. Every link says HOW it is known:
 *   CANONICAL_RELATION  id link in the data (session.project_id, proposal.linked_project_id, work.project_id …)
 *   TEXT_MATCH          the project's artist text matches a client / label-artist name (never a hard link)
 *   OWNER_CONFIRMED     taught by the Owner (P2), kept separate from canonical state
 *   DERIVED             computed from canonical facts (signals) — never a fact
 *   UNKNOWN             Sunny has no source for it
 * Signals are DERIVED facts to reason with — "stale" is never "urgent" (Owner Charter), and a deadline alone never
 * outranks quality or label work.
 */
import type { GatewaySources } from "../gateway/core";
import type { OperationsRaw } from "../operations/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { activeKnowledge } from "../owner-knowledge/store";
import { projectMoney, type ProjectMoney } from "./money";

type Q = "CANONICAL_RELATION" | "TEXT_MATCH" | "OWNER_CONFIRMED_RELATION" | "DERIVED_RELATION" | "UNKNOWN";
export interface Link<T> { quality: Q; basis: string; value: T }
export interface Signal { code: string; kind: "CANONICAL_FACT" | "DERIVED_SIGNAL" | "OWNER_POLICY" | "UNKNOWN"; he: string }

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const CLOSED = new Set(["הושלם", "בוטל"]);
const INACTIVE = new Set(["הושלם", "בוטל", "בהשהייה"]);
const tokens = (text: string | null | undefined) => (text ?? "").split(/[,،;]/).map((t) => t.trim()).filter(Boolean);
const norm = (t: string) => t.normalize("NFKC").trim().toLowerCase();

export interface ProjectView {
  key: string;
  found: boolean;
  identity: { id: string; name: string; status: string | null; projectType: string | null; businessType: string | null; artistText: string | null; deadline: string | null; daysToDeadline: number | null;
    startDate: string | null; endDate: string | null; parentProject: Link<string> | null; hidden: boolean | null; daysSinceUpdate: number | null; plannedHours: number | null; plannedDays: number | null } | null;
  people: { clients: Array<Link<{ key: string; name: string }>>; labelArtists: Array<Link<{ key: string; name: string }>>; victor: Link<{ works: number; ball: string[] }> | null;
    engineers: Array<Link<{ name: string; workType: string | null; status: string | null }>>; redFilms: Array<Link<{ productionTitle: string; crewKnown: false }>>; owner: Link<string> };
  money: ProjectMoney | null;
  moneyBrain: { receivables: Array<{ id: string; source: string; amount: number; currency: string; dueDate: string | null; collectible: boolean }>; credits: Array<{ amount: number; currency: string; kind: string }> } | null;
  work: {
    sessions: { total: number; upcoming: number; held: number; cancelled: number; next: string | null; last: string | null } | null;
    proposal: Link<{ title: string; status: string; amount: number; currency: string }> | null;
    tasksOpen: number | null; tasksOverdue: number | null;
    projectActions: { open: number; waitingFeedback: number; waitingVersion: number; followupOverdue: number } | null;
    meetings: { upcoming: number; total: number } | null;
    victor: Array<{ title: string; workState: string | null; ball: string; stuck: boolean; daysSinceSent: number | null }> | null;
    engineers: Array<{ engineer: string; workType: string | null; status: string | null; versions: number; openComments: number; finalFiles: number; internalDeadline: string | null; paid: boolean }> | null;
    redFilms: Array<{ title: string; type: string | null; status: string | null; shootDate: string | null; budgetPaid: number }> | null;
    clipPlanning: { rows: number; byCurrency: Record<string, number> } | null;
    social: { status: string | null; releaseDate: string | null } | null;
    release: { stage: string; targetDate: string | null; releasedAt: string | null; labelArtistKey: string | null } | null;
    albumTracks: { total: number; mixDone: number; masterDone: number } | null;
    delivery: { status: string | null; deliveredAt: string | null } | null;
  };
  ownerKnowledge: Array<{ kind: string; meaningHe: string; learnedAt: string }>;
  cases: Array<{ type: string; classification: string }>;
  actions: Array<{ type: string; state: string }>;
  signals: Signal[];
  certain: string[];
  inferred: string[];
  missing: string[];
}

export function buildProjectView(src: GatewaySources, projectId: string): ProjectView {
  const key = `project:${projectId}`;
  const st = ok(src.state);
  const fin = ok(src.finance);
  const ops = ok(src.operations) as OperationsRaw | null;
  const today = st?.todayIL ?? src.now.toISOString().slice(0, 10);
  const missing: string[] = [];
  const certain: string[] = [];
  const inferred: string[] = [];
  const signals: Signal[] = [];

  const idx = st?.domains.projects.data?.index[projectId] ?? null;
  const open = st?.domains.projects.data?.open.find((p) => p.id === projectId) ?? null;
  const meta = ops?.projectsMeta?.rows.find((p) => p.id === projectId) ?? null;
  const found = !!(idx || meta);
  if (!st) missing.push("מצב החברה לא נקרא — אין זהות פרויקט חיה.");
  if (!ops) missing.push("מקור התפעול לא נקרא (תאריכים, מהנדסים, Red Films, מסירה, פגישות…).");

  const status = idx?.status ?? meta?.status ?? null;
  const identity = found ? {
    id: projectId, name: idx?.name ?? meta?.name ?? "", status, projectType: open?.projectType ?? meta?.projectType ?? null, businessType: idx?.businessType ?? meta?.businessType ?? null,
    artistText: idx?.artistText ?? meta?.artistText ?? null, deadline: open?.deadline.ymd ?? meta?.deadline ?? null, daysToDeadline: open?.deadline.daysTo ?? null,
    startDate: meta?.startDate ?? null, endDate: meta?.endDate ?? null,
    parentProject: meta?.parentProject && meta.parentProject !== "ללא שיוך" ? { quality: "TEXT_MATCH" as Q, basis: "parent is stored as a project NAME", value: meta.parentProject } : null,
    hidden: meta ? meta.isHidden : null, daysSinceUpdate: open?.daysSinceUpdate ?? null, plannedHours: meta?.plannedHours ?? null, plannedDays: meta?.plannedDays ?? null,
  } : null;

  // ── people (never by similar-looking names; TEXT_MATCH is exact token equality, case-folded) ──
  const artistTokens = tokens(identity?.artistText).map(norm);
  const clients = (st?.domains.clients.data?.items ?? []).filter((c) => artistTokens.includes(norm(c.name)))
    .map((c) => ({ quality: "TEXT_MATCH" as Q, basis: "project artist text equals the client name", value: { key: `client:${c.id}`, name: c.name } }));
  const release = st?.domains.releasesFull.data?.items.find((r) => r.projectId === projectId) ?? null;
  const labelArtists = (st?.domains.labelArtists.data?.items ?? []).flatMap((a) => {
    if (release?.labelArtistId === a.id) return [{ quality: "CANONICAL_RELATION" as Q, basis: "release details link the project to this label artist", value: { key: `label-artist:${a.id}`, name: a.name } }];
    return artistTokens.includes(norm(a.name)) ? [{ quality: "TEXT_MATCH" as Q, basis: "project artist text equals the label-artist name", value: { key: `label-artist:${a.id}`, name: a.name } }] : [];
  });
  const victorWorks = st?.domains.victor.data?.active.filter((w) => w.projectId === projectId) ?? null;
  const engineerWorks = ops?.engineerWork?.rows.filter((w) => w.projectId === projectId) ?? null;
  const prods = ops?.redFilms?.rows.filter((p) => p.projectId === projectId) ?? null;

  // ── money ──
  const money = fin && found ? projectMoney(fin.raw, { id: projectId, status: status ?? "" }) : null;
  if (!fin) missing.push("מוח הכספים לא נקרא — אין חישוב כסף לפרויקט.");
  const moneyBrain = fin ? {
    receivables: fin.state.receivables.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, source: r.source, amount: r.amount, currency: r.currency, dueDate: r.dueDate, collectible: r.collection.state !== "NOT_COLLECTIBLE" })),
    credits: fin.state.credits.filter((c) => c.projectId === projectId).map((c) => ({ amount: c.amount, currency: c.currency, kind: c.kind })),
  } : null;

  // ── work graph (id links only) ──
  const sessions = st?.domains.sessions.data?.items.filter((s) => s.projectId === projectId) ?? null;
  const proposal = st?.domains.proposalsFull.data?.items.find((p) => p.linkedProjectId === projectId) ?? null;
  const tasks = st?.domains.tasksFull.data?.items.filter((t) => t.relatedType === "project" && t.relatedId === projectId && t.status === "פתוח") ?? null;
  const acts = ops?.projectActions?.rows.filter((a) => a.projectId === projectId) ?? null;
  const openActs = acts?.filter((a) => !["approved", "closed", "cancelled"].includes(a.status ?? "")) ?? null;
  const meetings = ops?.meetings?.rows.filter((m) => m.projectId === projectId) ?? null;
  const clipRows = ops?.clipItems?.rows.filter((c) => c.projectId === projectId && c.status !== "בוטל" && c.status !== "הועבר לכספים" && !c.hasTransaction) ?? null;
  const campaign = ops?.campaigns?.rows.find((c) => c.projectId === projectId) ?? null;
  const tracks = ops?.albumTracks?.rows.filter((t) => t.projectId === projectId) ?? null;
  const delivery = ops?.deliveries?.rows.find((d) => d.projectId === projectId) ?? null;
  const upcomingSessions = sessions?.filter((s) => s.dateYmd >= today && s.status === "מתוכנן") ?? [];
  const dated = [...(sessions ?? [])].sort((a, b) => a.dateYmd.localeCompare(b.dateYmd));

  // ── owner knowledge / cases / actions ──
  const kn = ok(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null;
  const ownerKnowledge = kn ? activeKnowledge(kn, today).filter((k) => k.identityKeys.includes(key) || k.subjectKey === key || Object.values(k.value).includes(key)).map((k) => ({ kind: k.kind, meaningHe: k.meaningHe, learnedAt: k.createdAt })) : [];
  const cases = (ok(src.cases) ?? []).filter((c) => c.subjectType === "project" && c.subjectId === projectId).map((c) => ({ type: c.caseType, classification: c.classification }));
  const actions = (ok(src.actions) ?? []).filter((a) => a.actionType === "UPDATE_PROJECT_DEADLINE" && a.projectId === projectId).map((a) => ({ type: a.actionType, state: a.state }));

  // ── signals: facts and derived signals, never a score ──
  if (identity) {
    certain.push(`סטטוס: ${status ?? "?"}; סוג עסקי שמור: ${identity.businessType ?? "?"}`);
    if (identity.deadline) certain.push(`דדליין: ${identity.deadline}`);
    const active = status ? !INACTIVE.has(status) : false;
    if (active && !identity.deadline) signals.push({ code: "NO_DEADLINE", kind: "CANONICAL_FACT", he: "לפרויקט פעיל אין דדליין." });
    if (active && identity.deadline && identity.deadline < today) signals.push({ code: "DEADLINE_PASSED", kind: "DERIVED_SIGNAL", he: `הדדליין עבר (${identity.deadline}). דדליין לבדו לא קובע דחיפות — איכות לפני מהירות.` });
    if (identity.daysSinceUpdate !== null && identity.daysSinceUpdate >= 30 && active) signals.push({ code: "STALE", kind: "DERIVED_SIGNAL", he: `לא עודכן ${identity.daysSinceUpdate} ימים — ישן זה לא דחוף; צריך הקשר מהבעלים.` });
    if (identity.businessType === "לקוח" && labelArtists.some((l) => l.quality === "TEXT_MATCH")) signals.push({ code: "LABEL_CLASSIFICATION_UNCLEAR", kind: "UNKNOWN", he: "הפרויקט שמור כ'לקוח' אבל האמן בשמו הוא אמן לייבל — הסיווג תלוי בהחלטת הבעלים." });
    if (identity.hidden) signals.push({ code: "HIDDEN_PROJECT", kind: "CANONICAL_FACT", he: "הפרויקט מוסתר — רוב המסכים לא מציגים אותו." });
  }
  if (money) {
    certain.push(`כסף: ${money.verdict}`);
    if (money.verdict === "DEBT") signals.push({ code: "OUTSTANDING_CLIENT_MONEY", kind: "DERIVED_SIGNAL", he: money.reasonsHe.join(" ") });
    if (money.verdict === "OVERPAYMENT") signals.push({ code: "OVERPAYMENT", kind: "DERIVED_SIGNAL", he: money.reasonsHe.join(" ") });
    if (money.verdict === "PRICE_UNKNOWN" && identity?.businessType !== "לייבל" && status !== "בוטל") signals.push({ code: "PRICE_UNKNOWN", kind: "CANONICAL_FACT", he: "אין מחיר מוסכם — אי אפשר לדעת חוב." });
  }
  if (engineerWorks?.some((w) => w.status === "חזר")) signals.push({ code: "ENGINEER_RETURNED_WORK", kind: "DERIVED_SIGNAL", he: "מהנדס החזיר עבודה — כנראה מחכה לתגובת הבעלים." });
  if (engineerWorks?.some((w) => w.status === "נשלח" || w.status === "בתהליך")) signals.push({ code: "AT_ENGINEER", kind: "CANONICAL_FACT", he: "יש עבודת מיקס/מאסטר פתוחה אצל מהנדס." });
  if (victorWorks?.some((w) => w.ball.holder === "owner")) signals.push({ code: "VICTOR_WAITING_OWNER", kind: "DERIVED_SIGNAL", he: "ויקטור מסר ואין תגובה מתועדת של הבעלים אחריו (לא מוכיח שלא טופל)." });
  if (victorWorks?.some((w) => w.ball.holder === "victor")) signals.push({ code: "AT_VICTOR", kind: "DERIVED_SIGNAL", he: "הכדור אצל ויקטור." });
  if (openActs?.some((a) => a.status === "pending_feedback")) signals.push({ code: "WAITING_FEEDBACK", kind: "CANONICAL_FACT", he: "נשלח משהו ומחכים לתגובה (מעקב שליחות)." });
  if (openActs?.some((a) => a.status === "pending_version")) signals.push({ code: "WAITING_VERSION", kind: "CANONICAL_FACT", he: "מחכים לגרסה חדשה (מעקב שליחות)." });
  if (status === "הושלם" && delivery && delivery.status !== "delivered") signals.push({ code: "COMPLETED_DELIVERY_OPEN", kind: "DERIVED_SIGNAL", he: `הושלם, סטטוס מסירה: ${delivery.status ?? "?"}.` });
  if (release && release.targetYmd && release.targetYmd < today && !release.releasedAt) signals.push({ code: "RELEASE_TARGET_PASSED", kind: "DERIVED_SIGNAL", he: "תאריך יעד הריליס עבר והוא לא יצא. ריליסים של הלייבל מוגנים (מדיניות בעלים)." });
  if (prods?.some((p) => !["פורסם", "בוטל"].includes(p.status ?? ""))) signals.push({ code: "CLIP_IN_PRODUCTION", kind: "CANONICAL_FACT", he: "יש הפקת קליפ/Red Films פעילה לפרויקט." });
  if (sessions && identity && !INACTIVE.has(status ?? "") && sessions.length === 0) signals.push({ code: "NO_SESSIONS", kind: "CANONICAL_FACT", he: "אין סשנים רשומים לפרויקט (ייתכן שהעבודה לא דורשת סשן)." });
  for (const k of ownerKnowledge) inferred.push(`ידע מהבעלים: ${k.meaningHe}`);
  if (clients.length) inferred.push("הקישור ללקוח הוא לפי שם בלבד (TEXT_MATCH).");
  if (!clients.length && identity?.artistText) missing.push("שם האמן בפרויקט לא תואם אף לקוח — אין קישור ללקוח.");
  missing.push("Google Calendar לא נקרא — אירועי יומן שאינם סשנים לא ידועים.", "תוכן הקבצים והתיקיות של הפרויקט לא נקראים (רק ספירות מהנדס/מסירה).", "צוות Red Films (צלם/במאי) לא נקרא.");

  return {
    key, found, identity,
    people: {
      clients, labelArtists,
      victor: victorWorks?.length ? { quality: "CANONICAL_RELATION", basis: "Victor work linked by project id", value: { works: victorWorks.length, ball: victorWorks.map((w) => w.ball.holder) } } : null,
      engineers: (engineerWorks ?? []).map((w) => ({ quality: "CANONICAL_RELATION" as Q, basis: "engineer work linked by project id (the engineer NAME is free text)", value: { name: w.engineerName, workType: w.workType, status: w.status } })),
      redFilms: (prods ?? []).map((p) => ({ quality: "CANONICAL_RELATION" as Q, basis: "production linked by project id", value: { productionTitle: p.title, crewKnown: false as const } })),
      owner: { quality: "CANONICAL_RELATION", basis: "the Owner runs every project", value: "OWNER" },
    },
    money, moneyBrain,
    work: {
      sessions: sessions ? { total: sessions.length, upcoming: upcomingSessions.length, held: sessions.filter((s) => s.status === "התקיים").length, cancelled: sessions.filter((s) => s.status === "בוטל").length, next: upcomingSessions.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd))[0]?.dateYmd ?? null, last: dated.filter((s) => s.dateYmd < today).at(-1)?.dateYmd ?? null } : null,
      proposal: proposal ? { quality: "CANONICAL_RELATION", basis: "proposal linked project id", value: { title: proposal.title, status: proposal.status, amount: proposal.amount, currency: proposal.currency } } : null,
      tasksOpen: tasks ? tasks.length : null, tasksOverdue: tasks ? tasks.filter((t) => t.dueYmd && t.dueYmd < today).length : null,
      projectActions: openActs ? { open: openActs.length, waitingFeedback: openActs.filter((a) => a.status === "pending_feedback").length, waitingVersion: openActs.filter((a) => a.status === "pending_version").length, followupOverdue: openActs.filter((a) => a.followupDate && a.followupDate < today).length } : null,
      meetings: meetings ? { upcoming: meetings.filter((m) => (m.date ?? "") >= today && m.status !== "בוטלה").length, total: meetings.length } : null,
      victor: victorWorks ? victorWorks.map((w) => ({ title: w.title, workState: w.workState, ball: w.ball.holder, stuck: w.isStuck, daysSinceSent: w.daysSinceSent })) : null,
      engineers: engineerWorks ? engineerWorks.map((w) => {
        const vs = ops?.mixVersions?.rows.filter((v) => v.workId === w.id) ?? [];
        const ids = new Set(vs.map((v) => v.id));
        return { engineer: w.engineerName, workType: w.workType, status: w.status, versions: vs.length, openComments: ops?.mixComments?.rows.filter((c) => c.versionId && ids.has(c.versionId) && c.status === "open").length ?? 0,
          finalFiles: ops?.finalFiles?.rows.filter((f) => f.workId === w.id).length ?? 0, internalDeadline: w.internalDeadline, paid: (w.agreedPrice ?? 0) > 0 && (w.amountPaid ?? 0) >= (w.agreedPrice ?? 0) && !!w.paymentDate };
      }) : null,
      redFilms: prods ? prods.map((p) => ({ title: p.title, type: p.productionType, status: p.status, shootDate: p.shootDate, budgetPaid: ops?.budgetPayments?.rows.filter((b) => b.productionId === p.id).reduce((s, b) => s + (b.amount ?? 0), 0) ?? 0 })) : null,
      clipPlanning: clipRows ? { rows: clipRows.length, byCurrency: clipRows.reduce<Record<string, number>>((m, c) => ({ ...m, [c.currency ?? "₪"]: (m[c.currency ?? "₪"] ?? 0) + (c.amount ?? 0) }), {}) } : null,
      social: campaign ? { status: campaign.status, releaseDate: campaign.releaseDate } : null,
      release: release ? { stage: release.stage, targetDate: release.targetYmd, releasedAt: release.releasedAt, labelArtistKey: release.labelArtistId ? `label-artist:${release.labelArtistId}` : null } : null,
      albumTracks: tracks && tracks.length ? { total: tracks.length, mixDone: tracks.filter((t) => t.mixStatus === "הושלם").length, masterDone: tracks.filter((t) => t.masterStatus === "הושלם").length } : null,
      delivery: delivery ? { status: delivery.status, deliveredAt: delivery.deliveredAt } : null,
    },
    ownerKnowledge, cases, actions, signals, certain, inferred, missing,
  };
}

/** Portfolio facts for open projects — NO score, NO ranking (sorted by deadline, then name). */
export function projectPortfolio(src: GatewaySources) {
  const st = ok(src.state);
  const open = st?.domains.projects.data?.open ?? [];
  return open.filter((p) => !CLOSED.has(p.status)).map((p) => {
    const v = buildProjectView(src, p.id);
    return { id: p.id, name: p.name, status: p.status, businessType: p.businessType, deadline: p.deadline.ymd, verdict: v.money?.verdict ?? null, signals: v.signals.map((s) => s.code) };
  }).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.name.localeCompare(b.name));
}
