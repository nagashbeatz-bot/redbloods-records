"use client";

// "הוסף ריליס" — 2-step flow (pick a project → pick a date) launched from the
// dashboard's "ריליסים קרובים" card. It reuses the SAME mutation as /label's
// "סמן קיים כריליס": POST /api/label/releases → convertProjectToLabelRelease, with
// the same initial stage ("רעיון") and the date sent in that one request.
// Eligibility (any status; a label artist's project without a release) and the release
// owner live in lib/release-candidates.ts. The server re-validates the owner
// (convertProjectToLabelRelease). An owner with no label_artists row is created via the
// existing POST /api/label/artists ONLY after an explicit "צור אמן והמשך" press, and is
// never deleted. No new endpoint, no DB change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LabelRelease } from "@/lib/types";
import { ilTodayYMD } from "@/lib/red-artists/week";
import { releaseShortDate } from "@/lib/dashboard-releases";
import {
  buildReleaseCandidates, filterCandidates, normName, CANDIDATE_BLOCK_TEXT, CANDIDATE_BLOCK_HELP,
  type CandidateProject, type RosterArtist, type ReleaseCandidate,
} from "@/lib/release-candidates";
import { ModalShell, PrimaryBtn, GhostBtn, fieldStyle, BRAND, CARD2, BORDER, TEXT, SUB, MUTED } from "@/components/label/labelShared";

// Same starting stage /label uses today (MarkExistingModal sends "רעיון"; the
// server default is "רעיון" too). Not a new stage.
const INITIAL_STAGE = "רעיון";
const HEBREW = /[֐-׿]/;

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// ── Small inline calendar (RTL, YYYY-MM-DD) ───────────────────────────────────
// DatePickerInput is a dropdown attached to a trigger field, so it can't sit inline
// in the modal like the mockup; this is a small local twin with the same conventions
// (Sunday on the right, right arrow = previous month, no dependency).
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function ReleaseCalendar({ value, onChange, disabled }: { value: string; onChange: (ymd: string) => void; disabled: boolean }) {
  const today = ilTodayYMD();
  const seed = value || today;
  const [view, setView] = useState({ y: Number(seed.slice(0, 4)), m: Number(seed.slice(5, 7)) - 1 });

  const shift = (delta: number) => setView((v) => {
    const t = v.y * 12 + v.m + delta;
    return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
  });

  const lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();        // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const navBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
    background: "rgba(255,255,255,0.06)", color: "#D8D8DE", display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div dir="rtl" style={{ background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "12px 12px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button type="button" aria-label="חודש קודם" onClick={() => shift(-1)} style={navBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{MONTHS[view.m]} {view.y}</div>
        <button type="button" aria-label="חודש הבא" onClick={() => shift(1)} style={navBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
        {WEEKDAYS.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: MUTED, padding: "4px 0" }}>{w}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {week.map((day, di) => {
            if (day === null) return <div key={di} />;
            const ymd = `${view.y}-${pad2(view.m + 1)}-${pad2(day)}`;
            const selected = ymd === value;
            const isToday = ymd === today;
            return (
              <button
                key={di}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onChange(ymd)}
                style={{
                  margin: 2, height: 34, borderRadius: 9, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
                  fontSize: 13, fontVariantNumeric: "tabular-nums", fontWeight: selected || isToday ? 800 : 500,
                  color: selected ? "#fff" : TEXT,
                  background: selected ? BRAND : "transparent",
                  border: selected ? `1px solid ${BRAND}` : isToday ? "1px solid rgba(255,255,255,0.22)" : "1px solid transparent",
                }}
              >{day}</button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
type View = "project" | "owner" | "date";
type OwnerName = { name: string; key: string };

export default function AddReleaseModal({ onClose, onCreated }: {
  onClose: () => void;
  /** Called after a successful create; resolve when the card's data has refreshed. */
  onCreated: () => void | Promise<void>;
}) {
  const [view, setView] = useState<View>("project");
  const [loadState, setLoadState] = useState<"loading" | "error" | "ok">("loading");
  const [data, setData] = useState<{ projects: CandidateProject[]; roster: RosterArtist[]; releaseIds: Set<string>; clientLabelNames: string[] } | null>(null);
  // Projects the server said already have a release (409) although the list didn't know it.
  const [conflictIds, setConflictIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReleaseCandidate | null>(null);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  // label_artists ids resolved in this modal (created here, or found after a 409), by owner key.
  // Kept so a retry after a failed release only retries the release, never the artist.
  const [ownerIds, setOwnerIds] = useState<Record<string, string>>({});
  const createdKeys = useRef<Set<string>>(new Set()); // owners whose label_artists row THIS modal created
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitting = useRef(false); // synchronous double-submit guard

  const load = useCallback(() => {
    setLoadState("loading");
    // Same sources /label uses (projects, label_artists roster, existing releases) plus the clients
    // list, which defines who counts as a label artist — all four are required.
    Promise.all([getJson("/api/projects"), getJson("/api/label/artists"), getJson("/api/label/releases"), getJson("/api/clients")])
      .then(([projects, artists, releases, clients]) => {
        const cl = (clients as { clients?: { name: string; status: string }[] } | null)?.clients;
        if (!Array.isArray(projects) || !Array.isArray(artists) || !Array.isArray(releases) || !Array.isArray(cl)) throw new Error("bad shape");
        setData({
          projects: projects as CandidateProject[],
          roster: artists as RosterArtist[],
          releaseIds: new Set((releases as LabelRelease[]).filter((r) => r.release).map((r) => r.projectId)),
          clientLabelNames: cl.filter((c) => c.status === "אמן לייבל").map((c) => c.name),
        });
        setLoadState("ok");
      })
      .catch(() => setLoadState("error"));
  }, []);
  useEffect(() => { load(); }, [load]);

  const candidates = useMemo<ReleaseCandidate[]>(() => {
    if (!data) return [];
    return buildReleaseCandidates(data.projects, data.roster, new Set([...data.releaseIds, ...conflictIds]), data.clientLabelNames);
  }, [data, conflictIds]);
  const visible = useMemo(() => filterCandidates(candidates, query), [candidates, query]);
  const selected = candidates.find((c) => c.project.id === selectedId && c.block === null) ?? null;

  const owner = chosen?.owners.find((o) => o.key === ownerKey) ?? null;
  const ownerId = owner ? (owner.rosterId ?? ownerIds[owner.key] ?? null) : null;
  const needsArtist = !!owner && !ownerId; // label artist (per clients) with no label_artists row yet
  const ambiguous = (chosen?.owners.length ?? 0) > 1;

  const requestClose = () => { if (!submitting.current) onClose(); }; // never close mid-save

  function pickProject() {
    if (!selected) return;
    setChosen(selected); setErr(null);
    if (selected.owners.length === 1) { setOwnerKey(selected.owners[0].key); setView("date"); }
    else { setOwnerKey(null); setView("owner"); } // 2+ label artists → ask who owns the release
  }

  function fail(text: string) { setErr(text); submitting.current = false; setBusy(false); }

  async function save() {
    if (submitting.current || !chosen || !owner || !date) return;
    submitting.current = true; setBusy(true); setErr(null);
    const o: OwnerName = { name: owner.name, key: owner.key };
    let artistId = ownerId;
    try {
      // Step A — only when the owner has no label_artists row, and only from the explicit
      // "צור אמן והמשך" press (the button is the save button in that state).
      if (!artistId) {
        const ra = await fetch("/api/label/artists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: o.name }) });
        if (ra.ok) {
          const d = await ra.json().catch(() => null);
          artistId = typeof d?.artist?.id === "string" ? d.artist.id : null;
          if (!artistId) return fail("יצירת האמן נכשלה. הריליס לא נשמר.");
          createdKeys.current.add(o.key);
        } else if (ra.status === 409) {
          // Already exists (earlier attempt / concurrent request): a valid outcome. Reload the roster,
          // find the existing row by the normal normalization and continue with its id.
          const roster = await getJson("/api/label/artists");
          const found = Array.isArray(roster) ? (roster as RosterArtist[]).find((a) => normName(a.name) === o.key) : undefined;
          if (!found) return fail("האמן כבר קיים אך לא ניתן היה לאתר אותו. רענן ונסה שוב.");
          artistId = found.id;
        } else {
          const d = await ra.json().catch(() => null);
          return fail(typeof d?.error === "string" && HEBREW.test(d.error) ? `${d.error}\nהריליס לא נשמר.` : "יצירת האמן נכשלה. הריליס לא נשמר.");
        }
        setOwnerIds((prev) => ({ ...prev, [o.key]: artistId as string }));
        load(); // refresh the roster so the list reflects the new row
      }

      // Step B — the existing release mutation (its own project rollback stays as is).
      // The artist row is NEVER deleted if this fails: the user explicitly created it.
      const createdHere = createdKeys.current.has(o.key);
      let res: Response;
      try {
        res = await fetch("/api/label/releases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: chosen.project.id, labelArtistId: artistId, releaseStage: INITIAL_STAGE, releaseTargetDate: date }),
        });
      } catch {
        return fail(createdHere ? "האמן נוצר בניהול הלייבל, אך הריליס לא נשמר.\nשגיאת רשת." : "שגיאת רשת. נסה שוב.");
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        const serverMsg = typeof d?.error === "string" && HEBREW.test(d.error) ? (d.error as string) : null;
        if (res.status === 409) { setConflictIds((s) => new Set(s).add(chosen.project.id)); load(); } // it already has a release → block it here too
        return fail(createdHere
          ? `האמן נוצר בניהול הלייבל, אך הריליס לא נשמר.${serverMsg ? `\n${serverMsg}` : ""}`
          : (serverMsg ?? "יצירת הריליס נכשלה. נסה שוב."));
      }
      try { await onCreated(); } catch { /* the release exists; a failed refresh is retried by the card */ }
      onClose();
    } catch {
      fail("שגיאת רשת. נסה שוב.");
    }
  }

  const bar = (on: boolean): React.CSSProperties => ({ flex: 1, height: 3, borderRadius: 2, background: on ? BRAND : "rgba(255,255,255,0.1)" });
  const subtitle = view === "date" ? "שלב 2 מתוך 2 · בחירת תאריך ריליס" : view === "owner" ? "שלב 1 מתוך 2 · שיוך הריליס" : "שלב 1 מתוך 2 · בחר פרויקט";
  const summary = chosen && (
    <div style={{ background: CARD2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "11px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chosen.project.name}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{chosen.project.artist} · {chosen.project.projectType}</div>
      {view === "date" && ambiguous && owner && <div style={{ fontSize: 12, color: SUB, marginTop: 4 }}>משויך ל: <b style={{ color: TEXT }}>{owner.name}</b></div>}
    </div>
  );

  return createPortal(
    <ModalShell title="הוספת ריליס חדש" onClose={requestClose}>
      <div style={{ marginTop: -8, marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: SUB }}>{subtitle}</div>
        <div style={{ display: "flex", gap: 4, width: 120, marginTop: 8 }}><span style={bar(true)} /><span style={bar(view === "date")} /></div>
      </div>

      {view === "project" ? (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפש פרויקט או אמן"
            aria-label="חיפוש פרויקט או אמן"
            style={{ ...fieldStyle, marginBottom: 12 }}
          />

          {loadState === "loading" ? (
            <div style={{ color: MUTED, fontSize: 13, padding: "28px 0", textAlign: "center" }}>טוען פרויקטים…</div>
          ) : loadState === "error" ? (
            <div style={{ fontSize: 13, padding: "24px 0", textAlign: "center", color: "#F87171", fontWeight: 700 }}>
              לא ניתן לטעון את הפרויקטים.{" "}
              <button type="button" onClick={load} style={{ background: "none", border: "none", padding: 0, color: "#60A5FA", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>נסה שוב</button>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 13, padding: "28px 0", textAlign: "center" }}>
              {query.trim() ? "לא נמצאו פרויקטים" : "אין פרויקטים של אמני לייבל זמינים לריליס"}
            </div>
          ) : (
            <div role="radiogroup" aria-label="פרויקטים" style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "44vh", overflowY: "auto", paddingBottom: 2 }}>
              {visible.map((c) => {
                const on = c.project.id === selectedId && c.block === null;
                const blocked = c.block !== null;
                return (
                  <button
                    key={c.project.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={blocked}
                    title={c.block ? CANDIDATE_BLOCK_HELP[c.block] : undefined}
                    onClick={() => setSelectedId(c.project.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "right", fontFamily: "inherit",
                      padding: "11px 13px", borderRadius: 12, cursor: blocked ? "not-allowed" : "pointer",
                      background: on ? "rgba(220,38,38,0.1)" : CARD2,
                      border: `1px solid ${on ? BRAND : BORDER}`,
                      boxShadow: on ? `0 0 0 1px ${BRAND}` : "none",
                      opacity: blocked ? 0.55 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.project.name}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.project.artist || "—"}</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: SUB, flexShrink: 0 }}>{c.project.projectType}</span>
                    {c.block ? (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: SUB, flexShrink: 0, padding: "3px 9px", borderRadius: 99, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>{CANDIDATE_BLOCK_TEXT[c.block]}</span>
                    ) : (
                      <span aria-hidden style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? BRAND : "rgba(255,255,255,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: BRAND }} />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {loadState === "ok" && <div style={{ fontSize: 11, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>מוצגים פרויקטים של אמני לייבל, בכל סטטוס.</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <GhostBtn onClick={requestClose}>ביטול</GhostBtn>
            <PrimaryBtn disabled={!selected} onClick={pickProject}>המשך ←</PrimaryBtn>
          </div>
        </>
      ) : view === "owner" && chosen ? (
        <>
          {summary}
          <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, marginBottom: 10 }}>לאיזה אמן לשייך את הריליס?</div>
          <div role="radiogroup" aria-label="בעל הריליס" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {chosen.owners.map((ow) => {
              const on = ow.key === ownerKey;
              const inRoster = !!(ow.rosterId ?? ownerIds[ow.key]);
              return (
                <button
                  key={ow.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setOwnerKey(ow.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "right", fontFamily: "inherit",
                    padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                    background: on ? "rgba(220,38,38,0.1)" : CARD2,
                    border: `1px solid ${on ? BRAND : BORDER}`,
                    boxShadow: on ? `0 0 0 1px ${BRAND}` : "none",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: TEXT }}>{ow.name}</span>
                  {!inRoster && <span style={{ fontSize: 10.5, fontWeight: 700, color: SUB, padding: "3px 9px", borderRadius: 99, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>לא בניהול הלייבל</span>}
                  <span aria-hidden style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? BRAND : "rgba(255,255,255,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: BRAND }} />}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>הבחירה קובעת רק את בעל הריליס. הקרדיטים של הפרויקט לא משתנים.</div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <GhostBtn onClick={() => { setErr(null); setView("project"); }}>חזור</GhostBtn>
            <PrimaryBtn disabled={!owner} onClick={() => setView("date")}>המשך ←</PrimaryBtn>
          </div>
        </>
      ) : chosen && (
        <>
          {summary}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: SUB }}>תאריך ריליס</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: date ? TEXT : MUTED, ...(date ? { direction: "ltr" as const } : {}) }}>{date ? releaseShortDate(date) : "בחר תאריך בלוח"}</span>
          </div>
          <ReleaseCalendar value={date} onChange={setDate} disabled={busy} />

          {needsArtist && owner && (
            <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.28)", fontSize: 12.5, lineHeight: 1.6, color: "#E5C77A" }}>
              האמן עדיין לא קיים בניהול הלייבל. כדי לשייך אליו את הריליס צריך ליצור עבורו רשומת אמן.
              <div style={{ fontWeight: 800, color: TEXT, marginTop: 2 }}>{owner.name}</div>
            </div>
          )}

          {err && <div role="alert" style={{ color: "#F87171", fontSize: 12.5, fontWeight: 700, marginTop: 12, whiteSpace: "pre-line" }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <GhostBtn onClick={() => { if (!submitting.current) { setErr(null); setView(ambiguous ? "owner" : "project"); } }}>חזור</GhostBtn>
            <PrimaryBtn disabled={!date || busy} onClick={save}>{busy ? "שומר…" : needsArtist ? "צור אמן והמשך" : "קבע ריליס"}</PrimaryBtn>
          </div>
        </>
      )}
    </ModalShell>,
    document.body,
  );
}
