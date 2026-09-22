import "server-only";

/**
 * COO readers — the ONLY place in lib/coo that touches the database, and it is
 * READ-ONLY: every call below is a SELECT through an existing store or a plain
 * `.select()`. No insert/update/delete/upsert/rpc anywhere in lib/coo.
 *
 * Each source is fetched independently; one that fails is reported in `sources`
 * and becomes `null` (unknown), it never breaks the brief and never turns into 0.
 */
import { supabase } from "@/lib/supabase";
import { listProjects } from "@/lib/projects-store";
import { listTasks } from "@/lib/tasks-store";
import { listSoundEngineerWork } from "@/lib/sound-engineer-store";
import { getVictorSettings, getVictorWork } from "@/lib/vendor-store";
import { listShows } from "@/lib/shows-store";
import { listLabelReleases } from "@/lib/release-store";
import { getAlerts } from "@/lib/agent/alerts-store";
import type { CooConfig } from "./config";
import type { CooRawInput, RawFinanceSetting, SourceStatus } from "./types";
import { addDays, ilYmd } from "./dates";

const PAGE = 1000;

/** Paginated SELECT (PostgREST returns at most 1000 rows per request). */
async function selectAll<T>(table: string, columns: string, apply?: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = baseQuery(table, columns);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}
function baseQuery(table: string, columns: string) { return supabase.from(table).select(columns); }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function readCooRaw(now: Date, cfg: CooConfig): Promise<CooRawInput> {
  const today = ilYmd(now);
  const results: Record<string, { ok: boolean; count: number | null; error?: string }> = {};
  const track = async <T,>(name: string, fn: () => Promise<T>, count: (v: T) => number | null): Promise<T | null> => {
    try { const v = await fn(); results[name] = { ok: true, count: count(v) }; return v; }
    catch (e) { results[name] = { ok: false, count: null, error: msg(e) }; return null; }
  };

  const [projects, tasks, steven, victor, proposals, shows, sessions, transactions, releases, alerts, projectIds] = await Promise.all([
    track("projects", async () => (await listProjects()).map((p) => ({
      id: p.id, name: p.name, artist: p.artist, status: p.status as string, deadline: p.deadline, projectType: p.projectType as string,
      businessType: p.businessType as string, updatedAt: p.updatedAt, isHidden: p.isHidden,
    })), (v) => v.length),
    track("tasks", async () => (await listTasks({ status: "פתוח" })).map((t) => ({
      id: t.id, title: t.title, status: t.status as string, dueDate: t.due_date, relatedType: t.related_type as string, relatedId: t.related_id ?? null,
      createdAt: t.created_at ?? null,
    })), (v) => v.length),
    track("steven", async () => (await listSoundEngineerWork(cfg.stevenEngineerName)).map((w) => ({
      id: w.id, projectId: w.projectId, title: (w.workTitle && w.workTitle.trim()) || w.projectName || "עבודה", status: w.status as string,
      agreedPrice: w.agreedPrice, currency: w.currency, amountPaid: w.amountPaid, sentDate: w.sentDate, internalDeadline: w.internalDeadline,
      hasMixVersion: w.hasMixVersion, lastUploadAt: w.lastUploadAt,
      createdAt: w.createdAt || null, updatedAt: w.updatedAt || null,
    })), (v) => v.length),
    track("victor", async () => {
      const [works, settings] = await Promise.all([getVictorWork(), getVictorSettings()]);
      return {
        stuckAfterDays: settings.stuckAfterDays,
        works: works.map((w) => ({
          id: w.id, projectId: w.projectId, title: (w.title && w.title.trim()) || w.projectName || "עבודה", status: w.status as string,
          workState: (w.workState as string | null) ?? null, sentDate: w.sentDate, internalDeadline: w.internalDeadline, daysSinceSent: w.daysSinceSent, isStuck: w.isStuck,
          // delivery evidence: Victor's uploads (files_sent) and the owner's notes (version_reviews) — both already returned by getVictorWork
          uploads: (w.filesSent ?? []).map((f) => f.uploadedAt).filter((u): u is string => !!u),
          filesWithoutTimestamp: (w.filesSent ?? []).filter((f) => !f.uploadedAt).length,
          reviews: Object.values(w.versionReviews ?? {}).map((r) => ({ sentAt: r.sentAt ?? null, draft: r.draft === true })),
          reviewEvents: Object.entries(w.versionReviews ?? {}).map(([versionKey, r]) => ({ versionKey, sentAt: r.sentAt ?? null, draft: r.draft === true })),
          linkedTaskId: w.linkedTaskId,
          createdAt: w.createdAt || null, updatedAt: w.updatedAt || null, returnedDate: w.returnedDate || null,
        })),
      };
    }, (v) => v.works.length),
    track("proposals", async () => {
      const { data, error } = await supabase.from("proposals").select("id, title, amount, currency, status, followup_date, linked_project_id, clients(name)");
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => {
        const c = p.clients as unknown as { name?: string } | { name?: string }[] | null;
        return {
          id: p.id as string, clientName: ((Array.isArray(c) ? c[0]?.name : c?.name) ?? "") as string, title: (p.title as string) ?? "",
          amount: (p.amount as number) ?? 0, currency: (p.currency as string) ?? "₪", status: p.status as string,
          followupDate: (p.followup_date as string | null) ?? null, linkedProjectId: (p.linked_project_id as string | null) ?? null,
        };
      });
    }, (v) => v.length),
    track("shows", async () => (await listShows()).map((s) => ({
      id: s.id, name: s.name, status: s.status as string, paymentStatus: s.payment_status as string, date: s.date, price: s.show_price ?? 0,
      advance: s.advance_payment ?? 0, incomeTxId: s.linked_income_transaction_id ?? null,
      // Additive (Partner Phase B.1) — already returned by listShows()'s select("*"); no new query.
      djClientId: s.dj_client_id ?? null, djConfirmationStatus: (s.dj_confirmation_status as string | null) ?? null, djConfirmedAt: s.dj_confirmed_at ?? null,
    })), (v) => v.length),
    track("sessions", async () => {
      const rows = await selectAll<{ id: string; project_id: string | null; date: string; start_time: string | null; end_time: string | null; status: string; session_type: string }>(
        "sessions", "id, project_id, date, start_time, end_time, status, session_type",
        (q) => q.eq("status", "מתוכנן").gte("date", today).lte("date", addDays(today, cfg.sessionWindowDays)),
      );
      return rows.map((r) => ({ id: r.id, projectId: r.project_id, date: r.date, startTime: r.start_time, endTime: r.end_time, status: r.status, sessionType: r.session_type }));
    }, (v) => v.length),
    track("transactions", async () => {
      const rows = await selectAll<{ id: string; project_id: string | null; type: string; amount: number; currency: string | null; payment_status: string; date: string | null; expense_scope: string | null; category: string | null }>(
        "transactions", "id, project_id, type, amount, currency, payment_status, date, expense_scope, category",
      );
      return rows.map((t) => ({ id: t.id, projectId: t.project_id, type: t.type, amount: Number(t.amount) || 0, currency: t.currency, status: t.payment_status, date: t.date, expenseScope: t.expense_scope, category: t.category }));
    }, (v) => v.length),
    track("releases", async () => {
      const list = await listLabelReleases();
      return {
        labelProjectsTotal: list.length,
        rows: list.filter((r) => r.release).map((r) => ({
          projectId: r.projectId, name: r.name, projectStatus: r.status as string, stage: r.release!.releaseStage as string,
          targetDate: r.release!.releaseTargetDate, nextAction: r.release!.nextAction, blocker: r.release!.blocker, responsible: r.release!.responsible,
          stageEnteredAt: r.release!.stageEnteredAt,
          // Additive (Partner Phase B.2) — already returned by listLabelReleases(); no new query.
          labelArtistId: r.release!.labelArtistId ?? null,
        })),
      };
    }, (v) => v.rows.length),
    track("agent_alerts", async () => (await getAlerts({ status: "new", limit: 200 })).map((a) => ({
      id: a.id, type: a.type, severity: a.severity as string, title: a.title, message: a.message, createdAt: a.createdAt, relatedProjectId: a.relatedProjectId,
    })), (v) => v.length),
    // all project ids (hidden included) — only to count finance_* rows whose project no longer exists
    track("project_ids", async () => (await selectAll<{ id: string }>("projects", "id")).map((r) => r.id), (v) => v.length),
  ]);

  // Finance settings: project → finance_<id> lookup ONLY (never a scan of every finance_* row for totals).
  let financeSettings: RawFinanceSetting[] | null = null;
  if (projects) {
    financeSettings = await track("finance_settings", async () => {
      const out: RawFinanceSetting[] = [];
      const keys = projects.map((p) => `finance_${p.id}`);
      for (let i = 0; i < keys.length; i += 100) {
        const { data, error } = await supabase.from("settings").select("key, value").in("key", keys.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          const v = (row.value ?? {}) as { agreedPrice?: unknown; currency?: unknown; financeException?: unknown };
          out.push({
            projectId: String(row.key).slice("finance_".length),
            agreedPrice: typeof v.agreedPrice === "number" ? v.agreedPrice : Number(v.agreedPrice) || 0,
            currency: typeof v.currency === "string" && v.currency.trim() ? v.currency : null,
            financeException: v.financeException === true,
          });
        }
      }
      return out;
    }, (v) => v.length);
  } else results["finance_settings"] = { ok: false, count: null, error: "projects unavailable" };

  // Count-only: finance_* keys whose project no longer exists (never used in any total).
  let orphanFinanceKeyCount: number | null = null;
  if (projectIds) {
    const keys = await track("finance_keys", async () => (await selectAll<{ key: string }>("settings", "key", (q) => q.like("key", "finance_%"))).map((r) => r.key), (v) => v.length);
    if (keys) { const ids = new Set(projectIds); orphanFinanceKeyCount = keys.filter((k) => !ids.has(k.slice("finance_".length))).length; }
  }

  const order = ["projects", "tasks", "steven", "victor", "proposals", "shows", "sessions", "transactions", "finance_settings", "releases", "agent_alerts"];
  const sources: SourceStatus[] = order.filter((n) => results[n]).map((n) => ({
    source: n, status: results[n].ok ? "ok" : "failed", rowCount: results[n].count, ...(results[n].error ? { error: results[n].error } : {}),
  }));

  return {
    sources,
    projects: projects, tasks, steven, victor, proposals, shows, sessions, transactions, financeSettings, orphanFinanceKeyCount,
    releases, alerts,
  };
}
