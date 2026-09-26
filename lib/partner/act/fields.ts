/**
 * SUNNY UNIVERSAL ACTION LAYER — accepted-field classification (guard G2).
 *
 * Every request-body key a write handler reads is either a production column the domain contracts already classify
 * (matched by name against the schema-column registries + the work-domain field maps), or it is classified here.
 * A new accepted key that is neither fails scripts/test-sunny-act-foundation.tsx.
 */
export type AcceptedFieldKind =
  /** a switch that changes what the handler does (not stored as such) */
  | "CONTROL_FLAG"
  /** optimistic-concurrency / stale-state token */
  | "CONCURRENCY_TOKEN"
  /** part of the existing Partner decide / execute protocol */
  | "APPROVAL_PROTOCOL"
  /** selects the target record(s) or files */
  | "TARGET_SELECTOR"
  /** an input the server turns into stored values (derived before writing) */
  | "DERIVED_INPUT"
  /** a real business value stored in a column the domain contracts do not list yet (knowledge gap, see reason) */
  | "BUSINESS_COLUMN_NOT_IN_CONTRACT"
  /** display / layout only */
  | "DISPLAY_ONLY"
  /** a value taken from the browser's clock — never trusted as business truth */
  | "CLIENT_CLOCK"
  /** a secret presented by a caller (never Sunny's) */
  | "CALLER_SECRET"
  /** an error report from the browser */
  | "ERROR_REPORT";

export const ACCEPTED_FIELD_CLASSES: Readonly<Record<string, { kind: AcceptedFieldKind; noteEn: string }>> = {
  acquired_date: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column (equipment is outside the video column registry)" },
  added_by: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column" },
  purchase_price: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column (money, no currency)" },
  purchased_from: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column" },
  quantity: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column" },
  serial_number: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films equipment column" },
  provider: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films reference-link column" },
  thumbnail_url: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films reference-link column" },
  video_id: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "Red Films reference-link column" },
  bpm: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "work-materials value stored on the engineer work (settings-backed)" },
  key: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "work-materials musical key (settings-backed)" },
  instructions: { kind: "BUSINESS_COLUMN_NOT_IN_CONTRACT", noteEn: "work-materials instructions (settings-backed)" },
  theme: { kind: "DISPLAY_ONLY", noteEn: "project cover theme" },
  posX: { kind: "DISPLAY_ONLY", noteEn: "avatar crop" },
  posY: { kind: "DISPLAY_ONLY", noteEn: "avatar crop" },
  zoom: { kind: "DISPLAY_ONLY", noteEn: "avatar crop" },
  useProjectsLayout: { kind: "CONTROL_FLAG", noteEn: "which folder layout the vendor folder uses" },
  addToCalendar: { kind: "CONTROL_FLAG", noteEn: "also create a calendar event (external effect)" },
  removeFromCalendar: { kind: "CONTROL_FLAG", noteEn: "also delete the calendar event (external effect)" },
  closeShow: { kind: "CONTROL_FLAG", noteEn: "close the show in the same save (finance / ledger effects)" },
  clearReceivedDate: { kind: "CONTROL_FLAG", noteEn: "clear the received date of media income" },
  force: { kind: "CONTROL_FLAG", noteEn: "close a balance cycle early" },
  skipFinanceSync: { kind: "CONTROL_FLAG", noteEn: "create engineer work without the price sync" },
  toArtist: { kind: "CONTROL_FLAG", noteEn: "send the cycle reminder to the artist (push)" },
  toOwner: { kind: "CONTROL_FLAG", noteEn: "send the cycle reminder to the Owner (push)" },
  seed: { kind: "CONTROL_FLAG", noteEn: "seed the 50/50 clip advance + final payments" },
  expectedUpdatedAt: { kind: "CONCURRENCY_TOKEN", noteEn: "optimistic concurrency" },
  expectedHeadEventId: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner decide: the event chain head seen" },
  seenSnapshotHash: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner decide: the snapshot the Owner saw" },
  actionId: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner action id" },
  approvalEventId: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner approval event id" },
  requestId: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner idempotency request id" },
  decision: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner decision (APPROVE / NOT_NOW / REJECT)" },
  deferChoice: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner NOT_NOW choice" },
  deferDateYmd: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner NOT_NOW date" },
  deferUntil: { kind: "APPROVAL_PROTOCOL", noteEn: "Partner NOT_NOW until" },
  ids: { kind: "TARGET_SELECTOR", noteEn: "bulk target ids (bulk delete / reorder)" },
  items: { kind: "TARGET_SELECTOR", noteEn: "intake file list" },
  sourcePath: { kind: "TARGET_SELECTOR", noteEn: "intake source path" },
  action: { kind: "TARGET_SELECTOR", noteEn: "intake operation (move / delete source)" },
  fileRef: { kind: "TARGET_SELECTOR", noteEn: "Victor file reference (scope-checked)" },
  sketchId: { kind: "TARGET_SELECTOR", noteEn: "sketch target" },
  versionKey: { kind: "TARGET_SELECTOR", noteEn: "Victor version target" },
  versionNumber: { kind: "TARGET_SELECTOR", noteEn: "sketch version target" },
  batchId: { kind: "TARGET_SELECTOR", noteEn: "final-files batch" },
  tracks: { kind: "TARGET_SELECTOR", noteEn: "album track order" },
  rows: { kind: "DERIVED_INPUT", noteEn: "album previous-system rows (whole-body settings write)" },
  updates: { kind: "DERIVED_INPUT", noteEn: "delivery whole-body update (needs hardening)" },
  field: { kind: "DERIVED_INPUT", noteEn: "project single-field edit: the field name (allow-listed server-side)" },
  value: { kind: "DERIVED_INPUT", noteEn: "project single-field edit: the value" },
  projectName: { kind: "DERIVED_INPUT", noteEn: "folder / project name used to build a path or the converted project" },
  newTitle: { kind: "DERIVED_INPUT", noteEn: "sketch → project link title" },
  anchorDate: { kind: "DERIVED_INPUT", noteEn: "balance-cycle anchor (stored in settings)" },
  artistPaidDate: { kind: "DERIVED_INPUT", noteEn: "date written onto the artist expense transaction" },
  businessType: { kind: "DERIVED_INPUT", noteEn: "project business type (stored as business_type)" },
  clipAgreedPrice: { kind: "DERIVED_INPUT", noteEn: "clip price (stored on the project clip deal)" },
  paidAmount: { kind: "DERIVED_INPUT", noteEn: "split income: the received part" },
  actual: { kind: "DERIVED_INPUT", noteEn: "promotion actual spend (written to its expense)" },
  startIso: { kind: "DERIVED_INPUT", noteEn: "session start → date + time" },
  endIso: { kind: "DERIVED_INPUT", noteEn: "session end → time" },
  summary: { kind: "DERIVED_INPUT", noteEn: "calendar event summary" },
  morningTime: { kind: "DERIVED_INPUT", noteEn: "report schedule (settings)" },
  eveningTime: { kind: "DERIVED_INPUT", noteEn: "report schedule (settings)" },
  clientNow: { kind: "CLIENT_CLOCK", noteEn: "auto-mark uses the device clock (known limitation)" },
  secret: { kind: "CALLER_SECRET", noteEn: "one-off migration secret (never Sunny's)" },
  error: { kind: "ERROR_REPORT", noteEn: "browser error report" },
  error_summary: { kind: "ERROR_REPORT", noteEn: "browser error report" },
};
