import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sendPushToAll } from "@/lib/push";

/**
 * Owner-only push for Steven's activity — login, page visit, and file uploads.
 * Mirrors the Victor upload-notify pattern: all state lives in the existing
 * `settings` key/value table (NO schema change), and `sendPushToAll` only ever
 * reaches OWNER devices (push_subscriptions is written solely by the
 * requireOwner-gated /api/push/subscribe — Steven's device is never stored).
 *
 * Keys used in `settings`:
 *   steven_upload_pending_{workId}  → coalescing batch for uploads (see below)
 *   steven_login_seen               → { at: <last_sign_in_at> } login dedupe
 *   steven_visit_last               → { at: <iso> } 30-min visit cooldown
 *
 * Uploads: the RolePicker posts one file per request, so we coalesce ~75s into a
 * single summary push (a batch → one push; a single file arrives within ≤~90s via
 * the minute scheduler in instrumentation.ts). Login is deduped by the Supabase
 * session's last_sign_in_at (a page refresh never changes it → no repeat push).
 * Visits are rate-limited to once per 30 minutes.
 *
 * Everything here is best-effort and must NEVER throw into the caller's path.
 */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const UPLOAD_WINDOW_MS   = 75 * 1000;          // ~75s coalescing window
const UPLOAD_KEY_PREFIX  = "steven_upload_pending_";
const uploadKey = (workId: string) => `${UPLOAD_KEY_PREFIX}${workId}`;

const LOGIN_SEEN_KEY     = "steven_login_seen";
const VISIT_LAST_KEY     = "steven_visit_last";
const VISIT_COOLDOWN_MS  = 30 * 60 * 1000;     // 30-minute visit cooldown
const LOGIN_FRESH_MS     = 3 * 60 * 1000;      // treat a sign-in within 3 min as a fresh login

/** Never send real push from local/dev — only production (or an explicit opt-in). */
function pushAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.ALLOW_SERVER_PUSH === "true";
}

// ── Uploads ────────────────────────────────────────────────────────────────────

interface StevenFile { name: string; role?: string | null; label?: string | null }
interface UploadBatch { workId: string; workName: string; files: StevenFile[]; count: number; dueAt: string }

/**
 * Called AFTER a successful Steven upload. Adds the file to the work's pending
 * batch and (re)arms the ~75s timer. Best-effort: never throws into the upload.
 */
export async function queueStevenUploadNotice(workId: string, workName: string, file: StevenFile): Promise<void> {
  if (!pushAllowed() || !workId) return;
  try {
    const k = uploadKey(workId);
    const { data } = await supabase.from("settings").select("value").eq("key", k).maybeSingle();
    const prev = (data?.value ?? null) as UploadBatch | null;
    const files = [...(prev?.files ?? []), file].slice(-12); // sample cap; count stays exact
    const value: UploadBatch = {
      workId,
      workName: workName || prev?.workName || "a work",
      files,
      count: (prev?.count ?? 0) + 1,
      dueAt: new Date(Date.now() + UPLOAD_WINDOW_MS).toISOString(),
    };
    await supabase.from("settings").upsert({ key: k, value }, { onConflict: "key" });
  } catch (e) {
    console.error("[steven-notify] upload queue failed:", e);
  }
}

/**
 * Called every minute by the scheduler. Sends ONE owner push per batch whose
 * window has elapsed, then clears that batch.
 */
export async function flushDueStevenUploadNotices(): Promise<void> {
  if (!pushAllowed()) return;
  let rows: { key: string; value: unknown }[] = [];
  try {
    const { data } = await supabase.from("settings").select("key, value").like("key", `${UPLOAD_KEY_PREFIX}%`);
    rows = data ?? [];
  } catch (e) {
    console.error("[steven-notify] flush read failed:", e);
    return;
  }

  const now = Date.now();
  for (const row of rows) {
    const v = (row.value ?? {}) as Partial<UploadBatch>;
    if (!v.dueAt || new Date(v.dueAt).getTime() > now) continue; // window still open

    const count    = v.count ?? 1;
    const workName = v.workName || "a work";
    const files    = v.files ?? [];

    let title: string, body: string;
    if (count === 1) {
      const f = files[0];
      title = "Steven uploaded a file";
      body  = `${f?.name ?? "A file"} uploaded to ${workName}`
            + (f?.label ? ` · ${f.label}` : "")
            + (f?.role ? ` (${f.role})` : "");
    } else {
      const roles = Array.from(new Set(files.map(f => f.role).filter(Boolean)));
      const label = files[0]?.label;
      title = "Steven uploaded files";
      body  = `${count} files uploaded to ${workName}`
            + (label ? ` · ${label}` : "")
            + (roles.length ? ` · ${roles.join(", ")}` : "");
    }

    try {
      await sendPushToAll({ title, body, url: "/team/steven", tag: `steven-upload-${v.workId ?? "x"}` });
    } catch (e) {
      console.error("[steven-notify] upload send failed:", e);
      continue; // leave the row so a later tick retries
    }
    try {
      await supabase.from("settings").delete().eq("key", row.key);
    } catch (e) {
      console.error("[steven-notify] upload clear failed:", e);
    }
  }
}

// ── Presence (login + visit) ─────────────────────────────────────────────────

async function readAt(key: string): Promise<string | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as { at?: string } | null)?.at ?? null;
}
async function writeAt(key: string, at: string): Promise<void> {
  await supabase.from("settings").upsert({ key, value: { at } }, { onConflict: "key" });
}

/**
 * Called by the /api/supplier/steven/ping endpoint on each page mount. The SERVER
 * decides whether to push, so a refresh never spams:
 *   • Login  — once per real sign-in, deduped by the session's last_sign_in_at.
 *   • Visit  — at most once per 30 minutes (skipped if a login push just fired).
 * Best-effort; never throws.
 */
export async function notifyStevenPresence(user: { last_sign_in_at?: string | null } | null): Promise<void> {
  if (!pushAllowed()) return;
  const now = Date.now();
  try {
    // Login — fresh sign-in not seen before.
    const lsi = user?.last_sign_in_at ?? null;
    if (lsi && now - new Date(lsi).getTime() < LOGIN_FRESH_MS) {
      const seen = await readAt(LOGIN_SEEN_KEY);
      if (seen !== lsi) {
        await sendPushToAll({ title: "Steven logged in", body: "Steven signed in to Redbloods OS", url: "/team/steven", tag: "steven-login" });
        await writeAt(LOGIN_SEEN_KEY, lsi);
        await writeAt(VISIT_LAST_KEY, new Date(now).toISOString()); // suppress a same-moment visit push
        return;
      }
    }

    // Visit — 30-minute rolling cooldown.
    const last = await readAt(VISIT_LAST_KEY);
    if (last && now - new Date(last).getTime() < VISIT_COOLDOWN_MS) return;
    await sendPushToAll({ title: "Steven visited his page", body: "Steven opened his work dashboard", url: "/team/steven", tag: "steven-visit" });
    await writeAt(VISIT_LAST_KEY, new Date(now).toISOString());
  } catch (e) {
    console.error("[steven-notify] presence failed:", e);
  }
}
