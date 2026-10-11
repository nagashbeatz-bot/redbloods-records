/**
 * Sunny CAPABILITY TRUTH (2026-10-11, Owner-approved P0 items 1–3): "סאני, את יכולה לעשות את זה?" has ONE answer.
 *
 *   1. No served capability text claims Sunny cannot do what the action layer executes (limitations, business-action
 *      reasons, calendar model, connector person / model, integrations, known_unknowns, action_registry) — the six
 *      contradictions of the 11.10 report (calendar read, finance actions, tasks / clients / proposals, calendar write,
 *      247 / 447 / 440, finance answers) can not come back silently.
 *   2. ONE source: executable business actions + every domain's actions line are DERIVED from the action registry;
 *      action_registry mode can_i answers with a closed state per match.
 *   3. The REAL connector adds its live state to can_i: switches, this token's permissions, and verification from
 *      Sunny's own execution history (VERIFIED / CONFIGURED_NOT_VERIFIED) — names / booleans only, never a secret.
 * No network, no DB. Run with:   npx tsx scripts/test-sunny-capability-truth.tsx
 */
import fs from "node:fs";
import path from "node:path";
import { systemAwareness } from "../lib/partner/knowledge/capabilities/system";
import { integrations } from "../lib/partner/knowledge/capabilities/operations";
import { knownUnknowns } from "../lib/partner/knowledge/capabilities/partner";
import { actionRegistryCap } from "../lib/partner/knowledge/capabilities/act";
import { BUSINESS_ACTIONS, DOMAIN_CONTRACTS } from "../lib/partner/system";
import { CALENDAR_CONTEXT_CONTRACT } from "../lib/partner/system/calendar";
import { USER_CONTRACTS } from "../lib/partner/system/people";
import { SUNNY_CONNECTOR_MODEL } from "../lib/partner/system/platform-domains";
import { BUSINESS_ACTION_PRIMITIVES } from "../lib/partner/act/coverage-map";
import { ALL_PRIMITIVES } from "../lib/partner/act/primitives";
import { ACTION_CONTRACTS } from "../lib/partner/act/registry";
import { bossCanSunnyCannot } from "../lib/partner/act/coverage";
import { actionCountsHe, applyCapabilityRuntime, baseStateOf, canI, canIExecutableIds, CAPABILITY_STATE_HE, domainActionsLineHe, executableByDomain, servedStatesOf, type CapabilityRuntime } from "../lib/partner/system/capability-truth";
import { detectFutureScheduleGap } from "../lib/partner/integrity/detectors";
import { handleMcpHttp, SERVER_INSTRUCTIONS, type McpDeps, type McpGateway } from "../lib/integrations/partner-mcp/mcp";
import { readMcpConfig } from "../lib/integrations/partner-mcp/config";
import { SlidingWindowLimiter } from "../lib/integrations/partner-mcp/rate-limit";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { queryKnowledgeCore } from "../lib/partner/knowledge/query";
import { ACTION_HISTORY_REQUEST, actionHistoryItemsOf, deriveWithActionHistory, historyDerivationFor } from "../lib/partner/sunny/with-history";
import { handleInternalAct } from "../lib/partner/act/internal-handler";
import { INTERNAL_AUTH_HEADER } from "../lib/partner/calendar/internal-auth";
import type { ActServiceDeps } from "../lib/partner/act/service";
import type { Plan } from "../lib/partner/act/types";
import type { GatewaySources } from "../lib/partner/gateway/core";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 700)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
type Item = { id: string; label: { text: string }; fields: Record<string, unknown> };
const items = (r: unknown) => ((r as { items?: Item[] }).items ?? []);
const sa = (mode: string, params: Record<string, string> = {}) => systemAwareness.read({} as GatewaySources, { mode, params });
const ar = (mode: string, params: Record<string, string> = {}) => actionRegistryCap.read({} as GatewaySources, { mode, params });

// ── the guard: a NEGATIVE execution claim (Hebrew + English) ───────────────────────────────────────────────────
/** A sentence that says Sunny does not create / write / change … — allowed ONLY when it is qualified as typed /
 *  approval-bound / "by herself" / free text / scheduled (a true limit), never as a blanket "cannot". */
const NEG_HE = /סאני (לא|אינה|אינו) (יוצר|יוצרת|כותב|כותבת|עורך|עורכת|משנה|ממיר|ממירה|משייך|משייכת|שולח|שולחת|מוחק|מוחקת|סוגר|סוגרת|מבצע|מבצעת)/;
const QUALIFIED_HE = /(מוקלדת|בעצמה|בעצמו|חופשית|מתוזמנ|רק כפעולה|אחרי אישורך|אף פעם לא דרך סאני \(גבול אבטחה\))/;
const STALE_HE = /(פעולות עתידיות|פרימיטיב(ים)? עתידי|רק בלוח הבקרה|זה נעשה בלוח הבקרה|ביצוע פעולות כספים דרך סאני כבוי|לא קורא ולא כותב ליומן|סאני לא כותב ליומן|רק אירועים|לא אירועים אחרים ביומן)/;
const negativeClaims = (texts: readonly string[]) => texts.filter((t) => STALE_HE.test(t) || (NEG_HE.test(t) && !QUALIFIED_HE.test(t)));
const STALE_EN = /(not executable today|executable only from the dashboard|dashboard only|finance execution via mcp is off|no finance execution|no calendar write|future primitive|blocked: requires)/i;

async function main() {
  section("1. No served capability text contradicts the action layer (the six contradictions of 11.10)");
  const allLimits = DOMAIN_CONTRACTS.flatMap((d) => d.limitationsHe.map((l) => `${d.id}: ${l}`));
  ok("1a. no limitation claims a blanket 'Sunny does not create / write / change …' or an old 'future / dashboard-only / off' state", negativeClaims(allLimits).length === 0, negativeClaims(allLimits));
  ok("1b. the guard itself catches the old texts (calendar write, finance off, tasks, clients, dashboard)", ["סאני לא כותב ליומן: יצירה / עדכון", "ביצוע פעולות כספים דרך סאני כבוי;", "סאני לא יוצר/סוגר משימות.", "סאני לא יוצר / עורך / מוחק לקוחות", "סאני לא ממיר הצעה לפרויקט ולא משנה סטטוס — זה נעשה בלוח הבקרה", "סאני לא משנה שלב ריליס.", "סאני רואה סשנים שב-Redbloods בלבד — לא אירועים אחרים ביומן Google."].every((t) => negativeClaims([t]).length === 1));
  const execReasons = BUSINESS_ACTIONS.filter((a) => a.sunnyCanExecuteToday);
  ok("1c. every executable business action's reason is the derived one (never 'not executable / dashboard / off / future')", execReasons.every((a) => !STALE_EN.test(a.reason) && a.reason.startsWith("Executable through Sunny in Claude")), execReasons.filter((a) => STALE_EN.test(a.reason)).map((a) => a.id));
  ok("1d. executable business actions = exactly the business-action → primitive map (ONE source)", BUSINESS_ACTIONS.every((a) => a.sunnyCanExecuteToday === Object.prototype.hasOwnProperty.call(BUSINESS_ACTION_PRIMITIVES, a.id)));
  const primIds = new Set(ALL_PRIMITIVES.map((p) => p.actionId));
  ok("1e. every primitive the business map names exists (no executable claim without an executor)", Object.values(BUSINESS_ACTION_PRIMITIVES).flat().every((id) => primIds.has(id)), Object.values(BUSINESS_ACTION_PRIMITIVES).flat().filter((id) => !primIds.has(id)));
  ok("1f. the four actions the code executed but the map called 'not executable' are executable now (delete project, send report, social, Dropbox files)", ["DELETE_PROJECT", "SEND_REPORT", "SOCIAL_WRITE", "DROPBOX_WRITE"].every((id) => BUSINESS_ACTIONS.find((a) => a.id === id)?.sunnyCanExecuteToday === true));
  ok("1g. a generic push and auth / roles stay non-executable (never a generic sender, never security)", BUSINESS_ACTIONS.find((a) => a.id === "SEND_PUSH")?.sunnyCanExecuteToday === false && BUSINESS_ACTIONS.find((a) => a.id === "SETTINGS_AUTH_PEOPLE")?.sunnyCanExecuteToday === false);
  const cal = CALENDAR_CONTEXT_CONTRACT as unknown as { writeCapabilities: string[]; writesToday: string; futureWriteCapabilities?: unknown };
  ok("1h. calendar model: write capabilities are DERIVED primitives (no 'future' list) and writesToday is not 'none'", cal.writeCapabilities.length >= 6 && cal.writeCapabilities.every((id) => primIds.has(id)) && !/^none/i.test(cal.writesToday) && cal.futureWriteCapabilities === undefined, cal);
  const conn = USER_CONTRACTS.find((u) => u.id === "CLAUDE_CONNECTOR")!;
  ok("1i. the connector person: no 'no calendar write / no finance execution / no business mutation' blanket claim; scopes include act", !STALE_EN.test(conn.cannot.join(" ")) && !/No business mutation/.test(conn.cannot.join(" ")) && /act/.test(conn.authMethod), conn.cannot);
  ok("1j. the connector model: finance answers are refused ONLY while the finance-answer switch is off (never unconditional)", SUNNY_CONNECTOR_MODEL.notAvailable.some((x) => /while the extra finance-answer switch is off/.test(x)) && !(SUNNY_CONNECTOR_MODEL.notAvailable as readonly string[]).includes("finance answers from Claude (refused)"));
  ok("1k. known_unknowns no longer tells Claude 'Google Calendar is not read' (it is in the partner_query tool description)", !/Google Calendar is not read/.test(knownUnknowns.descriptionForModel));
  ok("1l. action_registry: no hard-coded 'Wave 1: 13' and no 'repeat the exact values' (one 'מאשר' is enough — Owner decision 2026-09-27)", !/13 internal reversible/.test(actionRegistryCap.descriptionForModel) && !items(actionRegistryCap.read({} as GatewaySources, { mode: "overview", params: {} })).some((i) => /רק כשחזרת על הערכים/.test(JSON.stringify(i))) && !JSON.stringify(actionRegistryCap.read({} as GatewaySources, { mode: "overview", params: {} })).includes("רק כשחזרת על הערכים"));
  const actionInv = JSON.stringify(sa("action_inventory"));
  ok("1m. action_inventory no longer says 'Sunny executes none of them except a dashboard deadline'", !/לא מבצע אף אחת מהן כרגע/.test(actionInv));
  ok("1n. served texts that mention the calendar never say it is not read (label shows / entity session / integrity)", !/Partner does not read the calendar/.test(read("lib/partner/knowledge/capabilities/label.ts")) && !/Partner does not read the calendar/.test(read("lib/partner/gateway/entity.ts")) && !/not approved yet — not read/.test(read("lib/partner/integrity/detectors.ts")));
  const gap = detectFutureScheduleGap({ state: null, todayIL: "2026-10-11" } as never)[0];
  ok("1o. the integrity table check still reports the coverage note, but its evidence says Sunny reads the live calendar", !!gap && JSON.stringify(gap.evidence).includes("read live by Sunny through capability calendar"), gap?.evidence);

  section("2. integrations: the calendar entry is the RESULT of a live read (never a hard-coded false)");
  const ops = { status: "OK", value: { integrations: { googleCalendarConnected: true, dropboxConnected: true } } };
  const calOk = { status: "OK", value: { status: "CALENDAR_DATA_AVAILABLE", events: [], reasons: [], window: { start: "", end: "" } } };
  const calBad = { status: "OK", value: { status: "CALENDAR_NEEDS_REAUTH", events: [], reasons: ["rejected"], window: { start: "", end: "" } } };
  const igOk = items(integrations.read({ operations: ops, calendar: calOk } as unknown as GatewaySources, { mode: "current", params: {} }))[0];
  const igBad = items(integrations.read({ operations: ops, calendar: calBad } as unknown as GatewaySources, { mode: "current", params: {} }))[0];
  const igNone = items(integrations.read({ operations: ops } as unknown as GatewaySources, { mode: "current", params: {} }))[0];
  ok("2a. live read worked → sunnyCanRead true, writes = typed actions after approval", igOk.fields.sunnyCanRead === true && igOk.fields.readStatus === "CALENDAR_DATA_AVAILABLE" && igOk.fields.sunnyCanWrite === "TYPED_ACTIONS_AFTER_APPROVAL", igOk.fields);
  ok("2b. live read failed → false + the status, and the note says it is NOT an empty calendar", igBad.fields.sunnyCanRead === false && igBad.fields.readStatus === "CALENDAR_NEEDS_REAUTH" && /זה לא יומן ריק/.test(String((igBad.fields.note as { text: string }).text)));
  ok("2c. calendar not loaded at all → null (unknown), never false", igNone.fields.sunnyCanRead === null && igNone.fields.readStatus === "NOT_READ_NOW");
  ok("2d. the calendar is an OPTIONAL source of integrations (its failure never hides the connection state)", (integrations.optionalNeeds ?? []).includes("CALENDAR") && integrations.needs.includes("OPERATIONS"));
  const dbx = items(integrations.read({ operations: ops } as unknown as GatewaySources, { mode: "current", params: {} }))[1];
  ok("2f. Dropbox: contents never read, but file writes are typed actions after approval (never a blanket false)", dbx.fields.sunnyCanReadContents === false && dbx.fields.sunnyCanWrite === "TYPED_ACTIONS_AFTER_APPROVAL");
  ok("2e. no integrations note says 'Sunny does not read and does not write the calendar'", ![igOk, igBad, igNone].some((i) => /לא קורא ולא כותב/.test(JSON.stringify(i))));

  section("3. ONE source: each domain's actions line and served states are derived from the action registry");
  const byDom = executableByDomain();
  const lim = items(sa("limitations"));
  ok("3a. limitations: every domain starts with its derived actions line", DOMAIN_CONTRACTS.every((d) => lim.some((i) => i.id === `${d.id}:actions` && i.label.text === domainActionsLineHe(d.id))));
  ok("3b. the line counts exactly the domain's registered primitives", DOMAIN_CONTRACTS.every((d) => (lim.find((i) => i.id === `${d.id}:actions`)!.fields.executableActions as number) === (byDom[d.id] ?? []).length));
  ok("3c. every primitive is counted in exactly one domain (no primitive left out of the lines)", Object.values(byDom).flat().length === ALL_PRIMITIVES.length, { counted: Object.values(byDom).flat().length, primitives: ALL_PRIMITIVES.length });
  ok("3d. a domain with executable actions is never served READ_ONLY (TASKS / SESSIONS / SHOWS …)", DOMAIN_CONTRACTS.filter((d) => (byDom[d.id] ?? []).length).every((d) => !servedStatesOf(d).includes("READ_ONLY") && servedStatesOf(d).includes("OWNER_APPROVAL_REQUIRED")));
  ok("3e. overview / coverage serve the derived states + the executable count", items(sa("overview")).every((i) => !((i.fields.executableActions as number) > 0 && (i.fields.states as string[]).includes("READ_ONLY"))));
  ok("3f. a domain with no primitive says so (read only) — never a list it does not have", DOMAIN_CONTRACTS.filter((d) => !(byDom[d.id] ?? []).length).every((d) => /אין לסאני פעולה מוקלדת/.test(domainActionsLineHe(d.id))));
  const counts = actionCountsHe(), g = bossCanSunnyCannot();
  ok("3g. the counts line names what each number counts (440 of 449 Boss operations through Claude; 247 typed primitives) — all computed", counts.sunnyExecutableViaClaude === g.sunnyExecutableViaClaude && counts.bossActions === g.bossActions && counts.primitives === ALL_PRIMITIVES.length && counts.countsHe.includes(`${g.sunnyExecutableViaClaude} מתוך ${g.bossActions}`) && counts.countsHe.includes(`${ALL_PRIMITIVES.length} מהן`), counts);
  ok("3h. no hard-coded action count left in the served texts (247 / 440 / 447 / 13 appear only as computed values)", !/\b(247|440|447)\b/.test(code(read("lib/partner/system/registry.ts"))) && !/Wave 1 — 13/.test(read("lib/partner/act/matrix.ts")));

  section("4. can_i — one closed state per match");
  const st = (q: string) => canI({ q }).items.map((i) => `${i.id}:${i.state}`);
  ok("4a. 'ליצור הופעה' → CREATE_SHOW EXECUTABLE_AFTER_APPROVAL", st("ליצור הופעה").includes("CREATE_SHOW:EXECUTABLE_AFTER_APPROVAL"), st("ליצור הופעה"));
  ok("4b. 'כתיבה ליומן' → the calendar write primitives (executable) + calendar READ", ["CREATE_CALENDAR_EVENT", "UPDATE_CALENDAR_EVENT", "DELETE_CALENDAR_EVENT"].every((id) => st("כתיבה ליומן").includes(`${id}:EXECUTABLE_AFTER_APPROVAL`)) && st("כתיבה ליומן").includes("READ:GOOGLE_CALENDAR:READ"), st("כתיבה ליומן"));
  ok("4c. 'לרשום הוצאה' → ADD_TRANSACTION executable (finance actions are not 'off')", st("לרשום הוצאה").includes("ADD_TRANSACTION:EXECUTABLE_AFTER_APPROVAL"), st("לרשום הוצאה"));
  ok("4d. 'ליצור לקוח' / 'משימה' → CREATE_CLIENT / CREATE_TASK executable", st("ליצור לקוח").includes("CREATE_CLIENT:EXECUTABLE_AFTER_APPROVAL") && st("משימה").includes("CREATE_TASK:EXECUTABLE_AFTER_APPROVAL"));
  ok("4e. 'לחבר יומן גוגל' → CALENDAR.CONNECT PREPARE_ONLY (Google OAuth — only the Boss signs in)", st("לחבר יומן גוגל").includes("CALENDAR.CONNECT:PREPARE_ONLY"), st("לחבר יומן גוגל"));
  ok("4f. nonsense → no match → NOT_REGISTERED in missing[] (not found ≠ impossible), never an invented state", canI({ q: "dance with unicorns" }).matched === false && (ar("can_i", { q: "dance with unicorns" }) as { completeness: string; missing: Array<{ whyNeeded: string }> }).missing[0].whyNeeded.startsWith(CAPABILITY_STATE_HE.NOT_REGISTERED));
  ok("4g. a single stray word never makes a match (half of the words must hit)", canI({ q: "with" }).matched === false && canI({ q: "the and of" }).matched === false);
  ok("4h. exact action id → exactly that contract", canI({ action: "CLOSE_SHOW" }).items.length === 1 && canI({ action: "CLOSE_SHOW" }).items[0].state === "EXECUTABLE_AFTER_APPROVAL" && canI({ action: "NOPE_ACTION" }).matched === false);
  const byDetail = (d: string) => ACTION_CONTRACTS.find((c) => c.availabilityDetail === d);
  const sec = ACTION_CONTRACTS.filter((c) => c.availabilityDetail === "SECURITY_EXCLUDED");
  ok("4i. a security exclusion → BLOCKED_PERMISSION, or PREPARE_ONLY when only the Boss can do it himself (OAuth / device)", sec.length > 0 && sec.every((c) => ["BLOCKED_PERMISSION", "PREPARE_ONLY"].includes(baseStateOf(c).state)));
  const np = byDetail("NEEDS_PRIMITIVE"), oup = byDetail("OTHER_USER_PORTAL_ONLY"), sys = byDetail("SYSTEM_AUTOMATIC");
  ok("4j. a missing primitive → BLOCKED_TECHNICAL; another person's own act → BLOCKED_PERMISSION; machinery → SYSTEM_AUTOMATIC", (!np || baseStateOf(np).state === "BLOCKED_TECHNICAL") && (!oup || baseStateOf(oup).state === "BLOCKED_PERMISSION") && (!sys || baseStateOf(sys).state === "SYSTEM_AUTOMATIC"));
  ok("4k. every executable contract answers EXECUTABLE_AFTER_APPROVAL (440 — the same count as the gap report)", ACTION_CONTRACTS.filter((c) => baseStateOf(c).state === "EXECUTABLE_AFTER_APPROVAL").length === g.sunnyExecutableViaClaude);
  const sum = ar("can_i") as { items: Item[]; coverage: Array<{ text: string }> };
  ok("4l. can_i without params = every domain + its actions line + the counts line", sum.items.length === DOMAIN_CONTRACTS.length && sum.items.every((i) => typeof i.fields.actionsLineHe === "string") && sum.coverage.some((c) => c.text === counts.countsHe));
  ok("4m. action_registry answers 'can you do X?' FIRST (mode can_i, q / ref) and system_awareness points there", actionRegistryCap.descriptionForModel.startsWith("FIRST for ONE 'can you do X?': mode can_i") && !!actionRegistryCap.modes.can_i && !!actionRegistryCap.params.q && systemAwareness.descriptionForModel.includes("action_registry mode can_i"));
  ok("4n. both descriptions stay within the registry limits (≤ 900 chars, ≤ 6 params)", actionRegistryCap.descriptionForModel.length <= 900 && systemAwareness.descriptionForModel.length <= 900 && Object.keys(actionRegistryCap.params).length <= 6 && Object.keys(systemAwareness.params).length <= 6);

  section("5. The connector's LIVE state (pure application)");
  const base = ar("can_i", { q: "ליצור הופעה" }) as unknown as Record<string, unknown>;
  const ids = canIExecutableIds(base);
  const RT = (o: Partial<CapabilityRuntime> = {}): CapabilityRuntime => ({ switches: { act: true, answer: true, financeAnswers: true, knowledge: true, observe: false, ownerDecide: false }, scopes: { act: true, answer: true, knowledge: true, observe: false }, executions: Object.fromEntries(ids.map((id) => [id, null])), ...o });
  const stOf = (p: Record<string, unknown>, id: string) => items(p).find((i) => i.id === id)!.fields;
  ok("5a. executable ids are the matched executable actions only (≤ 8)", ids.includes("CREATE_SHOW") && ids.length <= 8);
  ok("5b. act switch off → BLOCKED_PERMISSION ('nothing can be executed from Claude right now')", stOf(applyCapabilityRuntime(base, RT({ switches: { ...RT().switches, act: false } })), "CREATE_SHOW").state === "BLOCKED_PERMISSION");
  ok("5c. the token lacks partner:act → BLOCKED_PERMISSION with the reconnect reason", (() => { const f = stOf(applyCapabilityRuntime(base, RT({ scopes: { ...RT().scopes, act: false } })), "CREATE_SHOW"); return f.state === "BLOCKED_PERMISSION" && /partner:act/.test(String(f.whyEn)); })());
  ok("5d. never executed through Sunny → CONFIGURED_NOT_VERIFIED / NEVER_EXECUTED", (() => { const f = stOf(applyCapabilityRuntime(base, RT()), "CREATE_SHOW"); return f.state === "CONFIGURED_NOT_VERIFIED" && f.verification === "NEVER_EXECUTED"; })());
  ok("5e. executed → EXECUTABLE_AFTER_APPROVAL / VERIFIED with the date", (() => { const f = stOf(applyCapabilityRuntime(base, RT({ executions: { CREATE_SHOW: "2026-10-03T15:59:22Z" } })), "CREATE_SHOW"); return f.state === "EXECUTABLE_AFTER_APPROVAL" && f.verification === "VERIFIED" && f.verifiedAt === "2026-10-03T15:59:22Z"; })());
  ok("5f. history not readable → state kept, verification NOT_CHECKED_HERE (never 'verified', never 'never')", (() => { const f = stOf(applyCapabilityRuntime(base, RT({ executions: null })), "CREATE_SHOW"); return f.state === "EXECUTABLE_AFTER_APPROVAL" && f.verification === "NOT_CHECKED_HERE"; })());
  const rtSummary = JSON.stringify((applyCapabilityRuntime(base, RT()) as { runtime: unknown }).runtime);
  ok("5g. the runtime summary carries switch NAMES + granted scopes only — no env name, no secret, no value", !/PARTNER_|SECRET|TOKEN|https?:/i.test(rtSummary) && rtSummary.includes("partner:act"), rtSummary);
  ok("5h. a non-executable / read item is never changed by the runtime", (() => { const p = ar("can_i", { q: "לחבר יומן גוגל" }) as unknown as Record<string, unknown>; const f = stOf(applyCapabilityRuntime(p, RT({ switches: { ...RT().switches, act: false } })), "CALENDAR.CONNECT"); return f.state === "PREPARE_ONLY"; })());

  section("6. The REAL connector path (handleMcpHttp → the real internal act gate → the real action service history)");
  const OWNER_ID = "owner-user-1", SECRET = "s".repeat(40), NOW = Date.parse("2026-10-11T12:00:00Z");
  const MAIN_ENV = { PARTNER_ACT_ENABLED: "true", PARTNER_INTERNAL_ACT_SECRET: SECRET };
  const CONNECTOR_ENV = { PARTNER_MCP_ENABLED: "true", PARTNER_MCP_BASE_URL: "https://c.example", PARTNER_MCP_SECRET: "m".repeat(64), REDBLOODS_MCP_ONLY: "true", PARTNER_MCP_KNOWLEDGE_ENABLED: "true", PARTNER_MCP_ACT_ENABLED: "true", PARTNER_MAIN_BASE_URL: "https://main.example", PARTNER_INTERNAL_ACT_SECRET: SECRET };
  const plan = { planId: "pl_" + "d".repeat(18), ownerId: OWNER_ID, clientId: "client-1", intentHe: "דדליין", steps: [{ index: 0, actionId: "UPDATE_PROJECT_DEADLINE", actionVersion: 1, args: {}, entities: ["project:x"], phase: "W1", expectedFingerprint: "f".repeat(64), changes: [], dependsOn: [] }], riskClass: "LOW", confirmation: "OWNER_APPROVAL", effects: [], createdAt: "2026-10-05T11:00:00Z", expiresAt: "2026-10-06T11:00:00Z" } as unknown as Plan;
  const historyQueries: unknown[] = [];
  const actDeps = (): ActServiceDeps => ({
    nowMs: () => NOW, isOwner: async (u: string) => u === OWNER_ID,
    stores: { plans: { history: async (_o: string, q: { actionId?: string | null }) => { historyQueries.push(q); return { items: !q.actionId || q.actionId === "UPDATE_PROJECT_DEADLINE" ? [{ plan, executions: [{ stepIndex: 0, status: "APPLIED_AS_EXPECTED", outcome: { index: 0, actionId: "UPDATE_PROJECT_DEADLINE", status: "APPLIED_AS_EXPECTED", detail: "ok", replayed: false, at: "2026-10-05T12:00:00Z" } }], eventTypes: ["APPROVED"], executedAt: "2026-10-05T12:00:00Z", approvalDetail: "OWNER_APPROVAL" }] : [], nextBefore: null }; } } },
  } as unknown as ActServiceDeps);
  const connector = (o: { act?: boolean; scope?: string; wired?: boolean } = {}): McpDeps => {
    const cfg = readMcpConfig(o.act === false ? { ...CONNECTOR_ENV, PARTNER_MCP_ACT_ENABLED: "false" } : CONNECTOR_ENV);
    if (!cfg.ok) throw new Error("connector config");
    const gateway: McpGateway = {
      brief: async () => ({}), resolve: async () => ({}), entity: async () => ({}),
      query: async (a) => queryKnowledgeCore(PARTNER_KNOWLEDGE_REGISTRY, a, { now: new Date(NOW) } as GatewaySources, { channel: "EXTERNAL", ownerAuthorized: true }) as unknown as Record<string, unknown>,
      capabilityIndex: () => [], withActionHistory: (k, p, h, n) => deriveWithActionHistory(k, p, h, n), historyDerivationFor, actionHistoryRequest: ACTION_HISTORY_REQUEST, actionHistoryItemsOf,
      ...(o.wired === false ? {} : { withCapabilityRuntime: applyCapabilityRuntime, capabilityRuntimeIds: canIExecutableIds }),
    };
    return {
      config: { ...cfg.config, maxResultChars: 1_000_000 }, authenticate: async () => ({ ok: true, principal: { tokenId: "t1", clientId: "client-1", userId: OWNER_ID, scope: o.scope ?? "partner:read partner:knowledge partner:act" } }),
      gateway, limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), audit: async () => undefined, auditRejected: async () => undefined, nowMs: () => NOW,
      ...(o.act === false ? {} : { act: { limiter: new SlidingWindowLimiter([{ windowMs: 60_000, max: 1000 }]), call: async (op: string, input: Record<string, unknown>, caller: { userId: string; clientId: string }) =>
        (await handleInternalAct({ header: (n) => (n === INTERNAL_AUTH_HEADER ? SECRET : null), bodyText: async () => JSON.stringify({ op, ownerId: caller.userId, clientId: caller.clientId, input }) }, MAIN_ENV, async () => actDeps())).body as Record<string, unknown> } }),
    } as McpDeps;
  };
  const chat = async (deps: McpDeps, params: Record<string, string>, mode = "can_i", capability = "action_registry") => {
    const out = await handleMcpHttp({ method: "POST", header: (n) => (n === "authorization" ? "Bearer x" : null), bodyText: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "partner_query", arguments: { capability, mode, params } } }) }, deps);
    return (JSON.parse(out.body ?? "{}").result?.structuredContent ?? {}) as Record<string, unknown>;
  };
  const verified = await chat(connector(), { ref: "UPDATE_PROJECT_DEADLINE" });
  ok("6a. an action Sunny executed → VERIFIED through the real history op (per-action filter)", stOf(verified, "UPDATE_PROJECT_DEADLINE").verification === "VERIFIED" && stOf(verified, "UPDATE_PROJECT_DEADLINE").verifiedAt === "2026-10-05T12:00:00Z" && historyQueries.some((q) => (q as { actionId?: string }).actionId === "UPDATE_PROJECT_DEADLINE"), stOf(verified, "UPDATE_PROJECT_DEADLINE"));
  const never = await chat(connector(), { ref: "CREATE_SHOW" });
  ok("6b. an executable action never executed → CONFIGURED_NOT_VERIFIED", stOf(never, "CREATE_SHOW").state === "CONFIGURED_NOT_VERIFIED");
  ok("6c. the runtime summary is attached (switches + granted scopes, history READ)", (never.runtime as { executionHistory: string; scopesGranted: string[] }).executionHistory === "READ" && (never.runtime as { scopesGranted: string[] }).scopesGranted.includes("partner:act"));
  const noScope = await chat(connector({ scope: "partner:read partner:knowledge" }), { ref: "CREATE_SHOW" });
  ok("6d. a token without partner:act → BLOCKED_PERMISSION (and no history is read for it)", stOf(noScope, "CREATE_SHOW").state === "BLOCKED_PERMISSION" && (noScope.runtime as { executionHistory: string }).executionHistory === "NOT_READABLE");
  const off = await chat(connector({ act: false }), { ref: "CREATE_SHOW" });
  ok("6e. the act switch off on this connector → BLOCKED_PERMISSION", stOf(off, "CREATE_SHOW").state === "BLOCKED_PERMISSION");
  const lims = await chat(connector(), {}, "limitations", "system_awareness");
  ok("6f. the runtime is applied ONLY to can_i (limitations are served untouched)", lims.runtime === undefined && items(lims).some((i) => i.id === "GOOGLE_CALENDAR:actions"));
  const unwired = await chat(connector({ wired: false }), { ref: "CREATE_SHOW" });
  ok("6g. a gateway without the runtime transform → the code-level state (never invented)", stOf(unwired, "CREATE_SHOW").state === "EXECUTABLE_AFTER_APPROVAL" && unwired.runtime === undefined);

  section("7. Wiring + instructions + contract");
  const mcp = code(read("lib/integrations/partner-mcp/mcp.ts")), server = code(read("lib/integrations/partner-mcp/server.ts"));
  ok("7a. the connector applies the runtime only for action_registry can_i, through the Gateway's pure transform", mcp.includes('a.capability === "action_registry" && a.mode === "can_i"') && /deps\.gateway\.withCapabilityRuntime\(payload, await capabilityRuntime\(payload, p, deps\)\)/.test(mcp));
  ok("7b. server.ts wires the SAME pure functions (applyCapabilityRuntime / canIExecutableIds)", server.includes("withCapabilityRuntime: applyCapabilityRuntime, capabilityRuntimeIds: canIExecutableIds") && server.includes('applyCapabilityRuntime, canIExecutableIds } = await import("@/lib/partner/gateway/server")'));
  ok("7c. the runtime reads only booleans from the config (no secret / URL / env value)", (() => { const fn = mcp.slice(mcp.indexOf("async function capabilityRuntime"), mcp.indexOf("async function actionHistory")); return fn.length > 0 && !/secret|baseUrl|process\.env|mainBaseUrl/i.test(fn); })());
  ok("7d. SERVER_INSTRUCTIONS send 'can you do X?' to action_registry can_i and list its states", SERVER_INSTRUCTIONS.includes('"Can you do X?" → FIRST partner_query capability "action_registry" mode can_i') && SERVER_INSTRUCTIONS.includes("CONFIGURED_NOT_VERIFIED") && SERVER_INSTRUCTIONS.includes("NOT_REGISTERED (not found ≠ impossible)"));
  ok("7e. SERVER_INSTRUCTIONS no longer open with 'Everything is read-only'", !/Everything is read-only, except/.test(SERVER_INSTRUCTIONS));
  ok("7f. AGENTS.md carries the capability-truth contract", /Sunny Awareness Check: capability truth/.test(read("AGENTS.md")) && /test-sunny-capability-truth/.test(read("AGENTS.md")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
