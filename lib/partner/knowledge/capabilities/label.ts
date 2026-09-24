/**
 * Redbloods Partner knowledge — LABEL and SHOWS capabilities.
 *
 * Label roster = label_artists (Owner definition, 2026-09-24). Other sources never decide membership. There is NO
 * unified label balance: the label ledger has no currency, so a balance is UNKNOWN. Shows come from the canonical
 * shows records only; a show price has no currency column (the app displays it as ₪ — a convention, labelled DERIVED).
 */
import type { KnowledgeCapability, KnowledgeItem, KnowledgeSources } from "../types";
import { byCount, clientName, idOf, item, ok, partner, partnerRecord, projectName, record, result, sfact, state, textMentions, unavailable } from "./common";

/** How a label artist maps to client records (for show links): exact same-name client (TEXT_MATCH) or the app's canonical link (DERIVED). */
function artistClientIds(src: KnowledgeSources, labelArtistId: string): Map<string, "TEXT_MATCH" | "DERIVED"> {
  const st = state(src);
  const out = new Map<string, "TEXT_MATCH" | "DERIVED">();
  const a = st?.domains.labelArtists.data?.items.find((x) => x.id === labelArtistId);
  if (!st || !a) return out;
  for (const c of st.domains.clients.data?.items ?? []) if (c.name === a.name) out.set(c.id, "TEXT_MATCH");
  const cl = src.identities.cleantone;
  if (cl && cl.labelArtistName === a.name) out.set(cl.clientId, "DERIVED");
  return out;
}

export const labelRoster: KnowledgeCapability = {
  id: "label_roster", domain: "LABEL", titleHe: "רוסטר הלייבל",
  descriptionForModel: "The canonical label roster (label artists; Owner definition: this list decides membership, not project types or client statuses) with, per artist: projects naming them (TEXT_MATCH) and how many are stored as client work, release records (ID), shows linked to them, whether a label ledger exists (it has NO currency, so a balance is UNKNOWN — never a unified balance), and the Owner's current decision on their projects (see capability integrity).",
  examplesHe: ["מי בלייבל?", "מה מצב האמנים בלייבל?", "כמה אמנים יש בלייבל?"],
  modes: { roster: { descriptionForModel: "Every roster artist" } }, defaultMode: "roster",
  params: {}, paging: { defaultLimit: 10, maxLimit: 20 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE", "INTEGRITY"],
  read(src) {
    const st = state(src);
    const la = st?.domains.labelArtists.data;
    if (!st || !la) return unavailable("label roster");
    const idx = Object.values(st.domains.projects.data?.index ?? {});
    const rel = st.domains.releasesFull.data?.items ?? [];
    const shows = st.domains.shows.data?.items ?? [];
    const reg = ok(src.integrity);
    const items = [...la.items].sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
      const named = idx.filter((p) => textMentions(p.artistText, a.name));
      const clientIds = artistClientIds(src, a.id);
      const f = reg?.findings.find((x) => x.type === "LABEL_PROJECT_CLASSIFICATION_MISMATCH" && x.subject.key === `label-artist:${a.id}`);
      return item({ id: a.id, entity: `label-artist:${a.id}`, label: record(a.name), epistemic: "FACT", source: "LABEL_ARTISTS",
        fields: {
          status: a.status, projectsNamingThem: named.length, storedAsClientWork: named.filter((p) => p.businessType !== "לייבל").length, projectLink: "TEXT_MATCH",
          releaseRecords: rel.filter((r) => r.labelArtistId === a.id).length,
          shows: shows.filter((s) => (s.artistClientId && clientIds.has(s.artistClientId)) || (s.djClientId && clientIds.has(s.djClientId))).length,
          ledgerEntries: a.balanceEntries, balance: "UNKNOWN (the label ledger has no currency — no unified balance)",
          projectClassification: f ? (f.ownerDecision ? { ownerDecision: partner(f.ownerDecision.answerLabelHe), epistemic: "OWNER_DECISION" } : { status: f.questionId ? "OWNER_QUESTION_OPEN" : "UNRESOLVED", epistemic: "UNKNOWN" }) : null,
        } });
    });
    return result(items, { summary: [sfact("ROSTER", "אמני הלייבל (הגדרת הבעלים: טבלת אמני הלייבל קובעת)", la.items.map((a) => a.name).sort(), "OWNER_DECISION", "LABEL_ARTISTS")], completeness: reg ? "COMPLETE" : "PARTIAL" });
  },
};

export const releases: KnowledgeCapability = {
  id: "releases", domain: "LABEL", titleHe: "ריליסים",
  descriptionForModel: "Structured release records (one per project): project, label artist (ID), stage, target date, released date. A roster artist with no release record has an UNKNOWN release plan — never 'no release planned'.",
  examplesHe: ["מה הריליסים הקרובים?", "מתי יוצא השיר הבא?", "יש ריליס לשליו?"],
  modes: { upcoming: { descriptionForModel: "Not yet released" }, all: { descriptionForModel: "Every release record" } }, defaultMode: "upcoming",
  params: { artist: { kind: "entityKey", types: ["label-artist"], descriptionForModel: "Only this label artist's releases (ID link)" } },
  entityScope: { types: ["label-artist"], param: "artist", mode: "all", limit: 5 },
  paging: { defaultLimit: 15, maxLimit: 40 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read(src, q) {
    const st = state(src);
    const r = st?.domains.releasesFull.data;
    if (!st || !r) return unavailable("releases");
    const want = q.params.artist ? idOf(q.params.artist) : null;
    const rows = r.items.filter((x) => (!want || x.labelArtistId === want) && (q.mode === "all" || x.stage !== "יצא"))
      .sort((a, b) => (a.targetYmd ?? "9999").localeCompare(b.targetYmd ?? "9999") || a.projectId.localeCompare(b.projectId));
    const roster = st.domains.labelArtists.data?.items ?? [];
    const without = roster.filter((a) => (!want || a.id === want) && !r.items.some((x) => x.labelArtistId === a.id && x.stage !== "יצא"));
    return result(rows.map((x) => item({ id: x.projectId, entity: `release:${x.projectId}`, label: record(projectName(src, x.projectId) ?? "—"), epistemic: "FACT", source: "RELEASES", relationQuality: x.labelArtistId ? "ID" : undefined,
      fields: { artist: x.labelArtistId ? record(roster.find((a) => a.id === x.labelArtistId)?.name ?? null) : null, stage: x.stage, targetDate: x.targetYmd, releasedAt: x.releasedAt, project: `project:${x.projectId}` } })),
      { summary: [sfact("BY_STAGE", "לפי שלב", r.byStage, "FACT", "RELEASES")], completeness: without.length ? "PARTIAL" : "COMPLETE",
        coverage: without.length ? [partnerRecord(`אין רשומת ריליס פתוחה ל: ${without.map((a) => a.name).join(", ")}. זה לא אומר שלא מתוכנן ריליס — תוכנית הריליסים שלהם לא ידועה.`)] : [] });
  },
};

export const shows: KnowledgeCapability = {
  id: "shows", domain: "SHOWS", titleHe: "הופעות",
  descriptionForModel: "Every show in the canonical show records: name, date, status, payment status, price, performing artist / DJ / booker (client links by ID). Answers 'are there shows?', show history, upcoming shows, shows of an artist. No future show rows = none are recorded in the show records (a FACT about those records; Partner does not read the calendar). Price: stored without a currency column; the app displays it as ₪ (convention, DERIVED).",
  examplesHe: ["יש הופעות?", "תראה לי את היסטוריית ההופעות", "מה ההופעות הקרובות?", "איזה הופעות היו לשליו?", "איזה הופעות עוד לא שולמו?"],
  modes: { recent: { descriptionForModel: "Past shows, newest first" }, upcoming: { descriptionForModel: "Shows dated today or later (not cancelled)" }, all: { descriptionForModel: "Every show, newest first" } }, defaultMode: "all",
  params: {
    artist: { kind: "entityKey", types: ["label-artist", "client", "dj"], descriptionForModel: "Only shows where this artist / client / DJ appears" },
    status: { kind: "text", maxLength: 30, descriptionForModel: "Exact stored show status (e.g. בוצע, בוטל)" },
    payment_status: { kind: "text", maxLength: 30, descriptionForModel: "Exact stored payment status (e.g. שולם, צפוי)" },
  },
  entityScope: { types: ["label-artist", "client", "dj"], param: "artist", mode: "all", limit: 5 },
  paging: { defaultLimit: 15, maxLimit: 50 }, access: { externalRead: true, ownerOnly: false, sensitivity: "STANDARD" }, needs: ["STATE"],
  read(src, q) {
    const st = state(src);
    const s = st?.domains.shows.data;
    if (!st || !s) return unavailable("shows");
    const today = st.todayIL;
    let links: Map<string, "TEXT_MATCH" | "DERIVED" | "ID"> | null = null;
    if (q.params.artist) {
      const id = idOf(q.params.artist);
      links = q.params.artist.startsWith("label-artist:") ? artistClientIds(src, id) : new Map([[id, "ID" as const]]);
    }
    const linkOf = (x: (typeof s.items)[number]) => (links ? links.get(x.artistClientId ?? "") ?? links.get(x.djClientId ?? "") ?? links.get(x.bookerClientId ?? "") ?? null : null);
    const rows = s.items.filter((x) => (!links || linkOf(x) !== null) && (!q.params.status || x.status === q.params.status) && (!q.params.payment_status || x.paymentStatus === q.params.payment_status)
      && (q.mode === "all" || (q.mode === "upcoming" ? (x.dateYmd ?? "") >= today && x.status !== "בוטל" : !!x.dateYmd && x.dateYmd < today)))
      .sort((a, b) => (q.mode === "upcoming" ? (a.dateYmd ?? "9999").localeCompare(b.dateYmd ?? "9999") : (b.dateYmd ?? "").localeCompare(a.dateYmd ?? "")) || a.id.localeCompare(b.id));
    const items: KnowledgeItem[] = rows.map((x) => item({ id: x.id, entity: `show:${x.id}`, label: record(x.name), epistemic: "FACT", source: "SHOWS", ...(links ? { relationQuality: linkOf(x) ?? "UNKNOWN" } : {}),
      fields: {
        date: x.dateYmd, status: x.status, paymentStatus: x.paymentStatus, price: { amount: x.price, currency: "₪ (app display convention — no currency column)", epistemic: "DERIVED" },
        artist: x.artistClientId ? { key: `client:${x.artistClientId}`, name: record(clientName(src, x.artistClientId)), link: "ID" } : null,
        dj: x.djClientId ? { key: `dj:${x.djClientId}`, name: record(clientName(src, x.djClientId)), link: "ID", confirmation: x.djConfirmationStatus } : null,
        booker: x.bookerClientId ? { key: `client:${x.bookerClientId}`, name: record(clientName(src, x.bookerClientId)), link: "ID" } : null,
      } }));
    const upcoming = s.items.filter((x) => (x.dateYmd ?? "") >= today && x.status !== "בוטל").length;
    return result(items, {
      summary: [
        sfact("TOTAL", "הופעות ברשומות", s.total, "FACT", "SHOWS"), sfact("BY_STATUS", "לפי סטטוס", s.byStatus, "FACT", "SHOWS"),
        sfact("BY_PAYMENT_STATUS", "לפי סטטוס תשלום", byCount(s.items.map((x) => x.paymentStatus || "—")), "FACT", "SHOWS"),
        sfact("UPCOMING_RECORDED", upcoming === 0 ? "אין שורות הופעה עתידיות ברשומות ההופעות" : "הופעות עתידיות ברשומות", upcoming, "FACT", "SHOWS"),
      ],
      coverage: [partner("המידע הוא מרשומות ההופעות במערכת. Partner לא קורא את Google Calendar.")],
    });
  },
};
