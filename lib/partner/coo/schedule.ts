/**
 * Sunny COO — SCHEDULE HEALTH (pure, analysis only). NO automatic scheduling, NO moving events, NO calendar write,
 * NO background job. It asks whether the coming week serves the business — not whether it is busy.
 *
 * Evidence only: the live calendar (occupancy via lib/partner/calendar/availability — opaque, not cancelled, not
 * declined), Redbloods sessions / shows / shoots / meetings, project / release / follow-up records. Busy ≠ productive
 * and busy alone is NEVER a finding: a full stretch is reported only together with something it squeezes (an event
 * that is not ready, follow-ups / tasks that are due). A conflict is two blocking timed commitments at the same time.
 * If the calendar cannot be read, Sunny says so and analyses the Redbloods records only — never "the week is free".
 */
import type { CooCtx } from "./context";
import { hmOf } from "./context";
import { availability, dayList } from "../calendar/availability";
import { addDaysYmd, daysBetween, heDate, INTERNAL_COO_HEURISTICS, isYmd } from "./model";
import type { Readiness } from "./model";
import type { ArtistCare, ProjectMomentum } from "./momentum";

export type ScheduleFindingCode = "CONFLICT" | "NO_PREP_WINDOW" | "RELEASE_NO_SCHEDULED_WORK" | "LABEL_NO_SESSION" | "NO_ROOM_FOR_FOLLOWUPS";
export interface ScheduleFinding { code: ScheduleFindingCode; he: string; date: string | null; heuristic: boolean; evidence: string[]; kind: "CONFLICT" | "OBSERVATION" }
export interface ScheduleDay { date: string; busyMinutes: number | null; items: Array<{ time: string | null; title: string; category: string; source: "CALENDAR" | "REDBLOODS" }>; heavy: boolean | null }
export interface ScheduleHealth {
  window: { start: string; end: string; days: number };
  calendarStatus: string;
  days: ScheduleDay[];
  findings: ScheduleFinding[];
  balance: Record<string, number>;
  dueFollowups: number; dueTasks: number;
  unchecked: string[];
  he: string;
}

const CATEGORY_HE: Record<string, string> = {
  CLIENT_WORK: "עבודת לקוח", LABEL_WORK: "עבודת לייבל", SHOOT: "צילום", SHOW: "הופעה", MEETING: "פגישה", SESSION_UNLINKED: "סשן לא מקושר",
  LIKELY_WORK: "כנראה עבודה (יומן)", PERSONAL_OR_OTHER: "אישי / אחר", HOLIDAY: "חג",
};

export function scheduleHealth(c: CooCtx, input: { readiness: readonly Readiness[]; momentum: readonly ProjectMomentum[]; artists: readonly ArtistCare[] }, days: number = INTERNAL_COO_HEURISTICS.scheduleDays): ScheduleHealth {
  const start = c.today, end = addDaysYmd(c.today, days - 1);
  const list = dayList(start, end);
  const unchecked: string[] = [];
  const findings: ScheduleFinding[] = [];
  const balance: Record<string, number> = {};
  const bump = (k: string) => { balance[k] = (balance[k] ?? 0) + 1; };
  const idx = c.st?.domains.projects.data?.index ?? {};
  const sessCat = (pid: string | null, type: string | null) => (type === "צילום קליפ" ? "SHOOT" : !pid ? "SESSION_UNLINKED" : c.isLabel(pid) ? "LABEL_WORK" : idx[pid]?.businessType === "לקוח" ? "CLIENT_WORK" : "SESSION_UNLINKED");

  // ── Redbloods records in the window ──
  const recItems = new Map<string, ScheduleDay["items"]>(list.map((d) => [d, []]));
  const detById = new Map((c.det?.sessions?.rows ?? []).map((s) => [s.id, s]));
  const sessions = (c.st?.domains.sessions.data?.items ?? []).filter((s) => s.status === "מתוכנן" && s.dateYmd >= start && s.dateYmd <= end);
  const prodDays = new Set((c.ops?.redFilms?.rows ?? []).filter((p) => p.status !== "בוטל" && p.projectId).map((p) => `${p.projectId}|${p.shootDate}`));
  for (const s of sessions) {
    if (s.sessionType === "צילום קליפ" && prodDays.has(`${s.projectId}|${s.dateYmd}`)) continue; // the production is counted (one shoot, not two)
    const cat = s.showId ? "SHOW" : sessCat(s.projectId, s.sessionType);
    bump(cat);
    const st = s.startTime ?? detById.get(s.id)?.startTime ?? null;
    recItems.get(s.dateYmd)?.push({ time: st ? st.slice(0, 5) : null, title: `${s.sessionType ?? "סשן"}${s.projectId ? ` — ${idx[s.projectId]?.name ?? ""}` : ""}`, category: CATEGORY_HE[cat] ?? cat, source: "REDBLOODS" });
  }
  for (const s of c.st?.domains.shows.data?.items ?? []) if (s.status !== "בוטל" && isYmd(s.dateYmd) && s.dateYmd >= start && s.dateYmd <= end) { bump("SHOW"); recItems.get(s.dateYmd)?.push({ time: null, title: `הופעה — ${s.name}`, category: CATEGORY_HE.SHOW, source: "REDBLOODS" }); }
  for (const m of c.ops?.meetings?.rows ?? []) if (m.status !== "בוטלה" && isYmd(m.date) && m.date >= start && m.date <= end) { bump("MEETING"); recItems.get(m.date)?.push({ time: m.time?.slice(0, 5) ?? null, title: "פגישה", category: CATEGORY_HE.MEETING, source: "REDBLOODS" }); }
  for (const p of c.ops?.redFilms?.rows ?? []) if (p.status !== "בוטל" && isYmd(p.shootDate) && p.shootDate >= start && p.shootDate <= end) { bump("SHOOT"); recItems.get(p.shootDate)?.push({ time: null, title: `צילום — ${p.title}`, category: CATEGORY_HE.SHOOT, source: "REDBLOODS" }); }

  // ── record-level conflicts: two Redbloods sessions overlapping in time (independent of the calendar) ──
  const toMin = (t: string | null | undefined) => (t && /^\d{2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  for (const d of list) {
    const day = sessions.filter((s) => s.dateYmd === d).map((s) => { const x = detById.get(s.id); return { s, from: toMin(s.startTime ?? x?.startTime), to: toMin(s.endTime ?? x?.endTime) }; }).filter((x) => x.from !== null && x.to !== null && x.to! > x.from!);
    for (let i = 0; i < day.length; i++) for (let j = i + 1; j < day.length; j++) {
      if (day[j].from! < day[i].to! && day[i].from! < day[j].to!) findings.push({ code: "CONFLICT", kind: "CONFLICT", date: d, heuristic: false, he: `ב-${heDate(d)} שני סשנים רשומים חופפים בזמן (${day[i].s.sessionType} ${String(day[i].s.startTime ?? "").slice(0, 5)} / ${day[j].s.sessionType} ${String(day[j].s.startTime ?? "").slice(0, 5)}).`, evidence: [`session:${day[i].s.id}`, `session:${day[j].s.id}`] });
    }
  }

  // ── calendar occupancy + overlaps ──
  let av: ReturnType<typeof availability> | null = null;
  if (c.calReadable) {
    av = availability(c.cal!.events, list, c.cal!.status as Parameters<typeof availability>[2]);
    const linked = new Map(c.linked().map((l) => [l.event.id, l]));
    for (const d of av) for (const o of d.overlaps) {
      const a = linked.get(o.a), b = linked.get(o.b);
      if (!a || !b) continue;
      const business = [a, b].some((x) => x.category !== "PERSONAL_OR_OTHER" && x.category !== "HOLIDAY");
      findings.push({ code: "CONFLICT", kind: "CONFLICT", date: d.date, heuristic: false, he: `ב-${heDate(d.date)} ${o.start}–${o.end} שני דברים ביומן חופפים: "${a.event.title ?? "אירוע"}" ו-"${b.event.title ?? "אירוע"}"${business ? "" : " (שניהם נראים אישיים — רק שווה לשים לב)"}.`, evidence: [o.a, o.b] });
    }
    for (const l of c.linked()) {
      const d = l.event.allDay ? l.event.start : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(l.event.start));
      if (d < start || d > end || l.event.status === "cancelled") continue;
      const cat = l.category === "REDBLOODS_SESSION" ? "SESSION" : l.category === "REDBLOODS_SHOW" ? "SHOW" : l.category === "REDBLOODS_MEETING" ? "MEETING" : l.category;
      if (cat === "LIKELY_WORK" || cat === "PERSONAL_OR_OTHER") bump(`CALENDAR_${cat}`);
      recItems.get(d)?.push({ time: l.event.allDay ? null : hmOf(l.event.start), title: l.event.title ?? "אירוע", category: CATEGORY_HE[cat] ?? (cat === "SESSION" ? "סשן (יומן)" : cat), source: "CALENDAR" });
    }
  } else unchecked.push(`היומן לא נקרא (${c.calStatus}) — אני רואה רק את מה שרשום ב-Redbloods, לא מה עוד יש לך ביומן.`);

  // dedupe Redbloods items that also appear in the calendar (same day, same start time)
  const out: ScheduleDay[] = list.map((d) => {
    const items = recItems.get(d) ?? [];
    const seen = new Set<string>();
    const nameOf = (t: string) => t.split(/\s+[—–-]\s+/).slice(1).join(" ").trim().toLowerCase();
    const calTitles = items.filter((i) => i.source === "CALENDAR").map((i) => i.title.toLowerCase());
    const uniq = items.filter((i) => {
      const k = `${i.time ?? "-"}|${i.source === "CALENDAR" ? "C" : "R"}`;
      const dup = i.source === "CALENDAR" && items.some((r) => r.source === "REDBLOODS" && r.time && r.time === i.time);
      // a Redbloods record with no time whose name already appears in a calendar event that day = the same commitment
      const shadow = i.source === "REDBLOODS" && !i.time && !!nameOf(i.title) && calTitles.some((t) => t.includes(nameOf(i.title).split(" ")[0]));
      if (dup || shadow || seen.has(k + i.title)) return false; seen.add(k + i.title); return true;
    })
      .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
    const a = av?.find((x) => x.date === d) ?? null;
    const busy = a ? a.occupiedMinutes : null;
    return { date: d, busyMinutes: busy, items: uniq, heavy: busy === null ? null : busy >= INTERNAL_COO_HEURISTICS.heavyDayBusyMinutes };
  });

  // ── patterns (each needs something it squeezes; busy alone is never a finding) ──
  const heavyDays = out.filter((d) => d.heavy === true).map((d) => d.date);
  let stretch = 0, maxStretch = 0;
  for (const d of out) { stretch = d.heavy ? stretch + 1 : 0; maxStretch = Math.max(maxStretch, stretch); }
  const proposals = (c.st?.domains.proposalsFull.data?.items ?? []).filter((p) => !["נסגר", "לא נסגר"].includes(p.status) && isYmd(p.followupYmd) && p.followupYmd <= end);
  const tasks = (c.st?.domains.tasksFull.data?.items ?? []).filter((t) => t.status === "פתוח" && isYmd(t.dueYmd) && t.dueYmd <= end);
  if (maxStretch >= INTERNAL_COO_HEURISTICS.heavyStretchDays && (proposals.length || tasks.length)) {
    findings.push({ code: "NO_ROOM_FOR_FOLLOWUPS", kind: "OBSERVATION", date: null, heuristic: true, he: `יש רצף של ${maxStretch} ימים מלאים ביומן, ובמקביל ${proposals.length ? `${proposals.length} הצעות שצריך לחזור אליהן` : ""}${proposals.length && tasks.length ? " ו-" : ""}${tasks.length ? `${tasks.length} משימות שמגיע מועדן` : ""} — כמעט לא רואה זמן לסגירות. לא משנה כלום ביומן, רק שווה לשים לב.`, evidence: [...heavyDays.map((d) => `day:${d}`), ...proposals.slice(0, 3).map((p) => `proposal:${p.id}`)] });
  }
  for (const r of input.readiness) {
    if ((r.kind !== "SHOOT" && r.kind !== "SHOW") || r.state === "READY" || !isYmd(r.date) || r.date > end || r.date <= start) continue;
    const before = out.filter((d) => d.date < r.date!);
    if (before.length && before.every((d) => d.heavy === true)) findings.push({ code: "NO_PREP_WINDOW", kind: "OBSERVATION", date: r.date, heuristic: true, he: `${r.kind === "SHOOT" ? "הצילום" : "ההופעה"} "${r.titleHe}" ב-${heDate(r.date)} עוד ${r.stateHe}, וכל הימים עד אז מלאים ביומן — כמעט אין חלון הכנה.`, evidence: [r.key] });
  }
  for (const m of input.momentum) {
    if (!m.release || m.release.daysTo === null || m.release.daysTo < 0 || m.release.daysTo > INTERNAL_COO_HEURISTICS.horizonDays) continue;
    if (m.scheduledNext || m.nextSteps.length || m.state === "WAITING_EXTERNAL" || m.state === "OWNER_BALL") continue; // open work exists — not "nothing before the release"
    findings.push({ code: "RELEASE_NO_SCHEDULED_WORK", kind: "OBSERVATION", date: m.release.target, heuristic: false, he: `הריליס "${m.name}" מתוכנן ל-${heDate(m.release.target)} ואני לא רואה עבודה מתוכננת או פתוחה לפניו.`, evidence: [m.key] });
  }
  for (const a of input.artists) {
    if (!a.projects.length || a.upcomingSessions > 0 || !a.needsStep.length) continue;
    findings.push({ code: "LABEL_NO_SESSION", kind: "OBSERVATION", date: null, heuristic: false, he: `ל-${a.name} יש ${a.projects.length} פרויקטים פעילים ואני לא רואה סשן מתוכנן; ב-${a.needsStep.slice(0, 2).join(", ")} גם אין צעד הבא רשום.`, evidence: [a.key] });
  }

  const conflicts = findings.filter((f) => f.kind === "CONFLICT");
  const he = [
    `השבוע (${heDate(start)}–${heDate(end)}): ${Object.entries(balance).filter(([k]) => !k.startsWith("CALENDAR_")).map(([k, n]) => `${CATEGORY_HE[k] ?? k} ${n}`).join(", ") || "לא רואה אירועים רשומים ב-Redbloods"}.`,
    conflicts.length ? `יש ${conflicts.length} חפיפות אמיתיות ביומן / ברשומות.` : c.calReadable ? "לא רואה חפיפות." : "",
    findings.some((f) => f.code === "NO_ROOM_FOR_FOLLOWUPS" || f.code === "NO_PREP_WINDOW") ? "" : out.some((d) => d.heavy) ? "יש ימים מלאים, אבל עמוס זה לא בעיה בפני עצמו — לא רואה משהו שנדחק בגללם." : "",
  ].filter(Boolean).join(" ");
  return { window: { start, end, days }, calendarStatus: c.calStatus, days: out, findings, balance, dueFollowups: proposals.length, dueTasks: tasks.length, unchecked, he };
}
