/**
 * Universal Action Layer — THE FILE CHANNEL: every placement primitive through the REAL service on fakes (6 standard
 * checks each) + channel rules (handles only — never a path; a wrong handle lists the inbox; the destination's own
 * limit refuses BEFORE approval; a failed placement leaves the item in the inbox; C2 "העלאה" / C3 for replace & discard),
 * and the shared writers every screen upload route now uses (same limits / naming / duplicate rule).
 * Run with:   npx tsx scripts/test-sunny-act-uploads.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { UPLOAD_PRIMITIVES, type UploadDestination } from "../lib/partner/act/primitives/uploads";
import { ACTION_REGISTRY } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

const R1 = "a".repeat(24), R2 = "b".repeat(24), R3 = "c".repeat(24);
interface W { inbox: Record<string, { name: string; size: number; mime: string }>; placed: string[]; tooBig: Set<string>; failNext: boolean; projects: Record<string, string>; titles: Record<string, string> }
const world = (): W => ({
  inbox: { [R1]: { name: "Mix 4.wav", size: 42_000_000, mime: "audio/wav" }, [R2]: { name: "cover.jpg", size: 900_000, mime: "image/jpeg" }, [R3]: { name: "huge.wav", size: 900_000_000, mime: "audio/wav" } },
  placed: [], tooBig: new Set([R3]), failNext: false, projects: { [U(1)]: "קרוב" }, titles: { [U(2)]: "מיקס" },
});
function mk() {
  const w = world(); const calls: string[] = [];
  const view = (ref: string) => (w.inbox[ref] ? { ref, ...w.inbox[ref] } : null);
  const writers = {
    async listInbox() { return Object.keys(w.inbox).map((r) => view(r)!); },
    async inboxItemView(ref: string) { return view(ref); },
    async inboxFits(_d: UploadDestination, ref: string) { return w.tooBig.has(ref) ? "הקובץ גדול מדי" : null; },
    async placeInboxItem(dest: UploadDestination, t: Record<string, string | null>, ref: string, o: Record<string, unknown>) {
      calls.push(`place:${dest}`);
      if (w.failNext) return { ok: false as const, error: "Dropbox: conflict" };
      w.placed.push(`${dest}:${JSON.stringify(t)}:${ref}:${JSON.stringify(o)}`); delete w.inbox[ref]; return { ok: true as const, receipt: "ok" };
    },
    async readProjectMeta(id: string) { return w.projects[id] ? { name: w.projects[id], artist: "שליו טסמה", status: "בעבודה", isHidden: false, businessType: "לייבל", projectType: "שיר", hasRelease: false } : null; },
    async readEngineerWork(id: string) { return w.titles[id] ? { projectId: U(1), projectType: "שיר", title: w.titles[id], engineerName: "Steven", workType: "מיקס", status: "בעבודה", agreedPrice: 0, currency: "$", amountPaid: 0, paymentDate: null, sentDate: null, internalDeadline: null, notes: "", expenseStatus: null } : null; },
    async readMixCommentFull(id: string) { return id === U(3) ? { versionId: U(4), workId: U(2), text: "יותר ווקאל", timestampSeconds: 12, status: "open", attachments: 0 } : null; },
    async readSocialContent(id: string) { return id === U(5) ? { title: "טיזר", campaign_id: U(6), project_id: U(1) } : null; },
    async readProductionRow(id: string) { return id === U(7) ? { title: "קליפ קרוב" } : null; },
    async readBudgetPaymentRow(id: string) { return id === U(8) ? { amount: 500, payment_date: "2026-09-01", has_receipt: false } : null; },
    async readVictorWorkFull(id: string) { return id === U(9) ? { title: "הפקה", projectId: U(1), projectName: "קרוב", status: "פעיל", workState: null, sentDate: null, internalDeadline: null, briefText: "", hasTask: false, reviewKeys: "", vendorName: "victor" } : null; },
    async readLabelArtistFull(id: string) { return id === U(10) ? { name: "שליו טסמה", status: "פעיל", notes: "", portalSlug: "shalev" } : id === U(11) ? { name: "אמן בלי פורטל", status: "פעיל", notes: "", portalSlug: null } : null; },
    async readSketch(_s: string, id: string) { return id === "sk_aaaa1" ? { title: "קרוב", description: "", notes: "", latestVersion: 2, archived: false, position: 1, count: 1, rating: null } : null; },
    async listSketchChoices() { return [{ id: "sk_aaaa1", title: "קרוב" }]; },
    async readBeat(id: string) { return id === U(12) ? { name: "Riddim X", genre: "dancehall", musicalKey: "A Minor", assigned: "" } : null; },
  };
  return { w, calls, writers };
}
const P = `project:${U(1)}`, WK = `mix-work:${U(2)}`, C = "כן בוס, העלאה";
const std = (id: string, args: Record<string, unknown>, extra: Partial<FamilyCase<W>> = {}): FamilyCase<W> => ({
  id, args: { ...args, inboxItem: R1 }, confirm: extra.confirm ?? C, bad: extra.bad ?? { ...args, inboxItem: "../../x" }, missing: extra.missing ?? { ...args, inboxItem: "f".repeat(24) },
  stale: (w) => { w.inbox[R1].size = 43_000_000; }, check: (w) => w.placed.length === 1 && w.placed[0].startsWith(`${ACTION_REGISTRY.get(id)!.internal.writer!.match(/placeInboxItem\((\w+)\)/)![1]}:`) && !w.inbox[R1], ...extra,
});
const CASES: FamilyCase<W>[] = [
  std("UPLOAD_PROJECT_FILE", { project: P, subfolder: "Delivery/ערוצים" }, { wrongKind: { project: WK, inboxItem: R1 } }),
  std("UPLOAD_TO_DELIVERY", { project: P }),
  std("UPLOAD_WORK_MATERIAL", { work: WK, materialType: "stems" }, { bad: { work: WK, materialType: "video", inboxItem: R1 } }),
  std("UPLOAD_MIX_VERSION", { work: WK, label: "Mix 4" }, { bad: { work: WK, label: "", inboxItem: R1 }, wrongKind: { work: P, label: "x", inboxItem: R1 } }),
  std("UPLOAD_FINAL_FILE", { work: WK }),
  std("ATTACH_MIX_COMMENT_FILE", { comment: `mix-comment:${U(3)}` }),
  std("UPLOAD_SOCIAL_FILE", { content: `social-content:${U(5)}` }),
  std("UPLOAD_RF_DOCUMENT", { production: `rf-production:${U(7)}`, fileType: "תסריט" }, { bad: { production: `rf-production:${U(7)}`, fileType: "חשבונית", inboxItem: R1 } }),
  std("UPLOAD_RF_REFERENCE_IMAGE", { production: `rf-production:${U(7)}`, tag: "תאורה" }),
  std("ATTACH_RF_RECEIPT", { payment: `rf-payment:${U(8)}` }),
  std("UPLOAD_VICTOR_FILE", { victorWork: `victor-work:${U(9)}`, bucket: "01_From_Redbloods" }, { bad: { victorWork: `victor-work:${U(9)}`, bucket: "../x", inboxItem: R1 } }),
  std("UPLOAD_VICTOR_BRIEF_FILE", { victorWork: `victor-work:${U(9)}` }),
  std("CREATE_SKETCH_FROM_FILE", { labelArtist: `label-artist:${U(10)}`, title: "סקיצה חדשה" }, { bad: { labelArtist: `label-artist:${U(10)}`, title: "", inboxItem: R1 } }),
  std("ADD_SKETCH_VERSION_FROM_FILE", { labelArtist: `label-artist:${U(10)}`, sketchId: "sk_aaaa1" }),
  std("SET_SKETCH_BEAT_FROM_FILE", { labelArtist: `label-artist:${U(10)}`, sketchId: "sk_aaaa1" }),
  std("UPLOAD_BEAT", { name: "Riddim Y", genre: "dancehall" }, { bad: { name: "", genre: "x", inboxItem: R1 } }),
  std("REPLACE_BEAT_FILE", { beat: `beat:${U(12)}` }),
  std("SET_ARTIST_PROFILE_IMAGE", { labelArtist: `label-artist:${U(10)}` }),
  std("UPLOAD_ARTIST_PORTAL_FILE", { labelArtist: `label-artist:${U(10)}`, kind: "pressKit" }, { bad: { labelArtist: `label-artist:${U(10)}`, kind: "video", inboxItem: R1 } }),
  std("SET_PROJECT_COVER_IMAGE", { project: P }),
  std("DISCARD_INBOX_ITEM", {}, { confirm: "כן בוס, הסרה" }),
];

(async () => {
  console.log("File channel — standard checks");
  ok("the case table covers every file-channel primitive", CASES.map((c) => c.id).sort().join() === UPLOAD_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nChannel rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  const miss = await q("UPLOAD_TO_DELIVERY", { project: P, inboxItem: "f".repeat(24) });
  ok("a wrong handle is refused WITH the inbox listing (handle — name — size), never a path", miss.status === "ENTITY_NOT_FOUND" && String(miss.messageHe).includes(`${R1} — Mix 4.wav`) && !/\/Sunny Inbox|\/Projects/.test(String(miss.messageHe)), miss.messageHe);
  ok("a path is never a handle", (await q("UPLOAD_TO_DELIVERY", { project: P, inboxItem: "/Sunny Inbox/Mix 4.wav" })).status !== "PREVIEW");
  const big = await q("UPLOAD_MIX_VERSION", { work: WK, label: "Mix 5", inboxItem: R3 });
  ok("the destination's own limit refuses BEFORE approval", big.status === "DOES_NOT_FIT" && String(big.messageHe).includes("גדול מדי"));
  ok("an artist without a portal has no library to upload into", (await q("CREATE_SKETCH_FROM_FILE", { labelArtist: `label-artist:${U(11)}`, title: "x", inboxItem: R1 })).status === "NO_PORTAL");
  const f = mk(); f.w.failNext = true;
  const rf = await fullFlow(mkDeps(f.writers).d, "UPLOAD_FINAL_FILE", { work: WK, inboxItem: R1 }, C);
  ok("a failed placement is FAILED and the item stays in the inbox", rf.e?.status !== "APPLIED_AS_EXPECTED" && !!f.w.inbox[R1], rf.e?.status);
  const n = mk(); const rn = await fullFlow(mkDeps(n.writers).d, "UPLOAD_TO_DELIVERY", { project: P, inboxItem: R1 }, "מאשר");
  ok("a placement: a plain \"מאשר\" approves the exact previewed placement", rn.e?.status === "APPLIED_AS_EXPECTED", rn.e?.status);
  const pv = await q("UPLOAD_PROJECT_FILE", { project: P, inboxItem: R1 });
  ok("the preview names the file, its size and the destination — no path", JSON.stringify(pv).includes("Mix 4.wav") && JSON.stringify(pv).includes("MB") && !JSON.stringify(pv).includes("/Projects/"));
  ok("placements are C2 (FILE_MUTATION); replacing a beat and discarding are C3", UPLOAD_PRIMITIVES.filter((p) => !["REPLACE_BEAT_FILE", "DISCARD_INBOX_ITEM"].includes(p.actionId)).every((p) => ACTION_REGISTRY.get(p.actionId)!.confirmation === "C2_APPROVAL_WITH_VALUES") && ["REPLACE_BEAT_FILE", "DISCARD_INBOX_ITEM"].every((id) => ACTION_REGISTRY.get(id)!.confirmation === "C3_STRONG_APPROVAL"));
  ok("no path / URL / file argument anywhere in the family", UPLOAD_PRIMITIVES.every((p) => p.meta.args.every((a) => !/^(path|url|file|filePath|dropboxPath)$/i.test(a.name) && a.kind !== "url")));

  console.log("\nShared writers + inbox module");
  const inbox = read("lib/writes/inbox.ts");
  ok("the inbox reads / moves / deletes ONLY inside its one folder, by handle", /export const INBOX_FOLDER = "\/Sunny Inbox"/.test(inbox) && /path: INBOX_FOLDER/.test(inbox) && !/export async function \w+\(path/.test(inbox) && /\^\[0-9a-f\]\{24\}\$/.test(inbox));
  const routes: Array<[string, RegExp]> = [
    ["app/api/dropbox/upload/route.ts", /uploadProjectFile\(/], ["app/api/delivery/upload/route.ts", /uploadToDelivery\(/], ["app/api/sound-engineer/[id]/work-materials/route.ts", /uploadWorkMaterial\(/],
    ["app/api/sound-engineer/comments/[commentId]/attachments/route.ts", /attachFileToMixComment\(/], ["app/api/social/upload/route.ts", /uploadSocialContentFile\(/], ["app/api/red-films/productions/[id]/documents/upload/route.ts", /uploadRfDocument\(/],
    ["app/api/red-films/productions/[id]/references/upload/route.ts", /uploadRfReferenceImage\(/], ["app/api/red-films/budget-payments/[paymentId]/receipt/route.ts", /attachReceiptToPayment\(/], ["app/api/red-films/budget-items/[itemId]/payments/route.ts", /receiptForNewPayment\(/],
    ["app/api/dropbox/vendor-upload/route.ts", /uploadVictorWorkFile\(/], ["app/api/vendor/victor/work/[id]/brief/route.ts", /uploadVictorBriefFile\(/],
  ];
  const off = routes.filter(([f, re]) => !re.test(read(f)) || /content\.dropboxapi\.com\/2\/files\/upload/.test(read(f))).map(([f]) => f);
  ok("every screen upload route calls the shared writer (and no longer uploads by itself)", off.length === 0, off);
  const up = read("lib/writes/uploads.ts");
  ok("the limits / types are the routes' own values (unchanged)", /ATTACH_MAX_SIZE = 10 \* 1024 \* 1024/.test(up) && /SOCIAL_MAX_SIZE = 500 \* 1024 \* 1024/.test(up) && /DOC_MAX_SIZE = 50 \* 1024 \* 1024/.test(up) && /REF_MAX_SIZE = 20 \* 1024 \* 1024/.test(up) && /RECEIPT_MAX_SIZE = 20 \* 1024 \* 1024/.test(up) && /BRIEF_MAX_BYTES = 100 \* 1024 \* 1024/.test(up));
  const fc = read("lib/writes/file-channel.ts");
  ok("mix versions / final files reuse the canonical resolvers + finalizers (moved, never re-implemented)", /resolveVersionTarget\(/.test(fc) && /finalizeMixVersion\(/.test(fc) && /resolveFinalTarget\(/.test(fc) && /finalizeFinalFile\(/.test(fc) && /moveInboxItem\(ref, `\$\{resolved\.target\.folder\}\/\$\{item\.name\}`, false\)/.test(fc));
  ok("a successful placement consumes the inbox item; a failure leaves it", /if \(!r\.ok\) return bad/.test(fc) && fc.indexOf("if (!r.ok) return bad") < fc.indexOf("await removeInboxItem(ref);"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
