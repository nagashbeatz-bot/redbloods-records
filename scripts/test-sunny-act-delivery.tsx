/**
 * Universal Action Layer — client delivery: every primitive through the REAL service on fakes (6 standard checks each)
 * + family rules (no second folder; status only with a folder; the delete needs "מחיקה", the public link needs
 * "קישור ציבורי"; no path / link in any plan), the pinned vocabulary and the hardened shared writer the route uses.
 * Run with:   npx tsx scripts/test-sunny-act-delivery.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { runCases, mkDeps, fullFlow, U, OWNER, type FamilyCase } from "./fixtures/act-harness";
import { planAction } from "../lib/partner/act/service";
import { DELIVERY_PRIMITIVES, DELIVERY_STATUS_VALUES } from "../lib/partner/act/primitives/delivery";
import { ACTION_REGISTRY, HARDENED, NEEDS_HARDENING } from "../lib/partner/act/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

type Dv = { folderPath: string; deliveryLink: string; deliveryStatus: string; deliveredAt: string | null };
interface W { projects: Record<string, { name: string; artist: string }>; delivery: Record<string, Dv>; created: string[]; deleted: string[] }
const world = (): W => ({
  projects: { [U(1)]: { name: "שיר חדש", artist: "יוסי" }, [U(2)]: { name: "אלבום", artist: "דנה" } },
  delivery: { [U(2)]: { folderPath: "/Redbloods/דנה/אלבום/Delivery", deliveryLink: "https://www.dropbox.com/s/abc", deliveryStatus: "ready", deliveredAt: null } },
  created: [], deleted: [],
});
function mk() {
  const w = world(); const calls: string[] = [];
  const writers = {
    async readProjectMeta(id: string) { const p = w.projects[id]; return p ? { name: p.name, artist: p.artist, status: "בעבודה", isHidden: false, businessType: "לקוח", projectType: "שיר", hasRelease: false } : null; },
    async readDeliveryState(id: string) { const v = w.delivery[id]; return { status: v?.deliveryStatus ?? "not_created", deliveredAt: v?.deliveredAt ?? null, hasFolder: !!v?.folderPath, hasLink: !!v?.deliveryLink }; },
    async createDeliveryFolder(id: string, artist: string, name: string) { calls.push("createDeliveryFolder"); w.created.push(`${artist}/${name}`); w.delivery[id] = { folderPath: `/Redbloods/${artist}/${name}/Delivery`, deliveryLink: "https://www.dropbox.com/s/new", deliveryStatus: "ready", deliveredAt: null }; },
    async setDeliveryStatus(id: string, p: { deliveryStatus: string; deliveredAt: string | null }) { calls.push("setDeliveryStatus"); Object.assign(w.delivery[id], p); },
    async deleteDeliveryFolder(id: string) { calls.push("deleteDeliveryFolder"); w.deleted.push(w.delivery[id].folderPath); w.delivery[id] = { folderPath: "", deliveryLink: "", deliveryStatus: "not_created", deliveredAt: null }; },
  };
  return { w, calls, writers };
}
const P1 = `project:${U(1)}`, P2 = `project:${U(2)}`;
const CASES: FamilyCase<W>[] = [
  { id: "CREATE_DELIVERY_FOLDER", args: { project: P1 }, confirm: "כן בוס, עם קישור ציבורי", bad: { project: "project:1" }, missing: { project: `project:${U(9)}` }, wrongKind: { project: `client:${U(1)}` }, stale: (w) => { w.projects[U(1)].name = "שיר חדש 2"; }, check: (w) => w.delivery[U(1)]?.deliveryStatus === "ready" && w.created.join() === "יוסי/שיר חדש" },
  { id: "SET_DELIVERY_STATUS", args: { project: P2, status: "delivered", deliveredAt: "2026-09-27" }, bad: { project: P2, status: "delivered", deliveredAt: "27/9" }, missing: { project: `project:${U(9)}`, status: "delivered" }, stale: (w) => { w.delivery[U(2)].deliveryStatus = "delivered"; w.delivery[U(2)].deliveredAt = "2026-09-20"; }, check: (w) => w.delivery[U(2)].deliveryStatus === "delivered" && w.delivery[U(2)].deliveredAt === "2026-09-27" && w.delivery[U(2)].folderPath.endsWith("Delivery") },
  { id: "DELETE_DELIVERY_FOLDER", args: { project: P2 }, confirm: "כן בוס, מחיקה", bad: { project: P1 }, missing: { project: `project:${U(9)}` }, stale: (w) => { w.delivery[U(2)].deliveryStatus = "delivered"; }, check: (w) => w.delivery[U(2)].deliveryStatus === "not_created" && w.deleted.length === 1 },
];

(async () => {
  console.log("Delivery — standard checks");
  ok("the case table covers every delivery primitive", CASES.map((c) => c.id).sort().join() === DELIVERY_PRIMITIVES.map((p) => p.actionId).sort().join());
  await runCases(CASES, mk, ok);

  console.log("\nFamily rules");
  const q = (id: string, args: Record<string, unknown>, h = mk()) => planAction({ intentHe: "x", actionId: id, args }, OWNER, mkDeps(h.writers).d);
  ok("no second Delivery folder", (await q("CREATE_DELIVERY_FOLDER", { project: P2 })).status === "ALREADY_EXISTS");
  ok("status only once a folder exists", (await q("SET_DELIVERY_STATUS", { project: P1, status: "delivered" })).status === "NO_DELIVERY");
  ok("a delivered date only with 'delivered'", (await q("SET_DELIVERY_STATUS", { project: P2, status: "ready", deliveredAt: "2026-09-27" })).status === "BAD_ARGS");
  const back = mk(); back.w.delivery[U(2)].deliveryStatus = "delivered"; back.w.delivery[U(2)].deliveredAt = "2026-09-20";
  const rb = await fullFlow(mkDeps(back.writers).d, "SET_DELIVERY_STATUS", { project: P2, status: "ready" });
  ok("back to ready clears the delivered date", rb.e?.status === "APPLIED_AS_EXPECTED" && back.w.delivery[U(2)].deliveredAt === null);
  const nl = mk(); const rn = await fullFlow(mkDeps(nl.writers).d, "CREATE_DELIVERY_FOLDER", { project: P1 }, "כן בוס");
  ok("creating a public link needs 'קישור ציבורי' in the approval", rn.a?.status === "CONFIRMATION_VALUES_MISSING" && nl.calls.length === 0);
  const pr = await q("CREATE_DELIVERY_FOLDER", { project: P1 });
  ok("no path / link in the plan or preview", !/Redbloods|dropbox\.com|https?:/.test(JSON.stringify(pr)));
  ok("the delete is C3 destructive; create declares FILES + EXTERNAL_LINK", ACTION_REGISTRY.get("DELETE_DELIVERY_FOLDER")!.confirmation === "C3_STRONG_APPROVAL" && ["FILES", "EXTERNAL_LINK"].every((e) => ACTION_REGISTRY.get("CREATE_DELIVERY_FOLDER")!.effects.includes(e as never)));
  ok("PROJECT.DELIVERY moved from NEEDS_HARDENING to HARDENED", !("PROJECT.DELIVERY" in NEEDS_HARDENING) && "PROJECT.DELIVERY" in HARDENED);

  console.log("\nVocabulary + shared writer");
  ok("delivery statuses = the drawer's type + lib/writes/delivery", /deliveryStatus:\s*"not_created"\s*\|\s*"ready"\s*\|\s*"delivered"/.test(read("components/ui/ProjectDrawer.tsx")) && read("lib/writes/delivery.ts").includes(`DELIVERY_STATUSES = [${DELIVERY_STATUS_VALUES.map((x) => `"${x}"`).join(", ")}]`));
  const r = read("app/api/delivery/route.ts");
  ok("the delivery route uses the shared writers (create / status / delete)", /createDeliveryFolder\(/.test(r) && /setDeliveryStatus\(/.test(r) && /deleteDeliveryFolder\(/.test(r) && !/\.\.\.current, \.\.\.updates/.test(r));
  const wd = read("lib/writes/delivery.ts");
  ok("the status writer accepts only deliveryStatus + deliveredAt (whole-body merge removed)", /allowed = new Set\(\["deliveryStatus", "deliveredAt"\]\)/.test(wd) && /DeliveryInputError/.test(wd));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
