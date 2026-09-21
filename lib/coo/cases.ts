/**
 * Cases — PURE. Signal ≠ Card: signals about the SAME entity are folded into ONE
 * Case. Connections between entities come ONLY from fields that carry a real ID
 * (tasks.related_id, sound_engineer_work.project_id, vendor_project_work.project_id,
 * sessions.project_id, project_release_details.project_id). Free-text links
 * (artist name, client name, parent_project) are never used to connect anything.
 */
import type { CooConfig } from "./config";
import type {
  Case, CompanyState, Connection, ContextFact, CoverageEntry, EntityRef, EntityType, Rich, Signal,
} from "./types";
import { fullDate, shortDate } from "./dates";
import { rich } from "./rich";
import { compareCases, resolveCaseTier } from "./priority";
import { projectEntity } from "./signals";
import { projectLiveness } from "./liveness";

const entityKey = (e: EntityRef) => `${e.type}:${e.id}`;
const KIND_LABEL: Record<EntityType, string> = { project: "פרויקט", team: "צוות", proposal: "הצעת מחיר", show: "הופעה", company: "כללי" };

export function buildCases(state: CompanyState, signals: Signal[], cfg: CooConfig): { cases: Case[]; notices: Signal[] } {
  const asOf = state.meta.asOf;
  const notices = signals.filter((s) => s.role === "notice");
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    if (s.role === "notice") continue;
    const k = entityKey(s.entity);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  // projects whose (old) deadline is listed in the aggregated STALE_PROJECT_DEADLINE notice — they are NOT signals
  const staleByProject = new Map<string, string>();
  for (const e of notices.find((n) => n.type === "STALE_PROJECT_DEADLINE")?.evidence ?? []) {
    if (e.id.startsWith("stale:p:")) staleByProject.set(e.id.slice("stale:p:".length), e.display);
  }

  const covByKey = new Map<string, CoverageEntry>(state.coverage.map((c) => [c.key, c]));
  const steven = state.team.steven, victor = state.team.victor;
  const cases: Case[] = [];

  for (const [key, sigs] of groups) {
    const entity = sigs[0].entity;
    const connections: Connection[] = [];
    const contextFacts: ContextFact[] = [];
    const caseMissing: string[] = [];
    const covKeys = new Set<string>(sigs.flatMap((s) => s.coverageKeys));
    let subtitle: string | null = KIND_LABEL[entity.type];

    if (entity.type === "project") {
      const pid = entity.id;
      const pinfo = state.projects?.index[pid];
      const pfact = state.projects?.open.find((p) => p.id === pid);
      subtitle = pinfo ? `${pinfo.status}${pinfo.artistText ? ` · ${pinfo.artistText}` : ""}` : KIND_LABEL.project;
      const signalledStevenWorks = new Set(sigs.filter((s) => s.type === "STEVEN_WORK_DEADLINE" || s.type === "STEVEN_WAITING_OWNER").map((s) => s.id.split(":").slice(1).join(":")));

      // Steven — via sound_engineer_work.project_id
      const sw = (steven?.open ?? []).filter((w) => w.projectId === pid);
      for (const w of sw) {
        connections.push({ from: entity, to: { type: "team", id: "steven", name: "Steven" }, via: "sound_engineer_work.project_id", linkType: "id", asOf });
        if (!signalledStevenWorks.has(w.id)) {
          contextFacts.push({
            id: `ctx:steven:${w.id}`, title: "עבודה פתוחה אצל Steven",
            short: rich(`אצל Steven: "${w.title}" (${w.uiStatus}${w.daysToInternal !== null ? `, דדליין פנימי ${w.daysToInternal < 0 ? `עבר לפני ${-w.daysToInternal}` : `בעוד ${w.daysToInternal}`} ימים` : ""})`),
            evidence: [{ id: `ev:${w.id}:cstatus`, label: "סטטוס העבודה", value: w.uiStatus, display: `${w.uiStatus} (DB: ${w.status})`, kind: "status", source: { table: "sound_engineer_work", id: w.id, field: "status" }, asOf }],
          });
        }
      }
      if (sw.length > 0 && steven) {
        if (covByKey.has("steven.link")) covKeys.add("steven.link");
        contextFacts.push({
          id: "ctx:steven:load", title: "עומס Steven", short: rich(`ל-Steven ${steven.open.length} עבודות פתוחות בסך הכל`),
          evidence: [{ id: "ev:steven:load", label: "עבודות פתוחות אצל Steven", value: steven.open.length, display: String(steven.open.length), kind: "count", source: { table: "sound_engineer_work", field: "status" }, asOf }],
        });
      }

      // Victor — via vendor_project_work.project_id
      for (const w of (victor?.active ?? []).filter((x) => x.projectId === pid)) {
        connections.push({ from: entity, to: { type: "team", id: "victor", name: "Victor" }, via: "vendor_project_work.project_id", linkType: "id", asOf });
        covKeys.add("victor.link");
        contextFacts.push({
          id: `ctx:victor:${w.id}`, title: "עבודה פעילה אצל Victor",
          short: rich(`אצל Victor: "${w.title}" (${w.workState ?? "ללא מצב"}${w.daysSinceSent !== null ? `, נשלח לפני ${w.daysSinceSent} ימים` : ""})`),
          evidence: [{ id: `ev:${w.id}:vstate`, label: "מצב העבודה", value: w.workState, display: w.workState ?? "לא ידוע", kind: "status", source: { table: "vendor_project_work", id: w.id, field: "work_state" }, asOf }],
        });
      }

      // Tasks — via tasks.related_id (only the non-overdue ones are context; overdue ones are a signal)
      const linkedOpen = (state.tasks?.items ?? []).filter((t) => t.projectId === pid);
      if (linkedOpen.length > 0) {
        connections.push({ from: entity, to: { type: "company", id: "tasks", name: "משימות" }, via: "tasks.related_id", linkType: "id", asOf });
        const upcoming = linkedOpen.filter((t) => t.daysOverdue !== null && t.daysOverdue <= 0);
        if (upcoming.length > 0) {
          contextFacts.push({
            id: "ctx:tasks:upcoming", title: "משימות פתוחות מקושרות", short: rich(`${upcoming.length} משימות פתוחות מקושרות (לא באיחור)`),
            evidence: [{ id: `ev:${pid}:tasks_open`, label: "משימות פתוחות מקושרות שאינן באיחור", value: upcoming.length, display: String(upcoming.length), kind: "count", source: { table: "tasks", field: "related_id" }, asOf }],
          });
        }
      }

      // Sessions — via sessions.project_id (planned only)
      const sess = (state.sessions ?? []).filter((s) => s.projectId === pid);
      if (sess.length > 0) {
        connections.push({ from: entity, to: { type: "company", id: "sessions", name: "סשנים" }, via: "sessions.project_id", linkType: "id", asOf });
        const s0 = sess[0];
        contextFacts.push({
          id: "ctx:sessions", title: "סשן מתוכנן", short: rich(`סשן מתוכנן ${fullDate(s0.dateYmd)}${s0.start ? ` ${s0.start.slice(0, 5)}` : ""}`),
          evidence: [{ id: `ev:${pid}:session`, label: "סשן מתוכנן הקרוב", value: s0.dateYmd, display: fullDate(s0.dateYmd), kind: "date", source: { table: "sessions", id: s0.id, field: "date" }, asOf }],
        });
      }

      // Release row — via project_release_details.project_id (context when no release signal)
      const rel = state.releases?.rows.find((r) => r.projectId === pid);
      if (rel) {
        connections.push({ from: entity, to: { type: "company", id: "release", name: "ריליס" }, via: "project_release_details.project_id", linkType: "id", asOf });
        covKeys.add("releases");
        if (!sigs.some((s) => s.type === "RELEASE_TARGET_APPROACHING")) {
          contextFacts.push({
            id: "ctx:release", title: "שורת release", short: rich(`שלב ריליס: ${rel.stage}${rel.targetYmd ? `, יעד ${shortDate(rel.targetYmd)}` : ""}`),
            evidence: [{ id: `ev:${pid}:rel`, label: "שלב ריליס", value: rel.stage, display: rel.stage, kind: "status", source: { table: "project_release_details", id: pid, field: "release_stage" }, asOf }],
          });
        }
      } else if (pinfo?.businessType === "לייבל") {
        caseMissing.push("אין שורת release לפרויקט הלייבל — מוכנות ריליס לא ידועה.");
      }

      // finance: null ≠ 0
      const priced = state.receivables?.rows.some((r) => r.projectId === pid);
      const exception = state.receivables?.exceptionIds.includes(pid);
      if (state.receivables && !priced) {
        caseMissing.push(exception ? "הפרויקט מסומן כחריג כספי — אין חישוב יתרה." : "אין מחיר מוסכם לפרויקט — אין מידע על יתרה או גבייה (זה לא 'אפס').");
        covKeys.add("receivables");
      }
      if (pfact && pfact.deadline.ymd === null) caseMissing.push("לפרויקט אין דדליין תקין.");

      // the old project deadline is metadata, not a signal — say so, so the case is not confusing
      const staleText = staleByProject.get(pid);
      if (staleText) {
        contextFacts.push({
          id: "ctx:stale_deadline", title: "דדליין הפרויקט ישן",
          short: rich("דדליין הפרויקט ישן — לא נספר כדחיפות (ראה רשימת הדדליינים הישנים)"),
          evidence: [{ id: `ev:${pid}:stale`, label: "דדליין הפרויקט", value: pfact?.deadline.ymd ?? null, display: staleText, kind: "text", source: { table: "projects", id: pid, field: "deadline" }, asOf, untrusted: true }],
        });
      }
      // live activity (why this project counts as "being worked on now", or that nothing shows it)
      if (pfact) {
        const lv = projectLiveness(state, pfact, cfg);
        contextFacts.push({
          id: "ctx:liveness", title: "פעילות חיה",
          short: rich(lv.live ? `פעילות חיה: ${lv.signs.map((x) => x.text).join(" · ")}` : "אין סימני פעילות חיה בפרויקט"),
          evidence: lv.signs.length > 0 ? lv.signs.map((x) => x.evidence)
            : [{ id: `ev:${pid}:nolive`, label: "סימני פעילות חיה", value: 0, display: "0", kind: "count", source: { table: "projects", id: pid, field: "updated_at" }, asOf }],
        });
      }
    }

    if (entity.type === "team") {
      const list = entity.id === "steven" ? (steven?.open ?? []) : (victor?.active ?? []);
      const linked = list.filter((w) => w.projectId);
      for (const w of linked.slice(0, 10)) {
        connections.push({
          from: entity, to: projectEntity(state, w.projectId as string),
          via: entity.id === "steven" ? "sound_engineer_work.project_id" : "vendor_project_work.project_id", linkType: "id", asOf,
        });
      }
    }

    const tierRes = resolveCaseTier(sigs, cfg);
    const orderedSigs = [...sigs].sort((a, b) => (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1) || b.sort - a.sort);
    const summary: Rich = [];
    orderedSigs.forEach((s, i) => { if (i > 0) summary.push({ t: " · " }); summary.push(...s.short); });
    for (const cf of contextFacts.filter((f) => f.id !== "ctx:liveness").slice(0, 2)) { summary.push({ t: " · " }); summary.push(...cf.short); }

    const missing = Array.from(new Set([...sigs.flatMap((s) => s.missing), ...caseMissing]));
    const coverage = Array.from(covKeys).map((k) => covByKey.get(k)).filter((c): c is CoverageEntry => !!c);

    const reasons: string[] = [];
    let confLevel: "high" | "medium" | "low" = state.sources.some((s) => s.status === "failed") ? "low" : "high";
    if (sigs.some((s) => s.lowCoverage)) { reasons.push("חלק מהסיגנלים נשענים על כיסוי חלקי"); if (confLevel === "high") confLevel = "medium"; }
    const pfact2 = entity.type === "project" ? state.projects?.open.find((p) => p.id === entity.id) : undefined;
    if (pfact2?.daysSinceUpdate !== null && pfact2 && (pfact2.daysSinceUpdate ?? 0) >= cfg.staleProjectDays) { reasons.push(`הפרויקט לא עודכן ${pfact2.daysSinceUpdate} ימים`); if (confLevel === "high") confLevel = "medium"; }
    if (state.sources.some((s) => s.status === "failed")) reasons.push("מקור נתונים אחד לפחות לא היה זמין");
    if (reasons.length === 0) reasons.push("הנתונים שהסיגנלים נשענים עליהם מלאים לישות הזו");

    const maxSort = Math.max(...sigs.map((s) => s.sort));
    cases.push({
      id: `case:${key}`, entity, kind: entity.type, title: entity.name, subtitle,
      tier: tierRes.tier, tierReasons: [...tierRes.reasons, ...sigs.map((s) => `${s.type}: ${s.tierReasons.join("; ")}`)],
      signals: orderedSigs, contextFacts, connections: dedupeConnections(connections), summary, coverage, missing,
      confidence: { level: confLevel, reasons },
      sort: [-Math.min(...sigs.map((s) => s.sortClass)), new Set(sigs.filter((s) => s.role === "primary").map((s) => s.type)).size, maxSort, sigs.length],
    });
  }

  cases.sort(compareCases);
  return { cases, notices };
}

function dedupeConnections(list: Connection[]): Connection[] {
  const seen = new Set<string>();
  return list.filter((c) => { const k = `${c.from.type}:${c.from.id}>${c.to.type}:${c.to.id}:${c.via}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
