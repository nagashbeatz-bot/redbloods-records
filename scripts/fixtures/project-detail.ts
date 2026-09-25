/**
 * Test fixture — raw, DATABASE-SHAPED rows for the Project detail source (as the production columns name them), with
 * SECRETS deliberately planted (Dropbox share links, rlkey links, OAuth-looking tokens, receipt links) so the tests
 * prove they never leave the reader. Served through a recording fake client that only supports SELECT.
 */
import type { OperationsReadClient, OpsQuery } from "../../lib/partner/operations/readers";
import { readProjectDetailRaw } from "../../lib/partner/projects/detail-reader";
import type { ProjectDetailRaw } from "../../lib/partner/projects/detail-types";
import { P, U, C_AVI } from "./integrity-company";

export const SHARE = "https://www.dropbox.com/scl/fi/abc123/mix.wav?rlkey=SECRETKEY&dl=0";
export const TOKEN = "sl.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const LONG_NOTE = "א".repeat(5000);
export const PLANTED_SECRETS = [SHARE, "rlkey=SECRETKEY", TOKEN, "https://www.dropbox.com/s/privfile", "https://dl.dropboxusercontent.com/x/y", "https://dropbox.com/scl/receipt"];

const file = (name: string, extra: Record<string, unknown> = {}) => ({ name, url: "https://www.dropbox.com/s/privfile", dropboxShareUrl: SHARE, dropboxPath: `/Projects/אבי מולה/אבי 1/${name}`, uploadedAt: "2026-09-10T10:00:00Z", ...extra });

export const DETAIL_ROWS: Record<string, Record<string, unknown>[]> = {
  projects: [
    { id: P(2), created_at: "2026-08-01T09:00:00Z", monday_id: null, notes: `הלקוח אולי רוצה לדחות. קישור: ${SHARE}`, work_materials: { bpm: "95", key: "Am", instructions: `להדגיש בס ${TOKEN}` }, dropbox_folder: null,
      files: [file("mix1.wav", { category: "מאסטר", versionLabel: "V1", durationSeconds: 200 }), file("stems.zip", { category: "חומרי עבודה" }), file("steven-mix2.wav", { sourceMixVersionId: U(861), versionLabel: "Mix 2" })] },
    { id: P(1), created_at: "2026-07-01T09:00:00Z", monday_id: "m-1", notes: null, work_materials: null, dropbox_folder: "/Projects/שליו טסמה/שיר לייבל", files: [] },
    { id: P(4), created_at: "2026-07-01T09:00:00Z", monday_id: null, notes: LONG_NOTE, work_materials: null, dropbox_folder: null, files: [] },
  ],
  "settings:finance_": [{ key: `finance_${P(2)}`, fnotes: "שולם חצי במזומן", freason: null, fdate: null }],
  "settings:delivery_": [{ key: `delivery_${P(3)}`, folder: "/Projects/אבי מולה/אבי 2/Delivery", status: "ready", delivered: null, link: SHARE }],
  "settings:session_limit_": [{ key: `session_limit_${P(2)}`, value: 10 }],
  "settings:album_prev_info_": [{ key: `album_prev_info_${P(2)}`, value: { songs: [{ name: "x", paid: 100, shareUrl: SHARE }] } }],
  "settings:album_finance_": [], "settings:project_cover_": [],
  project_actions: [{ id: U(821), project_id: P(2), action_type: "sent", content_type: "mix", version_label: "Mix 2", recipient_role: "artist", recipient_name: "אבי", recipient_client_id: C_AVI, recipient_phone: "050-1234567", dropbox_url: SHARE, status: "pending_feedback", action_date: "2026-09-15", followup_date: "2026-09-20", notes: "שלחתי מיקס 2 לאבי", linked_task_id: U(871), linked_work_id: null, created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z" }],
  sessions: [{ id: U(900), project_id: P(2), show_id: null, date: "2026-08-25", start_time: "10:00", end_time: "14:00", status: "התקיים", session_type: "סשן", title: null, notes: "הקלטנו פזמון", location: "סטודיו", photographer: null, cost: null, calendar_event_id: "evt-900", created_at: "2026-08-20T10:00:00Z" }],
  meetings: [{ id: U(811), project_id: P(2), client_id: C_AVI, client_name: "אבי מולה", date: "2026-09-28", time: "12:00", duration: 60, location: "קפה", notes: "לדבר על קליפ", status: "נקבעה", calendar_event_id: "evt-811", created_at: "2026-09-20T10:00:00Z" }],
  tasks: [{ id: U(871), related_type: "project", related_id: P(2), title: "להתקשר לאבי", notes: "לשאול על תאריך", status: "פתוח", due_date: "2026-09-20", start_time: null, end_time: null, show_id: null, calendar_event_id: "gt-1", created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z" }],
  sound_engineer_work: [{ id: U(851), project_id: P(2), engineer_name: "Steven", notes: "מיקס + מאסטר", files_link: SHARE, sort_order: 1, created_at: "2026-09-10T10:00:00Z", updated_at: "2026-09-18T10:00:00Z" }],
  mix_versions: [{ id: U(861), sound_engineer_work_id: U(851), project_id: P(2), label: "Mix 2", file_name: "mix2.wav", dropbox_path: "/Steven/אבי 1/mix2.wav", file_size: 1000, file_type: "audio/wav", status: "בבדיקה", uploaded_by: "steven", duration_seconds: 200, uploaded_at: "2026-09-18T10:00:00Z", mix_target_id: null, created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-18T10:00:00Z" }],
  mix_comments: [{ id: U(881), mix_version_id: U(861), timestamp_seconds: 42, comment_text: "להוריד את הווקאל בפזמון", author: "owner", role: "mix", status: "open", created_at: "2026-09-19T10:00:00Z", updated_at: "2026-09-19T10:00:00Z" }],
  mix_comment_attachments: [{ id: U(882), comment_id: U(881), file_name: "screen.png", file_size: 10, dropbox_path: "/att/screen.png", mime_type: "image/png", uploaded_by: "owner", created_at: "2026-09-19T10:00:00Z" }],
  mix_targets: [], mix_target_notes: [],
  final_files: [],
  vendor_project_work: [{ id: U(701), project_id: P(2), notes: "ויקטור — הפקה", brief_text: "אווירה של קיץ", reference_links: [{ url: "https://youtube.com/watch?v=abc", title: "רפרנס", note: "הגרוב" }, { url: SHARE, title: "פרטי", note: null }],
    version_reviews: { V1: { status: "needs_revision", notes: "לתקן פתיח", sentNotes: "לתקן פתיח", sentAt: "2026-09-12T10:00:00Z", reviewedAt: "2026-09-12T09:00:00Z" }, V2: { status: "waiting", notes: "טיוטה שלא נשלחה", draft: true, reviewedAt: "2026-09-19T09:00:00Z" } },
    files_sent: [file("victor-v1.wav", { versionLabel: "V1" })], files_received: [], brief_files: [file("brief.wav", { segments: [{ id: "s1" }, { id: "s2" }] })], returned_date: null, outcome: null, quality: null, entered_project: null, dropbox_folder: "Victor/אבי מולה - אבי 1", dropbox_share_link: SHARE }],
  red_films_productions: [{ id: U(801), project_id: P(1), client_name: "שליו", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z", photographer_name: "דני לוי", director_name: "רון", editor_name: null, locations: "תל אביב", concept_summary: "קליפ לילה", concept_vibe: "כהה", ref_links: SHARE, script_start: "פתיחה ברחוב", script_middle: null, script_end: null, director_notes: "צילום אחד ארוך", photographer_notes: null, fix_notes: null, notes: "SECRETLINK https://www.dropbox.com/scl/fi/zzz?rlkey=SECRETKEY", published_where: null, dropbox_folder_path: "/Red Films/קליפ שליו", files_raw_link: SHARE, files_edit_folder: null, version_1_link: null, version_2_link: null, final_version_link: null, dropbox_folder_url: SHARE }],
  red_films_budget_items: [{ id: U(802), production_id: U(801), title: "צלם", category: "צלם", vendor_name: "דני לוי", status: "מתוכנן", planned_amount: 3000, actual_amount: null, linked_transaction_id: null, notes: "כולל עריכה", created_at: null, updated_at: null }],
  red_films_budget_payments: [{ id: U(803), production_id: U(801), budget_item_id: U(802), amount: 1000, payment_date: "2026-09-10", payment_method: "העברה", notes: "מקדמה לצלם", receipt_file_name: "receipt.pdf", receipt_mime_type: "application/pdf", receipt_dropbox_path: "/receipts/receipt.pdf", receipt_dropbox_url: "https://dropbox.com/scl/receipt", created_at: null, updated_at: null }],
  album_tracks: [],
  clip_items: [{ id: U(804), project_id: P(1), category: "תאורה", description: "פנסים", notes: "להזמין", status: "תכנון בלבד", created_at: null, updated_at: null }],
  proposals: [{ id: U(805), linked_project_id: P(2), client_id: C_AVI, title: "הצעה לאבי", notes: "כולל 3 סשנים" }],
  project_release_details: [{ project_id: P(1), next_action: "לסגור עטיפה", blocker: "מחכים לעטיפה מהמעצב", responsible: "שליו", stage_entered_at: "2026-09-01T10:00:00Z", released_at: null }],
  social_campaigns: [{ id: U(841), project_id: P(1), title: "קמפיין", marketing_angle: "קיץ", target_audience: "18-30", main_message: "שיר חדש", platforms: ["instagram"], notes: null, owner_id: null, created_at: null, updated_at: null }],
  social_content_items: [{ id: U(842), project_id: P(1), campaign_id: U(841), title: "ריל 1", content_type: "reel", status: "draft", platform: "instagram", due_date: "2026-09-20", publish_date: null, caption: `כיתוב ${SHARE}`, hook: "הוק", notes: null, owner_name: "שליו", posted_url: null, asset_link: SHARE, dropbox_link: null, calendar_event_id: "evt-842", task_id: null, publish_time: null, created_at: null, updated_at: null }],
  social_content_files: [{ id: U(843), project_id: P(1), content_item_id: U(842), campaign_id: U(841), file_name: "reel.mp4", file_type: "video/mp4", file_size: 100, uploaded_by: "owner", created_at: null, updated_at: null, dropbox_path: `/${P(1)}/Social/reel.mp4`, dropbox_file_id: "id:abc", dropbox_share_link: SHARE }],
  notifications: [{ id: U(844), project_id: P(2), recipient_user_id: null, recipient_role: "owner", title: "Steven העלה מיקס", body: "Mix 2 מוכן להאזנה", url: "/sound-engineer", tag: "steven", actor_name: "Steven", entity_type: "mix_version", entity_id: U(861), event_key: "k", created_at: "2026-09-18T10:05:00Z", read_at: null }],
  transactions: [{ id: U(845), project_id: P(2), type: "income", date: "2026-09-01", description: "מקדמה", notes: "מזומן", payment_method: "מזומן", artist: "אבי מולה", receipt_ref: "https://dropbox.com/scl/receipt", created_at: null }],
  agent_alerts: [{ id: U(846), related_project_id: P(2), related_client_id: null, type: "deadline", severity: "high", title: "דדליין עבר", message: "הפרויקט באיחור", metadata: { url: "https://www.dropbox.com/s/privfile", days: 3 }, suggested_actions: [], status: "handled", source: "agent", sent_notification: false, entity_key: `deadline:${P(2)}`, created_at: "2026-09-02T10:00:00Z", updated_at: "2026-09-03T10:00:00Z" }],
};

export function fakeDetailClient() {
  const calls: Array<{ table: string; columns: string; like: string | null }> = [];
  const client: OperationsReadClient = {
    from(table: string) {
      return {
        select(columns: string) {
          let like: string | null = null;
          const call = { table, columns, like: null as string | null };
          calls.push(call);
          const q: OpsQuery = {
            range(from: number, to: number) { const key = table === "settings" ? `settings:${(like ?? "").replace("%", "")}` : table; const all = DETAIL_ROWS[key] ?? []; const data = all.slice(from, to + 1); return { then: (res: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve(res({ data, error: null })) } as unknown as OpsQuery; },
            like(_c: string, pattern: string) { like = pattern; call.like = pattern; return q; },
            in() { return q; },
            then: undefined as never,
          } as unknown as OpsQuery;
          return q;
        },
      };
    },
  };
  return { client, calls };
}

export async function projectDetailFixture(): Promise<ProjectDetailRaw> {
  return readProjectDetailRaw(fakeDetailClient().client);
}
