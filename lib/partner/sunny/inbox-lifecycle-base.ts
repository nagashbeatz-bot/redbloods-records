/**
 * Owner Inbox lifecycle — the BASE of one update from the sources owner_inbox already reads (no new reader, no store).
 * The decision itself is decideInboxLifecycle (inbox-lifecycle.ts) — ONE rule for the capability and the connector.
 */
import type { GatewaySources } from "../gateway/core";
import type { OwnerInboxItem } from "../../owner-inbox";
import type { UnderstoodUpdateV2 } from "../knowledge/inbox-evidence";
import { activeLinksOf, freshnessOf, type InboxMemory } from "../../inbox-memory";
import { activeKnowledge, type OwnerKnowledgeRecord } from "../owner-knowledge/store";
import { projectBasisOf } from "../projects/memory";
import { whatHappenedSince } from "./since";
import { decideInboxLifecycle, inboxExecutiveSummary, type InboxLifecycle, type InboxLifecycleBase } from "./inbox-lifecycle";
import { understandUpdates } from "../knowledge/inbox-understand";


const okv = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);
const CLOSED_PROJECT = new Set(["הושלם", "בוטל"]);

export function inboxLifecycleBaseOf(src: GatewaySources, item: OwnerInboxItem, understood: UnderstoodUpdateV2 | null, todayIL: string): InboxLifecycleBase {
  const mem = okv(src.inboxMemory) as InboxMemory | null;
  const linked = mem ? [...new Set(activeLinksOf(mem.links, (l) => l.itemId === item.id).map((l) => l.entityKey))] : [];
  const r = understood?.resolution ?? null;
  const likely = r?.status === "LIKELY" && r.chosen ? [...new Set(r.chosen.chain.filter((c) => (c.level === "PROJECT" || c.level === "VENDOR") && c.key).map((c) => c.key as string))].slice(0, 2) : [];
  const entityKeys = linked.length ? linked : likely;
  const entitySource: InboxLifecycleBase["entitySource"] = linked.length ? "LINKED" : likely.length ? "LIKELY" : "NONE";
  const technical = !!understood?.signals.work.includes("SYSTEM");
  // the item's own interpretation (latest by seq) and its freshness against the live project basis
  const own = mem ? mem.interpretations.filter((x) => x.itemId === item.id && !x.retractedAt && entityKeys.includes(x.entityKey)).sort((a, b) => b.seq - a.seq)[0] ?? null : null;
  const freshness = own ? freshnessOf(own, own.entityKey.startsWith("project:") ? projectBasisOf(src, own.entityKey.slice("project:".length)) : null) : null;
  const records = activeKnowledge((okv(src.ownerKnowledge) as OwnerKnowledgeRecord[] | null) ?? [], todayIL);
  const about = (k: OwnerKnowledgeRecord) => entityKeys.includes(k.subjectKey) || k.identityKeys.some((x) => entityKeys.includes(x)) || entityKeys.includes(String((k.value as Record<string, unknown>).about ?? ""));
  const onEntity = entityKeys.length ? records.filter(about) : [];
  const after = (k: OwnerKnowledgeRecord) => Date.parse(k.createdAt) >= Date.parse(item.createdAt);
  const st = okv(src.state);
  const statuses = entityKeys.filter((k) => k.startsWith("project:")).map((k) => st?.domains.projects.data?.index[k.slice(8)]?.status ?? null);
  return {
    itemId: item.id, writtenAt: item.createdAt, entityKeys, entitySource, technical,
    contradiction: freshness === "BALL_CONFLICT",
    understanding: own ? { id: own.id, freshness: freshness ?? "UNVERIFIED" } : null,
    knowledgeHomes: onEntity.filter(after).map((k) => ({ kind: "OWNER_KNOWLEDGE" as const, ref: k.id, he: k.meaningHe, at: k.createdAt })),
    relatedEarlier: onEntity.filter((k) => !after(k)).slice(0, 3).map((k) => ({ id: k.id, he: k.meaningHe, at: k.createdAt })),
    businessOpen: !statuses.length ? null : statuses.some((s) => s === null) ? null : statuses.some((s) => !CLOSED_PROJECT.has(s as string)),
    since: whatHappenedSince({ src, entityKeys, sinceIso: item.createdAt, itemId: item.id }),
  };
}

/** Every NEW update's lifecycle + the executive line — the ONE helper owner_inbox, company_view and the brief share. */
export function inboxTriageOf(src: GatewaySources): { read: boolean; items: Array<{ item: OwnerInboxItem; lifecycle: InboxLifecycle }>; summary: ReturnType<typeof inboxExecutiveSummary> | null } {
  const all = okv(src.ownerInbox) as OwnerInboxItem[] | null;
  if (!all) return { read: false, items: [], summary: null };
  const fresh = all.filter((i) => i.status === "NEW").sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (!fresh.length) return { read: true, items: [], summary: inboxExecutiveSummary([]) };
  // a source the resolver cannot read → "not checked" (never "no updates", never a thrown view)
  try {
    const u = new Map(understandUpdates(src, fresh, false).map((x) => [x.itemId, x]));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(src.now);
    const items = fresh.map((item) => ({ item, lifecycle: decideInboxLifecycle(inboxLifecycleBaseOf(src, item, u.get(item.id) ?? null, today)) }));
    return { read: true, items, summary: inboxExecutiveSummary(items.map((x) => x.lifecycle)) };
  } catch {
    return { read: false, items: [], summary: null };
  }
}
