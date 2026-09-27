/**
 * B2 client / label classification + B4 label identity — pure proof on fixtures (never touches production).
 *   Run with:   npx tsx scripts/test-classification-identity.tsx
 *
 * B2: one canonical field (projects.project_business_type); the Owner rule (שליו טסמה / אבי מולה credited, solo or
 *     collab, by roster id → לייבל) applies on CREATE only; an existing stored לקוח that the rule calls לייבל is a
 *     DERIVED signal (MISMATCH_OWNER_RULE) with an explicit Owner fix — never an automatic write; every reader
 *     (operating / label / projects / company views) uses the stored type only.
 * B4: portal identity by label_artists.id first (a renamed artist still resolves); name-only fallback is AMBIGUOUS;
 *     project → label artist by the release id first; show → ledger identity is honest about collabs.
 */
import fs from "node:fs";
import path from "node:path";
import {
  OWNER_LABEL_ARTIST_IDS, ownerRuleClassification, businessTypeForNewProject, rosterIdByNameOf, classificationSignal,
  isLabelProject, isClientProject, resolveNewProjectBusinessType, MISMATCH_OWNER_RULE,
} from "../lib/project-classification";
import { SHALEV_ARTIST_ID, PORTAL_ARTISTS_BY_ID, resolvePortalIdentity, registeredIdForPortalName } from "../lib/red-artists/portal-registry";
import { AVI_ARTIST_ID } from "../lib/roles";
import { labelArtistIdForProject, LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE } from "../lib/label-identity";
import { showArtistIdentity } from "../lib/artist-balance-show-sync-pure";
import { ATTENTION_MAP } from "../lib/partner/system/company";
import { buildProjectView } from "../lib/partner/projects/view";
import { projectOperating } from "../lib/partner/sunny/operating";
import { buildArtistView } from "../lib/partner/label/view";
import { buildCompanyView } from "../lib/partner/company/view";
import { PROJECT_PRIMITIVES } from "../lib/partner/act/primitives/projects";
import { LABEL_PRIMITIVES } from "../lib/partner/act/primitives/label";
import type { GatewaySources } from "../lib/partner/gateway/core";
import { input, LA_SHALEV, LA_AVI, P, NOW } from "./fixtures/integrity-company";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); } };
const section = (t: string) => console.log(`\n${t}`);
const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const ROSTER = [
  { id: SHALEV_ARTIST_ID, name: "שליו טסמה" }, { id: AVI_ARTIST_ID, name: "אבי מולה" },
  { id: "00000000-0000-4000-8000-000000000903", name: "DJ CLEANTONE" }, { id: "00000000-0000-4000-8000-000000000904", name: "נגש ביטס" },
  { id: "00000000-0000-4000-8000-000000000905", name: "אמן רוסטר אחר" },
];
const R = rosterIdByNameOf(ROSTER);

(async () => {
  section("1. the Owner rule — who is covered");
  ok("the covered ids are exactly Shalev + Avi (existing id constants)", OWNER_LABEL_ARTIST_IDS.size === 2 && OWNER_LABEL_ARTIST_IDS.has(SHALEV_ARTIST_ID) && OWNER_LABEL_ARTIST_IDS.has(AVI_ARTIST_ID) && AVI_ARTIST_ID.startsWith("b3499c72"));
  const cases: Array<[string, "לקוח" | "לייבל"]> = [
    ["שליו טסמה", "לייבל"], ["שליו טסמה, רוני", "לייבל"], ["רוני ، שליו טסמה", "לייבל"], ["דני; שליו טסמה", "לייבל"],
    ["אבי מולה", "לייבל"], ["אבי מולה, נגש ביטס", "לייבל"], ["מישהו;אבי מולה", "לייבל"],
    ["נגש ביטס", "לקוח"], ["DJ CLEANTONE", "לקוח"], ["אמן רוסטר אחר", "לקוח"], ["נגש ביטס, DJ CLEANTONE", "לקוח"],
    ["לקוח חיצוני", "לקוח"], ["", "לקוח"], ["שליו", "לקוח"], ["שליו טסמה ורוני", "לקוח"],
  ];
  for (const [artist, want] of cases) ok(`create "${artist || "(ריק)"}" → ${want}`, businessTypeForNewProject(artist, R) === want, businessTypeForNewProject(artist, R));
  ok("no Owner rule → null (not 'לקוח' as a classification)", ownerRuleClassification("נגש ביטס", R) === null && ownerRuleClassification("שליו טסמה", R) === "לייבל");
  ok("identity is the ROSTER ID: a roster row named 'שליו טסמה' with another id is NOT covered", businessTypeForNewProject("שליו טסמה", rosterIdByNameOf([{ id: "00000000-0000-4000-8000-000000000999", name: "שליו טסמה" }])) === "לקוח");
  ok("renamed artist: the rule follows the id (new name credited → לייבל; old name no longer in the roster → לקוח)", businessTypeForNewProject("שליו T", rosterIdByNameOf([{ id: SHALEV_ARTIST_ID, name: "שליו T" }])) === "לייבל" && businessTypeForNewProject("שליו טסמה", rosterIdByNameOf([{ id: SHALEV_ARTIST_ID, name: "שליו T" }])) === "לקוח");
  ok("an ambiguous roster name (two rows) is never guessed", rosterIdByNameOf([{ id: SHALEV_ARTIST_ID, name: "X" }, { id: "00000000-0000-4000-8000-000000000998", name: "X" }]).get("X") === null);
  const fb = await resolveNewProjectBusinessType("אבי מולה, רוני", async () => { throw new Error("db down"); });
  ok("a roster read failure falls back to the code-registered ids (rule never silently skipped)", fb.businessType === "לייבל" && fb.roster === "REGISTERED_FALLBACK" && fb.basis === "OWNER_RULE");
  const live = await resolveNewProjectBusinessType("לקוח חיצוני", async () => ROSTER);
  ok("a client project stays לקוח (live roster)", live.businessType === "לקוח" && live.basis === "DEFAULT_CLIENT" && live.roster === "LIVE");

  section("2. the create path — UI route + Sunny + proposal conversion share ONE writer / rule");
  const wp = read("lib/writes/projects.ts"), wprop = read("lib/writes/proposals.ts"), route = read("app/api/projects/route.ts"), srv = read("lib/partner/act/server.ts");
  ok("createClientProject stores the Owner-rule type (no hard-coded לקוח)", /newProjectBusinessType\(f\.artist\)/.test(wp) && /project_business_type: businessType/.test(wp) && !/project_business_type: "לקוח"/.test(wp));
  ok("the UI create route goes through createClientProject", /createClientProject\(/.test(route));
  ok("proposal conversion applies the same rule", /newProjectBusinessType\(clientName\)/.test(wprop) && /project_business_type: businessType/.test(wprop));
  ok("Sunny's CREATE_PROJECT preview reads the SAME writer function", /newProjectBusinessType: async \(artist\) => \(await W\.newProjectBusinessType\(artist\)\)\.businessType/.test(srv));
  const cp = PROJECT_PRIMITIVES.find((p) => p.actionId === "CREATE_PROJECT")!;
  ok("CREATE_PROJECT previews + verifies the business type", cp.meta.fields.includes("businessType") && /after\.businessType/.test(String(cp.verify)));

  section("3. the stored type is the ONLY classifier; the mismatch is a signal, never a write");
  ok("isLabelProject = stored לייבל only (unknown is not label)", isLabelProject({ businessType: "לייבל" }) && !isLabelProject({ businessType: "לקוח" }) && !isLabelProject({ businessType: "" }) && !isLabelProject({ businessType: null }) && !isLabelProject(null));
  ok("isClientProject = stored לקוח only", isClientProject({ businessType: "לקוח" }) && !isClientProject({ businessType: "" }));
  const sig = classificationSignal({ businessType: "לקוח", artistText: "אבי מולה, שליו טסמה" }, R);
  ok("stored לקוח + Owner rule match → MISMATCH_OWNER_RULE (DERIVED, explicit Owner fix)", sig?.code === MISMATCH_OWNER_RULE && sig.kind === "DERIVED_SIGNAL" && sig.fix === "OWNER_ACTION_SET_PROJECT_BUSINESS_TYPE" && sig.artistIds.length === 2);
  ok("stored לייבל / no rule → no signal", classificationSignal({ businessType: "לייבל", artistText: "שליו טסמה" }, R) === null && classificationSignal({ businessType: "לקוח", artistText: "נגש ביטס" }, R) === null);
  ok("MISMATCH_OWNER_RULE is mapped in ATTENTION_MAP", !!ATTENTION_MAP.MISMATCH_OWNER_RULE && ATTENTION_MAP.MISMATCH_OWNER_RULE.side === "OWNER");
  const cls = read("lib/project-classification.ts");
  ok("the classification module is pure (no DB / fetch / write)", !/supabase|fetch\(|\.insert\(|\.update\(|\.upsert\(/.test(cls.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  const drawer = read("components/ui/ProjectDrawerV2.tsx");
  const ctl = drawer.slice(drawer.indexOf("function BusinessTypeControl"));
  ok("drawer control: reads the roster (GET) on open, writes ONLY on an Owner click via the existing route", /fetch\("\/api\/label\/artists"\)/.test(ctl) && (ctl.match(/method: "PATCH"/g) ?? []).length === 1 && ctl.indexOf("method: \"PATCH\"") > ctl.indexOf("async function setType") && /\/api\/label\/projects\/\$\{project\.id\}\/business-type/.test(ctl) && /לפי כלל הבעלים זה פרויקט לייבל/.test(ctl));

  // fixture company with the REAL Shalev / Avi ids (P1 Shalev לייבל + release, P2 Avi לקוח, P3 Avi+Shalev collab לקוח,
  // P4 נגש ביטס לקוח, P7 "אמן זר" לייבל)
  const st = input({ contexts: [] }).state!;
  const remap = (id: string | null) => (id === LA_SHALEV ? SHALEV_ARTIST_ID : id === LA_AVI ? AVI_ARTIST_ID : id);
  for (const a of st.domains.labelArtists.data!.items as Array<{ id: string }>) a.id = remap(a.id)!;
  for (const r of (st.domains.releasesFull.data?.items ?? []) as Array<{ labelArtistId: string | null }>) r.labelArtistId = remap(r.labelArtistId);
  const src = { now: NOW, identities: { cleantone: null }, state: { status: "OK", value: st }, cases: { status: "OK", value: [] }, actions: { status: "OK", value: [] }, outcomes: { status: "OK", value: [] }, ownerKnowledge: { status: "OK", value: [] } } as unknown as GatewaySources;
  const idx = st.domains.projects.data!.index as Record<string, { businessType: string; status: string }>;
  const pids = [P(1), P(2), P(3), P(4), P(7)];
  const sigs = (pid: string) => buildProjectView(src, pid).signals.map((s) => s.code);
  ok("project view: MISMATCH on Avi solo (P2) and the Avi+Shalev collab (P3)", sigs(P(2)).includes(MISMATCH_OWNER_RULE) && sigs(P(3)).includes(MISMATCH_OWNER_RULE), { p2: sigs(P(2)), p3: sigs(P(3)) });
  ok("project view: no MISMATCH for stored לייבל (P1, P7) or נגש ביטס (P4)", ![P(1), P(7), P(4)].some((p) => sigs(p).includes(MISMATCH_OWNER_RULE)));
  ok("project view: נגש ביטס (roster, not covered) is only a weak TEXT_MATCH hint, never a mismatch", sigs(P(4)).includes("LABEL_CLASSIFICATION_UNCLEAR") && ATTENTION_MAP.LABEL_CLASSIFICATION_UNCLEAR.nature === "CONTEXT");
  const opLabel = (pid: string) => projectOperating(src, pid)?.label.labelWork;
  ok("operating view: labelWork === stored type for every project (release row / roster are evidence only)", pids.every((pid) => opLabel(pid) === (idx[pid].businessType === "לייבל")), pids.map((pid) => [idx[pid].businessType, opLabel(pid)]));
  ok("operating view: the mismatch is carried as evidence, not as labelWork", projectOperating(src, P(2))?.label.labelEvidence.ownerRuleMismatch === true && projectOperating(src, P(2))?.label.labelWork === false);
  const av = buildArtistView(src, AVI_ARTIST_ID)!;
  ok("label view (Avi): labelWork === stored type on every project", av.projects.length >= 2 && av.projects.every((p) => p.labelWork === (p.businessType === "לייבל")) && av.projects.find((p) => p.id === P(3))?.labelEvidence.ownerRuleMismatch === true);
  const sv = buildArtistView(src, SHALEV_ARTIST_ID)!;
  ok("label view (Shalev): stored לייבל + release = label; collab stored לקוח stays not-label with the evidence", sv.projects.find((p) => p.id === P(1))?.labelWork === true && sv.projects.find((p) => p.id === P(3))?.labelWork === false);
  ok("label view: portal by id → CANONICAL", /CANONICAL \(label_artists\.id/.test(String(sv.identity.portal.link)));
  let company: ReturnType<typeof buildCompanyView> | null = null;
  try { company = buildCompanyView(src); } catch (e) { ok("company view builds on the fixture", false, String(e)); }
  if (company) {
    const open = Object.values(idx).filter((p) => !["הושלם", "בוטל"].includes(p.status));
    const ex = company.executive as { labelProjectsOpen: number; clientProjectsOpen: number; unclassifiedProjectsOpen: number };
    ok("company view: label / client counts = the stored type (unknown never counted as label)", ex.labelProjectsOpen === open.filter((p) => p.businessType === "לייבל").length && ex.clientProjectsOpen === open.filter((p) => p.businessType === "לקוח").length && ex.unclassifiedProjectsOpen === 0, ex);
  }
  const cv = read("lib/partner/company/view.ts");
  ok("company view no longer counts 'not לקוח' as label", !/businessType !== "לקוח"/.test(cv) && /isLabelProject\(p\)/.test(cv));

  section("4. /label convert-to-release list");
  const lp = read("components/label/LabelPage.tsx");
  const modal = lp.slice(lp.indexOf("function MarkExistingModal"), lp.indexOf("function MarkExistingModal") + 3000);
  ok("filters 'no release row' (the server guard) — not businessType, so classified label projects stay convertible", /!releasedProjectIds\.has\(p\.id\)/.test(modal) && !/businessType !== "לייבל"/.test(modal));
  ok("releasedProjectIds = projects that HAVE a release row", /releases \?\? \[\]\)\.filter\(\(r\) => r\.release\)\.map\(\(r\) => r\.projectId\)/.test(lp));
  // simulate the filter on label projects with / without a release
  const rows = [{ id: "a", businessType: "לייבל", projectType: "שיר" }, { id: "b", businessType: "לייבל", projectType: "שיר" }, { id: "c", businessType: "לקוח", projectType: "שיר" }];
  const released = new Set(["b"]);
  ok("a label project without a release is listed; one with a release is not", rows.filter((p) => !released.has(p.id)).map((p) => p.id).join() === "a,c");

  section("5. B4 — portal identity by id; renamed artist; name-only fallback is AMBIGUOUS");
  ok("Shalev / Avi are id-registered", PORTAL_ARTISTS_BY_ID[SHALEV_ARTIST_ID]?.slug === "shalev-tasama" && PORTAL_ARTISTS_BY_ID[AVI_ARTIST_ID]?.slug === "avi-molla" && registeredIdForPortalName("שליו טסמה") === SHALEV_ARTIST_ID);
  const byId = resolvePortalIdentity({ id: SHALEV_ARTIST_ID, name: "שליו טסמה" });
  ok("resolve by id → CANONICAL", byId?.basis === "ID" && byId.quality === "CANONICAL" && byId.slug === "shalev-tasama");
  const renamed = resolvePortalIdentity({ id: AVI_ARTIST_ID, name: "Avi M" });
  ok("renamed artist (same id, new name) still resolves to his portal", renamed?.slug === "avi-molla" && renamed.basis === "ID");
  const clean = resolvePortalIdentity({ id: "00000000-0000-4000-8000-000000000903", name: "DJ CLEANTONE" });
  ok("an artist without a code-registered id resolves by exact name, flagged AMBIGUOUS", clean?.slug === "dj-cleantone" && clean.basis === "NAME_FALLBACK" && clean.quality === "AMBIGUOUS");
  ok("strict (access): another id carrying 'שליו טסמה' never inherits Shalev's portal", resolvePortalIdentity({ id: "00000000-0000-4000-8000-000000000999", name: "שליו טסמה" }) === null);
  ok("non-strict (display): the same case is shown as AMBIGUOUS, not canonical", resolvePortalIdentity({ id: "00000000-0000-4000-8000-000000000999", name: "שליו טסמה" }, { strict: false })?.quality === "AMBIGUOUS");
  ok("unknown name → no portal", resolvePortalIdentity({ id: "00000000-0000-4000-8000-000000000997", name: "מישהו" }) === null);
  const pc = read("lib/red-artists/portal-config.ts");
  ok("portal-config resolves id-first (resolvePortalIdentity) and by-name resolves the registered id first", /resolvePortalIdentity\(\{ id: artist\.id, name: artist\.name \}\)/.test(pc) && /registeredIdForPortalName\(name\)/.test(pc) && /getLabelArtist\(knownId\)/.test(pc));
  const pl = read("lib/red-artists/project-link.ts");
  ok("project-link uses the release label_artist_id first, primary-name fallback", /getReleaseDetails\(projectId\)/.test(pl) && pl.indexOf("RELEASE_ID") < pl.indexOf("primaryArtist(project.artist"));
  ok("portal-access.ts unchanged by B4 (no access-control edit)", !/resolvePortalIdentity|PORTAL_ARTISTS_BY_ID/.test(read("lib/red-artists/portal-access.ts")));

  section("6. B4 — project → label artist; show → ledger identity; rename disclosure");
  ok("release id → CANONICAL", labelArtistIdForProject({ releaseLabelArtistId: AVI_ARTIST_ID, artistText: "שליו טסמה" }, ROSTER).quality === "CANONICAL_RELATION");
  ok("single credit, no release → TEXT_MATCH", labelArtistIdForProject({ artistText: "נגש ביטס" }, ROSTER).quality === "TEXT_MATCH");
  const col = labelArtistIdForProject({ artistText: "אבי מולה, שליו טסמה" }, ROSTER);
  ok("collab, no release → AMBIGUOUS, never guessed", col.quality === "AMBIGUOUS" && col.labelArtistId === null && col.candidates.length === 2);
  ok("no credited roster name → UNKNOWN", labelArtistIdForProject({ artistText: "זר" }, ROSTER).quality === "UNKNOWN");
  ok("show identity: single = TEXT_MATCH, collab = AMBIGUOUS, empty = UNKNOWN", showArtistIdentity("שליו טסמה").quality === "TEXT_MATCH" && showArtistIdentity("שליו טסמה, אבי מולה").status === "COLLAB_AMBIGUOUS" && showArtistIdentity("").status === "EMPTY");
  const sync = read("lib/artist-balance-show-sync.ts");
  ok("show → ledger sync uses the shared Shalev id constant and returns the identity evidence", /SHALEV_ARTIST_ID/.test(sync) && /Promise<ShowArtistIdentity>/.test(sync));
  const ren = LABEL_PRIMITIVES.find((p) => p.actionId === "RENAME_LABEL_ARTIST")!;
  const w = ren.warnings!({ name: "שליו טסמה", portalSlug: "shalev-tasama" } as never, {} as never);
  ok("RENAME_LABEL_ARTIST discloses every remaining name-keyed dependent", LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE.every((x) => w.includes(x)) && LABEL_ARTIST_RENAME_NAME_KEYED_DEPENDENTS_HE.length >= 5);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
