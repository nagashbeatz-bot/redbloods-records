/**
 * Sunny — CLIENT_DETAIL read source. SELECT only, over the same narrowing client as the operations source. Every
 * section is bounded and fails closed to null (UNAVAILABLE), never to an empty list. Free text is scrubbed of
 * bearer-looking links / tokens at the edge (same scrubber as the project detail source); receipt links are
 * reduced to a boolean. Contact details are ordinary business data (Owner-only capability), not secrets.
 */
import { mapSection, readSection, type OperationsReadClient } from "../operations/readers";
import { scrubSecrets } from "../projects/detail-reader";
import type { ClientDetailRaw } from "./detail-types";

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const t = (v: unknown) => scrubSecrets(s(v));
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function readClientDetailRaw(client: OperationsReadClient): Promise<ClientDetailRaw> {
  const [cl, tx] = await Promise.all([
    readSection(client, "clients", "id, name, type, status, phone, email, notes, created_at"),
    readSection(client, "transactions", "id, project_id, type, date, description, notes, payment_method, artist, receipt_ref, created_at"),
  ]);
  return {
    clients: mapSection(cl, (x) => (s(x.id) && s(x.name) ? { id: String(x.id), name: String(x.name), type: s(x.type), status: s(x.status), phone: s(x.phone), email: s(x.email), notes: t(x.notes), createdAt: s(x.created_at) } : null)),
    unlinkedTransactionsText: mapSection(tx, (x) => (s(x.id) && !s(x.project_id) ? { id: String(x.id), type: s(x.type), date: s(x.date), description: t(x.description), notes: t(x.notes), artistText: s(x.artist), paymentMethod: s(x.payment_method), hasReceipt: has(x.receipt_ref), createdAt: s(x.created_at) } : null)),
  };
}
