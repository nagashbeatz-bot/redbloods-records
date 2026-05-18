/**
 * HTML + plain-text email templates for daily reports.
 * Pure functions — no server imports.
 */

import type { ReportData, GeneratedReport, ReportProject, ReportCalendarEvent, ReportSession, ReportTransaction, ReportActivityItem } from "./types";

// ─── Hebrew date utils ────────────────────────────────────────────────────────

const HE_DAYS  = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function heDate(d: Date): string {
  return `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function deadlineLabel(p: ReportProject): string {
  if (!p.deadline) return "ללא דדליין";
  const n = p.daysUntil;
  if (n === null) return "ללא דדליין";
  if (n < 0)  return `עבר לפני ${Math.abs(n)} ימ${Math.abs(n) === 1 ? "" : "ים"}`;
  if (n === 0) return "היום";
  if (n === 1) return "מחר";
  return `עוד ${n} ימים`;
}

// ─── Shared HTML shell ────────────────────────────────────────────────────────

const CSS = `
  body   { margin:0; padding:0; background:#0D0D0D; font-family:Arial,Helvetica,sans-serif; direction:rtl; color:#E0E0E0; }
  .wrap  { max-width:600px; margin:0 auto; padding:20px 12px 40px; }
  .card  { background:#141414; border:1px solid #252525; border-radius:14px; padding:20px 24px; margin-bottom:16px; }
  .head  { background:linear-gradient(135deg,#1a0a2e,#0a1a2e); border:1px solid #2A2A2A; border-radius:14px; padding:24px 28px; margin-bottom:20px; }
  h1     { margin:0 0 4px; font-size:22px; font-weight:800; color:#F0F0F0; }
  .sub   { font-size:13px; color:#555; margin:0; }
  h2     { font-size:13px; font-weight:700; color:#888; letter-spacing:.06em; text-transform:uppercase; margin:0 0 12px; }
  .row   { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #1E1E1E; font-size:13px; }
  .row:last-child { border-bottom:none; }
  .lbl   { color:#666; }
  .val   { color:#D0D0D0; font-weight:500; text-align:left; direction:ltr; }
  .val.hi{ color:#C084FC; font-weight:700; }
  .val.r { color:#EF4444; }
  .val.a { color:#F59E0B; }
  .val.g { color:#10B981; }
  .badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
  .empty { color:#444; font-size:13px; font-style:italic; padding:4px 0; }
  .rec   { background:#1A1A1A; border-radius:10px; padding:10px 14px; margin-bottom:8px; font-size:13px; color:#D0D0D0; }
  .rec .n{ color:#A855F7; font-weight:700; margin-left:8px; }
  .cal   { background:#111827; border-radius:10px; padding:10px 14px; margin-bottom:8px; }
  .footer{ text-align:center; font-size:11px; color:#333; margin-top:24px; }
  .tag   { color:#3B82F6; font-size:11px; }
  .sep   { height:1px; background:#1A1A1A; margin:16px 0; }
  .ovd   { color:#EF4444; }
  .soon  { color:#F59E0B; }
  .today { color:#C084FC; }
`;

function shell(content: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">${content}</div>
</body>
</html>`;
}

// ─── Morning report ───────────────────────────────────────────────────────────

export function generateMorningReport(
  data:            ReportData,
  recommendations: string[]
): GeneratedReport {
  const date    = heDate(data.generatedAt);
  const subject = `Redbloods OS — פתיחת יום | ${date}`;

  const html = shell(`
    <!-- 1. כותרת -->
    <div class="head">
      <h1>☀️ פתיחת יום</h1>
      <p class="sub">${date}</p>
    </div>

    <!-- 2. סקירה מהירה -->
    <div class="card">
      <h2>📊 סקירה מהירה</h2>
      ${stat("פרויקטים פעילים", String(data.activeProjects.length))}
      ${stat("עברו דדליין", String(data.overdueProjects.length), data.overdueProjects.length > 0 ? "r" : "g")}
      ${stat("דדליין היום", String(data.dueTodayProjects.length), data.dueTodayProjects.length > 0 ? "hi" : "")}
      ${stat("קרובים לדדליין (7 ימים)", String(data.dueSoonProjects.length), data.dueSoonProjects.length > 0 ? "a" : "")}
      ${stat("חסרי מידע", String(data.missingInfoProjects.length), data.missingInfoProjects.length > 0 ? "a" : "")}
    </div>

    <!-- 3. סשנים היום -->
    ${morningSessionsCard(data)}

    <!-- 4. יומן -->
    ${calendarSection(data.calendarEvents, data.calendarConnected)}

    <!-- 5. דדליינים — קובייה מאוחדת -->
    ${morningDeadlinesCard(data)}

    <!-- 6. חסרי מידע -->
    ${missingSection(data.missingInfoProjects)}

    <!-- 7. ויקטור — רק אם יש משהו לדווח -->
    ${victorBlock(data)}

    <!-- 8. פעולות מומלצות להיום -->
    ${recommendationsSection(recommendations, "פעולות מומלצות להיום")}

    <div class="footer">
      Redbloods OS · דוח בוקר אוטומטי · ${data.generatedAt.toLocaleTimeString("he-IL")}
    </div>
  `);

  const text = buildMorningText(data, recommendations);

  return { subject, html, text };
}

// ─── Morning section helpers ──────────────────────────────────────────────────

/** Today's sessions: upcoming (time not yet) + needing update (time passed, no status) */
function morningSessionsCard(data: ReportData): string {
  const upcoming       = data.sessionsUpcoming       ?? [];
  const needingUpdate  = data.sessionsNeedingUpdate  ?? [];
  const total = upcoming.length + needingUpdate.length;

  if (total === 0) {
    return `<div class="card"><h2>📅 סשנים היום</h2><div class="empty">אין סשנים מתוכננים להיום</div></div>`;
  }

  let inner = "";
  let first = true;

  function sh(text: string, color: string): string {
    const fn = first ? subheadFirst : subhead;
    first = false;
    return fn(text, color);
  }

  if (upcoming.length > 0) {
    inner += sh("📅 מתוכננים להיום", "#3B82F6");
    upcoming.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#D0D0D0;">${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${s.sessionType ? ` <span style="color:#555;font-size:11px;">· ${s.sessionType}</span>` : ""}</span>
            <span style="font-size:12px;color:#3B82F6;white-space:nowrap;font-weight:600;">${time}</span>
          </div>
        </div>`;
    });
  }

  if (needingUpdate.length > 0) {
    inner += sh("⚠ עברו ודורשים עדכון", "#F59E0B");
    needingUpdate.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;border-right:3px solid #F59E0B;padding-right:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#D0D0D0;">${s.projectName}${s.artist ? ` — ${s.artist}` : ""}</span>
            <span style="font-size:12px;color:#F59E0B;white-space:nowrap;">${time}</span>
          </div>
          <div style="font-size:11px;color:#F59E0B;margin-top:3px;">לעדכן סטטוס</div>
        </div>`;
    });
  }

  return `<div class="card"><h2>📅 סשנים היום</h2>${inner}</div>`;
}

/** Deadlines consolidated: due today + overdue + due soon — one card, sub-groups, rich detail */
function morningDeadlinesCard(data: ReportData): string {
  const today   = data.dueTodayProjects;
  const overdue = data.overdueProjects;
  const soon    = data.dueSoonProjects;

  if (today.length + overdue.length + soon.length === 0) {
    return `<div class="card"><h2>⏰ דדליינים</h2><div class="empty">אין דדליינים דחופים ✓</div></div>`;
  }

  function deadlineRow(p: ReportProject, urgency: "today" | "overdue" | "soon"): string {
    const dateStr = fmtDeadlineDate(p.deadline);
    const daysLine = urgency === "today"   ? "היום"
                   : urgency === "overdue" ? deadlineLabel(p)
                   : `עוד ${p.daysUntil} ימים`;
    const color = urgency === "today"   ? "#C084FC"
                : urgency === "overdue" ? "#EF4444"
                : "#F59E0B";
    const statusColor = p.status === "הושלם" ? "#10B981" : color;
    return `
      <div style="padding:10px 0;border-bottom:1px solid #1E1E1E;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <span style="font-size:13px;color:#D0D0D0;font-weight:600;">${p.name}</span>
          <span style="font-size:12px;color:${color};font-weight:700;white-space:nowrap;margin-right:8px;">${daysLine}</span>
        </div>
        ${p.artist ? `<div style="font-size:12px;color:#666;margin-top:2px;">${p.artist}</div>` : ""}
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:11px;color:#555;">${dateStr ? `דדליין: ${dateStr}` : "ללא תאריך"}</span>
          <span style="font-size:11px;color:${statusColor};">${p.status}</span>
        </div>
      </div>`;
  }

  let inner = "";

  if (today.length > 0) {
    inner += subhead("דדליין היום", "#C084FC");
    today.forEach((p) => { inner += deadlineRow(p, "today"); });
    if (overdue.length + soon.length > 0) inner += `<div style="height:6px;"></div>`;
  }

  if (overdue.length > 0) {
    inner += subhead("עברו דדליין", "#EF4444");
    overdue.forEach((p) => { inner += deadlineRow(p, "overdue"); });
    if (soon.length > 0) inner += `<div style="height:6px;"></div>`;
  }

  if (soon.length > 0) {
    inner += subhead("קרובים לדדליין", "#F59E0B");
    soon.forEach((p) => { inner += deadlineRow(p, "soon"); });
  }

  return `<div class="card"><h2>⏰ דדליינים</h2>${inner}</div>`;
}

// ─── Evening report ───────────────────────────────────────────────────────────

export function generateEveningReport(
  data:            ReportData,
  recommendations: string[]
): GeneratedReport {
  const date    = heDate(data.generatedAt);
  const subject = `Redbloods OS — סיכום יום | ${date}`;

  const tomorrowDeadlineProjects = data.projects.filter(
    (p) => p.daysUntil === 1 && p.status !== "הושלם"
  );

  const html = shell(`
    <!-- 1. כותרת -->
    <div class="head">
      <h1>🌙 סיכום יום</h1>
      <p class="sub">${date}</p>
    </div>

    <!-- 2. מה קרה היום בפועל — קובייה ראשית -->
    ${todayMainCard(data)}

    <!-- 3. מה היה אמור לקרות ולא נסגר -->
    ${openItemsCard(data)}

    <!-- 4. דדליינים (overdue + מחר בלבד — היום מטופל בחלק הקודם) -->
    ${deadlinesSection(data.overdueProjects, [], tomorrowDeadlineProjects)}

    <!-- 5. סשנים מחר -->
    ${tomorrowSessionsSection(data.tomorrowSessions)}

    <!-- 6. מצב כללי -->
    <div class="card">
      <h2>📊 מצב כללי</h2>
      ${stat("פרויקטים פעילים", String(data.activeProjects.length))}
      ${stat("פתוחים עם דדליין שעבר", String(data.overdueProjects.length), data.overdueProjects.length > 0 ? "r" : "g")}
      ${stat("חסרי מידע", String(data.missingInfoProjects.length), data.missingInfoProjects.length > 0 ? "a" : "")}
    </div>

    <!-- 7. ויקטור — רק אם יש משהו לדווח -->
    ${victorBlock(data)}

    <!-- 8. פעולות מומלצות למחר -->
    ${recommendationsSection(recommendations, "פעולות מומלצות למחר")}

    <div class="footer">
      Redbloods OS · דוח ערב אוטומטי · ${data.generatedAt.toLocaleTimeString("he-IL")}
    </div>
  `);

  const text = buildEveningText(data, recommendations);
  return { subject, html, text };
}

// ─── Evening section helpers ──────────────────────────────────────────────────

function fmtSessionTime(s: ReportSession): string {
  if (!s.startTime) return "";
  const start = s.startTime.slice(0, 5);
  const end   = s.endTime ? `–${s.endTime.slice(0, 5)}` : "";
  return end ? `${start} – ${end}` : start;
}

function fmtMoney(amount: number, currency: string, sign: "+" | "-" | "" = ""): string {
  return `${sign}${amount.toLocaleString("he-IL")} ${currency}`;
}

function subhead(text: string, color = "#888"): string {
  return `<div style="font-size:11px;font-weight:700;color:${color};letter-spacing:.05em;text-transform:uppercase;margin:14px 0 8px;padding-top:4px;border-top:1px solid #1E1E1E;">${text}</div>`;
}

function subheadFirst(text: string, color = "#888"): string {
  return `<div style="font-size:11px;font-weight:700;color:${color};letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px;">${text}</div>`;
}

// ─── Section: מה קרה היום בפועל ──────────────────────────────────────────────

function todayMainCard(data: ReportData): string {
  const hasFinance  = data.txReceivedToday.length + data.txPendingAddedToday.length + data.txExpensesToday.length > 0;
  const hasSessions = data.sessionsDone.length + data.sessionsNeedingUpdate.length +
                      data.sessionsCancelled.length + data.sessionsFutureScheduled.length > 0;
  const hasProjects = data.createdTodayProjects.length + data.completedTodayProjects.length > 0;

  if (!hasFinance && !hasSessions && !hasProjects) {
    return `<div class="card"><h2>⚡ מה קרה היום בפועל</h2><div class="empty">לא זוהו פעולות שבוצעו היום</div></div>`;
  }

  let inner = "";
  let firstGroup = true;

  function sh(text: string, color: string): string {
    const fn = firstGroup ? subheadFirst : subhead;
    firstGroup = false;
    return fn(text, color);
  }

  // ── כספים ──────────────────────────────────────────────────────────────────
  if (hasFinance) {
    inner += sh("💰 כספים", "#10B981");

    data.txReceivedToday.forEach((t) => {
      const label  = t.description || t.projectName;
      const detail = [
        t.projectName !== label ? t.projectName : "",
        t.artist,
        t.paymentMethod,
      ].filter(Boolean).join(" · ");
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#D0D0D0;">התקבל: ${label}</span>
            <span style="color:#10B981;font-weight:700;font-size:13px;white-space:nowrap;">${fmtMoney(t.amount, t.currency, "+")}</span>
          </div>
          ${detail ? `<div style="font-size:11px;color:#555;margin-top:2px;">${detail}</div>` : ""}
        </div>`;
    });

    data.txPendingAddedToday.forEach((t) => {
      const label  = t.description || t.projectName;
      const detail = [t.projectName !== label ? t.projectName : "", t.artist].filter(Boolean).join(" · ");
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#D0D0D0;">נוסף צפוי: ${label}</span>
            <span style="color:#F59E0B;font-size:13px;white-space:nowrap;">${fmtMoney(t.amount, t.currency)}</span>
          </div>
          ${detail ? `<div style="font-size:11px;color:#555;margin-top:2px;">${detail}</div>` : ""}
        </div>`;
    });

    data.txExpensesToday.forEach((t) => {
      const label  = t.description || t.projectName;
      const paid   = ["שולם","שולמה","התקבל"].includes(t.paymentStatus) ? "שולמה" : t.paymentStatus || "צפויה";
      const detail = [t.projectName !== label ? t.projectName : "", t.artist, paid].filter(Boolean).join(" · ");
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#D0D0D0;">הוצאה: ${label}</span>
            <span style="color:#EF4444;font-size:13px;white-space:nowrap;">${fmtMoney(t.amount, t.currency, "-")}</span>
          </div>
          ${detail ? `<div style="font-size:11px;color:#555;margin-top:2px;">${detail}</div>` : ""}
        </div>`;
    });

    // Finance totals if multiple
    const totalIn  = data.txReceivedToday.reduce((s, t) => s + t.amount, 0);
    const totalPending = data.txPendingAddedToday.reduce((s, t) => s + t.amount, 0);
    const totalOut = data.txExpensesToday.reduce((s, t) => s + t.amount, 0);
    const cur = (data.txReceivedToday[0] ?? data.txPendingAddedToday[0] ?? data.txExpensesToday[0])?.currency ?? "₪";
    const txCount = data.txReceivedToday.length + data.txPendingAddedToday.length + data.txExpensesToday.length;
    if (txCount > 1) {
      inner += `<div style="display:flex;gap:16px;padding:6px 0;font-size:12px;">`;
      if (totalIn > 0)      inner += `<span style="color:#10B981;">${fmtMoney(totalIn, cur, "+")} התקבל</span>`;
      if (totalPending > 0) inner += `<span style="color:#F59E0B;">${fmtMoney(totalPending, cur)} צפוי</span>`;
      if (totalOut > 0)     inner += `<span style="color:#EF4444;">${fmtMoney(totalOut, cur, "-")} הוצאות</span>`;
      inner += `</div>`;
    }
  }

  // ── סשנים ─────────────────────────────────────────────────────────────────
  if (hasSessions) {
    inner += sh("📅 סשנים", "#3B82F6");

    data.sessionsDone.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:13px;color:#D0D0D0;"><span style="color:#10B981;margin-left:6px;">✓</span>התקיים: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}</span>
            <span style="font-size:12px;color:#10B981;white-space:nowrap;">${time}</span>
          </div>
          ${s.sessionType ? `<div style="font-size:11px;color:#555;margin-top:2px;">${s.sessionType}</div>` : ""}
        </div>`;
    });

    data.sessionsNeedingUpdate.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;border-right:3px solid #F59E0B;padding-right:8px;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:13px;color:#D0D0D0;"><span style="color:#F59E0B;margin-left:6px;">⚠</span>עבר: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}</span>
            <span style="font-size:12px;color:#F59E0B;white-space:nowrap;">${time}</span>
          </div>
          <div style="font-size:11px;color:#F59E0B;margin-top:3px;">דורש עדכון — לסמן אם התקיים / בוטל / לא הגיע</div>
        </div>`;
    });

    data.sessionsCancelled.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:13px;color:#555;text-decoration:line-through;"><span style="color:#EF4444;margin-left:6px;text-decoration:none;">✕</span>בוטל: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}</span>
            <span style="font-size:12px;color:#555;">${time}</span>
          </div>
        </div>`;
    });

    data.sessionsFutureScheduled.forEach((s) => {
      const time = fmtSessionTime(s);
      const dateFmt = fmtDeadlineDate(s.date);
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:13px;color:#D0D0D0;"><span style="color:#3B82F6;margin-left:6px;">📅</span>נקבע: ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}</span>
            <span style="font-size:12px;color:#3B82F6;white-space:nowrap;">${dateFmt}${time ? ` · ${time}` : ""}</span>
          </div>
        </div>`;
    });
  }

  // ── פרויקטים ──────────────────────────────────────────────────────────────
  if (hasProjects) {
    inner += sh("📁 פרויקטים", "#A855F7");

    data.createdTodayProjects.forEach((p) => {
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <span style="font-size:13px;color:#D0D0D0;"><span style="color:#3B82F6;margin-left:6px;">＋</span>נוצר: ${p.name}${p.artist ? ` — ${p.artist}` : ""}</span>
        </div>`;
    });

    data.completedTodayProjects.forEach((p) => {
      inner += `
        <div style="padding:7px 0;border-bottom:1px solid #1E1E1E;">
          <span style="font-size:13px;color:#D0D0D0;"><span style="color:#C084FC;margin-left:6px;">★</span>הושלם: ${p.name}${p.artist ? ` — ${p.artist}` : ""}</span>
        </div>`;
    });
  }

  return `<div class="card"><h2>⚡ מה קרה היום בפועל</h2>${inner}</div>`;
}

// ─── Section: מה היה אמור לקרות ולא נסגר ────────────────────────────────────
// Only open/pending items — nothing already covered in todayMainCard

function openItemsCard(data: ReportData): string {
  // Sessions needing update are already in todayMainCard — put here only sessionsUpcoming
  const openSessions = data.sessionsUpcoming; // time hasn't passed yet

  // Expected payments: those with date=today NOT already in created-today buckets
  const createdTodayIds = new Set([
    ...data.txReceivedToday,
    ...data.txPendingAddedToday,
    ...data.txExpensesToday,
  ].map((t) => t.id));
  const PAID = new Set(["שולם","שולמה","התקבל","שולם חלקית"]);
  const unpaidExpectedToday = data.txExpectedToday.filter(
    (t) => !createdTodayIds.has(t.id) && !PAID.has(t.paymentStatus)
  );

  // Open deadlines today
  const openDueToday = data.dueTodayProjects.filter((p) => p.status !== "הושלם");

  // Calendar events
  const hasCalendar = data.calendarConnected && data.calendarEvents.length > 0;

  const hasAnything = openSessions.length + unpaidExpectedToday.length + openDueToday.length > 0 || hasCalendar;

  if (!hasAnything) return "";   // skip section entirely if nothing to show

  let inner = "";
  let first = true;

  function sh2(text: string, color: string): string {
    const fn = first ? subheadFirst : subhead;
    first = false;
    return fn(text, color);
  }

  // Calendar events
  if (hasCalendar) {
    inner += sh2("📅 יומן", "#3B82F6");
    data.calendarEvents.forEach((e) => {
      const fmtT = (iso: string) => {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      };
      const timeStr = e.isAllDay ? "כל היום" : `${fmtT(e.startTime)} – ${fmtT(e.endTime)}`;
      inner += `<div class="row">
        <span class="lbl">${e.title}${e.matchedProjectName ? ` <span class="tag">→ ${e.matchedProjectName}</span>` : ""}</span>
        <span class="val" style="color:#3B82F6;font-size:12px;">${timeStr}</span>
      </div>`;
    });
  }

  // Upcoming sessions today (not yet time)
  if (openSessions.length > 0) {
    inner += sh2("📅 סשנים שעוד לא התקיימו היום", "#888");
    openSessions.forEach((s) => {
      const time = fmtSessionTime(s);
      inner += `<div class="row">
        <span class="lbl">${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${s.sessionType ? ` · ${s.sessionType}` : ""}</span>
        <span class="val" style="color:#3B82F6;">${time}</span>
      </div>`;
    });
  }

  // Unpaid expected payments for today
  if (unpaidExpectedToday.length > 0) {
    inner += sh2("💳 תשלומים צפויים שלא התקבלו", "#F59E0B");
    unpaidExpectedToday.forEach((t) => {
      inner += `<div class="row">
        <span class="lbl">${t.description || t.type}${t.projectName && t.projectName !== "כללי" ? ` — ${t.projectName}` : ""}${t.artist ? ` · ${t.artist}` : ""}</span>
        <span class="val a">${fmtMoney(t.amount, t.currency)} · ${t.paymentStatus || "צפוי"}</span>
      </div>`;
    });
  }

  // Open deadlines due today
  if (openDueToday.length > 0) {
    inner += sh2("⏰ דדליין היום — עדיין פתוח", "#C084FC");
    openDueToday.forEach((p) => {
      inner += `<div class="row">
        <span class="lbl today">${p.name}${p.artist ? ` — ${p.artist}` : ""}</span>
        <span class="val hi">${p.status}</span>
      </div>`;
    });
  }

  return `<div class="card"><h2>📋 מה היה אמור לקרות ולא נסגר</h2>${inner}</div>`;
}

// Section 6: Tomorrow's sessions
function tomorrowSessionsSection(sessions: ReportSession[]): string {
  if (sessions.length === 0) {
    return `<div class="card"><h2>📅 סשנים מחר</h2><div class="empty">אין סשנים מתוכננים למחר</div></div>`;
  }
  const rows = sessions.map((s) => {
    const time = fmtSessionTime(s);
    return `<div class="row">
      <span class="lbl">${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${s.sessionType ? ` · ${s.sessionType}` : ""}</span>
      <span class="val">${time || s.status}</span>
    </div>`;
  }).join("");
  return `<div class="card"><h2>📅 סשנים מחר</h2>${rows}</div>`;
}

function fmtDeadlineDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Section 7: Deadlines — full detail: name, artist, date, days, status
function deadlinesSection(
  overdue: ReportProject[],
  dueToday: ReportProject[],
  dueTomorrow: ReportProject[]
): string {
  const hasAny = overdue.length + dueToday.length + dueTomorrow.length > 0;
  if (!hasAny) {
    return `<div class="card"><h2>⏰ דדליינים</h2><div class="empty">אין דדליינים דחופים ✓</div></div>`;
  }

  function deadlineCard(p: ReportProject, urgency: "today" | "overdue" | "tomorrow"): string {
    const dateStr  = fmtDeadlineDate(p.deadline);
    const daysLine = urgency === "today"    ? "היום"
                   : urgency === "tomorrow" ? "מחר"
                   : deadlineLabel(p);
    const statusColor = p.status === "הושלם" ? "#10B981"
                      : urgency === "overdue" ? "#EF4444"
                      : urgency === "today"   ? "#C084FC"
                      : "#F59E0B";
    const statusDone = p.status === "הושלם";
    return `
      <div style="padding:10px 0;border-bottom:1px solid #1E1E1E;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <span style="font-size:13px;color:#D0D0D0;font-weight:600;">${p.name}</span>
          <span style="font-size:12px;color:${statusColor};font-weight:700;white-space:nowrap;margin-right:8px;">${daysLine}</span>
        </div>
        ${p.artist ? `<div style="font-size:12px;color:#666;margin-top:2px;">${p.artist}</div>` : ""}
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:11px;color:#555;">דדליין: ${dateStr}</span>
          <span style="font-size:11px;color:${statusDone ? "#10B981" : "#888"};">${p.status}</span>
        </div>
      </div>`;
  }

  let inner = "";

  if (dueToday.length > 0) {
    inner += subhead("דדליין היום", "#C084FC");
    dueToday.forEach((p) => { inner += deadlineCard(p, "today"); });
    if (overdue.length + dueTomorrow.length > 0) inner += `<div style="height:8px;"></div>`;
  }

  if (overdue.length > 0) {
    inner += subhead("עברו דדליין", "#EF4444");
    overdue.forEach((p) => { inner += deadlineCard(p, "overdue"); });
    if (dueTomorrow.length > 0) inner += `<div style="height:8px;"></div>`;
  }

  if (dueTomorrow.length > 0) {
    inner += subhead("דדליין מחר", "#F59E0B");
    dueTomorrow.forEach((p) => { inner += deadlineCard(p, "tomorrow"); });
  }

  // Remove last border
  inner = inner.replace(/border-bottom:1px solid #1E1E1E;(?=[^}]*<\/div>\s*(?:<div style="height|<\/div>\s*<\/div>))/g, "border-bottom:none;");

  return `<div class="card"><h2>⏰ דדליינים</h2>${inner}</div>`;
}

// ─── Victor block ─────────────────────────────────────────────────────────────

function victorBlock(data: ReportData): string {
  const v = data.victorSummary;
  if (!v) return "";  // nothing to flag — skip entirely

  const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const [, m] = v.month.split("-");
  const monthLabel = HE_MONTHS[parseInt(m, 10) - 1];

  let lines = "";
  if (v.stuck > 0)    lines += `<div class="row"><span class="lbl">תקועים מעל הסף</span><span class="val r">${v.stuck}</span></div>`;
  if (v.needsFix > 0) lines += `<div class="row"><span class="lbl">דורשים תיקון</span><span class="val a">${v.needsFix}</span></div>`;
  if (v.belowPace)    lines += `<div class="row"><span class="lbl">קצב חודשי</span><span class="val r">מתחת ליעד — ${v.approved} / ${v.expectedByNow} צפוי</span></div>`;
  if (v.inProgress > 0) lines += `<div class="row"><span class="lbl">בעבודה אצל ויקטור</span><span class="val">${v.inProgress}</span></div>`;

  return `
    <div class="card">
      <h2>🎛 ויקטור — ${monthLabel}</h2>
      ${lines}
    </div>`;
}

// ─── HTML section helpers ─────────────────────────────────────────────────────

function stat(label: string, value: string, cls = ""): string {
  return `<div class="row"><span class="lbl">${label}</span><span class="val ${cls}">${value}</span></div>`;
}

function projectSection(
  title: string,
  projects: ReportProject[],
  cls: string,
  emptyMsg: string
): string {
  return `
    <div class="card">
      <h2>${title}</h2>
      ${
        projects.length === 0
          ? `<div class="empty">${emptyMsg}</div>`
          : projects
              .map(
                (p) => `
                <div class="row">
                  <span class="lbl ${cls}">${p.name}${p.artist ? ` — ${p.artist}` : ""}</span>
                  <span class="val">${deadlineLabel(p)}</span>
                </div>`
              )
              .join("")
      }
    </div>`;
}

function missingSection(projects: ReportProject[]): string {
  if (projects.length === 0) return "";
  return `
    <div class="card">
      <h2>ℹ️ חסרי מידע</h2>
      ${projects
        .map((p) => {
          const missing: string[] = [];
          if (!p.artist)   missing.push("שם אמן");
          if (!p.deadline) missing.push("דדליין");
          return `<div class="row">
            <span class="lbl">${p.name}</span>
            <span class="val a">חסר: ${missing.join(", ")}</span>
          </div>`;
        })
        .join("")}
    </div>`;
}

function calendarSection(
  events: ReportCalendarEvent[],
  connected: boolean,
  isEvening = false
): string {
  if (!connected) return "";
  if (events.length === 0) {
    return `<div class="card"><h2>📅 ${isEvening ? "היה אמור לקרות" : "אירועים היום"}</h2><div class="empty">אין אירועים ביומן היום</div></div>`;
  }
  return `
    <div class="card">
      <h2>📅 ${isEvening ? "מה היה אמור לקרות היום" : "אירועים ביומן היום"}</h2>
      ${events
        .map(
          (e) => `
          <div class="cal">
            <div style="font-size:12px;font-weight:700;color:#3B82F6;margin-bottom:3px;">${e.type}</div>
            <div style="font-size:13px;color:#D0D0D0;font-weight:600;">${e.title}</div>
            ${e.isAllDay ? "" : `<div style="font-size:12px;color:#555;margin-top:2px;">${fmtTime(e.startTime)} – ${fmtTime(e.endTime)}${e.location ? ` · ${e.location}` : ""}</div>`}
            ${e.matchedProjectName ? `<div style="font-size:11px;color:#A855F7;margin-top:3px;">→ פרויקט: ${e.matchedProjectName}</div>` : ""}
          </div>`
        )
        .join("")}
    </div>`;
}

function recommendationsSection(recs: string[], title: string): string {
  return `
    <div class="card">
      <h2>⚡ ${title}</h2>
      ${recs
        .map(
          (r, i) =>
            `<div class="rec"><span class="n">${i + 1}.</span>${r}</div>`
        )
        .join("")}
    </div>`;
}

// ─── Plain-text builders ──────────────────────────────────────────────────────

function buildMorningText(data: ReportData, recs: string[]): string {
  const lines: string[] = [
    `Redbloods OS — פתיחת יום | ${heDate(data.generatedAt)}`,
    "=".repeat(50),
    "",
    `📊 סקירה: ${data.activeProjects.length} פעילים | ${data.overdueProjects.length} עברו דדליין | ${data.dueTodayProjects.length} דדליין היום | ${data.dueSoonProjects.length} קרובים`,
    "",
  ];

  // Sessions today
  const upcoming = data.sessionsUpcoming ?? [];
  const needingUpdate = data.sessionsNeedingUpdate ?? [];
  if (upcoming.length + needingUpdate.length > 0) {
    lines.push("📅 סשנים היום:");
    upcoming.forEach((s) => {
      const time = fmtSessionTime(s);
      lines.push(`  • ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time ? ` (${time})` : ""}`);
    });
    needingUpdate.forEach((s) => {
      const time = fmtSessionTime(s);
      lines.push(`  ⚠ ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time ? ` (${time})` : ""} — לעדכן סטטוס`);
    });
    lines.push("");
  }

  // Calendar
  if (data.calendarEvents.length) {
    lines.push("📅 יומן היום:");
    data.calendarEvents.forEach((e) =>
      lines.push(`  • ${e.type}: ${e.title}${e.isAllDay ? "" : ` (${fmtTime(e.startTime)})`}`)
    );
    lines.push("");
  }

  // Deadlines — consolidated
  if (data.dueTodayProjects.length + data.overdueProjects.length + data.dueSoonProjects.length > 0) {
    lines.push("⏰ דדליינים:");
    if (data.dueTodayProjects.length) {
      lines.push("  היום:");
      data.dueTodayProjects.forEach((p) =>
        lines.push(`    • ${p.name}${p.artist ? ` — ${p.artist}` : ""} · ${p.status}`)
      );
    }
    if (data.overdueProjects.length) {
      lines.push("  עברו:");
      data.overdueProjects.forEach((p) =>
        lines.push(`    • ${p.name}${p.artist ? ` — ${p.artist}` : ""} (${deadlineLabel(p)})`)
      );
    }
    if (data.dueSoonProjects.length) {
      lines.push("  קרובים:");
      data.dueSoonProjects.forEach((p) =>
        lines.push(`    • ${p.name}${p.artist ? ` — ${p.artist}` : ""} — עוד ${p.daysUntil} ימים`)
      );
    }
    lines.push("");
  }

  if (data.missingInfoProjects.length) {
    lines.push(`ℹ️ חסרי מידע: ${data.missingInfoProjects.length} פרויקטים`);
    lines.push("");
  }

  lines.push("⚡ פעולות מומלצות להיום:");
  recs.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));

  return lines.join("\n");
}

function buildEveningText(data: ReportData, recs: string[]): string {
  const tomorrowDeadline = data.projects.filter(
    (p) => p.daysUntil === 1 && p.status !== "הושלם"
  );

  const lines: string[] = [
    `Redbloods OS — סיכום יום | ${heDate(data.generatedAt)}`,
    "=".repeat(50),
    "",
  ];

  // 2. מה קרה היום בפועל
  if (data.activityItems.length > 0) {
    lines.push("⚡ מה קרה היום בפועל:");
    data.activityItems.forEach((item) =>
      lines.push(`  ${item.icon} ${item.text}${item.sub ? ` (${item.sub})` : ""}`)
    );
  } else {
    lines.push("⚡ מה קרה היום בפועל: לא זוהו פעולות שבוצעו היום");
  }
  lines.push("");

  // 3. כספים היום
  const hasFinance = data.txReceivedToday.length + data.txPendingAddedToday.length + data.txExpensesToday.length > 0;
  if (hasFinance) {
    lines.push("💰 כספים היום:");
    if (data.txReceivedToday.length) {
      lines.push("  התקבל:");
      data.txReceivedToday.forEach((t) =>
        lines.push(`    • ${fmtMoney(t.amount, t.currency, "+")} — ${t.projectName}${t.description ? ` (${t.description})` : ""}`)
      );
    }
    if (data.txPendingAddedToday.length) {
      lines.push("  נוסף כצפוי:");
      data.txPendingAddedToday.forEach((t) =>
        lines.push(`    • ${fmtMoney(t.amount, t.currency)} — ${t.projectName}`)
      );
    }
    if (data.txExpensesToday.length) {
      lines.push("  הוצאות:");
      data.txExpensesToday.forEach((t) =>
        lines.push(`    • ${fmtMoney(t.amount, t.currency, "-")} — ${t.projectName}`)
      );
    }
    lines.push("");
  }

  // 4. סשנים היום
  const hasTodaySessions = data.sessionsDone.length + data.sessionsNeedingUpdate.length +
                           data.sessionsCancelled.length + data.sessionsUpcoming.length;
  if (hasTodaySessions > 0) {
    lines.push("📅 סשנים היום:");
    if (data.sessionsDone.length) {
      lines.push("  התקיימו:");
      data.sessionsDone.forEach((s) => {
        const time = fmtSessionTime(s);
        lines.push(`    ✓ ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time ? ` (${time})` : ""}`);
      });
    }
    if (data.sessionsNeedingUpdate.length) {
      lines.push("  דורשים עדכון:");
      data.sessionsNeedingUpdate.forEach((s) => {
        const time = fmtSessionTime(s);
        lines.push(`    ⚠ ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time ? ` (${time})` : ""} — לעדכן סטטוס`);
      });
    }
    if (data.sessionsCancelled.length) {
      lines.push("  בוטלו:");
      data.sessionsCancelled.forEach((s) =>
        lines.push(`    ✕ ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}`)
      );
    }
    lines.push("");
  }

  // 5. מה היה אמור לקרות
  if (data.calendarEvents.length) {
    lines.push("📋 מה היה אמור לקרות היום (יומן):");
    data.calendarEvents.forEach((e) => lines.push(`  • ${e.type}: ${e.title}`));
    lines.push("");
  }

  // 6. סשנים מחר
  if (data.tomorrowSessions.length) {
    lines.push("📅 סשנים מחר:");
    data.tomorrowSessions.forEach((s) => {
      const time = fmtSessionTime(s);
      lines.push(`  • ${s.projectName}${s.artist ? ` — ${s.artist}` : ""}${time ? ` (${time})` : ""}`);
    });
    lines.push("");
  }

  // 7. דדליינים
  const hasDeadlines = data.dueTodayProjects.length + data.overdueProjects.length + tomorrowDeadline.length > 0;
  if (hasDeadlines) {
    lines.push("⏰ דדליינים:");
    if (data.dueTodayProjects.length) {
      lines.push("  היום:");
      data.dueTodayProjects.forEach((p) => lines.push(`    • ${p.name} — ${p.status === "הושלם" ? "הושלם ✓" : "עדיין פתוח"}`));
    }
    if (data.overdueProjects.length) {
      lines.push("  עברו:");
      data.overdueProjects.forEach((p) => lines.push(`    • ${p.name} (${deadlineLabel(p)})`));
    }
    if (tomorrowDeadline.length) {
      lines.push("  מחר:");
      tomorrowDeadline.forEach((p) => lines.push(`    • ${p.name}`));
    }
    lines.push("");
  }

  // 8. מצב כללי
  lines.push(`📊 מצב כללי: ${data.activeProjects.length} פעילים | ${data.overdueProjects.length} עברו דדליין | ${data.missingInfoProjects.length} חסרי מידע`);
  lines.push("");

  // 9. פעולות מחר
  lines.push("⚡ פעולות מומלצות למחר:");
  recs.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));

  return lines.join("\n");
}
