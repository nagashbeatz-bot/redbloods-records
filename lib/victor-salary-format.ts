/**
 * Victor salary — canonical, PURE formatting shared by the Finance writer (POST /api/vendor/victor/salary,
 * via lib/vendor-store re-exports) and Partner finance readiness. One definition, so a future Partner
 * execution writes exactly the row shape the canonical writer writes. No I/O, no "server-only".
 */
const HE_MONTHS_SALARY = [
  "ינואר","פברואר","מרץ","אפריל","מאי","יוני",
  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר",
];

/** The canonical per-period business key stored in transactions.linked_session_id. */
export function salaryLinkedId(workMonth: string): string {
  return `victor_salary_${workMonth}`;
}

/** Salary for work month M is due on the 10th of month M+1. */
export function salaryDueDate(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  const dueYear = m === 12 ? y + 1 : y;
  const dueMon  = m === 12 ? 1 : m + 1;
  return `${dueYear}-${String(dueMon).padStart(2, "0")}-10`;
}

export function salaryMonthLabel(workMonth: string): string {
  const [y, m] = workMonth.split("-").map(Number);
  return `${HE_MONTHS_SALARY[m - 1]} ${y}`;
}

/** The canonical Finance transaction description for a Victor salary period. */
export function salaryTransactionDescription(workMonth: string): string {
  return `משכורת Victor — ${salaryMonthLabel(workMonth)}`;
}
