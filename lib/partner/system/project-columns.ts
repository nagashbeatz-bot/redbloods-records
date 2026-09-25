/**
 * Sunny System Awareness — PROJECT DATA COVERAGE MAP. Every column of every project-linked table in the production
 * schema (information_schema, read-only, 2026-09-25), pinned here so the coverage test can PROVE that Sunny reads
 * everything Redbloods stores about a project — not assume it.
 *
 * Every column is either READ by a Sunny reader, or READ-AND-REDUCED (bearer access material → a boolean; external
 * ids → "has event / task"), never silently skipped. A new column added to one of these tables without updating this
 * map (and a reader) fails scripts/test-sunny-complete-knowledge.tsx.
 */

export const PROJECT_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  agent_alerts: ["id", "type", "severity", "title", "message", "related_project_id", "related_client_id", "metadata", "suggested_actions", "source", "status", "sent_notification", "created_at", "updated_at", "entity_key"],
  album_tracks: ["id", "project_id", "track_number", "title", "status", "mix_status", "master_status", "notes", "created_at", "updated_at"],
  clip_items: ["id", "project_id", "category", "description", "amount", "currency", "status", "linked_transaction_id", "notes", "created_at", "updated_at"],
  final_files: ["id", "work_id", "project_id", "file_name", "dropbox_path", "file_size", "file_type", "uploaded_by", "created_at"],
  meetings: ["id", "client_id", "client_name", "project_id", "date", "time", "duration", "location", "notes", "status", "calendar_event_id", "created_at"],
  mix_comment_attachments: ["id", "comment_id", "dropbox_path", "file_name", "file_size", "mime_type", "uploaded_by", "created_at"],
  mix_comments: ["id", "mix_version_id", "timestamp_seconds", "comment_text", "author", "created_at", "updated_at", "role", "status"],
  mix_target_notes: ["id", "mix_target_id", "note_text", "author", "status", "created_at", "updated_at"],
  mix_targets: ["id", "work_id", "target_kind", "display_name", "sort_order", "removed_at", "created_at"],
  mix_versions: ["id", "sound_engineer_work_id", "project_id", "label", "file_name", "dropbox_path", "file_size", "file_type", "status", "uploaded_by", "duration_seconds", "uploaded_at", "created_at", "updated_at", "mix_target_id"],
  notifications: ["id", "recipient_user_id", "recipient_role", "title", "body", "url", "tag", "project_id", "entity_type", "entity_id", "actor_name", "event_key", "created_at", "read_at"],
  project_actions: ["id", "project_id", "action_type", "content_type", "version_label", "recipient_role", "recipient_name", "recipient_client_id", "recipient_phone", "dropbox_url", "status", "action_date", "followup_date", "linked_task_id", "notes", "created_at", "updated_at", "linked_work_id"],
  project_release_details: ["project_id", "release_stage", "release_target_date", "next_action", "blocker", "responsible", "stage_entered_at", "released_at", "created_at", "updated_at", "label_artist_id"],
  projects: ["id", "monday_id", "name", "artist", "status", "deadline", "notes", "project_type", "parent_project", "files", "created_at", "updated_at", "is_hidden", "start_date", "end_date", "work_materials", "dropbox_folder", "project_business_type", "planned_hours", "planned_days"],
  proposals: ["id", "client_id", "title", "amount", "currency", "status", "sent_date", "followup_date", "notes", "linked_project_id", "created_at", "updated_at"],
  red_films_budget_items: ["id", "production_id", "title", "category", "planned_amount", "actual_amount", "vendor_name", "status", "linked_transaction_id", "notes", "created_at", "updated_at"],
  red_films_budget_payments: ["id", "production_id", "budget_item_id", "amount", "payment_date", "payment_method", "notes", "receipt_file_name", "receipt_mime_type", "receipt_dropbox_path", "receipt_dropbox_url", "created_at", "updated_at"],
  red_films_productions: ["id", "title", "production_type", "status", "project_id", "client_id", "artist_name", "client_name", "client_source", "photographer_name", "director_name", "editor_name", "shoot_date", "locations", "concept_summary", "concept_vibe", "ref_links", "script_start", "script_middle", "script_end", "director_notes", "photographer_notes", "general_budget", "client_price", "advance_required", "advance_received", "collection_status", "files_raw_link", "files_edit_folder", "version_1_link", "version_2_link", "final_version_link", "fix_notes", "edit_status", "publish_date", "published_where", "notes", "created_at", "updated_at", "dropbox_folder_path", "dropbox_folder_url"],
  sessions: ["id", "project_id", "date", "start_time", "end_time", "status", "notes", "calendar_event_id", "created_at", "session_type", "photographer", "location", "title", "show_id", "cost"],
  social_campaigns: ["id", "project_id", "title", "artist_name", "release_date", "status", "marketing_angle", "target_audience", "main_message", "platforms", "owner_id", "notes", "created_at", "updated_at", "promotion_budget"],
  social_content_files: ["id", "content_item_id", "campaign_id", "project_id", "file_name", "file_type", "file_size", "dropbox_path", "dropbox_file_id", "dropbox_share_link", "uploaded_by", "created_at", "updated_at"],
  social_content_items: ["id", "campaign_id", "project_id", "title", "content_type", "status", "platform", "due_date", "publish_date", "owner_name", "asset_link", "dropbox_link", "calendar_event_id", "task_id", "caption", "hook", "notes", "posted_url", "created_at", "updated_at", "publish_time"],
  sound_engineer_work: ["id", "project_id", "engineer_name", "work_type", "status", "agreed_price", "currency", "amount_paid", "sent_date", "internal_deadline", "files_link", "notes", "linked_transaction_id", "created_at", "updated_at", "work_title", "sort_order", "payment_date"],
  tasks: ["id", "title", "notes", "status", "related_type", "related_id", "due_date", "start_time", "end_time", "calendar_event_id", "created_at", "updated_at", "show_id"],
  transactions: ["id", "project_id", "type", "date", "description", "artist", "amount", "currency", "payment_status", "payment_method", "receipt_ref", "notes", "category", "created_at", "linked_session_id", "scope", "expense_scope"],
  vendor_project_work: ["id", "vendor_name", "project_id", "status", "sent_date", "internal_deadline", "returned_date", "dropbox_folder", "dropbox_share_link", "quality", "entered_project", "notes", "files_sent", "files_received", "created_at", "updated_at", "work_state", "outcome", "linked_task_id", "title", "brief_text", "reference_links", "version_reviews", "brief_files"],
};

/** Columns read but REDUCED before reaching Sunny — bearer access material (INTENTIONALLY_SECRET) or an external id. */
export const PROJECT_REDUCED_COLUMNS: Readonly<Record<string, "SHARE_LINK_TO_BOOLEAN" | "EXTERNAL_ID_TO_BOOLEAN">> = {
  "project_actions.dropbox_url": "SHARE_LINK_TO_BOOLEAN",
  "sound_engineer_work.files_link": "SHARE_LINK_TO_BOOLEAN",
  "vendor_project_work.dropbox_share_link": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.ref_links": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.files_raw_link": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.files_edit_folder": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.version_1_link": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.version_2_link": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.final_version_link": "SHARE_LINK_TO_BOOLEAN",
  "red_films_productions.dropbox_folder_url": "SHARE_LINK_TO_BOOLEAN",
  "red_films_budget_payments.receipt_dropbox_url": "SHARE_LINK_TO_BOOLEAN",
  "social_content_items.asset_link": "SHARE_LINK_TO_BOOLEAN",
  "social_content_items.dropbox_link": "SHARE_LINK_TO_BOOLEAN",
  "social_content_files.dropbox_share_link": "SHARE_LINK_TO_BOOLEAN",
  "transactions.receipt_ref": "SHARE_LINK_TO_BOOLEAN",
  "sessions.calendar_event_id": "EXTERNAL_ID_TO_BOOLEAN",
  "meetings.calendar_event_id": "EXTERNAL_ID_TO_BOOLEAN",
  "tasks.calendar_event_id": "EXTERNAL_ID_TO_BOOLEAN",
  "social_content_items.calendar_event_id": "EXTERNAL_ID_TO_BOOLEAN",
};

/** JSON columns whose INSIDE carries links (file lists): read, with link keys reduced to a boolean. */
export const PROJECT_JSON_WITH_LINKS = ["projects.files", "vendor_project_work.files_sent", "vendor_project_work.files_received", "vendor_project_work.brief_files", "vendor_project_work.reference_links"] as const;

/** Columns Sunny reads through ANOTHER canonical reader (company state / Finance Brain / Victor store) — never read twice. */
export const PROJECT_COLUMNS_READ_ELSEWHERE: Readonly<Record<string, string>> = {
  project_release_details: "lib/partner/eyes/readers.ts",
  proposals: "lib/partner/eyes/readers.ts",
  transactions: "lib/partner/finance/readers.ts",
  "sound_engineer_work.linked_transaction_id": "lib/partner/finance/readers.ts",
  vendor_project_work: "lib/vendor-store.ts",
};

/** Reader source files whose SELECTs together must cover every column above. */
export const PROJECT_READER_FILES = [
  "lib/partner/projects/detail-reader.ts", "lib/partner/operations/readers.ts",
] as const;
