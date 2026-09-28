/**
 * Universal Action Layer — Label family: every primitive through the REAL service on fakes (6 standard checks each)
 * + family rules (duplicate artist names; ledger types; only expected income is marked received; early cycle close
 * needs force; reminders / sketch / beat pushes truthful; availability ≥ 2 different days; media CAS; beats' exactly-once
 * notify), pinned vocabularies, shared writers + moved push senders.
 * Run with:   npx tsx scripts/test-sunny-act-label.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { BEAT_GENRE_VALUES, LABEL_ARTIST_STATUS_VALUES, LABEL_PRIMITIVES, LEDGER_TYPES, MEDIA_STATUS_VALUES } from "../lib/partner/act/primitives/label";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Ar = { name: string; status: string; notes: string; portalSlug: string | null };
type Le = { artistId: string; entryType: string; amount: number; entryDate: string; description: string; note: string; sourceShowId: string | null; sourceTxId: string | null };
type Me = { artistId: string; grossAmount: number; source: string; reportPeriod: string; receivedDate: string | null; status: string; notes: string; updatedAt: string; incomeKind: string; allocationModel: boolean; financeTransactionId: string | null; creditedArtistIds?: string[] };
type Sk = { id: string; title: string; description: string; notes: string; latestVersion: number; archived: boolean; rating: number | null };
interface W { artists: Record<string, Ar>; ledger: Record<string, Le>; cycles: Record<string, { anchorDate: string | null; currentIndex: number | null; currentEnd: string | null; daysUntilClose: number | null }>; media: Record<string, Me>; avail: Record<string, string>; beats: Record<string, { name: string; genre: string; musicalKey: string | null; assigned: string[] }>; sketches: Record<string, Sk[]>; pushes: string[]; next: string[] }
const world = (): W => ({
  artists: { [U(1)]: { name: "שליו טסמה", status: "פעיל", notes: "", portalSlug: "shalev" }, [U(2)]: { name: "אמן חדש", status: "פעיל", notes: "", portalSlug: null }, [U(3)]: { name: "אבי מולה", status: "פעיל", notes: "", portalSlug: "avi" }, [U(4)]: { name: "נגש ביטס", status: "פעיל", notes: "", portalSlug: null } },
  ledger: { [U(10)]: { artistId: U(1), entryType: "הכנסות צפויות", amount: 1500, entryDate: "2026-09-10", description: "הופעה - חיפה", note: "", sourceShowId: null, sourceTxId: "tx-9" } },
  cycles: { [U(1)]: { anchorDate: "2026-08-01", currentIndex: 1, currentEnd: "2026-09-30", daysUntilClose: 3 }, [U(2)]: { anchorDate: null, currentIndex: null, currentEnd: null, daysUntilClose: null } },
  media: { [U(20)]: { artistId: U(1), grossAmount: 900, source: "Mobile1", reportPeriod: "Q2-2026", receivedDate: "2026-07-15", status: "התקבל", notes: "", updatedAt: "t1", incomeKind: "DISTRIBUTION", allocationModel: false, financeTransactionId: null } },
  avail: { shalev: "" }, beats: { [U(30)]: { name: "Riddim X", genre: "dancehall", musicalKey: "A Minor", assigned: ["avi"] } },
  sketches: { shalev: [{ id: "sk_aaaa1", title: "קרוב", description: "", notes: "", latestVersion: 2, archived: false, rating: null }, { id: "sk_bbbb2", title: "רחוק", description: "", notes: "", latestVersion: 1, archived: false, rating: 3 }] },
  pushes: [], next: [],
});
function mk() {
  const w = world(); const calls: string[] = []; let n = 500;
  const sk = (slug: string, id: string) => w.sketches[slug]?.find((s) => s.id === id);
  const writers = {
    async similarRecords() { return []; }, // duplicate awareness is proven in test-sunny-polish-1.tsx
    async readLabelArtistFull(id: string) { return w.artists[id] ? { ...w.artists[id] } : null; },
    async countLabelArtistsNamed(name: string) { return Object.values(w.artists).filter((a) => a.name === name).length; },
    async createLabelArtistRecord(a: { name: string; status: string; notes: string }) { calls.push("createLabelArtistRecord"); const id = U(++n); w.artists[id] = { ...a, portalSlug: null }; return id; },
    async renameLabelArtist(id: string, name: string) { calls.push("renameLabelArtist"); w.artists[id].name = name; return "ok" as const; },
    async readLedgerEntry(id: string) { return w.ledger[id] ? { ...w.ledger[id] } : null; },
    async createLedgerEntry(e: Omit<Le, "sourceShowId" | "sourceTxId">) { calls.push("createLedgerEntry"); const id = U(++n); w.ledger[id] = { ...e, sourceShowId: null, sourceTxId: null }; return id; },
    async updateLedgerEntry(id: string, _a: string, e: Partial<Le>) { calls.push("updateLedgerEntry"); Object.assign(w.ledger[id], e); return true; },
    async deleteLedgerEntry(id: string) { calls.push("deleteLedgerEntry"); delete w.ledger[id]; return true; },
    async readCycleState(id: string) { return { ...w.cycles[id] }; },
    async setCycleAnchor(id: string, date: string) { calls.push("setCycleAnchor"); w.cycles[id].anchorDate = date; },
    async closeCycle(id: string) { calls.push("closeCycle"); w.cycles[id].currentIndex = Number(w.cycles[id].currentIndex) + 1; w.cycles[id].daysUntilClose = 60; },
    async sendCycleReminder(id: string, o: boolean, a: boolean) { calls.push("sendCycleReminder"); w.pushes.push(`cycle:${id}:${o}:${a}`); return { kind: "ok", ownerSent: o, artistSent: a }; },
    async readMediaRecord(id: string) { return w.media[id] ? { ...w.media[id] } : null; },
    async createMediaRecord(artistId: string, m: Omit<Me, "artistId" | "updatedAt">) { calls.push("createMediaRecord"); const id = U(++n); w.media[id] = { ...m, artistId, updatedAt: "t0", allocationModel: true, financeTransactionId: `fin-${id}` }; return { ok: true, id }; },
    async updateMediaRecord(id: string, _a: string, exp: string, m: Partial<Me>) { calls.push("updateMediaRecord"); if (w.media[id].updatedAt !== exp) return { ok: false, message: "stale" }; Object.assign(w.media[id], m, { updatedAt: "t2" }); return { ok: true }; },
    async cancelMediaRecord(id: string, _a: string, exp: string) { calls.push("cancelMediaRecord"); if (w.media[id].updatedAt !== exp) return { ok: false, message: "stale" }; w.media[id].status = "בוטל"; return { ok: true }; },
    async readAvailability(slug: string) { return w.avail[slug] ?? ""; },
    async saveOwnerAvailability(slug: string, days: Array<{ day: string; date: string; available: boolean; from: string }>) { calls.push("saveOwnerAvailability"); w.avail[slug] = days.filter((x) => x.available).map((x) => `${x.day} ${x.date} ${x.from}`).join(", "); },
    async readBeat(id: string) { const b = w.beats[id]; return b ? { name: b.name, genre: b.genre, musicalKey: b.musicalKey, assigned: [...b.assigned].sort().join(",") } : null; },
    async assignBeat(id: string, slug: string) { calls.push("assignBeat"); w.beats[id].assigned.push(slug); w.pushes.push(`beat:${slug}`); return { notified: "sent" }; },
    async unassignBeat(id: string, slug: string) { calls.push("unassignBeat"); w.beats[id].assigned = w.beats[id].assigned.filter((x) => x !== slug); },
    async updateBeatDetails(id: string, f: { name: string; genre: string; musicalKey: string | null }) { calls.push("updateBeatDetails"); Object.assign(w.beats[id], f); return "ok" as const; },
    async deleteBeatFully(id: string) { calls.push("deleteBeatFully"); delete w.beats[id]; return { ok: true }; },
    async readSketch(slug: string, id: string) { const act = (w.sketches[slug] ?? []).filter((s) => !s.archived); const s = sk(slug, id); return s ? { title: s.title, description: s.description, notes: s.notes, latestVersion: s.latestVersion, archived: s.archived, position: act.findIndex((x) => x.id === id) + 1, count: act.length, rating: s.rating } : null; },
    async patchSketch(slug: string, id: string, p: Partial<Sk>) { calls.push("patchSketch"); Object.assign(sk(slug, id)!, p); },
    async rateSketch(slug: string, id: string, r: number | null) { calls.push("rateSketch"); sk(slug, id)!.rating = r; },
    async archiveSketch(slug: string, id: string) { calls.push("archiveSketch"); sk(slug, id)!.archived = true; },
    async listSketchChoices(slug: string) { return w.sketches[slug].filter((s) => !s.archived).map((s) => ({ id: s.id, title: s.title })); },
    async orderSketches(slug: string) { return w.sketches[slug].filter((s) => !s.archived).map((s) => s.id); },
    async reorderSketches(slug: string, ids: string[]) { calls.push("reorderSketches"); w.sketches[slug] = ids.map((id) => sk(slug, id)!); },
    async notifySketch(_a: string, _n: string, _s: string, id: string) { calls.push("notifySketch"); w.pushes.push(`sketch:${id}`); return { kind: "ok" }; },
    async setNextWork(_s: string, id: string, dl: string | null) { calls.push("setNextWork"); w.next.push(`work:${id}:${dl}`); },
    async setNextRelease(_s: string, id: string, d: string) { calls.push("setNextRelease"); w.next.push(`release:${id}:${d}`); },
  };
  return { w, calls, writers };
}
const A1 = `label-artist:${U(1)}`, A2 = `label-artist:${U(2)}`, L10 = `ledger-entry:${U(10)}`, M20 = `media-income:${U(20)}`, B30 = `beat:${U(30)}`;
const CASES: FamilyCase<W>[] = [
  { id: "CREATE_LABEL_ARTIST", args: { name: "אמנית חדשה" }, bad: { name: "x", status: "מושעה" }, stale: (w) => { w.artists[U(77)] = { name: "אמנית חדשה", status: "פעיל", notes: "", portalSlug: null }; }, check: (w) => Object.values(w.artists).some((a) => a.name === "אמנית חדשה" && a.status === "פעיל") },
  { id: "RENAME_LABEL_ARTIST", args: { labelArtist: A2, name: "אמן ותיק" }, confirm: "כן בוס, אמן ותיק", bad: { labelArtist: A2, name: "" }, missing: { labelArtist: `label-artist:${U(9)}`, name: "x" }, wrongKind: { labelArtist: `project:${U(1)}`, name: "x" }, stale: (w) => { w.artists[U(2)].notes = "x"; }, check: (w) => w.artists[U(2)].name === "אמן ותיק" },
  { id: "ADD_LEDGER_ENTRY", args: { labelArtist: A1, entryType: "תשלומים", amount: 700, entryDate: "2026-09-20", description: "העברה" }, confirm: "כן בוס, תשלומים ₪700", bad: { labelArtist: A1, entryType: "בונוס", amount: 1, entryDate: "2026-09-20" }, missing: { labelArtist: `label-artist:${U(9)}`, entryType: "תשלומים", amount: 1, entryDate: "2026-09-20" }, stale: (w) => { w.artists[U(1)].name = "שליו"; }, check: (w) => Object.values(w.ledger).some((e) => e.entryType === "תשלומים" && e.amount === 700) },
  { id: "UPDATE_LEDGER_ENTRY", args: { ledgerEntry: L10, amount: 1600 }, confirm: "כן בוס, ₪1,600", bad: { ledgerEntry: L10, amount: 0 }, missing: { ledgerEntry: `ledger-entry:${U(9)}`, amount: 1 }, wrongKind: { ledgerEntry: A1, amount: 1 }, stale: (w) => { w.ledger[U(10)].note = "x"; }, check: (w) => w.ledger[U(10)].amount === 1600 && w.ledger[U(10)].entryType === "הכנסות צפויות" },
  { id: "MARK_LEDGER_INCOME_RECEIVED", args: { ledgerEntry: L10, entryDate: "2026-09-25" }, confirm: "כן בוס, הכנסות", bad: { ledgerEntry: L10, entryDate: "25/9" }, missing: { ledgerEntry: `ledger-entry:${U(9)}` }, stale: (w) => { w.ledger[U(10)].amount = 1400; }, check: (w) => w.ledger[U(10)].entryType === "הכנסות" && w.ledger[U(10)].entryDate === "2026-09-25" },
  { id: "DELETE_LEDGER_ENTRY", args: { ledgerEntry: L10 }, confirm: "כן בוס, מחיקה", bad: { ledgerEntry: "ledger-entry:1" }, missing: { ledgerEntry: `ledger-entry:${U(9)}` }, stale: (w) => { w.ledger[U(10)].amount = 1; }, check: (w) => !w.ledger[U(10)] },
  { id: "SET_BALANCE_CYCLE_ANCHOR", args: { labelArtist: A2, anchorDate: "2026-10-01" }, confirm: "כן בוס, 2026-10-01", bad: { labelArtist: A2, anchorDate: "1.10" }, missing: { labelArtist: `label-artist:${U(9)}`, anchorDate: "2026-10-01" }, stale: (w) => { w.cycles[U(2)].anchorDate = "2026-09-01"; }, check: (w) => w.cycles[U(2)].anchorDate === "2026-10-01" },
  { id: "CLOSE_BALANCE_CYCLE", args: { labelArtist: A1, force: true }, confirm: "כן בוס, סגירת מחזור", bad: { labelArtist: A1, force: "yes" }, missing: { labelArtist: `label-artist:${U(9)}`, force: true }, stale: (w) => { w.cycles[U(1)].daysUntilClose = 2; }, check: (w) => w.cycles[U(1)].currentIndex === 2 },
  { id: "SEND_CYCLE_REMINDER", args: { labelArtist: A1, toOwner: true, toArtist: true }, confirm: "כן בוס, אליי לאמן", bad: { labelArtist: A1 }, missing: { labelArtist: `label-artist:${U(9)}`, toOwner: true }, stale: (w) => { w.artists[U(1)].notes = "z"; }, check: (w) => w.pushes.join() === `cycle:${U(1)}:true:true` },
  { id: "ADD_MEDIA_INCOME", args: { labelArtist: A1, grossAmount: 1200, reportPeriod: "Q3-2026" }, confirm: "כן בוס, ₪1,200 Q3-2026", bad: { labelArtist: A1, grossAmount: 0, reportPeriod: "Q3" }, missing: { labelArtist: `label-artist:${U(9)}`, grossAmount: 1, reportPeriod: "Q3" }, stale: (w) => { w.artists[U(1)].name = "x"; }, check: (w) => Object.values(w.media).some((m) => m.grossAmount === 1200 && m.status === "התקבל" && m.source === "Mobile1") },
  { id: "UPDATE_MEDIA_INCOME", args: { mediaRecord: M20, grossAmount: 950 }, confirm: "כן בוס, ₪950", bad: { mediaRecord: M20, grossAmount: -1 }, missing: { mediaRecord: `media-income:${U(9)}`, notes: "x" }, stale: (w) => { w.media[U(20)].notes = "y"; }, check: (w) => w.media[U(20)].grossAmount === 950 },
  { id: "CANCEL_MEDIA_INCOME", args: { mediaRecord: M20 }, confirm: "כן בוס, ביטול", bad: { mediaRecord: "media-income:1" }, missing: { mediaRecord: `media-income:${U(9)}` }, stale: (w) => { w.media[U(20)].grossAmount = 1; }, check: (w) => w.media[U(20)].status === "בוטל" },
  { id: "SUBMIT_ARTIST_AVAILABILITY", args: { labelArtist: A1, weekStart: "2026-10-04", slots: "2026-10-05 18:00; 2026-10-07 20:00" }, confirm: "כן בוס, שני 05.10 18:00, רביעי 07.10 20:00", bad: { labelArtist: A1, weekStart: "2026-10-04", slots: "2026-10-05 18:00" }, missing: { labelArtist: `label-artist:${U(9)}`, weekStart: "2026-10-04", slots: "x" }, stale: (w) => { w.avail.shalev = "ראשון 04.10 10:00"; }, check: (w) => w.avail.shalev === "שני 05.10 18:00, רביעי 07.10 20:00" },
  { id: "ASSIGN_BEAT", args: { beat: B30, artistSlug: "shalev" }, confirm: "כן בוס, shalev", bad: { beat: B30, artistSlug: "Shalev Tasama!" }, missing: { beat: `beat:${U(9)}`, artistSlug: "shalev" }, wrongKind: { beat: A1, artistSlug: "shalev" }, stale: (w) => { w.beats[U(30)].assigned.push("cleantone"); }, check: (w) => w.beats[U(30)].assigned.includes("shalev") && w.pushes.join() === "beat:shalev" },
  { id: "UNASSIGN_BEAT", args: { beat: B30, artistSlug: "avi" }, bad: { beat: B30, artistSlug: "shalev" }, missing: { beat: `beat:${U(9)}`, artistSlug: "avi" }, stale: (w) => { w.beats[U(30)].assigned.push("shalev"); }, check: (w) => !w.beats[U(30)].assigned.includes("avi") },
  { id: "UPDATE_BEAT_DETAILS", args: { beat: B30, musicalKey: "C# Major" }, bad: { beat: B30, musicalKey: "H minor" }, missing: { beat: `beat:${U(9)}`, name: "x" }, stale: (w) => { w.beats[U(30)].name = "y"; }, check: (w) => w.beats[U(30)].musicalKey === "C# Major" && w.beats[U(30)].name === "Riddim X" },
  { id: "DELETE_BEAT", args: { beat: B30 }, confirm: "כן בוס, מחיקה", bad: { beat: "beat:1" }, missing: { beat: `beat:${U(9)}` }, stale: (w) => { w.beats[U(30)].genre = "rnb"; }, check: (w) => !w.beats[U(30)] },
  { id: "UPDATE_SKETCH_DETAILS", args: { labelArtist: A1, sketchId: "sk_aaaa1", title: "קרוב אלייך" }, bad: { labelArtist: A1, sketchId: "sk_aaaa1", title: "" }, missing: { labelArtist: A1, sketchId: "sk_zzzz9", title: "x" }, stale: (w) => { w.sketches.shalev[0].notes = "q"; }, check: (w) => w.sketches.shalev[0].title === "קרוב אלייך" },
  { id: "RATE_SKETCH", args: { labelArtist: A1, sketchId: "sk_aaaa1", rating: 5 }, bad: { labelArtist: A1, sketchId: "sk_aaaa1", rating: 7 }, missing: { labelArtist: A1, sketchId: "sk_zzzz9", rating: 3 }, stale: (w) => { w.sketches.shalev[0].rating = 2; }, check: (w) => w.sketches.shalev[0].rating === 5 },
  { id: "ARCHIVE_SKETCH", args: { labelArtist: A1, sketchId: "sk_bbbb2" }, confirm: "כן בוס, מחיקה", bad: { labelArtist: A1, sketchId: "a b" }, missing: { labelArtist: A1, sketchId: "sk_zzzz9" }, stale: (w) => { w.sketches.shalev[1].title = "t"; }, check: (w) => w.sketches.shalev[1].archived },
  { id: "MOVE_SKETCH", args: { labelArtist: A1, sketchId: "sk_bbbb2", position: 1 }, bad: { labelArtist: A1, sketchId: "sk_bbbb2", position: 5 }, missing: { labelArtist: A1, sketchId: "sk_zzzz9", position: 1 }, stale: (w) => { w.sketches.shalev.reverse(); }, check: (w) => w.sketches.shalev[0].id === "sk_bbbb2" },
  { id: "NOTIFY_SKETCH", args: { labelArtist: A1, sketchId: "sk_aaaa1" }, confirm: "כן בוס, התראה", bad: { labelArtist: A1, sketchId: "!" }, missing: { labelArtist: A1, sketchId: "sk_zzzz9" }, stale: (w) => { w.sketches.shalev[0].latestVersion = 3; }, check: (w) => w.pushes.join() === "sketch:sk_aaaa1" },
  { id: "SET_NEXT_WORK", args: { labelArtist: A1, sketchId: "sk_aaaa1", deadline: "2026-10-20" }, confirm: "כן בוס, 2026-10-20", bad: { labelArtist: A1, sketchId: "sk_aaaa1", deadline: "20.10" }, missing: { labelArtist: A1, sketchId: "sk_zzzz9" }, stale: (w) => { w.sketches.shalev[0].title = "t"; }, check: (w) => w.next.join() === "work:sk_aaaa1:2026-10-20" },
  { id: "SET_NEXT_RELEASE", args: { labelArtist: A1, sketchId: "sk_aaaa1", releaseDate: "2026-11-01" }, confirm: "כן בוס, 2026-11-01", bad: { labelArtist: A1, sketchId: "sk_aaaa1", releaseDate: "x" }, missing: { labelArtist: A1, sketchId: "sk_zzzz9", releaseDate: "2026-11-01" }, stale: (w) => { w.sketches.shalev[0].title = "t2"; }, check: (w) => w.next.join() === "release:sk_aaaa1:2026-11-01" },
];

(async () => {
  console.log("Label family — standard checks");
  ok("the case table covers every Label primitive", CASES.map((c) => c.id).sort().join() === LABEL_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nLabel rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("a duplicate artist name is refused", (await q("CREATE_LABEL_ARTIST", { name: "שליו טסמה" })).status === "DUPLICATE");
  const lr = mk(); lr.w.ledger[U(10)].entryType = "תשלומים";
  ok("only expected income is marked received", (await q("MARK_LEDGER_INCOME_RECEIVED", { ledgerEntry: L10 }, lr)).status === "NOT_EXPECTED");
  ok("an early cycle close needs force (the app's rule)", (await q("CLOSE_BALANCE_CYCLE", { labelArtist: A1 })).status === "EARLY_CLOSE");
  ok("no cycle → nothing to close / remind", (await q("CLOSE_BALANCE_CYCLE", { labelArtist: A2, force: true })).status === "NO_CYCLE" && (await q("SEND_CYCLE_REMINDER", { labelArtist: A2, toOwner: true })).status === "NO_CYCLE");
  ok("availability needs ≥ 2 different days of that week", (await q("SUBMIT_ARTIST_AVAILABILITY", { labelArtist: A1, weekStart: "2026-10-04", slots: "2026-10-05 18:00; 2026-10-12 20:00" })).status === "BAD_SLOTS");
  ok("the week starts on Sunday", (await q("SUBMIT_ARTIST_AVAILABILITY", { labelArtist: A1, weekStart: "2026-10-05", slots: "2026-10-05 18:00; 2026-10-07 20:00" })).status === "BAD_DATE");
  ok("an artist without a portal has no availability / library", (await q("SUBMIT_ARTIST_AVAILABILITY", { labelArtist: A2, weekStart: "2026-10-04", slots: "x" })).status === "NO_PORTAL");
  const cm = mk(); cm.w.media[U(20)].status = "בוטל";
  ok("a cancelled media record is not edited", (await q("UPDATE_MEDIA_INCOME", { mediaRecord: M20, notes: "x" }, cm)).status === "CANCELLED");
  // the media allocation model (Owner decision 2026-09-28, DB 2026-09-29) — the ONE rule, previewed before approval
  const pl = async (args: Record<string, unknown>) => (await q("ADD_MEDIA_INCOME", { reportPeriod: "Q3", ...args })) as { status: string; preview?: { after?: Record<string, unknown> }; messageHe?: string };
  const shalevOnly = await pl({ labelArtist: A1, grossAmount: 2000 });
  ok("media: Shalev alone 2,000 → preview 'Records ₪1,000 · שליו טסמה 50% = ₪1,000' (one Finance income)", shalevOnly.status === "PREVIEW" && /כספים: הכנסה אחת ₪2,000 \(Records\) · Records ₪1,000 · שליו טסמה 50% = ₪1,000/.test(JSON.stringify(shalevOnly)), shalevOnly);
  const duo = await pl({ labelArtist: A1, alsoCredited: `label-artist:${U(3)}`, grossAmount: 2000 });
  ok("media: Shalev + Avi 2,000 → 25 % each (₪500 + ₪500), Records ₪1,000", duo.status === "PREVIEW" && /Records ₪1,000 · שליו טסמה 25% = ₪500 · אבי מולה 25% = ₪500/.test(JSON.stringify(duo)), duo);
  const yt = await pl({ labelArtist: A1, grossAmount: 2000, incomeKind: "YOUTUBE" });
  const acum = await pl({ labelArtist: A1, grossAmount: 2000, source: "ACUM" });
  ok("media: YouTube / ACUM (by kind or by the source text) → 100 % Records, no allocation", [yt, acum].every((r) => r.status === "PREVIEW" && /Records ₪2,000 · בלי זכאות לאמנים/.test(JSON.stringify(r))), { yt, acum });
  const nbm = await pl({ labelArtist: A1, alsoCredited: `label-artist:${U(4)}`, grossAmount: 2000 });
  ok("media: NagashBeatz credited → 100 % Records, 0 allocations", nbm.status === "PREVIEW" && /Records ₪2,000 · בלי זכאות לאמנים/.test(JSON.stringify(nbm)), nbm);
  const ext = await pl({ labelArtist: `label-artist:${U(2)}`, grossAmount: 2000 });
  ok("media: credits without a rule (not a Records artist) are refused — never a guessed split", ext.status === "UNDEFINED_SPLIT", ext);
  ok("media: the same artist twice is refused", (await pl({ labelArtist: A1, alsoCredited: A1, grossAmount: 10 })).status === "BAD_ENTITY");
  const done = mk(); const flow = await fullFlow(mkDeps(done.writers).d, "ADD_MEDIA_INCOME", { labelArtist: A1, alsoCredited: `label-artist:${U(3)}`, grossAmount: 2000, reportPeriod: "Q3", incomeKind: "DISTRIBUTION" }, "מאשר");
  const created = Object.values(done.w.media).find((m) => m.reportPeriod === "Q3");
  ok("media: an approved create passes the kind + the co-credited artist to the ONE writer (the RPC allocates)", flow.e?.status === "APPLIED_AS_EXPECTED" && created?.incomeKind === "DISTRIBUTION" && JSON.stringify(created?.creditedArtistIds) === JSON.stringify([U(3)]), { e: flow.e?.status, created });
  ok("media: the kind of a LEGACY record (Mobile1) never changes", (await q("UPDATE_MEDIA_INCOME", { mediaRecord: M20, incomeKind: "YOUTUBE" })).status === "LEGACY_RECORD");
  ok("media primitives declare FINANCE + LEDGER", ["ADD_MEDIA_INCOME", "UPDATE_MEDIA_INCOME", "CANCEL_MEDIA_INCOME"].every((id) => ACTION_REGISTRY.get(id)!.effects.includes("FINANCE" as never) && ACTION_REGISTRY.get(id)!.effects.includes("LEDGER" as never)));
  ok("the media reader reads the owner column label_artist_id (it read a non-existent artist_id before 2026-09-29)", /artistId: String\(data\.label_artist_id\)/.test(read("lib/writes/label.ts")) && !/data\.artist_id\b/.test(read("lib/writes/label.ts").slice(read("lib/writes/label.ts").indexOf("readMediaRecord"), read("lib/writes/label.ts").indexOf("readMediaRecord") + 900)));
  const nn = mk(); nn.w.artists[U(1)].name = "DJ CLEANTONE";
  const miss = await q("RATE_SKETCH", { labelArtist: A1, sketchId: "sk_zzzz9", rating: 3 });
  ok("a wrong sketch id is answered with the artist's active sketches (addressability)", miss.status === "ENTITY_NOT_FOUND" && String(miss.messageHe).includes("sk_aaaa1 — קרוב") && String(miss.messageHe).includes("sk_bbbb2 — רחוק"), miss.messageHe);
  ok("the sketch push exists only for Avi / Shalev", (await q("NOTIFY_SKETCH", { labelArtist: A1, sketchId: "sk_aaaa1" }, nn)).status === "NOT_ENABLED");
  const rr = mk(); const rs = await fullFlow(mkDeps(rr.writers).d, "ADD_LEDGER_ENTRY", { labelArtist: A1, entryType: "תשלומים", amount: 700, entryDate: "2026-09-20" }, "מאשר, תעשה 750");
  ok("\"מאשר, תעשה 750\" on a 700 ledger plan is a change → no write, a new plan is needed", rs.a?.status === "APPROVAL_WITH_CHANGES" && rr.calls.length === 0, rs.a?.status);
  ok("pushes are EXTERNAL_COMMUNICATION with PUSH; deletes / cancel are C3", ["SEND_CYCLE_REMINDER", "ASSIGN_BEAT", "NOTIFY_SKETCH"].every((id) => ACTION_REGISTRY.get(id)!.effects.includes("PUSH" as never)) && ["DELETE_LEDGER_ENTRY", "DELETE_BEAT", "CANCEL_MEDIA_INCOME", "ARCHIVE_SKETCH"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));

  console.log("\nVocabularies pinned to the code");
  ok("ledger types = lib/artist-balance-store BALANCE_ENTRY_TYPES", read("lib/artist-balance-store.ts").includes(`BALANCE_ENTRY_TYPES = [${LEDGER_TYPES.map((x) => `"${x}"`).join(", ")}]`));
  const ty = read("lib/types.ts");
  ok("artist statuses = lib/types LABEL_ARTIST_STATUSES", ty.includes(`LABEL_ARTIST_STATUSES: LabelArtistStatus[] = [${LABEL_ARTIST_STATUS_VALUES.map((x) => `"${x}"`).join(", ")}]`));
  ok("media statuses = lib/types MediaStatus", ty.includes(`MediaStatus = ${MEDIA_STATUS_VALUES.map((x) => `"${x}"`).join(" | ")}`));
  ok("beat genres = lib/beats-store BEAT_GENRES", read("lib/beats-store.ts").includes(`BEAT_GENRES = [${BEAT_GENRE_VALUES.map((x) => `"${x}"`).join(", ")}]`));

  console.log("\nShared writers");
  ok("the cycle reminder / sketch notify / beat assignment routes use lib/writes/label", /sendCycleReminder\(/.test(read("app/api/label/artists/[id]/balance/cycles/remind/route.ts")) && /notifySketchToArtist\(/.test(read("app/api/label/artists/[id]/sketches/[sketchId]/notify/route.ts")) && /assignBeatWithNotify\(/.test(read("app/api/beats/[id]/assignments/route.ts")));
  ok("the moved push senders are what the push contracts point at", /modules: \["lib\/writes\/label\.ts"\]/.test(read("lib/partner/system/people.ts")));
  const wl = read("lib/writes/label.ts");
  ok("the beat assignment keeps the exactly-once rule (read before write; notify only a new, persisted assignment)", wl.indexOf("isBeatAssignedTo(beatId, slug)") < wl.indexOf("assignBeatToArtist(beatId, slug)") && /!alreadyAssigned && artistSlugs\.includes\(slug\)/.test(wl));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
