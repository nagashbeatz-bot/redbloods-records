"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Client, ClientType, ClientStatus } from "@/lib/clients-store";
import { useGlobalProjectDrawer } from "@/components/GlobalProjectDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  status: string;
  artist: string;
  deadline: string | null;
  project_type?: string;
}

interface Transaction {
  project_id: string;
  type: "income" | "expense";
  amount: number;
  payment_status: string;
  date: string | null;
  currency: string;
}

interface Session {
  id: string;
  project_id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  notes: string;
}

interface FinanceSetting {
  project_id: string;
  agreedPrice: number;
  currency: string;
}

interface DeliveryRecord {
  projectId:      string;
  deliveryLink:   string;
  deliveryStatus: string;
  deliveredAt:    string | null;
}

interface ProjectFinance {
  projectId: string;
  name: string;
  status: string;
  agreedPrice: number;
  currency: string;
  totalPaid: number;
  totalExpected: number;
  totalExpenses: number;
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
  "בעבודה":      "#3B82F6",
  "מחכה למיקס":  "#F59E0B",
  "במיקס":        "#A855F7",
  "לא התחיל":    "#6B7280",
  "הושלם":        "#10B981",
  "בהשהייה":      "#EF4444",
};

// ─── ClientDrawer ─────────────────────────────────────────────────────────────

interface ClientDrawerProps {
  client: Client | null;
  onClose: () => void;
  onEdit: (client: Client) => void;
}

export default function ClientDrawer({ client, onClose, onEdit }: ClientDrawerProps) {
  const { openProject } = useGlobalProjectDrawer();

  const [projects,    setProjects]   = useState<Project[]>([]);
  const [finances,    setFinances]   = useState<ProjectFinance[]>([]);
  const [sessions,    setSessions]   = useState<Session[]>([]);
  const [deliveries,  setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading,     setLoading]    = useState(false);
  const [mounted,     setMounted]    = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Close on Escape
  useEffect(() => {
    if (!client) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [client, onClose]);

  const loadData = useCallback(async (clientName: string) => {
    setLoading(true);
    setProjects([]);
    setFinances([]);
    setSessions([]);
    setDeliveries([]);

    try {
      // Fetch projects + transactions + sessions + deliveries in parallel
      const [projRes, txRes, sessRes, delivRes] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/transactions?all=1").then((r) => r.json()),
        fetch("/api/sessions?all=1").then((r) => r.json()),
        fetch("/api/delivery?all=1").then((r) => r.json()).catch(() => ({ deliveries: [] })),
      ]);

      // Filter projects by client name match in artist field
      const allProjects: Project[] = Array.isArray(projRes) ? projRes : [];
      const clientProjects = allProjects.filter((p) =>
        p.artist
          .split(/[,،;]/)
          .map((s: string) => s.trim())
          .includes(clientName)
      );

      const projectIds = new Set(clientProjects.map((p) => p.id));

      // Build per-project finance
      const allTx: Transaction[] = txRes.transactions ?? [];
      const allSettings: FinanceSetting[] = txRes.settings ?? [];
      const allSessions: Session[] = sessRes.sessions ?? [];

      const finMap = new Map<string, ProjectFinance>();
      for (const p of clientProjects) {
        finMap.set(p.id, {
          projectId: p.id,
          name: p.name,
          status: p.status,
          agreedPrice: 0,
          currency: "₪",
          totalPaid: 0,
          totalExpected: 0,
          totalExpenses: 0,
        });
      }

      for (const t of allTx) {
        if (!projectIds.has(t.project_id)) continue;
        const fin = finMap.get(t.project_id)!;
        if (t.type === "income") {
          if (t.payment_status === "שולם" || t.payment_status === "התקבל") fin.totalPaid += t.amount;
          else if (t.payment_status === "צפוי" || t.payment_status === "חלקי") fin.totalExpected += t.amount;
        } else if (t.type === "expense") {
          fin.totalExpenses += t.amount;
        }
      }

      for (const s of allSettings) {
        if (!finMap.has(s.project_id)) continue;
        const fin = finMap.get(s.project_id)!;
        fin.agreedPrice = s.agreedPrice ?? 0;
        fin.currency    = s.currency    ?? "₪";
      }

      const clientSessions = allSessions.filter((s) => projectIds.has(s.project_id));

      // Filter deliveries to this client's projects
      const allDeliveries: DeliveryRecord[] = delivRes.deliveries ?? [];
      const clientDeliveries = allDeliveries.filter(
        (d) => projectIds.has(d.projectId) && d.deliveryStatus !== "not_created" && d.deliveryLink
      );

      setProjects(clientProjects);
      setFinances(Array.from(finMap.values()));
      setSessions(clientSessions);
      setDeliveries(clientDeliveries);
    } catch {
      // Non-fatal — drawer still shows identity card
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (client) loadData(client.name);
  }, [client, loadData]);

  if (!mounted) return null;

  const visible = !!client;

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
          pointerEvents: visible ? "auto" : "none",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 9001,
          width: 400, maxWidth: "100vw",
          background: "#141414",
          borderRight: "1px solid #262626",
          boxShadow: "4px 0 32px rgba(0,0,0,0.8)",
          transform: visible ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
          display: "flex", flexDirection: "column",
          direction: "rtl",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {client && (
          <DrawerContent
            client={client}
            projects={projects}
            finances={finances}
            sessions={sessions}
            deliveries={deliveries}
            loading={loading}
            onClose={onClose}
            onEdit={onEdit}
            openProject={openProject}
          />
        )}
      </div>
    </>
  );

  return createPortal(drawer, document.body);
}

// ─── DrawerContent ────────────────────────────────────────────────────────────

function DrawerContent({
  client, projects, finances, sessions, deliveries, loading,
  onClose, onEdit, openProject,
}: {
  client: Client;
  projects: Project[];
  finances: ProjectFinance[];
  sessions: Session[];
  deliveries: DeliveryRecord[];
  loading: boolean;
  onClose: () => void;
  onEdit: (client: Client) => void;
  openProject: (id: string) => void;
}) {
  const today = new Date().toISOString().split("T")[0];

  // ── Derived stats ────────────────────────────────────────────────────────
  const totalAgreed    = finances.reduce((s, f) => s + f.agreedPrice, 0);
  const totalPaid      = finances.reduce((s, f) => s + f.totalPaid, 0);
  const totalExpected  = finances.reduce((s, f) => s + f.totalExpected, 0);
  const totalBalance   = totalAgreed - totalPaid;
  const totalExpenses  = finances.reduce((s, f) => s + f.totalExpenses, 0);
  const totalProfit    = totalPaid - totalExpenses;

  // Primary currency (most common)
  const currency = finances.length > 0 ? (finances[0].currency ?? "₪") : "₪";

  const completedSessions = sessions.filter((s) => s.status === "התקיים").length;
  const plannedSessions   = sessions.filter((s) => s.status === "מתוכנן").length;

  const nextSession = sessions
    .filter((s) => s.status === "מתוכנן" && s.date && s.date >= today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];

  const lastSession = sessions
    .filter((s) => s.status === "התקיים" && s.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

  // Most recent project (for quick action)
  const activeProjects = projects.filter(
    (p) => p.status !== "הושלם" && p.status !== "בהשהייה"
  );
  const lastProject = activeProjects[0] ?? projects[0];

  const typeColor   = TYPE_COLORS[client.type]   ?? TYPE_COLORS["אחר"];
  const statusColor = STATUS_COLORS[client.status] ?? STATUS_COLORS["חדש"];

  return (
    <div style={{ padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F0F0F0", marginBottom: 8, lineHeight: 1.2 }}>
            {client.name}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip bg={typeColor.bg} color={typeColor.color}>{client.type}</Chip>
            <Chip bg={statusColor.bg} color={statusColor.color}>{client.status}</Chip>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onEdit(client)}
            title="עריכה"
            style={iconBtnStyle}
          >
            ✎
          </button>
          <button
            onClick={onClose}
            title="סגור"
            style={{ ...iconBtnStyle, fontSize: 18 }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Contact info ── */}
      {(client.phone || client.email) && (
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {client.phone && (
              <ContactRow
                icon="📞"
                label={client.phone}
                href={`tel:${client.phone}`}
                dir="ltr"
              />
            )}
            {client.email && (
              <ContactRow
                icon="✉"
                label={client.email}
                href={`mailto:${client.email}`}
                dir="ltr"
              />
            )}
          </div>
        </Card>
      )}

      {/* ── Quick actions ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {client.phone && (
          <QuickBtn
            href={`https://wa.me/972${client.phone.replace(/^0/, "").replace(/-/g, "")}`}
            color="#25D366"
            icon="💬"
            label="WhatsApp"
          />
        )}
        {client.phone && (
          <CopyBtn text={client.phone} label="העתק טלפון" icon="📋" />
        )}
        {lastProject && (
          <QuickBtn
            onClick={() => { onClose(); setTimeout(() => openProject(lastProject.id), 50); }}
            color="#3B82F6"
            icon="♫"
            label="פתח פרויקט"
          />
        )}
      </div>

      {/* ── Notes ── */}
      {client.notes && (
        <Card>
          <div style={{ fontSize: 11, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            הערות
          </div>
          <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>{client.notes}</div>
        </Card>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: "#444", fontSize: 13, padding: "20px 0" }}>
          טוען נתונים...
        </div>
      )}

      {!loading && (
        <>
          {/* ── Finance summary ── */}
          {totalAgreed > 0 && (
            <Section title="כספים">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <StatCard label="סוכם" value={`${totalAgreed.toLocaleString()}${currency}`} color="#A855F7" />
                <StatCard label="שולם" value={`${totalPaid.toLocaleString()}${currency}`} color="#10B981" />
                <StatCard
                  label="יתרה"
                  value={`${totalBalance.toLocaleString()}${currency}`}
                  color={totalBalance <= 0 ? "#10B981" : "#EF4444"}
                />
                <StatCard
                  label="רווח"
                  value={`${totalProfit.toLocaleString()}${currency}`}
                  color={totalProfit >= 0 ? "#10B981" : "#EF4444"}
                />
              </div>
              {totalExpected > 0 && (
                <div style={{ fontSize: 12, color: "#555", paddingTop: 4 }}>
                  תשלום צפוי: <span style={{ color: "#3B82F6" }}>{totalExpected.toLocaleString()}{currency}</span>
                </div>
              )}
            </Section>
          )}

          {/* ── Projects ── */}
          {projects.length > 0 && (
            <Section title={`פרויקטים (${projects.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {projects.map((p) => {
                  const fin = finances.find((f) => f.projectId === p.id);
                  const balance = fin ? fin.agreedPrice - fin.totalPaid : 0;
                  const statusColor = PROJECT_STATUS_COLOR[p.status] ?? "#6B7280";
                  return (
                    <button
                      key={p.id}
                      onClick={() => { onClose(); setTimeout(() => openProject(p.id), 50); }}
                      style={{
                        width: "100%", textAlign: "right", background: "#1A1A1A",
                        border: "1px solid #252525", borderRadius: 10,
                        padding: "9px 12px", cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 8,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#333")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#252525")}
                    >
                      <span style={{ flex: 1, fontSize: 13, color: "#D8D8D8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </span>
                      <span style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: 20,
                        background: `${statusColor}18`, color: statusColor,
                        border: `1px solid ${statusColor}30`, whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {p.status}
                      </span>
                      {fin && fin.agreedPrice > 0 && (
                        <span style={{
                          fontSize: 11, color: balance <= 0 ? "#10B981" : "#EF4444",
                          flexShrink: 0, fontWeight: 600,
                        }}>
                          {balance <= 0 ? "✓" : `${balance.toLocaleString()}${fin.currency}`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Sessions ── */}
          {sessions.length > 0 && (
            <Section title={`סשנים (${sessions.length})`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                <StatCard label="סה״כ" value={String(sessions.length)} color="#A855F7" small />
                <StatCard label="התקיימו" value={String(completedSessions)} color="#10B981" small />
                <StatCard label="מתוכננים" value={String(plannedSessions)} color="#3B82F6" small />
              </div>

              {lastSession && (
                <InfoRow label="סשן אחרון" value={formatDate(lastSession.date)} />
              )}
              {nextSession && (
                <InfoRow
                  label="הבא"
                  value={`${formatDate(nextSession.date)}${nextSession.start_time ? ` ב-${nextSession.start_time.slice(0, 5)}` : ""}`}
                  color="#3B82F6"
                />
              )}
            </Section>
          )}

          {/* ── Deliveries ── */}
          {deliveries.length > 0 && (
            <Section title={`מסירות ללקוח (${deliveries.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {deliveries.map((d) => {
                  const proj = projects.find((p) => p.id === d.projectId);
                  const [copied, setCopied] = useState(false);
                  const copy = () => {
                    navigator.clipboard.writeText(d.deliveryLink).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    }).catch(() => {});
                  };
                  return (
                    <div
                      key={d.projectId}
                      style={{
                        background: "#111", border: "1px solid #222", borderRadius: 10,
                        padding: "9px 12px", display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#D0D0D0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {proj?.name ?? d.projectId}
                        </div>
                        {d.deliveredAt && (
                          <div style={{ fontSize: 10, color: "#444" }}>
                            נמסר {d.deliveredAt.split("-").reverse().join(".")}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={copy}
                        style={{
                          padding: "4px 9px", borderRadius: 7, cursor: "pointer",
                          fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                          border: copied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(168,85,247,0.3)",
                          background: copied ? "rgba(16,185,129,0.1)" : "rgba(168,85,247,0.08)",
                          color: copied ? "#10B981" : "#C084FC",
                          transition: "all 0.15s", whiteSpace: "nowrap", flexShrink: 0,
                        }}
                      >
                        {copied ? "✓" : "📋"} {copied ? "הועתק" : "לינק"}
                      </button>
                      {d.deliveryLink && (
                        <a
                          href={d.deliveryLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "4px 9px", borderRadius: 7, fontSize: 11,
                            border: "1px solid #222", background: "#1A1A1A",
                            color: "#555", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
                          }}
                        >
                          ↗
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Empty state */}
          {projects.length === 0 && !loading && (
            <div style={{ textAlign: "center", color: "#444", fontSize: 12, padding: "12px 0" }}>
              אין פרויקטים מקושרים ללקוח זה
            </div>
          )}
        </>
      )}

      {/* ── Footer ── */}
      {client.created_at && (
        <div style={{ fontSize: 11, color: "#333", textAlign: "center", marginTop: 4 }}>
          נוסף: {formatDate(client.created_at)}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date.slice(0, 10);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#1A1A1A", border: "1px solid #252525",
      borderRadius: 12, padding: "14px 14px",
    }}>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#444", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Chip({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "3px 10px", borderRadius: 20,
      background: bg, color,
      border: `1px solid ${color}30`,
      fontSize: 11, fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div style={{
      background: "#111", border: "1px solid #222", borderRadius: 10,
      padding: small ? "8px 10px" : "10px 12px",
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      <div style={{ fontSize: 10, color: "#444", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 16, fontWeight: 700, color }}>{value}</div>
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

function ContactRow({ icon, label, href, dir }: { icon: string; label: string; href: string; dir?: string }) {
  return (
    <a
      href={href}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        color: "#888", fontSize: 13, textDecoration: "none",
        direction: dir as "ltr" | "rtl" | undefined,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#C0C0C0")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#888")}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </a>
  );
}

function QuickBtn({
  href, onClick, color, icon, label,
}: {
  href?: string; onClick?: () => void; color: string; icon: string; label: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 14px", borderRadius: 10,
    border: `1px solid ${color}30`,
    background: `${color}10`, color,
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", textDecoration: "none",
    whiteSpace: "nowrap",
  };

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={style}>
        {icon} {label}
      </a>
    );
  }
  return (
    <button onClick={onClick} style={style}>
      {icon} {label}
    </button>
  );
}

function CopyBtn({ text, label, icon }: { text: string; label: string; icon: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <button
      onClick={copy}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 14px", borderRadius: 10,
        border: copied ? "1px solid rgba(16,185,129,0.35)" : "1px solid #2A2A2A",
        background: copied ? "rgba(16,185,129,0.1)" : "#1A1A1A",
        color: copied ? "#10B981" : "#777",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        fontFamily: "inherit", whiteSpace: "nowrap",
        transition: "all 0.15s",
      }}
    >
      {copied ? "✓" : icon} {copied ? "הועתק" : label}
    </button>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  border: "1px solid #2A2A2A", background: "#1A1A1A",
  color: "#666", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
