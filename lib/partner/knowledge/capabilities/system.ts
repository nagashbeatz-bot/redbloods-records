/**
 * Sunny knowledge — SYSTEM AWARENESS: what Redbloods OS is, how it works, and what Sunny can / cannot do in it.
 * Served from the typed system contracts (lib/partner/system) — never from prompt assumptions. READ-ONLY, static per
 * deploy (versioned by SYSTEM_BASELINE_VERSION + the capability change log).
 */
import { BUSINESS_ACTIONS, CAPABILITY_CHANGES, coverageMatrix, DOMAIN_CONTRACTS, RELATIONSHIPS, servedDomain, SYSTEM_BASELINE_VERSION } from "../../system";
import { accessMatrix, PEOPLE_BASELINE_VERSION, personOfRole, PUSH_CONTRACTS, SECURITY_GAPS, servedPush, servedUser, USER_CONTRACTS } from "../../system/people-view";
import { PROJECT_BASELINE_VERSION, PROJECT_FIELDS, PROJECT_INTEGRITY, PROJECT_LINKS, PROJECT_MONEY_MODEL, PROJECT_PAGE_LOAD_EFFECTS, PROJECT_SIGNAL_MODEL, PROJECT_SURFACES, PROJECT_VOCABULARIES } from "../../system/projects";
import { DOMAIN_KNOWLEDGE_DEPTH, KNOWLEDGE_GAPS } from "../../system/gaps";
import { CALENDAR_CONTEXT_CONTRACT } from "../../system/calendar";
import { ACTION_CONTRACT_FIELDS, ACTION_FLOW, APPROVAL_CLASSES, PROJECT_ACTIONS } from "../../system/project-actions";
import * as CM from "../../system/clients";
import * as LM from "../../system/label-artists";
import * as SM from "../../system/shows";
import type { KnowledgeCapability } from "../types";
import { byCount, item, partner, result, sfact } from "./common";

const DOMAIN_IDS = DOMAIN_CONTRACTS.map((d) => d.id);
const SRC = "SYSTEM_CONTRACTS" as const;
const version = () => sfact("BASELINE_VERSION", "גרסת הידע על המערכת", SYSTEM_BASELINE_VERSION, "FACT", SRC);
const LAYERS = [
  "1 מצב החברה החי (פרויקטים, כספים, הופעות…) — נקרא ישירות מ-Redbloods.",
  "2 הידע על המערכת (איך Redbloods עובדת, כללים, קשרים, מה סאני יכול לעשות) — היכולת הזו.",
  "3 ידע ארגוני מהבעלים (כינויים, סיבות, עדיפויות) — owner_knowledge.",
];

export const systemAwareness: KnowledgeCapability = {
  id: "system_awareness", domain: "PARTNER", titleHe: "מה סאני יודע על Redbloods",
  descriptionForModel: "How Redbloods OS works and what Sunny can do in it, from the typed system contracts (not assumptions). Use for 'what do you know about shows?', 'can you create a show?', 'calendar access?', 'can you send push?', 'what can't you do?'. Modes: overview (domains + read/learn/propose/execute support), domain (purpose, canonical source, rules, side effects, notifications, limitations), rules (CONFLICT / POSSIBLE_BUG are reported problems, NOT policy), relationships (entity graph + relation quality), actions (every business mutation and whether Sunny may propose it), limitations, changes (capability change log), coverage. Execution by Sunny is unavailable everywhere; approvals happen in the Redbloods dashboard.",
  examplesHe: ["מה אתה יודע על מערכת ההופעות?", "אתה יכול ליצור הופעה?", "יש לך גישה ליומן?", "אתה יכול לשלוח Push?", "מה אתה יודע על העמוד של שליו?", "מה אתה לא יכול לעשות?", "מה חסר לך כדי לנהל את החברה?"],
  modes: {
    overview: { descriptionForModel: "Every domain + support summary" }, domain: { descriptionForModel: "One domain in full (param domain)" },
    rules: { descriptionForModel: "Business rules (optional domain / class)" }, relationships: { descriptionForModel: "Entity graph with relation quality" },
    actions: { descriptionForModel: "Business action map (optional domain)" }, limitations: { descriptionForModel: "What Sunny cannot see / do" },
    changes: { descriptionForModel: "Capability change log" }, coverage: { descriptionForModel: "READ / LEARN / PROPOSE / EXECUTE matrix" },
    people: { descriptionForModel: "Every person / role that can use Redbloods OS (login roles, no-login people, machine identities) with pages, money visibility, what they can do" },
    person: { descriptionForModel: "One person in full (param person): who, why access, auth, landing, every tab (purpose, data, money, writes + enforcement), cannot, pushes received / triggered, security gaps" },
    push: { descriptionForModel: "Every Push that exists (optional param recipient role): recipient, purpose, trigger, type (manual / event / scheduled / page-load beacon), timing, conditions, dedupe, what happens next, status, known bugs. Sunny can never send push" },
    access: { descriptionForModel: "Who sees money, who can upload / change status / delete / send push, who is read-only — derived per person" },
    gaps: { descriptionForModel: "Reported security gaps / UI-vs-server mismatches / privacy issues (report only, not fixed)" },
    knowledge_gaps: { descriptionForModel: "Every place where Redbloods knows something Sunny cannot yet read, or Redbloods itself does not record it (optional domain / kind = gap class): class, what Redbloods knows, what Sunny knows, why, what would close it, status; plus each domain's knowledge depth" },
    action_inventory: { descriptionForModel: "Every mutation Redbloods can make on a project today (optional kind = group or approval class): who, input, side effects, push / calendar / finance / file effects, reversibility, risk, future Sunny primitive, approval class; plus the permanent action contract. Sunny executes none of them (only the deadline action after dashboard approval)" },
    calendar_model: { descriptionForModel: "The live calendar as a cross-domain context source: source of truth, trusted integration owner, Sunny read path, token refresh, freshness, limits, fields, failure / relationship / availability semantics, cross-domain usage, future write capabilities" },
    show_model: { descriptionForModel: "SHOWS + DJ as Redbloods implements them (param section): fields, vocabularies (statuses, payment, DJ confirmation, status groups), status_consumers (who counts which shows), lifecycle (every transition: entry, writes, finance, ledger, calendar, push, tasks, idempotency), dj (identity, default, confirmation, fee, portal, hardcoded), money (currency, split, rehearsal-counted rule, advance, finance rows), ledger (booking + close paths, edge cases), calendar, notifications, preparation (recorded evidence, performance files), actions, workflows, signals, integrity" },
    artist_model: { descriptionForModel: "LABEL ARTISTS as Redbloods implements them (param section): fields, vocabularies, membership (what makes a label artist, portal, login), links (every artist relationship + quality), releases (stages, groups, ready, next release, attention, history, cadence evidence), money (ledger formula, cycles, show → ledger, media income + recoup, currency, portal money), portal, availability, presence, pushes (every artist push), actions, workflows, signals, integrity" },
    client_model: { descriptionForModel: "CLIENTS + PROPOSALS as Redbloods implements them (param section): fields (every client / proposal field: meaning, class, validation, writers, readers, side effects, history), vocabularies, statuses (meaning, open, follow-up, conversion, side effects), status_consumers (who counts what as open — disagreements), links (every client relationship with quality + enforcement), conversion (proposal → project steps, atomicity, failure modes), follow_up, lead (no lead entity), deal_terms (what is stored vs not + the proposed model), client_id (assessment + recommendation), history, actions (every client / proposal mutation + approval class), workflows, signals, integrity (production counts)" },
    project_model: { descriptionForModel: "The PROJECT as the central node (param section): fields, vocabularies, links (every relationship with link method, cardinality, DB enforcement, what breaks it, live read), money (rules + known conflicts), signals, surfaces, side_effects (page-load writes), integrity (production counts + risks)" },
  },
  defaultMode: "overview",
  params: {
    domain: { kind: "enum", values: DOMAIN_IDS, descriptionForModel: "A system domain id (see overview)" },
    class: { kind: "enum", values: ["CANONICAL_BUSINESS_RULE", "IMPLEMENTATION_BEHAVIOR", "OWNER_POLICY", "LEGACY_BEHAVIOR", "POSSIBLE_BUG", "CONFLICT"], descriptionForModel: "Only rules of this class" },
    person: { kind: "enum", values: USER_CONTRACTS.map((u) => u.id), descriptionForModel: "A person id (see mode people), e.g. SHALEV, AVI, CLEANTONE, VICTOR, STEVEN, OWNER" },
    recipient: { kind: "enum", values: ["owner", "shalev", "avi", "cleantone", "victor", "steven"], descriptionForModel: "Only pushes this role receives" },
    section: { kind: "enum", values: ["fields", "vocabularies", "links", "money", "signals", "surfaces", "side_effects", "integrity", "statuses", "status_consumers", "conversion", "follow_up", "lead", "deal_terms", "client_id", "history", "actions", "workflows", "membership", "releases", "portal", "availability", "presence", "pushes", "lifecycle", "dj", "ledger", "calendar", "notifications", "preparation"], descriptionForModel: "show_model: fields / vocabularies / status_consumers / lifecycle / dj / money / ledger / calendar / notifications / preparation / actions / workflows / signals / integrity; artist_model: fields / vocabularies / membership / links / releases / money / portal / availability / presence / pushes / actions / workflows / signals / integrity; project_model: fields / vocabularies / links / money / signals / surfaces / side_effects / integrity; client_model: fields / vocabularies / statuses / status_consumers / links / conversion / follow_up / lead / deal_terms / client_id / history / actions / workflows / signals / integrity (default links)" },
    kind: { kind: "enum", values: [...new Set([...KNOWLEDGE_GAPS.map((g) => g.class), ...PROJECT_ACTIONS.map((a) => a.group), ...Object.keys(APPROVAL_CLASSES)])], descriptionForModel: "knowledge_gaps: a gap class; action_inventory: an action group or approval class" },
  },
  paging: { defaultLimit: 40, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: [],
  read(_src, q) {
    const pick = q.params.domain ? DOMAIN_CONTRACTS.filter((d) => d.id === q.params.domain) : DOMAIN_CONTRACTS;
    const base = { summary: [version()], coverage: LAYERS.map((l) => partner(l)) };
    if (q.mode === "domain") {
      if (!q.params.domain) return result([], { ...base, completeness: "UNKNOWN", missing: [{ fact: "domain", whyNeeded: "pass params.domain (see mode overview)" }] });
      return result(pick.map((d) => item({ id: d.id, label: partner(d.titleHe), epistemic: "FACT", source: SRC, fields: servedDomain(d) as unknown as Record<string, unknown> })), base);
    }
    if (q.mode === "rules") {
      const rules = pick.flatMap((d) => d.rules.map((r) => ({ d, r }))).filter(({ r }) => !q.params.class || r.class === q.params.class);
      return result(rules.map(({ d, r }) => item({ id: `${d.id}:${r.id}`, label: partner(r.text), epistemic: r.class === "CONFLICT" || r.class === "POSSIBLE_BUG" ? "OBSERVATION" : "FACT", source: SRC,
        fields: { domain: d.id, rule: r.id, class: r.class, touches: r.touches ?? [], policy: r.class === "CANONICAL_BUSINESS_RULE" || r.class === "OWNER_POLICY" } })),
        { ...base, summary: [version(), sfact("BY_CLASS", "כללים לפי סיווג", byCount(rules.map(({ r }) => r.class)), "FACT", SRC)] });
    }
    if (q.mode === "relationships") {
      return result(RELATIONSHIPS.map((r, i) => item({ id: `rel:${i}`, label: partner(`${r.from} ↔ ${r.to}`), epistemic: "FACT", source: SRC, fields: { via: r.via, quality: r.quality, note: r.note ?? null } })),
        { ...base, summary: [version(), sfact("BY_QUALITY", "קשרים לפי איכות", byCount(RELATIONSHIPS.map((r) => r.quality)), "FACT", SRC)] });
    }
    if (q.mode === "actions") {
      const acts = BUSINESS_ACTIONS.filter((a) => !q.params.domain || a.domain === q.params.domain);
      return result(acts.map((a) => item({ id: a.id, label: partner(a.meaning), epistemic: "FACT", source: SRC, fields: { domain: a.domain, class: a.class, approval: a.approval, confirmations: [...a.confirmations], sunnyCanExecuteToday: a.sunnyCanExecuteToday, financialRisk: a.financialRisk, externalRisk: a.externalRisk, primitive: a.primitive ?? null, reason: a.reason } })),
        { ...base, summary: [version(), sfact("BY_CLASS", "פעולות לפי סיווג", byCount(acts.map((a) => a.class)), "FACT", SRC)] });
    }
    if (q.mode === "limitations") {
      return result(pick.flatMap((d) => d.limitationsHe.map((l, i) => item({ id: `${d.id}:${i}`, label: partner(l), epistemic: "FACT", source: SRC, fields: { domain: d.id, states: [...d.states] } }))), base);
    }
    const peopleBase = { ...base, summary: [version(), sfact("PEOPLE_BASELINE", "גרסת הידע על משתמשים ופושים", PEOPLE_BASELINE_VERSION, "FACT", SRC)] };
    if (q.mode === "people") {
      return result(USER_CONTRACTS.map((u) => item({ id: u.id, label: partner(u.titleHe), epistemic: "FACT", source: SRC, fields: { kind: u.kind, whoTheyAre: u.whoTheyAre, whyAccess: u.whyAccess, landing: u.landing, pages: u.tabs.map((t) => t.titleHe), money: [...new Set(u.tabs.map((t) => t.money))], pushesReceived: u.receivesPush.length } })), peopleBase);
    }
    if (q.mode === "person") {
      if (!q.params.person) return result([], { ...peopleBase, completeness: "UNKNOWN", missing: [{ fact: "person", whyNeeded: "pass params.person (see mode people)" }] });
      const u = USER_CONTRACTS.find((x) => x.id === q.params.person)!;
      const pushes = PUSH_CONTRACTS.filter((p) => u.receivesPush.includes(p.id) || u.triggersPush.includes(p.id)).map((p) => ({ id: p.id, title: p.titleHe, received: u.receivesPush.includes(p.id), triggeredByThem: u.triggersPush.includes(p.id), type: p.type, trigger: p.trigger, timing: p.timing, status: p.status }));
      const gaps = SECURITY_GAPS.filter((g) => u.securityGapIds.includes(g.id));
      return result([item({ id: u.id, label: partner(u.titleHe), epistemic: "FACT", source: SRC, fields: { ...(servedUser(u) as unknown as Record<string, unknown>), pushes, gaps } })], peopleBase);
    }
    if (q.mode === "push") {
      const list = PUSH_CONTRACTS.filter((p) => !q.params.recipient || p.recipientRoles.includes(q.params.recipient));
      return result(list.map((p) => item({ id: p.id, label: partner(p.titleHe), epistemic: "FACT", source: SRC, fields: { ...(servedPush(p) as unknown as Record<string, unknown>), recipients: p.recipientRoles.map((r) => personOfRole(r) ?? r) } })),
        { ...peopleBase, summary: [...peopleBase.summary, sfact("BY_TYPE", "פושים לפי סוג", byCount(list.map((p) => p.type)), "FACT", SRC), sfact("BY_STATUS", "פושים לפי מצב", byCount(list.map((p) => p.status)), "FACT", SRC)],
          coverage: [...peopleBase.coverage, partner("סאני לא שולח פושים ולא קורא היסטוריית התראות — זה ידע על המערכת בלבד.")] });
    }
    if (q.mode === "access") {
      return result(accessMatrix().map((r) => item({ id: r.person, label: partner(r.title), epistemic: "FACT", source: SRC, fields: r as unknown as Record<string, unknown> })),
        { ...peopleBase, coverage: [...peopleBase.coverage, partner("נראות בממשק אינה הרשאה: כל פעולה מסומנת לפי האכיפה בפועל (UI בלבד / שער מרכזי / בדיקה בשרת / RLS).")] });
    }
    if (q.mode === "gaps") {
      return result(SECURITY_GAPS.map((g) => item({ id: g.id, label: partner(g.description), epistemic: "OBSERVATION", source: SRC, fields: { severity: g.severity, kind: g.kind, users: g.users, status: g.status } })),
        { ...peopleBase, summary: [...peopleBase.summary, sfact("BY_SEVERITY", "לפי חומרה", byCount(SECURITY_GAPS.map((g) => g.severity)), "FACT", SRC)] });
    }
    if (q.mode === "project_model") {
      const sec = q.params.section ?? "links";
      const pb = { ...base, summary: [version(), sfact("PROJECT_BASELINE", "גרסת הידע על פרויקטים", PROJECT_BASELINE_VERSION, "FACT", SRC)] };
      const rows: Array<{ id: string; label: string; fields: Record<string, unknown> }> =
        sec === "fields" ? PROJECT_FIELDS.map((f) => ({ id: f.field, label: f.meaning, fields: { ...f } }))
        : sec === "vocabularies" ? Object.entries(PROJECT_VOCABULARIES).map(([k, v]) => ({ id: k, label: k, fields: { values: v } }))
        : sec === "money" ? [{ id: "rules", label: "Project money rules", fields: { rules: PROJECT_MONEY_MODEL.rules, sunny: PROJECT_MONEY_MODEL.sunnyImplementation } }, ...PROJECT_MONEY_MODEL.conflictsHe.map((c, i) => ({ id: `conflict:${i}`, label: c, fields: { class: "CONFLICT" } }))]
        : sec === "signals" ? PROJECT_SIGNAL_MODEL.map((s) => ({ id: s.code, label: s.note, fields: { ...s } }))
        : sec === "surfaces" ? PROJECT_SURFACES.map((s) => ({ id: s.surface, label: s.purpose, fields: { ...s } }))
        : sec === "side_effects" ? PROJECT_PAGE_LOAD_EFFECTS.map((e, i) => ({ id: `effect:${i}`, label: e.trigger, fields: { ...e } }))
        : sec === "integrity" ? [{ id: "counts", label: "Production integrity counts (read-only, 2026-09-25)", fields: { ...PROJECT_INTEGRITY.productionCounts20260925 } }, ...PROJECT_INTEGRITY.risksHe.map((r, i) => ({ id: `risk:${i}`, label: r, fields: {} }))]
        : PROJECT_LINKS.map((l) => ({ id: l.id, label: `project ↔ ${l.target}`, fields: { linkMethod: l.linkMethod, cardinality: l.cardinality, direction: l.direction, quality: l.quality, enforcement: l.enforcement, breaks: l.breaks, liveRead: l.liveRead } }));
      return result(rows.map((r) => item({ id: r.id, label: partner(r.label), epistemic: "FACT", source: SRC, fields: r.fields })), pb);
    }
    if (q.mode === "show_model") {
      const t = q.params.section ?? "lifecycle";
      const obj = (id: string, label: string, v: unknown) => ({ id, label, fields: (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { value: v }) });
      const rowsS: Array<{ id: string; label: string; fields: Record<string, unknown> }> =
        t === "fields" ? SM.SHOW_FIELDS.map((f) => ({ id: f.field, label: f.meaning, fields: { ...f } }))
        : t === "vocabularies" ? Object.entries(SM.SHOW_VOCABULARIES).map(([k, v]) => obj(k, k, Array.isArray(v) ? { values: v } : v))
        : t === "status_consumers" ? SM.SHOW_STATUS_CONSUMERS.map((x) => ({ id: x.consumer, label: x.consumer, fields: { ...x } }))
        : t === "dj" ? Object.entries(SM.DJ_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "money" ? Object.entries(SM.MONEY_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "ledger" ? Object.entries(SM.LEDGER_SYNC).map(([k, v]) => obj(k, k, v))
        : t === "calendar" ? Object.entries(SM.CALENDAR_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "notifications" ? SM.NOTIFICATION_MODEL.map((x) => ({ id: x.id, label: x.trigger, fields: { ...x, sunnyMaySend: false } }))
        : t === "preparation" ? Object.entries(SM.PREPARATION_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "actions" ? SM.SHOW_ACTIONS.map((a) => { const { internal: _i, ...served } = a; void _i; return { id: a.id, label: a.action, fields: { ...served } }; })
        : t === "workflows" ? SM.SHOW_WORKFLOWS.map((w) => ({ id: w.event, label: w.concept, fields: { ...w } }))
        : t === "signals" ? SM.SHOW_SIGNAL_MODEL.map((x) => ({ id: x.code, label: x.note, fields: { ...x } }))
        : t === "integrity" ? [obj("counts", "Production integrity counts (read-only, 2026-09-25)", SM.SHOW_INTEGRITY.productionCounts20260925), ...SM.SHOW_INTEGRITY.findingsHe.map((f, i) => ({ id: `finding:${i}`, label: f, fields: {} }))]
        : SM.LIFECYCLE.map((x) => ({ id: x.transition, label: x.transition, fields: { ...x } }));
      return result(rowsS.map((r) => item({ id: r.id, label: partner(r.label), epistemic: "FACT", source: SRC, fields: r.fields })), { ...base, summary: [version(), sfact("SHOWS_BASELINE", "גרסת הידע על הופעות", SM.SHOWS_BASELINE_VERSION, "FACT", SRC)] });
    }
    if (q.mode === "artist_model") {
      const t = q.params.section ?? "links";
      const obj = (id: string, label: string, v: unknown) => ({ id, label, fields: (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { value: v }) });
      const rowsA: Array<{ id: string; label: string; fields: Record<string, unknown> }> =
        t === "fields" ? LM.LABEL_FIELDS.map((f) => ({ id: `${f.entity}.${f.field}`, label: f.meaning, fields: { ...f } }))
        : t === "vocabularies" ? Object.entries(LM.LABEL_VOCABULARIES).map(([k, v]) => obj(k, k, Array.isArray(v) ? { values: v } : v))
        : t === "membership" ? Object.entries(LM.MEMBERSHIP_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "releases" ? Object.entries(LM.RELEASE_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "money" ? Object.entries(LM.MONEY_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "portal" ? Object.entries(LM.PORTAL_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "availability" ? Object.entries(LM.AVAILABILITY_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "presence" ? Object.entries(LM.PRESENCE_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "pushes" ? LM.ARTIST_PUSHES.map((x) => ({ id: x.id, label: x.trigger, fields: { ...x, sunnyMaySend: false } }))
        : t === "actions" ? LM.LABEL_ACTIONS.map((a) => { const { internal: _i, ...served } = a; void _i; return { id: a.id, label: a.action, fields: { ...served } }; })
        : t === "workflows" ? LM.ARTIST_WORKFLOWS.map((w) => ({ id: w.event, label: w.concept, fields: { ...w } }))
        : t === "signals" ? LM.ARTIST_SIGNAL_MODEL.map((x) => ({ id: x.code, label: x.note, fields: { ...x } }))
        : t === "integrity" ? [obj("counts", "Production integrity counts (read-only, 2026-09-25)", LM.LABEL_INTEGRITY.productionCounts20260925), ...LM.LABEL_INTEGRITY.findingsHe.map((f, i) => ({ id: `finding:${i}`, label: f, fields: {} }))]
        : LM.ARTIST_LINKS.map((l) => ({ id: l.id, label: l.to, fields: { ...l } }));
      return result(rowsA.map((r) => item({ id: r.id, label: partner(r.label), epistemic: "FACT", source: SRC, fields: r.fields })), { ...base, summary: [version(), sfact("LABEL_BASELINE", "גרסת הידע על אמני הלייבל", LM.LABEL_BASELINE_VERSION, "FACT", SRC)] });
    }
    if (q.mode === "client_model") {
      const t = q.params.section ?? "links";
      const obj = (id: string, label: string, v: unknown) => ({ id, label, fields: (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { value: v }) });
      const rows: Array<{ id: string; label: string; fields: Record<string, unknown> }> =
        t === "fields" ? [...CM.CLIENT_FIELDS.map((f) => ({ id: `client.${f.field}`, label: f.meaning, fields: { entity: "client", ...f } })), ...CM.PROPOSAL_FIELDS.map((f) => ({ id: `proposal.${f.field}`, label: f.meaning, fields: { entity: "proposal", ...f } }))]
        : t === "vocabularies" ? Object.entries(CM.CLIENT_VOCABULARIES).map(([k, v]) => obj(k, k, { values: v }))
        : t === "statuses" ? CM.PROPOSAL_STATUS_SEMANTICS.map((x) => ({ id: x.status, label: x.meaning, fields: { ...x } }))
        : t === "status_consumers" ? CM.PROPOSAL_STATUS_CONSUMERS.map((x) => ({ id: x.consumer, label: x.consumer, fields: { ...x } }))
        : t === "conversion" ? Object.entries(CM.CONVERSION_FLOW).map(([k, v]) => obj(k, k, v))
        : t === "follow_up" ? Object.entries(CM.FOLLOW_UP_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "lead" ? Object.entries(CM.LEAD_REALITY).map(([k, v]) => obj(k, k, v))
        : t === "deal_terms" ? [...CM.DEAL_TERMS_MATRIX.map((d) => ({ id: d.concept, label: d.concept, fields: { ...d } })), obj("decision", "Can Redbloods represent the real deal?", CM.DEAL_TERMS_DECISION)]
        : t === "client_id" ? Object.entries(CM.CLIENT_ID_ASSESSMENT).map(([k, v]) => obj(k, k, v))
        : t === "history" ? Object.entries(CM.CLIENT_HISTORY_MODEL).map(([k, v]) => obj(k, k, v))
        : t === "actions" ? CM.CLIENT_ACTIONS.map((a) => { const { internal: _i, ...served } = a; void _i; return { id: a.id, label: a.action, fields: { ...served } }; })
        : t === "workflows" ? CM.CLIENT_WORKFLOWS.map((w) => ({ id: w.event, label: w.redbloodsConcept, fields: { ...w } }))
        : t === "signals" ? CM.CLIENT_SIGNAL_MODEL.map((x) => ({ id: x.code, label: x.note, fields: { ...x } }))
        : t === "integrity" ? [obj("counts", "Production integrity counts (read-only, 2026-09-25)", CM.CLIENT_INTEGRITY.productionCounts20260925), ...CM.CLIENT_INTEGRITY.findingsHe.map((f, i) => ({ id: `finding:${i}`, label: f, fields: {} }))]
        : CM.CLIENT_LINKS.map((l) => ({ id: l.id, label: `${l.from} → ${l.to}`, fields: { ...l } }));
      return result(rows.map((r) => item({ id: r.id, label: partner(r.label), epistemic: "FACT", source: SRC, fields: r.fields })), { ...base, summary: [version(), sfact("CLIENTS_BASELINE", "גרסת הידע על לקוחות והצעות", CM.CLIENTS_BASELINE_VERSION, "FACT", SRC)] });
    }
    if (q.mode === "calendar_model") {
      return result(Object.entries(CALENDAR_CONTEXT_CONTRACT).map(([k, v]) => item({ id: k, label: partner(k), epistemic: "FACT", source: SRC, fields: { value: v } })), base);
    }
    if (q.mode === "knowledge_gaps") {
      const gaps = KNOWLEDGE_GAPS.filter((g) => (!q.params.domain || g.domain === q.params.domain) && (!q.params.kind || g.class === q.params.kind));
      return result(gaps.map((g) => item({ id: g.id, label: partner(g.description), epistemic: g.class === "DATA_NOT_RECORDED" ? "UNKNOWN" : "FACT", source: SRC, fields: { ...g } })),
        { ...base, summary: [version(), sfact("BY_CLASS", "פערים לפי סוג", byCount(gaps.map((g) => g.class)), "FACT", SRC), sfact("BY_STATUS", "פערים לפי מצב", byCount(gaps.map((g) => g.status)), "FACT", SRC), sfact("DOMAIN_DEPTH", "עומק הידע לפי תחום", { ...DOMAIN_KNOWLEDGE_DEPTH }, "FACT", SRC)],
          coverage: [...base.coverage, partner("עיקרון: סאני יודע כל מה ש-Redbloods יודעת. רק סודות (אסימונים, סיסמאות, קישורי שיתוף) אינם ידע.")] });
    }
    if (q.mode === "action_inventory") {
      const acts = PROJECT_ACTIONS.filter((a) => !q.params.kind || a.group === q.params.kind || a.approvalClass === q.params.kind);
      return result(acts.map((a) => { const { internal: _i, ...served } = a; void _i; return item({ id: a.id, label: partner(a.action), epistemic: "FACT", source: SRC, fields: served as unknown as Record<string, unknown> }); }),
        { ...base, summary: [version(), sfact("BY_GROUP", "פעולות לפי קבוצה", byCount(acts.map((a) => a.group)), "FACT", SRC), sfact("BY_APPROVAL_CLASS", "פעולות לפי סוג אישור", byCount(acts.map((a) => a.approvalClass ?? "AUTOMATIC")), "FACT", SRC),
          sfact("ACTION_CONTRACT", "חוזה פעולה קבוע", { fields: ACTION_CONTRACT_FIELDS, flow: ACTION_FLOW, approvalClasses: APPROVAL_CLASSES }, "FACT", SRC)],
          coverage: [...base.coverage, partner("זו מפת הפעולות הקיימות ב-Redbloods — סאני לא מבצע אף אחת מהן כרגע (חוץ משינוי דדליין אחרי אישור בלוח הבקרה). כל פעולה עתידית: הצעה → תצוגה מקדימה מדויקת → אישור בעלים → ביצוע → קריאה טרייה → תוצאה.")] });
    }
    if (q.mode === "changes") {
      return result([...CAPABILITY_CHANGES].reverse().map((c, i) => item({ id: `${c.version}:${c.domain}:${c.dimension}:${i}`, label: partner(c.noteHe), epistemic: "FACT", source: SRC, fields: { ...c } })), base);
    }
    const rows = q.mode === "coverage" ? coverageMatrix().filter((r) => !q.params.domain || r.domain === q.params.domain) : coverageMatrix().filter((r) => !q.params.domain || r.domain === q.params.domain);
    return result(rows.map((r) => item({ id: r.domain, label: partner(r.title), epistemic: "FACT", source: SRC, fields: { group: r.group, read: r.read, learn: r.learn, propose: r.propose, execute: r.execute, states: r.states,
      ...(q.mode === "overview" ? { purpose: DOMAIN_CONTRACTS.find((d) => d.id === r.domain)!.purpose, readCapabilities: [...DOMAIN_CONTRACTS.find((d) => d.id === r.domain)!.readCapabilities] } : {}) } })),
      { ...base, summary: [version(), sfact("READ_SUPPORT", "תמיכת קריאה", byCount(rows.map((r) => r.read)), "FACT", SRC)] });
  },
};
