/**
 * Sunny — PROJECT_DETAIL read source. SELECT only, over the same narrowing client as the operations source (select /
 * range / like / in — no insert / update / delete / rpc exist on the interface). Every section is bounded and fails
 * closed to null (UNAVAILABLE), never to an empty list.
 *
 * SECRETS ARE NOT KNOWLEDGE — enforced here, at the read edge:
 *  - URL / share-link / access-handle values never leave this reader: link columns and links inside JSON blobs (file
 *    lists, Victor files) are reduced to a boolean by the mapper (`hasLink` / `hasShareLink`);
 *  - settings are read through JSON paths (the delivery share link is reduced to a boolean at the edge);
 *  - free text is scrubbed of bearer-looking URLs / tokens (Dropbox share links, signed links, OAuth / JWT tokens).
 * Everything else Redbloods stores about a project is read — notes, instructions, comments, reviews, crew names,
 * captions, notification text — because Sunny knows everything Redbloods knows.
 */
import { mapSection, readSection, type OperationsReadClient } from "../operations/readers";
import type { DetailFile, ProjectDetailRaw } from "./detail-types";

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Bearer access material that may be pasted into free text. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /https?:\/\/(?:www\.)?dropbox\.com\/(?:scl|s|sh)\/[^\s)"'<>]+/gi,
  /https?:\/\/[^\s)"'<>]*dropboxusercontent\.com\/[^\s)"'<>]+/gi,
  /https?:\/\/[^\s)"'<>]*[?&](?:rlkey|token|access_token|key|sig|signature|X-Amz-Signature|code)=[^\s)"'<>]+/gi,
  /\bsl\.[A-Za-z0-9_-]{20,}/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\brbmcp_[A-Za-z0-9]{16,}/g,
  // meeting join links (bearer access to a call) — Sunny gets hasMeetingLink, never the URL
  /https?:\/\/meet\.google\.com\/[^\s)"'<>]+/gi,
  /https?:\/\/[a-z0-9.-]*zoom\.us\/(?:j|w|my|s)\/[^\s)"'<>]+/gi,
  /https?:\/\/teams\.(?:microsoft|live)\.com\/[^\s)"'<>]+/gi,
  /https?:\/\/[^\s)"'<>]*[?&](?:pwd|passcode|password)=[^\s)"'<>]+/gi,
  /\b1\/\/[A-Za-z0-9_-]{20,}/g,
];
export const REDACTED = "[קישור / אסימון גישה הוסתר]";
export function scrubSecrets(text: string | null): string | null {
  if (text === null) return null;
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, REDACTED);
  return out;
}
const t = (v: unknown) => scrubSecrets(s(v));
/** Deep scrub of a JSON setting value: strings scrubbed, link-looking keys reduced to a boolean. */
export function scrubValue(v: unknown): unknown {
  if (typeof v === "string") return scrubSecrets(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  const o = obj(v);
  if (!o) return v ?? null;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (/(url|link|token|share)/i.test(k)) out[`has_${k}`] = has(x);
    else out[k] = scrubValue(x);
  }
  return out;
}

/** A FileLink-shaped JSON entry → metadata only (url / share url / opaque handle never leave the reader). */
export function detailFile(v: unknown): DetailFile | null {
  const f = obj(v);
  if (!f) return null;
  const name = s(f.name) ?? s(f.fileName);
  if (!name) return null;
  return {
    name, category: s(f.category), versionLabel: s(f.versionLabel), trackId: s(f.trackId), durationSeconds: n(f.durationSeconds), size: n(f.size),
    uploadedAt: s(f.uploadedAt), path: s(f.dropboxPath), hasShareLink: has(f.dropboxShareUrl) || has(f.url), fromMixVersionId: s(f.sourceMixVersionId),
    structureMarkers: Array.isArray(f.segments) ? f.segments.length : 0,
    uploadedBy: s(f.uploadedBy),
  };
}
const files = (v: unknown): DetailFile[] => (Array.isArray(v) ? v.map(detailFile).filter((x): x is DetailFile => x !== null) : []);
/** Other per-project settings families (non-secret business settings keyed `<prefix><project id>`). */
export const PROJECT_SETTING_FAMILIES = [
  { prefix: "album_finance_", kind: "ALBUM_FINANCE_LEGACY" },
  { prefix: "album_prev_info_", kind: "ALBUM_PREVIOUS_SYSTEM_INFO" },
  { prefix: "session_limit_", kind: "SESSION_LIMIT" },
  { prefix: "project_cover_", kind: "PROJECT_COVER" },
  { prefix: "steven_final_files_requested_project:", kind: "STEVEN_FINAL_FILES_REQUESTED_PROJECT" },
  { prefix: "steven_final_files_requested:", kind: "STEVEN_FINAL_FILES_REQUESTED_WORK" },
] as const;
const PUBLIC_REFERENCE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

export async function readProjectDetailRaw(client: OperationsReadClient): Promise<ProjectDetailRaw> {
  const r = (table: string, cols: string, f?: Parameters<typeof readSection>[3]) => readSection(client, table, cols, f);
  const [prj, fin, deliv, acts, sess, meet, tasks, work, vers, comm, att, targ, tnotes, finals, vic, prods, budget, tracks, clip, props, rel, camps, content, sfiles, notif, psettings, txt, bpay, alerts, rfCrew, rfDocs, rfScenes, rfRefImages, rfRefLinks, rfEquip] = await Promise.all([
    r("projects", "id, created_at, monday_id, notes, work_materials, dropbox_folder, files"),
    r("settings", "key, fnotes:value->>financialNotes, freason:value->>financeExceptionReason, fdate:value->>financeExceptionDate", (q) => q.like("key", "finance_%")),
    r("settings", "key, folder:value->>folderPath, status:value->>deliveryStatus, delivered:value->>deliveredAt, link:value->>deliveryLink", (q) => q.like("key", "delivery_%")),
    r("project_actions", "id, project_id, action_type, content_type, version_label, recipient_role, recipient_name, recipient_client_id, recipient_phone, dropbox_url, status, action_date, followup_date, notes, linked_work_id, linked_task_id, created_at, updated_at"),
    r("sessions", "id, project_id, show_id, date, start_time, end_time, status, session_type, title, notes, location, photographer, cost, calendar_event_id, created_at"),
    r("meetings", "id, project_id, client_id, client_name, date, time, duration, location, notes, status, calendar_event_id, created_at"),
    r("tasks", "id, related_type, related_id, title, notes, status, due_date, start_time, end_time, show_id, calendar_event_id, created_at, updated_at"),
    r("sound_engineer_work", "id, project_id, engineer_name, notes, files_link, sort_order, created_at, updated_at, work_title, work_type, status, agreed_price, currency, amount_paid, sent_date, internal_deadline, linked_transaction_id, payment_date"),
    r("mix_versions", "id, sound_engineer_work_id, project_id, label, file_name, dropbox_path, file_size, file_type, status, uploaded_by, duration_seconds, uploaded_at, mix_target_id, created_at, updated_at"),
    r("mix_comments", "id, mix_version_id, timestamp_seconds, comment_text, author, role, status, created_at, updated_at"),
    r("mix_comment_attachments", "id, comment_id, file_name, file_size, dropbox_path, mime_type, uploaded_by, created_at"),
    r("mix_targets", "id, work_id, target_kind, display_name, sort_order, removed_at, created_at"),
    r("mix_target_notes", "id, mix_target_id, note_text, author, status, created_at, updated_at"),
    r("final_files", "id, work_id, project_id, file_name, dropbox_path, file_type, file_size, uploaded_by, created_at"),
    r("vendor_project_work", "id, vendor_name, project_id, title, status, work_state, sent_date, internal_deadline, linked_task_id, created_at, updated_at, notes, brief_text, reference_links, version_reviews, files_sent, files_received, brief_files, returned_date, outcome, quality, entered_project, dropbox_folder, dropbox_share_link"),
    r("red_films_productions", "id, project_id, client_name, created_at, updated_at, photographer_name, director_name, editor_name, locations, concept_summary, concept_vibe, ref_links, script_start, script_middle, script_end, director_notes, photographer_notes, fix_notes, notes, published_where, dropbox_folder_path, files_raw_link, files_edit_folder, version_1_link, version_2_link, final_version_link, dropbox_folder_url"),
    r("red_films_budget_items", "id, production_id, title, category, vendor_name, status, planned_amount, actual_amount, linked_transaction_id, notes, created_at, updated_at"),
    r("album_tracks", "id, project_id, track_number, title, notes, created_at, updated_at"),
    r("clip_items", "id, project_id, category, description, notes, status, created_at, updated_at, amount, currency, linked_transaction_id"),
    r("proposals", "id, linked_project_id, client_id, title, notes"),
    r("project_release_details", "project_id, next_action, blocker, responsible, stage_entered_at, released_at"),
    r("social_campaigns", "id, project_id, title, marketing_angle, target_audience, main_message, platforms, notes, owner_id, created_at, updated_at"),
    r("social_content_items", "id, project_id, campaign_id, title, content_type, status, platform, due_date, publish_date, caption, hook, notes, owner_name, posted_url, asset_link, dropbox_link, calendar_event_id, task_id, publish_time, created_at, updated_at"),
    r("social_content_files", "id, project_id, content_item_id, campaign_id, file_name, file_type, file_size, uploaded_by, created_at, updated_at, dropbox_path, dropbox_file_id, dropbox_share_link"),
    r("notifications", "id, project_id, recipient_user_id, recipient_role, title, body, url, tag, actor_name, entity_type, entity_id, event_key, created_at, read_at"),
    Promise.all(PROJECT_SETTING_FAMILIES.map((f) => r("settings", "key, value", (q) => q.like("key", `${f.prefix}%`)))),
    r("transactions", "id, project_id, type, date, description, notes, payment_method, artist, receipt_ref, created_at"),
    r("red_films_budget_payments", "id, production_id, budget_item_id, amount, payment_date, payment_method, notes, receipt_file_name, receipt_mime_type, receipt_dropbox_path, receipt_dropbox_url, created_at, updated_at"),
    r("agent_alerts", "id, related_project_id, related_client_id, type, severity, title, message, metadata, suggested_actions, status, source, sent_notification, entity_key, created_at, updated_at"),
    // Red Films Deep Brain: the production satellites (metadata only — storage paths stay internal, public links → booleans).
    r("red_films_crew", "id, production_id, name, role, contact, arrival_time, confirmation_status, payment_amount, payment_status, notes, created_at, updated_at"),
    r("red_films_documents", "id, production_id, file_name, file_type, mime_type, dropbox_path, dropbox_url, notes, created_at, updated_at"),
    r("red_films_scenes", "id, production_id, sort_order, title, location, description, participants, status, notes, created_at, updated_at"),
    r("red_films_reference_images", "id, production_id, file_name, dropbox_path, dropbox_url, caption, tag, sort_order, created_at, updated_at"),
    r("red_films_reference_links", "id, production_id, url, provider, video_id, title, thumbnail_url, notes, created_at, updated_at"),
    r("red_films_equipment", "id, name, category, quantity, acquired_date, purchase_price, purchased_from, serial_number, notes, added_by, status, removed_at, created_at, updated_at"),
  ]);
  const keyId = (k: unknown, prefix: string) => (typeof k === "string" && k.startsWith(prefix) ? k.slice(prefix.length) : null);
  return {
    projects: mapSection(prj, (x) => (s(x.id) ? {
      id: String(x.id), createdAt: s(x.created_at), legacyMondayId: s(x.monday_id), notes: t(x.notes), dropboxFolder: s(x.dropbox_folder), files: files(x.files),
      workMaterials: obj(x.work_materials) ? { bpm: s(obj(x.work_materials)!.bpm), key: s(obj(x.work_materials)!.key), instructions: t(obj(x.work_materials)!.instructions) } : null,
    } : null)),
    financeNotes: mapSection(fin, (x) => { const id = keyId(x.key, "finance_"); return id ? { projectId: id, financialNotes: t(x.fnotes), exceptionReason: t(x.freason), exceptionDate: s(x.fdate), hasSetting: true as const } : null; }),
    deliveries: mapSection(deliv, (x) => { const id = keyId(x.key, "delivery_"); return id ? { projectId: id, folderPath: s(x.folder), status: s(x.status), deliveredAt: s(x.delivered), hasLink: has(x.link) } : null; }),
    actions: mapSection(acts, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), actionType: s(x.action_type), contentType: s(x.content_type), versionLabel: s(x.version_label), recipientRole: s(x.recipient_role),
      recipientName: s(x.recipient_name), recipientClientId: s(x.recipient_client_id), recipientPhone: s(x.recipient_phone), hasLink: has(x.dropbox_url), status: s(x.status),
      actionDate: s(x.action_date), followupDate: s(x.followup_date), notes: t(x.notes), linkedWorkId: s(x.linked_work_id), linkedTaskId: s(x.linked_task_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    sessions: mapSection(sess, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), showId: s(x.show_id), date: s(x.date), startTime: s(x.start_time), endTime: s(x.end_time), status: s(x.status), type: s(x.session_type),
      title: t(x.title), notes: t(x.notes), location: t(x.location), photographer: s(x.photographer), cost: n(x.cost), hasCalendarEvent: has(x.calendar_event_id), createdAt: s(x.created_at),
    } : null)),
    meetings: mapSection(meet, (x) => (s(x.id) ? {
      id: String(x.id), createdAt: s(x.created_at), projectId: s(x.project_id), clientId: s(x.client_id), clientName: s(x.client_name), date: s(x.date), time: s(x.time), duration: n(x.duration),
      location: t(x.location), notes: t(x.notes), status: s(x.status), hasCalendarEvent: has(x.calendar_event_id),
    } : null)),
    tasks: mapSection(tasks, (x) => (s(x.id) ? {
      id: String(x.id), relatedType: s(x.related_type), relatedId: s(x.related_id), title: t(x.title), notes: t(x.notes), status: s(x.status), dueDate: s(x.due_date), startTime: s(x.start_time), endTime: s(x.end_time), showId: s(x.show_id),
      hasGoogleTask: has(x.calendar_event_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    engineerWork: mapSection(work, (x) => (s(x.id) ? { id: String(x.id), projectId: s(x.project_id), engineerName: s(x.engineer_name), notes: t(x.notes), hasFilesLink: has(x.files_link), sortOrder: n(x.sort_order), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
      workTitle: s(x.work_title), workType: s(x.work_type), status: s(x.status), agreedPrice: n(x.agreed_price), currency: s(x.currency), amountPaid: n(x.amount_paid), sentDate: s(x.sent_date), internalDeadline: s(x.internal_deadline), linkedTransactionId: s(x.linked_transaction_id), paymentDate: s(x.payment_date) } : null)),
    mixVersions: mapSection(vers, (x) => (s(x.id) ? {
      id: String(x.id), workId: s(x.sound_engineer_work_id), projectId: s(x.project_id), label: s(x.label), fileName: s(x.file_name), status: s(x.status), uploadedBy: s(x.uploaded_by),
      durationSeconds: n(x.duration_seconds), uploadedAt: s(x.uploaded_at), targetId: s(x.mix_target_id), path: s(x.dropbox_path), size: n(x.file_size), type: s(x.file_type), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    mixComments: mapSection(comm, (x) => (s(x.id) ? {
      id: String(x.id), versionId: s(x.mix_version_id), timestampSeconds: n(x.timestamp_seconds), text: t(x.comment_text), author: s(x.author), role: s(x.role), status: s(x.status), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    commentAttachments: mapSection(att, (x) => ({ commentId: s(x.comment_id), fileName: s(x.file_name), size: n(x.file_size), path: s(x.dropbox_path), mimeType: s(x.mime_type), uploadedBy: s(x.uploaded_by), createdAt: s(x.created_at) })),
    mixTargets: mapSection(targ, (x) => (s(x.id) ? { id: String(x.id), workId: s(x.work_id), kind: s(x.target_kind), displayName: s(x.display_name), sortOrder: n(x.sort_order), removedAt: s(x.removed_at), createdAt: s(x.created_at) } : null)),
    mixTargetNotes: mapSection(tnotes, (x) => ({ targetId: s(x.mix_target_id), text: t(x.note_text), author: s(x.author), status: s(x.status), createdAt: s(x.created_at), updatedAt: s(x.updated_at) })),
    finalFiles: mapSection(finals, (x) => ({ workId: s(x.work_id), projectId: s(x.project_id), fileName: s(x.file_name), path: s(x.dropbox_path), fileType: s(x.file_type), fileSize: n(x.file_size), uploadedBy: s(x.uploaded_by), createdAt: s(x.created_at) })),
    victor: mapSection(vic, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), vendorName: s(x.vendor_name), title: t(x.title), status: s(x.status), workState: s(x.work_state), sentDate: s(x.sent_date), internalDeadline: s(x.internal_deadline), linkedTaskId: s(x.linked_task_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
      notes: t(x.notes), briefText: t(x.brief_text),
      references: (Array.isArray(x.reference_links) ? x.reference_links : []).map((ref) => { const o = obj(ref) ?? {}; const url = s(o.url); return { title: t(o.title), note: t(o.note), publicUrl: url && PUBLIC_REFERENCE.test(url) ? url : null }; }),
      reviews: Object.entries(obj(x.version_reviews) ?? {}).map(([version, v]) => { const o = obj(v) ?? {}; return { version, status: s(o.status), notes: t(o.notes), sentNotes: t(o.sentNotes), sentAt: s(o.sentAt), draft: o.draft === true, reviewedAt: s(o.reviewedAt) }; }),
      filesSent: files(x.files_sent), filesReceived: files(x.files_received), briefFiles: files(x.brief_files), returnedDate: s(x.returned_date), outcome: s(x.outcome), quality: s(x.quality),
      enteredProject: x.entered_project ?? null, dropboxFolder: s(x.dropbox_folder), hasFolderLink: has(x.dropbox_share_link),
    } : null)),
    productions: mapSection(prods, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), clientNameSnapshot: s(x.client_name), createdAt: s(x.created_at), updatedAt: s(x.updated_at), photographer: s(x.photographer_name), director: s(x.director_name), editor: s(x.editor_name), locations: t(x.locations),
      conceptSummary: t(x.concept_summary), conceptVibe: t(x.concept_vibe), script: { start: t(x.script_start), middle: t(x.script_middle), end: t(x.script_end) },
      directorNotes: t(x.director_notes), photographerNotes: t(x.photographer_notes), fixNotes: t(x.fix_notes), notes: t(x.notes), publishedWhere: t(x.published_where), dropboxFolderPath: s(x.dropbox_folder_path),
      links: { references: has(x.ref_links), rawFiles: has(x.files_raw_link), editFolder: has(x.files_edit_folder), version1: has(x.version_1_link), version2: has(x.version_2_link), finalVersion: has(x.final_version_link), folder: has(x.dropbox_folder_url) },
    } : null)),
    rfCrew: mapSection(rfCrew, (x) => ({ id: s(x.id), productionId: s(x.production_id), name: s(x.name), role: s(x.role), hasContact: has(x.contact), arrivalTime: s(x.arrival_time), confirmation: s(x.confirmation_status), paymentAmount: n(x.payment_amount), paymentStatus: s(x.payment_status), notes: t(x.notes), createdAt: s(x.created_at) })),
    rfDocuments: mapSection(rfDocs, (x) => ({ id: s(x.id), productionId: s(x.production_id), fileName: s(x.file_name), fileType: s(x.file_type), mimeType: s(x.mime_type), path: s(x.dropbox_path), hasPublicLink: has(x.dropbox_url), notes: t(x.notes), createdAt: s(x.created_at), updatedAt: s(x.updated_at) })),
    rfScenes: mapSection(rfScenes, (x) => ({ id: s(x.id), productionId: s(x.production_id), order: n(x.sort_order), title: t(x.title), location: t(x.location), description: t(x.description), participants: t(x.participants), status: s(x.status), notes: t(x.notes), createdAt: s(x.created_at) })),
    rfRefImages: mapSection(rfRefImages, (x) => ({ id: s(x.id), productionId: s(x.production_id), fileName: s(x.file_name), path: s(x.dropbox_path), hasPublicLink: has(x.dropbox_url), caption: t(x.caption), tag: s(x.tag), order: n(x.sort_order), createdAt: s(x.created_at) })),
    rfRefLinks: mapSection(rfRefLinks, (x) => ({ id: s(x.id), productionId: s(x.production_id), provider: s(x.provider), videoId: s(x.video_id), title: t(x.title), hasThumbnail: has(x.thumbnail_url), hasUrl: has(x.url), notes: t(x.notes), createdAt: s(x.created_at) })),
    rfEquipment: mapSection(rfEquip, (x) => ({ id: s(x.id), name: s(x.name), category: s(x.category), quantity: n(x.quantity), acquiredDate: s(x.acquired_date), purchasePrice: n(x.purchase_price), purchasedFrom: s(x.purchased_from), serialNumber: s(x.serial_number), notes: t(x.notes), addedBy: s(x.added_by), status: s(x.status), removedAt: s(x.removed_at), createdAt: s(x.created_at) })),
    budgetItems: mapSection(budget, (x) => ({ id: s(x.id), productionId: s(x.production_id), linkedTransactionId: s(x.linked_transaction_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at), title: t(x.title), category: s(x.category), vendorName: s(x.vendor_name), status: s(x.status), planned: n(x.planned_amount), actual: n(x.actual_amount), notes: t(x.notes) })),
    albumTracks: mapSection(tracks, (x) => ({ projectId: s(x.project_id), trackNumber: n(x.track_number), title: s(x.title), notes: t(x.notes) })),
    clipItems: mapSection(clip, (x) => ({ id: s(x.id), createdAt: s(x.created_at), updatedAt: s(x.updated_at), projectId: s(x.project_id), category: s(x.category), description: t(x.description), notes: t(x.notes), status: s(x.status), amount: n(x.amount), currency: s(x.currency), linkedTransactionId: s(x.linked_transaction_id) })),
    proposals: mapSection(props, (x) => (s(x.id) ? { id: String(x.id), linkedProjectId: s(x.linked_project_id), clientId: s(x.client_id), title: t(x.title), notes: t(x.notes) } : null)),
    releases: mapSection(rel, (x) => (s(x.project_id) ? { projectId: String(x.project_id), nextAction: t(x.next_action), blocker: t(x.blocker), responsible: s(x.responsible), stageEnteredAt: s(x.stage_entered_at), releasedAt: s(x.released_at) } : null)),
    campaigns: mapSection(camps, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), title: t(x.title), marketingAngle: t(x.marketing_angle), targetAudience: t(x.target_audience), mainMessage: t(x.main_message),
      platforms: Array.isArray(x.platforms) ? x.platforms.filter((p): p is string => typeof p === "string") : [], notes: t(x.notes), ownerUserId: s(x.owner_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    contentItems: mapSection(content, (x) => (s(x.id) ? {
      id: String(x.id), projectId: s(x.project_id), campaignId: s(x.campaign_id), title: t(x.title), contentType: s(x.content_type), status: s(x.status), platform: s(x.platform),
      dueDate: s(x.due_date), publishDate: s(x.publish_date), caption: t(x.caption), hook: t(x.hook), notes: t(x.notes), ownerName: s(x.owner_name), postedUrl: scrubSecrets(s(x.posted_url)),
      hasAssetLink: has(x.asset_link) || has(x.dropbox_link), hasCalendarEvent: has(x.calendar_event_id), taskId: s(x.task_id), publishTime: s(x.publish_time), createdAt: s(x.created_at), updatedAt: s(x.updated_at),
    } : null)),
    socialFiles: mapSection(sfiles, (x) => ({ projectId: s(x.project_id), contentItemId: s(x.content_item_id), campaignId: s(x.campaign_id), dropboxFileId: s(x.dropbox_file_id), updatedAt: s(x.updated_at), fileName: s(x.file_name), fileType: s(x.file_type), fileSize: n(x.file_size), uploadedBy: s(x.uploaded_by), createdAt: s(x.created_at), path: s(x.dropbox_path), hasShareLink: has(x.dropbox_share_link) })),
    projectSettings: psettings.some((x) => x === null) ? null : {
      rows: psettings.flatMap((sec, i) => (sec?.rows ?? []).flatMap((x) => {
        const id = keyId(x.key, PROJECT_SETTING_FAMILIES[i].prefix);
        return id ? [{ projectId: id, kind: PROJECT_SETTING_FAMILIES[i].kind, value: scrubValue(x.value) }] : [];
      })),
      capped: psettings.some((x) => x?.capped),
    },
    transactionsText: mapSection(txt, (x) => (s(x.id) && s(x.project_id) ? { id: String(x.id), projectId: String(x.project_id), type: s(x.type), date: s(x.date), description: t(x.description), notes: t(x.notes), paymentMethod: s(x.payment_method), artistText: s(x.artist), hasReceipt: has(x.receipt_ref), createdAt: s(x.created_at) } : null)),
    budgetPayments: mapSection(bpay, (x) => ({ productionId: s(x.production_id), budgetItemId: s(x.budget_item_id), amount: n(x.amount), date: s(x.payment_date), method: s(x.payment_method), notes: t(x.notes), receiptFileName: s(x.receipt_file_name), receiptMime: s(x.receipt_mime_type), receiptPath: s(x.receipt_dropbox_path), hasReceiptLink: has(x.receipt_dropbox_url), createdAt: s(x.created_at), updatedAt: s(x.updated_at) })),
    agentAlerts: mapSection(alerts, (x) => (s(x.id) ? { projectId: s(x.related_project_id), type: s(x.type), severity: s(x.severity), title: t(x.title), message: t(x.message), status: s(x.status), source: s(x.source), relatedClientId: s(x.related_client_id), metadata: scrubValue(x.metadata), suggestedActions: scrubValue(x.suggested_actions), sentNotification: x.sent_notification ?? null, entityKey: s(x.entity_key), createdAt: s(x.created_at), updatedAt: s(x.updated_at) } : null)),
    notifications: mapSection(notif, (x) => (s(x.project_id) ? { projectId: String(x.project_id), recipientRole: s(x.recipient_role), title: t(x.title), body: t(x.body), tag: s(x.tag), actorName: s(x.actor_name), entityType: s(x.entity_type), entityId: s(x.entity_id), eventKey: s(x.event_key), appPath: scrubSecrets(s(x.url)), recipientUserId: s(x.recipient_user_id), createdAt: s(x.created_at), readAt: s(x.read_at) } : null)),
  };
}
