/**
 * Owner decision 2026-10-05 (Financial COO Phase 2, item 7): an Owner note that DOUBTS money ("לבדוק מה עם הכסף של X 2500")
 * while canonical Finance already shows that exact amount RECEIVED for that person is context the records OVERTOOK —
 * never a reopened receivable, never "UNCERTAIN", never asked again. Pure, read-only.
 *
 * Exact evidence only: the note names a client (whole name), carries a number, and a received income of THAT amount
 * belongs to a show where the client is the booker / artist, or to a project crediting the client. Anything else = no
 * claim (the normal lifecycle decides).
 */
import type { GatewaySources } from "../gateway/core";
import { normalizeName } from "../gateway/resolve";
import { containsWholeName } from "../knowledge/inbox-mentions";

const MONEY_CHECK = /כסף|תשלום|שילם|שילמ|העביר|העברה|לגבות|גבייה|חוב|התקבל/;
const RECEIVED = new Set(["שולם", "התקבל"]);
const ok = <T,>(a: { status: string; value?: T } | undefined): T | null => (a && a.status === "OK" ? (a as { value: T }).value : null);

export interface MoneyOvertaken { entity: string; amount: number; date: string | null; he: string }

export function moneyAlreadyRecorded(src: GatewaySources, body: string): MoneyOvertaken | null {
  if (!MONEY_CHECK.test(body)) return null;
  const amounts = [...body.matchAll(/(\d[\d,]{2,})/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n >= 100);
  if (!amounts.length) return null;
  const st = ok(src.state) as { domains?: { clients?: { data?: { items?: Array<{ id: string; name: string }> } }; shows?: { data?: { items?: Array<{ id: string; name: string; dateYmd: string | null; bookerClientId: string | null; artistClientId: string | null }> } } } } | null;
  const fin = ok(src.finance) as { raw?: { transactions?: Array<{ id: string; type: string | null; amount: unknown; status: string | null; date: string | null; showId?: string | null; projectId: string | null }> } } | null;
  const txs = fin?.raw?.transactions ?? [];
  if (!st || !txs.length) return null;
  const tt = normalizeName(body).split(" ").filter(Boolean);
  const named = (st.domains?.clients?.data?.items ?? []).filter((c) => { const n = normalizeName(c.name).split(" ").filter(Boolean); return n.length >= 2 && containsWholeName(tt, n); });
  for (const client of named) {
    for (const s of st.domains?.shows?.data?.items ?? []) {
      if (s.bookerClientId !== client.id && s.artistClientId !== client.id) continue;
      const hit = txs.find((t) => t.type === "income" && t.showId === s.id && RECEIVED.has(t.status ?? "") && amounts.includes(Number(t.amount)));
      if (hit) return { entity: `show:${s.id}`, amount: Number(hit.amount), date: hit.date, he: `ברשומות ₪${Number(hit.amount).toLocaleString("en-US")} כבר התקבלו (${s.name}${hit.date ? `, ${hit.date.slice(8, 10)}.${hit.date.slice(5, 7)}` : ""}) — הכספים קובעים; הפתק הוא הקשר שהרשומות כבר עקפו` };
    }
  }
  return null;
}
