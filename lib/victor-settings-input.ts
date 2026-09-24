/**
 * Victor settings — strict input validation for the Owner-only settings route (F2.19–F2.23 security).
 * Pure, no I/O.
 *
 * The salary amount / currency here are compensation configuration: they feed the Owner's
 * "send to finance" transaction and Partner finance readiness. Only the Owner may change them
 * (route: requireOwner; proxy: excluded from Victor's allowlist). No arbitrary merge: only the
 * five existing VendorSettings keys are accepted, each validated; unknown keys are rejected.
 */
import type { VendorSettings } from "./types";

export const VICTOR_SETTINGS_KEYS = ["monthlyGoal", "monthlySalary", "salaryCurrency", "salaryPayDay", "stuckAfterDays"] as const;
/** Currencies offered by the Owner UI (VictorDrawer). */
export const VICTOR_SALARY_CURRENCIES = ["$", "₪", "€", "£"] as const;
/** Payment statuses offered by the Owner UI (VictorDrawer "תשלום <month>"). */
export const VICTOR_PAYMENT_STATUSES = ["שולם", "צפוי", "לא שולם"] as const;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realYmd = (v: string) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };

/** PATCH /api/vendor/victor/settings body: a non-empty subset of the five keys, each valid. */
export function validateVictorSettingsPatch(body: unknown): ValidationResult<Partial<VendorSettings>> {
  if (!isObj(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const errors = Object.keys(body).filter((k) => !(VICTOR_SETTINGS_KEYS as readonly string[]).includes(k)).map((k) => `unknown key "${k}"`);
  const keys = Object.keys(body).filter((k) => (VICTOR_SETTINGS_KEYS as readonly string[]).includes(k));
  if (!keys.length) errors.push("no settings to update");
  if ("monthlyGoal" in body && !isInt(body.monthlyGoal, 0, 1000)) errors.push("monthlyGoal must be an integer 0–1000");
  if ("monthlySalary" in body && !(typeof body.monthlySalary === "number" && Number.isFinite(body.monthlySalary) && body.monthlySalary > 0 && body.monthlySalary <= 1_000_000)) errors.push("monthlySalary must be a number > 0 and ≤ 1,000,000");
  if ("salaryCurrency" in body && !(VICTOR_SALARY_CURRENCIES as readonly unknown[]).includes(body.salaryCurrency)) errors.push(`salaryCurrency must be one of ${VICTOR_SALARY_CURRENCIES.join(" ")}`);
  if ("salaryPayDay" in body && !isInt(body.salaryPayDay, 1, 28)) errors.push("salaryPayDay must be an integer 1–28");
  if ("stuckAfterDays" in body && !isInt(body.stuckAfterDays, 0, 365)) errors.push("stuckAfterDays must be an integer 0–365");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: Object.fromEntries(keys.map((k) => [k, body[k]])) as Partial<VendorSettings> };
}

/** PATCH /api/vendor/victor/settings?payment=YYYY-MM body: { status, paidDate? }. */
export function validateVictorPaymentPatch(month: string | null, body: unknown): ValidationResult<{ month: string; status: string; paidDate: string | undefined }> {
  const errors: string[] = [];
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.push("payment month must be YYYY-MM");
  if (!isObj(body)) return { ok: false, errors: [...errors, "body must be a JSON object"] };
  for (const k of Object.keys(body)) if (k !== "status" && k !== "paidDate") errors.push(`unknown key "${k}"`);
  if (!(VICTOR_PAYMENT_STATUSES as readonly unknown[]).includes(body.status)) errors.push(`status must be one of ${VICTOR_PAYMENT_STATUSES.join(" / ")}`);
  const pd = body.paidDate;
  if (pd !== undefined && pd !== null && !(typeof pd === "string" && YMD.test(pd) && realYmd(pd))) errors.push("paidDate must be YYYY-MM-DD or null");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { month: month as string, status: body.status as string, paidDate: typeof pd === "string" ? pd : undefined } };
}
