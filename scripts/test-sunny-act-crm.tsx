/**
 * Universal Action Layer — Clients / proposals / meetings / tasks / calendar family: every primitive through the REAL
 * service on fakes (6 standard checks each) + family-specific checks (required values for deletes / money / invites,
 * duplicate refusal, conversion guard, shared writers in the routes, hardened writers, vocabularies pinned).
 * Run with:   npx tsx scripts/test-sunny-act-crm.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { CRM_PRIMITIVES, TASK_RELATED_VALUES, TASK_STATUS_VALUES } from "../lib/partner/act/primitives/crm";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Cl = { name: string; phone: string; email: string; type: string; status: string; notes: string };
type Pr = { clientId: string | null; clientName: string; title: string; amount: number; currency: string; status: string; sentDate: string | null; followupDate: string | null; notes: string; linkedProjectId: string | null };
type Me = { clientId: string | null; clientName: string; projectId: string | null; date: string | null; time: string | null; duration: number; location: string; notes: string; status: string; hasCalendarEvent: boolean };
type Ta = { title: string; notes: string | null; status: string; relatedType: string; relatedId: string | null; dueDate: string | null; startTime: string | null; endTime: string | null; mirrored: boolean };
type Ev = { summary: string; start: string; end: string; location: string; description: string; attendeeCount: number };
interface W { clients: Record<string, Cl>; proposals: Record<string, Pr>; meetings: Record<string, Me>; tasks: Record<string, Ta>; events: Record<string, Ev>; gtasks: string[]; gstore: Record<string, { title: string; due: string | null; status: string }>; projects: string[]; artistsText: Record<string, string>; connected: boolean; synced: number }
const EV = "abcdef1234567890";
const world = (): W => ({
  clients: { [U(1)]: { name: "שליו", phone: "050", email: "a@b.co", type: "אמן", status: "פעיל", notes: "" } },
  proposals: { [U(10)]: { clientId: U(1), clientName: "שליו", title: "אלבום", amount: 5000, currency: "₪", status: "ממתין לתשובה", sentDate: null, followupDate: null, notes: "", linkedProjectId: null } },
  meetings: { [U(20)]: { clientId: U(1), clientName: "שליו", projectId: null, date: "2026-10-01", time: "12:00", duration: 60, location: "סטודיו", notes: "", status: "נקבעה", hasCalendarEvent: true } },
  tasks: { [U(30)]: { title: "להתקשר", notes: null, status: "פתוח", relatedType: "client", relatedId: U(1), dueDate: "2026-10-02", startTime: null, endTime: null, mirrored: true } },
  events: { [EV]: { summary: "חזרה", start: "2026-10-03T10:00", end: "2026-10-03T12:00", location: "", description: "", attendeeCount: 0 } },
  gtasks: [], gstore: { GTASK1abc: { title: "לבדוק מיקס", due: "2026-10-01", status: "needsAction" }, GLINKED99: { title: "להתקשר", due: "2026-10-02", status: "needsAction" } }, projects: [U(40)], artistsText: { [U(40)]: "שליו" }, connected: true, synced: 0,
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const writers = {
    async readClient(id: string) { return w.clients[id] ? { ...w.clients[id] } : null; },
    async countClientsNamed(name: string) { return Object.values(w.clients).filter((c) => c.name === name).length; },
    async countClientLinks(id: string) { return { projects: Object.values(w.artistsText).filter((a) => a === w.clients[id]?.name).length, proposals: Object.values(w.proposals).filter((p) => p.clientId === id).length, meetings: Object.values(w.meetings).filter((m) => m.clientId === id).length, tasks: Object.values(w.tasks).filter((t) => t.relatedId === id).length }; },
    async projectsNamingArtist(name: string) { return Object.values(w.artistsText).filter((a) => a === name).length; },
    async createClient(c: Cl) { calls.push("createClient"); const id = U(++n); w.clients[id] = c; return id; },
    async patchClient(id: string, p: Partial<Cl>) { calls.push("patchClient"); const old = w.clients[id].name; w.clients[id] = { ...w.clients[id], ...p }; if (p.name) for (const k of Object.keys(w.artistsText)) if (w.artistsText[k] === old) w.artistsText[k] = p.name; },
    async deleteClient(id: string) { calls.push("deleteClient"); for (const k of Object.keys(w.proposals)) if (w.proposals[k].clientId === id) delete w.proposals[k]; delete w.clients[id]; },
    async readProposal(id: string) { return w.proposals[id] ? { ...w.proposals[id] } : null; },
    async createProposal(p: { clientId: string; title: string; amount?: number; currency?: string; status?: string; followupDate?: string | null; notes?: string }) { calls.push("createProposal"); const id = U(++n); w.proposals[id] = { clientId: p.clientId, clientName: w.clients[p.clientId].name, title: p.title, amount: p.amount ?? 0, currency: p.currency ?? "₪", status: p.status ?? "ממתין לתשובה", sentDate: null, followupDate: p.followupDate ?? null, notes: p.notes ?? "", linkedProjectId: null }; return id; },
    async updateProposal(id: string, patch: Record<string, unknown>) { calls.push("updateProposal"); Object.assign(w.proposals[id], patch); },
    async deleteProposal(id: string) { calls.push("deleteProposal"); delete w.proposals[id]; },
    async convertProposal(id: string) { calls.push("convertProposal"); const pid = U(++n); w.projects.push(pid); w.proposals[id].status = "נסגר"; w.proposals[id].linkedProjectId = pid; return { status: "ok", projectId: pid }; },
    async projectExists(id: string) { return w.projects.includes(id); },
    async readMeeting(id: string) { return w.meetings[id] ? { ...w.meetings[id] } : null; },
    async createMeeting(m: { clientId: string; date?: string | null; time?: string | null; duration?: number; addToCalendar?: boolean }) { calls.push("createMeeting"); const id = U(++n); w.meetings[id] = { clientId: m.clientId, clientName: w.clients[m.clientId].name, projectId: null, date: m.date ?? null, time: m.time ?? null, duration: m.duration ?? 60, location: "", notes: "", status: "נקבעה", hasCalendarEvent: !!m.addToCalendar }; return { id, calendarError: null }; },
    async updateMeeting(id: string, patch: Record<string, unknown>) { calls.push("updateMeeting"); const p = { ...patch }; if ("project_id" in p) { p.projectId = p.project_id; delete p.project_id; } Object.assign(w.meetings[id], p); return { calendarSynced: true }; },
    async deleteMeeting(id: string) { calls.push("deleteMeeting"); delete w.meetings[id]; },
    async readTask(id: string) { return w.tasks[id] ? { ...w.tasks[id] } : null; },
    async createTask(t: { title: string; related_type: string; related_id?: string | null; due_date?: string | null }, mirror: boolean) { calls.push("createTask"); const id = U(++n); w.tasks[id] = { title: t.title, notes: null, status: "פתוח", relatedType: t.related_type, relatedId: t.related_id ?? null, dueDate: t.due_date ?? null, startTime: null, endTime: null, mirrored: mirror }; return { id, mirrored: mirror }; },
    async patchTask(id: string, p: Record<string, unknown>) { calls.push("patchTask"); const t = w.tasks[id]; if (p.title !== undefined) t.title = String(p.title); if (p.notes !== undefined) t.notes = p.notes as string; if (p.status !== undefined) t.status = String(p.status); if (p.due_date !== undefined) t.dueDate = p.due_date as string; if (p.start_time !== undefined) t.startTime = p.start_time as string; if (p.end_time !== undefined) t.endTime = p.end_time as string; },
    async deleteTask(id: string) { calls.push("deleteTask"); if (!w.tasks[id]) return "not_found"; delete w.tasks[id]; return "ok"; },
    async syncGoogleTasks() { calls.push("syncGoogleTasks"); w.synced = 2; return { synced: 2 }; },
    async countOpenTasksTitled(t: string) { return Object.values(w.tasks).filter((x) => x.status === "פתוח" && x.title === t).length; },
    async calendarConnected() { return w.connected; },
    async readCalendarEvent(id: string) { return w.events[id] ? { ...w.events[id] } : null; },
    async addCalendarEvent(e: { summary: string; start: string; end: string; attendees?: string[] }) { calls.push("addCalendarEvent"); const id = `ev${++n}xyz`; w.events[id] = { summary: e.summary, start: e.start.slice(0, 16), end: e.end.slice(0, 16), location: "", description: "", attendeeCount: e.attendees?.length ?? 0 }; return id; },
    async editCalendarEvent(id: string, p: { summary?: string; startIso?: string; endIso?: string; location?: string; description?: string }) { calls.push("editCalendarEvent"); const e = w.events[id]; if (p.summary !== undefined) e.summary = p.summary; if (p.startIso) e.start = p.startIso.slice(0, 16); if (p.endIso) e.end = p.endIso.slice(0, 16); if (p.location !== undefined) e.location = p.location; if (p.description !== undefined) e.description = p.description; },
    async removeCalendarEvent(id: string) { calls.push("removeCalendarEvent"); delete w.events[id]; },
    async addGoogleTask(title: string) { calls.push("addGoogleTask"); w.gtasks.push(title); return `gt${n}`; },
    async readGoogleTask(id: string) { return w.gstore[id] ? { ...w.gstore[id] } : null; },
    async googleTaskLinkedToTask(id: string) { return id === "GLINKED99"; },
    async removeGoogleTask(id: string) { calls.push("removeGoogleTask"); delete w.gstore[id]; },
    async disconnectGoogle() { calls.push("disconnectGoogle"); w.connected = false; },
  };
  return { w, calls, writers };
}

const C1 = `client:${U(1)}`, P1 = `proposal:${U(10)}`, M1 = `meeting:${U(20)}`, T1 = `task:${U(30)}`, E1 = `gcal-event:${EV}`;
const CASES: FamilyCase<W>[] = [
  { id: "CREATE_CLIENT", args: { name: "נגש", type: "אמן" }, bad: { name: "נגש", type: "חבר" }, stale: (w) => { w.clients[U(99)] = { ...w.clients[U(1)], name: "נגש" }; }, check: (w, c) => Object.values(w.clients).some((x) => x.name === "נגש" && x.type === "אמן" && x.status === "חדש") && c.join() === "createClient" },
  { id: "UPDATE_CLIENT_CONTACT", args: { client: C1, phone: "052-1234567", status: "VIP" }, bad: { client: C1, email: "not-an-email" }, missing: { client: `client:${U(9)}`, phone: "1" }, wrongKind: { client: `project:${U(40)}`, phone: "1" }, stale: (w) => { w.clients[U(1)].phone = "053"; }, check: (w) => w.clients[U(1)].phone === "052-1234567" && w.clients[U(1)].status === "VIP" && w.clients[U(1)].email === "a@b.co" },
  { id: "RENAME_CLIENT", args: { client: C1, name: "שליו כהן" }, confirm: "כן בוס, שליו כהן", bad: { client: C1, name: "" }, missing: { client: `client:${U(9)}`, name: "x" }, stale: (w) => { w.artistsText[U(41)] = "שליו"; }, check: (w) => w.clients[U(1)].name === "שליו כהן" && w.artistsText[U(40)] === "שליו כהן" },
  { id: "DELETE_CLIENT", args: { client: C1 }, confirm: "כן בוס, מחיקה", bad: { client: "client:nope" }, missing: { client: `client:${U(9)}` }, wrongKind: { client: P1 }, stale: (w) => { w.proposals[U(11)] = { ...w.proposals[U(10)] }; }, check: (w) => !w.clients[U(1)] && !w.proposals[U(10)] },
  { id: "CREATE_PROPOSAL", args: { client: C1, title: "סינגל", amount: 2500, currency: "₪", followupDate: "2026-10-10" }, confirm: "כן בוס, ₪2,500", bad: { client: C1, title: "סינגל", amount: -5 }, missing: { client: `client:${U(9)}`, title: "x" }, stale: (w) => { delete w.clients[U(1)]; }, check: (w, c) => Object.values(w.proposals).some((p) => p.title === "סינגל" && p.amount === 2500 && p.followupDate === "2026-10-10") && c.join() === "createProposal" },
  { id: "UPDATE_PROPOSAL_INFO", args: { proposal: P1, title: "אלבום מלא", notes: "נשלח בוואטסאפ", mode: "APPEND" }, bad: { proposal: P1, sentDate: "2026-13-40" }, missing: { proposal: `proposal:${U(9)}`, title: "x" }, wrongKind: { proposal: C1, title: "x" }, stale: (w) => { w.proposals[U(10)].title = "אחר"; }, check: (w) => w.proposals[U(10)].title === "אלבום מלא" && w.proposals[U(10)].notes === "נשלח בוואטסאפ" },
  { id: "UPDATE_PROPOSAL_AMOUNT", args: { proposal: P1, amount: 6000 }, confirm: "כן בוס, ₪6,000", bad: { proposal: P1, currency: "€" }, missing: { proposal: `proposal:${U(9)}`, amount: 1 }, stale: (w) => { w.proposals[U(10)].amount = 5500; }, check: (w) => w.proposals[U(10)].amount === 6000 && w.proposals[U(10)].currency === "₪" },
  { id: "CHANGE_PROPOSAL_STATUS", args: { proposal: P1, status: "לא נסגר" }, bad: { proposal: P1, status: "מבוטל" }, missing: { proposal: `proposal:${U(9)}`, status: "נסגר" }, stale: (w) => { w.proposals[U(10)].status = "צריך פולואפ"; }, check: (w) => w.proposals[U(10)].status === "לא נסגר" },
  { id: "SET_PROPOSAL_FOLLOWUP", args: { proposal: P1, followupDate: "2026-10-15" }, confirm: "כן בוס, 2026-10-15", bad: { proposal: P1, followupDate: "מחר" }, missing: { proposal: `proposal:${U(9)}`, followupDate: "2026-10-15" }, stale: (w) => { w.proposals[U(10)].followupDate = "2026-10-12"; }, check: (w) => w.proposals[U(10)].followupDate === "2026-10-15" },
  { id: "LINK_PROPOSAL_TO_PROJECT", args: { proposal: P1, project: `project:${U(40)}` }, bad: { proposal: P1, project: "project:x" }, missing: { proposal: `proposal:${U(9)}`, project: `project:${U(40)}` }, stale: (w) => { w.proposals[U(10)].linkedProjectId = U(41); }, check: (w) => w.proposals[U(10)].linkedProjectId === U(40) && w.proposals[U(10)].status === "ממתין לתשובה" },
  { id: "CONVERT_PROPOSAL", args: { proposal: P1 }, bad: { proposal: P1, projectName: "" }, missing: { proposal: `proposal:${U(9)}` }, stale: (w) => { w.proposals[U(10)].amount = 7000; }, check: (w, c) => w.proposals[U(10)].status === "נסגר" && !!w.proposals[U(10)].linkedProjectId && c.join() === "convertProposal" },
  { id: "DELETE_PROPOSAL", args: { proposal: P1 }, confirm: "כן בוס, מחיקה", bad: { proposal: "proposal:zz" }, missing: { proposal: `proposal:${U(9)}` }, stale: (w) => { w.proposals[U(10)].status = "נסגר"; }, check: (w) => !w.proposals[U(10)] },
  { id: "CREATE_MEETING", args: { client: C1, date: "2026-10-05", time: "14:30", addToCalendar: true }, confirm: "כן בוס, 2026-10-05 14:30", bad: { client: C1, date: "2026-10-05", time: "25:00" }, missing: { client: `client:${U(9)}`, date: "2026-10-05", time: "10:00" }, stale: (w) => { w.clients[U(1)].name = "שליו ב"; }, check: (w) => Object.values(w.meetings).some((m) => m.date === "2026-10-05" && m.time === "14:30" && m.hasCalendarEvent) },
  { id: "UPDATE_MEETING", args: { meeting: M1, date: "2026-10-02", time: "16:00" }, confirm: "כן בוס, 2026-10-02 16:00", bad: { meeting: M1, duration: 17 }, missing: { meeting: `meeting:${U(9)}`, time: "10:00" }, wrongKind: { meeting: T1, time: "10:00" }, stale: (w) => { w.meetings[U(20)].location = "בית"; }, check: (w) => w.meetings[U(20)].date === "2026-10-02" && w.meetings[U(20)].time === "16:00" },
  { id: "DELETE_MEETING", args: { meeting: M1 }, confirm: "כן בוס, מחיקה", bad: { meeting: "meeting:1" }, missing: { meeting: `meeting:${U(9)}` }, stale: (w) => { w.meetings[U(20)].status = "התקיימה"; }, check: (w) => !w.meetings[U(20)] },
  { id: "CREATE_TASK", args: { title: "לשלוח סטמים", relatedType: "client", related: C1, dueDate: "2026-10-04", mirrorToGoogle: true }, confirm: "כן בוס, 2026-10-04", bad: { title: "x", relatedType: "client" }, stale: (w) => { w.tasks[U(31)] = { ...w.tasks[U(30)], title: "לשלוח סטמים" }; }, check: (w) => Object.values(w.tasks).some((t) => t.title === "לשלוח סטמים" && t.relatedId === U(1) && t.mirrored) },
  { id: "UPDATE_TASK", args: { task: T1, dueDate: "2026-10-06" }, confirm: "כן בוס, 2026-10-06", bad: { task: T1, startTime: "9" }, missing: { task: `task:${U(9)}`, title: "x" }, wrongKind: { task: M1, title: "x" }, stale: (w) => { w.tasks[U(30)].dueDate = "2026-10-03"; }, check: (w) => w.tasks[U(30)].dueDate === "2026-10-06" && w.tasks[U(30)].title === "להתקשר" },
  { id: "SET_TASK_STATUS", args: { task: T1, status: "בוצע" }, bad: { task: T1, status: "סגור" }, missing: { task: `task:${U(9)}`, status: "בוצע" }, stale: (w) => { w.tasks[U(30)].status = "בוטל"; }, check: (w) => w.tasks[U(30)].status === "בוצע" },
  { id: "DELETE_TASK", args: { task: T1 }, confirm: "כן בוס, מחיקה", bad: { task: "task:x" }, missing: { task: `task:${U(9)}` }, stale: (w) => { w.tasks[U(30)].status = "בוצע"; }, check: (w) => !w.tasks[U(30)] },
  { id: "SYNC_GOOGLE_TASKS_NOW", args: {}, bad: { __x: 1 }, stale: (w) => { w.connected = false; }, check: (w, c) => w.synced === 2 && c.join() === "syncGoogleTasks" },
  { id: "CREATE_CALENDAR_EVENT", args: { summary: "חזרה להופעה", start: "2026-10-08T18:00", end: "2026-10-08T20:00" }, confirm: "כן בוס, 2026-10-08T18:00", bad: { summary: "x", start: "2026-10-08T20:00", end: "2026-10-08T18:00" }, stale: (w) => { w.connected = false; }, check: (w) => Object.values(w.events).some((e) => e.summary === "חזרה להופעה" && e.start === "2026-10-08T18:00" && e.attendeeCount === 0) },
  { id: "CREATE_CALENDAR_INVITE", args: { summary: "פגישת הפקה", start: "2026-10-09T11:00", end: "2026-10-09T12:00", attendees: "x@y.co, z@w.co" }, confirm: "כן בוס, 2026-10-09T11:00 x@y.co z@w.co", bad: { summary: "x", start: "2026-10-09T11:00", end: "2026-10-09T12:00", attendees: "nobody" }, stale: (w) => { w.connected = false; }, check: (w) => Object.values(w.events).some((e) => e.summary === "פגישת הפקה" && e.attendeeCount === 2) },
  { id: "UPDATE_CALENDAR_EVENT", args: { event: E1, start: "2026-10-03T11:00", end: "2026-10-03T13:00" }, confirm: "כן בוס, 2026-10-03T11:00 2026-10-03T13:00", bad: { event: E1, start: "tomorrow" }, missing: { event: "gcal-event:zzzzzzzzzz", summary: "x" }, wrongKind: { event: T1, summary: "x" }, stale: (w) => { w.events[EV].summary = "שונה"; }, check: (w) => w.events[EV].start === "2026-10-03T11:00" && w.events[EV].summary === "חזרה" },
  { id: "DELETE_CALENDAR_EVENT", args: { event: E1 }, confirm: "כן בוס, מחיקה", bad: { event: "gcal-event:a" }, missing: { event: "gcal-event:zzzzzzzzzz" }, stale: (w) => { w.events[EV].location = "תל אביב"; }, check: (w) => !w.events[EV] },
  { id: "CREATE_GOOGLE_TASK", args: { title: "לקנות כבלים", due: "2026-10-07" }, confirm: "כן בוס, 2026-10-07", bad: { title: "x", due: "7/10" }, stale: (w) => { w.connected = false; }, check: (w) => w.gtasks.includes("לקנות כבלים") },
  { id: "DELETE_GOOGLE_TASK", args: { googleTask: "gtask:GTASK1abc" }, confirm: "כן בוס, מחיקה", bad: { googleTask: "gtask:a/b" }, missing: { googleTask: "gtask:NOPE12345" }, wrongKind: { googleTask: T1 }, stale: (w) => { w.gstore.GTASK1abc.status = "completed"; }, check: (w) => !w.gstore.GTASK1abc },
  { id: "DISCONNECT_GOOGLE_CALENDAR", args: {}, confirm: "כן בוס, ניתוק", bad: { x: "1" }, stale: (w) => { w.connected = false; }, check: (w, c) => !w.connected && c.join() === "disconnectGoogle" },
];

(async () => {
  console.log("CRM / schedule family — standard checks");
  ok("the case table covers every CRM primitive", CASES.map((c) => c.id).sort().join() === CRM_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily-specific");
  {
    const h = mk(); const r = await fullFlow(mkDeps(h.writers).d, "DELETE_CLIENT", { client: C1 }, "מאשר");
    ok("deleting a client: the preview says מחיקה; a plain \"מאשר\" approves the exact plan (no repeated word)", JSON.stringify(r.p).includes("מחיקה") && r.e?.status === "APPLIED_AS_EXPECTED" && !h.w.clients[U(1)], r.e?.status);
    const p = await planAction({ intentHe: "x", actionId: "DELETE_CLIENT", args: { client: C1 } }, OWNER, mkDeps(mk().writers).d);
    ok("the delete preview says the client's proposals are deleted with it (DB cascade, hardened writer)", p.status === "PREVIEW" && JSON.stringify(p).includes("יימחקו גם 1 הצעות"));
    const d2 = await planAction({ intentHe: "x", actionId: "CREATE_CLIENT", args: { name: "שליו" } }, OWNER, mkDeps(mk().writers).d);
    ok("a duplicate client name is refused (the app does not allow duplicates)", d2.status === "DUPLICATE", d2.status);
    const m = mk(); const rm = await fullFlow(mkDeps(m.writers).d, "UPDATE_PROPOSAL_AMOUNT", { proposal: P1, amount: 6000 }, "מאשר אבל 6500");
    ok("\"מאשר אבל 6500\" is not an approval of the 6000 plan (APPROVAL_WITH_CHANGES, nothing written)", rm.a?.status === "APPROVAL_WITH_CHANGES" && m.w.proposals[U(10)].amount === 5000, rm.a?.status);
    const i = mk(); const ri = await fullFlow(mkDeps(i.writers).d, "CREATE_CALENDAR_INVITE", { summary: "x", start: "2026-10-09T11:00", end: "2026-10-09T12:00", attendees: "x@y.co" }, "מאשר");
    ok("an invite: the preview lists every attendee; a plain \"מאשר\" sends exactly that plan", JSON.stringify(ri.p).includes("x@y.co") && ri.e?.status === "APPLIED_AS_EXPECTED", ri.e?.status);
    ok("CREATE_CALENDAR_INVITE declares EMAIL (Google emails the guests)", ACTION_REGISTRY.get("CREATE_CALENDAR_INVITE")!.effects.includes("EMAIL" as never));
    const c = mk(); c.w.proposals[U(10)].linkedProjectId = U(40);
    const pc = await planAction({ intentHe: "x", actionId: "CONVERT_PROPOSAL", args: { proposal: P1 } }, OWNER, mkDeps(c.writers).d);
    ok("an already-converted proposal cannot be converted again", pc.status === "NO_CHANGE_NEEDED");
    const lp = mk(); const rl = await fullFlow(mkDeps(lp.writers).d, "LINK_PROPOSAL_TO_PROJECT", { proposal: P1, project: `project:${U(77)}` });
    ok("linking to a project that does not exist writes nothing", lp.w.proposals[U(10)].linkedProjectId === null && rl.e?.status !== "APPLIED_AS_EXPECTED", rl.e?.status);
    const nc = mk(); nc.w.connected = false;
    const pn = await planAction({ intentHe: "x", actionId: "CREATE_CALENDAR_EVENT", args: { summary: "x", start: "2026-10-08T18:00", end: "2026-10-08T19:00" } }, OWNER, mkDeps(nc.writers).d);
    ok("a disconnected Google calendar is reported, never treated as done", pn.status === "NOT_CONNECTED");
    const tw = await planAction({ intentHe: "x", actionId: "CREATE_TASK", args: { title: "להתקשר" } }, OWNER, mkDeps(mk().writers).d);
    ok("a task with the same open title shows a duplicate warning", tw.status === "PREVIEW" && JSON.stringify(tw).includes("כבר יש 1 משימה פתוחה"));
    const gm = await planAction({ intentHe: "x", actionId: "CREATE_TASK", args: { title: "x", mirrorToGoogle: true } }, OWNER, mkDeps(mk().writers).d);
    ok("mirroring to Google Tasks without a due date is refused", gm.status === "MISSING_DATE");
    const gl = await planAction({ intentHe: "x", actionId: "DELETE_GOOGLE_TASK", args: { googleTask: "gtask:GLINKED99" } }, OWNER, mkDeps(mk().writers).d);
    ok("a Google Task linked to a Redbloods task is deleted only through DELETE_TASK", gl.status === "USE_TASK_ACTION");
    const dg = mk(); const rd = await fullFlow(mkDeps(dg.writers).d, "DISCONNECT_GOOGLE_CALENDAR", {}, "רגע, לא");
    ok("disconnecting Google (C3): \"רגע, לא\" is not an approval — nothing changes", rd.a?.status === "NOT_AN_APPROVAL" && dg.w.connected, rd.a?.status);
    ok("the disconnect primitive never reads the token (only connected / not)", !/loadToken|google_calendar_token/.test(read("lib/partner/act/primitives/crm.ts")));
    ok("every CRM delete is C3 (strong approval) and declares DELETION", CRM_PRIMITIVES.filter((p) => p.actionId.startsWith("DELETE_")).every((p) => ACTION_REGISTRY.get(p.actionId)?.confirmation === "C3_STRONG_APPROVAL" && ACTION_REGISTRY.get(p.actionId)!.effects.includes("DELETION" as never)));
    const EXT = ["CREATE_PROPOSAL", "SET_PROPOSAL_FOLLOWUP", "CONVERT_PROPOSAL", "DELETE_PROPOSAL", "DELETE_CLIENT", "CREATE_MEETING", "UPDATE_MEETING", "DELETE_MEETING", "CREATE_TASK", "UPDATE_TASK", "SET_TASK_STATUS", "DELETE_TASK", "SYNC_GOOGLE_TASKS_NOW", "CREATE_CALENDAR_EVENT", "CREATE_CALENDAR_INVITE", "UPDATE_CALENDAR_EVENT", "DELETE_CALENDAR_EVENT", "CREATE_GOOGLE_TASK"];
    ok("every calendar / Google Tasks write declares its external effect", EXT.every((id) => ACTION_REGISTRY.get(id)!.effects.some((e) => e === "CALENDAR" || e === "GOOGLE_TASKS")));
  }

  console.log("\nVocabularies pinned to the code");
  const ts = read("lib/tasks-store.ts");
  ok("task statuses = lib/tasks-store TASK_STATUSES", TASK_STATUS_VALUES.every((s) => ts.includes(`"${s}"`)) && /TASK_STATUSES: TaskStatus\[\]\s*=\s*\["פתוח", "בוצע", "בוטל"\]/.test(ts) && TASK_STATUS_VALUES.join() === "פתוח,בוצע,בוטל");
  ok("task related types = lib/tasks-store TASK_RELATED_TYPES", /TASK_RELATED_TYPES: TaskRelatedType\[\] = \["general", "client", "project", "red_film_production"\]/.test(ts) && TASK_RELATED_VALUES.join() === "general,client,project,red_film_production");
  const cs = read("lib/clients-store.ts");
  ok("client types / statuses match lib/clients-store", cs.includes(`"אמן" | "לקוח" | "איש צוות" | "אחר"`) && cs.includes(`"פעיל" | "לא פעיל" | "בעייתי" | "VIP" | "חדש" | "אמן לייבל"`));

  console.log("\nShared writers (no divergence) + hardening");
  ok("clients routes use the shared writers (create / save / delete)", /createClientRecord\(/.test(read("app/api/clients/route.ts")) && /saveClient\(/.test(read("app/api/clients/[id]/route.ts")) && /deleteClientRecord\(/.test(read("app/api/clients/[id]/route.ts")));
  ok("proposal routes use the shared writers (create / update / delete / convert)", /createProposal\(/.test(read("app/api/proposals/route.ts")) && /updateProposal\(/.test(read("app/api/proposals/[id]/route.ts")) && /deleteProposal\(/.test(read("app/api/proposals/[id]/route.ts")) && /convertProposal\(/.test(read("app/api/proposals/[id]/convert/route.ts")));
  ok("meeting routes use the shared writers", /createMeeting\(/.test(read("app/api/meetings/route.ts")) && /updateMeeting\(/.test(read("app/api/meetings/[id]/route.ts")) && /deleteMeeting\(/.test(read("app/api/meetings/[id]/route.ts")));
  ok("task routes + the Google Tasks sync route use the shared writers", /patchTaskRecord\(/.test(read("app/api/tasks/[id]/route.ts")) && /deleteTaskRecord\(/.test(read("app/api/tasks/[id]/route.ts")) && /syncCompletedGoogleTasks\(/.test(read("app/api/calendar/tasks/sync/route.ts")));
  const pw = read("lib/writes/proposals.ts");
  ok("HARDENED: proposal conversion claims the row (CAS on linked_project_id IS NULL + updated_at) → no double project", /\.is\("linked_project_id", null\)\.eq\("updated_at", proposal\.updated_at\)/.test(pw) && /status: "busy"/.test(pw));
  const mw = read("lib/writes/meetings.ts");
  ok("HARDENED: a meeting edit moves its Google event; a meeting delete removes it", /updateCalendarEvent\(data\.calendar_event_id/.test(mw) && /deleteCalendarEvent\(m\.calendar_event_id\)/.test(mw));
  ok("HARDENED: a task due-date change moves its Google Task due date", /updateGoogleTaskDue\(gid, patch\.due_date\)/.test(read("lib/writes/tasks.ts")));
  ok("HARDENED: deleting a client deletes its proposals through deleteProposal first (no orphan follow-up tasks)", /for \(const p of .*\) await deleteProposal\(p\.id\);\s*await deleteClient\(id\)/.test(read("lib/writes/clients.ts")));
  ok("calendar reads return no guest emails (count only)", /attendeeCount: data\.attendees\?\.length \?\? 0/.test(read("lib/google-calendar.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
