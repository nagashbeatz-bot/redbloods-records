/**
 * SUNNY UNIVERSAL ACTION LAYER — business event → action mapping (guard G6).
 *
 * Every business action the system contract names (BUSINESS_ACTIONS) and every Owner-model business event
 * (WORKFLOW_MODELS) resolves to the registered action contracts that carry it out — or to an explicit, reasoned
 * classification. "רוני שילם לי 3,000" is an event; the actions are what Redbloods must record because of it.
 */
export type EventMapping =
  | { kind: "ACTIONS"; actions: readonly string[]; noteHe?: string }
  | { kind: "READ_OR_LEARN_ONLY"; reason: string }
  | { kind: "SECURITY_EXCLUDED"; reason: string };

/** BUSINESS_ACTIONS id → contracts. */
export const BUSINESS_ACTION_MAP: Readonly<Record<string, EventMapping>> = {
  UPDATE_PROJECT_DEADLINE: { kind: "ACTIONS", actions: ["UPDATE_PROJECT_DEADLINE", "PROJECT.EDIT_DEADLINE"] },
  RECORD_PAID_EXPENSE: { kind: "ACTIONS", actions: ["RECORD_PAID_EXPENSE", "VICTOR.RECORD_SALARY_EXPENSE"] },
  RECORD_RECEIVED_INCOME: { kind: "ACTIONS", actions: ["PROJECT.SPLIT_INCOME", "PROJECT.EDIT_TRANSACTION"] },
  SET_PROJECT_AGREED_PRICE: { kind: "ACTIONS", actions: ["PROJECT.SET_PRICE"] },
  CREATE_SHOW: { kind: "ACTIONS", actions: ["SHOW.CREATE_SHOW"], noteHe: "DJ CLEANTONE: 500₪ ברירת מחדל תפעולית שמוצגת בתצוגה ואפשר לשנות; לא כל הופעה כוללת את קלינטון" },
  UPDATE_SHOW_STATUS: { kind: "ACTIONS", actions: ["SHOW.EDIT_SHOW"] },
  CLOSE_SHOW: { kind: "ACTIONS", actions: ["SHOW.CLOSE_SHOW"] },
  ASSIGN_SHOW_DJ: { kind: "ACTIONS", actions: ["SHOW.ASSIGN_DJ"] },
  NOTIFY_ARTIST_DJ: { kind: "ACTIONS", actions: ["SHOW.NOTIFY_ARTIST", "SHOW.NOTIFY_DJ"] },
  CREATE_PROJECT: { kind: "ACTIONS", actions: ["PROJECT.CREATE_PROJECT", "CLIENT.NEW_PROJECT_FROM_CLIENT"] },
  UPDATE_PROJECT_STATUS: { kind: "ACTIONS", actions: ["PROJECT.CHANGE_STATUS", "PROJECT.STATUS_COMPLETE_CLIENT_FLOW", "PROJECT.STATUS_CANCEL_BALANCE"] },
  DELETE_PROJECT: { kind: "ACTIONS", actions: ["PROJECT.DELETE_PROJECT"] },
  CONVERT_PROPOSAL: { kind: "ACTIONS", actions: ["CLIENT.CONVERT_PROPOSAL"] },
  CREATE_PROPOSAL: { kind: "ACTIONS", actions: ["CLIENT.CREATE_PROPOSAL"] },
  CREATE_TRANSACTION: { kind: "ACTIONS", actions: ["PROJECT.ADD_TRANSACTION"] },
  EDIT_OR_DELETE_TRANSACTION: { kind: "ACTIONS", actions: ["PROJECT.EDIT_TRANSACTION", "PROJECT.DELETE_TRANSACTION"] },
  SPLIT_INCOME: { kind: "ACTIONS", actions: ["PROJECT.SPLIT_INCOME"] },
  CREATE_SESSION: { kind: "ACTIONS", actions: ["PROJECT.ADD_SESSION", "CLIENT.SESSION_FROM_CLIENT", "LABEL.ARTIST_SESSION"] },
  CALENDAR_WRITE: { kind: "ACTIONS", actions: ["CALENDAR.CREATE_EVENT", "CALENDAR.UPDATE_OR_DELETE_EVENT"] },
  CREATE_CALENDAR_EVENT: { kind: "ACTIONS", actions: ["CALENDAR.CREATE_EVENT", "PROJECT.CALENDAR_INVITE"] },
  UPDATE_CALENDAR_EVENT: { kind: "ACTIONS", actions: ["CALENDAR.UPDATE_OR_DELETE_EVENT"] },
  DELETE_CALENDAR_EVENT: { kind: "ACTIONS", actions: ["CALENDAR.UPDATE_OR_DELETE_EVENT"] },
  SCHEDULE_SESSION: { kind: "ACTIONS", actions: ["PROJECT.ADD_SESSION", "PROJECT.CALENDAR_INVITE"] },
  SCHEDULE_MEETING: { kind: "ACTIONS", actions: ["PROJECT.ADD_MEETING", "CLIENT.CREATE_MEETING"] },
  RESCHEDULE_EVENT: { kind: "ACTIONS", actions: ["PROJECT.EDIT_SESSION", "CALENDAR.UPDATE_OR_DELETE_EVENT"], noteHe: "שינוי תאריך סשן בלבד לא מזיז את היומן — דורש הקשחה" },
  CREATE_TASK: { kind: "ACTIONS", actions: ["PROJECT.ADD_TASK", "CLIENT.CLIENT_TASK"] },
  BALANCE_ENTRY: { kind: "ACTIONS", actions: ["LABEL.LEDGER_ENTRY"] },
  CLOSE_BALANCE_CYCLE: { kind: "ACTIONS", actions: ["LABEL.CLOSE_CYCLE"] },
  MEDIA_INCOME_WRITE: { kind: "ACTIONS", actions: ["LABEL.MEDIA_INCOME"] },
  RELEASE_STAGE: { kind: "ACTIONS", actions: ["CHANGE_RELEASE_STAGE", "LABEL.UPDATE_RELEASE"] },
  VICTOR_SALARY: { kind: "ACTIONS", actions: ["VICTOR.RECORD_SALARY_EXPENSE", "VICTOR.SALARY_OVERRIDES"] },
  SEND_VICTOR_WORK: { kind: "ACTIONS", actions: ["VICTOR.SEND_TO_VICTOR", "VICTOR.NOTIFY_WORK"] },
  STEVEN_PAYMENT: { kind: "ACTIONS", actions: ["MIX.RECORD_PAYMENT"] },
  MIX_WORKFLOW: { kind: "ACTIONS", actions: ["MIX.ASSIGN_ENGINEER", "MIX.SEND_TO_ENGINEER", "MIX.SEND_NOTES", "MIX.MARK_COMPLETED"] },
  BEAT_ASSIGN: { kind: "ACTIONS", actions: ["LABEL.ASSIGN_BEAT"] },
  RED_FILMS_WRITE: { kind: "ACTIONS", actions: ["RF.CREATE_PRODUCTION", "RF.EDIT_PRODUCTION", "RF.SEND_CLIP"] },
  CLIP_PROMOTE: { kind: "ACTIONS", actions: ["RF.PROMOTE_CLIP_ROW", "PROJECT.PROMOTE_CLIP_ITEM"] },
  SOCIAL_WRITE: { kind: "ACTIONS", actions: ["PROJECT.SOCIAL", "UPDATE_SOCIAL_CONTENT"] },
  DROPBOX_WRITE: { kind: "ACTIONS", actions: ["PROJECT.UPLOAD_PROJECT_FILE", "PROJECT.DELETE_PROJECT_FILE", "FILES.FOLDER_LINK"] },
  SEND_PUSH: { kind: "ACTIONS", actions: ["MIX.SEND_TO_ENGINEER", "VICTOR.NOTIFY_WORK", "SHOW.NOTIFY_ARTIST"], noteHe: "Push רק כתוצאה של פעולה עסקית מאושרת — לעולם לא Push חופשי" },
  SEND_REPORT: { kind: "ACTIONS", actions: ["REPORTS.SEND"] },
  AGENT_ALERTS_WRITE: { kind: "ACTIONS", actions: ["MARK_AGENT_ALERT_HANDLED"] },
  SETTINGS_AUTH_PEOPLE: { kind: "SECURITY_EXCLUDED", reason: "auth / roles / credentials stay with the Boss" },
  TEACH_KNOWLEDGE: { kind: "READ_OR_LEARN_ONLY", reason: "typed P2 knowledge (preview → confirm), not a business write" },
  ANSWER_QUESTION: { kind: "READ_OR_LEARN_ONLY", reason: "the P1 answer bridge; answers are knowledge, not business writes" },
};

/** Owner-model business events (WORKFLOW_MODELS) → contracts. */
export const WORKFLOW_EVENT_MAP: Readonly<Record<string, EventMapping>> = {
  NEW_SHOW: { kind: "ACTIONS", actions: ["SHOW.CREATE_SHOW", "SHOW.ASSIGN_DJ", "SHOW.NOTIFY_ARTIST", "SHOW.NOTIFY_DJ"] },
  NEW_PROJECT: { kind: "ACTIONS", actions: ["PROJECT.CREATE_PROJECT", "PROJECT.SET_PRICE", "UPDATE_PROJECT_DEADLINE"] },
  NEW_CLIENT_OR_LEAD: { kind: "ACTIONS", actions: ["CLIENT.CREATE_CLIENT", "CLIENT.CREATE_PROPOSAL"] },
  NEW_PAYMENT: { kind: "ACTIONS", actions: ["PROJECT.SPLIT_INCOME", "PROJECT.ADD_TRANSACTION", "RECORD_PAID_EXPENSE"], noteHe: "התקבל / שולם בלבד = כסף שהתקבל; חלקי ≠ שולם; מטבעות לא מחוברים" },
  NEW_SESSION: { kind: "ACTIONS", actions: ["PROJECT.ADD_SESSION", "PROJECT.CALENDAR_INVITE"] },
  NEW_RELEASE: { kind: "ACTIONS", actions: ["PROJECT.CREATE_LABEL_SONG", "PROJECT.CONVERT_TO_RELEASE", "CHANGE_RELEASE_STAGE"] },
  NEW_CLIP: { kind: "ACTIONS", actions: ["RF.SEND_CLIP", "PROJECT.OPEN_CLIP_DEAL", "RF.CLIP_ROWS"] },
  NEW_TASK: { kind: "ACTIONS", actions: ["PROJECT.ADD_TASK"] },
};
