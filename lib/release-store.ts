import "server-only";
import { supabase } from "./supabase";
import type {
  ProjectReleaseDetails,
  LabelRelease,
  ReleaseStage,
  ProjectStatus,
  ProjectType,
  ProjectBusinessType,
} from "./types";
import { RELEASE_STAGES } from "./types";

// ── DB row shape (public.project_release_details) ────────────────────────────
interface DbRelease {
  project_id:          string;
  release_stage:       string;
  release_target_date: string | null;
  next_action:         string;
  blocker:             string;
  responsible:         string;
  stage_entered_at:    string;
  released_at:         string | null;
  created_at:          string;
  updated_at:          string;
}

function mapRelease(db: DbRelease): ProjectReleaseDetails {
  return {
    projectId:         db.project_id,
    releaseStage:      db.release_stage as ReleaseStage,
    releaseTargetDate: db.release_target_date,
    nextAction:        db.next_action ?? "",
    blocker:           db.blocker ?? "",
    responsible:       db.responsible ?? "",
    stageEnteredAt:    db.stage_entered_at,
    releasedAt:        db.released_at,
    createdAt:         db.created_at,
    updatedAt:         db.updated_at,
  };
}

export function isValidStage(v: unknown): v is ReleaseStage {
  return typeof v === "string" && (RELEASE_STAGES as string[]).includes(v);
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** All label projects (business_type="לייבל", visible) joined with their release row (or null). */
export async function listLabelReleases(): Promise<LabelRelease[]> {
  const { data: projRows, error: pErr } = await supabase
    .from("projects")
    .select("id, name, artist, status, project_type, project_business_type")
    .eq("project_business_type", "לייבל")
    .eq("is_hidden", false)
    .order("created_at", { ascending: false });
  if (pErr) throw new Error(pErr.message);

  const projects = (projRows ?? []) as {
    id: string; name: string; artist: string; status: string;
    project_type: string; project_business_type: string;
  }[];
  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);
  const { data: relRows, error: rErr } = await supabase
    .from("project_release_details")
    .select("*")
    .in("project_id", ids);
  if (rErr) throw new Error(rErr.message);

  const byId = new Map<string, ProjectReleaseDetails>();
  for (const r of (relRows ?? []) as DbRelease[]) byId.set(r.project_id, mapRelease(r));

  return projects.map((p) => ({
    projectId:    p.id,
    name:         p.name,
    artist:       p.artist,
    projectType:  p.project_type as ProjectType,
    status:       p.status as ProjectStatus,
    businessType: p.project_business_type as ProjectBusinessType,
    release:      byId.get(p.id) ?? null,
  }));
}

export async function getReleaseDetails(projectId: string): Promise<ProjectReleaseDetails | null> {
  const { data, error } = await supabase
    .from("project_release_details")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRelease(data as DbRelease) : null;
}

// ── Guard: a release row may exist ONLY for a שיר + לייבל project ─────────────
type Guard = { ok: true; project: { project_type: string; project_business_type: string } } | { ok: false };
async function fetchProjectForGuard(projectId: string): Promise<Guard | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("project_type, project_business_type")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null; // project not found
  const p = data as { project_type: string; project_business_type: string };
  return p.project_type === "שיר" && p.project_business_type === "לייבל"
    ? { ok: true, project: p }
    : { ok: false };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface ReleaseInput {
  releaseStage?:      string;
  releaseTargetDate?: string | null;
  nextAction?:        string;
  blocker?:           string;
  responsible?:       string;
}

/**
 * Atomic: create a NEW project (project_type="שיר", project_business_type="לייבל")
 * + its project_release_details, in one PostgreSQL transaction via the RPC.
 * Returns the new project_id. No compensating delete in app code — the RPC rolls
 * back both inserts on any failure.
 */
export async function createLabelSongRelease(fields: {
  name: string; artist?: string; deadline?: string | null; notes?: string;
  parentProject?: string;
} & ReleaseInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_label_song_release", {
    p_name:                fields.name,
    p_artist:              fields.artist ?? "",
    p_deadline:            fields.deadline ?? null,
    p_notes:               fields.notes ?? "",
    p_parent_project:      fields.parentProject ?? "",
    p_release_stage:       fields.releaseStage ?? "רעיון",
    p_release_target_date: fields.releaseTargetDate ?? null,
    p_next_action:         fields.nextAction ?? "",
    p_blocker:             fields.blocker ?? "",
    p_responsible:         fields.responsible ?? "",
  });
  if (error) throw new Error(error.message);
  return data as string; // uuid
}

export type ReleaseWriteResult =
  | { status: "ok"; release: ProjectReleaseDetails }
  | { status: "not_found" }
  | { status: "not_label_song" }
  | { status: "exists" }
  | { status: "conflict" };

/** Create a release row for an EXISTING project (must be שיר + לייבל). */
export async function createReleaseForExisting(
  projectId: string,
  input: ReleaseInput,
): Promise<ReleaseWriteResult> {
  const guard = await fetchProjectForGuard(projectId);
  if (guard === null) return { status: "not_found" };
  if (!guard.ok) return { status: "not_label_song" };

  const existing = await getReleaseDetails(projectId);
  if (existing) return { status: "exists" };

  const { data, error } = await supabase
    .from("project_release_details")
    .insert({
      project_id:          projectId,
      release_stage:       input.releaseStage ?? "רעיון",
      release_target_date: input.releaseTargetDate ?? null,
      next_action:         input.nextAction ?? "",
      blocker:             input.blocker ?? "",
      responsible:         input.responsible ?? "",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { status: "ok", release: mapRelease(data as DbRelease) };
}

/**
 * Update release details with OPTIMISTIC LOCKING via `updated_at` compare-and-swap.
 * The guarded UPDATE's WHERE clause is the SOLE conflict authority — there is NO
 * `row.updated_at !== expected` comparison in JS, and NO automatic retry.
 * The pre-read is used ONLY to compute the derived stage_entered_at / released_at.
 */
export async function updateReleaseDetails(
  projectId: string,
  expectedUpdatedAt: string,
  patch: ReleaseInput,
): Promise<ReleaseWriteResult> {
  const current = await getReleaseDetails(projectId);
  if (!current) return { status: "not_found" };

  const nowIso = new Date().toISOString();
  const set: Record<string, unknown> = { updated_at: nowIso };

  if (patch.releaseTargetDate !== undefined) set.release_target_date = patch.releaseTargetDate || null;
  if (patch.nextAction        !== undefined) set.next_action = patch.nextAction ?? "";
  if (patch.blocker           !== undefined) set.blocker = patch.blocker ?? "";
  if (patch.responsible       !== undefined) set.responsible = patch.responsible ?? "";

  if (patch.releaseStage !== undefined) {
    const newStage = patch.releaseStage as ReleaseStage;
    set.release_stage = newStage;
    if (newStage !== current.releaseStage) {
      // Real stage change → reset the "time in stage" clock.
      set.stage_entered_at = nowIso;
      // released_at reflects the CURRENT release state (no history):
      if (newStage === "יצא" && current.releasedAt == null) set.released_at = nowIso;
      else if (newStage !== "יצא") set.released_at = null;
    }
  }

  // Guarded compare-and-swap. If 0 rows come back, someone else wrote first.
  const { data, error } = await supabase
    .from("project_release_details")
    .update(set)
    .eq("project_id", projectId)
    .eq("updated_at", expectedUpdatedAt)
    .select();
  if (error) throw new Error(error.message);

  if (!data || data.length === 0) return { status: "conflict" };
  return { status: "ok", release: mapRelease(data[0] as DbRelease) };
}

/** Change a project's business type (לקוח / לייבל). Keeps any dormant release row. */
export async function setProjectBusinessType(
  projectId: string,
  businessType: ProjectBusinessType,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("projects")
    .update({ project_business_type: businessType, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id");
  if (error) throw new Error(error.message);
  return !!(data && data.length > 0);
}
