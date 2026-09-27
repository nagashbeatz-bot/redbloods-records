"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Project, UpdatableField, PendingCreateAction } from "@/lib/types";
import { isDueSoon } from "@/lib/utils";
import { isProjectOverdue } from "@/lib/project-deadline";

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  refresh: () => Promise<void>;
  updateProjectField: (
    id: string,
    field: UpdatableField,
    value: string
  ) => Promise<void>;
  createProject: (fields: PendingCreateAction) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}

export default function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateProjectField = useCallback(
    async (id: string, field: UpdatableField, value: string) => {
      let snapshot: Project[] = [];

      setProjects((prev) => {
        snapshot = prev;
        return prev.map((p) => {
          if (p.id !== id) return p;
          const next = { ...p, [field]: value };
          if (field === "deadline") next.isDueSoon = isDueSoon(value);
          // The ONE overdue rule (lib/project-deadline.ts) — re-derived on a deadline OR status change.
          next.isOverdue = isProjectOverdue({ deadline: next.deadline, status: next.status, isHidden: next.isHidden });
          return next as Project;
        });
      });

      let errorMsg: string | null = null;
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errorMsg = data.error || "עדכון נכשל";
        }
      } catch {
        errorMsg = "שגיאת חיבור";
      }

      if (errorMsg) {
        setProjects(snapshot);
        throw new Error(errorMsg);
      }
    },
    []
  );

  // No optimistic removal: the project leaves the list only after the server confirms the delete. A refusal (409 —
  // e.g. final files still on its mix works) or any failure is THROWN with the server's Hebrew message for the caller
  // to show, and the list is re-read (a partial cleanup may have changed counts).
  const deleteProject = useCallback(async (id: string): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    } catch {
      throw new Error("שגיאת חיבור — הפרויקט לא נמחק");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await fetchAll();
      throw new Error(data.error || "המחיקה נכשלה — הפרויקט לא נמחק");
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, [fetchAll]);

  const createProject = useCallback(async (fields: PendingCreateAction): Promise<string> => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:          fields.name,
        artist:        fields.artist,
        status:        fields.status,
        deadline:      fields.deadline,
        notes:         fields.notes,
        projectType:   fields.projectType,
        parentProject: fields.parentProject,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "יצירה נכשלה");

    await fetchAll();
    return data.id ?? "";
  }, [fetchAll]);

  return (
    <ProjectsContext.Provider value={{ projects, loading, refresh: fetchAll, updateProjectField, createProject, deleteProject }}>
      {children}
    </ProjectsContext.Provider>
  );
}
