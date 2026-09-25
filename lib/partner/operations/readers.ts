/**
 * Sunny — OPERATIONS read source (Sunny Full Brain, safe read gaps). SELECT only. Pure over an injected client.
 *
 * Domains Sunny could not read before: Red Films productions + budgets, clip planning, meetings, project actions,
 * beats + artist assignments, social campaigns / content / promotions, artist balance cycles, album tracks, the mix
 * pipeline of EVERY sound engineer (versions / open comments / final files), delivery status, and whether the Google
 * Calendar / Dropbox integrations are connected.
 *
 * Safety:
 *  - the client is a NARROWING interface (select / range / like / in) — no insert / update / delete / rpc exist;
 *  - explicit narrow columns only: NO free text (notes, captions, scripts, comments), NO file paths / share links /
 *    receipts, NO tokens / secrets (the integrations check selects the settings KEY only, never its value),
 *    NO phone numbers;
 *  - every section is read independently and fails closed to null (UNAVAILABLE) — never an empty list;
 *  - bounded: at most ROW_CAP rows per section (paged); a capped section is reported as capped.
 */

import type { Section, Maybe, OpsRedFilmsProduction, OpsBudgetItem, OpsBudgetPayment, OpsClipItem, OpsMeeting, OpsProjectAction, OpsBeat, OpsBeatAssignment, OpsCampaign, OpsContentItem, OpsPromotion, OpsBalanceCycle, OpsAlbumTrack, OpsEngineerWork, OpsMixVersion, OpsMixComment, OpsFinalFile, OpsDelivery, OpsEquipment, OpsProjectMeta, OperationsRaw } from "./types";
export type { Section, Maybe, OpsRedFilmsProduction, OpsBudgetItem, OpsBudgetPayment, OpsClipItem, OpsMeeting, OpsProjectAction, OpsBeat, OpsBeatAssignment, OpsCampaign, OpsContentItem, OpsPromotion, OpsBalanceCycle, OpsAlbumTrack, OpsEngineerWork, OpsMixVersion, OpsMixComment, OpsFinalFile, OpsDelivery, OpsEquipment, OpsProjectMeta, OperationsRaw };

interface Resp { data: unknown[] | null; error: { message?: string } | null }
export interface OpsQuery extends PromiseLike<Resp> {
  range(from: number, to: number): OpsQuery;
  like(column: string, pattern: string): OpsQuery;
  in(column: string, values: readonly string[]): OpsQuery;
}
export interface OperationsReadClient { from(table: string): { select(columns: string): OpsQuery } }

export const ROW_CAP = 3000;
const PAGE = 1000;

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exported for the Project detail source (same bounded, fail-closed SELECT). */
export async function readSection(client: OperationsReadClient, table: string, columns: string, filter?: (q: OpsQuery) => OpsQuery): Promise<Section<Record<string, unknown>> | null> {
  const out: Record<string, unknown>[] = [];
  try {
    for (let from = 0; from < ROW_CAP; from += PAGE) {
      let q = client.from(table).select(columns);
      if (filter) q = filter(q);
      const { data, error } = await q.range(from, Math.min(from + PAGE, ROW_CAP) - 1);
      if (error || !Array.isArray(data)) return null;
      out.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGE) return { rows: out, capped: false };
    }
    return { rows: out, capped: true };
  } catch { return null; }
}
export const mapSection = <T,>(sec: Section<Record<string, unknown>> | null, f: (r: Record<string, unknown>) => T | null): Maybe<T> =>
  sec ? { rows: sec.rows.map(f).filter((x): x is T => x !== null), capped: sec.capped } : null;

export async function readOperationsRaw(client: OperationsReadClient): Promise<OperationsRaw> {
  const [prods, items, pays, equip, clip, meet, acts, beats, assign, camps, content, promos, cycles, tracks, work, versions, comments, finals, deliv, integ, pmeta] = await Promise.all([
    readSection(client, "red_films_productions", "id, title, production_type, status, project_id, client_id, artist_name, client_source, shoot_date, publish_date, edit_status, collection_status, general_budget, client_price, advance_required, advance_received"),
    readSection(client, "red_films_budget_items", "production_id, planned_amount, actual_amount, status, linked_transaction_id"),
    readSection(client, "red_films_budget_payments", "production_id, amount, payment_date"),
    readSection(client, "red_films_equipment", "category, status"),
    readSection(client, "clip_items", "project_id, category, amount, currency, status, linked_transaction_id"),
    readSection(client, "meetings", "id, date, time, status, project_id, client_id, calendar_event_id"),
    readSection(client, "project_actions", "id, project_id, action_type, content_type, recipient_role, status, action_date, followup_date"),
    readSection(client, "beats", "id, name, genre, musical_key, status, created_at"),
    readSection(client, "beat_artist_assignments", "beat_id, artist_slug"),
    readSection(client, "social_campaigns", "id, project_id, title, artist_name, release_date, status, promotion_budget"),
    readSection(client, "social_content_items", "campaign_id, status, content_type, platform, due_date, publish_date"),
    readSection(client, "social_promotions", "campaign_id, channel, planned_amount, status, promo_date, linked_transaction_id"),
    readSection(client, "artist_balance_cycles", "artist_id, cycle_index, start_date, end_date, income, payments, expenses, ending_balance, closed_at"),
    readSection(client, "album_tracks", "project_id, track_number, title, status, mix_status, master_status"),
    readSection(client, "sound_engineer_work", "id, project_id, engineer_name, work_type, work_title, status, sent_date, internal_deadline, agreed_price, amount_paid, currency, payment_date"),
    readSection(client, "mix_versions", "id, sound_engineer_work_id, status, created_at"),
    readSection(client, "mix_comments", "mix_version_id, status"),
    readSection(client, "final_files", "work_id, created_at"),
    // delivery_<projectId>: only the status + delivered date are selected out of the JSON (never the folder path / link)
    readSection(client, "settings", "key, status:value->>deliveryStatus, delivered:value->>deliveredAt", (q) => q.like("key", "delivery_%")),
    // integration credentials: the KEY only — the value (a secret) is never selected
    readSection(client, "settings", "key", (q) => q.in("key", ["google_calendar_token", "dropbox_tokens"])),
    // project metadata the company-state reader drops (hidden projects included) — never notes / files / folders / links
    readSection(client, "projects", "id, name, status, project_type, project_business_type, artist, deadline, start_date, end_date, parent_project, is_hidden, planned_hours, planned_days, updated_at"),
  ]);
  const has = (k: string) => (integ ? integ.rows.some((r) => r.key === k) : null);
  return {
    redFilms: mapSection(prods, (r) => (s(r.id) ? {
      id: String(r.id), title: s(r.title) ?? "", productionType: s(r.production_type), status: s(r.status), projectId: s(r.project_id), clientId: s(r.client_id), artistName: s(r.artist_name),
      clientSource: s(r.client_source), shootDate: s(r.shoot_date), publishDate: s(r.publish_date), editStatus: s(r.edit_status), collectionStatus: s(r.collection_status),
      generalBudget: n(r.general_budget), clientPrice: n(r.client_price), advanceRequired: n(r.advance_required), advanceReceived: n(r.advance_received),
    } : null)),
    budgetItems: mapSection(items, (r) => (s(r.production_id) ? { productionId: String(r.production_id), planned: n(r.planned_amount), actual: n(r.actual_amount), status: s(r.status), hasTransaction: !!s(r.linked_transaction_id) } : null)),
    budgetPayments: mapSection(pays, (r) => (s(r.production_id) ? { productionId: String(r.production_id), amount: n(r.amount), paymentDate: s(r.payment_date) } : null)),
    equipment: mapSection(equip, (r) => ({ category: s(r.category), status: s(r.status) })),
    clipItems: mapSection(clip, (r) => ({ projectId: s(r.project_id), category: s(r.category), amount: n(r.amount), currency: s(r.currency), status: s(r.status), hasTransaction: !!s(r.linked_transaction_id) })),
    meetings: mapSection(meet, (r) => (s(r.id) ? { id: String(r.id), date: s(r.date), time: s(r.time), status: s(r.status), projectId: s(r.project_id), clientId: s(r.client_id), hasCalendarEvent: !!s(r.calendar_event_id) } : null)),
    projectActions: mapSection(acts, (r) => (s(r.id) ? { id: String(r.id), projectId: s(r.project_id), actionType: s(r.action_type), contentType: s(r.content_type), recipientRole: s(r.recipient_role), status: s(r.status), actionDate: s(r.action_date), followupDate: s(r.followup_date) } : null)),
    beats: mapSection(beats, (r) => (s(r.id) ? { id: String(r.id), name: s(r.name) ?? "", genre: s(r.genre), musicalKey: s(r.musical_key), status: s(r.status), createdAt: s(r.created_at) } : null)),
    beatAssignments: mapSection(assign, (r) => (s(r.beat_id) && s(r.artist_slug) ? { beatId: String(r.beat_id), artistSlug: String(r.artist_slug) } : null)),
    campaigns: mapSection(camps, (r) => (s(r.id) ? { id: String(r.id), projectId: s(r.project_id), title: s(r.title) ?? "", artistName: s(r.artist_name), releaseDate: s(r.release_date), status: s(r.status), promotionBudget: n(r.promotion_budget) } : null)),
    contentItems: mapSection(content, (r) => ({ campaignId: s(r.campaign_id), status: s(r.status), contentType: s(r.content_type), platform: s(r.platform), dueDate: s(r.due_date), publishDate: s(r.publish_date) })),
    promotions: mapSection(promos, (r) => ({ campaignId: s(r.campaign_id), channel: s(r.channel), plannedAmount: n(r.planned_amount), status: s(r.status), promoDate: s(r.promo_date), hasTransaction: !!s(r.linked_transaction_id) })),
    balanceCycles: mapSection(cycles, (r) => (s(r.artist_id) ? { artistId: String(r.artist_id), cycleIndex: Number(r.cycle_index), startDate: s(r.start_date), endDate: s(r.end_date), income: n(r.income), payments: n(r.payments), expenses: n(r.expenses), endingBalance: n(r.ending_balance), closedAt: s(r.closed_at) } : null)),
    albumTracks: mapSection(tracks, (r) => ({ projectId: s(r.project_id), trackNumber: n(r.track_number), title: s(r.title) ?? "", status: s(r.status), mixStatus: s(r.mix_status), masterStatus: s(r.master_status) })),
    engineerWork: mapSection(work, (r) => (s(r.id) ? {
      id: String(r.id), projectId: s(r.project_id), engineerName: s(r.engineer_name) ?? "", workType: s(r.work_type), workTitle: s(r.work_title), status: s(r.status), sentDate: s(r.sent_date),
      internalDeadline: s(r.internal_deadline), agreedPrice: n(r.agreed_price), amountPaid: n(r.amount_paid), currency: s(r.currency), paymentDate: s(r.payment_date),
    } : null)),
    mixVersions: mapSection(versions, (r) => (s(r.id) ? { id: String(r.id), workId: s(r.sound_engineer_work_id), status: s(r.status), createdAt: s(r.created_at) } : null)),
    mixComments: mapSection(comments, (r) => ({ versionId: s(r.mix_version_id), status: s(r.status) })),
    finalFiles: mapSection(finals, (r) => ({ workId: s(r.work_id), createdAt: s(r.created_at) })),
    deliveries: mapSection(deliv, (r) => {
      const id = typeof r.key === "string" ? r.key.slice("delivery_".length) : "";
      return UUID.test(id) ? { projectId: id, status: s(r.status), deliveredAt: s(r.delivered) } : null;
    }),
    projectsMeta: mapSection(pmeta, (r) => (s(r.id) ? {
      id: String(r.id), name: s(r.name) ?? "", status: s(r.status), projectType: s(r.project_type), businessType: s(r.project_business_type), artistText: s(r.artist),
      deadline: s(r.deadline), startDate: s(r.start_date), endDate: s(r.end_date), parentProject: s(r.parent_project), isHidden: r.is_hidden === true,
      plannedHours: n(r.planned_hours), plannedDays: n(r.planned_days), updatedAt: s(r.updated_at),
    } : null)),
    integrations: { googleCalendarConnected: has("google_calendar_token"), dropboxConnected: has("dropbox_tokens") },
  };
}
