/**
 * Redbloods Partner — Gateway V1: entity views (partner_entity). Pure, deterministic.
 *
 * Project / Client / Label Artist reuse the existing Eyes dossiers (lib/partner/dossiers) verbatim and add
 * Finance Brain, Cases, Organizational Memory and the Action surface. Victor, Steven, Victor salary periods,
 * DJs, shows, sessions and releases are new READ-ONLY compositions of the same shared state — no new reads,
 * no finance rules, no memory of their own. Every relation keeps its quality (ID / TEXT_MATCH / DERIVED /
 * UNKNOWN); a TEXT_MATCH is never presented as a link.
 */
import { buildClientDossier } from "../dossiers/client";
import { buildLabelArtistDossier } from "../dossiers/labelArtist";
import { buildProjectDossier } from "../dossiers/project";
import type { PartnerCompanyState, SessionSummary, ShowSummary } from "../eyes/types";
import { salaryLinkedId, salaryMonthLabel } from "../../victor-salary-format";
import { envelope, ok, partner, record, heDate, type GatewaySources } from "./core";
import { drill, fact, finishEntity, type EntityDraft } from "./entity-common";
import { normalizeName } from "./resolve";
import { type EntityResponse, type GatewayEntityType, type GatewayFact, type GatewayRelationship } from "./types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^(project|client|label-artist|dj|show|session|release):(${UUID})$`);
const PERIOD_RE = /^recurring:VICTOR_SALARY:(\d{4}-(?:0[1-9]|1[0-2]))$/;

export function parseEntityKey(key: string): { type: GatewayEntityType; id: string } | null {
  const m = KEY_RE.exec(key);
  if (m) return { type: m[1] as GatewayEntityType, id: m[2] };
  if (key === "vendor:VICTOR" || key === "vendor:STEVEN") return { type: "vendor", id: key.slice(7) };
  const p = PERIOD_RE.exec(key);
  if (p) return { type: "recurring", id: p[1] };
  return null;
}

const rel = (from: string, relation: GatewayRelationship["relation"], to: string | null, toLabel: string | null, quality: GatewayRelationship["quality"], source: GatewayRelationship["source"], note?: string): GatewayRelationship =>
  ({ from, relation, to, toLabel: toLabel === null ? null : record(toLabel), quality, source, ...(note ? { note: partner(note) } : {}) });

function clientName(state: PartnerCompanyState, id: string | null): string | null {
  return id ? state.domains.clients.data?.items.find((c) => c.id === id)?.name ?? null : null;
}
function projectName(state: PartnerCompanyState, id: string): string {
  return state.domains.projects.data?.index[id]?.name ?? id;
}
function financeByCurrency(agg: { byCurrency: Array<{ currency: string; agreedPriceSum: number; receivedSum: number; balanceSum: number; projectCount: number }>; projectsWithUnknownFinance: number; relationQuality: string }) {
  return { byCurrency: agg.byCurrency.map((c) => ({ currency: c.currency, agreed: c.agreedPriceSum, received: c.receivedSum, balance: c.balanceSum, projects: c.projectCount })), projectsWithUnknownFinance: agg.projectsWithUnknownFinance, relationQuality: agg.relationQuality };
}

// ── project ──────────────────────────────────────────────────────────────────

function projectDraft(src: GatewaySources, state: PartnerCompanyState, id: string): EntityDraft | null {
  const r = buildProjectDossier(state, id);
  if (!r.ok) return null;
  const d = r.dossier;
  const key = `project:${id}`;
  const facts: GatewayFact[] = [
    fact("PROJECT_STATUS", "סטטוס", d.identity.status, "FACT", "PROJECTS"),
    fact("PROJECT_ARTIST_TEXT", "אמן/לקוח כפי שנרשם בפרויקט (טקסט חופשי)", record(d.identity.artistText), "FACT", "PROJECTS"),
    fact("BUSINESS_TYPE", "סוג עסקי", d.identity.businessType, "FACT", "PROJECTS"),
  ];
  const missing: EntityDraft["missing"] = [];
  if (d.identity.identitySource === "OPEN_SET") {
    facts.push(fact("PROJECT_DEADLINE", "דדליין", d.identity.deadline?.ymd ?? null, d.identity.deadline?.ymd ? "FACT" : "UNKNOWN", "PROJECTS"));
    if (d.identity.projectType) facts.push(fact("PROJECT_TYPE", "סוג פרויקט", d.identity.projectType, "FACT", "PROJECTS"));
  } else missing.push({ fact: "deadline / project type", whyNeeded: "closed projects keep only name, status and artist in the company state" });

  // finance: the Finance Brain (with Owner overlays) wins; the Eyes aggregate is shown as raw derived data
  const f = ok(src.finance);
  const rec = f?.state.receivables.find((x) => x.projectId === id && x.source === "PROJECT_BALANCE") ?? null;
  const profile = f?.integrity.projects.find((p) => p.projectId === id) ?? null;
  if (rec) facts.push(fact("RECEIVABLE", "יתרה לגבייה (לפי Finance Brain)", { amount: rec.amount, currency: rec.currency, collectionState: rec.collection.state, dueDate: rec.dueDate, ownerClosure: rec.ownerClosure ? { answerCode: rec.ownerClosure.answerCode, reconciliation: rec.ownerClosure.reconciliation } : null }, rec.ownerClosure ? "OWNER_DECISION" : "DERIVED", "FINANCE"));
  if (profile) facts.push(fact("FINANCE_COVERAGE", "כיסוי נתוני כספים לפרויקט", { price: profile.price, income: profile.income, expenses: profile.expenses, receivable: profile.receivable, dueDate: profile.dueDate }, "DERIVED", "FINANCE"));
  facts.push(fact("PROJECT_PRICE", "מחיר מוסכם", d.finance.agreedPrice === null ? null : { amount: d.finance.agreedPrice, currency: d.finance.currency }, d.finance.agreedPrice === null ? "UNKNOWN" : "FACT", "FINANCE"));
  if (d.finance.receivedIncome !== null) facts.push(fact("RECEIVED_INCOME", "הכנסה שהתקבלה", { amount: d.finance.receivedIncome, currency: d.finance.currency }, "DERIVED", "FINANCE"));
  if (!f) missing.push({ fact: "Finance Brain view", whyNeeded: "finance could not be read; receivable / Owner closure unknown" });
  if (d.finance.agreedPrice === null) missing.push({ fact: "agreed price", whyNeeded: "needed to know what the client owes" });

  // sessions / release / label artist / client / team / tasks / clips / proposals
  facts.push(fact("SESSIONS", "סשנים", { count: d.sessions.count, first: d.sessions.firstSessionDate, latest: d.sessions.latestSessionDate, next: d.sessions.nextSessionDate }, "DERIVED", "SESSIONS"));
  const rels: GatewayRelationship[] = [];
  for (const s of d.sessions.items) rels.push(rel(key, "PROJECT_HAS_SESSION", `session:${s.id}`, `${heDate(s.dateYmd)} · ${s.sessionType} · ${s.status}`, "ID", "SESSIONS"));
  if (d.release.status === "FOUND") {
    const row = d.release.rows[0];
    facts.push(fact("RELEASE", "שחרור", { stage: row.stage, targetDate: row.targetYmd, releasedAt: row.releasedAt }, "FACT", "RELEASES"));
    rels.push(rel(key, "PROJECT_HAS_RELEASE", `release:${id}`, row.stage, "ID", "RELEASES"));
  } else if (d.release.status === "NO_RELEASE_ROW" && d.identity.businessType === "לייבל") missing.push({ fact: "release plan", whyNeeded: "no release record exists for this label project — the release decision is UNKNOWN" });
  if (d.labelArtist.idCandidate) rels.push(rel(key, "RELEASE_OF_LABEL_ARTIST", `label-artist:${d.labelArtist.idCandidate.id}`, d.labelArtist.idCandidate.name, "ID", "RELEASES"));
  for (const a of d.labelArtist.textCandidates.filter((a) => a.id !== d.labelArtist.idCandidate?.id)) rels.push(rel(`label-artist:${a.id}`, "LABEL_ARTIST_HAS_PROJECT", key, d.identity.name, "TEXT_MATCH", "LABEL_ARTISTS", d.labelArtist.status === "AMBIGUOUS_TEXT_MATCH" ? "שם האמן בפרויקט מתאים ליותר מאמן לייבל אחד" : "התאמת שם בלבד"));
  for (const c of d.client.candidates) rels.push(rel(key, "PROJECT_ARTIST_IS_CLIENT", `client:${c.id}`, c.name, "TEXT_MATCH", "CLIENTS", d.client.status === "AMBIGUOUS" ? "כמה לקוחות עם אותו שם — לא נבחר אחד" : "התאמת שם בלבד — אין מזהה לקוח בפרויקט"));
  for (const w of d.victor.linkedWorks) rels.push(rel(key, "PROJECT_HAS_VICTOR_WORK", "vendor:VICTOR", `${w.title} · ${w.workState ?? "—"}`, "ID", "TEAM_VICTOR"));
  for (const w of d.steven.linkedWorks) rels.push(rel(key, "PROJECT_HAS_STEVEN_WORK", "vendor:STEVEN", `${w.title} · ${w.uiStatus}`, "ID", "TEAM_STEVEN"));
  for (const p of d.proposals.items) rels.push(rel(key, "PROJECT_HAS_PROPOSAL", p.clientId ? `client:${p.clientId}` : null, `${p.title} · ${p.status}`, "ID", "PROPOSALS"));
  for (const c of d.clips.linked) rels.push(rel(key, "PROJECT_HAS_CLIP", null, `${c.title} · ${c.status}`, "ID", "CLIPS"));
  for (const c of d.clips.unlinkedCandidates) rels.push(rel(key, "PROJECT_HAS_CLIP", null, `${c.title} · ${c.status}`, "TEXT_MATCH", "CLIPS", "קליפ ללא קישור לפרויקט — התאמת שם אמן בלבד"));
  if (d.tasks.count) facts.push(fact("OPEN_TASKS", "משימות פתוחות", d.tasks.items.slice(0, 5).map((t) => ({ title: record(t.title), due: t.dueYmd })), "FACT", "TASKS"));
  const txs = d.finance.transactionDetail;
  if (txs !== "NOT_AVAILABLE_IN_EYES") for (const t of [...txs.incomeTransactions, ...txs.expenseTransactions]) rels.push(rel(key, "PROJECT_HAS_TRANSACTION", null, `${t.type} · ${t.currency}${t.amount} · ${t.status} · ${heDate(t.dateYmd) ?? "—"}`, "ID", "FINANCE"));
  missing.push({ fact: "show relation", whyNeeded: "shows are not linked to projects in the data" });
  for (const c of d.dataQuality.conflicts) facts.push(fact(`DATA_CONFLICT:${c.code}`, "סתירה בנתונים", partner(c.description), "UNKNOWN", "PROJECTS"));
  return {
    entity: { key, type: "project", label: record(d.identity.name) }, facts, relationships: rels, missing,
    drillDown: [...(d.release.status === "FOUND" ? [drill(`release:${id}`, "פתח את השחרור")] : []), ...(d.labelArtist.idCandidate ? [drill(`label-artist:${d.labelArtist.idCandidate.id}`, `פתח את ${d.labelArtist.idCandidate.name}`)] : [])],
    scopeKeys: [key], caseIds: new Set([id]), patternFamily: () => false,
  };
}

// ── client ───────────────────────────────────────────────────────────────────

function clientDraft(state: PartnerCompanyState, id: string): EntityDraft | null {
  const r = buildClientDossier(state, id);
  if (!r.ok) return null;
  const d = r.dossier;
  const key = `client:${id}`;
  const rels: GatewayRelationship[] = [];
  for (const p of d.matchedProjects) rels.push(rel(key, "CLIENT_HAS_PROJECT", `project:${p.projectId}`, `${p.name} · ${p.status}`, "TEXT_MATCH", "PROJECTS", "אין מזהה לקוח בפרויקט — התאמת שם בלבד"));
  for (const p of d.ambiguousProjectCandidates) rels.push(rel(key, "CLIENT_HAS_PROJECT", `project:${p.projectId}`, `${p.name} · ${p.status}`, "UNKNOWN", "PROJECTS", "השם מתאים ליותר מלקוח אחד — לא שויך"));
  for (const p of d.proposals.items) rels.push(rel(key, "CLIENT_HAS_PROPOSAL", null, `${p.title} · ${p.status} · ${p.currency}${p.amount}`, "ID", "PROPOSALS"));
  for (const p of d.proposals.legacyTextMatched) rels.push(rel(key, "CLIENT_HAS_PROPOSAL", null, `${p.title} · ${p.status}`, "TEXT_MATCH", "PROPOSALS", "הצעה ישנה ללא מזהה לקוח"));
  for (const [items, relation] of [[d.performerShows.items, "SHOW_HAS_ARTIST"], [d.bookerShows.items, "SHOW_HAS_BOOKER"], [d.djShows.items, "SHOW_HAS_DJ"]] as const) {
    for (const s of items) rels.push(rel(`show:${s.id}`, relation, key, `${s.name} · ${heDate(s.dateYmd) ?? "—"} · ${s.status}`, "ID", "SHOWS"));
  }
  return {
    entity: { key, type: "client", label: record(d.identity.name) },
    facts: [
      fact("CLIENT_TYPE", "סוג", d.identity.type, "FACT", "CLIENTS"),
      fact("CLIENT_STATUS", "סטטוס", d.identity.status, "FACT", "CLIENTS"),
      fact("PROJECT_FINANCE_BY_CURRENCY", "כספי פרויקטים (לפי התאמת שם — לא מזהה)", financeByCurrency(d.finance), "DERIVED", "FINANCE"),
      fact("SESSIONS", "סשנים בפרויקטים שלו", { count: d.sessions.count, first: d.sessions.firstSessionDate, latest: d.sessions.latestSessionDate }, "DERIVED", "SESSIONS"),
    ],
    relationships: rels,
    missing: [{ fact: "client ↔ project id", whyNeeded: "projects relate to clients by name only; totals built on it are TEXT_MATCH quality" }],
    drillDown: d.djShows.items.length ? [drill(`dj:${id}`, "פתח כ־DJ")] : [],
    scopeKeys: [key], caseIds: new Set([id, ...d.proposals.items.map((p) => p.id)]), patternFamily: () => false,
  };
}

// ── label artist ─────────────────────────────────────────────────────────────

function labelArtistDraft(src: GatewaySources, state: PartnerCompanyState, id: string): EntityDraft | null {
  const r = buildLabelArtistDossier(state, id);
  if (!r.ok) return null;
  const d = r.dossier;
  const key = `label-artist:${id}`;
  const rels: GatewayRelationship[] = [];
  const idProjects = new Set(d.projects.idLinked.map((p) => p.projectId));
  const textProjects = new Set(d.projects.textMatched.map((p) => p.projectId));
  for (const p of d.projects.idLinked) rels.push(rel(key, "LABEL_ARTIST_HAS_PROJECT", `project:${p.projectId}`, `${p.name} · ${p.status}`, "ID", "RELEASES"));
  for (const p of d.projects.textMatched) rels.push(rel(key, "LABEL_ARTIST_HAS_PROJECT", `project:${p.projectId}`, `${p.name} · ${p.status}`, "TEXT_MATCH", "PROJECTS", "התאמת שם אמן בלבד"));
  for (const p of d.projects.ambiguousTextMatched) rels.push(rel(key, "LABEL_ARTIST_HAS_PROJECT", `project:${p.projectId}`, `${p.name} · ${p.status}`, "UNKNOWN", "PROJECTS", "השם מתאים ליותר מאמן לייבל אחד"));
  // the same person as a client: exact same name (TEXT_MATCH) or the app's canonical link (DERIVED)
  const cleantone = src.identities.cleantone;
  const clients = state.domains.clients.data?.items ?? [];
  const personClients = clients.filter((c) => normalizeName(c.name) === normalizeName(d.identity.name));
  const appClient = cleantone && d.identity.name === cleantone.labelArtistName ? clients.find((c) => c.id === cleantone.clientId) ?? null : null;
  for (const c of personClients) rels.push(rel(key, "LABEL_ARTIST_IS_CLIENT", `client:${c.id}`, c.name, "TEXT_MATCH", "CLIENTS", "אותו שם בדיוק — לא קישור במזהה"));
  if (appClient) rels.push(rel(key, "DJ_IS_LABEL_ARTIST", `dj:${appClient.id}`, appClient.name, "DERIVED", "APP_IDENTITY", "קישור קבוע בקוד האפליקציה (פורטל ה־DJ)"));
  const shows = state.domains.shows.data?.items ?? [];
  const viaName = new Set(personClients.map((c) => c.id));
  for (const s of shows) {
    if (s.artistClientId && viaName.has(s.artistClientId)) rels.push(rel(`show:${s.id}`, "SHOW_HAS_ARTIST", key, `${s.name} · ${heDate(s.dateYmd) ?? "—"} · ${s.status}`, "TEXT_MATCH", "SHOWS", "דרך לקוח באותו שם"));
    if (appClient && s.djClientId === appClient.id) rels.push(rel(`show:${s.id}`, "SHOW_HAS_DJ", key, `${s.name} · ${heDate(s.dateYmd) ?? "—"} · ${s.status}`, "DERIVED", "SHOWS", "דרך הקישור הקבוע של ה־DJ"));
  }
  const victor = state.domains.victor.data?.active ?? [];
  const steven = state.domains.steven.data?.open ?? [];
  for (const w of victor.filter((w) => w.projectId && (idProjects.has(w.projectId) || textProjects.has(w.projectId)))) rels.push(rel(`project:${w.projectId}`, "PROJECT_HAS_VICTOR_WORK", "vendor:VICTOR", `${w.title} · ${w.workState ?? "—"}`, idProjects.has(w.projectId!) ? "ID" : "TEXT_MATCH", "TEAM_VICTOR"));
  for (const w of steven.filter((w) => w.projectId && (idProjects.has(w.projectId) || textProjects.has(w.projectId)))) rels.push(rel(`project:${w.projectId}`, "PROJECT_HAS_STEVEN_WORK", "vendor:STEVEN", `${w.title} · ${w.uiStatus}`, idProjects.has(w.projectId!) ? "ID" : "TEXT_MATCH", "TEAM_STEVEN"));
  const facts: GatewayFact[] = [
    fact("LABEL_ARTIST_STATUS", "סטטוס", d.identity.status, "FACT", "LABEL_ARTISTS"),
    fact("RELEASES", "שחרורים", d.releases.rows.map((x) => ({ project: `project:${x.projectId}`, stage: x.stage, targetDate: x.targetYmd, releasedAt: x.releasedAt })), "FACT", "RELEASES"),
    fact("SESSIONS", "סשנים", { viaIdLinkedProjects: d.sessions.viaIdLinkedProjects.count, viaTextMatchedProjects: d.sessions.viaTextMatchedProjects.count }, "DERIVED", "SESSIONS"),
    fact("PROJECT_FINANCE_ID_LINKED", "כספי פרויקטים מקושרים במזהה", financeByCurrency(d.finance.viaIdLinkedProjects), "DERIVED", "FINANCE"),
    fact("PROJECT_FINANCE_TEXT_MATCHED", "כספי פרויקטים לפי התאמת שם", financeByCurrency(d.finance.viaTextMatchedProjects), "DERIVED", "FINANCE"),
    fact("ARTIST_LEDGER", "יומן יתרת אמן", d.balanceLedger.hasEntries ? { entries: d.balanceLedger.entryCount, totals: d.balanceLedger.totals, currency: null } : null, d.balanceLedger.hasEntries ? "FACT" : "UNKNOWN", "LABEL_ARTISTS"),
  ];
  const missing: EntityDraft["missing"] = [];
  if (d.balanceLedger.hasEntries) missing.push({ fact: "ledger currency", whyNeeded: "the artist ledger has no currency column — totals are one implicit ledger, never assumed ₪" });
  if (!d.releases.rows.length) missing.push({ fact: "release plan", whyNeeded: "no release record exists for this artist — the release decision is UNKNOWN" });
  if (!personClients.length && !appClient) missing.push({ fact: "shows", whyNeeded: "shows link to clients, and no client record matches this artist" });
  return {
    entity: { key, type: "label-artist", label: record(d.identity.name) }, facts, relationships: rels, missing,
    drillDown: [...d.projects.idLinked.map((p) => drill(`project:${p.projectId}`, p.name)), ...(appClient ? [drill(`dj:${appClient.id}`, "פתח כ־DJ")] : [])].slice(0, 8),
    scopeKeys: [key, ...[...idProjects].map((p) => `project:${p}`)], caseIds: new Set([id]), patternFamily: () => false,
  };
}

// ── Victor / Victor salary period / Steven ───────────────────────────────────

function victorDraft(src: GatewaySources, state: PartnerCompanyState | null): EntityDraft {
  const key = "vendor:VICTOR";
  const v = state?.domains.victor.data ?? null;
  const f = ok(src.finance);
  const facts: GatewayFact[] = [];
  const rels: GatewayRelationship[] = [];
  const missing: EntityDraft["missing"] = [];
  if (v) {
    facts.push(fact("VICTOR_WORKS", "עבודות", { total: v.totalWorks, active: v.active.length, linkedToProject: v.linkedActive, ballCounts: v.ballCounts, waitingForOwner: v.ownerQueue.count }, "DERIVED", "TEAM_VICTOR"));
    for (const w of v.active) rels.push(rel(key, "PROJECT_HAS_VICTOR_WORK", w.projectId ? `project:${w.projectId}` : null, `${w.title} · ${w.workState ?? "—"} · ${w.ball.holder === "owner" ? "ממתין לך" : w.ball.holder === "victor" ? "אצל Victor" : "לא ידוע"}`, w.projectId ? "ID" : "UNKNOWN", "TEAM_VICTOR"));
    missing.push({ fact: "closed Victor work history", whyNeeded: "only active works are detailed in the company state" });
  } else missing.push({ fact: "Victor works", whyNeeded: "team data could not be read" });
  const periods: string[] = [];
  if (f) {
    const months = (f.raw.victorSalary ?? []).filter((s) => s.dueDate <= src.now.toISOString().slice(0, 10) || s.workMonth === src.now.toISOString().slice(0, 7));
    const known = new Map(f.state.recurring.known.map((k) => [k.workMonth, k.state]));
    facts.push(fact("SALARY_PERIODS", "משכורות (חודשים שכבר הגיע מועדם)", months.map((s) => ({
      period: s.workMonth, amount: s.amount, currency: s.currency, dueDate: s.dueDate, salaryPageStatus: s.status,
      financeRecord: f.raw.transactions.some((t) => t.linkedSessionId === salaryLinkedId(s.workMonth)), financeState: known.get(s.workMonth) ?? null,
    })), "FACT", "FINANCE"));
    for (const s of months) { periods.push(s.workMonth); rels.push(rel(key, "VENDOR_HAS_SALARY_PERIOD", `recurring:VICTOR_SALARY:${s.workMonth}`, `משכורת ${salaryMonthLabel(s.workMonth)}`, "ID", "FINANCE")); }
    const current = (f.raw.victorSalary ?? []).find((s) => s.workMonth === src.now.toISOString().slice(0, 7));
    if (current) facts.push(fact("SALARY_CONFIGURED", "משכורת מוגדרת לחודש הנוכחי", { amount: current.amount, currency: current.currency }, "FACT", "FINANCE"));
    missing.push({ fact: "salary periods before this year", whyNeeded: "the salary page is read for the current year only" });
  } else missing.push({ fact: "salary / finance", whyNeeded: "finance could not be read" });
  return {
    entity: { key, type: "vendor", label: record("Victor") }, facts, relationships: rels, missing,
    drillDown: periods.slice(-4).reverse().map((p) => drill(`recurring:VICTOR_SALARY:${p}`, `משכורת ${salaryMonthLabel(p)}`)),
    scopeKeys: [key, "recurring:VICTOR_SALARY", ...periods.map((p) => `recurring:VICTOR_SALARY:${p}`)], caseIds: new Set(), patternFamily: (fam) => fam === "recurring:VICTOR_SALARY",
  };
}

function periodDraft(src: GatewaySources, period: string): EntityDraft | null {
  const key = `recurring:VICTOR_SALARY:${period}`;
  const f = ok(src.finance);
  const memory = ok(src.memory);
  const row = f?.raw.victorSalary?.find((s) => s.workMonth === period) ?? null;
  const inMemory = !!memory?.entities.some((m) => m.entity.key === key);
  if (!row && !inMemory) return null;
  const facts: GatewayFact[] = [];
  const rels: GatewayRelationship[] = [rel(key, "VENDOR_HAS_SALARY_PERIOD", "vendor:VICTOR", "Victor", "ID", "FINANCE")];
  const missing: EntityDraft["missing"] = [];
  if (row) facts.push(fact("SALARY_PERIOD", "משכורת לחודש", { period, amount: row.amount, currency: row.currency, dueDate: row.dueDate, salaryPageStatus: row.status }, "FACT", "FINANCE"));
  if (f) {
    const txs = f.raw.transactions.filter((t) => t.linkedSessionId === salaryLinkedId(period));
    facts.push(fact("FINANCE_RECORD", "רישום בכספים", { present: txs.length > 0, records: txs.map((t) => ({ amount: t.amount, currency: t.currency, date: t.date, status: t.status, type: t.type })) }, "FACT", "FINANCE"));
    for (const t of txs) rels.push(rel(key, "SALARY_PERIOD_HAS_TRANSACTION", null, `${t.currency}${t.amount} · ${t.status} · ${heDate(t.date) ?? "—"}`, "ID", "FINANCE"));
    const known = f.state.recurring.known.find((k) => k.workMonth === period);
    if (known) facts.push(fact("FINANCE_STATE", "מצב לפי Finance Brain", known.state, "DERIVED", "FINANCE"));
  } else missing.push({ fact: "finance record", whyNeeded: "finance could not be read — whether the salary is recorded is UNKNOWN" });
  return {
    entity: { key, type: "recurring", label: record(`משכורת Victor — ${salaryMonthLabel(period)}`) }, facts, relationships: rels, missing,
    drillDown: [drill("vendor:VICTOR", "פתח את Victor")], scopeKeys: [key], caseIds: new Set(), patternFamily: (fam) => fam === "recurring:VICTOR_SALARY",
  };
}

function stevenDraft(src: GatewaySources, state: PartnerCompanyState | null): EntityDraft {
  const key = "vendor:STEVEN";
  const s = state?.domains.steven.data ?? null;
  const f = ok(src.finance);
  const facts: GatewayFact[] = [];
  const rels: GatewayRelationship[] = [];
  const missing: EntityDraft["missing"] = [{ fact: "closed Steven work history", whyNeeded: "only open works are detailed in the company state" }, { fact: "performance assessment", whyNeeded: "Partner does not derive performance conclusions from this data" }];
  if (s) {
    facts.push(fact("STEVEN_WORKS", "עבודות", { total: s.totalWorks, open: s.open.length, linkedToProject: s.linkedOpen, approvedUnpaid: s.approvedUnpaid.works.length }, "DERIVED", "TEAM_STEVEN"));
    facts.push(fact("STEVEN_APPROVED_UNPAID", "אושר ועדיין לא שולם (לפי מטבע)", s.approvedUnpaid.byCurrency, "DERIVED", "TEAM_STEVEN"));
    for (const w of s.open) rels.push(rel(key, "PROJECT_HAS_STEVEN_WORK", w.projectId ? `project:${w.projectId}` : null, `${w.title} · ${w.uiStatus} · ${w.currency}${w.agreedPrice} (שולם ${w.currency}${w.amountPaid})${w.internalDeadline ? ` · יעד ${heDate(w.internalDeadline)}` : ""}`, w.projectId ? "ID" : "UNKNOWN", "TEAM_STEVEN"));
  } else missing.push({ fact: "Steven works", whyNeeded: "team data could not be read" });
  if (f) {
    const open = f.state.openExpenses.items.filter((x) => x.source === "ENGINEER_WORK");
    const byCur: Record<string, number> = {};
    for (const x of open) byCur[x.currency] = (byCur[x.currency] ?? 0) + x.amount;
    facts.push(fact("STEVEN_OPEN_OBLIGATIONS", "התחייבויות פתוחות לפי Finance Brain", { count: open.length, byCurrency: byCur }, "DERIVED", "FINANCE"));
  }
  return { entity: { key, type: "vendor", label: record("Steven") }, facts, relationships: rels, missing, drillDown: [], scopeKeys: [key], caseIds: new Set((s?.open ?? []).map((w) => w.id)), patternFamily: () => false };
}

// ── DJ / show / session / release ────────────────────────────────────────────

function djDraft(src: GatewaySources, state: PartnerCompanyState, id: string): EntityDraft | null {
  const client = state.domains.clients.data?.items.find((c) => c.id === id);
  const shows = (state.domains.shows.data?.items ?? []).filter((s) => s.djClientId === id);
  if (!client || !shows.length) return null;
  const key = `dj:${id}`;
  const today = state.todayIL;
  const byConfirmation: Record<string, number> = {};
  for (const s of shows) byConfirmation[s.djConfirmationStatus ?? "UNKNOWN"] = (byConfirmation[s.djConfirmationStatus ?? "UNKNOWN"] ?? 0) + 1;
  const upcoming = shows.filter((s) => (s.dateYmd ?? "") >= today && s.status !== "בוטל");
  const rels: GatewayRelationship[] = shows
    .sort((a, b) => (b.dateYmd ?? "").localeCompare(a.dateYmd ?? "") || a.id.localeCompare(b.id))
    .map((s) => rel(`show:${s.id}`, "SHOW_HAS_DJ", key, `${s.name} · ${heDate(s.dateYmd) ?? "—"} · ${s.status} · אישור DJ: ${s.djConfirmationStatus ?? "—"}`, "ID", "SHOWS"));
  const artistIds = [...new Set(shows.map((s) => s.artistClientId).filter((x): x is string => !!x))];
  for (const a of artistIds) rels.push(rel(key, "SHOW_HAS_ARTIST", `client:${a}`, clientName(state, a), "ID", "SHOWS", "אמן בהופעות שה־DJ ניגן בהן"));
  const cleantone = src.identities.cleantone;
  const artist = cleantone && cleantone.clientId === id ? state.domains.labelArtists.data?.items.find((a) => a.name === cleantone.labelArtistName) ?? null : null;
  if (artist) rels.push(rel(key, "DJ_IS_LABEL_ARTIST", `label-artist:${artist.id}`, artist.name, "DERIVED", "APP_IDENTITY", "קישור קבוע בקוד האפליקציה (פורטל ה־DJ)"));
  return {
    entity: { key, type: "dj", label: record(artist ? `${artist.name} (${client.name})` : client.name) },
    facts: [
      fact("DJ_SHOWS", "הופעות כ־DJ", { total: shows.length, upcoming: upcoming.length, cancelled: shows.filter((s) => s.status === "בוטל").length, byConfirmation }, "DERIVED", "SHOWS"),
      fact("CLIENT_PAYMENT_BY_SHOW", "תשלום הלקוח בהופעות (לא תשלום ל־DJ)", shows.map((s) => ({ show: `show:${s.id}`, date: s.dateYmd, paymentStatus: s.paymentStatus })), "FACT", "SHOWS"),
    ],
    relationships: rels,
    missing: [
      { fact: "DJ fee / payout status", whyNeeded: "DJ fees and payouts are not exposed to Partner — needed to close a show financially from the DJ side" },
      ...(artist ? [] : [{ fact: "label-artist link", whyNeeded: "no canonical link between this DJ and a label artist" }]),
    ],
    drillDown: [...(artist ? [drill(`label-artist:${artist.id}`, `פתח את ${artist.name}`)] : []), drill(`client:${id}`, "פתח את כרטיס הלקוח"), ...upcoming.slice(0, 3).map((s) => drill(`show:${s.id}`, s.name))],
    scopeKeys: [key], caseIds: new Set([id, ...shows.map((s) => s.id)]), patternFamily: () => false,
  };
}

function showDraft(src: GatewaySources, state: PartnerCompanyState, id: string): EntityDraft | null {
  const s: ShowSummary | undefined = state.domains.shows.data?.items.find((x) => x.id === id);
  if (!s) return null;
  const key = `show:${id}`;
  const rels: GatewayRelationship[] = [];
  if (s.djClientId) rels.push(rel(key, "SHOW_HAS_DJ", `dj:${s.djClientId}`, clientName(state, s.djClientId), "ID", "SHOWS"));
  if (s.artistClientId) rels.push(rel(key, "SHOW_HAS_ARTIST", `client:${s.artistClientId}`, clientName(state, s.artistClientId), "ID", "SHOWS"));
  if (s.bookerClientId) rels.push(rel(key, "SHOW_HAS_BOOKER", `client:${s.bookerClientId}`, clientName(state, s.bookerClientId), "ID", "SHOWS"));
  for (const x of (state.domains.sessions.data?.items ?? []).filter((x) => x.showId === id)) rels.push(rel(key, "SHOW_HAS_SESSION", `session:${x.id}`, `${heDate(x.dateYmd)} · ${x.sessionType}`, "ID", "SESSIONS"));
  const f = ok(src.finance);
  const payouts = (f?.state.openExpenses.items ?? []).filter((x) => x.source === "SHOW_PAYOUT" && x.evidence.some((e) => e.sourceType === "show" && e.sourceId === id));
  const missing: EntityDraft["missing"] = [
    { fact: "price currency", whyNeeded: "the show price is read without its currency" },
    { fact: "calendar event", whyNeeded: "no canonical link from a show to a calendar event is read by Partner" },
  ];
  if (!s.artistClientId) missing.push({ fact: "artist", whyNeeded: "no performing artist is recorded on the show" });
  if (!s.bookerClientId) missing.push({ fact: "booker / client", whyNeeded: "no booker is recorded — who pays is unknown" });
  return {
    entity: { key, type: "show", label: record(s.name) },
    facts: [
      fact("SHOW_DATE", "תאריך", s.dateYmd, s.dateYmd ? "FACT" : "UNKNOWN", "SHOWS"),
      fact("SHOW_STATUS", "סטטוס", s.status, "FACT", "SHOWS"),
      fact("CLIENT_PAYMENT_STATUS", "תשלום הלקוח", s.paymentStatus, "FACT", "SHOWS"),
      fact("SHOW_PRICE", "מחיר ההופעה", s.price || null, s.price ? "FACT" : "UNKNOWN", "SHOWS"),
      fact("DJ_CONFIRMATION", "אישור DJ", s.djConfirmationStatus, s.djClientId ? "FACT" : "UNKNOWN", "SHOWS"),
      ...(f ? [fact("OPEN_SHOW_PAYOUTS", "תשלומים פתוחים מההופעה (לפי Finance Brain)", payouts.map((p) => ({ amount: p.amount, currency: p.currency, dueDate: p.dueDate })), "DERIVED", "FINANCE")] : []),
    ],
    relationships: rels, missing,
    drillDown: [...(s.djClientId ? [drill(`dj:${s.djClientId}`, "פתח את ה־DJ")] : []), ...(s.artistClientId ? [drill(`client:${s.artistClientId}`, "פתח את האמן")] : [])],
    scopeKeys: [key], caseIds: new Set([id]), patternFamily: () => false,
  };
}

function sessionDraft(state: PartnerCompanyState, id: string): EntityDraft | null {
  const s: SessionSummary | undefined = state.domains.sessions.data?.items.find((x) => x.id === id);
  if (!s) return null;
  const key = `session:${id}`;
  const rels: GatewayRelationship[] = [];
  if (s.projectId) rels.push(rel(key, "SESSION_OF_PROJECT", `project:${s.projectId}`, projectName(state, s.projectId), "ID", "SESSIONS"));
  if (s.showId) rels.push(rel(key, "SESSION_OF_SHOW", `show:${s.showId}`, state.domains.shows.data?.items.find((x) => x.id === s.showId)?.name ?? null, "ID", "SESSIONS"));
  return {
    entity: { key, type: "session", label: record(`${s.sessionType} · ${heDate(s.dateYmd)}`) },
    facts: [fact("SESSION_DATE", "תאריך", s.dateYmd, "FACT", "SESSIONS"), fact("SESSION_TYPE", "סוג", s.sessionType, "FACT", "SESSIONS"), fact("SESSION_STATUS", "סטטוס", s.status, "FACT", "SESSIONS")],
    relationships: rels,
    missing: [
      { fact: "calendar linkage", whyNeeded: "Partner does not read the calendar link of a session" },
      { fact: "session finance", whyNeeded: "no canonical session ↔ transaction relation exists" },
      ...(!s.projectId && !s.showId ? [{ fact: "project / show", whyNeeded: "the session is not linked to a project or a show" }] : []),
    ],
    drillDown: s.projectId ? [drill(`project:${s.projectId}`, "פתח את הפרויקט")] : [],
    scopeKeys: [key], caseIds: new Set([id]), patternFamily: () => false,
  };
}

function releaseDraft(state: PartnerCompanyState, projectId: string): EntityDraft | null {
  const r = state.domains.releasesFull.data?.items.find((x) => x.projectId === projectId);
  if (!r) return null;
  const key = `release:${projectId}`;
  const artist = r.labelArtistId ? state.domains.labelArtists.data?.items.find((a) => a.id === r.labelArtistId) ?? null : null;
  const rels: GatewayRelationship[] = [rel(key, "PROJECT_HAS_RELEASE", `project:${projectId}`, projectName(state, projectId), "ID", "RELEASES")];
  if (r.labelArtistId) rels.push(rel(key, "RELEASE_OF_LABEL_ARTIST", `label-artist:${r.labelArtistId}`, artist?.name ?? null, "ID", "RELEASES"));
  const missing: EntityDraft["missing"] = [{ fact: "release dependencies", whyNeeded: "next action / blocker are free text and are not read by Partner" }];
  if (!r.targetYmd && !r.releasedAt) missing.push({ fact: "release date", whyNeeded: "no target date is set" });
  if (!r.labelArtistId) missing.push({ fact: "label artist", whyNeeded: "the release is not linked to a label artist" });
  return {
    entity: { key, type: "release", label: record(projectName(state, projectId)) },
    facts: [fact("RELEASE_STAGE", "שלב", r.stage, "FACT", "RELEASES"), fact("RELEASE_TARGET_DATE", "תאריך יעד", r.targetYmd, r.targetYmd ? "FACT" : "UNKNOWN", "RELEASES"), fact("RELEASED_AT", "יצא בתאריך", r.releasedAt, "FACT", "RELEASES"), fact("STAGE_ENTERED_AT", "נכנס לשלב", r.stageEnteredAt, "FACT", "RELEASES")],
    relationships: rels, missing,
    drillDown: [drill(`project:${projectId}`, "פתח את הפרויקט"), ...(r.labelArtistId ? [drill(`label-artist:${r.labelArtistId}`, artist?.name ?? "פתח את האמן")] : [])],
    scopeKeys: [key, `project:${projectId}`], caseIds: new Set([projectId]), patternFamily: () => false,
  };
}

// ── dispatcher ───────────────────────────────────────────────────────────────

export function getPartnerEntityCore(key: string, src: GatewaySources): EntityResponse {
  const used: Parameters<typeof envelope>[3] = [["PROJECTS", src.state], ["FINANCE", src.finance], ["MEMORY", src.memory], ["CASES", src.cases], ["ACTIONS", src.actions]];
  const env = envelope("partner_entity", { key }, src, used);
  const empty = (status: EntityResponse["status"], why: string): EntityResponse => ({
    ...env, status, entity: null, facts: [], relationships: [], ownerDecisions: [], observations: [], conflicts: [], patterns: { candidates: [], confirmed: [] },
    resolutions: [], openIssues: [], openQuestions: [], suggestedActions: [], actionHistory: [], recentOutcomes: [], missing: [{ fact: key.slice(0, 80), whyNeeded: why }], drillDown: [], truncated: {},
  });
  const parsed = parseEntityKey(key);
  if (!parsed) return empty("UNSUPPORTED_KEY", "not a Gateway entity key — use partner_resolve first");
  const state = ok(src.state);
  let draft: EntityDraft | null = null;
  if (parsed.type === "vendor") draft = parsed.id === "VICTOR" ? victorDraft(src, state) : stevenDraft(src, state);
  else if (parsed.type === "recurring") draft = periodDraft(src, parsed.id);
  else if (!state) return empty("NOT_FOUND", "company state could not be read — the entity is UNKNOWN, not absent");
  else if (parsed.type === "project") draft = projectDraft(src, state, parsed.id);
  else if (parsed.type === "client") draft = clientDraft(state, parsed.id);
  else if (parsed.type === "label-artist") draft = labelArtistDraft(src, state, parsed.id);
  else if (parsed.type === "dj") draft = djDraft(src, state, parsed.id);
  else if (parsed.type === "show") draft = showDraft(src, state, parsed.id);
  else if (parsed.type === "session") draft = sessionDraft(state, parsed.id);
  else if (parsed.type === "release") draft = releaseDraft(state, parsed.id);
  if (!draft) return empty("NOT_FOUND", "no such entity in the current canonical state");
  return finishEntity(src, draft, env);
}

