/**
 * Redbloods Partner knowledge — PROJECTS / CLIENTS / SALES / SESSIONS / TEAM capabilities. Pure views over the
 * Partner Eyes company state (the same canonical reads every Partner surface uses). Artist ↔ project / client links
 * are free-text (TEXT_MATCH) and are always labelled so; ID links are labelled ID.
 */
import type { KnowledgeCapability, KnowledgeItem } from "../types";
import { byCount, CLOSED_PROJECT, clientName, idOf, item, labelArtistName, partner, partnerRecord, projectName, record, result, sfact, state, textMentions, unavailable } from "./common";

/** The name an entity key refers to (client / label artist), for TEXT_MATCH filtering. */
function nameOfKey(src: Parameters<KnowledgeCapability["read"]>[0], key: string): string | null {
  if (key.startsWith("client:")) return clientName(src, idOf(key));
  if (key.startsWith("label-artist:")) return labelArtistName(src, idOf(key));
  return null;
}

export const projects: KnowledgeCapability = {
  id: "projects", domain: "PROJECTS", titleHe: "פרויקטים",
  descriptionForModel: "The project portfolio from canonical project records: name, status, business type (לקוח / לייבל — as stored; a label artist's project may be stored as לקוח, see capability integrity), project type, artist text, deadline and days to it, days since last update, whether a price is set. Filter by status, business type, artist name or a client / label-artist entity (artist links are TEXT_MATCH).",
  examplesHe: ["איזה פרויקטים פתוחים?", "מה בעבודה עכשיו?", "כל הפרויקטים של שליו", "אילו פרויקטים הושלמו?"],
  modes: { open: { descriptionForModel: "Active projects (not completed / cancelled / on hold)" }, all: { descriptionForModel: "Every project" } }, defaultMode: "open",
  params: {
    status: { kind: "text", maxLength: 30, descriptionForModel: "Exact stored status (e.g. בעבודה, במיקס, הושלם)" },
    business_type: { kind: "enum", values: ["לקוח", "לייבל"], descriptionForModel: "Stored business type" },
    artist: { kind: "text", maxLength: 60, descriptionForModel: "Artist name as written in projects (TEXT_MATCH)" },
    about: { kind: "entityKey", types: ["client", "label-artist"], descriptionForModel: "Projects whose artist text names this client / label artist (TEXT_MATCH)" },
  },
  entityScope: { types: ["client", "label-artist"], param: "about", mode: "all", limit: 8 },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read(src, q) {
    const st = state(src);
    const p = st?.domains.projects.data;
    if (!st || !p) return unavailable("projects");
    const open = new Map(p.open.map((x) => [x.id, x]));
    const who = q.params.about ? nameOfKey(src, q.params.about) : q.params.artist ?? null;
    if (q.params.about && !who) return result([], { completeness: "COMPLETE", missing: [{ fact: "entity name", whyNeeded: "that client / label artist was not found" }] });
    const rows = Object.entries(p.index)
      .filter(([id, x]) => (q.mode === "all" || open.has(id)) && (!q.params.status || x.status === q.params.status) && (!q.params.business_type || x.businessType === q.params.business_type) && (!who || textMentions(x.artistText, who)))
      .sort(([a, x], [b, y]) => (open.get(a)?.deadline.ymd ?? "9999").localeCompare(open.get(b)?.deadline.ymd ?? "9999") || x.name.localeCompare(y.name) || a.localeCompare(b));
    const items = rows.map(([id, x]) => {
      const o = open.get(id);
      return item({ id, entity: `project:${id}`, label: record(x.name), epistemic: "FACT", source: "PROJECTS", ...(who ? { relationQuality: "TEXT_MATCH" as const } : {}),
        fields: { status: x.status, businessType: x.businessType, artist: record(x.artistText), projectType: o?.projectType ?? null, deadline: o?.deadline.ymd ?? null, daysToDeadline: o?.deadline.daysTo ?? null, daysSinceUpdate: o?.daysSinceUpdate ?? null, active: !!o?.active, priceSet: o ? o.hasFinanceSetting : null } });
    });
    return result(items, { summary: [sfact("TOTAL", "פרויקטים במערכת", p.total, "FACT", "PROJECTS"), sfact("BY_STATUS", "לפי סטטוס", p.byStatus, "FACT", "PROJECTS")],
      coverage: who ? [partner("הקישור בין אמן לפרויקט הוא לפי שם בלבד (TEXT_MATCH) — לא קישור מזהה.")] : [] });
  },
};

export const clients: KnowledgeCapability = {
  id: "clients", domain: "CLIENTS", titleHe: "לקוחות",
  descriptionForModel: "Client records: name, type, status (e.g. אמן לייבל), plus how many projects name them (TEXT_MATCH) and how many proposals are linked to them (ID). Use partner_entity client:<id> for one client in depth.",
  examplesHe: ["מי הלקוחות שלי?", "כמה לקוחות יש?", "מי הלקוחות הפעילים?"],
  modes: { all: { descriptionForModel: "Every client" } }, defaultMode: "all",
  params: { status: { kind: "text", maxLength: 30, descriptionForModel: "Exact stored status" }, type: { kind: "text", maxLength: 30, descriptionForModel: "Exact stored type" }, name: { kind: "text", maxLength: 60, descriptionForModel: "Name contains" } },
  paging: { defaultLimit: 20, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "PERSONAL" }, needs: ["STATE"],
  read(src, q) {
    const st = state(src);
    const c = st?.domains.clients.data;
    if (!st || !c) return unavailable("clients");
    const idx = Object.values(st.domains.projects.data?.index ?? {});
    const props = st.domains.proposalsFull.data?.items ?? [];
    const rows = c.items.filter((x) => (!q.params.status || x.status === q.params.status) && (!q.params.type || x.type === q.params.type) && (!q.params.name || x.name.includes(q.params.name)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return result(rows.map((x) => item({ id: x.id, entity: `client:${x.id}`, label: record(x.name), epistemic: "FACT", source: "CLIENTS",
      fields: { type: x.type, status: x.status, createdAt: x.createdAt, projectsNamingThem: idx.filter((p) => textMentions(p.artistText, x.name)).length, projectLink: "TEXT_MATCH", proposals: props.filter((p) => p.clientId === x.id).length } })),
      { summary: [sfact("TOTAL", "לקוחות", c.total, "FACT", "CLIENTS"), sfact("BY_TYPE", "לפי סוג", c.byType, "FACT", "CLIENTS")] });
  },
};

export const proposals: KnowledgeCapability = {
  id: "proposals", domain: "SALES", titleHe: "הצעות מחיר",
  descriptionForModel: "Price proposals: title, client (ID link, or TEXT_MATCH for a legacy row), linked project, amount + currency, status, sent and follow-up dates. 'open' excludes closed ones (נסגר / לא נסגר).",
  examplesHe: ["יש הצעות מחיר פתוחות?", "למי שלחתי הצעה?", "מה עם ההצעות?"],
  modes: { open: { descriptionForModel: "Not yet closed" }, all: { descriptionForModel: "Every proposal" } }, defaultMode: "open",
  params: { client: { kind: "entityKey", types: ["client"], descriptionForModel: "Only this client's proposals" } },
  entityScope: { types: ["client"], param: "client", mode: "all", limit: 5 },
  paging: { defaultLimit: 15, maxLimit: 40 }, access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" }, needs: ["STATE"],
  read(src, q) {
    const p = state(src)?.domains.proposalsFull.data;
    if (!p) return unavailable("proposals");
    const want = q.params.client ? idOf(q.params.client) : null;
    const rows = p.items.filter((x) => (q.mode === "all" || !["נסגר", "לא נסגר"].includes(x.status)) && (!want || x.clientId === want))
      .sort((a, b) => (b.sentYmd ?? b.createdAt ?? "").localeCompare(a.sentYmd ?? a.createdAt ?? "") || a.id.localeCompare(b.id));
    return result(rows.map((x) => item({ id: x.id, entity: x.linkedProjectId ? `project:${x.linkedProjectId}` : x.clientId ? `client:${x.clientId}` : null, label: record(x.title), epistemic: "FACT", source: "PROPOSALS",
      relationQuality: x.clientId ? "ID" : "TEXT_MATCH",
      fields: { client: record(x.clientId ? clientName(src, x.clientId) ?? x.clientName : x.clientName), clientLink: x.clientId ? "ID" : "TEXT_MATCH", linkedProject: x.linkedProjectId ? record(projectName(src, x.linkedProjectId)) : null, amount: x.amount, currency: x.currency, status: x.status, sent: x.sentYmd, followUp: x.followupYmd } })),
      { summary: [sfact("TOTAL", "הצעות מחיר", p.total, "FACT", "PROPOSALS"), sfact("BY_STATUS", "לפי סטטוס", p.byStatus, "FACT", "PROPOSALS")] });
  },
};

export const sessions: KnowledgeCapability = {
  id: "sessions", domain: "SESSIONS", titleHe: "סשנים",
  descriptionForModel: "Studio session RECORDS (business records: date, status, type, linked project / show by ID). They are NOT the calendar: Google Calendar is the future-schedule truth and Partner does not read it yet, so the future schedule is PARTIAL / UNKNOWN — zero future session rows only means none are recorded in the sessions records, never that the calendar is empty.",
  examplesHe: ["מתי היה הסשן האחרון?", "כמה סשנים היו לפרויקט?", "יש סשנים קבועים?"],
  modes: { recent: { descriptionForModel: "Past sessions, newest first" }, upcoming: { descriptionForModel: "Future session RECORDS only (partial — calendar not read)" }, all: { descriptionForModel: "Every session record" } }, defaultMode: "recent",
  params: { about: { kind: "entityKey", types: ["project", "show"], descriptionForModel: "Only sessions of this project / show (ID link)" } },
  entityScope: { types: ["project", "show"], param: "about", mode: "all", limit: 5 },
  paging: { defaultLimit: 15, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read(src, q) {
    const st = state(src);
    const s = st?.domains.sessions.data;
    if (!st || !s) return unavailable("sessions");
    const today = st.todayIL;
    const about = q.params.about ?? null;
    const rows = s.items.filter((x) => (!about || (about.startsWith("project:") ? x.projectId === idOf(about) : x.showId === idOf(about))) && (q.mode === "all" || (q.mode === "upcoming" ? x.dateYmd >= today : x.dateYmd < today)))
      .sort((a, b) => (q.mode === "upcoming" ? a.dateYmd.localeCompare(b.dateYmd) : b.dateYmd.localeCompare(a.dateYmd)) || a.id.localeCompare(b.id));
    const future = s.items.filter((x) => x.dateYmd >= today && x.status !== "בוטל").length;
    const items: KnowledgeItem[] = rows.map((x) => item({ id: x.id, entity: `session:${x.id}`, label: partner(`סשן ${x.dateYmd}`), epistemic: "FACT", source: "SESSIONS",
      fields: { date: x.dateYmd, status: x.status, type: x.sessionType, project: x.projectId ? { key: `project:${x.projectId}`, name: record(projectName(src, x.projectId)), link: "ID" } : null, show: x.showId ? { key: `show:${x.showId}`, link: "ID" } : null } }));
    const scheduleNote = partner(future === 0
      ? "אין סשנים עתידיים רשומים כרגע ברשומות הסשנים. זה לא אומר שהיומן ריק — Google Calendar הוא מקור האמת ליומן ו־Partner עוד לא קורא אותו."
      : `רשומים ${future} סשנים עתידיים, אבל Google Calendar (מקור האמת ליומן) לא נקרא — התמונה העתידית חלקית.`);
    return result(items, {
      summary: [sfact("TOTAL", "רשומות סשן", s.total, "FACT", "SESSIONS"), sfact("BY_STATUS", "לפי סטטוס", s.byStatus, "FACT", "SESSIONS"), sfact("FUTURE_RECORDED", "סשנים עתידיים רשומים (לא היומן)", future, "FACT", "SESSIONS")],
      completeness: q.mode === "recent" ? "COMPLETE" : "PARTIAL", coverage: [scheduleNote],
    });
  },
};

export const teamVictor: KnowledgeCapability = {
  id: "team_victor", domain: "TEAM", titleHe: "העבודה עם Victor",
  descriptionForModel: "Victor's active mixing works: title, project, work state, sent date and age, last upload / last notes, and whose turn it is (DERIVED from recorded uploads vs notes — the Owner may have handled a delivery outside the system). A long-inactive work is 'stale-looking', never 'abandoned'. Salary is capability victor_salary.",
  examplesHe: ["מה עם Victor?", "מה מחכה אצל ויקטור?", "מה אני צריך להחזיר לויקטור?"],
  modes: { active: { descriptionForModel: "All active works" }, owner_queue: { descriptionForModel: "Deliveries waiting for the Owner (oldest first)" } }, defaultMode: "active",
  params: {}, paging: { defaultLimit: 15, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read(src, q) {
    const v = state(src)?.domains.victor.data;
    if (!v) return unavailable("Victor works");
    const ws = q.mode === "owner_queue" ? v.ownerQueue.items : [...v.active].sort((a, b) => (b.daysSinceSent ?? -1) - (a.daysSinceSent ?? -1) || a.id.localeCompare(b.id));
    return result(ws.map((w) => item({ id: w.id, entity: w.projectId ? `project:${w.projectId}` : "vendor:VICTOR", label: record(w.title), epistemic: "FACT", source: "TEAM_VICTOR",
      fields: { project: w.projectId ? record(projectName(src, w.projectId)) : null, workState: w.workState, sentDate: w.sentDate, daysSinceSent: w.daysSinceSent, internalDeadline: w.internalDeadline, lastUploadAt: w.lastUploadAt, lastNotesSentAt: w.lastNotesSentAt,
        whoseTurn: { holder: w.ball.holder, basis: partnerRecord(w.ball.basis), epistemic: "DERIVED" }, waitingOwnerDays: w.waitingOwnerDays } })),
      { summary: [sfact("ACTIVE", "עבודות פעילות", v.active.length, "FACT", "TEAM_VICTOR"), sfact("TURN_COUNTS", "תור מי (נגזר)", v.ballCounts, "DERIVED", "TEAM_VICTOR"), sfact("AGE", "גיל העבודות", v.ageStats, "DERIVED", "TEAM_VICTOR")],
        coverage: [partner("\"תור הבעלים\" נגזר מהעלאות והערות מתועדות בלבד — ייתכן שהטיפול קרה מחוץ למערכת.")] });
  },
};

export const teamSteven: KnowledgeCapability = {
  id: "team_steven", domain: "TEAM", titleHe: "העבודה עם Steven",
  descriptionForModel: "Steven's (sound engineer) open works: title, project, status, agreed price + currency, amount paid, sent date, internal deadline, mix version presence; and approved-but-unpaid work per currency (never merged). Payment recording has two code paths — see capability integrity for that conflict.",
  examplesHe: ["מה עם Steven?", "כמה אני חייב לסטיבן?", "מה פתוח אצל סטיבן?"],
  modes: { open: { descriptionForModel: "Open works" }, approved_unpaid: { descriptionForModel: "Approved works not fully paid" } }, defaultMode: "open",
  params: {}, paging: { defaultLimit: 15, maxLimit: 40 }, access: { externalRead: true, ownerOnly: true, sensitivity: "FINANCIAL" }, needs: ["STATE"],
  read(src, q) {
    const s = state(src)?.domains.steven.data;
    if (!s) return unavailable("Steven works");
    const ws = [...(q.mode === "approved_unpaid" ? s.approvedUnpaid.works : s.open)].sort((a, b) => (a.internalDeadline ?? "9").localeCompare(b.internalDeadline ?? "9") || a.id.localeCompare(b.id));
    return result(ws.map((w) => item({ id: w.id, entity: w.projectId ? `project:${w.projectId}` : "vendor:STEVEN", label: record(w.title), epistemic: "FACT", source: "TEAM_STEVEN",
      fields: { project: w.projectId ? record(projectName(src, w.projectId)) : null, status: w.status, agreedPrice: w.agreedPrice, currency: w.currency, amountPaid: w.amountPaid, sentDate: w.sentDate, internalDeadline: w.internalDeadline, daysToInternal: w.daysToInternal, hasMixVersion: w.hasMixVersion } })),
      { summary: [sfact("TOTAL_WORKS", "עבודות", s.totalWorks, "FACT", "TEAM_STEVEN"), sfact("APPROVED_UNPAID_BY_CURRENCY", "מאושר ולא שולם, לפי מטבע", s.approvedUnpaid.byCurrency, "DERIVED", "TEAM_STEVEN")] });
  },
};

export { byCount, CLOSED_PROJECT };
