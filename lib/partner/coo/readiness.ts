/**
 * Sunny COO — OPERATIONAL READINESS (pure, interaction time only). For every meaningful upcoming event — a shoot, a
 * show, a release, an important session, a business meeting, a client deadline — what should be ready, what a record
 * CONFIRMS, what Sunny does NOT SEE, what is OPEN / BLOCKED, and what needs the Owner. No hardcoded project, no DB
 * status, no write. Not every event needs every item: an optional check never makes an event "not ready" by itself.
 *
 * Sources (composed, never re-read): the production view (crew names, locations, concept, documents by type,
 * references, tasks, budget lines), the project view (money, engineers, sessions, release, song ↔ clip link), the show
 * view (DJ, rehearsals, notifications, money), the release records (next action / blocker / responsible), the live
 * calendar (only as context for time / place — never a business fact), project operating (ball holder).
 */
import type { CooCtx } from "./context";
import { calendarFor, hmOf } from "./context";
import { moneyReadiness, type ProductionMoneyInput } from "./money";
import { check, daysBetween, ev, finishReadiness, has, INTERNAL_COO_HEURISTICS, isYmd, type Check, type Readiness } from "./model";
import type { VideoProduction } from "../redfilms/view";
import { completionEvidence, stageBehind, STAGE_UNCERTAINTY_HE } from "./stage";

/** a deadline this close makes a stage that is still before the mix an OPEN readiness item (internal window, not policy) */
export const MOTION_STAGE_DAYS = 7;

const SHOOT_SESSION = "צילום קליפ";
/** Production statuses at or after the shoot (the app's own list, as in lib/partner/redfilms/view.ts). */
const SHOT_OR_LATER = new Set(["צולם", "חומרי גלם הועלו", "בעריכה", "נשלחה גרסה", "תיקונים", "מאושר", "פורסם"]);
const RELEASE_DONE = new Set(["יצא", "בהשהייה"]);
const CLOSED_PROJECT = new Set(["הושלם", "בוטל", "בהשהייה"]);
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").trim().toLowerCase();
/** a clip project's name without the word "קליפ" — only to SAY a similar-named song exists; never a link. */
const baseName = (s: string) => norm(s).replace(/[-–—|:()]/g, " ").split(/\s+/).filter((w) => w && w !== "קליפ" && w !== "clip" && w !== "הקליפ").join(" ");

function inWindow(c: CooCtx, ymd: string | null, horizon: number): ymd is string {
  if (!isYmd(ymd)) return false;
  const d = daysBetween(c.today, ymd);
  return d >= 0 && d <= horizon;
}

/** Song ↔ clip: the ONLY link is the clip project's song_project_id. A similar name is said, never linked. */
export function songOfClip(c: CooCtx, clipProjectId: string): { song: { id: string; name: string | null } | null; similarNameNoLink: string[] } {
  const v = c.project(clipProjectId);
  const link = v.identity?.songProject;
  if (link && link.quality === "CANONICAL_RELATION") return { song: { id: link.value.key.slice("project:".length), name: link.value.name }, similarNameNoLink: [] };
  const name = v.identity?.name ?? "";
  const b = baseName(name);
  const all = (c.ops?.projectsMeta?.rows ?? []).map((p) => ({ id: p.id, name: p.name }));
  const similar = b.length >= 2 ? all.filter((p) => p.id !== clipProjectId && baseName(p.name) === b).map((p) => p.name) : [];
  return { song: null, similarNameNoLink: similar };
}

// ───────────────────────────── SHOOT ─────────────────────────────

function shootChecks(c: CooCtx, p: VideoProduction, date: string): { checks: Check[]; insights: string[]; facts: string[]; sources: string[] } {
  const checks: Check[] = [];
  const insights: string[] = [];
  const facts: string[] = [];
  const ref = p.key;
  const sess = p.shoot.sessions.filter((s) => s.date === date || !s.date);
  const cal = calendarFor(c, date, [...(p.project ? [p.project.key] : []), ref]);
  // LOGISTICS
  checks.push(check("logistics.date", "LOGISTICS", "תאריך הצילום", "CONFIRMED", `תאריך הצילום רשום: ${date.slice(8, 10)}.${date.slice(5, 7)}.`, [ev("RED_FILMS", ref, "shoot_date")]));
  const sTime = sess.find((s) => s.start)?.start ?? null;
  const calTime = cal.find((l) => !l.event.allDay)?.event.start ?? null;
  checks.push(sTime ? check("logistics.time", "LOGISTICS", "שעת הצילום", "CONFIRMED", `שעה רשומה בסשן הצילום: ${sTime.slice(0, 5)}.`, [ev("SESSIONS", ref, "shoot session start_time")])
    : calTime ? check("logistics.time", "LOGISTICS", "שעת הצילום", "CONFIRMED", `ביומן יש אירוע קשור ב-${hmOf(calTime)} (הקשר ביומן, לא רשומת Redbloods).`, [ev("CALENDAR", null, cal[0].quality)])
    : check("logistics.time", "LOGISTICS", "שעת הצילום", "NOT_SEEN", "אני לא רואה שעת צילום רשומה (לא בסשן ולא ביומן).", [ev("RED_FILMS", ref, "no shoot session time / calendar event")]));
  const loc = p.shoot.locations ?? sess.find((s) => s.location)?.location ?? cal.find((l) => l.event.location)?.event.location ?? null;
  checks.push(has(loc) ? check("logistics.location", "LOGISTICS", "לוקיישן", "CONFIRMED", `לוקיישן רשום: ${String(loc).slice(0, 80)}.`, [ev(p.shoot.locations ? "RED_FILMS" : sess.some((s) => s.location) ? "SESSIONS" : "CALENDAR", ref, "location")])
    : check("logistics.location", "LOGISTICS", "לוקיישן", "NOT_SEEN", "אני לא רואה לוקיישן רשום לצילום.", [ev("RED_FILMS", ref, "locations empty")]));
  const permits = p.files.documents.filter((d) => d.type === "אישור / חוזה");
  if (permits.length) checks.push(check("logistics.permits", "LOGISTICS", "אישורים / חוזה", "CONFIRMED", `יש מסמך אישור / חוזה בהפקה (${permits.length}).`, [ev("RED_FILMS", ref, "document type אישור / חוזה")], false));
  const schedule = p.files.documents.filter((d) => d.type === "לו״ז צילום");
  if (schedule.length) checks.push(check("logistics.schedule", "LOGISTICS", "לו״ז צילום", "CONFIRMED", "יש לו״ז צילום מצורף להפקה.", [ev("RED_FILMS", ref, "document type לו״ז צילום")], false));
  // PEOPLE
  const filming = [p.crew.photographer && `צלם: ${p.crew.photographer}`, p.crew.director && `במאי: ${p.crew.director}`].filter(Boolean) as string[];
  const sessPhotog = sess.find((s) => s.photographer)?.photographer ?? null;
  checks.push(filming.length || sessPhotog ? check("people.filming", "PEOPLE", "צלם / במאי", "CONFIRMED", `${filming.length ? filming.join(", ") : `צלם בסשן: ${sessPhotog}`} (שם חופשי, בלי רשומת איש צוות).`, [ev("RED_FILMS", ref, "crew names")])
    : check("people.filming", "PEOPLE", "צלם / במאי", "NOT_SEEN", "אני לא רואה צלם או במאי רשומים להפקה.", [ev("RED_FILMS", ref, "photographer / director empty")]));
  const artist = p.artistText ?? (p.project ? c.project(p.project.key.slice(8)).identity?.artistText ?? null : null);
  checks.push(has(artist) ? check("people.talent", "PEOPLE", "אמן / טאלנט", "CONFIRMED", `אמן: ${artist}.`, [ev("RED_FILMS", ref, "artist_name")])
    : check("people.talent", "PEOPLE", "אמן / טאלנט", "NOT_SEEN", "אני לא רואה אמן רשום להפקה.", [ev("RED_FILMS", ref, "artist empty")]));
  checks.push(check("people.confirmations", "PEOPLE", "אישורי הגעה של הצוות", "NOT_SEEN", "Redbloods לא שומרת אישורי הגעה לצוות — אם הצוות אישר, זה לא מחובר אליי.", [ev("SYSTEM_CONTRACTS", null, "red_films_crew is a legacy unused table")], false));
  // CREATIVE
  const concept = p.concept.summary ?? p.concept.vibe ?? (p.concept.script && (p.concept.script.start || p.concept.script.middle || p.concept.script.end) ? "תסריט" : null);
  const scriptDocs = p.files.documents.filter((d) => d.type === "תסריט" || d.type === "בריף");
  checks.push(has(concept) || scriptDocs.length ? check("creative.concept", "CREATIVE", "קונספט / כיוון קריאייטיבי", "CONFIRMED", has(concept) ? `יש קונספט / תסריט רשום בהפקה${p.concept.summary ? `: ${String(p.concept.summary).slice(0, 60)}` : ""}.` : `יש מסמך ${scriptDocs[0].type} מצורף.`, [ev("RED_FILMS", ref, "concept / script")])
    : check("creative.concept", "CREATIVE", "קונספט / כיוון קריאייטיבי", "NOT_SEEN", "אני לא רואה קונספט, תסריט או בריף שמחוברים למידע שלי.", [ev("RED_FILMS", ref, "concept empty, no script / brief document")]));
  const shotlist = p.files.documents.filter((d) => d.type === "שוט ליסט");
  checks.push(shotlist.length ? check("creative.shotlist", "CREATIVE", "שוט ליסט", "CONFIRMED", "יש שוט ליסט מצורף להפקה.", [ev("RED_FILMS", ref, "document type שוט ליסט")], false)
    : check("creative.shotlist", "CREATIVE", "שוט ליסט", "NOT_SEEN", "אני לא רואה שוט ליסט שמחובר למידע שלי.", [ev("RED_FILMS", ref, "no document of type שוט ליסט")], false));
  const refs = p.files.referenceImages + p.files.referenceLinks.length + (p.concept.hasReferenceLinksText ? 1 : 0);
  if (refs) checks.push(check("creative.references", "CREATIVE", "רפרנסים", "CONFIRMED", `יש רפרנסים בהפקה (${refs}).`, [ev("RED_FILMS", ref, "reference images / links")], false));
  if (p.project) {
    const so = songOfClip(c, p.project.key.slice(8));
    if (so.song) {
      const sv = c.project(so.song.id);
      const eng = sv.work.engineers ?? [];
      const approved = eng.some((w) => w.status === "אושר" || w.finalFiles > 0);
      const open = eng.some((w) => !["אושר", "בוטל"].includes(w.status ?? ""));
      checks.push(approved ? check("creative.playback", "CREATIVE", "גרסה סופית של השיר (פלייבק)", "CONFIRMED", `לשיר "${so.song.name}" יש מיקס / מאסטר מאושר או קבצים סופיים.`, [ev("MIX", `project:${so.song.id}`, "engineer work אושר / final files")], false)
        : open ? check("creative.playback", "CREATIVE", "גרסה סופית של השיר (פלייבק)", "OPEN", `השיר "${so.song.name}" עדיין אצל מהנדס — לא רואה גרסה מאושרת לפלייבק.`, [ev("MIX", `project:${so.song.id}`, "engineer work open")], false)
        : check("creative.playback", "CREATIVE", "גרסה סופית של השיר (פלייבק)", "NOT_SEEN", `אני לא רואה מיקס / מאסטר רשום לשיר "${so.song.name}".`, [ev("MIX", `project:${so.song.id}`, "no engineer work")], false));
    } else if (so.similarNameNoLink.length) insights.push(`נראה שיש שיר עם שם דומה (${so.similarNameNoLink.slice(0, 2).join(", ")}), אבל אני לא רואה קישור קנוני בין הקליפ לשיר — לא מניחה שזה אותו פרויקט.`);
  }
  // EQUIPMENT
  const eqDocs = p.files.documents.filter((d) => d.type === "ציוד");
  checks.push(eqDocs.length ? check("equipment.list", "EQUIPMENT", "רשימת ציוד", "CONFIRMED", "יש מסמך ציוד מצורף להפקה.", [ev("RED_FILMS", ref, "document type ציוד")], false)
    : check("equipment.list", "EQUIPMENT", "רשימת ציוד", "NOT_SEEN", "אני לא רואה רשימת ציוד משויכת להפקה (מלאי הציוד ב-Redbloods לא משויך להפקות).", [ev("RED_FILMS", ref, "no ציוד document; equipment inventory is company-level")], false));
  // DEPENDENCIES — production tasks
  const openTasks = p.tasks.filter((t) => t.status !== "הושלם" && t.status !== "בוטל");
  const dueBefore = openTasks.filter((t) => isYmd(t.due) && t.due <= date);
  if (dueBefore.length) checks.push(check("deps.tasks", "DEPENDENCIES", "משימות לפני הצילום", "OPEN", `משימות פתוחות עם מועד עד הצילום: ${dueBefore.map((t) => t.title ?? "משימה").slice(0, 3).join(", ")}.`, [ev("TASKS", ref, "production tasks due ≤ shoot date")]));
  else if (openTasks.length) checks.push(check("deps.tasks", "DEPENDENCIES", "משימות פתוחות בהפקה", "OPEN", `${openTasks.length} משימות פתוחות בהפקה (בלי מועד לפני הצילום).`, [ev("TASKS", ref, "open production tasks")], false));
  if (p.status === "בוטל") checks.push(check("deps.status", "DEPENDENCIES", "סטטוס ההפקה", "BLOCKED", "ההפקה מסומנת בוטל.", [ev("RED_FILMS", ref, "status בוטל")]));
  // AFTER
  checks.push(p.crew.editor ? check("after.editor", "AFTER", "עורך", "CONFIRMED", `עורך: ${p.crew.editor}.`, [ev("RED_FILMS", ref, "editor")], false)
    : check("after.editor", "AFTER", "עורך", "NOT_SEEN", "אני לא רואה עורך רשום לאחרי הצילום.", [ev("RED_FILMS", ref, "editor empty")], false));
  if (p.publication.publishDate) facts.push(`יעד פרסום רשום: ${p.publication.publishDate}.`);
  return { checks, insights, facts, sources: ["RED_FILMS", "SESSIONS", ...(c.calReadable ? ["CALENDAR"] : [])] };
}

const prodMoney = (p: VideoProduction): ProductionMoneyInput => ({
  id: p.id, key: p.key, title: p.title, clientPrice: p.money.clientPrice, advanceRequired: p.money.advanceRequired, advanceReceived: p.money.advanceReceived,
  lines: p.money.lines.map((l) => ({ title: l.title, category: l.category, storedStatus: l.storedStatus, remaining: typeof l.remaining === "number" ? l.remaining : null, currency: l.currency })),
});

export function shootReadiness(c: CooCtx, productionId: string): Readiness | null {
  const p = c.production(productionId);
  if (!p || !isYmd(p.shoot.productionShootDate)) return null;
  const date = p.shoot.productionShootDate;
  const s = shootChecks(c, p, date);
  const projectId = p.project?.key.slice(8) ?? null;
  const m = moneyReadiness(projectId ? c.project(projectId) : null, { labelWork: projectId ? c.isLabel(projectId) : false, productions: [prodMoney(p)], financeReadable: c.financeReadable });
  const checks = [...s.checks, ...m.checks];
  return finishReadiness({
    key: `readiness:${p.key}`, kind: "SHOOT", titleHe: p.title, date, time: p.shoot.sessions.find((x) => x.date === date && x.start)?.start?.slice(0, 5) ?? null, daysTo: daysBetween(c.today, date),
    entity: p.key, project: p.project?.key ?? null, checks, insights: s.insights, facts: [...s.facts, ...m.facts], sources: [...s.sources, "FINANCE"], coreReadable: !!c.det,
  });
}

/** A shoot session with no Red Films production behind it (the project side only). */
function sessionShootReadiness(c: CooCtx, s: { id: string; projectId: string | null; date: string; startTime: string | null; location: string | null; photographer: string | null }): Readiness {
  const checks: Check[] = [];
  const pk = s.projectId ? `project:${s.projectId}` : null;
  checks.push(check("logistics.date", "LOGISTICS", "תאריך הצילום", "CONFIRMED", `סשן צילום רשום ב-${s.date.slice(8, 10)}.${s.date.slice(5, 7)}.`, [ev("SESSIONS", `session:${s.id}`, "session type צילום קליפ")]));
  checks.push(s.startTime ? check("logistics.time", "LOGISTICS", "שעת הצילום", "CONFIRMED", `שעה: ${s.startTime.slice(0, 5)}.`, [ev("SESSIONS", `session:${s.id}`, "start_time")]) : check("logistics.time", "LOGISTICS", "שעת הצילום", "NOT_SEEN", "אני לא רואה שעה רשומה לסשן הצילום.", []));
  checks.push(s.location ? check("logistics.location", "LOGISTICS", "לוקיישן", "CONFIRMED", `לוקיישן: ${s.location}.`, [ev("SESSIONS", `session:${s.id}`, "location")]) : check("logistics.location", "LOGISTICS", "לוקיישן", "NOT_SEEN", "אני לא רואה לוקיישן רשום לסשן הצילום.", []));
  checks.push(s.photographer ? check("people.filming", "PEOPLE", "צלם", "CONFIRMED", `צלם: ${s.photographer}.`, [ev("SESSIONS", `session:${s.id}`, "photographer")]) : check("people.filming", "PEOPLE", "צלם", "NOT_SEEN", "אני לא רואה צלם רשום לסשן הצילום.", []));
  checks.push(check("creative.production", "CREATIVE", "הפקת Red Films", "NOT_SEEN", "אני לא רואה הפקת Red Films מקושרת לסשן הזה — קונספט, שוט ליסט ותקציב לא מחוברים אליי.", [], false));
  const m = moneyReadiness(s.projectId ? c.project(s.projectId) : null, { labelWork: s.projectId ? c.isLabel(s.projectId) : false, financeReadable: c.financeReadable });
  return finishReadiness({ key: `readiness:session:${s.id}`, kind: "SHOOT", titleHe: c.projectName(s.projectId) ?? "צילום", date: s.date, time: s.startTime?.slice(0, 5) ?? null, daysTo: daysBetween(c.today, s.date), entity: `session:${s.id}`, project: pk, checks: [...checks, ...m.checks], insights: [], facts: m.facts, sources: ["SESSIONS", "FINANCE"], coreReadable: true });
}

// ───────────────────────────── SHOW ─────────────────────────────

export function showReadiness(c: CooCtx, showId: string): Readiness | null {
  const v = c.show(showId);
  const eyes = c.st?.domains.shows.data?.items.find((s) => s.id === showId) ?? null;
  const date = v?.identity.date ?? eyes?.dateYmd ?? null;
  if (!isYmd(date)) return null;
  const checks: Check[] = [];
  const key = `show:${showId}`;
  const name = v?.identity.name ?? eyes?.name ?? "הופעה";
  const status = v?.identity.status ?? eyes?.status ?? null;
  if (status === "בוטל") checks.push(check("deps.status", "DEPENDENCIES", "סטטוס", "BLOCKED", "ההופעה מסומנת בוטל.", [ev("SHOWS", key, "status בוטל")]));
  checks.push(check("logistics.date", "LOGISTICS", "תאריך", "CONFIRMED", `תאריך ההופעה: ${date.slice(8, 10)}.${date.slice(5, 7)}${status ? ` (סטטוס: ${status})` : ""}.`, [ev("SHOWS", key, "date")]));
  if (v) {
    checks.push(v.identity.time ? check("logistics.time", "LOGISTICS", "שעה", "CONFIRMED", `שעה: ${String(v.identity.time).slice(0, 5)}.`, [ev("SHOWS", key, "start_time")]) : check("logistics.time", "LOGISTICS", "שעה", "NOT_SEEN", "אני לא רואה שעה רשומה להופעה.", [ev("SHOWS", key, "start_time empty")]));
    checks.push(v.identity.location ? check("logistics.location", "LOGISTICS", "מקום", "CONFIRMED", `מקום: ${v.identity.location}.`, [ev("SHOWS", key, "location")]) : check("logistics.location", "LOGISTICS", "מקום", "NOT_SEEN", "אני לא רואה מקום רשום להופעה.", [ev("SHOWS", key, "location empty")]));
    const unpaidCollab = v.money.dealType === "UNPAID_COLLAB";
    const dj = v.dj as { displayName?: string | null; confirmation?: string | null; isLabelDj?: boolean } | null;
    if (!unpaidCollab || dj) {
      checks.push(!dj ? check("people.dj", "PEOPLE", "DJ", "NOT_SEEN", "אני לא רואה DJ רשום להופעה (לא משבצת אוטומטית).", [ev("SHOWS", key, "dj_client_id empty")])
        : !dj.isLabelDj ? check("people.dj", "PEOPLE", "DJ", "CONFIRMED", `DJ ${dj.displayName ?? ""} רשום (מנגנון אישור קיים רק ל-CLEANTONE).`, [ev("SHOWS", key, "dj_client_id")])
        : dj.confirmation === "אושר" ? check("people.dj", "PEOPLE", "DJ", "CONFIRMED", `DJ ${dj.displayName ?? ""} אישר.`, [ev("SHOWS", key, "dj confirmation אושר")])
        : check("people.dj", "PEOPLE", "אישור DJ", "OPEN", `DJ ${dj.displayName ?? ""} רשום, אישור: ${dj.confirmation ?? "לא רשום"}.`, [ev("SHOWS", key, "dj confirmation not confirmed")]));
    }
    const artistNote = v.notifications.artist as { state?: string };
    checks.push(artistNote.state === "SENT" ? check("people.artist", "PEOPLE", "עדכון לאמן", "CONFIRMED", "פרטי ההופעה נשלחו לאמן.", [ev("SHOWS", key, "artist notified")], false)
      : artistNote.state === "SENT_PREVIOUS_VERSION" ? check("people.artist", "PEOPLE", "עדכון לאמן", "OPEN", "נשלח לאמן, אבל הפרטים השתנו מאז.", [ev("SHOWS", key, "artist notified, outdated")], false)
      : artistNote.state === "NOT_SENT" ? check("people.artist", "PEOPLE", "עדכון לאמן", "NOT_SEEN", "אני לא רואה שליחה של פרטי ההופעה לאמן.", [ev("SHOWS", key, "not sent")], false)
      : check("people.artist", "PEOPLE", "עדכון לאמן", "UNREADABLE", "מצב השליחה לאמן לא נקרא.", [], false));
    const reh = v.rehearsals.filter((r) => r.date && r.date <= date);
    if (reh.length) checks.push(check("deps.rehearsals", "DEPENDENCIES", "חזרות", "CONFIRMED", `${reh.length} חזרות רשומות לפני ההופעה.`, [ev("SESSIONS", key, "rehearsal sessions")], false));
    if (!unpaidCollab && v.money.price) checks.push(check("money.price", "MONEY", "מחיר ההופעה", "CONFIRMED", `מחיר רשום: ${v.money.currency ?? "₪"}${v.money.price}.`, [ev("SHOWS", key, "show price")], false));
    if (!unpaidCollab && !v.money.price) checks.push(check("money.price", "MONEY", "מחיר ההופעה", "NOT_SEEN", "אני לא רואה מחיר רשום להופעה.", [ev("SHOWS", key, "price empty")], false));
  } else checks.push(check("show.detail", "LOGISTICS", "פרטי ההופעה", "UNREADABLE", "פרטי ההופעה המלאים לא נקראו בבקשה הזו.", [], true));
  return finishReadiness({ key: `readiness:${key}`, kind: "SHOW", titleHe: name, date, time: v?.identity.time ? String(v.identity.time).slice(0, 5) : null, daysTo: daysBetween(c.today, date), entity: key, project: null, checks, insights: v ? [] : ["פרטי ההופעה המלאים (DJ, חזרות, שליחה לאמן) לא נקראו — לא ידוע, לא 'לא מוכן'."], sources: ["SHOWS", "SESSIONS", "SETTINGS"], coreReadable: !!c.st && !!v });
}

// ───────────────────────────── RELEASE ─────────────────────────────

export function releaseReadiness(c: CooCtx, projectId: string): Readiness | null {
  const r = c.st?.domains.releasesFull.data?.items.find((x) => x.projectId === projectId) ?? null;
  if (!r || RELEASE_DONE.has(r.stage)) return null;
  const d = c.det?.releases?.rows.find((x) => x.projectId === projectId) ?? null;
  const v = c.project(projectId);
  const key = `release:${projectId}`, pk = `project:${projectId}`;
  const checks: Check[] = [];
  if (d?.blocker) checks.push(check("deps.blocker", "DEPENDENCIES", "חסם רשום", "BLOCKED", `חסם רשום בריליס: ${d.blocker}.`, [ev("RELEASES", key, "release blocker")]));
  checks.push(r.targetYmd ? check("logistics.target", "LOGISTICS", "תאריך יעד", "CONFIRMED", `תאריך יעד: ${r.targetYmd} (שלב: ${r.stage}).`, [ev("RELEASES", key, "target_date + stage")]) : check("logistics.target", "LOGISTICS", "תאריך יעד", "NOT_SEEN", `אני לא רואה תאריך יעד לריליס (שלב: ${r.stage}).`, [ev("RELEASES", key, "target_date empty")]));
  checks.push(d?.nextAction ? check("deps.next", "DEPENDENCIES", "הצעד הבא", "CONFIRMED", `הצעד הבא הרשום: ${d.nextAction}.`, [ev("RELEASES", key, "next_action")]) : check("deps.next", "DEPENDENCIES", "הצעד הבא", c.det ? "NOT_SEEN" : "UNREADABLE", "אני לא רואה צעד הבא רשום לריליס.", [ev("RELEASES", key, "next_action empty")]));
  checks.push(d?.responsible ? check("people.responsible", "PEOPLE", "אחראי", "CONFIRMED", `אחראי: ${d.responsible}.`, [ev("RELEASES", key, "responsible")], false) : check("people.responsible", "PEOPLE", "אחראי", c.det ? "NOT_SEEN" : "UNREADABLE", "אני לא רואה אחראי רשום לריליס.", [], false));
  const eng = v.work.engineers ?? [];
  const finalReady = eng.some((w) => (w.workType ?? "").includes("מאסטר") && (w.status === "אושר" || w.finalFiles > 0)) || eng.some((w) => w.finalFiles > 0);
  const openEng = eng.filter((w) => !["אושר", "בוטל"].includes(w.status ?? ""));
  checks.push(finalReady ? check("assets.master", "EQUIPMENT", "מאסטר / קבצים סופיים", "CONFIRMED", "יש מאסטר מאושר או קבצים סופיים רשומים.", [ev("MIX", pk, "master אושר / final files")])
    : openEng.length ? check("assets.master", "EQUIPMENT", "מאסטר / קבצים סופיים", "OPEN", `עבודת ${openEng.map((w) => `${w.workType ?? "מיקס"} אצל ${w.engineer}`).slice(0, 2).join(", ")} עוד פתוחה.`, [ev("MIX", pk, "engineer work open")])
    : check("assets.master", "EQUIPMENT", "מאסטר / קבצים סופיים", "NOT_SEEN", "אני לא רואה מאסטר מאושר או קבצים סופיים שמחוברים למידע שלי.", [ev("MIX", pk, "no engineer work / final files")]));
  if (v.work.victor?.length) checks.push(check("deps.victor", "DEPENDENCIES", "הפקה אצל ויקטור", "OPEN", "יש עבודת הפקה פתוחה אצל ויקטור.", [ev("TEAM_VICTOR", pk, "victor work active")]));
  if (v.work.social) checks.push(check("after.social", "AFTER", "קמפיין סושיאל", "CONFIRMED", `יש קמפיין סושיאל (סטטוס: ${v.work.social.status ?? "?"}).`, [ev("SOCIAL", pk, "social campaign")], false));
  else checks.push(check("after.social", "AFTER", "קמפיין סושיאל", "NOT_SEEN", "אני לא רואה קמפיין סושיאל מחובר לריליס (ריליס לא מחייב קליפ או קמפיין).", [], false));
  const facts = v.identity?.clipProjects.length ? [`יש קליפ מקושר: ${v.identity.clipProjects.map((x) => x.value.name).join(", ")} — פרויקט נפרד.`] : [];
  return finishReadiness({ key: `readiness:${key}`, kind: "RELEASE", titleHe: v.identity?.name ?? c.projectName(projectId) ?? "ריליס", date: r.targetYmd, time: null, daysTo: r.targetYmd ? daysBetween(c.today, r.targetYmd) : null, entity: key, project: pk, checks, insights: [], facts, sources: ["RELEASES", "MIX", "TEAM_VICTOR", "SOCIAL"], coreReadable: !!c.st });
}

// ───────────────────────────── SESSION / MEETING / DEADLINE ─────────────────────────────

/** A session that matters for the business: linked to label work, or to a project whose deadline / release is inside the horizon. */
function importantSession(c: CooCtx, projectId: string | null, horizon: number): boolean {
  if (!projectId) return false;
  if (c.isLabel(projectId)) return true;
  const v = c.project(projectId);
  const dl = v.identity?.deadline ?? null;
  const rt = v.work.release?.targetDate ?? null;
  return inWindow(c, dl, horizon) || inWindow(c, rt, horizon);
}

export function sessionReadiness(c: CooCtx, s: { id: string; projectId: string | null; date: string; startTime: string | null; type: string | null; location?: string | null; hasCalendarEvent?: boolean }): Readiness {
  const checks: Check[] = [];
  const sk = `session:${s.id}`, pk = s.projectId ? `project:${s.projectId}` : null;
  checks.push(check("logistics.date", "LOGISTICS", "תאריך", "CONFIRMED", `${s.type ?? "סשן"} רשום ב-${s.date.slice(8, 10)}.${s.date.slice(5, 7)}.`, [ev("SESSIONS", sk, "session date")]));
  checks.push(s.startTime ? check("logistics.time", "LOGISTICS", "שעה", "CONFIRMED", `שעה: ${s.startTime.slice(0, 5)}.`, [ev("SESSIONS", sk, "start_time")]) : check("logistics.time", "LOGISTICS", "שעה", "NOT_SEEN", "אני לא רואה שעה רשומה לסשן.", [ev("SESSIONS", sk, "start_time empty")]));
  if (s.hasCalendarEvent === true) checks.push(check("logistics.calendar", "LOGISTICS", "ביומן", "CONFIRMED", "הסשן מקושר לאירוע ביומן.", [ev("SESSIONS", sk, "calendar event id stored")], false));
  else if (s.hasCalendarEvent === false) checks.push(check("logistics.calendar", "LOGISTICS", "ביומן", "NOT_SEEN", "אני לא רואה אירוע יומן מקושר לסשן.", [ev("SESSIONS", sk, "no calendar event id")], false));
  if (pk) {
    const v = c.project(s.projectId!);
    if (v.identity && CLOSED_PROJECT.has(v.identity.status ?? "")) checks.push(check("deps.project", "DEPENDENCIES", "סטטוס הפרויקט", "OPEN", `הפרויקט מסומן ${v.identity.status} — לבדוק שהסשן עדיין רלוונטי.`, [ev("PROJECTS", pk, "project status")]));
    const owner = c.operating(s.projectId!)?.ballHolder.holders.some((h) => h === "OWNER" || h === "WAITING_FOR_OWNER");
    if (owner) checks.push(check("deps.owner", "OWNER_DECISION", "משהו מחכה לך בפרויקט", "OPEN", "לפי הרשומות יש בפרויקט משהו שמחכה לך — כדאי לסגור לפני הסשן.", [ev("PROJECTS", pk, "ball holder OWNER")], false));
  } else checks.push(check("deps.project", "DEPENDENCIES", "פרויקט מקושר", "NOT_SEEN", "הסשן לא מקושר לפרויקט — אני לא יודעת על מה הוא.", [ev("SESSIONS", sk, "project_id empty")], false));
  return finishReadiness({ key: `readiness:${sk}`, kind: "SESSION", titleHe: c.projectName(s.projectId) ?? s.type ?? "סשן", date: s.date, time: s.startTime?.slice(0, 5) ?? null, daysTo: daysBetween(c.today, s.date), entity: sk, project: pk, checks, insights: [], sources: ["SESSIONS", "PROJECTS"], coreReadable: true });
}

function meetingReadiness(c: CooCtx, m: { id: string; date: string; time: string | null; projectId: string | null; clientId: string | null; clientName?: string | null; location?: string | null; hasCalendarEvent: boolean }): Readiness {
  const mk = `meeting:${m.id}`;
  const checks: Check[] = [
    check("logistics.date", "LOGISTICS", "תאריך", "CONFIRMED", `פגישה רשומה ב-${m.date.slice(8, 10)}.${m.date.slice(5, 7)}.`, [ev("MEETINGS", mk, "date")]),
    m.time ? check("logistics.time", "LOGISTICS", "שעה", "CONFIRMED", `שעה: ${m.time.slice(0, 5)}.`, [ev("MEETINGS", mk, "time")]) : check("logistics.time", "LOGISTICS", "שעה", "NOT_SEEN", "אני לא רואה שעה רשומה לפגישה.", []),
    m.clientId || m.projectId ? check("people.who", "PEOPLE", "עם מי", "CONFIRMED", `הפגישה מקושרת ל${m.clientId ? `לקוח${m.clientName ? ` ${m.clientName}` : ""}` : "פרויקט"}.`, [ev("MEETINGS", mk, "client / project id")], false) : check("people.who", "PEOPLE", "עם מי", "NOT_SEEN", "הפגישה לא מקושרת ללקוח או לפרויקט.", [], false),
  ];
  return finishReadiness({ key: `readiness:${mk}`, kind: "MEETING", titleHe: m.clientName ?? c.projectName(m.projectId) ?? "פגישה", date: m.date, time: m.time?.slice(0, 5) ?? null, daysTo: daysBetween(c.today, m.date), entity: mk, project: m.projectId ? `project:${m.projectId}` : null, checks, insights: [], sources: ["MEETINGS"], coreReadable: true });
}

export function deadlineReadiness(c: CooCtx, projectId: string): Readiness | null {
  const v = c.project(projectId);
  const dl = v.identity?.deadline ?? null;
  if (!v.identity || !isYmd(dl) || CLOSED_PROJECT.has(v.identity.status ?? "")) return null;
  const pk = `project:${projectId}`;
  const checks: Check[] = [check("logistics.deadline", "LOGISTICS", "דדליין", "CONFIRMED", `דדליין ללקוח: ${dl} (התחייבות ללקוח).`, [ev("PROJECTS", pk, "project deadline")])];
  const openEng = (v.work.engineers ?? []).filter((w) => !["אושר", "בוטל"].includes(w.status ?? ""));
  if (openEng.length) checks.push(check("deps.engineer", "DEPENDENCIES", "עבודה אצל מהנדס", "OPEN", `עבודה עוד פתוחה אצל ${[...new Set(openEng.map((w) => w.engineer))].join(", ")}.`, [ev("MIX", pk, "engineer work open")]));
  if (v.work.victor?.some((w) => w.ball === "victor")) checks.push(check("deps.victor", "DEPENDENCIES", "עבודה אצל ויקטור", "OPEN", "הכדור אצל ויקטור.", [ev("TEAM_VICTOR", pk, "computeVictorBall")]));
  if (v.work.victor?.some((w) => w.ball === "owner") || v.signals.some((s) => s.code === "OWNER_FEEDBACK_DUE" || s.code === "ENGINEER_RETURNED_WORK")) checks.push(check("deps.owner", "OWNER_DECISION", "משהו מחכה לך", "OPEN", "לפי הרשומות יש כאן משהו שמחכה לתגובה שלך.", [ev("PROJECTS", pk, "ball OWNER")]));
  if (v.work.tasksOverdue) checks.push(check("deps.tasks", "DEPENDENCIES", "משימות שעבר מועדן", "OPEN", `${v.work.tasksOverdue} משימות של הפרויקט עבר מועדן.`, [ev("TASKS", pk, "tasks overdue")], false));
  // the ONE stage rule (lib/partner/coo/stage): done-but-not-recorded is said as such; a stage materially behind a near
  // deadline is OPEN (required) — never an invented claim of what the deadline includes
  const comp = completionEvidence(c, projectId);
  const stage = stageBehind(c, projectId);
  const dTo = daysBetween(c.today, dl);
  if (comp?.complete) checks.push(check("deps.completion", "DEPENDENCIES", "העבודה עצמה", "CONFIRMED", `${comp.he} — נראה שהעבודה הסתיימה; לסמן הושלם / למסור ללקוח זו החלטה שלך.`, [ev("MIX", pk, "engineer work אושר + final files")], false));
  else if (stage.behind && dTo <= MOTION_STAGE_DAYS) checks.push(check("deps.stage", "DEPENDENCIES", "שלב העבודה מול הדדליין", "OPEN", `${stage.he} — השלב לא נראה מתקדם מספיק ביחס לדדליין (${STAGE_UNCERTAINTY_HE}).`, [ev("PROJECTS", pk, "stage vs deadline (lib/partner/coo/stage)")]));
  if (!comp?.complete && !openEng.length && !v.work.victor?.length && (v.work.sessions?.upcoming ?? 0) === 0) checks.push(check("deps.next", "DEPENDENCIES", "עבודה מתוכננת עד הדדליין", "NOT_SEEN", "אני לא רואה עבודה פתוחה או סשן מתוכנן עד הדדליין — אם הפרויקט כמעט גמור, אולי זה בסדר.", [ev("PROJECTS", pk, "no open work / upcoming session")], false));
  const m = moneyReadiness(v, { labelWork: c.isLabel(projectId), financeReadable: c.financeReadable });
  // a delivery deadline is not blocked by the company's own unpaid vendor expenses — those are facts, not readiness gaps
  const moneyChecks = m.checks.filter((x) => x.id !== "money.expenses" && !x.id.startsWith("money.engineer."));
  const moneyFacts = [...m.facts, ...m.checks.filter((x) => !moneyChecks.includes(x)).map((x) => x.he)];
  return finishReadiness({ key: `readiness:deadline:${projectId}`, kind: "DEADLINE", titleHe: v.identity.name, date: dl, time: null, daysTo: daysBetween(c.today, dl), entity: pk, project: pk, checks: [...checks, ...moneyChecks], insights: [], facts: moneyFacts, sources: ["PROJECTS", "MIX", "TEAM_VICTOR", "FINANCE"], coreReadable: true });
}

// ───────────────────────────── collect ─────────────────────────────

export interface ReadinessBoard { horizonDays: number; events: Readiness[]; unchecked: string[] }

/** Every meaningful event inside the horizon, nearest first (an order of time, not a priority). */
export function readinessBoard(c: CooCtx, horizon: number = INTERNAL_COO_HEURISTICS.horizonDays): ReadinessBoard {
  const out: Readiness[] = [];
  const unchecked: string[] = [];
  if (!c.st) unchecked.push("מצב החברה לא נקרא — אין אירועים לבדוק (לא ידוע, לא ריק).");
  if (!c.ops) unchecked.push("מקור התפעול (Red Films, פגישות, מהנדסים) לא נקרא — צילומים ופגישות לא נבדקו.");
  if (!c.det) unchecked.push("פרטי הפרויקטים (סשנים מלאים, מסמכי הפקה, צעד הבא בריליס) לא נקראו — חלק מהבדיקות לא ידועות.");
  if (!c.calReadable) unchecked.push(`היומן לא נקרא (${c.calStatus}) — שעות / מקומות מהיומן לא נבדקו.`);
  // shoots — Red Films productions
  const shootProjectsDates = new Set<string>();
  for (const p of c.ops?.redFilms?.rows ?? []) {
    if (p.status === "בוטל" || SHOT_OR_LATER.has(p.status ?? "") || !inWindow(c, p.shootDate, horizon)) continue;
    const r = shootReadiness(c, p.id);
    if (r) { out.push(r); if (p.projectId) shootProjectsDates.add(`${p.projectId}|${p.shootDate}`); }
  }
  // shoot sessions with no production behind them
  for (const s of c.det?.sessions?.rows ?? []) {
    if (s.type !== SHOOT_SESSION || s.status !== "מתוכנן" || !inWindow(c, s.date, horizon)) continue;
    if (s.projectId && shootProjectsDates.has(`${s.projectId}|${s.date}`)) continue;
    if (s.projectId && (c.ops?.redFilms?.rows ?? []).some((p) => p.projectId === s.projectId && p.status !== "בוטל" && !SHOT_OR_LATER.has(p.status ?? ""))) continue;
    out.push(sessionShootReadiness(c, { id: s.id, projectId: s.projectId, date: s.date!, startTime: s.startTime, location: s.location, photographer: s.photographer }));
  }
  // shows
  for (const s of c.st?.domains.shows.data?.items ?? []) {
    if (s.status === "בוטל" || !inWindow(c, s.dateYmd, horizon)) continue;
    const r = showReadiness(c, s.id);
    if (r) out.push(r);
  }
  // releases
  for (const r of c.st?.domains.releasesFull.data?.items ?? []) {
    if (RELEASE_DONE.has(r.stage) || !inWindow(c, r.targetYmd, horizon)) continue;
    const x = releaseReadiness(c, r.projectId);
    if (x) out.push(x);
  }
  // important sessions (shoots / rehearsals are handled above)
  const det = new Map((c.det?.sessions?.rows ?? []).map((s) => [s.id, s]));
  for (const s of c.st?.domains.sessions.data?.items ?? []) {
    if (s.status !== "מתוכנן" || s.sessionType === SHOOT_SESSION || s.showId || !inWindow(c, s.dateYmd, horizon)) continue;
    if (!importantSession(c, s.projectId, horizon)) continue;
    const d = det.get(s.id);
    out.push(sessionReadiness(c, { id: s.id, projectId: s.projectId, date: s.dateYmd, startTime: s.startTime ?? d?.startTime ?? null, type: s.sessionType, location: d?.location ?? null, hasCalendarEvent: d?.hasCalendarEvent }));
  }
  // meetings
  const dm = new Map((c.det?.meetings?.rows ?? []).map((m) => [m.id, m]));
  for (const m of c.ops?.meetings?.rows ?? []) {
    if (m.status === "בוטלה" || !inWindow(c, m.date, horizon)) continue;
    const d = dm.get(m.id);
    out.push(meetingReadiness(c, { id: m.id, date: m.date!, time: m.time, projectId: m.projectId, clientId: m.clientId, clientName: d?.clientName ?? null, location: d?.location ?? null, hasCalendarEvent: m.hasCalendarEvent }));
  }
  // client deadlines (projects with a release row are covered as releases)
  for (const p of c.st?.domains.projects.data?.open ?? []) {
    if (!inWindow(c, p.deadline.ymd, horizon)) continue;
    const x = deadlineReadiness(c, p.id);
    if (x) out.push(x);
  }
  out.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.time ?? "99").localeCompare(b.time ?? "99") || a.key.localeCompare(b.key));
  return { horizonDays: horizon, events: out, unchecked };
}

/** Readiness of ONE entity, by key (video-production / show / release / project / session / meeting). */
export function readinessOf(c: CooCtx, key: string): Readiness[] {
  const [t, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (t === "video-production") { const r = shootReadiness(c, id); return r ? [r] : []; }
  if (t === "show") { const r = showReadiness(c, id); return r ? [r] : []; }
  if (t === "release") { const r = releaseReadiness(c, id); return r ? [r] : []; }
  if (t === "session") {
    const s = c.det?.sessions?.rows.find((x) => x.id === id);
    if (!s || !isYmd(s.date)) return [];
    return [s.type === SHOOT_SESSION ? sessionShootReadiness(c, { id: s.id, projectId: s.projectId, date: s.date, startTime: s.startTime, location: s.location, photographer: s.photographer }) : sessionReadiness(c, { id: s.id, projectId: s.projectId, date: s.date, startTime: s.startTime, type: s.type, location: s.location, hasCalendarEvent: s.hasCalendarEvent })];
  }
  if (t === "project") {
    const out: Readiness[] = [];
    for (const p of c.ops?.redFilms?.rows ?? []) if (p.projectId === id && p.status !== "בוטל" && !SHOT_OR_LATER.has(p.status ?? "") && isYmd(p.shootDate) && p.shootDate >= c.today) { const r = shootReadiness(c, p.id); if (r) out.push(r); }
    const rel = releaseReadiness(c, id); if (rel && (rel.daysTo ?? 0) >= 0) out.push(rel);
    const dl = deadlineReadiness(c, id); if (dl && (dl.daysTo ?? -1) >= 0) out.push(dl);
    return out;
  }
  return [];
}
