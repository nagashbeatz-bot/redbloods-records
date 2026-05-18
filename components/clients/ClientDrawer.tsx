"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Client, ClientType, ClientStatus } from "@/lib/clients-store";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; status: string; artist: string;
  deadline: string | null; project_type?: string;
}
interface Transaction {
  project_id: string; type: "income" | "expense"; amount: number;
  payment_status: string; date: string | null; currency: string;
}
interface Session {
  id: string; project_id: string; date: string | null;
  start_time: string | null; end_time: string | null; status: string; notes: string;
}
interface FinanceSetting { project_id: string; agreedPrice: number; currency: string; }
interface DeliveryRecord {
  projectId: string; deliveryLink: string; deliveryStatus: string; deliveredAt: string | null;
}
interface ProjectFinance {
  projectId: string; name: string; status: string;
  agreedPrice: number; currency: string; totalPaid: number; totalExpected: number; totalExpenses: number;
}
interface Meeting {
  id: string; client_id: string; client_name: string;
  project_id: string | null; date: string | null; time: string | null;
  duration: number; location: string; notes: string;
  status: "נקבעה" | "התקיימה" | "בוטלה"; calendar_event_id: string | null;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ClientType, { bg: string; color: string }> = {
  "אמן":       { bg: "rgba(168,85,247,0.15)",  color: "#C084FC" },
  "לקוח":      { bg: "rgba(59,130,246,0.15)",  color: "#60A5FA" },
  "איש צוות": { bg: "rgba(16,185,129,0.15)",  color: "#34D399" },
  "אחר":       { bg: "rgba(107,114,128,0.15)", color: "#9CA3AF" },
};
const STATUS_COLORS: Record<ClientStatus, { bg: string; color: string }> = {
  "פעיל":    { bg: "rgba(16,185,129,0.12)",  color: "#34D399" },
  "לא פעיל": { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
  "בעייתי":  { bg: "rgba(239,68,68,0.12)",   color: "#F87171" },
  "VIP":     { bg: "rgba(245,158,11,0.12)",  color: "#FBBF24" },
  "חדש":     { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
};
const PROJECT_STATUS_COLOR: Record<string, string> = {
  "בעבודה": "#3B82F6", "מחכה למיקס": "#F59E0B", "במיקס": "#A855F7",
  "לא התחיל": "#6B7280", "הושלם": "#10B981", "בהשהייה": "#EF4444",
};
const MEETING_STATUS_COLOR: Record<Meeting["status"], string> = {
  "נקבעה": "#3B82F6", "התקיימה": "#10B981", "בוטלה": "#6B7280",
};
const LOCATIONS = ["פגישה פנים אל פנים", "זום", "טלפון", "סטודיו", "אחר"];
const DURATIONS = [30, 45, 60, 90, 120];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}
function fmtMoney(n: number, cur = "₪") {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}${cur}`;
}

// ─── ClientDrawer (center modal) ──────────────────────────────────────────────

interface ClientDrawerProps {
  client: Client | null;
  onClose: () => void;
  onEdit: (client: Client) => void;
}

export default function ClientDrawer({ client, onClose, onEdit }: ClientDrawerProps) {
  const { openProject } = useGlobalProjectDrawer();
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [finances,   setFinances]   = useState<ProjectFinance[]>([]);
  const [sessions,   setSessions]   = useState<Session[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [meetings,   setMeetings]   = useState<Meeting[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [mounted,    setMounted]    = useState(false);
  const [showMeetingForm, setShowMeetingForm] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!client) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [client, onClose]);

  const loadData = useCallback(async (c: Client) => {
    setLoading(true);
    setProjects([]); setFinances([]); setSessions([]); setDeliveries([]); setMeetings([]);
    try {
      const [projRes, txRes, sessRes, delivRes, meetRes] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/transactions?all=1").then((r) => r.json()),
        fetch("/api/sessions?all=1").then((r) => r.json()),
        fetch("/api/delivery?all=1").then((r) => r.json()).catch(() => ({ deliveries: [] })),
        fetch(`/api/meetings?clientId=${c.id}`).then((r) => r.json()).catch(() => ({ meetings: [] })),
      ]);

      const allProjects: Project[] = Array.isArray(projRes) ? projRes : (projRes.projects ?? []);
      const clientProjects = allProjects.filter((p) =>
        p.artist.split(/[,،;]/).map((s: string) => s.trim()).includes(c.name)
      );
      const projectIds = new Set(clientProjects.map((p) => p.id));

      const allTx: Transaction[]       = txRes.transactions ?? [];
      const allSettings: FinanceSetting[] = txRes.settings ?? [];
      const allSessions: Session[]     = sessRes.sessions ?? [];

      const finMap = new Map<string, ProjectFinance>();
      for (const p of clientProjects) {
        finMap.set(p.id, { projectId: p.id, name: p.name, status: p.status, agreedPrice: 0, currency: "₪", totalPaid: 0, totalExpected: 0, totalExpenses: 0 });
      }
      for (const t of allTx) {
        if (!projectIds.has(t.project_id)) continue;
        const fin = finMap.get(t.project_id)!;
        if (t.type === "income") {
          if (["שולם","התקבל"].includes(t.payment_status)) fin.totalPaid += t.amount;
          else if (["צפוי","חלקי"].includes(t.payment_status)) fin.totalExpected += t.amount;
        } else { fin.totalExpenses += t.amount; }
      }
      for (const s of allSettings) {
        if (!finMap.has(s.project_id)) continue;
        const fin = finMap.get(s.project_id)!;
        fin.agreedPrice = s.agreedPrice ?? 0;
        fin.currency    = s.currency    ?? "₪";
      }

      setProjects(clientProjects);
      setFinances(Array.from(finMap.values()));
      setSessions(allSessions.filter((s) => projectIds.has(s.project_id)));
      setDeliveries((delivRes.deliveries ?? []).filter(
        (d: DeliveryRecord) => projectIds.has(d.projectId) && d.deliveryStatus !== "not_created" && d.deliveryLink
      ));
      setMeetings(meetRes.meetings ?? []);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (client) loadData(client); }, [client, loadData]);

  const addMeeting = useCallback((m: Meeting) => setMeetings((prev) => [...prev, m]), []);
  const updateMeeting = useCallback((m: Meeting) => setMeetings((prev) => prev.map((x) => x.id === m.id ? m : x)), []);
  const removeMeeting = useCallback((id: string) => setMeetings((prev) => prev.filter((x) => x.id !== id)), []);

  if (!mounted || !client) return null;

  const modal = (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: "#141414", border: "1px solid #262626", borderRadius: 22, width: "100%", maxWidth: 680, maxHeight: "88vh", display: "flex", flexDirection: "column", direction: "rtl", boxShadow: "0 32px 80px rgba(0,0,0,0.9)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalContent
          client={client}
          projects={projects}
          finances={finances}
          sessions={sessions}
          deliveries={deliveries}
          meetings={meetings}
          loading={loading}
          showMeetingForm={showMeetingForm}
          onClose={onClose}
          onEdit={onEdit}
          openProject={(id) => { onClose(); setTimeout(() => openProject(id), 50); }}
          onOpenMeetingForm={() => setShowMeetingForm(true)}
          onCloseMeetingForm={() => setShowMeetingForm(false)}
          onAddMeeting={addMeeting}
          onUpdateMeeting={updateMeeting}
          onRemoveMeeting={removeMeeting}
        />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─── ModalContent ─────────────────────────────────────────────────────────────

function ModalContent({
  client, projects, finances, sessions, deliveries, meetings, loading,
  showMeetingForm, onClose, onEdit, openProject,
  onOpenMeetingForm, onCloseMeetingForm, onAddMeeting, onUpdateMeeting, onRemoveMeeting,
}: {
  client: Client; projects: Project[]; finances: ProjectFinance[];
  sessions: Session[]; deliveries: DeliveryRecord[]; meetings: Meeting[];
  loading: boolean; showMeetingForm: boolean;
  onClose: () => void; onEdit: (c: Client) => void; openProject: (id: string) => void;
  onOpenMeetingForm: () => void; onCloseMeetingForm: () => void;
  onAddMeeting: (m: Meeting) => void; onUpdateMeeting: (m: Meeting) => void;
  onRemoveMeeting: (id: string) => void;
}) {
  const today = new Date().toISOString().split("T")[0];

  const totalAgreed   = finances.reduce((s, f) => s + f.agreedPrice, 0);
  const totalPaid     = finances.reduce((s, f) => s + f.totalPaid, 0);
  const totalExpected = finances.reduce((s, f) => s + f.totalExpected, 0);
  const totalBalance  = totalAgreed - totalPaid;
  const totalExpenses = finances.reduce((s, f) => s + f.totalExpenses, 0);
  const currency      = finances[0]?.currency ?? "₪";

  const completedSessions = sessions.filter((s) => s.status === "התקיים").length;
  const plannedSessions   = sessions.filter((s) => s.status === "מתוכנן").length;
  const nextSession = sessions.filter((s) => s.status === "מתוכנן" && s.date && s.date >= today).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  const lastSession = sessions.filter((s) => s.status === "התקיים" && s.date).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

  const upcomingMeetings = meetings.filter((m) => m.status === "נקבעה" && m.date && m.date >= today).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const pastMeetings     = meetings.filter((m) => m.status !== "נקבעה" || !m.date || m.date < today).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5);

  const typeColor   = TYPE_COLORS[client.type]    ?? TYPE_COLORS["אחר"];
  const statusColor = STATUS_COLORS[client.status] ?? STATUS_COLORS["חדש"];

  return (
    <>
      {/* ── Sticky header ── */}
      <div style={{ padding: "18px 22px 16px", borderBottom: "1px solid #222", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F0", marginBottom: 8, lineHeight: 1.2 }}>{client.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip bg={typeColor.bg} color={typeColor.color}>{client.type}</Chip>
              <Chip bg={statusColor.bg} color={statusColor.color}>{client.status}</Chip>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <IconBtn onClick={() => onEdit(client)} title="עריכה">✎</IconBtn>
            <IconBtn onClick={onClose} title="סגור" style={{ fontSize: 20 }}>×</IconBtn>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ overflowY: "auto", flex: 1, padding: "18px 22px 28px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Contact + quick actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Contact row */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <ContactItem icon="📞" value={client.phone} href={client.phone ? `tel:${client.phone}` : undefined} />
            <ContactItem icon="✉" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {client.phone && (
              <QuickBtn href={`https://wa.me/972${client.phone.replace(/^0/, "").replace(/\D/g, "")}`} color="#25D366" icon="💬" label="WhatsApp" />
            )}
            {client.phone && <CopyBtn text={client.phone} label="טלפון" icon="📋" />}
            {client.email && (
              <QuickBtn href={`mailto:${client.email}`} color="#3B82F6" icon="✉" label="מייל" />
            )}
            <QuickBtn onClick={onOpenMeetingForm} color="#F59E0B" icon="📅" label="פגישה" />
          </div>
        </div>

        {/* Meeting form */}
        {showMeetingForm && (
          <MeetingForm
            client={client}
            projects={projects}
            onClose={onCloseMeetingForm}
            onSaved={onAddMeeting}
          />
        )}

        {/* Notes */}
        {client.notes && (
          <SectionCard title="הערות">
            <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>{client.notes}</div>
          </SectionCard>
        )}

        {loading ? (
          <div style={{ textAlign: "center", color: "#444", fontSize: 13, padding: "24px 0" }}>טוען נתונים...</div>
        ) : (
          <>
            {/* Finance summary */}
            {totalAgreed > 0 ? (
              <SectionCard title="כספים">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: totalExpected > 0 ? 10 : 0 }}>
                  <StatCard label="סוכם" value={fmtMoney(totalAgreed, currency)} color="#A855F7" />
                  <StatCard label="שולם" value={fmtMoney(totalPaid, currency)} color="#10B981" />
                  <StatCard label="יתרה" value={fmtMoney(totalBalance, currency)} color={totalBalance <= 0 ? "#10B981" : "#EF4444"} />
                  <StatCard label="רווח" value={fmtMoney(totalPaid - totalExpenses, currency)} color={(totalPaid - totalExpenses) >= 0 ? "#10B981" : "#EF4444"} />
                </div>
                {totalExpected > 0 && (
                  <div style={{ fontSize: 12, color: "#555", borderTop: "1px solid #222", paddingTop: 8 }}>
                    תשלום צפוי: <span style={{ color: "#3B82F6", fontWeight: 600 }}>{fmtMoney(totalExpected, currency)}</span>
                  </div>
                )}
              </SectionCard>
            ) : (
              <EmptyState icon="₪" text="אין נתונים כספיים עדיין" />
            )}

            {/* Projects */}
            {projects.length > 0 ? (
              <SectionCard title={`פרויקטים (${projects.length})`}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {projects.map((p) => {
                    const fin = finances.find((f) => f.projectId === p.id);
                    const balance = fin ? fin.agreedPrice - fin.totalPaid : 0;
                    const sColor = PROJECT_STATUS_COLOR[p.status] ?? "#6B7280";
                    return (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        balance={balance}
                        fin={fin}
                        statusColor={sColor}
                        onOpen={() => openProject(p.id)}
                      />
                    );
                  })}
                </div>
              </SectionCard>
            ) : (
              <EmptyState icon="♫" text="אין פרויקטים מקושרים" />
            )}

            {/* Sessions */}
            {sessions.length > 0 ? (
              <SectionCard title={`סשנים (${sessions.length})`}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                  <StatCard label="סה״כ"     value={String(sessions.length)}         color="#A855F7" small />
                  <StatCard label="התקיימו"  value={String(completedSessions)}        color="#10B981" small />
                  <StatCard label="מתוכננים" value={String(plannedSessions)}           color="#3B82F6" small />
                </div>
                {lastSession && <InfoRow label="סשן אחרון" value={fmtDate(lastSession.date)} />}
                {nextSession  && <InfoRow label="סשן הבא" value={`${fmtDate(nextSession.date)}${nextSession.start_time ? ` ב-${nextSession.start_time.slice(0,5)}` : ""}`} color="#3B82F6" />}
              </SectionCard>
            ) : (
              <EmptyState icon="🎵" text="אין סשנים עדיין" />
            )}

            {/* Meetings */}
            <SectionCard
              title="פגישות"
              action={<QuickBtn onClick={onOpenMeetingForm} color="#F59E0B" icon="+" label="פגישה חדשה" small />}
            >
              {upcomingMeetings.length === 0 && pastMeetings.length === 0 ? (
                <div style={{ fontSize: 12, color: "#444", padding: "8px 0" }}>אין פגישות עדיין</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {upcomingMeetings.map((m) => (
                    <MeetingRow key={m.id} meeting={m} projects={projects} onUpdate={onUpdateMeeting} onDelete={onRemoveMeeting} />
                  ))}
                  {pastMeetings.map((m) => (
                    <MeetingRow key={m.id} meeting={m} projects={projects} onUpdate={onUpdateMeeting} onDelete={onRemoveMeeting} dim />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Deliveries */}
            {deliveries.length > 0 && (
              <SectionCard title={`מסירות (${deliveries.length})`}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {deliveries.map((d) => {
                    const proj = projects.find((p) => p.id === d.projectId);
                    return <DeliveryRow key={d.projectId} delivery={d} projectName={proj?.name} />;
                  })}
                </div>
              </SectionCard>
            )}
          </>
        )}

        {client.created_at && (
          <div style={{ fontSize: 11, color: "#2A2A2A", textAlign: "center" }}>
            נוסף: {fmtDate(client.created_at.slice(0, 10))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── MeetingForm ──────────────────────────────────────────────────────────────

function MeetingForm({ client, projects, onClose, onSaved }: {
  client: Client; projects: Project[];
  onClose: () => void; onSaved: (m: Meeting) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate]         = useState(today);
  const [time, setTime]         = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("פגישה פנים אל פנים");
  const [notes, setNotes]       = useState("");
  const [projectId, setProjectId] = useState("");
  const [addCal, setAddCal]     = useState(false);
  const [saving, setSaving]     = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, clientName: client.name, projectId: projectId || null, date, time, duration, location, notes, addToCalendar: addCal }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      onSaved(d.meeting);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #F59E0B33", borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#F59E0B", marginBottom: 14 }}>📅 קביעת פגישה עם {client.name}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <FormField label="תאריך">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
        </FormField>
        <FormField label="שעה">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
        </FormField>
        <FormField label="משך">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={inp}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} דקות</option>)}
          </select>
        </FormField>
        <FormField label="מיקום">
          <select value={location} onChange={(e) => setLocation(e.target.value)} style={inp}>
            {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </FormField>
      </div>

      {projects.length > 0 && (
        <FormField label="קשר לפרויקט (אופציונלי)">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
            <option value="">— ללא פרויקט —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
      )}

      <FormField label="הערות">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="נושא הפגישה, הכנות, שאלות..." style={{ ...inp, resize: "vertical", minHeight: 52, marginBottom: 10 }} />
      </FormField>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#777", cursor: "pointer", marginBottom: 14 }}>
        <input type="checkbox" checked={addCal} onChange={(e) => setAddCal(e.target.checked)} style={{ accentColor: "#F59E0B" }} />
        הוסף ליומן Google Calendar
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={save} disabled={saving}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.12)", color: "#F59E0B", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "שומר..." : "✓ שמור פגישה"}
        </button>
        <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #2A2A2A", background: "#141414", color: "#555", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
      </div>
    </div>
  );
}

// ─── ProjectRow with action menu ──────────────────────────────────────────────

function ProjectRow({ project: p, balance, fin, statusColor, onOpen }: {
  project: Project; balance: number; fin?: ProjectFinance;
  statusColor: string; onOpen: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div style={{ position: "relative", background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
      {/* Project info — clickable */}
      <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#D8D8D8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30`, whiteSpace: "nowrap", flexShrink: 0 }}>{p.status}</span>
        </div>
        {p.deadline && (
          <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>דדליין: {fmtDate(p.deadline)}</div>
        )}
      </div>

      {/* Balance badge */}
      {fin && fin.agreedPrice > 0 && (
        <span style={{ fontSize: 11, color: balance <= 0 ? "#10B981" : "#EF4444", flexShrink: 0, fontWeight: 600 }}>
          {balance <= 0 ? "✓ שולם" : fmtMoney(balance, fin.currency)}
        </span>
      )}

      {/* Action menu button */}
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #2A2A2A", background: "#111", color: "#555", fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        ⋯
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 100 }} onClick={() => setMenuOpen(false)} />
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 101, marginTop: 4, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 10, padding: 4, minWidth: 160, boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}>
            {[
              { icon: "♫", label: "פתח פרויקט", action: () => { setMenuOpen(false); onOpen(); } },
              { icon: "₪", label: "פתח כספים", action: () => { setMenuOpen(false); onOpen(); } },
            ].map(({ icon, label, action }) => (
              <button key={label} onClick={action} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 7, border: "none", background: "none", color: "#CCC", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "right" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#252525"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
              >
                <span>{icon}</span> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── MeetingRow ───────────────────────────────────────────────────────────────

function MeetingRow({ meeting: m, projects, onUpdate, onDelete, dim }: {
  meeting: Meeting; projects: Project[];
  onUpdate: (m: Meeting) => void; onDelete: (id: string) => void; dim?: boolean;
}) {
  const proj = projects.find((p) => p.id === m.project_id);
  const statusColor = MEETING_STATUS_COLOR[m.status] ?? "#6B7280";

  async function changeStatus(status: Meeting["status"]) {
    const res = await fetch(`/api/meetings/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const d = await res.json();
    if (d.meeting) onUpdate(d.meeting);
  }
  async function del() {
    if (!confirm("למחוק פגישה זו?")) return;
    await fetch(`/api/meetings/${m.id}`, { method: "DELETE" });
    onDelete(m.id);
  }

  return (
    <div style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: "9px 12px", opacity: dim ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#D0D0D0" }}>
              {fmtDate(m.date)}{m.time ? ` · ${m.time.slice(0, 5)}` : ""}
            </span>
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>{m.status}</span>
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            {m.location}{proj ? ` · ${proj.name}` : ""}
            {m.duration ? ` · ${m.duration} דק׳` : ""}
          </div>
          {m.notes && <div style={{ fontSize: 11, color: "#444", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.notes}</div>}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {m.status === "נקבעה" && (
            <button onClick={() => changeStatus("התקיימה")} title="סמן כהתקיימה" style={{ ...smBtn, color: "#10B981", borderColor: "rgba(16,185,129,0.3)" }}>✓</button>
          )}
          {m.status === "נקבעה" && (
            <button onClick={() => changeStatus("בוטלה")} title="בטל" style={{ ...smBtn, color: "#EF4444", borderColor: "rgba(239,68,68,0.3)" }}>✕</button>
          )}
          <button onClick={del} title="מחק" style={{ ...smBtn, color: "#444" }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

// ─── DeliveryRow ──────────────────────────────────────────────────────────────

function DeliveryRow({ delivery: d, projectName }: { delivery: DeliveryRecord; projectName?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(d.deliveryLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); };
  return (
    <div style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#D0D0D0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName ?? d.projectId}</div>
        {d.deliveredAt && <div style={{ fontSize: 10, color: "#444" }}>נמסר {fmtDate(d.deliveredAt.slice(0, 10))}</div>}
      </div>
      <button onClick={copy} style={{ padding: "4px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, border: copied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(168,85,247,0.3)", background: copied ? "rgba(16,185,129,0.1)" : "rgba(168,85,247,0.08)", color: copied ? "#10B981" : "#C084FC", transition: "all 0.15s", whiteSpace: "nowrap" }}>
        {copied ? "✓ הועתק" : "📋 לינק"}
      </button>
      {d.deliveryLink && <a href={d.deliveryLink} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 9px", borderRadius: 7, fontSize: 11, border: "1px solid #222", background: "#1A1A1A", color: "#555", textDecoration: "none" }}>↗</a>}
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #222", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ background: "#1A1A1A", border: "1px solid #1E1E1E", borderRadius: 14, padding: "18px 16px", textAlign: "center", color: "#333", fontSize: 12 }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      {text}
    </div>
  );
}

function Chip({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, background: bg, color, border: `1px solid ${color}30`, fontSize: 11, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: small ? "8px 10px" : "10px 12px" }}>
      <div style={{ fontSize: 10, color: "#444", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid #1E1E1E" }}>
      <span style={{ fontSize: 12, color: "#555" }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? "#999", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function ContactItem({ icon, value, href }: { icon: string; value?: string; href?: string }) {
  const text = value || "לא הוגדר";
  const style: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: value ? "#A0A0A0" : "#333", direction: "ltr", textDecoration: "none" };
  return href ? (
    <a href={href} style={style} onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#D0D0D0"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = value ? "#A0A0A0" : "#333"; }}>
      <span>{icon}</span><span>{text}</span>
    </a>
  ) : (
    <span style={style}><span>{icon}</span><span>{text}</span></span>
  );
}

function QuickBtn({ href, onClick, color, icon, label, small }: { href?: string; onClick?: () => void; color: string; icon: string; label: string; small?: boolean }) {
  const s: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, padding: small ? "5px 10px" : "7px 14px", borderRadius: 10, border: `1px solid ${color}30`, background: `${color}10`, color, fontSize: small ? 11 : 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", whiteSpace: "nowrap" };
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" style={s}>{icon} {label}</a>
    : <button onClick={onClick} style={s}>{icon} {label}</button>;
}

function CopyBtn({ text, label, icon }: { text: string; label: string; icon: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); };
  return (
    <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, border: copied ? "1px solid rgba(16,185,129,0.35)" : "1px solid #2A2A2A", background: copied ? "rgba(16,185,129,0.1)" : "#1A1A1A", color: copied ? "#10B981" : "#777", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s" }}>
      {copied ? "✓" : icon} {copied ? "הועתק" : label}
    </button>
  );
}

function IconBtn({ onClick, title, children, style }: { onClick: () => void; title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} title={title} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #2A2A2A", background: "#1A1A1A", color: "#666", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
      {children}
    </button>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #2A2A2A",
  background: "#111", color: "#E0E0E0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

const smBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6, border: "1px solid #2A2A2A",
  background: "#1A1A1A", fontSize: 12, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
