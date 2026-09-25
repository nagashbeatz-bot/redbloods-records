/**
 * Victor portal security: server-side authorization of every Victor work / file operation.
 *
 * The REAL route handlers run in-process against fakes:
 *  - require-auth: a fake session role;
 *  - Supabase: a fake PostgREST host serving an in-memory table;
 *  - Dropbox: a fake API host that records every call;
 *  - upload notices: a stub (no settings write, no push).
 * Nothing leaves the process, nothing touches production, and no real file is created or deleted.
 *
 * Scenarios A–N (the security mission) + the scope module on malicious paths + route-wiring guards.
 * Run with:   npx tsx scripts/test-victor-portal-security.tsx
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { normalizeDropboxPath, victorWorkRoot, isWithinRoot, uploadDestination, victorMayDelete, victorReadablePath, isWorkId, statsForVictor } from "../lib/victor-scope";
import { isVictorAllowedPath, isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath } from "../lib/roles";
import type { FileLink } from "../lib/types";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); fail++; }
}
const ok = (name: string, cond: boolean) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };
const ROOT = path.resolve(__dirname, "..");
const rd = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ── fixtures ──
const W1 = "11111111-1111-4111-8111-111111111111"; // Victor, linked project
const W2 = "22222222-2222-4222-8222-222222222222"; // Victor, standalone
const W3 = "33333333-3333-4333-8333-333333333333"; // another vendor's work
const W4 = "44444444-4444-4444-8444-444444444444"; // Victor work whose stored folder was tampered (pre-fix)
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F1 = "/Projects/Artist A/Song A/Victor";
const f = (p: string, extra: Partial<FileLink> = {}): FileLink => ({ name: p.split("/").pop()!, url: `/api/dropbox/stream?path=${encodeURIComponent(p)}`, dropboxPath: p, dropboxShareUrl: "https://www.dropbox.com/s/public-link", uploadedAt: "2026-09-20T10:00:00Z", ...extra });
const VICTOR_FILE = f(`${F1}/Production/V1 beat.wav`, { uploadedBy: "victor", versionLabel: "V1" });
const OWNER_FILE = f(`${F1}/Production/V1 owner ref.wav`, { uploadedBy: "owner", versionLabel: "V1" });
const LEGACY_FILE = f(`${F1}/Production/V0 old.wav`, { versionLabel: "V0" });
const TAMPERED_FILE = f("/Projects/Other Artist/Secret Album/master.wav", { uploadedBy: "victor" }); // written by a pre-fix PATCH
const BRIEF_FILE = f(`${F1}/00_Brief/ref.mp3`);
function freshDb(): Record<string, Array<Record<string, unknown>>> {
  return {
    vendor_project_work: [
      { id: W1, vendor_name: "victor", project_id: P1, title: "Song A beat", status: "פעיל", work_state: "נשלח לויקטור", dropbox_folder: F1, dropbox_share_link: "https://www.dropbox.com/sh/folder-link", files_sent: [VICTOR_FILE, OWNER_FILE, LEGACY_FILE, TAMPERED_FILE], files_received: [], brief_files: [BRIEF_FILE], version_reviews: {}, notes: "owner-internal", sent_date: "2026-09-18", created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
      { id: W2, vendor_name: "victor", project_id: null, title: "Beat", status: "פעיל", work_state: "נשלח לויקטור", dropbox_folder: "/Projects/Victor/Beat", dropbox_share_link: null, files_sent: [f("/Projects/Victor/Beat/Production/b.wav", { uploadedBy: "victor" })], files_received: [], brief_files: [], version_reviews: {}, notes: "", sent_date: "2026-09-18", created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
      { id: W3, vendor_name: "other", project_id: null, title: "Not Victor", status: "פעיל", work_state: null, dropbox_folder: "/Projects/Victor/NotVictor", dropbox_share_link: null, files_sent: [f("/Projects/Victor/NotVictor/Production/x.wav", { uploadedBy: "victor" })], files_received: [], brief_files: [], version_reviews: {}, notes: "", sent_date: null, created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
      { id: W4, vendor_name: "victor", project_id: null, title: "Tampered", status: "פעיל", work_state: null, dropbox_folder: "/Projects/Other Artist/Secret Album", dropbox_share_link: null, files_sent: [], files_received: [], brief_files: [], version_reviews: {}, notes: "", sent_date: null, created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
    ],
    projects: [{ id: P1, name: "Song A", artist: "Artist A" }],
    settings: [],
  };
}
let db = freshDb();

// ── fakes ──
process.env.SUPABASE_URL = "https://fake-supabase.test";
process.env.SUPABASE_SECRET_KEY = "test-only";
process.env.DROPBOX_ACCESS_TOKEN = "fake-dropbox-token";
const dbWrites: Array<{ method: string; table: string; query: string; body: unknown }> = [];
const dropboxCalls: Array<{ endpoint: string; path: string | null }> = [];
const decodeArg = (h: string | null) => { try { return h ? JSON.parse(h) : null; } catch { return null; } };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.host === "fake-supabase.test") {
    const table = url.pathname.split("/").pop()!;
    let rows = [...(db[table] ?? [])];
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
    }
    if (method === "GET" || method === "HEAD") return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    dbWrites.push({ method, table, query: url.search, body });
    if (method === "PATCH") for (const r of rows) Object.assign(r, body);
    return new Response(null, { status: 204 });
  }
  if (url.host === "api.dropboxapi.com" || url.host === "content.dropboxapi.com") {
    const endpoint = url.pathname.replace(/^\/2\//, "");
    const jsonBody = init?.body && typeof init.body === "string" ? (() => { try { return JSON.parse(init.body as string); } catch { return null; } })() : null;
    const arg = decodeArg((init?.headers as Record<string, string> | undefined)?.["Dropbox-API-Arg"] ?? null);
    const p = (jsonBody?.path as string) ?? (arg?.path as string) ?? (arg?.commit?.path as string) ?? null;
    dropboxCalls.push({ endpoint, path: p });
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (endpoint === "files/get_temporary_link") return j({ link: "https://dl.dropboxusercontent.test/tmp" });
    if (endpoint === "files/upload" || endpoint === "files/upload_session/finish") return j({ path_display: p, name: String(p).split("/").pop() });
    if (endpoint === "files/upload_session/start") return j({ session_id: "sess-1" });
    if (endpoint === "sharing/create_shared_link_with_settings") return j({ url: "https://www.dropbox.com/s/new-public-link" });
    return j({});
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const auth = { role: "victor" as "owner" | "victor" | "steven" | "unknown" | "none" };
const denyUnless = (allowed: string[]) => async () => auth.role === "none" ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : allowed.includes(auth.role) ? null : NextResponse.json({ error: "forbidden" }, { status: 403 });
const notices: string[] = [];
const ML = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const origLoad = ML._load;
ML._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (/lib\/require-auth$/.test(request)) return {
    requireOwner: denyUnless(["owner"]), requireVictorAccess: denyUnless(["owner", "victor"]), requireAuth: denyUnless(["owner", "victor", "steven"]),
    async getAuthRole() { return auth.role === "none" ? null : auth.role; }, async getAuthUser() { return auth.role === "none" ? null : { id: "u", email: "x@test" }; },
  };
  if (/lib\/victor-upload-notify$/.test(request)) return { async queueVictorUploadNotice(workId: string) { notices.push(workId); }, async flushDueVictorUploadNotices() {} };
  return origLoad.call(this, request, parent, isMain);
};

const reset = () => { db = freshDb(); dbWrites.length = 0; dropboxCalls.length = 0; notices.length = 0; };
const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
const json = (u: string, method: string, body: unknown) => req(u, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ref: (p: string) => string = () => "";
const bodyOf = async (r: Response) => { try { return await r.clone().json(); } catch { return null; } };
const deletes = () => dropboxCalls.filter((c) => c.endpoint === "files/delete_v2").map((c) => c.path);
const uploads = () => dropboxCalls.filter((c) => c.endpoint === "files/upload" || c.endpoint === "files/upload_session/finish").map((c) => c.path);

async function main() {
  const { fileRefOf } = await import("../lib/victor-files");
  ref = (p: string) => fileRefOf(p);
  const workRoute = await import("../app/api/vendor/victor/work/[id]/route");
  const byProject = await import("../app/api/vendor/victor/work/route");
  const listRoute = await import("../app/api/vendor/victor/route");
  const fileRoute = await import("../app/api/vendor/victor/work/[id]/file/route");
  const stream = await import("../app/api/vendor/victor/stream/route");
  const download = await import("../app/api/vendor/victor/download/route");
  const upload = await import("../app/api/dropbox/vendor-upload/route");
  const chunk = await import("../app/api/dropbox/vendor-upload/chunk/route");
  const folder = await import("../app/api/dropbox/vendor-folder/route");
  const avatar = await import("../app/api/vendor/victor/avatar/route");
  const rawStream = await import("../app/api/dropbox/stream/route");
  const rawDelete = await import("../app/api/dropbox/delete/route");
  const rawShare = await import("../app/api/dropbox/share-link/route");

  console.log("\nscope module — normalization + malicious paths (G, H)");
  check("canonical Victor folders accepted (linked + standalone)", [victorWorkRoot(F1), victorWorkRoot("/Projects/Victor/Beat"), victorWorkRoot("/projects/artist/song/VICTOR")], [F1, "/Projects/Victor/Beat", "/projects/artist/song/VICTOR"]);
  check("non-Victor / Owner folders refused", ["/Projects/Artist A/Song A", "/Projects", "/", "/Projects/Other Artist/Secret Album", "/Victor/x", "/Projects/Victor", "/Projects/a/b/c/Victor", "Projects/Victor/Beat", ""].map(victorWorkRoot), [null, null, null, null, null, null, null, null, null]);
  const evil = [`${F1}/../../Other Artist/Secret Album/master.wav`, `${F1}/./Production/x.wav`, `${F1}/.../x.wav`, `${F1}/. ./x.wav`, `${F1}/.. /x.wav`, `${F1}//x.wav`, `${F1}\\..\\x.wav`, `${F1}/Production/x.wav\u0000.jpg`, `${F1}/Production/x\n.wav`, "Projects/Artist A/Song A/Victor/x.wav", `${F1}/`, "x".repeat(2000)];
  check("G. traversal-style paths fail closed", evil.map(normalizeDropboxPath), evil.map(() => null));
  check("G. …and are never inside the work folder", evil.map((p) => isWithinRoot(p, F1)), evil.map(() => false));
  check("H. alternate representations: case-insensitive match stays inside; prefix look-alikes stay outside", [isWithinRoot(`${F1.toUpperCase()}/PRODUCTION/x.wav`, F1), isWithinRoot(`${F1}2/x.wav`, F1), isWithinRoot(`${F1} copy/x.wav`, F1), isWithinRoot(F1, F1), isWithinRoot("/Projects/Artist A/Song A/Victor%2F..%2Fx.wav", F1)], [true, false, false, false, false]);
  check("H. Unicode NFC / NFD forms of the same folder compare equal; the folder itself is not a file", [isWithinRoot("/Projects/Café/Song/Victor/x.wav".normalize("NFD"), "/Projects/Café/Song/Victor"), isWithinRoot("/Projects/Café/Song/Victor", "/Projects/Café/Song/Victor")], [true, false]);
  check("upload destination: Victor buckets only; names sanitized; never outside", [uploadDestination(F1, "Production", "V2 beat.wav", "victor"), uploadDestination(F1, "02_From_Victor", "a/../b.wav", "victor"), uploadDestination(F1, "03_Approved", "x.wav", "victor"), uploadDestination(F1, "../..", "x.wav", "victor"), uploadDestination(F1, "Production", "..", "victor"), uploadDestination("/Projects/Other Artist/Secret Album", "Production", "x.wav", "victor"), uploadDestination(F1, "03_Approved", "x.wav", "owner")], [`${F1}/Production/V2 beat.wav`, `${F1}/02_From_Victor/a_.._b.wav`, null, null, null, null, `${F1}/03_Approved/x.wav`]);
  check("work ids must be UUIDs", [isWorkId(W1), isWorkId("1"), isWorkId("../x"), isWorkId(`${W1}' or 1=1`), isWorkId(null)], [true, false, false, false, false]);
  const w1 = { vendorName: "victor", dropboxFolder: F1, filesSent: [VICTOR_FILE, OWNER_FILE, LEGACY_FILE, TAMPERED_FILE], filesReceived: [], briefFiles: [BRIEF_FILE] };
  check("delete rule: only Victor's own upload inside the folder", [victorMayDelete(w1, VICTOR_FILE), victorMayDelete(w1, OWNER_FILE), victorMayDelete(w1, LEGACY_FILE), victorMayDelete(w1, TAMPERED_FILE), victorMayDelete({ ...w1, vendorName: "other" }, VICTOR_FILE)], [true, false, false, false, false]);
  check("read rule: listed entry AND inside the folder", [victorReadablePath(w1, VICTOR_FILE.dropboxPath!), victorReadablePath(w1, BRIEF_FILE.dropboxPath!), victorReadablePath(w1, TAMPERED_FILE.dropboxPath!), victorReadablePath(w1, `${F1}/Production/not-listed.wav`)], [VICTOR_FILE.dropboxPath, BRIEF_FILE.dropboxPath, null, null]);

  console.log("\nA. Victor can access his legitimate work");
  reset(); auth.role = "victor";
  {
    const r = await workRoute.GET(req(`/api/vendor/victor/work/${W1}`), ctx(W1));
    const b = await bodyOf(r);
    ok("GET own work → 200, sanitized (no project / folder / link / notes / paths)", r.status === 200 && b.work.projectId === null && b.work.dropboxFolder === null && b.work.dropboxShareLink === null && b.work.notes === "" && !JSON.stringify(b.work).includes("/Projects/") && !JSON.stringify(b.work).includes("dropbox.com"));
    const own = b.work.filesSent.find((x: FileLink) => x.fileRef === ref(VICTOR_FILE.dropboxPath!));
    check("delete flag only on his own upload", b.work.filesSent.map((x: FileLink) => !!x.deletable), [true, false, false, false]);
    const s = await stream.GET(req(`/api/vendor/victor/stream?workId=${W1}&fileRef=${own.fileRef}`));
    const d = await download.GET(req(`/api/vendor/victor/download?workId=${W1}&fileRef=${own.fileRef}`));
    check("stream + download own file → 302 to a temporary link", [s.status, d.status, dropboxCalls.filter((c) => c.endpoint === "files/get_temporary_link").map((c) => c.path)], [302, 302, [VICTOR_FILE.dropboxPath, VICTOR_FILE.dropboxPath]]);
    const bf = await stream.GET(req(`/api/vendor/victor/stream?workId=${W1}&fileRef=${ref(BRIEF_FILE.dropboxPath!)}`));
    check("brief file in the work folder streams", bf.status, 302);
    const list = await bodyOf(await listRoute.GET(req("/api/vendor/victor?month=2026-09")));
    ok("work list → only Victor rows, sanitized", list.work.length === 3 && list.work.every((w: { projectId: unknown; dropboxFolder: unknown }) => w.projectId === null && w.dropboxFolder === null));
  }

  console.log("\nB. Victor cannot retrieve another / unrelated work by changing identifiers");
  reset(); auth.role = "victor";
  {
    const other = await workRoute.GET(req(`/api/vendor/victor/work/${W3}`), ctx(W3));
    const malformed = await workRoute.GET(req("/api/vendor/victor/work/..%2Fsettings"), ctx("../settings"));
    const byProj = await byProject.GET(req(`/api/vendor/victor/work?projectId=${P1}`));
    check("another vendor's work → 404; malformed id → 404; lookup by project id → 403", [other.status, malformed.status, byProj.status], [404, 404, 403]);
    const crossRef = await stream.GET(req(`/api/vendor/victor/stream?workId=${W2}&fileRef=${ref(VICTOR_FILE.dropboxPath!)}`));
    const otherVendor = await download.GET(req(`/api/vendor/victor/download?workId=${W3}&fileRef=${ref("/Projects/Victor/NotVictor/Production/x.wav")}`));
    check("a file ref from another work, or another vendor's work → 403", [crossRef.status, otherVendor.status, dropboxCalls.length], [403, 403, 0]);
    const patch = await workRoute.PATCH(json(`/api/vendor/victor/work/${W1}`, "PATCH", { dropboxFolder: "/Projects/Other Artist/Secret Album" }), ctx(W1));
    const patchFiles = await workRoute.PATCH(json(`/api/vendor/victor/work/${W1}`, "PATCH", { filesSent: [TAMPERED_FILE] }), ctx(W1));
    const patchLink = await workRoute.PATCH(json(`/api/vendor/victor/work/${W1}`, "PATCH", { dropboxShareLink: "x" }), ctx(W1));
    check("Victor PATCH of folder / files / link → 403, nothing written", [patch.status, patchFiles.status, patchLink.status, dbWrites.length], [403, 403, 403, 0]);
  }

  console.log("\nC. Victor cannot list / point at an unauthorized Dropbox path");
  reset(); auth.role = "victor";
  {
    const vf = await folder.POST(json("/api/dropbox/vendor-folder", "POST", { vendorName: "victor", useProjectsLayout: true, projectId: P1, projectName: "Secret Album", artistName: "Other Artist" }));
    check("folder builder (creates folders + a public link) → 403 for Victor, no Dropbox call", [vf.status, dropboxCalls.length], [403, 0]);
    check("proxy: Victor may not reach the folder builder, the raw storage routes or the Owner delete", ["/api/dropbox/vendor-folder", "/api/dropbox/stream", "/api/dropbox/delete", "/api/dropbox/share-link", "/api/dropbox/upload", "/api/dropbox/intake", "/api/dropbox/status", "/api/dropbox/vendor-delete", "/api/dropbox/folder-link"].map(isVictorAllowedPath), [false, false, false, false, false, false, false, false, false]);
    const rs = await rawStream.GET(req(`/api/dropbox/stream?path=${encodeURIComponent("/Projects/Other Artist/Secret Album/master.wav")}`));
    check("raw storage stream is Owner-only in-route too (not only the proxy)", [rs.status, dropboxCalls.length], [403, 0]);
  }

  console.log("\nD. Victor cannot read / download an unauthorized file");
  reset(); auth.role = "victor";
  {
    const tamperedRef = ref(TAMPERED_FILE.dropboxPath!);
    const a = await stream.GET(req(`/api/vendor/victor/stream?workId=${W1}&fileRef=${tamperedRef}`));
    const b = await download.GET(req(`/api/vendor/victor/download?workId=${W1}&fileRef=${tamperedRef}`));
    const c = await stream.GET(req(`/api/vendor/victor/stream?path=${encodeURIComponent(TAMPERED_FILE.dropboxPath!)}`));
    const d = await stream.GET(req(`/api/vendor/victor/stream?path=${encodeURIComponent("/Projects/Other Artist/Secret Album/stems.zip")}`));
    const e = await stream.GET(req(`/api/vendor/victor/stream?path=${encodeURIComponent(`${F1}/../../Other Artist/Secret Album/master.wav`)}`));
    check("a stored entry outside the work folder, an unlisted path, a traversal path → 403; no Dropbox call", [a.status, b.status, c.status, d.status, e.status, dropboxCalls.length], [403, 403, 403, 403, 403, 0]);
  }

  console.log("\nE. Victor cannot upload into an unauthorized path");
  reset(); auth.role = "victor";
  {
    const up = (workId: string, sub: string, name: string, extra: Record<string, string> = {}) => { const fd = new FormData(); fd.append("file", new File([new Uint8Array([1, 2, 3])], name)); fd.append("workId", workId); fd.append("subFolder", sub); fd.append("dropboxFolder", "/Projects/Other Artist/Secret Album"); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return upload.POST(req("/api/dropbox/vendor-upload", { method: "POST", body: fd })); };
    const r1 = await up(W1, "Production", "x.wav"); // the client-sent dropboxFolder is ignored
    check("client-sent folder ignored: lands in the work's own Production folder", [r1.status, uploads()], [200, [`${F1}/Production/x.wav`]]);
    dropboxCalls.length = 0;
    const r2 = await up(W1, "03_Approved", "x.wav");
    const r3 = await up(W4, "Production", "x.wav");
    const r4 = await up(W3, "Production", "x.wav");
    const r5 = await up("../../etc", "Production", "x.wav");
    const r6 = await up(W1, "Production", "..");
    check("Owner bucket / tampered folder / other vendor / malformed id / '..' name → refused, nothing uploaded", [r2.status, r3.status, r4.status, r5.status, r6.status, uploads()], [403, 409, 409, 403, 403, []]);
    const cf = await chunk.POST(req(`/api/dropbox/vendor-upload/chunk?action=finish&workId=${W4}&sessionId=s&offset=0&subFolder=Production&name=x.wav`, { method: "POST", body: new Uint8Array([1]) }));
    const cb = await chunk.POST(req(`/api/dropbox/vendor-upload/chunk?action=finish&workId=${W1}&sessionId=s&offset=0&subFolder=03_Approved&name=x.wav`, { method: "POST", body: new Uint8Array([1]) }));
    check("chunked finish: tampered folder / Owner bucket → refused, nothing committed", [cf.status, cb.status, uploads()], [409, 403, []]);
  }

  console.log("\nF. Victor cannot delete an unauthorized file");
  reset(); auth.role = "victor";
  {
    const del = (id: string, fileRef: string) => fileRoute.DELETE(json(`/api/vendor/victor/work/${id}/file`, "DELETE", { fileRef }), ctx(id));
    const r = [await del(W1, ref(OWNER_FILE.dropboxPath!)), await del(W1, ref(LEGACY_FILE.dropboxPath!)), await del(W1, ref(TAMPERED_FILE.dropboxPath!)), await del(W1, ref(BRIEF_FILE.dropboxPath!)), await del(W3, ref("/Projects/Victor/NotVictor/Production/x.wav")), await del("not-a-uuid", "x")];
    check("Owner upload / legacy entry / outside the folder → 403; brief / other vendor / malformed → 404; no Dropbox delete, no DB write", [r.map((x) => x.status), deletes(), dbWrites.length], [[403, 403, 403, 404, 404, 404], [], 0]);
    const rawDel = await rawDelete.POST(json("/api/dropbox/delete", "POST", { path: OWNER_FILE.dropboxPath }));
    check("raw Dropbox delete route is Owner-only in-route", [rawDel.status, deletes()], [403, []]);
    const own = await del(W1, ref(VICTOR_FILE.dropboxPath!));
    const ob = await bodyOf(own);
    check("his own upload → deleted (Dropbox then the single entry), fresh sanitized record back", [own.status, deletes(), ob.work.filesSent.length, JSON.stringify(ob.work).includes("/Projects/")], [200, [VICTOR_FILE.dropboxPath], 3, false]);
  }

  console.log("\nI + J. unauthenticated / wrong role");
  reset();
  {
    const calls = async () => [
      (await workRoute.GET(req(`/api/vendor/victor/work/${W1}`), ctx(W1))).status,
      (await stream.GET(req(`/api/vendor/victor/stream?workId=${W1}&fileRef=${ref(VICTOR_FILE.dropboxPath!)}`))).status,
      (await download.GET(req(`/api/vendor/victor/download?workId=${W1}&fileRef=${ref(VICTOR_FILE.dropboxPath!)}`))).status,
      (await fileRoute.DELETE(json(`/api/vendor/victor/work/${W1}/file`, "DELETE", { fileRef: ref(VICTOR_FILE.dropboxPath!) }), ctx(W1))).status,
      (await folder.POST(json("/api/dropbox/vendor-folder", "POST", { vendorName: "victor" }))).status,
      (await rawStream.GET(req("/api/dropbox/stream?path=/x"))).status,
      (await rawShare.POST(json("/api/dropbox/share-link", "POST", { path: "/x" }))).status,
    ];
    auth.role = "none"; const none = await calls();
    auth.role = "steven"; const steven = await calls();
    auth.role = "unknown"; const unknown = await calls();
    check("I. unauthenticated → 401 everywhere", none, [401, 401, 401, 401, 401, 401, 401]);
    check("J. wrong role (Steven / unknown account) → 403 everywhere", [steven, unknown], [[403, 403, 403, 403, 403, 403, 403], [403, 403, 403, 403, 403, 403, 403]]);
    check("…and nothing reached Dropbox or the database", [dropboxCalls.length, dbWrites.length], [0, 0]);
    check("J. proxy: no other role reaches the Victor storage routes", [isStevenAllowedPath, isShalevAllowedPath, isCleantoneAllowedPath, isAviAllowedPath].flatMap((fn) => ["/api/vendor/victor/stream", "/api/dropbox/vendor-upload", "/api/dropbox/vendor-folder"].map(fn)), Array(12).fill(false));
  }

  console.log("\nK. Owner legitimate access still works");
  reset(); auth.role = "owner";
  {
    const g = await bodyOf(await workRoute.GET(req(`/api/vendor/victor/work/${W1}`), ctx(W1)));
    check("Owner gets the full record (project, folder, notes, paths)", [g.work.projectId, g.work.dropboxFolder, g.work.notes, g.work.filesSent[0].dropboxPath], [P1, F1, "owner-internal", VICTOR_FILE.dropboxPath]);
    const bp = await bodyOf(await byProject.GET(req(`/api/vendor/victor/work?projectId=${P1}`)));
    check("Owner lookup by project still works", bp.work?.id, W1);
    const p = await workRoute.PATCH(json(`/api/vendor/victor/work/${W1}`, "PATCH", { notes: "updated" }), ctx(W1));
    check("Owner PATCH still works", [p.status, dbWrites.length], [200, 1]);
    const od = await fileRoute.DELETE(json(`/api/vendor/victor/work/${W1}/file`, "DELETE", { fileRef: ref(OWNER_FILE.dropboxPath!) }), ctx(W1));
    check("Owner may delete any version file of the work (incl. legacy)", [od.status, deletes()], [200, [OWNER_FILE.dropboxPath]]);
    dropboxCalls.length = 0;
    const rs = await rawStream.GET(req(`/api/dropbox/stream?path=${encodeURIComponent(OWNER_FILE.dropboxPath!)}`));
    const fdr = new FormData(); fdr.append("file", new File([new Uint8Array([1])], "ref.wav")); fdr.append("workId", W1); fdr.append("subFolder", "01_From_Redbloods");
    const ou = await upload.POST(req("/api/dropbox/vendor-upload", { method: "POST", body: fdr }));
    const oub = await bodyOf(ou);
    check("Owner raw stream + upload into any plain bucket still work; Owner response keeps the full entry", [rs.status, ou.status, oub.file.dropboxPath, oub.file.uploadedBy], [302, 200, `${F1}/01_From_Redbloods/ref.wav`, "owner"]);
    const stats = await bodyOf(await listRoute.GET(req("/api/vendor/victor?month=2026-09")));
    ok("Owner stats keep salary / currency / payment status", "monthlySalary" in stats.stats && "salaryCurrency" in stats.stats && "paymentStatus" in stats.stats);
    const ov = await folder.POST(json("/api/dropbox/vendor-folder", "POST", { vendorName: "victor", useProjectsLayout: true, projectId: P1, projectName: "Song A", artistName: "Artist A" }));
    check("Owner folder builder still works", ov.status, 200);
  }

  console.log("\nL + N. upload response minimal; the legitimate upload / version flow works");
  reset(); auth.role = "victor";
  {
    const fd = new FormData(); fd.append("file", new File([new Uint8Array([1, 2])], "V2 beat.wav")); fd.append("workId", W1); fd.append("subFolder", "Production"); fd.append("versionLabel", "V2"); fd.append("total", "1");
    const r = await upload.POST(req("/api/dropbox/vendor-upload", { method: "POST", body: fd }));
    const b = await bodyOf(r);
    check("L. response file = name, versionLabel, uploadedAt, opaque fileRef, deletable — no path, no URL, no share link", [r.status, Object.keys(b.file).sort(), b.file.url, JSON.stringify(b).includes("/Projects/"), JSON.stringify(b).includes("dropbox.com")], [200, ["deletable", "fileRef", "name", "uploadedAt", "url", "versionLabel"], "", false, false]);
    const stored = (db.vendor_project_work.find((w) => w.id === W1)!.files_sent as FileLink[]).at(-1)!;
    check("N. stored entry keeps the full path + uploader; the owner notice was queued", [stored.dropboxPath, stored.uploadedBy, stored.versionLabel, notices], [`${F1}/Production/V2 beat.wav`, "victor", "V2", [W1]]);
    const s = await stream.GET(req(`/api/vendor/victor/stream?workId=${W1}&fileRef=${b.file.fileRef}`));
    const dl = await fileRoute.DELETE(json(`/api/vendor/victor/work/${W1}/file`, "DELETE", { fileRef: b.file.fileRef }), ctx(W1));
    check("N. the returned handle plays and Victor can delete his fresh upload", [s.status, dl.status], [302, 200]);
    reset(); auth.role = "victor";
    const st = await chunk.POST(req("/api/dropbox/vendor-upload/chunk?action=start", { method: "POST", body: new Uint8Array([1]) }));
    const fin = await chunk.POST(req(`/api/dropbox/vendor-upload/chunk?action=finish&workId=${W2}&sessionId=sess-1&offset=1&subFolder=Production&name=${encodeURIComponent("V3 big.wav")}&versionLabel=V3`, { method: "POST", body: new Uint8Array([2]) }));
    const fb = await bodyOf(fin);
    check("N. chunked upload still lands in the work folder; Victor gets the minimal file", [st.status, fin.status, uploads(), fb.file.dropboxPath, typeof fb.file.fileRef, fb.file.deletable], [200, 200, ["/Projects/Victor/Beat/Production/V3 big.wav"], undefined, "string", true]);
  }

  console.log("\nM. salary payload");
  reset(); auth.role = "victor";
  {
    const b = await bodyOf(await listRoute.GET(req("/api/vendor/victor?month=2026-09")));
    ok("Victor stats carry no salary / currency / payment status; the goal + counts remain", !("monthlySalary" in b.stats) && !("salaryCurrency" in b.stats) && !("paymentStatus" in b.stats) && "goal" in b.stats && "completed" in b.stats);
    check("pure stripper", Object.keys(statsForVictor({ goal: 12, monthlySalary: 550, salaryCurrency: "$", paymentStatus: "שולם", sent: 1 })), ["goal", "sent"]);
    const sal = isVictorAllowedPath("/api/vendor/victor/salary") || isVictorAllowedPath("/api/vendor/victor/settings");
    ok("salary + settings routes stay Owner-only at the proxy", !sal);
    const av = await bodyOf(await avatar.GET());
    ok("avatar payload carries no storage path", !("dropboxPath" in av) && "imageUrl" in av);
  }

  console.log("\nroute wiring (in-route guards; no proxy-only storage route)");
  {
    const first = (f: string, guard: string) => { const s = rd(f); const hs = [...s.matchAll(/export async function (GET|POST|DELETE|PATCH|PUT)\([^)]*\)[^{]*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*const denied = await (\w+)\(\)/g)]; const all = [...s.matchAll(/export async function (GET|POST|DELETE|PATCH|PUT)\(/g)]; return hs.length === all.length && hs.every((h) => h[2] === guard); };
    for (const f of ["app/api/dropbox/stream/route.ts", "app/api/dropbox/upload/route.ts", "app/api/dropbox/delete/route.ts", "app/api/dropbox/share-link/route.ts", "app/api/dropbox/intake/route.ts", "app/api/dropbox/status/route.ts", "app/api/dropbox/auth/route.ts", "app/api/dropbox/vendor-folder/route.ts", "app/api/dropbox/vendor-delete/route.ts", "app/api/dropbox/folder-link/route.ts", "app/api/vendor/victor/production-link/route.ts"]) ok(`${f}: requireOwner first in every handler`, first(f, "requireOwner"));
    const vr = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? vr(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
    const victorRoutes = [...vr("app/api/vendor/victor"), "app/api/dropbox/vendor-upload/route.ts", "app/api/dropbox/vendor-upload/chunk/route.ts"];
    const unguarded = victorRoutes.filter((f) => { const s = rd(f); const all = [...s.matchAll(/export async function (GET|POST|DELETE|PATCH|PUT)\(/g)].length; const g = [...s.matchAll(/export async function (GET|POST|DELETE|PATCH|PUT)\([^)]*\)[^{]*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*const denied = await (requireOwner|requireVictorAccess)\(\)/g)].length; return all !== g; });
    check("every Victor route checks the session in-route as its first statement", unguarded, []);
    ok("file routes use the scope module", ["app/api/vendor/victor/stream/route.ts", "app/api/vendor/victor/download/route.ts"].every((f) => /victorReadablePath\(/.test(rd(f))) && /victorMayDelete\(/.test(rd("app/api/vendor/victor/work/[id]/file/route.ts")) && ["app/api/dropbox/vendor-upload/route.ts", "app/api/dropbox/vendor-upload/chunk/route.ts"].every((f) => /uploadDestination\(/.test(rd(f)) && /isWithinRoot\(/.test(rd(f))) && /victorWorkRoot\(/.test(rd("lib/vendor-folder.ts")));
    ok("the Victor view hides delete on files he may not delete", /\(isOwner \|\| file\.deletable\) && /.test(rd("components/team/VictorProfilePage.tsx")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
