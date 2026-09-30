/**
 * owner_inbox mode "understand" (Owner decision 2026-10-01) — the SECOND, heavier preflight step, run only when mode new
 * found NEW updates: for each update, the entities it names (partner_resolve's index through the mention matcher;
 * TEXT_MATCH / AMBIGUOUS — never a link) and, for at most 3 of them, SHORT canonical context so Sunny can think with the
 * records before she answers. Pure, read-only. Adds no rule: names = the resolver / mention matcher; an artist's projects =
 * the resolver's own open-credited rule; project facts = project_view; the live ball = project memory's projection.
 */
import type { GatewaySources } from "../gateway/core";
import type { OwnerInboxItem } from "../../owner-inbox";
import { buildMentionIndex, findMentions } from "./inbox-mentions";
import { openCreditedProjects, type ResolverProject } from "./inbox-resolver";
import { normalizeName } from "../gateway/resolve";
import { buildProjectView } from "../projects/view";
import { buildProjectMemory } from "../projects/memory";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
export const UNDERSTAND_MAX_CONTEXT = 3;
const MAX_KEYS = 8;

/** The projects the resolver reasons over (status + artist credit + hidden), from the SAME live sources. */
export function resolverProjectsOf(src: GatewaySources): ResolverProject[] {
  const st = ok(src.state);
  const ops = ok(src.operations);
  const meta = new Map((ops?.projectsMeta?.rows ?? []).map((m) => [m.id, m]));
  return Object.entries(st?.domains.projects.data?.index ?? {}).map(([id, p]) => ({ key: `project:${id}`, name: p.name, status: p.status ?? null, artistText: p.artistText ?? null, hidden: meta.get(id)?.isHidden ?? null }));
}

export interface UnderstandMention { name: string; quality: "TEXT_MATCH" | "AMBIGUOUS"; keys: string[]; openProjects: string[] }
export type EntityContext =
  | { key: string; kind: "project"; name: string; status: string | null; deadline: string | null; liveBall: string | null; lastRecordedEventAt: string | null;
      lastSession: string | null; nextSession: string | null; signals: string[]; understanding: { freshness: string; whatHappened: string; inferredNextStep: string | null } | null; via: "NAMED" | "ONLY_OPEN_PROJECT_OF_NAME" }
  | { key: string; kind: string; name: string; openProjects: number; unavailable?: true };
export interface UnderstoodUpdate { itemId: string; mentions: UnderstandMention[]; context: EntityContext[]; moreEntities: number; stateRead: boolean }

export function understandUpdates(src: GatewaySources, items: readonly OwnerInboxItem[]): UnderstoodUpdate[] {
  const st = ok(src.state);
  if (!st) return items.map((i) => ({ itemId: i.id, mentions: [], context: [], moreEntities: 0, stateRead: false }));
  const index = buildMentionIndex(src);
  const projects = resolverProjectsOf(src);
  const nameOf = new Map(index.map((e) => [e.key, e.name]));
  return items.map((i) => {
    const mentions: UnderstandMention[] = findMentions(i.body, index).map((m) => {
      const own = m.keys.some((k) => k.startsWith("project:")) ? [] : openCreditedProjects(normalizeName(m.name), projects).sort();
      return { name: m.name, quality: m.quality, keys: m.keys.slice(0, MAX_KEYS), openProjects: own.slice(0, MAX_KEYS) };
    });
    // context only for what the text points at without guessing: a named entity (TEXT_MATCH), and a project only when it is
    // the ONE open project of that name; AMBIGUOUS mentions carry their candidates only (Sunny proposes and asks)
    const picks: Array<{ key: string; via: "NAMED" | "ONLY_OPEN_PROJECT_OF_NAME" }> = [];
    for (const m of mentions.filter((x) => x.quality === "TEXT_MATCH")) {
      for (const k of m.keys.filter((x) => x.startsWith("project:"))) picks.push({ key: k, via: "NAMED" });
      if (m.openProjects.length === 1) picks.push({ key: m.openProjects[0], via: "ONLY_OPEN_PROJECT_OF_NAME" });
    }
    for (const m of mentions.filter((x) => x.quality === "TEXT_MATCH")) for (const k of m.keys.filter((x) => !x.startsWith("project:"))) picks.push({ key: k, via: "NAMED" });
    const uniq = picks.filter((p, n) => picks.findIndex((q) => q.key === p.key) === n);
    const context = uniq.slice(0, UNDERSTAND_MAX_CONTEXT).map((p): EntityContext => {
      if (!p.key.startsWith("project:")) {
        const nm = normalizeName(nameOf.get(p.key) ?? "");
        return { key: p.key, kind: p.key.slice(0, p.key.indexOf(":")), name: nameOf.get(p.key) ?? p.key, openProjects: nm ? openCreditedProjects(nm, projects).length : 0 };
      }
      const id = p.key.slice("project:".length);
      try { return projectContext(src, id, p, nameOf.get(p.key)); }
      catch { return { key: p.key, kind: "project", name: nameOf.get(p.key) ?? p.key, openProjects: 0, unavailable: true }; }
    });
    return { itemId: i.id, mentions, context, moreEntities: Math.max(0, uniq.length - UNDERSTAND_MAX_CONTEXT), stateRead: true };
  });
}

/** One project's short canonical context (project_view + project memory) — a failure here never hides the update. */
function projectContext(src: GatewaySources, id: string, p: { key: string; via: "NAMED" | "ONLY_OPEN_PROJECT_OF_NAME" }, fallbackName: string | undefined): EntityContext {
      const v = buildProjectView(src, id);
      const mem = buildProjectMemory(src, id);
      const sessions = v.work.sessions;
      return {
        key: p.key, kind: "project", name: v.identity?.name ?? fallbackName ?? p.key, status: v.identity?.status ?? null, deadline: v.identity?.deadline ?? null,
        liveBall: mem.canonical.ball, lastRecordedEventAt: mem.canonical.lastEventAt, lastSession: sessions?.last ?? null, nextSession: sessions?.next ?? null,
        signals: v.signals.map((s) => s.code).slice(0, 6),
        understanding: mem.understanding ? { freshness: mem.understanding.freshness, whatHappened: mem.understanding.whatHappened, inferredNextStep: mem.understanding.freshness === "CURRENT" ? mem.understanding.inferredNextStep : null } : null,
        via: p.via,
      };
}
