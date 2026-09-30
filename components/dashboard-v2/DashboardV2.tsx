"use client";

// Dashboard V2 (/dashboard-v2) — the simpler Owner dashboard, built BESIDE the current /dashboard (which is untouched).
// Read-only: it only reads existing endpoints and opens existing drawers / modals / pages. Its only writes are the
// ones the reused components already make (TasksAttentionModal, the Partner sections, EditReleaseModal).
// All derivations live in lib/dashboard-v2.ts (pure). No page-load write, no push, no calendar write.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProjects } from "@/components/ProjectsProvider";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import { usePrivacyMode } from "@/lib/use-privacy";
import SensitiveValue from "@/components/ui/SensitiveValue";
import ProjectCover from "@/components/ui/ProjectCover";
import TasksAttentionModal from "@/components/dashboard/TasksAttentionModal";
import PartnerActionsSection from "@/components/partner/PartnerActionsSection";
import PartnerIntegritySection from "@/components/partner/PartnerIntegritySection";
import { EditReleaseModal } from "@/components/label/labelShared";
import { summarizeUpcomingReleases, releaseShortDate } from "@/lib/dashboard-releases";
import { israelTodayYmd } from "@/lib/project-deadline";
import type { LabelRelease } from "@/lib/types";
import {
  buildNeedsMe, buildTimeline, financeMonth, releaseBadge, dayLabel, NEEDS_ME_VISIBLE,
  type NeedItem, type NeedBadge, type OpenTarget, type RichPart, type TimelineItem, type TimelineKind,
  type CooCaseIn, type PartnerActionIn, type IntegrityQuestionIn, type TaskIn, type ProposalIn,
  type CalendarEventIn, type SessionIn, type ShowIn, type FinanceTxIn,
} from "@/lib/dashboard-v2";

// ── Tokens: the same as the current dashboard (DashboardDesignPreview) ────────
const BRAND = "#DC2626";
const BG = "#0D0D0D";
const CARD = "#181818";
const CARD2 = "#1E1E1E";
const BORDER = "rgba(255,255,255,0.07)";
const BORDER2 = "rgba(255,255,255,0.04)";
const TEXT = "#F2F2F2";
const SUB = "#A0A0A0";
const MUTED = "#606060";
const BLUE = "#3B82F6";
const PURPLE = "#A855F7";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const SHADOW = "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)";

/** undefined = loading · null = failed · value = loaded */
type Load<T> = T | null | undefined;

const BADGE_COLOR: Record<NeedBadge, string> = { "החלטה": PURPLE, "דחוף": RED, "פעולה": BLUE, "ממתין": AMBER };
const KIND_COLOR: Record<TimelineKind, string> = {
  session: BLUE, shoot: PURPLE, rehearsal: "#06B6D4", show: AMBER, meeting: GREEN, deadline: RED, task: "#9CA3AF", event: "#9CA3AF",
};
const KIND_LABEL: Record<TimelineKind, string> = {
  session: "סשן", shoot: "צילום", rehearsal: "חזרה", show: "הופעה", meeting: "פגישה", deadline: "דדליין", task: "משימה", event: "יומן",
};
const TIMELINE_VISIBLE = 6;

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { cache: "no-store" });
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, body };
}

// ── Icons (outline, currentColor) ──────────────────────────────────────────────
function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const IC = {
  check: "M4 4h16v16H4z M8 12l3 3 5-6",
  calendar: "M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12l7-7",
  chat: "M4 5h16v11H9l-5 4z",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01",
  music: "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  wallet: "M3 7h18v12H3z M16 13h2 M3 7l3-3h12",
};

function Rich({ parts, hidden }: { parts: RichPart[]; hidden: boolean }) {
  return <>{parts.map((p, i) => <span key={i}>{p.s && hidden ? "••••" : p.t}</span>)}</>;
}

function Modal({ onClose, children, width = 620 }: { onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 199999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(4px)" }} />
      <div dir="rtl" style={{
        position: "relative", width, maxWidth: "94vw", maxHeight: "86vh", overflowY: "auto",
        borderRadius: 20, background: "linear-gradient(160deg, #15151B 0%, #0F0F14 100%)",
        border: `1px solid ${BORDER}`, boxShadow: "0 32px 80px rgba(0,0,0,0.85)", padding: "18px 18px 8px",
      }}>
        <button onClick={onClose} aria-label="סגור" style={{ position: "absolute", top: 12, left: 12, width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: `1px solid ${BORDER2}`, color: SUB, fontSize: 15, cursor: "pointer", fontFamily: "inherit", zIndex: 1 }}>✕</button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Panel({ title, icon, iconColor, right, children, style, className }: { title: string; icon: string; iconColor: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <section className={className} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: SHADOW, display: "flex", flexDirection: "column", minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "16px 20px 12px", borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ color: iconColor, display: "inline-flex" }}><Icon d={icon} /></span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TEXT }}>{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: MUTED, textAlign: "center", padding: "18px 12px" }}>{children}</div>;
}

export default function DashboardV2() {
  const { projects, loading: projectsLoading } = useProjects();
  const { openProject } = useGlobalProjectDrawer();
  const router = useRouter();
  const [privacyHidden] = usePrivacyMode();
  const today = israelTodayYmd();

  // ── Sources (all existing, read-only) ──────────────────────────────────────
  const [coo, setCoo] = useState<Load<{ headline: RichPart[]; headlineLevel: string; p0: number; cases: CooCaseIn[] }>>(undefined);
  const [actions, setActions] = useState<Load<PartnerActionIn[]>>(undefined);
  const [integrity, setIntegrity] = useState<Load<IntegrityQuestionIn[]>>(undefined);
  const [tasks, setTasks] = useState<Load<TaskIn[]>>(undefined);
  const [proposals, setProposals] = useState<Load<ProposalIn[]>>(undefined);
  const [sessions, setSessions] = useState<Load<SessionIn[]>>(undefined);
  const [shows, setShows] = useState<Load<ShowIn[]>>(undefined);
  const [calendar, setCalendar] = useState<Load<CalendarEventIn[]>>(undefined);
  const [calendarState, setCalendarState] = useState<"loading" | "ok" | "not_connected" | "error">("loading");
  const [finance, setFinance] = useState<Load<FinanceTxIn[]>>(undefined);
  const [releases, setReleases] = useState<Load<LabelRelease[]>>(undefined);

  useEffect(() => {
    const run = <T,>(url: string, pick: (b: Record<string, unknown>) => T, set: (v: T | null) => void) =>
      getJson(url).then((r) => set(r.ok ? pick(r.body) : null)).catch(() => set(null));

    run("/api/coo/brief", (b) => {
      const brief = (b.brief ?? {}) as { headline?: RichPart[]; headlineLevel?: string; tierCounts?: Record<string, number>; cases?: CooCaseIn[] };
      return { headline: brief.headline ?? [], headlineLevel: brief.headlineLevel ?? "calm", p0: brief.tierCounts?.P0 ?? 0, cases: brief.cases ?? [] };
    }, setCoo);
    run("/api/partner/actions", (b) => (Array.isArray(b.items) ? b.items as PartnerActionIn[] : []), setActions);
    run("/api/partner/integrity", (b) => (Array.isArray(b.questions) ? b.questions as IntegrityQuestionIn[] : []), setIntegrity);
    run("/api/tasks?status=פתוח", (b) => (Array.isArray(b.tasks) ? b.tasks as TaskIn[] : []), setTasks);
    run("/api/proposals/all", (b) => (Array.isArray(b.proposals) ? b.proposals as ProposalIn[] : []), setProposals);
    run("/api/sessions?all=1", (b) => (Array.isArray(b.sessions) ? b.sessions as SessionIn[] : []), setSessions);
    run("/api/shows", (b) => (Array.isArray(b.shows) ? b.shows as ShowIn[] : []), setShows);
    run("/api/transactions?all=1", (b) => (Array.isArray(b.transactions) ? b.transactions as FinanceTxIn[] : []), setFinance);

    // Calendar: the existing read-only week route (today + 7 days). A read failure is NEVER an empty calendar.
    getJson(`/api/calendar/week?weekStart=${israelTodayYmd()}&days=8`).then((r) => {
      if (r.body.error === "not_connected") { setCalendar([]); setCalendarState("not_connected"); return; }
      if (!r.ok || r.body.error) { setCalendar(null); setCalendarState("error"); return; }
      setCalendar(Array.isArray(r.body.events) ? r.body.events as CalendarEventIn[] : []);
      setCalendarState("ok");
    }).catch(() => { setCalendar(null); setCalendarState("error"); });
  }, []);

  const loadReleases = useCallback(() =>
    fetch("/api/label/releases", { cache: "no-store" })
      .then(async (r) => { const b = await r.json(); setReleases(r.ok && Array.isArray(b) ? b as LabelRelease[] : null); })
      .catch(() => setReleases(null)), []);
  useEffect(() => { loadReleases(); }, [loadReleases]);

  // ── Derivations (lib/dashboard-v2.ts) ──────────────────────────────────────
  const needs = useMemo(() => buildNeedsMe({
    today, cooCases: coo ? coo.cases : null, partnerActions: actions ?? null, integrityQuestions: integrity ?? null,
    tasks: tasks ?? null, proposals: proposals ?? null,
  }), [today, coo, actions, integrity, tasks, proposals]);
  const needsSources: [string, Load<unknown>][] = [["COO", coo], ["פעולות Partner", actions], ["שאלות סאני", integrity], ["משימות", tasks], ["הצעות", proposals]];
  const needsLoading = needsSources.some(([, v]) => v === undefined);
  const needsFailed = needsSources.filter(([, v]) => v === null).map(([n]) => n);

  const timeline = useMemo(() => buildTimeline({
    today, calendar: calendar ?? null, sessions: sessions ?? null, shows: shows ?? null,
    projects: projectsLoading ? [] : projects, tasks: tasks ?? null,
  }), [today, calendar, sessions, shows, projects, projectsLoading, tasks]);
  const timelineLoading = projectsLoading || calendarState === "loading" || sessions === undefined || shows === undefined || tasks === undefined;
  const timelineFailed = [sessions === null && "סשנים", shows === null && "הופעות", tasks === null && "משימות"].filter(Boolean) as string[];
  const todayCount = timeline.filter((t) => t.date === today).length;

  const financeLines = useMemo(() => (finance ? financeMonth(finance) : null), [finance]);
  const releaseRows = useMemo(() => (releases ? summarizeUpcomingReleases(releases, today).rows.slice(0, 3) : []), [releases, today]);

  // ── Open handlers (existing drawers / modals / pages only) ─────────────────
  const [modal, setModal] = useState<"partner-actions" | "partner-integrity" | null>(null);
  const [taskOpen, setTaskOpen] = useState<{ id: string; title: string; due_date: string | null }[] | null>(null);
  const [editRelease, setEditRelease] = useState<LabelRelease | null>(null);
  const [showAllNeeds, setShowAllNeeds] = useState(false);
  const [showAllTimeline, setShowAllTimeline] = useState(false);

  const open = (t: OpenTarget) => {
    switch (t.kind) {
      case "project": openProject(t.id); break;
      case "client": router.push(`/clients?open=${encodeURIComponent(t.id)}`); break;
      case "task": setTaskOpen([{ id: t.id, title: t.title, due_date: t.dueDate }]); break;
      case "tasks": setTaskOpen(t.tasks.map((x) => ({ id: x.id, title: x.title, due_date: x.dueDate }))); break;
      case "partner-actions": setModal("partner-actions"); break;
      case "partner-integrity": setModal("partner-integrity"); break;
      case "href": router.push(t.href); break;
      case "none": break;
    }
  };
  const onTaskDone = (id: string) => setTasks((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
  const onTaskDefer = (id: string, d: string) => setTasks((prev) => (prev ? prev.map((t) => (t.id === id ? { ...t, due_date: d } : t)) : prev));

  // ── Sunny update (UI only: the write path waits for the Owner-approved DB change) ──
  const [sunnyText, setSunnyText] = useState("");
  const [sunnyNotice, setSunnyNotice] = useState<string | null>(null);
  const onSunnySend = () => {
    if (!sunnyText.trim()) return;
    setSunnyNotice("עוד לא נשמר: השמירה לסאני תופעל אחרי אישור ה-DB. הטקסט נשאר בתיבה.");
  };

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "לילה טוב" : hour < 12 ? "בוקר טוב" : hour < 17 ? "צהריים טובים" : "ערב טוב";
  const visibleNeeds = showAllNeeds ? needs : needs.slice(0, NEEDS_ME_VISIBLE);
  const visibleTimeline = showAllTimeline ? timeline : timeline.slice(0, TIMELINE_VISIBLE);

  return (
    <div className="rb-dv2" dir="rtl" style={{ background: BG, color: TEXT, fontFamily: "'Heebo', Arial, sans-serif", minHeight: "100%" }}>
      <style>{`
        .rb-dv2 { padding: 28px 32px; }
        .rb-dv2-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
        .rb-dv2-main { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 16px; align-items: start; margin-bottom: 14px; }
        .rb-dv2-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .rb-dv2-rel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .rb-dv2-sunny { display: flex; align-items: center; gap: 14px; }
        .rb-dv2-fin { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .rb-dv2-need:hover { border-color: rgba(255,255,255,0.14) !important; }
        @media (max-width: 1100px) {
          .rb-dv2-main { grid-template-columns: minmax(0, 1fr); }
          .rb-dv2-needs { order: -1; }
        }
        @media (max-width: 767px) {
          .rb-dv2 { padding: 16px 14px; }
          .rb-dv2-cards { grid-template-columns: minmax(0, 1fr); gap: 10px; }
          .rb-dv2-sunny { flex-wrap: wrap; gap: 10px; }
          .rb-dv2-sunny-title { width: 100%; }
          .rb-dv2-rel { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      {/* ── Greeting ── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontSize: 38, fontWeight: 900, margin: 0, lineHeight: 1, letterSpacing: "-0.03em" }}>{greeting}</h1>
          <span style={{ fontSize: 24, lineHeight: 1, color: BRAND }}>✦</span>
        </div>
        <p style={{ fontSize: 14, color: MUTED, margin: 0, fontWeight: 500 }}>
          {new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* ── B. Three summary cards ── */}
      <div className="rb-dv2-cards">
        <SummaryCard
          title="דורש ממני" sub={needsFailed.length ? `חלק מהמקורות לא נטענו` : "החלטות, פעולות ומה שמחכה לך"}
          color={BRAND} icon={IC.check} value={needsLoading ? "…" : String(needs.length)}
        />
        <SummaryCard
          title="היום / השבוע" sub={timelineLoading ? "טוען…" : `${todayCount} היום · עד 7 ימים קדימה`}
          color={PURPLE} icon={IC.calendar} value={timelineLoading ? "…" : String(timeline.length)}
        />
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: SHADOW, padding: "16px 18px", display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
          <IconBox color={BLUE} icon={IC.target} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>פוקוס</span>
              {coo && coo.p0 > 0 && (
                <span title="מקרים ברמה P0 בסיכום ה-COO" style={{ fontSize: 10.5, fontWeight: 800, color: RED, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 99, padding: "1px 8px" }}>{coo.p0} דחופים</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: coo === null ? MUTED : "#D6D6D6", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {coo === undefined ? "טוען…" : coo === null ? "סיכום ה-COO לא נטען" : coo.headline.length ? <Rich parts={coo.headline} hidden={privacyHidden} /> : "אין מוקד מיוחד היום"}
            </div>
          </div>
        </div>
      </div>

      {/* ── C. Update Sunny (quick inbox row) ── */}
      <div className="rb-dv2-sunny" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: SHADOW, padding: "12px 16px", marginBottom: sunnyNotice ? 6 : 16 }}>
        <div className="rb-dv2-sunny-title" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ color: SUB, display: "inline-flex" }}><Icon d={IC.chat} /></span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>עדכון לסאני</span>
        </div>
        <input
          value={sunnyText}
          onChange={(e) => { setSunnyText(e.target.value); if (sunnyNotice) setSunnyNotice(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") onSunnySend(); }}
          maxLength={1000}
          placeholder="כתוב לסאני משהו שקרה היום..."
          aria-label="עדכון לסאני"
          style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 11, border: `1px solid ${BORDER}`, background: "#121212", color: TEXT, padding: "0 14px", fontSize: 13.5, fontFamily: "inherit", outline: "none" }}
        />
        <button type="button" onClick={onSunnySend} disabled={!sunnyText.trim()} style={{
          height: 40, padding: "0 30px", borderRadius: 11, border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 800,
          color: "#fff", background: BRAND, cursor: sunnyText.trim() ? "pointer" : "default", opacity: sunnyText.trim() ? 1 : 0.55, flexShrink: 0,
        }}>שלח</button>
      </div>
      {sunnyNotice && <div role="status" style={{ fontSize: 12, color: AMBER, margin: "0 6px 14px" }}>{sunnyNotice}</div>}

      <div className="rb-dv2-main">
        {/* Right column (RTL first): timeline + releases */}
        <div className="rb-dv2-side">
          {/* ── E. Today and the coming days ── */}
          <Panel title="היום והימים הקרובים" icon={IC.calendar} iconColor={PURPLE}>
            <div style={{ padding: "8px 14px 12px" }}>
              {timelineLoading ? <Note>טוען…</Note> : timeline.length === 0 ? <Note>אין אירועים ב-7 הימים הקרובים</Note> : (
                <TimelineList items={visibleTimeline} today={today} onOpen={open} />
              )}
              {!timelineLoading && timeline.length > TIMELINE_VISIBLE && (
                <MoreButton open={showAllTimeline} more={timeline.length - TIMELINE_VISIBLE} onClick={() => setShowAllTimeline((v) => !v)} />
              )}
              {(calendarState === "error" || calendarState === "not_connected" || timelineFailed.length > 0) && (
                <div style={{ fontSize: 11, color: AMBER, padding: "6px 6px 0", lineHeight: 1.5 }}>
                  {calendarState === "error" && <div>Google Calendar לא נטען — אירועי יומן חסרים כאן (זה לא יומן ריק).</div>}
                  {calendarState === "not_connected" && <div>Google Calendar לא מחובר — מוצגים רק נתוני Redbloods.</div>}
                  {timelineFailed.length > 0 && <div>לא נטען: {timelineFailed.join(", ")}.</div>}
                </div>
              )}
            </div>
          </Panel>

          {/* ── F. Upcoming releases ── */}
          <Panel title="ריליסים קרובים" icon={IC.music} iconColor={BLUE}
            right={<Link href="/label" style={{ fontSize: 11.5, color: BLUE, textDecoration: "none" }}>הצג הכל ←</Link>}>
            <div style={{ padding: 14 }}>
              {releases === undefined ? <Note>טוען…</Note> : releases === null ? (
                <Note>לא ניתן לטעון ריליסים. <button type="button" onClick={loadReleases} style={{ background: "none", border: "none", padding: 0, color: BLUE, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>נסה שוב</button></Note>
              ) : releaseRows.length === 0 ? <Note>אין ריליסים מתוזמנים כרגע</Note> : (
                <div className="rb-dv2-rel">
                  {releaseRows.map((r) => (
                    <button key={r.item.projectId} type="button" onClick={() => setEditRelease(r.item)} title="לחץ לעריכת הריליס" style={{
                      textAlign: "right", fontFamily: "inherit", cursor: "pointer", color: TEXT, minWidth: 0,
                      background: r.overdue ? "rgba(239,68,68,0.06)" : CARD2, border: `1px solid ${r.overdue ? "rgba(239,68,68,0.28)" : BORDER}`,
                      borderRadius: 14, padding: 8, display: "flex", flexDirection: "column", gap: 8,
                    }}>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <ProjectCover projectId={r.item.projectId} name={r.item.name} cover={r.item.cover} size={132} mobileSize={120} />
                      </div>
                      <div style={{ minWidth: 0, padding: "0 2px" }}>
                        <div dir="auto" style={{ fontSize: 13.5, fontWeight: 800, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.item.name}</div>
                        <div dir="auto" style={{ fontSize: 11.5, color: SUB, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{r.item.artist}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 2px 2px" }}>
                        <Pill color={r.item.projectType === "אלבום" ? PURPLE : r.item.projectType === "EP" ? BLUE : BRAND}>{releaseBadge(r.item.projectType)}</Pill>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: r.overdue ? RED : SUB }}>{releaseShortDate(r.item.release.releaseTargetDate!)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* ── D. What's needed from me today (the main area) ── */}
        <Panel className="rb-dv2-needs" title="מה צריך ממני היום" icon={IC.list} iconColor={BRAND} style={{ minHeight: 360 }}
          right={!needsLoading && needs.length > 0 ? <span style={{ fontSize: 11, fontWeight: 900, background: BRAND, color: "#fff", borderRadius: 99, padding: "2px 9px" }}>{needs.length}</span> : undefined}>
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
            {needsLoading && needs.length === 0 ? <Note>טוען…</Note> : needs.length === 0 ? (
              <Note>{needsFailed.length ? "לא נמצאו פריטים במקורות שנטענו" : "✅ אין כרגע משהו שמחכה לך"}</Note>
            ) : visibleNeeds.map((n) => <NeedRow key={n.key} item={n} hidden={privacyHidden} onOpen={() => open(n.open)} />)}
            {needs.length > NEEDS_ME_VISIBLE && (
              <MoreButton open={showAllNeeds} more={needs.length - NEEDS_ME_VISIBLE} onClick={() => setShowAllNeeds((v) => !v)} />
            )}
            {needsFailed.length > 0 && <div style={{ fontSize: 11, color: AMBER, padding: "2px 4px" }}>לא נטען: {needsFailed.join(", ")} — הרשימה חלקית.</div>}
            {needsLoading && needs.length > 0 && <div style={{ fontSize: 11, color: MUTED, padding: "2px 4px" }}>עוד מקורות נטענים…</div>}
          </div>
        </Panel>
      </div>

      {/* ── G. Finance strip (this month, the /finance formula) ── */}
      <div className="rb-dv2-fin" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: SHADOW, padding: "12px 18px" }}>
        <Link href="/finance" style={{ display: "flex", alignItems: "center", gap: 8, color: SUB, textDecoration: "none", fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>
          <Icon d={IC.wallet} size={16} /> {new Date().toLocaleDateString("he-IL", { month: "long" })} · כספים
        </Link>
        {finance === undefined ? <span style={{ fontSize: 12, color: MUTED }}>טוען…</span> : finance === null || !financeLines ? (
          <span style={{ fontSize: 12, color: AMBER }}>נתוני הכספים לא נטענו</span>
        ) : financeLines.map((l) => (
          <div key={l.currency} style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <FinFigure label="התקבל" color={GREEN} value={l.received} currency={l.currency} />
            <FinFigure label="צפוי" color={BLUE} value={l.expected} currency={l.currency} />
            <FinFigure label="לתשלום" color={RED} value={l.payable} currency={l.currency} />
          </div>
        ))}
      </div>

      {/* ── Reused modals ── */}
      {modal === "partner-actions" && (
        <Modal onClose={() => setModal(null)} width={680}><PartnerActionsSection isMobile={false} /><ModalHint /></Modal>
      )}
      {modal === "partner-integrity" && (
        <Modal onClose={() => setModal(null)} width={680}><PartnerIntegritySection isMobile={false} /><ModalHint /></Modal>
      )}
      {taskOpen && (
        <TasksAttentionModal tasks={taskOpen} today={today} onClose={() => setTaskOpen(null)} onDone={onTaskDone} onDefer={onTaskDefer} />
      )}
      {editRelease && <EditReleaseModal item={editRelease} onClose={() => setEditRelease(null)} onSaved={loadReleases} />}
    </div>
  );
}

function ModalHint() {
  return <div style={{ fontSize: 11, color: MUTED, textAlign: "center", padding: "10px 8px 6px" }}>הכרטיסים נטענים ישירות מ-Partner. אם אין כאן כרטיס — אין כרגע החלטה פתוחה.</div>;
}

// ── Pieces ─────────────────────────────────────────────────────────────────────
function IconBox({ color, icon }: { color: string; icon: string }) {
  return (
    <span style={{ width: 50, height: 50, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color, background: `${color}1F`, border: `1px solid ${color}33` }}>
      <Icon d={icon} size={22} />
    </span>
  );
}

function SummaryCard({ title, sub, color, icon, value }: { title: string; sub: string; color: string; icon: string; value: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: SHADOW, padding: "16px 18px", display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
      <IconBox color={color} icon={icon} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
      </div>
      <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: TEXT, flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 99, whiteSpace: "nowrap", color, background: `${color}1A`, border: `1px solid ${color}40` }}>{children}</span>;
}

function NeedRow({ item, hidden, onOpen }: { item: NeedItem; hidden: boolean; onOpen: () => void }) {
  const color = BADGE_COLOR[item.badge];
  const canOpen = item.open.kind !== "none";
  return (
    <div className="rb-dv2-need" style={{ display: "flex", alignItems: "center", gap: 12, background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 13, padding: "12px 14px", minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <Pill color={color}>{item.badge}</Pill>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dir="auto" style={{ fontSize: 14, fontWeight: 800, color: "#EDEDED", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
        {item.context.length > 0 && (
          <div dir="auto" style={{ fontSize: 12, color: SUB, textAlign: "right", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Rich parts={item.context} hidden={hidden} /></div>
        )}
      </div>
      {canOpen && (
        <button type="button" onClick={onOpen} style={{ flexShrink: 0, height: 32, padding: "0 16px", borderRadius: 10, fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, color: TEXT, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, cursor: "pointer" }}>פתח</button>
      )}
    </div>
  );
}

function TimelineList({ items, today, onOpen }: { items: TimelineItem[]; today: string; onOpen: (t: OpenTarget) => void }) {
  let lastDate = "";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((it) => {
        const header = it.date !== lastDate ? dayLabel(it.date, today) : null;
        lastDate = it.date;
        const color = KIND_COLOR[it.kind];
        const canOpen = it.open.kind !== "none";
        return (
          <div key={it.key}>
            {header && <div style={{ fontSize: 11, fontWeight: 800, color: it.date === today ? TEXT : MUTED, padding: "10px 6px 4px" }}>{header}</div>}
            <button type="button" disabled={!canOpen} onClick={() => onOpen(it.open)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "7px 6px", borderRadius: 10, textAlign: "right",
              background: "transparent", border: "none", color: TEXT, fontFamily: "inherit", cursor: canOpen ? "pointer" : "default",
            }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: SUB, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.time ?? "—"}</span>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 0 3px ${color}22` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div dir="auto" style={{ fontSize: 13, fontWeight: 700, color: "#E6E6E6", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
                {it.sub && <div dir="auto" style={{ fontSize: 11, color: MUTED, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</div>}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color, flexShrink: 0 }}>{KIND_LABEL[it.kind]}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MoreButton({ open, more, onClick }: { open: boolean; more: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ alignSelf: "center", marginTop: 4, background: "none", border: "none", color: BLUE, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
      {open ? "הצג פחות" : `עוד ${more}`}
    </button>
  );
}

function FinFigure({ label, color, value, currency }: { label: string; color: string; value: number; currency: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 900, color, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }} dir="ltr">
        <SensitiveValue>{`${currency}${Math.round(value).toLocaleString()}`}</SensitiveValue>
      </span>
    </span>
  );
}
