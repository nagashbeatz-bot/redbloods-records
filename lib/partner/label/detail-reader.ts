/**
 * Sunny — LABEL_DETAIL read source. SELECT only (same narrowing client as the operations source), bounded, every
 * section fails closed to null (UNAVAILABLE) — never to an empty list. Free text is scrubbed of bearer-looking links /
 * tokens; the artist image URL and the show contact phone are reduced to booleans at the edge. Beat file paths are
 * storage paths (metadata), never share links.
 */
import { mapSection, readSection, type OperationsReadClient } from "../operations/readers";
import { scrubSecrets } from "../projects/detail-reader";
import type { LabelDetailRaw } from "./detail-types";

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const t = (v: unknown) => scrubSecrets(s(v));
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function readLabelDetailRaw(client: OperationsReadClient): Promise<LabelDetailRaw> {
  const r = (table: string, cols: string) => readSection(client, table, cols);
  const [artists, ledger, cycles, media, beats, assign, shows] = await Promise.all([
    r("label_artists", "id, name, status, image_url, notes, created_at, updated_at"),
    r("artist_balance_entries", "id, artist_id, entry_type, amount, entry_date, description, note, source_tx_id, source_show_id, created_at, updated_at"),
    r("artist_balance_cycles", "id, artist_id, cycle_index, start_date, end_date, income, expected_income, payments, expenses, expected_expenses, ending_balance, closed_at"),
    r("label_media_income", "id, label_artist_id, record_type, reverses_id, gross_amount, source, report_period, received_date, status, notes, label_share, artist_share_gross, recoup_before, recouped, artist_payable, recoup_after, created_at, updated_at"),
    r("beats", "id, name, genre, musical_key, status, file_name, dropbox_path, duration_seconds, created_at"),
    r("beat_artist_assignments", "beat_id, artist_slug, created_at"),
    r("shows", "id, name, artist, date, start_time, location, contact_person, phone, status, payment_status, show_price, dj_fee, artist_fee, advance_payment, notes, artist_client_id, booker_client_id, booker_name, dj_client_id, dj_name, dj_confirmation_status, dj_confirmed_at, calendar_event_id, linked_income_transaction_id, linked_dj_expense_transaction_id, linked_artist_expense_transaction_id, created_at, updated_at"),
  ]);
  const assignments = assign ? assign.rows : null;
  return {
    artists: mapSection(artists, (x) => (s(x.id) && s(x.name) ? { id: String(x.id), name: String(x.name), status: s(x.status), hasImage: has(x.image_url), notes: t(x.notes), createdAt: s(x.created_at), updatedAt: s(x.updated_at) } : null)),
    ledger: mapSection(ledger, (x) => (s(x.id) && s(x.artist_id) ? { id: String(x.id), artistId: String(x.artist_id), entryType: s(x.entry_type), amount: n(x.amount), entryDate: s(x.entry_date), description: t(x.description), note: t(x.note), sourceTxId: s(x.source_tx_id), sourceShowId: s(x.source_show_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at) } : null)),
    cycles: mapSection(cycles, (x) => (s(x.id) && s(x.artist_id) ? { id: String(x.id), artistId: String(x.artist_id), cycleIndex: n(x.cycle_index), startDate: s(x.start_date), endDate: s(x.end_date), income: n(x.income), expectedIncome: n(x.expected_income), payments: n(x.payments), expenses: n(x.expenses), expectedExpenses: n(x.expected_expenses), endingBalance: n(x.ending_balance), closedAt: s(x.closed_at) } : null)),
    mediaIncome: mapSection(media, (x) => (s(x.id) && s(x.label_artist_id) ? { id: String(x.id), artistId: String(x.label_artist_id), recordType: s(x.record_type), reversesId: s(x.reverses_id), grossAmount: n(x.gross_amount), source: s(x.source), reportPeriod: s(x.report_period), receivedDate: s(x.received_date), status: s(x.status), notes: t(x.notes), labelShare: n(x.label_share), artistShareGross: n(x.artist_share_gross), recoupBefore: n(x.recoup_before), recouped: n(x.recouped), artistPayable: n(x.artist_payable), recoupAfter: n(x.recoup_after), createdAt: s(x.created_at), updatedAt: s(x.updated_at) } : null)),
    beats: beats && assignments ? mapSection(beats, (x) => (s(x.id) && s(x.name) ? { id: String(x.id), name: String(x.name), genre: s(x.genre), musicalKey: s(x.musical_key), status: s(x.status), fileName: s(x.file_name), path: s(x.dropbox_path), durationSeconds: n(x.duration_seconds), createdAt: s(x.created_at),
      assignedTo: assignments.filter((a) => a.beat_id === x.id).map((a) => ({ artistSlug: String(a.artist_slug), at: s(a.created_at) })) } : null)) : null,
    shows: mapSection(shows, (x) => (s(x.id) ? { id: String(x.id), name: s(x.name), artistText: s(x.artist), date: s(x.date), startTime: s(x.start_time), location: t(x.location), contactPerson: s(x.contact_person), hasPhone: has(x.phone),
      status: s(x.status), paymentStatus: s(x.payment_status), price: n(x.show_price), djFee: n(x.dj_fee), artistFee: n(x.artist_fee), advancePayment: n(x.advance_payment), notes: t(x.notes),
      artistClientId: s(x.artist_client_id), bookerClientId: s(x.booker_client_id), bookerName: s(x.booker_name), djClientId: s(x.dj_client_id), djName: s(x.dj_name), djConfirmationStatus: s(x.dj_confirmation_status), djConfirmedAt: s(x.dj_confirmed_at),
      hasCalendarEvent: has(x.calendar_event_id), incomeTxId: s(x.linked_income_transaction_id), djExpenseTxId: s(x.linked_dj_expense_transaction_id), artistExpenseTxId: s(x.linked_artist_expense_transaction_id), createdAt: s(x.created_at), updatedAt: s(x.updated_at) } : null)),
  };
}
