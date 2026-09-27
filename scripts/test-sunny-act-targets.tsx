/**
 * Universal Action Layer — ADDRESSABILITY. An action Sunny cannot target is not an action Sunny can perform:
 *   A. every key kind any primitive parses (parseKey / kinds) is listed by action_targets, resolved by partner_resolve,
 *      or documented as a non-key target (sketch ids are answered by the refusal itself);
 *   B. the builder turns the loaded sources into keys the primitives accept (`<kind>:<uuid>`), per parent;
 *   C. no path / link / credential leaves it; a missing source is UNAVAILABLE, never an empty list;
 *   D. the capability is registered, Owner-only, and in the SUNNY_CORE read list.
 * Run with:   npx tsx scripts/test-sunny-act-targets.tsx      Pure; never touches production.
 */
import fs from "node:fs";
import path from "node:path";
import { buildActionTargets, NON_KEY_TARGETS, RESOLVE_KINDS, TARGET_KINDS } from "../lib/partner/act/targets";
import { parseKey } from "../lib/partner/act/primitives/core";
import { inspectText } from "../lib/partner/act/persist";
import { PARTNER_KNOWLEDGE_REGISTRY } from "../lib/partner/knowledge/catalog";
import { DOMAIN_CONTRACTS } from "../lib/partner/system/registry";
import type { GatewaySources } from "../lib/partner/gateway/core";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); } };
const ROOT = path.resolve(__dirname, "..");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

console.log("A. Every key kind a primitive parses is addressable");
const dir = path.join(ROOT, "lib/partner/act/primitives");
const parsed = new Set<string>();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of src.matchAll(/parseKey\([^,]+,\s*\[([^\]]*)\]/g)) for (const k of m[1].matchAll(/"([a-z-]+)"/g)) parsed.add(k[1]);
  for (const m of src.matchAll(/kinds:\s*\[([^\]]*)\]/g)) for (const k of m[1].matchAll(/"([a-z-]+)"/g)) parsed.add(k[1]);
}
const listed = new Set([...Object.values(TARGET_KINDS).flat(), ...RESOLVE_KINDS, ...Object.keys(NON_KEY_TARGETS)]);
const unaddressable = [...parsed].filter((k) => !listed.has(k));
ok(`A1. all ${parsed.size} key kinds used by primitives are addressable`, parsed.size > 25 && unaddressable.length === 0, unaddressable);
ok("A2. every listed child kind is really used by a primitive (no dead listing)", [...new Set(Object.values(TARGET_KINDS).flat())].every((k) => parsed.has(k)), [...new Set(Object.values(TARGET_KINDS).flat())].filter((k) => !parsed.has(k)));
ok("A4. every key kind survives the act input guard (no kind reads as a URL scheme / path — e.g. 'file:')", [...parsed].every((k) => inspectText(`${k}:${U(1)}`, "k").length === 0), [...parsed].filter((k) => inspectText(`${k}:${U(1)}`, "k").length));
ok("A3. partner_resolve really indexes the RESOLVE_KINDS", RESOLVE_KINDS.every((k) => fs.readFileSync(path.join(ROOT, "lib/partner/gateway/resolve.ts"), "utf8").includes(`key: \`${k}:`)));

console.log("\nB. Sources → keys the primitives accept");
const sec = <T,>(rows: T[]) => ({ rows, truncated: false } as never);
const P = U(1), W = U(2), RF = U(3), A = U(4), C = U(5), S = U(6);
const det = {
  projects: sec([]), financeNotes: sec([]), deliveries: sec([]), commentAttachments: sec([]), finalFiles: sec([]), campaigns: sec([]), contentItems: sec([]), socialFiles: sec([]), projectSettings: sec([]), agentAlerts: sec([]), notifications: sec([]),
  actions: sec([{ id: U(10), projectId: P, actionType: "sent", contentType: "mix", versionLabel: "V1", recipientName: "שליו", recipientRole: "artist", status: "pending_feedback", actionDate: "2026-09-20" }]),
  sessions: sec([{ id: U(11), projectId: P, showId: null, date: "2026-10-01", startTime: "10:00", type: "הקלטה", title: null, status: "מתוכנן" }, { id: U(12), projectId: null, showId: S, date: "2026-10-02", startTime: "18:00", type: "חזרה", title: null, status: "מתוכנן" }]),
  meetings: sec([{ id: U(13), projectId: P, clientId: C, date: "2026-10-03", time: "12:00", clientName: "יוסי", status: "מתוכנן" }]),
  tasks: sec([{ id: U(14), relatedType: "project", relatedId: P, title: "לשלוח מיקס", dueDate: "2026-10-04", status: "פתוח", showId: null }, { id: U(15), relatedType: "client", relatedId: C, title: "להתקשר", dueDate: null, status: "פתוח", showId: null }]),
  albumTracks: sec([{ id: U(16), projectId: P, trackNumber: 1, title: "פתיחה", notes: null }]),
  engineerWork: sec([{ id: W, projectId: P, engineerName: "Steven", workType: "מיקס", workTitle: "שיר", status: "בעבודה" }]),
  victor: sec([{ id: U(17), projectId: P, vendorName: "Victor", title: "הפקה", status: "בעבודה" }]),
  clipItems: sec([{ id: U(18), projectId: P, category: "צלם", description: "יום צילום", amount: 1500, status: "מתוכנן" }]),
  productions: sec([{ id: RF, projectId: P, clientNameSnapshot: "x" }]),
  proposals: sec([{ id: U(19), linkedProjectId: P, clientId: C, title: "הצעה לאלבום" }]),
  transactionsText: sec([{ id: U(20), projectId: P, type: "הכנסה", date: "2026-09-01", description: "מקדמה https://www.dropbox.com/s/secret" }]),
  releases: sec([{ projectId: P, nextAction: "מאסטר" }]),
  mixVersions: sec([{ id: U(21), workId: W, label: "Mix 1", fileName: "a.wav", uploadedAt: "2026-09-10", status: "ממתין", path: "/Redbloods/secret/a.wav" }]),
  mixComments: sec([{ id: U(22), versionId: U(21), timestampSeconds: 42, text: "יותר ווקאל", status: "open" }]),
  mixTargets: sec([{ id: U(23), workId: W, displayName: "Main", kind: "riddim", sortOrder: 1, removedAt: null }, { id: U(24), workId: W, displayName: "Old", kind: "riddim", sortOrder: 2, removedAt: "2026-09-01" }]),
  mixTargetNotes: sec([{ id: U(25), targetId: U(23), text: "באס חזק", status: "open" }, { id: U(26), targetId: U(24), text: "x", status: "open" }]),
  budgetItems: sec([{ id: U(27), productionId: RF, category: "צלם", title: "צלם ראשי", vendorName: "דני", status: "מתוכנן" }]),
  budgetPayments: sec([{ id: U(28), productionId: RF, amount: 500, date: "2026-09-12", method: "העברה" }]),
  rfDocuments: sec([{ id: U(29), productionId: RF, fileName: "תסריט.pdf", fileType: "script", path: "/secret" }]),
  rfRefImages: sec([{ id: U(30), productionId: RF, fileName: "ref.jpg", caption: "תאורה", tag: "light" }]),
  rfEquipment: sec([{ id: U(31), name: "מצלמה", category: "מצלמות", quantity: 1, status: "פעיל", removedAt: null }]),
};
const lab = { artists: sec([]), cycles: sec([]), shows: sec([]), ledger: sec([{ id: U(32), artistId: A, entryType: "תשלומים", amount: 700, entryDate: "2026-09-20", description: "העברה" }]), mediaIncome: sec([{ id: U(33), artistId: A, reportPeriod: "Q2-2026", source: "Mobile1", grossAmount: 900, status: "התקבל" }]), beats: sec([{ id: U(34), name: "Riddim X", genre: "dancehall", musicalKey: "A Minor", status: "פעיל" }]) };
const ops = { redFilms: sec([{ id: RF, title: "קליפ אלבום", productionType: "קליפ", status: "בהכנה", shootDate: "2026-10-10" }]), projectsMeta: sec([{ id: P, name: "אלבום שליו" }]) };
const src = { now: new Date("2026-09-27T10:00:00Z"), identities: { cleantone: null }, projectDetail: { status: "OK", value: det }, labelDetail: { status: "OK", value: lab }, operations: { status: "OK", value: ops } } as unknown as GatewaySources;
const keysOf = (parent: string, kind?: string) => { const r = buildActionTargets(src, parent, kind); return r.ok ? r.targets.map((t) => t.key) : [`ERR:${r.reason}`]; };
const proj = keysOf(`project:${P}`);
ok("B1. project → session, meeting, task, send-log, album-track, mix-work, victor-work, clip-row, rf-production, proposal, transaction, release", ["session:" + U(11), "meeting:" + U(13), "task:" + U(14), "send-log:" + U(10), "album-track:" + U(16), "mix-work:" + W, "victor-work:" + U(17), "clip-row:" + U(18), "rf-production:" + RF, "proposal:" + U(19), "transaction:" + U(20), "release:" + P].every((k) => proj.includes(k)) && proj.length === 12, proj);
const mw = keysOf(`mix-work:${W}`);
ok("B2. mix-work → versions, comments, ACTIVE lines and their pre-mix notes only", mw.join() === ["mix-version:" + U(21), "mix-comment:" + U(22), "mix-line:" + U(23), "premix-note:" + U(25)].join(), mw);
ok("B3. rf-production → budget line, payment, document, reference", keysOf(`rf-production:${RF}`).join() === ["rf-budget-line:" + U(27), "rf-payment:" + U(28), "rf-document:" + U(29), "rf-reference:" + U(30)].join());
ok("B4. label-artist → ledger entries + media income", keysOf(`label-artist:${A}`).join() === ["ledger-entry:" + U(32), "media-income:" + U(33)].join());
ok("B5. client → proposal, meeting, client task", keysOf(`client:${C}`).join() === ["proposal:" + U(19), "meeting:" + U(13), "task:" + U(15)].join());
ok("B6. show → its rehearsal sessions", keysOf(`show:${S}`).join() === "session:" + U(12));
const co = keysOf("company");
ok("B7. company → project-less records too (a show rehearsal session, every work / production / proposal, equipment, beats)", co.includes("session:" + U(12)) && co.includes("rf-equipment:" + U(31)) && co.includes("beat:" + U(34)) && co.includes("rf-production:" + RF) && co.includes("mix-work:" + W));
ok("B8. the kind filter narrows", keysOf(`project:${P}`, "session").join() === "session:" + U(11));
const all = [...proj, ...mw, ...keysOf(`rf-production:${RF}`), ...keysOf(`label-artist:${A}`), ...co];
ok("B9. every key parses with the primitives' own parser (uuid ids)", all.every((k) => !!parseKey(k, [k.slice(0, k.indexOf(":"))])), all.filter((k) => !parseKey(k, [k.slice(0, k.indexOf(":"))])));

console.log("\nC. Safety");
const r = buildActionTargets(src, `project:${P}`);
const labels = JSON.stringify(r.ok ? r.targets : []);
ok("C1. no storage path or share link leaves the builder (labels never use paths; free text is scrubbed again)", !labels.includes("/Redbloods/") && !labels.includes("dropbox.com") && labels.includes("הוסתר"));
ok("C2. a bad parent is refused, not guessed", !buildActionTargets(src, "project:abc").ok && !buildActionTargets(src, "beat:" + U(34)).ok);
const noDet = { ...src, projectDetail: { status: "UNAVAILABLE", detail: "x" } } as unknown as GatewaySources;
const rn = buildActionTargets(noDet, `project:${P}`);
ok("C3. a missing source is UNAVAILABLE — never an empty list", !rn.ok && rn.reason === "SOURCE_UNAVAILABLE");

console.log("\nD. Registration");
const cap = PARTNER_KNOWLEDGE_REGISTRY.get?.("action_targets") ?? (PARTNER_KNOWLEDGE_REGISTRY as unknown as { capabilities: Array<{ id: string; access: { ownerOnly: boolean } }> }).capabilities?.find((c) => c.id === "action_targets");
ok("D1. action_targets is registered in the knowledge catalog and Owner-only", !!cap && (cap as { access: { ownerOnly: boolean } }).access.ownerOnly === true);
ok("D2. SUNNY_CORE lists it as a read capability", DOMAIN_CONTRACTS.find((d) => d.id === "SUNNY_CORE")!.readCapabilities.includes("action_targets"));
const capSrc = fs.readFileSync(path.join(ROOT, "lib/partner/knowledge/capabilities/act.ts"), "utf8");
ok("D3. the capability reads only already-loaded sources (no store / supabase import)", !/supabase|lib\/writes|@\/lib\//.test(fs.readFileSync(path.join(ROOT, "lib/partner/act/targets.ts"), "utf8")) && /needs: \["PROJECT_DETAIL", "LABEL_DETAIL", "OPERATIONS"\]/.test(capSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
