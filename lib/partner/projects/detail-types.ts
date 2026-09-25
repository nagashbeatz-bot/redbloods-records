/**
 * Sunny PROJECT_DETAIL source — the typed shape (pure, no runtime imports). Filled by detail-reader.ts.
 *
 * This is the project's HUMAN CONTEXT + MATERIAL METADATA: every non-secret free-text and file field Redbloods stores
 * about a project (notes, instructions, comments, reviews, crew names, captions, notifications, file / version
 * metadata). Owner-only. Free text is OWNER / VENDOR TEXT — evidence, never a canonical structured fact.
 *
 * SECRETS ARE NOT KNOWLEDGE: every share link / public URL / access handle column is replaced by a boolean
 * (`hasLink` / `hasShareLink`), and bearer-looking URLs / tokens inside free text are redacted by the reader.
 */
import type { Section, Maybe } from "../operations/types";
export type { Section, Maybe };

export interface DetailFile {
  name: string; category: string | null; versionLabel: string | null; trackId: string | null; durationSeconds: number | null; size: number | null;
  uploadedAt: string | null; path: string | null; hasShareLink: boolean; fromMixVersionId: string | null; structureMarkers: number;
  /** Victor work files only: "owner" / "victor" as recorded at upload (since 2026-09-25); null = not recorded. */
  uploadedBy?: string | null;
}
export interface DetailProject { id: string; createdAt: string | null; legacyMondayId: string | null; notes: string | null; workMaterials: { bpm: string | null; key: string | null; instructions: string | null } | null; dropboxFolder: string | null; files: DetailFile[] }
export interface DetailFinanceNote { projectId: string; financialNotes: string | null; exceptionReason: string | null; exceptionDate: string | null; hasSetting: true }
export interface DetailDelivery { projectId: string; folderPath: string | null; status: string | null; deliveredAt: string | null; hasLink: boolean }
export interface DetailAction {
  id: string; projectId: string | null; actionType: string | null; contentType: string | null; versionLabel: string | null; recipientRole: string | null; recipientName: string | null;
  recipientClientId: string | null; recipientPhone: string | null; hasLink: boolean; status: string | null; actionDate: string | null; followupDate: string | null; notes: string | null;
  linkedWorkId: string | null; linkedTaskId: string | null; createdAt: string | null; updatedAt: string | null;
}
export interface DetailSession { id: string; projectId: string | null; showId: string | null; date: string | null; startTime: string | null; endTime: string | null; status: string | null; type: string | null; title: string | null; notes: string | null; location: string | null; photographer: string | null; cost: number | null; hasCalendarEvent: boolean; createdAt: string | null }
export interface DetailMeeting { id: string; createdAt: string | null; projectId: string | null; clientId: string | null; clientName: string | null; date: string | null; time: string | null; duration: number | null; location: string | null; notes: string | null; status: string | null; hasCalendarEvent: boolean }
export interface DetailTask { id: string; relatedType: string | null; relatedId: string | null; title: string | null; notes: string | null; status: string | null; dueDate: string | null; startTime: string | null; endTime: string | null; showId: string | null; hasGoogleTask: boolean; createdAt: string | null; updatedAt: string | null }
export interface DetailEngineerWork {
  id: string; projectId: string | null; engineerName: string | null; notes: string | null; hasFilesLink: boolean; sortOrder: number | null; createdAt: string | null; updatedAt: string | null;
  /** Mix Deep Brain (optional so older fixtures stay valid): the full engineer work record. */
  workTitle?: string | null; workType?: string | null; status?: string | null; agreedPrice?: number | null; currency?: string | null; amountPaid?: number | null;
  sentDate?: string | null; internalDeadline?: string | null; linkedTransactionId?: string | null; paymentDate?: string | null;
}
export interface DetailMixVersion { id: string; workId: string | null; projectId: string | null; label: string | null; fileName: string | null; status: string | null; uploadedBy: string | null; durationSeconds: number | null; uploadedAt: string | null; targetId: string | null; path: string | null; size: number | null; type: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailMixComment { id: string; versionId: string | null; timestampSeconds: number | null; text: string | null; author: string | null; role: string | null; status: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailCommentAttachment { commentId: string | null; fileName: string | null; size: number | null; path: string | null; mimeType: string | null; uploadedBy: string | null; createdAt: string | null }
export interface DetailMixTarget { id: string; workId: string | null; kind: string | null; displayName: string | null; sortOrder: number | null; removedAt: string | null; createdAt: string | null }
export interface DetailMixTargetNote { targetId: string | null; text: string | null; author: string | null; status: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailFinalFile { workId: string | null; projectId: string | null; fileName: string | null; path: string | null; fileType: string | null; fileSize: number | null; uploadedBy: string | null; createdAt: string | null }
export interface DetailVictorReview { version: string; status: string | null; notes: string | null; sentNotes: string | null; sentAt: string | null; draft: boolean; reviewedAt: string | null }
export interface DetailVictorWork {
  id: string; projectId: string | null; notes: string | null; briefText: string | null;
  /** Additive (Victor Deep Brain): the work record itself — vendor, title, status, work state, dates, deadline task. Optional for older fixtures. */
  vendorName?: string | null; title?: string | null; status?: string | null; workState?: string | null; sentDate?: string | null; internalDeadline?: string | null; linkedTaskId?: string | null; createdAt?: string | null; updatedAt?: string | null; references: Array<{ title: string | null; note: string | null; publicUrl: string | null }>; reviews: DetailVictorReview[];
  filesSent: DetailFile[]; filesReceived: DetailFile[]; briefFiles: DetailFile[]; returnedDate: string | null; outcome: string | null; quality: string | null; enteredProject: unknown; dropboxFolder: string | null; hasFolderLink: boolean;
}
export interface DetailProduction {
  id: string; projectId: string | null; clientNameSnapshot: string | null; createdAt: string | null; updatedAt: string | null; photographer: string | null; director: string | null; editor: string | null; locations: string | null; conceptSummary: string | null; conceptVibe: string | null;
  script: { start: string | null; middle: string | null; end: string | null }; directorNotes: string | null; photographerNotes: string | null; fixNotes: string | null; notes: string | null; publishedWhere: string | null;
  dropboxFolderPath: string | null; links: { references: boolean; rawFiles: boolean; editFolder: boolean; version1: boolean; version2: boolean; finalVersion: boolean; folder: boolean };
}
export interface DetailBudgetItem { id: string | null; linkedTransactionId: string | null; createdAt: string | null; updatedAt: string | null; productionId: string | null; title: string | null; category: string | null; vendorName: string | null; status: string | null; planned: number | null; actual: number | null; notes: string | null }
export interface DetailAlbumTrack { projectId: string | null; trackNumber: number | null; title: string | null; notes: string | null }
export interface DetailClipItem { id: string | null; createdAt: string | null; updatedAt: string | null; projectId: string | null; category: string | null; description: string | null; notes: string | null; status: string | null }
export interface DetailProposal { id: string; linkedProjectId: string | null; clientId: string | null; title: string | null; notes: string | null }
export interface DetailRelease { projectId: string; nextAction: string | null; blocker: string | null; responsible: string | null; stageEnteredAt: string | null; releasedAt: string | null }
export interface DetailCampaign { id: string; projectId: string | null; title: string | null; marketingAngle: string | null; targetAudience: string | null; mainMessage: string | null; platforms: string[]; notes: string | null; ownerUserId: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailContentItem { id: string; projectId: string | null; campaignId: string | null; title: string | null; contentType: string | null; status: string | null; platform: string | null; dueDate: string | null; publishDate: string | null; caption: string | null; hook: string | null; notes: string | null; ownerName: string | null; postedUrl: string | null; hasAssetLink: boolean; hasCalendarEvent: boolean; taskId: string | null; publishTime: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailSocialFile { projectId: string | null; contentItemId: string | null; campaignId: string | null; dropboxFileId: string | null; updatedAt: string | null; fileName: string | null; fileType: string | null; fileSize: number | null; uploadedBy: string | null; createdAt: string | null; path: string | null; hasShareLink: boolean }
export interface DetailTransactionText { id: string; projectId: string; type: string | null; date: string | null; description: string | null; notes: string | null; paymentMethod: string | null; artistText: string | null; hasReceipt: boolean; createdAt: string | null }
export interface DetailBudgetPayment { productionId: string | null; budgetItemId: string | null; amount: number | null; date: string | null; method: string | null; notes: string | null; receiptFileName: string | null; receiptMime: string | null; receiptPath: string | null; hasReceiptLink: boolean; createdAt: string | null; updatedAt: string | null }
export interface DetailAgentAlert { projectId: string; type: string | null; severity: string | null; title: string | null; message: string | null; status: string | null; source: string | null; relatedClientId: string | null; metadata: unknown; suggestedActions: unknown; sentNotification: unknown; entityKey: string | null; createdAt: string | null; updatedAt: string | null }
export interface DetailProjectSetting { projectId: string; kind: string; value: unknown }
export interface DetailNotification { projectId: string; recipientRole: string | null; title: string | null; body: string | null; tag: string | null; actorName: string | null; entityType: string | null; entityId: string | null; eventKey: string | null; appPath: string | null; recipientUserId: string | null; createdAt: string | null; readAt: string | null }

export interface ProjectDetailRaw {
  projects: Maybe<DetailProject>;
  financeNotes: Maybe<DetailFinanceNote>;
  deliveries: Maybe<DetailDelivery>;
  actions: Maybe<DetailAction>;
  sessions: Maybe<DetailSession>;
  meetings: Maybe<DetailMeeting>;
  tasks: Maybe<DetailTask>;
  engineerWork: Maybe<DetailEngineerWork>;
  mixVersions: Maybe<DetailMixVersion>;
  mixComments: Maybe<DetailMixComment>;
  commentAttachments: Maybe<DetailCommentAttachment>;
  mixTargets: Maybe<DetailMixTarget>;
  mixTargetNotes: Maybe<DetailMixTargetNote>;
  finalFiles: Maybe<DetailFinalFile>;
  victor: Maybe<DetailVictorWork>;
  productions: Maybe<DetailProduction>;
  budgetItems: Maybe<DetailBudgetItem>;
  albumTracks: Maybe<DetailAlbumTrack>;
  clipItems: Maybe<DetailClipItem>;
  proposals: Maybe<DetailProposal>;
  releases: Maybe<DetailRelease>;
  campaigns: Maybe<DetailCampaign>;
  contentItems: Maybe<DetailContentItem>;
  socialFiles: Maybe<DetailSocialFile>;
  projectSettings: Maybe<DetailProjectSetting>;
  transactionsText: Maybe<DetailTransactionText>;
  budgetPayments: Maybe<DetailBudgetPayment>;
  agentAlerts: Maybe<DetailAgentAlert>;
  notifications: Maybe<DetailNotification>;
}

/** Every table / setting family the detail source reads — the coverage test compares it with the schema map. */
export const PROJECT_DETAIL_SOURCES = [
  "projects", "settings:finance_", "settings:delivery_", "project_actions", "sessions", "meetings", "tasks", "sound_engineer_work", "mix_versions", "mix_comments",
  "mix_comment_attachments", "mix_targets", "mix_target_notes", "final_files", "vendor_project_work", "red_films_productions", "red_films_budget_items", "album_tracks",
  "clip_items", "proposals", "project_release_details", "social_campaigns", "social_content_items", "social_content_files", "notifications", "transactions", "red_films_budget_payments", "agent_alerts", "settings:album_finance_", "settings:album_prev_info_", "settings:session_limit_", "settings:project_cover_", "settings:steven_final_files_requested_project:", "settings:steven_final_files_requested:",
] as const;
