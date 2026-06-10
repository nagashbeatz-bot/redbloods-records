"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Client, ClientType, ClientStatus } from "@/lib/clients-store";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";
import ProposalsSection, { type Proposal, type NewProject } from "@/components/clients/ProposalsSection";
import { useProjects } from "@/components/ProjectsProvider";
import { checkProposalFollowUps, type ProposalFinding } from "@/lib/mai/operational-rules";

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
  start_time: string | null; end_time: string | null;
  status: string; session_type: string; notes: string;
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

type FormMode = "meeting" | "session" | "newProject" | null;
type SavedResult =
  | { type: "meeting"; data: Meeting }
  | { type: "session"; data: Session };

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
const SESSION_STATUS_COLOR: Record<string, string> = {
  "מתוכנן":  "#3B82F6",
  "התקיים":  "#10B981",
  "בוטל":    "#6B7280",
  "לא הגיע": "#EF4444",
};
const MEETING_LOCATIONS = ["פגישה פנים אל פנים", "זום", "טלפון", "סטודיו", "אחר"];
const SESSION_LOCATIONS  = ["סטודיו", "סטודיו ביתי", "זום", "אחר"];
const MEETING_DURATIONS  = [30, 45, 60, 90, 120];
const SESSION_DURATIONS  = [60, 90, 120, 180, 240, 300, 360];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
}
function fmtMoney(n: number, cur = "₪") {
  return `${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}${cur}`;
}
function calcEndTime(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + durationMin;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ─── ClientDrawer (center modal) ──────────────────────────────────────────────

interface ClientDrawerProps {
  client: Client | null;
  onClose: () => void;
  onEdit: (client: Client) => void;
}

export default function ClientDrawer({ client, onClose, onEdit }: ClientDrawerProps) {
  const { openProject } = useGlobalProjectDrawer();
  const { refresh: refreshGlobalProjects } = useProjects();
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [finances,   setFinances]   = useState<ProjectFinance[]>([]);
  const [sessions,   setSessions]   = useState<Session[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [meetings,   setMeetings]   = useState<Meeting[]>([]);
  const [proposals,  setProposals]  = useState<Proposal[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [mounted,    setMounted]    = useState(false);
  const [formMode,   setFormMode]   = useState<FormMode>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!client) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [client, onClose]);

  const loadData = useCallback(async (c: Client) => {
    setLoading(true);
    setProjects([]); setFinances([]); setSessions([]); setDeliveries([]); setMeetings([]); setProposals([]);
    try {
      const [projRes, txRes, sessRes, delivRes, meetRes, propRes] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/transactions?all=1").then((r) => r.json()),
        fetch("/api/sessions?all=1").then((r) => r.json()),
        fetch("/api/delivery?all=1").then((r) => r.json()).catch(() => ({ deliveries: [] })),
        fetch(`/api/meetings?clientId=${c.id}`).then((r) => r.json()).catch(() => ({ meetings: [] })),
        fetch(`/api/proposals?clientId=${c.id}`).then((r) => r.json()).catch(() => ({ proposals: [] })),
      ]);

      const allProjects: Project[] = Array.isArray(projRes) ? projRes : (projRes.projects ?? []);
      const clientProjects = allProjects.filter((p) =>
        p.artist.split(/[,،;]/).map((s: string) => s.trim()).includes(c.name)
      );
      const projectIds = new Set(clientProjects.map((p) => p.id));

      const allTx: Transaction[]          = txRes.transactions ?? [];
      const allSettings: FinanceSetting[] = txRes.settings ?? [];
      const allSessions: Session[]        = sessRes.sessions ?? [];

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
      setProposals(propRes.proposals ?? []);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (client) loadData(client); }, [client, loadData]);

  const addMeeting    = useCallback((m: Meeting)  => setMeetings((prev) => [...prev, m]), []);
  const updateMeeting = useCallback((m: Meeting)  => setMeetings((prev) => prev.map((x) => x.id === m.id ? m : x)), []);
  const removeMeeting = useCallback((id: string)  => setMeetings((prev) => prev.filter((x) => x.id !== id)), []);
  const addSession    = useCallback((s: Session)  => setSessions((prev) => [...prev, s]), []);
  const updateSession = useCallback((s: Session)  => setSessions((prev) => prev.map((x) => x.id === s.id ? s : x)), []);
  const removeSession = useCallback((id: string)  => setSessions((prev) => prev.filter((x) => x.id !== id)), []);

  const handleFormSaved = useCallback((result: SavedResult) => {
    if (result.type === "meeting") addMeeting(result.data);
    else addSession(result.data);
  }, [addMeeting, addSession]);

  const handleProjectCreated = useCallback((p: Project) => {
    setProjects((prev) => [p, ...prev]);
  }, []);

  const handleRestoreProject = useCallback(async (projectId: string) => {
    setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, status: "בעבודה" } : p));
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "בעבודה" }),
    }).catch(() => {
      // Revert on failure
      setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, status: "הושלם" } : p));
    });
  }, []);

  const handleProposalAdd      = useCallback((p: Proposal) => setProposals((prev) => [p, ...prev]), []);
  const handleProposalUpdate   = useCallback((p: Proposal) => setProposals((prev) => prev.map((x) => x.id === p.id ? p : x)), []);
  const handleProposalDelete   = useCallback((id: string) => setProposals((prev) => prev.filter((x) => x.id !== id)), []);
  const handleProposalConverted = useCallback((proposalId: string, projectId: string, newProject: NewProject) => {
    // Mark proposal as closed
    setProposals((prev) => prev.map((p) =>
      p.id === proposalId ? { ...p, status: "נסגר" as const, linked_project_id: projectId } : p
    ));
    // Add to local ClientDrawer list immediately
    setProjects((prev) => {
      if (prev.some((p) => p.id === projectId)) return prev;
      return [{ ...newProject, projectType: newProject.project_type }, ...prev];
    });
    // Refresh global ProjectsProvider so ProjectDrawer can find the project
    refreshGlobalProjects().catch(() => {});
  }, [refreshGlobalProjects]);

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
          formMode={formMode}
          onClose={onClose}
          onEdit={onEdit}
          openProject={(id) => { if (!id) return; onClose(); setTimeout(() => openProject(id), 300); }}
          onOpenForm={setFormMode}
          onCloseForm={() => setFormMode(null)}
          proposals={proposals}
          onFormSaved={handleFormSaved}
          onProjectCreated={handleProjectCreated}
          onProposalAdd={handleProposalAdd}
          onProposalUpdate={handleProposalUpdate}
          onProposalDelete={handleProposalDelete}
          onProposalConverted={handleProposalConverted}
          onUpdateMeeting={updateMeeting}
          onRemoveMeeting={removeMeeting}
          onUpdateSession={updateSession}
          onRemoveSession={removeSession}
          onRestoreProject={handleRestoreProject}
        />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─── ModalContent ─────────────────────────────────────────────────────────────

function ModalContent({
  client, projects, finances, sessions, deliveries, meetings, proposals, loading,
  formMode, onClose, onEdit, openProject,
  onOpenForm, onCloseForm, onFormSaved, onProjectCreated,
  onProposalAdd, onProposalUpdate, onProposalDelete, onProposalConverted,
  onUpdateMeeting, onRemoveMeeting,
  onUpdateSession, onRemoveSession,
  onRestoreProject,
}: {
  client: Client; projects: Project[]; finances: ProjectFinance[];
  sessions: Session[]; deliveries: DeliveryRecord[]; meetings: Meeting[];
  proposals: Proposal[];
  loading: boolean; formMode: FormMode;
  onClose: () => void; onEdit: (c: Client) => void; openProject: (id: string) => void;
  onOpenForm: (mode: FormMode) => void; onCloseForm: () => void;
  onFormSaved: (r: SavedResult) => void;
  onProjectCreated: (p: Project) => void;
  onProposalAdd: (p: Proposal) => void;
  onProposalUpdate: (p: Proposal) => void;
  onProposalDelete: (id: string) => void;
  onProposalConverted: (proposalId: string, projectId: string, project: NewProject) => void;
  onUpdateMeeting: (m: Meeting) => void; onRemoveMeeting: (id: string) => void;
  onUpdateSession: (s: Session) => void; onRemoveSession: (id: string) => void;
  onRestoreProject: (id: string) => void;
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

  const upcomingSessions = sessions
    .filter((s) => s.status === "מתוכנן" && s.date && s.date >= today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const pastSessions = sessions
    .filter((s) => s.status !== "מתוכנן" || (s.date && s.date < today))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);

  const upcomingMeetings = meetings
    .filter((m) => m.status === "נקבעה" && m.date && m.date >= today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const pastMeetings = meetings
    .filter((m) => m.status !== "נקבעה" || !m.date || m.date < today)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);

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
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <ContactItem icon="📞" value={client.phone} href={client.phone ? `tel:${client.phone}` : undefined} />
            <ContactItem icon="✉" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {client.phone && (
              <QuickBtn href={`https://wa.me/972${client.phone.replace(/^0/, "").replace(/\D/g, "")}`} color="#25D366" icon="💬" label="WhatsApp" />
            )}
            {client.phone && <CopyBtn text={client.phone} label="טלפון" icon="📋" />}
            {client.email && (
              <QuickBtn href={`mailto:${client.email}`} color="#3B82F6" icon="✉" label="מייל" />
            )}
            {/* Two separate action buttons */}
            <QuickBtn
              onClick={() => onOpenForm("meeting")}
              color="#F59E0B" icon="📅" label="פגישה"
              active={formMode === "meeting"}
            />
            <QuickBtn
              onClick={() => onOpenForm("session")}
              color="#A855F7" icon="🎵" label="סשן"
              active={formMode === "session"}
            />
          </div>
        </div>

        {/* Activity form (meeting or session) */}
        {(formMode === "meeting" || formMode === "session") && (
          <ActivityForm
            initialMode={formMode}
            client={client}
            projects={projects}
            onClose={onCloseForm}
            onSaved={onFormSaved}
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
            <SectionCard
              title={`פרויקטים (${projects.length})`}
              action={
                <QuickBtn
                  onClick={() => onOpenForm(formMode === "newProject" ? null : "newProject")}
                  color="#3B82F6" icon="+" label="פרויקט חדש" small
                  active={formMode === "newProject"}
                />
              }
            >
              {formMode === "newProject" && (
                <NewProjectForm
                  client={client}
                  onClose={() => onCloseForm()}
                  onCreated={(p) => { onProjectCreated(p); onCloseForm(); }}
                />
              )}
              {projects.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: formMode === "newProject" ? 12 : 0 }}>
                  {projects.map((p) => {
                    const fin = finances.find((f) => f.projectId === p.id);
                    const balance = fin ? fin.agreedPrice - fin.totalPaid : 0;
                    const sColor  = PROJECT_STATUS_COLOR[p.status] ?? "#6B7280";
                    return (
                      <ProjectRow
                        key={p.id} project={p} balance={balance} fin={fin}
                        statusColor={sColor} onOpen={() => openProject(p.id)}
                        onRestore={p.status === "הושלם" ? () => onRestoreProject(p.id) : undefined}
                      />
                    );
                  })}
                </div>
              ) : (
                !formMode && <div style={{ fontSize: 12, color: "#444", padding: "8px 0" }}>אין פרויקטים מקושרים</div>
              )}
            </SectionCard>

            {/* Mai: follow-up reminders — pure, no fetch */}
            <ProposalFollowUpBlock proposals={proposals} />

            {/* Proposals */}
            <ProposalsSection
              client={client}
              proposals={proposals}
              onAdd={onProposalAdd}
              onUpdate={onProposalUpdate}
              onDelete={onProposalDelete}
              onConverted={onProposalConverted}
              openProject={openProject}
            />

            {/* Sessions */}
            <SectionCard
              title={`סשנים (${sessions.length})`}
              action={
                <QuickBtn onClick={() => onOpenForm("session")} color="#A855F7" icon="+" label="סשן חדש" small />
              }
            >
              {sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: "#444", padding: "8px 0" }}>אין סשנים עדיין</div>
              ) : (
                <>
                  {/* Stats row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                    <StatCard label="סה״כ"     value={String(sessions.length)}  color="#A855F7" small />
                    <StatCard label="התקיימו"  value={String(completedSessions)} color="#10B981" small />
                    <StatCard label="מתוכננים" value={String(plannedSessions)}   color="#3B82F6" small />
                  </div>
                  {/* Upcoming sessions */}
                  {upcomingSessions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 6 }}>
                      {upcomingSessions.map((s) => (
                        <SessionRow key={s.id} session={s} projects={projects} onUpdate={onUpdateSession} onDelete={onRemoveSession} />
                      ))}
                    </div>
                  )}
                  {/* Past sessions */}
                  {pastSessions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {pastSessions.map((s) => (
                        <SessionRow key={s.id} session={s} projects={projects} onUpdate={onUpdateSession} onDelete={onRemoveSession} dim />
                      ))}
                    </div>
                  )}
                </>
              )}
            </SectionCard>

            {/* Meetings */}
            <SectionCard
              title="פגישות"
              action={<QuickBtn onClick={() => onOpenForm("meeting")} color="#F59E0B" icon="+" label="פגישה חדשה" small />}
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

// ─── ActivityForm (meeting + session, with toggle) ────────────────────────────

function ActivityForm({ initialMode, client, projects, onClose, onSaved }: {
  initialMode: "meeting" | "session";
  client: Client;
  projects: Project[];
  onClose: () => void;
  onSaved: (r: SavedResult) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [mode, setMode] = useState<"meeting" | "session">(initialMode);

  // Shared fields
  const [date,     setDate]     = useState(today);
  const [time,     setTime]     = useState("10:00");
  const [notes,    setNotes]    = useState("");
  const [addCal,   setAddCal]   = useState(false);
  const [saving,   setSaving]   = useState(false);

  // Meeting-specific
  const [duration,    setDuration]    = useState(60);
  const [location,    setLocation]    = useState("פגישה פנים אל פנים");
  const [meetProject, setMeetProject] = useState("");

  // Session-specific
  const [sessProjectId, setSessProjectId] = useState(projects[0]?.id ?? "");
  const [sessDuration,  setSessDuration]  = useState(120);
  const [sessLocation,  setSessLocation]  = useState("סטודיו");

  // Optional payment (session only)
  const [showPayment,      setShowPayment]      = useState(false);
  const [paymentAmount,    setPaymentAmount]    = useState("");
  const [paymentCurrency,  setPaymentCurrency]  = useState("₪");

  const accent = mode === "meeting" ? "#F59E0B" : "#A855F7";

  async function save() {
    setSaving(true);
    try {
      if (mode === "meeting") {
        const res = await fetch("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: client.id, clientName: client.name,
            projectId: meetProject || null,
            date, time, duration, location, notes, addToCalendar: addCal,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        onSaved({ type: "meeting", data: d.meeting });
        if (d.calendarError) {
          alert(`הפגישה נשמרה ✓\n\nלא נוספה ל-Google Calendar:\n${d.calendarError}\n\nניתן למחוק וליצור מחדש לאחר חיבור היומן.`);
        }
        onClose();

      } else {
        // Session
        if (!sessProjectId) { alert("יש לבחור פרויקט לסשן"); return; }
        const endTime = calcEndTime(time, sessDuration);
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: sessProjectId,
            date, startTime: time, endTime,
            status: "מתוכנן", sessionType: sessLocation,
            notes, addToCalendar: addCal,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        // Optional linked payment
        if (showPayment && paymentAmount && Number(paymentAmount) > 0) {
          await fetch("/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: "project", projectId: sessProjectId,
              type: "income", date,
              description: "תשלום בסשן",
              artist: client.name,
              amount: Number(paymentAmount),
              currency: paymentCurrency,
              paymentStatus: "צפוי",
              linkedSessionId: d.session.id,
            }),
          }).catch(() => {});
        }

        onSaved({ type: "session", data: d.session });
        onClose();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "שגיאה");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ background: "#1A1A1A", border: `1px solid ${accent}33`, borderRadius: 14, padding: "16px 18px" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["meeting", "session"] as const).map((m) => {
          const col  = m === "meeting" ? "#F59E0B" : "#A855F7";
          const lbl  = m === "meeting" ? "📅 פגישה" : "🎵 סשן";
          const active = mode === m;
          return (
            <button key={m} type="button" onClick={() => setMode(m)} style={{
              flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
              background: active ? `${col}18` : "#111",
              color: active ? col : "#555",
              outline: active ? `1.5px solid ${col}40` : "1.5px solid #252525",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              transition: "all 0.15s",
            }}>
              {lbl}
            </button>
          );
        })}
      </div>

      {/* Form title */}
      <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 14 }}>
        {mode === "meeting"
          ? `📅 קביעת פגישה עם ${client.name}`
          : `🎵 קביעת סשן עם ${client.name}`}
      </div>

      {/* ── Meeting fields ── */}
      {mode === "meeting" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FormField label="תאריך">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
            </FormField>
            <FormField label="שעה">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
            </FormField>
            <FormField label="משך">
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={inp}>
                {MEETING_DURATIONS.map((d) => <option key={d} value={d}>{d} דקות</option>)}
              </select>
            </FormField>
            <FormField label="מיקום">
              <select value={location} onChange={(e) => setLocation(e.target.value)} style={inp}>
                {MEETING_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </FormField>
          </div>

          {projects.length > 0 && (
            <FormField label="קשר לפרויקט (אופציונלי)">
              <select value={meetProject} onChange={(e) => setMeetProject(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
                <option value="">— ללא פרויקט —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
          )}

          <FormField label="הערות">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="נושא הפגישה, הכנות, שאלות..."
              style={{ ...inp, resize: "vertical", minHeight: 52, marginBottom: 10 }} />
          </FormField>
        </>
      )}

      {/* ── Session fields ── */}
      {mode === "session" && (
        <>
          <FormField label="פרויקט *">
            <select value={sessProjectId} onChange={(e) => setSessProjectId(e.target.value)}
              style={{ ...inp, marginBottom: 10, borderColor: !sessProjectId ? "rgba(168,85,247,0.5)" : "#2A2A2A" }}>
              <option value="">— בחר פרויקט —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FormField label="תאריך">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
            </FormField>
            <FormField label="שעת התחלה">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
            </FormField>
            <FormField label="משך">
              <select value={sessDuration} onChange={(e) => setSessDuration(Number(e.target.value))} style={inp}>
                {SESSION_DURATIONS.map((d) => <option key={d} value={d}>{d >= 60 ? `${d / 60} שעות` : `${d} דקות`}</option>)}
              </select>
            </FormField>
            <FormField label="מיקום">
              <select value={sessLocation} onChange={(e) => setSessLocation(e.target.value)} style={inp}>
                {SESSION_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </FormField>
          </div>

          {time && (
            <div style={{ fontSize: 11, color: "#555", marginBottom: 10, marginTop: -6 }}>
              שעת סיום משוערת: <span style={{ color: "#777" }}>{calcEndTime(time, sessDuration)}</span>
            </div>
          )}

          <FormField label="הערות">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="נושא הסשן, הכנות, ציוד..."
              style={{ ...inp, resize: "vertical", minHeight: 52, marginBottom: 10 }} />
          </FormField>

          {/* Optional payment */}
          <div style={{ marginBottom: 10 }}>
            <button type="button" onClick={() => setShowPayment((v) => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer",
              background: showPayment ? "rgba(16,185,129,0.1)" : "transparent",
              color: showPayment ? "#10B981" : "#444",
              fontSize: 11, fontFamily: "inherit",
              outline: showPayment ? "1px solid rgba(16,185,129,0.3)" : "1px solid #252525",
            }}>
              💰 {showPayment ? "הסתר תשלום" : "הוסף תשלום צפוי"}
            </button>
            {showPayment && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>סכום צפוי</div>
                  <input type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="0" style={inp} />
                </div>
                <div style={{ width: 60 }}>
                  <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>מטבע</div>
                  <select value={paymentCurrency} onChange={(e) => setPaymentCurrency(e.target.value)} style={inp}>
                    {["₪", "$", "€"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Calendar + Buttons */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#777", cursor: "pointer", marginBottom: 14 }}>
        <input type="checkbox" checked={addCal} onChange={(e) => setAddCal(e.target.checked)} style={{ accentColor: accent }} />
        הוסף ל-Google Calendar
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={save} disabled={saving || (mode === "session" && !sessProjectId)}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 10,
            border: `1px solid ${accent}40`,
            background: `${accent}12`,
            color: (saving || (mode === "session" && !sessProjectId)) ? "#444" : accent,
            fontSize: 13, fontWeight: 600,
            cursor: (saving || (mode === "session" && !sessProjectId)) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: (saving || (mode === "session" && !sessProjectId)) ? 0.6 : 1,
          }}
        >
          {saving ? "שומר..." : mode === "meeting" ? "✓ שמור פגישה" : "✓ שמור סשן"}
        </button>
        <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #2A2A2A", background: "#141414", color: "#555", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>ביטול</button>
      </div>
    </div>
  );
}

// ─── SessionRow ───────────────────────────────────────────────────────────────

function SessionRow({ session: s, projects, onUpdate, onDelete, dim }: {
  session: Session; projects: Project[];
  onUpdate: (s: Session) => void; onDelete: (id: string) => void; dim?: boolean;
}) {
  const proj        = projects.find((p) => p.id === s.project_id);
  const statusColor = SESSION_STATUS_COLOR[s.status] ?? "#6B7280";

  async function changeStatus(status: string) {
    const res = await fetch(`/api/sessions/${s.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = await res.json();
    if (d.session) onUpdate(d.session);
  }
  async function del() {
    if (!confirm("למחוק סשן זה?")) return;
    await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
    onDelete(s.id);
  }

  return (
    <div style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: "9px 12px", opacity: dim ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#D0D0D0" }}>
              {fmtDate(s.date)}{s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ""}
            </span>
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
              {s.status}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            {proj?.name ?? "—"}
            {s.session_type && s.session_type !== "סשן" ? ` · ${s.session_type}` : ""}
            {s.start_time && s.end_time ? ` · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : ""}
          </div>
          {s.notes && <div style={{ fontSize: 11, color: "#444", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.notes}</div>}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {s.status === "מתוכנן" && (
            <button onClick={() => changeStatus("התקיים")} title="סמן כהתקיים"
              style={{ ...smBtn, color: "#10B981", borderColor: "rgba(16,185,129,0.3)" }}>✓</button>
          )}
          {s.status === "מתוכנן" && (
            <button onClick={() => changeStatus("לא הגיע")} title="לא הגיע"
              style={{ ...smBtn, color: "#F59E0B", borderColor: "rgba(245,158,11,0.3)", fontSize: 10, fontWeight: 700 }}>!</button>
          )}
          {s.status === "מתוכנן" && (
            <button onClick={() => changeStatus("בוטל")} title="בטל"
              style={{ ...smBtn, color: "#EF4444", borderColor: "rgba(239,68,68,0.3)" }}>✕</button>
          )}
          <button onClick={del} title="מחק" style={{ ...smBtn, color: "#444" }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

// ─── ProjectRow with action menu ──────────────────────────────────────────────

function ProjectRow({ project: p, balance, fin, statusColor, onOpen, onRestore }: {
  project: Project; balance: number; fin?: ProjectFinance;
  statusColor: string; onOpen: () => void; onRestore?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const menuItems = [
    { icon: "♫", label: "פתח פרויקט", action: () => { setMenuOpen(false); onOpen(); } },
    { icon: "₪", label: "פתח כספים",  action: () => { setMenuOpen(false); onOpen(); } },
    ...(p.status === "הושלם" && onRestore ? [{
      icon: "↩", label: "החזר לעבודה",
      action: () => { setMenuOpen(false); onRestore(); },
      color: "#60A5FA",
    }] : []),
  ];

  return (
    <div style={{ position: "relative", background: "#1A1A1A", border: "1px solid #252525", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
      <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#D8D8D8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30`, whiteSpace: "nowrap", flexShrink: 0 }}>{p.status}</span>
        </div>
        {p.deadline && <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>דדליין: {fmtDate(p.deadline)}</div>}
      </div>

      {fin && fin.agreedPrice > 0 && (
        <span style={{ fontSize: 11, color: balance <= 0 ? "#10B981" : "#EF4444", flexShrink: 0, fontWeight: 600 }}>
          {balance <= 0 ? "✓ שולם" : fmtMoney(balance, fin.currency)}
        </span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #2A2A2A", background: "#111", color: "#555", fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        ⋯
      </button>

      {menuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 100 }} onClick={() => setMenuOpen(false)} />
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 101, marginTop: 4, background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 10, padding: 4, minWidth: 160, boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}>
            {menuItems.map(({ icon, label, action, color }) => (
              <button key={label} onClick={action}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", borderRadius: 7, border: "none", background: "none", color: color ?? "#CCC", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "right" }}
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
  const proj        = projects.find((p) => p.id === m.project_id);
  const statusColor = MEETING_STATUS_COLOR[m.status] ?? "#6B7280";

  async function changeStatus(status: Meeting["status"]) {
    const res = await fetch(`/api/meetings/${m.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
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

function ContactItem({ icon, value, href }: { icon: string; value?: string; href?: string }) {
  const text  = value || "לא הוגדר";
  const style: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: value ? "#A0A0A0" : "#333", direction: "ltr", textDecoration: "none" };
  return href ? (
    <a href={href} style={style} onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#D0D0D0"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = value ? "#A0A0A0" : "#333"; }}>
      <span>{icon}</span><span>{text}</span>
    </a>
  ) : (
    <span style={style}><span>{icon}</span><span>{text}</span></span>
  );
}

function QuickBtn({ href, onClick, color, icon, label, small, active }: {
  href?: string; onClick?: () => void; color: string; icon: string;
  label: string; small?: boolean; active?: boolean;
}) {
  const s: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: small ? "5px 10px" : "7px 14px", borderRadius: 10,
    border: active ? `1.5px solid ${color}50` : `1px solid ${color}30`,
    background: active ? `${color}20` : `${color}10`,
    color, fontSize: small ? 11 : 12, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", textDecoration: "none", whiteSpace: "nowrap",
  };
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={s}>{icon} {label}</a>
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

// ─── NewProjectForm ───────────────────────────────────────────────────────────

const PROJECT_TYPES_LIST = ["שיר", "קליפ", "EP", "אלבום", "רידים", "אחר"] as const;
const PROJECT_INIT_STATUSES = ["לא התחיל", "בעבודה"] as const;

function NewProjectForm({ client, onClose, onCreated }: {
  client: Client;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name,        setName]        = useState("");
  const [projectType, setProjectType] = useState<string>("שיר");
  const [status,      setStatus]      = useState<string>("לא התחיל");
  const [deadline,    setDeadline]    = useState("");
  const [notes,       setNotes]       = useState("");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("חובה להזין שם פרויקט"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        name.trim(),
          artist:      client.name,   // ← קשר לקוח דרך artist
          projectType,
          status,
          deadline:    deadline || null,
          notes:       notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data.error ?? "שגיאה ביצירת הפרויקט");
      onCreated({
        id: data.id, name: name.trim(), artist: client.name,
        status, deadline: deadline || null, project_type: projectType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "#111", border: "1px solid #2A2A2A", borderRadius: 12, padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>
        פרויקט חדש עבור {client.name}
      </div>

      {/* שם פרויקט */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>שם הפרויקט *</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם הפרויקט"
          style={{ ...inp }}
          disabled={saving}
        />
      </div>

      {/* שורה: סוג + סטטוס */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סוג</div>
          <select value={projectType} onChange={(e) => setProjectType(e.target.value)} style={{ ...inp }} disabled={saving}>
            {PROJECT_TYPES_LIST.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>סטטוס</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inp }} disabled={saving}>
            {PROJECT_INIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* דדליין */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>דדליין (אופציונלי)</div>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={{ ...inp, colorScheme: "dark" }}
          disabled={saving}
        />
      </div>

      {/* הערות */}
      <div>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>הערות</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="הערות לפרויקט..."
          rows={2}
          style={{ ...inp, resize: "none", lineHeight: 1.5 }}
          disabled={saving}
        />
      </div>

      {/* Artist (locked) */}
      <div style={{ fontSize: 11, color: "#444", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#333" }}>♫</span>
        <span>אמן: </span>
        <span style={{ color: "#666", fontWeight: 600 }}>{client.name}</span>
        <span style={{ marginRight: "auto", fontSize: 10, color: "#2A2A2A" }}>(נקבע אוטומטית)</span>
      </div>

      {error && <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
        <button type="button" onClick={onClose} disabled={saving}
          style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid #2A2A2A", background: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ביטול
        </button>
        <button type="submit" disabled={saving || !name.trim()}
          style={{ padding: "7px 16px", borderRadius: 9, border: "none", background: saving ? "#1E3A5F" : "#2563EB", color: saving ? "#4A7FC0" : "#FFF", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "background 0.15s" }}>
          {saving ? "יוצר..." : "צור פרויקט ←"}
        </button>
      </div>
    </form>
  );
}

// ─── ProposalFollowUpBlock ────────────────────────────────────────────────────
// Mai Operational Layer — read-only, pure, no mutations.

function ProposalFollowUpBlock({ proposals }: { proposals: Proposal[] }) {
  const findings = checkProposalFollowUps(proposals);
  if (findings.length === 0) return null;

  function fmtDate(d: string) {
    const [y, m, day] = d.split("-");
    return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
  }

  function overdueLabel(days: number): string {
    if (days === 0) return "היום";
    if (days === 1) return "לפני יום";
    if (days <= 6) return `לפני ${days} ימים`;
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "לפני שבוע" : `לפני ${weeks} שבועות`;
  }

  return (
    <div style={{
      background: "rgba(245,158,11,0.06)",
      border: "1px solid rgba(245,158,11,0.2)",
      borderRadius: 14, padding: "14px 16px",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "#F59E0B",
        textTransform: "uppercase", letterSpacing: "0.07em",
        marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
      }}>
        <span>⏳</span>
        מעקב הצעות מחיר ({findings.length})
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {findings.map((f: ProposalFinding) => (
          <div key={f.proposalId} style={{
            background: "#1A1A1A", border: "1px solid #252525",
            borderRadius: 10, padding: "9px 12px",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            {/* Status badge */}
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: "#F59E0B",
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 5, padding: "2px 7px",
              flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {f.status}
            </span>

            {/* Title */}
            <span style={{
              flex: 1, fontSize: 12, color: "#CCC",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              minWidth: 0,
            }}>
              {f.title}
            </span>

            {/* Amount */}
            {f.amount > 0 && (
              <span style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>
                {f.amount.toLocaleString("he-IL")}{f.currency}
              </span>
            )}

            {/* Overdue label */}
            <span style={{
              fontSize: 10, color: f.overdueDays === 0 ? "#F59E0B" : "#888",
              flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {overdueLabel(f.overdueDays)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: "#555", marginTop: 8 }}>
        לעדכון הצעה — פתח את סקשן ״הצעות מחיר״ למטה
      </div>
    </div>
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
