"use client";

import { useState, useEffect, useCallback } from "react";
import type { Client, ClientType, ClientStatus } from "@/lib/clients-store";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENT_TYPES: ClientType[]   = ["אמן", "לקוח", "איש צוות", "אחר"];
const CLIENT_STATUSES: ClientStatus[] = ["פעיל", "לא פעיל", "בעייתי", "VIP", "חדש"];

const TYPE_COLORS: Record<ClientType, { bg: string; color: string }> = {
  "אמן":       { bg: "rgba(168,85,247,0.12)",  color: "#C084FC" },
  "לקוח":      { bg: "rgba(59,130,246,0.12)",  color: "#60A5FA" },
  "איש צוות": { bg: "rgba(16,185,129,0.12)",  color: "#34D399" },
  "אחר":       { bg: "rgba(107,114,128,0.12)", color: "#9CA3AF" },
};

const STATUS_COLORS: Record<ClientStatus, { bg: string; color: string }> = {
  "פעיל":    { bg: "rgba(16,185,129,0.12)", color: "#34D399" },
  "לא פעיל": { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
  "בעייתי":  { bg: "rgba(239,68,68,0.12)",  color: "#F87171" },
  "VIP":     { bg: "rgba(245,158,11,0.12)", color: "#FBBF24" },
  "חדש":     { bg: "rgba(59,130,246,0.12)", color: "#60A5FA" },
};

// ─── Empty form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name:   "",
  phone:  "",
  email:  "",
  type:   "אמן" as ClientType,
  status: "חדש" as ClientStatus,
  notes:  "",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients,   setClients]  = useState<Client[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [error,     setError]    = useState<string | null>(null);
  const [modal,     setModal]    = useState<"add" | "edit" | null>(null);
  const [editing,   setEditing]  = useState<Client | null>(null);
  const [form,      setForm]     = useState({ ...EMPTY_FORM });
  const [saving,    setSaving]   = useState(false);
  const [deleting,  setDeleting] = useState<string | null>(null);
  const [search,    setSearch]   = useState("");
  const [isCompact, setIsCompact]= useState(false);

  useEffect(() => {
    const check = () => setIsCompact(window.innerWidth < 1300);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/clients");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setClients(d.clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setModal("add");
  }

  function openEdit(client: Client) {
    setEditing(client);
    setForm({
      name:   client.name,
      phone:  client.phone,
      email:  client.email,
      type:   client.type,
      status: client.status,
      notes:  client.notes,
    });
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setEditing(null);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (modal === "edit" && editing) {
        const r = await fetch(`/api/clients/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setClients((prev) =>
          prev.map((c) => (c.id === editing.id ? { id: editing.id, ...form } : c))
        );
        // Warn if Monday.com artist sync failed (non-fatal)
        if (d.syncWarning) {
          console.warn("[ClientsPage] Monday sync warning:", d.syncWarning);
          alert(`הלקוח עודכן, אך עדכון שם האמן בפרויקטים נכשל:\n${d.syncWarning}`);
        } else if (typeof d.syncedProjects === "number" && d.syncedProjects > 0) {
          console.log(`[ClientsPage] synced artist name in ${d.syncedProjects} project(s)`);
        }
      } else {
        const r = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setClients((prev) => [...prev, d.client]);
      }
      closeModal();
    } catch (e) {
      alert(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm("למחוק את הלקוח הזה?")) return;
    setDeleting(id);
    try {
      const r = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setClients((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "שגיאה במחיקה");
    } finally {
      setDeleting(null);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  const filtered = clients.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.includes(q)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#F0F0F0" }}>לקוחות</h1>
          <p className="text-sm mt-1" style={{ color: "#888" }}>
            רשימת האמנים והלקוחות של הלייבל
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            padding: "9px 18px", borderRadius: 12,
            border: "1.5px solid rgba(168,85,247,0.4)",
            background: "rgba(168,85,247,0.12)", color: "#C084FC",
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          + הוסף לקוח
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם, אימייל, טלפון..."
          style={{
            width: "100%", padding: "9px 14px", borderRadius: 11,
            border: "1px solid #2A2A2A", background: "#1A1A1A",
            color: "#E8E8E8", fontSize: 13, fontFamily: "inherit",
            outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* State: loading / error / empty */}
      {loading && (
        <div style={{ color: "#555", fontSize: 14, textAlign: "center", paddingTop: 60 }}>
          טוען לקוחות...
        </div>
      )}
      {!loading && error && (
        <div style={{
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 12, padding: "14px 18px", color: "#EF4444", fontSize: 13,
        }}>
          {error}
          <button onClick={load} style={{ marginRight: 12, color: "#60A5FA", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            נסה שוב
          </button>
        </div>
      )}
      {!loading && !error && clients.length === 0 && (
        <div style={{ color: "#555", fontSize: 14, textAlign: "center", paddingTop: 60 }}>
          אין לקוחות עדיין.{" "}
          <button onClick={openAdd} style={{ color: "#C084FC", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
            הוסף את הראשון
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && !error && clients.length > 0 && (
        <div style={{
          background: "#141414", border: "1px solid #252525", borderRadius: 16, overflow: "hidden",
        }}>
          {/* Desktop header */}
          <div
            className="hidden md:grid tbl-header"
            style={{
              gridTemplateColumns: isCompact ? "2fr 1.4fr 1.2fr 80px" : "2fr 1.4fr 2fr 1fr 1.1fr 80px",
              padding: "10px 20px",
              background: "#141414",
              borderBottom: "1px solid #252525",
            }}
          >
            <span>שם</span>
            <span>טלפון</span>
            {!isCompact && <span>אימייל</span>}
            {!isCompact && <span>סוג</span>}
            <span>סטטוס</span>
            <span></span>
          </div>

          {/* Rows */}
          {filtered.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              isCompact={isCompact}
              deleting={deleting === client.id}
              onEdit={() => openEdit(client)}
              onDelete={() => handleDelete(client.id)}
            />
          ))}

          {filtered.length === 0 && search && (
            <div style={{ padding: "24px 20px", color: "#555", fontSize: 13, textAlign: "center" }}>
              לא נמצאו תוצאות עבור &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <ClientModal
          mode={modal}
          form={form}
          saving={saving}
          onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ClientRow({
  client, isCompact, deleting, onEdit, onDelete,
}: {
  client: Client; isCompact: boolean; deleting: boolean;
  onEdit: () => void; onDelete: () => void;
}) {
  const typeColor   = TYPE_COLORS[client.type]   || TYPE_COLORS["אחר"];
  const statusColor = STATUS_COLORS[client.status] || STATUS_COLORS["חדש"];

  return (
    <div
      style={{
        borderBottom: "1px solid #252525",
        padding: "11px 20px",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#1E1E1E")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Desktop grid */}
      <div
        className="hidden md:grid"
        style={{
          gridTemplateColumns: isCompact ? "2fr 1.4fr 1.2fr 80px" : "2fr 1.4fr 2fr 1fr 1.1fr 80px",
          alignItems: "center", gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#E8E8E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.name}</div>
          {client.notes && !isCompact && (
            <div className="truncate" style={{ fontSize: 11, color: "#555", marginTop: 2, maxWidth: 200 }}>
              {client.notes}
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, color: "#A0A0A0", direction: "ltr", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {client.phone || <span style={{ color: "#333" }}>—</span>}
        </div>

        {!isCompact && (
          <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr", textAlign: "right" }}>
            {client.email || <span style={{ color: "#333" }}>—</span>}
          </div>
        )}

        {!isCompact && <Badge bg={typeColor.bg} color={typeColor.color}>{client.type}</Badge>}
        <Badge bg={statusColor.bg} color={statusColor.color}>{client.status}</Badge>

        <Actions deleting={deleting} onEdit={onEdit} onDelete={onDelete} />
      </div>

      {/* Mobile layout */}
      <div className="md:hidden flex items-start justify-between gap-3">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#E8E8E8" }}>{client.name}</span>
            <Badge bg={typeColor.bg} color={typeColor.color} small>{client.type}</Badge>
          </div>
          {client.phone && (
            <div style={{ fontSize: 12, color: "#888", direction: "ltr", textAlign: "right" }}>{client.phone}</div>
          )}
          {client.email && (
            <div style={{ fontSize: 12, color: "#888", direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.email}</div>
          )}
          <Badge bg={statusColor.bg} color={statusColor.color} small style={{ marginTop: 6 }}>{client.status}</Badge>
        </div>
        <Actions deleting={deleting} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  children, bg, color, small, style,
}: {
  children: React.ReactNode; bg: string; color: string;
  small?: boolean; style?: React.CSSProperties;
}) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: small ? "2px 8px" : "3px 10px",
      borderRadius: 100,
      background: bg, color,
      border: `1px solid ${color}35`,
      fontSize: small ? 11 : 12, fontWeight: 600,
      whiteSpace: "nowrap",
      ...style,
    }}>
      {children}
    </span>
  );
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function Actions({
  deleting, onEdit, onDelete,
}: {
  deleting: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button
        onClick={onEdit}
        style={{
          width: 30, height: 30, borderRadius: 8,
          border: "1px solid #2A2A2A", background: "#1A1A1A",
          color: "#888", fontSize: 14, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        title="עריכה"
      >
        ✎
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        style={{
          width: 30, height: 30, borderRadius: 8,
          border: "1px solid rgba(239,68,68,0.2)",
          background: "rgba(239,68,68,0.06)",
          color: deleting ? "#555" : "#F87171",
          fontSize: 14, cursor: deleting ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        title="מחיקה"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

type FormKey = keyof typeof EMPTY_FORM;

function ClientModal({
  mode, form, saving, onChange, onSave, onClose,
}: {
  mode: "add" | "edit";
  form: typeof EMPTY_FORM;
  saving: boolean;
  onChange: (field: FormKey, value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const title = mode === "add" ? "הוסף לקוח חדש" : "עריכת לקוח";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#141414", border: "1px solid #262626", borderRadius: 22,
          padding: "28px 28px 24px", width: "100%", maxWidth: 440,
          direction: "rtl", fontFamily: "inherit",
          boxShadow: "0 24px 64px rgba(0,0,0,0.9)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F0", marginBottom: 22 }}>
          {title}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="שם *">
            <input
              value={form.name}
              onChange={(e) => onChange("name", e.target.value)}
              placeholder="שם מלא"
              autoFocus
              style={inputStyle}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="טלפון">
              <input
                value={form.phone}
                onChange={(e) => onChange("phone", e.target.value)}
                placeholder="050-0000000"
                style={{ ...inputStyle, direction: "ltr", textAlign: "right" }}
              />
            </Field>
            <Field label="אימייל">
              <input
                type="email"
                value={form.email}
                onChange={(e) => onChange("email", e.target.value)}
                placeholder="email@example.com"
                style={{ ...inputStyle, direction: "ltr", textAlign: "right" }}
              />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="סוג">
              <SelectField
                value={form.type}
                options={CLIENT_TYPES}
                onChange={(v) => onChange("type", v)}
              />
            </Field>
            <Field label="סטטוס">
              <SelectField
                value={form.status}
                options={CLIENT_STATUSES}
                onChange={(v) => onChange("status", v)}
              />
            </Field>
          </div>

          <Field label="הערות">
            <textarea
              value={form.notes}
              onChange={(e) => onChange("notes", e.target.value)}
              placeholder="הערות נוספות..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 12,
              border: "1.5px solid rgba(168,85,247,0.4)",
              background: "rgba(168,85,247,0.14)", color: "#C084FC",
              fontSize: 14, fontWeight: 600, cursor: saving || !form.name.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit", opacity: saving || !form.name.trim() ? 0.5 : 1,
            }}
          >
            {saving ? "שומר..." : mode === "add" ? "הוסף" : "שמור"}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "11px 20px", borderRadius: 12,
              border: "1.5px solid #2A2A2A", background: "#1E1E1E",
              color: "#888", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SelectField({
  value, options, onChange,
}: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer" }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10,
  border: "1px solid #2A2A2A", background: "#111",
  color: "#E8E8E8", fontSize: 13, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
