"use client";

import { useState } from "react";
import Link from "next/link";
import type { Project, ProjectStatus, ProjectType } from "@/lib/types";
import { ALL_STATUSES, PROJECT_TYPES, NO_AFFILIATION, isNoAffiliation } from "@/lib/types";
import { formatDeadline, deadlineLabel, getStatusColor, daysUntilDeadline } from "@/lib/utils";
import StatusBadge, { OverdueTag, DueSoonTag } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import UploadButton from "@/components/ui/UploadButton";
import { useProjects } from "@/components/ProjectsProvider";

const TYPE_COLORS: Record<string, string> = {
  "שיר":  "#3B82F6",
  "EP":   "#A855F7",
  "אלבום":"#EC4899",
  "קליפ": "#F59E0B",
  "רידים":"#10B981",
  "אחר":  "#6B7280",
};

interface ProjectDetailProps {
  project: Project;
  onUpdate: (field: "status" | "deadline" | "notes" | "projectType" | "parentProject", value: string) => Promise<void>;
}

export default function ProjectDetail({ project, onUpdate }: ProjectDetailProps) {
  const { refresh } = useProjects();
  const [editStatus, setEditStatus] = useState(false);
  const [editDeadline, setEditDeadline] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [editType, setEditType] = useState(false);
  const [editParent, setEditParent] = useState(false);
  // Tracks which file index is pending delete confirmation
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteFile = async (assetId: number) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/monday/delete-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "מחיקה נכשלה");
      setConfirmDeleteIdx(null);
      await refresh(); // reload project with updated file list
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "שגיאה במחיקה");
      setTimeout(() => setDeleteError(null), 4000);
    } finally {
      setDeleting(false);
    }
  };

  const [newStatus, setNewStatus] = useState<ProjectStatus>(project.status);
  const [newDeadline, setNewDeadline] = useState(project.deadline || "");
  const [newNotes, setNewNotes] = useState(project.notes);
  const [newType, setNewType] = useState<ProjectType>(project.projectType);
  const [newParent, setNewParent] = useState(project.parentProject);

  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = daysUntilDeadline(project.deadline);
  const showDueSoon = days !== null && days >= 0 && days <= 7 && project.status !== "הושלם";

  const handleSave = async (
    field: "status" | "deadline" | "notes" | "projectType" | "parentProject",
    value: string
  ) => {
    setSaving(field);
    setError(null);
    try {
      await onUpdate(field, value);
      setEditStatus(false);
      setEditDeadline(false);
      setEditNotes(false);
      setEditType(false);
      setEditParent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בעדכון");
      setTimeout(() => setError(null), 4000);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8 text-sm" style={{ color: "#555" }}>
        <Link href="/projects" style={{ color: "#555", textDecoration: "none" }}>
          פרויקטים
        </Link>
        <span>/</span>
        <span style={{ color: "#888" }}>{project.name}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#F0F0F0" }}>
          {project.name}
        </h1>
        <p className="text-base mb-4" style={{ color: "#666" }}>
          {project.artist}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={project.status} />
          {project.projectType && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: TYPE_COLORS[project.projectType] ?? "#6B7280",
                background: `${TYPE_COLORS[project.projectType] ?? "#6B7280"}18`,
                border: `1px solid ${TYPE_COLORS[project.projectType] ?? "#6B7280"}35`,
                borderRadius: 8,
                padding: "2px 8px",
              }}
            >
              {project.projectType}
            </span>
          )}
          {!isNoAffiliation(project.parentProject) && (
            <span className="text-xs" style={{ color: "#555" }}>
              ← {project.parentProject}
            </span>
          )}
          {project.isOverdue && project.status !== "הושלם" && <OverdueTag />}
          {showDueSoon && <DueSoonTag days={days!} />}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-sm"
          style={{ background: "#2A1010", border: "1px solid #5A1A1A", color: "#FF6B6B" }}
        >
          {error}
        </div>
      )}

      <div className="space-y-4">

        {/* Status */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>שלב נוכחי</span>
            <Button size="sm" variant="ghost" onClick={() => setEditStatus(!editStatus)}>
              {editStatus ? "ביטול" : "שינוי"}
            </Button>
          </div>
          {editStatus ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ALL_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setNewStatus(s)}
                    className="px-3 py-1.5 rounded-xl border text-sm transition-all"
                    style={{
                      background: newStatus === s ? `${getStatusColor(s)}18` : "#141414",
                      borderColor: newStatus === s ? getStatusColor(s) : "#252525",
                      color: newStatus === s ? getStatusColor(s) : "#666",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={newStatus === project.status || saving === "status"}
                onClick={() => handleSave("status", newStatus)}
              >
                {saving === "status" ? "שומר..." : "שמור שינוי"}
              </Button>
            </div>
          ) : (
            <StatusBadge status={project.status} />
          )}
        </div>

        {/* Project type */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>סוג פרויקט</span>
            <Button size="sm" variant="ghost" onClick={() => setEditType(!editType)}>
              {editType ? "ביטול" : "שינוי"}
            </Button>
          </div>
          {editType ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setNewType("")}
                  className="px-3 py-1.5 rounded-xl border text-sm transition-all"
                  style={{
                    background: newType === "" ? "rgba(107,114,128,0.15)" : "#141414",
                    borderColor: newType === "" ? "#6B7280" : "#252525",
                    color: newType === "" ? "#9CA3AF" : "#666",
                  }}
                >
                  ללא
                </button>
                {PROJECT_TYPES.map((t) => {
                  const color = TYPE_COLORS[t] ?? "#6B7280";
                  return (
                    <button
                      key={t}
                      onClick={() => setNewType(t)}
                      className="px-3 py-1.5 rounded-xl border text-sm transition-all"
                      style={{
                        background: newType === t ? `${color}18` : "#141414",
                        borderColor: newType === t ? color : "#252525",
                        color: newType === t ? color : "#666",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={newType === project.projectType || saving === "projectType"}
                onClick={() => handleSave("projectType", newType)}
              >
                {saving === "projectType" ? "שומר..." : "שמור שינוי"}
              </Button>
            </div>
          ) : (
            <div className="text-sm" style={{ color: project.projectType ? TYPE_COLORS[project.projectType] ?? "#888" : "#555" }}>
              {project.projectType || "לא הוגדר"}
            </div>
          )}
        </div>

        {/* Parent project */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>שייך ל</span>
            <Button size="sm" variant="ghost" onClick={() => setEditParent(!editParent)}>
              {editParent ? "ביטול" : "עריכה"}
            </Button>
          </div>
          {editParent ? (
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newParent}
                onChange={(e) => setNewParent(e.target.value)}
                placeholder="אלבום: שם / EP: שם / Riddim: שם / ללא שיוך"
                className="flex-1 px-3 py-2 rounded-xl border text-sm"
                style={{ background: "#141414", borderColor: "#252525", color: "#F0F0F0" }}
                dir="rtl"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={saving === "parentProject"}
                onClick={() => handleSave("parentProject", newParent.trim() || NO_AFFILIATION)}
              >
                {saving === "parentProject" ? "שומר..." : "שמור"}
              </Button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: isNoAffiliation(project.parentProject) ? "#555" : "#C0C0C0" }}>
              {isNoAffiliation(project.parentProject) ? NO_AFFILIATION : project.parentProject}
            </p>
          )}
        </div>

        {/* Deadline */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>דדליין</span>
            <Button size="sm" variant="ghost" onClick={() => setEditDeadline(!editDeadline)}>
              {editDeadline ? "ביטול" : "שינוי"}
            </Button>
          </div>
          {editDeadline ? (
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="px-3 py-2 rounded-xl border text-sm"
                style={{ background: "#141414", borderColor: "#252525", color: "#F0F0F0" }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={saving === "deadline"}
                onClick={() => handleSave("deadline", newDeadline)}
              >
                {saving === "deadline" ? "שומר..." : "שמור"}
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-base font-medium" style={{ color: "#E8E8E8" }}>
                {formatDeadline(project.deadline)}
              </div>
              {project.deadline && (
                <div
                  className="text-sm"
                  style={{ color: project.isOverdue ? "#EF4444" : showDueSoon ? "#F97316" : "#666" }}
                >
                  {deadlineLabel(project.deadline)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>הערות</span>
            <Button size="sm" variant="ghost" onClick={() => setEditNotes(!editNotes)}>
              {editNotes ? "ביטול" : "עריכה"}
            </Button>
          </div>
          {editNotes ? (
            <div className="space-y-3">
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
                style={{ background: "#141414", borderColor: "#252525", color: "#F0F0F0" }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={saving === "notes"}
                onClick={() => handleSave("notes", newNotes)}
              >
                {saving === "notes" ? "שומר..." : "שמור"}
              </Button>
            </div>
          ) : (
            <p className="text-sm leading-relaxed" style={{ color: project.notes ? "#C0C0C0" : "#555" }}>
              {project.notes || "אין הערות"}
            </p>
          )}
        </div>

        {/* Files + Upload + Delete */}
        <div className="rounded-2xl border p-5" style={{ background: "#1A1A1A", borderColor: "#252525" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium" style={{ color: "#666" }}>קבצים</span>
            <UploadButton
              projectId={project.id}
              projectName={project.name}
              artist={project.artist}
              existingFiles={project.files}
              size="md"
            />
          </div>

          {deleteError && (
            <div className="rounded-xl px-3 py-2 mb-3 text-xs" style={{ background: "#2A1010", border: "1px solid #5A1A1A", color: "#FF6B6B" }}>
              {deleteError}
            </div>
          )}

          {project.files.length > 0 ? (
            <div className="space-y-2">
              {project.files.map((f, i) => (
                <div key={i}>
                  {confirmDeleteIdx === i ? (
                    /* ── Confirm delete row ─────────────────────────────── */
                    <div
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border"
                      style={{ background: "#2A1010", borderColor: "#5A1A1A" }}
                    >
                      <span className="text-xs truncate min-w-0" style={{ color: "#FF6B6B" }}>
                        למחוק את "{f.name}"?
                      </span>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => f.assetId != null && handleDeleteFile(f.assetId)}
                          disabled={deleting || f.assetId == null}
                          style={{
                            padding: "3px 10px", borderRadius: 7, border: "none",
                            background: "#EF4444", color: "#fff", fontSize: 12, fontWeight: 600,
                            cursor: deleting ? "wait" : "pointer", fontFamily: "inherit",
                            opacity: deleting ? 0.7 : 1,
                          }}
                        >
                          {deleting ? "מוחק..." : "אשר מחיקה"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteIdx(null)}
                          disabled={deleting}
                          style={{
                            padding: "3px 10px", borderRadius: 7,
                            border: "1px solid #333", background: "transparent",
                            color: "#666", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal file row ────────────────────────────────── */
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all group"
                      style={{ background: "#141414", borderColor: "#252525" }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "#333")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "#252525")}
                    >
                      <span style={{ opacity: 0.7, flexShrink: 0 }}>📎</span>
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-sm truncate min-w-0"
                        style={{ color: "#3B82F6", textDecoration: "none" }}
                      >
                        {f.name}
                      </a>
                      {/* Delete button — visible on hover */}
                      {f.assetId != null && (
                        <button
                          onClick={() => setConfirmDeleteIdx(i)}
                          title="מחק קובץ"
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#444", fontSize: 15, padding: "0 2px",
                            flexShrink: 0, lineHeight: 1,
                            transition: "color 0.15s",
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#444")}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#555" }}>אין קבצים מצורפים</p>
          )}
        </div>
      </div>
    </div>
  );
}
