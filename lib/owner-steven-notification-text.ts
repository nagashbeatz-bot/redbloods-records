// ── Owner bell: Steven's notifications, shown in Hebrew ───────────────────────
// Display-only, Owner-only. Steven's pushes are authored in English at creation
// (lib/steven-notify.ts, steven-mix-ready-notify.ts, steven-notes-notify.ts,
// steven-payment-notify.ts) — and several of those are ONE payload delivered to
// both the Owner and Steven, so the source text cannot change without changing
// Steven's. This maps the Owner's copy at render time instead: the stored rows,
// the push text, the tags, the urls and every entity/project field are untouched,
// and Steven's own bell (role "steven", English) never calls this.
//
// Only the *system* wording is translated. Everything that is real data — work /
// project / song names, Mix + version labels, file names, roles, currency and
// amounts — is captured out of the original string and re-inserted verbatim.
// Anything that does not match a known template is returned as-is (never guessed,
// never blanked), so a future wording change degrades to the original English.
//
// Wording follows the Owner-facing Victor pattern (lib/victor-*-notify*.ts):
// "<name> העלה קבצים" title + a short Hebrew body, and "… נשלחה/נשלח לסטיבן" for
// confirmations of things the Owner sent.

export interface OwnerNotifText { title: string; body: string | null }

type Rule = (title: string, body: string | null) => OwnerNotifText | null;

// Default names the senders fall back to when a work has no name.
const heDefaultName = (s: string) => (s === "a project" ? "פרויקט" : s === "a work" ? "עבודה" : s);

// ── steven-upload-* (coalesced upload batch) ─────────────────────────────────
const UPLOAD_TITLES: Record<string, string> = {
  "Steven uploaded a file": "סטיבן העלה קובץ",
  "Steven uploaded files": "סטיבן העלה קבצים",
};
function uploadBody(body: string): string | null {
  let m: RegExpMatchArray | null;
  // "1 file uploaded to <head>" — riddim or single file with a shared target
  if ((m = body.match(/^1 file uploaded to ([\s\S]+)$/))) return `הועלה קובץ לפרויקט ${m[1]}`;
  // "<N> files uploaded to <work>[ · label][ · roles]" / "<N> files uploaded to <head>"
  if ((m = body.match(/^(\d+) files uploaded to ([\s\S]+)$/))) return `הועלו ${m[1]} קבצים לפרויקט ${m[2]}`;
  // "<file name> uploaded to <work>[ · label][ (role)]" ("A file" = the sender's no-name fallback)
  if ((m = body.match(/^([\s\S]+?) uploaded to ([\s\S]+)$/))) {
    return m[1] === "A file"
      ? `הועלה קובץ לפרויקט ${heDefaultName(m[2])}`
      : `הועלה הקובץ ${m[1]} לפרויקט ${heDefaultName(m[2])}`;
  }
  return null;
}
const upload: Rule = (title, body) => {
  const t = UPLOAD_TITLES[title];
  if (!t) return null;
  return { title: t, body: body == null ? null : (uploadBody(body) ?? body) };
};

// ── presence (mirrors Victor: "Victor נכנס לעמוד שלו" / "…לפורטל העבודה שלו") ──
const visit: Rule = (title, body) =>
  title === "Steven visited his page"
    ? { title: "סטיבן נכנס לעמוד שלו", body: body === "Steven opened his work dashboard" ? "סטיבן נכנס עכשיו לפורטל העבודה שלו" : body }
    : null;
const login: Rule = (title, body) =>
  title === "Steven logged in"
    ? { title: "סטיבן התחבר", body: body === "Steven signed in to Redbloods OS" ? "סטיבן התחבר ל-Redbloods OS" : body }
    : null;

// ── Steven's final files (no tag) — already Hebrew, only the name is Latin ──
const FINAL_TITLE = "Steven העלה קבצים סופיים";
const finalFiles: Rule = (title, body) => {
  if (title !== FINAL_TITLE) return null;
  let b = body;
  let m: RegExpMatchArray | null;
  if (b && (m = b.match(/^Steven העלה קובץ סופי ל-([\s\S]+)$/))) b = `סטיבן העלה קובץ סופי ל-${m[1]}`;
  else if (b && (m = b.match(/^Steven העלה (\d+) קבצים סופיים ל-([\s\S]+)$/))) b = `סטיבן העלה ${m[1]} קבצים סופיים ל-${m[2]}`;
  return { title: "סטיבן העלה קבצים סופיים", body: b };
};

// ── steven-completed-owner-* / steven-project-sync-failed-* (already Hebrew;
//    only the Latin "Steven" inside the system sentence → "סטיבן"). The quoted
//    work name is captured, never pattern-replaced. ──
const completedOwner: Rule = (title, body) => {
  let t: string | null = null;
  if (title === "התראה נשלחה ל-Steven") t = "התראה נשלחה לסטיבן";
  else if (title === "התראה ל-Steven לא נשלחה") t = "התראה לסטיבן לא נשלחה";
  if (!t) return null;
  let b = body;
  let m: RegExpMatchArray | null;
  if (b) {
    if ((m = b.match(/^נשלחה ל-Steven התראה שהפרויקט "([\s\S]*)" הושלם ושיש להעלות קבצים סופיים\.$/))) {
      b = `נשלחה לסטיבן התראה שהפרויקט "${m[1]}" הושלם ושיש להעלות קבצים סופיים.`;
    } else if (b === "נשלחה ל-Steven התראה שהפרויקט הושלם ושיש להעלות קבצים סופיים.") {
      b = "נשלחה לסטיבן התראה שהפרויקט הושלם ושיש להעלות קבצים סופיים.";
    } else if ((m = b.match(/^לא ניתן היה לשלוח ל-Steven התראה עבור "([\s\S]*)"\.( אין ל-Steven מכשיר רשום להתראות\.| השליחה נכשלה\.)$/))) {
      b = `לא ניתן היה לשלוח לסטיבן התראה עבור "${m[1]}".${m[2].replace("ל-Steven", "לסטיבן")}`;
    } else if ((m = b.match(/^לא ניתן היה לשלוח ל-Steven התראה\.( אין ל-Steven מכשיר רשום להתראות\.| השליחה נכשלה\.)$/))) {
      b = `לא ניתן היה לשלוח לסטיבן התראה.${m[1].replace("ל-Steven", "לסטיבן")}`;
    }
  }
  return { title: t, body: b };
};
const syncFailed: Rule = (title, body) => {
  if (title !== "סנכרון הפרויקט נכשל") return null;
  const m = body?.match(/^((?:"[\s\S]*": )?)העבודה של Steven סומנה כהושלמה, אך לא ניתן היה לעדכן את סטטוס הפרויקט\.$/);
  return { title, body: m ? `${m[1]}העבודה של סטיבן סומנה כהושלמה, אך לא ניתן היה לעדכן את סטטוס הפרויקט.` : body };
};

// ── steven-mix-ready-* (same payload also goes to Steven) ──
const mixReady: Rule = (title, body) => {
  if (title !== "New mix job") return null;
  let b = body;
  let m: RegExpMatchArray | null;
  if (b === "Files and notes are ready for you.") b = "הקבצים וההערות מוכנים";
  else if (b && (m = b.match(/^([\s\S]*) · Files and notes are ready for you\.$/))) b = `${m[1]} · הקבצים וההערות מוכנים`;
  return { title: "עבודת מיקס נשלחה לסטיבן", body: b };
};

// ── steven-mix-notes-* (owner copy of what was sent to Steven) ──
const mixNotes: Rule = (title, body) => {
  let t: string | null = null;
  let m: RegExpMatchArray | null;
  if (title === "New mix notes from Redbloods") t = "הערות מיקס נשלחו לסטיבן";
  else if ((m = title.match(/^([\s\S]+): New notes added$/))) t = `${m[1]}: הערות חדשות נשלחו לסטיבן`;
  if (!t) return null;
  let b = body;
  if (b && (m = b.match(/^Notes were added for ([\s\S]*)\. Tap to review the feedback\.$/))) b = `נוספו הערות עבור ${heDefaultName(m[1])}`;
  return { title: t, body: b };
};

// ── steven-payment-* (same payload also goes to Steven) ──
const payment: Rule = (title, body) => {
  if (title !== "Payment sent") return null;
  let b = body;
  let m: RegExpMatchArray | null;
  if (b && (m = b.match(/^([\s\S]*) · Paid\. Thank you for the work!$/))) b = `${heDefaultName(m[1])} · שולם`;
  else if (b && (m = b.match(/^([\s\S]*) · (\S+) paid\. Thank you for the work!$/))) b = `${heDefaultName(m[1])} · שולם ${m[2]}`;
  return { title: "התשלום נשלח לסטיבן", body: b };
};

/** The Hebrew Owner view of one of Steven's notifications, or the input
 *  unchanged when it is not one (or its wording isn't a known template). */
export function localizeStevenForOwner(n: { tag: string | null; title: string; body: string | null }): OwnerNotifText {
  const tag = (n.tag ?? "").trim();
  const title = (n.title ?? "").trim();
  let out: OwnerNotifText | null = null;

  if (tag.startsWith("steven-upload-")) out = upload(title, n.body);
  else if (tag === "steven-visit") out = visit(title, n.body);
  else if (tag === "steven-login") out = login(title, n.body);
  else if (tag.startsWith("steven-completed-owner-")) out = completedOwner(title, n.body);
  else if (tag.startsWith("steven-project-sync-failed-")) out = syncFailed(title, n.body);
  else if (tag.startsWith("steven-mix-ready-")) out = mixReady(title, n.body);
  else if (tag.startsWith("steven-mix-notes-")) out = mixNotes(title, n.body);
  else if (tag.startsWith("steven-payment-")) out = payment(title, n.body);
  else if (!tag) out = finalFiles(title, n.body); // the final-files push carries no tag

  return out ?? { title: n.title, body: n.body };
}
