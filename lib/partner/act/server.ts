import "server-only";

/**
 * SUNNY UNIVERSAL ACTION LAYER — the REAL dependencies on Redbloods MAIN (server-only).
 * The writers are the SAME shared functions the Redbloods UI routes use; nothing here calls an internal API over HTTP,
 * and nothing here is a generic writer. Built lazily, only when the action endpoint is enabled and authenticated.
 */
import type { ActServiceDeps } from "./service";
import type { WriterDeps } from "./primitives";
import { knownSecretValues } from "./persist";
import { approvalKeyFrom, ACT_SECRET_ENV } from "./internal-handler";
import { ACTION_REGISTRY, ACTION_REGISTRY_VERSION } from "./registry";
import { supabaseActStores } from "./store-supabase";

const OWNER_CACHE_MS = 5 * 60_000;
const ownerCache = new Map<string, { ok: boolean; at: number }>();

export async function realWriterDeps(): Promise<WriterDeps> {
  const { getProject, updateProject } = await import("@/lib/projects-store");
  const { getReleaseDetails, updateReleaseDetails } = await import("@/lib/release-store");
  const { getSoundEngineerWork } = await import("@/lib/sound-engineer-store");
  const { listMixVersions, getMixVersion, updateMixVersion } = await import("@/lib/mix-versions-store");
  const { listMixComments, getMixComment, updateMixCommentStatus } = await import("@/lib/mix-comments-store");
  const { getLabelArtist, updateLabelArtist } = await import("@/lib/label-artists-store");
  const { getVictorWorkById, updateVictorWork } = await import("@/lib/vendor-store");
  type VPatch = Parameters<typeof updateVictorWork>[1];
  return {
    async readProject(id) {
      const p = await getProject(id);
      return p ? { name: p.name ?? "", notes: p.notes ?? "", startDate: p.startDate ?? null, plannedHours: p.plannedHours ?? null, plannedDays: p.plannedDays ?? null, projectType: p.projectType ?? "", parentProject: p.parentProject ?? "", deadline: p.deadline ?? null } : null;
    },
    writeProject: (id, patch) => updateProject(id, patch),
    async readRelease(projectId) {
      const r = await getReleaseDetails(projectId);
      if (!r) return null;
      const p = await getProject(projectId);
      return { projectName: p?.name ?? "", releaseStage: r.releaseStage, releaseTargetDate: r.releaseTargetDate, nextAction: r.nextAction ?? "", blocker: r.blocker ?? "", responsible: r.responsible ?? "", updatedAt: r.updatedAt };
    },
    async writeRelease(projectId, expectedUpdatedAt, patch) {
      const r = await updateReleaseDetails(projectId, expectedUpdatedAt, patch as Parameters<typeof updateReleaseDetails>[2]);
      return r.status === "ok" ? "ok" : r.status === "conflict" ? "conflict" : "not_found";
    },
    async readMixWork(id) { const w = await getSoundEngineerWork(id); return w ? { title: String((w as { workTitle?: string | null }).workTitle ?? "") } : null; },
    async listMixVersions(workId) { return (await listMixVersions(workId)).map((v) => ({ id: v.id, label: v.label, status: v.status, createdAt: v.createdAt })); },
    async listMixComments(workId) {
      const out: Array<{ id: string; versionId: string; versionLabel: string; text: string; status: string; timestampSeconds: number | null; createdAt: string }> = [];
      for (const v of await listMixVersions(workId)) for (const c of await listMixComments(v.id)) out.push({ id: c.id, versionId: v.id, versionLabel: v.label, text: c.commentText, status: c.status, timestampSeconds: c.timestampSeconds, createdAt: c.createdAt });
      return out;
    },
    async readMixComment(id) {
      const c = await getMixComment(id);
      if (!c) return null;
      const v = await getMixVersion(c.mixVersionId);
      return v ? { workId: v.soundEngineerWorkId, versionLabel: v.label, text: c.commentText, status: c.status } : null;
    },
    writeMixCommentStatus: async (id, status) => { await updateMixCommentStatus(id, status); },
    async readMixVersion(id) { const v = await getMixVersion(id); return v ? { workId: v.soundEngineerWorkId, label: v.label, status: v.status } : null; },
    writeMixVersion: async (id, patch) => { await updateMixVersion(id, patch); },
    async readLabelArtist(id) { const a = await getLabelArtist(id); return a ? { name: a.name, notes: a.notes ?? "", status: a.status } : null; },
    async writeLabelArtist(id, patch) { return (await updateLabelArtist(id, patch as Parameters<typeof updateLabelArtist>[1])).status; },
    async readVictorWork(id) {
      const w = await getVictorWorkById(id);
      return w ? { title: (w.title ?? "").trim() || w.projectName || "", vendorName: w.vendorName, workState: w.workState ?? null, outcome: w.outcome ?? null, notes: w.notes ?? "" } : null;
    },
    writeVictorWork: (id, patch) => updateVictorWork(id, patch as VPatch),
  };
}

export async function realActDeps(env: Record<string, string | undefined> = process.env): Promise<ActServiceDeps> {
  const secret = env[ACT_SECRET_ENV];
  if (!secret || secret.length < 32) throw new Error("act secret not configured");
  const { supabase } = await import("@/lib/supabase");
  const { roleForEmail } = await import("@/lib/roles");
  return {
    nowMs: () => Date.now(),
    approvalSecret: approvalKeyFrom(secret),
    registry: ACTION_REGISTRY, registryVersion: ACTION_REGISTRY_VERSION,
    stores: supabaseActStores(supabase),
    writers: await realWriterDeps(),
    knownSecrets: knownSecretValues(env),
    async isOwner(userId) {
      const hit = ownerCache.get(userId);
      if (hit && Date.now() - hit.at < OWNER_CACHE_MS) return hit.ok;
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      const ok = !error && !!data?.user && roleForEmail(data.user.email ?? null) === "owner";
      ownerCache.set(userId, { ok, at: Date.now() });
      return ok;
    },
  };
}
