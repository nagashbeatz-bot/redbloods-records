/**
 * Shared writers for the three company-wide backfills (idempotent, bulk). Each is split into PLAN (exactly which rows
 * would change) and APPLY (writes exactly those rows, each still guarded so it never overwrites a value set in the
 * meantime). Used by the backfill routes and by Sunny's BULK primitives. HARDENED (2026-09-27, Universal Actions):
 *   • start dates: the write is guarded by start_date IS NULL (it used to overwrite a value set meanwhile) and failures
 *     are reported (they used to be ignored);
 *   • artist clients: names created meanwhile are skipped (no duplicate client).
 */
import { supabase } from "@/lib/supabase";

// ── project start dates ← earliest session ──
export async function startDatePlan(): Promise<{ rows: Array<{ projectId: string; name: string; date: string }>; withoutSessions: number }> {
  const { data: projects, error } = await supabase.from("projects").select("id, name").is("start_date", null);
  if (error) throw new Error(error.message);
  const rows: Array<{ projectId: string; name: string; date: string }> = [];
  let withoutSessions = 0;
  for (const p of projects ?? []) {
    const { data: s, error: e2 } = await supabase.from("sessions").select("date").eq("project_id", p.id).not("date", "is", null).order("date", { ascending: true }).limit(1);
    if (e2) throw new Error(e2.message);
    const d = (s?.[0]?.date as string | undefined) ?? null;
    if (d) rows.push({ projectId: String(p.id), name: String(p.name ?? ""), date: d }); else withoutSessions++;
  }
  return { rows, withoutSessions };
}
export async function applyStartDates(rows: Array<{ projectId: string; date: string }>): Promise<{ updated: number; failed: number }> {
  let updated = 0, failed = 0;
  for (const r of rows) {
    const { data, error } = await supabase.from("projects").update({ start_date: r.date, updated_at: new Date().toISOString() }).eq("id", r.projectId).is("start_date", null).select("id");
    if (error) failed++; else if ((data ?? []).length) updated++;
  }
  return { updated, failed };
}

// ── clients ← every project artist name (type אמן) ──
export async function missingArtistClients(): Promise<{ all: number; missing: string[] }> {
  const { data: projects, error } = await supabase.from("projects").select("artist").neq("artist", "");
  if (error) throw new Error(error.message);
  const all = Array.from(new Set((projects ?? []).flatMap((p: { artist: string }) => String(p.artist ?? "").split(/[,،;]/).map((x) => x.trim()).filter(Boolean))));
  if (!all.length) return { all: 0, missing: [] };
  const { data: existing, error: e2 } = await supabase.from("clients").select("name").in("name", all);
  if (e2) throw new Error(e2.message);
  const have = new Set((existing ?? []).map((c: { name: string }) => c.name));
  return { all: all.length, missing: all.filter((n) => !have.has(n)) };
}
export async function createArtistClients(names: string[]): Promise<number> {
  if (!names.length) return 0;
  const { data: existing, error: e1 } = await supabase.from("clients").select("name").in("name", names);
  if (e1) throw new Error(e1.message);
  const have = new Set((existing ?? []).map((c: { name: string }) => c.name));
  const toCreate = names.filter((n) => !have.has(n));
  if (!toCreate.length) return 0;
  const { error } = await supabase.from("clients").insert(toCreate.map((name) => ({ name, phone: "", email: "", type: "אמן", status: "חדש", notes: "" })));
  if (error) throw new Error(error.message);
  return toCreate.length;
}

// ── freeze each project's canonical folder (rename-proof) ──
export async function folderFreezePlan(): Promise<Array<{ id: string; artist: string; name: string; current: string | null; computed: string; willSet: boolean }>> {
  const { projectBaseFolder } = await import("@/lib/project-paths");
  const { data, error } = await supabase.from("projects").select("id, artist, name, dropbox_folder").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; artist: string | null; name: string | null; dropbox_folder: string | null }>).map((p) => {
    const current = (p.dropbox_folder ?? "").trim();
    return { id: p.id, artist: p.artist ?? "", name: p.name ?? "", current: current || null, computed: projectBaseFolder(p.artist ?? "", p.name ?? "", p.id), willSet: !current };
  });
}
export async function applyFolderFreeze(rows: Array<{ id: string; computed: string }>): Promise<{ applied: Array<{ id: string; dropbox_folder: string }>; failed: Array<{ id: string; error: string }> }> {
  const applied: Array<{ id: string; dropbox_folder: string }> = [], failed: Array<{ id: string; error: string }> = [];
  for (const r of rows) {
    const { error } = await supabase.from("projects").update({ dropbox_folder: r.computed }).eq("id", r.id).is("dropbox_folder", null); // only when still null (race-safe, never overwrite)
    if (error) failed.push({ id: r.id, error: error.message }); else applied.push({ id: r.id, dropbox_folder: r.computed });
  }
  return { applied, failed };
}
