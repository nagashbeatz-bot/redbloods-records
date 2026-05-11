/**
 * HTML + plain-text email templates for daily reports.
 * Pure functions — no server imports.
 */

import type { ReportData, GeneratedReport, ReportProject, ReportCalendarEvent } from "./types";

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
    <!-- Header -->
    <div class="head">
      <h1>☀️ פתיחת יום</h1>
      <p class="sub">${date}</p>
    </div>

    <!-- Quick stats -->
    <div class="card">
      <h2>סקירה מהירה</h2>
      ${stat("פרויקטים פעילים", String(data.activeProjects.length))}
      ${stat("עברו דדליין", String(data.overdueProjects.length), data.overdueProjects.length > 0 ? "r" : "")}
      ${stat("דדליין היום", String(data.dueTodayProjects.length), data.dueTodayProjects.length > 0 ? "hi" : "")}
      ${stat("קרובים לדדליין", String(data.dueSoonProjects.length), data.dueSoonProjects.length > 0 ? "a" : "")}
      ${stat("חסרי מידע", String(data.missingInfoProjects.length), data.missingInfoProjects.length > 0 ? "a" : "")}
    </div>

    ${calendarSection(data.calendarEvents, data.calendarConnected)}

    ${projectSection("🔴 דדליין היום", data.dueTodayProjects, "today", "אין פרויקטים עם דדליין היום")}
    ${projectSection("⚠️ עברו דדליין", data.overdueProjects, "ovd", "אין פרויקטים שעברו דדליין")}
    ${projectSection("🟡 קרובים לדדליין", data.dueSoonProjects, "soon", "אין פרויקטים קרובים לדדליין")}
    ${missingSection(data.missingInfoProjects)}
    ${recommendationsSection(recommendations, "פעולות מומלצות להיום")}

    <div class="footer">
      Redbloods OS · דוח בוקר אוטומטי · ${data.generatedAt.toLocaleTimeString("he-IL")}
    </div>
  `);

  const text = buildMorningText(data, recommendations);

  return { subject, html, text };
}

// ─── Evening report ───────────────────────────────────────────────────────────

export function generateEveningReport(
  data:            ReportData,
  recommendations: string[]
): GeneratedReport {
  const date    = heDate(data.generatedAt);
  const subject = `Redbloods OS — סיכום יום | ${date}`;

  const html = shell(`
    <!-- Header -->
    <div class="head">
      <h1>🌙 סיכום יום</h1>
      <p class="sub">${date}</p>
    </div>

    <!-- Quick stats -->
    <div class="card">
      <h2>מצב כללי</h2>
      ${stat("פרויקטים פעילים", String(data.activeProjects.length))}
      ${stat("עדיין פתוחים עם דדליין עבר", String(data.overdueProjects.length), data.overdueProjects.length > 0 ? "r" : "g")}
      ${stat("יעברו דדליין מחר", String(data.projects.filter(p => p.daysUntil === 1 && p.status !== "הושלם").length))}
      ${stat("חסרי מידע", String(data.missingInfoProjects.length), data.missingInfoProjects.length > 0 ? "a" : "")}
    </div>

    ${calendarSection(data.calendarEvents, data.calendarConnected, true)}
    ${projectSection("🔴 עדיין פתוחים — עבר דדליין", data.overdueProjects, "ovd", "אין פרויקטים שעברו דדליין ✓")}
    ${projectSection("🟡 יגיעו לדדליין מחר", data.projects.filter(p => p.daysUntil === 1 && p.status !== "הושלם"), "soon", "אין פרויקטים עם דדליין מחר")}
    ${missingSection(data.missingInfoProjects)}
    ${recommendationsSection(recommendations, "פעולות מומלצות למחר")}

    <div class="footer">
      Redbloods OS · דוח ערב אוטומטי · ${data.generatedAt.toLocaleTimeString("he-IL")}
    </div>
  `);

  const text = buildEveningText(data, recommendations);

  return { subject, html, text };
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
    `📊 סקירה: ${data.activeProjects.length} פעילים | ${data.overdueProjects.length} עברו דדליין | ${data.dueTodayProjects.length} דדליין היום`,
    "",
  ];

  if (data.calendarEvents.length) {
    lines.push("📅 אירועים היום:");
    data.calendarEvents.forEach((e) =>
      lines.push(`  • ${e.type}: ${e.title}${e.isAllDay ? "" : ` (${fmtTime(e.startTime)})`}`)
    );
    lines.push("");
  }

  if (data.dueTodayProjects.length) {
    lines.push("🔴 דדליין היום:");
    data.dueTodayProjects.forEach((p) => lines.push(`  • ${p.name} — ${p.artist}`));
    lines.push("");
  }

  if (data.overdueProjects.length) {
    lines.push("⚠️ עברו דדליין:");
    data.overdueProjects.forEach((p) => lines.push(`  • ${p.name} — ${p.artist} (${deadlineLabel(p)})`));
    lines.push("");
  }

  if (data.dueSoonProjects.length) {
    lines.push("🟡 קרובים לדדליין:");
    data.dueSoonProjects.forEach((p) => lines.push(`  • ${p.name} — ${deadlineLabel(p)}`));
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
  const tomorrowProjects = data.projects.filter(
    (p) => p.daysUntil === 1 && p.status !== "הושלם"
  );
  const lines: string[] = [
    `Redbloods OS — סיכום יום | ${heDate(data.generatedAt)}`,
    "=".repeat(50),
    "",
    `📊 מצב: ${data.activeProjects.length} פעילים | ${data.overdueProjects.length} פתוחים עם דדליין עבר`,
    "",
  ];

  if (data.calendarEvents.length) {
    lines.push("📅 מה היה אמור לקרות היום:");
    data.calendarEvents.forEach((e) =>
      lines.push(`  • ${e.type}: ${e.title}`)
    );
    lines.push("");
  }

  if (data.overdueProjects.length) {
    lines.push("🔴 עדיין פתוחים — עבר דדליין:");
    data.overdueProjects.forEach((p) => lines.push(`  • ${p.name} — ${deadlineLabel(p)}`));
    lines.push("");
  }

  if (tomorrowProjects.length) {
    lines.push("🟡 דדליין מחר:");
    tomorrowProjects.forEach((p) => lines.push(`  • ${p.name}`));
    lines.push("");
  }

  if (data.missingInfoProjects.length) {
    lines.push(`ℹ️ חסרי מידע: ${data.missingInfoProjects.length} פרויקטים`);
    lines.push("");
  }

  lines.push("⚡ פעולות מומלצות למחר:");
  recs.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));

  return lines.join("\n");
}
