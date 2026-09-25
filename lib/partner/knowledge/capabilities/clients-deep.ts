/**
 * Sunny knowledge — CLIENTS + PROPOSALS DEEP BRAIN (Owner-only, read-only). Pure views over sources the Gateway
 * already loads (lib/partner/clients/view.ts). Progressive: portfolio → one client → one section.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { buildClientView, clientPortfolio, clientWorkflow, type ClientView } from "../../clients/view";
import { CLIENT_SIGNAL_MODEL } from "../../system/clients";
import { byCount, idOf, item, partner, record, result, sfact, unavailable } from "./common";

const OWNER_FIN = { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" } as const;
const NEEDS = ["STATE", "FINANCE", "OPERATIONS", "OWNER_KNOWLEDGE", "INTEGRITY", "CASES", "ACTIONS", "OUTCOMES", "PROJECT_DETAIL", "CLIENT_DETAIL"] as const;
export const CLIENT_SECTIONS = ["summary", "identity", "contact", "roles", "proposals", "projects", "money", "meetings", "calendar", "sessions", "tasks", "notes", "history", "delivery", "owner_knowledge", "signals", "questions"] as const;
const COVERAGE = [
  partner("פרויקט מקושר ללקוח דרך הצעה = קישור קנוני; לפי שם האמן = TEXT_MATCH (שיתופים מסומנים)."),
  partner("כסף: התקבל / צפוי / פוטנציאל (הצעות פתוחות) — לעולם לא מחוברים יחד; לכל מטבע בנפרד."),
  partner("אין רישום של קשר מחוץ למערכת: 'לא רואה פולואפ רשום' ≠ 'לא עשית פולואפ'."),
  partner("תנאי עסקה (מקדמה / מתי יתרה) לא נרשמים ב-Redbloods — סאני לא ממציא אותם."),
];

function sectionRows(v: ClientView, section: string): Array<{ id: string; label: string; recordText?: boolean; epistemic: KnowledgeItem["epistemic"]; fields: Record<string, unknown> }> {
  switch (section) {
    case "identity": return [{ id: "identity", label: v.identity.name, recordText: true, epistemic: "FACT", fields: { ...v.identity } }];
    case "contact": return v.contact ? [{ id: "contact", label: "פרטי קשר שמורים", epistemic: "FACT", fields: { ...v.contact } }] : [];
    case "roles": return [{ id: "roles", label: "תפקידים של אותו אדם", epistemic: "FACT", fields: { ...v.roles } }];
    case "proposals": return v.proposals.map((p) => ({ id: p.id, label: p.title, recordText: true, epistemic: "FACT", fields: { ...p } }));
    case "projects": return v.projects.map((p) => ({ id: p.projectId, label: p.name, recordText: true, epistemic: p.basis === "PROPOSAL_CHAIN" ? "FACT" : "DERIVED", fields: { ...p } }));
    case "money": return v.money ? [{ id: "totals", label: "כסף לפי סוג", epistemic: "DERIVED", fields: { realized: v.money.realized, expected: v.money.expected, collectible: v.money.collectible, potential: v.money.potential, rule: v.money.rule } }, ...v.money.rows.map((r, i) => ({ id: `row:${i}`, label: String(r.name ?? r.description ?? r.transaction ?? "row"), recordText: true, epistemic: "FACT" as const, fields: r }))] : [];
    case "meetings": return v.meetings.map((m) => ({ id: m.key, label: `פגישה ${m.date ?? ""}`, epistemic: "FACT", fields: { ...m } }));
    case "calendar": return [{ id: "calendar", label: "הקשר ביומן", epistemic: "DERIVED", fields: { ...v.calendar } }];
    case "sessions": return v.sessions.map((s, i) => ({ id: `session:${i}`, label: `${s.type ?? "סשן"} ${s.date ?? ""}`, epistemic: "FACT", fields: { ...s } }));
    case "tasks": return v.tasks.map((t, i) => ({ id: `task:${i}`, label: t.title ?? "משימה", recordText: true, epistemic: "FACT", fields: { ...t } }));
    case "notes": return v.notes.map((n, i) => ({ id: `note:${i}`, label: n.text, recordText: true, epistemic: "OBSERVATION", fields: { source: n.source, at: n.at, trust: "free text — evidence, not a fact" } }));
    case "history": return v.history.map((h, i) => ({ id: `h:${i}`, label: h.event, recordText: true, epistemic: "FACT", fields: { at: h.at, recorded: h.recorded } }));
    case "delivery": return v.deliveries.map((d, i) => ({ id: `d:${i}`, label: `מסירה ${d.project}`, epistemic: "FACT", fields: { ...d } }));
    case "owner_knowledge": return v.ownerKnowledge.map((k, i) => ({ id: `k:${i}`, label: k.meaning, recordText: true, epistemic: "OWNER_REPORTED", fields: { ...k } }));
    case "signals": return v.signals.map((s, i) => ({ id: `${s.code}:${i}`, label: s.he, recordText: true, epistemic: s.kind === "UNKNOWN" ? "UNKNOWN" : s.kind === "CANONICAL_FACT" ? "FACT" : "DERIVED", fields: { code: s.code, kind: s.kind, entity: s.entity ?? null } }));
    case "questions": return v.questions.map((q, i) => ({ id: `q:${i}`, label: q.questionHe, epistemic: "UNKNOWN", fields: { kind: q.kind, why: q.why } }));
    default: return [];
  }
}

export const clientView: KnowledgeCapability = {
  id: "client_view", domain: "CLIENTS", titleHe: "תמונת לקוח מחוברת",
  descriptionForModel: "EVERYTHING Redbloods records about ONE client, across domains. Default section summary (identity, roles, counts, money by class, signals, questions, section index). Sections: identity, contact (phone / email), roles (client + label-artist records of the same person, show artist / booker / DJ, send-log recipient, Red Films, Owner label classification), proposals (status, follow-up state, follow-up task, conversion, amount vs agreed price), projects (basis PROPOSAL_CHAIN canonical / NAME_EXACT / NAME_COLLABORATION text match + deadline class, advance evidence, ball holder), money (REALIZED / EXPECTED / collectible / POTENTIAL per currency), meetings, calendar, sessions, tasks, notes (evidence), history (recorded dates only), delivery, owner_knowledge, signals, questions.",
  examplesHe: ["מה המצב עם הלקוח הזה?", "כמה הוא שילם?", "יש לו הצעה פתוחה?", "מתי נפגשנו?", "מה הפרויקטים שלו?", "הוא חייב כסף?"],
  modes: { view: { descriptionForModel: "One client (param client; optional section)" } }, defaultMode: "view",
  params: {
    client: { kind: "entityKey", types: ["client"], descriptionForModel: "The client (partner_resolve)" },
    section: { kind: "enum", values: [...CLIENT_SECTIONS], descriptionForModel: "Which part to deepen (default summary)" },
  },
  entityScope: { types: ["client"], param: "client", mode: "view", limit: 1 },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 2000, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR"],
  read(src, q) {
    if (!q.params.client) return result([], { completeness: "UNKNOWN", missing: [{ fact: "client", whyNeeded: "pass params.client (partner_resolve gives the key)" }] });
    if (!src.state || src.state.status !== "OK") return unavailable("clients");
    const v = buildClientView(src, idOf(q.params.client));
    if (!v) return result([], { completeness: "UNKNOWN", missing: [{ fact: "client", whyNeeded: "no such client in the live data (it may be deleted)" }] });
    const section = q.params.section ?? "summary";
    const summary = [sfact("CLIENT", "לקוח", { key: v.key, name: v.identity.name, type: v.identity.type, status: v.identity.status }, "FACT", "CLIENTS"),
      sfact("COUNTS", "כמויות", { proposals: v.proposals.length, openProposals: v.proposals.filter((p) => p.open).length, projects: v.projects.length, openProjects: v.projects.filter((p) => p.open).length, meetings: v.meetings.length, tasks: v.tasks.length, notes: v.notes.length }, "FACT", "CLIENTS"),
      sfact("MONEY", "כסף (לפי סוג)", v.money ? { realized: v.money.realized, expected: v.money.expected, collectible: v.money.collectible, potential: v.money.potential } : "UNKNOWN", "DERIVED", "FINANCE"),
      sfact("SIGNALS", "אותות", byCount(v.signals.map((s) => s.code)), "DERIVED", "CLIENTS"), sfact("LAST_RECORDED_ACTIVITY", "פעילות רשומה אחרונה", v.lastRecordedActivity, "DERIVED", "CLIENTS")];
    const rows = section === "summary" ? [...sectionRows(v, "signals"), ...sectionRows(v, "questions"), { id: "sections", label: "חלקים זמינים", epistemic: "FACT" as const, fields: { sections: CLIENT_SECTIONS.filter((s) => s !== "summary") } }] : sectionRows(v, section);
    return result(rows.map((r) => item({ id: `${section}:${r.id}`, entity: v.key, label: r.recordText ? record(r.label) : partner(r.label), epistemic: r.epistemic, source: "CLIENTS", fields: { section, ...r.fields } })),
      { summary, completeness: v.unavailable.length ? "PARTIAL" : "COMPLETE", coverage: [...COVERAGE, ...v.unavailable.map((u) => partner(u))], missing: !rows.length ? [{ fact: section, whyNeeded: "Redbloods holds nothing for this client in this section" }] : [] });
  },
};

const SIGNAL_CODES = CLIENT_SIGNAL_MODEL.map((s) => s.code);
export const clientPortfolioCap: KnowledgeCapability = {
  id: "client_portfolio", domain: "CLIENTS", titleHe: "לקוחות והצעות — תמונת חברה",
  descriptionForModel: "Company-level customer picture with FACTS, never a ranking or likelihood. Modes: overview (totals + every client: open proposals / projects, canonical vs name-matched projects, realized / expected / collectible / potential money per currency, upcoming meetings, last recorded activity, repeat flag, signal codes), proposals (every proposal; param status), follow_ups (open proposals by recorded follow-up state — 'recorded follow-up passed', never 'you did not follow up'), signal (clients with one signal code), workflow (event NEW_CLIENT_REQUEST / PROPOSAL_SENT + client key or name: what Redbloods knows, what to ask, next step — nothing is created).",
  examplesHe: ["כמה לקוחות פעילים יש?", "למי צריך לעשות פולואפ?", "אילו הצעות פתוחות?", "מי לקוח חוזר?", "מאיפה מגיעה הכנסה?", "יש לי לקוח חדש שרוצה 3 שירים", "שלחתי לו הצעה"],
  modes: { overview: { descriptionForModel: "Totals + every client" }, proposals: { descriptionForModel: "Every proposal (optional status)" }, follow_ups: { descriptionForModel: "Open proposals by follow-up state" }, signal: { descriptionForModel: "Clients with param signal" }, workflow: { descriptionForModel: "Client / proposal event → workflow (params event + client or name)" } },
  defaultMode: "overview",
  params: {
    status: { kind: "text", maxLength: 30, descriptionForModel: "proposals: exact stored status" },
    signal: { kind: "enum", values: SIGNAL_CODES, descriptionForModel: "signal: the signal code" },
    event: { kind: "enum", values: ["NEW_CLIENT_REQUEST", "PROPOSAL_SENT"], descriptionForModel: "workflow: the event" },
    client: { kind: "entityKey", types: ["client"], descriptionForModel: "workflow: the client, if known" },
    name: { kind: "text", maxLength: 80, descriptionForModel: "workflow: the name the Owner used, when not resolved" },
  },
  paging: { defaultLimit: 25, maxLimit: 50 }, recordTextLimit: 1000, access: OWNER_FIN, needs: NEEDS, optionalNeeds: ["CALENDAR"],
  read(src, q) {
    if (!src.state || src.state.status !== "OK") return unavailable("clients");
    if (q.mode === "workflow") {
      const w = clientWorkflow(src, (q.params.event ?? "NEW_CLIENT_REQUEST") as "NEW_CLIENT_REQUEST" | "PROPOSAL_SENT", { client: q.params.client ?? null, name: q.params.name ?? null });
      return result([...w.known.map((k) => item({ id: `known:${k.item}`, label: partner(k.item), epistemic: "FACT", source: "CLIENTS", fields: { value: k.value, source: k.source } })), ...w.ask.map((a, i) => item({ id: `ask:${i}`, label: partner(a.questionHe), epistemic: "UNKNOWN", source: "CLIENTS", fields: { kind: a.kind, why: a.why } }))],
        { summary: [sfact("WORKFLOW", "תהליך", { event: w.event, identity: w.identity, client: w.client, nextStep: w.nextStep, mutations: w.mutations }, "DERIVED", "CLIENTS")], coverage: COVERAGE });
    }
    if (q.mode === "proposals" || q.mode === "follow_ups") {
      const all = (src.state.value.domains.clients.data?.items ?? []).flatMap((c) => buildClientView(src, c.id)!.proposals.map((p) => ({ ...p, client: `client:${c.id}`, clientName: c.name })));
      const rows = q.mode === "follow_ups" ? all.filter((p) => p.open) : all.filter((p) => !q.params.status || p.status === q.params.status);
      return result(rows.map((p) => item({ id: p.id, entity: p.client, label: record(`${p.clientName} — ${p.title}`), epistemic: "FACT", source: "PROPOSALS", fields: { status: p.status, open: p.open, amount: p.amount, currency: p.currency, moneyClass: p.moneyClass, sent: p.sent, followUp: p.followUp, followUpState: p.followUpState, linkedProject: p.linkedProject, amountDiffersFromPrice: p.amountDiffersFromPrice } })),
        { summary: [sfact("BY_STATUS", "לפי סטטוס", byCount(rows.map((p) => p.status)), "FACT", "PROPOSALS"), sfact("BY_FOLLOW_UP", "לפי מצב פולואפ", byCount(rows.map((p) => p.followUpState)), "DERIVED", "PROPOSALS")], coverage: COVERAGE });
    }
    const pf = clientPortfolio(src);
    const rows = q.mode === "signal" ? pf.rows.filter((r) => !q.params.signal || r.signals.includes(q.params.signal)) : pf.rows;
    return result(rows.map((r) => item({ id: r.key, entity: r.key, label: record(r.name), epistemic: "DERIVED", source: "CLIENTS", fields: { ...r } })),
      { summary: [sfact("TOTALS", "סיכום", pf.totals, "DERIVED", "CLIENTS"), sfact("BY_SIGNAL", "לקוחות לפי אות", byCount(pf.rows.flatMap((r) => r.signals)), "DERIVED", "CLIENTS")], coverage: [...COVERAGE, partner("מסודר לפי שם — לא דירוג לקוחות ולא סיכוי סגירה.")] });
  },
};
