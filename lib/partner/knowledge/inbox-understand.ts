/**
 * owner_inbox modes "understand" / "deep" (Owner decisions 2026-10-01) — the SECOND preflight step, run only when mode
 * new found NEW updates. For each update: its SIGNALS, a deterministic business RESOLUTION (lib/partner/knowledge/
 * inbox-evidence: LIKELY / AMBIGUOUS / UNRESOLVED / NONE with typed evidence, contradictions, ≤2 alternatives, the most
 * specific entity chain) and a short canonical CONTEXT for the chosen project only. "deep" adds a WEAK free-text search
 * of project / session / task notes for names nothing else could place — called only after understand left one UNRESOLVED.
 * Pure, read-only, compact (processed business evidence, never raw records). Never a link, never a fact.
 */
import type { GatewaySources } from "../gateway/core";
import type { OwnerInboxItem } from "../../owner-inbox";
import { buildMentionIndex } from "./inbox-mentions";
import { type ResolverProject } from "./inbox-resolver";
import { graphOf, resolveUpdate, type UnderstoodUpdateV2 } from "./inbox-evidence";

const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);

/** The projects the resolver reasons over (status + artist credit + hidden), from the SAME live sources. */
export function resolverProjectsOf(src: GatewaySources): ResolverProject[] {
  const st = ok(src.state);
  const ops = ok(src.operations);
  const meta = new Map((ops?.projectsMeta?.rows ?? []).map((m) => [m.id, m]));
  return Object.entries(st?.domains.projects.data?.index ?? {}).map(([id, p]) => ({ key: `project:${id}`, name: p.name, status: p.status ?? null, artistText: p.artistText ?? null, hidden: meta.get(id)?.isHidden ?? null }));
}

const EMPTY_SIGNALS = { work: [], team: [], days: [], timeWords: [], numbers: [], reportsHappened: false, names: [] };
const failed = (itemId: string, why: string, stateRead: boolean): UnderstoodUpdateV2 & { stateRead: boolean } =>
  ({ itemId, signals: EMPTY_SIGNALS, resolution: { status: "UNRESOLVED", confidence: null, chosen: null, contradictions: [], alternatives: [], searched: [], missing: [why] }, context: null, stateRead });

export function understandUpdates(src: GatewaySources, items: readonly OwnerInboxItem[], deep = false): Array<UnderstoodUpdateV2 & { stateRead: boolean }> {
  if (!ok(src.state)) return items.map((i) => failed(i.id, "מצב החברה לא נקרא — לא נבדק מול הרשומות", false));
  const g = graphOf(src, buildMentionIndex(src), resolverProjectsOf(src));
  return items.map((i) => {
    try { return { ...resolveUpdate(i, g, deep), stateRead: true }; }
    catch { return failed(i.id, "לא הצלחתי לנתח את העדכון הזה מול הרשומות — הטקסט עצמו נקרא", true); }
  });
}
