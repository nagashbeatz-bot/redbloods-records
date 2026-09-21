/**
 * COO Phase 1a — one-off READ-ONLY shadow run against the real database.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/coo-shadow-run.ts
 *
 * Safety (all enforced in this file, before any lib/coo or store module is imported):
 *   - only SUPABASE_URL + SUPABASE_SECRET_KEY are read from .env.local (no push / cron / mail / LLM keys);
 *   - global fetch is replaced by a guard: only GET/HEAD to the Supabase host are let through,
 *     anything else (POST/PATCH/PUT/DELETE, or any other host) is BLOCKED and counted;
 *   - no Next server, no instrumentation, no cron, no agent/check, no LLM.
 * It prints a readable report — not the raw state.
 */
import fs from "node:fs";
import path from "node:path";

// ── 1. env: only the two Supabase variables ─────────────────────────────────
const envText = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(SUPABASE_URL|SUPABASE_SECRET_KEY)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("missing SUPABASE_* in .env.local");
const SB_HOST = new URL(process.env.SUPABASE_URL).host;

// ── 2. read-only fetch guard (audit trail + hard block) ─────────────────────
const audit: { method: string; path: string }[] = [];
const blocked: { method: string; url: string }[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const safe = (method === "GET" || method === "HEAD") && url.host === SB_HOST;
  if (!safe) { blocked.push({ method, url: `${url.host}${url.pathname}` }); throw new Error(`READ-ONLY GUARD blocked ${method} ${url.host}${url.pathname}`); }
  audit.push({ method, path: url.pathname.replace(/\/v1\//, "/") });
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// ── 3. run ──────────────────────────────────────────────────────────────────
const out: string[] = [];
const p = (s = "") => out.push(s);
const rt = (r: { t: string }[]) => r.map((x) => x.t).join("");

async function main() {
  const { readCooRaw } = await import("../lib/coo/readers");
  const { computeCoo } = await import("../lib/coo/pipeline");
  const { COO_CONFIG } = await import("../lib/coo/config");
  const { ilYmd } = await import("../lib/coo/dates");

  const now = new Date();
  const raw = await readCooRaw(now, COO_CONFIG);
  const { state, signals, cases, brief } = computeCoo(raw, now, COO_CONFIG);
  const today = ilYmd(now);

  // ── 1. Company status ────────────────────────────────────────────────────
  p(`══ 1. מצב החברה (${today}, config ${COO_CONFIG.version}, provisional) ══`);
  p(`כותרת: ${rt(brief.headline)}`);
  p(`כיסוי: ${brief.coverageLine}`);
  p(`Cases לפי tier: P0=${brief.tierCounts.P0} P1=${brief.tierCounts.P1} P2=${brief.tierCounts.P2} P3=${brief.tierCounts.P3}  (סה"כ ${cases.length}; מוצגים בדשבורד: ${brief.cases.length}, מוסתרים מ-P0/P1: ${brief.hiddenCaseCount}, נמוכים יותר: ${brief.lowerTierCaseCount})`);
  p(`מקורות: ${raw.sources.map((s) => `${s.source}=${s.status}${s.rowCount != null ? `(${s.rowCount})` : ""}${s.error ? ` ERR:${s.error}` : ""}`).join(" · ")}`);
  p(`סיגנלים גולמיים: ${signals.length} (ראשיים ${signals.filter((s) => s.role === "primary").length}, תומכים ${signals.filter((s) => s.role === "supporting").length}, הערות ${signals.filter((s) => s.role === "notice").length})`);
  const byType: Record<string, number> = {};
  for (const s of signals) byType[s.type] = (byType[s.type] ?? 0) + 1;
  p(`לפי סוג: ${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(", ")}`);

  // ── 2. Cases ─────────────────────────────────────────────────────────────
  p(""); p(`══ 2. Cases (Top ${Math.min(12, cases.length)} מתוך ${cases.length}) ══`);
  cases.slice(0, 12).forEach((c, i) => {
    p(`\n[${i + 1}] ${c.tier} · ${c.kind}:${c.title}${c.subtitle ? ` (${c.subtitle})` : ""}  · ביטחון ${c.confidence.level}`);
    p(`   סיכום: ${rt(c.summary)}`);
    p(`   סיגנלים: ${c.signals.map((s) => `${s.type}[${s.role}/${s.tier}]`).join(", ")}`);
    p(`   למה ${c.tier}: ${c.tierReasons.join(" | ")}`);
    const lead = [...c.signals].sort((a, b) => b.sort - a.sort)[0];
    const ev = c.signals.flatMap((s) => s.evidence).slice(0, 6);
    p(`   Evidence: ${ev.map((e) => `${e.label}=${e.display} <${e.source.table}${e.source.field ? "." + e.source.field : ""}>`).join(" ; ")}`);
    if (lead && lead.rules[0]) p(`   כלל מוביל: ${lead.rules[0].description} (סף: ${lead.rules[0].threshold ?? "—"}; נמדד: ${lead.rules[0].observed})`);
    if (c.contextFacts.length) p(`   הקשר: ${c.contextFacts.map((f) => `${f.title}: ${rt(f.short)}`).join(" ; ")}`);
    if (c.connections.length) p(`   קשרים: ${c.connections.map((x) => `${x.to.name} via ${x.via}`).join(" ; ")}`);
    p(`   Coverage: ${c.coverage.map((k) => `${k.label} ${k.usable ?? "?"}/${k.total ?? "?"}`).join(" ; ")}`);
    p(`   Missing: ${c.missing.length ? c.missing.join(" | ") : "—"}`);
  });
  if (cases.length > 12) {
    const rest = cases.slice(12);
    const cnt: Record<string, number> = {};
    for (const c of rest) cnt[c.tier] = (cnt[c.tier] ?? 0) + 1;
    p(`\n… ועוד ${rest.length} Cases: ${Object.entries(cnt).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    p(`   דוגמאות: ${rest.slice(0, 8).map((c) => `${c.tier} ${c.title} [${c.signals.map((s) => s.type).join("+")}]`).join(" ; ")}`);
  }

  // ── 3. Notices ───────────────────────────────────────────────────────────
  p(""); p("══ 3. הערות (Notices) ══");
  for (const n of brief.notices) {
    p(`• [${n.type}/${n.tier}] ${rt(n.title)}${n.missing.length ? `  — ${n.missing.join(" | ")}` : ""}`);
    if (n.type === "STALE_PROJECT_DEADLINE") for (const e of n.evidence.filter((x) => x.id.startsWith("stale:p:"))) p(`     · ${e.label} — ${e.display}`);
    if (n.type === "VICTOR_WORKLOAD") p(`     · ${n.evidence.map((e) => `${e.label}=${e.display}`).join(" ; ")}`);
    if (n.type === "TASKS_BACKLOG") p(`     · ${n.evidence.map((e) => `${e.label}=${e.display}`).join(" ; ")}`);
  }
  p(`איכות נתונים (${state.dataQuality.length}):`);
  for (const d of state.dataQuality) p(`• [${d.severity}] ${d.label} (${d.count}) — ${d.detail}`);

  // ── 4. Team ──────────────────────────────────────────────────────────────
  p(""); p("══ 4. צוות ══");
  p(`Steven: ${brief.team.steven ? rt(brief.team.steven) : "אין מידע"}`);
  const sv = state.team.steven;
  if (sv) {
    p(`  עבודות סה"כ ${sv.totalWorks}; פתוחות ${sv.open.length} (מקושרות לפרויקט ${sv.linkedOpen}); מאושרות-לא-שולמו ${sv.approvedUnpaid.works.length}`);
    for (const w of sv.open) p(`  · פתוחה: "${w.title}" סטטוס=${w.status} (${w.uiStatus}) דדליין-פנימי=${w.internalDeadline ?? "—"} (${w.daysToInternal ?? "?"} ימים) פרויקט=${w.projectId ? "מקושר" : "לא מקושר"} · גרסת מיקס=${w.hasMixVersion ? "כן" : "לא"} · העלאה אחרונה=${w.lastUploadAt ?? "אין"} · נשלח=${w.sentDate ?? "—"}`);
  }
  p(`Victor: ${brief.team.victor ? rt(brief.team.victor) : "אין מידע"}`);
  const vc = state.team.victor;
  if (vc && raw.victor) {
    p(`  עבודות סה"כ ${vc.totalWorks}; פעילות ${vc.active.length}; (עובדה גולמית של הפורטל, לא בשימוש ב-COO: "תקועות" מעל ${vc.stuckAfterDays} ימים = ${vc.stuckCount}); מקושרות לפרויקט ${vc.linkedActive}; ממתינות לבעלים ${vc.waitingOwner.length}`);
    const ds = vc.active.map((w) => w.daysSinceSent).filter((d): d is number => d != null).sort((a, b) => a - b);
    const bucket = (lo: number, hi: number) => ds.filter((d) => d >= lo && d <= hi).length;
    p(`  התפלגות ימים-מאז-שליחה (פעילות): 0-${vc.stuckAfterDays}: ${bucket(0, vc.stuckAfterDays)} · ${vc.stuckAfterDays + 1}-14: ${bucket(vc.stuckAfterDays + 1, 14)} · 15-30: ${bucket(15, 30)} · 31-60: ${bucket(31, 60)} · 61+: ${ds.filter((d) => d > 60).length} · ללא תאריך שליחה: ${vc.active.length - ds.length}`);
    p(`  ותיקה ביותר: ${ds.length ? ds[ds.length - 1] + " ימים" : "—"}; חציון: ${ds.length ? ds[Math.floor(ds.length / 2)] + " ימים" : "—"}`);
    for (const w of vc.active.filter((x) => x.internalDeadline)) p(`  · Victor עם דדליין פנימי: "${w.title}" דדליין=${w.internalDeadline} מצב=${w.workState ?? "?"} נשלח לפני ${w.daysSinceSent ?? "?"} ימים פרויקט=${w.projectId ? "מקושר" : "לא"}`);
    const states: Record<string, number> = {};
    for (const w of vc.active) states[w.workState ?? "(ריק)"] = (states[w.workState ?? "(ריק)"] ?? 0) + 1;
    p(`  workState (פעילות): ${Object.entries(states).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    const rawStatuses: Record<string, number> = {};
    for (const w of raw.victor.works) rawStatuses[w.status] = (rawStatuses[w.status] ?? 0) + 1;
    p(`  status גולמי (כל העבודות): ${Object.entries(rawStatuses).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    p(`  Cases של Victor (כולל תלות בפרויקט): ${cases.filter((c) => c.signals.some((s) => s.type.startsWith("VICTOR") && s.type !== "VICTOR_WORKLOAD")).map((c) => `${c.tier} ${c.title}`).join(", ") || "אין"}; האם נוצר Case של Victor? ${cases.some((c) => c.signals.some((s) => s.type.startsWith("VICTOR"))) ? "כן" : "לא"}; סיגנלי VICTOR: ${signals.filter((s) => s.type.startsWith("VICTOR")).map((s) => `${s.type}[${s.role}/${s.tier}] ${rt(s.short)}`).join(" ; ") || "אין"}`);
  }

  // ── 5. Projects / deadlines ──────────────────────────────────────────────
  p(""); p("══ 5. פרויקטים ודדליינים ══");
  if (state.projects) {
    const pr = state.projects;
    p(`סה"כ ${pr.total}; לפי סטטוס: ${Object.entries(pr.byStatus).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    const act = pr.open.filter((x) => x.active);
    const dl = act.filter((x) => x.deadline.ymd);
    const d = (x: { deadline: { daysTo: number | null } }) => x.deadline.daysTo as number;
    p(`פעילים (לא סגורים/מושהים): ${act.length}`);
    p(`  עם דדליין תקין: ${dl.length}`);
    p(`  overdue: ${dl.filter((x) => d(x) < 0).length}  (≥7 ימי איחור: ${dl.filter((x) => d(x) <= -7).length}, ≥30: ${dl.filter((x) => d(x) <= -30).length})`);
    p(`  היום: ${dl.filter((x) => d(x) === 0).length} · בתוך 7 ימים (0..7): ${dl.filter((x) => d(x) >= 0 && d(x) <= 7).length} · בתוך 14: ${dl.filter((x) => d(x) >= 0 && d(x) <= 14).length} · בתוך 30: ${dl.filter((x) => d(x) >= 0 && d(x) <= 30).length} · אחרי 30: ${dl.filter((x) => d(x) > 30).length}`);
    p(`  בלי דדליין: ${act.filter((x) => !x.deadline.raw || !x.deadline.raw.trim()).length}; לא ניתן לפענוח: ${act.filter((x) => !x.deadline.parseOk).length}`);
    const overdue = dl.filter((x) => d(x) < 0).sort((a, b) => d(a) - d(b));
    p(`  overdue לפי גיל: ${overdue.slice(0, 12).map((x) => `${x.name} [${x.status}] ${-d(x)}ד׳ (עודכן לפני ${x.daysSinceUpdate ?? "?"}ד׳)`).join(" ; ")}${overdue.length > 12 ? ` … +${overdue.length - 12}` : ""}`);
    const staleOverdue = overdue.filter((x) => (x.daysSinceUpdate ?? 0) >= COO_CONFIG.staleProjectDays).length;
    p(`  מתוך ה-overdue: ${staleOverdue} לא עודכנו ${COO_CONFIG.staleProjectDays}+ ימים (דדליין כנראה מיושן)`);
    const overdueTypes = signals.filter((s) => s.type === "PROJECT_OVERDUE");
    p(`  סיגנלי PROJECT_OVERDUE: ${overdueTypes.length}; לפי tier: ${["P0", "P1", "P2", "P3"].map((t) => `${t}=${overdueTypes.filter((s) => s.tier === t).length}`).join(" ")}`);
  }
  if (state.tasks) {
    const t = state.tasks;
    p(`משימות: פתוחות ${t.openCount}, באיחור ${t.overdueCount}, בלי תאריך ${t.noDueCount}, גיל-איחור 1-7:${t.ageBuckets.d1_7} 8-30:${t.ageBuckets.d8_30} 31+:${t.ageBuckets.d31plus}, מקושרות לפרויקט ${t.linkedToProject}`);
  }
  if (state.releases) p(`Releases: פרויקטי לייבל ${state.releases.labelProjectsTotal}, עם שורת release ${state.releases.withReleaseRow}, פעילות ${state.releases.rows.length}`);

  // ── 6. Money ─────────────────────────────────────────────────────────────
  p(""); p("══ 6. כסף (רק מה ש-V1 מציג) ══");
  for (const m of brief.money) p(`• ${m.label}: ${rt(m.text)}${m.note ? `  [${m.note}]` : ""}`);
  if (state.receivables) {
    const r = state.receivables;
    p(`  coverage גבייה: ${r.withPrice} מתוך ${r.considered} פרויקטים עם מחיר מוסכם; exceptions=${r.exceptions}; עם יתרה=${r.withBalance}`);
    for (const row of r.rows) p(`  · ${row.projectName} [${row.projectStatus}] מחיר ${row.agreedPrice}${row.currency} התקבל ${row.received} יתרה ${row.balance}`);
  }

  // ── 7. agent_alerts ──────────────────────────────────────────────────────
  p(""); p("══ 7. agent_alerts (status=new) ══");
  const all = raw.alerts;
  if (all) {
    const types: Record<string, number> = {};
    for (const a of all) types[a.type] = (types[a.type] ?? 0) + 1;
    p(`סה"כ new שנקראו: ${all.length}${all.length >= 200 ? " (הגענו ל-limit=200 — ייתכן שיש עוד)" : ""}; לפי סוג: ${Object.entries(types).map(([k, v]) => `${k}×${v}`).join(", ") || "—"}`);
    p(`allowlist: ${COO_CONFIG.alerts.allowTypes.join(", ")}; גיל מקסימלי: ${COO_CONFIG.alerts.maxAgeDays} ימים`);
    p(`עברו (${state.alerts?.shown.length ?? 0}): ${state.alerts?.shown.map((a) => `${a.type} "${a.title}" (גיל ${a.ageDays}ד׳)`).join(" ; ") || "אין"}`);
    p(`נדחו: ${state.alerts?.ignoredCount ?? 0}`);
    const ages = all.map((a) => Math.floor((now.getTime() - new Date(a.createdAt).getTime()) / 86400000)).sort((a, b) => a - b);
    if (ages.length) p(`גילאי new: הצעיר ${ages[0]}ד׳, הוותיק ${ages[ages.length - 1]}ד׳`);
  } else p("לא נטען");

  // ── focused views ─────────────────────────────────────────────────────────
  p(""); p("══ 9. Cases של Steven ══");
  for (const c of cases.filter((x) => x.signals.some((sg) => sg.type.startsWith("STEVEN")))) {
    p(`• ${c.tier} · ${c.title} [${c.signals.map((sg) => `${sg.type}/${sg.tier}/${sg.role}`).join(", ")}] class=${Math.min(...c.signals.map((sg) => sg.sortClass))}`);
    p(`    ${rt(c.summary)}`);
    p(`    למה: ${c.tierReasons.slice(0, 3).join(" | ")}`);
  }
  p(""); p("══ 10. Case של release ══");
  for (const c of cases.filter((x) => x.signals.some((sg) => sg.type === "RELEASE_TARGET_APPROACHING"))) {
    p(`• ${c.tier} · ${c.title} · ${rt(c.summary)}`);
    p(`    למה: ${c.tierReasons.slice(0, 3).join(" | ")}`);
    p(`    Missing: ${c.missing.join(" | ") || "—"}`);
    p(`    Coverage (כללי): ${c.coverage.map((k) => `${k.label} ${k.usable ?? "?"}/${k.total ?? "?"}`).join(" ; ")}`);
  }
  if (!cases.some((x) => x.signals.some((sg) => sg.type === "RELEASE_TARGET_APPROACHING"))) p("(אין Case של release)");
  p(""); p("══ 11. כל ה-Cases לפי סדר (tier · class · כותרת · סיגנלים) ══");
  cases.forEach((c, i) => p(`${String(i + 1).padStart(2)}. ${c.tier} · class ${Math.min(...c.signals.map((sg) => sg.sortClass))} · ${c.title} [${c.signals.map((sg) => sg.type).join("+")}]`));

  // ── audit ────────────────────────────────────────────────────────────────
  p(""); p("══ AUDIT ══");
  const byPath: Record<string, number> = {};
  for (const a of audit) byPath[`${a.method} ${a.path}`] = (byPath[`${a.method} ${a.path}`] ?? 0) + 1;
  p(`בקשות רשת: ${audit.length}, כולן GET/HEAD ל-Supabase: ${Object.entries(byPath).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  p(`נחסמו ע"י ה-guard (כתיבה / host אחר): ${blocked.length}${blocked.length ? " → " + blocked.map((b) => `${b.method} ${b.url}`).join(", ") : ""}`);
  p(`נתוני DB שונו: לא (guard מאפשר GET/HEAD בלבד)`);
}

main()
  .catch((e) => { p(`\nFAILED: ${e instanceof Error ? e.stack : String(e)}`); p(`blocked=${JSON.stringify(blocked)}`); process.exitCode = 1; })
  .finally(() => console.log(out.join("\n")));
