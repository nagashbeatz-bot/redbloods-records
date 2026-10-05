/**
 * Owner Inbox — CONTEXTUAL BUSINESS RESOLUTION (Owner decision 2026-10-01: "resolve as far as the business graph
 * allows"; "ask only after exhausting the available business context"). Pure and deterministic — no model, no score
 * shown to anyone. For one update:
 *   signals (names / aliases / work words / team / time) → candidate PROJECTS (named, credited, release-linked, alias)
 *   → typed EVIDENCE per candidate from the records the app already keeps (engineer work, versions, open comments,
 *     sessions, project actions, tasks, deadlines, status, Owner knowledge) → a decision:
 *       LIKELY     one candidate is clearly supported and nothing contradicts it (Sunny proposes it and asks "נכון?")
 *       AMBIGUOUS  more than one candidate is really plausible (Sunny asks, with the options and why)
 *       UNRESOLVED a name / reference the records cannot place (Sunny says what she searched and asks who it is)
 *       NONE       no name and no context hint — never invented from "the only active mix in the company"
 *   → the MOST SPECIFIC entity the links really allow (person → project → song / track only when linked → the work).
 * Never a link, never a fact: the result is evidence for Sunny's proposal; only the Owner's confirmation confirms it.
 * Reuses the app's rules (isClosedStatus, project_view, project memory) — no second rule.
 */
import type { GatewaySources } from "../gateway/core";
import type { OwnerInboxItem } from "../../owner-inbox";
import type { OperationsRaw } from "../operations/types";
import type { OwnerKnowledgeRecord } from "../owner-knowledge/store";
import type { ProjectDetailRaw } from "../projects/detail-types";
import { activeKnowledge } from "../owner-knowledge/store";
import { normalizeName } from "../gateway/resolve";
import { containsWholeName, findMentions, findPartialMentions, type MentionEntry } from "./inbox-mentions";
import { type ResolverProject } from "./inbox-resolver";
import { addDays, extractSignals, type UpdateSignals } from "./inbox-signals";
import { isClosedStatus } from "../../steven-mix-reminder-pure";
import { buildProjectView } from "../projects/view";
import { buildProjectMemory, projectLastEventAt } from "../projects/memory";
import { canonicalBallOf } from "../../inbox-memory";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
export type EvidenceQuality = "VERY_STRONG" | "STRONG" | "WEAK" | "CONTRADICTION" | "INFO";
export interface Evidence { code: string; he: string; quality: EvidenceQuality; source: string }
export type ResolutionStatus = "LIKELY" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
export interface ChainLink { level: "PERSON" | "PROJECT" | "SONG" | "TRACK" | "WORK" | "SESSION" | "VENDOR"; key: string | null; name: string; quality: "CANONICAL" | "TEXT_MATCH" | "OWNER_ALIAS" | "DERIVED" }
export interface Candidate { projectKey: string; projectName: string; personKey: string | null; personName: string | null; via: "NAMED_PROJECT" | "CREDIT" | "RELEASE_LINK" | "ALIAS" | "PARTIAL_PROJECT_NAME"; evidence: Evidence[] }
export interface Resolution {
  status: ResolutionStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  chosen: { chain: ChainLink[]; evidence: Evidence[]; recordVsReport: string[] } | null;
  contradictions: Evidence[];
  alternatives: Array<{ project: string; person: string | null; evidence: string[] }>;
  searched: string[];
  missing: string[];
}
export interface ChosenContext { status: string | null; deadline: string | null; liveBall: string | null; lastSession: string | null; nextSession: string | null; openTasks: number | null; blocker: string | null; understanding: { freshness: string; whatHappened: string } | null }
export interface UnderstoodUpdateV2 { itemId: string; signals: UpdateSignals & { names: string[] }; resolution: Resolution; context: ChosenContext | null }

const V = (code: string, he: string, source: string): Evidence => ({ code, he, quality: "VERY_STRONG", source });
const S = (code: string, he: string, source: string): Evidence => ({ code, he, quality: "STRONG", source });
const W = (code: string, he: string, source: string): Evidence => ({ code, he, quality: "WEAK", source });
const X = (code: string, he: string, source: string): Evidence => ({ code, he, quality: "CONTRADICTION", source });
const I = (code: string, he: string, source: string): Evidence => ({ code, he, quality: "INFO", source });
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);
const MIX_STATUSES = new Set(["במיקס", "מחכה למיקס"]);
const days = (a: string, b: string) => Math.round((Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const ilYmd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const credits = (t: string | null) => (t ?? "").split(/[,،;]/).map((x) => normalizeName(x)).filter(Boolean);
const fmt = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : "?");

interface Graph {
  index: readonly MentionEntry[]; projects: readonly ResolverProject[]; src: GatewaySources;
  ops: OperationsRaw | null; knowledge: OwnerKnowledgeRecord[]; today: string;
}

/** Approved Owner aliases (ENTITY_ALIAS, active) → the entity they name. Canonical-grade identity (the Owner said it). */
function aliasHits(text: string, g: Graph): Array<{ alias: string; key: string }> {
  const tt = normalizeName(text).split(" ").filter(Boolean);
  return activeKnowledge(g.knowledge, g.today).filter((k) => k.kind === "ENTITY_ALIAS" && typeof k.value.alias === "string")
    .filter((k) => containsWholeName(tt, normalizeName(String(k.value.alias)).split(" ").filter(Boolean)))
    .map((k) => ({ alias: String(k.value.alias), key: k.servedSubjectKey ?? k.subjectKey }));
}

/** Candidate projects behind the names of one update (never by similar spelling). */
function candidatesOf(item: OwnerInboxItem, g: Graph): { cands: Candidate[]; names: string[]; unknownNames: string[] } {
  const nameOf = new Map(g.index.map((e) => [e.key, e.name]));
  const pName = new Map(g.projects.map((p) => [p.key, p]));
  const st = ok(g.src.state);
  // ONE candidate per project (a project reached by several paths keeps the strongest path + the person)
  const RANK: Record<Candidate["via"], number> = { ALIAS: 5, NAMED_PROJECT: 4, RELEASE_LINK: 3, CREDIT: 2, PARTIAL_PROJECT_NAME: 1 };
  const out = new Map<string, Candidate>();
  const add = (c: Omit<Candidate, "evidence">) => {
    const prev = out.get(c.projectKey);
    if (!prev) { out.set(c.projectKey, { ...c, evidence: [] }); return; }
    if (RANK[c.via] > RANK[prev.via]) prev.via = c.via;
    if (!prev.personKey && c.personKey) { prev.personKey = c.personKey; prev.personName = c.personName; }
  };
  const OPEN = (k: string) => { const p = pName.get(k); return !!p && p.hidden !== true && !(p.status !== null && CLOSED_PROJECT.has(p.status)); };
  const personProjects = (personKey: string) => {
    const nm = normalizeName(nameOf.get(personKey) ?? "");
    const viaCredit = g.projects.filter((p) => nm && credits(p.artistText).includes(nm)).map((p) => ({ key: p.key, via: "CREDIT" as const }));
    const id = personKey.slice(personKey.indexOf(":") + 1);
    const viaRelease = personKey.startsWith("label-artist:") ? (st?.domains.releasesFull.data?.items ?? []).filter((r) => r.labelArtistId === id).map((r) => ({ key: `project:${r.projectId}`, via: "RELEASE_LINK" as const })) : [];
    return [...viaRelease, ...viaCredit].filter((x) => OPEN(x.key));
  };
  const names: string[] = [];
  const whole = findMentions(item.body, g.index);
  const partial = findPartialMentions(item.body, g.index, new Set(whole.map((m) => normalizeName(m.name))));
  for (const m of [...whole, ...partial]) {
    names.push(m.name);
    const isPartial = partial.includes(m as never);
    for (const k of m.keys) {
      // a project named in full is a strong signal (even closed → it may contradict); a first-name hit on a project title is weak
      if (k.startsWith("project:")) { if (pName.has(k) && (!isPartial || OPEN(k))) add({ projectKey: k, projectName: pName.get(k)!.name, personKey: null, personName: null, via: isPartial ? "PARTIAL_PROJECT_NAME" : "NAMED_PROJECT" }); continue; }
      for (const pp of personProjects(k)) add({ projectKey: pp.key, projectName: pName.get(pp.key)!.name, personKey: k, personName: nameOf.get(k) ?? k, via: pp.via });
    }
  }
  for (const a of aliasHits(item.body, g)) {
    names.push(a.alias);
    if (a.key.startsWith("project:") && pName.has(a.key)) add({ projectKey: a.key, projectName: pName.get(a.key)!.name, personKey: null, personName: null, via: "ALIAS" });
    else for (const pp of personProjects(a.key)) add({ projectKey: pp.key, projectName: pName.get(pp.key)!.name, personKey: a.key, personName: nameOf.get(a.key) ?? a.alias, via: "ALIAS" });
  }
  // a capitalised / Hebrew word that looks like a person reference but matches nothing ("עם גרמי", "של גרמי") → UNRESOLVED
  const tokens = item.body.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const unknownNames: string[] = [];
  tokens.forEach((t, n) => {
    const prev = tokens[n - 1];
    if (prev && ["עם", "של", "אצל", "ל", "את"].includes(prev) && t.length >= 3 && !names.some((x) => normalizeName(x).split(" ").includes(normalizeName(t))) && !["הפרויקט", "השיר", "המיקס", "הסשן", "האמן", "הלקוח", "הצוות"].includes(t)) unknownNames.push(t);
  });
  return { cands: [...out.values()], names: [...new Set(names)], unknownNames: [...new Set(unknownNames)] };
}

/** Typed evidence for one candidate project from the records (and the update's signals). */
function evidenceFor(c: Candidate, sig: UpdateSignals, writtenYmd: string, g: Graph): void {
  const st = ok(g.src.state);
  const id = c.projectKey.slice("project:".length);
  const p = g.projects.find((x) => x.key === c.projectKey)!;
  const ev = c.evidence;
  if (c.via === "NAMED_PROJECT") ev.push(V("EXACT_PROJECT_NAME", `שם הפרויקט "${c.projectName}" מופיע בעדכון`, "PROJECTS"));
  if (c.via === "ALIAS") ev.push(V("OWNER_ALIAS", "כינוי שאישרת מזהה את הישות", "OWNER_KNOWLEDGE"));
  if (c.via === "RELEASE_LINK") ev.push(S("RELEASE_LINK", "ריליס של הלייבל מקושר לאמן (קנוני)", "RELEASES"));
  if (c.via === "CREDIT") ev.push(W("CREDIT_ONLY", `${c.personName} בקרדיט של הפרויקט (התאמת שם)`, "PROJECTS"));
  if (c.via === "PARTIAL_PROJECT_NAME") ev.push(W("PARTIAL_PROJECT_NAME", `שם פרטי שמופיע בשם הפרויקט "${c.projectName}"`, "PROJECTS"));
  const closed = p.status !== null && CLOSED_PROJECT.has(p.status);
  if (closed && (sig.work.length || sig.timeWords.length)) ev.push(X("PROJECT_CLOSED", `הפרויקט ${p.status} — והעדכון מדבר על עבודה פעילה`, "PROJECTS"));

  // ── mix / master work (the app's own closed rule) ──
  const works = (g.ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === id);
  const active = works.filter((w) => !isClosedStatus(w.status));
  const vers = (g.ops?.mixVersions?.rows ?? []).filter((v) => v.workId && active.some((w) => w.id === v.workId));
  const verIds = new Set(vers.map((v) => v.id));
  const openComments = (g.ops?.mixComments?.rows ?? []).filter((m) => m.versionId && verIds.has(m.versionId) && m.status === "open").length;
  const lastVersion = vers.map((v) => v.createdAt ?? "").filter(Boolean).sort().at(-1) ?? null;
  const engineers = [...new Set(active.map((w) => w.engineerName))];
  if (sig.work.includes("MIX")) {
    if (active.length) ev.push(V("MIX_ACTIVE", `עבודת ${active[0].workType ?? "מיקס"} פעילה (${active[0].status ?? "?"}) אצל ${active[0].engineerName}${vers.length ? ` · ${vers.length} גרסאות` : ""}`, "ENGINEER_WORK"));
    // no engineer work EVER recorded: the Owner may mix it himself — weak, never a contradiction (One Brain stage 2);
    // an engineer work that exists but is closed still contradicts "we are mixing"
    else if (!works.length) ev.push(W("NO_ENGINEER_WORK", "אין עבודת מהנדס רשומה בפרויקט — ייתכן שהמיקס אצלך (לא סותר)", "ENGINEER_WORK"));
    else ev.push(X("NO_MIX_WORK", "העדכון מדבר על מיקס — ועבודת המיקס / מאסטר של הפרויקט סגורה", "ENGINEER_WORK"));
    if (p.status && MIX_STATUSES.has(p.status)) ev.push(S("STATUS_MATCH", `סטטוס הפרויקט "${p.status}" מתאים למיקס`, "PROJECTS"));
    if (openComments > 0) ev.push(S("OPEN_REVISIONS", `${openComments} הערות פתוחות על הגרסה`, "MIX_COMMENTS"));
    if (lastVersion && Math.abs(days(writtenYmd, lastVersion)) <= 14) ev.push(S("RECENT_VERSION", `גרסה אחרונה הועלתה ב-${fmt(lastVersion.slice(0, 10))}`, "MIX_VERSIONS"));
  }
  if (active.length) {
    const named: string[] = sig.team.map((t) => (t === "STEVEN" ? "Steven" : "Victor"));
    if (named.length) {
      if (engineers.some((e) => named.includes(e))) ev.push(V("ENGINEER_NAMED", `${named.join(" / ")} נכתב בעדכון — והעבודה הפעילה אצלו`, "ENGINEER_WORK"));
      else if (named.includes("Steven")) ev.push(X("ENGINEER_MISMATCH", `נכתב ${named.join(" / ")} — אבל העבודה הפעילה אצל ${engineers.join(" / ")}`, "ENGINEER_WORK"));
    } else if (sig.work.includes("MIX")) ev.push(S("ACTIVE_ENGINEER_MATCH", `העבודה הפעילה אצל ${engineers.join(" / ")} (לא נכתב בעדכון)`, "ENGINEER_WORK"));
  }
  const victor = (st?.domains.victor.data?.active ?? []).filter((w) => w.projectId === id);
  if (sig.team.includes("VICTOR")) { if (victor.length) ev.push(V("VICTOR_WORK", "יש עבודה פעילה של ויקטור בפרויקט", "VICTOR")); else ev.push(X("NO_VICTOR_WORK", "נכתב ויקטור — ואין לו עבודה בפרויקט", "VICTOR")); }

  // ── sessions on the days the update refers to ──
  const sessions = (st?.domains.sessions.data?.items ?? []).filter((s) => s.projectId === id && s.status !== "בוטל");
  if (sig.work.includes("SESSION") || (sig.timeWords.length && !sig.work.includes("MIX"))) {
    const wanted = sig.days.length ? sig.days : [writtenYmd, addDays(writtenYmd, -1)];
    const onDay = sessions.filter((s) => wanted.includes(s.dateYmd));
    const near = sessions.filter((s) => Math.abs(days(s.dateYmd, wanted[0])) <= 3);
    if (onDay.length) ev.push(V("SESSION_ON_DAY", `סשן ב-${fmt(onDay[0].dateYmd)} (${onDay[0].status})`, "SESSIONS"));
    else if (near.length) ev.push(S("SESSION_NEAR", `סשן קרוב: ${fmt(near[0].dateYmd)} (${near[0].status})`, "SESSIONS"));
    else if (sig.work.includes("SESSION") && sig.timeWords.length) ev.push(X("NO_SESSION_ON_DAY", `העדכון מדבר על סשן ב-${sig.timeWords.join("/")} — ואין לפרויקט סשן רשום סביב התאריך`, "SESSIONS"));
  }
  if (sig.work.includes("VIDEO")) {
    const prod = (g.ops?.redFilms?.rows ?? []).filter((r) => r.projectId === id && !["פורסם", "בוטל"].includes(r.status ?? ""));
    const meta = g.ops?.projectsMeta?.rows.find((m) => m.id === id);
    if (prod.length || meta?.projectType === "קליפ") ev.push(V("VIDEO_ACTIVE", "הפקת קליפ פעילה / פרויקט קליפ", "RED_FILMS"));
    else ev.push(X("NO_VIDEO_WORK", "העדכון מדבר על קליפ — ואין הפקה לפרויקט", "RED_FILMS"));
  }
  if (sig.work.includes("WRITING") && p.status && ["בעבודה", "לא התחיל"].includes(p.status)) ev.push(S("STATUS_MATCH", `סטטוס "${p.status}" מתאים לעבודה על השיר`, "PROJECTS"));

  // ── recency: what is moving NOW (Owner refinement E) ──
  const last = projectLastEventAt(g.src, id);
  if (last && Math.abs(days(writtenYmd, last)) <= 7) ev.push(S("RECENT_ACTIVITY", `פעילות רשומה אחרונה ${fmt(last.slice(0, 10))}`, "PROJECTS"));
  const acts = (g.ops?.projectActions?.rows ?? []).filter((a) => a.projectId === id && a.actionDate).map((a) => a.actionDate!).sort();
  if (acts.length && Math.abs(days(writtenYmd, acts.at(-1)!)) <= 7) ev.push(S("RECENT_ACTION", `שליחה / קבלה אחרונה ב-${fmt(acts.at(-1)!.slice(0, 10))}`, "PROJECT_ACTIONS"));
  const tasks = (st?.domains.tasksFull.data?.items ?? []).filter((t) => t.relatedType === "project" && t.relatedId === id && t.status === "פתוח");
  if (tasks.length) ev.push(S("OPEN_TASK", `${tasks.length} משימות פתוחות`, "TASKS"));
  const dl = st?.domains.projects.data?.open.find((o) => o.id === id)?.deadline.ymd ?? null;
  if (dl && days(dl, writtenYmd) >= 0 && days(dl, writtenYmd) <= 14) ev.push(S("DEADLINE_SOON", `דדליין ${fmt(dl)}`, "PROJECTS"));
  const blocker = activeKnowledge(g.knowledge, g.today).find((k) => k.kind === "PROJECT_BLOCKER" && (k.subjectKey === c.projectKey || k.identityKeys.includes(c.projectKey)));
  if (blocker) ev.push(I("OWNER_BLOCKER", blocker.meaningHe, "OWNER_KNOWLEDGE"));
}

const count = (c: Candidate, q: EvidenceQuality) => c.evidence.filter((e) => e.quality === q).length;
/** The decision (refinements D / I): a contradiction always loses; a name alone never beats a business contradiction. */
export function decide(cands: readonly Candidate[]): { status: "LIKELY" | "AMBIGUOUS" | "UNRESOLVED"; pick: Candidate | null; confidence: "HIGH" | "MEDIUM" | "LOW" | null } {
  const eligible = cands.filter((c) => count(c, "CONTRADICTION") === 0);
  if (!eligible.length) return { status: cands.length ? "UNRESOLVED" : "UNRESOLVED", pick: null, confidence: null };
  const vs = eligible.filter((c) => count(c, "VERY_STRONG") > 0);
  if (vs.length === 1) {
    const c = vs[0];
    return { status: "LIKELY", pick: c, confidence: count(c, "VERY_STRONG") >= 2 || count(c, "STRONG") >= 2 ? "HIGH" : "MEDIUM" };
  }
  if (vs.length > 1) {
    // several very strong: only the recency of what moves NOW may separate them (refinement K) — otherwise ask
    const rec = (c: Candidate) => c.evidence.filter((e) => ["RECENT_VERSION", "RECENT_ACTIVITY", "RECENT_ACTION", "SESSION_ON_DAY"].includes(e.code)).length;
    const ranked = [...vs].sort((a, b) => rec(b) - rec(a) || count(b, "VERY_STRONG") - count(a, "VERY_STRONG"));
    if (rec(ranked[0]) > 0 && rec(ranked[1]) === 0) return { status: "LIKELY", pick: ranked[0], confidence: "MEDIUM" };
    return { status: "AMBIGUOUS", pick: null, confidence: null };
  }
  const strong = eligible.filter((c) => count(c, "STRONG") >= 2);
  if (strong.length === 1 && eligible.every((c) => c === strong[0] || count(c, "STRONG") === 0)) return { status: "LIKELY", pick: strong[0], confidence: "MEDIUM" };
  // a single eligible candidate with ONLY weak evidence never wins over other (even contradicted) candidates — the Boss
  // chooses (One Brain 2026-10-05: "no engineer work" is weak, so it must not turn a name match into a pick)
  if (eligible.length === 1 && cands.length > 1 && count(eligible[0], "STRONG") === 0 && count(eligible[0], "VERY_STRONG") === 0) return { status: "AMBIGUOUS", pick: null, confidence: null };
  if (eligible.length === 1) return { status: "LIKELY", pick: eligible[0], confidence: "LOW" };
  return { status: "AMBIGUOUS", pick: null, confidence: null };
}

/** person → project → song / track only when linked → the work (refinement C: never invent a song). */
function chainOf(c: Candidate, sig: UpdateSignals, g: Graph): ChainLink[] {
  const id = c.projectKey.slice("project:".length);
  const meta = g.ops?.projectsMeta?.rows.find((m) => m.id === id);
  const p = g.projects.find((x) => x.key === c.projectKey)!;
  const out: ChainLink[] = [];
  if (c.personKey) out.push({ level: "PERSON", key: c.personKey, name: c.personName ?? c.personKey, quality: c.via === "ALIAS" ? "OWNER_ALIAS" : c.via === "RELEASE_LINK" ? "CANONICAL" : "TEXT_MATCH" });
  out.push({ level: "PROJECT", key: c.projectKey, name: p.name, quality: c.personKey ? (c.via === "RELEASE_LINK" ? "CANONICAL" : "TEXT_MATCH") : c.via === "ALIAS" ? "OWNER_ALIAS" : "TEXT_MATCH" });
  const type = meta?.projectType ?? null;
  const works = (g.ops?.engineerWork?.rows ?? []).filter((w) => w.projectId === id && !isClosedStatus(w.status));
  const tracks = (g.ops?.albumTracks?.rows ?? []).filter((t) => t.projectId === id);
  if (type === "שיר") out.push({ level: "SONG", key: c.projectKey, name: p.name, quality: "CANONICAL" });
  else if (meta?.songProjectId) {
    const song = g.projects.find((x) => x.key === `project:${meta.songProjectId}`);
    if (song) out.push({ level: "SONG", key: song.key, name: song.name, quality: "CANONICAL" });
  } else if (tracks.length) {
    // an album / EP: a track only when the active work's title IS one of its track titles (TEXT_MATCH) — never invented
    const t = tracks.find((tr) => works.some((w) => w.workTitle && normalizeName(w.workTitle) === normalizeName(tr.title)));
    if (t) out.push({ level: "TRACK", key: t.id ? `album-track:${t.id}` : null, name: t.title, quality: "TEXT_MATCH" });
  }
  if (sig.work.includes("MIX") && works.length) out.push({ level: "WORK", key: `mix-work:${works[0].id}`, name: `${works[0].workType ?? "מיקס"} אצל ${works[0].engineerName} (${works[0].status ?? "?"})`, quality: "CANONICAL" });
  const st = ok(g.src.state);
  const sess = (st?.domains.sessions.data?.items ?? []).filter((s) => s.projectId === id && sig.days.includes(s.dateYmd));
  if (sess.length) out.push({ level: "SESSION", key: `session:${sess[0].id}`, name: `סשן ${fmt(sess[0].dateYmd)} (${sess[0].status})`, quality: "CANONICAL" });
  return out;
}

/** OWNER_REPORTED vs VERIFIED RECORD (refinement J): what he says happened, and the record still says otherwise. */
function recordVsReport(c: Candidate, sig: UpdateSignals, g: Graph): string[] {
  const st = ok(g.src.state);
  const id = c.projectKey.slice("project:".length);
  const out: string[] = [];
  if (sig.reportsHappened) for (const s of (st?.domains.sessions.data?.items ?? []).filter((x) => x.projectId === id && sig.days.includes(x.dateYmd))) {
    if (s.status === "מתוכנן") out.push(`אמרת שהסשן התקיים — ברשומה הסשן מ-${fmt(s.dateYmd)} עדיין "מתוכנן" (כנראה צריך לעדכן; לא משנה לבד)`);
    else if (s.status === "התקיים" && s.statusSource === "AUTO_MARK") out.push(`אמרת שהסשן התקיים — ברשומה הסשן מ-${fmt(s.dateYmd)} סומן "התקיים" אוטומטית (זמן הסיום עבר); הדיווח שלך הוא האישור`);
  }
  return out;
}

function contextOf(c: Candidate, g: Graph): ChosenContext | null {
  const id = c.projectKey.slice("project:".length);
  try {
    const v = buildProjectView(g.src, id);
    const mem = buildProjectMemory(g.src, id);
    const blocker = activeKnowledge(g.knowledge, g.today).find((k) => k.kind === "PROJECT_BLOCKER" && (k.subjectKey === c.projectKey || k.identityKeys.includes(c.projectKey)));
    return { status: v.identity?.status ?? null, deadline: v.identity?.deadline ?? null, liveBall: canonicalBallOf(v.signals.map((s) => s.code)), lastSession: v.work.sessions?.last ?? null, nextSession: v.work.sessions?.next ?? null, openTasks: v.work.tasksOpen, blocker: blocker?.meaningHe ?? null, understanding: mem.understanding ? { freshness: mem.understanding.freshness, whatHappened: mem.understanding.whatHappened } : null };
  } catch { return null; }
}

/** Optional DEEP fallback: free-text mentions of an unresolved name in project / session / task notes — WEAK only. */
export function notesMentions(word: string, detail: ProjectDetailRaw | null, projects: readonly ResolverProject[]): string[] {
  if (!detail) return [];
  const n = normalizeName(word);
  const hit = (t: string | null | undefined) => !!t && normalizeName(t).split(" ").includes(n);
  const keys = new Set<string>();
  for (const p of detail.projects?.rows ?? []) if (hit(p.notes)) keys.add(`project:${p.id}`);
  for (const s of detail.sessions?.rows ?? []) if (s.projectId && (hit(s.notes) || hit(s.title))) keys.add(`project:${s.projectId}`);
  for (const t of detail.tasks?.rows ?? []) if (t.relatedType === "project" && t.relatedId && (hit(t.title) || hit(t.notes))) keys.add(`project:${t.relatedId}`);
  return [...keys].filter((k) => projects.some((p) => p.key === k)).sort();
}

export function resolveUpdate(item: OwnerInboxItem, g: Graph, deep = false): UnderstoodUpdateV2 {
  const sig = extractSignals(item.body, item.createdAt);
  const writtenYmd = ilYmd(item.createdAt);
  const { cands, names, unknownNames } = candidatesOf(item, g);
  const searched = ["שמות מלאים ופרטיים ברשומות (לקוחות, אמני לייבל, פרויקטים, צוות)", "כינויים שאישרת", ...(deep ? ["הערות פרויקטים / סשנים / משימות"] : [])];
  const missing: string[] = [];
  if (deep && unknownNames.length) {
    for (const w of unknownNames) for (const k of notesMentions(w, ok(g.src.projectDetail) as ProjectDetailRaw | null, g.projects)) {
      const p = g.projects.find((x) => x.key === k)!;
      if (!cands.some((c) => c.projectKey === k)) cands.push({ projectKey: k, projectName: p.name, personKey: null, personName: w, via: "CREDIT", evidence: [W("NOTES_MENTION", `"${w}" מופיע בהערות של הפרויקט (טקסט חופשי)`, "PROJECT_DETAIL")] });
    }
  }
  for (const c of cands) if (!c.evidence.some((e) => e.code === "NOTES_MENTION")) evidenceFor(c, sig, writtenYmd, g);
  const out = (resolution: Resolution, context: ChosenContext | null = null): UnderstoodUpdateV2 => ({ itemId: item.id, signals: { ...sig, names }, resolution, context });
  if (!cands.length) {
    // a team member named alone ("לתקן התראות של סטיבן") → that exact vendor identity (never a project guess)
    const vendors = [...new Set(findMentions(item.body, g.index).flatMap((m) => m.keys).filter((k) => k.startsWith("vendor:")))];
    if (vendors.length === 1 && !unknownNames.length) {
      const key = vendors[0], name = key === "vendor:STEVEN" ? "Steven" : key === "vendor:VICTOR" ? "Victor" : key;
      const ev = [S("TEAM_NAMED", `${name} נכתב בעדכון (איש צוות)`, "TEAM"), ...(sig.work.includes("SYSTEM") ? [S("SYSTEM_ITEM", "העדכון מדבר על המערכת עצמה (התראות / תקלה) — עניין טכני, לא התקדמות בפרויקט", "SIGNALS")] : [])];
      return out({ status: "LIKELY", confidence: "MEDIUM", chosen: { chain: [{ level: "VENDOR", key, name, quality: "CANONICAL" }], evidence: ev, recordVsReport: [] }, contradictions: [], alternatives: [], searched, missing: [] });
    }
    if (unknownNames.length) return out({ status: "UNRESOLVED", confidence: null, chosen: null, contradictions: [], alternatives: [], searched, missing: [`לא מצאתי ברשומות את: ${unknownNames.join(", ")}${deep ? "" : " (אפשר לחפש גם בהערות — mode deep)"}`] });
    return out({ status: "NONE", confidence: null, chosen: null, contradictions: [], alternatives: [], searched, missing: names.length ? ["השם לא מוביל לאף פרויקט פתוח"] : ["אין בעדכון שם / פרויקט — לא מנחשת לאיזה פרויקט הוא שייך"] });
  }
  // deep notes are WEAK only: they can never make a LIKELY by themselves (refinement F)
  const d = cands.every((c) => c.evidence.every((e) => e.code === "NOTES_MENTION")) ? { status: "AMBIGUOUS" as const, pick: null, confidence: null } : decide(cands);
  const ranked = [...cands].sort((a, b) => count(a, "CONTRADICTION") - count(b, "CONTRADICTION") || count(b, "VERY_STRONG") - count(a, "VERY_STRONG") || count(b, "STRONG") - count(a, "STRONG"));
  const alts = ranked.filter((c) => c !== d.pick).slice(0, 2).map((c) => ({ project: c.projectName, person: c.personName, evidence: c.evidence.filter((e) => e.quality !== "INFO").map((e) => `${e.code}${e.quality === "CONTRADICTION" ? "!" : ""}`) }));
  const contradictions = cands.flatMap((c) => c.evidence.filter((e) => e.quality === "CONTRADICTION").map((e) => ({ ...e, he: `${c.projectName}: ${e.he}` }))).slice(0, 4);
  if (unknownNames.length) missing.push(`לא מצאתי ברשומות את: ${unknownNames.join(", ")}`);
  if (d.status !== "LIKELY" || !d.pick) return out({ status: d.status, confidence: null, chosen: null, contradictions, alternatives: alts, searched, missing });
  return out({ status: "LIKELY", confidence: d.confidence, chosen: { chain: chainOf(d.pick, sig, g), evidence: d.pick.evidence, recordVsReport: recordVsReport(d.pick, sig, g) }, contradictions, alternatives: alts, searched, missing }, contextOf(d.pick, g));
}

export function graphOf(src: GatewaySources, index: readonly MentionEntry[], projects: readonly ResolverProject[]): Graph {
  const st = ok(src.state);
  return { index, projects, src, ops: ok(src.operations) as OperationsRaw | null, knowledge: ok(src.ownerKnowledge) ?? [], today: st?.todayIL ?? src.now.toISOString().slice(0, 10) };
}
